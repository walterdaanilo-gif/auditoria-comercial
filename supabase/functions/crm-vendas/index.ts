// Edge Function "crm-vendas": importa do CRM Q5 os negocios (vendas) com os produtos, de cada empresa que tem chave do CRM.
// Le TODOS os negocios de cada contato (/contacts/{id}/deals), de qualquer instancia (inclusive as que nao sincronizam
// conversa, como "Comercial inbound"). O detalhe (produtos e campos) so vem por /conversations/{chat}/deal, que devolve
// o negocio atual daquela conversa; negocio antigo fica com o produto que ja tinhamos ou sem produto.
// Precisa das permissoes deals:read e products:read na chave. Chamada pelo pg_cron (a cada 15 min) com x-crm-sync-token.
// Dados pessoais: nunca escrever nome, telefone ou valores em log.
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const API = "https://api.grupoquatro5.com/public/v1";
const LIMITE_MS = 120_000, POR_RODADA = 300, REVER_HORAS = 6, PAGINAS_CRM = 40;
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const primeiro = (n: unknown) => String(n ?? "").trim().split(/\s+/)[0]?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() || "";

// Tipo do produto pelo nome (o painel separa as vendas por tipo)
export function tipoDe(nome: string | null | undefined): string {
  const n = String(nome ?? "").toLowerCase();
  if (/imers/.test(n)) return "imersao";
  if (/in.?company/.test(n)) return "incompany";
  if (/workshop/.test(n)) return "workshop";
  if (/plataforma|start/.test(n)) return "plataforma";
  return n ? "outro" : "";
}

// Le todas as linhas (o Supabase devolve no maximo 1000 por consulta)
async function todas(tabela: string, colunas: string, org: string): Promise<any[]> {
  const out: any[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb.from(tabela).select(colunas).eq("org_id", org).range(de, de + 999);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}

async function q5(caminho: string, chave: string) {
  for (let t = 0; t < 3; t++) {
    const r = await fetch(API + caminho, { headers: { Authorization: `Bearer ${chave}`, Accept: "application/json" } });
    if (r.status === 429) { await espera(3000); continue; }
    const corpo = await r.json().catch(() => null);
    return { status: r.status, corpo };
  }
  return { status: 429, corpo: null };
}

async function importarEmpresa(org: { id: string; slug: string; crm_segredo: string }, ate: number) {
  const chave = Deno.env.get(org.crm_segredo) || "";
  if (!chave) return { empresa: org.slug, erro: "sem chave" };

  // 1) catalogo de produtos
  const pr = await q5("/products?limit=100", chave);
  if (pr.status === 403) return { empresa: org.slug, erro: "chave sem products:read/deals:read" };
  const produtos = (pr.corpo?.data ?? []) as any[];
  if (produtos.length) await sb.from("crm_produtos").upsert(produtos.map((p) => ({ id: p.id, org_id: org.id, nome: p.name, codigo: p.code, preco_cents: p.price_cents, ativo: p.active, tipo: tipoDe(p.name), sincronizado_em: new Date().toISOString() })));

  // 2) contatos das conversas do CRM: primeiro os nunca lidos, os que mudaram e os lidos ha mais de REVER_HORAS
  const convs = await todas("crm_conversas", "id,telefone,contato_nome,vendedor_id,raw", org.id);
  const { data: perfis } = await sb.from("profiles").select("id,nome,org_id,ativo").limit(1000);
  const lidas = await todas("crm_vendas", "deal_id,chat_id,status,valor_cents,produto,produtos,campos", org.id);
  const contatosLidos = await todas("crm_contatos_lidos", "contato_crm_id,lido_em", org.id);
  const daEmpresa = (perfis ?? []).filter((p: any) => p.org_id === org.id && p.ativo !== false);
  const porPrimeiroNome = (n: unknown) => { const k = primeiro(n); return k ? daEmpresa.filter((p: any) => primeiro(p.nome) === k) : []; };
  const salvo = new Map((lidas ?? []).map((l: any) => [l.deal_id, l]));
  // negocio de cada conversa como esta salvo: se o CRM mostrar outra situacao ou outro valor, o cliente e relido ja
  const porChat = new Map<string, { status: string | null; valor: number | null }[]>();
  for (const l of lidas ?? []) if (l.chat_id) porChat.set(l.chat_id, [...(porChat.get(l.chat_id) ?? []), { status: l.status, valor: l.valor_cents }]);
  const lidoEm = new Map((contatosLidos ?? []).map((l: any) => [l.contato_crm_id, Date.parse(l.lido_em)]));
  const contatos = new Map<string, { telefone: string | null; nome: string | null; mudou: number; chats: Map<string, string | null> }>();
  for (const c of convs ?? []) {
    const id = (c as any).raw?.contact?.id;
    if (!id) continue;
    const o = contatos.get(id) ?? { telefone: null, nome: null, mudou: 0, chats: new Map() };
    o.telefone ||= (c as any).telefone; o.nome ||= (c as any).contato_nome || (c as any).raw?.contact?.name || null;
    o.mudou = Math.max(o.mudou, Date.parse((c as any).raw?.updatedAt || 0) || 0);
    o.chats.set((c as any).id, (c as any).vendedor_id);
    contatos.set(id, o);
  }
  // conversas de TODAS as instancias direto do CRM (a sincronizacao de conversas nao traz algumas, como a
  // "Comercial inbound", onde muitas vendas sao lancadas): as mais recentes primeiro, so as que tem negocio
  for (let pagina = 1; pagina <= PAGINAS_CRM && Date.now() < ate - 60_000; pagina++) {
    const r = await q5(`/conversations?limit=100&page=${pagina}`, chave);
    if (r.status !== 200) break;
    const lista = (r.corpo?.data ?? []) as any[];
    for (const c of lista) {
      const id = c?.contact?.id;
      if (!id || !c.deal) continue;
      const o = contatos.get(id) ?? { telefone: null, nome: null, mudou: 0, chats: new Map() };
      o.telefone ||= c.contact.phoneE164 || null; o.nome ||= c.contact.name || null;
      o.mudou = Math.max(o.mudou, Date.parse(c.updatedAt || 0) || 0);
      const conhecidos = porChat.get(c.id) ?? [];
      if (c.deal.status && !conhecidos.some((k) => k.status === c.deal.status && (k.valor ?? null) === (c.deal.valueCents ?? null))) o.mudou = Date.now();
      if (!o.chats.has(c.id)) o.chats.set(c.id, null);
      contatos.set(id, o);
    }
    if (lista.length < 100) break;
    await espera(100);
  }

  const rever = Date.now() - REVER_HORAS * 3600_000;
  const fila = [...contatos].map(([id, o]) => ({ id, o, lido: lidoEm.get(id) ?? 0 }))
    .filter((x) => !x.lido || x.o.mudou > x.lido || x.lido < rever)
    .sort((a, b) => Number(b.o.mudou > b.lido) - Number(a.o.mudou > a.lido) || a.lido - b.lido).slice(0, POR_RODADA);

  let lidos = 0, gravados = 0;
  for (const { id: contato, o } of fila) {
    if (Date.now() > ate) break;
    const r = await q5(`/contacts/${contato}/deals`, chave);
    lidos++;
    if (r.status === 403) return { empresa: org.slug, erro: "chave sem deals:read", lidos };
    if (r.status !== 200) continue;
    const linhas = [];
    for (const d of (r.corpo?.data ?? []) as any[]) {
      // detalhe (produtos e campos): so o negocio atual da conversa; o antigo mantem o que ja tinhamos
      let itens = salvo.get(d.id)?.produtos ?? [], campos = salvo.get(d.id)?.campos ?? {};
      if (d.status !== "lost" && d.chat_id && (!itens.length || d.status === "open" || Date.parse(d.closed_at || 0) > rever)) {
        const det = await q5(`/conversations/${d.chat_id}/deal`, chave);
        if (det.status === 200 && det.corpo?.id === d.id) {
          itens = (Array.isArray(det.corpo.products) ? det.corpo.products : []).map((p: any) => ({ produto_id: p.product_id, nome: p.name, quantidade: p.quantity, total_cents: p.total_cents }));
          campos = det.corpo.field_values && typeof det.corpo.field_values === "object" ? det.corpo.field_values : {};
        }
        await espera(100);
      }
      const produto = itens[0]?.nome || (typeof campos["produto-vendido"] === "string" ? campos["produto-vendido"] : null) || salvo.get(d.id)?.produto || null;
      // quem vendeu: o vendedor da conversa no sistema; sem ele (ex.: Comercial inbound), o closer e depois o SDR do CRM
      const daConversa = o.chats.get(d.chat_id) ?? null;
      const peloCampo = [campos.closer, campos.sdr].map((n) => porPrimeiroNome(n)).find((l) => l.length === 1)?.[0]?.id ?? null;
      linhas.push({
        deal_id: d.id, org_id: org.id, chat_id: d.chat_id || null, contato_crm_id: contato,
        telefone: o.telefone, cliente: o.nome, status: d.status || null, valor_cents: d.value_cents ?? null,
        aberto_em: d.opened_at || null, ganho_em: d.won_at || null, dono_crm_id: d.owner_user_id || null,
        vendedor_id: daConversa || peloCampo, sdr: typeof campos.sdr === "string" ? campos.sdr : null, closer: typeof campos.closer === "string" ? campos.closer : null,
        produto, tipo: tipoDe(produto), produtos: itens, campos: { ...campos, instancia: d.instance_name ?? campos.instancia ?? null }, sincronizado_em: new Date().toISOString(),
      });
    }
    if (linhas.length) { const { error } = await sb.from("crm_vendas").upsert(linhas); if (!error) gravados += linhas.length; }
    await sb.from("crm_contatos_lidos").upsert({ contato_crm_id: contato, org_id: org.id, lido_em: new Date().toISOString() });
    await espera(100);
  }
  return { empresa: org.slug, produtos: produtos.length, contatos: contatos.size, na_fila: fila.length, lidos, gravados };
}

Deno.serve(async (req) => {
  const { data: tk } = await sb.from("crm_sync_token").select("token").eq("id", 1).single();
  if (!tk || req.headers.get("x-crm-sync-token") !== tk.token) return json({ erro: "nao autorizado" }, 401);
  const ate = Date.now() + LIMITE_MS;
  const { data: orgs } = await sb.from("organizacoes").select("id,slug,crm_segredo").not("crm_segredo", "is", null).order("criado_em");
  const out = [];
  for (const o of orgs ?? []) {
    try { out.push(await importarEmpresa(o as any, ate)); }
    catch (e) { console.error(`[crm-vendas] ${o.slug}:`, (e as Error).message.slice(0, 120)); out.push({ empresa: o.slug, erro: "falhou" }); }
  }
  console.log("[crm-vendas]", JSON.stringify(out));
  return json({ ok: true, resultado: out });
});

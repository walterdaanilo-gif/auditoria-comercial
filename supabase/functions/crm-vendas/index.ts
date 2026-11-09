// Edge Function "crm-vendas": importa do CRM Q5 os negocios (vendas) com os produtos, de cada empresa que tem chave do CRM.
// O Q5 nao tem lista geral de negocios: o negocio e lido por conversa (/conversations/{id}/deal) e o catalogo em /products.
// Precisa das permissoes deals:read e products:read na chave. Chamada pelo pg_cron (a cada 15 min) com x-crm-sync-token.
// Dados pessoais: nunca escrever nome, telefone ou valores em log.
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const API = "https://api.grupoquatro5.com/public/v1";
const LIMITE_MS = 110_000, POR_RODADA = 250, REVER_HORAS = 6;
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Tipo do produto pelo nome (o painel separa as vendas por tipo)
export function tipoDe(nome: string | null | undefined): string {
  const n = String(nome ?? "").toLowerCase();
  if (/imers/.test(n)) return "imersao";
  if (/in.?company/.test(n)) return "incompany";
  if (/workshop/.test(n)) return "workshop";
  if (/plataforma|start/.test(n)) return "plataforma";
  return n ? "outro" : "";
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

  // 2) negocios: conversas do CRM com negocio, primeiro as nunca lidas e as que mudaram desde a ultima leitura
  const { data: convs } = await sb.from("crm_conversas").select("id,telefone,contato_nome,vendedor_id,raw").eq("org_id", org.id).not("raw->deal", "is", null).limit(5000);
  const { data: lidas } = await sb.from("crm_vendas").select("chat_id,sincronizado_em").eq("org_id", org.id).limit(10000);
  const ultima = new Map((lidas ?? []).map((l) => [l.chat_id, Date.parse(l.sincronizado_em)]));
  const rever = Date.now() - REVER_HORAS * 3600_000;
  const fila = (convs ?? []).filter((c: any) => c.raw?.deal && typeof c.raw.deal === "object")
    .map((c: any) => ({ c, lida: ultima.get(c.id) ?? 0, mudou: Date.parse(c.raw?.updatedAt || 0) }))
    .filter((x) => !x.lida || x.mudou > x.lida || x.lida < rever)
    .sort((a, b) => a.lida - b.lida)
    .slice(0, POR_RODADA);

  let lidos = 0, gravados = 0;
  for (const { c } of fila) {
    if (Date.now() > ate) break;
    const r = await q5(`/conversations/${c.id}/deal`, chave);
    lidos++;
    if (r.status === 403) return { empresa: org.slug, erro: "chave sem deals:read", lidos };
    const d = r.corpo;
    if (r.status !== 200 || !d?.id) continue;
    const itens = (Array.isArray(d.products) ? d.products : []).map((p: any) => ({ produto_id: p.product_id, nome: p.name, quantidade: p.quantity, total_cents: p.total_cents }));
    const campos = d.field_values && typeof d.field_values === "object" ? d.field_values : {};
    const produto = itens[0]?.nome || campos["produto-vendido"] || null;
    const { error } = await sb.from("crm_vendas").upsert({
      deal_id: d.id, org_id: org.id, chat_id: d.chat_id || c.id, contato_crm_id: d.contact_id || null,
      telefone: c.telefone || null, cliente: c.contato_nome || c.raw?.contact?.name || null,
      status: d.status || null, valor_cents: d.value_cents ?? null, aberto_em: d.opened_at || null, ganho_em: d.won_at || null,
      dono_crm_id: d.owner_user_id || null, vendedor_id: c.vendedor_id || null,
      sdr: typeof campos.sdr === "string" ? campos.sdr : null, closer: typeof campos.closer === "string" ? campos.closer : null,
      produto, tipo: tipoDe(produto), produtos: itens, campos, sincronizado_em: new Date().toISOString(),
    });
    if (!error) gravados++;
    await espera(120);
  }
  return { empresa: org.slug, produtos: produtos.length, na_fila: fila.length, lidos, gravados };
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

// Edge Function "crm-vendas": vendas do CRM Q5 (negocios + produtos) quase em tempo real, por empresa que tem chave do CRM.
//
// Como as vendas chegam:
//  Venda = produto num negocio GANHO ou ABERTO, de qualquer funil (Vendas, Pos-vendas, Plataforma, Workshop...). Perdido nao conta.
//  1) Aviso do CRM (webhook conversation.updated, so quando o campo status muda = cartao mudou de etapa):
//     POST ?k=<segredo>&org=<slug>. Conversa em etapa de ganho, com negocio de valor ou que ja tinha venda: le o cliente na hora.
//  2) Rede de seguranca a cada 3 min (pg_cron, header x-crm-sync-token): varre TODAS as conversas (status=all, inclusive as
//     encerradas) e compara etapa, situacao e valor do negocio com o que esta guardado. Venda nova, valor mudado ou venda
//     desfeita: le o cliente na hora. A lista vem ordenada pela ultima MENSAGEM, nao pela ultima mudanca, entao nao da para
//     olhar so as primeiras paginas.
//  3) Venda ganha relida a cada 20 min na primeira semana e depois a cada 24 h (valor e produtos sao corrigidos depois).
//
// O negocio do cliente vem de /contacts/{id}/deals (todas as instancias); o detalhe (produtos e campos) so existe em
// /conversations/{chat}/deal e so para o negocio atual daquela conversa.
// Administracao (header x-crm-sync-token): ?acao=assinar | webhooks | remover&id=<webhook>   (org=<slug>, padrao weevo)
// Dados pessoais: nunca escrever nome, telefone ou valores em log.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SITE = Deno.env.get("SUPABASE_URL")!;
const sb = createClient(SITE, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const API = "https://api.grupoquatro5.com/public/v1";
const LIMITE_MS = 120_000, REVER_GANHO_H = 24, MAX_FILA = 150;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const primeiro = (n: unknown) => String(n ?? "").trim().split(/\s+/)[0]?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() || "";
const digitos = (t: unknown) => String(t ?? "").replace(/\D/g, "") || null;

// Tipo do produto pelo nome (o painel separa as vendas por tipo)
export function tipoDe(nome: string | null | undefined): string {
  const n = String(nome ?? "").toLowerCase();
  if (/imers/.test(n)) return "imersao";
  if (/in.?company/.test(n)) return "incompany";
  if (/workshop/.test(n)) return "workshop";
  if (/plataforma|start/.test(n)) return "plataforma";
  return n ? "outro" : "";
}

// Le todas as linhas da empresa (o Supabase devolve no maximo 1000 por consulta)
async function todas(tabela: string, colunas: string, org: string, ordem: string): Promise<any[]> {
  const out: any[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb.from(tabela).select(colunas).eq("org_id", org).order(ordem).range(de, de + 999);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}

async function q5(caminho: string, chave: string, init: { method?: string; corpo?: unknown } = {}) {
  for (let t = 0; t < 3; t++) {
    const r = await fetch(API + caminho, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${chave}`, Accept: "application/json", ...(init.corpo ? { "Content-Type": "application/json" } : {}) },
      body: init.corpo ? JSON.stringify(init.corpo) : undefined,
    });
    if (r.status === 429) { await espera(3000); continue; }
    const corpo = await r.json().catch(() => null);
    return { status: r.status, corpo };
  }
  return { status: 429, corpo: null };
}

type Org = { id: string; slug: string; crm_segredo: string };
type Info = { telefone: string | null; nome: string | null; chats: Map<string, string | null> };
type Ctx = { org: Org; chave: string; perfis: { id: string; nome: string }[]; salvo: Map<string, any>; rever: number };

// Conversa em etapa de ganho (ex.: custom_vendas_2_ganho) ou com negocio ganho (conversa encerrada perde a etapa, o negocio fica)
const ganhoNaLista = (c: any) => c?.deal?.status === "won" || /_ganho$/.test(String(c?.status ?? ""));

// ---------- leitura de um cliente: todos os negocios dele, de qualquer instancia ----------
async function lerContato(ctx: Ctx, contato: string, info: Info, assinatura?: string): Promise<{ ok: boolean; gravados: number; removidos: number; erro?: string }> {
  const { org, chave, salvo, rever, perfis } = ctx;
  const r = await q5(`/contacts/${contato}/deals`, chave);
  if (r.status === 403) return { ok: false, gravados: 0, removidos: 0, erro: "chave sem deals:read" };
  if (r.status !== 200) return { ok: false, gravados: 0, removidos: 0 };
  const porPrimeiroNome = (n: unknown) => { const k = primeiro(n); return k ? perfis.filter((p) => primeiro(p.nome) === k) : []; };
  const dealsDoCrm = (r.corpo?.data ?? []) as any[];
  const linhas: any[] = [];
  for (const d of dealsDoCrm) {
    const ant = salvo.get(d.id);
    let itens = ant?.produtos ?? [], campos = ant?.campos ?? {};
    // detalhe (produtos e campos): so o negocio atual da conversa; o antigo mantem o que ja tinhamos
    if (d.status !== "lost" && d.chat_id && (!itens.length || d.status === "open" || Date.parse(d.closed_at || d.won_at || 0) > rever)) {
      const det = await q5(`/conversations/${d.chat_id}/deal`, chave);
      if (det.status === 200 && det.corpo?.id === d.id) {
        const antes = [...((ant?.produtos ?? []) as any[])], agoraIso = new Date().toISOString();
        itens = (Array.isArray(det.corpo.products) ? det.corpo.products : []).map((p: any) => {
          const i = antes.findIndex((x) => (x.produto_id ?? x.nome) === (p.product_id ?? p.name));
          const velho = i >= 0 ? antes.splice(i, 1)[0] : null;
          // produto acrescentado num negocio que ja tinha produtos: o dia em que apareceu (negocio novo para nos: vale a data do CRM)
          // (a data preenchida no CRM, quando existe, vale mais: web/src/lib/resultados.ts, diaDaVenda)
          return { produto_id: p.product_id, nome: p.name, quantidade: p.quantity, total_cents: p.total_cents, visto_em: velho ? velho.visto_em ?? null : (ant?.produtos ?? []).length ? agoraIso : null };
        });
        campos = det.corpo.field_values && typeof det.corpo.field_values === "object" ? det.corpo.field_values : {};
      }
      await espera(80);
    }
    const produto = itens[0]?.nome || (typeof campos["produto-vendido"] === "string" ? campos["produto-vendido"] : null) || ant?.produto || null;
    // quem vendeu: o vendedor da conversa no sistema; sem ele (ex.: Comercial inbound), o closer e depois o SDR do CRM
    const daConversa = info.chats.get(d.chat_id) ?? null;
    const peloCampo = [campos.closer, campos.sdr].map((n) => porPrimeiroNome(n)).find((l) => l.length === 1)?.[0]?.id ?? null;
    linhas.push({
      deal_id: d.id, org_id: org.id, chat_id: d.chat_id || null, contato_crm_id: contato,
      telefone: info.telefone ?? ant?.telefone ?? null, cliente: info.nome ?? ant?.cliente ?? null, status: d.status || null, valor_cents: d.value_cents ?? null,
      aberto_em: d.opened_at || null, ganho_em: d.won_at || (d.status === "won" ? d.closed_at || d.opened_at : null) || null, dono_crm_id: d.owner_user_id || null,
      vendedor_id: daConversa || peloCampo, sdr: typeof campos.sdr === "string" ? campos.sdr : null, closer: typeof campos.closer === "string" ? campos.closer : null,
      produto, tipo: tipoDe(produto), produtos: itens, campos: { ...campos, instancia: d.instance_name ?? campos.instancia ?? null }, sincronizado_em: new Date().toISOString(),
    });
  }
  let gravados = 0, removidos = 0;
  if (linhas.length) { const { error } = await sb.from("crm_vendas").upsert(linhas); if (!error) gravados = linhas.length; }
  // negocio que sumiu do CRM (apagado ou unido) deixa de contar
  const vistos = new Set(dealsDoCrm.map((d) => d.id));
  const sumiram = [...salvo.values()].filter((s) => s.contato_crm_id === contato && !vistos.has(s.deal_id) && s.status !== "removido").map((s) => s.deal_id);
  if (sumiram.length) { await sb.from("crm_vendas").update({ status: "removido", sincronizado_em: new Date().toISOString() }).in("deal_id", sumiram); removidos = sumiram.length; }
  await sb.from("crm_contatos_lidos").upsert({ contato_crm_id: contato, org_id: org.id, lido_em: new Date().toISOString(), ...(assinatura !== undefined ? { assinatura } : {}) });
  return { ok: true, gravados, removidos };
}

const perfisDaEmpresa = async (org: Org) => ((await sb.from("profiles").select("id,nome").eq("org_id", org.id).eq("ativo", true).limit(500)).data ?? []) as { id: string; nome: string }[];

// ---------- rede de seguranca: varre todas as conversas e le so o que mudou ----------
async function varrerEmpresa(org: Org, ate: number) {
  const chave = Deno.env.get(org.crm_segredo) || "";
  if (!chave) return { empresa: org.slug, erro: "sem chave" };

  // catalogo de produtos
  const pr = await q5("/products?limit=100", chave);
  if (pr.status === 403) return { empresa: org.slug, erro: "chave sem products:read/deals:read" };
  const produtos = (pr.corpo?.data ?? []) as any[];
  if (produtos.length) await sb.from("crm_produtos").upsert(produtos.map((p) => ({ id: p.id, org_id: org.id, nome: p.name, codigo: p.code, preco_cents: p.price_cents, ativo: p.active, tipo: tipoDe(p.name), sincronizado_em: new Date().toISOString() })));

  const [perfis, lidas, contatosLidos, convsSis] = await Promise.all([
    perfisDaEmpresa(org),
    todas("crm_vendas", "deal_id,chat_id,contato_crm_id,telefone,cliente,status,valor_cents,ganho_em,produto,produtos,campos,sincronizado_em", org.id, "deal_id"),
    todas("crm_contatos_lidos", "contato_crm_id,lido_em,assinatura", org.id, "contato_crm_id"),
    todas("crm_conversas", "id,telefone,contato_nome,vendedor_id,contato:raw->contact->>id", org.id, "id"),
  ]);
  const salvo = new Map<string, any>(lidas.map((l: any) => [l.deal_id, l]));
  const porChat = new Map<string, any[]>();
  for (const l of lidas) if (l.chat_id) porChat.set(l.chat_id, [...(porChat.get(l.chat_id) ?? []), l]);
  const lidoEm = new Map<string, number>(contatosLidos.map((l: any) => [l.contato_crm_id, Date.parse(l.lido_em)]));
  // estados da conversa que ja geraram releitura do cliente (id|etapa|negocio|valor): o mesmo estado nao relê de novo
  const assinaturas = new Map<string, Set<string>>(contatosLidos.map((l: any) => [l.contato_crm_id, new Set(String(l.assinatura ?? "").split(";").filter(Boolean))]));
  const contatos = new Map<string, Info>();
  for (const c of convsSis) {
    if (!c.contato) continue;
    const o = contatos.get(c.contato) ?? { telefone: null, nome: null, chats: new Map() };
    o.telefone ||= digitos(c.telefone); o.nome ||= c.contato_nome || null;
    o.chats.set(c.id, c.vendedor_id);
    contatos.set(c.contato, o);
  }

  // todas as conversas do CRM (status=all inclui as encerradas, onde ficam muitas vendas)
  const fila = new Map<string, { motivo: string; sigs: Set<string> }>();
  const marcar = (id: string, motivo: string, sig: string) => {
    if (assinaturas.get(id)?.has(sig)) return;
    const f = fila.get(id) ?? { motivo, sigs: new Set<string>() };
    f.sigs.add(sig); fila.set(id, f);
  };
  let chats = 0, paginas = 0;
  for (let pagina = 1; pagina <= 60 && Date.now() < ate - 45_000; pagina++) {
    const r = await q5(`/conversations?status=all&limit=100&page=${pagina}`, chave);
    if (r.status !== 200) break;
    const lista = (r.corpo?.data ?? []) as any[];
    paginas = pagina;
    for (const c of lista) {
      chats++;
      const id = c?.contact?.id;
      if (!id) continue;
      const o = contatos.get(id) ?? { telefone: null, nome: null, chats: new Map() };
      o.telefone ||= digitos(c.contact.phoneE164); o.nome ||= c.contact.name || null;
      if (!o.chats.has(c.id)) o.chats.set(c.id, null);
      contatos.set(id, o);
      const guardados = porChat.get(c.id) ?? [];
      const valorNaLista = c.deal?.valueCents ?? null;
      const sig = `${c.id}|${c.status}|${c.deal?.status ?? ""}|${valorNaLista ?? ""}`;
      if (ganhoNaLista(c)) {
        if (!guardados.some((g) => g.status === "won" && (g.valor_cents ?? null) === valorNaLista)) marcar(id, "venda nova ou valor mudou", sig);
      } else if (c.deal && c.deal.status !== "lost" && (valorNaLista ?? 0) > 0) {
        // negocio aberto com produto (pos-venda, plataforma, workshop...): produto acrescentado conta como venda
        if (!guardados.some((g) => g.status === (c.deal.status ?? null) && (g.valor_cents ?? null) === valorNaLista)) marcar(id, "produto no negocio mudou", sig);
      } else if (guardados.some((g) => g.status === "won") && !guardados.some((g) => g.status === (c.deal?.status ?? null) && (g.valor_cents ?? null) === valorNaLista)) marcar(id, "venda desfeita", sig);
    }
    if (lista.length < 100) break;
    await espera(60);
  }
  // venda ganha recente sem produtos (o produto e preenchido depois de mover o cartao) e vendas ganhas ha mais de 24 h
  const agora = Date.now();
  const porContato = new Map<string, any[]>();
  for (const l of lidas) if (l.contato_crm_id) porContato.set(l.contato_crm_id, [...(porContato.get(l.contato_crm_id) ?? []), l]);
  for (const [id, ds] of porContato) {
    const ganhos = ds.filter((d: any) => d.status === "won");
    if (!ganhos.length || fila.has(id)) continue;
    const recenteSemProduto = ganhos.some((d: any) => Date.parse(d.ganho_em || 0) > agora - 2 * 86400_000 && !(d.produtos ?? []).length && Date.parse(d.sincronizado_em || 0) < agora - 150_000);
    // venda ganha nos ultimos 7 dias: relida a cada 20 min (o time corrige valor e produto depois de fechar, sem mudar a etapa,
    // e a conversa pode estar mostrando outro negocio do cliente); as mais antigas, 1 vez por dia
    const recente = ganhos.some((d: any) => Date.parse(d.ganho_em || 0) > agora - 7 * 86400_000);
    const velho = (lidoEm.get(id) ?? 0) < agora - (recente ? 20 * 60_000 : REVER_GANHO_H * 3600_000);
    if (recenteSemProduto) fila.set(id, { motivo: "venda recente sem produto", sigs: new Set() }); else if (velho) fila.set(id, { motivo: recente ? "venda recente (confere valor)" : "releitura diaria", sigs: new Set() });
  }

  const ctx: Ctx = { org, chave, perfis, salvo, rever: agora - 6 * 3600_000 };
  let lidos = 0, gravados = 0, removidos = 0, falhas = 0;
  const motivos: Record<string, number> = {};
  for (const [contato, f] of [...fila].slice(0, MAX_FILA)) {
    if (Date.now() > ate) break;
    const assin = f.sigs.size ? [...new Set([...(assinaturas.get(contato) ?? []), ...f.sigs])].slice(-30).join(";") : undefined;
    const res = await lerContato(ctx, contato, contatos.get(contato) ?? { telefone: null, nome: null, chats: new Map() }, assin);
    const motivo = f.motivo;
    lidos++; gravados += res.gravados; removidos += res.removidos;
    if (!res.ok) { falhas++; if (res.erro) return { empresa: org.slug, erro: res.erro, lidos }; }
    motivos[motivo] = (motivos[motivo] || 0) + 1;
    await espera(80);
  }
  return { empresa: org.slug, produtos: produtos.length, conversas_no_crm: chats, paginas, na_fila: fila.size, lidos, gravados, removidos, falhas, motivos };
}

// ---------- aviso do CRM: um cartao mudou de etapa ----------
async function tratarEvento(org: Org, corpo: any) {
  const chave = Deno.env.get(org.crm_segredo) || "";
  const evento = String(corpo?.event ?? corpo?.type ?? corpo?.eventType ?? corpo?.name ?? "").slice(0, 60);
  const registrar = (chat: string | null, acao: string) => sb.from("crm_eventos").insert({ org: org.slug, evento, chaves: Object.keys(corpo ?? {}).slice(0, 20), chat_id: chat, acao });
  if (!chave || !corpo || typeof corpo !== "object") { await registrar(null, "sem_corpo_ou_chave"); return; }

  // candidatos a id da conversa: primeiro as chaves que falam de chat/conversa, depois qualquer id
  const prioritarios = new Set<string>(), outros = new Set<string>();
  const coletar = (v: any, k = "", nivel = 0) => {
    if (v == null || nivel > 5) return;
    if (typeof v === "string") { if (UUID.test(v)) (/chat|conversation|conversa/i.test(k) ? prioritarios : outros).add(v); return; }
    if (Array.isArray(v)) { v.slice(0, 5).forEach((x) => coletar(x, k, nivel + 1)); return; }
    if (typeof v === "object") for (const [kk, x] of Object.entries(v)) coletar(x, kk, nivel + 1);
  };
  coletar(corpo);
  let chat: any = null;
  for (const id of [...prioritarios, ...outros].slice(0, 5)) {
    const r = await q5(`/conversations/${id}`, chave);
    if (r.status === 200 && r.corpo?.contact?.id) { chat = r.corpo; break; }
  }
  if (!chat) { await registrar(null, "conversa_nao_achada"); return; }

  const contato = chat.contact.id as string;
  const salvos = ((await sb.from("crm_vendas").select("deal_id,chat_id,contato_crm_id,telefone,cliente,status,valor_cents,produto,produtos,campos").eq("org_id", org.id).eq("contato_crm_id", contato)).data ?? []) as any[];
  const tinhaGanho = salvos.some((s) => s.chat_id === chat.id && s.status === "won");
  const comValor = chat.deal && chat.deal.status !== "lost" && (chat.deal.valueCents ?? 0) > 0;
  if (!ganhoNaLista(chat) && !tinhaGanho && !comValor && !salvos.some((s) => s.chat_id === chat.id && (s.produtos ?? []).length)) { await registrar(chat.id, "ignorado_sem_venda"); return; }

  const chatsSis = ((await sb.from("crm_conversas").select("id,vendedor_id,telefone,contato_nome").eq("org_id", org.id).eq("raw->contact->>id", contato)).data ?? []) as any[];
  const info: Info = { telefone: digitos(chat.contact.phoneE164) ?? digitos(chatsSis[0]?.telefone), nome: chat.contact.name ?? chatsSis[0]?.contato_nome ?? null, chats: new Map(chatsSis.map((x) => [x.id, x.vendedor_id])) };
  info.chats.set(chat.id, info.chats.get(chat.id) ?? null);
  const res = await lerContato({ org, chave, perfis: await perfisDaEmpresa(org), salvo: new Map(salvos.map((s) => [s.deal_id, s])), rever: Date.now() - 6 * 3600_000 }, contato, info);
  await registrar(chat.id, res.ok ? (ganhoNaLista(chat) ? "venda_lida" : "venda_desfeita_lida") : "falha_na_leitura");
}

const orgPorSlug = async (slug: string) => ((await sb.from("organizacoes").select("id,slug,crm_segredo").eq("slug", slug).not("crm_segredo", "is", null).maybeSingle()).data ?? null) as Org | null;
const semSegredos = (w: any) => ({ id: w.id, url: String(w.url ?? "").split("?")[0], events: w.events, fields: w.fields, ativo: w.active, falhas_seguidas: w.consecutive_failures, ultimo_sucesso: w.last_success_at, ultima_falha: w.last_failure_at, motivo_da_falha: String(w.last_failure_reason ?? "").slice(0, 120), desativado_em: w.disabled_at, criado_em: w.created_at });

Deno.serve(async (req) => {
  const u = new URL(req.url);

  // 1) aviso do CRM (webhook): ?k=<segredo>&org=<slug>. Responde logo e le o cliente em seguida.
  if (u.searchParams.has("k")) {
    const { data: sg } = await sb.from("crm_webhook_segredo").select("token").eq("id", 1).maybeSingle();
    if (!sg?.token || u.searchParams.get("k") !== sg.token) return json({ erro: "nao autorizado" }, 401);
    const corpo = await req.json().catch(() => null);
    const trabalho = (async () => {
      try { const org = await orgPorSlug(u.searchParams.get("org") || "weevo"); if (org) await tratarEvento(org, corpo); }
      catch (e) { console.error("[crm-vendas] evento:", String((e as Error).message).slice(0, 120)); }
    })();
    const er = (globalThis as any).EdgeRuntime;
    if (er?.waitUntil) er.waitUntil(trabalho); else await trabalho;
    return json({ ok: true });
  }

  // 2) relogio (pg_cron) e administracao
  const { data: tk } = await sb.from("crm_sync_token").select("token").eq("id", 1).single();
  if (!tk || req.headers.get("x-crm-sync-token") !== tk.token) return json({ erro: "nao autorizado" }, 401);

  const acao = u.searchParams.get("acao");
  if (acao) {
    const org = await orgPorSlug(u.searchParams.get("org") || "weevo");
    const chave = org ? Deno.env.get(org.crm_segredo) || "" : "";
    if (!org || !chave) return json({ erro: "empresa sem chave do CRM" }, 400);
    const lista = await q5("/webhooks", chave);
    if (lista.status !== 200) return json({ erro: "o CRM recusou listar webhooks (permissao webhooks:manage)", status: lista.status }, 502);
    const nossos = ((lista.corpo ?? []) as any[]).filter((w) => String(w.url ?? "").startsWith(`${SITE}/functions/v1/crm-vendas`));
    if (acao === "webhooks") return json({ webhooks: ((lista.corpo ?? []) as any[]).map(semSegredos), eventos_recentes: (await sb.from("crm_eventos").select("recebido_em,evento,chaves,acao").order("recebido_em", { ascending: false }).limit(10)).data });
    if (acao === "assinar") {
      if (nossos.length) return json({ ja_existe: true, webhook: semSegredos(nossos[0]) });
      const { data: sg } = await sb.from("crm_webhook_segredo").select("token").eq("id", 1).single();
      const r = await q5("/webhooks", chave, { method: "POST", corpo: { url: `${SITE}/functions/v1/crm-vendas?k=${sg!.token}&org=${org.slug}`, events: ["conversation.updated"], fields: ["status"] } });
      return json({ status: r.status, webhook: r.status < 300 ? semSegredos(r.corpo) : undefined, erro: r.status >= 300 ? r.corpo : undefined }, r.status < 300 ? 200 : 502);
    }
    if (acao === "remover") {
      const id = u.searchParams.get("id");
      if (!id || !nossos.some((w) => w.id === id)) return json({ erro: "so removo webhook que aponta para esta funcao" }, 400); // nunca mexe no da Q5 (gestao)
      const r = await q5(`/webhooks/${id}`, chave, { method: "DELETE" });
      return json({ status: r.status });
    }
    return json({ erro: "acao desconhecida" }, 400);
  }

  // relogio: varre e le o que mudou (uma rodada por vez)
  if (!(await sb.rpc("pegar_vez", { p_nome: "crm-vendas", p_segundos: 170 })).data) return json({ ok: true, pulou: "ja esta rodando" });
  try {
    const ate = Date.now() + LIMITE_MS;
    const { data: orgs } = await sb.from("organizacoes").select("id,slug,crm_segredo").not("crm_segredo", "is", null).order("criado_em");
    const out = [];
    for (const o of orgs ?? []) {
      try { out.push(await varrerEmpresa(o as Org, ate)); }
      catch (e) { console.error(`[crm-vendas] ${o.slug}:`, String((e as Error).message).slice(0, 120)); out.push({ empresa: o.slug, erro: "falhou" }); }
    }
    console.log("[crm-vendas]", JSON.stringify(out));
    return json({ ok: true, resultado: out });
  } finally {
    await sb.rpc("soltar_vez", { p_nome: "crm-vendas" });
  }
});

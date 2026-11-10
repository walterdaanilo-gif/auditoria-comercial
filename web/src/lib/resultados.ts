import type { SupabaseClient } from "@supabase/supabase-js";
import { telefone, um } from "@/lib/format";

// Resultados (vendas). Fonte unica das vendas em dinheiro: a aba Resultados e o faturamento da TV leem daqui.
// = vendas ganhas no CRM Q5 (tabela crm_vendas, com o produto do CRM)
// + vendas que a IA detectou nas conversas (tabela auditorias), com os ajustes feitos na aba Resultados,
// + vendas lancadas a mao (tabela resultados_vendas).
// Cruzamento sem duplicar (cada venda conta uma vez):
// A chave e o NUMERO do contato (DDD + 8 digitos, ignora 55 e o 9 extra):
// - venda da conversa com o mesmo numero de uma venda do CRM, ate 45 dias, qualquer produto: vale so a do CRM
// - o mesmo numero com dois negocios ganhos no CRM do mesmo produto (ou sem produto), ate 30 dias: vale o primeiro
// - a mesma venda detectada pela IA em mais de um dia: vale a primeira
// - venda manual com o mesmo cliente (nome) e produto do CRM, ate 30 dias: vale a do CRM
// - empresa com CRM ligado: venda alta (imersao, plataforma, in-company) que so aparece na conversa fica como
//   "nao lancada no CRM" e nao soma ate ser lancada la. Workshop continua vindo das conversas (o CRM nao lanca workshop).
export const FORMAS: [string, string][] = [["pix", "Pix"], ["cartao", "Cartão"], ["boleto", "Boleto"], ["transferencia", "Transferência"], ["dinheiro", "Dinheiro"], ["outro", "Outro"]];
export const PRODUTOS: [string, string][] = [["workshop", "Workshop"], ["imersao", "Imersão"], ["incompany", "In-company"], ["plataforma", "Plataforma"], ["outro", "Outro"]];
export const rotuloForma = (k: string | null) => FORMAS.find(([v]) => v === k)?.[1] ?? "—";
export const rotuloProduto = (k: string | null) => PRODUTOS.find(([v]) => v === k)?.[1] ?? "—";
export const brlCompleto = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export type Resultado = {
  chave: string;                    // "a:<auditoria>" (IA), "m:<id>" (manual) ou "c:<negocio>" (CRM)
  origem: "ia" | "manual" | "crm";
  id: string | null;                // linha em resultados_vendas (manual, ou ajuste da venda da IA)
  auditoriaId: string | null;
  data: string;                     // dia da venda (YYYY-MM-DD); na venda da IA e o dia da conversa
  vendedorId: string | null;
  cliente: string; empresa: string;
  produto: string | null; forma: string | null;
  valor: number | null;             // null = a IA nao achou o valor e ninguem preencheu ainda
  valorIA: number | null;           // so na venda da IA: o que ela leu
  ajustada: boolean;                // venda da IA com ajuste feito a mao
  excluida: boolean;                // tirada do faturamento
  duplicada: string | null;         // a mesma venda ja esta em outra linha (o motivo); nao soma
  naoLancada: boolean;              // venda alta so na conversa, empresa com CRM ligado: nao soma ate lancar no CRM
  naConversa: boolean;              // venda do CRM que tambem foi vista na conversa
  valorEstimado?: "crm" | "padrao"; // venda da IA sem valor na conversa: valor do negocio do CRM ou o padrao da empresa
  indicadoPor?: string;             // so na venda do CRM: "Indicado por" do negocio (vazio = nao foi indicado ou nao informado)
};

type Ajuste = { id: string; data: string; vendedor_id: string | null; cliente: string | null; empresa: string | null; produto: string | null; forma_pagamento: string | null; valor: number | string | null; auditoria_id: string | null; excluida: boolean };
type Aud = { id: string; vendedor_id: string; venda_tipo: string | null; venda_valor: number | string | null; venda_cupom: boolean; conversas: { id: string; data: string; contato: string | null; contato_nome: string | null; telefone: string | null } | { id: string; data: string; contato: string | null; contato_nome: string | null; telefone: string | null }[] | null };

const num = (x: unknown): number | null => (x == null || x === "" ? null : Number.isFinite(Number(x)) ? Number(x) : null);

// Lista as vendas em dinheiro do periodo (inclui as tiradas do faturamento, marcadas em "excluida") e os convites (cupom R$ 0).
// Se a tabela de resultados ainda nao existe no banco, tabelaOk = false e valem so as vendas da IA.
export async function listarResultados(db: SupabaseClient, org: string, de: string, ate: string): Promise<{ linhas: Resultado[]; convites: string[]; tabelaOk: boolean; erro: string | null }> {
  // janela maior para achar a mesma venda antes ou depois do periodo (e nao contar de novo)
  const deLargo = somaDias(de, -JANELA_CRM);
  const [rAud, rAj, rCrm, rCfg, rPerf, rWs] = await Promise.all([
    db.from("auditorias").select("id,vendedor_id,venda_tipo,venda_valor,venda_cupom,conversas!inner(id,data,canal,contato,contato_nome,telefone)")
      .eq("org_id", org).eq("venda", true).neq("conversas.canal", "importada").gte("conversas.data", deLargo).lte("conversas.data", ate).limit(5000),
    db.from("resultados_vendas").select("*").eq("org_id", org).gte("data", de).lte("data", ate).limit(5000),
    // todos os negocios ganhos (de qualquer data): o negocio novo do CRM repete os produtos que o cliente ja comprou antes
    db.from("crm_vendas").select("deal_id,contato_crm_id,telefone,cliente,valor_cents,aberto_em,ganho_em,vendedor_id,produto,tipo,produtos,campos").eq("org_id", org).eq("status", "won").limit(5000),
    // quem leva as vendas de workshop (Configuracoes; na Weevo, o Ruan)
    db.from("audit_settings").select("vendedor_workshop,workshop_valor_padrao").eq("org_id", org).maybeSingle(),
    db.from("profiles").select("id,nome,org_id,ativo").limit(1000),
    // negocios de valor de workshop (ate R$ 1.000, qualquer situacao menos perdido): o valor que o cliente pagou, quando a conversa nao diz
    db.from("crm_vendas").select("telefone,valor_cents,aberto_em").eq("org_id", org).neq("status", "lost").gt("valor_cents", 0).lte("valor_cents", 100000).limit(5000),
  ]);
  const tabelaOk = !rAj.error;
  const ajustes = (tabelaOk ? rAj.data ?? [] : []) as Ajuste[];
  const porAud = new Map(ajustes.filter((a) => a.auditoria_id).map((a) => [a.auditoria_id as string, a]));
  const linhas: Resultado[] = [], convites: string[] = [];

  for (const a of (rAud.data ?? []) as unknown as Aud[]) {
    const c = um(a.conversas);
    if (!c) continue;
    if (a.venda_cupom && a.venda_tipo !== "imersao") { convites.push(a.vendedor_id); continue; } // convite (R$ 0): nao e venda em dinheiro
    const aj = porAud.get(a.id);
    const ia = num(a.venda_valor);
    const quem = c.contato_nome?.trim() || ((c.telefone || c.contato) ? telefone(c.telefone || c.contato || "") : "");
    linhas.push({
      chave: `a:${a.id}`, origem: "ia", id: aj?.id ?? null, auditoriaId: a.id, data: c.data, vendedorId: a.vendedor_id,
      cliente: aj?.cliente?.trim() || quem, empresa: aj?.empresa?.trim() || "",
      produto: a.venda_tipo === "imersao" ? "imersao" : "workshop", forma: aj?.forma_pagamento ?? null,
      valor: num(aj?.valor) ?? ia, valorIA: ia, ajustada: !!aj && !aj.excluida && (aj.cliente != null || aj.empresa != null || aj.forma_pagamento != null || aj.valor != null) , excluida: !!aj?.excluida,
      duplicada: null, naoLancada: false, naConversa: false, fone: chaveFone(c.telefone || c.contato),
    } as Resultado & { fone: string });
  }
  for (const m of ajustes.filter((x) => !x.auditoria_id)) {
    linhas.push({ chave: `m:${m.id}`, origem: "manual", id: m.id, auditoriaId: null, data: m.data, vendedorId: m.vendedor_id, cliente: m.cliente?.trim() ?? "", empresa: m.empresa?.trim() ?? "", produto: m.produto, forma: m.forma_pagamento, valor: num(m.valor), valorIA: null, ajustada: false, excluida: !!m.excluida, duplicada: null, naoLancada: false, naConversa: false });
  }
  // venda alta (Imersao, Plataforma, In-Company) e do closer do negocio no CRM (pelo primeiro nome, so se for um so)
  const perfis = ((rPerf.error ? [] : rPerf.data ?? []) as { id: string; nome: string; org_id: string | null; ativo: boolean }[]).filter((p) => p.org_id === org);
  const primeiro = (n: unknown) => String(n ?? "").trim().split(/\s+/)[0]?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() || "";
  const closerDe = (campos: Record<string, unknown> | null) => {
    const k = primeiro(campos?.closer);
    const achados = k ? perfis.filter((p) => primeiro(p.nome) === k) : [];
    return achados.length === 1 ? achados[0].id : null;
  };
  // cada negocio ganho vira uma linha por PRODUTO NOVO (o que o cliente ainda nao tinha comprado num negocio anterior)
  const todasCrm = produtosNovosCrm(((rCrm.error ? [] : rCrm.data ?? []) as Crm[]).map((v) => ({ ...v, dia: diaBR(v.ganho_em), fone: chaveFone(v.telefone), tipo: v.tipo || "outro" })));
  cruzar(linhas as (Resultado & { fone?: string })[], todasCrm.filter((v) => !v.repetidaDe));
  // so o periodo pedido (o resto foi buscado so para o cruzamento); o negocio que so repete produtos aparece riscado, sem somar
  for (const v of todasCrm.filter((x) => x.dia >= de && x.dia <= ate)) {
    linhas.push({
      chave: `c:${v.deal_id}`, origem: "crm", id: null, auditoriaId: null, data: v.dia, vendedorId: (ALTOS.includes(v.tipo) ? closerDe(v.campos) : null) ?? v.vendedor_id ?? v.vendedorConversa ?? null,
      cliente: v.cliente?.trim() ?? "", empresa: typeof v.campos?.["nome-da-empresa"] === "string" ? v.campos["nome-da-empresa"] : "",
      produto: PRODUTOS.some(([k]) => k === v.tipo) ? v.tipo : "outro", forma: null, valor: v.valor_cents != null ? v.valor_cents / 100 : null,
      valorIA: null, ajustada: false, excluida: false, duplicada: v.repetidaDe ? "produtos já contados em outro negócio do cliente" : null, naoLancada: false, naConversa: !!v.vista,
      indicadoPor: indicadorDoCrm(v.campos),
    });
  }
  const cfg = (rCfg.error ? null : rCfg.data) as { vendedor_workshop: string | null; workshop_valor_padrao?: number | string | null } | null;
  const doWorkshop = cfg?.vendedor_workshop ?? null;
  // inscricao de workshop sem valor na conversa (a IA le R$ 0 ou nada): vale o que o cliente pagou no CRM; sem isso, o valor padrao da empresa
  const padrao = num(cfg?.workshop_valor_padrao);
  const pagoNoCrm = new Map<string, { v: number; ab: string }>();
  for (const n of (rWs.error ? [] : rWs.data ?? []) as { telefone: string | null; valor_cents: number; aberto_em: string | null }[]) {
    const k = chaveFone(n.telefone); if (!k) continue;
    const ab = n.aberto_em ?? "";
    if (!pagoNoCrm.has(k) || ab > pagoNoCrm.get(k)!.ab) pagoNoCrm.set(k, { v: n.valor_cents / 100, ab });
  }
  for (const r of linhas as (Resultado & { fone?: string })[]) {
    if (r.origem !== "ia" || r.produto !== "workshop" || r.ajustada || r.duplicada || r.excluida || (r.valor ?? 0) > 0) continue;
    const doCrm = r.fone ? pagoNoCrm.get(r.fone)?.v : undefined;
    if (doCrm) { r.valor = doCrm; r.valorEstimado = "crm"; } else if (padrao && padrao > 0) { r.valor = padrao; r.valorEstimado = "padrao"; }
  }
  if (doWorkshop) for (const r of linhas) if (r.produto === "workshop") r.vendedorId = doWorkshop;
  const noPeriodo = linhas.filter((r) => r.data >= de && r.data <= ate).map(({ ...r }) => { delete (r as { fone?: string }).fone; return r as Resultado; });
  noPeriodo.sort((x, y) => y.data.localeCompare(x.data) || (y.valor ?? -1) - (x.valor ?? -1));
  return { linhas: noPeriodo, convites, tabelaOk, erro: rAud.error?.message ?? null };
}

// Quem indicou o cliente, pelos campos do negocio no CRM ("Indicado por" ou "Indicação"); "Foi indicado? Não" = ninguem
export function indicadorDoCrm(campos: Record<string, unknown> | null | undefined): string {
  if (!campos || /^n[aã]o$/i.test(String(campos["foi-indicado"] ?? "").trim())) return "";
  const t = (k: string) => (typeof campos[k] === "string" ? (campos[k] as string).trim() : "");
  return t("indicado-por") || t("indicacao");
}

// ---------- cruzamento ----------
type Crm = { deal_id: string; contato_crm_id: string | null; telefone: string | null; cliente: string | null; valor_cents: number | null; aberto_em?: string | null; ganho_em: string; vendedor_id: string | null; produto: string | null; tipo: string | null; produtos?: unknown; campos: Record<string, unknown> | null };
type CrmCruzado = Crm & { dia: string; fone: string; tipo: string; vista?: boolean; vendedorConversa?: string | null; repetidaDe?: string; diaCerto?: boolean };

// Dia da VENDA (nao o dia em que o negocio foi marcado como ganho: o time lanca vendas antigas de uma vez no CRM).
// 1) "Data do diagnostico" do negocio; 2) workshop: o dia em que o negocio foi aberto (quando o link foi mandado);
// 3) aberto ate 7 dias antes do ganho: o dia da abertura; 4) senao, o ganho. O cruzamento com a conversa ainda pode
// antecipar a venda grande sem diagnostico para o dia em que ela apareceu na conversa.
export function diaDaVenda(v: { ganho_em: string; aberto_em?: string | null; campos?: Record<string, unknown> | null }, tipo: string): { dia: string; certo: boolean } {
  const ganho = diaBR(v.ganho_em);
  const diag = typeof v.campos?.["data-do-diagnostico"] === "string" ? (v.campos["data-do-diagnostico"] as string).slice(0, 10) : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(diag) && diag <= ganho) return { dia: diag, certo: true };
  const aberto = v.aberto_em ? diaBR(v.aberto_em) : "";
  if (aberto && aberto <= ganho && (tipo === "workshop" || distDias(aberto, ganho) <= 7)) return { dia: aberto, certo: tipo === "workshop" };
  return { dia: ganho, certo: false };
}

type Item = { produto_id?: string | null; nome?: string | null; quantidade?: number | null; total_cents?: number | null };
// Tipo do produto pelo nome (o mesmo de supabase/functions/crm-vendas)
export function tipoDoProduto(nome: string | null | undefined, valorCents: number | null = null): string {
  const n = String(nome ?? "").toLowerCase();
  if (/imers/.test(n)) return "imersao";
  if (/in.?company/.test(n)) return "incompany";
  if (/workshop/.test(n)) return "workshop";
  if (/plataforma|start/.test(n)) return "plataforma";
  if (n) return "outro";
  return valorCents != null && valorCents > 0 && valorCents <= 100000 ? "workshop" : "outro"; // sem produto: ate R$ 1.000 e workshop
}
const mesmoItem = (a: Item, b: Item) => (a.produto_id ? a.produto_id === b.produto_id : a.nome === b.nome) && (a.total_cents ?? 0) === (b.total_cents ?? 0);
// itens cuja soma e exatamente o valor (para descobrir o que tinha num negocio antigo que veio sem a lista de produtos)
function itensQueSomam(itens: Item[], alvo: number): number[] | null {
  const n = Math.min(itens.length, 12);
  for (let m = 1; m < 1 << n; m++) {
    let t = 0; const idx: number[] = [];
    for (let k = 0; k < n; k++) if (m & (1 << k)) { t += itens[k].total_cents ?? 0; idx.push(k); }
    if (t === alvo) return idx;
  }
  return null;
}

// O negocio do CRM acumula os produtos: o negocio novo de um cliente lista tambem o que ele ja comprou antes
// (ex.: Imersao + Workshop em outubro; em novembro o negocio traz Imersao + Workshop + In-Company). Por cliente
// (contato do CRM, ou numero), em ordem de ganho, so conta o produto que ainda nao foi contado num negocio anterior.
// Negocio antigo sem a lista de produtos (a API so detalha o negocio atual de cada conversa): descobre pelos itens de
// um negocio seguinte que somam exatamente o valor dele. Se nada sobra de novo, o negocio inteiro e repetido.
// Uma linha com quantidade 3 sao 3 vendas: abre em unidades (o centavo que sobra vai para a primeira)
export function abrirUnidades(itens: Item[]): Item[] {
  return itens.flatMap((it) => {
    const q = Math.min(20, Math.max(1, Math.trunc(Number(it.quantidade) || 1)));
    if (q === 1) return [it];
    const total = it.total_cents ?? 0, base = Math.floor(total / q), resto = total - base * q;
    return Array.from({ length: q }, (_, i) => ({ ...it, quantidade: 1, total_cents: base + (i === 0 ? resto : 0) }));
  });
}
export function produtosNovosCrm(lista: CrmCruzado[]): CrmCruzado[] {
  const out: CrmCruzado[] = [];
  const porCliente = new Map<string, CrmCruzado[]>();
  for (const v of lista) { const k = v.contato_crm_id || v.fone || v.deal_id; porCliente.set(k, [...(porCliente.get(k) ?? []), v]); }
  for (const negocios of porCliente.values()) {
    negocios.sort((a, b) => a.ganho_em.localeCompare(b.ganho_em));
    const contados: Item[] = [];                       // itens ja contados deste cliente
    const semLista: { v: CrmCruzado; resolvido: boolean }[] = [];
    // desconto dado no negocio inteiro: o valor do negocio e o que vale, dividido entre os produtos na proporcao do preco
    const fator = (v: CrmCruzado) => {
      const soma = abrirUnidades((Array.isArray(v.produtos) ? v.produtos : []) as Item[]).reduce((t, it) => t + (it.total_cents ?? 0), 0);
      return v.valor_cents != null && soma > 0 && soma !== v.valor_cents ? v.valor_cents / soma : 1;
    };
    const linha = (v: CrmCruzado, it: Item | null, n: number, extra: Partial<CrmCruzado> = {}, dono: CrmCruzado = v): CrmCruzado => {
      const tipo = it ? tipoDoProduto(it.nome) : tipoDoProduto(v.produto, v.valor_cents);
      const { dia, certo } = diaDaVenda(v, tipo);
      return { ...v, deal_id: it ? `${v.deal_id}#${n}` : v.deal_id, produto: it?.nome ?? v.produto, tipo, dia, diaCerto: certo,
        valor_cents: it ? Math.round((it.total_cents ?? 0) * fator(dono)) : v.valor_cents, ...extra };
    };
    for (const v of negocios) {
      const itens = abrirUnidades((Array.isArray(v.produtos) ? v.produtos : []) as Item[]);
      if (!itens.length) { semLista.push({ v, resolvido: false }); continue; }
      // tira o que ja foi contado em negocio anterior
      const resto = [...contados], novos: Item[] = [];
      for (const it of itens) { const i = resto.findIndex((x) => mesmoItem(x, it)); if (i >= 0) resto.splice(i, 1); else novos.push(it); }
      // negocio anterior sem lista: os itens que somam o valor dele eram dele
      for (const p of semLista.filter((x) => !x.resolvido && x.v.valor_cents)) {
        const idx = itensQueSomam(novos, p.v.valor_cents as number);
        if (!idx) continue;
        p.resolvido = true;
        idx.forEach((k, n) => out.push(linha(p.v, novos[k], n, { vendedor_id: p.v.vendedor_id ?? v.vendedor_id }, { ...p.v, produtos: idx.map((x) => novos[x]) })));
        for (const k of [...idx].sort((a, b) => b - a)) { contados.push(novos[k]); novos.splice(k, 1); }
      }
      if (novos.length) novos.forEach((it, n) => out.push(linha(v, it, n)));
      else out.push(linha(v, null, 0, { repetidaDe: "anterior", tipo: tipoDoProduto(itens[0]?.nome) }));
      contados.push(...novos);
    }
    // negocio sem lista que nao foi explicado por nenhum outro: conta pelo valor
    for (const p of semLista.filter((x) => !x.resolvido)) out.push(linha(p.v, null, 0));
  }
  return out;
}
const JANELA = 30; // dias: a mesma venda repetida (no CRM ou na conversa)
const JANELA_CRM = 45; // dias: a venda da conversa que tambem esta no CRM
const ALTOS = ["imersao", "plataforma", "incompany", "outro"];
const somaDias = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const distDias = (a: string, b: string) => Math.abs(Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / 86400_000;
const diaBR = (iso: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));
// Telefone comparavel: DDD + 8 ultimos digitos (ignora o 55 e o 9 extra), como no worker
export function chaveFone(t: string | null | undefined) {
  const d = String(t ?? "").replace(/\D/g, "");
  if (/^55\d{10,11}$/.test(d)) return d.slice(2, 4) + d.slice(-8);
  if (/^\d{10,11}$/.test(d)) return d.slice(0, 2) + d.slice(-8);
  return d.length >= 8 ? d.slice(-8) : "";
}
const nomeChave = (n: string) => { const p = n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((x) => x.length > 1); return p.length ? `${p[0]} ${p[p.length - 1]}` : ""; };
// produto da conversa (a IA so separa imersao e workshop) compativel com o do CRM
const compativel = (ia: string | null, crm: string) => (ia === "workshop" ? crm === "workshop" : crm !== "workshop");

export function cruzar(linhas: (Resultado & { fone?: string })[], crm: CrmCruzado[]) {
  const crmLigado = crm.length > 0;
  // 1) IA x CRM: mesmo numero, qualquer produto, ate JANELA_CRM dias (o CRM manda)
  for (const r of linhas.filter((x) => x.origem === "ia")) {
    const v = r.fone ? crm.filter((c) => c.fone === r.fone && distDias(c.dia, r.data) <= JANELA_CRM).sort((a, b) => Number(compativel(r.produto, b.tipo)) - Number(compativel(r.produto, a.tipo)) || distDias(a.dia, r.data) - distDias(b.dia, r.data))[0] : undefined;
    if (v) {
      r.duplicada = "já contada no CRM"; v.vista = true;
      if (compativel(r.produto, v.tipo)) v.vendedorConversa ??= r.vendedorId; // so empresta o vendedor da conversa do mesmo tipo de venda
      if (!v.diaCerto && r.data < v.dia && compativel(r.produto, v.tipo)) v.dia = r.data; // a venda apareceu antes na conversa
    }
  }
  // 2) IA repetida em mais de um dia: vale a primeira (ou a que foi ajustada a mao)
  const grupos = new Map<string, (Resultado & { fone?: string })[]>();
  for (const r of linhas.filter((x) => x.origem === "ia" && !x.duplicada && x.fone)) grupos.set(`${r.fone}|${r.produto}`, [...(grupos.get(`${r.fone}|${r.produto}`) ?? []), r]);
  for (const g of grupos.values()) {
    g.sort((a, b) => Number(b.ajustada) - Number(a.ajustada) || a.data.localeCompare(b.data));
    for (const r of g.slice(1)) if (distDias(r.data, g[0].data) <= JANELA) r.duplicada = "repetida (mesma venda em outro dia)";
  }
  // 3) manual x CRM: mesmo nome de cliente e produto
  for (const r of linhas.filter((x) => x.origem === "manual" && x.cliente)) {
    const k = nomeChave(r.cliente);
    if (k && crm.some((c) => c.cliente && nomeChave(c.cliente) === k && (!r.produto || r.produto === c.tipo) && distDias(c.dia, r.data) <= JANELA)) r.duplicada = "já lançada no CRM";
  }
  // 3b) venda lancada a mao que a IA tambem viu na conversa (mesmo nome e produto): vale a manual
  for (const m of linhas.filter((x) => x.origem === "manual" && !x.duplicada && x.cliente)) {
    const k = nomeChave(m.cliente);
    for (const r of linhas.filter((x) => x.origem === "ia" && !x.duplicada && x.cliente && nomeChave(x.cliente) === k && (!m.produto || m.produto === x.produto) && distDias(x.data, m.data) <= JANELA)) r.duplicada = "já lançada à mão";
  }
  // 4) venda alta so na conversa: espera o lancamento no CRM. Abaixo de R$ 1.000 a IA chamou de imersao um workshop: segue valendo.
  if (crmLigado) for (const r of linhas.filter((x) => x.origem === "ia" && !x.duplicada && ALTOS.includes(x.produto ?? "") && (x.valor == null || x.valor >= 1000))) r.naoLancada = true;
}

// Soma do faturamento: so vendas com valor e que nao foram tiradas
export const contaNoFaturamento = (r: Resultado) => !r.excluida && !r.duplicada && !r.naoLancada && (r.valor ?? 0) > 0;

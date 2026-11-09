import type { SupabaseClient } from "@supabase/supabase-js";
import { telefone, um } from "@/lib/format";

// Resultados (vendas). Fonte unica das vendas em dinheiro: a aba Resultados e o faturamento da TV leem daqui.
// = vendas ganhas no CRM Q5 (tabela crm_vendas, com o produto do CRM)
// + vendas que a IA detectou nas conversas (tabela auditorias), com os ajustes feitos na aba Resultados,
// + vendas lancadas a mao (tabela resultados_vendas).
// Cruzamento sem duplicar (cada venda conta uma vez):
// - venda da conversa do mesmo cliente (DDD + 8 digitos) e produto compativel, ate 30 dias do ganho no CRM: vale a do CRM
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
};

type Ajuste = { id: string; data: string; vendedor_id: string | null; cliente: string | null; empresa: string | null; produto: string | null; forma_pagamento: string | null; valor: number | string | null; auditoria_id: string | null; excluida: boolean };
type Aud = { id: string; vendedor_id: string; venda_tipo: string | null; venda_valor: number | string | null; venda_cupom: boolean; conversas: { id: string; data: string; contato: string | null; contato_nome: string | null; telefone: string | null } | { id: string; data: string; contato: string | null; contato_nome: string | null; telefone: string | null }[] | null };

const num = (x: unknown): number | null => (x == null || x === "" ? null : Number.isFinite(Number(x)) ? Number(x) : null);

// Lista as vendas em dinheiro do periodo (inclui as tiradas do faturamento, marcadas em "excluida") e os convites (cupom R$ 0).
// Se a tabela de resultados ainda nao existe no banco, tabelaOk = false e valem so as vendas da IA.
export async function listarResultados(db: SupabaseClient, org: string, de: string, ate: string): Promise<{ linhas: Resultado[]; convites: string[]; tabelaOk: boolean; erro: string | null }> {
  // janela maior para achar a mesma venda antes ou depois do periodo (e nao contar de novo)
  const deLargo = somaDias(de, -JANELA), ateLargo = somaDias(ate, JANELA);
  const [rAud, rAj, rCrm] = await Promise.all([
    db.from("auditorias").select("id,vendedor_id,venda_tipo,venda_valor,venda_cupom,conversas!inner(id,data,canal,contato,contato_nome,telefone)")
      .eq("org_id", org).eq("venda", true).neq("conversas.canal", "importada").gte("conversas.data", deLargo).lte("conversas.data", ate).limit(5000),
    db.from("resultados_vendas").select("*").eq("org_id", org).gte("data", de).lte("data", ate).limit(5000),
    db.from("crm_vendas").select("deal_id,telefone,cliente,valor_cents,ganho_em,vendedor_id,produto,tipo,campos").eq("org_id", org).eq("status", "won")
      .gte("ganho_em", `${deLargo}T00:00:00-03:00`).lte("ganho_em", `${ateLargo}T23:59:59-03:00`).limit(5000),
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
  const crm: CrmCruzado[] = ((rCrm.error ? [] : rCrm.data ?? []) as Crm[]).map((v) => ({ ...v, dia: diaBR(v.ganho_em), fone: chaveFone(v.telefone), tipo: v.tipo || "outro" }));
  cruzar(linhas as (Resultado & { fone?: string })[], crm);
  // so o periodo pedido (o resto foi buscado so para o cruzamento)
  for (const v of crm.filter((x) => x.dia >= de && x.dia <= ate)) {
    linhas.push({
      chave: `c:${v.deal_id}`, origem: "crm", id: null, auditoriaId: null, data: v.dia, vendedorId: v.vendedor_id ?? v.vendedorConversa ?? null,
      cliente: v.cliente?.trim() ?? "", empresa: typeof v.campos?.["nome-da-empresa"] === "string" ? v.campos["nome-da-empresa"] : "",
      produto: PRODUTOS.some(([k]) => k === v.tipo) ? v.tipo : "outro", forma: null, valor: v.valor_cents != null ? v.valor_cents / 100 : null,
      valorIA: null, ajustada: false, excluida: false, duplicada: null, naoLancada: false, naConversa: !!v.vista,
    });
  }
  const noPeriodo = linhas.filter((r) => r.data >= de && r.data <= ate).map(({ ...r }) => { delete (r as { fone?: string }).fone; return r as Resultado; });
  noPeriodo.sort((x, y) => y.data.localeCompare(x.data) || (y.valor ?? -1) - (x.valor ?? -1));
  return { linhas: noPeriodo, convites, tabelaOk, erro: rAud.error?.message ?? null };
}

// ---------- cruzamento ----------
type Crm = { deal_id: string; telefone: string | null; cliente: string | null; valor_cents: number | null; ganho_em: string; vendedor_id: string | null; produto: string | null; tipo: string | null; campos: Record<string, unknown> | null };
type CrmCruzado = Crm & { dia: string; fone: string; tipo: string; vista?: boolean; vendedorConversa?: string | null };
const JANELA = 30; // dias: a mesma venda vista na conversa e lancada no CRM
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
  // 1) IA x CRM: mesma pessoa, produto compativel, ate JANELA dias
  for (const r of linhas.filter((x) => x.origem === "ia")) {
    const v = r.fone ? crm.find((c) => c.fone === r.fone && compativel(r.produto, c.tipo) && distDias(c.dia, r.data) <= JANELA) : undefined;
    if (v) { r.duplicada = "já contada no CRM"; v.vista = true; v.vendedorConversa ??= r.vendedorId; }
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
  // 4) venda alta so na conversa: espera o lancamento no CRM. Abaixo de R$ 1.000 a IA chamou de imersao um workshop: segue valendo.
  if (crmLigado) for (const r of linhas.filter((x) => x.origem === "ia" && !x.duplicada && ALTOS.includes(x.produto ?? "") && (x.valor == null || x.valor >= 1000))) r.naoLancada = true;
}

// Soma do faturamento: so vendas com valor e que nao foram tiradas
export const contaNoFaturamento = (r: Resultado) => !r.excluida && !r.duplicada && !r.naoLancada && (r.valor ?? 0) > 0;

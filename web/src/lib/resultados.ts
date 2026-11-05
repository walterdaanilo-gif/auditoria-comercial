import type { SupabaseClient } from "@supabase/supabase-js";
import { telefone, um } from "@/lib/format";

// Resultados (vendas). Fonte unica das vendas em dinheiro: a aba Resultados e o faturamento da TV leem daqui.
// = vendas que a IA detectou nas conversas (tabela auditorias), com os ajustes feitos na aba Resultados,
// + vendas lancadas a mao (tabela resultados_vendas).
export const FORMAS: [string, string][] = [["pix", "Pix"], ["cartao", "Cartão"], ["boleto", "Boleto"], ["transferencia", "Transferência"], ["dinheiro", "Dinheiro"], ["outro", "Outro"]];
export const PRODUTOS: [string, string][] = [["workshop", "Workshop"], ["imersao", "Imersão"], ["incompany", "In-company"], ["plataforma", "Plataforma"], ["outro", "Outro"]];
export const rotuloForma = (k: string | null) => FORMAS.find(([v]) => v === k)?.[1] ?? "—";
export const rotuloProduto = (k: string | null) => PRODUTOS.find(([v]) => v === k)?.[1] ?? "—";
export const brlCompleto = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export type Resultado = {
  chave: string;                    // "a:<auditoria>" (IA) ou "m:<id>" (manual)
  origem: "ia" | "manual";
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
};

type Ajuste = { id: string; data: string; vendedor_id: string | null; cliente: string | null; empresa: string | null; produto: string | null; forma_pagamento: string | null; valor: number | string | null; auditoria_id: string | null; excluida: boolean };
type Aud = { id: string; vendedor_id: string; venda_tipo: string | null; venda_valor: number | string | null; venda_cupom: boolean; conversas: { id: string; data: string; contato: string | null; contato_nome: string | null; telefone: string | null } | { id: string; data: string; contato: string | null; contato_nome: string | null; telefone: string | null }[] | null };

const num = (x: unknown): number | null => (x == null || x === "" ? null : Number.isFinite(Number(x)) ? Number(x) : null);

// Lista as vendas em dinheiro do periodo (inclui as tiradas do faturamento, marcadas em "excluida") e os convites (cupom R$ 0).
// Se a tabela de resultados ainda nao existe no banco, tabelaOk = false e valem so as vendas da IA.
export async function listarResultados(db: SupabaseClient, org: string, de: string, ate: string): Promise<{ linhas: Resultado[]; convites: string[]; tabelaOk: boolean; erro: string | null }> {
  const [rAud, rAj] = await Promise.all([
    db.from("auditorias").select("id,vendedor_id,venda_tipo,venda_valor,venda_cupom,conversas!inner(id,data,canal,contato,contato_nome,telefone)")
      .eq("org_id", org).eq("venda", true).neq("conversas.canal", "importada").gte("conversas.data", de).lte("conversas.data", ate).limit(5000),
    db.from("resultados_vendas").select("*").eq("org_id", org).gte("data", de).lte("data", ate).limit(5000),
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
    });
  }
  for (const m of ajustes.filter((x) => !x.auditoria_id)) {
    linhas.push({ chave: `m:${m.id}`, origem: "manual", id: m.id, auditoriaId: null, data: m.data, vendedorId: m.vendedor_id, cliente: m.cliente?.trim() ?? "", empresa: m.empresa?.trim() ?? "", produto: m.produto, forma: m.forma_pagamento, valor: num(m.valor), valorIA: null, ajustada: false, excluida: !!m.excluida });
  }
  linhas.sort((x, y) => y.data.localeCompare(x.data) || (y.valor ?? -1) - (x.valor ?? -1));
  return { linhas, convites, tabelaOk, erro: rAud.error?.message ?? null };
}

// Soma do faturamento: so vendas com valor e que nao foram tiradas
export const contaNoFaturamento = (r: Resultado) => !r.excluida && (r.valor ?? 0) > 0;

import type { QuadroCfg, QuadroId } from "@/lib/quadrosTv";
// Tipos e calculos da tela fixa da TV (Visao geral). Sem acesso a banco e sem tela: so conta.
// Regra de ouro: dado que nao existe vem como null, nunca como zero. A tela mostra "aguardando fonte".

export type Tom = "ok" | "warn" | "bad" | "neutro";

export type Pessoa = {
  id: string; nome: string; sigla: string; foto: string | null; tipo: "sdr" | "closer";
  conversas: { v: number; meta: number } | null;  // so SDR (meta do Walter por dia util x dias uteis do mes)
  marcacoes: { v: number; meta: number } | null;  // so SDR
  vendasValor: number; vendasN: number;            // vendas pagas (Workshop pago e Imersao)
  // so closer: cartoes que entraram em "Diagnostico realizado" (funil Vendas 2 do CRM) no periodo, contra
  // meta_closer_reunioes x dias uteis. null = sem fonte ou sem meta
  reunioes?: { v: number; meta: number } | null;
  // so closer: clientes potenciais sem mensagem do time ha "dias" dias ou mais (retrato do worker, agora; nao segue o periodo)
  followups?: { qtd: number; maisAntigo: number | null; dias: number } | null;
};

// Uma venda na lista do produto: cliente (e empresa), quem vendeu, dia (DD/MM) e valor
export type VendaProduto = { cliente: string; empresa: string; vendedor: string | null; data: string; valor: number };

// Tela fixa da TV (Visao geral). O que o Cabueta nao mede nao entra aqui.
export type VisaoGeralDados = {
  demo: boolean;
  atualizadoEm: string;
  // mensal = periodo "Mes atual": so nele valem a meta de faturamento do mes, o ritmo e a projecao.
  // Nos outros periodos diasUteisMes = diaUtil (periodo todo ja decorrido) e as metas diarias valem x dias uteis do periodo.
  periodo: { p: string; de: string; ate: string; mensal: boolean; rotulo: string; intervalo: string; diaUtil: number; diasUteisMes: number };
  // porProduto: o faturamento dividido pelos produtos (Plataforma primeiro), so os que venderam
  // vendas: as vendas daquele produto (clicar no produto na TV abre a lista), da maior para a menor
  fat: { real: number; meta: number | null; serie: { du: number; real: number; data: string }[]; datasUteis: string[]; porProduto?: { produto: string; valor: number; n: number; vendas?: VendaProduto[] }[] };
  pessoas: Pessoa[];
  quadros: QuadroCfg[];                       // quadros na tela, na ordem escolhida em Configuracoes
  kpis: Partial<Record<QuadroId, Kpi>>;       // quadros pequenos (semretorno, primeira, nota, ...)
};
// Quadro pequeno: um numero grande com legenda. valor null = sem dado (a tela escreve "sem dado ainda")
export type Kpi = { valor: string | null; sub: string; tom: Tom; selo?: string; pct?: number | null };

// ---------- formatos ----------
// Valor completo, com centavos: R$ 34.817,80
export function moeda(n: number): string {
  return `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export const inteiro = (n: number) => Math.round(n).toLocaleString("pt-BR");
export const pctTxt = (a: number, b: number): string | null => (b > 0 ? `${Math.round((a / b) * 100)}%` : null);

// ---------- ritmo, projecao e necessidade ----------
export type Ritmo = {
  ritmoPct: number;             // dias uteis passados / dias uteis do mes
  pctMeta: number | null;       // realizado / meta
  difPts: number | null;        // pctMeta - ritmo, em pontos
  selo: { texto: string; tom: Tom } | null;
  projecao: number | null;      // (realizado / dias uteis passados) x dias uteis do mes
  projecaoPct: number | null;
  faltam: number | null;        // meta - realizado
  precisaPorDia: number | null; // (meta - realizado) / dias uteis restantes
  mediaAteHoje: number;
};

// verde no ritmo, ambar ate 10 pontos abaixo, vermelho mais de 10
export function tomPorDiferenca(difPts: number | null): Tom {
  if (difPts === null) return "neutro";
  return difPts >= 0 ? "ok" : difPts >= -10 ? "warn" : "bad";
}

export function calcularRitmo(real: number, meta: number | null, diaUtil: number, diasUteisMes: number): Ritmo {
  const passados = Math.max(diaUtil, 1);
  const ritmoPct = (passados / diasUteisMes) * 100;
  const pctMeta = meta && meta > 0 ? (real / meta) * 100 : null;
  const difPts = pctMeta === null ? null : pctMeta - ritmoPct;
  const restantes = diasUteisMes - passados;
  const projecao = (real / passados) * diasUteisMes;
  let selo: Ritmo["selo"] = null;
  if (difPts !== null) {
    const r = Math.round(Math.abs(difPts));
    selo = { texto: difPts >= 0 ? (r === 0 ? "no ritmo" : `${r} pts acima do ritmo`) : `${r} pts abaixo do ritmo`, tom: tomPorDiferenca(difPts) };
  }
  return {
    ritmoPct, pctMeta, difPts, selo, projecao,
    projecaoPct: meta && meta > 0 ? (projecao / meta) * 100 : null,
    faltam: meta && meta > 0 ? Math.max(meta - real, 0) : null,
    precisaPorDia: meta && meta > 0 && restantes > 0 ? Math.max(meta - real, 0) / restantes : null,
    mediaAteHoje: real / passados,
  };
}

// Eixo "bonito" do grafico: 0 ate o topo, em 3 divisoes (mesma unidade: R$ mil)
export function eixoY(maximo: number): { topo: number; marcas: number[] } {
  // 3 faixas com passo "redondo"; o topo fica logo acima do maior valor (sem sobrar meio grafico vazio)
  const bruto = Math.max(maximo, 1000) * 1.04 / 1000 / 3;
  const pot = Math.pow(10, Math.floor(Math.log10(bruto)));
  const passo = ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * pot).find((p) => p >= bruto) ?? bruto) * 1000;
  return { topo: passo * 3, marcas: [0, 1, 2, 3].map((i) => i * passo) };
}

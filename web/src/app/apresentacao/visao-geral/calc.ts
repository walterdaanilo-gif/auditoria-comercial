import type { QuadroCfg, QuadroId } from "@/lib/quadrosTv";
// Tipos e calculos da tela fixa da TV (Visao geral). Sem acesso a banco e sem tela: so conta.
// Regra de ouro: dado que nao existe vem como null, nunca como zero. A tela mostra "aguardando fonte".

export type Tom = "ok" | "warn" | "bad" | "neutro";

export type Pessoa = {
  id: string; nome: string; sigla: string; foto: string | null; tipo: "sdr" | "closer";
  conversas: { v: number; meta: number } | null;  // so SDR (meta do Walter por dia util x dias uteis do mes)
  marcacoes: { v: number; meta: number } | null;  // so SDR
  vendasValor: number; vendasN: number;            // vendas pagas (Workshop pago e Imersao)
};

// Tela fixa da TV (Visao geral). O que o Cabueta nao mede nao entra aqui.
export type VisaoGeralDados = {
  demo: boolean;
  atualizadoEm: string;
  periodo: { rotulo: string; intervalo: string; diaUtil: number; diasUteisMes: number };
  fat: { real: number; meta: number | null; serie: { du: number; real: number; data: string }[]; datasUteis: string[] };
  pessoas: Pessoa[];
  quadros: QuadroCfg[];                       // quadros na tela, na ordem escolhida em Configuracoes
  kpis: Partial<Record<QuadroId, Kpi>>;       // quadros pequenos (semretorno, primeira, nota, ...)
};
// Quadro pequeno: um numero grande com legenda. valor null = sem dado (a tela escreve "sem dado ainda")
export type Kpi = { valor: string | null; sub: string; tom: Tom; selo?: string; pct?: number | null };

// ---------- formatos ----------
const num1 = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
export function moeda(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `R$ ${num1(n / 1_000_000)} mi`;
  if (a >= 1000) return `R$ ${num1(n / 1000)} mil`;
  return `R$ ${Math.round(n).toLocaleString("pt-BR")}`;
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
  const bruto = Math.max(maximo, 1000) / 1000 / 3;
  const pot = Math.pow(10, Math.floor(Math.log10(bruto)));
  const passo = ([1, 2, 2.5, 5, 10].map((m) => m * pot).find((p) => p >= bruto * 0.92) ?? bruto) * 1000;
  return { topo: passo * 3, marcas: [0, 1, 2, 3].map((i) => i * passo) };
}

// Tipos e calculos do slide 1 (Visao geral) da Apresentacao. Sem acesso a banco e sem tela: so conta.
// Regra de ouro: dado que nao existe vem como null, nunca como zero. A tela mostra "aguardando fonte".

export type Tom = "ok" | "warn" | "bad" | "neutro";

export type Produto = {
  chave: "incompany" | "imersao" | "plataforma" | "workshop";
  nome: string; cor: string;
  valor: number | null;            // receita do mes em R$
  pctMeta: number | null;          // 0 a 100 (receita / meta do produto)
  rotuloMeta: string | null;       // ex.: "meta R$ 100 mil" ou "270 ativos"
  ticket: string | null;           // ex.: "R$ 36 mil"
  winloss: { ganhos: number; perdidos: number } | null;
};
export type EtapaFunil = { nome: string; sub?: string; valor: number | null; passagem: string | null; destaque?: boolean };
export type CaixaProduto = { nome: string; cor: string; valor: number | null; pct: number | null };
export type Pessoa = {
  id: string; nome: string; sigla: string; foto: string | null; tipo: "sdr" | "closer";
  status: { texto: string; tom: Tom } | null;
  contatos: number | null;                              // SDR
  conversas: { v: number; meta: number | null } | null; // SDR
  inscricoes: { v: number; meta: number | null } | null;// SDR
  reunioes: { v: number; meta: number | null } | null;  // Closer
  negociacao: { valor: number; n: number } | null;      // Closer
  vendasValor: number; nota: number | null;
  rodape: string;
};
export type CardRodape = { rotulo: string; valor: string | null; sub?: string; selo?: { texto: string; tom: Tom }; tom?: Tom };

export type Slide1Dados = {
  demo: boolean;
  atualizadoEm: string;
  periodo: { rotulo: string; intervalo: string; diaUtil: number; diasUteisMes: number };
  fat: {
    real: number; meta: number | null; semFonteResto: boolean;
    serie: { du: number; real: number; data: string }[];
    datasUteis: string[]; // data (dd/mm) de cada dia util do mes
  };
  produtos: Produto[];
  funil: EtapaFunil[];
  caixasProduto: CaixaProduto[];
  origem: { inbound: number; outbound: number } | null;
  negociacao: { valor: number; n: number } | null;
  presentesImersao: number | null;
  semRetorno: number | null;
  pessoas: Pessoa[];
  rodape: CardRodape[];
};

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

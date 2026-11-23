// Metas diarias por SDR (definidas pelo Walter em 2026-10-16).
// "Contatos" soma conversas em que o SDR mandou mensagem e ligacoes feitas (sem meta propria: mostra o numero).
// "Conversas trocadas" = conversas em que o SDR mandou mensagem e o lead respondeu (campo respostas), meta de 25 por dia util.
// "Marcacoes" = workshop + reuniao de imersao, meta de 6 por dia util.
// Confirmados e presentes ficam de fora: o sistema ainda nao mede isso.
export const METAS = [
  { chave: "contatos", rotulo: "Contatos (ligação ou mensagem)", meta: null, soma: ["contatadas", "ligacoes"] },
  { chave: "respostas", rotulo: "Conversas trocadas", meta: 25, soma: ["respostas"] },
  { chave: "agendados", rotulo: "Marcações (workshop + reunião de implementação)", meta: 6, soma: ["agendados"] },
] as const;
export type ChaveMeta = (typeof METAS)[number]["soma"][number];

// Feriados nacionais (ficam fora dos dias uteis, da meta e da projecao): fixos + Sexta-feira Santa (Pascoa, calculada para qualquer ano).
// Feriado estadual ou municipal e ponto facultativo (Carnaval, Corpus Christi) NAO entram: se a empresa para nesses dias, avise para incluir.
const FERIADOS_FIXOS = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"];
const cacheFeriados = new Map<number, Set<string>>();
function feriadosDoAno(ano: number): Set<string> {
  const c = cacheFeriados.get(ano); if (c) return c;
  // Pascoa (algoritmo de Meeus/Jones/Butcher); Sexta-feira Santa = 2 dias antes
  const a = ano % 19, b = Math.floor(ano / 100), c2 = ano % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c2 / 4), k = c2 % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  const sexta = new Date(Date.UTC(ano, mes - 1, dia - 2)).toISOString().slice(0, 10);
  const set = new Set([...FERIADOS_FIXOS.map((x) => `${ano}-${x}`), sexta]);
  cacheFeriados.set(ano, set); return set;
}
export const ehFeriado = (iso: string) => feriadosDoAno(Number(iso.slice(0, 4))).has(iso);
// Dia util = segunda a sexta que nao e feriado nacional
export function ehUtil(iso: string) {
  const w = new Date(iso + "T12:00:00Z").getUTCDay();
  return w !== 0 && w !== 6 && !ehFeriado(iso);
}

// Dias uteis entre duas datas YYYY-MM-DD, inclusive (sem fins de semana e sem feriados). Minimo 1 para nao zerar a meta num dia sem util.
export function diasUteis(de: string, ate: string) {
  let n = 0;
  for (let d = new Date(de + "T12:00:00Z"); d <= new Date(ate + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
    if (ehUtil(d.toISOString().slice(0, 10))) n++;
  }
  return Math.max(n, 1);
}

// Cor de cada SDR: paleta categorica validada para o fundo escuro do painel (ordem fixa, nunca reciclada).
// A cor segue a pessoa (posicao na lista completa de vendedores por nome), nunca o filtro ativo.
export const CORES_SDR = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
export const corSdr = (i: number) => CORES_SDR[i] ?? "#9ba5a4";

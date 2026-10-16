// Metas diarias por SDR (as mesmas da aba SDR da planilha, celulas B4:B13).
// Confirmados e presentes ficam de fora: o sistema ainda nao mede isso.
export const METAS = [
  { chave: "contatadas", rotulo: "Contatadas", meta: 20 },
  { chave: "ligacoes", rotulo: "Ligações", meta: 20 },
  { chave: "respostas", rotulo: "Respostas no privado", meta: 20 },
  { chave: "agendados", rotulo: "Agendados", meta: 5 },
] as const;
export type ChaveMeta = (typeof METAS)[number]["chave"];

// Dias uteis (seg a sex) entre duas datas YYYY-MM-DD, inclusive. Minimo 1 para nao zerar a meta num fim de semana.
export function diasUteis(de: string, ate: string) {
  let n = 0;
  for (let d = new Date(de + "T12:00:00Z"); d <= new Date(ate + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return Math.max(n, 1);
}

// Cor de cada SDR: paleta categorica validada para o fundo escuro do painel (ordem fixa, nunca reciclada).
// A cor segue a pessoa (posicao na lista completa de vendedores por nome), nunca o filtro ativo.
export const CORES_SDR = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
export const corSdr = (i: number) => CORES_SDR[i] ?? "#9ba5a4";

import type { VisaoGeralDados } from "./calc";

// NUMEROS FICTICIOS: so aparecem com ?demo=1 (a tela mostra o selo "EXEMPLO · NUMEROS FICTICIOS").
// dias uteis de novembro de 2025 (20 dias, como no exemplo "dia util 12 de 20")
const datas = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2025, 10, i + 1))).filter((d) => d.getUTCDay() % 6 !== 0).map((d) => `${String(d.getUTCDate()).padStart(2, "0")}/11`);
const serie = [9.6, 24.2, 33.4, 45.4, 60.4, 74.5, 87.6, 103.7, 121.8, 138.9, 152.0, 174.6].map((v, i) => ({ du: i + 1, real: v * 1000, data: datas[i] }));

export const visaoGeralDemo: VisaoGeralDados = {
  demo: true,
  atualizadoEm: "11:34",
  periodo: { rotulo: "Mês atual", intervalo: "01 a 30/11", diaUtil: 12, diasUteisMes: 20 },
  fat: { real: 174600, meta: 315000, serie, datasUteis: datas },
  pessoas: [
    { id: "s1", nome: "SDR 1", sigla: "S1", foto: null, tipo: "sdr", conversas: { v: 330, meta: 300 }, marcacoes: { v: 71, meta: 72 }, vendasValor: 6900, vendasN: 35 },
    { id: "s2", nome: "SDR 2", sigla: "S2", foto: null, tipo: "sdr", conversas: { v: 290, meta: 300 }, marcacoes: { v: 52, meta: 72 }, vendasValor: 5700, vendasN: 29 },
    { id: "c1", nome: "Closer 1", sigla: "C1", foto: null, tipo: "closer", conversas: null, marcacoes: null, vendasValor: 82000, vendasN: 15 },
    { id: "c2", nome: "Closer 2", sigla: "C2", foto: null, tipo: "closer", conversas: null, marcacoes: null, vendasValor: 53000, vendasN: 8 },
  ],
  semRetorno: 7,
  primeiraResposta: { seg: 300, slaMin: 15 },
};

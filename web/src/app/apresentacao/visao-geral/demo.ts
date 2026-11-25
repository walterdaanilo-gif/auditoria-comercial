import { PADRAO_QUADROS } from "@/lib/quadrosTv";
import type { VisaoGeralDados } from "./calc";

// NUMEROS FICTICIOS: so aparecem com ?demo=1 (a tela mostra o selo "EXEMPLO · NUMEROS FICTICIOS").
// dias uteis de novembro de 2025 (20 dias, como no exemplo "dia util 12 de 20")
const datas = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2025, 10, i + 1))).filter((d) => d.getUTCDay() % 6 !== 0).map((d) => `${String(d.getUTCDate()).padStart(2, "0")}/11`);
const serie = [9.6, 24.2, 33.4, 45.4, 60.4, 74.5, 87.6, 103.7, 121.8, 138.9, 152.0, 174.6].map((v, i) => ({ du: i + 1, real: v * 1000, data: datas[i] }));

export const visaoGeralDemo: VisaoGeralDados = {
  demo: true,
  atualizadoEm: "11:34",
  periodo: { p: "mes", de: "2025-11-01", ate: "2025-11-12", mensal: true, rotulo: "Mês atual", intervalo: "01 a 30/11", diaUtil: 12, diasUteisMes: 20 },
  fat: { real: 174600, meta: 315000, serie, datasUteis: datas },
  pessoas: [
    { id: "s1", nome: "SDR 1", sigla: "S1", foto: null, tipo: "sdr", conversas: { v: 330, meta: 300 }, marcacoes: { v: 71, meta: 72 }, vendasValor: 6900, vendasN: 35, followups: { qtd: 3, maisAntigo: 9, dias: 6, lista: [{ nome: "Cliente E", quando: "15/11 10:20", dias: 9, semResposta: false }, { nome: "Cliente F", quando: "17/11 14:00", dias: 7, semResposta: true }, { nome: "Cliente G", quando: "18/11 09:30", dias: 6, semResposta: false }] } },
    { id: "s2", nome: "SDR 2", sigla: "S2", foto: null, tipo: "sdr", conversas: { v: 290, meta: 300 }, marcacoes: { v: 52, meta: 72 }, vendasValor: 5700, vendasN: 29, followups: { qtd: 0, maisAntigo: null, dias: 6 } },
    { id: "c1", nome: "Closer 1", sigla: "C1", foto: null, tipo: "closer", conversas: null, marcacoes: null, vendasValor: 82000, vendasN: 15, agendadas: { v: 64, meta: 63 }, reunioes: { v: 52, meta: 63 }, followups: { qtd: 4, maisAntigo: 12, dias: 6, lista: [{ nome: "Cliente A", quando: "12/11 10:20", dias: 12, semResposta: false }, { nome: "Cliente B", quando: "14/11 16:05", dias: 10, semResposta: true }, { nome: "Cliente C", quando: "16/11 09:40", dias: 8, semResposta: false }, { nome: "Cliente D", quando: "18/11 11:15", dias: 6, semResposta: false }] } },
    { id: "c2", nome: "Closer 2", sigla: "C2", foto: null, tipo: "closer", conversas: null, marcacoes: null, vendasValor: 53000, vendasN: 8, agendadas: { v: 40, meta: 63 }, reunioes: { v: 31, meta: 63 }, followups: { qtd: 0, maisAntigo: null, dias: 6 } },
  ],
  conversao: { presentes: 40, total: 6, produtos: [{ produto: "imersao", vendas: 4 }, { produto: "incompany", vendas: 1 }, { produto: "plataforma", vendas: 1 }] },
  quadros: PADRAO_QUADROS,
  kpis: {
    semretorno: { valor: "7", sub: "o lead escreveu e ficou mais de 15 min sem resposta", tom: "bad", lista: [
      { cliente: "Cliente A", vendedor: "SDR 1", quando: "24/11 09:12", espera: "3 h 40 min", texto: "Oi, queria saber o valor da imersão" },
      { cliente: "Cliente B", vendedor: "SDR 2", quando: "24/11 11:05", espera: "1 h 47 min", texto: "Pode me ligar à tarde?" },
      { cliente: "Cliente C", vendedor: "Closer 1", quando: "24/11 12:30", espera: "22 min", texto: "Combinado, aguardo o link" },
    ] },
    primeira: { valor: "5min", sub: "média do período", tom: "ok", selo: "dentro de 15 min" },
    nota: { valor: "5,3", sub: "186 auditadas no período", tom: "warn" },
    tempo_medio: { valor: "12min", sub: "a cada vez que o lead escreve · média do período", tom: "warn" },
    ligacoes: { valor: "79", sub: "de 120 ligações no período", tom: "neutro" },
    conversas_time: { valor: "620", sub: "de 600 · 103% da meta", tom: "ok", selo: "no ritmo", pct: 103 },
    marcacoes_time: { valor: "123", sub: "de 144 · 85% da meta", tom: "ok", selo: "no ritmo", pct: 85 },
    convites: { valor: "74", sub: "cupom 100% ou Carbone · R$ 0", tom: "neutro" },
  },
};

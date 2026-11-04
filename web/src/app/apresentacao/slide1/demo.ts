import type { Slide1Dados } from "./calc";

// NUMEROS FICTICIOS: so aparecem com ?demo=1 (a tela mostra o selo "EXEMPLO · NUMEROS FICTICIOS").
const serie = [9.6, 24.2, 33.4, 45.4, 60.4, 74.5, 87.6, 103.7, 121.8, 138.9, 152.0, 174.6].map((v, i) => ({ du: i + 1, real: v * 1000, data: "" }));
// dias uteis de novembro de 2025 (20 dias, como no exemplo "dia util 12 de 20")
const datas = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2025, 10, i + 1))).filter((d) => d.getUTCDay() % 6 !== 0).map((d) => `${String(d.getUTCDate()).padStart(2, "0")}/11`);

export const slide1Demo: Slide1Dados = {
  demo: true,
  atualizadoEm: "11:34",
  periodo: { rotulo: "Mês atual", intervalo: "01 a 30/11", diaUtil: 12, diasUteisMes: 20 },
  fat: { real: 174600, meta: 315000, semFonteResto: false, serie: serie.map((s, i) => ({ ...s, data: datas[i] })), datasUteis: datas },
  produtos: [
    { chave: "incompany", nome: "In-company", cor: "#5ea0f0", valor: 72000, pctMeta: 72, rotuloMeta: "meta R$ 100 mil", ticket: "R$ 36 mil", winloss: { ganhos: 2, perdidos: 2 } },
    { chave: "imersao", nome: "Imersão aberta", cor: "#9085e9", valor: 63000, pctMeta: 42, rotuloMeta: "meta R$ 150 mil", ticket: "R$ 3 mil", winloss: { ganhos: 21, perdidos: 10 } },
    { chave: "plataforma", nome: "Plataforma", cor: "#6dcfc0", valor: 27000, pctMeta: 54, rotuloMeta: "270 ativos", ticket: "R$ 100/mês", winloss: null },
    { chave: "workshop", nome: "Workshop", cor: "#e98bb0", valor: 12600, pctMeta: 84, rotuloMeta: "64 pagos", ticket: "R$ 197", winloss: { ganhos: 64, perdidos: 38 } },
  ],
  funil: [
    { nome: "Leads novos", sub: "inbound + outbound", valor: 1920, passagem: null },
    { nome: "Contato", valor: 1480, passagem: "77%" },
    { nome: "Inscrição no workshop", sub: "64 pagos + 74 convites", valor: 138, passagem: "9%" },
    { nome: "Presença no workshop", valor: 104, passagem: "presença 75%" },
    { nome: "Reunião de diagnóstico", valor: 36, passagem: "35%", destaque: true },
  ],
  caixasProduto: [
    { nome: "Imersão aberta", cor: "#9085e9", valor: 21, pct: 58 },
    { nome: "In-company", cor: "#5ea0f0", valor: 2, pct: 6 },
    { nome: "Plataforma", cor: "#6dcfc0", valor: 4, pct: 11 },
  ],
  origem: { inbound: 1260, outbound: 660 },
  negociacao: { valor: 150000, n: 13 },
  presentesImersao: 20,
  semRetorno: 7,
  pessoas: [
    { id: "s1", nome: "SDR 1", sigla: "S1", foto: null, tipo: "sdr", status: { texto: "WhatsApp off · 3 dias", tom: "bad" }, contatos: 760, conversas: { v: 330, meta: 300 }, inscricoes: { v: 71, meta: 72 }, reunioes: null, negociacao: null, vendasValor: 6900, nota: 5.1, rodape: "38 ligações · 1.120 mensagens" },
    { id: "s2", nome: "SDR 2", sigla: "S2", foto: null, tipo: "sdr", status: { texto: "ativo", tom: "ok" }, contatos: 720, conversas: { v: 290, meta: 300 }, inscricoes: { v: 67, meta: 72 }, reunioes: null, negociacao: null, vendasValor: 5700, nota: 5.4, rodape: "41 ligações · 980 mensagens" },
    { id: "c1", nome: "Closer 1", sigla: "C1", foto: null, tipo: "closer", status: { texto: "parado 1 h", tom: "warn" }, contatos: null, conversas: null, inscricoes: null, reunioes: { v: 20, meta: 22 }, negociacao: { valor: 88000, n: 8 }, vendasValor: 82000, nota: 5.3, rodape: "15 vendas · conversão: 75%" },
    { id: "c2", nome: "Closer 2", sigla: "C2", foto: null, tipo: "closer", status: { texto: "ativo", tom: "ok" }, contatos: null, conversas: null, inscricoes: null, reunioes: { v: 16, meta: 19 }, negociacao: { valor: 62000, n: 5 }, vendasValor: 53000, nota: 5.1, rodape: "8 vendas · conversão: 50%" },
  ],
  rodape: [
    { rotulo: "Responderam", valor: "512", sub: "35% das conversas" },
    { rotulo: "SLA 1ª resposta", valor: "5 min", selo: { texto: "≤ 15 min", tom: "ok" } },
    { rotulo: "Show-up reuniões", valor: "88%", sub: "36 de 41" },
    { rotulo: "Reembolso", valor: "2,8%", selo: { texto: "≤ 5%", tom: "ok" } },
    { rotulo: "Follow-ups atrasados", valor: "23", sub: "6+ dias sem msg", tom: "bad" },
    { rotulo: "NPS do mês", valor: null },
    { rotulo: "Indicações de parceiros", valor: null },
  ],
};

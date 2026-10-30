import type { Lead } from "./planilha";

// Regras do painel do Closer, usadas no servidor e na tela
export type Status = "novo" | "mensagem" | "respondeu" | "negociando" | "fechou_plataforma" | "fechou_imersao" | "sem_resposta" | "desqualificado";
export type Progresso = { status: Status; enviadas: number; motivo: string; anotacao: string; status_em: string | null };
export type LeadCloser = Lead & { progresso: Progresso };
export type Grupo = "abordar" | "conversa" | "negociacao" | "fechados" | "conferir" | "fora";

export const STATUS: Record<Status, { texto: string; cor: string }> = {
  novo: { texto: "A abordar", cor: "#3f8f85" },
  mensagem: { texto: "Mensagem enviada", cor: "#2f7fb8" },
  respondeu: { texto: "Respondeu", cor: "#7a6ad8" },
  negociando: { texto: "Em negociação", cor: "#c9882f" },
  fechou_plataforma: { texto: "Fechou Plataforma", cor: "#2fa86f" },
  fechou_imersao: { texto: "Fechou Imersão", cor: "#1f8f5c" },
  sem_resposta: { texto: "Sem resposta", cor: "#6b7574" },
  desqualificado: { texto: "Desqualificado", cor: "#d9604f" },
};
export const GRUPOS: { id: Grupo; titulo: string; cor: string }[] = [
  { id: "abordar", titulo: "A abordar", cor: "#3f8f85" },
  { id: "conversa", titulo: "Em conversa", cor: "#2f7fb8" },
  { id: "negociacao", titulo: "Em negociação", cor: "#c9882f" },
  { id: "fechados", titulo: "Fechados", cor: "#2fa86f" },
  { id: "conferir", titulo: "Conferir antes de abordar", cor: "#e5a85f" },
  { id: "fora", titulo: "Fora da fila", cor: "#6b7574" },
];
export const MOTIVOS = ["Sem perfil", "Sem orçamento", "Não é o momento", "Já é cliente", "Contato interno ou teste", "Número errado", "Pediu para não receber", "Outro"];

export const PROGRESSO_INICIAL = (l: Lead): Progresso => ({ status: l.enviadasPlanilha ? "mensagem" : "novo", enviadas: l.enviadasPlanilha, motivo: "", anotacao: "", status_em: null });

// O que impede o closer de abordar agora. So vale enquanto o lead nao foi trabalhado.
export function bloqueio(l: Lead): string {
  if (l.trava) return l.trava;
  if (!l.telefone) return "Sem telefone na planilha";
  if (l.conversasCrm.some((c) => /chat interno/i.test(c))) return "Tem conversa marcada como Chat interno no CRM: pode ser da equipe";
  if (/suporte|p[oó]s-vendas/i.test(l.etapa)) return "Está em Suporte/Pós-vendas no CRM: pode já ser cliente";
  return "";
}

export function grupoDe(l: LeadCloser): Grupo {
  const s = l.progresso.status;
  if (s === "fechou_plataforma" || s === "fechou_imersao") return "fechados";
  if (s === "sem_resposta" || s === "desqualificado") return "fora";
  if (s === "negociando") return "negociacao";
  if (s === "mensagem" || s === "respondeu") return "conversa";
  return bloqueio(l) ? "conferir" : "abordar";
}

const IMERSAO = (l: Lead) => /imers/i.test(l.etapa) || l.interesseImersao === "Sim";
const REUNIAO = (l: Lead) => /reuni/i.test(l.etapa);

// Prioridade por sinais da planilha. Os motivos aparecem na tela para o closer saber de onde veio.
export function temperatura(l: Lead): { nivel: "quente" | "morno" | "frio"; motivos: string[] } {
  const m: string[] = [];
  if (REUNIAO(l)) m.push("Reunião de implementação no CRM");
  if (/imers/i.test(l.etapa)) m.push("Interessado na Imersão no CRM");
  else if (l.interesseImersao === "Sim") m.push("Disse que tem interesse na imersão");
  if (l.nota != null && l.nota >= 9) m.push(`Deu nota ${l.nota} ao workshop`);
  if (l.dor) m.push("Relatou uma dor");
  if (l.indicacoes > 0) m.push(`Indicou ${l.indicacoes} ${l.indicacoes > 1 ? "pessoas" : "pessoa"}`);
  const nivel = REUNIAO(l) || IMERSAO(l) ? "quente" : l.nota != null && l.nota >= 9 && l.dor ? "morno" : "frio";
  return { nivel, motivos: m };
}
const PESO = { quente: 0, morno: 1, frio: 2 };
export const produtoSugerido = (l: Lead) => (IMERSAO(l) ? "Imersão" : "Weevo Start (Plataforma)");
export const ordenar = (a: Lead, b: Lead) => PESO[temperatura(a).nivel] - PESO[temperatura(b).nivel] || (b.nota ?? -1) - (a.nota ?? -1) || a.ordem - b.ordem;

// Orientacoes da aba "Orientacoes do envio" da planilha
export const ORIENTACOES = {
  preco: "R$ 297 por mês no plano anual. Não está nas mensagens: só informe quando o cliente perguntar.",
  inicio: "Não fale a data de início dos plantões e não afirme que o suporte já está funcionando.",
  comecaQuando: "A gente tá estruturando isso agora, e quem entra na Start já fica com acesso quando abrir. Enquanto isso, já dá pra usar as aulas e as ferramentas da plataforma.",
  envio: "Cada linha é um balão: envie linha por linha no WhatsApp.",
  ordem: "Mensagens 2 e 3 só depois que o cliente responder, ajustando a primeira linha ao que ele disse.",
  imersao: "Se o cliente pedir Imersão ou in-company, abra a negociação desse produto.",
};

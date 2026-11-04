// Tipos, padroes e validacao da tela Configuracoes (usados no navegador e na Server Action)
import { validarQuadros, type QuadroCfg } from "./quadrosTv";

export const PADRAO_MIN_MSGS = 4;
export const PADRAO_AMOSTRA = 100;
export const HORAS_RESUMO = ["07:00", "12:00", "19:00", "21:00"] as const;
export const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]; // indice = dia (0 = domingo)

export type Horario = { dias: number[]; inicio: string; fim: string };
export type Criterio = { chave: string; nome: string; descricao: string; peso: number; ativo: boolean };
export type Rubricas = { sdr: Criterio[]; closer: Criterio[]; personalizada: Criterio[] };

export type Settings = {
  auditoria_automatica: boolean;
  escopo_conversas: "todas" | "individual" | "grupo";
  min_mensagens: number | null;
  amostragem_pct: number | null;
  so_com_proposta: boolean;
  regras_criticas: string[];
  sla_primeira_resposta_min: number;
  followup_sem_resposta_h: number;
  followup_abandonada_d: number;
  followup_limite_d: number;
  horario_modo: "desligado" | "empresa" | "numero";
  horario_empresa: Horario;
  alerta_venda: boolean;
  alerta_oportunidade: boolean;
  alerta_marcacao: boolean;
  alerta_formato: "resumido" | "detalhado";
  instancia_envio_id: string | null;
  resumo_ativo: boolean;
  resumo_hora: string;
  auditoria_parada_min: number | null; // null = so na rodada final
  rodada_final_hora: string; // resumo da tarde e do dia (padrao 19:00)
  resumo_manha_hora: string; // resumo do turno da manha (padrao 13:00)
  alerta_followup: boolean;
  followup_alerta_d: number;
  historico_dias: number;
  agenda_ativa: boolean;
  agenda_duracao_min: number;
  agenda_convidar: boolean;
  agenda_meet: boolean;
  resumo_dias: number[];
  rubrica_modo: "sistema" | "personalizada";
  venda_conta: string[];
  venda_nao_conta: string[];
  oportunidade_conta: string[];
  oportunidade_nao_conta: string[];
  meta_sdr_conversas: number;
  meta_sdr_marcacoes: number;
  meta_closer_reunioes: number | null;
  meta_closer_vendas: number | null;
  // metas de faturamento do mes em R$ (slide 1 da Apresentacao); null = sem meta
  meta_fat_mes?: number | null;
  // quadros da tela da TV (ordem = ordem na lista); ausente ou null = quadros padrao
  tv_quadros?: QuadroCfg[] | null;
};

export type Vendedor = { id: string; nome: string; funcao: "sdr" | "closer" | "gestao"; ativo: boolean; foto_url?: string | null };
export type Numero = { id: string; vendedor_id: string; nome: string; numero: string | null; status: string; horario: Horario | null };

// Tudo que a tela edita e manda de uma vez no Salvar
export type Estado = {
  settings: Settings;
  vendedores: Vendedor[];
  numeros: Numero[];
  ignorados: string[];
  alertas: string[];
  rubricas: Rubricas;
};

export const SUGESTOES = {
  critico: [
    "Lead ameaçou reclamar publicamente ou no Procon",
    "Lead pediu para não ser mais contatado e o contato continuou",
    "SDR ou closer prometeu algo que a Weevo não oferece",
    "Lead pediu reembolso ou cancelamento da inscrição",
    "Atendente foi grosseiro ou desrespeitoso",
    "Lead sem resposta há mais de 1 dia útil",
    "Erro no valor cobrado ou cobrança duplicada",
  ],
  venda_conta: [
    "Lead confirmou a inscrição no workshop",
    "Lead usou cupom de convite do workshop",
    "Lead enviou comprovante de pagamento",
    "Lead assinou o contrato da imersão",
    "Lead pagou a entrada da imersão",
    "Lead enviou print da inscrição concluída",
  ],
  venda_nao_conta: [
    "Lead disse \"vou pensar\"",
    "Pagamento prometido mas não confirmado",
    "Reunião marcada (é oportunidade, não venda)",
    "Pediu desconto e não respondeu",
    "Reservou vaga sem confirmar",
  ],
  oportunidade_conta: [
    "Lead quer saber datas ou valores do workshop",
    "Lead quer saber sobre a imersão",
    "Reunião de imersão marcada",
    "Reunião de implementação marcada",
    "Lead pediu condição de pagamento",
    "Lead comparou com outro curso",
  ],
  oportunidade_nao_conta: [
    "Curiosidade sem intenção",
    "Conversa pessoal sem contexto comercial",
    "Spam ou bot",
    "Proposta de parceria ou currículo",
    "Reclamação sem intenção de participar",
  ],
};

// 55 + DDD + numero. Aceita com ou sem 55, com espacos, tracos e parenteses.
export function normalizarTelefone(t: string): string | null {
  let d = t.replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return /^55\d{10,11}$/.test(d) ? d : null;
}
export const fmtTelefone = (t: string) => {
  const m = t.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : t;
};

export const somaPesos = (l: Criterio[]) => l.filter((c) => c.ativo).reduce((s, c) => s + (Number(c.peso) || 0), 0);
export const chaveDe = (nome: string, usadas: string[]) => {
  const base = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "criterio";
  let k = base, i = 2;
  while (usadas.includes(k)) k = `${base}_${i++}`;
  return k;
};
const hora = (h: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h);
const inteiro = (n: unknown, min: number, max: number) => Number.isInteger(n) && (n as number) >= min && (n as number) <= max;
const limparLista = (l: string[]) => [...new Set(l.map((x) => x.trim()).filter(Boolean))].slice(0, 50);

// Validacao unica: a tela mostra estes erros e a Server Action recusa com eles
export function validar(e: Estado): string[] {
  const s = e.settings, erros: string[] = [];
  if (!["todas", "individual", "grupo"].includes(s.escopo_conversas)) erros.push("Tipo de conversa inválido.");
  if (s.min_mensagens !== null && !inteiro(s.min_mensagens, 1, 200)) erros.push("Mínimo de mensagens: use um número de 1 a 200.");
  if (s.amostragem_pct !== null && !inteiro(s.amostragem_pct, 1, 100)) erros.push("Amostragem: use de 1% a 100%.");
  if (!inteiro(s.sla_primeira_resposta_min, 1, 10080)) erros.push("SLA de 1ª resposta: de 1 minuto a 7 dias.");
  if (!inteiro(s.followup_sem_resposta_h, 1, 720)) erros.push("Follow-up: \"sem resposta\" precisa ser de 1 a 720 horas.");
  if (!inteiro(s.followup_abandonada_d, 1, 90)) erros.push("Follow-up: \"abandonada\" precisa ser de 1 a 90 dias.");
  if (!inteiro(s.followup_limite_d, 1, 365)) erros.push("Follow-up: \"deixa de contar\" precisa ser de 1 a 365 dias.");
  if (s.followup_limite_d <= s.followup_abandonada_d) erros.push("Follow-up: \"deixa de contar\" tem que ser depois de \"abandonada\".");
  if (!["desligado", "empresa", "numero"].includes(s.horario_modo)) erros.push("Horário de funcionamento inválido.");
  const horarios: [string, Horario][] = [["da empresa", s.horario_empresa], ...e.numeros.filter((n) => n.horario).map((n) => [`do número ${n.nome}`, n.horario!] as [string, Horario])];
  for (const [onde, h] of horarios) if (!hora(h.inicio) || !hora(h.fim) || h.inicio >= h.fim || !h.dias.length) erros.push(`Horário ${onde}: escolha os dias e um início antes do fim.`);
  if (!["resumido", "detalhado"].includes(s.alerta_formato)) erros.push("Formato do alerta inválido.");
  if (!(HORAS_RESUMO as readonly string[]).includes(s.resumo_hora)) erros.push("Horário do resumo inválido.");
  if (s.auditoria_parada_min !== null && !inteiro(s.auditoria_parada_min, 10, 1440)) erros.push("Auditar durante o dia: use de 10 minutos a 24 horas parada.");
  if (!hora(s.rodada_final_hora) || !hora(s.resumo_manha_hora)) erros.push("Resumos: escolha horários válidos.");
  else if (s.resumo_manha_hora >= s.rodada_final_hora) erros.push("Resumos: o da manhã tem que sair antes do da tarde e do dia.");
  if (!inteiro(s.followup_alerta_d, 1, 60)) erros.push("Alerta de follow-up: use de 1 a 60 dias sem contato.");
  if (!inteiro(s.historico_dias, 0, 30)) erros.push("Histórico do lead: use de 0 a 30 dias.");
  if (!inteiro(s.agenda_duracao_min, 15, 480)) erros.push("Agenda Google: a reunião precisa durar de 15 minutos a 8 horas.");
  if (s.resumo_ativo && !s.resumo_dias.length) erros.push("Resumo diário: escolha pelo menos um dia.");
  if (e.alertas.length > 3) erros.push("No máximo 3 telefones de alerta.");
  const envio = e.numeros.find((n) => n.id === s.instancia_envio_id)?.numero;
  if (envio && e.alertas.some((t) => normalizarTelefone(t) === normalizarTelefone(envio))) erros.push("O WhatsApp que envia não pode estar também em quem recebe: a mensagem cairia no \"conversar comigo mesmo\", sem notificação.");
  for (const t of [...e.alertas, ...e.ignorados]) if (!normalizarTelefone(t)) erros.push(`Telefone inválido: ${t}`);
  if (!inteiro(s.meta_sdr_conversas, 0, 1000) || !inteiro(s.meta_sdr_marcacoes, 0, 1000)) erros.push("Metas do SDR: use números de 0 a 1000.");
  for (const m of [s.meta_closer_reunioes, s.meta_closer_vendas]) if (m !== null && !inteiro(m, 0, 1000)) erros.push("Metas do closer: use números de 0 a 1000.");
  if (s.meta_fat_mes != null && !inteiro(s.meta_fat_mes, 0, 100000000)) erros.push("Meta de faturamento: use um valor em reais de 0 a 100.000.000.");
  erros.push(...validarQuadros(s.tv_quadros));
  for (const v of e.vendedores) if (!["sdr", "closer"].includes(v.funcao)) erros.push(`Função inválida para ${v.nome}.`);
  const rubricas: [string, Criterio[]][] = s.rubrica_modo === "personalizada" ? [["personalizada", e.rubricas.personalizada]] : [["do SDR", e.rubricas.sdr], ["do Closer", e.rubricas.closer]];
  for (const [nome, l] of rubricas) {
    if (!l.some((c) => c.ativo)) erros.push(`Rubrica ${nome}: deixe pelo menos um critério ativo.`);
    else if (somaPesos(l) !== 100) erros.push(`Rubrica ${nome}: os pesos somam ${somaPesos(l)}%, precisam somar 100%.`);
    for (const c of l) if (!c.nome.trim() || !inteiro(c.peso, 0, 100)) erros.push(`Rubrica ${nome}: todo critério precisa de nome e peso de 0 a 100.`);
  }
  return [...new Set(erros)];
}

// Limpa listas e telefones antes de salvar
export function limpar(e: Estado): Estado {
  const s = e.settings;
  return {
    ...e,
    settings: { ...s, regras_criticas: limparLista(s.regras_criticas), venda_conta: limparLista(s.venda_conta), venda_nao_conta: limparLista(s.venda_nao_conta), oportunidade_conta: limparLista(s.oportunidade_conta), oportunidade_nao_conta: limparLista(s.oportunidade_nao_conta), resumo_dias: [...new Set(s.resumo_dias)].sort() },
    ignorados: [...new Set(e.ignorados.map((t) => normalizarTelefone(t) ?? t))],
    alertas: [...new Set(e.alertas.map((t) => normalizarTelefone(t) ?? t))],
  };
}

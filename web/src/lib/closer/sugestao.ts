// "Ler conversa" do painel do Closer: formato da sugestao que o worker devolve e a validacao feita de novo no site
import { MOTIVOS, STATUS, type Status } from "./regras";

export type Sugestao = {
  status: Status | null; motivo: string; resumo: string; proxima_acao: string; sugestao_resposta: string;
  evidencia: string[]; confianca: "alta" | "media" | "baixa"; dias_sem_resposta?: number;
};
export type ResultadoSugestao =
  | { erro: string }
  | { encontrou: false }
  | { encontrou: true; mensagens: number; ultima_msg_em: string | null; sugestao: Sugestao };

const texto = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

// Status e motivo so dentro das listas de regras.ts; o resto com tamanho limitado
export function validarSugestao(b: unknown): Sugestao {
  const o = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
  const status = typeof o.status === "string" && Object.hasOwn(STATUS, o.status) ? (o.status as Status) : null;
  const motivo = typeof o.motivo === "string" && status === "desqualificado" && MOTIVOS.includes(o.motivo) ? o.motivo : "";
  const confianca = o.confianca === "alta" || o.confianca === "media" ? o.confianca : "baixa";
  const dias = o.dias_sem_resposta == null ? NaN : Number(o.dias_sem_resposta);
  return {
    status, motivo, confianca,
    resumo: texto(o.resumo, 400), proxima_acao: texto(o.proxima_acao, 200), sugestao_resposta: texto(o.sugestao_resposta, 1000),
    evidencia: (Array.isArray(o.evidencia) ? o.evidencia : []).slice(0, 3).map((e) => texto(e, 200)).filter(Boolean),
    ...(Number.isFinite(dias) ? { dias_sem_resposta: dias } : {}),
  };
}

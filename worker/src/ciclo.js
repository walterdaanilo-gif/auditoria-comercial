import { today } from "./config.js";
import { runAudits } from "./auditor.js";
import { enviarRelatorio, horaAgora } from "./relatorio.js";
import { avisarFollowups } from "./followup.js";

// Uma volta do laco de auditoria. Duas vezes por dia (Configuracoes, padrao 13:00 e 19:00), uma vez cada:
// audita tudo o que mudou no dia, sem esperar a conversa ficar parada, e manda o resumo ao gestor.
// 13h: resumo do turno da manha + alerta de follow-up atrasado. 19h: resumo da tarde e do dia completo.
// ate: horario limite da execucao. Se a rodada do turno nao terminar a tempo, o resumo espera a proxima volta (5 min).
export async function cicloDeAuditoria(db, { hora = horaAgora(), envio, ate = null } = {}) {
  const [s] = await db.select("audit_settings", { select: "rodada_final_hora,rodada_final_ultima,resumo_manha_hora,resumo_manha_ultima", filters: { id: "eq.1" } });
  const hoje = today();
  const tarde = !!s && hora >= (s.rodada_final_hora || "19:00") && s.rodada_final_ultima !== hoje;
  const manha = !!s && !tarde && hora >= (s.resumo_manha_hora || "13:00") && s.resumo_manha_ultima !== hoje;
  const estado = {};
  const n = await runAudits(db, { final: manha || tarde, ate, estado });
  if ((manha || tarde) && estado.incompleto) { console.log(`[auditoria] rodada do turno em andamento: ${n} auditorias, continua na proxima volta`); return n; }
  const opts = envio ? { envio } : {};
  if (manha) {
    await db.update("audit_settings", { id: "eq.1" }, { resumo_manha_ultima: hoje });
    console.log(`[auditoria] rodada do turno da manha: ${n} auditorias`);
    console.log(`[relatorio] ${await enviarRelatorio(db, { turno: "manha", ...opts })}`);
    try { console.log(`[followup] ${await avisarFollowups(db, opts)}`); } catch (e) { console.error("[followup]", e.message); }
  }
  if (tarde) {
    await db.update("audit_settings", { id: "eq.1" }, { rodada_final_ultima: hoje, resumo_manha_ultima: hoje });
    console.log(`[auditoria] rodada final do dia: ${n} auditorias`);
    console.log(`[relatorio] ${await enviarRelatorio(db, { turno: "dia", ...opts })}`);
  }
  return n;
}

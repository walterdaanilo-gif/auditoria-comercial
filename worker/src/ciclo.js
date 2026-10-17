import { today } from "./config.js";
import { runAudits } from "./auditor.js";
import { enviarRelatorio, horaAgora } from "./relatorio.js";

// Uma volta do laco de auditoria. Depois do horario da rodada final (Configuracoes, padrao 18:00), uma vez por dia:
// audita tudo o que mudou no dia, sem esperar a conversa ficar parada, e manda o relatorio do dia ao gestor.
export async function cicloDeAuditoria(db, { hora = horaAgora(), envio } = {}) {
  const [s] = await db.select("audit_settings", { select: "rodada_final_hora,rodada_final_ultima", filters: { id: "eq.1" } });
  const hoje = today();
  const final = !!s && hora >= (s.rodada_final_hora || "18:00") && s.rodada_final_ultima !== hoje;
  const n = await runAudits(db, { final });
  if (final) {
    await db.update("audit_settings", { id: "eq.1" }, { rodada_final_ultima: hoje });
    console.log(`[auditoria] rodada final do dia: ${n} auditorias`);
    console.log(`[relatorio] ${await enviarRelatorio(db, envio ? { envio } : {})}`);
  }
  return n;
}

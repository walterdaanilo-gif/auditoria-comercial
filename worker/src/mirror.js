import fs from "node:fs";
import { cfg, today, addDays, dayStart, dayOf, phoneOf } from "./config.js";
import { writeDayRow, appendMessages, upsertAudit, temChaveGoogle } from "./google.js";

export const mirrorEnabled = () => !!cfg.sheetId && temChaveGoogle();
const lastSent = {};
const hora = iso => new Intl.DateTimeFormat("pt-BR", { timeZone: cfg.tz, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(iso));

// Metricas do dia de um vendedor, calculadas a partir das mensagens no Supabase
export function calcDay(msgs, auds) {
  const por = new Map();
  for (const m of msgs) { const l = por.get(m.conversa_id) || []; l.push(m); por.set(m.conversa_id, l); }
  let contatadas = 0, enviadas = 0, respondidas = 0;
  for (const l of por.values()) {
    l.sort((a, b) => a.enviada_em.localeCompare(b.enviada_em));
    const env = l.filter(m => m.remetente === "vendedor");
    if (!env.length) continue;
    contatadas++; enviadas += env.length;
    if (l.some(m => m.remetente === "cliente" && m.enviada_em > env[0].enviada_em)) respondidas++;
  }
  return { contatadas, enviadas, respondidas, efetivas: auds.filter(a => a.efetiva).length, agendadosMsg: auds.filter(a => a.agendou).length };
}

// Espelho do Supabase na planilha do Google (o dash antigo continua lendo a aba SDR)
export async function mirrorAll(db) {
  if (!mirrorEnabled()) return;
  const perfis = new Map((await db.select("profiles", { select: "id,nome" })).map(p => [p.id, p.nome]));
  const from = addDays(today(), -cfg.daysBack);
  // conversas importadas (tela Testar auditor) nao vao para a planilha
  const convs = await db.selectAll("conversas", { select: "id,vendedor_id,contato,data", filters: { data: `gte.${addDays(today(), -7)}`, canal: "neq.importada" } });
  const convMap = new Map(convs.map(c => [c.id, c]));

  // 1) mensagens novas
  if (cfg.sheetMessages) {
    for (;;) {
      const rows = await db.select("mensagens", { select: "id,conversa_id,wa_id,remetente,texto,tipo,transcricao,enviada_em", filters: { espelhada: "eq.false" }, order: "enviada_em", limit: 400 });
      if (!rows.length) break;
      const ok = rows.filter(r => convMap.has(r.conversa_id));
      await appendMessages(ok.map(r => { const c = convMap.get(r.conversa_id); return { day: dayOf(r.enviada_em), hora: hora(r.enviada_em), vendedor: perfis.get(c.vendedor_id) || "—", remetente: r.remetente, contato: phoneOf(c.contato), texto: r.tipo === "audio" ? `[audio] ${r.transcricao || ""}` : r.texto || `[${r.tipo}]`, id: r.wa_id }; }));
      await db.update("mensagens", { id: `in.(${rows.map(r => r.id).join(",")})` }, { espelhada: true });
      if (rows.length < 400) break;
    }
  }

  // 2) auditorias novas ou reauditadas
  const pend = await db.select("auditorias", { filters: { sheet_ok: "eq.false", conversa_id: "not.is.null" }, order: "atualizado_em", limit: 100 });
  for (const a of pend) {
    const c = convMap.get(a.conversa_id) || (await db.select("conversas", { filters: { id: `eq.${a.conversa_id}` } }))[0];
    if (!c) continue;
    const row = await upsertAudit({ ...a, day: c.data, vendedor: perfis.get(a.vendedor_id) || "—", contato: phoneOf(c.contato) });
    await db.update("auditorias", { id: `eq.${a.id}` }, { sheet_ok: true, sheet_row: row });
  }

  // 3) metricas do dia na aba SDR (so escreve quando muda)
  for (let back = 0; back <= cfg.daysBack; back++) {
    const day = addDays(today(), -back);
    const msgs = await db.selectAll("mensagens", { select: "conversa_id,vendedor_id,remetente,enviada_em", filters: { enviada_em: `gte.${dayStart(day)}` }, order: "id" });
    const doDia = msgs.filter(m => dayOf(m.enviada_em) === day && convMap.has(m.conversa_id));
    const audsDia = (await db.selectAll("auditorias", { select: "vendedor_id,conversa_id,efetiva,agendou", filters: { conversa_id: "not.is.null" } })).filter(a => convMap.get(a.conversa_id)?.data === day);
    for (const [id, nome] of perfis) {
      const m = calcDay(doDia.filter(x => x.vendedor_id === id), audsDia.filter(a => a.vendedor_id === id));
      const key = `${day}|${id}`, sig = JSON.stringify(m);
      if (lastSent[key] === sig || (!m.contatadas && !m.respondidas)) continue;
      const r = await writeDayRow(day, nome, m);
      if (r.ok) lastSent[key] = sig; else console.log(`[planilha] ${day} ${nome}: ${r.reason}`);
    }
  }
}

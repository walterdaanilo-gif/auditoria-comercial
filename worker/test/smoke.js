// Teste sem rede: grava mensagens, audita (IA simulada), transcreve (Whisper simulado) e gera analise
import assert from "node:assert";
process.env.ANTHROPIC_API_KEY = "x"; process.env.TRANSCRIBE_API_KEY = "x";
const { fakeSupa } = await import("./fakeSupa.js");
const { saveMessage } = await import("../src/whatsapp.js");
const { runAudits } = await import("../src/auditor.js");
const { transcribePending } = await import("../src/transcribe.js");
const { processAnalyses } = await import("../src/analysis.js");
const { calcDay } = await import("../src/mirror.js");

const db = fakeSupa();
const VEND = "00000000-0000-0000-0000-0000000000c1", INST = { id: "i1", vendedor_id: VEND, nome: "WA do Ruan" };
db.tables.profiles = [{ id: VEND, nome: "Ruan" }];
db.tables.config_auditoria = [{ id: 1, roteiro: "Roteiro de teste", criterios: ["abertura", "descoberta", "beneficio", "objecoes", "chamada_para_acao", "tom"] }];
const t0 = Math.floor(Date.now() / 1000) - 3 * 3600;
const m = (jid, i, fromMe, text, extra = {}) => ({ key: { remoteJid: jid + "@s.whatsapp.net", id: `${jid}-${i}`, fromMe }, messageTimestamp: t0 + i * 60, pushName: "Ana", message: text ? { conversation: text } : extra.message, ...extra });
const A = "5511911110001", B = "5511911110002";

await saveMessage(db, INST, m(A, 1, true, "Oi Ana, vim pela indicacao da oficina X"));
await saveMessage(db, INST, m(A, 2, false, "Oi! Pode falar"));
await saveMessage(db, INST, m(A, 3, true, "Workshop quinta 19h, topa?"));
await saveMessage(db, INST, m(A, 4, false, null, { message: { audioMessage: {} } })); // audio (sem baixar: sem sock)
await saveMessage(db, INST, m(B, 1, true, "Oi Carlos"));
await saveMessage(db, INST, m(B, 1, true, "Oi Carlos")); // duplicada: nao pode repetir
await saveMessage(db, { ...INST }, { key: { remoteJid: "1203@g.us", id: "g1", fromMe: false }, message: { conversation: "grupo" } }); // grupo ignorado
assert.equal(db.tables.conversas.length, 2); assert.equal(db.tables.mensagens.length, 5);
assert.equal(db.tables.conversas.find(c => c.contato === A).contato_nome, "Ana");

// ----- audio: transcricao (Whisper simulado) -----
const au = db.tables.mensagens.find(x => x.tipo === "audio");
au.audio_url = `${VEND}/whatsapp/i1/a.ogg`; db.files.set(au.audio_url, Buffer.from("fake"));
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => { assert(String(u).includes("audio/transcriptions")); return { ok: true, json: async () => ({ text: "topo sim, quinta 19h" }) }; };
assert.equal(await transcribePending(db), 1);
assert.equal(au.transcricao, "topo sim, quinta 19h");
globalThis.fetch = realFetch;

// ----- auditoria (IA simulada) -----
const ia = async (_u, o) => {
  const conv = JSON.parse(o.body).messages[0].content; const ok = conv.includes("topo sim");
  return { ok: true, json: async () => ({ content: [{ text: "```json\n" + JSON.stringify({ nota_geral: ok ? 8.5 : 4, notas: { abertura: 9, descoberta: 7 }, qualidade: ok ? "boa" : "ruim", etapa: ok ? "agendamento" : "sem_resposta", efetiva: ok, agendou: ok, gatilhos: { personalizacao: true, chamada_para_acao: ok, prova_social: ok }, resumo: "r", pontos_fortes: "f", pontos_melhoria: "m", objecoes: ok ? "" : "sem tempo" }) + "\n```" }] }) };
};
assert.equal(await runAudits(db, { fetchImpl: ia }), 2);
const audA = db.tables.auditorias.find(a => a.conversa_id === db.tables.conversas.find(c => c.contato === A).id);
assert.equal(audA.nota_geral, 8.5); assert.equal(audA.agendou, true); assert.equal(audA.notas.abertura, 9); assert.equal(audA.notas.tom, 0);
assert.equal(await runAudits(db, { fetchImpl: ia }), 0); // sem mensagem nova: nao reaudita

// reauditoria preserva a linha da planilha
audA.sheet_row = 12; audA.sheet_ok = true;
await saveMessage(db, INST, m(A, 9, true, "Confirmado entao!"));
assert.equal(await runAudits(db, { fetchImpl: ia }), 1);
assert.equal(audA.sheet_row, 12); assert.equal(audA.sheet_ok, false); assert.equal(audA.msg_count, 5);

// ----- metricas do espelho -----
const msgs = db.tables.mensagens.map(x => ({ conversa_id: x.conversa_id, vendedor_id: x.vendedor_id, remetente: x.remetente, enviada_em: x.enviada_em }));
const d = calcDay(msgs, db.tables.auditorias);
assert.equal(d.contatadas, 2); assert.equal(d.respondidas, 1); assert.equal(d.agendadosMsg, 1);

// ----- analise do time -----
db.tables.analises_time = [{ id: "a1", periodo: "7", status: "pendente", criado_em: new Date().toISOString() }];
await processAnalyses(db, { fetchImpl: async () => ({ ok: true, json: async () => ({ content: [{ text: "## Veredito\nTime ok" }] }) }) });
assert.equal(db.tables.analises_time.find(a => a.id === "a1").status, "pronta");
console.log("OK: gravacao, transcricao, auditoria, reauditoria, metricas e analise");

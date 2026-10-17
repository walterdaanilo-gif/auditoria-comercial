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
  return { ok: true, json: async () => ({ content: [{ text: "```json\n" + JSON.stringify({ notas: [{ criterio: "abordagem", nota: 5, justificativa: "citou a indicacao" }, { criterio: "descoberta", nota: ok ? 4 : 1 }, { criterio: "conducao", nota: ok ? 5 : 1 }], qualidade: ok ? "boa" : "ruim", etapa: ok ? "agendamento" : "sem_resposta", efetiva: ok, agendou: ok, venda: { detectada: ok, tipo: "workshop", valor: 0, cupom: true, evidencia: "topo sim" }, gatilhos: { personalizacao: true, chamada_para_acao: ok, prova_social: ok }, resumo: "r", pontos_fortes: "f", pontos_melhoria: "m", objecoes: ok ? "" : "sem tempo" }) + "\n```" }] }) };
};
// as duas filas: a rapida (sinal de venda ou marcacao, auditar agora) e a normal (conversa parada)
const rodar = async () => (await runAudits(db, { fetchImpl: ia, soSinais: true })) + (await runAudits(db, { fetchImpl: ia }));
assert.ok(db.tables.conversas.find(c => c.contato === A).auditar_rapido, "\"quinta 19h\" e sinal de marcacao: vai para a fila rapida");
assert.equal(await rodar(), 1); // so a Ana respondeu; o Carlos nao, entao nao e auditado
assert.ok(!db.tables.auditorias.some(a => a.conversa_id === db.tables.conversas.find(c => c.contato === B).id), "conversa sem resposta nao e auditada");
// quando o Carlos responder, a conversa dele entra na fila
await saveMessage(db, INST, m(B, 2, false, "Oi, quem fala?"));
assert.equal(await rodar(), 0, "2 mensagens: abaixo do minimo padrao (4)");
db.tables.audit_settings = [{ id: 1, min_mensagens: 2 }]; // valor proprio na tela Configuracoes
assert.equal(await rodar(), 1);
const audA = db.tables.auditorias.find(a => a.conversa_id === db.tables.conversas.find(c => c.contato === A).id);
assert.equal(audA.nota_geral, 9.4); assert.equal(audA.agendou, true); assert.equal(audA.notas.abordagem, 10);
assert.equal(audA.venda, true); assert.equal(audA.venda_tipo, "workshop"); assert.equal(audA.venda_cupom, true); assert.equal(audA.venda_valor, 0);
assert.equal(audA.notas_1a5[0].justificativa, "citou a indicacao");
assert.equal(await rodar(), 0); // sem mensagem nova: nao reaudita

// reauditoria preserva a linha da planilha
audA.sheet_row = 12; audA.sheet_ok = true;
await saveMessage(db, INST, m(A, 9, true, "Confirmado entao!"));
assert.equal(await rodar(), 1);
assert.equal(audA.sheet_row, 12); assert.equal(audA.sheet_ok, false); assert.equal(audA.msg_count, 5);

// ----- conversa importada (tela Testar auditor): de 10 dias atras, auditada uma vez, fora da planilha -----
const velha = new Date(Date.now() - 10 * 86400000);
db.tables.conversas.push({ id: "imp1", vendedor_id: VEND, instancia_id: null, contato: "Maria", contato_nome: "Maria", canal: "importada", data: velha.toISOString().slice(0, 10), ultima_msg_em: velha.toISOString() });
db.tables.mensagens.push(
  { id: "im1", conversa_id: "imp1", vendedor_id: VEND, wa_id: "imp-1", remetente: "vendedor", texto: "Oi Maria, workshop quinta?", tipo: "texto", enviada_em: velha.toISOString(), espelhada: true },
  { id: "im2", conversa_id: "imp1", vendedor_id: VEND, wa_id: "imp-2", remetente: "cliente", texto: "topo sim, quinta 19h", tipo: "texto", enviada_em: velha.toISOString(), espelhada: true });
assert.equal(await rodar(), 1);
const audImp = db.tables.auditorias.find(a => a.conversa_id === "imp1");
assert.equal(audImp.nota_geral, 9.4); assert.equal(audImp.sheet_ok, true, "importada nao vai para a planilha");
assert.equal(await rodar(), 0, "importada so e auditada uma vez");
db.tables.conversas = db.tables.conversas.filter(c => c.id !== "imp1"); db.tables.mensagens = db.tables.mensagens.filter(x => x.conversa_id !== "imp1");
db.tables.auditorias = db.tables.auditorias.filter(a => a.conversa_id !== "imp1");

// ----- metricas do espelho -----
const msgs = db.tables.mensagens.map(x => ({ conversa_id: x.conversa_id, vendedor_id: x.vendedor_id, remetente: x.remetente, enviada_em: x.enviada_em }));
const d = calcDay(msgs, db.tables.auditorias);
assert.equal(d.contatadas, 2); assert.equal(d.respondidas, 2); assert.equal(d.agendadosMsg, 1);

// ----- analise do time -----
db.tables.analises_time = [{ id: "a1", periodo: "7", status: "pendente", criado_em: new Date().toISOString() }];
await processAnalyses(db, { fetchImpl: async () => ({ ok: true, json: async () => ({ content: [{ text: "## Veredito\nTime ok" }] }) }) });
assert.equal(db.tables.analises_time.find(a => a.id === "a1").status, "pronta");
console.log("OK: gravacao, transcricao, auditoria, reauditoria, metricas e analise");

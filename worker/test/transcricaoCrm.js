// Audios do CRM Q5: link renovado na lista do Q5, transcricao nas duas tabelas, conversa auditada volta para a fila
import assert from "node:assert/strict";
import { cfg, today } from "../src/config.js";
import { fakeSupa } from "./fakeSupa.js";
import { transcreverCrm } from "../src/transcribe.js";

cfg.q5Key = "q5"; cfg.transcribeKey = "sk";
const db = fakeSupa();
const agora = new Date().toISOString();
db.tables.conversas = [{ id: "c1", data: today() }, { id: "c2", data: today() }];
db.tables.auditorias = [{ id: "a1", conversa_id: "c1" }];
db.tables.mensagens = [
  { id: "m1", conversa_id: "c1", wa_id: "crm:q1", tipo: "audio", transcricao: null, enviada_em: agora },
  { id: "m2", conversa_id: "c2", wa_id: "crm:q2", tipo: "audio", transcricao: null, enviada_em: agora },
  { id: "m3", conversa_id: "c2", wa_id: "crm:q3", tipo: "audio", transcricao: null, enviada_em: agora },
  { id: "m4", conversa_id: "c2", wa_id: "ABC", tipo: "audio", transcricao: null, enviada_em: agora }, // WhatsApp: fica com o outro fluxo
];
db.tables.crm_mensagens = [{ id: "q1", conversa_id: "chatA" }, { id: "q2", conversa_id: "chatB" }, { id: "q3", conversa_id: "chatB" }];

const pedidos = [];
const f = async (url, o = {}) => {
  url = String(url); pedidos.push(url);
  if (url.includes("/conversations/chatA/messages")) return { ok: true, json: async () => ({ data: [{ id: "q1", mediaUrl: "https://s3/q1.mp3?sig=novo", createdAt: "1" }], hasMore: false }) };
  if (url.includes("/conversations/chatB/messages") && !url.includes("before=")) return { ok: true, json: async () => ({ data: [{ id: "x9", mediaUrl: null, createdAt: "2" }, { id: "q3", mediaUrl: "https://s3/q3.mp3", createdAt: "3" }], hasMore: true }) };
  if (url.includes("/conversations/chatB/messages")) return { ok: true, json: async () => ({ data: [{ id: "q2", mediaUrl: "https://s3/q2.mp3", createdAt: "1" }], hasMore: false }) };
  if (url.startsWith("https://s3/q3")) return { ok: false, status: 403 };
  if (url.startsWith("https://s3/")) return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  if (url.includes("audio/transcriptions")) { assert.equal(o.headers.Authorization, "Bearer sk"); return { ok: true, json: async () => ({ text: url && "fechado, mandei o pix" }) }; }
  throw new Error("inesperado " + url);
};

assert.equal(await transcreverCrm(db, { fetchImpl: f }), 2);
const t = id => db.tables.mensagens.find(m => m.id === id).transcricao;
assert.equal(t("m1"), "fechado, mandei o pix");
assert.equal(t("m2"), "fechado, mandei o pix", "achou o link na segunda pagina (before)");
assert.equal(t("m3"), "[nao foi possivel transcrever]", "falha nao trava a fila");
assert.equal(t("m4"), null);
assert.equal(db.tables.crm_mensagens.find(m => m.id === "q1").transcricao, "fechado, mandei o pix");
assert.ok(pedidos.some(u => u.includes("chatB/messages?limit=100&before=x9")));
assert.equal(db.tables.conversas.find(c => c.id === "c1").auditar_rapido, true, "auditada sem o audio: reaudita");
assert.equal(db.tables.conversas.find(c => c.id === "c2").auditar_rapido, true, "sinal de venda no audio");
assert.equal(await transcreverCrm(db, { fetchImpl: f }), 0, "nada pendente");
cfg.q5Key = ""; cfg.transcribeKey = "";
console.log("OK: audios do CRM transcritos (link renovado, duas tabelas, reauditoria, falha sem travar)");

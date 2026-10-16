// Teste do espelho na planilha com Google simulado
import assert from "node:assert";
import fs from "node:fs"; import crypto from "node:crypto";
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
fs.mkdirSync("/tmp/sa2", { recursive: true }); fs.writeFileSync("/tmp/sa2/sa.json", JSON.stringify({ client_email: "x@y", private_key: privateKey }));
process.env.SHEET_ID = "abc"; process.env.GOOGLE_SERVICE_ACCOUNT_FILE = "/tmp/sa2/sa.json";
const { fakeSupa } = await import("./fakeSupa.js");
const { cfg, today, sheetSerial } = await import("../src/config.js");
const { mirrorAll } = await import("../src/mirror.js");

const db = fakeSupa(); const V = "v1";
db.tables.profiles = [{ id: V, nome: "Ruan" }];
const iso = new Date().toISOString();
db.tables.conversas = [{ id: "c1", vendedor_id: V, contato: "5511911110001", data: today() }];
db.tables.mensagens = [
  { id: "m1", conversa_id: "c1", vendedor_id: V, wa_id: "w1", remetente: "vendedor", texto: "=HYPERLINK(1)", tipo: "texto", enviada_em: new Date(Date.now() - 60000).toISOString(), espelhada: false },
  { id: "m2", conversa_id: "c1", vendedor_id: V, wa_id: "w2", remetente: "cliente", texto: "oi", tipo: "texto", enviada_em: iso, espelhada: false }];
db.tables.auditorias = [{ id: "a1", conversa_id: "c1", ligacao_id: null, vendedor_id: V, nota_geral: 8, efetiva: true, agendou: true, gatilhos: { prova_social: true }, msg_count: 2, sheet_ok: false, sheet_row: null, atualizado_em: iso }];

const calls = [];
globalThis.fetch = async (u, o = {}) => {
  const url = String(u); calls.push([o.method || "GET", url, o.body]);
  const j = url.includes("oauth2") ? { access_token: "t", expires_in: 3600 }
    : url.includes("fields=sheets") ? { sheets: [{ properties: { title: "SDR" } }] }
    : url.includes("A32:B200") ? { values: [[sheetSerial(today()), "Ruan"]] }
    : url.includes(":append") ? { updates: { updatedRange: "Auditoria!A5:M5" } } : {};
  return { ok: true, json: async () => j };
};
await mirrorAll(db);
assert(db.tables.mensagens.every(m => m.espelhada), "mensagens marcadas como espelhadas");
assert.equal(db.tables.auditorias[0].sheet_row, 5); assert.equal(db.tables.auditorias[0].sheet_ok, true);
const upd = calls.find(c => c[1].includes("values:batchUpdate"));
assert(upd, "escreveu metricas na aba SDR"); const data = JSON.parse(upd[2]).data;
assert.deepEqual(data.map(d => d.values[0][0]), [1, 1, 1, 1, 1]); // D contatadas, G enviadas, H respondidas, I efetivas, K agendados
const msgApp = calls.find(c => c[1].includes("Mensagens") && c[1].includes("append")); assert(msgApp.at(-1).includes('"=HYPERLINK(1)"') && msgApp[1].includes("valueInputOption=RAW"));
const n = calls.length; await mirrorAll(db); assert(!calls.slice(n).some(c => c[1].includes("values:batchUpdate")), "sem mudanca, nao reescreve");
console.log("OK: espelho na planilha (mensagens, auditoria e metricas do dia)");

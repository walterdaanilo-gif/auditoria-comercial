// Teste sem rede da conexao pela Uazapi: cria instancia, gera QR, conecta, recebe mensagens pelo webhook e remove
import assert from "node:assert";
process.env.UAZAPI_URL = "https://teste.uazapi.com"; process.env.UAZAPI_ADMIN_TOKEN = "ADM";
process.env.WEBHOOK_URL = "https://worker.exemplo.app"; process.env.WEBHOOK_SECRET = "segredo123";
const { fakeSupa } = await import("./fakeSupa.js");
const { syncUazapi, receberWebhook, segredoOk, normalizar } = await import("../src/uazapi.js");

// ---- Uazapi simulada ----
const uaz = { insts: [], chamadas: [], estado: "disconnected", qr: "", owner: "" };
globalThis.fetch = async (url, { method, headers, body }) => {
  const u = new URL(url); const b = body ? JSON.parse(body) : {};
  uaz.chamadas.push(`${method} ${u.pathname}`);
  const ok = obj => ({ ok: true, status: 200, text: async () => JSON.stringify(obj) });
  const inst = uaz.insts.find(i => i.token === headers.token);
  if (u.pathname === "/instance/create") { assert.equal(headers.admintoken, "ADM"); const i = { name: b.name, token: "tok-" + uaz.insts.length }; uaz.insts.push(i); return ok({ token: i.token, instance: i }); }
  if (u.pathname === "/instance/all") { assert.equal(headers.admintoken, "ADM"); return ok(uaz.insts); }
  if (!inst) return { ok: false, status: 401, text: async () => JSON.stringify({ error: "Invalid token" }) };
  if (u.pathname === "/webhook") { inst.webhook = b; return ok([b]); }
  if (u.pathname === "/instance/connect") { uaz.estado = "connecting"; uaz.qr = "data:image/png;base64,QR1"; return ok({ connected: false }); }
  if (u.pathname === "/instance/disconnect") { uaz.estado = "disconnected"; uaz.qr = ""; return ok({ response: "Disconnected" }); }
  if (u.pathname === "/instance/status") return ok({ instance: { status: uaz.estado, qrcode: uaz.qr, owner: uaz.owner }, status: { connected: uaz.estado === "connected", loggedIn: uaz.estado === "connected" } });
  if (u.pathname === "/message/download") return ok({ base64Data: Buffer.from("audio-ogg").toString("base64") });
  if (u.pathname === "/instance" && method === "DELETE") { uaz.insts = uaz.insts.filter(i => i !== inst); return ok({ response: "Instance Deleted" }); }
  throw new Error("rota nao simulada: " + u.pathname);
};

const db = fakeSupa();
const VEND = "00000000-0000-0000-0000-0000000000c1", ID = "11111111-1111-1111-1111-111111111111";
db.tables.instancias_whatsapp = [{ id: ID, vendedor_id: VEND, nome: "WhatsApp do Ruan", comando: null, status: "aguardando", qr: null, numero: null }];
const inst = () => db.tables.instancias_whatsapp[0];

// 1) primeira passada: cria a instancia, configura o webhook, pede QR
await syncUazapi(db);
assert.equal(uaz.insts.length, 1); assert.equal(uaz.insts[0].name, "auditoria-" + ID);
assert.equal(db.tables.instancias_uazapi[0].token, "tok-0");
assert.equal(uaz.insts[0].webhook.url, "https://worker.exemplo.app/webhook/uazapi?k=segredo123");
assert.deepEqual(uaz.insts[0].webhook.excludeMessages, ["isGroupYes"]);
assert.ok(uaz.chamadas.includes("POST /instance/connect"));

// 2) segunda passada: o QR aparece na tela
await syncUazapi(db);
assert.equal(inst().status, "aguardando_qr"); assert.equal(inst().qr, "data:image/png;base64,QR1");

// 3) SDR leu o QR: conectado, QR some, numero salvo
uaz.estado = "connected"; uaz.qr = ""; uaz.owner = "5511988887777";
await syncUazapi(db);
assert.equal(inst().status, "conectado"); assert.equal(inst().qr, null); assert.equal(inst().numero, "5511988887777");
assert.equal(uaz.insts.length, 1, "nao pode criar outra instancia");

// 4) webhook: segredo, texto enviado pelo SDR, resposta do lead, audio, grupo e token desconhecido
assert.equal(segredoOk("segredo123"), true); assert.equal(segredoOk("errado"), false); assert.equal(segredoOk(""), false);
const ts = Date.now() - 5 * 60_000;
const evento = (msg, token = "tok-0") => ({ EventType: "messages", token, owner: "5511988887777", message: { chatid: "5511911110001@s.whatsapp.net", isGroup: false, messageTimestamp: ts, senderName: "Ana", ...msg } });
await receberWebhook(db, evento({ messageid: "M1", fromMe: true, messageType: "Conversation", text: "Oi Ana, tudo bem?" }));
await receberWebhook(db, evento({ messageid: "M2", fromMe: false, messageType: "ExtendedTextMessage", text: "Oi! Pode falar" }));
await receberWebhook(db, evento({ messageid: "M3", fromMe: false, messageType: "AudioMessage", mediaType: "ptt", text: "" }));
await receberWebhook(db, evento({ messageid: "M2", fromMe: false, messageType: "ExtendedTextMessage", text: "Oi! Pode falar" })); // repetida
assert.deepEqual(await receberWebhook(db, evento({ messageid: "G1", chatid: "1203@g.us", isGroup: true, text: "grupo" })), { ignorado: "grupo" });
assert.deepEqual(await receberWebhook(db, evento({ messageid: "X1", text: "?" }, "tok-falso")), { ignorado: "token desconhecido" });
assert.deepEqual(await receberWebhook(db, { EventType: "connection" }), { ignorado: "connection" });
assert.equal(db.tables.conversas.length, 1); assert.equal(db.tables.conversas[0].contato, "5511911110001");
assert.equal(db.tables.conversas[0].contato_nome, "Ana");
assert.equal(db.tables.mensagens.length, 3);
assert.equal(db.tables.mensagens.find(m => m.wa_id === "M1").remetente, "vendedor");
assert.equal(db.tables.mensagens.find(m => m.wa_id === "M2").remetente, "cliente");
const audio = db.tables.mensagens.find(m => m.wa_id === "M3");
assert.equal(audio.tipo, "audio"); assert.ok(audio.audio_url); assert.equal(db.files.get(audio.audio_url).toString(), "audio-ogg");

// contato em conversa @lid usa o numero real quando vem no payload
assert.equal(normalizar({ message: { chatid: "275582348714164@lid", sender_pn: "5511994989615@s.whatsapp.net", fromMe: false, messageid: "L1", messageType: "Conversation", text: "oi" } }).contato, "5511994989615");

// 5) "Desconectar e gerar novo QR"
db.tables.instancias_whatsapp[0].comando = "reset";
await syncUazapi(db);
assert.ok(uaz.chamadas.includes("POST /instance/disconnect")); assert.equal(inst().comando, null);
assert.equal(inst().status, "aguardando_qr");

// 6) conexao removida no painel: a instancia some da Uazapi
db.tables.instancias_whatsapp = []; db.tables.instancias_uazapi = [];
await syncUazapi(db);
assert.equal(uaz.insts.length, 0);

console.log("OK: uazapi (instancia, QR, conexao, webhook, audio, reset e remocao)");

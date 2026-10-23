// Envio pelo CRM Q5: conversa certa, remetente certo, e sem conversa no CRM cai fora (Uazapi)
import assert from "node:assert/strict";
import { cfg } from "../src/config.js";
import { fakeSupa } from "./fakeSupa.js";
import { rotaCrm, enviarPeloCrm, envioConectado } from "../src/envio.js";
const pode = async () => ({ status: 404 }), semPermissao = async () => ({ status: 403 });

cfg.q5Key = "chave-teste";
const db = fakeSupa();
db.tables.audit_settings = [{ id: 1, instancia_envio_id: "inst-walter" }];
db.tables.instancias_whatsapp = [{ id: "inst-walter", status: "desconectado" }];
db.tables.crm_instancias = [{ id: "q5-walter", instancia_id: "inst-walter" }, { id: "q5-nick", instancia_id: "inst-nick" }];
db.tables.crm_conversas = [
  { id: "chat-rai-velho", crm_instancia_id: "q5-walter", telefone: "+5584996988444", responsavel_crm_id: "u-walter", ultima_msg_em: "2026-10-01T10:00:00Z" },
  { id: "chat-rai", crm_instancia_id: "q5-walter", telefone: "+5584996988444", responsavel_crm_id: "u-walter", ultima_msg_em: "2026-10-22T10:00:00Z" },
  { id: "chat-eu", crm_instancia_id: "q5-walter", telefone: "+5584936180882", responsavel_crm_id: "u-lucas", ultima_msg_em: "2026-10-21T10:00:00Z" },
  { id: "chat-rai-nick", crm_instancia_id: "q5-nick", telefone: "+5584996988444", responsavel_crm_id: "u-nick", ultima_msg_em: "2026-10-23T10:00:00Z" },
];

// numero com e sem o 9 extra e o 55: mesma conversa, a mais recente do numero de envio
assert.deepEqual(await rotaCrm(db, "inst-walter", "558496988444"), { chat: "chat-rai", remetente: "u-walter" });
// remetente e o atendente da maioria das conversas, mesmo no chat \"Voce\" que tem outro responsavel
assert.deepEqual(await rotaCrm(db, "inst-walter", "5584936180882"), { chat: "chat-eu", remetente: "u-walter" });
assert.equal(await rotaCrm(db, "inst-walter", "5511999998888"), null, "sem conversa no CRM");
assert.equal(await rotaCrm(db, "inst-ruan", "558496988444"), null, "numero de envio fora do CRM");

const chamadas = [];
const ok = async (url, o) => { chamadas.push({ url, corpo: JSON.parse(o.body), auth: o.headers.Authorization }); return { ok: true, status: 201, text: async () => "" }; };
assert.equal(await enviarPeloCrm(db, "inst-walter", "5584996988444", "Resumo", ok), true);
assert.equal(chamadas[0].url, "https://api.grupoquatro5.com/public/v1/conversations/chat-rai/messages");
assert.deepEqual(chamadas[0].corpo, { type: "text", body: "Resumo", sender_user_id: "u-walter" });
assert.equal(chamadas[0].auth, "Bearer chave-teste");
assert.equal(await enviarPeloCrm(db, "inst-walter", "5511999998888", "x", ok), false, "sem rota nao chama o CRM");
assert.equal(chamadas.length, 1);
await assert.rejects(enviarPeloCrm(db, "inst-walter", "5584996988444", "x", async () => ({ ok: false, status: 403, text: async () => "sem permissao" })), /CRM Q5 403/);

// resumo nao espera o WhatsApp conectado quando o numero de envio esta no CRM
assert.equal(await envioConectado(db, pode), true);
// chave do Q5 sem permissao de envio: espera o WhatsApp conectado, como antes
assert.equal(await envioConectado(db, semPermissao), false);
db.tables.audit_settings[0].instancia_envio_id = "inst-ruan";
db.tables.instancias_whatsapp.push({ id: "inst-ruan", status: "aguardando_qr" });
assert.equal(await envioConectado(db, pode), false);
cfg.q5Key = "";
console.log("OK: envio pelo CRM Q5 (conversa, remetente, sem rota, erro, resumo sem WhatsApp conectado, chave sem permissao)");

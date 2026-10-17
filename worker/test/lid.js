// Contato com codigo de privacidade (@lid): aprende o telefone real e respeita a lista de numeros ignorados
import assert from "node:assert/strict";
delete process.env.ANTHROPIC_API_KEY; process.env.TRANSCRIBE_API_KEY = "sk-teste";
const { fakeSupa } = await import("./fakeSupa.js");
const { saveMessage } = await import("../src/whatsapp.js");
const { runAudits } = await import("../src/auditor.js");

const db = fakeSupa();
const INST = { id: "i1", vendedor_id: "v1", nome: "WA do Walter" };
db.tables.profiles = [{ id: "v1", nome: "Walter", funcao: "closer", papel: "admin", ativo: true }];
db.tables.audit_settings = [{ id: 1, auditoria_automatica: true, min_mensagens: 2, auditoria_parada_min: 10 }];
db.tables.numeros_ignorados = [{ telefone: "5584996988444" }];
for (const t of ["conversas", "mensagens", "auditorias", "contatos_lid", "criterios_rubrica", "telefones_alerta", "notificacoes"]) db.tables[t] = [];
const t0 = Math.floor(Date.now() / 1000) - 3 * 3600;
const LID = "190988756734073@lid";
// voce manda primeiro: so o codigo, sem telefone
await saveMessage(db, INST, { key: { remoteJid: LID, id: "a1", fromMe: true }, messageTimestamp: t0, message: { conversation: "Fala Raí" } });
const conv = db.tables.conversas[0];
assert.equal(conv.contato, "190988756734073"); assert.equal(conv.telefone ?? null, null);
// ele responde: o WhatsApp manda o numero real junto (senderPn)
await saveMessage(db, INST, { key: { remoteJid: LID, id: "a2", fromMe: false, senderPn: "5584996988444@s.whatsapp.net" }, messageTimestamp: t0 + 60, pushName: "Raí", message: { conversation: "E aí" } });
assert.equal(conv.telefone, "5584996988444", "aprendeu o telefone real");
assert.deepEqual(db.tables.contatos_lid.map(x => [x.lid, x.telefone]), [["190988756734073", "5584996988444"]]);
// numero ignorado: nao audita, mesmo com o contato salvo como codigo
const ia = async () => { throw new Error("nao devia chamar a IA"); };
assert.equal(await runAudits(db, { fetchImpl: ia }), 0);
assert.equal(db.tables.auditorias.length, 0);
// em outro dia, mensagem so com o codigo ja sai com o telefone conhecido
await saveMessage(db, INST, { key: { remoteJid: LID, id: "b1", fromMe: true }, messageTimestamp: t0 + 90000, message: { conversation: "Bom dia" } });
assert.ok(db.tables.conversas.every(c => c.telefone === "5584996988444"));
console.log("OK: contato com codigo (@lid): telefone real aprendido e numero ignorado respeitado");

// Aviso na hora: mensagem com sinal -> fila rapida -> IA confirma -> WhatsApp do gestor (uma vez por evento)
import assert from "node:assert/strict";
delete process.env.ANTHROPIC_API_KEY; process.env.TRANSCRIBE_API_KEY = "sk-teste";
const { fakeSupa } = await import("./fakeSupa.js");
const { saveMessage } = await import("../src/whatsapp.js");
const { runAudits } = await import("../src/auditor.js");
const { temSinal, textoAlerta, eventosDe } = await import("../src/alertas.js");

// detector de sinal (sem IA)
for (const t of ["pode me inscrever", "vou usar o cupom", "mandei o comprovante", "fechado então", "combinado, quinta às 19h", "Quinta 19h tá ótimo", "paguei no pix"]) assert.ok(temSinal(t), t);
for (const t of ["oi, tudo bem?", "quanto custa?", "vou pensar", "me manda mais informações"]) assert.ok(!temSinal(t), t);

const db = fakeSupa();
const SDR = "sdr-1", INST = { id: "inst-1", vendedor_id: SDR, nome: "WA do Ruan" };
db.tables.profiles = [{ id: SDR, nome: "Ruan", funcao: "sdr", papel: "vendedor", ativo: true }];
db.tables.audit_settings = [{ id: 1, auditoria_automatica: true, min_mensagens: 2, alerta_venda: true, alerta_marcacao: true, alerta_oportunidade: false, alerta_formato: "detalhado", instancia_envio_id: "inst-walter" }];
db.tables.telefones_alerta = [{ telefone: "5584999990000" }];
db.tables.criterios_rubrica = [{ rubrica: "sdr", chave: "conducao", nome: "Condução", descricao: "", peso: 100, ativo: true, posicao: 1 }];
for (const t of ["conversas", "mensagens", "auditorias", "notificacoes", "numeros_ignorados"]) db.tables[t] = [];

let resposta = {};
const ia = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ notas: [{ criterio: "conducao", nota: 4 }], ...resposta }) } }] }) });
const enviados = [];
const envio = async (_db, inst, tel, texto) => enviados.push({ inst, tel, texto });
const rapida = () => runAudits(db, { fetchImpl: ia, soSinais: true, envio });
const t0 = Math.floor(Date.now() / 1000) - 600;
const msg = (i, fromMe, text) => saveMessage(db, INST, { key: { remoteJid: "5584988887777@s.whatsapp.net", id: `m${i}`, fromMe }, messageTimestamp: t0 + i * 30, pushName: "Maria Silva", message: { conversation: text } });

await msg(1, true, "Oi Maria, aqui é o Ruan da Weevo. O Carlos te indicou pro workshop.");
await msg(2, false, "Oi! Quanto custa?");
assert.equal(await rapida(), 0, "sem sinal: nada na fila rapida");
await msg(3, true, "Com o convite do Carlos sai de graça, é só usar o cupom.");
await msg(4, false, "Show, pode me inscrever então!");
const conv = db.tables.conversas[0];
assert.equal(conv.auditar_rapido, true);

// IA confirma a inscricao com cupom e a reuniao de imersao marcada: um aviso so, o mais urgente (venda)
resposta = { venda: { detectada: true, tipo: "workshop", cupom: true, evidencia: "Show, pode me inscrever então!" }, oportunidade: { detectada: true, tipo: "reuniao_imersao" }, agendou: true, tipo_agendamento: "workshop", reuniao: { tipo: "imersao", cliente_confirmou: true, vendedor_confirmou: true, data: "2026-10-20", hora: "19:00" } };
assert.equal(await rapida(), 1);
assert.equal(conv.auditar_rapido, false);
assert.equal(enviados.length, 1);
assert.equal(enviados[0].tel, "5584999990000"); assert.equal(enviados[0].inst, "inst-walter");
{ const t = enviados[0].texto; assert.doesNotMatch(t, /Elon Musk/); assert.match(t, /^Ruan \(SDR\)|^Mais um|^Olha só/); assert.match(t, /Ruan \(SDR\)/); assert.match(t, /Maria Silva/); assert.match(t, /workshop/); assert.match(t, /cupom de convite/); assert.match(t, /"Show, pode me inscrever então!"/); assert.match(t, /E não parou por aí: reunião de imersão marcada também!/); assert.match(t, /\/conversas\//); assert.doesNotMatch(t, /Lead:|💬|➕/); }
assert.deepEqual(db.tables.auditorias[0].alertas_enviados.sort(), ["reuniao_imersao", "venda_workshop"]);

// mesma conversa reauditada com os mesmos eventos: nao repete
await msg(5, true, "Fechado! Te mando o link. Nos vemos quinta 19h");
assert.equal(await rapida(), 1);
assert.equal(enviados.length, 1, "nao repete aviso do mesmo evento");

// formato resumido e o closer
{ const r = textoAlerta(eventosDe({ agendou: true, tipo_agendamento: "imersao", reuniao: { cliente_confirmou: true, vendedor_confirmou: true } }, "closer")[0], { vendedor: "Carla", funcao: "closer", lead: "João", conversaId: "x", formato: "resumido" }); assert.doesNotMatch(r, /Elon Musk/); assert.match(r, /^📅 \*ALERTA DE REUNIÃO\*: /); assert.match(r, /Carla \(Closer\)/); assert.match(r, /reunião de implementação/i); assert.match(r, /João/); assert.ok(!r.includes("\n"), r); }
assert.equal(eventosDe({ agendou: true, tipo_agendamento: "imersao", reuniao: { cliente_confirmou: true, vendedor_confirmou: true } }, "closer")[0].chave, "reuniao_implementacao");
// lead aceitou mas o vendedor so perguntou "posso confirmar?": ainda nao avisa (nem como oportunidade)
assert.equal(eventosDe({ oportunidade: true, oportunidade_tipo: "reuniao_imersao", reuniao: { cliente_confirmou: true, vendedor_confirmou: false } }, "sdr").length, 0);
assert.equal(eventosDe({ agendou: true, tipo_agendamento: "imersao" }, "closer").length, 0);
assert.ok(temSinal("Link da videochamada: https://meet.google.com/abc-defg-hij"));

// venda com dinheiro (imersao fechada / workshop pago): aviso animado; cupom R$ 0 continua no formato normal
const festa = textoAlerta(eventosDe({ venda: true, venda_tipo: "imersao", venda_valor: 4800, venda_evidencia: "mandei o pix" }, "closer")[0], { vendedor: "Walter Danilo", funcao: "closer", lead: "João", conversaId: "abc", formato: "resumido" });
assert.doesNotMatch(festa, /Elon Musk/); assert.match(festa, /WALTER/); assert.match(festa, /IMERSÃO FECHADA · R\$\s4\.800/); assert.match(festa, /"mandei o pix"/); assert.match(festa, /Quem comprou: /); assert.match(festa, /👉 .*\/conversas\/abc/);
assert.equal(eventosDe({ venda: true, venda_tipo: "workshop", venda_valor: 197 }, "sdr")[0].dinheiro, true);
assert.equal(eventosDe({ venda: true, venda_tipo: "workshop", venda_cupom: true, venda_valor: 0 }, "sdr")[0].dinheiro, false);
console.log("\n--- exemplo do aviso de venda com dinheiro ---\n" + festa + "\n");

// marcacoes desligadas: nao avisa, mas registra para nao avisar depois
db.tables.audit_settings[0].alerta_marcacao = false;
db.tables.auditorias[0].alertas_enviados = ["venda_workshop"];
await msg(6, false, "combinado, quinta 19h");
assert.equal(await rapida(), 1);
assert.equal(enviados.length, 1, "marcacao desligada nao avisa");
assert.ok(db.tables.auditorias[0].alertas_enviados.includes("reuniao_imersao"));
console.log("OK: aviso de venda e marcacao na hora (sinal, IA confirma, uma vez por evento, mais urgente primeiro)");
console.log("\n--- exemplo do aviso ---\n" + enviados[0].texto);

// reuniao proposta sem aceite: a conversa fica "em negociacao" e o "da certo" (sem palavra-chave) ja reaudita na hora
{
  const conv = db.tables.conversas[0];
  resposta = { oportunidade: { detectada: true, tipo: "reuniao_imersao" }, reuniao: { tipo: "imersao", cliente_confirmou: false, vendedor_confirmou: false, data: "2026-10-20", hora: "14:00" } };
  await db.update("conversas", { id: `eq.${conv.id}` }, { auditar_agora: true });
  await rapida();
  assert.equal(db.tables.conversas[0].reuniao_pendente, true);
  await msg(20, false, "Da certo");
  assert.equal(db.tables.conversas[0].auditar_rapido, true, "mensagem sem palavra-chave reaudita quando ha reuniao em negociacao");
  resposta = { oportunidade: { detectada: true, tipo: "reuniao_imersao" }, reuniao: { tipo: "imersao", cliente_confirmou: true, vendedor_confirmou: true, data: "2026-10-20", hora: "14:00" } };
  await rapida();
  assert.equal(db.tables.conversas[0].reuniao_pendente, false);
  console.log("OK: reuniao em negociacao reaudita na proxima mensagem");
}

// venda: link de pagamento dispara; com interesse aberto, a foto do comprovante (sem texto) ja reaudita
assert.ok(temSinal("Aqui está o link de pagamento no valor de R$ 197,00 para pagamento."));
assert.ok(temSinal("fica R$ 197"));
{
  resposta = { oportunidade: { detectada: true, tipo: "interesse_workshop" } };
  await db.update("conversas", { id: `eq.${db.tables.conversas[0].id}` }, { auditar_agora: true });
  await rapida();
  assert.equal(db.tables.conversas[0].reuniao_pendente, true, "interesse sem venda fica em negociacao");
  await saveMessage(db, INST, { key: { remoteJid: "5584988887777@s.whatsapp.net", id: "foto1", fromMe: false }, messageTimestamp: t0 + 900, message: { imageMessage: { caption: "" } } });
  assert.equal(db.tables.conversas[0].auditar_rapido, true, "foto do comprovante reaudita");
  resposta = { venda: { detectada: true, tipo: "workshop", valor: 197, cupom: false, evidencia: "comprovante" } };
  await rapida();
  assert.equal(db.tables.conversas[0].reuniao_pendente, false, "venda fechada sai da negociacao");
  console.log("OK: venda em negociacao reaudita com qualquer mensagem (inclusive foto)");
}

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
resposta = { venda: { detectada: true, tipo: "workshop", cupom: true, evidencia: "Show, pode me inscrever então!" }, oportunidade: { detectada: true, tipo: "reuniao_imersao" }, agendou: true, tipo_agendamento: "workshop" };
assert.equal(await rapida(), 1);
assert.equal(conv.auditar_rapido, false);
assert.equal(enviados.length, 1);
assert.equal(enviados[0].tel, "5584999990000"); assert.equal(enviados[0].inst, "inst-walter");
assert.match(enviados[0].texto, /Inscrição no workshop\* · cupom de convite · R\$\s0\nRuan \(SDR\) com Maria Silva\n"Show, pode me inscrever então!"\nTambém: 📅 Reunião de imersão marcada\nVer conversa: .*\/conversas\//);
assert.deepEqual(db.tables.auditorias[0].alertas_enviados.sort(), ["reuniao_imersao", "venda_workshop"]);

// mesma conversa reauditada com os mesmos eventos: nao repete
await msg(5, true, "Fechado! Te mando o link. Nos vemos quinta 19h");
assert.equal(await rapida(), 1);
assert.equal(enviados.length, 1, "nao repete aviso do mesmo evento");

// formato resumido e o closer
assert.match(textoAlerta(eventosDe({ venda: true, venda_tipo: "imersao", venda_valor: 4800 }, "closer")[0], { vendedor: "Carla", funcao: "closer", lead: "João", conversaId: "x", formato: "resumido" }), /^💎 \*Imersão fechada\* \(R\$\s4\.800\): Carla \(Closer\) com João$/);
assert.equal(eventosDe({ agendou: true, tipo_agendamento: "imersao" }, "closer")[0].chave, "reuniao_implementacao");

// marcacoes desligadas: nao avisa, mas registra para nao avisar depois
db.tables.audit_settings[0].alerta_marcacao = false;
db.tables.auditorias[0].alertas_enviados = ["venda_workshop"];
await msg(6, false, "combinado, quinta 19h");
assert.equal(await rapida(), 1);
assert.equal(enviados.length, 1, "marcacao desligada nao avisa");
assert.ok(db.tables.auditorias[0].alertas_enviados.includes("reuniao_imersao"));
console.log("OK: aviso de venda e marcacao na hora (sinal, IA confirma, uma vez por evento, mais urgente primeiro)");
console.log("\n--- exemplo do aviso ---\n" + enviados[0].texto);

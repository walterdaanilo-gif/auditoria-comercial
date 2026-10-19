// CRM Q5 -> conversas: so o historico de antes do WhatsApp, sem duplicar; revisao so de clientes potenciais; follow-up junta as duas fontes
import assert from "node:assert/strict";
const { fakeSupa } = await import("./fakeSupa.js");
const { importarHistoricoCrm } = await import("../src/crm.js");
const { leadsParados } = await import("../src/followup.js");
const { carregarRegras } = await import("../src/auditor.js");
const { today, addDays } = await import("../src/config.js");

const db = fakeSupa();
const NICK = "nick", INST = "inst-n", hoje = today();
const em = (dia, hora) => new Date(`${dia}T${hora}:00-03:00`).toISOString();
db.tables.profiles = [{ id: NICK, nome: "Nick", funcao: "sdr", papel: "vendedor", ativo: true }];
db.tables.audit_settings = [{ id: 1, auditoria_automatica: true, followup_alerta_d: 6, followup_limite_d: 30 }];
for (const t of ["criterios_rubrica", "numeros_ignorados", "telefones_alerta", "config_auditoria", "auditorias", "crm_corte"]) db.tables[t] = [];
db.tables.instancias_whatsapp = [{ id: INST, vendedor_id: NICK, numero: "558494094046" }];
// WhatsApp do Nick capturado a partir de hoje 09:00
db.tables.conversas = [{ id: "wa1", vendedor_id: NICK, instancia_id: INST, contato: "5584977770000", telefone: "5584977770000", canal: "whatsapp", data: hoje, ultima_msg_em: em(hoje, "09:00") }];
db.tables.mensagens = [{ id: "w1", conversa_id: "wa1", vendedor_id: NICK, wa_id: "ABC", remetente: "vendedor", texto: "bom dia", tipo: "texto", enviada_em: em(hoje, "09:00") }];

const d10 = addDays(hoje, -10), d3 = addDays(hoje, -3), d8 = addDays(hoje, -8);
db.tables.crm_conversas = [
  { id: "c1", vendedor_id: NICK, telefone: "+5584911112222", contato_nome: "Carla", status: "open" },
  { id: "c2", vendedor_id: NICK, telefone: "+5584933334444", contato_nome: "Grupo do time", status: "custom_chat_interno" },
  { id: "c3", vendedor_id: NICK, telefone: "+5584994094046", contato_nome: "Nickson Da Weevo", status: "open" },
  { id: "c4", vendedor_id: NICK, telefone: "+5584955556666", contato_nome: "Pedro", status: "custom_pos_vendas_perdido" },
  { id: "c5", vendedor_id: NICK, telefone: "+5584922223333", contato_nome: "Lia", status: "pending" },
];
const m = (id, conv, direcao, dia, hora, extra = {}) => ({ id, conversa_id: conv, direcao, tipo: "text", texto: `msg ${id}`, enviada_em: em(dia, hora), nota_interna: false, automatica: false, apagada_em: null, ...extra });
db.tables.crm_mensagens = [
  m("1", "c1", "outbound", d10, "10:00"), m("2", "c1", "inbound", d10, "10:05"),
  m("3", "c1", "outbound", d3, "15:00"), m("4", "c1", "inbound", d3, "15:10"),
  m("5", "c1", "internal", d3, "15:20", { nota_interna: true }), m("6", "c1", "outbound", d3, "15:30", { automatica: true }),
  m("7", "c1", "outbound", hoje, "10:00"), // depois do corte: o WhatsApp ja tem
  m("8", "c2", "outbound", d3, "11:00"), m("9", "c3", "inbound", d3, "11:00"),
  m("10", "c4", "outbound", d3, "11:00"), m("11", "c4", "inbound", d3, "11:05"),
  m("12", "c5", "inbound", d8, "08:00"), // lead escreveu ha 8 dias e nunca teve resposta
];

const r1 = await importarHistoricoCrm(db);
assert.equal(db.tables.crm_corte[0].corte, em(hoje, "09:00"), "corte = inicio da captura do WhatsApp");
const doCrm = db.tables.mensagens.filter(x => String(x.wa_id).startsWith("crm:"));
assert.deepEqual(doCrm.map(x => x.wa_id).sort(), ["crm:1", "crm:10", "crm:11", "crm:12", "crm:2", "crm:3", "crm:4"].sort(), "sem nota interna, automatica, chat interno, numero do time e nada depois do corte");
const c1d3 = db.tables.conversas.find(c => c.contato === "5584911112222" && c.data === d3);
assert.equal(c1d3.canal, "crm"); assert.equal(c1d3.contato_nome, "Carla");
assert.equal(db.tables.mensagens.find(x => x.wa_id === "crm:3").remetente, "vendedor");
assert.equal(c1d3.auditar_rapido, true, "cliente potencial: a ultima conversa do historico vai para a revisao");
assert.ok(!db.tables.conversas.find(c => c.contato === "5584911112222" && c.data === d10).auditar_rapido, "so a ultima");
assert.ok(!db.tables.conversas.find(c => c.contato === "5584955556666").auditar_rapido, "pos-venda perdido nao e revisado");
assert.ok(!db.tables.conversas.find(c => c.contato === "5584922223333").auditar_rapido, "sem mensagem dos dois lados nao audita");
assert.equal(r1.revisar, 1);

// rodar de novo nao duplica nada
const antes = db.tables.mensagens.length, convsAntes = db.tables.conversas.length;
await importarHistoricoCrm(db);
assert.equal(db.tables.mensagens.length, antes); assert.equal(db.tables.conversas.length, convsAntes);

// follow-up: a Lia (status ativo no CRM) escreveu ha 8 dias e o Nick nunca respondeu -> entra; a Carla teve mensagem ha 3 dias -> nao
const R = await carregarRegras(db);
const parados = await leadsParados(db, R);
assert.deepEqual(parados.map(l => l.nome), ["Lia"]);
assert.equal(parados[0].semResposta, true); assert.equal(parados[0].dias, 8);
console.log("OK: historico do CRM sem duplicar, revisao so de clientes potenciais, follow-up juntando WhatsApp e CRM");

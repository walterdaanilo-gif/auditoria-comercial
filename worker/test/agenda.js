// Reuniao de implementacao confirmada -> evento amarelo na Agenda Google (cria, atualiza, nao duplica)
import assert from "node:assert/strict";
process.env.GOOGLE_CLIENT_ID = "cid"; process.env.GOOGLE_CLIENT_SECRET = "csec";
const { fakeSupa } = await import("./fakeSupa.js");
const { sincronizarReuniao, montarEvento } = await import("../src/agenda.js");
const { addDays, today } = await import("../src/config.js");

const db = fakeSupa();
db.tables.google_agenda = [{ id: 1, email: "walter@gmail.com", refresh_token: "rt" }];
db.tables.audit_settings = [{ id: 1, agenda_ativa: true, agenda_duracao_min: 60, agenda_convidar: true, agenda_meet: true }];
db.tables.reunioes_agenda = [];
const R = { nomes: new Map([["v1", "Walter"]]) };
const c = { id: "conv1", vendedor_id: "v1", contato: "5584988887777" };
const amanha = addDays(today(), 1);
const pedidos = [];
const google = async (url, o) => {
  pedidos.push({ url: String(url), metodo: o.method, corpo: o.body });
  if (String(url).includes("oauth2")) return { ok: true, json: async () => ({ access_token: "at", expires_in: 3600 }) };
  return { ok: true, json: async () => ({ id: "ev1", htmlLink: "https://calendar.google.com/ev1" }) };
};

// nao confirmada, ou sem tipo de reuniao: nada vai para a agenda
assert.equal(await sincronizarReuniao(db, R, c, { tipo: "implementacao", cliente_confirmou: false, data: amanha, hora: "15:00" }, { fetchImpl: google }), null);
assert.equal(await sincronizarReuniao(db, R, c, { tipo: null, cliente_confirmou: true, data: amanha, hora: "15:00" }, { fetchImpl: google }), null);
// reuniao que ja passou tambem nao
assert.equal(await sincronizarReuniao(db, R, c, { tipo: "implementacao", cliente_confirmou: true, data: addDays(today(), -2), hora: "15:00" }, { fetchImpl: google }), null);
assert.equal(pedidos.length, 0);

// confirmada, online, com email: cria evento amarelo, com convite e Meet
// lead aceitou mas o vendedor ainda nao confirmou: espera
assert.equal(await sincronizarReuniao(db, R, c, { tipo: "implementacao", cliente_confirmou: true, vendedor_confirmou: false, data: amanha, hora: "15:00" }, { fetchImpl: google }), null);
const r = { tipo: "implementacao", cliente_confirmou: true, vendedor_confirmou: true, data: amanha, hora: "15:00", duracao_min: null, modalidade: "online", local: "", cliente_nome: "João Souza", empresa: "Oficina Souza", email: "joao@souza.com" };
assert.equal(await sincronizarReuniao(db, R, c, r, { fetchImpl: google }), "criada");
const criar = pedidos.find(p => p.metodo === "POST" && p.url.includes("/events"));
assert.match(criar.url, /conferenceDataVersion=1&sendUpdates=all/);
const ev = JSON.parse(criar.corpo);
assert.equal(ev.colorId, "5"); assert.equal(ev.summary, "Reunião de implementação · João Souza · Oficina Souza");
assert.equal(ev.start.dateTime, `${amanha}T15:00:00-03:00`); assert.equal(ev.end.dateTime, new Date(Date.parse(`${amanha}T16:00:00-03:00`)).toISOString());
assert.deepEqual(ev.attendees, [{ email: "joao@souza.com", displayName: "João Souza" }]);
assert.equal(ev.conferenceData.createRequest.conferenceSolutionKey.type, "hangoutsMeet");
assert.match(ev.description, /E-mail: joao@souza\.com/); assert.match(ev.description, /Conversa: .*\/conversas\/conv1/);
assert.equal(db.tables.reunioes_agenda[0].google_event_id, "ev1");

// mesma reuniao de novo: nao duplica
const n = pedidos.length;
assert.equal(await sincronizarReuniao(db, R, c, r, { fetchImpl: google }), "sem mudanca");
assert.equal(pedidos.length, n);

// cliente mudou para presencial as 16h: atualiza o mesmo evento (PATCH), com local, sem criar outro Meet
assert.equal(await sincronizarReuniao(db, R, c, { ...r, hora: "16:00", modalidade: "presencial", local: "Rua A, 100 - Fortaleza" }, { fetchImpl: google }), "atualizada");
const patch = pedidos.at(-1);
assert.equal(patch.metodo, "PATCH"); assert.match(patch.url, /\/events\/ev1\?/);
const ev2 = JSON.parse(patch.corpo);
assert.equal(ev2.location, "Rua A, 100 - Fortaleza"); assert.equal(ev2.conferenceData, undefined);

// reuniao de imersao (marcada pelo SDR, de outro WhatsApp) tambem vai, com o titulo certo
const c2 = { id: "conv2", vendedor_id: "v1", contato: "5584911112222" };
assert.equal(await sincronizarReuniao(db, R, c2, { ...r, tipo: "imersao", cliente_nome: "Maria", empresa: "", email: "" }, { fetchImpl: google }), "criada");
assert.equal(JSON.parse(pedidos.at(-1).corpo).summary, "Reunião de imersão · Maria");

// sem email: sem convite; Meet desligado em Configuracoes
const ev3 = montarEvento({ ...r, email: "" }, { vendedor: "Walter", contato: "5584988887777", conversaId: "x", meet: false });
assert.equal(ev3.attendees, undefined); assert.equal(ev3.conferenceData, undefined);
console.log("OK: agenda Google (reuniao de implementacao e de imersao confirmadas, amarelo, convite, Meet, local, sem duplicar)");

// conflito: outro compromisso no mesmo horario -> aviso no WhatsApp do proprio gestor (uma vez por horario)
{
  db.tables.audit_settings[0].instancia_envio_id = "inst-walter";
  db.tables.instancias_whatsapp = [{ id: "inst-walter", numero: "5584936180882" }];
  const avisos = [];
  const envio = async (_db, inst, tel, texto) => avisos.push({ inst, tel, texto });
  const dia = addDays(today(), 2);
  const ocupado = async (url, o) => {
    if (String(url).includes("oauth2")) return { ok: true, json: async () => ({ access_token: "at", expires_in: 3600 }) };
    if (o.method === "GET") return { ok: true, json: async () => ({ items: [
      { id: "outro", summary: "Almoço com fornecedor", start: { dateTime: `${dia}T13:30:00-03:00` }, end: { dateTime: `${dia}T14:30:00-03:00` } },
      { id: "livre", summary: "Bloco livre", transparency: "transparent", start: { dateTime: `${dia}T14:00:00-03:00` }, end: { dateTime: `${dia}T15:00:00-03:00` } },
      { id: "recusado", summary: "Convite recusado", attendees: [{ self: true, responseStatus: "declined" }], start: { dateTime: `${dia}T14:00:00-03:00` }, end: { dateTime: `${dia}T15:00:00-03:00` } },
      { id: "feriado", summary: "Feriado", start: { date: dia }, end: { date: dia } },
    ] }) };
    return { ok: true, json: async () => ({ id: "ev9", htmlLink: "https://calendar.google.com/ev9" }) };
  };
  const c9 = { id: "conv9", vendedor_id: "v1", contato: "5584900001111" };
  const r9 = { tipo: "imersao", cliente_confirmou: true, vendedor_confirmou: true, data: dia, hora: "14:00", duracao_min: 40, modalidade: "presencial", local: "Sede", cliente_nome: "Ricardo", empresa: "", email: "" };
  assert.equal(await sincronizarReuniao(db, R, c9, r9, { fetchImpl: ocupado, envio }), "criada");
  assert.equal(avisos.length, 1); assert.equal(avisos[0].tel, "5584936180882"); assert.equal(avisos[0].inst, "inst-walter");
  assert.match(avisos[0].texto, /^⚠️ \*CONFLITO NA AGENDA\*/); assert.match(avisos[0].texto, /Ricardo/); assert.match(avisos[0].texto, /13:30 às 14:30 · Almoço com fornecedor/);
  assert.doesNotMatch(avisos[0].texto, /Bloco livre|Convite recusado|Feriado/);
  // mesma reuniao com outro detalhe (mesmo horario): nao avisa de novo
  assert.equal(await sincronizarReuniao(db, R, c9, { ...r9, local: "Sede, sala 2" }, { fetchImpl: ocupado, envio }), "atualizada");
  assert.equal(avisos.length, 1);
  // remarcou para outro horario que tambem bate: avisa de novo
  assert.equal(await sincronizarReuniao(db, R, c9, { ...r9, hora: "13:45" }, { fetchImpl: ocupado, envio }), "atualizada");
  assert.equal(avisos.length, 2);
  console.log("OK: conflito com a agenda avisado no WhatsApp do gestor\n\n" + avisos[0].texto);
}

// remarcacao: a mesma reuniao do lead vinda de outra conversa (outro dia ou outro vendedor) atualiza o MESMO evento
{
  const { reuniaoAnterior } = await import("../src/agenda.js");
  const { marcacao } = await import("../src/auditor.js");
  const dia = addDays(today(), 3);
  db.tables.reunioes_agenda = [{ conversa_id: "conv-ontem", vendedor_id: "sdr-x", inicio: new Date(`${dia}T10:00:00-03:00`).toISOString(), google_event_id: "evR", dados: { tipo: "imersao", contato: "5584977776666", telefone: "5584977776666" } }];
  const cHoje = { id: "conv-hoje", vendedor_id: "closer-y", contato: "84977776666", telefone: "5584977776666" };
  const RR = { nomes: new Map(), funcao: new Map([["sdr-x", "sdr"], ["sdr-z", "sdr"], ["closer-y", "closer"]]) };
  const cSdr = { ...cHoje, vendedor_id: "sdr-z" };
  assert.equal((await reuniaoAnterior(db, cSdr, RR)).google_event_id, "evR", "outro SDR remarcando a reuniao de imersao do mesmo lead");
  assert.equal(await reuniaoAnterior(db, cHoje, RR), null, "closer marcando reuniao de implementacao e reuniao nova");
  assert.equal((await reuniaoAnterior(db, cHoje, RR, { inicio: `${dia}T10:00:00-03:00` })).google_event_id, "evR", "mesmo dia e horario e a mesma reuniao, qualquer tipo");
  assert.equal(await reuniaoAnterior(db, { ...cSdr, id: "conv-ontem" }, RR), null, "a propria conversa nao conta");
  const pedidosR = [];
  const g = async (url, o) => { pedidosR.push({ url: String(url), metodo: o.method }); if (String(url).includes("oauth2")) return { ok: true, json: async () => ({ access_token: "at", expires_in: 3600 }) }; return { ok: true, json: async () => ({ id: "evR", htmlLink: "x" }) }; };
  assert.equal(await sincronizarReuniao(db, { ...R, funcao: RR.funcao }, cSdr, { tipo: "imersao", cliente_confirmou: true, vendedor_confirmou: true, remarcacao: true, data: dia, hora: "15:00", cliente_nome: "Ana" }, { fetchImpl: g, envio: async () => {} }), "atualizada");
  assert.ok(pedidosR.some(p => p.metodo === "PATCH" && p.url.includes("/events/evR")), "remarcacao muda o horario do mesmo evento");
  // na contagem: remarcacao de reuniao nao e marcacao; inscricao no workshop continua contando
  assert.deepEqual(marcacao({ agendou: true, tipo_agendamento: "imersao", reuniao: { remarcacao: true } }, "sdr"), { agendou: false, tipo_agendamento: null, remarcacao: true });
  assert.deepEqual(marcacao({ agendou: true, tipo_agendamento: "imersao", reuniao: { remarcacao: false } }, "sdr"), { agendou: true, tipo_agendamento: "imersao", remarcacao: false });
  assert.deepEqual(marcacao({ agendou: true, tipo_agendamento: "workshop", reuniao: { remarcacao: true } }, "sdr").agendou, true);
  console.log("OK: remarcacao so muda a agenda e nao conta como marcacao");
}

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

import assert from "node:assert/strict";
import { fakeSupa } from "./fakeSupa.js";
import { acompanharChamadas, gravarLigacao, ligacaoDaMensagem } from "../src/ligacoes.js";

const db = fakeSupa();
const inst = { id: "i1", vendedor_id: "v1", nome: "WhatsApp do Ruan" };
const t0 = Math.floor(Date.parse("2026-10-17T13:00:00Z") / 1000);

// 1. SDR liga do celular e o lead atende: chega so o registro de chamada no chat
const log = ligacaoDaMensagem({ key: { remoteJid: "5584988887777@s.whatsapp.net", fromMe: true, id: "M1" }, messageTimestamp: t0 + 95, message: { callLogMesssage: { callOutcome: 0, durationSecs: 95 } } });
assert.equal(log.direcao, "saida"); assert.equal(log.atendida, true); assert.equal(log.duracao, 95); assert.equal(log.sec, t0);
await gravarLigacao(db, inst, log);

// 2. ligacao nao atendida
await gravarLigacao(db, inst, ligacaoDaMensagem({ key: { remoteJid: "5584911112222@s.whatsapp.net", fromMe: true, id: "M2" }, messageTimestamp: t0 + 30, message: { callLogMesssage: { callOutcome: 1, durationSecs: 0 } } }));

// 3. lead liga, SDR atende: eventos "call"; depois o registro do chat chega da mesma ligacao e nao duplica
const onCall = acompanharChamadas(db, inst, () => "5584936180882:3@s.whatsapp.net");
await onCall([{ id: "C1", chatId: "5584933334444@s.whatsapp.net", from: "5584933334444@s.whatsapp.net", date: new Date((t0 + 600) * 1000), status: "offer" }]);
await onCall([{ id: "C1", chatId: "5584933334444@s.whatsapp.net", from: "5584933334444@s.whatsapp.net", status: "accept" }]);
await onCall([{ id: "C1", chatId: "5584933334444@s.whatsapp.net", from: "5584933334444@s.whatsapp.net", status: "terminate" }]);
await gravarLigacao(db, inst, ligacaoDaMensagem({ key: { remoteJid: "5584933334444@s.whatsapp.net", fromMe: false, id: "M3" }, messageTimestamp: t0 + 660, message: { callLogMesssage: { callOutcome: 0, durationSecs: 60 } } }));

// 4. grupo e mensagem comum sao ignorados
await onCall([{ id: "G1", chatId: "123@g.us", isGroup: true, status: "timeout" }]);
assert.equal(ligacaoDaMensagem({ key: { remoteJid: "x@s.whatsapp.net" }, message: { conversation: "oi" } }), null);

const ligs = db.tables.ligacoes;
assert.equal(ligs.length, 3, "uma linha por ligacao");
const por = c => ligs.find(l => l.contato === c);
assert.equal(por("5584988887777").atendida, true);
assert.equal(por("5584911112222").atendida, false); assert.equal(por("5584911112222").resultado, "perdida");
assert.equal(por("5584933334444").direcao, "entrada"); assert.equal(por("5584933334444").atendida, true); assert.equal(por("5584933334444").duracao_seg, 60);
assert.equal(ligs.filter(l => l.atendida).length, 2);
console.log("OK: ligacoes de WhatsApp (registro do chat, eventos de chamada, sem duplicar)");

// atendida no CELULAR: o aparelho conectado ve tocar e encerrar (sem "accept"); eventos chegando juntos (reconexao)
{
  const { acompanharChamadas: acomp, TOQUE_MAX_S } = await import("../src/ligacoes.js");
  const db2 = fakeSupa(); db2.tables.ligacoes = [];
  const inst2 = { id: "i2", vendedor_id: "ruan", nome: "WA Ruan" };
  const T = Date.now() - 3600_000;
  const ev = (id, status, s) => ({ id, chatId: "111961358495911@lid", from: "111961358495911@lid", date: new Date(T + s * 1000), status });
  const on = acomp(db2, inst2, () => "558486483304:5@s.whatsapp.net");
  await on([ev("A", "offer", 0), ev("A", "ringing", 1), ev("A", "terminate", 245)]); // conversou ~4 min
  await on([ev("B", "offer", 600), ev("B", "ringing", 601), ev("B", "terminate", 630)]); // tocou 30s e parou
  const det = new Map([["C", { reason: "accepted_elsewhere", duration: "95" }]]);
  const on3 = acomp(db2, inst2, () => "558486483304:5@s.whatsapp.net", id => det.get(id));
  await on3([ev("C", "offer", 1200), ev("C", "terminate", 1230)]); // WhatsApp mandou a duracao no encerramento
  const [a, b, c] = ["A", "B", "C"].map(id => db2.tables.ligacoes.find(l => l.wa_call_id === id));
  assert.equal(a.atendida, true); assert.equal(a.duracao_seg, 245); assert.equal(a.resultado, "atendida");
  assert.equal(b.atendida, false); assert.equal(b.resultado, "perdida");
  assert.equal(c.atendida, true); assert.equal(c.duracao_seg, 95);
  assert.equal(new Date(a.iniciada_em).getTime(), Math.floor(T / 1000) * 1000, "horario do WhatsApp, nao da chegada");
  assert.ok(TOQUE_MAX_S >= 45);
  console.log("OK: ligacao atendida no celular conta como atendida (duracao do WhatsApp ou tempo da chamada)");
}

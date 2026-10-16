import fs from "node:fs";
import crypto from "node:crypto";
import { cfg, sheetSerial } from "./config.js";

// Cliente minimo do Google Sheets com conta de servico (sem dependencias externas)
let sa = null, tok = null, tokExp = 0;
const b64 = o => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");

export const googleEnabled = () => !!cfg.sheetId && fs.existsSync(cfg.saFile);

async function token() {
  if (tok && Date.now() < tokExp - 60000) return tok;
  sa ||= JSON.parse(fs.readFileSync(cfg.saFile, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "RS256", typ: "JWT" });
  const body = b64({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const sig = crypto.createSign("RSA-SHA256").update(`${head}.${body}`).sign(sa.private_key, "base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${body}.${sig}` }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("Google auth falhou: " + JSON.stringify(j));
  tok = j.access_token; tokExp = Date.now() + (j.expires_in || 3600) * 1000;
  return tok;
}

async function api(path, opts = {}) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}${path}`, {
    ...opts, headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Sheets ${r.status}: ${JSON.stringify(j.error || j)}`);
  return j;
}

const q = t => encodeURIComponent(`'${t}'`);

// Escreve as metricas do dia na linha (data + SDR) da aba SDR. Colunas: D contatadas, G msgs enviadas,
// H msgs respondidas, I conversas efetivas, K agendados por mensagem (E e F so se CALLS_ENABLED).
export async function writeDayRow(day, sdrName, m) {
  const rng = `${q(cfg.sheetTab)}!A32:B200`;
  const j = await api(`/values/${rng}?valueRenderOption=UNFORMATTED_VALUE`);
  const rows = j.values || [];
  const serial = sheetSerial(day);
  const idx = rows.findIndex(r => Number(r[0]) === serial && String(r[1]).trim().toLowerCase() === sdrName.toLowerCase());
  if (idx < 0) return { ok: false, reason: `linha de ${day} / ${sdrName} nao encontrada na aba ${cfg.sheetTab}` };
  const row = 32 + idx;
  const cell = (col, v) => ({ range: `${cfg.sheetTab}!${col}${row}`, values: [[v]] });
  const data = [cell("D", m.contatadas), cell("G", m.enviadas), cell("H", m.respondidas), cell("I", m.efetivas), cell("K", m.agendadosMsg)];
  if (cfg.callsEnabled) data.push(cell("E", m.ligTentadas), cell("F", m.ligAtendidas));
  await api("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }) });
  return { ok: true, row };
}

const ready = new Set();
async function ensureTab(title, headers) {
  if (ready.has(title)) return;
  const meta = await api("?fields=sheets.properties.title");
  if (!meta.sheets.some(x => x.properties.title === title)) {
    await api(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1, columnCount: Math.max(headers.length, 10) } } } }] }) });
    await api(`/values/${q(title)}!A1?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [headers] }) });
  }
  ready.add(title);
}

// RAW de proposito: o texto vem de clientes e nao pode virar formula na planilha
async function appendRaw(title, values) {
  const j = await api(`/values/${q(title)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: "POST", body: JSON.stringify({ values }) });
  const m = /!A(\d+):/.exec(j.updates?.updatedRange || "");
  return m ? +m[1] : null; // primeira linha escrita
}

const MSG_HEAD = ["Data", "Hora", "Conta", "Direção", "Contato", "Mensagem", "ID"];
const AUD_HEAD = ["Data", "Vendedor", "Lead", "Efetiva", "Agendou", "Nota (0-10)", "Resumo", "Pontos fortes", "O que melhorar", "Objeções", "Mensagens", "Qualidade", "Gatilhos usados"];
const fmtD = day => day.split("-").reverse().join("/");

// m = { day, hora, vendedor, remetente, contato, texto, id }
export async function appendMessages(rows) {
  if (!rows.length) return;
  await ensureTab(cfg.messagesTab, MSG_HEAD);
  await appendRaw(cfg.messagesTab, rows.map(m => [fmtD(m.day), m.hora, m.vendedor, m.remetente === "vendedor" ? "Enviada" : "Recebida", m.contato, m.texto || "", m.id]));
}

// Linha nova na primeira vez, atualiza a mesma linha depois. Retorna a linha da planilha.
export async function upsertAudit(a) {
  await ensureTab(cfg.auditTab, AUD_HEAD);
  const gat = Object.entries(a.gatilhos || {}).filter(([, v]) => v).map(([k]) => k).join(", ");
  const row = [fmtD(a.day), a.vendedor, a.contato, a.efetiva ? "Sim" : "Não", a.agendou ? "Sim" : "Não", Number(a.nota_geral), a.resumo || "", a.pontos_fortes || "", a.pontos_melhoria || "", a.objecoes || "", a.msg_count || 0, a.qualidade || "", gat];
  if (a.sheet_row) {
    await api(`/values/${q(cfg.auditTab)}!A${a.sheet_row}:M${a.sheet_row}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [row] }) });
    return a.sheet_row;
  }
  return appendRaw(cfg.auditTab, [row]);
}

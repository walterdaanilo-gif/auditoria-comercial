import path from "node:path";
import fs from "node:fs";
import { cfg } from "./config.js";
import { gravarMensagem } from "./mensagens.js";
import { acompanharChamadas, gravarLigacao, ligacaoDaMensagem } from "./ligacoes.js";

// Logger minimo compativel com o Baileys (sem depender do pino)
const quiet = { level: "silent", child() { return quiet; }, trace() {}, debug() {}, info() {}, warn() {}, error(...a) { console.error("[baileys]", ...a); }, fatal(...a) { console.error("[baileys]", ...a); } };

const running = new Map(); // instancia_id -> { sock, stop() }

// Mensagens que o sistema enviou (avisos e relatorio), guardadas por 24h: quando o celular de quem recebe nao consegue
// decifrar de primeira, ele pede reenvio e o Baileys busca a mensagem aqui (getMessage). Sem isso fica "Aguardando mensagem".
const enviadas = new Map(); // id -> { message, em, para, instancia }
const guardarEnviada = (id, message, para, instancia) => {
  enviadas.set(id, { message, em: Date.now(), para, instancia });
  for (const [k, v] of enviadas) if (Date.now() - v.em > 864e5) enviadas.delete(k);
};
// Contador de tentativas de reenvio por mensagem (o Baileys aceita qualquer objeto com get/set/del/flushAll)
const cacheSimples = () => { const m = new Map(); return { get: k => m.get(k), set: (k, v) => { m.set(k, v); return true; }, del: k => m.delete(k), flushAll: () => m.clear() }; };
const STATUS = { 1: "pendente", 2: "no servidor", 3: "entregue", 4: "lida", 5: "ouvida" };

export const textOf = m => {
  const x = m.message; if (!x) return { tipo: "outro", texto: "" };
  const msg = x.ephemeralMessage?.message || x.viewOnceMessage?.message || x.viewOnceMessageV2?.message || x;
  if (msg.conversation) return { tipo: "texto", texto: msg.conversation };
  if (msg.extendedTextMessage?.text) return { tipo: "texto", texto: msg.extendedTextMessage.text };
  if (msg.audioMessage) return { tipo: "audio", texto: "" };
  if (msg.imageMessage) return { tipo: "imagem", texto: msg.imageMessage.caption || "" };
  if (msg.videoMessage) return { tipo: "video", texto: msg.videoMessage.caption || "" };
  if (msg.documentMessage) return { tipo: "documento", texto: msg.documentMessage.caption || "" };
  return { tipo: "outro", texto: "" };
};
const isLead = jid => !!jid && /@(s\.whatsapp\.net|lid)$/.test(jid);

// Converte a mensagem do Baileys para o formato comum e grava
export async function saveMessage(db, inst, m, { sock, B } = {}) {
  const jid = m.key?.remoteJid;
  if (!isLead(jid)) return;
  const lig = ligacaoDaMensagem(m); // registro de chamada sincronizado pelo celular
  if (lig) { await gravarLigacao(db, inst, lig); console.log(`[${inst.nome}] ligacao ${lig.direcao} ${lig.contato}: ${lig.resultado}${lig.duracao ? ` ${lig.duracao}s` : ""}`); return; }
  const { tipo, texto } = textOf(m);
  // contato com codigo de privacidade (@lid): o numero real vem em senderPn nas mensagens que o lead manda
  const lid = jid.endsWith("@lid");
  const pn = String(m.key.senderPn || "");
  await gravarMensagem(db, inst, {
    contato: jid.split("@")[0], lid, telefone: !lid ? jid.split("@")[0] : pn.endsWith("@s.whatsapp.net") ? pn.split("@")[0].split(":")[0] : null, nome: m.pushName, fromMe: !!m.key.fromMe, id: m.key.id, tipo, texto,
    sec: Number(m.messageTimestamp?.low ?? m.messageTimestamp) || undefined,
    baixarAudio: sock && B ? () => B.downloadMediaMessage(m, "buffer", {}, { logger: quiet, reuploadRequest: sock.updateMediaMessage }) : undefined,
  });
}

async function setStatus(db, id, patch) {
  try { await db.update("instancias_whatsapp", { id: `eq.${id}` }, { ...patch, atualizado_em: new Date().toISOString() }); }
  catch (e) { console.error("[instancia] status:", e.message); }
}

async function startInstance(db, inst) {
  const B = await import("@whiskeysockets/baileys");
  const makeWASocket = B.default?.default ?? B.default ?? B.makeWASocket;
  const dir = path.join(cfg.dataDir, "auth", inst.id);
  fs.mkdirSync(dir, { recursive: true });
  const handle = { stopped: false, sock: null, stop() { this.stopped = true; try { this.sock?.end?.(); } catch {} } };
  running.set(inst.id, handle);

  const connect = async () => {
    if (handle.stopped) return;
    const { state, saveCreds } = await B.useMultiFileAuthState(dir);
    let version; try { ({ version } = await B.fetchLatestBaileysVersion()); } catch {}
    const sock = makeWASocket({
      auth: { creds: state.creds, keys: B.makeCacheableSignalKeyStore(state.keys, quiet) }, version, logger: quiet, printQRInTerminal: false, syncFullHistory: false, markOnlineOnConnect: false, browser: ["Cabueta do Elon Musk", "Chrome", "1.0"],
      msgRetryCounterCache: handle.retry ??= cacheSimples(),
      getMessage: async key => enviadas.get(key.id)?.message,
    });
    handle.sock = sock;
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", async u => {
      if (u.qr) await setStatus(db, inst.id, { status: "aguardando_qr", qr: u.qr });
      if (u.connection === "open") {
        const numero = sock.user?.id?.split(":")[0]?.split("@")[0];
        console.log(`[${inst.nome}] conectado (${numero})`);
        await setStatus(db, inst.id, { status: "conectado", qr: null, numero });
      }
      if (u.connection === "close" && !handle.stopped) {
        const code = u.lastDisconnect?.error?.output?.statusCode;
        if (code === B.DisconnectReason.loggedOut) {
          console.log(`[${inst.nome}] sessao encerrada no celular. Gerando novo QR.`);
          fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
          await setStatus(db, inst.id, { status: "desconectado", qr: null, numero: null });
        } else await setStatus(db, inst.id, { status: "conectando" });
        setTimeout(connect, 3000);
      }
    });
    const onMsgs = (origem) => ({ messages = [], type }) => {
      // diagnostico: mostra no log o que chega do WhatsApp (sem o texto), para achar mensagem ou ligacao que nao entrou
      if (messages.length) console.log(`[${inst.nome}] ${origem}${type ? `/${type}` : ""}: ${messages.length} msg (${[...new Set(messages.map(m => (m.messageStubType ? `stub${m.messageStubType}` : Object.keys(m.message || {}).filter(k => k !== "messageContextInfo")[0]) || "vazia"))].join(", ")})`);
      for (const m of messages) saveMessage(db, inst, m, { sock, B }).catch(e => console.error(`[${inst.nome}] mensagem:`, e.message));
    };
    sock.ev.on("messages.upsert", onMsgs("upsert"));
    // confirma se o aviso do sistema chegou no celular de quem recebe (entregue/lida), nao so no servidor
    sock.ev.on("messages.update", ups => {
      for (const { key, update } of ups) {
        const e = enviadas.get(key?.id);
        if (e && update?.status) console.log(`[envio] mensagem para ${e.para}: ${STATUS[update.status] || update.status}`);
      }
    });
    sock.ev.on("messaging-history.set", onMsgs("historico"));
    const onCall = acompanharChamadas(db, inst, () => sock.user?.id);
    sock.ev.on("call", calls => {
      console.log(`[${inst.nome}] evento de chamada: ${calls.map(c => `${c.status} ${String(c.from || "").split("@")[0].split(":")[0]} -> ${String(c.chatId || "").split("@")[0]}`).join(" | ")}`);
      return onCall(calls);
    });
  };
  await setStatus(db, inst.id, { status: "conectando" });
  await connect();
}

// Olha o banco a cada poucos segundos: sobe conexoes novas, aplica 'reset' e derruba as removidas
export async function syncInstances(db) {
  const rows = await db.select("instancias_whatsapp", { select: "id,vendedor_id,nome,comando" });
  const ids = new Set(rows.map(r => r.id));
  for (const [id, h] of running) if (!ids.has(id)) { h.stop(); running.delete(id); fs.rmSync(path.join(cfg.dataDir, "auth", id), { recursive: true, force: true }); }
  for (const inst of rows) {
    if (inst.comando === "reset") {
      const h = running.get(inst.id);
      try { await h?.sock?.logout?.(); } catch {}
      h?.stop(); running.delete(inst.id);
      fs.rmSync(path.join(cfg.dataDir, "auth", inst.id), { recursive: true, force: true });
      await db.update("instancias_whatsapp", { id: `eq.${inst.id}` }, { comando: null, qr: null, numero: null, status: "conectando" });
    }
    if (!running.has(inst.id)) startInstance(db, inst).catch(e => { console.error(`[${inst.nome}]`, e); setStatus(db, inst.id, { status: "erro" }); running.delete(inst.id); });
  }
}
export const statusAtual = () => [...running.keys()];

// Envia texto pelo WhatsApp conectado (alertas e relatorio para o gestor). numero = 55 + DDD + numero.
// O onWhatsApp acha o JID certo, inclusive quando a conta existe sem o 9 extra.
export async function enviarTextoBaileys(instanciaId, numero, texto) {
  const sock = running.get(instanciaId)?.sock;
  if (!sock?.user) throw new Error("WhatsApp de envio nao esta conectado neste worker");
  const [r] = (await sock.onWhatsApp(numero)) || [];
  if (!r?.exists) throw new Error(`o numero ${numero} nao tem WhatsApp`);
  const msg = await sock.sendMessage(r.jid, { text: texto });
  if (msg?.key?.id) guardarEnviada(msg.key.id, msg.message, numero, instanciaId);
  console.log(`[envio] enviada para ${numero} (${r.jid})`);
  return msg;
}

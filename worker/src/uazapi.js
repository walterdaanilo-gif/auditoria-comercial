import crypto from "node:crypto";
import { cfg } from "./config.js";
import { gravarMensagem } from "./mensagens.js";

// Conexao do WhatsApp pela Uazapi (uazapiGO v2).
// - Cada linha de instancias_whatsapp vira uma instancia na Uazapi chamada "auditoria-<id>".
// - O token de cada instancia fica em instancias_uazapi (tabela que so o worker le).
// - QR Code e status vem de GET /instance/status (consultado a cada ciclo).
// - Mensagens chegam pelo webhook POST /webhook/uazapi?k=<WEBHOOK_SECRET> no servidor do worker.

const PREFIXO = "auditoria-";
const ultimoConnect = new Map(); // instancia_id -> ms do ultimo /instance/connect (o QR vale ~2 min)
const webhookOk = new Set();     // instancias com webhook ja configurado nesta execucao
let ativas = 0;

export const uazapiAtivo = () => !!cfg.uazapiUrl;
export const statusAtualUazapi = () => ativas;

async function api(metodo, caminho, { token, admin = false, body } = {}) {
  const headers = { Accept: "application/json" };
  if (admin) headers.admintoken = cfg.uazapiAdminToken; else headers.token = token;
  if (body) headers["Content-Type"] = "application/json";
  const r = await fetch(cfg.uazapiUrl + caminho, { method: metodo, headers, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text();
  let json = null; try { json = txt ? JSON.parse(txt) : null; } catch {}
  if (!r.ok) { const e = new Error(`Uazapi ${metodo} ${caminho} ${r.status}: ${(json?.error || txt).toString().slice(0, 200)}`); e.status = r.status; throw e; }
  return json;
}

const urlWebhook = () => `${cfg.webhookUrl}/webhook/uazapi?k=${encodeURIComponent(cfg.webhookSecret)}`;

async function configurarWebhook(id, token) {
  if (webhookOk.has(id) || !cfg.webhookUrl || !cfg.webhookSecret) return;
  // modo simples: um webhook por instancia, criado ou atualizado. Grupos ficam de fora.
  await api("POST", "/webhook", { token, body: { enabled: true, url: urlWebhook(), events: ["messages", "connection"], excludeMessages: ["isGroupYes"] } });
  webhookOk.add(id);
}

async function setStatus(db, id, patch) {
  try { await db.update("instancias_whatsapp", { id: `eq.${id}` }, { ...patch, atualizado_em: new Date().toISOString() }); }
  catch (e) { console.error("[uazapi] status:", e.message); }
}

async function conectar(db, inst, token) {
  ultimoConnect.set(inst.id, Date.now());
  try { await api("POST", "/instance/connect", { token, body: {} }); }
  catch (e) {
    console.error(`[${inst.nome}]`, e.message);
    // 429 = limite de conexoes do plano da Uazapi
    await setStatus(db, inst.id, { status: "erro", qr: null });
  }
}

// O QR da Uazapi vem como imagem em base64; garante o prefixo data: para a tela mostrar direto
const comoImagem = q => (!q ? null : q.startsWith("data:") ? q : `data:image/png;base64,${q}`);

export async function syncUazapi(db) {
  if (!cfg.uazapiAdminToken) { console.error("[uazapi] falta UAZAPI_ADMIN_TOKEN"); return; }
  const linhas = await db.select("instancias_whatsapp", { select: "id,vendedor_id,nome,comando,status,qr,numero" });
  const tokens = new Map((await db.select("instancias_uazapi", { select: "instancia_id,token" })).map(t => [t.instancia_id, t.token]));
  const ids = new Set(linhas.map(l => l.id));

  // conexoes removidas no painel: apaga a instancia na Uazapi tambem
  try {
    const todas = (await api("GET", "/instance/all", { admin: true })) || [];
    for (const i of todas) {
      const nome = String(i.name || "");
      if (nome.startsWith(PREFIXO) && !ids.has(nome.slice(PREFIXO.length)) && i.token) {
        await api("DELETE", "/instance", { token: i.token }).catch(e => console.error("[uazapi] remover:", e.message));
        console.log(`[uazapi] instancia ${nome} removida`);
      }
    }
  } catch (e) { console.error("[uazapi] listar:", e.message); }

  let conectadas = 0;
  for (const inst of linhas) {
    try {
      let token = tokens.get(inst.id);
      if (!token) {
        const r = await api("POST", "/instance/create", { admin: true, body: { name: PREFIXO + inst.id, systemName: "Cabueta do Elon Musk", adminField01: inst.vendedor_id } });
        token = r?.token || r?.instance?.token;
        if (!token) throw new Error("a Uazapi nao devolveu o token da instancia");
        await db.insert("instancias_uazapi", [{ instancia_id: inst.id, nome: PREFIXO + inst.id, token }], { onConflict: "instancia_id", returning: false });
        console.log(`[${inst.nome}] instancia criada na Uazapi`);
      }
      await configurarWebhook(inst.id, token);

      if (inst.comando === "reset") {
        await api("POST", "/instance/disconnect", { token }).catch(() => {});
        await db.update("instancias_whatsapp", { id: `eq.${inst.id}` }, { comando: null });
        await conectar(db, inst, token);
      }

      const st = await api("GET", "/instance/status", { token });
      const estado = st?.instance?.status || (st?.status?.connected ? "connected" : "disconnected");
      const qr = comoImagem(st?.instance?.qrcode);
      if (estado === "connected" && st?.status?.loggedIn !== false) {
        conectadas++;
        const numero = String(st?.instance?.owner || "").replace(/\D/g, "") || inst.numero;
        if (inst.status !== "conectado" || inst.numero !== numero || inst.qr) {
          console.log(`[${inst.nome}] conectado (${numero})`);
          await setStatus(db, inst.id, { status: "conectado", qr: null, numero });
        }
      } else if (estado === "connecting" && qr) {
        if (inst.qr !== qr || inst.status !== "aguardando_qr") await setStatus(db, inst.id, { status: "aguardando_qr", qr });
      } else if (estado === "connecting") {
        if (inst.status !== "conectando") await setStatus(db, inst.id, { status: "conectando" });
      } else {
        // desconectada (nova, QR expirado ou saiu pelo celular): pede um QR novo, no maximo a cada ~2 min
        if (inst.status === "conectado") await setStatus(db, inst.id, { status: "desconectado", qr: null });
        if (Date.now() - (ultimoConnect.get(inst.id) || 0) > 110_000) await conectar(db, inst, token);
      }
    } catch (e) {
      console.error(`[${inst.nome}]`, e.message);
      if (e.status === 401) { webhookOk.delete(inst.id); }
    }
  }
  ativas = conectadas;
}

// ---------- webhook ----------
// Envia texto pela instancia da Uazapi (alertas e relatorio para o gestor)
export async function enviarTextoUazapi(db, instanciaId, numero, texto) {
  const [t] = await db.select("instancias_uazapi", { select: "token", filters: { instancia_id: `eq.${instanciaId}` } });
  if (!t?.token) throw new Error("instancia de envio sem token na Uazapi");
  await api("POST", "/send/text", { token: t.token, body: { number: numero, text: texto } });
}

export function segredoOk(k) {
  const a = Buffer.from(String(k || "")), b = Buffer.from(String(cfg.webhookSecret || ""));
  return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

const TIPOS = {
  conversation: "texto", extendedtextmessage: "texto",
  audiomessage: "audio", pttmessage: "audio",
  imagemessage: "imagem", videomessage: "video",
  documentmessage: "documento", documentwithcaptionmessage: "documento",
};

// Contato do lead: o numero da conversa, mesmo nas mensagens que o SDR enviou
export function contatoDe(msg, body = {}) {
  const chatid = String(msg.chatid || "");
  if (chatid.endsWith("@s.whatsapp.net")) return chatid.split("@")[0];
  const wa = String(body.chat?.wa_chatid || "");
  if (wa.endsWith("@s.whatsapp.net")) return wa.split("@")[0];
  if (!msg.fromMe && String(msg.sender_pn || "").endsWith("@s.whatsapp.net")) return String(msg.sender_pn).split("@")[0];
  return chatid.endsWith("@lid") ? chatid.split("@")[0] : "";
}

export function normalizar(body) {
  const msg = body.message || {};
  const content = typeof msg.content === "object" && msg.content ? msg.content : {};
  const t = String(msg.messageType || "").toLowerCase();
  const tipo = TIPOS[t] || (["audio", "ptt"].includes(String(msg.mediaType)) ? "audio" : "outro");
  const texto = [msg.text, content.caption, content.text].find(x => typeof x === "string" && x.trim()) || "";
  return {
    contato: contatoDe(msg, body), nome: msg.senderName || "", fromMe: !!msg.fromMe,
    id: String(msg.messageid || msg.id || ""), tipo, texto,
    sec: Math.floor(Number(msg.messageTimestamp || 0) / 1000) || undefined,
  };
}

// Recebe o POST da Uazapi. Identifica a instancia pelo token que vem no corpo.
export async function receberWebhook(db, body) {
  if (body?.EventType !== "messages") return { ignorado: body?.EventType || "sem evento" };
  const msg = body.message || {};
  if (msg.isGroup || String(msg.chatid || "").includes("@g.")) return { ignorado: "grupo" };
  const [seg] = await db.select("instancias_uazapi", { select: "instancia_id,token", filters: { token: `eq.${body.token}` } });
  if (!seg) return { ignorado: "token desconhecido" };
  const [inst] = await db.select("instancias_whatsapp", { select: "id,vendedor_id,nome", filters: { id: `eq.${seg.instancia_id}` } });
  if (!inst) return { ignorado: "conexao removida" };
  const m = normalizar(body);
  m.baixarAudio = async () => {
    const r = await api("POST", "/message/download", { token: seg.token, body: { id: m.id, return_base64: true, generate_mp3: false, return_link: false } });
    return r?.base64Data ? Buffer.from(r.base64Data, "base64") : null;
  };
  await gravarMensagem(db, inst, m);
  return { ok: true };
}

import { temSinal } from "./alertas.js";
import { cfg, today, addDays, dayStart } from "./config.js";

const fails = new Map();
let avisou = false;

async function whisper(buffer, nome, fetchImpl = fetch) {
  const fd = new FormData();
  fd.append("file", new Blob([buffer]), nome);
  fd.append("model", cfg.transcribeModel);
  fd.append("language", "pt");
  const r = await fetchImpl(cfg.transcribeUrl, { method: "POST", headers: { Authorization: `Bearer ${cfg.transcribeKey}` }, body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Transcricao ${r.status}: ${JSON.stringify(j.error || j).slice(0, 200)}`);
  return String(j.text || "").trim();
}

// Transcreve audios de WhatsApp e gravacoes de ligacoes que ainda nao tem texto
export async function transcribePending(db) {
  if (!cfg.transcribeKey) { if (!avisou) { console.log("[transcricao] TRANSCRIBE_API_KEY vazia: audios ficam sem texto."); avisou = true; } return 0; }
  let feitos = 0;
  for (const [tabela, filtro] of [["mensagens", { tipo: "eq.audio" }], ["ligacoes", {}]]) {
    const rows = await db.select(tabela, { select: tabela === "mensagens" ? "id,audio_url,conversa_id" : "id,audio_url", filters: { ...filtro, transcricao: "is.null", audio_url: "not.is.null" }, order: "id", limit: 10 });
    for (const r of rows) {
      const key = `${tabela}:${r.id}`;
      try {
        const buf = await db.download(r.audio_url);
        const texto = buf.length > 25 * 1024 * 1024 ? "[audio grande demais para transcrever]" : (await whisper(buf, r.audio_url.split("/").pop())) || "[sem fala detectada]";
        await db.update(tabela, { id: `eq.${r.id}` }, { transcricao: texto });
        // audio com sinal de venda, ou qualquer audio numa conversa com reuniao em negociacao: reaudita com o texto ja transcrito
        if (r.conversa_id) {
          const pend = !temSinal(texto) && (await db.select("conversas", { select: "reuniao_pendente", filters: { id: `eq.${r.conversa_id}` } }))[0]?.reuniao_pendente;
          if (temSinal(texto) || pend) await db.update("conversas", { id: `eq.${r.conversa_id}` }, { auditar_rapido: true });
        }
        feitos++;
      } catch (e) {
        const n = (fails.get(key) || 0) + 1; fails.set(key, n);
        console.error(`[transcricao] ${key} (tentativa ${n}):`, e.message);
        if (n >= 3) await db.update(tabela, { id: `eq.${r.id}` }, { transcricao: "[nao foi possivel transcrever]" });
      }
    }
  }
  return feitos;
}

// Audios do CRM Q5 chegam sem transcricao e com link que expira em 1h. Renova o link na lista de mensagens da conversa
// no Q5, baixa, transcreve e grava nas duas tabelas. Conversa ja auditada sem o texto do audio volta para a fila.
const Q5 = "https://api.grupoquatro5.com/public/v1";
// Cada empresa tem o seu CRM: a chave vem do segredo indicado em organizacoes.crm_segredo (Weevo: Q5_API_KEY).
export async function transcreverCrm(db, { fetchImpl = fetch, limite = 12, dias = 8, ate = null } = {}) {
  if (!cfg.transcribeKey) return 0;
  const pend = await db.select("mensagens", { select: "id,wa_id,conversa_id,org_id", filters: { tipo: "eq.audio", transcricao: "is.null", wa_id: "like.crm:*", enviada_em: `gte.${dayStart(addDays(today(), -dias))}` }, order: "enviada_em.desc", limit: limite });
  if (!pend.length) return 0;
  const chats = new Map((await db.select("crm_mensagens", { select: "id,conversa_id", filters: { id: `in.(${pend.map(p => p.wa_id.slice(4)).join(",")})` } })).map(m => [m.id, m.conversa_id]));
  const segredos = new Map((await db.select("organizacoes", { select: "id,crm_segredo" }).catch(() => [])).map(o => [o.id, o.crm_segredo]));
  const chaveDe = org => (org && segredos.get(org) ? process.env[segredos.get(org)] || "" : cfg.q5Key);
  const orgDoChat = new Map(pend.map(p => [chats.get(p.wa_id.slice(4)), p.org_id]));
  const q5 = async (caminho, chave) => {
    const r = await fetchImpl(Q5 + caminho, { headers: { Authorization: `Bearer ${chave}`, Accept: "application/json" } });
    if (!r.ok) throw new Error(`CRM Q5 ${r.status} em ${caminho}`);
    return r.json();
  };
  // link novo de cada audio: pagina a conversa do mais novo para o mais velho ate achar todos
  const links = new Map();
  for (const chat of new Set(pend.map(p => chats.get(p.wa_id.slice(4))).filter(Boolean))) {
    const chave = chaveDe(orgDoChat.get(chat));
    if (!chave) continue; // empresa sem chave do CRM: o audio fica como indisponivel
    const faltam = new Set(pend.filter(p => chats.get(p.wa_id.slice(4)) === chat).map(p => p.wa_id.slice(4)));
    let antes = null;
    try {
      for (let pag = 0; pag < 10 && faltam.size; pag++) {
        const r = await q5(`/conversations/${chat}/messages?limit=100${antes ? `&before=${antes}` : ""}`, chave);
        const lote = (r.data || []).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
        for (const m of lote) if (faltam.delete(m.id) && m.mediaUrl) links.set(m.id, m.mediaUrl);
        if (!r.hasMore || !lote.length) break;
        antes = lote[0].id;
      }
    } catch (e) { console.error(`[transcricao] links do CRM (conversa ${chat}):`, e.message); } // uma conversa com erro nao trava as outras
  }
  let feitos = 0;
  for (const p of pend) {
    if (ate && Date.now() > ate) break;
    const id = p.wa_id.slice(4);
    let texto;
    try {
      const url = links.get(id);
      if (!url) texto = "[audio indisponivel no CRM]";
      else {
        const r = await fetchImpl(url);
        if (!r.ok) throw new Error(`download ${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());
        texto = buf.length > 25 * 1024 * 1024 ? "[audio grande demais para transcrever]" : (await whisper(buf, `${id}.mp3`, fetchImpl)) || "[sem fala detectada]";
      }
    } catch (e) {
      console.error(`[transcricao] audio do CRM ${id}:`, e.message);
      texto = "[nao foi possivel transcrever]";
    }
    await db.update("mensagens", { id: `eq.${p.id}` }, { transcricao: texto });
    await db.update("crm_mensagens", { id: `eq.${id}` }, { transcricao: texto });
    if (!texto.startsWith("[")) {
      feitos++;
      const auditada = (await db.select("auditorias", { select: "id", filters: { conversa_id: `eq.${p.conversa_id}` }, limit: 1 })).length;
      if (auditada || temSinal(texto)) await db.update("conversas", { id: `eq.${p.conversa_id}` }, { auditar_rapido: true });
    }
  }
  if (feitos) console.log(`[transcricao] ${feitos} audios do CRM transcritos`);
  return feitos;
}

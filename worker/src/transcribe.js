import { cfg } from "./config.js";

const fails = new Map();
let avisou = false;

async function whisper(buffer, nome) {
  const fd = new FormData();
  fd.append("file", new Blob([buffer]), nome);
  fd.append("model", cfg.transcribeModel);
  fd.append("language", "pt");
  const r = await fetch(cfg.transcribeUrl, { method: "POST", headers: { Authorization: `Bearer ${cfg.transcribeKey}` }, body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Transcricao ${r.status}: ${JSON.stringify(j.error || j).slice(0, 200)}`);
  return String(j.text || "").trim();
}

// Transcreve audios de WhatsApp e gravacoes de ligacoes que ainda nao tem texto
export async function transcribePending(db) {
  if (!cfg.transcribeKey) { if (!avisou) { console.log("[transcricao] TRANSCRIBE_API_KEY vazia: audios ficam sem texto."); avisou = true; } return 0; }
  let feitos = 0;
  for (const [tabela, filtro] of [["mensagens", { tipo: "eq.audio" }], ["ligacoes", {}]]) {
    const rows = await db.select(tabela, { select: "id,audio_url", filters: { ...filtro, transcricao: "is.null", audio_url: "not.is.null" }, order: "id", limit: 10 });
    for (const r of rows) {
      const key = `${tabela}:${r.id}`;
      try {
        const buf = await db.download(r.audio_url);
        const texto = buf.length > 25 * 1024 * 1024 ? "[audio grande demais para transcrever]" : (await whisper(buf, r.audio_url.split("/").pop())) || "[sem fala detectada]";
        await db.update(tabela, { id: `eq.${r.id}` }, { transcricao: texto });
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

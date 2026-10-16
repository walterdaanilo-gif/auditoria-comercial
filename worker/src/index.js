import http from "node:http";
import { cfg } from "./config.js";
import { supa } from "./supa.js";
import { syncInstances, statusAtual } from "./whatsapp.js";
import { transcribePending } from "./transcribe.js";
import { runAudits } from "./auditor.js";
import { processAnalyses } from "./analysis.js";
import { mirrorAll, mirrorEnabled } from "./mirror.js";

if (!cfg.supabaseUrl || !cfg.serviceKey) { console.error("Faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env"); process.exit(1); }

// Roda uma tarefa por vez (sem sobrepor) e nunca derruba o processo
const loop = (nome, ms, fn) => {
  let busy = false;
  const tick = async () => { if (busy) return; busy = true; try { await fn(); } catch (e) { console.error(`[${nome}]`, e.message); } finally { busy = false; } };
  setTimeout(tick, 2000); setInterval(tick, ms);
};

loop("conexoes", 15_000, () => syncInstances(supa));
loop("transcricao", 20_000, () => transcribePending(supa));
loop("auditoria", cfg.auditEveryMin * 60_000, async () => { const n = await runAudits(supa); if (n) console.log(`[auditoria] ${n} auditorias novas`); });
loop("analise", 30_000, () => processAnalyses(supa));
if (mirrorEnabled()) loop("planilha", 30_000, () => mirrorAll(supa)); else console.log("[planilha] espelho desligado (sem SHEET_ID ou chave do Google)");

// Saude para a hospedagem (Railway, Render, Fly): so informa que esta vivo, sem dados
http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true, conexoes: statusAtual().length })); }).listen(cfg.port);
process.on("unhandledRejection", e => console.error("[erro]", e));
console.log("Worker iniciado.");

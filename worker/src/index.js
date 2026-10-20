import http from "node:http";
import { cfg } from "./config.js";
import { supa } from "./supa.js";
import { syncInstances, statusAtual } from "./whatsapp.js";
import { uazapiAtivo, syncUazapi, statusAtualUazapi, receberWebhook, segredoOk } from "./uazapi.js";
import { transcribePending } from "./transcribe.js";
import { cicloDeAuditoria } from "./ciclo.js";
import { runAudits } from "./auditor.js";
import { provedor } from "./ia.js";
import { processAnalyses } from "./analysis.js";
import { mirrorAll, mirrorEnabled } from "./mirror.js";
import { importarHistoricoCrm } from "./crm.js";
import { cancelarEventos } from "./agenda.js";

// Avisa no log quais variaveis faltam. Sem as do Supabase nao da para rodar nada.
const faltam = Object.entries({ SUPABASE_URL: cfg.supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: cfg.serviceKey }).filter(([, v]) => !v).map(([k]) => k);
if (faltam.length) { console.error(`Faltam as variaveis ${faltam.join(", ")} (no Railway: servico worker > Variables). O worker nao inicia sem elas.`); process.exit(1); }
const opcionais = { UAZAPI_URL: cfg.uazapiUrl, UAZAPI_ADMIN_TOKEN: cfg.uazapiAdminToken, WEBHOOK_URL: cfg.webhookUrl, WEBHOOK_SECRET: cfg.webhookSecret, TRANSCRIBE_API_KEY: cfg.transcribeKey };
console.log(provedor() ? `[ia] auditoria com ${provedor() === "anthropic" ? `Anthropic (${cfg.model})` : `OpenAI (${cfg.openaiModel})`}` : "[ia] sem chave de IA (ANTHROPIC_API_KEY ou OPENAI_API_KEY / TRANSCRIBE_API_KEY da OpenAI): nada sera auditado");
const vazias = Object.entries(opcionais).filter(([, v]) => !v).map(([k]) => k);
if (vazias.length) console.log(`[config] variaveis vazias: ${vazias.join(", ")}`);

// Roda uma tarefa por vez (sem sobrepor) e nunca derruba o processo
const loop = (nome, ms, fn) => {
  let busy = false;
  const tick = async () => { if (busy) return; busy = true; try { await fn(); } catch (e) { console.error(`[${nome}]`, e.message); } finally { busy = false; } };
  setTimeout(tick, 2000); setInterval(tick, ms);
};

// WhatsApp: Uazapi quando UAZAPI_URL estiver preenchido; senao, Baileys direto (QR gerado pelo proprio worker)
const conexoes = () => (uazapiAtivo() ? statusAtualUazapi() : statusAtual().length);
console.log(`[whatsapp] provedor: ${uazapiAtivo() ? "Uazapi" : "Baileys"}`);
loop("conexoes", 15_000, async () => {
  await (uazapiAtivo() ? syncUazapi(supa) : syncInstances(supa));
  // sinal de vida: a tela WhatsApp mostra "worker desligado" quando isso para de atualizar
  await supa.insert("worker_status", [{ id: 1, visto_em: new Date().toISOString(), conexoes: conexoes() }], { onConflict: "id", returning: false });
});
loop("transcricao", 20_000, () => transcribePending(supa));
loop("auditoria-rapida", 60_000, async () => { const n = await runAudits(supa, { soSinais: true }); if (n) console.log(`[auditoria] ${n} na fila rapida (venda, marcacao ou auditar agora)`); });
loop("auditoria", cfg.auditEveryMin * 60_000, async () => { const n = await cicloDeAuditoria(supa); if (n) console.log(`[auditoria] ${n} auditorias novas`); });
loop("analise", 30_000, () => processAnalyses(supa));
// CRM Q5: historico de antes do WhatsApp conectado + revisao dos clientes potenciais (daqui pra frente vale o WhatsApp)
loop("crm", 15 * 60_000, () => importarHistoricoCrm(supa));
loop("agenda-cancelar", 60_000, () => cancelarEventos(supa));
if (mirrorEnabled()) loop("planilha", 30_000, () => mirrorAll(supa)); else console.log("[planilha] espelho desligado (sem SHEET_ID ou chave do Google)");

// Servidor HTTP: saude para a hospedagem e webhook da Uazapi (POST /webhook/uazapi?k=<WEBHOOK_SECRET>)
http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const responder = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
  if (req.method === "POST" && url.pathname === "/webhook/uazapi") {
    if (!segredoOk(url.searchParams.get("k"))) return responder(401, { erro: "nao autorizado" });
    let tam = 0; const partes = [];
    req.on("data", c => { tam += c.length; if (tam > 5_000_000) req.destroy(); else partes.push(c); });
    req.on("end", () => {
      responder(200, { ok: true }); // responde logo; grava em seguida
      let body; try { body = JSON.parse(Buffer.concat(partes).toString("utf8")); } catch { return; }
      receberWebhook(supa, body).catch(e => console.error("[webhook]", e.message));
    });
    return;
  }
  responder(200, { ok: true, conexoes: conexoes() });
}).listen(cfg.port);
process.on("unhandledRejection", e => console.error("[erro]", e));
console.log("Worker iniciado.");

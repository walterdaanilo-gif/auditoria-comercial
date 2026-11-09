// Edge Function "worker" do Supabase: substitui o servidor ligado 24h.
//   POST /worker/webhook/uazapi?k=<WEBHOOK_SECRET>  -> mensagens e chamadas que a Uazapi manda na hora
//   POST /worker/tick?t=rapido|ciclo|crm            -> relogios do banco (pg_cron), com a chave interna worker_token
//     rapido (1 min): conexoes da Uazapi (QR/status), transcricao, fila rapida de auditoria, agenda, analise do time
//     ciclo  (5 min): auditoria das conversas paradas, resumos das 13h e 19h, follow-up, aviso de diagnostico pendente (6h antes da turma)
//     crm   (15 min): historico do CRM Q5
import "./edge-shim.js";
import { cfg } from "./config.js";
import { supa as db } from "./supa.js";
import { syncUazapi, receberWebhook, segredoOk } from "./uazapi.js";
import { transcribePending, transcreverCrm } from "./transcribe.js";
import { runAudits } from "./auditor.js";
import { cicloDeAuditoria } from "./ciclo.js";
import { processAnalyses } from "./analysis.js";
import { importarHistoricoCrm } from "./crm.js";
import { cancelarEventos } from "./agenda.js";
import { sugerirParaLead } from "./closer.js";
import { avisarDiagnosticos } from "./diagnostico.js";
import { avisarVenda } from "./vendaAviso.js";

const LIMITE_MS = 120_000; // a funcao tem ~150s; para antes e a proxima volta continua
const json = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { "Content-Type": "application/json" } });

async function tokenOk(req) {
  const [t] = await db.select("worker_token", { select: "token", filters: { id: "eq.1" } });
  const k = req.headers.get("x-worker-token") || "";
  return !!t?.token && k.length === t.token.length && segredoIgual(k, t.token);
}
const segredoIgual = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

async function comVez(nome, fn) {
  if (!(await db.rpc("pegar_vez", { p_nome: nome, p_segundos: 140 }))) return { pulou: "ja esta rodando" };
  try { return await fn(); } finally { await db.rpc("soltar_vez", { p_nome: nome }).catch(() => {}); }
}

const TAREFAS = {
  async rapido() {
    const ate = Date.now() + LIMITE_MS, out = {};
    const passo = async (k, f) => { if (Date.now() > ate) return; try { out[k] = await f(); } catch (e) { console.error(`[${k}]`, e.message); out[k] = `erro: ${e.message}`; } };
    await passo("conexoes", async () => { await syncUazapi(db); return "ok"; });
    await db.insert("worker_status", [{ id: 1, visto_em: new Date().toISOString(), conexoes: (await db.select("instancias_whatsapp", { select: "id", filters: { status: "eq.conectado" } })).length }], { onConflict: "id", returning: false }).catch(() => {});
    await passo("transcricao", () => transcribePending(db));
    await passo("transcricao_crm", () => transcreverCrm(db, { ate: ate - 30_000 }));
    await passo("fila_rapida", () => runAudits(db, { soSinais: true, ate }));
    await passo("agenda", () => cancelarEventos(db));
    await passo("analise", () => processAnalyses(db));
    return out;
  },
  async ciclo() {
    const out = { auditorias: await cicloDeAuditoria(db, { ate: Date.now() + LIMITE_MS }) };
    // aviso de diagnostico 6h antes de cada turma; uma falha aqui nao atrapalha a auditoria
    try { out.diagnostico = await avisarDiagnosticos(db); } catch (e) { console.error("[diagnostico]", e.message); out.diagnostico = `erro: ${e.message}`; }
    return out;
  },
  async crm() { return await importarHistoricoCrm(db); },
};

Deno.serve(async req => {
  const url = new URL(req.url);
  try {
    if (url.pathname.endsWith("/webhook/uazapi")) {
      if (req.method !== "POST" || !segredoOk(url.searchParams.get("k"))) return json(401, { erro: "nao autorizado" });
      const body = await req.json().catch(() => null);
      if (!body) return json(400, { erro: "corpo invalido" });
      if (body.EventType === "call") console.log("[uazapi] evento de chamada:", JSON.stringify(body).slice(0, 800));
      // responde logo e grava em seguida (audio pode demorar para baixar)
      const tarefa = receberWebhook(db, body).catch(e => console.error("[webhook]", e.message));
      globalThis.EdgeRuntime?.waitUntil ? globalThis.EdgeRuntime.waitUntil(tarefa) : await tarefa;
      return json(200, { ok: true });
    }
    // Painel do Closer (site): le a conversa do lead e devolve uma sugestao; nao grava nada
    if (url.pathname.endsWith("/closer/sugestao")) {
      if (req.method !== "POST") return json(405, { erro: "use POST" });
      if (!(await tokenOk(req))) return json(401, { erro: "nao autorizado" });
      const body = await req.json().catch(() => null);
      if (!body) return json(400, { erro: "corpo invalido" });
      return json(200, await sugerirParaLead(db, body));
    }
    // Site: o faturamento ganhou uma venda de imersao ou plataforma -> avisa o Bruno no WhatsApp
    if (url.pathname.endsWith("/avisos/venda")) {
      if (req.method !== "POST") return json(405, { erro: "use POST" });
      if (!(await tokenOk(req))) return json(401, { erro: "nao autorizado" });
      const body = await req.json().catch(() => null);
      if (!body) return json(400, { erro: "corpo invalido" });
      return json(200, await avisarVenda(db, body));
    }
    if (url.pathname.endsWith("/tick")) {
      if (!(await tokenOk(req))) return json(401, { erro: "nao autorizado" });
      const t = url.searchParams.get("t") || "rapido";
      if (!TAREFAS[t]) return json(400, { erro: "tarefa desconhecida" });
      if (!cfg.supabaseUrl || !cfg.serviceKey) return json(500, { erro: "faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY" });
      return json(200, await comVez(t, TAREFAS[t]));
    }
    return json(200, { ok: true, servico: "Cabueta do Elon Musk · worker" });
  } catch (e) {
    console.error("[worker]", e.message);
    return json(500, { erro: e.message });
  }
});

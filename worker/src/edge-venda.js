// Edge Function "aviso-venda" (separada do "worker", para nao mexer nele): recebe do site uma venda nova de imersao
// ou plataforma e avisa o Bruno no WhatsApp. Publicar com verify_jwt desligado; o acesso e pelo x-worker-token.
import { supa as db } from "./supa.js";
import { avisarVenda } from "./vendaAviso.js";

const json = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { "Content-Type": "application/json" } });
const segredoIgual = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

Deno.serve(async req => {
  try {
    if (req.method !== "POST") return json(405, { erro: "use POST" });
    const [t] = await db.select("worker_token", { select: "token", filters: { id: "eq.1" } });
    const k = req.headers.get("x-worker-token") || "";
    if (!t?.token || k.length !== t.token.length || !segredoIgual(k, t.token)) return json(401, { erro: "nao autorizado" });
    const body = await req.json().catch(() => null);
    if (!body) return json(400, { erro: "corpo invalido" });
    return json(200, await avisarVenda(db, body));
  } catch (e) {
    console.error("[aviso-venda]", String(e?.message || e).slice(0, 200));
    return json(500, { ok: false, erro: "erro inesperado" });
  }
});

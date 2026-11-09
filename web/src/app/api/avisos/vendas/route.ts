import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { avisarVendasNovas } from "@/lib/avisoVendas";

// Chamada pelo relogio do banco (pg_cron, a cada 15 min, logo depois da sincronizacao do CRM). Sem login:
// vale o x-worker-token (o mesmo segredo que o site ja usa para falar com o worker).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const db = createAdminClient();
    const { data: tk } = await db.from("worker_token").select("token").eq("id", 1).maybeSingle();
    const enviado = Buffer.from(req.headers.get("x-worker-token") || ""), certo = Buffer.from(tk?.token || "");
    if (!certo.length || enviado.length !== certo.length || !timingSafeEqual(enviado, certo)) return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 401 });
    const r = await avisarVendasNovas(db, tk!.token);
    return NextResponse.json(r, { status: r.erro ? 500 : 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : "Erro inesperado." }, { status: 500 });
  }
}

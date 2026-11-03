import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { progressoDesde, receberPlanilha, segredoOk } from "@/lib/closer/sync";

// Chamada pelo Google Apps Script da planilha do Closer (apps-script/closer-sync.gs). Sem login: vale o cabecalho x-sync-secret.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const negado = () => NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 401 });
const falhou = (e: unknown) => NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : "Erro inesperado." }, { status: 500 });
const tabela = (v: unknown): string[][] => (Array.isArray(v) ? v.map((l) => (Array.isArray(l) ? l.map((c) => String(c ?? "")) : [])) : []);

// Planilha -> sistema: recebe as 3 abas (valores) e atualiza os leads
export async function POST(req: NextRequest) {
  if (!segredoOk(req.headers.get("x-sync-secret"))) return negado();
  try {
    const corpo = await req.json().catch(() => null);
    if (!corpo?.abas) return NextResponse.json({ ok: false, erro: "Faltam as abas." }, { status: 400 });
    const r = await receberPlanilha(tabela(corpo.abas.todos), tabela(corpo.abas.participantes), tabela(corpo.abas.atencao));
    revalidatePath("/closer");
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return falhou(e);
  }
}

// Sistema -> planilha: progresso alterado no painel depois de ?desde=<data ISO>
export async function GET(req: NextRequest) {
  if (!segredoOk(req.headers.get("x-sync-secret"))) return negado();
  try {
    const agora = new Date().toISOString();
    const progresso = await progressoDesde(req.nextUrl.searchParams.get("desde"));
    return NextResponse.json({ ok: true, agora, progresso });
  } catch (e) {
    return falhou(e);
  }
}

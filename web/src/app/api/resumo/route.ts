import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { lerPeriodo } from "@/lib/periodo";
import { calcularRitmo } from "@/app/apresentacao/visao-geral/calc";
import { montarVisaoGeral } from "@/app/apresentacao/visao-geral/dados";

// Numeros do resumo de WhatsApp (13h e 19h) = os MESMOS da apresentacao (TV): vendas do dia por produto, marcacoes,
// reunioes e follow-ups por pessoa, e o mes contra a meta. Chamada so pelo worker, com a chave interna worker_token.
// Devolve so numeros e o primeiro nome de cada pessoa (nada de cliente, telefone ou conversa).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function igual(a: string, b: string) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

export async function GET(req: NextRequest) {
  const db = createAdminClient();
  const { data: tk } = await db.from("worker_token").select("token").eq("id", 1).maybeSingle();
  const k = req.headers.get("x-worker-token") ?? "";
  if (!tk?.token || !igual(k, tk.token)) return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 401 });
  const org = req.nextUrl.searchParams.get("org") ?? "";
  if (!UUID.test(org)) return NextResponse.json({ ok: false, erro: "Empresa inválida." }, { status: 400 });
  try {
    const [dia, mes] = await Promise.all([montarVisaoGeral(org, lerPeriodo({ p: "hoje" })), montarVisaoGeral(org, lerPeriodo({ p: "mes" }))]);
    const r = calcularRitmo(mes.fat.real, mes.fat.meta, mes.periodo.diaUtil, mes.periodo.diasUteisMes);
    return NextResponse.json({
      ok: true,
      dia: {
        total: dia.fat.real,
        produtos: (dia.fat.porProduto ?? []).map((p) => ({ produto: p.produto, n: p.n, valor: p.valor })),
        convites: Number(dia.kpis.convites?.valor ?? 0) || 0,
        pessoas: dia.pessoas.map((p) => ({ id: p.id, nome: p.nome.split(/\s+/)[0], tipo: p.tipo, marcacoes: p.marcacoes?.v ?? null, reunioes: p.reunioes?.v ?? null, followups: p.followups?.qtd ?? null, vendasValor: p.vendasValor, vendasN: p.vendasN })),
      },
      mes: { real: mes.fat.real, meta: mes.fat.meta, pct: r.pctMeta, ritmoPct: r.ritmoPct, projecao: r.projecao, precisaPorDia: r.precisaPorDia, diaUtil: mes.periodo.diaUtil, diasUteis: mes.periodo.diasUteisMes,
        produtos: (mes.fat.porProduto ?? []).map((p) => ({ produto: p.produto, n: p.n, valor: p.valor })) },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message.slice(0, 160) : "Erro inesperado." }, { status: 500 });
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { lerPeriodo } from "@/lib/periodo";
import { calcularRitmo } from "@/app/apresentacao/visao-geral/calc";
import { montarVisaoGeral } from "@/app/apresentacao/visao-geral/dados";

// Dados da pagina /ao-vivo (resultados em tempo real para a diretoria). Publica, mas so com o link secreto (?k=) guardado
// na tabela ao_vivo_link. Devolve so numeros agregados e o primeiro nome de cada pessoa: nada de cliente, telefone ou conversa.
// O resultado fica 60 s no cache da Vercel: quantas pessoas abrirem, o banco responde no maximo 1 vez por minuto por periodo.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function igual(a: string, b: string) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
const CABECALHO = { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" };

export async function GET(req: NextRequest) {
  const db = createAdminClient();
  const k = req.nextUrl.searchParams.get("k") ?? "";
  const { data: tk } = await db.from("ao_vivo_link").select("token").eq("id", 1).maybeSingle();
  if (!tk?.token || !igual(k, tk.token)) return NextResponse.json({ ok: false, erro: "Link inválido." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const p = req.nextUrl.searchParams.get("p") ?? "mes";
  const periodo = lerPeriodo({ p: ["hoje", "semana", "mes"].includes(p) ? p : "mes" }, "mes");
  try {
    const { data: org } = await db.from("organizacoes").select("id").eq("slug", "weevo").maybeSingle();
    if (!org) return NextResponse.json({ ok: false, erro: "Empresa não encontrada." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    const d = await montarVisaoGeral(org.id, periodo);
    const r = calcularRitmo(d.fat.real, d.fat.meta, d.periodo.diaUtil, d.periodo.diasUteisMes);
    const kpi = (id: keyof typeof d.kpis) => { const x = d.kpis[id]; return x ? { valor: x.valor, sub: x.sub } : null; };
    return NextResponse.json({
      ok: true,
      atualizadoEm: d.atualizadoEm,
      periodo: { p: d.periodo.p, rotulo: d.periodo.rotulo, intervalo: d.periodo.intervalo, mensal: d.periodo.mensal, diaUtil: d.periodo.diaUtil, diasUteisMes: d.periodo.diasUteisMes },
      fat: { real: d.fat.real, meta: d.fat.meta, pct: r.pctMeta, ritmoPct: r.ritmoPct, projecao: r.projecao, precisaPorDia: r.precisaPorDia, serie: d.fat.serie,
        produtos: (d.fat.porProduto ?? []).map((x) => ({ produto: x.produto, n: x.n, valor: x.valor })) },
      conversao: d.conversao ?? null,
      pessoas: d.pessoas.map((x) => ({ nome: x.nome.split(/\s+/)[0], tipo: x.tipo, conversas: x.conversas, marcacoes: x.marcacoes, vendasValor: x.vendasValor, vendasN: x.vendasN })),
      kpis: { marcacoes: kpi("marcacoes_time"), conversas: kpi("conversas_time"), convites: kpi("convites"), nota: kpi("nota"), primeira: kpi("primeira") },
    }, { headers: CABECALHO });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message.slice(0, 160) : "Erro inesperado." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

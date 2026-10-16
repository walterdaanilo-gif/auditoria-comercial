import Link from "next/link";
import { revalidatePath } from "next/cache";
import AutoRefresh from "@/components/AutoRefresh";
import Markdown from "@/components/Markdown";
import { exigirPerfil } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { corNota, fmtData, hojeBR, nota, pct, somaDias } from "@/lib/format";
import { GATILHOS } from "@/lib/types";

export const dynamic = "force-dynamic";

async function pedirAnalise(fd: FormData) {
  "use server";
  const perfil = await exigirPerfil();
  if (perfil.papel === "vendedor") return;
  const periodo = fd.get("periodo") === "30" ? "30" : "7";
  await (await createClient()).from("analises_time").insert({ periodo, solicitado_por: perfil.id }); // RLS: so gestor/admin
  revalidatePath("/");
}

type Resumo = { vendedor_id: string; tratadas: number; enviadas: number; recebidas: number; responderam: number };
type Aud = { vendedor_id: string; nota_geral: number; qualidade: string | null; agendou: boolean; efetiva: boolean; gatilhos: Record<string, boolean>; etapa: string | null; objecoes: string | null };

export default async function Painel({ searchParams: searchParamsP }: { searchParams: Promise<{ p?: string; v?: string }> }) {
  const searchParams = await searchParamsP;
  const perfil = await exigirPerfil();
  const gestor = perfil.papel !== "vendedor";
  const p = ["hoje", "7", "30"].includes(searchParams.p ?? "") ? (searchParams.p as string) : "hoje";
  const to = hojeBR();
  const from = somaDias(to, p === "30" ? -29 : p === "7" ? -6 : 0);
  const supabase = await createClient();

  const [r1, r2, r3, r4, r5, r6] = await Promise.all([
    supabase.rpc("resumo_por_vendedor", { p_from: from, p_to: to }),
    supabase.from("auditorias").select("vendedor_id,nota_geral,qualidade,agendou,efetiva,gatilhos,etapa,objecoes").gte("atualizado_em", `${from}T00:00:00-03:00`).limit(5000),
    supabase.from("profiles").select("id,nome").order("nome"),
    gestor ? supabase.from("analises_time").select("*").eq("status", "pronta").order("criado_em", { ascending: false }).limit(1) : Promise.resolve({ data: [] as any[] }),
    gestor ? supabase.from("analises_time").select("id").eq("status", "pendente").limit(1) : Promise.resolve({ data: [] as any[] }),
    gestor ? supabase.from("analises_time").select("status,erro").order("criado_em", { ascending: false }).limit(1) : Promise.resolve({ data: [] as any[] }),
  ]);

  const nomes = new Map<string, string>((r3.data ?? []).map((x: any) => [x.id, x.nome]));
  const filtroV = gestor && searchParams.v && nomes.has(searchParams.v) ? searchParams.v : "";
  const resumo = ((r1.data ?? []) as Resumo[]).filter((x) => !filtroV || x.vendedor_id === filtroV);
  const auds = ((r2.data ?? []) as Aud[]).filter((x) => !filtroV || x.vendedor_id === filtroV);
  const analise = (r4.data ?? [])[0] as { texto: string; criado_em: string } | undefined;
  const analisePendente = ((r5.data ?? []) as unknown[]).length > 0;
  const ultimaAnalise = (r6.data ?? [])[0] as { status: string; erro: string | null } | undefined;

  const soma = (k: keyof Resumo) => resumo.reduce((s, x) => s + Number(x[k] || 0), 0);
  const nAud = auds.length;
  const notaMedia = nAud ? auds.reduce((s, a) => s + Number(a.nota_geral), 0) / nAud : null;
  const boas = auds.filter((a) => a.qualidade === "boa").length;
  const reg = auds.filter((a) => a.qualidade === "regular").length;
  const ruins = auds.filter((a) => a.qualidade === "ruim").length;
  const agendaram = auds.filter((a) => a.agendou).length;
  const gat = Object.fromEntries(Object.keys(GATILHOS).map((k) => [k, auds.filter((a) => a.gatilhos?.[k]).length]));
  const etapas: Record<string, number> = {};
  const obj: Record<string, number> = {};
  for (const a of auds) {
    if (a.etapa) etapas[a.etapa] = (etapas[a.etapa] || 0) + 1;
    const k = (a.objecoes || "").trim().toLowerCase().slice(0, 60);
    if (k) obj[k] = (obj[k] || 0) + 1;
  }
  const topObj = Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const ids = Array.from(new Set([...resumo.map((x) => x.vendedor_id), ...auds.map((x) => x.vendedor_id)]));
  const link = (o: Record<string, string>) => "/?" + new URLSearchParams({ p, ...(filtroV ? { v: filtroV } : {}), ...o }).toString();
  const rotulo = p === "30" ? "últimos 30 dias" : p === "7" ? "últimos 7 dias" : "hoje";

  const kpi = (t: string, v: React.ReactNode, sub?: string, cls = "") => (
    <div className="card"><div className="label">{t}</div><div className={`mt-1 text-3xl font-bold ${cls}`}>{v}</div>{sub && <div className="text-xs text-mute">{sub}</div>}</div>
  );
  const barras = (itens: [string, number][], total: number) =>
    itens.map(([l, v]) => (
      <div key={l} className="grid grid-cols-[170px_1fr_44px] items-center gap-3 py-1 text-sm">
        <span>{l}</span><div className="h-2.5 overflow-hidden rounded-full bg-track"><div className="h-full bg-brand" style={{ width: total ? `${Math.round((v / total) * 100)}%` : "0%" }} /></div><span className="text-mute">{pct(v, total)}</span>
      </div>
    ));

  return (
    <div className="space-y-5">
      <AutoRefresh segundos={30} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="page-title">Painel</h1><p className="page-sub">{rotulo} · {fmtData(from)} a {fmtData(to)} · atualiza sozinho</p></div>
        <div className="flex flex-wrap gap-2 text-sm">
          {[["hoje", "Hoje"], ["7", "7 dias"], ["30", "30 dias"]].map(([k, t]) => <Link key={k} href={link({ p: k })} className={`chip ${p === k ? "chip-on" : "border-line"}`}>{t}</Link>)}
          {gestor && <form className="flex gap-2"><input type="hidden" name="p" value={p} />
            <select name="v" defaultValue={filtroV} className="input !w-auto !py-1"><option value="">Todos os vendedores</option>{Array.from(nomes).map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
            <button className="btn-ghost">Filtrar</button></form>}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpi("Conversas tratadas", soma("tratadas"))}
        {kpi("Mensagens enviadas", soma("enviadas"))}
        {kpi("Mensagens recebidas", soma("recebidas"))}
        {kpi("Leads que responderam", soma("responderam"), `${pct(soma("responderam"), soma("tratadas"))} das tratadas`)}
        {kpi("Nota média", nota(notaMedia), `${nAud} auditadas`, corNota(notaMedia))}
        {kpi("Conversas boas", pct(boas, nAud), `${boas} boas · ${reg} regulares · ${ruins} ruins`)}
        {kpi("Agendamentos", agendaram, `${pct(agendaram, nAud)} das auditadas`)}
      </div>

      <div className="card overflow-x-auto">
        <div className="label mb-2">Por vendedor</div>
        <table className="w-full"><thead><tr><th className="th">Vendedor</th><th className="th">Tratadas</th><th className="th">Enviadas</th><th className="th">Recebidas</th><th className="th">Responderam</th><th className="th">Auditadas</th><th className="th">Nota</th><th className="th">Agendou</th></tr></thead>
          <tbody>{ids.map((id) => {
            const r = resumo.find((x) => x.vendedor_id === id); const a = auds.filter((x) => x.vendedor_id === id);
            const m = a.length ? a.reduce((s, x) => s + Number(x.nota_geral), 0) / a.length : null;
            return <tr key={id}><td className="td font-semibold">{nomes.get(id) ?? "—"}</td><td className="td">{r?.tratadas ?? 0}</td><td className="td">{r?.enviadas ?? 0}</td><td className="td">{r?.recebidas ?? 0}</td><td className="td">{r?.responderam ?? 0}</td><td className="td">{a.length}</td><td className={`td font-bold ${corNota(m)}`}>{nota(m)}</td><td className="td">{a.filter((x) => x.agendou).length}</td></tr>;
          })}{!ids.length && <tr><td className="td text-mute" colSpan={8}>Sem dados no período.</td></tr>}</tbody></table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card"><div className="label mb-2">Gatilhos comerciais usados</div>
          {nAud ? barras(Object.entries(GATILHOS).map(([k, t]) => [t, gat[k]] as [string, number]), nAud) : <p className="text-sm text-mute">Aparece quando houver conversas auditadas.</p>}
          <p className="mt-2 text-xs text-mute">% das conversas auditadas em que o vendedor usou o gatilho.</p></div>
        <div className="card"><div className="label mb-2">Etapa em que as conversas pararam</div>
          {nAud ? barras(Object.entries(etapas).sort((a, b) => b[1] - a[1]), nAud) : <p className="text-sm text-mute">Sem dados ainda.</p>}
          <div className="label mb-2 mt-5">Objeções mais comuns</div>
          {topObj.length ? topObj.map(([o, n]) => <div key={o} className="flex justify-between py-0.5 text-sm"><span>{o}</span><span className="text-mute">{n}x</span></div>) : <p className="text-sm text-mute">Nenhuma objeção registrada.</p>}</div>
      </div>

      {gestor && (
        <div className="card">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <div className="label">Análise comercial do time {analise && <span className="normal-case">· gerada em {new Date(analise.criado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" })}</span>}</div>
            <form action={pedirAnalise} className="flex gap-2">
              <select name="periodo" defaultValue={p === "30" ? "30" : "7"} className="input !w-auto !py-1"><option value="7">7 dias</option><option value="30">30 dias</option></select>
              <button className="btn" disabled={analisePendente}>{analisePendente ? "Gerando..." : "Gerar nova análise"}</button>
            </form>
          </div>
          {ultimaAnalise?.status === "erro" && <p className="mb-2 text-sm text-bad">A última tentativa falhou: {ultimaAnalise.erro}</p>}
          {analise ? <Markdown texto={analise.texto} /> : <p className="text-sm text-mute">Ainda não há análise. Ela diz se o time está trabalhando do jeito certo, quais gatilhos faltam e o que fazer esta semana. Fica pronta em cerca de um minuto depois de pedir.</p>}
        </div>
      )}
    </div>
  );
}

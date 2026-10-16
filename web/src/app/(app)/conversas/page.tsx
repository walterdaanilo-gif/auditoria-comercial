import Link from "next/link";
import AutoRefresh from "@/components/AutoRefresh";
import { exigirPerfil } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { corNota, fmtData, fmtHora, hojeBR, nota, somaDias, telefone, um } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Conversas({ searchParams: searchParamsP }: { searchParams: Promise<{ p?: string; v?: string }> }) {
  const searchParams = await searchParamsP;
  const perfil = await exigirPerfil();
  const gestor = perfil.papel !== "vendedor";
  const p = ["hoje", "7", "30"].includes(searchParams.p ?? "") ? (searchParams.p as string) : "7";
  const to = hojeBR();
  const from = somaDias(to, p === "30" ? -29 : p === "7" ? -6 : 0);
  const supabase = await createClient();

  let q = supabase.from("conversas")
    .select("id,vendedor_id,contato,contato_nome,canal,data,ultima_msg_em,mensagens(count),auditorias(nota_geral,qualidade,agendou,resumo)")
    .gte("data", from).lte("data", to).order("ultima_msg_em", { ascending: false }).limit(200);
  if (gestor && searchParams.v) q = q.eq("vendedor_id", searchParams.v);
  const [{ data }, { data: perfis }] = await Promise.all([q, supabase.from("profiles").select("id,nome").order("nome")]);
  const nomes = new Map<string, string>((perfis ?? []).map((x: any) => [x.id, x.nome]));
  const link = (k: string) => "/conversas?" + new URLSearchParams({ p: k, ...(searchParams.v ? { v: searchParams.v } : {}) });

  return (
    <div className="space-y-4">
      <AutoRefresh segundos={30} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Conversas</h1>
        <div className="flex flex-wrap gap-2 text-sm">
          {[["hoje", "Hoje"], ["7", "7 dias"], ["30", "30 dias"]].map(([k, t]) => <Link key={k} href={link(k)} className={`chip ${p === k ? "chip-on" : "border-line"}`}>{t}</Link>)}
          {gestor && <form className="flex gap-2"><input type="hidden" name="p" value={p} />
            <select name="v" defaultValue={searchParams.v ?? ""} className="input !w-auto !py-1"><option value="">Todos</option>{Array.from(nomes).map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
            <button className="btn-ghost">Filtrar</button></form>}
        </div>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full"><thead><tr><th className="th">Quando</th><th className="th">Vendedor</th><th className="th">Contato</th><th className="th">Msgs</th><th className="th">Nota</th><th className="th">Qualidade</th><th className="th">Resumo</th></tr></thead>
          <tbody>
            {(data ?? []).map((c: any) => {
              const a = um<any>(c.auditorias); const n = um<any>(c.mensagens)?.count ?? 0;
              return (
                <tr key={c.id}>
                  <td className="td text-mute">{fmtData(c.data).slice(0, 5)} {fmtHora(c.ultima_msg_em)}</td>
                  <td className="td">{nomes.get(c.vendedor_id) ?? "—"}</td>
                  <td className="td"><Link className="text-brand" href={`/conversas/${c.id}`}>{c.contato_nome || telefone(c.contato)}</Link>{c.canal === "importada" && <span className="chip ml-2 border-line text-mute">importada</span>}</td>
                  <td className="td">{n}</td>
                  <td className={`td font-bold ${corNota(a?.nota_geral)}`}>{nota(a?.nota_geral)}</td>
                  <td className="td">{a ? <><span className={`chip ${a.qualidade === "boa" ? "border-ok text-ok" : a.qualidade === "regular" ? "border-warn text-warn" : "border-bad text-bad"}`}>{a.qualidade}</span>{a.agendou && <span className="chip ml-1 border-ok text-ok">agendou</span>}</> : <span className="text-mute">aguardando auditoria</span>}</td>
                  <td className="td text-mute">{a?.resumo}</td>
                </tr>
              );
            })}
            {!data?.length && <tr><td className="td text-mute" colSpan={7}>Nenhuma conversa no período.</td></tr>}
          </tbody></table>
      </div>
    </div>
  );
}

import Link from "next/link";
import { MessageCircleReply, MessageCircleOff, MessagesSquare } from "lucide-react";
import AutoRefresh from "@/components/AutoRefresh";
import FiltroPeriodo from "@/components/FiltroPeriodo";
import { exigirPerfil } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { corNota, fmtData, fmtHora, nota, telefone, um } from "@/lib/format";
import { lerPeriodo } from "@/lib/periodo";
import { corSdr } from "@/lib/metas";

export const dynamic = "force-dynamic";

type Aba = "respondeu" | "sem_resposta" | "todas";
const ABAS: { k: Aba; t: string; Icone: typeof MessagesSquare }[] = [
  { k: "respondeu", t: "Responderam", Icone: MessageCircleReply },
  { k: "sem_resposta", t: "Sem resposta", Icone: MessageCircleOff },
  { k: "todas", t: "Todas", Icone: MessagesSquare },
];
const tempo = (min: number) => (min < 60 ? `${min} min` : min < 1440 ? `${Math.floor(min / 60)} h` : `${Math.floor(min / 1440)} d`);

export default async function Conversas({ searchParams: spP }: { searchParams: Promise<{ p?: string; de?: string; ate?: string; v?: string; aba?: string }> }) {
  const sp = await spP;
  const perfil = await exigirPerfil();
  const gestor = perfil.papel !== "vendedor";
  const periodo = lerPeriodo(sp, "7");
  const aba: Aba = sp.aba === "sem_resposta" || sp.aba === "todas" ? sp.aba : "respondeu";
  const supabase = await createClient();

  let q = supabase.from("conversas")
    .select("id,vendedor_id,contato,telefone,contato_nome,canal,data,ultima_msg_em,mensagens(remetente,texto,tipo,enviada_em),auditorias(nota_geral,qualidade,agendou,remarcacao,resumo)")
    .gte("data", periodo.de).lte("data", periodo.ate).order("ultima_msg_em", { ascending: false }).limit(500);
  if (gestor && sp.v) q = q.eq("vendedor_id", sp.v);
  const [{ data }, { data: perfis }, { data: insts }, { data: porVend }] = await Promise.all([
    q,
    supabase.from("profiles").select("id,nome,papel,funcao,ativo,foto_url").order("nome"),
    gestor ? supabase.from("instancias_whatsapp").select("vendedor_id") : Promise.resolve({ data: [] as any[] }),
    // contagem por pessoa no periodo (para os perfis), sem o filtro de vendedor
    gestor ? supabase.from("conversas").select("vendedor_id").gte("data", periodo.de).lte("data", periodo.ate).limit(10000) : Promise.resolve({ data: [] as any[] }),
  ]);
  const nomes = new Map<string, string>((perfis ?? []).map((x: any) => [x.id, x.nome]));
  // Perfis do time (quem tem WhatsApp cadastrado ou papel vendedor), na mesma ordem e cor do painel
  const donos = new Set(((insts ?? []) as { vendedor_id: string }[]).map((i) => i.vendedor_id));
  const time = ((perfis ?? []) as { id: string; nome: string; papel: string; funcao: string | null; ativo: boolean; foto_url: string | null }[]).filter((x) => x.ativo && donos.has(x.id));
  const qtd = new Map<string, number>();
  for (const r of (porVend ?? []) as { vendedor_id: string }[]) qtd.set(r.vendedor_id, (qtd.get(r.vendedor_id) ?? 0) + 1);
  const totalPeriodo = (porVend ?? []).length;

  // O lead "respondeu" quando a conversa tem mensagem dos dois lados. So essas sao auditadas.
  const linhas = (data ?? []).map((c: any) => {
    const msgs = ((c.mensagens ?? []) as { remetente: string; texto: string | null; tipo: string; enviada_em: string }[]).sort((a, b) => a.enviada_em.localeCompare(b.enviada_em));
    const doSdr = msgs.filter((m) => m.remetente === "vendedor"), doLead = msgs.filter((m) => m.remetente === "cliente");
    return { ...c, n: msgs.length, respondeu: doSdr.length > 0 && doLead.length > 0, ultimaSdr: doSdr[doSdr.length - 1], aud: um<any>(c.auditorias) };
  });
  const cont = { respondeu: linhas.filter((l) => l.respondeu).length, sem_resposta: linhas.filter((l) => !l.respondeu).length, todas: linhas.length };
  const lista = aba === "todas" ? linhas : linhas.filter((l) => (aba === "respondeu" ? l.respondeu : !l.respondeu));
  const extra: Record<string, string> = { ...(periodo.p === "livre" ? { de: periodo.de, ate: periodo.ate } : { p: periodo.p }), ...(sp.v ? { v: sp.v } : {}) };
  const linkAba = (k: Aba) => "/conversas?" + new URLSearchParams({ ...extra, aba: k });
  const nomeContato = (c: any) => c.contato_nome || telefone(c.telefone || c.contato);
  const qualidade = (a: any) => <span className={`chip ${a.qualidade === "boa" ? "border-ok text-ok" : a.qualidade === "regular" ? "border-warn text-warn" : "border-bad text-bad"}`}>{a.qualidade}</span>;

  return (
    <div className="space-y-5">
      <AutoRefresh segundos={60} />
      <div><h1 className="page-title">Conversas</h1>
        <p className="page-sub">Só as conversas em que o lead respondeu são auditadas pela IA. As outras ficam em "Sem resposta" até o lead responder.</p></div>

      <FiltroPeriodo base="/conversas" periodo={periodo} />

      {gestor && (
        <div className="flex flex-wrap gap-3" role="tablist" aria-label="Conversas por vendedor">
          {[{ id: "", nome: "Todos", funcao: null as string | null, foto: null as string | null, cor: "#6dcfc0", n: totalPeriodo }, ...time.map((x, i) => ({ id: x.id, nome: x.nome, funcao: x.funcao, foto: x.foto_url, cor: corSdr(i), n: qtd.get(x.id) ?? 0 }))].map((p) => {
            const on = (sp.v ?? "") === p.id;
            const href = "/conversas?" + new URLSearchParams({ ...(periodo.p === "livre" ? { de: periodo.de, ate: periodo.ate } : { p: periodo.p }), ...(p.id ? { v: p.id } : {}), aba });
            return (
              <Link key={p.id || "todos"} href={href} role="tab" aria-selected={on}
                className={`flex min-w-[150px] items-center gap-3 rounded-2xl border px-4 py-3 transition ${on ? "border-side-edge bg-side-active" : "border-line hover:border-side-edge"}`}>
                {p.foto
                  ? <img src={p.foto} alt={`Foto de ${p.nome}`} className="h-10 w-10 shrink-0 rounded-full object-cover" style={{ boxShadow: `0 0 0 2px ${p.cor}` }} />
                  : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-extrabold text-bg" style={{ background: p.cor }}>{p.id ? p.nome.slice(0, 1).toUpperCase() : <MessagesSquare size={18} />}</span>}
                <span className="min-w-0">
                  <b className={`block truncate ${on ? "text-ink" : ""}`}>{p.nome}</b>
                  <span className="text-xs text-mute">{p.id ? `${p.funcao === "closer" ? "Closer" : "SDR"} · ` : ""}{p.n} conversa{p.n === 1 ? "" : "s"}</span>
                </span>
              </Link>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {ABAS.map(({ k, t, Icone }) => (
          <Link key={k} href={linkAba(k)} className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition ${aba === k ? "border-side-edge bg-side-active text-ink" : "border-line text-mute hover:border-side-edge hover:text-ink"}`}>
            <Icone size={16} />{t}<span className={`rounded-full px-2 text-xs ${aba === k ? "bg-brand text-bg" : "bg-track"}`}>{cont[k]}</span>
          </Link>
        ))}
      </div>

      <div className="card overflow-x-auto">
        {aba === "sem_resposta" ? (
          <table className="w-full"><thead><tr><th className="th">Dia</th><th className="th">Vendedor</th><th className="th">Contato</th><th className="th">Última mensagem do SDR</th><th className="th">Esperando há</th></tr></thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id}>
                  <td className="td text-mute">{fmtData(c.data).slice(0, 5)}</td>
                  <td className="td">{nomes.get(c.vendedor_id) ?? "—"}</td>
                  <td className="td"><Link className="text-brand" href={`/conversas/${c.id}`}>{nomeContato(c)}</Link>{c.canal === "importada" && <span className="chip ml-2 border-line text-mute">importada</span>}{c.canal === "crm" && <span className="chip ml-2 border-line text-mute" title="Histórico vindo do CRM Q5 (antes do WhatsApp ser conectado aqui)">CRM</span>}</td>
                  <td className="td max-w-[420px] truncate text-mute">{c.ultimaSdr?.texto || (c.ultimaSdr ? `[${c.ultimaSdr.tipo}]` : "Só o lead escreveu")}</td>
                  <td className="td text-mute">{c.ultimaSdr ? tempo(Math.max(0, Math.round((Date.now() - new Date(c.ultimaSdr.enviada_em).getTime()) / 60000))) : "—"}</td>
                </tr>
              ))}
              {!lista.length && <tr><td className="td text-mute" colSpan={5}>Nenhuma conversa sem resposta no período.</td></tr>}
            </tbody></table>
        ) : (
          <table className="w-full"><thead><tr><th className="th">Quando</th><th className="th">Vendedor</th><th className="th">Contato</th><th className="th">Msgs</th><th className="th">Nota</th><th className="th">Qualidade</th><th className="th">Resumo</th></tr></thead>
            <tbody>
              {lista.map((c) => {
                const a = c.aud;
                return (
                  <tr key={c.id}>
                    <td className="td text-mute">{fmtData(c.data).slice(0, 5)} {fmtHora(c.ultima_msg_em)}</td>
                    <td className="td">{nomes.get(c.vendedor_id) ?? "—"}</td>
                    <td className="td"><Link className="text-brand" href={`/conversas/${c.id}`}>{nomeContato(c)}</Link>{c.canal === "importada" && <span className="chip ml-2 border-line text-mute">importada</span>}{c.canal === "crm" && <span className="chip ml-2 border-line text-mute" title="Histórico vindo do CRM Q5 (antes do WhatsApp ser conectado aqui)">CRM</span>}</td>
                    <td className="td">{c.n}</td>
                    <td className={`td font-bold ${corNota(a?.nota_geral)}`}>{c.respondeu ? nota(a?.nota_geral) : "—"}</td>
                    <td className="td">{a ? <>{qualidade(a)}{a.agendou && <span className="chip ml-1 border-ok text-ok">agendou</span>}{a.remarcacao && <span className="chip ml-1 border-warn text-warn">remarcação</span>}</>
                      : <span className="text-mute">{c.respondeu ? "aguardando auditoria" : "sem resposta do lead"}</span>}</td>
                    <td className="td text-mute">{a?.resumo}</td>
                  </tr>
                );
              })}
              {!lista.length && <tr><td className="td text-mute" colSpan={7}>{aba === "respondeu" ? "Nenhum lead respondeu no período." : "Nenhuma conversa no período."}</td></tr>}
            </tbody></table>
        )}
      </div>
    </div>
  );
}

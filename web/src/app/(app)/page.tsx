import Link from "next/link";
import { revalidatePath } from "next/cache";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CheckCircle2, CircleDot, Clock, MessageCircleWarning, Phone, ThumbsDown } from "lucide-react";
import AutoRefresh from "@/components/AutoRefresh";
import EvolucaoChart, { type Ponto, type Serie } from "@/components/EvolucaoChart";
import FiltroPeriodo from "@/components/FiltroPeriodo";
import Markdown from "@/components/Markdown";
import { exigirPerfil } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { corNota, fmtHora, nota, pct, telefone, um } from "@/lib/format";
import { METAS, corSdr, diasUteis, type ChaveMeta } from "@/lib/metas";
import { diasEntre, lerPeriodo } from "@/lib/periodo";
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

type Dia = { dia: string; vendedor_id: string; contatadas: number; enviadas: number; respostas: number; ligacoes: number; auditadas: number; nota_soma: number; agendados: number; efetivas: number; workshop: number; imersao: number };
type Totais = Omit<Dia, "dia" | "vendedor_id">;
type Aud = { vendedor_id: string; gatilhos: Record<string, boolean>; etapa: string | null; objecoes: string | null };
type Atividade = { vendedor_id: string; ultima_msg_em: string | null; ultima_ligacao_em: string | null; conversas_hoje: number };

const ZERO: Totais = { contatadas: 0, enviadas: 0, respostas: 0, ligacoes: 0, auditadas: 0, nota_soma: 0, agendados: 0, efetivas: 0, workshop: 0, imersao: 0 };
const somar = (linhas: Dia[]): Totais => linhas.reduce((t, l) => {
  const o = { ...t }; for (const k of Object.keys(ZERO) as (keyof Totais)[]) o[k] = Number(o[k]) + Number(l[k] || 0); return o;
}, { ...ZERO });
const media = (t: Totais) => (t.auditadas ? t.nota_soma / t.auditadas : null);
const minutosDesde = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
const tempo = (min: number) => (min < 60 ? `${min} min` : min < 1440 ? `${Math.floor(min / 60)} h ${min % 60 ? `${min % 60} min` : ""}`.trim() : `${Math.floor(min / 1440)} dia${min >= 2880 ? "s" : ""}`);

export default async function Painel({ searchParams: searchParamsP }: { searchParams: Promise<{ p?: string; de?: string; ate?: string; v?: string }> }) {
  const sp = await searchParamsP;
  const perfil = await exigirPerfil();
  const gestor = perfil.papel !== "vendedor";
  const periodo = lerPeriodo(sp);
  const { de, ate } = periodo;
  const supabase = await createClient();

  const [rDia, rAud, rPerf, rAtiv, rInst, rFeed, rSem, rAlerta, rAnalise, rPend, rUlt] = await Promise.all([
    supabase.rpc("resumo_sdr", { p_from: de, p_to: ate }),
    supabase.from("auditorias").select("vendedor_id,gatilhos,etapa,objecoes,conversas!inner(data,canal)").neq("conversas.canal", "importada").gte("conversas.data", de).lte("conversas.data", ate).limit(5000),
    supabase.from("profiles").select("id,nome,papel,ativo").order("nome"),
    supabase.rpc("ultima_atividade"),
    supabase.from("instancias_whatsapp").select("vendedor_id,status,numero"),
    supabase.from("mensagens").select("id,vendedor_id,remetente,texto,tipo,transcricao,enviada_em,conversa_id,conversas!inner(contato,contato_nome,canal)").neq("conversas.canal", "importada").order("enviada_em", { ascending: false }).limit(15),
    supabase.rpc("conversas_sem_retorno", { p_from: de, p_to: ate, p_min: 15 }),
    supabase.from("auditorias").select("id,conversa_id,vendedor_id,nota_geral,qualidade,agendou,efetiva,resumo,conversas!inner(contato,contato_nome,data,canal)")
      .neq("conversas.canal", "importada").gte("conversas.data", de).lte("conversas.data", ate).or("qualidade.eq.ruim,and(efetiva.eq.true,agendou.eq.false)").order("nota_geral").limit(50),
    gestor ? supabase.from("analises_time").select("*").eq("status", "pronta").order("criado_em", { ascending: false }).limit(1) : Promise.resolve({ data: [] as any[] }),
    gestor ? supabase.from("analises_time").select("id").eq("status", "pendente").limit(1) : Promise.resolve({ data: [] as any[] }),
    gestor ? supabase.from("analises_time").select("status,erro").order("criado_em", { ascending: false }).limit(1) : Promise.resolve({ data: [] as any[] }),
  ]);

  // SDRs = perfis com papel vendedor. A cor segue a pessoa (ordem por nome na lista completa), nunca o filtro.
  const perfis = (rPerf.data ?? []) as { id: string; nome: string; papel: string; ativo: boolean }[];
  const nomes = new Map(perfis.map((x) => [x.id, x.nome]));
  const sdrsTodos = perfis.filter((x) => x.papel === "vendedor" && x.ativo);
  const cor = new Map(sdrsTodos.map((s, i) => [s.id, corSdr(i)]));
  const filtroV = gestor && sp.v && nomes.has(sp.v) ? sp.v : "";
  const doFiltro = <T extends { vendedor_id: string }>(l: T[]) => l.filter((x) => !filtroV || x.vendedor_id === filtroV);
  const sdrs = sdrsTodos.filter((s) => !filtroV || s.id === filtroV);

  const linhas = doFiltro(((rDia.data ?? []) as any[]).map((l) => ({ ...l, agendados: l.marcacoes })) as Dia[]);
  const auds = doFiltro((rAud.data ?? []) as unknown as Aud[]);
  const ativ = new Map(((rAtiv.data ?? []) as Atividade[]).map((a) => [a.vendedor_id, a]));
  const inst = new Map(((rInst.data ?? []) as { vendedor_id: string; status: string; numero: string | null }[]).map((i) => [i.vendedor_id, i]));
  const feed = doFiltro((rFeed.data ?? []) as any[]);
  const semRetorno = doFiltro((rSem.data ?? []) as { conversa_id: string; vendedor_id: string; contato: string; contato_nome: string | null; ultima_msg_em: string; texto: string }[]);
  const alertas = doFiltro((rAlerta.data ?? []) as any[]);
  const notaRuim = alertas.filter((a) => a.qualidade === "ruim");
  const semAgendar = alertas.filter((a) => a.qualidade !== "ruim" && a.efetiva && !a.agendou);
  const analise = (rAnalise.data ?? [])[0] as { texto: string; criado_em: string } | undefined;
  const analisePendente = ((rPend.data ?? []) as unknown[]).length > 0;
  const ultimaAnalise = (rUlt.data ?? [])[0] as { status: string; erro: string | null } | undefined;

  const total = somar(linhas);
  const porSdr = new Map(sdrs.map((s) => [s.id, somar(linhas.filter((l) => l.vendedor_id === s.id))]));
  const uteis = diasUteis(de, ate);
  const dias = diasEntre(de, ate);
  const series: Serie[] = sdrs.map((s) => ({
    id: s.id, nome: s.nome, cor: cor.get(s.id)!,
    pontos: dias.map((d): Ponto => {
      const l = linhas.find((x) => x.vendedor_id === s.id && x.dia === d);
      return { contatadas: Number(l?.contatadas ?? 0), respostas: Number(l?.respostas ?? 0), ligacoes: Number(l?.ligacoes ?? 0), agendados: Number(l?.agendados ?? 0), nota: l && Number(l.auditadas) ? Number(l.nota_soma) / Number(l.auditadas) : null };
    }),
  }));

  const nAud = auds.length;
  const gat = Object.fromEntries(Object.keys(GATILHOS).map((k) => [k, auds.filter((a) => a.gatilhos?.[k]).length]));
  const etapas: Record<string, number> = {}, obj: Record<string, number> = {};
  for (const a of auds) {
    if (a.etapa) etapas[a.etapa] = (etapas[a.etapa] || 0) + 1;
    const k = (a.objecoes || "").trim().toLowerCase().slice(0, 60);
    if (k) obj[k] = (obj[k] || 0) + 1;
  }
  const topObj = Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const kpi = (t: string, v: React.ReactNode, sub?: string, cls = "") => (
    <div className="card"><div className="label">{t}</div><div className={`mt-2 text-4xl font-bold tabular-nums ${cls}`}>{v}</div>{sub && <div className="mt-1 text-xs text-mute">{sub}</div>}</div>
  );
  const barras = (itens: [string, number][], tot: number) => itens.map(([l, v]) => (
    <div key={l} className="grid grid-cols-[170px_1fr_44px] items-center gap-3 py-1 text-sm">
      <span>{l}</span><div className="h-2.5 overflow-hidden rounded-full bg-track"><div className="h-full rounded-full bg-brand" style={{ width: tot ? `${Math.round((v / tot) * 100)}%` : "0%" }} /></div><span className="text-mute">{pct(v, tot)}</span>
    </div>
  ));
  const Bolinha = ({ id }: { id: string }) => <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: cor.get(id) ?? "#9ba5a4" }} />;
  const contato = (c: { contato: string; contato_nome: string | null } | null) => (c ? c.contato_nome || telefone(c.contato) : "—");

  // Situacao ao vivo de um SDR: icone + texto (nunca so cor)
  const situacao = (id: string) => {
    const a = ativ.get(id);
    const ult = [a?.ultima_msg_em, a?.ultima_ligacao_em].filter(Boolean).sort().pop() as string | undefined;
    if (!ult) return { txt: "Sem atividade registrada", cls: "text-mute", Icone: CircleDot, ult };
    const min = minutosDesde(ult);
    if (min <= 30) return { txt: "Ativo agora", cls: "text-ok", Icone: CheckCircle2, ult };
    if (min <= 180) return { txt: `Parado há ${tempo(min)}`, cls: "text-warn", Icone: Clock, ult };
    return { txt: `Parado há ${tempo(min)}`, cls: "text-bad", Icone: AlertTriangle, ult };
  };

  return (
    <div className="space-y-6">
      <AutoRefresh segundos={30} />
      <div><h1 className="page-title">Painel</h1><p className="page-sub">O que o time está fazendo, comparado com as metas. Atualiza sozinho a cada 30 segundos.</p></div>

      <FiltroPeriodo base="/" periodo={periodo} vendedores={gestor ? sdrsTodos.map((s) => [s.id, s.nome]) : undefined} vendedor={filtroV} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {kpi("Contatadas", total.contatadas, `${total.enviadas} mensagens enviadas`)}
        {kpi("Responderam", total.respostas, `${pct(total.respostas, total.contatadas)} das conversas`)}
        {kpi("Ligações", total.ligacoes, "gravações enviadas")}
        {kpi("Marcações", total.agendados, `${total.workshop} workshop · ${total.imersao} imersão`)}
        {kpi("Nota média", nota(media(total)), `${total.auditadas} auditadas`, corNota(media(total)))}
      </div>

      {/* Metas por SDR */}
      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-bold">Metas por SDR</h2>
          <span className="text-sm text-mute">Meta diária × {uteis} dia{uteis > 1 ? "s" : ""} út{uteis > 1 ? "eis" : "il"} no período</span>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {sdrs.map((s) => {
            const t = porSdr.get(s.id) ?? ZERO; const sit = situacao(s.id); const w = inst.get(s.id);
            return (
              <div key={s.id} className="card">
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <Bolinha id={s.id} /><b className="text-lg">{s.nome}</b>
                  <span className={`flex items-center gap-1 text-sm ${sit.cls}`}><sit.Icone size={15} />{sit.txt}</span>
                  <span className={`ml-auto chip ${w?.status === "conectado" ? "border-ok text-ok" : "border-line text-mute"}`}>WhatsApp {w?.status === "conectado" ? "conectado" : w ? w.status.replace("_", " ") : "não criado"}</span>
                </div>
                <div className="space-y-3">
                  {METAS.map(({ chave, rotulo, meta, soma }) => {
                    const feito = soma.reduce((n, k: ChaveMeta) => n + Number(t[k]), 0);
                    if (meta === null) return ( // sem meta propria: numero e taxa sobre os contatos
                      <div key={chave}>
                        <div className="mb-1 flex items-baseline justify-between text-sm"><span>{rotulo}</span>
                          <span className="tabular-nums"><b className="text-base">{feito}</b><span className="ml-2 text-mute">{pct(feito, Number(t.contatadas))} das conversas</span></span></div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-track"><div className="h-full rounded-full bg-side-edge" style={{ width: `${Math.min(100, t.contatadas ? (feito / Number(t.contatadas)) * 100 : 0)}%` }} /></div>
                      </div>
                    );
                    const alvo = meta * uteis; const ok = feito >= alvo;
                    return (
                      <div key={chave}>
                        <div className="mb-1 flex items-baseline justify-between text-sm">
                          <span>{rotulo}{chave === "agendados" && feito > 0 && <span className="ml-2 text-xs text-mute">{t.workshop} workshop · {t.imersao} imersão</span>}</span>
                          <span className="tabular-nums"><b className="text-base">{feito}</b><span className="text-mute"> / {alvo}</span>
                            {ok ? <span className="ml-2 inline-flex items-center gap-1 text-ok"><CheckCircle2 size={14} />meta batida</span> : <span className="ml-2 text-mute">{pct(feito, alvo)}</span>}</span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-track"><div className={`h-full rounded-full ${ok ? "bg-ok" : "bg-brand"}`} style={{ width: `${Math.min(100, alvo ? (feito / alvo) * 100 : 0)}%` }} /></div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-3 text-sm text-mute">
                  <span>Nota média <b className={corNota(media(t))}>{nota(media(t))}</b></span>
                  <span>{t.auditadas} auditadas</span><span>{t.efetivas} conversas efetivas</span>
                </div>
              </div>
            );
          })}
          {!sdrs.length && <p className="card text-sm text-mute">Nenhum SDR cadastrado ainda. Crie os usuários com papel "vendedor" em Usuários.</p>}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Precisa de atencao */}
        <section className="card">
          <h2 className="mb-1 text-xl font-bold">Precisa de atenção</h2>
          <p className="mb-4 text-sm text-mute">Do período escolhido. Clique para abrir a conversa.</p>
          <div className="space-y-5">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-warn"><MessageCircleWarning size={16} />Lead respondeu e está sem retorno ({semRetorno.length})</div>
              {semRetorno.slice(0, 8).map((c) => (
                <Link key={c.conversa_id} href={`/conversas/${c.conversa_id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 text-sm hover:bg-track">
                  <Bolinha id={c.vendedor_id} /><span className="w-28 shrink-0 truncate font-semibold">{c.contato_nome || telefone(c.contato)}</span>
                  <span className="min-w-0 flex-1 truncate text-mute">“{c.texto}”</span>
                  <span className="shrink-0 text-warn">há {tempo(minutosDesde(c.ultima_msg_em))}</span>
                </Link>
              ))}
              {!semRetorno.length && <p className="px-2 text-sm text-mute">Nenhuma. Todo lead que respondeu teve retorno.</p>}
            </div>
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-bad"><ThumbsDown size={16} />Conversas com nota ruim ({notaRuim.length})</div>
              {notaRuim.slice(0, 6).map((a) => (
                <Link key={a.id} href={`/conversas/${a.conversa_id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 text-sm hover:bg-track">
                  <Bolinha id={a.vendedor_id} /><span className="w-28 shrink-0 truncate font-semibold">{contato(um<any>(a.conversas))}</span>
                  <span className="min-w-0 flex-1 truncate text-mute">{a.resumo}</span><b className={`shrink-0 ${corNota(a.nota_geral)}`}>{nota(a.nota_geral)}</b>
                </Link>
              ))}
              {!notaRuim.length && <p className="px-2 text-sm text-mute">Nenhuma conversa ruim no período.</p>}
            </div>
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-brand"><Clock size={16} />Conversa boa, mas sem agendamento ({semAgendar.length})</div>
              {semAgendar.slice(0, 6).map((a) => (
                <Link key={a.id} href={`/conversas/${a.conversa_id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 text-sm hover:bg-track">
                  <Bolinha id={a.vendedor_id} /><span className="w-28 shrink-0 truncate font-semibold">{contato(um<any>(a.conversas))}</span>
                  <span className="min-w-0 flex-1 truncate text-mute">{a.resumo}</span><b className={`shrink-0 ${corNota(a.nota_geral)}`}>{nota(a.nota_geral)}</b>
                </Link>
              ))}
              {!semAgendar.length && <p className="px-2 text-sm text-mute">Nenhuma. As conversas efetivas viraram agendamento.</p>}
            </div>
          </div>
        </section>

        {/* Atividade ao vivo */}
        <section className="card">
          <h2 className="mb-1 text-xl font-bold">Atividade ao vivo</h2>
          <p className="mb-4 text-sm text-mute">Agora, independente do período.</p>
          <div className="mb-5 grid gap-2 sm:grid-cols-2">
            {sdrs.map((s) => {
              const sit = situacao(s.id); const a = ativ.get(s.id);
              return (
                <div key={s.id} className="rounded-2xl border border-line bg-bg/40 p-3 text-sm">
                  <div className="flex items-center gap-2"><Bolinha id={s.id} /><b>{s.nome}</b></div>
                  <div className={`mt-1 flex items-center gap-1 ${sit.cls}`}><sit.Icone size={14} />{sit.txt}</div>
                  <div className="mt-1 text-xs text-mute">
                    {a?.ultima_msg_em ? `Última mensagem às ${fmtHora(a.ultima_msg_em)}` : "Nenhuma mensagem"} · {Number(a?.conversas_hoje ?? 0)} conversas hoje
                    {a?.ultima_ligacao_em && <> · ligação às {fmtHora(a.ultima_ligacao_em)}</>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="label mb-2">Últimas mensagens</div>
          <div className="space-y-0.5">
            {feed.map((m) => {
              const c = um<{ contato: string; contato_nome: string | null }>(m.conversas); const enviou = m.remetente === "vendedor";
              const txt = m.tipo === "audio" ? `🎙 ${m.transcricao || "áudio"}` : m.texto || `[${m.tipo}]`;
              return (
                <Link key={m.id} href={`/conversas/${m.conversa_id}`} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm hover:bg-track">
                  <span className="w-11 shrink-0 text-xs tabular-nums text-mute">{fmtHora(m.enviada_em)}</span>
                  <Bolinha id={m.vendedor_id} />
                  {enviou ? <ArrowUpRight size={15} className="shrink-0 text-brand" aria-label="enviou" /> : <ArrowDownLeft size={15} className="shrink-0 text-warn" aria-label="recebeu" />}
                  <span className="w-28 shrink-0 truncate"><span className="text-mute">{enviou ? `${nomes.get(m.vendedor_id) ?? ""} → ` : ""}</span>{contato(c)}</span>
                  <span className="min-w-0 flex-1 truncate text-mute">{txt}</span>
                </Link>
              );
            })}
            {!feed.length && <p className="px-2 text-sm text-mute">Ainda não chegou nenhuma mensagem. Conecte o WhatsApp dos SDRs na tela WhatsApp.</p>}
          </div>
          <p className="mt-3 flex items-center gap-3 text-xs text-mute"><span className="flex items-center gap-1"><ArrowUpRight size={13} className="text-brand" />SDR enviou</span><span className="flex items-center gap-1"><ArrowDownLeft size={13} className="text-warn" />lead respondeu</span><span className="flex items-center gap-1"><Phone size={12} />ligações entram pela tela Ligações</span></p>
        </section>
      </div>

      {/* Evolucao */}
      <section className="card">
        <h2 className="mb-1 text-xl font-bold">Evolução por dia</h2>
        <p className="mb-4 text-sm text-mute">{periodo.rotulo}. Passe o mouse para ver os valores de cada dia.</p>
        {dias.length < 2 ? <p className="text-sm text-mute">Escolha um período de 2 dias ou mais (7 dias, 30 dias ou datas livres) para ver a evolução.</p>
          : series.length ? <EvolucaoChart dias={dias} series={series} /> : <p className="text-sm text-mute">Sem SDRs para mostrar.</p>}
      </section>

      {/* Tabela por SDR */}
      <section className="card overflow-x-auto">
        <h2 className="mb-3 text-xl font-bold">Resumo por SDR</h2>
        <table className="w-full"><thead><tr><th className="th">SDR</th><th className="th">Contatadas</th><th className="th">Enviadas</th><th className="th">Respostas</th><th className="th">Taxa de resposta</th><th className="th">Ligações</th><th className="th">Auditadas</th><th className="th">Nota</th><th className="th">Agendados</th></tr></thead>
          <tbody>{sdrs.map((s) => {
            const t = porSdr.get(s.id) ?? ZERO;
            return <tr key={s.id}><td className="td"><span className="flex items-center gap-2 font-semibold"><Bolinha id={s.id} />{s.nome}</span></td><td className="td">{t.contatadas}</td><td className="td">{t.enviadas}</td><td className="td">{t.respostas}</td><td className="td">{pct(t.respostas, t.contatadas)}</td><td className="td">{t.ligacoes}</td><td className="td">{t.auditadas}</td><td className={`td font-bold ${corNota(media(t))}`}>{nota(media(t))}</td><td className="td">{t.agendados}</td></tr>;
          })}{!sdrs.length && <tr><td className="td text-mute" colSpan={9}>Sem dados no período.</td></tr>}</tbody></table>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card"><h2 className="mb-3 text-xl font-bold">Gatilhos comerciais usados</h2>
          {nAud ? barras(Object.entries(GATILHOS).map(([k, t]) => [t, gat[k]] as [string, number]), nAud) : <p className="text-sm text-mute">Aparece quando houver conversas auditadas.</p>}
          <p className="mt-2 text-xs text-mute">% das conversas auditadas em que o SDR usou o gatilho.</p></div>
        <div className="card"><h2 className="mb-3 text-xl font-bold">Onde as conversas pararam</h2>
          {nAud ? barras(Object.entries(etapas).sort((a, b) => b[1] - a[1]), nAud) : <p className="text-sm text-mute">Sem dados ainda.</p>}
          <div className="label mb-2 mt-5">Objeções mais comuns</div>
          {topObj.length ? topObj.map(([o, n]) => <div key={o} className="flex justify-between py-0.5 text-sm"><span>{o}</span><span className="text-mute">{n}x</span></div>) : <p className="text-sm text-mute">Nenhuma objeção registrada.</p>}</div>
      </div>

      {gestor && (
        <div className="card">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold">Análise comercial do time {analise && <span className="text-sm font-normal text-mute">· gerada em {new Date(analise.criado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" })}</span>}</h2>
            <form action={pedirAnalise} className="flex gap-2">
              <select name="periodo" defaultValue={periodo.p === "30" ? "30" : "7"} className="input !w-auto !py-1"><option value="7">7 dias</option><option value="30">30 dias</option></select>
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

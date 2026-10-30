"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, ChevronRight, LayoutDashboard, RefreshCw, Search, SkipForward, Table2, UserRound, X } from "lucide-react";
import { GRUPOS, STATUS, bloqueio, grupoDe, ordenar, temperatura, type Grupo, type LeadCloser, type Progresso, type Status } from "@/lib/closer/regras";
import { importarPlanilha, salvarProgresso } from "./actions";
import Ficha, { SeloTemp } from "./Ficha";

type Visao = "painel" | "tabela" | "individual";
const VISOES: { id: Visao; texto: string; icone: typeof Table2 }[] = [
  { id: "painel", texto: "Painel", icone: LayoutDashboard },
  { id: "tabela", texto: "Tabela", icone: Table2 },
  { id: "individual", texto: "Individual", icone: UserRound },
];

const pct = (v: number, t: number) => (t ? Math.round((v / t) * 100) : 0);
const Barra = ({ rotulo, v, total, cor }: { rotulo: string; v: number; total: number; cor?: string }) => (
  <div className="grid grid-cols-[150px_1fr_70px] items-center gap-3 py-1 text-sm">
    <span className="truncate">{rotulo}</span>
    <div className="h-2.5 overflow-hidden rounded-full bg-track"><div className="h-full rounded-full bg-brand" style={{ width: `${pct(v, total)}%`, background: cor }} /></div>
    <span className="text-right tabular-nums text-mute"><b className="text-ink">{v}</b> · {pct(v, total)}%</span>
  </div>
);

export default function PainelCloser({ leads: iniciais, erro, podeImportar, local }: { leads: LeadCloser[]; erro: string | null; podeImportar: boolean; local: boolean }) {
  const router = useRouter();
  const [leads, setLeads] = useState(iniciais);
  const [visao, setVisao] = useState<Visao>("painel");
  const [aberto, setAberto] = useState<string | null>(null);
  const [erroSalvar, setErroSalvar] = useState("");
  const [importando, iniciarImportacao] = useTransition();
  const [avisoImportar, setAvisoImportar] = useState("");

  useEffect(() => { setLeads(iniciais); }, [iniciais]);
  useEffect(() => { try { const v = localStorage.getItem("closer-visao") as Visao | null; if (v && VISOES.some((x) => x.id === v)) setVisao(v); } catch {} }, []);
  const trocar = (v: Visao) => { setVisao(v); try { localStorage.setItem("closer-visao", v); } catch {} };

  // A tela muda na hora; se o banco recusar, volta como estava e avisa
  const salvar = (chave: string, p: Progresso) => {
    const antes = leads.find((l) => l.chave === chave)?.progresso;
    setLeads((ls) => ls.map((l) => (l.chave === chave ? { ...l, progresso: p } : l)));
    salvarProgresso(chave, p).then((e) => {
      if (e && antes) { setLeads((ls) => ls.map((l) => (l.chave === chave ? { ...l, progresso: antes } : l))); setErroSalvar(`Não foi possível salvar: ${e}`); }
      else setErroSalvar("");
    }).catch(() => { if (antes) setLeads((ls) => ls.map((l) => (l.chave === chave ? { ...l, progresso: antes } : l))); setErroSalvar("Não foi possível salvar. Confira a internet."); });
  };
  const importar = () => iniciarImportacao(async () => {
    const r = await importarPlanilha();
    setAvisoImportar(r.erro ? r.erro : `${r.total} leads atualizados. O progresso do time foi mantido.`);
    if (!r.erro) router.refresh();
  });

  const leadAberto = leads.find((l) => l.chave === aberto) ?? null;
  const tabela = erro && /closer_leads|schema cache|does not exist/i.test(erro);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="page-title">Closer</h1><p className="page-sub">Quem abordar, o que essa pessoa contou e a mensagem pronta para enviar.</p></div>
        <div role="tablist" aria-label="Visualização" className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-card p-1">
          {VISOES.map(({ id, texto, icone: Icone }) => (
            <button key={id} role="tab" aria-selected={visao === id} onClick={() => trocar(id)} className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition ${visao === id ? "bg-brand text-bg" : "text-mute hover:text-ink"}`}><Icone size={15} />{texto}</button>
          ))}
        </div>
      </div>

      {local && <p className="aviso !rounded-2xl !p-3">Prévia no seu computador: os dados são uma cópia da planilha e o que você marcar aqui fica só neste computador.</p>}
      {erroSalvar && <p role="alert" className="rounded-2xl border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{erroSalvar}</p>}
      {avisoImportar && <p className="rounded-2xl border border-line bg-card p-3 text-sm">{avisoImportar}</p>}

      {erro ? (
        <div className="card"><h2 className="text-xl font-bold">{tabela ? "O painel ainda não foi ativado" : "Não foi possível carregar os leads"}</h2><p className="mt-1 text-sm text-mute">{tabela ? "Falta rodar o arquivo supabase/painel_closer.sql no Supabase." : erro}</p></div>
      ) : !leads.length ? (
        <div className="card"><h2 className="text-xl font-bold">Nenhum lead ainda</h2><p className="mt-1 text-sm text-mute">{podeImportar ? "Traga os leads da planilha para começar." : "Peça a um gestor para trazer os leads da planilha."}</p></div>
      ) : visao === "painel" ? <VisaoPainel leads={leads} abrir={setAberto} />
        : visao === "tabela" ? <VisaoTabela leads={leads} abrir={setAberto} salvar={salvar} />
        : <VisaoIndividual leads={leads} salvar={salvar} />}

      {podeImportar && !erro && !local && <div className="flex justify-end"><button className="btn-ghost" disabled={importando} onClick={importar}><RefreshCw size={15} className={importando ? "animate-spin" : ""} />{importando ? "Atualizando..." : "Atualizar da planilha"}</button></div>}

      {leadAberto && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/60" onClick={() => setAberto(null)}>
          <aside role="dialog" aria-modal="true" aria-label={`Ficha de ${leadAberto.nome}`} className="relative h-full w-full max-w-2xl overflow-y-auto border-l border-line bg-card p-5 md:p-7" onClick={(e) => e.stopPropagation()}>
            <button aria-label="Fechar" className="absolute right-4 top-4 rounded-lg p-1.5 text-mute hover:bg-track hover:text-ink" onClick={() => setAberto(null)}><X size={20} /></button>
            <Ficha lead={leadAberto} aoSalvar={salvar} />
          </aside>
        </div>
      )}
    </div>
  );
}

// ---------- 1. Painel: numeros do dia, no estilo da primeira tela do sistema ----------
function VisaoPainel({ leads, abrir }: { leads: LeadCloser[]; abrir: (c: string) => void }) {
  const por = useMemo(() => { const m = {} as Record<Grupo, LeadCloser[]>; for (const g of GRUPOS) m[g.id] = []; for (const l of leads) m[grupoDe(l)].push(l); return m; }, [leads]);
  const fila = useMemo(() => [...por.abordar].sort(ordenar), [por]);
  const quentes = fila.filter((l) => temperatura(l).nivel === "quente").length;
  const abordados = leads.filter((l) => l.progresso.enviadas > 0).length;
  const responderam = leads.filter((l) => ["respondeu", "negociando", "fechou_plataforma", "fechou_imersao"].includes(l.progresso.status)).length;
  const plat = leads.filter((l) => l.progresso.status === "fechou_plataforma").length, imer = leads.filter((l) => l.progresso.status === "fechou_imersao").length;
  const areas = useMemo(() => { const m: Record<string, number> = {}; for (const l of fila) if (l.area) m[l.area] = (m[l.area] || 0) + 1; return Object.entries(m).sort((a, b) => b[1] - a[1]); }, [fila]);
  const semTel = por.conferir.filter((l) => !l.telefone && !l.trava), travas = por.conferir.filter((l) => l.trava), suporte = por.conferir.filter((l) => l.telefone && !l.trava);
  const multi = fila.filter((l) => l.conversasCrm.length > 1);
  const kpi = (t: string, v: number | string, sub: string, cls = "") => <div className="card"><div className="label">{t}</div><div className={`mt-2 text-4xl font-bold tabular-nums ${cls}`}>{v}</div><div className="mt-1 text-xs text-mute">{sub}</div></div>;
  const Linha = ({ l, extra }: { l: LeadCloser; extra?: string }) => (
    <button onClick={() => abrir(l.chave)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm hover:bg-track">
      <span className="w-40 shrink-0 truncate font-semibold">{l.nome}</span>
      <span className="min-w-0 flex-1 truncate text-mute">{extra ?? (l.dor || l.empresa)}</span>
      <SeloTemp l={l} />
    </button>
  );
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {kpi("A abordar", por.abordar.length, `${quentes} quente${quentes === 1 ? "" : "s"} na fila`)}
        {kpi("Abordados", abordados, `${pct(abordados, leads.length)}% dos ${leads.length} leads`)}
        {kpi("Responderam", responderam, abordados ? `${pct(responderam, abordados)}% dos abordados` : "aparece depois da primeira abordagem")}
        {kpi("Em negociação", por.negociacao.length, "receberam as 3 mensagens ou estão fechando")}
        {kpi("Fechados", por.fechados.length, `${plat} Plataforma · ${imer} Imersão`, por.fechados.length ? "text-ok" : "")}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="card"><h2 className="mb-1 text-xl font-bold">Próximos a abordar</h2><p className="mb-3 text-sm text-mute">Primeiro quem tem interesse declarado, depois as melhores notas. Clique para abrir o roteiro.</p>
          {fila.slice(0, 10).map((l) => <Linha key={l.chave} l={l} />)}{!fila.length && <p className="text-sm text-mute">A fila terminou.</p>}</section>
        <section className="card"><h2 className="mb-1 text-xl font-bold">Precisa de atenção</h2><p className="mb-3 text-sm text-mute">Antes de escrever, confira estes casos.</p>
          <div className="space-y-4">
            <div><div className="mb-1 flex items-center gap-2 text-sm font-semibold text-warn"><AlertTriangle size={15} />Já atendidos por mais de um número da Weevo ({multi.length})</div>{multi.slice(0, 3).map((l) => <Linha key={l.chave} l={l} extra={l.conversasCrm[0]} />)}</div>
            <div><div className="mb-1 flex items-center gap-2 text-sm font-semibold text-bad"><AlertTriangle size={15} />Marcados na planilha para não enviar ou conferir ({travas.length})</div>{travas.slice(0, 3).map((l) => <Linha key={l.chave} l={l} extra={l.trava} />)}</div>
            <div><div className="mb-1 flex items-center gap-2 text-sm font-semibold text-mute"><AlertTriangle size={15} />Em Suporte/Pós-vendas no CRM ({suporte.length})</div>{suporte.slice(0, 2).map((l) => <Linha key={l.chave} l={l} extra={bloqueio(l)} />)}</div>
            <p className="text-sm text-mute"><b className="text-ink">{semTel.length}</b> participantes estão sem telefone na planilha e não dá para abordar até alguém completar.</p>
          </div></section>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card"><h2 className="mb-3 text-xl font-bold">Onde estão os leads</h2>{GRUPOS.map((g) => <Barra key={g.id} rotulo={g.titulo} v={por[g.id].length} total={leads.length} cor={g.cor} />)}</section>
        <section className="card"><h2 className="mb-1 text-xl font-bold">Dores da fila</h2><p className="mb-3 text-sm text-mute">O que mais aparece em quem ainda será abordado.</p>{areas.map(([a, v]) => <Barra key={a} rotulo={a} v={v} total={fila.length} />)}{!areas.length && <p className="text-sm text-mute">Sem dores registradas na fila.</p>}</section>
      </div>
    </div>
  );
}

// ---------- 2. Tabela: grupos coloridos, com a situacao mudando ali mesmo ----------
function VisaoTabela({ leads, abrir, salvar }: { leads: LeadCloser[]; abrir: (c: string) => void; salvar: (c: string, p: Progresso) => void }) {
  const [busca, setBusca] = useState("");
  const [temp, setTemp] = useState("");
  const [area, setArea] = useState("");
  const [fechados, setFechados] = useState<Set<Grupo>>(new Set(["fora"]));
  const [limite, setLimite] = useState<Partial<Record<Grupo, number>>>({});
  const areas = useMemo(() => [...new Set(leads.map((l) => l.area).filter(Boolean))].sort(), [leads]);
  const q = busca.trim().toLowerCase();
  const vis = useMemo(() => leads.filter((l) => (!q || `${l.nome} ${l.empresa} ${l.telefoneTexto}`.toLowerCase().includes(q)) && (!temp || temperatura(l).nivel === temp) && (!area || l.area === area)).sort(ordenar), [leads, q, temp, area]);
  const alternar = (g: Grupo) => setFechados((s) => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n; });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" /><input aria-label="Buscar lead" className="input !pl-9" placeholder="Buscar por nome, empresa ou telefone" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
        <select aria-label="Temperatura" className="input !w-auto" value={temp} onChange={(e) => setTemp(e.target.value)}><option value="">Toda temperatura</option><option value="quente">Quente</option><option value="morno">Morno</option><option value="frio">Frio</option></select>
        <select aria-label="Área da dor" className="input !w-auto" value={area} onChange={(e) => setArea(e.target.value)}><option value="">Toda dor</option>{areas.map((a) => <option key={a}>{a}</option>)}</select>
      </div>
      {GRUPOS.map((g) => {
        const lista = vis.filter((l) => grupoDe(l) === g.id), fechado = fechados.has(g.id) && !q, max = limite[g.id] ?? 25;
        if (!lista.length) return null;
        return (
          <section key={g.id}>
            <button onClick={() => alternar(g.id)} aria-expanded={!fechado} className="mb-2 flex items-center gap-2 text-left text-xl font-bold" style={{ color: g.cor }}>{fechado ? <ChevronRight size={20} /> : <ChevronDown size={20} />}{g.titulo}<span className="text-sm font-normal text-mute">{lista.length} lead{lista.length > 1 ? "s" : ""}</span></button>
            {!fechado && <div className="overflow-x-auto rounded-2xl border border-line bg-card" style={{ borderLeft: `6px solid ${g.cor}` }}>
              <table className="w-full min-w-[820px]"><thead><tr><th className="th">Lead</th><th className="th">Temperatura</th><th className="th">Situação</th><th className="th">Nota</th><th className="th">Dor</th><th className="th">Etapa no CRM</th><th className="th">Telefone</th></tr></thead>
                <tbody>{lista.slice(0, max).map((l) => (
                  <tr key={l.chave} onClick={() => abrir(l.chave)} className="cursor-pointer transition hover:bg-track">
                    <td className="td max-w-[210px]"><div className="truncate font-semibold">{l.nome}</div><div className="truncate text-xs text-mute">{l.empresa}</div></td>
                    <td className="td"><SeloTemp l={l} /></td>
                    <td className="p-0 align-middle" onClick={(e) => e.stopPropagation()}>
                      <select aria-label={`Situação de ${l.nome}`} value={l.progresso.status} onChange={(e) => salvar(l.chave, { ...l.progresso, status: e.target.value as Status })} className="h-full min-h-[52px] w-full min-w-[130px] cursor-pointer appearance-none border-x border-bg/30 px-2 text-center text-sm font-semibold text-white outline-none" style={{ background: STATUS[l.progresso.status].cor }}>
                        {Object.entries(STATUS).map(([k, s]) => <option key={k} value={k} className="bg-card text-ink">{s.texto}</option>)}
                      </select>
                    </td>
                    <td className="td tabular-nums">{l.nota ?? "—"}</td>
                    <td className="td max-w-[200px]"><div className="truncate">{l.area || "—"}</div></td>
                    <td className="td whitespace-nowrap text-mute">{l.etapa || "—"}</td>
                    <td className="td whitespace-nowrap">{l.telefoneTexto || <span className="text-warn">Sem telefone</span>}</td>
                  </tr>
                ))}</tbody></table>
              {lista.length > max && <button className="w-full border-t border-line py-2.5 text-sm font-semibold text-brand hover:bg-track" onClick={() => setLimite((x) => ({ ...x, [g.id]: max + 50 }))}>Ver mais {Math.min(50, lista.length - max)} de {lista.length - max} restantes</button>}
            </div>}
          </section>
        );
      })}
      {!vis.length && <p className="card text-sm text-mute">Nenhum lead com esse filtro.</p>}
    </div>
  );
}

// ---------- 3. Individual: um lead por vez, com o passo a passo ----------
function VisaoIndividual({ leads, salvar }: { leads: LeadCloser[]; salvar: (c: string, p: Progresso) => void }) {
  const [so, setSo] = useState<"" | "quente">("");
  const [pulados, setPulados] = useState<string[]>([]);
  const fila = useMemo(() => {
    // quem ja esta em conversa vem primeiro, para nao esfriar; depois quem falta abordar
    const peso: Partial<Record<Grupo, number>> = { negociacao: 0, conversa: 1, abordar: 2 };
    return leads.filter((l) => peso[grupoDe(l)] != null && (!so || temperatura(l).nivel === so)).sort((a, b) => peso[grupoDe(a)]! - peso[grupoDe(b)]! || ordenar(a, b));
  }, [leads, so]);
  const [atual, setAtual] = useState<string | null>(null);
  const restantes = fila.filter((l) => !pulados.includes(l.chave));
  const lead = fila.find((l) => l.chave === atual) ?? leads.find((l) => l.chave === atual && grupoDe(l) !== "conferir") ?? restantes[0] ?? null;
  const proximo = () => {
    const nova = restantes.filter((l) => l.chave !== lead?.chave);
    setAtual(nova[0]?.chave ?? null);
  };
  const pular = () => {
    if (lead) setPulados((p) => [...p, lead.chave]);
    proximo();
  };
  const feitos = leads.filter((l) => ["fechados", "fora"].includes(grupoDe(l))).length;
  const total = feitos + fila.length;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="card !p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm"><b className="text-lg tabular-nums">{restantes.length}</b> <span className="text-mute">leads na fila · {feitos} já concluídos</span></div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-mute"><input type="checkbox" checked={so === "quente"} onChange={(e) => { setSo(e.target.checked ? "quente" : ""); setAtual(null); }} />Só quentes</label>
            {!!pulados.length && <button className="btn-ghost !py-1" onClick={() => setPulados([])}>Voltar {pulados.length} pulado{pulados.length > 1 ? "s" : ""}</button>}
            {lead && <button className="btn-ghost !py-1" onClick={pular}><SkipForward size={15} />Pular</button>}
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-track"><div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct(feitos, total)}%` }} /></div>
      </div>
      {lead ? <div className="card md:p-7"><Ficha lead={lead} aoSalvar={salvar} aoConcluir={proximo} /></div>
        : <p className="card text-sm text-mute">{pulados.length ? "Você pulou os leads restantes. Use o botão acima para vê-los de novo." : "A fila terminou. Nenhum lead para abordar agora."}</p>}
    </div>
  );
}

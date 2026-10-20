import Link from "next/link";
import { Suspense } from "react";
import AbasPainel from "@/components/AbasPainel";
import AutoRefresh from "@/components/AutoRefresh";
import { corNota, duracao, nota } from "@/lib/format";
import { corSdr, diasUteis } from "@/lib/metas";
import { diasEntre, type Periodo } from "@/lib/periodo";
import BarraMeta from "@/components/BarraMeta";
import Carrossel from "./Carrossel";
import Controles from "./Controles";


// Tela de TV (16:9, sem rolagem) no molde do painel comercial de referencia, nas cores Weevo. Grade 2x2.
// Metas diarias por SDR vem de Configuracoes (padrao: 25 conversas trocadas e 6 marcacoes).
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
// vendas com dinheiro (workshop pago e imersao) e convites (cupom 100% ou membro Carbone, R$ 0, nao e dinheiro)
export type Vendas = { wPagos: number; wValor: number; imersoes: number; imValor: number; convites: number; carbone?: number };
// workshop por vendedor: confirmacoes por convite (cupom R$ 0) e vendas com dinheiro (pagas)
export type WorkshopPor = Record<string, { convites: number; pagos: number; valor: number }>;

export type Linha = { dia: string; vendedor_id: string; contatadas: number; enviadas: number; respostas: number; ligacoes: number; ligacoes_atendidas: number; ligacoes_seg: number; auditadas: number; nota_soma: number; efetivas: number; marcacoes: number; workshop: number; imersao: number };
type Tot = Omit<Linha, "dia" | "vendedor_id">;
const ZERO: Tot = { contatadas: 0, enviadas: 0, respostas: 0, ligacoes: 0, ligacoes_atendidas: 0, ligacoes_seg: 0, auditadas: 0, nota_soma: 0, efetivas: 0, marcacoes: 0, workshop: 0, imersao: 0 };
const somar = (l: Linha[]): Tot => l.reduce((t, x) => { const o = { ...t }; for (const k of Object.keys(ZERO) as (keyof Tot)[]) o[k] = Number(o[k]) + Number(x[k] || 0); return o; }, { ...ZERO });
const contatos = (t: Tot) => Number(t.contatadas) + Number(t.ligacoes);
const media = (t: Tot) => (t.auditadas ? t.nota_soma / t.auditadas : null);
const fmtPct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const ddmm = (d: string) => d.slice(8, 10) + "/" + d.slice(5, 7);
const util = (d: string) => { const w = new Date(d + "T12:00:00Z").getUTCDay(); return w !== 0 && w !== 6; };

// Estado frente a meta: verde bateu, ambar perto (75%+), vermelho abaixo. Sempre com texto, nunca so cor.
type Est = "good" | "warn" | "crit" | "none";
const estado = (real: number, alvo: number | null): Est => (!alvo ? "none" : real / alvo >= 1 ? "good" : real / alvo >= 0.75 ? "warn" : "crit");
const PILL: Record<Est, string> = { good: "bg-ok/15 text-ok", warn: "bg-warn/15 text-warn", crit: "bg-bad/15 text-bad", none: "bg-track text-mute" };
const BARRA: Record<Est, string> = { good: "bg-ok", warn: "bg-warn", crit: "bg-bad", none: "bg-side-edge" };
function Pill({ e, children }: { e: Est; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-[0.4em] whitespace-nowrap rounded-full px-[0.65em] py-[0.15em] text-[0.8em] font-semibold ${PILL[e]}`}><span className="h-[0.5em] w-[0.5em] rounded-full bg-current" />{children}</span>;
}
function Painel({ titulo, nota: sub, children, className = "" }: { titulo: string; nota?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[14px] border border-line bg-card px-[0.95em] py-[0.8em] ${className}`}>
      <h2 className="mb-[0.7em] flex items-baseline justify-between gap-2 whitespace-nowrap text-[0.68em] font-semibold uppercase tracking-[0.26em] text-brand">
        {titulo}{sub && <small className="truncate text-[1.15em] font-normal normal-case tracking-normal text-mute">{sub}</small>}
      </h2>
      {children}
    </section>
  );
}

// equipe = so quem tem WhatsApp cadastrado na aba WhatsApp (tirou o WhatsApp, sai do time)
export type DadosTela = { periodo: Periodo; hoje: string; atualizadoEm: string; perfis: { id: string; nome: string; papel: string; ativo: boolean; funcao?: string | null; foto_url?: string | null }[]; linhas: Linha[]; equipe: string[]; metas: { conversas: number; marcacoes: number }; vendas: Vendas; workshopPor: WorkshopPor };

// Desenho da tela, separado da busca de dados (permite previa com dados de exemplo)
export function Tela({ periodo, hoje, atualizadoEm, perfis, linhas, equipe, metas, vendas, workshopPor }: DadosTela) {
  const { de, ate } = periodo;
  const META_CONVERSAS = metas.conversas, META_MARCACOES = metas.marcacoes;
  // Tela dos SDRs: so quem e SDR (Closer fica fora, as metas daqui sao de conversas e marcacoes)
  // Apresentacao do time todo (SDR e Closer); so o Funil por SDR mostra apenas SDRs
  const sdrs = perfis.filter((p) => p.ativo && equipe.includes(p.id));
  const sdrsFunil = sdrs.filter((p) => p.funcao !== "closer");
  const cor = new Map(sdrs.map((s, i) => [s.id, corSdr(i)]));
  const porSdr = new Map(sdrs.map((s) => [s.id, somar(linhas.filter((l) => l.vendedor_id === s.id))]));
  const time = somar(linhas.filter((l) => cor.has(l.vendedor_id)));
  const uteis = diasUteis(de, ate);
  const nSdr = Math.max(sdrs.length, 1);
  const metaConversas = META_CONVERSAS * uteis, metaMarc = META_MARCACOES * uteis;
  const dias = diasEntre(de, ate);
  // foto da pessoa (Configuracoes > Equipe) com contorno na cor dela; sem foto, a bolinha de cor
  const foto = new Map(sdrs.map((p) => [p.id, p.foto_url ?? null]));
  const Bola = ({ id, tam = "1.5em" }: { id: string; tam?: string }) => foto.get(id)
    ? <img src={foto.get(id)!} alt="" className="shrink-0 rounded-full object-cover" style={{ width: tam, height: tam, boxShadow: `0 0 0 2px ${cor.get(id) ?? "#9ba5a4"}` }} />
    : <span className="inline-block h-[0.6em] w-[0.6em] shrink-0 rounded-full" style={{ background: cor.get(id) ?? "#9ba5a4" }} />;

  // ---- marcacoes acumuladas x meta (time) ----
  const metaDia = (d: string) => (util(d) ? META_MARCACOES * nSdr : 0);
  let acR = 0, acM = 0;
  const serie = dias.map((d) => {
    const l = linhas.filter((x) => x.dia === d && cor.has(x.vendedor_id));
    acR += l.reduce((n, x) => n + Number(x.marcacoes), 0); acM += metaDia(d);
    return { d, real: acR, meta: acM };
  });
  const W = 640, H = 220, pad = { l: 34, r: 92, t: 12, b: 24 };
  const topo = Math.max(4, ...serie.map((s) => Math.max(s.real, s.meta))) * 1.08;
  const x = (i: number) => pad.l + (dias.length > 1 ? (i * (W - pad.l - pad.r)) / (dias.length - 1) : (W - pad.l - pad.r) / 2);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / topo);
  const linhaPath = (k: "real" | "meta") => serie.map((s, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(s[k]).toFixed(1)}`).join("");
  const passoX = Math.max(1, Math.ceil(dias.length / 7));
  const ultimo = serie[serie.length - 1] ?? { real: 0, meta: 0 };
  const passos = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(topo * f));

  const kpi = (l: string, v: React.ReactNode, m: React.ReactNode) => (
    <div className="min-w-0 rounded-[14px] border border-line bg-card px-[1.05em] py-[0.75em]">
      <div className="whitespace-nowrap text-[0.68em] font-semibold uppercase tracking-[0.26em] text-brand">{l}</div>
      <div className="mt-[0.15em] whitespace-nowrap text-[1.75em] font-extrabold leading-tight tracking-[-0.035em] tabular-nums">{v}</div>
      <div className="truncate text-[0.8em] text-mute">{m}</div>
    </div>
  );
  const eMarc = estado(time.marcacoes, metaMarc * nSdr);

  // quadros da grade 2x2 (tambem usados um a um no modo slides)
  const pMarc = (
        <Painel titulo="Marcações acumuladas x meta" nota={`${META_MARCACOES} por dia útil por SDR`}>
          <div className="mb-[0.3em] flex flex-wrap gap-[1.2em] text-[0.8em] text-mute">
            <span className="flex items-center gap-[0.45em]"><i className="inline-block w-[1.3em] border-t-[2.5px] border-brand" />Realizado</span>
            <span className="flex items-center gap-[0.45em]"><i className="inline-block w-[1.3em] border-t-2 border-dashed border-mute" />Meta</span>
          </div>
          <div className="relative min-h-[150px] flex-1">
            {dias.length < 2 ? (
              <div className="flex h-full flex-col justify-center gap-2">
                <div className="text-[2.2em] font-extrabold tabular-nums">{time.marcacoes} <span className="text-[0.5em] font-normal text-mute">de {metaMarc * nSdr} hoje</span></div>
                <div className="h-3 overflow-hidden rounded-full bg-track"><div className={`h-full rounded-full ${BARRA[eMarc]}`} style={{ width: `${Math.min(100, (time.marcacoes / Math.max(1, metaMarc * nSdr)) * 100)}%` }} /></div>
                <p className="text-[0.8em] text-mute">Escolha a semana ou o mês para ver a evolução.</p>
              </div>
            ) : (
              <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" role="img" aria-label={`Marcações acumuladas: ${ultimo.real} de ${ultimo.meta} da meta`}>
                {passos.map((v) => <g key={v}><line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="#2b3433" strokeDasharray={v ? "2 4" : undefined} /><text x={pad.l - 6} y={y(v)} dy="0.32em" textAnchor="end" fontSize={10} fill="#9ba5a4">{v}</text></g>)}
                {dias.map((d, i) => (i % passoX === 0 || i === dias.length - 1) && <text key={d} x={x(i)} y={H - 6} textAnchor="middle" fontSize={10} fill="#9ba5a4">{ddmm(d)}</text>)}
                <path d={linhaPath("meta")} fill="none" stroke="#9ba5a4" strokeWidth={2} strokeDasharray="5 5" />
                <path d={linhaPath("real")} fill="none" stroke="#6dcfc0" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                {serie.map((s, i) => <circle key={s.d} cx={x(i)} cy={y(s.real)} r={dias.length <= 31 ? 3.5 : 0} fill="#6dcfc0" stroke="#151b1e" strokeWidth={2}><title>{`${ddmm(s.d)}: ${s.real} marcações (meta ${s.meta})`}</title></circle>)}
                <text x={x(dias.length - 1) + 8} y={y(ultimo.real)} dy="0.32em" fontSize={12} fontWeight={700} fill="#f0faf7">{ultimo.real} feitas</text>
                <text x={x(dias.length - 1) + 8} y={y(ultimo.meta) + (Math.abs(y(ultimo.meta) - y(ultimo.real)) < 14 ? 14 : 0)} dy="0.32em" fontSize={11} fill="#9ba5a4">meta {ultimo.meta}</text>
              </svg>
            )}
          </div>
          <div className="mt-[0.4em] flex flex-wrap gap-x-[1.2em] gap-y-1 border-t border-line pt-[0.45em] text-[0.82em]">
            {sdrs.map((s) => { const t = porSdr.get(s.id) ?? ZERO; return <span key={s.id} className="flex items-center gap-[0.4em] whitespace-nowrap"><Bola id={s.id} tam="1.3em" /><b>{s.nome}</b> {t.marcacoes} <span className="text-mute">({t.workshop} workshop · {t.imersao} reunião de impl.)</span></span>; })}
          </div>
        </Painel>
  );
  const tituloMetas = de === ate ? "Metas do dia" : "Metas do período";
  const pConv = (
        <Painel titulo={tituloMetas} nota={`${META_CONVERSAS} conversas trocadas e ${META_MARCACOES} marcações por dia útil${uteis > 1 ? ` · ${uteis} dias úteis` : ""}`}>
          <div className="flex min-h-0 flex-1 flex-col justify-around gap-[0.9em] overflow-auto">
            {sdrs.map((s) => {
              const t = porSdr.get(s.id) ?? ZERO;
              const barra = (rot: string, feito: number, alvo: number) => (
                <div className="min-w-0">
                  <div className="mb-[0.3em] flex items-baseline justify-between text-[0.85em] text-mute"><span>{rot}</span><span className="tabular-nums"><b className="text-[1.25em] text-ink">{feito}</b> / {alvo}</span></div>
                  <BarraMeta feito={feito} alvo={alvo} grande />
                </div>
              );
              return (
                <div key={s.id}>
                  <div className="mb-[0.35em] flex items-center gap-[0.45em] text-[1.1em] font-bold"><Bola id={s.id} tam="1.8em" />{s.nome}</div>
                  <div className="grid grid-cols-2 gap-[1.2em]">
                    {barra("Conversas trocadas", Number(t.respostas), metaConversas)}
                    {barra("Marcações", Number(t.marcacoes), metaMarc)}
                  </div>
                </div>
              );
            })}
            {!sdrs.length && <p className="text-[0.85em] text-mute">Nenhum vendedor ainda. Cadastre na aba WhatsApp (nome, função e conexão).</p>}
          </div>
        </Painel>
  );
  const pFunil = (
        <Painel titulo="Funil por SDR" nota="barra = % da meta · conversão entre etapas">
          {!sdrsFunil.length && <p className="text-[0.85em] text-mute">Nenhum SDR no time ainda. Quem é Closer não entra no funil.</p>}
          <div className="grid min-h-0 flex-1 gap-[1.1em] overflow-auto" style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(sdrsFunil.length, 3))}, minmax(0,1fr))` }}>
            {sdrsFunil.map((s) => {
              const t = porSdr.get(s.id) ?? ZERO; const ct = contatos(t); const w = workshopPor[s.id] ?? { convites: 0, pagos: 0, valor: 0 };
              const etapas: { n: string; v: number; alvo: number | null; base: number; conv?: string }[] = [
                { n: "Contatos", v: ct, alvo: null, base: Math.max(ct, 1) },
                { n: "Conversas trocadas", v: t.respostas, alvo: metaConversas, base: metaConversas, conv: `${fmtPct(t.respostas, t.contatadas)} das conversas` },
                { n: "Efetivas", v: t.efetivas, alvo: null, base: Math.max(t.respostas, 1), conv: `${fmtPct(t.efetivas, t.respostas)} de quem respondeu` },
                { n: "Marcações", v: t.marcacoes, alvo: metaMarc, base: metaMarc, conv: `${fmtPct(t.marcacoes, t.efetivas)} das efetivas` },
                { n: "Confirmações de workshop (convite)", v: w.convites, alvo: null, base: Math.max(t.marcacoes, w.convites, 1), conv: `${fmtPct(w.convites, t.marcacoes)} das marcações · cupom ou Carbone, R$ 0` },
                { n: "Vendas workshop", v: w.pagos, alvo: null, base: Math.max(t.marcacoes, w.pagos, 1), conv: w.pagos ? `${brl(w.valor)} em dinheiro` : "nenhuma paga ainda" },
              ];
              return (
                <div key={s.id} className="flex min-w-0 flex-col justify-between">
                  <h3 className="mb-[0.35em] flex items-center gap-[0.4em] truncate text-[1.25em] font-extrabold tracking-[-0.035em]"><Bola id={s.id} tam="1.6em" />{s.nome}</h3>
                  {etapas.map((e) => { const est = estado(e.v, e.alvo); const larg = Math.min(100, (e.v / Math.max(e.base, 1)) * 100); return (
                    <div key={e.n} className="grid gap-[0.2em] py-[0.25em] tabular-nums">
                      <div className="flex justify-between gap-1.5 text-[0.85em]"><span className="text-side-text/80">{e.n}</span><span><b>{e.v}</b>{e.alvo !== null && <span className="text-mute"> / {e.alvo}</span>}</span></div>
                      <div className="relative h-[0.6em] rounded-full bg-track"><div className={`absolute inset-y-0 left-0 rounded-full ${e.alvo !== null ? BARRA[est] : "bg-side-edge"}`} style={{ width: `${larg}%` }} />
                        {e.alvo !== null && <div className="absolute -bottom-[3px] -top-[3px] right-0 w-[2.5px] rounded bg-brand" title="meta" />}</div>
                      {e.conv && <div className="text-[0.72em] text-mute">{e.conv}</div>}
                    </div>
                  ); })}
                  <div className="mt-[0.3em] flex justify-between gap-1.5 whitespace-nowrap border-t border-line pt-[0.45em] text-[0.85em] tabular-nums">
                    <span>Nota <b className={corNota(media(t))}>{nota(media(t))}</b></span><span className="text-mute">{t.auditadas} auditadas</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Painel>
  );
  const pPessoa = (
        <Painel titulo="Por pessoa" nota="real / meta no período">
          <div className="grid min-h-0 flex-1 auto-rows-fr gap-[0.6em] overflow-auto sm:grid-cols-2">
            {sdrs.map((s) => {
              const t = porSdr.get(s.id) ?? ZERO; const ct = contatos(t); const nm = media(t);
              const linhasP: { n: string; q: string; v: number; alvo: number | null; base: number }[] = [
                { n: "Contatos", q: `${ct}`, v: ct, alvo: null, base: Math.max(ct, 1) },
                { n: "Conversas trocadas", q: `${t.respostas} / ${metaConversas}`, v: t.respostas, alvo: metaConversas, base: metaConversas },
                { n: "Marcações", q: `${t.marcacoes} / ${metaMarc}`, v: t.marcacoes, alvo: metaMarc, base: metaMarc },
                { n: "Nota média", q: nota(nm), v: nm ?? 0, alvo: 7, base: 10 },
              ];
              return (
                <div key={s.id} className="flex min-w-0 flex-col gap-[0.3em] rounded-[10px] border border-line bg-bg/60 px-[0.7em] py-[0.5em]">
                  <h3 className="flex items-center justify-between gap-1.5 text-[1em] font-extrabold tracking-[-0.02em]">
                    <span className="flex items-center gap-[0.4em]"><Bola id={s.id} />{s.nome}</span><small className="text-[0.68em] font-medium uppercase tracking-[0.16em] text-brand">{s.funcao === "closer" ? "Closer" : "SDR"}</small>
                  </h3>
                  <div className="flex flex-1 flex-col justify-around gap-[0.3em]">
                  {linhasP.map((l) => { const est = l.n === "Nota média" ? (nm === null ? "none" : nm >= 7 ? "good" : nm >= 4 ? "warn" : "crit") : estado(l.v, l.alvo); return (
                    <div key={l.n} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-[0.5em] gap-y-[0.1em] text-[0.8em] tabular-nums">
                      <span className="truncate text-side-text/80">{l.n}</span><span className="text-right">{l.q}</span>
                      <div className="col-span-2 h-[0.35em] rounded-full bg-track"><div className={`h-full rounded-full ${BARRA[est as Est]}`} style={{ width: `${Math.min(100, (l.v / Math.max(l.base, 1)) * 100)}%` }} /></div>
                    </div>
                  ); })}
                  </div>
                  <div className="text-[0.72em] text-mute">{t.ligacoes_atendidas} de {t.ligacoes} ligações atendidas{Number(t.ligacoes_seg) ? ` (${duracao(Number(t.ligacoes_seg))})` : ""} · {t.enviadas} mensagens enviadas</div>
                </div>
              );
            })}
          </div>
        </Painel>
  );

  return (
    <div className="flex min-h-screen flex-col gap-[clamp(8px,0.9vh,16px)] bg-bg px-[clamp(16px,1.4vw,32px)] py-[clamp(8px,0.9vh,16px)] text-ink lg:h-screen lg:overflow-hidden"
      style={{ fontSize: "clamp(11px, 0.55vw + 0.55vh, 18px)" }}>
      <AutoRefresh segundos={60} />

      {/* cabecalho */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-[1.1em]">
          <Link href="/" className="flex items-center" title="Voltar ao painel"><img src="/weevo-logo.png" alt="Weevo" className="h-[1.5em] w-auto" /></Link>
          <i className="h-[1.6em] w-px bg-line" />
          <h1 className="whitespace-nowrap text-[0.72em] font-semibold uppercase tracking-[0.3em] text-brand">Cabueta do Elon Musk</h1>
          <Suspense><AbasPainel atual="apresentacao" /></Suspense>
        </div>
        <Controles p={periodo.p} de={de} ate={ate} atualizadoEm={atualizadoEm} />
      </header>

      {/* faixa de numeros */}
      <section className="grid gap-[clamp(8px,0.9vh,16px)] sm:grid-cols-2 lg:grid-cols-[2.5fr_repeat(5,minmax(0,1fr))]">
        {/* vendas em dinheiro: total em destaque, workshop e imersao lado a lado */}
        <div className="relative flex items-stretch gap-[1.1em] overflow-hidden rounded-[14px] border border-brand/40 px-[1.05em] py-[0.7em] sm:col-span-2 lg:col-span-1"
          style={{ background: "radial-gradient(60% 120% at 18% 45%, rgba(109,207,192,.2), transparent 70%), linear-gradient(120deg,#0f3a3a,#07201f)" }}>
          <img src="/weevo-icone.png" alt="" aria-hidden className="pointer-events-none absolute -right-[2%] top-1/2 h-[140%] w-auto -translate-y-1/2 opacity-[0.06]" />
          <div className="relative flex min-w-0 flex-col justify-center">
            <div className="whitespace-nowrap text-[0.68em] font-semibold uppercase tracking-[0.26em] text-brand">Vendas <span className="tracking-[0.1em] text-side-text/60">· {periodo.rotulo}</span></div>
            <div className="whitespace-nowrap text-[2.5em] font-extrabold leading-none tracking-[-0.045em] tabular-nums">{brl(vendas.wValor + vendas.imValor)}</div>
            <div className="mt-[0.2em] whitespace-nowrap text-[0.78em] text-side-text/80">{vendas.wPagos + vendas.imersoes} venda{vendas.wPagos + vendas.imersoes === 1 ? "" : "s"} em dinheiro</div>
          </div>
          <div className="relative ml-auto grid shrink-0 grid-cols-2 gap-[0.5em]">
            {([["Workshop", vendas.wPagos, vendas.wValor, "#e5a85f"], ["Imersão", vendas.imersoes, vendas.imValor, "#9085e9"]] as [string, number, number, string][]).map(([n, q, v, c]) => (
              <div key={n} className="flex min-w-[6.5em] flex-col justify-center rounded-[10px] border border-white/10 bg-black/25 px-[0.75em] py-[0.35em]" style={{ borderTop: `3px solid ${c}` }}>
                <div className="text-[0.62em] font-semibold uppercase tracking-[0.2em]" style={{ color: c }}>{n}</div>
                <div className="text-[1.5em] font-extrabold leading-tight tabular-nums">{q}</div>
                <div className="whitespace-nowrap text-[0.75em] text-side-text/80 tabular-nums">{brl(v)}</div>
              </div>
            ))}
          </div>
        </div>
        {kpi("Convites", vendas.convites, <>{vendas.carbone ? `${vendas.carbone} Carbone · ${vendas.convites - vendas.carbone} cupom · R$ 0` : "cupom 100% ou Carbone · R$ 0"}</>)}
        {kpi("Marcações", <>{time.marcacoes} <span className="text-[0.55em] font-normal text-mute">/ {metaMarc * nSdr}</span></>, <><Pill e={eMarc}>{fmtPct(time.marcacoes, metaMarc * nSdr)}</Pill> {time.workshop} workshop · {time.imersao} reunião de impl.</>)}
        {kpi("Conversas trocadas", <>{time.respostas} <span className="text-[0.55em] font-normal text-mute">/ {metaConversas * nSdr}</span></>, <>{fmtPct(time.respostas, time.contatadas)} das conversas</>)}
        {kpi("Contatos", contatos(time), <>{time.contatadas} msg · {time.ligacoes_atendidas}/{time.ligacoes} lig. atendidas{Number(time.ligacoes_seg) ? ` · ${duracao(Number(time.ligacoes_seg))}` : ""}</>)}
        {kpi("Nota média", <span className={corNota(media(time))}>{nota(media(time))}</span>, <>{time.auditadas} auditadas</>)}
      </section>

      {/* grade 2x2 ou modo slides */}
      <Suspense>
        <Carrossel
          geral={<main className="grid min-h-0 flex-1 gap-[clamp(8px,0.9vh,16px)] lg:grid-cols-[1.35fr_1fr] lg:grid-rows-[minmax(0,1fr)_minmax(0,1.1fr)]">{pMarc}{pConv}{pFunil}{pPessoa}</main>}
          slides={[{ titulo: "Marcações acumuladas", no: pMarc }, { titulo: tituloMetas, no: pConv }, { titulo: "Funil por SDR", no: pFunil }, { titulo: "Por pessoa", no: pPessoa }]}
        />
      </Suspense>
    </div>
  );
}

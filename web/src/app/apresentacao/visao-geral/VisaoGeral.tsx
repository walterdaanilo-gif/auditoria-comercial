"use client";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import AutoRefresh from "@/components/AutoRefresh";
import { duracao } from "@/lib/format";
import { CATALOGO, temItem, tituloDe, type QuadroCfg } from "@/lib/quadrosTv";
import { calcularRitmo, eixoY, inteiro, moeda, tomPorDiferenca, type Kpi, type Pessoa, type Tom, type VisaoGeralDados } from "./calc";

// Tela fixa da TV do comercial (sem rodizio), fundo claro, 1920x1080 escalada para qualquer TV.
// So mostra o que o Cabueta mede. Cores de texto com contraste minimo de 4,5:1 sobre o branco.
const TOM: Record<Tom, { c: string; bg: string; barra: string }> = {
  ok: { c: "#0a7a4b", bg: "#dcf4e7", barra: "#1fa86a" },
  warn: { c: "#8a5a00", bg: "#fdf0cc", barra: "#e0a100" },
  bad: { c: "#b42318", bg: "#fde3e0", barra: "#e5484d" },
  neutro: { c: "#3d5250", bg: "#e6eeed", barra: "#9bb0ad" },
};
const C = { texto: "#10201e", mute: "#4f6462", label: "#0d6b5f", linha: "#d3dddb", trilho: "#e2eae8", real: "#0f9b86" };
const CSS = `
.vg{font-family:'Inter Variable',Inter,system-ui,sans-serif;color:${C.texto}}
.vg *{box-sizing:border-box}
.vg .cd{background:#fff;border:1px solid ${C.linha};border-radius:20px;min-width:0;min-height:0;box-shadow:0 1px 2px rgba(16,32,30,.05)}
.vg .lb{font-weight:700;font-size:16px;letter-spacing:.16em;text-transform:uppercase;color:${C.label}}
.vg .vl{font-weight:800;letter-spacing:-.03em;line-height:1;color:${C.texto}}
.vg .mu{font-weight:500;font-size:18px;color:${C.mute}}
.vg .row{display:flex;align-items:center;gap:12px;min-width:0}
.vg .st{font-weight:700;font-size:16px;border-radius:999px;padding:5px 14px;white-space:nowrap}
.vg .nw{white-space:nowrap}
`;

function Selo({ tom, children }: { tom: Tom; children: ReactNode }) {
  return <span className="st" style={{ color: TOM[tom].c, background: TOM[tom].bg }}>{children}</span>;
}
const Barra = ({ pct, tom }: { pct: number; tom: Tom }) => (
  <div style={{ position: "relative", height: 12, background: C.trilho, borderRadius: 6 }}>
    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, Math.max(0, pct))}%`, borderRadius: 6, background: TOM[tom].barra }} />
  </div>
);
const seloRitmo = (difPts: number): string => (difPts >= 0 ? "no ritmo" : `${Math.round(-difPts)} pts abaixo`);

// ---------------- cabecalho ----------------
function Cabecalho({ d }: { d: VisaoGeralDados }) {
  return (
    <div className="row" style={{ gap: 18, height: 52 }}>
      <Link href="/" title="Voltar ao painel" style={{ display: "flex", background: "#0f3b38", borderRadius: 14, padding: "8px 18px" }}><img src="/weevo-logo.png" alt="Weevo" style={{ height: 30, width: "auto" }} /></Link>
      <span className="lb nw" style={{ color: C.mute }}>Cabueta do Elon Musk</span>
      <span className="mu nw">Atualizado às {d.atualizadoEm}</span>
      <div style={{ flex: 1 }} />
      {d.demo && <span className="st nw" style={{ background: "#e6eeed", color: "#3d5250" }}>EXEMPLO · NÚMEROS FICTÍCIOS</span>}
      <div className="row cd" style={{ borderRadius: 999, padding: "10px 24px", gap: 14 }}>
        <span className="lb nw" style={{ fontSize: 15 }}>Período</span>
        <span className="nw" style={{ fontWeight: 700, fontSize: 21 }}>{d.periodo.rotulo}</span>
        <span className="mu nw">{d.periodo.intervalo} · dia útil {d.periodo.diaUtil} de {d.periodo.diasUteisMes}</span>
      </div>
    </div>
  );
}

// ---------------- faturamento ----------------
function Grafico({ d }: { d: VisaoGeralDados }) {
  const { fat, periodo } = d;
  const N = periodo.diasUteisMes, du = periodo.diaUtil;
  const r = calcularRitmo(fat.real, fat.meta, du, N);
  const eixo = eixoY(Math.max(fat.meta ?? 0, r.projecao ?? 0, fat.real));
  const X = (i: number) => 80 + ((i - 1) / Math.max(N - 1, 1)) * 780;
  const Y = (v: number) => Math.max(14, 480 - (v / eixo.topo) * 440);
  const pts = fat.serie.map((s) => `${X(s.du).toFixed(1)},${Y(s.real).toFixed(1)}`);
  const ult = fat.serie[fat.serie.length - 1];
  const xh = ult ? X(ult.du) : X(1);
  const mil = (v: number) => String(Math.round(v / 1000));
  const rotulos: { x: number; t: string; hoje?: boolean }[] = [];
  if (fat.datasUteis.length) {
    rotulos.push({ x: Math.max(X(1), 96), t: fat.datasUteis[0] });
    if (du >= 9 && fat.datasUteis[5]) rotulos.push({ x: X(6), t: fat.datasUteis[5] });
    rotulos.push({ x: xh, t: "hoje", hoje: true });
    if (du < N - 1) rotulos.push({ x: 840, t: fat.datasUteis[N - 1] ?? "" });
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, minHeight: 0 }}>
      <div className="row" style={{ gap: 16 }}>
        <span className="lb nw" style={{ color: C.mute }}>Acumulado por dia útil</span><div style={{ flex: 1 }} />
        <span className="row" style={{ gap: 8 }}><span style={{ width: 24, height: 5, background: C.real, borderRadius: 3 }} /><span className="mu" style={{ fontSize: 16 }}>Real</span></span>
        <span className="row" style={{ gap: 8 }}><span style={{ width: 24, borderTop: `3px dashed ${C.mute}` }} /><span className="mu" style={{ fontSize: 16 }}>Meta</span></span>
        <span className="row" style={{ gap: 8 }}><span style={{ width: 24, borderTop: `3px dotted ${C.texto}` }} /><span className="mu" style={{ fontSize: 16 }}>Projeção</span></span>
      </div>
      <svg width="100%" viewBox="0 0 900 560" style={{ flex: 1, minHeight: 0 }} role="img" aria-label={`Faturamento acumulado: ${moeda(fat.real)} no dia útil ${du}${fat.meta ? `, meta ${moeda(fat.meta)}` : ""}`}>
        <defs><linearGradient id="vgar" x1="0" y1="0" x2="0" y2="1.3"><stop offset="0" stopColor={C.real} stopOpacity=".28" /><stop offset="1" stopColor={C.real} stopOpacity="0" /></linearGradient></defs>
        <g stroke="#d9e3e1" strokeWidth="1.5" strokeDasharray="3 7">{eixo.marcas.map((m) => <line key={m} x1="80" y1={Y(m)} x2="860" y2={Y(m)} />)}</g>
        <g fill={C.mute} fontSize="28" textAnchor="end">{eixo.marcas.map((m) => <text key={m} x="68" y={Y(m) + 9.3}>{mil(m)}</text>)}</g>
        {ult && pts.length > 1 && <polygon points={`${pts.join(" ")} ${X(ult.du)},480 ${X(1)},480`} fill="url(#vgar)" />}
        {fat.meta ? <line x1={X(1)} y1={Y(fat.meta / N)} x2="860" y2={Y(fat.meta)} stroke={C.mute} strokeWidth="3.5" strokeDasharray="10 8" /> : null}
        {ult && du < N && <line x1={xh} y1={Y(ult.real)} x2="860" y2={Y(r.projecao ?? 0)} stroke={C.texto} strokeWidth="4" strokeDasharray="2 8" strokeLinecap="round" />}
        {pts.length > 1 && <polyline points={pts.join(" ")} fill="none" stroke={C.real} strokeWidth="6" strokeLinejoin="round" strokeLinecap="round" />}
        {ult && <circle cx={xh} cy={Y(ult.real)} r="10" fill={C.real} stroke="#fff" strokeWidth="3" />}
        {fat.meta ? <text x="860" y={Math.max(Y(fat.meta) - 8, 26)} fill={C.texto} fontSize="28" fontWeight="600" textAnchor="end">meta {mil(fat.meta)}</text> : null}
        {ult && du < N && r.projecao !== null && <text x="856" y={Y(r.projecao) + 40} fill={C.texto} fontSize="28" fontWeight="600" textAnchor="end">projeção {mil(r.projecao)}</text>}
        <g fill={C.mute} fontSize="28" textAnchor="middle">{rotulos.map((l) => <text key={l.t + l.x} x={l.x} y="534" fill={l.hoje ? C.texto : undefined} fontWeight={l.hoje ? 800 : undefined}>{l.t}</text>)}</g>
        <text x="16" y="266.7" fill={C.mute} fontSize="24" transform="rotate(-90 16 266.7)" textAnchor="middle">R$ mil</text>
      </svg>
    </div>
  );
}

function Faturamento({ d, q }: { d: VisaoGeralDados; q: QuadroCfg }) {
  const comGrafico = temItem(q, "grafico"), comPrecisa = temItem(q, "precisa"), comProjecao = temItem(q, "projecao");
  const { fat, periodo } = d;
  const r = calcularRitmo(fat.real, fat.meta, periodo.diaUtil, periodo.diasUteisMes);
  const caixa: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, background: "#eef6f4", borderRadius: 14, padding: "12px 20px", minWidth: 0 };
  return (
    <div className="cd" style={{ background: "linear-gradient(125deg,#e3f4f0 0%,#ffffff 62%)", borderColor: "#b7dad3", padding: "20px 34px 22px", display: "grid", gridTemplateColumns: comGrafico ? "minmax(0,1fr) minmax(0,1.05fr)" : "minmax(0,1fr)", gap: 34 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        <div className="row"><span className="lb nw" style={{ fontSize: 18 }}>{tituloDe(q)}</span><div style={{ flex: 1 }} />
          {r.selo && <Selo tom={r.selo.tom}>{r.selo.texto}</Selo>}</div>
        <span className="vl nw" style={{ fontSize: 108 }}>{moeda(fat.real)}</span>
        {fat.meta ? (
          <>
            <span className="nw" style={{ fontSize: 28, color: C.mute, fontWeight: 500 }}>de <b style={{ color: C.texto }}>{moeda(fat.meta)}</b> · <b style={{ color: C.label, fontSize: 34 }}>{Math.round(r.pctMeta ?? 0)}%</b></span>
            <div style={{ position: "relative", paddingBottom: 26, marginTop: 4 }}>
              <div style={{ position: "relative", height: 34, background: C.trilho, borderRadius: 17 }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, r.pctMeta ?? 0)}%`, borderRadius: 17, background: "linear-gradient(90deg,#1b9e88,#4cc5b0)" }} />
                <div style={{ position: "absolute", left: `${r.ritmoPct}%`, top: -22, bottom: -6, width: 4, background: C.texto, borderRadius: 2 }} />
              </div>
              <span className="mu" style={{ position: "absolute", left: `calc(${r.ritmoPct}% - 70px)`, bottom: 0, width: 140, textAlign: "center", fontSize: 17 }}>ritmo {Math.round(r.ritmoPct)}%</span>
            </div>
          </>
        ) : <span className="mu" style={{ fontSize: 22 }}>Meta do mês não cadastrada (Configurações → Equipe e metas)</span>}
        <div style={{ flex: 1 }} />
        <div style={{ display: "grid", gridTemplateColumns: fat.meta && comPrecisa && comProjecao ? "repeat(2,minmax(0,1fr))" : "1fr", gap: 14 }}>
          {fat.meta && comPrecisa && (
            <div style={caixa}>
              <span className="lb nw" style={{ fontSize: 15, color: C.mute }}>Precisa por dia útil</span>
              <span className="vl nw" style={{ fontSize: 40, color: r.precisaPorDia === null && r.faltam === 0 ? TOM.ok.c : C.texto }}>{r.precisaPorDia !== null ? moeda(r.precisaPorDia) : r.faltam === 0 ? "meta batida" : "—"}</span>
              <span className="mu nw" style={{ fontSize: 17 }}>média até hoje {moeda(r.mediaAteHoje)}</span>
            </div>
          )}
          {comProjecao && <div style={caixa}>
            <span className="lb nw" style={{ fontSize: 15, color: C.mute }}>Projeção do mês</span>
            <span className="vl nw" style={{ fontSize: 40 }}>{moeda(r.projecao ?? 0)}</span>
            <span className="mu nw" style={{ fontSize: 17 }}>{r.projecaoPct !== null ? `${Math.round(r.projecaoPct)}% · faltam ${moeda(r.faltam ?? 0)}` : "no ritmo atual do mês"}</span>
          </div>}
        </div>
      </div>
      {comGrafico && <Grafico d={d} />}
    </div>
  );
}

// ---------------- por pessoa ----------------
function MetaBarra({ rotulo, v, meta, ritmoPct }: { rotulo: string; v: number; meta: number; ritmoPct: number }) {
  const pct = meta > 0 ? (v / meta) * 100 : 0;
  const dif = pct - ritmoPct, tom = tomPorDiferenca(dif);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="mu nw" style={{ fontWeight: 600, color: C.texto, fontSize: 19 }}>{rotulo}</span>
      <div className="row nw" style={{ alignItems: "baseline", gap: 8 }}><span className="vl" style={{ fontSize: 40 }}>{inteiro(v)}</span><span className="mu" style={{ fontSize: 22, fontWeight: 600 }}>/ {inteiro(meta)}</span><div style={{ flex: 1 }} /><Selo tom={tom}>{seloRitmo(dif)}</Selo></div>
      <Barra pct={pct} tom={tom} />
    </div>
  );
}
function Cartao({ p, ritmoPct, q }: { p: Pessoa; ritmoPct: number; q: QuadroCfg }) {
  return (
    <div style={{ background: "#f7faf9", border: `1px solid ${C.linha}`, borderRadius: 16, padding: "14px 20px", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 10, minWidth: 0, minHeight: 0 }}>
      <div className="row" style={{ gap: 12 }}>
        {p.foto ? <img src={p.foto} alt="" style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover" }} /> : <span style={{ width: 48, height: 48, borderRadius: "50%", background: "#c9d6d3", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18, color: C.texto }}>{p.sigla}</span>}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}><span className="vl nw" style={{ fontSize: 28, overflow: "hidden", textOverflow: "ellipsis" }}>{p.nome}</span><span className="lb nw" style={{ fontSize: 13, color: C.mute }}>{p.tipo === "sdr" ? "SDR" : "Closer"}</span></div>
      </div>
      {p.conversas && temItem(q, "conversas") && <MetaBarra rotulo="Conversas trocadas" v={p.conversas.v} meta={p.conversas.meta} ritmoPct={ritmoPct} />}
      {p.marcacoes && temItem(q, "marcacoes") && <MetaBarra rotulo="Marcações" v={p.marcacoes.v} meta={p.marcacoes.meta} ritmoPct={ritmoPct} />}
      {temItem(q, "vendas") && <div style={{ background: "#e3f4f0", borderRadius: 12, padding: "10px 16px", display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="mu" style={{ fontWeight: 600, color: C.texto, fontSize: 19 }}>Vendas pagas</span>
        <span className="vl nw" style={{ fontSize: p.tipo === "closer" ? 46 : 38 }}>{moeda(p.vendasValor)}</span>
        <span className="mu nw" style={{ fontSize: 17 }}>{p.vendasN} venda{p.vendasN === 1 ? "" : "s"}</span>
      </div>}
    </div>
  );
}
function PorPessoa({ d, q }: { d: VisaoGeralDados; q: QuadroCfg }) {
  const ritmoPct = (Math.max(d.periodo.diaUtil, 1) / d.periodo.diasUteisMes) * 100;
  return (
    <div className="cd" style={{ padding: "16px 24px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="row" style={{ gap: 16 }}><span className="lb nw" style={{ fontSize: 18 }}>{tituloDe(q)}</span><span className="mu nw">real / meta do mês</span></div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(d.pessoas.length, 1)},minmax(0,1fr))`, gridTemplateRows: "minmax(0,1fr)", columnGap: 14, flex: 1, minHeight: 0 }}>
        {d.pessoas.map((p) => <Cartao key={p.id} p={p} ritmoPct={ritmoPct} q={q} />)}
        {!d.pessoas.length && <span className="mu" style={{ gridColumn: "1 / -1" }}>Nenhum vendedor cadastrado na aba WhatsApp.</span>}
      </div>
    </div>
  );
}

// ---------------- quadros pequenos ----------------
function KpiCard({ q, k, tam }: { q: QuadroCfg; k: Kpi; tam: number }) {
  const ruim = k.tom === "bad";
  return (
    <div className="cd" style={{ flex: 1, padding: "20px 26px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 8, background: ruim ? "#fff1ef" : "#fff", borderColor: ruim ? "#f1b8b2" : C.linha }}>
      <span className="lb" style={{ fontSize: 16, color: ruim ? TOM.bad.c : C.label, whiteSpace: "normal", lineHeight: 1.25 }}>{tituloDe(q)}</span>
      <span className="vl nw" style={{ fontSize: tam, color: k.valor === null ? C.mute : k.tom === "neutro" ? C.texto : TOM[k.tom].c }}>{k.valor ?? "—"}</span>
      {k.pct != null && <Barra pct={k.pct} tom={k.tom} />}
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>{k.selo && <Selo tom={k.tom}>{k.selo}</Selo>}<span className="mu" style={{ fontSize: 17 }}>{k.sub}</span></div>
    </div>
  );
}
function Pequenos({ d, lista, ao_lado }: { d: VisaoGeralDados; lista: QuadroCfg[]; ao_lado: boolean }) {
  const itens = lista.filter((q) => d.kpis[q.id]);
  const n = itens.length;
  const tam = n <= 2 ? 96 : n === 3 ? 60 : 72;
  const colunas = ao_lado ? (n > 3 ? 2 : 1) : Math.min(Math.max(n, 1), 4);
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${colunas},minmax(0,1fr))`, gridAutoRows: "minmax(0,1fr)", gap: 14, minHeight: 0 }}>
      {itens.map((q) => <KpiCard key={q.id} q={q} k={d.kpis[q.id]!} tam={tam} />)}
    </div>
  );
}

export default function VisaoGeral({ dados }: { dados: VisaoGeralDados }) {
  const [esc, setEsc] = useState<number | null>(null);
  useEffect(() => {
    const f = () => setEsc(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    f(); window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  const fat = dados.quadros.find((q) => q.id === "faturamento"), pes = dados.quadros.find((q) => q.id === "pessoas");
  const pequenos = dados.quadros.filter((q) => !CATALOGO[q.id].grande);
  return (
    <div className="vg" style={{ position: "fixed", inset: 0, zIndex: 30, background: "#f3f6f5", overflow: "hidden" }}>
      <style>{CSS}</style>
      {!dados.demo && <AutoRefresh segundos={60} />}
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 1920, height: 1080, transform: `translate(-50%,-50%) scale(${esc ?? 1})`, visibility: esc ? "visible" : "hidden", padding: "22px 30px", background: "radial-gradient(1400px 700px at 0 0, rgba(109,207,192,.18), rgba(255,255,255,0) 60%), #f3f6f5", display: "flex", flexDirection: "column", gap: 16 }}>
        <Cabecalho d={dados} />
        {fat && <div style={{ display: "grid", flex: pes || pequenos.length ? 0.95 : 1, minHeight: 0 }}><Faturamento d={dados} q={fat} /></div>}
        {(pes || pequenos.length > 0) && (
          <div style={{ display: "grid", gridTemplateColumns: pes && pequenos.length ? (pequenos.length > 3 ? "minmax(0,1fr) 640px" : "minmax(0,1fr) 420px") : "minmax(0,1fr)", gap: 16, flex: fat ? 1.05 : 1, minHeight: 0 }}>
            {pes && <PorPessoa d={dados} q={pes} />}
            {pequenos.length > 0 && <Pequenos d={dados} lista={pequenos} ao_lado={!!pes} />}
          </div>
        )}
      </div>
    </div>
  );
}

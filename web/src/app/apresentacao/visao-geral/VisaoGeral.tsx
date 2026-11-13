"use client";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import AutoRefresh from "@/components/AutoRefresh";
import { duracao } from "@/lib/format";
import PeriodoSeletor from "./PeriodoSeletor";
import BotaoAtualizarCrm from "./BotaoAtualizarCrm";
import { CATALOGO, temItem, tituloDe, type QuadroCfg } from "@/lib/quadrosTv";
import { calcularRitmo, eixoY, inteiro, moeda, tomPorDiferenca, type Kpi, type Pessoa, type Tom, type VisaoGeralDados } from "./calc";

// Tela fixa da TV do comercial (sem rodizio), fundo claro, 1920x1080 escalada para qualquer TV.
// So mostra o que o Cabueta mede. Cores de texto com contraste minimo de 4,5:1 sobre o branco.
// As cores sao variaveis CSS: o botao Modo claro/escuro troca os valores (paleta Weevo) sem mudar o resto do codigo.
const tom = (t: Tom) => ({ c: `var(--vg-${t}-c)`, bg: `var(--vg-${t}-bg)`, barra: `var(--vg-${t}-barra)` });
const TOM: Record<Tom, { c: string; bg: string; barra: string }> = { ok: tom("ok"), warn: tom("warn"), bad: tom("bad"), neutro: tom("neutro") };
const C = { texto: "var(--vg-texto)", mute: "var(--vg-mute)", label: "var(--vg-label)", linha: "var(--vg-linha)", trilho: "var(--vg-trilho)", real: "var(--vg-real)" };
// [claro, escuro] de cada cor
const TEMA_CLARO = "--vg-texto:#10201e;--vg-mute:#4f6462;--vg-label:#0d6b5f;--vg-linha:#d3dddb;--vg-trilho:#e2eae8;--vg-real:#0f9b86;--vg-ok-c:#0a7a4b;--vg-ok-bg:#dcf4e7;--vg-ok-barra:#1fa86a;--vg-warn-c:#8a5a00;--vg-warn-bg:#fdf0cc;--vg-warn-barra:#e0a100;--vg-bad-c:#b42318;--vg-bad-bg:#fde3e0;--vg-bad-barra:#e5484d;--vg-neutro-c:#3d5250;--vg-neutro-bg:#e6eeed;--vg-neutro-barra:#9bb0ad;--vg-quadro:#fff;--vg-caixa:#f7faf9;--vg-dentro:#eef6f4;--vg-destaque:#e3f4f0;--vg-grade:#d9e3e1;--vg-borda-fat:#b7dad3;--vg-tracejado:#b3c4c1;--vg-avatar:#c9d6d3;--vg-kpi-ruim-bg:#fff1ef;--vg-kpi-ruim-borda:#f1b8b2;--vg-fundo:#f3f6f5;--vg-brilho:rgba(109,207,192,.18);--vg-veu:rgba(16,32,30,.45);--vg-sombra:rgba(16,32,30,.05);--vg-forte-bg:#0f3b38;--vg-forte-texto:#fff;--vg-forte-borda:#0f3b38";
const TEMA_ESCURO = "--vg-texto:#f0faf7;--vg-mute:#9ba5a4;--vg-label:#6dcfc0;--vg-linha:#2b3433;--vg-trilho:#1d2527;--vg-real:#6dcfc0;--vg-ok-c:#5fd39a;--vg-ok-bg:rgba(95,211,154,.14);--vg-ok-barra:#5fd39a;--vg-warn-c:#e5a85f;--vg-warn-bg:rgba(229,168,95,.15);--vg-warn-barra:#e5a85f;--vg-bad-c:#ff7b6b;--vg-bad-bg:rgba(255,123,107,.14);--vg-bad-barra:#ff7b6b;--vg-neutro-c:#9ba5a4;--vg-neutro-bg:#1d2527;--vg-neutro-barra:#5b6a68;--vg-quadro:#151b1e;--vg-caixa:#1a2225;--vg-dentro:#212b2e;--vg-destaque:#16302e;--vg-grade:#2b3433;--vg-borda-fat:#24433f;--vg-tracejado:#3a4746;--vg-avatar:#2b3433;--vg-kpi-ruim-bg:rgba(255,123,107,.08);--vg-kpi-ruim-borda:#5c2c27;--vg-fundo:#0c1212;--vg-brilho:rgba(28,71,70,.45);--vg-veu:rgba(0,0,0,.6);--vg-sombra:rgba(0,0,0,.35);--vg-forte-bg:linear-gradient(90deg,#86dccd,#5fbcae);--vg-forte-texto:#0c1212;--vg-forte-borda:transparent";
type Tema = "claro" | "escuro";
const CSS = `
.vg{${TEMA_CLARO};color-scheme:light;font-family:'Inter Variable',Inter,system-ui,sans-serif;color:${C.texto}}
.vg[data-tema=escuro]{${TEMA_ESCURO};color-scheme:dark}
.vg select option{background:var(--vg-quadro);color:${C.texto}}
.vg *{box-sizing:border-box}
.vg .cd{background:var(--vg-quadro);border:1px solid ${C.linha};border-radius:20px;min-width:0;min-height:0;box-shadow:0 1px 2px var(--vg-sombra)}
.vg .lb{font-weight:700;font-size:16px;letter-spacing:.16em;text-transform:uppercase;color:${C.label}}
.vg .vl{font-weight:800;letter-spacing:-.03em;line-height:1;color:${C.texto}}
.vg .mu{font-weight:500;font-size:18px;color:${C.mute}}
.vg .row{display:flex;align-items:center;gap:12px;min-width:0}
.vg .st{font-weight:700;font-size:16px;border-radius:999px;padding:5px 14px;white-space:nowrap}
.vg .nw{white-space:nowrap}
.vg .bt{font-family:inherit;font-weight:700;font-size:16px;border-radius:999px;padding:8px 15px;cursor:pointer;text-decoration:none;border:1px solid ${C.linha};background:var(--vg-quadro);color:${C.texto}}
.vg .bt:hover{border-color:${C.label}}
.vg .bt:focus-visible,.vg .pr:focus-visible{outline:2px solid ${C.label};outline-offset:2px}
.vg .bt-forte{background:var(--vg-forte-bg);border-color:var(--vg-forte-borda);color:var(--vg-forte-texto)}
.vg .pr{font-family:inherit;border:1px solid transparent;cursor:pointer;transition:border-color .15s,filter .15s}
.vg .pr:hover{border-color:${C.label};filter:brightness(1.05)}
.vg select,.vg input[type=date]{font-family:inherit;color:${C.texto};background:transparent;border:0;outline:none}
.vg select:focus-visible,.vg input[type=date]:focus-visible{outline:2px solid ${C.label}}
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

// Tela cheia: o botao vira "Sair da tela cheia" quando ela esta ligada (o Esc do navegador tambem sai)
function BotaoTelaCheia() {
  const [cheia, setCheia] = useState(false);
  useEffect(() => {
    const f = () => setCheia(!!document.fullscreenElement);
    f(); document.addEventListener("fullscreenchange", f);
    return () => document.removeEventListener("fullscreenchange", f);
  }, []);
  const alternar = () => { try { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen(); } catch { /* navegador sem tela cheia */ } };
  return <button type="button" onClick={alternar} className={`bt nw${cheia ? "" : " bt-forte"}`}>{cheia ? "Sair da tela cheia" : "Tela cheia"}</button>;
}

// ---------------- cabecalho ----------------
function Cabecalho({ d, tema, trocarTema }: { d: VisaoGeralDados; tema: Tema; trocarTema: () => void }) {
  return (
    <div className="row" style={{ gap: 12, height: 52 }}>
      <Link href="/" title="Voltar ao painel" style={{ display: "flex", background: "#0f3b38", borderRadius: 14, padding: "8px 18px" }}><img src="/weevo-logo.png" alt="Weevo" style={{ height: 30, width: "auto" }} /></Link>
      <span className="lb nw" style={{ color: C.mute }}>Cabueta do Elon Musk</span>
      <span className="mu nw">Atualizado às {d.atualizadoEm}</span>
      <div style={{ flex: 1 }} />
      <Link href="/" className="bt nw" title="Voltar para a tela inicial do Cabueta">← Tela inicial</Link>
      {!d.demo && <BotaoAtualizarCrm />}
      <button type="button" onClick={trocarTema} className="bt nw" data-tema-botao aria-label={tema === "escuro" ? "Mudar para o modo claro" : "Mudar para o modo escuro"}>{tema === "escuro" ? "☀ Modo claro" : "☾ Modo escuro"}</button>
      <BotaoTelaCheia />
      {d.demo && <span className="st nw" style={{ background: TOM.neutro.bg, color: TOM.neutro.c }}>EXEMPLO · NÚMEROS FICTÍCIOS</span>}
      {(() => {
        const detalhe = d.periodo.mensal ? `${d.periodo.intervalo} · dia útil ${d.periodo.diaUtil} de ${d.periodo.diasUteisMes}` : `${d.periodo.intervalo} · ${d.periodo.diaUtil} dia${d.periodo.diaUtil === 1 ? "" : "s"} útil${d.periodo.diaUtil === 1 ? "" : "eis"}`;
        return d.demo ? (
          <div className="row cd" style={{ borderRadius: 999, padding: "10px 24px", gap: 14 }}>
            <span className="lb nw" style={{ fontSize: 15 }}>Período</span>
            <span className="nw" style={{ fontWeight: 700, fontSize: 21 }}>{d.periodo.rotulo}</span>
            <span className="mu nw">{detalhe}</span>
          </div>
        ) : <PeriodoSeletor p={d.periodo.p} de={d.periodo.de} ate={d.periodo.ate} detalhe={detalhe} />;
      })()}
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
  // meta e projecao no fim do grafico: o de valor maior acima da propria linha, o outro abaixo, com 36 de distancia no minimo
  const fins = [
    ...(fat.meta ? [{ t: `meta ${mil(fat.meta)}`, v: fat.meta, cor: C.mute }] : []),
    ...(ult && du < N && r.projecao !== null ? [{ t: `projeção ${mil(r.projecao)}`, v: r.projecao, cor: C.texto }] : []),
  ].sort((a, b) => b.v - a.v);
  const rotulosFim: { t: string; y: number; cor: string }[] = [];
  fins.forEach((f, i) => {
    let y = i === 0 ? Y(f.v) - 12 : Y(f.v) + 36;
    if (i === 0) y = Math.max(y, 30);
    else y = Math.min(Math.max(y, rotulosFim[0].y + 36), 470);
    rotulosFim.push({ t: f.t, y, cor: f.cor });
  });
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
        <g stroke="var(--vg-grade)" strokeWidth="1.5" strokeDasharray="3 7">{eixo.marcas.map((m) => <line key={m} x1="80" y1={Y(m)} x2="860" y2={Y(m)} />)}</g>
        <g fill={C.mute} fontSize="28" textAnchor="end">{eixo.marcas.map((m) => <text key={m} x="68" y={Y(m) + 9.3}>{mil(m)}</text>)}</g>
        {ult && pts.length > 1 && <polygon points={`${pts.join(" ")} ${X(ult.du)},480 ${X(1)},480`} fill="url(#vgar)" />}
        {fat.meta ? <line x1={X(1)} y1={Y(fat.meta / N)} x2="860" y2={Y(fat.meta)} stroke={C.mute} strokeWidth="3.5" strokeDasharray="10 8" /> : null}
        {ult && du < N && <line x1={xh} y1={Y(ult.real)} x2="860" y2={Y(r.projecao ?? 0)} stroke={C.texto} strokeWidth="4" strokeDasharray="2 8" strokeLinecap="round" />}
        {pts.length > 1 && <polyline points={pts.join(" ")} fill="none" stroke={C.real} strokeWidth="6" strokeLinejoin="round" strokeLinecap="round" />}
        {ult && <circle cx={xh} cy={Y(ult.real)} r="10" fill={C.real} stroke="var(--vg-quadro)" strokeWidth="3" />}
        {/* rotulos da meta e da projecao: o de valor maior fica acima da linha dele, o outro abaixo, nunca um em cima do outro */}
        {rotulosFim.map((l) => <text key={l.t} x="858" y={l.y} fill={l.cor} fontSize="28" fontWeight="700" textAnchor="end" stroke="var(--vg-quadro)" strokeWidth="8" strokeLinejoin="round" paintOrder="stroke">{l.t}</text>)}
        <g fill={C.mute} fontSize="28" textAnchor="middle">{rotulos.map((l) => <text key={l.t + l.x} x={l.x} y="534" fill={l.hoje ? C.texto : undefined} fontWeight={l.hoje ? 800 : undefined}>{l.t}</text>)}</g>
        <text x="16" y="266.7" fill={C.mute} fontSize="24" transform="rotate(-90 16 266.7)" textAnchor="middle">R$ mil</text>
      </svg>
    </div>
  );
}

const NOME_PRODUTO: Record<string, string> = { plataforma: "Plataforma", imersao: "Imersão", incompany: "In-Company", workshop: "Workshop", outro: "Outro" };
// Lista das vendas de um produto, por cima da tela (fecha no X, clicando fora ou com Esc)
type ProdutoFat = NonNullable<VisaoGeralDados["fat"]["porProduto"]>[number];
const GRADE = "minmax(0,1fr) 260px 90px 200px";
function VendasDoProduto({ p, fechar }: { p: ProdutoFat; fechar: () => void }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") fechar(); };
    document.addEventListener("keydown", f);
    return () => document.removeEventListener("keydown", f);
  }, [fechar]);
  const nome = NOME_PRODUTO[p.produto] ?? p.produto, vendas = p.vendas ?? [];
  return (
    // position fixed dentro da tela escalada: cobre a tela 1920x1080 inteira e escala junto
    <div onClick={fechar} style={{ position: "fixed", inset: 0, zIndex: 50, background: "var(--vg-veu)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div role="dialog" aria-modal="true" aria-label={`Vendas de ${nome}`} onClick={(e) => e.stopPropagation()} className="cd"
        style={{ width: 1100, maxHeight: 860, display: "flex", flexDirection: "column", padding: "26px 32px", gap: 18, borderColor: "var(--vg-borda-fat)" }}>
        <div className="row" style={{ gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <span className="lb nw">Vendas de {nome}</span>
            <span className="vl nw" style={{ fontSize: 52 }}>{moeda(p.valor)}</span>
            <span className="mu nw">{p.n} venda{p.n === 1 ? "" : "s"} no período</span>
          </div>
          <div style={{ flex: 1 }} />
          <button type="button" className="bt" onClick={fechar} aria-label="Fechar" autoFocus>✕ Fechar</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: GRADE, gap: "0 18px", padding: "0 16px", fontSize: 15, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: C.mute }}>
          <span>Cliente</span><span>Vendedor</span><span>Data</span><span style={{ textAlign: "right" }}>Valor</span>
        </div>
        <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
          {vendas.length ? vendas.map((v, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: GRADE, gap: "0 18px", alignItems: "center", background: "var(--vg-dentro)", borderRadius: 12, padding: "12px 16px" }}>
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span className="nw" style={{ fontSize: 22, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>{v.cliente}</span>
                {v.empresa && <span className="mu nw" style={{ fontSize: 16, overflow: "hidden", textOverflow: "ellipsis" }}>{v.empresa}</span>}
              </div>
              <span className="nw" style={{ fontSize: 20, color: v.vendedor ? C.texto : C.mute, overflow: "hidden", textOverflow: "ellipsis" }}>{v.vendedor ?? "—"}</span>
              <span className="mu nw" style={{ fontSize: 20, fontVariantNumeric: "tabular-nums" }}>{v.data}</span>
              <span className="nw" style={{ fontSize: 24, fontWeight: 800, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{moeda(v.valor)}</span>
            </div>
          )) : <span className="mu">Sem vendas listadas.</span>}
        </div>
      </div>
    </div>
  );
}
function Faturamento({ d, q }: { d: VisaoGeralDados; q: QuadroCfg }) {
  const comGrafico = temItem(q, "grafico"), comPrecisa = temItem(q, "precisa"), comProjecao = temItem(q, "projecao") && d.periodo.mensal;
  const { fat, periodo } = d;
  const r = calcularRitmo(fat.real, fat.meta, periodo.diaUtil, periodo.diasUteisMes);
  const compacto = !!fat.porProduto?.length; // com a faixa de produtos, o resto encolhe para caber na mesma altura
  const caixa: CSSProperties = { display: "flex", flexDirection: "column", gap: compacto ? 0 : 4, background: "var(--vg-dentro)", borderRadius: 14, padding: compacto ? "8px 18px" : "12px 20px", minWidth: 0 };
  const [aberto, setAberto] = useState<string | null>(null);
  const produtoAberto = fat.porProduto?.find((x) => x.produto === aberto) ?? null;
  return (
    <div className="cd" style={{ background: "linear-gradient(125deg,var(--vg-destaque) 0%,var(--vg-quadro) 62%)", borderColor: "var(--vg-borda-fat)", padding: "20px 34px 22px", overflow: "hidden", minHeight: 0, display: "grid", gridTemplateRows: "minmax(0,1fr)", gridTemplateColumns: comGrafico ? "minmax(0,1fr) minmax(0,1.05fr)" : "minmax(0,1fr)", gap: 34 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: fat.porProduto?.length ? 8 : 10, minWidth: 0, minHeight: 0 }}>
        <div className="row"><span className="lb nw" style={{ fontSize: 18 }}>{tituloDe(q)}</span><div style={{ flex: 1 }} />
          {r.selo && <Selo tom={r.selo.tom}>{r.selo.texto}</Selo>}</div>
        <span className="vl nw" style={{ fontSize: fat.porProduto?.length ? 80 : 108 }}>{moeda(fat.real)}</span>
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
        ) : (
          <>
            <span className="mu nw" style={{ fontSize: 22 }}>{periodo.mensal ? "Meta do mês não cadastrada" : "A meta de faturamento do mês vale só para o período \"Mês atual\""}</span>
            {/* barra de progresso vazia: so enche quando ha meta do mes (Mes atual) */}
            <div style={{ paddingBottom: 26, marginTop: 4 }}>
              <div role="progressbar" aria-label="Progresso do faturamento contra a meta" aria-valuetext="sem meta cadastrada" style={{ height: 34, borderRadius: 17, border: "2px dashed var(--vg-tracejado)", background: C.trilho, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span className="mu nw" style={{ fontSize: 17 }}>{periodo.mensal ? "Cadastre a meta em Configurações → Apresentação (TV) para ver o progresso" : "Troque para \"Mês atual\" para ver o progresso da meta"}</span>
              </div>
            </div>
          </>
        )}
        {!!fat.porProduto?.length && (
          // uma linha so, cada produto numa coluna do mesmo tamanho (nome em cima, valor embaixo): cabe ate 5 produtos sem cortar
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${fat.porProduto.length},minmax(0,1fr))`, gap: 8, flexShrink: 0 }} aria-label="Faturamento por produto">
            {fat.porProduto.map((x) => (
              // clicar no produto abre a lista das vendas dele (cliente, vendedor, data e valor)
              <button key={x.produto} type="button" className="pr" onClick={() => setAberto(x.produto)} aria-haspopup="dialog" title={`Ver as vendas de ${NOME_PRODUTO[x.produto] ?? x.produto}`}
                style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 0, minWidth: 0, borderRadius: 10, padding: "5px 10px", textAlign: "left",
                ...(x.produto === "plataforma" ? { background: "#1b9e88", color: "#fff" } : { background: "var(--vg-dentro)", color: C.texto }) }}>
                <span className="nw" style={{ fontSize: 14, fontWeight: 700, color: x.produto === "plataforma" ? "#e3f4f0" : C.mute, overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{NOME_PRODUTO[x.produto] ?? x.produto}</span>
                <span className="nw" style={{ fontSize: fat.porProduto!.length > 4 ? 17 : 20, fontWeight: 800, lineHeight: 1.15, fontVariantNumeric: "tabular-nums" }}>{moeda(x.valor)}</span>
              </button>
            ))}
          </div>
        )}
        {produtoAberto && <VendasDoProduto p={produtoAberto} fechar={() => setAberto(null)} />}
        <div style={{ flex: 1 }} />
        <div style={{ display: "grid", gridTemplateColumns: fat.meta && comPrecisa && comProjecao ? "repeat(2,minmax(0,1fr))" : "1fr", gap: 14 }}>
          {fat.meta && comPrecisa && (
            <div style={caixa}>
              <span className="lb nw" style={{ fontSize: 15, color: C.mute }}>Precisa por dia útil</span>
              <span className="vl nw" style={{ fontSize: compacto ? 32 : 40, color: r.precisaPorDia === null && r.faltam === 0 ? TOM.ok.c : C.texto }}>{r.precisaPorDia !== null ? moeda(r.precisaPorDia) : r.faltam === 0 ? "meta batida" : "—"}</span>
              <span className="mu nw" style={{ fontSize: 17 }}>média até hoje {moeda(r.mediaAteHoje)}</span>
            </div>
          )}
          {comProjecao && <div style={caixa}>
            <span className="lb nw" style={{ fontSize: 15, color: C.mute }}>Projeção do mês</span>
            <span className="vl nw" style={{ fontSize: compacto ? 32 : 40 }}>{moeda(r.projecao ?? 0)}</span>
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
    <div style={{ background: "var(--vg-caixa)", border: `1px solid ${C.linha}`, borderRadius: 16, padding: "14px 20px", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 10, minWidth: 0, minHeight: 0 }}>
      <div className="row" style={{ gap: 12 }}>
        {p.foto ? <img src={p.foto} alt="" style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover" }} /> : <span style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--vg-avatar)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18, color: C.texto }}>{p.sigla}</span>}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}><span className="vl nw" style={{ fontSize: 28, overflow: "hidden", textOverflow: "ellipsis" }}>{p.nome}</span><span className="lb nw" style={{ fontSize: 13, color: C.mute }}>{p.tipo === "sdr" ? "SDR" : "Closer"}</span></div>
      </div>
      {p.conversas && temItem(q, "conversas") && <MetaBarra rotulo="Conversas trocadas" v={p.conversas.v} meta={p.conversas.meta} ritmoPct={ritmoPct} />}
      {p.marcacoes && temItem(q, "marcacoes") && <MetaBarra rotulo="Marcações" v={p.marcacoes.v} meta={p.marcacoes.meta} ritmoPct={ritmoPct} />}
      {p.reunioes && temItem(q, "funil") && <MetaBarra rotulo="Reuniões realizadas" v={p.reunioes.v} meta={p.reunioes.meta} ritmoPct={ritmoPct} />}
      {p.followups && temItem(q, "followup") && (() => {
        const f = p.followups, tom = f.qtd > 0 ? TOM.bad : TOM.ok;
        return (
          <div className="row" style={{ background: "var(--vg-dentro)", borderRadius: 12, padding: "10px 16px", gap: 12, minWidth: 0 }} aria-label="Follow-ups atrasados">
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
              <span className="mu nw" style={{ fontWeight: 600, color: C.texto, fontSize: 17 }}>Follow-ups atrasados</span>
              <span className="mu nw" style={{ fontSize: 15, overflow: "hidden", textOverflow: "ellipsis" }}>{f.qtd > 0 ? `${f.dias}+ dias sem mensagem${f.maisAntigo != null ? ` · mais antigo ${f.maisAntigo} dias` : ""}` : "nenhum cliente esperando"}</span>
            </div>
            <span className="vl nw" style={{ fontSize: 40, color: tom.c }}>{inteiro(f.qtd)}</span>
          </div>
        );
      })()}
      {temItem(q, "vendas") && <div style={{ background: "var(--vg-destaque)", borderRadius: 12, padding: "10px 16px", display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="mu" style={{ fontWeight: 600, color: C.texto, fontSize: 19 }}>Vendas pagas</span>
        <span className="vl nw" style={{ fontSize: p.tipo === "closer" ? 36 : 30, fontVariantNumeric: "tabular-nums" }}>{moeda(p.vendasValor)}</span>
        <span className="mu nw" style={{ fontSize: 17 }}>{p.vendasN} venda{p.vendasN === 1 ? "" : "s"}</span>
      </div>}
    </div>
  );
}
function PorPessoa({ d, q }: { d: VisaoGeralDados; q: QuadroCfg }) {
  const ritmoPct = (Math.max(d.periodo.diaUtil, 1) / d.periodo.diasUteisMes) * 100;
  return (
    <div className="cd" style={{ padding: "16px 24px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="row" style={{ gap: 16 }}><span className="lb nw" style={{ fontSize: 18 }}>{tituloDe(q)}</span><span className="mu nw">real / meta do período</span></div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(d.pessoas.length, 1)},minmax(0,1fr))`, gridTemplateRows: "minmax(0,1fr)", columnGap: 14, flex: 1, minHeight: 0 }}>
        {d.pessoas.map((p) => <Cartao key={p.id} p={p} ritmoPct={ritmoPct} q={q} />)}
        {!d.pessoas.length && <span className="mu" style={{ gridColumn: "1 / -1" }}>Nenhum vendedor com WhatsApp cadastrado em Usuários.</span>}
      </div>
    </div>
  );
}

// ---------------- quadros pequenos ----------------
function KpiCard({ q, k, tam }: { q: QuadroCfg; k: Kpi; tam: number }) {
  const ruim = k.tom === "bad";
  return (
    <div className="cd" style={{ flex: 1, padding: "20px 26px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 8, background: ruim ? "var(--vg-kpi-ruim-bg)" : "var(--vg-quadro)", borderColor: ruim ? "var(--vg-kpi-ruim-borda)" : C.linha }}>
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
  // modo claro/escuro: lembrado neste navegador (cada TV guarda o seu)
  const [tema, setTema] = useState<Tema>("claro");
  useEffect(() => { try { if (localStorage.getItem("cabueta-tv-tema") === "escuro") setTema("escuro"); } catch { /* sem armazenamento */ } }, []);
  const trocarTema = () => setTema((t) => { const n: Tema = t === "escuro" ? "claro" : "escuro"; try { localStorage.setItem("cabueta-tv-tema", n); } catch { /* sem armazenamento */ } return n; });
  const fat = dados.quadros.find((q) => q.id === "faturamento"), pes = dados.quadros.find((q) => q.id === "pessoas");
  const pequenos = dados.quadros.filter((q) => !CATALOGO[q.id].grande);
  return (
    <div className="vg" data-tema={tema} style={{ position: "fixed", inset: 0, zIndex: 30, background: "radial-gradient(1400px 700px at 0 0, var(--vg-brilho), transparent 60%), var(--vg-fundo)", overflow: "hidden" }}>
      <style>{CSS}</style>
      {!dados.demo && <AutoRefresh segundos={60} />}
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 1920, height: 1080, transform: `translate(-50%,-50%) scale(${esc ?? 1})`, visibility: esc ? "visible" : "hidden", padding: "22px 30px", background: "transparent", display: "flex", flexDirection: "column", gap: 16 }}>
        <Cabecalho d={dados} tema={tema} trocarTema={trocarTema} />
        {fat && <div style={{ display: "grid", gridTemplateRows: "minmax(0,1fr)", flex: pes || pequenos.length ? 0.95 : 1, minHeight: 0 }}><Faturamento d={dados} q={fat} /></div>}
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

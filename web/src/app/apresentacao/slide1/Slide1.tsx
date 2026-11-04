"use client";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { calcularRitmo, eixoY, inteiro, moeda, tomPorDiferenca, type Pessoa, type Produto, type Slide1Dados, type Tom } from "./calc";

// Slide 1 (Visao geral) da Apresentacao: 1920x1080 fixos, escalados para caber em qualquer TV.
// Cores, tamanhos e espacos seguem o HTML de referencia. Dado sem fonte aparece tracejado como "aguardando fonte".
const TOM: Record<Tom, { c: string; bg: string }> = {
  ok: { c: "#5fe0a5", bg: "#123a2c" }, warn: { c: "#ffc95a", bg: "#3d2f10" }, bad: { c: "#ff8a8a", bg: "#40181c" }, neutro: { c: "#c4d6d2", bg: "#1d2627" },
};
const CSS = `
.s1{font-family:'Inter Variable',Inter,system-ui,sans-serif;color:#f0faf7}
.s1 *{box-sizing:border-box}
.s1 .cd{background:#151b1e;border:1px solid #2b3433;border-radius:18px;min-width:0;min-height:0}
.s1 .lb{font-weight:600;font-size:14px;letter-spacing:.18em;text-transform:uppercase;color:#6dcfc0}
.s1 .vl{font-weight:800;letter-spacing:-.03em;color:#f0faf7;line-height:1}
.s1 .mu{font-weight:500;font-size:15px;color:#8fa3a0}
.s1 .tx{font-weight:500;font-size:17px;color:#c4d6d2}
.s1 .row{display:flex;align-items:center;gap:10px;min-width:0}
.s1 .st{font-weight:700;font-size:14px;letter-spacing:.06em;border-radius:999px;padding:4px 10px;white-space:nowrap}
.s1 .av{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;color:#0c1212;flex:none;object-fit:cover}
.s1 .trk{position:relative;height:8px;background:#232c2e;border-radius:4px}
.s1 .fl{position:absolute;left:0;top:0;bottom:0;border-radius:4px}
.s1 .falta{border:1px dashed #3a4544;border-radius:8px}
.s1 .nw{white-space:nowrap}
`;
const verde = "#6dcfc0";
const mu13: CSSProperties = { fontSize: 13 };

function Selo({ tom, children, style }: { tom: Tom; children: ReactNode; style?: CSSProperties }) {
  return <span className="st" style={{ color: TOM[tom].c, background: TOM[tom].bg, ...style }}>{children}</span>;
}
// "— aguardando fonte": o dado ainda nao existe no Cabueta (nunca vira zero)
function Falta({ style, texto = "aguardando fonte" }: { style?: CSSProperties; texto?: string }) {
  return <span className="mu nw" style={{ fontSize: 14, ...style }}>— {texto}</span>;
}
const Trilho = ({ pct, cor = verde }: { pct: number | null; cor?: string }) => pct === null
  ? <div className="falta" style={{ height: 8, borderRadius: 4 }} />
  : <div className="trk"><div className="fl" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: cor }} /></div>;

// ---------------- cabecalho ----------------
function Cabecalho({ d, idx, total, seg }: { d: Slide1Dados; idx: number; total: number; seg: number }) {
  return (
    <div className="row" style={{ gap: 16 }}>
      <img src="/weevo-logo.png" alt="Weevo" style={{ height: 30, width: "auto" }} />
      <span style={{ width: 1, height: 26, background: "#2b3433" }} />
      <span className="lb nw" style={{ fontSize: 13, color: "#8fa3a0" }}>Cabueta do Elon Musk</span>
      <span className="mu nw" style={{ marginLeft: 6 }}>Atualizado às {d.atualizadoEm}</span>
      <div style={{ flex: 1 }} />
      {d.demo && <span className="st nw" style={{ background: "#1d2627", color: "#c4d6d2", fontSize: 13 }}>EXEMPLO · NÚMEROS FICTÍCIOS</span>}
      <div className="row cd" style={{ borderRadius: 999, padding: "7px 18px", gap: 12 }}>
        <span className="lb nw" style={{ fontSize: 13 }}>Período</span>
        <span className="nw" style={{ fontWeight: 700, fontSize: 17 }}>{d.periodo.rotulo}</span>
        <span className="mu nw">{d.periodo.intervalo} · dia útil {d.periodo.diaUtil} de {d.periodo.diasUteisMes}</span>
      </div>
      <div className="row cd" style={{ borderRadius: 999, padding: "7px 16px", gap: 14, background: "#11181a" }}>
        <div className="row" style={{ gap: 5 }}>
          {Array.from({ length: total }, (_, i) => <span key={i} style={{ width: i === idx ? 22 : 6, height: 6, borderRadius: 3, background: i === idx ? "#5fd1b9" : "#4a5654" }} />)}
        </div>
        <span className="tx nw" style={{ fontSize: 15 }}>{idx + 1}/{total} · Visão geral</span>
        <span className="mu nw">{seg}s por quadro</span>
      </div>
    </div>
  );
}

// ---------------- faturamento ----------------
function Grafico({ d }: { d: Slide1Dados }) {
  const { fat, periodo } = d;
  const N = periodo.diasUteisMes, du = periodo.diaUtil;
  const r = calcularRitmo(fat.real, fat.meta, du, N);
  const eixo = eixoY(Math.max(fat.meta ?? 0, r.projecao ?? 0, fat.real));
  const X = (i: number) => 80 + ((i - 1) / Math.max(N - 1, 1)) * 780;
  const Y = (v: number) => Math.max(14, 480 - (v / eixo.topo) * 440);
  const pts = fat.serie.map((s) => `${X(s.du).toFixed(1)},${Y(s.real).toFixed(1)}`);
  const ult = fat.serie[fat.serie.length - 1];
  const xh = ult ? X(ult.du) : X(1);
  const fmtMil = (v: number) => String(Math.round(v / 1000));
  const rotulos: { x: number; t: string; hoje?: boolean }[] = [];
  if (fat.datasUteis.length) {
    rotulos.push({ x: Math.max(X(1), 96), t: fat.datasUteis[0] });
    if (du >= 9 && fat.datasUteis[5]) rotulos.push({ x: X(6), t: fat.datasUteis[5] });
    rotulos.push({ x: xh, t: "hoje", hoje: true });
    if (du < N - 1) rotulos.push({ x: 840, t: fat.datasUteis[N - 1] ?? "" });
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      <div className="row" style={{ gap: 12 }}>
        <span className="lb nw" style={{ fontSize: 14, color: "#8fa3a0" }}>Acumulado por dia útil</span><div style={{ flex: 1 }} />
        <span className="row" style={{ gap: 6 }}><span style={{ width: 20, height: 4, background: verde, borderRadius: 2 }} /><span className="mu" style={mu13}>Real</span></span>
        <span className="row" style={{ gap: 6 }}><span style={{ width: 20, borderTop: "3px dashed #8fa3a0" }} /><span className="mu" style={mu13}>Meta</span></span>
        <span className="row" style={{ gap: 6 }}><span style={{ width: 20, borderTop: "3px dotted #c4d6d2" }} /><span className="mu" style={mu13}>Projeção</span></span>
      </div>
      <svg width="100%" viewBox="0 0 900 560" style={{ flex: 1, minHeight: 0 }} role="img" aria-label={`Faturamento acumulado: ${moeda(fat.real)} no dia útil ${du}${fat.meta ? `, meta ${moeda(fat.meta)}` : ""}`}>
        <defs><linearGradient id="s1ar" x1="0" y1="0" x2="0" y2="1.3"><stop offset="0" stopColor={verde} stopOpacity=".35" /><stop offset="1" stopColor={verde} stopOpacity="0" /></linearGradient></defs>
        <g stroke="#2a3536" strokeWidth="1.2" strokeDasharray="3 7">{eixo.marcas.map((m) => <line key={m} x1="80" y1={Y(m)} x2="860" y2={Y(m)} />)}</g>
        <g fill="#8fa3a0" fontSize="28" textAnchor="end">{eixo.marcas.map((m) => <text key={m} x="68" y={Y(m) + 9.3}>{fmtMil(m)}</text>)}</g>
        {ult && pts.length > 1 && <polygon points={`${pts.join(" ")} ${X(ult.du)},480 ${X(1)},480`} fill="url(#s1ar)" />}
        {fat.meta ? <line x1={X(1)} y1={Y(fat.meta / N)} x2="860" y2={Y(fat.meta)} stroke="#8fa3a0" strokeWidth="3" strokeDasharray="10 8" /> : null}
        {ult && du < N && <line x1={xh} y1={Y(ult.real)} x2="860" y2={Y(r.projecao ?? 0)} stroke="#c4d6d2" strokeWidth="3.5" strokeDasharray="2 8" strokeLinecap="round" />}
        {pts.length > 1 && <polyline points={pts.join(" ")} fill="none" stroke={verde} strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" />}
        {ult && <circle cx={xh} cy={Y(ult.real)} r="9" fill={verde} />}
        {fat.meta ? <text x="860" y={Math.max(Y(fat.meta) - 7, 24)} fill="#c4d6d2" fontSize="26" textAnchor="end">meta {fmtMil(fat.meta)}</text> : null}
        {ult && du < N && r.projecao !== null && <text x="856" y={Y(r.projecao) + 38} fill="#c4d6d2" fontSize="26" textAnchor="end">projeção {fmtMil(r.projecao)}</text>}
        <g fill="#8fa3a0" fontSize="26" textAnchor="middle">{rotulos.map((l) => <text key={l.t + l.x} x={l.x} y="533.3" fill={l.hoje ? "#f0faf7" : undefined} fontWeight={l.hoje ? 700 : undefined}>{l.t}</text>)}</g>
        <text x="16" y="266.7" fill="#8fa3a0" fontSize="22" transform="rotate(-90 16 266.7)" textAnchor="middle">R$ mil</text>
      </svg>
    </div>
  );
}

function Faturamento({ d }: { d: Slide1Dados }) {
  const { fat, periodo } = d;
  const r = calcularRitmo(fat.real, fat.meta, periodo.diaUtil, periodo.diasUteisMes);
  const caixa: CSSProperties = { display: "flex", flexDirection: "column", gap: 3, background: "rgba(0,0,0,.22)", borderRadius: 12, padding: "14px 18px", minWidth: 0 };
  return (
    <div className="cd" style={{ background: "linear-gradient(125deg, #0f3b38 0%, #151b1e 60%)", borderColor: "#2c5a54", padding: "22px 28px", display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)", gap: 26 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <div className="row"><span className="lb nw" style={{ fontSize: 15 }}>Faturamento do mês</span>{fat.semFonteResto && <span className="mu nw" style={mu13}>Workshop + Imersão</span>}<div style={{ flex: 1 }} />
          {r.selo ? <Selo tom={r.selo.tom}>{r.selo.texto}</Selo> : <Selo tom="neutro">meta: aguardando fonte</Selo>}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="vl nw" style={{ fontSize: 93 }}>{moeda(fat.real)}</span>
          <span className="tx nw" style={{ fontSize: 22 }}>{fat.meta ? <>de <b style={{ color: "#f0faf7" }}>{moeda(fat.meta)}</b> · <b style={{ color: verde, fontSize: 26 }}>{Math.round(r.pctMeta ?? 0)}%</b></> : <Falta texto="meta do mês aguardando fonte" style={{ fontSize: 20 }} />}</span>
        </div>
        <div style={{ position: "relative", paddingBottom: 20 }}>
          {fat.meta ? (
            <>
              <div style={{ position: "relative", height: 32, background: "#232c2e", borderRadius: 16 }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, r.pctMeta ?? 0)}%`, borderRadius: 16, background: "linear-gradient(90deg,#2fa58f,#6dcfc0)" }} />
                <div style={{ position: "absolute", left: `${r.ritmoPct}%`, top: -20, bottom: -5, width: 3, background: "#f0faf7", borderRadius: 2 }} />
              </div>
              <span className="mu" style={{ position: "absolute", left: `calc(${r.ritmoPct}% - 60px)`, bottom: 0, width: 120, textAlign: "center", fontSize: 13 }}>ritmo {Math.round(r.ritmoPct)}%</span>
            </>
          ) : <div className="falta" style={{ height: 32, borderRadius: 16 }} />}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
          <div style={caixa}>
            <span className="lb nw" style={{ fontSize: 13, color: "#8fa3a0" }}>Precisa por dia útil</span>
            {r.precisaPorDia !== null ? <span className="vl nw" style={{ fontSize: 38 }}>{moeda(r.precisaPorDia)}</span>
              : fat.meta && r.faltam === 0 ? <span className="vl nw" style={{ fontSize: 38, color: TOM.ok.c }}>meta batida</span>
              : <span className="vl nw" style={{ fontSize: 38, color: "#7d908d" }}>—</span>}
            <span className="mu nw" style={{ fontSize: 14 }}>{fat.meta ? `média até hoje ${moeda(r.mediaAteHoje)}` : "meta aguardando fonte"}</span>
          </div>
          <div style={caixa}>
            <span className="lb nw" style={{ fontSize: 13, color: "#8fa3a0" }}>Projeção do mês</span>
            <span className="vl nw" style={{ fontSize: 38 }}>{moeda(r.projecao ?? 0)}</span>
            <span className="mu nw" style={{ fontSize: 14 }}>{r.projecaoPct !== null ? `${Math.round(r.projecaoPct)}% · faltam ${moeda(r.faltam ?? 0)}` : "no ritmo atual do mês"}</span>
          </div>
        </div>
      </div>
      <Grafico d={d} />
    </div>
  );
}

// ---------------- distribuicao por produto ----------------
function Rosca({ produtos, total }: { produtos: Produto[]; total: number }) {
  const C = 628.3; let off = 0;
  const fatias = total > 0 ? produtos.filter((p) => (p.valor ?? 0) > 0).map((p) => { const len = ((p.valor ?? 0) / total) * C; const f = { cor: p.cor, len: Math.max(len - 4, 0), off }; off += len; return f; }) : [];
  return (
    <svg viewBox="0 0 260 260" style={{ flex: "none", width: 250, height: 250 }} role="img" aria-label="Distribuição da receita do mês por produto">
      <circle cx="130" cy="130" r="100" fill="none" stroke="#1d2628" strokeWidth="40" />
      {fatias.map((f) => <circle key={f.cor} cx="130" cy="130" r="100" fill="none" stroke={f.cor} strokeWidth="40" strokeDasharray={`${f.len} ${C - f.len}`} strokeDashoffset={-f.off} transform="rotate(-90 130 130)" />)}
      <text x="130" y="128" textAnchor="middle" fill="#f0faf7" fontSize="30" fontWeight="800">{moeda(total).replace(" mil", "").replace(" mi", "")}</text>
      <text x="130" y="156" textAnchor="middle" fill="#8fa3a0" fontSize="17">{total >= 1_000_000 ? "mi" : total >= 1000 ? "mil" : "reais"} no mês</text>
    </svg>
  );
}

function LinhaProduto({ p, total, ritmoPct }: { p: Produto; total: number; ritmoPct: number }) {
  const tom = p.pctMeta === null ? null : tomPorDiferenca(p.pctMeta - ritmoPct);
  const wl = p.winloss;
  const wlPct = wl && wl.ganhos + wl.perdidos > 0 ? Math.round((wl.ganhos / (wl.ganhos + wl.perdidos)) * 100) : null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "14px minmax(0,1fr) auto", columnGap: 10, rowGap: 3, alignItems: "center", padding: "6px 0", borderBottom: "1px solid #222b2c" }}>
      <span style={{ gridRow: "span 3", alignSelf: "start", marginTop: 5, width: 14, height: 14, borderRadius: 4, background: p.cor }} />
      <span className="row nw" style={{ gap: 8, alignItems: "baseline" }}>
        <span className="tx" style={{ fontSize: 18, color: "#f0faf7", fontWeight: 600 }}>{p.nome}</span>
        {p.valor !== null && total > 0 && <span className="mu" style={{ fontSize: 15, fontWeight: 600, color: "#c4d6d2" }}>{Math.round((p.valor / total) * 100)}%</span>}
      </span>
      {p.valor !== null ? <span className="vl nw" style={{ fontSize: 26, textAlign: "right" }}>{moeda(p.valor)}</span> : <span className="vl" style={{ fontSize: 26, color: "#7d908d", textAlign: "right" }}>—</span>}
      <span className="mu nw" style={mu13}>
        {p.valor === null && !p.rotuloMeta ? "aguardando fonte" : <>{p.rotuloMeta ?? ""}{p.ticket && <> · ticket <b style={{ color: "#f0faf7", fontWeight: 700 }}>{p.ticket}</b></>}</>}
      </span>
      <div className="row" style={{ justifyContent: "flex-end" }}>{tom && p.pctMeta !== null && <Selo tom={tom} style={{ fontSize: 13, padding: "2px 9px" }}>{Math.round(p.pctMeta)}% da meta</Selo>}</div>
      <div className="row" style={{ gridColumn: "2 / 4", gap: 10, marginTop: 3 }}>
        <span className="mu nw" style={mu13}>Win/loss</span>
        {wl && wlPct !== null ? (
          <>
            <span className="vl" style={{ fontSize: 16 }}>{wlPct}%</span>
            <div style={{ flex: 1, display: "flex", height: 6, borderRadius: 3, overflow: "hidden", gap: 2 }}><div style={{ flex: wl.ganhos, background: verde }} /><div style={{ flex: wl.perdidos, background: "#4a5654" }} /></div>
            <span className="nw" style={{ fontSize: 13, fontWeight: 600, color: "#8fa3a0" }}>✖ {wl.perdidos} perdidos</span>
          </>
        ) : (
          <>
            <span className="vl" style={{ fontSize: 16, color: "#7d908d" }}>—</span>
            <div style={{ flex: 1, height: 6, borderRadius: 3, border: "1px dashed #3a4544" }} />
            <span className="mu nw" style={mu13}>aguardando fonte</span>
          </>
        )}
      </div>
    </div>
  );
}

function Distribuicao({ d }: { d: Slide1Dados }) {
  const ritmo = calcularRitmo(d.fat.real, d.fat.meta, d.periodo.diaUtil, d.periodo.diasUteisMes).ritmoPct;
  const total = d.produtos.reduce((s, p) => s + (p.valor ?? 0), 0);
  return (
    <div className="cd" style={{ padding: "16px 22px", display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="lb nw">Distribuição de receita por produto</span>
      <div style={{ display: "flex", alignItems: "center", gap: 28, flex: 1, minHeight: 0 }}>
        <Rosca produtos={d.produtos} total={total} />
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>{d.produtos.map((p) => <LinhaProduto key={p.chave} p={p} total={total} ritmoPct={ritmo} />)}</div>
      </div>
      <span className="mu nw" style={mu13}>% da meta: verde no ritmo · âmbar até 10 pts abaixo · vermelho mais de 10</span>
    </div>
  );
}

// ---------------- funil ----------------
const Seta = ({ rotulo }: { rotulo: string | null }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 14 }}>
    <svg width="12" height="14" viewBox="0 0 12 20" aria-hidden="true"><path d="M6 1v15M1 12l5 6 5-6" fill="none" stroke={verde} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    <span className="st nw" style={{ color: verde, background: "#12302d", fontSize: 13, padding: "0 9px", lineHeight: "16px" }}>{rotulo ?? "—"}</span>
  </div>
);
function Funil({ d }: { d: Slide1Dados }) {
  const tile: CSSProperties = { background: "rgba(0,0,0,.22)", border: "1px solid #2b3433", borderRadius: 12, padding: "6px 14px", display: "flex", flexDirection: "column", gap: 3, justifyContent: "center", minWidth: 0 };
  const tileFalta: CSSProperties = { ...tile, background: "transparent", border: "1px dashed #3a4544" };
  const lbT: CSSProperties = { fontSize: 13, color: "#8fa3a0", letterSpacing: ".1em" };
  return (
    <div className="cd" style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="row"><span className="lb nw">Funil do mês</span><div style={{ flex: 1 }} /><span className="mu nw" style={mu13}>% = passagem da etapa anterior · produto: % das reuniões</span></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, flex: 1, justifyContent: "center" }}>
        {d.funil.map((e, i) => (
          <div key={e.nome} style={{ display: "contents" }}>
            {i > 0 && <Seta rotulo={e.valor === null ? null : e.passagem} />}
            <div style={{ width: `${100 - i * 7}%`, alignSelf: "center", background: e.valor === null ? "transparent" : `rgba(109,207,192,${0.07 + Math.min(i, 3) * 0.045})`, border: e.valor === null ? "1px dashed #3a4544" : `1px solid ${e.destaque || i >= 3 ? "#4fb3a5" : "#2c5a54"}`, borderRadius: 12, padding: "2px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <span className="tx nw" style={{ fontSize: 16, color: e.destaque ? "#f0faf7" : "#c4d6d2", fontWeight: e.destaque ? 700 : 500, flex: 1 }}>{e.nome}</span>
              {e.sub && e.valor !== null && <span className="mu nw" style={mu13}>{e.sub}</span>}
              {e.valor === null ? <Falta style={{ fontSize: 13 }} /> : <span className="vl nw" style={{ fontSize: 24 }}>{inteiro(e.valor)}</span>}
            </div>
          </div>
        ))}
        <div style={{ height: 14, display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="12" height="14" viewBox="0 0 12 20" aria-hidden="true"><path d="M6 1v15M1 12l5 6 5-6" fill="none" stroke={verde} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
        <div style={{ display: "flex", gap: 8 }}>
          {d.caixasProduto.map((c) => (
            <div key={c.nome} style={{ flex: 1, minWidth: 0, background: `${c.cor}38`, border: `2px solid ${c.cor}`, borderRadius: 12, padding: "5px 10px", display: "flex", flexDirection: c.valor === null ? "column" : "row", alignItems: c.valor === null ? "flex-start" : "center", gap: c.valor === null ? 0 : 6 }}>
              <span className="row" style={{ gap: 6, flex: c.valor === null ? undefined : 1 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: c.cor, flex: "none" }} /><span className="tx nw" style={{ fontSize: 14, color: "#f0faf7", fontWeight: 600 }}>{c.nome}</span></span>
              {c.valor === null ? <Falta style={{ fontSize: 13 }} /> : <><span className="vl" style={{ fontSize: 24 }}>{inteiro(c.valor)}</span><span className="mu" style={mu13}>{c.pct === null ? "—" : `${c.pct}%`}</span></>}
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.25fr) minmax(0,1fr) minmax(0,.8fr)", gap: 10 }}>
        {d.origem ? (
          <div style={tile}><span className="lb nw" style={lbT}>Origem dos leads</span>
            {([["Inbound", d.origem.inbound], ["Outbound", d.origem.outbound]] as [string, number][]).map(([nome, v]) => (
              <div key={nome} className="row"><span className="tx" style={{ fontSize: 15 }}>{nome}</span><div style={{ flex: 1 }} /><span className="vl nw" style={{ fontSize: 15 }}>{inteiro(v)} · {Math.round((v / Math.max(d.origem!.inbound + d.origem!.outbound, 1)) * 100)}%</span></div>
            ))}</div>
        ) : <div style={tileFalta}><span className="lb nw" style={lbT}>Origem dos leads</span><Falta /></div>}
        {d.negociacao ? (
          <div style={tile}><span className="lb nw" style={lbT}>Em negociação</span><span className="vl nw" style={{ fontSize: 26 }}>{moeda(d.negociacao.valor)}</span><span className="mu nw" style={mu13}>{d.negociacao.n} oportunidades</span></div>
        ) : <div style={tileFalta}><span className="lb nw" style={lbT}>Em negociação</span><Falta /></div>}
        {d.presentesImersao !== null ? (
          <div style={tile}><span className="mu nw" style={mu13}>Presentes → Imersão</span><span className="vl" style={{ fontSize: 30 }}>{d.presentesImersao}%</span></div>
        ) : <div style={tileFalta}><span className="mu nw" style={mu13}>Presentes → Imersão</span><Falta style={{ fontSize: 13 }} /></div>}
      </div>
    </div>
  );
}

// ---------------- por pessoa ----------------
function Bloco({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 4 }}><span className="tx nw" style={{ fontSize: 15 }}>{rotulo}</span>{children}</div>;
}
function RealMeta({ v, meta, rotulo }: { v: number; meta: number | null; rotulo: string }) {
  return (
    <Bloco rotulo={rotulo}>
      <div className="row nw" style={{ alignItems: "baseline", gap: 6 }}>
        <span className="vl" style={{ fontSize: 28 }}>{inteiro(v)}</span>
        {meta !== null ? <span className="mu" style={{ fontSize: 17, fontWeight: 600 }}>/ {inteiro(meta)}</span> : <span className="mu" style={mu13}>meta: aguardando fonte</span>}
      </div>
      <Trilho pct={meta ? (v / meta) * 100 : null} />
    </Bloco>
  );
}
function CartaoPessoa({ p }: { p: Pessoa }) {
  const sdr = p.tipo === "sdr";
  return (
    <div style={{ background: "rgba(0,0,0,.22)", border: "1px solid #2b3433", borderRadius: 14, padding: "12px 16px", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 4, minWidth: 0, minHeight: 0 }}>
      <div className="row" style={{ gap: 10 }}>
        {p.foto ? <img src={p.foto} alt="" className="av" style={{ width: 40, height: 40 }} /> : <span className="av" style={{ width: 40, height: 40, fontSize: 15, background: "#a7b0c2" }}>{p.sigla}</span>}
        <span className="vl nw" style={{ fontSize: 24, overflow: "hidden", textOverflow: "ellipsis" }}>{p.nome}</span><div style={{ flex: 1 }} />
        {sdr && p.contatos !== null && <span className="mu nw" style={{ fontSize: 14 }}>{inteiro(p.contatos)} contatos</span>}
      </div>
      {p.status ? <span className="row nw" style={{ gap: 7, fontSize: 15, fontWeight: 600, color: p.status.tom === "ok" || p.status.tom === "neutro" ? "#c4d6d2" : TOM[p.status.tom].c, marginTop: -2 }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: p.status.tom === "neutro" ? "#4a5654" : TOM[p.status.tom].c }} />{p.status.texto}</span> : <Falta texto="status aguardando fonte" />}
      {sdr ? (
        <>
          {p.conversas && <RealMeta v={p.conversas.v} meta={p.conversas.meta} rotulo="Conversas trocadas" />}
          {p.inscricoes && <RealMeta v={p.inscricoes.v} meta={p.inscricoes.meta} rotulo="Inscrições no workshop" />}
        </>
      ) : (
        <>
          {p.reunioes ? <RealMeta v={p.reunioes.v} meta={p.reunioes.meta} rotulo="Reuniões realizadas" /> : <Bloco rotulo="Reuniões realizadas"><Falta style={{ fontSize: 17 }} /><Trilho pct={null} /></Bloco>}
          <Bloco rotulo="Em negociação">
            {p.negociacao ? <div className="row nw" style={{ alignItems: "baseline", gap: 6 }}><span className="vl" style={{ fontSize: 28 }}>{moeda(p.negociacao.valor)}</span><span className="mu" style={{ fontSize: 16, fontWeight: 600 }}>({p.negociacao.n})</span></div> : <Falta style={{ fontSize: 17 }} />}
          </Bloco>
        </>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, background: "rgba(109,207,192,.07)", borderRadius: 10, padding: "6px 10px", margin: "0 -10px" }}>
        <div className="row"><span className="tx" style={{ fontSize: 15, color: "#f0faf7", fontWeight: 600 }}>Vendas pagas</span><div style={{ flex: 1 }} />
          <span className="mu nw" style={{ fontSize: 14 }}>nota <b style={{ color: "#f0faf7", fontWeight: 700, fontSize: 17 }}>{p.nota === null ? "—" : p.nota.toFixed(1).replace(".", ",")}</b></span></div>
        <span className="vl nw" style={{ fontSize: 34 }}>{moeda(p.vendasValor)}</span>
      </div>
      <div style={{ borderTop: "1px solid #2b3433", paddingTop: 7 }}><span className="mu nw" style={{ fontSize: 14 }}>{p.rodape}</span></div>
    </div>
  );
}
function PorPessoa({ d }: { d: Slide1Dados }) {
  const sdrs = d.pessoas.filter((p) => p.tipo === "sdr"), closers = d.pessoas.filter((p) => p.tipo === "closer");
  const cols = Math.max(d.pessoas.length, 1);
  return (
    <div className="cd" style={{ padding: "14px 20px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="row" style={{ gap: 14 }}>
        <span className="lb nw" style={{ fontSize: 15 }}>Por pessoa</span><span className="mu nw" style={{ fontSize: 14 }}>real / meta no período</span><div style={{ flex: 1 }} />
        {d.semRetorno !== null
          ? <span className="row nw" style={{ gap: 8, background: "#d92d3a", borderRadius: 999, padding: "3px 14px", boxShadow: "0 0 14px rgba(217,45,58,.55)" }}><span style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>Leads sem retorno</span><b className="vl" style={{ fontSize: 20, color: "#fff" }}>{d.semRetorno >= 100 ? "100+" : d.semRetorno}</b></span>
          : <span className="falta nw" style={{ padding: "3px 14px" }}><Falta style={{ fontSize: 14 }} texto="leads sem retorno: aguardando fonte" /></span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols},minmax(0,1fr))`, gridTemplateRows: "auto minmax(0,1fr)", columnGap: 12, rowGap: 6, flex: 1, minHeight: 0 }}>
        {sdrs.length > 0 && <span className="lb nw" style={{ gridColumn: `span ${sdrs.length}`, fontSize: 13 }}>SDRs · aquisição</span>}
        {closers.length > 0 && <span className="lb nw" style={{ gridColumn: `span ${closers.length}`, fontSize: 13 }}>Closers · conversão</span>}
        {d.pessoas.map((p) => <CartaoPessoa key={p.id} p={p} />)}
        {!d.pessoas.length && <span className="mu" style={{ gridColumn: "1 / -1" }}>Nenhum vendedor cadastrado na aba WhatsApp.</span>}
      </div>
    </div>
  );
}

// ---------------- rodape ----------------
function Rodape({ d }: { d: Slide1Dados }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${d.rodape.length},minmax(0,1fr))`, gap: 10, height: 76, flex: "none" }}>
      {d.rodape.map((c) => c.valor === null ? (
        <div key={c.rotulo} style={{ border: "1px dashed #3a4544", borderRadius: 16, padding: "8px 16px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 4, minWidth: 0 }}>
          <span className="lb nw" style={{ fontSize: 13, letterSpacing: ".08em", color: "#8fa3a0" }}>{c.rotulo}</span>
          <div className="row nw" style={{ alignItems: "baseline", gap: 8 }}><span className="vl" style={{ fontSize: 24, color: "#7d908d" }}>—</span><span className="mu" style={{ fontSize: 14 }}>aguardando fonte</span></div>
        </div>
      ) : (
        <div key={c.rotulo} className="cd" style={{ padding: "8px 16px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 4, borderRadius: 16 }}>
          <span className="lb nw" style={{ fontSize: 13, letterSpacing: ".08em" }}>{c.rotulo}</span>
          <div className="row nw" style={{ alignItems: "baseline", gap: 8 }}>
            <span className="vl" style={{ fontSize: 25, color: c.tom ? TOM[c.tom].c : "#f0faf7" }}>{c.valor}</span>
            {c.sub && <span className="mu" style={{ fontSize: 14 }}>{c.sub}</span>}
            {c.selo && <Selo tom={c.selo.tom} style={{ fontSize: 13, padding: "2px 8px" }}>{c.selo.texto}</Selo>}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Slide1({ dados, idx, total, seg }: { dados: Slide1Dados; idx: number; total: number; seg: number }) {
  const [esc, setEsc] = useState<number | null>(null);
  useEffect(() => {
    const f = () => setEsc(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    f(); window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return (
    <div className="s1" style={{ position: "fixed", inset: 0, zIndex: 30, background: "#0c1212", overflow: "hidden" }}>
      <style>{CSS}</style>
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 1920, height: 1080, transform: `translate(-50%,-50%) scale(${esc ?? 1})`, visibility: esc ? "visible" : "hidden", padding: "22px 30px", background: "radial-gradient(1400px 700px at 0 0, rgba(28,71,70,.45), rgba(0,0,0,0) 60%), #0c1212", display: "flex", flexDirection: "column", gap: 14 }}>
        <Cabecalho d={dados} idx={idx} total={total} seg={seg} />
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)", gap: 14, flex: 1, minHeight: 0 }}>
          <Faturamento d={dados} />
          <Distribuicao d={dados} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.68fr)", gap: 14, flex: 1.05, minHeight: 0 }}>
          <Funil d={dados} />
          <PorPessoa d={dados} />
        </div>
        <Rodape d={dados} />
      </div>
    </div>
  );
}

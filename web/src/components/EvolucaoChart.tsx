"use client";
import { useEffect, useRef, useState } from "react";

export type Ponto = { contatadas: number; respostas: number; ligacoes: number; agendados: number; nota: number | null };
export type Serie = { id: string; nome: string; cor: string; pontos: Ponto[] };

const METRICAS: { chave: keyof Ponto; rotulo: string }[] = [
  { chave: "contatadas", rotulo: "Contatadas" }, { chave: "respostas", rotulo: "Respostas" },
  { chave: "ligacoes", rotulo: "Ligações" }, { chave: "agendados", rotulo: "Agendados" }, { chave: "nota", rotulo: "Nota média" },
];
const fmt = (v: number | null, nota: boolean) => (v == null ? "—" : nota ? v.toFixed(1).replace(".", ",") : String(v));
const ddmm = (d: string) => d.slice(8, 10) + "/" + d.slice(5, 7);

// Evolucao por dia: uma linha por SDR, metrica escolhida nas abas, linha vertical que segue o mouse com todos os valores
export default function EvolucaoChart({ dias, series }: { dias: string[]; series: Serie[] }) {
  const [metrica, setMetrica] = useState<keyof Ponto>("contatadas");
  const [tabela, setTabela] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(800);
  useEffect(() => {
    const el = caixa.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.round(e.contentRect.width))));
    ro.observe(el); return () => ro.disconnect();
  }, []);

  const ehNota = metrica === "nota";
  const H = 260, m = { t: 16, r: series.length <= 4 ? 96 : 16, b: 28, l: 36 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const valores = series.flatMap((s) => s.pontos.map((p) => p[metrica])).filter((v): v is number => v != null);
  const maxV = ehNota ? 10 : Math.max(4, ...valores);
  const passo = maxV <= 4 ? 1 : Math.ceil(maxV / 4);
  const topo = ehNota ? 10 : passo * Math.ceil(maxV / passo);
  const ticks = Array.from({ length: Math.floor(topo / passo) + 1 }, (_, i) => i * passo);
  const x = (i: number) => m.l + (dias.length === 1 ? iw / 2 : (i * iw) / (dias.length - 1));
  const y = (v: number) => m.t + ih - (v / topo) * ih;
  const cadaX = Math.max(1, Math.ceil(dias.length / Math.max(2, Math.floor(iw / 64))));

  // caminho com quebras onde nao ha valor (nota de dia sem auditoria)
  const caminho = (s: Serie) => {
    let d = "", aberto = false;
    s.pontos.forEach((p, i) => { const v = p[metrica]; if (v == null) { aberto = false; return; } d += `${aberto ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; aberto = true; });
    return d;
  };
  const rotulosY = (() => {
    const it = series.map((s) => { const i = ultimo(s); return { id: s.id, y: i >= 0 ? y(s.pontos[i][metrica] as number) : -1 }; }).filter((r) => r.y >= 0).sort((a, b) => a.y - b.y);
    for (let k = 1; k < it.length; k++) if (it[k].y - it[k - 1].y < 14) it[k].y = it[k - 1].y + 14;
    return new Map(it.map((r) => [r.id, r.y]));
  })();
  function ultimo(s: Serie) { for (let i = s.pontos.length - 1; i >= 0; i--) if (s.pontos[i][metrica] != null) return i; return -1; }
  const mover = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = dias.length === 1 ? 0 : Math.round(((px - m.l) / iw) * (dias.length - 1));
    setHover(Math.min(dias.length - 1, Math.max(0, i)));
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {METRICAS.map((mt) => (
          <button key={mt.chave} onClick={() => setMetrica(mt.chave)} className={`chip !px-3 !py-1 text-sm ${metrica === mt.chave ? "chip-on" : "border-line hover:border-side-edge"}`}>{mt.rotulo}</button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-4 text-sm text-mute">
          {series.length > 1 && series.map((s) => <span key={s.id} className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: s.cor }} />{s.nome}</span>)}
          <button onClick={() => setTabela(!tabela)} className="text-brand hover:brightness-110">{tabela ? "Ver gráfico" : "Ver tabela"}</button>
        </div>
      </div>

      {tabela ? (
        <div className="max-h-[320px] overflow-auto">
          <table className="w-full"><thead><tr><th className="th">Dia</th>{series.map((s) => <th key={s.id} className="th">{s.nome}</th>)}</tr></thead>
            <tbody>{dias.map((d, i) => <tr key={d}><td className="td text-mute">{ddmm(d)}</td>{series.map((s) => <td key={s.id} className="td font-semibold">{fmt(s.pontos[i][metrica], ehNota)}</td>)}</tr>)}</tbody></table>
        </div>
      ) : (
        <div ref={caixa} className="relative">
          <svg width={W} height={H} className="block touch-none select-none" onPointerMove={mover} onPointerLeave={() => setHover(null)} role="img" aria-label={`Evolução por dia: ${METRICAS.find((x) => x.chave === metrica)?.rotulo}`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={m.l} x2={m.l + iw} y1={y(t)} y2={y(t)} stroke="#2b3433" strokeWidth={1} strokeDasharray={t === 0 ? undefined : "2 4"} />
                <text x={m.l - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="#9ba5a4">{fmt(t, false)}</text>
              </g>
            ))}
            {dias.map((d, i) => (i % cadaX === 0 || (i === dias.length - 1 && i % cadaX >= cadaX / 2)) && <text key={d} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="#9ba5a4">{ddmm(d)}</text>)}
            {hover != null && <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ih} stroke="#9ba5a4" strokeWidth={1} />}
            {series.map((s) => (
              <g key={s.id}>
                <path d={caminho(s)} fill="none" stroke={s.cor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {s.pontos.map((p, i) => p[metrica] != null && (dias.length <= 31 || hover === i) && (
                  <circle key={i} cx={x(i)} cy={y(p[metrica] as number)} r={hover === i ? 5 : 3.5} fill={s.cor} stroke="#151b1e" strokeWidth={2} />
                ))}
                {series.length <= 4 && ultimo(s) >= 0 && (
                  <text x={x(ultimo(s)) + 10} y={rotulosY.get(s.id)} dy="0.32em" fontSize={12} fontWeight={600} fill="#f0faf7">{s.nome}</text>
                )}
              </g>
            ))}
          </svg>
          {hover != null && (
            <div className="pointer-events-none absolute top-2 z-10 min-w-[150px] rounded-xl border border-line bg-[#0f1717]/95 px-3 py-2 text-sm shadow-xl"
              style={{ left: Math.min(x(hover) + 12, W - 170) }}>
              <div className="mb-1 text-xs text-mute">{ddmm(dias[hover])}</div>
              {series.map((s) => (
                <div key={s.id} className="flex items-center gap-2 py-0.5">
                  <span className="h-0.5 w-3 rounded" style={{ background: s.cor }} />
                  <b className="tabular-nums">{fmt(s.pontos[hover][metrica], ehNota)}</b><span className="text-mute">{s.nome}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

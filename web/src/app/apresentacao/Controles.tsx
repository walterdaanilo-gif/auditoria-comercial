"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const PRESETS: [string, string][] = [["hoje", "Hoje"], ["semana", "Semana atual"], ["7", "Últimos 7 dias"], ["mes", "Mês atual"], ["30", "Últimos 30 dias"], ["livre", "Personalizado"]];

// Cabecalho da apresentacao: periodo em pilula (como no painel de referencia), Atualizar e Tela cheia
export default function Controles({ p, de, ate, atualizadoEm }: { p: string; de: string; ate: string; atualizadoEm: string }) {
  const router = useRouter();
  const [preset, setPreset] = useState(p);
  const [d1, setD1] = useState(de), [d2, setD2] = useState(ate);
  useEffect(() => { setPreset(p); setD1(de); setD2(ate); }, [p, de, ate]);

  const ir = (q: Record<string, string>) => router.push("/apresentacao?" + new URLSearchParams(q));
  const trocarPreset = (v: string) => { setPreset(v); if (v !== "livre") ir({ p: v }); };
  const trocarData = (a: string, b: string) => { setD1(a); setD2(b); if (a && b) { setPreset("livre"); ir({ de: a, ate: b }); } };
  const telaCheia = () => { try { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); } catch {} };

  return (
    <>
      <div className="flex items-center gap-1 rounded-full border border-line bg-card py-1 pl-4 pr-1.5 text-sm shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)]">
        <label htmlFor="preset" className="mr-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-brand">Período</label>
        <select id="preset" value={preset} onChange={(e) => trocarPreset(e.target.value)} className="cursor-pointer rounded-full bg-transparent px-2 py-1 font-semibold text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand">
          {PRESETS.map(([v, t]) => <option key={v} value={v} className="bg-card">{t}</option>)}
        </select>
        <span className="flex items-center gap-1 border-l border-line pl-2">
          <input type="date" aria-label="Data inicial" value={d1} onChange={(e) => trocarData(e.target.value, d2)} className="w-[8.6em] rounded-full bg-transparent px-1 py-1 tabular-nums text-ink outline-none [color-scheme:dark]" />
          <span className="text-mute">a</span>
          <input type="date" aria-label="Data final" value={d2} onChange={(e) => trocarData(d1, e.target.value)} className="w-[8.6em] rounded-full bg-transparent px-1 py-1 tabular-nums text-ink outline-none [color-scheme:dark]" />
        </span>
      </div>
      <div className="flex items-center gap-2 whitespace-nowrap text-sm text-mute">
        <span className="hidden xl:inline">Atualizado às {atualizadoEm}</span>
        <button onClick={() => router.refresh()} className="rounded-full border border-line bg-card px-4 py-1.5 font-semibold text-ink hover:border-brand">Atualizar</button>
        <button onClick={telaCheia} className="rounded-full bg-gradient-to-r from-[#86dccd] to-[#5fbcae] px-4 py-1.5 font-bold text-bg hover:brightness-110">Tela cheia</button>
      </div>
    </>
  );
}

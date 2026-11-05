"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

const PRESETS: [string, string][] = [["mes", "Mês atual"], ["semana", "Semana atual"], ["hoje", "Hoje"], ["livre", "Datas livres"]];

// Seletor do periodo na tela da TV (Visao geral). Troca o endereco (?p=... ou ?de=...&ate=...) e a tela recalcula no servidor.
// O endereco guarda a escolha: o refresh automatico da TV continua no mesmo periodo.
export default function PeriodoSeletor({ p, de, ate, detalhe }: { p: string; de: string; ate: string; detalhe: string }) {
  const router = useRouter();
  const caminho = usePathname();
  const inicial = PRESETS.some(([v]) => v === p) ? p : "livre"; // "7" e "30" (atalhos antigos) aparecem como datas livres
  const [preset, setPreset] = useState(inicial);
  const [d1, setD1] = useState(de), [d2, setD2] = useState(ate);
  useEffect(() => { setPreset(inicial); setD1(de); setD2(ate); }, [inicial, de, ate]);

  const ir = (q: Record<string, string>) => router.push(`${caminho}?${new URLSearchParams(q)}`);
  const trocarPreset = (v: string) => { setPreset(v); if (v !== "livre") ir({ p: v }); };
  const trocarData = (a: string, b: string) => { setD1(a); setD2(b); if (a && b) ir({ de: a <= b ? a : b, ate: a <= b ? b : a }); };

  return (
    <div className="row cd" style={{ borderRadius: 999, padding: "10px 24px", gap: 14 }}>
      <label htmlFor="vg-periodo" className="lb nw" style={{ fontSize: 15 }}>Período</label>
      <select id="vg-periodo" value={preset} onChange={(e) => trocarPreset(e.target.value)} aria-label="Período mostrado na TV"
        style={{ cursor: "pointer", fontWeight: 700, fontSize: 21, borderRadius: 8, padding: "2px 4px" }}>
        {PRESETS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
      {preset === "livre" && (
        <span className="row" style={{ gap: 8 }}>
          <input type="date" aria-label="Data inicial" value={d1} max={d2 || undefined} onChange={(e) => trocarData(e.target.value, d2)} style={{ fontSize: 18, fontVariantNumeric: "tabular-nums", colorScheme: "light" }} />
          <span className="mu">a</span>
          <input type="date" aria-label="Data final" value={d2} min={d1 || undefined} onChange={(e) => trocarData(d1, e.target.value)} style={{ fontSize: 18, fontVariantNumeric: "tabular-nums", colorScheme: "light" }} />
        </span>
      )}
      <span className="mu nw">{detalhe}</span>
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";

// Barra de % da meta que vai enchendo: anima do zero ao abrir e desliza quando o numero sobe (atualizacao em tempo real).
// Enquanto falta, listras correm dentro da barra; bateu a meta, fica verde com o check.
export default function BarraMeta({ feito, alvo, grande = false }: { feito: number; alvo: number; grande?: boolean }) {
  const pct = alvo > 0 ? Math.round((feito / alvo) * 100) : 0;
  const [largura, setLargura] = useState(0);
  useEffect(() => { const t = setTimeout(() => setLargura(Math.min(100, pct)), 60); return () => clearTimeout(t); }, [pct]);
  const ok = pct >= 100;
  return (
    <div className={`relative overflow-hidden rounded-full bg-track ${grande ? "h-[1.9em]" : "h-5"}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${feito} de ${alvo} (${pct}%)`}>
      <div className={`h-full rounded-full transition-[width] duration-[1400ms] ease-out ${ok ? "bg-ok" : "barra-carregando bg-brand"}`} style={{ width: `${largura}%` }} />
      <span className={`absolute inset-y-0 flex items-center font-extrabold tabular-nums ${grande ? "text-[0.95em]" : "text-xs"} ${largura >= 18 ? "text-[#0f1416]" : "text-ink"}`}
        style={largura >= 18 ? { right: `calc(${100 - largura}% + 0.6em)` } : { left: `calc(${largura}% + 0.6em)` }}>
        {ok ? `✓ ${pct}%` : `${pct}%`}
      </span>
    </div>
  );
}

"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { LayoutDashboard, MonitorPlay } from "lucide-react";

// Abas do Painel: "Painel" (operacao) e "Apresentacao" (tela de TV).
// Um clique em Apresentacao ja entra em tela cheia no modo slides, mantendo o periodo escolhido; Painel (ou Esc) sai.
export default function AbasPainel({ atual }: { atual: "painel" | "apresentacao" }) {
  const router = useRouter();
  const sp = useSearchParams();
  const periodo = () => {
    const q = new URLSearchParams();
    for (const k of ["p", "de", "ate"]) { const v = sp.get(k); if (v) q.set(k, v); }
    return q.toString() ? "?" + q.toString() : "";
  };
  const apresentar = async () => {
    try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); } catch {}
    // entra direto no modo slides: quadro por quadro em tela cheia
    const q = periodo();
    router.push("/apresentacao" + (q ? q + "&slides=1" : "?slides=1"));
  };
  const voltar = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); } catch {}
    router.push("/" + periodo());
  };
  const aba = (on: boolean) => `flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition ${on ? "bg-brand text-bg" : "text-mute hover:text-ink"}`;
  return (
    <div role="tablist" aria-label="Visão do painel" className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-card p-1">
      <button role="tab" aria-selected={atual === "painel"} onClick={atual === "painel" ? undefined : voltar} className={aba(atual === "painel")}><LayoutDashboard size={15} />Painel</button>
      <button role="tab" aria-selected={atual === "apresentacao"} onClick={atual === "apresentacao" ? undefined : apresentar} className={aba(atual === "apresentacao")} title="Abre em tela cheia"><MonitorPlay size={15} />Apresentação</button>
    </div>
  );
}

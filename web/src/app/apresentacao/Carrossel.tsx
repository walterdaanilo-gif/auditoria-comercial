"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import Slide1 from "./slide1/Slide1";
import type { Slide1Dados } from "./slide1/calc";
import { ChevronLeft, ChevronRight, LayoutGrid, Pause, Play, Presentation } from "lucide-react";

const TEMPOS = [10, 20, 30, 60];
const TEMPO_GERAL = 60; // a visao geral fica 1 minuto; os outros quadros, o tempo escolhido (padrao 20s)

// Modo slides da Apresentacao: em tela cheia, mostra a visao geral e depois cada quadro sozinho e grande,
// passando sozinho (visao geral 1 min, cada quadro 20s por padrao). Setas do teclado navegam, espaco pausa.
export default function Carrossel({ geral, slides, slide1 = null }: { geral: ReactNode; slides: { titulo: string; no: ReactNode }[]; slide1?: Slide1Dados | null }) {
  const sp = useSearchParams();
  const [ligado, setLigado] = useState(sp.get("slides") === "1");
  const [idx, setIdx] = useState(0);
  const [pausado, setPausado] = useState(false);
  const [seg, setSeg] = useState(20);
  useEffect(() => { try { const v = Number(localStorage.getItem("slides-seg")); if (TEMPOS.includes(v)) setSeg(v); } catch {} }, []);
  useEffect(() => { if (sp.get("slides") === "1") setLigado(true); }, [sp]);

  const todos = [{ titulo: "Visão geral", no: geral }, ...slides];
  const ir = useCallback((d: number) => setIdx((i) => (i + d + todos.length) % todos.length), [todos.length]);

  useEffect(() => {
    if (!ligado || pausado) return;
    const t = setTimeout(() => ir(1), (idx === 0 && !slide1 ? TEMPO_GERAL : seg) * 1000);
    return () => clearTimeout(t);
  }, [ligado, pausado, seg, idx, ir, slide1]);

  useEffect(() => {
    if (!ligado) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key === "ArrowRight") ir(1);
      else if (e.key === "ArrowLeft") ir(-1);
      else if (e.key === " ") { e.preventDefault(); setPausado((p) => !p); }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [ligado, ir]);

  const trocarTempo = (v: number) => { setSeg(v); try { localStorage.setItem("slides-seg", String(v)); } catch {} };
  const atual = todos[idx] ?? todos[0];
  const dur = idx === 0 && !slide1 ? TEMPO_GERAL : seg;
  const so1 = idx === 0 && !!slide1; // slide 1 novo: tela limpa, sem botoes (teclado continua: setas e espaco)
  const botao = "flex h-[2.1em] w-[2.1em] items-center justify-center rounded-full text-ink hover:bg-white/10";

  if (!ligado) return (
    <>
      {geral}
      <button onClick={() => { setIdx(0); setPausado(false); setLigado(true); }} className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-line bg-card/90 px-4 py-2 text-sm font-semibold text-ink shadow-lg backdrop-blur hover:border-brand">
        <Presentation size={16} />Modo slides
      </button>
    </>
  );

  return (
    <>
      {/* slide atual: a visao geral como e, ou um quadro sozinho ocupando tudo, com letra maior */}
      {so1 ? <Slide1 dados={slide1!} idx={idx} total={todos.length} seg={seg} /> : idx === 0 ? geral : (
        <div key={idx} className="flex min-h-[70vh] flex-1 animate-[aparecer_.5s_ease] flex-col [&>section]:flex-1" style={{ fontSize: "1.45em" }}>
          {atual.no}
        </div>
      )}

      {/* controles */}
      {!so1 && <div className="fixed bottom-4 right-4 z-40 flex items-center gap-1 rounded-full border border-line bg-card/90 px-2 py-1 text-[13px] shadow-lg backdrop-blur">
        <button onClick={() => ir(-1)} className={botao} aria-label="Quadro anterior"><ChevronLeft size={18} /></button>
        <button onClick={() => setPausado((p) => !p)} className={botao} aria-label={pausado ? "Continuar" : "Pausar"}>{pausado ? <Play size={16} /> : <Pause size={16} />}</button>
        <button onClick={() => ir(1)} className={botao} aria-label="Próximo quadro"><ChevronRight size={18} /></button>
        <span className="mx-2 flex items-center gap-1.5">
          {todos.map((t, i) => <button key={t.titulo} onClick={() => setIdx(i)} aria-label={t.titulo} title={t.titulo} className={`h-2 rounded-full transition-all ${i === idx ? "w-5 bg-brand" : "w-2 bg-mute/50 hover:bg-mute"}`} />)}
        </span>
        <span className="hidden whitespace-nowrap text-mute sm:inline">{idx + 1}/{todos.length} · {atual.titulo}</span>
        <select value={seg} onChange={(e) => trocarTempo(Number(e.target.value))} aria-label="Tempo de cada quadro (a visão geral fica 1 minuto)" title="Tempo de cada quadro (a visão geral fica 1 minuto)" className="ml-2 cursor-pointer rounded-full bg-transparent px-1 text-mute outline-none">
          {TEMPOS.map((t) => <option key={t} value={t} className="bg-card">{t}s por quadro</option>)}
        </select>
        <button onClick={() => setLigado(false)} className={botao} aria-label="Sair do modo slides" title="Sair do modo slides"><LayoutGrid size={16} /></button>
      </div>}

      {/* barra de tempo do quadro atual */}
      {!pausado && !so1 && <div key={`barra-${idx}-${dur}`} className="fixed inset-x-0 bottom-0 z-40 h-[3px] origin-left bg-brand" style={{ animation: `tempo-slide ${dur}s linear forwards` }} />}
      <style>{`@keyframes tempo-slide{from{transform:scaleX(0)}to{transform:scaleX(1)}}@keyframes aparecer{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}`}</style>
    </>
  );
}

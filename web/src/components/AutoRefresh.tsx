"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Atualizar a tela: SO quando a pessoa clica (economia de consumo do banco, pedido da gestao em 16/11/2026).
// Nada de recarregar sozinho nem de ouvir o banco em tempo real. A excecao e "auto": usado so enquanto um
// WhatsApp esta conectando (QR), para a tela mostrar o QR novo sem a pessoa ficar clicando.
export default function AutoRefresh({ segundos = 0, auto = false }: { segundos?: number; tabelas?: string[]; auto?: boolean }) {
  const router = useRouter();
  const [girando, setGirando] = useState(false);
  useEffect(() => {
    if (!auto || !segundos) return;
    const id = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, segundos * 1000);
    return () => clearInterval(id);
  }, [router, segundos, auto]);
  if (auto) return null;
  const atualizar = () => { setGirando(true); router.refresh(); setTimeout(() => setGirando(false), 1500); };
  return (
    <button type="button" onClick={atualizar} title="Buscar os dados mais novos"
      className="fixed bottom-5 right-5 z-40 rounded-full border border-line bg-card px-4 py-2 text-sm font-semibold text-ink shadow-lg hover:border-brand">
      <span className={girando ? "inline-block animate-spin" : "inline-block"}>↻</span> Atualizar
    </button>
  );
}

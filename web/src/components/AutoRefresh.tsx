"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Atualiza a tela sozinha: na hora em que a IA grava uma auditoria ou entra ligacao ou mensagem nova
// (Supabase Realtime, respeitando a RLS de quem esta logado) e, por garantia, a cada N segundos.
export default function AutoRefresh({ segundos = 60, tabelas = ["auditorias", "ligacoes", "conversas"] }: { segundos?: number; tabelas?: string[] }) {
  const router = useRouter();
  const chave = tabelas.join(",");
  useEffect(() => {
    let espera: ReturnType<typeof setTimeout> | undefined;
    // varias mudancas juntas (ex.: rodada de auditoria) viram uma atualizacao so
    const atualizar = () => { clearTimeout(espera); espera = setTimeout(() => { if (document.visibilityState === "visible") router.refresh(); }, 1500); };
    const id = setInterval(atualizar, segundos * 1000);
    const supabase = createClient();
    const canal = chave ? supabase.channel(`tela-${chave}-${Math.random().toString(36).slice(2)}`) : null;
    if (canal) {
      for (const t of chave.split(",")) canal.on("postgres_changes", { event: "*", schema: "public", table: t }, atualizar);
      canal.subscribe();
    }
    const voltou = () => { if (document.visibilityState === "visible") atualizar(); };
    document.addEventListener("visibilitychange", voltou);
    return () => { clearInterval(id); clearTimeout(espera); document.removeEventListener("visibilitychange", voltou); if (canal) supabase.removeChannel(canal); };
  }, [router, segundos, chave]);
  return null;
}

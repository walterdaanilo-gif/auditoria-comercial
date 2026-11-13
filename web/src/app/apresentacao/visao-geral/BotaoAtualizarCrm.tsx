"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { buscarCrmAgora, statusBuscaCrm } from "../actions";

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

// "Atualizar do CRM" no cabecalho da TV: busca agora as vendas no CRM (sem esperar a rodada de 3 min) e recarrega a tela
export default function BotaoAtualizarCrm() {
  const router = useRouter();
  const [estado, setEstado] = useState<"parado" | "buscando" | "ok" | "erro">("parado");

  async function buscar() {
    setEstado("buscando");
    try {
      const r = await buscarCrmAgora();
      if (!r.id) { setEstado("erro"); return; }
      let st: Awaited<ReturnType<typeof statusBuscaCrm>> = { pronto: false };
      for (let i = 0; i < 40 && !st.pronto; i++) { await espera(4000); st = await statusBuscaCrm(r.id); }
      if (st.pulou) await espera(45000); // outra busca ja estava rodando: espera ela terminar
      router.refresh();
      setEstado(st.pronto && (st.ok || st.pulou) ? "ok" : "erro");
    } catch {
      setEstado("erro");
    }
    setTimeout(() => setEstado((e) => (e === "buscando" ? e : "parado")), 6000);
  }

  const texto = { parado: "↻ Atualizar do CRM", buscando: "Buscando no CRM…", ok: "✓ Atualizado", erro: "Tente de novo" }[estado];
  return (
    <button type="button" onClick={buscar} disabled={estado === "buscando"} className="bt nw" aria-live="polite"
      title="Busca agora as vendas no CRM, sem esperar a atualização automática" style={estado === "buscando" ? { opacity: 0.7, cursor: "wait" } : undefined}>
      {texto}
    </button>
  );
}

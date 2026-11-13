"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { buscarCrmAgora, statusBuscaCrm } from "./actions";

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Atualizar do CRM: busca agora as vendas no CRM (sem esperar a rodada de 3 min) e recarrega a lista
export default function BuscarCrm() {
  const router = useRouter();
  const [estado, setEstado] = useState<"parado" | "buscando">("parado");
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  async function buscar() {
    setEstado("buscando"); setMsg(null);
    try {
      const r = await buscarCrmAgora();
      if (!r.id) { setMsg({ ok: false, t: r.erro ?? "Não deu para buscar agora." }); return; }
      let st: Awaited<ReturnType<typeof statusBuscaCrm>> = { pronto: false };
      for (let i = 0; i < 40 && !st.pronto; i++) { await espera(4000); st = await statusBuscaCrm(r.id); }
      // outra busca ja estava rodando: espera ela terminar
      if (st.pulou) await espera(45000);
      router.refresh();
      const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      setMsg(st.pronto && (st.ok || st.pulou) ? { ok: true, t: `Atualizado do CRM às ${hora}` } : { ok: false, t: "O CRM demorou para responder. A lista atualiza sozinha em até 3 min." });
    } catch {
      setMsg({ ok: false, t: "Não deu para buscar agora. Tente de novo." });
    } finally {
      setEstado("parado");
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={buscar} disabled={estado === "buscando"} className="btn-ghost !py-2" title="Busca agora as vendas no CRM, sem esperar a atualização automática">
        <RefreshCw size={16} className={estado === "buscando" ? "animate-spin" : ""} />
        {estado === "buscando" ? "Buscando no CRM…" : "Atualizar do CRM"}
      </button>
      {msg && <span className={`text-sm ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.t}</span>}
    </div>
  );
}

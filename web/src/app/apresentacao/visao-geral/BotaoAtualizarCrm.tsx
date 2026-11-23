"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { atualizarTudoAgora, statusAtualizacao } from "../actions";

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

// "Atualizar" no cabecalho da Apresentacao: roda agora todas as rotinas que alimentam o painel (vendas e funil do CRM,
// WhatsApp, auditoria, ligacoes e follow-ups) e recarrega a tela. A tela nao atualiza sozinha: so por este botao.
export default function BotaoAtualizarCrm({ estilo }: { estilo?: string }) {
  const router = useRouter();
  const [estado, setEstado] = useState<"parado" | "buscando" | "ok" | "erro">("parado");

  async function atualizar() {
    setEstado("buscando");
    try {
      const r = await atualizarTudoAgora();
      if (!r.ids?.length) { setEstado("erro"); return; }
      // espera ate 100 s pelas rotinas; o que ainda estiver rodando termina em segundo plano e entra no proximo Atualizar
      let st = { prontos: 0, total: r.ids.length, falhas: 0 };
      for (let i = 0; i < 25 && st.prontos < st.total; i++) { await espera(4000); st = await statusAtualizacao(r.ids); }
      router.refresh();
      setEstado(st.prontos === st.total && st.falhas === 0 ? "ok" : "erro");
    } catch {
      setEstado("erro");
    }
    setTimeout(() => setEstado((e) => (e === "buscando" ? e : "parado")), 6000);
  }

  const texto = { parado: "↻ Atualizar", buscando: "Atualizando tudo…", ok: "✓ Atualizado", erro: "Atualizado em parte, tente de novo" }[estado];
  return (
    <button type="button" onClick={atualizar} disabled={estado === "buscando"} className={estilo ?? "bt nw"} aria-live="polite"
      title="Atualiza todas as informações do painel (CRM, WhatsApp, auditoria, ligações e follow-ups) e recarrega a tela" style={estado === "buscando" ? { opacity: 0.7, cursor: "wait" } : undefined}>
      {texto}
    </button>
  );
}

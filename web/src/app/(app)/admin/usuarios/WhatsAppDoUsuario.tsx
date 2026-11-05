import { Smartphone } from "lucide-react";
import QrCard from "@/components/QrCard";
import { fmtDataHora } from "@/lib/format";
import type { Instancia } from "@/lib/types";
import { conectarWhatsApp, mudarFuncao, removerWhatsApp, resetarWhatsApp } from "./whatsapp-actions";

const COR: Record<string, string> = { conectado: "text-ok", aguardando_qr: "text-warn", conectando: "text-mute", aguardando: "text-mute", desconectado: "text-bad", erro: "text-bad" };
const TXT: Record<string, string> = { conectado: "Conectado", aguardando_qr: "Aguardando leitura do QR Code", conectando: "Conectando...", aguardando: "Criando a conexão...", desconectado: "Desconectado", erro: "Erro ao conectar (veja os registros do worker ou o limite do plano da Uazapi)" };

// Conexao de WhatsApp da pessoa, dentro do cartao dela em Usuarios
export default function WhatsAppDoUsuario({ usuarioId, funcao, insts, admin, workerLigado }: { usuarioId: string; funcao?: string; insts: Instancia[]; admin: boolean; workerLigado: boolean }) {
  return (
    <div className="mt-3 space-y-3 border-t border-line/60 pt-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-2 text-sm font-semibold"><Smartphone size={16} className="text-brand" />WhatsApp</span>
        {!insts.length && <span className="text-sm text-mute">sem conexão</span>}
        {!admin && (funcao === "sdr" || funcao === "closer") && (
          <form action={mudarFuncao} className="flex items-center gap-2 text-sm">
            <input type="hidden" name="vendedor_id" value={usuarioId} />
            <span className="text-mute">Função:</span>
            {(["sdr", "closer"] as const).map((f) => (
              <button key={f} name="funcao" value={f} aria-pressed={funcao === f} className={`rounded-full border px-3 py-0.5 font-semibold ${funcao === f ? "border-brand bg-brand text-bg" : "border-line text-mute hover:text-ink"}`}>{f === "sdr" ? "SDR" : "Closer"}</button>
            ))}
          </form>
        )}
        {admin && !insts.length && <form action={conectarWhatsApp}><input type="hidden" name="vendedor_id" value={usuarioId} /><button className="btn-ghost !py-1.5">Conectar WhatsApp</button></form>}
      </div>
      {insts.map((i) => (
        <div key={i.id} className="rounded-xl border border-line/70 p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><b>{i.nome}</b><span className="text-mute">{i.numero ? ` · +${i.numero}` : ""}</span></div>
            <span className={`font-semibold ${COR[i.status] ?? ""}`}>{TXT[i.status] ?? i.status}</span>
          </div>
          {i.status === "aguardando_qr" && i.qr && <div className="mt-2"><QrCard qr={i.qr} /><p className="mt-1 text-xs text-mute">No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho. O QR renova sozinho a cada 2 minutos.</p></div>}
          {!workerLigado && i.status !== "conectado" && <p className="mt-2 text-mute">Esperando o worker ligar para gerar o QR Code.</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-mute">Atualizado {fmtDataHora(i.atualizado_em)}</span>
            {admin && (
              <span className="ml-auto flex gap-2">
                <form action={resetarWhatsApp}><input type="hidden" name="id" value={i.id} /><button className="btn-ghost !py-1">Desconectar e gerar novo QR</button></form>
                <form action={removerWhatsApp}><input type="hidden" name="id" value={i.id} /><button className="btn-ghost !py-1 text-bad">Remover conexão</button></form>
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

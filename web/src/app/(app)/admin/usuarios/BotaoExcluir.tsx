"use client";
import { Trash2, UserX } from "lucide-react";
import { apagarUsuario, desativarUsuario } from "./actions";

// Desativar (guarda o historico) e, para o dono das empresas, Apagar de vez (pede para digitar o nome)
export default function BotaoExcluir({ id, nome, podeApagar }: { id: string; nome: string; podeApagar: boolean }) {
  return (
    <div className="flex items-center gap-4">
      <form action={desativarUsuario} onSubmit={(e) => { if (!confirm(`Desativar ${nome}?\n\n${nome} sai das telas e não entra mais. Conversas e auditorias ficam guardadas e dá para reativar depois.`)) e.preventDefault(); }}>
        <input type="hidden" name="id" value={id} />
        <button className="flex items-center gap-1 text-xs text-mute hover:text-warn" title={`Desativar ${nome}`}><UserX size={13} />Desativar</button>
      </form>
      {podeApagar && (
        <form action={apagarUsuario} onSubmit={(e) => {
          const digitado = prompt(`APAGAR ${nome} DE VEZ?\n\nApaga o login, o WhatsApp, as conversas, as ligações e as auditorias de ${nome}. Não tem volta.\n\nPara confirmar, digite o nome: ${nome}`);
          if (digitado === null || digitado.trim().toLowerCase() !== nome.trim().toLowerCase()) { e.preventDefault(); if (digitado !== null) alert("O nome não confere. Nada foi apagado."); return; }
          (e.currentTarget.elements.namedItem("confirmacao") as HTMLInputElement).value = digitado;
        }}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="confirmacao" value="" />
          <button className="flex items-center gap-1 text-xs text-mute hover:text-bad" title={`Apagar ${nome} de vez`}><Trash2 size={13} />Apagar de vez</button>
        </form>
      )}
    </div>
  );
}

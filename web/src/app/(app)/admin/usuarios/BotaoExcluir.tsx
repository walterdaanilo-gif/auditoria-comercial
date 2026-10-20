"use client";
import { Trash2 } from "lucide-react";
import { excluirUsuario } from "./actions";

// Pede confirmacao antes de excluir (ou desativar, se a pessoa tiver historico)
export default function BotaoExcluir({ id, nome }: { id: string; nome: string }) {
  return (
    <form action={excluirUsuario} onSubmit={(e) => { if (!confirm(`Excluir ${nome}?\n\nSe ${nome} tiver conversas ou WhatsApp no sistema, o cadastro é só desativado (o histórico fica guardado).`)) e.preventDefault(); }}>
      <input type="hidden" name="id" value={id} />
      <button className="flex items-center gap-1 text-xs text-mute hover:text-bad" title={`Excluir ${nome}`}><Trash2 size={13} />Excluir</button>
    </form>
  );
}

"use server";
import { redirect } from "next/navigation";
import { exigirAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { contatoDoAutor, lerExportacao } from "@/lib/importarWhatsapp";

export type Resultado = { erro?: string } | null;
const MAX_MSGS = 3000;
const diaSP = (iso: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));

// Grava uma conversa exportada do WhatsApp como canal "importada". O worker audita sozinho em ate 5 minutos.
// Importadas nao entram nas metas, na atividade ao vivo nem na planilha.
export async function importarConversa(_: Resultado, fd: FormData): Promise<Resultado> {
  await exigirAdmin();
  const texto = String(fd.get("texto") || "");
  const autorSdr = String(fd.get("autor") || "");
  const vendedor_id = String(fd.get("vendedor") || "");
  if (!texto.trim()) return { erro: "Envie o arquivo .txt ou cole a conversa." };

  const { mensagens, autores } = lerExportacao(texto); // relê no servidor: nao confia no que veio do navegador
  if (!mensagens.length) return { erro: "Não reconheci nenhuma mensagem. Use o .txt de Exportar conversa (sem mídia)." };
  if (autores.length > 2) return { erro: `Essa conversa tem ${autores.length} pessoas. Importe só conversas individuais, não grupos.` };
  if (!autores.includes(autorSdr)) return { erro: "Escolha quem é o SDR na conversa." };
  if (mensagens.length > MAX_MSGS) return { erro: `Conversa muito longa (${mensagens.length} mensagens). O limite é ${MAX_MSGS}.` };
  const lead = autores.find((a) => a !== autorSdr) ?? "Lead";

  const admin = createAdminClient();
  const { data: vend } = await admin.from("profiles").select("id,papel,ativo").eq("id", vendedor_id).maybeSingle();
  if (!vend) return { erro: "Escolha o vendedor." };

  const { data: conv, error } = await admin.from("conversas").insert({
    vendedor_id, instancia_id: null, contato: contatoDoAutor(lead), contato_nome: lead, canal: "importada",
    data: diaSP(mensagens[0].quando), ultima_msg_em: mensagens[mensagens.length - 1].quando,
  }).select("id").single();
  if (error || !conv) return { erro: error?.message || "Não foi possível gravar a conversa." };

  const linhas = mensagens.map((m, i) => ({
    conversa_id: conv.id, vendedor_id, wa_id: `imp-${i + 1}`, remetente: m.autor === autorSdr ? "vendedor" : "cliente",
    texto: m.midia ? "[mídia não importada]" : m.texto, tipo: m.midia ? "outro" : "texto", enviada_em: m.quando, espelhada: true,
  }));
  for (let i = 0; i < linhas.length; i += 500) {
    const { error: e } = await admin.from("mensagens").insert(linhas.slice(i, i + 500));
    if (e) { await admin.from("conversas").delete().eq("id", conv.id); return { erro: e.message }; }
  }
  redirect(`/conversas/${conv.id}?importada=1`);
}

"use server";
import { revalidatePath } from "next/cache";
import { exigirGestor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { MODELOS } from "@/lib/mensagens";

// Grava o texto (null = padrao do sistema) e se a mensagem sai ou nao, na empresa aberta (RLS do gestor)
export async function salvarModelo(chave: string, texto: string | null, ativo: boolean): Promise<{ ok: boolean; erro?: string }> {
  await exigirGestor();
  const m = MODELOS.find((x) => x.chave === chave);
  if (!m) return { ok: false, erro: "Mensagem desconhecida." };
  const t = texto?.trim() ? texto.replace(/\r\n/g, "\n").trim() : null;
  if (t && t.length > 3000) return { ok: false, erro: "O texto pode ter no máximo 3.000 caracteres." };
  const db = await createClient();
  const { data: org } = await db.rpc("org_atual");
  if (!org) return { ok: false, erro: "Não foi possível identificar a empresa aberta." };
  const { error } = await db.from("modelos_mensagem").upsert(
    { org_id: org, chave, texto: t === m.padrao ? null : t, ativo: m.desligavel ? ativo : true, atualizado_em: new Date().toISOString() },
    { onConflict: "org_id,chave" },
  );
  if (error) return { ok: false, erro: error.message };
  revalidatePath("/configuracoes/mensagens");
  return { ok: true };
}

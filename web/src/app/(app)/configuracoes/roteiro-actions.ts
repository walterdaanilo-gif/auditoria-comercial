"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Roteiro da auditoria (a regua que a IA usa para dar a nota). Fica em config_auditoria.roteiro, por empresa.
// O worker le o roteiro do banco a cada auditoria (worker/src/auditor.js), entao a mudanca vale para as proximas auditorias.
export async function salvarRoteiro(fd: FormData): Promise<void> {
  await exigirAdmin();
  const roteiro = String(fd.get("roteiro") || "").trim();
  if (roteiro.length < 20) redirect("/configuracoes?abrir=roteiro&roteiro_erro=" + encodeURIComponent("O roteiro está muito curto"));
  const db = await createClient();
  const { data: org } = await db.rpc("org_atual");
  const { error } = await db.from("config_auditoria").update({ roteiro, atualizado_em: new Date().toISOString() }).eq("org_id", org); // RLS: so admin, so a empresa aberta
  if (error) redirect("/configuracoes?abrir=roteiro&roteiro_erro=" + encodeURIComponent(error.message));
  revalidatePath("/configuracoes");
  redirect("/configuracoes?abrir=roteiro&roteiro_ok=1");
}

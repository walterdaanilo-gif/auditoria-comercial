"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirAdmin } from "@/lib/auth";
import { createAdminClient, erroAdmin } from "@/lib/supabase/admin";

const PAPEIS = ["admin", "gestor", "vendedor"];
export type Resultado = { ok: boolean; erro?: string } | null;

// Toda acao comeca por exigirAdmin(): so admin ativo chega na service_role key
export async function criarUsuario(_: Resultado, fd: FormData): Promise<Resultado> {
  await exigirAdmin();
  const nome = String(fd.get("nome") || "").trim();
  const email = String(fd.get("email") || "").trim().toLowerCase();
  const senha = String(fd.get("senha") || "");
  const papel = String(fd.get("papel") || "vendedor");
  if (!nome || !email) return { ok: false, erro: "Preencha nome e e-mail." };
  if (senha.length < 8) return { ok: false, erro: "A senha precisa ter pelo menos 8 caracteres." };
  if (!PAPEIS.includes(papel)) return { ok: false, erro: "Papel inválido." };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome, papel } });
  if (error || !data.user) return { ok: false, erro: erroAdmin(error, "Não foi possível criar o usuário.") };
  await admin.from("profiles").upsert({ id: data.user.id, nome, email, papel, ativo: true });
  revalidatePath("/admin/usuarios");
  revalidatePath("/configuracoes");
  return { ok: true };
}

export async function atualizarUsuario(fd: FormData): Promise<void> {
  const eu = await exigirAdmin();
  const id = String(fd.get("id") || "");
  const nome = String(fd.get("nome") || "").trim();
  const papel = String(fd.get("papel") || "");
  const ativo = fd.get("ativo") === "on";
  if (!id || !nome || !PAPEIS.includes(papel)) redirect("/admin/usuarios?erro=Dados inválidos");
  if (id === eu.id && (papel !== "admin" || !ativo)) redirect("/admin/usuarios?erro=Você não pode tirar o próprio acesso de admin");

  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ nome, papel, ativo }).eq("id", id);
  if (error) redirect("/admin/usuarios?erro=" + encodeURIComponent(error.message));
  // Desativar tambem bloqueia o login no Supabase Auth
  await admin.auth.admin.updateUserById(id, { ban_duration: ativo ? "none" : "876000h", user_metadata: { nome, papel } });
  revalidatePath("/admin/usuarios");
  redirect("/admin/usuarios?ok=Usuário atualizado");
}

export async function redefinirSenha(fd: FormData): Promise<void> {
  await exigirAdmin();
  const id = String(fd.get("id") || "");
  const senha = String(fd.get("senha") || "");
  if (!id || senha.length < 8) redirect("/admin/usuarios?erro=A senha precisa ter pelo menos 8 caracteres");
  const { error } = await createAdminClient().auth.admin.updateUserById(id, { password: senha });
  if (error) redirect("/admin/usuarios?erro=" + encodeURIComponent(error.message));
  redirect("/admin/usuarios?ok=Senha redefinida");
}

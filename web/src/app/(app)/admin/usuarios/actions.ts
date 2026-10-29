"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { empresas, exigirAdmin } from "@/lib/auth";
import { createAdminClient, erroAdmin } from "@/lib/supabase/admin";
import type { Perfil } from "@/lib/types";

const PAPEIS = ["admin", "gestor", "vendedor"];
const FUNCOES = ["sdr", "closer", "gestao"]; // gestao: lidera o time (nao entra na rubrica de SDR ou Closer)
const FONTES = ["crm", "whatsapp"];
export type Resultado = { ok: boolean; erro?: string } | null;
const volta = (tipo: "ok" | "erro", msg: string): never => redirect(`/admin/usuarios?${tipo}=${encodeURIComponent(msg)}`);

// Empresas marcadas no formulario. So o dono das empresas (super admin) escolhe; o admin comum cria e edita
// sempre na empresa que esta aberta. Devolve a principal (org_id) e a lista de acesso (orgs_acesso).
async function empresasDoForm(eu: Perfil, fd: FormData, atual?: { org_id: string; orgs_acesso: string[] }) {
  const { todas, atual: aberta } = await empresas(eu);
  if (!eu.super_admin) return atual ?? { org_id: aberta!.id, orgs_acesso: [aberta!.id] };
  const marcadas = fd.getAll("orgs").map(String).filter((id) => todas.some((o) => o.id === id));
  if (!marcadas.length) return null;
  const principal = atual && marcadas.includes(atual.org_id) ? atual.org_id : marcadas.includes(aberta!.id) ? aberta!.id : marcadas[0];
  return { org_id: principal, orgs_acesso: marcadas };
}

// Toda acao comeca por exigirAdmin(): so admin ativo chega na service_role key
export async function criarUsuario(_: Resultado, fd: FormData): Promise<Resultado> {
  const eu = await exigirAdmin();
  const nome = String(fd.get("nome") || "").trim();
  const email = String(fd.get("email") || "").trim().toLowerCase();
  const senha = String(fd.get("senha") || "");
  const papel = String(fd.get("papel") || "vendedor");
  const funcao = String(fd.get("funcao") || "sdr");
  if (!nome || !email) return { ok: false, erro: "Preencha nome e e-mail." };
  if (senha.length < 8) return { ok: false, erro: "A senha precisa ter pelo menos 8 caracteres." };
  if (!PAPEIS.includes(papel) || !FUNCOES.includes(funcao)) return { ok: false, erro: "Papel ou função inválidos." };
  const orgs = await empresasDoForm(eu, fd);
  if (!orgs) return { ok: false, erro: "Marque pelo menos uma retaguarda (Weevo ou Carbone)." };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome, papel } });
  if (error || !data.user) return { ok: false, erro: erroAdmin(error, "Não foi possível criar o usuário.") };
  await admin.from("profiles").upsert({ id: data.user.id, nome, email, papel, funcao, ativo: true, ...orgs });
  revalidatePath("/admin/usuarios");
  revalidatePath("/configuracoes");
  return { ok: true };
}

export async function atualizarUsuario(fd: FormData): Promise<void> {
  const eu = await exigirAdmin();
  const id = String(fd.get("id") || "");
  const nome = String(fd.get("nome") || "").trim();
  const papel = String(fd.get("papel") || "");
  const funcao = String(fd.get("funcao") || "sdr");
  const fonte = String(fd.get("fonte_conversas") || "");
  const ativo = fd.get("ativo") === "on";
  const email = String(fd.get("email") || "").trim().toLowerCase();
  if (!id || !nome || !PAPEIS.includes(papel) || !FUNCOES.includes(funcao) || (fonte && !FONTES.includes(fonte))) volta("erro", "Dados inválidos");
  if (id === eu.id && (papel !== "admin" || !ativo)) volta("erro", "Você não pode tirar o próprio acesso de admin");

  const admin = createAdminClient();
  const { data: atual } = await admin.from("profiles").select("email,org_id,orgs_acesso").eq("id", id).maybeSingle();
  if (!atual) volta("erro", "Usuário não encontrado");
  const orgs = await empresasDoForm(eu, fd, atual!);
  if (!orgs) volta("erro", "Marque pelo menos uma retaguarda (Weevo ou Carbone)");
  // E-mail novo: troca primeiro o login (ja confirmado, sem e-mail de confirmacao); campo vazio mantem o atual
  const novoEmail = email && email !== atual!.email ? email : null;
  if (novoEmail) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(novoEmail)) volta("erro", "E-mail inválido");
    const { error: eAuth } = await admin.auth.admin.updateUserById(id, { email: novoEmail, email_confirm: true });
    if (eAuth) volta("erro", erroAdmin(eAuth, "Não foi possível trocar o e-mail."));
  }
  const { error } = await admin.from("profiles").update({ nome, papel, funcao, ativo, ...(fonte ? { fonte_conversas: fonte } : {}), ...orgs!, ...(novoEmail ? { email: novoEmail } : {}) }).eq("id", id);
  if (error) volta("erro", error.message);
  // Desativar tambem bloqueia o login no Supabase Auth
  await admin.auth.admin.updateUserById(id, { ban_duration: ativo ? "none" : "876000h", user_metadata: { nome, papel } });
  revalidatePath("/admin/usuarios"); revalidatePath("/configuracoes");
  volta("ok", novoEmail ? `Usuário atualizado. Novo login: ${novoEmail}` : "Usuário atualizado");
}

export async function redefinirSenha(fd: FormData): Promise<void> {
  await exigirAdmin();
  const id = String(fd.get("id") || "");
  const senha = String(fd.get("senha") || "");
  if (!id || senha.length < 8) volta("erro", "A senha precisa ter pelo menos 8 caracteres");
  const { error } = await createAdminClient().auth.admin.updateUserById(id, { password: senha });
  if (error) volta("erro", error.message);
  volta("ok", "Senha redefinida");
}

// Desativar: some das telas e nao entra mais, mas conversas e auditorias ficam guardadas (pode reativar depois)
export async function desativarUsuario(fd: FormData): Promise<void> {
  const eu = await exigirAdmin();
  const id = String(fd.get("id") || "");
  if (!id || id === eu.id) volta("erro", "Você não pode desativar a si mesmo");
  const admin = createAdminClient();
  const { data: p } = await admin.from("profiles").select("nome").eq("id", id).maybeSingle();
  await admin.from("profiles").update({ ativo: false }).eq("id", id);
  await admin.auth.admin.updateUserById(id, { ban_duration: "876000h" });
  revalidatePath("/admin/usuarios"); revalidatePath("/conversas"); revalidatePath("/");
  volta("ok", `${p?.nome || "Usuário"} foi desativado. O histórico ficou guardado.`);
}

// Apagar de vez (so o dono das empresas): apaga o login e, em cascata, o cadastro, o WhatsApp, as conversas,
// mensagens, ligacoes e auditorias da pessoa. A tela pede para digitar o nome antes.
export async function apagarUsuario(fd: FormData): Promise<void> {
  const eu = await exigirAdmin();
  if (!eu.super_admin) volta("erro", "Só o dono das empresas pode apagar um usuário de vez");
  const id = String(fd.get("id") || "");
  if (!id || id === eu.id) volta("erro", "Você não pode apagar a si mesmo");
  const admin = createAdminClient();
  const { data: p } = await admin.from("profiles").select("nome").eq("id", id).maybeSingle();
  if (!p) volta("erro", "Usuário não encontrado");
  if (String(fd.get("confirmacao") || "").trim().toLowerCase() !== p!.nome.trim().toLowerCase()) volta("erro", "O nome digitado não confere. Nada foi apagado.");
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) volta("erro", erroAdmin(error, "Não foi possível apagar."));
  await admin.from("profiles").delete().eq("id", id); // normalmente ja sai junto com o login
  revalidatePath("/admin/usuarios"); revalidatePath("/conversas"); revalidatePath("/");
  volta("ok", `${p!.nome} foi apagado de vez, junto com o histórico.`);
}

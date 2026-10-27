import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Organizacao, Perfil } from "@/lib/types";

// Perfil do usuario logado (ou null). A RLS garante que ele so le o proprio perfil, a menos que seja gestor/admin.
export async function getPerfil(): Promise<Perfil | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return (data as Perfil) ?? null;
}

export async function exigirPerfil(): Promise<Perfil> {
  const p = await getPerfil();
  if (!p) redirect("/login");
  if (!p!.ativo) redirect("/login?erro=inativo");
  return p!;
}
export async function exigirGestor(): Promise<Perfil> {
  const p = await exigirPerfil();
  if (p.papel === "vendedor") redirect("/");
  return p;
}
// Empresas que o usuario pode abrir (o dono das empresas abre todas) e a que esta aberta agora
export async function empresas(p: Perfil): Promise<{ todas: Organizacao[]; atual: Organizacao | null }> {
  const { data } = await createAdminClient().from("organizacoes").select("id,slug,nome").order("criado_em");
  const todas = ((data ?? []) as Organizacao[]).filter((o) => p.super_admin || o.id === p.org_id || (p.orgs_acesso ?? []).includes(o.id));
  const aberta = p.org_ativa && todas.some((o) => o.id === p.org_ativa) ? p.org_ativa : p.org_id;
  return { todas, atual: todas.find((o) => o.id === aberta) ?? null };
}

export async function exigirAdmin(): Promise<Perfil> {
  const p = await exigirPerfil();
  if (p.papel !== "admin") redirect("/");
  return p;
}

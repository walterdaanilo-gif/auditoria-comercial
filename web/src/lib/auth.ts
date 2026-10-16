import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Perfil } from "@/lib/types";

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
export async function exigirAdmin(): Promise<Perfil> {
  const p = await exigirPerfil();
  if (p.papel !== "admin") redirect("/");
  return p;
}

"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirAdmin, exigirGestor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, erroAdmin } from "@/lib/supabase/admin";

// Conexao de WhatsApp de cada pessoa, agora dentro de Usuarios (antes era a aba WhatsApp).
const volta = (tipo: "ok" | "erro", msg: string): never => redirect(`/admin/usuarios?${tipo}=${encodeURIComponent(msg)}`);
const atualizarTelas = () => { revalidatePath("/admin/usuarios"); revalidatePath("/configuracoes"); revalidatePath("/conversas"); revalidatePath("/"); };

// Vendedor so com WhatsApp (sem login): se ja existe alguem com esse nome, reaproveita; senao cria o perfil
// (com um usuario sem login, so para ligar conversas e notas a ele) e a conexao.
export async function criarVendedorWhatsApp(fd: FormData): Promise<void> {
  await exigirAdmin();
  const vendedor = String(fd.get("vendedor") || "").trim().replace(/\s+/g, " ");
  const funcao = fd.get("funcao") === "closer" ? "closer" : "sdr";
  if (!vendedor) volta("erro", "Digite o nome do vendedor");
  const admin = createAdminClient();
  const { data: existentes } = await admin.from("profiles").select("id,nome").ilike("nome", vendedor.replace(/[\\%_]/g, "\\$&"));
  let vendedor_id = existentes?.[0]?.id as string | undefined;
  if (!vendedor_id) {
    const email = `vendedor-${crypto.randomUUID().slice(0, 12)}@sem-login.invalid`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: crypto.randomUUID() + crypto.randomUUID(), email_confirm: true, user_metadata: { nome: vendedor } });
    if (error || !data.user) volta("erro", "Não consegui cadastrar o vendedor: " + erroAdmin(error, "erro desconhecido"));
    vendedor_id = data.user!.id;
    await admin.from("profiles").upsert({ id: vendedor_id, nome: vendedor, email, papel: "vendedor", ativo: true });
  }
  await admin.from("profiles").update({ funcao }).eq("id", vendedor_id);
  const { error } = await admin.from("instancias_whatsapp").insert({ vendedor_id, nome: `WhatsApp de ${vendedor}`, status: "aguardando" });
  if (error) volta("erro", error.message);
  atualizarTelas();
}

// Cria a conexao de WhatsApp para alguem que ja esta na lista de usuarios
export async function conectarWhatsApp(fd: FormData): Promise<void> {
  await exigirAdmin();
  const id = String(fd.get("vendedor_id") || "");
  const admin = createAdminClient();
  const { data: p } = await admin.from("profiles").select("id,nome").eq("id", id).maybeSingle();
  if (!p) volta("erro", "Usuário não encontrado");
  const { error } = await admin.from("instancias_whatsapp").insert({ vendedor_id: p!.id, nome: `WhatsApp de ${p!.nome}`, status: "aguardando" });
  if (error) volta("erro", error.message);
  atualizarTelas();
}

export async function mudarFuncao(fd: FormData): Promise<void> {
  await exigirGestor();
  const funcao = fd.get("funcao") === "closer" ? "closer" : "sdr";
  await createAdminClient().from("profiles").update({ funcao }).eq("id", String(fd.get("vendedor_id")));
  atualizarTelas();
}

export async function resetarWhatsApp(fd: FormData): Promise<void> {
  await exigirAdmin();
  await (await createClient()).from("instancias_whatsapp").update({ comando: "reset", qr: null, status: "conectando", atualizado_em: new Date().toISOString() }).eq("id", String(fd.get("id")));
  revalidatePath("/admin/usuarios");
}

export async function removerWhatsApp(fd: FormData): Promise<void> {
  await exigirAdmin();
  const db = await createClient();
  const { data: inst } = await db.from("instancias_whatsapp").select("vendedor_id").eq("id", String(fd.get("id"))).maybeSingle();
  await db.from("instancias_whatsapp").delete().eq("id", String(fd.get("id")));
  // vendedor criado so com WhatsApp (sem login proprio) e sem outra conexao: sai do time (fica inativo, historico preservado)
  if (inst?.vendedor_id) {
    const admin = createAdminClient();
    const [{ count }, { data: p }] = await Promise.all([
      admin.from("instancias_whatsapp").select("id", { count: "exact", head: true }).eq("vendedor_id", inst.vendedor_id),
      admin.from("profiles").select("email,papel").eq("id", inst.vendedor_id).maybeSingle(),
    ]);
    if (!count && p?.papel === "vendedor" && String(p.email || "").endsWith("@sem-login.invalid")) await admin.from("profiles").update({ ativo: false }).eq("id", inst.vendedor_id);
  }
  atualizarTelas();
}

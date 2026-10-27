import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import AuthShell from "@/components/AuthShell";
import { empresas, exigirPerfil } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Escolher retaguarda · Cabueta do Elon Musk" };

// Abre a retaguarda escolhida (so as empresas que o usuario pode acessar)
async function abrir(fd: FormData) {
  "use server";
  const p = await exigirPerfil();
  const { todas } = await empresas(p);
  const id = String(fd.get("org") || "");
  if (!todas.some((o) => o.id === id)) redirect("/empresa");
  await createAdminClient().from("profiles").update({ org_ativa: id }).eq("id", p.id);
  revalidatePath("/", "layout");
  redirect("/");
}

// Depois do login: quem tem acesso a mais de uma empresa escolhe qual retaguarda abrir; com uma so, entra direto
export default async function Empresa() {
  const p = await exigirPerfil();
  const { todas, atual } = await empresas(p);
  if (todas.length <= 1) {
    if (todas[0] && p.org_ativa !== todas[0].id) await createAdminClient().from("profiles").update({ org_ativa: todas[0].id }).eq("id", p.id);
    redirect("/");
  }
  return (
    <AuthShell titulo="Qual retaguarda?" subtitulo={`Olá, ${p.nome.split(" ")[0]}! Escolha a empresa que você quer abrir. Dá para trocar depois pelo botão no topo.`}>
      <form action={abrir} className="grid gap-4">
        {todas.map((o) => (
          <button key={o.id} name="org" value={o.id} className={`auth-btn flex items-center justify-between px-6 text-left ${o.id === atual?.id ? "" : "!bg-none !bg-white/10 !text-ink !shadow-none hover:!bg-white/20"}`}>
            <span>{o.nome}</span>{o.id === atual?.id && <span className="text-sm font-semibold opacity-80">aberta agora</span>}
          </button>
        ))}
      </form>
    </AuthShell>
  );
}

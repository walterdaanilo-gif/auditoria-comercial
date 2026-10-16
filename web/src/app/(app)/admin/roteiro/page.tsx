import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

async function salvar(fd: FormData) {
  "use server";
  await exigirAdmin();
  const roteiro = String(fd.get("roteiro") || "").trim();
  if (roteiro.length < 20) redirect("/admin/roteiro?erro=O roteiro está muito curto");
  const { error } = await (await createClient()).from("config_auditoria").update({ roteiro, atualizado_em: new Date().toISOString() }).eq("id", 1); // RLS: so admin
  if (error) redirect("/admin/roteiro?erro=" + encodeURIComponent(error.message));
  revalidatePath("/admin/roteiro");
  redirect("/admin/roteiro?ok=1");
}

export default async function Roteiro({ searchParams: searchParamsP }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const searchParams = await searchParamsP;
  await exigirAdmin();
  const { data } = await (await createClient()).from("config_auditoria").select("roteiro").eq("id", 1).single();
  return (
    <div className="max-w-3xl space-y-4">
      <div><h1 className="text-xl font-bold">Roteiro da auditoria</h1>
        <p className="text-sm text-mute">Este texto é a régua que a IA usa para dar a nota. Quanto mais claro, mais justa a nota. A mudança vale para as próximas auditorias.</p></div>
      {searchParams.erro && <p className="card border-bad text-sm text-bad">{searchParams.erro}</p>}
      {searchParams.ok && <p className="card border-ok text-sm text-ok">Roteiro salvo.</p>}
      <form action={salvar} className="space-y-3">
        <textarea name="roteiro" defaultValue={data?.roteiro ?? ""} rows={22} className="input font-mono" />
        <button className="btn">Salvar roteiro</button>
      </form>
    </div>
  );
}

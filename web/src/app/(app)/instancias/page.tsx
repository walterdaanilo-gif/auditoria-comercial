import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import AutoRefresh from "@/components/AutoRefresh";
import { exigirAdmin, exigirGestor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDataHora } from "@/lib/format";
import type { Instancia } from "@/lib/types";
import QrCard from "./QrCard";

export const dynamic = "force-dynamic";

async function criar(fd: FormData) {
  "use server";
  await exigirAdmin();
  const vendedor_id = String(fd.get("vendedor") || ""); const nome = String(fd.get("nome") || "").trim();
  if (!vendedor_id || !nome) redirect("/instancias?erro=Escolha o vendedor e dê um nome");
  const { error } = await (await createClient()).from("instancias_whatsapp").insert({ vendedor_id, nome, status: "aguardando" }); // RLS: so admin
  if (error) redirect("/instancias?erro=" + encodeURIComponent(error.message));
  revalidatePath("/instancias");
}
async function resetar(fd: FormData) {
  "use server";
  await exigirAdmin();
  await (await createClient()).from("instancias_whatsapp").update({ comando: "reset", qr: null, status: "conectando" }).eq("id", String(fd.get("id")));
  revalidatePath("/instancias");
}
async function remover(fd: FormData) {
  "use server";
  await exigirAdmin();
  await (await createClient()).from("instancias_whatsapp").delete().eq("id", String(fd.get("id")));
  revalidatePath("/instancias");
}

const COR: Record<string, string> = { conectado: "text-ok", aguardando_qr: "text-warn", conectando: "text-mute", aguardando: "text-mute", desconectado: "text-bad", erro: "text-bad" };
const TXT: Record<string, string> = { conectado: "Conectado", aguardando_qr: "Aguardando leitura do QR Code", conectando: "Conectando...", aguardando: "Aguardando o worker", desconectado: "Desconectado", erro: "Erro" };

export default async function Instancias({ searchParams: searchParamsP }: { searchParams: Promise<{ erro?: string }> }) {
  const searchParams = await searchParamsP;
  const perfil = await exigirGestor();
  const supabase = await createClient();
  const [{ data }, { data: perfis }] = await Promise.all([
    supabase.from("instancias_whatsapp").select("*").order("criado_em"),
    supabase.from("profiles").select("id,nome,papel").eq("ativo", true).order("nome"),
  ]);
  const nomes = new Map<string, string>((perfis ?? []).map((x: any) => [x.id, x.nome]));
  const insts = (data ?? []) as Instancia[];

  return (
    <div className="space-y-5">
      <AutoRefresh segundos={5} />
      <div><h1 className="page-title">WhatsApp conectado</h1>
        <p className="page-sub">Cada vendedor lê o QR Code no celular dele: WhatsApp → Aparelhos conectados → Conectar um aparelho. O QR renova sozinho.</p></div>
      {searchParams.erro && <p className="card border-bad text-sm text-bad">{searchParams.erro}</p>}
      {perfil.papel === "admin" && (
        <form action={criar} className="card grid gap-3 md:grid-cols-4">
          <div><label className="label">Vendedor</label><select name="vendedor" className="input" required>{(perfis ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></div>
          <div><label className="label">Nome da conexão</label><input name="nome" className="input" placeholder="Ex.: WhatsApp do Ruan" required /></div>
          <div className="flex items-end"><button className="btn">Adicionar conexão</button></div>
        </form>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {insts.map((i) => (
          <div key={i.id} className="card space-y-2">
            <div className="flex items-start justify-between"><div><b>{i.nome}</b><div className="page-sub">{nomes.get(i.vendedor_id) ?? "—"}{i.numero ? ` · +${i.numero}` : ""}</div></div>
              <span className={`text-sm font-semibold ${COR[i.status] ?? ""}`}>{TXT[i.status] ?? i.status}</span></div>
            {i.status === "aguardando_qr" && i.qr && <QrCard qr={i.qr} />}
            <div className="text-xs text-mute">Atualizado {fmtDataHora(i.atualizado_em)}</div>
            {perfil.papel === "admin" && (
              <div className="flex gap-2">
                <form action={resetar}><input type="hidden" name="id" value={i.id} /><button className="btn-ghost">Desconectar e gerar novo QR</button></form>
                <form action={remover}><input type="hidden" name="id" value={i.id} /><button className="btn-ghost text-bad">Remover</button></form>
              </div>
            )}
          </div>
        ))}
        {!insts.length && <p className="page-sub">Nenhuma conexão ainda.</p>}
      </div>
    </div>
  );
}

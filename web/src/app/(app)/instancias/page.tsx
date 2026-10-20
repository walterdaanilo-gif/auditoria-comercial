import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import AutoRefresh from "@/components/AutoRefresh";
import { exigirAdmin, exigirGestor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, erroAdmin } from "@/lib/supabase/admin";
import { fmtDataHora } from "@/lib/format";
import type { Instancia } from "@/lib/types";
import QrCard from "./QrCard";

export const dynamic = "force-dynamic";

// O cadastro do vendedor acontece aqui: nome + funcao. Se ja existe alguem com esse nome, reaproveita;
// senao cria o perfil (com um usuario sem login, so para ligar conversas e notas a ele).
async function criar(fd: FormData) {
  "use server";
  await exigirAdmin();
  const vendedor = String(fd.get("vendedor") || "").trim().replace(/\s+/g, " ");
  const funcao = fd.get("funcao") === "closer" ? "closer" : "sdr";
  if (!vendedor) redirect("/instancias?erro=Digite o nome do vendedor");
  const admin = createAdminClient();
  const { data: existentes } = await admin.from("profiles").select("id,nome").ilike("nome", vendedor.replace(/[\\%_]/g, "\\$&"));
  let vendedor_id = existentes?.[0]?.id as string | undefined;
  if (!vendedor_id) {
    const email = `vendedor-${crypto.randomUUID().slice(0, 12)}@sem-login.invalid`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: crypto.randomUUID() + crypto.randomUUID(), email_confirm: true, user_metadata: { nome: vendedor } });
    if (error || !data.user) redirect("/instancias?erro=" + encodeURIComponent("Não consegui cadastrar o vendedor: " + erroAdmin(error, "erro desconhecido")));
    vendedor_id = data.user!.id;
    await admin.from("profiles").upsert({ id: vendedor_id, nome: vendedor, email, papel: "vendedor", ativo: true });
  }
  await admin.from("profiles").update({ funcao }).eq("id", vendedor_id);
  const { error } = await admin.from("instancias_whatsapp").insert({ vendedor_id, nome: `WhatsApp de ${vendedor}`, status: "aguardando" });
  if (error) redirect("/instancias?erro=" + encodeURIComponent(error.message));
  revalidatePath("/instancias"); revalidatePath("/configuracoes"); revalidatePath("/");
}
async function mudarFuncao(fd: FormData) {
  "use server";
  await exigirGestor();
  const funcao = fd.get("funcao") === "closer" ? "closer" : "sdr";
  await createAdminClient().from("profiles").update({ funcao }).eq("id", String(fd.get("vendedor_id")));
  revalidatePath("/instancias"); revalidatePath("/configuracoes"); revalidatePath("/");
}
async function resetar(fd: FormData) {
  "use server";
  await exigirAdmin();
  await (await createClient()).from("instancias_whatsapp").update({ comando: "reset", qr: null, status: "conectando", atualizado_em: new Date().toISOString() }).eq("id", String(fd.get("id")));
  revalidatePath("/instancias");
}
async function remover(fd: FormData) {
  "use server";
  await exigirAdmin();
  const db = await createClient();
  const { data: inst } = await db.from("instancias_whatsapp").select("vendedor_id").eq("id", String(fd.get("id"))).maybeSingle();
  await db.from("instancias_whatsapp").delete().eq("id", String(fd.get("id")));
  // vendedor criado pela aba WhatsApp (sem login proprio) e sem outro WhatsApp: sai do time (fica inativo, historico preservado)
  if (inst?.vendedor_id) {
    const admin = createAdminClient();
    const [{ count }, { data: p }] = await Promise.all([
      admin.from("instancias_whatsapp").select("id", { count: "exact", head: true }).eq("vendedor_id", inst.vendedor_id),
      admin.from("profiles").select("email,papel").eq("id", inst.vendedor_id).maybeSingle(),
    ]);
    if (!count && p?.papel === "vendedor" && String(p.email || "").endsWith("@sem-login.invalid")) await admin.from("profiles").update({ ativo: false }).eq("id", inst.vendedor_id);
  }
  revalidatePath("/instancias"); revalidatePath("/conversas"); revalidatePath("/");
}

const COR: Record<string, string> = { conectado: "text-ok", aguardando_qr: "text-warn", conectando: "text-mute", aguardando: "text-mute", desconectado: "text-bad", erro: "text-bad" };
const TXT: Record<string, string> = { conectado: "Conectado", aguardando_qr: "Aguardando leitura do QR Code", conectando: "Conectando...", aguardando: "Criando a conexão...", desconectado: "Desconectado", erro: "Erro ao conectar (veja os registros do worker ou o limite do plano da Uazapi)" };

export default async function Instancias({ searchParams: searchParamsP }: { searchParams: Promise<{ erro?: string }> }) {
  const searchParams = await searchParamsP;
  const perfil = await exigirGestor();
  const supabase = await createClient();
  const [{ data }, { data: perfis }, { data: ws }] = await Promise.all([
    supabase.from("instancias_whatsapp").select("*").order("criado_em"),
    supabase.from("profiles").select("id,nome,papel,funcao").order("nome"),
    supabase.from("worker_status").select("visto_em").eq("id", 1).maybeSingle(),
  ]);
  // O worker atualiza visto_em a cada 15 s. Mais de 1 minuto sem sinal = desligado ou travado.
  const vistoEm = (ws as { visto_em: string } | null)?.visto_em;
  const workerLigado = !!vistoEm && Date.now() - new Date(vistoEm).getTime() < 60_000;
  const nomes = new Map<string, string>((perfis ?? []).map((x: any) => [x.id, x.nome]));
  const funcoes = new Map<string, string>((perfis ?? []).map((x: any) => [x.id, x.funcao]));
  const insts = (data ?? []) as Instancia[];

  return (
    <div className="space-y-5">
      <AutoRefresh segundos={5} tabelas={["instancias_whatsapp"]} />
      <div><h1 className="page-title">WhatsApp conectado</h1>
        <p className="page-sub">Cada vendedor lê o QR Code no celular dele: WhatsApp → Aparelhos conectados → Conectar um aparelho. O QR renova sozinho a cada 2 minutos.</p></div>
      {searchParams.erro && <p className="card border-bad text-sm text-bad">{searchParams.erro}</p>}
      {workerLigado ? (
        <div className="card flex items-center gap-3 !py-3 text-sm"><CheckCircle2 size={18} className="shrink-0 text-ok" /><span><b className="text-ok">Worker ligado.</b> <span className="text-mute">Último sinal às {fmtDataHora(vistoEm!)}. Conexões novas ganham QR Code em até 15 segundos.</span></span></div>
      ) : (
        <div className="aviso flex gap-3">
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-warn" />
          <div>
            <b className="text-base text-warn">Worker desligado: o QR Code não vai aparecer</b>
            <p className="mt-1 text-ink/90">Quem pede o QR à Uazapi e recebe as mensagens é o worker, um programa que fica ligado 24h no Railway.
              {vistoEm ? ` O último sinal dele foi em ${fmtDataHora(vistoEm)}. Veja se ele caiu na hospedagem.` : " Ele ainda não foi publicado. Depois de publicar, esta tela mostra o QR sozinha."}</p>
          </div>
        </div>
      )}
      {perfil.papel === "admin" && (
        <form action={criar} className="card grid gap-3 md:grid-cols-[1.5fr_1fr_auto]">
          <div><label className="label" htmlFor="vendedor">Nome do vendedor</label>
            <input id="vendedor" name="vendedor" list="vendedores" className="input" placeholder="Ex.: Ruan" required autoComplete="off" />
            <datalist id="vendedores">{(perfis ?? []).filter((p: any) => p.papel === "vendedor").map((p: any) => <option key={p.id} value={p.nome} />)}</datalist></div>
          <div><label className="label" htmlFor="funcao">Função</label>
            <select id="funcao" name="funcao" className="input" defaultValue="sdr"><option value="sdr">SDR</option><option value="closer">Closer</option></select></div>
          <div className="flex items-end"><button className="btn">Adicionar vendedor e conexão</button></div>
          <p className="text-xs text-mute md:col-span-3">SDR: vende inscrição no workshop e marca reunião de imersão. Closer: marca reunião de implementação e fecha a imersão. Dá para trocar depois no card da conexão.</p>
        </form>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {insts.map((i) => (
          <div key={i.id} className="card space-y-2">
            <div className="flex items-start justify-between gap-3"><div><b>{nomes.get(i.vendedor_id) ?? i.nome}</b><div className="page-sub">{i.nome}{i.numero ? ` · +${i.numero}` : ""}</div></div>
              <span className={`text-right text-sm font-semibold ${COR[i.status] ?? ""}`}>{TXT[i.status] ?? i.status}</span></div>
            <form action={mudarFuncao} className="flex items-center gap-2 text-sm">
              <input type="hidden" name="vendedor_id" value={i.vendedor_id} />
              <span className="text-mute">Função:</span>
              {(["sdr", "closer"] as const).map((f) => (
                <button key={f} name="funcao" value={f} aria-pressed={funcoes.get(i.vendedor_id) === f}
                  className={`rounded-full border px-3 py-0.5 font-semibold ${funcoes.get(i.vendedor_id) === f ? "border-brand bg-brand text-bg" : "border-line text-mute hover:text-ink"}`}>{f === "sdr" ? "SDR" : "Closer"}</button>
              ))}
            </form>
            {i.status === "aguardando_qr" && i.qr && <QrCard qr={i.qr} />}
            {!workerLigado && i.status !== "conectado" && <p className="text-sm text-mute">Esperando o worker ligar para gerar o QR Code.</p>}
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

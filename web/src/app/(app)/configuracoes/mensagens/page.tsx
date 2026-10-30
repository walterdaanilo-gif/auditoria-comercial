import Link from "next/link";
import { empresas, exigirGestor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import EditorMensagens from "./EditorMensagens";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mensagens · Cabueta do Elon Musk" };

// Configuracoes > Mensagens: os textos que o sistema manda para o gestor e para o vendedor, por empresa
export default async function Mensagens() {
  const { atual } = await empresas(await exigirGestor());
  const { data } = await (await createClient()).from("modelos_mensagem").select("chave,texto,ativo"); // RLS: so a empresa aberta
  const salvos = Object.fromEntries((data ?? []).map((r) => [r.chave as string, { texto: (r.texto as string | null) ?? null, ativo: r.ativo !== false }]));
  return (
    <div className="space-y-5">
      <div>
        <Link href="/configuracoes" className="text-sm text-mute hover:text-ink">← Configurações</Link>
        <h1 className="page-title">Mensagens</h1>
        <p className="page-sub">Tudo que o Cabueta manda no WhatsApp para você e para os vendedores da {atual?.nome ?? "empresa"}. Edite o texto, use as variáveis entre chaves (elas são trocadas pelos dados reais no envio) e confira a prévia. Linha em que todas as variáveis vierem vazias some da mensagem.</p>
      </div>
      <EditorMensagens salvos={salvos} />
    </div>
  );
}

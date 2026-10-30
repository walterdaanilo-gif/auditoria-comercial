import { empresas, exigirGestor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Criterio, Estado, Numero, Settings, Vendedor } from "@/lib/configuracoes";
import Link from "next/link";
import { MessageSquareText } from "lucide-react";
import FormConfig, { type StatusAgenda } from "./FormConfig";

export const dynamic = "force-dynamic";
export const metadata = { title: "Configurações · Cabueta do Elon Musk" };

// Configuracoes do Auditor: so gestor e admin entram (a RLS das tabelas tambem exige gestor)
export default async function Configuracoes({ searchParams: spP }: { searchParams: Promise<{ agenda?: string }> }) {
  const sp = await spP;
  const { atual } = await empresas(await exigirGestor());
  const db = await createClient();
  const [rCfg, rCrit, rIgn, rAl, rPerf, rInst, rAg] = await Promise.all([
    db.from("audit_settings").select("*").maybeSingle(), // a RLS devolve so a linha da empresa aberta
    db.from("criterios_rubrica").select("rubrica,chave,nome,descricao,peso,ativo,posicao").order("posicao"),
    db.from("numeros_ignorados").select("telefone").order("criado_em"),
    db.from("telefones_alerta").select("telefone").order("criado_em"),
    db.from("profiles").select("id,nome,funcao,ativo,foto_url").order("nome"),
    db.from("instancias_whatsapp").select("id,vendedor_id,nome,numero,status,horario").order("nome"),
    db.rpc("status_agenda"),
  ]);
  if (rCfg.error || !rCfg.data) return <p className="aviso">Não foi possível carregar as configurações: {rCfg.error?.message ?? "linha de configuração não encontrada"}.</p>;

  const crit = (rCrit.data ?? []) as (Criterio & { rubrica: string })[];
  const da = (r: string) => crit.filter((c) => c.rubrica === r).map(({ chave, nome, descricao, peso, ativo }) => ({ chave, nome, descricao, peso, ativo }));
  const { id: _id, org_id: _o, atualizado_em: _a, resumo_ultimo_envio: _r, rodada_final_ultima: _u, ...settings } = rCfg.data as Settings & { id: number; org_id: string; atualizado_em: string; resumo_ultimo_envio: string | null; rodada_final_ultima: string | null };
  const inicial: Estado = {
    settings: settings as Settings,
    // vendedor = quem tem conexao de WhatsApp (o cadastro e feito na aba WhatsApp)
    vendedores: (rPerf.data ?? []).filter((p) => (rInst.data ?? []).some((i) => i.vendedor_id === p.id)).map(({ id, nome, funcao, ativo, foto_url }) => ({ id, nome, funcao, ativo, foto_url })) as Vendedor[],
    numeros: (rInst.data ?? []) as Numero[],
    ignorados: (rIgn.data ?? []).map((x) => x.telefone as string),
    alertas: (rAl.data ?? []).map((x) => x.telefone as string),
    rubricas: { sdr: da("sdr"), closer: da("closer"), personalizada: da("personalizada") },
  };
  return (
    <>
      <Link href="/configuracoes/mensagens" className="mb-4 flex items-center gap-3 rounded-3xl border border-line bg-card px-5 py-4 hover:border-brand">
        <MessageSquareText size={20} className="shrink-0 text-brand" />
        <span className="min-w-0 flex-1"><span className="block font-bold">Mensagens</span>
          <span className="block text-sm text-mute">Edite os textos que o sistema manda para você e para os vendedores (resumos, alertas, follow-up)</span></span>
        <span className="text-mute">›</span>
      </Link>
      <FormConfig empresa={atual?.nome ?? "Weevo"} inicial={inicial} agenda={((rAg.data ?? []) as StatusAgenda[])[0] ?? null} retornoAgenda={sp.agenda} />
    </>
  );
}

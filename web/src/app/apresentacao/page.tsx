import { exigirPerfil } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { hojeBR } from "@/lib/format";
import { lerPeriodo } from "@/lib/periodo";
import { Tela, type DadosTela, type Linha } from "./Tela";

export const dynamic = "force-dynamic";
export const metadata = { title: "Apresentação · Auditoria Comercial" };

export default async function Apresentacao({ searchParams: spP }: { searchParams: Promise<{ p?: string; de?: string; ate?: string }> }) {
  const sp = await spP;
  await exigirPerfil();
  const periodo = lerPeriodo(sp, "semana");
  const { de, ate } = periodo;
  const hoje = hojeBR();
  const supabase = await createClient();

  const [rRes, rPerf, rMarc, rSem, rAlerta] = await Promise.all([
    supabase.rpc("resumo_sdr", { p_from: de, p_to: ate }),
    supabase.from("profiles").select("id,nome,papel,ativo").order("nome"),
    supabase.from("auditorias").select("id,conversa_id,vendedor_id,nota_geral,tipo_agendamento,atualizado_em,conversas!inner(contato,contato_nome,data,canal)")
      .eq("agendou", true).neq("conversas.canal", "importada").gte("conversas.data", de).lte("conversas.data", ate).order("atualizado_em", { ascending: false }).limit(40),
    supabase.rpc("conversas_sem_retorno", { p_from: de, p_to: ate, p_min: 15 }),
    supabase.from("auditorias").select("id,conversa_id,vendedor_id,nota_geral,qualidade,agendou,efetiva,resumo,atualizado_em,conversas!inner(contato,contato_nome,data,canal)")
      .neq("conversas.canal", "importada").gte("conversas.data", de).lte("conversas.data", ate).or("qualidade.eq.ruim,and(efetiva.eq.true,agendou.eq.false)").order("atualizado_em", { ascending: false }).limit(40),
  ]);
  return <Tela periodo={periodo} hoje={hoje} perfis={(rPerf.data ?? []) as DadosTela["perfis"]} linhas={(rRes.data ?? []) as Linha[]}
    marcacoes={(rMarc.data ?? []) as any[]} semRetorno={(rSem.data ?? []) as DadosTela["semRetorno"]} alertas={(rAlerta.data ?? []) as any[]}
    atualizadoEm={new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })} />;
}


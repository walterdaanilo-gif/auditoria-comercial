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

  const [rRes, rPerf] = await Promise.all([
    supabase.rpc("resumo_sdr", { p_from: de, p_to: ate }),
    supabase.from("profiles").select("id,nome,papel,ativo").order("nome"),
  ]);
  return <Tela periodo={periodo} hoje={hoje} perfis={(rPerf.data ?? []) as DadosTela["perfis"]} linhas={(rRes.data ?? []) as Linha[]}
    atualizadoEm={new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })} />;
}


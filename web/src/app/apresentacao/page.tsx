import { exigirPerfil } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { hojeBR } from "@/lib/format";
import { lerPeriodo } from "@/lib/periodo";
import { Tela, type DadosTela, type Linha, type Vendas, type WorkshopPor } from "./Tela";

export const dynamic = "force-dynamic";
export const metadata = { title: "Apresentação · Auditoria Comercial" };

export default async function Apresentacao({ searchParams: spP }: { searchParams: Promise<{ p?: string; de?: string; ate?: string }> }) {
  const sp = await spP;
  await exigirPerfil();
  const periodo = lerPeriodo(sp, "semana");
  const { de, ate } = periodo;
  const hoje = hojeBR();
  const supabase = await createClient();

  const [rRes, rPerf, rInst, rCfg, rVen] = await Promise.all([
    supabase.rpc("resumo_sdr2", { p_from: de, p_to: ate }),
    supabase.from("profiles").select("id,nome,papel,ativo,funcao").order("nome"),
    supabase.from("instancias_whatsapp").select("vendedor_id"),
    supabase.from("audit_settings").select("meta_sdr_conversas,meta_sdr_marcacoes").eq("id", 1).maybeSingle(),
    supabase.from("auditorias").select("vendedor_id,venda_tipo,venda_valor,venda_cupom,conversas!inner(data,canal)").eq("venda", true).neq("conversas.canal", "importada").gte("conversas.data", de).lte("conversas.data", ate).limit(5000),
  ]);
  // vendas do time (quem tem WhatsApp cadastrado ou papel vendedor)
  const equipe = [...new Set((rInst.data ?? []).map((i) => i.vendedor_id as string))];
  const timeIds = new Set(((rPerf.data ?? []) as DadosTela["perfis"]).filter((p) => p.ativo && (p.papel === "vendedor" || equipe.includes(p.id))).map((p) => p.id));
  const ven = ((rVen.data ?? []) as { vendedor_id: string; venda_tipo: string | null; venda_valor: number | null; venda_cupom: boolean }[]).filter((v) => timeIds.has(v.vendedor_id));
  const ws = ven.filter((v) => v.venda_tipo !== "imersao"), im = ven.filter((v) => v.venda_tipo === "imersao");
  const pagos = ws.filter((v) => !v.venda_cupom);
  const vendas: Vendas = {
    wPagos: pagos.length, wValor: pagos.reduce((s, v) => s + Number(v.venda_valor || 0), 0),
    imersoes: im.length, imValor: im.reduce((s, v) => s + Number(v.venda_valor || 0), 0),
    convites: ws.length - pagos.length,
  };
  const workshopPor: WorkshopPor = {};
  for (const v of ven.filter((x) => x.venda_tipo !== "imersao")) {
    const o = (workshopPor[v.vendedor_id] ??= { convites: 0, pagos: 0, valor: 0 });
    if (v.venda_cupom) o.convites++; else { o.pagos++; o.valor += Number(v.venda_valor || 0); }
  }
  const cfg = rCfg.data as { meta_sdr_conversas: number | null; meta_sdr_marcacoes: number | null } | null;
  return <Tela periodo={periodo} hoje={hoje} perfis={(rPerf.data ?? []) as DadosTela["perfis"]} linhas={(rRes.data ?? []) as Linha[]}
    equipe={equipe} vendas={vendas} workshopPor={workshopPor}
    metas={{ conversas: cfg?.meta_sdr_conversas ?? 25, marcacoes: cfg?.meta_sdr_marcacoes ?? 6 }}
    atualizadoEm={new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })} />;
}


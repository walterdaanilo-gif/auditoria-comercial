import { empresas, exigirPerfil } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { hojeBR } from "@/lib/format";
import { lerPeriodo } from "@/lib/periodo";
import type { Slide1Dados } from "./slide1/calc";
import { montarSlide1 } from "./slide1/dados";
import { slide1Demo } from "./slide1/demo";
import { Tela, type DadosTela, type Linha, type Vendas, type WorkshopPor } from "./Tela";

export const dynamic = "force-dynamic";
export const metadata = { title: "Apresentação · Cabueta do Elon Musk" };

export default async function Apresentacao({ searchParams: spP }: { searchParams: Promise<{ p?: string; de?: string; ate?: string; demo?: string }> }) {
  const sp = await spP;
  // so a empresa aberta (Weevo ou Carbone): time, metas, numeros e vendas dela
  const { atual } = await empresas(await exigirPerfil());
  const org = atual?.id ?? "";
  const periodo = lerPeriodo(sp, "semana");
  const { de, ate } = periodo;
  const hoje = hojeBR();
  // Apresentacao e do time todo, inclusive para o vendedor: le pelo servidor com a service role (so numeros
  // agregados e nomes vao para a tela; conversas e mensagens dos outros continuam bloqueadas pela RLS)
  const supabase = createAdminClient();

  const [rRes, rPerf, rInst, rCfg, rVen] = await Promise.all([
    supabase.rpc("resumo_sdr2", { p_from: de, p_to: ate }),
    supabase.from("profiles").select("id,nome,papel,ativo,funcao,foto_url").order("nome"),
    supabase.from("instancias_whatsapp").select("vendedor_id").eq("org_id", org),
    supabase.from("audit_settings").select("meta_sdr_conversas,meta_sdr_marcacoes").eq("org_id", org).maybeSingle(),
    supabase.from("auditorias").select("vendedor_id,venda_tipo,venda_valor,venda_cupom,venda_convite_origem,conversas!inner(data,canal)").eq("org_id", org).eq("venda", true).neq("conversas.canal", "importada").gte("conversas.data", de).lte("conversas.data", ate).limit(5000),
  ]);
  // vendas do time (quem tem WhatsApp cadastrado ou papel vendedor)
  const equipe = [...new Set((rInst.data ?? []).map((i) => i.vendedor_id as string))];
  const timeIds = new Set(((rPerf.data ?? []) as DadosTela["perfis"]).filter((p) => p.ativo && equipe.includes(p.id)).map((p) => p.id));
  const ven = ((rVen.data ?? []) as { vendedor_id: string; venda_tipo: string | null; venda_valor: number | null; venda_cupom: boolean; venda_convite_origem: string | null }[]).filter((v) => timeIds.has(v.vendedor_id));
  const ws = ven.filter((v) => v.venda_tipo !== "imersao"), im = ven.filter((v) => v.venda_tipo === "imersao");
  const pagos = ws.filter((v) => !v.venda_cupom);
  const vendas: Vendas = {
    wPagos: pagos.length, wValor: pagos.reduce((s, v) => s + Number(v.venda_valor || 0), 0),
    imersoes: im.length, imValor: im.reduce((s, v) => s + Number(v.venda_valor || 0), 0),
    convites: ws.length - pagos.length, carbone: ws.filter((v) => v.venda_cupom && v.venda_convite_origem === "carbone").length,
  };
  const workshopPor: WorkshopPor = {};
  for (const v of ven.filter((x) => x.venda_tipo !== "imersao")) {
    const o = (workshopPor[v.vendedor_id] ??= { convites: 0, pagos: 0, valor: 0 });
    if (v.venda_cupom) o.convites++; else { o.pagos++; o.valor += Number(v.venda_valor || 0); }
  }
  // Slide 1 novo (Visao geral): so Weevo. ?demo=1 mostra numeros ficticios; sem demo, so dados reais (o que nao existe vira "aguardando fonte").
  // Se a busca falhar, o slide antigo continua aparecendo.
  let slide1: Slide1Dados | null = null;
  if (atual?.slug === "weevo") {
    if (sp.demo === "1") slide1 = slide1Demo;
    else { try { slide1 = await montarSlide1(org); } catch { slide1 = null; } }
  }
  const cfg = rCfg.data as { meta_sdr_conversas: number | null; meta_sdr_marcacoes: number | null } | null;
  return <Tela empresa={atual ? { slug: atual.slug, nome: atual.nome } : null} periodo={periodo} hoje={hoje} perfis={(rPerf.data ?? []) as DadosTela["perfis"]} linhas={((rRes.data ?? []) as Linha[]).filter((l) => equipe.includes(l.vendedor_id))}
    equipe={equipe} vendas={vendas} workshopPor={workshopPor} slide1={slide1}
    metas={{ conversas: cfg?.meta_sdr_conversas ?? 25, marcacoes: cfg?.meta_sdr_marcacoes ?? 6 }}
    atualizadoEm={new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })} />;
}


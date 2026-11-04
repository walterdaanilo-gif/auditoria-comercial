import { createAdminClient } from "@/lib/supabase/admin";
import { hojeBR, um } from "@/lib/format";
import { diasUteis } from "@/lib/metas";
import { diasEntre } from "@/lib/periodo";
import type { Pessoa, VisaoGeralDados } from "./calc";

// Tela fixa da TV com dados REAIS do mes atual. So leitura. Dado que o Cabueta nao mede nao entra na tela.
type Perfil = { id: string; nome: string; funcao: string | null; ativo: boolean; foto_url: string | null };
type Linha = { vendedor_id: string; respostas: number; marcacoes: number };
type Venda = { vendedor_id: string; venda_tipo: string | null; venda_valor: number | null; venda_cupom: boolean; conversas: { data: string } | { data: string }[] | null };

const n = (x: unknown) => Number(x) || 0;
const ddmm = (d: string) => d.slice(8, 10) + "/" + d.slice(5, 7);
const util = (d: string) => { const w = new Date(d + "T12:00:00Z").getUTCDay(); return w !== 0 && w !== 6; };
const sigla = (nome: string) => nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";
const horaBR = () => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());

export async function montarVisaoGeral(org: string): Promise<VisaoGeralDados> {
  const hoje = hojeBR();
  const ini = hoje.slice(0, 8) + "01";
  const ano = Number(hoje.slice(0, 4)), mes = Number(hoje.slice(5, 7));
  const fim = `${hoje.slice(0, 8)}${String(new Date(Date.UTC(ano, mes, 0)).getUTCDate()).padStart(2, "0")}`;
  const diaUtil = diasUteis(ini, hoje), diasUteisMes = diasUteis(ini, fim);
  const db = createAdminClient();

  const [rRes, rPerf, rInst, rCfg, rVen, rPri, rSem] = await Promise.all([
    db.rpc("resumo_sdr2", { p_from: ini, p_to: hoje }),
    db.from("profiles").select("id,nome,funcao,ativo,foto_url").order("nome"),
    db.from("instancias_whatsapp").select("vendedor_id").eq("org_id", org),
    db.from("audit_settings").select("*").eq("org_id", org).maybeSingle(),
    db.from("auditorias").select("vendedor_id,venda_tipo,venda_valor,venda_cupom,conversas!inner(data,canal)").eq("org_id", org).eq("venda", true).neq("conversas.canal", "importada").gte("conversas.data", ini).lte("conversas.data", hoje).limit(5000),
    // mesma conta do painel de atendimento: media da 1a resposta (lead escreve -> SDR responde) nas conversas auditadas
    db.from("auditorias").select("vendedor_id,primeira_resposta_seg,conversas!inner(data,canal)").eq("org_id", org).not("primeira_resposta_seg", "is", null).neq("conversas.canal", "importada").gte("conversas.data", ini).lte("conversas.data", hoje).limit(5000),
    db.rpc("conversas_sem_retorno", { p_from: ini, p_to: hoje, p_min: 15 }),
  ]);

  const equipe = new Set(((rInst.data ?? []) as { vendedor_id: string }[]).map((i) => i.vendedor_id));
  const time = ((rPerf.data ?? []) as Perfil[]).filter((p) => p.ativo && equipe.has(p.id));
  const sdrs = time.filter((p) => p.funcao !== "closer" && p.funcao !== "gestao");
  const closers = time.filter((p) => p.funcao === "closer");
  const ids = new Set(time.map((p) => p.id));
  const linhas = ((rRes.data ?? []) as Linha[]).filter((l) => ids.has(l.vendedor_id));
  const vendas = ((rVen.data ?? []) as unknown as Venda[]).filter((v) => ids.has(v.vendedor_id));
  const cfg = (rCfg.data ?? {}) as Record<string, number | null | undefined>;

  // ---- faturamento: so Workshop pago e Imersao (unicos com valor no Cabueta) ----
  const valorV = (v: Venda) => (v.venda_tipo === "imersao" || !v.venda_cupom ? n(v.venda_valor) : 0);
  const porDia = new Map<string, number>();
  for (const v of vendas) { const d = um(v.conversas)?.data; if (d) porDia.set(d, (porDia.get(d) ?? 0) + valorV(v)); }
  const serie: { du: number; real: number; data: string }[] = [];
  let acc = 0, du = 0;
  for (const d of diasEntre(ini, hoje)) {
    acc += porDia.get(d) ?? 0;
    if (!util(d)) continue;
    du++; serie.push({ du, real: acc, data: ddmm(d) });
  }
  if (serie.length) serie[serie.length - 1].real = acc; // venda de fim de semana entra no ultimo ponto

  // ---- pessoas ----
  const somaDe = (id: string) => linhas.filter((l) => l.vendedor_id === id).reduce((t, l) => ({ respostas: t.respostas + n(l.respostas), marcacoes: t.marcacoes + n(l.marcacoes) }), { respostas: 0, marcacoes: 0 });
  const metaConv = n(cfg.meta_sdr_conversas ?? 25) * diasUteisMes, metaMarc = n(cfg.meta_sdr_marcacoes ?? 6) * diasUteisMes;
  const pessoa = (p: Perfil, tipo: "sdr" | "closer"): Pessoa => {
    const vs = vendas.filter((v) => v.vendedor_id === p.id && valorV(v) > 0), t = somaDe(p.id);
    return {
      id: p.id, nome: p.nome, sigla: sigla(p.nome), foto: p.foto_url, tipo,
      conversas: tipo === "sdr" ? { v: t.respostas, meta: metaConv } : null,
      marcacoes: tipo === "sdr" ? { v: t.marcacoes, meta: metaMarc } : null,
      vendasValor: vs.reduce((s, v) => s + valorV(v), 0), vendasN: vs.length,
    };
  };

  // ---- alertas ----
  const pri = ((rPri.data ?? []) as { vendedor_id: string; primeira_resposta_seg: number }[]).filter((a) => ids.has(a.vendedor_id));
  const semRetorno = rSem.error ? null : ((rSem.data ?? []) as { vendedor_id: string }[]).filter((c) => ids.has(c.vendedor_id)).length;

  return {
    demo: false,
    atualizadoEm: horaBR(),
    periodo: { rotulo: "Mês atual", intervalo: `01 a ${fim.slice(8)}/${fim.slice(5, 7)}`, diaUtil, diasUteisMes },
    fat: { real: acc, meta: cfg.meta_fat_mes == null ? null : Number(cfg.meta_fat_mes), serie, datasUteis: diasEntre(ini, fim).filter(util).map(ddmm) },
    pessoas: [...sdrs.map((p) => pessoa(p, "sdr")), ...closers.map((p) => pessoa(p, "closer"))],
    semRetorno,
    primeiraResposta: rPri.error ? null : { seg: pri.length ? pri.reduce((s, a) => s + n(a.primeira_resposta_seg), 0) / pri.length : null, slaMin: n(cfg.sla_primeira_resposta_min ?? 15) },
  };
}

import { createAdminClient } from "@/lib/supabase/admin";
import { duracao, nota } from "@/lib/format";
import { diasUteis } from "@/lib/metas";
import { diasEntre, type Periodo } from "@/lib/periodo";
import { resolverQuadros } from "@/lib/quadrosTv";
import { contaNoFaturamento, listarResultados } from "@/lib/resultados";
import { inteiro, tomPorDiferenca, type Kpi, type Pessoa, type VisaoGeralDados } from "./calc";

// Tela fixa da TV com dados REAIS do mes atual. So leitura. Dado que o Cabueta nao mede nao entra na tela.
type Perfil = { id: string; nome: string; funcao: string | null; ativo: boolean; foto_url: string | null };
type Linha = { vendedor_id: string; respostas: number; marcacoes: number; ligacoes: number; ligacoes_atendidas: number; auditadas: number; nota_soma: number };
type Tempos = { vendedor_id: string; primeira_resposta_seg: number | null; tempo_medio_resposta_seg: number | null; respostas_sdr: number | null };

const n = (x: unknown) => Number(x) || 0;
const ORDEM_PRODUTOS = ["plataforma", "imersao", "incompany", "workshop", "outro"]; // Plataforma primeiro na TV
const ddmm = (d: string) => d.slice(8, 10) + "/" + d.slice(5, 7);
const util = (d: string) => { const w = new Date(d + "T12:00:00Z").getUTCDay(); return w !== 0 && w !== 6; };
const sigla = (nome: string) => nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";
const horaBR = () => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
const seloRitmo = (difPts: number) => (difPts >= 0 ? "no ritmo" : `${Math.round(-difPts)} pts abaixo`);

// Periodo escolhido na tela (mes atual, semana atual, hoje ou datas livres). So no mes atual valem meta do mes, ritmo e projecao.
export async function montarVisaoGeral(org: string, periodo: Periodo): Promise<VisaoGeralDados> {
  const ini = periodo.de, hoje = periodo.ate; // hoje = ultimo dia do periodo (nunca depois de hoje)
  const mensal = periodo.p === "mes";
  const ano = Number(hoje.slice(0, 4)), mes = Number(hoje.slice(5, 7));
  const fim = mensal ? `${hoje.slice(0, 8)}${String(new Date(Date.UTC(ano, mes, 0)).getUTCDate()).padStart(2, "0")}` : hoje;
  const diaUtil = diasUteis(ini, hoje), diasUteisMes = mensal ? diasUteis(ini, fim) : diaUtil;
  const ritmoPct = (Math.max(diaUtil, 1) / diasUteisMes) * 100;
  const db = createAdminClient();

  const [rRes, rPerf, rInst, rCfg, resultados, rTem, rSem, rEtapas, rFup, rDiag] = await Promise.all([
    db.rpc("resumo_sdr2", { p_from: ini, p_to: hoje }),
    db.from("profiles").select("id,nome,funcao,ativo,foto_url").order("nome"),
    db.from("instancias_whatsapp").select("vendedor_id").eq("org_id", org),
    db.from("audit_settings").select("*").eq("org_id", org).maybeSingle(),
    // vendas em dinheiro = a mesma lista da aba Resultados (CRM + vendas da IA com ajustes + manuais, sem duplicar)
    listarResultados(db, org, ini, hoje),
    // mesma conta do painel de atendimento: tempos de resposta das conversas auditadas
    db.from("auditorias").select("vendedor_id,primeira_resposta_seg,tempo_medio_resposta_seg,respostas_sdr,conversas!inner(data,canal)").eq("org_id", org).neq("conversas.canal", "importada").gte("conversas.data", ini).lte("conversas.data", hoje).limit(5000),
    db.rpc("conversas_sem_retorno", { p_from: ini, p_to: hoje, p_min: 15 }),
    // closer: cartoes que ENTRARAM em "Diagnostico realizado" (reuniao feita) no funil do CRM (tabela crm_etapas)
    db.from("crm_etapas").select("conversa_id,vendedor_id,etapa").eq("org_id", org).like("etapa", "%diagnostico_realizado")
      .gte("em", `${ini}T00:00:00-03:00`).lte("em", `${hoje}T23:59:59.999-03:00`).limit(5000),
    // follow-ups atrasados agora, por vendedor (retrato que o worker grava a cada 15 min, mesma regra do aviso)
    db.from("followups_atrasados").select("vendedor_id,qtd,mais_antigo_dias,dias_regra,calculado_em").limit(1000),
    // closer: negocios do CRM com "Data do diagnostico" (reuniao feita) e o campo Closer; cobre o que veio antes do historico de etapas
    db.from("crm_vendas").select("deal_id,chat_id,contato_crm_id,closer,campos").eq("org_id", org).not("closer", "is", null).limit(5000),
  ]);

  const nomeDe = new Map(((rPerf.data ?? []) as Perfil[]).map((p) => [p.id, p.nome])); // quem vendeu, na lista de vendas do produto
  const equipe = new Set(((rInst.data ?? []) as { vendedor_id: string }[]).map((i) => i.vendedor_id));
  const time = ((rPerf.data ?? []) as Perfil[]).filter((p) => p.ativo && equipe.has(p.id));
  const sdrs = time.filter((p) => p.funcao !== "closer" && p.funcao !== "gestao");
  const closers = time.filter((p) => p.funcao === "closer");
  const ids = new Set(time.map((p) => p.id)), sdrIds = new Set(sdrs.map((p) => p.id));
  const linhas = ((rRes.data ?? []) as Linha[]).filter((l) => ids.has(l.vendedor_id));
  // vendas da IA: so de quem e do time; vendas do CRM e manuais entram todas (mesmo sem vendedor). Ja vem sem duplicar.
  const vendas = resultados.linhas.filter((r) => contaNoFaturamento(r) && (r.origem !== "ia" || (r.vendedorId != null && ids.has(r.vendedorId))));
  const tempos = ((rTem.data ?? []) as unknown as Tempos[]).filter((t) => ids.has(t.vendedor_id));
  const cfg = (rCfg.data ?? {}) as Record<string, unknown>;

  // ---- faturamento: soma da aba Resultados (vendas da IA com ajustes + manuais) ----
  const porDia = new Map<string, number>();
  for (const v of vendas) porDia.set(v.data, (porDia.get(v.data) ?? 0) + (v.valor ?? 0));
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
  const metaConvDia = n(cfg.meta_sdr_conversas ?? 25), metaMarcDia = n(cfg.meta_sdr_marcacoes ?? 6);
  const metaConv = metaConvDia * diasUteisMes, metaMarc = metaMarcDia * diasUteisMes;
  const metaReun = n(cfg.meta_closer_reunioes) * diasUteisMes; // Configuracoes: reunioes de implementacao por dia util
  // funil do closer: cada cartao conta uma vez por etapa no periodo (vai e volta de coluna nao repete)
  const etapas = rEtapas.error ? null : ((rEtapas.data ?? []) as { conversa_id: string; vendedor_id: string | null; etapa: string }[]);
  // Reunioes realizadas = cartao que entrou em "Diagnostico realizado" (historico de etapas, desde 12/11/2026)
  // + negocio do CRM com "Data do diagnostico" no periodo e o closer no campo Closer (pelo primeiro nome).
  // A mesma conversa conta uma vez. "Como foi a reuniao" dizendo que nao aconteceu (nao foi feita, no-show) fica de fora.
  const primeiro = (x: unknown) => String(x ?? "").trim().split(/\s+/)[0]?.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase() || "";
  type Diag = { deal_id: string; chat_id: string | null; contato_crm_id: string | null; closer: string | null; campos: Record<string, unknown> | null };
  const diagnosticos = ((rDiag.error ? [] : rDiag.data ?? []) as Diag[]).filter((v) => {
    const dia = String(v.campos?.["data-do-diagnostico"] ?? "").slice(0, 10);
    return dia >= ini && dia <= hoje && !/n[aã]o foi feit|no.?show|n[aã]o compareceu|n[aã]o aconteceu/i.test(String(v.campos?.["como-foi-a-reuniao-de-diagnostico"] ?? ""));
  });
  const noFunil = (id: string, fim: string) => {
    const chaves = new Set((etapas ?? []).filter((e) => e.vendedor_id === id && e.etapa.endsWith(fim)).map((e) => e.conversa_id));
    const nome = primeiro(time.find((p) => p.id === id)?.nome);
    const xara = time.filter((p) => primeiro(p.nome) === nome).length > 1; // dois closers com o mesmo primeiro nome: nao da para saber de quem e
    if (fim === "diagnostico_realizado" && nome && !xara)
      for (const v of diagnosticos) if (primeiro(v.closer) === nome) chaves.add(v.chat_id || `d:${v.contato_crm_id || v.deal_id}|${String(v.campos?.["data-do-diagnostico"]).slice(0, 10)}`);
    return chaves.size;
  };
  // retrato com mais de 1 h = worker parado: melhor nao mostrar numero velho
  type Fup = { vendedor_id: string; qtd: number; mais_antigo_dias: number | null; dias_regra: number | null; calculado_em: string };
  const fups = new Map(((rFup.error ? [] : rFup.data ?? []) as Fup[]).filter((f) => Date.now() - Date.parse(f.calculado_em) < 3600_000).map((f) => [f.vendedor_id, f]));
  const followupsDe = (id: string) => { const f = fups.get(id); return f ? { qtd: n(f.qtd), maisAntigo: f.mais_antigo_dias, dias: n(f.dias_regra ?? cfg.followup_alerta_d ?? 6) } : null; };
  const pessoa = (p: Perfil, tipo: "sdr" | "closer"): Pessoa => {
    const vs = vendas.filter((v) => v.vendedorId === p.id), t = somaDe(p.id);
    return {
      id: p.id, nome: p.nome, sigla: sigla(p.nome), foto: p.foto_url, tipo,
      conversas: tipo === "sdr" ? { v: t.respostas, meta: metaConv } : null,
      marcacoes: tipo === "sdr" ? { v: t.marcacoes, meta: metaMarc } : null,
      vendasValor: vs.reduce((s, v) => s + (v.valor ?? 0), 0), vendasN: vs.length,
      reunioes: tipo === "closer" && etapas && metaReun ? { v: noFunil(p.id, "diagnostico_realizado"), meta: metaReun } : null,
      followups: tipo === "closer" ? followupsDe(p.id) : null,
    };
  };

  // ---- quadros pequenos (so os que tem dado) ----
  const sla = n(cfg.sla_primeira_resposta_min ?? 15);
  const pri = tempos.filter((t) => t.primeira_resposta_seg != null);
  const priMedia = pri.length ? pri.reduce((s, t) => s + n(t.primeira_resposta_seg), 0) / pri.length : null;
  const comMedio = tempos.filter((t) => t.tempo_medio_resposta_seg != null && n(t.respostas_sdr) > 0);
  const pesoMedio = comMedio.reduce((s, t) => s + n(t.respostas_sdr), 0);
  const medio = pesoMedio ? comMedio.reduce((s, t) => s + n(t.tempo_medio_resposta_seg) * n(t.respostas_sdr), 0) / pesoMedio : null;
  const tot = linhas.reduce((t, l) => ({ aud: t.aud + n(l.auditadas), nota: t.nota + n(l.nota_soma), lig: t.lig + n(l.ligacoes), atend: t.atend + n(l.ligacoes_atendidas) }), { aud: 0, nota: 0, lig: 0, atend: 0 });
  const sdrLinhas = linhas.filter((l) => sdrIds.has(l.vendedor_id));
  const conversasTime = sdrLinhas.reduce((s, l) => s + n(l.respostas), 0), marcacoesTime = sdrLinhas.reduce((s, l) => s + n(l.marcacoes), 0);
  const semRetorno = rSem.error ? null : ((rSem.data ?? []) as { vendedor_id: string }[]).filter((c) => ids.has(c.vendedor_id)).length;
  const contraMeta = (v: number, metaDia: number): Kpi => {
    const meta = metaDia * diasUteisMes * sdrs.length;
    if (!meta) return { valor: inteiro(v), sub: "sem SDR cadastrado", tom: "neutro" };
    const pct = (v / meta) * 100, dif = pct - ritmoPct;
    return { valor: inteiro(v), sub: `de ${inteiro(meta)} · ${Math.round(pct)}% da meta`, tom: tomPorDiferenca(dif), selo: seloRitmo(dif), pct };
  };
  const kpis: VisaoGeralDados["kpis"] = {
    semretorno: semRetorno === null ? { valor: null, sub: "não foi possível ler agora", tom: "neutro" }
      : { valor: semRetorno >= 100 ? "100+" : String(semRetorno), sub: "o lead escreveu e ficou mais de 15 min sem resposta", tom: semRetorno > 0 ? "bad" : "ok" },
    primeira: priMedia === null ? { valor: null, sub: "sem conversas auditadas no período", tom: "neutro" }
      : { valor: duracao(priMedia), sub: "média do período", tom: priMedia / 60 <= sla ? "ok" : "bad", selo: priMedia / 60 <= sla ? `dentro de ${sla} min` : `acima de ${sla} min` },
    nota: tot.aud ? { valor: nota(tot.nota / tot.aud), sub: `${inteiro(tot.aud)} auditadas no período`, tom: tot.nota / tot.aud >= 7 ? "ok" : tot.nota / tot.aud >= 4 ? "warn" : "bad" } : { valor: null, sub: "sem auditorias no período", tom: "neutro" },
    tempo_medio: medio === null ? { valor: null, sub: "sem conversas auditadas no período", tom: "neutro" }
      : { valor: duracao(medio), sub: "a cada vez que o lead escreve · média do período", tom: medio <= 300 ? "ok" : medio <= 1800 ? "warn" : "bad" },
    ligacoes: { valor: inteiro(tot.atend), sub: `de ${inteiro(tot.lig)} ligações no período`, tom: "neutro" },
    conversas_time: contraMeta(conversasTime, metaConvDia),
    marcacoes_time: contraMeta(marcacoesTime, metaMarcDia),
    convites: { valor: inteiro(resultados.convites.filter((id) => ids.has(id)).length), sub: "cupom 100% ou Carbone · R$ 0", tom: "neutro" },
  };

  return {
    demo: false,
    atualizadoEm: horaBR(),
    periodo: { p: periodo.p, de: ini, ate: hoje, mensal, rotulo: periodo.rotulo, intervalo: mensal ? `01 a ${fim.slice(8)}/${fim.slice(5, 7)}` : ini === hoje ? ddmm(ini) : `${ddmm(ini)} a ${ddmm(hoje)}`, diaUtil, diasUteisMes },
    fat: { real: acc, meta: mensal && cfg.meta_fat_mes != null ? Number(cfg.meta_fat_mes) : null, serie, datasUteis: diasEntre(ini, fim).filter(util).map(ddmm),
      porProduto: ORDEM_PRODUTOS.map((produto) => {
        const l = vendas.filter((v) => (v.produto ?? "outro") === produto);
        const lista = l.map((v) => ({ cliente: v.cliente || "Cliente sem nome", empresa: v.empresa, vendedor: v.vendedorId ? nomeDe.get(v.vendedorId) ?? null : null, data: ddmm(v.data), valor: v.valor ?? 0 }))
          .sort((a, b) => b.valor - a.valor);
        return { produto, valor: l.reduce((t, v) => t + (v.valor ?? 0), 0), n: l.length, vendas: lista };
      }).filter((x) => x.n > 0) },
    pessoas: [...sdrs.map((p) => pessoa(p, "sdr")), ...closers.map((p) => pessoa(p, "closer"))],
    quadros: resolverQuadros(cfg.tv_quadros),
    kpis,
  };
}

import { createAdminClient } from "@/lib/supabase/admin";
import { duracao, nota, somaDias } from "@/lib/format";
import { diasUteis, ehUtil } from "@/lib/metas";
import { diasEntre, type Periodo } from "@/lib/periodo";
import { resolverQuadros } from "@/lib/quadrosTv";
import { contaNaQuantidade, contaNoFaturamento, listarResultados, REGRA_ETAPAS_DESDE } from "@/lib/resultados";
import { inteiro, tomPorDiferenca, type Inscricao, type Kpi, type Pessoa, type VisaoGeralDados } from "./calc";

// Tela fixa da TV com dados REAIS do mes atual. So leitura. Dado que o Cabueta nao mede nao entra na tela.
type Perfil = { id: string; nome: string; funcao: string | null; ativo: boolean; foto_url: string | null };
type Linha = { dia: string; vendedor_id: string; respostas: number; marcacoes: number; workshop: number; ligacoes: number; ligacoes_atendidas: number; auditadas: number; nota_soma: number };
type Tempos = { vendedor_id: string; primeira_resposta_seg: number | null; tempo_medio_resposta_seg: number | null; respostas_sdr: number | null };

const n = (x: unknown) => Number(x) || 0;
// inscricoes no workshop (card do SDR e quadro do time) vem da etapa "Inscrito no workshop" do CRM a partir deste dia (pedido da gestao, 25/11/2026)
const INSCRICOES_CRM_DESDE = "2026-11-25";
const ORDEM_PRODUTOS = ["plataforma", "imersao", "incompany", "workshop", "outro"]; // desempate (a TV ordena pelo valor vendido)
const ddmm = (d: string) => d.slice(8, 10) + "/" + d.slice(5, 7);
const util = ehUtil; // seg a sex, sem feriado nacional
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

  const [rRes, rPerf, rInst, rCfg, resultados, rTem, rSem, rEtapas, rFup, rPres, rIns] = await Promise.all([
    db.rpc("resumo_sdr2", { p_from: ini, p_to: hoje }),
    db.from("profiles").select("id,nome,funcao,ativo,foto_url").order("nome"),
    db.from("instancias_whatsapp").select("vendedor_id").eq("org_id", org),
    db.from("audit_settings").select("*").eq("org_id", org).maybeSingle(),
    // vendas em dinheiro = a mesma lista da aba Resultados (CRM + vendas da IA com ajustes + manuais, sem duplicar)
    listarResultados(db, org, ini, hoje),
    // mesma conta do painel de atendimento: tempos de resposta das conversas auditadas
    db.from("auditorias").select("vendedor_id,primeira_resposta_seg,tempo_medio_resposta_seg,respostas_sdr,conversas!inner(data,canal)").eq("org_id", org).neq("conversas.canal", "importada").gte("conversas.data", ini).lte("conversas.data", hoje).limit(5000),
    // so desta empresa (conversas_sem_retorno_org, supabase/sem_retorno_org.sql): a conta antiga cortava em 100 de todas as empresas
    db.rpc("conversas_sem_retorno_org", { p_org: org, p_from: ini, p_to: hoje, p_min: 15 }),
    // closer: cartoes que ENTRARAM em "Diagnostico realizado" (reuniao feita) no funil do CRM (tabela crm_etapas)
    db.from("crm_etapas").select("conversa_id,vendedor_id,etapa,em,crm_conversas(contato_nome,telefone)").eq("org_id", org).or("etapa.like.%diagnostico_realizado,etapa.like.%reuniao_de_diagnostico")
      .gte("em", `${ini}T00:00:00-03:00`).lte("em", `${hoje}T23:59:59.999-03:00`).limit(5000),
    // follow-ups atrasados agora, por vendedor (retrato que o worker grava a cada 10 min e o Atualizar refaz na hora, mesma regra do aviso)
    // "*": a coluna "leads" (lista dos clientes) pode ainda nao existir no banco; sem ela a TV mostra so o numero
    db.from("followups_atrasados").select("*").limit(1000),
    // conversao do workshop: quem veio ao workshop (etapa "Veio ao workshop" do funil Workshop), so de 24/11 em diante
    db.from("crm_etapas").select("conversa_id").eq("org_id", org).like("etapa", "%veio_ao_workshop")
      .gte("em", `${ini > REGRA_ETAPAS_DESDE ? ini : REGRA_ETAPAS_DESDE}T00:00:00-03:00`).lte("em", `${hoje}T23:59:59.999-03:00`).limit(5000),
    // lista das inscricoes no workshop que a IA viu nas conversas (ate 24/11): as mesmas que o resumo_sdr2 conta na coluna workshop
    ini < INSCRICOES_CRM_DESDE
      ? db.from("auditorias").select("vendedor_id,conversas(data,canal,contato,contato_nome,telefone),ligacoes(iniciada_em,contato)").eq("org_id", org).eq("agendou", true)
          .or("tipo_agendamento.is.null,tipo_agendamento.eq.workshop").gte("criado_em", `${somaDias(ini, -15)}T00:00:00-03:00`).limit(5000)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const nomeDe = new Map(((rPerf.data ?? []) as Perfil[]).map((p) => [p.id, p.nome])); // quem vendeu, na lista de vendas do produto
  const equipe = new Set(((rInst.data ?? []) as { vendedor_id: string }[]).map((i) => i.vendedor_id));
  const time = ((rPerf.data ?? []) as Perfil[]).filter((p) => p.ativo && equipe.has(p.id));
  const sdrs = time.filter((p) => p.funcao !== "closer" && p.funcao !== "gestao");
  const closers = time.filter((p) => p.funcao === "closer");
  const ids = new Set(time.map((p) => p.id)), sdrIds = new Set(sdrs.map((p) => p.id));
  const linhas = ((rRes.data ?? []) as Linha[]).filter((l) => ids.has(l.vendedor_id));
  // vendas da IA: so de quem e do time; vendas do CRM e manuais entram todas (mesmo sem vendedor). Ja vem sem duplicar.
  const doTime = (r: { origem: string; vendedorId: string | null }) => r.origem !== "ia" || (r.vendedorId != null && ids.has(r.vendedorId));
  const vendas = resultados.linhas.filter((r) => contaNoFaturamento(r) && doTime(r));
  const noTime = resultados.linhas.filter((r) => contaNaQuantidade(r) && doTime(r)); // vendas + cortesias do workshop (quantidade)
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
  // "marcacoes" na TV = so inscricoes no workshop (reuniao de imersao marcada nao entra; pedido da gestao 25/11).
  // Ate 24/11: inscricoes que a IA viu nas conversas (coluna workshop do resumo_sdr2).
  // De 25/11 em diante: o mesmo modelo do faturamento do workshop = cartao que entrou em "Inscrito no workshop" no CRM
  // (pagas e cortesias, sem duplicar), do vendedor da linha de Resultados.
  const inscritosCrm = noTime.filter((r) => r.etapa === "inscrito_no_workshop" && r.produto === "workshop" && r.data >= INSCRICOES_CRM_DESDE);
  const inscricoesDe = (id: string) =>
    linhas.filter((l) => l.vendedor_id === id && l.dia < INSCRICOES_CRM_DESDE).reduce((s, l) => s + n(l.workshop), 0)
    + inscritosCrm.filter((r) => r.vendedorId === id).length;
  // lista das inscricoes (clicar no quadro do SDR na TV): conversa ate 24/11 + CRM desde 25/11, mais recente primeiro
  type AudIns = { vendedor_id: string; conversas: { data: string; canal: string | null; contato: string | null; contato_nome: string | null; telefone: string | null } | null; ligacoes: { iniciada_em: string; contato: string | null } | null };
  const diaSP = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));
  const insConversa = rIns.error ? null : ((rIns.data ?? []) as unknown as AudIns[]).map((a) => {
    const dia = a.conversas?.data ?? (a.ligacoes ? diaSP(a.ligacoes.iniciada_em) : "");
    const fone = a.conversas?.telefone || a.conversas?.contato || a.ligacoes?.contato || "";
    return { vendedor_id: a.vendedor_id, dia, importada: a.conversas?.canal === "importada", cliente: a.conversas?.contato_nome?.trim() || fone };
  }).filter((a) => !a.importada && a.dia >= ini && a.dia <= hoje && a.dia < INSCRICOES_CRM_DESDE);
  const listaInscricoes = (id: string): Inscricao[] | undefined => insConversa ? [
    ...inscritosCrm.filter((r) => r.vendedorId === id).map((r) => ({ cliente: r.cliente || "—", dia: r.data, origem: "crm" as const, cortesia: !!r.cortesia })),
    ...insConversa.filter((a) => a.vendedor_id === id).map((a) => ({ cliente: a.cliente || "—", dia: a.dia, origem: "conversa" as const })),
  ].sort((x, y) => y.dia.localeCompare(x.dia)).map(({ dia, ...r }) => ({ ...r, data: ddmm(dia) })) : undefined;
  const somaDe = (id: string) => ({ respostas: linhas.filter((l) => l.vendedor_id === id).reduce((s, l) => s + n(l.respostas), 0), marcacoes: inscricoesDe(id) });
  const metaConvDia = n(cfg.meta_sdr_conversas ?? 25), metaMarcDia = n(cfg.meta_sdr_marcacoes ?? 6);
  const metaConv = metaConvDia * diasUteisMes, metaMarc = metaMarcDia * diasUteisMes;
  const metaReun = n(cfg.meta_closer_reunioes) * diasUteisMes; // Configuracoes: reunioes de implementacao por dia util
  // funil do closer: cada cartao conta uma vez por etapa no periodo (vai e volta de coluna nao repete)
  type Etapa = { conversa_id: string; vendedor_id: string | null; etapa: string; em: string; crm_conversas: { contato_nome: string | null; telefone: string | null } | null };
  const etapas = rEtapas.error ? null : ((rEtapas.data ?? []) as unknown as Etapa[]);
  // Reunioes realizadas (closer) = cartao que ENTROU em "Diagnostico realizado" no funil do CRM, no periodo (historico de etapas,
  // desde 12/11/2026), do vendedor dono da conversa. So a etapa conta (pedido da gestao, 25/11). A mesma conversa conta uma vez.
  const noFunil = (id: string, fim: string) => new Set((etapas ?? []).filter((e) => e.vendedor_id === id && e.etapa.endsWith(fim)).map((e) => e.conversa_id)).size;
  // lista das reunioes (clicar no quadro do closer na TV): cada cartao uma vez, no dia da primeira entrada no periodo, mais recente primeiro
  // reunioes agendadas = entrou em "Reuniao de diagnostico" (o diagnostico agendado do funil Vendas 2; codigo custom_vendas_2_reuniao_de_diagnostico)
  const listaReunioes = (id: string, fim = "diagnostico_realizado") => {
    const porConversa = new Map<string, Etapa>();
    for (const e of etapas ?? []) if (e.vendedor_id === id && e.etapa.endsWith(fim) && (!porConversa.has(e.conversa_id) || e.em < porConversa.get(e.conversa_id)!.em)) porConversa.set(e.conversa_id, e);
    return [...porConversa.values()].sort((x, y) => y.em.localeCompare(x.em))
      .map((e) => ({ cliente: e.crm_conversas?.contato_nome?.trim() || e.crm_conversas?.telefone || "—", data: quandoBR(e.em) }));
  };
  // retrato com mais de 1 h = worker parado: melhor nao mostrar numero velho
  type Fup = { vendedor_id: string; qtd: number; mais_antigo_dias: number | null; dias_regra: number | null; calculado_em: string; leads?: { nome: string; desde: string | null; dias: number; sem_resposta: boolean }[] | null };
  const quandoBR = (iso: string | null) => (iso ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(",", "") : "—");
  const fups = new Map(((rFup.error ? [] : rFup.data ?? []) as Fup[]).filter((f) => Date.now() - Date.parse(f.calculado_em) < 3600_000).map((f) => [f.vendedor_id, f]));
  const followupsDe = (id: string) => { const f = fups.get(id); return f ? { qtd: n(f.qtd), maisAntigo: f.mais_antigo_dias, dias: n(f.dias_regra ?? cfg.followup_alerta_d ?? 6),
    ...(Array.isArray(f.leads) ? { lista: f.leads.map((l) => ({ nome: l.nome, quando: quandoBR(l.desde), dias: n(l.dias), semResposta: !!l.sem_resposta })) } : {}) } : null; };
  const pessoa = (p: Perfil, tipo: "sdr" | "closer"): Pessoa => {
    const vs = vendas.filter((v) => v.vendedorId === p.id), t = somaDe(p.id);
    return {
      id: p.id, nome: p.nome, sigla: sigla(p.nome), foto: p.foto_url, tipo,
      conversas: tipo === "sdr" ? { v: t.respostas, meta: metaConv } : null,
      marcacoes: tipo === "sdr" ? { v: t.marcacoes, meta: metaMarc, lista: listaInscricoes(p.id) } : null,
      vendasValor: vs.reduce((s, v) => s + (v.valor ?? 0), 0), vendasN: vs.length,
      // meta das agendadas = a mesma das realizadas (Configuracoes: reunioes por dia util), ate ter meta propria
      agendadas: tipo === "closer" && etapas ? { v: noFunil(p.id, "reuniao_de_diagnostico"), meta: metaReun || null, lista: listaReunioes(p.id, "reuniao_de_diagnostico") } : null,
      reunioes: tipo === "closer" && etapas && metaReun ? { v: noFunil(p.id, "diagnostico_realizado"), meta: metaReun, lista: listaReunioes(p.id) } : null,
      followups: followupsDe(p.id), // SDR e closer: mesma regra (retrato do worker)
      // so SDR: leads dele sem retorno ha mais de 15 min (mesma conta do quadro do time), da espera mais longa para a mais curta
      semRetorno: tipo === "sdr" && semLista ? { qtd: semLista.filter((c) => c.vendedor_id === p.id).length, lista: semLista.filter((c) => c.vendedor_id === p.id).slice(0, 100).map(itemSem) } : null,
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
  const conversasTime = sdrLinhas.reduce((s, l) => s + n(l.respostas), 0), marcacoesTime = sdrs.reduce((s, p) => s + inscricoesDe(p.id), 0);
  type Sem = { vendedor_id: string; contato: string; contato_nome: string | null; ultima_msg_em: string; texto: string | null };
  const semLista = rSem.error ? null : ((rSem.data ?? []) as Sem[]).filter((c) => ids.has(c.vendedor_id));
  const semRetorno = semLista ? semLista.length : null;
  const espera = (iso: string) => {
    const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    if (min < 60) return `${min} min`;
    if (min < 1440) return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`;
    const d = Math.floor(min / 1440);
    return `${d} dia${d === 1 ? "" : "s"}`;
  };
  // ja vem da mais antiga para a mais nova
  const itemSem = (c: Sem) => ({ cliente: c.contato_nome || c.contato || "Cliente sem nome", vendedor: nomeDe.get(c.vendedor_id) ?? null,
    quando: quandoBR(c.ultima_msg_em), espera: espera(c.ultima_msg_em), texto: String(c.texto ?? "").replace(/s+/g, " ").trim().slice(0, 140) });
  // modal do quadro do time: as 100 esperas mais longas (o numero do quadro e o total)
  const listaSem = (semLista ?? []).slice(0, 100).map(itemSem);
  const contraMeta = (v: number, metaDia: number): Kpi => {
    const meta = metaDia * diasUteisMes * sdrs.length;
    if (!meta) return { valor: inteiro(v), sub: "sem SDR cadastrado", tom: "neutro" };
    const pct = (v / meta) * 100, dif = pct - ritmoPct;
    return { valor: inteiro(v), sub: `de ${inteiro(meta)} · ${Math.round(pct)}% da meta`, tom: tomPorDiferenca(dif), selo: seloRitmo(dif), pct };
  };
  const kpis: VisaoGeralDados["kpis"] = {
    semretorno: semRetorno === null ? { valor: null, sub: "não foi possível ler agora", tom: "neutro" }
      : { valor: semRetorno >= 500 ? "500+" : String(semRetorno), sub: "o lead escreveu e ficou mais de 15 min sem resposta", tom: semRetorno > 0 ? "bad" : "ok", lista: listaSem },
    primeira: priMedia === null ? { valor: null, sub: "sem conversas auditadas no período", tom: "neutro" }
      : { valor: duracao(priMedia), sub: "média do período", tom: priMedia / 60 <= sla ? "ok" : "bad", selo: priMedia / 60 <= sla ? `dentro de ${sla} min` : `acima de ${sla} min` },
    nota: tot.aud ? { valor: nota(tot.nota / tot.aud), sub: `${inteiro(tot.aud)} auditadas no período`, tom: tot.nota / tot.aud >= 7 ? "ok" : tot.nota / tot.aud >= 4 ? "warn" : "bad" } : { valor: null, sub: "sem auditorias no período", tom: "neutro" },
    tempo_medio: medio === null ? { valor: null, sub: "sem conversas auditadas no período", tom: "neutro" }
      : { valor: duracao(medio), sub: "a cada vez que o lead escreve · média do período", tom: medio <= 300 ? "ok" : medio <= 1800 ? "warn" : "bad" },
    ligacoes: { valor: inteiro(tot.atend), sub: `de ${inteiro(tot.lig)} ligações no período`, tom: "neutro" },
    conversas_time: contraMeta(conversasTime, metaConvDia),
    marcacoes_time: contraMeta(marcacoesTime, metaMarcDia),
    convites: { valor: inteiro(resultados.convites.filter((id) => ids.has(id)).length), sub: "cupom 100%, Carbone ou cortesia · R$ 0", tom: "neutro" },
  };

  // conversao do workshop = vendas fechadas / quem veio ao workshop, no periodo do filtro. Workshop nao entra: e a entrada.
  // So conta de 24/11 em diante (antes disso o CRM da Weevo nao tem a presenca no workshop): cartoes que entraram em
  // "Venda fechada" (Ganho do funil Vendas) / cartoes que entraram em "Veio ao workshop" (funil Workshop).
  // Periodo todo antes de 24/11: null (o card avisa que a conversao comeca em 24/11).
  const ALTOS = ["imersao", "incompany", "plataforma"];
  const fechadas = vendas.filter((v) => v.data >= REGRA_ETAPAS_DESDE && v.etapa === "venda_fechada");
  const negocio = (v: { chave: string }) => v.chave.replace(/#\d+$/, ""); // um negocio com 2 produtos e uma venda fechada so
  const conversao = rPres.error || hoje < REGRA_ETAPAS_DESDE ? null : {
    presentes: new Set(((rPres.data ?? []) as { conversa_id: string }[]).map((e) => e.conversa_id)).size,
    total: new Set(fechadas.map(negocio)).size,
    produtos: ALTOS.map((produto) => ({ produto, vendas: new Set(fechadas.filter((v) => v.produto === produto).map(negocio)).size })),
  };

  return {
    demo: false,
    atualizadoEm: horaBR(),
    periodo: { p: periodo.p, de: ini, ate: hoje, mensal, rotulo: periodo.rotulo, intervalo: mensal ? `01 a ${fim.slice(8)}/${fim.slice(5, 7)}` : ini === hoje ? ddmm(ini) : `${ddmm(ini)} a ${ddmm(hoje)}`, diaUtil, diasUteisMes },
    fat: { real: acc, meta: mensal && cfg.meta_fat_mes != null ? Number(cfg.meta_fat_mes) : null, serie, datasUteis: diasEntre(ini, fim).filter(util).map(ddmm),
      porProduto: ORDEM_PRODUTOS.map((produto) => {
        // quantidade: vendas + cortesias do workshop (R$ 0, desde 24/11); valor: so o que soma no faturamento
        const l = noTime.filter((v) => (v.produto ?? "outro") === produto);
        const lista = l.map((v) => ({ cliente: v.cliente || "Cliente sem nome", empresa: v.empresa, vendedor: v.vendedorId ? nomeDe.get(v.vendedorId) ?? null : null, data: ddmm(v.data), valor: v.valor ?? 0, ...(v.cortesia ? { cortesia: true } : {}) }))
          .sort((a, b) => b.valor - a.valor);
        return { produto, valor: l.reduce((t, v) => t + (v.valor ?? 0), 0), n: l.length, vendas: lista };
      }).filter((x) => x.n > 0).sort((a, b) => b.valor - a.valor) }, // do produto que mais vendeu para o que menos vendeu
    conversao,
    pessoas: [...sdrs.map((p) => pessoa(p, "sdr")), ...closers.map((p) => pessoa(p, "closer"))],
    quadros: resolverQuadros(cfg.tv_quadros),
    kpis,
  };
}

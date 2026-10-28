import { chamarIA } from "./ia.js";
import { cfg, today, addDays, dayStart } from "./config.js";

const GAT = { personalizacao: "Personalização", pergunta_aberta: "Pergunta aberta", beneficio_claro: "Benefício claro", prova_social: "Prova social", autoridade: "Autoridade", escassez_urgencia: "Escassez/urgência", reciprocidade: "Reciprocidade", tratamento_objecao: "Tratamento de objeção", chamada_para_acao: "Chamada para ação", followup: "Follow-up" };

const PROMPT = `Voce e um consultor comercial senior (vendas consultivas por WhatsApp, convite para workshop, tom brasileiro, informal e direto). Recebera numeros e auditorias de conversas de um time comercial. Escreva uma analise para o gestor, em portugues do Brasil, SEM travessao como pontuacao, com estas secoes curtas (titulos com ##):
## Veredito (2 a 3 frases: o time esta trabalhando da forma correta? por que?)
## O que esta funcionando
## Gatilhos comerciais (quais sao usados, quais faltam e o impacto provavel; cite os percentuais)
## Erros recorrentes
## Objecoes e como tratar (respostas prontas e curtas)
## Leitura de mercado (boas praticas de prospeccao por WhatsApp para esse convite: ritmo de follow-up, horarios, tamanho da mensagem, riscos de bloqueio. Seja honesto: vem de boas praticas gerais e dos dados da equipe, nao de pesquisa em tempo real)
## Acoes para esta semana (3 a 5 itens numerados)
Nao invente numeros fora dos dados. Com poucas conversas auditadas, avise que a amostra e pequena e as conclusoes sao preliminares.`;

// org: empresa do pedido (cada empresa ve a analise so do proprio time)
export async function gerarTexto(db, periodo, fetchImpl = fetch, org = null) {
  const back = periodo === "30" ? 29 : periodo === "7" ? 6 : 0;
  const from = addDays(today(), -back);
  const [auds, todoResumo, perfis] = await Promise.all([
    db.selectAll("auditorias", { filters: { atualizado_em: `gte.${dayStart(from)}`, ...(org ? { org_id: `eq.${org}` } : {}) } }),
    db.rpc("resumo_por_vendedor", { p_from: from, p_to: today() }),
    db.select("profiles", { select: "id,nome" }),
  ]);
  const doTime = new Set(auds.map(a => a.vendedor_id));
  const resumo = org ? todoResumo.filter(r => doTime.has(r.vendedor_id)) : todoResumo;
  if (!auds.length) throw new Error("Ainda não há conversas auditadas neste período.");
  const nome = id => perfis.find(p => p.id === id)?.nome || id;
  const n = auds.length;
  const obj = {};
  for (const a of auds) { const k = (a.objecoes || "").trim().toLowerCase().slice(0, 60); if (k) obj[k] = (obj[k] || 0) + 1; }
  const etapas = {}; for (const a of auds) if (a.etapa) etapas[a.etapa] = (etapas[a.etapa] || 0) + 1;
  const dados = {
    periodo: periodo === "hoje" ? "hoje" : `ultimos ${periodo} dias`, auditadas: n,
    nota_media: +(auds.reduce((s, a) => s + Number(a.nota_geral), 0) / n).toFixed(1),
    qualidade: { boa: auds.filter(a => a.qualidade === "boa").length, regular: auds.filter(a => a.qualidade === "regular").length, ruim: auds.filter(a => a.qualidade === "ruim").length },
    agendamentos: auds.filter(a => a.agendou).length,
    gatilhos_percentual: Object.fromEntries(Object.entries(GAT).map(([k, t]) => [t, Math.round((auds.filter(a => a.gatilhos?.[k]).length / n) * 100)])),
    etapas, objecoes_mais_comuns: Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 8),
    por_vendedor: resumo.map(r => ({ vendedor: nome(r.vendedor_id), ...r, vendedor_id: undefined, nota_media: (() => { const x = auds.filter(a => a.vendedor_id === r.vendedor_id); return x.length ? +(x.reduce((s, a) => s + Number(a.nota_geral), 0) / x.length).toFixed(1) : null; })() })),
    amostra: auds.slice(0, 40).map(a => ({ vendedor: nome(a.vendedor_id), nota: a.nota_geral, resumo: a.resumo, melhorar: a.pontos_melhoria })),
  };
  return chamarIA({ system: PROMPT, user: JSON.stringify(dados), maxTokens: 2200, fetchImpl });
}

// Atende os pedidos criados no painel (status 'pendente') e cria uma analise diaria depois das 20h
export async function processAnalyses(db, opts = {}) {
  const hora = new Date().toLocaleString("en-US", { hour: "2-digit", hour12: false, timeZone: cfg.tz });
  if (hora >= "20" && hora !== "24") {
    const feitas = await db.select("analises_time", { select: "id", filters: { criado_em: `gte.${dayStart(today())}` }, limit: 1 });
    if (!feitas.length) await db.insert("analises_time", [{ periodo: "7", status: "pendente" }], { returning: false });
  }
  const pend = await db.select("analises_time", { filters: { status: "eq.pendente" }, order: "criado_em", limit: 3 });
  for (const p of pend) {
    try { await db.update("analises_time", { id: `eq.${p.id}` }, { status: "pronta", texto: await gerarTexto(db, p.periodo, opts.fetchImpl, p.org_id || null) }); }
    catch (e) { await db.update("analises_time", { id: `eq.${p.id}` }, { status: "erro", erro: String(e.message).slice(0, 300) }); }
  }
  return pend.length;
}

import { z } from "zod";
import { cfg, today, addDays, dayStart } from "./config.js";
import { chamarIA, extrairJson, modeloAtual, provedor } from "./ia.js";
import { avisarEventos } from "./alertas.js";
import { sincronizarReuniao } from "./agenda.js";

// =====================================================================
// Configuracoes da tela Configuracoes (audit_settings + rubricas + numeros ignorados)
// =====================================================================
export const PADRAO_MIN_MSGS = 4;
export const PADRAO_AMOSTRA = 100;

const RUBRICA_RESERVA = [ // so se o banco estiver sem rubrica
  { chave: "abordagem", nome: "Abordagem", descricao: "Saudação, personalização e tom.", peso: 25 },
  { chave: "descoberta", nome: "Descoberta", descricao: "Entende o momento do lead.", peso: 25 },
  { chave: "conducao", nome: "Condução", descricao: "Propõe próximo passo concreto.", peso: 50 },
];

export async function carregarRegras(db) {
  const [[s = {}], crit, ign, perfis, [roteiroRow], tels] = await Promise.all([
    db.select("audit_settings", { filters: { id: "eq.1" } }),
    db.select("criterios_rubrica", { select: "rubrica,chave,nome,descricao,peso,ativo,posicao", filters: { ativo: "eq.true" }, order: "posicao" }),
    db.select("numeros_ignorados", { select: "telefone" }),
    db.select("profiles", { select: "id,nome,funcao" }),
    db.select("config_auditoria", { filters: { id: "eq.1" } }),
    db.select("telefones_alerta", { select: "telefone" }),
  ]);
  const rub = r => crit.filter(c => c.rubrica === r && Number(c.peso) > 0);
  return {
    s: {
      auditoria_automatica: s.auditoria_automatica ?? true, escopo_conversas: s.escopo_conversas || "individual",
      min_mensagens: s.min_mensagens ?? PADRAO_MIN_MSGS, amostragem_pct: s.amostragem_pct ?? PADRAO_AMOSTRA, so_com_proposta: !!s.so_com_proposta,
      regras_criticas: s.regras_criticas || [], sla_min: s.sla_primeira_resposta_min ?? 15, rubrica_modo: s.rubrica_modo || "sistema",
      // minutos parada para auditar durante o dia; null = so na rodada final
      parada_min: "auditoria_parada_min" in s ? s.auditoria_parada_min : cfg.idleMin, historico_dias: s.historico_dias ?? 7,
      venda_conta: s.venda_conta || [], venda_nao_conta: s.venda_nao_conta || [], oportunidade_conta: s.oportunidade_conta || [], oportunidade_nao_conta: s.oportunidade_nao_conta || [],
    },
    rubricas: { sdr: rub("sdr"), closer: rub("closer"), personalizada: rub("personalizada") },
    ignorados: new Set(ign.map(i => chaveTelefone(i.telefone))),
    funcao: new Map(perfis.map(p => [p.id, p.funcao === "closer" ? "closer" : "sdr"])),
    nomes: new Map(perfis.map(p => [p.id, p.nome])),
    roteiro: roteiroRow?.roteiro || "",
    // avisos de venda, marcacao e oportunidade no WhatsApp do gestor
    alertas: { venda: s.alerta_venda ?? true, marcacao: s.alerta_marcacao ?? true, oportunidade: s.alerta_oportunidade ?? false, formato: s.alerta_formato || "detalhado", instancia: s.instancia_envio_id || null, telefones: tels.map(t => t.telefone) },
  };
}
export const rubricaDe = (R, vendedorId) => {
  const funcao = R.funcao.get(vendedorId) || "sdr";
  const l = R.s.rubrica_modo === "personalizada" && R.rubricas.personalizada.length ? R.rubricas.personalizada : R.rubricas[funcao];
  return { funcao, rubrica: R.s.rubrica_modo === "personalizada" && R.rubricas.personalizada.length ? "personalizada" : funcao, criterios: l.length ? l : RUBRICA_RESERVA };
};

// Telefone comparavel: DDD + 8 ultimos digitos no Brasil (ignora o 9 extra e o 55); outros, so digitos
export function chaveTelefone(t) {
  const d = String(t || "").replace(/\D/g, "");
  if (/^55\d{10,11}$/.test(d)) return d.slice(2, 4) + d.slice(-8);
  if (/^\d{10,11}$/.test(d)) return d.slice(0, 2) + d.slice(-8);
  return d;
}
// Amostragem estavel: a mesma conversa sempre cai do mesmo lado do sorteio
export const naAmostra = (id, pct) => {
  if (pct >= 100) return true;
  let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 100 < pct;
};
// "So conversas em proposta": a conversa ja chegou em valores, inscricao, link, cupom ou marcacao
const PROPOSTA = /(r\$|\bvalor|pre[cç]o|investimento|inscri[cç]|inscrev|\blink\b|cupom|\bvaga|pagamento|\bpix\b|boleto|cart[aã]o|parcel|reuni[aã]o|agendar|agenda|hor[aá]rio|\bdata\b)/i;

// =====================================================================
// Prompt
// =====================================================================
const lista = (l, vazio = "- (nenhuma regra extra)") => (l.filter(x => String(x).trim()).length ? l.filter(x => String(x).trim()).map(x => `- ${x}`).join("\n") : vazio);
const fmtSeg = s => (s == null ? "sem resposta do vendedor depois do lead" : s < 60 ? `${s}s` : `${Math.round(s / 60)} min`);

export function montarPrompt(R, { funcao, criterios }, { primeiraResposta } = {}) {
  const s = R.s;
  const papel = funcao === "closer"
    ? `Este vendedor é CLOSER. Venda = imersão FECHADA (lead aceitou e pagou ou assinou), com o valor. Reunião de implementação marcada NÃO é venda: é oportunidade do tipo "reuniao_implementacao". Interesse claro na imersão sem fechar = oportunidade "interesse_imersao". Em "agendou", marque true quando a reunião de implementação foi marcada (tipo_agendamento "imersao").`
    : `Este vendedor é SDR. Venda = inscrição no WORKSHOP confirmada, separada com cuidado em dois tipos: CONVITE = o lead entra com o cupom de convite que zera o ingresso (100% de desconto, R$ 0): "cupom" true e "valor" 0. VENDIDO = o lead pagou o ingresso (pix, cartão, link de pagamento pago, comprovante enviado): "cupom" false e "valor" = quanto pagou; cupom de desconto PARCIAL (ex.: 50%) com pagamento também é VENDIDO, com o valor pago. Lead que aceitou, reservou ou recebeu o link mas ainda não pagou nem usou o convite NÃO é venda ainda: é oportunidade "interesse_workshop". Na dúvida entre convite e vendido, use a evidência da conversa (valor, cupom, comprovante) e explique em "evidencia". Reunião para a imersão marcada NÃO é venda: é oportunidade do tipo "reuniao_imersao". Interesse claro no workshop ou na imersão sem fechar = oportunidade "interesse_workshop" ou "interesse_imersao". Em "agendou", marque true quando o lead se inscreveu no workshop (tipo_agendamento "workshop") ou marcou a reunião de imersão (tipo_agendamento "imersao").`;
  return `Você é o Auditor comercial da Weevo. Avalia conversas de WhatsApp (e transcrições de ligações) entre um vendedor da Weevo e um lead. Escreva em português do Brasil, direto e prático.

## Contexto
O SDR convida leads indicados para o workshop (inscrição; existe cupom de convite 100%, que deixa o valor em R$ 0) ou marca reunião para a imersão. O Closer faz a reunião de implementação e fecha a imersão.
${papel}

## Perfil de auditoria: venda consultiva (pilares do G4 Educação)
Audite como um gestor comercial exigente de uma máquina de vendas previsível:
- Pré-vendas e fechamento têm papéis diferentes: o SDR qualifica e gera o compromisso (inscrição ou reunião); o Closer diagnostica, negocia e fecha. Cobre cada um pelo seu papel.
- Qualificação antes do convite: dor real, momento, quem decide e timing. Convite sem entender o lead é falha, mesmo que o lead aceite.
- Valor antes de preço: o vendedor liga a dor do lead ao ganho concreto e usa prova social (indicação, resultados de quem participou).
- Objeção é sinal de interesse: bom vendedor acolhe, pergunta para achar a objeção real, responde com argumento ou prova e retoma o próximo passo. Aceitar o "vou pensar" sem data é falha.
- Toda conversa termina com próximo passo concreto: data e horário, link, cupom ou reunião confirmada. Pergunta fechada do tipo "topa?" sem opções é fraca; duas opções de horário é forte.
- WhatsApp: resposta rápida (dentro do SLA), mensagens curtas, uma pergunta por vez, áudio curto só quando ajuda, nada de textão genérico copiado.
- Follow-up com cadência e motivo novo; "e aí, conseguiu ver?" sem valor é follow-up fraco.
- Seja direto e específico nos pontos de melhoria: diga o que o vendedor deveria ter escrito ou perguntado, com um exemplo de frase.

## O que o gestor definiu como venda
Conta como venda:
${lista(s.venda_conta)}
Não conta como venda:
${lista(s.venda_nao_conta)}

## O que o gestor definiu como oportunidade
Conta:
${lista(s.oportunidade_conta)}
Não conta:
${lista(s.oportunidade_nao_conta)}

## Situações críticas
Régua padrão: lead furioso prestes a desistir, conduta grave ou desrespeitosa do vendedor, risco jurídico, venda grande sendo perdida agora. Regras do gestor (somam com a régua padrão):
${lista(s.regras_criticas)}

## Agilidade
SLA de primeira resposta: ${s.sla_min} min. Primeira resposta medida nesta conversa: ${fmtSeg(primeiraResposta)}. Use isso no critério de agilidade, se existir.
${R.roteiro ? `\n## Roteiro de referência da Weevo\n${R.roteiro}\n` : ""}
## Rubrica
Dê nota de 1 a 5 em cada critério (1 = não fez, 3 = fez em parte, 5 = fez muito bem) com uma justificativa curta:
${criterios.map(c => `- ${c.chave}: ${c.nome}. ${c.descricao || ""}`.trim()).join("\n")}

## Regras
- VENDEDOR = nosso vendedor, CLIENTE = o lead. Em ligações a transcrição pode vir sem separar quem fala.
- Mensagens automáticas (chatbot, menus, respostas automáticas, inclusive de bots do lead) não entram na nota. Se a conversa inteira for de bot, marque "conversa_so_bot": true.
- Nos exemplos de frase, use o nome real do vendedor e do lead (vêm no início do texto). Os nomes do roteiro são só exemplos.
- Se vier um HISTÓRICO DOS DIAS ANTERIORES, use só como contexto (o que já foi falado, prometido, follow-up). A nota, a venda e a oportunidade são sobre a CONVERSA DO DIA.
- Não invente fatos que não estão no texto. Na dúvida, venda e oportunidade ficam false.
- Reunião: preencha "reuniao" quando uma reunião (de implementação ou de imersão) teve data e hora combinadas. Leia a conversa como um todo para saber se a reunião ficou MARCADA (acordo dos dois lados sobre dia e hora), sem exigir palavras exatas. "cliente_confirmou" = o lead topou aquele dia e hora (aceitou a proposta do vendedor, ou foi ele quem propôs e seguiu na conversa). "vendedor_confirmou" = o vendedor fechou do lado dele: aceitou a proposta do lead ("perfeito", "show, te espero"), recebeu o aceite da proposta que ele fez ("pode ser", "fechado", "combinado", "beleza"), já está acertando os detalhes da reunião (online ou presencial, link, endereço) ou mandou o convite/link. Marque false quando a conversa termina com pergunta ainda sem resposta sobre o horário ("posso confirmar?" e o lead não respondeu nada que indique sim), quando ainda estão escolhendo entre opções de horário, ou quando o lead ficou de ver/retornar. Hoje é ${hojeExtenso()}; cada mensagem traz [dia/mês hora], use isso para transformar "amanhã", "quinta às 19h" em data AAAA-MM-DD e hora HH:MM. "modalidade": "online" (videochamada, Meet, Zoom) ou "presencial"; "local" só o endereço ou lugar quando presencial. "cliente_nome", "empresa" e "email" só se aparecerem na conversa ou no nome do contato. Se não houver reunião com horário, "reuniao": null.

Responda APENAS com um JSON neste formato:
{"notas": [${criterios.map(c => `{"criterio": "${c.chave}", "nota": 1 a 5, "justificativa": "curta"}`).join(", ")}],
"qualidade": "boa"|"regular"|"ruim", "etapa": "abertura"|"descoberta"|"proposta"|"objecao"|"agendamento"|"perdido"|"sem_resposta", "efetiva": true|false,
"agendou": true|false, "tipo_agendamento": "workshop"|"imersao"|null,
"venda": {"detectada": true|false, "tipo": "workshop"|"imersao"|null, "valor": número em reais ou null, "cupom": true só para convite 100% (R$ 0)|false, "evidencia": "trecho ou explicação curta"},
"oportunidade": {"detectada": true|false, "tipo": "interesse_workshop"|"interesse_imersao"|"reuniao_imersao"|"reuniao_implementacao"|null, "evidencia": "curta"},
"critico": {"detectado": true|false, "motivo": "curto ou vazio"},
"conversa_so_bot": true|false,
"reuniao": null ou {"tipo": "implementacao"|"imersao", "cliente_confirmou": true|false, "vendedor_confirmou": true|false, "data": "AAAA-MM-DD", "hora": "HH:MM", "duracao_min": número ou null, "modalidade": "online"|"presencial"|null, "local": "endereço ou vazio", "cliente_nome": "nome ou vazio", "empresa": "empresa ou vazio", "email": "email ou vazio"},
"gatilhos": {"personalizacao": bool, "pergunta_aberta": bool, "beneficio_claro": bool, "prova_social": bool, "autoridade": bool, "escassez_urgencia": bool, "reciprocidade": bool, "tratamento_objecao": bool, "chamada_para_acao": bool, "followup": bool},
"resumo": "até 2 frases", "pontos_fortes": "até 2 pontos curtos", "pontos_melhoria": "até 2 ações práticas, cada uma com exemplo de frase", "objecoes": "objeções do lead ou vazio"}`;
}

// =====================================================================
// Validacao da resposta (zod) e nota final
// =====================================================================
const bool = z.preprocess(v => v === true || v === "true", z.boolean());
const txt = z.preprocess(v => (v == null ? "" : String(v)), z.string());
const opc = vals => z.preprocess(v => (vals.includes(v) ? v : null), z.enum(vals).nullable());
const Resposta = z.object({
  notas: z.array(z.object({ criterio: z.string(), nota: z.coerce.number().min(1).max(5), justificativa: txt.default("") })).min(1),
  qualidade: opc(["boa", "regular", "ruim"]).default(null),
  etapa: txt.default(""),
  efetiva: bool.default(false),
  agendou: bool.default(false),
  tipo_agendamento: opc(["workshop", "imersao"]).default(null),
  venda: z.object({ detectada: bool.default(false), tipo: opc(["workshop", "imersao"]).default(null), valor: z.preprocess(v => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v)), z.number().min(0).nullable()).default(null), cupom: bool.default(false), evidencia: txt.default("") }).default({}),
  oportunidade: z.object({ detectada: bool.default(false), tipo: opc(["interesse_workshop", "interesse_imersao", "reuniao_imersao", "reuniao_implementacao"]).default(null), evidencia: txt.default("") }).default({}),
  critico: z.object({ detectado: bool.default(false), motivo: txt.default("") }).default({}),
  conversa_so_bot: bool.default(false),
  reuniao: z.preprocess(v => (v && typeof v === "object" ? v : null), z.object({
    tipo: opc(["implementacao", "imersao"]).default(null), cliente_confirmou: bool.default(false), vendedor_confirmou: bool.default(false),
    data: z.preprocess(v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? v : null), z.string().nullable()).default(null),
    hora: z.preprocess(v => (/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(v)) ? String(v).padStart(5, "0") : null), z.string().nullable()).default(null),
    duracao_min: z.preprocess(v => (Number(v) > 0 && Number(v) <= 480 ? Number(v) : null), z.number().nullable()).default(null),
    modalidade: opc(["online", "presencial"]).default(null), local: txt.default(""), cliente_nome: txt.default(""), empresa: txt.default(""),
    email: z.preprocess(v => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim()) ? String(v).trim().toLowerCase() : ""), z.string()).default(""),
  }).nullable()).default(null),
  gatilhos: z.record(z.any()).default({}),
  resumo: txt.default(""), pontos_fortes: txt.default(""), pontos_melhoria: txt.default(""), objecoes: txt.default(""),
});

// Nota final = media ponderada (1 a 5) convertida para 0 a 10. Criterio que a IA nao avaliou nao entra.
export function notaFinal(criterios, notas) {
  const por = new Map(notas.map(n => [n.criterio, n.nota]));
  const usados = criterios.filter(c => por.has(c.chave));
  const peso = usados.reduce((s, c) => s + Number(c.peso), 0);
  if (!peso) return 0;
  const media = usados.reduce((s, c) => s + por.get(c.chave) * Number(c.peso), 0) / peso;
  return Math.round(((media - 1) / 4) * 100) / 10;
}

export function interpretar(bruto, { funcao, rubrica, criterios }) {
  const a = Resposta.parse(bruto);
  const nota = a.conversa_so_bot ? 0 : notaFinal(criterios, a.notas);
  const por = new Map(a.notas.map(n => [n.criterio, n]));
  // Venda coerente com a funcao: SDR vende workshop, Closer vende imersao
  const vendaTipo = a.venda.detectada ? (funcao === "closer" ? "imersao" : a.venda.tipo || "workshop") : null;
  // Convite = cupom 100% (R$ 0). Cupom com valor pago acima de zero e desconto parcial: conta como vendido.
  const convite = !!(a.venda.detectada && vendaTipo === "workshop" && a.venda.cupom && !(Number(a.venda.valor) > 0));
  return {
    nota_geral: nota, rubrica,
    notas_1a5: criterios.filter(c => por.has(c.chave)).map(c => ({ chave: c.chave, nome: c.nome, peso: Number(c.peso), nota: por.get(c.chave).nota, justificativa: por.get(c.chave).justificativa })),
    notas: Object.fromEntries(criterios.filter(c => por.has(c.chave)).map(c => [c.chave, Math.round(((por.get(c.chave).nota - 1) / 4) * 100) / 10])),
    qualidade: a.qualidade || (nota >= 7 ? "boa" : nota >= 4 ? "regular" : "ruim"),
    etapa: a.etapa, efetiva: a.efetiva, agendou: a.agendou,
    tipo_agendamento: a.agendou ? (funcao === "closer" ? "imersao" : a.tipo_agendamento || "workshop") : null,
    venda: a.venda.detectada, venda_tipo: vendaTipo, venda_valor: a.venda.detectada ? (convite ? 0 : a.venda.valor) : null,
    venda_cupom: convite, venda_evidencia: a.venda.detectada ? a.venda.evidencia : null,
    oportunidade: a.oportunidade.detectada, oportunidade_tipo: a.oportunidade.detectada ? a.oportunidade.tipo : null, oportunidade_evidencia: a.oportunidade.detectada ? a.oportunidade.evidencia : null,
    critico: a.critico.detectado, critico_motivo: a.critico.detectado ? a.critico.motivo : null,
    so_bot: a.conversa_so_bot,
    reuniao: a.reuniao && a.reuniao.data && a.reuniao.hora ? a.reuniao : null,
    gatilhos: a.gatilhos, resumo: a.resumo, pontos_fortes: a.pontos_fortes, pontos_melhoria: a.pontos_melhoria, objecoes: a.objecoes,
    modelo: modeloAtual(), atualizado_em: new Date().toISOString(), sheet_ok: false,
  };
}

export async function auditarTexto(R, vendedorId, texto, extra, fetchImpl) {
  const rub = rubricaDe(R, vendedorId);
  const resposta = await chamarIA({ system: montarPrompt(R, rub, extra), user: texto, maxTokens: 2000, json: true, fetchImpl });
  return interpretar(extrairJson(resposta), rub);
}

// =====================================================================
// Tempos de resposta do SDR. Cada sequencia de mensagens do lead conta uma vez, a partir da primeira dela,
// ate a proxima mensagem do SDR. A primeira resposta e a primeira dessas medidas.
// =====================================================================
export function temposResposta(msgs) {
  const ord = [...msgs].filter(m => m.enviada_em).sort((a, b) => String(a.enviada_em).localeCompare(String(b.enviada_em)));
  const esperas = []; let leadDesde = null;
  for (const m of ord) {
    if (m.remetente === "cliente") { if (leadDesde === null) leadDesde = Date.parse(m.enviada_em); }
    else if (leadDesde !== null) { esperas.push(Math.max(0, Math.round((Date.parse(m.enviada_em) - leadDesde) / 1000))); leadDesde = null; }
  }
  if (!esperas.length) return { primeira_resposta_seg: null, tempo_medio_resposta_seg: null, respostas_sdr: 0 };
  return { primeira_resposta_seg: esperas[0], tempo_medio_resposta_seg: Math.round(esperas.reduce((a, b) => a + b, 0) / esperas.length), respostas_sdr: esperas.length };
}

// cada mensagem com [dia/mes hora] (Brasilia), para a IA resolver "amanha", "quinta as 19h"
const quando = iso => (iso ? `[${new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: cfg.tz }).format(new Date(iso)).replace(",", "")}] ` : "");
const hojeExtenso = () => new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", timeZone: cfg.tz }).format(new Date());
const linha = m => `${quando(m.enviada_em)}${m.remetente === "vendedor" ? "VENDEDOR" : "CLIENTE"}: ${m.tipo === "audio" ? `[audio] ${m.transcricao || ""}` : m.texto || `[${m.tipo}]`}`;
const cortar = t => (t.length > 14000 ? t.slice(t.length - 14000) : t);

// Conversas dos dias anteriores com o mesmo lead (mesmo WhatsApp), so como contexto para a IA
async function historico(db, c, dias) {
  if (!dias || !c.instancia_id || !c.data || c.canal === "importada") return "";
  const ant = await db.select("conversas", { select: "id,data", filters: { instancia_id: `eq.${c.instancia_id}`, contato: `eq.${c.contato}`, data: `lt.${c.data}` }, order: "data", limit: 40 });
  const desde = addDays(c.data, -dias);
  const blocos = [];
  for (const a of ant.filter(x => x.data >= desde)) {
    const ms = await db.select("mensagens", { select: "remetente,texto,tipo,transcricao,enviada_em", filters: { conversa_id: `eq.${a.id}` }, order: "enviada_em" });
    if (ms.length) blocos.push(`[${a.data.split("-").reverse().slice(0, 2).join("/")}]\n${ms.map(linha).join("\n")}`);
  }
  if (!blocos.length) return "";
  const t = blocos.join("\n");
  return `HISTÓRICO DOS DIAS ANTERIORES (só contexto, não avalie):\n${t.length > 6000 ? "..." + t.slice(t.length - 6000) : t}`;
}

// Alerta critico: notificacao no app para gestores e para o vendedor da conversa (nunca WhatsApp)
async function avisarCritico(db, R, vendedorId, a, link, contato) {
  const gestores = await db.select("profiles", { select: "id", filters: { papel: "in.(admin,gestor)", ativo: "eq.true" } });
  const para = [...new Set([...gestores.map(g => g.id), vendedorId])];
  const titulo = `Alerta crítico: ${R.nomes.get(vendedorId) || "vendedor"} com ${contato}`;
  await db.insert("notificacoes", para.map(p => ({ para: p, tipo: "critico", titulo, texto: a.critico_motivo || a.resumo, link })), { returning: false });
}

// =====================================================================
// Rodada de auditoria
// =====================================================================
// Conversas: auditadas quando param AUDIT_IDLE_MINUTES (com mensagens novas desde a ultima nota), respeitando
// as Configuracoes. "Auditar agora" na tela passa por cima dos filtros. Depois, importadas e ligacoes gravadas.
// soSinais = fila rapida (rodada a cada minuto): "Auditar agora" e conversas com sinal de venda ou marcacao.
// O resto (conversa parada, rodada final, importadas, ligacoes) fica na rodada normal.
export async function runAudits(db, { fetchImpl = fetch, now = Date.now(), final = false, soSinais = false, envio, agendaFetch = fetch } = {}) {
  if (!provedor() && fetchImpl === fetch) return 0;
  const R = await carregarRegras(db);
  const from = addDays(today(), -cfg.daysBack);
  let feitos = 0;

  const auditarConversa = async (c, msgs, { manual = false } = {}) => {
    const tempos = temposResposta(msgs);
    const hist = await historico(db, c, R.s.historico_dias);
    const quem = `Vendedor: ${R.nomes.get(c.vendedor_id) || "sem nome"} · Lead: ${c.contato_nome || "nome não informado"}\n\n`;
    const texto = quem + (hist ? `${hist}\n\nCONVERSA DO DIA (avalie esta):\n${cortar(msgs.map(linha).join("\n"))}` : cortar(msgs.map(linha).join("\n")));
    const a = await auditarTexto(R, c.vendedor_id, texto, { primeiraResposta: tempos.primeira_resposta_seg }, fetchImpl);
    const [antes] = await db.select("auditorias", { select: "critico,alertas_enviados", filters: { conversa_id: `eq.${c.id}` } });
    await db.insert("auditorias", [{ conversa_id: c.id, vendedor_id: c.vendedor_id, msg_count: msgs.length, ...a, ...tempos, manual, ...(c.canal === "importada" ? { sheet_ok: true } : {}) }], { onConflict: "conversa_id", returning: false });
    if (a.critico && !antes?.critico && c.canal !== "importada") await avisarCritico(db, R, c.vendedor_id, a, `/conversas/${c.id}`, c.contato_nome || c.contato);
    try { await avisarEventos(db, R, c, a, antes?.alertas_enviados || [], envio ? { envio } : {}); } catch (e) { console.error(`[alerta] conversa ${c.id}:`, e.message); }
    // reuniao com horario proposto mas sem acordo dos dois lados: a proxima mensagem ("da certo", "pode ser") ja reaudita na hora
    const pendente = c.canal !== "importada" && !!(a.reuniao || String(a.oportunidade_tipo || "").startsWith("reuniao_")) && !(a.reuniao?.cliente_confirmou && a.reuniao?.vendedor_confirmou);
    if (pendente !== !!c.reuniao_pendente) await db.update("conversas", { id: `eq.${c.id}` }, { reuniao_pendente: pendente });
    if (a.reuniao && c.canal !== "importada") try { await sincronizarReuniao(db, R, c, a.reuniao, { fetchImpl: agendaFetch }); } catch (e) { console.error(`[agenda] conversa ${c.id}:`, e.message); }
    feitos++;
  };
  const mensagensDe = id => db.select("mensagens", { select: "remetente,texto,tipo,transcricao,enviada_em", filters: { conversa_id: `eq.${id}` }, order: "enviada_em" });

  const CAMPOS_CONV = "id,vendedor_id,instancia_id,contato,telefone,contato_nome,canal,data,ultima_msg_em,nao_auditar,reuniao_pendente";
  if (soSinais) {
    // ----- "Auditar agora" (qualquer data, sem filtros) -----
    for (const c of await db.select("conversas", { select: CAMPOS_CONV, filters: { auditar_agora: "eq.true" }, limit: 20 })) {
      try {
        const msgs = await mensagensDe(c.id);
        if (msgs.length) await auditarConversa(c, msgs, { manual: true });
      } catch (e) { console.error(`[auditoria] auditar agora ${c.id}:`, e.message); }
      await db.update("conversas", { id: `eq.${c.id}` }, { auditar_agora: false, auditar_rapido: false });
    }
    // ----- sinal de venda ou marcacao numa mensagem: audita na hora, sem esperar a conversa parar -----
    for (const c of await db.select("conversas", { select: CAMPOS_CONV, filters: { auditar_rapido: "eq.true" }, limit: 20 })) {
      try {
        const msgs = await mensagensDe(c.id);
        const pode = R.s.auditoria_automatica && !c.nao_auditar && !R.ignorados.has(chaveTelefone(c.telefone || c.contato)) && msgs.some(m => m.remetente === "vendedor") && msgs.some(m => m.remetente === "cliente");
        if (pode) await auditarConversa(c, msgs);
      } catch (e) { console.error(`[auditoria] sinal ${c.id}:`, e.message); }
      await db.update("conversas", { id: `eq.${c.id}` }, { auditar_rapido: false });
    }
    return feitos;
  }

  // ----- conversas do dia (automatica) -----
  // Durante o dia: so conversa parada ha parada_min. Na rodada final (fim do expediente): todas que mudaram.
  const automatica = R.s.auditoria_automatica && R.s.escopo_conversas !== "grupo" && (final || R.s.parada_min != null); // grupos ainda nao sao gravados
  const convs = automatica ? await db.selectAll("conversas", { select: CAMPOS_CONV + ",auditar_rapido,auditar_agora", filters: { data: `gte.${from}`, canal: "neq.importada" } }) : [];
  if (convs.length) {
    const resumo = new Map();
    for (const m of await db.selectAll("mensagens", { select: "conversa_id,remetente,tipo,transcricao,audio_url", filters: { enviada_em: `gte.${dayStart(from)}` }, order: "id" })) {
      const r = resumo.get(m.conversa_id) || { n: 0, vend: 0, cli: 0, pendAudio: 0 };
      r.n++; if (m.remetente === "vendedor") r.vend++; else r.cli++;
      if (m.tipo === "audio" && m.audio_url && m.transcricao == null) r.pendAudio++;
      resumo.set(m.conversa_id, r);
    }
    const auds = new Map((await db.selectAll("auditorias", { select: "conversa_id,msg_count", filters: { conversa_id: "not.is.null", atualizado_em: `gte.${dayStart(addDays(from, -1))}` } })).map(a => [a.conversa_id, a.msg_count]));
    for (const c of convs) {
      const r = resumo.get(c.id);
      if (!r || !r.vend || !r.cli) continue; // so audita quando o lead respondeu (mensagem dos dois lados)
      if (c.auditar_rapido || c.auditar_agora) continue; // esta na fila rapida
      if (c.nao_auditar) continue; // o gestor removeu a auditoria desta conversa
      if (r.n < R.s.min_mensagens) continue;
      if (R.ignorados.has(chaveTelefone(c.telefone || c.contato))) continue;
      if (!naAmostra(c.id, R.s.amostragem_pct)) continue;
      const parada = now - new Date(c.ultima_msg_em).getTime();
      if (!final && parada < R.s.parada_min * 60000) continue;
      if (r.pendAudio && parada < 30 * 60000) continue; // espera a transcricao dos audios
      if ((auds.get(c.id) ?? -1) >= r.n) continue;
      try {
        const msgs = await mensagensDe(c.id);
        if (R.s.so_com_proposta && !msgs.some(m => PROPOSTA.test(`${m.texto || ""} ${m.transcricao || ""}`))) continue;
        await auditarConversa(c, msgs);
      } catch (e) { console.error(`[auditoria] conversa ${c.id}:`, e.message); }
    }
  }

  // ----- conversas importadas (tela Testar auditor): auditadas uma vez, de qualquer data -----
  const imps = await db.select("conversas", { select: "id,vendedor_id,contato,contato_nome,canal", filters: { canal: "eq.importada" }, order: "criado_em.desc", limit: 50 });
  if (imps.length) {
    const ja = new Set((await db.select("auditorias", { select: "conversa_id", filters: { conversa_id: `in.(${imps.map(c => c.id).join(",")})` } })).map(a => a.conversa_id));
    for (const c of imps) {
      if (ja.has(c.id)) continue;
      try {
        const msgs = await mensagensDe(c.id);
        if (!msgs.some(m => m.remetente === "vendedor") || !msgs.some(m => m.remetente === "cliente")) continue; // sem resposta do lead
        await auditarConversa(c, msgs);
      } catch (e) { console.error(`[auditoria] importada ${c.id}:`, e.message); }
    }
  }

  // ----- ligacoes gravadas (com transcricao) -----
  const ligs = R.s.auditoria_automatica ? await db.select("ligacoes", { select: "id,vendedor_id,contato,transcricao", filters: { transcricao: "not.is.null" }, order: "iniciada_em.desc", limit: 50 }) : [];
  if (ligs.length) {
    const ja = new Set((await db.selectAll("auditorias", { select: "ligacao_id", filters: { ligacao_id: "not.is.null" } })).map(a => a.ligacao_id));
    for (const l of ligs) {
      if (ja.has(l.id) || l.transcricao.startsWith("[") || R.ignorados.has(chaveTelefone(l.contato))) continue;
      try {
        const a = await auditarTexto(R, l.vendedor_id, cortar("TRANSCRICAO DA LIGACAO:\n" + l.transcricao), {}, fetchImpl);
        await db.insert("auditorias", [{ ligacao_id: l.id, vendedor_id: l.vendedor_id, msg_count: 0, ...a }], { onConflict: "ligacao_id", returning: false });
        if (a.critico) await avisarCritico(db, R, l.vendedor_id, a, "/ligacoes", l.contato);
        feitos++;
      } catch (e) { console.error(`[auditoria] ligacao ${l.id}:`, e.message); }
    }
  }
  return feitos;
}

import { today } from "./config.js";
import { enviarWhatsApp } from "./envio.js";
import { gestores, notificar } from "./notificar.js";

const SITE = (process.env.SITE_URL || "https://auditoria-comercial-omega.vercel.app").replace(/\/$/, "");

// Sinal forte de venda ou marcacao numa mensagem (sem IA, sem custo). Quando aparece, a conversa e auditada na hora
// e a IA confirma se foi mesmo venda/marcacao antes de qualquer aviso ao gestor.
const SINAL = new RegExp([
  "inscri[cç][aã]o|inscrev[ie]|me inscrevi|inscrit[oa]",
  "cupom",
  "comprovante|\\bpix\\b|paguei|pagamento (feito|realizado|aprovado|confirmado)|boleto pago|transferi",
  "link de pagamento|payment-link|checkout|pagar\\.me|mercadopago|r\\$\\s?\\d",
  "fechad[oa]|fechamos|vamos fechar|bora fechar|contrato assinado|assinei",
  "pode (marcar|agendar|confirmar|inscrever)|agendad[oa]|marcad[oa]|confirmad[oa]|combinad[oa]",
  "meet\\.google|zoom\\.us|teams\\.microsoft|link da (reuni[aã]o|chamada|videochamada)|te espero|nos vemos",
  "(segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo|amanh[aã]|hoje)[^.?!\\n]{0,25}\\b\\d{1,2}(h|:\\d{2})",
].join("|"), "i");
export const temSinal = t => !!t && SINAL.test(String(t));

const brl = n => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

// Eventos de uma auditoria, do mais urgente para o menos
export function eventosDe(a, funcao) {
  const ev = [];
  // dinheiro = entrou dinheiro de verdade (imersao fechada ou workshop pago; cupom de R$ 0 nao conta)
  if (a.venda && a.venda_tipo === "imersao") ev.push({ chave: "venda_imersao", tipo: "venda", dinheiro: true, produto: "IMERSÃO FECHADA", titulo: "💎 *Imersão fechada*", extra: a.venda_valor ? brl(a.venda_valor) : "valor não informado", evidencia: a.venda_evidencia });
  if (a.venda && a.venda_tipo !== "imersao") ev.push({ chave: "venda_workshop", tipo: "venda", dinheiro: !a.venda_cupom && Number(a.venda_valor ?? 1) > 0, produto: "WORKSHOP PAGO", titulo: "💰 *Inscrição no workshop*", extra: a.venda_cupom ? (a.venda_convite_origem === "carbone" ? "convite Carbone · R$ 0" : "cupom de convite · R$ 0") : a.venda_valor != null ? brl(a.venda_valor) : "valor não informado", evidencia: a.venda_evidencia });
  let reuniao = a.oportunidade_tipo === "reuniao_implementacao" || a.oportunidade_tipo === "reuniao_imersao" ? a.oportunidade_tipo
    : a.agendou && a.tipo_agendamento === "imersao" ? (funcao === "closer" ? "reuniao_implementacao" : "reuniao_imersao") : null;
  // Aviso de reuniao so quando o lead aceitou E o vendedor confirmou (pergunta "posso confirmar?" ainda nao vale).
  // Enquanto nao confirma, a chave nao entra em alertas_enviados e o aviso sai na auditoria seguinte, ja confirmado.
  const confirmada = !!(a.reuniao?.cliente_confirmou && a.reuniao?.vendedor_confirmou);
  if (!confirmada || a.remarcacao || a.reuniao?.remarcacao) reuniao = null; // remarcacao so muda a agenda
  if (reuniao === "reuniao_implementacao") ev.push({ chave: reuniao, tipo: "marcacao", titulo: "🤝 *Reunião de implementação marcada*", evidencia: a.oportunidade_evidencia });
  if (reuniao === "reuniao_imersao") ev.push({ chave: reuniao, tipo: "marcacao", titulo: "📅 *Reunião de imersão marcada*", evidencia: a.oportunidade_evidencia });
  if (a.oportunidade && !reuniao && a.oportunidade_tipo && !a.oportunidade_tipo.startsWith("reuniao_")) ev.push({ chave: a.oportunidade_tipo, tipo: "oportunidade", titulo: `🎯 *Oportunidade*: ${a.oportunidade_tipo === "interesse_imersao" ? "interesse na imersão" : "interesse no workshop"}`, evidencia: a.oportunidade_evidencia });
  return ev;
}

// Assinatura do Cabueta (Cabueta do Elon Musk), o robo do Auditor (so no relatorio do dia; os avisos vao direto ao ponto)
export const ASSINATURA = "🚀 *Aviso do Cabueta*";

// Sorteio fixo por conversa: a mesma conversa sempre gera o mesmo texto, conversas diferentes variam
export const sorteio = (id, l) => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return l[h % l.length]; };

// Venda com dinheiro entrando: curto, para o gestor decidir rapido (quem, cliente, valor, link)
const verConversa = id => `👉 ${SITE}/conversas/${id}`;
const FALOU = ["E olha o que o lead mandou:", "Palavras do próprio lead:", "Saca só o que o lead falou:", "O lead soltou essa:"];
const fala = (id, ev, max) => `${sorteio(id + "e", FALOU)} "${String(ev).slice(0, max)}"`;
const tambemDe = outros => (outros.length ? `E não parou por aí: ${outros.map(o => o.titulo.replace(/\*/g, "").replace(/^\S+\s/, "").toLowerCase()).join(" e ")} também! 🙌` : null);
export function textoVenda(e, { vendedor, lead, conversaId, outros = [] }) {
  return [
    `${e.titulo} · ${vendedor}`,
    `Cliente: ${lead} · ${e.extra}${outros.length ? ` · também ${outros.map(o => o.titulo.replace(/\*/g, "").replace(/^\S+\s/, "").toLowerCase()).join(" e ")}` : ""}`,
    verConversa(conversaId),
  ].join("\n");
}

// Jeito de colega contando a novidade no grupo, com varias versoes por tipo
const FRASES = {
  venda_workshop: [
    (q, l) => `${q} acabou de colocar ${l} pra dentro do workshop! 🎟️`,
    (q, l) => `Mais um confirmado no workshop! ${l} fechou com ${q} agorinha 🎉`,
    (q, l) => `${q} tá voando hoje: ${l} garantiu a vaga no workshop ✈️`,
    (q, l) => `Olha só: ${l} topou o workshop no papo com ${q}! 🎟️`,
  ],
  reuniao_implementacao: [
    (q, l) => `${q} marcou reunião de implementação com ${l}! Agenda ficando cheia 📅🔥`,
    (q, l) => `Reunião de implementação na agenda! ${q} acertou tudo com ${l} 🤝`,
    (q, l) => `Saiu reunião de implementação: ${l} confirmou com ${q} 🤝✨`,
  ],
  reuniao_imersao: [
    (q, l) => `${q} marcou reunião de imersão com ${l}! Essa tem cara de venda 👀`,
    (q, l) => `Tem reunião de imersão vindo aí: ${l} topou com ${q} 📅`,
    (q, l) => `${q} fez acontecer: reunião de imersão marcada com ${l} 🔥`,
  ],
  oportunidade: [
    (q, l, o) => `${l} tá de olho ${o} e foi conversar com ${q}. Esse tá esquentando! 🔥`,
    (q, l, o) => `Bateu interesse ${o}: ${l} puxou assunto com ${q} 🎯`,
    (q, l, o) => `${l} quer saber mais ${o}, e quem tá no atendimento é ${q} 👀`,
  ],
};
const EMPURRAO = ["Um empurrãozinho agora e vira marcação 😉", "Se der, dá uma força, que esse tá perto 😉", "Tá no ponto de virar reunião, hein! 😉"];
function frase(e, quem, lead, id) {
  if (FRASES[e.chave]) return sorteio(id + "p", FRASES[e.chave])(quem, lead);
  return sorteio(id + "p", FRASES.oportunidade)(quem, lead, e.chave === "interesse_imersao" ? "na imersão" : "no workshop");
}

// Uma mensagem por conversa: o evento mais importante na frase principal e os outros no "E nao parou por ai"
export function textoAlerta(e, { vendedor, funcao, lead, conversaId, formato, outros = [] }) {
  if (e.dinheiro) return textoVenda(e, { vendedor, lead, conversaId, outros });
  const quem = `${vendedor}${funcao ? ` (${funcao === "closer" ? "Closer" : "SDR"})` : ""}`;
  const principal = frase(e, quem, lead, conversaId);
  const cupom = e.chave === "venda_workshop" && /cupom|convite/.test(e.extra || "");
  const topo = e.tipo === "marcacao" ? "📅 *ALERTA DE REUNIÃO*" : null;
  if (formato === "resumido") return `${topo ? `${topo}: ` : ""}${principal}${cupom ? " (com cupom de convite)" : e.extra ? ` (${e.extra})` : ""}${outros.length ? `\n${tambemDe(outros)}` : ""}`;
  const op = e.tipo === "oportunidade";
  return [
    ...(topo ? [topo, ``] : []), principal,
    ...(cupom ? [`Veio com cupom de convite, então entrou de cortesia 🎟️`] : e.extra ? [`Valor: ${e.extra} 💰`] : []),
    ...(e.evidencia ? [fala(conversaId, e.evidencia, 220)] : []),
    ...(outros.length ? [tambemDe(outros)] : []),
    ...(op ? [sorteio(conversaId + "x", EMPURRAO)] : []),
    ``, verConversa(conversaId),
  ].join("\n");
}

// Depois de cada auditoria: avisa no WhatsApp do gestor o que e novo nesta conversa (uma mensagem, a do evento mais urgente).
// So conversa de hoje, nunca importada; cada evento avisa uma vez por conversa. Critico nunca vai por aqui (vai no app).
export async function avisarEventos(db, R, c, a, jaEnviados = [], { envio = enviarWhatsApp } = {}) {
  if (c.canal === "importada" || c.data !== today()) return null;
  const funcao = R.funcao.get(c.vendedor_id) || "sdr";
  const novos = eventosDe(a, funcao).filter(e => !jaEnviados.includes(e.chave));
  if (!novos.length) return null;
  // sino: venda de imersao para a gestao e o vendedor; workshop e reuniao para o vendedor
  const vendedor = R.nomes.get(c.vendedor_id) || "Vendedor", lead = c.contato_nome || `+${c.telefone || c.contato}`, link = `/conversas/${c.id}`;
  const gest = novos.some(e => e.chave === "venda_imersao") ? await gestores(db) : [];
  for (const e of novos) {
    if (e.chave === "venda_imersao") await notificar(db, [...gest, c.vendedor_id], { categoria: "venda", titulo: `💎 ${vendedor} fechou uma imersão com ${lead}${e.extra ? ` · ${e.extra}` : ""}`, texto: e.evidencia || null, link });
    else if (e.chave === "venda_workshop") await notificar(db, [c.vendedor_id], { categoria: "venda", titulo: `🎟️ Inscrição no workshop: ${lead}${e.extra ? ` · ${e.extra}` : ""}`, texto: e.evidencia || null, link });
    else if (e.tipo === "marcacao") await notificar(db, [c.vendedor_id], { categoria: "reuniao", titulo: `📅 ${e.chave === "reuniao_implementacao" ? "Reunião de implementação" : "Reunião de imersão"} marcada com ${lead}`, texto: e.evidencia || null, link });
  }
  const s = R.alertas;
  // venda avisada na hora = so imersao fechada (workshop vai nos resumos); marcacao e oportunidade so se ligadas em Configuracoes
  const permitidos = novos.filter(e => (e.chave === "venda_imersao" && s.venda) || (e.tipo === "marcacao" && s.marcacao) || (e.tipo === "oportunidade" && s.oportunidade));
  let enviou = false;
  if (permitidos.length && s.instancia && s.telefones.length) {
    const texto = textoAlerta(permitidos[0], { vendedor: R.nomes.get(c.vendedor_id) || "Vendedor", funcao, lead: c.contato_nome || `+${c.telefone || c.contato}`, conversaId: c.id, formato: s.formato, outros: permitidos.slice(1) });
    for (const t of s.telefones) {
      try { await envio(db, s.instancia, t, texto); enviou = true; }
      catch (e) { console.error(`[alerta] envio para ${t}:`, e.message); }
    }
    if (!enviou) return null; // tenta de novo na proxima auditoria
    console.log(`[alerta] ${permitidos[0].chave}: ${R.nomes.get(c.vendedor_id)} com ${c.contato_nome || c.contato}`);
  }
  await db.update("auditorias", { conversa_id: `eq.${c.id}` }, { alertas_enviados: [...new Set([...jaEnviados, ...novos.map(e => e.chave)])], alerta_enviado: enviou || undefined });
  return enviou ? permitidos[0].chave : null;
}

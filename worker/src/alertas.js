import { today } from "./config.js";
import { enviarWhatsApp } from "./envio.js";

const SITE = (process.env.SITE_URL || "https://auditoria-comercial-omega.vercel.app").replace(/\/$/, "");

// Sinal forte de venda ou marcacao numa mensagem (sem IA, sem custo). Quando aparece, a conversa e auditada na hora
// e a IA confirma se foi mesmo venda/marcacao antes de qualquer aviso ao gestor.
const SINAL = new RegExp([
  "inscri[cç][aã]o|inscrev[ie]|me inscrevi|inscrit[oa]",
  "cupom",
  "comprovante|\\bpix\\b|paguei|pagamento (feito|realizado|aprovado|confirmado)|boleto pago|transferi",
  "fechad[oa]|fechamos|vamos fechar|bora fechar|contrato assinado|assinei",
  "pode (marcar|agendar|confirmar|inscrever)|agendad[oa]|marcad[oa]|confirmad[oa]|combinad[oa]",
  "(segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo|amanh[aã]|hoje)[^.?!\\n]{0,25}\\b\\d{1,2}(h|:\\d{2})",
].join("|"), "i");
export const temSinal = t => !!t && SINAL.test(String(t));

const brl = n => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

// Eventos de uma auditoria, do mais urgente para o menos
export function eventosDe(a, funcao) {
  const ev = [];
  // dinheiro = entrou dinheiro de verdade (imersao fechada ou workshop pago; cupom de R$ 0 nao conta)
  if (a.venda && a.venda_tipo === "imersao") ev.push({ chave: "venda_imersao", tipo: "venda", dinheiro: true, produto: "IMERSÃO FECHADA", titulo: "💎 *Imersão fechada*", extra: a.venda_valor ? brl(a.venda_valor) : "valor não informado", evidencia: a.venda_evidencia });
  if (a.venda && a.venda_tipo !== "imersao") ev.push({ chave: "venda_workshop", tipo: "venda", dinheiro: !a.venda_cupom && Number(a.venda_valor ?? 1) > 0, produto: "WORKSHOP PAGO", titulo: "💰 *Inscrição no workshop*", extra: a.venda_cupom ? "cupom de convite · R$ 0" : a.venda_valor != null ? brl(a.venda_valor) : "valor não informado", evidencia: a.venda_evidencia });
  const reuniao = a.oportunidade_tipo === "reuniao_implementacao" || a.oportunidade_tipo === "reuniao_imersao" ? a.oportunidade_tipo
    : a.agendou && a.tipo_agendamento === "imersao" ? (funcao === "closer" ? "reuniao_implementacao" : "reuniao_imersao") : null;
  if (reuniao === "reuniao_implementacao") ev.push({ chave: reuniao, tipo: "marcacao", titulo: "🤝 *Reunião de implementação marcada*", evidencia: a.oportunidade_evidencia });
  if (reuniao === "reuniao_imersao") ev.push({ chave: reuniao, tipo: "marcacao", titulo: "📅 *Reunião de imersão marcada*", evidencia: a.oportunidade_evidencia });
  if (a.oportunidade && !reuniao && a.oportunidade_tipo) ev.push({ chave: a.oportunidade_tipo, tipo: "oportunidade", titulo: `🎯 *Oportunidade*: ${a.oportunidade_tipo === "interesse_imersao" ? "interesse na imersão" : "interesse no workshop"}`, evidencia: a.oportunidade_evidencia });
  return ev;
}

// Venda com dinheiro entrando: aviso bem animado, com variacoes para nao ficar repetitivo
const ABERTURAS = [
  n => `🚨🚨🚨 HEIIIIIIIIIIIIIIIII 🚨🚨🚨\n💸💸 PINGOU UMA VENDA DE ${n}!!! 💸💸`,
  n => `🔔🔔🔔 PLIM PLIM PLIIIIIIIM 🔔🔔🔔\n💰💰 CAIU DINHEIRO COM ${n}!!! 💰💰`,
  n => `🚀🚀🚀 ALERTA DE VENDAAAAAAA 🚀🚀🚀\n🤑🤑 ${n} ACABOU DE FECHAR!!! 🤑🤑`,
  n => `📣📣📣 PAREM TUDOOOOOOO 📣📣📣\n💵💵 TEM VENDA DE ${n} NA ÁREA!!! 💵💵`,
  n => `🎰🎰🎰 JACKPOOOOOOT 🎰🎰🎰\n🤑🤑 ${n} FEZ O CAIXA TOCAR!!! 🤑🤑`,
];
const FECHOS = [n => "🍾🎉 BORA, TIME! QUEM É O PRÓXIMO? 🎉🍾", n => `👏👏👏 APLAUSOS PARA ${n}! 👏👏👏`, n => "🔥🔥 QUE DIA, MEU POVO! 🔥🔥", n => `🏆 ${n} ON FIRE! 🏆`];
const sorteio = (id, l) => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return l[h % l.length]; };
export function textoVenda(e, { vendedor, lead, conversaId, outros = [] }) {
  const n = String(vendedor).split(" ")[0].toUpperCase();
  return [
    sorteio(conversaId, ABERTURAS)(n),
    ``,
    `🔥 ${e.produto} · ${e.extra} 🔥`,
    `👤 Lead: ${lead}`,
    ...(e.evidencia ? [`💬 "${String(e.evidencia).slice(0, 200)}"`] : []),
    ...(outros.length ? [`➕ Também: ${outros.map(o => o.titulo.replace(/\*/g, "")).join(" · ")}`] : []),
    ``,
    sorteio(conversaId + "f", FECHOS)(n),
    `Ver conversa: ${SITE}/conversas/${conversaId}`,
  ].join("\n");
}

// Uma mensagem por conversa: o evento mais urgente no titulo e os outros na linha "Também"
export function textoAlerta(e, { vendedor, funcao, lead, conversaId, formato, outros = [] }) {
  if (e.dinheiro) return textoVenda(e, { vendedor, lead, conversaId, outros });
  const quem = `${vendedor}${funcao ? ` (${funcao === "closer" ? "Closer" : "SDR"})` : ""} com ${lead}`;
  const tambem = outros.length ? `Também: ${outros.map(o => o.titulo.replace(/\*/g, "")).join(" · ")}` : null;
  if (formato === "resumido") return `${e.titulo}${e.extra ? ` (${e.extra})` : ""}: ${quem}${tambem ? `\n${tambem}` : ""}`;
  return [`${e.titulo}${e.extra ? ` · ${e.extra}` : ""}`, quem, ...(e.evidencia ? [`"${String(e.evidencia).slice(0, 220)}"`] : []), ...(tambem ? [tambem] : []), `Ver conversa: ${SITE}/conversas/${conversaId}`].join("\n");
}

// Depois de cada auditoria: avisa no WhatsApp do gestor o que e novo nesta conversa (uma mensagem, a do evento mais urgente).
// So conversa de hoje, nunca importada; cada evento avisa uma vez por conversa. Critico nunca vai por aqui (vai no app).
export async function avisarEventos(db, R, c, a, jaEnviados = [], { envio = enviarWhatsApp } = {}) {
  if (c.canal === "importada" || c.data !== today()) return null;
  const funcao = R.funcao.get(c.vendedor_id) || "sdr";
  const novos = eventosDe(a, funcao).filter(e => !jaEnviados.includes(e.chave));
  if (!novos.length) return null;
  const s = R.alertas;
  const permitidos = novos.filter(e => (e.tipo === "venda" && s.venda) || (e.tipo === "marcacao" && s.marcacao) || (e.tipo === "oportunidade" && s.oportunidade));
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

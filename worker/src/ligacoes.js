// Ligacoes de WhatsApp captadas do numero conectado (o WhatsApp nao grava o audio: guardamos quem, quando, se atendeu e quanto durou).
// Chegam por dois caminhos, que podem descrever a mesma ligacao:
//   1. evento "call" (offer, accept, reject, timeout, terminate), mais comum em ligacao recebida;
//   2. mensagem de registro de chamada (callLogMesssage) que o celular sincroniza no chat, com resultado e duracao.
// gravarLigacao junta os dois: mesma conversa e horario proximo (5 min) viram uma ligacao so.

const JANELA_MS = 5 * 60_000;

// Resultado do registro de chamada do WhatsApp (proto CallLogMessage.CallOutcome)
const RESULTADOS = ["atendida", "perdida", "falhou", "recusada", "atendida_em_outro_aparelho", "em_andamento", "silenciada", "silenciada"];

// m = { callId, contato, direcao: "entrada"|"saida", atendida, duracao, sec, resultado }
export async function gravarLigacao(db, inst, m) {
  if (!m.contato) return;
  const sec = Number(m.sec) || Math.floor(Date.now() / 1000);
  const quando = sec * 1000;
  const recentes = await db.select("ligacoes", { select: "id,wa_call_id,atendida,duracao_seg,iniciada_em,direcao,resultado", filters: { instancia_id: `eq.${inst.id}`, contato: `eq.${m.contato}`, origem: "eq.whatsapp" }, order: "iniciada_em.desc", limit: 10 });
  const mesma = recentes.find(r => (m.callId && r.wa_call_id === m.callId) || Math.abs(Date.parse(r.iniciada_em) - quando) <= JANELA_MS);
  if (mesma) {
    const atendida = !!(mesma.atendida || m.atendida);
    await db.update("ligacoes", { id: `eq.${mesma.id}` }, {
      atendida,
      duracao_seg: Math.max(Number(mesma.duracao_seg) || 0, Number(m.duracao) || 0) || null,
      direcao: mesma.direcao || m.direcao || null,
      resultado: atendida ? "atendida" : m.resultado || mesma.resultado || null,
    });
    return mesma.id;
  }
  const [row] = await db.insert("ligacoes", [{
    vendedor_id: inst.vendedor_id, instancia_id: inst.id, contato: m.contato, origem: "whatsapp",
    direcao: m.direcao || null, atendida: !!m.atendida, resultado: m.resultado || (m.atendida ? "atendida" : null),
    duracao_seg: Number(m.duracao) || null, wa_call_id: m.callId || null, iniciada_em: new Date(quando).toISOString(),
  }]);
  return row?.id;
}

// Mensagem de registro de chamada do Baileys -> formato comum (ou null se nao for chamada)
export function ligacaoDaMensagem(m) {
  const x = m.message; if (!x) return null;
  const log = x.callLogMesssage || x.callLogMessage;
  const jid = m.key?.remoteJid;
  if (!log || !jid) return null;
  const outcome = Number(log.callOutcome ?? 0);
  const duracao = Number(log.durationSecs?.low ?? log.durationSecs) || 0;
  const atendida = outcome === 0 || duracao > 0;
  return {
    callId: null, contato: jid.split("@")[0], direcao: m.key.fromMe ? "saida" : "entrada", atendida, duracao,
    sec: (Number(m.messageTimestamp?.low ?? m.messageTimestamp) || Math.floor(Date.now() / 1000)) - duracao, // o registro chega no fim
    resultado: atendida ? "atendida" : RESULTADOS[outcome] || "nao_atendida",
  };
}

// Eventos "call" do Baileys: acompanha cada chamada ate o fim e grava uma vez.
// Os horarios vem do WhatsApp (c.date), nao da hora de chegada: eventos atrasados (reconexao) continuam certos.
// Atendida no CELULAR: o aparelho conectado nao recebe "accept"; ve tocar e depois "terminate". Conta como atendida quando
// o WhatsApp manda a duracao/motivo no terminate (detalhes brutos) ou quando a chamada durou mais que o toque maximo.
export const TOQUE_MAX_S = 60;
export function acompanharChamadas(db, inst, meuJid, detalhes = () => null) {
  const abertas = new Map(); // id -> { contato, direcao, inicio, atendidaEm }
  const eu = () => String(meuJid() || "").split(":")[0].split("@")[0];
  return async function onCall(calls) {
    for (const c of calls) {
      if (c.isGroup) continue;
      const outro = String(c.chatId || c.from || "");
      if (!/@(s\.whatsapp\.net|lid)$/.test(outro)) continue;
      const quando = c.date ? new Date(c.date).getTime() : Date.now();
      const dados = abertas.get(c.id) || { contato: outro.split("@")[0], direcao: String(c.from || "").split("@")[0].split(":")[0] === eu() ? "saida" : "entrada", inicio: quando, atendidaEm: null };
      abertas.set(c.id, dados);
      if (c.status === "accept") dados.atendidaEm = quando;
      if (["reject", "timeout", "terminate"].includes(c.status)) {
        abertas.delete(c.id);
        const extra = detalhes(c.id) || {};
        const durWa = Number(extra.duration || extra.duracao) || 0;
        const total = Math.max(0, Math.round((quando - dados.inicio) / 1000));
        const atendidaFora = /accept|answer|elsewhere/i.test(String(extra.reason || ""));
        const atendida = !!dados.atendidaEm || durWa > 0 || atendidaFora || (c.status === "terminate" && total > TOQUE_MAX_S);
        const duracao = dados.atendidaEm ? Math.round((quando - dados.atendidaEm) / 1000) : durWa || (atendida ? total : 0);
        await gravarLigacao(db, inst, {
          callId: c.id, contato: dados.contato, direcao: dados.direcao, atendida, duracao,
          sec: Math.floor(dados.inicio / 1000),
          resultado: atendida ? "atendida" : c.status === "reject" ? "recusada" : "perdida",
        }).catch(e => console.error(`[${inst.nome}] ligacao:`, e.message));
      }
    }
  };
}

// Historico de chamadas que o WhatsApp sincroniza com os aparelhos conectados (CallLogRecord), liberado pelo
// scripts/patch-baileys.mjs. E o unico caminho para as ligacoes FEITAS pelo vendedor no celular.
// numerosDe: [{ inst, numeros: Set<so digitos> }] (numero e codigo @lid de cada WhatsApp conectado)
const RES_LOG = { 0: "atendida", 1: "recusada", 2: "cancelada", 3: "atendida", 4: "perdida", 6: "nao_atendida", 8: "falhou", 9: "nao_atendida" };
const dig = j => String(j || "").split("@")[0].split(":")[0];
export function ligacoesDoHistorico(registros, numerosDe) {
  const out = [];
  for (const r of registros || []) {
    if (r.groupJid || r.isCallLink) continue;
    const criador = dig(r.callCreatorJid);
    const partes = (r.participants || []).map(p => dig(p.userJid)).filter(Boolean);
    const dono = numerosDe.find(n => n.numeros.has(criador)) || numerosDe.find(n => partes.some(p => n.numeros.has(p)));
    if (!dono) continue;
    const saida = dono.numeros.has(criador) && !r.isIncoming;
    const contato = saida ? partes.find(p => !dono.numeros.has(p)) : criador;
    if (!contato) continue;
    const resultado = Number(r.callResult ?? 4);
    const duracao = Number(r.duration?.low ?? r.duration) || 0;
    const atendida = resultado === 0 || resultado === 3 || duracao > 0;
    out.push({ inst: dono.inst, m: {
      callId: r.callId || null, contato, direcao: saida ? "saida" : "entrada", atendida, duracao,
      sec: Number(r.startTime?.low ?? r.startTime) || undefined,
      resultado: atendida ? "atendida" : RES_LOG[resultado] || "nao_atendida",
    } });
  }
  return out;
}

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

// Eventos "call" do Baileys: acompanha cada chamada ate o fim e grava uma vez
export function acompanharChamadas(db, inst, meuJid) {
  const abertas = new Map(); // id -> { contato, direcao, inicio, atendidaEm }
  const eu = () => String(meuJid() || "").split(":")[0].split("@")[0];
  return async function onCall(calls) {
    for (const c of calls) {
      if (c.isGroup) continue;
      const outro = String(c.chatId || c.from || "");
      if (!/@(s\.whatsapp\.net|lid)$/.test(outro)) continue;
      const dados = abertas.get(c.id) || { contato: outro.split("@")[0], direcao: String(c.from || "").split("@")[0].split(":")[0] === eu() ? "saida" : "entrada", inicio: c.date ? new Date(c.date).getTime() : Date.now(), atendidaEm: null };
      abertas.set(c.id, dados);
      if (c.status === "accept") dados.atendidaEm = Date.now();
      if (["reject", "timeout", "terminate"].includes(c.status)) {
        abertas.delete(c.id);
        const atendida = !!dados.atendidaEm;
        await gravarLigacao(db, inst, {
          callId: c.id, contato: dados.contato, direcao: dados.direcao, atendida,
          duracao: atendida ? Math.round((Date.now() - dados.atendidaEm) / 1000) : 0,
          sec: Math.floor(dados.inicio / 1000),
          resultado: atendida ? "atendida" : c.status === "reject" ? "recusada" : "perdida",
        }).catch(e => console.error(`[${inst.nome}] ligacao:`, e.message));
      }
    }
  };
}

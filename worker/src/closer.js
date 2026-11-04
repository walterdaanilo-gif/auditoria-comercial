// Painel do Closer: "Ler conversa". Le as conversas de WhatsApp de um lead e SUGERE o preenchimento do painel
// (situacao, motivo, resumo, proxima acao). Nada e gravado aqui: o closer confere e aplica na tela.
// Dados pessoais: nunca escrever o conteudo das conversas em log.
import { chamarIA, extrairJson } from "./ia.js";
import { chaveTelefone } from "./auditor.js";

// Mesmas listas de web/src/lib/closer/regras.ts (STATUS e MOTIVOS): mudou la, mude aqui.
export const STATUS = ["novo", "mensagem", "respondeu", "negociando", "fechou_plataforma", "fechou_imersao", "sem_resposta", "desqualificado"];
export const MOTIVOS = ["Sem perfil", "Sem orçamento", "Não é o momento", "Já é cliente", "Contato interno ou teste", "Número errado", "Pediu para não receber", "Outro"];
const CONFIANCA = ["alta", "media", "baixa"];

const MAX_CONVERSAS = 10, MAX_MENSAGENS = 60, MAX_TEXTO = 12000;
const texto = (v, max) => String(v ?? "").trim().slice(0, max);

// Corpo vindo do site, com tamanhos limitados
export function lerCorpo(b) {
  const o = b && typeof b === "object" ? b : {};
  return {
    telefone: texto(o.telefone, 30),
    nome: texto(o.nome, 120),
    produto: texto(o.produto, 80),
    orientacoes: (Array.isArray(o.orientacoes) ? o.orientacoes : []).slice(0, 12).map(x => texto(x, 400)).filter(Boolean),
  };
}

// "dd/mm HH:MM VENDEDOR: ..." no horario de Brasilia
const quando = iso => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(iso)).replace(",", "");
const linhaMsg = m => `${quando(m.enviada_em)} ${m.remetente === "vendedor" ? "VENDEDOR" : "CLIENTE"}: ${m.tipo === "audio" ? `[audio] ${m.transcricao || ""}` : m.texto || `[${m.tipo || "mensagem"}]`}`;
const cortarFinal = t => (t.length > MAX_TEXTO ? t.slice(t.length - MAX_TEXTO) : t);

// Conversas do lead na Weevo: busca pelos 8 ultimos digitos e confirma com DDD + 8 digitos
async function conversasDoLead(db, telefone) {
  const chave = chaveTelefone(telefone);
  if (chave.length < 10) return [];
  const [org] = await db.select("organizacoes", { select: "id", filters: { slug: "eq.weevo" } });
  if (!org) return [];
  const fim = chave.slice(-8), campos = "id,org_id,vendedor_id,contato,telefone,contato_nome,canal,data,ultima_msg_em";
  const [porTel, porContato] = await Promise.all(["telefone", "contato"].map(col =>
    db.select("conversas", { select: campos, filters: { org_id: `eq.${org.id}`, [col]: `like.*${fim}` }, order: "ultima_msg_em.desc", limit: 50 })));
  const vistos = new Map();
  for (const c of [...porTel, ...porContato]) if (c.org_id === org.id && chaveTelefone(c.telefone || c.contato) === chave) vistos.set(c.id, c);
  return [...vistos.values()].sort((a, b) => String(b.ultima_msg_em || "").localeCompare(String(a.ultima_msg_em || ""))).slice(0, MAX_CONVERSAS);
}

function promptSistema(orientacoes) {
  return `Você é uma assistente de um closer da Weevo. Vai ler uma conversa de WhatsApp entre o time da Weevo e um lead e sugerir como preencher o painel do closer.

Regras:
- Use SOMENTE o que está na conversa. Não invente nada.
- Não invente preço, data de início nem promessas. Siga à risca as orientações oficiais abaixo.
- A conversa pode ter SDR e closer: os dois aparecem como "VENDEDOR".
- Escreva em português, frases curtas.

Orientações oficiais:
${orientacoes.length ? orientacoes.map(o => `- ${o}`).join("\n") : "- (nenhuma)"}

Situações (status):
- novo: ninguém da Weevo falou com o lead ainda
- mensagem: a Weevo mandou mensagem e o lead não respondeu
- respondeu: o lead respondeu
- negociando: estão falando de preço, plano, forma de pagamento ou fechamento
- fechou_plataforma: o lead fechou a Plataforma (Weevo Start)
- fechou_imersao: o lead fechou a Imersão
- sem_resposta: o lead parou de responder depois de várias tentativas
- desqualificado: não é lead para a Weevo agora (use um motivo da lista)

Responda SOMENTE com este JSON:
{"status": "novo|mensagem|respondeu|negociando|fechou_plataforma|fechou_imersao|sem_resposta|desqualificado",
 "motivo": "só quando status = desqualificado, um destes: ${MOTIVOS.join(", ")}; senão \\"\\"",
 "resumo": "até 400 caracteres, 1 a 3 frases curtas: o que a pessoa disse, objeções e melhor horário",
 "proxima_acao": "uma frase curta com o que o closer deve fazer agora",
 "sugestao_resposta": "texto da próxima mensagem para o lead, ou \\"\\"",
 "evidencia": ["até 3 trechos curtos da conversa que justificam o status"],
 "confianca": "alta|media|baixa"}`;
}

// Valida a resposta da IA: status e motivo so dentro das listas, tamanhos limitados
export function interpretarSugestao(bruto) {
  const o = bruto && typeof bruto === "object" ? bruto : {};
  const status = STATUS.includes(o.status) ? o.status : null;
  return {
    status,
    motivo: status === "desqualificado" && MOTIVOS.includes(o.motivo) ? o.motivo : "",
    resumo: texto(o.resumo, 400),
    proxima_acao: texto(o.proxima_acao, 200),
    sugestao_resposta: texto(o.sugestao_resposta, 1000),
    evidencia: (Array.isArray(o.evidencia) ? o.evidencia : []).slice(0, 3).map(e => texto(e, 200)).filter(Boolean),
    confianca: CONFIANCA.includes(o.confianca) ? o.confianca : "baixa",
  };
}

export async function sugerirParaLead(db, corpo, { fetchImpl = fetch, agora = Date.now() } = {}) {
  const lead = lerCorpo(corpo);
  try {
    const convs = await conversasDoLead(db, lead.telefone);
    if (!convs.length) return { ok: true, encontrou: false };
    const msgs = (await db.select("mensagens", { select: "conversa_id,remetente,texto,tipo,transcricao,enviada_em", filters: { conversa_id: `in.(${convs.map(c => c.id).join(",")})` }, order: "enviada_em.desc", limit: MAX_MENSAGENS })).reverse();
    if (!msgs.length) return { ok: true, encontrou: false };
    const ultima = msgs[msgs.length - 1].enviada_em;
    const base = { ok: true, encontrou: true, mensagens: msgs.length, ultima_msg_em: ultima };
    // sem nenhuma resposta do lead nao ha o que a IA ler
    if (!msgs.some(m => m.remetente === "cliente")) {
      const dias = Math.max(0, Math.floor((agora - Date.parse(ultima)) / 86400_000));
      return { ...base, sugestao: { ...interpretarSugestao({ status: "mensagem", resumo: "O lead ainda não respondeu.", proxima_acao: dias >= 3 ? "Mandar um novo contato." : "Aguardar a resposta.", confianca: "alta" }), dias_sem_resposta: dias } };
    }
    const user = `Lead: ${lead.nome || "nome não informado"} · Produto com mais chance: ${lead.produto || "não informado"}\n\nConversa (mais antiga primeiro):\n${cortarFinal(msgs.map(linhaMsg).join("\n"))}`;
    const resposta = await chamarIA({ system: promptSistema(lead.orientacoes), user, maxTokens: 1200, json: true, fetchImpl });
    const sugestao = interpretarSugestao(extrairJson(resposta));
    console.log(`[closer] sugestao pronta: ${msgs.length} mensagens, status ${sugestao.status || "invalido"}`);
    return { ...base, sugestao };
  } catch (e) {
    // so o tipo de falha, sem conteudo da conversa nem telefone
    console.error("[closer] falha ao sugerir:", String(e?.message || e).replace(/\d{6,}/g, "#").slice(0, 120));
    return { ok: false, erro: /Sem chave de IA/.test(e?.message || "") ? "A IA do worker não está configurada." : "Não foi possível ler a conversa agora." };
  }
}

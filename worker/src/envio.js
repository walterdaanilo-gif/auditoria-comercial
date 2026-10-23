import { cfg } from "./config.js";
import { uazapiAtivo, enviarTextoUazapi } from "./uazapi.js";

const Q5 = "https://api.grupoquatro5.com/public/v1";
const chave = t => { const d = String(t || "").replace(/\D/g, "").replace(/^55/, ""); return d.length >= 10 ? d.slice(0, 2) + d.slice(-8) : d; };

// Envio pelo CRM Q5: a mensagem sai do numero do WhatsApp de envio que ja esta no Q5 (sem conectar nada aqui),
// na conversa que esse numero ja tem com o destino. Remetente = o atendente que cuida da maioria das conversas desse numero.
// Sem conversa com o destino no CRM: null (o envio cai na Uazapi).
export async function rotaCrm(db, instanciaId, numero) {
  if (!cfg.q5Key || !instanciaId) return null;
  const insts = (await db.select("crm_instancias", { select: "id", filters: { instancia_id: `eq.${instanciaId}` } })).map(i => i.id);
  if (!insts.length) return null;
  const convs = await db.selectAll("crm_conversas", { select: "id,telefone,responsavel_crm_id,ultima_msg_em", filters: { crm_instancia_id: `in.(${insts.join(",")})` } });
  const conta = new Map();
  for (const c of convs) if (c.responsavel_crm_id) conta.set(c.responsavel_crm_id, (conta.get(c.responsavel_crm_id) || 0) + 1);
  const remetente = [...conta].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!remetente) return null;
  if (numero == null) return { remetente }; // so checando se o numero de envio esta no CRM
  const chat = convs.filter(c => chave(c.telefone) === chave(numero)).sort((a, b) => String(b.ultima_msg_em || "").localeCompare(String(a.ultima_msg_em || "")))[0];
  return chat ? { chat: chat.id, remetente } : null;
}

// A chave do Q5 pode mandar mensagem? Testa contra uma conversa que nao existe (nada e enviado): 403 = sem permissao
// "conversations:write" na chave; qualquer outra resposta = pode. Sem permissao, o envio fica com a Uazapi.
const ZERO = "00000000-0000-0000-0000-000000000000";
export async function crmPodeEnviar(remetente, fetchImpl = fetch) {
  const r = await fetchImpl(`${Q5}/conversations/${ZERO}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${cfg.q5Key}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ type: "text", body: ".", sender_user_id: remetente }),
  });
  return r.status !== 403 && r.status !== 401;
}

export async function enviarPeloCrm(db, instanciaId, numero, texto, fetchImpl = fetch) {
  const rota = await rotaCrm(db, instanciaId, numero);
  if (!rota) return false;
  for (let tentativa = 0; ; tentativa++) {
    const r = await fetchImpl(`${Q5}/conversations/${rota.chat}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${cfg.q5Key}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ type: "text", body: texto, sender_user_id: rota.remetente }),
    });
    if (r.status === 429 && tentativa < 2) { await new Promise(ok => setTimeout(ok, 3000)); continue; }
    if (!r.ok) throw new Error(`CRM Q5 ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return true;
  }
}

// Mensagem do sistema para o gestor, saindo do WhatsApp escolhido em Configuracoes (instancia_envio_id):
// primeiro pelo CRM Q5; sem conversa no CRM, pela Uazapi (WhatsApp conectado aqui)
export async function enviarWhatsApp(db, instanciaId, numero, texto) {
  try { if (await enviarPeloCrm(db, instanciaId, numero, texto)) return; }
  catch (e) { console.error("[envio] CRM Q5 falhou, tentando o WhatsApp conectado:", e.message); }
  if (uazapiAtivo()) return enviarTextoUazapi(db, instanciaId, numero, texto);
  const modulo = "./whatsapp.js"; // carregado so no modo Baileys (servidor Node proprio); a Edge Function usa a Uazapi
  const { enviarTextoBaileys } = await import(modulo);
  return enviarTextoBaileys(instanciaId, numero, texto);
}

// O WhatsApp de envio (Configuracoes) consegue mandar? Pelo CRM se a chave tiver permissao; pela Uazapi so conectado.
// Sem ele, resumo e follow-up esperam em vez de se perderem.
export async function envioConectado(db, fetchImpl = fetch) {
  const [s] = await db.select("audit_settings", { select: "instancia_envio_id", filters: { id: "eq.1" } });
  if (!s?.instancia_envio_id) return true; // sem WhatsApp de envio: o resumo vai so para o sino
  const rota = await rotaCrm(db, s.instancia_envio_id, null);
  if (rota && (await crmPodeEnviar(rota.remetente, fetchImpl).catch(() => false))) return true;
  const [inst] = await db.select("instancias_whatsapp", { select: "status", filters: { id: `eq.${s.instancia_envio_id}` } });
  return inst?.status === "conectado";
}

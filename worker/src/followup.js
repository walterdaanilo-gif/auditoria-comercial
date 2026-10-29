import { addDays, today } from "./config.js";
import { enviarWhatsApp } from "./envio.js";
import { carregarRegras, chaveTelefone } from "./auditor.js";
import { destinoResumo, mandar } from "./relatorio.js";
import { crmPotencial } from "./crm.js";

const SITE = (process.env.SITE_URL || "https://auditoria-comercial-omega.vercel.app").replace(/\/$/, "");
const ASSUNTO = { interesse_workshop: "interesse no workshop", interesse_imersao: "interesse na imersão", reuniao_imersao: "reunião de imersão", reuniao_implementacao: "reunião de implementação" };
const fone = t => { const m = String(t || "").match(/^55(\d{2})(\d{4,5})(\d{4})$/); return m ? `(${m[1]}) ${m[2]}-${m[3]}` : null; };
const digitos = t => String(t || "").replace(/\D/g, "");
const MAX_LISTA = 25;

// Clientes potenciais sem follow-up: a ultima mensagem DO VENDEDOR (WhatsApp ou historico do CRM) tem N dias ou mais
// (ou o lead escreveu ha N dias e nunca teve resposta). Potencial = a IA viu negociacao (interesse, reuniao, vaga)
// OU o CRM marca a conversa como ativa. Venda fechada, chat interno, pos-venda perdido e numeros ignorados ficam de fora.
// Um lead = vendedor + telefone (DDD + 8 digitos), juntando WhatsApp e CRM.
export async function leadsParados(db, R, { agora = Date.now() } = {}) {
  const s = R.bruto, dias = s.followup_alerta_d ?? 6;
  const desde = addDays(today(), -(s.followup_limite_d ?? 30));
  const convs = (await db.selectAll("conversas", { select: "id,vendedor_id,contato,telefone,contato_nome,ultima_msg_em,data,canal,nao_auditar", filters: { data: `gte.${desde}`, canal: "neq.importada", ...(s.org_id ? { org_id: `eq.${s.org_id}` } : {}) } }))
    .filter(c => !c.nao_auditar && !R.ignorados.has(chaveTelefone(c.telefone || c.contato)));
  const ids = convs.map(c => c.id);
  const auds = new Map(), ultVend = new Map(), primCli = new Map();
  for (let i = 0; i < ids.length; i += 150) {
    const lote = `in.(${ids.slice(i, i + 150).join(",")})`;
    for (const a of await db.select("auditorias", { select: "conversa_id,oportunidade,oportunidade_tipo,agendou,tipo_agendamento,venda", filters: { conversa_id: lote } })) auds.set(a.conversa_id, a);
    for (const m of await db.selectAll("mensagens", { select: "conversa_id,remetente,enviada_em", filters: { conversa_id: lote } })) {
      if (m.remetente === "vendedor") { if (!ultVend.has(m.conversa_id) || m.enviada_em > ultVend.get(m.conversa_id)) ultVend.set(m.conversa_id, m.enviada_em); }
      else if (!primCli.has(m.conversa_id) || m.enviada_em < primCli.get(m.conversa_id)) primCli.set(m.conversa_id, m.enviada_em);
    }
  }
  // status do CRM Q5 por lead (mesmos numeros do WhatsApp)
  const crm = new Map();
  // ultima mensagem de QUALQUER pessoa da equipe para cada cliente (outro vendedor, outro numero ou conversa do CRM):
  // se alguem do time ja falou com o cliente, ele nao esta sem follow-up
  const equipe = new Map();
  const viu = (fone, quando) => { if (fone && quando && (!equipe.has(fone) || quando > equipe.get(fone))) equipe.set(fone, quando); };
  for (const c of await db.selectAll("crm_conversas", { select: "vendedor_id,telefone,status,ultima_msg_sdr_em" })) {
    if (c.vendedor_id && c.telefone) crm.set(`${c.vendedor_id}|${chaveTelefone(digitos(c.telefone))}`, c.status);
    if (c.telefone) viu(chaveTelefone(digitos(c.telefone)), c.ultima_msg_sdr_em);
  }
  for (const c of convs) viu(c.telefone ? chaveTelefone(c.telefone) : c.contato, ultVend.get(c.id));

  const leads = new Map();
  for (const c of convs) {
    const chave = c.telefone ? chaveTelefone(c.telefone) : c.contato;
    const k = `${c.vendedor_id}|${chave}`;
    const l = leads.get(k) || { vendedor_id: c.vendedor_id, lead: chave, telefone: c.telefone, nome: null, ultimaVendedor: null, primeiraCliente: null, ultimaConversa: null, conversaId: null, negociacao: false, fechado: false, assunto: null };
    const a = auds.get(c.id);
    if (a?.venda) l.fechado = true;
    if (a && !a.venda && (a.oportunidade || a.agendou)) { l.negociacao = true; l.assunto = ASSUNTO[a.oportunidade_tipo] || (a.tipo_agendamento === "workshop" ? "vaga no workshop" : l.assunto); }
    const uv = ultVend.get(c.id), pc = primCli.get(c.id);
    if (uv && (!l.ultimaVendedor || uv > l.ultimaVendedor)) l.ultimaVendedor = uv;
    if (pc && (!l.primeiraCliente || pc < l.primeiraCliente)) l.primeiraCliente = pc;
    if (!l.ultimaConversa || c.ultima_msg_em > l.ultimaConversa) { l.ultimaConversa = c.ultima_msg_em; l.conversaId = c.id; }
    l.nome = c.contato_nome || l.nome;
    l.telefone = c.telefone || l.telefone;
    leads.set(k, l);
  }
  const limite = agora - dias * 86400_000;
  return [...leads.values()].map(l => {
    const status = crm.get(`${l.vendedor_id}|${l.lead}`);
    const potencial = !l.fechado && (l.negociacao || (status !== undefined && crmPotencial(status))) && !(status !== undefined && !crmPotencial(status));
    // conta desde a ultima mensagem de alguem da equipe para o cliente; ninguem falou: desde que o lead escreveu
    const daEquipe = equipe.get(l.lead) || null;
    const ultimaDoTime = [l.ultimaVendedor, daEquipe].filter(Boolean).sort().pop() || null;
    const desdeQuando = ultimaDoTime || l.primeiraCliente;
    return { ...l, potencial, desdeQuando, semResposta: !ultimaDoTime, assunto: l.assunto || (status === "custom_presente_no_workshop" ? "presente no workshop" : status === "custom_interessado_na_imersao" ? "interessado na imersão" : null) };
  }).filter(l => l.potencial && l.desdeQuando && Date.parse(l.desdeQuando) <= limite)
    .map(l => ({ ...l, dias: Math.floor((agora - Date.parse(l.desdeQuando)) / 86400_000) }))
    .sort((a, b) => b.dias - a.dias);
}

const nomeLead = l => l.nome || (fone(l.telefone) ? `+55 ${fone(l.telefone)}` : "Lead sem nome");
const itemLead = l => `• ${nomeLead(l)}${l.nome && fone(l.telefone) ? ` · ${fone(l.telefone)}` : ""} · ${l.semResposta ? `lead sem resposta há ${l.dias} dias` : `${l.dias} dias sem follow-up`}${l.assunto ? ` · ${l.assunto}` : ""}\n  ${SITE}/conversas/${l.conversaId}`;

// Para o proprio vendedor (WhatsApp e notificacao no sistema)
export function textoVendedor(nome, lista, dias) {
  const mostra = lista.slice(0, MAX_LISTA);
  return [
    `⏰ *FOLLOW-UP ATRASADO*`, ``,
    `Oi, ${String(nome).split(" ")[0]}! ${lista.length === 1 ? "Esse cliente potencial está" : `Esses ${lista.length} clientes potenciais estão`} há ${dias} dias ou mais sem uma mensagem sua:`, ``,
    ...mostra.map(itemLead),
    ...(lista.length > mostra.length ? [``, `...e mais ${lista.length - mostra.length} no sistema.`] : []), ``,
    `Bora retomar hoje, antes que esfriem! 💪 A gestão também foi avisada.`,
  ].join("\n");
}

// Para a gestao: so a contagem de cada vendedor e o link (a lista completa vai para o proprio vendedor)
export function textoGestao(porVendedor, nomes, funcao, dias) {
  return [
    `⚠️ *Follow-up atrasado* · ${dias}+ dias sem mensagem`,
    [...porVendedor].map(([v, ls]) => `${String(nomes.get(v) || "Vendedor").split(" ")[0]}: ${ls.length} ${ls.length === 1 ? "lead" : "leads"}`).join(" · "),
    `👉 ${SITE}/conversas?aba=todas&p=30`,
  ].join("\n");
}

// Junto com o resumo da manha. Cada lead entra uma vez por periodo sem follow-up (a chave inclui a ultima mensagem do vendedor).
export async function avisarFollowups(db, { envio = enviarWhatsApp, agora = Date.now() } = {}) {
  const R = await carregarRegras(db);
  const s = R.bruto;
  if (s.alerta_followup === false) return "follow-up desligado";
  const dias = s.followup_alerta_d ?? 6;
  const ja = new Set((await db.selectAll("followups_avisados", { select: "vendedor_id,lead,ultima_msg_em" })).map(f => `${f.vendedor_id}|${f.lead}|${Date.parse(f.ultima_msg_em)}`));
  const novos = (await leadsParados(db, R, { agora })).filter(l => !ja.has(`${l.vendedor_id}|${l.lead}|${Date.parse(l.desdeQuando)}`));
  if (!novos.length) return "nenhum lead parado novo";
  const porVendedor = new Map();
  for (const l of novos) porVendedor.set(l.vendedor_id, [...(porVendedor.get(l.vendedor_id) || []), l]);

  const [insts, gestores] = await Promise.all([
    db.select("instancias_whatsapp", { select: "vendedor_id,numero" }),
    db.select("profiles", { select: "id", filters: { papel: "in.(admin,gestor)", ativo: "eq.true" } }),
  ]);
  const numeroDe = new Map(insts.filter(i => i.numero).map(i => [i.vendedor_id, i.numero]));
  const res = [];
  // 1) cada vendedor: notificacao no sistema + WhatsApp no proprio numero
  for (const [v, ls] of porVendedor) {
    const nome = R.nomes.get(v) || "vendedor";
    await db.insert("notificacoes", [{ para: v, tipo: "aviso", categoria: "followup", titulo: `Follow-up atrasado: ${ls.length} ${ls.length === 1 ? "cliente" : "clientes"} há ${dias}+ dias sem mensagem sua`, texto: ls.slice(0, MAX_LISTA).map(l => `${nomeLead(l)} · ${l.dias} dias`).join("\n"), link: `/conversas?v=${v}&aba=todas&p=30` }], { returning: false });
    if (s.instancia_envio_id && numeroDe.get(v)) {
      try { await envio(db, s.instancia_envio_id, numeroDe.get(v), textoVendedor(nome, ls, dias)); res.push(`${nome}: WhatsApp ok`); }
      catch (e) { console.error(`[followup] WhatsApp de ${nome}:`, e.message); res.push(`${nome}: WhatsApp falhou`); }
    }
  }
  // 2) gestao: WhatsApp de alerta + notificacao no sistema
  const textoG = textoGestao(porVendedor, R.nomes, R.funcao, dias);
  await db.insert("notificacoes", gestores.map(g => ({ para: g.id, tipo: "aviso", categoria: "followup", titulo: `Erro de follow-up: ${novos.length} clientes potenciais sem follow-up há ${dias}+ dias`, texto: [...porVendedor].map(([v, ls]) => `${R.nomes.get(v) || "Vendedor"}: ${ls.length}`).join(" · "), link: "/conversas?aba=todas&p=30" })), { returning: false });
  const dest = await destinoResumo(db, { ...s, resumo_ativo: true });
  const ok = dest.tels ? await mandar(db, dest, textoG, envio, "followup") : 0;
  await db.insert("followups_avisados", novos.map(l => ({ vendedor_id: l.vendedor_id, lead: l.lead, ultima_msg_em: l.desdeQuando })), { onConflict: "vendedor_id,lead,ultima_msg_em", ignoreDuplicates: true, returning: false });
  return `${novos.length} leads sem follow-up · ${res.join(", ") || "sem WhatsApp do vendedor"} · gestao ${ok}/${dest.tels?.length ?? 0}`;
}

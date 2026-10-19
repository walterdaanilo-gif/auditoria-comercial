import { addDays, today } from "./config.js";
import { enviarWhatsApp } from "./envio.js";
import { carregarRegras, chaveTelefone } from "./auditor.js";
import { destinoResumo, mandar } from "./relatorio.js";

const SITE = (process.env.SITE_URL || "https://auditoria-comercial-omega.vercel.app").replace(/\/$/, "");
const ASSUNTO = { interesse_workshop: "interesse no workshop", interesse_imersao: "interesse na imersão", reuniao_imersao: "reunião de imersão", reuniao_implementacao: "reunião de implementação" };
const fone = t => { const m = String(t || "").match(/^55(\d{2})(\d{4,5})(\d{4})$/); return m ? `(${m[1]}) ${m[2]}-${m[3]}` : null; };

// Leads em negociacao (interesse, reuniao ou vaga reservada, sem venda fechada) parados ha N dias ou mais.
// Um lead = vendedor + telefone (ou codigo do contato). Ate followup_limite_d dias para tras; cada parada avisa uma vez.
export async function leadsParados(db, R, { agora = Date.now() } = {}) {
  const s = R.bruto, dias = s.followup_alerta_d ?? 6;
  const desde = addDays(today(), -(s.followup_limite_d ?? 30));
  const convs = (await db.selectAll("conversas", { select: "id,vendedor_id,contato,telefone,contato_nome,ultima_msg_em,data,canal,nao_auditar", filters: { data: `gte.${desde}`, canal: "neq.importada" } }))
    .filter(c => !c.nao_auditar && !R.ignorados.has(chaveTelefone(c.telefone || c.contato)));
  const auds = new Map();
  const ids = convs.map(c => c.id);
  for (let i = 0; i < ids.length; i += 150)
    for (const a of await db.select("auditorias", { select: "conversa_id,oportunidade,oportunidade_tipo,agendou,tipo_agendamento,venda,venda_tipo", filters: { conversa_id: `in.(${ids.slice(i, i + 150).join(",")})` } })) auds.set(a.conversa_id, a);

  const leads = new Map();
  for (const c of convs) {
    const k = `${c.vendedor_id}|${c.telefone || c.contato}`;
    const l = leads.get(k) || { vendedor_id: c.vendedor_id, lead: c.telefone || c.contato, telefone: c.telefone, nome: null, ultima: null, conversaId: null, negociacao: false, fechado: false, assunto: null };
    const a = auds.get(c.id);
    if (a?.venda) l.fechado = true;
    if (a && !a.venda && (a.oportunidade || a.agendou)) { l.negociacao = true; l.assunto = ASSUNTO[a.oportunidade_tipo] || (a.tipo_agendamento === "workshop" ? "vaga no workshop" : l.assunto); }
    if (!l.ultima || c.ultima_msg_em > l.ultima) { l.ultima = c.ultima_msg_em; l.conversaId = c.id; }
    l.nome = c.contato_nome || l.nome;
    leads.set(k, l);
  }
  const limite = agora - dias * 86400_000;
  return [...leads.values()].filter(l => l.negociacao && !l.fechado && l.ultima && Date.parse(l.ultima) <= limite)
    .map(l => ({ ...l, dias: Math.floor((agora - Date.parse(l.ultima)) / 86400_000) }));
}

export function textoFollowup(lista, nomes, funcao, dias) {
  const porVendedor = new Map();
  for (const l of lista) porVendedor.set(l.vendedor_id, [...(porVendedor.get(l.vendedor_id) || []), l]);
  const blocos = [...porVendedor].map(([v, ls]) => [
    `*${nomes.get(v) || "Vendedor"} (${funcao.get(v) === "closer" ? "Closer" : "SDR"})*`,
    ...ls.sort((a, b) => b.dias - a.dias).map(l => `• ${l.nome || (fone(l.telefone) ? `+55 ${fone(l.telefone)}` : "Lead sem nome")}${l.nome && fone(l.telefone) ? ` · ${fone(l.telefone)}` : ""} · ${l.dias} dias sem contato${l.assunto ? ` · ${l.assunto}` : ""}\n  ${SITE}/conversas/${l.conversaId}`),
  ].join("\n"));
  return [
    `⏰ *ALERTA DE FOLLOW-UP*`, ``,
    `${lista.length === 1 ? "Esse lead em negociação está" : `Esses ${lista.length} leads em negociação estão`} há ${dias} dias ou mais sem contato:`, ``,
    blocos.join("\n\n"), ``,
    `Bora retomar esses contatos antes que esfriem! 💪`,
  ].join("\n");
}

// Manda o alerta (junto com o resumo da manha). Cada lead parado entra uma vez por periodo sem contato.
export async function avisarFollowups(db, { envio = enviarWhatsApp, agora = Date.now() } = {}) {
  const R = await carregarRegras(db);
  const s = R.bruto;
  if (s.alerta_followup === false) return "follow-up desligado";
  const dest = await destinoResumo(db, { ...s, resumo_ativo: true });
  if (!dest.tels) return dest.motivo;
  const ja = new Set((await db.selectAll("followups_avisados", { select: "vendedor_id,lead,ultima_msg_em" })).map(f => `${f.vendedor_id}|${f.lead}|${Date.parse(f.ultima_msg_em)}`));
  const novos = (await leadsParados(db, R, { agora })).filter(l => !ja.has(`${l.vendedor_id}|${l.lead}|${Date.parse(l.ultima)}`));
  if (!novos.length) return "nenhum lead parado novo";
  const lista = novos.slice(0, 25);
  const ok = await mandar(db, dest, textoFollowup(lista, R.nomes, R.funcao, s.followup_alerta_d ?? 6), envio, "followup");
  if (ok) await db.insert("followups_avisados", lista.map(l => ({ vendedor_id: l.vendedor_id, lead: l.lead, ultima_msg_em: l.ultima })), { onConflict: "vendedor_id,lead,ultima_msg_em", ignoreDuplicates: true, returning: false });
  return `${lista.length} leads parados avisados para ${ok} de ${dest.tels.length}`;
}

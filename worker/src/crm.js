import { dayOf } from "./config.js";
import { carregarRegras, chaveTelefone } from "./auditor.js";

// CRM Q5 -> conversas do sistema. Os numeros sao os mesmos do WhatsApp conectado aqui, entao:
// so o historico de ANTES do WhatsApp do vendedor ser capturado vem do CRM (daqui pra frente vale o WhatsApp).
// Mensagens copiadas levam wa_id "crm:<id>" (nunca duplicam). Notas internas, mensagens automaticas, apagadas e de sistema ficam de fora.
const FORA = ["custom_chat_interno"]; // conversa interna do time
const NAO_POTENCIAL = ["custom_chat_interno", "custom_pos_vendas_perdido", "resolved", "closed"];
export const crmPotencial = status => !NAO_POTENCIAL.includes(String(status || ""));
const TIPO = { text: "texto", audio: "audio", image: "imagem", video: "video", document: "documento" };
const digitos = t => String(t || "").replace(/\D/g, "");

// Inicio da captura do WhatsApp do vendedor (primeira mensagem que nao veio do CRM). Gravado uma vez, para nao mudar depois.
async function corteDe(db, vendedorId, cortes) {
  if (cortes.has(vendedorId)) return cortes.get(vendedorId);
  const [m] = await db.select("mensagens", { select: "enviada_em", filters: { vendedor_id: `eq.${vendedorId}`, wa_id: "not.like.crm:*" }, order: "enviada_em", limit: 1 });
  if (!m) return null; // WhatsApp ainda sem mensagem: copia tudo do CRM, sem fixar o corte
  await db.insert("crm_corte", [{ vendedor_id: vendedorId, corte: m.enviada_em }], { onConflict: "vendedor_id", ignoreDuplicates: true, returning: false });
  cortes.set(vendedorId, m.enviada_em);
  return m.enviada_em;
}

// todosRevisar: revisa todos os clientes potenciais (primeira importacao); senao so os que receberam mensagem nova
export async function importarHistoricoCrm(db, { agora = Date.now(), todosRevisar = false } = {}) {
  const R = await carregarRegras(db);
  const [insts, crmConvs, cortesRows] = await Promise.all([
    db.select("instancias_whatsapp", { select: "id,vendedor_id,numero" }),
    db.selectAll("crm_conversas", { select: "id,vendedor_id,telefone,contato_nome,status" }),
    db.selectAll("crm_corte", { select: "vendedor_id,corte" }),
  ]);
  const instDe = new Map(insts.map(i => [i.vendedor_id, i.id]));
  const doTime = new Set(insts.filter(i => i.numero).map(i => chaveTelefone(i.numero)));
  const cortes = new Map(cortesRows.map(c => [c.vendedor_id, c.corte]));
  const validas = crmConvs.filter(c => c.vendedor_id && instDe.has(c.vendedor_id) && digitos(c.telefone).length >= 10 && !FORA.includes(c.status)
    && !doTime.has(chaveTelefone(digitos(c.telefone))) && !R.ignorados.has(chaveTelefone(digitos(c.telefone))));
  if (!validas.length) return { mensagens: 0, revisar: 0 };

  const ja = new Set((await db.selectAll("mensagens", { select: "wa_id", filters: { wa_id: "like.crm:*" } })).map(m => m.wa_id));
  let novas = 0;
  const tocadas = new Set();
  const porConversa = new Map();
  for (const m of await db.selectAll("crm_mensagens", { select: "id,conversa_id,direcao,tipo,texto,transcricao,enviada_em,nota_interna,automatica,apagada_em", order: "enviada_em" })) {
    if (!ja.has(`crm:${m.id}`)) porConversa.set(m.conversa_id, [...(porConversa.get(m.conversa_id) || []), m]);
  }
  for (const cc of validas) {
    if (!porConversa.has(cc.id)) continue;
    const corte = await corteDe(db, cc.vendedor_id, cortes);
    const limite = corte ? Date.parse(corte) : agora;
    const msgs = porConversa.get(cc.id)
      .filter(m => !ja.has(`crm:${m.id}`) && !m.nota_interna && !m.automatica && !m.apagada_em && ["inbound", "outbound"].includes(m.direcao) && m.tipo !== "system" && Date.parse(m.enviada_em) < limite);
    if (!msgs.length) continue;
    const tel = digitos(cc.telefone);
    const porDia = new Map();
    for (const m of msgs) { const d = dayOf(m.enviada_em); porDia.set(d, [...(porDia.get(d) || []), m]); }
    for (const [data, doDia] of porDia) {
      const ultima = doDia[doDia.length - 1].enviada_em;
      // mesma conversa (instancia + contato + dia) do WhatsApp, se existir, recebe as mensagens; senao nasce como conversa do CRM
      let [conv] = await db.select("conversas", { select: "id,ultima_msg_em,canal", filters: { instancia_id: `eq.${instDe.get(cc.vendedor_id)}`, contato: `eq.${tel}`, data: `eq.${data}` } });
      if (!conv) [conv] = await db.insert("conversas", [{ vendedor_id: cc.vendedor_id, instancia_id: instDe.get(cc.vendedor_id), contato: tel, telefone: tel, contato_nome: cc.contato_nome || undefined, canal: "crm", data, ultima_msg_em: ultima }], { onConflict: "instancia_id,contato,data" });
      const linhas = doDia.map(m => {
        const tipo = TIPO[m.tipo] || "outro";
        return { conversa_id: conv.id, vendedor_id: cc.vendedor_id, wa_id: `crm:${m.id}`, remetente: m.direcao === "outbound" ? "vendedor" : "cliente", texto: m.texto || null, tipo, transcricao: m.transcricao || null, enviada_em: m.enviada_em };
      }).filter(l => l.tipo !== "outro" || l.texto);
      if (linhas.length) await db.insert("mensagens", linhas, { onConflict: "conversa_id,wa_id", ignoreDuplicates: true, returning: false });
      if (!conv.ultima_msg_em || Date.parse(ultima) > Date.parse(conv.ultima_msg_em)) await db.update("conversas", { id: `eq.${conv.id}` }, { ultima_msg_em: ultima });
      novas += linhas.length;
      tocadas.add(cc.id);
    }
  }
  const revisar = await marcarRevisao(db, validas.filter(c => crmPotencial(c.status) && (tocadas.has(c.id) || todosRevisar)), instDe);
  if (novas || revisar) console.log(`[crm] ${novas} mensagens do historico copiadas · ${revisar} clientes potenciais na fila de revisao`);
  return { mensagens: novas, revisar };
}

// Revisao so dos clientes potenciais: a ultima conversa do historico de cada lead (com mensagem dos dois lados)
// vai para a fila de auditoria, uma vez. Lead que ja conversou pelo WhatsApp depois disso e revisado pelo fluxo normal.
async function marcarRevisao(db, potenciais, instDe) {
  let n = 0;
  for (const cc of potenciais) {
    const tel = digitos(cc.telefone);
    const convs = await db.select("conversas", { select: "id,canal,data", filters: { instancia_id: `eq.${instDe.get(cc.vendedor_id)}`, contato: `eq.${tel}` }, order: "data.desc", limit: 1 });
    const ultima = convs[0];
    if (!ultima || ultima.canal !== "crm") continue;
    if ((await db.select("auditorias", { select: "id", filters: { conversa_id: `eq.${ultima.id}` } })).length) continue;
    const msgs = await db.select("mensagens", { select: "remetente", filters: { conversa_id: `eq.${ultima.id}` } });
    if (!msgs.some(m => m.remetente === "vendedor") || !msgs.some(m => m.remetente === "cliente")) continue;
    await db.update("conversas", { id: `eq.${ultima.id}` }, { auditar_rapido: true });
    n++;
  }
  return n;
}

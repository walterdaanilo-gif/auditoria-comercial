import { cfg, today, addDays, dayStart } from "./config.js";

export const CRITERIOS_PADRAO = ["abertura", "descoberta", "beneficio", "objecoes", "chamada_para_acao", "tom"];

const system = (roteiro, criterios) => `Voce e um auditor de conversas comerciais (WhatsApp e ligacoes) de uma equipe que convida leads indicados para um workshop. Responda em portugues do Brasil, direto e informal.

Roteiro usado como regua:
${roteiro}

Analise o texto (VENDEDOR = nosso vendedor, CLIENTE = a pessoa contatada; em ligacoes a transcricao pode vir sem separar quem fala). Responda APENAS com um JSON valido, sem texto fora dele:
{"nota_geral": 0 a 10, "notas": {${criterios.map(c => `"${c}": 0 a 10`).join(", ")}}, "qualidade": "boa"|"regular"|"ruim", "etapa": "abertura"|"descoberta"|"proposta"|"objecao"|"agendamento"|"perdido"|"sem_resposta", "efetiva": true|false, "agendou": true|false,
"gatilhos": {"personalizacao": bool, "pergunta_aberta": bool, "beneficio_claro": bool, "prova_social": bool, "autoridade": bool, "escassez_urgencia": bool, "reciprocidade": bool, "tratamento_objecao": bool, "chamada_para_acao": bool, "followup": bool},
"resumo": "ate 2 frases", "pontos_fortes": "ate 2 pontos curtos", "pontos_melhoria": "ate 2 acoes praticas", "objecoes": "objecoes do cliente ou vazio"}

Gatilhos (true so se o vendedor usou de fato): personalizacao = nome, indicacao ou contexto do lead; pergunta_aberta = perguntou para entender o momento; beneficio_claro = explicou o ganho; prova_social = indicacao, outros participantes, resultados; autoridade = quem conduz ou credencial; escassez_urgencia = vagas ou data limite; reciprocidade = deu algo util antes de pedir; tratamento_objecao = respondeu bem a objecao; chamada_para_acao = propos data e horario; followup = retomou contato apos silencio.
"efetiva" = houve troca real com o cliente. "agendou" = o cliente aceitou data ou horario. Nao invente fatos que nao estao no texto.`;

export async function callClaude(roteiro, criterios, conversa, fetchImpl = fetch) {
  const r = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "x-api-key": cfg.anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: cfg.model, max_tokens: 1100, system: system(roteiro, criterios), messages: [{ role: "user", content: conversa }] }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${JSON.stringify(j.error || j).slice(0, 300)}`);
  const m = (j.content || []).map(c => c.text || "").join("").match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Resposta da IA sem JSON");
  return JSON.parse(m[0]);
}

const clamp = n => Math.max(0, Math.min(10, Math.round((Number(n) || 0) * 10) / 10));
function normalizar(a, criterios) {
  const nota = clamp(a.nota_geral);
  return {
    nota_geral: nota,
    notas: Object.fromEntries(criterios.map(c => [c, clamp(a.notas?.[c])])),
    gatilhos: a.gatilhos && typeof a.gatilhos === "object" ? a.gatilhos : {},
    qualidade: ["boa", "regular", "ruim"].includes(a.qualidade) ? a.qualidade : nota >= 7 ? "boa" : nota >= 4 ? "regular" : "ruim",
    etapa: String(a.etapa || ""), efetiva: !!a.efetiva, agendou: !!a.agendou,
    resumo: String(a.resumo || ""), pontos_fortes: String(a.pontos_fortes || ""), pontos_melhoria: String(a.pontos_melhoria || ""), objecoes: String(a.objecoes || ""),
    modelo: cfg.model, atualizado_em: new Date().toISOString(), sheet_ok: false,
  };
}

const linha = m => `${m.remetente === "vendedor" ? "VENDEDOR" : "CLIENTE"}: ${m.tipo === "audio" ? `[audio] ${m.transcricao || ""}` : m.texto || `[${m.tipo}]`}`;
const cortar = t => (t.length > 14000 ? t.slice(t.length - 14000) : t);

// Audita conversas paradas ha AUDIT_IDLE_MINUTES (com mensagens novas desde a ultima nota) e ligacoes ja transcritas
export async function runAudits(db, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (!cfg.anthropicKey && fetchImpl === fetch) return 0;
  const [cfgRow] = await db.select("config_auditoria", { filters: { id: "eq.1" } });
  const roteiro = cfgRow?.roteiro || "Sem roteiro cadastrado. Avalie pela clareza, simpatia e objetividade do convite.";
  const criterios = Array.isArray(cfgRow?.criterios) && cfgRow.criterios.length ? cfgRow.criterios : CRITERIOS_PADRAO;
  const from = addDays(today(), -cfg.daysBack);
  let feitos = 0;

  // ----- conversas -----
  const convs = await db.selectAll("conversas", { select: "id,vendedor_id,ultima_msg_em", filters: { data: `gte.${from}`, canal: "neq.importada" } });
  if (convs.length) {
    const resumo = new Map();
    for (const m of await db.selectAll("mensagens", { select: "conversa_id,remetente,tipo,transcricao,audio_url", filters: { enviada_em: `gte.${dayStart(from)}` }, order: "id" })) {
      const r = resumo.get(m.conversa_id) || { n: 0, vend: 0, pendAudio: 0 };
      r.n++; if (m.remetente === "vendedor") r.vend++;
      if (m.tipo === "audio" && m.audio_url && m.transcricao == null) r.pendAudio++;
      resumo.set(m.conversa_id, r);
    }
    const auds = new Map((await db.selectAll("auditorias", { select: "conversa_id,msg_count", filters: { conversa_id: "not.is.null", atualizado_em: `gte.${dayStart(addDays(from, -1))}` } })).map(a => [a.conversa_id, a.msg_count]));
    for (const c of convs) {
      const r = resumo.get(c.id);
      if (!r || !r.vend) continue;
      const parada = now - new Date(c.ultima_msg_em).getTime();
      if (parada < cfg.idleMin * 60000) continue;
      if (r.pendAudio && parada < 30 * 60000) continue; // espera a transcricao dos audios
      if ((auds.get(c.id) ?? -1) >= r.n) continue;
      try {
        const msgs = await db.select("mensagens", { select: "remetente,texto,tipo,transcricao", filters: { conversa_id: `eq.${c.id}` }, order: "enviada_em" });
        const a = normalizar(await callClaude(roteiro, criterios, cortar(msgs.map(linha).join("\n")), fetchImpl), criterios);
        await db.insert("auditorias", [{ conversa_id: c.id, vendedor_id: c.vendedor_id, msg_count: r.n, ...a }], { onConflict: "conversa_id", returning: false });
        feitos++;
      } catch (e) { console.error(`[auditoria] conversa ${c.id}:`, e.message); }
    }
  }

  // ----- conversas importadas (tela Testar auditor): auditadas uma vez, de qualquer data -----
  const imps = await db.select("conversas", { select: "id,vendedor_id", filters: { canal: "eq.importada" }, order: "criado_em.desc", limit: 50 });
  if (imps.length) {
    const ja = new Set((await db.select("auditorias", { select: "conversa_id", filters: { conversa_id: `in.(${imps.map(c => c.id).join(",")})` } })).map(a => a.conversa_id));
    for (const c of imps) {
      if (ja.has(c.id)) continue;
      try {
        const msgs = await db.select("mensagens", { select: "remetente,texto,tipo,transcricao", filters: { conversa_id: `eq.${c.id}` }, order: "enviada_em" });
        if (!msgs.some(m => m.remetente === "vendedor")) continue;
        const a = normalizar(await callClaude(roteiro, criterios, cortar(msgs.map(linha).join("\n")), fetchImpl), criterios);
        // sheet_ok: importadas sao teste e nao vao para a planilha
        await db.insert("auditorias", [{ conversa_id: c.id, vendedor_id: c.vendedor_id, msg_count: msgs.length, ...a, sheet_ok: true }], { onConflict: "conversa_id", returning: false });
        feitos++;
      } catch (e) { console.error(`[auditoria] importada ${c.id}:`, e.message); }
    }
  }

  // ----- ligacoes -----
  const ligs = await db.select("ligacoes", { select: "id,vendedor_id,transcricao", filters: { transcricao: "not.is.null" }, order: "iniciada_em.desc", limit: 50 });
  if (ligs.length) {
    const ja = new Set((await db.selectAll("auditorias", { select: "ligacao_id", filters: { ligacao_id: "not.is.null" } })).map(a => a.ligacao_id));
    for (const l of ligs) {
      if (ja.has(l.id) || l.transcricao.startsWith("[")) continue;
      try {
        const a = normalizar(await callClaude(roteiro, criterios, cortar("TRANSCRICAO DA LIGACAO:\n" + l.transcricao), fetchImpl), criterios);
        await db.insert("auditorias", [{ ligacao_id: l.id, vendedor_id: l.vendedor_id, msg_count: 0, ...a }], { onConflict: "ligacao_id", returning: false });
        feitos++;
      } catch (e) { console.error(`[auditoria] ligacao ${l.id}:`, e.message); }
    }
  }
  return feitos;
}

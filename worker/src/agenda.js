import crypto from "node:crypto";
import { cfg } from "./config.js";

// Reuniao (de implementacao ou de imersao) confirmada pelo cliente, de qualquer WhatsApp conectado -> evento amarelo na Agenda Google do gestor.
// O gestor conecta a agenda em Configuracoes (login Google); o refresh_token fica em google_agenda (so o servidor le).
const SITE = (process.env.SITE_URL || "https://auditoria-comercial-omega.vercel.app").replace(/\/$/, "");
const AMARELO = "5"; // "Banana" na paleta de cores de evento do Google Agenda
const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

let cache = { token: null, expira: 0 };
async function tokenAcesso(db, fetchImpl) {
  if (cache.token && Date.now() < cache.expira - 60_000) return cache.token;
  const [g] = await db.select("google_agenda", { filters: { id: "eq.1" } });
  if (!g?.refresh_token) return null;
  if (!cfg.googleClientId || !cfg.googleClientSecret) throw new Error("GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET vazios no worker");
  const r = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.googleClientId, client_secret: cfg.googleClientSecret, refresh_token: g.refresh_token, grant_type: "refresh_token" }),
  });
  const j = await r.json();
  if (!r.ok) {
    await db.update("google_agenda", { id: "eq.1" }, { erro: `Google recusou o acesso (${j.error || r.status}). Conecte a agenda de novo em Configurações.` });
    throw new Error(`token Google: ${j.error || r.status}`);
  }
  cache = { token: j.access_token, expira: Date.now() + Number(j.expires_in || 3600) * 1000 };
  return cache.token;
}

// Inicio e fim no horario de Brasilia (sem horario de verao)
const inicioIso = r => `${r.data}T${r.hora}:00-03:00`;
const somaMin = (iso, min) => new Date(Date.parse(iso) + min * 60_000).toISOString();

export function montarEvento(r, { vendedor, contato, conversaId, duracao = 60, convidar = true, meet = true }) {
  const cliente = r.cliente_nome || `+${contato}`;
  const titulo = [r.tipo === "imersao" ? "Reunião de imersão" : "Reunião de implementação", cliente, r.empresa].filter(Boolean).join(" · ");
  const inicio = inicioIso(r);
  const descricao = [
    `Cliente: ${cliente}`, r.empresa && `Empresa: ${r.empresa}`, r.email && `E-mail: ${r.email}`, `WhatsApp: +${contato}`,
    `Modalidade: ${r.modalidade === "presencial" ? "presencial" : r.modalidade === "online" ? "online" : "não informada"}`,
    r.local && `Local: ${r.local}`, `Marcada por: ${vendedor}`,
  ].filter(Boolean).join("\n") + `\n\nConversa: ${SITE}/conversas/${conversaId}`;
  const ev = {
    summary: titulo, description: descricao, colorId: AMARELO,
    start: { dateTime: inicio, timeZone: "America/Sao_Paulo" },
    end: { dateTime: somaMin(inicio, r.duracao_min || duracao), timeZone: "America/Sao_Paulo" },
    ...(r.modalidade === "presencial" && r.local ? { location: r.local } : {}),
    ...(convidar && r.email ? { attendees: [{ email: r.email, displayName: cliente }] } : {}),
    ...(meet && r.modalidade !== "presencial" ? { conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
  };
  return ev;
}

// Cria ou atualiza o evento da reuniao desta conversa. Implementacao ou imersao, confirmada, no futuro.
export async function sincronizarReuniao(db, R, c, r, { fetchImpl = fetch } = {}) {
  if (!r || !["implementacao", "imersao"].includes(r.tipo) || !r.cliente_confirmou || !r.data || !r.hora) return null;
  const [s] = await db.select("audit_settings", { select: "agenda_ativa,agenda_duracao_min,agenda_convidar,agenda_meet", filters: { id: "eq.1" } });
  if (s && s.agenda_ativa === false) return null;
  const inicio = inicioIso(r);
  if (Date.parse(inicio) < Date.now() - 3600_000) return null; // reuniao que ja passou nao vai para a agenda

  // mesma conversa, ou a mesma reuniao marcada em outra conversa do mesmo lead (outro dia)
  const [daConversa] = await db.select("reunioes_agenda", { filters: { conversa_id: `eq.${c.id}` } });
  const [doLead] = daConversa ? [] : (await db.select("reunioes_agenda", { filters: { vendedor_id: `eq.${c.vendedor_id}` }, order: "atualizado_em.desc", limit: 20 })).filter(x => x.dados?.contato === c.contato && Date.parse(x.inicio) > Date.now());
  const atual = daConversa || doLead;
  const ev = montarEvento(r, { vendedor: R.nomes.get(c.vendedor_id) || "vendedor", contato: c.telefone || c.contato, conversaId: c.id, duracao: s?.agenda_duracao_min ?? 60, convidar: s?.agenda_convidar ?? true, meet: s?.agenda_meet ?? true });
  const dados = { ...r, contato: c.contato };
  if (atual?.google_event_id && atual.inicio && Date.parse(atual.inicio) === Date.parse(inicio) && JSON.stringify(atual.dados) === JSON.stringify(dados)) return "sem mudanca";

  const token = await tokenAcesso(db, fetchImpl);
  if (!token) return "agenda nao conectada";
  const novo = !atual?.google_event_id;
  if (!novo) delete ev.conferenceData; // ja tem Meet desde a criacao
  const url = `${API}${novo ? "" : `/${atual.google_event_id}`}?conferenceDataVersion=1&sendUpdates=${ev.attendees ? "all" : "none"}`;
  const resp = await fetchImpl(url, { method: novo ? "POST" : "PATCH", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(ev) });
  const j = await resp.json();
  const linha = { conversa_id: atual?.conversa_id || c.id, vendedor_id: c.vendedor_id, inicio: new Date(inicio).toISOString(), dados, atualizado_em: new Date().toISOString() };
  if (!resp.ok) {
    await db.insert("reunioes_agenda", [{ ...linha, google_event_id: atual?.google_event_id || null, erro: `${resp.status}: ${JSON.stringify(j.error || j).slice(0, 200)}` }], { onConflict: "conversa_id", returning: false });
    throw new Error(`Google Agenda ${resp.status}: ${JSON.stringify(j.error || j).slice(0, 200)}`);
  }
  await db.insert("reunioes_agenda", [{ ...linha, google_event_id: j.id, link: j.htmlLink || null, erro: null }], { onConflict: "conversa_id", returning: false });
  console.log(`[agenda] reuniao ${novo ? "criada" : "atualizada"}: ${ev.summary} em ${r.data} ${r.hora}`);
  return novo ? "criada" : "atualizada";
}

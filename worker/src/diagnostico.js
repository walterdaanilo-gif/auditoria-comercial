import { cfg, addDays, today } from "./config.js";
import { carregarRegras, chaveTelefone } from "./auditor.js";
import { enviarWhatsApp } from "./envio.js";
import { notificar } from "./notificar.js";

// Aviso ao SDR, 6 horas antes de cada turma do workshop, dos inscritos que ainda nao preencheram o diagnostico.
// Fontes (todas so de leitura):
//   - turmas e horarios: abas da planilha "Controle de diagnosticos" ("WORKSHOP 09/11/26 18h"), lidas da pagina publica (htmlview)
//   - turma de cada pessoa: relatorio de leads do site (/api/admin/dash, campo data_evento "09/11")
//   - quem ja preencheu: painel de diagnosticos do site (/api/diagnostico/list), casando pelo telefone
//   - SDR de cada cliente: a conversa mais recente dele (WhatsApp conectado ou CRM) com um SDR
// O codigo de acesso do site fica em DIAGNOSTICO_CODE (segredo da funcao) e nunca vai para o log nem para o codigo.
const ANTECEDENCIA_MS = 6 * 3600_000;
const JANELA_DIAS = 180;       // conversas e links olhados para tras
const LINK = "questionario/diagnostico";
const MAX_LISTA = 25;
const pad = n => String(n).padStart(2, "0");

// ---------- turmas (abas da planilha) ----------
const desescapa = s => s.replace(/\\\//g, "/").replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));

// "WORKSHOP 09/11/26 18h", "WORKSHOP ODONTO 06/11/26 14h", "WORKSHOP 31/10/26 9h", "WORKSHOP 03/11/26" (sem hora: nao agenda aviso)
export function lerTurmas(html) {
  const out = [], vistos = new Set();
  for (const m of String(html).matchAll(/\{name:\s*"((?:[^"\\]|\\.)*)"\s*,\s*pageUrl:[^}]*?gid:\s*"(\d+)"/g)) {
    const nome = desescapa(m[1]).trim();
    if (!/^workshop/i.test(nome) || vistos.has(m[2])) continue;
    const d = nome.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (!d) continue;
    vistos.add(m[2]);
    const ano = d[3].length === 2 ? 2000 + Number(d[3]) : Number(d[3]);
    const h = nome.slice(d.index + d[0].length).match(/^\s*(\d{1,2})\s*h(?:\s*(\d{2}))?/i);
    const data = `${ano}-${pad(d[2])}-${pad(d[1])}`;
    const hora = h ? `${pad(h[1])}:${h[2] || "00"}` : null;
    out.push({ chave: m[2], nome, ddmm: `${pad(d[1])}/${pad(d[2])}`, data, hora, inicio: hora ? Date.parse(`${data}T${hora}:00${cfg.tzOffset}`) : null });
  }
  return out;
}
export const naJanela = (t, agora) => !!t.inicio && agora >= t.inicio - ANTECEDENCIA_MS && agora < t.inicio;

// ---------- telefone ----------
const digitos = t => String(t || "").replace(/\D/g, "");
export const chave = t => { const k = chaveTelefone(t); return /^\d{10}$/.test(k) ? k : ""; }; // DDD + 8 ultimos digitos
export const fone = t => { const d = digitos(t).replace(/^55(?=\d{10,11}$)/, ""); return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : t || ""; };

// ---------- regra principal (sem rede nem banco) ----------
// leads: relatorio do site. diagnosticos: linhas do painel. donos: telefone -> id do SDR. links: telefones que receberam o link de um SDR.
const inscrito = l => !!l.data_evento && !!chave(l.whatsapp) && (l.status !== "lead" || !!l.paid_at || !!l.inscrito_direto_at); // quem so escolheu a data e nao se inscreveu fica de fora
// destinatarios: SDRs escolhidos em Configuracoes. Lista vazia/ausente = cada pendente vai para o SDR dono dele.
// Com lista, so eles recebem: o que era de outro SDR (ou de ninguem) e repartido entre eles, em rodizio.
export function pendentesDaTurma(turma, { leads, diagnosticos, donos, links, destinatarios = null }) {
  const preencheram = new Set();
  for (const r of diagnosticos) for (const campo of ["whatsapp", "p4_whatsapp"]) { const k = chave(r.variables?.[campo]); if (k) preencheram.add(k); }
  const doDia = leads.filter(l => inscrito(l) && l.data_evento === turma.ddmm);
  const porSdr = new Map(), semSdr = [];
  const escolhidos = Array.isArray(destinatarios) && destinatarios.length ? [...destinatarios] : null;
  let preenchidos = 0, rodizio = 0;
  const vistos = new Set();
  for (const l of doDia) {
    const k = chave(l.whatsapp);
    if (vistos.has(k)) continue;
    vistos.add(k);
    if (preencheram.has(k)) { preenchidos++; continue; }
    const item = { nome: String(l.nome || "").trim(), telefone: l.whatsapp, linkEnviado: links.has(k) };
    let sdr = donos.get(k);
    if (escolhidos && !escolhidos.includes(sdr)) sdr = escolhidos[rodizio++ % escolhidos.length];
    if (sdr) porSdr.set(sdr, [...(porSdr.get(sdr) || []), item]); else semSdr.push(item);
  }
  const pend = [...porSdr.values()].reduce((n, l) => n + l.length, 0) + semSdr.length;
  return { inscritos: vistos.size, preenchidos, pendentes: pend, porSdr, semSdr };
}

// ---------- textos ----------
export const rotuloTurma = t => `${t.ddmm} às ${Number(t.hora.slice(0, 2))}h${t.hora.slice(3) === "00" ? "" : t.hora.slice(3)}`;
const itemTxt = i => `• ${i.nome || "Sem nome"}${fone(i.telefone) ? ` · ${fone(i.telefone)}` : ""} · ${i.linkEnviado ? "link já enviado" : "link ainda não enviado"}`;
const lista = itens => [...itens.slice(0, MAX_LISTA).map(itemTxt), ...(itens.length > MAX_LISTA ? [`...e mais ${itens.length - MAX_LISTA}.`] : [])];
export function textoSdr(nome, turma, itens, horas) {
  return [
    `📝 *DIAGNÓSTICO PENDENTE · Turma ${rotuloTurma(turma)}*`, ``,
    `Oi, ${String(nome || "").split(" ")[0] || "tudo bem"}! A turma começa em cerca de ${horas}h e ${itens.length === 1 ? "este cliente seu ainda não preencheu" : `estes ${itens.length} clientes seus ainda não preencheram`} o diagnóstico:`, ``,
    ...lista(itens), ``,
    `Chame agora para ele preencher antes do workshop 💪`,
  ].join("\n");
}

// ---------- leitura das fontes ----------
async function lerSite(fetchImpl, caminho) {
  const r = await fetchImpl(`${cfg.diagnosticoSite}${caminho}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: cfg.diagnosticoCode }) });
  if (!r.ok) throw new Error(`site do diagnostico ${caminho}: HTTP ${r.status}`); // nunca inclui a resposta nem o codigo
  return r.json();
}
async function lerBases(db, R, desde, ativos) {
  const [convs, crm] = await Promise.all([
    db.selectAll("conversas", { select: "id,vendedor_id,contato,telefone,ultima_msg_em", filters: { data: `gte.${desde}`, canal: "neq.importada" } }),
    db.selectAll("crm_conversas", { select: "id,vendedor_id,telefone,ultima_msg_em" }),
  ]);
  const [msgs, crmMsgs] = await Promise.all([
    db.selectAll("mensagens", { select: "conversa_id", filters: { remetente: "eq.vendedor", texto: `ilike.*${LINK}*`, enviada_em: `gte.${desde}` } }),
    db.selectAll("crm_mensagens", { select: "conversa_id", filters: { direcao: "eq.outbound", nota_interna: "eq.false", texto: `ilike.*${LINK}*`, enviada_em: `gte.${desde}` } }),
  ]);
  // dono: o SDR da conversa mais recente com o cliente (closer nao conta)
  const melhor = new Map();
  const ver = (v, tel, quando) => {
    const k = chave(tel);
    if (!v || !k || R.funcao.get(v) === "closer" || !ativos.has(v)) return; // closer e perfil inativo nao sao donos
    const q = Date.parse(quando) || 0, at = melhor.get(k);
    if (!at || q > at.q) melhor.set(k, { v, q });
  };
  for (const c of convs) ver(c.vendedor_id, c.telefone || c.contato, c.ultima_msg_em);
  for (const c of crm) ver(c.vendedor_id, c.telefone, c.ultima_msg_em);
  const donos = new Map([...melhor].map(([k, x]) => [k, x.v]));
  const porId = new Map([...convs.map(c => [c.id, chave(c.telefone || c.contato)]), ...crm.map(c => [c.id, chave(c.telefone)])]);
  const links = new Set([...msgs, ...crmMsgs].map(m => porId.get(m.conversa_id)).filter(Boolean));
  return { donos, links };
}

// ---------- tarefa (roda no ciclo de 5 minutos) ----------
export async function avisarDiagnosticos(db, { agora = Date.now(), fetchImpl = fetch, envio = enviarWhatsApp } = {}) {
  if (!cfg.diagnosticoCode || !cfg.diagnosticoPlanilha) return "desligado: faltam DIAGNOSTICO_CODE e DIAGNOSTICO_PLANILHA_ID";
  const pagina = await fetchImpl(`https://docs.google.com/spreadsheets/d/${cfg.diagnosticoPlanilha}/htmlview`);
  if (!pagina.ok) throw new Error(`planilha das turmas: HTTP ${pagina.status}`);
  const html = await pagina.text();
  const turmas = lerTurmas(html);
  if (!turmas.length) return html.length > 5000 ? "aviso: nao achei as abas das turmas (o formato da planilha mudou?)" : "planilha sem turmas";
  const feitas = new Set((await db.select("diagnostico_turmas", { select: "turma" })).map(t => t.turma));
  const devidas = turmas.filter(t => naJanela(t, agora) && !feitas.has(t.chave));
  if (!devidas.length) return "nenhuma turma na janela de 6h";

  const R = await carregarRegras(db);
  const s = R.bruto;
  const perfisAtivos = new Set((await db.select("profiles", { select: "id", filters: { ativo: "eq.true" } })).map(p => p.id));
  // quem recebe: os SDRs marcados em Configuracoes (ativos e nao closer); sem ninguem marcado, todos os SDRs ativos donos de cliente
  const marcados = (Array.isArray(s.diagnostico_sdrs) ? s.diagnostico_sdrs : []).filter(id => perfisAtivos.has(id) && R.funcao.get(id) !== "closer");
  if (Array.isArray(s.diagnostico_sdrs) && s.diagnostico_sdrs.length && !marcados.length) return "aviso: nenhum dos SDRs marcados em Configuracoes esta ativo; nada enviado";
  const [leadsResp, diagResp, bases, insts] = await Promise.all([
    lerSite(fetchImpl, "/api/admin/dash"), lerSite(fetchImpl, "/api/diagnostico/list"),
    lerBases(db, R, addDays(today(), -JANELA_DIAS), perfisAtivos),
    db.select("instancias_whatsapp", { select: "vendedor_id,numero" }),
  ]);
  const leads = leadsResp?.leads, diagnosticos = diagResp?.rows;
  if (!Array.isArray(leads) || !Array.isArray(diagnosticos)) throw new Error("o site do diagnostico devolveu um formato inesperado");
  const numeroDe = new Map(insts.filter(i => i.numero).map(i => [i.vendedor_id, i.numero]));

  const resumo = [];
  for (const turma of devidas) {
    const p = pendentesDaTurma(turma, { leads, diagnosticos, ...bases, destinatarios: marcados });
    const horas = Math.max(1, Math.round((turma.inicio - agora) / 3600_000));
    const jaAvisados = new Set((await db.select("diagnostico_avisos", { select: "vendedor_id", filters: { turma: `eq.${turma.chave}` } })).map(a => a.vendedor_id));
    let enviados = 0;
    for (const [v, itens] of p.porSdr) {
      if (jaAvisados.has(v)) continue;
      const nome = R.nomes.get(v) || "";
      const canais = [];
      await notificar(db, [v], { categoria: "diagnostico", titulo: `Diagnóstico pendente: ${itens.length} ${itens.length === 1 ? "cliente" : "clientes"} da turma ${rotuloTurma(turma)}`, texto: lista(itens).join("\n") }) && canais.push("sino");
      if (s.instancia_envio_id && numeroDe.get(v)) {
        try { await envio(db, s.instancia_envio_id, numeroDe.get(v), textoSdr(nome, turma, itens, horas)); canais.push("whatsapp"); }
        catch (e) { console.error(`[diagnostico] WhatsApp de ${nome || v}:`, e.message); }
      }
      await db.insert("diagnostico_avisos", [{ turma: turma.chave, vendedor_id: v, qtd: itens.length, canais: canais.join(",") }], { onConflict: "turma,vendedor_id", ignoreDuplicates: true, returning: false });
      enviados++;
    }
    await db.insert("diagnostico_turmas", [{ turma: turma.chave, nome: turma.nome, inscritos: p.inscritos, pendentes: p.pendentes, sem_sdr: p.semSdr.length }], { onConflict: "turma", ignoreDuplicates: true, returning: false });
    resumo.push(`${turma.nome}: ${p.inscritos} inscritos, ${p.pendentes} sem diagnostico, ${enviados} SDR(s) avisado(s)${p.semSdr.length ? `, ${p.semSdr.length} sem SDR identificado` : ""}`);
  }
  return resumo.join(" | ");
}

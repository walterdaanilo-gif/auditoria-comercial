import { cfg, today } from "./config.js";
import { enviarWhatsApp } from "./envio.js";
import { gestores, notificar } from "./notificar.js";
import { carregarRegras } from "./auditor.js";
import { leadsParados } from "./followup.js";

const SITE = (process.env.SITE_URL || "https://auditoria-comercial-omega.vercel.app").replace(/\/$/, "");
const brl = n => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const dur = s => (s == null ? "—" : s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}min` : `${Math.floor(s / 3600)}h${String(Math.round((s % 3600) / 60)).padStart(2, "0")}`);
const ddmm = d => d.split("-").reverse().slice(0, 2).join("/");
const somar = (l, k) => l.reduce((s, x) => s + Number(x[k] || 0), 0);
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const hh = h => `${Number(String(h).slice(0, 2))}h`;

// Contadores que somam ao longo do dia: a tarde = dia - manha (guardada as 13h)
const CONTA = ["respostas", "marc", "wCupom", "wPagos", "wValor", "imersao", "imValor", "reunioesImpl", "ligAt", "lig", "ligSeg", "oport"];

// Numeros de um dia: time inteiro e cada vendedor
export async function calcularDia(db, dia) {
  const [[s = {}], linhas, convs] = await Promise.all([
    db.select("audit_settings", { filters: { id: "eq.1" } }),
    db.rpc("resumo_sdr2", { p_from: dia, p_to: dia }),
    db.selectAll("conversas", { select: "id,data,canal", filters: { data: `eq.${dia}`, canal: "neq.importada" } }),
  ]);
  const ids = convs.map(c => c.id);
  const auds = [];
  for (let i = 0; i < ids.length; i += 150) auds.push(...await db.select("auditorias", { select: "vendedor_id,nota_geral,so_bot,venda,venda_tipo,venda_valor,venda_cupom,venda_convite_origem,remarcacao,oportunidade,oportunidade_tipo,critico,primeira_resposta_seg,tempo_medio_resposta_seg,respostas_sdr", filters: { conversa_id: `in.(${ids.slice(i, i + 150).join(",")})` } }));
  // o time = quem tem WhatsApp cadastrado (aparece mesmo sem atividade no dia: zero marcacao tambem e informacao)
  const time_ = (await db.select("instancias_whatsapp", { select: "vendedor_id" })).map(i => i.vendedor_id);
  const vendIds = [...new Set([...time_, ...linhas.map(l => l.vendedor_id), ...auds.map(a => a.vendedor_id)].filter(Boolean))];
  const perfis = vendIds.length ? (await db.select("profiles", { select: "id,nome,funcao,ativo", filters: { id: `in.(${vendIds.join(",")})` } })).filter(p => p.ativo !== false) : [];

  const resumo = (l, ls) => {
    const notas = l.filter(a => !a.so_bot);
    const w = l.filter(a => a.venda && a.venda_tipo !== "imersao"), im = l.filter(a => a.venda && a.venda_tipo === "imersao");
    const pr = l.filter(a => a.primeira_resposta_seg != null), md = l.filter(a => a.tempo_medio_resposta_seg != null && a.respostas_sdr);
    const nResp = somar(md, "respostas_sdr");
    return {
      n: notas.length, nota: notas.length ? somar(notas, "nota_geral") / notas.length : null,
      wCupom: w.filter(a => a.venda_cupom).length, wCarbone: w.filter(a => a.venda_cupom && a.venda_convite_origem === "carbone").length, wPagos: w.filter(a => !a.venda_cupom).length, wValor: somar(w.filter(a => !a.venda_cupom), "venda_valor"),
      imersao: im.length, imValor: somar(im, "venda_valor"),
      oport: l.filter(a => a.oportunidade).length, reunioesImpl: l.filter(a => a.oportunidade_tipo === "reuniao_implementacao" && !a.remarcacao).length, criticos: l.filter(a => a.critico).length,
      primeira: pr.length ? somar(pr, "primeira_resposta_seg") / pr.length : null,
      medio: nResp ? md.reduce((x, a) => x + a.tempo_medio_resposta_seg * a.respostas_sdr, 0) / nResp : null,
      respostas: somar(ls, "respostas"), marc: somar(ls, "marcacoes"), ligAt: somar(ls, "ligacoes_atendidas"), lig: somar(ls, "ligacoes"), ligSeg: somar(ls, "ligacoes_seg"),
    };
  };
  const time = resumo(auds, linhas);
  const pessoas = perfis.map(p => ({ id: p.id, nome: p.nome, closer: p.funcao === "closer", ...resumo(auds.filter(a => a.vendedor_id === p.id), linhas.filter(l => l.vendedor_id === p.id)) }))
    .sort((a, b) => (b.nota ?? -1) - (a.nota ?? -1) || (b.wCupom + b.wPagos + b.imersao) - (a.wCupom + a.wPagos + a.imersao));
  return { s, time, pessoas };
}

// So os contadores (guardados as 13h para separar a tarde as 19h)
const contadores = d => ({ time: Object.fromEntries(CONTA.map(k => [k, d.time[k]])), pessoas: Object.fromEntries(d.pessoas.map(p => [p.id, Object.fromEntries(CONTA.map(k => [k, p[k]]))])) });

// Resumo para o gestor decidir rapido: vendas, marcacoes x meta, ligacoes; depois so quem precisa de atencao e o destaque.
// Meta do dia por pessoa (Configuracoes). As 13h vale metade da meta do dia.
const metaDe = (p, s) => (p.closer ? s.meta_closer_reunioes ?? null : s.meta_sdr_marcacoes ?? 6);
const feitoDe = p => (p.closer ? p.reunioesImpl : p.marc);
const alvo = (meta, turno) => (meta == null ? null : turno === "manha" ? Math.ceil(meta / 2) : meta);

function linhaVendas(t) {
  const partes = [];
  if (t.imersao) partes.push(`${plural(t.imersao, "imersão", "imersões")}${t.imValor ? ` ${brl(t.imValor)}` : ""}`);
  if (t.wPagos) partes.push(`${plural(t.wPagos, "workshop", "workshops")}${t.wValor ? ` ${brl(t.wValor)}` : ""}`);
  if (t.wCupom) partes.push(plural(t.wCupom, "convite", "convites"));
  return `💰 Vendas: ${partes.length ? partes.join(" · ") : "nenhuma ainda"}`;
}

export function textoResumo(d, dia, { turno = "dia", parados = new Map() } = {}) {
  const { s, time, pessoas } = d;
  const metaTime = pessoas.filter(p => !p.closer).reduce((n, p) => n + (metaDe(p, s) ?? 0), 0);
  // atencao: abaixo da meta do turno, ou com follow-up atrasado
  const atencao = pessoas.map(p => {
    const meta = alvo(metaDe(p, s), turno), fu = parados.get(p.id) || 0;
    const abaixo = meta != null && feitoDe(p) < meta;
    if (!abaixo && !fu) return null;
    const partes = [];
    if (abaixo) partes.push(`${feitoDe(p)}/${metaDe(p, s)} ${p.closer ? "reuniões" : "marcações"}`);
    if (fu) partes.push(plural(fu, "follow-up atrasado", "follow-ups atrasados"));
    return `⚠️ ${p.nome.split(" ")[0]} ${partes.join(" · ")}`;
  }).filter(Boolean);
  const pontos = p => feitoDe(p) + p.wCupom + p.wPagos + p.imersao * 3;
  const naMeta = p => { const meta = alvo(metaDe(p, s), turno); return meta == null || feitoDe(p) >= meta; };
  const top = pessoas.filter(naMeta).sort((a, b) => pontos(b) - pontos(a) || b.ligAt - a.ligAt)[0];
  const destaque = top && pontos(top) > 0
    ? `👑 ${top.nome.split(" ")[0]}: ${[feitoDe(top) && plural(feitoDe(top), top.closer ? "reunião" : "marcação", top.closer ? "reuniões" : "marcações"), top.imersao && plural(top.imersao, "imersão", "imersões"), (top.wPagos + top.wCupom) && plural(top.wPagos + top.wCupom, "inscrição no workshop", "inscrições no workshop")].filter(Boolean).join(" · ")}`
    : null;
  return [
    `🚀 *Resumo ${hh(turno === "manha" ? s.resumo_manha_hora || "13:00" : s.rodada_final_hora || "19:00")} · ${ddmm(dia)}*`, ``,
    linhaVendas(time),
    `📅 Marcações: ${time.marc}${metaTime ? `/${metaTime}` : ""}`,
    `📞 Ligações: ${time.ligAt ? `${plural(time.ligAt, "atendida", "atendidas")}${time.ligSeg ? ` · ${dur(time.ligSeg)}` : ""}` : "nenhuma atendida"}`,
    ...(atencao.length || destaque ? [``, ...atencao, ...(destaque ? [destaque] : [])] : []),
    ``, `Detalhes 👉 ${SITE}`,
  ].join("\n");
}

// Para quem e por onde mandar (Configuracoes > Alertas ao gestor); null = nao manda hoje (com o motivo)
export async function destinoResumo(db, s) {
  if (!s?.resumo_ativo) return { motivo: "resumo desligado" };
  if (!(s.resumo_dias || []).includes(new Date(today() + "T12:00:00Z").getUTCDay())) return { motivo: "hoje nao e dia de resumo" };
  if (!s.instancia_envio_id) return { motivo: "sem WhatsApp de envio" };
  const tels = (await db.select("telefones_alerta", { select: "telefone", filters: s.org_id ? { org_id: `eq.${s.org_id}` } : {} })).map(t => t.telefone);
  if (!tels.length) return { motivo: "sem telefones de alerta" };
  return { instancia: s.instancia_envio_id, tels };
}
export async function mandar(db, dest, texto, envio, rotulo) {
  let ok = 0;
  for (const t of dest.tels) {
    try { await envio(db, dest.instancia, t, texto); ok++; }
    catch (e) { console.error(`[${rotulo}] envio para ${t}:`, e.message); }
  }
  return ok;
}

// turno "manha" (13h) ou "dia" (19h). Os numeros da manha ficam guardados em resumos_turno.
export async function enviarRelatorio(db, { turno = "dia", envio = enviarWhatsApp } = {}) {
  const hoje = today();
  const d = await calcularDia(db, hoje);
  if (turno === "manha") await db.insert("resumos_turno", [{ data: hoje, turno: "manha", dados: contadores(d) }], { onConflict: "data,turno", returning: false });
  const dest = await destinoResumo(db, d.s);
  if (!dest.tels) return dest.motivo;
  let parados = new Map();
  try { for (const l of await leadsParados(db, await carregarRegras(db))) parados.set(l.vendedor_id, (parados.get(l.vendedor_id) || 0) + 1); }
  catch (e) { console.error("[relatorio] follow-up:", e.message); }
  const texto = textoResumo(d, hoje, { turno, parados });
  await notificar(db, await gestores(db), { categoria: "resumo", titulo: `${turno === "manha" ? "☀️ Resumo das 13h" : "🌙 Resumo do dia"} · ${ddmm(hoje)}`, texto: texto.replace(/^.*\n\n/, ""), link: "/" });
  const ok = await mandar(db, dest, texto, envio, "relatorio");
  if (ok) await db.update("audit_settings", { id: "eq.1" }, { resumo_ultimo_envio: new Date().toISOString() });
  return `${turno === "manha" ? "resumo da manha" : "resumo do dia"} enviado para ${ok} de ${dest.tels.length}`;
}

export const horaAgora = () => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: cfg.tz }).format(new Date());

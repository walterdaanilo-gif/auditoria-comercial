import { cfg, today } from "./config.js";
import { enviarWhatsApp } from "./envio.js";
import { ASSINATURA, sorteio } from "./alertas.js";
import { gestores, notificar } from "./notificar.js";

const SITE = (process.env.SITE_URL || "https://auditoria-comercial-omega.vercel.app").replace(/\/$/, "");
const brl = n => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const nota = n => (n == null ? "—" : n.toFixed(1).replace(".", ","));
const dur = s => (s == null ? "—" : s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}min` : `${Math.floor(s / 3600)}h${String(Math.round((s % 3600) / 60)).padStart(2, "0")}`);
const ddmm = d => d.split("-").reverse().slice(0, 2).join("/");
const somar = (l, k) => l.reduce((s, x) => s + Number(x[k] || 0), 0);
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const hh = h => `${Number(String(h).slice(0, 2))}h`;

// Contadores que somam ao longo do dia: a tarde = dia - manha (guardada as 13h)
const CONTA = ["respostas", "marc", "wCupom", "wPagos", "wValor", "imersao", "imValor", "reunioesImpl", "ligAt", "lig", "oport"];

// Numeros de um dia: time inteiro e cada vendedor
export async function calcularDia(db, dia) {
  const [[s = {}], linhas, convs] = await Promise.all([
    db.select("audit_settings", { filters: { id: "eq.1" } }),
    db.rpc("resumo_sdr2", { p_from: dia, p_to: dia }),
    db.selectAll("conversas", { select: "id,data,canal", filters: { data: `eq.${dia}`, canal: "neq.importada" } }),
  ]);
  const ids = convs.map(c => c.id);
  const auds = [];
  for (let i = 0; i < ids.length; i += 150) auds.push(...await db.select("auditorias", { select: "vendedor_id,nota_geral,so_bot,venda,venda_tipo,venda_valor,venda_cupom,venda_convite_origem,oportunidade,oportunidade_tipo,critico,primeira_resposta_seg,tempo_medio_resposta_seg,respostas_sdr", filters: { conversa_id: `in.(${ids.slice(i, i + 150).join(",")})` } }));
  const vendIds = [...new Set([...linhas.map(l => l.vendedor_id), ...auds.map(a => a.vendedor_id)])];
  const perfis = vendIds.length ? await db.select("profiles", { select: "id,nome,funcao", filters: { id: `in.(${vendIds.join(",")})` } }) : [];

  const resumo = (l, ls) => {
    const notas = l.filter(a => !a.so_bot);
    const w = l.filter(a => a.venda && a.venda_tipo !== "imersao"), im = l.filter(a => a.venda && a.venda_tipo === "imersao");
    const pr = l.filter(a => a.primeira_resposta_seg != null), md = l.filter(a => a.tempo_medio_resposta_seg != null && a.respostas_sdr);
    const nResp = somar(md, "respostas_sdr");
    return {
      n: notas.length, nota: notas.length ? somar(notas, "nota_geral") / notas.length : null,
      wCupom: w.filter(a => a.venda_cupom).length, wCarbone: w.filter(a => a.venda_cupom && a.venda_convite_origem === "carbone").length, wPagos: w.filter(a => !a.venda_cupom).length, wValor: somar(w.filter(a => !a.venda_cupom), "venda_valor"),
      imersao: im.length, imValor: somar(im, "venda_valor"),
      oport: l.filter(a => a.oportunidade).length, reunioesImpl: l.filter(a => a.oportunidade_tipo === "reuniao_implementacao").length, criticos: l.filter(a => a.critico).length,
      primeira: pr.length ? somar(pr, "primeira_resposta_seg") / pr.length : null,
      medio: nResp ? md.reduce((x, a) => x + a.tempo_medio_resposta_seg * a.respostas_sdr, 0) / nResp : null,
      respostas: somar(ls, "respostas"), marc: somar(ls, "marcacoes"), ligAt: somar(ls, "ligacoes_atendidas"), lig: somar(ls, "ligacoes"),
    };
  };
  const time = resumo(auds, linhas);
  const pessoas = perfis.map(p => ({ id: p.id, nome: p.nome, closer: p.funcao === "closer", ...resumo(auds.filter(a => a.vendedor_id === p.id), linhas.filter(l => l.vendedor_id === p.id)) }))
    .sort((a, b) => (b.nota ?? -1) - (a.nota ?? -1) || (b.wCupom + b.wPagos + b.imersao) - (a.wCupom + a.wPagos + a.imersao));
  return { s, time, pessoas };
}

// So os contadores (guardados as 13h para separar a tarde as 19h)
const contadores = d => ({ time: Object.fromEntries(CONTA.map(k => [k, d.time[k]])), pessoas: Object.fromEntries(d.pessoas.map(p => [p.id, Object.fromEntries(CONTA.map(k => [k, p[k]]))])) });
const menos = (a, b = {}) => Object.fromEntries(CONTA.map(k => [k, Math.max(0, Number(a[k] || 0) - Number(b[k] || 0))]));

// Bloco de numeros completo (manha ou dia)
const blocoNumeros = t => [
  `✅ Auditorias: ${t.n} · ⭐ Nota média: ${nota(t.nota)}`,
  `⏱️ 1ª resposta: ${dur(t.primeira)} · tempo médio de resposta: ${dur(t.medio)}`,
  `💬 Conversas trocadas: ${t.respostas} · 📅 Marcações: ${t.marc}`,
  `📞 Ligações atendidas: ${t.ligAt} de ${t.lig}`,
  `🎟️ Workshop por convite (cupom 100% ou Carbone): ${t.wCupom}${t.wCarbone ? ` · ${t.wCarbone} Carbone` : ""}`,
  `💰 Workshop vendido: ${t.wPagos}${t.wValor ? ` · ${brl(t.wValor)}` : ""}`,
  `💎 Imersão: ${plural(t.imersao, "fechada", "fechadas")}${t.imValor ? ` · ${brl(t.imValor)}` : ""}`,
  `🎯 Oportunidades: ${t.oport}`,
  ...(t.criticos ? [`⚠️ Alertas críticos: ${t.criticos} (veja no sistema)`] : []),
];

// Linha de cada vendedor, com a meta do dia
function linhaPessoa(p, s) {
  const partes = [`⭐ ${nota(p.nota)}`];
  if (p.closer) {
    partes.push(`${p.reunioesImpl}${s.meta_closer_reunioes != null ? `/${s.meta_closer_reunioes}` : ""} reuniões de implementação`);
    partes.push(`${p.imersao}${s.meta_closer_vendas != null ? `/${s.meta_closer_vendas}` : ""} imersões${p.imValor ? ` (${brl(p.imValor)})` : ""}`);
  } else {
    partes.push(`${p.respostas}/${s.meta_sdr_conversas ?? 25} conversas trocadas`);
    partes.push(`${p.marc}/${s.meta_sdr_marcacoes ?? 6} marcações`);
  }
  if (p.wCupom) partes.push(`🎟️ ${plural(p.wCupom, "convite", "convites")}`);
  if (p.wPagos) partes.push(`💰 ${plural(p.wPagos, "vendido", "vendidos")} (${brl(p.wValor)})`);
  partes.push(`📞 ${plural(p.ligAt, "atendida", "atendidas")}`);
  return `${p.nome} (${p.closer ? "Closer" : "SDR"}): ${partes.join(" · ")}`;
}
const ranking = (pessoas, s) => (pessoas.length ? pessoas.map((p, i) => `${i + 1}. ${linhaPessoa(p, s)}`) : ["Ainda sem atividade registrada."]);
const destaque = (pessoas, quando) => { const top = pessoas.find(p => p.nota != null); return top ? [``, `👑 Destaque ${quando}: *${top.nome}*, com nota ${nota(top.nota)}. Manda aquele parabéns! 👏`] : []; };

// Resumo do turno da manha (13h)
export function textoManha(d, dia) {
  const { s, time, pessoas } = d;
  return [
    ASSINATURA, ``,
    sorteio(dia + "m", [
      `Boa tarde, gestão! ☀️ Fechou o turno da manhã de hoje (${ddmm(dia)}). Olha como o time foi:`,
      `Boa tarde, pessoal! 👋 Metade do dia já foi, então lá vai o resumo da manhã (${ddmm(dia)}):`,
      `Boa tarde, gestão! 🌤️ Resumo do turno da manhã de ${ddmm(dia)} chegando:`,
    ]), ``,
    ...blocoNumeros(time), ``,
    `🏆 *Como cada um foi na manhã*`,
    ...ranking(pessoas, s),
    ...destaque(pessoas, "da manhã"), ``,
    sorteio(dia + "mf", ["Bora pra tarde que ainda dá pra bater a meta! 🚀", "Segundo tempo começando: foco total à tarde! ⚽🔥", "Almoço tomado, agora é acelerar a tarde! 💪"]),
    `Quer ver tudo com calma? Tá no painel 👉 ${SITE}`,
  ].join("\n");
}

// Resumo das 19h: a tarde (dia menos a manha guardada) e o dia completo
export function textoTarde(d, dia, manha) {
  const { s, time, pessoas } = d;
  const tarde = manha ? menos(time, manha.time) : null;
  const dinheiro = time.wPagos + time.imersao > 0;
  const ativo = (p, t) => t.respostas + t.marc + t.wCupom + t.wPagos + t.imersao + t.reunioesImpl + t.ligAt > 0;
  const linhaTarde = p => {
    const t = menos(p, manha?.pessoas?.[p.id]);
    if (!ativo(p, t)) return null;
    const partes = [`${t.respostas} conversas`, `${plural(t.marc, "marcação", "marcações")}`];
    if (t.wCupom) partes.push(`🎟️ ${plural(t.wCupom, "convite", "convites")}`);
    if (t.wPagos) partes.push(`💰 ${plural(t.wPagos, "vendido", "vendidos")}`);
    if (t.imersao) partes.push(`💎 ${plural(t.imersao, "imersão", "imersões")}`);
    if (t.ligAt) partes.push(`📞 ${plural(t.ligAt, "atendida", "atendidas")}`);
    return `• ${p.nome}: ${partes.join(" · ")}`;
  };
  return [
    ASSINATURA, ``,
    sorteio(dia, [
      `Boa noite, gestão! 🌙 Fechando o dia ${ddmm(dia)} com o resumo da tarde e do dia completo:`,
      `Boa noite, pessoal! 👋 Expediente encerrado, então lá vai como foi a tarde e o dia ${ddmm(dia)}:`,
      `Boa noite, gestão! 📊 Dia ${ddmm(dia)} fechado. Pega o café e vem ver a tarde e o dia ☕`,
    ]), ``,
    ...(tarde ? [
      `🌇 *Tarde (${hh(s.resumo_manha_hora || "13:00")} às ${hh(s.rodada_final_hora || "19:00")})*`,
      `💬 Conversas trocadas: ${tarde.respostas} · 📅 Marcações: ${tarde.marc}`,
      `🎟️ Convites: ${tarde.wCupom} · 💰 Workshop vendido: ${tarde.wPagos}${tarde.wValor ? ` (${brl(tarde.wValor)})` : ""} · 💎 Imersão: ${tarde.imersao}${tarde.imValor ? ` (${brl(tarde.imValor)})` : ""}`,
      `📞 Ligações atendidas: ${tarde.ligAt} de ${tarde.lig}`,
      ...pessoas.map(linhaTarde).filter(Boolean),
      ``,
    ] : []),
    `📊 *Dia completo*`,
    ...blocoNumeros(time), ``,
    `🏆 *Como cada um foi no dia*`,
    ...ranking(pessoas, s),
    ...destaque(pessoas, "do dia"), ``,
    dinheiro
      ? sorteio(dia, ["Hoje o caixa cantou! 💸 Parabéns, time. Bom descanso e amanhã tem mais 🚀", "Dia com dinheiro entrando, assim que eu gosto! 💸 Descansem que amanhã a gente repete 🚀", "Que dia, hein! 💸 Orgulho desse time. Até amanhã 🚀"])
      : sorteio(dia, ["Hoje foi dia de plantar, amanhã a gente colhe 🌱 Bom descanso, time!", "Amanhã é dia de virar o jogo 💪 Bom descanso, pessoal!", "Valeu pelo dia, time! Amanhã tem mais e vai ser melhor 🚀"]),
    `Quer ver tudo com calma? Tá no painel 👉 ${SITE}`,
  ].join("\n");
}

// Para quem e por onde mandar (Configuracoes > Alertas ao gestor); null = nao manda hoje (com o motivo)
export async function destinoResumo(db, s) {
  if (!s?.resumo_ativo) return { motivo: "resumo desligado" };
  if (!(s.resumo_dias || []).includes(new Date(today() + "T12:00:00Z").getUTCDay())) return { motivo: "hoje nao e dia de resumo" };
  if (!s.instancia_envio_id) return { motivo: "sem WhatsApp de envio" };
  const tels = (await db.select("telefones_alerta", { select: "telefone" })).map(t => t.telefone);
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

// turno "manha" (13h): resumo da manha e guarda os numeros. turno "dia" (19h): tarde + dia completo.
export async function enviarRelatorio(db, { turno = "dia", envio = enviarWhatsApp } = {}) {
  const hoje = today();
  const d = await calcularDia(db, hoje);
  if (turno === "manha") await db.insert("resumos_turno", [{ data: hoje, turno: "manha", dados: contadores(d) }], { onConflict: "data,turno", returning: false });
  const dest = await destinoResumo(db, d.s);
  if (!dest.tels) return dest.motivo;
  const manha = turno === "dia" ? (await db.select("resumos_turno", { select: "dados", filters: { data: `eq.${hoje}`, turno: "eq.manha" } }))[0]?.dados : null;
  const texto = turno === "manha" ? textoManha(d, hoje) : textoTarde(d, hoje, manha);
  await notificar(db, await gestores(db), { categoria: "resumo", titulo: turno === "manha" ? `☀️ Resumo do turno da manhã · ${hoje.split("-").reverse().slice(0, 2).join("/")}` : `🌙 Resumo da tarde e do dia · ${hoje.split("-").reverse().slice(0, 2).join("/")}`, texto: texto.replace(/^.*\n\n/, ""), link: "/" });
  const ok = await mandar(db, dest, texto, envio, "relatorio");
  if (ok) await db.update("audit_settings", { id: "eq.1" }, { resumo_ultimo_envio: new Date().toISOString() });
  return `${turno === "manha" ? "resumo da manha" : "resumo da tarde e do dia"} enviado para ${ok} de ${dest.tels.length}`;
}

export const horaAgora = () => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: cfg.tz }).format(new Date());

import { cfg, today, addDays, dayOf } from "./config.js";
import { enviarWhatsApp } from "./envio.js";
import { ASSINATURA, sorteio } from "./alertas.js";

const SITE = (process.env.SITE_URL || "https://auditoria-comercial-omega.vercel.app").replace(/\/$/, "");
const brl = n => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const nota = n => (n == null ? "—" : n.toFixed(1).replace(".", ","));
const dur = s => (s == null ? "—" : s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}min` : `${Math.floor(s / 3600)}h${String(Math.round((s % 3600) / 60)).padStart(2, "0")}`);
const ddmm = d => d.split("-").reverse().slice(0, 2).join("/");
const diasUteis = (de, ate) => { let n = 0; for (let d = de; d <= ate; d = addDays(d, 1)) { const w = new Date(d + "T12:00:00Z").getUTCDay(); if (w > 0 && w < 6) n++; } return Math.max(1, n); };
const insc = n => `${n} inscriç${n === 1 ? "ão" : "ões"}`;
const somar = (l, k) => l.reduce((s, x) => s + Number(x[k] || 0), 0);

// Relatorio do periodo (normalmente o dia; acumula os dias em que nao houve envio)
export async function montarRelatorio(db, de, ate) {
  const [[s = {}], linhas, convs] = await Promise.all([
    db.select("audit_settings", { filters: { id: "eq.1" } }),
    db.rpc("resumo_sdr2", { p_from: de, p_to: ate }),
    db.selectAll("conversas", { select: "id,data", filters: { data: `gte.${de}`, canal: "neq.importada" } }),
  ]);
  const ids = convs.filter(c => !c.data || c.data <= ate).map(c => c.id);
  const auds = [];
  for (let i = 0; i < ids.length; i += 150) auds.push(...await db.select("auditorias", { select: "vendedor_id,nota_geral,so_bot,venda,venda_tipo,venda_valor,venda_cupom,oportunidade,oportunidade_tipo,critico,primeira_resposta_seg,tempo_medio_resposta_seg,respostas_sdr", filters: { conversa_id: `in.(${ids.slice(i, i + 150).join(",")})` } }));
  const vendIds = [...new Set([...linhas.map(l => l.vendedor_id), ...auds.map(a => a.vendedor_id)])];
  const perfis = vendIds.length ? await db.select("profiles", { select: "id,nome,funcao", filters: { id: `in.(${vendIds.join(",")})` } }) : [];
  const uteis = diasUteis(de, ate);

  const resumo = l => {
    const notas = l.filter(a => !a.so_bot);
    const w = l.filter(a => a.venda && a.venda_tipo !== "imersao"), im = l.filter(a => a.venda && a.venda_tipo === "imersao");
    const pr = l.filter(a => a.primeira_resposta_seg != null), md = l.filter(a => a.tempo_medio_resposta_seg != null && a.respostas_sdr);
    const nResp = somar(md, "respostas_sdr");
    return {
      n: notas.length, nota: notas.length ? somar(notas, "nota_geral") / notas.length : null,
      wCupom: w.filter(a => a.venda_cupom).length, wPagos: w.filter(a => !a.venda_cupom).length, wValor: somar(w.filter(a => !a.venda_cupom), "venda_valor"),
      imersao: im.length, imValor: somar(im, "venda_valor"),
      oport: l.filter(a => a.oportunidade).length, reunioesImpl: l.filter(a => a.oportunidade_tipo === "reuniao_implementacao").length, criticos: l.filter(a => a.critico).length,
      primeira: pr.length ? somar(pr, "primeira_resposta_seg") / pr.length : null,
      medio: nResp ? md.reduce((x, a) => x + a.tempo_medio_resposta_seg * a.respostas_sdr, 0) / nResp : null,
    };
  };
  const t = resumo(auds);
  const ligAt = somar(linhas, "ligacoes_atendidas"), lig = somar(linhas, "ligacoes");

  const pessoas = perfis.map(p => {
    const ls = linhas.filter(l => l.vendedor_id === p.id), r = resumo(auds.filter(a => a.vendedor_id === p.id));
    const marc = somar(ls, "marcacoes");
    const closer = p.funcao === "closer";
    const vendas = closer ? r.imersao : r.wCupom + r.wPagos;
    const partes = [`⭐ ${nota(r.nota)}`];
    if (closer) {
      partes.push(`${r.reunioesImpl}${s.meta_closer_reunioes != null ? `/${s.meta_closer_reunioes * uteis}` : ""} reuniões de implementação`);
      partes.push(`${r.imersao}${s.meta_closer_vendas != null ? `/${s.meta_closer_vendas * uteis}` : ""} imersões${r.imValor ? ` (${brl(r.imValor)})` : ""}`);
    } else {
      partes.push(`${somar(ls, "respostas")}/${(s.meta_sdr_conversas ?? 25) * uteis} conversas trocadas`);
      partes.push(`${marc}/${(s.meta_sdr_marcacoes ?? 6) * uteis} marcações`);
      if (vendas) partes.push(`${insc(vendas)} no workshop`);
    }
    partes.push(`📞 ${somar(ls, "ligacoes_atendidas")} atendidas`);
    return { nome: p.nome, funcao: closer ? "Closer" : "SDR", nota: r.nota, vendas, linha: partes.join(" · ") };
  }).sort((a, b) => (b.nota ?? -1) - (a.nota ?? -1) || b.vendas - a.vendas);

  const titulo = de === ate ? `do dia ${ddmm(ate)}` : `de ${ddmm(de)} a ${ddmm(ate)}`;
  const hora = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: cfg.tz }).format(new Date()));
  const saudacao = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  const dinheiro = t.wPagos + t.imersao > 0;
  const abre = sorteio(ate, [
    `${saudacao}, gestão! 😄 Passando pra fechar o dia com o resumo ${titulo}. Bora ver como o time foi:`,
    `${saudacao}, pessoal! 👋 Chegou a hora do resumo ${titulo}. Pega o café e vem comigo ☕`,
    `${saudacao}, gestão! ${de === ate ? "Dia encerrado" : "Dias encerrados"}, então lá vai o resumo ${titulo} da Weevo 📊`,
  ]);
  const top = pessoas.find(p => p.nota != null);
  const fecha = dinheiro
    ? sorteio(ate, ["Hoje o caixa cantou! 💸 Parabéns, time. Bom descanso e amanhã tem mais 🚀", "Dia com dinheiro entrando, assim que eu gosto! 💸 Descansem que amanhã a gente repete 🚀", "Que dia, hein! 💸 Orgulho desse time. Até amanhã 🚀"])
    : sorteio(ate, ["Hoje foi dia de plantar, amanhã a gente colhe 🌱 Bom descanso, time!", "Amanhã é dia de virar o jogo 💪 Bom descanso, pessoal!", "Valeu pelo dia, time! Amanhã tem mais e vai ser melhor 🚀"]);
  return [
    ASSINATURA,
    ``,
    abre,
    ``,
    `✅ Auditorias: ${t.n} · ⭐ Nota média: ${nota(t.nota)}`,
    `⏱️ 1ª resposta: ${dur(t.primeira)} · tempo médio de resposta: ${dur(t.medio)}`,
    `📞 Ligações atendidas: ${ligAt} de ${lig}`,
    `💰 Workshop: ${insc(t.wCupom + t.wPagos)} (${t.wCupom} com cupom R$ 0 · ${t.wPagos} paga${t.wPagos === 1 ? "" : "s"} ${brl(t.wValor)})`,
    `💎 Imersão: ${t.imersao} fechada${t.imersao === 1 ? "" : "s"}${t.imValor ? ` · ${brl(t.imValor)}` : ""}`,
    `🎯 Oportunidades: ${t.oport}`,
    ...(t.criticos ? [`⚠️ Alertas críticos: ${t.criticos} (veja no sistema)`] : []),
    ``,
    `🏆 *Como cada um foi*`,
    ...(pessoas.length ? pessoas.map((p, i) => `${i + 1}. ${p.nome} (${p.funcao}): ${p.linha}`) : ["Hoje o time não teve atividade registrada."]),
    ...(top ? [``, `👑 Destaque ${de === ate ? "do dia" : "do período"}: *${top.nome}*, com nota ${nota(top.nota)}. Manda aquele parabéns! 👏`] : []),
    ``,
    fecha,
    `Quer ver tudo com calma? Tá no painel 👉 ${SITE}`,
  ].join("\n");
}

// Envia o relatorio para os telefones de Alertas ao gestor, pelo WhatsApp escolhido em Configuracoes.
// Dia fora dos dias marcados nao envia; o proximo envio cobre os dias acumulados (ate 7).
export async function enviarRelatorio(db, { envio = enviarWhatsApp } = {}) {
  const [s] = await db.select("audit_settings", { filters: { id: "eq.1" } });
  if (!s?.resumo_ativo) return "resumo desligado";
  const hoje = today();
  if (!(s.resumo_dias || []).includes(new Date(hoje + "T12:00:00Z").getUTCDay())) return "hoje nao e dia de resumo";
  if (!s.instancia_envio_id) return "sem WhatsApp de envio";
  const tels = await db.select("telefones_alerta", { select: "telefone" });
  if (!tels.length) return "sem telefones de alerta";
  const ultimo = s.resumo_ultimo_envio ? dayOf(s.resumo_ultimo_envio) : null;
  let de = ultimo && ultimo < hoje ? addDays(ultimo, 1) : hoje;
  if (de < addDays(hoje, -6)) de = addDays(hoje, -6);
  const texto = await montarRelatorio(db, de, hoje);
  let ok = 0;
  for (const t of tels) {
    try { await envio(db, s.instancia_envio_id, t.telefone, texto); ok++; }
    catch (e) { console.error(`[relatorio] envio para ${t.telefone}:`, e.message); }
  }
  if (ok) await db.update("audit_settings", { id: "eq.1" }, { resumo_ultimo_envio: new Date().toISOString() });
  return `enviado para ${ok} de ${tels.length}`;
}

export const horaAgora = () => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: cfg.tz }).format(new Date());

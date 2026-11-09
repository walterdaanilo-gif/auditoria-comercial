// Aviso de venda no WhatsApp do Bruno: quando o faturamento ganha uma venda de Imersao ou Plataforma, o Bruno recebe
// o que foi vendido, para quem e quem indicou. O site (que faz a conta do faturamento) decide QUAL venda e nova e
// chama esta rota; aqui so se monta o texto e se envia, pelo WhatsApp de envio escolhido em Configuracoes.
import { cfg } from "./config.js";
import { enviarWhatsApp } from "./envio.js";

const PRODUTO = { imersao: "💎 *Venda de Imersão*", plataforma: "🖥️ *Venda de Plataforma*" };
export const produtoDeVenda = p => Object.hasOwn(PRODUTO, p);
const limpo = (v, max = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const brl = n => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function textoVenda(v) {
  const cliente = [limpo(v.cliente) || "nome não informado", limpo(v.empresa)].filter(Boolean).join(" · ");
  return [
    `${PRODUTO[v.produto]}${Number(v.valor) > 0 ? ` · ${brl(v.valor)}` : ""}`,
    `Para quem: ${cliente}`,
    `Quem indicou: ${limpo(v.indicadoPor) || "ninguém / não informado"}`,
    ...(limpo(v.vendedor) ? [`Vendedor: ${limpo(v.vendedor)}`] : []),
  ].join("\n");
}

// Devolve { ok, enviado }. Falha de envio devolve ok:false para o site tentar de novo na proxima rodada.
export async function avisarVenda(db, venda, { envio = enviarWhatsApp } = {}) {
  if (!produtoDeVenda(venda?.produto)) return { ok: false, erro: "produto inválido" };
  const [s] = await db.select("audit_settings", { select: "instancia_envio_id", filters: { id: "eq.1" } });
  if (!s?.instancia_envio_id) return { ok: false, erro: "Sem WhatsApp de envio escolhido em Configurações." };
  try { await envio(db, s.instancia_envio_id, cfg.avisoVendaTelefone, textoVenda(venda)); }
  catch (e) { console.error("[venda] envio falhou:", String(e?.message || e).replace(/\d{6,}/g, "#").slice(0, 120)); return { ok: false, erro: "Não foi possível enviar o WhatsApp agora." }; }
  console.log(`[venda] aviso enviado: ${venda.produto}`); // sem nome nem telefone no log
  return { ok: true, enviado: true };
}

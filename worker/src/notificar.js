// Notificacoes dentro do sistema (sino no canto superior direito). Cada aviso vai para quem interessa:
// gestao (admin e gestor ativos) e/ou o vendedor da conversa. categoria organiza as abas do sino.
const TIPO = { venda: "venda", reuniao: "oportunidade", critico: "critico" }; // o resto e "aviso"

export async function gestores(db) {
  return (await db.select("profiles", { select: "id", filters: { papel: "in.(admin,gestor)", ativo: "eq.true" } })).map(g => g.id);
}

// para: lista de ids (duplicados e vazios saem); n: { categoria, titulo, texto, link }
export async function notificar(db, para, { categoria, titulo, texto = null, link = null }) {
  const ids = [...new Set(para.filter(Boolean))];
  if (!ids.length) return 0;
  try {
    await db.insert("notificacoes", ids.map(p => ({ para: p, tipo: TIPO[categoria] || "aviso", categoria, titulo, texto, link })), { returning: false });
  } catch (e) { console.error("[notificacao]", e.message); return 0; }
  return ids.length;
}

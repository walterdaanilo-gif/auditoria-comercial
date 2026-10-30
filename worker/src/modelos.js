// Textos das mensagens editaveis em Configuracoes > Mensagens (tabela modelos_mensagem, uma linha por empresa e mensagem).
// Sem linha ou texto vazio = texto padrao do sistema (montado no codigo de cada aviso). ativo = false = nao envia.

// Carrega os modelos da empresa: Map chave -> { texto, ativo }
export async function carregarModelos(db, org) {
  try {
    const rows = await db.select("modelos_mensagem", { select: "chave,texto,ativo", filters: org ? { org_id: `eq.${org}` } : {} });
    return new Map(rows.map(r => [r.chave, { texto: r.texto?.trim() ? r.texto : null, ativo: r.ativo !== false }]));
  } catch (e) {
    console.error("[modelos] carregar:", e.message);
    return new Map();
  }
}

export const ativo = (modelos, chave) => modelos?.get(chave)?.ativo !== false;

// Preenche {variavel}. Linha em que todas as variaveis vieram vazias some (ex.: "Valor: {valor}" sem valor); mais de uma linha em branco seguida vira uma.
export function preencher(texto, vars) {
  return String(texto)
    .split("\n")
    .map(linha => {
      let usou = false, vazia = true;
      const out = linha.replace(/\{(\w+)\}/g, (m, k) => {
        if (!(k in vars)) return m;
        usou = true;
        const v = vars[k] == null ? "" : String(vars[k]);
        if (v.trim()) vazia = false;
        return v;
      });
      return usou && vazia ? null : out;
    })
    .filter(l => l !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Texto final: o modelo editado (se houver) com as variaveis, senao o padrao do codigo
export function textoDe(modelos, chave, vars, padrao) {
  const m = modelos?.get(chave);
  return m?.texto ? preencher(m.texto, vars) : padrao();
}

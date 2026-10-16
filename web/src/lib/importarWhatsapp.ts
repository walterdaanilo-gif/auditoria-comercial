// Le o .txt de "Exportar conversa" do WhatsApp (Android e iPhone, em portugues ou ingles).
// Android: 16/10/2026 14:32 - Ruan: Oi
// iPhone:  [16/10/2026, 14:32:05] Ruan: Oi
// Linhas sem data continuam a mensagem anterior. Avisos do sistema (sem "Nome:") sao ignorados.

export type MsgImportada = { autor: string; quando: string; texto: string; midia: boolean };
export type Leitura = { mensagens: MsgImportada[]; autores: string[] };

const LINHA = /^\u200e?\[?(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:([ap])\.?\s?m\.?)?\]?\s*(?:-\s*)?(.*)$/i;
const MIDIA = /<(m[ií]dia oculta|media omitted|anexado:[^>]*|attached:[^>]*)>|^\u200e?(áudio|audio|imagem|image|vídeo|video|figurinha|sticker|documento|document)\s+(ocultad[oa]|omitted)$/i;

// Horario de Sao Paulo (UTC-3, sem horario de verao)
const iso = (d: number, m: number, a: number, h: number, mi: number, s: number) =>
  new Date(Date.UTC(a < 100 ? 2000 + a : a, m - 1, d, h + 3, mi, s)).toISOString();

export function lerExportacao(texto: string): Leitura {
  const mensagens: MsgImportada[] = [];
  for (const bruta of texto.replace(/\r/g, "").split("\n")) {
    const linha = bruta.replace(/^\ufeff/, "");
    const m = LINHA.exec(linha);
    if (m) {
      const resto = m[8];
      let hora = +m[4];
      if (m[7]) { const pm = m[7].toLowerCase() === "p"; if (pm && hora < 12) hora += 12; if (!pm && hora === 12) hora = 0; }
      const sep = resto.indexOf(": ");
      if (sep <= 0) continue; // aviso do sistema ("As mensagens sao protegidas...", "Fulano entrou")
      const autor = resto.slice(0, sep).replace(/\u200e/g, "").trim();
      const corpo = resto.slice(sep + 2).replace(/\u200e/g, "").trim();
      mensagens.push({ autor, quando: iso(+m[1], +m[2], +m[3], hora, +m[5], +(m[6] || 0)), texto: corpo, midia: MIDIA.test(corpo) });
    } else if (mensagens.length && linha.trim()) {
      mensagens[mensagens.length - 1].texto += "\n" + linha.replace(/\u200e/g, "");
    }
  }
  const autores = Array.from(new Set(mensagens.map((x) => x.autor)));
  return { mensagens, autores };
}

// Contato a partir do nome que aparece na exportacao: telefone vira so digitos; nome fica como esta
export const contatoDoAutor = (autor: string) => {
  const digitos = autor.replace(/\D/g, "");
  return /^[+\d\s()-]+$/.test(autor) && digitos.length >= 10 ? digitos : autor.slice(0, 80);
};

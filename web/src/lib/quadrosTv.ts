// Quadros da tela fixa da TV (Apresentacao). Catalogo, padrao e validacao, usados nas Configuracoes e na tela.
// So entram quadros com dado real no Cabueta. Remover = tirar da lista; adicionar = escolher do catalogo.

export type QuadroId = "faturamento" | "pessoas" | "semretorno" | "primeira" | "nota" | "tempo_medio" | "ligacoes" | "conversas_time" | "marcacoes_time" | "convites";
// itens = o que aparece dentro do quadro (ausente = tudo); titulo = nome mostrado na TV (ausente = nome padrao)
export type QuadroCfg = { id: QuadroId; titulo?: string; itens?: string[] };

export type DefQuadro = { nome: string; grande: boolean; descricao: string; itens?: { id: string; rotulo: string }[]; meta?: string };
export const CATALOGO: Record<QuadroId, DefQuadro> = {
  faturamento: { nome: "Faturamento", grande: true, descricao: "Soma da aba Resultados no período (vendas da IA, com seus ajustes, e vendas manuais). No Mês atual: contra a meta do mês, com ritmo, projeção e gráfico.", meta: "meta_fat_mes",
    itens: [{ id: "precisa", rotulo: "Precisa por dia útil" }, { id: "projecao", rotulo: "Projeção do mês" }, { id: "grafico", rotulo: "Gráfico acumulado" }] },
  pessoas: { nome: "Por pessoa", grande: true, descricao: "Um cartão por vendedor: conversas e marcações contra a meta (SDR) e vendas pagas (da aba Resultados).",
    itens: [{ id: "conversas", rotulo: "Conversas trocadas (SDR)" }, { id: "marcacoes", rotulo: "Marcações (SDR)" }, { id: "funil", rotulo: "Reuniões realizadas (Closer, funil do CRM)" }, { id: "followup", rotulo: "Follow-ups atrasados (Closer)" }, { id: "vendas", rotulo: "Vendas pagas" }] },
  semretorno: { nome: "Leads sem retorno", grande: false, descricao: "Conversas em que o lead escreveu e ficou mais de 15 min sem resposta." },
  primeira: { nome: "Tempo de 1ª resposta", grande: false, descricao: "Média do período, comparada ao SLA da empresa.", meta: "sla_primeira_resposta_min" },
  nota: { nome: "Nota média da auditoria", grande: false, descricao: "Média das notas da IA nas conversas e ligações auditadas do período." },
  tempo_medio: { nome: "Tempo médio de resposta", grande: false, descricao: "Toda vez que o lead escreve, quanto o vendedor leva para responder (média do período)." },
  ligacoes: { nome: "Ligações atendidas", grande: false, descricao: "Ligações atendidas no período, do total de ligações feitas." },
  conversas_time: { nome: "Conversas trocadas do time", grande: false, descricao: "Soma dos SDRs contra a meta do período.", meta: "meta_sdr_conversas" },
  marcacoes_time: { nome: "Marcações do time", grande: false, descricao: "Workshop + reunião de imersão, soma dos SDRs contra a meta do período.", meta: "meta_sdr_marcacoes" },
  convites: { nome: "Convites do workshop", grande: false, descricao: "Inscrições por cupom 100% ou membro Carbone (R$ 0) no período." },
};
export const IDS_QUADROS = Object.keys(CATALOGO) as QuadroId[];
export const PADRAO_QUADROS: QuadroCfg[] = [{ id: "faturamento" }, { id: "pessoas" }, { id: "semretorno" }, { id: "primeira" }];
export const MAX_TITULO = 40;
// Limite de quadros pequenos ao mesmo tempo: com mais que isso os textos se sobrepoem na TV (testado em 1920x1080)
export const MAX_PEQUENOS = 4;

// Limpa o que veio do banco: ignora ids desconhecidos e repetidos, itens invalidos e titulos vazios. Vazio/invalido = padrao.
export function resolverQuadros(bruto: unknown): QuadroCfg[] {
  if (!Array.isArray(bruto)) return PADRAO_QUADROS;
  const vistos = new Set<string>(), saida: QuadroCfg[] = [];
  for (const q of bruto as Partial<QuadroCfg>[]) {
    if (!q || typeof q.id !== "string" || !IDS_QUADROS.includes(q.id as QuadroId) || vistos.has(q.id)) continue;
    vistos.add(q.id);
    const def = CATALOGO[q.id as QuadroId];
    const titulo = typeof q.titulo === "string" ? q.titulo.trim().slice(0, MAX_TITULO) : "";
    const itens = Array.isArray(q.itens) && def.itens ? q.itens.filter((i) => def.itens!.some((d) => d.id === i)) : undefined;
    saida.push({ id: q.id as QuadroId, ...(titulo ? { titulo } : {}), ...(itens ? { itens } : {}) });
  }
  return saida.length ? saida : PADRAO_QUADROS;
}

export const tituloDe = (q: QuadroCfg) => q.titulo?.trim() || CATALOGO[q.id].nome;
export const temItem = (q: QuadroCfg | undefined, item: string) => !q?.itens || q.itens.includes(item);

export function validarQuadros(q: QuadroCfg[] | null | undefined): string[] {
  if (q == null) return [];
  const erros: string[] = [];
  if (!Array.isArray(q) || !q.length) return ["Quadros da TV: deixe pelo menos um quadro."];
  if (q.length > IDS_QUADROS.length) erros.push("Quadros da TV: quadros demais.");
  const ids = q.map((x) => x?.id);
  if (ids.some((i) => !IDS_QUADROS.includes(i))) erros.push("Quadros da TV: há um quadro desconhecido.");
  if (q.filter((x) => CATALOGO[x?.id] && !CATALOGO[x.id].grande).length > MAX_PEQUENOS) erros.push(`Quadros da TV: no máximo ${MAX_PEQUENOS} quadros pequenos ao mesmo tempo (os outros ficam ilegíveis na TV).`);
  if (new Set(ids).size !== ids.length) erros.push("Quadros da TV: o mesmo quadro aparece duas vezes.");
  for (const x of q) {
    if (typeof x.titulo === "string" && x.titulo.length > MAX_TITULO) erros.push(`Quadros da TV: o título de "${CATALOGO[x.id]?.nome ?? x.id}" passa de ${MAX_TITULO} letras.`);
    const def = CATALOGO[x.id];
    if (x.itens && (!def?.itens || x.itens.some((i) => !def.itens!.some((d) => d.id === i)))) erros.push(`Quadros da TV: "${def?.nome ?? x.id}" tem um item inválido.`);
    if (x.itens && def?.itens && !x.itens.length) erros.push(`Quadros da TV: deixe pelo menos um item em "${def.nome}" ou remova o quadro.`);
  }
  return [...new Set(erros)];
}

// Transforma as abas da planilha de participantes nos leads do painel do Closer. Sem dependencias: so texto entra e sai.
export type Lead = {
  chave: string; nome: string; empresa: string; telefone: string; telefoneTexto: string; workshop: string; ordem: number;
  nota: number | null; motivoNota: string; dor: string; area: string; hoje: string; deseja: string;
  etapa: string; etapas: string; responsavel: string; responsavelCrm: string; indicadoPor: string; indicacoes: number;
  observacao: string; interesseImersao: string; reuniao: string; sessao: string; completos: string; falta: string;
  mensagens: [string, string, string]; enviadasPlanilha: number; trava: string; conversasCrm: string[]; alertaCrm: string; repetidos: string[];
};

type Linha = Record<string, string>;
const TRAVA = /^(N[ÃA]O ENVIAR|J[ÁA] ABORDADO|CONFERIR ANTES)/i;
const limpo = (s: unknown) => String(s ?? "").trim();
const digitos = (s: string) => s.replace(/\D/g, "");
const fimTel = (s: string) => digitos(s).slice(-9);
const nomeChave = (s: string) => limpo(s).toLowerCase().replace(/\s+/g, " ");
export const linhas = (tabela: string[][]) => tabela.slice(1).filter((l) => l.some((c) => limpo(c))).map((l) => Object.fromEntries((tabela[0] ?? []).map((c, i) => [c, limpo(l[i])])) as Linha);

// Identidade do lead. Sem telefone, nome e empresa juntos: so o nome confundiria pessoas diferentes (duas "Maria").
// O Apps Script (apps-script/closer-sync.gs) calcula a mesma chave: mudou aqui, mude la.
export function chaveDe(t: Linha) {
  const fim = fimTel(t["Telefone"] ?? "");
  return fim ? "tel:" + fim : `nome:${nomeChave(t["Nome"])}|${nomeChave(t["Empresa"])}`;
}

// Numero pronto para o link do WhatsApp (DDI 55 quando vier so com DDD)
export function telefoneWhats(t: string) {
  const d = digitos(t);
  if (d.length < 10) return "";
  return d.length <= 11 ? "55" + d : d;
}

// Aba "Atencao": le a secao dos nomes duplicados no CRM, indexada pelo fim do telefone
function lerAtencao(tabela: string[][]) {
  const mapa = new Map<string, { conversas: string[]; alerta: string }>();
  const ini = tabela.findIndex((l) => /^PONTO DE ATEN\S* 2\b/i.test(limpo(l[0])));
  if (ini < 0) return mapa;
  const cab = tabela.findIndex((l, i) => i > ini && limpo(l[0]) === "Nome");
  if (cab < 0) return mapa;
  const col = (n: string) => tabela[cab].findIndex((c) => limpo(c).startsWith(n));
  const cTel = col("Telefone"), cConv = col("Conversas"), cFazer = col("O que fazer");
  for (let i = cab + 1; i < tabela.length && limpo(tabela[i]?.[0]); i++) {
    const t = fimTel(limpo(tabela[i][cTel]));
    if (t) mapa.set(t, { conversas: limpo(tabela[i][cConv]).split("|").map(limpo).filter(Boolean), alerta: limpo(tabela[i][cFazer]) });
  }
  return mapa;
}

export function montarLeads(todos: string[][], participantes: string[][], atencao: string[][]): Lead[] {
  const partes = linhas(participantes);
  const porTel = new Map(partes.filter((p) => fimTel(p["Telefone"] || p["Telefone no CRM"] || "")).map((p) => [fimTel(p["Telefone"] || p["Telefone no CRM"]), p]));
  const porNome = new Map(partes.map((p) => [nomeChave(p["Nome"]), p]));
  const alertas = lerAtencao(atencao);

  const saida = new Map<string, Lead>();
  linhas(todos).forEach((t, i) => {
    const fim = fimTel(t["Telefone"]);
    const p = (fim && porTel.get(fim)) || porNome.get(nomeChave(t["Nome"])) || ({} as Linha);
    const bruta = t["Mensagem 1 · Situação e problema"] || "";
    const [primeira, ...resto] = bruta.split("\n");
    const trava = TRAVA.test(limpo(primeira)) ? limpo(primeira) : "";
    const nota = t["Nota NPS"] !== "" && !isNaN(Number(t["Nota NPS"])) ? Number(t["Nota NPS"]) : null;
    const al = fim ? alertas.get(fim) : undefined;
    const chave = chaveDe(t);
    const lead: Lead = {
      chave, nome: t["Nome"], empresa: t["Empresa"], telefone: telefoneWhats(t["Telefone"]), telefoneTexto: t["Telefone"], workshop: t["Data do workshop"], ordem: i,
      nota, motivoNota: p["Motivo da nota"] || "", dor: p["Dor original (texto completo)"] || t["Dor relatada (resumo)"] || "", area: p["Área da dor"] || "", hoje: p["Como resolve hoje"] || "", deseja: p["Resultado desejado"] || "",
      etapa: t["Etapa no CRM"], etapas: t["Todas as etapas no CRM"], responsavel: t["Responsável (Raí ou Walter)"], responsavelCrm: t["Responsável no CRM"], indicadoPor: t["Foi indicado?"] === "Sim" ? t["Quem indicou"] || "Sim" : "", indicacoes: Number(p["Indicações distintas"]) || 0,
      observacao: t["Observação (planilha 2)"], interesseImersao: p["Interesse na imersão"] || "", reuniao: p["Reunião (estado atual)"] || "", sessao: p["Preferência de sessão atual"] || "", completos: t["Dados completos (de 6)"], falta: t["O que falta"],
      mensagens: [trava ? resto.join("\n").trim() : bruta, t["Mensagem 2 · Implicação"] || "", t["Mensagem 3 · Proposta"] || ""],
      enviadasPlanilha: t["✓ Msg 3"] === "TRUE" ? 3 : t["✓ Msg 2"] === "TRUE" ? 2 : t["✓ Msg 1"] === "TRUE" ? 1 : 0,
      trava, conversasCrm: al?.conversas ?? [], alertaCrm: al?.alerta ?? "", repetidos: [],
    };
    // A mesma pessoa aparece mais de uma vez: fica a linha mais completa, para o closer nao abordar duas vezes
    const ja = saida.get(chave);
    if (!ja) { saida.set(chave, lead); return; }
    const melhor = parseInt(lead.completos) > parseInt(ja.completos) ? lead : ja, outro = melhor === lead ? ja : lead;
    melhor.repetidos = [...new Set([...ja.repetidos, ...lead.repetidos, outro.nome])].filter((n) => n !== melhor.nome);
    melhor.trava ||= outro.trava; // um aviso de "nao enviar" em qualquer das linhas vale para a pessoa
    saida.set(chave, melhor);
  });
  return [...saida.values()];
}

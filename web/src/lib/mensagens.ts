// Catalogo das mensagens que o Cabueta envia, editaveis em Configuracoes > Mensagens (tabela modelos_mensagem).
// O texto "padrao" aqui e o mesmo que o worker monta quando nao ha modelo editado; {variaveis} sao preenchidas no envio.
// Linha em que todas as variaveis vierem vazias some da mensagem.

export type Variavel = { k: string; desc: string; ex: string };
export type ModeloMensagem = {
  chave: string;
  grupo: "Para você (gestor)" | "Para o vendedor";
  titulo: string;
  para: string;
  quando: string;
  desligavel: boolean; // false = liga e desliga em Alertas ao gestor
  padrao: string;
  variaveis: Variavel[];
  sugestoes?: { nome: string; texto: string }[];
};

const LINK = { k: "link", desc: "Link da conversa no sistema", ex: "👉 https://auditoria.../conversas/123" };
const VENDEDOR = { k: "vendedor", desc: "Nome do vendedor", ex: "Nick Andrade" };
const FUNCAO = { k: "funcao", desc: "SDR ou Closer", ex: "SDR" };
const CLIENTE = { k: "cliente", desc: "Nome do cliente", ex: "Carla Dias" };
const FALA = { k: "fala_lead", desc: "O que o cliente escreveu (entre aspas)", ex: "\"Pode marcar pra terça às 10h\"" };
const TAMBEM = { k: "tambem", desc: "Outros acontecimentos da mesma conversa (vazio se não tiver)", ex: "" };
const FRASE = { k: "frase", desc: "Frase pronta do sistema (varia a cada conversa)", ex: "Nick marcou reunião de imersão com Carla Dias! Essa tem cara de venda 👀" };
const RESUMO: Variavel[] = [
  { k: "hora", desc: "Hora do resumo", ex: "13h" },
  { k: "data", desc: "Dia (dd/mm)", ex: "30/10" },
  { k: "vendas", desc: "Vendas do time", ex: "1 imersão R$ 4.800,00 · 2 convites" },
  { k: "marcacoes", desc: "Marcações / meta do time", ex: "5/12" },
  { k: "ligacoes", desc: "Ligações atendidas e tempo", ex: "9 atendidas · 42min" },
  { k: "atencao", desc: "Quem está abaixo da meta ou com follow-up atrasado (uma linha por pessoa)", ex: "⚠️ Ruan 2/6 marcações" },
  { k: "destaque", desc: "Destaque do turno", ex: "👑 Nick: 5 marcações" },
  { k: "painel", desc: "Link do painel", ex: "https://auditoria-comercial-omega.vercel.app" },
];
const RESUMO_PADRAO = "🚀 *Resumo {hora} · {data}*\n\n💰 Vendas: {vendas}\n📅 Marcações: {marcacoes}\n📞 Ligações: {ligacoes}\n\n{atencao}\n{destaque}\n\nDetalhes 👉 {painel}";

export const MODELOS: ModeloMensagem[] = [
  {
    chave: "reuniao_implementacao", grupo: "Para você (gestor)", titulo: "Reunião de implementação",
    para: "Seu WhatsApp (número de envio dos avisos)", quando: "Na hora que uma reunião de implementação é marcada ou remarcada", desligavel: true,
    padrao: "🤝 *{evento}* · {vendedor} ({funcao})\nCliente: {cliente} · {empresa_cliente}\nQuando: {quando} · {modalidade}\n{link}",
    variaveis: [{ k: "evento", desc: "Marcada ou remarcada", ex: "Reunião de implementação marcada" }, VENDEDOR, FUNCAO, CLIENTE, { k: "empresa_cliente", desc: "Empresa do cliente", ex: "Loja Bela" }, { k: "quando", desc: "Dia e hora", ex: "ter 03/11 às 10:00" }, { k: "modalidade", desc: "Online ou presencial (com local)", ex: "online" }, LINK],
  },
  {
    chave: "alerta_venda", grupo: "Para você (gestor)", titulo: "Venda fechada (imersão)",
    para: "Telefones de alerta", quando: "Na hora que uma imersão é fechada", desligavel: false,
    padrao: "💎 *Imersão fechada* · {vendedor}\nCliente: {cliente} · {valor}\n{tambem}\n{link}",
    variaveis: [VENDEDOR, FUNCAO, CLIENTE, { k: "valor", desc: "Valor da venda", ex: "R$ 4.800,00" }, FALA, TAMBEM, LINK],
  },
  {
    chave: "alerta_reuniao", grupo: "Para você (gestor)", titulo: "Reunião marcada",
    para: "Telefones de alerta", quando: "Na hora que uma reunião é marcada (se ligado em Alertas ao gestor)", desligavel: false,
    padrao: "📅 *ALERTA DE REUNIÃO*\n\n{frase}\n{fala_lead}\n{tambem}\n\n{link}",
    variaveis: [FRASE, VENDEDOR, FUNCAO, CLIENTE, { k: "tipo_reuniao", desc: "Imersão ou implementação", ex: "imersão" }, FALA, TAMBEM, LINK],
  },
  {
    chave: "alerta_oportunidade", grupo: "Para você (gestor)", titulo: "Oportunidade",
    para: "Telefones de alerta", quando: "Quando um cliente mostra interesse (se ligado em Alertas ao gestor)", desligavel: false,
    padrao: "{frase}\n{fala_lead}\n{tambem}\nUm empurrãozinho agora e vira marcação 😉\n\n{link}",
    variaveis: [{ ...FRASE, ex: "Carla Dias tá de olho na imersão e foi conversar com Nick (SDR). Esse tá esquentando! 🔥" }, VENDEDOR, FUNCAO, CLIENTE, { k: "interesse", desc: "Imersão ou workshop", ex: "imersão" }, FALA, TAMBEM, LINK],
  },
  { chave: "resumo_manha", grupo: "Para você (gestor)", titulo: "Resumo da manhã", para: "Telefones de alerta e sino do sistema", quando: "No horário do resumo da manhã", desligavel: true, padrao: RESUMO_PADRAO, variaveis: RESUMO },
  { chave: "resumo_dia", grupo: "Para você (gestor)", titulo: "Resumo do dia", para: "Telefones de alerta e sino do sistema", quando: "No horário da rodada final", desligavel: true, padrao: RESUMO_PADRAO, variaveis: RESUMO.map((v) => (v.k === "hora" ? { ...v, ex: "19h" } : v)) },
  {
    chave: "followup_gestao", grupo: "Para você (gestor)", titulo: "Follow-up atrasado (gestão)",
    para: "Telefones de alerta", quando: "Junto com o resumo da manhã, quando algum cliente fica sem follow-up", desligavel: true,
    padrao: "⚠️ *ERRO DE FOLLOW-UP*\n\n{quantidade} cliente(s) potencial(is) ficaram {dias} dias ou mais sem follow-up do vendedor:\n\n{detalhes}\n\nOs vendedores já foram avisados no WhatsApp e no sistema.",
    variaveis: [{ k: "dias", desc: "Dias sem follow-up", ex: "6" }, { k: "quantidade", desc: "Total de clientes", ex: "2" }, { k: "detalhes", desc: "Cada vendedor com a lista dos clientes", ex: "*Nick (SDR)*: 2 leads sem follow-up\n• Carla Dias · (84) 91111-2222 · 8 dias sem follow-up\n  https://.../conversas/1\n• Pedro Lima · 6 dias sem follow-up\n  https://.../conversas/2" }, { k: "por_vendedor", desc: "Só a contagem por vendedor", ex: "Nick: 2 leads · Ruan: 1 lead" }, { k: "link", desc: "Link da lista no sistema", ex: "👉 https://.../conversas?aba=todas&p=30" }],
    sugestoes: [{ nome: "Versão curta (só a contagem)", texto: "⚠️ *Follow-up atrasado* · {dias}+ dias sem mensagem\n{por_vendedor}\n{link}" }],
  },
  {
    chave: "conflito_agenda", grupo: "Para você (gestor)", titulo: "Conflito na agenda",
    para: "Seu WhatsApp (número de envio dos avisos)", quando: "Quando uma reunião nova bate com outro compromisso da agenda", desligavel: true,
    padrao: "⚠️ *Conflito na agenda* · {data} {hora}\nReunião de {tipo_reuniao} com {cliente} ({vendedor}) bate com: {conflitos}\n{link}",
    variaveis: [{ k: "data", desc: "Dia (dd/mm)", ex: "03/11" }, { k: "hora", desc: "Hora", ex: "10:00" }, { k: "tipo_reuniao", desc: "Imersão ou implementação", ex: "implementação" }, CLIENTE, VENDEDOR, { k: "conflitos", desc: "Compromissos que batem", ex: "10:00 às 11:00 · Reunião interna" }, { ...LINK, desc: "Link do evento na agenda" }],
  },
  {
    chave: "followup_vendedor", grupo: "Para o vendedor", titulo: "Follow-up atrasado (vendedor)",
    para: "WhatsApp do próprio vendedor", quando: "Junto com o resumo da manhã, quando ele tem cliente sem follow-up", desligavel: true,
    padrao: "⏰ *FOLLOW-UP ATRASADO*\n\nOi, {nome}! Você tem {quantidade} cliente(s) potencial(is) há {dias} dias ou mais sem uma mensagem sua:\n\n{lista}\n\nBora retomar hoje, antes que esfriem! 💪 A gestão também foi avisada.",
    variaveis: [{ k: "nome", desc: "Primeiro nome do vendedor", ex: "Nick" }, { k: "quantidade", desc: "Quantos clientes", ex: "2" }, { k: "dias", desc: "Dias sem follow-up", ex: "6" }, { k: "lista", desc: "Lista dos clientes com link", ex: "• Carla Dias · (84) 91111-2222 · 8 dias sem follow-up\n  https://.../conversas/1\n• Pedro Lima · 6 dias sem follow-up\n  https://.../conversas/2" }],
  },
];

// Mesma regra do worker (worker/src/modelos.js)
export function preencher(texto: string, vars: Record<string, string>) {
  return texto
    .split("\n")
    .map((linha) => {
      let usou = false, vazia = true;
      const out = linha.replace(/\{(\w+)\}/g, (m, k: string) => {
        if (!(k in vars)) return m;
        usou = true;
        if (vars[k].trim()) vazia = false;
        return vars[k];
      });
      return usou && vazia ? null : out;
    })
    .filter((l): l is string => l !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

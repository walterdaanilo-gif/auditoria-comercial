import type { SupabaseClient } from "@supabase/supabase-js";
import { telefone, um } from "@/lib/format";

// Resultados (vendas). Fonte unica das vendas em dinheiro: a aba Resultados e o faturamento da TV leem daqui.
// = vendas ganhas no CRM Q5 (tabela crm_vendas, com o produto do CRM); desde 24/11/2026, so o negocio cujo cartao entrou
//   numa etapa de venda do funil (ver ETAPAS_VENDA), no dia da entrada
// + vendas que a IA detectou nas conversas (tabela auditorias), com os ajustes feitos na aba Resultados,
// + vendas lancadas a mao (tabela resultados_vendas).
// Cruzamento sem duplicar (cada venda conta uma vez):
// A chave e o NUMERO do contato (DDD + 8 digitos, ignora 55 e o 9 extra):
// - venda da conversa com o mesmo numero de uma venda do CRM, ate 45 dias, qualquer produto: vale so a do CRM
// - o mesmo numero com dois negocios ganhos no CRM do mesmo produto (ou sem produto), ate 30 dias: vale o primeiro
// - a mesma venda detectada pela IA em mais de um dia: vale a primeira
// - venda manual com o mesmo cliente (nome) e produto do CRM, ate 30 dias: vale a do CRM
// - empresa com CRM ligado: venda alta (imersao, plataforma, in-company) que so aparece na conversa fica como
//   "nao lancada no CRM" e nao soma ate ser lancada la. Workshop continua vindo das conversas (o CRM nao lanca workshop).
export const FORMAS: [string, string][] = [["pix", "Pix"], ["cartao", "Cartão"], ["boleto", "Boleto"], ["transferencia", "Transferência"], ["dinheiro", "Dinheiro"], ["outro", "Outro"]];
export const PRODUTOS: [string, string][] = [["workshop", "Workshop"], ["imersao", "Imersão"], ["incompany", "In-company"], ["plataforma", "Plataforma"], ["outro", "Outro"]];
export const rotuloForma = (k: string | null) => FORMAS.find(([v]) => v === k)?.[1] ?? "—";
export const rotuloProduto = (k: string | null) => PRODUTOS.find(([v]) => v === k)?.[1] ?? "—";
export const brlCompleto = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export type Resultado = {
  chave: string;                    // "a:<auditoria>" (IA), "m:<id>" (manual) ou "c:<negocio>" (CRM)
  origem: "ia" | "manual" | "crm";
  id: string | null;                // linha em resultados_vendas (manual, ou ajuste da venda da IA)
  auditoriaId: string | null;
  data: string;                     // dia da venda (YYYY-MM-DD); na venda da IA e o dia da conversa
  vendedorId: string | null;
  cliente: string; empresa: string;
  produto: string | null; forma: string | null;
  valor: number | null;             // null = a IA nao achou o valor e ninguem preencheu ainda
  valorIA: number | null;           // so na venda da IA: o que ela leu
  ajustada: boolean;                // venda da IA com ajuste feito a mao
  excluida: boolean;                // tirada do faturamento
  duplicada: string | null;         // a mesma venda ja esta em outra linha (o motivo); nao soma
  naoLancada: boolean;              // venda alta so na conversa, empresa com CRM ligado: nao soma ate lancar no CRM
  naConversa: boolean;              // venda do CRM que tambem foi vista na conversa
  valorEstimado?: "crm" | "padrao"; // venda da IA sem valor na conversa: valor do negocio do CRM ou o padrao da empresa
  indicadoPor?: string;             // so na venda do CRM: "Indicado por" do negocio (vazio = nao foi indicado ou nao informado)
  etapa?: EtapaVenda;               // a partir de 24/11/2026: etapa do funil em que a venda entrou (ver ETAPAS_VENDA)
  cortesia?: boolean;               // desde 24/11: inscrito no workshop com valor zerado no CRM (R$ 0): conta como inscrito, nao soma
  naoAcompanhada?: boolean;         // desde 24/11: negocio ganho numa conversa que o Cabueta nao acompanha (numero nao conectado, ex.: o do Rai).
                                    // Soma no faturamento da empresa, mas so vai para um vendedor pelo campo Closer/SDR do negocio (nunca pelo vendedor do workshop)
};

// ---------- regra das etapas do funil (a partir de 24/11/2026, pedido da gestao) ----------
// Desde este dia o faturamento do CRM vem do cartao que ENTROU numa destas etapas (o dia da venda e o dia da entrada;
// valor e produtos vem do negocio daquela conversa). Antes disso tudo segue como estava.
//   Funil Workshop -> "Inscrito no workshop" (workshop; o workshop deixa de vir das conversas)
//   Funil Vendas (o "Vendas 2" do CRM) -> "Venda fechada" = a etapa Ganho dele (codigo custom_vendas_2_ganho) (produtos do negocio)
//   Pos-vendas Imersao aberta -> "Comprou a plataforma" = a etapa Ganho dele (codigo custom_pos_vendas_ganho) (Plataforma)
//   Pos-vendas Plataforma -> "Renovacao" = a etapa Ganho dele (codigo custom_plataforma_ganho; o funil que tem a etapa "Ativo")
//     (Plataforma, conta mesmo que o cliente ja tivesse a Plataforma). A etapa "Ativo" desse funil NAO conta.
// Inscrito no workshop com valor zerado no negocio e cortesia: vai para os convites (R$ 0), nao para o faturamento.
// A etapa vem do CRM como "custom_<funil>_<nome da etapa>"; aqui vale o fim do codigo (o nome na tela pode ser outro).
export const REGRA_ETAPAS_DESDE = "2026-11-24";
export const ETAPAS_VENDA = { inscrito_no_workshop: "workshop", venda_fechada: null, comprou_a_plataforma: "plataforma", renovacao: "plataforma" } as const;
export type EtapaVenda = keyof typeof ETAPAS_VENDA;
// fim do codigo da etapa no CRM -> etapa de venda
const CODIGOS_ETAPA: [string, EtapaVenda][] = [
  // "Inscrito no workshop" chega da API como "waiting" (coluna padrao do funil Workshop renomeada; confirmado 26/11/2026)
  ["inscrito_no_workshop", "inscrito_no_workshop"], ["waiting", "inscrito_no_workshop"],
  ["vendas_2_ganho", "venda_fechada"], ["vendas_2_venda_fechada", "venda_fechada"],
  ["pos_vendas_ganho", "comprou_a_plataforma"], ["comprou_a_plataforma", "comprou_a_plataforma"],
  ["plataforma_ganho", "renovacao"], ["renovacao", "renovacao"],
];
export const etapaDeVenda = (etapa: string | null | undefined): EtapaVenda | null =>
  CODIGOS_ETAPA.find(([c]) => String(etapa ?? "").endsWith(c))?.[1] ?? null;

type Ajuste = { id: string; data: string; vendedor_id: string | null; cliente: string | null; empresa: string | null; produto: string | null; forma_pagamento: string | null; valor: number | string | null; auditoria_id: string | null; excluida: boolean };
type Aud = { id: string; vendedor_id: string; venda_tipo: string | null; venda_valor: number | string | null; venda_cupom: boolean; conversas: { id: string; data: string; contato: string | null; contato_nome: string | null; telefone: string | null } | { id: string; data: string; contato: string | null; contato_nome: string | null; telefone: string | null }[] | null };

const num = (x: unknown): number | null => (x == null || x === "" ? null : Number.isFinite(Number(x)) ? Number(x) : null);

// Lista as vendas em dinheiro do periodo (inclui as tiradas do faturamento, marcadas em "excluida") e os convites (cupom R$ 0).
// Se a tabela de resultados ainda nao existe no banco, tabelaOk = false e valem so as vendas da IA.
export async function listarResultados(db: SupabaseClient, org: string, de: string, ate: string): Promise<{ linhas: Resultado[]; convites: string[]; tabelaOk: boolean; erro: string | null }> {
  // janela maior para achar a mesma venda antes ou depois do periodo (e nao contar de novo)
  const deLargo = somaDias(de, -JANELA_CRM);
  const comEtapas = ate >= REGRA_ETAPAS_DESDE;
  const [rAud, rAj, rCrm, rCfg, rPerf, rWs, rComp, rEt] = await Promise.all([
    db.from("auditorias").select("id,vendedor_id,venda_tipo,venda_valor,venda_cupom,conversas!inner(id,data,canal,contato,contato_nome,telefone)")
      .eq("org_id", org).eq("venda", true).neq("conversas.canal", "importada").gte("conversas.data", deLargo).lte("conversas.data", ate).limit(5000),
    db.from("resultados_vendas").select("*").eq("org_id", org).gte("data", de).lte("data", ate).limit(5000),
    // todos os negocios ganhos (de qualquer data): o negocio novo do CRM repete os produtos que o cliente ja comprou antes
    // e os negocios ABERTOS com produto, de qualquer funil (pos-venda, plataforma...): produto no negocio = vendido
    db.from("crm_vendas").select("deal_id,chat_id,status,contato_crm_id,telefone,cliente,valor_cents,aberto_em,ganho_em,sincronizado_em,vendedor_id,produto,tipo,produtos,campos,dia_venda_manual,rateio_manual").eq("org_id", org).in("status", ["won", "open"]).limit(5000),
    // quem leva as vendas de workshop (Configuracoes; na Weevo, o Ruan)
    db.from("audit_settings").select("vendedor_workshop,workshop_valor_padrao").eq("org_id", org).maybeSingle(),
    db.from("profiles").select("id,nome,org_id,ativo").limit(1000),
    // negocios de valor de workshop (ate R$ 1.000, qualquer situacao menos perdido): o valor que o cliente pagou, quando a conversa nao diz
    db.from("crm_vendas").select("telefone,valor_cents,aberto_em").eq("org_id", org).neq("status", "lost").gt("valor_cents", 0).lte("valor_cents", 100000).limit(5000),
    // imagens e documentos que o cliente mandou no WhatsApp (comprovante): so contato e hora
    db.rpc("crm_comprovantes", { p_org: org, p_de: `${somaDias(deLargo, -3)}T00:00:00-03:00`, p_ate: `${somaDias(ate, 2)}T23:59:59-03:00` }),
    // cartoes que entraram nas etapas de venda desde 24/11 (historico de etapas, tabela crm_etapas)
    comEtapas
      ? db.from("crm_etapas").select("conversa_id,vendedor_id,etapa,em").eq("org_id", org)
        .or(CODIGOS_ETAPA.map(([c]) => `etapa.like.%${c}`).join(","))
        .gte("em", `${REGRA_ETAPAS_DESDE}T00:00:00-03:00`).lte("em", `${ate}T23:59:59.999-03:00`).order("em").limit(5000)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const tabelaOk = !rAj.error;
  const ajustes = (tabelaOk ? rAj.data ?? [] : []) as Ajuste[];
  const porAud = new Map(ajustes.filter((a) => a.auditoria_id).map((a) => [a.auditoria_id as string, a]));
  const linhas: Resultado[] = [], convites: string[] = [];

  for (const a of (rAud.data ?? []) as unknown as Aud[]) {
    const c = um(a.conversas);
    if (!c) continue;
    if (a.venda_cupom && a.venda_tipo !== "imersao") { convites.push(a.vendedor_id); continue; } // convite (R$ 0): nao e venda em dinheiro
    const aj = porAud.get(a.id);
    const ia = num(a.venda_valor);
    const quem = c.contato_nome?.trim() || ((c.telefone || c.contato) ? telefone(c.telefone || c.contato || "") : "");
    linhas.push({
      chave: `a:${a.id}`, origem: "ia", id: aj?.id ?? null, auditoriaId: a.id, data: c.data, vendedorId: a.vendedor_id,
      cliente: aj?.cliente?.trim() || quem, empresa: aj?.empresa?.trim() || "",
      produto: a.venda_tipo === "imersao" ? "imersao" : "workshop", forma: aj?.forma_pagamento ?? null,
      valor: num(aj?.valor) ?? ia, valorIA: ia, ajustada: !!aj && !aj.excluida && (aj.cliente != null || aj.empresa != null || aj.forma_pagamento != null || aj.valor != null) , excluida: !!aj?.excluida,
      duplicada: null, naoLancada: false, naConversa: false, fone: chaveFone(c.telefone || c.contato),
    } as Resultado & { fone: string });
  }
  for (const m of ajustes.filter((x) => !x.auditoria_id)) {
    linhas.push({ chave: `m:${m.id}`, origem: "manual", id: m.id, auditoriaId: null, data: m.data, vendedorId: m.vendedor_id, cliente: m.cliente?.trim() ?? "", empresa: m.empresa?.trim() ?? "", produto: m.produto, forma: m.forma_pagamento, valor: num(m.valor), valorIA: null, ajustada: false, excluida: !!m.excluida, duplicada: null, naoLancada: false, naConversa: false });
  }
  // venda alta (Imersao, Plataforma, In-Company) e do closer do negocio no CRM (pelo primeiro nome, so se for um so)
  const perfis = ((rPerf.error ? [] : rPerf.data ?? []) as { id: string; nome: string; org_id: string | null; ativo: boolean }[]).filter((p) => p.org_id === org);
  const primeiro = (n: unknown) => String(n ?? "").trim().split(/\s+/)[0]?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() || "";
  const closerDe = (campos: Record<string, unknown> | null) => {
    const k = primeiro(campos?.closer);
    const achados = k ? perfis.filter((p) => primeiro(p.nome) === k) : [];
    return achados.length === 1 ? achados[0].id : null;
  };
  // cada negocio ganho vira uma linha por PRODUTO NOVO (o que o cliente ainda nao tinha comprado num negocio anterior)
  // comprovante do cliente na conversa entre 2 dias antes e 1 dia depois do fechamento no CRM: a venda e do dia do comprovante
  // (o CRM e atualizado com atraso e com vendas antigas; a conversa mostra quando o cliente pagou)
  const comps = new Map<string, number[]>();
  for (const c of (rComp.error ? [] : rComp.data ?? []) as { contato_crm_id: string | null; quando: string }[]) if (c.contato_crm_id) comps.set(c.contato_crm_id, [...(comps.get(c.contato_crm_id) ?? []), Date.parse(c.quando)]);
  const comprovanteDe = (contato: string | null, ganho: string) => {
    const g = Date.parse(ganho), l = (contato ? comps.get(contato) ?? [] : []).filter((t) => t >= g - 2 * 86400_000 && t <= g + 86400_000);
    if (!l.length) return undefined;
    const antes = l.filter((t) => t <= g);
    return new Date(antes.length ? Math.max(...antes) : Math.min(...l)).toISOString(); // o ultimo antes do fechamento, senao o primeiro depois
  };
  type Neg = Crm & { chat_id?: string | null; status?: string; sincronizado_em?: string | null };
  const brutos = (rCrm.error ? [] : rCrm.data ?? []) as Neg[];
  // ---- etapas de venda (desde 24/11): uma entrada por conversa e etapa (cartao que vai e volta nao conta de novo em 30 dias)
  type Entrada = { conversa_id: string; vendedor_id: string | null; etapa: EtapaVenda; em: string; dia: string; negocio?: Neg };
  const entradas: Entrada[] = [];
  for (const e of (rEt.error ? [] : rEt.data ?? []) as { conversa_id: string; vendedor_id: string | null; etapa: string; em: string }[]) {
    const etapa = etapaDeVenda(e.etapa), dia = diaBR(e.em);
    if (!etapa || dia < REGRA_ETAPAS_DESDE) continue;
    const ant = entradas.filter((x) => x.conversa_id === e.conversa_id && x.etapa === etapa).at(-1);
    if (ant && distDias(ant.dia, dia) <= JANELA) continue;
    entradas.push({ conversa_id: e.conversa_id, vendedor_id: e.vendedor_id, etapa, em: e.em, dia });
  }
  // o negocio da conversa: o mais recente aberto ate a entrada na etapa (ganho ou aberto; perdido nao conta)
  const porChat = new Map<string, Neg[]>();
  for (const v of brutos) if (v.chat_id) porChat.set(v.chat_id, [...(porChat.get(v.chat_id) ?? []), v]);
  for (const e of entradas) {
    const l = [...(porChat.get(e.conversa_id) ?? [])].sort((a, b) => String(b.aberto_em ?? "").localeCompare(String(a.aberto_em ?? "")));
    e.negocio = l.find((v) => !v.aberto_em || Date.parse(v.aberto_em) <= Date.parse(e.em) + 86400_000) ?? l[0];
  }
  // negocio que entrou numa etapa de venda (menos Renovacao, que vira linha propria): a venda e do dia da entrada.
  // So vale para negocio que ainda nao tinha sido ganho antes de 24/11 (o que ja foi contado fica onde estava).
  const entradaDoNegocio = new Map<string, Entrada>();
  for (const e of entradas) if (e.etapa !== "renovacao" && e.negocio && !entradaDoNegocio.has(e.negocio.deal_id)
    && (!e.negocio.ganho_em || diaBR(e.negocio.ganho_em) >= somaDias(REGRA_ETAPAS_DESDE, -1))) entradaDoNegocio.set(e.negocio.deal_id, e);
  const etapasDoChat = new Map<string, EtapaVenda[]>();
  for (const e of entradas) etapasDoChat.set(e.conversa_id, [...(etapasDoChat.get(e.conversa_id) ?? []), e.etapa]);
  // conversas que o Cabueta acompanha (tem linha em crm_conversas): so nelas existe historico de etapa. Negocio GANHO desde 24/11 cuja
  // conversa nao foi lida do CRM (ex.: cartao movido para Venda fechada e conversa encerrada, ou nunca importada) nao tem como provar a
  // etapa: conta pelo ganho do CRM. Conversa acompanhada que nunca entrou em etapa de venda continua fora (regra de 24/11).
  const rastreadas = new Set<string>();
  if (comEtapas) {
    const cand = [...new Set(brutos.filter((v) => v.status === "won" && v.chat_id && v.ganho_em && diaBR(v.ganho_em) >= REGRA_ETAPAS_DESDE).map((v) => v.chat_id as string))];
    for (let i = 0; i < cand.length; i += 200) {
      const r = await db.from("crm_conversas").select("id").in("id", cand.slice(i, i + 200));
      for (const c of (r.error ? [] : r.data ?? []) as { id: string }[]) rastreadas.add(c.id);
    }
  }
  const semHistorico = (v: CrmCruzado & { chat_id?: string | null; status?: string }) =>
    v.dia >= REGRA_ETAPAS_DESDE && !v.repetidaDe && v.status === "won" && !!v.chat_id && !rastreadas.has(v.chat_id) && !(etapasDoChat.get(v.chat_id)?.length);

  const negociosCrm = brutos
    .filter((v) => v.status !== "open" || (Array.isArray(v.produtos) && v.produtos.length > 0) || (entradaDoNegocio.has(v.deal_id) && (v.valor_cents ?? 0) > 0))
    // negocio aberto nao tem dia de ganho: vale a data de venda do negocio, senao o dia em que o produto apareceu, senao a abertura
    .map((v) => {
      const e = entradaDoNegocio.get(v.deal_id);
      return { ...v, comprovante: v.status === "won" && v.ganho_em ? comprovanteDe(v.contato_crm_id, v.ganho_em) : undefined,
        ganho_em: e?.em || v.ganho_em || dataDoCampo(v.campos, "") || v.aberto_em || v.sincronizado_em || new Date().toISOString(),
        etapa_em: e?.em, tipoEtapa: e ? ETAPAS_VENDA[e.etapa] ?? undefined : undefined };
    });
  const todasCrm = produtosNovosCrm(negociosCrm.map((v) => ({ ...v, dia: diaBR(v.ganho_em), fone: chaveFone(v.telefone), tipo: v.tipo || "outro" })));
  // desde 24/11: venda do CRM so conta se a conversa entrou numa etapa de venda
  const foraDasEtapas = (v: CrmCruzado & { chat_id?: string | null }): string | null => {
    if (v.dia < REGRA_ETAPAS_DESDE || v.repetidaDe) return null;
    const ets = (v.chat_id ? etapasDoChat.get(v.chat_id) : undefined) ?? [];
    if (!ets.length) return semHistorico(v) ? null : "não entrou nas etapas de venda do CRM (regra de 24/11)";
    return ets.every((x) => x === "renovacao") ? "contada na etapa Renovação" : null;
  };
  // o cruzamento continua com todos os negocios (como antes de 24/11): so tira da conversa o que o CRM ja tem
  cruzar(linhas as (Resultado & { fone?: string })[], todasCrm.filter((v) => !v.repetidaDe));
  // so o periodo pedido (o resto foi buscado so para o cruzamento); o negocio que so repete produtos aparece riscado, sem somar
  for (const v of todasCrm.filter((x) => x.dia >= de && x.dia <= ate) as (CrmCruzado & { chat_id?: string | null })[]) {
    const fora = foraDasEtapas(v);
    const ets = v.dia >= REGRA_ETAPAS_DESDE && v.chat_id ? (etapasDoChat.get(v.chat_id) ?? []).filter((x) => x !== "renovacao") : [];
    linhas.push({
      chave: `c:${v.deal_id}`, origem: "crm", id: null, auditoriaId: null, data: v.dia, vendedorId: (ALTOS.includes(v.tipo) ? closerDe(v.campos) : null) ?? v.vendedor_id ?? v.vendedorConversa ?? null,
      cliente: v.cliente?.trim() ?? "", empresa: typeof v.campos?.["nome-da-empresa"] === "string" ? v.campos["nome-da-empresa"] : "",
      produto: PRODUTOS.some(([k]) => k === v.tipo) ? v.tipo : "outro", forma: null, valor: v.valor_cents != null ? v.valor_cents / 100 : null,
      valorIA: null, ajustada: false, excluida: false, duplicada: v.repetidaDe ? "produtos já contados em outro negócio do cliente" : fora, naoLancada: false, naConversa: !!v.vista,
      indicadoPor: indicadorDoCrm(v.campos),
      ...(semHistorico(v) ? { naoAcompanhada: true } : {}),
      ...(ets.length ? { etapa: ets.includes("venda_fechada") ? "venda_fechada" : ets[0] } : semHistorico(v) && !fora ? { etapa: v.tipo === "plataforma" ? "comprou_a_plataforma" : "venda_fechada" } : {}),
    });
  }
  // Renovacao (sempre) e entrada em etapa sem negocio no CRM: linha propria, do dia da entrada
  const semNegocio = entradas.filter((e) => e.etapa === "renovacao" || !e.negocio);
  const rConv = semNegocio.length
    ? await db.from("crm_conversas").select("id,contato_nome,telefone,vendedor_id").in("id", [...new Set(semNegocio.map((e) => e.conversa_id))])
    : { data: [], error: null };
  const conv = new Map(((rConv.error ? [] : rConv.data ?? []) as { id: string; contato_nome: string | null; telefone: string | null; vendedor_id: string | null }[]).map((c) => [c.id, c]));
  for (const e of semNegocio.filter((x) => x.dia >= de && x.dia <= ate)) {
    const n = e.negocio, c = conv.get(e.conversa_id);
    linhas.push({
      chave: `e:${e.conversa_id}:${e.etapa}:${e.dia}`, origem: "crm", id: null, auditoriaId: null, data: e.dia,
      vendedorId: n?.vendedor_id ?? e.vendedor_id ?? c?.vendedor_id ?? null,
      cliente: (n?.cliente ?? c?.contato_nome ?? (c?.telefone ? telefone(c.telefone) : "")).trim(),
      empresa: typeof n?.campos?.["nome-da-empresa"] === "string" ? n.campos["nome-da-empresa"] : "",
      produto: ETAPAS_VENDA[e.etapa] ?? (n ? tipoDoProduto(n.produto, n.valor_cents) : "outro"), forma: null,
      valor: n?.valor_cents ? n.valor_cents / 100 : null, valorIA: null, ajustada: false, excluida: false, duplicada: null, naoLancada: false, naConversa: false,
      indicadoPor: indicadorDoCrm(n?.campos), etapa: e.etapa, fone: chaveFone(n?.telefone ?? c?.telefone),
    } as Resultado & { fone: string });
  }
  const cfg = (rCfg.error ? null : rCfg.data) as { vendedor_workshop: string | null; workshop_valor_padrao?: number | string | null } | null;
  const doWorkshop = cfg?.vendedor_workshop ?? null;
  // inscricao de workshop sem valor na conversa (a IA le R$ 0 ou nada): vale o que o cliente pagou no CRM; sem isso, o valor padrao da empresa
  const padrao = num(cfg?.workshop_valor_padrao);
  const pagoNoCrm = new Map<string, { v: number; ab: string }>();
  for (const n of (rWs.error ? [] : rWs.data ?? []) as { telefone: string | null; valor_cents: number; aberto_em: string | null }[]) {
    const k = chaveFone(n.telefone); if (!k) continue;
    const ab = n.aberto_em ?? "";
    if (!pagoNoCrm.has(k) || ab > pagoNoCrm.get(k)!.ab) pagoNoCrm.set(k, { v: n.valor_cents / 100, ab });
  }
  // desde 24/11 o workshop vem do funil Workshop (etapa "Inscrito no workshop"); o que a IA viu na conversa fica so para conferencia
  if (brutos.length) for (const r of linhas) if (r.origem === "ia" && r.produto === "workshop" && r.data >= REGRA_ETAPAS_DESDE && !r.duplicada)
    r.duplicada = "workshop vem do CRM desde 24/11 (etapa Inscrito no workshop)";
  for (const r of linhas as (Resultado & { fone?: string })[]) {
    if (r.origem !== "ia" || r.produto !== "workshop" || r.ajustada || r.duplicada || r.excluida || (r.valor ?? 0) > 0) continue;
    const doCrm = r.fone ? pagoNoCrm.get(r.fone)?.v : undefined;
    if (doCrm) { r.valor = doCrm; r.valorEstimado = "crm"; } else if (padrao && padrao > 0) { r.valor = padrao; r.valorEstimado = "padrao"; }
  }
  if (doWorkshop) for (const r of linhas) if (r.produto === "workshop" && !r.naoAcompanhada) r.vendedorId = doWorkshop;
  // desde 24/11: inscrito no workshop com valor zerado no CRM e cortesia (R$ 0): continua na lista (conta como inscrito)
  // e nos convites, mas nao soma no faturamento
  for (const r of linhas) {
    if (r.etapa !== "inscrito_no_workshop" || r.produto !== "workshop" || r.duplicada || r.excluida || (r.valor ?? 0) > 0) continue;
    r.valor = 0; r.cortesia = true;
    if (r.data >= de && r.data <= ate && r.vendedorId) convites.push(r.vendedorId);
  }
  const noPeriodo = linhas.filter((r) => r.data >= de && r.data <= ate).map(({ ...r }) => { delete (r as { fone?: string }).fone; return r as Resultado; });
  noPeriodo.sort((x, y) => y.data.localeCompare(x.data) || (y.valor ?? -1) - (x.valor ?? -1));
  return { linhas: noPeriodo, convites, tabelaOk, erro: rAud.error?.message ?? null };
}

// Quem indicou o cliente, pelos campos do negocio no CRM ("Indicado por" ou "Indicação"); "Foi indicado? Não" = ninguem
export function indicadorDoCrm(campos: Record<string, unknown> | null | undefined): string {
  if (!campos || /^n[aã]o$/i.test(String(campos["foi-indicado"] ?? "").trim())) return "";
  const t = (k: string) => (typeof campos[k] === "string" ? (campos[k] as string).trim() : "");
  return t("indicado-por") || t("indicacao");
}

// ---------- cruzamento ----------
type Crm = { deal_id: string; contato_crm_id: string | null; telefone: string | null; cliente: string | null; valor_cents: number | null; aberto_em?: string | null; ganho_em: string; vendedor_id: string | null; produto: string | null; tipo: string | null; produtos?: unknown; campos: Record<string, unknown> | null;
  // ajuste feito a mao (gestao): dia da venda e divisao do valor entre os produtos, ex.: {"imersao":0.5,"plataforma":0.5}
  dia_venda_manual?: string | null; rateio_manual?: Record<string, number> | null };
type CrmCruzado = Crm & { comprovante?: string; dia: string; fone: string; tipo: string; vista?: boolean; vendedorConversa?: string | null; repetidaDe?: string; diaCerto?: boolean;
  // desde 24/11: quando o cartao entrou na etapa de venda, e o produto que a etapa diz (negocio sem lista de produtos)
  etapa_em?: string; tipoEtapa?: string };

// Dia da VENDA = o dia em que a venda foi alimentada no CRM (cartao ganho), para negocios ganhos A PARTIR DE 16/11/2026
// (os ganhos antes disso seguem a regra antiga, pela "Data do diagnostico"). Antes disso, nesta ordem:
// 0) dia acertado a mao; data de venda preenchida no CRM; produto acrescentado depois (o dia em que apareceu);
//    comprovante do cliente na conversa ate 2 dias antes (ou 1 depois) do fechamento: o dia do comprovante.
// 1) workshop: o dia em que o negocio foi aberto. 2) aberto ha mais de 30 dias sem diagnostico (venda antiga): a abertura.
// Datas preenchidas no CRM: "data da venda/fechamento" do negocio ou a data de um produto (ex.: "Data venda plataforma").
// tipo vazio = so a data do negocio. Aceita AAAA-MM-DD ou DD/MM/AAAA.
export function dataDoCampo(campos: Record<string, unknown> | null | undefined, tipo: string): string {
  if (!campos) return "";
  const palavra: Record<string, RegExp> = { imersao: /imers/, plataforma: /plataforma|start/, incompany: /in.?company/, workshop: /workshop/ };
  const ler = (x: unknown) => {
    const t = String(x ?? "").trim();
    const iso = t.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
    if (iso && iso > "2000") return iso;
    const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    return br ? `${br[3]}-${br[2]}-${br[1]}` : "";
  };
  const chaves = Object.keys(campos).filter((k) => /data|dia/.test(k) && /venda|fechamento|fechou|compra|pagamento/.test(k));
  const doProduto = tipo && palavra[tipo] ? chaves.find((k) => palavra[tipo].test(k) && ler(campos[k])) : undefined;
  const doNegocio = chaves.find((k) => !Object.values(palavra).some((r) => r.test(k)) && ler(campos[k]));
  const k = doProduto ?? doNegocio;
  return k ? ler(campos[k]) : "";
}

// Regra do dia da venda pela alimentacao no CRM vale para negocios ganhos a partir deste dia (pedido da gestao, 16/11/2026)
const REGRA_ALIMENTACAO_DESDE = "2026-11-16";
export function diaDaVenda(v: { ganho_em: string; aberto_em?: string | null; campos?: Record<string, unknown> | null; comprovante?: string; dia_venda_manual?: string | null; etapa_em?: string }, tipo: string, item?: { visto_em?: string | null } | null): { dia: string; certo: boolean } {
  if (v.dia_venda_manual) return { dia: String(v.dia_venda_manual).slice(0, 10), certo: true }; // dia acertado a mao pela gestao vale sobre tudo
  if (v.etapa_em) return { dia: diaBR(v.etapa_em), certo: true }; // desde 24/11: o dia em que o cartao entrou na etapa de venda
  const doCampo = dataDoCampo(v.campos, tipo);
  if (doCampo) return { dia: doCampo, certo: true };
  if (item?.visto_em) return { dia: diaBR(item.visto_em), certo: true }; // produto acrescentado depois num negocio que ja existia
  if (v.comprovante && tipo !== "workshop") return { dia: diaBR(v.comprovante), certo: true }; // cliente mandou o comprovante na conversa
  const ganho = diaBR(v.ganho_em);
  const aberto = v.aberto_em ? diaBR(v.aberto_em) : "";
  // ATE 15/11/2026 (regra antiga, as vendas ja contadas ficam como estao): a "Data do diagnostico" decide o dia
  if (ganho < REGRA_ALIMENTACAO_DESDE) {
    const diag = typeof v.campos?.["data-do-diagnostico"] === "string" ? (v.campos["data-do-diagnostico"] as string).slice(0, 10) : "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(diag) && diag <= ganho) return { dia: distDias(diag, ganho) <= 3 ? ganho : diag, certo: true };
    if (aberto && aberto <= ganho && (tipo === "workshop" || distDias(aberto, ganho) <= 7)) return { dia: aberto, certo: tipo === "workshop" };
    if (aberto && aberto <= ganho && distDias(aberto, ganho) > 30) return { dia: aberto, certo: true };
    return { dia: ganho, certo: false };
  }
  // A PARTIR DE 16/11/2026: a venda conta no dia em que foi ALIMENTADA no CRM (cartao ganho em "Venda fechada").
  // A "Data do diagnostico" nao muda mais o dia da venda.
  // workshop: o dia em que o negocio foi aberto (quando o link foi mandado e pago)
  if (tipo === "workshop" && aberto && aberto <= ganho) return { dia: aberto, certo: true };
  // negocio aberto ha mais de 30 dias, ganho agora e sem diagnostico: arrumacao do funil (venda antiga), fica na abertura
  const temDiag = /^\d{4}-\d{2}-\d{2}/.test(String(v.campos?.["data-do-diagnostico"] ?? ""));
  if (!temDiag && aberto && aberto <= ganho && distDias(aberto, ganho) > 30) return { dia: aberto, certo: true };
  return { dia: ganho, certo: true };
}

type Item = { produto_id?: string | null; nome?: string | null; quantidade?: number | null; total_cents?: number | null; visto_em?: string | null };
// Tipo do produto pelo nome (o mesmo de supabase/functions/crm-vendas)
export function tipoDoProduto(nome: string | null | undefined, valorCents: number | null = null): string {
  const n = String(nome ?? "").toLowerCase();
  if (/imers/.test(n)) return "imersao";
  if (/in.?company/.test(n)) return "incompany";
  if (/workshop/.test(n)) return "workshop";
  if (/plataforma|start/.test(n)) return "plataforma";
  if (n) return "outro";
  return valorCents != null && valorCents > 0 && valorCents <= 100000 ? "workshop" : "outro"; // sem produto: ate R$ 1.000 e workshop
}
// Assinatura da Plataforma: quando o cliente assina, o CRM abre e ganha sozinho um negocio na instancia "Suporte/posvendas",
// com o valor da assinatura e sem produto (ex.: Josue Jordao 12/11, Lucas Santos 10/11). Esse caminho e venda de Plataforma.
export function assinaturaPlataforma(v: { status?: string | null; valor_cents: number | null; produto?: string | null; produtos?: unknown; campos?: Record<string, unknown> | null }): boolean {
  const semLista = !(Array.isArray(v.produtos) && v.produtos.length);
  return (v.status ?? "won") === "won" && semLista && (v.valor_cents ?? 0) > 0 && (!v.produto || /plataforma|start/i.test(v.produto))
    && /suporte|p[oó]s.?venda/i.test(String(v.campos?.instancia ?? ""));
}
const mesmoItem = (a: Item, b: Item) => (a.produto_id ? a.produto_id === b.produto_id : a.nome === b.nome) && (a.total_cents ?? 0) === (b.total_cents ?? 0);
// itens cuja soma e exatamente o valor (para descobrir o que tinha num negocio antigo que veio sem a lista de produtos)
function itensQueSomam(itens: Item[], alvo: number): number[] | null {
  const n = Math.min(itens.length, 12);
  for (let m = 1; m < 1 << n; m++) {
    let t = 0; const idx: number[] = [];
    for (let k = 0; k < n; k++) if (m & (1 << k)) { t += itens[k].total_cents ?? 0; idx.push(k); }
    if (t === alvo) return idx;
  }
  return null;
}

// O negocio do CRM acumula os produtos: o negocio novo de um cliente lista tambem o que ele ja comprou antes
// (ex.: Imersao + Workshop em outubro; em novembro o negocio traz Imersao + Workshop + In-Company). Por cliente
// (contato do CRM, ou numero), em ordem de ganho, so conta o produto que ainda nao foi contado num negocio anterior.
// Negocio antigo sem a lista de produtos (a API so detalha o negocio atual de cada conversa): descobre pelos itens de
// um negocio seguinte que somam exatamente o valor dele. Se nada sobra de novo, o negocio inteiro e repetido.
// Uma linha com quantidade 3 sao 3 vendas: abre em unidades (o centavo que sobra vai para a primeira)
export function abrirUnidades(itens: Item[]): Item[] {
  return itens.flatMap((it) => {
    const q = Math.min(20, Math.max(1, Math.trunc(Number(it.quantidade) || 1)));
    if (q === 1) return [it];
    const total = it.total_cents ?? 0, base = Math.floor(total / q), resto = total - base * q;
    return Array.from({ length: q }, (_, i) => ({ ...it, quantidade: 1, total_cents: base + (i === 0 ? resto : 0) }));
  });
}
export function produtosNovosCrm(lista: CrmCruzado[]): CrmCruzado[] {
  const out: CrmCruzado[] = [];
  const porCliente = new Map<string, CrmCruzado[]>();
  for (const v of lista) { const k = v.contato_crm_id || v.fone || v.deal_id; porCliente.set(k, [...(porCliente.get(k) ?? []), v]); }
  for (const negocios of porCliente.values()) {
    negocios.sort((a, b) => a.ganho_em.localeCompare(b.ganho_em));
    const contados: Item[] = [];                       // itens ja contados deste cliente
    const semLista: { v: CrmCruzado; resolvido: boolean }[] = [];
    // desconto dado no negocio inteiro: o valor do negocio e o que vale, dividido entre os produtos na proporcao do preco
    const fator = (v: CrmCruzado) => {
      const soma = abrirUnidades((Array.isArray(v.produtos) ? v.produtos : []) as Item[]).reduce((t, it) => t + (it.total_cents ?? 0), 0);
      return v.valor_cents != null && soma > 0 && soma !== v.valor_cents ? v.valor_cents / soma : 1;
    };
    const linha = (v: CrmCruzado, it: Item | null, n: number, extra: Partial<CrmCruzado> = {}, dono: CrmCruzado = v): CrmCruzado => {
      const tipo = it ? tipoDoProduto(it.nome) : v.tipoEtapa ?? (assinaturaPlataforma(v) ? "plataforma" : tipoDoProduto(v.produto, v.valor_cents));
      const { dia, certo } = diaDaVenda(v, tipo, it);
      return { ...v, deal_id: it ? `${v.deal_id}#${n}` : v.deal_id, produto: it?.nome ?? v.produto, tipo, dia, diaCerto: certo,
        valor_cents: it ? Math.round((it.total_cents ?? 0) * fator(dono)) : v.valor_cents, ...extra, ...rateado(v, it, tipo) };
    };
    // divisao do valor do negocio acertada a mao (rateio_manual): cada produto fica com a parte dele, igual entre as unidades
    const rateado = (v: CrmCruzado, it: Item | null, tipo: string): Partial<CrmCruzado> => {
      const parte = it && v.rateio_manual && v.valor_cents != null ? Number(v.rateio_manual[tipo]) : NaN;
      if (!Number.isFinite(parte)) return {};
      const unidades = abrirUnidades((Array.isArray(v.produtos) ? v.produtos : []) as Item[]).filter((x) => tipoDoProduto(x.nome) === tipo).length || 1;
      return { valor_cents: Math.round(((v.valor_cents as number) * parte) / unidades) };
    };
    for (const v of negocios) {
      const itens = abrirUnidades((Array.isArray(v.produtos) ? v.produtos : []) as Item[]);
      if (!itens.length) { semLista.push({ v, resolvido: false }); continue; }
      // tira o que ja foi contado em negocio anterior
      const resto = [...contados], novos: Item[] = [];
      for (const it of itens) { const i = resto.findIndex((x) => mesmoItem(x, it)); if (i >= 0) resto.splice(i, 1); else novos.push(it); }
      // negocio anterior sem lista: os itens que somam o valor dele eram dele
      for (const p of semLista.filter((x) => !x.resolvido && x.v.valor_cents)) {
        const idx = itensQueSomam(novos, p.v.valor_cents as number);
        if (!idx) continue;
        p.resolvido = true;
        idx.forEach((k, n) => out.push(linha(p.v, novos[k], n, { vendedor_id: p.v.vendedor_id ?? v.vendedor_id }, { ...p.v, produtos: idx.map((x) => novos[x]) })));
        for (const k of [...idx].sort((a, b) => b - a)) { contados.push(novos[k]); novos.splice(k, 1); }
      }
      // valor dos produtos novos: o negocio acumula o que o cliente ja tinha comprado. O que sobra do valor do negocio depois
      // dos produtos antigos e dos novos; se nao sobra nada (o valor do negocio nao inclui o novo, ex.: Joao Paulo de Sa,
      // negocio de R$ 3.779 = Imersao + Workshop antigos, com In-Company de R$ 5.000 acrescentado), o novo vale o preco dele.
      const soma = (l: Item[]) => l.reduce((t, it) => t + (it.total_cents ?? 0), 0);
      const somaNovos = soma(novos), somaVelhos = soma(itens) - somaNovos;
      const restante = (v.valor_cents ?? 0) - somaVelhos;
      const f = v.valor_cents == null || !somaNovos ? 1 : !somaVelhos ? fator(v) : restante <= 0 || restante >= somaNovos ? 1 : restante / somaNovos;
      if (novos.length) novos.forEach((it, n) => out.push(linha(v, it, n, { valor_cents: Math.round((it.total_cents ?? 0) * f) })));
      else out.push(linha(v, null, 0, { repetidaDe: "anterior", tipo: tipoDoProduto(itens[0]?.nome) }));
      contados.push(...novos);
    }
    // negocio sem lista que nao foi explicado por nenhum outro: conta pelo valor, a nao ser que o cliente tenha outro negocio
    // ganho com o MESMO valor ate 30 dias (ex.: Lucas Santos, um no Suporte sem produto e outro com Plataforma): e a mesma venda
    const jaContados: CrmCruzado[] = negocios.filter((n) => !semLista.some((x) => x.v === n && !x.resolvido));
    // o que tem produto informado vem primeiro (fica valendo); o sem produto vira o repetido
    for (const p of semLista.filter((x) => !x.resolvido).sort((a, b) => Number(!!b.v.produto) - Number(!!a.v.produto))) {
      const gemeo = p.v.valor_cents ? [...jaContados].find((n) => n !== p.v && n.valor_cents === p.v.valor_cents && distDias(diaBR(n.ganho_em), diaBR(p.v.ganho_em)) <= JANELA) : undefined;
      out.push(gemeo ? linha(p.v, null, 0, { repetidaDe: "mesmo valor em outro negocio do cliente" }) : linha(p.v, null, 0));
      jaContados.push(p.v);
    }
  }
  return out;
}
const JANELA = 30; // dias: a mesma venda repetida (no CRM ou na conversa)
const JANELA_CRM = 45; // dias: a venda da conversa que tambem esta no CRM
const ALTOS = ["imersao", "plataforma", "incompany", "outro"];
const somaDias = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const distDias = (a: string, b: string) => Math.abs(Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / 86400_000;
const diaBR = (iso: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));
// Telefone comparavel: DDD + 8 ultimos digitos (ignora o 55 e o 9 extra), como no worker
export function chaveFone(t: string | null | undefined) {
  const d = String(t ?? "").replace(/\D/g, "");
  if (/^55\d{10,11}$/.test(d)) return d.slice(2, 4) + d.slice(-8);
  if (/^\d{10,11}$/.test(d)) return d.slice(0, 2) + d.slice(-8);
  return d.length >= 8 ? d.slice(-8) : "";
}
const nomeChave = (n: string) => { const p = n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((x) => x.length > 1); return p.length ? `${p[0]} ${p[p.length - 1]}` : ""; };
// produto da conversa (a IA so separa imersao e workshop) compativel com o do CRM
const compativel = (ia: string | null, crm: string) => (ia === "workshop" ? crm === "workshop" : crm !== "workshop");

export function cruzar(linhas: (Resultado & { fone?: string })[], crm: CrmCruzado[]) {
  const crmLigado = crm.length > 0;
  // 1) IA x CRM: mesmo numero, qualquer produto, ate JANELA_CRM dias (o CRM manda)
  for (const r of linhas.filter((x) => x.origem === "ia")) {
    const v = r.fone ? crm.filter((c) => c.fone === r.fone && distDias(c.dia, r.data) <= JANELA_CRM).sort((a, b) => Number(compativel(r.produto, b.tipo)) - Number(compativel(r.produto, a.tipo)) || distDias(a.dia, r.data) - distDias(b.dia, r.data))[0] : undefined;
    if (v) {
      r.duplicada = "já contada no CRM"; v.vista = true;
      if (compativel(r.produto, v.tipo)) v.vendedorConversa ??= r.vendedorId; // so empresta o vendedor da conversa do mesmo tipo de venda
      if (!v.diaCerto && r.data < v.dia && compativel(r.produto, v.tipo)) v.dia = r.data; // a venda apareceu antes na conversa
    }
  }
  // 2) IA repetida em mais de um dia: vale a primeira (ou a que foi ajustada a mao)
  const grupos = new Map<string, (Resultado & { fone?: string })[]>();
  for (const r of linhas.filter((x) => x.origem === "ia" && !x.duplicada && x.fone)) grupos.set(`${r.fone}|${r.produto}`, [...(grupos.get(`${r.fone}|${r.produto}`) ?? []), r]);
  for (const g of grupos.values()) {
    g.sort((a, b) => Number(b.ajustada) - Number(a.ajustada) || a.data.localeCompare(b.data));
    for (const r of g.slice(1)) if (distDias(r.data, g[0].data) <= JANELA) r.duplicada = "repetida (mesma venda em outro dia)";
  }
  // 3) manual x CRM: mesmo nome de cliente e produto
  for (const r of linhas.filter((x) => x.origem === "manual" && x.cliente)) {
    const k = nomeChave(r.cliente);
    if (k && crm.some((c) => c.cliente && nomeChave(c.cliente) === k && (!r.produto || r.produto === c.tipo) && distDias(c.dia, r.data) <= JANELA)) r.duplicada = "já lançada no CRM";
  }
  // 3b) venda lancada a mao que a IA tambem viu na conversa (mesmo nome e produto): vale a manual
  for (const m of linhas.filter((x) => x.origem === "manual" && !x.duplicada && x.cliente)) {
    const k = nomeChave(m.cliente);
    for (const r of linhas.filter((x) => x.origem === "ia" && !x.duplicada && x.cliente && nomeChave(x.cliente) === k && (!m.produto || m.produto === x.produto) && distDias(x.data, m.data) <= JANELA)) r.duplicada = "já lançada à mão";
  }
  // 4) venda alta so na conversa: espera o lancamento no CRM. Abaixo de R$ 1.000 a IA chamou de imersao um workshop: segue valendo.
  if (crmLigado) for (const r of linhas.filter((x) => x.origem === "ia" && !x.duplicada && ALTOS.includes(x.produto ?? "") && (x.valor == null || x.valor >= 1000))) r.naoLancada = true;
}

// Soma do faturamento: so vendas com valor e que nao foram tiradas
export const contaNoFaturamento = (r: Resultado) => !r.excluida && !r.duplicada && !r.naoLancada && (r.valor ?? 0) > 0;
// Quantidade (inscritos/vendas): o que soma no faturamento + as cortesias do workshop (R$ 0)
export const contaNaQuantidade = (r: Resultado) => contaNoFaturamento(r) || (!!r.cortesia && !r.excluida && !r.duplicada);

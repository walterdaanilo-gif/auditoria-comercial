import { createAdminClient } from "@/lib/supabase/admin";
import { hojeBR, um } from "@/lib/format";
import { diasUteis } from "@/lib/metas";
import { diasEntre } from "@/lib/periodo";
import { inteiro, moeda, pctTxt, type CaixaProduto, type EtapaFunil, type Pessoa, type Produto, type Slide1Dados, type Tom } from "./calc";

// Slide 1 com dados REAIS. So leitura. O que o Cabueta ainda nao mede volta como null (a tela escreve "aguardando fonte").
type Perfil = { id: string; nome: string; funcao: string | null; ativo: boolean; foto_url: string | null };
type Linha = { dia: string; vendedor_id: string; contatadas: number; enviadas: number; respostas: number; ligacoes: number; auditadas: number; nota_soma: number; marcacoes: number };
type Venda = { vendedor_id: string; venda_tipo: string | null; venda_valor: number | null; venda_cupom: boolean; conversas: { data: string } | { data: string }[] | null };
type Atividade = { vendedor_id: string; ultima_msg_em: string | null; ultima_ligacao_em: string | null; conversas_hoje: number };
type Inst = { vendedor_id: string; status: string; atualizado_em: string | null };

const n = (x: unknown) => Number(x) || 0;
const ddmm = (d: string) => d.slice(8, 10) + "/" + d.slice(5, 7);
const util = (d: string) => { const w = new Date(d + "T12:00:00Z").getUTCDay(); return w !== 0 && w !== 6; };
const sigla = (nome: string) => nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";

function horaBR() {
  const p = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  return { texto: p, hora: Number(p.slice(0, 2)) };
}
function tempoTxt(min: number) { return min >= 1440 ? `${Math.floor(min / 1440)} dia${min >= 2880 ? "s" : ""}` : `${Math.max(1, Math.round(min / 60))} h`; }

export async function montarSlide1(org: string): Promise<Slide1Dados> {
  const hoje = hojeBR();
  const ini = hoje.slice(0, 8) + "01";
  const ano = Number(hoje.slice(0, 4)), mes = Number(hoje.slice(5, 7));
  const fim = `${hoje.slice(0, 8)}${String(new Date(Date.UTC(ano, mes, 0)).getUTCDate()).padStart(2, "0")}`;
  const diaUtil = diasUteis(ini, hoje), diasUteisMes = diasUteis(ini, fim);
  const db = createAdminClient();

  const [rRes, rPerf, rInst, rCfg, rVen, rAtv, rSem] = await Promise.all([
    db.rpc("resumo_sdr2", { p_from: ini, p_to: hoje }),
    db.from("profiles").select("id,nome,funcao,ativo,foto_url").order("nome"),
    db.from("instancias_whatsapp").select("vendedor_id,status,atualizado_em").eq("org_id", org),
    db.from("audit_settings").select("*").eq("org_id", org).maybeSingle(),
    db.from("auditorias").select("vendedor_id,venda_tipo,venda_valor,venda_cupom,conversas!inner(data,canal)").eq("org_id", org).eq("venda", true).neq("conversas.canal", "importada").gte("conversas.data", ini).lte("conversas.data", hoje).limit(5000),
    db.rpc("ultima_atividade"),
    db.rpc("conversas_sem_retorno", { p_from: ini, p_to: hoje, p_min: 15 }),
  ]);

  const insts = (rInst.data ?? []) as Inst[];
  const equipe = new Set(insts.map((i) => i.vendedor_id));
  const time = ((rPerf.data ?? []) as Perfil[]).filter((p) => p.ativo && equipe.has(p.id));
  const sdrs = time.filter((p) => p.funcao !== "closer" && p.funcao !== "gestao");
  const closers = time.filter((p) => p.funcao === "closer");
  const ids = new Set(time.map((p) => p.id));
  const linhas = ((rRes.data ?? []) as Linha[]).filter((l) => ids.has(l.vendedor_id));
  const vendas = ((rVen.data ?? []) as unknown as Venda[]).filter((v) => ids.has(v.vendedor_id));
  const cfg = (rCfg.data ?? {}) as Record<string, number | null | undefined>;
  const metaDe = (k: string) => (cfg[k] == null ? null : Number(cfg[k]));

  // ---- faturamento (so Workshop pago e Imersao: os unicos com valor no Cabueta) ----
  const valorV = (v: Venda) => (v.venda_tipo === "imersao" || !v.venda_cupom ? n(v.venda_valor) : 0);
  const porDia = new Map<string, number>();
  for (const v of vendas) { const d = um(v.conversas)?.data; if (d) porDia.set(d, (porDia.get(d) ?? 0) + valorV(v)); }
  const serie: { du: number; real: number; data: string }[] = [];
  let acc = 0, du = 0;
  for (const d of diasEntre(ini, hoje)) {
    acc += porDia.get(d) ?? 0;
    if (!util(d)) continue;
    du++; serie.push({ du, real: acc, data: ddmm(d) });
  }
  if (serie.length) serie[serie.length - 1].real = acc; // venda de fim de semana entra no ultimo ponto
  const datasUteis = diasEntre(ini, fim).filter(util).map(ddmm);
  const real = acc;

  // ---- por produto ----
  const ws = vendas.filter((v) => v.venda_tipo !== "imersao"), im = vendas.filter((v) => v.venda_tipo === "imersao");
  const wPagos = ws.filter((v) => !v.venda_cupom), wValor = wPagos.reduce((s, v) => s + n(v.venda_valor), 0);
  const imValor = im.reduce((s, v) => s + n(v.venda_valor), 0);
  const pctDa = (valor: number, meta: number | null) => (meta && meta > 0 ? (valor / meta) * 100 : null);
  const rotMeta = (meta: number | null) => (meta ? `meta ${moeda(meta)}` : "meta: aguardando fonte");
  const mWork = metaDe("meta_fat_workshop"), mImer = metaDe("meta_fat_imersao"), mInc = metaDe("meta_fat_incompany"), mPlat = metaDe("meta_fat_plataforma");
  const produtos: Produto[] = [
    { chave: "incompany", nome: "In-company", cor: "#5ea0f0", valor: null, pctMeta: null, rotuloMeta: mInc ? `meta ${moeda(mInc)}` : null, ticket: null, winloss: null },
    { chave: "imersao", nome: "Imersão aberta", cor: "#9085e9", valor: imValor, pctMeta: pctDa(imValor, mImer), rotuloMeta: rotMeta(mImer), ticket: im.length ? moeda(imValor / im.length) : null, winloss: null },
    { chave: "plataforma", nome: "Plataforma", cor: "#6dcfc0", valor: null, pctMeta: null, rotuloMeta: mPlat ? `meta ${moeda(mPlat)}` : null, ticket: null, winloss: null },
    { chave: "workshop", nome: "Workshop", cor: "#e98bb0", valor: wValor, pctMeta: pctDa(wValor, mWork), rotuloMeta: rotMeta(mWork), ticket: wPagos.length ? moeda(wValor / wPagos.length) : null, winloss: null },
  ];

  // ---- pessoas ----
  const soma = (id: string) => linhas.filter((l) => l.vendedor_id === id).reduce((t, l) => ({ contatadas: t.contatadas + n(l.contatadas), enviadas: t.enviadas + n(l.enviadas), respostas: t.respostas + n(l.respostas), ligacoes: t.ligacoes + n(l.ligacoes), auditadas: t.auditadas + n(l.auditadas), nota: t.nota + n(l.nota_soma), marcacoes: t.marcacoes + n(l.marcacoes) }), { contatadas: 0, enviadas: 0, respostas: 0, ligacoes: 0, auditadas: 0, nota: 0, marcacoes: 0 });
  const atv = new Map(((rAtv.data ?? []) as Atividade[]).map((a) => [a.vendedor_id, a]));
  const agora = horaBR(), dow = new Date(hoje + "T12:00:00Z").getUTCDay();
  const expediente = dow !== 0 && dow !== 6 && agora.hora >= 8 && agora.hora < 18;
  const status = (id: string): Pessoa["status"] => {
    const minhas = insts.filter((i) => i.vendedor_id === id);
    if (minhas.length && !minhas.some((i) => i.status === "conectado")) {
      const desde = Math.max(...minhas.map((i) => (i.atualizado_em ? Date.parse(i.atualizado_em) : Date.now())));
      return { texto: `WhatsApp off · ${tempoTxt((Date.now() - desde) / 60000)}`, tom: "bad" as Tom };
    }
    if (!expediente) return { texto: "fora do expediente", tom: "neutro" };
    const a = atv.get(id);
    const ult = [a?.ultima_msg_em, a?.ultima_ligacao_em].filter(Boolean).map((x) => Date.parse(x as string)).sort().pop();
    if (!ult) return { texto: "sem atividade hoje", tom: "warn" };
    const min = (Date.now() - ult) / 60000;
    return min < 60 ? { texto: "ativo", tom: "ok" } : { texto: `parado ${tempoTxt(min)}`, tom: "warn" };
  };
  const vendasDe = (id: string) => vendas.filter((v) => v.vendedor_id === id);
  const metaConv = (cfg.meta_sdr_conversas ?? 25) * diasUteisMes;
  const pessoa = (p: Perfil, tipo: "sdr" | "closer"): Pessoa => {
    const t = soma(p.id), vs = vendasDe(p.id);
    const inscr = vs.filter((v) => v.venda_tipo !== "imersao").length; // pagos + convites
    return {
      id: p.id, nome: p.nome, sigla: sigla(p.nome), foto: p.foto_url, tipo, status: status(p.id),
      contatos: tipo === "sdr" ? t.contatadas + t.ligacoes : null,
      conversas: tipo === "sdr" ? { v: t.respostas, meta: metaConv } : null,
      inscricoes: tipo === "sdr" ? { v: inscr, meta: null } : null,
      reunioes: null, negociacao: null,
      vendasValor: vs.reduce((s, v) => s + valorV(v), 0),
      nota: t.auditadas ? t.nota / t.auditadas : null,
      rodape: tipo === "sdr" ? `${inteiro(t.ligacoes)} ligações · ${inteiro(t.enviadas)} mensagens` : `${vs.filter((v) => valorV(v) > 0).length} vendas · conversão: —`,
    };
  };
  const pessoas = [...sdrs.map((p) => pessoa(p, "sdr")), ...closers.map((p) => pessoa(p, "closer"))];

  // ---- funil (comeca no que existe; as etapas sem fonte aparecem como aguardando fonte) ----
  const sdrIds = new Set(sdrs.map((p) => p.id));
  const tS = linhas.filter((l) => sdrIds.has(l.vendedor_id)).reduce((t, l) => ({ contatos: t.contatos + n(l.contatadas) + n(l.ligacoes), conversas: t.conversas + n(l.respostas), marcacoes: t.marcacoes + n(l.marcacoes), contatadas: t.contatadas + n(l.contatadas) }), { contatos: 0, conversas: 0, marcacoes: 0, contatadas: 0 });
  const inscricoes = pessoas.filter((p) => p.tipo === "sdr").reduce((s, p) => s + (p.inscricoes?.v ?? 0), 0);
  const convites = ws.filter((v) => v.venda_cupom && sdrIds.has(v.vendedor_id)).length;
  const pagosSdr = ws.filter((v) => !v.venda_cupom && sdrIds.has(v.vendedor_id)).length;
  const funil: EtapaFunil[] = [
    { nome: "Contatos", sub: "mensagens + ligações", valor: tS.contatos, passagem: null },
    { nome: "Conversas trocadas", sub: "o lead respondeu", valor: tS.conversas, passagem: pctTxt(tS.conversas, tS.contatadas) },
    { nome: "Marcações", sub: "workshop + reunião de imersão", valor: tS.marcacoes, passagem: pctTxt(tS.marcacoes, tS.conversas) },
    { nome: "Inscrição no workshop", sub: `${pagosSdr} pagos + ${convites} convites`, valor: inscricoes, passagem: pctTxt(inscricoes, tS.marcacoes) },
    { nome: "Presença no workshop", valor: null, passagem: null },
    { nome: "Reunião de diagnóstico", valor: null, passagem: null, destaque: true },
  ];
  const caixasProduto: CaixaProduto[] = [
    { nome: "Imersão aberta", cor: "#9085e9", valor: im.length, pct: null },
    { nome: "In-company", cor: "#5ea0f0", valor: null, pct: null },
    { nome: "Plataforma", cor: "#6dcfc0", valor: null, pct: null },
  ];

  // ---- rodape ----
  const respondeu = tS.conversas;
  const semRetornoLista = ((rSem.data ?? []) as { vendedor_id: string }[]).filter((c) => ids.has(c.vendedor_id));
  return {
    demo: false,
    atualizadoEm: agora.texto,
    periodo: { rotulo: "Mês atual", intervalo: `01 a ${fim.slice(8)}/${fim.slice(5, 7)}`, diaUtil, diasUteisMes },
    fat: { real, meta: metaDe("meta_fat_mes"), semFonteResto: true, serie, datasUteis },
    produtos, funil, caixasProduto,
    origem: null, negociacao: null, presentesImersao: null,
    semRetorno: rSem.error ? null : semRetornoLista.length,
    pessoas,
    rodape: [
      { rotulo: "Responderam", valor: inteiro(respondeu), sub: `${pctTxt(respondeu, tS.contatadas) ?? "—"} das conversas` },
      { rotulo: "SLA 1ª resposta", valor: null }, { rotulo: "Show-up reuniões", valor: null }, { rotulo: "Reembolso", valor: null },
      { rotulo: "Follow-ups atrasados", valor: null }, { rotulo: "NPS do mês", valor: null }, { rotulo: "Indicações de parceiros", valor: null },
    ],
  };
}

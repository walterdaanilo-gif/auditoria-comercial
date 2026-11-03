import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { chaveDe, linhas, montarLeads } from "./planilha";
import { STATUS, type Progresso, type Status } from "./regras";

// Sincronizacao com a planilha pelo Google Apps Script (apps-script/closer-sync.gs). So no servidor.
// Nunca registrar em log o conteudo das abas: sao nomes e telefones.

// Colunas de progresso na aba "Todos · completude e etapas". O script usa os mesmos titulos.
export const COLUNAS = { situacao: "Situação no painel", motivo: "Motivo", anotacao: "Anotações do closer", atualizado: "Atualizado no painel em" };
const MSG = ["✓ Msg 1", "✓ Msg 2", "✓ Msg 3"];

export type ProgressoSync = Progresso & { chave: string };

// Compara o segredo em tempo constante (o hash deixa os dois do mesmo tamanho)
export function segredoOk(recebido: string | null | undefined) {
  const certo = process.env.CLOSER_SYNC_SECRET;
  if (!certo || !recebido) return false;
  const h = (s: string) => crypto.createHash("sha256").update(s).digest();
  return crypto.timingSafeEqual(h(recebido), h(certo));
}

// A planilha e da Weevo: tudo o que vem dela vai para essa empresa
export async function orgWeevo(admin: ReturnType<typeof createAdminClient>) {
  const slug = process.env.CLOSER_ORG_SLUG || "weevo";
  const { data, error } = await admin.from("organizacoes").select("id").eq("slug", slug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Empresa "${slug}" não encontrada.`);
  return data.id as string;
}

const textoParaStatus = new Map(Object.entries(STATUS).map(([k, v]) => [v.texto.toLowerCase(), k as Status]));
const marcado = (v: string | undefined) => /^(true|verdadeiro)$/i.test(String(v ?? "").trim());
const igual = (a: Omit<Progresso, "status_em">, b: Omit<Progresso, "status_em">) => a.status === b.status && a.enviadas === b.enviadas && a.motivo === b.motivo && a.anotacao === b.anotacao;
const quando = (s: string | null | undefined) => (s ? new Date(s).getTime() : NaN);

// Progresso que uma pessoa marcou na planilha: so linhas com "Atualizado no painel em" preenchido.
// Quando o mesmo lead tem varias linhas, vale a mais recente.
function progressoDaPlanilha(todos: string[][]) {
  const saida = new Map<string, { em: number; situacao: string; enviadas: number; motivo: string; anotacao: string }>();
  for (const t of linhas(todos)) {
    const em = quando(t[COLUNAS.atualizado]);
    if (isNaN(em)) continue;
    const chave = chaveDe(t);
    if ((saida.get(chave)?.em ?? -Infinity) >= em) continue;
    const enviadas = marcado(t[MSG[2]]) ? 3 : marcado(t[MSG[1]]) ? 2 : marcado(t[MSG[0]]) ? 1 : 0;
    saida.set(chave, { em, situacao: t[COLUNAS.situacao] ?? "", enviadas, motivo: (t[COLUNAS.motivo] ?? "").slice(0, 200), anotacao: (t[COLUNAS.anotacao] ?? "").slice(0, 4000) });
  }
  return saida;
}

// Planilha -> sistema. Atualiza "dados" de todos os leads (como o antigo "Atualizar da planilha") e aplica o progresso
// marcado na planilha so quando ele e mais novo que o do painel. Devolve o progresso aplicado, para o script copiar
// para as outras linhas do mesmo lead.
export async function receberPlanilha(todos: string[][], participantes: string[][], atencao: string[][]) {
  const leads = montarLeads(todos, participantes, atencao);
  if (!leads.length) throw new Error("A planilha veio vazia. Nada foi alterado.");
  const admin = createAdminClient();
  const org = await orgWeevo(admin);
  const agora = new Date().toISOString();
  for (let i = 0; i < leads.length; i += 200) {
    const { error } = await admin.from("closer_leads").upsert(leads.slice(i, i + 200).map((l) => ({ org_id: org, chave: l.chave, dados: l, importado_em: agora })), { onConflict: "org_id,chave" });
    if (error) throw new Error(error.message);
  }

  const daPlanilha = progressoDaPlanilha(todos);
  const aplicados: ProgressoSync[] = [];
  if (daPlanilha.size) {
    // le a empresa toda e filtra aqui: uma lista grande de chaves na consulta estouraria o tamanho do endereco
    const data = await todasAsPaginas((de, ate) => admin.from("closer_leads").select("chave,enviadasPlanilha:dados->enviadasPlanilha,status,enviadas,motivo,anotacao,status_em").eq("org_id", org).order("chave").range(de, ate));
    for (const r of data as any[]) {
      const p = daPlanilha.get(r.chave);
      if (!p) continue;
      // 1 segundo de folga: a planilha guarda a hora com menos precisao que o banco
      if (r.status_em && p.em <= quando(r.status_em) + 1000) continue;
      const atual = { status: (r.status ?? (r.enviadasPlanilha ? "mensagem" : "novo")) as Status, enviadas: r.enviadas ?? 0, motivo: r.motivo ?? "", anotacao: r.anotacao ?? "" };
      const novo = { status: textoParaStatus.get(p.situacao.trim().toLowerCase()) ?? atual.status, enviadas: p.enviadas, motivo: p.motivo, anotacao: p.anotacao };
      if (r.status && igual(novo, atual)) continue; // nada mudou de verdade
      const status_em = new Date(p.em).toISOString();
      const { error: e2 } = await admin.from("closer_leads").update({ ...novo, status_em, atualizado_por: null }).eq("org_id", org).eq("chave", r.chave);
      if (e2) throw new Error(e2.message);
      aplicados.push({ chave: r.chave, ...novo, status_em });
    }
  }
  return { total: leads.length, aplicados };
}

// Progresso do painel alterado depois de "desde" (para a reconciliacao do script)
export async function progressoDesde(desde: string | null) {
  const admin = createAdminClient();
  const org = await orgWeevo(admin);
  const valido = desde && !isNaN(quando(desde)) ? new Date(desde).toISOString() : null;
  return (await todasAsPaginas((de, ate) => {
    let q = admin.from("closer_leads").select("chave,status,enviadas,motivo,anotacao,status_em").eq("org_id", org).not("status_em", "is", null).not("status", "is", null);
    if (valido) q = q.gt("status_em", valido);
    return q.order("status_em").order("chave").range(de, ate);
  })) as ProgressoSync[];
}

// O Supabase devolve no maximo 1000 linhas por consulta
async function todasAsPaginas(pagina: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) {
  const saida: unknown[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await pagina(de, de + 999);
    if (error) throw new Error(error.message);
    saida.push(...(data ?? []));
    if ((data ?? []).length < 1000 || de > 20000) return saida;
  }
}

// Chama o Web App do Apps Script. Falha devolve a mensagem, nunca lanca erro.
export async function chamarAppsScript(corpo: Record<string, unknown>, ms = 15000): Promise<{ ok: boolean; erro?: string; [k: string]: unknown }> {
  const url = process.env.CLOSER_APPS_SCRIPT_URL, segredo = process.env.CLOSER_SYNC_SECRET;
  if (!url || !segredo) return { ok: false, erro: "Faltam CLOSER_APPS_SCRIPT_URL e CLOSER_SYNC_SECRET na Vercel." };
  try {
    // O Web App responde com um redirecionamento; o fetch segue sozinho
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ ...corpo, segredo }), signal: AbortSignal.timeout(ms), cache: "no-store" });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) return { ok: false, erro: `O Apps Script não respondeu direito (${r.status}).` };
    return j.ok ? j : { ok: false, erro: String(j.erro ?? "Erro no Apps Script.") };
  } catch (e) {
    return { ok: false, erro: e instanceof Error && e.name === "TimeoutError" ? "O Apps Script demorou demais." : "Não foi possível falar com o Apps Script." };
  }
}

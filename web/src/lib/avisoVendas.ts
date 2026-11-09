import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/supabase/config";
import { contaNoFaturamento, listarResultados, type Resultado } from "@/lib/resultados";

// Aviso no WhatsApp do Bruno quando o FATURAMENTO ganha uma venda de Imersao ou Plataforma.
// Usa a mesma conta da aba Resultados e da TV (listarResultados + contaNoFaturamento): so avisa o que entra na soma.
// Cada venda avisa uma vez so (tabela vendas_avisadas). A primeira rodada nao avisa nada: so anota o que ja existia,
// para o Bruno nao receber de uma vez todas as vendas antigas.
const PRODUTOS_AVISO = ["imersao", "plataforma"];
const DIAS_OLHADOS = 60;   // janela da conta (o CRM lanca vendas antigas de uma vez)
const MAX_POR_RODADA = 10; // trava de seguranca contra enxurrada de mensagens

const MARCADOR = "__inicio__"; // linha que mostra que a primeira rodada ja aconteceu
const hojeBR = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
const somaDias = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// Vendas que contam no faturamento, sao de imersao ou plataforma e ainda nao foram avisadas
export function vendasNovas(linhas: Resultado[], jaAvisadas: Set<string>): Resultado[] {
  return linhas.filter((r) => contaNoFaturamento(r) && PRODUTOS_AVISO.includes(r.produto ?? "") && !jaAvisadas.has(r.chave));
}

export type ResultadoAviso = { ok: boolean; primeiraRodada?: boolean; novas: number; enviadas: number; falhas: number; erro?: string };

export async function avisarVendasNovas(db: SupabaseClient, tokenWorker: string, fetchImpl: typeof fetch = fetch): Promise<ResultadoAviso> {
  const { data: org } = await db.from("organizacoes").select("id").eq("slug", "weevo").maybeSingle();
  if (!org) return { ok: false, novas: 0, enviadas: 0, falhas: 0, erro: "Empresa Weevo não encontrada." };
  const hoje = hojeBR();
  const { linhas, erro } = await listarResultados(db, org.id, somaDias(hoje, -DIAS_OLHADOS), hoje);
  if (erro) return { ok: false, novas: 0, enviadas: 0, falhas: 0, erro };

  const { data: avisadas, error: eAv } = await db.from("vendas_avisadas").select("chave").eq("org_id", org.id).limit(20000);
  if (eAv) return { ok: false, novas: 0, enviadas: 0, falhas: 0, erro: eAv.message };
  const chaves = new Set((avisadas ?? []).map((a) => a.chave as string));
  const novas = vendasNovas(linhas, chaves);

  // primeira rodada (sem a linha-marcador): so anota o que ja existe, sem mandar mensagem
  if (!chaves.has(MARCADOR)) {
    const { error } = await db.from("vendas_avisadas").insert([{ org_id: org.id, chave: MARCADOR, inicial: true }, ...novas.map((r) => ({ org_id: org.id, chave: r.chave, inicial: true }))]);
    return error ? { ok: false, novas: novas.length, enviadas: 0, falhas: 0, erro: error.message } : { ok: true, primeiraRodada: true, novas: novas.length, enviadas: 0, falhas: 0 };
  }
  if (!novas.length) return { ok: true, novas: 0, enviadas: 0, falhas: 0 };

  const ids = [...new Set(novas.map((r) => r.vendedorId).filter(Boolean))] as string[];
  const { data: perfis } = ids.length ? await db.from("profiles").select("id,nome").in("id", ids) : { data: [] };
  const nomes = new Map((perfis ?? []).map((p) => [p.id as string, p.nome as string]));

  let enviadas = 0, falhas = 0;
  for (const r of novas.slice(0, MAX_POR_RODADA)) {
    try {
      const resp = await fetchImpl(`${SUPABASE_URL}/functions/v1/worker/avisos/venda`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-worker-token": tokenWorker },
        body: JSON.stringify({ produto: r.produto, valor: r.valor, cliente: r.cliente, empresa: r.empresa, indicadoPor: r.indicadoPor ?? "", vendedor: r.vendedorId ? nomes.get(r.vendedorId) ?? "" : "" }),
        signal: AbortSignal.timeout(30000), cache: "no-store",
      });
      const j = await resp.json().catch(() => null);
      // so vale se o worker confirmou o envio ("enviado"): um worker antigo, sem esta rota, responde so { ok: true, servico }
      if (!resp.ok || !j?.ok || j.enviado !== true) { falhas++; continue; } // nao anota: tenta de novo na proxima rodada
      await db.from("vendas_avisadas").insert({ org_id: org.id, chave: r.chave });
      enviadas++;
    } catch { falhas++; }
  }
  return { ok: falhas === 0, novas: novas.length, enviadas, falhas };
}

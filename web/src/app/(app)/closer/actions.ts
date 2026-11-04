"use server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { exigirGestor, exigirPerfil } from "@/lib/auth";
import { gravarProgresso, modoLocal } from "@/lib/closer/dados";
import { chamarAppsScript } from "@/lib/closer/sync";
import { ORIENTACOES, STATUS, produtoSugerido, type Progresso } from "@/lib/closer/regras";
import { validarSugestao, type ResultadoSugestao } from "@/lib/closer/sugestao";
import type { Lead } from "@/lib/closer/planilha";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_URL } from "@/lib/supabase/config";

export async function salvarProgresso(chave: string, p: Progresso): Promise<string | null> {
  const perfil = await exigirPerfil();
  if (perfil.papel === "vendedor" && perfil.funcao !== "closer") return "Sem permissão.";
  if (!STATUS[p.status]) return "Situação inválida.";
  const novo: Progresso = { status: p.status, enviadas: Math.min(3, Math.max(0, Math.trunc(p.enviadas) || 0)), motivo: String(p.motivo ?? "").slice(0, 200), anotacao: String(p.anotacao ?? "").slice(0, 4000), status_em: new Date().toISOString() };
  // 1) banco primeiro, como sempre
  const erro = await gravarProgresso(chave, novo, perfil.id);
  // 2) depois a planilha, sem segurar a tela do closer. Se falhar, a reconciliacao do script (a cada 10 min) corrige.
  if (!erro && !modoLocal()) after(async () => {
    const r = await chamarAppsScript({ acao: "progresso", chave, ...novo, situacao: STATUS[novo.status].texto });
    if (!r.ok) console.warn(`Closer: planilha não atualizada agora (${r.erro}). A reconciliação corrige depois.`);
  });
  return erro;
}

// Pede ao Apps Script da planilha uma sincronizacao completa (abas -> sistema e progresso -> planilha).
// Mexe so em "dados" e no progresso mais novo: nada do closer e apagado.
export async function importarPlanilha(): Promise<{ erro?: string; total?: number }> {
  await exigirGestor();
  if (modoLocal()) return { erro: "Na cópia local os dados vêm de um arquivo. A atualização pela planilha funciona no sistema publicado." };
  const r = await chamarAppsScript({ acao: "sincronizar" }, 55000);
  if (!r.ok) return { erro: r.erro };
  revalidatePath("/closer");
  return { total: Number(r.total) || 0 };
}

// "Ler conversa": pede ao worker uma sugestao de preenchimento a partir das conversas de WhatsApp do lead. Nao grava nada.
// ATENCAO: o worker le as conversas com a chave do Supabase que ignora a RLS por vendedor. Quem decide quem pode pedir
// e esta acao: qualquer pessoa com acesso ao painel do Closer pode ler a conversa dos leads do painel.
export async function sugerirDoLead(chave: string): Promise<ResultadoSugestao> {
  const perfil = await exigirPerfil(); // fora do try: sem login, o redirect para /login precisa acontecer
  if (perfil.papel === "vendedor" && perfil.funcao !== "closer") return { erro: "Sem permissão." };
  try {
    if (modoLocal()) return { erro: "Na cópia local não dá para ler as conversas. Use o sistema publicado." };
    // o telefone vem do banco (a RLS limita aos leads do painel), nunca da tela
    const { data: linha } = await (await createClient()).from("closer_leads").select("dados").eq("chave", String(chave).slice(0, 200)).maybeSingle();
    const lead = linha?.dados as Lead | undefined;
    if (!lead) return { erro: "Lead não encontrado." };
    if (!lead.telefone) return { erro: "Este lead não tem telefone na planilha." };
    const { data: tk } = await createAdminClient().from("worker_token").select("token").eq("id", 1).maybeSingle();
    if (!tk?.token) return { erro: "O worker não está configurado." };
    const r = await fetch(`${SUPABASE_URL}/functions/v1/worker/closer/sugestao`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-token": tk.token },
      body: JSON.stringify({ telefone: lead.telefone, nome: lead.nome, produto: produtoSugerido(lead), orientacoes: Object.values(ORIENTACOES) }),
      signal: AbortSignal.timeout(55000),
      cache: "no-store",
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) return { erro: j?.erro && r.status !== 401 ? String(j.erro).slice(0, 160) : "Não foi possível ler a conversa agora." };
    if (!j.encontrou) return { encontrou: false };
    return { encontrou: true, mensagens: Number(j.mensagens) || 0, ultima_msg_em: j.ultima_msg_em ?? null, sugestao: validarSugestao(j.sugestao) };
  } catch (e) {
    return { erro: (e as Error)?.name === "TimeoutError" ? "A leitura demorou demais. Tente de novo." : "Não foi possível ler a conversa agora." };
  }
}

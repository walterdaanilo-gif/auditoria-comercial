"use server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { exigirGestor, exigirPerfil } from "@/lib/auth";
import { gravarProgresso, modoLocal } from "@/lib/closer/dados";
import { chamarAppsScript } from "@/lib/closer/sync";
import { STATUS, type Progresso } from "@/lib/closer/regras";

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

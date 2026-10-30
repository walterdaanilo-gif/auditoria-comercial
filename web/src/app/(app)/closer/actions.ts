"use server";
import { revalidatePath } from "next/cache";
import { empresas, exigirGestor, exigirPerfil } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { gravarProgresso, modoLocal } from "@/lib/closer/dados";
import { lerAbas } from "@/lib/closer/google";
import { montarLeads } from "@/lib/closer/planilha";
import { STATUS, type Progresso } from "@/lib/closer/regras";

export async function salvarProgresso(chave: string, p: Progresso): Promise<string | null> {
  const perfil = await exigirPerfil();
  if (perfil.papel === "vendedor" && perfil.funcao !== "closer") return "Sem permissão.";
  if (!STATUS[p.status]) return "Situação inválida.";
  return gravarProgresso(chave, { status: p.status, enviadas: Math.min(3, Math.max(0, Math.trunc(p.enviadas) || 0)), motivo: String(p.motivo ?? "").slice(0, 200), anotacao: String(p.anotacao ?? "").slice(0, 4000), status_em: new Date().toISOString() }, perfil.id);
}

// Traz a planilha para o banco. Mexe so em "dados": o progresso de cada lead continua como esta.
export async function importarPlanilha(): Promise<{ erro?: string; total?: number }> {
  const perfil = await exigirGestor();
  if (modoLocal()) return { erro: "Na cópia local os dados vêm de um arquivo. A atualização pela planilha funciona no sistema publicado." };
  try {
    const { atual } = await empresas(perfil);
    if (!atual) return { erro: "Nenhuma empresa aberta." };
    const { todos, participantes, atencao } = await lerAbas();
    const leads = montarLeads(todos, participantes, atencao);
    if (!leads.length) return { erro: "A planilha veio vazia. Nada foi alterado." };
    const agora = new Date().toISOString();
    const admin = createAdminClient();
    for (let i = 0; i < leads.length; i += 200) {
      const { error } = await admin.from("closer_leads").upsert(leads.slice(i, i + 200).map((l) => ({ org_id: atual.id, chave: l.chave, dados: l, importado_em: agora })), { onConflict: "org_id,chave" });
      if (error) return { erro: error.message };
    }
    revalidatePath("/closer");
    return { total: leads.length };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Não foi possível ler a planilha." };
  }
}

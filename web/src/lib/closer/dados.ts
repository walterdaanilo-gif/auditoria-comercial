import fs from "node:fs";
import path from "node:path";
import { createClient } from "@/lib/supabase/server";
import type { Lead } from "./planilha";
import { PROGRESSO_INICIAL, type LeadCloser, type Progresso } from "./regras";

// Copia local para ver o painel no computador sem tocar no banco. Fica em web/.local (fora do git) e so vale em desenvolvimento.
const pasta = path.join(process.cwd(), ".local");
const arqLeads = path.join(pasta, "closer-leads.json"), arqProg = path.join(pasta, "closer-progresso.json");
export const modoLocal = () => process.env.NODE_ENV === "development" && fs.existsSync(arqLeads);
const lerJson = <T,>(a: string, padrao: T): T => (fs.existsSync(a) ? (JSON.parse(fs.readFileSync(a, "utf8")) as T) : padrao);

export type ResultadoLeads = { leads: LeadCloser[]; erro: string | null };

export async function listarLeads(): Promise<ResultadoLeads> {
  if (modoLocal()) {
    const prog = lerJson<Record<string, Progresso>>(arqProg, {});
    return { leads: lerJson<Lead[]>(arqLeads, []).map((l) => ({ ...l, progresso: prog[l.chave] ?? PROGRESSO_INICIAL(l) })), erro: null };
  }
  const { data, error } = await (await createClient()).from("closer_leads").select("chave,dados,status,enviadas,motivo,anotacao,status_em").limit(5000);
  if (error) return { leads: [], erro: error.message };
  return {
    leads: (data ?? []).map((r: any) => ({ ...(r.dados as Lead), chave: r.chave, progresso: r.status ? { status: r.status, enviadas: r.enviadas ?? 0, motivo: r.motivo ?? "", anotacao: r.anotacao ?? "", status_em: r.status_em } : PROGRESSO_INICIAL(r.dados) })),
    erro: null,
  };
}

export async function gravarProgresso(chave: string, p: Progresso, autor: string): Promise<string | null> {
  if (modoLocal()) {
    const prog = lerJson<Record<string, Progresso>>(arqProg, {});
    fs.writeFileSync(arqProg, JSON.stringify({ ...prog, [chave]: p }, null, 1));
    return null;
  }
  // a RLS limita a empresa aberta e a quem pode usar o painel; as colunas da planilha nao podem ser alteradas por aqui
  const { error } = await (await createClient()).from("closer_leads").update({ status: p.status, enviadas: p.enviadas, motivo: p.motivo, anotacao: p.anotacao, status_em: p.status_em, atualizado_por: autor }).eq("chave", chave);
  return error?.message ?? null;
}

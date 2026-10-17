"use server";
import { revalidatePath } from "next/cache";
import { exigirGestor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { limpar, validar, type Estado } from "@/lib/configuracoes";

export type ResultadoSalvar = { ok: boolean; erros?: string[] };

const CAMPOS = ["auditoria_automatica", "escopo_conversas", "min_mensagens", "amostragem_pct", "so_com_proposta", "regras_criticas", "sla_primeira_resposta_min", "followup_sem_resposta_h", "followup_abandonada_d", "followup_limite_d", "horario_modo", "horario_empresa", "alerta_venda", "alerta_oportunidade", "alerta_formato", "instancia_envio_id", "resumo_ativo", "resumo_hora", "resumo_dias", "rubrica_modo", "venda_conta", "venda_nao_conta", "oportunidade_conta", "oportunidade_nao_conta", "meta_sdr_contatos", "meta_sdr_marcacoes", "meta_closer_reunioes", "meta_closer_vendas"] as const;

// Salvamento em lote: valida tudo, depois grava configuracao, listas, rubricas e funcao dos vendedores.
// Tabelas de configuracao passam pela RLS do gestor; perfis e numeros (escrita so de admin) usam a service role depois do exigirGestor.
export async function salvarConfiguracoes(bruto: Estado): Promise<ResultadoSalvar> {
  await exigirGestor();
  const e = limpar(bruto);
  const erros = validar(e);
  if (erros.length) return { ok: false, erros };

  const db = await createClient();
  const admin = createAdminClient();
  const falha = (msg: string, err: { message: string } | null) => (err ? { ok: false, erros: [`${msg}: ${err.message}`] } : null);

  const settings = Object.fromEntries(CAMPOS.map((k) => [k, e.settings[k]]));
  let f = falha("Configurações", (await db.from("audit_settings").update({ ...settings, atualizado_em: new Date().toISOString() }).eq("id", 1)).error);
  if (f) return f;

  // Rubricas: a funcao do banco recusa se os pesos ativos nao somarem 100
  const rubricas = e.settings.rubrica_modo === "personalizada" ? (["personalizada"] as const) : (["sdr", "closer"] as const);
  for (const r of rubricas) {
    f = falha(`Rubrica ${r}`, (await db.rpc("salvar_rubrica", { p_rubrica: r, p_criterios: e.rubricas[r] })).error);
    if (f) return f;
  }

  // Listas de telefones: apaga o que saiu, depois grava o que ficou (o limite de 3 alertas e checado no banco)
  for (const [tabela, lista] of [["numeros_ignorados", e.ignorados], ["telefones_alerta", e.alertas]] as const) {
    const del = lista.length ? db.from(tabela).delete().not("telefone", "in", `(${lista.join(",")})`) : db.from(tabela).delete().neq("telefone", "");
    f = falha(tabela === "numeros_ignorados" ? "Números ignorados" : "Telefones de alerta", (await del).error);
    if (!f && lista.length) f = falha(tabela, (await db.from(tabela).upsert(lista.map((telefone) => ({ telefone })), { onConflict: "telefone", ignoreDuplicates: true })).error);
    if (f) return f;
  }

  for (const v of e.vendedores) {
    f = falha(`Função de ${v.nome}`, (await admin.from("profiles").update({ funcao: v.funcao }).eq("id", v.id)).error);
    if (f) return f;
  }
  for (const n of e.numeros) {
    f = falha(`Horário de ${n.nome}`, (await admin.from("instancias_whatsapp").update({ horario: n.horario }).eq("id", n.id)).error);
    if (f) return f;
  }

  revalidatePath("/configuracoes");
  revalidatePath("/");
  return { ok: true };
}

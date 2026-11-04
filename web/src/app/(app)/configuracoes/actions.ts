"use server";
import { revalidatePath } from "next/cache";
import { exigirGestor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CAMPOS_META_FAT, limpar, validar, type Estado } from "@/lib/configuracoes";

export type ResultadoSalvar = { ok: boolean; erros?: string[] };

const CAMPOS = ["auditoria_automatica", "escopo_conversas", "min_mensagens", "amostragem_pct", "so_com_proposta", "regras_criticas", "sla_primeira_resposta_min", "followup_sem_resposta_h", "followup_abandonada_d", "followup_limite_d", "horario_modo", "horario_empresa", "alerta_venda", "alerta_oportunidade", "alerta_marcacao", "alerta_formato", "instancia_envio_id", "resumo_ativo", "resumo_hora", "resumo_dias", "rubrica_modo", "venda_conta", "venda_nao_conta", "oportunidade_conta", "oportunidade_nao_conta", "meta_sdr_conversas", "meta_sdr_marcacoes", "meta_closer_reunioes", "meta_closer_vendas", "auditoria_parada_min", "rodada_final_hora", "resumo_manha_hora", "alerta_followup", "followup_alerta_d", "historico_dias", "agenda_ativa", "agenda_duracao_min", "agenda_convidar", "agenda_meet", ...CAMPOS_META_FAT] as const;

// Salvamento em lote: valida tudo, depois grava configuracao, listas, rubricas e horario dos numeros.
// Tabelas de configuracao passam pela RLS do gestor; numeros (escrita so de admin) usam a service role depois do exigirGestor.
export async function salvarConfiguracoes(bruto: Estado): Promise<ResultadoSalvar> {
  await exigirGestor();
  const e = limpar(bruto);
  const erros = validar(e);
  if (erros.length) return { ok: false, erros };

  const db = await createClient();
  const admin = createAdminClient();
  const falha = (msg: string, err: { message: string } | null) => (err ? { ok: false, erros: [`${msg}: ${err.message}`] } : null);

  // empresa aberta agora (Weevo ou Carbone): cada uma tem a propria configuracao
  const { data: org } = await db.rpc("org_atual");
  if (!org) return { ok: false, erros: ["Não foi possível identificar a empresa aberta."] };
  const settings = Object.fromEntries(CAMPOS.map((k) => [k, e.settings[k]]));
  let f = falha("Configurações", (await db.from("audit_settings").update({ ...settings, atualizado_em: new Date().toISOString() }).eq("org_id", org)).error);
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
    if (!f && lista.length) f = falha(tabela, (await db.from(tabela).upsert(lista.map((telefone) => ({ org_id: org, telefone })), { onConflict: "org_id,telefone", ignoreDuplicates: true })).error);
    if (f) return f;
  }

  for (const n of e.numeros) {
    f = falha(`Horário de ${n.nome}`, (await admin.from("instancias_whatsapp").update({ horario: n.horario }).eq("id", n.id)).error);
    if (f) return f;
  }

  revalidatePath("/configuracoes");
  revalidatePath("/");
  revalidatePath("/apresentacao");
  return { ok: true };
}

// Desliga a Agenda Google: apaga o token guardado (o gestor pode reconectar quando quiser)
export async function desconectarAgenda(): Promise<void> {
  await exigirGestor();
  const { data: org } = await (await createClient()).rpc("org_atual");
  if (org) await createAdminClient().from("google_agenda").update({ email: null, refresh_token: null, conectado_em: null, erro: null }).eq("org_id", org);
  revalidatePath("/configuracoes");
}

// Foto do perfil do vendedor: guardada no Storage (pasta publica "fotos") e o endereco vai para profiles.foto_url
const TIPOS_FOTO: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export async function enviarFoto(fd: FormData): Promise<{ ok: boolean; url?: string; erro?: string }> {
  await exigirGestor();
  const id = String(fd.get("id") || "");
  const arq = fd.get("foto");
  if (!id || !(arq instanceof File) || !arq.size) return { ok: false, erro: "Escolha uma imagem." };
  if (!TIPOS_FOTO[arq.type]) return { ok: false, erro: "Use JPG, PNG ou WEBP." };
  if (arq.size > 2 * 1024 * 1024) return { ok: false, erro: "A foto pode ter no máximo 2 MB." };
  const admin = createAdminClient();
  const caminho = `perfis/${id}.${TIPOS_FOTO[arq.type]}`;
  const up = await admin.storage.from("fotos").upload(caminho, Buffer.from(await arq.arrayBuffer()), { contentType: arq.type, upsert: true });
  if (up.error) return { ok: false, erro: up.error.message };
  const url = `${admin.storage.from("fotos").getPublicUrl(caminho).data.publicUrl}?v=${Date.now()}`; // ?v= troca a foto na hora (sem cache)
  const { error } = await admin.from("profiles").update({ foto_url: url }).eq("id", id);
  if (error) return { ok: false, erro: error.message };
  revalidatePath("/configuracoes"); revalidatePath("/conversas");
  return { ok: true, url };
}
export async function removerFoto(id: string): Promise<void> {
  await exigirGestor();
  await createAdminClient().from("profiles").update({ foto_url: null }).eq("id", id);
  revalidatePath("/configuracoes"); revalidatePath("/conversas");
}

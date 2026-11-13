"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirGestor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { FORMAS, PRODUTOS } from "@/lib/resultados";

// Acoes da aba Resultados. Todas passam por exigirGestor() e pela RLS da tabela (so gestor/admin, so a empresa aberta).
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const texto = (fd: FormData, k: string, max = 120) => String(fd.get(k) ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const opcao = (v: string, lista: [string, string][]) => (lista.some(([k]) => k === v) ? v : null);

// "1.500,50", "1500.50" e "1.500" viram 1500.5, 1500.5 e 1500 (ponto seguido de 3 digitos = milhar). Vazio = null. Invalido = NaN.
function lerValor(s: string): number | null {
  let t = s.trim().replace(/[R$\s]/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n < 1e9 ? Math.round(n * 100) / 100 : NaN;
}

// Volta para a lista mantendo o periodo escolhido (so letras, numeros e = & _ - na consulta)
const voltar = (fd: FormData, tipo: "ok" | "erro", msg: string): never => {
  const q = String(fd.get("volta") ?? "").replace(/[^A-Za-z0-9=&_-]/g, "");
  redirect(`/resultados?${q ? q + "&" : ""}${tipo}=${encodeURIComponent(msg)}`);
};
const falhaBanco = (fd: FormData, msg: string): never => voltar(fd, "erro", /relation|does not exist|schema cache/i.test(msg) ? "A tabela de resultados ainda não existe no banco. Rode o SQL de Resultados no Supabase." : msg);

async function contexto(fd: FormData) {
  const perfil = await exigirGestor();
  const db = await createClient();
  const { data: org } = await db.rpc("org_atual");
  if (!org) voltar(fd, "erro", "Não foi possível identificar a empresa aberta.");
  return { perfil, db, org: org as string };
}
const vendedor = (fd: FormData) => { const v = String(fd.get("vendedor_id") ?? ""); return UUID.test(v) ? v : null; };

export async function criarVenda(fd: FormData): Promise<void> {
  const { perfil, db, org } = await contexto(fd);
  const data = String(fd.get("data") ?? ""), cliente = texto(fd, "cliente"), valor = lerValor(String(fd.get("valor") ?? ""));
  if (!DATA.test(data)) voltar(fd, "erro", "Escolha o dia da venda.");
  if (!cliente) voltar(fd, "erro", "Digite o nome do cliente.");
  if (valor === null || Number.isNaN(valor)) voltar(fd, "erro", "Digite o valor da venda (ex.: 1.500,00).");
  const { error } = await db.from("resultados_vendas").insert({
    org_id: org, data, vendedor_id: vendedor(fd), cliente, empresa: texto(fd, "empresa") || null,
    produto: opcao(String(fd.get("produto") ?? ""), PRODUTOS), forma_pagamento: opcao(String(fd.get("forma_pagamento") ?? ""), FORMAS),
    valor, criado_por: perfil.id,
  });
  if (error) falhaBanco(fd, error.message);
  revalidatePath("/resultados"); revalidatePath("/apresentacao");
  voltar(fd, "ok", "Venda adicionada. O faturamento da TV já conta ela.");
}

// Edita uma venda manual (pelo id) ou ajusta uma venda da IA (pela auditoria): campos em branco voltam a valer o que a IA leu
export async function salvarVenda(fd: FormData): Promise<void> {
  const { db, org } = await contexto(fd);
  const id = String(fd.get("id") ?? ""), auditoriaId = String(fd.get("auditoria_id") ?? "");
  const cliente = texto(fd, "cliente"), empresa = texto(fd, "empresa"), valor = lerValor(String(fd.get("valor") ?? ""));
  const forma = opcao(String(fd.get("forma_pagamento") ?? ""), FORMAS);
  if (Number.isNaN(valor)) voltar(fd, "erro", "Valor inválido (ex.: 1.500,00).");
  const agora = new Date().toISOString();
  if (UUID.test(auditoriaId)) {
    // venda da IA: guarda so o que foi mudado, no ajuste dela (cria ou atualiza)
    const campos = { cliente: cliente || null, empresa: empresa || null, forma_pagamento: forma, valor, atualizado_em: agora };
    const { data: ex, error: e1 } = await db.from("resultados_vendas").select("id").eq("auditoria_id", auditoriaId).maybeSingle();
    if (e1) falhaBanco(fd, e1.message);
    const data = String(fd.get("data") ?? "");
    const { error } = ex
      ? await db.from("resultados_vendas").update({ ...campos, excluida: false }).eq("id", ex.id)
      : await db.from("resultados_vendas").insert({ ...campos, org_id: org, auditoria_id: auditoriaId, data: DATA.test(data) ? data : agora.slice(0, 10), vendedor_id: vendedor(fd) });
    if (error) falhaBanco(fd, error.message);
  } else if (UUID.test(id)) {
    const data = String(fd.get("data") ?? "");
    if (!DATA.test(data)) voltar(fd, "erro", "Escolha o dia da venda.");
    if (!cliente) voltar(fd, "erro", "Digite o nome do cliente.");
    if (valor === null) voltar(fd, "erro", "Digite o valor da venda.");
    const { error } = await db.from("resultados_vendas").update({ data, vendedor_id: vendedor(fd), cliente, empresa: empresa || null, produto: opcao(String(fd.get("produto") ?? ""), PRODUTOS), forma_pagamento: forma, valor, atualizado_em: agora }).eq("id", id).is("auditoria_id", null);
    if (error) falhaBanco(fd, error.message);
  } else voltar(fd, "erro", "Venda não encontrada.");
  revalidatePath("/resultados"); revalidatePath("/apresentacao");
  voltar(fd, "ok", "Venda salva.");
}

// Manual: apaga. Da IA: tira do faturamento (a venda continua na lista, riscada, e pode voltar)
export async function removerVenda(fd: FormData): Promise<void> {
  const { db, org } = await contexto(fd);
  const id = String(fd.get("id") ?? ""), auditoriaId = String(fd.get("auditoria_id") ?? "");
  if (UUID.test(auditoriaId)) {
    const { data: ex, error: e1 } = await db.from("resultados_vendas").select("id").eq("auditoria_id", auditoriaId).maybeSingle();
    if (e1) falhaBanco(fd, e1.message);
    const data = String(fd.get("data") ?? "");
    const { error } = ex
      ? await db.from("resultados_vendas").update({ excluida: true, atualizado_em: new Date().toISOString() }).eq("id", ex.id)
      : await db.from("resultados_vendas").insert({ org_id: org, auditoria_id: auditoriaId, data: DATA.test(data) ? data : new Date().toISOString().slice(0, 10), vendedor_id: vendedor(fd), excluida: true });
    if (error) falhaBanco(fd, error.message);
  } else if (UUID.test(id)) {
    const { error } = await db.from("resultados_vendas").delete().eq("id", id).is("auditoria_id", null);
    if (error) falhaBanco(fd, error.message);
  } else voltar(fd, "erro", "Venda não encontrada.");
  revalidatePath("/resultados"); revalidatePath("/apresentacao");
  voltar(fd, "ok", UUID.test(auditoriaId) ? "Venda tirada do faturamento." : "Venda apagada.");
}

// Venda da IA: desfaz os ajustes e volta ao faturamento com o que a IA leu
export async function restaurarVenda(fd: FormData): Promise<void> {
  const { db } = await contexto(fd);
  const auditoriaId = String(fd.get("auditoria_id") ?? "");
  if (!UUID.test(auditoriaId)) voltar(fd, "erro", "Venda não encontrada.");
  const { error } = await db.from("resultados_vendas").delete().eq("auditoria_id", auditoriaId);
  if (error) falhaBanco(fd, error.message);
  revalidatePath("/resultados"); revalidatePath("/apresentacao");
  voltar(fd, "ok", "Venda restaurada: vale de novo o que a IA leu.");
}

// Botao "Atualizar do CRM": dispara agora a mesma busca que roda sozinha a cada 3 min (Edge Function crm-vendas).
// O token da busca fica no banco e so o servidor usa (via crm_disparar_vendas); a tela recebe so o numero do pedido.
export async function buscarCrmAgora(): Promise<{ id?: number; erro?: string }> {
  await exigirGestor();
  const { data, error } = await createAdminClient().rpc("crm_disparar_vendas");
  if (error || data == null) return { erro: "Não foi possível pedir a busca ao CRM agora." };
  return { id: Number(data) };
}

// A busca disparada ja terminou? (pulou = outra busca ja estava rodando; ela termina em seguida)
export async function statusBuscaCrm(id: number): Promise<{ pronto: boolean; ok?: boolean; pulou?: boolean }> {
  await exigirGestor();
  if (!Number.isInteger(id) || id <= 0) return { pronto: true, ok: false };
  const { data } = await createAdminClient().rpc("crm_resposta_disparo", { p_id: id });
  const r = (Array.isArray(data) ? data[0] : data) as { status_code: number | null; pulou: boolean } | undefined;
  if (!r) return { pronto: false };
  return { pronto: true, ok: r.status_code === 200, pulou: !!r.pulou };
}

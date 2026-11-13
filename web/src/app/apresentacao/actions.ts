"use server";
import { exigirPerfil } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// Botao "Atualizar do CRM" da apresentacao: dispara agora a mesma busca que roda sozinha a cada 3 min (Edge Function
// crm-vendas). O token da busca fica no banco (crm_disparar_vendas); a tela recebe so o numero do pedido.
// Quem ve a apresentacao pode pedir: a busca so le o CRM e grava no banco, nao mostra nada de outra pessoa.
export async function buscarCrmAgora(): Promise<{ id?: number; erro?: string }> {
  await exigirPerfil();
  const { data, error } = await createAdminClient().rpc("crm_disparar_vendas");
  if (error || data == null) return { erro: "Não foi possível pedir a busca ao CRM agora." };
  return { id: Number(data) };
}

// A busca disparada ja terminou? (pulou = outra busca ja estava rodando; ela termina em seguida)
export async function statusBuscaCrm(id: number): Promise<{ pronto: boolean; ok?: boolean; pulou?: boolean }> {
  await exigirPerfil();
  if (!Number.isInteger(id) || id <= 0) return { pronto: true, ok: false };
  const { data } = await createAdminClient().rpc("crm_resposta_disparo", { p_id: id });
  const r = (Array.isArray(data) ? data[0] : data) as { status_code: number | null; pulou: boolean } | undefined;
  if (!r) return { pronto: false };
  return { pronto: true, ok: r.status_code === 200, pulou: !!r.pulou };
}

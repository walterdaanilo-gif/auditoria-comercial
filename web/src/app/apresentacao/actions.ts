"use server";
import { exigirPerfil } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// Botao "Atualizar" da apresentacao: dispara agora TODAS as rotinas que alimentam o painel, as mesmas que rodam sozinhas por tempo:
// vendas do CRM (crm-vendas), funil/etapas do CRM (crm-sync) e o worker (rapido = WhatsApp e audios, ciclo = auditoria e importacao
// de conversas, crm = follow-ups e ligacoes). Os tokens ficam no banco (funcoes security definer); a tela recebe so os numeros dos pedidos.
// Quem ve a apresentacao pode pedir: as rotinas so leem as fontes e gravam no banco, nao mostram nada de outra pessoa.
export async function atualizarTudoAgora(): Promise<{ ids?: number[]; erro?: string }> {
  await exigirPerfil();
  const db = createAdminClient();
  const pedidos = await Promise.all([
    db.rpc("crm_disparar_vendas"), db.rpc("crm_disparar_sync"),
    db.rpc("worker_disparar", { p_tarefa: "rapido" }), db.rpc("worker_disparar", { p_tarefa: "ciclo" }), db.rpc("worker_disparar", { p_tarefa: "crm" }),
  ]);
  const ids = pedidos.filter((r) => !r.error && r.data != null).map((r) => Number(r.data));
  if (!ids.length) return { erro: "Não foi possível pedir a atualização agora." };
  return { ids };
}

// Quantas das rotinas disparadas ja responderam (pulou = ja havia uma igual rodando, que termina em seguida)
export async function statusAtualizacao(ids: number[]): Promise<{ prontos: number; total: number; falhas: number }> {
  await exigirPerfil();
  const lista = (Array.isArray(ids) ? ids : []).filter((i) => Number.isInteger(i) && i > 0).slice(0, 10);
  const db = createAdminClient();
  let prontos = 0, falhas = 0;
  await Promise.all(lista.map(async (id) => {
    const { data } = await db.rpc("crm_resposta_disparo", { p_id: id });
    const r = (Array.isArray(data) ? data[0] : data) as { status_code: number | null; pulou: boolean } | undefined;
    if (!r) return;
    prontos++;
    if (!(r.status_code === 200 || r.pulou)) falhas++;
  }));
  return { prontos, total: lista.length, falhas };
}

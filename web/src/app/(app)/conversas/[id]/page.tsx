import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { exigirGestor } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import AutoRefresh from "@/components/AutoRefresh";
import { exigirPerfil } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { corDuracao, corNota, duracao, fmtData, fmtHora, nota, telefone, um } from "@/lib/format";
import { CRITERIOS, GATILHOS, type Auditoria, type Mensagem } from "@/lib/types";

export const dynamic = "force-dynamic";

// Pede ao worker para auditar esta conversa na proxima rodada (passa por cima dos filtros das Configuracoes)
async function auditarAgora(fd: FormData) {
  "use server";
  await exigirGestor();
  const id = String(fd.get("id") || "");
  await createAdminClient().from("conversas").update({ auditar_agora: true }).eq("id", id);
  revalidatePath(`/conversas/${id}`);
}
const OPORT: Record<string, string> = { interesse_workshop: "interesse no workshop", interesse_imersao: "interesse na imersão", reuniao_imersao: "reunião de imersão marcada", reuniao_implementacao: "reunião de implementação marcada" };
const brl = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default async function ConversaDetalhe({ params: paramsP }: { params: Promise<{ id: string }> }) {
  const params = await paramsP;
  const perfil = await exigirPerfil();
  const supabase = await createClient();
  const { data: conversa } = await supabase.from("conversas").select("*, profiles(nome), auditorias(*)").eq("id", params.id).maybeSingle();
  if (!conversa) notFound(); // a RLS tambem esconde conversas de outros vendedores
  const { data: msgs } = await supabase.from("mensagens").select("id,remetente,texto,tipo,transcricao,enviada_em").eq("conversa_id", params.id).order("enviada_em");
  const a = um<Auditoria>(conversa.auditorias as any);
  const respondeu = (msgs ?? []).some((m: any) => m.remetente === "vendedor") && (msgs ?? []).some((m: any) => m.remetente === "cliente");
  const vendedor = um<{ nome: string }>(conversa.profiles as any)?.nome ?? "Vendedor";

  return (
    <div className="space-y-4">
      <AutoRefresh segundos={60} />
      <div><Link href="/conversas" className="text-sm text-brand">← Conversas</Link>
        <h1 className="page-title">{conversa.contato_nome || telefone(conversa.contato)} <span className="text-sm font-normal text-mute">· {vendedor} · {fmtData(conversa.data)}</span>{conversa.canal === "importada" && <span className="chip ml-2 align-middle border-line text-sm font-normal text-mute">importada</span>}</h1></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="label mb-2">Conversa</div>
          <div className="flex max-h-[70vh] flex-col gap-2 overflow-auto">
            {((msgs ?? []) as Mensagem[]).map((m) => (
              <div key={m.id} className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm ${m.remetente === "vendedor" ? "self-end bg-side-active border border-side-edge" : "self-start bg-track"}`}>
                {m.tipo === "audio" ? <><span className="text-mute">🎙 áudio</span>{m.transcricao ? `: ${m.transcricao}` : " (transcrevendo...)"}</> : m.texto || `[${m.tipo}]`}
                <div className="mt-0.5 text-[11px] text-mute">{m.remetente === "vendedor" ? vendedor : "Cliente"} · {fmtHora(m.enviada_em)}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="label">Auditoria{a?.manual && <span className="ml-2 normal-case tracking-normal">· feita pelo Auditar agora</span>}</div>
            {perfil.papel !== "vendedor" && (conversa.auditar_agora
              ? <span className="text-xs text-warn">Na fila: o Auditor roda em até 5 minutos</span>
              : <form action={auditarAgora}><input type="hidden" name="id" value={conversa.id} /><button className="btn-ghost !py-1 text-xs">{a ? "Auditar de novo" : "Auditar agora"}</button></form>)}
          </div>
          {a ? (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2"><span className={`text-4xl font-bold ${corNota(a.nota_geral)}`}>{nota(a.nota_geral)}</span>
                {a.qualidade && <span className={`chip ${a.qualidade === "boa" ? "border-ok text-ok" : a.qualidade === "regular" ? "border-warn text-warn" : "border-bad text-bad"}`}>{a.qualidade}</span>}
                {a.agendou && <span className="chip border-ok text-ok">agendou</span>}{a.efetiva && <span className="chip border-ok text-ok">conversa efetiva</span>}
                {a.so_bot && <span className="chip border-warn text-warn">conversa só de bot (sem nota)</span>}</div>
              {a.venda && <div className="rounded-xl border border-ok/40 bg-ok/10 p-3"><b className="text-ok">💰 Venda de {a.venda_tipo === "imersao" ? "imersão" : "workshop"}</b>
                <span className="ml-2">{a.venda_cupom ? `cupom de convite · ${brl(0)}` : a.venda_valor != null ? brl(a.venda_valor) : "valor não informado"}</span>
                {a.venda_evidencia && <p className="mt-1 text-xs text-mute">{a.venda_evidencia}</p>}</div>}
              {a.oportunidade && <div className="rounded-xl border border-brand/40 bg-brand/10 p-3"><b className="text-brand">🎯 Oportunidade</b><span className="ml-2">{OPORT[a.oportunidade_tipo ?? ""] ?? ""}</span>
                {a.oportunidade_evidencia && <p className="mt-1 text-xs text-mute">{a.oportunidade_evidencia}</p>}</div>}
              {a.critico && <div className="rounded-xl border border-bad/40 bg-bad/10 p-3"><b className="text-bad">⚠ Crítico</b><span className="ml-2">{a.critico_motivo}</span></div>}
              <p>{a.resumo}</p>
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-line p-3">
                <div><div className="label">1ª resposta</div><b className={`text-xl ${corDuracao(a.primeira_resposta_seg)}`}>{duracao(a.primeira_resposta_seg)}</b></div>
                <div><div className="label">Tempo médio</div><b className={`text-xl ${corDuracao(a.tempo_medio_resposta_seg)}`}>{duracao(a.tempo_medio_resposta_seg)}</b>{a.respostas_sdr ? <span className="ml-1 text-xs text-mute">em {a.respostas_sdr} resposta{a.respostas_sdr > 1 ? "s" : ""}</span> : null}</div>
              </div>
              <div><div className="label">Pontos fortes</div><p>{a.pontos_fortes || "—"}</p></div>
              <div><div className="label">O que melhorar</div><p>{a.pontos_melhoria || "—"}</p></div>
              <div><div className="label">Objeções</div><p>{a.objecoes || "—"}</p></div>
              <div><div className="label mb-1">Notas por critério{a.rubrica && <span className="normal-case tracking-normal"> · rubrica {a.rubrica === "closer" ? "do Closer" : a.rubrica === "sdr" ? "do SDR" : "personalizada"}</span>}</div>
                {a.notas_1a5?.length
                  ? a.notas_1a5.map((c) => (
                    <div key={c.chave} className="border-b border-line/60 py-1.5 last:border-0">
                      <div className="flex justify-between gap-3"><span>{c.nome} <span className="text-xs text-mute">· peso {c.peso}%</span></span><b className={c.nota >= 4 ? "text-ok" : c.nota >= 3 ? "text-warn" : "text-bad"}>{c.nota}/5</b></div>
                      {c.justificativa && <p className="text-xs text-mute">{c.justificativa}</p>}
                    </div>))
                  : Object.entries(CRITERIOS).map(([k, t]) => <div key={k} className="flex justify-between py-0.5"><span>{t}</span><b className={corNota(a.notas?.[k])}>{nota(a.notas?.[k])}</b></div>)}</div>
              <div><div className="label mb-1">Gatilhos</div>
                {Object.entries(GATILHOS).map(([k, t]) => <div key={k} className="flex justify-between py-0.5"><span>{t}</span><span className={a.gatilhos?.[k] ? "text-ok" : "text-mute"}>{a.gatilhos?.[k] ? "usou" : "não"}</span></div>)}</div>
            </div>
          ) : <p className="page-sub">{!respondeu ? "Sem auditoria: o lead ainda não respondeu. Só conversas com resposta do lead recebem nota." : conversa.canal === "importada" ? "Conversa importada. O worker dá a nota em até 5 minutos; esta tela atualiza sozinha." : "O lead respondeu. A nota sai quando a conversa fica parada (padrão 2h) ou na rodada final do dia; esta tela atualiza sozinha."}</p>}
        </div>
      </div>
    </div>
  );
}

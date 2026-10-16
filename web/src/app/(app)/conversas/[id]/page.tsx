import Link from "next/link";
import { notFound } from "next/navigation";
import AutoRefresh from "@/components/AutoRefresh";
import { exigirPerfil } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { corNota, fmtData, fmtHora, nota, telefone, um } from "@/lib/format";
import { CRITERIOS, GATILHOS, type Auditoria, type Mensagem } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ConversaDetalhe({ params: paramsP }: { params: Promise<{ id: string }> }) {
  const params = await paramsP;
  await exigirPerfil();
  const supabase = await createClient();
  const { data: conversa } = await supabase.from("conversas").select("*, profiles(nome), auditorias(*)").eq("id", params.id).maybeSingle();
  if (!conversa) notFound(); // a RLS tambem esconde conversas de outros vendedores
  const { data: msgs } = await supabase.from("mensagens").select("id,remetente,texto,tipo,transcricao,enviada_em").eq("conversa_id", params.id).order("enviada_em");
  const a = um<Auditoria>(conversa.auditorias as any);
  const vendedor = um<{ nome: string }>(conversa.profiles as any)?.nome ?? "Vendedor";

  return (
    <div className="space-y-4">
      <AutoRefresh segundos={30} />
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
          <div className="label mb-2">Auditoria</div>
          {a ? (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2"><span className={`text-4xl font-bold ${corNota(a.nota_geral)}`}>{nota(a.nota_geral)}</span>
                {a.qualidade && <span className={`chip ${a.qualidade === "boa" ? "border-ok text-ok" : a.qualidade === "regular" ? "border-warn text-warn" : "border-bad text-bad"}`}>{a.qualidade}</span>}
                {a.agendou && <span className="chip border-ok text-ok">agendou</span>}{a.efetiva && <span className="chip border-ok text-ok">conversa efetiva</span>}</div>
              <p>{a.resumo}</p>
              <div><div className="label">Pontos fortes</div><p>{a.pontos_fortes || "—"}</p></div>
              <div><div className="label">O que melhorar</div><p>{a.pontos_melhoria || "—"}</p></div>
              <div><div className="label">Objeções</div><p>{a.objecoes || "—"}</p></div>
              <div><div className="label mb-1">Notas por critério</div>
                {Object.entries(CRITERIOS).map(([k, t]) => <div key={k} className="flex justify-between py-0.5"><span>{t}</span><b className={corNota(a.notas?.[k])}>{nota(a.notas?.[k])}</b></div>)}</div>
              <div><div className="label mb-1">Gatilhos</div>
                {Object.entries(GATILHOS).map(([k, t]) => <div key={k} className="flex justify-between py-0.5"><span>{t}</span><span className={a.gatilhos?.[k] ? "text-ok" : "text-mute"}>{a.gatilhos?.[k] ? "usou" : "não"}</span></div>)}</div>
            </div>
          ) : <p className="page-sub">{conversa.canal === "importada" ? "Conversa importada. O worker dá a nota em até 5 minutos; esta tela atualiza sozinha." : "Ainda não auditada. Entra na fila depois de alguns minutos sem novas mensagens."}</p>}
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import AutoRefresh from "@/components/AutoRefresh";
import { exigirPerfil } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { corNota, duracao, fmtDataHora, nota, telefone, um } from "@/lib/format";
import UploadLigacao from "./UploadLigacao";

export const dynamic = "force-dynamic";

const FILTROS = [["atendidas", "Atendidas"], ["nao", "Não atendidas"], ["todas", "Todas"]] as const;

export default async function Ligacoes({ searchParams: spP }: { searchParams: Promise<{ f?: string }> }) {
  const sp = await spP;
  const f = FILTROS.some(([k]) => k === sp.f) ? sp.f! : "atendidas";
  const perfil = await exigirPerfil();
  const supabase = await createClient();
  let q = supabase.from("ligacoes").select("*, auditorias(nota_geral,qualidade,agendou,resumo,pontos_fortes,pontos_melhoria)").order("iniciada_em", { ascending: false }).limit(200);
  if (f === "atendidas") q = q.eq("atendida", true);
  if (f === "nao") q = q.eq("atendida", false);
  const [{ data }, { data: perfis }] = await Promise.all([
    q,
    supabase.from("profiles").select("id,nome").eq("ativo", true).order("nome"), // vendedor so recebe o proprio (RLS)
  ]);
  const nomes = new Map<string, string>((perfis ?? []).map((x: any) => [x.id, x.nome]));
  const caminhos = (data ?? []).map((l: any) => l.audio_url).filter(Boolean) as string[];
  const urls = new Map<string, string>();
  if (caminhos.length) {
    const { data: signed } = await supabase.storage.from("audios").createSignedUrls(caminhos, 3600);
    (signed ?? []).forEach((s) => { if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl); });
  }

  return (
    <div className="space-y-4">
      <AutoRefresh segundos={60} />
      <div><h1 className="page-title">Ligações</h1>
        <p className="page-sub">As ligações de WhatsApp dos números conectados entram sozinhas (quem ligou, se atendeu e quanto durou). O WhatsApp não grava o áudio: para a IA auditar uma ligação, envie a gravação abaixo.</p></div>
      <UploadLigacao vendedores={(perfis ?? []) as { id: string; nome: string }[]} meuId={perfil.id} />
      <div className="flex gap-2">{FILTROS.map(([k, t]) => <Link key={k} href={`/ligacoes?f=${k}`} className={`chip !px-3 !py-1 text-sm ${f === k ? "chip-on" : "border-line text-mute hover:text-ink"}`}>{t}</Link>)}</div>
      <div className="card overflow-x-auto">
        <table className="w-full"><thead><tr><th className="th">Quando</th><th className="th">Vendedor</th><th className="th">Contato</th><th className="th">Ligação</th><th className="th">Nota</th><th className="th">Status</th><th className="th">Detalhes</th></tr></thead>
          <tbody>
            {(data ?? []).map((l: any) => {
              const a = um<any>(l.auditorias);
              return (
                <tr key={l.id}>
                  <td className="td text-mute">{fmtDataHora(l.iniciada_em)}</td>
                  <td className="td">{nomes.get(l.vendedor_id) ?? "—"}</td>
                  <td className="td">{/^\d{10,13}$/.test(l.contato) ? telefone(l.contato) : l.contato}</td>
                  <td className="td whitespace-nowrap">
                    <span className="flex items-center gap-1.5">
                      {l.origem === "whatsapp" ? (l.direcao === "entrada" ? <ArrowDownLeft size={15} className="text-mute" aria-label="Recebida" /> : <ArrowUpRight size={15} className="text-mute" aria-label="Feita" />) : null}
                      {l.atendida ? <span className="font-semibold text-ok">Atendida</span> : <span className="text-bad">{l.resultado === "recusada" ? "Recusada" : "Não atendida"}</span>}
                      {l.atendida && l.duracao_seg ? <span className="text-mute">· {duracao(l.duracao_seg)}</span> : null}
                    </span>
                    <span className="text-xs text-mute">{l.origem === "whatsapp" ? `WhatsApp · ${l.direcao === "entrada" ? "recebida" : "feita"}` : "Gravação enviada"}</span>
                  </td>
                  <td className={`td font-bold ${corNota(a?.nota_geral)}`}>{nota(a?.nota_geral)}</td>
                  <td className="td">{l.origem === "whatsapp" && !l.audio_url ? <span className="text-mute">sem gravação</span> : a ? <span className={`chip ${a.qualidade === "boa" ? "border-ok text-ok" : a.qualidade === "regular" ? "border-warn text-warn" : "border-bad text-bad"}`}>{a.qualidade}</span> : l.transcricao ? <span className="text-mute">aguardando auditoria</span> : <span className="text-mute">transcrevendo...</span>}</td>
                  <td className="td">
                    <details><summary className="cursor-pointer text-brand">abrir</summary>
                      <div className="mt-2 max-w-xl space-y-2 text-sm">
                        {l.audio_url && urls.get(l.audio_url) && <audio controls src={urls.get(l.audio_url)} className="w-full" />}
                        {a?.resumo && <p>{a.resumo}</p>}
                        {a?.pontos_melhoria && <p><span className="label">Melhorar: </span>{a.pontos_melhoria}</p>}
                        {l.transcricao && <p className="whitespace-pre-wrap text-mute">{l.transcricao}</p>}
                      </div></details>
                  </td>
                </tr>
              );
            })}
            {!data?.length && <tr><td className="td text-mute" colSpan={7}>Nenhuma ligação {f === "atendidas" ? "atendida " : f === "nao" ? "não atendida " : ""}ainda.</td></tr>}
          </tbody></table>
      </div>
    </div>
  );
}

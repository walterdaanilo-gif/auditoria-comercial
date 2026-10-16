import AutoRefresh from "@/components/AutoRefresh";
import { exigirPerfil } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { corNota, fmtDataHora, nota, um } from "@/lib/format";
import UploadLigacao from "./UploadLigacao";

export const dynamic = "force-dynamic";

export default async function Ligacoes() {
  const perfil = await exigirPerfil();
  const supabase = await createClient();
  const [{ data }, { data: perfis }] = await Promise.all([
    supabase.from("ligacoes").select("*, auditorias(nota_geral,qualidade,agendou,resumo,pontos_fortes,pontos_melhoria)").order("iniciada_em", { ascending: false }).limit(100),
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
      <AutoRefresh segundos={30} />
      <div><h1 className="text-xl font-bold">Ligações</h1>
        <p className="text-sm text-mute">O WhatsApp não grava ligações. Envie aqui a gravação (mp3, m4a, wav, ogg) e o sistema transcreve e audita.</p></div>
      <UploadLigacao vendedores={(perfis ?? []) as { id: string; nome: string }[]} meuId={perfil.id} />
      <div className="card overflow-x-auto">
        <table className="w-full"><thead><tr><th className="th">Quando</th><th className="th">Vendedor</th><th className="th">Contato</th><th className="th">Nota</th><th className="th">Status</th><th className="th">Detalhes</th></tr></thead>
          <tbody>
            {(data ?? []).map((l: any) => {
              const a = um<any>(l.auditorias);
              return (
                <tr key={l.id}>
                  <td className="td text-mute">{fmtDataHora(l.iniciada_em)}</td>
                  <td className="td">{nomes.get(l.vendedor_id) ?? "—"}</td>
                  <td className="td">{l.contato}</td>
                  <td className={`td font-bold ${corNota(a?.nota_geral)}`}>{nota(a?.nota_geral)}</td>
                  <td className="td">{a ? <span className={`chip ${a.qualidade === "boa" ? "border-ok text-ok" : a.qualidade === "regular" ? "border-warn text-warn" : "border-bad text-bad"}`}>{a.qualidade}</span> : l.transcricao ? <span className="text-mute">aguardando auditoria</span> : <span className="text-mute">transcrevendo...</span>}</td>
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
            {!data?.length && <tr><td className="td text-mute" colSpan={6}>Nenhuma ligação ainda.</td></tr>}
          </tbody></table>
      </div>
    </div>
  );
}

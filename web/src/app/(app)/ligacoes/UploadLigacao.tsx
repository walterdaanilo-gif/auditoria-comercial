"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Vend = { id: string; nome: string };

// Envia a gravacao para o bucket privado 'audios' (pasta do vendedor) e registra a ligacao.
// O worker transcreve e audita sozinho.
export default function UploadLigacao({ vendedores, meuId }: { vendedores: Vend[]; meuId: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const arquivo = fd.get("arquivo") as File;
    if (!arquivo || !arquivo.size) return setMsg({ ok: false, t: "Escolha o arquivo de áudio." });
    if (arquivo.size > 50 * 1024 * 1024) return setMsg({ ok: false, t: "Arquivo grande demais (máximo 50 MB)." });
    const vendedorId = String(fd.get("vendedor") || meuId);
    const contato = String(fd.get("contato") || "").trim();
    const duracao = Number(fd.get("duracao") || 0) || null;
    if (!contato) return setMsg({ ok: false, t: "Informe o contato (nome ou telefone)." });

    setEnviando(true); setMsg(null);
    const supabase = createClient();
    const ext = (arquivo.name.split(".").pop() || "mp3").toLowerCase().replace(/[^a-z0-9]/g, "");
    const caminho = `${vendedorId}/ligacoes/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from("audios").upload(caminho, arquivo, { contentType: arquivo.type || "audio/mpeg" });
    if (up.error) { setEnviando(false); return setMsg({ ok: false, t: "Falha no envio: " + up.error.message }); }
    const ins = await supabase.from("ligacoes").insert({ vendedor_id: vendedorId, contato, duracao_seg: duracao, audio_url: caminho, origem: "manual" });
    setEnviando(false);
    if (ins.error) return setMsg({ ok: false, t: "Falha ao registrar: " + ins.error.message });
    form.reset(); setMsg({ ok: true, t: "Enviada. A transcrição e a nota aparecem em alguns minutos." }); router.refresh();
  }

  return (
    <form onSubmit={enviar} className="card grid gap-3 md:grid-cols-5">
      {vendedores.length > 1 && <div><label className="label">Vendedor</label><select name="vendedor" defaultValue={meuId} className="input">{vendedores.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}</select></div>}
      <div><label className="label">Contato</label><input name="contato" className="input" placeholder="Nome ou telefone" required /></div>
      <div><label className="label">Duração (seg, opcional)</label><input name="duracao" type="number" min={0} className="input" /></div>
      <div><label className="label">Gravação</label><input name="arquivo" type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.opus,.aac" className="input" required /></div>
      <div className="flex items-end"><button className="btn" disabled={enviando}>{enviando ? "Enviando..." : "Enviar ligação"}</button></div>
      {msg && <p className={`text-sm md:col-span-5 ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.t}</p>}
    </form>
  );
}

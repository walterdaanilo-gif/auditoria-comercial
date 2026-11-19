"use client";
import { useState, useTransition } from "react";
import { enviarFoto, removerFoto } from "@/app/(app)/configuracoes/actions";

// Foto do perfil (clique no circulo para trocar). Usada em Configuracoes > Equipe e em Usuarios.
export default function FotoVendedor({ v }: { v: { id: string; nome: string; foto_url?: string | null } }) {
  const [url, setUrl] = useState(v.foto_url ?? null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, start] = useTransition();
  const escolher = (arq: File | undefined) => {
    if (!arq) return;
    if (arq.size > 2 * 1024 * 1024) { setErro("Máximo 2 MB"); return; }
    const fd = new FormData(); fd.set("id", v.id); fd.set("foto", arq);
    start(async () => { const r = await enviarFoto(fd); if (r.ok) { setUrl(r.url ?? null); setErro(null); } else setErro(r.erro ?? "Não foi possível enviar"); });
  };
  return (
    <div className="flex items-center gap-2">
      <label className="group relative h-12 w-12 shrink-0 cursor-pointer overflow-hidden rounded-full border border-line bg-track" title={url ? "Trocar a foto" : "Adicionar foto"}>
        {url ? <img src={url} alt={`Foto de ${v.nome}`} className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center text-lg font-extrabold text-mute">{v.nome.slice(0, 1).toUpperCase()}</span>}
        <span className={`absolute inset-0 flex items-center justify-center bg-black/55 text-[10px] font-semibold text-white transition ${enviando ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>{enviando ? "Enviando" : url ? "Trocar" : "Foto"}</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={enviando} onChange={(ev) => { escolher(ev.target.files?.[0]); ev.target.value = ""; }} />
      </label>
      <div className="flex flex-col text-xs">
        {!url && !erro && <span className="text-mute">Adicionar foto</span>}
        {url && <button type="button" className="text-left text-mute hover:text-bad" onClick={() => start(async () => { await removerFoto(v.id); setUrl(null); })}>Remover foto</button>}
        {erro && <span className="text-bad">{erro}</span>}
      </div>
    </div>
  );
}

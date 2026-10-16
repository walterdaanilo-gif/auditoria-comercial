"use client";
import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { FileUp } from "lucide-react";
import { lerExportacao } from "@/lib/importarWhatsapp";
import { importarConversa, type Resultado } from "./actions";

function Botao({ pronto }: { pronto: boolean }) {
  const { pending } = useFormStatus();
  return <button className="btn" disabled={pending || !pronto}>{pending ? "Importando..." : "Importar e auditar"}</button>;
}

export default function ImportarForm({ vendedores }: { vendedores: { id: string; nome: string }[] }) {
  const [res, action] = useActionState<Resultado, FormData>(importarConversa, null);
  const [texto, setTexto] = useState("");
  const [autor, setAutor] = useState("");
  const leitura = useMemo(() => lerExportacao(texto), [texto]);

  const abrir = async (f: File | undefined) => {
    if (!f) return;
    const t = await f.text(); setTexto(t);
    // sugere como SDR o autor cujo nome comeca igual a um vendedor cadastrado
    const r = lerExportacao(t);
    setAutor(r.autores.find((a) => vendedores.some((v) => a.toLowerCase().startsWith(v.nome.toLowerCase()))) ?? "");
  };
  const sdrs = leitura.mensagens.filter((m) => m.autor === autor).length;

  return (
    <form action={action} className="card space-y-4">
      <div>
        <label className="label">1. Arquivo da conversa</label>
        <label className="mt-1 flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-line px-4 py-5 text-sm text-mute hover:border-side-edge">
          <FileUp size={20} className="text-brand" />
          <span>Clique para escolher o <b className="text-ink">.txt</b> exportado do WhatsApp, ou cole a conversa abaixo.</span>
          <input type="file" accept=".txt,text/plain" className="hidden" onChange={(e) => abrir(e.target.files?.[0])} />
        </label>
        <textarea name="texto" value={texto} onChange={(e) => setTexto(e.target.value)} rows={6} className="input mt-2 font-mono text-xs" placeholder="16/10/2026 14:32 - Ruan: Oi Maria, tudo bem?" />
        {texto && <p className="mt-1 text-xs text-mute">{leitura.mensagens.length} mensagens reconhecidas · {leitura.autores.length} pessoas: {leitura.autores.join(", ") || "nenhuma"}</p>}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div><label className="label">2. Quem é o SDR na conversa?</label>
          <select name="autor" value={autor} onChange={(e) => setAutor(e.target.value)} className="input mt-1" required>
            <option value="">Escolha</option>{leitura.autores.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          {autor && <p className="mt-1 text-xs text-mute">{sdrs} mensagens do SDR, {leitura.mensagens.length - sdrs} do lead</p>}
        </div>
        <div><label className="label">3. Vendedor no sistema</label>
          <select name="vendedor" className="input mt-1" required defaultValue="">
            <option value="" disabled>Escolha</option>{vendedores.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
          </select>
        </div>
      </div>
      {res?.erro && <p className="text-sm text-bad">{res.erro}</p>}
      <Botao pronto={leitura.mensagens.length > 0 && !!autor} />
    </form>
  );
}

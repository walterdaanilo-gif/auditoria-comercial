"use client";
import { useRef, useState, useTransition } from "react";
import { CheckCircle2, ChevronDown, RotateCcw } from "lucide-react";
import { MODELOS, preencher, type ModeloMensagem } from "@/lib/mensagens";
import { salvarModelo } from "./actions";

type Salvo = { texto: string | null; ativo: boolean };

function Mensagem({ m, salvo }: { m: ModeloMensagem; salvo?: Salvo }) {
  const inicial = { texto: salvo?.texto ?? m.padrao, ativo: salvo?.ativo ?? true };
  const [base, setBase] = useState(inicial);
  const [texto, setTexto] = useState(inicial.texto);
  const [ativo, setAtivo] = useState(inicial.ativo);
  const [aberto, setAberto] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [pend, start] = useTransition();
  const area = useRef<HTMLTextAreaElement>(null);
  const sujo = texto !== base.texto || ativo !== base.ativo;
  const editado = base.texto !== m.padrao;
  const exemplo = Object.fromEntries(m.variaveis.map((v) => [v.k, v.ex]));

  const inserir = (k: string) => {
    const el = area.current, ins = `{${k}}`;
    if (!el) return setTexto((t) => t + ins);
    const a = el.selectionStart, b = el.selectionEnd;
    setTexto(texto.slice(0, a) + ins + texto.slice(b));
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = a + ins.length; });
    setMsg(null);
  };
  const salvar = () => start(async () => {
    const r = await salvarModelo(m.chave, texto, ativo);
    if (r.ok) { setBase({ texto, ativo }); setMsg({ ok: true, t: "Salvo. Vale a partir do próximo envio." }); }
    else setMsg({ ok: false, t: r.erro ?? "Não foi possível salvar." });
  });

  return (
    <section className="overflow-hidden rounded-3xl border border-line bg-card">
      <button type="button" onClick={() => setAberto(!aberto)} aria-expanded={aberto} className="flex w-full items-center gap-3 px-5 py-4 text-left">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2 font-bold">{m.titulo}
            {!base.ativo && <span className="chip border-bad text-bad">Desligada</span>}
            {editado && <span className="chip border-brand text-brand">Editada</span>}
          </span>
          <span className="block truncate text-sm text-mute">{m.para} · {m.quando}</span>
        </span>
        <ChevronDown size={18} className={`shrink-0 text-mute transition ${aberto ? "rotate-180" : ""}`} />
      </button>
      {aberto && (
        <div className="space-y-4 border-t border-line px-5 py-4">
          {m.desligavel ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={ativo} onChange={(e) => { setAtivo(e.target.checked); setMsg(null); }} />
              Enviar esta mensagem
            </label>
          ) : <p className="text-xs text-mute">Liga e desliga em Configurações › Alertas ao gestor.</p>}
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-2">
              <div className="label">Texto</div>
              <textarea ref={area} value={texto} onChange={(e) => { setTexto(e.target.value); setMsg(null); }} rows={12} className="input font-mono text-sm" />
              <div className="label pt-1">Variáveis (clique para inserir)</div>
              <div className="flex flex-wrap gap-1.5">
                {m.variaveis.map((v) => (
                  <button key={v.k} type="button" onClick={() => inserir(v.k)} title={v.desc} className="chip hover:border-brand hover:text-brand">{`{${v.k}}`}</button>
                ))}
              </div>
              <ul className="space-y-0.5 text-xs text-mute">{m.variaveis.map((v) => <li key={v.k}><b>{`{${v.k}}`}</b>: {v.desc}</li>)}</ul>
              {m.sugestoes?.map((s) => (
                <button key={s.nome} type="button" onClick={() => { setTexto(s.texto); setMsg(null); }} className="btn-ghost text-sm">Usar: {s.nome}</button>
              ))}
            </div>
            <div><div className="label mb-2">Prévia (com dados de exemplo)</div>
              <pre className="whitespace-pre-wrap rounded-2xl border border-line bg-bg p-4 text-sm">{preencher(texto, exemplo) || "(mensagem vazia: o sistema usa o texto padrão)"}</pre></div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={salvar} disabled={!sujo || pend} className="btn">{pend ? "Salvando..." : "Salvar"}</button>
            <button type="button" onClick={() => { setTexto(m.padrao); setMsg(null); }} disabled={texto === m.padrao} className="btn-ghost flex items-center gap-1.5 disabled:opacity-40"><RotateCcw size={15} />Voltar ao padrão</button>
            {msg && <span className={`flex items-center gap-1.5 text-sm ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.ok && <CheckCircle2 size={16} />}{msg.t}</span>}
            {!msg && sujo && <span className="text-sm text-mute">Alterações não salvas.</span>}
          </div>
        </div>
      )}
    </section>
  );
}

export default function EditorMensagens({ salvos }: { salvos: Record<string, Salvo> }) {
  const grupos = [...new Set(MODELOS.map((m) => m.grupo))];
  return (
    <div className="space-y-6">
      {grupos.map((g) => (
        <div key={g} className="space-y-3">
          <h2 className="text-lg font-bold">{g}</h2>
          {MODELOS.filter((m) => m.grupo === g).map((m) => <Mensagem key={m.chave} m={m} salvo={salvos[m.chave]} />)}
        </div>
      ))}
    </div>
  );
}

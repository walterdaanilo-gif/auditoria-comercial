"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, Ban, Check, CheckCircle2, Copy, Flame, MessageCircle, Send, Thermometer } from "lucide-react";
import { MOTIVOS, ORIENTACOES, STATUS, bloqueio, produtoSugerido, temperatura, type LeadCloser, type Progresso, type Status } from "@/lib/closer/regras";

export const CORES_TEMP = { quente: "text-bad border-bad/50", morno: "text-warn border-warn/50", frio: "text-mute border-line" };
export const SeloTemp = ({ l }: { l: LeadCloser }) => {
  const { nivel } = temperatura(l);
  return <span className={`chip !inline-flex shrink-0 items-center gap-1 whitespace-nowrap capitalize ${CORES_TEMP[nivel]}`}>{nivel === "quente" ? <Flame size={12} /> : <Thermometer size={12} />}{nivel}</span>;
};

const PASSOS = ["Conhecer", "Mensagem 1", "Resposta", "Mensagem 2", "Mensagem 3", "Negociação"];
const passoInicial = (p: Progresso) => {
  if (p.status === "novo") return 0;
  if (p.status === "mensagem") return 2;
  if (p.status === "respondeu") return p.enviadas >= 3 ? 5 : p.enviadas === 2 ? 4 : 3;
  return 5;
};

function Copiar({ texto, rotulo }: { texto: string; rotulo?: string }) {
  const [ok, setOk] = useState(false);
  const copiar = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(texto); setOk(true); setTimeout(() => setOk(false), 1500); } catch {}
  };
  return <button type="button" onClick={copiar} title="Copiar" className={rotulo ? "btn-ghost" : "shrink-0 rounded-lg p-1.5 text-mute transition hover:bg-track hover:text-ink"}>{ok ? <Check size={15} className="text-ok" /> : <Copy size={15} />}{rotulo && (ok ? "Copiado" : rotulo)}</button>;
}

// Cada linha da mensagem e um balao, como a planilha orienta
function Mensagem({ texto }: { texto: string }) {
  const baloes = texto.split("\n").map((t) => t.trim()).filter(Boolean);
  if (!baloes.length) return <p className="text-sm text-mute">A planilha não traz esta mensagem para este lead.</p>;
  return (
    <div className="space-y-2">
      {baloes.map((b, i) => (
        <div key={i} className="flex items-start gap-2 rounded-2xl rounded-tl-md border border-line bg-side-active/30 px-3.5 py-2.5 text-[15px] leading-snug">
          <span className="min-w-0 flex-1">{b}</span><Copiar texto={b} />
        </div>
      ))}
      <div className="pt-1"><Copiar texto={baloes.join("\n")} rotulo="Copiar tudo" /></div>
    </div>
  );
}

const Dado = ({ t, v }: { t: string; v: React.ReactNode }) => (v ? <div><div className="label">{t}</div><div className="mt-0.5 text-sm">{v}</div></div> : null);

export default function Ficha({ lead: l, aoSalvar, aoConcluir }: { lead: LeadCloser; aoSalvar: (chave: string, p: Progresso) => void; aoConcluir?: () => void }) {
  const p = l.progresso;
  const [passo, setPasso] = useState(passoInicial(p));
  const [motivos, setMotivos] = useState(false);
  const [nota, setNota] = useState(p.anotacao);
  useEffect(() => { setPasso(passoInicial(l.progresso)); setMotivos(false); setNota(l.progresso.anotacao); }, [l.chave]); // eslint-disable-line react-hooks/exhaustive-deps

  const salvar = (mudou: Partial<Progresso>, proximo?: number) => {
    aoSalvar(l.chave, { ...p, anotacao: nota, ...mudou });
    if (proximo != null) setPasso(proximo);
  };
  const encerrar = (status: Status, motivo = "") => { salvar({ status, motivo }); aoConcluir?.(); };
  const trava = bloqueio(l), temp = temperatura(l), encerrado = ["fechou_plataforma", "fechou_imersao", "sem_resposta", "desqualificado"].includes(p.status);
  const whats = l.telefone ? `https://wa.me/${l.telefone}` : "";
  const BotaoWhats = () => (whats ? <a href={whats} target="_blank" rel="noreferrer" className="btn-ghost"><MessageCircle size={15} />Abrir WhatsApp</a> : null);

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2"><h2 className="text-2xl font-extrabold tracking-tight">{l.nome}</h2><SeloTemp l={l} /><span className="chip border-transparent text-white" style={{ background: STATUS[p.status].cor }}>{STATUS[p.status].texto}</span></div>
        <p className="mt-1 text-sm text-mute">{l.empresa || "Empresa não informada"}{l.telefoneTexto ? ` · ${l.telefoneTexto}` : ""}</p>
        {p.motivo && <p className="mt-1 text-sm text-bad">Motivo: {p.motivo}</p>}
      </div>

      {p.status === "novo" && trava && <div className="aviso flex gap-2"><AlertTriangle size={18} className="shrink-0 text-warn" /><div><b>Conferir antes de abordar.</b> {trava}.</div></div>}
      {!!l.conversasCrm.length && (
        <div className="aviso"><div className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle size={16} className="text-warn" />Já falaram com esta pessoa por {l.conversasCrm.length} números da Weevo</div>
          <ul className="space-y-0.5 text-xs text-mute">{l.conversasCrm.map((c, i) => <li key={i}>{c}</li>)}</ul>
          <p className="mt-1.5 text-xs">Confira a conversa mais recente antes de escrever, para não abordar duas vezes.</p></div>
      )}
      {!!l.repetidos.length && <p className="text-xs text-mute">Também aparece na planilha como: {l.repetidos.join(", ")}.</p>}

      <ol className="flex flex-wrap gap-1 pb-1" aria-label="Passo a passo">
        {PASSOS.map((t, i) => (
          <li key={t} className="shrink-0"><button type="button" onClick={() => setPasso(i)} aria-current={passo === i ? "step" : undefined}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${passo === i ? "border-brand bg-brand text-bg" : i < passoInicial(p) ? "border-brand/40 text-brand" : "border-line text-mute hover:text-ink"}`}>
            {i < passoInicial(p) ? <Check size={12} /> : <span>{i + 1}</span>}{t}</button></li>
        ))}
      </ol>

      {passo === 0 && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-line p-4">
            <div className="label mb-2">Por que falar com essa pessoa</div>
            <ul className="space-y-1 text-sm">{temp.motivos.length ? temp.motivos.map((m) => <li key={m} className="flex gap-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-ok" />{m}</li>) : <li className="text-mute">A planilha não traz sinais deste lead. {l.falta && l.falta !== "Nada" ? `Falta: ${l.falta}.` : ""}</li>}</ul>
            <p className="mt-3 text-sm">Produto com mais chance: <b>{produtoSugerido(l)}</b></p>
          </div>
          <div className="rounded-2xl border border-line p-4">
            <div className="label mb-2">Dor relatada{l.area ? ` · ${l.area}` : ""}</div>
            {l.dor ? <p className="text-sm">{l.dor}</p> : <p className="text-sm text-mute">Não relatou uma dor no workshop.</p>}
            <div className="mt-3 grid gap-3 sm:grid-cols-2"><Dado t="Como resolve hoje" v={l.hoje} /><Dado t="O que deseja" v={l.deseja} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Dado t="Workshop" v={l.workshop} /><Dado t="Nota" v={l.nota != null ? `${l.nota} de 10` : ""} /><Dado t="Comentário da nota" v={l.motivoNota} />
            <Dado t="Etapa no CRM" v={l.etapa} /><Dado t="Responsável no CRM" v={l.responsavelCrm || l.responsavel} /><Dado t="Interesse na imersão" v={l.interesseImersao} />
            <Dado t="Reunião" v={l.reuniao} /><Dado t="Indicado por" v={l.indicadoPor} />
          </div>
          {l.observacao && <div className="rounded-2xl border border-brand/30 bg-brand/5 p-4"><div className="label mb-1">Observação do time</div><p className="text-sm">{l.observacao}</p></div>}
          {!encerrado && <button className="btn" disabled={!whats || !!l.trava} onClick={() => setPasso(1)}><Send size={15} />Ir para a mensagem 1</button>}
        </section>
      )}

      {passo === 1 && (
        <section className="space-y-3">
          <p className="text-sm text-mute">{ORIENTACOES.envio}</p>
          <Mensagem texto={l.mensagens[0]} />
          <div className="flex flex-wrap gap-2"><BotaoWhats /><button className="btn" disabled={!l.mensagens[0]} onClick={() => salvar({ status: "mensagem", enviadas: Math.max(p.enviadas, 1) }, 2)}><Check size={15} />Já enviei</button></div>
        </section>
      )}

      {passo === 2 && (
        <section className="space-y-3">
          <p className="text-[15px]">{l.nome.split(" ")[0]} respondeu à primeira mensagem?</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => salvar({ status: "respondeu" }, 3)}><Check size={15} />Respondeu</button>
            <button className="btn-ghost" onClick={() => encerrar("sem_resposta")}>Não respondeu, próximo lead</button>
            <BotaoWhats />
          </div>
        </section>
      )}

      {(passo === 3 || passo === 4) && (
        <section className="space-y-3">
          <p className="aviso !rounded-2xl !p-3">{ORIENTACOES.ordem}</p>
          <Mensagem texto={l.mensagens[passo - 2]} />
          <div className="flex flex-wrap gap-2"><BotaoWhats /><button className="btn" disabled={!l.mensagens[passo - 2]} onClick={() => (passo === 3 ? salvar({ status: "respondeu", enviadas: Math.max(p.enviadas, 2) }, 4) : salvar({ status: "negociando", enviadas: 3 }, 5))}><Check size={15} />Já enviei</button></div>
        </section>
      )}

      {passo === 5 && (
        <section className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-line p-4"><div className="label mb-1">Perguntou o preço?</div><p className="text-sm">{ORIENTACOES.preco}</p></div>
            <div className="rounded-2xl border border-line p-4"><div className="label mb-1">Perguntou "começa quando?"</div><p className="text-sm">{ORIENTACOES.comecaQuando}</p><div className="mt-2 flex items-center justify-between gap-2"><span className="text-xs text-warn">Sugestão ainda não validada pelo Raí</span><Copiar texto={ORIENTACOES.comecaQuando} /></div></div>
            <div className="rounded-2xl border border-line p-4"><div className="label mb-1">Plantões</div><p className="text-sm">{ORIENTACOES.inicio}</p></div>
            <div className="rounded-2xl border border-line p-4"><div className="label mb-1">Imersão</div><p className="text-sm">{ORIENTACOES.imersao}</p></div>
          </div>
          {!encerrado && <div className="flex flex-wrap gap-2">
            {p.status !== "negociando" && <button className="btn-ghost" onClick={() => salvar({ status: "negociando" })}>Marcar em negociação</button>}
            <button className="btn" onClick={() => encerrar("fechou_plataforma")}><CheckCircle2 size={15} />Fechou Plataforma</button>
            <button className="btn" onClick={() => encerrar("fechou_imersao")}><CheckCircle2 size={15} />Fechou Imersão</button>
          </div>}
        </section>
      )}

      <div>
        <label htmlFor={`nota-${l.chave}`} className="label">Anotações do closer</label>
        <textarea id={`nota-${l.chave}`} className="input mt-1 min-h-[70px]" value={nota} onChange={(e) => setNota(e.target.value)} onBlur={() => { if (nota !== p.anotacao) salvar({ anotacao: nota }); }} placeholder="O que a pessoa disse, próximo passo, melhor horário..." />
      </div>

      {encerrado
        ? <button className="btn-ghost" onClick={() => salvar({ status: p.enviadas ? "mensagem" : "novo", motivo: "" }, p.enviadas ? 2 : 0)}>Voltar este lead para a fila</button>
        : <div className="border-t border-line pt-4">
            {!motivos ? <button className="btn-ghost text-bad" onClick={() => setMotivos(true)}><Ban size={15} />Desqualificar</button> : (
              <div><div className="label mb-2">Por que está saindo da fila?</div>
                <div className="flex flex-wrap gap-2">{MOTIVOS.map((m) => <button key={m} className="chip border-line px-3 py-1.5 text-sm font-semibold hover:border-bad hover:text-bad" onClick={() => encerrar("desqualificado", m)}>{m}</button>)}<button className="chip border-transparent px-3 py-1.5 text-sm text-mute" onClick={() => setMotivos(false)}>Cancelar</button></div></div>
            )}
          </div>}
    </div>
  );
}

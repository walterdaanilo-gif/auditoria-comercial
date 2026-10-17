"use client";
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronDown, Plus, Trash2, X } from "lucide-react";
import {
  DIAS_SEMANA, PADRAO_AMOSTRA, PADRAO_MIN_MSGS, SUGESTOES,
  chaveDe, fmtTelefone, normalizarTelefone, somaPesos, validar,
  type Criterio, type Estado, type Horario, type Settings,
} from "@/lib/configuracoes";
import { desconectarAgenda, salvarConfiguracoes } from "./actions";

export type StatusAgenda = { conectada: boolean; email: string | null; conectado_em: string | null; erro: string | null };
const RETORNO_AGENDA: Record<string, [boolean, string]> = {
  ok: [true, "Agenda Google conectada."], cancelado: [false, "Você cancelou o login do Google."], "sem-token": [false, "O Google não devolveu a autorização completa. Clique em Conectar de novo."],
  "sem-chaves": [false, "Faltam GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET na Vercel."], erro: [false, "Não foi possível conectar. Tente de novo."],
};

// ---------- pecas pequenas ----------
function Toggle({ on, onChange, rotulo }: { on: boolean; onChange: (v: boolean) => void; rotulo: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={rotulo} onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition ${on ? "border-brand bg-brand" : "border-line bg-track"}`}>
      <span className={`absolute top-0.5 h-[18px] w-[18px] rounded-full transition-all ${on ? "left-[22px] bg-bg" : "left-0.5 bg-mute"}`} />
    </button>
  );
}

function Opcoes<T extends string>({ valor, onChange, opcoes }: { valor: T; onChange: (v: T) => void; opcoes: [T, string, string?][] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
      {opcoes.map(([v, t, sub]) => (
        <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={valor === v}
          className={`rounded-xl border px-3 py-2.5 text-left text-sm transition ${valor === v ? "border-brand bg-brand/10" : "border-line hover:border-side-edge"}`}>
          <span className="flex items-center gap-2 font-semibold"><span className={`h-3.5 w-3.5 rounded-full border-2 ${valor === v ? "border-brand bg-brand" : "border-mute"}`} />{t}</span>
          {sub && <span className="mt-0.5 block pl-[22px] text-xs text-mute">{sub}</span>}
        </button>
      ))}
    </div>
  );
}

function Linha({ titulo, sub, children }: { titulo: string; sub?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2">
      <div className="min-w-0 flex-1"><div className="text-sm font-semibold">{titulo}</div>{sub && <div className="text-xs text-mute">{sub}</div>}</div>
      {children}
    </div>
  );
}

function Numero({ valor, onChange, min = 0, max = 1000, sufixo, largura = "w-24", vazio }: { valor: number | null; onChange: (v: number | null) => void; min?: number; max?: number; sufixo?: string; largura?: string; vazio?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <input type="number" inputMode="numeric" min={min} max={max} value={valor ?? ""} placeholder={vazio ? "sem meta" : undefined}
        onChange={(e) => onChange(e.target.value === "" ? (vazio ? null : min) : Math.round(Number(e.target.value)))}
        className={`input !py-1.5 text-right tabular-nums ${largura}`} />
      {sufixo && <span className="whitespace-nowrap text-sm text-mute">{sufixo}</span>}
    </span>
  );
}

function Telefones({ lista, onChange, max, placeholder }: { lista: string[]; onChange: (l: string[]) => void; max?: number; placeholder: string }) {
  const [txt, setTxt] = useState(""); const [erro, setErro] = useState("");
  const add = () => {
    const t = normalizarTelefone(txt);
    if (!t) return setErro("Use 55 + DDD + número, por exemplo 5584999998888.");
    if (lista.includes(t)) return setErro("Esse número já está na lista.");
    if (max && lista.length >= max) return setErro(`No máximo ${max} números.`);
    onChange([...lista, t]); setTxt(""); setErro("");
  };
  const cheio = !!max && lista.length >= max;
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {lista.map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-track py-1 pl-3 pr-1.5 text-sm tabular-nums">
            {fmtTelefone(t)}<button type="button" aria-label={`Remover ${t}`} onClick={() => onChange(lista.filter((x) => x !== t))} className="rounded-full p-0.5 text-mute hover:text-bad"><X size={14} /></button>
          </span>
        ))}
        {!lista.length && <span className="text-sm text-mute">Nenhum número.</span>}
      </div>
      {!cheio && (
        <div className="mt-3 flex gap-2">
          <input value={txt} onChange={(e) => { setTxt(e.target.value); setErro(""); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            inputMode="tel" placeholder={placeholder} className="input max-w-xs" />
          <button type="button" onClick={add} className="btn-ghost"><Plus size={15} />Adicionar</button>
        </div>
      )}
      {erro && <p className="mt-1 text-xs text-bad">{erro}</p>}
    </div>
  );
}

// Regras em texto livre (uma por linha) + chips de sugestao clicaveis
function Regras({ linhas, onChange, sugestoes, placeholder }: { linhas: string[]; onChange: (l: string[]) => void; sugestoes: string[]; placeholder: string }) {
  const tem = (s: string) => linhas.some((l) => l.trim().toLowerCase() === s.toLowerCase());
  return (
    <div>
      <textarea value={linhas.join("\n")} onChange={(e) => onChange(e.target.value.split("\n"))} rows={Math.max(3, linhas.length + 1)} placeholder={placeholder} className="input resize-y leading-relaxed" />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {sugestoes.map((s) => {
          const on = tem(s);
          return (
            <button key={s} type="button" onClick={() => onChange(on ? linhas.filter((l) => l.trim().toLowerCase() !== s.toLowerCase()) : [...linhas.filter((l) => l.trim()), s])}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition ${on ? "border-brand bg-brand/10 text-ink" : "border-line text-mute hover:border-side-edge hover:text-ink"}`}>
              {on ? <CheckCircle2 size={12} className="text-brand" /> : <Plus size={12} />}{s}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EditorHorario({ h, onChange }: { h: Horario; onChange: (h: Horario) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex gap-1">
        {DIAS_SEMANA.map((d, i) => {
          const on = h.dias.includes(i);
          return <button key={d} type="button" aria-pressed={on} onClick={() => onChange({ ...h, dias: on ? h.dias.filter((x) => x !== i) : [...h.dias, i].sort() })}
            className={`w-11 rounded-lg border py-1.5 text-xs font-semibold ${on ? "border-brand bg-brand text-bg" : "border-line text-mute"}`}>{d}</button>;
        })}
      </div>
      <span className="flex items-center gap-2 text-sm">
        <input type="time" value={h.inicio} onChange={(e) => onChange({ ...h, inicio: e.target.value })} className="input !w-auto !py-1.5 [color-scheme:dark]" />
        <span className="text-mute">às</span>
        <input type="time" value={h.fim} onChange={(e) => onChange({ ...h, fim: e.target.value })} className="input !w-auto !py-1.5 [color-scheme:dark]" />
      </span>
    </div>
  );
}

// Rubrica: nome, descricao, peso e ativo por criterio, com barra da composicao e soma
const CORES_RUBRICA = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
function EditorRubrica({ lista, onChange }: { lista: Criterio[]; onChange: (l: Criterio[]) => void }) {
  const [novo, setNovo] = useState("");
  const soma = somaPesos(lista);
  const muda = (i: number, p: Partial<Criterio>) => onChange(lista.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const ativos = lista.filter((c) => c.ativo && c.peso > 0);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="text-mute">Composição da nota</span>
        <span className={`font-bold tabular-nums ${soma === 100 ? "text-ok" : "text-bad"}`}>{soma}% {soma === 100 ? "" : "· precisa somar 100%"}</span>
      </div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-track">
        {ativos.map((c, i) => <div key={c.chave} title={`${c.nome}: ${c.peso}%`} style={{ width: `${(c.peso / Math.max(soma, 100)) * 100}%`, background: CORES_RUBRICA[i % CORES_RUBRICA.length] }} />)}
      </div>
      <div className="mt-4 space-y-2">
        {lista.map((c, i) => (
          <div key={c.chave} className={`grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[auto_1fr_auto_auto] sm:items-start ${c.ativo ? "" : "opacity-50"}`}>
            <span className="mt-2.5 hidden h-3 w-3 rounded-full sm:block" style={{ background: c.ativo && c.peso > 0 ? CORES_RUBRICA[ativos.indexOf(c) % CORES_RUBRICA.length] : "#2b3433" }} />
            <div className="space-y-1.5">
              <input value={c.nome} onChange={(e) => muda(i, { nome: e.target.value })} aria-label="Nome do critério" className="input !py-1.5 font-semibold" />
              <textarea value={c.descricao} onChange={(e) => muda(i, { descricao: e.target.value })} aria-label="O que a IA observa" rows={2} placeholder="O que a IA deve observar neste critério" className="input !py-1.5 text-xs" />
            </div>
            <Numero valor={c.peso} onChange={(v) => muda(i, { peso: v ?? 0 })} max={100} sufixo="%" largura="w-20" />
            <div className="flex items-center gap-2 sm:mt-1.5">
              <Toggle on={c.ativo} onChange={(v) => muda(i, { ativo: v })} rotulo={`Ativar ${c.nome}`} />
              <button type="button" aria-label={`Remover ${c.nome}`} onClick={() => onChange(lista.filter((_, j) => j !== i))} className="rounded-lg p-1.5 text-mute hover:text-bad"><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <input value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="Novo critério" className="input max-w-xs"
          onKeyDown={(e) => { if (e.key === "Enter" && novo.trim()) { e.preventDefault(); onChange([...lista, { chave: chaveDe(novo, lista.map((c) => c.chave)), nome: novo.trim(), descricao: "", peso: 0, ativo: true }]); setNovo(""); } }} />
        <button type="button" disabled={!novo.trim()} onClick={() => { onChange([...lista, { chave: chaveDe(novo, lista.map((c) => c.chave)), nome: novo.trim(), descricao: "", peso: 0, ativo: true }]); setNovo(""); }} className="btn-ghost disabled:opacity-50"><Plus size={15} />Adicionar</button>
      </div>
      <p className="mt-2 text-xs text-mute">A IA dá nota de 1 a 5 em cada critério ativo. A nota final é a média ponderada pelos pesos, convertida para 0 a 10 no painel.</p>
    </div>
  );
}

// ---------- previews ----------
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
function previewAlerta(s: Settings) {
  const det = s.alerta_formato === "detalhado";
  const blocos: string[] = [];
  if (s.alerta_venda) blocos.push(det
    ? `💰 *Inscrição no workshop* · cupom de convite · ${brl(0)}\nRuan (SDR) com Maria Silva\n"Show, pode me inscrever então!"\nVer conversa: <link>`
    : `💰 *Inscrição no workshop* (cupom de convite · ${brl(0)}): Ruan (SDR) com Maria Silva`);
  if (s.alerta_marcacao) blocos.push(det
    ? `📅 *Reunião de imersão marcada*\nNick (SDR) com João Souza\n"Combinado, quinta às 19h com o closer"\nVer conversa: <link>`
    : `📅 *Reunião de imersão marcada*: Nick (SDR) com João Souza`);
  if (s.alerta_oportunidade) blocos.push(det
    ? `🎯 *Oportunidade*: interesse na imersão\nNick (SDR) com Paula Lima\n"Quero entender melhor a imersão"\nVer conversa: <link>`
    : `🎯 *Oportunidade*: interesse na imersão: Nick (SDR) com Paula Lima`);
  return blocos.length ? blocos.join("\n\n") : "Nenhum aviso marcado: os telefones recebem só o relatório do dia.";
}
function previewResumo() {
  return `📊 *Relatório do dia 17/10 · Weevo*\n\n✅ Auditorias: 12 · ⭐ Nota média: 7,8\n⏱️ 1ª resposta: 4min · tempo médio de resposta: 12min\n📞 Ligações atendidas: 9 de 15\n💰 Workshop: 5 inscrições (3 com cupom ${brl(0)} · 2 pagas ${brl(394)})\n💎 Imersão: 1 fechada · ${brl(4800)}\n🎯 Oportunidades: 7\n\n🏆 *Por vendedor*\n1. Ruan (SDR): ⭐ 8,4 · 28/30 contatos · 5/6 marcações · 3 inscrições no workshop · 📞 5 atendidas\n2. Nick (SDR): ⭐ 7,6 · 31/30 contatos · 4/6 marcações · 2 inscrições no workshop · 📞 4 atendidas\n\nDetalhes: <link do sistema>`;
}

// ---------- card em acordeao ----------
type Passo = { id: string; titulo: string; ok: boolean };
function Card({ id, titulo, resumo, ok, recomendado, aberto, alternar, children }: { id: string; titulo: string; resumo: string; ok: boolean; recomendado?: boolean; aberto: boolean; alternar: (id: string) => void; children: ReactNode }) {
  return (
    <section id={`card-${id}`} className="overflow-hidden rounded-3xl border border-line bg-card">
      <button type="button" onClick={() => alternar(id)} aria-expanded={aberto} className="flex w-full items-center gap-3 px-5 py-4 text-left">
        {ok ? <CheckCircle2 size={20} className="shrink-0 text-ok" /> : <AlertTriangle size={20} className="shrink-0 text-warn" />}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2 font-bold">{titulo}{recomendado && !ok && <span className="chip border-warn text-warn">Recomendado</span>}</span>
          <span className="block truncate text-sm text-mute">{resumo}</span>
        </span>
        <ChevronDown size={18} className={`shrink-0 text-mute transition ${aberto ? "rotate-180" : ""}`} />
      </button>
      {aberto && <div className="border-t border-line px-5 py-4">{children}</div>}
    </section>
  );
}

// ---------- tela ----------
export default function FormConfig({ inicial, agenda, retornoAgenda }: { inicial: Estado; agenda: StatusAgenda | null; retornoAgenda?: string }) {
  const [base, setBase] = useState(inicial);
  const [e, setE] = useState(inicial);
  const [abertos, setAbertos] = useState<string[]>([]);
  const [pend, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; erros?: string[] } | null>(null);
  const [slaHoras, setSlaHoras] = useState(inicial.settings.sla_primeira_resposta_min % 60 === 0 && inicial.settings.sla_primeira_resposta_min >= 60);

  const s = e.settings;
  const set = (p: Partial<Settings>) => { setE((x) => ({ ...x, settings: { ...x.settings, ...p } })); setMsg(null); };
  const setEst = (p: Partial<Estado>) => { setE((x) => ({ ...x, ...p })); setMsg(null); };
  const alternar = (id: string) => setAbertos((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
  const sujo = useMemo(() => JSON.stringify(e) !== JSON.stringify(base), [e, base]);
  // Dados novos do servidor (ex.: vendedor recem-criado) entram quando nao ha edicao pendente
  useEffect(() => { if (!sujo) { setBase(inicial); setE(inicial); } }, [inicial]); // eslint-disable-line react-hooks/exhaustive-deps
  const erros = useMemo(() => validar(e), [e]);

  const vend = e.vendedores.filter((v) => v.ativo);
  const closers = vend.filter((v) => v.funcao === "closer").length;
  const minMsgs = s.min_mensagens ?? PADRAO_MIN_MSGS, amostra = s.amostragem_pct ?? PADRAO_AMOSTRA;
  const rubOk = s.rubrica_modo === "personalizada" ? somaPesos(e.rubricas.personalizada) === 100 : somaPesos(e.rubricas.sdr) === 100 && somaPesos(e.rubricas.closer) === 100;
  const linhas = (l: string[]) => l.filter((x) => x.trim()).length;
  const regras = (n: number, txt: string) => `${n} regra${n === 1 ? "" : "s"} que ${n === 1 ? txt : txt.replace("conta", "contam")}`;
  const conectados = e.numeros.filter((n) => n.status === "conectado");
  const envio = e.numeros.find((n) => n.id === s.instancia_envio_id);

  const passos: Passo[] = [
    { id: "equipe", titulo: "Equipe e metas", ok: vend.length > 0 && (!closers || s.meta_closer_reunioes !== null || s.meta_closer_vendas !== null) },
    { id: "auto", titulo: "Auditoria automática", ok: s.auditoria_automatica },
    { id: "conversas", titulo: "Quais conversas auditar", ok: true },
    { id: "ignorados", titulo: "Números ignorados", ok: e.ignorados.length > 0 },
    { id: "alertas", titulo: "Alertas ao gestor", ok: e.alertas.length > 0 && !!envio },
    { id: "critico", titulo: "Alerta crítico e SLA", ok: linhas(s.regras_criticas) > 0 },
    { id: "followup", titulo: "Cadência de follow-up", ok: true },
    { id: "horario", titulo: "Horário de funcionamento", ok: s.horario_modo !== "desligado" },
    { id: "agenda", titulo: "Agenda Google", ok: !!agenda?.conectada && s.agenda_ativa },
    { id: "resumo", titulo: "Relatório do dia no WhatsApp", ok: s.resumo_ativo && e.alertas.length > 0 && !!envio },
    { id: "rubrica", titulo: "Critérios de avaliação", ok: rubOk },
    { id: "vendas", titulo: "Detecção de vendas", ok: linhas(s.venda_conta) > 0 },
    { id: "oportunidades", titulo: "Detecção de oportunidades", ok: linhas(s.oportunidade_conta) > 0 },
  ];
  const feitos = passos.filter((p) => p.ok).length;
  const pct = Math.round((feitos / passos.length) * 100);
  const proximo = passos.find((p) => !p.ok);
  const nivel = pct >= 85 ? "Avançado" : pct >= 50 ? "Intermediário" : "Básico";
  const ok = (id: string) => passos.find((p) => p.id === id)!.ok;
  const irPara = (id: string) => { setAbertos((a) => (a.includes(id) ? a : [...a, id])); setTimeout(() => document.getElementById(`card-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); };
  const cardProps = (id: string) => ({ id, ok: ok(id), aberto: abertos.includes(id), alternar });

  const salvar = () => startTransition(async () => {
    const r = await salvarConfiguracoes(e);
    setMsg(r);
    if (r.ok) setBase(e);
  });
  const descartar = () => { setE(base); setMsg(null); setSlaHoras(base.settings.sla_primeira_resposta_min % 60 === 0 && base.settings.sla_primeira_resposta_min >= 60); };

  const pre = "whitespace-pre-wrap rounded-2xl border border-line bg-bg p-4 font-sans text-[13px] leading-relaxed text-ink";

  return (
    <div className="space-y-6">
      <div><h1 className="page-title">Configurações</h1>
        <p className="page-sub">Equipe, quais conversas o Auditor revisa, como ele dá nota, o que conta como venda e quem recebe os avisos. Tudo aqui muda a auditoria de verdade.</p></div>

      {/* Progresso */}
      <div className="card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="font-bold">Configuração do Auditor · <span className="tabular-nums text-brand">{pct}%</span> <span className="font-normal text-mute">· Nível {nivel} · {feitos} de {passos.length} passos</span></div>
          {proximo ? <button type="button" onClick={() => irPara(proximo.id)} className="text-sm font-semibold text-brand hover:underline">Próximo passo: {proximo.titulo} →</button> : <span className="flex items-center gap-1 text-sm text-ok"><CheckCircle2 size={15} />Tudo configurado</span>}
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-track"><div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} /></div>
      </div>

      {/* ---------- Equipe ---------- */}
      <h2 className="text-lg font-bold">Equipe</h2>
      <Card {...cardProps("equipe")} titulo="Equipe e metas" recomendado
        resumo={`${vend.length} vendedor${vend.length === 1 ? "" : "es"} · ${vend.length - closers} SDR · ${closers} closer${closers === 1 ? "" : "s"} · meta SDR ${s.meta_sdr_marcacoes} marcações/dia`}>
        <p className="mb-3 text-sm text-mute">A função define a rubrica, o que conta como venda e quais metas valem. <b className="text-ink">SDR</b>: venda é inscrição no workshop (cupom R$ 0 também conta); reunião de imersão é oportunidade. <b className="text-ink">Closer</b>: venda só quando fecha a imersão; reunião de implementação é oportunidade.</p>
        <div className="divide-y divide-line rounded-2xl border border-line">
          {e.vendedores.map((v) => {
            const nums = e.numeros.filter((n) => n.vendedor_id === v.id);
            return (
              <div key={v.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${v.ativo ? "" : "opacity-50"}`}>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{v.nome}{!v.ativo && <span className="ml-2 text-xs text-mute">(inativo)</span>}</div>
                  <div className="text-xs text-mute">{nums.length ? nums.map((n) => `${n.numero ? fmtTelefone(n.numero) : n.nome} · ${n.status === "conectado" ? "conectado" : n.status.replace("_", " ")}`).join(" | ") : "WhatsApp não criado"}</div>
                </div>
                <span className={`chip ${v.funcao === "closer" ? "border-warn text-warn" : "border-brand text-brand"}`}>{v.funcao === "closer" ? "Closer" : "SDR"}</span>
              </div>
            );
          })}
          {!e.vendedores.length && <p className="px-4 py-3 text-sm text-mute">Nenhum vendedor ainda. Cadastre ao criar a conexão em WhatsApp.</p>}
        </div>
        <p className="mt-2 text-xs text-mute">Vendedores e função (SDR ou Closer) são cadastrados e alterados na aba <Link href="/instancias" className="font-semibold text-brand hover:underline">WhatsApp</Link>, junto com a conexão.</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-line p-4">
            <div className="label mb-1">Metas diárias do SDR</div>
            <Linha titulo="Conversas trocadas" sub="O lead respondeu à mensagem do SDR"><Numero valor={s.meta_sdr_conversas} onChange={(v) => set({ meta_sdr_conversas: v ?? 0 })} sufixo="por dia" /></Linha>
            <Linha titulo="Marcações" sub="Workshop + reunião de imersão"><Numero valor={s.meta_sdr_marcacoes} onChange={(v) => set({ meta_sdr_marcacoes: v ?? 0 })} sufixo="por dia" /></Linha>
          </div>
          <div className="rounded-2xl border border-line p-4">
            <div className="label mb-1">Metas diárias do Closer</div>
            <Linha titulo="Reuniões de implementação"><Numero vazio valor={s.meta_closer_reunioes} onChange={(v) => set({ meta_closer_reunioes: v })} sufixo="por dia" /></Linha>
            <Linha titulo="Imersões fechadas"><Numero vazio valor={s.meta_closer_vendas} onChange={(v) => set({ meta_closer_vendas: v })} sufixo="por dia" /></Linha>
          </div>
        </div>
      </Card>

      {/* ---------- Essencial ---------- */}
      <h2 className="pt-2 text-lg font-bold">Configuração essencial</h2>
      <Card {...cardProps("auto")} titulo="Auditoria automática" recomendado
        resumo={s.auditoria_automatica ? `Ligada · ${s.auditoria_parada_min === null ? "só na rodada final" : `parada ${s.auditoria_parada_min % 60 === 0 ? `${s.auditoria_parada_min / 60}h` : `${s.auditoria_parada_min} min`}`} · rodada final às ${s.rodada_final_hora}` : "Desligada: só audita quando você pede"}>
        <div className="divide-y divide-line">
          <Linha titulo="Auditar sozinho" sub="O Auditor dá a nota sozinho e avisa o que precisa de atenção. Desligado, só audita pelo botão Auditar agora na conversa.">
            <Toggle on={s.auditoria_automatica} onChange={(v) => set({ auditoria_automatica: v })} rotulo="Auditoria automática" />
          </Linha>
          {s.auditoria_automatica && <>
            <Linha titulo="Auditar durante o dia" sub={s.auditoria_parada_min === null ? "Desligado: só audita na rodada final do dia" : "Só audita a conversa que ficou parada esse tempo, para não dar nota no meio do papo"}>
              <span className="flex items-center gap-3">
                {s.auditoria_parada_min !== null && <Numero valor={Math.round(s.auditoria_parada_min / 60 * 10) / 10} onChange={(v) => set({ auditoria_parada_min: Math.min(1440, Math.max(10, Math.round((v ?? 2) * 60))) })} min={1} max={24} sufixo="h parada" largura="w-20" />}
                <Toggle on={s.auditoria_parada_min !== null} onChange={(v) => set({ auditoria_parada_min: v ? 120 : null })} rotulo="Auditar durante o dia" />
              </span>
            </Linha>
            <Linha titulo="Rodada final do dia" sub="Audita o dia fechado de toda conversa que mudou e, logo depois, manda o relatório do dia ao gestor">
              <input type="time" value={s.rodada_final_hora} onChange={(ev) => set({ rodada_final_hora: ev.target.value })} className="input !w-auto !py-1.5 [color-scheme:dark]" />
            </Linha>
            <Linha titulo="Histórico do lead" sub="A IA lê as conversas dos dias anteriores com o mesmo lead como contexto (follow-up, o que foi prometido). A nota é só do dia.">
              <Numero valor={s.historico_dias} onChange={(v) => set({ historico_dias: v ?? 0 })} max={30} sufixo="dias" largura="w-20" />
            </Linha>
          </>}
        </div>
      </Card>

      <Card {...cardProps("conversas")} titulo="Quais conversas auditar"
        resumo={`${{ todas: "Individuais + grupos", individual: "Apenas individuais", grupo: "Apenas grupos" }[s.escopo_conversas]} · ${minMsgs}+ msgs · amostra ${amostra}%${s.so_com_proposta ? " · só em proposta" : ""}`}>
        <div className="label mb-2">Tipo de conversa</div>
        <Opcoes valor={s.escopo_conversas} onChange={(v) => set({ escopo_conversas: v })} opcoes={[["individual", "Apenas individuais", "Conversas 1 a 1"], ["todas", "Individuais + grupos", "Audita tudo"], ["grupo", "Apenas grupos"]]} />
        {s.escopo_conversas !== "individual" && <p className="mt-2 text-xs text-warn">Hoje as mensagens de grupo não são gravadas. A opção já fica salva e passa a valer quando a captura de grupos for ligada.</p>}
        <div className="mt-4 divide-y divide-line">
          <Linha titulo="Mínimo de mensagens" sub={s.min_mensagens === null ? `Padrão do app: ${PADRAO_MIN_MSGS} mensagens` : "Valor próprio da Weevo"}>
            <span className="flex items-center gap-3">{s.min_mensagens !== null && <Numero valor={s.min_mensagens} onChange={(v) => set({ min_mensagens: v ?? 1 })} min={1} max={200} sufixo="msgs" />}
              <label className="flex items-center gap-2 text-sm text-mute">Padrão <Toggle on={s.min_mensagens === null} onChange={(v) => set({ min_mensagens: v ? null : PADRAO_MIN_MSGS })} rotulo="Usar padrão de mensagens" /></label></span>
          </Linha>
          <Linha titulo="Amostragem" sub={s.amostragem_pct === null ? `Padrão do app: ${PADRAO_AMOSTRA}% das conversas` : "Valor próprio da Weevo"}>
            <span className="flex items-center gap-3">{s.amostragem_pct !== null && <Numero valor={s.amostragem_pct} onChange={(v) => set({ amostragem_pct: v ?? 1 })} min={1} max={100} sufixo="%" />}
              <label className="flex items-center gap-2 text-sm text-mute">Padrão <Toggle on={s.amostragem_pct === null} onChange={(v) => set({ amostragem_pct: v ? null : PADRAO_AMOSTRA })} rotulo="Usar padrão de amostragem" /></label></span>
          </Linha>
          <Linha titulo="Só conversas em proposta" sub="Audita só quem já chegou na etapa de proposta ou agendamento. Gasta menos crédito de IA.">
            <Toggle on={s.so_com_proposta} onChange={(v) => set({ so_com_proposta: v })} rotulo="Só conversas em proposta" />
          </Linha>
        </div>
        <p className="mt-3 rounded-xl bg-track p-3 text-xs text-mute">Sempre vale: só entra conversa em que o lead respondeu. Mensagens automáticas, chatbot e menus não contam na nota; conversa 100% bot é sinalizada em vez de pontuada. A cada rodada o Auditor revisa {amostra}% das conversas com {minMsgs}+ mensagens. Menos amostra e mais mensagens = menos crédito gasto.</p>
      </Card>

      <Card {...cardProps("ignorados")} titulo="Números ignorados" resumo={e.ignorados.length ? `${e.ignorados.length} número${e.ignorados.length > 1 ? "s" : ""} fora da auditoria automática` : "Nenhum número ignorado"}>
        <p className="mb-3 text-sm text-mute">Contatos que nunca entram na auditoria automática, como sócios, colegas e fornecedores. Ainda dá para auditar na mão pelo botão Auditar agora.</p>
        <Telefones lista={e.ignorados} onChange={(l) => setEst({ ignorados: l })} placeholder="55 + DDD + número, Enter adiciona" />
      </Card>

      <Card {...cardProps("alertas")} titulo="Alertas ao gestor" recomendado
        resumo={`${e.alertas.length} de 3 telefones · ${[s.alerta_venda && "vendas", s.alerta_marcacao && "marcações", s.alerta_oportunidade && "oportunidades"].filter(Boolean).join(", ") || "só relatório do dia"} · ${s.alerta_formato}${envio ? "" : " · falta o número que envia"}`}>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-5">
            <div><div className="label mb-2">Quem recebe (até 3 WhatsApp)</div>
              <Telefones lista={e.alertas} onChange={(l) => setEst({ alertas: l })} max={3} placeholder="55 + DDD + número" /></div>
            <div><div className="label mb-2">De qual WhatsApp sai a mensagem</div>
              <select value={s.instancia_envio_id ?? ""} onChange={(ev) => set({ instancia_envio_id: ev.target.value || null })} className="input">
                <option value="">Escolha um WhatsApp conectado</option>
                {e.numeros.map((n) => <option key={n.id} value={n.id} disabled={n.status !== "conectado" && n.id !== s.instancia_envio_id}>{n.nome}{n.numero ? ` · ${fmtTelefone(n.numero)}` : ""}{n.status !== "conectado" ? " (desconectado)" : ""}</option>)}
              </select>
              {!conectados.length && <p className="mt-1 text-xs text-warn">Nenhum WhatsApp conectado agora.</p>}
              <p className="mt-1 text-xs text-mute">De preferência um número só do sistema, para não misturar com conversa de vendedor.</p></div>
            <div><div className="label mb-2">Quando avisar no WhatsApp</div>
              <Linha titulo="Vendas" sub="Inscrição no workshop (inclusive cupom R$ 0) e imersão fechada"><Toggle on={s.alerta_venda} onChange={(v) => set({ alerta_venda: v })} rotulo="Avisar vendas" /></Linha>
              <Linha titulo="Marcações de reunião" sub="Reunião de imersão (SDR) e reunião de implementação (Closer)"><Toggle on={s.alerta_marcacao} onChange={(v) => set({ alerta_marcacao: v })} rotulo="Avisar marcações" /></Linha>
              <Linha titulo="Outras oportunidades" sub="Interesse claro no workshop ou na imersão, sem marcar nada ainda"><Toggle on={s.alerta_oportunidade} onChange={(v) => set({ alerta_oportunidade: v })} rotulo="Avisar oportunidades" /></Linha>
              <p className="mt-1 text-xs text-mute">O aviso sai na hora: quando a conversa tem sinal de venda ou marcação ("pode me inscrever", "cupom", "comprovante", "quinta às 19h"...), o Auditor audita na hora e, se confirmar, avisa em cerca de 2 minutos.</p></div>
            <div><div className="label mb-2">Formato</div>
              <Opcoes valor={s.alerta_formato} onChange={(v) => set({ alerta_formato: v })} opcoes={[["resumido", "Resumido", "Direto ao ponto"], ["detalhado", "Detalhado", "Com contexto e link"]]} /></div>
          </div>
          <div><div className="label mb-2">Prévia</div><pre className={pre}>{previewAlerta(s)}</pre>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-mute">
              <li>Cada conversa gera no máximo uma mensagem, a do evento mais importante.</li>
              <li>Só avisa conversas do dia, uma vez por evento. Se a mesma conversa tiver venda e marcação juntas, a mensagem cita as duas.</li>
              <li>Alerta crítico nunca vai pelo WhatsApp: chega como notificação aqui no sistema, para o gestor e para o vendedor da conversa.</li>
            </ul></div>
        </div>
      </Card>

      <Card {...cardProps("agenda")} titulo="Agenda Google" recomendado
        resumo={agenda?.conectada ? `Conectada${agenda.email ? ` (${agenda.email})` : ""} · ${s.agenda_ativa ? "reuniões de implementação entram sozinhas, em amarelo" : "envio desligado"}` : "Não conectada"}>
        {retornoAgenda && RETORNO_AGENDA[retornoAgenda] && <p className={`mb-3 text-sm ${RETORNO_AGENDA[retornoAgenda][0] ? "text-ok" : "text-bad"}`}>{RETORNO_AGENDA[retornoAgenda][1]}</p>}
        <p className="mb-3 text-sm text-mute">Quando o cliente confirma o horário da <b className="text-ink">reunião de implementação</b> na conversa, o Auditor cria o evento na sua Agenda Google, em <b className="text-warn">amarelo</b>, com nome do cliente e da empresa, e-mail, local (se for presencial) e o link da conversa. Se o horário mudar, o evento é atualizado.</p>
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line p-4">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{agenda?.conectada ? <span className="text-ok">Conectada</span> : "Não conectada"}{agenda?.email && <span className="ml-2 font-normal text-mute">{agenda.email}</span>}</div>
            {agenda?.erro && <div className="text-xs text-bad">{agenda.erro}</div>}
          </div>
          <a href="/api/google/conectar" className="btn">{agenda?.conectada ? "Conectar outra conta" : "Conectar Google Agenda"}</a>
          {agenda?.conectada && <form action={desconectarAgenda}><button className="btn-ghost">Desconectar</button></form>}
        </div>
        <div className="mt-4 divide-y divide-line">
          <Linha titulo="Enviar reuniões para a agenda" sub="Só reunião de implementação com horário confirmado pelo cliente"><Toggle on={s.agenda_ativa} onChange={(v) => set({ agenda_ativa: v })} rotulo="Enviar para a agenda" /></Linha>
          <Linha titulo="Duração da reunião" sub="Se a conversa disser outro tempo, vale o da conversa"><Numero valor={s.agenda_duracao_min} onChange={(v) => set({ agenda_duracao_min: v ?? 60 })} min={15} max={480} sufixo="min" largura="w-20" /></Linha>
          <Linha titulo="Convidar o cliente" sub="Quando o cliente passar o e-mail, ele recebe o convite do Google Agenda"><Toggle on={s.agenda_convidar} onChange={(v) => set({ agenda_convidar: v })} rotulo="Convidar o cliente" /></Linha>
          <Linha titulo="Link do Google Meet" sub="Reunião online já sai com link do Meet no evento"><Toggle on={s.agenda_meet} onChange={(v) => set({ agenda_meet: v })} rotulo="Criar link do Meet" /></Linha>
        </div>
      </Card>

      <Card {...cardProps("critico")} titulo="Alerta crítico e SLA" recomendado
        resumo={`${linhas(s.regras_criticas)} regra${linhas(s.regras_criticas) === 1 ? "" : "s"} crítica${linhas(s.regras_criticas) === 1 ? "" : "s"} · 1ª resposta em até ${slaHoras ? `${s.sla_primeira_resposta_min / 60} h` : `${s.sla_primeira_resposta_min} min`}`}>
        <div className="label mb-2">O que é crítico na Weevo (uma situação por linha)</div>
        <Regras linhas={s.regras_criticas} onChange={(l) => set({ regras_criticas: l })} sugestoes={SUGESTOES.critico} placeholder="Ex.: Lead ameaçou reclamar no Procon" />
        <p className="mt-2 text-xs text-mute">Essas regras somam com a régua padrão do Auditor (lead furioso prestes a desistir, conduta grave, risco jurídico), nunca substituem.</p>
        <div className="mt-5 border-t border-line pt-4">
          <Linha titulo="SLA de primeira resposta" sub="Alimenta o % no SLA do painel e o critério de agilidade da nota">
            <span className="flex items-center gap-2">
              <Numero valor={slaHoras ? s.sla_primeira_resposta_min / 60 : s.sla_primeira_resposta_min} onChange={(v) => set({ sla_primeira_resposta_min: Math.max(1, (v ?? 1) * (slaHoras ? 60 : 1)) })} min={1} max={slaHoras ? 168 : 10080} largura="w-20" />
              <select value={slaHoras ? "h" : "min"} onChange={(ev) => { const h = ev.target.value === "h"; setSlaHoras(h); set({ sla_primeira_resposta_min: h ? Math.max(60, Math.round(s.sla_primeira_resposta_min / 60) * 60) : s.sla_primeira_resposta_min }); }} className="input !w-auto !py-1.5">
                <option value="min">minutos</option><option value="h">horas</option>
              </select>
            </span>
          </Linha>
        </div>
      </Card>

      <Card {...cardProps("followup")} titulo="Cadência de follow-up" resumo={`Sem resposta após ${s.followup_sem_resposta_h} h · abandonada após ${s.followup_abandonada_d} dias · deixa de contar após ${s.followup_limite_d} dias`}>
        <p className="mb-2 text-sm text-mute">Define quando o lead que parou de responder vira "sem resposta" ou "abandonado". É a base da taxa de abandono por vendedor.</p>
        <div className="divide-y divide-line">
          <Linha titulo="Sem resposta após" sub="A bola está com o vendedor"><Numero valor={s.followup_sem_resposta_h} onChange={(v) => set({ followup_sem_resposta_h: v ?? 1 })} min={1} max={720} sufixo="horas comerciais" /></Linha>
          <Linha titulo="Abandonada após" sub="Oportunidade quente sem retorno"><Numero valor={s.followup_abandonada_d} onChange={(v) => set({ followup_abandonada_d: v ?? 1 })} min={1} max={90} sufixo="dias" /></Linha>
          <Linha titulo="Deixa de contar após" sub="Depois disso o lead não entra mais na taxa"><Numero valor={s.followup_limite_d} onChange={(v) => set({ followup_limite_d: v ?? 1 })} min={1} max={365} sufixo="dias" /></Linha>
        </div>
      </Card>

      <Card {...cardProps("horario")} titulo="Horário de funcionamento"
        resumo={s.horario_modo === "desligado" ? "Desligado: conta 24h corridas" : s.horario_modo === "empresa" ? `Weevo: ${s.horario_empresa.dias.map((d) => DIAS_SEMANA[d]).join(", ")} · ${s.horario_empresa.inicio} às ${s.horario_empresa.fim}` : "Cada número com o seu horário"}>
        <p className="mb-3 text-sm text-mute">Com horário ligado, o tempo de resposta e o SLA só contam dentro do expediente. Mensagem de madrugada ou fim de semana não pesa contra o vendedor.</p>
        <Opcoes valor={s.horario_modo} onChange={(v) => set({ horario_modo: v })} opcoes={[["desligado", "Desligado", "Mede 24h corridas"], ["empresa", "Da Weevo", "Um horário para todos"], ["numero", "Por número", "Cada vendedor o seu"]]} />
        {s.horario_modo === "empresa" && <div className="mt-4"><EditorHorario h={s.horario_empresa} onChange={(h) => set({ horario_empresa: h })} /></div>}
        {s.horario_modo === "numero" && (
          <div className="mt-4 space-y-3">
            {e.numeros.map((n) => (
              <div key={n.id} className="rounded-xl border border-line p-3">
                <Linha titulo={n.nome} sub={n.horario ? "Horário próprio" : `Usa o da Weevo (${s.horario_empresa.inicio} às ${s.horario_empresa.fim})`}>
                  <label className="flex items-center gap-2 text-sm text-mute">Próprio <Toggle on={!!n.horario} onChange={(v) => setEst({ numeros: e.numeros.map((x) => (x.id === n.id ? { ...x, horario: v ? { ...s.horario_empresa } : null } : x)) })} rotulo={`Horário próprio de ${n.nome}`} /></label>
                </Linha>
                {n.horario && <EditorHorario h={n.horario} onChange={(h) => setEst({ numeros: e.numeros.map((x) => (x.id === n.id ? { ...x, horario: h } : x)) })} />}
              </div>
            ))}
            {!e.numeros.length && <p className="text-sm text-mute">Nenhum WhatsApp criado ainda.</p>}
            <div><div className="label mb-2">Horário da Weevo (para quem não tem próprio)</div><EditorHorario h={s.horario_empresa} onChange={(h) => set({ horario_empresa: h })} /></div>
          </div>
        )}
      </Card>

      <Card {...cardProps("resumo")} titulo="Relatório do dia no WhatsApp"
        resumo={s.resumo_ativo ? `Ligado · após a rodada das ${s.rodada_final_hora} · ${s.resumo_dias.map((d) => DIAS_SEMANA[d]).join(", ")}${e.alertas.length ? "" : " · falta telefone"}` : "Desligado"}>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-4">
            <Linha titulo="Enviar relatório do dia" sub={`Sai logo depois da rodada final das ${s.rodada_final_hora} (horário de Brasília), pelo WhatsApp escolhido em Alertas ao gestor, para os mesmos telefones dos alertas`}><Toggle on={s.resumo_ativo} onChange={(v) => set({ resumo_ativo: v })} rotulo="Relatório do dia" /></Linha>
            <div><div className="label mb-2">Dias</div>
              <div className="flex flex-wrap gap-1">{DIAS_SEMANA.map((d, i) => {
                const on = s.resumo_dias.includes(i);
                return <button key={d} type="button" aria-pressed={on} onClick={() => set({ resumo_dias: on ? s.resumo_dias.filter((x) => x !== i) : [...s.resumo_dias, i].sort() })} className={`w-12 rounded-lg border py-1.5 text-xs font-semibold ${on ? "border-brand bg-brand text-bg" : "border-line text-mute"}`}>{d}</button>;
              })}</div>
              <p className="mt-1 text-xs text-mute">Dias sem envio acumulam no próximo relatório.</p></div>
            {!e.alertas.length && <p className="text-xs text-warn">Cadastre pelo menos um telefone em Alertas ao gestor.</p>}
          </div>
          <div><div className="label mb-2">Prévia</div><pre className={pre}>{previewResumo()}</pre></div>
        </div>
      </Card>

      {/* ---------- Avancado ---------- */}
      <h2 className="pt-2 text-lg font-bold">Avançado</h2>
      <Card {...cardProps("rubrica")} titulo="Critérios de avaliação (rubrica)"
        resumo={s.rubrica_modo === "personalizada" ? `Personalizada · ${e.rubricas.personalizada.filter((c) => c.ativo).length} critérios · ${somaPesos(e.rubricas.personalizada)}%` : `Padrão por função · SDR ${somaPesos(e.rubricas.sdr)}% · Closer ${somaPesos(e.rubricas.closer)}%`}>
        <Opcoes valor={s.rubrica_modo} onChange={(v) => { if (v === "personalizada" && !e.rubricas.personalizada.length) setEst({ rubricas: { ...e.rubricas, personalizada: e.rubricas.sdr.map((c) => ({ ...c })) } }); set({ rubrica_modo: v }); }}
          opcoes={[["sistema", "Por função (recomendado)", "Uma rubrica para SDR e outra para Closer"], ["personalizada", "Personalizada", "Uma só para todo mundo"]]} />
        {s.rubrica_modo === "sistema" ? (
          <div className="mt-5 grid gap-6 xl:grid-cols-2">
            <div><div className="label mb-2">Rubrica do SDR</div><EditorRubrica lista={e.rubricas.sdr} onChange={(l) => setEst({ rubricas: { ...e.rubricas, sdr: l } })} /></div>
            <div><div className="label mb-2">Rubrica do Closer</div><EditorRubrica lista={e.rubricas.closer} onChange={(l) => setEst({ rubricas: { ...e.rubricas, closer: l } })} /></div>
          </div>
        ) : (
          <div className="mt-5"><p className="mb-3 text-xs text-warn">A personalizada vale para todos, sem diferenciar SDR de Closer.</p>
            <EditorRubrica lista={e.rubricas.personalizada} onChange={(l) => setEst({ rubricas: { ...e.rubricas, personalizada: l } })} /></div>
        )}
      </Card>

      <Card {...cardProps("vendas")} titulo="Detecção de vendas" resumo={`${regras(linhas(s.venda_conta), "conta")} · ${regras(linhas(s.venda_nao_conta), "não conta")}`}>
        <p className="mb-3 text-sm text-mute">Padrão: SDR vende quando o lead se inscreve no workshop (cupom de R$ 0 também conta, com o valor registrado). Closer vende só quando a imersão fecha. Reunião marcada nunca é venda. Use as listas para não inflar o número de vendas.</p>
        <div className="grid gap-5 lg:grid-cols-2">
          <div><div className="label mb-2 text-ok">Conta como venda</div><Regras linhas={s.venda_conta} onChange={(l) => set({ venda_conta: l })} sugestoes={SUGESTOES.venda_conta} placeholder="Uma situação por linha" /></div>
          <div><div className="label mb-2 text-bad">Não conta como venda</div><Regras linhas={s.venda_nao_conta} onChange={(l) => set({ venda_nao_conta: l })} sugestoes={SUGESTOES.venda_nao_conta} placeholder="Uma situação por linha" /></div>
        </div>
      </Card>

      <Card {...cardProps("oportunidades")} titulo="Detecção de oportunidades" resumo={`${regras(linhas(s.oportunidade_conta), "conta")} · ${regras(linhas(s.oportunidade_nao_conta), "não conta")}`}>
        <p className="mb-3 text-sm text-mute">Padrão: interesse real no workshop ou na imersão, reunião de imersão marcada (SDR) ou reunião de implementação marcada (Closer).</p>
        <div className="grid gap-5 lg:grid-cols-2">
          <div><div className="label mb-2 text-ok">Conta como oportunidade</div><Regras linhas={s.oportunidade_conta} onChange={(l) => set({ oportunidade_conta: l })} sugestoes={SUGESTOES.oportunidade_conta} placeholder="Uma situação por linha" /></div>
          <div><div className="label mb-2 text-bad">Não conta</div><Regras linhas={s.oportunidade_nao_conta} onChange={(l) => set({ oportunidade_nao_conta: l })} sugestoes={SUGESTOES.oportunidade_nao_conta} placeholder="Uma situação por linha" /></div>
        </div>
      </Card>

      {/* ---------- Rodape fixo ---------- */}
      <div className="sticky bottom-0 z-30 -mx-4 border-t border-line bg-bg/95 backdrop-blur md:-mx-12">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 md:px-12">
          <div className="min-w-0 flex-1 text-sm">
            {msg?.ok ? <span className="flex items-center gap-1.5 text-ok"><CheckCircle2 size={16} />Configurações salvas. A próxima rodada do Auditor já usa estes valores.</span>
              : msg?.erros ? <span className="text-bad">{msg.erros[0]}{msg.erros.length > 1 && ` (+${msg.erros.length - 1})`}</span>
              : sujo && erros.length ? <span className="text-warn">{erros[0]}</span>
              : sujo ? <span className="text-mute">Você tem alterações não salvas.</span>
              : <span className="text-mute">Nenhuma alteração.</span>}
          </div>
          <button type="button" onClick={descartar} disabled={!sujo || pend} className="btn-ghost disabled:opacity-40">Descartar</button>
          <button type="button" onClick={salvar} disabled={!sujo || pend || erros.length > 0} className="btn">{pend ? "Salvando..." : "Salvar"}</button>
        </div>
      </div>
    </div>
  );
}

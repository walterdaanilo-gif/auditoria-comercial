"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Bell, CalendarClock, CalendarDays, CheckCheck, ClipboardList, Clock, FileText, Info, Trophy, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Sino de notificacoes (canto superior direito): todos os avisos da pessoa, organizados por categoria.
// Le so as notificacoes de quem esta logado (RLS) e atualiza na hora pelo Supabase Realtime.
type Notif = { id: string; categoria: string | null; tipo: string; titulo: string; texto: string | null; link: string | null; lida: boolean; criado_em: string };
const CATS: { k: string; t: string; Icone: typeof Bell; cor: string }[] = [
  { k: "venda", t: "Vendas", Icone: Trophy, cor: "text-ok" },
  { k: "reuniao", t: "Reuniões", Icone: CalendarDays, cor: "text-brand" },
  { k: "followup", t: "Follow-up", Icone: Clock, cor: "text-warn" },
  { k: "diagnostico", t: "Diagnóstico", Icone: ClipboardList, cor: "text-warn" },
  { k: "agenda", t: "Agenda", Icone: CalendarClock, cor: "text-warn" },
  { k: "critico", t: "Críticos", Icone: AlertTriangle, cor: "text-bad" },
  { k: "resumo", t: "Resumos", Icone: FileText, cor: "text-mute" },
];
const catDe = (n: Notif) => n.categoria || (n.tipo === "critico" ? "critico" : n.tipo === "venda" ? "venda" : n.tipo === "oportunidade" ? "reuniao" : "outros");
const quando = (iso: string) => {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  if (min < 1440) return `há ${Math.floor(min / 60)} h`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
};

export default function Sino({ usuarioId }: { usuarioId: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [lista, setLista] = useState<Notif[]>([]);
  const [aberto, setAberto] = useState(false);
  const [aba, setAba] = useState("todas");
  const [expandida, setExpandida] = useState<string | null>(null);
  const caixa = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    const { data } = await supabase.from("notificacoes").select("id,categoria,tipo,titulo,texto,link,lida,criado_em").eq("para", usuarioId).order("criado_em", { ascending: false }).limit(80);
    if (data) setLista(data as Notif[]);
  }, [supabase, usuarioId]);

  useEffect(() => {
    carregar();
    const id = setInterval(carregar, 60_000);
    const canal = supabase.channel(`sino-${usuarioId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notificacoes", filter: `para=eq.${usuarioId}` }, carregar)
      .subscribe();
    return () => { clearInterval(id); supabase.removeChannel(canal); };
  }, [carregar, supabase, usuarioId]);

  // fecha clicando fora ou no Esc
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", fora); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto]);

  const naoLidas = lista.filter((n) => !n.lida);
  const visiveis = aba === "todas" ? lista : lista.filter((n) => catDe(n) === aba);
  const marcar = async (ids: string[]) => {
    if (!ids.length) return;
    setLista((l) => l.map((n) => (ids.includes(n.id) ? { ...n, lida: true } : n)));
    await supabase.from("notificacoes").update({ lida: true }).in("id", ids);
  };
  const abrir = (n: Notif) => {
    if (!n.lida) marcar([n.id]);
    if (n.categoria === "resumo" || (!n.link && n.texto)) { setExpandida(expandida === n.id ? null : n.id); return; }
    if (n.link) { setAberto(false); router.push(n.link); }
  };

  return (
    <div className="relative" ref={caixa}>
      <button type="button" onClick={() => setAberto((a) => !a)} aria-label={`Notificações${naoLidas.length ? `, ${naoLidas.length} não lidas` : ""}`} aria-expanded={aberto}
        className="relative grid h-10 w-10 place-items-center rounded-full border border-line text-ink transition hover:border-side-edge hover:text-brand">
        <Bell size={19} />
        {naoLidas.length > 0 && <span className="absolute -right-1 -top-1 min-w-[20px] rounded-full bg-bad px-1.5 text-center text-[11px] font-bold leading-5 text-white">{naoLidas.length > 99 ? "99+" : naoLidas.length}</span>}
      </button>

      {aberto && (
        <div className="fixed inset-x-2 top-[80px] z-50 flex max-h-[78vh] flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-[0_18px_50px_rgba(0,0,0,0.5)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[440px]">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <b className="text-base">Notificações</b>
            {naoLidas.length > 0 && <span className="rounded-full bg-bad/15 px-2 text-xs font-semibold text-bad">{naoLidas.length} nova{naoLidas.length === 1 ? "" : "s"}</span>}
            <button type="button" onClick={() => marcar(naoLidas.map((n) => n.id))} disabled={!naoLidas.length} className="ml-auto flex items-center gap-1 text-xs font-semibold text-brand disabled:text-mute"><CheckCheck size={14} />Marcar tudo como lido</button>
            <button type="button" onClick={() => setAberto(false)} aria-label="Fechar" className="text-mute hover:text-ink"><X size={16} /></button>
          </div>
          <div className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2" role="tablist">
            {[{ k: "todas", t: "Todas" }, ...CATS].map((c) => {
              const n = (c.k === "todas" ? naoLidas : naoLidas.filter((x) => catDe(x) === c.k)).length;
              if (c.k !== "todas" && !lista.some((x) => catDe(x) === c.k)) return null;
              return (
                <button key={c.k} type="button" role="tab" aria-selected={aba === c.k} onClick={() => setAba(c.k)}
                  className={`flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${aba === c.k ? "border-side-edge bg-side-active text-ink" : "border-line text-mute hover:text-ink"}`}>
                  {c.t}{n > 0 && <span className="rounded-full bg-bad px-1.5 text-[10px] text-white">{n}</span>}
                </button>
              );
            })}
          </div>
          <ul className="flex-1 divide-y divide-line overflow-y-auto">
            {visiveis.map((n) => {
              const cat = CATS.find((c) => c.k === catDe(n));
              const Icone = cat?.Icone ?? Info;
              const aberta = expandida === n.id;
              return (
                <li key={n.id}>
                  <button type="button" onClick={() => abrir(n)} className={`flex w-full gap-3 px-4 py-3 text-left transition hover:bg-white/[0.03] ${n.lida ? "" : "bg-brand/[0.06]"}`}>
                    <Icone size={18} className={`mt-0.5 shrink-0 ${cat?.cor ?? "text-mute"}`} />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${n.lida ? "text-side-text/85" : "font-semibold text-ink"}`}>{n.titulo}</span>
                      {n.texto && <span className={`mt-0.5 block whitespace-pre-line text-xs text-mute ${aberta ? "" : "line-clamp-2"}`}>{n.texto}</span>}
                      <span className="mt-1 block text-[11px] text-mute">{quando(n.criado_em)}{n.categoria === "resumo" ? (aberta ? " · clique para recolher" : " · clique para ler tudo") : ""}</span>
                    </span>
                    {!n.lida && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-label="não lida" />}
                  </button>
                </li>
              );
            })}
            {!visiveis.length && <li className="px-4 py-10 text-center text-sm text-mute">Nada por aqui ainda. Vendas, reuniões, follow-ups atrasados, conflitos de agenda e resumos aparecem aqui.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

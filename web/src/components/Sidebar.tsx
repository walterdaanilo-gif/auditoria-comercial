"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, ChevronsLeft, ChevronsRight, FileText, MessagesSquare, Phone, Smartphone, Users, type LucideIcon } from "lucide-react";
import type { Papel } from "@/lib/types";

type Item = { href: string; texto: string; icone: LucideIcon };

export function itensMenu(papel: Papel): Item[] {
  return [
    { href: "/", texto: "Painel", icone: BarChart3 },
    { href: "/conversas", texto: "Conversas", icone: MessagesSquare },
    { href: "/ligacoes", texto: "Ligações", icone: Phone },
    ...(papel !== "vendedor" ? [{ href: "/instancias", texto: "WhatsApp", icone: Smartphone }] : []),
    ...(papel === "admin" ? [{ href: "/admin/usuarios", texto: "Usuários", icone: Users }, { href: "/admin/roteiro", texto: "Roteiro", icone: FileText }] : []),
  ];
}

export const ativo = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

// Menu lateral no estilo Weevo: degrade verde, itens em pilula com borda e botao Recolher
export default function Sidebar({ papel }: { papel: Papel }) {
  const path = usePathname();
  const [recolhido, setRecolhido] = useState(false);
  useEffect(() => { try { setRecolhido(localStorage.getItem("menu-recolhido") === "1"); } catch {} }, []);
  const alternar = () => { const v = !recolhido; setRecolhido(v); try { localStorage.setItem("menu-recolhido", v ? "1" : "0"); } catch {} };

  return (
    <aside className={`sticky top-0 hidden h-screen shrink-0 flex-col bg-gradient-to-b from-side-top via-side-mid to-side-bottom px-2.5 py-6 transition-all md:flex ${recolhido ? "w-[76px]" : "w-72"}`}>
      <div className={`flex items-center gap-4 px-3 ${recolhido ? "justify-center px-0" : ""}`}>
        <img src="/weevo-icone.png" alt="Weevo" className="h-7 w-auto" />
        {!recolhido && <span className="text-[13px] font-semibold tracking-[0.35em] text-side-text/80">AUDITORIA</span>}
      </div>
      <div className="mx-3.5 my-6 h-0.5 rounded bg-side-edge/70" />
      <nav className="flex flex-col gap-3">
        {itensMenu(papel).map(({ href, texto, icone: Icone }) => {
          const on = ativo(path, href);
          return (
            <Link key={href} href={href} title={texto}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 text-[17px] font-semibold transition ${recolhido ? "justify-center px-0" : ""} ${on ? "border-side-edge bg-side-active text-ink shadow-[0_6px_18px_rgba(0,0,0,0.25)]" : "border-white/10 bg-white/[0.03] text-side-text/85 hover:border-side-edge hover:text-ink"}`}>
              <Icone size={19} strokeWidth={1.8} className="shrink-0" />{!recolhido && texto}
            </Link>
          );
        })}
      </nav>
      <button onClick={alternar} className={`mt-auto flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3.5 text-[17px] font-semibold text-side-text/85 transition hover:border-side-edge hover:text-ink ${recolhido ? "justify-center px-0" : ""}`}>
        {recolhido ? <ChevronsRight size={19} /> : <><ChevronsLeft size={19} />Recolher</>}
      </button>
    </aside>
  );
}

// No celular o menu lateral some e vira uma faixa horizontal abaixo da barra de cima
export function MenuCelular({ papel }: { papel: Papel }) {
  const path = usePathname();
  return (
    <nav className="flex gap-2 overflow-x-auto border-b border-line px-4 py-2 md:hidden">
      {itensMenu(papel).map(({ href, texto, icone: Icone }) => (
        <Link key={href} href={href} className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-semibold ${ativo(path, href) ? "border-side-edge bg-side-active text-ink" : "border-line text-mute"}`}>
          <Icone size={15} />{texto}
        </Link>
      ))}
    </nav>
  );
}

import Link from "next/link";
import type { Perfil } from "@/lib/types";

export default function Nav({ perfil }: { perfil: Perfil }) {
  const links = [
    { href: "/", texto: "Painel" },
    { href: "/conversas", texto: "Conversas" },
    { href: "/ligacoes", texto: "Ligações" },
    ...(perfil.papel !== "vendedor" ? [{ href: "/instancias", texto: "WhatsApp" }] : []),
    ...(perfil.papel === "admin" ? [{ href: "/admin/usuarios", texto: "Usuários" }, { href: "/admin/roteiro", texto: "Roteiro" }] : []),
  ];
  return (
    <header className="border-b border-line bg-card">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
        <b className="mr-2">Auditoria Comercial</b>
        <nav className="flex flex-wrap gap-4 text-sm">
          {links.map((l) => <Link key={l.href} href={l.href} className="text-mute hover:text-ink">{l.texto}</Link>)}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="text-mute">{perfil.nome} · {perfil.papel}</span>
          <form action="/logout" method="post"><button className="btn-ghost">Sair</button></form>
        </div>
      </div>
    </header>
  );
}

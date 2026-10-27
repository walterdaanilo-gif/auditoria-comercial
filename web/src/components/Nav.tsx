import Link from "next/link";
import { Building2 } from "lucide-react";
import type { Perfil } from "@/lib/types";
import Sino from "./Sino";

const PAPEL: Record<string, string> = { admin: "Admin", gestor: "Gestor", vendedor: "Vendedor" };
const iniciais = (nome: string) => nome.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";

// Barra de cima no estilo Weevo: logo a esquerda; sino de notificacoes, Sair e usuario a direita
export default function Nav({ perfil, empresa, podeTrocar }: { perfil: Perfil; empresa: string | null; podeTrocar: boolean }) {
  return (
    <header className="flex h-[76px] items-center border-b border-line/70 bg-[#0f1b1b]/80 px-4 backdrop-blur md:px-8">
      <img src="/weevo-logo.png" alt="Weevo" className="h-6 w-auto md:h-7" />
      {/* retaguarda aberta agora; quem tem acesso a mais de uma empresa troca por aqui */}
      {empresa && (podeTrocar
        ? <Link href="/empresa" title="Trocar retaguarda" className="ml-4 flex items-center gap-1.5 rounded-xl border border-side-edge/60 px-3 py-1.5 text-sm font-semibold text-ink hover:border-brand hover:text-brand"><Building2 size={15} />{empresa}<span className="hidden text-xs font-normal text-mute md:inline">· trocar</span></Link>
        : <span className="ml-4 hidden text-sm font-semibold text-mute md:inline">{empresa}</span>)}
      <div className="ml-auto flex items-center gap-4 md:gap-5">
        <Sino usuarioId={perfil.id} />
        <form action="/logout" method="post"><button className="text-[15px] font-semibold text-ink hover:text-brand">Sair</button></form>
        <div className="flex items-center gap-3">
          {perfil.foto_url
            ? <img src={perfil.foto_url} alt={`Foto de ${perfil.nome}`} className="h-10 w-10 rounded-full object-cover ring-2 ring-line" />
            : <span className="grid h-10 w-10 place-items-center rounded-full bg-track text-sm font-bold">{iniciais(perfil.nome)}</span>}
          <div className="hidden leading-tight sm:block">
            <div className="text-[15px] font-bold">{perfil.nome}</div>
            <div className="text-xs text-mute">{PAPEL[perfil.papel] ?? perfil.papel}</div>
          </div>
        </div>
      </div>
    </header>
  );
}

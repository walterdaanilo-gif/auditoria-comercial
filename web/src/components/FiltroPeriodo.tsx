import Link from "next/link";
import { CalendarDays } from "lucide-react";
import type { Periodo } from "@/lib/periodo";

// Linha de filtros acima de tudo: atalhos de periodo, datas livres e (para gestor) o vendedor
export default function FiltroPeriodo({ base, periodo, vendedores, vendedor }: {
  base: string; periodo: Periodo; vendedores?: [string, string][]; vendedor?: string;
}) {
  const extra: Record<string, string> = vendedor ? { v: vendedor } : {};
  const href = (p: string) => `${base}?${new URLSearchParams({ p, ...extra })}`;
  return (
    <div className="card flex flex-wrap items-end gap-3 !p-4">
      <div className="flex flex-wrap gap-2">
        {[["hoje", "Hoje"], ["7", "7 dias"], ["30", "30 dias"]].map(([k, t]) => (
          <Link key={k} href={href(k)} className={`chip !px-3.5 !py-1.5 text-sm ${periodo.p === k ? "chip-on" : "border-line hover:border-side-edge"}`}>{t}</Link>
        ))}
      </div>
      <form action={base} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-mute">De<input type="date" name="de" defaultValue={periodo.de} className="input mt-1 !w-auto !py-1.5" /></label>
        <label className="flex flex-col text-xs text-mute">Até<input type="date" name="ate" defaultValue={periodo.ate} className="input mt-1 !w-auto !py-1.5" /></label>
        {vendedores && (
          <label className="flex flex-col text-xs text-mute">Vendedor
            <select name="v" defaultValue={vendedor ?? ""} className="input mt-1 !w-auto !py-1.5">
              <option value="">Todos</option>{vendedores.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </select>
          </label>
        )}
        <button className="btn-ghost !py-2"><CalendarDays size={16} />Aplicar</button>
      </form>
      <span className="ml-auto text-sm text-mute">{periodo.rotulo}</span>
    </div>
  );
}

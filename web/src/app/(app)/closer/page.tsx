import { redirect } from "next/navigation";
import { exigirPerfil } from "@/lib/auth";
import { listarLeads, modoLocal } from "@/lib/closer/dados";
import PainelCloser from "./PainelCloser";

export const dynamic = "force-dynamic";
export const metadata = { title: "Closer · Cabueta do Elon Musk" };

export default async function Closer() {
  const perfil = await exigirPerfil();
  if (perfil.papel === "vendedor" && perfil.funcao !== "closer") redirect("/");
  const { leads, erro } = await listarLeads();
  return <PainelCloser leads={leads} erro={erro} podeImportar={perfil.papel !== "vendedor"} local={modoLocal()} />;
}

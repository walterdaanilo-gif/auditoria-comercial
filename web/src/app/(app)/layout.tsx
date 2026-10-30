import Nav from "@/components/Nav";
import Sidebar, { MenuCelular } from "@/components/Sidebar";
import { empresas, exigirPerfil } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const perfil = await exigirPerfil();
  const { todas, atual } = await empresas(perfil);
  return (
    // data-org troca as cores (Weevo ou Carbone) de tudo que esta dentro
    <div data-org={atual?.slug ?? "weevo"} className="fundo-org flex min-h-screen">
      <Sidebar papel={perfil.papel} funcao={perfil.funcao} empresa={atual ? { slug: atual.slug, nome: atual.nome } : null} />
      <div className="min-w-0 flex-1">
        <Nav perfil={perfil} empresa={atual ? { slug: atual.slug, nome: atual.nome } : null} podeTrocar={todas.length > 1} />
        <MenuCelular papel={perfil.papel} funcao={perfil.funcao} />
        <main className="mx-auto max-w-[1400px] px-4 py-8 md:px-12 md:py-10">{children}</main>
      </div>
    </div>
  );
}

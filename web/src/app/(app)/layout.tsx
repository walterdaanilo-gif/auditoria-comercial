import Nav from "@/components/Nav";
import Sidebar, { MenuCelular } from "@/components/Sidebar";
import { exigirPerfil } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const perfil = await exigirPerfil();
  return (
    <div className="flex min-h-screen">
      <Sidebar papel={perfil.papel} />
      <div className="min-w-0 flex-1">
        <Nav perfil={perfil} />
        <MenuCelular papel={perfil.papel} />
        <main className="mx-auto max-w-[1400px] px-4 py-8 md:px-12 md:py-10">{children}</main>
      </div>
    </div>
  );
}

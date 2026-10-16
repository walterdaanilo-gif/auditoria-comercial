import Nav from "@/components/Nav";
import { exigirPerfil } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const perfil = await exigirPerfil();
  return (
    <>
      <Nav perfil={perfil} />
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </>
  );
}

import AuthShell from "@/components/AuthShell";
import LoginForm from "./LoginForm";

export default async function LoginPage({ searchParams: searchParamsP }: { searchParams: Promise<{ erro?: string }> }) {
  const searchParams = await searchParamsP;
  return (
    <AuthShell titulo="Entrar" subtitulo="Acesse o Cabueta do Elon Musk: a auditoria das conversas e ligações do time comercial.">
      {searchParams.erro === "inativo" && <p className="mb-5 rounded-2xl border border-bad/60 p-3 text-sm text-bad">Seu acesso está desativado. Fale com o administrador.</p>}
      <LoginForm />
    </AuthShell>
  );
}

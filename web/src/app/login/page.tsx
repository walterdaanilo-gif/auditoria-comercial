import LoginForm from "./LoginForm";

export default async function LoginPage({ searchParams: searchParamsP }: { searchParams: Promise<{ erro?: string }> }) {
  const searchParams = await searchParamsP;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="mb-1 text-2xl font-bold">Auditoria Comercial</h1>
      <p className="mb-6 text-sm text-mute">Entre com o e-mail e a senha que o administrador criou para você.</p>
      {searchParams.erro === "inativo" && <p className="mb-4 rounded-lg border border-bad p-3 text-sm text-bad">Seu acesso está desativado. Fale com o administrador.</p>}
      <LoginForm />
    </main>
  );
}

"use client";
import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function RecuperarSenha() {
  const [email, setEmail] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [carregando, setCarregando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    const base = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    await createClient().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${base}/auth/callback?next=/redefinir-senha` });
    setEnviado(true); setCarregando(false); // mesma resposta exista o e-mail ou nao
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="mb-1 text-2xl font-bold">Recuperar senha</h1>
      <p className="mb-6 text-sm text-mute">Enviamos um link para você criar uma nova senha.</p>
      {enviado ? (
        <div className="card text-sm">Se esse e-mail estiver cadastrado, o link chega em instantes. Confira também o spam.</div>
      ) : (
        <form onSubmit={enviar} className="card space-y-3">
          <div><label className="label">E-mail</label><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <button className="btn w-full" disabled={carregando}>{carregando ? "Enviando..." : "Enviar link"}</button>
        </form>
      )}
      <p className="mt-4 text-center text-sm"><Link className="text-brand" href="/login">Voltar ao login</Link></p>
    </main>
  );
}

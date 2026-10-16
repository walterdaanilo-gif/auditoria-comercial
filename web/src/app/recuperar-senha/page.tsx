"use client";
import AuthShell from "@/components/AuthShell";
import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function RecuperarSenha() {
  const [email, setEmail] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    const base = window.location.origin; // o proprio endereco do site: nao depende de variavel na Vercel
    const { error } = await createClient().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${base}/auth/callback?next=/redefinir-senha` });
    setCarregando(false);
    // e-mail inexistente nao gera erro (mesma resposta). Erro aqui e configuracao, limite de envio ou servidor
    if (error) return setErro(error.status === 429 ? "Muitos pedidos seguidos. Espere alguns minutos e tente de novo." : "Não foi possível enviar agora. Avise o administrador.");
    setEnviado(true);
  }

  return (
    <AuthShell titulo="Recuperar senha" subtitulo="Enviamos um link para você criar uma nova senha.">
      {enviado ? (
        <p className="rounded-2xl border border-white/15 bg-white/5 p-4 text-[17px]">Se esse e-mail estiver cadastrado, o link chega em instantes. Confira também o spam.</p>
      ) : (
        <form onSubmit={enviar} className="space-y-5">
          <div><label className="auth-label" htmlFor="email">E-mail</label>
            <input id="email" className="auth-input" type="email" required placeholder="voce@weevoedu.com" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          {erro && <p className="text-sm text-bad">{erro}</p>}
          <button className="auth-btn" disabled={carregando}>{carregando ? "Enviando..." : "Enviar link"}</button>
        </form>
      )}
      <p className="mt-6 text-center"><Link className="text-[17px] font-semibold text-brand" href="/login">Voltar ao login</Link></p>
    </AuthShell>
  );
}

"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(""); setCarregando(true);
    const { error } = await createClient().auth.signInWithPassword({ email: email.trim(), password: senha });
    if (error) {
      // 400 = credenciais erradas. Outros codigos (401, 5xx, rede) sao problema de configuracao ou do servidor
      setErro(error.status === 400 ? "E-mail ou senha incorretos." : "Não foi possível conectar ao servidor. Avise o administrador.");
      setCarregando(false); return;
    }
    router.replace("/empresa");
    router.refresh();
  }

  return (
    <form onSubmit={entrar} className="space-y-5">
      <div><label className="auth-label" htmlFor="email">E-mail</label>
        <input id="email" className="auth-input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div>
        <div className="mb-2 flex items-center justify-between"><label className="auth-label !mb-0" htmlFor="senha">Senha</label>
          <Link className="text-[17px] font-semibold text-brand hover:brightness-110" href="/recuperar-senha">Esqueci a senha</Link></div>
        <input id="senha" className="auth-input" type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
      </div>
      {erro && <p className="text-sm text-bad">{erro}</p>}
      <button className="auth-btn" disabled={carregando}>{carregando ? "Entrando..." : "Entrar"}</button>
    </form>
  );
}

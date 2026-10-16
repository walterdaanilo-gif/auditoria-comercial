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
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={entrar} className="card space-y-3">
      <div><label className="label">E-mail</label><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div><label className="label">Senha</label><input className="input" type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} /></div>
      {erro && <p className="text-sm text-bad">{erro}</p>}
      <button className="btn w-full" disabled={carregando}>{carregando ? "Entrando..." : "Entrar"}</button>
      <p className="text-center text-sm"><Link className="text-brand" href="/recuperar-senha">Esqueci minha senha</Link></p>
    </form>
  );
}

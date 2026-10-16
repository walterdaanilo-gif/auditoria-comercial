"use client";
import AuthShell from "@/components/AuthShell";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function RedefinirSenha() {
  const router = useRouter();
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (senha.length < 8) return setErro("Use pelo menos 8 caracteres.");
    if (senha !== confirma) return setErro("As senhas não são iguais.");
    setErro(""); setCarregando(true);
    const { error } = await createClient().auth.updateUser({ password: senha });
    if (error) { setErro("Não foi possível salvar. O link pode ter expirado, peça outro."); setCarregando(false); return; }
    router.replace("/");
    router.refresh();
  }

  return (
    <AuthShell titulo="Nova senha" subtitulo="Crie uma senha com pelo menos 8 caracteres.">
      <form onSubmit={salvar} className="space-y-5">
        <div><label className="auth-label" htmlFor="senha">Nova senha</label>
          <input id="senha" className="auth-input" type="password" autoComplete="new-password" required value={senha} onChange={(e) => setSenha(e.target.value)} /></div>
        <div><label className="auth-label" htmlFor="confirma">Repita a senha</label>
          <input id="confirma" className="auth-input" type="password" autoComplete="new-password" required value={confirma} onChange={(e) => setConfirma(e.target.value)} /></div>
        {erro && <p className="text-sm text-bad">{erro}</p>}
        <button className="auth-btn" disabled={carregando}>{carregando ? "Salvando..." : "Salvar senha"}</button>
      </form>
    </AuthShell>
  );
}

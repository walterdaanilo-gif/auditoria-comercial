"use client";
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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="mb-6 text-2xl font-bold">Nova senha</h1>
      <form onSubmit={salvar} className="card space-y-3">
        <div><label className="label">Nova senha</label><input className="input" type="password" autoComplete="new-password" required value={senha} onChange={(e) => setSenha(e.target.value)} /></div>
        <div><label className="label">Repita a senha</label><input className="input" type="password" autoComplete="new-password" required value={confirma} onChange={(e) => setConfirma(e.target.value)} /></div>
        {erro && <p className="text-sm text-bad">{erro}</p>}
        <button className="btn w-full" disabled={carregando}>{carregando ? "Salvando..." : "Salvar senha"}</button>
      </form>
    </main>
  );
}

"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { criarUsuario, type Resultado } from "./actions";

function Botao() {
  const { pending } = useFormStatus();
  return <button className="btn" disabled={pending}>{pending ? "Criando..." : "Criar usuário"}</button>;
}

export default function NovoUsuarioForm() {
  const [res, action] = useActionState<Resultado, FormData>(criarUsuario, null);
  return (
    <form action={action} className="card grid gap-3 md:grid-cols-5">
      <div><label className="label">Nome</label><input name="nome" className="input" required /></div>
      <div><label className="label">E-mail</label><input name="email" type="email" className="input" required /></div>
      <div><label className="label">Senha inicial</label><input name="senha" type="password" minLength={8} autoComplete="new-password" className="input" required /></div>
      <div><label className="label">Papel</label>
        <select name="papel" className="input" defaultValue="vendedor">
          <option value="vendedor">Vendedor</option><option value="gestor">Gestor</option><option value="admin">Admin</option>
        </select></div>
      <div className="flex items-end"><Botao /></div>
      {res?.erro && <p className="text-sm text-bad md:col-span-5">{res.erro}</p>}
      {res?.ok && <p className="text-sm text-ok md:col-span-5">Usuário criado. Passe o e-mail e a senha inicial para a pessoa.</p>}
    </form>
  );
}

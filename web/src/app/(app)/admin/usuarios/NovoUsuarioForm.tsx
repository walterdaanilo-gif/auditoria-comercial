"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { criarUsuario, type Resultado } from "./actions";
import type { Organizacao } from "@/lib/types";

function Botao() {
  const { pending } = useFormStatus();
  return <button className="btn" disabled={pending}>{pending ? "Criando..." : "Criar usuário"}</button>;
}

// empresas: so para o dono das empresas, que escolhe a retaguarda; o admin comum cria na empresa aberta
export default function NovoUsuarioForm({ empresas, aberta }: { empresas: Organizacao[]; aberta: string | null }) {
  const [res, action] = useActionState<Resultado, FormData>(criarUsuario, null);
  return (
    <form action={action} className="card grid gap-3 md:grid-cols-6">
      <div><label className="label">Nome</label><input name="nome" className="input" required /></div>
      <div><label className="label">E-mail</label><input name="email" type="email" className="input" required /></div>
      <div><label className="label">Senha inicial</label><input name="senha" type="password" minLength={8} autoComplete="new-password" className="input" required /></div>
      <div><label className="label">Papel</label>
        <select name="papel" className="input" defaultValue="vendedor">
          <option value="vendedor">Vendedor</option><option value="gestor">Gestor</option><option value="admin">Admin</option>
        </select></div>
      <div><label className="label">Função</label>
        <select name="funcao" className="input" defaultValue="sdr"><option value="sdr">SDR</option><option value="closer">Closer</option><option value="gestao">Gestão</option></select></div>
      <div className="flex items-end"><Botao /></div>
      <label className="flex items-center gap-2 text-sm md:col-span-6"><input type="checkbox" name="whatsapp" defaultChecked />Já criar a conexão de WhatsApp desta pessoa (o QR Code aparece no cartão dela, logo abaixo)</label>
      {empresas.length > 0 && (
        <div className="md:col-span-6"><span className="label">Retaguarda</span>
          <div className="flex flex-wrap gap-4">{empresas.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="orgs" value={o.id} defaultChecked={o.id === aberta} />{o.nome}</label>
          ))}</div>
        </div>
      )}
      {res?.erro && <p className="text-sm text-bad md:col-span-6">{res.erro}</p>}
      {res?.ok && <p className="text-sm text-ok md:col-span-6">Usuário criado. Passe o e-mail e a senha inicial para a pessoa.</p>}
    </form>
  );
}

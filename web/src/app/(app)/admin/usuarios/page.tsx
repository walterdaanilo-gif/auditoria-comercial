import { exigirAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Perfil } from "@/lib/types";
import { fmtDataHora } from "@/lib/format";
import NovoUsuarioForm from "./NovoUsuarioForm";
import { atualizarUsuario, redefinirSenha } from "./actions";

export default async function Usuarios({ searchParams: searchParamsP }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const searchParams = await searchParamsP;
  const eu = await exigirAdmin();
  const { data } = await (await createClient()).from("profiles").select("*").order("criado_em");
  const usuarios = (data ?? []) as Perfil[];

  return (
    <div className="space-y-5">
      <div><h1 className="text-xl font-bold">Usuários</h1><p className="text-sm text-mute">Só o admin cria usuários. Não existe cadastro público.</p></div>
      {searchParams.erro && <p className="card border-bad text-sm text-bad">{searchParams.erro}</p>}
      {searchParams.ok && <p className="card border-ok text-sm text-ok">{searchParams.ok}</p>}
      <NovoUsuarioForm />
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead><tr><th className="th">Nome</th><th className="th">E-mail</th><th className="th">Papel</th><th className="th">Ativo</th><th className="th">Criado</th><th className="th"></th></tr></thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id}>
                <td className="td" colSpan={6}>
                  <form action={atualizarUsuario} className="grid items-center gap-2 md:grid-cols-[1.2fr_1.4fr_0.8fr_0.5fr_0.8fr_auto]">
                    <input type="hidden" name="id" value={u.id} />
                    <input name="nome" defaultValue={u.nome} className="input" required />
                    <span className="truncate text-mute">{u.email}</span>
                    <select name="papel" defaultValue={u.papel} className="input">
                      <option value="vendedor">Vendedor</option><option value="gestor">Gestor</option><option value="admin">Admin</option>
                    </select>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="ativo" defaultChecked={u.ativo} /> {u.id === eu.id ? "você" : "ativo"}</label>
                    <span className="text-xs text-mute">{fmtDataHora(u.criado_em)}</span>
                    <button className="btn-ghost">Salvar</button>
                  </form>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-mute">Redefinir senha</summary>
                    <form action={redefinirSenha} className="mt-2 flex gap-2">
                      <input type="hidden" name="id" value={u.id} />
                      <input name="senha" type="password" minLength={8} autoComplete="new-password" placeholder="Nova senha (mín. 8)" className="input max-w-xs" required />
                      <button className="btn-ghost">Definir</button>
                    </form>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

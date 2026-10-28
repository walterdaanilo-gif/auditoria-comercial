import { empresas, exigirAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Perfil } from "@/lib/types";
import { fmtDataHora } from "@/lib/format";
import NovoUsuarioForm from "./NovoUsuarioForm";
import BotaoExcluir from "./BotaoExcluir";
import { atualizarUsuario, redefinirSenha } from "./actions";

export default async function Usuarios({ searchParams: searchParamsP }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const searchParams = await searchParamsP;
  const eu = await exigirAdmin();
  const { todas, atual } = await empresas(eu);
  // usuarios da retaguarda aberta (a RLS ja limita o admin comum a empresa dele)
  const { data } = await (await createClient()).from("profiles").select("*").order("criado_em");
  // so quem entra na retaguarda aberta (a principal ou com acesso a ela); o dono das empresas aparece em todas
  const usuarios = ((data ?? []) as Perfil[]).filter((u) => !atual || u.super_admin || u.org_id === atual.id || (u.orgs_acesso ?? []).includes(atual.id));
  const nomeOrg = (id: string) => todas.find((o) => o.id === id)?.nome ?? "outra empresa";
  const acessos = (u: Perfil) => [...new Set([u.org_id, ...(u.orgs_acesso ?? [])])];

  return (
    <div className="space-y-5">
      <div><h1 className="page-title">Usuários</h1><p className="page-sub">Só o admin cria usuários. Não existe cadastro público. Trocar o e-mail muda o login da pessoa na hora; a senha continua a mesma.{` Você está vendo os usuários da retaguarda ${atual?.nome ?? ""}.`}{eu.super_admin ? " Em Retaguarda você escolhe em quais empresas a pessoa entra." : ""}</p></div>
      {searchParams.erro && <p className="card border-bad text-sm text-bad">{searchParams.erro}</p>}
      {searchParams.ok && <p className="card border-ok text-sm text-ok">{searchParams.ok}</p>}
      <NovoUsuarioForm empresas={eu.super_admin ? todas : []} aberta={atual?.id ?? null} />
      <div className="space-y-3">
        {usuarios.map((u) => (
          <div key={u.id} className={`card ${u.ativo ? "" : "opacity-70"}`}>
            <form action={atualizarUsuario} className="grid items-end gap-3 md:grid-cols-6">
              <input type="hidden" name="id" value={u.id} />
              <div className="md:col-span-2"><label className="label">Nome</label><input name="nome" defaultValue={u.nome} className="input" required /></div>
              <div className="md:col-span-2"><label className="label">E-mail de login</label><input name="email" type="email" defaultValue={u.email?.endsWith("@sem-login.invalid") ? "" : u.email} placeholder="E-mail de login" autoComplete="off" className="input" /></div>
              <div><label className="label">Papel</label>
                <select name="papel" defaultValue={u.papel} className="input"><option value="vendedor">Vendedor</option><option value="gestor">Gestor</option><option value="admin">Admin</option></select></div>
              <div><label className="label">Função</label>
                <select name="funcao" defaultValue={u.funcao ?? "sdr"} className="input"><option value="sdr">SDR</option><option value="closer">Closer</option></select></div>
              <div className="md:col-span-2"><label className="label">Conversas vêm do</label>
                <select name="fonte_conversas" defaultValue={u.fonte_conversas ?? "whatsapp"} className="input"><option value="crm">CRM Q5</option><option value="whatsapp">WhatsApp conectado aqui</option></select></div>
              <div className="md:col-span-2">
                <label className="label">Retaguarda</label>
                {eu.super_admin
                  ? <div className="flex flex-wrap gap-4 py-2">{todas.map((o) => (
                      <label key={o.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="orgs" value={o.id} defaultChecked={u.super_admin || acessos(u).includes(o.id)} disabled={u.super_admin} />{o.nome}</label>
                    ))}{u.super_admin && <span className="text-xs text-mute">dono: acessa todas</span>}</div>
                  : <p className="py-2 text-sm">{acessos(u).map(nomeOrg).join(" · ")}</p>}
              </div>
              <label className="flex items-center gap-2 py-2 text-sm"><input type="checkbox" name="ativo" defaultChecked={u.ativo} /> {u.id === eu.id ? "você" : "ativo"}</label>
              <button className="btn-ghost">Salvar</button>
            </form>
            <div className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-2 border-t border-line/60 pt-3">
              <details>
                <summary className="cursor-pointer text-xs text-mute">Redefinir senha</summary>
                <form action={redefinirSenha} className="mt-2 flex gap-2">
                  <input type="hidden" name="id" value={u.id} />
                  <input name="senha" type="password" minLength={8} autoComplete="new-password" placeholder="Nova senha (mín. 8)" className="input max-w-xs" required />
                  <button className="btn-ghost">Definir</button>
                </form>
              </details>
              {u.id !== eu.id && <BotaoExcluir id={u.id} nome={u.nome} podeApagar={eu.super_admin} />}
              {!u.ativo && <span className="text-xs text-warn">inativo</span>}
              <span className="ml-auto text-xs text-mute">criado em {fmtDataHora(u.criado_em)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import AutoRefresh from "@/components/AutoRefresh";
import { empresas, exigirGestor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Instancia, Perfil } from "@/lib/types";
import { fmtDataHora } from "@/lib/format";
import NovoUsuarioForm from "./NovoUsuarioForm";
import BotaoExcluir from "./BotaoExcluir";
import WhatsAppDoUsuario from "./WhatsAppDoUsuario";
import { atualizarUsuario, redefinirSenha } from "./actions";
import { criarVendedorWhatsApp } from "./whatsapp-actions";

export const dynamic = "force-dynamic";
const PAPEL: Record<string, string> = { admin: "Admin", gestor: "Gestor", vendedor: "Vendedor" };
const FUNCAO: Record<string, string> = { sdr: "SDR", closer: "Closer", gestao: "Gestão" };

// Usuarios + conexao de WhatsApp de cada pessoa (antes eram duas abas). Gestor e admin veem tudo; so o admin cria e edita.
export default async function Usuarios({ searchParams: searchParamsP }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const searchParams = await searchParamsP;
  const eu = await exigirGestor();
  const admin = eu.papel === "admin";
  const { todas, atual } = await empresas(eu);
  // usuarios da retaguarda aberta (a RLS ja limita o admin comum a empresa dele)
  const db = await createClient();
  const [{ data }, { data: instData }, { data: ws }] = await Promise.all([
    db.from("profiles").select("*").order("criado_em"),
    db.from("instancias_whatsapp").select("*").order("criado_em"),
    db.from("worker_status").select("visto_em").eq("id", 1).maybeSingle(),
  ]);
  // so quem entra na retaguarda aberta (a principal ou com acesso a ela); o dono das empresas aparece em todas
  const usuarios = ((data ?? []) as Perfil[]).filter((u) => !atual || u.super_admin || u.org_id === atual.id || (u.orgs_acesso ?? []).includes(atual.id));
  const insts = (instData ?? []) as Instancia[];
  const nomeOrg = (id: string) => todas.find((o) => o.id === id)?.nome ?? "outra empresa";
  const acessos = (u: Perfil) => [...new Set([u.org_id, ...(u.orgs_acesso ?? [])])];
  // O worker atualiza visto_em a cada ciclo. Mais de 3 minutos sem sinal = desligado ou travado.
  const vistoEm = (ws as { visto_em: string } | null)?.visto_em;
  const workerLigado = !!vistoEm && Date.now() - new Date(vistoEm).getTime() < 180_000;
  const pendente = insts.some((i) => i.status !== "conectado");

  return (
    <div className="space-y-5">
      {/* enquanto alguma conexao espera o QR, atualiza a cada 5 s; depois, a cada minuto */}
      <AutoRefresh segundos={pendente ? 5 : 60} tabelas={["instancias_whatsapp"]} />
      <div><h1 className="page-title">Usuários e WhatsApp</h1>
        <p className="page-sub">{admin
          ? <>Cada pessoa tem aqui o login e a conexão de WhatsApp dela. Só o admin cria usuários. Não existe cadastro público. Trocar o e-mail muda o login da pessoa na hora; a senha continua a mesma.{` Você está vendo os usuários da retaguarda ${atual?.nome ?? ""}.`}{eu.super_admin ? " Em Retaguarda você escolhe em quais empresas a pessoa entra." : ""}</>
          : <>Cada pessoa do time com a conexão de WhatsApp dela. Só o admin cria e edita usuários.{` Retaguarda ${atual?.nome ?? ""}.`}</>}</p></div>
      {searchParams.erro && <p className="card border-bad text-sm text-bad">{searchParams.erro}</p>}
      {searchParams.ok && <p className="card border-ok text-sm text-ok">{searchParams.ok}</p>}
      {workerLigado ? (
        <div className="card flex items-center gap-3 !py-3 text-sm"><CheckCircle2 size={18} className="shrink-0 text-ok" /><span><b className="text-ok">Worker ligado.</b> <span className="text-mute">Último sinal às {fmtDataHora(vistoEm!)}. Conexões novas ganham QR Code em até 1 minuto.</span></span></div>
      ) : (
        <div className="aviso flex gap-3">
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-warn" />
          <div>
            <b className="text-base text-warn">Worker desligado: o QR Code não vai aparecer</b>
            <p className="mt-1 text-ink/90">Quem pede o QR à Uazapi e recebe as mensagens é o worker, uma rotina automática do Supabase que roda a cada minuto.
              {vistoEm ? ` O último sinal dele foi em ${fmtDataHora(vistoEm)}. Veja em Supabase → Edge Functions → worker → Logs.` : " Ele ainda não foi ligado. Depois de ligar, esta tela mostra o QR sozinha."}</p>
          </div>
        </div>
      )}
      {admin && <NovoUsuarioForm empresas={eu.super_admin ? todas : []} aberta={atual?.id ?? null} />}
      {admin && (
        <details className="card">
          <summary className="cursor-pointer text-sm font-semibold">Adicionar vendedor só com WhatsApp (sem login no Cabueta)</summary>
          <form action={criarVendedorWhatsApp} className="mt-3 grid gap-3 md:grid-cols-[1.5fr_1fr_auto]">
            <div><label className="label" htmlFor="vendedor">Nome do vendedor</label>
              <input id="vendedor" name="vendedor" className="input" placeholder="Ex.: Ruan" required autoComplete="off" /></div>
            <div><label className="label" htmlFor="funcao-wpp">Função</label>
              <select id="funcao-wpp" name="funcao" className="input" defaultValue="sdr"><option value="sdr">SDR</option><option value="closer">Closer</option></select></div>
            <div className="flex items-end"><button className="btn">Adicionar vendedor e conexão</button></div>
            <p className="text-xs text-mute md:col-span-3">Para quem só precisa ter as conversas auditadas, sem entrar no painel. SDR: vende inscrição no workshop e marca reunião de imersão. Closer: marca reunião de implementação e fecha a imersão. Se já existe alguém com esse nome, a conexão é ligada a essa pessoa.</p>
          </form>
        </details>
      )}
      <div className="space-y-3">
        {usuarios.map((u) => (
          <div key={u.id} className={`card ${u.ativo ? "" : "opacity-70"}`}>
            {admin ? (
              <>
                <form action={atualizarUsuario} className="grid items-end gap-3 md:grid-cols-6">
                  <input type="hidden" name="id" value={u.id} />
                  <div className="md:col-span-2"><label className="label">Nome</label><input name="nome" defaultValue={u.nome} className="input" required /></div>
                  <div className="md:col-span-2"><label className="label">E-mail de login</label><input name="email" type="email" defaultValue={u.email?.endsWith("@sem-login.invalid") ? "" : u.email} placeholder="E-mail de login" autoComplete="off" className="input" /></div>
                  <div><label className="label">Papel</label>
                    <select name="papel" defaultValue={u.papel} className="input"><option value="vendedor">Vendedor</option><option value="gestor">Gestor</option><option value="admin">Admin</option></select></div>
                  <div><label className="label">Função</label>
                    <select name="funcao" defaultValue={u.funcao ?? "sdr"} className="input"><option value="sdr">SDR</option><option value="closer">Closer</option><option value="gestao">Gestão</option></select></div>
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
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <b>{u.nome}</b>
                <span className="chip border-line text-mute">{PAPEL[u.papel] ?? u.papel}</span>
                {u.funcao && <span className="chip border-brand text-brand">{FUNCAO[u.funcao] ?? u.funcao}</span>}
                {!u.ativo && <span className="text-xs text-warn">inativo</span>}
              </div>
            )}
            <WhatsAppDoUsuario usuarioId={u.id} funcao={u.funcao} insts={insts.filter((i) => i.vendedor_id === u.id)} admin={admin} workerLigado={workerLigado} />
          </div>
        ))}
      </div>
    </div>
  );
}

import { exigirGestor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Criterio, Estado, Numero, Settings, Vendedor } from "@/lib/configuracoes";
import NovoUsuarioForm from "../admin/usuarios/NovoUsuarioForm";
import FormConfig from "./FormConfig";

export const dynamic = "force-dynamic";
export const metadata = { title: "Configurações · Auditoria Comercial" };

// Configuracoes do Auditor: so gestor e admin entram (a RLS das tabelas tambem exige gestor)
export default async function Configuracoes() {
  const eu = await exigirGestor();
  const db = await createClient();
  const [rCfg, rCrit, rIgn, rAl, rPerf, rInst] = await Promise.all([
    db.from("audit_settings").select("*").eq("id", 1).single(),
    db.from("criterios_rubrica").select("rubrica,chave,nome,descricao,peso,ativo,posicao").order("posicao"),
    db.from("numeros_ignorados").select("telefone").order("criado_em"),
    db.from("telefones_alerta").select("telefone").order("criado_em"),
    db.from("profiles").select("id,nome,funcao,ativo,papel").eq("papel", "vendedor").order("nome"),
    db.from("instancias_whatsapp").select("id,vendedor_id,nome,numero,status,horario").order("nome"),
  ]);
  if (rCfg.error || !rCfg.data) return <p className="aviso">Não foi possível carregar as configurações: {rCfg.error?.message ?? "linha de configuração não encontrada"}.</p>;

  const crit = (rCrit.data ?? []) as (Criterio & { rubrica: string })[];
  const da = (r: string) => crit.filter((c) => c.rubrica === r).map(({ chave, nome, descricao, peso, ativo }) => ({ chave, nome, descricao, peso, ativo }));
  const { id: _id, atualizado_em: _a, resumo_ultimo_envio: _r, ...settings } = rCfg.data as Settings & { id: number; atualizado_em: string; resumo_ultimo_envio: string | null };
  const inicial: Estado = {
    settings: settings as Settings,
    vendedores: (rPerf.data ?? []).map(({ id, nome, funcao, ativo }) => ({ id, nome, funcao, ativo })) as Vendedor[],
    numeros: (rInst.data ?? []) as Numero[],
    ignorados: (rIgn.data ?? []).map((x) => x.telefone as string),
    alertas: (rAl.data ?? []).map((x) => x.telefone as string),
    rubricas: { sdr: da("sdr"), closer: da("closer"), personalizada: da("personalizada") },
  };
  return <FormConfig inicial={inicial} podeCriarUsuario={eu.papel === "admin"} novoUsuario={<NovoUsuarioForm />} />;
}

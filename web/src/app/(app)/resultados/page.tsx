import { AlertTriangle } from "lucide-react";
import FiltroPeriodo from "@/components/FiltroPeriodo";
import { empresas, exigirGestor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtData, hojeBR } from "@/lib/format";
import { lerPeriodo } from "@/lib/periodo";
import { FORMAS, PRODUTOS, brlCompleto, contaNoFaturamento, listarResultados, rotuloForma, rotuloProduto, type Resultado } from "@/lib/resultados";
import { criarVenda, removerVenda, restaurarVenda, salvarVenda } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Resultados · Cabueta do Elon Musk" };

const sel = "input !py-1.5";

// Resultados: as vendas em dinheiro do periodo (as ganhas no CRM, as que a IA detectou, com ajustes, e as lancadas a mao), sem duplicar.
// E a mesma lista que o faturamento da TV soma: mudou aqui, muda la.
export default async function Resultados({ searchParams: spP }: { searchParams: Promise<{ p?: string; de?: string; ate?: string; ok?: string; erro?: string }> }) {
  const sp = await spP;
  const perfil = await exigirGestor();
  const { atual } = await empresas(perfil);
  const db = await createClient();
  const periodo = lerPeriodo(sp, "mes");
  const { data: org } = await db.rpc("org_atual");
  const [res, { data: perfis }] = await Promise.all([
    listarResultados(db, (org as string) ?? atual?.id ?? "", periodo.de, periodo.ate),
    db.from("profiles").select("id,nome,funcao,ativo").order("nome"),
  ]);
  const nomes = new Map<string, string>(((perfis ?? []) as { id: string; nome: string }[]).map((p) => [p.id, p.nome]));
  const time = ((perfis ?? []) as { id: string; nome: string; ativo: boolean; funcao: string | null }[]).filter((p) => p.ativo && p.funcao !== "gestao");
  const { linhas } = res;
  const contam = linhas.filter(contaNoFaturamento);
  const total = contam.reduce((s, r) => s + (r.valor ?? 0), 0);
  const semValor = linhas.filter((r) => !r.excluida && !r.duplicada && (r.valor ?? 0) <= 0 && r.origem === "ia").length;
  const naoLancadas = linhas.filter((r) => r.naoLancada && !r.excluida);
  const volta = new URLSearchParams(periodo.p === "livre" ? { de: periodo.de, ate: periodo.ate } : { p: periodo.p }).toString();
  const porForma = FORMAS.map(([k, t]) => [t, contam.filter((r) => r.forma === k).reduce((s, r) => s + (r.valor ?? 0), 0)] as [string, number]).filter(([, v]) => v > 0);
  const semForma = contam.filter((r) => !r.forma).reduce((s, r) => s + (r.valor ?? 0), 0);

  const Campos = ({ r }: { r: Resultado }) => (
    <>
      <input type="hidden" name="volta" value={volta} />
      {r.origem === "manual" ? <input type="hidden" name="id" value={r.id ?? ""} /> : <><input type="hidden" name="auditoria_id" value={r.auditoriaId ?? ""} /><input type="hidden" name="data" value={r.data} /><input type="hidden" name="vendedor_id" value={r.vendedorId ?? ""} /></>}
    </>
  );

  return (
    <div className="space-y-5">
      <div><h1 className="page-title">Resultados</h1>
        <p className="page-sub">As vendas em dinheiro do período: as ganhas no CRM, as que a IA detectou nas conversas e as que você lança à mão, cada uma contada uma vez. Esta lista é a que o faturamento da TV soma: se você corrigir um valor ou adicionar uma venda aqui, a TV acompanha.</p></div>
      {sp.erro && <p className="card border-bad text-sm text-bad">{sp.erro}</p>}
      {sp.ok && <p className="card border-ok text-sm text-ok">{sp.ok}</p>}
      {!res.tabelaOk && (
        <div className="aviso flex gap-3"><AlertTriangle size={20} className="mt-0.5 shrink-0 text-warn" />
          <div><b className="text-base text-warn">A tabela de resultados ainda não existe no banco</b>
            <p className="mt-1 text-ink/90">Rode o bloco "Resultados (vendas)" do arquivo supabase/schema.sql no SQL Editor do Supabase. Enquanto isso, a lista mostra só as vendas da IA e não dá para adicionar nem ajustar.</p></div></div>
      )}
      <FiltroPeriodo base="/resultados" periodo={periodo} atalhos={[["hoje", "Hoje"], ["semana", "Semana"], ["mes", "Mês"], ["30", "30 dias"]]} />

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card"><div className="label">Faturamento do período</div><div className="mt-1 text-3xl font-extrabold tabular-nums">{brlCompleto(total)}</div>
          <div className="mt-1 text-sm text-mute">{contam.length} venda{contam.length === 1 ? "" : "s"} contam</div></div>
        <div className="card"><div className="label">Forma de pagamento</div>
          <div className="mt-1 space-y-0.5 text-sm tabular-nums">
            {porForma.map(([t, v]) => <div key={t} className="flex justify-between gap-3"><span className="text-mute">{t}</span><b>{brlCompleto(v)}</b></div>)}
            {semForma > 0 && <div className="flex justify-between gap-3"><span className="text-mute">Não informada</span><b>{brlCompleto(semForma)}</b></div>}
            {!porForma.length && !semForma && <span className="text-mute">—</span>}
          </div></div>
        <div className="card"><div className="label">Sem valor</div><div className="mt-1 text-3xl font-extrabold tabular-nums">{semValor}</div>
          <div className="mt-1 text-sm text-mute">vendas da IA em que ela não achou o valor: edite para entrarem no faturamento</div></div>
      </div>

      {!!naoLancadas.length && (
        <div className="aviso flex gap-3"><AlertTriangle size={20} className="mt-0.5 shrink-0 text-warn" />
          <div><b className="text-base text-warn">{naoLancadas.length} venda{naoLancadas.length === 1 ? "" : "s"} da conversa sem lançamento no CRM</b>
            <p className="mt-1 text-ink/90">A IA viu {naoLancadas.length === 1 ? "esta venda" : "estas vendas"} na conversa, mas não {naoLancadas.length === 1 ? "achei" : "achei nenhuma"} no CRM: {naoLancadas.map((r) => `${r.cliente || "cliente sem nome"} (${rotuloProduto(r.produto)}${r.valor ? `, ${brlCompleto(r.valor)}` : ""})`).join(", ")}. Lance no CRM para entrar no faturamento, ou tire do faturamento se não foi venda.</p></div></div>
      )}

      <details className="card" open={!!sp.erro}>
        <summary className="cursor-pointer font-bold">Adicionar venda manualmente</summary>
        <form action={criarVenda} className="mt-4 grid gap-3 md:grid-cols-4">
          <input type="hidden" name="volta" value={volta} />
          <div><label className="label">Dia da venda</label><input type="date" name="data" defaultValue={hojeBR()} className={sel} required /></div>
          <div><label className="label">Quem fez a venda</label>
            <select name="vendedor_id" className={sel} defaultValue=""><option value="">Não informado</option>{time.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></div>
          <div><label className="label">Cliente</label><input name="cliente" className={sel} placeholder="Nome do cliente" required maxLength={120} /></div>
          <div><label className="label">Empresa</label><input name="empresa" className={sel} placeholder="Nome da empresa" maxLength={120} /></div>
          <div><label className="label">Produto</label>
            <select name="produto" className={sel} defaultValue=""><option value="">Não informado</option>{PRODUTOS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
          <div><label className="label">Forma de pagamento</label>
            <select name="forma_pagamento" className={sel} defaultValue=""><option value="">Não informada</option>{FORMAS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
          <div><label className="label">Valor (R$)</label><input name="valor" inputMode="decimal" className={sel} placeholder="1.500,00" required /></div>
          <div className="flex items-end"><button className="btn" disabled={!res.tabelaOk}>Adicionar venda</button></div>
        </form>
      </details>

      <div className="card !p-0 overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead><tr>{["Dia", "Quem vendeu", "Cliente", "Empresa", "Produto", "Pagamento", "Valor", "Origem", ""].map((h) => <th key={h} className={`th ${h === "Valor" ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
          <tbody>
            {linhas.map((r) => (
              <tr key={r.chave} className={r.excluida || r.duplicada ? "opacity-50" : ""}>
                <td className="td whitespace-nowrap tabular-nums">{fmtData(r.data)}</td>
                <td className="td">{r.vendedorId ? nomes.get(r.vendedorId) ?? "—" : "—"}</td>
                <td className={`td ${r.excluida ? "line-through" : ""}`}>{r.cliente || <span className="text-mute">—</span>}</td>
                <td className="td">{r.empresa || <span className="text-mute">—</span>}</td>
                <td className="td">{rotuloProduto(r.produto)}</td>
                <td className="td">{rotuloForma(r.forma)}</td>
                <td className={`td whitespace-nowrap text-right font-semibold tabular-nums ${r.excluida ? "line-through" : ""}`}>
                  {r.valor == null ? <span className="font-normal text-warn">sem valor</span> : brlCompleto(r.valor)}
                  {r.ajustada && r.valorIA != null && r.valorIA !== r.valor && <div className="text-xs font-normal text-mute">IA leu {brlCompleto(r.valorIA)}</div>}
                </td>
                <td className="td whitespace-nowrap">
                  <span className={`chip ${r.origem === "manual" ? "border-warn text-warn" : r.origem === "crm" ? "border-ok text-ok" : "border-brand text-brand"}`}>{r.origem === "manual" ? "Manual" : r.origem === "crm" ? (r.naConversa ? "CRM · conversa" : "CRM") : r.ajustada ? "IA · ajustada" : "IA"}</span>
                  {r.excluida && <span className="ml-1 text-xs text-bad">fora do faturamento</span>}
                  {r.duplicada && <div className="mt-0.5 text-xs text-mute">{r.duplicada}: não soma</div>}
                  {r.naoLancada && !r.excluida && <div className="mt-0.5 text-xs text-warn">não lançada no CRM: não soma</div>}
                </td>
                <td className="td">
                  {r.origem === "crm" ? <span className="text-xs text-mute">Edite no CRM</span> : <details className="min-w-[230px]">
                    <summary className="cursor-pointer text-xs font-semibold text-brand">Editar</summary>
                    <form action={salvarVenda} className="mt-2 grid gap-2">
                      <Campos r={r} />
                      {r.origem === "manual" && <>
                        <label className="label">Dia<input type="date" name="data" defaultValue={r.data} className={sel} required /></label>
                        <label className="label">Quem vendeu<select name="vendedor_id" defaultValue={r.vendedorId ?? ""} className={sel}><option value="">Não informado</option>{time.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label>
                        <label className="label">Produto<select name="produto" defaultValue={r.produto ?? ""} className={sel}><option value="">Não informado</option>{PRODUTOS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
                      </>}
                      <label className="label">Cliente<input name="cliente" defaultValue={r.cliente} className={sel} maxLength={120} /></label>
                      <label className="label">Empresa<input name="empresa" defaultValue={r.empresa} className={sel} maxLength={120} /></label>
                      <label className="label">Forma de pagamento<select name="forma_pagamento" defaultValue={r.forma ?? ""} className={sel}><option value="">Não informada</option>{FORMAS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
                      <label className="label">Valor (R$){r.origem === "ia" && " · vazio = o que a IA leu"}<input name="valor" inputMode="decimal" defaultValue={r.valor != null && (r.origem === "manual" || r.valor !== r.valorIA) ? String(r.valor).replace(".", ",") : ""} placeholder={r.valorIA != null ? String(r.valorIA).replace(".", ",") : "1.500,00"} className={sel} /></label>
                      <button className="btn-ghost" disabled={!res.tabelaOk}>Salvar</button>
                    </form>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {r.origem === "ia" && (r.ajustada || r.excluida) && (
                        <form action={restaurarVenda}><Campos r={r} /><button className="btn-ghost !py-1 text-xs">{r.excluida ? "Voltar ao faturamento" : "Restaurar o que a IA leu"}</button></form>
                      )}
                      {!r.excluida && (
                        <form action={removerVenda}><Campos r={r} /><button className="btn-ghost !py-1 text-xs text-bad">{r.origem === "manual" ? "Apagar venda" : "Tirar do faturamento"}</button></form>
                      )}
                    </div>
                  </details>}
                </td>
              </tr>
            ))}
            {!linhas.length && <tr><td className="td text-mute" colSpan={9}>Nenhuma venda no período. As vendas que a IA detecta nas conversas aparecem aqui sozinhas.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-mute">As vendas ganhas no CRM entram sozinhas (a cada 15 minutos) com o produto do CRM. Cada venda conta uma vez: se a mesma venda aparece na conversa ou foi lançada à mão, vale a do CRM. Imersão, Plataforma ou In-company que só aparece na conversa espera o lançamento no CRM para somar. A venda da IA mostra o cliente pelo nome do contato no WhatsApp. A IA não lê empresa nem forma de pagamento: preencha em Editar. Convites do workshop (cupom R$ 0) não entram, porque não são venda em dinheiro.</p>
    </div>
  );
}

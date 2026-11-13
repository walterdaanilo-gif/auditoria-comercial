// Edge Function "resumo-agora": manda AGORA o resumo do dia para a gestao (telefones de alerta), com os MESMOS numeros
// da apresentacao (rota /api/resumo do site). Mesmo caminho de envio do worker: primeiro pelo CRM Q5 (conversa que o
// WhatsApp de envio ja tem com o numero), senao pela Uazapi. Tambem cai no sino dos gestores.
// Chamada: POST com o header x-worker-token (a mesma chave interna do worker). Nao escreve nome, telefone nem valor em log.
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SITE = (Deno.env.get("SITE_URL") || "https://auditoria-comercial-omega.vercel.app").replace(/\/$/, "");
const Q5 = "https://api.grupoquatro5.com/public/v1";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const brlc = (n: number) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const UM: Record<string, string> = { plataforma: "Plataforma", imersao: "Imersão", incompany: "In-Company", workshop: "Workshop", outro: "Outro" };
const VARIOS: Record<string, string> = { plataforma: "Plataformas", imersao: "Imersões", incompany: "In-Company", workshop: "Workshops", outro: "Outros" };
const chave = (t: unknown) => { const d = String(t || "").replace(/\D/g, "").replace(/^55/, ""); return d.length >= 10 ? d.slice(0, 2) + d.slice(-8) : d; };
const dur = (s: number) => (s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}min` : `${Math.floor(s / 3600)}h${String(Math.round((s % 3600) / 60)).padStart(2, "0")}`);
const hojeBR = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
const horaBR = () => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(new Date());

async function todas(tabela: string, colunas: string, filtro: (q: any) => any) {
  const out: any[] = [];
  for (let de = 0; ; de += 1000) {
    const { data } = await filtro(sb.from(tabela).select(colunas)).range(de, de + 999);
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}

// envio igual ao do worker (src/envio.js): CRM Q5 primeiro, Uazapi depois
async function enviar(instanciaId: string, numero: string, texto: string) {
  const q5Key = Deno.env.get("Q5_API_KEY") || "";
  if (q5Key) {
    const insts = ((await sb.from("crm_instancias").select("id").eq("instancia_id", instanciaId)).data ?? []).map((i: any) => i.id);
    if (insts.length) {
      const convs = await todas("crm_conversas", "id,telefone,responsavel_crm_id,ultima_msg_em", (q) => q.in("crm_instancia_id", insts));
      const conta = new Map<string, number>();
      for (const c of convs) if (c.responsavel_crm_id) conta.set(c.responsavel_crm_id, (conta.get(c.responsavel_crm_id) || 0) + 1);
      const remetente = [...conta].sort((a, b) => b[1] - a[1])[0]?.[0];
      const chat = convs.filter((c) => chave(c.telefone) === chave(numero)).sort((a, b) => String(b.ultima_msg_em || "").localeCompare(String(a.ultima_msg_em || "")))[0];
      if (remetente && chat) {
        const r = await fetch(`${Q5}/conversations/${chat.id}/messages`, { method: "POST", headers: { Authorization: `Bearer ${q5Key}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ type: "text", body: texto, sender_user_id: remetente }) });
        if (r.ok) return "crm";
        console.error("[resumo-agora] CRM Q5 recusou:", r.status);
      }
    }
  }
  const url = (Deno.env.get("UAZAPI_URL") || "").replace(/\/$/, "");
  const { data: u } = await sb.from("instancias_uazapi").select("token").eq("instancia_id", instanciaId).maybeSingle();
  if (!url || !u?.token) throw new Error("sem caminho de envio (CRM ou Uazapi)");
  const r = await fetch(`${url}/send/text`, { method: "POST", headers: { token: u.token, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ number: numero, text: texto }) });
  if (!r.ok) throw new Error(`Uazapi ${r.status}`);
  return "uazapi";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ erro: "use POST" }, 405);
  const { data: tk } = await sb.from("worker_token").select("token").eq("id", 1).maybeSingle();
  if (!tk?.token || req.headers.get("x-worker-token") !== tk.token) return json({ erro: "nao autorizado" }, 401);
  const u = new URL(req.url);
  const soTexto = u.searchParams.get("teste") === "1"; // so monta o texto, nao manda

  const { data: s } = await sb.from("audit_settings").select("*").eq("id", 1).maybeSingle();
  if (!s?.org_id) return json({ erro: "sem empresa configurada" }, 400);
  const r = await fetch(`${SITE}/api/resumo?org=${s.org_id}`, { headers: { "x-worker-token": tk.token }, signal: AbortSignal.timeout(55000) });
  const ap = await r.json().catch(() => null);
  if (!r.ok || !ap?.ok) return json({ erro: "a apresentacao nao respondeu", status: r.status }, 502);

  // ligacoes atendidas hoje do time da empresa (mesma fonte do worker e da TV: resumo_sdr2)
  const hoje = hojeBR();
  const ids = new Set(((await sb.from("profiles").select("id").eq("org_id", s.org_id)).data ?? []).map((p: any) => p.id));
  const lin = ((await sb.rpc("resumo_sdr2", { p_from: hoje, p_to: hoje })).data ?? []).filter((l: any) => ids.has(l.vendedor_id));
  const ligAt = lin.reduce((t: number, l: any) => t + Number(l.ligacoes_atendidas || 0), 0), ligSeg = lin.reduce((t: number, l: any) => t + Number(l.ligacoes_seg || 0), 0);

  const pessoas = (ap.dia.pessoas || []) as any[];
  const metaSdr = s.meta_sdr_marcacoes ?? 6, metaCloser = s.meta_closer_reunioes ?? null;
  const tarde = Number(horaBR()) >= Number(String(s.resumo_manha_hora || "13:00").slice(0, 2)) + 3; // depois das ~16h vale a meta do dia inteiro
  const alvo = (m: number | null) => (m == null ? null : tarde ? m : Math.ceil(m / 2));
  const sdrs = pessoas.filter((p) => p.tipo === "sdr"), closers = pessoas.filter((p) => p.tipo === "closer");
  const marc = sdrs.reduce((n, p) => n + (p.marcacoes || 0), 0), metaTime = metaSdr * sdrs.length;
  const prods = [...(ap.dia.produtos || [])].sort((a: any, b: any) => b.valor - a.valor);
  const vendas = prods.length ? `${brlc(ap.dia.total)} (${prods.map((p: any) => `${plural(p.n, UM[p.produto] ?? p.produto, VARIOS[p.produto] ?? p.produto)} ${brlc(p.valor)}`).join(" · ")})` : "nenhuma ainda";
  const atencao = pessoas.map((p) => {
    const closer = p.tipo === "closer", meta = closer ? metaCloser : metaSdr, feito = closer ? p.reunioes : p.marcacoes;
    const abaixo = meta != null && feito != null && feito < (alvo(meta) ?? 0), fu = p.followups || 0;
    if (!abaixo && !fu) return null;
    const partes = [];
    if (abaixo) partes.push(`${feito}/${meta} ${closer ? "reuniões" : "marcações"}`);
    if (fu) partes.push(plural(fu, "follow-up atrasado", "follow-ups atrasados"));
    return `⚠️ ${p.nome} ${partes.join(" · ")}`;
  }).filter(Boolean);
  const top = [...pessoas].filter((p) => p.vendasValor > 0).sort((a, b) => b.vendasValor - a.vendasValor)[0];
  const m = ap.mes || {};
  const mes = m.meta ? `${brlc(m.real)} de ${brlc(m.meta)} (${Math.round(m.pct ?? 0)}%)${m.precisaPorDia != null ? ` · precisa ${brlc(m.precisaPorDia)}/dia útil` : ""}${m.projecao != null ? ` · projeção ${brlc(m.projecao)}` : ""}` : `${brlc(m.real)} no mês`;
  const texto = [
    `🚀 *Resumo ${Number(horaBR())}h · ${hoje.slice(8, 10)}/${hoje.slice(5, 7)}*`, ``,
    `💰 Vendas hoje: ${vendas}`,
    `📈 Mês: ${mes}`,
    `📅 Marcações: ${marc}${metaTime ? `/${metaTime}` : ""}`,
    ...(closers.length && metaCloser ? [`🤝 Reuniões: ${closers.reduce((n, p) => n + (p.reunioes || 0), 0)}/${metaCloser * closers.length}`] : []),
    `📞 Ligações: ${ligAt ? `${plural(ligAt, "atendida", "atendidas")}${ligSeg ? ` · ${dur(ligSeg)}` : ""}` : "nenhuma atendida"}`,
    ...(atencao.length || top ? [``, ...atencao, ...(top ? [`👑 ${top.nome}: ${brlc(top.vendasValor)} em ${plural(top.vendasN, "venda", "vendas")}`] : [])] : []),
    ``, `Detalhes 👉 ${SITE}`,
  ].join("\n");
  if (soTexto) return json({ texto });

  const tels = ((await sb.from("telefones_alerta").select("telefone").eq("org_id", s.org_id)).data ?? []).map((t: any) => t.telefone);
  let ok = 0;
  const vias: string[] = [];
  if (s.instancia_envio_id) for (const t of tels) {
    try { vias.push(await enviar(s.instancia_envio_id, t, texto)); ok++; } catch (e) { console.error("[resumo-agora] envio falhou:", String((e as Error).message).slice(0, 120)); }
  }
  // sino dos gestores
  const gestores = ((await sb.from("profiles").select("id").in("papel", ["admin", "gestor"]).eq("ativo", true)).data ?? []).map((p: any) => p.id);
  if (gestores.length) await sb.from("notificacoes").insert(gestores.map((id: string) => ({ para: id, tipo: "aviso", categoria: "resumo", titulo: `🚀 Resumo · ${hoje.slice(8, 10)}/${hoje.slice(5, 7)}`, texto: texto.replace(/^.*\n\n/, ""), link: "/" })));
  return json({ ok: true, enviados: ok, de: tels.length, vias });
});

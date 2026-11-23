// Edge Function "reuniao-aviso": manda no WhatsApp do closer o aviso de REUNIAO marcada (nunca workshop).
// Chamada pelo gatilho tg_aviso_reuniao (tabela auditorias) com POST { aviso_id } e o header x-worker-token.
// O gatilho ja filtrou: reuniao com dia e hora, tipo diferente de workshop e cliente confirmado. Aqui so monta e envia.
// Envio igual ao do resumo-agora: CRM Q5 primeiro, Uazapi depois. Nao escreve nome, telefone nem e-mail em log.
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SITE = (Deno.env.get("SITE_URL") || "https://auditoria-comercial-omega.vercel.app").replace(/\/$/, "");
const Q5 = "https://api.grupoquatro5.com/public/v1";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const chave = (t: unknown) => { const d = String(t || "").replace(/\D/g, "").replace(/^55/, ""); return d.length >= 10 ? d.slice(0, 2) + d.slice(-8) : d; };
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const ROTULO: Record<string, string> = { imersao: "Imersão", incompany: "In-Company", plataforma: "Plataforma" };

async function todas(tabela: string, colunas: string, filtro: (q: any) => any) {
  const out: any[] = [];
  for (let de = 0; ; de += 1000) {
    const { data } = await filtro(sb.from(tabela).select(colunas)).range(de, de + 999);
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}

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
        console.error("[reuniao-aviso] CRM Q5 recusou:", r.status);
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
  const body = await req.json().catch(() => ({}));
  const id = Number(body?.aviso_id);
  if (!Number.isInteger(id) || id <= 0) return json({ erro: "aviso_id invalido" }, 400);

  const { data: av } = await sb.from("avisos_reuniao").select("id,conversa_id,inicio,enviado_em").eq("id", id).maybeSingle();
  if (!av) return json({ erro: "aviso nao encontrado" }, 404);
  if (av.enviado_em) return json({ ok: true, jaEnviado: true });

  const { data: a } = await sb.from("auditorias").select("org_id,vendedor_id,tipo_agendamento,reuniao,conversas!inner(contato_nome)").eq("conversa_id", av.conversa_id).order("criado_em", { ascending: false }).limit(1).maybeSingle();
  const r = (a?.reuniao ?? {}) as Record<string, any>;
  const tipo = String(r.tipo || a?.tipo_agendamento || "").toLowerCase();
  if (!a || tipo === "workshop" || !tipo) { await sb.from("avisos_reuniao").update({ erro: "nao e reuniao" }).eq("id", id); return json({ ok: true, ignorado: "nao e reuniao" }); }

  const { data: s } = await sb.from("audit_settings").select("telefone_aviso_reuniao,instancia_envio_id").eq("org_id", a.org_id).not("telefone_aviso_reuniao", "is", null).limit(1).maybeSingle();
  if (!s?.telefone_aviso_reuniao || !s.instancia_envio_id) { await sb.from("avisos_reuniao").update({ erro: "sem destino ou sem instancia de envio" }).eq("id", id); return json({ erro: "sem destino" }, 400); }

  const { data: v } = a.vendedor_id ? await sb.from("profiles").select("nome").eq("id", a.vendedor_id).maybeSingle() : { data: null };
  const [ano, mes, dia] = String(r.data).split("-").map(Number);
  const dow = DIAS[new Date(Date.UTC(ano, mes - 1, dia, 12)).getUTCDay()];
  const cliente = String(r.cliente_nome || (a as any).conversas?.contato_nome || "Cliente");
  const texto = [
    `📅 *${r.remarcacao ? "Reunião remarcada" : "Reunião marcada"}* · ${ROTULO[tipo] ?? tipo}`,
    `👤 ${cliente}${r.empresa ? ` (${r.empresa})` : ""}`,
    `🗓️ ${dow}, ${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")} às ${String(r.hora).slice(0, 5)}${r.modalidade ? ` · ${r.modalidade}` : ""}`,
    ...(v?.nome ? [`🙋 Marcada por ${v.nome}`] : []),
    ...(r.vendedor_confirmou === false ? [`⏳ Falta a sua confirmação`] : []),
    ``, `Conversa 👉 ${SITE}/conversas/${av.conversa_id}`,
  ].join("\n");

  try {
    const via = await enviar(s.instancia_envio_id, s.telefone_aviso_reuniao, texto);
    await sb.from("avisos_reuniao").update({ enviado_em: new Date().toISOString(), erro: null }).eq("id", id);
    return json({ ok: true, via });
  } catch (e) {
    const msg = String((e as Error).message).slice(0, 120);
    console.error("[reuniao-aviso] envio falhou:", msg);
    await sb.from("avisos_reuniao").update({ erro: msg }).eq("id", id);
    return json({ erro: "envio falhou" }, 502);
  }
});

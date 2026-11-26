// Sincroniza conversas e mensagens do CRM Q5 Conversas (API publica) para as tabelas crm_*, de cada empresa (Weevo, Carbone...).
// Cada empresa usa a propria chave (organizacoes.crm_segredo) e o proprio estado (crm_sync_estado.org_id).
// De quem e a conversa:
//  - empresa com vendedores ligados a um usuario do CRM (profiles.crm_user_id): pelo atendente responsavel da conversa;
//  - senao (Weevo): pelo numero de WhatsApp da conversa (instancia do vendedor com conversas no CRM).
// Empresa nova (nao a Weevo) so traz os ultimos 30 dias. Roda em lotes: cada chamada trabalha ate ~110s e retoma depois.
// Entrada de leads (26/11/2026): cartao de QUALQUER numero (inclusive sem vendedor, ex.: Comercial inbound) visto numa etapa
// de entrada (Lead novo, Lead trafego, Formulario abandonado) vai para crm_entradas (supabase/crm_entradas.sql).
import { createClient } from "jsr:@supabase/supabase-js@2";

const API = "https://api.grupoquatro5.com/public/v1";
const ORCAMENTO_MS = 110_000;
const JANELA_DIAS = 30;
const ENTRADA = /lead_novo$|trafego|formulario/;

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

// DDD + ultimos 8 digitos: ignora +55 e o nono digito
function chaveFone(f?: string | null) {
  const d = (f || "").replace(/\D/g, "").replace(/^55/, "");
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}

async function q5(path: string, key: string, tentativa = 0): Promise<any> {
  const r = await fetch(API + path, { headers: { Authorization: `Bearer ${key}` } });
  if (r.status === 429 && tentativa < 4) {
    const espera = Number(r.headers.get("Retry-After") || 5) * 1000;
    await new Promise((ok) => setTimeout(ok, espera));
    return q5(path, key, tentativa + 1);
  }
  if (!r.ok) throw new Error(`Q5 ${r.status} em ${path}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

function mapMsg(m: any, conversaId: string, vendedorId: string) {
  return {
    id: m.id,
    conversa_id: conversaId,
    vendedor_id: vendedorId,
    direcao: m.direction,
    tipo: m.type,
    status: m.status,
    texto: m.body ?? null,
    midia_url: m.mediaUrl ?? null,
    transcricao: m.transcript ?? null,
    nota_interna: !!m.isInternalNote,
    automatica: !!m.isAutoReply,
    autor_crm_id: m.senderId ?? null,
    apagada_em: m.deletedAt ?? null,
    enviada_em: m.createdAt,
  };
}

// Busca mensagens: sem cursor puxa o historico (para tras, ate "desde" quando houver); com cursor puxa so as novas.
async function sincronizarMensagens(chatId: string, depoisDe: string | null, key: string, desde: string | null) {
  const todas: any[] = [];
  if (depoisDe) {
    let cursor = depoisDe;
    for (let i = 0; i < 50; i++) {
      const r = await q5(`/conversations/${chatId}/messages?limit=100&after=${cursor}`, key);
      const lote = (r.data || []).sort((a: any, b: any) => a.createdAt.localeCompare(b.createdAt));
      todas.push(...lote);
      if (!r.hasMore || !lote.length) break;
      cursor = lote[lote.length - 1].id;
    }
  } else {
    let cursor: string | null = null;
    for (let i = 0; i < 50; i++) {
      const r = await q5(`/conversations/${chatId}/messages?limit=100${cursor ? `&before=${cursor}` : ""}`, key);
      const lote = (r.data || []).sort((a: any, b: any) => a.createdAt.localeCompare(b.createdAt));
      todas.push(...lote);
      if (!r.hasMore || !lote.length || (desde && lote[0].createdAt < desde)) break;
      cursor = lote[0].id;
    }
  }
  return desde ? todas.filter((m) => m.createdAt >= desde) : todas;
}

type Dono = { instancia_id: string; vendedor_id: string };

// cartao numa etapa de entrada -> linha de crm_entradas (null: nao e entrada ou sem telefone)
function entradaDe(orgId: string, c: any) {
  const tel = chaveFone(c?.contact?.phoneE164);
  if (!tel || typeof c?.status !== "string" || !c.status.startsWith("custom_") || !ENTRADA.test(c.status)) return null;
  return { org_id: orgId, conversa_crm_id: c.id, etapa: c.status, telefone_chave: tel, instancia: c.instance?.name ?? null, criada_crm_em: c.createdAt ?? null };
}
async function gravarEntradas(linhas: any[]) {
  if (!linhas.length) return;
  const { error } = await sb.from("crm_entradas").upsert(linhas, { onConflict: "conversa_crm_id,etapa", ignoreDuplicates: true });
  if (error) console.error("[crm-sync] entradas:", error.message.slice(0, 120));
}
// Radar a cada chamada: a volta completa leva ~45 min (2 mil+ conversas) e o cartao pode sair de Lead novo antes disso
// (ex.: a SDR recria o lead no numero dela e o da API vai para Perdido). As 2 primeiras paginas sao as conversas mais recentes.
async function radarEntradas(orgId: string, key: string) {
  const linhas: any[] = [];
  for (let p = 1; p <= 2; p++) {
    const r = await q5(`/conversations?status=all&limit=100&page=${p}`, key);
    for (const c of r.data || []) { const e = entradaDe(orgId, c); if (e) linhas.push(e); }
    if ((r.data || []).length < 100) break;
  }
  await gravarEntradas(linhas);
  return linhas.length;
}

// Uma empresa: le paginas de conversas ate acabar ou ate "ate" (horario limite)
async function sincronizarEmpresa(org: { id: string; slug: string; crm_segredo: string }, ate: number) {
  const key = Deno.env.get(org.crm_segredo);
  if (!key) return { org: org.slug, erro: `segredo ${org.crm_segredo} nao configurado` };

  // vendedores da empresa com conversas no CRM e o numero (instancia) de cada um
  const { data: insts } = await sb
    .from("instancias_whatsapp")
    .select("id, numero, vendedor_id, profiles!inner(fonte_conversas, ativo, crm_user_id, org_id)")
    .eq("profiles.fonte_conversas", "crm")
    .eq("profiles.org_id", org.id);
  const porFone = new Map<string, Dono>(), porAgente = new Map<string, Dono>();
  for (const i of (insts || []) as any[]) {
    const dono = { instancia_id: i.id, vendedor_id: i.vendedor_id };
    if (i.profiles?.crm_user_id) porAgente.set(i.profiles.crm_user_id, dono);
    const k = chaveFone(i.numero);
    if (k) porFone.set(k, dono);
  }
  const peloAtendente = porAgente.size > 0;
  const desde = org.slug === "weevo" ? null : new Date(Date.now() - JANELA_DIAS * 86400_000).toISOString();

  const { data: est } = await sb.from("crm_sync_estado").select("*").eq("org_id", org.id).maybeSingle();
  if (!est) return { org: org.slug, erro: "sem linha em crm_sync_estado" };
  const novaRodada = !est.rodada_iniciada_em || (est.rodada_concluida_em && est.rodada_concluida_em >= est.rodada_iniciada_em);
  let pagina = novaRodada ? 1 : est.pagina;
  const cont = novaRodada
    ? { conversas_lidas: 0, conversas_sdr: 0, mensagens_novas: 0 }
    : { conversas_lidas: est.conversas_lidas, conversas_sdr: est.conversas_sdr, mensagens_novas: est.mensagens_novas };
  if (novaRodada) {
    await sb.from("crm_sync_estado").update({ rodada_iniciada_em: new Date().toISOString(), pagina: 1, ultimo_erro: null, ...cont }).eq("id", est.id);
  }

  await radarEntradas(org.id, key).catch((e) => console.error("[crm-sync] radar:", String((e as Error).message).slice(0, 120)));
  try {
    while (Date.now() < ate) {
      const r = await q5(`/conversations?status=all&limit=100&page=${pagina}`, key);
      const lista: any[] = r.data || [];

      // conversas ja conhecidas desta pagina (para saber se ha mensagem nova)
      const ids = lista.map((c) => c.id);
      const { data: conhecidas } = await sb.from("crm_conversas").select("id, ultima_msg_sync_id, ultima_msg_sync_em").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      const mapaConhecidas = new Map((conhecidas || []).map((c: any) => [c.id, c]));

      const tocadas: string[] = [];
      const entradas: any[] = [];
      for (const c of lista) {
        if (Date.now() > ate) break;
        cont.conversas_lidas++;
        if (desde && (c.lastMessageAt || "") < desde) continue; // fora da janela da empresa
        // entrada de lead: qualquer numero, antes de olhar de quem e a conversa
        const ent = entradaDe(org.id, c);
        if (ent) entradas.push(ent);
        const dono = peloAtendente ? porAgente.get(c.assignedAgentUserId) : porFone.get(chaveFone(c.instance?.phoneE164) || "-");
        if (!dono) continue; // nao e de vendedor com conversas no CRM
        cont.conversas_sdr++;

        await sb.from("crm_instancias").upsert({
          id: c.instance.id, nome: c.instance.name, telefone: c.instance.phoneE164, status: c.instance.status,
          provider: c.instance.provider, instancia_id: dono.instancia_id, vendedor_id: dono.vendedor_id,
          atualizado_em: new Date().toISOString(),
        });

        const prev: any = mapaConhecidas.get(c.id);
        const base = {
          id: c.id, crm_instancia_id: c.instance.id, vendedor_id: dono.vendedor_id, status: c.status,
          responsavel_crm_id: c.assignedAgentUserId ?? null, contato_crm_id: c.contact?.id ?? null,
          contato_nome: c.contact?.name ?? null, telefone: c.contact?.phoneE164 ?? null,
          tags: (c.tags || []).map((t: any) => t.name), origem: c.deal?.originLabel ?? null,
          negocio_status: c.deal?.status ?? null, negocio_valor_cents: c.deal?.valueCents ?? null,
          ultima_msg_em: c.lastMessageAt ?? null, ultima_msg_direcao: c.lastMessagePreview?.direction ?? null,
          ultima_msg_preview: c.lastMessagePreview?.body?.slice(0, 500) ?? null,
          criada_crm_em: c.createdAt ?? null, resolvida_em: c.resolvedAt ?? null, fechada_em: c.closedAt ?? null,
          raw: c, sincronizada_em: new Date().toISOString(),
        };
        const { error: e1 } = await sb.from("crm_conversas").upsert(base);
        if (e1) throw new Error("upsert conversa: " + e1.message);

        const mudou = !prev || !prev.ultima_msg_sync_em || (c.lastMessageAt && c.lastMessageAt > prev.ultima_msg_sync_em);
        if (!mudou) continue;

        const msgs = await sincronizarMensagens(c.id, prev?.ultima_msg_sync_id ?? null, key, prev ? null : desde);
        for (let i = 0; i < msgs.length; i += 500) {
          const { error: e2 } = await sb.from("crm_mensagens").upsert(msgs.slice(i, i + 500).map((m) => mapMsg(m, c.id, dono.vendedor_id)));
          if (e2) throw new Error("upsert mensagens: " + e2.message);
        }
        cont.mensagens_novas += msgs.length;
        const ultima = msgs.length ? msgs[msgs.length - 1] : null;
        await sb.from("crm_conversas").update({
          ultima_msg_sync_id: ultima?.id ?? prev?.ultima_msg_sync_id ?? null,
          ultima_msg_sync_em: c.lastMessageAt ?? ultima?.createdAt ?? null,
        }).eq("id", c.id);
        tocadas.push(c.id);
      }
      // entrada de lead: so a primeira vez que o cartao e visto naquela etapa (falha aqui nao derruba a sincronizacao)
      await gravarEntradas(entradas);
      if (tocadas.length) await sb.rpc("crm_atualizar_resumo", { p_ids: tocadas });
      if (Date.now() > ate) break; // pagina pela metade: refaz a mesma na proxima volta (o que ja foi gravado e pulado)

      const fim = !lista.length || pagina * (r.limit || 100) >= (r.total || 0);
      if (fim) {
        await sb.from("crm_sync_estado").update({ pagina: 1, total: r.total, rodada_concluida_em: new Date().toISOString(), ...cont, atualizado_em: new Date().toISOString() }).eq("id", est.id);
        return { org: org.slug, concluido: true, total_crm: r.total, ...cont };
      }
      pagina++;
      await sb.from("crm_sync_estado").update({ pagina, total: r.total, ...cont, atualizado_em: new Date().toISOString() }).eq("id", est.id);
    }
    await sb.from("crm_sync_estado").update({ pagina, ...cont, atualizado_em: new Date().toISOString() }).eq("id", est.id);
    return { org: org.slug, concluido: false, proxima_pagina: pagina, ...cont };
  } catch (e) {
    const msg = String((e as Error).message || e);
    await sb.from("crm_sync_estado").update({ ultimo_erro: msg, pagina, ...cont, atualizado_em: new Date().toISOString() }).eq("id", est.id);
    return { org: org.slug, concluido: false, erro: msg, pagina, ...cont };
  }
}

Deno.serve(async (req) => {
  const inicio = Date.now();
  const { data: tk } = await sb.from("crm_sync_token").select("token").eq("id", 1).single();
  if (!tk || req.headers.get("x-crm-sync-token") !== tk.token) return json({ erro: "nao autorizado" }, 401);

  // Weevo primeiro (incremental, rapido); o tempo que sobra vai para as outras empresas
  const { data: orgs } = await sb.from("organizacoes").select("id, slug, crm_segredo").not("crm_segredo", "is", null).order("criado_em");
  const lista = ((orgs || []) as any[]).sort((a, b) => (a.slug === "weevo" ? -1 : b.slug === "weevo" ? 1 : 0));
  const out: unknown[] = [];
  for (const [i, org] of lista.entries()) {
    const restante = inicio + ORCAMENTO_MS - Date.now();
    if (restante < 5_000) break;
    // cada empresa pode usar no maximo o tempo que sobra dividido pelas que faltam (a ultima usa tudo)
    const fatia = i === lista.length - 1 ? restante : Math.max(restante / (lista.length - i), 20_000);
    out.push(await sincronizarEmpresa(org, Date.now() + fatia));
  }
  return json({ empresas: out });
});

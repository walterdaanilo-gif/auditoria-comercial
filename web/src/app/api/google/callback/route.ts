import { NextResponse, type NextRequest } from "next/server";
import { getPerfil } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// Volta do login do Google: troca o codigo pelo refresh_token e guarda (so o servidor le essa tabela)
export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const origem = u.origin;
  const volta = (r: string) => { const res = NextResponse.redirect(`${origem}/configuracoes?agenda=${r}`); res.cookies.delete({ name: "g_state", path: "/api/google" }); return res; };
  const perfil = await getPerfil();
  if (!perfil || perfil.papel === "vendedor") return NextResponse.redirect(`${origem}/`);
  if (u.searchParams.get("error")) return volta("cancelado");
  const code = u.searchParams.get("code");
  if (!code || u.searchParams.get("state") !== req.cookies.get("g_state")?.value) return volta("erro");

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID || "", client_secret: process.env.GOOGLE_CLIENT_SECRET || "", redirect_uri: `${origem}/api/google/callback`, grant_type: "authorization_code" }),
  });
  const j = await r.json();
  if (!r.ok || !j.refresh_token) return volta(j.refresh_token ? "erro" : "sem-token");
  let email: string | null = null;
  try { email = JSON.parse(Buffer.from(String(j.id_token).split(".")[1], "base64url").toString()).email ?? null; } catch {}
  // uma agenda por empresa: grava na linha da empresa aberta (cria a linha na primeira conexao dela)
  const admin = createAdminClient();
  const org = perfil.org_ativa && (perfil.super_admin || perfil.orgs_acesso?.includes(perfil.org_ativa)) ? perfil.org_ativa : perfil.org_id;
  const dados = { email, refresh_token: j.refresh_token, conectado_em: new Date().toISOString(), erro: null };
  const { data: linha } = await admin.from("google_agenda").select("id").eq("org_id", org).maybeSingle();
  const { data: maior } = await admin.from("google_agenda").select("id").order("id", { ascending: false }).limit(1).maybeSingle();
  const { error } = linha
    ? await admin.from("google_agenda").update(dados).eq("org_id", org)
    : await admin.from("google_agenda").insert({ id: Number(maior?.id ?? 0) + 1, org_id: org, ...dados });
  return volta(error ? "erro" : "ok");
}

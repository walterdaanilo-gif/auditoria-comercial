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
  const { error } = await createAdminClient().from("google_agenda").upsert({ id: 1, email, refresh_token: j.refresh_token, conectado_em: new Date().toISOString(), erro: null });
  return volta(error ? "erro" : "ok");
}

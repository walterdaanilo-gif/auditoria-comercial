import { NextResponse, type NextRequest } from "next/server";
import { getPerfil } from "@/lib/auth";

// Leva o gestor ao login do Google para autorizar o sistema a criar eventos na agenda dele
export async function GET(req: NextRequest) {
  const perfil = await getPerfil();
  const origem = new URL(req.url).origin;
  if (!perfil || perfil.papel === "vendedor") return NextResponse.redirect(`${origem}/`);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) return NextResponse.redirect(`${origem}/configuracoes?agenda=sem-chaves`);
  const state = crypto.randomUUID();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId, redirect_uri: `${origem}/api/google/callback`, response_type: "code",
    scope: "openid email https://www.googleapis.com/auth/calendar.events", access_type: "offline", prompt: "consent", state,
  }).toString();
  const res = NextResponse.redirect(url.toString());
  res.cookies.set("g_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/google" });
  return res;
}

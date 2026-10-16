import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// So POST: evita sair sem querer por pre-carregamento de link
export async function POST(request: NextRequest) {
  await (await createClient()).auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}

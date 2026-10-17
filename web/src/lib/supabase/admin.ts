import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./config";

// ATENCAO: usa a service_role key. Importe SOMENTE em Server Actions e Route Handlers.
// Nunca importe em arquivos "use client" e nunca use o prefixo NEXT_PUBLIC_ nessa variavel.
export function createAdminClient() {
  // Limpa o que costuma vir junto ao colar: espacos, quebra de linha, aspas e "Bearer "
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "").trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "").trim();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY nao configurada");
  return createClient(SUPABASE_URL, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// Mensagem clara quando a service role key da Vercel esta errada (o Supabase responde 401)
export const erroAdmin = (e: { message?: string; status?: number } | null | undefined, padrao: string) =>
  e?.status === 401 || /invalid api key|unauthorized|jwt/i.test(e?.message ?? "")
    ? "A chave secreta do Supabase configurada na Vercel (SUPABASE_SERVICE_ROLE_KEY) está inválida. Troque pela Secret key do projeto e faça Redeploy."
    : e?.message || padrao;

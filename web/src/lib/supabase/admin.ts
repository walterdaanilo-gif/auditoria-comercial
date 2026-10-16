import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./config";

// ATENCAO: usa a service_role key. Importe SOMENTE em Server Actions e Route Handlers.
// Nunca importe em arquivos "use client" e nunca use o prefixo NEXT_PUBLIC_ nessa variavel.
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY nao configurada");
  return createClient(SUPABASE_URL, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

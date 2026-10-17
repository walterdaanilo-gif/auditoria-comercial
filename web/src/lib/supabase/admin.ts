import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./config";

// ATENCAO: usa a service_role key. Importe SOMENTE em Server Actions e Route Handlers.
// Nunca importe em arquivos "use client" e nunca use o prefixo NEXT_PUBLIC_ nessa variavel.
// Limpa o que costuma vir junto ao colar: espacos, quebra de linha, aspas e "Bearer "
const chave = () => (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "").trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "").trim();

// Diz que tipo de chave esta configurada, sem mostrar a chave
function tipoChave(): string {
  const k = chave();
  if (!k) return "nenhuma chave configurada";
  if (k.startsWith("sb_secret_")) return `uma Secret key (sb_secret_..., ${k.length} caracteres), que é o tipo certo; confira se não foi apagada ou trocada no Supabase`;
  if (k.startsWith("sb_publishable_")) return "a Publishable key (sb_publishable_...), que é a chave PÚBLICA; precisa ser a Secret key (sb_secret_...)";
  try {
    const p = JSON.parse(Buffer.from(k.split(".")[1], "base64url").toString());
    if (p.role === "anon") return "a chave anon (pública); precisa ser a Secret key (sb_secret_...) ou a service_role";
    if (p.ref && !SUPABASE_URL.includes(p.ref)) return `uma chave de OUTRO projeto do Supabase (${p.ref}); precisa ser deste projeto`;
    return `uma chave legada com papel "${p.role}"`;
  } catch {
    return `um texto que não parece chave do Supabase (começa com "${k.slice(0, 4)}...", ${k.length} caracteres)`;
  }
}

export function createAdminClient() {
  // Limpa o que costuma vir junto ao colar: espacos, quebra de linha, aspas e "Bearer "
  const key = chave();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY nao configurada");
  return createClient(SUPABASE_URL, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// Mensagem clara quando a service role key da Vercel esta errada (o Supabase responde 401)
export const erroAdmin = (e: { message?: string; status?: number } | null | undefined, padrao: string) =>
  e?.status === 401 || /invalid api key|unauthorized|jwt/i.test(e?.message ?? "")
    ? `A chave secreta do Supabase na Vercel (SUPABASE_SERVICE_ROLE_KEY) foi recusada. Está configurada ${tipoChave()}.`
    : e?.message || padrao;

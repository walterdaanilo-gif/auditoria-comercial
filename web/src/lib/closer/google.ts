import crypto from "node:crypto";

// Le a planilha do Closer com a conta de servico (somente leitura). Mesmo jeito de autenticar do worker/src/google.js.
export const PLANILHA_ID = process.env.CLOSER_SHEET_ID || "1QzximMIdkM5ISkw1rlRbmOldsJHTTSCu9W0s1Rjfkbw";
export const ABAS = { todos: "Todos · completude e etapas", participantes: "Participantes", atencao: "Atenção · etapas e duplicados" };

const b64 = (o: unknown) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");

async function token() {
  const bruto = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!bruto) throw new Error("Falta GOOGLE_SERVICE_ACCOUNT_JSON na Vercel.");
  const sa = JSON.parse(bruto);
  const agora = Math.floor(Date.now() / 1000);
  const corpo = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly", aud: "https://oauth2.googleapis.com/token", iat: agora, exp: agora + 3600 })}`;
  const assinatura = crypto.createSign("RSA-SHA256").update(corpo).sign(sa.private_key, "base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${corpo}.${assinatura}` }) });
  const j = await r.json();
  if (!j.access_token) throw new Error("O Google recusou a conta de serviço.");
  return j.access_token as string;
}

export async function lerAbas() {
  const q = new URLSearchParams(Object.values(ABAS).map((t) => ["ranges", `'${t}'`]));
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${PLANILHA_ID}/values:batchGet?${q}`, { headers: { Authorization: `Bearer ${await token()}` }, cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(r.status === 403 ? "A planilha não está compartilhada com a conta de serviço." : `Erro ao ler a planilha (${r.status}).`);
  const [todos, participantes, atencao] = (j.valueRanges as { values?: string[][] }[]).map((v) => v.values ?? []);
  return { todos, participantes, atencao };
}

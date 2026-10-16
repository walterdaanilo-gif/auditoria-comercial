const env = process.env;
const num = (v, d) => (v === undefined || v === "" || isNaN(+v) ? d : +v);

export const cfg = {
  supabaseUrl: (env.SUPABASE_URL || "").replace(/\/$/, ""),
  serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || "",
  anthropicKey: env.ANTHROPIC_API_KEY || "",
  model: env.AUDIT_MODEL || "claude-sonnet-5-5",
  transcribeKey: env.TRANSCRIBE_API_KEY || "",
  transcribeUrl: env.TRANSCRIBE_URL || "https://api.openai.com/v1/audio/transcriptions",
  transcribeModel: env.TRANSCRIBE_MODEL || "whisper-1",
  tz: env.TZ || "America/Sao_Paulo",
  tzOffset: env.TZ_OFFSET || "-03:00",
  idleMin: num(env.AUDIT_IDLE_MINUTES, 20),
  auditEveryMin: num(env.AUDIT_EVERY_MINUTES, 5),
  daysBack: num(env.DAYS_BACK, 1),
  allowlist: (env.LEAD_ALLOWLIST || "").split(",").map(s => s.trim()).filter(Boolean),
  port: num(env.PORT, 8080),
  dataDir: env.DATA_DIR || "./data",
  // espelho no Google Sheets
  sheetId: env.SHEET_ID || "",
  saFile: env.GOOGLE_SERVICE_ACCOUNT_FILE || "./secrets/service-account.json",
  sheetTab: env.SHEET_TAB || "SDR",
  auditTab: env.AUDIT_TAB || "Auditoria",
  messagesTab: env.MESSAGES_TAB || "Mensagens",
  sheetMessages: env.SHEET_MESSAGES !== "false",
};

export const dayOf = (iso, tz = cfg.tz) => new Intl.DateTimeFormat("sv-SE", { timeZone: tz }).format(new Date(iso));
export const today = () => dayOf(new Date().toISOString());
export const addDays = (day, n) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const dayStart = day => `${day}T00:00:00${cfg.tzOffset}`;
export const sheetSerial = day => Math.round((Date.parse(day + "T00:00:00Z") - Date.parse("1899-12-30T00:00:00Z")) / 86400000);
export const phoneOf = jid => "+" + String(jid).split("@")[0].replace(/\D/g, "");

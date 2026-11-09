const env = process.env;
const num = (v, d) => (v === undefined || v === "" || isNaN(+v) ? d : +v);

export const cfg = {
  supabaseUrl: (env.SUPABASE_URL || "").replace(/\/$/, ""),
  serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || "",
  anthropicKey: env.ANTHROPIC_API_KEY || "",
  model: env.AUDIT_MODEL || "claude-sonnet-5-5",
  transcribeKey: env.TRANSCRIBE_API_KEY || "",
  // CRM Q5 (mesma chave do crm-sync): resumos e alertas saem pelo CRM, sem precisar do WhatsApp conectado aqui
  q5Key: env.Q5_API_KEY || "",
  transcribeUrl: env.TRANSCRIBE_URL || "https://api.openai.com/v1/audio/transcriptions",
  transcribeModel: env.TRANSCRIBE_MODEL || "whisper-1",
  // OpenAI para auditar quando nao ha chave da Anthropic: OPENAI_API_KEY, ou a mesma chave da transcricao se ela for da OpenAI
  openaiKey: env.OPENAI_API_KEY || ((env.TRANSCRIBE_URL || "https://api.openai.com").includes("api.openai.com") ? env.TRANSCRIBE_API_KEY || "" : ""),
  openaiModel: env.OPENAI_MODEL || "gpt-4.1-mini",
  tz: env.TZ || "America/Sao_Paulo",
  tzOffset: env.TZ_OFFSET || "-03:00",
  idleMin: num(env.AUDIT_IDLE_MINUTES, 20),
  auditEveryMin: num(env.AUDIT_EVERY_MINUTES, 5),
  daysBack: num(env.DAYS_BACK, 1),
  allowlist: (env.LEAD_ALLOWLIST || "").split(",").map(s => s.trim()).filter(Boolean),
  port: num(env.PORT, 8080),
  dataDir: env.DATA_DIR || "./data",
  // WhatsApp pela Uazapi (se UAZAPI_URL estiver vazio, usa o Baileys)
  uazapiUrl: (env.UAZAPI_URL || "").replace(/\/$/, ""),
  uazapiAdminToken: env.UAZAPI_ADMIN_TOKEN || "",
  webhookUrl: (env.WEBHOOK_URL || "").replace(/\/$/, ""),
  webhookSecret: env.WEBHOOK_SECRET || "",
  // espelho no Google Sheets
  sheetId: env.SHEET_ID || "",
  saFile: env.GOOGLE_SERVICE_ACCOUNT_FILE || "./secrets/service-account.json",
  // alternativa ao arquivo (servidor so com variaveis): o JSON inteiro da conta de servico
  saJson: env.GOOGLE_SERVICE_ACCOUNT_JSON || "",
  // Agenda Google (login do gestor): o mesmo cliente OAuth configurado na Vercel
  // ID_DO_CLIENTE_DO_GOOGLE: o mesmo secret salvo com o nome traduzido pelo navegador
  googleClientId: env.GOOGLE_CLIENT_ID || env.ID_DO_CLIENTE_DO_GOOGLE || "",
  googleClientSecret: env.GOOGLE_CLIENT_SECRET || "",
  sheetTab: env.SHEET_TAB || "SDR",
  auditTab: env.AUDIT_TAB || "Auditoria",
  messagesTab: env.MESSAGES_TAB || "Mensagens",
  sheetMessages: env.SHEET_MESSAGES !== "false",
  // Aviso de diagnostico antes do workshop (so leitura). O codigo e o do painel do site; ficam como segredos da funcao, nunca no codigo.
  diagnosticoCode: env.DIAGNOSTICO_CODE || "",
  diagnosticoPlanilha: env.DIAGNOSTICO_PLANILHA_ID || "",
  // WhatsApp que recebe o aviso de cada venda (imersao ou plataforma): o do Bruno. Pode trocar com AVISO_VENDA_TELEFONE.
  avisoVendaTelefone: (env.AVISO_VENDA_TELEFONE || "5584999518137").replace(/\D/g, ""),
  diagnosticoSite: (env.DIAGNOSTICO_SITE || "https://weevoedu.com").replace(/\/$/, ""),
};

export const dayOf = (iso, tz = cfg.tz) => new Intl.DateTimeFormat("sv-SE", { timeZone: tz }).format(new Date(iso));
export const today = () => dayOf(new Date().toISOString());
export const addDays = (day, n) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const dayStart = day => `${day}T00:00:00${cfg.tzOffset}`;
export const sheetSerial = day => Math.round((Date.parse(day + "T00:00:00Z") - Date.parse("1899-12-30T00:00:00Z")) / 86400000);
export const phoneOf = jid => "+" + String(jid).split("@")[0].replace(/\D/g, "");

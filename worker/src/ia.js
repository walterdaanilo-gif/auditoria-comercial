import { cfg } from "./config.js";

// Qual IA usar: Anthropic (Claude) se ANTHROPIC_API_KEY existir; senao OpenAI com OPENAI_API_KEY
// (ou a mesma TRANSCRIBE_API_KEY quando a transcricao ja usa a OpenAI). Sem nenhuma, nao audita.
export const provedor = () => (cfg.anthropicKey ? "anthropic" : cfg.openaiKey ? "openai" : null);
export const modeloAtual = () => (provedor() === "anthropic" ? cfg.model : modeloOpenai);

// Se o modelo configurado nao existir na conta, tenta os proximos da lista e guarda o que funcionou
const MODELOS_OPENAI = [...new Set([cfg.openaiModel, "gpt-4.1-mini", "gpt-4o-mini"].filter(Boolean))];
let modeloOpenai = MODELOS_OPENAI[0];

// Manda system + user e devolve o texto da resposta. json=true pede JSON puro (OpenAI: response_format).
export async function chamarIA({ system, user, maxTokens = 1500, json = false, fetchImpl = fetch }) {
  if (provedor() === "anthropic") {
    const r = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "x-api-key": cfg.anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`Anthropic ${r.status}: ${JSON.stringify(j.error || j).slice(0, 300)}`);
    return (j.content || []).map(c => c.text || "").join("").trim();
  }
  if (provedor() === "openai") {
    for (const modelo of [modeloOpenai, ...MODELOS_OPENAI.filter(m => m !== modeloOpenai)]) {
      const r = await fetchImpl("https://api.openai.com/v1/chat/completions", {
        method: "POST", headers: { Authorization: `Bearer ${cfg.openaiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: modelo, max_tokens: maxTokens, temperature: 0.2, ...(json ? { response_format: { type: "json_object" } } : {}), messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      });
      const j = await r.json();
      const semModelo = r.status === 404 || j.error?.code === "model_not_found";
      if (!r.ok && semModelo) { console.error(`[ia] modelo ${modelo} indisponivel na conta OpenAI, tentando o proximo`); continue; }
      if (!r.ok) throw new Error(`OpenAI ${r.status}: ${JSON.stringify(j.error || j).slice(0, 300)}`);
      modeloOpenai = modelo;
      return String(j.choices?.[0]?.message?.content || "").trim();
    }
    throw new Error("Nenhum modelo da OpenAI disponivel. Defina OPENAI_MODEL no worker.");
  }
  throw new Error("Sem chave de IA (ANTHROPIC_API_KEY ou OPENAI_API_KEY)");
}

// Tira o primeiro objeto JSON do texto (a IA as vezes embrulha em ```json)
export function extrairJson(texto) {
  const m = String(texto).match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Resposta da IA sem JSON");
  return JSON.parse(m[0]);
}

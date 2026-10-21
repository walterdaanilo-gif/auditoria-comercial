import { uazapiAtivo, enviarTextoUazapi } from "./uazapi.js";

// Mensagem do sistema para o gestor, saindo do WhatsApp escolhido em Configuracoes (instancia_envio_id)
export async function enviarWhatsApp(db, instanciaId, numero, texto) {
  if (uazapiAtivo()) return enviarTextoUazapi(db, instanciaId, numero, texto);
  const modulo = "./whatsapp.js"; // carregado so no modo Baileys (servidor Node proprio); a Edge Function usa a Uazapi
  const { enviarTextoBaileys } = await import(modulo);
  return enviarTextoBaileys(instanciaId, numero, texto);
}

// O WhatsApp de envio (Configuracoes) esta conectado? Sem ele, resumo e follow-up esperam em vez de se perderem.
export async function envioConectado(db) {
  const [s] = await db.select("audit_settings", { select: "instancia_envio_id", filters: { id: "eq.1" } });
  if (!s?.instancia_envio_id) return true; // sem WhatsApp de envio: o resumo vai so para o sino
  const [inst] = await db.select("instancias_whatsapp", { select: "status", filters: { id: `eq.${s.instancia_envio_id}` } });
  return inst?.status === "conectado";
}

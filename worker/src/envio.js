import { uazapiAtivo, enviarTextoUazapi } from "./uazapi.js";

// Mensagem do sistema para o gestor, saindo do WhatsApp escolhido em Configuracoes (instancia_envio_id)
export async function enviarWhatsApp(db, instanciaId, numero, texto) {
  if (uazapiAtivo()) return enviarTextoUazapi(db, instanciaId, numero, texto);
  const modulo = "./whatsapp.js"; // carregado so no modo Baileys (servidor Node proprio); a Edge Function usa a Uazapi
  const { enviarTextoBaileys } = await import(modulo);
  return enviarTextoBaileys(instanciaId, numero, texto);
}

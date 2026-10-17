import { uazapiAtivo, enviarTextoUazapi } from "./uazapi.js";
import { enviarTextoBaileys } from "./whatsapp.js";

// Mensagem do sistema para o gestor, saindo do WhatsApp escolhido em Configuracoes (instancia_envio_id)
export async function enviarWhatsApp(db, instanciaId, numero, texto) {
  if (uazapiAtivo()) return enviarTextoUazapi(db, instanciaId, numero, texto);
  return enviarTextoBaileys(instanciaId, numero, texto);
}

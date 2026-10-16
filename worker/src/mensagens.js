import { cfg, dayOf } from "./config.js";

// Gravacao de uma mensagem no Supabase, igual para qualquer provedor de WhatsApp (Uazapi ou Baileys).
// m = { contato, nome, fromMe, id, tipo, texto, sec, baixarAudio }
//   contato: numero do lead (so digitos) ou id @lid sem o dominio
//   tipo: texto | audio | imagem | video | documento | outro
//   sec: horario da mensagem em segundos (epoch)
//   baixarAudio: async () => Buffer, chamado so para audios recentes
const permitido = contato => !cfg.allowlist.length || cfg.allowlist.some(a => String(contato).replace(/\D/g, "").endsWith(a.replace(/\D/g, "")));

export async function gravarMensagem(db, inst, m) {
  if (!m.contato || !m.id || !permitido(m.contato)) return;
  if (m.tipo === "outro" && !m.texto) return;
  const sec = Number(m.sec) || Math.floor(Date.now() / 1000);
  const iso = new Date(sec * 1000).toISOString();
  const day = dayOf(iso);

  const [conv] = await db.insert("conversas", [{
    vendedor_id: inst.vendedor_id, instancia_id: inst.id, contato: m.contato, contato_nome: m.fromMe ? undefined : m.nome || undefined,
    canal: "whatsapp", data: day, ultima_msg_em: iso,
  }], { onConflict: "instancia_id,contato,data" });

  // audios dos ultimos 2 dias vao para o Storage; o worker transcreve depois
  let audio_url = null;
  if (m.tipo === "audio" && m.baixarAudio && Date.now() - sec * 1000 < 2 * 86400000) {
    try {
      const buf = await m.baixarAudio();
      if (buf?.length) {
        audio_url = `${inst.vendedor_id}/whatsapp/${inst.id}/${m.id}.ogg`;
        await db.upload(audio_url, buf, "audio/ogg");
      }
    } catch (e) { console.error(`[${inst.nome}] falha ao baixar audio:`, e.message); audio_url = null; }
  }
  await db.insert("mensagens", [{
    conversa_id: conv.id, vendedor_id: inst.vendedor_id, wa_id: m.id, remetente: m.fromMe ? "vendedor" : "cliente",
    texto: m.texto || null, tipo: m.tipo, audio_url, enviada_em: iso,
  }], { onConflict: "conversa_id,wa_id", ignoreDuplicates: true, returning: false });
  // mantem a ultima mensagem da conversa sempre a mais recente
  await db.update("conversas", { id: `eq.${conv.id}`, ultima_msg_em: `lt.${iso}` }, { ultima_msg_em: iso });
}

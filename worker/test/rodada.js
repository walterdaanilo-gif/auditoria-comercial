// Dois turnos: 13h (resumo da manha + follow-up atrasado) e 19h (resumo da tarde e do dia). Cada rodada audita tudo o que mudou.
import assert from "node:assert/strict";
delete process.env.ANTHROPIC_API_KEY; process.env.TRANSCRIBE_API_KEY = "sk-teste";
const { fakeSupa } = await import("./fakeSupa.js");
const { cicloDeAuditoria } = await import("../src/ciclo.js");
const { today, addDays } = await import("../src/config.js");

const db = fakeSupa();
const SDR = "sdr-1", INST = "inst-1", hoje = today(), ontem = addDays(hoje, -1);
db.tables.profiles = [{ id: SDR, nome: "Ruan", funcao: "sdr", papel: "vendedor", ativo: true }];
db.tables.audit_settings = [{ id: 1, auditoria_automatica: true, auditoria_parada_min: 120, rodada_final_hora: "19:00", rodada_final_ultima: null, resumo_manha_hora: "13:00", resumo_manha_ultima: null, alerta_followup: true, followup_alerta_d: 6, followup_limite_d: 30, historico_dias: 7, min_mensagens: 2,
  resumo_ativo: true, resumo_dias: [0, 1, 2, 3, 4, 5, 6], instancia_envio_id: "inst-walter", meta_sdr_contatos: 30, meta_sdr_marcacoes: 6 }];
db.tables.telefones_alerta = [{ telefone: "5584999990000" }];
db.tables.criterios_rubrica = [{ rubrica: "sdr", chave: "conducao", nome: "Condução", descricao: "", peso: 100, ativo: true, posicao: 1 }];
for (const t of ["conversas", "mensagens", "auditorias", "notificacoes", "numeros_ignorados", "resumos_turno", "followups_avisados"]) db.tables[t] = [];
const conv = (id, data, ultima, textos) => {
  db.tables.conversas.push({ id, vendedor_id: SDR, instancia_id: INST, contato: "5584988887777", canal: "whatsapp", data, ultima_msg_em: ultima, auditar_agora: false });
  textos.forEach(([rem, texto], i) => db.tables.mensagens.push({ id: `${id}-${i}`, conversa_id: id, vendedor_id: SDR, remetente: rem, texto, tipo: "texto", enviada_em: new Date(Date.parse(ultima) - (textos.length - i) * 60_000).toISOString() }));
};
conv("ontem", ontem, `${ontem}T15:00:00-03:00`, [["vendedor", "Oi Ana, workshop quinta?"], ["cliente", "vou ver com meu sócio"]]);
const agora = new Date(Date.now() - 30 * 60_000).toISOString(); // parada so ha 30 min
conv("hoje", hoje, agora, [["vendedor", "Falou com o sócio?"], ["cliente", "Falei, pode inscrever, uso o cupom"]]);

const prompts = [];
const ia = async (_u, o) => { const b = JSON.parse(o.body); prompts.push(b.messages[1].content);
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ notas: [{ criterio: "conducao", nota: 5 }], venda: { detectada: true, tipo: "workshop", cupom: true }, agendou: true, tipo_agendamento: "workshop" }) } }] }) }; };
globalThis.fetch = ia;

// lead em negociacao parado ha 8 dias (interesse na imersao, sem venda): entra no alerta de follow-up
const velho = addDays(hoje, -8);
db.tables.conversas.push({ id: "parado", vendedor_id: SDR, instancia_id: INST, contato: "5584911112222", telefone: "5584911112222", contato_nome: "Carla Dias", canal: "whatsapp", data: velho, ultima_msg_em: `${velho}T10:00:00-03:00`, auditar_agora: false });
db.tables.auditorias.push({ id: "a-parado", conversa_id: "parado", vendedor_id: SDR, oportunidade: true, oportunidade_tipo: "interesse_imersao", venda: false });
db.tables.mensagens.push({ id: "p1", conversa_id: "parado", vendedor_id: SDR, remetente: "cliente", texto: "quero saber da imersão", tipo: "texto", enviada_em: `${velho}T09:50:00-03:00` },
  { id: "p2", conversa_id: "parado", vendedor_id: SDR, remetente: "vendedor", texto: "te mando os detalhes", tipo: "texto", enviada_em: `${velho}T10:00:00-03:00` });
db.tables.instancias_whatsapp = [{ id: INST, vendedor_id: SDR, numero: "5584986483304" }, { id: "inst-walter", vendedor_id: "walter", numero: "5584936180882" }];
db.tables.crm_conversas = [];

// 12h: a de ontem (parada ha horas) e auditada; a de hoje, parada so 30 min (regra de 2h), espera. Sem resumo.
const enviados = [];
const envio = async (_db, inst, tel, texto) => enviados.push({ inst, tel, texto });
assert.equal(await cicloDeAuditoria(db, { hora: "12:00", envio }), 1);
assert.equal(db.tables.auditorias.find(a => a.conversa_id === "hoje"), undefined);
assert.equal(enviados.length, 0);

// 13h: audita sem esperar as 2h, manda o resumo da manha e o alerta de follow-up
db.rpcs.resumo_sdr2 = () => [{ dia: hoje, vendedor_id: SDR, contatadas: 1, enviadas: 1, respostas: 1, ligacoes: 3, ligacoes_atendidas: 2, ligacoes_seg: 300, marcacoes: 1, auditadas: 1, nota_soma: 10 }];
assert.equal(await cicloDeAuditoria(db, { hora: "13:02", envio }), 1, "a de hoje, sem esperar as 2h");
const aHoje = db.tables.auditorias.find(a => a.conversa_id === "hoje");
assert.equal(aHoje.venda, true); assert.equal(aHoje.venda_cupom, true);
const pHoje = prompts.find(p => p.includes("Falou com o sócio"));
assert.ok(pHoje.includes("HISTÓRICO DOS DIAS ANTERIORES") && pHoje.includes("vou ver com meu sócio") && pHoje.includes("CONVERSA DO DIA"), "leva o historico de ontem como contexto");
assert.equal(db.tables.audit_settings[0].resumo_manha_ultima, hoje);
assert.equal(enviados.length, 3, "resumo da manha + follow-up para o vendedor + erro de follow-up para a gestao");
assert.equal(enviados[0].tel, "5584999990000"); assert.equal(enviados[0].inst, "inst-walter");
const manha = enviados[0].texto;
assert.ok(manha.startsWith("🚀 *Aviso do Cabueta*") && /turno da manhã|resumo da manhã|Resumo do turno da manhã/.test(manha) && manha.includes("Ligações atendidas: 2 de 3") && manha.includes("Workshop por convite (cupom 100% ou Carbone): 1") && manha.includes("Como cada um foi na manhã") && manha.includes("1/6 marcações") && manha.includes("🎟️ 1 convite"), manha);
const fuV = enviados[1];
assert.equal(fuV.tel, "5584986483304", "vai para o WhatsApp do proprio vendedor");
assert.ok(fuV.texto.startsWith("⏰ *FOLLOW-UP ATRASADO*") && fuV.texto.includes("Oi, Ruan!") && fuV.texto.includes("Carla Dias") && fuV.texto.includes("8 dias sem follow-up") && fuV.texto.includes("interesse na imersão") && fuV.texto.includes("/conversas/parado"), fuV.texto);
const fu = enviados[2].texto;
assert.equal(enviados[2].tel, "5584999990000");
assert.ok(fu.startsWith("⚠️ *ERRO DE FOLLOW-UP*") && fu.includes("*Ruan (SDR)*: 1 lead sem follow-up") && fu.includes("Carla Dias"), fu);
assert.ok(!fu.includes("5584988887777") && !fuV.texto.includes("(84) 98888-7777"), "lead que comprou nao entra no follow-up");
assert.ok(db.tables.notificacoes.some(n => n.para === SDR && n.titulo.startsWith("Follow-up atrasado")), "notificacao no sistema para o vendedor");
assert.equal(db.tables.resumos_turno.length, 1);

// 13h30: ja mandou a manha, nao repete
await cicloDeAuditoria(db, { hora: "13:30", envio });
assert.equal(enviados.length, 3);

// 19h: a tarde = dia menos a manha (2 conversas e 1 marcacao a mais) + dia completo
db.rpcs.resumo_sdr2 = () => [{ dia: hoje, vendedor_id: SDR, contatadas: 3, enviadas: 3, respostas: 3, ligacoes: 4, ligacoes_atendidas: 3, ligacoes_seg: 300, marcacoes: 2, auditadas: 1, nota_soma: 10 }];
await cicloDeAuditoria(db, { hora: "19:01", envio });
assert.equal(enviados.length, 4);
const txt = enviados[3].texto;
assert.ok(txt.startsWith("🚀 *Aviso do Cabueta*") && txt.includes("🌇 *Tarde (13h às 19h)*") && txt.includes("💬 Conversas trocadas: 2 · 📅 Marcações: 1") && txt.includes("📞 Ligações atendidas: 1 de 1") && txt.includes("• Ruan: 2 conversas · 1 marcação")
  && txt.includes("📊 *Dia completo*") && txt.includes("Ligações atendidas: 3 de 4") && txt.includes("Como cada um foi no dia") && txt.includes("👑 Destaque do dia: *Ruan*") && txt.includes("2/6 marcações"), txt);
assert.equal(db.tables.audit_settings[0].rodada_final_ultima, hoje);

// 19h10: ja rodou hoje, nao repete; follow-up do mesmo lead parado nao repete
await cicloDeAuditoria(db, { hora: "19:10", envio });
assert.equal(enviados.length, 4);
const { avisarFollowups } = await import("../src/followup.js");
assert.equal(await avisarFollowups(db, { envio }), "nenhum lead parado novo");
console.log("OK: resumo da manha (13h) + follow-up, resumo da tarde e do dia (19h), sem repetir");
console.log("\n--- resumo da manha ---\n" + manha + "\n\n--- follow-up (vendedor) ---\n" + fuV.texto + "\n\n--- follow-up (gestao) ---\n" + fu + "\n\n--- resumo das 19h ---\n" + txt);

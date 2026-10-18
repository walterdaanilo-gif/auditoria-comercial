// Rodada final do dia (18h): audita tudo o que mudou, usa o historico do lead e manda o relatorio ao gestor
import assert from "node:assert/strict";
delete process.env.ANTHROPIC_API_KEY; process.env.TRANSCRIBE_API_KEY = "sk-teste";
const { fakeSupa } = await import("./fakeSupa.js");
const { cicloDeAuditoria } = await import("../src/ciclo.js");
const { today, addDays } = await import("../src/config.js");

const db = fakeSupa();
const SDR = "sdr-1", INST = "inst-1", hoje = today(), ontem = addDays(hoje, -1);
db.tables.profiles = [{ id: SDR, nome: "Ruan", funcao: "sdr", papel: "vendedor", ativo: true }];
db.tables.audit_settings = [{ id: 1, auditoria_automatica: true, auditoria_parada_min: 120, rodada_final_hora: "18:00", rodada_final_ultima: null, historico_dias: 7, min_mensagens: 2,
  resumo_ativo: true, resumo_dias: [0, 1, 2, 3, 4, 5, 6], instancia_envio_id: "inst-walter", meta_sdr_contatos: 30, meta_sdr_marcacoes: 6 }];
db.tables.telefones_alerta = [{ telefone: "5584999990000" }];
db.tables.criterios_rubrica = [{ rubrica: "sdr", chave: "conducao", nome: "Condução", descricao: "", peso: 100, ativo: true, posicao: 1 }];
for (const t of ["conversas", "mensagens", "auditorias", "notificacoes", "numeros_ignorados"]) db.tables[t] = [];
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

// 15h: a de ontem (parada ha horas) e auditada; a de hoje, parada so 30 min (regra de 2h), espera. Sem relatorio.
const enviados = [];
const envio = async (_db, inst, tel, texto) => enviados.push({ inst, tel, texto });
assert.equal(await cicloDeAuditoria(db, { hora: "15:00", envio }), 1);
assert.equal(db.tables.auditorias.find(a => a.conversa_id === "hoje"), undefined);
assert.equal(enviados.length, 0);

// 18h: rodada final audita sem esperar as 2h e manda o relatorio uma vez
db.rpcs.resumo_sdr2 = () => [{ dia: hoje, vendedor_id: SDR, contatadas: 1, enviadas: 1, respostas: 1, ligacoes: 3, ligacoes_atendidas: 2, ligacoes_seg: 300, marcacoes: 1, auditadas: 1, nota_soma: 10 }];
assert.equal(await cicloDeAuditoria(db, { hora: "18:02", envio }), 1, "a de hoje, sem esperar as 2h");
const aHoje = db.tables.auditorias.find(a => a.conversa_id === "hoje");
assert.equal(aHoje.venda, true); assert.equal(aHoje.venda_cupom, true);
const pHoje = prompts.find(p => p.includes("Falou com o sócio"));
assert.ok(pHoje.includes("HISTÓRICO DOS DIAS ANTERIORES") && pHoje.includes("vou ver com meu sócio") && pHoje.includes("CONVERSA DO DIA"), "leva o historico de ontem como contexto");
assert.equal(db.tables.audit_settings[0].rodada_final_ultima, hoje);
assert.equal(enviados.length, 1); assert.equal(enviados[0].tel, "5584999990000"); assert.equal(enviados[0].inst, "inst-walter");
const txt = enviados[0].texto;
assert.ok(txt.startsWith("🚀 *Aviso do Elon Musk*") && txt.includes("resumo do dia") && txt.includes("Ligações atendidas: 2 de 3") && txt.includes("1 com cupom R$ 0") && txt.includes("Como cada um foi") && txt.includes("👑 Destaque do dia: *Ruan*") && txt.includes("1. Ruan (SDR)") && txt.includes("1/6 marcações"), txt);
assert.ok(db.tables.audit_settings[0].resumo_ultimo_envio);

// 18h10: ja rodou hoje, nao repete o relatorio
await cicloDeAuditoria(db, { hora: "18:10", envio });
assert.equal(enviados.length, 1);
console.log("OK: rodada final das 18h, historico do lead e relatorio do dia para o gestor");
console.log("\n--- exemplo do relatorio ---\n" + txt);

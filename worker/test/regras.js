// Auditoria seguindo a tela Configuracoes, usando a OpenAI (sem chave da Anthropic)
import assert from "node:assert/strict";
delete process.env.ANTHROPIC_API_KEY; process.env.TRANSCRIBE_API_KEY = "sk-teste";
const { fakeSupa } = await import("./fakeSupa.js");
const { runAudits, notaFinal, chaveTelefone, montarPrompt, carregarRegras, rubricaDe } = await import("../src/auditor.js");
const { provedor } = await import("../src/ia.js");
assert.equal(provedor(), "openai", "sem Anthropic, usa a chave da OpenAI da transcricao");

const db = fakeSupa();
const SDR = "sdr-1", CLOSER = "closer-1", GESTOR = "g-1";
db.tables.profiles = [{ id: SDR, nome: "Ruan", funcao: "sdr", papel: "vendedor", ativo: true }, { id: CLOSER, nome: "Carla", funcao: "closer", papel: "vendedor", ativo: true }, { id: GESTOR, nome: "Walter", papel: "admin", ativo: true }];
db.tables.audit_settings = [{ id: 1, auditoria_automatica: true, min_mensagens: 2, regras_criticas: ["Lead ameaçou reclamar no Procon"], venda_conta: ["Lead usou cupom de convite"], sla_primeira_resposta_min: 15 }];
db.tables.criterios_rubrica = [
  { rubrica: "sdr", chave: "abordagem", nome: "Abordagem", descricao: "x", peso: 40, ativo: true, posicao: 1 },
  { rubrica: "sdr", chave: "conducao", nome: "Condução", descricao: "y", peso: 60, ativo: true, posicao: 2 },
  { rubrica: "closer", chave: "fechamento", nome: "Fechamento", descricao: "z", peso: 100, ativo: true, posicao: 1 },
];
db.tables.numeros_ignorados = [{ telefone: "5584977776666" }];
db.tables.conversas = []; db.tables.mensagens = []; db.tables.auditorias = []; db.tables.notificacoes = [];

const velho = new Date(Date.now() - 3 * 3600_000);
const conversa = (id, vend, contato, textos) => {
  db.tables.conversas.push({ id, vendedor_id: vend, contato, contato_nome: null, canal: "whatsapp", data: new Date().toISOString().slice(0, 10), ultima_msg_em: velho.toISOString(), auditar_agora: false });
  textos.forEach(([rem, texto], i) => db.tables.mensagens.push({ id: `${id}-${i}`, conversa_id: id, vendedor_id: vend, remetente: rem, texto, tipo: "texto", enviada_em: new Date(velho.getTime() + i * 60_000).toISOString() }));
};
conversa("c1", SDR, "5584988887777", [["vendedor", "Oi, workshop quinta?"], ["cliente", "topo, uso o cupom"]]);
conversa("c2", SDR, "84977776666", [["vendedor", "Oi chefe"], ["cliente", "fala"]]); // numero ignorado (sem 55 e sem o 9 extra tambem casa)
conversa("c3", CLOSER, "5584911112222", [["vendedor", "Fechamos a imersão?"], ["cliente", "Fechado, mandei o pix de 4800. Mas se atrasar vou no Procon"]]);

const pedidos = [];
const openai = async (url, o) => {
  assert.match(String(url), /api\.openai\.com\/v1\/chat\/completions/);
  const body = JSON.parse(o.body); pedidos.push(body);
  assert.equal(body.response_format.type, "json_object");
  const user = body.messages[1].content, closer = body.messages[0].content.includes("Este vendedor é CLOSER");
  const r = closer
    ? { notas: [{ criterio: "fechamento", nota: 5, justificativa: "pediu o fechamento" }], venda: { detectada: true, tipo: "workshop", valor: 4800, cupom: false, evidencia: "pix de 4800" }, critico: { detectado: true, motivo: "ameaçou Procon" }, agendou: false }
    : { notas: [{ criterio: "abordagem", nota: 3 }, { criterio: "conducao", nota: "5" }], venda: { detectada: user.includes("cupom"), valor: 50, cupom: true }, oportunidade: { detectada: false }, agendou: true, tipo_agendamento: "lixo" };
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(r) } }] }) };
};

assert.equal(await runAudits(db, { fetchImpl: openai }), 2, "c1 e c3 auditadas; c2 e de numero ignorado");
const aud = id => db.tables.auditorias.find(a => a.conversa_id === id);
assert.equal(aud("c2"), undefined);
// SDR: rubrica do SDR, nota 1-5 ponderada -> 0-10, cupom = venda de workshop com valor 0
const a1 = aud("c1");
assert.equal(a1.rubrica, "sdr"); assert.equal(a1.nota_geral, notaFinal([{ chave: "abordagem", peso: 40 }, { chave: "conducao", peso: 60 }], [{ criterio: "abordagem", nota: 3 }, { criterio: "conducao", nota: 5 }]));
assert.equal(a1.nota_geral, 8); // (3*0.4 + 5*0.6 = 4.2) -> (3.2/4)*10
// cupom com R$ 50 pago = desconto parcial: e workshop VENDIDO, nao convite
assert.equal(a1.venda, true); assert.equal(a1.venda_tipo, "workshop"); assert.equal(a1.venda_valor, 50); assert.equal(a1.venda_cupom, false);
assert.equal(a1.tipo_agendamento, "workshop", "tipo invalido vira workshop");
// Closer: venda e sempre imersao, com valor; critico gera notificacao no app (gestor + vendedor), nunca WhatsApp
const a3 = aud("c3");
assert.equal(a3.rubrica, "closer"); assert.equal(a3.nota_geral, 10); assert.equal(a3.venda_tipo, "imersao"); assert.equal(a3.venda_valor, 4800);
assert.equal(a3.critico, true);
assert.deepEqual(db.tables.notificacoes.map(n => n.para).sort(), [CLOSER, GESTOR].sort());
// prompt leva as regras do gestor e a rubrica certa
const pSdr = pedidos.find(p => p.messages[0].content.includes("Este vendedor é SDR")).messages[0].content;
assert.ok(pSdr.includes("Lead usou cupom de convite") && pSdr.includes("Lead ameaçou reclamar no Procon") && pSdr.includes("- conducao: Condução") && pSdr.includes("SLA de primeira resposta: 15 min"));

// Auditoria automatica desligada: so "Auditar agora"
db.tables.audit_settings[0].auditoria_automatica = false;
db.tables.mensagens.push({ id: "c1-9", conversa_id: "c1", vendedor_id: SDR, remetente: "cliente", texto: "e o link?", tipo: "texto", enviada_em: new Date(velho.getTime() + 600_000).toISOString() });
assert.equal(await runAudits(db, { fetchImpl: openai }), 0, "desligada: nao audita sozinho");
db.tables.conversas.find(c => c.id === "c2").auditar_agora = true;
assert.equal(await runAudits(db, { fetchImpl: openai, soSinais: true }), 1, "auditar agora passa por cima do numero ignorado");
assert.equal(aud("c2").manual, true); assert.equal(db.tables.conversas.find(c => c.id === "c2").auditar_agora, false);

// Peso de cada criterio pesa na nota; telefone com e sem 9 casa
assert.equal(chaveTelefone("5584988887777"), chaveTelefone("8488887777"));
const R = await carregarRegras(db);
assert.ok(montarPrompt(R, rubricaDe(R, CLOSER)).includes("reuniao_implementacao"));
console.log("OK: auditoria com OpenAI seguindo Configuracoes (rubrica por funcao, ignorados, venda, critico, auditar agora)");

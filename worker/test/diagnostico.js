// Aviso de diagnostico pendente: 6h antes de cada turma, o SDR recebe (sino + WhatsApp) os inscritos que ainda nao preencheram.
// Tudo simulado: banco em memoria, planilha e site de mentira. Confere tambem que o codigo do site nunca aparece no log.
import assert from "node:assert/strict";
const CODIGO = "segredo-teste-123";
process.env.DIAGNOSTICO_CODE = CODIGO; process.env.DIAGNOSTICO_PLANILHA_ID = "planilha-teste";
const { fakeSupa } = await import("./fakeSupa.js");
const { avisarDiagnosticos, lerTurmas, naJanela, pendentesDaTurma, textoSdr, fone, chave } = await import("../src/diagnostico.js");
const { cfg } = await import("../src/config.js");

const aba = (nome, gid) => `{name: "${nome.replace(/\//g, "\\/")}", pageUrl: "https:\\/\\/docs.google.com\\/spreadsheets\\/d\\/x\\/htmlview\\/sheet?headers\\x3dtrue&gid=${gid}", gid: "${gid}",initialSheet: ("${gid}" == gid)}`;
const HTML = [aba("WORKSHOP 09/11/26 18h", "111"), aba("WORKSHOP ODONTO 06/11/26 14h", "222"), aba("WORKSHOP 03/11/26", "333"), aba(" WORKSHOP 25/08/26 18h", "444"), aba("WORKSHOP 31/10/26 9h", "555"), aba("Resumo geral", "666"), aba("WORKSHOP 10/11/26 16h30", "777")].join("\n");

// 1) leitura das abas
const turmas = lerTurmas(HTML);
assert.equal(turmas.length, 6, "6 abas de workshop (a 'Resumo geral' fica de fora)");
const t = Object.fromEntries(turmas.map(x => [x.chave, x]));
assert.deepEqual([t[111].ddmm, t[111].data, t[111].hora], ["09/11", "2026-11-09", "18:00"]);
assert.equal(t[222].ddmm, "06/11"); assert.equal(t[222].hora, "14:00");
assert.equal(t[333].hora, null); assert.equal(t[333].inicio, null, "aba sem hora nao agenda aviso");
assert.equal(t[444].hora, "18:00", "espaco no comeco do nome");
assert.equal(t[555].hora, "09:00", "9h vira 09:00");
assert.equal(t[777].hora, "16:30", "16h30");
assert.equal(t[111].inicio, Date.parse("2026-11-09T18:00:00-03:00"), "horario de Brasilia");

// 2) janela de 6 horas
const ini = t[111].inicio, H = 3600_000;
assert.equal(naJanela(t[111], ini - 6 * H - 60_000), false, "6h01 antes: ainda nao");
assert.equal(naJanela(t[111], ini - 6 * H), true, "6h antes: entra");
assert.equal(naJanela(t[111], ini - 1), true, "na ultima hora ainda vale");
assert.equal(naJanela(t[111], ini), false, "depois que comeca: nao");
assert.equal(naJanela(t[333], ini), false, "sem hora: nunca");

// 3) telefone
assert.equal(chave("(84) 98888-7777"), chave("+55 84 8888-7777"), "com 9 extra e com 55 casam");
assert.equal(fone("5584988887777"), "(84) 98888-7777");

// dados do cenario
const lead = (id, nome, whats, extra = {}) => ({ id, nome, whatsapp: whats, data_evento: "09/11", status: "pago_pendente_qualificacao", paid_at: "2026-11-01T10:00:00Z", inscrito_direto_at: null, ...extra });
const LEADS = [
  lead("A", "Ana Souza", "(84) 98888-7777"),                                  // pendente, SDR1, link enviado
  lead("B", "Bia Lima", "(84) 97777-6666"),                                   // ja preencheu
  lead("C", "Caio Reis", "(84) 96666-5555", { status: "lead", paid_at: null }), // so escolheu a data: nao esta inscrito
  lead("D", "Davi Melo", "(84) 95555-4444"),                                  // pendente, sem conversa: sem SDR
  lead("E", "Eva Dias", "(84) 94444-3333"),                                   // pendente, so conversou com closer: sem SDR
  lead("F", "Fabio Cruz", "(84) 93333-2222", { data_evento: "10/11" }),       // outra turma
  lead("G", "Gil Alves", "(84) 92222-1111"),                                  // pendente, SDR2 (CRM), sem numero de WhatsApp
  lead("H", "Hugo Reis", "(84) 91111-0000"),                                  // preencheu (telefone so no campo p4_whatsapp)
  lead("I", "Ivo Nunes", "(84) 90000-9999", { status: "lead", paid_at: null, inscrito_direto_at: "2026-11-02T10:00:00Z" }), // inscrito direto: conta
];
const DIAGS = [{ id: "d1", variables: { nome: "Bia", whatsapp: "(84) 97777-6666", score: 60 } }, { id: "d2", variables: { nome: "Hugo", whatsapp: "", p4_whatsapp: "84 91111-0000", score: 50 } }];

// 4) regra pura
const donos = new Map([[chave("84988887777"), "sdr1"], [chave("84922221111"), "sdr2"]]);
const links = new Set([chave("84988887777")]);
const p = pendentesDaTurma(t[111], { leads: LEADS, diagnosticos: DIAGS, donos, links });
assert.equal(p.inscritos, 7, "A, B, D, E, G, H, I (C nao pagou/inscreveu e F e de outra turma)");
assert.equal(p.preenchidos, 2, "B e H");
assert.equal(p.pendentes, 5, "A, D, E, G, I");
assert.deepEqual([...p.porSdr.keys()].sort(), ["sdr1", "sdr2"]);
assert.equal(p.porSdr.get("sdr1")[0].linkEnviado, true); assert.equal(p.porSdr.get("sdr2")[0].linkEnviado, false);
assert.equal(p.semSdr.length, 3, "D, E e I sem SDR identificado");

// 5) tarefa completa
function cenario({ envioConfigurado = true } = {}) {
  const db = fakeSupa();
  db.tables.audit_settings = [{ id: 1, ...(envioConfigurado ? { instancia_envio_id: "inst-envio" } : {}) }];
  db.tables.profiles = [{ id: "sdr1", nome: "Rafael Costa", funcao: "sdr" }, { id: "sdr2", nome: "Bianca Dias", funcao: "sdr" }, { id: "closer1", nome: "Carlos Closer", funcao: "closer" }];
  db.tables.instancias_whatsapp = [{ vendedor_id: "sdr1", numero: "5584900000001" }]; // a SDR2 nao tem WhatsApp conectado
  const dia = new Date().toISOString().slice(0, 10);
  db.tables.conversas = [
    { id: "c1", vendedor_id: "sdr1", contato: "5584988887777@s.whatsapp.net", telefone: "5584988887777", ultima_msg_em: "2026-11-05T12:00:00Z", data: dia, canal: "individual" },
    { id: "c2", vendedor_id: "closer1", contato: "5584944443333@s.whatsapp.net", telefone: "5584944443333", ultima_msg_em: "2026-11-05T12:00:00Z", data: dia, canal: "individual" },
  ];
  db.tables.crm_conversas = [{ id: "k1", vendedor_id: "sdr2", telefone: "84922221111", ultima_msg_em: "2026-11-04T12:00:00Z" }];
  db.tables.mensagens = [{ id: "m1", conversa_id: "c1", remetente: "vendedor", texto: "Faz o diagnostico: https://weevoedu.com/questionario/diagnostico/abc", enviada_em: new Date().toISOString() }];
  db.tables.crm_mensagens = [];
  return db;
}
const chamadas = [];
const site = (falha = null) => async (url, opts = {}) => {
  chamadas.push(`${opts.method || "GET"} ${url}`);
  if (url.includes("docs.google.com")) return { ok: true, status: 200, text: async () => HTML };
  if (falha && url.includes(falha)) return { ok: false, status: 500, text: async () => `erro com ${CODIGO}`, json: async () => ({}) };
  assert.equal(JSON.parse(opts.body).code, CODIGO, "manda o codigo configurado");
  if (url.endsWith("/api/admin/dash")) return { ok: true, status: 200, json: async () => ({ leads: LEADS, isca: [] }) };
  if (url.endsWith("/api/diagnostico/list")) return { ok: true, status: 200, json: async () => ({ rows: DIAGS, datasTurma: [] }) };
  throw new Error("endereco nao esperado: " + url);
};
const logs = [];
const orig = { log: console.log, error: console.error, warn: console.warn };
for (const k of Object.keys(orig)) console[k] = (...a) => logs.push(a.map(String).join(" "));
try {
  // 5a) fora da janela: nem chega a consultar o site
  let db = cenario(), enviados = [];
  const envio = async (_db, inst, numero, texto) => { enviados.push({ inst, numero, texto }); };
  let r = await avisarDiagnosticos(db, { agora: ini - 6 * H - 60_000, fetchImpl: site(), envio });
  assert.equal(r, "nenhuma turma na janela de 6h");
  assert.deepEqual(chamadas.filter(c => !c.includes("docs.google.com")), [], "fora da janela nao chama o site do diagnostico");
  assert.equal(enviados.length, 0);

  // 5b) dentro da janela: avisa os SDRs
  chamadas.length = 0;
  r = await avisarDiagnosticos(db, { agora: ini - 5 * H - 30 * 60_000, fetchImpl: site(), envio });
  assert.match(r, /5 sem diagnostico, 2 SDR\(s\) avisado\(s\), 3 sem SDR identificado/);
  assert.deepEqual(chamadas.filter(c => !c.includes("docs.google.com")).sort(), [`POST ${cfg.diagnosticoSite}/api/admin/dash`, `POST ${cfg.diagnosticoSite}/api/diagnostico/list`], "so le: nunca chama marcar nem gerar");
  assert.equal(enviados.length, 1, "so a SDR1 tem WhatsApp conectado: um WhatsApp");
  assert.deepEqual([enviados[0].inst, enviados[0].numero], ["inst-envio", "5584900000001"]);
  const txt = enviados[0].texto;
  assert.ok(txt.includes("Turma 09/11 às 18h") && txt.includes("Oi, Rafael!") && txt.includes("Ana Souza · (84) 98888-7777 · link já enviado"), txt);
  assert.ok(!txt.includes("Bia Lima") && !txt.includes("Caio Reis") && !txt.includes("Gil Alves") && !txt.includes("Fabio") && !txt.includes("Hugo"), "so os pendentes dela");
  assert.ok(txt.includes("cerca de 6h"), "tempo ate a turma");
  const sino = db.tables.notificacoes;
  assert.equal(sino.length, 2, "sino para os dois SDRs");
  assert.ok(sino.every(n => n.categoria === "diagnostico"));
  assert.ok(sino.find(n => n.para === "sdr2").texto.includes("Gil Alves · (84) 92222-1111 · link ainda não enviado"));
  const av = db.tables.diagnostico_avisos;
  assert.deepEqual(av.map(a => [a.vendedor_id, a.qtd, a.canais]).sort(), [["sdr1", 1, "sino,whatsapp"], ["sdr2", 1, "sino"]]);
  assert.equal(db.tables.diagnostico_turmas.length, 1);
  assert.equal(db.tables.diagnostico_turmas[0].sem_sdr, 3);

  // 5c) cinco minutos depois: nao repete
  r = await avisarDiagnosticos(db, { agora: ini - 5 * H - 25 * 60_000, fetchImpl: site(), envio });
  assert.equal(r, "nenhuma turma na janela de 6h");
  assert.equal(enviados.length, 1); assert.equal(db.tables.notificacoes.length, 2, "nao repete o aviso");

  // 5d) sem WhatsApp de envio configurado: so o sino
  db = cenario({ envioConfigurado: false }); enviados = [];
  r = await avisarDiagnosticos(db, { agora: ini - 3 * H, fetchImpl: site(), envio });
  assert.equal(enviados.length, 0); assert.equal(db.tables.notificacoes.length, 2);
  assert.ok(db.tables.diagnostico_avisos.every(a => a.canais === "sino"));

  // 5e) o site falha: nada e marcado (tenta de novo no proximo ciclo) e o erro nao mostra o codigo
  db = cenario(); enviados = [];
  await assert.rejects(() => avisarDiagnosticos(db, { agora: ini - 3 * H, fetchImpl: site("/api/diagnostico/list"), envio }), e => { assert.ok(!e.message.includes(CODIGO)); assert.match(e.message, /HTTP 500/); return true; });
  assert.equal((db.tables.diagnostico_turmas || []).length, 0, "falha nao marca a turma");
  r = await avisarDiagnosticos(db, { agora: ini - 3 * H, fetchImpl: site(), envio });
  assert.match(r, /2 SDR\(s\) avisado\(s\)/, "no ciclo seguinte funciona");

  // 5f) sem os segredos: desligado
  const salvo = [cfg.diagnosticoCode, cfg.diagnosticoPlanilha]; cfg.diagnosticoCode = "";
  assert.match(await avisarDiagnosticos(cenario(), { agora: ini - 3 * H, fetchImpl: site(), envio }), /^desligado/);
  [cfg.diagnosticoCode, cfg.diagnosticoPlanilha] = salvo;

  // 6) o codigo e os dados dos clientes nunca vao para o log
  const todo = logs.join("\n");
  assert.ok(!todo.includes(CODIGO), "codigo fora do log");
  assert.ok(!/Ana Souza|Gil Alves|98888-7777/.test(todo), "nomes e telefones fora do log");
  assert.ok(textoSdr("Rafael Costa", t[111], [{ nome: "X", telefone: "84999990000", linkEnviado: false }], 6).includes("este cliente seu ainda não preencheu"), "singular");
} finally { Object.assign(console, orig); }
console.log("OK diagnostico: turmas, janela de 6h, regra dos pendentes, sino + WhatsApp, sem repetir, falhas e segredos");

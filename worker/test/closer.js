// Painel do Closer, "Ler conversa": acha a conversa do lead pelo telefone (so na Weevo), sugere sem gravar
// e nunca escreve o conteudo da conversa no log
import assert from "node:assert/strict";
delete process.env.ANTHROPIC_API_KEY; process.env.OPENAI_API_KEY = "sk-teste";
const { fakeSupa } = await import("./fakeSupa.js");
const { sugerirParaLead, interpretarSugestao } = await import("../src/closer.js");

const db = fakeSupa();
const WEEVO = "org-weevo", CARBONE = "org-carbone";
db.tables.organizacoes = [{ id: WEEVO, slug: "weevo" }, { id: CARBONE, slug: "carbone" }];
db.tables.conversas = [];
db.tables.mensagens = [];
const SEGREDO = "quero fechar a plataforma pelo pix";
const conv = (id, org, campos, msgs) => {
  db.tables.conversas.push({ id, org_id: org, vendedor_id: "v1", contato: campos.contato, telefone: campos.telefone ?? null, contato_nome: "Ana", canal: "whatsapp", data: "2026-11-03", ultima_msg_em: msgs.at(-1)[2] });
  msgs.forEach(([remetente, texto, enviada_em], i) => db.tables.mensagens.push({ id: `${id}-${i}`, conversa_id: id, remetente, texto, tipo: "texto", enviada_em }));
};
// Ana: numero com 55 e com o 9 extra; a conversa da Carbone com o mesmo numero nao pode entrar
conv("c1", WEEVO, { contato: "5584988887777" }, [["vendedor", "Oi Ana, tudo bem?", "2026-11-02T12:00:00Z"], ["cliente", SEGREDO, "2026-11-02T12:05:00Z"]]);
conv("c-carbone", CARBONE, { contato: "5584988887777" }, [["cliente", "mensagem da carbone", "2026-11-03T12:00:00Z"]]);
// Bia: so o vendedor falou
conv("c2", WEEVO, { contato: "5584977776666" }, [["vendedor", "Oi Bia, vamos conversar?", "2026-10-30T12:00:00Z"]]);

let chamadas = 0, ultimoPrompt = "", resposta = {};
const ia = async (_u, o) => {
  chamadas++; ultimoPrompt = JSON.parse(o.body).messages[1].content;
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(resposta) } }] }) };
};

// tudo que o worker escrever no console fica guardado para conferir
const logs = [];
const orig = { log: console.log, error: console.error, warn: console.warn };
for (const k of Object.keys(orig)) console[k] = (...a) => logs.push(a.map(String).join(" "));
try {
  // 1) acha pelo telefone sem 55 e sem o 9 extra (DDD + 8 digitos), so na Weevo
  resposta = { status: "negociando", motivo: "Sem perfil", resumo: "Quer fechar pelo pix.", proxima_acao: "Mandar o link de pagamento.", sugestao_resposta: "", evidencia: ["quero fechar"], confianca: "alta" };
  let r = await sugerirParaLead(db, { telefone: "(84) 8888-7777", nome: "Ana", produto: "Weevo Start (Plataforma)", orientacoes: ["Não fale a data de início."] }, { fetchImpl: ia });
  assert.equal(r.ok, true); assert.equal(r.encontrou, true); assert.equal(r.mensagens, 2, "so as mensagens da Weevo");
  assert.equal(r.sugestao.status, "negociando"); assert.equal(r.sugestao.motivo, "", "motivo so vale para desqualificado");
  assert.ok(ultimoPrompt.includes(SEGREDO) && !ultimoPrompt.includes("mensagem da carbone"), "a conversa da Carbone nao entra");
  assert.match(ultimoPrompt, /\d{2}\/\d{2} \d{2}:\d{2} CLIENTE: /);
  // com 55 e o 9 extra tambem acha
  r = await sugerirParaLead(db, { telefone: "+55 84 98888-7777" }, { fetchImpl: ia });
  assert.equal(r.encontrou, true);

  // 2) lead sem conversa
  r = await sugerirParaLead(db, { telefone: "84 91234-0000" }, { fetchImpl: ia });
  assert.deepEqual(r, { ok: true, encontrou: false });
  r = await sugerirParaLead(db, { telefone: "123" }, { fetchImpl: ia });
  assert.equal(r.encontrou, false, "telefone curto demais nao busca");

  // 3) lead que nao respondeu: sugestao fixa, a IA nao e chamada
  const antes = chamadas;
  r = await sugerirParaLead(db, { telefone: "84977776666" }, { fetchImpl: ia, agora: Date.parse("2026-11-04T12:00:00Z") });
  assert.equal(chamadas, antes, "nao chama a IA sem mensagem do cliente");
  assert.equal(r.sugestao.status, "mensagem"); assert.equal(r.sugestao.resumo, "O lead ainda não respondeu."); assert.equal(r.sugestao.dias_sem_resposta, 5);

  // 4) status invalido da IA vira null; motivo fora da lista vira ""; tamanhos cortados
  resposta = { status: "fechado_total", resumo: "x".repeat(900), confianca: "certeza" };
  r = await sugerirParaLead(db, { telefone: "84988887777" }, { fetchImpl: ia });
  assert.equal(r.sugestao.status, null); assert.equal(r.sugestao.resumo.length, 400); assert.equal(r.sugestao.confianca, "baixa");
  assert.equal(interpretarSugestao({ status: "desqualificado", motivo: "Inventado" }).motivo, "");
  assert.equal(interpretarSugestao({ status: "desqualificado", motivo: "Sem orçamento" }).motivo, "Sem orçamento");

  // 5) IA fora do ar: erro curto, sem conteudo
  r = await sugerirParaLead(db, { telefone: "84988887777" }, { fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ error: { message: "falhou" } }) }) });
  assert.equal(r.ok, false); assert.ok(r.erro && !r.erro.includes(SEGREDO));
} finally { Object.assign(console, orig); }

// 6) nada da conversa nem o telefone no log
assert.ok(logs.length > 0);
assert.ok(logs.every(l => !l.includes(SEGREDO) && !l.includes("Oi Ana") && !l.includes("88887777")), logs.join("\n"));
console.log("OK: closer le a conversa do lead e sugere (telefone, so Weevo, sem resposta do lead, validacao, sem conteudo no log)");

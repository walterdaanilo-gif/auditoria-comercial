// Mensagens editaveis (Configuracoes > Mensagens): modelo editado com variaveis, padrao sem modelo, desligar
import assert from "node:assert/strict";
import { preencher, textoDe, ativo } from "../src/modelos.js";
import { textoImplementacao } from "../src/alertas.js";
import { textoVendedor } from "../src/followup.js";

assert.equal(preencher("Oi {nome}!\n{extra}\nTchau", { nome: "Nick", extra: "" }), "Oi Nick!\nTchau");
assert.equal(preencher("Valor: {valor}\nfim", { valor: null }), "fim");
assert.equal(preencher("{desconhecida} fica", {}), "{desconhecida} fica");
assert.equal(textoDe(new Map(), "x", {}, () => "padrao"), "padrao");
assert.equal(ativo(new Map([["x", { texto: null, ativo: false }]]), "x"), false);
assert.equal(ativo(new Map(), "x"), true);

const e = { chave: "reuniao_implementacao", titulo: "🤝 *Reunião de implementação marcada*" };
const a = { reuniao: { cliente_nome: "Ana", empresa: "Loja X", data: "2026-11-03", hora: "10:00", modalidade: "online" } };
const padrao = textoImplementacao(e, a, { vendedor: "Walter", funcao: "closer", lead: "Ana", conversaId: "c1" });
assert.match(padrao, /Cliente: Ana · Loja X/);
const modelos = new Map([["reuniao_implementacao", { texto: "{evento}: {cliente} ({empresa_cliente}) com {vendedor} em {quando}\n{link}", ativo: true }]]);
const edit = textoImplementacao(e, a, { vendedor: "Walter", funcao: "closer", lead: "Ana", conversaId: "c1", modelos });
assert.match(edit, /^Reunião de implementação marcada: Ana \(Loja X\) com Walter em ter 03\/11 às 10:00\n👉 .*\/conversas\/c1$/);

const fu = textoVendedor("Nick Silva", [{ nome: "Carla", telefone: "5584911112222", dias: 7, conversaId: "z" }], 6, new Map([["followup_vendedor", { texto: "{nome}, {quantidade} parado(s) há {dias}+ dias:\n{lista}", ativo: true }]]));
assert.match(fu, /^Nick, 1 parado\(s\) há 6\+ dias:\n• Carla/);
import { textoGestao } from "../src/followup.js";
const curto = textoGestao(new Map([["v1", [{ nome: "Carla", dias: 7, conversaId: "z" }, { nome: "Pedro", dias: 9, conversaId: "y" }]]]), new Map([["v1", "Nick Silva"]]), new Map(), 6,
  new Map([["followup_gestao", { texto: "⚠️ *Follow-up atrasado* · {dias}+ dias sem mensagem\n{por_vendedor}\n{link}", ativo: true }]]));
assert.ok(curto.startsWith("⚠️ *Follow-up atrasado* · 6+") && curto.includes("Nick: 2 leads") && curto.split("\n").length === 3, curto);
console.log("OK: mensagens editaveis (variaveis, padrao, desligar)");

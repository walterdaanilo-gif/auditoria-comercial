// Aviso de venda (imersao ou plataforma) no WhatsApp do Bruno. Banco em memoria, envio simulado.
import assert from "node:assert/strict";
const { fakeSupa } = await import("./fakeSupa.js");
const { avisarVenda, textoVenda, produtoDeVenda } = await import("../src/vendaAviso.js");
const { cfg } = await import("../src/config.js");

assert.equal(cfg.avisoVendaTelefone, "5584999518137", "numero do Bruno");
assert.equal(produtoDeVenda("imersao"), true); assert.equal(produtoDeVenda("plataforma"), true);
assert.equal(produtoDeVenda("workshop"), false); assert.equal(produtoDeVenda(undefined), false);

const venda = { produto: "imersao", valor: 12000, cliente: "Ana Souza", empresa: "Clínica Sorriso", indicadoPor: "Carlos Lima", vendedor: "Walter" };
assert.match(textoVenda(venda), /^💎 \*Venda de Imersão\* · R\$\s12\.000,00\nPara quem: Ana Souza · Clínica Sorriso\nQuem indicou: Carlos Lima\nVendedor: Walter$/);
assert.match(textoVenda({ produto: "plataforma", cliente: "Beto", valor: null }), /^🖥️ \*Venda de Plataforma\*\nPara quem: Beto\nQuem indicou: ninguém \/ não informado$/);

const db = fakeSupa(), enviados = [];
const envio = async (_db, inst, numero, texto) => { enviados.push({ inst, numero, texto }); };
await db.insert("audit_settings", [{ id: 1, instancia_envio_id: "inst-1" }]);

let r = await avisarVenda(db, venda, { envio });
assert.deepEqual(r, { ok: true, enviado: true });
assert.equal(enviados.length, 1); assert.equal(enviados[0].numero, "5584999518137"); assert.equal(enviados[0].inst, "inst-1");
assert.match(enviados[0].texto, /Imersão[\s\S]*Ana Souza[\s\S]*Carlos Lima[\s\S]*Walter/);

r = await avisarVenda(db, { ...venda, produto: "workshop" }, { envio });
assert.equal(r.ok, false); assert.equal(enviados.length, 1, "workshop nao gera aviso");

r = await avisarVenda(db, venda, { envio: async () => { throw new Error("caiu"); } });
assert.equal(r.ok, false, "falha no envio e informada (o site tenta de novo)");

await db.update("audit_settings", { id: "eq.1" }, { instancia_envio_id: null });
r = await avisarVenda(db, venda, { envio });
assert.equal(r.ok, false, "sem WhatsApp de envio escolhido");
console.log("vendaAviso: ok");

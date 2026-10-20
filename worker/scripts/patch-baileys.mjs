// Ajuste na biblioteca do WhatsApp (Baileys) aplicado em toda instalacao (postinstall):
// o processamento do historico descarta o historico de chamadas (callLogRecords). Aqui ele passa a ser entregue ao worker
// por um gancho global, junto com o tipo de cada sincronizacao, sem mudar mais nada da biblioteca.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arq = path.join(raiz, "node_modules/@whiskeysockets/baileys/lib/Utils/history.js");
if (!fs.existsSync(arq)) { console.log("[patch-baileys] history.js nao encontrado, nada a fazer"); process.exit(0); }
let s = fs.readFileSync(arq, "utf8");
const MARCA = "/* cabueta: historico de chamadas */";
if (s.includes(MARCA)) { console.log("[patch-baileys] ja aplicado"); process.exit(0); }
const alvo = "export const processHistoryMessage = (item) => {";
if (!s.includes(alvo)) { console.log("[patch-baileys] formato da biblioteca mudou, ajuste nao aplicado"); process.exit(0); }
s = s.replace(alvo, `${alvo}
    ${MARCA}
    try {
        globalThis.__cabuetaHistorico?.(item.syncType, { conversas: item.conversations?.length || 0, chamadas: item.callLogRecords?.length || 0 });
        if (item.callLogRecords?.length) globalThis.__cabuetaChamadas?.(item.callLogRecords, item.syncType);
    } catch (e) { console.error("[patch-baileys]", e?.message); }`);
fs.writeFileSync(arq, s);
console.log("[patch-baileys] historico de chamadas liberado");

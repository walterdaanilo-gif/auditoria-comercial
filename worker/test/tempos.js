import assert from "node:assert/strict";
import { temposResposta } from "../src/auditor.js";

const t = (min) => new Date(Date.UTC(2026, 9, 17, 12, min)).toISOString();
// SDR abre, lead responde em 2 msgs (conta da primeira), SDR responde 5 min depois; lead volta, SDR leva 15 min
const r = temposResposta([
  { remetente: "vendedor", enviada_em: t(0) },
  { remetente: "cliente", enviada_em: t(10) },
  { remetente: "cliente", enviada_em: t(12) },
  { remetente: "vendedor", enviada_em: t(15) },
  { remetente: "cliente", enviada_em: t(20) },
  { remetente: "vendedor", enviada_em: t(35) },
  { remetente: "cliente", enviada_em: t(40) },
]);
assert.deepEqual(r, { primeira_resposta_seg: 300, tempo_medio_resposta_seg: 600, respostas_sdr: 2 });
assert.deepEqual(temposResposta([{ remetente: "cliente", enviada_em: t(1) }]), { primeira_resposta_seg: null, tempo_medio_resposta_seg: null, respostas_sdr: 0 });
console.log("tempos ok");

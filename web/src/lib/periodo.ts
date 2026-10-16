import { fmtData, hojeBR, somaDias } from "@/lib/format";

export type Periodo = { p: string; de: string; ate: string; rotulo: string };
const DATA = /^\d{4}-\d{2}-\d{2}$/;

// Le o periodo da URL: atalhos (hoje, 7, 30) ou datas livres (de, ate). Maximo de 1 ano.
export function lerPeriodo(sp: { p?: string; de?: string; ate?: string }, padrao = "hoje"): Periodo {
  const hoje = hojeBR();
  if (sp.de && sp.ate && DATA.test(sp.de) && DATA.test(sp.ate)) {
    let [de, ate] = sp.de <= sp.ate ? [sp.de, sp.ate] : [sp.ate, sp.de];
    if (ate > hoje) ate = hoje;
    if (de < somaDias(ate, -365)) de = somaDias(ate, -365);
    return { p: "livre", de, ate, rotulo: de === ate ? fmtData(de) : `${fmtData(de)} a ${fmtData(ate)}` };
  }
  const p = ["hoje", "7", "30"].includes(sp.p ?? "") ? (sp.p as string) : padrao;
  const de = somaDias(hoje, p === "30" ? -29 : p === "7" ? -6 : 0);
  return { p, de, ate: hoje, rotulo: p === "30" ? "Últimos 30 dias" : p === "7" ? "Últimos 7 dias" : "Hoje" };
}

export function diasEntre(de: string, ate: string) {
  const out: string[] = [];
  for (let d = de; d <= ate; d = somaDias(d, 1)) out.push(d);
  return out;
}

export const fmtData = (d: string) => d.split("-").reverse().join("/");
export const fmtHora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
export const fmtDataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
export const nota = (n: number | null | undefined) => (n == null ? "—" : Number(n).toFixed(1).replace(".", ","));
export const corNota = (n: number | null | undefined) => (n == null ? "text-mute" : n >= 7 ? "text-ok" : n >= 4 ? "text-warn" : "text-bad");
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + "%" : "—");
export const telefone = (c: string) => "+" + c.split("@")[0].replace(/\D/g, "");
export const hojeBR = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
export const somaDias = (dia: string, n: number) => { const d = new Date(dia + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// Objeto ou lista (o PostgREST devolve um ou outro conforme a relacao)
export const um = <T,>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? x[0] ?? null : x ?? null);
// Tempo de resposta em segundos para texto curto: 45s, 12min, 2h05
export const duracao = (s: number | null | undefined) => {
  if (s == null) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}min`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
};
// Ate 5 min e bom, ate 30 min atencao, acima disso ruim
export const corDuracao = (s: number | null | undefined) => (s == null ? "text-mute" : s <= 300 ? "text-ok" : s <= 1800 ? "text-warn" : "text-bad");

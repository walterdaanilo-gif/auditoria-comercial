// Banco em memoria que imita o que o worker usa do Supabase (PostgREST), para testar sem rede
import crypto from "node:crypto";

const DEFAULTS = {
  mensagens: { espelhada: false, transcricao: null, audio_url: null, texto: null },
  auditorias: { sheet_ok: false, sheet_row: null, conversa_id: null, ligacao_id: null },
  ligacoes: { transcricao: null, audio_url: null },
  analises_time: { texto: null, erro: null, criado_em: () => new Date().toISOString() },
  conversas: { contato_nome: null },
};
const val = v => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? Date.parse(v) : v);
function match(row, filters) {
  return Object.entries(filters).every(([col, f]) => {
    const v = row[col];
    if (f === "is.null") return v == null;
    if (f === "not.is.null") return v != null;
    const [op, ...rest] = f.split("."); const arg = rest.join(".");
    if (op === "eq") return String(v) === arg;
    if (op === "neq") return String(v) !== arg;
    if (op === "like" || (op === "not" && arg.startsWith("like."))) {
      const pat = op === "like" ? arg : arg.slice(5);
      const re = new RegExp("^" + pat.split("*").map(x => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
      return op === "like" ? re.test(String(v ?? "")) : !re.test(String(v ?? ""));
    }
    if (op === "in") return arg.slice(1, -1).split(",").includes(String(v));
    const a = val(v), b = val(arg);
    return op === "lt" ? a < b : op === "lte" ? a <= b : op === "gt" ? a > b : op === "gte" ? a >= b : false;
  });
}

export function fakeSupa() {
  const t = {}, files = new Map();
  const tab = n => (t[n] ||= []);
  const mk = (n, r) => { const d = Object.fromEntries(Object.entries(DEFAULTS[n] || {}).map(([k, v]) => [k, typeof v === "function" ? v() : v])); return { id: crypto.randomUUID(), ...d, ...r }; };
  const api = {
    tables: t, files,
    async select(n, { filters = {}, order, limit, offset = 0, select } = {}) {
      let rows = tab(n).filter(r => match(r, filters));
      if (order) { const [c, dir] = order.split("."); rows = [...rows].sort((a, b) => (val(a[c]) > val(b[c]) ? 1 : -1) * (dir === "desc" ? -1 : 1)); }
      rows = rows.slice(offset, offset + (limit || 1000)).map(r => ({ ...r })); // como o Supabase: no maximo 1000 por consulta
      if (select && select !== "*") { const cols = select.split(","); rows = rows.map(r => Object.fromEntries(cols.map(c => [c, r[c]]))); }
      return rows;
    },
    async selectAll(n, o = {}) {
      const out = [];
      for (let offset = 0; ; offset += 1000) { const p = await api.select(n, { ...o, limit: 1000, offset }); out.push(...p); if (p.length < 1000) return out; }
    },
    async insert(n, rows, { onConflict, ignoreDuplicates } = {}) {
      const out = [];
      for (const r of rows) {
        const keys = onConflict ? onConflict.split(",") : null;
        const ex = keys && tab(n).find(x => keys.every(k => String(x[k]) === String(r[k])));
        if (ex) { if (!ignoreDuplicates) Object.assign(ex, Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined))); out.push({ ...ex }); continue; }
        const row = mk(n, Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined))); tab(n).push(row); out.push({ ...row });
      }
      return out;
    },
    async update(n, filters, patch) { const hit = tab(n).filter(r => match(r, filters)); hit.forEach(r => Object.assign(r, patch)); return hit.map(r => ({ ...r })); },
    async delete(n, filters) { t[n] = tab(n).filter(r => !match(r, filters)); },
    rpcs: {}, // respostas prontas por funcao (ex.: resumo_sdr2) quando o teste precisa
    async rpc(fn, args) {
      if (api.rpcs[fn]) return api.rpcs[fn](args);
      const { p_from, p_to } = args;
      const convs = tab("conversas").filter(c => c.data >= p_from && c.data <= p_to); const out = {};
      for (const c of convs) for (const m of tab("mensagens").filter(m => m.conversa_id === c.id)) {
        const o = (out[m.vendedor_id] ||= { vendedor_id: m.vendedor_id, tratadas: 0, enviadas: 0, recebidas: 0, responderam: 0 });
        if (m.remetente === "vendedor") o.enviadas++; else o.recebidas++;
      }
      return Object.values(out);
    },
    async upload(p, buf) { files.set(p, buf); },
    async download(p) { if (!files.has(p)) throw new Error("arquivo nao existe: " + p); return files.get(p); },
  };
  return api;
}

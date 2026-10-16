import { cfg } from "./config.js";

// Cliente minimo do Supabase (PostgREST + Storage) com a service_role key. Sem dependencias.
// Os filtros usam a sintaxe do PostgREST: { coluna: "eq.valor" }, "is.null", "lt.2026-10-15", "in.(a,b)".
// Chaves novas (sb_secret_/sb_publishable_) nao sao JWT: vao so no apikey. A service_role legada (eyJ...) vai nos dois.
const novaChave = k => k.startsWith("sb_secret_") || k.startsWith("sb_publishable_");
const H = (extra = {}) => ({ apikey: cfg.serviceKey, ...(novaChave(cfg.serviceKey) ? {} : { Authorization: `Bearer ${cfg.serviceKey}` }), ...extra });

async function check(r) {
  if (r.ok) return r;
  throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 300)}`);
}
const qs = (filters = {}, extra = {}) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) u.append(k, v);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) u.append(k, v);
  return u.toString();
};

export const supa = {
  async select(table, { select = "*", filters = {}, order, limit, offset } = {}) {
    const url = `${cfg.supabaseUrl}/rest/v1/${table}?${qs(filters, { select, order, limit, offset })}`;
    return (await check(await fetch(url, { headers: H() }))).json();
  },
  // Le tudo, paginando de 1000 em 1000 (limite padrao do Supabase)
  async selectAll(table, opts = {}) {
    const out = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await supa.select(table, { ...opts, limit: 1000, offset });
      out.push(...page);
      if (page.length < 1000) return out;
    }
  },
  async insert(table, rows, { onConflict, ignoreDuplicates = false, returning = true } = {}) {
    const prefer = [returning ? "return=representation" : "return=minimal", onConflict ? (ignoreDuplicates ? "resolution=ignore-duplicates" : "resolution=merge-duplicates") : ""].filter(Boolean).join(",");
    const url = `${cfg.supabaseUrl}/rest/v1/${table}${onConflict ? `?on_conflict=${onConflict}` : ""}`;
    const r = await check(await fetch(url, { method: "POST", headers: H({ "Content-Type": "application/json", Prefer: prefer }), body: JSON.stringify(rows) }));
    return returning ? r.json() : [];
  },
  async update(table, filters, patch) {
    const url = `${cfg.supabaseUrl}/rest/v1/${table}?${qs(filters)}`;
    return (await check(await fetch(url, { method: "PATCH", headers: H({ "Content-Type": "application/json", Prefer: "return=representation" }), body: JSON.stringify(patch) }))).json();
  },
  async delete(table, filters) {
    await check(await fetch(`${cfg.supabaseUrl}/rest/v1/${table}?${qs(filters)}`, { method: "DELETE", headers: H() }));
  },
  async rpc(fn, args) {
    return (await check(await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/${fn}`, { method: "POST", headers: H({ "Content-Type": "application/json" }), body: JSON.stringify(args) }))).json();
  },
  async upload(path, buffer, contentType = "application/octet-stream") {
    await check(await fetch(`${cfg.supabaseUrl}/storage/v1/object/audios/${path}`, { method: "POST", headers: H({ "Content-Type": contentType, "x-upsert": "true" }), body: buffer }));
  },
  async download(path) {
    const r = await check(await fetch(`${cfg.supabaseUrl}/storage/v1/object/audios/${path}`, { headers: H() }));
    return Buffer.from(await r.arrayBuffer());
  },
};

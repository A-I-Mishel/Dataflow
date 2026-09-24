// FILE: frontend-sieve/api.js
// PURPOSE: Bridge between browser (local engine) and FastAPI backend.
//   Local engine is ALWAYS the display truth; backend is background verify only.
// HOW IT FITS: app.js calls getApiBase() -> apiUpload/apiExecute -> toast if mismatch.
//   Never blocks local results (backend returns only 5-row previews).
//
// ★ EXAM MAP — teacher says "change X" -> go HERE:
// - Change backend URL / local-only ... getApiBase(), setApiBase() below
//   (precedence: ?api= param > localStorage button > window.SIEVE_API_URL > '').
// - Change timeout / retry .......... req(), reqOnce() (30s default, 1 retry on 429).
// - Add new operation mapping ....... sieveToBackend() (~30-branch translator).
// - Change session handling ......... getSessionId()/setSessionId() (scoped per base).
// SAFE TO EDIT: base URL strings, timeout numbers. DO NOT change fetch shape
//   without updating backend/main.py route too.
// Sieve ↔ FastAPI bridge (hybrid mode).
//
// Local engine stays the source of truth for display: uploads parse locally
// for instant preview, runs execute locally. When a backend URL is
// configured, the same file is also POSTed to /upload (background, to mint a
// session_id) and every local run additionally fires POST /execute in the
// background. Backend mismatches surface as toasts — they never block or
// replace local results.
//
// Why background-only: the backend returns 5-row previews (never full
// frames), so promoting it to source-of-truth would need a /download reparse
// per run. That is the follow-up; this module proves the wiring end to end.
//
// Node schemas differ (sieve `fill-missing` vs backend `fill-na`, unicode
// ops `≠ ≥ ≤` vs `!= >= <=`, ...). Pipelines containing ops with no exact
// backend equivalent are reported as local-only and skip the remote check
// instead of comparing against a silently different semantic.

const LS_API = 'sieve.apiBase';
const LS_SES = 'sieve.sessionId';

export function getApiBase() {
  // Precedence: explicit ?api= param (SESSION-ONLY, never persisted: a
  // shared link must not permanently redirect a victim's uploads) > stored
  // button choice ('' = explicitly local-only) > baked window.SIEVE_API_URL
  // from config.js (production default) > '' (local-only).
  try {
    const q = new URLSearchParams(location.search).get('api');
    if (q !== null) return normalizeBase(q);
  } catch (_) {}
  try {
    const stored = localStorage.getItem(LS_API);
    if (stored !== null) return normalizeBase(stored);
  } catch (_) {}
  try {
    const baked = typeof window.SIEVE_API_URL === 'string' ? normalizeBase(window.SIEVE_API_URL) : '';
    if (baked) return baked;
  } catch (_) {}
  return '';
}

// Where the current base came from (for transparency UI). Mirrors
// getApiBase precedence without duplicating its normalization.
export function getApiSource() {
  try {
    if (new URLSearchParams(location.search).get('api') !== null) return 'param';
  } catch (_) {}
  try {
    if (localStorage.getItem(LS_API) !== null) return 'stored';
  } catch (_) {}
  try {
    if (typeof window.SIEVE_API_URL === 'string' && normalizeBase(window.SIEVE_API_URL)) return 'baked';
  } catch (_) {}
  return '';
}

export function setApiBase(url) {
  const raw = String(url || '').trim();
  // Reject-don't-blank: a typo like "localhost:8000" must warn, not silently
  // store '' and permanently override the baked default with local-only.
  if (raw !== '' && !/^https?:\/\//i.test(raw)) throw new Error('URL must start with http:// or https://');
  const v = normalizeBase(url);
  try {
    // Store even when empty: explicit local-only must beat the baked default.
    // Sessions stay scoped per-base (see getSessionId), so no clearing here.
    localStorage.setItem(LS_API, v);
  } catch (_) {}
  return v;
}

function normalizeBase(u) {
  const s = String(u || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) return '';
  return s;
}

function numIfNumeric(v) {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (t === '') return v;
  const n = Number(t);
  return Number.isFinite(n) ? n : v;
}

async function reqOnce(path, base, opts, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(base + path, { ...opts, signal: ctl.signal });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error(`backend timed out on ${path}`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function req(path, base, opts = {}, timeoutMs = 30000) {
  let r = await reqOnce(path, base, opts, timeoutMs);
  // Honor the server's Retry-After once (uploads/executes are safe to
  // repeat: uploads mint a fresh session, executes are idempotent).
  if (r.status === 429) {
    let wait = parseInt(r.headers.get('Retry-After') || '5', 10);
    if (!Number.isFinite(wait) || wait < 0) wait = 5;
    await new Promise((res) => setTimeout(res, Math.min(wait, 30) * 1000));
    r = await reqOnce(path, base, opts, timeoutMs);
    if (r.status === 429) throw new Error(`backend rate limit exceeded on ${path} — try again shortly`);
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(body.detail || `backend ${r.status} on ${path}`);
    err.status = r.status;
    throw err;
  }
  return body;
}

// WHAT: GET /health once. INPUT: base URL, timeoutMs. OUTPUT: {status}. ★ EXAM: change 8000 timeout only.
export const apiHealth = (base, timeoutMs = 8000) =>
  req('/health', base, {}, timeoutMs);

// WHAT: Retry health for sleeping free-tier backend (8s→20s→60s, ~90s total).
// ★ EXAM: change timeouts array above to retry faster/slower. Returns true/false, never throws.
export async function apiHealthRetry(base, onAttempt) {
  const timeouts = [8000, 20000, 60000];
  for (let i = 0; i < timeouts.length; i++) {
    try {
      if (onAttempt) onAttempt(i + 1, timeouts.length);
      await apiHealth(base, timeouts[i]);
      return true;
    } catch (_) {
      if (i < timeouts.length - 1) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  return false;
}

export async function apiUpload(base, file) {
  // WHAT: Sends CSV to backend POST /upload to mint session_id (background only).
  // ★ EXAM: timeout 120000ms below = 2 min for big files. Change number only.
  const fd = new FormData();
  fd.append('file', file, file.name || 'upload.csv');
  const body = await req('/upload', base, { method: 'POST', body: fd }, 120000);
  try { setSessionId(base, body.session_id); } catch (_) {}
  return body;
}

// Sessions are scoped per backend base: a sid minted by one host must never
// be sent to another (stale ?api= links previously caused 404s). Stored as
// a {base: sid} map; legacy single-string values are ignored (fresh upload
// mints a scoped one).
function readSessionMap() {
  try {
    const raw = localStorage.getItem(LS_SES);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return {};
  } catch (_) { return {}; }
}

// WHAT: Read session id for THIS backend base only (never cross-send).
// ★ EXAM: rarely edit. Returns '' when local-only.
export function getSessionId(base) {
  try {
    if (!base) {
      // Back-compat for callers without a base: only honour legacy plain
      // strings, never a map entry (avoids cross-base leakage).
      const raw = localStorage.getItem(LS_SES);
      if (raw && !raw.trim().startsWith('{')) return raw;
      return '';
    }
    return readSessionMap()[base] || '';
  } catch (_) { return ''; }
}

export function setSessionId(base, sid) {
  if (!base) return;
  const map = readSessionMap();
  if (sid) map[base] = sid;
  else delete map[base];
  try { localStorage.setItem(LS_SES, JSON.stringify(map)); } catch (_) {}
}

// WHAT: Forget session for this base (e.g. on disconnect). ★ EXAM: rarely edit.
export function clearSessionId(base) {
  if (!base) return;
  try {
    const map = readSessionMap();
    delete map[base];
    localStorage.setItem(LS_SES, JSON.stringify(map));
  } catch (_) {}
}

// WHAT: POST /profile for server histograms/stats (lazy; local panel works without it).
// ★ EXAM: change 60000 timeout only. Needs session_id from apiUpload().
export function apiProfile(base, sessionId) {
  return req('/profile', base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  }, 60000);
}

/* ---------- shared pipeline templates (server) ---------- */
// WHAT: Saved step templates (nodes+edges, never datasets). All need backend; local-only callers skip.
// ★ EXAM: change 15000/30000 timeouts only. To save extra field, add to JSON.stringify below AND backend models.

/* WHAT: List saved templates. ★ EXAM: rarely edit. */
export const apiListPipelines = (base) => req('/pipelines', base, {}, 15000);

export function apiSavePipeline(base, name, nodes) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('name the template');
  if (!nodes.length) throw new Error('nothing to save — the pipeline is empty');
  return req('/pipelines/save', base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: clean, nodes, edges: linearEdges(nodes) }),
  }, 30000);
}

export const apiLoadPipeline = (base, id) =>
  req(`/pipelines/${encodeURIComponent(id)}`, base, {}, 15000);

export function apiDeletePipeline(base, id) {
  return req(`/pipelines/${encodeURIComponent(id)}`, base, { method: 'DELETE' }, 15000);
}

// WHAT: Linear chain edges n1->n2->... derived from node order (templates stay minimal).
// ★ EXAM: rarely edit. Saved nodes omit id so we synthesize stable n1.. ids.
export function linearEdges(nodes) {
  const ids = (nodes || []).map((n, i) => (n && n.id) || `n${i + 1}`);
  return ids.slice(1).map((id, k) => ({ source: ids[k], target: id }));
}

/* ---------- sieve → backend node translation ---------- */
// ★ EXAM: ADD/CHANGE OPERATION MAPPING HERE — if teacher says "support new op
//   on backend", copy one if-block inside sieveToBackend() below. Pattern:
//   if (t === 'my-op') { nodes.push({ id: id(), type: 'backend-name', config: {...} }); continue; }

const FILTER_OP = { '=': '==', '≠': '!=', '>': '>', '<': '<', '≥': '>=', '≤': '<=', contains: 'contains' };

// Ops with no exact backend equivalent (different semantics, not just names):
// · drop-duplicates/keep-last — backend always keeps first (ignores keep)
// · standardize — writes a NEW column (col_z); backend normalize rewrites in place
// · clean-text / convert-type / remove-outliers — no backend transform at all
const LOCAL_ONLY = {
  'remove-outliers': 'no backend transform',
  'clean-text': 'no backend transform',
  // convert-type to number/text: no backend cast op (to=date maps to parse-date above).
  'convert-type': 'no backend transform',
  'standardize': 'backend normalizes in place, Sieve writes a new column',
};

export function sieveToBackend(sieveNodes) {
  const nodes = [];
  const skipped = [];
  let i = 0;
  for (const n of sieveNodes) {
    if (!n || n.enabled === false) continue; // bypassed steps stay bypassed remotely too
    const p = n.params || {};
    const t = n.type;
    const id = () => `n${++i}`;
    const need = (cond, why) => { if (!cond) skipped.push({ type: t, reason: why }); return !!cond; };

    if (t === 'fill-missing') {
      if (!need(p.column, 'no column selected')) continue;
      if (p.method === 'mean' || p.method === 'median' || p.method === 'mode') {
        nodes.push({ id: id(), type: 'fill-na', config: { columns: [p.column], strategy: p.method } });
      } else if (p.method === 'custom') {
        if (!need(p.value !== '', 'empty fill value')) continue;
        nodes.push({ id: id(), type: 'fill-na', config: { columns: [p.column], strategy: 'constant', value: numIfNumeric(p.value) } });
      } else if (p.method === 'ffill' || p.method === 'bfill') {
        const cfg = { columns: [p.column], strategy: p.method };
        if (p.limit !== '' && p.limit != null) {
          if (!/^\d+$/.test(String(p.limit).trim())) { skipped.push({ type: t, reason: 'invalid fill limit' }); continue; }
          cfg.limit = parseInt(p.limit, 10);
        }
        nodes.push({ id: id(), type: 'fill-na', config: cfg });
      } else {
        skipped.push({ type: t, reason: `fill method "${p.method}" has no backend equivalent` });
      }
    } else if (t === 'drop-missing') {
      const how = (p.match || 'any') === 'all' ? 'all' : 'any';
      if (!p.column || p.column === '__all__') nodes.push({ id: id(), type: 'drop-na', config: how === 'any' ? {} : { how } });
      else nodes.push({ id: id(), type: 'drop-na', config: { columns: [p.column], how } });
    } else if (t === 'drop-duplicates') {
      if (p.keep && p.keep !== 'first') { skipped.push({ type: t, reason: 'backend always keeps first' }); continue; }
      nodes.push({ id: id(), type: 'drop-duplicates', config: {} });
    } else if (t === 'filter-rows') {
      if (!need(p.column, 'no column selected') || !need(p.value !== '', 'empty comparison value')) continue;
      const op = FILTER_OP[p.op];
      if (!op) { skipped.push({ type: t, reason: `operator "${p.op}" unsupported by backend` }); continue; }
      nodes.push({ id: id(), type: 'filter-rows', config: { conditions: [{ column: p.column, operator: op, value: numIfNumeric(p.value) }] } });
    } else if (t === 'sort-rows') {
      if (!need(p.column, 'no column selected')) continue;
      nodes.push({ id: id(), type: 'sort', config: { by: [p.column], ascending: p.dir !== 'desc' } });
    } else if (t === 'drop-columns') {
      if (!need(p.columns && p.columns.length, 'no columns ticked')) continue;
      nodes.push({ id: id(), type: 'drop-column', config: { columns: [...p.columns] } });
    } else if (t === 'rename-columns') {
      const entries = Object.entries(p.map || {}).filter(([, v]) => v !== '' && v != null);
      if (!need(entries.length, 'no renames typed')) continue;
      nodes.push({ id: id(), type: 'rename-column', config: { mapping: Object.fromEntries(entries) } });
    } else if (t === 'one-hot') {
      if (!need(p.column, 'no column selected')) continue;
      nodes.push({ id: id(), type: 'encode-categorical', config: { method: 'one-hot', columns: [p.column] } });
    } else if (t === 'round-values') {
      if (!need(p.columns && p.columns.length, 'no columns ticked')) continue;
      if (!/^\d+$/.test(String(p.decimals ?? '').trim())) { skipped.push({ type: t, reason: 'invalid decimals' }); continue; }
      nodes.push({ id: id(), type: 'round-values', config: { columns: [...p.columns], decimals: parseInt(p.decimals, 10) } });
    } else if (t === 'reorder-columns') {
      const order = (p.order || []).filter((x) => x !== '');
      if (!need(order.length, 'empty column order')) continue;
      nodes.push({ id: id(), type: 'reorder-columns', config: { columns: order } });
    } else if (t === 'drop-empty-columns') {
      nodes.push({ id: id(), type: 'drop-empty-columns', config: {} });
    } else if (t === 'replace-values') {
      if (!need(p.columns && p.columns.length, 'no columns ticked')) continue;
      // The local engine rejects a blank find (mirroring filter-rows), so
      // there is nothing meaningful to verify remotely — skip, don't guess.
      if (!need(p.find !== '' && p.find != null, 'empty find value')) continue;
      nodes.push({
        id: id(),
        type: 'replace-values',
        // Numeric coercion must match filter-rows: the backend compares
        // against typed frames while Sieve parses CSV text, so '30' ships
        // as 30 exactly when it looks numeric on both sides.
        config: { columns: [...p.columns], find: numIfNumeric(p.find), replacement: p.replacement ?? null, case_sensitive: p.case !== false },
      });
    } else if (t === 'split-column') {
      if (!need(p.column, 'no column selected')) continue;
      if (!need(p.delimiter, 'empty delimiter')) continue;
      const cfg = { columns: [p.column], delimiter: String(p.delimiter) };
      if (p.max_splits !== '' && p.max_splits != null) {
        if (!/^\d+$/.test(String(p.max_splits).trim())) { skipped.push({ type: t, reason: 'invalid max splits' }); continue; }
        cfg.max_splits = parseInt(p.max_splits, 10);
      }
      cfg.keep_original = p.keep !== false;
      nodes.push({ id: id(), type: 'split-column', config: cfg });
    } else if (t === 'merge-columns') {
      if (!need(p.columns && p.columns.length >= 2, 'fewer than two columns')) continue;
      if (!need(p.output && String(p.output).trim(), 'blank output name')) continue;
      nodes.push({
        id: id(),
        type: 'merge-columns',
        config: {
          columns: [...p.columns],
          output: String(p.output).trim(),
          separator: p.separator == null ? ' ' : String(p.separator),
          keep_original: p.keep !== false,
        },
      });
    } else if (t === 'extract-text') {
      if (!need(p.column, 'no column selected')) continue;
      if (!need(p.output && String(p.output).trim(), 'blank output name')) continue;
      const cfg = { columns: [p.column], method: p.mode, output: String(p.output).trim() };
      const needInt = (v, what, min) => {
        if (!/^\d+$/.test(String(v ?? '').trim()) || parseInt(v, 10) < min) {
          skipped.push({ type: t, reason: `invalid ${what}` });
          return null;
        }
        return parseInt(v, 10);
      };
      if (['prefix', 'suffix'].includes(p.mode)) {
        const n = needInt(p.length, 'length', 1);
        if (n === null) continue;
        cfg.length = n;
      } else if (p.mode === 'substring') {
        const st = needInt(p.start, 'start', 0);
        if (st === null) continue;
        cfg.start = st;
        if (p.end !== '' && p.end != null) {
          const en = needInt(p.end, 'end', st);
          if (en === null) continue;
          cfg.end = en;
        }
      } else if (['before', 'after'].includes(p.mode)) {
        if (!need(p.delim, 'empty delimiter')) continue;
        cfg.delimiter = String(p.delim);
      } else if (p.mode === 'between') {
        if (!need(p.delim && p.delim2, 'empty delimiter')) continue;
        cfg.delimiter = String(p.delim);
        cfg.delimiter2 = String(p.delim2);
      } else if (p.mode === 'regex') {
        if (!need(p.pattern, 'empty pattern')) continue;
        cfg.pattern = String(p.pattern);
      } else {
        skipped.push({ type: t, reason: `unknown mode "${p.mode}"` });
        continue;
      }
      nodes.push({ id: id(), type: 'extract-text', config: cfg });
    } else if (t === 'group-rare') {
      if (!need(p.column, 'no column selected')) continue;
      if (!need(p.replacement && String(p.replacement).trim(), 'blank replacement label')) continue;
      nodes.push({
        id: id(),
        type: 'group-rare',
        config: { columns: [p.column], threshold: String(p.min_count ?? '10'), replacement: String(p.replacement).trim() },
      });
    } else if (t === 'label-encode') {
      if (!need(p.column, 'no column selected')) continue;
      nodes.push({ id: id(), type: 'encode-categorical', config: { method: 'label', columns: [p.column] } });
    } else if (t === 'normalize') {
      if (!need(p.column, 'no column selected')) continue;
      const method = p.method === 'z' ? 'z-score' : p.method === 'minmax' ? 'min-max' : null;
      if (!method) { skipped.push({ type: t, reason: `unknown method "${p.method}"` }); continue; }
      nodes.push({ id: id(), type: 'normalize', config: { columns: [p.column], method } });
    } else if (t === 'convert-type' && p.to === 'date') {
      if (!need(p.column, 'no column selected')) continue;
      nodes.push({ id: id(), type: 'parse-date', config: { columns: [p.column], format: 'auto' } });
    } else if (t === 'extract-date-part') {
      if (!need(p.column, 'no column selected')) continue;
      if (!need(p.output && String(p.output).trim(), 'blank output name')) continue;
      nodes.push({
        id: id(),
        type: 'extract-date-part',
        config: { columns: [p.column], part: p.part, output: String(p.output).trim() },
      });
    } else if (t === 'date-difference') {
      if (!need(p.start && p.end, 'missing date column')) continue;
      if (!need(p.output && String(p.output).trim(), 'blank output name')) continue;
      nodes.push({
        id: id(),
        type: 'date-difference',
        config: { columns: [p.start, p.end], unit: p.unit, output: String(p.output).trim() },
      });
    } else if (t === 'create-column') {
      if (!need(p.output && String(p.output).trim(), 'blank output name')) continue;
      if (!need(p.formula && String(p.formula).trim(), 'blank formula')) continue;
      // Column refs feed the generator's dummy frame; the backend parses
      // and validates the formula itself (unknown columns → 400 there).
      const refs = [...String(p.formula).matchAll(/\[([^\]]+)\]/g)]
        .map((m) => m[1].trim())
        .filter((c, i, a) => c && a.indexOf(c) === i);
      nodes.push({
        id: id(),
        type: 'create-column',
        config: { formula: String(p.formula), output: String(p.output).trim(), columns: refs },
      });
    } else if (t === 'conditional-column') {
      if (!need(p.output && String(p.output).trim(), 'blank output name')) continue;
      if (!need(p.rules && p.rules.length, 'no rules')) continue;
      const rules = [];
      let bad = null;
      for (const [i, r] of (p.rules || []).entries()) {
        if (!r.column) { bad = `rule ${i + 1} has no column`; break; }
        const op = FILTER_OP[r.op];
        if (!op) { bad = `rule ${i + 1} has unknown operator "${r.op}"`; break; }
        rules.push({ column: r.column, operator: op, value: numIfNumeric(r.value), result: r.result ?? null });
      }
      if (bad) { skipped.push({ type: t, reason: bad }); continue; }
      nodes.push({
        id: id(),
        type: 'conditional-column',
        config: {
          columns: [...new Set(rules.map((r) => r.column))],
          rules,
          default: p.default === '' || p.default == null ? null : p.default,
        },
      });
    } else if (t === 'validate-column') {
      if (!need(p.column, 'no column selected')) continue;
      // Same flat→list shape the local engine evaluates, so both sides
      // always check the identical rule set.
      const checks = [];
      if (p.vtype && p.vtype !== 'any') checks.push({ rule: 'type', expected: p.vtype });
      if (p.required) checks.push({ rule: 'required' });
      if (p.min !== '' && p.min != null) checks.push({ rule: 'min', value: p.min });
      if (p.max !== '' && p.max != null) checks.push({ rule: 'max', value: p.max });
      if (p.allowed && p.allowed.length) checks.push({ rule: 'allowed', values: [...p.allowed] });
      if (p.unique) checks.push({ rule: 'unique' });
      if (p.pattern) checks.push({ rule: 'pattern', pattern: p.pattern });
      if (!need(checks.length, 'no checks enabled')) continue;
      nodes.push({ id: id(), type: 'validate-column', config: { columns: [p.column], checks } });
    } else if (t === 'find-invalid') {
      if (!need(p.column, 'no column selected')) continue;
      const expect = p.expect || 'number';
      if (!['number', 'text', 'date'].includes(expect)) { skipped.push({ type: t, reason: `unknown expectation "${p.expect}"` }); continue; }
      if (expect !== 'number' && ((p.min !== '' && p.min != null) || (p.max !== '' && p.max != null))) {
        skipped.push({ type: t, reason: 'bounds need numeric expectation' });
        continue;
      }
      const cfg = { columns: [p.column], expect };
      if (p.min !== '' && p.min != null) cfg.min_value = p.min;
      if (p.max !== '' && p.max != null) cfg.max_value = p.max;
      nodes.push({ id: id(), type: 'find-invalid', config: cfg });
    } else if (t === 'clip-values') {
      if (!need(p.columns && p.columns.length, 'no columns ticked')) continue;
      const cfg = { columns: [...p.columns] };
      if (p.min !== '' && p.min != null) cfg.min_value = p.min;
      if (p.max !== '' && p.max != null) cfg.max_value = p.max;
      if (cfg.min_value === undefined && cfg.max_value === undefined) {
        skipped.push({ type: t, reason: 'no bounds set' });
        continue;
      }
      nodes.push({ id: id(), type: 'clip-values', config: cfg });
    } else if (t === 'find-replace-pattern') {
      if (!need(p.columns && p.columns.length, 'no columns ticked')) continue;
      if (!need(p.pattern, 'empty pattern')) continue;
      if (String(p.pattern).length > 200) { skipped.push({ type: t, reason: 'pattern too long' }); continue; }
      nodes.push({
        id: id(),
        type: 'find-replace-pattern',
        config: {
          columns: [...p.columns],
          pattern: String(p.pattern),
          replacement: p.replacement == null ? '' : String(p.replacement),
          use_regex: p.regex !== false,
          case_sensitive: p.case !== false,
        },
      });
    } else if (t === 'remove-special-chars') {
      if (!need(p.columns && p.columns.length, 'no columns ticked')) continue;
      if (!p.letters && !p.numbers && !p.spaces && !p.custom) {
        skipped.push({ type: t, reason: 'nothing kept' });
        continue;
      }
      nodes.push({
        id: id(),
        type: 'remove-special-chars',
        config: {
          columns: [...p.columns],
          letters: p.letters !== false,
          numbers: p.numbers !== false,
          spaces: p.spaces !== false,
          custom_chars: p.custom == null ? '' : String(p.custom),
        },
      });
    } else if (t === 'log-transform') {
      if (!need(p.columns && p.columns.length, 'no columns ticked')) continue;
      if (!['ln', 'log10', 'log2'].includes(p.base)) {
        skipped.push({ type: t, reason: `unknown base "${p.base}"` });
        continue;
      }
      nodes.push({
        id: id(),
        type: 'log-transform',
        config: { columns: [...p.columns], method: p.base, on_invalid: p.invalid === 'error' ? 'error' : 'null' },
      });
    } else if (LOCAL_ONLY[t]) {
      skipped.push({ type: t, reason: LOCAL_ONLY[t] });
    } else {
      skipped.push({ type: t, reason: 'unknown op' });
    }
  }
  const edges = nodes.slice(1).map((n, k) => ({ source: nodes[k].id, target: n.id }));
  return { nodes, edges, skipped };
}

export async function apiExecute(base, sessionId, sieveNodes) {
  const { nodes, edges, skipped } = sieveToBackend(sieveNodes);
  if (skipped.length) return { skipped, ran: false };
  const body = await req('/execute', base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, nodes, edges }),
  }, 120000);
  return { ran: true, skipped, backend: body };
}

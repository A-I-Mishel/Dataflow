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
  // Precedence: explicit ?api= param (persisted) > stored button choice
  // ('' = explicitly local-only) > baked window.SIEVE_API_URL from
  // config.js (production default) > '' (local-only).
  try {
    const q = new URLSearchParams(location.search).get('api');
    if (q !== null) {
      const v = normalizeBase(q);
      try { localStorage.setItem(LS_API, v); } catch (_) {}
      return v;
    }
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

export function setApiBase(url) {
  const v = normalizeBase(url);
  try {
    // Store even when empty: explicit local-only must beat the baked default.
    localStorage.setItem(LS_API, v);
    localStorage.removeItem(LS_SES);
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

async function req(path, base, opts = {}, timeoutMs = 30000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(base + path, { ...opts, signal: ctl.signal });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.detail || `backend ${r.status} on ${path}`);
    return body;
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error(`backend timed out on ${path}`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export const apiHealth = (base, timeoutMs = 8000) =>
  req('/health', base, {}, timeoutMs);

// Wake-tolerant check for free-tier hosting (sleeps after ~15 min idle,
// first request takes ~50s). Attempts lengthen to ride out a cold start;
// total worst case ~90s. Resolves true on first success, false otherwise.
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
  const fd = new FormData();
  fd.append('file', file, file.name || 'upload.csv');
  const body = await req('/upload', base, { method: 'POST', body: fd }, 120000);
  try { localStorage.setItem(LS_SES, body.session_id); } catch (_) {}
  return body;
}

export function getSessionId() {
  try { return localStorage.getItem(LS_SES) || ''; } catch (_) { return ''; }
}

/* ---------- sieve → backend node translation ---------- */

const FILTER_OP = { '=': '==', '≠': '!=', '>': '>', '<': '<', '≥': '>=', '≤': '<=', contains: 'contains' };

// Ops with no exact backend equivalent (different semantics, not just names):
// · fill-missing/ffill — backend fill-na has no ffill strategy
// · drop-duplicates/keep-last — backend always keeps first (ignores keep)
// · standardize — writes a NEW column (col_z); backend normalize rewrites in place
// · clean-text / convert-type / remove-outliers — no backend transform at all
const LOCAL_ONLY = {
  'remove-outliers': 'no backend transform',
  'clean-text': 'no backend transform',
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
      } else {
        skipped.push({ type: t, reason: `fill method "${p.method}" has no backend equivalent` });
      }
    } else if (t === 'drop-missing') {
      if (!p.column || p.column === '__all__') nodes.push({ id: id(), type: 'drop-na', config: {} });
      else nodes.push({ id: id(), type: 'drop-na', config: { columns: [p.column] } });
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

import { EngineFactory, py } from './engine.js';
import { getApiBase, setApiBase, apiHealthRetry, apiUpload, apiExecute, getSessionId } from './api.js';

'use strict';
/* ==================================================================
   Sieve 2.0 — production build.
   Architecture:
   · EngineFactory() — pure, self-contained engine (parser, ops, runner,
     stats). Instantiated on the main thread AND inside a Web Worker
     built from the same source, so heavy data never blocks the UI.
   · Rows are arrays (index-aligned to `columns`) — immune to prototype
     pollution, cheaper to clone, faster to scan.
   · Pipeline runs are memoised: editing step k recomputes only from k.
   · Undo/redo history, localStorage pipeline autosave, IndexedDB
     dataset autosave, CSV formula-injection guard, a11y pass,
     self-test suite (Sieve.runSelfTests()).
   ================================================================== */

/* ---------- tiny helpers ---------- */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const wait  = ms => new Promise(r => setTimeout(r, ms));
const fmt   = n => Number(n).toLocaleString('en-US');
const fmtBytes = b => b > 1048576 ? (b/1048576).toFixed(1)+' MB' : b > 1024 ? Math.round(b/1024)+' KB' : b+' B';
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function elDiv(cls, html){ const d = document.createElement('div'); d.className = cls; if (html != null) d.innerHTML = html; return d; }
function debounce(fn, ms){ let t; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; f.cancel = () => clearTimeout(t); return f; }
const RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)');

/* ---------- inline icon set ---------- */
const IC = {
  plus:'<path d="M12 5.5v13M5.5 12h13"/>',
  x:'<path d="M17 7 7 17M7 7l10 10"/>',
  play:'<path d="M7.5 4.5v15L20 12Z" fill="currentColor" stroke="none"/>',
  check:'<path d="m5 12.5 4.5 4.5L19.5 7"/>',
  trash:'<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13.5h9l1-13.5M10 11v6M14 11v6"/>',
  copy:'<rect x="9.5" y="9.5" width="11" height="11" rx="2"/><path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/>',
  download:'<path d="M12 3.5V15M7.5 10.5 12 15l4.5-4.5M4 20.5h16"/>',
  upload:'<path d="M12 15.5V4M7.5 8.5 12 4l4.5 4.5M4 20.5h16"/>',
  code:'<path d="m8.5 7.5-5 4.5 5 4.5M15.5 7.5l5 4.5-5 4.5"/>',
  eye:'<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  filter:'<path d="M3.5 5h17l-6.7 8v6.5l-3.6-2V13Z"/>',
  sort:'<path d="M4 6h8M4 12h5.5M4 18h3M17 4v15m0 0-4-4m4 4 4-4"/>',
  type:'<path d="M5.5 7V4.5h13V7M12 4.5v15M9 19.5h6"/>',
  sparkle:'<path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7-5.6-1.9L10.1 9Z"/><path d="m18.8 15.8.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z"/>',
  droplet:'<path d="M12 3.5s6 6.3 6 10a6 6 0 1 1-12 0c0-3.7 6-10 6-10Z"/>',
  layers:'<path d="m12 3.5 8.5 4.7L12 12.9 3.5 8.2Z"/><path d="m4.6 12.6 7.4 4.1 7.4-4.1M4.6 16.6 12 20.7l7.4-4.1"/>',
  scissors:'<circle cx="6" cy="6" r="2.7"/><circle cx="6" cy="18" r="2.7"/><path d="M8.3 7.6 20 17.5M8.3 16.4 20 6.5"/>',
  sigma:'<path d="M17.5 5.5V4H6.2l6.3 8-6.3 8h11.3v-1.5"/>',
  ban:'<circle cx="12" cy="12" r="8.6"/><path d="m6.3 6.3 11.4 11.4"/>',
  columns:'<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M9.2 4.5v15M14.9 4.5v15"/>',
  table:'<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M3.5 10h17M10 10v9.5"/>',
  db:'<ellipse cx="12" cy="5.5" rx="8" ry="2.8"/><path d="M4 5.5v13c0 1.6 3.6 2.8 8 2.8s8-1.2 8-2.8v-13M4 12c0 1.6 3.6 2.8 8 2.8s8-1.2 8-2.8"/>',
  file:'<path d="M6 3.5h7.5L19 9v11.5H6Z"/><path d="M13.5 3.5V9H19"/>',
  alert:'<path d="M12 3.8 22 20.2H2Z"/><path d="M12 10v4.2M12 17.3v.1"/>',
  info:'<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.5M12 7.6v.1"/>',
  chevdown:'<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
  chevup:'<path d="m6.5 14.5 5.5-5.5 5.5 5.5"/>',
  chevleft:'<path d="M14.5 6 8.5 12l6 6"/>',
  chevright:'<path d="m9.5 6 6 6-6 6"/>',
  zin:'<circle cx="11" cy="11" r="6.8"/><path d="M20.5 20.5 16 16M8.3 11h5.4M11 8.3v5.4"/>',
  zout:'<circle cx="11" cy="11" r="6.8"/><path d="M20.5 20.5 16 16M8.3 11h5.4"/>',
  fit:'<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>',
  grid:'<rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/>',
  arrowr:'<path d="M4 12h15m0 0-5-5m5 5-5 5"/>',
  undo:'<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo:'<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  lock:'<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  save:'<path d="M5 4h11l3 3v13H5Z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  question:'<circle cx="12" cy="12" r="8.6"/><path d="M9.6 9.2A2.5 2.5 0 0 1 14.5 10c0 1.6-2.4 2-2.4 3.4M12 16.6v.1"/>'
};
function ic(n, s=15){ return `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${IC[n]||''}</svg>`; }

/* ---------- toasts ---------- */
function toast(msg, icon='check'){
  const t = elDiv('toast', ic(icon,14) + `<span>${esc(msg)}</span>`);
  $('#toasts').append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 260); }, 2600);
}

const E = EngineFactory();

/* ---------- Web Worker built from the same engine source ---------- */
function workerMain(){
  const E = EngineFactory();
  self.onmessage = async ev => {
    const m = ev.data;
    try {
      let out;
      if (m.type === 'run')        out = { res: E.runFrom(m.base, m.nodes) };
      else if (m.type === 'meta')  out = { res: E.metaOf(m.data.columns, m.data.rows, true) };
      else if (m.type === 'parseText') out = { res: E.parseCSVText(m.text) };
      else if (m.type === 'parseFile'){
        const buf = await m.file.arrayBuffer();
        const dec = E.decodeBytes(buf);
        out = { res: E.parseCSVText(dec.text), encoding: dec.encoding };
      }
      else throw new Error('unknown message');
      self.postMessage({ id: m.id, ok: true, ...out });
    } catch(err){
      self.postMessage({ id: m.id, ok: false, error: String((err && err.message) || err) });
    }
  };
}

const Jobs = { map: new Map(), seq: 1 };
let worker = null, workerOK = false;
(function initWorker(){
  try {
    const src = EngineFactory.toString() + '\n' + workerMain.toString() + '\nworkerMain();';
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    worker = new Worker(url);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    worker.onmessage = e => {
      const j = Jobs.map.get(e.data.id);
      if (j){ Jobs.map.delete(e.data.id); e.data.ok ? j.res(e.data) : j.rej(new Error(e.data.error)); }
    };
    worker.onerror = () => {
      for (const [, j] of Jobs.map) j.rej(new Error('worker crashed'));
      Jobs.map.clear();
      workerOK = false;
      toast('Background engine unavailable — switched to in-page processing', 'alert');
    };
    workerOK = true;
  } catch(e){ workerOK = false; }
})();
function callWorker(msg){
  return new Promise((res, rej) => {
    const id = Jobs.seq++;
    Jobs.map.set(id, { res, rej });
    worker.postMessage({ ...msg, id });
  });
}
async function engineRun(base, nodes){
  const cells = base.rows.length * Math.max(1, base.columns.length);
  if (workerOK && cells > 12000){
    const r = await callWorker({ type:'run', base, nodes: nodes.map(n => ({ type:n.type, enabled:n.enabled, params:n.params })) });
    return r.res;
  }
  return E.runFrom(base, nodes);
}
async function engineParseFile(file){
  if (workerOK) return callWorker({ type:'parseFile', file });
  const buf = await file.arrayBuffer();
  const dec = E.decodeBytes(buf);
  return { res: E.parseCSVText(dec.text), encoding: dec.encoding };
}
async function engineParseText(text){
  if (workerOK) return (await callWorker({ type:'parseText', text })).res;
  return E.parseCSVText(text);
}

/* ==================================================================
   BACKEND (hybrid mode) — local engine stays source of truth.
   When a backend URL is configured (topbar button, ?api= param, or
   window.SIEVE_API_URL), uploads are mirrored to POST /upload and each
   local run additionally fires POST /execute in the background. Remote
   mismatches surface as toasts; they never replace local results.
   ================================================================== */
const backend = { base: '', online: false, waking: false, sessionName: '' };
function renderBackendBtn(){
  const b = $('#btnBackend');
  if (!b) return;
  if (!backend.base){ b.innerHTML = ic('db',14) + ' Local-only'; b.title = 'No backend configured — everything runs in this browser. Click to add a backend URL.'; }
  else if (backend.online){ b.innerHTML = ic('db',14) + ' Backend ✓'; b.title = `Connected to ${backend.base}. Click to change or disconnect.`; }
  else if (backend.waking){ b.innerHTML = ic('db',14) + ' Waking…'; b.title = `Waking ${backend.base} — free-tier backends sleep after ~15 min idle and take ~50s to answer. Click to change or disconnect.`; }
  else { b.innerHTML = ic('db',14) + ' Backend…'; b.title = `Backend set to ${backend.base} but unreachable. Click to change or disconnect.`; }
}
async function backendCheck(silent){
  if (!backend.base){ backend.online = false; renderBackendBtn(); return false; }
  if (backend.waking) return false;
  backend.waking = true; backend.online = false; renderBackendBtn();
  const ok = await apiHealthRetry(backend.base);
  backend.waking = false; backend.online = ok; renderBackendBtn();
  // Note: datasets restored from IndexedDB carry no File object, so a
  // post-wake session cannot be minted for them — re-upload once and both
  // mirror + verification resume. Never toast at boot; the button says it.
  if (!silent) toast(ok ? `Backend connected — ${backend.base}` : 'Backend unreachable after ~90s — check the URL or try again', ok ? 'check' : 'alert');
  return ok;
}
function backendConfigure(){
  const cur = backend.base || 'http://localhost:8000';
  const v = prompt('Backend API base URL (empty = local-only mode):', cur);
  if (v === null) return;
  if (v.trim() !== '' && !/^https?:\/\//i.test(v.trim())){ toast('URL must start with http:// or https://', 'alert'); return; }
  backend.base = setApiBase(v);
  backend.online = false; backend.sessionName = '';
  renderBackendBtn();
  if (backend.base){
    toast('Backend set — checking connection…', 'db');
    backendCheck(false).then(ok => { if (ok && state.data && state.data.file) backendMirrorUpload(state.data.file); });
  } else toast('Local-only mode — backend disconnected', 'check');
}
// Mirror the raw File to the backend so /execute has a session. Silent:
// local parsing already succeeded; a backend failure must not disturb it.
async function backendMirrorUpload(file){
  if (!backend.base || !file) return;
  try {
    const up = await apiUpload(backend.base, file);
    backend.sessionName = file.name || '';
    if (state.data) state.data.file = file;
  } catch (e) {
    backend.online = false; renderBackendBtn();
    toast('Backend upload failed: ' + e.message, 'alert');
  }
}
// After every LOCAL run, verify the backend agrees (background only).
let backendSeq = 0;
async function backendVerifyRun(){
  if (!backend.base || !state.data || !state.nodes.length) return;
  if (!backend.online) return;
  if (!state.data.file) return; // demo/restored datasets were never mirrored — local stands alone
  const sid = getSessionId();
  if (!sid) return; // no session yet (e.g. demo dataset) — local stands alone
  const my = ++backendSeq;
  try {
    const r = await apiExecute(backend.base, sid, state.nodes);
    if (my !== backendSeq) return;
    if (!r.ran){
      const names = r.skipped.map(s => `${s.type} (${s.reason})`).join('; ');
      toast(`Backend check skipped — local-only steps: ${names}`, 'info');
      return;
    }
    const b = r.backend;
    const local = state.outputs[state.outputs.length - 1];
    const sameShape = local && b.shape && local.rows.length === b.shape[0] && local.columns.length === b.shape[1];
    const sameCols = local && b.columns && JSON.stringify(local.columns) === JSON.stringify(b.columns);
    if (sameShape && sameCols) toast(`Backend agrees — ${b.shape[0].toLocaleString('en-US')} rows × ${b.shape[1]} cols`, 'check');
    else toast(`Backend differs — local ${local ? local.rows.length + '×' + local.columns.length : '?'} vs backend ${b.shape} (see console)`, 'alert');
  } catch (e) {
    if (my !== backendSeq) return;
    backend.online = false; renderBackendBtn();
    toast('Backend run failed: ' + e.message, 'alert');
  }
}

/* ==================================================================
   STATE / HISTORY / PERSISTENCE
   ================================================================== */
const state = {
  data:null, nodes:[], outputs:[], selected:null,
  viewStep:'final', tab:'preview', compare:true, page:0,
  srcPos:{x:40, y:120}, outPos:{x:340, y:120}, seq:1, code:'', computing:false
};
const view = { z:.85, px:60, py:40 };
const NW = 236, PORTY = 18, PAGE = 100;

function makeNode(type){
  return { id:'n' + (state.seq++), type, enabled:true, x:0, y:0,
           params: E.OPS[type].defaults(), _err:null, _delta:null, _hint:null, _inColumns:[], _inTypes:{} };
}
function nodeCols(n){
  if (n._inColumns && n._inColumns.length) return n._inColumns;
  const last = state.outputs[state.outputs.length - 1];
  return last ? last.columns : [];
}
function selectedNode(){ return state.selected && state.selected.startsWith('n') ? state.nodes.find(x => x.id === state.selected) : null; }
function labelOf(id){
  if (id === '__src') return 'source';
  if (id === '__out') return 'output';
  const n = state.nodes.find(x => x.id === id);
  return n ? E.OPS[n.type].name.toLowerCase() : 'step';
}

/* ---- history (undo/redo) ---- */
const hist = { stack: [], idx: -1 };
function snap(label, cokey){
  return { label, cokey, at: Date.now(),
    nodes: state.nodes.map(n => ({ type:n.type, enabled:n.enabled, params: JSON.parse(JSON.stringify(n.params)), x:n.x, y:n.y })),
    srcPos: { ...state.srcPos }, outPos: { ...state.outPos } };
}
function pushHist(label, cokey){
  if (!state.data) return;
  const s = snap(label, cokey);
  const top = hist.stack[hist.idx];
  if (top && cokey && top.cokey === cokey && (s.at - top.at) < 900){ hist.stack[hist.idx] = s; }
  else {
    hist.stack.splice(hist.idx + 1);
    hist.stack.push(s);
    if (hist.stack.length > 80) hist.stack.shift();
    hist.idx = hist.stack.length - 1;
  }
  updateUndoBtns(); persistSoon();
}
function histReset(){ hist.stack = []; hist.idx = -1; updateUndoBtns(); }
// Restored positions must be finite numbers: a string/"missing" coordinate
// still positions the node element (or pins it at origin) but corrupts wire
// math downstream ("40"+236 concatenates → wire off-canvas, node looks
// fine). Snapshots are written by this app so this is defense-in-depth
// against corrupt/legacy storage, not the normal path.
function asXY(p, fb){
  const sane = v => (typeof v === 'number' && Number.isFinite(v)) ? v : NaN;
  const x = sane(p && p.x), y = sane(p && p.y);
  return { x: Number.isNaN(x) ? fb.x : x, y: Number.isNaN(y) ? fb.y : y };
}
function restoreSnap(s){
  state.nodes = s.nodes.map(x => {
    if (!E.OPS[x.type]) return null;
    const n = makeNode(x.type);
    n.enabled = x.enabled; n.params = JSON.parse(JSON.stringify(x.params));
    const pos = asXY(x, { x: 0, y: 0 });
    n.x = pos.x; n.y = pos.y;
    return n;
  }).filter(Boolean);
  state.srcPos = asXY(s.srcPos, { x: 40, y: 120 });
  state.outPos = asXY(s.outPos, { x: 340, y: 120 });
  state.selected = null; state.viewStep = 'final';
  requestRun(0); renderNodes(); renderInspector(); updateUndoBtns(); persistSoon();
}
function undo(){ if (!state.data || hist.idx <= 0) return; hist.idx--; restoreSnap(hist.stack[hist.idx]); toast('Undo — ' + hist.stack[hist.idx + 1].label, 'undo'); }
function redo(){ if (!state.data || hist.idx >= hist.stack.length - 1) return; hist.idx++; restoreSnap(hist.stack[hist.idx]); toast('Redo — ' + hist.stack[hist.idx].label, 'redo'); }
function updateUndoBtns(){
  $('#btnUndo').disabled = hist.idx <= 0;
  $('#btnRedo').disabled = hist.idx >= hist.stack.length - 1;
}

/* ---- persistence ---- */
const LS_KEY = 'sieve.pipeline.v2';
let persistTimer = null;
function updateSaveChip(mode){
  const elc = $('#saveChip');
  if (mode === 'pending'){ elc.textContent = 'saving…'; return; }
  if (mode === 'error'){ elc.textContent = 'autosave unavailable'; elc.title = 'Browser storage is blocked or full'; return; }
  if (mode === 'big'){ elc.textContent = 'pipeline saved · dataset too large'; elc.title = 'Datasets over ~45 MB are not persisted; the pipeline still is.'; return; }
  const t = new Date();
  elc.textContent = `saved ${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
  elc.title = 'Pipeline saved in this browser. Dataset stored in IndexedDB.';
}
let saveChipTimer = null;
function persistSoon(){
  // "saving…" only appears when a save is genuinely delayed (>800ms of
  // continuous interaction); fast saves settle silently to "saved HH:MM"
  // instead of flashing the chip on every keystroke.
  clearTimeout(persistTimer); persistTimer = setTimeout(persistNow, 500);
  clearTimeout(saveChipTimer);
  saveChipTimer = setTimeout(() => updateSaveChip('pending'), 800);
}
function persistNow(){
  clearTimeout(saveChipTimer);
  if (!state.data) return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      v:2, savedAt: Date.now(), datasetName: state.data.name,
      nodes: state.nodes.map(n => ({ type:n.type, enabled:n.enabled, params:n.params, x:n.x, y:n.y })),
      srcPos: state.srcPos, outPos: state.outPos, view
    }));
    updateSaveChip('saved');
  } catch(e){ updateSaveChip('error'); }
}
function idbOpen(){
  return new Promise((res, rej) => {
    if (!('indexedDB' in window)) return rej(new Error('no indexedDB'));
    const rq = indexedDB.open('sieve', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error || new Error('idb error'));
    rq.onblocked = () => rej(new Error('idb blocked'));
  });
}
async function idbSet(k, v){
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(v, k);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
  });
}
async function idbGet(k){
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const rq = db.transaction('kv').objectStore('kv').get(k);
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
  });
}
async function idbDel(k){
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').delete(k);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
async function persistDataset(){
  const d = state.data; if (!d) return;
  const est = d.rows.length * Math.max(1, d.columns.length) * 12;
  if (est > 45e6){ d.persisted = false; d.persistNote = 'too large to autosave'; updateSaveChip('big'); return; }
  try {
    await idbSet('dataset', { name:d.name, columns:d.columns, rows:d.rows, warnings:d.warnings, encoding:d.encoding, delim:d.delim, bytes:d.bytes, savedAt: Date.now() });
    d.persisted = true; d.persistNote = '';
  } catch(e){ d.persisted = false; d.persistNote = 'storage unavailable'; }
}

/* ==================================================================
   RUN SCHEDULING — memoised, worker-backed, stale-result-safe
   ================================================================== */
let runJob = 0, dirtyFrom = Infinity, running = false, latestJob = 0;
const scheduleRun = debounce(() => doRun(), 140);
function requestRun(from){
  dirtyFrom = Math.min(dirtyFrom, clamp(from, 0, Math.max(0, state.nodes.length)));
  scheduleRun();
}
async function doRun(){
  if (!state.data || running) return;
  if (dirtyFrom > state.nodes.length) return;
  running = true;
  const from = clamp(dirtyFrom, 0, state.nodes.length);
  dirtyFrom = Infinity;
  const job = ++latestJob;
  setComputing(true);
  try {
    const base = state.outputs[from] || { columns: state.data.columns, rows: state.data.rows };
    const nodesSlice = state.nodes.slice(from);
    const res = await engineRun({ columns: base.columns, rows: base.rows }, nodesSlice);
    if (job !== latestJob) return;
    applyRun(from, res, nodesSlice);
  } catch(err){
    if (job === latestJob) toast('Engine error: ' + err.message, 'alert');
  } finally {
    running = false;
    if (job === latestJob) setComputing(false);
    if (dirtyFrom <= state.nodes.length) scheduleRun();
  }
}
function applyRun(from, res, nodesSlice){
  res.results.forEach((r, i) => {
    const n = nodesSlice[i]; if (!n) return;
    n._err = r.err; n._delta = r.delta; n._hint = r.hint;
    n._inColumns = r.inColumns; n._inTypes = r.inTypes;
  });
  // res.outputs[0] is the run's base (= state.outputs[from]), NOT an extra
  // entry: splice from `from`, not `from + 1`, or every run appends a phantom
  // output ("Step 2 · ?" with 1 step), trips the length check below, and
  // re-runs forever — stuck "computing…", churned renders, starved paints.
  state.outputs.splice(from, state.outputs.length - from, ...res.outputs);
  if (state.outputs.length !== state.nodes.length + 1) requestRun(0);
  ensureDeep(0); ensureDeep(state.outputs.length - 1);
  renderNodes(); refreshInspectorAfterRun(); renderPreview(); renderCode();
  persistSoon();
  backendVerifyRun();
}
function refreshInspectorAfterRun(){
  const n = selectedNode();
  if (!n){ renderInspector(); return; }
  const errKey = n._err || '', colsKey = (n._inColumns || []).join('\u0001');
  if (n._lastErrKey !== errKey || n._lastColsKey !== colsKey){
    n._lastErrKey = errKey; n._lastColsKey = colsKey;
    renderInspector();
  }
}
function setComputing(b){
  state.computing = b;
  const el = $('#computeChip'); if (el) el.hidden = !b;
  $('#pvScroll').setAttribute('aria-busy', b ? 'true' : 'false');
}
/* deep stats (duplicate + unique counts) computed lazily off the UI path */
let deepBusySet = new Set();
function ensureDeep(i){
  const o = state.outputs[i];
  if (!o || o.meta.dupCount != null || deepBusySet.has(i)) return;
  deepBusySet.add(i);
  setTimeout(async () => {
    try {
      let meta;
      if (workerOK) meta = (await callWorker({ type:'meta', data:{ columns:o.columns, rows:o.rows } })).res;
      else meta = E.metaOf(o.columns, o.rows, true);
      if (state.outputs[i] === o){ o.meta = meta; renderPreview(); renderInspector(); }
    } catch(e){ /* non-fatal */ }
    deepBusySet.delete(i);
  }, 500);
}

/* ==================================================================
   CANVAS — nodes, wires, pan / zoom, drag, keyboard
   ================================================================== */
const nodeEls = new Map();
function chainNodes(){
  const ch = [{ id:'__src', x:state.srcPos.x, y:state.srcPos.y }];
  for (const n of state.nodes) if (n.enabled) ch.push(n);
  ch.push({ id:'__out', x:state.outPos.x, y:state.outPos.y });
  return ch;
}
function objOf(id){
  if (id === '__src') return state.srcPos;
  if (id === '__out') return state.outPos;
  return state.nodes.find(n => n.id === id);
}
const WIRE_DEFS = `<defs>
  <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7.5" markerHeight="7.5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#57503F"/></marker>
  <marker id="arrA" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7.5" markerHeight="7.5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#D9481F"/></marker>
</defs>`;
function renderWires(){
  if (!state.data){ $('#wires').innerHTML = ''; return; }
  const ch = chainNodes(); let html = WIRE_DEFS;
  for (let i = 0; i < ch.length - 1; i++){
    const a = ch[i], b = ch[i+1];
    html += `<path id="w-${a.id}" d="${E.wirePath(a.x, a.y, b.x, b.y, NW, PORTY)}" marker-end="url(#arr)"/>`;
  }
  $('#wires').innerHTML = html;
}
function footText(n){
  if (n._err) return n._err;
  const d = n._delta; if (!d) return 'waiting to run';
  const bits = [];
  if (d.ra !== d.rb) bits.push(`${fmt(d.rb)} → ${fmt(d.ra)} rows`);
  if (d.ca !== d.cb) bits.push(`${d.cb} → ${d.ca} cols`);
  if (d.ma !== d.mb) bits.push(`missing ${fmt(d.mb)} → ${fmt(d.ma)}`);
  if (!bits.length) bits.push(d.changed > 0 ? `${fmt(d.changed)} cells changed` : 'no change');
  return bits.join(' · ');
}
function nodeAria(id, inner){
  let extra = '';
  if (id.startsWith('n')) extra = ' Press Enter to configure, Delete to remove, arrow keys to move.';
  return inner.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() + '.' + extra;
}
function bindNode(el){
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('.nx')) return;
    e.stopPropagation();
    const id = el.dataset.id, obj = objOf(id);
    if (!obj) return;
    const sx = e.clientX, sy = e.clientY, ox = obj.x, oy = obj.y;
    let moved = false, raf = 0, lx = sx, ly = sy;
    try { el.setPointerCapture(e.pointerId); } catch(_){}
    // One paint per frame: raw pointermove can fire several times per
    // frame (touch especially), and each paint re-lays-out the wires SVG.
    const paint = () => {
      raf = 0;
      const dx = (lx - sx) / view.z, dy = (ly - sy) / view.z;
      if (!moved && Math.abs(lx - sx) + Math.abs(ly - sy) > 4){ moved = true; el.style.cursor = 'grabbing'; }
      if (!moved) return;
      obj.x = Math.round(ox + dx); obj.y = Math.round(oy + dy);
      el.style.left = obj.x + 'px'; el.style.top = obj.y + 'px';
      renderWires();
    };
    const mv = ev => { lx = ev.clientX; ly = ev.clientY; if (!raf) raf = requestAnimationFrame(paint); };
    // pointercancel (scroll takeover, gesture interrupt, alert) must clean
    // up exactly like pointerup: otherwise the stale handler survives, the
    // next drag stacks a second one, and both fight from different anchors.
    const done = cancelled => {
      if (raf){ cancelAnimationFrame(raf); raf = 0; }
      el.removeEventListener('pointermove', mv);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', onCancel);
      el.style.cursor = '';
      if (cancelled) return;
      if (!moved) selectNode(id);
      else pushHist('moved ' + labelOf(id), 'move:' + id);
    };
    const onCancel = () => done(true);
    const up = () => done(false);
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', onCancel);
  });
  el.addEventListener('keydown', e => {
    const id = el.dataset.id, obj = objOf(id);
    if (!obj) return;
    if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); selectNode(id); return; }
    if (e.target.closest('.nx')) return;
    const step = e.shiftKey ? 40 : 10;
    let moved = true;
    if (e.key === 'ArrowLeft') obj.x -= step;
    else if (e.key === 'ArrowRight') obj.x += step;
    else if (e.key === 'ArrowUp') obj.y -= step;
    else if (e.key === 'ArrowDown') obj.y += step;
    else if ((e.key === 'Delete' || e.key === 'Backspace') && id.startsWith('n')){ e.preventDefault(); deleteNode(id); return; }
    else moved = false;
    if (moved){
      e.preventDefault();
      el.style.left = obj.x + 'px'; el.style.top = obj.y + 'px';
      renderWires(); pushHist('moved ' + labelOf(id), 'move:' + id);
    }
  });
  el.addEventListener('click', e => {
    const id = el.dataset.id;
    if (e.target.closest('.nx') && id.startsWith('n')){ e.stopPropagation(); deleteNode(id); }
  });
}
function renderNodes(){
  const layer = $('#nodesLayer');
  $('#startHint').hidden = !(state.data && state.nodes.length === 0);
  if (!state.data){ layer.innerHTML = ''; nodeEls.clear(); renderWires(); return; }
  const keep = new Set();

  keep.add('__src');
  { let el = nodeEls.get('__src');
    if (!el){ el = elDiv('node src'); el.dataset.id = '__src'; el.tabIndex = 0; bindNode(el); nodeEls.set('__src', el); layer.append(el); }
    el.style.left = state.srcPos.x + 'px'; el.style.top = state.srcPos.y + 'px';
    el.classList.toggle('sel', state.selected === '__src');
    el.innerHTML = `<div class="nh"><span class="nic">${ic('db',15)}</span><span class="nname">Source</span><span class="ndot"></span></div>
      <div class="nsum ellipsis" title="${esc(state.data.name)}">${esc(state.data.name)}</div>
      <div class="nfoot">${fmt(state.data.rows.length)} rows · ${state.data.columns.length} cols · raw import</div>`;
    el.setAttribute('aria-label', nodeAria('__src', 'Source dataset ' + state.data.name + ', ' + state.data.rows.length + ' rows, ' + state.data.columns.length + ' columns')); }

  state.nodes.forEach((n, i) => {
    keep.add(n.id);
    try {
      let el = nodeEls.get(n.id);
      if (!el){
        el = elDiv('node'); el.dataset.id = n.id; el.tabIndex = 0; bindNode(el); nodeEls.set(n.id, el); layer.append(el);
        el.dataset.bound = '1';
        el.classList.add('appear'); el.style.animationDelay = Math.min(i * 60, 360) + 'ms';
      } else if (!el.dataset.bound){
        // Recovered from a broken render (which creates its element
        // separately below): attach interaction handlers it never got.
        bindNode(el); el.dataset.bound = '1';
      }
      el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
      const op = E.OPS[n.type];
      if (!op) throw new Error(`unknown operation "${n.type}"`);
      el.className = 'node' + (state.selected === n.id ? ' sel' : '') + (n.enabled ? '' : ' muted') + (n._err ? ' err' : '');
      el.innerHTML = `<button class="nx" title="Remove step" aria-label="Remove ${esc(op.name)}">${ic('x',11)}</button>
        <div class="nh"><span class="nstep">${n.enabled ? i+1 : '–'}</span><span class="nic">${ic(op.icon,14)}</span><span class="nname">${esc(op.name)}</span><span class="ndot"></span></div>
        <div class="nsum">${esc(op.summary(n.params) || '')}</div>
        <div class="nfoot">${esc(footText(n))}</div>`;
      el.setAttribute('aria-label', nodeAria(n.id, `Step ${i+1}: ${op.name}. ${op.summary(n.params)}. ${n.enabled ? footText(n) : 'bypassed'}`));
    } catch(err){
      // One broken step must never abort the whole canvas render (which
      // would leave fresh nodes with stale wires and no explanation).
      renderBrokenNode(layer, n, i, err);
    }
  });

  keep.add('__out');
  { let el = nodeEls.get('__out');
    if (!el){ el = elDiv('node out'); el.dataset.id = '__out'; el.tabIndex = 0; bindNode(el); nodeEls.set('__out', el); layer.append(el); }
    el.style.left = state.outPos.x + 'px'; el.style.top = state.outPos.y + 'px';
    el.classList.toggle('sel', state.selected === '__out');
    const fin = state.outputs[state.outputs.length - 1];
    const active = state.nodes.filter(n => n.enabled).length;
    el.innerHTML = `<div class="nh"><span class="nic">${ic('download',15)}</span><span class="nname">Clean Output</span><span class="ndot"></span></div>
      <div class="nsum">${fin ? fmt(fin.rows.length) + ' rows × ' + fin.columns.length + ' cols' : '—'}</div>
      <div class="nfoot">${active} active step${active === 1 ? '' : 's'} · final result</div>`;
    el.setAttribute('aria-label', nodeAria('__out', 'Clean output, final result')); }

  for (const [id, el] of [...nodeEls]) if (!keep.has(id)){ el.remove(); nodeEls.delete(id); }
  try {
    renderWires();
  } catch(err){
    console.error('renderWires failed:', err);
    warnRenderSkip('wires', err);
  }
}

let lastRenderWarn = 0;
function warnRenderSkip(what, err){
  console.error(`renderNodes: ${what} failed to display:`, err);
  const now = Date.now();
  if (now - lastRenderWarn > 8000){
    lastRenderWarn = now;
    toast('A canvas element failed to display — open the console (F12) for details.', 'alert');
  }
}
function renderBrokenNode(layer, n, i, err){
  warnRenderSkip(`step ${i + 1} ("${n && n.type}")`, err);
  let el = nodeEls.get(n.id);
  if (!el){
    // A broken step must stay interactive (drag/select/remove) like any
    // other: without bindNode it was inert and only a full Reset could
    // get rid of it. The inspector already offers "Remove broken step".
    el = elDiv('node err'); el.dataset.id = n.id; el.tabIndex = 0; bindNode(el);
    el.dataset.bound = '1';
    nodeEls.set(n.id, el); layer.append(el);
  }
  el.style.left = (typeof n.x === 'number' ? n.x : 0) + 'px';
  el.style.top = (typeof n.y === 'number' ? n.y : 0) + 'px';
  el.className = 'node err';
  el.innerHTML = `<button class="nx" title="Remove step" aria-label="Remove broken step">${ic('x',11)}</button>
    <div class="nh"><span class="nstep">!</span><span class="nname">Broken step</span><span class="ndot"></span></div>
    <div class="nfoot">Could not display this step (unknown type or bad settings). Click it for removal options.</div>`;
  el.setAttribute('aria-label', `Step ${i + 1}: broken step. Click it for removal options.`);
}

/* ---- pan / zoom ---- */
function applyView(){
  $('#world').style.transform = `translate(${view.px}px,${view.py}px) scale(${view.z})`;
  // Infinite dot grid: dots live on #viewport (fixed 26px, full coverage),
  // offset by pan so they feel anchored while zoom keeps them readable.
  const vp = $('#viewport');
  if (vp) vp.style.backgroundPosition = `${view.px}px ${view.py}px`;
}
function zoomLab(){ $('#zoomLab').textContent = Math.round(view.z * 100) + '%'; }
function zoomAt(cx, cy, k){
  const nz = clamp(view.z * k, .35, 1.8);
  view.px = cx - (cx - view.px) * (nz / view.z);
  view.py = cy - (cy - view.py) * (nz / view.z);
  view.z = nz; applyView(); zoomLab(); persistSoon();
}
function initCanvasEvents(){
  const vp = $('#viewport');
  vp.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('.node')) return;
    const sx = e.clientX - view.px, sy = e.clientY - view.py;
    vp.classList.add('panning');
    try { vp.setPointerCapture(e.pointerId); } catch(_){}
    let raf = 0, lx = e.clientX, ly = e.clientY;
    const paint = () => { raf = 0; view.px = lx - sx; view.py = ly - sy; applyView(); };
    const mv = ev => { lx = ev.clientX; ly = ev.clientY; if (!raf) raf = requestAnimationFrame(paint); };
    const done = cancelled => {
      if (raf){ cancelAnimationFrame(raf); raf = 0; }
      vp.classList.remove('panning');
      vp.removeEventListener('pointermove', mv);
      vp.removeEventListener('pointerup', up);
      vp.removeEventListener('pointercancel', onCancel);
      if (!cancelled) persistSoon();
    };
    const onCancel = () => done(true);
    const up = () => done(false);
    vp.addEventListener('pointermove', mv);
    vp.addEventListener('pointerup', up);
    vp.addEventListener('pointercancel', onCancel);
  });
  vp.addEventListener('wheel', e => {
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1/1.12);
  }, { passive:false });

  $('#btnZin').onclick  = () => { const r = vp.getBoundingClientRect(); zoomAt(r.width/2, r.height/2, 1.18); };
  $('#btnZout').onclick = () => { const r = vp.getBoundingClientRect(); zoomAt(r.width/2, r.height/2, 1/1.18); };
  $('#btnFit').onclick  = fitView;
  $('#btnUndo').onclick = undo;
  $('#btnRedo').onclick = redo;
  $('#btnTidy').onclick = () => { if (!state.data) return; arrange(); pushHist('arranged steps'); };
  $('#btnRun').onclick  = () => { requestRun(0); playRun(); };

  const bc = $('#btnClear'); let armed = false, tmr;
  bc.onclick = () => {
    if (!state.data || !state.nodes.length){ toast('Nothing to clear', 'info'); return; }
    if (!armed){
      armed = true; bc.classList.add('arm'); bc.querySelector('span').textContent = 'Sure?';
      tmr = setTimeout(() => { armed = false; bc.classList.remove('arm'); bc.querySelector('span').textContent = 'Clear steps'; }, 2200);
    } else {
      clearTimeout(tmr); armed = false; bc.classList.remove('arm'); bc.querySelector('span').textContent = 'Clear steps';
      state.nodes = []; state.selected = null; state.viewStep = 'final';
      requestRun(0); renderNodes(); renderInspector(); renderPreview(); renderCode();
      pushHist('cleared pipeline'); toast('Pipeline cleared', 'trash');
    }
  };

  const sp = $('#splitter'), wrap = $('#canvasWrap'), center = $('#center');
  sp.addEventListener('pointerdown', e => {
    e.preventDefault();
    const startY = e.clientY, startH = wrap.offsetHeight, maxH = center.clientHeight - 190;
    try { sp.setPointerCapture(e.pointerId); } catch(_){}
    let raf = 0, ly = startY;
    const paint = () => { raf = 0; wrap.style.height = clamp(startH + (ly - startY), 160, maxH) + 'px'; };
    const mv = ev => { ly = ev.clientY; if (!raf) raf = requestAnimationFrame(paint); };
    const done = () => {
      if (raf){ cancelAnimationFrame(raf); raf = 0; }
      sp.removeEventListener('pointermove', mv);
      sp.removeEventListener('pointerup', up);
      sp.removeEventListener('pointercancel', onCancel);
    };
    const onCancel = () => done();
    const up = () => done();
    sp.addEventListener('pointermove', mv);
    sp.addEventListener('pointerup', up);
    sp.addEventListener('pointercancel', onCancel);
  });
}
function arrange(){
  const y = 100;
  state.srcPos = { x:40, y };
  state.nodes.forEach((n, i) => { n.x = 40 + 300 * (i+1); n.y = y; });
  state.outPos = { x: 40 + 300 * (state.nodes.length + 1), y };
  renderNodes();
}
function fitView(){
  const objs = [state.srcPos, ...state.nodes, state.outPos];
  if (!objs.length) return;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const o of objs){ x1 = Math.min(x1, o.x); y1 = Math.min(y1, o.y); x2 = Math.max(x2, o.x + NW); y2 = Math.max(y2, o.y + 96); }
  const vp = $('#viewport'), vw = vp.clientWidth, vh = vp.clientHeight;
  const z = clamp(Math.min(vw / (x2 - x1 + 90), vh / (y2 - y1 + 90)), .35, 1.05);
  view.z = z;
  view.px = (vw - (x2 - x1) * z) / 2 - x1 * z;
  view.py = (vh - (y2 - y1) * z) / 2 - y1 * z;
  applyView(); zoomLab(); persistSoon();
}

/* ---- run pulse animation ---- */
let animBusy = false;
async function playRun(){
  if (animBusy || !state.data || (RM && RM.matches)) return;
  animBusy = true;
  const ch = chainNodes();
  for (const id of ['__src', ...state.nodes.map(n => n.id), '__out']) nodeEls.get(id)?.classList.remove('running');
  for (let i = 1; i < ch.length; i++){
    const a = ch[i-1], b = ch[i];
    const w = document.getElementById('w-' + a.id), bEl = nodeEls.get(b.id);
    if (w){ w.classList.add('flow'); w.setAttribute('marker-end','url(#arrA)'); }
    bEl?.classList.add('running');
    await wait(150);
    if (w){ w.classList.remove('flow'); w.setAttribute('marker-end','url(#arr)'); }
    bEl?.classList.remove('running');
  }
  animBusy = false;
}
function flashNode(id){
  const el = nodeEls.get(id); if (!el) return;
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

/* ==================================================================
   SELECTION & STRUCTURAL EDITS
   ================================================================== */
function selectNode(id){
  if (!state.data) return;
  state.selected = id;
  if (id === '__src') state.viewStep = 0;
  else if (id === '__out') state.viewStep = 'final';
  else { const i = state.nodes.findIndex(n => n.id === id); if (i >= 0) state.viewStep = i + 1; }
  renderNodes(); renderInspector(); renderPreview();
  // Mobile: tapping a step opens the inspector drawer so its settings are reachable.
  if (id && id.startsWith('n') && isMobileView()) setDrawer('insp');
}
function deleteNode(id){
  if (!id || !id.startsWith('n')) return;
  const i = state.nodes.findIndex(n => n.id === id);
  if (i < 0) return;
  state.nodes.splice(i, 1);
  if (state.selected === id) state.selected = null;
  requestRun(i); renderNodes(); renderInspector(); renderPreview(); renderCode();
  pushHist('removed step');
  toast('Step removed', 'trash');
}
function moveNode(n, dir){
  const i = state.nodes.indexOf(n), j = i + dir;
  if (j < 0 || j >= state.nodes.length) return;
  [state.nodes[i], state.nodes[j]] = [state.nodes[j], state.nodes[i]];
  requestRun(Math.min(i, j)); renderNodes(); renderPreview(); renderCode();
  pushHist('reordered steps');
}
function addNode(type){
  if (!state.data){ toast('Load a dataset first — upload a CSV or open a demo', 'alert'); return; }
  const n = makeNode(type);
  const last = state.nodes[state.nodes.length - 1];
  if (last){
    n.x = last.x + 300; n.y = last.y;
    if (n.x > 2300){ n.x = 60; n.y = last.y + 180; }
  } else { n.x = state.srcPos.x + 300; n.y = state.srcPos.y; }
  const schema = E.OPS[type].schema || [];
  const colField = schema.find(f => f.t === 'column');
  if (colField && !n.params[colField.k]){
    const cols = state.outputs.length ? state.outputs[state.outputs.length - 1].columns : state.data.columns;
    n.params[colField.k] = firstSuitableColumn(type, n.params, cols);
  }
  state.nodes.push(n);
  state.outPos = { x: n.x + 300, y: n.y };
  state.selected = n.id;
  state.viewStep = state.nodes.length;
  requestRun(state.nodes.length - 1);
  renderNodes(); renderInspector(); renderPreview(); renderCode();
  pushHist('added ' + E.OPS[type].name);
  setDrawer(null); // mobile: reveal the canvas with the new step
}
function firstSuitableColumn(type, params, cols){
  // A fresh Fill Missing on a text column instantly errors ("no parseable
  // numeric values"), so when the op declares a numeric need, pre-pick the
  // first numeric column instead of blindly taking cols[0]. Falls back to
  // cols[0] (or '' when nothing numeric exists) on any uncertainty.
  try {
    const op = E.OPS[type];
    if (!op || typeof op.hint !== 'function' || !cols.length) return cols[0] || '';
    const last = state.outputs.length ? state.outputs[state.outputs.length - 1] : null;
    const meta = (last && last.meta) || E.metaOf(state.data.columns, state.data.rows, false);
    const hint = op.hint({ columns: cols }, params, meta) || null;
    if (hint && hint.num && meta && meta.types){
      return cols.find(c => meta.types[c] === 'num') || '';
    }
    return cols[0] || '';
  } catch(e){ return cols[0] || ''; }
}
function duplicateNode(n){
  const i = state.nodes.indexOf(n);
  const c = makeNode(n.type);
  c.enabled = n.enabled; c.params = JSON.parse(JSON.stringify(n.params));
  c.x = n.x + 40; c.y = n.y + 60;
  state.nodes.splice(i + 1, 0, c);
  state.selected = c.id; state.viewStep = i + 2;
  requestRun(i + 1); renderNodes(); renderInspector(); renderPreview(); renderCode();
  pushHist('duplicated ' + E.OPS[n.type].name);
  toast('Step duplicated', 'copy');
}

/* ==================================================================
   INSPECTOR — schema-driven forms + dataset profiling
   ================================================================== */
function tile(v, l){ return `<div class="tile"><b>${esc(String(v))}</b><i>${esc(l)}</i></div>`; }
const TYGLYPH = { num:'123', date:'DATE', text:'ABC' };
function profileHTML(meta, columns, rowCount){
  return columns.map(c => {
    const ty = meta.types[c] || 'text';
    const m = meta.missingByCol[c] || 0;
    const pct = rowCount ? Math.round(m / rowCount * 100) : 0;
    const u = meta.uniqByCol ? (meta.uniqByCol[c] != null ? `${meta.uniqByCol[c]} unique` : '') : '';
    const sample = meta.samples && meta.samples[c] != null ? meta.samples[c] : '';
    return `<div class="prof">
      <div class="prof-h"><span class="pn">${esc(c)}</span><span class="ty">${TYGLYPH[ty]}</span></div>
      <div class="prof-b">
        ${m ? `${fmt(m)} empty (${pct}%) · ` : ''}${u}
        <div class="mbar"><i style="width:${pct}%"></i></div>
        ${sample !== '' ? `<div class="psamp">“${esc(String(sample)).slice(0,60)}”</div>` : ''}
      </div></div>`;
  }).join('');
}
function colOpts(node, val){
  const cols = nodeCols(node);
  const o = cols.map(c => [c, c]);
  if (val && !cols.includes(val)) o.unshift([val, val + '  (missing upstream)']);
  return o;
}
function mkSelect(opts, val){
  const s = document.createElement('select');
  for (const [v, l] of opts){
    const o = document.createElement('option'); o.value = v; o.textContent = l;
    if (v === val) o.selected = true;
    s.append(o);
  }
  return s;
}
let paramDeb;
function onParam(node, rebuildForm){
  const i = state.nodes.indexOf(node);
  if (i >= 0) requestRun(i);
  flashNode(node.id);
  pushHist('edited ' + E.OPS[node.type].name, 'param:' + node.id);
  clearTimeout(paramDeb);
  paramDeb = setTimeout(() => { if (rebuildForm) renderInspector(); }, 60);
}
function buildField(f, node){
  const wrap = elDiv('f');
  const P = node.params;
  if (f.t === 'column'){
    wrap.innerHTML = `<label>${esc(f.label)}</label>`;
    const s = mkSelect(colOpts(node, P[f.k]), P[f.k]);
    s.onchange = () => { P[f.k] = s.value; onParam(node, true); };
    wrap.append(s);
  } else if (f.t === 'select'){
    wrap.innerHTML = `<label>${esc(f.label)}</label>`;
    const opts = typeof f.opts === 'function' ? f.opts({ columns: nodeCols(node) }) : f.opts;
    const s = mkSelect(opts, P[f.k]);
    s.onchange = () => { P[f.k] = s.value; onParam(node, true); };
    wrap.append(s);
  } else if (f.t === 'seg'){
    wrap.innerHTML = `<label>${esc(f.label)}</label>`;
    const d = elDiv('seg');
    f.opts.forEach(([v, l]) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = l;
      if (v === P[f.k]) b.classList.add('on');
      b.onclick = () => { [...d.children].forEach(x => x.classList.remove('on')); b.classList.add('on'); P[f.k] = v; onParam(node, true); };
      d.append(b);
    });
    wrap.append(d);
  } else if (f.t === 'check'){
    const w = elDiv('ck' + (P[f.k] ? ' on' : ''), `<span class="box">${ic('check',11)}</span><span class="lbl">${esc(f.label)}</span>`);
    w.setAttribute('role', 'checkbox'); w.setAttribute('aria-checked', P[f.k] ? 'true' : 'false'); w.tabIndex = 0;
    const tog = () => { P[f.k] = w.classList.toggle('on'); w.setAttribute('aria-checked', P[f.k] ? 'true' : 'false'); onParam(node); };
    w.onclick = tog;
    w.onkeydown = e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); tog(); } };
    return w;
  } else if (f.t === 'text' || f.t === 'number'){
    wrap.innerHTML = `<label>${esc(f.label)}</label>`;
    const inp = document.createElement('input');
    inp.type = f.t; if (f.ph) inp.placeholder = f.ph; inp.value = P[f.k] ?? '';
    inp.addEventListener('change', () => { P[f.k] = inp.value; onParam(node); });
    inp.addEventListener('input', () => { P[f.k] = inp.value; requestRun(state.nodes.indexOf(node)); });
    wrap.append(inp);
  } else if (f.t === 'multi'){
    wrap.innerHTML = `<label>${esc(f.label)}</label>`;
    P.columns = P.columns || [];
    nodeCols(node).forEach(c => {
      const w = elDiv('ck' + (P.columns.includes(c) ? ' on' : ''), `<span class="box">${ic('check',11)}</span><span class="lbl">${esc(c)}</span>`);
      w.setAttribute('role', 'checkbox'); w.setAttribute('aria-checked', P.columns.includes(c) ? 'true' : 'false'); w.tabIndex = 0;
      const tog = () => {
        const on = w.classList.toggle('on');
        w.setAttribute('aria-checked', on ? 'true' : 'false');
        P.columns = on ? [...P.columns, c] : P.columns.filter(x => x !== c);
        onParam(node);
      };
      w.onclick = tog;
      w.onkeydown = e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); tog(); } };
      wrap.append(w);
    });
  } else if (f.t === 'lines'){
    // Ordered string list (reorder-columns): one entry per line, kept raw
    // (column names may carry significant spaces) — only exact-'' lines drop.
    wrap.innerHTML = `<label>${esc(f.label)}</label>`;
    const ta = document.createElement('textarea');
    ta.rows = Math.max(4, nodeCols(node).length + 1);
    ta.placeholder = nodeCols(node).join('\n');
    ta.value = (P[f.k] || []).join('\n');
    ta.addEventListener('change', () => { P[f.k] = ta.value.split('\n').filter(x => x !== ''); onParam(node); });
    ta.addEventListener('input', () => { P[f.k] = ta.value.split('\n').filter(x => x !== ''); requestRun(state.nodes.indexOf(node)); });
    wrap.append(ta);
  } else if (f.t === 'rename'){
    wrap.innerHTML = `<label>${esc(f.label)}</label>`;
    P.map = P.map || {};
    nodeCols(node).forEach(c => {
      const row = elDiv('renrow', `<span class="ro">${esc(c)}</span><span class="ra">${ic('arrowr',12)}</span>`);
      const inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = c; inp.value = P.map[c] || '';
      inp.addEventListener('change', () => { P.map[c] = inp.value; onParam(node); });
      inp.addEventListener('input', () => { P.map[c] = inp.value; requestRun(state.nodes.indexOf(node)); });
      row.append(inp); wrap.append(row);
    });
  }
  return wrap;
}
function renderInspector(){
  const H = $('#inspHead'), B = $('#inspBody');
  if (!state.data){
    H.innerHTML = '';
    B.innerHTML = '<div class="empty">Load a dataset to begin.<br>Upload a CSV or open a demo.</div>';
    return;
  }
  const id = state.selected;

  /* ---- operation node ---- */
  if (id && id.startsWith('n')){
    const n = state.nodes.find(x => x.id === id);
    if (!n){ state.selected = null; return renderInspector(); }
    const op = E.OPS[n.type], idx = state.nodes.indexOf(n);
    if (!op){
      H.innerHTML = `<div class="ih-t"><span class="ihic">${ic('alert',17)}</span>Broken step</div>
        <div class="ih-s">Step ${idx+1} of ${state.nodes.length} · unknown operation "${esc(n.type)}"</div>`;
      B.innerHTML = '';
      B.append(elDiv('errbox', ic('alert',14) + '<div>This step cannot be displayed or configured. Remove it below and re-add.</div>'));
      const del = elDiv('f', '<button class="btn sm danger">Remove broken step</button>');
      del.querySelector('button').onclick = () => deleteNode(n.id);
      B.append(del);
      return;
    }
    H.innerHTML = `<div class="ih-t"><span class="ihic">${ic(op.icon,17)}</span>${esc(op.name)}</div>
      <div class="ih-s">Step ${idx+1} of ${state.nodes.length} · ${n.enabled ? 'active' : 'bypassed'}</div>`;
    B.innerHTML = '';
    if (n._err) B.append(elDiv('errbox', ic('alert',14) + `<div>${esc(n._err)}</div>`));
    for (const f of op.schema){
      if (f.show && !f.show(n.params)) continue;
      B.append(buildField(f, n));
    }
    const sw = elDiv('f', `<label>Step active</label>
      <div class="swrow"><span class="swlab">include this step when the pipeline runs</span>
      <div class="switch ${n.enabled ? 'on' : ''}" role="switch" aria-checked="${n.enabled}" tabindex="0"><i></i></div></div>`);
    const swEl = sw.querySelector('.switch');
    const tog = () => {
      n.enabled = !n.enabled;
      swEl.classList.toggle('on', n.enabled); swEl.setAttribute('aria-checked', n.enabled ? 'true' : 'false');
      requestRun(state.nodes.indexOf(n)); renderNodes(); renderPreview(); renderCode();
      pushHist((n.enabled ? 'enabled ' : 'bypassed ') + op.name);
      toast(n.enabled ? 'Step re-enabled' : 'Step bypassed', n.enabled ? 'check' : 'ban');
    };
    swEl.onclick = tog;
    swEl.onkeydown = e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); tog(); } };
    B.append(sw);
    const od = elDiv('f', `<label>Order &amp; removal</label><div class="mrow">
      <button class="btn sm" data-a="up">${ic('chevup',13)} Up</button>
      <button class="btn sm" data-a="down">${ic('chevdown',13)} Down</button>
      <button class="btn sm" data-a="dup">${ic('copy',13)} Duplicate</button>
      <button class="btn sm danger" data-a="del">${ic('trash',13)} Remove</button></div>`);
    od.querySelector('[data-a=up]').onclick   = () => moveNode(n, -1);
    od.querySelector('[data-a=down]').onclick = () => moveNode(n, +1);
    od.querySelector('[data-a=dup]').onclick  = () => duplicateNode(n);
    od.querySelector('[data-a=del]').onclick  = () => deleteNode(n.id);
    B.append(od);
    return;
  }

  /* ---- output node ---- */
  if (id === '__out'){
    const fin = state.outputs[state.outputs.length - 1];
    const src = state.outputs[0];
    if (!fin || !src){ B.innerHTML = '<div class="empty">Computing…</div>'; return; }
    const dr = src.rows.length - fin.rows.length;
    H.innerHTML = `<div class="ih-t"><span class="ihic">${ic('download',17)}</span>Clean Output</div>
      <div class="ih-s">final dataset after ${state.nodes.filter(n => n.enabled).length} active step(s)</div>`;
    B.innerHTML = `<div class="tiles">
        ${tile(fmt(fin.rows.length), 'rows out')}
        ${tile(fin.columns.length, 'columns')}
        ${tile(fmt(fin.meta.missingTotal), 'empty cells')}
        ${tile((dr >= 0 ? '−' : '+') + fmt(Math.abs(dr)), 'rows vs source')}
      </div>
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <button class="btn primary" id="inspDlCsv" style="flex:1;justify-content:center">${ic('download',14)} Clean CSV</button>
        <button class="btn" id="inspViewCode" style="flex:1;justify-content:center">${ic('code',14)} Python</button>
      </div>
      <div class="hintbox">Export the result as CSV, or take the generated pandas script and run it anywhere — the notebook becomes your pipeline.</div>`;
    $('#inspDlCsv').onclick = exportCSV;
    $('#inspViewCode').onclick = () => setTab('code');
    return;
  }

  /* ---- dataset overview ---- */
  const d = state.data;
  const o0 = state.outputs[0];
  const meta = o0 ? o0.meta : null;
  const warns = (d.warnings || []).filter(w => w.level === 'warn');
  const infos = (d.warnings || []).filter(w => w.level === 'info');
  H.innerHTML = `<div class="ih-t"><span class="ihic">${ic('db',17)}</span>${id === '__src' ? 'Source data' : 'Dataset'}</div>
    <div class="ih-s">${esc(d.name)} · ${esc(d.encoding || 'UTF-8')}${d.delim && d.delim !== ',' ? ' · delimiter “' + esc(d.delim) + '”' : ''}${d.bytes ? ' · ' + fmtBytes(d.bytes) : ''}</div>`;
  let html = `<div class="tiles">
      ${tile(fmt(d.rows.length), 'rows')}
      ${tile(d.columns.length, 'columns')}
      ${meta ? tile(fmt(meta.missingTotal), 'empty cells') : ''}
      ${meta && meta.dupCount != null ? tile(fmt(meta.dupCount), 'duplicate rows') : ''}
    </div>`;
  if (warns.length || infos.length){
    html += '<div class="seclab">Import quality report</div><div class="qlist">';
    for (const w of [...warns, ...infos])
      html += `<div class="qitem ${w.level}">${ic(w.level === 'warn' ? 'alert' : 'info', 13)}<span>${esc(w.msg)}</span></div>`;
    html += '</div>';
  }
  if (meta) html += `<div class="seclab">Column profile</div>${profileHTML(meta, d.columns, d.rows.length)}`;
  html += `<div class="hintbox" style="margin-top:14px">
      ${d.persisted === false ? '<b>Storage:</b> ' + esc(d.persistNote || 'not persisted') + ' — the pipeline is still autosaved.<br><br>' : ''}
      Click a step on the canvas to configure it, or add one from the palette. Steps run in order; each node shows its exact effect.</div>`;
  B.innerHTML = html;
}

/* ==================================================================
   PREVIEW — paginated table, step navigation, honest diffing
   ================================================================== */
function viewIdx(){
  if (state.viewStep === 'final') return Math.max(0, state.outputs.length - 1);
  return clamp(state.viewStep, 0, Math.max(0, state.outputs.length - 1));
}
function renderPreview(){
  const meta = $('#pvMeta'), tools = $('#pvTools'), wrap = $('#pvTableWrap');
  const noteL = $('#pvNoteL'), noteR = $('#pvNoteR');
  if (!state.data){
    meta.innerHTML = ''; tools.innerHTML = ''; noteL.textContent = ''; noteR.innerHTML = '';
    wrap.innerHTML = '<div class="empty">Load a dataset and its rows will appear here.</div>';
    return;
  }
  if (!state.outputs.length){
    meta.innerHTML = `<span class="chip comp"><i></i>computing…</span>`;
    tools.innerHTML = ''; noteL.textContent = 'Computing pipeline…'; noteR.innerHTML = '';
    wrap.innerHTML = '';
    return;
  }
  const i = viewIdx(), out = state.outputs[i], src = state.outputs[0];
  const prev = i > 0 ? state.outputs[i-1] : null;
  const label = out.node || i > 0
    ? `Step ${i} · ${esc((state.nodes[i-1] && E.OPS[state.nodes[i-1].type].name) || '?')}`
    : 'Source — ' + esc(state.data.name);

  meta.innerHTML = `${state.computing ? '<span class="chip comp"><i></i>computing…</span>' : ''}
    <button class="navb" id="pvPrev" ${i <= 0 ? 'disabled' : ''} aria-label="Previous step">${ic('chevleft',13)}</button>
    <span class="pvl">${label}${out.muted ? ' <em>bypassed</em>' : (out.error ? ' <em>error</em>' : '')}</span>
    <button class="navb" id="pvNext" ${i >= state.outputs.length - 1 ? 'disabled' : ''} aria-label="Next step">${ic('chevright',13)}</button>`;
  $('#pvPrev').onclick = () => { state.viewStep = Math.max(0, viewIdx() - 1); state.page = 0; renderPreview(); };
  $('#pvNext').onclick = () => { state.viewStep = Math.min(state.outputs.length - 1, viewIdx() + 1); state.page = 0; renderPreview(); };

  const total = out.rows.length, mN = out.meta.missingTotal;
  const dR = total - src.rows.length, dM = mN - src.meta.missingTotal;
  const sg = x => x > 0 ? '+' + fmt(x) : fmt(x);
  const canDiff = i > 0 && out.rowStable && prev;
  tools.innerHTML =
    `<span class="chip"><b>${fmt(total)}</b> rows</span>
     <span class="chip"><b>${out.columns.length}</b> cols</span>
     <span class="chip ${mN ? 'warn' : ''}"><b>${fmt(mN)}</b> empty</span>
     ${out.meta.dupCount != null ? `<span class="chip ${out.meta.dupCount ? 'warn' : ''}"><b>${fmt(out.meta.dupCount)}</b> dup</span>` : ''}
     ${i > 0 ? `<span class="chip dchip">Δ ${sg(dR)} rows · Δ ${sg(dM)} empty vs source</span>` : ''}
     ${canDiff
       ? `<button class="chip tog ${state.compare ? 'on' : ''}" id="tglCmp" aria-pressed="${state.compare}">${ic('eye',12)} changes</button>`
       : (i > 0 ? '<span class="chip dchip">row set changed — cell diff off</span>' : '')}`;

  const maxPage = Math.max(0, Math.ceil(total / PAGE) - 1);
  state.page = clamp(state.page, 0, maxPage);
  const start = state.page * PAGE, end = Math.min(total, start + PAGE);
  const rows = out.rows.slice(start, end);

  let pairMap = null;
  if (canDiff && state.compare){
    pairMap = out.columns.map(c => prev.columns.indexOf(c));
  }
  let h = '<table id="pvTable"><thead><tr><th class="rn">#</th>';
  out.columns.forEach(c => {
    const ty = out.meta.types[c] || 'text';
    const m = out.meta.missingByCol[c] || 0;
    h += `<th>${esc(c)}<span class="ty">${TYGLYPH[ty]}</span>${m ? `<span class="mct">${fmt(m)} empty</span>` : ''}</th>`;
  });
  h += '</tr></thead><tbody>';
  rows.forEach((r, ri) => {
    h += `<tr><td class="rn">${fmt(start + ri + 1)}</td>`;
    const pr = pairMap ? prev.rows[start + ri] : null;
    for (let j = 0; j < out.columns.length; j++){
      const v = r[j];
      const m = v == null || v === '';
      let cls = m ? 'miss' : '';
      if (pr && pairMap && pairMap[j] >= 0){
        const pv = pr[pairMap[j]];
        const pm = pv == null || pv === '';
        if (!m && !pm && String(pv) !== String(v)) cls = 'chg';
        else if (m !== pm) cls = 'chg';
      }
      h += `<td class="${cls}">${m ? '—' : esc(v)}</td>`;
    }
    h += '</tr>';
  });
  h += '</tbody></table>';
  wrap.innerHTML = h;

  noteL.textContent = total === 0 ? '0 rows — every row was filtered out at this step'
    : `${fmt(start + 1)}–${fmt(end)} of ${fmt(total)} rows · ` +
      (canDiff && state.compare ? 'cells that differ from the previous step are marked'
        : (i > 0 ? 'row order/set changed at this step — cell diff not shown' : 'raw import'));
  noteR.innerHTML =
    `<button class="pgbtn" id="pgF" ${state.page === 0 ? 'disabled' : ''} aria-label="First page">${ic('chevleft',11)}${ic('chevleft',11)}</button>
     <button class="pgbtn" id="pgP" ${state.page === 0 ? 'disabled' : ''} aria-label="Previous page">${ic('chevleft',12)}</button>
     <span class="pglab">page ${fmt(state.page + 1)} / ${fmt(maxPage + 1)}</span>
     <button class="pgbtn" id="pgN" ${state.page >= maxPage ? 'disabled' : ''} aria-label="Next page">${ic('chevright',12)}</button>
     <button class="pgbtn" id="pgL" ${state.page >= maxPage ? 'disabled' : ''} aria-label="Last page">${ic('chevright',11)}${ic('chevright',11)}</button>`;
  $('#pgF').onclick = () => { state.page = 0; renderPreview(); };
  $('#pgP').onclick = () => { state.page = Math.max(0, state.page - 1); renderPreview(); };
  $('#pgN').onclick = () => { state.page = Math.min(maxPage, state.page + 1); renderPreview(); };
  $('#pgL').onclick = () => { state.page = maxPage; renderPreview(); };
}

/* ==================================================================
   CODE GENERATION — pandas, parity-corrected
   ================================================================== */
const PY_NUM_HELPER = [
  'def _sieve_num(s):',
  '    """Numeric coercion matching the app: strips $ and spaces, resolves EU decimal commas."""',
  '    t = s.astype("string").str.replace(r"[$\\s\\u00A0\']", "", regex=True)',
  '    has_c = t.str.contains(",", na=False)',
  '    has_d = t.str.contains(".", na=False, regex=False)',
  '    eu = has_c & has_d & (t.str.rfind(",") > t.str.rfind("."))',
  '    t = t.mask(eu, t.str.replace(".", "", regex=False).str.replace(",", ".", regex=False))',
  '    grp = has_c & ~has_d & t.str.match(r"^[-+]?\\d{1,3}(,\\d{3})+$")',
  '    t = t.mask(grp, t.str.replace(",", "", regex=False))',
  '    t = t.mask(has_c & ~has_d & ~grp, t.str.replace(",", ".", regex=False))',
  '    return pd.to_numeric(t, errors="coerce")'
];
const PY_STR_HELPER = [
  'def _sieve_str(x):',
  '    """Stringify matching the app (whole floats print without a trailing .0)."""',
  '    if pd.isna(x):',
  '        return x',
  '    if isinstance(x, float) and x.is_integer():',
  '        return str(int(x))',
  '    return str(x)'
];
function genCode(){
  const d = state.data;
  const base = d.name.replace(/\.[^.]*$/, '').replace(/[^\w.-]/g, '_');
  const en = state.nodes.filter(n => n.enabled);
  const L = [];
  L.push('"""',
         `${base}_clean — pipeline generated by Sieve`,
         `Source: ${d.name} · ${en.length} transformation step${en.length === 1 ? '' : 's'} · ${new Date().toISOString().slice(0,10)}`,
         'Emitted to mirror the in-app engine: numeric coercion, ordering and',
         'rounding below match what you previewed in the studio.',
         '"""', '',
         'import pandas as pd');
  if (en.some(n => n.type === 'one-hot')) L.push('import re');
  L.push('', `df = pd.read_csv(${py(d.name)})`, '');
  const needNum = en.some(n => n._hint && n._hint.num);
  const needStr = en.some(n => n._hint && n._hint.str);
  if (needNum) L.push(...PY_NUM_HELPER, '');
  if (needStr) L.push(...PY_STR_HELPER, '');
  if (!en.length) L.push('# no steps yet — add transformations in Sieve', '');
  en.forEach((n, i) => {
    const op = E.OPS[n.type];
    if (!op){
      L.push(`# Step ${i+1} · unknown operation "${n.type}" skipped — remove it in the app`, '');
      return;
    }
    L.push(`# Step ${i+1} · ${op.name}`);
    if (n._err) L.push(`# NOTE: this step reported "${n._err}" in the app — fix it there or review before running.`);
    const ctx = { columns: n._inColumns && n._inColumns.length ? n._inColumns : d.columns,
                  types: n._inTypes || {} };
    L.push(...op.code(ctx, n.params, n._hint), '');
  });
  const off = state.nodes.filter(n => !n.enabled);
  if (off.length) L.push(`# Bypassed in the app (not emitted): ${off.map(n => E.OPS[n.type].name).join(', ')}`, '');
  L.push(`df.to_csv("${base}_clean.csv", index=False)`, '',
         'print(f"clean dataset: {df.shape[0]} rows x {df.shape[1]} columns")');
  return L.join('\n');
}
function highlightPy(src){
  const escd = src.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const re = /(#[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\.[A-Za-z_]\w*(?=\())|\b(import|from|as|print|def|return|if|else|elif|for|in|not|and|or|try|except|None|True|False)\b|\b(\d+(?:\.\d+)?)\b/g;
  const colored = escd.replace(re, (m, com, str, meth, kw, num) => {
    if (com)  return `<span class="tk-c">${com}</span>`;
    if (str)  return `<span class="tk-s">${str}</span>`;
    if (meth) return `<span class="tk-m">${meth}</span>`;
    if (kw)   return `<span class="tk-k">${kw}</span>`;
    if (num)  return `<span class="tk-n">${num}</span>`;
    return m;
  });
  let doc = false;
  return colored.split('\n').map((line, i) => {
    const t = line.trim();
    if (t.startsWith('"""')) doc = !doc;
    const body = doc ? `<span class="tk-s">${line}</span>` : line;
    return `<div class="cl"><span class="ln">${i+1}</span><span class="lc">${body || ' '}</span></div>`;
  }).join('');
}
function renderCode(){
  if (!state.data){ $('#codePre').innerHTML = '<div class="empty" style="color:#84795C">Load a dataset to generate code.</div>'; return; }
  state.code = genCode();
  $('#codeName').textContent = state.data.name.replace(/\.[^.]*$/, '').replace(/[^\w.-]/g, '_') + '_clean.py';
  $('#codePre').innerHTML = highlightPy(state.code);
}

/* ==================================================================
   EXPORTS — injection-guarded CSV, .py download, clipboard
   ================================================================== */
function downloadBlob(name, blob){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function exportCSV(){
  const fin = state.outputs[state.outputs.length - 1];
  if (!state.data || !fin){ toast('Load a dataset first', 'alert'); return; }
  const cols = fin.columns;
  let guards = 0;
  const cell = v => {
    let s = v == null ? '' : String(v);
    if (s !== '' && (/^[=+@\t\r]/.test(s) || /^-(?![.\d])/.test(s))){ s = "'" + s; guards++; }
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const parts = [cols.map(cell).join(',')];
  const CH = 20000;
  for (let i = 0; i < fin.rows.length; i += CH){
    parts.push('\n' + fin.rows.slice(i, i + CH).map(r => cols.map((_, j) => cell(r[j])).join(',')).join('\n'));
  }
  const base = state.data.name.replace(/\.[^.]*$/, '');
  downloadBlob(base + '_clean.csv', new Blob(parts, { type:'text/csv' }));
  toast(`Exported ${fmt(fin.rows.length)} clean rows` + (guards ? ` · ${guards} cell(s) escaped for spreadsheet safety` : ''), 'download');
}
function exportCode(){
  if (!state.data){ toast('Load a dataset first', 'alert'); return; }
  renderCode();
  const base = state.data.name.replace(/\.[^.]*$/, '').replace(/[^\w.-]/g, '_');
  downloadBlob(base + '_clean.py', new Blob([state.code], { type:'text/x-python' }));
  setTab('code');
  toast('Python script exported', 'code');
}
async function copyText(t){
  try { await navigator.clipboard.writeText(t); return true; }
  catch(e){
    try {
      const ta = document.createElement('textarea');
      ta.value = t; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.append(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch(e2){ return false; }
  }
}

/* ==================================================================
   SAMPLE DATA (real, deliberately messy — run through the same engine)
   ================================================================== */
const SAMPLES = [
  { key:'hr', file:'hr_employees.csv', rows:26, cols:8,
    desc:'Personnel records: mixed-case text, padded names, missing salaries & ages, three date formats, duplicate entries.',
    csv:`employee_id,name,department,salary,age,join_date,email
E001,  john SMITH ,Engineering,72000,34,2021-03-14,JOHN.SMITH@ACME.COM
E002,AMIRA HASSAN,engineering ,68500,29,2020-11-02,amira.hassan@acme.com
E003,sofia reyes,HR,,31,2019-06-17,sofia.reyes@acme.com
E004,DANIEL OSELKA,Sales,54000,41,2018-01-25,d.oselka@acme.com
E005,Priya Natarajan,Engineering,81000,,2022-08-30,priya.n@acme.com
E006,  li WEI  ,hr,47000,26,14/03/2021,li.wei@acme.com
E007,Carlos Mendez,Sales,58200,38,March 3 2019,carlos.m@acme.com
E008,HANNA PETTERSEN,Sales,,45,2017-09-12,hanna.p@acme.com
E009,omar farouk,Engineering,76500,33,2023-02-19,omar.f@acme.com
E010,GRACE LEE,Engineering,79500,27,2022-04-04,grace.lee@acme.com
E010,GRACE LEE,Engineering,79500,27,2022-04-04,grace.lee@acme.com
E011,Victor Okafor,HR,45500,,January 9 2020,v.okafor@acme.com
E012,Mei Ling,sales,61250,36,2021-12-01,mei.ling@acme.com
E013,  ana CLARA  , Sales ,53800,52,2016-05-23,ana.clara@acme.com
E014,Tomas Vagner,Engineering,88000,30,2023-07-11,tomas.v@acme.com
E015,LEILA AMARI,hr,44200,24,2019-10-08,leila.a@acme.com
E016,Boris Ivanov,Sales,159500,39,2018-03-19,boris.i@acme.com
E017,Nadia Rahman,Engineering,,28,2024-01-15,nadia.r@acme.com
E018,PETER HOLM,sales,57300,48,2017-06-02,peter.holm@acme.com
E019,Yuki Tanaka,Engineering,74800,31,2020-02-14,yuki.t@acme.com
E020,Fatima Zahra,HR,43900,,2022-10-21,fatima.z@acme.com
E021,Oliver Brandt,Engineering,77000,35,2019-12-16,oliver.b@acme.com
E021,Oliver Brandt,Engineering,77000,35,2019-12-16,oliver.b@acme.com
E022,Camila Duarte,sales,59900,29,2021-04-27,camila.d@acme.com
E023,Jonas Weber,Engineering,83500,,2018-08-05,jonas.w@acme.com
E024,Rutu Shah,hr,46100,27,11/08/2020,rutu.shah@acme.com` },
  { key:'sales', file:'sales_orders.csv', rows:23, cols:8,
    desc:'Order export: inconsistent regions & categories, missing quantity or price, an extreme order, duplicate rows.',
    csv:`order_id,order_date,customer,region,category,product,quantity,unit_price
1001,2023-01-14,Acme Corp,North,electronics,Wireless Mouse,12,24.5
1002,01/22/2023, Gamma Ltd ,north ,Electronics,USB-C Hub,4,42
1003,2023-02-03,Bob & Sons,South,furniture,Desk Lamp,7,35.99
1004,2023-02-17,Acme Corp,north,Electronics,WIRELESS MOUSE,9,24.5
1005,March 2 2023,Delta Co,SOUTH,Furniture,Office Chair,2,189.9
1006,2023-03-11,Epsilon AB,West,electronics,Monitor 27",3,,
1007,2023-03-19,Gamma Ltd,west,stationery,Notebook Pack,20,6.75
1008,04/02/2023,Bob & Sons,south,furniture,Desk Lamp,7,35.99
1009,2023-04-21,Zenith LLC,East,Stationery,Pen Set ,15,12.3
1010,2023-05-06,Acme Corp,north,Electronics,Monitor 27",5,229
1011,2023-05-18,Delta Co,south,Furniture,Standing Desk,,549
1012,2023-06-02,Zenith LLC,east,electronics,Webcam HD,8,59.99
1013,2023-06-25,Epsilon AB,west,Stationery,notebook pack,20,6.75
1014,2023-07-08,Gamma Ltd,North,Electronics,USB-C Hub,4,42
1015,2023-07-30,Bob & Sons,SOUTH,Furniture,Office Chair,1,189.9
1016,08/15/2023,Acme Corp,north,Electronics,Webcam HD,6,59.99
1017,2023-09-03,Hover Inc,East,stationery,Pen Set,15,12.3
1018,2023-09-27,Zenith LLC,west,Electronics,Laptop Stand,10,49.5
1019,2023-10-12,Delta Co,south,Furniture,Standing Desk,2,549
1020,2023-11-01,Epsilon AB,west,Electronics,4K Monitor,3,1240
1021,2023-11-22,Gamma Ltd,north,Stationery,Notebook Pack,20,6.75
1022,2023-12-09,Acme Corp,north,Electronics,Wireless Mouse,12,24.5
1007,2023-03-19,Gamma Ltd,west,stationery,Notebook Pack,20,6.75` }
];
const PRESETS = {
  hr: [
    ['clean-text', { column:'department', trim:true, collapse:true, case:'lower', punct:false }],
    ['fill-missing', { column:'age', method:'median', value:'' }],
    ['drop-duplicates', { keep:'first' }]
  ],
  sales: [
    ['clean-text', { column:'region', trim:true, collapse:true, case:'lower', punct:false }],
    ['fill-missing', { column:'quantity', method:'median', value:'' }],
    ['drop-duplicates', { keep:'first' }]
  ]
};
/* ---- task-based pipeline presets (applied to the current dataset) ---- */
const PIPELINE_PRESETS = [
  { key:'quick', name:'Quick Clean', icon:'sparkle',
    desc:'Tidy text, fill gaps, drop duplicates.',
    steps:[['clean-text', {}], ['fill-missing', {}], ['drop-duplicates', {}]] },
  { key:'fill-gaps', name:'Fill Missing Values', icon:'droplet',
    desc:'Fill empty cells with median (numeric) or mode.',
    steps:[['fill-missing', {}]] },
  { key:'drop-empty', name:'Drop Empty Rows', icon:'ban',
    desc:'Remove rows that contain empty cells.',
    steps:[['drop-missing', { column:'__all__' }]] },
  { key:'dedupe', name:'Remove Duplicates', icon:'copy',
    desc:'Remove repeated rows, keep first.',
    steps:[['drop-duplicates', { keep:'first' }]] },
  { key:'sort', name:'Sort Rows', icon:'sort',
    desc:'Order rows by the first column, A → Z.',
    steps:[['sort-rows', { dir:'asc' }]] },
  { key:'tidy-text', name:'Clean Text', icon:'type',
    desc:'Trim spaces, single-space, lowercase.',
    steps:[['clean-text', { trim:true, collapse:true, case:'lower', punct:false }]] }
];

/* ==================================================================
   DATASET LOADING
   ================================================================== */
function hideWelcome(){ $('#welcome').hidden = true; }
function setBusy(b, name){
  $('#btnUpload').disabled = b;
  $('#dsChip').innerHTML = b
    ? `${ic('file',14)}<b>reading ${esc(name || 'file')}…</b>`
    : (state.data ? `${ic('file',14)}<b>${esc(state.data.name)}</b><span>${fmt(state.data.rows.length)} rows × ${state.data.columns.length} cols</span>`
                  : `${ic('file',14)}<b>no dataset</b>`);
}
function updateChip(){
  $('#dsChip').innerHTML = state.data
    ? `${ic('file',14)}<b>${esc(state.data.name)}</b><span>${fmt(state.data.rows.length)} rows × ${state.data.columns.length} cols</span>`
    : `${ic('file',14)}<b>no dataset</b>`;
}
function applyDataset(name, parsed, encoding, bytes, file){
  state.data = { name, columns: parsed.columns, rows: parsed.rows, warnings: parsed.warnings || [], encoding, delim: parsed.delim, bytes, file: file || null };
  state.selected = null; state.viewStep = 'final'; state.page = 0;
  state.outputs = [];
  histReset(); pushHist('loaded data');
  requestRun(0);
  persistDataset();
  hideWelcome();
  updateChip();
  if (!state.nodes.length) fitView();
  renderNodes(); renderInspector(); renderPreview(); renderCode();
  const w = (parsed.warnings || []).filter(x => x.level === 'warn').length;
  toast(`${name}: ${fmt(parsed.rows.length)} rows × ${parsed.columns.length} cols` + (w ? ` · ${w} quality warning${w > 1 ? 's' : ''} — see the inspector` : ''), w ? 'alert' : 'table');
}
async function readFile(file){
  if (!file) return;
  if (file.size > 120 * 1024 * 1024){ toast('File is larger than 120 MB — split it or sample it first', 'alert'); return; }
  setBusy(true, file.name);
  try {
    const r = await engineParseFile(file);
    applyDataset(file.name, r.res, r.encoding || 'UTF-8', file.size, file);
    backendMirrorUpload(file);
  } catch(err){ toast('Could not parse “' + file.name + '”: ' + err.message, 'alert'); }
  finally { setBusy(false); }
}
async function loadSample(key){
  const s = SAMPLES.find(x => x.key === key);
  if (!s) return;
  setBusy(true, s.file);
  try {
    const parsed = await engineParseText(s.csv);
    state.nodes = (PRESETS[key] || []).map(([type, params]) => {
      const n = makeNode(type);
      Object.assign(n.params, params);
      return n;
    });
    state.selected = null; state.viewStep = 'final';
    applyDataset(s.file, parsed, 'UTF-8', s.csv.length);
    arrange(); fitView();
    if (!(RM && RM.matches)) setTimeout(playRun, 350);
  } catch(err){ toast('Could not load demo: ' + err.message, 'alert'); }
  finally { setBusy(false); }
}
function applyPipelinePreset(key){
  const p = PIPELINE_PRESETS.find(x => x.key === key);
  if (!p) return;
  if (!state.data){ toast('Load a dataset first — upload a CSV or open a demo', 'alert'); return; }
  const cols = state.outputs.length
    ? state.outputs[state.outputs.length - 1].columns
    : state.data.columns;
  if (!cols || !cols.length){ toast('No columns in the current dataset', 'alert'); return; }
  const from = state.nodes.length;
  const anchor = from ? state.nodes[from - 1] : null;
  let px = anchor ? anchor.x : state.srcPos.x;
  let py = anchor ? anchor.y : state.srcPos.y;
  const newNodes = [];
  for (const [type, override] of p.steps){
    if (!E.OPS[type]) continue;
    const n = makeNode(type);
    Object.assign(n.params, override || {});
    try {
      const schema = E.OPS[type].schema || [];
      const colField = schema.find(f => f.t === 'column');
      if (colField && (!n.params[colField.k] || !cols.includes(n.params[colField.k]))){
        let pick = '';
        try { pick = firstSuitableColumn(type, n.params, cols); } catch(e){ pick = ''; }
        if (type === 'fill-missing' && !pick){
          n.params.method = 'mode';
          pick = cols[0] || '';
        }
        n.params[colField.k] = pick || cols[0] || '';
      }
      if (type === 'sort-rows' && !n.params.column) n.params.column = cols[0] || '';
    } catch(e){ /* keep defaults; engine will surface a per-node error */ }
    if (!newNodes.length) {
      if (!from) { n.x = state.srcPos.x + 300; n.y = state.srcPos.y; }
      else { n.x = px + 300; n.y = py; if (n.x > 2300){ n.x = 60; n.y = py + 180; } }
    } else {
      const prev = newNodes[newNodes.length - 1];
      n.x = prev.x + 300; n.y = prev.y;
      if (n.x > 2300){ n.x = 60; n.y = prev.y + 180; }
    }
    newNodes.push(n);
  }
  if (!newNodes.length) return;
  state.nodes.push(...newNodes);
  const lastNew = newNodes[newNodes.length - 1];
  state.outPos = { x: lastNew.x + 300, y: lastNew.y };
  state.selected = newNodes[0].id;
  state.viewStep = state.nodes.indexOf(newNodes[0]) + 1;
  requestRun(from);
  renderNodes(); renderInspector(); renderPreview(); renderCode();
  pushHist('applied preset ' + p.name);
  const pop = $('#popSample'); if (pop) pop.hidden = true;
  toast(p.name + ' applied — ' + newNodes.length + ' step(s)', 'check');
}
async function resetWorkspace(){
  try { await idbDel('dataset'); } catch(e){}
  try { localStorage.removeItem(LS_KEY); } catch(e){}
  try { localStorage.removeItem('sieve.sessionId'); } catch(e){}
  location.reload();
}

/* ==================================================================
   SELF-TESTS — fixture suite over the real engine (console + toast)
   ================================================================== */
function runSelfTests(){
  const out = [];
  const t = (name, got, want) => out.push({
    test: name,
    pass: Object.is(got, want) || JSON.stringify(got) === JSON.stringify(want),
    got: JSON.stringify(got), expected: JSON.stringify(want)
  });
  t('numify EU decimal', E.numify('1.234,56'), 1234.56);
  t('numify currency', E.numify('$1,200'), 1200);
  t('numify thousands', E.numify('12,345'), 12345);
  t('numify comma decimal', E.numify('3,14'), 3.14);
  t('numify text is NaN', Number.isNaN(E.numify('abc')), true);
  const p1 = E.parseCSVText('name,note\n"Smith, John",ok\n"say ""hi""",x\n');
  t('csv quoted comma', p1.rows[0], ['Smith, John', 'ok']);
  t('csv escaped quote', p1.rows[1][0], 'say "hi"');
  const p2 = E.parseCSVText('a,a\n1,2\n');
  t('duplicate header renamed', p2.columns, ['a', 'a_2']);
  const p3 = E.parseCSVText('a,b,c\n1,2\n');
  t('short row padded', p3.rows[0], ['1', '2', '']);
  t('short row warns', p3.warnings.some(w => w.level === 'warn'), true);
  t('date month name', E.parseDate('March 3 2019'), '2019-03-03');
  t('date day-first', E.parseDate('14/03/2021'), '2021-03-14');
  t('date invalid day rejected', E.parseDate('31/02/2021'), null);
  const clipped = E.OPS['remove-outliers'].run({ columns:['v'], rows:[[10],[20],[30],[40],[1000]] }, { column:'v', action:'clip' });
  t('outlier clip at IQR fence', clipped.rows[4][0], 70);
  const filled = E.OPS['fill-missing'].run({ columns:['v'], rows:[['1'],[''],['3'],['5'],['']] }, { column:'v', method:'median', value:'' });
  t('fill median', [filled.rows[1][0], filled.rows[4][0]], [3, 3]);
  const dd = E.OPS['drop-duplicates'].run({ columns:['a','b'], rows:[[1,'x'],[2,'y'],[1,'x']] }, { keep:'last' });
  t('dedupe keep-last order', dd.rows, [[2,'y'],[1,'x']]);
  const fr = E.OPS['filter-rows'].run({ columns:['v'], rows:[['5'],['abc'],['7'],['']] }, { column:'v', op:'>', value:'4' });
  t('filter numeric skips text/empty', fr.rows, [['5'],['7']]);
  const oh = E.OPS['one-hot'].run({ columns:['c','x'], rows:[['a',1],['b',2],['',3]] }, { column:'c' });
  t('one-hot column names', oh.columns, ['c','x','c_a','c_b']);
  t('one-hot missing → zeros', oh.rows[2], ['', 3, 0, 0]);
  let threw = false;
  try { E.OPS['rename-columns'].run({ columns:['a','b'], rows:[] }, { map:{ a:'b' } }); } catch(e){ threw = true; }
  t('rename duplicate rejected', threw, true);
  const rr = E.runFrom({ columns:['v'], rows:[['1'],['2']] }, [{ type:'sort-rows', enabled:true, params:{ column:'v', dir:'desc' } }]);
  t('engine run returns outputs', rr.outputs.length, 1);
  t('engine sort desc', rr.outputs[0].rows, [['2'],['1']]);
  const dis = E.runFrom({ columns:['v'], rows:[['1']] }, [{ type:'nope-op', enabled:true, params:{} }]);
  t('unknown op isolates error', !!dis.results[0].err, true);

  const fails = out.filter(x => !x.pass);
  console.table(out.map(({test, pass, got, expected}) => ({ test, pass, got, expected })));
  toast(fails.length
    ? `Self-checks: ${out.length - fails.length}/${out.length} passed — details in console`
    : `All ${out.length} self-checks passed`, fails.length ? 'alert' : 'check');
  return out;
}
window.Sieve = { runSelfTests, state, E };  // debug handle

/* ==================================================================
   CHROME — palette, tabs, header, DnD, keyboard, errors, boot
   ================================================================== */
const GROUPS = ['Missing Data','Rows','Values','Text & Types','Structure','Categories','Numbers','Dates'];
function buildPalette(){
  const host = $('#palList');
  for (const g of GROUPS){
    host.append(elDiv('pgroup', g));
    for (const [type, op] of Object.entries(E.OPS)){
      if (op.group !== g) continue;
      const b = document.createElement('button');
      b.className = 'pg';
      b.setAttribute('aria-label', `${op.name} — ${op.blurb}`);
      b.innerHTML = `<span class="pic">${ic(op.icon,15)}</span><span><b>${esc(op.name)}</b><i>${esc(op.blurb)}</i></span>`;
      b.onclick = () => addNode(type);
      host.append(b);
    }
  }
}
function setTab(tab){
  state.tab = tab;
  $$('.btab').forEach(b => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  $('#pvWrap').hidden = tab !== 'preview';
  $('#codeView').hidden = tab !== 'code';
  $('#pvMeta').style.visibility = tab === 'preview' ? 'visible' : 'hidden';
}
function buildSamplesPop(){
  const pop = $('#popSample');
  pop.innerHTML = `<div class="ps-h">Presets — one-click pipelines for common tasks</div>` + PIPELINE_PRESETS.map(p =>
    `<button class="samp" data-k="${p.key}">
      <span class="spic">${ic(p.icon || 'layers',16)}</span>
      <span style="min-width:0"><b>${esc(p.name)}</b><i>${esc(p.desc)}</i><u>${p.steps.length} step${p.steps.length === 1 ? '' : 's'} · applies to current data</u></span>
    </button>`).join('');
  pop.querySelectorAll('.samp').forEach(b => b.onclick = () => { pop.hidden = true; applyPipelinePreset(b.dataset.k); });
  $('#btnSamples').onclick = e => { e.stopPropagation(); pop.hidden = !pop.hidden; };
  document.addEventListener('pointerdown', e => {
    if (!pop.hidden && !e.target.closest('#popSample') && !e.target.closest('#btnSamples')) pop.hidden = true;
  });
}
/* ---- responsive drawers (≤900px): palette/inspector become overlays ----
   No-ops on desktop where the buttons are hidden and the query never matches. */
function isMobileView(){
  return !!(window.matchMedia && matchMedia('(max-width: 900px)').matches);
}
function setDrawer(which){
  document.body.classList.toggle('show-pal', which === 'pal');
  document.body.classList.toggle('show-insp', which === 'insp');
}
function initChrome(){
  $('#btnSamples').innerHTML = ic('layers',14) + ' Presets ' + ic('chevdown',12);
  $('#btnPalette').innerHTML = ic('plus',14) + ' Steps';
  $('#btnPalette').onclick = () => setDrawer(document.body.classList.contains('show-pal') ? null : 'pal');
  $('#btnInspector').innerHTML = ic('columns',14) + ' Inspector';
  $('#btnInspector').onclick = () => setDrawer(document.body.classList.contains('show-insp') ? null : 'insp');
  $('#btnUpload').innerHTML  = ic('upload',14) + ' Upload CSV';
  $('#btnBackend').innerHTML   = ic('db',14) + ' Local-only';
  $('#btnBackend').onclick = backendConfigure;
  $('#btnReset').innerHTML   = ic('trash',14) + ' Reset';
  $('#btnKeys').innerHTML    = ic('question',15);
  $('#btnExportCsv').innerHTML  = ic('download',14) + ' Clean CSV';
  $('#btnExportCode').innerHTML = ic('code',14) + ' Python Code';
  $('#btnRun').innerHTML   = ic('play',13) + '<span>Replay</span>';
  $('#btnUndo').innerHTML  = ic('undo',14);
  $('#btnRedo').innerHTML  = ic('redo',14);
  $('#btnTidy').innerHTML  = ic('grid',14);
  $('#btnFit').innerHTML   = ic('fit',14);
  $('#btnZin').innerHTML   = ic('zin',14);
  $('#btnZout').innerHTML  = ic('zout',14);
  $('#btnClear').innerHTML = ic('trash',13) + '<span>Clear steps</span>';
  $('#btnCopyCode').innerHTML = ic('copy',13) + ' Copy';
  $('#btnDlCode').innerHTML   = ic('download',13) + ' .py';
  $('#wUpload').innerHTML = ic('upload',14) + ' Upload CSV';
  $('#wSample').innerHTML = ic('table',14) + ' Try a demo dataset';
  $('#startHintIc').innerHTML = ic('arrowr',14);
  $$('.btab')[0].innerHTML = ic('table',14) + ' Data Preview';
  $$('.btab')[1].innerHTML = ic('code',14) + ' Generated Code';
  document.querySelectorAll('#welcome .ic[data-ic]').forEach(s => { s.outerHTML = ic(s.dataset.ic, 14); });

  $('#btnUpload').onclick = () => $('#fileInput').click();
  $('#wUpload').onclick   = () => $('#fileInput').click();
  $('#wSample').onclick   = () => loadSample('hr');
  $('#fileInput').onchange = e => { if (e.target.files[0]) readFile(e.target.files[0]); e.target.value = ''; };
  $('#btnExportCsv').onclick = exportCSV;
  $('#btnExportCode').onclick = exportCode;
  $('#btnCopyCode').onclick = async () => {
    const ok = await copyText(state.code);
    toast(ok ? 'Python code copied to clipboard' : 'Clipboard blocked by the browser', ok ? 'copy' : 'alert');
  };
  $('#btnDlCode').onclick = exportCode;
  $$('.btab').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  $('.btabs').addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const tabs = $$('.btab'), i = tabs.findIndex(b => b.dataset.tab === state.tab);
    const nx = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    setTab(nx.dataset.tab); nx.focus();
  });
  $('#pvTools').addEventListener('click', e => {
    if (e.target.closest('#tglCmp')){ state.compare = !state.compare; renderPreview(); }
  });

  let rstArmed = false, rstTmr;
  $('#btnReset').onclick = () => {
    if (!rstArmed){
      rstArmed = true; $('#btnReset').classList.add('danger');
      $('#btnReset').innerHTML = ic('alert',14) + ' Sure?';
      rstTmr = setTimeout(() => { rstArmed = false; $('#btnReset').classList.remove('danger'); $('#btnReset').innerHTML = ic('trash',14) + ' Reset'; }, 2400);
    } else {
      clearTimeout(rstTmr); resetWorkspace();
    }
  };

  const dlg = $('#dlgKeys');
  $('#btnKeys').onclick = () => dlg.showModal();
  $('#btnOkKeys').onclick = () => dlg.close();
  $('#btnCloseKeys').onclick = () => dlg.close();
  $('#btnSelfTest').onclick = () => runSelfTests();
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

  const ov = $('#dropOverlay');
  ['dragover','dragenter'].forEach(ev => window.addEventListener(ev, e => {
    e.preventDefault();
    if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) ov.style.display = 'grid';
  }));
  window.addEventListener('dragleave', e => { if (!e.relatedTarget) ov.style.display = 'none'; });
  window.addEventListener('drop', e => {
    e.preventDefault(); ov.style.display = 'none';
    const f = e.dataTransfer.files[0]; if (f) readFile(f);
  });

  window.addEventListener('keydown', e => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z'){ e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y'){ e.preventDefault(); redo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter'){ e.preventDefault(); requestRun(0); playRun(); return; }
    if (typing) return;
    if (e.key === '?' ){ e.preventDefault(); dlg.showModal(); return; }
    if (e.key === '+' || e.key === '='){ const r = $('#viewport').getBoundingClientRect(); zoomAt(r.width/2, r.height/2, 1.18); return; }
    if (e.key === '-'){ const r = $('#viewport').getBoundingClientRect(); zoomAt(r.width/2, r.height/2, 1/1.18); return; }
    if (e.key === '0'){ fitView(); return; }
    if (e.key === 'Escape'){
      if (document.body.classList.contains('show-pal') || document.body.classList.contains('show-insp')){ setDrawer(null); return; }
      if (!$('#popSample').hidden) $('#popSample').hidden = true;
    }
  });

  let lastErr = 0;
  const softErr = msg => { const now = Date.now(); if (now - lastErr > 4000){ lastErr = now; toast('Unexpected error: ' + msg, 'alert'); } };
  window.addEventListener('error', e => softErr(e.message));
  window.addEventListener('unhandledrejection', e => softErr((e.reason && e.reason.message) || String(e.reason)));
  window.addEventListener('beforeunload', () => { if (persistTimer) persistNow(); });
  // Rotating back to desktop with a drawer open would strand an overlay
  // class on a layout that no longer uses it — clear on the way out.
  window.addEventListener('resize', debounce(() => { if (!isMobileView()) setDrawer(null); }, 150));
}

/* ---- boot: restore saved workspace or show welcome ---- */
async function boot(){
  buildPalette();
  buildSamplesPop();
  initChrome();
  backend.base = getApiBase();
  renderBackendBtn();
  if (backend.base) backendCheck(true);
  initCanvasEvents();
  updateChip();
  updateSaveChip('');
  applyView(); zoomLab();

  let ds = null;
  try { ds = await idbGet('dataset'); } catch(e){}
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch(e){}

  if (ds && ds.columns && ds.rows){
    state.data = { name: ds.name, columns: ds.columns, rows: ds.rows, warnings: ds.warnings || [],
                   encoding: ds.encoding || 'UTF-8', delim: ds.delim, bytes: ds.bytes, persisted: true };
    if (saved && Array.isArray(saved.nodes)){
      state.nodes = saved.nodes.filter(x => E.OPS[x.type]).map(x => {
        const n = makeNode(x.type);
        n.enabled = x.enabled !== false;
        n.params = x.params || n.params;
        const pos = asXY(x, { x: 0, y: 0 });
        n.x = pos.x; n.y = pos.y;
        return n;
      });
      if (saved.srcPos) state.srcPos = asXY(saved.srcPos, { x: 40, y: 120 });
      if (saved.outPos) state.outPos = asXY(saved.outPos, { x: 340, y: 120 });
    }
    hideWelcome();
    requestRun(0);
    updateChip(); renderNodes(); renderInspector(); renderPreview(); renderCode();
    if (saved && saved.view){ Object.assign(view, saved.view); applyView(); zoomLab(); }
    else fitView();
    updateSaveChip('saved');
    toast(`Restored your workspace — ${ds.name} (${fmt(ds.rows.length)} rows)`, 'check');
  } else {
    try { localStorage.removeItem(LS_KEY); } catch(e){}
    $('#welcome').hidden = false;
    renderInspector();
  }
}
boot();
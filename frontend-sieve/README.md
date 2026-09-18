# Sieve — local-first data-cleaning frontend

Static app. No build step, no backend, no network calls
(`connect-src 'none'`). ES modules require http(s) — open via any static
server, not `file://` (module CORS), e.g. `npx serve .`.

## Deploy (Vercel, separate preview project)

1. Add New → Project → import this repo (new project, e.g.
   `dataflow-sieve-preview` — do NOT reuse the production project yet).
2. Root Directory: `frontend-sieve`
3. Framework Preset: Other
4. Build Command: none (empty) · Output Directory: `.` (default)
5. No environment variables.

## Structure

- `index.html` — shell + markup (imports `styles.css`, `app.js` module)
- `styles.css` — full theme
- `engine.js` — pure engine (`EngineFactory`, `py`); imports cleanly in
  node, stringifies into the Web Worker unchanged
- `app.js` — state, canvas, inspector, preview, exports, boot
- `tests/parity-run.mjs` — backend parity runner (dev only, excluded
  from deploys via `.vercelignore`)
- `tests/engine.test.mjs` — unit tests, zero deps

## Tests

- `node --test tests/engine.test.mjs` from this directory (9 checks:
  hint convention, sort direction/ties, one-hot run + codegen).
- Backend parity: `pytest tests/test_sieve_parity.py` from `backend/`
  (25k-row messy corpus, cell-for-cell vs the FastAPI engine).

## Conventions (learned the hard way)

- Op `hint` functions take `(data, params, meta)` positionally — the
  runner calls `hint(inD, n.params, inMeta)`. Single-arg hints silently
  read the dataset as params and return null, which drops `_sieve_num` /
  `_sieve_str` helpers from exported scripts. Locked by test.
- `sort-rows` direction lives in the comparator (never post-reverse),
  so ties keep input order both ways — matching pandas `kind="stable"`.

## Cutover checklist (production switch)

- [ ] Parity harness green (`backend/tests/test_sieve_parity.py`)
- [ ] Dark theme + mobile layout done
- [ ] Preview project clicked through: upload → pipeline → run → export
- [ ] Then: point production at this directory, retire `frontend/`

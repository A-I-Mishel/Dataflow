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

## Cutover checklist (production switch)

- [ ] Parity harness green (`backend/tests/test_sieve_parity.py`)
- [ ] Dark theme + mobile layout done
- [ ] Preview project clicked through: upload → pipeline → run → export
- [ ] Then: point production at this directory, retire `frontend/`

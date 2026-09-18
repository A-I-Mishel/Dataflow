# Sieve — data-cleaning frontend (local-first + optional backend check)

Static app, no build step. ES modules require http(s) — open via any
static server, not `file://` (module CORS), e.g. `npx serve .`.

Hybrid mode: the local engine is always the source of truth. When a
backend URL is configured (topbar `Local-only` button, `?api=<url>`, or
`window.SIEVE_API_URL`), uploads are mirrored to `POST /upload` and every
run is additionally verified with `POST /execute` in the background.
Agreement/divergence surfaces as toasts; remote failures never block local
results. CSP allows backend calls (`connect-src http: https:`).

## Deploy (Vercel frontend + Render backend)

1. Render Blueprint deploy of `backend/` first (`render.yaml` at repo
   root); note the service URL.
2. Put that URL in `config.js` (`window.SIEVE_API_URL`) and push.
3. Vercel: import repo → Root Directory `frontend-sieve`, Framework
   Preset Other, Build Command empty, Output Directory `.`, no env vars.
4. Set `FRONTEND_URLS` on Render to the Vercel URL; restart backend.

Per-browser overrides: topbar backend button (localStorage) and
`?api=<url>` beat `config.js`; clearing both runs local-only.

## Structure

- `index.html` — shell + markup (loads `config.js`, then `app.js` module)
- `config.js` — baked production backend URL (`window.SIEVE_API_URL`)
- `styles.css` — full theme
- `engine.js` — pure engine (`EngineFactory`, `py`); imports cleanly in
  node, stringifies into the Web Worker unchanged
- `api.js` — FastAPI bridge (`getApiBase`, `apiUpload`, `apiExecute`,
  `sieveToBackend`); pure translator, zero DOM deps
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

## Backend mapping (sieve → API node types)

Fully mapped: `fill-missing` (mean/median/mode/custom) → `fill-na`,
`drop-missing` → `drop-na`, `drop-duplicates` (keep-first) →
`drop-duplicates`, `filter-rows` (`= ≠ > < ≥ ≤ contains`) → `filter-rows`,
`sort-rows` → `sort`, `drop-columns` → `drop-column`, `rename-columns` →
`rename-column`, `one-hot` → `encode-categorical`.

Local-only (backend check skips the run and says why instead of comparing
against different semantics): `fill-missing/ffill` (no backend strategy),
`drop-duplicates/keep-last` (backend always keeps first), `standardize`
(new column vs in-place normalize), `clean-text`, `convert-type`,
`remove-outliers`.

## Cutover status

Done — `frontend/` (React) retired. This directory is the production
frontend (Vercel, Root Directory `frontend-sieve`); `backend/` deploys on
Render via `render.yaml` (`FRONTEND_URLS` = the Vercel URL) and serves the
optional `/upload` + `/execute` verification.

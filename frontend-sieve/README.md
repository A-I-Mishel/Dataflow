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

Backend `https://dataflow-cleaner-api.onrender.com` (Render Blueprint,
`render.yaml` at repo root) → baked into `config.js`
(`window.SIEVE_API_URL`) → frontend `https://dataflow-cleaner.vercel.app`
(Vercel, Root Directory `frontend-sieve`, Preset Other, Build empty,
Output `.`, no env vars) → `FRONTEND_URLS` on Render matches the Vercel
URL. Security headers live in `vercel.json`; unit tests are excluded from
deploys via `.vercelignore`.

Per-browser overrides: topbar backend button (localStorage) and
`?api=<url>` beat `config.js`; clearing both runs local-only.

## Structure

- `index.html` — shell + markup (loads `config.js`, then `app.js` module)
- `config.js` — production backend URL (`window.SIEVE_API_URL`)
- `vercel.json` — production response headers (nosniff, same-origin
  referrer, no framing, no camera/mic/geolocation)
- `styles.css` — full theme
- `engine.js` — pure engine (`EngineFactory`, `py`); imports cleanly in
  node, stringifies into the Web Worker unchanged
- `api.js` — FastAPI bridge (`getApiBase`, `apiUpload`, `apiExecute`,
  `sieveToBackend`); pure translator, zero DOM deps
- `app.js` — state, canvas, inspector, preview, exports, boot
- `tests/parity-run.mjs` — backend parity runner (dev only, excluded
  from deploys via `.vercelignore`)
- `tests/engine.test.mjs` — engine unit tests, zero deps
- `tests/api.test.mjs` — sieve→backend translator tests, zero deps

## Tests

- `node --test tests/engine.test.mjs tests/api.test.mjs` from this directory
  (engine + translator suites).
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

Fully mapped: `fill-missing` (mean/median/mode/custom/ffill/bfill+limit)
→ `fill-na`, `drop-missing` (any/all) → `drop-na`, `drop-duplicates`
(keep-first) → `drop-duplicates`, `filter-rows`
(`= ≠ > < ≥ ≤ contains`) → `filter-rows`, `sort-rows` → `sort`,
`drop-columns` → `drop-column`, `rename-columns` → `rename-column`,
`one-hot` → `encode-categorical`, `round-values` → `round-values`,
`reorder-columns` → `reorder-columns`, `drop-empty-columns` →
`drop-empty-columns`, `replace-values` → `replace-values`,
`split-column` → `split-column`, `merge-columns` → `merge-columns`,
`extract-text` → `extract-text`, `group-rare` → `group-rare`,
`label-encode` → `encode-categorical` (label), `normalize` → `normalize`,
`convert-type`→date → `parse-date`, `extract-date-part` →
`extract-date-part`, `date-difference` → `date-difference`,
`create-column` → `create-column`, `conditional-column` →
`conditional-column`, `validate-column` → `validate-column`,
`find-invalid` → `find-invalid`, `clip-values` → `clip-values`,
`find-replace-pattern` → `find-replace-pattern`, `remove-special-chars` →
`remove-special-chars`, `standardize-categories` →
`standardize-categories`, `log-transform` → `log-transform`.

Local-only (backend check skips the run and says why instead of comparing
against different semantics): `drop-duplicates/keep-last` (backend always
keeps first), `standardize` (new column vs in-place normalize),
`convert-type`→number/text (no backend cast op), `clean-text`,
`remove-outliers`.

## Cutover status

Done — `frontend/` (React) retired. This directory is the production
frontend (Vercel, Root Directory `frontend-sieve`); `backend/` deploys on
Render via `render.yaml` (`FRONTEND_URLS` = the Vercel URL) and serves the
optional `/upload` + `/execute` verification.

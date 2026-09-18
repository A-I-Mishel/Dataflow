# Sieve — No-Code Data Cleaning Studio

Visual data-cleaning pipelines in your browser: build steps on a canvas,
preview every step, export a clean CSV + the pandas script that reproduces
it. Local-first engine with an optional FastAPI backend check — when a
backend URL is configured, each run is additionally verified against the
pandas engine and mismatches surface as toasts (local results always win).

## Project layout

- `frontend-sieve/` — the app (static site, no build step).
  - `index.html` — shell + markup
  - `styles.css` — full theme
  - `engine.js` — pure local engine (`EngineFactory`, `py`)
  - `api.js` — FastAPI bridge (health/upload/execute, sieve→backend
    node translation)
  - `app.js` — state, canvas, inspector, preview, exports, boot
  - `tests/` — unit tests + backend parity runner (excluded from deploys
    via `.vercelignore`)
- `backend/` — FastAPI + pandas API (upload, execute, profile, generate,
  download, saved pipelines). Deployed on Render; also the parity
  reference for the local engine.
- `test-materials/` — a big messy CSV for trying the app.

## Run locally

Frontend — static server (ES modules require http(s), not `file://`):

```bash
cd frontend-sieve
npx serve .
```

Backend (http://127.0.0.1:8000):

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

Connect them: open the frontend, click the `Local-only` button in the
topbar, and enter `http://localhost:8000` (persisted in localStorage;
`?api=<url>` works too, e.g. your Render URL). Empty = local-only mode.

## Tests

- Sieve unit tests: `node --test tests/engine.test.mjs`
  from `frontend-sieve/`.
- Backend: `pytest tests/` from `backend/` (includes
  `test_sieve_parity.py`, cell-for-cell local-vs-pandas checks).

Free-tier notes: Render sleeps after ~15 min idle (~50s wake-up); sessions
live in process memory (single worker on purpose) and `app.db` sits on
ephemeral disk, so uploads reset on sleep/redeploy.

## Deploy (production: Vercel frontend + Render backend)

Order matters — backend first, then frontend, then point them at each other:

1. **Backend → Render.** Push this repo to GitHub → Render → New →
   Blueprint → select the repo (`render.yaml` included). Note the service
   URL, e.g. `https://dataflow-cleaner-api.onrender.com`.
2. **Bake the backend URL into the frontend.** Put that exact Render URL
   in `frontend-sieve/config.js` (`window.SIEVE_API_URL`, no trailing
   slash) and push.
3. **Frontend → Vercel.** Import the same repo → Root Directory
   `frontend-sieve`, Framework Preset Other, Build Command empty, Output
   Directory `.`. No environment variables. Note the Vercel URL, e.g.
   `https://dataflow-sieve.vercel.app`.
4. **CORS.** Set `FRONTEND_URLS` on the Render service to the Vercel URL
   (or do it in `render.yaml` before step 1) and redeploy/restart the
   backend.

The deployed site boots with the baked URL; the topbar shows
`Backend ✓` once `/health` answers. Any browser can still override via
the topbar button or `?api=<url>`, or go local-only by clearing it.

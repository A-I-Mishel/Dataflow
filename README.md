# Data Cleaner — No-Code Data Cleaning Studio

Visual data-cleaning pipelines in your browser: build steps on a canvas,
preview every step, export a clean CSV/XLSX + the pandas script that reproduces
it. Local-first engine with a FastAPI backend for accounts, saved
templates, and optional pandas verification — when the backend is
connected, each run is additionally checked against pandas and mismatches
surface as toasts (local results always win).

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
- `backend/` — FastAPI + pandas API (accounts, upload, execute, profile,
  generate, download, saved pipelines). Deployed on Render; also the parity
  reference for the local engine. `auth.py` handles scrypt password hashes
  and database-backed login tokens.
- `test-materials/` — big messy CSV + XLSX twins for trying the app (Excel reads first sheet only).

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

Connect them: open the frontend with the backend URL, either
`http://127.0.0.1:3000/?api=http://localhost:8000` or by clicking the
topbar backend button and entering `http://localhost:8000` (persisted in
localStorage). The account gate then asks you to sign in or create an
account before the workspace opens.

## Accounts (mandatory)

Login is required before the app can be used. Accounts use the same
SQLAlchemy database as saved pipelines (`users` + `auth_sessions` tables):
scrypt password hashes, random bearer tokens stored only as SHA-256
digests, 30-day expiry, server-side logout, and per-account template
ownership (`user:<id>`).

- Backend: `/upload`, `/execute`, `/profile`, `/download`, `/generate`,
  and `/pipelines/*` all require `Authorization: Bearer <token>` and
  answer `401` otherwise. Only `/health` and `/auth/*` stay public.
- Frontend: the login gate is visible from first paint; the workspace is
  restored only after `/auth/me` succeeds. Signing out returns to the gate.
- Browser storage is namespaced per account (`sieve.pipeline.v2.u.<id>`,
  IndexedDB `dataset.u.<id>`), so two accounts on one laptop cannot see
  each other's dataset or draft pipeline.
- The cleaning engine still runs locally in the browser. Datasets are not
  stored in the account database; as before, a connected backend gets a
  temporary copy for pandas verification.

### Database

Local development uses SQLite (`backend/app.db`) automatically. For the
deployed app, use a persistent PostgreSQL database — **Neon free** is the
recommended choice because Render's free Postgres expires after 30 days.

1. Create a project at <https://neon.tech> (free plan).
2. Copy the **pooled** connection string; it looks like
   `postgresql://USER:PASSWORD@HOST/DB?sslmode=require`.
3. Local: set `DATABASE_URL` before starting uvicorn.
4. Render: Dashboard → your service → Environment → add `DATABASE_URL`
   with that value (the Blueprint prompts for it because `render.yaml`
   marks it `sync: false`). Redeploy.

Tables are created automatically on startup (`Base.metadata.create_all`).
No migrations need to be run for a fresh database. SQLite files from
older versions are upgraded in place at startup.

The backend refuses to boot on Render when `DATABASE_URL` is missing:
Render's local disk is ephemeral, and mandatory login on an ephemeral
database would lose every account on the next sleep or deploy.

## Tests

- Frontend unit tests: `node --test tests/engine.test.mjs tests/api.test.mjs`
  from `frontend-sieve/`.
- Backend: `pytest tests/` from `backend/` (includes
  `test_sieve_parity.py`, cell-for-cell local-vs-pandas checks, and
  `test_auth.py`, account flow + per-user pipeline isolation).

Free-tier notes: Render sleeps after ~15 min idle (~50s wake-up); upload
sessions live in process memory (single worker on purpose), so uploads
reset on sleep/redeploy. Accounts and saved templates live in PostgreSQL
(Neon), so they survive restarts. Datasets stay in each browser (the
server gets only a temporary copy for verification).

## Deploy (production: Vercel frontend + Render backend)

Order matters — backend first, then frontend, then point them at each other:

1. **Backend → Render.** Push this repo to GitHub → Render → New →
   Blueprint → select the repo (`render.yaml` included). Keep the default
   service name `dataflow-cleaner-api` so the URL is
   `https://dataflow-cleaner-api.onrender.com`.
2. **Bake the backend URL into the frontend.** `frontend-sieve/config.js`
   already points at that Render URL — only touch it if your service URL
   differs. Push.
3. **Frontend → Vercel.** Import the same repo (project
   `dataflow-cleaner`, live at `https://dataflow-cleaner.vercel.app`) →
   Root Directory `frontend-sieve`, Framework Preset Other, Build Command
   empty, Output Directory `.`. No environment variables.
4. **Database.** Create the Neon project and paste its pooled connection
   string into the Render service's `DATABASE_URL` environment variable
   (see [Database](#database) above), then redeploy.
5. **CORS.** `render.yaml` already sets `FRONTEND_URLS` to
   `https://dataflow-cleaner.vercel.app`; redeploy/restart the backend if
   the value ever drifts from the real Vercel URL.

The deployed site boots with the baked URL; the topbar shows
`Backend ✓` once `/health` answers. The account gate then requires
signup/login. Any browser can still point at a different backend via the
gate's backend link or `?api=<url>`; accounts are per backend.

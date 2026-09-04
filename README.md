# DataFlow Cleaner

A full-stack data cleaning pipeline tool: drag-and-drop transform nodes on a
React Flow canvas, run them against a FastAPI + pandas backend, preview
results with charts, export a reproducible Python script + cleaned CSV bundle,
and save/load pipelines to SQLite.

## Project layout

- `backend/` — FastAPI API (upload, execute, profile, generate, download,
  pipeline templates), pandas transforms, SQLAlchemy + SQLite persistence.
- `frontend/` — React 18 + Vite + Tailwind + Zustand + React Flow UI.
- `test-materials/` — a big messy CSV + XLSX for trying the app.

## Run locally

Backend (http://127.0.0.1:8000):

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

Frontend (http://localhost:5173):

```bash
cd frontend
npm install
npm run dev
```

Tests: `cd backend && pytest tests/` (42 tests).

## Environment variables

| Variable       | Where    | Purpose                                              |
| -------------- | -------- | ---------------------------------------------------- |
| `VITE_API_URL` | frontend | Backend base URL (default `http://localhost:8000`).  |
| `FRONTEND_URLS`| backend  | Comma-separated extra CORS origins for production.   |

## Deploy

**Backend → Render** (long-lived server; Vercel can't host it — sessions
and SQLite need a persistent process):

1. Push this repo to GitHub.
2. Render → New → Blueprint → select the repo (`render.yaml` is included).
3. Set `FRONTEND_URLS` to your Vercel URL, e.g.
   `https://dataflow-cleaner.vercel.app`, then deploy.
4. Note the backend URL, e.g. `https://dataflow-cleaner-api.onrender.com`.

**Frontend → Vercel:**

1. Import the same GitHub repo.
2. Set **Root Directory** to `frontend` (Framework Preset: Vite).
3. Add env var `VITE_API_URL` = your Render backend URL.
4. Deploy. No client-side routes to configure; CORS is handled via
   `FRONTEND_URLS` on the backend.

Demo caveat: sessions live in memory and `app.db` sits on ephemeral disk,
so uploads/templates reset when the free-tier backend sleeps or restarts.

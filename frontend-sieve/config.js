// Production backend URL (Render). Baked default for the deployed site —
// Vercel serves static files with no runtime env injection, so the API base
// lives here instead.
//
// Deploy order:
//   1. Deploy the backend on Render first (Blueprint via render.yaml).
//   2. Put its URL below (must be the exact https origin, no trailing slash).
//   3. Redeploy the frontend on Vercel.
//   4. Set that same Vercel URL as FRONTEND_URLS on the Render service.
//
// Per-browser overrides always win over this file: the topbar backend
// button (localStorage) and the ?api=<url> query param. Empty either of
// those to run local-only.
window.SIEVE_API_URL = 'https://dataflow-cleaner-api.onrender.com';

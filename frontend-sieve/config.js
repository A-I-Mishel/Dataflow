// Production backend URL (Render). Single source of truth for the
// deployed site — Vercel serves static files with no runtime env
// injection, so the API base lives here.
//
//   Backend:  https://dataflow-cleaner-api.onrender.com (Render Blueprint)
//   Frontend: https://dataflow-cleaner.vercel.app (Vercel, Root frontend-sieve)
//
// Per-browser overrides always win over this file: the topbar backend
// button (localStorage) and the ?api=<url> query param. Clearing both
// runs local-only.
window.SIEVE_API_URL = 'https://dataflow-cleaner-api.onrender.com';

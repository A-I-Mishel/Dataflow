// FILE: frontend-sieve/config.js
// PURPOSE: Single place for production backend URL. Vercel serves static
//   files only, so the API address must live here (no runtime env vars).
// HOW IT FITS: index.html loads this FIRST -> api.js reads window.SIEVE_API_URL.
// WHERE TO EDIT (EXAM):
//   ★ EXAM: CHANGE HERE — if teacher says "change backend URL / go local-only",
//     edit the string below only. Set to '' for local-only mode.
//     Per-browser overrides always win: ?api=<url> param > topbar button
//     (localStorage) > this file. Clearing both runs local-only.
// DO NOT TOUCH anything else — this file must stay 1 line of logic.
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

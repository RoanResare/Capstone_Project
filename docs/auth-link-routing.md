# Authentication link routing

Password reset emails link to `/reset-password?oobCode=...` on the requesting allowed frontend (or PASSWORD_RESET_URL). Activation emails link to EMAIL_VERIFICATION_URL (defaults to FRONTEND_URL + `/activate-account`). Express serves the SPA for both routes; React reads the code and POSTs JSON to `/api/auth/validate-reset-code` or `/api/auth/register/activate`. Reset submission POSTs to `/api/auth/reset-password`.

The frontend Static Site and Express API service build independently. In production the browser uses the same-origin `/api` path; configure the production host or routing layer to send `/api` requests to the Express service. Development continues to support `VITE_API_URL` and `VITE_API_BASE_URL`.

```dotenv
VITE_API_URL=/api
```

For the backend Web Service, use `npm ci && npm run build` and `npm start` from the repository root, or set the Root Directory to `server` and use those commands there. The backend build installs/checks only backend dependencies and does not read `VITE_` variables. For the Static Site, use `npm ci && npm run build:frontend` with `dist` as the publish directory; set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` on that frontend service only. The frontend build validates these public browser settings without logging their values.

If the frontend and API use different Render hostnames, configure the production API base URL and allow the frontend origin in backend CORS settings. Cloudflare must proxy the frontend hostname to the Static Site custom-domain target without replacing application responses with its own challenge/block page.

Keep `FRONTEND_URL`, `PASSWORD_RESET_URL`, and `EMAIL_VERIFICATION_URL` pointed to the custom frontend hostname, never an API-only host. Deploy the backend and frontend services from the intended branch. Existing valid links can use the corrected frontend bundle; consumed or expired codes require a new link.

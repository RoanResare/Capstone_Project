# Authentication link routing

Password reset emails link to `/reset-password?oobCode=...` on the requesting allowed frontend (or PASSWORD_RESET_URL). Activation emails link to EMAIL_VERIFICATION_URL (defaults to FRONTEND_URL + `/activate-account`). Express serves the SPA for both routes; React reads the code and POSTs JSON to `/api/auth/validate-reset-code` or `/api/auth/register/activate`. Reset submission POSTs to `/api/auth/reset-password`.

The frontend Static Site and Express API service build independently. Attach the public custom domain to the Static Site, with `dist` as its publish directory. Configure `VITE_API_URL` on the Static Site to the backend origin plus `/api`; the checked-in production default is `https://capstone-project-bczf.onrender.com/api`. Use `https://api.charmingfurfectionpetservices.online/api` only after that hostname is attached to the same Render Web Service. The backend allows both frontend custom-domain origins through CORS and handles browser preflight requests globally. Development continues to support `VITE_API_URL` and `VITE_API_BASE_URL`.

```dotenv
VITE_API_URL=/api
```

For the backend Web Service, use `npm ci && npm run build` and `npm start` from the repository root, or set the Root Directory to `server` and use those commands there. The backend build installs/checks only backend dependencies and does not read `VITE_` variables. Set `FRONTEND_SITE_URL` on the backend to the Static Site URL; if the backend receives a browser route without a local SPA bundle, it redirects that route to the frontend. For the Static Site, use `npm ci && npm run build:frontend` with `dist` as the publish directory; set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_API_URL` on that frontend service only. The frontend build validates the Supabase browser settings without logging their values.

If the frontend and API use different Render hostnames, configure the production API base URL and allow the frontend origin in backend CORS settings. Cloudflare must proxy the frontend hostname to the Static Site custom-domain target without replacing application responses with its own challenge/block page.

Keep `FRONTEND_URL`, `PASSWORD_RESET_URL`, and `EMAIL_VERIFICATION_URL` pointed to the custom frontend hostname, never an API-only host. Deploy the backend and frontend services from the intended branch. Existing valid links can use the corrected frontend bundle; consumed or expired codes require a new link.

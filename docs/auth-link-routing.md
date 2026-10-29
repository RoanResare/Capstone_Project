# Authentication link routing

Password reset emails link to `/reset-password?oobCode=...` on the requesting allowed frontend (or PASSWORD_RESET_URL). Activation emails link to EMAIL_VERIFICATION_URL (defaults to FRONTEND_URL + `/activate-account`). Express serves the SPA for both routes; React reads the code and POSTs JSON to `/api/auth/validate-reset-code` or `/api/auth/register/activate`. Reset submission POSTs to `/api/auth/reset-password`.

The Express service serves both the frontend and API. In production the browser uses the same-origin `/api` path, while development continues to support `VITE_API_URL` and `VITE_API_BASE_URL`. This avoids API CORS and separate API-host DNS/proxy problems.

```dotenv
VITE_API_URL=/api
```

Build the frontend into `server/dist` and deploy it with the Express service. `npm run build` at the repository root now builds Vite and copies the output into the server's static directory. The custom apex or `www` domain must be attached to this same Render web service; API calls will then use that same host.

If a separate `api.` hostname remains configured, it is no longer used by the production browser bundle. Route the frontend custom domain to this Render web service and keep the API under `/api` on the same host. Cloudflare must proxy the frontend hostname to the Render custom-domain target without replacing application responses with its own challenge/block page.

Keep `FRONTEND_URL`, `PASSWORD_RESET_URL`, and `EMAIL_VERIFICATION_URL` pointed to the custom frontend hostname, never an API-only host. Deploy the backend changes and the rebuilt frontend together. Existing valid links can use the corrected frontend bundle; consumed or expired codes require a new link.

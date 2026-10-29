# Authentication link routing

Password reset emails link to `/reset-password?oobCode=...` on the requesting allowed frontend (or PASSWORD_RESET_URL). Activation emails link to EMAIL_VERIFICATION_URL (defaults to FRONTEND_URL + `/activate-account`). Express serves the SPA for both routes; React reads the code and POSTs JSON to `/api/auth/validate-reset-code` or `/api/auth/register/activate`. Reset submission POSTs to `/api/auth/reset-password`.

Production API and chatbot traffic is pinned in `src/app/utils/apiBaseUrl.js` to the direct Render backend, regardless of stale VITE_API_URL, VITE_API_BASE_URL, or VITE_GROQ_PROXY_URL overrides. Development continues to support these overrides. The matching production environment setting is:

```dotenv
VITE_API_URL=https://capstone-project-bczf.onrender.com/api
```

Set this value on the Render frontend service and rebuild/redeploy. Hosted environment variables override `.env.production`, and Vite embeds these values at build time. Updating only the backend or refreshing an old bundle does not change its API URL.

On 2026-10-22, a live OPTIONS probe to the custom API domain returned Cloudflare HTML with HTTP 403 and no CORS headers. The same probe to the direct Render backend returned HTTP 204 with Access-Control-Allow-Origin for the Render frontend. This locates that failure upstream of Express. Use the direct Render API until the custom domain's Cloudflare/domain routing allows API GET, POST, and OPTIONS requests without an HTML block page. No automatic replay of token-consuming requests is performed.

Backend CORS runs before parsers, routes, and error handling. Its shared origin list includes both the custom frontend and Render frontend, plus CLIENT_URL entries. Requests with JSON trigger OPTIONS preflights; removing JSON headers or using no-cors would not fix the upstream block.

Keep FRONTEND_URL, PASSWORD_RESET_URL, and EMAIL_VERIFICATION_URL pointed to the desired frontend, never the API host. Deploy the backend changes as well as rebuilding the frontend. Existing valid links can use the corrected frontend bundle; consumed or expired codes require a new link.

# Session Connection Security

Every protected API request validates the authenticated session against its original IP address and checks a server-side VPN/proxy provider. IP changes and explicit VPN/proxy/Tor detections revoke the session. Country mismatches, unknown IPs, and lookup outages do not count as VPN evidence or revoke sessions. Revocation is persisted in `sessionSecurity/{uid}` and Firebase refresh tokens are revoked. Existing Firestore rules enforce the persisted revocation.

The frontend verifies the connection before mounting authenticated dashboard content, polls every five seconds, and checks on route changes, focus, connectivity restoration, visibility changes, and supported mobile network-change events. A network-change event suspends dashboard access until a fresh check succeeds. Browsers cannot directly read the device's VPN state; detection occurs on an observed request or network event.

## Provider Configuration

With no override, the backend uses `https://api.ipquery.io/{ip}`. Its [documented API](https://ipquery.io/) returns `risk.is_vpn`, `risk.is_proxy`, and `risk.is_tor` without an API key. There is no country-based access restriction. An explicit positive VPN/proxy/Tor flag is required to block a connection; missing flags, country-only results, generic anonymity, hosting/datacenter flags, and risk scores never trigger VPN blocking. Failed responses and results for a different IP are ignored.

Optional `FRAUD_GEO_LOOKUP_URL` and `FRAUD_GEO_LOOKUP_API_KEY` overrides remain supported. Providers may return explicit `security.vpn`, `security.proxy`, or `security.tor` values. Boolean values and their `true`/`false` or `1`/`0` representations are supported.

For IPWhois with a plan that includes threat detection:

```dotenv
FRAUD_GEO_LOOKUP_URL=https://ipwhois.pro/{ip}?key={api_key}&security=1
FRAUD_GEO_LOOKUP_API_KEY=your-provider-key
```

The API key stays on the server. See the provider's [threat-detection documentation](https://ipwhois.io/documentation/pro). Quotas, incomplete provider results, and provider outages allow login and retain active sessions. This availability-first policy means VPN detection is unavailable during an outage; it does not mean the connection was verified as clean. `FRAUD_FAIL_CLOSED` only controls email-provider outages and account limits; explicit VPN/proxy detections still block regardless of this flag.

Express traverses trusted loopback, link-local, and private ingress hops, stopping at the nearest untrusted address rather than assuming a single proxy hop. Set `TRUSTED_PROXY_CIDRS` to comma-separated IPs/CIDRs only if the deployment has additional known public ingress proxies. The deployment must prevent direct access around its ingress, which must sanitize forwarded headers. Never set arbitrary client IP headers or trust all public proxies. See [Express proxy guidance](https://expressjs.com/en/guide/behind-proxies/). Client country headers are not used as evidence. Private, invalid, or missing IPs skip the provider lookup rather than blocking access; correct ingress configuration remains important for IP tracking.

## Email Validation

Malformed addresses, known disposable domains, domains without mail records, and negative mailbox-provider results return exactly `Illegitimate email cannot be verified`. Valid non-`.com` domains are supported. Customer profile email changes also use the authenticated backend validator before updating Firebase. DNS or provider outages are not evidence that a mailbox is fake. Domain/MX checks cannot prove that an individual mailbox exists; configure `EMAIL_VALIDATION_API_URL` for mailbox checks and use email ownership verification for definitive proof.

Session IP bindings are stored in `sessionConnections`. Configure a Firestore TTL policy on `expiresAt` to remove old bindings after their retention period. No client write permission is needed for these server-managed collections.

Deploy both backend and frontend changes. Local automated tests simulate provider decisions, token replay, IP switching, and mobile network events. IP intelligence detects known VPN/proxy addresses, not every possible private VPN; detection is on the next request/event or visible dashboard heartbeat (five seconds), not instant device-level VPN monitoring. Hidden tabs are checked when visible again.

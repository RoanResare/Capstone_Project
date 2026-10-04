# Session Connection Security

Login, OTP completion, and customer registration check the connection for explicit VPN/proxy/Tor detections. After successful authentication, protected requests validate credentials, account status, roles, token validity, and persisted revocation only. They do not recheck IP addresses or call the connection provider. Existing Firestore rules continue enforcing persisted revocation.

There is no dashboard connection gate, periodic heartbeat, route/focus/network-change re-verification, or save/profile connection preflight. Authenticated users can navigate normally after login. The 30-minute inactivity timeout and Remember me expiration remain unchanged. The legacy `/auth/session-security` endpoint now performs ordinary authentication and revocation validation only.

## Provider Configuration

With no override, the backend uses `https://api.ipquery.io/{ip}`. Its [documented API](https://ipquery.io/) returns `risk.is_vpn`, `risk.is_proxy`, and `risk.is_tor` without an API key. There is no country-based access restriction. An explicit positive VPN/proxy/Tor flag is required to block a connection; missing flags, country-only results, generic anonymity, hosting/datacenter flags, and risk scores never trigger VPN blocking. Failed responses and results for a different IP are ignored.

Optional `FRAUD_GEO_LOOKUP_URL` and `FRAUD_GEO_LOOKUP_API_KEY` overrides remain supported. Providers may return explicit `security.vpn`, `security.proxy`, or `security.tor` values. Boolean values and their `true`/`false` or `1`/`0` representations are supported.

For IPWhois with a plan that includes threat detection:

```dotenv
FRAUD_GEO_LOOKUP_URL=https://ipwhois.pro/{ip}?key={api_key}&security=1
FRAUD_GEO_LOOKUP_API_KEY=your-provider-key
```

The API key stays on the server. See the provider's [threat-detection documentation](https://ipwhois.io/documentation/pro). Quotas, incomplete provider results, and provider outages allow login and retain active sessions. This availability-first policy means VPN detection is unavailable during an outage; it does not mean the connection was verified as clean. `FRAUD_FAIL_CLOSED` only controls email-provider outages and account limits; explicit VPN/proxy detections still block regardless of this flag.

Express traverses trusted loopback, link-local, and private ingress hops, stopping at the nearest untrusted address rather than assuming a single proxy hop. Set `TRUSTED_PROXY_CIDRS` to comma-separated IPs/CIDRs only if the deployment has additional known public ingress proxies. The deployment must prevent direct access around its ingress, which must sanitize forwarded headers. Never set arbitrary client IP headers or trust all public proxies. See [Express proxy guidance](https://expressjs.com/en/guide/behind-proxies/). Client country headers are not used as evidence. Private, invalid, or missing IPs skip the provider lookup rather than blocking access.

## Email Validation

Malformed addresses, known disposable domains, domains without mail records, and negative mailbox-provider results return exactly `Illegitimate email cannot be verified`. Valid non-`.com` domains are supported. Customer profile email changes also use the authenticated backend validator before updating Firebase. DNS or provider outages are not evidence that a mailbox is fake. Domain/MX checks cannot prove that an individual mailbox exists; configure `EMAIL_VALIDATION_API_URL` for mailbox checks and use email ownership verification for definitive proof.

Old `sessionConnections` records and `connectionIp` token claims are no longer consulted or written by session validation. They need not be deleted to enable the new behavior. Existing `sessionSecurity` revocations still require a fresh login; removing connection checks does not revive revoked tokens.

Deploy both backend and frontend changes. Tests cover immediate dashboard rendering for every role, absence of connection preflights, continued login/registration checks, IP changes without session termination, and rejection of revoked tokens. Mid-session VPN/IP-change detection is intentionally disabled: turning on a VPN after login no longer triggers automatic logout.

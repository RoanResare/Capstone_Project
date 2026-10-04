# Session Connection Security

Login, OTP completion, and customer registration check the connection for explicit VPN/proxy/Tor detections. Protected requests also validate the server-observed IP against the login claim/persisted session binding and check for explicit VPN/proxy/Tor flags. An IP change or positive detection persists revocation in `sessionSecurity/{uid}`, revokes Firebase refresh tokens, and rejects the request before its action executes. Returning to the old IP cannot revive the token. Existing Firestore rules enforce persisted revocation as well.

Dashboard monitoring is silent: no loading gate or flashing verification screen. A five-second poll checks `/auth/session-security`; dashboard navigation, focus, connectivity restoration, visibility restoration, and supported network-change events also trigger checks. Overlapping checks are coalesced, with a fresh check queued when the network changes during a request. Hidden tabs resume checking when visible. Sensitive Firestore save/profile/password workflows have server preflights. Confirmed violations trigger logout, clear remembered/trusted-device metadata, preserve a security warning, and redirect to `/login`. Transient network errors retry without falsely accusing the user of VPN use. The 30-minute inactivity timeout and Remember me expiration remain unchanged.

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

Session IP bindings are stored in server-managed `sessionConnections` records; signed `connectionIp` claims protect the interval before the first poll. Sessions without that claim bind to the first successfully checked connection. Configure Firestore TTL on `sessionConnections.expiresAt` to clean up expired records. Persisted revocations still require a fresh login.

## Clean-Network Recovery

Login/OTP checks bypass the short-lived IP cache. An explicit positive flag displays `Blocked VPN IP address`; country/risk-only results do not block. A security logout stores a one-time warning shown as both inline feedback and a pop-up on the login page. Browser responses carry a session epoch, so delayed responses from a logged-out session cannot terminate a fresh session for the same UID.

New tokens are issued only after an outstanding revocation finishes and its seconds-based cutoff has passed (normally less than one additional second). Old revocation metadata is preserved to reject token replay, but fresh sessions get new IP bindings. An already-revoked request finishing a late provider lookup cannot advance the cutoff or revoke refresh tokens again. No account-level VPN penalty is applied; after returning to a normal network, authenticate again normally.

Logout clears transient auth tokens from both local and session storage and invalidates pending profile hydration immediately. A verified fresh login signs out any leftover Firebase identity before installing and force-refreshing the new custom-token session, consumes old warning markers, and protects that handoff from stale auth-state callbacks. Application/customer data and legitimate Remember me settings are not globally wiped. A pending server revocation older than 30 seconds is repaired by repeating Firebase revocation during a verified login, preserving the old-token cutoff rather than removing security records.

Deploy both backend and frontend changes. Tests cover silent rendering, polling/navigation/network events for every role, IP-change revocation, same-IP VPN detections, token replay, and transient lookup failures. Browsers cannot directly inspect a phone's VPN app. Detection occurs on the next request or poll, not instantaneously when a VPN icon appears. IP intelligence identifies known VPN/proxy endpoints, not every private VPN. Any IP switch is treated as unauthorized, including legitimate WiFi/mobile transitions, and requires a fresh login.

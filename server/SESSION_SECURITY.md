# Session Connection Security

Every protected API request validates the authenticated session against its original IP address and checks a server-side VPN/proxy provider. IP changes, detected VPN/proxy connections, and unverifiable active connections revoke the session. Revocation is persisted in `sessionSecurity/{uid}` and Firebase refresh tokens are revoked. Existing Firestore rules enforce the persisted revocation.

The frontend verifies the connection before mounting authenticated dashboard content, polls every five seconds, and checks on route changes, focus, connectivity restoration, visibility changes, and supported mobile network-change events. A network-change event suspends dashboard access until a fresh check succeeds. Browsers cannot directly read the device's VPN state; detection occurs on an observed request or network event.

## Provider Configuration

Set `FRAUD_GEO_LOOKUP_URL` and `FRAUD_GEO_LOOKUP_API_KEY` on the backend. The provider must return a country and explicit `security.vpn` and `security.proxy` values, or an aggregate `security.anonymous` value. Boolean values and their `true`/`false` or `1`/`0` representations are supported. Country-only responses cannot authorize production access.

For IPWhois with a plan that includes threat detection:

```dotenv
FRAUD_GEO_LOOKUP_URL=https://ipwhois.pro/{ip}?key={api_key}&security=1
FRAUD_GEO_LOOKUP_API_KEY=your-provider-key
```

The API key stays on the server. See the provider's [threat-detection documentation](https://ipwhois.io/documentation/pro). Missing configuration, quotas, or provider outages block login and end active sessions rather than silently bypassing checks. `FRAUD_FAIL_CLOSED` only controls email validation and account limits; it does not disable connection security.

Production requests need a public client IP. Express currently trusts one reverse-proxy hop; the deployment must prevent direct access around that trusted ingress. Client country headers are not used as evidence. Private-address bypass is limited to development.

Session IP bindings are stored in `sessionConnections`. Configure a Firestore TTL policy on `expiresAt` to remove old bindings after their retention period. No client write permission is needed for these server-managed collections.

Deploy both backend and frontend changes. Local automated tests simulate provider decisions, token replay, IP switching, and mobile network events; they do not establish that an external VPN provider is configured on the hosted deployment.

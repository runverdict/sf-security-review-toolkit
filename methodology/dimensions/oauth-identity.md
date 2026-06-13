# Dimension: oauth-identity

OAuth 2.0/2.1 authorization-server and client security, plus the whole
first-party identity surface (login, signup, invite, password reset, consent).
Applies when the scope manifest shows any authenticated external endpoint or
identity flow. This dimension is the **static counterpart of the review's DAST
identity scope**: the authenticated DAST the review requires explicitly covers
identity endpoints (baseline: `dast-scope-includes-identity-endpoints`), and the reviewers' own
pen test hits login/forgot/token flows early — a finding here that survives to
submission is a finding they will reproduce dynamically.

## 1. Threat concept

Two vulnerability classes share one surface:

1. **Authorization-server defects** — PKCE not actually enforced, sloppy
   `redirect_uri` matching, replayable authorization codes, refresh tokens that
   never rotate, `client_credentials` grants reachable by unintended clients,
   missing token audience binding. Each is a token-theft or
   privilege-escalation primitive. For products with an MCP server the bar is
   contractual: the MCP specification mandates OAuth 2.1 with PKCE and RFC 8707
   resource indicators (baseline: `mcpthreat-oauth21-pkce`,
   `mcpthreat-resource-indicators-audience`),
   and Salesforce's agent runtime connects only via the flows the baseline's
   `mcp-auth-no-auth-or-client-credentials` entry lists — so a spec deviation is simultaneously a
   security bug and a listing blocker.
2. **Identity-surface defects** — username/email enumeration via response or
   timing differences, missing brute-force controls, weak or reusable
   password-reset tokens, dynamic client registration (RFC 7591) open to
   anonymous spam or consent-screen metadata injection (baseline:
   `endpoint-enumeration-brute-force`; the DCR support expectation itself
   is `mcpthreat-dcr-or-documented-alternative`).

The review cares because external endpoints are pen-tested against OWASP
Broken Authentication directly, and because identity is the gateway finding:
an attacker who can mint, steal, or replay a token doesn't need any other
vulnerability in the report.

## 2. What good looks like

- **PKCE**: S256 only; `plain` rejected; the verifier is actually recomputed
  and compared at the token endpoint (not merely required to be present at
  authorize). Public clients cannot complete the code exchange without it.
- **Authorization codes**: single-use (replay revokes any tokens already
  issued from that code), short expiry (minutes), bound to `client_id`,
  `redirect_uri`, and — where RFC 8707 is in play — the `resource` the code
  was issued for.
- **`redirect_uri`**: exact string match against the registered set — no
  prefix, no wildcard, no substring. Pseudo-schemes (`javascript:`, `data:`,
  `vbscript:`, `file:`, `blob:`) rejected at registration AND at authorize
  time — a registered `javascript:` URI turns the consent redirect into stored
  XSS. RFC 8252 loopback (`http://127.0.0.1:{port}`, `http://localhost:{port}`,
  variable port) **allowed** for native clients — see §6.
- **Refresh tokens**: rotated on every use for public clients; reuse of a
  rotated-out token detected and the whole token family revoked (theft
  detection). Scope on refresh clamped to the originally granted scope —
  never escalatable.
- **`client_credentials`**: issuable only to registered confidential clients;
  service identities clamped to the minimum scope (a read-only floor), not
  granted the full scope catalog by default.
- **Audience binding**: `resource` accepted at authorize and token endpoints;
  issued tokens carry an audience the resource server validates on every
  request (the deeper resource-server checks live in
  `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/mcp-threat-model.md`).
- **Client secrets**: stored hashed, compared constant-time. Token values
  high-entropy (CSPRNG) and hashed at rest (storage posture details in
  `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/secrets-credentials.md`).
- **DCR**: anonymous registration rate-limited; registered metadata
  (`client_name`, `logo_uri`, URIs) validated/escaped before it ever renders
  on a consent screen; registration access tokens scoped to the registered
  client.
- **Identity surface**: login, forgot-password, and signup return identical
  response shape, status, and comparable timing for existing vs non-existing
  accounts; lockout or progressive throttling on login; reset tokens
  high-entropy, single-use, short-lived. Anti-enumeration responses are
  deliberately uniform — that is a control, not a bug (§6).
- **Rate limiting on the identity surface**: keyed per-credential or per-token
  *first*, per-IP second. Pure per-IP keying breaks behind shared NAT egress —
  Salesforce data centers route many customer orgs through few egress IPs, so
  a per-IP limiter lets one tenant's traffic throttle another's. And the keying
  input must not be spoofable: a limiter that trusts `X-Forwarded-For` from the
  client (rather than from the terminating proxy) is bypassable by header.
- **Error hygiene**: token/registration error bodies in the RFC 6749/7591
  top-level shape with `Cache-Control: no-store` — reviewers check this; ad-hoc
  nested error envelopes get flagged.

## 3. Detection heuristics

Goal: locate the authorization server, token machinery, and identity routes in
an arbitrary repo. Resolve to concrete paths in the target map; targets are
starting points, finders follow imports.

**All stacks** — grep seeds: `code_challenge`, `code_verifier`, `redirect_uri`,
`grant_type`, `client_credentials`, `refresh_token`, `authorization_code`,
`/.well-known/oauth-authorization-server`, `/.well-known/openid-configuration`,
`forgot`, `reset_password`, `invite`, `lockout`, `compare_digest` /
`timingSafeEqual` / `secure_compare`. Route patterns: `/oauth/…`, `/token`,
`/authorize`, `/register`, `/login`, `/auth/…`.

| Stack | Where to look |
|---|---|
| Python (FastAPI/Django) | Imports: `authlib`, `oauthlib`, `jose`/`jwt`, `fastapi.security`, `passlib`, `argon2`; Django: `django-oauth-toolkit` (`oauth2_provider` in `INSTALLED_APPS`), `allauth`. Routes in `app/api/**/routes/`, `urls.py`. Token mint/validate usually in a `*_service.py` or `security.py` — read the service, not just the route. |
| Node (Express/Nest) | `oidc-provider`, `oauth2-server`, `passport` strategies, `jsonwebtoken`, `openid-client`; Nest `@UseGuards`/`AuthGuard` + the strategy files; Express middleware mounting order matters — confirm the limiter/guard is mounted before the identity routes. |
| Ruby (Rails) | `doorkeeper` (`config/initializers/doorkeeper.rb` carries grant flows, token rotation, PKCE config — much of this dimension is that one file), `devise` (lockable/recoverable modules), `omniauth`. |
| Java (Spring) | `spring-authorization-server` (`RegisteredClientRepository`, `AuthorizationServerSettings`), `spring-security-oauth2-*`; `SecurityFilterChain` beans; `application.yml` client registrations. |
| Apex/LWC (where relevant) | Usually config, not code: External Client App / connected-app OAuth settings, `Auth.` namespace usage (`Auth.AuthToken`, `Auth.JWT`) if the package implements a flow itself. Custom login/identity Apex is rare and high-risk when present. |

If the partner *consumes* OAuth but does not operate an authorization server
(no token endpoint in the repo), shrink scope to client-side concerns (state,
PKCE on outbound flows, callback validation, token storage) and say so in the
target map.

## 4. Finder prompt block

```
Primary targets (read these first, then follow imports/call-sites; use grep to
locate the real files when a path is approximate):
{{TARGETS}}

Stack notes (claims from the partner's own docs — verify against the ACTUAL
code, never assume):
{{STACK_NOTES}}

Threat focus — OAuth 2.0/2.1 authorization server + identity surface. Probe:
PKCE enforcement (S256-only, `plain` rejected, the verifier actually recomputed
and compared at the token endpoint — not merely required at authorize);
authorization-code single-use + expiry + binding (client_id, redirect_uri,
resource — and whether replaying a consumed code revokes issued tokens); scope
escalation on refresh (can a refresh request widen scope); refresh-token
rotation + theft detection (is reuse of a rotated-out token detected, is the
family revoked); the client_credentials gate (which clients can use it, is the
issued scope clamped to a read-only floor or does a service identity get
everything); state/CSRF on authorize; redirect_uri matching exactness (prefix
or substring match = open redirect; pseudo-schemes javascript:/data:/
vbscript:/file:/blob: accepted at registration or authorize = stored-XSS pivot
through the consent redirect; RFC 8252 loopback redirects are INTENTIONAL —
not a finding); audience binding (resource parameter accepted, aud claim
issued and validated); client_secret storage (hashed? constant-time compared?);
token entropy and at-rest hashing; the consent/authorize decision flow
(re-prompt vs silent re-consent for new scopes); DCR abuse (anonymous
registration spam — rate limit?; metadata injection — does client_name/logo_uri
reach a consent screen unescaped). Identity surface: login brute-force controls
(lockout, throttling); username/email enumeration via response-shape OR timing
differences on login, forgot-password, signup, and invite flows; password-reset
token entropy + single-use + expiry; rate-limiter keying (per-IP only is
bypassable via shared NAT egress and X-Forwarded-For spoofing — check what the
limiter actually keys on and whether the header is trusted from the client);
token/registration error bodies (RFC shape, Cache-Control: no-store).

Known findings — do NOT re-report any of these:
{{LEDGER}}

Report ONLY findings grounded in code you have READ, with exact file:line.
Prefer precision over volume — a false alarm wastes the verifier's time and
the partner's. If a control is correctly implemented, do NOT report it (one
info-level note for a notably strong control is allowed). For each finding
give a concrete exploit_scenario: the attacker, the request they send, and the
impact.
```

## 5. Verifier guidance

Before confirming a finding in this dimension, read:

- **The whole validator, not the cited line.** `redirect_uri` and PKCE checks
  are usually multi-branch functions; the rejection the finder claims is
  missing is often three branches down or in a registration-time check the
  authorize path relies on.
- **The library's own behavior.** `authlib`, `doorkeeper`, `oidc-provider`,
  and `spring-authorization-server` enforce code single-use, PKCE, and
  rotation by configuration. A finding of "missing X" against a framework
  that does X by default is only real if the config disables it — read the
  config, not just the route.
- **The token-endpoint path end to end** for any code/refresh claim: mint →
  store → exchange → revoke. Claims about replay and rotation are decided in
  the storage layer.
- **Rate-limiter keying and mounting.** Confirm the limiter actually wraps the
  cited route (middleware order, decorator presence) and what the key is
  before confirming a brute-force or bypass finding.
- **Constant-time comparison claims**: find the actual compare call. String
  `==` on a secret is real; `hmac.compare_digest`/`timingSafeEqual`/
  `Rack::Utils.secure_compare` refutes it.
- **Reachability**: is the cited endpoint actually routable in production
  (mounted, not feature-flagged off, not dev-only)?

## 6. Known false-positive patterns

| Pattern | Why it is not a finding |
|---|---|
| Loopback redirect URIs (`http://127.0.0.1:{any port}`, `http://localhost`) accepted for native/public clients | **Required** by RFC 8252 §7.3 — native apps bind an ephemeral loopback port. Flagging this is itself an error. Plain-HTTP on a *non-loopback* host is still a finding. |
| Forgot-password always returns 200 with a generic message, even for unknown emails | Anti-enumeration control, deliberately uniform. The finding would be the *opposite* (divergent responses). Verify timing is also comparable before moving on. |
| 429 responses from the identity endpoints under repeated requests | The rate limiter working. Not DoS, not error mishandling. |
| No PKCE on the `client_credentials` grant | PKCE protects the authorization-code flow's user interaction; client_credentials has none. Salesforce's own agent runtime uses client_credentials without PKCE — see the baseline `mcp-auth-no-auth-or-client-credentials` entry rather than asserting flow rules from memory. |
| Missing `state` parameter on a flow where PKCE S256 is enforced for that client | OAuth 2.1 treats PKCE as the CSRF/code-injection defense; `state` becomes optional. Confirm PKCE is actually enforced for the client type before refuting, and downgrade rather than confirm if both are absent only on confidential-client flows. |
| Long-lived refresh tokens | Not a finding *if* rotation + reuse detection are implemented; lifetime alone is a policy choice. Confirm rotation first. |
| A `login_failed` audit/log event that includes the attempted username | Standard security telemetry, not enumeration — enumeration requires the *response to the attacker* to differ. (Logging the attempted *password* is a real finding — route it to secrets-credentials.) |
| Dev-mode HTTP issuer / relaxed validation behind an environment gate | Only a finding if the gate can be true in production builds. Read the gate. |

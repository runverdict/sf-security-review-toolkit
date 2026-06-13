# Dimension: web-client

The browser-delivered half of the product: token/session custody in the
client, the security headers the server sends with it, CSRF posture, framing
and cross-window messaging, and what the shipped bundle reveals. Applies when
the scope manifest shows a browser-delivered frontend — a web app, a
Canvas-embedded app, or packaged LWC/Aura UI. Boundaries: the *escaping* of
rendered data is `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/injection-xss.md`;
secrets baked into bundles are
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/secrets-credentials.md`;
OAuth redirect/callback correctness is
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/oauth-identity.md`. This
dimension owns the browser's side of the trust relationship.

## 1. Threat concept

The review probes the web client both ways: the DAST pass and the reviewers'
own pen test exercise the live surface against the OWASP bar (baseline:
`endpoint-owasp-top10-bar`), checking cookies (baseline:
`endpoint-secure-cookies`), CSRF on state changes (baseline:
`endpoint-csrf-protection`), and — for anything framed inside Salesforce —
the CSP `frame-ancestors` contract (baseline:
`endpoint-csp-canvas-frame-ancestors`). Canvas raises the stakes: an embedded
app is *deliberately* frameable by Salesforce, so the headers must be scoped
with precision, and the signed-request handoff makes token custody in the
browser a designed-in problem rather than an accident.

Sub-classes, ordered by how they fail reviews:

1. **Token custody.** Long-lived tokens in `localStorage`/`sessionStorage`
   (readable by any XSS — one injection becomes durable account takeover),
   session cookies missing `Secure`/`HttpOnly`/`SameSite`, tokens minted
   into URLs or `postMessage`d to other windows. Canvas-embedded apps face
   the third-party-cookie wall — the field-proven shapes (short-lived
   handoff via redirect, partitioned cookies) each have sharp edges worth
   reading, not assuming.
2. **CSRF where cookies authenticate.** Any state-changing endpoint
   authenticated by an ambient cookie needs a CSRF defense (token,
   double-submit, or strict `SameSite` plus a custom-header requirement).
   Pure bearer-token APIs are architecturally immune — but that claim must
   be *verified* (one cookie-authenticated route in a "bearer-only" API
   re-opens the class) and then documented in the FP dossier rather than
   left for the DAST report to flag (baseline: `endpoint-csrf-protection`).
   CORS is the read-side twin: a server that reflects an arbitrary `Origin`
   back with `Access-Control-Allow-Credentials: true` hands the same ambient
   cookie to any site for cross-origin *reads* — judge the origin allowlist
   with the same rigor as the CSRF defense.
3. **Framing and cross-window trust.** `frame-ancestors` absent (clickjacking
   on the standalone app) or over-broad (`*` makes the Canvas app embeddable
   by any site, defeating the point); a conflicting `X-Frame-Options` header
   shipped alongside CSP on the framed paths; `postMessage` handlers that
   skip origin validation (a Canvas shell's message channel is exactly such
   a handler) or send tokens with `targetOrigin: '*'`.
4. **Client-side authorization theater.** Role checks that exist only in the
   UI — hidden menu items, route guards — with the underlying API trusting
   any caller. The finding belongs to the server dimension that owns the
   route (tenant-isolation, admin-surface); what this dimension reports is
   the *discoverability*: bundles shipping the full admin route map, feature
   flags, and internal endpoint inventory to every anonymous visitor.
5. **Bundle and dependency hygiene.** Source maps exposing server-shaped
   internals in production, vulnerable pinned front-end libraries (the
   scanner's job to enumerate — baseline: `scan-dependency-vulnerabilities`;
   this dimension reports a specific exploitable usage), third-party scripts
   loaded without SRI from CDNs. Packaged platform UI has its own rule:
   scripts/styles load from static resources, not hotlinks (baseline:
   `fail-js-not-static-resources`), and component hygiene (exposed message
   channels, legacy API versions) is scanner-detected (baseline:
   `fail-lightning-component-hygiene`) — read what the greps surface, don't
   duplicate Code Analyzer.

## 2. What good looks like

- **Cookies carry the full flag set**: `Secure`, `HttpOnly`, explicit
  `SameSite` (Lax minimum; None only with a written reason — e.g. a Canvas
  embed — and then `Partitioned` where the design depends on third-party
  cookie survival). Session identifiers never in URLs.
- **Tokens live in memory or HttpOnly cookies, not Web Storage.** SPA
  access tokens held in memory with a silent-refresh flow; anything
  persistent is HttpOnly. If Web Storage is used anyway, the design
  document says why and what compensates (short TTL, rotation, scoping) —
  and the AuthN/AuthZ artifact (baseline: `artifact-authn-authz-flow-doc`)
  matches the code.
- **CSRF posture is explicit, not incidental.** Cookie-authenticated state
  changes carry a validated CSRF token or equivalent; the bearer-only claim,
  where made, is true for *every* mutating route and written into the FP
  dossier with the route inventory as evidence.
- **Headers scoped per path.** Standalone app paths: `frame-ancestors 'none'`
  (or self). Canvas-framed paths only: `frame-ancestors` scoped to the
  Salesforce domain family — and no `X-Frame-Options` on those paths to
  conflict (baseline: `endpoint-csp-canvas-frame-ancestors`). A real CSP
  beyond framing (script-src without `unsafe-inline`, or with nonces;
  Trusted Types where the stack supports it) is the defense-in-depth layer
  XSS findings get judged against.
- **`postMessage` both ways, both checks.** Receiving: origin validated
  against an allowlist before any payload handling. Sending: concrete
  `targetOrigin`, never `'*'`, for anything carrying state or tokens.
  Canvas signed-request payloads handled per
  `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/sessionid-egress.md` —
  verified, used transiently, never persisted client-side.
- **Production builds ship production artifacts.** No source maps on prod
  (or sourcemaps without inlined sources), no `.env`-shaped config in the
  bundle beyond intentionally public values, third-party scripts pinned
  with SRI or vendored. Packaged platform UI: everything from static
  resources, current component API versions.

## 3. Detection heuristics

The client code names its sins: storage calls, header configs, and message
handlers are all greppable. Resolve both the frontend source and the
server/proxy layer that sets headers.

**All stacks** — grep seeds: `localStorage`, `sessionStorage`,
`document.cookie`, `Set-Cookie`, `SameSite`, `HttpOnly`, `Partitioned`,
`postMessage`, `addEventListener("message"`, `event.origin`,
`frame-ancestors`, `X-Frame-Options`, `Content-Security-Policy`,
`csrf`, `xsrf`, `X-CSRF`, `credentials: "include"`, `withCredentials`,
`Access-Control-Allow-Origin`, `CORSMiddleware` / `allow_origins` / `cors(`,
`integrity=` (SRI presence), `devtool`/`sourcemap` in build configs,
`window.opener`, `target="_blank"` without `rel`.

| Stack | Where to look |
|---|---|
| Next.js/React SPA | `next.config.*` `headers()` blocks or the proxy that owns headers; auth context/hooks for where the token lands after login (memory vs storage); fetch wrappers (`credentials` mode, CSRF header injection); middleware setting cookies. |
| Server frameworks | Cookie-setting call sites (session middleware config — `secure`, `httponly`, `samesite` kwargs); CSRF middleware presence and which routes are exempted (`csrf_exempt`, `ignore` lists — the exemption list IS the target list); security-header middleware (helmet config, `SecurityMiddleware`, custom header maps). |
| nginx/CDN config (when in repo) | `add_header` for CSP/XFO — per-location scoping for Canvas paths; note `add_header` inheritance pitfalls (a location block with any `add_header` drops the parent's). |
| Canvas/LWC/Aura | The Canvas shell JS (signed-request handling, `postMessage` channel, what gets stored where after the handoff); `*.cmp`/LWC templates hotlinking CDNs vs `$Resource`/`loadScript`; `isExposed`/message-channel metadata; component API versions in `*.js-meta.xml`. |
| Build configs | `webpack`/`vite`/`next` production settings: `productionBrowserSourceMaps`, `devtool`, define-plugin injected values. |

Also resolve: the route inventory of mutating endpoints and which auth
mechanism each uses (the input for verifying any "bearer-only, CSRF-immune"
claim), and which paths are designed to be framed (the Canvas contract).

## 4. Finder prompt block

```
Primary targets (read these first, then follow imports/call-sites; use grep to
locate the real files when a path is approximate):
{{TARGETS}}

Stack notes (claims from the partner's own docs — verify against the ACTUAL
code, never assume):
{{STACK_NOTES}}

Threat focus — the browser-delivered surface: token custody, headers, CSRF,
framing, messaging, bundle hygiene. Probe: where tokens/sessions live after
login (localStorage/sessionStorage holding anything long-lived; cookie flags
— Secure/HttpOnly/SameSite, Partitioned where a third-party embed depends on
it; tokens in URLs); CSRF (inventory the state-changing routes and the auth
mechanism of each — cookie-authenticated mutations need a validated CSRF
defense; a claimed bearer-only architecture must hold for EVERY mutating
route, then becomes an FP-dossier entry, not a silent assumption; check
exemption lists — csrf_exempt and ignore arrays are where the bypasses
live); CORS (read the middleware/header config — an allowlist that reflects
the request Origin back, or pairs a wildcard with credentials, grants
cross-origin reads of cookie-authenticated responses; regex/startsWith
origin matching is bypassable); framing (frame-ancestors on standalone paths 'none'/self; on
Canvas-framed paths scoped to the Salesforce domain family with NO
conflicting X-Frame-Options on those same paths; CSP beyond framing —
script-src posture, unsafe-inline); cross-window messaging (every
message-event listener — is event.origin validated against an allowlist
BEFORE the payload is used; every postMessage send carrying state — concrete
targetOrigin or '*'); window.opener leaks on user-content links; client-side
authorization theater (role checks existing only in the UI — flag the
DISCOVERABILITY here in one line and route the missing server check to the
owning dimension, don't double-report); bundle hygiene (production source
maps, internal endpoint maps/flags shipped to anonymous visitors, third-party
scripts without SRI, CDN hotlinks in packaged platform UI which must use
static resources). Cookie-flag and header findings you can ground in config
ARE in scope here; live-response verification belongs to the DAST pass —
say which evidence you have.

Known findings — do NOT re-report any of these:
{{LEDGER}}

Report ONLY findings grounded in code you have READ, with exact file:line.
Prefer precision over volume — a false alarm wastes the verifier's time and
the partner's. If a control is correctly implemented, do NOT report it (one
info-level note for a notably strong control is allowed). For each finding
give a concrete exploit_scenario: the attacker (XSS payload author, framing
site, malicious window, network observer), the action they take, and what
session, token, or operation they capture.
```

## 5. Verifier guidance

- **Headers: find the layer that actually serves them.** App-framework
  header config is refuted or confirmed by the proxy in front of it — an
  nginx `add_header` in a matching location block can drop or override the
  app's CSP (inheritance: any `add_header` in a child block discards the
  parent's set). Read every layer between app and edge that the repo shows
  before confirming a missing/conflicting header.
- **For storage claims, identify the token's lifetime and power.** A
  short-lived, narrowly-scoped token in sessionStorage during an OAuth
  handoff is a different severity than a refresh token in localStorage.
  Confirm what the stored value can actually do before setting severity.
- **For CSRF claims, identify the authenticating mechanism of the cited
  route.** A bearer-token route with no cookie auth refutes (note it for the
  dossier); a route that accepts BOTH bearer and session-cookie auth
  confirms — dual-auth routes are where "bearer-only immunity" quietly
  fails. Check `SameSite`: strict/lax on the session cookie downgrades many
  CSRF claims; read the actual flag, not the default assumption for the
  framework version.
- **For postMessage claims**: an origin check via `startsWith`/`includes`
  is bypassable (`https://trusted.example.evil.com`) — confirm exact-match
  or URL-parsed origin comparison before refuting. The same test applies to
  a CORS origin matcher.
- **For Canvas-frame claims**: the framed paths are SUPPOSED to be
  frameable by Salesforce — `frame-ancestors` scoped to the Salesforce
  domain family on those paths refutes a clickjacking claim there. The
  finding is over-breadth (`*`, missing scoping) or the same relaxation
  applied to non-Canvas paths.
- **For bundle claims**: confirm the artifact actually ships (the build
  config's production branch, not the dev default), and that the exposed
  value matters — route names alone are recon-grade (low/info), credentials
  or signed URLs are real.

## 6. Known false-positive patterns

| Pattern | Why it is not a finding |
|---|---|
| `frame-ancestors` allowing the Salesforce domain family on Canvas-served paths | The Canvas contract (baseline: `endpoint-csp-canvas-frame-ancestors`) — embedding is the feature. Over-breadth (`*`) or leakage onto non-Canvas paths is the finding, not the allowance. |
| `SameSite=None; Secure; Partitioned` on an embed cookie | The deliberate third-party-embed pattern. Judge the cookie's content and TTL, not the SameSite value the embed requires. |
| No CSRF token on a pure bearer-token API | Architecturally immune *if* no mutating route accepts cookie auth — verify the inventory, then it's a documented FP-dossier entry (baseline: `endpoint-csrf-protection`), not a finding. |
| OAuth client_id, public API base URLs, analytics write keys in the bundle | Public by design (`secrets-credentials` owns the judgment); only a *private* value in the bundle is a finding. |
| A dev-server config with relaxed headers/source maps behind a non-production build branch | Read the production branch of the build config before flagging; dev defaults are not shipped artifacts. |
| Anonymous visitors can fetch the SPA's JS and see route paths | Bundles are public by nature; route names alone are recon, info at most. Internal credentials or admin API maps with predictable parameters raise it. |
| `localStorage` used for UI preferences, feature-tour state, non-auth data | Not a credential. The class is about tokens/session material. |
| `Access-Control-Allow-Origin: *` on anonymous, credential-free endpoints | Browsers refuse to pair the wildcard with credentials; on a public read-only API it is the intended posture. The finding is origin reflection with credentials, or a bypassable matcher, on cookie-authenticated routes. |
| Missing HSTS header in app code when TLS terminates at a managed edge | Often set by the edge; verify the live header via the run-scans evidence before reporting from code absence alone (baseline: `endpoint-hsts`). |

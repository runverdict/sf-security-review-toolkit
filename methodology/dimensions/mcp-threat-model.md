# Dimension: mcp-threat-model

The threat classes the MCP specification itself names — token passthrough,
audience validation, confused deputy, tool poisoning, SSRF through
agent-influenced fetches. Applies when the scope manifest shows an MCP server.
These are the classes **beyond classic AppSec**: a server can pass every
OWASP-shaped probe in
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/mcp-surface.md` and still
violate every rule in this file. Boundaries: the authorization server's own
defects (PKCE, redirect URIs, DCR abuse) belong to
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/oauth-identity.md`; signing and
algorithm mechanics to
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/crypto-internals.md`; the
*landing* of injected content in outbound messages to
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/email-outbound.md`. The
agent-egress split: this dimension owns whether an **agent-controlled URL**
in a tool output can reach a non-allowlisted host and whether returned CRM
text is acted on as instructions (the agent/ForcedLeak class — see the
Threat-concept list and the §4 finder block);
`email-outbound` owns the generic message-construction injection/encoding of
the message body itself. When both apply to one path, file it under the root
cause — agent-driven egress here, body-encoding there.

## 1. Threat concept

Whether the Salesforce review explicitly tests these vectors or finds them
incidentally in its own pen test is unconfirmed (baseline:
`mcpthreat-review-applicability`) — the engine audits them regardless: they
are spec MUSTs, they produced the 2025–26 MCP CVE wave at scale, and an
exploitable instance fails the reviewer's pen test whether or not a checklist
names it.

The classes, in the order a verifier should fear them:

1. **Token passthrough.** The server receives a bearer token from its client
   and forwards it to a downstream API. Explicitly prohibited by the
   2025-06-18 spec (baseline: `mcpthreat-token-passthrough-prohibited`): it
   breaks audit trails, bypasses every downstream control keyed on the
   server's own identity, and is the mechanical half of a confused-deputy
   attack. Often one line — a proxy/fetch wrapper copying inbound
   `Authorization` onto outbound requests. (When the forwarded token is a
   *Salesforce* credential it is simultaneously the auto-fail class — see
   `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/sessionid-egress.md`; that
   dimension owns the Salesforce-credential case, this one owns the general
   passthrough prohibition.)
2. **Missing audience validation.** Tokens accepted because the signature and
   expiry check out — without verifying the token was issued *for this
   server* (RFC 8707 resource indicators; baseline:
   `mcpthreat-resource-indicators-audience`). A token minted for any other
   service under the same issuer then authenticates here. The check belongs
   on **every request**, not at session start, and the resource server must
   reject wrong-audience tokens with 401. The OAuth 2.1 resource-server
   posture travels with it: bearer tokens in the `Authorization` header only,
   never query strings (baseline: `mcpthreat-oauth21-pkce`).
3. **Confused deputy.** The server holds privileged credentials to third-party
   APIs and lets one principal's request spend another principal's authority:
   a consent flow whose `state` is replayable or unbound, a static client ID
   fronting a dynamic client population, a per-user third-party token cached
   and served keyed on the wrong identity (baseline:
   `mcpthreat-confused-deputy-consent`). What good looks like is a
   server-side consent registry keyed on user *and* client, single-use
   short-lived state, and downstream credentials resolved per authenticated
   principal — never one service token spent on behalf of whoever asks.
4. **Tool poisoning and instruction-bearing data.** Tool descriptions are
   LLM-visible and can smuggle directives; data the tools return (CRM
   records, emails, file contents) can carry instructions that redirect the
   agent (baseline: `mcpthreat-prompt-injection-tool-poisoning`). The
   server-side duties: description integrity (descriptions assembled from
   static, reviewed strings — not from tenant data or upstream services at
   runtime), suspicious-pattern hygiene (hidden Unicode,
   instruction-shaped markup), and separation of untrusted data from
   instructions in any prompt assembly the server itself performs.
5. **SSRF through agent-influenced fetches.** Any URL the server fetches that
   a tool parameter, a stored record, or OAuth metadata discovery can
   influence — unvalidated, it reaches cloud metadata endpoints and internal
   services (baseline: `mcpthreat-ssrf-mitigation`; the highest-CVSS MCP CVE
   of the 2025–26 wave was an unsanitized-URL RCE). Webhook/notification
   URLs configured by tenants land here too (the outbound-message half is
   `email-outbound`; this dimension owns the fetch itself when the MCP
   surface is what exposes it).
6. **Provisioning conformance.** RFC 7591 dynamic client registration
   supported, or the documented alternative actually usable and described in
   the AuthN/AuthZ artifact (baseline:
   `mcpthreat-dcr-or-documented-alternative`). DCR *abuse* (anonymous spam,
   metadata injection) is oauth-identity's probe; this dimension checks the
   conformance/documentation side. Supply-chain pinning for MCP framework
   components (baseline: `mcpthreat-supply-chain`) is detected by the
   dependency scanners in `/sf-security-review-toolkit:run-scans` — report
   here only a *specific* exploitable usage, not a version bump.
7. **Agent / ForcedLeak data-exfiltration (the forward-looking class).**
   The AgentExchange-era class no traditional Salesforce SAST covers: the
   Agentforce ForcedLeak class — indirect prompt injection driving data
   egress to a stale/attacker-controlled allowlisted domain. Three
   reinforcing failures, each on its own a finding, chained the way ForcedLeak
   chained them:
   - **Output-egress to a non-allowlisted host.** Any tool output or render
     path that lets an *agent-controlled* value become a URL the platform
     resolves — a Markdown image/link the client auto-renders, an `<img
     src>`/`<a href>` in returned HTML, an email recipient/CC/link, a
     webhook/callback target — without checking the destination host against
     a server-side allowlist *before* emission. The agent names the host;
     the platform fetches it; whatever the tool placed in the URL or its
     query string leaves the tenant. The egress allowlist must gate the
     output side, not only the inbound SSRF fetch (class 5 owns the *fetch*;
     this owns the *emit*).
   - **Stale / expired allowlist entry.** ForcedLeak's literal root cause: an
     egress allowlist (`CspTrustedSites`, Trusted URLs, RemoteSiteSettings,
     or an in-code host list) still trusting a domain the partner no longer
     owns — parked, lapsed, or transferable. An attacker re-registers it and
     every "allowlisted" egress lands on attacker infrastructure. Wildcard
     and `http://` entries are the adjacent smell. (The live inventory of
     these entries is auto-resolved by `scope-submission`'s `sf` pass from
     `CspTrustedSites` + `RemoteSiteSettings`; this dimension reasons about
     staleness and over-breadth, the scan owns enumeration.)
   - **Untrusted CRM text rendered/acted-on as instructions.** Indirect
     prompt injection: a tool returns a record field (Description, Notes,
     Subject, case/email body — any tenant- or third-party-writable string)
     and that text reaches the agent or a downstream prompt as *instructions*
     rather than fenced as *data*. A low-privilege user writes a record; once
     a tool returns it, the embedded directive redirects the agent to call
     another tool or emit an egress URL — closing the loop with the two
     failures above. This is the same untrusted-data-as-instructions concern
     as tool poisoning (class 4), but sourced from **returned record data**
     rather than tool descriptions, and aimed at **triggering egress** rather
     than subverting tool selection.

## 2. What good looks like

- **Downstream credentials are always the server's own.** Outbound calls to
  third-party APIs authenticate with credentials the server obtained for
  itself (service credentials, or a proper on-behalf-of exchange that mints a
  *new* token) — never the inbound bearer replayed. The outbound HTTP layer
  has no code path that copies inbound auth headers.
- **Audience validation in the middleware, on every request.** Signature,
  issuer, expiry, **and audience** checked before any tool dispatch; the
  expected audience is the server's canonical URI from configuration, not a
  value derived from the request (`Host` header audience derivation is
  spoofable behind misconfigured proxies). Wrong audience → 401, identical
  in shape to any other auth failure.
- **Consent and identity binding that names both parties.** Where the server
  proxies user-delegated access to third parties: consent recorded per
  (user, client) pair; OAuth `state` single-use, short-lived, bound to the
  session that started the flow; third-party tokens stored keyed on the
  authenticated user id and never resolvable by a different user's request.
  Encryption-at-rest posture for those stored tokens is
  `secrets-credentials`' probe; the *keying* is this dimension's.
- **Tool descriptions are code, not data.** Defined statically in the
  registry, reviewed in PRs like any interface contract, never concatenated
  from tenant content, upstream API responses, or LLM output. Where the
  server assembles prompts from retrieved data, untrusted content is
  delimited/fenced and the assembly treats it as data.
- **One egress gate for server-side fetches.** URL-accepting code paths
  resolve and validate the destination (scheme allowlist, deny
  private/reserved/link-local ranges including IPv6, re-validate after
  redirects — or use a vetted SSRF library / egress proxy) before any
  request. DNS-rebinding-aware where the fetch target is long-lived.
- **One egress gate for tool OUTPUT, too.** Any host an agent-controlled
  value could turn into a resolvable URL — in returned Markdown/HTML, an
  email link/recipient, a webhook target — is checked against a server-side
  destination allowlist *before* the output is emitted, and that allowlist
  holds only domains the partner currently owns (no parked/expired entries,
  no wildcards, HTTPS only). Returned record text is fenced as data, never
  spliced into instructions or a prompt the agent then acts on. The
  allowlist is maintained — entries are re-verified as still partner-owned,
  because a lapsed allowlisted domain is the ForcedLeak exfiltration path.
- **The artifact trail matches.** The AuthN/AuthZ flow document describes the
  audience check, the consent model, and the downstream-credential design —
  and the code does what the document says. A claim the code contradicts is
  worse than no claim.

## 3. Detection heuristics

Locate the token-validation middleware, the outbound HTTP layer, the
third-party credential store, the tool registry, and every URL-accepting
input.

**All stacks** — grep seeds: `aud`, `audience`, `resource`, `verify_aud`,
`issuer`, `Authorization` near outbound-client code (`httpx`, `fetch`,
`axios`, `requests`, `HttpClient`), `on_behalf_of`, `token_exchange`,
`state` near OAuth callback handlers, `consent`, `webhook_url`,
`callback_url`, `urlopen` / `requests.get(` / `fetch(` with variable
arguments, `0.0.0.0` / `169.254` / `10.` in validation code (presence is
good — someone thought about ranges; absence near user-URL fetches is the
lead), tool-description definition sites (`description=`, `"description":`).
For the agent/ForcedLeak class — output-egress sinks and allowlist entries:
`![`/`](` and Markdown/HTML assembly in tool *return* values, `<img`,
`<a href`, `mailto:`, `send_email`/`sendmail`/`Messaging.sendEmail`,
`to=`/`recipient`/`cc`/`bcc`, `webhook`/`notify`/`callback` near outbound
emit, `allowlist`/`allow_list`/`allowed_hosts`/`trusted_hosts`/
`CspTrustedSites`/`RemoteSiteSetting` (read the *contents* — which domains,
any `*` wildcard, any `http://`, any host the partner may no longer own),
and — for untrusted-text-as-instructions — CRM field reads (`Description`,
`Notes__c`, `Subject`, `.body`, `comments`) whose value flows into a prompt
string, an agent message, or a rendered output without a
fence/escape/sanitize step between the read and the use.

| Stack | Where to look |
|---|---|
| Python | The JWT/token decode call: does `decode(...)` pass `audience=`/check `aud` explicitly, or disable it (`verify_aud: False`)? Outbound wrappers in a `clients/` or `services/` module — read every place request headers are constructed; `httpx.AsyncClient` default-header setup. Consent/state: the OAuth callback route and whatever persists `state`. |
| Node | `jsonwebtoken.verify` options (`audience`), `jose` `jwtVerify` options; axios instances with `Authorization` defaults copied from `req.headers`; `fetch(req.body.url)`-shaped sinks; SSRF guards (`ssrf-req-filter`, manual IP checks). |
| Any | Reverse-proxy / API-gateway configs that strip or forward `Authorization` downstream; environment config naming third-party service tokens (one static token for all tenants is the confused-deputy smell when per-user delegation is claimed). |
| Tool registry | Wherever descriptions are defined — flag any description built with string interpolation from non-literal sources. |

Also resolve: the documented downstream-auth design (stack notes carry the
claim; verify it), and the redirect-following behavior of the HTTP client
used for any user-influenced fetch (auto-follow re-opens validated URLs).

## 4. Finder prompt block

```
Primary targets (read these first, then follow imports/call-sites; use grep to
locate the real files when a path is approximate):
{{TARGETS}}

Stack notes (claims from the partner's own docs — verify against the ACTUAL
code, never assume):
{{STACK_NOTES}}

Threat focus — the MCP-spec threat classes beyond classic AppSec. Probe:
token passthrough (read EVERY outbound HTTP construction site — does any path
copy or forward the inbound bearer/Authorization header to a downstream API;
proxy or fetch wrappers that pass headers through wholesale); audience
validation (find the token verification call — is `aud` checked against the
server's canonical URI from CONFIG on every request, or is verification
signature+expiry only, or aud derived from the Host header; do wrong-audience
tokens get 401); confused deputy (where the server holds third-party
credentials: is downstream authority resolved per authenticated principal or
is one privileged/static credential spent on behalf of any caller; OAuth
state on consent flows — single-use, short-lived, bound to the initiating
session; cached third-party tokens keyed on WHICH identity); tool poisoning
surface (are tool descriptions static reviewed strings or assembled at
runtime from tenant data / upstream responses / LLM output; any prompt
assembly the server performs — is retrieved untrusted data separated from
instructions; hidden-Unicode or instruction-shaped content reaching
LLM-visible fields); SSRF (every fetch whose URL a tool parameter, stored
record, tenant config, or discovery document can influence — scheme
allowlist, private/reserved/link-local IP denial including IPv6, redirect
re-validation, DNS rebinding for long-lived targets); provisioning
conformance (DCR endpoint present, or the documented alternative actually
implemented and matching the AuthN/AuthZ artifact's claim); audience at
tool-call time (is the `aud`/RFC 8707 resource-indicator check applied on
EVERY tool dispatch, not just at session start — a token minted for a
sibling service under the same issuer must be rejected with 401 at the tool
call, not silently accepted because the session already opened). Then the
agent/ForcedLeak class (the forward-looking moat — no traditional SF SAST
covers it; the Agentforce ForcedLeak class — indirect prompt injection
driving data egress to a stale/attacker-controlled allowlisted domain):
output-egress allowlist (trace
EVERY tool output and render path — does any agent-controlled value reach an
egress sink as a URL the platform will resolve: a Markdown image/link the
client renders, an `<img src>`/`<a href>` in returned HTML, an email
recipient/CC/body link, a webhook/callback URL, a notification target — and
is that destination host checked against a server-side allowlist BEFORE
emission, or can the agent name an arbitrary off-platform host that then
exfiltrates whatever the tool put in the URL/query string); allowlist
staleness / expired-domain (read the CspTrustedSites + Trusted-URL +
RemoteSiteSetting + any in-code egress allowlist entries — flag entries
pointing at a domain that is parked, lapsed, or no longer owned by the
partner, since a stale allowlisted host is ForcedLeak's literal root cause:
an attacker re-registers the expired domain and every "allowlisted" egress
now lands on attacker infrastructure; flag wildcard and `http://` entries
here too); untrusted-CRM-text-as-instructions (find every tool return field
that carries CRM record text — Description, Notes, Subject, Comments,
email/case body, any tenant- or third-party-writable string — and check
whether that text is handed to the agent or a downstream prompt/render as
INSTRUCTIONS rather than fenced as DATA; indirect prompt injection is a
record a low-privilege user can write that, once a tool returns it,
redirects the agent to call another tool or emit an egress URL). Dependency
versions are out of scope here (separate scanners) — report a supply-chain
item only when a SPECIFIC exploitable usage exists in this code.

Known findings — do NOT re-report any of these:
{{LEDGER}}

Report ONLY findings grounded in code you have READ, with exact file:line.
Prefer precision over volume — a false alarm wastes the verifier's time and
the partner's. If a control is correctly implemented, do NOT report it (one
info-level note for a notably strong control is allowed). For each finding
give a concrete exploit_scenario: the attacker (wrong-audience token holder,
malicious tenant, compromised upstream), the request or content they supply,
and what authority or data it reaches.
```

## 5. Verifier guidance

- **For passthrough claims, identify whose token it is.** Forwarding the
  server's *own* service credential is the intended design; forwarding the
  *inbound caller's* token is the violation. Trace the variable to its
  origin — the request header confirms, the config/credential store refutes.
  An on-behalf-of exchange that mints a new downstream token refutes.
- **For audience claims, read the verification options object**, not the
  middleware's existence. `decode()` with audience verification disabled
  three lines below an "auth required" decorator is the classic miss; equally,
  a wrapper that always passes `audience=settings.canonical_uri` refutes the
  finding wherever that wrapper is used. Check for a second, older decode
  path (web vs MCP, v1 vs v2 routes) before refuting globally.
- **For confused-deputy claims, find the keying.** Read the storage schema
  and the lookup: third-party tokens fetched by authenticated user id refute;
  fetched by client id, tenant id alone, or "first match" confirm. A static
  service credential is only a finding if per-user delegation is claimed or
  required for the data involved.
- **For tool-poisoning claims, distinguish surface from exploit.** A
  description assembled from runtime data is confirmable as the *mechanism*;
  severity depends on who controls the source (tenant-controlled → high;
  operator-controlled config → low/info). A static description that merely
  *could* be misread by an LLM is not a finding.
- **For SSRF claims, execute the validator mentally against the classic
  bypasses**: decimal/octal IP encodings, IPv6 mapped addresses, redirects
  to internal hosts, DNS names resolving to private ranges. A
  hostname-allowlist (not IP-blocklist) design with no user-supplied URLs at
  all refutes; a blocklist missing redirect re-validation is
  `partially_real` at minimum if any user-influenced URL reaches it.
- **For output-egress claims, prove the value is agent-controlled AND the
  host is unchecked.** Trace the value that becomes the URL back to its
  source: if it is a literal/config host or a fixed template, refute; if a
  tool parameter, a returned record field, or LLM output can set the host (or
  a query parameter that exfiltrates data), it is reachable. Then read the
  emit path for a server-side destination-allowlist check *before* emission —
  its presence refutes, its absence (or an allowlist applied only to inbound
  fetches, not to output) confirms. A rendered surface that auto-resolves the
  URL (Markdown image, email link the client fetches) is required for exfil;
  a value merely logged as text is not egress.
- **For stale-allowlist claims, do not guess domain ownership.** The code/
  metadata evidence (an `http://` entry, a `*` wildcard, an obviously broad
  third-party host) supports the finding; an actual expired-registration
  claim is owner-confirmable, not code-confirmable — mark it
  `partially_real` and route the "verify each allowlisted domain is still
  partner-owned" step to the owner rather than asserting expiry the agent
  cannot observe. Wildcard/`http://` entries stand on their own as findings.
- **For untrusted-text-as-instructions claims, find the fence.** The finding
  requires a *writable* CRM field (tenant- or third-party-controlled) flowing
  into an agent prompt or a rendered/acted-on output with no delimiter,
  escape, or "treat as data" framing between read and use. If the value is
  fenced, schema-constrained to a safe type, or only ever displayed as inert
  text the agent never acts on, refute. Operator-only or static fields are
  `low`/`info`, not high.
- **Reachability first, always**: a violating code path behind an
  operator-only config flag or dead feature is `low`/`info` with a note, not
  the headline severity.

## 6. Known false-positive patterns

| Pattern | Why it is not a finding |
|---|---|
| The server attaches ITS OWN service token (from config/vault) to downstream calls | The intended replacement for passthrough — the server's identity, the server's credential. Verify the variable's origin before assuming it came from the request. |
| An on-behalf-of / token-exchange flow that sends the inbound token TO THE ISSUER to mint a downstream token | Token exchange with the authorization server is the sanctioned pattern, not passthrough — the inbound token goes back to its issuer, not to a third-party API. |
| `resource` parameter absent from a client_credentials token request in a closed two-party deployment | Audience can be enforced via issuer-side token configuration; the finding is the SERVER not validating `aud`, not the client not sending `resource`. Read the validation side before confirming. |
| Tool descriptions containing imperative language ("use this when…") | Normal tool-authoring style for LLM consumption. Poisoning requires smuggled directives that subvert the agent, not instructions about the tool's own use. |
| The server fetches a FIXED, config-defined upstream URL | No user influence, no SSRF. The finding requires attacker-influenceable input to the URL. |
| OAuth discovery (`/.well-known/*`) fetched over HTTPS from the configured issuer at boot | Standard metadata resolution from a trusted, operator-set origin. |
| No DCR endpoint, but pre-registered clients documented in the AuthN/AuthZ artifact | The spec-sanctioned alternative (baseline: `mcpthreat-dcr-or-documented-alternative`) — only a finding if the alternative is undocumented or unusable. |
| MCP SDK pinned to a version with a known CVE in an unused module | Dependency-scanner territory (`/sf-security-review-toolkit:run-scans`); report here only with a reachable exploitable usage. |
| A tool output URL built ONLY from a fixed config host or a literal template (no tool-param/record/LLM value in the host or query) | No agent-controlled egress — the destination is operator-set. Output-egress requires an attacker-influenceable host or an exfiltrating query parameter. |
| An allowlist entry the verifier merely *suspects* is expired, with no code/metadata evidence | Domain-ownership/expiry is owner-confirmable, not code-confirmable — route it to the owner as a verification step, do not assert expiry the agent cannot observe. (A `*` wildcard or `http://` entry is a standalone finding regardless.) |
| Returned CRM text rendered as INERT display only — escaped/fenced, never spliced into a prompt the agent acts on | Untrusted-text-as-instructions requires the text to reach the agent or a downstream prompt AS instructions; displayed-as-data with a fence is the correct control, not the vulnerability. |

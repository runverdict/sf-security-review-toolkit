# Dimension: sessionid-egress

Salesforce session identifiers leaving the platform — the review's
**automatic-fail rule** (baseline: `fail-sessionid-egress`). Applies whenever ANY
Salesforce touchpoint exists in scope (managed package, Canvas app, API
integration). It is cheap to run and catastrophic to miss, so the engine keeps
it always-on when Salesforce-adjacent code exists.

## 1. Threat concept

A Salesforce SessionId is a bearer credential for the user's entire org
session. Sending it outside the platform — to a partner API, a log pipeline,
an analytics service — hands the receiving system (and anyone who later reads
its storage or logs) the user's Salesforce access. Salesforce treats this as
an automatic security-review failure with no remediation-by-justification path
(baseline: `fail-sessionid-egress`); it is also one of the few classes the
automated scanners detect with near-zero false negatives, so shipping it
guarantees a burned review cycle.

The violation has two homes, and partners reliably audit only the first:

1. **Package code** — Apex/Visualforce/Aura retrieving the session id
   (`UserInfo.getSessionId()`, `{!$Api.Session_ID}`, `GETSESSIONID()`) and
   attaching it to an outbound callout, header, or URL. The sanctioned
   replacements are Named Credentials / External Credentials (per-principal
   OAuth the platform manages) or a dedicated integration user.
2. **External code** — the partner's own service receiving Salesforce-issued
   tokens inbound and then *retaining or re-emitting* them: logging the
   `Authorization` header, persisting a raw token to the database, forwarding
   it to a third-party API (token passthrough — also an MCP-spec violation,
   see `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/mcp-threat-model.md`),
   or shipping it to an error tracker. Canvas apps are the sharpest case: the
   signed request Salesforce POSTs to a Canvas endpoint *contains* an OAuth
   token by design — receiving it is the protocol; persisting it, logging it,
   or using it as the app's own session is the violation.

The review cares because this is a platform-trust boundary, not a
vulnerability probability: the rule is absolute, and the reviewers' static
scan plus their own traffic inspection both look for it.

## 2. What good looks like

- **Package side**: zero session-id retrieval reaching any callout. All
  outbound HTTP goes through Named/External Credentials
  (`callout:CredName/...`, `{!$Credential...}` merge fields). Where Apex needs
  same-org API access, it still avoids raw session ids in favor of the
  platform's credential plumbing — scanner rules flag every retrieval site,
  and each surviving one needs a documented justification in the
  false-positive dossier (`${CLAUDE_PLUGIN_ROOT}/templates/fp-dossier.md.tmpl`).
- **External service side**: inbound Salesforce-issued bearer tokens are
  validated, used for the single authorization decision, and discarded. The
  service mints **its own** first-party session/token after verifying the
  inbound credential (e.g. verifying a Canvas signed-request HMAC and minting
  an app session from the claims). Salesforce tokens never become the app's
  session mechanism.
- **No raw retention**: if a token must be deduplicated or correlated, store a
  hash, never the value. OAuth refresh tokens obtained through the partner's
  *own* connected-app integration flow are a different object — those are the
  documented CRM-integration pattern and are stored encrypted at rest (storage
  posture: `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/secrets-credentials.md`).
- **Redaction as configuration, not discipline**: the logging layer strips or
  masks `Authorization` (and any custom token headers) centrally — request
  loggers, access logs, error trackers (e.g. an APM's
  "send default PII"-style switches off), and crash reports. No tokens in
  URLs/query strings anywhere, because access logs and referrers capture
  query strings by default.
- **Debug surfaces fail safe**: no endpoint or error page that echoes request
  headers back; no verbose exception handler serializing the request object.

## 3. Detection heuristics

Two sweeps: package metadata/code, then the external service's inbound-token
dataflow (source → sink).

**Apex/Visualforce/Aura/LWC (primary)** — grep seeds:
`getSessionId` (Apex), `Session_ID` / `$Api.Session_ID` (Visualforce),
`GETSESSIONID` (formulas), `sessionId` near `HttpRequest` / `setHeader` /
`setEndpoint`, string-concatenated `Authorization` headers. The good pattern to
recognize: endpoints of the form `callout:Name` and `{!$Credential…}` merge
fields. Structured scanning of the same class is Code Analyzer's job
(orchestrated by `/sf-security-review-toolkit:run-scans`) — this dimension's
finder reads the retrieval sites the greps surface and traces whether each
reaches an egress sink.

**External service — sources**: routes receiving Salesforce traffic (webhook
receivers, Canvas signed-request endpoints — grep `signed_request`,
`signedRequest`, `oauthToken`, `canvas`; OAuth callbacks; any
`Authorization`-bearing API surface).

**External service — sinks**, per stack:

| Stack | Where tokens leak |
|---|---|
| Python (FastAPI/Django) | Logging middleware dumping `request.headers`; `logger.*` calls interpolating header values; error-tracker init (does it send request headers/PII by default — check the SDK config); `print()` debugging left in handlers; raw token columns in models (grep `token` in model definitions and check for hashing/encryption at the write site). |
| Node (Express/Nest) | `morgan` custom tokens logging `req.headers.authorization`; `winston`/`pino` serializers (pino's `redact` paths present?); global error middleware logging `req`; `console.log(req.headers)`. |
| Ruby (Rails) | `config.filter_parameters` missing token/authorization entries; `lograge` custom payloads including headers; `Rails.logger` interpolations in controllers. |
| Java (Spring) | request-logging filters (`CommonsRequestLoggingFilter` with headers on), Logbook configs without header obfuscation, MDC values carrying tokens, `toString()` on request wrappers in exception handlers. |

**Cross-cutting greps**: `Authorization` within logging/instrumentation code;
`access_token`/`session` in URL-construction code (`?token=`, `?sid=`); proxy/
fetch wrappers that copy inbound headers onto outbound requests (the passthrough
anti-pattern — one line, catastrophic).

## 4. Finder prompt block

```
Primary targets (read these first, then follow imports/call-sites; use grep to
locate the real files when a path is approximate):
{{TARGETS}}

Stack notes (claims from the partner's own docs — verify against the ACTUAL
code, never assume):
{{STACK_NOTES}}

Threat focus — Salesforce session identifiers leaving the platform: the
automatic-fail class. Probe, package side: every retrieval of a session id
(UserInfo.getSessionId, $Api.Session_ID, GETSESSIONID, session ids handed into
Apex from Visualforce/Aura) — trace each to its sinks; flag any that reaches
an HTTP callout header, endpoint URL, request body, or external logging. Flag
string-built Authorization headers in Apex callouts; the sanctioned pattern is
Named/External Credentials (callout: endpoints, {!$Credential} merge fields).
Probe, external-service side: every route that receives Salesforce-issued
credentials (Canvas signed-request endpoints, OAuth callbacks, webhook
receivers, any inbound Authorization header) — then trace the token dataflow:
is it logged (request-logging middleware, logger interpolation, error trackers
configured to send request headers), persisted raw (token columns written
without hashing/encryption), placed in a URL/query string, echoed in any
response or error body, or FORWARDED to a downstream API (proxy/fetch wrappers
copying inbound auth headers outbound — token passthrough)? Canvas
specifically: after HMAC verification of the signed request, does the app mint
its OWN session from the claims, or does it keep using the embedded Salesforce
oauthToken as its session credential / store it beyond the request? Also probe
debug endpoints or verbose exception handlers that serialize request headers.

Known findings — do NOT re-report any of these:
{{LEDGER}}

Report ONLY findings grounded in code you have READ, with exact file:line.
Precision over volume: a session-id-egress claim is auto-fail-severity, so a
wrong one is maximally expensive — trace the full source-to-sink path before
reporting, and say which hop you could not verify. If the handling is correct,
do NOT report it (one info-level note for a notably strong control is
allowed). For each finding give a concrete exploit_scenario: who obtains the
credential (log reader, downstream API operator, DB snapshot holder), and what
Salesforce access it grants them.
```

## 5. Verifier guidance

- **Trace the dataflow, hop by hop.** A retrieval site is not a finding; a
  retrieval that *reaches an egress sink* is. Refute any finding whose cited
  path has a missing hop (the variable never reaches the callout; the log
  statement is debug-level and prod runs at info; the "stored token" is hashed
  at the write site).
- **Read the redaction layer before confirming a logging claim**: central
  filter lists (`filter_parameters`, pino `redact`, logbook obfuscation,
  custom log processors) may already strip the header on the cited path —
  confirm the cited logger actually bypasses them.
- **Distinguish the three token species** before confirming: (a) a Salesforce
  SessionId/org session token — the auto-fail class; (b) an OAuth token issued
  by the *partner's own* authorization server — not Salesforce's credential at
  all; (c) integration refresh/access tokens from the partner's connected-app
  flow — retained by design, judged on encryption-at-rest, not on egress.
  Misclassifying (b) or (c) as (a) is the dimension's most common false alarm.
- **For Canvas claims**: read the signed-request verification and what happens
  to the decoded payload — confirm whether the embedded token is used
  transiently (refutes) or persisted/forwarded/set as the session (confirms).
- **For Apex claims**: confirm the callout actually attaches the session id;
  same-org usage with no callout is a scanner-flag-with-justification case
  (document in the FP dossier), not an egress finding — mark it
  `partially_real` with that disposition rather than confirming at critical.

## 6. Known false-positive patterns

| Pattern | Why it is not a finding |
|---|---|
| The Canvas signed request *contains* an OAuth token | That is the protocol — Salesforce sends it. Receiving and verifying the signed request is correct; only persisting, logging, forwarding, or session-izing the embedded token violates. |
| Refresh/access tokens from the partner's own connected-app CRM integration stored in the database | The documented integration pattern. Judge it on encryption-at-rest and scope (secrets-credentials dimension), not as session egress. |
| Bearer tokens minted by the partner's own authorization server appearing in partner logs/storage | Not a Salesforce credential. May still be a secrets-handling finding (route it there) — never the auto-fail class. |
| `getSessionId()` in test classes, mocks, or commented-out code | Not reachable egress. Note that scanners will still flag it — recommend deletion so the scan report is quiet, severity info. |
| A session id used as an HMAC *input* or cache-key component, never transmitted | No egress. Verify the derived value isn't reversible/replayable before refuting. |
| Inbound `Authorization` header read for validation then dropped | The entire intended pattern. The header being *touched* is not the violation. |
| Fake/synthetic tokens in fixtures and docs (`00D…!AQ…` lookalikes, `EXAMPLE_SESSION_ID`) | Placeholders. Confirm entropy/shape before treating any literal as a live credential — and a live-looking literal belongs to secrets-credentials. |

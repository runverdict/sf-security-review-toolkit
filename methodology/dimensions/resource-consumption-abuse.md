# Dimension: resource-consumption-abuse

How much, and how fast. Every other dimension asks whether a request is
*authorized*; this one asks whether an authorized request can be *repeated or
amplified* until it costs the partner money, availability, or a metered quota.
Three shapes: **unrestricted consumption** (no rate limit / no pagination cap /
unbounded read, so volume alone degrades the service — OWASP API4:2023);
**denial-of-wallet** (each Agentforce inference, MCP tool call, or third-party
API round-trip is a *metered, paid* operation, so an attacker who can trigger
them without a quota runs up the bill — OWASP LLM10:2025); and **algorithmic
amplification** (one cheap request triggers disproportionate work — ReDoS, a
decompression bomb, an N+1 fan-out, an unbounded result set loaded into memory).
Applies when the manifest shows an external endpoint, an MCP server, an
Agentforce agent, or Apex that does unbounded work. Boundaries: per-surface
limits that already have a home stay there — login/OTP brute-force is
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/oauth-identity.md`, outbound
message-flood is
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/email-outbound.md`, and export
volume is `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/data-export.md`. This
dimension owns the **general** how-much/how-fast question those per-surface
probes leave uncovered, and the **cost** dimension none of them name.

## 1. Threat concept

The Salesforce reviewer's own DAST fuzzes endpoints at volume, so an unmetered
or unbounded endpoint is a standard finding — and the published OWASP bar
(baseline: `endpoint-owasp-top10-bar`) carries the API and LLM Top-10s that name
this class explicitly. No existing dimension owns the general case: rate limits
live per-surface (identity, email, export) and the *cost* of a paid inference
has never been a probe at all. The class splits three ways (baseline:
`resource-consumption-abuse`, `cost-amplification-denial-of-wallet`):

1. **Unrestricted consumption (API4:2023).** An expensive endpoint with no rate
   limit / quota, a list endpoint with no maximum page size (or `?limit=` the
   caller can set to a million), a query with no `LIMIT`, a search that scans
   unbounded, or a job-submission endpoint with no concurrency cap. Volume alone
   degrades or downs the service; no exploit cleverness required.
2. **Denial-of-wallet / unbounded LLM consumption (LLM10:2025).** Each
   Agentforce agent action, MCP tool invocation, prompt-template render, or
   third-party LLM/API callout is a **metered, billable** round-trip. An attacker
   who can drive them without a per-tenant quota — a public agent endpoint, an
   MCP tool with no budget, an agent action that loops or recurses, a
   prompt-template that fans one request into many model calls — converts a
   request flood into a *financial* attack (and exhausts the org's API limits as
   collateral). The sharp variants: an **agent-action chain with no
   loop/recursion guard**, an inference call **inside an unbounded loop**, and a
   `max_tokens`/length cap that is absent so each call is maximally expensive.
3. **Algorithmic amplification (one request → disproportionate work).**
   - **ReDoS** — a regex with catastrophic backtracking (`(a+)+`, `(.*)*`,
     nested/overlapping quantifiers) evaluated against attacker-controlled input,
     freezing the worker. The regex-ambiguity substrate here is deterministic
     (the run-scans Family-7 ReDoS scanner leg proves a pattern catastrophic
     mechanically), so treat scanner hits as substrate and spend this
     dimension's judgment on reachability — whether attacker-controlled input
     actually reaches the flagged pattern.
   - **Decompression / parser bombs** — a small upload that expands to gigabytes
     (zip/gzip bomb), or a deeply nested JSON/XML that blows the parser. (The
     *file intake* validation is `data-export`; the resource-exhaustion is here.)
   - **Unbounded memory** — loading an entire table/file/result set into memory
     (`.all()`, `findAll`, read-whole-file) rather than streaming/paginating.
   - **Fan-out / N+1 at scale** — one request issuing an unbounded number of
     downstream queries or callouts.
4. **Apex governor-limit DoS (platform-specific).** Apex caps SOQL rows, CPU,
   heap, and callouts per transaction, so unbounded work doesn't run forever — it
   *throws*, taking the feature down (a self-inflicted DoS) and, on a
   guest/`@AuraEnabled` path, lets a caller force the limit. Unbounded SOQL with
   no `LIMIT`, queries in loops, `Database.query` over a caller-influenced filter
   that returns everything, recursive `Queueable`/`@future` chains, and callouts
   in loops are the tells.

## 2. What good looks like

- **Rate limits / quotas on the expensive and the sensitive.** A token-bucket or
  fixed-window limiter (per tenant *and* per principal, not just per IP) on
  authentication, inference, search, export, and job-submission endpoints, with
  a sane default and a documented override. The limit is enforced server-side at
  the gateway or middleware, not advisory in the client.
- **Pagination with an enforced maximum.** List/search endpoints page, the page
  size is clamped to a server maximum (a caller `?limit=10_000_000` is capped,
  not honored), and queries carry a `LIMIT`. No endpoint returns an unbounded
  result set "because the data is usually small."
- **Inference cost is bounded and metered.** Per-tenant inference/agent-action
  quotas; a `max_tokens`/response-length cap on every model call; a
  loop/recursion/step guard on agent-action and tool-call chains so one request
  cannot trigger an unbounded number of paid calls; timeouts on the model/API
  callout. The cost ceiling per request is knowable and bounded.
- **Linear-time parsing of untrusted input.** Regexes over user input are
  backtracking-safe (no nested/overlapping quantifiers) or run on a length-capped
  input with a timeout / a linear engine (RE2); uploads are size-capped *before*
  decompression and decompression is bounded (a max-ratio / max-output guard);
  JSON/XML nesting depth is limited.
- **Bounded memory and fan-out.** Large reads stream or paginate rather than
  loading everything; a request's downstream query/callout count is bounded
  (no unbounded N+1); background work is chunked with limits.
- **Apex respects (and front-runs) the governors.** SOQL carries `LIMIT`,
  queries are bulkified out of loops, caller-influenced filters can't force an
  unbounded scan, recursive async is depth-guarded, and an `@AuraEnabled`/guest
  method cannot be driven to a governor exception by input.

## 3. Detection heuristics

Find the rate-limit configuration (and which routes it covers), the pagination
and `LIMIT` discipline, the inference/callout call sites and their guards, and
the regex/decompression/memory hot spots. The absence of a limiter is as much
the finding as a weak one.

**All stacks** — grep seeds: `rate`, `ratelimit`, `rate_limit`, `throttle`,
`limiter`, `bucket`, `quota`, `slowapi`, `express-rate-limit`, `bottleneck`,
`Bucket4j`, `django-ratelimit`, `Rack::Attack`; pagination/read: `limit`,
`offset`, `page_size`, `per_page`, `.all()`, `findAll`, `.find(`, `fetchall`,
`SELECT` without `LIMIT`, `read()`/`readFileSync` of a whole file; inference/
cost: `chat.completions`, `messages.create`, `generateText`, `invokeModel`,
`predict`, `max_tokens`, agent-action/tool loops; regex: `re.compile`/
`new RegExp(` over input, nested quantifiers `(.*)*`/`(a+)+`/`(\\d+)+`;
decompression: `zipfile`, `gzip`, `tarfile`, `unzip`, `inflate` without a size
cap; body limits: `body-parser` `limit:`, `client_max_body_size`,
`MAX_CONTENT_LENGTH`.

| Stack | Where to look |
|---|---|
| Python (FastAPI/Django) | A limiter (`slowapi`/`django-ratelimit`/a gateway) and which routes carry it; `.all()`/`fetchall()` and querysets with no slice; `MAX_CONTENT_LENGTH`/upload size; `re` patterns over request data; `zipfile`/`tarfile` extraction without a size/ratio cap; LLM SDK calls (`openai`/`anthropic`/`vertexai`) — `max_tokens` set? inside a loop? per-tenant quota? |
| Node (Express/Nest) | `express-rate-limit`/`@nestjs/throttler` coverage; `body-parser`/`multer` `limit`; Prisma/TypeORM `findMany` with no `take`; `new RegExp(userInput)` and static catastrophic patterns; `zlib`/`unzipper` without a cap; LLM SDK calls and their `max_tokens`/loop/timeout. |
| Ruby (Rails) | `Rack::Attack` rules and coverage; `.all`/`find_each` vs unbounded `.where`; `Regexp` over params; pagination gem caps (`kaminari`/`pagy` max per page); upload size config. |
| Java (Spring) | Bucket4j/gateway throttling; `Pageable` max size enforcement; `Pattern.compile` over input; multipart `max-file-size`/`max-request-size`; `RestTemplate`/`WebClient` timeouts; repository `findAll()` returning everything. |
| MCP / Agentforce | Per the manifest's tool/agent surface: is there a per-tenant or per-session **budget** on tool calls / agent actions; does an agent-action or tool-dispatch path loop or recurse without a step cap; is `max_tokens`/length bounded on each model call; are the model/tool callouts timed out? An MCP tool that triggers a paid model call or an expensive backend op with no quota is the denial-of-wallet finding. |
| Apex | `[SELECT ...]`/`Database.query` without `LIMIT`, queries inside `for` loops (un-bulkified), a caller-supplied filter feeding an unbounded query, recursive `System.enqueueJob`/`@future`/`Database.executeBatch` chains, `Http` callouts in loops, and `@AuraEnabled`/`@RestResource`/guest methods whose input can force a governor-limit exception. |

Also resolve: which endpoints are **unauthenticated/public** (an unmetered
public endpoint is the highest-severity consumption finding), and whether any
limiter is per-IP only (trivially bypassed by a distributed or authenticated
attacker — per-tenant/per-principal is the real control).

## 4. Finder prompt block

```
Primary targets (read these first, then follow imports/call-sites; use grep to
locate the real files when a path is approximate):
{{TARGETS}}

Stack notes (claims from the partner's own docs — verify against the ACTUAL
code, never assume; the central questions are CAN an authorized request be
repeated/amplified without a cap, and what does each repeat COST):
{{STACK_NOTES}}

Threat focus — how much and how fast, three shapes. UNRESTRICTED CONSUMPTION
(API4): find expensive / sensitive / public endpoints with NO rate limit or
quota (search, inference, export, job-submit, auth), list endpoints with no
enforced MAXIMUM page size (or a caller-settable ?limit= that is honored
unbounded), and queries with no LIMIT — does volume alone degrade or down the
service, and is any limiter per-IP-only (bypassable) rather than
per-tenant/per-principal? DENIAL-OF-WALLET (LLM10): every Agentforce agent
action, MCP tool call, prompt-template render, and third-party LLM/API callout
is a METERED, PAID round-trip — can an attacker drive them without a per-tenant
budget (a public agent/tool, an inference call INSIDE A LOOP, an agent-action or
tool chain with NO loop/recursion/step guard, a missing max_tokens so each call
is maximally expensive)? ALGORITHMIC AMPLIFICATION: a regex with catastrophic
backtracking ((a+)+ / (.*)* / nested quantifiers) over attacker input (ReDoS); a
small upload that decompresses to gigabytes or a deeply nested JSON/XML with no
size/depth cap (parser bomb); loading an entire table/file/result set into
memory (.all()/findAll/read-whole-file) instead of streaming/paginating; one
request fanning into an unbounded number of downstream queries/callouts (N+1 at
scale). APEX GOVERNOR DoS: SOQL without LIMIT, queries in loops, a
caller-influenced filter forcing an unbounded scan, recursive
Queueable/@future/Batch chains, callouts in loops, and @AuraEnabled/guest
methods whose input forces a governor exception (a self-inflicted DoS). For each
hit the decisive facts are: is the trigger attacker-reachable (public > authed),
is there a cap/quota/guard, and what is the per-request COST (CPU, memory,
availability, or money). Login/OTP brute-force is oauth-identity, outbound
message-flood is email-outbound, export volume is data-export — flag those as
one-line leads and own here the general rate/quota/unbounded-read/cost picture.

Known findings — do NOT re-report any of these:
{{LEDGER}}

Report ONLY findings grounded in code you have READ, with exact file:line. An
unmetered PUBLIC expensive/inference endpoint, or an unguarded paid-inference
loop, is HIGH (a volume/cost attack with no cleverness) — say so and state the
endpoint + the missing cap. A catastrophic-backtracking regex over user input is
the ReDoS finding (give the pattern + the input). Prefer precision over volume —
a limiter that covers the route, an enforced max page size, a LIMIT, a
max_tokens + per-tenant quota, an RE2/linear regex, or a size-capped upload is
NOT a finding, and an endpoint behind authentication with a per-tenant quota is
bounded. For each finding give a concrete exploit_scenario: the attacker, the
request they repeat or the input they amplify, and the resource (availability,
memory, money, API limits) it exhausts.
```

## 5. Verifier guidance

- **"No limiter" requires reading the gateway/middleware, not just the route.**
  Before confirming an unrestricted-consumption finding, check whether a
  global/gateway rate limit or an upstream WAF/quota covers the route — a limiter
  applied at app or ingress level refutes a per-route claim. Conversely, a
  limiter present but **per-IP only** confirms a weaker finding (an authenticated
  or distributed attacker bypasses it); a per-tenant/per-principal quota refutes.
- **For denial-of-wallet, confirm the call is paid AND attacker-drivable AND
  unbounded.** Read whether the inference/tool/callout is reachable without
  authentication or per-tenant quota, and whether a loop/recursion/step guard
  bounds the number of calls per request. A single bounded inference behind auth
  with a max-token cap is not a finding; an unguarded loop of inferences on a
  public path is. Name the loop/path and the missing guard.
- **For ReDoS, the regex must be both catastrophic and fed untrusted input.**
  Confirm the pattern actually backtracks catastrophically (nested/overlapping
  quantifiers) and that attacker-controlled input reaches it. A linear pattern, a
  length-capped input, an RE2/`re2`/timeout-guarded engine, or a static regex
  over server constants refutes — write the triggering input into the evidence or
  downgrade.
- **For unbounded reads/memory, confirm the data is actually unbounded.** A
  `.all()` over a small, server-bounded set (an enum, a config table) is not the
  finding; an `.all()`/`findAll` over a tenant-growable table loaded into memory,
  or a result set whose size the caller influences, is. State why the set is
  unbounded.
- **Apex governor findings are real but usually `medium`/`low` (self-DoS, not
  cross-tenant).** A guest/`@AuraEnabled` method a caller can drive to a governor
  exception is the higher case (an external trigger); an internal batch that
  might exceed limits on large data is a robustness/medium finding. Bulkification
  absence is a finding only where the volume is attacker- or data-driven.
- **Reachability sets severity.** Public/unauthenticated > authenticated-but-
  unquota'd > internal/admin. A paid-inference amplification on a public endpoint
  is the top case; the same behind a per-tenant quota is hardening. Say which in
  `adjusted_severity`.
- **App-level rate-limiting on a webhook/endpoint, and an "HMAC-compute /
  signature-verify DoS", is `low`/`info` — NOT `high`/`medium` — when the
  per-request work is CHEAP.** HMAC-SHA256 / signature verification is
  microseconds, and rate-limiting a webhook is typically the gateway/infra
  layer's responsibility, not the app's — so a constant-time HMAC verify with no
  app-level rate limit is a hardening note at most. It rises to a real finding
  ONLY when the per-request work is genuinely EXPENSIVE (bcrypt/scrypt/argon2, a
  heavy unindexed query, an LLM or other paid callout) AND unbounded AND
  attacker-triggerable PRE-auth. (Blind 15-judge multi-vote on the Solano
  "/webhook lacks rate limiting → HMAC-compute DoS": not-a-finding(9)/low(6),
  modal NOT-A-FINDING, zero high/medium.)

## 6. Known false-positive patterns

| Pattern | Why it is not a finding (or not at the reported severity) |
|---|---|
| An endpoint with no per-route limiter that is covered by a global/gateway rate limit or upstream WAF quota | The control is inherited. Confirm the gateway/global limiter before flagging the route. |
| A list/search endpoint that paginates with a server-enforced maximum page size (a caller `?limit=10_000_000` is clamped) | Bounded by construction. The finding is an unbounded or caller-controlled page size, not pagination itself. |
| A single inference/agent-action call behind authentication with a `max_tokens` cap and a per-tenant quota | Cost is bounded and metered. Denial-of-wallet requires an unbounded/unmetered or public-drivable trigger. |
| A regex with bounded/linear structure, or run on a length-capped input, or on an RE2/timeout-guarded engine | Not catastrophic backtracking. ReDoS requires a nested/overlapping-quantifier pattern over uncapped untrusted input. |
| `.all()` / `findAll` over a small, server-bounded set (enum, config, a known-tiny table) | Not unbounded. The finding is an unbounded or caller-influenced result set loaded into memory. |
| Apex SOQL without `LIMIT` that is structurally bounded (a unique-key lookup, a single-record query, a parent-of-one relationship) | Bounded by the data model. The finding is a caller-influenced or tenant-growable unbounded scan, or a query in a loop. |
| A rate limit that returns 429 and the test "fails" because it was hit | The limiter working is the control, not a finding. The finding is its absence or per-IP-only scope. |
| An upload endpoint with a `MAX_CONTENT_LENGTH`/`max-file-size` and a bounded decompression ratio | Size-capped intake. The finding is decompression with no output/ratio cap (a bomb), not the presence of uploads. |
| A webhook/endpoint with no APP-LEVEL rate limit whose per-request work is CHEAP (an HMAC-SHA256 / signature verify, a single indexed lookup) — flagged as an "HMAC-compute DoS" / "signature-verify DoS" | Microsecond work; rate-limiting a webhook is the gateway/infra layer's job, not the app's. `low`/`info` hardening at most, NOT `high`/`medium`. A real cost finding needs EXPENSIVE per-request work (bcrypt/scrypt/argon2, a heavy unindexed query, an LLM/paid callout) that is unbounded AND attacker-triggerable pre-auth. |

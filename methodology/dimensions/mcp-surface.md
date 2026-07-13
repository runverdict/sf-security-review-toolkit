# Dimension: mcp-surface

The MCP server as an attackable HTTP service: the transport, the
authentication gate, the tool-dispatch layer, and the honesty of the tool
inventory. Applies when the scope manifest shows an MCP server. This dimension
covers **classic AppSec applied to the MCP endpoint** — every request
authenticated, every tool call authorized and schema-validated, every error
quiet. The MCP-*specific* threat classes the spec names (token passthrough,
audience validation, confused deputy, tool poisoning) live in
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/mcp-threat-model.md`; the
authorization *server* that protects the endpoint lives in
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/oauth-identity.md`. Keep the
boundaries — the three dimensions share a surface and must not double-report.

## 1. Threat concept

An MCP server is a JSON-RPC API with an unusually capable caller: an agent
that issues requests at machine speed, retries aggressively, and follows any
tool the inventory advertises. The review treats it as a first-class external
endpoint — DAST scope explicitly includes the MCP endpoints (baseline:
`dast-scope-includes-identity-endpoints`), the exposed-tools list is itself a
submission artifact (baseline: `artifact-exposed-tools-list`,
`mcp-tools-list-metadata-completeness`), and the reviewer verifies per-user
authorization with two test accounts through Agentforce (baseline:
`artifact-third-party-creds-two-test-users`, `mcp-per-user-authz-mechanics`).

The sub-classes, in the order they burn review cycles:

1. **Auth-gate gaps.** The bearer token is validated on *most* methods — and
   not on `initialize`, `notifications/*`, `ping`, a health route mounted
   inside the MCP path, or a legacy SSE route left behind by a transport
   migration. Stateless validation on **every** request is the bar (baseline:
   `mcpthreat-session-hijacking-stateless-auth`); any transport session id is
   resumability state, never an auth substitute.
2. **Per-tool authorization missing or flat.** The transport-level token gets
   you in; then every tool runs with the same effective privilege. The
   field-tested good shape is a read/propose/admin tool tiering with a scope
   floor — write tools refuse read-only tokens (baseline:
   `mcpthreat-scope-minimization`) — plus a per-user binding so the same tool
   call under two users returns only each user's authorized data. The
   reviewer tests exactly this with the two test accounts.
3. **Dispatch-layer input trust.** Tool parameters that skip the declared
   JSON schema, unknown tool names reaching dynamic lookup, type confusion
   (an array where the schema says string), and parameters flowing into
   dangerous sinks (baseline: `mcpthreat-input-validation-schemas` — the
   Jan–Feb 2026 MCP CVE wave was dominated by missing input validation).
   The *construction* of queries/commands from those parameters is owned by
   `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/injection-xss.md`; this
   dimension owns whether the validation gate exists at all.
4. **Inventory dishonesty.** Tools reachable through dispatch but absent from
   `tools/list` (debug tools, feature-flagged tools, an admin tool registered
   conditionally), or metadata so thin the surface reads undocumented. The
   reviewer diffs the submitted tools list against the live server; an
   undisclosed tool reads as concealment (baseline:
   `artifact-exposed-tools-list`).
5. **Transport nonconformance and hygiene.** The Agentforce client speaks
   Streamable HTTP only, on three protocol versions, with three auth modes (none carrying per-end-user identity)
   (baseline: `mcp-transport-streamable-http-only`,
   `mcp-protocol-versions-supported`, `mcp-auth-no-auth-or-client-credentials`)
   — a deviation is a listing blocker before it is a vulnerability. Plus:
   missing Origin validation on any browser-reachable transport (DNS
   rebinding), guessable resumability session ids, JSON-RPC error bodies that
   carry stack traces or ORM internals (baseline:
   `endpoint-error-hygiene-debug-off` — reviewers crash endpoints on
   purpose), and rate limiting tuned for humans against a caller that is not
   one (baseline: `mcpthreat-rate-limiting-hitl-writes`, `endpoint-rate-limiting`).
   TLS is graded live, not statically — A on SSL Labs, HTTPS everywhere
   (baseline: `endpoint-ssl-labs-a-grade`, `endpoint-https-only`) — by
   `/sf-security-review-toolkit:run-scans`; what this dimension catches from
   code is the config that undermines the grade: a hardcoded `http://` base
   URL, a proxy block serving the MCP path without redirect-to-HTTPS.

## 2. What good looks like

- **One auth middleware, mounted before every MCP route.** Token signature,
  expiry, and audience checked on each request — including `initialize`,
  notifications, and any GET/SSE stream — returning 401 with a proper
  `WWW-Authenticate` challenge. No method allowlist that quietly exempts
  "harmless" RPCs; resource-discovery metadata (`/.well-known/*`) is the only
  intentionally anonymous surface.
- **A single tool registry as the source of truth.** `tools/list` and the
  dispatch table are generated from the same structure, so a tool cannot be
  callable but unlisted. Every tool carries name, description, and input
  schema (baseline: `mcp-tools-list-metadata-completeness`); conditional or
  admin tools are either absent from the registry for that principal or
  listed and gated — never silently dispatchable.
- **Schema validation at the dispatch boundary, fail-closed.** Arguments
  validated against the declared schema before the handler runs; unknown
  tools and malformed payloads get a JSON-RPC error, not an exception; extra
  fields rejected or stripped, never forwarded.
- **Privilege tiering with a scope floor.** Tools classified read / write /
  admin; the dispatch layer enforces the floor (a read-scoped token cannot
  invoke a write tool); state-changing or expensive tools carry
  human-in-the-loop confirmation or an equivalent compensating control,
  and every invocation is logged with caller identity (baseline:
  `mcpthreat-rate-limiting-hitl-writes`).
- **Tenant-level scoping behind org-level transport auth, honestly framed.**
  The platform connection is org-level and NO end-user identity is forwarded
  to the server at tool-call time (baseline: `mcp-per-user-authz-mechanics`,
  verified — settled negatively; per-user auth is roadmapped post-GA). The
  server binds each request to its tenant and scoping is enforced below the
  app layer (the tenant boundary mechanics are
  `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/tenant-isolation.md`); where
  the partner's own surfaces carry real user identities, per-user scoping
  binds there. The two-user proof demonstrates Salesforce-side gating plus
  this tenant scoping — flag any artifact or code comment that claims
  per-end-user enforcement at the MCP layer as a finding (over-claim).
- **Quiet errors, bounded work.** JSON-RPC error objects carry a stable code
  and a generic message; `error.data` never includes stack frames, paths, or
  SQL. Per-tool, per-caller rate limits; long-running tools bounded under the
  60-second Agentforce timeout (baseline: `mcp-tool-call-timeout`) or split
  into submit/poll pairs.
- **Resumability state that is only resumability state.** Stream/session ids
  are CSPRNG-random, expiring, bound to the authenticated context — and the
  server still validates the bearer on every poll.

## 3. Detection heuristics

Locate the MCP entry point, the auth middleware, the tool registry, and the
dispatch path. The server framework usually names them.

**All stacks** — grep seeds: `tools/list`, `tools/call`, `initialize`,
`jsonrpc`, `2025-06-18` / `2025-03-26` / `2024-11-05` (protocol versions),
`McpServer` / `FastMCP` / `@modelcontextprotocol`, `list_tools`, `call_tool`,
`@tool` / `@mcp.tool`, `WWW-Authenticate`, `Mcp-Session-Id`, `text/event-stream`.
Route patterns: `/mcp`, `/api/*/mcp`, `/sse` (legacy transport residue).

| Stack | Where to look |
|---|---|
| Python (FastAPI/Flask) | `mcp`/`fastmcp` SDK server objects and their mounted route; decorator-registered tools (`@server.tool`, `@mcp.tool()`); the auth dependency on the MCP route (is it on the router or per-endpoint — a router-level `Depends` refutes per-method gap claims, a per-endpoint one invites them); Pydantic models vs hand-parsed `params` dicts in handlers. |
| Node (Express/Nest) | `@modelcontextprotocol/sdk` server + transport wiring (`StreamableHTTPServerTransport`); middleware order before the MCP route; zod schemas on tool registration vs `any`-typed handlers; leftover SSE transport routes from SDK migrations. |
| Other backends | Any JSON-RPC dispatcher keyed on `method`/`name` strings — read the lookup (dynamic `getattr`/reflection on a tool name is the unknown-tool probe) and whatever sits between HTTP and that lookup. |
| Config/infra | Reverse-proxy configs that route `/mcp` differently from the app (a proxy-level auth bypass for "health checks" has shipped); CORS/Origin handling on the MCP path. |

Also resolve: the tool registry definition (one structure or two?), the
scope/role check inside dispatch (or its absence), the rate-limiter
configuration for the MCP path, and the error handler that serializes
tool exceptions into JSON-RPC responses.

## 4. Finder prompt block

```
Primary targets (read these first, then follow imports/call-sites; use grep to
locate the real files when a path is approximate):
{{TARGETS}}

Stack notes (claims from the partner's own docs — verify against the ACTUAL
code, never assume):
{{STACK_NOTES}}

Threat focus — the MCP server as an attackable HTTP service. Probe: the auth
gate (is the bearer token validated on EVERY request — initialize,
notifications, ping, GET/SSE streams, health routes inside the MCP path — or
does a method allowlist / router layout exempt some; does any code path treat
a transport session id as authentication instead of resumability state);
per-tool authorization (after transport auth, what stops a read-scoped or
low-privilege caller from invoking write/admin tools — find the scope/role
check inside dispatch, or its absence; is the request bound to a USER identity
before data access, and where); dispatch input trust (are tool arguments
validated against the declared JSON schema before the handler runs; what
happens on an unknown tool name — error, or dynamic lookup/reflection; type
confusion and extra fields; a permissive tool-param schema that lets the handler
bind caller-supplied PRIVILEGED fields (status/owner/price/internal flags) into a
record write — the MCP analogue of mass assignment (baseline:
mass-assignment-bopla); flag parameters reaching dangerous sinks but
leave query/command CONSTRUCTION to the injection dimension); inventory
honesty (diff the tools/list source against the dispatch table — any tool
callable but unlisted, debug/admin tools registered conditionally, metadata
missing name/description/schema); transport conformance and hygiene
(Streamable HTTP only, supported protocol-version negotiation, Origin
validation on browser-reachable transports, resumability ids generated with a
CSPRNG and expiring; hardcoded http:// base URLs or proxy config exposing the
MCP path without HTTPS — TLS grading itself belongs to the scans); error hygiene (JSON-RPC error bodies carrying stack
traces, file paths, SQL, or ORM internals — read the exception-to-response
serializer); rate limiting and abuse (per-tool/per-caller limits vs one
global human-tuned bucket; expensive or state-changing tools without
human-in-the-loop or compensating controls; invocation logging with caller
identity); long-running tools that can exceed the platform's 60s tool-call
timeout.

Known findings — do NOT re-report any of these:
{{LEDGER}}

Report ONLY findings grounded in code you have READ, with exact file:line.
Prefer precision over volume — a false alarm wastes the verifier's time and
the partner's. If a control is correctly implemented, do NOT report it (one
info-level note for a notably strong control is allowed). For each finding
give a concrete exploit_scenario: the caller (anonymous, read-scoped client,
authenticated low-privilege user), the request they send, and what tool or
data it reaches.
```

## 5. Verifier guidance

- **Find the middleware mounting, not the handler.** "Method X is
  unauthenticated" is refuted by a router-level auth dependency or a proxy
  rule the finder didn't read. Trace HTTP → middleware chain → dispatch for
  the *specific* method before confirming.
- **Read the SDK's own behavior.** The official MCP SDKs enforce schema
  validation and session-id generation by default in current versions. A
  "missing validation" finding against an SDK that does it internally is only
  real if the handler bypasses the SDK path or the version predates the
  behavior — check the lockfile.
- **For per-tool authorization claims**: read the dispatch code end to end.
  A central scope-floor check in the dispatcher refutes per-handler claims;
  per-handler checks mean verifying the *cited* handler specifically.
- **For inventory claims**: confirm the tool is actually *dispatchable* by an
  external caller, not just present in code. A tool behind a feature flag
  that is off in production config is a low-severity hygiene note, not a
  hidden surface — read the flag's production value.
- **For unauthenticated-route claims**: RFC 9728 protected-resource metadata
  and OAuth discovery documents (`/.well-known/*`) are anonymous by design.
  Only confirm if actual RPC methods or tool data are reachable.
- **For rate-limit claims**: confirm what the limiter keys on and that it
  wraps the MCP path — and remember 429s appearing under load are the control
  working, not a finding.

## 6. Known false-positive patterns

| Pattern | Why it is not a finding |
|---|---|
| `/.well-known/oauth-protected-resource` and OAuth discovery metadata served without auth | Required to be anonymous — that is how clients find the authorization server. Data exposure starts at the RPC methods, not the metadata. |
| GET to the MCP endpoint returns 405 | A Streamable-HTTP server with no server→client stream deliberately rejects GET; the protocol surface is POST JSON-RPC (baseline: `mcp-transport-streamable-http-only`). The finding would be a 405 body leaking internals. |
| `client_credentials`-only auth, no per-request user token | The platform constraint (baseline: `mcp-auth-no-auth-or-client-credentials`). Judge the server-side user binding and data scoping instead — absence of THOSE is the finding. |
| A `Mcp-Session-Id` header issued without a cookie flag set | It is not a cookie and not an auth credential — judge it on entropy, expiry, and whether any code path skips bearer validation because the session id is present. |
| Uniform JSON-RPC error codes for every rejection reason | Oracle denial, the intended hygiene. The finding is the opposite (distinct errors that let a caller enumerate tools/users). |
| 429 responses or per-tool throttling under bursty agent traffic | The rate-limiting posture working as designed. |
| Tools described in code but not registered in the production registry build | Dead code, info at most — unless the dispatch path can still reach them dynamically; read the lookup before refuting. |
| The server refuses tool calls before `initialize` completes | Protocol-conformant lifecycle enforcement, not a broken endpoint. |
| TLS protocol/cipher posture inferred from code absence alone | Termination usually lives at the edge; the grade is verified live via SSL Labs in `/sf-security-review-toolkit:run-scans` (baseline: `endpoint-ssl-labs-a-grade`). From code, only a hardcoded `http://` URL or a proxy block that skips HTTPS is reportable. |

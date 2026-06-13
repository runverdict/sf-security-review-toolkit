# Authenticated DAST (OWASP ZAP) — plan assets for the review's dynamic-scan requirement

The security review requires partner-run DAST against every external endpoint
(baseline: `dast-self-run-required` — Salesforce decommissioned its hosted
Chimera scanner in mid-2025, and there has been no hosted alternative since;
the entry carries the sources and `last_verified` date), and the scan must be
**authenticated**
(baseline: `dast-authenticated-scans`). This directory holds the ZAP Automation
Framework plan template plus the false-positive class catalog that turns the
scan's predictable noise into ready dossier entries.
`/sf-security-review-toolkit:run-scans` generates a concrete plan from the
template; the partner executes it. Patterns here were extracted from a DAST
harness an ISV partner ran against its own MCP + OAuth surface before
submission prep — genericized per CONVENTIONS §3.

**Owner-run, by nature:** an agent can generate, validate, and parse the plan
and report, but executing a scan against live infrastructure requires
authorization to scan, real credentials, and infrastructure access — that is
the partner's action, and the recap must say so. And this scan is the DAST
evidence; the toolkit's white-box audit
(`/sf-security-review-toolkit:audit-codebase`) is static code review and never
substitutes for it.

## What the review requires (read the baseline, don't trust prose)

All facts live in `${CLAUDE_PLUGIN_ROOT}/baseline/requirements-baseline.yaml` —
check `last_verified` before relying on any of them:

| Baseline entry | Why it shapes the plan |
|---|---|
| `dast-self-run-required` | Tool choice is the partner's — ZAP, Burp Suite, HCL AppScan, and WebInspect are the officially named examples; this harness standardizes on ZAP because the Automation Framework plan is reviewable-as-code and free |
| `dast-authenticated-scans` | The scanner must hold a valid token/session while crawling protected endpoints — an anonymous baseline scan does not satisfy the requirement |
| `dast-scope-includes-identity-endpoints` | For MCP submissions the identity surface (authorize/token/register/revoke + discovery docs) is in scope as a **first-class target** — driving the scanner *through* the login flow is not the same as scanning the identity surface itself |
| `dast-screenshot-proof-of-scanned-url` | Export the FULL report — scan date, targeted endpoints, all findings; a capture visibly showing URL + date rides along |
| `dast-endpoints-production-mode` | The target must be production-equivalent: debug off, generic errors. Never weaken auth or security controls to make scanning easier |
| `dast-severity-bar` | Verified: critical and high findings require attention (fix or justified false-positive documentation); action on low/medium is not required, only investigation encouraged. The toolkit's posture stays stricter: zero undispositioned findings of any severity, fix (don't document) anything High/Critical |
| `scan-no-clean-scan-required` / `scan-false-positive-documentation` | A clean report is not required; an **undocumented** finding is the failure mode |

## Scope rules (where scans get bounced)

- **Every external endpoint in the architecture doc** is in scope: app/API
  surface, MCP endpoint, identity endpoints, webhook receivers, anything a
  Salesforce org or a browser reaches. The reviewer cross-checks the report
  against the architecture diagram — a scanned-URL set narrower than the
  documented endpoint set reads as an incomplete submission.
- **Import the same OpenAPI/endpoint description you submit as the
  api-endpoints artifact** (baseline: `artifact-api-endpoints-spec`). One
  source of truth means the report scope provably matches the docs, and the
  active scan exercises documented POST endpoints a spider never finds.
- **Identity endpoints are explicit targets**, not crawl discoveries: the plan
  template's `requestor` job seeds authorize/token/register/revoke and the
  `/.well-known/*` discovery docs into the scan tree so passive + active scan
  cover them even when no link reaches them.
- **MCP endpoints get shallow DAST coverage by nature.** ZAP exercises the
  transport (headers, TLS, error handling, method handling) but cannot
  meaningfully fuzz JSON-RPC tool semantics or per-tool authorization. Say so
  in the submission narrative; the per-user authorization evidence comes from
  the two-user proof (baseline: `mcp-per-user-authz-mechanics`) and the
  white-box audit, not from this scan.

## Using the template

1. Copy `zap-plan-template.yaml`, fill the `{{...}}` slots (the
   `/sf-security-review-toolkit:run-scans` skill does this from the scope
   manifest + endpoint inventory):

   | Slot | Value |
   |---|---|
   | `{{TARGET_BASE_URL}}` | scheme + host of the endpoint under test, no trailing slash |
   | `{{CONTEXT_NAME}}` | a stable name; it appears in the report |
   | `{{OPENAPI_FILE}}` | path to the OpenAPI spec (same artifact as the submission) — delete the job if none exists |
   | `{{MCP_PATH}}` | the MCP endpoint path (e.g. `/api/v1/mcp`) — delete the request if no MCP server |
   | `{{AUTHORIZE_PATH}} {{TOKEN_PATH}} {{REGISTER_PATH}} {{REVOKE_PATH}}` | the identity endpoint paths from OAuth discovery metadata |
   | `{{AUTH_CHECK_PATH}}` | (browser-login pattern only) an endpoint that is 200 logged-in / 401 logged-out, for the poll verification |
   | `{{REPORT_DIR}}` | evidence directory — use `<target>/.security-review/evidence/dast/` |

   One value is deliberately NOT a slot: the MCP `initialize` probe's
   `protocolVersion`, which carries the newest version from the baseline's
   `mcp-protocol-versions-supported` entry. If the server under test runs an
   older supported protocol version, edit `protocolVersion` in the generated
   plan before running it; and if that baseline entry has changed since the
   template was last touched, update the template — same check-`last_verified`
   rule as everything else here.

2. **Secrets never go in the plan file.** The plan is committed as evidence;
   credentials arrive at run time via environment variables — ZAP substitutes
   `${VAR}` from the environment when loading the plan (`${DAST_BEARER_TOKEN}`
   for pattern A; `${DAST_USERNAME}`/`${DAST_PASSWORD}` for pattern B). The
   toolkit refuses to write a plan with a literal credential in it
   (CONVENTIONS §6).

3. Run: `zap.sh -cmd -autorun /abs/path/to/plan.yaml` (or the
   `ghcr.io/zaproxy/zaproxy:stable` container with the plan and report dir
   volume-mounted). Validate the plan loads cleanly against YOUR installed ZAP
   first — the Automation Framework's job parameters evolve between releases;
   a plan that half-loads scans half the scope and tells you in a log line,
   not an error.

## Authentication: two patterns

**A. Bearer-token API (OAuth client_credentials)** — the common shape for MCP
servers. Mint a token out-of-band against the token endpoint before the run,
export it as `DAST_BEARER_TOKEN`, and the plan's `replacer` rule injects
`Authorization: Bearer …` into every scanner request. Two field-learned
gotchas: (1) **token lifetime vs scan duration** — an active scan outlives a
short-lived token, and everything after expiry silently degrades to an
unauthenticated scan that still produces a green-looking report; mint with a
lifetime exceeding the scan window or re-run with a fresh token per job
group. (2) **Scope choice is evidence** — scan with the least-privileged scope
a real client would hold, and record which scope the token carried in the run
notes; the reviewer may ask.

**B. Browser-login web app** — for a session-cookie UI (e.g. a
Canvas-embedded app's standalone login), use the context's `authentication`
block (browser-based auth) with `verification.method: poll` against an
endpoint that returns 200 only when logged in. The template carries a
commented stanza. Re-verification matters more than login: a scanner that gets
logged out mid-scan and keeps crawling produces the same silently-anonymous
report as an expired bearer.

## Scanning through a CDN/WAF edge (field-proven gotcha)

If the endpoint sits behind a CDN/WAF (Cloudflare, AWS WAF, …), a blind scan
tests the **edge**, not your origin: bot rules and WAF signatures block or
mangle probes, rate limits throttle the crawl, and the results are noise that
also pages whoever watches the security alerts. Pick one, and write down which:

- **Preferred:** scan a production-equivalent deployment of the same build
  reachable without the edge (same hardening — `dast-endpoints-production-mode`
  still applies: debug off, generic errors, real auth).
- **Or:** allowlist the scanner's IP at the edge and raise rate limits for the
  scan window only. Document the temporary allowlist in the run notes and
  revert it after — an allowlist you forgot is a finding waiting for the
  reviewer's own pen test.

Never disable application-level auth or security controls for the scan; that
invalidates the evidence.

## Evidence (what goes in the submission)

Write everything under `<target>/.security-review/evidence/dast/`:

- `dast-report.html` — the submission report, exported in FULL (scan date,
  targeted endpoints, all findings — baseline:
  `dast-screenshot-proof-of-scanned-url`); plus `dast-report.json` for
  machine triage; the template's two `report` jobs emit both.
- Proof of scanned URL: a capture of the report header/site tree that visibly
  shows the target URL and scan date (`dast-screenshot-proof-of-scanned-url`).
  The HTML report's site section usually suffices; a screenshot of it is the
  belt-and-suspenders form.
- `run-notes.md` — scan date, ZAP version, plan file used, token scope, edge
  allowlist made/reverted, deviations.

Don't mark the scan complete without the report files existing — the recap
distinguishes "plan generated" (automated) from "scan executed" (owner-run),
and only the latter satisfies the requirement (CONVENTIONS §2).

## Triage and false-positive pre-classification

Everything the scanner reports gets a disposition: **fixed**, **false
positive** (documented in `${CLAUDE_PLUGIN_ROOT}/templates/fp-dossier.md.tmpl`
format, with code evidence), or **documented risk acceptance**. An
undispositioned finding is the bounce class — not the finding itself
(`scan-no-clean-scan-required`).

Security-conscious endpoints predictably trip scanners on behaviors that are
**intentional controls**. The classes below recur on real scans of real
hardened surfaces; pre-classifying them turns triage from archaeology into
matching. **A class match is a hypothesis, not a disposition** — every dossier
entry still needs the actual handler code (file:line) as evidence, and the
"NOT an FP when" column is checked first. If the white-box audit ledger
already refuted the same pattern, reuse its `reasoning`/`evidence` verbatim.

| Class | What the scanner reports | Why it's usually intentional | NOT an FP when… |
|---|---|---|---|
| **A — anti-enumeration always-200** | Token revocation or forgot-password "returns 200 regardless of input", "accepts invalid values" | RFC 7009 prescribes 200 for invalid tokens on revoke; uniform forgot-password responses prevent probing which accounts exist. The uniform response IS the control | responses or timing actually diverge between valid and invalid inputs — then it's a real enumeration finding |
| **B — 405-on-GET for streamable-HTTP-only MCP endpoints** | "Method not allowed" / "endpoint broken" on `GET` to the MCP path | A streamable-HTTP MCP server with no server→client SSE stream deliberately rejects GET; the protocol surface is POST JSON-RPC (transport constraint: baseline `mcp-transport-streamable-http-only`) | the server advertises an SSE stream it then 405s, or the 405 body leaks stack traces |
| **C — 429s by design** | "Rate limiting interferes with scan", availability alerts mid-scan | Per-IP/per-token limits tripping under scanner load is the brute-force/DoS posture working | the limiter is missing on credential or expensive endpoints (the opposite finding), or its keying is spoofable via client-supplied headers |
| **D — anonymous DCR bounded by rate limits** | "Unauthenticated endpoint creates objects" on the OAuth client-registration endpoint | RFC 7591 dynamic client registration is anonymous **by spec**; abuse is bounded by rate limiting, and a registered client gains no privileged grant without explicit out-of-band binding (see baseline `mcpthreat-dcr-or-documented-alternative`) | registration is unlimited, or a freshly registered client can reach privileged grant types or scopes |
| **E — server-side-invisible brute-force controls** | "Login lacks lockout / account disable" | Lockout enforced server-side (attempt counters in a datastore) is invisible to a black-box scan that only sees uniform 401s | the lockout doesn't actually exist — confirm the code path and include it as the dossier evidence, never assert from memory |
| **F — uniform opaque rejection on signature-verified endpoints** | "Bare error responses", "no error detail" on webhook/signed-request receivers | HMAC-verified receivers that return an identical bare status for every rejection reason (bad signature, replay, unknown sender) deny attackers an oracle | the endpoint accepts unsigned requests at all, or specific required headers are genuinely absent — verify each header claim against the actual middleware before classifying |

Anything not matching a class is a **candidate real finding** — triage it
individually; blanket-dismissal via these classes is exactly the dossier
behavior that costs a review cycle. Treat as presumed-real until proven
otherwise: any reflected/stored XSS, any auth bypass (a protected call
succeeding without a valid token), any cross-tenant data in a response, any
secret in a response/header/error body, any TLS downgrade.

## Automated vs. owner-run recap (for the skill that uses this)

**Automatable:** plan generation from the template, plan-load validation,
report parsing, FP-class matching, dossier drafting, evidence-file checks.
**Owner-run:** authorizing and executing the scan, minting the token,
edge-allowlist changes, confirming each FP justification (an agent cannot
certify non-exploitability), and the submission itself. Salesforce's Product
Security team pen-tests the surface regardless of what is submitted
(`dast-salesforce-runs-own-pentest`) — this scan is required evidence, not a
substitute for their testing.

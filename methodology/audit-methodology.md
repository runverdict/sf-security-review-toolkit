# Audit Engine Specification

The engine `/sf-security-review-toolkit:audit-codebase` executes. It runs an
autonomous, multi-agent, white-box security review of the partner's own codebase,
shaped to what the AppExchange/AgentExchange security review actually probes. The
method was extracted from workflow scripts an ISV partner ran against its own
production multi-tenant SaaS (FastAPI + Postgres row-level security + an MCP
server + a managed 2GP package) across three full passes before its own
submission prep — every rule below encodes something that either produced a real
finding or wasted a verifier's time.

Read this together with CONVENTIONS.md §7 (the binding engine rules). Where this
spec and §7 disagree, §7 wins.

**What this engine is:** static code review performed by LLM agents that read
source. **What it is not:** DAST, a penetration test, or a guarantee — see §11
before reporting anything to a user.

---

## 1. Pipeline

```
scope manifest ──► dimension selection ──► stack-adapter resolution ──► TARGET MAP
                                                                          │ (user inspects)
                                                                          ▼
                          ┌──────────── per applicable dimension ────────────┐
                          │  FIND (one finder agent, structured output)       │
                          │     │ per finding                                 │
                          │     ▼                                             │
                          │  VERIFY (one adversarial verifier per finding)    │
                          └──────────────────────────────────────────────────┘
                                                                          │ barrier
                                                                          ▼
                                       SYNTHESIZE (one agent, report) ──► ledger update (mechanical)
```

| Stage | Agent? | Input | Output |
|---|---|---|---|
| Scope manifest | no (read) | `<target>/.security-review/scope-manifest.json` from `/sf-security-review-toolkit:scope-submission` | architecture elements + listing type + stack |
| Dimension selection | no | manifest × the applicability matrix (§2) | list of applicable dimensions for this pass |
| Stack-adapter resolution | cheap (greps + reads) | each dimension's detection heuristics | `<target>/.security-review/target-map.json` |
| Find | one read-only agent per dimension | dimension finder prompt + resolved targets + ledger digest | candidate findings (FINDING_SCHEMA) |
| Verify | one read-only agent per finding | the finding + shared context, NOT the finder's reasoning | verdict (VERDICT_SCHEMA) |
| Synthesize | one agent | confirmed/partial findings only | `<target>/docs/security-review/audit-report-<date>-pass<N>.md` |
| Ledger update | no — engine code, never an LLM | all verdicts | merged `<target>/.security-review/audit-ledger.json` + run-log entry |

Ordering: the verify fan-out for dimension N runs concurrently with the find
stage of dimension N+1 (this is the `pipeline()` shape in
`${CLAUDE_PLUGIN_ROOT}/harness/workflow-template.mjs`). Synthesis waits on a
full barrier — it must see every verdict, or the report under-counts.

All finder and verifier agents run **read-only** (no write/edit tools). The
audit must never mutate the repo it is auditing; the only writes are the engine's
own state files and the report.

### 1.1 Scope manifest (input contract)

The engine refuses to run without a scope manifest and tells the user to run
`/sf-security-review-toolkit:scope-submission` first — dimension selection keys
off it, and an audit of the wrong surface set is wasted spend. If the manifest is
present but stale (architecture elements no longer match the repo — e.g.
`sfdx-project.json` appeared since, or the MCP tool count changed), warn and
offer to re-scope before fanning out.

### 1.2 Dimension selection

Sixteen dimensions live in `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/`.
Each is **concept-stable, target-variable** (CONVENTIONS §7): the file defines
the threat concept, what "good" looks like, and per-stack detection heuristics —
never hard-coded paths. Applicability:

| Dimension | Applies when the manifest shows… |
|---|---|
| `oauth-identity.md` | any authenticated external endpoint or identity flow (login, OAuth, consent, dynamic client registration, invite/reset, SSO) |
| `tenant-isolation.md` | a multi-tenant backend (shared infrastructure serving more than one customer org). Single-tenant-per-deployment → mark N/A in the target map with the reason, never silently skip |
| `sessionid-egress.md` | ANY Salesforce touchpoint (package, Canvas, API integration). Cheap and auto-fail-class — always on when Salesforce-adjacent code exists |
| `secrets-credentials.md` | always |
| `mcp-surface.md` | an MCP server |
| `mcp-threat-model.md` | an MCP server (token passthrough, audience validation, confused deputy, tool poisoning — the MCP-specific classes beyond classic AppSec) |
| `injection-xss.md` | always for the injection half (server code exists); the XSS half needs a rendered UI (web app, LWC/Aura/Visualforce) |
| `web-client.md` | a browser-delivered frontend (web app, Canvas-embedded app, LWC) |
| `crypto-internals.md` | custom cryptography in code: JWT handling, HMAC verification, encryption at rest, password hashing, token generation |
| `background-jobs.md` | async workers, schedulers, queues (Celery/Sidekiq/BullMQ/cron-alikes) touching tenant data |
| `data-export.md` | file/CSV/archive export or upload endpoints |
| `email-outbound.md` | outbound message construction (email, chat posts, webhooks) from user- or CRM-influenced data |
| `admin-surface.md` | a privileged operator/admin console or admin-role endpoints — the highest-value target in a multi-tenant product, because a break there is cross-tenant by construction |
| `agentforce-package.md` | a managed-package element carrying packaged-AI metadata (`genAiPlannerBundle`/`genAiPlugin`/`genAiFunction`/`genAiPromptTemplate`, `Bot`, or autolaunched-flow / invocable-Apex agent actions) — **independent of whether an MCP server exists**. The AgentExchange auto-fail classes (VerifiedCustomerId scoping, user-controlled record refs, third-party-LLM-in-package, prompt hardening) live here |
| `package-metadata.md` | a managed-package element — audits the package's **metadata/XML** surface (LWC/Aura/VF component config + apiVersion, message channels, weblinks/buttons, component CSS, RemoteSiteSettings/CspTrustedSites), the Top-20 violation class no code-AST dimension reads |
| `apex-exposed-surface.md` | a managed-package element with Apex — the **exposed-entry-point authorization** surface (`@AuraEnabled`/`@RestResource`/`webservice`/`@InvocableMethod`/`global`/guest-reachable) that Code Analyzer path-traces but does not reason about (*should* this be exposed? per-record/IDOR authz?) |

Packaged Apex's **structured CRUD/FLS dataflow** stays Code Analyzer's job (the
Graph Engine pass, orchestrated by `/sf-security-review-toolkit:run-scans`) — the
engine never claims to reproduce SFGE's dataflow analysis. But two Apex/package
concerns Code Analyzer does **not** reason about are now first-class dimensions:
`apex-exposed-surface` (whether an entry point *should* be exposed + per-record /
IDOR authorization) and `package-metadata` (the metadata/XML violation class).
Several other dimensions also carry Apex-specific heuristics where the concept
overlaps (SOQL/SOSL injection → `injection-xss`, metadata secrets →
`secrets-credentials`, package session handling → `sessionid-egress`). The
report's "not covered" list still names what only Code Analyzer's structured
CRUD/FLS dataflow and the owner-run scans reach.

### 1.3 Stack-adapter resolution (the target map)

For each applicable dimension, execute its detection heuristics against the
actual repo (manifest checks, greps, conventional-path probes per framework) and
resolve concrete targets. Emit
`<target>/.security-review/target-map.json`:

```json
{
  "pass": 1,
  "generated": "<ISO date>",
  "dimensions": [
    {
      "key": "oauth-identity",
      "applicable": true,
      "targets": ["src/api/routes/oauth.py", "src/services/oauth_service.py"],
      "stack_notes": "FastAPI; authz via dependency injection; tokens minted in oauth_service",
      "confidence": "high | medium | low",
      "unresolved": false
    },
    { "key": "tenant-isolation", "applicable": false, "na_reason": "single-tenant per deployment" }
  ]
}
```

Rules:

- **Show the map to the user before fanning out.** This is the one cheap moment
  to correct course — a wrong target map silently audits the wrong code for the
  whole run. Let the user edit paths or veto dimensions.
- **`applicable: true` + no targets found = `unresolved: true`**, surfaced as
  "couldn't map dimension X — point me at the code or confirm it's N/A." Never
  silently skip an applicable dimension; a skipped dimension is a false sense of
  coverage, which is worse than no audit.
- Targets are *starting points*, not boundaries. Finder prompts explicitly allow
  following imports and call-sites, and grepping for the real file when an
  adapter path is approximate (low-confidence adapters produce approximate
  paths; the field scripts handled this with "use grep to FIND the real files if
  a path is approximate" — keep that instruction).
- `stack_notes` carries the repo facts a finder needs to be effective: framework,
  ORM, where routes live, and — critically — the partner's *claimed* security
  model ("tenant isolation enforced by Postgres row-level security keyed on a
  session variable; in-tenant visibility filtered at the service layer").
  Claims are labeled as claims. The single most productive instruction in the
  field runs was: **verify the claimed model against the actual code, do not
  assume it.** Most confirmed findings were gaps between the claimed model and
  one code path that forgot it.

---

## 2. The find stage

One finder agent per applicable dimension. Structured output is mandatory —
free-text findings cannot be verified, deduplicated, or ledgered.

### 2.1 FINDING_SCHEMA (verbatim — do not extend without updating the ledger merge)

```json
{
  "type": "object",
  "properties": {
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "title": { "type": "string" },
          "severity": { "type": "string", "enum": ["critical", "high", "medium", "low", "info"] },
          "file": { "type": "string", "description": "path:line of the vulnerable code" },
          "description": { "type": "string" },
          "exploit_scenario": { "type": "string", "description": "attacker, request, impact" },
          "recommendation": { "type": "string" },
          "confidence": { "type": "string", "enum": ["high", "medium", "low"] }
        },
        "required": ["title", "severity", "file", "description", "exploit_scenario", "recommendation", "confidence"]
      }
    }
  },
  "required": ["findings"]
}
```

An empty `findings` array is a valid, expected result — finders must not invent
findings to look productive, and the engine must not treat an empty result as a
failure.

### 2.2 Finder prompt assembly

Each finder prompt is assembled from four blocks:

```
{{SHARED_CONTEXT}}

## Your dimension: {{DIMENSION_KEY}}

Primary targets (read these first, then follow imports/call-sites; use grep to
locate the real files when a path is approximate):
{{TARGETS}}

Stack notes (claims from the partner's own docs — verify against the ACTUAL
code, never assume):
{{STACK_NOTES}}

Threat focus:
{{FINDER_PROMPT_BLOCK}}        ← the dimension file's finder prompt block

Known findings — do NOT re-report any of these:
{{LEDGER}}

Read the ACTUAL code in {{REPO}}. Report every grounded finding with exact
file:line and a concrete exploit_scenario. If a control is correctly
implemented, do NOT report it as a finding (you may note a notably strong
control as a single info-level finding). Return your findings.
```

`{{SHARED_CONTEXT}}` is built once per run from the scope manifest and is
identical for every finder and verifier in the run:

```
You are a security reviewer auditing {{PRODUCT_ONE_LINER}} for the Salesforce
AppExchange/AgentExchange security review. The review probes:
{{REVIEW_SURFACES}}   ← from the scope manifest (e.g. "a partner-hosted MCP
                         server, a Canvas-embedded web app, the package callouts")

Stack: {{STACK_SUMMARY}}. Code root: {{REPO}}.

Architecture security model (claims from the partner's own documentation —
verify every claim against the ACTUAL code, do not assume):
{{SECURITY_MODEL_CLAIMS}}

Report ONLY findings grounded in real code you have READ, with exact file:line.
A finding is something a Salesforce security reviewer would flag and require
remediated or justified before approval, OR a real exploitable weakness. Prefer
precision over volume — a false alarm wastes the verifier's time and the
partner's. Dependency-version issues are handled by separate scanners
(/sf-security-review-toolkit:run-scans); report one only when a SPECIFIC
exploitable usage exists in this codebase, not a generic version bump.
Severity: critical (auto-fail class / cross-tenant or full compromise), high
(must fix before submission), medium (should fix / likely flagged), low
(hardening), info (note). For each finding give a concrete exploit_scenario
describing the attacker, the request, and the impact.
```

`{{LEDGER}}` is the do-not-re-report digest (§5.3). In the original field
scripts this was a hand-maintained "ALREADY FIXED THIS SESSION" block; the
ledger automates it. Without it, every pass re-discovers the same top findings
and the verify fan-out pays for them again — the digest is what makes pass N+1
cheap and quiet.

The dimension file's **finder prompt block** is a single paragraph of
imperative probes ("Probe: …, …, …") naming the concrete attack questions for
that concept — not background prose. Density matters: the field runs showed
finders anchor on the named probes and explore outward from them.

### 2.3 Finder conduct rules

- Read before reporting. A finding citing a file the agent never opened is a
  schema-valid hallucination; the verify stage exists to kill these, but finders
  that read first waste fewer verifier agents.
- Correct controls are not findings (CONVENTIONS §7). One info-level "strong
  control" note per dimension is allowed — it feeds the report's reviewer
  narrative — but listing every good control is noise.
- `severity` and `confidence` at this stage are hypotheses. The verifier's
  `adjusted_severity` is authoritative everywhere downstream.

---

## 3. The verify stage

One **skeptical verifier per finding**, in a fresh context. The verifier
receives the finding and the shared context — never the finder's chain of
reasoning. That independence is the point: a verifier that marinated in the
finder's argument confirms it; a verifier that has to re-derive reachability
from the code refutes the bad ones. In field use this stage refuted a large
share of candidates — it is where the engine earns the precision that makes the
output usable.

### 3.1 Verifier prompt

```
{{SHARED_CONTEXT}}

## Adversarial verification

A finder in the '{{DIMENSION_KEY}}' dimension reported the finding below. Your
job is to REFUTE it if you can. Read the actual code at the cited location AND
every control that gates the claimed path (auth dependency, tenant-isolation
policy, scope check, input validation, constant-time compare, nonce handling —
whatever applies to the claim). Default to skepticism: many findings are false
positives because a control elsewhere already prevents them, OR because the
behavior is intentional and spec-correct — e.g., loopback redirect URIs on a
native-client OAuth flow are REQUIRED by RFC 8252; flagging them is itself an
error. Only confirm if the exploit is genuinely reachable in the real code.

FINDING:
- title: {{TITLE}}
- severity: {{SEVERITY}}
- file: {{FILE}}
- description: {{DESCRIPTION}}
- exploit_scenario: {{EXPLOIT_SCENARIO}}

Read {{REPO}}/{{FILE_PATH}} and any code that gates the claimed path. Return
your verdict with the exact code evidence that decides it.
```

### 3.2 VERDICT_SCHEMA (verbatim)

```json
{
  "type": "object",
  "properties": {
    "verdict": { "type": "string", "enum": ["confirmed_real", "false_positive", "partially_real"] },
    "adjusted_severity": { "type": "string", "enum": ["critical", "high", "medium", "low", "info"] },
    "reasoning": { "type": "string", "description": "what you read in the actual code that confirms or refutes the finding" },
    "evidence": { "type": "string", "description": "exact file:line + code snippet that decides it" }
  },
  "required": ["verdict", "adjusted_severity", "reasoning", "evidence"]
}
```

`partially_real` means the defect exists but the exploit scenario overstates it
(a real gap behind an unstated precondition, a lower-impact variant). It is kept
and reported with the — usually lower — `adjusted_severity`.

### 3.3 The hard rule

**Findings that skip verification are never reported** (CONVENTIONS §7). If a
verifier crashes, times out, or fails schema validation: re-queue that one
finding once; if it fails again, the finding goes to the run log as
`unverified — re-run`, not to the report and not to the ledger as confirmed.
Reporting an unverified finding once destroys the engine's credibility with the
partner — and a partner who stops trusting the findings stops fixing them.

---

## 4. Severity taxonomy

The five levels (CONVENTIONS §7) and what each means for the review. The
authoritative auto-fail/blocker classification per requirement lives in
`${CLAUDE_PLUGIN_ROOT}/baseline/requirements-baseline.yaml`
(`severity_if_missing`); this table is the engine-side mapping, not a fact
source for fees, thresholds, or timelines.

| Severity | Meaning | Review consequence | Downstream handling |
|---|---|---|---|
| `critical` | Auto-fail class: cross-tenant read/write, key or secret compromise, session-identifier egress off-platform, unauthenticated reach into tenant data | Submitting with this open burns the attempt — a fee-bearing resubmission plus lost queue position (see baseline entries `process-review-fee` and `process-review-timeline` for current figures; both are perishable facts) | The journey halts here. Fix before artifact generation — the AuthN/AuthZ doc would otherwise describe the vulnerable flow. Readiness verdict: NOT READY |
| `high` | Exploitable by a single authenticated user or a realistic external attacker; a reviewer running their own pen test plausibly reproduces it | Near-certain failed cycle | Must fix before submission. Readiness verdict: NOT READY |
| `medium` | Likely flagged: missing defense-in-depth, exploitable only under limited preconditions | Fix-or-document | Fix, or carry a justified entry in the false-positive dossier (`${CLAUDE_PLUGIN_ROOT}/templates/fp-dossier.md.tmpl`). Undispositioned mediums block the compile-submission gate |
| `low` | Hardening | Rarely blocks alone, but volume reads as immaturity to a reviewer | Backlog; dossier mention optional |
| `info` | Notable observation, including notably strong controls | None | Feeds the "strong controls observed" narrative in the report and artifacts |

`adjusted_severity` (the verifier's) is what sorts the report, drives the
gates, and lands in the ledger. The finder's `severity` is retained only as
provenance.

### 4.1 The eight-category report spine

Severity sorts the report; **category** is the second axis a Salesforce reviewer
reads it on. The engine groups findings into eight named assessment categories —
the engine's own categorization, aligned to the assessment buckets a Salesforce
reviewer reads a submission on — and the Solution Architecture Document expects
findings grouped that way. The eight-category spine is an engine convention, not
a requirement fact, so it carries no baseline id. Every confirmed finding
(`confirmed`/`partially_real`) and every readiness-tracker row therefore carries
a **reviewer category** in addition to its dimension. The two axes are not the
same thing: a *dimension* is the engine's attack-surface unit (where the finder
looked); a *category* is the reviewer's assessment bucket (what the defect IS).
One dimension can emit findings in several categories — `oauth-identity` produces
both authentication/session and authorization defects; `injection-xss` produces
both input-validation and output-encoding defects.

The eight categories (use these exact keys — they are the report spine and the
§9 matrix's row set):

| Category key | Covers |
|---|---|
| `authentication/session-management` | login, token issuance/validation, session lifecycle, MFA, credential verification, audience/issuer/expiry checks, session-fixation/egress |
| `authorization` | access control: CRUD/FLS, sharing/visibility, tenant isolation, IDOR/object-level authz, permission-set/role over-grants, privileged-surface reach |
| `input-validation` | injection (SOQL/SQL/command/LDAP), SSRF, deserialization, path traversal, untrusted-data-as-instructions, unvalidated redirect targets |
| `output-encoding` | XSS (DOM/reflected/stored), HTML/JS/URL encoding, template/markdown rendering, content-type/CSP, agent output-egress to a rendered surface |
| `cryptography` | algorithm/mode choice, key derivation/management, HMAC/JWT signature verification, randomness/CSPRNG, constant-time compare, encryption-at-rest |
| `communications-security` | TLS posture, certificate validation, HTTPS-only transport, plaintext channels, SessionId/secret egress over the wire |
| `logging/error-handling` | sensitive data in logs, verbose/stack-trace error leakage, missing audit trail on security events, debug mode in production |
| `secrets-storage` | hardcoded secrets, secrets in metadata/source/URLs, credential storage posture, secrets in state files or client-visible config |

**Tagging is mechanical, not a new agent and not a new schema field.** The
FINDING_SCHEMA and VERDICT_SCHEMA (§2.1, §3.2) are unchanged — adding a required
field to either would break the ledger merge and every harness call. Instead the
engine derives `category` after verification, from a deterministic
**dimension × finding-title → category** map the synthesis step applies (and the
ledger merge records alongside the entry, the same way it records `dimension`).
Each dimension declares its candidate categories; the synthesis agent picks the
single best-fit category per confirmed finding from that dimension's allowed set,
using the title and the verified evidence. The default dimension→category mapping:

| Dimension | Default category | Secondary (title-resolved) |
|---|---|---|
| `oauth-identity` | `authentication/session-management` | `authorization` (privileged grants, role changes) |
| `mcp-surface` | `authentication/session-management` | `authorization` |
| `mcp-threat-model` | `authorization` (audience/confused-deputy) | `input-validation` (SSRF, untrusted-text-as-instructions), `output-encoding` (output-egress), `communications-security` (token transport), `secrets-storage` (allowlist exposure) |
| `sessionid-egress` | `communications-security` | `secrets-storage` |
| `tenant-isolation` | `authorization` | — |
| `admin-surface` | `authorization` | `authentication/session-management` |
| `injection-xss` | `input-validation` (injection half) | `output-encoding` (XSS half) |
| `web-client` | `output-encoding` | `authentication/session-management` (token storage) |
| `crypto-internals` | `cryptography` | — |
| `secrets-credentials` | `secrets-storage` | `cryptography` (weak KDF) |
| `background-jobs` | `authorization` | `logging/error-handling` |
| `data-export` | `authorization` | `output-encoding` |
| `email-outbound` | `output-encoding` | `input-validation` |
| `agentforce-package` | `authorization` (VerifiedCustomerId/IDOR, action authz) | `input-validation` (prompt injection), `output-encoding` (LLM output to render/DML), `communications-security` (third-party-LLM egress), `logging/error-handling` (prompt/response logging) |
| `package-metadata` | `output-encoding` (component XSS/CSS/JS-in-domain) | `communications-security` (RemoteSiteSettings/CspTrustedSites), `authorization` (CSRF on instantiation), `secrets-storage` (sensitive-info-in-URL) |
| `apex-exposed-surface` | `authorization` (entry-point authz / IDOR / over-exposure / guest reach) | `authentication/session-management` (unauthenticated guest entry points) |

Rules:

- **A confirmed finding always gets exactly one category** — the reviewer's
  buckets are mutually exclusive, so a finding that *spans* two (a SOQL string
  built from a request param that is also echoed unescaped) is filed under the
  category of its **root cause** (here `input-validation`), with the second named
  in the finding's report row. Never double-count one finding across two matrix
  cells; the per-category counts must sum to the total confirmed count.
- **This map is consumed mechanically by `harness/artifact-gate.mjs`** — its
  `AUTHN_AUTHZ_DIMENSIONS` set is every dimension whose **default OR secondary**
  category is `authentication/session-management` or `authorization` (which is
  why `web-client` and `package-metadata` are in it, via their secondaries). The
  gate withholds the AuthN/AuthZ artifact under continue-with-flags when an open
  critical/high finding sits in one of those dimensions. If you change a
  dimension's category here, update that set (and `acceptance/test-artifact-gate.mjs`).
- **A category with no applicable dimension is `not-assessed-by-this-engine`,
  not `pass`.** The engine reads source; it does not exercise the running system.
  Several categories are only partly visible to static review —
  `communications-security` (TLS posture is owner-run SSL Labs, not code) and the
  packaged-Apex slice of `authorization` (CRUD/FLS is Code Analyzer's pass, §1.2).
  The matrix marks these explicitly so a green cell is never read as coverage the
  engine did not provide (§11).
- The mapping is data the synthesis step consumes; it is **not** an LLM judgment
  call about severity or reachability — those stay with the verifier. Mis-filing a
  category is a cosmetic report defect; mis-merging the ledger is a lost audit
  trail (§5.2), which is why category never enters the dedup key.

---

## 5. The ledger

`<target>/.security-review/audit-ledger.json`. Schema:
`${CLAUDE_PLUGIN_ROOT}/templates/audit-ledger.schema.json`. The ledger is the
engine's memory across runs; it is updated **mechanically by engine code, never
by an LLM agent** — a synthesis agent paraphrasing ledger entries corrupts the
dedup keys.

### 5.1 Entry states

| State | Set when | Meaning to the next pass |
|---|---|---|
| `confirmed` | Verifier returned `confirmed_real` or `partially_real` | Open finding. In the `{{LEDGER}}` digest as do-not-re-report; counts against the readiness gates |
| `refuted` | Verifier returned `false_positive` | Kept, not deleted: it stops the next pass's finder from re-raising the same non-issue, and its `reasoning`/`evidence` is reusable verbatim when a scanner later flags the same pattern (the FP dossier feeds on these) |
| `fixed` | The partner remediated; set with a fix reference (commit/PR) — by the user or by a skill that verified the fix landed | In the digest as "re-report ONLY if regressed." A new candidate matching a `fixed` entry's dedup key flips it back to `confirmed` with a regression marker — the engine handles this in the merge; finders don't need a special field |
| `accepted_risk` | The partner decided, with a written `accepted_risk_justification` and a named owner, not to fix a real defect — an owner decision, never agent-made (the schema rejects the status without the justification) | Dispositioned for the readiness gates like a dossier entry, but the defect is real: it stays in the digest as do-not-re-report and surfaces by name in the readiness tracker and verdict so the acceptance is visible, never buried |

### 5.2 Dedup key: normalized file + normalized title — never description

Key = file path with any `:line` suffix stripped, plus the title lowercased
with whitespace and punctuation collapsed. Rationale, learned the slow way:

- **Descriptions are model prose.** Two finders (or the same finder on two
  runs) describe the same defect in structurally different sentences;
  description-similarity dedup either over-merges distinct findings or lets
  duplicates through, and embedding tricks add cost without determinism.
- **Line numbers drift** with every unrelated edit; keeping them in the key
  makes every refactor "discover" old findings again.
- File + title is what independent agents actually converge on for the same
  defect, and it is deterministic, inspectable, and diff-able in review.

Near-misses (same defect, different title wording across dimensions) are merged
at synthesis time in the *report*, but the ledger keeps both entries — a wrong
automated merge in the ledger is worse than a cosmetic duplicate, because it
silently drops one finding's audit trail.

### 5.3 The digest

Before each pass, the engine compiles every ledger entry into the `{{LEDGER}}`
block: `[state] title — file (one-line resolution or refute reason)`. Keep it to
one line per entry; the digest is prompt overhead multiplied by every finder
agent in the pass.

---

## 6. Pass planning

A pass = one full find→verify→synthesize cycle over a band of dimensions.
Default bands, ordered by how a reviewer actually attacks:

| Pass | Band | Default dimensions |
|---|---|---|
| 1 | **External attack surface** — what the review's own pen test hits from outside | `oauth-identity`, `mcp-surface`, `mcp-threat-model`, `sessionid-egress`, `tenant-isolation` (cross-tenant focus), `injection-xss`, `web-client`, `secrets-credentials`, `agentforce-package` (BLOCKER agent auto-fails), `package-metadata` (UI/metadata violations), `apex-exposed-surface` (entry-point/IDOR/guest reach) |
| 2 | **Intra-org authorization + privileged surfaces** — what an authenticated tenant user or a hostile insider reaches | `admin-surface`, plus focused re-runs of `tenant-isolation` (in-tenant object-level authorization / IDOR matrix), `oauth-identity` (privileged grants, role changes), `web-client` (authenticated flows, token storage) — re-runs are cheap because the pass-1 ledger digest suppresses everything already found |
| 3 | **Internals** — what only a code reader finds | `crypto-internals`, `background-jobs`, `data-export`, `email-outbound` |

Membership is decided by the scope manifest (§1.2), not the table — a product
with no MCP server runs pass 1 without the MCP dimensions; a product with no
async workers drops `background-jobs` from pass 3 with an N/A reason in the
target map.

Why this order: pass 1 contains every auto-fail class, so it must run first —
there is no point polishing background-job tenant binding while a cross-tenant
IDOR is open. Pass 2 is where the field runs found the violations of the
partner's own claimed model (the one endpoint that forgot the visibility
filter). Pass 3 catches the quiet catastrophic class — nonce reuse, an
unauthenticated decrypt, a worker that runs without tenant scoping — that
neither scanners nor an external pen test reliably surface.

**Stop rule: two consecutive dry passes.** A pass is *dry* when it confirms
zero new findings at severity `low` or above (new `info` entries don't count).
After the three banded passes, further passes re-run **all** applicable
dimensions against the full ledger. One dry pass is not evidence — it may only
mean the band missed where the bugs live; the second consecutive dry pass must
therefore be a full-band pass. Two in a row is the signal that the engine has
exhausted what this method finds in this codebase — which is not the same as
"the codebase is secure" (§11).

---

## 7. Token tiers

Declared to the user **before** launching anything (CONVENTIONS §5). Costs are
honest estimates, not promises: a tier bounds the *finder* count; the verify
fan-out scales with what the finders find, so a target-rich codebase costs more
at every tier. The skill reports the live agent count as the run progresses.

| Tier | What runs | Approx. agents | Honest cost note |
|---|---|---|---|
| `quick` | Top-failure dimensions only, one pass: `sessionid-egress`, `tenant-isolation`, `oauth-identity`, `secrets-credentials`, `injection-xss` (+ `mcp-surface` when an MCP server exists) | ~8–10 (5–6 finders + verifiers + synthesis) | A triage, not an audit. Catches the auto-fail classes; says nothing about the other dimensions and the report must list them as not covered |
| `standard` | All applicable dimensions, one pass (the pass-1 band plus whatever the manifest activates) | ~20–30 | The default. Each finder reads tens of files; expect a run measured in millions of tokens and an hour-plus of wall clock on a real codebase |
| `exhaustive` | Multi-pass per §6 until two consecutive dry passes | ~50–80 across passes | What the method was field-proven at (three passes). Several times `standard` cost; spread it across work sessions — the ledger makes every resumption incremental |

Never present `quick` output as review readiness. The readiness verdict in
`/sf-security-review-toolkit:compile-submission` records which tier and how many
passes produced the ledger it is reading.

---

## 8. Execution substrates

### 8.1 Workflow tool (preferred)

`${CLAUDE_PLUGIN_ROOT}/harness/workflow-template.mjs` is the parameterized
implementation: phases (Find / Verify / Synthesize), a `pipeline()` over
dimensions whose stage 1 is the finder and stage 2 fans out one verifier per
finding via `parallel()`, schema-enforced structured output on every agent
call, and read-only agent types throughout. The template takes the run
parameters (repo root, shared context, resolved target map, ledger digest,
tier) and is otherwise codebase-agnostic.

### 8.2 Sequential subagent fallback

Workflow-tool availability varies by environment. The same engine degrades to
plain sequential subagent (Task/Agent) calls —
`${CLAUDE_PLUGIN_ROOT}/harness/sequential-fallback.md` documents the mechanics.
The non-negotiables that survive the degradation:

- Same prompts, same schemas, same shared context. The substrate changes; the
  method does not.
- One dimension at a time: find, then verify that dimension's findings, then
  persist the verdicts to disk **before** starting the next dimension. A
  sequential run is long; an interrupted run that persisted nothing is a total
  loss, so intermediate stage output is written under
  `<target>/.security-review/` as it is produced and the fallback resumes from
  the last persisted dimension.
- Schema enforcement degrades from harness-enforced to instruct-validate-retry:
  include the JSON schema in the prompt, validate the response, re-prompt once
  on failure, then treat as the §3.3 unverified case.
- Verifier independence still holds: each verifier is a fresh subagent that
  gets the finding, never the finder's transcript.

Sequential runs trade wall-clock for availability (no find/verify overlap).
Token cost is comparable; say so when offering the fallback.

---

## 9. Synthesis

One agent, fed **only** the confirmed/partially-real findings (refuted ones are
already in the ledger; they never reach the report as findings). Output goes to
`<target>/docs/security-review/audit-report-<date>-pass<N>.md` with this
contract:

1. **Executive summary** — is this surface ready for the review? Blocking items
   (`critical`/`high`) vs hardening, stated plainly. Anything on a cross-tenant
   or privileged-surface path called out explicitly.
2. **Prioritized findings table** — `adjusted_severity` | category | dimension |
   title | file:line | one-line fix; sorted critical→low; overlapping findings
   across dimensions deduplicated *in the table* (the ledger keeps both, §5.2).
   The `category` column is the §4.1 reviewer category (one per finding); where a
   finding spans two, the row names the secondary in its fix cell.
3. **Per-category coverage matrix** — the eight-category spine (§4.1), rendered
   as one row per category so the reviewer and the Solution Architecture Document
   read the report in the "category × status × findings" shape they expect:

   | Column | Contents |
   |---|---|
   | Category | one of the eight §4.1 keys, all eight always listed |
   | Status | `findings-open` (any `critical`/`high` in this category), `findings-to-disposition` (only `medium`/`low`), `assessed-clean` (a dimension covered it and confirmed nothing at `low`+), `not-assessed-by-this-engine` (no applicable dimension, or the category is owner-run/Code-Analyzer territory — never silently blank) |
   | Findings | count by `adjusted_severity` (e.g. `1 high, 2 medium`) or `—` |
   | Covered by | the dimension(s) that assessed this category, or the explicit reason it was not (`owner-run SSL Labs`, `Code Analyzer CRUD/FLS pass`, `N/A — no MCP server`) |

   Hard honesty rule (§11): `assessed-clean` means "this engine's static review
   confirmed nothing at `low`+ in this category," never "this category passes."
   `not-assessed-by-this-engine` is the **default** for `communications-security`
   (TLS is owner-run) and the packaged-Apex slice of `authorization` (Code
   Analyzer's pass) — the matrix must not render those as clean. The per-category
   finding counts must sum to the total confirmed-finding count (§4.1's
   one-category-per-finding rule guarantees this).
4. **Remediation plan** per `critical`/`high` finding — short and concrete.
5. **Strong controls observed** — the info-level notes, written for reuse in
   the reviewer-facing artifacts (this section is what
   `/sf-security-review-toolkit:generate-artifacts` mines for the controls
   narrative).
6. **Coverage and residual risk** — which dimensions ran, which were N/A and
   why, which were unresolved, what this method cannot see (§11). A report
   without this section is dishonest by omission. The category matrix's
   `not-assessed-by-this-engine` rows are restated here as residual risk the
   owner-run scans and Salesforce's own pen test still own.
7. **Readiness-tracker mapping** — each finding tagged to BOTH its §4.1 reviewer
   category and the tracker categories consumed by
   `${CLAUDE_PLUGIN_ROOT}/templates/readiness-tracker.md.tmpl` and
   `/sf-security-review-toolkit:compile-submission`, so each tracker row carries
   its reviewer category through to the readiness verdict's per-category matrix.

After synthesis, the engine (code, not the agent): merges verdicts into the
ledger by dedup key, **stamps the pass's `audited_commit` with the repo HEAD SHA
(the resumption fingerprint)**, appends the pass summary to
`<target>/.security-review/run-log.md` (pass number, tier, dimensions run,
candidates/confirmed/refuted counts, report path), and prints the per-§3.3
unverified list if any.

**Resumption / staleness.** On a resumed run, before trusting a prior pass's
findings the engine runs `harness/ledger-staleness.mjs`, which diffs the repo
HEAD against the latest pass's `audited_commit` and flags any finding whose file
changed since — a `fixed` whose fix was reverted, a `refuted` whose
non-exploitability no longer holds, a `confirmed` already remediated. Stale
findings are surfaced as "re-audit before the verdict relies on this," never
silently carried forward; a ledger with no fingerprint cannot be verified and
says so. The triage gate likewise records the operator's blocker-policy election
to `<target>/.security-review/triage-decision.json`, which `harness/artifact-gate.mjs`
reads to decide clean / flagged / STOP on every entry path (CONVENTIONS §7).

---

## 10. Run outputs (the full set)

| File | Written by | Committed? |
|---|---|---|
| `.security-review/target-map.json` | adapter stage | yes (recommended — it documents what was and wasn't audited) |
| `.security-review/audit-ledger.json` | engine merge | yes — the ledger is what makes re-audits incremental (CONVENTIONS §6); each pass carries an `audited_commit` fingerprint |
| `.security-review/triage-decision.json` | triage gate | yes — the persisted blocker-policy election; read by `harness/artifact-gate.mjs` |
| `.security-review/run-log.md` | engine | yes |
| `docs/security-review/audit-report-<date>-pass<N>.md` | synthesis agent | yes |

No state file may contain secrets (CONVENTIONS §6). If a finding's `evidence`
snippet captures a credential value, the engine redacts the value in every
output (`***redacted***`) and says where the secret should live instead — the
finding itself (hardcoded secret) is of course kept.

---

## 11. Honesty constraints (non-negotiable, CONVENTIONS §2)

- This is **white-box static review by LLM agents reading source**. It is never
  described as DAST, a penetration test, dynamic testing, or a certification —
  in the report, in the run recap, in the readiness verdict, anywhere. The
  review's DAST requirement is satisfied only by an actual authenticated scan
  (`/sf-security-review-toolkit:run-scans`), and Salesforce performs its own
  penetration testing regardless of anything submitted.
- The verify stage controls **false positives**. Nothing in this engine bounds
  **false negatives** except dimension coverage and multiple passes. A dry pass
  means "this method found nothing new," never "nothing is there." Reports say
  "no confirmed findings within the audited dimensions," never "secure" or
  "clean."
- A `confirmed` finding is an input to engineering judgment, not a verdict on a
  person or a guarantee of reviewer behavior. A fully green ledger does not
  predict a passed review.
- Every run ends with the automated-vs-manual recap: what the agents did
  (which dimensions, how many candidates, how many refuted), and what remains
  owner-run (fixes, scans, submission).

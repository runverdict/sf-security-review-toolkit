# Reviewer Challenge Checklist (WI-21)

The data the `/sf-security-review-toolkit:reviewer-simulation` skill synthesizes
against the audit ledger + scan evidence. It encodes **how Salesforce Product
Security attacks a submission** — the questions they ask and the order they ask
them — so the toolkit can answer, for each, *"what will the reviewer find?"*

This is not a new requirement set; every challenge maps to a dimension and/or a
baseline id the toolkit already covers. The value is the **reviewer's framing and
priority order**: a partner whose code is "clean by our dimensions" still wants to
know what the human tester will hit first, and whether the toolkit already found
it. A challenge the toolkit confirmed open is *exactly* what the reviewer will
reproduce; a challenge the toolkit refuted with code evidence is a no-surprises
disclosure for the FP dossier.

## How the reviewer works (the order that drives the ranking)

Follow-the-data, attack-the-reachable-first. The tiers below are the reviewer's
priority order — `reviewer-simulation` reports them top-down, because the first
confirmed-open challenge in Tier 1 is the headline the partner must fix before
anything else.

| Tier | Reviewer intent | Why first |
|---|---|---|
| 1. Public / guest reach | "What can an anonymous internet visitor touch?" | A guest-reachable bug is cross-tenant by construction and needs no credentials — the highest-value, lowest-effort finding |
| 2. AuthN / AuthZ bypass | "Can I act as someone I'm not, or reach data I shouldn't?" | Token passthrough, IDOR, per-record/per-tool authz — the #1 real-world breach class |
| 3. Injection | "Can I make the system run my input as code/instructions?" | SOQL/SOSL, OS command, XSS, prompt injection — classic and reliably reproducible |
| 4. Data exposure / egress | "What leaves the boundary that shouldn't?" | Session-id egress, undisclosed third-party-LLM/inference egress, recoverable secrets |
| 5. Package hygiene | "What does a metadata + Code-Analyzer read flag?" | CRUD/FLS, sharing, Locker<40, JS-in-origin, CSRF, open-redirect — the Top-20 corpus |
| 6. Infra / supply chain | "What's weak in the deps + the way it's hosted?" | Known-CVE libs, IaC misconfig, TLS posture |

## The challenges

Each row: the reviewer's question · what they actually do · the dimension(s) /
scan family that answers it · the baseline id(s) · which scope element triggers
it. `reviewer-simulation` marks each **WILL-FIND** (a confirmed-open ledger entry
or scan finding matches), **ADDRESSED-fixed** (a `fixed` ledger entry — a real
remediation with a fix commit + clean re-scan, disclosed as resolved),
**ADDRESSED-refuted(FP)** (a `refuted` entry with non-exploitability reasoning or
a satisfied control — disclosed via the FP dossier, NEVER as a fix), or
**NOT-STATICALLY-EXAMINED** (genuine pen-test territory the static pass cannot
settle — name it, never imply it's clean). The two ADDRESSED sub-labels stay
distinct everywhere a verdict is rendered so a refuted finding is never skim-read
as fixed.

### Tier 1 — Public / guest reach

| # | Reviewer question | The probe | Answered by | Baseline | Element |
|---|---|---|---|---|---|
| 1.1 | Can a guest/anonymous user reach packaged Apex? | enumerate Sites/Experience guest profile `classAccesses`; call the granted `@AuraEnabled`/REST as guest | `apex-exposed-surface` (guest probe) | `violation-crud-fls-bypass` (case 4), `fail-sharing-model` | managed-package |
| 1.2 | Is the external endpoint reachable unauthenticated? | hit every route with no/invalid credential; check the auth dependency runs before business logic | `oauth-identity`, `mcp-surface`, run-scans F7 (SAST auth-gap) | `endpoint-multi-tenant-isolation` | external-endpoint |
| 1.3 | Does a guest path read/write records by id? | guest-reachable method + caller-supplied id with no per-record check | `apex-exposed-surface` (IDOR×guest) | `violation-crud-fls-bypass` | managed-package |

### Tier 2 — AuthN / AuthZ bypass

| # | Reviewer question | The probe | Answered by | Baseline | Element |
|---|---|---|---|---|---|
| 2.1 | Can I read another tenant's / customer's data? (IDOR) | supply another record's id to every exposed entry point; for a service agent, omit/forge `VerifiedCustomerId` | `apex-exposed-surface`, `agentforce-package`, `tenant-isolation` | `agentforce-execution-identity-verifiedcustomerid`, `fail-crud-fls` | package / agentforce |
| 2.2 | Can the agent/LLM name a record handle it shouldn't? | a `GenAiFunction` input that is a record id/object/field with `isUserInput` not false | `agentforce-package` | `agentforce-no-user-controlled-record-references` | agentforce |
| 2.3 | Is a token passed through / not audience-validated? (MCP) | replay an inbound bearer to an outbound call; check `aud`/resource-indicator validation | `mcp-threat-model` | `mcpthreat-token-passthrough-prohibited`, `mcpthreat-resource-indicators-audience` | mcp-server |
| 2.4 | Does `tools/call` enforce scope a client never `tools/list`-ed? | call a write tool by name with a low-scope token | `mcp-surface`, `oauth-identity` | `mcp-per-user-authz-mechanics` | mcp-server |
| 2.5 | Is a `global`/`webservice`/`@RemoteAction` over-exposed? | enumerate the package public API; call each as a low-priv subscriber user | `apex-exposed-surface` | `fail-sharing-model` | managed-package |
| 2.6 | Does a write-bearing agent action skip confirmation? | a `GenAiFunction` with DML and `isConfirmationRequired` false | `agentforce-package` | `agentforce-confirmation-required-sensitive-actions` | agentforce |

### Tier 3 — Injection

| # | Reviewer question | The probe | Answered by | Baseline | Element |
|---|---|---|---|---|---|
| 3.1 | SOQL/SOSL injection? | unvalidated input into `Database.query`/`Search.query` | `injection-xss` | `fail-soql-injection`, `violation-soql-injection` | package / external |
| 3.2 | OS command / SSRF on the server? | caller input into a shell/HTTP-client call | run-scans F7 (Semgrep), `mcp-threat-model` (SSRF) | `scan-external-sast`, `mcpthreat-ssrf-mitigation` | external-endpoint |
| 3.3 | XSS in the packaged UI? | unescaped merge/`escape=false`/`unescapedHtml`/`lwc:dom=manual` | `injection-xss`, `web-client` | `fail-xss` | package UI |
| 3.4 | Prompt injection via untrusted record text? | a `genAiPromptTemplate` merging a tenant-writable field into the instruction region without enclosure | `agentforce-package` | `agentforce-prompt-input-validation`, `agentforce-prompt-enclosure-sandwiching` | agentforce |

### Tier 4 — Data exposure / egress

| # | Reviewer question | The probe | Answered by | Baseline | Element |
|---|---|---|---|---|---|
| 4.1 | Does a Salesforce session id ever leave? | grep for session-id acceptance/forwarding/storage; weblink `document.cookie` | `sessionid-egress` | `fail-sessionid-egress` | any SF-adjacent |
| 4.2 | Is there a third-party LLM in the package? | a callout to an LLM-provider host in an action path | `agentforce-package` | `agentforce-no-third-party-llm-in-package` | agentforce |
| 4.3 | Is there an undisclosed egress (AI/inference/analytics)? | watch outbound connections vs the data-flow diagram | `data-export`, `email-outbound`, the architecture diagram | `artifact-architecture-diagram` | external-endpoint |
| 4.4 | Is a live secret recoverable (tree or history)? | gitleaks tree + full history; deleted-blob recovery | run-scans F6 | `fail-hardcoded-secrets` | always |

### Tier 5 — Package hygiene (the Top-20 metadata corpus)

| # | Reviewer question | The probe | Answered by | Baseline | Element |
|---|---|---|---|---|---|
| 5.1 | CRUD/FLS enforced on Apex data access? | Code Analyzer Graph Engine dataflow | run-scans F1 (SFGE) | `fail-crud-fls`, `scan-sfge-crud-fls-dataflow` | managed-package |
| 5.2 | Locker disabled (component apiVersion < 40)? | read `*.js-meta.xml`/`*.cmp-meta.xml` apiVersion | `package-metadata` | `violation-lockerservice-disabled` | package UI |
| 5.3 | JS running in the Salesforce origin? | `onClickJavaScript`/`REQUIRESCRIPT`/`javascript:` weblinks | `package-metadata` | `violation-js-in-salesforce-domain` | managed-package |
| 5.4 | CSRF on page/component instantiation? | DML on load without `confirmationTokenRequired` | `package-metadata`, `web-client` | `violation-csrf-page-instantiation` | package UI |
| 5.5 | Open redirect from a request param? | `PageReference` from `getParameters` + `setRedirect(true)` | `package-metadata`, `injection-xss` | `violation-open-redirects` | managed-package |
| 5.6 | Exposed message channel / hotlinked off-platform JS-CSS? | `<isExposed>true</isExposed>`; `<script src=http>` | `package-metadata` | `fail-js-not-static-resources`, `fail-lightning-component-hygiene` | package UI |

### Tier 6 — Infra / supply chain

| # | Reviewer question | The probe | Answered by | Baseline | Element |
|---|---|---|---|---|---|
| 6.1 | Known-CVE dependencies (package + server)? | RetireJS (package) + OSV-Scanner (server lockfiles) | run-scans F5, F8 | `scan-dependency-vulnerabilities`, `scan-external-sca` | always / external |
| 6.2 | IaC misconfig (open SG, public bucket, image secret)? | Checkov/Trivy over Dockerfile + IaC | run-scans F8 | `scan-iac-misconfig` | external-endpoint |
| 6.3 | TLS posture (HTTPS-only, secure versions, HSTS)? | SSL Labs or local testssl/sslyze | run-scans F4 | `endpoint-ssl-labs-a-grade` | external-endpoint |

## Reachability note

A challenge whose element is not in the scope manifest is **N/A** — never report a
TLS challenge for a package-only listing. The challenge applies only when its
element is present; `reviewer-simulation` filters the checklist by the manifest's
elements before synthesizing.

## Honesty floor

`reviewer-simulation` reports what the toolkit's STATIC analysis + mechanical
scans found, framed as reviewer intent. It is **not** the reviewer's pen test:
Salesforce reproduces these live, on the installed package and the running
endpoint, with org-specific context and utterance combinations a static pass
cannot enumerate. A challenge marked ADDRESSED means "no open finding within the
audited dimensions," never "the reviewer will find nothing." NOT-STATICALLY-
EXAMINED challenges (runtime CSP, live error hygiene, the agent two-account probe,
logic bugs reachable only at runtime) are named explicitly, never implied clean.

# Skill catalog

Every skill the plugin ships, what it does, and how autonomous it is. The deep-audit chain
at the bottom is the optional, `sf`-CLI-gated power-up.

| Skill | What it does | Automation level |
|---|---|---|
| `/sf-security-review-toolkit:security-review-journey` | The autonomous driver: a seconds-long read-only preflight detects your architecture and senses `sf` auth, offers the opt-in power-ups (Dev Hub auto-resolve, deployed-package deep audit), then drives the whole journey end to end — in full-auto, two up-front screens, then, pausing only for a genuinely audit-blocking gap, straight to the submission package; also does state detection / resume / routing / status | Autonomous (gated) |
| `/sf-security-review-toolkit:scope-submission` | Detects your architecture elements (managed package, Agentforce agent, external endpoint, MCP server, Canvas, LWC/Aura, mobile), deterministically enumerates every deployable app root under the conventional monorepo containers (`apps/*` · `services/*` · `packages/*`, plus the repo root — an app surface there can't be silently missed; an ambiguous root routes through a clarify gate), compiles which baseline requirements apply, gates on partner-program prerequisites | Automated |
| `/sf-security-review-toolkit:audit-codebase` | Multi-agent security audit across 19 threat dimensions, kept honest by a dual-provenance ledger: every model-raised finding is adversarially verified against the code, while deterministic scanner/metadata findings enter engine-owned — the model can never refute or downgrade them; incremental via the findings ledger | Automated (you read the report) |
| `/sf-security-review-toolkit:generate-artifacts` | Drafts the submission artifacts from your code: AuthN/AuthZ flow (with the credential-storage statement), architecture/data-flow diagram, data-sensitivity classification, exposed-tools inventory + OpenAPI, access-control documentation, the false-positive dossier skeleton, and the written-policy / org-config pack (incident response, retention + deletion-on-uninstall, DR/backup, vuln-remediation SLA) as owner-completed stubs | Automated draft, human review |
| `/sf-security-review-toolkit:run-scans` | Eight scan families — Code Analyzer v5, Checkmarx-portal check, the consented throwaway-mirror ZAP DAST it runs itself + the live-prod DAST plan, TLS grade, dependency audit, secret scan, external SAST, and external SCA + IaC — powered by **up to 17 consent-installed OSS scanners** plus five zero-install Salesforce-metadata scanners (see ["It runs the scans for you"](scans.md)); folds every result into a dispositioned false-positive dossier | Mixed: agent runs what it can, guides what it can't |
| `/sf-security-review-toolkit:reviewer-simulation` | Reframes everything the audit + scans found as **what Salesforce Product Security will see** — the challenge checklist ranked by the reviewer's own attack priority, headed by the first things they will hit | Automated synthesis |
| `/sf-security-review-toolkit:prepare-test-environment` | Runbooks + generated evidence for the reviewer-facing test environment: Trialforce/DE review org; the configured agent (Topics + reasoning engine) with an utterance list validated headlessly via `sf agent test` — machine-readable pass/fail evidence, and a routing failure is never credited as a pass; two test users with the authorization-boundary proof; the isolated external test tenant; and the end-to-end self-test that catches an un-testable environment before the reviewer does — the most preventable bounce class | Guided, with generated evidence |
| `/sf-security-review-toolkit:compile-submission` | Pre-fills the questionnaire (every N/A needs a reason — the lint blocks the compile), fills the required-artifacts checklist row by row (HAVE only with verified evidence), computes the deterministic Submission Completeness Index (the gated go/no-go), and emits the readiness verdict + a sequenced path-to-green + the downloadable submission package (wizard-slot INDEX, PENDING-OWNER-RUN handoff for what only you can run) | Automated compile, human submits |
| `/sf-security-review-toolkit:stay-listed` | The post-approval obligations on a schedule: re-review trigger watch, the per-release security-relevance gate (listing association + readiness inheritance), the 24-hour incident-reporting duty, platform security mandates, evidence-freshness re-runs, and test-environment liveness | Guided recurring |

## Deep-audit power-up (optional, `sf`-CLI-gated)

When the Salesforce CLI is authed to your Dev Hub and you opt in, the toolkit
stands your managed package up in a throwaway org and audits the **deployed**
artifact — exactly what the reviewer does when they install your package. The
chain runs six steps: headless CLI auth, a clean-baseline teardown before
install, a conditional build fallback (common case: skipped — you already have
a release), install + verification, the deployed-package audit, then
zero-residue teardown. Four of the lifecycle skills below were authored by this
toolkit's author and contributed to the sibling
[`sf-mcp-partner-toolkit`](https://github.com/mvogelgesang/sf-mcp-partner-toolkit),
then adapted here as native, orchestrated steps (see [`CREDITS.md`](CREDITS.md));
`audit-deployed-package` is native to this toolkit.

| Skill | What it does | Automation level |
|---|---|---|
| `/sf-security-review-toolkit:bootstrap-cli-auth` | Builds + authenticates the `sf` CLI environment headlessly (forwarded-port web flow / stored auth URLs), including the pinned agent-plugin the Agentforce/MCP captures need | Guided |
| `/sf-security-review-toolkit:build-managed-package` | Promotes a released 2GP — only when no released version exists yet. This is the deep audit's consent-gated write to your source: it generates packaging scaffolding (a post-install handler, a CSP Trusted Site) into `force-app/` and edits `sfdx-project.json`; it never touches application logic | Guided |
| `/sf-security-review-toolkit:install-and-verify-package` | Installs the released package into a throwaway org with the pre-install contamination check, the install-time permission-chain (UEC grant-drop) verification, Connect-API credential configuration, and an Apex smoke test through the installed Named Credential | Automated (gated) |
| `/sf-security-review-toolkit:audit-deployed-package` | The security pass over the **installed** package: subscriber-effective grants (least-privilege / over-grant), the post-install handler's real granted scope, Graph-Engine CRUD/FLS on the installed source, Named/External-Credential callout resolution, install+uninstall integrity — plus the Agentforce runtime lens: a scripted agent conversation traced to the actions it actually executed and where it egressed (secrets redacted before anything persists), and the org-effective MCP tool catalog (which tools the org really ingested and exposes as agent actions) | Automated (gated) |
| `/sf-security-review-toolkit:teardown-mcp-registration` | Provisions the clean throwaway org and tears the MCP registration down to zero residue, in the dependency order that works — run before install (clean baseline) and again after the audit | Automated (gated) |


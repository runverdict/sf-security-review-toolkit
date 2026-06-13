# Salesforce Security Review Toolkit

Claude Code skills that take an ISV partner through **AppExchange / AgentExchange
security review preparation end to end**: an autonomous multi-agent audit of your
own codebase shaped to what the review actually tests, generation of every
submission artifact that can be generated, orchestration of the required scans,
and step-by-step runbooks for the parts only a human can do — ending in an honest
readiness verdict: *what you have, what's missing, and exactly what to do before
you submit.*

> **What this toolkit is not.** It prepares a submission; it does not pass one.
> Salesforce's Product Security team runs its own penetration test regardless of
> what you submit. Nothing here represents a scan, test, or certification as
> complete unless there is an evidence file behind it.

## Why it exists

The security review is the hardest gate in the partner journey, and most
first-time failures are preventable: missing CRUD/FLS enforcement (object-level
Create/Read/Update/Delete permissions and Field-Level Security — the access
checks Apex skips unless you write them), un-testable
review environments, incomplete artifacts, DAST reports that miss the identity
endpoints, questionnaires with unexplained N/A answers. This toolkit encodes a
methodology that was battle-tested on a real partner submission preparation —
multi-pass multi-agent audits with adversarial verification of every finding —
and packages the artifact formats, scan harnesses, and runbooks that came out
of it.

## The journey

Say something like *"run the security review"* (or invoke the orchestrator
directly) and it takes over:

```
/sf-security-review-toolkit:security-review-journey   ← say "run the security review"
        │   PREFLIGHT: a cheap scan detects your architecture (+ reads the Dev Hub if `sf`
        │   is authed) and reports — ✓ what it found · ⚠ what it actually needs · ✦ optional
        │   power-ups — then runs the rest AUTONOMOUSLY, pausing only at the safety gates.
        │
        ├─ 0. /sf-security-review-toolkit:scope-submission           what are you listing? which requirements apply?
        ├─ 1. /sf-security-review-toolkit:audit-codebase             autonomous find → verify → synthesize audit
        ├─ 2. /sf-security-review-toolkit:generate-artifacts         authn/authz flow, data flow, tools list, …
        ├─ 3. /sf-security-review-toolkit:run-scans                  Code Analyzer v5 · DAST (ZAP) · SSL Labs · deps
        ├─ 4. /sf-security-review-toolkit:prepare-test-environment   Trialforce org, agent + Topics, test users
        ├─ 5. /sf-security-review-toolkit:compile-submission         questionnaire, checklist, wizard-slot package
        └─ ∞. /sf-security-review-toolkit:stay-listed                periodic re-review, release gates, incident duties

   optional, `sf`-authed power-up — audit the package AS THE REVIEWER WILL (deployed in an org):
        bootstrap-cli-auth → install-and-verify-package → audit-deployed-package → teardown-mcp-registration
```

The orchestrator is an autonomous driver, not just a router: it detects how far
your repo has already progressed (state lives in `.security-review/`, artifacts
in `docs/security-review/`), resumes from there, and runs to a complete,
downloadable submission package — stopping only when it genuinely needs you (an
audit-blocking input, or consent before it touches anything live). You can still
invoke any single skill directly. It is **read-only on your source**, and its
strongest verdict is ever only *"no known blockers in what we can verify —
Salesforce pen-tests regardless,"* never *"you will pass."*

## Install

```
/plugin marketplace add redbeardenduro/sf-security-review-toolkit
/plugin install sf-security-review-toolkit
```

## Skill catalog

| Skill | What it does | Automation level |
|---|---|---|
| `/sf-security-review-toolkit:security-review-journey` | The autonomous driver: a preflight scan (+ Dev Hub auto-resolution when `sf` is authed), then runs the whole journey end to end, pausing only at the safety gates; also does state detection / routing / status | Autonomous (gated) |
| `/sf-security-review-toolkit:scope-submission` | Detects your architecture elements (managed package, external endpoint, MCP server, Canvas, LWC), compiles which requirements apply, gates on partner-program prerequisites | Automated |
| `/sf-security-review-toolkit:audit-codebase` | Multi-agent security audit of your codebase across 13 threat dimensions; every finding adversarially verified; incremental via a findings ledger | Automated (you read the report) |
| `/sf-security-review-toolkit:generate-artifacts` | Drafts the submission artifacts from your code: AuthN/AuthZ flow, architecture/data-flow diagram, data-sensitivity classification, exposed-tools inventory + OpenAPI, access-control documentation, credential-storage statement | Automated draft, human review |
| `/sf-security-review-toolkit:run-scans` | Runs Code Analyzer v5 and dependency scans; verifies TLS grade; generates an authenticated DAST plan (including identity endpoints) and folds results into a false-positive dossier | Mixed: agent runs what it can, guides what it can't |
| `/sf-security-review-toolkit:prepare-test-environment` | Runbooks for the reviewer-facing test org: Trialforce/DE org, agent + Topics + reasoning engine + utterances, two test users, the per-user authorization-boundary proof | Guided manual |
| `/sf-security-review-toolkit:compile-submission` | Pre-fills the questionnaire (with an "every N/A needs a reason" lint), fills the required-artifacts checklist row by row, emits the readiness tracker and verdict | Automated compile, human submits |
| `/sf-security-review-toolkit:stay-listed` | The post-approval obligations on a schedule: periodic re-review, the per-release gate (listing association + readiness inheritance), incident-reporting duties, platform security mandates | Guided recurring |

### Deep-audit power-up (optional, `sf`-CLI-gated)

When the Salesforce CLI is authed to your Dev Hub and you opt in, the toolkit can
stand your managed package up in a throwaway org and audit the **deployed**
artifact — exactly what the reviewer does when they install your package. These
lifecycle skills were authored by this toolkit's author and contributed to the
sibling [`sf-mcp-partner-toolkit`](https://github.com/mvogelgesang/sf-mcp-partner-toolkit);
they are adapted here as native, orchestrated steps (see [`CREDITS.md`](CREDITS.md)).

| Skill | What it does | Automation level |
|---|---|---|
| `/sf-security-review-toolkit:bootstrap-cli-auth` | Builds + authenticates the `sf` CLI environment headlessly (forwarded-port web flow / stored auth URLs) | Guided |
| `/sf-security-review-toolkit:build-managed-package` | Promotes a released 2GP — only when no released version exists yet (generates packaging scaffolding; never touches application logic) | Guided |
| `/sf-security-review-toolkit:install-and-verify-package` | Installs the released package into a throwaway org with the pre-install contamination check, the install-time permission-chain (UEC grant-drop) verification, and an Apex smoke test | Automated (gated) |
| `/sf-security-review-toolkit:audit-deployed-package` | The security pass over the **installed** package: least-privilege/over-grant grants as a subscriber gets them, Graph-Engine CRUD/FLS, callout resolution, install+uninstall integrity | Automated (gated) |
| `/sf-security-review-toolkit:teardown-mcp-registration` | Provisions the clean throwaway org and tears it down to zero residue, in the dependency order that works | Automated (gated) |

## Currency model

As of this toolkit's June 2026 source sweep, Salesforce had changed this process
three times in the preceding eighteen months: the Chimera DAST scanner retirement
(announced 2025-05), the Code Analyzer v5 mandate, and the AgentExchange launch —
each sourced in [`baseline/SOURCES.md`](baseline/SOURCES.md).
All requirement facts therefore live in
[`${CLAUDE_PLUGIN_ROOT}/baseline/requirements-baseline.yaml`](baseline/requirements-baseline.yaml)
as data — each entry carries its sources, a verification status, and a
last-verified date. Skills warn when the entries they rely on are stale, and
entries with conflicting sources are surfaced as "confirm with your Partner
Account Manager" rather than silently chosen. PRs that update the baseline with
primary-source citations are the most valuable contribution you can make.

## Status

**0.2.0 — autonomous.** Component status, plainly:

- **Field-tested:** the audit methodology (CONVENTIONS, audit-methodology, the
  find → adversarial-verify → synthesize engine) and the harness assets — these
  were extracted from real multi-pass audits of a real partner codebase before
  its own submission prep.
- **Validated end to end (fresh-context run, 2026-06-13):** the toolkit was run
  cold against a real production codebase (FastAPI + Postgres RLS + an OAuth 2.1
  authorization server + an MCP server + two 2GP packages). From an empty ledger
  the audit re-discovered every known-open finding, refuted false candidates with
  code evidence, and the generated artifact pack matched a hand-built reference —
  surfacing real findings the hand-built audit had under-rated. See the
  [`CHANGELOG`](CHANGELOG.md).
- **New in 0.2.0:** the autonomous, preflight-gated orchestrator; Dev Hub
  auto-resolution in `scope-submission`; the wizard-slot submission-package
  assembler; the eight-category report spine and the agent/ForcedLeak detectors;
  and the optional `sf`-CLI-gated deployed-org deep audit (the five lifecycle
  skills above). 13 skills, 13 dimension files.
- **Substantially verified, residual gaps flagged:** after the 2026-06-12
  primary-source reconciliation and the same-day partner-gated evidence
  delta, 115 of 146 baseline entries are `verified_primary` (confirmed
  against official Salesforce docs or partner-gated primary sources); 30
  remain `web_research_unverified` pending primary-source confirmation, and
  1 is `conflicting` (`endpoint-ssl-labs-a-grade`) — that one must be
  resolved through your Partner Account Manager or partner Slack, not trusted
  from this repo. Verification status is per-entry in the YAML; check the
  entries you rely on, not the aggregate.

Use the readiness verdict as preparation guidance, not as a pass prediction.

## License

Apache-2.0. See [LICENSE](LICENSE).

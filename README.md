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

```
/sf-security-review-toolkit:security-review-journey   ← start here: detects state, routes you
        │
        ├─ 0. /sf-security-review-toolkit:scope-submission           what are you listing? which requirements apply?
        ├─ 1. /sf-security-review-toolkit:audit-codebase             autonomous find → verify → synthesize audit
        ├─ 2. /sf-security-review-toolkit:generate-artifacts         authn/authz flow, data flow, tools list, …
        ├─ 3. /sf-security-review-toolkit:run-scans                  Code Analyzer v5 · DAST (ZAP) · SSL Labs · deps
        ├─ 4. /sf-security-review-toolkit:prepare-test-environment   Trialforce org, agent + Topics, test users
        ├─ 5. /sf-security-review-toolkit:compile-submission         questionnaire, checklist, readiness verdict
        └─ ∞. /sf-security-review-toolkit:stay-listed                periodic re-review, release gates, incident duties
```

Each skill is self-contained — you can start anywhere and the orchestrator will
detect what already exists in your repo (state lives in `.security-review/`,
artifacts in `docs/security-review/`).

## Install

```
/plugin marketplace add redbeardenduro/sf-security-review-toolkit
/plugin install sf-security-review-toolkit
```

## Skill catalog

| Skill | What it does | Automation level |
|---|---|---|
| `/sf-security-review-toolkit:security-review-journey` | State detection + routing + progress report | — |
| `/sf-security-review-toolkit:scope-submission` | Detects your architecture elements (managed package, external endpoint, MCP server, Canvas, LWC), compiles which requirements apply, gates on partner-program prerequisites | Automated |
| `/sf-security-review-toolkit:audit-codebase` | Multi-agent security audit of your codebase across 13 threat dimensions; every finding adversarially verified; incremental via a findings ledger | Automated (you read the report) |
| `/sf-security-review-toolkit:generate-artifacts` | Drafts the submission artifacts from your code: AuthN/AuthZ flow, architecture/data-flow diagram, data-sensitivity classification, exposed-tools inventory + OpenAPI, access-control documentation, credential-storage statement | Automated draft, human review |
| `/sf-security-review-toolkit:run-scans` | Runs Code Analyzer v5 and dependency scans; verifies TLS grade; generates an authenticated DAST plan (including identity endpoints) and folds results into a false-positive dossier | Mixed: agent runs what it can, guides what it can't |
| `/sf-security-review-toolkit:prepare-test-environment` | Runbooks for the reviewer-facing test org: Trialforce/DE org, agent + Topics + reasoning engine + utterances, two test users, the per-user authorization-boundary proof | Guided manual |
| `/sf-security-review-toolkit:compile-submission` | Pre-fills the questionnaire (with an "every N/A needs a reason" lint), fills the required-artifacts checklist row by row, emits the readiness tracker and verdict | Automated compile, human submits |
| `/sf-security-review-toolkit:stay-listed` | The post-approval obligations on a schedule: periodic re-review, the per-release gate (listing association + readiness inheritance), incident-reporting duties, platform security mandates | Guided recurring |

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

**0.1.0 — pre-release.** Component status, plainly:

- **Field-tested:** the audit methodology (CONVENTIONS, audit-methodology, the
  find → adversarial-verify → synthesize engine) and the harness assets — these
  were extracted from real multi-pass audits of a real partner codebase before
  its own submission prep.
- **Authored against that methodology, not yet validated end to end:** the
  eight skills (`security-review-journey` plus the seven phase skills) and the
  13 dimension files. Validation loop in progress: fresh-context runs against
  a real partner codebase, re-audited until convergent.
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

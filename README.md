# Salesforce Security Review Toolkit

[![acceptance](https://github.com/runverdict/sf-security-review-toolkit/actions/workflows/test.yml/badge.svg)](https://github.com/runverdict/sf-security-review-toolkit/actions/workflows/test.yml)

Claude Code skills that take an ISV partner through **AppExchange / AgentExchange
security review preparation end to end**: an autonomous multi-agent audit of your
own codebase shaped to what the review actually tests, generation of every
submission artifact that can be generated, orchestration of the required scans,
and step-by-step runbooks for the parts only a human can do — ending in an honest
readiness verdict: *what you have, what's missing, and exactly what to do before
you submit.*

> **⚠️ Beta — read this first.** This toolkit is in **honest beta.** It **reliably finds the unambiguous
> blockers** — public-reach authorization holes, missing CRUD/FLS, injection,
> secret leakage, package-hygiene failures — and **builds the reviewer evidence
> pack** for your submission. But the **contestable-severity band** (the calls
> where a reasonable senior reviewer could defensibly land either way) is an
> **incomplete, unstable sample**: it varies run-to-run and needs **repeated runs
> plus human adjudication.** The experiment that proved this is written up in
> [`docs/ceiling-test.md`](docs/ceiling-test.md); the engine that makes the
> run-to-run variance visible is
> [`docs/recurrence-confidence.md`](docs/recurrence-confidence.md). So it does
> **not** guarantee it "catches everything" or "catches the same things every
> time," and **a passing run does not replace the Salesforce security review** —
> Salesforce Product Security runs its own penetration test regardless of what you
> submit.

## Why it exists

The security review is the hardest gate in the partner journey, and most
first-time failures are preventable: missing CRUD/FLS enforcement (object-level
Create/Read/Update/Delete permissions and Field-Level Security — the access
checks Apex skips unless you write them), un-testable
review environments, incomplete artifacts, DAST reports that miss the identity
endpoints, questionnaires with unexplained N/A answers. This toolkit encodes a
methodology developed preparing the author's own AppExchange submission —
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
        │   (Numbers are each skill's phase identity; the list is the journey's DRIVE ORDER —
        │   the static scans run BEFORE the audit, so the audit ingests real scanner
        │   findings on its first pass instead of leaving those families pending.)
        │
        ├─ 0. /sf-security-review-toolkit:scope-submission           what are you listing? which requirements apply?
        ├─ 3. /sf-security-review-toolkit:run-scans (static substrate) Code Analyzer · deps · secrets · ext SAST/SCA/IaC — host-independent, before the audit
        ├─ 1. /sf-security-review-toolkit:audit-codebase             autonomous find → verify → synthesize audit, seeded by the substrate's evidence
        ├─ 2. /sf-security-review-toolkit:generate-artifacts         authn/authz flow, data flow, tools list, …
        ├─ 3. /sf-security-review-toolkit:run-scans (live/conditional tail) DAST · TLS · portal prediction · whatever stayed pending
        ├─ 4. /sf-security-review-toolkit:reviewer-simulation        what Salesforce Product Security will see, ranked by attack priority
        ├─ 5. /sf-security-review-toolkit:prepare-test-environment   Trialforce org, agent + Topics, test users
        ├─ 6. /sf-security-review-toolkit:compile-submission         questionnaire, checklist, SCI verdict, wizard-slot package
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

## It runs the scans for you — then wipes the slate clean

Most of what the security review asks for is *scan evidence*: SAST, software-composition (SCA), IaC, secret, DAST, and TLS reports. Producing them by hand means installing a dozen tools, learning each one, running them, and collating the output. The toolkit does it for you, behind **one up-front consent gate** (it touches the network and the host, so it always asks first):

- **Installs up to 14 OSS scanners into a tmp directory** — Semgrep · Bandit · njsscan · gosec (SAST), OSV-Scanner · Trivy · Checkov (SCA + IaC), gitleaks · detect-secrets (secrets), RetireJS (dependencies), Nuclei · Schemathesis (DAST), testssl.sh · sslyze (TLS) — only the ones you don't already have. Raw binary downloads are **sha256-pinned and verified before they ever execute**; pip / npm / git installs lean on their own integrity layers.
- **Stands up a throwaway mirror of your backend and runs a digest-pinned OWASP ZAP DAST against it** — loopback-only, synthetic secrets, copy-in (never a bind-mount). The active scan only ever hits a disposable copy the toolkit built; never your real prod, Salesforce infra, or any third party.
- **Writes real evidence files** into `.security-review/evidence/`, folds them into the readiness verdict and the Submission Completeness Index, and dispositions findings into the false-positive dossier.
- **Then wipes the slate clean** — removes the installed binaries and tears down the mirror, **keeping only the evidence.** Asymmetric by design: tools out, evidence stays.

**Code Analyzer is run *for* you** — agent-side when the `sf` CLI is already present, or cold-installed on consent (the pinned `@salesforce/cli` + the `code-analyzer` plugin + a JDK, sha256-verified before extract, removed at cleanup). It's the exact static engine Salesforce runs for the #1 review-failure class — Apex CRUD/FLS — so the toolkit produces that band **deterministically** instead of guessing it.

What genuinely stays yours to run: the **Checkmarx portal scan** (a web-only Partner Security Portal upload — no CLI or API exists) and the **live-prod authenticated DAST** (the real scan against your production endpoint with real credentials — the toolkit automates a throwaway-*mirror* ZAP against a disposable copy, but the production submission scan is yours). For those it hands you the exact steps and *predicts* the findings, so your real runs come back with no surprises.

## Install

This is a **Claude Code plugin** — it runs inside [Claude Code](https://claude.com/claude-code), not as a standalone CLI. You need:

1. **Claude Code** (CLI or IDE extension) — where the toolkit runs.
2. **Node.js 18+** — the deterministic engines under `harness/` use only Node built-ins (no `npm install`, no dependencies, no network).
3. *Optional:* the **Salesforce CLI** authed to your Dev Hub — only for the `sf`-gated deployed-package deep audit.

Inside Claude Code, add and install the plugin (these are Claude Code slash commands, not terminal commands):

```
/plugin marketplace add runverdict/sf-security-review-toolkit
/plugin install sf-security-review-toolkit
```

Then just say **"run the security review."** You never run the `harness/*.mjs` files yourself — they're internal engines the skills invoke. (To run the standing test suite: `for t in acceptance/test-*.mjs; do node "$t" || exit 1; done`.)

## Running it hands-off (permissions)

The journey is **read-only on your source** — finders and verifiers only read
code; the only writes are the toolkit's own state (`.security-review/`) and
generated artifacts (`docs/security-review/`). Two ways to cut the per-step
permission prompts for an autonomous run:

- **Recommended read-only allowlist.** Drop this into the target repo's
  `.claude/settings.json`. It pre-approves only non-destructive sensing —
  never writes, never anything that touches a live system:

  ```json
  {
    "permissions": {
      "allow": [
        "Bash(git status:*)", "Bash(git log:*)", "Bash(git rev-parse:*)", "Bash(git diff:*)", "Bash(git ls-files:*)",
        "Bash(ls:*)", "Bash(cat:*)", "Bash(grep:*)", "Bash(head:*)", "Bash(tail:*)", "Bash(wc:*)", "Bash(sort:*)", "Bash(awk:*)", "Bash(date:*)",
        "Bash(sf org list:*)", "Bash(sf org display:*)", "Bash(sf data query:*)", "Bash(sf project retrieve:*)",
        "Bash(sf sobject:*)", "Bash(sf package version list:*)", "Bash(sf package version report:*)", "Bash(sf code-analyzer run:*)"
      ]
    }
  }
  ```

- **Auto-accept for the multi-agent audit.** The audit fans out many subagents
  whose read commands vary, and some (`find … -exec grep`, scratch-org steps)
  can't be covered by a prefix allowlist. Workflow runs go smoothest with
  auto-accept **on for the duration of the run** — then turn it back off, and
  don't use it casually on a repo you don't trust.

Either way, the up-front gate's live/network steps — installing the missing scanners
to a tmp dir (a network fetch), standing up a **throwaway** backend + active-scanning
it, the optional `sf`-CLI deployed-org deep audit, and any live-endpoint probe —
**always require an explicit yes** — those touch live systems or mutate the host, and
no allowlist or auto-accept silences them.

### Optional enforcement hook (disclosed in full)

The plugin ships a `PreToolUse` hook (`hooks/`) that loads when the plugin is
enabled. **It is a no-op by default and never touches your normal work:** for
every `Write`/`Edit` it exits immediately unless the file being written is the
toolkit's own `docs/security-review/authn-authz-flow.md` **and** you have armed it
by creating `.security-review/hook-armed` in the target repo. Armed, it blocks
writing that one doc while an open authentication/authorization critical/high
finding stands (the same withhold the journey already enforces — this is the
runtime-independent backstop). It reads only the ledger; it never modifies your
source, never phones home, and is plain, readable source in `hooks/`.

- **Arm it:** `touch <repo>/.security-review/hook-armed` (or say yes when the
  journey offers it). **Disarm:** delete that file. That's the whole control.
- It's defense-in-depth the human opts into, not a guarantee — you own whether the
  plugin is enabled and whether the flag is set.

## Skill catalog

| Skill | What it does | Automation level |
|---|---|---|
| `/sf-security-review-toolkit:security-review-journey` | The autonomous driver: a preflight scan (+ Dev Hub auto-resolution when `sf` is authed), then runs the whole journey end to end, pausing only at the safety gates; also does state detection / routing / status | Autonomous (gated) |
| `/sf-security-review-toolkit:scope-submission` | Detects your architecture elements (managed package, Agentforce agent, external endpoint, MCP server, Canvas, LWC/Aura, mobile), compiles which requirements apply, gates on partner-program prerequisites | Automated |
| `/sf-security-review-toolkit:audit-codebase` | Multi-agent security audit of your codebase across 19 threat dimensions; every finding adversarially verified; incremental via a findings ledger | Automated (you read the report) |
| `/sf-security-review-toolkit:generate-artifacts` | Drafts the submission artifacts from your code: AuthN/AuthZ flow, architecture/data-flow diagram, data-sensitivity classification, exposed-tools inventory + OpenAPI, access-control documentation, credential-storage statement | Automated draft, human review |
| `/sf-security-review-toolkit:run-scans` | Eight scan families: Code Analyzer v5, Checkmarx-portal check, authenticated DAST plan, TLS grade, dependency audit, secret scan, and **up to 14 consent-installed OSS scanners** (SAST/SCA/IaC/secret/DAST/TLS — see ["It runs the scans for you"](#it-runs-the-scans-for-you--then-wipes-the-slate-clean)); folds results into a false-positive dossier | Mixed: agent runs what it can, guides what it can't |
| `/sf-security-review-toolkit:reviewer-simulation` | Reframes everything the audit + scans found as **what Salesforce Product Security will see** — the challenge checklist ranked by the reviewer's own attack priority, headed by the first things they will hit | Automated synthesis |
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
Account Manager" rather than silently chosen.

As of the latest source sweep, **122 of 166 baseline entries are `verified_primary`** (confirmed against official Salesforce docs or partner-gated primary sources), **43 remain `web_research_unverified`** pending primary-source confirmation, and 1 is `conflicting` (resolve it through your Partner Account Manager, not this repo). Verification status is per-entry in the YAML — check the entries you rely on, not the aggregate.

PRs that update the baseline with
primary-source citations are the most valuable contribution you can make.

## What the output looks like

The toolkit's final artifact is a readiness verdict — what you have, what's missing, and exactly what to do before you submit:

```
SUBMISSION READINESS — BLOCKED
Submission Completeness Index: 38%  (gated — 2 open blockers)

BLOCKERS (must clear before submit)
  ✗ apex-exposed-surface   AccountController.getDetails — missing CRUD/FLS (HIGH)
                           → enforce WITH USER_MODE on the SOQL read
  ✗ permission-set         viewAllRecords on a sensitive custom object (HIGH)
                           → drop viewAllRecords; grant per-record via sharing

ARTIFACTS   14/17 · AuthN/AuthZ flow WITHHELD (open authz blocker)
SCANS       Code Analyzer ✓ · DAST pending · TLS A · secrets ✓
FINDING STABILITY (3-run consensus)
  high    Controller-FLS         recurred 3/3
  review  Contact-PII FLS        2/3 — needs human adjudication
PATH TO GREEN → 2 blockers → 1 major → 3 minor   (path-to-green.md)
```

*Illustrative of the format. A passing run never means "you will pass" — Salesforce pen-tests regardless.*

## Why you can trust the output

The model does the finding; deterministic code owns the guardrails — a weaker model produces weaker findings, it does not collapse the gates.

- **Deterministic engines in `harness/` enforce the honesty-critical properties, not model goodwill.** The AuthN/AuthZ artifact is withheld by an enforced gate while any critical/high finding is open; the Submission Completeness Index has a hard blocker floor, is labelled *"not a pass prediction"*, and credits nothing as complete without a reviewer-reproducible evidence file behind it; applicability, finding de-duplication, ledger merge, staleness, and cross-run recurrence are all deterministic and guarded by standing tests. If the model degrades you get weaker findings, not a broken audit — the gates still hold. **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** maps each of these properties to its enforcing engine, the standing test that guards it, and the code excerpt — verifiable in five minutes without cloning.
- **Every refutation requires code evidence.** The adversarial verifier reads the actual code — never the finder's reasoning — and must return the exact `file:line` + snippet that decides it. The false-positive dossier reuses that verbatim; any entry missing real evidence is marked `DRAFT`, not submission-ready. The toolkit never accepts residual risk on your behalf — you sign every disposition.
- **It is honest about its ceiling.** It tells you what it cannot certify — see [`docs/ceiling-test.md`](docs/ceiling-test.md) and [`docs/recurrence-confidence.md`](docs/recurrence-confidence.md) — instead of pretending to be complete; the misses (what a real review catches that the audit didn't) are logged in [`methodology/known-escapes.md`](methodology/known-escapes.md).

## How it was validated

The methodology and harness were extracted from real multi-pass audits of a production multi-tenant SaaS codebase during an actual AppExchange prep. Run cold from an empty ledger, the audit re-discovered every known-open finding, refuted false candidates with code evidence, and the generated artifact pack matched a hand-built reference. The acceptance suite additionally runs the toolkit cold against synthetic fixtures (a catastrophe-recall fixture and a mostly-compliant middle-band judgment fixture) on every change. **Honest ceiling:** this is the author's own code and self-authored fixtures — only a third-party package or a real Salesforce review tests generalization.

## Maturity & what's in the box

**14 skills · 19 audit dimensions · 8 scan families · a deterministic Submission Completeness Index + a sequenced path-to-green · a core of deterministic engines in `harness/` guarded by a standing test suite (300+ checks)** that fails the build if a refactor breaks an enforced gate or its determinism.

Honest beta (see the top of this README). See [`CHANGELOG.md`](CHANGELOG.md) for the current version and release notes. Contributions that update the baseline with primary-source citations, or that close a recall gap, are the most valuable PRs you can make.

## License

Apache-2.0. See [LICENSE](LICENSE).

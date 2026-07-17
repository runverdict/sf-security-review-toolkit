# Salesforce Security Review Toolkit

[![acceptance](https://github.com/runverdict/sf-security-review-toolkit/actions/workflows/test.yml/badge.svg)](https://github.com/runverdict/sf-security-review-toolkit/actions/workflows/test.yml) [![License](https://img.shields.io/github/license/runverdict/sf-security-review-toolkit)](LICENSE) [![Dependencies: none](https://img.shields.io/badge/dependencies-none-success)](acceptance/test-ci-hygiene.mjs)

**Take an AppExchange / AgentExchange security review from audit to an honest readiness verdict — end to end.**

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
> pack** for your submission. The deterministic band (scanner- and
> metadata-derived findings) is ingested byte-deterministically — the same
> scanner output always yields byte-identical findings, locked by a standing
> test. But the
> **contestable-severity band** (the calls where a reasonable senior reviewer
> could defensibly land either way) is an **incomplete, unstable sample**: it
> varies run-to-run and needs **repeated runs plus human adjudication.** The
> experiment that proved this is written up in
> [`docs/ceiling-test.md`](docs/ceiling-test.md); the engine that makes the
> run-to-run variance visible is
> [`docs/recurrence-confidence.md`](docs/recurrence-confidence.md). So it does
> **not** guarantee it "catches everything" or "catches the same things every
> time," and **a passing run does not replace the Salesforce security review** —
> Salesforce Product Security runs its own penetration test regardless of what you
> submit.

## Table of Contents

- [Why it exists](#why-it-exists)
- [The journey](#the-journey)
- [Install](#install)
- [Usage](#usage)
- [The skills](#the-skills)
- [The scans](#the-scans)
- [Currency model](#currency-model)
- [What the output looks like](#what-the-output-looks-like)
- [Why you can trust the output](#why-you-can-trust-the-output)
- [Supply chain](#supply-chain)
- [How it was validated](#how-it-was-validated)
- [Documentation](#documentation)
- [Maturity & caveats](#maturity--caveats)
- [Contributing](#contributing)
- [License](#license)

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
        │   PREFLIGHT: a seconds-long read-only scan detects your architecture and senses
        │   existing `sf` auth, then reports — ✓ what it found · ⚠ what it actually needs ·
        │   ✦ optional power-ups (the Dev Hub auto-resolve and the deployed-package deep
        │   audit are opt-in offers, never work the preflight does unprompted). In
        │   FULL-AUTO it then asks for everything on exactly TWO screens — the run-mode +
        │   depth election, then ONE batched consent screen — and runs to the finished
        │   package, pausing only on a genuinely audit-blocking gap (source not findable,
        │   a detection ambiguity); guided mode keeps every per-gate stop.
        │   (The list below is the journey's DRIVE ORDER; the `Phase N` tag is each
        │   skill's own phase identity. The static scans run BEFORE the audit, so the
        │   audit ingests real scanner findings on its first pass instead of leaving
        │   those families pending.)
        │
        ├─ scope-submission        Phase 0 · what are you listing? which requirements apply?
        ├─ run-scans               Phase 3 · static substrate — Code Analyzer · deps · secrets · ext SAST/SCA/IaC (host-independent)
        ├─ audit-codebase          Phase 1 · autonomous find → verify → synthesize audit, seeded by the substrate
        ├─ generate-artifacts      Phase 2 · authn/authz flow, data flow, tools list, policy pack, …
        ├─ run-scans               Phase 3 · live/conditional tail — DAST · TLS · portal prediction · whatever stayed pending
        ├─ (opt-in, `sf`-authed)   the deployed-package deep audit — the six-step chain below
        ├─ reviewer-simulation     what Salesforce Product Security will see, ranked by attack priority
        └─ compile-submission      Phase 5 · questionnaire, checklist, SCI verdict, wizard-slot package

   companion skills you invoke directly (not driven by the orchestrator):
        prepare-test-environment   Phase 4 · reviewer-facing test org, agent + utterance evidence, test users
        stay-listed                post-approval · re-review cadence, release gates, incident duties

   the opt-in deep audit — audit the package AS THE REVIEWER WILL (installed in a throwaway org):
        bootstrap-cli-auth → teardown-mcp-registration (clean baseline) → build-managed-package
        (only if no released version exists) → install-and-verify-package → audit-deployed-package
        → teardown-mcp-registration (zero residue)
```

The orchestrator is an autonomous driver, not just a router: it detects how far
your repo has already progressed (state lives in `.security-review/`, artifacts
in `docs/security-review/`), resumes from there, and runs to a complete,
downloadable submission package — stopping only when it genuinely needs you: an
audit-blocking input, or a consent gate. The journey is **read-only on your
source** (the disclosed, consent-gated exceptions are the deep audit's
no-released-version packaging fallback and the opt-in Dev Hub auto-resolve's
metadata retrieve), everything beyond read-only local work rides a recorded,
fail-closed consent — the full consent model and permission setup live in
[Running it hands-off](docs/permissions.md) — and its strongest verdict is ever
only *"no known blockers in what we can verify — Salesforce pen-tests
regardless,"* never *"you will pass."*

## Install

This is a **Claude Code plugin** — it runs inside [Claude Code](https://claude.com/claude-code), not as a standalone CLI. You need:

1. **Claude Code** (CLI or IDE extension) — where the toolkit runs.
2. **Node.js 18+** — the deterministic engines under `harness/` use only Node built-ins: no `npm install`, no dependency tree. The code paths that reach beyond your machine are the consent-gated executors (see [Supply chain](#supply-chain)) plus a small set of read-only `sf` CLI reads against your already-authed org (org, package-version, and namespace lookups — the same read-only class as the allowlist in [Running it hands-off](docs/permissions.md)).
3. *Optional:* the **Salesforce CLI** authed to your Dev Hub — only for the `sf`-gated deployed-package deep audit.

Inside Claude Code, add and install the plugin (these are Claude Code slash commands, not terminal commands):

```
/plugin marketplace add runverdict/plugins
/plugin install sf-security-review-toolkit@runverdict-plugins
```

[`runverdict/plugins`](https://github.com/runverdict/plugins) is the catalog for every Verdict
toolkit — one marketplace, so installing a second one never disturbs this one.

## Usage

Then just say **"run the security review."** The orchestrator drives the whole
journey; you can also invoke any single skill directly — the full roster with
automation levels is in the [skill catalog](docs/skills.md). You never run the
`harness/*.mjs` files yourself — they're internal engines the skills invoke.
(To run the standing test suite: `for t in acceptance/test-*.mjs; do node "$t" || exit 1; done`.)

To run hands-off without per-step permission prompts — and to read the two
disclosed enforcement hooks the plugin ships — see
[Running it hands-off](docs/permissions.md). Everything beyond read-only local
work (scanner installs, the throwaway DAST mirror, the deployed-org deep audit,
any live-endpoint probe) always requires an explicit, recorded yes; no
allowlist or auto-accept silences those gates.

## The skills

Fourteen skills: the autonomous `security-review-journey` orchestrator plus the
phase skills it drives — `scope-submission`, `audit-codebase` (multi-agent audit
across 19 threat dimensions), `generate-artifacts`, `run-scans`,
`reviewer-simulation`, `compile-submission` — the directly-invoked companions
`prepare-test-environment` and `stay-listed`, and the five-skill, `sf`-CLI-gated
**deployed-package deep audit** chain that installs your package into a
throwaway org and audits it exactly as the reviewer will.

The full catalog — every skill, what it does, and how autonomous it is — is in
the [skill catalog](docs/skills.md).

## The scans

Most of what the security review asks for is *scan evidence*. Behind recorded,
fail-closed consent gates, the toolkit installs up to 17 OSS scanners
(sha256-pinned raw downloads) into a temp directory, runs five zero-install
Salesforce-metadata scanners of its own, runs Code Analyzer *for* you, stands up
a throwaway loopback-only mirror of your backend for a real ZAP DAST, writes
indexed evidence into `.security-review/evidence/` — then removes the tools and
tears down the mirror, **keeping only the evidence**. What genuinely stays yours:
the Checkmarx portal upload and the live-prod authenticated DAST, for which it
hands you exact steps and predicted findings.

The full mechanics — every scanner, the pinning rules, the mirror's provenance
fence — are in [The scans](docs/scans.md).

## Currency model

As of this toolkit's initial June 2026 source sweep (entries re-verified
continuously since — see `last_verified` per entry), Salesforce had changed this process
three times in the preceding eighteen months: the Chimera DAST scanner retirement
(announced 2025-05), the Code Analyzer v5 mandate, and the AgentExchange launch —
each sourced in [`baseline/SOURCES.md`](baseline/SOURCES.md).
All requirement facts therefore live in
[`baseline/requirements-baseline.yaml`](baseline/requirements-baseline.yaml)
as data — each entry carries its sources, a verification status, and a
last-verified date. Skills warn when the entries they rely on are stale, and
entries with conflicting sources are surfaced as "confirm with your Partner
Account Manager" rather than silently chosen.

As of the latest source sweep, **123 of 166 baseline entries are `verified_primary`** (confirmed against official Salesforce docs or partner-gated primary sources), **42 remain `web_research_unverified`** pending primary-source confirmation, and 1 is `conflicting` (resolve it through your Partner Account Manager, not this repo). Verification status is per-entry in the YAML — check the entries you rely on, not the aggregate.

PRs that update the baseline with
primary-source citations are the most valuable contribution you can make.


## What the output looks like

The toolkit's final artifact is a readiness verdict — what you have, what's missing, and exactly what to do before you submit:

```
SUBMISSION READINESS — BLOCKED
Submission Completeness Index: 34%  (not a pass prediction — 1 open blocker)

BLOCKERS (must clear before submit)
  ✗ apex-exposed-surface   AccountController.getDetails — SOQL read without CRUD/FLS (CRITICAL)
                           → enforce WITH USER_MODE on the read
FIX OR DOCUMENT BEFORE SUBMISSION
  ✗ admin-surface          viewAllRecords on a sensitive custom object (HIGH)
                           → drop viewAllRecords; grant per-record via sharing

ARTIFACTS   14/17 · AuthN/AuthZ flow WITHHELD (open authz blocker)
SCANS       Code Analyzer ✓ · DAST pending · TLS A · secrets ✓
FINDING STABILITY (3-run consensus)
  reliably recurring   Controller-FLS — all 3 runs
  contestable band: 1  — a human must adjudicate, run by run
PATH TO GREEN → 1 blocker → 1 high → 3 minor   (path-to-green.md)
```

*Illustrative of the format. A passing run never means "you will pass" — Salesforce pen-tests regardless.*

## Why you can trust the output

The model does the finding; deterministic code owns the guardrails — a weaker
model produces weaker findings, it does not collapse the gates:

- **Two provenances, one ledger — and the engine outranks the model.**
- **The deterministic band is a recall-first worklist, not a verdict.**
- **Deterministic engines in `harness/` enforce the honesty-critical properties, not model goodwill.**
- **The report can never out-run the ledger.**
- **Every refutation requires code evidence — and every disposition is bounded.**
- **The toolkit treats itself as untrusted.**
- **It is honest about its ceiling** — see [`docs/ceiling-test.md`](docs/ceiling-test.md).

Each claim's full mechanics, with the enforcing engine and the standing test
that guards it, are in [Why you can trust the output](docs/trust.md) and mapped
to code excerpts in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Supply chain

A security tool should itself be vettable in minutes, so the toolkit keeps its own attack surface at the floor:

- **Zero runtime npm dependencies.** This repository has no `package.json` — no lockfile, no `npm install`, no transitive dependency tree. Every engine in `harness/` and both enforcement hooks in `hooks/` import only the Node standard library (`node:fs`, `node:crypto`, …) and files in this repository; scanner-output parsing (SARIF/JSON, Salesforce metadata XML, plain text) is implemented in-tree. The code you clone is the complete harness that runs.
- **Pinned, digest-verified scanner installs.** The one engine that downloads third-party binaries onto the host (`harness/install-scanners.mjs`) fails closed: raw binary downloads are version-pinned and sha256-verified against author-pinned checksums before any file is made executable or extracted; a digest mismatch aborts that tool rather than execute an unverified binary, and a tool/platform with no pin is skipped, never installed unverified. Package-manager installs (pip/npm/git) carry no per-file pin and rely on the manager's own integrity layer (PyPI / npm / Git-over-TLS). The remaining network-reaching code paths are the consent-gated live executors — the digest-pinned ZAP image pull, docker stand-up, the scratch-org lifecycle, org captures — each of which verifies its recorded consent token and fails closed without it, plus a small read-only `sf` tier (the opt-in Dev Hub auto-resolve, org-list probes, the agent-test normalizer) that reaches Salesforce only through your already-authed CLI and is gated by skill-level opt-in rather than a recorded token.

Both properties are locked by standing checks: the `SC-*` checks in [`acceptance/test-ci-hygiene.mjs`](acceptance/test-ci-hygiene.mjs) fail the build on a tracked `package.json` or a third-party import in `harness/`/`hooks/` — and assert this section's claim is itself present, so the doc and the guard cannot drift apart — while the pinned-install behavior (verify before execute, mismatch fails closed, unpinned skipped) is locked by [`acceptance/test-install-scanners.mjs`](acceptance/test-install-scanners.mjs) against local `file://` artifacts. A machine-readable self-SBOM is a candidate future addition; it is not shipped today.

## How it was validated

The methodology and harness were extracted from real multi-pass audits of a production multi-tenant SaaS codebase during an actual AppExchange prep. Run cold from an empty ledger, the audit re-discovered every known-open finding, refuted false candidates with code evidence, and the generated artifact pack matched a hand-built reference. On every change, the standing acceptance suite locks the deterministic engines and hooks against fixture-derived evidence — hermetic: no network, no `sf`, no model. Full cold runs against the synthetic fixtures (a catastrophe-recall fixture and a mostly-compliant middle-band judgment fixture) are per-release validation campaigns graded against pre-committed pass conditions, and a clean pass gates the release tag. **Honest ceiling:** this is the author's own code and self-authored fixtures — only a third-party package or a real Salesforce review tests generalization.

## Documentation

- [Skill catalog](docs/skills.md) — every skill, the deep-audit chain, automation levels.
- [The scans](docs/scans.md) — the 8 scan families, the 17 + 5 scanners, pinning, the DAST mirror.
- [Running it hands-off](docs/permissions.md) — the read-only allowlist, consent gates, both enforcement hooks.
- [Why you can trust the output](docs/trust.md) — the guardrail mechanics in full.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — every enforced property mapped to its engine, test, and code excerpt.
- [`docs/ceiling-test.md`](docs/ceiling-test.md) · [`docs/recurrence-confidence.md`](docs/recurrence-confidence.md) — what it can and cannot certify, measured.
- [`docs/INDEX.md`](docs/INDEX.md) — the full documentation index.
- [`CHANGELOG.md`](CHANGELOG.md) — version history.

## Maturity & caveats

**14 skills · 19 audit dimensions · 8 scan families · up to 17 consent-installed OSS scanners + Code Analyzer + 5 zero-install Salesforce-metadata scanners · a 19-adapter deterministic findings band · a deterministic Submission Completeness Index + a sequenced path-to-green · a core of deterministic engines in `harness/` guarded by a standing test suite (1,388 checks across 89 files)** that fails the build if a refactor breaks an enforced gate or its determinism.

Honest beta (see the top of this README): the deterministic band is reliable and
byte-reproducible; the contestable-severity band needs repeated runs plus human
adjudication — and this was validated on the author's own code and self-authored
fixtures, so only a third-party package or a real Salesforce review tests
generalization. A passing run never means "you will pass" — Salesforce
pen-tests regardless. See [`CHANGELOG.md`](CHANGELOG.md) for the current
version and release notes.

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) for the workflow and
[`CONVENTIONS.md`](CONVENTIONS.md) for the binding rules. Contributions that
update [`baseline/requirements-baseline.yaml`](baseline/requirements-baseline.yaml)
with primary-source citations, or that close a recall gap, are the most valuable
PRs you can make. By participating you agree to the
[Code of Conduct](CODE_OF_CONDUCT.md).

## License

Apache-2.0. See [LICENSE](LICENSE).

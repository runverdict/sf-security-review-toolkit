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
> complete unless there is an evidence file behind it. Where a property can be
> made deterministic, it is enforced by code rather than left to the model's good
> behavior: the AuthN/AuthZ artifact is **withheld by an enforced gate**
> (`harness/artifact-gate.mjs`) while any critical/high finding is open, and the
> recall misses a real review catches that the audit didn't are logged in
> `methodology/known-escapes.md`.

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
        ├─ 3. /sf-security-review-toolkit:run-scans                  8 families: Code Analyzer · DAST · TLS · deps · secrets · ext SAST/SCA/IaC
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

## Install

```
/plugin marketplace add runverdict/sf-security-review-toolkit
/plugin install sf-security-review-toolkit
```

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
| `/sf-security-review-toolkit:run-scans` | Eight scan families: Code Analyzer v5, Checkmarx-portal check, authenticated DAST plan, TLS grade, dependency audit, secret scan, and the external-endpoint OSS scanners (Semgrep SAST, OSV-Scanner SCA, Checkov IaC); folds results into a false-positive dossier | Mixed: agent runs what it can, guides what it can't |
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
Account Manager" rather than silently chosen. PRs that update the baseline with
primary-source citations are the most valuable contribution you can make.

## Status

**v0.7.0 (tagged, cold-validated 2026-06-19) — the toolkit now installs the scan tooling and
runs the DAST itself, end to end, behind one up-front consent gate.** A single preflight gate
carries the run's only confirmations: (1) full-auto vs guided, (2) install the missing scanners to
a tmp dir for the run, and (3) stand up your external backend as an isolated **throwaway** and
active-scan it. On yes, the run produces real Semgrep/OSV/Checkov/secret evidence **plus** a real
digest-pinned ZAP scan against a disposable mirror it stands up — then tears it all down keeping the
evidence, the **credential contract** holding throughout (synthetic secrets live only in the
container; state files record names only; loopback-only scan target). `main` carries 0.7.1 (Docker
prerequisite detection + graceful degradation) and 0.7.2 (deep-audit build-feasibility check). The
v0.7.0 cold run — one full autonomous journey on a 0-context seeded fixture, graded off disk —
re-confirmed the 0.5.x triage/withhold/SCI honesty properties firing live.
The toolkit ships **14 skills**, **19 audit dimensions**, **8 scan families**, a deterministic
**Submission Completeness Index**, a sequenced **path-to-green**, and a core of **deterministic
engines in `harness/` guarded by 30 standing test files (260 checks)** that fail the build if a
refactor breaks an enforced gate or its determinism. Component status, plainly:

- **New in 0.7.1 / 0.7.2 — environment preconditions (graceful degradation).** The throwaway
  DAST runs in containers, so `harness/docker-check.mjs` detects Docker (`available | absent |
  daemon-down`) and the gate offers it only when it can actually run — else an honest "install
  Docker once, or DAST stays owner-run" (Docker is a *guided* prerequisite, never tmp-installed:
  it's a privileged daemon, unlike the userland scanners). `harness/namespace-check.mjs` confirms
  the package's namespace is registered to the authed Dev Hub before the deep-audit gate offers a
  managed-2GP build — so it never offers a build that would fail at `sf package version create`
  and mutate your repo first.
- **New in 0.7.0 — the autonomous throwaway-DAST harness (cold-validated, tagged).** The server-
  tier analogue of the deployed-org deep audit: `stack-detect` classifies whether your external
  backend can stand up; `standup-stack` runs it as an **isolated throwaway container** (copy-in,
  synthetic secrets, manifest of names not values, `127.0.0.1`-only); `run-dast` runs a
  **digest-pinned ZAP** against that disposable mirror and writes host-owned, self-labelled
  *local-throwaway* evidence; `teardown-stack` destroys it (name-scoped, guaranteed, evidence
  kept); `scaffold-env` handles a `needs-secrets` stack (an env stub in tmp, never the repo, with
  a deterministic filled-check). The active scan only ever hits a mirror the toolkit built — never
  live prod, Salesforce infra, or a third party. 12 adversarial-audit findings (several HIGH —
  a credential leak, the loopback boundary, guaranteed teardown) were fixed before the tag.
- **New in 0.6.0 — consented, tmp-scoped scanner install.** `tool-detect` reports which scan
  tools are present vs installable-on-consent; `install-scanners` (the one network-touching engine,
  fail-closed without explicit consent) installs the missing ones to a tmp dir — pip→venv,
  binary→**sha256-pinned download verified before exec**, npm→`--prefix`, git→clone — turning the
  external-SAST/SCA/secret/TLS families from `PENDING-OWNER-RUN` into real evidence; `cleanup-
  scanners` removes the binaries while keeping the evidence (asymmetric, name-scoped). 13
  adversarial-audit findings fixed before validation.
- **New in 0.5.3 — accurate, proactive power-up offers.** The preflight now settles
  deployed-org-deep-audit **install-readiness up front** (`harness/package-readiness.mjs`:
  `installable` / `needs-build` / `n/a` from `sfdx-project.json`) instead of announcing "deep
  audit available (sf authed)" and only discovering the blocker — a placeholder package alias /
  unbuilt version — later in scope. The deep audit is then offered **proactively and accurately**
  (ready → "run it?"; `needs-build` → "build first, then deep-audit?") so the one consent decision
  is fully informed, not a mid-run surprise.
- **New in 0.5.2 — audit-only triage + a wider authN/authZ withhold.** The gate no longer pauses
  at an open critical/high or offers a fix path: the toolkit **audits and reports**, always
  producing the full NOT-READY report (it never drafts/suggests/writes code; read-only on your
  source). The one honesty line — withholding the AuthN/AuthZ doc over an open authN/authZ
  critical/high — now fires purely from the ledger (no election to skip) and covers
  `sessionid-egress` (the review's named auto-fail class) and `crypto-internals` (JWT verification),
  gaps an adversarial pass caught. Plus **G5** — the audit-engine pre-launch check is
  now a decoy-anchored helper (`injection-check.mjs`) so a header-comment mention of
  the inject marker can't be misread as a failed injection. And **G4** — an opt-in
  PreToolUse hook (`hooks/`) that, once you arm it, blocks writing the AuthN/AuthZ doc
  while an open auth hole stands (runtime-independent backstop to the skill gate).
  Suite now **10 files / 100 checks**.
- **New in 0.5.1 — C1 staleness hardened + fix-first validated.** The resumption staleness check
  (`ledger-staleness.mjs`) is rebuilt to handle the messy `finding.file` shapes a real finder writes
  (comma/range line suffixes, two-file cites, absolute paths) — its detect-changed-code path is now
  proven LIVE on a real fixture and guarded by a hermetic + an adversarial standing test (suite now
  **8 files**). The artifact gate's *positive* side is validated end to end (remediate →
  re-audit → 0 open critical/high → gate clean → the withheld AuthN/AuthZ doc regenerates). Repo
  moved to the **`runverdict`** org.
- **New in 0.5.0 — cold-start acceptance hardening (enforced gates + deterministic engines +
  standing tests).** A 0-context, partner-style cold-start run of the whole journey plus an
  external critical-reader review surfaced gaps the fixture-based acceptance test structurally
  could not. Five new no-LLM/no-dependency engines turn the honesty-critical properties into
  enforced logic: `harness/artifact-gate.mjs` STOPs artifact generation while an open
  critical/high finding stands and **withholds the AuthN/AuthZ artifact** (fail-closed, not on the
  model's good behavior); `applicable-requirements.mjs` makes applicability an exact
  `applies_to ∩ elements` set; `baseline-counts.mjs` is the deterministic source of truth for the
  baseline self-description; `finding-clusters.mjs` de-dups the per-dimension fan-out for an honest
  triage headline; `ledger-staleness.mjs` flags findings whose code changed since they were
  audited (a per-pass `audited_commit` fingerprint). The SCI now splits stale-vs-unverified
  evidence and adds a band-level **currency floor** (caps confidence, never the partner's
  completeness %). A new **`agentforce`** architecture element gates the agentforce-* / mcp-*
  requirements precisely — off the generic managed-package element, so a plain package is no longer
  told to satisfy Agentforce requirements it has no surface for. Findings carry **ADDRESSED-fixed**
  vs **ADDRESSED-refuted(FP)** sub-labels so a false positive can't be skim-read as a fix. Six
  standing test files (`acceptance/test-*.mjs`, 43 deterministic checks) guard all of the above,
  and `methodology/known-escapes.md` is the seeded recall log for real-review misses.
- **New in 0.4.4 — Checkmarx prediction (WI-16) + path-to-green (WI-22).** run-scans
  now predicts the findings your owner-gated portal Checkmarx scan will surface (so
  your 3 runs come back with no surprises — a prediction, never an equivalence; an
  optional CxOne CLI path runs the real scan if you hold a licence). And
  compile-submission writes a single ordered `path-to-green.md` — every open item
  from the current SCI band to NO-SURPRISES READY, sequenced blocker → major → minor,
  each tagged with the gate it unblocks. The autonomous-orchestration roadmap
  (WI-16..22) is complete.
- **New in 0.4.3 — reviewer-simulation (WI-21).** A first-class "audit AS THE
  REVIEWER WILL" pass: it reframes everything the audit + scans found as *what
  Salesforce Product Security will see*, ranked by the reviewer's own attack
  priority (public/guest reach → authz → injection → egress → package hygiene →
  infra) and headed by the first things they will hit — each challenge marked
  WILL-FIND / ADDRESSED-fixed / ADDRESSED-refuted(FP) / NOT-STATICALLY-EXAMINED.

- **New in 0.4.2 — the written-policy / org-config artifact pack (WI-19).** The
  surface where a submission stalls *after* the code is clean: `generate-artifacts`
  now drafts six owner-completed stubs — incident-response plan (with the 24-hour
  reporting duty), data-retention + deletion-on-uninstall, DR/backup,
  vuln-remediation SLA, hosting architecture, and prior-pen-test attestation —
  pre-filled from detected facts, each `PARTIAL` until owner-signed (the SCI never
  credits an un-signed stub).
- **New in 0.4.1 — OSS external-surface scanners (WI-17).** The partner-hosted
  server tree + its IaC — which Code Analyzer never sees but Salesforce explicitly
  pen-tests — is now mechanically scanned by free/OSS tools: **Family 7 SAST**
  (Semgrep + Bandit/njsscan/gosec), **Family 8 SCA + IaC** (OSV-Scanner + Checkov),
  plus DAST (Nuclei + Schemathesis) and local TLS evidence (testssl.sh/sslyze,
  which clears the one `conflicting` SSL-Labs baseline entry). Proven by running
  each tool against a seeded fixture; findings feed the SCI.
- **New in 0.4.0 — the Submission Completeness Index (SCI) + a formal evidence
  model.** `compile-submission` now emits a deterministic, gated readiness score
  (`harness/compute-sci.mjs`) — a hard blocker floor over a
  coverage/disposition/freshness vector, with a completeness % **explicitly
  labelled "not a pass prediction"** and the standing "not verified by this
  toolkit" list. Every readiness claim is backed by a typed entry in the evidence
  index (`templates/evidence-index.schema.json`) — no credit for un-evidenced
  self-attestation. `security-review-journey` surfaces the SCI as the autonomous
  pre-compile go/no-go signal. This is the spine of the
  [autonomous-orchestration extensions roadmap](#status) (OSS external-surface
  scanners, written-policy artifacts, and reviewer-simulation follow).

- **Field-tested:** the audit methodology (CONVENTIONS, audit-methodology, the
  find → adversarial-verify → synthesize engine) and the harness assets — these
  were extracted from real multi-pass audits of a real partner codebase before
  its own submission prep.
- **Validated end to end (fresh-context run, 2026-06-13):** the toolkit was run
  cold against a real production codebase (FastAPI + Postgres RLS + an OAuth 2.1
  authorization server + an MCP server + two 2GP packages). From an empty ledger
  the audit re-discovered every known-open finding, refuted false candidates with
  code evidence, and the generated artifact pack matched a hand-built reference.
- **Coverage closures (0.3.0):** three new dimensions —
  [`agentforce-package`](methodology/dimensions/agentforce-package.md) (the
  packaged Agentforce/AI surface, audited independent of any MCP server),
  [`package-metadata`](methodology/dimensions/package-metadata.md) (the
  metadata/XML violation class no code-AST dimension reads), and
  [`apex-exposed-surface`](methodology/dimensions/apex-exposed-surface.md)
  (exposed-entry-point authorization / IDOR / guest-reachability) — plus
  `run-scans` **Family 6** (mechanical secret scan over the working tree **and
  full git history**). These close the four CRITICAL recall gaps from the
  maintainer coverage-gap audit.
- **Acceptance-proven (0.3.1):** a dedicated [`acceptance/`](acceptance/) harness
  builds a synthetic Agentforce managed package seeded with one concrete instance
  of every probe in the new dimensions (plus a deleted-but-recoverable
  git-history secret and negative controls), then runs the toolkit against it
  cold. The run auto-selected all three new dimensions, Family 6 recovered the
  deleted secret from history, and the finders caught the planted classes
  (`apex-exposed-surface` flagged every planted entry-point at critical/high;
  `agentforce-package` flagged the service-agent IDOR / VerifiedCustomerId /
  third-party-LLM / prompt-injection classes). The run also surfaced — and the
  release fixes — two **engine-robustness** gaps: a finder could be derailed onto
  a foreign repo's stale scope-manifest (now hard-anchored to the audit target),
  and the adversarial verifier never received each dimension's §5/§6 refute rules
  (now threaded in, so declaration-level metadata violations are no longer
  over-refuted on a "no live caller" rationale). See the [`CHANGELOG`](CHANGELOG.md)
  and [`acceptance/expected-findings.md`](acceptance/expected-findings.md).
- **Substantially verified, residual gaps flagged:** after the 2026-06-12
  primary-source reconciliation and the same-day partner-gated evidence
  delta (and the 2026-06-20 PMD AppExchange rule-set re-verification),
  121 of 165 baseline entries are `verified_primary` (confirmed
  against official Salesforce docs or partner-gated primary sources); 43
  remain `web_research_unverified` pending primary-source confirmation, and
  1 is `conflicting` (`endpoint-ssl-labs-a-grade`) — that one must be
  resolved through your Partner Account Manager or partner Slack, not trusted
  from this repo. Verification status is per-entry in the YAML; check the
  entries you rely on, not the aggregate.

Use the readiness verdict as preparation guidance, not as a pass prediction. The
acceptance test proves the toolkit *catches its known failure classes* on a
seeded fixture — a no-surprises bar, never a guarantee that Salesforce's own
pen test (which runs regardless) finds nothing.

## License

Apache-2.0. See [LICENSE](LICENSE).

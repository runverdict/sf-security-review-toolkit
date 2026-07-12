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
audit-blocking input, or a consent gate. Everything beyond read-only local work
rides a recorded consent — live operations (endpoint probe, scratch-org deep
audit, the throwaway DAST) and host mutation / network egress (installing
scanners into a per-run temp dir) each carry their own fail-closed gate. In
full-auto those are collected up front on the one batched consent screen; in
guided mode each is asked at its own phase. The engine-run operations — the
scanner install, the scratch-org lifecycle, the throwaway-DAST chain, the org
captures — verify the recorded token in code and refuse to run without it; the
read-only endpoint probe rides the same recorded consent, checked by the driver
before any handshake is sent. You can still invoke any single skill directly.
The journey is **read-only on your source** — the disclosed, consent-gated
exceptions: the deep audit's no-released-version fallback writes packaging
scaffolding (see the
[deep-audit table](#deep-audit-power-up-optional-sf-cli-gated)), and the opt-in
Dev Hub auto-resolve's `sf project retrieve` writes retrieved org metadata into
the project tree — and its strongest verdict is ever only *"no known blockers
in what we can verify — Salesforce pen-tests regardless,"* never *"you will
pass."*

## It runs the scans for you — then wipes the slate clean

Most of what the security review asks for is *scan evidence*: SAST, software-composition (SCA), IaC, secret, DAST, and TLS reports. Producing them by hand means installing a dozen tools, learning each one, running them, and collating the output. The toolkit does it for you, behind recorded, fail-closed consent gates — batched onto one up-front screen in full-auto (it touches the network and the host, so it always asks first):

- **Installs up to 16 OSS scanners into a tmp directory** — Semgrep · Opengrep · Bandit · njsscan · gosec · regexploit (SAST + ReDoS), OSV-Scanner · Trivy · Checkov (SCA + IaC), gitleaks · detect-secrets (secrets), RetireJS (dependencies), Nuclei · Schemathesis (DAST), testssl.sh · sslyze (TLS) — only the ones you don't already have. Raw binary downloads are **sha256-pinned and verified before they ever execute**; pip / npm / git installs lean on their own integrity layers. Taint findings from Opengrep — and from any Semgrep version that still emits the trace (current Semgrep CE withholds it; the ingest flags that gap deterministically rather than papering over it) — carry a **machine-verified source→sink reachability path**, normalized to one shape and fed into the finder digests and the adversarial verifier prompts. The toolkit also ships its own validated Semgrep taint-rule pack ([`rules/injection/`](rules/injection/) — XPath and LDAP injection for Python/JS/Go, classes the stock OSS packs miss).
- **Runs five Salesforce-metadata scanners of its own — deterministic, from source, zero installs**: plain-`http://` egress declared in Remote Site / CSP Trusted Site / Named Credential metadata, `disableProtocolSecurity` opt-outs, View All Data / Modify All Data grants, admin-privilege grants (`ManageUsers`, `AuthorApex`, …) in permission sets *and* profiles, and object-level over-grants (`viewAllRecords` / `modifyAllRecords`) — the exact metadata patterns the review flags.
- **Stands up a throwaway mirror of your backend and runs a digest-pinned OWASP ZAP DAST against it** — loopback-only (enforced on every URL: the engine refuses any non-loopback target), synthetic secrets for every credential the toolkit can synthesize (external-service credentials a stack genuinely needs are operator-supplied into the container env and destroyed at teardown), copy-in on the toolkit's own stand-up recipes (compose stacks run your compose file as written, with ports rebound to loopback). It takes the cheapest rung that fires: scan an **already-running local instance** you point it at, else your **prebuilt image** from a production compose file, else **build from source**, else degrade honestly to an owner-run plan. The active scan only ever hits a loopback target — the disposable mirror the toolkit built, or a local instance you explicitly pointed it at — never your real prod, Salesforce infra, or any third party.
- **Writes real evidence files** into `.security-review/evidence/`, folds them into the readiness verdict and the Submission Completeness Index, and dispositions findings into the false-positive dossier. Every top-level scan report must be indexed — an unindexed report fails the evidence lint by name — and only indexed, requirement-credited evidence earns Submission Completeness Index credit, so an un-citable scan is a visible gap, never a silent credit.
- **Then wipes the slate clean** — removes the installed binaries and tears down the mirror, **keeping only the evidence.** Asymmetric by design: tools out, evidence stays.

**Code Analyzer is run *for* you** — agent-side when the `sf` CLI is already present, or cold-installed on consent: a pinned `@salesforce/cli` + pinned `code-analyzer` plugin (npm installs, riding npm's integrity layer) plus a pinned Temurin JDK whose tarball is sha256-verified before extract — all contained in the tmp root and removed at cleanup. It's the exact static engine Salesforce runs for the #1 review-failure class — Apex CRUD/FLS — so the toolkit produces that band **deterministically** instead of guessing it.

What genuinely stays yours to run: the **Checkmarx portal scan** (a web-only Partner Security Portal upload — no CLI or API exists) and the **live-prod authenticated DAST** (the real scan against your production endpoint with real credentials — the toolkit automates a throwaway-*mirror* ZAP against a disposable copy, but the production submission scan is yours). For those it hands you the exact steps and *predicts* the findings, so you know what your real runs should come back with before you run them.

## Install

This is a **Claude Code plugin** — it runs inside [Claude Code](https://claude.com/claude-code), not as a standalone CLI. You need:

1. **Claude Code** (CLI or IDE extension) — where the toolkit runs.
2. **Node.js 18+** — the deterministic engines under `harness/` use only Node built-ins: no `npm install`, no dependency tree. The code paths that reach beyond your machine are the consent-gated executors (see [Supply chain](#supply-chain)) plus a small set of read-only `sf` CLI reads against your already-authed org (org, package-version, and namespace lookups — the same read-only class as the allowlist below).
3. *Optional:* the **Salesforce CLI** authed to your Dev Hub — only for the `sf`-gated deployed-package deep audit.

Inside Claude Code, add and install the plugin (these are Claude Code slash commands, not terminal commands):

```
/plugin marketplace add runverdict/sf-security-review-toolkit
/plugin install sf-security-review-toolkit
```

Then just say **"run the security review."** You never run the `harness/*.mjs` files yourself — they're internal engines the skills invoke. (To run the standing test suite: `for t in acceptance/test-*.mjs; do node "$t" || exit 1; done`.)

## Running it hands-off (permissions)

The journey is **read-only on your source** — finders and verifiers only read
code; the writes are the toolkit's own state (`.security-review/`), generated
artifacts (`docs/security-review/`), and the consent-gated exceptions disclosed
above. Two ways to cut the per-step permission prompts for an autonomous run:

- **Recommended read-only allowlist.** Drop this into the target repo's
  `.claude/settings.json`. It pre-approves only non-destructive commands —
  nothing that can mutate a Salesforce org or destroy local state (org
  create/delete, deploys, package installs, and logins always prompt). Be
  aware of its edges: the `sf` entries are read-only calls against your org;
  two write locally — `sf project retrieve` writes retrieved metadata into
  the project tree, and `sf code-analyzer run` writes report files; and the
  generic text tools are not write-proof (`sort -o`, `awk`'s file output, and
  shell redirection appended to an allowlisted command can overwrite local
  files) — so use it only on a repo you trust the run to write in:

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

Either way, everything beyond read-only local work — installing the missing
scanners to a tmp dir (a network fetch), standing up a **throwaway** backend +
active-scanning it, the optional `sf`-CLI deployed-org deep audit, and any
live-endpoint probe — **always requires an explicit yes.** And not as policy
prose: each consent is recorded as durable state, the gate's option set is
engine-frozen with a force-injected decline option the driver cannot drop, and
the live executors verify the recorded token and fail closed without it (the
read-only endpoint probe has no executor engine — the driver checks its
recorded consent before any handshake). No allowlist or auto-accept silences
them; full-auto batches the asks onto one up-front screen, it never skips one.

### Enforcement hooks (disclosed in full)

The plugin ships **two** `PreToolUse` hooks (wired in
[`hooks/hooks.json`](hooks/hooks.json)) that load when the plugin is enabled.
Both are plain, readable source in `hooks/`; both read only the toolkit's own
state; neither modifies your source and neither phones home. Outside a repo
where you've engaged the toolkit, both are no-ops — the artifact gate scopes on
the file being written, the ops gate on the working directory — and both fail
toward *allow* on anything they cannot scope (one deliberate exception: the
*armed* artifact gate fails closed when it cannot verify the ledger).

- **The AuthN/AuthZ artifact gate** (`hooks/authz-gate-hook.mjs`, matcher
  `Edit|Write`) — **opt-in, a no-op by default:** for every `Write`/`Edit` it
  exits immediately unless the file being written is the toolkit's own
  `docs/security-review/authn-authz-flow.md` **and** you have armed it by
  creating `.security-review/hook-armed` in the target repo. Armed, it blocks
  writing that one doc while an open authentication/authorization critical/high
  finding stands (the same withhold the journey already enforces — this is the
  runtime-independent backstop). It reads only the toolkit's own state (the
  findings ledger, plus the triage decision), and once armed it fails closed: a
  missing or malformed ledger denies the write rather than assume the audit is
  clean. **Arm it:** `touch <repo>/.security-review/hook-armed`. **Disarm:**
  delete that file.
- **The irreversible-ops consent gate** (`hooks/sf-ops-gate-hook.mjs`, matcher
  `Bash`) — active only inside a toolkit-managed repo: it acts only when the
  working directory is inside a tree containing `.security-review/` (the marker
  is looked up through parent directories); outside one, every command is
  allowed, so it never interferes with your unrelated `sf` work. Inside one, it
  classifies each command on its action verb (read-only verbs always pass) and
  **denies the enumerated irreversible operations unless an affirmative
  recorded consent for that gate class exists**: the permanent 2GP
  `package version promote` under its own gate; package version create/delete,
  package install/uninstall/delete, scratch- and sandbox-org create/delete, org
  deletes, data deletes, and deploys under the deep-audit gate; and
  credential-writing logins plus global npm installs/uninstalls under the
  CLI-setup gate (the `sfdx` legacy `force:*` forms of all of these included). This is the durable backstop for the deep audit's live operations — a
  gated op cannot run on model goodwill alone. Honest residual: the classifier
  normalizes the common wrapper and chain forms but is not a complete shell
  parser; the claim is *"an honest driver running the documented ops is
  gated,"* not *"impossible to bypass"* (limits documented in the hook's
  header).

Both hooks are defense-in-depth the human opts into — by enabling the plugin,
and for the artifact gate by arming the flag — not a guarantee.

## Skill catalog

| Skill | What it does | Automation level |
|---|---|---|
| `/sf-security-review-toolkit:security-review-journey` | The autonomous driver: a seconds-long read-only preflight detects your architecture and senses `sf` auth, offers the opt-in power-ups (Dev Hub auto-resolve, deployed-package deep audit), then drives the whole journey end to end — in full-auto, two up-front screens, then, pausing only for a genuinely audit-blocking gap, straight to the submission package; also does state detection / resume / routing / status | Autonomous (gated) |
| `/sf-security-review-toolkit:scope-submission` | Detects your architecture elements (managed package, Agentforce agent, external endpoint, MCP server, Canvas, LWC/Aura, mobile), deterministically enumerates every deployable app root under the conventional monorepo containers (`apps/*` · `services/*` · `packages/*`, plus the repo root — an app surface there can't be silently missed; an ambiguous root routes through a clarify gate), compiles which baseline requirements apply, gates on partner-program prerequisites | Automated |
| `/sf-security-review-toolkit:audit-codebase` | Multi-agent security audit across 19 threat dimensions, kept honest by a dual-provenance ledger: every model-raised finding is adversarially verified against the code, while deterministic scanner/metadata findings enter engine-owned — the model can never refute or downgrade them; incremental via the findings ledger | Automated (you read the report) |
| `/sf-security-review-toolkit:generate-artifacts` | Drafts the submission artifacts from your code: AuthN/AuthZ flow (with the credential-storage statement), architecture/data-flow diagram, data-sensitivity classification, exposed-tools inventory + OpenAPI, access-control documentation, the false-positive dossier skeleton, and the written-policy / org-config pack (incident response, retention + deletion-on-uninstall, DR/backup, vuln-remediation SLA) as owner-completed stubs | Automated draft, human review |
| `/sf-security-review-toolkit:run-scans` | Eight scan families — Code Analyzer v5, Checkmarx-portal check, the consented throwaway-mirror ZAP DAST it runs itself + the live-prod DAST plan, TLS grade, dependency audit, secret scan, external SAST, and external SCA + IaC — powered by **up to 16 consent-installed OSS scanners** plus five zero-install Salesforce-metadata scanners (see ["It runs the scans for you"](#it-runs-the-scans-for-you--then-wipes-the-slate-clean)); folds every result into a dispositioned false-positive dossier | Mixed: agent runs what it can, guides what it can't |
| `/sf-security-review-toolkit:reviewer-simulation` | Reframes everything the audit + scans found as **what Salesforce Product Security will see** — the challenge checklist ranked by the reviewer's own attack priority, headed by the first things they will hit | Automated synthesis |
| `/sf-security-review-toolkit:prepare-test-environment` | Runbooks + generated evidence for the reviewer-facing test environment: Trialforce/DE review org; the configured agent (Topics + reasoning engine) with an utterance list validated headlessly via `sf agent test` — machine-readable pass/fail evidence, and a routing failure is never credited as a pass; two test users with the authorization-boundary proof; the isolated external test tenant; and the end-to-end self-test that catches an un-testable environment before the reviewer does — the most preventable bounce class | Guided, with generated evidence |
| `/sf-security-review-toolkit:compile-submission` | Pre-fills the questionnaire (every N/A needs a reason — the lint blocks the compile), fills the required-artifacts checklist row by row (HAVE only with verified evidence), computes the deterministic Submission Completeness Index (the gated go/no-go), and emits the readiness verdict + a sequenced path-to-green + the downloadable submission package (wizard-slot INDEX, PENDING-OWNER-RUN handoff for what only you can run) | Automated compile, human submits |
| `/sf-security-review-toolkit:stay-listed` | The post-approval obligations on a schedule: re-review trigger watch, the per-release security-relevance gate (listing association + readiness inheritance), the 24-hour incident-reporting duty, platform security mandates, evidence-freshness re-runs, and test-environment liveness | Guided recurring |

### Deep-audit power-up (optional, `sf`-CLI-gated)

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

The model does the finding; deterministic code owns the guardrails — a weaker model produces weaker findings, it does not collapse the gates.

- **Two provenances, one ledger — and the engine outranks the model.** Scanner and metadata output is ingested as deterministic findings by an 18-adapter registry. Severity is deterministic and never the model's: a hit that maps to a requirement class takes the class severity outright, and an unmapped hit takes the scanner's own severity through a pinned per-tool tier map or the CVSS qualitative scale. The entire band is locked **byte-deterministic** by a standing test (the same corpus ingested twice must be byte-identical), and an engine-owned finding is authoritative — the model can never refute or downgrade it; where the engine finding owns a mapped requirement class, a co-located model finding is structurally demoted at the merge layer, not in a prompt the model could ignore (a class-less engine finding leaves any model duplicate visible — under-merge is the safe failure).
- **The deterministic band is a recall-first worklist, not a verdict — determinism buys reproducibility, not precision.** The engine surfaces every candidate a scanner or metadata pattern raises, so the raw band is deliberately noisier than the true-finding set (in a real cold run it ran ~85% scanner noise before adjudication). What determinism guarantees is that the band is byte-reproducible and structurally sound — *not* that every row is a true positive. The `seed-auto-dispositions` engine only ever narrows *known-safe* noise: it emits OVERRIDABLE, refute-only priors (`disposition_source:'heuristic'`, into the same file `apply-dispositions` consumes) that the audit re-opens the moment code evidence says otherwise — never `llm-inferred` findings, and never a signed decision. A prior is a starting point for your review, not an acceptance of risk on your behalf.
- **Deterministic engines in `harness/` enforce the honesty-critical properties, not model goodwill.** The AuthN/AuthZ artifact is withheld by an enforced gate while any authentication/authorization critical/high finding is open; the Submission Completeness Index has a hard blocker floor, is labelled *"not a pass prediction"*, and credits nothing as complete without a reviewer-reproducible evidence file behind it; applicability, finding de-duplication, ledger merge, staleness, and cross-run recurrence are all deterministic and guarded by standing tests. **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** maps each of these properties to its enforcing engine, the standing test that guards it, and the code excerpt — verifiable in five minutes without cloning.
- **The report can never out-run the ledger.** The audit report's executive summary must carry the verbatim finding-cluster headline recomputed from the current ledger — a hand-written "no blockers" over open criticals fails with an exit code; the durable run-log's open-finding counts are re-derived from the post-disposition ledger; and every operator-facing surface (preflight report, scan status, recap, readiness verdict) is an engine-rendered skeleton pasted verbatim — a scan family reads DONE only when a reviewer-reproducible report exists on disk.
- **Every refutation requires code evidence — and every disposition is bounded.** The adversarial verifier reads the actual code — never the finder's reasoning — and must return the exact `file:line` + snippet that decides it. The false-positive dossier reuses that verbatim; any entry missing real evidence is marked `DRAFT`, not submission-ready. Signed dispositions are scope-bounded — to the files actually read, or time-bounded to the adjudicated pass — so one can never silently suppress a future finding at a new locus, and they apply all-or-nothing through a deterministic engine: one invalid entry rejects the whole file with an exit code and nothing written. The toolkit never accepts residual risk on your behalf — you sign every disposition.
- **The toolkit treats itself as untrusted.** Every consent is recorded durable state that the live executors verify fail-closed at the engine boundary; all drafted artifact content crosses one deterministic write point that allows exactly two roots (`docs/security-review/`, `.security-review/`) and refuses traversal, symlink escapes, and `.git/` targets — all-or-nothing; teardown is name-anchored to toolkit-created resources only, so a tampered manifest can never delete a production org or turn into a stray `rm -rf`; and live captures persist evidence through strict field allowlists — a raw org secret is never written to evidence or state.
- **It is honest about its ceiling.** It tells you what it cannot certify — see [`docs/ceiling-test.md`](docs/ceiling-test.md) and [`docs/recurrence-confidence.md`](docs/recurrence-confidence.md) — instead of pretending to be complete; any miss a real review surfaces (what the reviewer catches that the audit didn't) gets logged in [`methodology/known-escapes.md`](methodology/known-escapes.md) — seeded honestly empty until a real review reports back.

## Supply chain

A security tool should itself be vettable in minutes, so the toolkit keeps its own attack surface at the floor:

- **Zero runtime npm dependencies.** This repository has no `package.json` — no lockfile, no `npm install`, no transitive dependency tree. Every engine in `harness/` and both enforcement hooks in `hooks/` import only the Node standard library (`node:fs`, `node:crypto`, …) and files in this repository; scanner-output parsing (SARIF/JSON, Salesforce metadata XML, plain text) is implemented in-tree. The code you clone is the complete harness that runs.
- **Pinned, digest-verified scanner installs.** The one engine that downloads third-party binaries onto the host (`harness/install-scanners.mjs`) fails closed: raw binary downloads are version-pinned and sha256-verified against author-pinned checksums before any file is made executable or extracted; a digest mismatch aborts that tool rather than execute an unverified binary, and a tool/platform with no pin is skipped, never installed unverified. Package-manager installs (pip/npm/git) carry no per-file pin and rely on the manager's own integrity layer (PyPI / npm / Git-over-TLS). The remaining network-reaching code paths are the consent-gated live executors — the digest-pinned ZAP image pull, docker stand-up, the scratch-org lifecycle, org captures — each of which verifies its recorded consent token and fails closed without it, plus a small read-only `sf` tier (the opt-in Dev Hub auto-resolve, org-list probes, the agent-test normalizer) that reaches Salesforce only through your already-authed CLI and is gated by skill-level opt-in rather than a recorded token.

Both properties are locked by standing checks: the `SC-*` checks in [`acceptance/test-ci-hygiene.mjs`](acceptance/test-ci-hygiene.mjs) fail the build on a tracked `package.json` or a third-party import in `harness/`/`hooks/` — and assert this section's claim is itself present, so the doc and the guard cannot drift apart — while the pinned-install behavior (verify before execute, mismatch fails closed, unpinned skipped) is locked by [`acceptance/test-install-scanners.mjs`](acceptance/test-install-scanners.mjs) against local `file://` artifacts. A machine-readable self-SBOM is a candidate future addition; it is not shipped today.

## How it was validated

The methodology and harness were extracted from real multi-pass audits of a production multi-tenant SaaS codebase during an actual AppExchange prep. Run cold from an empty ledger, the audit re-discovered every known-open finding, refuted false candidates with code evidence, and the generated artifact pack matched a hand-built reference. On every change, the standing acceptance suite locks the deterministic engines and hooks against fixture-derived evidence — hermetic: no network, no `sf`, no model. Full cold runs against the synthetic fixtures (a catastrophe-recall fixture and a mostly-compliant middle-band judgment fixture) are per-release validation campaigns graded against pre-committed pass conditions, and a clean pass gates the release tag. **Honest ceiling:** this is the author's own code and self-authored fixtures — only a third-party package or a real Salesforce review tests generalization.

## Maturity & what's in the box

**14 skills · 19 audit dimensions · 8 scan families · up to 16 consent-installed OSS scanners + Code Analyzer + 5 zero-install Salesforce-metadata scanners · an 18-adapter deterministic findings band · a deterministic Submission Completeness Index + a sequenced path-to-green · a core of deterministic engines in `harness/` guarded by a standing test suite (1,300+ checks across 86 files)** that fails the build if a refactor breaks an enforced gate or its determinism.

Honest beta (see the top of this README). See [`CHANGELOG.md`](CHANGELOG.md) for the current version and release notes. Contributions that update the baseline with primary-source citations, or that close a recall gap, are the most valuable PRs you can make.

## License

Apache-2.0. See [LICENSE](LICENSE).

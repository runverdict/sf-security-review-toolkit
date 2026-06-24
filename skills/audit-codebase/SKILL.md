---
name: audit-codebase
description: Phase 1 of security review prep. Runs the autonomous multi-agent white-box audit of the partner's own codebase across the applicable threat dimensions — find, adversarially verify, synthesize — maintaining a findings ledger that makes every re-run incremental. Use after scope-submission, after fixing findings, or after a failed review to sweep for a vulnerability class.
allowed-tools: Read Grep Glob Write(**/.security-review/scope-input.json) Write(**/.security-review/target-map.json) Write(**/.security-review/audit-ledger.json) Write(**/.security-review/run-log.md) Write(**/.security-review/pass-*/**) Write(**/.security-review/runs/**) Write(**/.security-review/recurrence-confidence.json) Write(**/docs/security-review/**) Bash(ls *) Bash(find *) Bash(git log *) Bash(git status*) Bash(git diff*) Bash(cat *) Bash(sha256sum *) Bash(shasum *) Bash(node *harness/record-consent.mjs *) Bash(node *harness/recurrence-confidence.mjs *) Task AskUserQuestion
---

# Audit Codebase

Execute the audit engine specified in
`${CLAUDE_PLUGIN_ROOT}/methodology/audit-methodology.md` against the partner's
repo. That spec is binding — pipeline, schemas, severity taxonomy, ledger
mechanics, pass planning, and honesty constraints all live there; this skill is
the operating procedure that runs it. The output is a verified findings report
under `docs/security-review/` plus an updated ledger under `.security-review/`.
**This is static code review by LLM agents reading source — never DAST, never a
pen test** (CONVENTIONS §2); Salesforce performs its own penetration testing
regardless of anything this engine produces.

## When to use

- After `/sf-security-review-toolkit:scope-submission` wrote a scope manifest
- Re-audit after remediation — cheap, because the ledger digest suppresses
  everything already found (the re-run loop, step 8)
- After a failed review: ingest the failure report into the ledger as
  confirmed findings, then sweep the codebase for the same *class* — the
  remediation flow expects ALL instances of a flagged pattern fixed, not just
  the cited ones (baseline: `process-failure-remediation-flow`)
- NOT for scanning packaged Apex — CRUD/FLS and the structured package pass
  belong to Code Analyzer in `/sf-security-review-toolkit:run-scans`
- NOT a substitute for the authenticated DAST scan the review requires, and
  NOT for first-time architecture detection (`/sf-security-review-toolkit:scope-submission`)

## Prerequisites

- `<target>/.security-review/scope-manifest.json` — **refuse to run without
  it** (audit-methodology §1.1) and route to scope-submission. Dimension
  selection keys off the manifest; an audit of the wrong surface set is wasted
  spend
- The dimension files in `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/`
- Baseline currency: read the baseline entries this skill leans on
  (`process-failure-remediation-flow`; the severity table in
  audit-methodology §4 points at `process-review-fee` and
  `process-review-timeline`) and warn if their `last_verified` is older than
  90 days (CONVENTIONS §4)
- A clean-enough working tree that file:line citations and ledger dedup keys
  stay meaningful across the run

## Steps

1. **Load the manifest — and check it is still true.** A manifest is stale
   when the repo has outgrown it: an `sfdx-project.json` that appeared since,
   a changed MCP tool count, a new route tree or worker queue. Warn and offer
   `/sf-security-review-toolkit:scope-submission` re-scoping before fanning
   out — auditing yesterday's architecture produces today's false confidence.

2. **Declare the token tier before launching anything** (CONVENTIONS §5,
   audit-methodology §7), and get an explicit go-ahead:

   | Tier | What runs | Approx. agents | Honest cost note |
   |---|---|---|---|
   | `quick` | Top-failure dimensions, one pass | ~8–10 | Triage only. Catches the auto-fail classes; says nothing about the rest — never present its output as review readiness |
   | `standard` | All applicable dimensions, one pass | ~20–30 | The default. Each finder reads tens of files; expect millions of tokens and an hour-plus of wall clock on a real codebase |
   | `exhaustive` | Multi-pass per audit-methodology §6 until two consecutive dry passes | ~50–80 across passes | Several times `standard`; spread across work sessions — the ledger makes resumption incremental |

   The verify fan-out scales with what the finders find, so a target-rich
   codebase costs more at every tier — report the live agent count as the run
   progresses. **Do not run `exhaustive` on a first pass.** A never-audited
   codebase yields its first batch of critical/high findings to `standard`;
   burning the multi-pass budget before those are fixed pays verifiers to
   re-walk code that is about to change. Field sequence that works: `standard`
   → fix → re-run (step 8) → `exhaustive` once the ledger is quiet.

   **This is a MANDATORY `AskUserQuestion` stop — not a printed line, and never a
   silence-is-yes inference.** Ask the operator to confirm the tier + give the go-ahead
   via `AskUserQuestion` (the tier gate ENFORCES the hard default: `standard` on a first
   pass — never pre-select or auto-run `exhaustive`). The operator's SELECTION of an
   affirmative option IS the consent — record it with the controlled `--decision` token
   (do NOT rely on the option label containing "yes"); use `--decision deny` if they declined:
   `node ${CLAUDE_PLUGIN_ROOT}/harness/record-consent.mjs --gate audit-tier --decision affirm --question "<the tier + go-ahead question>" --answer "<the option they picked>" --target <target>`.
   The fan-out **physically cannot launch** without this recorded: `build-audit-engine.mjs`
   verifies `audit-tier` (and `audit-targetmap`, below) and refuses to assemble the engine —
   exit non-zero, nothing written — when either is missing. **Consent is written ONLY by
   `record-consent.mjs`** (its grant is in `allowed-tools`, so recording a yes is the
   least-friction path); the `Write` tool is path-scoped and CANNOT target
   `.security-review/consent/` — never hand-author a consent file.

3. **Resolve the target map** (audit-methodology §1.3). Select dimensions per
   the §1.2 applicability matrix × the manifest × the pass band (§6) — every
   inapplicable dimension gets an explicit `na_reason`, never a silent skip.
   Then run each applicable dimension's detection heuristics (§3 of its file)
   against the real repo and write
   `<target>/.security-review/target-map.json`. Three rules with teeth:

   - **Show the map to the user BEFORE any agent launches — a MANDATORY
     `AskUserQuestion` stop.** This is the one cheap moment to correct course — let
     them edit paths, add the module the heuristics missed, or veto a dimension. A
     wrong target map silently audits the wrong code for the entire run. Present the
     resolved `target-map.json` and ask for approval/corrections via `AskUserQuestion`;
     on approval, RECORD it — the operator's SELECTION of the approve option IS the consent
     (do NOT rely on the label containing "yes"); use `--decision deny` if they declined:
     `node ${CLAUDE_PLUGIN_ROOT}/harness/record-consent.mjs --gate audit-targetmap --decision affirm --question "<the show-map approval question>" --answer "<the option they picked>" --target <target>`.
     `build-audit-engine.mjs` verifies BOTH `audit-tier` and `audit-targetmap` before it
     will assemble the engine — a skipped show-map physically cannot fan out (it is not a
     silence-is-yes input; the architecture was detected, but the MAP is a stop you record).
   - **`applicable: true` with no targets = `unresolved: true`**, surfaced as
     "couldn't map dimension X — point me at the code or confirm N/A." A
     skipped dimension is false coverage, worse than no audit.
   - **Exclude generated and vendored code from targets**: `node_modules/`,
     `vendor/`, `dist/`, `build/`, virtualenvs, minified bundles, lockfiles,
     generated API clients and protobuf stubs. Finders that wade into
     third-party or machine-written code burn their context on findings the
     partner cannot act on — defects in dependencies are the dependency
     scanner's job (`/sf-security-review-toolkit:run-scans`, baseline:
     `scan-dependency-vulnerabilities`), and for generated code the right
     target is the generator's template, not its output. One exception:
     committed credential material is in scope wherever it lives — a real key
     in a vendored config is still a finding.

   `stack_notes` carries the partner's *claimed* security model, labeled as
   claims — the single most productive finder instruction in the field runs
   was "verify the claimed model against the actual code, do not assume it."

4. **Compile the ledger digest** from
   `<target>/.security-review/audit-ledger.json`: one line per entry,
   `[state] title — file (one-line resolution or refute reason)` (§5.3).
   First run: empty digest is fine. Include `refuted` entries (they stop
   finders re-raising the same non-issue) and `fixed` entries (re-report only
   if regressed). Skipping the digest is the expensive mistake: every pass
   re-discovers the same top findings and pays the verify fan-out for them
   again. Never let an LLM rewrite ledger entries — the merge is mechanical
   (step 6) or the dedup keys corrupt.

5. **Run the engine.** Preferred substrate: the Workflow tool with a project-local
   copy of `${CLAUDE_PLUGIN_ROOT}/harness/workflow-template.mjs`, assembled by the
   shipped `build-audit-engine.mjs` (next). You do NOT hand-extract prompts or
   hand-inject run-args — you supply your scoping as data and the engine assembles
   the runnable script deterministically (the §4 finder prompt + §5/§6 verifier notes
   per dimension are pulled by the engine, both load-bearing as detailed below).

   **Then — via the shipped assembler, never by hand — build and run a
   project-local copy.** You write your SCOPING as DATA; the deterministic engine
   does the assembly (this is the P2 discipline — "engine code, never an LLM" — and
   it retires the marker-slice fragility G5 hardened):

   1. Write `<target>/.security-review/scope-input.json` — the scoping output that
      is legitimately yours (tier, pass, runDate, the step-4 `ledger` digest, the
      `context` block assembled from the scope manifest, the `applicable` dimensions
      with their per-dimension `targets` + `stackNotes`, and the `na` list with
      reasons). The schema is in `${CLAUDE_PLUGIN_ROOT}/harness/build-audit-engine.mjs`'s
      header.
   2. Run the assembler:
      `node ${CLAUDE_PLUGIN_ROOT}/harness/build-audit-engine.mjs --plugin ${CLAUDE_PLUGIN_ROOT} --repo <target> --input <target>/.security-review/scope-input.json`.
      **It FAILS CLOSED (exit 3, nothing written) unless both `audit-tier` (Step 2) and
      `audit-targetmap` (Step 3) consents are recorded** — the durable coupling: a skipped
      stop = no engine = nothing for the Workflow tool to run, and the assembled engine
      itself refuses to fan out unless this gate stamped `consentVerified`. It then
      DETERMINISTICALLY extracts, per dimension, the §4 threat-focus paragraph
      (`finderPrompt`) AND the §5/§6 Verifier-guidance + false-positive-patterns block
      (`verifierNotes`) from the dimension file — **both load-bearing**: the verifier
      only sees generic skepticism unless it gets `verifierNotes`, and without the
      dimension's own refute rules it over-refutes declaration-level metadata
      violations (an exposed message channel, an `http://`/wildcard trusted host,
      `position:absolute` in component CSS, an unenclosed prompt template) on a "no
      live caller / dead-code artifact" rationale the Salesforce static review — which
      flags whatever the package SHIPS — does not apply. It injects the run-args into
      `<target>/.security-review/audit-engine.mjs` (a project-local copy of the
      template — reproducible + committable) and writes `target-map.json`. It aborts
      LOUD on a missing/malformed dimension file rather than emitting an empty prompt.
   3. Pre-launch check:
      `node ${CLAUDE_PLUGIN_ROOT}/harness/injection-check.mjs <target>/.security-review/audit-engine.mjs`
      (exit 0 = the injected `INJECTED` parses and carries `repoRoot`). Do NOT
      `node --check` the assembled file — it reports the template's top-level
      `return {…}` as `SyntaxError: Illegal return statement`, which is **expected**
      (the Workflow runtime wraps the body in an async scope where top-level `return`
      is legal); injection-check validates only the injected object.
   4. Invoke the Workflow tool with `scriptPath` pointing at the produced
      `audit-engine.mjs`. **Do NOT pass run-args through the Workflow `args`
      parameter** — they arrive as a JSON *string*, `args.repoRoot` is undefined, and
      the run fails fast (*"run args missing or incomplete"*, 0 agents). The
      `args`-binding branch in the template is only a safety net; the assembler-written
      `INJECTED` is the load-bearing path, every time.

   The assembler writes the full run-args object (`repoRoot`, `scopeManifestPath`,
   `tier`, `passNumber`, `runDate`, `reportPath`, `ledger`, `context`, and a
   `dimensions[]` where each entry additionally carries the engine-extracted
   `finderPrompt` + `verifierNotes`) into `audit-engine.mjs`. You author only the
   `scope-input.json` from step 1, never this object by hand.

   Without the Workflow tool, degrade to
   `${CLAUDE_PLUGIN_ROOT}/harness/sequential-fallback.md`: same prompts, same
   schemas, one dimension at a time with every stage persisted under
   `.security-review/pass-<N>/` before the next starts, verifiers in small
   parallel batches, schema enforcement by instruct-validate-retry, resume
   from the last persisted dimension. Token cost is comparable; wall clock
   roughly doubles — say so when offering it. The non-negotiables that survive
   either substrate: **the recorded consent gate (`audit-tier` + `audit-targetmap`),
   `verifyConsent`'d + FAILED CLOSED before the first finder** — on the Workflow path
   `build-audit-engine.mjs` enforces it, on the sequential path the orchestrator runs
   the same `record-consent` verify (sequential-fallback.md §3 step 1); read-only
   finder/verifier agents (the audit never mutates the repo it audits), fresh-context
   verifiers that never see the finder's reasoning, and **findings that skip
   verification are never reported** (§3.3) — a verifier that fails twice sends its
   finding to the run log as `unverified — re-run`, not to the report.

6. **Merge mechanically; let synthesis write the report.** The synthesis agent
   writes `<target>/docs/security-review/audit-report-<date>-pass<N>.md` from
   confirmed/partial findings only, with the §9 contract: (1) executive
   summary — blocking vs hardening, stated plainly, and headed by the
   deterministic cluster view (`node ${CLAUDE_PLUGIN_ROOT}/harness/finding-clusters.mjs
   --target <target> --json`): report the raw confirmed counts AND the distinct
   affected files / file-level critical-high / cross-dimension-overlap headline,
   so the per-dimension fan-out re-finding one root cause under several lenses is
   never presented as that many distinct problems; (2) prioritized findings
   table sorted by the verifier's `adjusted_severity` (the finder's severity
   is provenance only); (3) a short, concrete remediation plan per
   critical/high finding; (4) **strong controls observed** — written for reuse
   in the reviewer-facing artifacts; (5) **coverage and residual risk** —
   which dimensions ran, which were N/A and why, which were unresolved, and
   the white-box-static caveat (a report without this section is dishonest by
   omission); (6) readiness-tracker mapping. Then run the shipped merge engine —
   mechanical, deterministic, never an LLM (a synthesis agent paraphrasing entries
   corrupts the dedup keys). Write the audit Workflow's return to a file, then:
   `node ${CLAUDE_PLUGIN_ROOT}/harness/merge-ledger.mjs --repo <target> --result <result.json> --date <date> --pass <N> --report <report-path> --tier <tier>`.
   It computes the dedup ids (16 hex of SHA-256 over normalized file path + `\n` +
   normalized title — never the description, never line numbers; exact normalization
   in `${CLAUDE_PLUGIN_ROOT}/templates/audit-ledger.schema.json`), maps
   `confirmed_real`/`partially_real` → `confirmed` and `false_positive` → `refuted`,
   flips a re-found `fixed` entry back to `confirmed` with `regression: true`, redacts
   any credential value in an evidence snippet (CONVENTIONS §6), tracks first/last-seen
   across passes, merges INTO the existing ledger (never an overwrite), stamps the pass
   `audited_commit` with the target's `git rev-parse HEAD` (the resumption fingerprint —
   without it a later resume cannot tell whether the code behind a finding moved since
   the audit; step 7 / `harness/ledger-staleness.mjs`), and appends the pass entry to
   `.security-review/run-log.md`. Surface the unverified list from the run. Do NOT
   hand-edit ledger entries.

7. **Gate and route.** Open `critical`/`high` findings halt the journey: fix
   before `/sf-security-review-toolkit:generate-artifacts`, because the
   AuthN/AuthZ artifact would otherwise document the vulnerable flow.
   Quiet ledger → proceed. Two phrasings are banned everywhere — "secure" and
   "clean": a dry pass means *this method found nothing new within the audited
   dimensions*, never that nothing is there. Verification bounds false
   positives; nothing here bounds false negatives except dimension coverage
   and more passes (§11).

8. **The re-run loop** — how fixes become a quiet ledger:

   1. The partner fixes a finding. Mark the ledger entry `fixed` with a
      `fix_commit` only after verifying the fix actually landed in the code —
      never on the partner's word alone (CONVENTIONS §2). A real defect the
      partner chooses not to fix becomes `accepted_risk` with a written
      justification and a named owner — that is an owner decision, never
      agent-made.
   2. Re-run **dirty dimensions only**: the dimensions whose entries changed
      state since the last pass, plus any dimension whose target files moved
      per `git diff`. Same tier, same prompts, full digest — the finders
      re-probe the fixed paths (regression check) and the adjacent code the
      fix may have disturbed, while the digest keeps everything else quiet.
      This is what makes pass N+1 a fraction of pass 1's cost.
   3. Escalate to `exhaustive` only now, if the submission warrants it, and
      run until the §6 stop rule: two consecutive dry passes, the second a
      full-band pass — one dry pass may only mean the band missed where the
      bugs live.

9. **Run-to-run stability of the contestable band (optional; independent
   re-runs).** A cold-at-exhaustive test refuted the idea that the audit calls
   the contestable-severity band reliably in a single run: across three runs of
   *identical* code the confirmed set drifted (pairwise Jaccard 0.44–0.67) and
   individual findings flipped status/severity. The unambiguous blockers recur;
   the contestable band is an unstable *sample*. This step makes that variance
   visible — it is **NOT** part of the stop rule and never gates anything.

   **Sharply distinct from step 8.** Step 8 is fix → re-run: the code *changes*
   between passes (remediation), and a finding that disappears is a fix landing.
   This step is **independent re-runs on the SAME unchanged code** — nothing is
   fixed between them — so a finding that appears in one run and not the next is
   *run-to-run instability*, the thing the human must adjudicate.

   1. **Snapshot a completed run.** After a run reaches its stop rule, copy the
      final `<target>/.security-review/audit-ledger.json` to
      `<target>/.security-review/runs/run-<k>/audit-ledger.json` (k = the next
      integer index; start at 1). Do this for each independent run you choose to
      perform. **Do NOT auto-orchestrate N runs** — each is a deliberate,
      operator-initiated audit; you only archive what was actually run.
   2. **Classify once ≥2 snapshots at the SAME `audited_commit` exist.** The
      stability read is only meaningful across runs of identical code, so
      confirm the snapshots share an `audited_commit` (the engine reports
      `commit_consistency`; `mixed` means a code change crept in and the result
      conflates a fix with instability). Then run the deterministic engine:

      ```bash
      node ${CLAUDE_PLUGIN_ROOT}/harness/recurrence-confidence.mjs \
        --ledger <target>/.security-review/runs/run-1/audit-ledger.json \
        --ledger <target>/.security-review/runs/run-2/audit-ledger.json \
        [--ledger <target>/.security-review/runs/run-N/audit-ledger.json ...] \
        --repo-root <target> \
        --out <target>/.security-review/recurrence-confidence.json
      ```

      Surface `summary.bucket_counts`, `summary.reliably_recurring_blockers`
      (the all-runs + status/severity-stable set), and `summary.by_file`. The
      engine is pure/deterministic and never writes outside
      `<target>/.security-review/`.
   3. **The honest contract — state it to the operator.** No fixed run-count is
      "complete"; the reliably-recurring blockers are what the toolkit finds
      dependably; everything outside that set — appearing in only some runs, or
      flipping status/severity — is the contestable band that a **human
      adjudicates**, run by run. More runs sharpen the picture; they never
      certify it. **Never imply "run N times and you're safe."** Salesforce
      pen-tests the surface regardless. The artifact surfaces (informational
      only, never altering the readiness gate) in
      `/sf-security-review-toolkit:compile-submission`.

## Automated vs. manual recap

Automated: manifest staleness check, dimension selection, target-map
resolution, the find → verify → synthesize fan-out, the mechanical ledger
merge, report and run-log writing. Manual: tier choice, target-map
confirmation and pruning, every remediation, the `fixed`/`accepted_risk`
dispositions, and the judgment call on what a finding means for the business.
The run recap states which dimensions ran, candidates vs confirmed vs refuted
vs unverified counts, and what was NOT covered: packaged Apex CRUD/FLS belongs
to Code Analyzer, dynamic behavior belongs to DAST, and this was white-box
static review by LLM agents — Salesforce pen-tests the surface regardless.

## What feeds the next skill

The report's "strong controls observed" section is mined by
`/sf-security-review-toolkit:generate-artifacts` for the controls narrative;
the ledger gates `/sf-security-review-toolkit:compile-submission` (zero
undispositioned critical/high, and the readiness verdict records which tier
and how many passes produced it); refuted entries' verifier reasoning
pre-classifies scanner false positives for the dossier in
`/sf-security-review-toolkit:run-scans`.

# Changelog

All notable changes to the sf-security-review-toolkit are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/); versions
follow semantic versioning.

## [Unreleased]

_Nothing pending — the next change starts a new section here._

---

> **Unreleased on `main` (untagged).** The last published tag is **`v0.7.0`** (cold-validated
> 2026-06-19). Every version from **`0.7.1`** upward in the sections below is merged to `main`
> but **not tagged** — they are unreleased-on-`main` checkpoints, not published releases, and
> the dates are their commit dates on `main`. Each section is a per-version summary; the full
> change-typed detail for the `0.6.0`–`0.8.x` arc (the `Fixed` / `Changed` / `Added` /
> `Hardened` / `Roadmap` record and the program-note checkpoints those summaries draw on) is
> preserved verbatim under **Detailed record & program notes** at the foot of this arc, just
> above `## [0.5.5]`.

## [0.8.18] — 2026-06-24

**WI-D — the final piece of the driver-improvisation hardening: make the post-Workflow ledger-merge
step unambiguous so the driver stops fumbling it.** A cold run PROBED the Workflow output file
(parse-failed), needlessly hand-extracted `.result` into a separate file, and fumbled the
`merge-ledger.mjs` invocation — because the skill said only "write the return to a file, then merge",
while `merge-ledger.mjs:59` already unwraps the Workflow envelope (`wrapper.result.ledger_updates ?
wrapper.result : wrapper`). Skill-clarity + a test that locks the unwrap. Suite **34 files / 346
checks** (was 34 / 344). Tag stays **HELD**.

### Hardened
- **Explicit, zero-improvisation merge step (`skills/audit-codebase/SKILL.md`).** Rewrote the merge
  instruction: the Workflow tool already writes its run to a TASK-OUTPUT FILE as an envelope
  (`{summary, result, workflowProgress}`); point `merge-ledger --result` DIRECTLY at that
  task-output file — the engine unwraps `.result` automatically (`merge-ledger.mjs:59`). Do NOT probe
  the file, hand-extract `.result`, or re-parse the envelope. The exact command form is spelled out
  with `--result <workflow-task-output-file>`.
- **Mirrored in the sequential fallback (`harness/sequential-fallback.md`).** The "ledger merge stays
  mechanical" bullet now names the SAME `merge-ledger.mjs` engine and its both-shapes tolerance (raw
  envelope or pre-extracted `{ledger_updates}`), so the no-Workflow substrate gets the same
  point-`--result`-at-the-file-directly guidance.
- **Defensive clear error (`harness/merge-ledger.mjs`).** The line-59 unwrap's downstream guard now,
  when the resolved object has no `ledger_updates` array, exits 2 with a CLEAR error naming BOTH
  accepted shapes (raw Workflow task-output envelope vs pre-extracted result) and telling the caller
  not to hand-extract — instead of the prior terse "no result.ledger_updates array" (which read like
  a bug rather than a shape mismatch). Never a silent empty merge.

### Added
- **Two `test-merge-ledger.mjs` checks (M13, M14; 15 checks total).** M13 — UNWRAP LOCK: a RAW Workflow
  envelope `{summary, result:{ledger_updates}, workflowProgress}` merges to byte-IDENTICAL findings as a
  pre-extracted `{ledger_updates}` (locks the `:59` unwrap so the skill's "point at the raw file" promise
  can't silently regress). M14 — the clear error fires (exit 2, names both shapes) on a `--result` with no
  `ledger_updates`.

### Roadmap
- **WI-C still DEFERRED** (carried from 0.8.17): a deterministic baseline-currency-date harness. The driver
  hand-rolls the currency-date calc and tripped on a token; it does not affect findings. Promote it to a
  pure `harness/*.mjs` + standing test in a later cycle.

## [0.8.17] — 2026-06-24

**Driver-improvisation hardening — make the engine enforce two things a cold run showed the
LLM driver can slip on.** Both are deterministic + test-proven; their effect on cold-run
variance is for the next campaign to measure, not claimed here. Suite **34 files / 344 checks**
(was 34 / 338). Tag stays **HELD**.

### Hardened
- **WI-A — engine-enforced always-on dimensions (`harness/build-audit-engine.mjs`).** The
  assembler built its dimension set from the driver's `scope-input.applicable` verbatim, so a
  driver that forgot a methodology-mandated always-on dimension silently under-covered an
  auto-fail class (a cold run DROPPED `secrets-credentials`, then re-added it by luck). The
  engine now force-injects `ALWAYS_ON = ['sessionid-egress','secrets-credentials',
  'error-handling-disclosure']` (cited to `audit-methodology.md` :77/:78/:91) into EVERY built
  dimension set regardless of scope-input — de-duped (a driver-listed key keeps its
  targets/stackNotes), and an always-on key the driver marked N/A is moved back to applicable
  with a loud stderr `WARN`. Deterministic, fixed set, no LLM. `injection-xss` (:81 — CONDITIONAL,
  "always for the injection half") is deliberately NOT forced. Guarded by `test-build-audit-engine.mjs`
  (A1 auto-inject / A2 na→applicable+WARN / A3 no-duplicate-when-listed; 8 checks total).
- **WI-B — controlled consent decision (`harness/record-consent.mjs`).** The skill recorded
  consent with `--answer "<operator's yes>"`, but the driver passed the raw selected
  AskUserQuestion option label (e.g. "Exhaustive now"), which carries no affirm word → the gate
  stayed false → re-record churn. Added a controlled `--decision affirm|deny` token: when given,
  it is AUTHORITATIVE (`affirmative = decision === 'affirm'`) and the free-text label is recorded
  for the trail but NOT regex-scanned — a controlled selection must not be second-guessed by a
  regex. Invalid `--decision` → exit 2; the exit-0-affirmative / exit-3-otherwise contract and the
  free-text fallback (with its deny-precedence) are preserved; a `deny` decision always wins. Skill
  prose now records consent from a SELECTION via `--decision affirm|deny` in `audit-codebase`,
  `security-review-journey`, and `sequential-fallback`. Guarded by `test-record-consent.mjs`
  (C11 token decides / C12 invalid→exit 2 + CLI exit codes / C13 back-compat + deny-precedence; 13 checks total).

### Roadmap
- **WI-C (DEFERRED — not built this cycle):** a deterministic baseline-currency-date harness. The
  driver currently hand-rolls the currency-date calc and tripped on a token; it does not affect
  findings. Promote it to a pure `harness/*.mjs` + standing test in a later cycle (same
  determinizable-honesty-claim pattern as the other engines).

## [0.8.16] — 2026-06-24

**Phase 1 of the adjudication-drift hardening (Threads 1 & 2).** Targets the run-to-run
instability the ceiling test (0.8.14) exposed: a verified Contact-PII finding wrongly refuted as
"unreachable" across cold runs, and a `viewAllRecords` over-grant wobbling medium/HIGH/medium.
Static / deterministic changes only — their EFFECT on cold-run stability is measured by the next
cold campaign, not claimed here. Suite **34 files / 338 checks** (was 32 / 313). Tag stays **HELD**.

### Hardened
- **Reachability-vs-exposed-surface carve-out for packaged Apex (`apex-exposed-surface` §5/§6).**
  A defined-but-not-wired packaged Apex entry point
  (`@AuraEnabled`/`@RestResource`/`@InvocableMethod`/`@RemoteAction`/`webservice`/`global`/
  `@NamespaceAccessible`) is a SHIPPED surface a subscriber admin can grant or wire post-install,
  so unreachability DOWNGRADES severity (`low`/`info`, "not currently wired", verdict
  `partially_real`) but NEVER yields `false_positive` — mirroring `agentforce-package` §5. Defects
  in the method's OWN authorization (CRUD/FLS, sharing, IDOR, mass assignment) stay real findings.
  Closes the gap that let a verified Contact-PII finding be refuted as "unreachable."
- **Baseline-checked refutations — the v67 auto-enforcement gate (`apex-exposed-surface` §5/§6 +
  `audit-methodology` §3 cross-cut).** A refutation citing "the platform auto-enforces user mode /
  `with sharing` at API 67.0+" is INVALID when the package `sourceApiVersion` is ≤66.0 (the old
  system-mode / `without sharing` defaults hold) — the finding stands. A one-line verifier-loop
  cross-cut now requires checking the package version before accepting that rationale.
- **Least-privilege over-grant severity anchor (`admin-surface` §5).** An over-broad object
  permission (`viewAllRecords`/`modifyAllRecords`/`modifyAllData`) granted via a packaged
  permission set on a sensitive/financial custom object (forecast/revenue/pipeline/snapshot/
  compensation/billing) has a stable HIGH floor — downgrade below HIGH only with a documented
  business justification; ceiling is HIGH (within-org, not cross-tenant; read-only ≠ write bypass).

### Added
- **`harness/baseline-refutation-check.mjs`** (report-only, opt-in, gates nothing) — flags
  `refuted` findings whose reasoning leans on platform auto-enforcement the package's
  `sourceApiVersion` (`--api-version` / `--sfdx-project` / `--scope-manifest`, that precedence)
  does not buy: `<67.0` → invalid, `>=67.0` → valid, null → unknown; `--strict` exits 3 on any
  invalid refutation. Guarded by `acceptance/test-baseline-refutation-check.mjs` (13 checks).
- **`harness/union-convergence.mjs`** (report-only, opt-in, gates nothing) — answers "does the
  union of confirmed loci across N independent runs STOP growing?": cumulative `union_size_series`,
  `marginal_new`, `converged`, `plateau_run`, and a completeness-disclaiming `caveat`. Reuses the
  recurrence engine's locus identity (path-suffix file match + line-span overlap, same OPEN_STATES)
  so a converged union means the same thing both engines mean. Guarded by
  `acceptance/test-union-convergence.mjs` (11 checks).
- **A 5th calibration false-positive pattern** (`acceptance/test-calibration-fp-patterns.mjs`):
  the packaged-surface "a subscriber admin can grant or wire" anchor in `apex-exposed-surface` §6,
  asserted present so the carve-out cannot silently regress out.
- **A prominent BETA disclaimer at the top of `README.md`** — honest beta: reliably finds the
  unambiguous blockers and builds the evidence pack, but the contestable-severity band is an
  incomplete, unstable sample needing repeated runs + human adjudication (links `docs/ceiling-test.md`
  and `docs/recurrence-confidence.md`); no "catches everything / every time," and a passing run does
  not replace the Salesforce security review.

### Changed
- **`acceptance/solano-adjudication-key.md` — C5 reconciled to `high`** (was "medium, defensibly
  low"): a packaged permission set granting `viewAllRecords` on `Solano_Forecast_Snapshot__c` is the
  HIGH-floor least-privilege class; a blind-30-judge calibration ruled the prior `medium`/`low` too
  lenient. The deterministic `test-solano-band.mjs` fixture deliberately KEEPS its seed at `medium`
  (it asserts SCI math/shape, not calibration) — the divergence is documented in the C5 entry.
- **README `Status` reconciled to `0.8.16`** — adds the Phase-1 adjudication-drift component, the
  HELD-tag rationale (effect proven by the next cold run), and the 34-files / 338-checks suite count.
- Docs cross-refs updated for the two new engines (`CONVENTIONS.md`).

## [0.8.15] — 2026-06-23

- **Pre-public file-level polish — docs genericization + CHANGELOG restructure (docs-only).**
  The repo is heading public as a portfolio piece; this is the last file-level pass before the
  separate, operator-run history rewrite. Four changes, no engine or behavior touched:
  (1) genericized the worked example in `docs/recurrence-confidence.md` §3.2 to a role-neutral
  illustration (a service file with two disjoint confirmed defects plus a broad refuted span),
  preserving the interval-transitivity point exactly; (2) genericized the remaining
  synthetic-fixture class/component names in this CHANGELOG to role descriptions (a
  without-sharing controller's detail method, an Einstein summarize/coaching action, an
  access-guard class, a safe-reply enclosure) — the bare `Solano` / `Helios` / `Atlas` fixture
  **umbrella** names stay, since their generators ship in `acceptance/`; (3) restructured the
  single large `[Unreleased]` blockquote into Keep-a-Changelog versioned sections with an
  honest untagged-on-`main` banner, preserving the original change-typed detail verbatim under
  a **Detailed record** section; and (4) reconciled the README `Status` section to current `main` (it
  was stale at `0.8.7` — added the SF-ops safety gate, marked the recurrence skill-wiring shipped, and
  updated the version reference to `0.8.15`). Suite unchanged at **32 files / 313 checks**. Tag stays **HELD**.

## [0.8.14] — 2026-06-23

- **published the ceiling test** (`docs/ceiling-test.md`) — the experiment that REFUTED
  the toolkit's strongest claim, written up as a falsification test rather than buried (the honesty IS
  the value, CONVENTIONS §2). The doc carries: the **hypothesis** ("at exhaustive the full
  generate→verify→synthesize pipeline reliably calls the contestable-severity band"), named distinct
  from the separately-proven "multi-vote stabilizes an ISOLATED pre-identified finding" — the variance
  lives in the pipeline's GENERATION step, not in adjudicating a fixed input; the **method** (N=3 cold
  exhaustive runs over identical Solano-fixture code; a two-axis pass/fail bar committed BEFORE run #1
  and held off-repo so the plugin cache couldn't read it; graded off disk, axes reported separately);
  the **pre-committed bar** ported generically (Axis 1 generation-set stability — every crit/high
  recurs in all 3 AND pairwise Jaccard ≥ 0.70; Axis 2 severity stability + correctness vs blind truth;
  the self-interpreting verdict table) with the findings **role-described**, not named; and the
  **result — both axes FAILED.** As-graded (issue-class key) pairwise Jaccard **0.56 / 0.67 / 0.44**,
  the shipped locus-key engine **0.40 / 0.67 / 0.44** — every pair below 0.70; only **one** high
  (the without-sharing-controller FLS gap) recurs in all 3 runs; the contestable anchors are unstable
  (the view-all over-grant medium/high/medium and mis-called MEDIUM in 2/3 vs blind HIGH; the prompt
  delimiter info/high/low; a real contact-PII high confirmed→refuted→confirmed). Verified mechanism:
  genuine generation churn + a reachability-vs-exposed-surface contestability + severity instability —
  **not** a single false claim. **Verdict:** Axis-2 FAIL → the hard ceiling: exhaustive does NOT
  reliably call the contestable band even at max rigor; the scoped true claim (finds the unambiguous
  blockers + builds the evidence pack; the contestable band needs repeated runs + human adjudication;
  no fixed run-count is complete; SF pen-tests regardless) is why the tag is HELD. Cross-links:
  `README.md` honest-scope section → `docs/ceiling-test.md`; `docs/recurrence-confidence.md` →
  ceiling-test as its motivating result; the doc points back to recurrence-confidence (the product
  response that makes the variance visible) and distinguishes it from `methodology/known-escapes.md`
  (novel-CLASS coverage gaps, not contestable-band stability). **Docs-only**; suite unchanged at
  **32 files / 313 checks**. Tag stays **HELD**.


## [0.8.13] — 2026-06-23

- **sf-ops-gate honesty recalibration + a cheap wrapper gap** (final calibration of the
  0.8.12 hardening). The defect: `timeout` was omitted from the wrapper strip-list, yet the HONEST
  RESIDUAL claimed "only EXOTIC runtime/shell-eval forms still evade" — FALSE (a plain `timeout` wrapper
  is not exotic eval and it evaded). For a fail-closed safety gate whose value IS honesty, the shipped
  claim must be true. **Recalibrated** the residual (hook header + `docs/sf-ops-safety-gate.md`): the
  wrapper list is **best-effort, not a complete shell parser** — an UNCOMMON process wrapper can still
  front a gated op, alongside the exotic eval/substitution forms; dropped the false "only exotic evades."
  **Closed the easy gap**: added `doas` / `stdbuf` / `xargs` / `timeout` / `ionice` / `setsid` to the
  wrappers, with `timeout`'s POSITIONAL duration consumed (`timeout [flags] 60 sf …`, `1m`/`5s`). Tests:
  DENY for `timeout 60` / `doas` / `stdbuf -oL` / `xargs` / `ionice` / `setsid` sf-promote, plus an
  explicit ALLOW + comment for an UNCOMMON wrapper (`chrt`) that stays a documented residual — so the
  honest scope is regression-locked exactly like the exotic-eval locks. +1 check → suite **32 files /
  313 checks**. Consent/scope/deny machinery untouched. Tag stays **HELD**.

## [0.8.12] — 2026-06-23

- **sf-ops-gate classifier hardening** (off-disk 6-skeptic adversarial-bypass grade). The
  hook's architecture was verified sound (consent coupling, managed-repo scope, gate separation,
  fail-closed, no fail-open — all UNCHANGED), but the COMMAND CLASSIFIER leaked ~15 irreversible-op
  bypasses in the forbidden direction (op → ALLOW without consent), several reachable by an honest driver.
  Closed: **CLI identification** (basename + unquote/unescape — `/usr/local/bin/sf`, `./sf`, `"sf"`, `\sf`);
  **wrapper + grouping stripping** (`command`/`exec`/`time`/`nice`/`nohup`/`watch` added; `sudo -u nobody`
  value-flags; `(sf …)`/`{ sf …; }`/`((sf …))`); **`sh -c`/`eval` unwrapping** (best-effort, incl. a
  separator inside the quoted inner command + a chained `… && bash -c "…"`); **separator split** (added
  single `&` + `|&`); **flag-robust verb scan** (skip interspersed flags throughout + match the gated verb
  as a CONTIGUOUS run, so `sf --json … promote` / `sf -o foo package install` / `--json sf …` /
  `sf -- … promote` classify); and **gated-op completeness** (`sf package delete`, `sf package version
  delete`, `sf sandbox create`/`delete`, `npm uninstall -g`/`un`/`rm`). The honest residual TIGHTENS from
  "deliberate obfuscation can evade" to "only EXOTIC runtime/shell-eval forms evade" (`$(…)`/backticks,
  `$CMD`/`${CMD}`, `source <(…)`, base64-decode-eval) — these require running the shell, which a static
  classifier cannot, and stay ALLOW BY DESIGN. A standing **adversarial bypass battery** regression-locks
  ~36 bypass forms (must DENY), a benign no-false-denies set, and the exotic residual (stays ALLOW). +3
  checks → suite **32 files / 312 checks**. Docs: `docs/sf-ops-safety-gate.md`; hook header. Tag stays
  **HELD**.

## [0.8.11] — 2026-06-23

- **the SF-ops safety gate: fail-closed consent enforcement for IRREVERSIBLE Salesforce /
  host operations.** The deployed-package deep-audit skills run live, irreversible ops as prose-only
  Bash (worst: `sf package version promote`, which PERMANENTLY releases a 2GP version that can never be
  removed); a prior full-auto run skipped the consent asks and fanned out anyway. New PreToolUse hook
  `hooks/sf-ops-gate-hook.mjs` (matcher `Bash`, the 2nd hook in `hooks.json`) classifies each command on
  its ACTION VERB and **DENIES** a gated op — inside a `.security-review/`-managed repo — unless an
  affirmative consent for its gate is recorded (`harness/record-consent.mjs`, Phase-1 substrate). **Three
  gates:** `sf-package-promote` (its OWN gate, for the permanent release, with a permanence-emphasizing
  deny), `sf-deep-audit-ops` (version create / install / uninstall, scratch|sandbox create, org delete,
  data delete, deploy), `sf-cli-setup` (`sf org login`, `npm install -g`). **Robust normalization** (the
  adversarial surface): splits on `&& || ; |` + newlines and gates a chain on ANY segment; strips leading
  env-assignments + `sudo`/`npx`; accepts `sf`/`sfdx`, space-verb + colon + `force:*` legacy forms;
  verb-based so read-only verbs (`… version list`, `org list`, `config get`, `--help`) and all non-sf Bash
  pass. **Fail-to-ALLOW** on a malformed/absent payload or out-of-scope cwd — it never blocks arbitrary
  Bash. **Wired into the 6 gated skills** (`bootstrap-cli-auth`, `build-managed-package` [+ a SEPARATE
  permanence ask before promote], `install-and-verify-package`, `audit-deployed-package`,
  `teardown-mcp-registration`, `run-scans`): each couples a mandatory operator `AskUserQuestion` to a
  `record-consent` call and narrows `allowed-tools` to permit it — a skipped ask means the op is denied,
  not silently run. **Honest residual** (documented): a deliberately obfuscated op (base64-eval, `$(…)`,
  variable indirection) can still evade the classifier — "an honest driver running the documented ops is
  gated," not "impossible to bypass." New standing test `acceptance/test-sf-ops-gate-hook.mjs` (22 checks,
  inline payloads, no live sf) + one carried-over recurrence nit (by_file `has_reliable_blocker` false
  branch) → suite **32 files / 309 checks**. Docs: `docs/sf-ops-safety-gate.md`; CONVENTIONS §7/§8. Tag
  stays **HELD**.

## [0.8.10] — 2026-06-23

- **recurrence-confidence wired in end-to-end** (it was built at 0.8.7 but inert — nothing
  produced or surfaced its artifact). Three engine refinements (still pure/deterministic/byte-identical):
  (a) a **commit-consistency honesty guard** — each run's commit = its last pass's `audited_commit`;
  output adds `generated_from.runs` + `summary.commit_consistency` (`consistent`/`mixed`/`unknown`), and
  on `mixed` the caveat warns that an appear/disappear may be a CODE CHANGE (a fix between runs) rather
  than instability — so the fix→re-run loop's output is never misread as drift (descriptive, never gates);
  (b) a **`summary.by_file` rollup** — one row per file with `locus_count`, a `{high,review,investigate}`
  tally, and `has_reliable_blocker`, a presentation view over the per-locus classification (which stays the
  source of truth); (c) an optional **`--repo-root`** display relativization (strip the prefix from emitted
  paths, segment-aware, matching unaffected). **Skill wiring:** `audit-codebase` gains **step 9** — archive
  each independent run's ledger to `.security-review/runs/run-<k>/`, and (≥2 snapshots at the SAME commit)
  run the engine to `recurrence-confidence.json`; sharply distinguished from the fix→re-run step 8, never
  auto-orchestrated, with the honest contract stated (no fixed run-count is complete; the human adjudicates
  the contestable band; SF pen-tests regardless). `compile-submission` step 8 renders an **informational**
  "Finding Stability (N-run consensus)" section from that artifact (or one honest line in the single-run
  common case) that **MUST NOT** change the SCI computation, invocation, or gate — finding-stability never
  inflates readiness or clears a blocker. Three new standing checks (commit-consistency, by_file, repo-root)
  → suite **31 files / 286 checks**. Re-run on the three real ledgers: load-bearing facts unchanged
  (confirmed-per-run 8/6/7; controller-FLS the one reliably-recurring blocker; Jaccard 0.40/0.67/0.44);
  `commit_consistency` reports `consistent` (all three at one commit). Docs: `docs/recurrence-confidence.md`
  §7 "Wiring & usage". Tag stays **HELD**.

## [0.8.9] — 2026-06-23

- **public-readiness scrub** (the repo is heading open-source as a portfolio piece; file-
  level only, no git-history rewrite). Portable defaults in `acceptance/build-run-args.mjs` (plugin
  root resolves from the file's own location via `import.meta.url`; the fixture repo defaults under
  `os.homedir()` — no machine-specific droplet path baked into shipped code). `.gitignore` hardened so
  a contributor can never commit a partner's run-state or findings (`.security-review/`,
  `docs/security-review/`, `.claude/`, `*.jsonl`; verified none are currently tracked). Author droplet
  paths used as **test data** genericized to neutral roots (`/abs/repo`, `/home/user/project`) in
  `test-ledger-staleness-adversary.mjs` — input, repoRoot, and expected tokens changed together, both
  staleness tests re-run green — and the residual prose mention neutralized to "the host product repo".
  New OSS community files in the toolkit's voice: **`SECURITY.md`** (vuln-disclosure policy — honest
  scope: prepares submissions, not a hosted service, no guarantee about your package; report via GitHub
  private reporting or `dev@runverdict.com`), **`CONTRIBUTING.md`** (the green-suite bar, the §2/§3/§4/§9
  rules, conventional commits, Node 18+), and **`CODE_OF_CONDUCT.md`** (Contributor Covenant v2.1). Plus
  **CI**: `.github/workflows/test.yml` runs the full acceptance suite on push/PR (Node 20), a status
  badge on the README, and the Node 18+ prerequisite documented. No code/engine behavior changed; suite
  unchanged at **31 files / 280 checks**. Tag stays **HELD**.

## [0.8.8] — 2026-06-23

- off-disk audit fix-up of the 0.8.7 slice. **(P0 bug) bare-basename over-merge in
  `fileSuffixMatch`**: a single-segment file cite (a bare basename) was treated as a valid suffix of
  any deeper path with the same basename, so `package.json` matched BOTH `frontend/package.json` and
  `backend/package.json` and single-linkage clustering fused three different files into one
  `all_runs` / `confidence=high` locus — false confidence, the forbidden direction (over-merge can
  hide a distinct finding; the M10/M11 lesson). Latent on the Solano data (its basenames are unique
  multi-segment paths) but fixed in the load-bearing matcher: **exact** path equality always matches
  (a root-level `Dockerfile` cited identically still merges), but at **differing depth** the shorter
  segment list must be **≥ 2** (basename + a parent dir) before it counts as a tail — a bare basename
  can no longer bridge. **Two new invariant tests** lock it: the bare-basename non-over-merge (three
  same-basename files in different dirs → three `single_run` loci, plus the identical-`Dockerfile`
  positive) and the **two-phase anti-bridge** (a broad refuted finding overlapping two disjoint
  confirmed defects attaches to one without fusing them — the confirmed-anchored clustering had no
  test). Plus **§3 genericization** of `docs/recurrence-confidence.md` §6 (real fixture class names →
  role descriptions; one provenance line). Re-run on the three real ledgers: load-bearing facts
  **unchanged** (confirmed-per-run 8/6/7; pairwise Jaccard 0.40/0.67/0.44; the controller-FLS the one
  reliably-recurring blocker) — the stricter matcher is a no-op on that data, confirming the bug was
  latent. Suite now **31 files / 280 checks**. Tag stays **HELD**.

## [0.8.7] — 2026-06-23

- the **recurrence-confidence engine** (`harness/recurrence-confidence.mjs`), the first
  build off the Solano refutation: a pure, deterministic, dependency-free engine that takes **N
  independent run-ledgers of the same codebase** and classifies each finding by how reliably it
  recurred — `all_runs` / `some_runs` / `single_run`, with `confidence=high` reserved for the
  `all_runs` + confirmed-every-run + severity-stable set (the **reliably-recurring blocker** set),
  everything else `review` / `investigate` (the contestable band the human owns). Cross-run matching
  is **locus-based** (reusing the now-exported `normFile` / `lineSpan` / `spansOverlap` primitives
  from `finding-clusters.mjs`; `finding.id` is unusable across runs because finder titles drift),
  with path-suffix reconciliation for absolute-vs-relative file cites and **confirmed-anchored
  clustering** so a broad refuted finding can't fuse two disjoint confirmed defects. Per-run
  confirmed counts + pairwise Jaccard are reported as **metrics only** (they gate nothing); the
  standing honesty caveat is embedded (no fixed run-count = complete; SF pen-tests regardless). Run
  against the three real Solano ledgers it reproduces the ground truth — the controller-FLS high
  recurs 3/3 (`confidence=high`), `viewAllRecords` / prompt-delimiter are `all_runs` but
  severity-unstable, the Contact-PII high flips confirmed→refuted→confirmed, pairwise Jaccard
  **0.40 / 0.67 / 0.44** (consistent with the 0.44–0.67 refutation). Standing test
  `acceptance/test-recurrence-confidence.mjs` (15 checks, inline synthetic fixtures); spec in
  `docs/recurrence-confidence.md`. Skill wiring + cold validation pending; the tag stays **HELD**.

## [0.8.4–0.8.6] — 2026-06-22

- the **durable consent coupling**: `record-consent.mjs` + a fail-closed
  audit-launch gate (a skipped consent ask physically cannot launch the audit); the journey +
  audit-codebase gates made mandatory `AskUserQuestion` stops; **four adversarial bypasses closed**
  (second-substrate, forge-asymmetry, isAffirmative-leaks-declines, forgeable belt); and
  `isAffirmative` deny-precedence so a natural "no" never records as consent.

## [0.8.3] — 2026-06-22

- version bump so a cold run pulls the current code (the `plugin update` trigger).

## [0.8.2] — 2026-06-20

- three **calibration false-positive patterns** encoded into verifier guidance from a
  blind 30-judge verification (reachability-is-a-precondition-for-severity; availability ≠
  security; a missing grant is fail-closed, not a vuln); **Track-1b** cross-dimension ledger dedup
  (collapse same-file + overlapping-line-span multi-lens findings into one entry); and a
  **webhook / HMAC-compute-DoS** resource-consumption recalibration.

## [0.8.1] — 2026-06-20

- Solano middle-band fixture Phase-A rebuild + `namespace-check` honest-fix + the
  journey "triage → blocker-policy gate" relabel.

## [0.7.2] — 2026-06-19

- **`namespace-check` — the deep-audit BUILD precondition.** The managed-2GP build is offered
  only when an authed Dev Hub actually carries the package's `namespacePrefix`, so the toolkit
  never offers a build that would fail at `sf package version create` (and mutate the repo
  first); otherwise it shows the prerequisite. Full detail under **Detailed record** below.

## [0.7.1] — 2026-06-19

- **`docker-check` — the throwaway-DAST docker precondition (graceful degradation).** Detects
  Docker (`available` | `absent` | `daemon-down`) and offers the throwaway DAST only when it can
  actually run; else an honest "install Docker once, or DAST stays owner-run" (Docker is a
  *guided* prerequisite, never tmp-installed — it is a privileged daemon). Full detail under
  **Detailed record** below.

## [0.7.0] — 2026-06-19 — last published tag (cold-validated)

- **The autonomous throwaway-DAST harness.** The server-tier analogue of the deployed-org deep
  audit: `stack-detect` classifies whether the external backend can stand up; `standup-stack`
  runs it as an isolated throwaway container (copy-in, synthetic secrets, names-not-values
  manifest, `127.0.0.1`-only); `run-dast` runs a digest-pinned ZAP against that disposable
  mirror and writes self-labelled *local-throwaway* evidence; `teardown-stack` destroys it
  (name-scoped, guaranteed); `scaffold-env` handles a `needs-secrets` stack. 12 adversarial-audit
  findings (several HIGH) were fixed before the tag. Shipped in the unified `0.6.0`+`0.7.0`
  `main` build. Full detail under **Detailed record** below.

## [0.6.0] — 2026-06-19

- **Consented, tmp-scoped scanner install.** `tool-detect` reports which scan tools are present
  vs installable-on-consent; `install-scanners` (the one network-touching engine, fail-closed
  without explicit consent; raw binaries sha256-pinned and verified before exec) installs the
  missing ones to a tmp dir, turning the external-SAST/SCA/secret/TLS families from
  `PENDING-OWNER-RUN` into real evidence; `cleanup-scanners` removes the binaries while keeping
  the evidence. 13 adversarial-audit findings were fixed before validation. Shipped in the
  unified `0.6.0`+`0.7.0` `main` build. Full detail under **Detailed record** below.

## Detailed record & program notes — the 0.6.0–0.8.x arc (untagged on `main`)

The full change-typed detail behind the per-version summaries above, preserved verbatim — the
program-note checkpoints first, then the `Fixed` / `Changed` / `Added` / `Hardened` / `Changed`
/ `Roadmap` record. (Restructured into the versioned sections above in 0.8.15; this section is
the original detail, kept intact.)

> **The load-bearing result (2026-06-23): the Solano cold-at-exhaustive test REFUTED the toolkit's
> strong contestable-band claim.** Three full-pipeline exhaustive runs of identical code, graded
> against a pre-committed bar, showed the contestable-severity band is UNSTABLE run-to-run (Jaccard
> 0.44–0.67; a real high blinking in/out across runs). Honest scope going forward: the toolkit
> **reliably finds the unambiguous blockers and builds the evidence pack**, but the
> **contestable-severity band is an incomplete, unstable sample needing repeated runs + human
> adjudication** — no fixed run-count is certified complete; Salesforce pen-tests regardless. The
> tag stays **HELD** (the claim that would justify it is refuted). **Shipped off this result:** the
> **recurrence-confidence engine** (0.8.7) that makes the run-to-run variance a visible, classified
> output, and (0.8.10) its **end-to-end wiring** — audit-codebase step 9 archives independent runs and
> produces the artifact; compile-submission renders it informational-only (never touching the SCI gate).
> Not yet built: the adjudication-drift fixes (multi-vote-on-drops, baseline-checked refutations,
> reachability-vs-exposed-surface resolve) and a union-convergence test. Suite: 32 files / 313 checks, green.
> **Doc-debt note (resolved by 0.8.15):** the detailed 2026-06-19 note below is the
> prior checkpoint (accurate for its scope). The `[Unreleased]` restructuring into versioned
> sections landed in 0.8.15 (the versioned sections above; this block preserves the original
> change-typed detail verbatim), and the live-SF deep-audit `sf`-ops prose-only-consent gap was
> closed by the SF-ops safety gate in 0.8.11–0.8.13.

> **Release state (2026-06-19).** **`v0.7.0` is tagged + cold-validated** — one full autonomous
> journey on a 0-context seeded fixture (Atlas), graded off disk vs both pass-conditions: the
> consented **scanner install** (0.6.0) and the **throwaway-DAST harness** (0.7.0) + their two
> adversarial-audit hardening passes, all detailed below. `main` is now at **0.8.6**, UNTAGGED —
> ahead of the v0.7.0 tag by the two environment preconditions (`docker-check` 0.7.1 +
> `namespace-check` 0.7.2), the **coverage-gap dimensions (16→19)**, the **Solano
> middle-band judgment fixture** (rebuilt in PHASE A below), a journey-skill
> **triage→blocker-gate relabel** (0.8.1), and the **calibration false-positive patterns**
> (0.8.6 — three verifier-guidance rules from a blind 30-judge verification, below).
> **The Solano cold RE-RUN gates the v0.8.6 tag.**
> Cold run #1 (2026-06-20) validated the TOOLKIT — it correctly caught everything — but exposed
> FOUR unintended fixture defects that landed Solano BLOCKED, so the middle-band JUDGMENT test
> never actually ran; **PHASE A rebuilt the fixture to be genuinely mostly-compliant** (execution-
> identity, prompt-injection, denial-of-wallet, and a deploy-blocking field gap all fixed). The
> 0.7.2→0.8.x bumps are load-bearing, not cosmetic: the installed plugin was last updated at 0.7.2,
> BEFORE the coverage-gap work, so without them `claude plugin update` no-ops and a cold run would
> audit the PRE-coverage plugin — missing the three new dimensions
> (`error-handling-disclosure` / `untrusted-deserialization` / `resource-consumption-abuse`)
> that Solano's calibration depends on (they are its statically-cleared entries).
> **Coverage-gap map: closed** — the two
> default PMD AppExchange rules (the prediction quick wins) are predicted in the baseline +
> dimensions, and **all three new dimensions** shipped — **error-handling-disclosure**
> (verbose-error/secret-log disclosure + fail-open security logic), **untrusted-deserialization**
> (native-object/pickle/prototype-pollution/Apex-sObject deserialize → RCE/priv-esc), and
> **resource-consumption-abuse** (rate-limit/unbounded-read gaps + denial-of-wallet on metered
> Agentforce/MCP/LLM round-trips + ReDoS — API4:2023/LLM10:2025). The **P2 extensions** are
> now in as dimension prose + baseline entries: mass-assignment/BOPLA →
> apex-exposed-surface/mcp-surface, within-org BOLA → tenant-isolation, outbound-callout-trust →
> crypto-internals, system-prompt-leakage + business-logic → agentforce-package. **The
> coverage-gap map's P1 + P2 items are all closed** — only the intentionally-deferred P3
> (XXE / TOCTOU / exotic-MCP cluster) remains. **The middle-band judgment fixture — PHASE 1
> (author + band check) BUILT; cold run #1 done (toolkit validated, fixture had 4 unintended
> defects); PHASE A (fixture rebuild) BUILT.** Remaining: the cold RE-RUN (gates v0.8.6) and the
> DEFERRED **Phase B** — owner-artifact pre-population so the SCI lands 65–75% (today the fixture
> is mostly-compliant in CODE but the SCI stays low/BLOCKED on owner-completable materials — the
> 9% lesson). Other **Roadmap** specs not
> yet built: the throwaway-DAST slice-5b, and **preconditions & guided remediation**
> (`docs/roadmap-preconditions-guided-remediation.md`, NEW) — the "why-blocked, ask-don't-default"
> contract prompted by the Solano preflight offering a deep audit for an uninstallable package
> (a §2 honesty gap: capabilities must resolve to ready | blocked+remediation | needs-input, never
> a silent owner-run). The coverage-gap
> changeset was adversarially audited (5-lens read-only Workflow → 12 raw → 5 confirmed → all
> fixed). Suite: 30 files / 262 checks, green. Earlier checkpoints tagged through v0.5.5.

> **Cold-run key isolation (2026-06-20).** For cold run #1 the sealed adjudication key
> (`acceptance/solano-adjudication-key.md`) was **held off-repo** at `~/solano-adjudication-key.md`
> and removed from `main` for the run window — stronger isolation than the Helios
> `expected-findings.md` precedent, on purpose, because the run's whole value is honest judgment.
> PHASE A **restores the key to the repo and updates it to the corrected post-rebuild reality**
> (the execution-identity bot + the Einstein summarize action are now clean controls; C5 is reframed as a
> SOURCE-permset finding; the Expected-SCI section is rewritten honestly). Re-isolate the key the
> same way before the cold RE-RUN (see the key's *Cold-run isolation* section).

### Fixed
- **`isAffirmative` — catch general negation so natural declines never record as consent
  (0.8.6; engine + test-backed).** DENY-precedence landed in 0.8.5, but DENY lacked bare `not`
  and the n't contractions, so (verified at f446559) "not ok" / "I would not approve this" /
  "we should not proceed" leaked as affirmative, and "won't approve" / "can't allow" /
  "wouldn't consent" would too. DENY now also matches **bare `\bnot\b`** and the **n't
  contractions** (`\b\w+n['’]t\b` — won't/can't/wouldn't/shouldn't/isn't/…), keeping
  deny-precedence (any negation → false). The contraction rule REQUIRES the apostrophe ON
  PURPOSE: the optional-apostrophe form `\w+n['’]?t` would also match `grant`/`consent` —
  both AFFIRM tokens that merely END in "nt" — and false-NEGATIVE a real "I consent" /
  "I grant approval"; apostrophe-less negations ("do not", "dont") are caught explicitly. A
  short comment flags the durable next-hardening (record the SELECTED AskUserQuestion option
  as a controlled `affirm|deny` token instead of scanning free text) — not implemented here.
  `test-record-consent` C9's decline set is extended to lock it, plus the grant/consent
  stay-affirmative guard.
- **Consent coupling — close the 4 adversarial bypasses (0.8.6; 2026-06-22; engine + test-backed).**
  An adversarial pass found the 0.8.4 coupling bypassable four ways. The goal is NOT unforgeability
  (a driver that runs everything can fabricate) — it is that an honest driver cannot ACCIDENTALLY skip
  on EITHER substrate, complying is lower-friction than forging, and a NO never records as a YES:
  - **(1) Substrate parity — the keystone.** The sequential fallback (`harness/sequential-fallback.md`,
    used when the Workflow tool is unavailable) fans out via Task and never calls `build-audit-engine.mjs`,
    so `verifyConsent` never ran — its pre-fix "show the target map" prose had no ask/record/fail-closed.
    Now §3 step 1 runs the SAME gate: ask Step 2/3 via `AskUserQuestion`, record via `record-consent.mjs`,
    `verifyConsent` `audit-tier` + `audit-targetmap`, and launch NO finder Task if either is NOT CONSENTED.
    The consent gate is added to BOTH "survives either substrate" non-negotiable lists (audit-codebase §5 +
    audit-methodology §8.2) and the §1 fallback list. `test-record-consent` C10 fails the build if the
    fallback ever loses the precondition.
  - **(2) Forge asymmetry flipped.** `record-consent.mjs`'s invocation is added to both driving skills'
    `allowed-tools` (`Bash(node *harness/record-consent.mjs *)`), so complying does NOT trip a prompt; and
    `audit-codebase`'s bare `Write` is path-scoped to its legit targets (scope-input/target-map/ledger/
    run-log/pass-*/docs) so it CANNOT target `.security-review/consent/` — consent is written only by the
    engine. The sanctioned record path is now least-resistance; a direct forge needs an out-of-band act.
  - **(3) `isAffirmative` DENY precedence.** Any deny token now fails closed regardless of an affirm token:
    "no, do not proceed" / "do not allow" / "I do not consent" / "please don't go ahead" → FALSE; "yes" /
    "go ahead" / "approve the install" → TRUE (`test-record-consent` C9). A NO can no longer record as a YES.
  - **(4) `consentVerified` belt re-documented.** The check stays, but `workflow-template.mjs`'s comment now
    states plainly that belt #1 (the assembler `verifyConsent`) is the SOLE real boundary and this flag is a
    defense-in-depth tripwire that ASSUMES the assembler was used — JS data, trivially forgeable, no security
    claim — whose only job is to catch an HONEST mistake (an engine that reached the runtime un-gated) loudly.
- **Consent COUPLING — the launch path fails closed on a skipped ask (0.8.6; 2026-06-22; engine
  + test-backed).** A full-auto cold run inferred "silence-is-yes" past its scope and skipped THREE
  mandatory stops — the journey consent gate, audit-codebase Step 3 (show the target map), and Step 2
  (declare the tier + get a go-ahead) — fanning out agents with no ask. Root cause: the interactive
  ASK and the downstream ACTION were DECOUPLED, and silence-is-yes had no hard scope boundary. The fix
  couples them:
  - **NEW `harness/record-consent.mjs`** (pure, deterministic, tested): `recordConsent(gate, answer)`
    writes an affirmative answer to `.security-review/consent/<gate>.json` (gate id, clock-free
    monotonic `seq`, the question, the answer, an `affirmative` flag); `verifyConsent(gate)` is TRUE
    only on a recorded affirmative — missing/negative/empty → FALSE (fail closed).
  - **The durable gate: `harness/build-audit-engine.mjs` verifyConsent's `audit-tier` &&
    `audit-targetmap` before it assembles anything** — exit non-zero, NOTHING written, when either is
    missing. A skipped show-map/tier-go-ahead PHYSICALLY CANNOT launch the audit (no engine = nothing
    for the Workflow tool to run). The Workflow runtime has no filesystem access, so this Node-side
    assembler is the only place the recorded ask can be verified; it stamps `consentVerified`, and
    `workflow-template.mjs` refuses to fan out any agent without that flag.
  - **`install-scanners.mjs` / `run-dast.mjs` / `standup-stack.mjs`**: in ADDITION to `--consent`, the
    CLI now verifies the matching recorded token (`scanner-install` / `throwaway-dast`) — the flag
    alone (driver-set, ask-skipped) is no longer sufficient. The exported functions are unchanged.
  - **`security-review-journey` + `audit-codebase` skills**: the "single gate" markdown-report block
    is replaced by MANDATORY `AskUserQuestion` calls (one per consent), each recorded via
    record-consent; audit Steps 2/3 are MANDATORY recorded `AskUserQuestion` stops (gates `audit-tier`
    / `audit-targetmap`) and re-assert "never `exhaustive` on a first pass" as a hard tier default.
    `silence-is-yes` is HARD-BOUND to the DETECTED-ARCHITECTURE inputs only — never the consent gates,
    never the audit-phase stops — and the "don't wait for a go" / "decide once and I'll launch"
    language is removed.
  - Tests: `test-record-consent` (round-trip, fail-closed-on-missing, monotonic seq, the
    **audit-launch-fails-closed** check, and the scope/gate-shape prose guards); the two tests that run
    the assembler now record the consents in setup.
- **Cross-dimension severity dedup IN the ledger — Track-1b (2026-06-22; engine + test-backed).**
  The Solano cold-at-standard run double-reported ONE root cause — "Missing FLS enforcement in
  a without-sharing controller's detail method" — as TWO HIGH ledger entries, one under
  `apex-exposed-surface` and one under `web-client`. The dedup id is `SHA-256(normalized_file +
  "\n" + normalized_title)`, so two dimensions giving the SAME file but DIFFERENT titles hash
  distinct and never merge. The §5.2 note already said "one root cause → one row at the single
  highest verified severity", but only the per-FILE headline (`finding-clusters.mjs`) enforced it —
  not the ledger.
  - `harness/finding-clusters.mjs` gains an exported, pure, **idempotent** `collapseCrossDimension`:
    two OPEN findings on the same normalized file AND an **OVERLAPPING LINE SPAN** (the ONLY key) but
    DIFFERENT dimensions collapse into ONE entry at the highest verified `adjusted_severity`, with
    every lens's reasoning/evidence preserved (a structured `lenses[]` + a labelled `verdict_reasoning`).
    CONSERVATIVE — same file ALONE never merges, so a genuine second bug at a different location stays
    separate.
  - **Off-disk-grade hardening (2026-06-22): removed the title-symbol merge path.** The grade tested
    `collapseCrossDimension` against the real Solano ledger (line-span path correctly collapsed the
    triple-lens FLS, all at `:21-2x` → kept) and an adversarial case where a title-symbol path
    OVER-MERGED two DISTINCT vulns — a high FLS gap and a critical SOQL injection in `Acct.getDetail`,
    no line spans — into one entry because both titles said `getDetail`. That hides a finding (the
    missed-finding failure), and it has zero upside (every real multi-lens Solano cluster carries line
    spans). So `sameLocation` now merges on **file + overlapping line span ONLY**; `codeSymbols` is
    deleted. Deliberate posture: when two lenses of one issue have non-overlapping/absent spans the
    engine UNDER-merges (noisier headline) rather than risk hiding a second bug — under-merge is the
    safe failure.
  - `harness/merge-ledger.mjs` EXPLODES any prior merged entry back to per-dimension lenses, runs the
    normal per-id merge, then re-collapses — so an incremental re-run that re-finds only one dimension
    never drops the others' audit trail, and one root cause is COUNTED ONCE in the pass stats.
  - `templates/audit-ledger.schema.json`: new optional `merged_dimensions` + `lenses` (a `$defs/lens`)
    on the finding; `methodology/audit-methodology.md` §5.2 updated (collapse is now IN the ledger, on
    overlapping line span only).
  - Tests: `test-merge-ledger` M6–M12 (collapse to one entry at max severity + both reasonings;
    different-location-stays-separate; incremental keeps first_seen; pure idempotency; the **over-merge
    regression guard** M10/M11 — same file + same method in both titles, no/non-overlapping spans →
    stays TWO entries; M12 the 3-dimension real-Solano overlapping-span shape → one entry).
- **Solano fixture rebuild — PHASE A (2026-06-20).** Cold run #1 validated the toolkit (every
  issue correctly caught) but surfaced that the FIXTURE carried four UNINTENDED real defects — all
  author blind spots — so it landed BLOCKED and the middle-band judgment never ran. Rebuilt the
  generator so a re-audit surfaces ONLY the six intended contestable issues (C1–C6), all
  low/medium or dispositioned, ZERO open critical/high:
  - **Execution-identity (was an auto-fail):** the bot was `ExternalCopilot` (a SERVICE agent),
    making its `UserInfo.getUserId()` scoping the VerifiedCustomerId auto-fail. Retyped to
    `EinsteinCopilot` (employee-facing, runs as the prompting user) → `getUserId()` is now correct
    and the bot is a clean control. Action-classification doc updated to match.
  - **Prompt-injection (the Einstein summarize action):** raw `req.context` flowed straight into
    `ConnectApi.EinsteinLLM`. Now fenced in a per-inference cryptographically-random enclosure with
    a data-cannot-override clause (the safe-reply enclosure design) → clean control.
  - **Denial-of-wallet (the Einstein summarize action):** the metered `generateMessages` callout sat in
    an unbounded per-element loop. Now the request count is capped and the per-call input is
    truncated → bounded paid round-trips, clean control.
  - **Deploy blocker:** an Einstein coaching action referenced `Body__c`/`Opportunity__c` (and the
    controller referenced `Opportunity.Forecast_System_Score__c`) with no field metadata → the
    package would not deploy. Added all three custom-field definitions (the master-detail
    `Opportunity__c` satisfies the object's `ControlledByParent` sharing). A build-time
    deploy-cleanliness self-check now fails loud if an Apex-referenced custom field lacks metadata.
- **Namespace honest-fix (PHASE B-adjacent).** Dropped the synthetic `04t` package-version alias
  from the fixture's `sfdx-project.json`: the `04t` was fake AND namespace `solano` is unregistered,
  so a deployed-org deep-audit install would fail. `package-readiness` now reads **`needs-build`**
  and `namespace-check` declines the build offer; C5 is reframed as a SOURCE-permset finding. The
  build-time self-check now asserts `needs-build` (catches a future fake-`04t` regression).

### Changed
- **Webhook / rate-limit resource-consumption calibration — verifier-guidance (2026-06-22;
  NOT-deterministically-test-backed prose, CONVENTIONS §7).** A blind 15-judge multi-vote (3 rounds ×
  5) on the Solano "/webhook lacks rate limiting → HMAC-compute DoS" finding returned
  not-a-finding(9)/low(6) — modal NOT-A-FINDING, ZERO high/medium — while the cold run called it
  HIGH (the same over-fire shape as the three Track-1 patterns). Encoded a §5 verifier sentence +
  a §6 Known-false-positive row in `resource-consumption-abuse`: app-level rate-limiting on a
  webhook/endpoint, and an "HMAC-compute / signature-verify DoS", is `low`/`info` (not `high`/
  `medium`) when the per-request work is cheap (HMAC-SHA256 is microseconds; rate-limiting is the
  gateway/infra layer's job) — it rises to a real finding ONLY when the per-request work is
  EXPENSIVE (bcrypt/scrypt, a heavy unindexed query, an LLM/paid callout) AND unbounded AND
  attacker-triggerable pre-auth. Presence-guarded by `test-calibration-fp-patterns` (the §6 phrase
  can't regress out); the real proof is a future cold run no longer over-firing the webhook.
- **Calibration false-positive patterns — verifier-guidance (0.8.6; NOT-deterministically-test-backed
  prose, CONVENTIONS §7).** A blind 30-judge calibration verification (5 independent judges × 6
  findings, reading only the fixture source) found three CONSISTENT, blind-converged severity bugs
  the verifier over-fired. Encoded each as a §5 verifier sentence + a §6 Known-false-positive row in
  the dimensions where the adversarial verifier reads them, so it refutes/downgrades them next time.
  These are LLM-verifier prose — **not** deterministically test-backed; the real proof is the next
  Solano cold re-run no longer over-firing H1/H2/H4. (A presence test guards the rules from silently
  regressing out — see `test-calibration-fp-patterns` — but does NOT test the judgment itself.)
  - **Reachability is a precondition for severity** (blind H2, 0/5 real — an exported-but-uninvoked
    `snapshot(orgId)` worker scored HIGH). A function/route/handler defined-or-exported with no
    attacker-reachable caller (no wiring, grep finds zero call sites) cannot carry high/critical —
    downgrade to low/info or refute. → `background-jobs`, `tenant-isolation` (§5 + §6) + a
    cross-cutting directionality line in `audit-methodology.md`'s §3 verifier prompt (which preserves
    the agentforce-package exception: a shipped packaged artifact a subscriber admin can bind
    downgrades but never refutes).
  - **Availability/robustness ≠ security severity** (blind H1, 0/5 real — "worker doesn't validate
    `SOLANO_DB_URL` at init" scored HIGH). Failing to validate a non-security config (a DB URL,
    endpoint, flag) at boot is fail-CLOSED on availability (it crashes, no security impact) — low/info.
    Fail-open requires a SECURITY control defaulting to ALLOW. → `error-handling-disclosure` (§5 + §6,
    plus sharpened §1.4 + §4 fail-open so config-validation is explicitly excluded), `secrets-credentials`
    (§5 + §6).
  - **A missing grant is fail-closed, not a vulnerability** (blind H4, 5/5 not-a-finding — "the permset
    doesn't grant the agent-action Apex classes" scored HIGH). A missing permission/grant is
    fail-CLOSED (the feature can't run for that user) — a functionality/packaging gap (info at most),
    never a finding; the security finding is always an OVER-grant, never an under-grant. →
    `agentforce-package`, `apex-exposed-surface`, `admin-surface` (§5 + §6).
- **Cross-dimension single-severity reconciliation note (`audit-methodology.md` §5.2).** A blind run
  surfaced one root cause (a single background-worker source line) at HIGH from `secrets-credentials` AND LOW from
  `error-handling-disclosure`. Added a one-line note: a merged cross-dimension duplicate is presented
  ONCE at the single highest VERIFIED `adjusted_severity` (`finding-clusters.mjs` already does this
  per-file for the headline; the report's per-finding list must reconcile the same way). Prose note;
  no engine change.
- **Journey skill: triage→blocker-gate relabel (0.8.1).** The blocker policy has been automatic
  (no election) since 0.5.2, but the journey step was still named "Triage gate". Renamed the step,
  the AuthN/AuthZ-suppression cross-ref, and dropped the stale "triage" phase from the end-to-end
  phase list (matching the README's canonical journey). Legitimate finding-triage uses
  (quick-tier "a triage", machine-triage, SFGE triage, the informational `triage-decision.json`)
  are unchanged. `plugin.json` → 0.8.1 so a cold re-run pulls the relabel.

### Added
- **Middle-band judgment fixture — "Solano Pipeline Guardian" (Phase 1; 2026-06-20).** The next
  high-value validation artifact after the v0.7.0 catastrophe cold run, per
  `docs/roadmap-middle-band-judgment-fixture.md`. A catastrophe scores near-0 the way a clean
  package scores near-100 — neither needs fine judgment; the product lives in the *band between*,
  where the call between "blocker" and "hardening item" is genuinely contestable. This builds the
  target that forces that call.
  - **`acceptance/generate-solano-fixture.mjs`** (NEW generator, not an extension of the Helios
    one — kept separate so Helios's "every probe fires / scores BLOCKED" recall contract stays
    clean and the band stays governable). Builds a **mostly-compliant** Agentforce managed 2GP +
    companion endpoint on demand into `~/srt-solano` (never committed): `with sharing`, CRUD/FLS
    in user mode, no injection, **no live secrets** (secret-scan-clean by construction, no deleted
    blob), `installable` (a real-shaped non-placeholder `04t` version alias → the deep-audit path
    is exercised; a build-time self-check fails loud if that regresses). Seeded with **6 genuinely
    contestable issues**, each a distinct judgment axis, each with a clean negative near-control
    beside it: C1 severity-boundary (owner-scoped PII read with no explicit FLS — low vs medium),
    C2 tempting FP (a `without sharing` AuraEnabled that LOOKS like IDOR but routes every id
    through a separate access-guard class first — refute), C3 fix-vs-document (a DAST medium —
    missing HSTS behind an edge TLS terminator — acceptable-with-justification), C4 partial
    evidence (a second `worker/` source root the external SAST does not cover), C5 deployed
    artifact (an installed permission set granting `viewAllRecords` on the snapshot object — a
    real, non-catastrophic least-privilege finding), C6 prompt-hardening-middle (a template WITH
    data/instruction separation but a static delimiter, not a per-inference enclosure).
  - **`acceptance/solano-adjudication-key.md`** — the **sealed adjudications** (off-fixture, in the
    repo, never readable from `~/srt-solano`). Per issue: the intended call + why + the
    defensible-consistency bar for the genuinely-50/50 calls, with explicit FAIL modes
    (over-escalation AND under-detection both fail — the point of the middle band). Mirrors the
    `expected-findings.md` off-fixture pattern.
  - **`acceptance/test-solano-band.mjs`** — the **standing deterministic band check** (the gate
    before any cold run; "encode-don't-park"). Hand-authors the representative scope-manifest +
    audit-ledger + evidence-index that a Solano run would produce (the 6 issues dispositioned per
    the sealed key + the realistic mid-prep materials gaps), runs the REAL `compute-sci` against
    the REAL baseline, and asserts the rollup lands at **exactly 71% / `MATERIALS COMPLETE`** —
    90/126 SATISFIED, 8 statically-cleared, 4 PARTIAL, 24 MISSING, 0 open critical/high, all 22
    blocker requirements satisfied, the currency floor correctly silent (materials incomplete).
    A PRIMARY layer (fixed 126-id manifest) keeps the count stable against baseline growth; a
    CORROBORATE layer re-derives the live applicable set and fails loud on a renamed/removed id or
    drift out of a [60,80] sanity band — so the design "can't silently drift" (+10 checks).
  - **NOT a tag / no `plugin.json` bump.** Phase 1 is author + band check only; the cold run that
    would gate a tag is a separate, later session.
- **Coverage-gap adversarial-audit hardening (2026-06-20).** After the coverage work landed, a
  5-lens read-only Workflow (honesty/sourcing · cross-dimension boundaries · technical accuracy ·
  genericization/voice · extraction-contract; hard-anchored to the toolkit repo, the host product
  repo forbidden)
  audited the whole changeset and adversarially verified each finding: **12 raw → 5 confirmed**
  (7 rejected as nitpicks/false alarms). All 5 fixed:
  - **`agentforce-system-prompt-leakage` cited a non-resolving SF URL** (the bare
    `secure_agentforce_prompt_injection.htm`; the real pages are the umbrella
    `secure_agentforce_prompts.htm` + the `_harden`/`_data`/`_enclosure`/`_resources` sub-pages).
    Repointed to the umbrella; dropped the `(doc v262.0)` annotation I had not inspected. (The
    requirement is independently carried by the resolving OWASP LLM07 source; the entry was
    already honestly `web_research_unverified`.)
  - **`Object.assign` was wrongly listed as a JS prototype-pollution source** in
    `untrusted-deserialization` §1 — it is shallow/own-enumerable and not a sink (the file's §3
    grep seeds, §4 finder prompt, and §5/§6 already excluded it). Corrected to name it as NOT a
    source.
  - **`visible_user_ids` (a partner-of-origin INTERNAL variable name) leaked** into the shipped
    `within-org-bola` baseline entry + `tenant-isolation` as "the visible_user_ids pattern"
    (CONVENTIONS §3). Genericized to "an explicit owner/visible-user/subtree filter" everywhere.
  - **"simply" ×2** in the new `error-handling-disclosure` dimension (CONVENTIONS §9 bans the
    word) — removed, plus a pre-existing one in `apex-exposed-surface`.
  - **SOURCES.md registry row for the PMD reference was stale** (last-checked 2026-06-12) vs the
    2026-06-20 `verified_primary` promotion — bumped to 2026-06-20 and now names the two rules.
  - **`acceptance/test-prose-hygiene.mjs`** (4 checks, NEW) — encodes the two recurring-risk
    rules the audit caught: the §9 "simply" ban (methodology prose) + the §3 partner-internal-
    symbol ban (`visible_user_ids`/`app.current_org_id` must not ship in methodology/baseline).
    So the voice/genericization slip class can't recur. Suite 26 → 27 files / 224 → 228 checks.
    *(Test-backed; no cold run — deterministic.)*
- **Coverage-gap closure, P2 extensions (2026-06-20) — authz/trust classes whose GENERAL case
  had no baseline owner, threaded into existing dimensions (no new dimension files).** Closes
  the coverage-gap map's P1.4 + P2.6/P2.8/P2.9/P2.10. **With this, all P1 + P2 items are
  closed** (only the intentionally-deferred P3 cluster remains).
  - **mass-assignment / BOPLA (P1.4)** — `mass-assignment-bopla` baseline + a write-side probe
    in `apex-exposed-surface` §4 (the cousin of the IDOR probe: does a create/update bind a
    caller-supplied whole sObject, letting them set `OwnerId`/status/price/internal fields, vs
    an allowlist/DTO/`stripInaccessible`) and in `mcp-surface` (a permissive tool-param schema
    binding privileged fields). The general per-property write-authz beyond role
    (admin-surface), tenant-id (tenant-isolation), and deserialize (untrusted-deserialization).
  - **within-org BOLA (P2.8)** — `within-org-bola` baseline + a within-org owner/subtree
    sub-probe in `tenant-isolation` §1 + §4, explicitly delineated as the lower-severity
    intra-tenant layer (the service-layer owner/visible-user filter RLS does not catch), distinct
    from the cross-org boundary the dimension owns.
  - **outbound-callout-trust (P2.6)** — `outbound-callout-trust` baseline + a transport-trust
    sub-class in `crypto-internals` §1/§3/§4: outbound TLS validation disabled
    (`verify=False`/`rejectUnauthorized:false`/trust-all `TrustManager`) or a redirect re-sending
    credentials to a new host (CWE-295). Inbound TLS grading never saw the outbound leg; Named/
    External Credentials are excluded (TLS by construction).
  - **system-prompt-leakage (P2.10) + business-logic (P2.9)** — `agentforce-system-prompt-leakage`
    baseline + a prompt-CONTENT probe in `agentforce-package` §4 (a hardcoded secret in a
    packaged `genAiPromptTemplate`, or a guardrail expressed only in prompt text the model is
    trusted to enforce — OWASP LLM07:2025), plus a deliberately-modest out-of-order/abusive-flow
    note (business logic is hard for any tool — kept to a one-line-lead probe).
  - 4 new baseline entries (all `web_research_unverified`, OWASP API/LLM-Top-10 + CWE-derived);
    no new dimension files (19 dimensions) and no new test files — `test-baseline-integrity` +
    `test-dimension-extraction` cover them. Baseline now 165 entries (121 `verified_primary` /
    43 `web_research_unverified` / 1 `conflicting`); suite 26 files / 224 checks.
    *(Test-backed; no cold run — deterministic.)*
- **Coverage-gap closure, new dimension (2026-06-20): `resource-consumption-abuse` (P1.5).**
  The third and last of the new dimensions — and the one for the failure mode a pen-tester hits
  at runtime that no static dimension owned: how much, and how fast. Three shapes:
  **unrestricted consumption** (no rate limit/quota, unbounded page size/read/memory — OWASP
  API4:2023; the reviewer's DAST fuzzes at volume, so an unmetered endpoint is a standard
  finding), **denial-of-wallet** (each Agentforce inference / MCP tool call / LLM callout is a
  *metered, paid* round-trip — an attacker who drives them without a quota runs up the bill;
  OWASP LLM10:2025), and **algorithmic amplification** (ReDoS, decompression/parser bombs,
  unbounded N+1 fan-out, plus the Apex governor-limit self-DoS). Per-stack detection adds an
  MCP/Agentforce row (per-tenant budget? loop/recursion guard? `max_tokens`? callout timeout?)
  and an Apex row (SOQL without `LIMIT`, queries in loops, recursive async). Finder prompt +
  verifier guidance pin the three decisive facts: attacker-reachable trigger, presence of a
  cap/quota/guard, and the per-request *cost*.
  - **`resource-consumption-abuse`** (baseline, `web_research_unverified`) — API4:2023 +
    CWE-1333 (ReDoS); the general rate/quota/unbounded-read bar. Gated `[external-endpoint,
    mcp-server, managed-package]`.
  - **`cost-amplification-denial-of-wallet`** (baseline, `web_research_unverified`) — LLM10:2025;
    metered inference must be quota'd + token-capped + loop-guarded. Gated `[external-endpoint,
    mcp-server, agentforce]`.
  - `audit-methodology.md` §1.2 roster + count: 18 → 19 dimensions; `test-dimension-extraction`
    covers it automatically. **All three coverage-gap new dimensions are now in.**
  - Baseline now 161 entries (121 `verified_primary` / 39 `web_research_unverified` / 1
    `conflicting`); suite 26 files / 224 checks. *(Test-backed; no cold run — deterministic.)*
- **Coverage-gap closure, new dimension (2026-06-20): `untrusted-deserialization` (P1.2).**
  The second of the three new dimensions. No dimension owned object reconstruction from
  untrusted bytes before this (`injection-xss` is query/template-only). It owns three sinks:
  **native-object deserializers** (Python pickle/`yaml.load`, Node `node-serialize`'s
  `_$$ND_FUNC$$_`, Ruby `Marshal`, Java `ObjectInputStream`/`XMLDecoder` → RCE on
  reconstruction), **JavaScript prototype pollution** (`__proto__`/`constructor` deep-merged
  via `lodash.merge`/hand-rolled merges → property injection), and **Apex `JSON.deserialize`
  into sObjects** (caller-tampered `OwnerId`/`RecordTypeId`/status fields reaching DML without
  `Security.stripInaccessible`). Per-stack detection (Python/Node/Ruby/Java/Apex), a finder
  prompt that splits the three sinks and pins the trust-boundary question, verifier guidance
  that pins "trace the input to a trust boundary" + "read for `stripInaccessible` before DML".
  Boundaries: query/template injection → `injection-xss`; the write-authz angle →
  `apex-exposed-surface`/`mcp-surface`; XXE → scanner rule.
  - **`untrusted-deserialization`** (baseline, `web_research_unverified`) — OWASP A08:2021 /
    CWE-502; plain-data formats only over untrusted input, and Apex sObject deserialize must
    strip inaccessible fields before DML. Gated `[managed-package, external-endpoint,
    mcp-server]`.
  - `audit-methodology.md` §1.2 roster + count: 17 → 18 dimensions. The
    `test-dimension-extraction` standing test now covers it automatically (no new test file).
  - Baseline now 159 entries (121 `verified_primary` / 37 `web_research_unverified` / 1
    `conflicting`); suite 26 files / 223 checks. *(Test-backed; no cold run — deterministic.)*
- **Coverage-gap closure, new dimension (2026-06-20): `error-handling-disclosure` (P1.3).**
  The first of the coverage-gap map's three new dimensions — and the one with a live instance
  (a cold-fixture Node error handler that returned `err.stack` on a 401). It owns the
  error/exception path in two halves: **disclosure** (verbose errors, stack traces, framework
  debug pages, secrets/PII in logs — consolidating the previously-scattered `fail-info-disclosure`
  + `endpoint-error-hygiene-debug-off` + `violation-secret-data-in-debug` baseline coverage) and
  **fail-open security logic** (a `try`/`catch` around an authz / HMAC / license / CSRF /
  tenant-binding check whose exceptional branch *grants* access — CWE-636/755, which had no
  baseline owner). Per-stack detection heuristics (Python/Node/Ruby/Java/Apex), a finder prompt
  that prioritizes the stack-trace-on-401 case and reads the *catch body* for fail-open, and a
  verifier-guidance section that pins "read the catch, not the try" and "confirm the throwing
  input is attacker-reachable." Dimension roster + count updated in `audit-methodology.md` §1.2
  (16 → 17 dimensions).
  - **`error-handling-fail-open`** (baseline, `web_research_unverified`) — the new fail-closed
    requirement: a security decision must DENY on any exceptional path, never fall through to
    allow. Default-deny; access requires the check to affirmatively succeed.
  - **`acceptance/test-dimension-extraction.mjs`** (18 checks, NEW) — drives the real
    `build-audit-engine` over EVERY `methodology/dimensions/*.md`, asserting each file's §4/§5
    extraction markers + non-empty finder/verifier prompts. Closes the gap that
    `test-build-audit-engine` only exercised two hand-picked keys, so every current AND future
    dimension is guarded the moment its file lands. (This is the coverage-gap map's standing-test
    discipline made structural.)
  - Baseline now 158 entries (121 `verified_primary` / 36 `web_research_unverified` / 1
    `conflicting`); suite 26 files / 222 checks. *(Test-backed; no cold run — deterministic.)*
- **Coverage-gap closure, quick wins (2026-06-20) — the two default PMD AppExchange rules we
  scanned for but did not PREDICT.** A coverage audit (`docs/roadmap-coverage-gap-map.md`)
  found that while `run-scans` invokes `--rule-selector AppExchange`, the baseline named the
  rule *set* but not these two rules individually — so a partner running this toolkit then the
  real review would get a Code Analyzer hit we never anticipated (the "no-surprises" failure
  the Checkmarx-prediction exists to prevent). Both rule names + severity tiers re-verified
  against the official PMD AppExchange rules reference 2026-06-20.
  - **`violation-feature-management-change-protection`** (baseline, `verified_primary`) — the
    Critical rule `AvoidFeatureManagementChangeProtection`: runtime Apex calling
    `FeatureManagement.changeProtection(...)` to *unprotect* a packaged Feature Parameter =
    license-gate / entitlement tampering. Threaded into the **admin-surface** dimension
    (privilege escalation sub-class + the Apex detection row + the finder prompt) as the
    platform analogue of role escalation.
  - **`violation-getinstance-with-taint`** (baseline, `verified_primary`) — the Moderate rule
    `AvoidGetInstanceWithTaint`: Custom Settings/Custom Metadata `getInstance(userId/profileId)`
    with caller-influenceable Id = an IDOR cross-user config read. Threaded into the
    **apex-exposed-surface** dimension's per-record (IDOR) detection + finder prompt; the safe
    idiom (`getInstance()` / `getOrgDefaults()`) is named.
  - The existing **`scan-pmd-appexchange-rules`** entry is promoted `web_research_unverified →
    verified_primary` (the full ~37-rule set + Critical/High/Moderate tiering re-confirmed
    against the official reference today) and now names both rules. `run-scans` Family 1 names
    them in the load-bearing AppExchange-selector description.
  - **`acceptance/test-baseline-integrity.mjs`** (9 checks, NEW) — a stricter-than-counts
    standing test: every baseline entry's `applies_to` tokens, `severity_if_missing`, and the
    per-entry `verified_primary ⟹ non-null last_verified` / `web_research_unverified ⟹ null`
    implication (which the count-equality test could not catch), plus the two PMD-rule
    predictions' presence (encode-don't-park: a coverage win must not silently regress out of
    the data). Baseline now 157 entries (121 `verified_primary` / 35 `web_research_unverified` /
    1 `conflicting`); suite 25 files / 204 checks. *(Test-backed; no cold run — deterministic.)*
- **`harness/namespace-check.mjs`** (+ `test-namespace-check.mjs`, 3 checks) — the 0.7.2
  deployed-org deep-audit BUILD precondition (a real cold run surfaced the gap; Aiden caught
  it). When `package-readiness = needs-build`, the gate offered "build a managed 2GP first,
  then deep-audit" **without checking the package's namespace is registered to the authed
  Dev Hub** — so for a fictional-namespace fixture it offered a build that would fail at
  `sf package version create` AND mutate the repo with packaging scaffolding first. Now the
  gate confirms feasibility before asking: a namespace is **confirmed-buildable iff an authed
  org carries that `namespacePrefix`** (no CLI lists a Dev Hub's namespace registries
  cleanly, so this is the honest positive signal), and the build is offered ONLY on
  confirmation. It errs **conservative** — unconfirmed = "register + link it first," **never
  a false 'impossible'**. No namespace-corruption risk (a build *uses* a registered
  namespace, never registers/hijacks one; it operates on the package's own declared ns).
  Pure `classifyNamespace` + impure `namespaceStatus`. Validated live: Atlas (`atlas`,
  unregistered) → not-confirmed + the prereq; a `verdict`-namespace repo → buildable.
  `plugin.json` → 0.7.2.
- **`harness/docker-check.mjs`** (+ `test-docker-check.mjs`, 2 checks) — the 0.7.1
  throwaway-DAST environment prerequisite. The containerized throwaway (standup-stack +
  run-dast) needs Docker; this reports `available | absent | daemon-down` so the gate
  offers the throwaway-DAST **only when it can actually run**, and the engines now return
  `status:"no-docker"` with an honest install hint instead of a raw `docker: not found`.
  **Docker is a documented prerequisite, NOT something the toolkit tmp-installs** — unlike
  the userland scanners, it's a privileged daemon needing root-level setup (setuid uidmap
  binaries, subuid/subgid, kernel user-namespace settings) that can't be dropped into a tmp
  dir, so the honest move is to GUIDE the one-time system install and fall back to owner-run
  DAST when it's absent. Pure `classifyDocker` + impure `dockerStatus`. The journey gate's
  third consent now also **discloses the one-time ~3.6 GB digest-pinned ZAP image pull**
  (validated this session: a fresh-machine `run-dast` pulls the pinned image, 2m29s, then
  scans). `plugin.json` → 0.7.1.
- **`harness/tool-detect.mjs`** (+ `test-tool-detect.mjs`, 6 checks) — deterministic
  scan-tool detector: per scan family, which local tools are PRESENT vs
  installable-on-consent vs owner / owner-portal. Detection only — it never installs or
  fetches. The foundation for the 0.6.0 preflight auto-gate.
- **`harness/install-scanners.mjs`** (+ `test-install-scanners.mjs`, 14 checks) — the
  consented, tmp-scoped scanner installer (0.6.0 build step 1). Installs tool-detect's
  `installable_missing` set into `/tmp/sf-srt-scanners/<runid>/` (OUTSIDE the partner's
  repo), records an install manifest, and writes a gitignored project pointer
  (`.security-review/scanner-install.json`) so cleanup can later remove exactly those
  paths while keeping the evidence. Split so the honesty model holds: **`planInstalls()`
  is PURE** (byte-identical plan: per-tool dir, literal commands, pinned URL+sha256, the
  PATH to prepend — what the standing test asserts), **`installScanners()` is the ONE
  harness engine that touches the network** and **fails closed without explicit consent**
  (`--consent`; silence-is-yes never authorizes a network install — the 0.5.4 P0 class —
  and the gate is re-asserted at the engine boundary so a forgetful caller still can't
  install). Per method: `pip`→tmp venv, `npm`→`--prefix`, `git`→shallow clone, `binary`→
  pinned download that is **sha256-verified before it is ever made executable or extracted**
  (a mismatch aborts that tool — an unverified binary is never run). pip/npm/git rest on
  the package manager's own integrity (PyPI/npm/Git-over-TLS); the sha256 pin covers the
  raw binary downloads that have none. Binaries pinned (version + per-platform sha256,
  verified 2026-06-19): **osv-scanner 2.4.0, gitleaks 8.30.1, gosec 2.27.1, trivy 0.71.2,
  nuclei 3.9.0** (raw / tar.gz / zip — zip via `unzip` or a `python3 -m zipfile` fallback
  on hosts without `unzip`); a tool/platform with no pin is **skipped → PENDING-OWNER-RUN**,
  never installed unverified. ZAP is reclassified **owner-run** (a ~hundreds-of-MB Java/JRE
  GUI app, not a pinnable static binary — run-scans Family 3 already treats it as owner-
  executed; nuclei + schemathesis cover the automatable DAST surface). Validated both
  hermetically (git clone from a local repo + `file://` checksum good/bad, zero network)
  and with real network smokes (osv-scanner raw, detect-secrets pip venv, nuclei zip,
  gosec tar.gz — all install + run + checksum-verify on the dev host). The CC permission
  boundary is the outer Bash call, so one approved `node install-scanners.mjs --consent`
  covers every pip/curl/git/npm subprocess unprompted (verified vs the CC permissions/hooks
  docs 2026-06-19) — the mechanism behind "one gate → prompt-free installs".
- **`harness/stack-detect.mjs`** (+ `test-stack-detect.mjs`, 6 checks) — the 0.7.0
  foundation: the deterministic throwaway-DAST-target detector (the server-tier analogue
  of `package-readiness`/`tool-detect`). From a repo it classifies whether the external
  backend can be stood up as a disposable prod-equivalent for an active DAST —
  `runnable | needs-recipe | needs-secrets | n/a` — and classifies each required env var
  as **synthesizable** (a self-contained secret the toolkit generates itself, e.g. a JWT
  signing key — exactly what the prototype did), **external** (a real outside dependency
  the owner must supply → the scaffold-and-guide path), or **benign** (safe default). Pure
  `classifyStack`/`classifyEnvName` core + a dependency-free CLI fact-gather. Smoke-true on
  Atlas (Node forecast API, port 8080, `ATLAS_JWT_SECRET` synthesizable → `runnable`).
- **`harness/standup-stack.mjs`** (+ `test-standup-stack.mjs`, 6) + **`harness/teardown-stack.mjs`**
  (+ `test-teardown-stack.mjs`, 6) — the 0.7.0 slice-3 pair: the server-tier analogue of
  install-scanners/cleanup-scanners. `standup-stack` stands a runnable stack up as an
  ISOLATED throwaway container — encoding the prototype's lessons: **COPY the source into
  the container** (`docker create → cp → start`), never bind-mount it (so the working tree
  is ephemeral inside the container, never root-owned host files); **synthesize the
  self-contained secrets** (random values set on the throwaway → the toolkit can mint its
  own auth tokens for an authenticated scan) with the **values living only in the container
  env and the manifest recording NAMES only**; publish on `127.0.0.1` only; record a
  manifest of exactly the resources created. Fails closed without consent; pure
  `planStandup` + impure executor. `teardown-stack` is the asymmetric, manifest-driven
  remover: it deletes EXACTLY the recorded resources (container/image/network/tmp) and
  keeps the evidence, **name-scoped** so a non-`sf-srt-stack-` docker name is REFUSED (the
  docker analogue of assertSafeTmpRoot — a tampered manifest can never `docker rm` an
  unrelated container), idempotent + guaranteed (works from the manifest alone). Validated
  hermetically (12 checks) + a real Atlas smoke: the engines autonomously stood the Node
  API up (synth secret, `/healthz` 200), then tore it down (container + tmp gone, evidence
  kept, fixture left pristine). This makes the prototype's manual loop real engines.
- **`harness/run-dast.mjs`** (+ `test-run-dast.mjs`, 4) — the 0.7.0 slice-5 payoff: the
  autonomous DAST against the throwaway. Runs **digest-pinned ZAP** (`zaproxy/zap-stable@sha256:7c2f…`
  — the strongest acquisition path: the registry verifies it cryptographically and it bundles
  the JRE) against the URL `standup-stack` published, writes a host-owned copy of the report
  to `<repo>/.security-review/evidence/dast/`, and summarizes it by risk. ZAP runs as root and
  writes its working files root-owned, so the wrk dir lives in its OWN tmp tree and is removed
  via a throwaway root container — neither the project nor stack-teardown ever chases a
  root-owned file. Fails closed without consent; pure `planDast` + `summarizeZap` + an impure
  executor. Validated hermetically (4 checks) + the **full engine-chain Atlas smoke**:
  `standup-stack → run-dast → teardown-stack` produced a real 10 KB ZAP report (4 alerts —
  CSP missing, X-Powered-By leak, …), host-owned, kept through teardown, fixture pristine.
  Unauthenticated baseline this slice; the authenticated, endpoint-fed AF-plan pass (using a
  token minted from the throwaway's own synthesized secret) is the depth refinement (slice 5b).
- **`harness/scaffold-env.mjs`** (+ `test-scaffold-env.mjs`, 3) — the 0.7.0 slice-6
  credential scaffold-and-guide loop for a `needs-secrets` stack (one the toolkit can't
  fully synthesize — a real DATABASE_URL, a third-party key). It writes an env STUB naming
  the required external keys, the operator fills it, and a **deterministic re-check**
  (`envStatus`: a key counts filled only with a non-empty, non-placeholder value; `ready`
  iff all filled) lets the autonomous loop resume. The credential contract (CONVENTIONS §6)
  is load-bearing: the stub lives in the throwaway's **tmp dir, never the repo / not
  `.security-review/`**; `standup-stack` now takes `--env-file` and loads it via docker's
  `--env-file` so the **VALUES go straight into the container — never into argv, the
  manifest, or any state file** — and the tmp dir (values and all) is destroyed at teardown.
  `planStandup` now accepts a `needs-secrets` stack ONLY once a filled env-file satisfies it.
  Validated hermetically (4 checks across scaffold-env + standup) + a real loop smoke
  (needs-secrets repo → stub → WAITING → fill → READY).
- **`harness/cleanup-scanners.mjs`** (+ `test-cleanup-scanners.mjs`, 7 checks) — the
  ASYMMETRIC, manifest-driven teardown (0.6.0 build step 2). Removes ONLY the tmp tool dir
  the install created (`/tmp/sf-srt-scanners/<runid>/`) and keeps every evidence file —
  and the asymmetry is structural, not a careful filter: the tools live under the tmp root,
  the evidence lives under `<repo>/.security-review/evidence/` (a different tree), so a
  single `rm -rf <tmpRoot>` can never reach the evidence (the SCI's on-disk proof). It
  never touches a pre-existing tool (it only knows the paths the manifest recorded). Reuses
  the installer's `assertSafeTmpRoot` as the single safety source: a tampered/garbled
  manifest whose `tmpRoot` is `/`, `$HOME`, or the repo root is **REFUSED — nothing
  removed** (a bad manifest can never become an `rm -rf` disaster). Idempotent
  (`already-clean` on a second run), resolves from the project pointer / `--manifest` /
  `--tmp-root`, and marks the pointer `cleaned` (with `pathPrepend: []`) so run-scans knows
  the tmp tools are gone. Validated hermetically (6 checks: asymmetry, refusal, idempotency,
  nothing-to-clean) + a live install→evidence→cleanup roundtrip (tmp removed, a 75-byte
  evidence file survived byte-for-byte).

### Hardened (post-build adversarial audit of the 0.7.0 throwaway-DAST engines)
A 4-lens adversarial Workflow (credential-leak, docker-safety, honesty/teardown, wiring)
over the new engines surfaced 12 confirmed findings — several HIGH on this higher-stakes
surface (docker + credentials + active scanning). All fixed + test-backed + re-smoked on Atlas:
- **HIGH — credential leak via `docker logs`.** On a failed stand-up `standup-stack` captured
  the partner app's boot output (`docker logs`) into the manifest + stdout — an operator-filled
  external secret echoed at boot (a DSN with a password on a connect error) would land in a
  state file, violating the NAMES-only contract. The capture is REMOVED; on failure the engine
  records only a generic toolkit message, never partner output.
- **HIGH — `run-dast` now enforces a LOOPBACK target.** `planDast` parses the base url and
  fails closed on any non-loopback host (`refusing to active-scan a non-loopback host …`), so
  an active scan can only ever hit a local throwaway — never live prod, a remote host, or
  Salesforce infra. (Validated: it refuses `https://api.example.com`.)
- **HIGH — secrets off the docker argv.** Synth secret values were passed as `-e KEY=value`
  (visible in `ps`); they now go through a `0600` `--env-file` in the tmp dir alongside the
  operator-filled externals — no secret value ever reaches argv.
- **HIGH — guaranteed teardown.** A signal-handler safety net (`SIGINT`/`SIGTERM`/uncaught) in
  `standup-stack` removes the container if its own process is interrupted, and a new
  `teardown-stack --sweep` (name-scoped) removes every orphaned `sf-srt-stack-*` container +
  tmp tree from a crashed prior run — the engine-backed backstop the journey runs at start.
- **HIGH — needs-secrets run-id threading.** The journey now threads ONE run-id through
  scaffold-env → standup → teardown so the filled secret stub lives in the tmp tree teardown
  destroys (a different run-id would have orphaned it); `standup-stack` re-runs the deterministic
  `envStatus` and refuses to stand up on an unfilled env-file.
- **MEDIUM — orphan-on-failure + evidence honesty + grouping guard.** The name-stub manifest is
  written BEFORE `docker create` (deterministic names) so a crash is always teardown-able; DAST
  evidence is renamed `zap-throwaway-local-*.json` with a `README-throwaway-dast.md` stating it
  is NOT the production-equivalent submission scan; `assertSafeTmpRoot` now boxes the
  `sf-srt-stack`/`sf-srt-dast`/`sf-srt-net` grouping dirs too (not just `sf-srt-scanners`).
- **LOW — port validation** (`planStandup` rejects a non-1..65535 port).
- New/extended standing tests lock the fixes (loopback refusal, port validation, the four
  grouping-dir rejections, the sweep, the unfilled-env-file refusal). Suite **22 files /
  187 → 190 checks**, all green; the full hardened chain re-smoked on Atlas end-to-end.

### Hardened (post-build adversarial audit of the 0.6.0 install/cleanup engines)
A 4-lens adversarial Workflow (supply-chain, rm-safety, honesty, wiring) over the new
engines surfaced 13 LOW latent findings (none exploitable today — all pin-/consent-gated);
the real ones are now fixed + test-backed:
- **Degenerate `--run-id` no longer collapses the tmp dir onto the SHARED grouping base.**
  An empty / `.` / path run-id would have made `tmpRoot` = `<tmp>/sf-srt-scanners` (the
  container that holds every run), which cleanup's `rm -rf` would then nuke across
  concurrent runs. `planInstalls` now rejects a non-token run-id, and `assertSafeTmpRoot`
  rejects the bare grouping dir (must be a per-run sub-path). (audit #8 — the one real bug)
- **Only the verified binary lands on the scan PATH.** Archive tools (tar.gz/zip) now
  extract to a scratch `_pkg/` dir; just the intended binary is copied out and the rest
  (LICENSE/README/any second executable) discarded — so a future pin-bump can't silently
  put an extra executable on the scan PATH where it could shadow a system tool. (audit #1)
- **Smaller TOCTOU surface in `/tmp`:** the default run-id gets a `crypto.randomBytes`
  suffix (unpredictable path) and all tmp dirs are created `0700`. (audit #2)
- **`cleanup-scanners` refuses a symlink tmp root** (a real install never makes one) and
  the allowed-deletion bases are snapshotted at module load (a late `TMPDIR`/`HOME` change
  can't widen them). (audit #5/#6)
- `hasCmd` is now a shell-free PATH probe (no `sh -c` string). (audit #3)
- Honesty wording corrected: `planInstalls` is "deterministic / no mutation / no network"
  (it does one read-only realpath, so not literally "no I/O"); the post-install check is a
  "presence + exec-bit" check, not a full run-smoke; `run-scans` verifies each `pathPrepend`
  dir still exists (a reboot wipes `/tmp`) before trusting the pointer. (audit #7/#9/#12)
- Doc counts corrected (`test-install-scanners` is 14 checks, not 13). (audit #4/#10/#11)
- New standing tests lock the safety fixes: degenerate-run-id rejection, grouping-dir
  rejection, extract-to-scratch (only-the-bin-on-PATH), and the cleanup symlink refusal.

### Changed
- **`plugin.json` → 0.7.0.** The version is the `claude plugin update` trigger, NOT
  cosmetic: the updater compares the installed version to the marketplace's `plugin.json`
  version and is a no-op when they match — so building on `main` without bumping left the
  installed plugin stuck at 0.5.5 and a cold run would have tested the OLD code. Bumping to
  0.7.0 (the unified 0.6.0 + 0.7.0 build) makes the update pull the new code. **Lesson:
  bump `plugin.json` before a cold-validation run** (`marketplace update` + `plugin update`
  then pulls it); the git TAG is still the cold-validated release marker.
- **`skills/security-review-journey/SKILL.md` + `skills/run-scans/SKILL.md` — the
  throwaway-DAST engine chain wired into the journey (0.7.0 slice 4).** The preflight
  quick-scan now also runs `stack-detect`; the single gate gains a **THIRD distinct
  consent** — "stand up your backend as an isolated throwaway + active-scan it? yes/no"
  — explicit-yes-only (a live op), surfaced beside the scratch-org / scanner-install
  floor (never silence-is-yes). On yes (and `stack-detect = runnable`), the autonomous
  run invokes `standup-stack → run-dast → teardown-stack` (active scan hits a disposable
  mirror only — never live prod / Salesforce infra / a third party), ALWAYS tearing down
  even on abort, and labels the evidence **local-throwaway** (corroborating + a dry run,
  not the production-equivalent submission scan). `needs-secrets` → the scaffold-and-guide
  loop first; `needs-recipe`/`n/a`/declined → DAST stays owner-run with the generated plan.
  run-scans Family 3 recognizes the throwaway evidence with the same honesty label.
- **`skills/security-review-journey/SKILL.md` — the single up-front consent gate wired in
  (0.6.0 build step 3).** The preflight quick-scan now also runs `tool-detect.mjs` up front
  (Step 4) so the gate states the true scanner situation the first time. The preflight
  report's single gate now carries **two distinct consents**: (1) ask-tolerance
  (full-auto vs guided) and (2) **install the `installable_missing` scanners to a tmp dir
  for this run** — and the install consent is an **explicit yes only** (a network fetch =
  the 0.5.4 P0 class; silence-is-yes never covers it), surfaced alongside the live-probe /
  scratch-org floor, not as a silence-is-yes power-up. On yes the run invokes
  `install-scanners.mjs --consent` before scans and `cleanup-scanners.mjs` after; the
  consent explicitly covers **running** the tools (their standard Semgrep-rule / Nuclei-
  template / OSV-DB fetches), since that is inseparable from producing the evidence.
- **`skills/run-scans/SKILL.md` — consumes the consented tmp install (0.6.0 build step 4),
  and the 0.5.4 HARD BOUNDARY updated.** run-scans still **never installs anything itself**,
  but the consent-gated install now EXISTS as a separate gated step: when the journey gate's
  install-yes ran, run-scans reads `<target>/.security-review/scanner-install.json` (unless
  `status: cleaned`), prepends its `pathPrepend` to the scan-subprocess PATH, and turns the
  external-SAST/SCA/secret/TLS/DAST families from `PENDING-OWNER-RUN` into real evidence.
  Absent the pointer (declined / standalone run), the hard boundary holds in full — absent
  scanner = `PENDING-OWNER-RUN`. The boundary now also scopes the consented scanners'
  standard rule/template fetches as within the install-yes (the cold run's Semgrep/Nuclei/OSV
  fetches are consented, not an unconsented-egress violation).

### Roadmap — 0.6.0 preflight auto-gate + consent-gated scanner install (owner-pitched)
- Specced in **`docs/roadmap-0.6.0-preflight-autogate.md`**. Startup quick-scan (scope +
  `tool-detect` + `package-readiness` + `sf` auth) → ONE up-front consent gate (full-auto
  vs guided; install the missing scanners to a tmp dir for the run, removed at cleanup with
  the evidence kept) → everything downstream "just works" (real DAST/TLS/SAST output instead
  of PENDING-OWNER-RUN). The network install is the 0.5.4 P0 class → explicit consent only,
  test-backed + cold-validated before it ships. Honest constraint recorded: the toolkit
  cannot flip Claude Code's permission mode (shift+tab stays the user's), so it only
  consolidates its OWN confirmations into the single gate.
- **Build progress:** steps 1 (`install-scanners.mjs`) + 2 (`cleanup-scanners.mjs`) +
  3 (wire the single two-consent gate into the `security-review-journey` preflight) +
  4 (`run-scans` consumes the tmp-installed tools; else PENDING-OWNER-RUN) **all done**
  (above). Remaining: (5) cold-validate the gate fires once with two distinct consents +
  real Semgrep/OSV/DAST evidence on disk + cleanup removes binaries and keeps evidence → tag.

### Roadmap — the middle-band "judgment" fixture (post-v0.7.0-validation)
- Specced in **`docs/roadmap-middle-band-judgment-fixture.md`**. The v0.7.0 cold run landed
  at SCI 6% (catastrophe-tier) — a strong recall + honesty-gate proof, but the catastrophe
  and clean cases bracket the *easy* end. The differentiating value lives in the contestable
  middle band (~65–75% SCI): the *almost-ready* package where blocker-vs-hardening is
  arguable, path-to-green is 3 subtle items, and the toolkit must make the call a consultant
  gets paid for. Design: a mostly-compliant fixture + 4–6 contestable issues (severity-
  boundary, tempting-FP, fix-vs-document, partial/stale evidence, near-ready deploy) each with
  a sealed adjudication; grade the cold run on severity calls + subtle-FP precision + the SCI
  band + the path-to-green shape. Honest ceiling: still self-authored (tests judgment-on-
  anticipated, not coverage-of-novel — only a real external review closes that), but precision/
  calibration on the *subtle* case is far more authorship-independent than recall. Also tracked
  there: a large-target scale stress test (the fan-out scales with surface) + slice-5b.

### Roadmap — 0.7.0 throwaway prod-equivalent DAST harness (owner-pitched)
- Specced in **`docs/roadmap-0.7.0-throwaway-dast-harness.md`**. The server-tier analogue
  of the deployed-org deep audit, reusing the 0.6.0 install/cleanup machinery: a third
  up-front consent ("stand up a throwaway prod-equivalent stack + DAST it? yes/no"; either
  answer proceeds autonomously, marked toolkit-run vs owner-run), an auto-resolve →
  clarify loop, and a strict credential contract (discover the env *names* not values;
  consent to read a declared source else scaffold-an-env-stub + guide + confirm + resume;
  secret values never persisted, burned at teardown). Organizing principle:
  *throwaway-everything* — you only ever active-scan your own disposable mirror, never
  live prod / Salesforce infra / anyone else's. New engines mirror 0.6.0:
  `stack-detect` ↔ `tool-detect`, `standup-stack` ↔ `install-scanners`,
  `teardown-stack` ↔ `cleanup-scanners` (asymmetric, guaranteed teardown, keep evidence);
  ZAP folds in as a Docker-digest scan container. Honest ceiling: prod-equivalence is
  bounded by the repo's recipe, and the evidence is labelled with the throwaway's fidelity.

## [0.5.5] — 2026-06-18

The two larger items the 0.5.2 cold run surfaced and 0.5.4 deferred: the SCI must
not grade its own exam (P1), and the per-run audit/merge/index engines must ship in
`harness/` instead of being re-authored by the LLM every run (P2). Both encoded with
standing tests in the same changeset. Suite: 11 files/112 checks → **14 files/134 checks**.

### Fixed
- **P1 — the SCI no longer credits the toolkit's own static clears (anti-self-grading).**
  In the cold run, the (then LLM-authored) evidence index marked auto-fail classes
  (CRUD/FLS, sharing, SOQL-injection, sessionid-egress, XSS) SATISFIED from the toolkit's
  OWN white-box audit, moving the Submission Completeness Index 9%→17% — the tool grading
  its own exam. `compute-sci.mjs` now applies a **reviewer-reproducible credit rule**: a
  requirement counts SATISFIED only on evidence a Salesforce reviewer can independently
  reproduce (a scanner report the reviewer re-runs — Code Analyzer/SFGE/Checkmarx/gitleaks/
  Semgrep/OSV — an owner-signed artifact, or a structural N/A). A clear that rests only on
  the white-box static audit is the new `statically-cleared` disposition: surfaced as a
  separate signal, **never counted toward the completeness %, never clears the blocker
  floor** (Salesforce pen-tests these classes regardless). It **fails closed** — a
  satisfied/verified entry with no `reviewer_reproducible: true` flag is treated as
  statically-cleared, so an over-crediting or hand-authored index under-credits (safe)
  rather than inflating the headline. The clean-package path survives: a reviewer-
  reproducible scanner clear of a blocker class still clears the floor. Grounded in the
  live SF review (Code Analyzer is the tool SF itself runs; SFGE is the only user-mode-
  complete engine for CRUD/FLS), so a scanner clear is reviewer-meaningful while an LLM
  audit conclusion is not part of what the reviewer consumes.

### Added
- **`harness/build-evidence-index.mjs` (P1+P2)** — the deterministic evidence-index
  producer that compute-sci reads. The driver supplies its evidence MAPPING as DATA
  (`evidence-input.json`); the engine assembles `evidence/index.json` and **adjudicates
  the credit rule from the evidence location, never from anything the input asserts** —
  a cleared class backed by a scanner file under `.security-review/evidence/` (on disk) is
  reviewer-reproducible+satisfied; the same class backed only by the `docs/` audit report
  is statically-cleared. Fail-safe: a cleared class pointing at a non-existent scanner file
  degrades to statically-cleared.
- **`harness/merge-ledger.mjs` (P2)** — the mechanical, INCREMENTAL ledger merge (was
  LLM-re-authored and pass-1-only/overwrite each run). Loads the existing ledger, computes
  the dedup ids per `audit-ledger.schema.json`, maps verdicts to states, flips a re-found
  `fixed` entry to `confirmed`+`regression`, tracks first/last-seen across passes, redacts
  credential values, stamps the pass `audited_commit`, and appends `run-log.md`. Accepts
  the audit Workflow's bare result or the `{result, agentCount}` wrapper.
- **`harness/build-audit-engine.mjs` (P2)** — the deterministic assembler (was LLM-
  re-authored). The driver supplies its scoping as DATA (`scope-input.json`: applicable
  dimensions + per-dimension targets/stackNotes + context + N/A); the engine extracts each
  dimension's §4 finder prompt + §5/§6 verifier notes by marker, injects the run-args into a
  project-local `audit-engine.mjs`, and writes `target-map.json`. Shipping the marker
  extraction as tested engine code retires the slice-fragility G5 hardened; it aborts LOUD
  on a missing/malformed dimension file rather than emitting an empty prompt.
- Three standing tests: `test-build-evidence-index.mjs` (5), `test-merge-ledger.mjs` (6),
  `test-build-audit-engine.mjs` (5), plus 5 new P1 credit-rule cases in `test-sci.mjs`.

### Changed
- `templates/evidence-index.schema.json`: added the `reviewer_reproducible` boolean (the
  credit discriminator, set deterministically by the engine, never asserted by an LLM) and
  the `statically-cleared` disposition.
- `skills/audit-codebase/SKILL.md` (steps 5–6) and `skills/compile-submission/SKILL.md`
  (step 8) rewired to **invoke the shipped engines** (write the scope/evidence mapping as
  data → run the engine) instead of hand-assembling/hand-merging/hand-writing the index —
  closing the methodology's "engine code, never an LLM" contradiction that let the per-run
  scripts drift.
- `methodology/audit-methodology.md`, `CONVENTIONS.md` (§7 engine list + §8 layout),
  `README.md`, `acceptance/README.md` updated for the three engines, the credit rule, and
  the 133-check suite.
- `plugin.json` → 0.5.5.

### Validation
- All 14 standing-test files / 134 checks pass off disk.
- **Cold-validated (2026-06-18).** A full-surface fixture (managed package + Agentforce +
  MCP server + external API; ~23 organic planted issues + 5 negative controls) ran the
  autonomous journey end to end → SCI **BLOCKED 5%** (10 open critical / 42 high). Graded
  off disk:
  - **P2 confirmed** — the journey wrote `scope-input.json` + `evidence-input.json` and ran
    the shipped `harness/` engines; NONE of the three were re-authored into `.security-review/`.
  - **P1 confirmed** — audit-only clears were registered `statically-cleared` (not credited),
    `0` satisfied-without-`reviewer_reproducible`; re-deriving `compute-sci` off disk matched
    the run exactly. The 9%→17% self-grading is closed in a live run.
  - Recall complete (incl. the git-history secret via the Family-6 scan); precision `0/5` on
    the negative controls (incl. an injection-resistant prompt template).
  - **G4 live arm-and-deny** — armed, a Write to `authn-authz-flow.md` was DENIED by the
    PreToolUse hook (Claude Code discovered + invoked + honored the deny); disarmed, the same
    write proceeded.

## [0.5.4] — 2026-06-17

Hardening from the 0.5.2 cold-validation run + a parallel adversarial truth-audit
of the 0.5.2/0.5.3 code. Encoded immediately rather than parked (the toolkit's own
"encode the fix, don't remember it" rule). Two larger items the same run surfaced —
the SCI must not credit auto-fail classes from the toolkit's OWN static read, and
the per-run audit/merge/index engines should ship in `harness/` rather than being
re-authored each run — are scoped for the next checkpoint, not this one.

### Fixed
- **Scans never mutate the host or auto-fetch (P0, the cold-run's main finding).**
  `run-scans` now has a HARD BOUNDARY: it **detects** scanners but **never installs**
  them (`pip`/`pipx`/`npm i -g`/`brew`/venv bootstrap all forbidden) and never runs a
  scan that fetches third-party content over the network (e.g. Semgrep pulling
  registry rule packs). An absent scanner — or a scan needing an install/remote
  fetch — is `PENDING-OWNER-RUN` with the exact command. The cold run had
  `pip install`ed Semgrep + detect-secrets (then bootstrapped a venv) and fetched
  rule packs in a full-auto run; `silence-is-yes` authorizes neither. The
  `security-review-journey` consent contract now names installs/network egress
  alongside live-probe + scratch-org as actions that need explicit consent.
  Carve-out: an already-present tool's standard read (`npm audit`, RetireJS's
  bundled DB) is fine. (Consent-gated local install is a planned later capability.)
- **Artifact gate fails SAFE on a malformed ledger.** `computeGate` treated a
  non-array `findings` (a dict/string — the dict-shaped-payload class) as "no
  findings → clean → generate everything", silently fail-OPEN. It now WITHHOLDS the
  AuthN/AuthZ doc when `findings` is present but not an array (null/undefined keep
  the documented "no findings = clean" meaning). The **G4 hook** inherits this and
  also guards explicitly (a parsed-but-malformed ledger → DENY, fail-closed).
- **`package-readiness` no longer false-positives on an unrelated `04t` alias.** The
  `installable` scan matched ANY `04t` version alias in `packageAliases`, so a
  dependency package's alias — or a stale/renamed one — could mark the current
  (source-only) package `installable` and cite the wrong version. It now requires
  the alias key to be bound to the configured package (`${pkgName}` / `${pkgName}@…`).

### Changed
- `methodology/audit-methodology.md` dimension→category table: `crypto-internals`
  secondary is now `authentication/session-management` (JWT verification), reconciling
  the table with the code (`AUTHN_AUTHZ_DIMENSIONS`) and the prose two paragraphs below.
- `security-review-journey` Step 6 (deep audit) no longer hedges it as a "later-release
  capability / not a guaranteed step" — all five lifecycle skills ship; it runs whenever
  the preflight's proactive deployed-org offer is accepted (it's gated by LIVE consent,
  not by being unwired).
- `integration-pass-condition-0.5.2.md`: the brittle "(84)" suite-count annotation is
  replaced with "zero failing files" (the count grows each checkpoint), plus an explicit
  scope note (this bar grades the frozen-cache 0.5.2 behavior; 0.5.3/0.5.4 get their own).
- `acceptance/README.md` standing-tests section refreshed (dropped the stale "all eight"
  + the "STOP mode" description; enumerated the hook / injection / readiness families).

### Tests
- `test-artifact-gate.mjs` +3 (malformed dict/string → withhold; null/undefined/[] →
  clean). `test-authz-gate-hook.mjs` +2 (malformed dict / missing-findings → fail-closed
  DENY). `test-package-readiness.mjs` +1 (unrelated/dependency `04t` alias → needs-build).
  Suite **106 → 112 checks** / 11 files, all green.

## [0.5.3] — 2026-06-17

Preflight accuracy + proactive power-up offers. From watching a live cold run: the
preflight announced "deployed-org deep audit available (sf authed)" but only
discovered the blocker — a placeholder package alias / unbuilt version, i.e. nothing
installable — later, in the scope phase. So it told the operator "I have the auth"
before knowing the auth was moot. (Implemented immediately rather than parked in
notes — the toolkit's own "encode the fix, don't remember it" rule.)

### Added
- `harness/package-readiness.mjs` — deterministic deep-audit install-readiness from
  `sfdx-project.json`: `installable` (a real `04t…` version alias), `needs-build` (a
  2GP package is defined but has a placeholder `0Ho…XXXX` alias / `…NEXT`
  versionNumber / no `04t` alias), or `no-package`. Pure, no deps. Standing test
  `test-package-readiness.mjs` (incl. the exact Lumina placeholder shape →
  needs-build). Suite 100 → **106 checks** / 11 files.

### Changed
- Preflight (`security-review-journey` step 4) now runs `package-readiness` in the
  same pass as the `sf` auth sense, so **all** deep-audit preconditions are gathered
  UP FRONT — `sf` auth is necessary but not sufficient.
- The deployed-org deep-audit power-up is surfaced **proactively and accurately**:
  `installable` → a proactive consent point ("run it?"); `needs-build` → "no
  installable version (<reason>) — build first, then deep-audit?"; `no-package` / no
  auth → N/A. The operator's one up-front decision is fully informed instead of a
  mid-run "wait, the auth won't work" surprise. (A LIVE power-up still runs only on an
  explicit yes — the hard floor; the change is that the offer is true the first time.)

### Validated
- Deterministic core proven by `test-package-readiness.mjs` (6) + a live verdict on
  the Lumina fixture (`needs-build`, exact diagnostic). The preflight's integration
  behavior (gathers up front + offers accurately) is validated in the
  deployed-org-deep-audit coverage run (which needs an installable-version fixture).

## [0.5.2] — 2026-06-17

Triage simplification + a wider, election-independent AuthN/AuthZ withhold. Two
product calls from the 0.5.1 cold-validation run drove this: (1) the toolkit is an
AUDIT tool — it should always produce the full report and never pause to "fix or
flag" (and never offer to fix code — a 0.5.1 run improvised a draft-fixes offer the
skill never contained); (2) the gate had a secondary-category gap (JWT verification)
the grade surfaced. An adversarial pass over the reworked gate then caught a third
gap — session-token egress, the review's own named critical auto-fail class — that
would have generated the AuthN/AuthZ doc over a live hole.

### Changed — the gate is audit-only (no STOP, no fix-first, no election)
- `harness/artifact-gate.mjs` — collapsed STOP/election into auto-proceed: an open
  critical/high → `flagged` (full NOT-READY report, findings carried forward
  verbatim), never STOP, never a fix-first/continue-with-flags election. The one
  honesty line — withhold the AuthN/AuthZ doc over an open authN/authZ
  critical/high — now fires purely from the **ledger**, independent of any election
  (closing the bypass where a missing/non-continue-with-flags election skipped it).
  The `election` field is informational only.
- Skill prose (`security-review-journey`, `generate-artifacts`, `audit-methodology`,
  CONVENTIONS) — removed the fix-first triage option and the halt-on-open-critical
  default; the gate auto-proceeds. Made the identity boundary explicit: the toolkit
  **audits and reports, never pauses to fix, never drafts/suggests/writes code, and
  is read-only on partner source** (per-finding remediation *guidance* in the report
  is the ceiling).

### Added — AuthN/AuthZ withhold coverage (gaps caught by the 0.5.1 grade + an adversarial pass)
- `crypto-internals` → the authN/authZ dimension set (JWT verification: a broken
  alg-pin / claim-validation IS an authentication hole). Surfaced by the 0.5.1 grade.
- `sessionid-egress` → the set (a leaked SessionId is a bearer credential — the
  review's named critical auto-fail class). The methodology dimension→category map
  (which routed it to `communications-security`, contradicting its own category
  *definition* listing egress under authentication) is reconciled to match.
- The dimension membership match now trims+lowercases (a stray serialization
  whitespace can't silently drop the withhold).
- `acceptance/test-artifact-gate.mjs` — rewritten for the new contract (withhold
  fires with no election; no STOP; crypto-internals + sessionid-egress withhold;
  whitespace tolerated; `injection-xss` correctly NOT withheld).
- **G5 — audit-engine pre-launch check hardened.** The launch copies the Workflow
  template, replaces the `const INJECTED = … null` marker with the run-args, and
  validates it parses before running. The old recipe ("`JSON.parse` the slice
  between `const INJECTED = ` and the next `const`") matched the template's own
  header-comment mention of the marker → a false SyntaxError a weak model misreads
  as "injection failed" and aborts a healthy run. New `harness/injection-check.mjs`
  anchors on the real line-start `\nconst INJECTED = {` (string-aware brace match),
  with a decoy-bearing standing test (`test-injection-check.mjs`). Sweep: no other
  slice-parse fragility exists (the `{{…}}` template slots are fill-the-slot, a
  different mechanism; the cwd-during-perl wobble was a session incident, not a
  shipped artifact).
- Deliberately NOT added: `injection-xss` and `secrets-credentials` — inclusion is
  by **defect category, not blast-radius** (documented in the gate + methodology so
  a future change is a conscious one, not a silent re-introduction).
- **G4 — opt-in runtime-independent enforcement hook** (`hooks/hooks.json` +
  `hooks/authz-gate-hook.mjs`, auto-discovered on plugin enable). Backstops the
  AuthN/AuthZ withhold at the tool-call level, so a resume / refactor / direct
  write can't author the doc over a live hole even if it bypasses the skill gate.
  It is a **no-op by default**: it acts only when (a) the write targets the
  toolkit's own `docs/security-review/authn-authz-flow.md` AND (b) the operator
  opted in by creating `.security-review/hook-armed`; every other write exits
  immediately (the partner's unrelated work is never touched). Armed + gate
  withholds → it denies via the documented `permissionDecision: "deny"` (verified
  against current hook docs — exit 0 + JSON, not exit 2); **fail-closed** if the
  ledger can't be read. Reuses `computeGate` so the hook and skill can't disagree.
  Disarm = delete the flag. Defense-in-depth the human opts into, NOT structural
  impossibility. Standing test `test-authz-gate-hook.mjs` (9 checks). Suite 80 →
  **100 checks**.

### Validated
- The deterministic core is proven by the standing tests (**100 green**). The
  end-to-end LLM-loop behavior — the journey auto-proceeds (never halts at triage,
  no fix-offer), the withhold holds from the ledger, G5's anchored assembler
  launches the audit, and the G4 hook actually denies a live write when armed — is
  gated by `acceptance/integration-pass-condition-0.5.2.md`, a fresh cold
  full-journey run before the 0.5.2 tag.

## [0.5.1] — 2026-06-17

Closing the two honest residuals 0.5.0 left open — and the close of the first
was earned by *exercising* the engine, not reasoning about it.

**C1 staleness — the detect-changed-code path, finally run for real.** 0.5.0
shipped `ledger-staleness.mjs` with the fingerprint + no-change path live-proven,
but the path that *flags* a finding whose code changed had only ever run against
clean, hand-written paths in the unit test. Run against the real Lumina ledger it
immediately under-counted — **14/10 where the truth was 15/11** — because three
messy-but-real `finding.file` shapes a live finder actually writes defeated the
normalizer and were silently reported *current* (the worst direction for a
staleness check): comma/range line suffixes (`…:5,15-19`), a single finding citing
**two files** (`…server/index.js:27 and /abs/…/panel.html:7`), and target-absolute
path tokens. The normalizer is rebuilt (`fileTokens`): a conditional multi-file
split (only when `" and "` sits between real file cites, so `Command and Control/`
or `docs/sales and marketing/` is *not* fragmented), a letter-led extension check
(drops version strings like `v2.0`), a broader location-suffix stripper
(`#L7`, `:L5`, `(line 5)`, spaced commas), absolute-token relativization against
the git top-level with an absolute-suffix fallback, and the reported `file` is now
the *matched* changed path (not the first cite). A finding is stale if **any** file
it cites changed.

### Added
- `acceptance/test-ledger-staleness-detect.mjs` — a **hermetic** detect-path test:
  it stands up a throwaway git repo, writes a ledger with the real messy shapes,
  advances HEAD with real commits, and drives the CLI `main()` end to end (the
  git-shelling path the unit test never touched). Red on the 0.5.0 engine, green now.
- `acceptance/test-ledger-staleness-adversary.mjs` — 29 adversarial cases from a
  4-lens skeptic panel (false-positive / false-negative / encoding / crash),
  hand-adjudicated, plus the display + two-file contracts. The panel found a real
  false-positive class the first hardening introduced (the unconditional `" and "`
  split); it is fixed and locked here. Two out-of-domain limitations are asserted at
  their accepted behavior (extension-less bare-filename joins; a Windows repoRoot
  that is a subdir of the git top-level) so a future "fix" is a conscious choice.
- The standing-test suite is now **8 files / 80 checks** (was 6 / 43).

### Validated (no code change — the proof 0.5.0 deferred)
- **C1 detect path, LIVE.** On the real `~/srt-coldstart` fixture: a one-commit
  change to `ForecastService.cls` (+ `.gitignore` run-state hygiene) advanced HEAD
  past the audited commit, and `ledger-staleness` flagged **exactly the 15
  ForecastService findings** as stale while leaving the unchanged `server/index.js`,
  `ForecastController`, and Named Credential findings current — the two-sided bar.
- **fix-first — the gate's positive side, end to end.** 0.5.0 only ever proved the
  *withhold* (negative) side of the artifact gate. On a throwaway copy of the
  fixture, the three root causes + the XSS sink were remediated, then **every**
  confirmed finding was re-verified against the remediated source by an independent
  skeptic (default-to-still-present if the fix can't be quoted). Result: 22 fixed, 3
  honest low/medium residuals kept open → **0 open critical/high** →
  `artifact-gate` flips `flagged`→`clean` (suppress `[authn-authz-flow]`→`[]`) → the
  withheld `authn-authz-flow.WITHHELD.md` is **regenerated** as the real document.
  Staleness also flipped `stale`→`current` once the re-audit recorded the new
  fingerprint. The re-verification is the verifier half of a re-audit (not a full
  finder re-discovery); the deterministic gate flip is the proven mechanism. A
  process note from this run: an *ad-hoc* validation harness that let an agent read
  "the ledger" from the session cwd wandered into a foreign project's
  `.security-review/` — a guard caught it loud; the toolkit's own engine is
  unaffected because it anchors to the target repo (the 0.3.1 REPOSITORY ANCHOR
  discipline is exactly why).

### Changed — repo moved + renamed to the `runverdict` org
- `.claude-plugin/plugin.json` — version `0.5.1`; `repository` / `homepage` / `author`
  URLs → `github.com/runverdict`.
- `.claude-plugin/marketplace.json` — marketplace **`redbeardenduro-plugins` →
  `runverdict-plugins`** (owner → Verdict / `github.com/runverdict`).
- `templates/evidence-index.schema.json` `$id` and the README `marketplace add` command
  → `runverdict`. No `redbeardenduro` reference remains anywhere in the repo.
- **Install path changed** to:
  `claude plugin marketplace add runverdict/sf-security-review-toolkit` then
  `plugin install`/`update sf-security-review-toolkit@runverdict-plugins`. Note: the new
  marketplace name resolves only once this changeset lands on `main` — until merge,
  `main` still advertises `redbeardenduro-plugins` (the marketplace manifest is read from
  the default branch).

## [0.5.0] — 2026-06-16

Cold-start acceptance hardening. Two distinct inputs surfaced the gaps in this
release, and both mattered: **(1)** a 0-context, partner-style run of the whole
journey against a fresh bare-bones managed package (the cold-start exhibited the
behaviors a fixture-based acceptance test structurally cannot), and **(2)** an
**external critical-reader review pass** that named which of them are
publication-blocking — G4 in particular was escalated from "follow-up" to
"the thing that cannot ship" by that second reader, not by the run alone. The
combination is the leverage; neither a green fixture nor a self-review would have
produced this batch. The honesty-critical **determinizable** properties — the
artifact gate (G4), element-precise applicability (G1 data), the baseline counts
(F2), the SCI currency floor + freshness split (A4/A3), cross-dimension de-dup
(G2), and ledger staleness (C1) — are each **encoded as enforced logic with a
deterministic standing test**: 6 self-asserting test files (43 checks) that fail
the build if a refactor silently breaks them. The remaining fixes — the Checkmarx
"run #1 = discovery" framing (D1), the ADDRESSED sub-labels (B1), the `agentforce`
element *detection* (a model-run grep self-check), and the recall-capture wiring
(F4) — are skill/prose changes and are **NOT yet test-backed**: the same residual
class as the G4 lesson (a prose layer is only as strong as the model invoking it).
The first cut of all of this was then run through an **adversarial self-audit**
(skeptics told to assume a bug or overstatement the tests miss), which surfaced
real issues in the new code — including a false-negative in the very G4 gate this
release adds, and an over-stripped SSRF control — all fixed here before release.
That pass, not the summary, is the reason to trust the result.

### Added — deterministic engines + standing tests (no LLM, no deps)
- `harness/artifact-gate.mjs` — the enforced generate-artifacts gate (G4, below).
- `harness/applicable-requirements.mjs` — pure `applies_to ∩ elements` applicability
  computer; scope-submission now uses it for an exact, non-narrated applicable count.
- `harness/baseline-counts.mjs` — deterministic source of truth for the baseline's
  self-description numbers (so they can't drift again).
- `harness/finding-clusters.mjs` — deterministic cross-dimension de-dup for the triage
  headline (G2, below).
- `harness/ledger-staleness.mjs` — the resumption fingerprint check (C1, below).
- `acceptance/test-{artifact-gate,applicable-requirements,baseline-counts,sci,finding-clusters,ledger-staleness}.mjs`.
- `methodology/known-escapes.md` — a seeded-empty, honest recall log ("zero real-review
  outcomes recorded to date"). The one validation the fixtures cannot provide — recall
  against the failure classes the maintainer never thought of — accrues here, one real
  review outcome at a time. `stay-listed` now captures review outcomes into it.
- New `agentforce` architecture element + Bot/GenAiPlugin/GenAiPlanner/GenAiFunction detection in
  scope-submission; `audited_commit` on the ledger `pass` object (schema).

### Fixed — the publication gate (G4)
- generate-artifacts' "open critical/high → STOP; withhold the AuthN/AuthZ artifact"
  rule lived only in the journey's triage **narration** — a resume-into-artifacts (or a
  direct invocation) improvised past it and generated the very AuthN/AuthZ doc the gate
  exists to prevent (it would map a live, unremediated auth hole for the reviewer). The
  gate is now **enforced logic** (`artifact-gate.mjs`), consulted on every entry path;
  the continue-with-flags election is **persisted** to `.security-review/triage-decision.json`
  so a resume re-derives it deterministically; the AuthN/AuthZ doc is withheld (with an
  explicit placeholder) whenever an open finding sits in the authN/authZ category.
- **Precision about what this guarantees (the lesson of G4, applied to its own fix):**
  the gate is now enforced by a script the skills invoke on every entry path — strong,
  and a large step up from prose — but it is **not yet model-independent**. It still
  depends on the model actually running `artifact-gate.mjs` before generating; a future
  resume path, direct invocation, or skill-text refactor that reaches artifact generation
  without invoking it would be the same class of failure, one level less likely. The
  model-independent version is a **PreToolUse hook** that fires on the artifact-write tool
  call itself, regardless of which skill prose led there — the next hardening step, tracked
  as a residual. This release does NOT claim the bypass is structurally impossible; it
  claims it is enforced by a gate the skills invoke and proven against the exact failure
  case. (Overstating the fix to the bug whose lesson was "don't trust the bypassable
  layer" would be the wrong note to ship.)

### Fixed — scope step asserting inapplicable requirements (G1)
- `agentforce-*` and `mcp-*` requirements were gated on the generic `managed-package`
  element, so a plain managed package with no agent and no MCP server was told to satisfy
  Agentforce/MCP requirements it can never meet — manufacturing blockers and distorting
  the SCI. Re-gated 12 baseline entries (10 agentforce-* + 2 mcp-* listing reqs) onto the
  precise `agentforce` / `mcp-server` element tokens; scope-submission now detects an
  `agentforce` element (with a deterministic grep self-check) and computes applicability
  deterministically. Regression-guarded: a plain package drops all of them, a real
  agent/MCP package keeps them. (Deliberately NOT re-gated: `mcpthreat-ssrf-mitigation`
  keeps `external-endpoint` — SSRF is a real risk for any partner-hosted server that
  performs server-side fetches, not only MCP servers; the adversarial self-audit caught
  an over-strip of this one and it was restored.)

### Fixed / Changed — honesty surfaces
- **Currency now costs confidence, not the partner's score (A4):** a new band-level
  currency floor caps the readiness band below MATERIALS COMPLETE when a material share of
  applicable requirements rest on baseline entries verified >180d ago — but it **never**
  decrements completeness % (that would be false-incompleteness, penalizing the partner
  for the maintainer's lag). The two-axes reasoning is documented in `compute-sci.mjs`.
- **SCI freshness split (A3):** `caveated` now reports `stale` (verified-but-aged) vs
  `unverified` (never primary-confirmed) separately — different asks on the partner.
- **Cross-dimension de-dup (G2):** the triage headline now reports the raw count AND a
  conservative clustered view (distinct affected files, file-level critical/high,
  cross-dimension overlap), so the per-dimension fan-out re-finding one root cause under
  several lenses is never presented as that many distinct problems.
- **Resumption integrity (C1):** a resumed run now diffs the repo HEAD against each pass's
  `audited_commit` and flags findings whose files changed since — so a clean verdict is
  never presented against code that has regressed since the audit.
- **Checkmarx framing (D1):** the prediction now states explicitly that it is
  one-directional — Checkmarx runs proprietary queries the local stack lacks and WILL
  flag categories the prediction cannot see; treat portal run #1 as discovery, not
  confirmation. The caveat is echoed into the emitted prediction file's header.
- **ADDRESSED sub-labels (B1):** the reviewer-simulation verdict splits into
  `ADDRESSED-fixed` (a verified remediation, disclosed as resolved) vs
  `ADDRESSED-refuted(FP)` (a non-exploitable finding, disclosed via the FP dossier,
  never as a fix) — so a refuted finding can't be skim-read as fixed.
- **Baseline self-description counts (F2):** corrected the drifted README/SOURCES numbers
  to the deterministic count (155 entries: 118 verified_primary, 36 web_research_unverified,
  1 conflicting) and nulled the 6 WI-19 stub `last_verified` dates (they were never
  verified; null is honest). `baseline-counts.mjs` + a standing test keep prose and data
  in lockstep.
- `compute-sci.mjs` `--plugin` default is now relative (`import.meta.url`), not a
  hardcoded path — portability/cleanliness.

### Validation — clean full-journey integration run (2026-06-16)

A realistic cold-start (a fresh session, `run the security review` against a
managed-package + external-endpoint fixture) drove the whole journey end to end and
confirmed the back half **on the live path**, graded off disk:
- **G4 holds end-to-end** — the continue-with-flags election persisted, the gate was
  consulted (`flagged`, `suppress` exactly `["authn-authz-flow"]`), and generate-artifacts
  withheld the AuthN/AuthZ doc (real doc never drafted) for the correct reason, naming all
  13 open authN/authZ findings — **including A1's regression case** (`web-client` /
  `package-metadata` *secondary*-category findings, the exact class the gate's first
  version let escape).
- **G1 confirmed where the partner reads it** — the compiled SCI returned `BLOCKED`
  (3 criticals as the floor) with **no phantom `agentforce`/`mcp` blockers** in the
  blocker list, not just absent from the upstream scope count.
- **G2 / B1 / D1** rendered correctly live — the cluster view at triage; `ADDRESSED-refuted`
  sub-labels in the reviewer simulation; the Checkmarx "run #1 = discovery" caveat verbatim.
- **Smart-resume** recovered a real mid-run API connection-drop.
- Independent corroboration: Code Analyzer v5 + the Graph Engine (SFGE) — deterministic,
  non-LLM — flagged the **same** IDOR/CRUD-FLS root cause at the **same lines** the LLM
  audit found.

**Precisely what is NOT yet live-proven (kept honest — the lesson of this batch):** C1's
staleness **detection** — flagging a finding whose code *changed* since it was audited.
The `audited_commit` fingerprint stamps, the staleness harness runs, and the *no-change*
case correctly reports "current" — all confirmed live. But the code did not change between
audit and resume this run, so the detect-actual-staleness path remains **unit-test-only**:
a remaining live test, not a closed one. The G4 PreToolUse-hook hardening and the
prose-only fixes (D1/B1/agentforce-detection/F4) remain residuals as noted above.

## [0.4.4] — 2026-06-15

WI-16 + WI-22 — the last two roadmap items. With these the autonomous-orchestration
extensions (gap-audit §3a) are **feature-complete**: the toolkit now runs the whole
journey end to end and tells the partner, deterministically, exactly what to fix and
in what order.

### Added — WI-16: Checkmarx prediction (`run-scans` Family 2)
- The portal Checkmarx scan is owner-gated (auth + upload + 3 runs/version) and is
  never claimed as agent-run. Instead, after Family 1 + the LLM package dimensions,
  run-scans now **maps every confirmed package finding to its likely Checkmarx query
  category** and emits `evidence/checkmarx-prediction-<date>.md` — so the partner's
  three precious portal runs come back with *no surprises*. Honest framing: a
  prediction, never an equivalence. Optional genuinely-headless path: if `CX_APIKEY`
  (a paid CxOne licence) is set, run the real `cx scan create … --report-format sarif`
  as Family 2b; absent it, prediction-only.

### Added — WI-22: path-to-green
- `compile-submission` now writes `docs/security-review/path-to-green.md` — the single
  ordered remediation checklist from the current SCI band to `NO-SURPRISES READY`,
  sequenced **blocker → major → minor**: open critical/high findings (file:line + fix),
  unsatisfied blocker requirements, MISSING/PARTIAL artifacts (incl. the WI-19 policy
  stubs + the reviewer-simulation NOT-STATICALLY-EXAMINED list), and caveated/conflicting
  baseline entries — each tagged with the gate/SCI point it unblocks. A view over
  existing state; an empty path-to-green is what readiness looks like.
- README leads with outcomes (what you get) ahead of the component counts.

## [0.4.3] — 2026-06-15

WI-21 — reviewer-simulation. A new (14th) skill that reframes everything the audit
+ scans found as **what Salesforce Product Security will see**, ranked by the
reviewer's own attack priority. ChatGPT rated "audit AS THE REVIEWER WILL" the
toolkit's strongest idea; this makes it first-class. It introduces no new finding
and no new SCI gate — it is the narrative over the ledger + SCI.

### Added
- **`methodology/reviewer-challenges.md`** — the Product-Security challenge
  checklist: the reviewer's questions + probes, ordered by their attack priority
  (Tier 1 public/guest reach → 2 authz bypass → 3 injection → 4 egress → 5 package
  hygiene → 6 infra/supply-chain), each mapped to the dimension(s)/scan family and
  baseline id that answers it, and the scope element that triggers it.
- **`skills/reviewer-simulation/SKILL.md`** — synthesizes
  `docs/security-review/reviewer-simulation.md`: each applicable challenge marked
  **WILL-FIND** (a confirmed-open ledger/scan entry matches — the reviewer
  reproduces it), **ADDRESSED** (a fixed/refuted entry with evidence — a
  no-surprises disclosure for the FP dossier), or **NOT-STATICALLY-EXAMINED**
  (named pen-test territory, never implied clean). Headed by "the first things the
  reviewer will hit." Filters by manifest elements (no TLS challenge for a
  package-only listing).
- Wired as journey step 7 (after scans/deep-audit, before compile; its
  open-challenge list seeds the path-to-green). Skill catalog + journey diagram
  updated (14 skills).

### Validated
- Against the Helios audit ledger (61 confirmed findings, managed-package +
  external-endpoint): the verdict mapping correctly surfaces Tier-1 guest-reach
  (WILL-FIND), Tier-2 IDOR×16 + VerifiedCustomerId (WILL-FIND), and Tier-4
  third-party-LLM (WILL-FIND) as the headline.

## [0.4.2] — 2026-06-15

WI-19 — the written-policy / org-config artifact pack. Closes the surface where a
submission stalls *after* the code is clean: the questionnaire's written-policy +
org-config materials that no static finder can produce. All six are owner-completed
**stubs** `generate-artifacts` pre-fills from detected facts — policy is a human
deliverable; the SCI counts each SATISFIED only with an owner-signed evidence entry,
never an un-signed stub.

### Added — six policy templates + baseline gates
- **`templates/`**: `incident-response-plan` (incl. the mandatory 24-hour Salesforce
  reporting duty), `data-retention-deletion` (retention per data class +
  deletion-on-uninstall), `disaster-recovery-backup` (RPO/RTO + restore testing),
  `vulnerability-remediation-sla` (time-to-fix by severity + the scan cadence),
  `hosting-architecture` (provider/region/network/prod-access/encryption, **extending**
  the data-flow subprocessor table, not duplicating it), `prior-pentest-attestation`
  (declare prior pen test / Checkmarx / SOC2 / ISO — or an explicit none + compensating
  posture). Authored multi-agent in the toolkit idiom (STATUS-PARTIAL header, `{{slots}}`,
  owner-input markers, provenance footer); secret-scan clean.
- Six baseline gates (`artifact-incident-response-plan`, `-data-retention-deletion`,
  `-disaster-recovery-backup`, `-vuln-remediation-sla`, `-hosting-architecture`,
  `-prior-pentest-attestation`), `applies_to` keyed to listing class, honestly calibrated
  `major` / `web_research_unverified` (toolkit-recommended completeness materials, pending
  per-item confirmation against the login-gated questionnaire).

### Wired — autonomous orchestration
- `generate-artifacts` step 11 auto-drafts the pack from the required-materials matrix for
  the detected listing class, pre-filling from §7/§8 facts (hosts, subprocessors, data
  classes, scan families) and leaving the rest owner-input + owner-signed. Bucket table,
  prerequisites, and description updated. `readiness-tracker` §1.7 carries the rows
  (SATISFIED only when signed).

### Validated
- For an external-endpoint + package scope the six policy ids select into
  `applicableBaselineIds` and read `MISSING` in the SCI (0 satisfied — correctly *not*
  credited until owner-completed + signed). Each template confirmed STATUS-PARTIAL +
  slots + provenance; `hosting-architecture` extends the subprocessor table.

## [0.4.1] — 2026-06-15

WI-17 — the OSS external-surface scanners. The biggest coverage add: the
partner-hosted server tree + its IaC, which Code Analyzer never sees but
Salesforce explicitly pen-tests ("Test Your Entire Solution"), goes from
LLM-read + secret-scanned to mechanically **SAST'd, SCA'd, and IaC-scanned**.
All tools free/OSS. `run-scans` is now eight families.

### Added — two scan families + two extensions (all free/OSS)
- **Family 7 — External SAST:** **Semgrep** (multi-language keystone, custom-rule
  capable) + **Bandit**/**njsscan**/**gosec** per detected language, over every
  non-package source root.
- **Family 8 — External SCA + IaC:** **OSV-Scanner** (multi-ecosystem CVE scan of
  every external lockfile) + **Checkov** (Terraform/CloudFormation/K8s/Dockerfile
  misconfig); **Trivy** is a one-tool substitute.
- **Family 3 (DAST) extension:** **Nuclei** (community CVE/misconfig templates) +
  **Schemathesis** (OpenAPI-driven contract fuzzing, riding the OpenAPI artifact
  `generate-artifacts` already emits) + ZAP OpenAPI import.
- **Family 4 (TLS) extension:** **testssl.sh / sslyze** producing *local,
  deterministic* TLS evidence — the file that **satisfies
  `endpoint-ssl-labs-a-grade` deterministically and clears its `conflicting`
  status** (no reliance on a contested external letter grade).
- Three new baseline gates (`scan-external-sast`, `scan-external-sca`,
  `scan-iac-misconfig`, `applies_to: [external-endpoint]`, `major`) — they
  auto-flow into `applicableBaselineIds` and feed the SCI; a confirmed critical in
  reviewer-reachable server code is a fix-now blocker.

### Fixed
- `compute-sci.mjs` now **fails closed** on an empty/missing scope manifest
  (0 applicable requirements → `NOT READY`, not the prior fail-open
  `NO-SURPRISES READY`).

### Validated (on the seeded Helios fixture — extended with a vulnerable server
route, a CVE-bearing lockfile, a misconfigured Dockerfile + Terraform)
- Semgrep caught the OS command injection (`server/index.js`); OSV-Scanner caught
  14 GHSAs (lodash/minimist/express); Checkov caught the Terraform `0.0.0.0/0`
  security group + public-read S3 and the Dockerfile latest-tag + runs-as-root.
  The scan evidence registers into the evidence index → the three external-scan
  requirements read `SATISFIED` in the SCI; the SAST-found critical flows to the
  ledger → `BLOCKED`. Every probe proven by running the actual tool, not asserted.

## [0.4.0] — 2026-06-15

The **autonomous-orchestration extensions** spine (roadmap §3a, WI-20 + WI-18) —
the dependency root the rest of the 0.4.x work hangs off. Built and wired into the
existing journey so it fires with no manual step; the remaining extensions (WI-17
OSS external-surface scanners, WI-19 written-policy artifacts, WI-21 reviewer-sim,
WI-16 Checkmarx-predict, WI-22 path-to-green) are queued behind it. Provenance:
synthesized from the 2026-06-15 external-review pass (Gemini / ChatGPT / Claude
web), reconciled against the 0.3.1 dimension internals (most reviewer-flagged
code gaps were already covered — see the gap-audit §3a).

### Added — WI-20: the formal evidence model
- **`templates/evidence-index.schema.json`** — every readiness claim, scan family,
  generated artifact, and confirmed finding registers a typed evidence entry
  (`source`, `collected_by` agent/owner/scanner, `verified{value,how}`, `location`,
  `sha256`, `disposition`). Makes the toolkit's implicit HAVE-requires-evidence
  rule explicit data: a requirement is SATISFIED only with a registered, verified,
  on-disk file — no credit for un-evidenced self-attestation. `compile-submission`
  materializes the index from its artifact/evidence inventory.

### Added — WI-18: the Submission Completeness Index (SCI)
- **`harness/compute-sci.mjs`** — a deterministic, explainable readiness number
  that measures *materials + disposition completeness, never pass likelihood*
  (Salesforce pen-tests regardless). Pure rollup, no LLM, no learned weights, no
  network, no dependencies — same inputs yield byte-identical output. It reads the
  audit ledger + the evidence index + the scope-filtered baseline and emits a
  GATED block: a hard **blocker floor** (any open critical finding or unsatisfied
  `severity_if_missing: blocker` requirement → `BLOCKED`), over a 3-part vector
  (coverage `SATISFIED/PARTIAL/MISSING`, disposition of undispositioned
  critical/high, evidence freshness vs the 90-day window + `conflicting` baseline
  entries), a completeness % **explicitly labelled not-a-pass-prediction**, and the
  standing "NOT verified by this toolkit" list. Bands:
  `BLOCKED → NOT READY → MATERIALS COMPLETE → NO-SURPRISES READY`. Honesty by
  construction: never a naked single number, never the % without the gate and the
  not-verified list (CONVENTIONS §2; Claude-web's warning).

### Wired — autonomous orchestration
- `compile-submission` (Phase 5) writes the evidence index, runs `compute-sci`, and
  renders its block at the top of `readiness-verdict.md` and the readiness-tracker
  header (new `{{SUBMISSION_COMPLETENESS_INDEX_BLOCK}}` slot).
- `security-review-journey` surfaces the SCI as the **pre-compile go/no-go signal**:
  `BLOCKED`/`NOT READY` halts and names the blockers; `MATERIALS COMPLETE`/
  `NO-SURPRISES READY` proceeds.

### Validated
- Ran `compute-sci` against the 0.3.1 Helios acceptance run: correctly `BLOCKED`
  (14 open critical findings + 18 unsatisfied blocker requirements), coverage
  5/107 satisfied, disposition 14 critical / 39 high / 14 dispositioned, freshness
  flagged the 1 `conflicting` baseline entry (`endpoint-ssl-labs-a-grade`),
  completeness 5% — and byte-identical on re-run (deterministic).

## [0.3.1] — 2026-06-15

Acceptance-proven release. The 0.3.0 coverage dimensions were validated by a
fresh-context run against a fixture that actually *contains* their failure
classes — and that run found (and this release fixes) two engine-robustness gaps
and one verifier-guidance loophole that would have let a real partner run silently
under-report. The dimension *concepts* were sound; the gaps were all in the shared
engine and the verifier's refute rules.

### Added — the acceptance harness (`acceptance/`)
- **`generate-fixture.mjs`** — builds "Helios Service Agent", a synthetic
  Agentforce managed 2GP seeded with one concrete instance of every probe in the
  three 0.3.0 dimensions, negative controls, and a deleted-but-recoverable
  git-history secret. Synthetic secrets are assembled from parts at runtime so the
  generator itself stays secret-scan-clean; the fixture is regenerated on demand,
  never committed.
- **`expected-findings.md`** — the sealed ground-truth plant list (grading key),
  kept out of the fixture so finders cannot read it.
- **`build-run-args.mjs`** — mechanically performs the `audit-codebase` run-args
  step (extract §4 finder prompt + §5/§6 verifier guidance per dimension, inject a
  project-local engine), with a focused single-dimension re-run mode.
- **`acceptance-report-2026-06-15.md`** — the graded result: `apex-exposed-surface`
  8/8 planted classes, `package-metadata` 10/10, `agentforce-package` caught the
  VerifiedCustomerId/third-party-LLM/confirmation/invocable/LLM-output/logging/
  prompt-hardening classes, Family 6 recovered the deleted secret from history, and
  0 false positives on the 8 negative controls.

### Fixed — engine robustness (`harness/workflow-template.mjs`)
- **Finder repo-anchoring.** A finder could be derailed onto the current working
  directory's *foreign* `scope-manifest.json` (when the engine runs from another
  project's directory) and return "the codebase is not present" — a silent false
  "clean". The shared context now hard-anchors every finder and verifier to
  `REPO_ROOT`, forbids reading the cwd or any foreign manifest, and forbids an
  empty result on a "could-not-find-the-repo" basis. (Surfaced when one finder
  produced 0 findings on a fixture loaded with planted issues; with the fix it went
  0 → 19.)
- **Verifier now receives §5/§6.** The adversarial verifier previously saw only a
  generic "confirm only if the exploit is reachable in real code" prompt and never
  the dimension's own verifier guidance / false-positive patterns — so it
  over-refuted declaration-level metadata violations (exposed message channel,
  `http://`/wildcard trusted host, `position:absolute` in component CSS) on a "no
  live caller / dormant config" rationale the Salesforce static review does not
  apply. The engine now threads each dimension's §5+§6 as a `verifierNotes` run-arg
  and treats declaration-level violations as confirmed-on-declaration (reachability
  sets severity, not validity). Documented in the template header and the
  `audit-codebase` skill so a partner's run threads it too.

### Fixed — dimension verifier guidance (`agentforce-package.md` §5)
- **"Reachability first" no longer reads as license to refute.** A packaged
  `genAiPromptTemplate`/`GenAiFunction`/action that ships in the managed package is
  a reviewer-visible artifact even when not currently wired to a live agent. §5 now
  states that reachability sets *severity* (downgrade to low/info, verdict
  `partially_real`) and **never** issues `false_positive` on a "dead packaged code
  / not currently invoked" basis — closing the loophole by which the under-hardened
  prompt-template finding (AP7/8/9/12) was being dropped.

## [0.3.0] — 2026-06-15

Coverage-completeness release — the recall-defining structural work. A maintainer
coverage-gap audit mapped the toolkit against the *complete* AppExchange/AgentExchange
review surface (the baseline's `fail-*`/`violation-*`/`agentforce-*` corpus + the Top-20 +
the reviewer categories) and found the recall holes were **structural** — whole classes a
real reviewer catches that no dimension or scan family touched. This release closes the four
CRITICAL ones. Built multi-agent (author → adversarial-review, with a "specificity" gate so
every probe is a concrete imperative command, not a vague mention a finder could skip);
engine-wiring done by hand. Honesty posture unchanged: this raises *recall on the known
failure classes* — a no-surprises submission, never a guaranteed pass; Salesforce pen-tests
regardless.

### Added — three new audit dimensions (the toolkit now has 16)
- **`agentforce-package.md`** — the single largest gap closed. Audits the *packaged*
  Agentforce/AI surface (GenAiPlanner/Plugin/Function, prompt templates, Bot, invocable-Apex
  actions) **independent of whether an MCP server exists** — so a managed-package-only
  AgentExchange listing is no longer un-audited. Covers the BLOCKER auto-fail classes
  (`VerifiedCustomerId` scoping, user-controlled record refs, third-party-LLM-in-package),
  prompt-injection hardening, LLM-output-as-taint, action classification + per-action
  CRUD/FLS, confirmation-required, prompt/response logging.
- **`package-metadata.md`** — the metadata/XML violation class no code-AST dimension reads:
  Locker apiVersion <40, LMC `isExposed`, JS-in-Salesforce-domain (`onClickJavaScript`
  weblinks, `REQUIRESCRIPT`), CSS-isolation (`position:absolute/fixed`), static-resource
  hotlinking, open-redirect `PageReference`, CSRF `confirmationTokenRequired`,
  RemoteSiteSettings/CspTrustedSites inventory, sensitive-info-in-URL.
- **`apex-exposed-surface.md`** — the exposed-entry-point authorization surface Code
  Analyzer path-traces but doesn't reason about: `@AuraEnabled`/`@RestResource`/`webservice`/
  `@InvocableMethod`/`global`/guest-reachable Apex — should it be exposed? per-record/IDOR
  authz? over-exposure? (Complements, never duplicates, SFGE's structured CRUD/FLS dataflow.)

### Added — new scan family
- **`run-scans` Family 6 — Secret scan (working tree + full git history).** Closes the gap
  where the checklist *asserts* a secret-scan evidence file that nothing produced. Mechanical
  gitleaks/trufflehog over every source root + IaC paths AND full history (deleted-blob
  surfacing — the `git log --diff-filter=D` heuristic becomes a real tool invocation), gated
  on `fail-hardcoded-secrets`, backing `artifact-credential-storage-attestation`. Keeps the
  private-repo-history vs submitted-surface distinction + a rotation-evidence field, and
  states the mechanical-scanner ceiling (misses custom-format/low-entropy secrets — the
  `secrets-credentials` LLM finder is the standing complement).

### Wired
- `audit-methodology.md` §1.2 applicability matrix + §4.1 dimension→category table + §6
  pass-1 band; the "Packaged Apex is not a dimension" note reconciled (structured CRUD/FLS
  dataflow stays Code Analyzer; should-this-be-exposed/per-record-authz + metadata violations
  are now dimensions). `CONVENTIONS §8` repo layout. So the engine **auto-selects** the new
  dimensions on detection — a fresh skill-guided run includes them with no manual step.

### Notes
- Remaining roadmap: 0.2.2 quick-wins (Code-Analyzer engine-selection by element, RetireJS
  over static resources, Apex-test-coverage gate, injection-xss SOSL/open-redirect, ZAP
  error-hygiene/header probes, agentforce metadata-lint, compile-submission gates) + the
  HIGH/MEDIUM probes. Two cosmetic minors deferred (an inlined §4.1 subsection that restates
  the now-authoritative central table; one host-anchored grep seed).
- **Acceptance test pending:** a fresh-context run against a fixture containing a packaged
  Agentforce agent + LWC/Aura + Flows + a git-history secret, to prove the toolkit (not a
  clever operator) auto-fires the new dimensions.

## [0.2.1] — 2026-06-13

Fixes from the first **fresh-window end-to-end run** of the autonomous flow against
a from-scratch test fixture (a generic ISV repo the toolkit had never seen). The
run drove correctly through preflight → scope → audit-launch and the engine
self-recovered from the issue below, but these are the seams worth closing so the
next partner doesn't hit them.

### Fixed
- **`audit-codebase` engine launch is now robust, not just recoverable** (the #1
  fix). The launch step was ambiguous ("inject the placeholder *or* the runtime
  binds `args`"), which led to passing run-args via the Workflow `args` parameter
  — where they arrive as a JSON *string*, `args.repoRoot` is undefined, and the
  run fails fast with "run args missing or incomplete" (0 agents). The step is now
  unconditional: **always** copy the template to
  `<target>/.security-review/audit-engine.mjs`, replace the `INJECTED` placeholder
  with the JSON run-args, and run that copy via `scriptPath` — never the `args`
  param (which remains only a safety net). Mirrored in the template header.
- **`node --check` caveat documented.** The template's top-level `return {…}` is
  legal in the Workflow runtime's async scope but `node --check` reports it as an
  "Illegal return statement." Both `audit-codebase` and the template header now
  state this is expected and must not be "fixed" — to pre-check, `JSON.parse` only
  the injected object, not the whole module.
- **Deterministic applicable-count** (`scope-submission`): report the count as the
  exact length of the compiled `applicableBaselineIds` list, never an estimate; an
  "applicable" count exceeding the baseline total is a counting bug.
- **Baseline-currency ranking** (`security-review-journey` preflight): rank by the
  newest **non-null** `last_verified` (a `null` must never sort ahead of a real
  date — a naive `sort | tail` misreports a fresh baseline as stale), and report
  the verified-count + newest date separately from the unverified (null) count.

### Added
- **README "Running it hands-off (permissions)"** — a recommended read-only
  allowlist for `.claude/settings.json` (only non-destructive sensing; no writes,
  nothing live) and a note that the multi-agent audit runs smoothest with
  auto-accept on for the run's duration (some finder commands like
  `find … -exec grep` can't be covered by a prefix allowlist). The optional
  deployed-org deep audit and any live probe always pause for consent regardless.

## [0.2.0] — 2026-06-13

The autonomous release. The toolkit goes from a set of à-la-carte skills to a
single, fully-orchestrated autonomous flow: say "run the security review" and a
cheap preflight scan reports what it found, what it actually needs, and what
optional power-ups apply — then it runs the whole journey to a complete,
downloadable submission package, pausing only at genuine safety gates. Built by
multi-agent authoring with an adversarial-review pass on every component, then
fixed and re-verified. The honesty posture is unchanged and non-negotiable: it is
read-only on your source and never claims you "will pass."

### Added
- **Autonomous, preflight-gated orchestrator** (`security-review-journey`,
  rewritten from router to driver). A universal preflight detects architecture
  (and reads the Dev Hub when `sf` is authed), emits a three-tier report
  (✓ detected · ⚠ audit-blocking needs · ✦ optional power-ups), then drives
  scope → audit → artifacts → scans → compile autonomously. The only hard stops
  are an audit-blocking missing input and consent before touching anything live;
  open critical/high findings halt-and-report by default (continue-with-flags is
  an explicit operator election). Broadened triggers so natural phrasings
  activate it; router/"where are we" behavior preserved.
- **Dev Hub auto-resolution** in `scope-submission`: with an operator-consented
  `sf` connection it auto-answers ~a dozen inputs from the Tooling API
  (released/coverage/validation-skipped, `IsSecurityReviewed`, the
  RemoteSiteSettings + CspTrustedSites external-endpoint inventory that becomes
  the DAST target list, the permission matrix, Named/External-Credential
  topology, test-org security posture) into `sf-autoresolve.json` — with a
  `describeSObject`-first guardrail. Submission/business acts stay
  Partner-Console-only. Adds a listing-direction (A/B) classifier that branches
  the MCP auth rules (outbound `client_credentials`-OK vs inbound ECA+PKCE).
- **Submission-package assembler** in `compile-submission`: assembles
  `docs/security-review/submission-package/` with an `INDEX.md` mapping every
  artifact to its exact Security Review Wizard step + upload slot, a
  `PENDING-OWNER-RUN.md` handoff, and conditional slot suppression (no empty
  Desktop/Mobile slots).
- **Eight-category report spine** (authN/session · authZ CRUD-FLS+sharing ·
  input-validation · output-encoding · crypto · comms-security · logging/error ·
  secrets-storage) across the audit report, and **agent/ForcedLeak detectors**
  in the MCP threat-model dimension (output-egress allowlist, stale/expired
  allowlisted-domain exfil, untrusted-CRM-text-as-instructions).
- **Optional `sf`-CLI-gated deployed-org deep audit** — five lifecycle skills
  brought in and adapted (à-la-carte → orchestrated): `bootstrap-cli-auth`,
  `build-managed-package`, `install-and-verify-package`,
  `teardown-mcp-registration`, and the new `audit-deployed-package`. They stand
  the package up in a throwaway org and audit the *deployed* artifact (the
  reviewer's own test): least-privilege grants as a subscriber gets them
  (including install-time UEC grant-drop verification), Graph-Engine CRUD/FLS on
  the installed package, callout resolution, and install+uninstall integrity.
  Self-contained (no runtime dependency on any other plugin); the four reused
  skills were authored by this toolkit's author and contributed to
  `mvogelgesang/sf-mcp-partner-toolkit` — attributed in the new `CREDITS.md`.

### Notes
- Validated end to end by a fresh-context run against a real production codebase
  on 2026-06-13 (see Status in the README).
- Honesty/genericization guardrails enforced: the public repo carries no
  references to private design/research docs, no perishable fee literals (the
  fee lives in the baseline), and the leakage sweep is clean.

## [0.1.1] — 2026-06-13

First fine-tuning pass driven by a **fresh-context end-to-end validation run**: the
toolkit was executed cold against a real production codebase (a multi-tenant FastAPI +
Postgres row-level-security backend with an OAuth 2.1 authorization server, a partner-
hosted MCP server, and two thin 2GP managed packages — a Canvas-on-ECA embed and an MCP
registration package). The audit engine performed well — from an empty ledger it
re-discovered every known-open finding, refuted 4 of 9 candidate findings against the
source with precise code evidence (zero unverified), did not re-confirm a single
already-fixed item, and surfaced real findings a prior hand-built audit had under-rated;
the generated artifact pack matched a hand-built reference pack on substance and exceeded
it on honest open-gap flagging and tool-count reconciliation. The changes below are the
refinements that validation surfaced.

### Changed
- **scope-submission: the manifest's `package` block is now `packages[]` (an array).**
  An AgentExchange MCP listing commonly ships **two** packages — a thin MCP-registration
  package (ESR + External/Named Credential + permission set) *and* a separate Canvas/UI
  embed package — which the previous single-`package` schema could not represent. The
  step-7 schema example and the surrounding prose now record each detected package as its
  own entry.
- **scope-submission: `canvas` added to the endpoint `role` enum** in the manifest schema
  example (was `mcp | identity | web-app | api`), since Canvas is a first-class scoped
  element with its own audit dimension.
- **secrets-credentials dimension: sharper review-gating guidance on git-history secrets.**
  A committed production secret is always a critical, rotate-now item — but the report must
  distinguish *security* from *review-gating*: a secret in the partner's **private source
  repo history** is a breach item the Salesforce reviewer does **not** scan for (the review
  reads the submitted package, the live endpoints, and the docs — not the partner's repo),
  whereas a secret in the **submitted package** or reviewer-reachable code is also a
  guaranteed flagged finding. Rotate either way; only frame a finding as
  "submission-blocking because the reviewer will catch it" when the secret is in the
  submitted surface. This keeps the report precise without softening the rotation imperative.

### Notes
- No engine, schema-of-findings, or skill-contract changes — re-running the audit against
  the same codebase reproduces the same findings (convergent). These are documentation and
  manifest-shape refinements.

## [0.1.0] — 2026-06-12

Initial release. Eight skills (security-review-journey orchestrator + scope-submission,
audit-codebase, generate-artifacts, run-scans, prepare-test-environment,
compile-submission, stay-listed), 13 audit dimensions, 9 artifact templates, the
multi-agent audit workflow harness + authenticated-DAST (ZAP) plan generator, and the
baseline-as-data requirement map. Apache-2.0.

# Acceptance test

A reproducible, fresh-context proof that the toolkit's audit dimensions **catch
their known failure classes** on a seeded fixture — the discipline behind the
project's standing rule: *every coverage gap is encoded into a
dimension/scan-family/baseline (proven by a fresh fixture run) — or, for the
determinizable honesty-critical properties, into a `harness/*.mjs` engine guarded
by a standing deterministic test here — never left to a maintainer being clever
in one session.*

| File | What it is |
|---|---|
| `generate-fixture.mjs` | Builds "Helios Service Agent" (`~/srt-helios`) — the **RECALL** fixture: a synthetic Agentforce managed 2GP seeded with one concrete instance of every probe in the `agentforce-package` / `package-metadata` / `apex-exposed-surface` finder dimensions, negative controls, and a deleted-but-recoverable git-history secret. Synthetic secrets are assembled from parts at runtime so this generator stays secret-scan-clean. Scores near-0 / BLOCKED by construction (a catastrophe needs no fine judgment). |
| `expected-findings.md` | Helios's **sealed ground-truth plant list** — the recall grading key. Lives here, never in the fixture, so finders cannot read it. |
| `generate-solano-fixture.mjs` | Builds "Solano Pipeline Guardian" (`~/srt-solano`) — the **MIDDLE-BAND judgment** fixture (docs/roadmap-middle-band-judgment-fixture.md): a **mostly-compliant** Agentforce managed 2GP + companion endpoint (with sharing, CRUD/FLS in user mode, no injection, no live secrets, `installable`) seeded with **6 genuinely contestable issues** across distinct judgment axes (severity-boundary, tempting-but-safe FP, fix-vs-document, partial evidence, deployed-artifact, prompt-hardening-middle). Engineered to land the SCI in the **65–75% band**. Tests precision-and-calibration on the subtle case, not recall. Secret-scan-clean by construction. |
| `solano-adjudication-key.md` | Solano's **sealed adjudication key** — per-issue intended call + why + the defensible-consistency bar (the calibration/precision grading key). Off-fixture (in the repo, never in `~/srt-solano`) so finders cannot read it. For a cold run it is **re-isolated off-repo** (copied to `~/solano-adjudication-key.md` and removed from `main` for the run window, then restored) — stronger isolation than the Helios `expected-findings.md` precedent, since this run's value is honest judgment. See its *Cold-run isolation* section. |
| `build-run-args.mjs` | Mechanically performs the `audit-codebase` run-args step: extracts each applicable dimension's §4 finder prompt + §5/§6 verifier guidance from its dimension file and injects a project-local engine copy. Supports a focused single-dimension re-run. |
| `test-*.mjs` (29 files) | **Standing deterministic tests** — 29 dependency-free, self-asserting test files (**244 checks**) that guard the `harness/` engines + the `hooks/` enforcement hook: the **calibration-FP-pattern presence guard** (`test-calibration-fp-patterns` — asserts the three blind-30-judge calibration rules [reachability-is-a-precondition / availability≠security / a-missing-grant-is-fail-closed] are present in the §6 Known-false-positive table of each named dimension + the cross-cutting lines in `audit-methodology.md`, so the LLM verifier-guidance prose can't silently regress out; it does NOT test the LLM judgment), the **middle-band band-check** (`test-solano-band` — hand-authors the Solano representative scope-manifest + audit-ledger + evidence-index, runs the REAL `compute-sci` against the REAL baseline, and asserts the HONEST post-Phase-A state: the JUDGMENT is clean (0 open critical/high, the block is owner-materials-only with `blocker_findings` EMPTY) while the SCI stays LOW / `BLOCKED` (7%) until Phase B pre-populates owner artifacts — NOT the old 71%; a PRIMARY fixed-126-id layer + a CORROBORATE live-baseline layer that fails loud on a renamed/removed id, so the design "can't silently drift"), the **throwaway-DAST-target detector** (`test-stack-detect` — the 0.7.0 foundation: `runnable`/`needs-recipe`/`needs-secrets`/`n/a` classification + the env classifier that decides which secrets the toolkit can synthesize vs which the owner must supply, driven hermetically on synthetic Node/package-only repos), the **throwaway stand-up + teardown** (`test-standup-stack`/`test-teardown-stack` — the consented stand-up plan + fail-closed-without-consent + the manifest carrying env NAMES not values, and the asymmetric name-scoped teardown that REFUSES a non-`sf-srt-stack-` docker resource; hermetic, no docker), the **scan-tool detector** (`test-tool-detect` — present vs installable-on-consent vs owner/owner-portal, executable-bit, determinism; the 0.6.0 preflight foundation), the **consented scanner installer** (`test-install-scanners` — the deterministic per-method plan + determinism + safe-tmp-root guard incl. degenerate-run-id + shared-grouping-dir rejection + the no-pin→skip rule, and a HERMETIC executor pass with zero network: the consent gate fails closed, `--dry-run` writes a planned manifest, a git clone from a local repo installs, a `file://` download is accepted on a matching sha256 / rejected-without-execution on a mismatch, and extract-to-scratch puts ONLY the verified binary on PATH), the **asymmetric scanner cleanup** (`test-cleanup-scanners` — the tmp tool dir is removed while evidence + sibling paths survive, an unsafe-tmpRoot or SYMLINK tmpRoot is REFUSED removing nothing, idempotent re-run, and resolution via pointer / `--manifest` / `--tmp-root`), SCI fail-closed + determinism + the **reviewer-reproducible credit rule** (`test-sci` P1 cases — an audit-only clear is statically-cleared, never credited, never clears the blocker floor: the 9%→17% self-grading regression), the **evidence-index producer** (`test-build-evidence-index` — provenance adjudication scanner-vs-audit, fail-safe on a missing scanner file, end-to-end into compute-sci), the **mechanical ledger merge** (`test-merge-ledger` — incremental merge, regression flip, redaction, dedup, wrapper shapes; hermetic git repo), the **audit-engine assembler** (`test-build-audit-engine` — §4/§5 extraction + inject passes injection-check, loud failure on a bad dimension), the **dimension-extraction coverage** (`test-dimension-extraction` — drives build-audit-engine over EVERY `methodology/dimensions/*.md` so every current + future dimension's §4/§5 markers + non-empty finder/verifier prompts are guarded, not just two hand-picked keys), the artifact gate on every entry path (incl. the audit-only auto-proceed + the authN/authZ withhold), the **PreToolUse hook** (no-op unless armed + writing the gated artifact → denies; fail-closed), the **deployed-audit readiness** check (placeholder/`needs-build` vs `installable`), element-precise applicability, baseline-count consistency, **baseline-entry integrity** (`test-baseline-integrity` — every entry's `applies_to` tokens / `severity_if_missing` / the `verification ⟺ last_verified` per-entry implication, plus the 2026-06-20 PMD-rule prediction presence), **prose hygiene** (`test-prose-hygiene` — the CONVENTIONS §9 "simply" ban + the §3 partner-internal-symbol ban, encoded after an adversarial audit caught a voice/genericization slip so it can't recur), cross-dimension de-dup, the audit-engine **injection pre-launch check** (decoy-anchored), and ledger staleness — across three layers: the pure `staleFindings` unit test, a **hermetic detect-path test** (`-detect`), and an **adversarial test** (`-adversary`). No LLM, no fixture, no scanners needed — `node` runs them. |
| `acceptance-report-<date>.md` | The graded result of a fixture run: per-class recall, precision on the negative controls, and every gap the run surfaced (each encoded into the toolkit and re-proven). |
| `integration-pass-condition-<ver>.md` | The PRE-COMMITTED, write-before-run pass condition for a version's full-journey validation — authored before the run, graded **cold in a fresh restarted session** off disk. A clean pass gates that version's release **tag**. (`-0.6.0` [consented-scanner-install] + `-0.7.0` [throwaway-DAST + the credential contract] **both PASSED** in the 2026-06-19 cold run — one full Atlas journey graded off disk → **`v0.7.0` tagged**; `-0.5.1`/`-0.5.2` passed earlier, checkpoints tagged through v0.5.5.) |

## Run it

```bash
node acceptance/generate-fixture.mjs ~/srt-helios
# scope the fixture (a fresh agent following scope-submission, or the skill itself)
#   → writes ~/srt-helios/.security-review/{scope-manifest,target-map}.json
node acceptance/build-run-args.mjs "$PWD" ~/srt-helios 2026-06-15
#   → Workflow({scriptPath: "~/srt-helios/.security-review/audit-engine.mjs"})
gitleaks git ~/srt-helios --redact     # run-scans Family 6, history pass
```

Then grade the confirmed findings against `expected-findings.md`. A planted class
the run misses means the encoding was not forceful enough — sharpen the dimension
file (not the session) and re-run. A negative control that gets flagged means the
verifier over-fires — tighten the §5/§6 refute rules.

## Standing tests (deterministic — no fixture, no LLM, no scanners)

The `harness/` engines (and the `hooks/` enforcement hook) that encode the
honesty-critical determinizable properties each carry a self-asserting test. Run
the whole suite (exit 0 = pass; the file/check count grows each checkpoint — the
pass is ZERO failures, not a fixed number; see the table at the top of this file
for the current totals):

```bash
for t in acceptance/test-*.mjs; do node "$t" || exit 1; done
```

They assert, respectively: the SCI fails CLOSED on an empty/missing manifest and
is byte-identical on re-run (currency floor included); the **artifact gate** is
audit-only (clean / flagged — there is NO STOP mode) and withholds the AuthN/AuthZ
artifact only for an open critical/high authN/authZ finding, **failing SAFE
(withhold) on a malformed non-array ledger** rather than reading it as clean; the
**G4 PreToolUse hook** is a no-op unless armed + writing the gated artifact, denies
over an open hole, and **fails CLOSED** on an unreadable/malformed ledger; the
**audit-engine injection check** anchors past the header-comment decoy; the
**deployed-audit readiness** check reads `installable` / `needs-build` /
`no-package` and is bound to the configured package (an unrelated/dependency `04t`
alias cannot fake `installable`); applicability drops agentforce-* / mcp-* for a
plain package and keeps them for a real agent/MCP one; the baseline self-description
counts match the prose; cross-dimension findings de-dup to a distinct-file
headline; and ledger staleness flags findings whose code changed since their
`audited_commit` — proven at three layers: the pure `staleFindings` unit test, a
hermetic detect-path test that drives the git-shelling CLI against a throwaway
repo, and an adversarial test over the messy real-world `finding.file` shapes
(comma/range suffixes, two-file cites, absolute paths). A refactor that breaks any
of these fails the test — that is what makes the enforcement real rather than
narrated.

The fixture is intentionally *not* committed (it carries planted vulnerabilities
and a git-history secret); it is regenerated on demand from the deterministic
generator, which keeps the proof reproducible without shipping a vulnerable
package or a live-shaped secret in this repo.

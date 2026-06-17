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
| `generate-fixture.mjs` | Builds "Helios Service Agent" (`~/srt-helios`) — a synthetic Agentforce managed 2GP seeded with one concrete instance of every probe in the `agentforce-package` / `package-metadata` / `apex-exposed-surface` finder dimensions, negative controls, and a deleted-but-recoverable git-history secret. Synthetic secrets are assembled from parts at runtime so this generator stays secret-scan-clean. |
| `expected-findings.md` | The **sealed ground-truth plant list** — the grading key. Lives here, never in the fixture, so finders cannot read it. |
| `build-run-args.mjs` | Mechanically performs the `audit-codebase` run-args step: extracts each applicable dimension's §4 finder prompt + §5/§6 verifier guidance from its dimension file and injects a project-local engine copy. Supports a focused single-dimension re-run. |
| `test-*.mjs` (11 files) | **Standing deterministic tests** — 11 dependency-free, self-asserting test files (**106 checks**) that guard the `harness/` engines + the `hooks/` enforcement hook: SCI fail-closed + determinism, the artifact gate on every entry path (incl. the audit-only auto-proceed + the authN/authZ withhold), the **PreToolUse hook** (no-op unless armed + writing the gated artifact → denies; fail-closed), the **deployed-audit readiness** check (placeholder/`needs-build` vs `installable` — so the preflight power-up offer is accurate up front), element-precise applicability, baseline-count consistency, cross-dimension de-dup, the audit-engine **injection pre-launch check** (decoy-anchored), and ledger staleness — the latter across three layers: the pure `staleFindings` unit test, a **hermetic detect-path test** (`-detect`, a throwaway git repo driving the CLI end to end), and an **adversarial test** (`-adversary`, the messy `finding.file` shapes a real finder writes). No LLM, no fixture, no scanners needed — `node` runs them. |
| `acceptance-report-<date>.md` | The graded result of a fixture run: per-class recall, precision on the negative controls, and every gap the run surfaced (each encoded into the toolkit and re-proven). |
| `integration-pass-condition-<ver>.md` | The PRE-COMMITTED, write-before-run pass condition for a version's full-journey validation — authored before the run, graded **cold in a fresh restarted session** off disk. A clean pass gates that version's release **tag**. (`-0.5.2` is the current open one; `-0.5.1` passed + is tagged.) |

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

The `harness/` engines that encode the honesty-critical determinizable properties
each carry a self-asserting test. Run all eight (exit 0 = pass):

```bash
for t in acceptance/test-*.mjs; do node "$t" || exit 1; done
```

They assert, respectively: the SCI fails CLOSED on an empty/missing manifest and
is byte-identical on re-run (currency floor included); the artifact gate returns
STOP / flagged / clean correctly on every entry path and withholds the AuthN/AuthZ
artifact only for an open critical/high authN/authZ finding; applicability drops
agentforce-* / mcp-* for a plain package and keeps them for a real agent/MCP one;
the baseline self-description counts match the prose; cross-dimension findings
de-dup to a distinct-file headline; and ledger staleness flags findings whose code
changed since their `audited_commit` — proven at three layers: the pure
`staleFindings` unit test, a hermetic detect-path test that drives the git-shelling
CLI against a throwaway repo, and an adversarial test over the messy real-world
`finding.file` shapes (comma/range suffixes, two-file cites, absolute paths). A
refactor that breaks any of these fails the
test — that is what makes the enforcement real rather than narrated.

The fixture is intentionally *not* committed (it carries planted vulnerabilities
and a git-history secret); it is regenerated on demand from the deterministic
generator, which keeps the proof reproducible without shipping a vulnerable
package or a live-shaped secret in this repo.

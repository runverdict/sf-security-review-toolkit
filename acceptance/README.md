# Acceptance test

A reproducible, fresh-context proof that the toolkit's audit dimensions **catch
their known failure classes** on a seeded fixture — the discipline behind the
project's standing rule: *every coverage gap is encoded into a
dimension/scan-family/baseline and proven by a fresh run, never left to a
maintainer being clever in one session.*

| File | What it is |
|---|---|
| `generate-fixture.mjs` | Builds "Helios Service Agent" (`~/srt-helios`) — a synthetic Agentforce managed 2GP seeded with one concrete instance of every probe in the 0.3.0 dimensions (`agentforce-package`, `package-metadata`, `apex-exposed-surface`), negative controls, and a deleted-but-recoverable git-history secret. Synthetic secrets are assembled from parts at runtime so this generator stays secret-scan-clean. |
| `expected-findings.md` | The **sealed ground-truth plant list** — the grading key. Lives here, never in the fixture, so finders cannot read it. |
| `build-run-args.mjs` | Mechanically performs the `audit-codebase` run-args step: extracts each applicable dimension's §4 finder prompt + §5/§6 verifier guidance from its dimension file and injects a project-local engine copy. Supports a focused single-dimension re-run. |
| `acceptance-report-<date>.md` | The graded result of a run: per-class recall, precision on the negative controls, and every gap the run surfaced (each encoded into the toolkit and re-proven). |

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

The fixture is intentionally *not* committed (it carries planted vulnerabilities
and a git-history secret); it is regenerated on demand from the deterministic
generator, which keeps the proof reproducible without shipping a vulnerable
package or a live-shaped secret in this repo.

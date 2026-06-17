# 0.5.1 integration validation — PRE-COMMITTED pass condition (write-before-run)

Pre-committed 2026-06-17 by the author of the 0.5.1 work, BEFORE the run, so the
grade is against a fixed bar — not "it completed → done." **Grade this COLD in a
fresh, restarted session.** Two independent reasons it must be a fresh session,
not the authoring one:
1. **Plugin loads on restart.** 0.5.1 is installed (`runverdict-plugins@0.5.1`)
   but a running session uses whatever was loaded at its start. A journey run
   "on 0.5.1" only exercises 0.5.1 after a restart — otherwise it tests the old
   plugin and the grade is meaningless.
2. **The author is the worst grader.** The instance that built the C1 fix has
   strong priors about how it "should" behave; a fresh grader reads the disk.

A PASS here is the green light to **tag 0.5.1** (`claude plugin tag`) at commit
`6b6666b`. (Merge to main already happened; the tag is the remaining gate.)

## Setup
- Plugin = **`runverdict-plugins@0.5.1`** (verify with `claude plugin list` →
  Version 0.5.1; restart first so it is actually loaded). NOT a stale cache.
- Fixture = **`~/srt-coldstart`**, currently `HEAD 44c50a4` (the C1 commit:
  ForecastService remediated + run-state gitignored) with the ledger still
  audited at `a1e86eb` (`audited_commit` in `.security-review/audit-ledger.json`).
  So **HEAD ≠ audited_commit by design** — code moved since the audit, which is
  exactly the condition the C1 detect path exists to catch on resume.
- Run: a fresh `claude` (or headless `claude -p`) in `~/srt-coldstart` →
  "continue the security review" (a RESUME against the existing `.security-review/`
  ledger). Capture stream-json to `~/coldstart-logs/run-0.5.1.jsonl`.

## PART A — 0.5.0 gate/back-half regression (must still hold)
0.5.1 changed only the staleness normalizer + added tests; it did NOT touch the
artifact gate, SCI, applicability, or dedup. So the entire 0.5.0 bar still applies
as a **regression baseline** — grade points 1–6 and all FAIL conditions from
`~/coldstart-logs/integration-pass-condition.md` against this run too (election
persisted; gate consulted → `flagged`; AuthN/AuthZ WITHHELD for the right reason
incl. the A1 secondary-category cross-check; no over-suppression / A2; full back
half → SCI + path-to-green; zero spurious AskUserQuestion). Any 0.5.0-bar FAIL is
a 0.5.1 FAIL.

## PART B — NEW: C1 detect path, proven INSIDE a real resumed journey
The harness CLI live-bar already proved detection off-disk (15 ForecastService
stale). What was never proven is that the **LLM journey actually invokes the
staleness check on resume and surfaces the result** — the integration gap.

- **B1 — staleness is invoked + surfaced on resume.** The resumed run runs
  `ledger-staleness.mjs` (or its logic) and **surfaces a staleness warning** that
  the audited code has moved — it does not silently present the old verdict as
  current. Cross-check off-disk:
  `node harness/ledger-staleness.mjs --target ~/srt-coldstart --json`
  → `status: "stale"`, `audited_commit` `a1e86eb…`, `head` ≠ audited,
  **exactly 15 stale findings, all `force-app/main/default/classes/ForecastService.cls`**.
- **B2 — correct scoping, live (the two-sided property).** The surfaced staleness
  names **only** the ForecastService.cls findings — it does NOT flag the 11
  `server/index.js`, the `ForecastController`, or the `Lumina_API.namedCredential`
  findings (those files are unchanged). This proves the rebuilt normalizer flags
  changed-file findings WITHOUT over-flagging unchanged ones, inside the real
  journey — not just in the harness. (A run that flags all/most findings stale, or
  flags server/index.js findings, is a FAIL — the over-flag regression.)
- **B3 — honest handling, not a crash or auto-flip.** The journey treats the stale
  findings as "re-audit these dimensions before relying on their verdict" (flag,
  never auto-flip to fixed/refuted) and does not crash on the messy `finding.file`
  shapes in this ledger (`:5,15-19`, the two-file `server/index.js:27 and …`).
- **B4 — shipped-plugin standing tests green.** On the 0.5.1 plugin checkout:
  `for t in acceptance/test-ledger-staleness*.mjs; do node "$t" || echo FAIL; done`
  → all green (unit 9, detect 7, adversary 30). Bridges the unit proof to the
  shipped artifact. (The no-change/"current" path is deterministically covered
  here; an optional integration spot-check is a resume on a fixture where
  HEAD == audited_commit → staleness `status: "current"`, zero stale.)

## FAIL — any of these
- Any PART A (0.5.0-bar) FAIL recurs.
- The resumed journey does NOT surface staleness despite HEAD ≠ audited (the
  silent-false-current failure — the worst direction).
- Staleness over-flags: flags server/index.js / ForecastController / namedCredential
  findings, or flags substantially more than the 15 ForecastService findings.
- The journey crashes or aborts on the messy `finding.file` shapes.
- Any `acceptance/test-ledger-staleness*.mjs` is red on the 0.5.1 plugin.

## Grading method (cold, off-disk)
- `grep` the transcript for the staleness invocation + the surfaced warning.
- `node harness/ledger-staleness.mjs --target ~/srt-coldstart --json` → assert B1/B2.
- `ls ~/srt-coldstart/docs/security-review/` + `cat` the WITHHELD placeholder → PART A.
- `node harness/artifact-gate.mjs --target ~/srt-coldstart --json` → `flagged`, suppress `[authn-authz-flow]`.
- `node harness/compute-sci.mjs --json` → deterministic, BLOCKED/NOT READY.
- Run the ledger-staleness standing tests → B4.

A clean PASS → tag 0.5.1 at `6b6666b`, then Phase 2 (G5 → G4) as 0.5.2 against the
tagged baseline.

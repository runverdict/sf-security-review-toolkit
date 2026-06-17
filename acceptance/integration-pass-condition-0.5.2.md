# 0.5.2 integration validation — PRE-COMMITTED pass condition (write-before-run)

Pre-committed 2026-06-17 by the author of the 0.5.2 work, BEFORE the run. **Grade
COLD in a fresh, restarted session** (plugin loads on restart; the author is the
worst grader — see the 0.5.1 bar for both reasons). A clean PASS → **tag 0.5.2**.

0.5.2 reworked the triage gate: it is now **audit-only** — open critical/high
**auto-proceeds** to the full NOT-READY report (no STOP, no fix-first, no human
election), and the AuthN/AuthZ withhold fires **purely from the ledger** and now
covers `crypto-internals` (JWT verification) and `sessionid-egress` (session-token
egress). This bar proves that behavior end-to-end, not just in the unit tests.

## Setup
- Plugin = **`runverdict-plugins@0.5.2`** (`claude plugin list` → 0.5.2; restart first).
- Fixture = a managed package with an **open authN/authZ critical/high** in the
  ledger. `~/srt-coldstart` qualifies (post-0.5.1-run pass-2 state: the Named
  Credential `oauth-identity` critical + the `server/index.js` JWT
  `crypto-internals` criticals are open; the Apex cluster is fixed). If its ledger
  has drifted, any fixture with an open authz crit/high works.
- Run: `claude` in the fixture → "run/continue the security review", full-auto.

## PART A — audit-only triage: AUTO-PROCEED, never halt
- **A1 — no triage halt, zero fix prompt.** With open critical/high present, the
  run does NOT stop at a triage gate, does NOT present a "fix-first vs
  continue-with-flags" menu, and emits **zero AskUserQuestion** at triage. It
  proceeds straight through to the full report. (The only legitimate halts remain
  live-probe / scratch-org consent — neither triggers here.)
- **A2 — no fix offer, ever.** Nowhere in the transcript does the toolkit offer to
  draft / write / apply code fixes. Per-finding remediation **guidance** in the
  report (and `path-to-green`) is fine; "I can draft the fix for you" is a FAIL.
- **A3 — full NOT-READY report produced.** The back half completes (artifacts →
  scans → reviewer-sim → compile); `readiness-verdict.md` carries SCI **`BLOCKED`**
  with the open findings verbatim; `path-to-green.md` sequences the root causes.

## PART B — the withhold fires from the LEDGER, election-independent + wider
- **B1 — AuthN/AuthZ withheld with no election.** `docs/security-review/` has
  `authn-authz-flow.WITHHELD.md` and NO real `authn-authz-flow.md`, even though no
  human elected continue-with-flags. Cross-check off-disk:
  `node harness/artifact-gate.mjs --target <fixture> --json` →
  `mode:"flagged"`, `suppress:["authn-authz-flow"]`.
- **B2 — crypto-internals now counts (the 0.5.1-grade gap).** The gate's
  `open_authz_findings` (and the WITHHELD placeholder) now **include the open JWT
  `crypto-internals` finding(s)** — in 0.5.1 they were silently excluded. This is
  the visible proof the secondary-authN gap is closed.
- **B3 — A2 holds (no over-suppression).** Every other applicable artifact is
  generated; ONLY `authn-authz-flow` is withheld.
- **B4 — coverage is unit-locked.** `node acceptance/test-artifact-gate.mjs` on the
  0.5.2 plugin is green (14 checks), including `sessionid-egress`-alone-withholds,
  `crypto-internals`-alone-withholds, whitespace-dimension-still-withholds, and
  `injection-xss`-flagged-but-NOT-withheld (defect-category, not blast-radius). The
  `sessionid-egress` integration case need not appear in this fixture; it is
  test-backed.

## PART C — clean spot check
- On a fixture (or a re-audited state) with **no** open critical/high, the gate
  returns `mode:"clean"`, `suppress:[]`, and the AuthN/AuthZ doc generates. (The
  fix-first positive-side — remediate → re-audit → gate clean → doc regenerates —
  is already proven in the 0.5.1 run; here it is the clean-mode spot check.)

## PART D — G5 (audit-engine launch, decoy-anchored injection)
This batch also ships G5, so the run must actually **launch the audit** (a fresh
scope/audit, OR advance the fixture HEAD so staleness triggers a re-audit — a bare
resume with staleness `current` does NOT exercise G5). On launch:
- The injected `audit-engine.mjs` runs (agents fan out, findings produced) — i.e.
  the pre-launch check did NOT false-fail on the header-comment decoy. Cross-check:
  `node harness/injection-check.mjs <fixture>/.security-review/audit-engine.mjs` →
  exit 0. (`test-injection-check.mjs` is the deterministic guard.)

## PART E — G4 (the enforcement hook, live)
The hook ships disabled-by-default; validate both states **live** in the session:
- **Unarmed (no `.security-review/hook-armed`):** a `Write` to
  `docs/security-review/authn-authz-flow.md` is NOT blocked by the hook (the skill
  gate still withholds, but the hook itself is a no-op). Any unrelated `Write`/`Edit`
  is never blocked.
- **Armed (`touch <fixture>/.security-review/hook-armed`) + an open authN/authZ
  critical/high:** a deliberate `Write` to that exact doc is **DENIED** by the hook
  (Claude Code shows the `permissionDecision: deny` reason naming the open findings).
  Disarm (delete the flag) → the write proceeds. (`test-authz-gate-hook.mjs` is the
  deterministic guard for the decision logic; this confirms Claude Code actually
  invokes + honors it.)

## FAIL — any of these
- The run HALTS at triage / presents a fix-first|continue-with-flags menu / emits
  an AskUserQuestion at triage (the gate must auto-proceed).
- G5: the audit fails to launch because the pre-launch check mis-sliced the
  INJECTED marker (false "injection failed").
- G4: the armed hook does NOT block a write to the gated doc over an open authz
  hole, OR the hook blocks an unrelated write / blocks when unarmed.
- The toolkit offers to draft/write/apply code fixes.
- `authn-authz-flow.md` is drafted while an open authN/authZ critical/high stands,
  OR the withhold fails to fire absent an election (the election-independence bug).
- The open JWT `crypto-internals` finding is NOT in `open_authz_findings` (the
  0.5.1 gap recurs).
- Any `acceptance/test-*.mjs` is red on the 0.5.2 plugin.

## Grading method (cold, off-disk)
- `grep` the transcript for any triage halt / fix-first menu / AskUserQuestion /
  fix-drafting offer (all must be ABSENT).
- `node harness/artifact-gate.mjs --target <fixture> --json` → assert B1/B2/B3.
- `ls docs/security-review/` + `cat authn-authz-flow.WITHHELD.md` → withheld present,
  real absent, placeholder names the open authz findings incl. the JWT ones.
- `node harness/compute-sci.mjs --target <fixture> --json` → BLOCKED, deterministic.
- `for t in acceptance/test-*.mjs; do node "$t"; done` → all green (the pass is
  ZERO failing files, not a fixed count — the suite grows each checkpoint; it was
  ~100 at the 0.5.2 head and is higher now, which is expected, not a regression).

NOTE — scope of this run: this bar grades the **0.5.2** plugin behavior (triage
auto-proceed, ledger-driven withhold, G5 launch, G4 deny). The running cold
session loads the **frozen 0.5.2 cache**, so it does NOT exercise the 0.5.3
proactive power-up offer or the next-checkpoint fixes (P0 install boundary, etc.)
— those get their own pass-condition + cold run on the updated plugin. A clean
PASS here → tag 0.5.2 at its commit.

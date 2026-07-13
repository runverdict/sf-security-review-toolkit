# Roadmap — Presentation Consistency (pin the operator-facing surfaces)

**Status:** Slice 1 — **WI-00A + WI-01 + WI-02 shipped in 0.8.22** (2026-06-25). Slice 2 —
**WI-00B + WI-03 shipped in 0.8.23** (2026-06-25). Slice 3 — **WI-04 + WI-05 shipped in 0.8.24**
(2026-06-26): the entry-experience renders (finding-cluster headline · target-map approval ·
audit recap · 3-tier preflight · scan-status · router status). Slice 4 — **WI-06 REPORTS HALF
shipped in 0.8.25** (2026-06-26): the scope-submission REPORT renders (detected-elements 15 ·
applicable-requirements 16 · MCP direction/auth-profile 43 + live-probe 44 · SF-CLI
auto-resolution 45). Slice 5 — **WI-06 GATES HALF shipped in 0.8.27** (2026-06-26): the
scope-submission gates (partner-program preflight 05 · live-endpoint probe 30 · NEED-FROM-YOU 31 ·
listing-type/tenancy 32 · final summary + confirm 06). **WI-06 is now COMPLETE.** WI-07…WI-12
remain backlog.
Sequenced AFTER the 0.8.21 cold campaign tags — these are presentation-only changes that do NOT
touch the finding band, so they ship as post-tag hardening (the 0.8.18→0.8.21
friction/structure class) and never require re-running the campaign.

## Why this exists — the trust thesis

The toolkit's FINDINGS engine is deterministic: the audit fan-out, the merge,
the SCI, the recurrence/convergence math, the artifact templates the Salesforce
reviewer receives — all rendered verbatim from DATA. But nearly every IN-SKILL
operator-facing surface — the `AskUserQuestion` gate option sets and the live
status / verdict / target-map / preflight / scan-status renders — is
**driver-improvised prose**. No harness emits a gate's option labels, and no
template fixes the readiness-verdict / preflight / scan-status / finding-cluster
render skeleton.

The result is exactly the drift this roadmap targets, observed live during the
0.8.21 cold campaign:

- the **same depth gate** offered with a different option set run-to-run (run 1
  hard-removed Exhaustive → `{Standard, Quick}`; run 2 offered it
  "not recommended" → `{Standard, Quick, Exhaustive}`),
- the **tier re-asked** in `audit-codebase` after the journey already collected
  it (the launch gate re-litigates instead of confirming the locked choice),
- the **same summary** rendered as a table one run and text-heavy prose the next.

> Runs differing because they *find different things* is honest. The *template*
> those findings are posted into looking different every run is not — it reads
> like the LLM is making it up as it goes, and that corrodes the exact trust the
> toolkit sells. The findings engine isn't winging anything; the presentation
> layer is.

The fix: **pin every operator-facing surface so the SKELETON is fixed and only
the DATA varies** — one repo-proven pattern (ENGINE owns structure, driver
supplies data) applied to two currently-unpinned classes.

## Architecture — mirror the proven contract

Both substrates copy patterns already in the repo (`build-audit-engine.mjs`
renders `target-map.json` deterministically; `record-consent.mjs` pins the
decision token; `compute-sci.mjs` emits a verbatim Markdown block;
`workflow-template.mjs` uses a `/* {{ARGS_OBJECT}} */` injection marker;
`zap-plan-template.yaml` uses `{{SLOT}}` fills; `build-artifact-engine.mjs`
throws on a missing template).

### (1) Gate-spec engine — `harness/gate-spec.mjs`  (WI-00A)
A module-level `Object.freeze()` catalog keyed by gate-id →
`{header, question, options:[{label, description, decision}]}`, plus a PURE
selector `gateOptions(gateId, facts)` (built like
`applicable-requirements.mjs`'s set-operation) that chooses the variant/options
from detected facts (resume-state, `package-readiness.json`, `namespace-check`,
`stack-detect × docker-check`, prior consent ledger). CLI
`node harness/gate-spec.mjs --gate <id> --facts facts.json` prints the exact
`AskUserQuestion` payload as JSON. The driver renders `options[].label/
description` VERBATIM and pipes the chosen option's `decision` straight into the
existing `record-consent.mjs --decision` (option set pinned upstream, decision
pinned downstream — the free-text regex fallback becomes vestigial).

- **Fail-closed** like `build-artifact-engine`'s `FOCUS_MIN` throw: throw if the
  gate id is unknown or any option lacks a label/description/decision, so a
  driver that improvises options cannot proceed.
- **Mandatory safe-default** like `build-audit-engine`'s `ALWAYS_ON`: the
  decline/skip option is force-injected on every consent gate.
- **Single source of truth for the highest-stakes gates**: `sf-package-promote`'s
  option text IS the hook's canonical `denyReason()` permanence string
  (`sf-ops-gate-hook.mjs`), so prompt and deny-reason can never diverge.

### (2) Output render-verbatim substrate  (WI-00B) — ✅ DONE (0.8.23)
Two flavors, both render-verbatim:

- **Render harnesses** for surfaces backed by deterministic JSON — extend
  emitters with a fixed-block mode the way `compute-sci.mjs` already does
  (`finding-clusters.mjs --headline`, `applicable-requirements.mjs --render`,
  `ledger-staleness.mjs` non-json; the recurrence JSON is rendered by
  `render-stability.mjs`, not a `--render` mode) +
  new `render-*.mjs` siblings *(as planned — shipped names differ: see WI-03…06;
  e.g. `render-scope-summary`, `render-recap`; no `render-summary`/`render-findings`
  engines shipped)*.
- **`{{SLOT}}` templates** under a new `templates/operator/` dir, modeled on
  `zap-plan-template.yaml` + the `{{ARGS_OBJECT}}` marker:
  `readiness-verdict.md.tmpl`, `audit-report.md.tmpl`, `path-to-green.md.tmpl`,
  `submission-package-index.md.tmpl`, `pending-owner-run.md.tmpl`,
  `reviewer-simulation.md.tmpl`, plus the cadence/test-env set.

**RENDER-VERBATIM CONTRACT:** each pinned surface's skill (a) lists the render
harness/template in `allowed-tools`, (b) carries "print the harness stdout / fill
the `.tmpl` VERBATIM — never paraphrase, reorder, drop a column, or flip
table↔prose", and (c) is policed by a CI lint extending the existing
"no unfilled `{{SLOT}}`" check: sentinel markers wrap each emitted block and the
build fails if a skill body hand-builds a Markdown table for a surface that has a
registered renderer/template.

## Work-item backlog

Build order: **WI-00A** and **WI-00B** are the substrates — do them first.
**WI-01/02/03** are the three surfaces flagged live during the campaign (the
recommended first two builder slices). **WI-04…12** roll the pattern across the
remaining ~50 surfaces.

| WI | Title | Covers (INV) | Pri | Effort |
|----|-------|--------------|-----|--------|
| 00A | gate-spec engine (frozen catalog + selector + fail-closed) | the gate class | high | M |
| 00B | output render-verbatim substrate (`templates/operator/` + renders + lint) ✅0.8.23 | the output class | high | M |
| 01 | pin the 3 preflight gates (run-mode / audit-tier / scanner-install) | 26, 01, 02 | high | S |
| 02 | audit-launch gate: confirm the locked tier, don't re-ask | 01 | high | S |
| 03 | template the readiness-verdict (fixed skeleton) ✅0.8.23 | 10, 11, 35 | high | M |
| 04 | pin finding-cluster headline + target-map approval display ✅0.8.24 | 08, 12, 34 | high | M |
| 05 | pin preflight 3-tier report + scan-status summary ✅0.8.24 | 07, 13, 33 | high | M |
| 06 | pin scope-submission surfaces — ✅ DONE (reports 15/16/43/44/45 ✅0.8.25; gates 05/30/31/32 + confirm 06 ✅0.8.27) | 06,15,16,44,45,43,05,32 | high | L |
| 07 | template reviewer-simulation report | 18 | high | M |
| 08 | CLI-gated deep-audit gates + verification batteries | 04,28,29,53,46,47,48,54,55 | med | L |
| 09 | cadence + test-env templates + shared run-log entry | 19,20,21,22,23,24,25,50 | med | L |
| 10 | audit synthesis report + compile-submission siblings | 09,11,14,36,37 | med | L |
| 11 | generate-artifacts operator surfaces (gate echo, partition, WITHHELD, status, cross-read, Checkmarx) | 17,39,40,41,42,38,52 | med | M |
| 12 | remaining low-risk renders + harden already-pinned verbatim contracts | 51,35,54,55,58,59,60 | low | M |

### WI-00A — gate-spec engine — ✅ DONE (0.8.22)
Create `harness/gate-spec.mjs` (frozen catalog + pure `gateOptions(gateId,
facts)` selector + CLI). Fail closed on unknown gate / malformed option;
force-inject the safe-default option. Driver renders verbatim → pipes the
chosen `decision` to `record-consent.mjs`. **Test** `test-gate-spec.mjs`:
determinism (twice → byte-identical), golden snapshot of every gate's options,
fail-closed throw on a short/missing option, safe-default present on every
consent gate, every `option.decision` is a valid record-consent token.

### WI-01 — pin the 3 preflight gates — ✅ DONE (0.8.22)
Register `run-mode` (fixed 2-option, same call as audit-tier), `audit-tier`
(selector: first-pass → the PINNED `{standard(default), exhaustive, quick}` +
force-injected `Cancel` — **identical every run**, exhaustive OFFERED but never
pre-selected; the operator+builder ratified OFFER-don't-hide it, since hiding it
blocks legitimate exhaustive re-runs — and a confirm-the-locked-tier variant on a
later pass, WI-02), `scanner-install` (fixed install/skip,
the sha256/tmp/run-also-fetches disclosure as the verbatim install description,
`N + scanner(method)` the only fillable data). Rewrite the journey preflight
prose (`security-review-journey/SKILL.md:307-316`) to call `gate-spec.mjs`.
**Test** snapshot each gate; assert audit-tier OFFERS `quick` + `exhaustive` but
never pre-selects `exhaustive` on pass 1 and the option set is identical every
run; run-mode + audit-tier share one call.

### WI-02 — fix the redundant tier re-ask — ✅ DONE (0.8.22)
In the `audit-tier` selector, when the consent ledger already carries a recorded
tier token, emit a CONFIRM-and-authorize variant `{Authorize the <locked>
launch (default), Change tier, Cancel}` instead of the full menu. Rewrite
`audit-codebase` Step 2 (`SKILL.md:56-85`) to call gate-spec with resume facts
and record the launch authorization via `record-consent` (reusing the prior
`audit-tier` token via `verifyConsent`) rather than re-offering the menu; only
`Change tier` re-opens the election. **Test** `test-tier-no-reask.mjs`: with a
recorded token → `{Authorize, Change tier, Cancel}`; standalone (no token) →
full first-pass menu; journey→audit-codebase integration fixture asserts the
tier is collected once.

### WI-03 — template the readiness-verdict — ✅ DONE (0.8.23)
`templates/operator/readiness-verdict.md.tmpl` (mirror
`readiness-tracker.md.tmpl`) with fixed `##` headers in fixed order: SCI block
slot (paste compute-sci stdout byte-for-byte), Ledger Freshness, Finding
Stability (`render-stability` output), Per-category, Blockers (one canonical
line per blocker row — the `RENDER:blockers` sentinel slot; no dedicated engine shipped), NOT-verified, Open conflicting baseline, Standing caveat
(canonical constant string). Add `harness/render-stability.mjs` (two-branch
fixed block over `recurrence-confidence` JSON). Rewrite compile-submission
Step 8 to fill slots + print verbatim. **Test** render twice on a frozen
fixture → byte-identical; section order; SCI slot equals compute-sci stdout;
standing caveat equals the committed constant; no `{{...}}` survives.

### WI-04 — finding-cluster headline + target-map approval + recap — ✅ DONE (0.8.24)
Three surfaces, one shared block. `finding-clusters.mjs` gains `renderClusterHeadline`
+ a `--headline`/`--format md` CLI emitting the fixed triage block — raw per-severity
counts FIRST, then the clustered distinct-file view, then the headline narrative. BOTH
`audit-codebase` Step 6 (exec summary) and `security-review-journey` Step 3 (blocker gate)
print it VERBATIM, so the FAILURE VERDICT reads byte-identically. `render-target-map.mjs`
renders `target-map.json` → the fixed `{dimension | applicable | targets | why |
confidence | unresolved}` table (applicable rows first, unresolved flagged), printed
verbatim in the Step-3 approval `AskUserQuestion`. `merge-ledger.mjs` emits a fixed
`render-recap.mjs` block to stdout — LED BY the cluster headline, then counts · PROCEED/HALT
· not-covered caveat — printed verbatim at `audit-codebase` Step 7. **Tests**
`test-finding-clusters-headline` (6), `test-render-target-map` (5), `test-render-recap` (7):
determinism, golden structure, fail-safe, a byte-identical-lead assertion, and skill wiring.

### WI-05 — preflight 3-tier report + scan-status + router status — ✅ DONE (0.8.24)
`render-preflight.mjs` renders the 3-tier report (✓ DETECTED / ⚠ NEED-FROM-YOU /
✦ OPTIONAL POWER-UPS) from the deterministic detector JSONs; the deployed-org power-up
line is a FIXED 4-state enum (`DEEP_AUDIT_STATES` + the total `deepAuditState` selector,
fed by the new additive `package-readiness.registered` field). `render-scan-status.mjs`
renders the evidence `index.json` → a fixed 8-row Family table (frozen `SCAN_FAMILIES`,
canonical 1–8 order, locked columns; DONE needs an on-disk report). `render-router-status.mjs`
emits the fixed 3-line "where are we?" block over a frozen phase ladder. The journey prints
the preflight + router blocks verbatim; `run-scans` Step 11 prints scan-status verbatim.
**Tests** `test-render-preflight` (6), `test-render-scan-status` (5), `test-render-router-status`
(5): determinism, the golden skeleton (4-state enum completeness, canonical Family order),
fail-safe, and skill wiring.

### WI-06 — scope-submission surfaces — ✅ DONE (reports 0.8.25, gates 0.8.27)
WI-06 is SPLIT (auditor + operator decision): Slice 4 (0.8.25) shipped the REPORT renders
(INV-15/16/43/44/45); Slice 5 (0.8.27) ships the scope GATES + final confirm (INV-05/30/31/32/06),
COMPLETING WI-06.
`render-detected-elements.mjs` (INV-15) renders `scope-manifest.json` → the fixed
`{Element | Detected how (evidence)}` table in a frozen `CANONICAL_ELEMENT_ORDER` (unknown
types appended, never dropped) + the `listingType` line; a no-evidence element gets an honest
cell, empty → "scope not detected yet". `applicable-requirements.mjs --render` (INV-16) emits the
applicable COUNT (= exact list length), the ids grouped by track, the conflicting-requirements
section (every applicable `conflicting` entry with its `conflicts` text — surfaced per
CONVENTIONS §4, never silently resolved), and the mobile-no-coverage gap line; `parseBaselineApplies`
now additively captures `verification` + the folded `conflicts` block scalar. `render-mcp-scope.mjs`
(INV-43+44) renders the listing-direction caption + the auth-profile fields straight from
`mcp.authExpectations` (rendered, NOT re-derived) and the live-probe result where `probed:false`
reads "recorded from code, NOT live-probed" (never presenting an un-probed fact as a probe).
`render-sf-autoresolve.mjs` (INV-45) renders the auto-resolved rows + a Security-flags section
(http:// non-TLS · wildcard · no-Named-Credential · ViewAll/ModifyAll over-grant — surfaced,
never dropped) + a Conflicts section (CLI is evidence, not an override); gated on the manifest
`sfAutoResolved`, and NEVER renders a secret (redaction guard, CONVENTIONS §6). scope-submission
Steps 2/3/4/7 print each verbatim. Also folds in two Slice-3 grade nits: the dict-vs-array honesty
guard (`finding-clusters.mjs` + `render-recap.mjs` — a PRESENT-but-non-array `findings` → UNAVAILABLE,
never NONE/PROCEED) and a `render-scan-status.mjs` docstring clarify (the DONE gate is enforced at
the producer). **Tests** `test-render-detected-elements` (6), `test-render-mcp-scope` (7),
`test-render-sf-autoresolve` (7), extended `test-applicable-requirements` (+6), + the two nit
regressions: determinism, the golden skeleton, fail-safe, the secret/probe honesty guards, and
skill wiring.

**0.8.26 honesty-hardening (post-Slice-4 off-disk grade):** the dict-vs-array guard now also covers
the `render-recap.mjs --target` standalone re-render (`factsFromLedger` had coerced the dict shape to
`[]` → a false PROCEED; it now preserves it → UNAVAILABLE, RC7); `merge-ledger.mjs` refuses a
corrupted prior ledger LOUDLY (stderr warning + exit 2, on-disk ledger untouched) instead of silently
dropping it (M15); and `render-sf-autoresolve.mjs`'s secret guard extends to every rendered cell (host
· source · flag detail · conflict auto-resolved) with the docstring softened to its honest
producer-is-the-boundary scope (SA6). Presentation/honesty-only, no finding-band change. Suite 50
files / 471 checks.

### WI-06 GATES half — ✅ DONE (0.8.27, Slice 5) — COMPLETES WI-06
The last freehand-prompt surfaces in Phase 0, pinned via the gate-spec catalog. Six new gates
land in TWO semantic classes, encoded by a new `kind` field on every catalog entry
(`consent | election | answer`, load-validated `consent ⟺ kind:'consent'`): **CONSENT-to-act**
gates force-inject the decline and pipe the chosen `decision` to `record-consent`; **ANSWER** gates
record the selected option into the scope manifest (no force-injected decline, not piped).
`mcp-probe` (INV-30, CONSENT) — the live read-only-probe gate; the `STAGING`/`PRODUCTION` choice IS
the environment confirmation (production never probed silently), `{{URL}}` the only fillable datum
via a function-replacer, throws without a url. `scope-confirm` (INV-06, CONSENT) — the final-manifest
confirm mirroring the WI-02 audit-tier variant `{Confirm & proceed, Correct the scope, Cancel}`, both
non-confirm options the FAIL-SAFE deny. `partner-program` (INV-05, ANSWER family) — the six preflight
sub-gates via `facts.subGate`, each `Yes→affirm/No→deny` recorded into `operatorConfirmed.<key>`, the
`promoted` gate offering `N/A — no package in scope` only when `facts.noPackage`. `clarify-detection`
(INV-31, ANSWER) — the NEED-FROM-YOU `present/absent/unsure` gate, `{{ELEMENT}}` filled, throws
without an element. `listing-type` + `tenancy` (INV-32, ANSWER) — the categorical closed choices
(all-`affirm`, the chosen LABEL recorded; the free-text security-model claims stay un-pinned).
`render-scope-summary.mjs` (INV-06) renders the fixed Step-9 readout whose `operatorConfirmed` gate
states are HONEST (✓/✗/not-recorded, never a fabricated ✓) and whose missing-manifest branch reads
"scope not finalized", never a fabricated "ready". scope-submission Steps 2/3/5/6/9 call gate-spec +
record-consent + render-scope-summary VERBATIM (the freehand step-5 table-as-prompt is gone).
**Tests** `test-scope-gates` (17) + `test-render-scope-summary` (11): per-gate determinism + golden
option snapshots + fail-closed throws + the force-injected-decline-on-CONSENT / none-on-ANSWER split
+ the `kind` semantics + the consent round-trip + the promoted-N/A conditional + the `$`-URL-literal
guard + the summary skeleton/fail-safe/registration + skill wiring. Presentation-only, no finding-band
change. Suite 52 files / 499 checks.

*(WI-07…WI-12 detail: see the synthesis result captured for this roadmap;
each follows the same render-harness-or-template + standing-test pattern.)*

## Inventory — all 60 surfaces (condensed)

`status`: pinned ✓ / partial ◐ / improvised ✗. `risk`: H/M/L.

| INV | Surface | Kind | Status | Risk | WI |
|-----|---------|------|--------|------|----|
| 01 | audit-tier/depth gate (cross-skill, re-asked) | gate | ✓ | H | 01,02 ✅0.8.22 |
| 02 | scanner-install network-fetch gate | gate | ✓ | H | 01 ✅0.8.22 |
| 03 | throwaway-DAST consent gate | gate | ✓ | H | 06* ✅0.8.95 (pinned in the frozen gate catalog) |
| 04 | sf-package-promote permanence consent | gate | ◐ | H | 08 |
| 05 | scope partner-program preflight gates (6) | gate | ✓ | H | 06 ✅0.8.27 |
| 06 | final scope-manifest summary + confirm | verdict | ✓ | H | 06 ✅0.8.27 |
| 07 | one-page preflight 3-tier report | report | ✓ | H | 05 ✅0.8.24 |
| 08 | finding-cluster triage headline | report | ✓ | H | 04 ✅0.8.24 |
| 09 | synthesis audit report (§9 body) | report | ◐ | H | 10 |
| 10 | readiness-verdict wrapper | verdict | ✓ | H | 03 ✅0.8.23 |
| 11 | Finding Stability (N-run consensus) | report | ✓ | H | 03 ✅0.8.23 |
| 12 | target-map approval display | targetmap | ✓ | H | 04 ✅0.8.24 |
| 13 | scan-status summary | output | ✓ | H | 05 ✅0.8.24 |
| 14 | submission-package INDEX.md | targetmap | ◐ | H | 10 |
| 15 | detected-architecture-elements summary | targetmap | ✓ | H | 06 ✅0.8.25 |
| 16 | applicable-requirements presentation | output | ✓ | H | 06 ✅0.8.25 |
| 17 | artifact-status / handoff summary | report | ✗ | H | 11 |
| 18 | reviewer-simulation report | report | ✗ | H | 07 |
| 19 | post-approval obligations register | output | ✗ | H | 09 |
| 20 | per-release security-relevance record | output | ◐ | H | 09 |
| 21 | reportable-finding (24h clock) surfacing | output | ✗ | H | 09 |
| 22 | per-cycle report / run-log entry | report | ✗ | H | 09 |
| 23 | agent-utterances artifact | output | ✗ | H | 09 |
| 24 | two-user authorization probe transcript | output | ◐ | H | 09 |
| 25 | test-environment runbook | report | ✗ | H | 09 |
| 26 | run-mode gate | gate | ✓ | M | 01 ✅0.8.22 |
| 27 | deployed-org deep-audit consent (3 variants) | gate | ◐ | M | 06* (core `sf-deep-audit-ops` gate pinned ✅0.8.95; the 3 per-variant option texts remain unpinned) |
| 28 | sf-deep-audit-ops gate family (4 skills) | gate | ◐ | M | 08 |
| 29 | sf-cli-setup consent gate | gate | ◐ | M | 08 |
| 30 | live-endpoint read-only probe gate | gate | ✓ | M | 06 ✅0.8.27 |
| 31 | NEED-FROM-YOU clarification gate | gate | ✓ | M | 06 ✅0.8.27 |
| 32 | scope listing-type + tenancy gate | gate | ✓ | M | 06 ✅0.8.27 |
| 33 | router-mode "where are we?" status | output | ✓ | M | 05 ✅0.8.24 |
| 34 | end-of-run audit recap + verdict | report | ✓ | M | 04 ✅0.8.24 |
| 35 | ledger-freshness note | report | ✓ | M | 03 ✅0.8.23 |
| 36 | path-to-green checklist + per-finding line | report | ◐ | M | 10 |
| 37 | PENDING-OWNER-RUN.md runbook | report | ◐ | M | 10 |
| 38 | Checkmarx portal-run prediction file | report | ◐ | M | 11 |
| 39 | artifact-gate verdict surfaced | gate | ◐ | M | 11 |
| 40 | three-bucket artifact partition display | targetmap | ✗ | M | 11 |
| 41 | AuthN/AuthZ WITHHELD placeholder | output | ✗ | M | 11 |
| 42 | cross-read consistency result | report | ◐ | M | 11 |
| 43 | listing-direction + MCP auth profile | output | ✓ | M | 06 ✅0.8.25 |
| 44 | live MCP-probe result | report | ✓ | M | 06 ✅0.8.25 |
| 45 | SF-CLI auto-resolution flags + conflicts | report | ✓ | M | 06 ✅0.8.25 |
| 46 | permission-chain battery (install-verify) | report | ✗ | M | 08 |
| 47 | zero-residue battery (teardown) | report | ✗ | M | 08 |
| 48 | install/uninstall integrity report | report | ✗ | M | 08 |
| 49 | per-category status matrix (§9.3 vs verdict) | report | ◐ | M | 10* |
| 50 | shared run-log entry (cross-skill) | report | ✗ | M | 09 |
| 51 | per-finding ledger digest line | output | ◐ | L | 12 |
| 52 | baseline-staleness / currency warning | report | ✗ | L | 11 |
| 53 | auth-flow selection gate (bootstrap) | gate | ✗ | L | 08 |
| 54 | org-fleet verification readout | report | ✗ | L | 08 |
| 55 | deployed-package ledger fold + run-log | report | ◐ | L | 08 |
| 56 | run-scans missing-manifest degraded prompt | gate | ✗ | L | 06* |
| 57 | prepare-test-env component-applicability gate | gate | ◐ | L | 09* |
| 58 | SCI block — EXEMPLAR (already pinned) | output | ✓ | L | 12 |
| 59 | checklist/questionnaire/tracker (pinned) | output | ✓ | L | 12 |
| 60 | FP dossier + per-artifact docs (pinned) | output | ✓ | L | 12 |

`*` = the surface's gate is registered in the gate-spec catalog (WI-00A) even
though its primary WI is listed; the WI owns the render, gate-spec owns the
options.

## Constraints

- **Campaign-safe to build now.** These ship on the repo (→ 0.8.22+) but the
  deployed host keeps running the cached campaign plugin until a manual
  `plugin update`. Presentation-only → the finding band is unchanged, so the
  0.8.21 tag still certifies it; do NOT re-run the campaign for these.
- **No silent behavior change.** Pinning a gate's options must preserve the
  consent semantics (`record-consent` token, `sf-ops-gate-hook` fail-closed).
  The gate-spec only fixes WHICH options appear and their wording.
- Every WI ships with a standing test; CHANGELOG + CONVENTIONS + acceptance
  README counts updated in the same changeset.

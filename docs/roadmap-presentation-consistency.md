# Roadmap — Presentation Consistency (pin the operator-facing surfaces)

**Status:** Slice 1 — **WI-00A + WI-01 + WI-02 shipped in 0.8.22** (2026-06-25). WI-00B
and WI-03…WI-12 remain backlog. Sequenced AFTER the
0.8.21 cold campaign tags — these are presentation-only changes that do NOT
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

### (2) Output render-verbatim substrate  (WI-00B)
Two flavors, both render-verbatim:

- **Render harnesses** for surfaces backed by deterministic JSON — extend
  emitters with a fixed-block mode the way `compute-sci.mjs` already does
  (`finding-clusters.mjs --headline`, `recurrence-confidence.mjs --render`,
  `applicable-requirements.mjs --render`, `ledger-staleness.mjs` non-json) +
  new `render-*.mjs` siblings (`render-target-map`, `render-preflight`,
  `render-scan-status`, `render-scope`, `render-stability`, `render-summary`,
  `render-findings`).
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
| 00B | output render-verbatim substrate (`templates/operator/` + renders + lint) | the output class | high | M |
| 01 | pin the 3 preflight gates (run-mode / audit-tier / scanner-install) | 26, 01, 02 | high | S |
| 02 | audit-launch gate: confirm the locked tier, don't re-ask | 01 | high | S |
| 03 | template the readiness-verdict (fixed skeleton) | 10, 11, 35 | high | M |
| 04 | pin finding-cluster headline + target-map approval display | 08, 12, 34 | high | M |
| 05 | pin preflight 3-tier report + scan-status summary | 07, 13, 33 | high | M |
| 06 | pin scope-submission surfaces (detected-elements, applicable-reqs, MCP probe, auto-resolve, confirm gate + scope gates) | 06,15,16,44,45,43,05,32 | high | L |
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

### WI-03 — template the readiness-verdict
`templates/operator/readiness-verdict.md.tmpl` (mirror
`readiness-tracker.md.tmpl`) with fixed `##` headers in fixed order: SCI block
slot (paste compute-sci stdout byte-for-byte), Ledger Freshness, Finding
Stability (`render-stability` output), Per-category, Blockers (`render-findings`
canonical lines), NOT-verified, Open conflicting baseline, Standing caveat
(canonical constant string). Add `harness/render-stability.mjs` (two-branch
fixed block over `recurrence-confidence` JSON). Rewrite compile-submission
Step 8 to fill slots + print verbatim. **Test** render twice on a frozen
fixture → byte-identical; section order; SCI slot equals compute-sci stdout;
standing caveat equals the committed constant; no `{{...}}` survives.

*(WI-04…WI-12 detail: see the synthesis result captured for this roadmap;
each follows the same render-harness-or-template + standing-test pattern.)*

## Inventory — all 60 surfaces (condensed)

`status`: pinned ✓ / partial ◐ / improvised ✗. `risk`: H/M/L.

| INV | Surface | Kind | Status | Risk | WI |
|-----|---------|------|--------|------|----|
| 01 | audit-tier/depth gate (cross-skill, re-asked) | gate | ✓ | H | 01,02 ✅0.8.22 |
| 02 | scanner-install network-fetch gate | gate | ✓ | H | 01 ✅0.8.22 |
| 03 | throwaway-DAST consent gate | gate | ◐ | H | 06* |
| 04 | sf-package-promote permanence consent | gate | ◐ | H | 08 |
| 05 | scope partner-program preflight gates (6) | gate | ◐ | H | 06 |
| 06 | final scope-manifest summary + confirm | verdict | ✗ | H | 06 |
| 07 | one-page preflight 3-tier report | report | ◐ | H | 05 |
| 08 | finding-cluster triage headline | report | ◐ | H | 04 |
| 09 | synthesis audit report (§9 body) | report | ◐ | H | 10 |
| 10 | readiness-verdict wrapper | verdict | ◐ | H | 03 |
| 11 | Finding Stability (N-run consensus) | report | ✗ | H | 03 |
| 12 | target-map approval display | targetmap | ◐ | H | 04 |
| 13 | scan-status summary | output | ✗ | H | 05 |
| 14 | submission-package INDEX.md | targetmap | ◐ | H | 10 |
| 15 | detected-architecture-elements summary | targetmap | ◐ | H | 06 |
| 16 | applicable-requirements presentation | output | ◐ | H | 06 |
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
| 27 | deployed-org deep-audit consent (3 variants) | gate | ◐ | M | 06* |
| 28 | sf-deep-audit-ops gate family (4 skills) | gate | ◐ | M | 08 |
| 29 | sf-cli-setup consent gate | gate | ◐ | M | 08 |
| 30 | live-endpoint read-only probe gate | gate | ✗ | M | 06* |
| 31 | NEED-FROM-YOU clarification gate | gate | ✗ | M | 06* |
| 32 | scope listing-type + tenancy gate | gate | ✗ | M | 06 |
| 33 | router-mode "where are we?" status | output | ✗ | M | 05 |
| 34 | end-of-run audit recap + verdict | report | ◐ | M | 04 |
| 35 | ledger-freshness note | report | ◐ | M | 03 |
| 36 | path-to-green checklist + per-finding line | report | ◐ | M | 10 |
| 37 | PENDING-OWNER-RUN.md runbook | report | ◐ | M | 10 |
| 38 | Checkmarx portal-run prediction file | report | ◐ | M | 11 |
| 39 | artifact-gate verdict surfaced | gate | ◐ | M | 11 |
| 40 | three-bucket artifact partition display | targetmap | ✗ | M | 11 |
| 41 | AuthN/AuthZ WITHHELD placeholder | output | ✗ | M | 11 |
| 42 | cross-read consistency result | report | ◐ | M | 11 |
| 43 | listing-direction + MCP auth profile | output | ◐ | M | 06 |
| 44 | live MCP-probe result | report | ◐ | M | 06 |
| 45 | SF-CLI auto-resolution flags + conflicts | report | ✗ | M | 06 |
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
  droplet keeps running the cached campaign plugin until a manual
  `plugin update`. Presentation-only → the finding band is unchanged, so the
  0.8.21 tag still certifies it; do NOT re-run the campaign for these.
- **No silent behavior change.** Pinning a gate's options must preserve the
  consent semantics (`record-consent` token, `sf-ops-gate-hook` fail-closed).
  The gate-spec only fixes WHICH options appear and their wording.
- Every WI ships with a standing test; CHANGELOG + CONVENTIONS + acceptance
  README counts updated in the same changeset.

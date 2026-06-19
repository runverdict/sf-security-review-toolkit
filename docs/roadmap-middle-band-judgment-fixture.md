# Roadmap — the middle-band "judgment" fixture (the test that proves the differentiating value)

**Status: design (a response to the 2026-06-19 cold validation + an external critique).
Not yet built.** This is the next high-value validation artifact after the v0.7.0 cold
run. Build + cold-validate it in its own session.

## The gap this closes

The v0.7.0 cold run on `~/srt-coldstart-full` (Atlas) landed at **SCI 6% / BLOCKED** — a
catastrophe-tier package (unauthenticated SSRF, SQLi, live secrets, an unbuilt package).
That run proved a lot that's hard to prove: the autonomous end-to-end loop, the enforced
honesty gates firing live (AuthN/AuthZ withheld over 40 open authz findings), the
verifiers refuting 15 over-claims with stated reasons, the self-catch on the README→code
tool-count drift, the credential contract holding off disk. **All real, all validated.**

But it tested the *easy* end of the spectrum. A catastrophe scores near-0 the way a clean
package scores near-100 — neither requires fine-grained judgment. **The product lives or
dies in the band between them:** the *almost-ready* package where the call between
"blocker" and "hardening item" is genuinely contestable, where path-to-green is three
subtle items rather than six obvious fires, and where a reasonable engineer could disagree
with the triage — and the toolkit still has to be right. That's the call a security-review
consultant actually gets paid for, and we have **zero evidence the toolkit makes it well**,
because we've never built the target that forces it.

A tool that correctly says "this dumpster fire is a dumpster fire" is reassuring but not
differentiating. A tool that correctly says "you're closer than you think — here are the
three things between you and ready" is the one a partner pays attention to, and it's the
harder thing to get right.

## Why this is a real test, not just a debate point

Our SCI is a **mechanical** completeness rollup (% of applicable requirements with
reviewer-reproducible evidence). A mostly-compliant package lands in the middle band
*mechanically*. The **judgment** that matters lives one layer down:

- the audit's **severity calibration** — is this missing FLS check a `high` blocker or a
  `low` hardening item? is this open-redirect exploitable or defanged by a referrer check?
- the verifiers' **precision on a *subtle* false positive** — not the obvious "ids are
  org-scoped" refutation (which the catastrophe run already showed), but a finding that
  *looks* like a blocker and has a real compensating control the skeptic has to find;
- the **SCI math in the middle** — partial-credit, `statically-cleared` vs satisfied, the
  currency floor — exercised where it actually bends, not pinned at 6% or 100%;
- the **path-to-green** being *short and prioritized* (3 subtle, ordered items) rather than
  a wall of fires;
- the verdict landing on **"closer than you think"** with a defensible blocker set.

## The fixture design

A synthetic package (name TBD — e.g. "Solano") deliberately seeded to land at **SCI
~65–75%**: *mostly compliant* (CRUD/FLS enforced, with-sharing, no injection, no live
secrets, scans largely clean, artifacts mostly present) **plus a small set of genuinely
contestable issues**. A new fixture-issue category sits between the existing two:

| existing | new (this fixture) |
|---|---|
| **planted needle** — an unambiguous blocker (SSRF, live secret) | **contestable issue** — a call a reasonable engineer could argue either way; the toolkit must be *right or defensibly consistent* |
| **negative control** — clearly safe; flagging it is a precision miss | (still used — but the new bar is the *tempting* near-control) |

Seed ~4–6 contestable issues, each targeting a distinct judgment axis:

1. **Severity-boundary** — a missing FLS check on a field whose sensitivity is arguable
   (is it `high` or `low`?). Tests calibration, not detection.
2. **Tempting false positive** — a `without sharing` class that *looks* like IDOR but has a
   real upstream ownership filter the skeptic must read to refute. Tests adversarial-verify
   precision on a *subtle* case.
3. **Fix-vs-document** — a DAST/Checkmarx medium that's arguably acceptable-with-
   justification (the published bar says investigate, not necessarily fix). Tests the
   disposition discipline on the gray-zone bar.
4. **Partial / stale evidence** — a requirement with evidence that exists but is scoped
   narrower than the architecture, or older than the freshness window. Tests partial-credit
   + the staleness/currency handling in the SCI.
5. **Near-ready package state** — a *promoted, installable* version (so the deep-audit path
   is exercised) with one real but non-catastrophic deployed-artifact finding.

Authoring rule: every contestable issue carries a **sealed adjudication** in the off-fixture
grading key — *the intended call + why* — so the cold run is graded against a pre-committed
judgment, not a post-hoc rationalization. Where the call is genuinely 50/50, the bar is
**defensible consistency** (the toolkit's reasoning holds up), not a single "correct" answer.

## What a passing run looks like

- SCI lands in **65–75%** (not pinned at an extreme) — the mechanical rollup bends correctly.
- The **severity calls match the sealed adjudications** (or are defensibly reasoned where 50/50).
- The **tempting FP is refuted** by a verifier that read the compensating control — and the
  **near-control is NOT flagged** (precision on the subtle case, the load-bearing result).
- `path-to-green` is **short, ordered, and subtle** — the "three things between you and
  ready," not a fire list.
- The verdict reads as **"close, here's the gap"** — the consultant-value call.

## Honest ceiling (the authorship caveat survives)

Even a middle-band fixture is **self-authored**: the same threat model that seeds the
contestable issues wrote the dimensions that adjudicate them, so this tests *judgment on
anticipated classes*, not *coverage of novel ones*. The only thing that tests coverage is a
real external review catching what we missed — which is exactly what
`methodology/known-escapes.md` is seeded-empty to capture, and which only the eventual live
Salesforce pen test of a package this toolkit prepped will provide. **What the middle-band
fixture *does* break through:** precision-and-calibration on the *subtle* case is far more
authorship-independent than recall (a clean method that doesn't over-fire on a tempting-but-
safe pattern, and calibrates severity defensibly, is a real signal even on a self-authored
target). It is a strictly better test of the differentiating capability than the catastrophe
run — just not a coverage proof.

## Build + validate (next session)

1. Author the fixture (extend `acceptance/generate-fixture.mjs` or a new generator) — a
   mostly-compliant package + the 4–6 contestable issues + the sealed adjudication key
   (off-fixture, like `~/coldstart-full-grading-key.md`).
2. Sanity-check the band **deterministically** first: hand-author a representative ledger →
   `compute-sci.mjs` → confirm it lands ~65–75% before the expensive cold run.
3. **Cold-run it** (fresh session, 0 context, the cold-start discipline) → grade off disk
   vs the sealed adjudications: severity calls, the subtle-FP refutation, the near-control
   precision, the SCI band, the path-to-green shape.
4. Every miscalibration → sharpen the dimension's severity heuristics / the verifier's
   refute rules (the fixture, like the others, drives engine hardening) → re-run.

## Adjacent open items (separately tracked)
- **Scale story** (a fair external question): the audit fan-out scales with surface
  (~2.65M tok / 92 agents on ~7 files). The knobs exist — `quick/standard/exhaustive` tiers
  + the incremental ledger (re-runs only re-audit changed dimensions) — but a **large-target
  stress test** (a 100+ class package) has not been run. Worth a deliberate run + a documented
  "what it costs at scale, and how to dial it" note. Scope the value prop honestly: *no
  marginal cost on Claude Max*, not "free" universally.
- **slice-5b** — authenticated, endpoint-fed AF-plan DAST depth (token minted from the
  throwaway's own synth secret; the prototype proved `docker exec` minting works).

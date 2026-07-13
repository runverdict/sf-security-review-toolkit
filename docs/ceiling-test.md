# The ceiling test — a falsification test of the toolkit's strongest claim

**Status: NEGATIVE RESULT, PUBLISHED. The test REFUTED the claim it was built to confirm.**
This document is the public record of that experiment: the hypothesis, the bar written
before the runs, the result, and the product position the result forced. The tag stays
**HELD** because the claim that would justify it did not survive the test.

> *Addendum (2026-07-13): `v0.9.0` was tagged under the **scoped claim** of §6 — the toolkit
> reliably finds the unambiguous blockers and builds the evidence pack, while the
> contestable-severity band remains an incomplete, unstable sample needing repeated runs plus
> human adjudication. The strong claim this test refuted remains refuted and untagged; the
> tag-HELD statements in this document are preserved verbatim and record the 2026-06-23 state.*

## 1. What this is

The toolkit's strongest selling point was a claim about its ceiling: *run the full
pipeline at maximum rigor and it reliably calls the hard, contestable severities, so the
human is left only with accountability, not detection.* That claim is the one that would
let the toolkit say "we got you to the fine calls." It is also the one most worth being
wrong about, because a partner who believes it would stop running and submit on a single
pass.

So it was tested against a pre-committed bar — and it failed. Rather than quietly
restating the value proposition around the failure, the experiment and its negative
result are published here. For a tool whose entire value is honesty about a high-stakes
gate (CONVENTIONS §2), a published falsification of its own headline claim is the
differentiator, not an embarrassment: it is the evidence that the toolkit's scope was set
by a result, not by marketing. The toolkit's recall against its *known* failure classes
is measured by the acceptance harness; its recall against *unknown* classes is tracked
honestly-empty in `methodology/known-escapes.md`; and the run-to-run *stability* of its
contestable-band calls is the property this test measured. All three floors are stated
out loud on purpose.

## 2. The hypothesis

> **At exhaustive depth, the full generate → verify → synthesize pipeline reliably calls
> the contestable-severity band.**

This is a deliberately stronger claim than the one the toolkit had already proven, and
the two must not be conflated:

- **Proven separately (not under test here): multi-vote stabilizes an *isolated*,
  pre-identified finding.** Hand a fixed finding to N independent verifier votes and the
  adjudicated severity converges. That is a property of the *verification* step operating
  on an input the run already surfaced.
- **Under test here: the full pipeline reliably *surfaces* the same contestable findings,
  at the same severities, run-to-run.** This is a property of the **generation** step —
  whether independent cold runs of the same code even produce the same finding set to
  adjudicate. The variance, if any, lives upstream of the vote: in what the finders raise
  and what the verifiers confirm, not in how a fixed candidate is scored.

The distinction is the whole experiment. A clean per-run severity read does not earn the
strong claim if the finding *set* the runs feed into that read churns. The hypothesis is a
claim about the pipeline as a whole, and the pipeline's generation step is where the risk
sits.

## 3. Method

- **N = 3 independent cold runs at exhaustive depth over identical fixture code.** The
  fixture is the toolkit's own **Solano** middle-band judgment fixture, built on demand by
  `acceptance/generate-solano-fixture.mjs` (never committed). Every run audited the same
  unchanged code at the same commit; only the run was independent — fresh terminal,
  separate agent state, the plugin pinned, the toolkit's run-state wiped before each run,
  audit depth set to exhaustive, and each run's ledger preserved before the next run wiped
  state.
- **A two-axis pass/fail bar, written and committed BEFORE run #1.** The bar (§4) was
  fixed on paper before any output existed, and held off the toolkit repo on purpose —
  the same isolation as a sealed answer key — so the cold run's plugin cache could not
  read the standard it was being graded against. The standard could not move after seeing
  the result.
- **Graded off disk, two axes reported separately, never collapsed.** One axis grades the
  finding *set* (the runs against each other); the other grades *severity* (each run
  against a blind truth). They are reported apart because they fail apart, and collapsing
  them would let a clean read on one hide a failure on the other.
- The per-run ledgers and the one-off grader used to score them are **local audit
  artifacts, not committed** — they carry fixture-coupled keying that is forbidden in
  shipped code (CONVENTIONS §3). The shipped, general re-derivation (§5) uses the
  fixture-agnostic engine that ships in the repo.

## 4. The pre-committed bar

Two axes, each with its own pass condition. A finding is keyed by **root cause**
(normalized file + location + issue-class); a cross-dimension merged entry counts as one
root cause.

| Axis | Measures | PASS condition | FAIL condition |
|---|---|---|---|
| **Axis 1 — generation-set stability** | the confirmed finding *set*, runs vs. each other | every critical/high root-cause recurs in **all 3** runs (none present in one run but absent in another) **and** pairwise Jaccard of the full confirmed set **≥ 0.70** | any critical/high present in some runs but not others (a partner gets a different blocker list each run), **or** pairwise Jaccard **< 0.70** |
| **Axis 2 — severity stability + correctness** | severity *within* recurring findings, each run vs. blind truth | **(a) consistency** — every finding recurring in ≥ 2 runs carries the **same** adjusted severity in each; **and (b) correctness** — the contestable anchors match blind truth | a recurring finding gets **different** severities across runs, **or** a contestable anchor is **consistently mis-called** (stable-but-wrong is still a fail) |

The **blind truth** for the contestable anchors was fixed from the fixture's sealed
adjudication key plus an external reviewer's blind multi-vote (independent judges scoring
each anchor with no access to the key), role-described here:

| Anchor (role) | Blind truth |
|---|---|
| an FLS gap on a without-sharing controller's detail method | **HIGH** — Code-Analyzer-corroborated |
| a view-all-records over-grant on an end-user permission set | **HIGH** — blind multi-vote unanimous |
| a second controller exposing contact PII without field-level security | **HIGH** — a real FLS gap |
| a webhook rate-limit / HMAC-compute concern | **not-a-finding / low** — availability ≠ security |
| background-worker findings (DB-URL validation, no-caller tenant binding, missing grant) | **not high** — refuted / low / info |

The verdict was pre-committed so the result would interpret itself:

| Outcome | Reading | Tag |
|---|---|---|
| Axis 1 ✓ **and** Axis 2 ✓ | **strong claim earned** — at exhaustive the toolkit calls the contestable band reliably; the human is left with accountability | tag the release |
| Axis 1 ✗ **and** Axis 2 ✓ | weaker, still honest — exhaustive stabilizes the *call* but not the *catch*; run N times before the submit decision because the finding set is not trustworthy single-shot | no tag |
| Axis 2 ✗ (either sub-condition) | **the hard ceiling** — exhaustive does **not** reliably call the contestable band even at maximum rigor; scope the value to "gets you to the fine calls, then a human makes them" | no tag |

## 5. The result — both axes FAILED

The as-graded refutation, leading with the original pre-committed grader (root-cause keyed
by issue-class):

### Axis 1 — the finding set drifts

**Pairwise Jaccard, every pair below the 0.70 bar**, by two independent matchers:

| Run pair | as-graded (issue-class root-cause key) | shipped engine (locus key) |
|---|---|---|
| run 1 vs. run 2 | **0.56** (shared 5 / union 9) | **0.40** (shared 4 / union 10) |
| run 1 vs. run 3 | **0.67** (shared 6 / union 9) | **0.67** (shared 6 / union 9) |
| run 2 vs. run 3 | **0.44** (shared 4 / union 9) | **0.44** (shared 4 / union 9) |

The bar required ≥ 0.70 for the strong claim. Both matchers land well under it; the one
divergence (run 1 vs. 2: 0.56 graded, 0.40 by locus) is a keying difference — the grader
collapses by canonical issue-class, the shipped engine keys by overlapping line-span and
reconciles absolute-vs-relative path cites — and both fail the bar by a wide margin.

The **high set itself churns**, which is the more damaging half of the Axis-1 failure: only
**one** high recurs in all three runs.

| Finding (role) | Blind truth | run 1 | run 2 | run 3 |
|---|---|---|---|---|
| FLS gap, without-sharing controller detail method | HIGH | high | high | high |
| view-all over-grant, end-user permission set | HIGH | medium | high | medium |
| second controller, contact PII without FLS | HIGH | high | *(refuted)* | high |
| AI prompt template, static enclosure delimiter | precision item | info | high | low |
| webhook rate-limit / HMAC-compute | not-a-finding / low | medium | *(refuted, info)* | *(refuted, low)* |
| LLM denial-of-wallet | low | low | low | medium |
| background-worker DB-URL validation | not high | — | — | medium |
| background-worker unbounded query (missing `LIMIT`) | low | low | — | low |
| dead-integration named credential | — | — | low | — |
| Dockerfile `NODE_ENV` | hardening | low | — | — |

Read down the columns: a partner running the pipeline once gets a **different blocker
list each time.** The contact-PII high — a genuine FLS gap — is confirmed in runs 1 and 3
and **refuted in run 2**; the view-all over-grant, blind-truth HIGH, is called HIGH in
only one of three runs. Findings appear and vanish: a worker DB-URL finding only in run 3,
a named-credential finding only in run 2, a Dockerfile finding only in run 1.

### Axis 2 — severity is unstable AND mis-called

Both sub-conditions fail.

- **Consistency fails.** Multiple findings that recur and stay confirmed carry *different*
  adjusted severities across runs: the view-all over-grant swings **medium / high /
  medium**; the prompt-template delimiter swings **info / high / low** (the full width of
  the scale); the LLM denial-of-wallet swings **low / low / medium**.
- **Correctness fails.** The view-all over-grant is blind-truth **HIGH** but is called
  **MEDIUM in two of the three runs** — a contestable anchor mis-called in the majority,
  not merely wobbling. In the over-call direction, the webhook (blind not-a-finding/low)
  is **over-confirmed at MEDIUM** in run 1, and a background-worker DB-URL finding (blind
  not-high) is **over-called MEDIUM** in run 3.

### The shipped engine corroborates, and isolates the one stable blocker

Re-derived with the fixture-agnostic engine that ships in the repo
(`harness/recurrence-confidence.mjs`, run over the same three ledgers), the load-bearing
facts hold and the divergence is only in keying, not in conclusion: confirmed-per-run
**8 / 6 / 7**, pairwise Jaccard **0.40 / 0.67 / 0.44**, commit-consistency **`consistent`**
(all three runs at one commit, so this is instability, not a code change between runs). The
engine independently finds **exactly one** reliably-recurring blocker — the
without-sharing-controller FLS gap, confirmed high in all three runs — and classifies every
contestable anchor as `all_runs` *in appearance* but `confidence=review`: the over-grant
(severity flips medium/high/medium), the prompt delimiter (info/high/low), the contact-PII
high (status flips confirmed → refuted → confirmed), and the webhook (confirmed → refuted →
refuted). Method note: the as-graded numbers come from the original pre-committed grader
(issue-class root-cause keying); the re-derivation comes from the shipped engine (general
locus-based matching, no fixture coupling), and the two agree that every Jaccard pair sits
below the bar.

### The verified mechanism

The drift was **not** a single false claim that one run happened to make. It is three
compounding effects, each verified in the ledgers:

1. **Genuine generation churn** — the finding *set* differs run-to-run. A real contact-PII
   high blinks out of the confirmed set in run 2; a worker DB-URL finding surfaces only in
   run 3; a named-credential finding only in run 2; a Dockerfile finding only in run 1.
   The pipeline's generation step does not converge on one set.
2. **A reachability-vs-exposed-surface contestability** — several anchors are genuinely
   arguable on whether the vulnerable surface is reachable, and that judgment moves the
   severity. The verifier reaching a different reachability call between runs is what
   produces a confirmed→refuted flip on the same code.
3. **Severity instability on the contestable anchors** — even where a finding recurs and
   stays confirmed, its adjusted severity is not stable (the over-grant's medium/high/medium
   is the cleanest example).

Generation churn, a contestable reachability call, and unstable severity together are the
failure; no one of them alone explains it.

## 6. Verdict and honest scope

Axis 2 failed, so the pre-committed verdict resolves to **the hard ceiling**:

> **At exhaustive depth — the toolkit's maximum rigor — the full pipeline does not
> reliably call the contestable-severity band.**

The scoped, true claim that follows, and that the README and product now state, is:

- The toolkit **reliably finds the unambiguous blockers and builds the evidence pack.**
  The one finding that recurred high in every run — the without-sharing-controller FLS gap
  — is the shape of what it catches dependably.
- The **contestable-severity band is an incomplete, unstable sample.** It needs **repeated
  runs plus human adjudication**; a single exhaustive pass is one draw from a distribution,
  not a complete answer.
- **No fixed run-count is certified complete.** Running N times reduces the chance of
  missing a contestable finding but never closes it; the toolkit must not — and does not —
  imply "run N times and you are safe."
- **Salesforce pen-tests regardless.** The toolkit prepares a submission; it does not pass
  one.

This is why the release tag is **HELD**: the claim that would have justified the tag is
the one this test refuted.

## 7. The product response

The result is not just narrated; the product encodes it, so a partner sees the variance
instead of inheriting a buried surprise. The mechanism is documented in full in
[`docs/recurrence-confidence.md`](recurrence-confidence.md):

- **The recurrence-confidence engine** (`harness/recurrence-confidence.mjs`) takes N
  independent run-ledgers of the same code and classifies each finding by how reliably it
  recurred — `all_runs` / `some_runs` / `single_run`, with `confidence=high` reserved for
  the `all_runs` + confirmed-every-run + severity-stable **reliably-recurring blocker** set
  and everything else marked `review` / `investigate`, the contestable band the human owns.
- **`audit-codebase` step 9** archives each independent run's ledger and runs the engine
  when ≥ 2 snapshots at the same commit exist — distinct from the fix → re-run loop (step
  8, which changes code between passes), and never auto-orchestrated.
- **`compile-submission`** renders an informational **"Finding Stability (N-run
  consensus)"** section from that artifact; it never moves the Submission Completeness
  Index or clears a blocker.

This is a **different instrument** from `methodology/known-escapes.md`, and the two must
not be confused. Known-escapes tracks recall against **novel finding classes** — the
coverage gaps a real review surfaces that the toolkit never had a probe for. The
ceiling test and the recurrence engine track **run-to-run stability of the contestable
band** — the variance *within* the classes the toolkit does surface. One measures whether
the net has a hole; the other measures whether the net catches the same thing twice.

## 8. Reproduce it

The experiment is reproducible from a clean checkout:

1. **Generate the fixture** — `node acceptance/generate-solano-fixture.mjs` builds the
   Solano fixture on demand (it is never committed).
2. **Run the audit N times at exhaustive on the unchanged fixture.** Each independent run
   is archived by `audit-codebase` step 9 to `.security-review/runs/run-<k>/` — same code,
   same commit, independent runs.
3. **Classify** — `node harness/recurrence-confidence.mjs --ledger <run-1> --ledger
   <run-2> --ledger <run-3>` produces the per-locus recurrence classification, the
   reliably-recurring blocker set, and the pairwise Jaccard. A run set this unstable
   reproduces a single `confidence=high` locus and every Jaccard pair below 0.70.

---

*Provenance: this document derives from three independent cold-at-exhaustive run-ledgers of
the Solano fixture, graded against a bar committed before the first run (2026-06-22) and
re-derived with the shipped recurrence-confidence engine (2026-06-23). The per-run ledgers
and the one-off grader are local audit artifacts, not committed (CONVENTIONS §3). The
result refuted the toolkit's strongest claim; the scope in §6 and the tag-HELD status are
the honest consequence. See [`docs/recurrence-confidence.md`](recurrence-confidence.md) for
the engine this result motivated.*

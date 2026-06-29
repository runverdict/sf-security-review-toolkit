# Recurrence-confidence — classifying findings by how reliably they recur

**Status: ENGINE SHIPPED + SKILL-WIRED on `main` (built 0.8.7, wired end-to-end 0.8.10, UNTAGGED).**
Invoked live by `audit-codebase` (step 9) and read by `compile-submission`; the release tag stays
HELD with the rest of the 0.8.x arc (the claim that holds the tag is the [ceiling test](ceiling-test.md),
not this engine).

This is the contract for `harness/recurrence-confidence.mjs` — the deterministic engine
that takes N independent audit-ledgers of the **same** codebase and classifies each
finding by how reliably it recurred across the runs. It is the descriptive counterpart
to the load-bearing refutation result below: it makes the audit's run-to-run variance a
**visible output**, not a buried surprise.

## 1. Why this exists — the load-bearing result

The toolkit runs an autonomous multi-agent white-box audit (find → adversarially verify
→ synthesize) and writes an audit ledger. A "cold-at-exhaustive" test ran the **full
pipeline three times over identical code** and graded the results against a
pre-committed bar. It **refuted** the strong claim that "at exhaustive the toolkit calls
the contestable-severity band reliably":

- The confirmed-finding **set drifted** run-to-run — pairwise Jaccard **0.44–0.67**
  (the bar required ≥ 0.70 for the strong claim).
- Individual findings **wobbled**: a real contact-PII high was confirmed in one run and
  refuted in another; a permission-set view-all over-grant swung **medium / high / medium**
  across the three runs; a prompt-template delimiter finding swung **info / high / low**.

The honest product position is now locked, and this engine encodes it rather than
narrating it: the toolkit **reliably finds the unambiguous blockers and builds the
evidence pack**, but the **contestable-severity band is an incomplete, unstable sample**
that needs **repeated runs plus human adjudication**. No fixed run-count is certified
complete, and Salesforce performs its own penetration test regardless.

The full ceiling-test publication — the pre-committed bar, the three-run result, and the
product position it forced — is published in [`docs/ceiling-test.md`](ceiling-test.md), the
**motivating result** for this engine; this document specifies only the engine that
consumes the run-ledgers.

## 2. What the engine does

Inputs are N ledger file paths in run order (1-based); the output is one JSON object,
sorted by locus for byte-stability, written to stdout and (with `--out`) to
`<target>/.security-review/recurrence-confidence.json`:

```
node harness/recurrence-confidence.mjs --ledger <p1> --ledger <p2> [--ledger <pN> …] [--out <path>]
```

It is **pure, deterministic, dependency-free**: no LLM, no network, no learned weights;
the same N ledgers in produce byte-identical JSON out (CONVENTIONS §7 — determinizable
honesty claims are engine-backed, not narrated). It **fails closed**: every incoming
JSON field is `Array.isArray`-guarded (a ledger whose `findings` is a dict-shaped
payload contributes zero findings rather than crashing), and a missing / unreadable /
non-JSON ledger path is `exit 2` — you cannot classify recurrence over a phantom run.

## 3. The match key — locus-based, and why it diverges from the grader

`finding.id` is **unusable across runs**. It is `SHA256(strippedFile + '\n' +
normalizedTitle)`, and finder titles are model prose that varies run-to-run, so the same
defect gets a **different id in every run** (empirically the controller-FLS finding
carried three different ids across the three runs). The grader script `grade-solano.py`
keys by `normalized_file + location + issue-class`, but its `canon()` hard-codes
fixture-specific issue-classes (`if 'opportunitycontroller' in fn …`) — a grading hack
that is **forbidden in shipped code** (CONVENTIONS §3, no partner/fixture coupling).

So the engine reuses the **proven, tested** locus primitives from
`harness/finding-clusters.mjs` (`normFile`, `lineSpan`, `spansOverlap`, exported in
0.8.7) and matches two findings as the **same locus** iff:

> their files name the **same code path** (basename equal, and the shorter
> path-segment list is a tail of the longer) **and** their **line spans overlap**.

This mirrors `sameLocation()` in `finding-clusters.mjs`. It is general (no fixture
coupling), deterministic, and reuses code that already carries an over-merge guard. It
fails toward **under-matching** — a defect cited at non-overlapping lines, or one path
that is not a suffix of the other, lands in `some_runs` / a separate locus rather than
being falsely fused into `all_runs`. **Under-confidence is the safe failure; false
confidence is the forbidden one** (the same M10/M11 invariant the cross-dimension merge
already enforces).

### 3.1 Path-suffix reconciliation (a necessary extension over plain `normFile` equality)

Real run-ledgers cite the **same file at different path depth**: one run repo-relative
(`force-app/.../X.cls`), another absolute (`home/u/proj/force-app/.../X.cls`).
`normFile` only strips the trailing `:line` suffix, so plain string equality would split
one defect across runs and miscall a stable blocker as `some_runs`. The engine
reconciles this **generically** by path-segment-**suffix** matching (basename gate +
tail containment) — no absolute prefix is hard-coded, and the canonical display path is
the most repo-relative (fewest-segment) form seen. This is the one deliberate divergence
from "plain `normFile` equality"; the `match_key` field records it as
`"normFile path-suffix + overlapping-line-span (locus-based)"`.

The suffix rule has a **floor** to keep it from over-merging. **Exact** path equality
(identical segment lists, any length) always matches — so a root-level single-segment
file like `Dockerfile` cited identically in two runs stays one locus. But at **differing
depth**, the shorter segment list must have length **≥ 2** (a basename *plus* at least
one parent directory) before it counts as a tail of the longer. Without that floor a
**bare basename** would bridge unrelated files: `package.json` would match both
`frontend/package.json` and `backend/package.json`, and single-linkage clustering would
fuse three genuinely different files into one `all_runs` / `confidence=high` locus —
**false confidence, the forbidden direction** (over-merge can hide a distinct finding;
the same M10/M11 lesson). The residual: two genuinely different files that share a
≥2-segment tail (e.g. `classes/Foo.cls` living in two directories) could still match —
**acceptable**, because Salesforce class names are unique per namespace and Node parent
directories distinguish them; an ambiguous *short* citation fails toward
under-confidence (a missed merge), never toward false confidence.

### 3.2 Confirmed-anchored clustering (why a broad refuted finding can't fuse two defects)

The engine matches over **all** findings, including refuted ones, so the
confirmed→refuted **flip** is captured — that flip *is* the contestable-band signal. But
a single transitive pass over all findings lets a **broad refuted finding** bridge two
narrow, mutually-disjoint **confirmed** defects into one locus by interval transitivity.
A real example: a service file carries two disjoint confirmed defects — a
credential-validation gap at one line and a missing query bound a few lines below — and a
broad refuted finding (a "no caller authentication at the entry point" claim) whose cited
span covers **both**. A single transitive pass lets that broad refuted span bridge the two
confirmed defects into one locus by interval transitivity, fusing two genuinely separate
defects and hiding one.

The engine therefore clusters in **two phases**:

1. **Anchor** — cluster the confirmed (open) findings transitively by locus. These are
   specific, so disjoint confirmed defects stay separate.
2. **Attach** — each refuted finding attaches to the confirmed locus whose **open
   anchors** it overlaps most (matched against a frozen snapshot of the open members
   only, never against other already-attached refuted findings — so attachment is
   order-independent and cannot re-introduce the bridge). A refuted finding that matches
   **no** confirmed locus (raised-and-refuted, never confirmed anywhere) clusters among
   the other residual refuted findings.

## 4. Classification

Each locus carries per-run `{present, status, adjusted_severity}` (the **authoritative**
`adjusted_severity`, not the finder's `severity`). A run is **present** at a locus if it
raised ≥ 1 finding there (confirmed *or* refuted); a run's status is `confirmed` if it
raised any open finding there (a run that both confirmed and refuted *did* confirm it),
else the strongest non-open status.

| Field | Rule |
|---|---|
| `recurrence_bucket` | `all_runs` if present in every run; `some_runs` if present in ≥2 but < N; `single_run` if present in exactly one. (N=1 ⇒ every locus is `single_run` — one run gives no recurrence signal.) |
| `status_stable` | identical run-status across every run where **present** |
| `severity_stable` | identical `adjusted_severity` across every run where **present-and-confirmed** |
| `confidence` | `high` **iff** `all_runs` **and** confirmed in **every** run **and** `severity_stable`; otherwise `review` (any `all_runs`-but-unstable, or `some_runs`); `investigate` for `single_run` |

`confidence` describes how reliably **that finding** recurred — never global
completeness. The summary's `reliably_recurring_blockers` is the load-bearing set:
`all_runs` + confirmed-every-run + `severity_stable`, critical/high only. That is the set
the toolkit reliably finds; everything else is the contestable band the human owns.

`pairwise_jaccard` reports `|A∩B| / |A∪B|` over each run's **confirmed-locus** set (the
same formula as `grade-solano.py`). It is a **reported metric only** — it gates nothing
and certifies nothing.

## 5. The honesty contract

The output embeds a standing `caveat` and is forbidden from asserting completeness. The
caveat states, verbatim in sense: the all-runs + status/severity-stable set is the
reliably-recurring blocker set; findings outside it (some-runs, or status/severity
flipping) are the contestable band — an incomplete, unstable sample requiring human
adjudication; **no fixed run-count certifies the audit complete**, and Salesforce
pen-tests regardless; this output does not certify the audit complete, passed, or safe.
No field or text may assert the audit is complete, that a "strong claim" is earned, that
"you can stop," a global pass/confidence verdict, or that N runs make coverage certain.
Per the two-axis honesty model the rest of the toolkit follows, the per-locus confidence
is the only confidence signal — there is no global one.

## 6. Validation against the real three-run ledgers

Run against three independent audit runs of the toolkit's fixture, the engine reproduces
the known ground-truth facts (the standing test `acceptance/test-recurrence-confidence.mjs`
encodes these patterns synthetically with generic fixtures; the real-ledger run is the
external confidence check):

| Finding role | Classification |
|---|---|
| a without-sharing controller missing `USER_MODE` on a custom-field query | `all_runs`, confirmed high ×3, `confidence=high` — the one reliably-recurring blocker |
| an end-user permission set with a view-all over-grant | `all_runs`, `severity_stable=false` (medium/high/medium), `confidence=review` |
| an AI prompt template with a static enclosure delimiter | `all_runs`, `severity_stable=false` (info/high/low), `confidence=review` |
| a webhook endpoint missing rate-limiting | `all_runs`, `status_stable=false` (confirmed→refuted→refuted), `confidence=review` |
| a controller exposing contact PII without field-level security | `all_runs`, `status_stable=false` (confirmed→refuted→confirmed), `confidence=review` |

Confirmed-per-run 8 / 6 / 7; pairwise Jaccard 0.40 / 0.67 / 0.44 — consistent with the
0.44–0.67 refutation result. Note that `recurrence_bucket=all_runs` means a locus was
**raised** in every run; it can still be unstable (a status or severity flip), which is
exactly why a separate `confidence` axis is needed — `all_runs` is *appearance*,
`confidence` is *agreement*.

Validated against three independent audit runs of the toolkit's Solano fixture
(`acceptance/generate-solano-fixture.mjs`); the per-run ledgers are local audit
artifacts, not committed.

## 7. Wiring & usage

The engine is wired into the product end to end; it is never auto-orchestrated.

**Archiving runs (`/sf-security-review-toolkit:audit-codebase` step 9).** Each
independent audit run, on reaching its stop rule, snapshots its final
`<target>/.security-review/audit-ledger.json` to
`<target>/.security-review/runs/run-<k>/audit-ledger.json` (`k` = next index). This
is **distinct from the fix → re-run loop (step 8)**: step 8 changes the code between
passes (remediation), so a vanished finding is a fix; step 9 is **independent re-runs
of the SAME unchanged code**, so a vanished finding is run-to-run instability. The
operator initiates each run deliberately — the toolkit never fans out N runs on its
own, and never implies "run N times and you're safe."

**Same-commit requirement + the commit-consistency guard.** A stability read is only
meaningful across runs of identical code. Each run's commit is read from its last
pass's `audited_commit`; the output reports `summary.commit_consistency`
(`consistent` | `mixed` | `unknown`) and `generated_from.runs`. When `mixed`, the
caveat is extended to warn that an appear/disappear may reflect a **code change**
(e.g. a fix that landed between runs) rather than instability — re-run all passes on
one commit for a clean read. This is the honest counterpart to the step-8/step-9
distinction: it prevents the fix-loop's output from being misread as drift. It is
descriptive only and never gates.

**Where the artifact surfaces.** When ≥2 snapshots at the same commit exist, step 9
runs the engine with `--repo-root <target> --out
<target>/.security-review/recurrence-confidence.json`.
`/sf-security-review-toolkit:compile-submission` step 8 then renders a **"Finding
Stability (N-run consensus)"** section in the readiness verdict from that file (or, in
the single-run common case, one honest line pointing back to step 9). That section is
**informational only**: it never alters the Submission Completeness Index, the
`compute-sci` invocation, or the readiness gate. The SCI is still computed from the
audit ledger + evidence index exactly as before; finding-stability never inflates
readiness and never clears a blocker.

**`by_file` rollup.** Because the locus matcher under-merges on the safe side (a
defect cited at non-overlapping spans fragments into separate loci), a human view can
be noisy. `summary.by_file` is a presentation rollup — one row per distinct file with
`locus_count`, a `{high, review, investigate}` confidence tally, and
`has_reliable_blocker` (membership in the reliably-recurring blocker set). It is a view
OVER the per-locus classification, which stays the source of truth; no per-locus result
changes.

**`--repo-root` relativization.** A singleton locus can otherwise keep an absolute
path (e.g. one run cited a file absolutely). `--repo-root <path>` strips that prefix,
segment-aware, from every emitted display path; a path not under the root is left
intact. It affects **display only** — matching runs on the raw paths, so the
classification is identical with or without the flag. A malformed multi-file finder
cite that does not start with the root is correctly left untouched (the safe,
display-only direction).

---

*Engine: `harness/recurrence-confidence.mjs`. Standing test:
`acceptance/test-recurrence-confidence.mjs`. Pure, deterministic, dependency-free; same N
ledgers in → byte-identical JSON out. Authored 2026-06-23 from the Solano
cold-at-exhaustive refutation; wired into audit-codebase (step 9) + compile-submission
(informational) at 0.8.10. The tag stays HELD pending cold validation.*

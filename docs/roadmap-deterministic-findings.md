# Roadmap — Deterministic-engine-grounded findings (provenance-typed blocker band)

> Status: **DESIGN — awaiting operator ratification.** This is the architecture
> the cold campaign pointed to. No builder work starts until the open decisions
> (§8) are locked.

## 1. The problem the campaign proved

Five cold runs of the frozen Solano fixture (commit `512bbe9`, plugin 0.8.21)
graded **FAIL** against the honest bar (`~/solano-honest-bar.md`): the blocker
band is not stable run-to-run. The named anchors, on identical code:

| Anchor | r1 | r2 | r3 | r4 | r5 |
|---|---|---|---|---|---|
| SolanoOpportunityController FLS | high | high | **absent** | high | high |
| Contact-PII FLS | high | medium | low | medium | high |
| C5 ViewAll over-grant | medium | high | critical | **absent** | high |

union-convergence = false (`[9,11,13,13,18]`, still growing at N=5). So "run it
N times and union" is **not** a path to completeness here.

**Root cause (code-proven, off-disk read of the whole data path):** the
audit-ledger findings — the band B1/B2 grade — are **100% LLM-generated**.
Across all 5 ledgers, **0 of 72 findings carry any scanner/engine provenance**
(there is no provenance field in the schema). Two tracks feed the gate and they
never touch:

- **Track 1 (deterministic scanners)** — Code Analyzer / SFGE / PMD, Semgrep,
  OSV, gitleaks, ZAP — land ONLY in `evidence/index.json`
  (`build-evidence-index.mjs`), where they CLEAR a blocker *requirement*
  (`fail-crud-fls`) and feed the SCI %. They never become a finding.
- **Track 2 (the FINDINGS)** — written only by `merge-ledger.mjs` from the LLM
  finder→verifier `ledger_updates` (`workflow-template.mjs:420`). No scanner
  ingress; no `source`/`ruleId` field.

`compute-sci.mjs:125-129` ORs them: `blocked = openBlockerFindings (LLM) ||
openBlockerReqs (scanner-cleared)`.

**Smoking gun (fixrun4):** the LLM verifier REFUTED a real FLS blocker by
asserting "Code Analyzer's SFGE owns this finding" — while no scanner output
existed anywhere. A hallucinated hand-off that dropped a real blocker. And SFGE
is owner-gated (`tool-detect.mjs:33` → `install:'owner'`/PENDING), so it does not
auto-run cold; the LLM dimension fills the vacuum non-deterministically.

## 2. The principle (ported from Verdict's scoring engine)

Verdict scores risk with a **deterministic rule engine**; the LLM only *reads
what the engine produced and explains it* (the invisible-AI / "How we got this"
discipline). Same shape here:

> **Provenance-typed findings.** A deterministic engine produces the data; the
> LLM relays it verbatim and NEVER re-judges existence or severity. The LLM gives
> an opinion only where no engine can decide — and that opinion is EXPLICITLY
> labelled `llm-inferred`. The LLM stays the **driver** (fans out, runs the CLI,
> orchestrates) and the **narrator** — it stops being the *source of truth* for
> anything an engine already determined.

The honest target is **deterministic-by-default, LLM-by-exception-and-labelled** —
NOT "100% deterministic" (a real residual has no engine; see §4).

## 3. Architecture

**Finding schema gains `provenance`** (required):
- `deterministic` — `{ engine, ruleId, severity (from baseline class) }`. Relayed
  verbatim; the LLM cannot alter it.
- `llm-inferred` — reasoned by an LLM finder/verifier over a deterministic FACT
  substrate; severity still from the baseline class where one exists; rendered
  with an explicit "⚠ LLM-inferred — not a scanner result" tag.

**Two-stage pipeline (the LLM drives both):**
1. **Deterministic pass FIRST.** Run the engines (SFGE/Code Analyzer, PMD
   AppExchange, gitleaks, OSV/npm-audit, Semgrep, Checkov, ZAP). Parse SARIF/JSON
   → ledger findings with `provenance:'deterministic'`, engine + ruleId, severity
   from the baseline class map. These are AUTHORITATIVE for their classes.
2. **LLM pass SECOND, scoped to the residual.** The finder/verifier fan-out runs
   ONLY on classes with no deterministic engine (§4). It is **structurally
   forbidden** from emitting a finding in a deterministic-owned class when that
   engine ran (enforced at the merge engine — reject — not requested in a prompt).

**Enforcement (must be impossible, not prose — this is why it wobbles today):**
- The merge engine REJECTS an LLM finding whose class has a deterministic owner
  that ran. (Today the "defer to SFGE, don't double-report" rule is prose the LLM
  ignores when SFGE is absent.)
- Severity for deterministic classes comes from the class map, never the LLM.
- **Engine-absent → PENDING-OWNER-RUN, never LLM-filled and never dropped.** This
  is the direct fix for the fixrun4 hallucinated hand-off: defer to an engine ONLY
  when that engine actually ran; otherwise keep the class open as PENDING.

**Deterministic substrate for the LLM residual.** Even `llm-inferred` classes get
a deterministic fact base (grep every `@AuraEnabled` entry point, list permission
grants, list endpoints) so the LLM judges over fixed facts — never re-discovers.

## 4. Class ownership map

**Deterministic-owned (→ A+):**

| Class | Engine | Notes |
|---|---|---|
| CRUD/FLS | SFGE / Code Analyzer | the #1 review category; the tool SF runs |
| `without sharing` / sharing bypass | PMD + SFGE | |
| ViewAll/ModifyAll over-grant | metadata check / PMD AppExchange | grant is deterministic; "is the object sensitive" is a class-tag judgment |
| SOQL injection, XSS | PMD / Semgrep | |
| Hardcoded secrets | gitleaks | |
| Dependency CVEs | OSV / npm-audit | |

**LLM-residual (→ honest-beta, labelled):** per-record IDOR / object-authz logic,
"should this be guest-exposed" judgment, prompt-injection, denial-of-wallet,
business-logic bypass, multi-step authz. These are exactly what SF does *by hand*
in their pen-test — so our split mirrors theirs (Code Analyzer + human).

**Hybrid (split, don't force all-or-nothing):** e.g. guest-reachability = a
deterministic exposure substrate (grep entry points) + a labelled LLM judgment on
sensitivity. Ground the LLM in fixed facts; label the judgment.

## 5. The SFGE owner-gating reality

Code Analyzer / SFGE needs the `sf` CLI + the Code Analyzer plugin — it cannot be
auto-installed to tmp in a cold journey (`install:'owner'`). So determinism is
**conditional on the engine being runnable**: if SFGE is absent, its classes are
**PENDING-OWNER-RUN** (with a clear "install `sf` + Code Analyzer to make these
deterministic" prompt), NOT LLM-filled. This is honest — and it matches the SCI's
existing PENDING-OWNER-RUN posture for owner-gated scanners.

## 6. What already exists (≈half the pipeline)

- Scanner-evidence collection (`build-evidence-index.mjs`, the schema).
- The reviewer-reproducible credit/clear rule (a real SFGE clear satisfies
  `fail-crud-fls`; a white-box clear stays `statically-cleared`/not-credited).
- The blocker-REQUIREMENT driver that already lets scanner evidence gate the band
  (`compute-sci.mjs:126-129`).
- The methodology ALREADY assigns CRUD/FLS dataflow to SFGE and tells the LLM to
  "defer and don't double-report" (`apex-exposed-surface.md:482`).

**Missing:** a scanner→ledger-findings path, the `provenance/ruleId` field, the
merge-engine enforcement, the engine-absent→PENDING (not LLM-fill/drop) rule, and
actually running SFGE.

## 7. Phasing

- **Phase 1 (kills the campaign failure).** Re-home the three classes that
  wobbled — CRUD/FLS, ViewAll/ModifyAll, sharing — onto SFGE/PMD: the provenance
  field, the SARIF/metadata ingest into the ledger, severity-from-class, the
  merge-engine enforcement (reject LLM findings in these classes when the engine
  ran), and the engine-absent→PENDING fix. Proves the pattern on the highest-value
  classes.
- **Phase 2 (the full principle).** Extend provenance-typing to every class, scope
  the LLM fan-out to the labelled residual, wire severity-from-class everywhere,
  and the explicit `llm-inferred` rendering tag throughout the output surfaces.

## 8. Validation — the treadmill ends

A `deterministic` finding is validated by **"run the engine twice → identical"** —
a unit test, not a 5-run campaign. The campaign only existed because the band was a
probabilistic sample. Phase 1's acceptance is a deterministic assertion: SFGE on
the frozen Solano fixture surfaces OppController FLS + Contact-PII FLS + the ViewAll
grant **every run**, severity from class, no LLM in that path. No campaign runs.

## 9. Open decisions (ratify before any builder work)

1. **Phase 1 scope** — the three wobbled classes only (recommended), or a wider
   first cut?
2. **SARIF-ingest now or later** — Phase 1 needs a scanner→ledger path. Build the
   `provenance`-tagged ingest in Phase 1 (recommended), or start with the cheaper
   "re-home FLS onto the `fail-crud-fls` requirement only" (no ledger ingest) and
   add ingest in Phase 2?
3. **SFGE prerequisite** — accept PENDING-OWNER-RUN when `sf`/Code Analyzer is
   absent (recommended, honest), or make `sf` a hard prerequisite for the journey?
4. **Presentation backlog** — WI-07..12 (reviewer-sim template, cadence/test-env,
   compile-submission siblings, generate-artifacts surfaces, the low-risk renders)
   pause here. Resume after Phase 1/2, or fold the highest-traffic ones in
   opportunistically?

Once §9 is locked, this becomes a slice sequence run through the builder/auditor
split, validated deterministically.

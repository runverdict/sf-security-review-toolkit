# Roadmap — Deterministic-engine-grounded findings (provenance-typed blocker band)

> Status: **RATIFIED (2026-06-26) — PHASE 1 COMPLETE. Slice 1 (the ingest foundation) SHIPPED 0.8.28; Slice 2 (the correctness core — tag filter + LLM-supersession enforcement + engine-absent→KEEP) SHIPPED 0.8.29; Slice 3 (deterministic-pass-first journey re-sequencing + the reconcile wired into the merge pipeline + the live Solano acceptance runbook) SHIPPED 0.8.30. The three wobbled blocker classes are now deterministic end-to-end, validated without a campaign. Phase 2 (the §10 per-scanner adapters, build order 2a/2b) IN PROGRESS — adapter 2a #1 `checkov` SHIPPED 0.8.31; 2a #2 `semgrep` SHIPPED 0.8.32 (the FIRST genuine `tool→band` adapter + the additive `buildFinding` generalization that path reuses); 2a #3 `bandit` SHIPPED 0.8.33 (the SECOND `tool→band` adapter — the PROOF the generalization GENERALIZES: reuses the `bandFromTool` path with ZERO harness-core change); 2a #4 `njsscan` SHIPPED 0.8.34 (the THIRD `tool→band` adapter and the FIRST with a different input shape — a nested object `{nodejs:{…},templates:{…}}` keyed by rule_id, NOT a flat `results[]`, so its own `parse` reading BOTH sections, still reusing `bandFromTool` with ZERO harness-core change); 2a #5 `gitleaks` SHIPPED 0.8.35 (the DESIGN PIVOT BACK to `class`-severity — secrets have no tool-severity tier, so severity from the `fail-hardcoded-secrets` class; the FIRST adapter to own a class AND a real dimension (`secrets-credentials`) so it SUPERSEDES a co-located LLM secrets finding, built so the live secret + commit PII NEVER reach the ledger); 2a #6 `detect-secrets` SHIPPED 0.8.36 (the secrets SIBLING of gitleaks — REUSES the `hardcoded-secrets` class with NO new `CLASS_DEFS`/`buildFinding` change, only the `ADAPTERS` registry line; its OWN nested-by-file JSON `{results:{<file>:[…]}}` so its own `parse`; the same hash/secret-never-leaks invariant — emits only `type`/file/`line_number`, never the `hashed_secret`/plaintext; with TWO secrets engines now live, cross-engine dedup is concrete but still §10 ext #3 — the duplicate is VISIBLE, the SAFE under-merge); 2a #7 `osv` SHIPPED 0.8.37 (the dependency-CVE / SCA scanner — and with it **Extension A: the CVSS→enum advisory-severity fork is REALIZED**: a dep CVE carries a REAL CVSS while the only class severity (scan-external-sca) is a *missing-scan* gate severity, so the per-finding band comes from the advisory's CVSS via `CVSS_SCORE_TO_FINDING` (≥9 critical · ≥7 high · ≥4 medium · >0 low · 0 info), else the `database_specific.severity` label, else `medium` — reusing the `bandFromTool` path with the ONE additive `gateLabel` param (scan-external-sca, default preserves the SAST gate byte-for-byte); classify()→null so it owns no class); 2a #8 `npm-audit` SHIPPED 0.8.38 (the EASY **Extension-A REUSE** — `npm audit --json` v2 gives a DIRECT severity LABEL per vulnerable package (`critical/high/moderate/low/info`), so the band comes straight from `NPM_SEVERITY_TO_FINDING` (npm's lowercase `moderate`→medium spelling; unknown/blank→`medium`), no CVSS math; reuses OSV's path EXACTLY — the `bandFromTool` branch, the `gateLabel` param (already added 0.8.37), `dimension:'dependency-cve'`, classify()→null — with NO `buildFinding`/`CLASS_DEFS` change, only the `ADAPTERS` line; gated by `scan-dependency-vulnerabilities` (applies_to all, major — distinct from OSV's scan-external-sca); one finding per package, `via` supplies the advisory title/url (a STRING via-entry is a transitive chain, an OBJECT via-entry the direct advisory), the band uses the PACKAGE severity not the first advisory's; with TWO dep-CVE engines now live, OSV+npm on the SAME CVE is the visible SAFE under-merge — collapsing it is §10 ext #3, Phase-2b); 2a #9 `trivy` SHIPPED 0.8.39 (the multi-mode scanner, done **CONFIG mode only** — a Trivy `Class:'config'` finding is the SAME vuln class as Checkov, so it REUSES the `iac-misconfig` class at class-severity (NO new `CLASS_DEFS`/`buildFinding` change, only the `ADAPTERS` line — like detect-secrets); the parse is **CLASS-DISPATCH** (forward-compatible): `Class:'config'` now, the vuln (os-pkgs/lang-pkgs) and `secret` classes SKIPPED — Phase-2b, no fixtures yet; CONSISTENCY CALL — Trivy carries a per-misconfig `Severity` but lands at class-severity EXACTLY like Checkov (its `Severity` recorded for reference only, never moving the band), the per-tool-severity refinement for `iac-misconfig` staying the same Phase-2b item flagged at Checkov; Checkov↔Trivy on the SAME Dockerfile misconfig (`CKV_DOCKER_2`↔`DS-0026`) = §10 ext #3, the SAFE under-merge); **trivy SCA/secret modes next** — the os-pkgs/lang-pkgs and secret modes (need captured fixtures), then the cross-engine dedup + `gosec`/`retire` + the tls/dast specials). **PHASE 2 JOURNEY-WIRING SHIPPED 0.8.40** — the 11 adapters are now actually WIRED into the journey via the new `--all` ingest mode + a content-shape recognizer (`recognizeScanner` routes every `evidence/*.json` to its adapter by CONTENT SHAPE, never the heterogeneous/ambiguous filename; the shapes are provably disjoint, 40/40 on real evidence; >1 match fails loud, never guesses): audit-codebase Step 4b (replacing the two `--scanner` calls) AND the run-scans scan tail both invoke `--all` + reconcile, so a single COLD run now ingests the FULL scanner set (not just code-analyzer + metadata) in one byte-deterministic pass — closing the gap where the 9 OSS Phase-2 adapters were built + unit-tested but the journey never called them. The per-`--scanner` CLI + `buildFinding`/`ingest`/`CLASS_DEFS` are byte-unchanged (additive-only). Suite 55 files / 700 checks.** The architecture
> the cold campaign pointed to. Operator ratified §9: Phase 1 = **full SARIF
> ingest** of the 3 wobbled classes as provenance-tagged `deterministic` ledger
> findings; SFGE absent → **PENDING-OWNER-RUN** (never LLM-fill); the presentation
> track (WI-07..12) is **paused**.

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

**Shipped (Phase 1 complete):** the scanner→ledger-findings path + the
`provenance/ruleId` field (Slice 1, 0.8.28); the security-tag filter, the merge-engine
supersession enforcement, and the engine-absent→KEEP (not LLM-fill/drop) rule (Slice 2,
0.8.29); the deterministic-pass-FIRST journey re-sequencing + `reconcile-provenance`
wired into the merge pipeline + the live Solano acceptance runbook
(`docs/deterministic-findings-acceptance.md`) (Slice 3, 0.8.30). The only Phase-1
residual is the owner-gated act of actually running SFGE/Code Analyzer in the cold
journey (§5) — it is **PENDING-OWNER-RUN by design**, not a code gap.

## 7. Phasing

- **Phase 1 (kills the campaign failure).** Re-home the three classes that
  wobbled — CRUD/FLS, ViewAll/ModifyAll, sharing — onto SFGE/PMD: the provenance
  field, the SARIF/metadata ingest into the ledger, severity-from-class, the
  merge-engine enforcement (reject LLM findings in these classes when the engine
  ran), and the engine-absent→PENDING fix. Proves the pattern on the highest-value
  classes.
  - **Slice 1 — SHIPPED (0.8.28): the ingest foundation.** `harness/ingest-scanner-findings.mjs`
    — a pluggable per-scanner adapter registry (`ingest(raw, adapter)` pure core +
    `{name, kind, collect, parse, classify}` adapters) with two KINDS, both shipped:
    `code-analyzer` (`file-parser`, parses the captured Code Analyzer JSON) and
    `metadata-viewall` (`source-scanner`, `engine:'metadata'`, greps the
    permissionsets for ViewAll/ModifyAll over-grants). Each violation → a
    `provenance:'deterministic'` ledger finding with `engine` + `ruleId`, severity
    READ FROM the requirement class (the new canonical `REQ_SEVERITY_TO_FINDING` over
    `baseline/requirements-baseline.yaml`, never the scanner number/LLM). The
    `audit-ledger.schema.json` gains `provenance`/`engine`/`ruleId` (additive; default
    `llm-inferred`). An unmapped rule is still ingested (CA-severity fallback, never
    dropped); the merge is additive + idempotent. Validated deterministically by
    `acceptance/test-ingest-scanner-findings.mjs` against REAL captured Solano/Meridian
    fixtures (the anchor `ApexCRUDViolation` on `SolanoAccountInsightController.cls:19`
    lands `deterministic`/`pmd`/class-severity `high` every run) — no campaign.
  - **Slice 2 — SHIPPED (0.8.29): the correctness core.** (a) A Security/AppExchange
    TAG FILTER in the Code Analyzer adapter (§10 extension #2) — only a security-tagged
    rule becomes a finding; ApexDoc/naming/codestyle/Performance noise is filtered (a
    filter on noise, never a drop of a security finding). (b) `harness/reconcile-provenance.mjs`
    ENFORCES supersession: a `deterministic` finding in the SAME owned class at the SAME
    locus demotes a co-located `llm-inferred` finding to `status:'superseded'`
    (`superseded_by` → the deterministic id) — pure + idempotent, conservative (only an
    OWNED class supersedes; precise class match with a dimension fallback; mark-not-delete),
    so the LLM never re-reports/re-judges what an engine determined. (c) The engine-absent
    → KEEP methodology fix (`apex-exposed-surface.md` §5/§6): defer a CRUD/FLS gap to SFGE
    ONLY when a `code-analyzer-*.json` proves it ran; otherwise KEEP the finding
    `llm-inferred` and mark the class PENDING-OWNER-RUN — the direct fix for the fixrun4
    hallucinated hand-off. Guarded by `test-reconcile-provenance` + the updated
    `test-ingest-scanner-findings` (tag filter) + a `test-calibration-fp-patterns` presence
    check (engine-absent → KEEP).
  - **Slice 3 — SHIPPED (0.8.30): deterministic-pass-FIRST + live acceptance.** The journey
    is re-sequenced so the engines (Code Analyzer/SFGE, metadata) run and ingest BEFORE the
    LLM fan-out — `audit-codebase` Step 4b runs `ingest-scanner-findings.mjs --scanner
    metadata-viewall` (always) + `--scanner code-analyzer` (when a `code-analyzer-*.json`
    evidence file exists; `sf` absent → PENDING-OWNER-RUN, never LLM-fill, never drop) — and
    `reconcile-provenance.mjs` is wired in as the LAST merge step (end of Step 6, after
    `merge-ledger.mjs`), with Step 7 re-rendering the recap off the reconciled band. The
    journey + run-scans document the same ordering. The deterministic acceptance on the live
    Solano fixture is the operator runbook `docs/deterministic-findings-acceptance.md` (run
    the engine twice → identical; the anchors present with class-severity, no LLM in that
    path), and the hermetic `acceptance/test-deterministic-integration.mjs` (16 checks) drives
    the real CLI sequence end-to-end + asserts the journey/audit-codebase grant+invoke+order
    wiring. **Phase 1 is COMPLETE** — the three wobbled blocker classes are deterministic
    end-to-end, validated without a campaign.
- **Phase 2 (the full principle).** Extend provenance-typing to every class, scope
  the LLM fan-out to the labelled residual, wire severity-from-class everywhere,
  and the explicit `llm-inferred` rendering tag throughout the output surfaces.

## 8. Validation — the treadmill ends

A `deterministic` finding is validated by **"run the engine twice → identical"** —
a unit test, not a 5-run campaign. The campaign only existed because the band was a
probabilistic sample. Phase 1's acceptance is a deterministic assertion: SFGE on
the frozen Solano fixture surfaces OppController FLS + Contact-PII FLS + the ViewAll
grant **every run**, severity from class, no LLM in that path. No campaign runs.

## 9. Decisions — RATIFIED 2026-06-26

1. **Phase 1 scope/ingest** → **Full SARIF ingest.** The three wobbled classes
   (CRUD/FLS, ViewAll/ModifyAll, sharing) become provenance-tagged `deterministic`
   ledger findings (engine + ruleId + class-severity), with the LLM rejected from
   those classes when the engine ran. (Not the requirement-only path; not a wider
   first cut.)
2. **SFGE prerequisite** → **PENDING-OWNER-RUN** when `sf`/Code Analyzer is absent;
   never LLM-fill those classes. Honest, matches existing owner-gated posture.
3. **Presentation backlog** → **paused.** WI-07..12 resume after Phase 1/2.

Phase 1 is now cleared. It runs through the builder/auditor split, validated
deterministically (run the parser twice → identical; the 3 anchors present with
`provenance:'deterministic'` + class-severity on the frozen Solano fixture — no
campaign).

## 10. Per-scanner adapter roadmap (every scanner → an adapter)

The ingest seam is **per-scanner, not Code-Analyzer-specific**. Code Analyzer is
adapter #1; the same `{name, kind, collect, parse, classify}` contract covers every
scanner the toolkit runs — each is a new adapter object, never a rewrite. Mapped
against the REAL captured outputs already on disk from the run-5 evidence set (so
every adapter is testable against genuine scanner output, no authorship ceiling).

| Adapter | Kind | Class(es) | Baseline req | Real fixture | Severity source |
|---|---|---|---|---|---|
| `code-analyzer` (PMD+SFGE) ✅ | file-parser | CRUD/FLS · sharing · (SOQLi/secrets ext.) | fail-crud-fls · fail-sharing-model | ✅ Slice 1 | class |
| `metadata-viewall` ✅ | source-scanner | ViewAll/ModifyAll over-grant | fail-sharing-model | ✅ Slice 1 | class |
| `checkov` ✅ | file-parser | IaC misconfig | scan-iac-misconfig | ✅ srt-solano | class (scan-iac-misconfig) — Slice shipped 0.8.31 |
| `semgrep` ✅ | file-parser | external-sast (tool→band) | scan-external-sast | ✅ coldstart-full + helios | **tool→band** — Slice shipped 0.8.32 |
| `bandit` ✅ / `njsscan` ✅ / `gosec` | file-parser | py/node/go SAST | scan-external-sast | ✅ / ✅ / ❌ no Go | **tool→band** — `bandit` shipped 0.8.33; `njsscan` shipped 0.8.34; gosec pending |
| `gitleaks` ✅ / `detect-secrets` ✅ | file-parser | secrets · `hardcoded-secrets` | fail-hardcoded-secrets | ✅ / ✅ | class (no tool sev) — `gitleaks` shipped 0.8.35; `detect-secrets` shipped 0.8.36 (REUSES the class) — **secrets row done** |
| `osv` ✅ / `npm-audit` ✅ / `trivy` ✅ (config) / `retire` | file-parser | dep-CVE · IaC-misconfig | scan-external-sca · scan-dependency-vulnerabilities · scan-iac-misconfig | ✅ / ✅ / ✅ config / ❌ | **CVSS→enum (fork)** for dep-CVE · **class** for trivy config — `osv` shipped 0.8.37 (**Extension A REALIZED**); `npm-audit` shipped 0.8.38 (the EASY Extension-A REUSE — a direct npm severity LABEL, no CVSS math); `trivy` shipped 0.8.39 (**CONFIG / IaC-misconfig mode ONLY** — REUSES checkov's `iac-misconfig` class at class-severity, class-dispatch parse; **trivy SCA/secret modes still 2b**) |
| `tls` (SSL Labs / testssl) | property-assert | host TLS grade | endpoint-ssl-labs-a-grade | ❌ live host | **PENDING-OWNER-RUN** |
| `dast` (ZAP / nuclei / schemathesis) | runtime | runtime web-vulns | dast-self-run-required | partial (1 loopback) | **`dast-runtime` kind** |

> **0.8.40 — JOURNEY WIRING: the 11 adapters now actually RUN in the journey (the `--all` ingest mode + a
> content-shape recognizer).** Through 0.8.39 the registry had all 11 adapters built + unit-tested, but the
> journey only ever invoked 2 of them — audit-codebase Step 4b hardcoded `--scanner metadata-viewall` +
> `--scanner code-analyzer`, and the OTHER 9 Phase-2 adapters (checkov/semgrep/bandit/njsscan/gitleaks/
> detect-secrets/osv/npm-audit/trivy) never got called on a real run, so their evidence JSONs were produced by
> run-scans but never ingested into the deterministic band. 0.8.40 closes that with TWO additive parts: (A) a
> `detect(raw)→boolean` predicate on each file-parser adapter + an exported `recognizeScanner(raw)` that routes
> every `evidence/*.json` to its adapter by **CONTENT SHAPE, never filename** (filenames are heterogeneous AND
> ambiguous — `iac-<date>.json` is checkov, `secret-scan-*` collides between gitleaks and detect-secrets,
> `deps-npm-*` is sometimes raw npm-audit and sometimes a disposition WRAPPER; the recognizer was proven 40/40
> on real evidence across 4 captured runs, returns the SINGLE match / null / `{ambiguous}`, and NEVER guesses);
> plus an `--all` CLI mode (`ingestAll`) that ALWAYS runs metadata-viewall then recognizes + ingests every
> evidence file into the band in ONE byte-deterministic pass, reporting Code-Analyzer-absent → CRUD/FLS+sharing
> **PENDING-OWNER-RUN** (never LLM-fill). (B) `--all` is wired at **audit-codebase Step 4b** (replacing the two
> `--scanner` calls) AND the **run-scans scan tail** (`--all` then `reconcile-provenance` — the deliberate choice
> over a full re-audit, which would double the LLM fan-out; both harnesses are pure + idempotent + finding-neutral
> on re-run). The per-`--scanner` CLI + `buildFinding`/`ingest`/`CLASS_DEFS` are **byte-unchanged** (additive-only;
> `AD1` stays at 11 adapters). Guarded by the `RC*` + `ALL*` checks in `test-ingest-scanner-findings.mjs` and
> W3/W5/W10/W11 in `test-deterministic-integration.mjs`. Suite **55 files / 700 checks**. NOTE/judgment call: the
> builder spec's RC-failsafe listed `[]`→null, but the proven gitleaks predicate (and the design note) recognize
> an empty top-level array as a CLEAN gitleaks scan (0 findings, harmless) — the predicate is authoritative, so
> `[]` → gitleaks; documented in the CHANGELOG.
>
> **0.8.39 — `trivy` row shipped (CONFIG / IaC-misconfig mode ONLY; REUSES checkov's `iac-misconfig` class at
> class-severity).** Trivy is the toolkit's multi-mode scanner (IaC-misconfig over Dockerfile/Terraform/K8s, plus
> os-pkgs/lang-pkgs SCA and a secret mode). It is the NINTH §10 adapter, done **exactly one mode this slice** —
> `Class:'config'` (IaC misconfig) — because that is the only mode with a REAL captured fixture on disk. A Trivy
> `config` finding is the **SAME vuln class as Checkov**, so trivy **REUSES the `iac-misconfig` class** (NO new
> `CLASS_DEFS` entry, NO `buildFinding` change — exactly as detect-secrets reused `hardcoded-secrets`): a
> **CLASS-severity** adapter at class `high` (`scan-iac-misconfig` = `major`), **NOT** a tool→band path; the ONLY
> shared-file touch is the `ADAPTERS` registry line. The parse is **CLASS-DISPATCH** and forward-compatible: it
> handles `Class:'config'` now and **SKIPS** the vuln (os-pkgs/lang-pkgs) and `secret` classes — those are
> **Phase-2b** (no captured fixtures yet) — so when a future slice ships those fixtures the dispatch grows a branch
> and nothing already-shipped changes. Only `Status:'FAIL'` misconfigurations become findings (a `PASS` is a
> satisfied check). **Three judgment calls** (documented, not hidden): (1) **class-severity, CONSISTENT WITH
> CHECKOV** — Trivy DOES carry a per-misconfig `Severity` (LOW/MEDIUM/HIGH/CRITICAL), but Checkov — the OTHER
> `iac-misconfig` engine — lands every IaC misconfig at the class `high`; for the same class to be consistent
> across engines, Trivy ALSO uses class-severity, with its own `Severity` recorded in the message *for reference*
> (mirroring how Checkov records its absent tool severity), never moving the band — a `Severity:'LOW'` misconfig is
> STILL `high`, exactly like Checkov. The per-misconfig-tool-severity refinement for the `iac-misconfig` class
> (Checkov + Trivy both) stays the **same Phase-2b item flagged at Checkov** — no tool→band path for IaC is
> introduced here; (2) **config mode only this slice** — the vuln and secret classes are skipped (Phase-2b), so
> there is no fabricated SCA/secret finding from a Trivy run; (3) **cross-engine dedup now concrete for IaC too** —
> Trivy + Checkov both flag the SAME Dockerfile misconfig (Trivy `DS-0026` "No HEALTHCHECK" ↔ Checkov
> `CKV_DOCKER_2`) → two `iac-misconfig` rows; neither supersedes the other (both deterministic), so the duplicate
> is **visible**, the SAFE under-merge — collapsing it is **extension #3 (cross-engine dedup), Phase-2b**. `file`
> is the Result `Target`, with `:StartLine` only when `CauseMetadata.StartLine` is an integer (a file-level
> misconfig like `DS-0026` carries none → the bare Target); `ruleId` prefers `AVDID` (e.g. `AVD-DS-0026`) else
> `ID`. Guarded by the `TRV*` checks (one real DS-0026 fixture — genuine Trivy 0.71.2 filesystem scan + the
> class-severity-consistency mutation `LOW→CRITICAL` stays `high` + a class-dispatch synthetic that skips an
> `os-pkgs` Vulnerabilities Result while reading the `config` Misconfigurations Result + a `Status:'PASS'`-skip + a
> reuses-class assertion that `Object.keys(CLASS_DEFS)` is unchanged at the original 5). Suite **55 files / 688
> checks** (was 55 / 677; +11 `TRV*`; `AD1` → the 11-adapter registry). Tag stays **HELD** (0.9.0 reserved).
> **`trivy` SCA/secret modes are next** — the os-pkgs/lang-pkgs (→ Extension A's `dependency-cve` band) and
> `secret` (→ the `hardcoded-secrets` class) modes (need captured fixtures); then 2b (gosec [needs a Go fixture] /
> retire / cross-engine-dedup ext #3 — now concrete for IaC too) + the tls/dast specials.
>
> **0.8.38 — `npm-audit` row shipped (the EASY Extension-A REUSE: a direct severity label per package, no CVSS
> math).** npm audit is the Node-ecosystem dependency-CVE scanner (run-scans Family 8, alongside OSV). It is the
> EIGHTH §10 adapter. `npm audit --json` (`auditReportVersion:2`) gives a **DIRECT severity LABEL per vulnerable
> package** (`critical/high/moderate/low/info`) — no CVSS parsing — so the band comes straight from
> `NPM_SEVERITY_TO_FINDING` (npm's own LOWERCASE spelling, using `moderate` not `medium`; its OWN named map, NOT
> OSV's UPPERCASE one), a label-only band. It **REUSES OSV's path EXACTLY** — the `bandFromTool` branch, the
> `gateLabel` parameter (already added at 0.8.37), `dimension:'dependency-cve'`, `classify()`→`null` (owns no
> class, supersedes nothing), NO `securityRelevant` — so there is **NO `buildFinding`/`CLASS_DEFS` change**; the
> ONLY shared-file touch is the `ADAPTERS` registry line. Gated by `scan-dependency-vulnerabilities`
> (`applies_to: [all]`, `major` — the npm-deps gate, **DISTINCT** from OSV's `scan-external-sca`; both `major`).
> **Four judgment calls** (documented, not hidden): (1) an unknown/blank severity → `medium` (consistent with
> OSV's unscored-CVE rule — a known CVE of unknown severity is real, the conservative middle); (2) **one finding
> per vulnerable package** (npm's `vulnerabilities` map is keyed by package and its `severity` is the package's
> MAX advisory severity; `via` supplies the advisory title/url — a `via[i]` that is a STRING is a transitive
> chain, a `via[i]` that is an OBJECT is the direct advisory; the band uses the PACKAGE severity, NOT the first
> advisory's — `qs` is package `moderate` though its first advisory is `low` → bands medium; `ruleId` prefers
> the advisory url/id, else the package name); (3) `gateLabel:'scan-dependency-vulnerabilities'` (distinct from
> OSV's `scan-external-sca`; both major); (4) `classify()`→null — with TWO dep-CVE engines now live, OSV +
> npm-audit can flag the SAME CVE: the duplicate is **visible**, the SAFE under-merge, and collapsing it is
> **extension #3 (cross-engine dedup), Phase-2b**. dep-CVEs have no file:line — `file` is the lockfile
> (`package-lock.json`), `startLine:null`; the raw CVSS vector a direct advisory may carry
> (`via[i].cvss.vectorString`) is never read (only the advisory title/url are). Guarded by the `NPM*` checks
> (one real 4-package fixture — `body-parser`/`express`/`path-to-regexp`/`qs`, 2 high · 2 medium — + inline
> label→band synthetics, the via-shape matrix, the package-severity-wins assertion, a no-CVSS-vector-leak check,
> and the gate-label check that npm says `scan-dependency-vulnerabilities` while OSV STILL says
> `scan-external-sca` and semgrep STILL says `scan-external-sast`). Suite **55 files / 677 checks** (was 55 /
> 665; +12 `NPM*`; `AD1` → the 10-adapter registry). Tag stays **HELD** (0.9.0 reserved). **`trivy` is next** —
> the heavier multi-mode one (container/IaC/SCA/secret), needs its own mode-aware parse; then 2b
> (gosec [needs a Go fixture] / retire / cross-engine-dedup ext #3) + the tls/dast specials.
>
> **0.8.37 — `osv` row shipped, and with it Extension A (the CVSS→enum advisory-severity fork) is REALIZED.**
> OSV-Scanner is the toolkit's dependency-CVE / SCA scanner (run-scans Family 8, over every lockfile under a
> non-package source root). It is the SEVENTH §10 adapter and the **third design pivot**: unlike the SAST
> family (`semgrep`/`bandit`/`njsscan` → tool tier ERROR/WARNING/INFO) and the class-severity adapters
> (`checkov`/`gitleaks`/`detect-secrets` → class), a dep CVE carries a **REAL CVSS base score**, while the
> only CLASS severity (`scan-external-sca` = `major`) is a *missing-scan* GATE severity. So the per-FINDING
> band is **PER-ADVISORY** (`severityKind:'advisory'`): resolved from the advisory's CVSS via
> `CVSS_SCORE_TO_FINDING` (≥9.0 critical · ≥7.0 high · ≥4.0 medium · >0 low · 0 info; blank/non-numeric →
> `null`), and the class governs **only the gate**. **Severity priority** per vuln: (1) the numeric
> `max_severity` of the package `group` that contains this vuln id → `CVSS_SCORE_TO_FINDING`; (2) else the
> vuln's `database_specific.severity` LABEL → `OSV_LABEL_TO_FINDING` (GitHub's `CRITICAL/HIGH/MODERATE/LOW`;
> `MEDIUM` a `MODERATE` synonym); (3) else **`medium`** — a known CVE of unknown severity is still a real
> finding, the conservative middle (NOT info, NOT the gate's high). It **REUSES `buildFinding`'s `bandFromTool`
> path** exactly like the SAST adapters (`classify()`→`null`, owns no class, supersedes nothing;
> `dimension:'dependency-cve'`, deterministic-only; NO tag filter) — the band SOURCE (CVSS, not a tool tier)
> is the only difference — so the **ONLY shared-code change is the additive `gateLabel` parameter** on
> `buildFinding`'s tool→band branch (`scan-external-sca`; the default `scan-external-sast` preserves the SAST
> adapters' reasoning **byte-for-byte**; `CLASS_DEFS` and the mapped/unmapped branches are untouched).
> **Three judgment calls** (documented, not hidden): (1) an unscored CVE → `medium` (the blank-input guard in
> `CVSS_SCORE_TO_FINDING` makes `''`/`null` fall through to the label → `medium`, while an explicit `'0'`/`'0.0'`
> stays `info`); (2) no file:line — a dep-CVE locates to the lockfile/package (`file` = the lockfile path or
> `ecosystem:name`, `startLine:null`); (3) `classify()`→null — cross-engine dedup with npm/Trivy on the SAME
> CVE is **extension #3 (Phase-2b)**, not this slice. Guarded by the `OSV*` checks (one real 11-vuln fixture —
> 1 critical `h11` · 3 high + 6 medium + 1 low across `starlette`/`idna` — + inline CVSS→enum threshold
> synthetics, the severity-priority cases, and the load-bearing gate-label-default-preserved regression). Suite
> **55 files / 665 checks** (was 55 / 651; +14 `OSV*`; `AD1` → the 9-adapter registry). Tag stays **HELD**
> (0.9.0 reserved). **`npm-audit` is next** — it reuses Extension A but with npm's direct `severity` label
> (`critical/high/moderate/low/info`), a label-only band (no CVSS parsing); then `trivy`, then 2b
> (gosec/retire/cross-engine-dedup) + the tls/dast specials.
>
> **0.8.36 — `detect-secrets` row shipped (the secrets SIBLING of gitleaks; REUSES the `hardcoded-secrets`
> class; the nested-by-file parse; cross-engine dedup now concrete → ext #3). The secrets row is now done.**
> detect-secrets is the toolkit's SECOND hardcoded-secret scanner (run-scans Family 6, alongside gitleaks).
> Same vuln class, so it **REUSES the `hardcoded-secrets` class** gitleaks added — **NO new `CLASS_DEFS`
> entry, NO `buildFinding`/`recommendationFor` change** (a `class`-severity adapter: severity from
> `fail-hardcoded-secrets` → **high** via a CONSTANT `classify()`→`'hardcoded-secrets'`, NO tag filter,
> security-by-construction). **The ONLY shared-file touch is the `ADAPTERS` registry line.** Like gitleaks
> it owns a class AND the real `secrets-credentials` dimension, so it SUPERSEDES a co-located LLM secrets
> finding. **Two things are new vs gitleaks.** (1) detect-secrets' OWN **nested-by-file** JSON —
> `{ results: { <file>: [occurrence, …] } }`, `results` keyed by FILE (each value an array of
> occurrences), NOT gitleaks' flat top-level array — so its own `parse` that iterates the file keys then
> each occurrence; no harness-core change. (2) With **TWO secrets engines now live**, the same secret at
> one locus produces TWO deterministic ledger rows (one per engine), which `reconcile-provenance` does NOT
> collapse — it only supersedes an `llm-inferred` finding, and a deterministic finding never supersedes
> another deterministic finding — so the cross-engine duplicate is **VISIBLE** (the SAFE under-merge; no
> engine silently hides another's finding). Collapsing gitleaks↔detect-secrets↔njsscan `node_secret` into
> one row is **extension #3 (cross-engine dedup), Phase-2b** — now concrete and captured as the
> `DS-two-deterministic-coexist` test, NOT this slice. **The hash/secret-never-leaks invariant applies
> again:** an occurrence carries a `hashed_secret` (a SHA — leak-safe by detect-secrets' design) and, under
> `--show-secrets`, could carry plaintext; the adapter emits a hit from ONLY `type`/file/`line_number` and
> DELIBERATELY never reads `hashed_secret`/plaintext into any field (`buildFinding`'s `redact()` is only a
> backstop). Guarded by the `DS*` checks (one real 24-occurrence / 6-file / 3-type fixture, the load-bearing
> hash+plaintext leak test, the LLM-supersession test, and the two-deterministic-coexist test). **`osv` is
> next** — the dependency-CVE scanner, which forces **Extension A (the CVSS→enum severity fork)**: a dep CVE
> carries a real CVSS while the only class severity is a *missing-scan* severity, so osv/npm/RetireJS need a
> per-advisory `severityKind:'advisory'` path — the next genuine design decision (like Checkov and gitleaks
> were).
>
> **0.8.35 — `gitleaks` row shipped (the DESIGN PIVOT BACK to `class`-severity; the FIRST adapter to
> SUPERSEDE an LLM finding for its class; the secret-never-leaks invariant).** gitleaks is the toolkit's
> hardcoded-secret scanner (run-scans Family 6, tree + git-history). UNLIKE the SAST family it carries
> NO per-finding severity tier — every hit is "a secret is present" — so it is a **`class`-severity**
> adapter (like Checkov): severity from the `fail-hardcoded-secrets` baseline class (major → **high**),
> via a CONSTANT `classify()`→`'hardcoded-secrets'`, NO tag filter (security-by-construction), and **ZERO
> `buildFinding`/`CLASS_DEFS`-machinery change** beyond one new `CLASS_DEFS` entry + one adapter object +
> one `recommendationFor` arm — it rides the existing MAPPED-class severity path. **Two things make it
> distinct.** (1) A hardcoded-secret maps cleanly onto the REAL `secrets-credentials` methodology
> dimension, so — unlike the deterministic-only `external-sast` label — gitleaks OWNS a class AND a real
> dimension and therefore **SUPERSEDES a co-located LLM `secrets-credentials` finding** (the first
> adapter to enforce, for its class, that the LLM does not re-report what the scanner determined). The
> bounded over-supersede risk (a DIFFERENT secrets-credentials issue at the same overlapping line) is the
> same already-accepted dimension-fallback risk as `crud-fls`/`sharing` (both share `apex-exposed-surface`);
> hardening is tracked under extension #3. (2) gitleaks output CONTAINS the live secret (`Match`/`Secret`)
> plus commit PII on history scans (`Author`/`Email`/`Message`), so **the secret must NEVER reach the
> ledger** — the defining requirement of the slice. The PRIMARY control is structural: `parse()` emits a
> hit from ONLY the non-sensitive fields (`RuleID`/`File`/`StartLine`/`Description`) and DELIBERATELY
> never reads `Match`/`Secret`/`Message`/`Author`/`Email` into any field; `buildFinding`'s `redact()` is a
> defense-in-depth BACKSTOP, not the primary control. **One Phase-2b note it leaves open (tracked, not
> silent):** the same secret found by gitleaks AND njsscan's `node_secret` (and later detect-secrets)
> produces N ledger rows — that cross-DETERMINISTIC-engine collapse is extension #3, the SAFE under-merge,
> NOT this slice. Guarded by the `GL*` checks (one real 3× `generic-api-key` fixture, the load-bearing
> secret-never-leaks test that feeds a fake secret + PII into every sensitive field and greps the finding
> for any leak, and the LLM-supersession test).
>
> **0.8.34 — `njsscan` row shipped (the THIRD `tool→band` adapter, the FIRST with a different input
> shape).** njsscan is the Node language-gate SAST tool (run-scans Family 7, alongside
> Semgrep/Bandit/gosec). It carries a real per-finding `severity` (`ERROR`/`WARNING`/`INFO`, via
> `NJSSCAN_SEVERITY_TO_FINDING` — `ERROR→high` [the same calibration call as Semgrep/Bandit: a
> mechanical SAST hit flags a sink but does not confirm reachability], `WARNING→medium`, `INFO→low`,
> unknown/missing→`info`), owns no toolkit class (`classify()`→`null`), and groups under
> `external-sast` — exactly Semgrep's/Bandit's shape. So it REUSES `buildFinding`'s `bandFromTool` path
> with **ZERO harness-core change** (one new adapter object + one severity map + tests; no `buildFinding`
> and no `CLASS_DEFS` edit). The ONE new thing is njsscan's **nested-object JSON** (`{nodejs:{…},
> templates:{…}}`, each section keyed by rule_id), NOT a flat `results[]`, so it has its own `parse`
> that reads BOTH sections (a rule can list multiple files → one finding per file occurrence) and
> derives the CWE reference URL from a `CWE-###` prefix. **One Phase-2b note it leaves open (tracked,
> not silent):** njsscan's `node_secret` rule (CWE-798 hardcoded secret) OVERLAPS the secrets class the
> future `gitleaks`/`detect-secrets` (`fail-hardcoded-secrets`) adapters will own; here it ingests as an
> `external-sast` `tool→band` finding, and de-duplicating it against a co-located secrets-scanner finding
> is cross-engine dedup = extension #3 (Phase-2b) — the SAFE under-merge (a duplicate may survive in the
> band, never a dropped finding).
>
> **0.8.33 — `bandit` row shipped (the proof the `tool→band` path GENERALIZES).** Bandit is the
> Python language-gate SAST tool. It carries a real per-result `issue_severity`
> (`HIGH`/`MEDIUM`/`LOW`, via `BANDIT_SEVERITY_TO_FINDING` — `HIGH→high` [the same calibration call as
> Semgrep `ERROR→high`: a mechanical SAST hit flags a sink but does not confirm reachability, which is
> the LLM/human residual], `MEDIUM→medium`, `LOW→low`, unknown/missing→`info`), owns no toolkit class
> (`classify()`→`null`), and groups under `external-sast` — exactly Semgrep's shape. So it REUSES
> `buildFinding`'s `bandFromTool` path with **ZERO harness-core change**: one new adapter object + one
> severity map + tests, no `buildFinding` and no `CLASS_DEFS` edit. This is the proof the 0.8.32 Semgrep
> generalization GENERALIZES, exactly as that note predicted (`bandit`/`njsscan`/`gosec` reuse this
> path). **One Phase-2b note it leaves open (tracked, not silent):** Bandit emits an `issue_confidence`
> (`HIGH`/`MEDIUM`/`LOW`) alongside `issue_severity`; this slice bands on `issue_severity` only and
> records confidence for reference — a confidence-weighted refinement is deferred to Phase-2b (mirrors
> Checkov's per-check-severity deferral).
>
> **0.8.32 — `semgrep` row shipped + reconciled (the FIRST realized `tool→band`).** The *Class* cell
> read `injection (CWE-78…)`; corrected to `external-sast (tool→band)`. Semgrep's general SAST rules
> map onto NO toolkit class (the 3 wobbled classes are the review's, not Semgrep's), so the adapter's
> `classify()` is constant `null` and severity comes from the tool's own `ERROR`/`WARNING`/`INFO` band
> (`SEMGREP_SEVERITY_TO_FINDING` — `ERROR→high` [deliberately NOT critical/blocker: a raw ERROR flags a
> sink but does not confirm reachability, which is the LLM/human residual], `WARNING→medium`,
> `INFO→low`, unknown→`info`). This is the *Severity source* `tool→band` finally realized — the first
> one (Checkov's was reconciled to class-severity because OSS Checkov emits `severity:null`). It
> required a small ADDITIVE generalization of `buildFinding`: a third severity path on the UNMAPPED
> side gated on `bandFromTool`/`dimensionHint`/`toolSevLabel`; the MAPPED class-severity branch is
> UNCHANGED (a mapped `classKey` always wins — `bandit`/`njsscan`/`gosec` reuse this exact path).
> **Two Phase-2b follow-ups it leaves open (tracked, not silent):** (1) **CWE→injection sub-classing** —
> the `external-sast` grouping is honest but coarse; a future refinement could read `extra.metadata.cwe`
> to sub-class a hit into `injection-xss`/`ssrf`/etc. once a methodology dimension warrants it. (2)
> **Cross-engine dedup = extension #3** — a Semgrep finding owns no class so it SUPERSEDES nothing; a
> co-located LLM injection finding at the same sink can survive alongside it (the SAFE under-merge — a
> duplicate in the band, never a dropped scanner finding). De-duplicating those is the `finding-clusters.mjs`
> cross-engine cluster-key work, deferred to Phase-2b.
>
> **0.8.31 — `checkov` row reconciled (Severity source).** The cell read `tool→band`; corrected
> to `class (scan-iac-misconfig)`. Checkov OSS emits `severity:null` (per-check tool severity is a
> Prisma/Bridgecrew *enterprise* field), so there is no tool number to band — a literal tool→band
> mapping has no input cold, and class-severity is both the faithful (severity-from-class, §9) and
> the only deterministic option. A per-check tool severity (or enterprise `severity`) would be an
> Extension #1 `severityKind:'advisory'` fork, deferred with OSV/npm. Consequence (documented, not
> hidden): every Checkov failed check lands at the class band (high) — e.g. the fixture's
> hygiene-only missing-HEALTHCHECK `CKV_DOCKER_2` surfaces as a high the owner dispositions in the
> FP dossier, mirroring how `metadata-viewall` lands every over-grant at high. A curated per-check
> (CKV-id → severity) refinement is a Phase-2b follow-up.

**Three extensions the new adapters force (the seam supports all; spec them in Phase 2):**
1. **Severity fork for dep-CVEs** *(✅ REALIZED 0.8.37, the `osv` adapter — Extension A).*
   "Discard the scanner number, take the class severity" works for Apex (the class *is* the
   severity); but every CVE carries a real CVSS and the only class severity is a *missing-scan*
   severity. OSV/npm/RetireJS need a per-advisory CVSS→enum path (`severityKind:'advisory'`),
   class governs only the gate. SHIPPED for `osv`: `CVSS_SCORE_TO_FINDING` (≥9 critical · ≥7 high
   · ≥4 medium · >0 low · 0 info, blank/non-numeric → null) with priority numeric `max_severity`
   → `database_specific.severity` LABEL (`OSV_LABEL_TO_FINDING`) → `medium` (unscored is real);
   it reuses `buildFinding`'s `bandFromTool` path, the ONE additive harness change being the
   `gateLabel` param (scan-external-sca, default preserves scan-external-sast byte-for-byte).
   `npm-audit` ✅ (shipped 0.8.38) does exactly this — a direct npm `severity` label via
   `NPM_SEVERITY_TO_FINDING`, no CVSS math, gated by `scan-dependency-vulnerabilities`; `trivy`'s
   **SCA** mode (2b — distinct from its CONFIG/IaC-misconfig mode shipped 0.8.39 at class-severity) and
   `retire` would reuse the same path with their own label maps.
2. **Mandatory Security/AppExchange tag filter** *(✅ SHIPPED 0.8.29, Slice 2 — surfaced by
   the off-disk grade).* Raw Code Analyzer output is dominated by non-security rules (one
   fixture: 23/23 ApexDoc/naming/codestyle). Slice 1 ingested an unmapped rule as a
   `deterministic` finding (correct for an unmapped *security* rule, wrong for code-style
   lint). The Code Analyzer adapter now keeps only a hit whose `tags ∋ Security|AppExchange`
   (`hasSecurityTag` + the adapter's `securityRelevant` predicate, consulted by `ingest`) —
   non-security best-practices rules are NOT security findings (a filter, not a drop of a
   security finding); the Performance-tagged `MissingNullCheckOnSoqlVariable` is caught by
   the same rule; test U1 updated accordingly.
3. **Cross-engine dedup.** OSV↔npm (same CVE), Trivy↔Checkov (same control),
   gitleaks↔detect-secrets↔Trivy-secret collide as duplicate ledger rows — add a
   cross-engine cluster key in `finding-clusters.mjs` once ≥2 overlapping adapters exist.

**DAST is a conditional adapter of a distinct kind.** It *runs* (proven in 0.7.0 — it
stands a digest-pinned ZAP against a throwaway local mirror, scans, saves
`zap-throwaway-local-*.json`, tears down) — conditionally on the stack standing up,
exactly like Code Analyzer is conditional on the `sf` CLI. But its output has **no
file:line** (runtime endpoint loci) and is **not byte-deterministic** (live scan). So it
ingests as `provenance:'dast-runtime'` (engine + ruleId + endpoint-locus + band-severity
+ a `live-runtime, non-reproducible-sample` flag) — held to "the rule-based alerts recur,"
NOT the §8 run-twice-identical test — and stays PENDING-OWNER-RUN when the stack can't
stand up. (The Solano fixture needs the package info to stand the stack up — a small
fixture slice — so future runs exercise it instead of falling to PENDING.) **TLS** is
similar but simpler: a property-assertion adapter (HTTPS-only / TLS-floor / HSTS / chain),
PENDING-OWNER-RUN until a live host exists.

**Phase 2 build order** (each one new adapter; the easy ones have real fixtures on disk):
- **2a (ingest-first, real fixtures):** checkov ✅ (shipped 0.8.31 — the FIRST 2a adapter:
  IaC misconfig, constant `iac-misconfig` class, security-by-construction so NO tag filter,
  severity from the class not the tool) → semgrep ✅ (shipped 0.8.32 — the FIRST genuine
  `tool→band` adapter: multi-language SAST, constant `classify()`→`null` so it owns no class,
  severity from the tool's `ERROR`/`WARNING`/`INFO` band; established the additive `buildFinding`
  tool→band path that bandit/njsscan/gosec reuse verbatim) → bandit ✅ (shipped 0.8.33 — the SECOND
  tool→band adapter, Python SAST: the PROOF the Semgrep generalization GENERALIZES — reused the
  `bandFromTool` path with ZERO harness-core change, one new adapter + the `BANDIT_SEVERITY_TO_FINDING`
  map) → njsscan ✅ (shipped 0.8.34 — Node SAST, the THIRD tool→band adapter and the FIRST with a
  DIFFERENT JSON shape `{nodejs:{…},templates:{…}}` not a flat `results[]`, so its own `parse` reading
  BOTH sections, still reusing `bandFromTool` with ZERO harness-core change) → gitleaks ✅ (shipped
  0.8.35 — the secrets scanner, a DESIGN PIVOT BACK to `class`-severity via `fail-hardcoded-secrets`, NOT
  tool→band, like Checkov's class-severity call; the FIRST adapter that owns a class AND a real dimension
  so it SUPERSEDES a co-located LLM secrets finding, built so the live secret + commit PII never reach the
  ledger) → detect-secrets ✅ (shipped 0.8.36 — the secrets SIBLING of gitleaks, REUSES the
  `hardcoded-secrets` class with NO new `CLASS_DEFS`/`buildFinding` change [the only shared-file touch is
  the `ADAPTERS` registry line]; its OWN nested-by-file JSON `{results:{<file>:[…]}}` so its own `parse`;
  same hash/secret-never-leaks invariant; cross-engine dedup now concrete but still ext #3 — the duplicate
  is VISIBLE, the SAFE under-merge) → osv ✅ (shipped 0.8.37 — the dependency-CVE / SCA scanner and
  **Extension A: the CVSS→enum advisory-severity fork REALIZED**; a dep CVE carries a real CVSS while the
  only class severity is a missing-scan gate severity, so the band is per-advisory via `CVSS_SCORE_TO_FINDING`
  [numeric `max_severity` → `database_specific.severity` label → `medium`], reusing the `bandFromTool` path
  with the ONE additive `gateLabel` param; classify()→null, owns no class) → npm-audit ✅ (shipped 0.8.38 —
  the EASY **Extension-A REUSE**: npm's direct `severity` label [`critical/high/moderate/low/info`] →
  `NPM_SEVERITY_TO_FINDING` [npm's lowercase `moderate`→medium spelling], a label-only band with no CVSS
  parsing; reuses OSV's path EXACTLY [`bandFromTool`, the `gateLabel` param, `dimension:'dependency-cve'`,
  classify()→null] with NO `buildFinding`/`CLASS_DEFS` change, only the `ADAPTERS` line; gated by
  `scan-dependency-vulnerabilities` [applies_to all, major — distinct from OSV's scan-external-sca]; one finding
  per package, the band uses the PACKAGE severity not the first advisory's) → trivy ✅ (shipped 0.8.39 —
  **CONFIG / IaC-misconfig mode ONLY** [the only mode with a captured fixture]; a Trivy `Class:'config'` finding
  is the SAME vuln class as Checkov, so it REUSES the `iac-misconfig` class at class-severity [NO new
  `CLASS_DEFS`/`buildFinding` change, only the `ADAPTERS` line — like detect-secrets]; the parse is
  **CLASS-DISPATCH** [forward-compatible: `Class:'config'` now, the vuln (os-pkgs/lang-pkgs) and `secret` classes
  SKIPPED — 2b]; CONSISTENCY CALL — Trivy carries a per-misconfig `Severity` but lands at class-severity EXACTLY
  like Checkov, the per-tool-severity refinement for `iac-misconfig` staying the same 2b item flagged at Checkov)
  → then 2b (**trivy SCA/secret modes** / gosec [needs a Go fixture] / retire / cross-engine-dedup ext #3) + the
  tls/dast specials.
  (Extension #2's tag filter ✅ shipped with Slice 2, 0.8.29.)
- **2b (needs a fixture / branch first):** **trivy SCA/secret modes** (os-pkgs/lang-pkgs → Extension A's
  `dependency-cve` band, `secret` → the `hardcoded-secrets` class — need captured fixtures), gosec (capture a Go
  run), retire standalone, the cross-engine dedup (#3 — now concrete for IaC too: Checkov↔Trivy on the same misconfig).
- **Special:** tls (property-assertion, PENDING), dast (`dast-runtime` kind, conditional).

The LLM keeps only the residual no scanner covers (per-record IDOR / object-authz logic,
guest-sensitivity judgment, prompt-injection, denial-of-wallet, business-logic, multi-step
authz) — labelled `llm-inferred`, over a deterministic fact substrate.

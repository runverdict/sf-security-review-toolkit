# Roadmap — cold-run hardening backlog

> Status: **ACTIVE backlog** (2026-06-30). Captures the toolkit-hardening work surfaced by a full
> end-to-end **cold run** against a real partner-shaped target (an external FastAPI + Next.js app with
> **nested** 2GP SFDX packages, an MCP server, Canvas SSO, and Agentforce — `sf`/scanners deliberately
> absent to exercise the cold-install path). Companion to
> [`roadmap-deterministic-findings.md`](roadmap-deterministic-findings.md) (the deterministic-band arc)
> and [`roadmap-preconditions-guided-remediation.md`](roadmap-preconditions-guided-remediation.md).
> This doc is the single pick-up-fresh source of truth for the open items below; each carries enough
> implementation detail to start a focused change without re-deriving the finding.

## Baseline at time of writing
- **`main` @ 0.8.57**, suite **62 files / 885 checks**, tag **HELD** (newest `v0.7.0`; `0.9.0` reserved).
  Each item below is its own change, with a standing test and housekeeping count-sync, landed one at a time.
- **B5 was RE-SCOPED (2026-07-03)** from the original 4-slice list into a tiered enterprise-grade engine
  buildout (cross-cutting reachability/exposure enablers + the named classes + completeness-audit misses).
  Shipped since: ReDoS (0.8.56), E0.1 reachability-path ingest (0.8.57). The B5 section below is the
  current source of truth; the Tier-0 sequence starts at E0.1b.

## Shipped + cold-validated this arc (context — DONE)
- **0.8.40 journey-wiring** — the 11 ingest adapters run in the journey via content-shape `--all`.
  Validated: `--all` ingested ~150 deterministic findings from 8 scanners on a real repo; the
  security-tag filter correctly dropped style/doc noise.
- **0.8.41 Code-Analyzer cold-install** — `sf` + `code-analyzer` plugin + JDK provisioned to a hermetic
  tmp root on consent → CRUD/FLS deterministic-by-default on a cold box. Validated: the stack
  cold-installed (pinned versions confirmed on disk) and Code Analyzer ran on a real `force-app`.
- **0.8.42 CA close-out** — `CA7` executor test (JDK verify-before-extract fail-closed), `CA_STACK_NAMES`
  guard, run-scans engine-explicit `-r sfge` form made primary.
- **README owner/agent correction** (docs-only) — Code Analyzer is "run *for* you"; genuinely-owner set
  is the Checkmarx portal scan + the live-prod authenticated DAST.
- **0.8.43 preflight/detection hardening** — `discoverPackages` recursion (nested SFDX), the
  READY-pending-sf-install precondition, deterministic plugin-version readout, gate-message clarity.
- **0.8.44 audit-engine robustness** — a crashed finder surfaces as "coverage incomplete — re-run X"
  (no longer silently dropped); the targeted re-run no longer crashes on auto-injected always-on
  dimensions. **Closed the silent-coverage-gap correctness bug.**
- **Cold-validated end-to-end on the real target**: the cold-install, the `--all` ingest, all OSS
  scanners, the local TLS grade (clears the SSL-Labs gate deterministically), AND the **deployed-org
  deep audit** (install + permission battery + uninstall-integrity + zero-residue teardown — the
  previously-unexercised legs) all ran. The deterministic scanners also caught a real history-secret the
  LLM audit missed (the scanners-add-value thesis, confirmed).

## Shipped this arc — pending cold-validation
- **0.8.45 B1 — static scanners BEFORE the LLM fan-out** *(shipped + test-backed; NOT yet
  cold-validated — the post-hardening clean cold run validates the reorder live, and that run also
  gates the tag)*. The journey now drives `scope → static scans → audit → artifacts →
  live/conditional scans`: a new static-scan-substrate step (Code Analyzer CRUD/FLS + sharing,
  external SAST, SCA + IaC, secrets, dependency audit; local TLS only under the already-recorded
  read-only probe consent) runs before the audit, so the audit's `--all` ingest seeds the
  deterministic band on the FIRST pass and the re-audit double-cost is gone. Three companion fixes
  landed with it: audit-codebase compiles the ledger digest AFTER its deterministic pass (the band
  is in the digest the fan-out reads — first-pass deferral at the finder level, not just at
  reconcile); run-scans carries the explicit static/live partition + the two journey entry modes
  (a bare invocation stays the standalone full sweep); and `render-router-status.mjs` gained the
  evidence-WITHOUT-audit-ledger rung (resume at the audit, never jump to compile). Consent posture
  unchanged — same gates, same ask-points, fail-closed; the substrate never installs. Standing
  tests: W12 (drive order + removed-rationale negative assertions), W13 (digest-after-deterministic-
  pass), W14 (partition/entry modes), RR6 (resume-ladder rung); suite 57 files / 740 checks.
  Complements the deterministic-findings arc: B1 makes the LLM *defer* on the first pass; B5 makes
  the scanners *find more*.
- **0.8.46 B2-P3a — `python` + `dockerfile` throwaway stand-up recipes** *(shipped + test-backed;
  NOT yet cold-validated — the live docker execution for the new kinds is operator-cold-validated,
  as the node path was; the standing tests pin the pure plans + the teardown name boundary)*.
  `standup-stack.mjs` covered only a plain `node` backend; it now plans + executes **`python`**
  (copy-in on a pinned `python:3.12-slim` base, deterministic install-then-run command that is a
  pure function of the recipe — the FastAPI/Flask/Django shape + the OpenAPI critical path for
  B2-#11) and **`dockerfile`** (build-then-run the partner's own Dockerfile into the toolkit-named
  `sf-srt-stack-<runId>:throwaway` image, which the existing name-scoped teardown removes with
  **zero teardown-logic change** — recorded from the pre-create name-stub so a crashed build stays
  teardown-able). The `node` plan + executor logic is byte-identical (verified: functional
  byte-identity of the node plan across the change + a whitespace-diff showing the copy-in executor
  block is a pure re-indent into the new `else`). Every safety property is kind-agnostic and
  unchanged (fail-closed without consent, 127.0.0.1-only host publish with `0.0.0.0` as the
  in-container bind only, env NAMES-only in plan + manifest with values via the `0600` `--env-file`).
  **`compose` stays honestly `unsupported`** (multi-container — needs a project-scoped teardown
  extension) → that is **B2-P3b**, now the next slice (see the backlog note); `procfile` likewise.
  Standing tests: U9 (python
  plan), U10 (dockerfile plan + `assertStackName` acceptance), U11 (python run-command purity),
  U12 (NAMES-only for the new kinds), U13 (kind-agnostic gates), U3 re-scoped (compose/procfile
  boundary lock), T8 (teardown accepts the built image, refuses a foreign one); suite 57 files /
  746 checks.
- **0.8.47 B2-#11 — real OpenAPI spec captured from the container-isolated mirror** *(shipped +
  test-backed; NOT yet cold-validated — the live capture GET is operator-cold-validated, like
  `run-dast`'s ZAP run; the standing tests pin the pure planner/validator/provenance + the skill
  wiring)*. The api-endpoints artifact fell back to code-derived + `PENDING live capture` whenever
  prod wasn't reachable; now, while the throwaway-DAST chain has the partner's backend up as an
  isolated loopback mirror, a new `harness/capture-openapi.mjs` reads the framework's OWN spec from
  that mirror (`/openapi.json` first; a fixed, JSON-only candidate order) → `evidence/openapi-<date>.json`
  + a provenance sidecar naming the `container-isolated-throwaway-mirror` source, and
  `generate-artifacts` Step 3 emits THAT as the real `artifact-api-endpoints-spec` with **`PENDING`
  scoped to the prod-equivalence attestation line only** (never claiming prod-equivalence; the
  no-capture fallback preserved verbatim). **Route B (container-isolated); Route A (host-venv import)
  stays rejected.** The loopback-only invariant is the security core — enforced at four layers (the
  shared `run-dast` `URL_OK` pre-filter, `planCapture`'s `assertLoopback`, an executor re-assert on
  the plan actually run, and a bare-rooted-path guard so a candidate can't re-aim the GET off the
  loopback base) — read-only (one `curl -sf` GET), **no new consent** (rides the recorded
  `throwaway-dast` token, verified as `run-dast` does), and only the validated spec (re-serialized) +
  provenance are ever persisted. `run-dast.mjs` change was byte-identical-value additive (two
  `const` → `export const` so the throwaway tier has one loopback definition). run-scans' DAST scope
  (Schemathesis + ZAP OpenAPI import) consumes the emitted artifact unchanged — now fed a real spec.
  Standing tests: O2 (planner loopback refusal) + O8 (executor re-assert) — the security invariant at
  both layers; O4/O5 (spec validation), O6 (honest provenance), O7 (consent fail-closed), O10
  (not-exposed writes nothing), W1-W4 (skill wiring); suite 58 files / 760 checks. MCP `tools/list`
  capture from the mirror is a scoped-out follow-on.
- **0.8.48 B2-P3b — `compose` throwaway stand-up + project-scoped teardown** *(recipe shipped +
  test-backed; the loopback boundary is COMPLETED by the B2-P3b-h hardening slice below — see the open
  backlog — and NOT yet cold-validated)*. `compose` was the last `stack-detect` recipe kind returning
  `unsupported`; it now stands up. Docker's own parser resolves the file
  (`docker compose config --format json` — the harness bundles no YAML lib), the pure `planCompose`
  picks the web tier and templates a loopback override (`!override`/`!reset` Compose V2 REPLACE tags —
  a plain `ports:` override would CONCATENATE and leave the base `0.0.0.0` publish alive) that rebinds
  the web tier to `127.0.0.1:<port>` and strips every other service's host ports; ambiguous web-tier
  identification is REFUSED not guessed; unsafe service names are refused (an injection guard on the
  string-templated override). The project runs under the toolkit run-name so `teardown-stack` removes
  it as ONE project-scoped `docker compose -p <project> down -v --remove-orphans` (the project name
  asserted against the toolkit convention before any `down`), and the sweep now also clears orphaned
  compose networks/volumes name-scoped. No new consent (rides the kind-agnostic gates); node/python/
  dockerfile + the single-container teardown path are byte-identical. Standing tests: U14 (pre-plan),
  U15 (the loopback override — rebind + strip + REPLACE-tags), U16 (refuse-on-ambiguity), U17 (gates),
  U18 (NAMES-only + injection guard), T9/T10 (project-name teardown boundary); suite 58 files / 767
  checks. **Loopback boundary COMPLETED (0.8.49, B2-P3b-h):** `planCompose` now also refuses any
  service whose `network_mode` is `host` / `container:*` / `service:*` (the namespace-sharing modes
  that sidestep port publishing, checked before web-tier selection), while `bridge`/`default`/`none`/
  absent stand up as before — so the 127.0.0.1-only guarantee holds for every compose shape the engine
  accepts (U19; suite 58 / 768). The compose recipe + its loopback boundary are now fully in place
  (still pending the one cold run that cold-validates the whole B1..B2 arc).
- **0.8.50 B2-P2 — org-tier `standup-org` / `teardown-org` scratch-org lifecycle** *(shipped +
  test-backed; the live `sf org create/delete` is operator-cold-validated, like the docker executors)*.
  The deployed-org deep audit improvised `sf org create scratch` / `sf org delete` inline in skill prose
  each run; the lifecycle is now a deterministic engine pair mirroring `install-scanners`/`standup-stack`.
  `standup-org.mjs`: pure `planStandupOrg` (toolkit alias `sf-srt-org-<runId>`, Developer +
  `Einstein1AIPlatform` default definition, `--no-ancestors`, clamped duration) + a fail-closed executor
  that verifies the recorded `sf-deep-audit-ops` token (no new consent), degrades honestly on
  `no-devhub` (Dev Hub auth stays owner-interactive — the engine never authenticates), and writes a
  strict NAMES/IDS-only manifest (the create's `authFields` access token is parsed out and discarded).
  `teardown-org.mjs` — the destructive half: **`assertOrgAlias` gates every irreversible `sf org delete`
  on the fully-anchored `sf-srt-org-` convention, asserted before any delete on every path** (the plan,
  the crash-cleanup, the machine-wide `--sweep`), with no bare `--target-org` fallback; consent is
  **doubly coupled** (the recorded token AND the org's originating-repo token); an unavailable `sf` never
  reads as "org gone" (a created org's teardown record survives, failing loud not false-clean); asymmetric
  + idempotent, evidence KEPT. Four deep-audit skills now invoke the engines; the build/install/audit/
  mcp-teardown steps are unchanged. `assertSafeTmpRoot` also boxes the new `sf-srt-org` grouping dir.
  Standing tests (hermetic — a stubbed `sf` + isolated TMPDIR, no live org ever reachable): the
  alias-name-guard security matrix (foreign / contains-prefix / trailing-newline / whitespace / empty /
  null all refused), fail-closed consent, origin-repo coupling, `sf`-unavailable honesty, dry-run purity,
  the names-only manifest allowlist, idempotence, the sweep contract; suite 60 files / 788 checks.
- **0.8.51 B3a — deterministic-band disposition → ledger status (verdict honesty)** *(shipped +
  test-backed)*. The audit adjudicated a deterministic scanner class FP into the FP-dossier prose, but
  nothing flipped the ledger status, so `finding-clusters --headline` + `compute-sci` kept counting
  refuted noise as open blockers (the "4 critical / 112 high" over-count). New `harness/apply-dispositions.mjs`
  — a structural twin of `reconcile-provenance.mjs` (pure, idempotent, marks-never-deletes,
  protected-state-aware, `--dry-run`) — reads a structured `.security-review/deterministic-dispositions.json`
  (engine + ruleId + `refuted`|`accepted_risk` + reason [+ justification] [+ scope.files]) and flips the
  matching `provenance:'deterministic'` findings out of the open band, keeping provenance/engine/ruleId/
  class/severity intact and stamping an auditable `disposition_reason`. **The determinism boundary:** the
  APPLICATION is 100% deterministic; the ADJUDICATION stays the labelled LLM/human residual recorded as
  data (no hardcoded auto-refute ruleset — a usually-noisy rule can be a real bug). **Paramount safety
  (verified):** a disposition can ONLY move a deterministic finding OUT of the open band — never an
  llm-inferred one (it can't hide an LLM-confirmed blocker, proven against an impostor carrying matching
  engine/ruleId), never into open, never `fixed`; exact engine+ruleId match; `accepted_risk` schema-valid;
  a corrupted dispositions file fails LOUD. The FP dossier row and the ledger refutation share the one
  disposition entry (single source). Wired after `reconcile-provenance` in audit-codebase + the run-scans
  tail; the recap surfaces "N open · M dispositioned" so the drop is never silent. Standing tests: the
  llm-never-flipped safety test + the verdict-honesty integration (SCI/headline count drops to the real
  blockers) + provenance-kept + idempotence + protected-states + accepted_risk-justification + the wiring;
  suite 61 files / 814 checks.
- **0.8.52 B3b — render element-type synonym keying (GAP-Y)** *(shipped + test-backed)*. The scope
  manifest is LLM-authored, so a real run typed the external backend `external-web-app` (a synonym of the
  canonical `external-endpoint`); the scan-status render keyed the Applies gate on the canonical type and
  short-circuited Families 3/4/7/8 to N/A **before checking their evidence** — families that ran with
  SATISFIED evidence read N/A. A single conservative `canonicalElementType` helper (home:
  `render-detected-elements.mjs`, exporting `ELEMENT_TYPE_SYNONYMS`) aliases the clear external web-app/API
  synonyms → `external-endpoint` (exact-string match only — a non-string/array/`toString`-less type is
  returned unchanged, an unknown type is never coerced, never into `managed-package`/`mcp-server`/
  `agentforce`), wired into `render-scan-status.mjs`'s `appliesToFamily` (+ the detected-elements sort).
  Canonical types render byte-identically; suite 61 files / 818 checks. **This is the RENDER half only —
  the same synonym still under-scopes the go/no-go GATE (`applicable-requirements.mjs`), which is B3b-2
  below.**
- **0.8.53 B3b-2 — canonicalize element-type synonyms at the go/no-go GATE (GAP-Y2)** *(shipped +
  test-backed)*. The render fix (B3b) left the gate under-scoping: `applicable-requirements.mjs` mapped
  `(m.elements||[]).map(e => e.type)` raw, so an `external-web-app` manifest computed 86 applicable
  requirements instead of 113 — silently dropping the external-endpoint control set (DAST, TLS,
  `endpoint-*`, external SAST/SCA/IaC), which feeds `compute-sci`'s blocker floor + completeness, so a
  synonym-typed external app could read falsely-ready with its controls never required. The existing
  `canonicalElementType` is now applied at the single chokepoint (top of `computeApplicable`,
  lowercase-then-alias so the gate's case-insensitivity extends to synonyms), so every caller (CLI
  manifest path, `--elements`, `renderApplicable`) flows through it; `render-scope-summary`'s sort folds
  it in too. An `external-web-app` manifest now computes EXACTLY the `external-endpoint` applicable set
  (`deepEqual`, 113 — the 27 dropped restored, 6 blocker-severity pinned into the compute-sci seam),
  canonical scopes byte-identical, an unknown type adds nothing (no over-scope). `compute-sci` untouched
  (it consumes the corrected set). Suite 61 files / 827 checks. **Follow-up (B3b-3):** the same
  raw-`e.type` fragility survives in other consumers (notably `compile-submission`'s re-intersect) — see
  the open backlog.
- **0.8.54 B3b-3 — applicable set read verbatim at compile + stale-scope-manifest refusal (GAP-Y3)**
  *(shipped + test-backed; verified off disk against the prior engine)*. The two seams that could still
  resurrect the truncated set the 0.8.53 gate fix closed are shut. **(A)** `compile-submission` re-derived
  applicability by raw `applies_to`-vs-element intersection at three sites (the conflicting-entries
  collection ~66, the step-2 inventory filter ~77, the slot-suppression rule ~408) — on a synonym-typed
  manifest the compiled checklist/questionnaire/slots could silently omit the external rows while the SCI
  gate counted them missing. All three now read the manifest's `applicableBaselineIds` **verbatim** (the
  single persisted authority — exactly what `compute-sci.mjs:60` consumes); the genuinely element-branching
  conditionals match types through the canonical form (`ELEMENT_TYPE_SYNONYMS` keeps its one home; the
  CONVENTIONS tree-line enumeration was trimmed to reference-plus-example). The journey's artifact step
  (step 5) had the same narration — also converted. **(B)** The operational carryover turned out to have
  gate weight, not note severity: a pre-0.8.53 manifest persists the truncated id set and `compute-sci`
  consumed it verbatim — the falsely-ready failure surviving via the persisted cache. `compute-sci` now
  recomputes the set from the manifest's own elements (reusing `applicable-requirements.mjs`'s exports —
  that file needed zero diff) and REFUSES on any set difference (order-insensitive, duplicates ignored,
  missing-stored-with-elements included, BOTH drift directions) with a `STALE SCOPE MANIFEST` block +
  **exit 2**, routing to a scope-submission re-run. Refuse-only: it never adds, removes, or substitutes
  ids; a fresh manifest computes **byte-identically** to the 0.8.53 engine (proven old-vs-new across
  fresh-synonym/canonical/nontrivial/empty/no-manifest/whitespace/skip shapes, text + `--json`); element
  types are trimmed so stray whitespace never false-positives; the same check catches a baseline changed
  by a plugin upgrade after scoping. A manifest carrying stored ids but NO elements is out of the check's
  reach (documented: a hand-edited shape scope-submission never writes; behavior byte-identical to prior).
  **(C)** Canonical-form notes landed in the four remaining consumers (reviewer-simulation's challenge
  filter, prepare-test-environment's component selection, run-scans' family Applies-when column,
  stay-listed — which now also reads `applicableBaselineIds` verbatim). Standing-test fixtures that pin
  arbitrary stored id sets now carry internally consistent manifests (elements was dead weight in them
  before this change), so pinned layers can't trip the refusal as the baseline grows; the solano
  CORROBORATE layer now exercises the fresh path with real elements. Standing tests: S1-S5 (exit-2 stale
  on both output paths with counts + missing-id sample; fresh synonym ≡ canonical byte-identical;
  shuffled/dup not stale; missing-stored stale; whitespace-trim) + W1-W3 (the three compile sites +
  journey routing + the four notes, with negative assertions on the old re-intersect phrasings); the
  staleness check is mutation-proven. Suite 61 files / 835 checks.
- **0.8.55 B3c — `write-drafted-content.mjs`, the path-scoped drafted-artifact writer (GAP-Z)**
  *(shipped + test-backed; the guard verified by direct attack + two independent mutation proofs)*.
  The artifact Workflow's drafting agents are read-only (the engine returns
  `{ drafted: [{ key, out, content }] }`); generate-artifacts step (d) had the driver improvise the
  extract-and-write each run, and NOTHING validated the Workflow-returned `out` — LLM-influenced data
  crossing a write boundary (`build-artifact-engine` stores it unguarded). The new harness is the
  single write point: unwraps the task-output envelope per merge-ledger's two-shape doctrine (keyed on
  the `drafted` payload), validates EVERY output path on its RESOLVED and symlink-REALIZED form
  (no absolute/NUL/empty, strict `startsWith(repo + sep)` containment — sibling-prefix safe, nothing
  at/under `.git/`, an allowed-roots floor of `docs/security-review/` + `.security-review/`, an
  lstat-aware deepest-existing-ancestor realpath re-assert so symlinked-dir escapes, planted symlink
  FILES at the target, and dangling links are refused, not written through), and is PLAN-then-EXECUTE
  **all-or-nothing** — one invalid path refuses the whole envelope (exit 2, zero writes; a poisoned
  path refuses even a gate-suppressed entry; duplicate resolved targets refused; each entry
  re-validated immediately before its own write). Byte-exact utf8; empty/dead-agent drafts skip LOUD
  (never blank a prior draft); `--input` cross-checks `gate.suppress` (a stale/resumed envelope cannot
  resurrect a withheld doc; the engine stays the enforcement point; the WITHHELD placeholder stays
  driver-side). The audit substrate needs no sibling — its synthesis step writes its own report
  (verified: `workflow-template.mjs` ~488); engine/template untouched; step (d) now invokes the
  harness with the matching allowed-tools grant. Standing tests: 29 checks (G1-G9 the guard by direct
  attack incl. planted/dangling symlinks + NUL + `.git` routed through an allowed root; R1-R6
  byte-exact/envelope-shapes/idempotence/overwrite; A1-A2 duplicate-refusal + read-only plan; GC1-GC4
  gate/empty-content; D1-D2 dry-run/json; E1-E2 degenerate envelopes; W1-W4 wiring incl.
  audit-untouched). Mutation-proven twice: rule set neutralized → 9 checks RED; realized re-assert
  alone neutralized → exactly the two symlink checks RED (the layer is independently load-bearing).
  Suite 62 files / 864 checks.

---

## OPEN BACKLOG — prioritized

Suggested order: **~~B2 (throwaway tiers + OpenAPI)~~ DONE → ~~B3 (verdict-reflection)~~ DONE
(B3a/B3b/B3b-2/B3b-3/B3c all shipped) → ~~B4 (PENDING labeling)~~ RESOLVED by re-grounding (no code
change — see below) → B5 (residual-shrinking — **ReDoS is THE NEXT ITEM**) → B6 (prose) →
B7 (gate-consolidation)**. One item at a time, each test-backed. Tag stays HELD until a clean cold run on
the post-hardening build justifies it.

### ~~B2 — Throwaway-tier pull-forward engines + container-isolated OpenAPI~~ **COMPLETE (0.8.46–0.8.50)**
All three "throwaway" tiers now pull forward: scanner-dir (DONE, 0.6.0), server/mirror (**DONE — node +
python + dockerfile + compose, loopback-hardened**), org (**DONE — `standup-org`/`teardown-org`,
0.8.50**). Every slice below is shipped + test-backed (see "Shipped this arc"); the whole arc is still
pending the one clean cold run that cold-validates B1..B2 (that run also gates the tag).
- ~~**B2-P3a — python + dockerfile `standup-stack` support**~~ **DONE (0.8.46)** — see "Shipped this
  arc" above. Single-container recipes that fit the existing teardown model with zero teardown change.
- ~~**B2-#11 — OpenAPI spec, Route B (container-isolated)**~~ **DONE (0.8.47)** — see "Shipped this
  arc" above. `harness/capture-openapi.mjs` reads the framework spec from the isolated mirror;
  `generate-artifacts` emits it as the real artifact with `PENDING` only on prod-equivalence. The
  scoped-out remainder (a follow-on, not blocking): the live MCP `tools/list` capture from the mirror.
- ~~**B2-P3b — `compose` `standup-stack` support**~~ **RECIPE DONE (0.8.48)** — see "Shipped this
  arc" above. The compose stand-up (docker-resolved config → pure `planCompose` → loopback override →
  project-scoped teardown) ships; the loopback boundary needs the port-based override COMPLETED by the
  hardening slice below before it is called delivered.
- ~~**B2-P3b-h — compose loopback hardening (network-mode)**~~ **DONE (0.8.49)** — see "Shipped this
  arc" above. `planCompose` refuses `host`/`container:*`/`service:*` network modes (checked before
  web-tier selection); `bridge`/`default`/`none`/absent stand up as before. The compose loopback
  boundary is now delivered.
- ~~**B2-P2 — org-tier `standup-org`/`teardown-org` engine**~~ **DONE (0.8.50)** — see "Shipped this
  arc" above. The scratch-org create/delete lifecycle is now a deterministic engine pair with a
  name-guarded, irreversible teardown; the four deep-audit skills invoke it instead of improvising
  `sf org create/delete` inline.

### B3 — Deterministic-band disposition → verdict reflection  *(verdict-honesty)*
- ~~**B3a — the class-disposition harness (the verdict-honesty core)**~~ **DONE (0.8.51)** — see
  "Shipped this arc" above. `harness/apply-dispositions.mjs` flips matching deterministic ledger entries
  `confirmed → refuted`/`accepted_risk` from a structured `deterministic-dispositions.json`, so the
  headline + blocker floor + SCI count the real blockers; a disposition can only ever move a
  `deterministic` finding OUT of the open band (never an llm-inferred one, never into open, never
  `fixed`), provenance kept intact, single-sourced with the FP dossier.
- ~~**GAP-Y / B3b — render element-type keying**~~ **DONE (0.8.52)** — see "Shipped this arc" above.
  A single `canonicalElementType` helper (home: `render-detected-elements.mjs`) aliases external
  web-app/API element-type synonyms (`external-web-app` + siblings) → `external-endpoint`, wired into the
  scan-status **render** so families that ran read DONE not N/A.
- ~~**GAP-Y2 / B3b-2 — canonicalize element types at the GATE**~~ **DONE (0.8.53)** — see "Shipped this
  arc" above. `canonicalElementType` wired into `computeApplicable` (single chokepoint,
  lowercase-then-alias); an `external-web-app` manifest now computes EXACTLY the `external-endpoint`
  applicable set (deepEqual, 113; the 27 dropped controls restored, 6 blocker-severity pinned to the SCI
  seam), canonical unchanged, no over-scope — the go/no-go gate no longer under-requires the
  external-endpoint control set on a synonym-typed manifest.
- ~~**GAP-Y3 / B3b-3 — finish element-type synonym resilience across the REMAINING consumers**~~
  **DONE (0.8.54)** — see "Shipped this arc" above. The `compile-submission` re-intersect was confirmed
  (three prose sites) and converted to reading `applicableBaselineIds` verbatim; the operational
  carryover was resolved as a deterministic `STALE SCOPE MANIFEST` refusal in `compute-sci` (exit 2,
  refuse-only, fresh-path byte-identical); the four note-severity consumers carry the canonical-form
  note (stay-listed also reads the persisted set verbatim).
- ~~**GAP-Z / B3c — extract-drafted-content + write harness**~~ **DONE (0.8.55)** — see "Shipped this
  arc" above. `harness/write-drafted-content.mjs` shipped as the single write point with the
  path-scoping guard (lexical + symlink-realized double assert, allowed-roots floor, all-or-nothing),
  wired into generate-artifacts step (d); audit-codebase confirmed to need no sibling (its synthesis
  step writes its own report).

### ~~B4 — PENDING labeling / wiring fixes~~  **RESOLVED by re-grounding (2026-07-03) — no code change**
A code-grounding pass ran all three bullets to ground; every one closed without a slice:
- **(a) UEC grant / `04t` PENDING relabel — NO MISLABEL EXISTS.** Every `PENDING-OWNER-RUN` near
  UEC/`04t`/install/package in `harness/` + `skills/` is the HONEST fail-closed precondition narration
  (absent tool → owner installs; unpinned binary → refused; `render-preflight`'s
  "READY — pending sf install + Dev Hub auth" is the correct qualified label;
  `package-readiness.mjs`'s verdicts are accurate). The mislabel lived only in a past live-run
  transcript, not in the toolkit. Dropped.
- **(b) local-TLS SCI currency — NO SEAM EXISTS; already correct.** `compute-sci`'s crediting is
  generic and evidence-keyed (`disposition:'satisfied'` + `verified.value:true` +
  `reviewer_reproducible:true` → full SATISFIED); nothing anywhere distinguishes local
  `tls-<host>-<date>.json` from `ssllabs-<host>.json`, and `build-evidence-index` applies
  `statically-cleared` ONLY to white-box-audit-backed clears (a testssl/sslyze report registered as
  evidence gets the generic reviewer-reproducible treatment). The currency caveat that DOES ride on
  `endpoint-ssl-labs-a-grade` is the baseline entry's own `verification: conflicting` bucket (whether
  reviewers enforce the letter grade — the deliberate confirm-with-your-PAM surface, independent of
  which TLS evidence was captured), and its `last_verified: 2026-06-12` is inside the 90-day window.
  Fixing that caveat would mean removing an honest signal — not a fix. Dropped.
- **(c) checkmarx-prediction + `CX_APIKEY` cx-scan** — already shipped (0.4.4, commit 47efea0);
  deleted from this doc 2026-07-02.

### B5 — Residual-shrinking track  *(THE differentiator — RE-SCOPED 2026-07-03; see roadmap-deterministic-findings §4)*
> Re-scoped from a 4-class list into a **tiered engine buildout** after a review (2026-07-03) of the
> current deterministic coverage against the OSS-tool landscape across ~10 vulnerability classes and a
> class-completeness audit vs the OWASP Web/API/LLM Top-10s, CWE Top-25, and the Salesforce review
> categories. **Standing architectural rule for every B5 adapter — supersession-safety: if the target
> dimension is MULTI-SHAPE, `classify()` MUST return `null`** (a class may be owned only in a single-shape
> (sub-)dimension the adapter fully owns). This is the ReDoS lesson, and it is defense-in-depth
> (classify-null AND `buildFinding` won't attach a class absent from `CLASS_DEFS`). Each slice ships one
> class at a time, test-backed, with a captured real-tool fixture and a mutation proof.

**The honest floor, redrawn precisely.** The old "llm-only/partial" labels conflated two different
things: judgments that are IRREDUCIBLE (Rice-theorem business-logic + multi-step authz — the platform
reviewer pen-tests these by hand, they stay `llm-inferred`), and judgments left to the LLM ONLY because
the toolkit never ingested a substrate its own scanners already compute. One-line floor: **the toolkit
can deterministically decide "an unsafe path / an ungated grant / an unguarded sink / an unsafe regex
exists here, and here is the path" — it cannot decide "and that path is reachable with hostile input, the
sink is metered, the grant is on sensitive data, and nothing upstream saves it."** The reachability PATH
is substrate; the trust-model GROUNDING of the path's source is residual. North Star unchanged:
deterministic substrate maximized + a labelled semantic residual, NOT literal 100%.

#### Tier 0 — cross-cutting enablers (build FIRST; each unlocks several classes; zero/low new tooling, near-zero FP)
- ~~**E0.1 — reachability-path ingest**~~ **DONE (0.8.57)** — the Semgrep adapter now captures
  `extra.dataflow_trace` (source→intermediate→sink, locations only — matched-content strings dropped) as
  a `reachabilityPath` attribute + `reachable:true`, purely additive (absent/malformed trace → no
  attribute, trace-less findings byte-identical; `classify()` unchanged). `templates/audit-ledger.schema.json`
  gained the optional properties (finding is `additionalProperties:false`). Graded off disk: RP1/RP2/RP3
  + mutation, independently reproduced. **Note for later slices:** newer Semgrep CLIs omit
  `dataflow_trace` from `--json` (text/SARIF only), and run-scans Family 7 doesn't yet pass
  `--dataflow-traces` — wiring that flag / the Opengrep engine is E0.2's job. SARIF `codeFlows` + SFGE
  entry-point→DML vertices remain the other normal-form inputs to fold in as those engines land.
- **E0.1b — ingest-ROUTING fix (cheap, high-value; pairs with E0.1).** *WIRE — reclassify already-
  captured findings.* Scanner output for SOQLi/XSS (Code Analyzer), pickle/yaml/XXE (bandit B301/B506,
  semgrep, njsscan) and `getSessionId` retrieval (Code Analyzer) ALREADY fires but is tagged class-less
  or under the wrong label (`external-sast`/`apex-exposed-surface`), so it never routes to
  injection-xss / untrusted-deserialization / sessionid-egress and never informs those dimensions. This
  is an ingest-routing gap, not a detection gap. Route each to its dimension via `dimensionHint`.
  **Supersession-safety:** injection-xss + untrusted-deserialization are MULTI-SHAPE → keep
  `classify()=null` (route the dimension, do NOT own a class), so a SOQLi row never silences a co-located
  XSS judgment. Standing test: a captured SOQLi/XXE fixture lands in the right dimension, class-less, and
  does not supersede a co-located LLM sibling.
- **E0.2 — Opengrep swap for the external/JS-LWC taint tier.** *WIRE — adapter drop-in (byte-compatible
  CLI+JSON).* Opengrep (LGPL-2.1, the OSS Semgrep fork) deepens intra-file → interprocedural (intra-file)
  taint for JS/TS/Py/Go/Java — deeper `reachabilityPath` for the same E0.1 classes, reusing the adapter
  verbatim. **Critic note:** Opengrep is ~2025-new — keep **Semgrep CE as the baseline** and Opengrep as
  the deepening swap so an Opengrep instability can't break the taint substrate. Cross-*file* bridging is
  neither engine's job — that stays LLM/human. Same Apex blind spot as Semgrep (SFGE owns Apex).
- **E0.3 — Salesforce Guest/Metadata Exposure Mapper (the single most novel + timely BUILD).** *BUILD a
  novel `source-scanner` (clone the `metadata-viewall` kind — glob XML → parse → class-severity finding,
  zero harness-core change).* Computes, from metadata XML with **no live org**: (a) guest/site profile →
  object/field/class/page grant join × entry-point (`@AuraEnabled`/`@RestResource`) × class
  `with/without/inherited sharing`; (b) NamedCredential + RemoteSiteSetting + cspTrustedSite + Apex
  `callout:` host inventory (flag plain-HTTP, wildcard hosts, remote sites with no matching Named
  Credential); (c) permset/profile CRUD+FLS grant matrix + **release-to-release diff** (flag any grant
  that widened). Moves guest-exposure + egress-trust + part of admin-surface/tenant-isolation from
  llm-only → deterministic. No OSS tool builds this join; the commercial SF tools (Clayton/DigitSec) are
  portal-only SaaS. Directly models the 2026 guest-`/sfsites/aura` data-theft campaign. **FP guardrail:**
  source-only cannot see OWD/sharing rules → cap severity at **"statically-exposed grant," never
  "confirmed leak."** **Scope-gate:** must NOT fire for a headless MCP-only package with no Experience
  Cloud site (PENDING noise). Single-shape sub-classes it fully owns → may own a class, but must not
  bleed into the multi-shape tenant-isolation dimension.

#### Tier 1 — the four class slices, sharpened (build on the Tier-0 enablers)
- **T1.0 — ReDoS oracle durability (OPTIONAL hardening; NOT urgent).** ReDoS **shipped + graded PASS
  (0.8.56)** with `regexploit` (format-C; the adapter parses stdout, so regexploit's "exit 0 even when
  vulnerable" is a non-issue for us, and twice-run byte-identity is proven). The research prefers
  `recheck` (actively maintained, structured JS API via a small Node harness, automaton-mode) over
  regexploit (no release since ~2021, text-scraping brittleness) for **long-term durability** ("stay
  present"). **Critic call: do NOT churn a graded-PASS slice** — keep regexploit now; schedule a recheck
  migration as optional hardening, not a blocker. `classify()=null` either way.
- **T1.1 — prompt-injection reachability.** *WIRE Semgrep AI packs (pin the FREE-engine subset — some
  `p/ai-best-practices` rules are Pro-gated and silently drop on a cold install; the pack is deprecated,
  migrated into semgrep-rules) + a custom sink overlay.* Substrate = the taint EDGE (E0.1): untrusted
  request/tool data → LLM-prompt sink, and LLM-output → dangerous sink. The load-bearing custom piece off-
  the-shelf packs miss (they target LangChain/CrewAI): a rule for a partner's hand-rolled surface — direct
  LLM-SDK calls (google-genai / openai / vertex / etc.), custom tool-dispatch, and MCP tool handlers as
  sinks, and **`LLM-output → Salesforce write-back | SF callout | JSX/DOM render without escaping`**
  (LLM05+LLM06 — the render-without-escaping surface covered by nothing OSS). `classify()=null`
  (injection-xss + agentforce are multi-shape). Residual: injectability/exploitability.
- **T1.2 — denial-of-wallet.** *WIRE a first-party Semgrep pack (+ recheck for the regex arm).*
  Deterministic substrate = pure AST-presence guard checks with **no external compensating control**:
  query-without-`.limit()`, LLM-call-missing-`max_tokens`, unbounded decompression (`io.Copy` vs
  `io.CopyN`, `extractall` with no threshold), and an **unbounded task-queue enqueue in a loop** (Celery
  `.delay()`/`.apply_async()`, RQ, Sidekiq — a fan-out vector no OSS pack models). **THE track's #1
  honesty guardrail (hard rule): "missing rate-limit" MUST NOT be emitted `deterministic`** —
  compensating controls at the CDN / gateway / reverse-proxy layer are invisible to any source scanner,
  so a naive rule over-reports every handler. Route missing-rate-limit through LLM/owner adjudication (or
  ingest gateway config first). `classify()=null` (RCA multi-shape). Standing test asserts
  missing-rate-limit is tagged adjudicated/`llm-inferred`, NEVER `deterministic` — that assertion is the
  slice's point.
- **T1.3 — IDOR/BOLA.** *Split by surface: WIRE SFGE for Apex; BUILD a 2-identity loopback differential
  for the external app.* **Apex:** pin SFGE `ApexFlsViolation` as the CRUD/FLS substrate + PMD
  `ApexCRUDViolation` as the coarse fallback; upgrade SFGE ingest to capture entry-point→DML vertices
  (E0.1 sibling). **MUST-VERIFY before building:** the research claims Graph Engine CRUD/FLS is
  **v4-only, not re-hosted in v5** — following Code Analyzer to v5 without an explicit SFGE pin would
  silently drop the toolkit's PRIMARY substrate (Apex object/field authz). Verify the installed CA/SFGE
  version off disk first. **External:** BUILD a small differential — throwaway app on loopback →
  provision org A + org B + unauth client → harvest A-owned object IDs from A's OWN list endpoints
  (never guess UUIDs) → replay each object-referencing route under {A, B, no-auth} → **status-first
  differential** (near-zero FP; body-diff is where FP creeps). **The RLS row-count oracle is the
  differentiator BUT is architecture-CONDITIONAL** — it applies only to a backend that enforces tenant
  isolation via Postgres RLS + per-request GUC (seed a row under org A, bind the session as org B, assert
  zero rows → effectively CONFIRMED). Gate it on DETECTING that architecture; for other stacks it does
  not apply. Needs a running target → gate behind the existing scan-org consent (the one Tier-1 slice
  that is not cold-install-only). `classify()`: the RLS-oracle finding may own a class (single-shape:
  cross-tenant read = auto-fail); the static prefilter emits PLAUSIBLE class-less and only feeds the
  dynamic oracle. FP note: loopback-mirror fidelity (the app's tenant-isolation binding, async workers,
  and rate-limits) must be faithful or the differential runs against a non-representative app.

#### Tier 2 — backlog adapters (net-new classes; mostly cold-install drop-ins, cheapest-first)
- **@salesforce/eslint-plugin-lwc** — LWC DOM-XSS (Top-20 class with ZERO deterministic engine today);
  near-zero FP; adapter-drop-in. *Highest-ROI net-new wire.*
- **Lightning Flow Scanner + flip Code Analyzer v5 `flow` engine** — Flow unsafe-running-context /
  secrets-in-Flow (PMD/SFGE structurally ignore Flow XML); adapter-drop-in + config flip.
- **A small Salesforce-idiom custom PMD/Semgrep ruleset** — sensitive-info-in-debug-log, Lightning
  Message Channel `isExposed`, JS-not-in-static-resource, username/email enumeration, CSV/formula
  injection on export, Apex `JSON.deserialize`→sObject mass-assignment (the one deserialization variant
  no scanner covers). The one place a custom ruleset out-earns off-the-shelf.
- **syft** (SBOM CycloneDX/SPDX — reviewers want the deliverable), **GuardDog** (malicious/typosquat
  deps; osv/npm-audit are blind to un-CVE'd malicious packages), **ScanCode** (license facts; noisy →
  detection deterministic, compatibility=LLM), **CA v5 `regex`/`eslint` engines** (already provisioned,
  unused — config flip). All cold-install adapter-drop-ins.
- **Network-gated / opt-in (breaks local-only posture — flag hard, gate like live-probe consent):**
  `trufflehog --results=verified` (secret liveness; AGPL, invoke-only), **mcp-scan** (MCP tool-
  description poisoning/shadowing — the AgentExchange surface vetted only by the LLM today), OSSF
  Scorecard (supply-chain hygiene). **oauth-identity sliver:** a small deterministic slice (JWT
  `alg=none` / hardcoded JWT secret via semgrep) + the E0.3 egress map; OAuth flow correctness stays
  irreducible LLM.
- **Cross-engine dedup (Extension #3) becomes the gating debt** once Tier-2 lands — every add that
  overlaps a shipped engine (Flow Scanner↔CA `flow`, trufflehog↔gitleaks↔detect-secrets, trivy↔checkov)
  emits visible duplicate rows until dedup lands (under-merge is the safe failure; schedule it before the
  ledger gets noisy).

#### Explicitly DROP / do not add (hygiene)
tfsec (deprecated — *is* trivy-config now), terrascan (archived Nov 2025), grype/pip-audit/cargo-audit/
KICS (redundant with osv-scanner V2 SCALIBR + checkov + trivy — marginal substrate, multiplies dedup
burden), **CodeQL — excluded entirely** (the CLI/engine is free-for-OSS-ONLY; its license forbids
scanning a closed partner package outside GitHub Advanced Security, which is our users' exact case, so it
is untestable and inapplicable for most partners; it does not support Apex anyway, and SFGE already owns
that substrate; Opengrep is the free-for-commercial taint engine the toolkit uses instead — an
adapter the toolkit cannot install, run, or validate for its own users is pure liability, so CodeQL is
not offered in any form), Snyk Code (commercial + ML-nondeterministic — violates the determinism
contract), promptmap (GPL-3.0 — never vendor).

#### Recommended sequence (each slice one-at-a-time, test-backed)
1. ~~**E0.1 reachability-path ingest**~~ **DONE (0.8.57).** Next: **E0.1b routing fix** (reclassify the
   already-captured SOQLi/XSS/deser/sessionid findings to their dimensions; cheapest, zero new tools,
   near-zero FP; `classify()=null` on the multi-shape dimensions).
2. **T1.1 prompt-injection reachability** (custom LLM-SDK / MCP / SF-write-back sink overlay on the E0.1 edge).
3. **T1.2 denial-of-wallet** (AST-presence guards; the missing-rate-limit honesty assertion is the point).
4. **E0.3 guest-exposure mapper** (novel cold-install source-scanner; highest novel value, no running
   target — could be pulled earlier if the guest surface is the priority).
5. **T1.3 IDOR/BOLA** (last in Tier 1 — needs a running target + the E0.1 prefilter; verify SFGE v4/v5
   first; RLS oracle gated on the architecture).
6. **Tier-2 drop-ins**, cheapest-first (@salesforce/eslint-plugin-lwc → Flow Scanner → syft → GuardDog →
   ScanCode → network-gated trufflehog-verified / mcp-scan / Scorecard), then **cross-engine dedup**.

**Over-optimistic claims flagged (do not budget on these):** "~80-90% of the class surface goes
deterministic" is a whole-program-WITH-live-endpoint figure — the cold-install static pass is far lower;
"missing rate-limit is a deterministic hit" is DANGEROUS (compensating controls invisible to source);
agent-audit / trufflehog / semgrep-AI vendor benchmarks are self-reported on framework-native code —
a partner's hand-rolled LLM/MCP surface will under-fire without the custom overlay; the RLS oracle is
"CONFIRMED" only if the loopback mirror faithfully reproduces the app's tenant-isolation binding, async
workers, and rate-limits; SFGE
Graph-Engine CRUD/FLS currency (v4 vs v5) must be pinned or coverage silently lapses.

### B6 — "human" → conversational prose sweep  *(SURGICAL, not blanket — a review flagged the old framing as DANGEROUS)*
The raw count is accurate (87 whole-word `human`/`Human` across 31 tracked files), but a review
(2026-07-02) found the "reframe to second-person" framing WRONG for the large majority, and a blanket
sweep would cause real damage. **The slice is a KEEP/REWRITE classifier, not a find-replace. NEVER touch:**
- **`--result-format human`** (and any `human` that is a literal CLI value / enum / flag) — rewriting it
  is a FUNCTIONAL BUG.
- **the "LLM/human residual" / "human-adjudicated" vocabulary** — that is the **LOCKED North Star**
  (see Locked decisions); rewriting it contradicts this very doc.
- **`human` as the actor-noun distinguishing the person from the agent/toolkit** — "the human owns the
  submit," "a human tester," "human-by-necessity," "owner-signed / human signature" — these are
  load-bearing honesty vocabulary, not AI-tells.
**ONLY rewrite** genuine AI-authored throat-clearing where "human" reads as an awkward third-person
stand-in for the reader (e.g. "the human should run…" → "run…"/"you run…"). Produce the keep/rewrite
list FIRST (grep + classify), get it right, then apply. Skill + harness prose is a code change;
README/CONVENTIONS/docs is a docs-only change. Low value, real risk — do it carefully or defer it.

### B7 — Structural gate-consolidation  *(consent-arch — needs design, lowest priority)*
The journey elects the audit tier up front, then the `audit-codebase` launch gate re-asks/confirms the
tier (it's also the target-map approval point + the fail-closed token-spend authorization). In the
full-auto journey this reads redundant. **Safe consolidation:** in the journey flow, don't re-*ask* the
tier — fold the launch authorization into the up-front election (record once), reserve the tier-ask for
standalone `audit-codebase`, keep the target-map gate as THE substantive 2nd stop. This is "don't
duplicate the ask," not "skip a gate" (the consents are still recorded; the assembler still checks
audit-tier + audit-targetmap), so it does NOT re-introduce the past full-auto-skipped-consent regression.
Touches the consent-coupling architecture → design carefully before building.
> **Audit precisions (2026-07-02): (1)** WI-02 already shipped (commit 6270e97) — the redundant tier
> RE-ELECTION is gone; `audit-codebase` Step 2 is the confirm-and-authorize variant (`gate-spec.mjs`
> ~450-485) that reuses the tier. B7's remaining scope is only removing the second `AskUserQuestion` in
> the full-auto journey path. **(2)** target-map approval is a SEPARATE gate (Step 3, `audit-targetmap`),
> distinct from the Step 2 launch/token-spend gate (`audit-tier`) — the parenthetical above conflates
> them. **(3)** the actual open design question: `audit-codebase` distinguishes a journey call from a
> standalone call ONLY by whether an `audit-tier` token already exists (there is no explicit handoff
> flag) — so any consolidation must key off that, and that's the crux to design. Lowest priority; leave
> for last.

---

## Genuinely-owner residual (honest — do NOT try to pull forward)
The toolkit should keep stating these plainly in `PENDING-OWNER-RUN.md`:
- **Checkmarx Partner Security Portal scan** — web portal, login-gated, listing-link prerequisite, billed
  runs; no CLI without a paid `CX_APIKEY`. The toolkit predicts findings.
- **Production-equivalent authenticated submission DAST** — live prod credentials + a reachable
  prod-equivalent host; the toolkit is forbidden to actively scan a non-loopback host. The throwaway
  mirror is corroboration, never the submission scan.
- **Owner-signed policy/attestation pack** (incident-response, retention/deletion, DR/backup, vuln-SLA,
  hosting, prior-pentest) — the signature is owner-by-necessity.
- **Test-environment credentials / personas** — secret-handling boundary.
- **Code fixes, dependency upgrades, infra fixes, secret rotation, FP-justification signing** — human.
- **Dev Hub authentication** (interactive device-login) — though B2-P2 pulls the scratch-org lifecycle
  forward once authed.

## Locked decisions
- OpenAPI = **Route B** (container-isolated); Route A (host-venv import) rejected on the isolation principle.
- North Star = **deterministic-by-default + a labelled `llm-inferred` residual**; not literal 100%.
- Tag **HELD** until a clean cold run on the post-hardening build justifies it.
- The deterministic core is what justifies an eventual tag-able A+.

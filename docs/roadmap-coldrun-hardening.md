# Roadmap — cold-run hardening backlog

> Status: **ACTIVE backlog** (updated 2026-07-04). Captures the toolkit-hardening work surfaced by a full
> end-to-end **cold run** against a real partner-shaped target (a nested-2GP SFDX repo with an external web app/API, an MCP server, Canvas, and Agentforce — `sf`/scanners deliberately
> absent to exercise the cold-install path). Companion to
> [`roadmap-deterministic-findings.md`](roadmap-deterministic-findings.md) (the deterministic-band arc)
> and [`roadmap-preconditions-guided-remediation.md`](roadmap-preconditions-guided-remediation.md).
> This doc is the single pick-up-fresh source of truth for the open items below; each carries enough
> implementation detail to start a focused change without re-deriving the finding.

## Baseline at time of writing
- **`main` @ 0.8.77**, suite **63 files / 986 checks**, tag **HELD** (newest `v0.7.0`; `0.9.0` reserved).
  CIRCULATION TRACK: items 1–6 SHIPPED + E0.1d-EXPAND-2 (E0.1f · `endpoint-https-only` seam · determinism proof ·
  single-shape registry · supply-chain README+`SC-*` posture locks · E0.1d-EXPAND catalog routing 0.8.76 ·
  E0.1d-EXPAND-2 class-less-safe markup/OAuth routing 0.8.77 — both graded PASS off disk).
  NEXT: E0.1d-EXPAND-3 (GROUNDED + prompt STAGED, ROUND-2 AUDITED — the owned-class-dimension catalog clusters: `AvoidSControls` /
  `AvoidAuraWithLockerDisabled` / `AvoidLmcIsExposedTrue` → package-metadata; `ProtectSensitiveData` →
  secrets-credentials; names re-confirmed against the live catalog 2026-07-04, no engine drift.
  SUPERSESSION PROFILE CORRECTED 2026-07-04 pre-dispatch — the routed class-less rows supersede nothing AND
  are never superseded; det-vs-det dedup does not exist in the ingest/merge/reconcile path (the round-2 audit
  scoped the earlier absolute: merge-ledger's cross-DIMENSION lens collapse is the one det-det combine,
  outside the slice's same-dimension scope) — see the EXPAND-3 bullet below),
  then item 7 (substrate/version-drift markers), then the ★ MIDPOINT COLD RUN.
  4 (single-shape registry, 0.8.74 — `SINGLE_SHAPE` set + mechanical `SS-*` forcing check: every owned class
  must be declared single-shape)
  SHIPPED. Item 3 caught + fixed a real `mergeFindings` defect (band pushed by reference → JSON+SARIF
  same-id convergence mutated the caller's band, fabricating a hybrid finding + breaking determinism; fixed
  by storing a copy — ledger bytes unchanged).
  E0.1d (sessionid-egress routing); E0.3b-1 (plain-HTTP egress); E0.3b-2 (`disableProtocolSecurity` downgrade);
  E0.3c-1 (View/Modify-All-Data advisory) + E0.3c-2 (admin-privilege advisory); **E0.1f (0.8.71) — CIRCULATION
  TRACK item 1 SHIPPED**: the taint `reachabilityPath` now renders into the verifier prompt + the finder digest
  (`renderReachabilityPath`), grounding the LLM's source-trust verdict; co-location join = E0.1f-2 follow-on —
  the last **CORRECTED (0.8.68)** to a least-privilege **advisory** (informational, off the blocker floor:
  user perms are stripped from managed-package permsets/profiles + no named req) grounded in the new sourced
  `least-privilege-permission-grants` requirement. Next greenlit: E0.3b-2 (`disableProtocolSecurity`).
  **MILESTONE (0.8.61): deterministic reachability now FLOWS LIVE** — the Tier-0 reachability enabler
  chain (E0.1 ingest → E0.1b/EXPAND injection routing → E0.2a `--dataflow-traces` → E0.2b SARIF-codeFlows
  normalizer + Opengrep) is complete: a version-portable SARIF `codeFlows` normalizer (engine-agnostic:
  opengrep/codeql/semgrep-sarif) + Opengrep (OSS, emits the trace on current tooling where Semgrep CE
  omits it) make `reachabilityPath` populate on a real scan, proven by genuine fixtures + an
  engine-agnostic equivalence test (opengrep-sarif ≡ semgrep-json normal form).
  Each item below is its own change, with a standing test and housekeeping count-sync, landed one at a time.
- **B5 was RE-SCOPED (2026-07-03)** from the original 4-slice list into a tiered enterprise-grade engine
  buildout (cross-cutting reachability/exposure enablers + the named classes + completeness-audit misses).
  Shipped since: ReDoS (0.8.56), E0.1 reachability-path ingest (0.8.57), E0.1b injection-xss routing —
  narrow first pass, CWE-89/78 (0.8.58). **Coverage principle (corrected 2026-07-03): route the FULL
  vuln taxonomy and GENERATE genuine per-class fixtures to test each — do NOT limit routing to the vuln
  classes a captured-from-dogfood fixture happens to contain (that calibrates the tool to one codebase's
  profile, not the general partner). The CWE→dimension map is a scanner-agnostic knowledge artifact.**
  (The Tier-0 sequence and the whole B5 arc are far along — see the **Baseline at time of writing** block
  above for the authoritative current version + shipped list; do NOT read a "next item" out of the prose below.)

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

### ★ B5 · CIRCULATION TRACK — TOP PRIORITY (locked 2026-07-04): "circulate the substrate, don't add engines"
A deep code-grounding review (verified off disk) confirmed the deterministic doctrine is being executed
faithfully — fixture-proven promotion, `classify()=null` supersession safety, sourced-severity honesty, the
labelled residual — and that the real headroom is **CIRCULATION, not more scanners**. Four structural gaps,
each verified in code, drive a sequenced fix that takes **priority over the flagship E0.3a guest mapper**
(the narrowest deterministic core + highest FP surface in the whole backlog — it moves to AFTER the midpoint
cold run). Each item is slice-sized and honors the fixture-proven floor.

**Verified gaps:**
- **Gap 1 — the substrate never reaches the LLM verdict.** `reachabilityPath` lands in the ledger
  (E0.1/E0.2b) but appears NOWHERE in the audit digest (audit-codebase SKILL) or the verifier prompt
  (`workflow-template.mjs`) — the engine computes the taint path and hands the LLM a path-blind one-liner.
  The one-line floor above defines the residual as EXACTLY the source-trust question; we throw away the half
  we already computed.
- **Gap 2 — the platform's own catalog is under-routed.** Only **7 of 38** installed pmd-appexchange rules
  are routed (5 `RULE_CLASS` + 2 `RULE_DIMENSION`); the rest fall to the `external-sast` catch-all.
  E0.1b-EXPAND routed the SAST CWE taxonomy; the CA rule-name taxonomy hasn't had the same sweep.
- **Gap 3 — the B2 throwaway-mirror infra is unmined** (only T1.3 consumes it; a standing mirror makes
  several deterministic dynamic checks nearly free).
- **Gap 4 — residual stability is measurable but unmeasured** (`recurrence-confidence.mjs` exists; no encoded
  ritual turns "deterministic-by-default" into a published time series — the strongest reliance signal, and
  trust is the product's stated GTM lever).

**Sequenced plan (this is the authoritative order — do NOT re-derive a next-item from older prose):**
1. ~~**E0.1f — substrate-grounded prompts**~~ **DONE (0.8.71)** — `renderReachabilityPath` (in
   `finding-clusters.mjs`, byte-parity-locked verbatim copy in the non-importable `workflow-template.mjs`)
   renders a path-carrying finding's `source→sink` into the verifier prompt + the finder digest (SKILL step
   4b), framed "the path is machine-verified — your only open question is whether the SOURCE is
   attacker-controlled." No-path output byte-identical; path-production untouched. **E0.1f-2 (follow-on):**
   the co-location JOIN — surface a co-located DETERMINISTIC finding's path onto a DIFFERENT (LLM-inferred)
   finding's verifier (needs the structured-ledger co-location lookup). Same substrate-render treatment for
   the grant-matrix/egress dimensions is a later fold-in.
2. ~~**`endpoint-https-only` `applies_to` seam**~~ **DONE (0.8.72)** — added `managed-package` to
   `endpoint-https-only.applies_to` (it now = `[external-endpoint,mcp-server,canvas,managed-package]`), so the
   `plain-http-egress`/`protocol-security-disabled` findings cite a requirement that IS in the applicable set
   on a package-only scope. B5-GUARD test: applicable for managed-package + no regression + still `major`
   (blocker floor unchanged). One legit fixture edit: the GAP-Y2 canonical-vocabulary pin moved from
   `endpoint-https-only` (which legitimately entered the raw managed-package set) to `endpoint-ssl-labs-a-grade`
   (external-endpoint-gated only). Verified off disk (applicable battery + mutation).
3. ~~**Full-band determinism proof**~~ **DONE (0.8.73)** — `test-determinism-band.mjs` runs `ingestAll`
   twice over a hermetic corpus target (5 source-scanner dirs + 26 file-parser fixtures, 118 findings) and
   asserts a byte-identical finding band + on-disk ledger, with a non-emptiness guard + a negative control
   (proves the comparator has teeth). **It drew blood on day 1:** caught a real `mergeFindings` defect (the
   insert path pushed the caller's band object BY REFERENCE, so a within-batch same-id finding — the by-design
   JSON+SARIF convergence, 0.8.61 — `Object.assign`'d onto the caller's own first copy, fabricating a hybrid
   finding + making run-1's returned band differ from run-2's; the ledger stayed byte-stable, which hid it).
   Root-fixed by storing a copy on insert — ledger bytes verified unchanged. Both mutations (Math.random
   inject + fix-revert) reproduced RED off disk.
4. ~~**Single-shape registry**~~ **DONE (0.8.74)** — `export const SINGLE_SHAPE` (the 9 owned classes) +
   4 mechanical `SS-*` standing checks that exercise EVERY adapter's `classify()` over the RULE_CLASS +
   RULE_DIMENSION key sets: every non-null result MUST be registered (owning a class forces declaring it
   single-shape), registry ⊆ CLASS_DEFS, registry `deepEqual` the actual owned set, null-classify adapters
   stay class-less. No `classify()`/`CLASS_DEFS` change; the pre-lock crud-fls/sharing risk is documented
   honestly. Verified off disk (own owned-set derivation + 2 mutations). Shape-correctness is no longer a
   silent manual invariant.
5. ~~**Supply-chain README paragraph**~~ **DONE (0.8.75)** — README "## Supply chain": zero runtime npm deps
   (no `package.json`, node-stdlib-only harness, in-tree parsers), sha256-pinned+fail-closed raw-binary
   installs (honestly scoped — pip/npm/git ride the manager's integrity layer). Locked by `SC-*` posture
   guards (no-package-json / harness-stdlib-only / readme-claim, all anti-vacuous) so the claim can't
   silently regress. Every claim verified off disk; SBOM noted as future. Verified (own claim-verification +
   2 mutations).
6. ~~**E0.1d-EXPAND — route the pmd-appexchange catalog's high-confidence clusters**~~ **DONE (0.8.76)** —
   3 clusters routed by exact rule name via `RULE_DIMENSION` (class-less, the E0.1d mechanism): the session-id
   siblings `AvoidApiSessionId`/`AvoidUnauthorizedApiSessionIdInApex`/`AvoidUnauthorizedGetSessionIdInVisualforce`
   → `sessionid-egress`; all 7 hardcoded-credential rules → `secrets-credentials`; `AvoidChangeProtectionUnprotected`
   → `admin-surface`. Fixture `code-analyzer-catalog-seeded.json` = a GENUINE `sf code-analyzer run
   --rule-selector AppExchange` capture (CA 0.48.0 / pmd 0.41.0) — all 11 targeted rules fired (12 violations /
   7 files; VFAttrs double-fires same-locus/same-id). All rows class-less (`classify()=null`, not in `RULE_CLASS`);
   `SINGLE_SHAPE` untouched; non-supersession proven for both clusters via `reconcileProvenance`. The 2
   RemoteSiteSetting CA twins (`AvoidInsecureHttpRemoteSiteSetting`/`AvoidDisableProtocolSecurityRemoteSiteSetting`)
   are DELIBERATELY unrouted — the `plain-http-egress`/`protocol-security-disabled` source-scanners own those
   checks; routing them would double-report the same locus (cross-engine dedup not landed for that pair). Locked
   by `EXP-routing`/`-fixture`/`-skip`/`-non-supersession`/`-single-shape` + `SESS-disjoint` value-lock (the
   `RULE_DIMENSION` value set is now pinned to exactly `{sessionid-egress, secrets-credentials, admin-surface}` —
   a guessed dimension string fails the build). Graded PASS off disk (both mutations reproduced). **E0.1d-EXPAND-2
   (follow-on): GROUNDED (2026-07-04) against the catalog + the methodology dimension docs, and SPLIT by
   supersession-safety profile (the axis that actually matters):
   - ~~**E0.1d-EXPAND-2 — the CLASS-LESS-SAFE clusters**~~ **DONE (0.8.77), graded PASS off disk 2026-07-04**
     (6-lens adversarial workflow, 0 defects; the domain-premise critic ran a LIVE `sf code-analyzer rules
     --rule-selector AppExchange` and confirmed all 4 rule names are genuine catalog rules). Routed:
     `AvoidUnescapedHtmlInAura` + `AvoidCreateElementScriptLinkTag` → `injection-xss` (methodology
     `injection-xss.md` §1.4 names `aura:unescapedHtml` + hand-built DOM verbatim); `UseHttpsCallbackUrlConnectedApp`
     (HTTP OAuth callback) + `LimitConnectedAppScope` (full-scope connected app) → `oauth-identity` — note the
     non-`Avoid`-prefixed catalog names (the honesty floor caught them: predicted names were wrong, the live
     enumeration gave the real ones). Sibling fixture `code-analyzer-catalog-markup-seeded.json` (genuine CA
     0.48.0/pmd 0.41.0, all 4 fired). Both dims class-less (no supersession — verified); `SESS-disjoint` value-lock
     now `{sessionid-egress, secrets-credentials, admin-surface, injection-xss, oauth-identity}` (5). Overlap
     cleared: the egress source-scanner's suffix allowlist is exactly `{.remoteSite/.cspTrustedSite/.namedCredential}-meta.xml`
     — it never reads `.connectedApp-meta.xml`, so the OAuth-callback finding is not double-reported (and
     plain-http-egress's dimension is `package-metadata` ≠ `oauth-identity` anyway). Both mutations reproduced RED.
   - **E0.1d-EXPAND-3 (GROUNDED + prompt STAGED, ROUND-2 AUDITED — next) — the OWNED-CLASS-DIMENSION clusters.** The EXPAND-2
     builder already enumerated the authoritative names in its defer list, re-confirmed against the live catalog
     2026-07-04 (all four exist, CA core 0.48.0 / pmd 0.41.0, no drift): `AvoidSControls` +
     `AvoidAuraWithLockerDisabled` (Aura apiVersion<40) + `AvoidLmcIsExposedTrue` (Lightning Message Channel
     `isExposed=true`) → `package-metadata` (methodology `package-metadata.md` explicitly names Aura `apiVersion` +
     `*.messageChannel-meta.xml`; S-Controls = a prohibited-markup metadata artifact); `ProtectSensitiveData`
     (sensitive data in XML metadata, another non-`Avoid` name) → `secrets-credentials` (package-metadata.md's
     boundary note routes raw secret values in metadata to secrets-credentials).
     **SUPERSESSION PROFILE CORRECTED (2026-07-04 pre-dispatch audit; 5-lens adversarial verify):** this bullet
     previously said "cross-engine-dedup … same-locus gitleaks dedup by design" — that was WRONG.
     `reconcileProvenance` supersedes LLM-INFERRED findings only (`reconcile-provenance.mjs` ~96 skips every
     deterministic candidate; header: "a deterministic finding is never touched") and `mergeFindings` dedups by
     exact id = sha256(engine + ruleId + locus), so two engines never collide — det-vs-det dedup DOES NOT EXIST
     in the ingest/merge/reconcile path (consistent with EXP-skip's own rationale above; the 0.8.76 harness
     comment at ~594-596 overclaims it and the slice corrects that comment). Scope every tracked restatement:
     the ONE det-det combine in the codebase is merge-ledger's Track-1b cross-DIMENSION lens collapse
     (`finding-clusters.mjs collapseCrossDimension`, ≥2 dimensions at one locus required), which never applies
     to the same-dimension co-locations the slice reasons about — claims stay scoped to the routing/supersession
     contract, never "anywhere". The TRUE profile the slice's tests lock: (1) routed class-less rows
     supersede nothing — coexist with a co-located LLM finding of the dimension; (2) the dimension's owned class
     keeps sole LLM-supersession authority, proven undisturbed via a three-party reconcile [owner, routed-CA, LLM]
     — a genuinely NEW positive owner-supersedes-LLM lock for `package-metadata` (owned by `plain-http-egress`,
     whose allowlist is the 3-suffix egress set {.remoteSite/.cspTrustedSite/.namedCredential}-meta.xml, +
     `protocol-security-disabled`, .remoteSite only — all disjoint from the routed loci; `hardcoded-secrets` for
     secrets); (3) the routed deterministic row is NEVER the superseded party — det-det coexist lock. ALSO
     REQUIRED: retarget `EXP2_DEFER_RULES`/`EXP2-defer` (test ~3271/~3323) to the ambiguous pair
     (`AvoidJavaScriptInUrls`, `AvoidLwcBubblesComposedTrue`) — it currently pins `AvoidSControls` +
     `ProtectSensitiveData` OUT of `RULE_DIMENSION` and goes red the moment they route. Widens `SESS-disjoint`
     value-lock to add `package-metadata` (6-set). Engine files (`reconcile-provenance.mjs`, `mergeFindings`)
     MUST stay byte-unchanged — if a test needs an engine change to pass, the test is wrong.
     **ROUND-2 PRE-DISPATCH AUDIT (2026-07-04 — 5 lenses + per-finding adversarial verify + completeness
     critic; 130 prompt claims verified, 0 blockers, 8 amend-level prompt fixes applied):** (a) the det-vs-det
     absolute scoped as above — it was falsifiable repo-wide via the cross-dimension collapse; (b)
     partial-capture conditionals — a DROPPED rule stays in `EXP2_DEFER_RULES` AND stays listed as deferred in
     the harness comment, the CHANGELOG names only the shipped subset, EXP3 tests scope to shipped dimensions
     (the secrets halves fall back to a 0.8.76 credential row if `ProtectSensitiveData` drops), `SESS-disjoint`
     widens to 6 only if a package-metadata rule ships; (c) Aura seed locus corrected to the bundle's
     `.cmp-meta.xml` (package-metadata.md ~57 — the `.cmp` markup carries no apiVersion; the wrong seed would
     have forced a needless honesty-floor drop); (d) comment-residue scope widened — the harness DEFERRED
     comment spans ~638-648 and its ~641-642 "cross-engine-dedup grounding" clause goes too; the EXP2 sibling
     comment blocks (test ~3249-3251, ~3267-3270) carry the same overclaim and sit inside the permitted
     retarget; (e) CHANGELOG placement pinned — the top `[Unreleased]` section is the roadmap owner's docs
     entry, stays byte-untouched; `[0.8.78]` inserts below the unreleased-on-main blockquote; (f) the routed
     rows' source-comment disjointness sentence scoped to the three package-metadata rows (the secrets owner
     scans all files) and the sensitive-data seed pinned to customMetadata/custom-setting so the capture cannot
     contradict it; (g) the package-metadata owner-supersedes-LLM lock is NEW among the ingested-adapter locks
     (GL-/DS-supersedes-LLM); the generic reconcile suite's R1 already locks a crud-fls owner.
   - **E0.1d-EXPAND-4 (GROUNDED — the catalog remainder; stage a LIGHT prompt after EXPAND-3 grades, rigor on
     the CODE hand-back not the prompt).** Grounding done 2026-07-04 against the methodology docs + the catalog:
     - **SCOPE-SHRINKER — the Apex-behavior rules mostly need NO routing.** `DEFAULT_DIMENSION` is
       `apex-exposed-surface` (`ingest-scanner-findings.mjs:508`), so a security-tagged Apex CA rule with no
       `RULE_DIMENSION` row ALREADY lands there. The rules whose correct home IS `apex-exposed-surface` —
       `SECURITY_ENFORCED-pre-v48` (a silent CRUD/FLS-enforcement gap), `getInstance-with-taint` (Apex taint),
       `insecure-content-distribution` (missing CRUD on ContentDistribution) — are therefore **already correctly
       routed by default; a `RULE_DIMENSION` row would be a no-op.** Do NOT add rows for them (verify each is
       Apex-tagged so it defaults, then leave it). This removes ~3 rules from the backlog outright.
     - **NON-DEFAULT, worth routing (EXPAND-4 candidates), leans grounded — builder confirms the rule framing +
       fixture-proves):** `System.setPassword`-operation → `admin-surface` (a privileged credential operation;
       distinct from the already-routed `AvoidHardcodedCredentialsInSetPassword`→secrets, which is the hardcoded
       VALUE); `GlobalInstall/UninstallHandlers` → `admin-surface` (elevated install-time privilege plane).
     - **SEAM — decide off the rule's own message (injection-xss owns XSS construction/DOM sinks; package-metadata
       owns the static markup declaration):** `javascript:`-URL-in-buttons (an XSS-execution primitive in a
       weblink → leans `injection-xss`); JS-actions-in-metadata (active JS embedded in declarative metadata →
       leans `package-metadata` as a prohibited-content declaration). Route only if the message resolves the seam
       cleanly; otherwise defer, don't guess.
     - **SKIP candidates (fail the operator's low-FP bar — no clean, low-noise dimension):**
       `LWC-event-bubbles-composed` (`web-client`'s charter is token/header/CSRF/framing, not component-event
       hygiene — a stretch, low security signal); the inline-CSS/JS static-resource rules (`web-client`-CSP /
       `package-metadata` seam AND inline styles are pervasive → high advisory volume). Leave these unrouted (they
       default to `apex-exposed-surface`/DEFAULT) unless a later pass finds a genuinely low-FP home.
7. **Substrate-unavailable + version-drift markers** — taint rule fired but no trace in evidence → visible
   marker; evidence tool version ≠ pinned → marker. Closes the silent-degradation channel the borrowed-substrate
   honesty rule warns about (today it is operator-prose only, no harness enforcement).
8. **★ MIDPOINT COLD RUN** — validate the ~15 accumulated test-backed-but-HERMETIC slices + real integration
   the hermetic tests can't reach; assess whether it justifies moving the held tag. The single most valuable
   open item; do NOT keep deferring it to "after the whole E0.3 arc."
9. **THEN reassess the flagship** with cold-run evidence: E0.3a guest mapper, the **PSG+muting grant-algebra
   helper as its OWN property-tested slice** (it is the "flagship FP" dependency E0.3a's credibility rests on
   — un-bundle it from E0.3c-3), the **release-widening diff** (pure git-ref XML diff, absent→present =
   widening — zero-FP-by-construction + novel temporal detector + double-serves stay-listed's re-review watch),
   Tier-B mirror probes (unauth-reachability replay / header+cookie grading / CORS — deterministic dynamics
   riding the existing throwaway-dast consent), the MCP `tools/list` lexical screen (advisory), and the
   Tier-C **residual-stability ritual** (N≥3 audit passes per cold run → archived recurrence report → a
   published validation-ledger — the strongest "rely on it" move, but N≥3 LLM passes are not free).

**Do NOT add** (discipline is part of the state of the art): more Tier-2 scanner adapters ahead of
cross-engine dedup; anything network-on-by-default; and keep the standing FP rejections — CWE-91 XML-injection,
wildcard-CSP, missing-rate-limit-as-deterministic are correct calls. Not shipping FP-prone detectors is a
feature.

---

Suggested order: **~~B2 (throwaway tiers + OpenAPI)~~ DONE → ~~B3 (verdict-reflection)~~ DONE
(B3a/B3b/B3b-2/B3b-3/B3c all shipped) → ~~B4 (PENDING labeling)~~ RESOLVED by re-grounding (no code
change — see below) → B5 (residual-shrinking — **far along; see the Baseline block for the current tip, not
this historical order line**) → B6 (prose) →
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
exists here, and here is the path (including the intra-file taint edge the engine computed)" — it cannot
decide "and that path's SOURCE is attacker-controlled and untrusted, the sink is metered, the grant is on
sensitive data, and nothing upstream saves it."** The reachability PATH (bounded, intra-file) is
substrate; the trust-model GROUNDING of the path's source — is it really hostile-reachable — is residual.
North Star unchanged:
deterministic substrate maximized + a labelled semantic residual, NOT literal 100%.

#### Outside-review corrections (2026-07-03) — framing + integrity (fold into each slice)
- **Say "substrate + routing deterministic; class-VERDICT still residual", not "moves the class to
  deterministic".** For every MULTI-SHAPE dimension the supersession rule FORCES `classify()=null`, so B5
  can move the substrate (a sink/path/grant exists) and the dimension routing to deterministic, but it
  structurally CANNOT move class ownership to deterministic there. Deterministic class ownership lives
  only in the single-shape sub-dimensions the adapter fully owns (the RLS-oracle finding; E0.3's
  single-shape sub-classes). Per-slice wins are "narrow + ground the residual" (a real win — the LLM's job
  gets smaller and better-grounded, which is what the recurrence-confidence contract wants), not
  class-level determinism.
- **The supersession backstops catch UNDEFINED-class attachment, not shape-MISjudgment.** `classify()=null`
  + `buildFinding` refusing a class absent from `CLASS_DEFS` together stop attaching an *undefined* class;
  neither stops someone attaching a *defined* class to a dimension they WRONGLY believed single-shape.
  There is no mechanical single-shape check — it rests on taxonomy discipline enforced per-dimension by a
  standing non-supersession test (e.g. `INJ-non-supersession`, `RD-non-supersession`). Do NOT call this
  "defense-in-depth" against the supersession hazard. **Hardening candidate:** an explicit single-shape
  registry that any owning `classify()` is checked against, so shape-correctness stops being a silent
  manual invariant.
- **Borrowed-substrate honesty: distinguish "no signal applies" from "signal expected but the tool stopped
  emitting it".** E0.1's additive "absent trace → no attribute, trace-less findings byte-identical" is
  correct for not breaking findings but collapses those two states — so a Semgrep JSON-schema change (already
  happening), a cold install silently dropping Pro-gated AI rules, or a CA bump landing SFGE v5 without
  graph CRUD/FLS all regress coverage while producing output identical to the healthy case. **Standing rule
  for any adapter depending on an external tool's OPTIONAL output:** assert that output's presence in
  run-scans and emit a visible `substrate-unavailable` marker when missing (which also lets the residual
  honestly say "reachability unknown here" rather than imply none).
- **Measure the RESIDUAL's recurrence stability, not just its size.** B5 peels the tractable substrate-backed
  parts into the deterministic layer; what's left for the LLM is the irreducible core (Rice business-logic,
  multi-step authz, source trust-grounding) — the HARDEST judgments. Solano runs already showed LLM
  finding-set instability (Jaccard 0.44–0.67); concentrating the hardest judgments could push per-finding
  stability DOWN even as the residual count drops. Track residual recurrence stability before/after each
  slice (via the recurrence-confidence contract), not only count.
- **Routing-integer accuracy (the router keys on exact ints):** the `dynamic-urllib` negative-test finding
  is CWE-**939** (Improper Authorization in a Custom-URL-Scheme handler), NOT SSRF — the old test/prose
  mislabel was **CORRECTED (0.8.59)**. Real **SSRF is CWE-918** (→ data-export, not injection-xss); it has no fixture yet
  and is untested. No routing bug (neither 939 nor 918 is in the `{89,78}` allowlist), but correct the
  record (the test comment is code → correct it in the next injection slice; add a real-918 negative if a
  fixture exists). **XXE (611)→deser vs XML-injection (91)→injection-xss** is a deliberate split — record
  the rationale in E0.1c and verify no scanner double-tags one XXE hit with both 611 and an injection CWE
  (would double-route).
- **Fixture generation proves the RULE-PATH, not the CLASS.** A green generated fixture proves the router
  handles the one rule that fired on the seed; scanners populate CWE inconsistently across rules for the
  same class, so a partner hitting that class via a different rule (missing/different CWE metadata) can
  still route wrong. `// fixture-pending` covers "no rule emits"; it does NOT cover "some rules emit CWE,
  some don't." State fixtures as rule-path-proven, not class-proven.

#### Tier 0 — cross-cutting enablers (build FIRST; each unlocks several classes; zero/low new tooling, near-zero FP)
- ~~**E0.1 — reachability-path ingest**~~ **DONE (0.8.57)** — the Semgrep adapter now captures
  `extra.dataflow_trace` (source→intermediate→sink, locations only — matched-content strings dropped) as
  a `reachabilityPath` attribute + `reachable:true`, purely additive (absent/malformed trace → no
  attribute, trace-less findings byte-identical; `classify()` unchanged). `templates/audit-ledger.schema.json`
  gained the optional properties (finding is `additionalProperties:false`). Verified: RP1/RP2/RP3
  + mutation, independently reproduced. **Note for later slices:** newer Semgrep CLIs omit
  `dataflow_trace` from `--json` (text/SARIF only), and run-scans Family 7 doesn't yet pass
  `--dataflow-traces` — wiring that flag / the Opengrep engine is E0.2's job. SARIF `codeFlows` + SFGE
  entry-point→DML vertices remain the other normal-form inputs to fold in as those engines land.
- **E0.1b — ingest-ROUTING (external-SAST findings → the dimension their CWE owns).** The external-SAST
  adapters filed every finding under the catch-all `external-sast`; a per-hit exact-integer-CWE allowlist
  now routes injection-class findings to `injection-xss` via `dimensionHint`, `classify()=null` (route
  the dimension, never own a class — the multi-shape supersession hazard). Shared helpers
  `INJECTION_XSS_CWES` / `cweIdsOf` (anchored `^CWE-(\d+)\b` parse, so `CWE-789` ≠ `78`) / `dimensionForCwes`.
  - ~~**Narrow first pass**~~ **DONE (0.8.58)** — CWE-89 (SQLi) + CWE-78 (command injection) in semgrep +
    bandit, proven by existing fixtures; SSRF (939) / path-traversal (22) / secrets (798) / misconfig
    (693) verified to STAY `external-sast`; non-supersession standing lock + 2 mutations. Verified.
  - ~~**E0.1b-EXPAND — full injection taxonomy + GENERATED fixtures**~~ **DONE (0.8.59).** Active,
    each fixture-proven from genuine captured output: **78 cmd, 89 SQL, 79 XSS, 94 code-injection,
    95 eval, 96 SSTI (semgrep tags static-code-injection), 943 NoSQL** — routed via per-hit
    `dimensionForCwes` across semgrep + bandit + **njsscan** (wired; `metadata.cwe` is the same
    `CWE-###:` string shape, zero helper change). `classify()=null` throughout; 3 genuine fixtures
    (njsscan/semgrep/bandit); the SSRF/CWE-939 record error corrected; CSRF-352 added as a co-resident
    negative. Verified (fixtures confirmed genuine tool-output, routing + 2 mutations reproduced).
    **Injection residual — GROUNDED RESOLUTION (2026-07-03, empirical: semgrep run per class/language).**
    SSTI is actually covered (CWE-96). The residual is XPath (643), LDAP (90), XML-injection (91). Key
    insight: **"a pack already fires" ≠ "the dimension gap is closed"** — Java/C# XPath+LDAP DO fire
    (p/security-audit + p/csharp) but tag 643/90 which route to the catch-all `external-sast` because those
    ids aren't in `CWE_TO_DIMENSION` yet. So the fill is a tiered plan (E0.1e), NOT a single decision:
    - ~~**E0.1e-A (cheap routing wins, capture-only)**~~ **DONE (0.8.63)** — Java/C# XPath+LDAP (semgrep
      p/security-audit + p/csharp) + Node XPath (njsscan `node_xpath_injection`, `xpath.parse()` only)
      captured as genuine fixtures; **643 + 90 promoted** into `CWE_TO_DIMENSION` (`INJECTION_XSS_CWES`
      now {78,79,89,90,94,95,96,643,943}); co-resident md5/CWE-328 stays external-sast (negative). Graded
      off disk. NEXT: E0.1e-B.
    - ~~**E0.1e-B (custom taint rules — the real engine authoring)**~~ **DONE (0.8.64):** no OSS rule for Python XPath+LDAP,
      JS/Go LDAP, Go XPath (CodeQL covers them but is license-barred on proprietary code). Ship a curated
      `rules/injection/*.yaml` dir (mode:taint, framework-request sources → enumerated sinks: lxml/ldap3/
      ldapjs/go-ldap/xmlquery, `escape_filter_chars`/variable-binding sanitizers, `focus-metavariable`),
      run via `--config rules/injection/`, each with a `semgrep --test` vuln/safe pair, then capture live
      fixtures. Reuses the already-active 643/90 rows. CE taint is intra-file → low-FP / moderate-FN
      (cross-function falls to the LLM residual, NOT a noisy rule).
    - **E0.1e-C (honest residual):** XML-injection (91) has NO canonical low-FP sink (only a Twilio-TwiML
      rule off-the-shelf; tangled with XXE/611) → **do NOT add 91; keep it LLM-residual** (blind-XPath
      folds into 643, XXE into 611/E0.1c). A noisy 91 rule would poison the band — worse than the residual.
    **Honest-floor guardrail throughout:** promote a CWE int ONLY after a genuine captured fixture emits
    it; if a custom rule's `--test` safe sample trips (can't reach low-FP), DON'T ship it — leave that
    (class,language) residual. 611 XXE handled in E0.1c.
- ~~**E0.1c — untrusted-deserialization routing + generated fixtures**~~ **DONE (0.8.62)** — and it landed
  the **scalability refactor**: the single injection Set became a unified `CWE_TO_DIMENSION` map (every SAST
  adapter routes through it; `INJECTION_XSS_CWES` is now a DERIVED view so they can't drift; injection
  behavior byte-identical, proven by the whole suite + behavior-identity assertions). Deser active,
  fixture-proven: **502** (pickle/node-serialize), **611** (XXE — moved out of injection), **915** (JS
  prototype pollution — semgrep emits 915, NOT 1321; 1321 left fixture-pending). Honest floor: bandit tags
  XXE as CWE-20 → stays external-sast (live inconsistent-tagging illustration); **Apex `JSON.deserialize`
  → sObject mass-assignment is LLM-residual** (no scanner CWE, never reaches the router — stated, not
  faked). `classify()=null`, no CLASS_DEFS entry, non-supersession locked. Verified (genuine
  fixtures + 10/10 battery + 2 mutations). The unified map is now the routing foundation E0.1e builds on.
- ~~**E0.1d — sessionid-egress / Apex routing + Code-Analyzer fixture**~~ **DONE (0.8.65)** —
  a new **`RULE_DIMENSION`** map (`RULE_CLASS`'s class-less sibling; CA carries no CWE so routing is by
  rule NAME) routes Code Analyzer's built-in `pmd-appexchange` session-id retrieval rules —
  **`AvoidUnauthorizedGetSessionIdInApex`** + **`AvoidUnauthorizedApiSessionIdInVisualforce`** — to the
  `sessionid-egress` dimension, both fixture-proven on a GENUINE `sf code-analyzer run --rule-selector
  AppExchange` capture (CA core 0.48.0 / pmd engine 0.41.0 / plugin 5.13.0) over a minimal seeded Apex +
  Visualforce sample (`acceptance/fixtures/code-analyzer-sessionid-seeded.json`). Harness diff 33-insert /
  0-delete (CWE map + all 5 CWE-routing adapters byte-untouched); `classify()` null, no
  `CLASS_DEFS['sessionid-egress']`, maps disjoint — a routed retrieval-site finding owns no class and
  supersedes nothing (SESS-non-supersession + 2 mutations). Retrieval SITE deterministic; egress VERDICT +
  the external-service token-passthrough side stay residual (no generic log/info-exposure CWE over-routed).
  Verified off disk (fixture genuineness confirmed against the installed CA rule catalog; independent
  empirical battery + both mutations reproduced). **Follow-up (when a seed emits them):** the CA
  AppExchange catalog holds more session-id rules the minimal seed didn't trigger
  (`AvoidUnauthorizedApiSessionIdInApex`, `AvoidUnauthorizedGetSessionIdInVisualforce`, `AvoidApiSessionId`,
  the `GETSESSIONID()` formula sibling) — these names are read off the installed CA catalog (doc-sourced),
  and only the `GETSESSIONID()` formula sibling carries a `// fixture-pending` comment in code today; NONE
  is activated. Promote each once a genuine capture emits it (same fixture-proven floor). *(These exact
  spellings are catalog-sourced, not yet re-verified against a fresh capture — verify before activating.)*
  **Grounding retained (the substrate rationale):**
  - **CA output carries NO CWE for any engine** (violation = `{rule, engine, severity, tags[],
    primaryLocationIndex, locations[], message, resources[]}` — confirmed against both committed CA fixtures
    AND the CA v5 output-schema docs). So `CWE_TO_DIMENSION`/`dimensionForCwes` (the E0.1b/c mechanism)
    **cannot** route CA findings — E0.1d routing is by **rule NAME**: a new `RULE_DIMENSION` map (sibling to
    `RULE_CLASS`), consumed via a `dimensionHint` the CA adapter's `parse` sets; `classify()` stays
    `RULE_CLASS[ruleId] || null` so a session-id rule owns no class.
  - **The substrate is a genuine BUILT-IN rule, not a custom one:** neither PMD `category/apex/security.xml`
    (10 rules; `ApexDangerousMethods`'s name-regex even excludes `session`+`id`) nor the SFGE graph engine
    (7 rules; callouts never a modeled sink) flags `getSessionId`. But Salesforce's first-party
    **`pmd-appexchange`** ruleset ships **`AvoidGetSessionId`** ("Detects use of `UserInfo.getSessionId()`")
    + `$Api.Session_ID`/Visualforce siblings — and run-scans ALREADY selects `-r AppExchange` (load-bearing,
    baseline `scan-pmd-appexchange-rules`), so it fires in production and passes `hasSecurityTag`. No custom
    PMD rule needed.
  - **Bare-retrieval → verdict residual:** `AvoidGetSessionId` fires on EVERY retrieval site incl. approved
    on-platform uses (Salesforce's "Session Id Guidance") — it does NOT model egress. So the routing makes
    the retrieval SITE deterministic + correctly filed under the auto-fail heading; the egress VERDICT stays
    the labelled LLM/human residual (the E0.1 substrate-deterministic/verdict-residual posture). `sessionid-
    egress` is MULTI-SHAPE + auto-fail ⇒ `classify()=null`, no `CLASS_DEFS` entry (supersedes nothing).
  - **Scope = the package/Apex side only.** The external-service side (inbound-token passthrough /
    Authorization-header logging / raw persistence / URL-embedding) has no clean deterministic substrate — a
    generic CWE-532/CWE-200 log-exposure hit would OVER-ROUTE into this auto-fail band (that class is
    secrets-credentials, not the Salesforce-session auto-fail) — so it stays LLM-residual; do NOT route
    generic log/info-exposure CWEs here.
  - Honesty floor holds: promote a `RULE_DIMENSION` row ONLY after a genuine captured CA fixture emits that
    exact rule name (fixture-proven, not doc-proven); if the CA stack genuinely can't run, defer as
    "pending CA stack" — nothing activated, never doc-promote, never hand-author CA JSON.
- **E0.2 — Opengrep swap for the external/JS-LWC taint tier.** *WIRE — adapter drop-in (byte-compatible
  CLI+JSON).* Opengrep (LGPL-2.1, the OSS Semgrep fork) deepens intra-file → interprocedural (intra-file)
  taint for JS/TS/Py/Go/Java — deeper `reachabilityPath` for the same E0.1 classes, reusing the adapter
  verbatim. **Critic note:** Opengrep is ~2025-new — keep **Semgrep CE as the baseline** and Opengrep as
  the deepening swap so an Opengrep instability can't break the taint substrate. Cross-*file* bridging is
  neither engine's job — that stays LLM/human. Same Apex blind spot as Semgrep (SFGE owns Apex).
- **E0.3 — Salesforce Guest/Metadata Exposure Mapper (the single most novel + timely BUILD).** *BUILD
  novel `source-scanner`s (clone the `metadata-viewall` kind — glob XML → parse → class-severity finding,
  zero harness-core change).* No OSS tool builds this; commercial SF tools (Clayton/DigitSec) are
  portal-only SaaS. **FP guardrail:** source-only cannot see OWD/sharing rules → cap severity at
  **"statically-exposed / widened grant," never "confirmed leak."**
  **GROUNDED (2026-07-03, authoritative SF Metadata-API + platform docs). KEY REFRAME:** the guest→PS/PSG
  **assignment edge** is the `PermissionSetAssignment` SObject (org-runtime SOQL, **NOT a Metadata API
  type**), so a source scan reads the guest Profile + every PS/PSG/muting DEFINITION but never which is
  assigned to the guest. So E0.3 splits into **three independent, differently-gated sub-mappers** (each its
  own test-backed slice, one class per slice):
  - **E0.3a — guest exposure [SITE-GATED].** Spine: `CustomSite .site-meta.xml <guestProfile>` → resolve
    named `.profile-meta.xml` = the ONLY confirmed-from-source guest grant surface (tier a:
    `<objectPermissions>` capped Read/Create + `<fieldPermissions>` + `<classAccesses>` + `<userPermissions>`
    incl. APIEnabled amplifier). PS/PSG overlay = tier (b) "potential-IF-assigned", NEVER folded into (a).
    Guest-reachable Apex = classAccesses(enabled) ∩ `@AuraEnabled` lacking `with sharing`/SECURITY_ENFORCED/
    stripInaccessible (the `/s/sfsites/aura` ApexActionController path). Flagship, but narrowest
    deterministic core + most FP-prone (@AuraEnabled reachability is heuristic). Scope-gate: fire ONLY if a
    CustomSite resolves a guestProfile; suppress ALL guest findings otherwise (MCP-only case); never infer
    from a profile merely NAMED "Guest".
  - **E0.3b — egress inventory [UNGATED].** Metadata shapes: `.remoteSite-meta.xml <url>`,
    `.cspTrustedSite-meta.xml <endpointUrl>` (`*` wildcard), `.namedCredential-meta.xml` (legacy `<endpoint>`
    vs modern `<namedCredentialParameters>` `<parameterValue>` under parameterType Url), `.externalCredential-
    meta.xml <authenticationProtocol>`, Apex `setEndpoint('callout:…')` governed vs raw literal. Flags:
    plain-HTTP (baseline `endpoint-https-only`, major→high), `*`/`disableProtocolSecurity` over-broad,
    host-with-no-matching-NamedCredential = raw-callout. Secret VALUES are org-only (never claim "hardcoded
    secret" from a cred file). **Cleanest / lowest-FP — sequenced FIRST.** Sub-sliced:
    - ~~**E0.3b-1 = plain-HTTP in the declarative egress metadata**~~ **DONE (0.8.66)** — a NEW
      `egress-plain-http` source-scanner (adapter #15, `metadata-viewall` clone, zero harness-core change)
      flags `http://` in RemoteSiteSetting `<url>` / CspTrustedSite `<endpointUrl>` / NamedCredential legacy
      `<endpoint>` + modern `<parameterValue>`(sibling `<parameterType>`Url). Owns class **`plain-http-egress`**
      → baseline `endpoint-https-only` (major→high) → dimension `package-metadata`. Scheme-anchored
      (`https://` never flags) + element-scoped (an `http://` in a `<description>` or the `xmlns` URI never
      flags). Verified off disk (fixture schema-faithful; independent battery + both mutations reproduced;
      no secret finding emitted). Known limitation (precedent-consistent with metadata-viewall): a
      commented-out `<url>` would flag — dispositionable, low-risk.
    - ~~**E0.3b-2**~~ **DONE (0.8.69)** — a NEW `remote-site-protocol-security` source-scanner (adapter #17)
      flags RemoteSiteSetting `<disableProtocolSecurity>true` (permits HTTPS↔HTTP downgrade) → class
      `protocol-security-disabled` → EXISTING baseline `endpoint-https-only` (major→high), dimension
      package-metadata. `true`-required (case-insensitive) + element-scoped; `DP-no-overlap` proves
      bidirectional disjointness with `egress-plain-http` (the `true`-guard is load-bearing for it). LOW FP
      (defaults false); internal/localhost case dispositionable. Verified off disk (8/8 battery + both
      mutations reproduced). egress-plain-http byte-untouched.
    - **REJECTED as source-only detectors (research 2026-07-04 — honest residuals, NOT slices):** wildcard `*`
      in CspTrustedSite `<endpointUrl>` — SF-DOCUMENTED/ENDORSED feature (`*.example.com` for CDN/multi-region),
      HIGH FP, only a bare all-hosts `*` is defensible; raw-callout / RemoteSite with no matching Named
      Credential — NOT a violation absent a hardcoded secret (the named violation is Store-Sensitive-Data-
      Insecurely), VERY HIGH FP. Apex `setEndpoint('http://…')` literals — a possible future in-code
      companion to `endpoint-https-only`, but Apex-AST-fragile; defer.
  - **E0.3c — CRUD/FLS grant matrix + release-widening diff [UNGATED].** `.permissionset/.profile-meta.xml`
    `<objectPermissions>`/`<fieldPermissions>`/`<classAccesses>`/`<userPermissions>`{ModifyAllData/ViewAllData/
    AuthorApex/ManageUsers}. **Non-overlap note:** `metadata-viewall` already flags per-object
    `viewAllRecords`/`modifyAllRecords` on CUSTOM objects in **permsets only** (`viewall-overgrant`); it does
    NOT read `<userPermissions>` and does NOT scan profiles — that is E0.3c's gap. Sub-sliced (sequence FIRST,
    each its own class/locus, non-supersession + mutations):
    - ~~**E0.3c-1**~~ **DONE (0.8.67), CORRECTED to advisory (0.8.68).** The `view-modify-all-data`
      source-scanner (adapter #16) flags org-wide **`ViewAllData`/`ModifyAllData`** granted (`enabled=true`)
      in `<userPermissions>` of permsets AND profiles. **GROUNDING CORRECTION (2026-07-04, verified off SF
      2GP docs):** managed-package permsets/profiles do NOT carry user permissions to subscribers (excluded
      at install — "Do they include user permissions? No."), and there is NO named AppExchange requirement
      for permission-grant minimality (reviewer-discretion, justification-gated). So the initial
      `fail-sharing-model`/HIGH grounding over-stated it + was FP-prone for the managed-package case. 0.8.68
      REFRAMES it to an honest **least-privilege ADVISORY** — informational (→ info, OFF the blocker floor),
      grounded in a NEW sourced requirement **`least-privilege-permission-grants`** (cites SF "Evaluate User
      Privilege" best-practice + the 2GP stripping doc), message carries the caveat (verify the effective
      grant on the integration/running user / unmanaged / org-deployed context; not a confirmed subscriber
      grant). Detection logic unchanged; `PV-no-overlap`/`PV-all`/non-supersession preserved. Valid signal
      for non-managed / integration-user / org-deployed (and the general-purpose future).
    - ~~**E0.3c-2**~~ **DONE (0.8.70)** — a NEW `admin-privilege-grant` source-scanner (adapter #18, sibling
      of `view-modify-all-data`, byte-untouched) flags the admin/privilege perms **ManageUsers / AuthorApex /
      CustomizeApplication / ModifyMetadata** (all API-name-confirmed; `ManageSharing` confirmed-real but
      deferred) granted `enabled=true` in permsets/profiles → class `admin-privilege-grant` → the SAME
      `least-privilege-permission-grants` req (informational → info, OFF the blocker floor), admin-surface.
      Same managed-package caveat; `AP-no-overlap` proves disjointness with `view-modify-all-data` both ways.
      Verified off disk (8/8 battery + both mutations reproduced).
    - **E0.3c-3 (follow-ons):** `ManageSharing` + any other confirmed high-risk perm (add to the
      `admin-privilege-grant` Set); per-object `viewAllRecords`/`modifyAllRecords` in PROFILES (the
      `viewall-overgrant` gap on profiles);
      the **PSG+muting effective-permission helper**
      (`effective(PSG)=⋃memberPS_enabled \ ⋃mutingPS` — muting subtracts LAST, scoped WITHIN its own PSG,
      global muting = a bug; naive `profile∪permset` OVER-states — the flagship FP); the **release-widening
      diff** (pure git-ref XML diff; v29+ serializes ONLY enabled perms → **absent→present = widening**; no org).
  **Severity two-band (within the cap):** HIGH = sharing-BYPASSING grants (ModifyAll/ViewAll data + per-object
  VAR/MAR) + APIEnabled amplifier; MEDIUM = standard CRUD (OWD-gated). Owning a single-shape class is OK
  (metadata-viewall precedent); must not bleed into the multi-shape tenant-isolation dimension. Sequence:
  **E0.3b-1 → E0.3c (builds the PSG/muting helper) → E0.3a (reuses it).**

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

#### Recommended sequence (each slice one-at-a-time, test-backed) — REORDERED 2026-07-03 (outside review)
0. ~~**E0.2a — wire `--dataflow-traces` into run-scans Family 7**~~ **DONE (0.8.60).** Flag added to the
   live Family 7 command + a fenced-invocation-scoped standing check (`SG-RP4`) locks it. **KEY LIVE
   FINDING (verified, encoded honestly):** the flag is necessary + version-portable, but whether `--json`
   actually CARRIES the trace is **version-dependent** — Semgrep **1.85.0 emits `extra.dataflow_trace`;
   1.168.0 (current pip) omits it even with the flag** (newer CLIs serialize traces to text/SARIF only).
   So **E0.1's `reachabilityPath` flows live ONLY on Semgrep ≤~1.85, OR via the E0.2b Opengrep/SARIF
   path** — on the current CLI it stays dormant despite the flag. SKILL.md instructs the operator to
   report "reachability substrate unavailable on this Semgrep version" when a taint finding's evidence
   JSON has no trace (the borrowed-substrate honesty marker). **RESOLVED by E0.2b (0.8.61): Opengrep is
   the OSS engine that emits the trace on current tooling; reachability now flows live.**
1. ~~**E0.1 reachability-path ingest**~~ **DONE (0.8.57); now flows LIVE via Opengrep (E0.2b) — on Semgrep
   it needs ≤~1.85 (JSON) and CE never emits SARIF codeFlows (Pro-gated)** · ~~**E0.1b injection routing,
   narrow (CWE-89/78)**~~ **DONE (0.8.58)** ·
   ~~**E0.1b-EXPAND (full injection taxonomy + generated fixtures)**~~ **DONE (0.8.59)** — 7 CWEs active/
   fixture-proven across semgrep+bandit+njsscan; XPath/LDAP/XML-injection are the honest uncovered
   residual (need custom rules — see the E0.1b entry). ~~**E0.1c** (deserialization)~~ DONE (0.8.62) →
   ~~**E0.1d** (sessionid/Apex)~~ DONE (0.8.65, rule-name routing — CA has no CWE) — each fixture-proven,
   `classify()=null` on the multi-shape dimensions. Next Tier-0 BUILD: **E0.3** (guest/metadata exposure
   mapper). (E0.2a above is parallel-safe / independent.)
2. **E0.3 guest-exposure mapper** — PULLED FORWARD (was after T1.1/T1.2; the review flagged the
   Tier-0-"build-first"-but-sequenced-late contradiction). Most novel + most timely (models the live 2026
   guest/`/sfsites/aura` data-theft campaign), cold-install, no running target, clean severity cap. Ahead
   of the less-differentiated class slices. **Must compose Permission Set Groups + muting permission sets,
   not just profile∪permset** (effective guest permission depends on PSGs + muting; a naive union
   over/under-reports — and this is the flagship build whose credibility IS the accuracy of that join).
3. **T1.1 prompt-injection reachability** (custom LLM-SDK / MCP / SF-write-back sink overlay on the E0.1 edge).
4. **T1.2 denial-of-wallet** (AST-presence guards; the missing-rate-limit honesty assertion is the point;
   `query-without-.limit()` + `LLM-call-missing-max_tokens` get the same "shape present, not vector
   confirmed" care as rate-limit — both are FP-context-dependent, e.g. an indexed unique predicate bounds
   a limitless query, some SDKs default/cap max_tokens).
5. **T1.3 IDOR/BOLA** (last in Tier 1 — running target + E0.1 prefilter; verify SFGE v4/v5 first; the RLS
   oracle is deterministic ONLY for the consenting-with-Postgres-RLS-and-faithful-mirror subset — for the
   common partner IDOR stays LLM+human; do not over-count it as "IDOR → deterministic" generally).
6. ~~**E0.2b SARIF-codeFlows normalizer + Opengrep**~~ **DONE (0.8.61)** — version-portable SARIF
   `codeFlows` normalizer (`_sarifTraceStep`/`_sarifReachabilityPath` + `sarifAdapter`, engine from
   `tool.driver.name`) covering opengrep/codeql/semgrep-sarif; Opengrep 1.25.0 wired (binary-pinned,
   source-verified sha256, musllinux/win fail-closed); the interprocedural-taint delta + JSON/SARIF trace
   emission were confirmed EMPIRICALLY (head-to-head vs Semgrep CE 1.168). Engine-label trap (D1) handled:
   opengrep JSON is content-identical to semgrep (no `engine_kind` discriminator exists), so labeling is
   by evidence filename + an explicit-`--scanner` opengrep adapter (label-only, never routing) — an
   opengrep finding never says semgrep. **Semgrep-CE SARIF codeFlows adjudicated PENDING** (genuine
   fixture shows none — Pro-gated; a standing check pins the contrast). Semgrep-JSON path byte-unchanged.
   D4 correction: Opengrep SARIF ALSO needs `--dataflow-traces` (only its JSON is default-on). Then:
   **Tier-2 drop-ins**, cheapest-first (@salesforce/eslint-plugin-lwc → Flow Scanner → syft → GuardDog →
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

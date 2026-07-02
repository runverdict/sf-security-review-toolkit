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
- **`main` @ 0.8.51**, suite **61 files / 814 checks**, tag **HELD** (newest `v0.7.0`; `0.9.0` reserved).
  Each item below is its own change, with a standing test and housekeeping count-sync, landed one at a time.

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

---

## OPEN BACKLOG — prioritized

Suggested order: **~~B2 (throwaway tiers + OpenAPI)~~ DONE → B3 (verdict-reflection — B3a DONE; B3b
GAP-Y is THE NEXT ITEM) → B4 (PENDING labeling) → B5 (residual-shrinking) → B6 (prose) → B7
(gate-consolidation)**. One item at a time, each test-backed. Tag stays HELD until a clean cold run on
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
- **GAP-Y / B3b — render element-type keying** *(THE NEXT ITEM — cosmetic).* The scan-status render
  mislabels the External-SAST/SCA families as "N/A" when the manifest element is typed `external-web-app`
  (the render keys those rows on `external-endpoint`) even though they ran and are credited SATISFIED.
  Fix the render element-type keying so the families that ran read as SATISFIED, not N/A.
- **GAP-Z / B3c — extract-drafted-content + write harness** *(separate, minor).* The Workflow runtime
  can't write files, so the driver hand-scripts the artifact-content extraction + write each pass (plus
  recurring inline-`node` shell-escaping slips it recovers from). A deterministic "extract drafted content
  + write" harness would cut the improvisation.

### B4 — PENDING labeling / wiring fixes  *(stop narrating resolved items as PENDING)*
- The install-time UEC grant + the released `04t` version are verified **headlessly inside install** but
  still narrated PENDING-OWNER-RUN — relabel.
- Local-deterministic `testssl`/`sslyze` already clears the `endpoint-ssl-labs-a-grade` conflicting
  status — ensure the SCI/recap credits it, not "PENDING SSL Labs."
- Always emit the `checkmarx-prediction` file with its one-directional caveat; detect `CX_APIKEY` to
  optionally run the real headless `cx scan` (the only legitimate Checkmarx pull-forward).

### B5 — Residual-shrinking track  *(shrink the labelled LLM residual; see roadmap-deterministic-findings §4)*
Build deterministic engines that move each residual class's reachability/exposure/pattern substrate from
LLM-inferred to deterministic, leaving only the semantic judgment labelled `llm-inferred`:
- **ReDoS** — `regexploit`/`recheck` (regex-AST/NFA ambiguity; near-zero-FP; drop-in).
- **Prompt-injection reachability** — Semgrep taint templated off `p/ai-best-practices` (untrusted
  source → LLM-prompt sink); the LLM judges exploitability.
- **Denial-of-wallet patterns** — metered-sink-in-unbounded-loop + missing-rate-limit-on-public-route
  (Semgrep + CodeQL-style); split the existing `resource-consumption-abuse` dimension into a deterministic
  detector + a labelled judgment.
- **IDOR / BOLA** — a 2-user differential oracle (Schemathesis/Akto) for the API/MCP surface; SFGE/PMD
  already cover the Apex missing-control side.
- **Honest floor (do NOT relitigate):** business-logic + multi-step authz are IRREDUCIBLE (Rice's
  theorem; the platform reviewer pen-tests them by hand). The North Star is **"deterministic substrate
  maximized + a labelled semantic residual,"** NOT "100% deterministic."

### B6 — "human" → conversational prose sweep
~80 `human`/`Human` references across ~30 files read AI-authored → reframe to natural second-person.
Skill + harness prose is a code change; README/CONVENTIONS/docs is a docs-only change.

### B7 — Structural gate-consolidation  *(consent-arch — needs design, lowest priority)*
The journey elects the audit tier up front, then the `audit-codebase` launch gate re-asks/confirms the
tier (it's also the target-map approval point + the fail-closed token-spend authorization). In the
full-auto journey this reads redundant. **Safe consolidation:** in the journey flow, don't re-*ask* the
tier — fold the launch authorization into the up-front election (record once), reserve the tier-ask for
standalone `audit-codebase`, keep the target-map gate as THE substantive 2nd stop. This is "don't
duplicate the ask," not "skip a gate" (the consents are still recorded; the assembler still checks
audit-tier + audit-targetmap), so it does NOT re-introduce the past full-auto-skipped-consent regression.
Touches the consent-coupling architecture → design carefully before building.

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

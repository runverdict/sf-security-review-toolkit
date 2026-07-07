# Changelog

All notable changes to the sf-security-review-toolkit are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/); versions
follow semantic versioning.

## [Unreleased]

### Added
- `docs/roadmap-coldrun-hardening.md` — the `ACTIVE` post-cold-run hardening backlog: B1 run static
  deterministic scanners before the LLM fan-out (the top PENDING-OWNER-RUN drainer) · B2 throwaway-tier
  pull-forward engines (compose/dockerfile standup + org-standup/teardown) + container-isolated OpenAPI
  capture · B3 deterministic-band-disposition → verdict reflection · B4 PENDING labeling · B5
  residual-shrinking · B6 prose · B7 gate-consolidation; with the genuinely-owner residual and the
  locked decisions. Docs-only, no engine change (the single pick-up-fresh source of truth for the
  remaining hardening). INDEX row added.
- `docs/ARCHITECTURE.md` — a property → enforcing-engine → guarding-test → code-excerpt map (with exact
  `file:line` refs) so the "deterministic engines, not model goodwill" claim is verifiable in five minutes
  without a clone; surfaced from the README trust section. Docs-only, no engine change (prompted by an
  external audit noting the source was hard to verify from a browser).
- `docs/INDEX.md` — the canonical docs-lifecycle index (one row per doc: state · purpose ·
  shipped-version; every file in `docs/` must have a row), plus `CONVENTIONS.md` §10 "Docs lifecycle"
  defining the states (`REFERENCE` / `HONEST-ARTIFACT` / `ACTIVE` / `DESIGN` / `DELIVERED`) and the
  rule that a doc whose thesis was later refuted must link the refutation. Docs-only governance, no
  engine change (prompted by a docs-hygiene audit before public release).

### Fixed (docs currency)
- `docs/recurrence-confidence.md` — status banner said skill-wiring was "still pending"; it wired
  end-to-end at 0.8.10 (live in audit-codebase step 9 + compile-submission). Corrected.
- `docs/roadmap-middle-band-judgment-fixture.md` — presented the middle-band judgment as a validated
  differentiator; added a THESIS-SUPERSEDED banner linking `docs/ceiling-test.md` (the 2026-06-23
  refutation) + the recurrence-confidence engine, so no doc contradicts the published falsification.
- `docs/roadmap-0.7.0-throwaway-dast-harness.md` — build-order marked slice 7 (cold-validation → tag)
  "← next" though `v0.7.0` is the published cold-validated tag; marked ✅, leaving slice-5b as the remnant.
- `README.md` — the "what it can't run for you" line listed **Code Analyzer** as owner-run ("you run it
  via the `sf` CLI"). Stale since the 0.8.40 `--all` journey-wiring + the 0.8.41/0.8.42 `code-analyzer-stack`
  cold-install: Code Analyzer is now run *for* you — agent-side when `sf` is present, or cold-installed on
  consent — so it produces the deterministic CRUD/FLS band, not a prediction. Corrected the owner/agent map:
  the genuinely owner-run set is the **Checkmarx portal scan** (web-only, no CLI/API) + the **live-prod
  authenticated DAST** (the toolkit automates a throwaway-mirror ZAP; the production submission scan is the
  owner's). Docs-only, no engine change.

---

> **Unreleased on `main` (untagged).** The last published tag is **`v0.7.0`** (cold-validated
> 2026-06-19). Every version from **`0.7.1`** upward in the sections below is merged to `main`
> but **not tagged** — they are unreleased-on-`main` checkpoints, not published releases, and
> the dates are their commit dates on `main`. Each section is a per-version summary; the full
> change-typed detail for the `0.6.0`–`0.8.x` arc (the `Fixed` / `Changed` / `Added` /
> `Hardened` / `Roadmap` record and the program-note checkpoints those summaries draw on) is
> preserved verbatim under **Detailed record & program notes** at the foot of this arc, just
> above `## [0.5.5]`.

## [0.8.100] — 2026-07-07

**Deterministic DevHub auto-resolve producer engine — reliable `0Ho`→`04t` query
sequence, fail-closed keystone read.** Completes the producer→render pair for
scope-submission step 4: the DevHub Tooling readout is no longer producer-improvised
prose (a real cold run drifted to `version: "undefined.undefined.undefined.undefined"`
and risked a false-positive "already reviewed"). A pure planner locks the
id-resolution order (resolve the `0Ho` package id first, then `--packages <0Ho>`
for the `04t`, then `--package <04t>` — never `--packages <NAME>`, the
`InvalidPackageIdError` regression) and pure normalizers enforce the two keystone
guarantees under a standing test. Robustness/polish, not a correctness gate — the
cold run degraded gracefully and still succeeded; this removes the noise and makes a
regression to a false "reviewed" or an `undefined…` version impossible.

### Added
- `harness/sf-autoresolve.mjs` — the producer engine (pure `planSfAutoResolve` +
  `normalizeVersionString` / `normalizeSecurityReviewed` / `normalizeVersionReport` +
  fail-closed per-step `runSfAutoResolve`), mirrors `standup-org.mjs`; every `sf`
  spawn routes through `sfEnv()`, every `--json` through `parseSfJson()`. Writes
  `sf-autoresolve.json` in the frozen render's exact contract and sets the manifest's
  `sfAutoResolved` flag; **no new consent gate** (read-only Tooling against an
  already-authed hub — never authenticates), degrades to `sfAutoResolved:false` on
  no-devhub. Per-command flags verified against sf 2.137.7 (`package*` →
  `--target-dev-hub`; `data query` → `--target-org` + `--query`).
- `acceptance/test-sf-autoresolve.mjs` (10 checks) — pins the argv order + the
  `InvalidPackageIdError` regression, the never-`undefined` version guarantee, the
  fail-closed `IsSecurityReviewed` read, empty-coverage labeling (never `0% covered`),
  per-step executor degradation via an injected runner, the no-devhub degrade, and a
  render round-trip through the frozen `render-sf-autoresolve.mjs`. Suite **69 files /
  1109 checks**. Byte-frozen `reconcile-provenance.mjs` / `merge-ledger.mjs` /
  `finding-clusters.mjs`, the frozen render, and `sf-env.mjs` untouched.

### Changed
- `skills/scope-submission/SKILL.md` step 4 — rows 1/2 prescribe the reliable
  `0Ho`→`04t` id sequence (never `sf package version report --packages <NAME>`) and
  the fail-closed keystone read (never a version built from `undefined` parts); the
  raw agent-Bash `sf sobject describe` / Tooling query fence is removed (the engine
  runs it now; the describe-first doctrine prose stays as what it encodes); step 4 now
  runs the producer engine, then renders VERBATIM (render block byte-unchanged). The
  `allowed-tools` frontmatter grants `Bash(node *harness/sf-autoresolve.mjs *)`.
- **Live-leg caveat:** the real `sf package list` / `version list` / `version report`
  / Tooling `data query` against an authed DevHub defers to the midpoint cold run
  (exactly like standup-org keeps `sf org create scratch` operator-cold); the
  deterministic planner + normalizers + the 10 hermetic checks are fully offline, the
  live invocation is NOT claimed proven here.

## [0.8.99] — 2026-07-07

**S3 of the CLI-integration arc — org-effective MCP tool-surface capture: the THIRD provenance
lane for `artifact-exposed-tools-list`.** A new `harness/capture-org-mcp.mjs` reads what the
Salesforce org actually sees — which registered MCP servers Agentforce ingested, and which of
their tools/prompts/resources are `active` and wired as callable **agent actions** — via
`sf agent mcp list/get/asset list` (+ opt-in `fetch`); the evidence neither the code registry nor
the raw `tools/list` reveals.

### Added
- `harness/capture-org-mcp.mjs` (mirrors `standup-org.mjs`): pure `planMcpCapture` +
  `serverArgv(alias, id, verb)` + a fail-closed `captureOrgMcp` executor that rides the recorded
  `sf-deep-audit-ops` consent (**no new gate**). NAMES/IDS-only strict allowlist — host-only URLs,
  never a token / `authFields` / session leak; an empty catalog degrades honestly to
  `no-mcp-servers`. Provenance carries **org-effective counts only**: the active-agent-action count
  `A` corroborates, never substitutes, the code-registry `N` (the N-vs-A reconciliation lives in
  `generate-artifacts` step 4, which now names all three counts). `--fetch` opt-in adds a live
  MCP-endpoint callout (off by default). Wired into `generate-artifacts` + `run-scans`. New
  `acceptance/test-capture-org-mcp.mjs` (12 checks). Suite **68 files / 1099 checks**. Byte-frozen
  `reconcile-provenance.mjs` / `merge-ledger.mjs` / `finding-clusters.mjs`, read-only
  `capture-openapi.mjs`, and `gate-spec.mjs` untouched.
- **Live-leg caveat:** the real `sf agent mcp …` calls against an authed org with the partner MCP
  server registered (incl. the `--fetch` egress) defer to the midpoint cold run; the deterministic
  engine + the 12 hermetic checks are fully offline.

## [0.8.98] — 2026-07-07

**S2 of the CLI-integration arc — Agentforce-runtime lens: scripted agent conversation +
execution-trace evidence.** A new `harness/agent-trace-probe.mjs` answers "what can this agent
actually DO / where does it egress" — the Agentforce-egress evidence the
`install-and-verify-package` Apex smoke test explicitly cannot reach (Apex egress ≠ Agentforce
egress).

### Added
- `harness/agent-trace-probe.mjs` (mirrors `standup-org.mjs`): pure `planAgentTraceProbe`
  (deterministic `agent preview start` → one `agent preview send` per utterance →
  `agent trace read --dimension actions|errors|routing` → `agent preview end`) + a fail-closed
  `agentTraceProbe` executor with a `finally` that ALWAYS ends the preview session. Rides the
  recorded `sf-deep-audit-ops` consent (**no new gate**; `sf-ops-gate-hook` doesn't classify
  `agent preview`, so this engine's `verifyConsent` is the only guard). `redactSecrets` strips any
  secret-shaped key/value (JWT / Bearer / access token / long-hex) before any trace payload is
  persisted; NAMES/metadata-only manifest; an empty dimension is recorded as `"no observed
  actions"`, never `clean`/`ADDRESSED`. Wired into `install-and-verify-package` (7b),
  `audit-deployed-package` (4b), and `reviewer-simulation` (2). New
  `acceptance/test-agent-trace-probe.mjs` (8 checks). Suite **67 files / 1087 checks**.
- **Live-leg caveat:** the live scripted conversation against an ACTIVATED agent + the real trace
  capture defer to the midpoint cold run; the engine + 8 hermetic tests are fully offline.

## [0.8.97] — 2026-07-07

**S1 of the CLI-integration arc — headless `sf agent test` utterance-validation replaces the Agent
Testing Center UI punt.** `prepare-test-environment` now validates utterances headlessly through the
`sf agent test` CLI and captures machine-readable pass/fail evidence, backed by a deterministic
result-normalizer.

### Added
- `harness/normalize-agent-test.mjs` (a `render-*.mjs`-shaped pure engine, not a live-op engine):
  planners `planGenerateTestSpec` / `planRunEval` (never emits `--output-dir` — `run-eval` prints to
  stdout) / `planTestCreate` / `planTestRun` / `planTestResults`, plus `parseAgentTestResult` →
  per-utterance records, `passingUtterances`, and a **fail-closed** `foldToEvidenceInput` (an
  absent/empty result ⇒ `pending-owner`, never a fabricated pass). The "submitted list contains ONLY
  successful utterances" rule is now a code invariant — a routing-FAIL utterance is never credited.
  New `acceptance/test-normalize-agent-test.mjs` (10 checks) + `test-build-evidence-index.mjs` B6/B7.
  Suite **66 files / 1079 checks**. **Honest gap (recorded, not fixed):**
  `sf-ops-gate-hook.mjs::classifySfVerb` doesn't classify `agent test create`/`run` — acceptable
  while owner-run + interactive.

### Changed
- `prepare-test-environment` step 9 *Validation* — authors a test-spec YAML from
  `agent-utterances.md`, then validates via `sf agent test run-eval --spec … --result-format json`
  (residue-free, Einstein Eval API, 8+ evaluators) or `sf agent test create` +
  `run … --output-dir` (a durable, reusable `AiEvaluationDefinition` that MUTATES the review org),
  with the live-leg boundary (create/run need a real activated agent) called out as owner-executed +
  cold-run-deferred.
- `baseline/requirements-baseline.yaml` `testenv-agent-testing-center` synced to the CLI reality + a
  `plugin-agent` source row added; `verification` promoted `web_research_unverified` →
  `verified_primary` (tallies 122→123 / 43→42; README + `SOURCES.md` updated; `test-baseline-counts.mjs`
  green).

## [0.8.96] — 2026-07-07

**S0 of the CLI-integration arc — `bootstrap-cli-auth` pins `@salesforce/plugin-agent@1.44.4` so
`agent mcp` installs on a cold box.** The deployed-org deep audit's MCP steps need the `agent mcp`
topic, first shipped in plugin-agent 1.43.0.

### Added
- **False-friend guard:** bumping `@salesforce/cli` does NOT deliver `agent mcp` — even the latest
  CLI bundles plugin-agent 1.42.1, and the hermetic CA stack (`CA_STACK_PINS`) is CRUD/FLS SAST only
  and never runs `agent mcp`. So step 2 of the runbook does an explicit pinned
  `sf plugins install @salesforce/plugin-agent@1.44.4` on the live-org bootstrap path and records a
  `{pinned, installed}` version readout into the deep-audit evidence. Single-sourced as
  `AGENT_PLUGIN_PIN` (`1.44.4`) + `AGENT_PLUGIN_MCP_FLOOR` (`1.43.0`) in
  `harness/install-scanners.mjs` (npm-over-TLS plugin doctrine — no sha256; the opengrep-only
  version-drift marker is not extended to it). New `acceptance/test-agent-plugin-pin.mjs` (3 checks:
  runbook↔constant equality lock, semver floor `>= 1.43.0` and `< 2.0.0`, hermetic CA-stack purity
  guard). Suite **65 files / 1067 checks**.
- **Live-leg caveat:** the actual cold-box install + `sf agent mcp create`/`list` against a real org
  defer to the midpoint cold run.

## [0.8.95] — 2026-07-05

**Cold-run hardening bundle (four independent robustness fixes toward the next tag).**
Four defects surfaced by the midpoint cold run, each shipped with a hermetic standing
test: the `sf` CLI update banner no longer corrupts JSON reads; the two highest-stakes
live-op consents are pinned in the frozen gate catalog; the throwaway stand-up publishes
on a free host port so a busy host port can't block the DAST; and dev-only npm dependency
CVEs are down-ranked below the blocker floor so a test-runner advisory can't gate a
submission. The frozen invariants (loopback enforcement, `--network host`, DAST provenance
HARD fields, `reconcile-provenance` supersession, the severity enum) are untouched.

### Fixed
- **The `sf` CLI auto-update banner no longer corrupts `--json` reads.** The Salesforce
  CLI prints an update-availability banner to stdout ahead of the JSON payload, which
  broke a keystone query mid-run. New `harness/sf-env.mjs`: `sfEnv()` spreads the parent
  environment (so `PATH` still resolves the `sf` binary) and forces both
  `SF_AUTOUPDATE_DISABLE` + `SF_DISABLE_AUTOUPDATE`; `parseSfJson()` tolerates a stray
  leading banner line. Threaded into every `sf` invocation + JSON parse in
  `standup-org` / `teardown-org` / `namespace-check`, and the deployed-package /
  scope-submission skills export the two flags once at the top of their `sf`-using
  sections. Test-backed: `test-sf-env.mjs`.
- **The throwaway stand-up publishes to a free host port** so a busy host port can no
  longer block the throwaway DAST (the cold run's tag blocker). `harness/standup-stack.mjs`
  decouples the HOST published port from the container listen port and the compose
  web-tier selector (both stay the web port): the executor publishes on an ephemeral
  loopback host port (`127.0.0.1:0:<containerPort>`) and reads the assigned port back
  after start (no bind-race), keeping `baseUrl` loopback and the manifest's `scannedPort`
  equal to `new URL(baseUrl).port` — so a real run never false-degrades as "wrong tier."
  The pure planners stay deterministic; the ephemeral-publish discovery lives in the
  impure executor and is validated by the operator cold run. Test-backed:
  `test-standup-stack.mjs` (host-port decoupling), `test-run-dast.mjs` (no false-degrade).

### Added
- **Two live-op consents pinned in the frozen gate catalog.** `harness/gate-spec.mjs`
  registers `throwaway-dast` and `sf-deep-audit-ops` — the highest-stakes
  reach-outside-read-only-local consents — so their operator-facing option text renders
  verbatim run-to-run instead of drifting. Purely additive to the render/pinning path;
  consent recording and verification (which key off the gate-name string) are unchanged.
  Each carries a single affirm option plus the force-injected safe-default decline.
  Test-backed: `test-gate-spec.mjs` (golden snapshots + the consent-gate reps matrix).
- **Dev-only npm dependency CVEs down-ranked below the blocker floor.**
  `harness/ingest-scanner-findings.mjs` caps a CVE on a DIRECT npm `devDependency` (a
  package in the target `package.json` devDependencies and not dependencies — never
  shipped in the managed package) to a ceiling of `low`: cleared off the blocker floor
  and the high gate but still recorded, with an honest caveat on the finding naming the
  original band. Down-rank only (never a raise); prod-dependency hits and the finding id
  are byte-identical, and the resolver reads the package manifest at both ingest I/O
  boundaries (single-scanner and the `--all` journey path). Scope is npm direct
  devDependencies only — transitive dev-only (`package-lock` `dev:true`) and Python
  dev-scope remain a follow-on. Test-backed: `test-ingest-scanner-findings.mjs`.

Suite: **64 files / 1064 checks** (+13).

## [0.8.94] — 2026-07-05

**Exposed-tools drafting rigor (prose-only — NOT-test-backed, CONVENTIONS §7).** The cold-run
exposed-tools refresh drafted the client/ESR operation surface (the filtered subset) instead of the
full code registration/dispatch registry (the AST-verified superset), dropping the registry-only
tiers. Two compounding traps the guidance never named: a numeric collision (the client-exposed
operation count can equal one privilege tier's count, so the subset silently reads as the whole
registry) and a tier-vocabulary split between the drafting side (read/write/admin) and the audit
side (read/propose/admin). The tiered tool inventory belongs to `artifact-exposed-tools-list`, NOT
`artifact-mcp-server-details`.

### Hardened (prose-only — NOT-test-backed)
- `skills/generate-artifacts/SKILL.md` steps 3/4 + `templates/submission-checklist.md.tmpl` Row 7
  guidance, kept mutually consistent and partner-agnostic (no hardcoded counts, no required tier
  names): (1) **full registry ≠ client/ESR surface** — enumerate the row set from the code
  registration/dispatch registry (which may be LARGER than the `tools/list`/ESR surface); the live
  capture is the CROSS-CHECK, never the source of truth, and registry-only tools (admin-gated /
  conditional / approval-tier) are enumerated regardless; (2) **reconcile BOTH counts** — the
  reconciliation sentence names the registry count with its tier composition AND the client/ESR
  operation count, explaining the delta; (3) **tier integrity + no-shrink-on-refresh** — tier by
  the privilege tiers the dispatch table actually defines, never collapse or drop a tier, and a
  refresh must never replace a fuller prior inventory with a thinner subset. Drafting-side tier
  example aligned to the audit side's read/propose/admin (`methodology/dimensions/mcp-surface.md`,
  baseline `mcpthreat-scope-minimization` — untouched). Step-12 cross-read gains the "registry vs
  client/ESR-exposed count" row (the standing consistency guard for this class; no new grep-lint
  by design). The step-3 "conditional/admin-gated tools MUST appear anyway" rule is sharpened in
  place, not duplicated; baseline `verification`/`last_verified` metadata untouched.

Suite: **63 files / 1051 checks** (+0).

## [0.8.93] — 2026-07-05

**Ledger provenance self-declaration (schema honesty/robustness — NOT a behavior fix).**
LLM/audit-Workflow findings were written to `audit-ledger.json` without a `provenance` field,
relying on the schema's absence-default (`llm-inferred`). This is a byte-level no-op for every
consumer — `reconcile-provenance` already treats an unlabeled finding as llm-inferred
(`isLlmInferred = !isDeterministic`), `apply-dispositions` only ever touches
`provenance:'deterministic'` rows, and the headline/SCI counters are provenance-blind — and it is
explicitly NOT a blocker-count correction: the cold-run count was already honest (grounding
disproved the double-count premise; the counters never keyed on this field).

### Hardened
- `harness/merge-ledger.mjs`: the LLM-finding entry literal now self-declares
  `provenance:'llm-inferred'` at its birth site, plus a GUARDED `if (!f.provenance)` normalization
  after the cross-dimension collapse — the explode/collapse rebuilds (lens reconstructions, merged
  parents) carry explicit field lists that drop optional fields, and pre-existing entries predate
  the field; the guard means a `provenance:'deterministic'` row is never relabeled. The ledger now
  states what the schema default implied. Untouched by design: `buildFinding`/the ingest path
  (deterministic stays `'deterministic'`), `dedupId` (provenance is not a key input), the schema's
  optional-with-default posture (back-compat), and `collapseCrossDimension` itself. Test-backed:
  `test-merge-ledger.mjs` M17 (after a merge EVERY finding carries `provenance:'llm-inferred'` —
  a plain entry AND a cross-dimension merged parent; mutation-proven),
  `test-reconcile-provenance.mjs` R7b (an explicitly-labeled llm finding supersedes IDENTICALLY to
  the label-less case, locus counted once, label survives), `test-apply-dispositions.mjs` D2
  extended (an explicit-label `provenance:'llm-inferred'` impostor carrying the disposition's
  engine/ruleId is still `confirmed`, never flipped). The SC not-required schema assertions stay
  green.

Suite: **63 files / 1051 checks** (+2).

## [0.8.92] — 2026-07-05

**Drafted-artifact preamble strip (deterministic quality fix).** Every drafted submission artifact
could open with drafting-agent chatter ("I have everything I need. Drafting the artifact now.")
that leaked into the persisted file — the cold-run driver hand-stripped 4–14 lines per document
down to the real H1.

### Fixed
- `harness/write-drafted-content.mjs`: pure exported `stripPreamble(content)` — drop the leading
  non-content lines so persisted markdown starts at the artifact's first ATX H1 (`# `), keeping an
  immediately-preceding `---…---` front-matter block with it. CONSERVATIVE: no-H1 → VERBATIM
  (never blanked/reshaped), already-H1-first → byte-identical, content that opens with front
  matter → verbatim (an H1-lookalike inside front matter is never a cut point), whole-line slice
  rejoined with `\n` only (CRLF-safe, no within-line edits, trailing newlines untouched). Applied
  ONCE in `planWrites` (byte counts / `--dry-run` / `--json` / the write all see the same bytes),
  gated to `.md`/`.markdown` outputs; content-only by construction — `validateOut`, the
  duplicate-target refusal, the all-or-nothing path, and the gate cross-check are untouched.

### Hardened
- `harness/artifact-workflow-template.mjs`: the draft prompt now instructs each drafting agent to
  begin its result at the artifact's H1 (no preamble/acknowledgements/fences; drop the template's
  leading authoring comment) — the prompt reduces the chatter; the strip is the deterministic
  guarantee. Doc-currency: the byte-exact doctrine (write-harness header + generate-artifacts step
  (d)) now reads "byte-exact from the first H1 onward for markdown; no-H1 and non-markdown are
  verbatim". Test-backed: `test-write-drafted-content.mjs` P1–P6 (strip / H1-first no-op /
  no-H1-never-blanked / front-matter kept / the `.md` gate two-sided / idempotence +
  content-only-refusal), mutation-proven (removing the `planWrites` strip reddens P1); the
  existing G/R/A/GC/D/E/W fixtures stay green (every prior fixture is H1-less).

Suite: **63 files / 1049 checks** (+6).

## [0.8.91] — 2026-07-05

**Python run recipe — constructor-grounded ASGI/WSGI (Tier-2, best-effort honest-degrade).** The
python copy-in ran a bare `python <entry>` for anything not manage.py/asgi.py/wsgi.py, and hardcoded
`uvicorn asgi:application` (FastAPI's callable is `app`, not `application`). The canonical FastAPI
shape (`app = FastAPI()` at module scope, no `__main__`, `CMD uvicorn app.main:app`) runs bare
`python main.py` → imports, binds `app`, exits 0 → the container dies → `failed`.

### Fixed
- `harness/stack-detect.mjs`: pure exported `resolvePythonRun(entry, entryText, depsText)` grounds the
  ASGI/WSGI split in the CONSTRUCTOR (never a bare `app =` match — routing a Flask callable to uvicorn
  crashes at boot): ASGI ctor (FastAPI/Starlette/Litestar/Quart, Django get_asgi) → uvicorn; WSGI ctor
  (Flask, Django get_wsgi) → gunicorn/flask CLI; factory → uvicorn `--factory`/gunicorn by deps, or
  UNSUPPORTED when deps can't disambiguate (refuse to guess — the honesty trap); self-launcher →
  best-effort `python <entry>`; else unsupported → the honest `needs-recipe`. `gatherRecipe`'s python
  branch is content-guided (pick the FIRST entry whose resolver is non-unsupported, so a stub `app.py`
  no longer shadows a real `main.py`); only the derived `{server,module,var}` rides the stack JSON —
  the entry SOURCE TEXT never enters it (NAMES-only).

### Hardened
- `standup-stack.mjs`: `pythonRunCommand` consumes `recipe.run` (the exact uvicorn/gunicorn/flask/
  self command), keeping the legacy entry-name branches as the run-less fallback (U9/U11 green). An
  ASGI framework with no ASGI server in deps is BEST-EFFORT (a harness `pip install uvicorn` + an
  honest marker — the partner's own container would not boot this way). The `unknown` health note
  now carries a universal container-localhost bind hint (`HOST=0.0.0.0` / `-b 0.0.0.0` /
  `ASPNETCORE_URLS` / `server.address`). `classifyStack` carries `migration` on every status
  (needs-recipe/n-a included). Test-backed: `test-stack-detect.mjs` E1 (resolver matrix two-sided,
  refuse-to-guess) / E2 (CLI compose-less FastAPI → recipe.run uvicorn), `test-standup-stack.mjs` U11
  extended over the run shapes + run-less fallback. Mutation-proven; S9/S10/S11 stay green.

Suite: **63 files / 1043 checks** (+2).

## [0.8.90] — 2026-07-05

**Base-url pointer resolution + run-id integrity + target-identity guards (Tier-2).** run-dast +
capture-openapi took `--base-url` from argv only — a hand-copied wrong port silently scanned a
dead/wrong target — and nothing verified the target's identity before scanning.

### Added
- `harness/run-dast.mjs`: pure `resolveBaseUrl(explicit, pointer)` + impure `readStandupPointer` —
  explicit `--base-url` always wins; otherwise the stand-up pointer must be `sf-srt-stack/1`, not
  torn-down (teardown nulls the baseUrl + sets status `torn-down`), and `up`/`unhealthy` (the
  SCANNABLE gate). Every resolved URL is re-asserted loopback — an **additive 5th loopback layer
  that REUSES the shared `LOOPBACK` set**; the 4 frozen layers are byte-untouched. `--from-standup`
  wires it into run-dast + capture-openapi (capture imports the ONE resolver — no fork), threading
  the pointer's health/tier/migration flags, with a staleness guard (a swept manifest → refuse).
- `harness/standup-stack.mjs`: pure `checkEnvFileRunId` (Option 1 — a toolkit-convention env-file
  path whose embedded run-id != runId is refused, orphan prevention; a custom path is allowed; NOT
  tmpRoot-derivation, which would break `teardown --run-id`), fired inside `planStandup`; pure
  `classifyPortOwnership` + an impure pre-publish probe that refuses when a pre-existing service
  already answers on the loopback port (findings would be misattributed to the partner).

### Hardened
- Journey notes `--from-standup` as the hand-copy-removal path. Test-backed: `test-run-dast.mjs` D5
  (resolver matrix two-sided, SCANNABLE-gate mutation-proven), `test-standup-stack.mjs` U20
  (checkEnvFileRunId two-sided + fired in planStandup) / U21 (classifyPortOwnership), `test-capture-
  openapi.mjs` O12 (shared-resolver import identity + torn-down refuse). Teardown name-scope/sweep
  stay green.

Suite: **63 files / 1041 checks** (+4).

## [0.8.89] — 2026-07-05

**Migration DETECTION for the label (Tier-2, severable).** A partner whose DB-backed routes 500
because migrations never ran should have that named in the honesty label — but the toolkit had no
migration-mechanism signal.

### Added
- `harness/stack-detect.mjs`: pure exported `detectMigration(signals)` → `{tool,command}` (alembic
  via `alembic.ini`/`alembic/`/`migrations/env.py`; prisma; django via `manage.py`; knex; or a compose
  service named `migrate`/`migration`/`db-migrate`/`init`/`flyway`/`liquibase`) or null. DETECTION
  ONLY — the impure gatherer reads PRESENCE (no file contents, no secrets); the command is a
  descriptive hint the label surfaces ("DETECTED but NOT run"), never executed. Auto-run stays
  DEFERRED (a separate `throwaway-migrate` consent class).

### Hardened
- `classifyStack` carries `migration` onto the runnable + needs-secrets result; `planStandup` threads
  it onto every plan kind; the stand-up manifest + pointer record it (Slice B1 slots), so `run-dast
  --migration <tool>` surfaces it in the DAST disclaimer + provenance (Slice G). Test-backed:
  `test-stack-detect.mjs` B2 (pure matrix two-sided — each mechanism → its `{tool,command}`, none →
  null; plus a CLI thread proving an `alembic.ini` reaches the classified stack).

Suite: **63 files / 1037 checks** (+1).

## [0.8.88] — 2026-07-05

**capture-openapi spec-path generalization + capture-only provenance (Tier-1 honesty gate closes).**
`CANDIDATE_SPEC_PATHS` was 8 fixed JSON paths (FastAPI-shaped); proxied-FastAPI and NestJS partners
came back `not-exposed` even when they served a spec. Separately, an `openapi-<date>.json` sitting
beside a `zap-throwaway-local-*.json` implied the DAST exercised those endpoints — a live adjacency
over-claim (the baseline is an unauthenticated spider from `/` that does NOT consume the spec).

### Fixed
- `harness/capture-openapi.mjs`: `CANDIDATE_SPEC_PATHS` extended (12 paths) — `/openapi.json` stays
  index 0; adds proxied-FastAPI `/api/v1/openapi.json` and NestJS `/api-json` / `/docs-json` /
  `/api/docs-json`. New pure `normalizeRootPath` + a `--root-path` flag front-load `${rp}/openapi.json`
  for a proxied `root_path='/api/v1'`, deduped, WITHOUT mutating the exported constant — and FAIL
  CLOSED: a scheme/URL root-path (`http://evil` → `/http://evil`) fails `SPEC_PATH_OK` and throws, so
  the GET can never be re-aimed off the loopback host.

### Hardened
- Capture-only provenance: `buildProvenance` gains a `scanCoverage` field (CAPTURE-ONLY — the spec was
  READ for the api-endpoints artifact, the throwaway DAST does NOT consume it, so these endpoints were
  not necessarily exercised) + a `singleSpec` caveat, and the captured CLI label prints the same — this
  closes the adjacency over-claim NOW, alongside Slice G's `specFedScan:false`, without building the
  deferred spec-fed DAST. The 4 loopback layers stay byte-frozen. Test-backed: `test-capture-openapi.mjs`
  O9 extended (new paths at index, length 12, constant untouched), O6 extended two-sided for
  `scanCoverage`, new O11 (root-path prepend+dedupe, no-rootPath byte-identical, fail-closed
  mutation-proven).

Suite: **63 files / 1036 checks** (+1).

## [0.8.87] — 2026-07-05

**run-dast honesty consumption + machine-readable provenance (the keystone).** `run-dast` had no
health/tier input and self-labelled only in a prose `README-throwaway-dast.md`, so Slice A's
right-tier pick and Slice B1's health classification produced an honest MANIFEST but a still-clean-
looking SCAN OUTPUT — a near-zero ZAP alert count on an unhealthy / redirect-only / wrong-tier boot
printed as a clean result, and `compile-submission`/`reviewer-simulation` (which ingest JSON, not a
README) over-credited it.

### Fixed
- `harness/run-dast.mjs`: `run-dast` now CONSUMES the stand-up status. New optional args
  `--health` / `--migration` / `--guarded` / `--service` / `--scored-port` (the journey threads them
  from the manifest) feed a pure `dastDegrade(plan)` that sets `degraded` + a reason when the
  stand-up was not verified `up` (the unverified default degrades too — never claim clean without a
  verified up) OR the scanned port is not the detected web-tier port. The stdout summary prefixes a
  loud `DEGRADED` line before the alert counts.

### Hardened
- Machine-readable provenance: pure `buildDastProvenance` writes `dast-provenance.json` beside the
  ZAP report with hard `authenticated:false` + `specFedScan:false` + `healthState` + `scannedTier` +
  `PENDING` prod-equivalence — the field the downstream consumers read structurally. Pure
  `dastDisclaimer` composes the README with the base boundary (loopback, unauthenticated, shallow
  spider, did NOT import the captured OpenAPI spec) plus a per-condition caveat set; both encode the
  same flags so the label can never drift. New `--absent` mode + pure `absentCorroborationStub`
  stamp a `not-run` / `NOT-ATTEMPTED` provenance for every terminal not-scanned state (the journey
  emits it on `failed`/`unknown`/`needs-recipe`/`n/a`/declined) so an unscanned partner is an
  explicit evidence-of-absence, never a silent gap.
- Journey chain-gating updated to thread the flags and emit the absent stub. Test-backed:
  `acceptance/test-run-dast.mjs` G1–G4 (disclaimer two-sided; provenance field-set mutation-proven
  on `authenticated`/`specFedScan`; degrade logic two-sided incl. wrong-tier + unverified-default;
  absent stub).

Suite: **63 files / 1035 checks** (+4).

## [0.8.86] — 2026-07-05

**Stand-up health honesty — a 3-state liveness classification that degrades, never over-claims.**
`listening()` used `curl -sS` with no status capture, so ANY HTTP status (including a schema-less
500) read "up" and the chain scanned a broken surface with no caveat. On the grounded Verdict
shape the api 200s on `/` and `/openapi.json` while every DB-backed route 500s (migrations may
not have run) — today that read "up".

### Fixed
- `harness/standup-stack.mjs`: three pure, exported, hermetically-tested seams replace the boolean
  probe — `classifyHealthCode(code,{isRoot})` (2xx / 401 / 403 / 405 → up, 5xx → unhealthy, and the
  load-bearing `isRoot && 3xx/4xx → up` so a no-root JSON API is not mis-read as failed),
  `resolveHealth(observations)` (terminal `up` / `unhealthy` / `failed` / `redirect-only` /
  `unknown`), and `mapDockerHealth(s)` (honors the partner's declared HEALTHCHECK). The poll loops
  walk an ordered liveness set `[/readyz, /health/ready, /healthz, /health, /]`.

### Hardened
- DEGRADE-not-abort: only `FATAL_STATUS` aborts (exitCode 1); `unhealthy` / `redirect-only` stand up
  with a loud degraded label so the corroborating scan still runs. New shared `HEALTH_STATES` enum is
  written into `stack-standup.json.status`; orthogonal honesty flags (`guarded`, `readiness`,
  `scannedService`, `scannedPort`, `migration`) are carried in the manifest + pointer for a downstream
  consumer to read structurally. `standupHealthNote` never claims clean/healthy/prod-equivalent on a
  non-`up` status; every `up` carries the universal liveness-only caveat. `stack-detect.mjs`'s runnable
  note + the journey chain-gating (`up` → scan; `unhealthy`/`redirect-only` → scan degraded;
  `failed`/`unknown` → skip to teardown, ZAP plan to `PENDING-OWNER-RUN.md`) updated in lockstep.
- Test-backed: `acceptance/test-standup-stack.mjs` H1–H4 (code map incl. the isRoot correction;
  resolveHealth terminal map incl. transient-5xx-then-2xx → up; label strings two-sided; docker-health
  mapping). Mutation-proven (the isRoot branch, the transient-up precedence).

Suite: **63 files / 1031 checks** (+4).

## [0.8.85] — 2026-07-05

**Compose web-tier selection — the throwaway DAST scans the API, not the frontend.** Cold-run
finding on the grounded Verdict compose: `gatherRecipe` picked the web tier by the FIRST bare
`digit:digit` in the whole file. postgres/redis/api all publish `${VAR:-N}:N` (the `}` breaks
the digit run, so the naive regex skips them) and only the Next.js `web` service publishes a
bare `"3000:3000"` — so the DAST physically scanned the frontend on 3000, not the FastAPI API
on 8000, and reported it clean. The wrong port also drove `planCompose`'s host-publish, so the
mis-pick rebound the wrong service to loopback.

### Fixed
- `harness/stack-detect.mjs`: new pure exported `composeWebTier(text)` replaces the first-match
  port regex. It indent-walks the `services:` block, parses ports in every form (short `H:C`,
  interpolated `${VAR:-N}:M`, long-form `target`/`published`, bind-IP `IP:H:C`), scores each
  host-publishing service (API-name +3, run-command fingerprint +3, frontend/proxy −2, +1 per
  incoming `depends_on` in BOTH list- and map-form), and hard-excludes datastores by service
  NAME and by `image:` — with an api-named rescue (`database-api`/`db-gateway`).

### Hardened
- Honesty label degrades loudly rather than guessing: a top-score tie infers the file-order
  winner but flags `ambiguous` + `candidates[]` and tells the operator to pass `--port`; a
  frontend/proxy-only or expose-only-API shape emits a note naming the unreachable API tier
  (`exposedApiTier[]`); zero non-infra host-publishers returns `port:null` (refuse — never scan
  a datastore). `classifyStack`'s reason threads the note; `gatherRecipe` returns the full
  object even when `.port===null`. The port-only contract (`planStandup` reads `.port`) is
  preserved — the new fields feed only reason strings and the honesty label.
- Test-backed: `acceptance/test-stack-detect.mjs` A1–A11 (Verdict-shape CLI → api:8000; db-first
  not mis-picked; all port forms; tie→ambiguous; expose-only trap two-sided; zero-candidate
  refuse; image-based infra exclude two-sided; api-name rescue; map-form depends_on; run-command
  fingerprint). Mutation-proven (image-exclude, api-rescue, map-form, fingerprint each redden
  a two-sided assert when reverted).

Suite: **63 files / 1027 checks** (+11).

## [0.8.84] — 2026-07-05

**Compose IaC routes to `trivy config`, never checkov (Family 8 prose + guard).** Cold-run
finding: on a docker-compose target the driver improvised `checkov --framework docker_compose`
— not a valid checkov framework — got an empty/errored scan, and only then fell back to
`trivy config`. Family 8 listed checkov frameworks (terraform/dockerfile) with NO compose
guidance.

### Fixed
- `skills/run-scans/SKILL.md` Family 8: explicit invocation
  `trivy config -f json <compose-dir> > evidence/iac-compose-<date>.json` + the routing rule —
  compose IaC is scanned with `trivy config`, NOT checkov (checkov has no `docker_compose`
  framework; never pass that flag value). Ingest unchanged: both the checkov and trivy
  adapters already file `iac-misconfig` at class severity.

### Hardened
- Test-backed via a new prose guard in `acceptance/test-ci-hygiene.mjs` (F8-compose-iac):
  the skill must NOT contain the literal `--framework docker_compose` and MUST carry the
  trivy-config-for-compose invocation + routing line. Mutation-verified: appending the bogus
  flag to the skill reddens the guard (executed, then removed).

Suite: **63 files / 1016 checks** (+1).

## [0.8.83] — 2026-07-05

**Bandit test-path LOW hygiene filter — the deterministic band stops drowning in test-tree
lint.** Cold-run finding: the deterministic band was 4768 findings, ~93.6% bandit — B101
`assert_used` / B404 `import subprocess` across the Python tree INCLUDING tests. The separating
axis is **PATH × band**, deliberately NOT a severity floor (a blanket "drop bandit LOW" kills
B105/B106/B107 hardcoded-password hits in PROD — a real-secret honesty violation) and NOT
confidence (`-iii` is the wrong axis — B101 is high-confidence).

### Added
- `harness/ingest-scanner-findings.mjs`: segment-anchored `isTestPath(file)` (a whole
  `/`-segment ∈ {`test`, `tests`, `__tests__`} or basename `test_*.py` / `*_test.py` /
  `conftest.py` — so `latest/`, `contest/`, `mytest.py` do NOT match) + a NEW, DISTINCT
  optional adapter hook `hygieneNoise(hit)` on `banditAdapter` only
  (`bandFromTool === 'low' && isTestPath(hit.file)`). Deliberately NOT `securityRelevant` —
  the BN-adapter-contract pins that as `undefined` (bandit stays security-by-construction);
  deliberately NOT generalized to semgrep/njsscan.
- Ingest core: `hygieneFiltered` counter beside `tracelessTaint`, guarded exactly like the
  other optional hooks (`typeof adapter.hygieneNoise === 'function'`), with ONE aggregated
  honesty note per ingest (mirrors the substrate-unavailable block): `bandit: N test-path LOW
  hygiene hit(s) (assert/import, e.g. B101/B404 under tests) filtered as non-security noise —
  not findings`. Every other adapter is inert; `buildFinding`/`CLASS_DEFS` untouched.
- `skills/run-scans/SKILL.md` Family 7: one-line note that bandit test-path LOW hygiene is
  filtered at ingest (prod-path LOW + every MEDIUM/HIGH ingest unchanged).
- Fixture `acceptance/fixtures/bandit-test-hygiene-seeded.json` — genuine-SHAPED bandit 1.9.x
  output, SEEDED not captured: B101 LOW `tests/test_server.py` + B404 LOW `tests/conftest.py`
  (filtered) · B608 MEDIUM `mcp/server.py` · B105 LOW `mcp/app.py` (prod hardcoded password) ·
  B602 HIGH `tests/test_x.py` (all kept).

Suite: **63 files / 1015 checks** (+2: BN-hygiene — kept ruleIds exactly {B105, B602, B608},
one aggregated note with count 2, `securityRelevant` still `undefined`; BN-hygiene-anchoring —
the two-sided FP guard: `latest/`/`contest/`/`mytest.py` all KEPT, every documented test-path
shape filtered). Existing 4-finding bandit coldstart assertions byte-identical (the real
fixture is all-MEDIUM under `mcp/`). Mutation-verified: removing the core-loop guard reddens
both new checks (executed, then restored).

## [0.8.82] — 2026-07-05

**Target-map dimension-key validation — a bogus key can no longer masquerade as coverage.**
Cold-run finding: a hand-written `target-map.json` carrying keys outside the canonical set
(`tenant-isolation-web`, `oauth-identity-legacy`) sailed through — the N/A path had ZERO
validation (N/A keys never touch the §4/§5 extraction), and the audit-codebase skill grants the
driver a Write on `target-map.json`, so the display could be driven without the engine. Both
halves shipped:

### Added
- `harness/dimension-registry.mjs` — the ONE canonical source of valid dimension keys: the
  `methodology/dimensions/*.md` basenames (`knownDimensionKeys(pluginRoot)`). NO hardcoded
  list — a new dimension file is self-registering.
- Engine gate (`harness/build-audit-engine.mjs`): every scope-input key — applicable AND N/A —
  is validated against the registry AFTER the always-on injection and BEFORE assembly; any
  unknown key aborts `exit(2)` naming the offender(s) + printing the sorted canonical set.
  Closes the N/A hole (an unknown N/A key previously shipped as a "covered" row, silently
  shrinking coverage).
- Render belt (`harness/render-target-map.mjs`): `renderTargetMap(data, knownKeys = null)` —
  with a registry Set, keys outside the canonical set append
  `⚠ N unknown dimension key(s): … — not in the canonical set` to the closing summary. Belt,
  not gate: the table STILL renders, nothing throws (TM3 fail-safe intact); default `null`
  keeps every existing direct caller byte-identical. `main()` derives the plugin root from
  `import.meta.url` and passes the registry; a failed registry read degrades to null.

Suite: **63 files / 1013 checks** (+2: E4b — bogus `na` key aborts while the same shape with a
known key builds silently, the two-sided N/A-hole pin; TM5 — bogus key + registry renders the
⚠ line AND the full table, clean map silent, default-null byte-identity). E4 tightened from
`/not found|Command failed/` to the registry gate's `/unknown dimension key/` + offender +
canonical-set assertions.

## [0.8.81] — 2026-07-05

**stack-detect compose-satisfiability — the throwaway-DAST gate now fires on a self-contained
compose.** Cold-run finding: a compose with in-compose postgres/redis and `${VAR:-default}`
credentials was classified `needs-secrets` (its external-NAMED env vars were assumed
owner-supplied), so the consent gate for the shipped stand-up → OpenAPI-capture → ZAP/Schemathesis
chain never fired. Two-part fix in `harness/stack-detect.mjs` (pure core + regex-only gathering —
still no YAML/JSON parser dep):

### Added
- Three exported pure compose helpers: `composeServiceNames(text)` (top-level `services:` keys,
  first-child-indent captured, BREAKS at the first zero-indent line so a sibling top-level
  `volumes:` block is never read as a service), `composeDefaultedVars(text)`
  (`${VAR:-def}` / `${VAR:=def}` — the `:[-=]` deliberately excludes `${VAR:?required}` /
  `${VAR:+alt}`, which have no fallback and stay owner-supplied), and
  `composeConcreteAssigned(text)` (`KEY: value` / `- KEY=value` whose value, after stripping
  defaulted interpolations, carries no bare `${` — subsumes "URL points at an in-compose
  service" and literals; a valueless `KEY:` pass-through is NOT concrete).
- `gatherFacts` computes `facts.satisfiable = composeDefaultedVars ∪ composeConcreteAssigned`
  from the compose text only (empty when no compose file → non-compose stacks byte-unchanged)
  plus `facts.composeServices` for the runnable reason line.

### Fixed
- `classifyStack`: an `external`-named env var the compose itself satisfies is reclassified —
  secret-named → `synthesizable`, else `benign` — so a self-contained compose reaches
  `runnable` and the DAST consent gate fires. Unsatisfied names (bare `${DATABASE_URL}`
  pointing at a managed DB) stay `external` → `needs-secrets`, unchanged.
- Compose-scoped env gathering: when the recipe IS the compose and it declares no `env_file:`,
  env names are gathered from the compose file alone — a `scripts/*.py ADMIN_DATABASE_URL` the
  compose never runs no longer blocks stand-up (the cold-run residual that survived
  reclassification alone). Any `env_file:` directive falls back to the full union gathering
  (safe over-flag direction).

### Changed
- Honesty: the `runnable` reason now states stand-up is **HTTP-liveness-verified only** (a port
  answers), not app-health-verified — migrations/deep readiness are not asserted — and names the
  in-compose services.

Suite: **63 files / 1011 checks** (+5 in `test-stack-detect.mjs`: S7 pure two-sided
reclassification [satisfied → runnable / unsatisfied → needs-secrets], S8 pure helper matrix
[volumes-break, `:-`/`:=` vs `:?`/`:+`/bare, concrete vs pass-through], S9 the self-contained
compose cold-run regression pin, S10 the bare-`${DATABASE_URL}` discriminator, S11 the cold-run
shape both-sided via the `env_file:` fallback toggle). Mutation-proven: removing the
reclassification reddens S7/S9/S11 (verified executed, then restored).

## [0.8.80] — 2026-07-05

**The ingest now emits deterministic honesty notes for two silent-degradation channels that were
operator-prose only** (`skills/run-scans/SKILL.md` told the operator to "report … in the evidence
summary"; nothing in the harness said it). Both are `notes` on the `ingest()` return — never
findings, never ledger rows: findings stay byte-identical, `templates/audit-ledger.schema.json`
and `buildFinding` are untouched, and both markers are honestly narrow by design.
- **Substrate-unavailable** — a toolkit taint rule fired but its evidence carries NO dataflow
  trace: `"<adapter>: N toolkit taint rule(s) fired with no dataflow trace (<adapter>
  v<recorded|unknown>) — reachability substrate unavailable on this engine version / output
  surface; findings ingest normally, reachabilityPath absent (use Opengrep or SARIF codeFlows)"`,
  ONE aggregated note per ingest. Scope: the toolkit's OWN `rules/injection/*.yaml` pack only
  (its path-derived `rules.injection.` check_id prefix is the one deterministic "this rule is
  taint-mode" signal in Semgrep/Opengrep output — registry/third-party taintness is unknowable
  and never guessed). Carried by a new OPTIONAL adapter hook `expectsTrace(hit)` on the
  `semgrep`, `opengrep` (explicitly — parse-delegation does not inherit hooks, and `ingestAll`
  routes `opengrep-*.json` through that adapter object), and `sarif` adapters; the `ingest()`
  core guards `typeof adapter.expectsTrace === 'function'` exactly like `securityRelevant`, so
  every other adapter is inert.
- **Version-drift** — an opengrep evidence file records a producing version ≠ the sha256-pinned
  install: `"opengrep: evidence records version <X> but the toolkit pins <PIN> —
  stale/unexpected scanner version; re-run with the pinned install"`. Scope: opengrep ONLY
  (recorded∩pinned — the pip tools install floating-latest with `version: null` by design,
  gitleaks/osv/trivy record no version, and code-analyzer's per-engine versions vs the plugin
  pin are a namespace mismatch; all deliberately unchecked). Carried by a new OPTIONAL
  `recordedVersion(raw)` hook on the `opengrep` (top-level `version`) and `sarif`
  (`runs[0].tool.driver.semanticVersion`, driver-gated to Opengrep so the frozen Semgrep OSS
  1.168.0 SARIF can never false-fire against the opengrep pin) adapters. The comparand is
  single-sourced: `install-scanners.mjs` now exports `BINARY_PINS` and a DERIVED
  `PINNED_TOOL_VERSIONS = { opengrep: BINARY_PINS.opengrep.version }` (no second version
  literal), with the equality locked by an acceptance check.
- `skills/run-scans/SKILL.md` Family 7 prose updated: the substrate-unavailable report is now
  emitted deterministically by the ingest, not left to the operator's evidence summary.
- Suite: **63 files / 1006 checks** (+8 in `test-ingest-scanner-findings.mjs`: fires/aggregation/
  byte-identity, the trace-grafted sharp control, non-taint + with-trace negatives, the opengrep +
  SARIF surfaces, the SARIF driver gate both ways, the single-source lock, determinism). Both
  markers mutation-proven in throwaway extracts: `expectsTrace → false` reddens the fires tests;
  a wrong `PINNED_TOOL_VERSIONS` literal reddens the single-source lock + both clean-version
  controls.

## [0.8.79] — 2026-07-04

**The pmd-appexchange catalog's JavaScript-in-metadata and resource-loader rules now route by rule
name to `package-metadata`.** Completing the catalog's routable remainder after 0.8.78's
owned-class-dimension clusters — all eight rows land in `package-metadata` (already in the routed
set; no new dimension). The **JS-in-metadata cluster** — `AvoidJavaScriptInUrls` (a `javascript:`
URL in a metadata `<url>` link target), `AvoidJavaScriptWebLink` (a `CustomPageWebLink` with
`<openType>onClickJavaScript`), `AvoidJavaScriptCustomObject` (an `onClickJavaScript` action on an
object-nested webLink), and `AvoidJavaScriptHomePageComponent` (`<script>` markup in a
home-page-component body) — is the package-metadata methodology's JavaScript-declaration class:
the metadata **declaration** is the dimension's concern, while the eventual in-page XSS sink stays
injection-xss territory (the seam the dimension doc resolves in-text). The **resource-loader
cluster** — `LoadJavaScriptHtmlScript`, `LoadJavaScriptIncludeScript`, `LoadCSSLinkHref`, and
`LoadCSSApexStylesheet` — was **fixture-gated on a false-positive-breadth probe** before routing:
the capture seeded one Visualforce page with only inline `<script>`/`<style>` blocks plus the safe
`{!$Resource...}` load idiom (zero violations) and one page hotlinking script/CSS from a
non-`$Resource` external host (all four fired) — the rules are hotlink detectors, not high-volume
inline flags, so all four route. Every routed row is fixture-proven: a genuine
`sf code-analyzer run --rule-selector AppExchange` capture (Code Analyzer core 0.48.0 / pmd engine
0.41.0) over a seeded corpus — 8 violations across 5 files, firing all 8 targeted rules with these
exact spellings (`acceptance/fixtures/code-analyzer-catalog-jsmeta-seeded.json`; all three prior
catalog captures are untouched). Routed rows stay class-less: they supersede nothing and, being
deterministic, are never themselves superseded (the owner-authority lock from 0.8.78 is
unchanged). The **five Apex-behavior rules** (`AvoidGlobalInstallUninstallHandlers`,
`AvoidUnsafePasswordManagementUse`, `AvoidGetInstanceWithTaint`,
`AvoidSecurityEnforcedOldApiVersion`, `AvoidInvalidCrudContentDistribution`) are deliberately NOT
routed: they already default to `apex-exposed-surface`, which is the correct dimension
(global-method over-exposure, Apex CRUD/FLS behavior, password entry points), and a routing row
for them would be a build-breaking no-op — the routing value-lock excludes the default dimension,
and a new standing check pins each of the five to it. `AvoidLwcBubblesComposedTrue` (an
advisory-hedged flag on a standard LWC component-event idiom) stays out on false-positive-breadth
grounds; the deferred-set locks retargeted to it plus a no-op representative. The routing
value-lock is unchanged at the same six fixture-proven dimensions. Suite: **63 files / 998
checks** (was 993), all green; routing-removal and default-dimension-route mutations both proven
red in a throwaway checkout.

## [0.8.78] — 2026-07-04

**The pmd-appexchange catalog's owned-class-dimension metadata clusters now route by rule name to
their methodology dimensions.** Completing the cleanly-mappable catalog remainder after 0.8.77's
class-less-safe clusters: the rules whose target dimension **does** own a toolkit class now route
class-less through the same `RULE_DIMENSION` path. The **package-metadata cluster** —
`AvoidSControls` (an S-Control present in the package, prohibited managed-package markup),
`AvoidAuraWithLockerDisabled` (an Aura bundle `apiVersion` below 40, Lightning Locker disabled),
and `AvoidLmcIsExposedTrue` (a Lightning Message Channel with `isExposed=true`) — routes to
`package-metadata`, whose methodology explicitly names the Aura `apiVersion` and
`*.messageChannel-meta.xml` reads; the **sensitive-data rule** `ProtectSensitiveData` (sensitive
data in XML metadata that belongs in Protected Custom Metadata/Settings) routes to
`secrets-credentials` per the package-metadata methodology's boundary note. Every routed row is
fixture-proven: a genuine `sf code-analyzer run --rule-selector AppExchange` capture (Code
Analyzer core 0.48.0 / pmd engine 0.41.0) over a seeded corpus — 4 violations across 4 files,
firing all 4 targeted rules with these exact spellings
(`acceptance/fixtures/code-analyzer-catalog-owned-dim-seeded.json`; both prior catalog captures
are untouched). The routed rows are class-less: they supersede nothing and, being deterministic,
are never themselves superseded; each dimension's owned class — the secret scanners'
`hardcoded-secrets`, the egress/protocol metadata scanners' `plain-http-egress` +
`protocol-security-disabled` — retains sole supersession authority over co-located LLM
re-reports, and the owned scanners' real loci
(RemoteSiteSetting/CspTrustedSite/NamedCredential config) are disjoint from the routed rules'
loci (S-Control / Aura bundle / MessageChannel). Standing checks lock all three supersession
properties (routed row supersedes nothing; owner authority undisturbed in a three-party
reconcile — a new positive owner-supersedes-LLM lock for `package-metadata`; co-located
deterministic rows of the same dimension coexist, never hidden). The routing value-lock widened
to exactly six fixture-proven dimensions; the 0.8.76 credential-cluster comment's
cross-engine-dedup phrasing corrected to the real contract (no det-vs-det dedup exists in the
routing/supersession path); the deferred-set lock retargeted to the ambiguous remainder, which
stays unrouted pending its own dimension grounding. Suite: **63 files / 993 checks** (was 986),
all green; routing-removal and defer-route mutations both proven red in a throwaway checkout.

## [0.8.77] — 2026-07-04

**The pmd-appexchange catalog's class-less-safe metadata/markup clusters now route by rule name
to their methodology dimensions.** Continuing the 0.8.76 catalog routing: the two clusters whose
target dimension owns **no toolkit class** — so the routing is pure grouping and can never
supersede a co-located finding — now route class-less through the same `RULE_DIMENSION` path.
The **XSS construction sinks** (`AvoidUnescapedHtmlInAura`, the `<aura:unescapedHtml>` escape
hatch the injection-xss methodology names among its framework opt-outs, and
`AvoidCreateElementScriptLinkTag`, dynamic `<script>`/`<link>` DOM construction in Visualforce
JavaScript) route to `injection-xss`; the **connected-app OAuth config rules**
(`UseHttpsCallbackUrlConnectedApp`, an OAuth callback URL over plain HTTP, and
`LimitConnectedAppScope`, a connected app requesting the Full OAuth scope) route to
`oauth-identity`, which owns redirect/callback correctness and the connected-app OAuth settings
surface — and which the `plain-http-egress` metadata source-scanner does not touch (it reads only
the RemoteSiteSetting/CspTrustedSite/NamedCredential suffixes), so no double-report. Every routed
row is fixture-proven: a genuine `sf code-analyzer run --rule-selector AppExchange` capture
(Code Analyzer core 0.48.0 / pmd engine 0.41.0) over a seeded corpus — 4 violations across 3
files, firing all 4 targeted rules with these exact spellings
(`acceptance/fixtures/code-analyzer-catalog-markup-seeded.json`; the 0.8.76 capture is untouched).
The routing value-lock widened accordingly: every `RULE_DIMENSION` value must now be one of
exactly five fixture-proven dimensions, so a guessed or typo'd dimension string still fails the
build. The catalog remainder stays deliberately unrouted and lock-guarded (`EXP2-defer`): the
owned-class-dimension clusters (S-Controls/Locker/LMC metadata → `package-metadata`,
sensitive-data-in-XML → `secrets-credentials`) need the per-rule supersession grounding the
credential cluster got (E0.1d-EXPAND-3), and the js:-URL / resource-loader / LWC-event /
Apex-behavior rules need their own dimension grounding. Suite: **63 files / 986 checks** (was 981), all green;
routing-removal and defer-route mutations both proven red in a throwaway checkout.

## [0.8.76] — 2026-07-04

**The pmd-appexchange catalog's high-confidence clusters now route by rule name to their
methodology dimensions.** The installed catalog carries 37 Security rules — Salesforce's own
first-party encoding of what the review flags — and until now only 7 routed anywhere specific;
the rest ingested as undifferentiated unmapped hits. This release routes the three clusters
whose dimension is unambiguous, all class-less (`RULE_DIMENSION` rows; `classify()` untouched,
no owned class, supersedes nothing): the **session-id retrieval-site siblings**
(`AvoidApiSessionId` on XML metadata, `AvoidUnauthorizedApiSessionIdInApex`,
`AvoidUnauthorizedGetSessionIdInVisualforce` → `sessionid-egress`, extending the two rules
routed at 0.8.65), the **hardcoded-credential family** (all seven rules, including the
catalog's capital-C `AvoidHardCodedCredentialsInAura` spelling and the Visualforce
secret-attribute rule → `secrets-credentials`; the owned `hardcoded-secrets` class stays with
the secret scanners, so a co-located secret finding dedups cross-engine instead of
double-owning), and **feature-management protection** (`AvoidChangeProtectionUnprotected` →
`admin-surface`, grounded by the same baseline heading as the permission-grant scanners).
Every activated row is fixture-proven: a genuine `sf code-analyzer run --rule-selector
AppExchange` capture (Code Analyzer core 0.48.0 / pmd engine 0.41.0 / plugin 5.13.0) over a
seeded multi-rule corpus — 12 violations across 7 files, firing all 11 targeted rules with
these exact spellings (`acceptance/fixtures/code-analyzer-catalog-seeded.json`). Two catalog
rules are **deliberately not routed**: `AvoidInsecureHttpRemoteSiteSetting` and
`AvoidDisableProtocolSecurityRemoteSiteSetting` flag the exact patterns the
`plain-http-egress` + `protocol-security-disabled` metadata source-scanners already detect
deterministically, so routing the Code Analyzer twins would double-report the same locus —
the `EXP-skip` standing check locks the no-route (mutation-proven: routing one turns it red).
The markup/JavaScript/CSS/LWC rules await a grounded per-rule dimension decision
(E0.1d-EXPAND-2) rather than a guess. Suite: **63 files / 981 checks** (was 976), all green;
routing-removal and skip-route mutations both proven red in a throwaway checkout.

## [0.8.75] — 2026-07-04

**The toolkit's own supply chain is now a stated, standing-tested trust property.** For a
security tool, "vet it in minutes" is only credible if its own attack surface stays at the
floor — and the posture was true but unstated: the repository ships **no `package.json`** (zero
runtime npm dependencies — no lockfile, no `npm install`, no transitive tree), every `harness/`
engine and both `hooks/` enforcement hooks import only the Node standard library and in-repo
files (scanner-output parsing — SARIF/JSON, Salesforce metadata XML, plain text — is
implemented in-tree), and the one network-touching engine (`install-scanners.mjs`)
version-pins + sha256-verifies raw binary downloads before anything is made executable or
extracted, failing closed on mismatch or missing pin (package-manager installs carry no
per-file pin and ride the manager's own integrity layer — stated as such). The README now
carries a **"Supply chain"** section saying exactly that — each claim verified against the tree
before it was written — and three `SC-*` posture locks in `acceptance/test-ci-hygiene.mjs`
keep it true: **SC-no-package-json** (no tracked `package.json`/`package-lock.json` anywhere;
git-listing with a filesystem-walk fallback for extracted archives, anti-vacuous floor on the
listing size), **SC-harness-stdlib-only** (every `harness/` + `hooks/` import specifier —
static, multi-line, bare, dynamic, or `require` — is a `node:`/builtin or a relative path;
comment-line prose excluded; anti-vacuous floors on the file and specifier counts), and
**SC-readme-claim** (the README section and its load-bearing phrases stay present, so the doc
and the guard cannot drift apart). A machine-readable self-SBOM is noted as a candidate future
item, not shipped. Suite **63 files / 976 checks** (was 973), all green. Mutation-proven in a
throwaway checkout: a tracked root `package.json` turns SC-no-package-json RED; a third-party
import injected into a harness engine turns SC-harness-stdlib-only RED.

## [0.8.74] — 2026-07-04

**Class ownership is now an explicit, enforced declaration — the supersession-safety invariant
stops being a silent manual convention.** An adapter may OWN a toolkit class (its `classify()`
returns a non-null `CLASS_DEFS` key) only when that class is a distinct SINGLE-SHAPE finding at
its locus; otherwise a deterministic finding would supersede a co-located LLM finding of a
DIFFERENT shape through `reconcile-provenance`'s class-less dimension fallback. Until now that
shape-decision lived only in adapter comments and per-adapter discipline — nothing mechanically
forced a future class-owning adapter to make the call. Added `SINGLE_SHAPE`
(`harness/ingest-scanner-findings.mjs`), the explicit registry of the nine classes an adapter
is permitted to own (`crud-fls` · `sharing` · `viewall-overgrant` · `iac-misconfig` ·
`hardcoded-secrets` · `plain-http-egress` · `view-modify-all-data` ·
`protocol-security-disabled` · `admin-privilege-grant`), with the ownership rule and the
`*-non-supersession` standing-lock pattern documented at the definition. Four new `SS-*`
standing checks enforce it from every direction: every adapter's `classify()` is exercised over
the full `RULE_CLASS` + `RULE_DIMENSION` key sets plus unknown ruleIds, and every non-null
result must be registered (the forcing function — a new `classify()` returning an unregistered
class fails the build); every registry entry must be a real `CLASS_DEFS` key (no phantom rows);
the registry must `deepEqual` the actual owned set (no stale declarations); and the
CWE-routing / dependency / ReDoS adapters must stay `classify()→null` (the multi-shape posture
cannot quietly claim a routing dimension). No `classify()` or `CLASS_DEFS` changed — the
registry + checks are additive; the owned set is exactly what shipped. Suite **63 files / 973
checks** (was 969), all green. Mutation-proven in a throwaway checkout, three ways: a
source-scanner `classify()` returning a new unregistered class, a new `RULE_CLASS` row mapping
to an unregistered class (the probe list reads the maps dynamically, so the new row is probed
automatically), and a registry entry removed — each turns SS-owned-⊆-registry +
SS-registry-==-owned RED.

## [0.8.73] — 2026-07-04

**The whole deterministic-ingest band is now locked byte-deterministic — and the lock caught a
real merge defect on its first run.** A standing full-band determinism check
(`acceptance/test-determinism-band.mjs`) builds a hermetic temp target mirroring a real run —
every source-scanner fixture dir under the target tree, every file-parser fixture
(`*.json`/`*.sarif`) under `.security-review/evidence/`, both enumerated from
`acceptance/fixtures/` itself so every future adapter fixture joins the band automatically —
runs the entire deterministic band (`ingestAll`) over it TWICE, and asserts the two finding
bands are byte-identical, along with every non-merge result surface (scanners / skipped /
pending / notes) and the persisted ledger. Non-emptiness and both-kinds span guards make a
vacuous pass impossible (≥2 source-scanners AND ≥3 file-parsers must each contribute ≥1
finding, nothing in the corpus skipped), and a negative control proves the comparator flags a
single drifted field value. This turns "deterministic-by-default" from a per-adapter claim
(NJ-/TRV-determinism, the regexploit twice-run check) into a whole-band standing guarantee —
catching the cross-adapter regressions a per-adapter check cannot see: map/object key-ordering
drift, an accidental `Date`/`Math.random` in a future adapter, findings-sort instability,
merge ordering.

The check went RED on the live tree immediately: `mergeFindings` inserted the caller's band
objects into the ledger **by reference**, so when one batch carries two findings with one id —
the JSON+SARIF routes of the same hit, which converge to one id by design (0.8.61) — the
second copy `Object.assign`ed onto the band's own first copy, fabricating a hybrid finding no
adapter produced and making a fresh-ledger run's returned band (the CLI `--json` surface)
differ from a re-run's. Fixed: the insert path now stores a copy, so the merge never mutates
its input band. The persisted ledger is byte-identical before and after the fix (md5-verified
on the full corpus) — only the returned band changes, and it now carries exactly what the
adapters emitted. Suite **63 files / 969 checks** (was 62/964), all green. Mutation-proven in
a throwaway checkout: a `Math.random()` value injected into a `buildFinding` field turns
BAND-determinism RED, and re-aliasing the merge insert (reverting the copy) turns it RED
again.

## [0.8.72] — 2026-07-04

**The Secure-Communication requirement `endpoint-https-only` now applies to `managed-package`
scopes.** The `plain-http-egress` (0.8.66) and `protocol-security-disabled` (0.8.69) scanner
classes flag Remote Site Settings, CSP Trusted Sites, and Named Credentials — managed-package
metadata — and ground their findings in `endpoint-https-only`, but that requirement's
`applies_to` was `[external-endpoint, mcp-server, canvas]`, so on a package-only architecture
those findings cited a requirement that never entered the computed applicable set
(`applicable-requirements.mjs`) — a grounding seam. Added `managed-package` to the entry's
`applies_to` (its `details` now state that a package's own Remote Site Settings / CSP Trusted
Sites / Named Credentials / Apex callout endpoints are in scope); the requirement stays in the
external-endpoint / mcp-server / canvas sets, and its severity is unchanged (`major` — the fix
does not add a blocker requirement to the package-only floor). Scanners, adapters, and
`compute-sci` untouched: the fix is purely the requirement's applicability. New standing check
in `test-applicable-requirements` pins the managed-package membership, the no-regression on the
prior element types, and the not-a-blocker floor; the GAP-Y2 canonical-vocabulary pin moved to
`endpoint-ssl-labs-a-grade` (an id that stays external-endpoint-gated only). Suite **62 files /
964 checks** (was 963), all green. Mutation-proven: reverting the `applies_to` to omit
`managed-package` turns the new membership check RED.

## [0.8.71] — 2026-07-04

**The machine-verified taint reachability path now flows INTO the LLM prompts.** The
deterministic taint engines already attach a `reachabilityPath` (source → intermediate →
sink, locations only) to a finding, but until now that substrate never reached the LLM-facing
surfaces — the verifier judged "is the source attacker-controlled?" without ever being handed
the path the engine had proven. A new pure renderer, `renderReachabilityPath`
(home: `harness/finding-clusters.mjs`, with the locus primitives; a byte-parity-enforced
verbatim copy in `harness/workflow-template.mjs`, which cannot import), renders a
path-carrying finding to one compact line — `source <file>:<line> → … → sink <file>:<line>`
— and two surfaces consume it:

- **The verifier prompt**: a finding carrying a valid `reachabilityPath` gets a
  `- reachability_path:` line in its FINDING block, framed so the verifier knows the PATH is
  machine-verified and its only open question is source trust (is the source
  attacker-controlled / untrusted, with no upstream control sanitizing it before the sink) —
  implementing the residual the cold-run hardening roadmap defines as exactly that
  source-trust judgment. A finding with no path renders a byte-identical FINDING block
  (strictly additive; locked by a standing check).
- **The finder-facing ledger digest** (audit-codebase Step 4b): a `provenance:
  'deterministic'` entry carrying a `reachabilityPath` appends its rendered path to its
  digest line with the same proven-path / judge-the-source framing, so finders receive the
  substrate — not just the title. The digest stays mechanical: the helper renders the path
  text; it is never paraphrased.

Renderer contract: PURE + TOTAL — accepts a finding or a bare path object, locations only
(the attribute carries no content strings by design), returns `''` on absent / malformed /
one-ended input (a path is relayed only when BOTH proven ends are present), never throws; a
malformed middle step is skipped while the proven ends stand. How the path is PRODUCED, the
finding schema, and the co-location join (surfacing a co-located deterministic finding's path
onto a DIFFERENT, LLM-inferred finding's verifier) are all untouched — the join is the named
E0.1f-2 follow-on. HONEST SCOPE: this renders the path wherever a finding or ledger entry
carries one — the deterministic band (which carries paths) reaches the FINDER via the digest
today; the verifier wiring is additive and fires once a finding carries a path.

Suite **62 files / 963 checks** (was 955), all green. Mutation-proven: letting the renderer
emit a one-ended "path" (sink missing) turns `RGP-render` red; removing the verifier-prompt
path line turns `RGP-verifier` red.

## [0.8.70] — 2026-07-04

**A new metadata source-scanner flags the high-risk admin/privilege system permissions —
Manage Users, Author Apex, Customize Application, Modify Metadata — granted in permission
sets and profiles, as an honest least-privilege ADVISORY, deterministically from source.**
The `admin-privilege-grant` adapter (the eighteenth in the registry, the sixth
source-scanner — a `view-modify-all-data` clone with zero harness-core change) walks the
repo for `*.permissionset-meta.xml` + `*.profile-meta.xml` and emits an
`admin-privilege-grant` finding for every `<userPermissions>` block whose `<name>` is one of
`ManageUsers` / `AuthorApex` / `CustomizeApplication` / `ModifyMetadata` with
`<enabled>true</enabled>` — filed under `admin-surface` at `info`, grounded in the existing
`least-privilege-permission-grants` baseline requirement (informational → info, **off the
blocker floor** — flagged for review, never a submission gate). The SIBLING of the
View/Modify-All-Data advisory: that class covers the org-wide **data-access** pair
(`ViewAllData`/`ModifyAllData`); this one covers the **admin/privilege** quartet — the two
permission Sets are disjoint, so the same grant line is never double-reported (the standing
`AP-no-overlap` check locks it in both directions, and `view-modify-all-data` itself is
byte-untouched). Runs in the `--all` journey mode alongside the other source-scanners (no
evidence file, no `sf`, no network), so the audit's deterministic pass and the run-scans tail
pick it up with no invocation change.

Same honest framing as the sibling — an advisory, never an auto-fail: there is no named
AppExchange requirement that auto-fails a permission grant (reviewers apply least privilege
case-by-case, and legitimate justifications exist — identity management → Manage Users,
DevOps tooling → Author Apex / Modify Metadata), and **user permissions are excluded from
managed-package permission sets/profiles at install**, so a packaged grant may not reach
subscribers via the package — the finding advises verifying the EFFECTIVE grant (the
integration/running user, the Guest User, or an unmanaged/org-deployed context) and
documenting a business justification. Retrieved profile metadata may be partial, so the
absence of a grant is never least-privilege proof. PRECISION: exact-name (the adjacent
delegated-administration `ManageInternalUsers` never matches) + enabled-required (an explicit
`enabled=false` row never flags) + element-scoped (a `<description>` mention never flags).
Every name in the Set is a confirmed Profile/PermissionSet `<userPermissions>` API name; any
permission whose API name could not be confirmed was left out (a wrong name would be a dead
row that never matches real metadata).

Fixtures: `acceptance/fixtures/admin-privilege/` — authored schema-faithful permission-set +
profile XML: four positives across two files (`AdminOverreach` permission set: ManageUsers +
AuthorApex; `AdminOverreach_Profile`: CustomizeApplication + ModifyMetadata — all four Set
names exercised, permission-set AND profile surfaces) + one negative (`LeastPriv`: enabled=false ManageUsers · a prose `<description>`
mention · benign ViewSetup · adjacent-name ManageInternalUsers · a ViewAllData grant that
belongs to the sibling class, the disjointness proof). Suite **62 files / 955 checks** (was
947), all green. Mutation-proven: dropping the enabled-true requirement (flagging a disabled
grant) turns `AP2` red; pointing the non-supersession pair at the same locus turns
`AP-non-supersession` red.

## [0.8.69] — 2026-07-04

**A new metadata source-scanner flags Remote Site Settings that set
`disableProtocolSecurity=true` — the flag that permits data transfer between an HTTPS session
and an HTTP session (a transport downgrade the Secure Communication requirement forbids) —
deterministically from source.** The `remote-site-protocol-security` adapter (the seventeenth
in the registry, the fifth source-scanner — an `egress-plain-http` clone with zero
harness-core change) walks the repo for `*.remoteSite-meta.xml` and emits a
`protocol-security-disabled` finding for every `<disableProtocolSecurity>true</disableProtocolSecurity>`
element, filed under `package-metadata` at `high` — grounded in the existing
`endpoint-https-only` baseline requirement (major → high), the same codified Secure
Communication violation `plain-http-egress` grounds in (one requirement, two metadata shapes,
two distinct classes). Runs in the `--all` journey mode alongside the other source-scanners
(no evidence file, no `sf`, no network), so the audit's deterministic pass and the run-scans
tail pick it up with no invocation change.

PRECISION: true-required — the flag defaults to `false`, an explicit `false` element (the
platform default posture) never flags, an absent element never flags — and element-scoped: a
`<description>` mentioning the flag in prose never flags. INDEPENDENT of `egress-plain-http`:
that adapter reads endpoint-URL schemes, this one reads only the protocol-security element —
the standing `DP-no-overlap` check locks the disjointness in both directions, and
`egress-plain-http` itself is byte-untouched. LOW FP by construction (Salesforce explicitly
warns against enabling the flag; it is rarely legitimate in a distributed package); the one
benign case — an internal/on-premises HTTP endpoint that genuinely requires it — is
dispositionable via the false-positive dossier, never suppressed. The owned class is
single-shape at its locus (the `<disableProtocolSecurity>` element line), so supersession
never reaches a different-shape `package-metadata` finding at a different locus
(`DP-non-supersession`).

Fixtures: `acceptance/fixtures/remote-site-protocol/` — authored schema-faithful
RemoteSiteSetting XML: one positive (`Downgrade_RSS`, `disableProtocolSecurity=true` on an
`https://` URL, so the scheme scan never fires) + two negatives (`Secure_RSS` explicit-false;
`NoFlag_RSS` no element + a prose `<description>` mention). Suite **62 files / 947 checks**
(was 941), all green. Mutation-proven: dropping the true-requirement (flagging any
`<disableProtocolSecurity>` element regardless of value) turns `DP2` red; pointing the
non-supersession pair at the same locus turns `DP-non-supersession` red.

## [0.8.68] — 2026-07-04

**The org-wide View/Modify-All-Data permission-grant detector is reframed to an honest
least-privilege ADVISORY — informational, off the blocker floor — grounded in a new sourced
`least-privilege-permission-grants` baseline requirement.** Two corrections drove the reframe,
both verified against official Salesforce documentation. First, user permissions are excluded
from managed-package permission sets and profiles at install (the 2GP packaging guide states
it verbatim), so a `ViewAllData`/`ModifyAllData` grant declared in packaged metadata may never
reach subscribers via the package — the static grant is an advisory signal to verify against
the EFFECTIVE grant (the integration/running user, the Guest User, or an unmanaged/org-deployed
context), not a confirmed subscriber grant. Second, there is no named AppExchange auto-fail for
a permission grant — reviewers apply least privilege case-by-case and can require a business
justification — and the previous `fail-sharing-model` grounding was a misattribution (that
requirement governs Apex sharing declarations, not permission grants). The finding now leads
with `advisory (least privilege)`, carries the managed-package caveat + verify-effective-grant
guidance + the business-justification ask in its message and recommendation, and lands at
severity `info` (never a submission gate). The new baseline requirement is sourced to the
official Security Best Practices page ("Evaluate User Privilege") and the 2GP packaging guide,
`applies_to: [managed-package]`, `severity_if_missing: informational` — it joins the
managed-package applicable set and adds nothing to the blocker floor.

Detection logic is byte-identical: the same `<userPermissions>` block scope, exact-name
`{ViewAllData, ModifyAllData}` match, `enabled=true` guard, and element-scoping; the adapter
name and class key are unchanged, and broadening the permission list (`ManageUsers`,
`AuthorApex`) stays a named follow-on. Suite **62 files / 941 checks** (was 940), all green —
the new `PV-advisory` check locks the caveat text and the off-blocker-floor severity.
Mutation-proven: regrounding the class back to `fail-sharing-model` turns `PV-classSeverity`
and `PV1` red. Baseline counts: 166 entries, 122 `verified_primary`.

## [0.8.67] — 2026-07-04

**A new metadata source-scanner flags the org-wide View All Data / Modify All Data system
permission granted in permission sets AND profiles — a documented sharing-bypass over-grant —
deterministically from source.** The `view-modify-all-data` adapter is the fourth
source-scanner (metadata-viewall's clone: same repo walk, a pure per-file extractor, constant
`classify()`, security-by-construction — no tag filter) and needs no external tool, no `sf`,
no network: it reads `*.permissionset-meta.xml` and `*.profile-meta.xml` and flags every
`<userPermissions>` block whose `<name>` is exactly `ViewAllData` or `ModifyAllData` with
`<enabled>true</enabled>`. These two system permissions bypass ALL sharing rules and org-wide
defaults across every object (field-level security still applies), so granting them in a
package is the org-wide sharing-model over-grant the reviewer scrutinizes. Each finding lands
at the grant's `<name>` file:line with the permission and file kind named, filed under
`admin-surface` via the new owned class `view-modify-all-data`, severity grounded in the
`fail-sharing-model` baseline requirement (major → high) — the same grounding as the
per-object `viewall-overgrant`. The `--all` journey mode now always runs all three
source-scanners, so the finding appears in every cold audit pass with zero configuration.

**Coverage.** This closes exactly the gap the existing permission-set over-grant scan leaves:
`metadata-viewall` reads `<objectPermissions>` blocks in permission sets only — it never reads
system `<userPermissions>` and never scans profiles. The two source-scanners are disjoint by
construction (no double-report), locked by the PV-no-overlap standing check in both directions.

**Precision.** The `<name>` match is exact (`ViewAllUsers` or any `ViewAll*`-prefixed
permission never matches), `<enabled>true</enabled>` is required within the same
`<userPermissions>` block (a rare explicit `enabled=false` row never flags), and the read is
element-scoped — a mention inside a `<description>` never flags. The class is single-shape at
its locus: the deterministic finding sits on the specific grant line, so it supersedes only a
co-located model-inferred finding at that same grant (where it is authoritative), never a
different-shape `admin-surface` finding elsewhere in the file — locked by the
PV-non-supersession standing check.

**Honest floor.** The finding is a **statically-declared org-wide sharing-bypass grant in
committed metadata** — not a confirmed data leak: the grant still respects field-level
security, needs real data and a running user to expose anything, and source metadata cannot
see whether it is exercised. And retrieved profile metadata is often **partial** (only
in-scope components), so the absence of a grant is never least-privilege proof — the scanner
flags what is present and enabled, nothing more. `ManageUsers`/`AuthorApex` (a distinct
privilege class), per-object `viewAllRecords`/`modifyAllRecords` in profiles, the
permission-set-group + muting effective-permission composition, and the release-to-release
grant-widening diff are named follow-on slices.

Fixtures: `acceptance/fixtures/dangerous-permissions/` — authored, schema-faithful, benign
metadata XML (3 positives across a permission set and a profile + 1 negative file exercising
every precision guard).

Suite **62 files / 940 checks** (was 932), all green. Mutation-proven: dropping the
enabled-required guard (flagging any `ViewAllData`/`ModifyAllData` name) turns the PV3
precision check red; pointing the non-supersession pair at the same locus turns
PV-non-supersession red (the supersession visibly fires).

## [0.8.66] — 2026-07-03

**A new metadata source-scanner flags plain-HTTP (`http://`) endpoints declared in Remote Site
Settings, CSP Trusted Sites, and Named Credentials — the codified Secure Communication
violation — deterministically from source.** The `egress-plain-http` adapter is the third
source-scanner (metadata-viewall's clone: same repo walk, a pure per-file extractor, constant
`classify()`, security-by-construction — no tag filter) and needs no external tool, no `sf`,
no network: it reads the package's declarative egress-config metadata and flags every endpoint
declared over plain `http://` — `RemoteSiteSetting` `<url>`, `CspTrustedSite` `<endpointUrl>`,
and `NamedCredential` in BOTH shapes (the legacy `<endpoint>` element and the modern API 56.0+
`<namedCredentialParameters>` block's `<parameterValue>` where the sibling `<parameterType>` is
`Url`). Each finding lands at the specific URL's file:line with the element and endpoint named,
filed under `package-metadata` (the dimension whose charter owns the trusted-host XML `http://`
flags), with severity grounded in the `endpoint-https-only` baseline requirement (major → high)
via the new owned class `plain-http-egress`. The `--all` journey mode now always runs both
source-scanners, so the finding appears in every cold audit pass with zero configuration.

**Precision.** The scheme match is anchored and case-insensitive — `https://` can never match
(no `/https?/` shortcut) — and the URL is read only from the endpoint-bearing elements of the
metadata type that owns them, never a whole-file grep: an `http://` inside a `<description>`
(or the metadata `xmlns` URI itself) never flags. The class is single-shape at its locus: the
deterministic finding sits on the specific `http://` URL line, so it supersedes only a
co-located model-inferred finding at that same endpoint (where it is authoritative), never a
different-shape `package-metadata` finding elsewhere in the file — locked by the
EG-non-supersession standing check.

**Honest floor.** The finding is a **statically-declared insecure-transport endpoint in
committed configuration** — not a confirmed data leak: whether traffic actually flows over the
endpoint, and how its TLS behaves, are runtime questions that belong to the DAST/TLS scan
families. And no "secret" finding is ever emitted from a credential file: a Named/External
Credential's secret value is org-encrypted and never present in metadata (hardcoded-secret
detection is a different engine). Wildcard-host / over-broad egress, Apex
`setEndpoint('http://…')` literals, and the Remote-Site-host↔Named-Credential join are named
follow-on slices.

Suite **62 files / 932 checks** (was 924), all green. Mutation-proven: dropping the
trailing-`s` exclusion from the scheme match (flagging `https://` too) turns the EG2 precision
check red; pointing the non-supersession pair at the same locus turns EG-non-supersession red
(the supersession visibly fires — proving the protection is locus-specificity, not an
accident).

## [0.8.65] — 2026-07-03

**Code Analyzer's built-in `pmd-appexchange` session-id retrieval rules now file under the
`sessionid-egress` dimension.** These findings already fired on every real scan — run-scans
invokes Code Analyzer with the AppExchange rule selector, whose session-id rules flag every
`UserInfo.getSessionId()` and `$Api.Session_ID` retrieval site — but because they own no toolkit
class and carried no dimension hint, every hit landed in the catch-all `apex-exposed-surface`
grouping instead of the auto-fail `sessionid-egress` dimension that owns it. Code Analyzer v5
output carries **no CWE field** for any engine (verified against the committed fixtures and the
v5 output schema), so the `CWE_TO_DIMENSION` mechanism the five SAST adapters share cannot apply:
this release adds `RULE_DIMENSION`, a rule-NAME→dimension table (the class-less sibling of
`RULE_CLASS` — the standing test asserts the two maps are disjoint), and the Code Analyzer
adapter now sets the same `dimensionHint` its SAST siblings derive from CWEs. Routing only —
`classify()` stays null, no `CLASS_DEFS['sessionid-egress']` entry exists, so a routed finding
owns no toolkit class and supersedes nothing: `sessionid-egress` is a multi-shape dimension, and
a routed retrieval-site row must never silence a co-located model-inferred finding of a
different session-egress shape.

Both active rows are fixture-proven, keyed on the exact spellings a genuine
`sf code-analyzer run --rule-selector AppExchange` capture emitted (Code Analyzer core 0.48.0 /
pmd engine 0.41.0 / `@salesforce/plugin-code-analyzer` 5.13.0) over a minimal seeded sample:
`AvoidUnauthorizedGetSessionIdInApex` (Apex `UserInfo.getSessionId()`, tags
AppExchange/Security/Apex, engine `pmd`) and `AvoidUnauthorizedApiSessionIdInVisualforce`
(Visualforce `$Api.Session_ID`, tags AppExchange/Security/Visualforce). The formula/merge-field
`GETSESSIONID()` sibling documented in the pmd-appexchange rule reference stays a fixture-pending
comment — nothing speculative is activated.

**Honest floor.** These are bare-retrieval rules: they flag the retrieval SITE, including the
approved on-platform uses Salesforce's session-id guidance carves out, and do not model the value
reaching an egress sink. The routing makes the retrieval substrate deterministic and correctly
filed under the auto-fail heading; the egress VERDICT — does this retrieval actually leave the
platform — stays the labelled model/human residual. Scope is the package/Apex side only: the
external-service side of the dimension (inbound token passthrough, Authorization-header logging,
raw persistence, URL embedding) has no clean deterministic substrate — a generic CWE-532/CWE-200
sensitive-info-in-log hit is secrets-credentials territory and would over-route into an auto-fail
band — so it stays model-residual, and no generic log/info-exposure CWE routes here.

Suite **62 files / 924 checks** (was 919), all green. Mutation-proven: removing
`AvoidUnauthorizedGetSessionIdInApex` from `RULE_DIMENSION` turns the routing + fixture checks
red (the finding falls back to `apex-exposed-surface`); adding a `CLASS_DEFS['sessionid-egress']`
entry + a non-null `classify()` for the routed rule turns the non-supersession lock red (the
supersession visibly fires).

## [0.8.64] — 2026-07-03

**The toolkit now ships its own curated `rules/injection/` Semgrep taint-rule pack, covering the
XPath (CWE-643) and LDAP (CWE-90) injection classes no OSS pack detects.** 0.8.63 routed XPath
and LDAP to `injection-xss` for the languages a community rule already covers (Java/C# via
`p/security-audit` + `p/csharp`). But no OSS rule covers Python XPath or LDAP, Go XPath or LDAP,
or Node LDAP — and njsscan's `node_xpath_injection` flags only `xpath.parse()`, leaving the common
`xpath` npm evaluation sinks (`select`/`select1`/`evaluate`) uncovered. A partner on those stacks
got no finding (or, for Node XPath, only the narrow `parse()` case). CodeQL covers them, but its
license bars use on proprietary partner code. So this
release adds six toolkit-authored taint rules — `{xpath,ldap}-{python,js,go}.yaml` — run via
`--config ${CLAUDE_PLUGIN_ROOT}/rules/injection/` (a local directory: no network, no login, free
Community Edition), wired into the run-scans Family 7 Semgrep invocation alongside the registry
packs. This is a new capability: the toolkit authoring detection content, with the honesty floor
intact.

Every rule is `mode: taint` — it **requires a real source→sink flow, never a bare sink** (a
sink-only rule is high-FP and is the anti-pattern). Sources are the framework request objects
(Flask/Django `request.*`, Express `req.query/params/body`, Go `r.FormValue` / `r.URL.Query()` /
`mux.Vars`). Sinks are the real evaluation/query calls, and every one is scoped to stay low-FP.
The library-distinctive sinks fire directly: lxml `.xpath()` / `etree.XPath`, ElementTree
`.findtext`/`.iterfind`, the `xpath` npm `select`/`select1`/`evaluate`, package-qualified
antchfx/xmlquery + htmlquery + beevik/etree `CompilePath`, python-ldap's LDAP-exclusive
`search_s`/`search_ext_s`/`search_st`, and go-ldap's `ldap.NewSearchRequest` / `ldap.SearchRequest`.
The sinks whose method names collide with common non-XML/non-LDAP calls are **anchored** to their
library — by import resolution, receiver type, or receiver factory — rather than shipped noisy:
ElementTree `.find`/`.findall` require an XML-parse-derived receiver (with a reassignment guard, so
rebinding that name to a `str` / `re.Pattern` cannot re-open the collision); ldap3 `.search()`
requires a receiver from the import-resolved `ldap3.Connection` (so an in-house class that merely
shares the name `Connection` does not fire); ldapjs/ldapts `.search(base, {filter})` requires a
receiver from the import-resolved `ldapjs.createClient()` / `ldapts` `Client` (so redis / supabase /
Elasticsearch / pg exports of the same factory name, and the ordinary `scope:` option key, do not
fire); Go `FindElements`/`FindElement` require an `*etree.Element` / `*etree.Document` receiver (so
a UI-tree or repository method of the same name does not fire); and a partner-defined
`NewSearchRequest` helper is excluded by qualifying the sink to the go-ldap package. The Go request
sources are typed to `*http.Request` so a same-named `FormValue`/`URL.Query` on a config struct is
not a source. Recognized sanitizers (lxml parameterized `variables=`, `escape_filter_chars`,
`ldap-escape`, `ldap.EscapeFilter`, and a `strconv` numeric coercion in Go) suppress the finding, and
`focus-metavariable` narrows each match to the injectable expression. The Python/JS request sources
are matched by framework name (the standard SAST model semgrep's own OSS packs use), so a value from
an identically-named non-request object is a residual false positive — the accepted SAST baseline.

Each rule is validated with `semgrep --test` (it fires on the vulnerable line and stays silent on
the sanitized / parameterized / string-literal line AND on the specific benign collisions above —
the per-rule correctness proof; the minimal vuln/safe samples live beside each rule as the
semgrep-test convention requires), and a genuine
`semgrep --config rules/injection/ --json` capture over a minimal seeded sample per (class,
language) is committed as the routing fixture. **All six rules reached the low-FP bar and shipped;
none had to be dropped to the model residual.**

Routing rides the existing table: each rule tags CWE-643 or CWE-90, which the `CWE_TO_DIMENSION`
map already carries from 0.8.63, so a hit routes to `injection-xss` through the same `metadata.cwe`
path as every registry rule — **no new map integer and no ingest/harness change**. `classify()`
stays null, so a routed hit owns no toolkit class and supersedes nothing.

**Honest floor.** Community-Edition taint is **intra-file / intraprocedural**, so the pack is
low-FP (a real source→sink flow is required) but moderate-FN: a tainted value that crosses a
function or module boundary before the sink is not caught by the pack and falls to the model
residual, not to a noisy rule. Two residuals are the accepted taint-SAST baseline every taint
engine (including semgrep's own OSS packs and CodeQL) shares, not a defect of these rules: a value
neutralized by a partner's *own* undeclared escape function still flows (only the recognized library
escapers + numeric coercions are modeled as sanitizers — and a custom escaper flagged this way is
worth confirming complete), and a request value used only as a key into a constant allowlist map is
conservatively treated as tainted. XML injection (CWE-91) remains a model residual, not added.

Suite **62 files / 919 checks** (was 915), all green. Mutation-proven: removing
`--config …/rules/injection/` from the Family 7 command turns the wiring-lock check red, and
neutralizing a rule's sink is caught by `semgrep --test` at authoring time.

## [0.8.63] — 2026-07-03

**XPath (CWE-643) and LDAP (CWE-90) injection findings now file under `injection-xss` for the
languages an OSS rule already covers.** These findings already fired — Semgrep flags them on
Java (`p/security-audit`) and C# (`p/csharp`), and njsscan flags Node XPath — but because 643
and 90 were not yet rows in the `CWE_TO_DIMENSION` table, every hit routed to the catch-all
`external-sast` grouping instead of the `injection-xss` methodology dimension that owns it. A
pack firing is not the same as the dimension gap being closed. This release promotes 643 and 90
into the map, so those hits route to `injection-xss` across every SAST adapter from one table
(the unified-map property added in 0.8.62). No rule was authored — this is a routing-only
change.

Each promoted CWE is backed by a genuine captured scanner fixture over a minimal seeded sample:
Semgrep 1.168.0 emits CWE-643 (Java `tainted-xpath-from-http-request` + C#
`xpath-injection`) and CWE-90 (Java `tainted-ldapi-from-http-request` taint rule + the
structural `ldap-injection` + C# `ldap-injection` on `DirectorySearcher.Filter`); njsscan 0.4.2
emits CWE-643 for Node `xpath.parse()` (narrow — the rule flags `parse()` only, not
`select()`/`evaluate()`). Routing only: `classify()` stays null on every SAST adapter, so a
routed XPath/LDAP finding owns no toolkit class and supersedes nothing — a deterministic finding
never silences a co-located model-inferred injection finding of a different shape.

**Honest floor.** Only the languages an OSS rule already covers are closed here (Java/C# for
both classes, plus Node XPath). XPath and LDAP in Python, Go, and JavaScript (no LDAP) have no
community rule and are tracked as a separate slice that must author custom taint rules; nothing
speculative was promoted — a CWE is added to the map only after a captured fixture emits it. XML
injection (CWE-91) stays a model-residual finding, not added. The co-resident weak-hash finding
(CWE-328) in the same Semgrep capture stays `external-sast`, the exact-id negative proving the
promotion routes only what it should.

Suite **62 files / 915 checks** (was 911), all green. Mutation-proven: removing 643 (or 90) from
`CWE_TO_DIMENSION` turns its routing fixture test red; adding a `CLASS_DEFS['injection-xss']` +
a non-null `classify()` turns the XPath/LDAP non-supersession lock red.

## [0.8.62] — 2026-07-03

**CWE-based dimension routing is now one extensible map, and the untrusted-deserialization
family files under its own methodology dimension.** The five SAST adapters (Semgrep, Bandit,
njsscan, the SARIF adapter, Opengrep) already routed a scanner-emitted CWE to a review
dimension; this release unifies that routing into a single `CWE_TO_DIMENSION` table so every
current and future class routes through one place across all five adapters — adding a class is
adding rows, not editing adapters. The injection-xss routing is byte-behavior-unchanged (the
whole injection test suite stays green, and a behavior-identity assertion pins the map's
injection subset to the prior allowlist).

On top of that substrate, the **untrusted-deserialization** family now routes to its real
dimension (`methodology/dimensions/untrusted-deserialization.md`) instead of the catch-all
`external-sast` grouping: native-object deserializers (Python `pickle` → CWE-502; Node
`node-serialize` → CWE-502), XML external entity / XXE (CWE-611), and JavaScript prototype
pollution (CWE-915 — the id the OSS rule actually emits). Each active CWE is proven by a
genuine captured scanner fixture over a minimal seeded sample (Bandit 1.9.4, Semgrep 1.168.0,
njsscan 0.4.2), and the map routes the family across multiple adapters from one table. Routing
only: `classify()` stays null on every SAST adapter, so a routed deser finding owns no toolkit
class and supersedes nothing — a deterministic deser finding never silences a co-located
model-inferred deser finding of a different shape (native-deser vs prototype-pollution vs XXE).

**Honest floor.** CWE-1321 (prototype pollution's specific id) is left fixture-pending — the
OSS rule tags that sub-class CWE-915, and no minimal seed emitted 1321. The Apex
`JSON.deserialize` → sObject mass-assignment / BOPLA variant has no OSS scanner rule at all and
stays a model-residual finding, never routed here — the uncovered sub-shape, stated not faked
(the same posture as the XPath/LDAP injection residuals). Bandit tags its XML rules CWE-20, so
those XXE hits stay `external-sast` — a live illustration that scanners tag one class
inconsistently across rules, which is exactly why the fixture, never a guessed id, is the
source of truth.

Suite **62 files / 911 checks** (was 905), all green. Mutation-proven: removing an active deser
CWE from `CWE_TO_DIMENSION` turns its routing fixture test red; adding a
`CLASS_DEFS['untrusted-deserialization']` + a non-null `classify()` turns the deser
non-supersession lock red.

## [0.8.61] — 2026-07-03

**Reachability now flows on current tooling: the ingest reads the standardized SARIF
`codeFlows` taint path through a version-portable normalizer, and Opengrep joins the Family 7
scan set as the OSS engine that actually emits the trace.** 0.8.57 built the
`reachabilityPath` capture and 0.8.60 wired the live scan to request it — but current Semgrep
CE (1.168.0) omits the machine-readable trace from `--json` entirely, leaving the substrate
dormant on up-to-date installs. This release makes it flow, engine-agnostically, from two new
surfaces:

**The `sarif` ingest adapter.** SARIF 2.1.0 is the OASIS-standardized output format every
serious SAST engine emits, and its `codeFlows → threadFlows → locations` construct is the
standardized serialization of the source→sink taint path. The new adapter ingests any SARIF
2.1.0 file (`--all` now enumerates `evidence/*.sarif` alongside `*.json`): the engine label
comes from the file's own `tool.driver.name` (never hardcoded — Opengrep, Semgrep, and CodeQL
captures all self-identify), severity maps tool→band from the result `level` (via the rule's
`defaultConfiguration` fallback — the SARIF defaulting chain), the rule's `CWE-###` tags
route injection findings to the `injection-xss` dimension exactly like the JSON adapters do,
and `codeFlows` normalizes to the SAME `{source, intermediate[], sink}` `reachabilityPath`
shape as the Semgrep-JSON dataflow trace — one normal form across engines and formats, proven
by a standing equivalence check over genuine captures of the identical seeded sample. Every
`codeFlows` sub-object is spec-optional, so the normalizer is defensive end-to-end: zero,
partial, or malformed flows attach nothing and never throw; a SARIF finding owns no toolkit
class (severity is the tool band; it supersedes nothing).

**Opengrep, wired as a scanner.** Opengrep (the LGPL-2.1, consortium-governed Semgrep fork)
empirically emits the taint trace current Semgrep CE withholds — in BOTH `--json`
(`extra.dataflow_trace`, parsed by the existing normalizer unchanged) and `--sarif`
(`codeFlows`) — and adds cross-function intra-file taint via `--taint-intrafile`. It is now
detectable (Family 7, external-SAST), installable on consent as a sha256-pinned v1.25.0
release binary (four platforms, raw single-file assets, each hash verified against the
release's published per-asset digests; an unpinned platform fails closed), and documented in
the run-scans Family 7 invocation capturing both output surfaces. Empirical flag truth,
pinned by fixture and standing check: Opengrep's JSON carries the trace even without
`--dataflow-traces`, but its SARIF emits `codeFlows` ONLY with the flag — the documented
commands keep it on both. The Semgrep invocation gains a parallel `--sarif` capture.

**Engine-label honesty.** Opengrep's JSON output is content-indistinguishable from Semgrep's
format (verified on the captured fixture pair: identical key sets at every level,
`engine_kind: 'OSS'` on both — no distinguishing field exists), so a naive ingest would
mislabel Opengrep findings `engine: 'semgrep'`. The new `opengrep` adapter (explicit
`--scanner opengrep`) and an evidence-name refinement in `--all` (a semgrep-shaped file under
the documented `opengrep-<date>.json` name re-labels, with a visible note) keep provenance
honest — an Opengrep finding never says `semgrep`, and the JSON + SARIF captures of the same
hit converge on ONE finding id (same engine + rule + locus) instead of double-reporting.

**The Semgrep-SARIF question, adjudicated by capture.** On the identical seeded source→sink
sample and taint rule where Opengrep emits a 4-step `codeFlows` flow, Semgrep CE 1.168.0
`--sarif --dataflow-traces` emitted NO `codeFlows` — the CE SARIF taint path is Pro-gated.
The captured fixture is committed as the adjudication record and a standing check pins the
status: the Semgrep-SARIF reachability surface is **pending** (nothing fabricated); Opengrep
is the OSS engine the reachability substrate relies on today. The Semgrep-JSON ingest path is
byte-unchanged.

Suite **62 files / 905 checks** (was 895), all green. Mutation-proven: nulling the SARIF
codeFlows normalizer turns the SG-RP-SARIF1 anchor red.

## [0.8.60] — 2026-07-03

**The live Family 7 external-SAST scan now requests the source→sink dataflow trace, so the
`reachabilityPath` capture shipped at 0.8.57 populates on real runs — not only against
fixtures.** The documented run-scans Semgrep invocation gains `--dataflow-traces`: the
explicit ask for `extra.dataflow_trace`, the taint-mode source→sink path the ingest adapter
normalizes onto the finding as `reachabilityPath` + `reachable: true`. Until now the live
command never requested the trace, leaving the reachability capture proven at the adapter but
dormant end-to-end. The standing taint fixture already matches the wired command (genuine
Semgrep 1.85.0 `--json --dataflow-traces` capture) and is unchanged; no adapter or harness
logic changed — this is a scan-command + test change.

**The honest ceiling, verified live on a seeded source→sink sample:** whether `--json`
actually carries the trace is Semgrep-version-dependent — 1.85.0 emits `extra.dataflow_trace`,
while 1.168.0 serializes traces to text/SARIF output only and omits it even with the flag.
The run-scans prose now instructs the operator to report "reachability substrate unavailable
on this Semgrep version" when a taint finding's evidence JSON carries no trace, rather than
silently shipping trace-less findings (which still ingest normally — only `reachabilityPath`
is absent).

**A standing wiring check locks the command shape.** The fenced Family 7 invocation must
carry `--dataflow-traces` alongside `--json` — scoped to the invocation blocks, not the
prose, so a future edit that drops the flag (silently re-dormanting the reachability
capture) fails the build even if a note still mentions it.

Suite **62 files / 895 checks** (was 894), all green. Mutation-proven: removing
`--dataflow-traces` from the documented invocation turns the wiring check red.

## [0.8.59] — 2026-07-03

**`injection-xss` routing now covers the full injection taxonomy — cross-site scripting,
code and eval injection, server-side template injection, and NoSQL injection — across the
`semgrep`, `bandit`, and `njsscan` scanners.** The previous release routed only SQL
injection (CWE-89) and OS-command injection (CWE-78) to the `injection-xss` dimension. The
exact integer-CWE allowlist now also carries **CWE-79** (XSS), **CWE-94** (code injection),
**CWE-95** (eval / dynamically-evaluated code), **CWE-96** (server-side template injection /
statically-saved code), and **CWE-943** (NoSQL / data-query injection); every other hit
keeps the catch-all `external-sast` grouping label. `njsscan` joins `semgrep` and `bandit`
as a CWE-routed adapter — an allowlisted CWE in its `metadata.cwe` field now files the hit
under `injection-xss` too.

**Each newly-routed CWE is proven by a genuine generated fixture** — a minimal seeded sample
run through the real scanner, with the tool's actual output captured as the test fixture:
XSS via njsscan `express_xss` and semgrep `raw-html-format` (CWE-79); code injection via
bandit `jinja2_autoescape_false` (CWE-94); eval injection via njsscan `eval_nodejs` and
semgrep `eval-injection` (CWE-95); template injection via semgrep `render-template-string`
(CWE-96); NoSQL injection via njsscan `node_nosqli_js_injection` (CWE-943). Each fixture is
**rule-path-proven, not class-proven**: it proves the router handles the one rule that fired
on the seed — scanners populate the CWE field inconsistently across rules for the same
class, so an app that hits the same class through a different rule (one with absent or
different CWE metadata) can still route to `external-sast`. Sub-classes for which no OSS rule
emitted a CWE on a minimal sample — XPath, LDAP, XML injection, and the
expression-language / template variants some tools tag differently — are pre-registered as
fixture-pending comments and stay `external-sast` until a fixture proves each.

**Routing only, and the boundary holds.** The finding's band/severity, id hash, reasoning,
and gate are untouched — only the `dimension` (the review heading) changes — and all three
scanners keep `classify() → null`, so a routed finding owns no class and supersedes nothing.
The exact-membership check keeps the non-injection findings put: server-side request
forgery (CWE-918) and path traversal (CWE-22) belong to the `data-export` dimension, and
cross-site request forgery (CWE-352), custom-URL-scheme authorization (CWE-939), hardcoded
credentials (CWE-798), and protection-mechanism failures (CWE-693) all stay `external-sast`
— locked by negative-routing tests, including a fresh CSRF negative captured alongside the
XSS finding. One record correction: the `dynamic-urllib` negative anchor is CWE-939
(custom-URL-scheme authorization), not SSRF — real SSRF is CWE-918 and routes to
`data-export`.

Suite **62 files / 894 checks** (was 889), all green — a positive routing check per
generated fixture, an njsscan positive-and-negative pair, the expanded exact-membership
allowlist unit (a neighbouring id like `CWE-940` / `CWE-9430` / `CWE-960` never reads as an active id),
and the non-supersession lock now covers a newly-added sub-class. Mutation-proven: removing a
newly-activated CWE from the allowlist turns its fixture's routing check red, and adding an
owned `injection-xss` class fires the supersession lock.

## [0.8.58] — 2026-07-03

**External-SAST SQL-injection and command-injection findings now file under the
`injection-xss` dimension.** The `semgrep` and `bandit` adapters previously filed every
finding under the catch-all `external-sast` grouping label — a SQL-injection finding and a
path-traversal finding landed under the same heading, so the review never surfaced the
injection findings under `injection-xss`, the methodology dimension that owns the injection
class. Each hit's scanner-emitted CWE now routes the finding: an exact integer-CWE
allowlist (`INJECTION_XSS_CWES` — CWE-89 SQL injection and CWE-78 OS command injection, the
two ids a captured fixture proves end-to-end) sends the hit to `injection-xss`; everything
else keeps `external-sast`. The CWE is read from each tool's real captured shape —
Semgrep's `extra.metadata.cwe` (a `CWE-###[: title]` string or an array of them, anchored
so `CWE-789` can never read as 78) and Bandit's `issue_cwe.id` (an integer); a malformed or
absent CWE keeps the current default and never throws.

**Routing only — nothing else moves.** The finding's band/severity, id hash, reasoning, and
`scan-external-sast` gate are untouched; only the `dimension` (the review heading) changes.
Both adapters keep `classify() → null`, so a routed finding owns no class and supersedes
nothing — `injection-xss` is a multi-shape dimension (SQL, OS-command, XSS, template, and
URL-scheme shapes), and an owned class would let a routed finding supersede a co-located
LLM finding of a *different* injection shape via the dimension fallback (the same
over-supersede the ReDoS adapter's design already rejects). The exact-membership check is
what keeps the co-resident findings put: CWE-939 (custom-URL-scheme authorization), CWE-22
(path traversal), CWE-798 (hardcoded credential), and CWE-693 (protection-mechanism
failure) all stay `external-sast`, locked by negative routing tests. The `njsscan` and
`code-analyzer` adapters are untouched (no captured injection finding to prove a reroute);
the XSS/template legs of `injection-xss` (CWE-79/94/643/917) and the
untrusted-deserialization / session-token-egress routings are deferred until a fixture
proves each.

Suite **62 files / 889 checks** (was 885), all green — the routed anchors (Semgrep CWE-78 →
`injection-xss` at ERROR→high; Bandit B608/CWE-89 → `injection-xss`; the taint-mode CWE-89
anchor), the exact-membership allowlist unit (`CWE-789` never reads as 78), the
negative-routing guards (CWE-939 / CWE-22 / CWE-605 stay `external-sast`), and the
non-supersession standing lock (a routed deterministic `injection-xss` finding beside an
llm-inferred finding of a different injection shape at the same locus — zero superseded; an
owned class turns it red). Mutation-proven: emptying the allowlist turns the routed anchors
red, and adding an owned `injection-xss` class fires the supersession lock.

## [0.8.57] — 2026-07-03

**The Semgrep ingest now captures the scanner's source→sink dataflow path as a
`reachabilityPath` finding attribute — the deterministic reachability substrate the later
residual-shrinking slices consume.** A Semgrep taint-mode result carries `extra.dataflow_trace`
— the ordered path the engine computed from the untrusted-input source, through each
intermediate propagation step, to the sensitive sink — and the adapter previously discarded it.
It is now normalized onto the finding as `reachabilityPath` (`source`/`intermediate[]`/`sink`,
each a `{file, line}` step; the trace's matched-text strings are deliberately dropped —
locations only) together with `reachable: true`, so a downstream consumer can see the path the
scanner already proved instead of re-deriving reachability.

**Additive only — no band change.** The attribute never enters the finding's id hash, severity,
band, or reasoning; a result without a trace (including every capture from the Semgrep CLIs
that serialize the trace to text/SARIF output only, whose `--json` omits it) attaches neither
field and ingests byte-identically to before. A malformed trace attaches nothing and never
throws — the base finding always still lands. The other eleven adapters, the class definitions,
and every severity map are untouched; the ledger schema gains the matching optional
`reachable`/`reachabilityPath` finding properties. The fixture anchoring the shape is genuine
Semgrep 1.85.0 `--json --dataflow-traces` output over a seeded request-parameter→SQL-string
sample (`acceptance/fixtures/semgrep-taint-seeded.json`).

Suite **62 files / 885 checks** (was 882), all green — the captured-trace anchor (source
`app.py:10` → intermediates `:10`/`:11` → sink `app.py:13`, schema-validated), the
additive-only lock (the existing trace-less fixtures carry neither new field, and the same
fixture with the trace removed produces a byte-identical finding minus the two attributes), and
the malformed-trace safety battery (non-object trace / missing sink / junk steps → no
attribute, base finding intact). Mutation-proven: neutralizing the trace extraction turns the
anchor check red.

## [0.8.56] — 2026-07-03

**ReDoS joins the deterministic band: the catastrophic-regex pattern substrate of
`resource-consumption-abuse` is now scanner-proven, leaving reachability as the labelled
residual.** The baseline entry's own automation note ("catastrophic regex patterns are
statically detectable") is now true mechanically: run-scans Family 7 gains a ReDoS leg —
**regexploit** (pip; `regexploit-py` for Python, `regexploit-js` for JS/TS after the one-time
`npm install` the tool itself prints) runs over every detected non-package language root, and a
new `regexploit` ingest adapter lands each vulnerable pattern as a `provenance:'deterministic'`
finding with its real `file:line` locus. The band comes from the tool's regex-ambiguity degree
(`REDOS_DEGREE_TO_FINDING`: exponential → high; the polynomial degrees → medium; an unknown
degree → medium) and is deliberately never critical/blocker from the tool alone — the scanner
proves the PATTERN backtracks catastrophically; whether attacker-controlled input reaches it
stays the audit's judgment, and the dimension doc now says exactly that at its ReDoS bullet.
Each finding is gated by `resource-consumption-abuse` (major), carries a CWE-1333 reference,
and gets a deterministic `ruleId` derived from the pattern (`redos-<sha16>`) — same repo +
pinned tool → byte-identical findings.

**The finding sits beside, never silences, the dimension's other findings.** The adapter owns
no toolkit class (`classify()` → null, the semgrep/bandit posture — not the gitleaks one):
`resource-consumption-abuse` is a multi-shape dimension (rate limits, denial-of-wallet,
algorithmic amplification), and the supersession engine's dimension-fallback match means a
class-owning ReDoS finding would have demoted a co-located rate-limit or denial-of-wallet
finding in the same file. A standing test locks the property — a co-located
`resource-consumption-abuse` LLM finding survives ingest + reconcile unchanged — and two rows
for the same regex (one deterministic, one pre-existing LLM) remain the documented safe
under-merge.

**Format C, honestly.** regexploit emits human-readable text only (no JSON output exists in the
tool), so the evidence file is its VERBATIM stdout (`evidence/redos-<date>.txt`) — never a
wrapper format that re-writes tool output. The `--all` ingest enumerates `evidence/*.json`, so
it does not auto-recognize the ReDoS evidence (a documented limitation); the explicit
`--scanner regexploit --input` form is the ingest route, stated where Family 7 and the scan-tail
ingest are narrated. The adapter's content-shape recognizer matches only the raw text shape and
declines every parsed-JSON shape, so recognizer disjointness holds across all twelve adapters.
Cold-install wiring rides the existing paths: `regexploit` joins `PIP_TOOLS` and the
`external-sast` tool-detect family (membership lines only — no executor change, no new consent
surface). `buildFinding`/`ingest`/`CLASS_DEFS` and every existing adapter are byte-unchanged.

Suite **62 files / 882 checks** (was 864), all green — adapter unit + degree-map, the
non-supersession lock, recognizer disjointness over every committed fixture including the new
genuine regexploit capture, `--all` format-C skip behavior, and the cold-install membership
checks. Mutation-proven twice: breaking the degree map turns the band checks red, and giving
the adapter an owned class turns the non-supersession lock red.

## [0.8.55] — 2026-07-03

**The artifact phase's drafted content is now written by a deterministic harness that
path-scopes every Workflow-returned output path.** The generate-artifacts Workflow's drafting
agents are read-only by design — the engine returns `{ drafted: [{ key, out, content }] }` and
the invoking skill writes each artifact to disk. Step (d) previously had the driver improvise
that extract-and-write per run; the new `harness/write-drafted-content.mjs` replaces it as the
single write point, for determinism and byte-exactness — and because `out` round-trips
**through** the Workflow, making it LLM-influenced data crossing a write boundary that nothing
validated (`build-artifact-engine` stores it unguarded; a confused or hostile
`../../../home/user/.bashrc`, `/etc/cron.d/x`, or `.git/hooks/pre-commit` — the last one
code-execution-adjacent and invisible to a naive repo-containment check — would previously have
been written wherever it said).

The path guard enforces every rule on the RESOLVED path, twice — lexically, then re-asserted on
the symlink-REALIZED tree (the deepest existing ancestor is `realpath`'d lstat-aware and the
rules re-run, so a symlinked dir pointing outside the repo, a planted symlink *file* at the
target, and a dangling link on the path are all refused, not written through): no absolute
paths, strict repo containment (`startsWith(repo + sep)` — a `/repo-evil` sibling never passes
for `/repo`), nothing at/under `.git/`, and an **allowed-roots** floor — drafted content lands
only under `docs/security-review/` or `.security-review/`, where every artifact the toolkit
drafts lives; a future artifact elsewhere is a deliberate one-line change, never a silent
write. Application is PLAN-then-EXECUTE and **all-or-nothing**: one invalid path refuses the
entire envelope with exit 2 and zero files written (a poisoned envelope must never produce
partial writes; refusals route the operator back to the artifact engine, never to hand-editing
paths). Writes are byte-exact utf8 (backticks, quotes, `$(cmd)`, unicode, no trailing-newline
"help"; overwrite is normal — artifacts regenerate per pass; idempotent re-run, same bytes).
Null/malformed entries and empty/dead-agent drafts are skipped LOUD — an agent that died never
blanks a good prior draft. The envelope unwrap follows merge-ledger's two-shape doctrine
verbatim (raw task-output envelope or pre-extracted `{ drafted }`, keyed on the payload; neither
shape → exit 2 naming both), and `--input` cross-checks the artifact-input's `gate.suppress` so
a stale or resumed envelope cannot resurrect a gate-withheld doc (the engine's pre-Workflow drop
remains the enforcement point; the WITHHELD placeholder stays driver-side — it is
gate-data-derived, not envelope content). The audit substrate needs no sibling harness: its
synthesis agent writes the pass report itself, and merge-ledger already consumes that envelope
for the ledger — there was no improvised driver-side write to replace. Engine and template are
untouched; generate-artifacts step (d) now invokes the harness (with the matching
`allowed-tools` grant).

Suite **62 files / 864 checks** (was 835), all green. The guard is graded by direct attack in
the new standing test: traversal, absolute, `.git/hooks/pre-commit` (direct and routed through
an allowed root), sibling-prefix, symlinked-dir escape, planted-symlink-file target, dangling
link, `''`, `'.'`, and NUL each refuse with exit 2 and zero files written — the valid sibling
in the same envelope stays unwritten. Byte-exactness is buffer-compared from both envelope
shapes. Mutation-proven: with the containment assert removed, the traversal check goes RED.

## [0.8.54] — 2026-07-03

**The compile reads the manifest's persisted applicable set verbatim, and `compute-sci` refuses
a stale scope manifest.** 0.8.53 fixed the applicability gate itself; two seams could still
resurrect the truncated set it closed. First, compile-submission re-derived applicability by raw
`applies_to`-vs-element intersection at three sites (the conflicting-entries collection, the
step-2 inventory filter, and the submission-package slot-suppression rule) — on a synonym-typed
manifest the compiled checklist/questionnaire/slots could silently omit the external rows (DAST,
TLS, external SAST/SCA/IaC) while the SCI gate counted them missing: a self-contradictory
compile. All three sites now read the manifest's `applicableBaselineIds` verbatim — the single
applicable-set authority, exactly the set `compute-sci` consumes; the conditionals that genuinely
branch on element types (the Desktop/Mobile sub-block suppression, the API/OAuth block) match
types through their canonical form (`ELEMENT_TYPE_SYNONYMS` — the map keeps its one home in
`render-detected-elements.mjs`, never duplicated into prose).

Second, a scope manifest written before 0.8.53 persists the truncated applicable set on disk,
and `compute-sci` consumed it verbatim — the falsely-ready failure the gate fix closed, surviving
via the persisted cache (an under-scoped set inflates the completeness % and under-requires the
blocker floor). `compute-sci` now recomputes the applicable set from the manifest's own elements
(reusing `applicable-requirements.mjs`'s exports — the same engine scope-submission ran,
canonicalization included; that file itself is untouched) against the baseline it already reads,
and on any set difference — order-insensitive, duplicate ids ignored, a missing/empty stored
array with a non-empty recompute included — refuses with a distinctive `STALE SCOPE MANIFEST`
block (stored vs recomputed counts + a sample of the missing ids) and **exit code 2**, routing to
a `/sf-security-review-toolkit:scope-submission` re-run. It never adds, removes, or substitutes
ids in a passing run — the stored set under-requires, and a silent substitution would mask the
drift. A fresh manifest (stored == recomputed) computes **byte-identically** to 0.8.53 on both
the text and `--json` paths (verified against the prior engine on fresh synonym-typed, fresh
canonical, empty-manifest, and no-manifest fixtures). The same check also catches a baseline
changed by a plugin upgrade after the manifest was scoped. Both drivers (compile-submission,
security-review-journey) document the refusal and its re-scope routing.

Element-type synonym notes landed across the remaining consumers: reviewer-simulation's
challenge filter, prepare-test-environment's component selection, run-scans' family-applies
column (covering every per-family *Applies when:* line), and stay-listed's staleness gate — the
latter now reads `applicableBaselineIds` verbatim instead of re-intersecting `applies_to`. The
journey's artifact step likewise reads the persisted set verbatim instead of narrating an
`applies_to` match.

Suite **61 files / 835 checks** (was 827), all green. The staleness check is mutation-proven
(check removed → the truncated set silently computes → RED). The new checks: stale synonym-typed
manifest → exit-2 refusal naming both counts on both output paths; fresh manifest passes, with a
synonym scope computing the same SCI as its canonical twin byte-for-byte; shuffled/duplicated
stored order → NOT stale; missing stored array → stale; a whitespace-padded element type → NOT
stale (types are trimmed to mirror the producer path, so stray whitespace can never
false-positive the refusal); prose wiring for the three compile sites + the journey routing +
the four canonical-form notes. Standing-test fixtures that pin arbitrary stored id sets now
carry internally consistent manifests, so the pinned layers cannot trip the new refusal as the
baseline grows.

## [0.8.53] — 2026-07-02

**The applicable-requirements gate now canonicalizes element-type synonyms — a synonym-typed
external app requires the SAME controls as `external-endpoint`.** 0.8.52 taught the scan-status
render to recognize the external-source synonyms, but the go/no-go gate still keyed the raw
manifest type: `computeApplicable` matched `applies_to` tokens against the element strings
verbatim, so an `external-web-app` scope computed **27 fewer** applicable requirements than
`external-endpoint` (86 vs 113 against the current baseline) — silently dropping the external
SAST/SCA/IaC scan requirements, the DAST set, and the `endpoint-*` controls, six of them
blocker-severity (`endpoint-ssl-labs-a-grade`, `endpoint-third-party-testing-consent`,
`endpoint-review-scanner-ip-allowlist`, `dast-self-run-required`, `dast-authenticated-scans`,
`testenv-external-test-instances`). `applicableBaselineIds` feeds `compute-sci`'s blocker floor
and completeness %, so a synonym-typed external app could read falsely ready with its
external-endpoint controls never required — a scoping-correctness gap: where the 0.8.51 fix
stopped the verdict over-counting blockers, this one stops it under-requiring controls.

The fix reuses the single synonym home shipped at 0.8.52 (`canonicalElementType` /
`ELEMENT_TYPE_SYNONYMS` in `render-detected-elements.mjs` — the map is NOT duplicated) at ONE
chokepoint: `computeApplicable` canonicalizes every incoming element type (lowercased first, so
the gate's existing case-insensitivity extends to synonyms), so every caller benefits — the CLI
manifest path, the `--elements` arg path, and `renderApplicable`. Conservative by construction:
an unknown type passes through unchanged (it can never spuriously ADD requirements), a canonical
scope computes byte-identically to before, and the synonym scope EQUALS the canonical set —
never a superset. `render-scope-summary`'s element sort additionally ranks a synonym under its
canonical slot, matching the detected-elements table (sort-only, no gate effect; the manifest's
own type string still renders verbatim — honest provenance). `compute-sci` itself is untouched —
it consumes the corrected applicable set from upstream.

Suite **61 files / 827 checks** (was 818), all green. The 9 new checks are mutation-proven (gate
canonicalization removed → the synonym scope under-computes 86 vs 113 → RED; sort-rank
canonicalization removed → the synonym element sorts last → RED), headed by the equality pair:
an `external-web-app` scope computes EXACTLY the `external-endpoint` applicable set (the 27
dropped requirements restored, the blocker-severity six among them), every synonym in the map
computes its canonical type's exact set, canonical scopes stay byte-identical to the
pre-canonicalization gate, an unknown type (`blockchain-widget`) adds nothing, and the recorded
manifest elements stay verbatim (the partner's own strings, unaliased).

## [0.8.52] — 2026-07-02

**The scan-status render now recognizes external-source element-type synonyms — a family that
RAN reads DONE, not N/A.** The scope manifest is LLM-authored, so a real run can type the
external backend element with a reasonable synonym (`external-web-app`) instead of the
canonical `external-endpoint`. `render-scan-status.mjs` gated each family's applicability on
the raw manifest type, and `familyStatus` short-circuits an inapplicable family to N/A before
looking at the evidence — so Families 3 (DAST), 4 (TLS), 7 (External SAST), and 8 (External
SCA + IaC) read **N/A** even with SATISFIED, reviewer-reproducible reports on disk.

`render-detected-elements.mjs` (the owner of the canonical element vocabulary) now exports a
conservative `canonicalElementType` helper over a frozen `ELEMENT_TYPE_SYNONYMS` map — the
SINGLE home for the aliasing: `external-web-app` / `external-web` / `web-app` / `external-api`
/ `web-api` → `external-endpoint`, and nothing else. It never maps into `managed-package` /
`mcp-server` / `agentforce` (distinct surfaces), and only an exact string match aliases: an
unrecognized type — or any non-string value a JSON manifest can carry — is returned unchanged,
so an unknown type stays unknown, never misclassified as external, and a malformed element
type can never crash the render. The scan-status
`Applies` gate normalizes each element type through it, so a synonym-typed manifest renders
byte-identically to the canonical one; a manifest already using the canonical vocabulary
renders byte-identically to before. The detected-elements table additionally sorts a synonym
element under its canonical slot (the manifest's own type string still renders verbatim —
honest provenance). Applicability gating only: evidence matching, dispositions, and every
other status path are untouched.

Suite **61 files / 818 checks** (was 814), all green. The 4 new checks are mutation-proven
(alias removed → the synonym manifest reads N/A → RED; an unknown type force-aliased → the
no-false-alias guard → RED), headed by the equivalence pair: an `external-web-app` manifest
with satisfied external-family evidence renders Families 3/4/7/8 DONE and byte-identical to
the `external-endpoint` render, while a `blockchain-widget` manifest never turns them on.

## [0.8.51] — 2026-07-02

**Deterministic-band dispositions now flip the ledger, so the verdict counts the real
blockers — B3a.** `ingest-scanner-findings.mjs --all` lands scanner findings in the ledger as
`status:'confirmed'` (relayed verbatim — correct), and on a real cold run the audit then
adjudicates much of that band as false-positive — but only into the FP-dossier PROSE. Nothing
flipped the ledger status, so every status consumer (`finding-clusters.mjs --headline`, the
`compute-sci.mjs` blocker floor and disposition vector) kept counting the adjudicated noise as
open blockers and the headline over-stated (e.g. "4 critical / 112 high" where the real
blockers were a handful). New `harness/apply-dispositions.mjs` closes the gap: the audit
records each deterministic-class adjudication as STRUCTURED data in
`<target>/.security-review/deterministic-dispositions.json` (`engine` + `ruleId` +
`disposition: refuted|accepted_risk` + `reason` [+ `accepted_risk_justification` when
accepted, + optional `scope.files`]), and the harness — pure, idempotent, a structural twin of
`reconcile-provenance.mjs` — flips the matching `provenance:'deterministic'` findings out of
the open band with an auditable `disposition_reason` (declared additively in the ledger
schema), keeping provenance/engine/ruleId/class/severity intact.

The honesty-preserving core: a disposition can only ever move a DETERMINISTIC finding OUT of
the open band. It NEVER flips an `llm-inferred` finding (a disposition cannot hide an
LLM-confirmed blocker), never moves anything INTO the open band, never sets `fixed`; the match
is EXACT engine+ruleId (never fuzzy), protected states (`fixed`/`accepted_risk`/`superseded`)
are never overwritten, `accepted_risk` requires its justification (schema-valid), and a
disposition matching nothing is a reported no-op. There is deliberately NO hardcoded
auto-refute ruleset — a rule that is usually noise can be a real bug in some code; the
adjudication stays the audit's labelled semantic call, only the APPLICATION is deterministic.
The FP dossier and the ledger refutation derive from the SAME disposition entry (run-scans
Step 10 now mandates it), so they can never diverge.

Wiring: audit-codebase Step 6 runs it after `merge-ledger` → `reconcile-provenance` and before
the Step-7 recap re-render; the run-scans Step 9b `--all` + reconcile tail runs it too, so a
standalone scan pass's band is honest; the journey's blocker gate notes the headline now reads
the dispositioned band. The recap gains a deterministic-band line (`N open · M dispositioned
by adjudication`) rendered only when the ledger carries scanner findings — the drop from the
raw deterministic band to the adjudicated blockers is visible and auditable, never a silent
shrink.

Suite **61 files / 814 checks** (was 60 / 788), all green. The 26 new checks
(`test-apply-dispositions.mjs`) are mutation-proven, headed by the safety pair: allow flipping
an `llm-inferred` finding → RED, and skip the apply → the SCI/headline still report the
inflated count → RED (the verdict-honesty integration drives the real
`apply-dispositions` → `finding-clusters`/`compute-sci`/`render-recap` CLI sequence on a tmp
ledger).

## [0.8.50] — 2026-07-02

**The scratch-org lifecycle is now an engine, not an improvisation — B2-P2, the last B2
slice.** The deployed-org deep audit stands the package up in a throwaway scratch org, and
until now the `sf org create scratch` / `sf org delete` calls around that were hand-scripted
inline in skill prose on every run — the same live-op fragility the scanner-dir
(`install-scanners`) and server-tier (`standup-stack`) engines already retired.
`harness/standup-org.mjs` + `harness/teardown-org.mjs` are the org tier of that pattern: a
PURE planner (`planStandupOrg` — toolkit-scoped alias `sf-srt-org-<runId>`, a Developer +
`Einstein1AIPlatform` default definition or the caller's own `--def-file`, `--no-ancestors`,
duration clamped to a sane bound) + a fail-closed executor that records a resource manifest
of exactly what it created — NAMES/IDS only (alias, username, orgId): the create's raw
`--json` output carries an access token, which is parsed out and discarded, never persisted.
`--dry-run` writes the `planned` manifest and performs no live op.

The teardown half is the high-stakes piece: `sf org delete` is IRREVERSIBLE, so every delete
is gated on `assertOrgAlias` — the fully-anchored `sf-srt-org-` convention, asserted BEFORE
any plan is returned or any `sf` call runs, on every path including standup's own
crash-cleanup delete. A tampered manifest, a production alias, a Dev Hub, a value that
merely contains the prefix, a trailing-newline smuggle — all REFUSE, removing nothing; there
is no bare `--target-org` fallback. The teardown is asymmetric (keeps every evidence file,
removes the org + tmp dir), idempotent (an absent org is `already-clean`), and honest at its
edges: an unavailable `sf` CLI is NOT read as "the org is gone" — when the manifest records
a really-created org, the engine refuses to destroy the teardown record and reports
`failed`, never a false success over a live org; a pointer whose tmp manifest was cleared
(a reboot mid-multi-day org) still tears down by its guarded alias instead of claiming "no
org stood up"; a path-escaping `--run-id` is refused as invalid; the pointer rewrite is a
strict field allowlist. `--sweep` clears toolkit orgs left behind by a crashed run, strictly
name-scoped — and documented as MACHINE-WIDE across toolkit orgs (it cannot tell an orphan
from another session's in-flight run), so it is for quiet machines only.

**No new consent — and consent is doubly coupled:** both ops already classify to the
recorded `sf-deep-audit-ops` gate, both executors verify that same token (the flag alone is
insufficient), and the teardown additionally requires the recorded consent of the org's
ORIGINATING repo (the manifest records which repo stood the org up) — a token recorded in
some other repo, or the cwd, never authorizes deleting another run's org. **Dev Hub
authentication stays owner-interactive:** the engine detects a missing hub and degrades
honestly (`no-devhub`); it never authenticates and stores no credential. The four deep-audit
skills (`bootstrap-cli-auth`, `install-and-verify-package`, `build-managed-package`, the
journey's deep-audit step) now invoke the engines instead of improvising the lifecycle — a
born-clean engine-created scratch org is pristine by construction, collapsing the
contamination-teardown improvisation for the scratch path; the build/install/audit/
mcp-teardown steps themselves are unchanged. `assertSafeTmpRoot` additionally rejects the
bare `sf-srt-org` grouping dir, like the scanner/stack/dast tiers.

Suite **60 files / 788 checks** (was 58 / 768), all green — and hermetic BY CONSTRUCTION:
the sweep check runs the CLI in a spawned process with a stubbed `sf` on PATH and an
isolated TMPDIR, so the standing suite can never touch a real org or a real run's manifests.
The 20 new checks are mutation-proven (24 mutations, each driving its expected RED in a
throwaway checkout, every check covered), headed by the name-guard battery: dropping the
`assertOrgAlias` call in `planTeardownOrg` → a foreign alias is accepted → RED; removing
either regex anchor → contains-the-prefix / newline-smuggled aliases pass → RED. The live
`sf org create/delete` is operator-cold-validated, not CI-hermetic — the standing tests pin
the pure planners, the consent fail-closed + origin-repo coupling, the dry-run purity, the
names-only manifest, and the alias name guard, which are what regress silently.

## [0.8.49] — 2026-07-02

**The compose loopback boundary now covers `network_mode`.** The 0.8.48 stand-up confines a
compose throwaway by rewriting each service's published `ports:` — the right lever for
port-based publishing, but not for namespace sharing: under `network_mode: host` a service
binds the host's interfaces directly and Compose ignores its `ports:` entirely, so the
generated `!override`/`!reset` would be a silent no-op and the service could sit on the
host's public interface for the throwaway's lifetime. `planCompose` now REFUSES the whole
compose stand-up when any service declares `network_mode: host`, `container:<name>`, or
`service:<name>`, with an honest reason naming the service and mode — the same
refuse-don't-guess posture as the ambiguous-web-tier refusals (forcing bridge networking
via the override could break the partner's app; refusing is the safe move). The guard runs
BEFORE web-tier selection, so a host-networked service that itself declares the web port
can never be picked and templated into a no-op override — and a host-networked service
with no `ports:` at all gets the real reason (host networking), never the misleading
no-publisher one. Absent / `bridge` / `default` / `none` stand up exactly as before: they
stay inside the port-publishing model the override governs. Nothing else changes — the
web-tier pick, override templating, ambiguity refusals, executors, teardown, and every
other recipe kind are untouched; no new consent.

Suite **58 files / 768 checks** (was 58 / 767), all green; the new check mutation-proven
three ways (the guard dropped → red; the guard moved after web-tier selection → the
no-`ports:` host-networked config surfaces the no-publisher reason instead of the real
one → red; the guard scoped to only the non-web services → a host-networked web tier
slips through to a no-op override → red) and guarded against over-refusal
(`bridge`/`default`/`none`/absent must still produce the loopback override).

## [0.8.48] — 2026-07-02

**`compose` backends now stand up as throwaway-DAST mirrors — the last recipe kind in the
detector that couldn't.** Most real external backends ship a compose file (the app plus its
own db/redis), and compose breaks the single-container model in two ways, both handled:

- **Loopback isolation across N containers.** A compose file's own `ports:` typically bind
  all interfaces. The stand-up resolves the file through docker's OWN parser
  (`docker compose config --format json` — the harness still bundles no YAML library), and
  the pure `planCompose` picks the web tier (the service publishing the detected web port)
  and templates a loopback override: the web service is rebound to `127.0.0.1:<port>` and
  EVERY other service's host ports are stripped. The `!override`/`!reset` REPLACE tags are
  load-bearing — a plain `ports:` in an override file CONCATENATES with the base file's
  list and would leave the original all-interfaces publish alive next to ours. Internal
  services still reach each other on the compose network; nothing but the web tier ever
  reaches the host, and only on `127.0.0.1`. When the web tier cannot be identified safely
  (several services publish ports, none matches the detected web port), the stand-up
  REFUSES with an honest reason rather than guessing — a mis-identified web tier would
  publish the wrong service to the host. Service names that cannot be templated safely
  into the override are refused the same way.
- **Project-scoped teardown.** The project runs under the toolkit run-name
  (`-p sf-srt-stack-<runId>`), so `teardown-stack` removes it as ONE
  `docker compose down -v --remove-orphans` — all project containers + the network +
  volumes, atomically, no per-name enumeration — and the project NAME must pass the
  toolkit-name guard BEFORE any `down`: a tampered manifest can never tear down a foreign
  compose project. The orphan sweep now also removes crashed-run compose networks and
  volumes, name-scoped to the same `sf-srt-stack-` convention.

Every kind-agnostic safety property holds for compose unchanged: fail-closed without
consent (the same `throwaway-dast` gate — no new consent), secrets as NAMES in the plan +
manifest with values only via `0600` env-files (compose interpolation, never argv), the
needs-secrets filled-env-file re-check, no `docker compose logs` capture, the
signal-handler cleanup net (a project-scoped `down`), and the pre-`up` name-stub manifest
so even a crashed stand-up stays teardown-able. Without Compose V2 the engine degrades
honestly (`no-compose` + an install hint; the legacy `docker-compose` V1 binary is not
used). `procfile` remains the honest unsupported set. The `node`/`python`/`dockerfile`
plans + executors and the single-container teardown path are unchanged.

Suite **58 files / 767 checks** (was 58 / 760), all green; each new check mutation-proven
(the override rebound to all-interfaces → red; the `127.0.0.1` host part omitted → red;
another service's ports left published → red; the REPLACE tags downgraded to a plain
merge → red; a guessed web tier on ambiguity → red; the project-name assertion dropped
before the `down` → red; a project off the run-name convention → red; the
unsafe-service-name refusal dropped → red; compose silently returned to the unsupported
set → red). The live `docker compose config`/`up`/`down` execution is
operator-cold-validated like the other kinds — the standing tests pin the pure plan
(loopback override + refuse-on-ambiguity) and the pure teardown boundary (the
project-name guard), which are what regress silently.

## [0.8.47] — 2026-07-02

**The api-endpoints spec artifact is now REAL when the throwaway mirror runs — captured from
the framework itself, container-isolated, never from prod.** The reviewer requires an
OpenAPI/endpoint spec generated from the framework, never hand-authored; until now, when the
live server wasn't reachable, `generate-artifacts` fell back to a code-derived spec marked
`PENDING live capture`. But the throwaway-DAST chain already stands the partner's backend up
as an isolated mirror on `127.0.0.1` (synthetic secrets, loopback-only publish) — a reachable
server the toolkit itself controls. The new `harness/capture-openapi.mjs` reads the spec from
THAT, so the real framework spec (paths, schemas, identity endpoints) becomes evidence without
running partner code on the host and without ever touching prod:

- **Read-only, loopback-only, no new consent.** A benign GET of the framework's default spec
  locations (`/openapi.json` first; a fixed, documented, JSON-only candidate order) while the
  mirror is up. The planner shares run-dast's exact URL pre-filter + LOOPBACK host set — ONE
  definition of the loopback-only invariant — and REFUSES any non-loopback base url; the
  executor re-asserts the same check on the plan it actually runs, and candidate paths must be
  bare rooted paths (never a full URL that could re-aim the GET). The capture rides on the SAME
  recorded `throwaway-dast` consent that stood the mirror up (verified exactly the way run-dast
  verifies it) and fails closed without it.
- **A validated spec or nothing.** `validateSpec` accepts only a JSON body carrying a
  top-level `openapi` 3.x / `swagger` 2.0 version key AND a `paths` object — an HTML error
  page, a 404 body, or `{}` (a hardened always-200 endpoint) is never mistaken for a spec. On
  the first valid candidate the spec lands in `evidence/openapi-<date>.json` (re-serialized
  from its own parse — raw response bytes/headers are never persisted) with a provenance
  sidecar naming the source (`container-isolated-throwaway-mirror`), the mirror url, the
  synthetic-secrets note, and prod-equivalence as **PENDING owner attestation** — never
  asserted. No valid candidate → `not-exposed`, nothing written, the code-derived artifact
  stands.
- **Wiring.** The journey's throwaway-DAST chain invokes the capture after `standup-stack`
  reports the mirror up and before `teardown-stack`; `generate-artifacts` Step 3 emits a
  mirror-captured spec as the real `artifact-api-endpoints-spec` with `PENDING` scoped to the
  prod-equivalence attestation line ONLY (never the whole artifact, and never presented as the
  production spec) — the code-derived + `PENDING live capture` fallback is byte-for-byte the
  honest behavior it was for runs with no capture; run-scans' DAST scope (Schemathesis + the
  ZAP OpenAPI import) consumes the emitted artifact exactly as before, now fed by a real spec.

The live capture GET is operator-cold-validated (it needs a running mirror), like run-dast's
ZAP run — the standing tests pin the pure planner/validator/provenance envelope and the skill
wiring, which are what regress silently.

Suite **58 files / 760 checks** (was 57 / 746), all green; each new check mutation-proven
(the loopback guard dropped → the refusal checks go red, planner and executor both; a
validateSpec that accepts any parseable JSON → the hardened-always-200 check goes red; the
PENDING-prod-equivalence line dropped or the source flipped to `production` → the provenance
check goes red; the consent throw removed → the fail-closed check goes red; the capture
invocation moved after teardown or removed → the journey order check goes red; the run-scans
grant removed → the grant check goes red; the generate-artifacts consumption or the preserved
fallback text removed → the artifact-wiring check goes red).

## [0.8.46] — 2026-07-02

**The throwaway stand-up now covers `python` and `dockerfile` recipes.** The throwaway-DAST
engine (`stack-detect` → `standup-stack` → `run-dast` → `teardown-stack`) could only stand up
a plain `node` backend — every other recipe kind `stack-detect` emits came back `unsupported`,
so a FastAPI/Flask/Django API (the most common external-API shape, and the OpenAPI critical
path) or a repo shipping its own Dockerfile (the most prod-faithful single-container option)
had no autonomous throwaway mirror to scan. `standup-stack` now plans and executes both:

- **`python` (copy-in)** — the direct analogue of `node`: a pinned `python:3.12-slim` base
  (never `:latest`, the same pinning discipline as `node:18-alpine`), the source copied into
  the container, and a deterministic install-then-run command that is a pure function of the
  recipe — pip from `requirements.txt` when the recipe root has one, else
  `pyproject.toml`/`Pipfile` (`pip install .`), else no install (resolved by the shell inside
  the container so the planner stays pure); then `manage.py` → the Django dev server,
  `asgi.py`/`wsgi.py` → uvicorn/gunicorn on the conventional `<module>:application`, anything
  else → `python <entry>` with HOST/PORT in the env. Every variant binds `0.0.0.0` INSIDE the
  container only — the host publish stays `127.0.0.1`.
- **`dockerfile` (build-then-run)** — builds the partner's own Dockerfile into an image
  carrying the toolkit run-name (`sf-srt-stack-<runId>:throwaway`), so the existing
  name-scoped teardown accepts and removes it with **zero teardown-logic change**; the built
  image is recorded in the manifest from the pre-create name-stub on, so even a crashed build
  stays teardown-able (and the name-scoped sweep catches any residue).

Every safety property is kind-agnostic and holds for the new kinds: fail-closed without
consent, the `127.0.0.1`-only host publish, secrets as NAMES in the plan + manifest with
values only ever in the `0600` `--env-file` (burned at teardown), the needs-secrets
filled-env-file re-check, the no-docker graceful hint, the signal-handler cleanup net, and
the deliberate no-`docker logs`-capture. The `node` plan + executor logic is unchanged.
`compose` stays honestly `unsupported` — it is multi-container and needs a project-scoped
teardown extension, so it is the next slice (`procfile` likewise); the unsupported reason now
names exactly what this build stands up. The live docker execution for the new kinds
(pip + run, build + run) is operator-cold-validated like the node path — the standing tests
pin the pure plans and the teardown boundary, which are what regress silently.

Suite **57 files / 746 checks** (was 57 / 740), all green; each new/changed check
mutation-proven (python or dockerfile reverted to `unsupported` → the plan checks go red; a
skewed run-command mapping → the pure-function check goes red; a secret value leaked into a
new-kind plan → the NAMES-only check goes red; a consent bypass on a new kind → the
kind-agnostic-gates check goes red; a silent compose branch → the honest-boundary check goes
red; an off-convention built-image name → the teardown boundary check goes red).

## [0.8.45] — 2026-07-02

**The journey now runs the static scanner substrate BEFORE the LLM audit.** On a full run the
drive order was scope → audit → artifacts → scans, so the first audit pass ran without the
deterministic scanner findings: those families sat PENDING in the completeness index until the
scan phase ran at the tail, and folding them in cost a second, fully-priced audit pass. The
order is now scope → static scans → audit → artifacts → live/conditional scans — the
host-independent families run first, the audit's `--all` ingest seeds the deterministic band on
the FIRST pass, and the re-audit double-cost is gone. A focused, test-backed change:

- `skills/security-review-journey/SKILL.md` — a new "Static scans (the static-scan substrate)"
  step before the audit (Code Analyzer CRUD/FLS + sharing, external SAST, SCA + IaC, secret
  scan, dependency audit); the consented scanner install runs before it; the Scans step becomes
  the live/conditional tail (DAST plan + throwaway DAST, portal prediction, host-grade TLS,
  the ingest tail), with `cleanup-scanners` staying at end-of-run; the frontmatter description,
  audit-step rationale, smart-resume table, and recap all tell the same order story. Consent
  posture unchanged: same gates, same ask points, fail-closed the same way — local TLS joins
  the static pass only when a reachable host's read-only live-probe consent is already
  recorded, a declined scanner install leaves those families `PENDING-OWNER-RUN`, and an
  absent scanner never blocks the audit (its findings stay `llm-inferred`).
- `skills/run-scans/SKILL.md` — the explicit static/live partition over the eight families and
  the two journey entry modes (the static substrate needs only the scope manifest; the
  endpoint-inventory prerequisite belongs to the DAST/live tail); a standalone invocation with
  no mode stated is the unchanged full sweep; the Step 9b `--all` ingest + reconcile is
  documented as idempotent at every entry point (substrate tail, live tail, audit pass).
- `skills/audit-codebase/SKILL.md` — the ledger digest is now compiled AFTER the deterministic
  pass (Steps 4/4b swapped), so the freshly-seeded deterministic band is in the digest the
  fan-out reads and the finders defer to it on the FIRST pass instead of re-reporting what the
  engines already own; a populated `evidence/` dir is documented as the normal
  first-journey-run case, with the absent-engine contract in force verbatim
  (`PENDING-OWNER-RUN`, never LLM-fill, never drop; the LLM keeps its findings `llm-inferred`).
- `harness/render-router-status.mjs` — a new resume-ladder rung: evidence WITHOUT an audit
  ledger now resumes at the audit (the static substrate ran; the audit is next), never at
  compile; evidence WITH a ledger keeps the unchanged compile path.
- `README.md` flow diagram, `docs/deterministic-findings-acceptance.md`, `CONVENTIONS.md`, and
  `docs/INDEX.md` reconciled to the new order. The skills keep their canonical phase
  identities (scope Phase 0, audit Phase 1, run-scans Phase 3) — the journey's drive order is
  what changed.

Suite **57 files / 740 checks** (was 57 / 736), all green; each new check mutation-proven
(reintroduce the old order → RED): W12 journey drive order + negative assertions on the removed
old-order rationale, W13 digest-after-deterministic-pass, W14 the run-scans partition + entry
modes, RR6 the resume-ladder rung.

## [0.8.44] — 2026-06-30

**Audit-engine robustness — two real failures a live 40-agent cold-run fan-out hit, where a
sub-agent on the `resource-consumption-abuse` dimension exhausted the StructuredOutput retry cap
(per the Workflow tool's semantics `agent()` returns `null`, it does NOT throw).** Both fixes are
on the audit substrate + its mechanical ledger/recap; no change to any dimension's threat content.

**BUG A — a dimension's FIND-stage failure silently dropped its coverage (correctness).**
`harness/workflow-template.mjs` already handled a per-FINDING verify failure (retry once → a null
verdict → the finding is kept `unverified` and surfaced). But a per-DIMENSION *find*-stage failure
was invisible: a null find `result` flowed into `findings = []` → `return []`, so the dimension
contributed **0 findings AND 0 unverified**, and `perDimension.flat().filter(Boolean)` then dropped
any wholly-null entry. A crashed finder was therefore indistinguishable from one that ran clean and
found nothing — the run reported "0 unverified" and the `denial-of-wallet` headline lead
vanished from the verdict entirely. **Fix:** the verify stage now emits a `{coverageFailed:true}` marker when
the find `result` is null (a non-null result with `findings:[]` stays a genuine clean 0-findings
dimension). A new PURE `computeCoverage(perDimension, dimensions)` reconciles the raw per-dimension
output — markers PLUS any wholly-dropped (null-by-index) dimension — into a `coverageFailed` list
kept OUT of confirmed/refuted/unverified, and the `log` + synthesis envelope now state, loudly,
`N dimension(s) had a coverage FAILURE (finder crashed) — re-run: <keys>` (the count is NON-ZERO
when a finder crashed). The envelope carries `coverage_failed`; `merge-ledger.mjs` persists it in the
pass object (added to `templates/audit-ledger.schema.json`), a pass with a coverage failure is never
`dry` (so it can't satisfy the stop rule), and `render-recap.mjs` surfaces **Coverage INCOMPLETE —
re-run X** and NEVER a clean PROCEED over a crashed dimension (the `--target` re-render too).

**BUG B — the dirty-dimension RE-RUN crashed on the auto-injected always-on dimensions (recovery).**
The recovery for A is a targeted re-run of the failed dimension — and it was broken.
`harness/build-audit-engine.mjs` auto-injects the three always-on dimensions (`sessionid-egress`,
`secrets-credentials`, `error-handling-disclosure`) when the driver's scope-input omits them
(exactly the re-run case), and it did so with `targets: ''`. `workflow-template.mjs` then **threw**
`dimension entry missing key/targets/finderPrompt` (its `!d.targets` check), killing the whole
re-run before the first finder — in the live run the driver only recovered by hand-writing a
one-off `build-rerun.mjs`. **Fix (defense in depth):** build-audit-engine injects a NON-EMPTY
full-tree target (`FULL_TREE_TARGET = '.'`) — an empty target would also scan nothing even if the
template didn't throw — and the template's validation now requires only `key && finderPrompt`
(`targets` optional: empty / `.` means full-tree), with the finder prompt scoped to "scan the entire
repository tree rooted at <repoRoot>" for a full-tree dimension. Because that relaxation turns the
pre-0.8.44 loud crash into silent acceptance, build-audit-engine now WARNS loudly when a NORMAL
(non-always-on) dimension arrives with empty targets — it will be audited as a full-tree scan, which
for a focused dimension usually means the driver forgot to resolve its targets (a hand-written
scope-input.json that bypassed audit-codebase's `unresolved` target-map flag); always-on dimensions
are full-tree by design and stay silent. `skills/audit-codebase/SKILL.md` documents that a targeted
re-run carries the always-on trio forward with their pass-1 targets when available, else the
deterministic full-tree default — assembling and launching with no empty-targets crash and no LLM
improvisation.

**Tests:** a NEW `test-coverage-accounting` (+8) slices the pure helpers out of the template source
(it can't be imported — its top-level `return` is legal only in the Workflow runtime) and exercises
the EXACT live code path: `isFullTree`, `isValidDimension` (accepts the always-on full-tree default,
rejects no-key/no-finderPrompt), and `computeCoverage` (a null entry + a crash-marker + normal
results → both dimensions in `coverageFailed`, excluded from confirmed/refuted/unverified; clean-find
vs crashed-find distinguished) + a live-wiring guard; `test-build-audit-engine` +2 (B1: always-on
carry a NON-EMPTY full-tree target + every assembled dim satisfies the build-side invariant; B2: a
driver-provided normal dimension with empty targets warns loudly, never a silent full-tree
broadening, while always-on stays silent); `test-render-recap` +4 (RC8–RC11: coverage-incomplete
forces a non-clean verdict, HALT still names the crashed dimension, no-failure unchanged, merge
wiring); `test-merge-ledger` +1 (M16: `coverage_failed` lands in the pass object end-to-end, blocks
`dry`, the recap stdout surfaces coverage-incomplete).
Suite **57 files / 736 checks** (was 56 / 721), all green; each new test mutation-proven (revert the
fix → its test RED). NON-BREAKING: the always-on stackNotes + the LLM threat content are unchanged;
`coverage_failed` is additive + non-required in the schema (ledgers written before 0.8.44 still
validate); the recap/merge changes are inert when no finder crashed (existing tests green unchanged).
The live fan-out coverage-failure + re-run behavior is operator-validated (this cold run), not
CI-hermetic — the Workflow fan-out isn't CI-runnable, so the tests pin the pure logic the bugs live
in. Tag stays **HELD**.

## [0.8.43] — 2026-06-30

**Preflight / detection-accuracy / gate-clarity hardening — four clear-cut gaps a live cold run
against a real nested-SFDX multi-package repo surfaced.** The target carried nested SFDX packages in subdirectories, plus an MCP server, Canvas, and Agentforce,
with `sf` deliberately absent (the cold-install path). None of these touch the consent-safety floor
structurally (that consolidation is a separate designed slice) — they are detection-accuracy + gate-
message clarity, all additive on the harness. **(1) NESTED-SFDX discovery** (`harness/package-readiness.mjs`):
the pure `packageReadiness` core was correct, but `main()` read only the ROOT `sfdx-project.json`, so a
repo whose packages live in subdirectories returned `no-package` and the journey only recovered by
LLM-grepping + re-running per-dir. New exported `discoverPackages(target)` finds every `sfdx-project.json`
under the repo at a bounded depth (≤4, skipping `node_modules`/dot-dirs), runs `packageReadiness` on each,
and returns `[{dir, relPath, readiness}, …]`; `main() --json` keeps the legacy single-package top-level
shape (a single root package emits unchanged keys — render-preflight + scope-submission read those) and
ADDS a `packages[]` array + an `anyInstallable`/most-actionable roll-up, always. `scope-submission`'s
managed-package + Agentforce detection greps now recurse too (not a root-only `force-app`). **(2) READY-
without-precondition** (`harness/render-preflight.mjs`): the deployed-org power-up line read "READY
(installable)" purely from package-readiness while `sf` was ABSENT — but the deep audit can't run a step
without first installing + authing `sf`. The renderer now folds the `sf`-presence fact (already in the
tool-detect JSON it consumes) into that line: installable + sf-present → "READY (installable)";
installable + sf-absent → "READY — pending sf install + Dev Hub auth". No new enum state; only the
installable+sf-absent case is qualified. **(3) Deterministic version readout** (`harness/install-scanners.mjs`):
the run reported "code-analyzer 5.13.0" while the pinned 5.14.0 was actually installed — the misreport
came from an LLM-read `sf plugins`. New exported `readCodeAnalyzerPluginVersion(baseDir)` reads the
installed plugin's `node_modules/@salesforce/plugin-code-analyzer/package.json` version (null on any read
failure, never crashes); the `code-analyzer-stack` executor records it on the manifest record as
`rec.plugin = { name, pinned, installed }` (additive field). `run-scans` Family 1 + `audit-codebase` now
say to report the version from that manifest record, not an ad-hoc `sf plugins`. **(4) Gate-message
clarity (PROSE only, NOT the structural consolidation):** the deep-audit power-up offer and the scanner-
install gate now CROSS-REFERENCE each other's `sf` — the deployed-org deep audit installs an AUTHED,
GLOBAL `sf` (for the scratch-org stand-up), distinct from the UNAUTHED, TMP `sf` the scanner-install gate
provisions inside `code-analyzer-stack` for the static CRUD/FLS Code Analyzer (journey + render-preflight,
both directions); and `gate-spec`'s audit-tier CONFIRM variant + `audit-codebase` Step 2 now frame the
recorded-tier stop as authorizing the LAUNCH (the fan-out token spend, plus the target-map approval that
follows), NOT a tier re-election. **Tests:** `test-package-readiness` +4 (nested discovery + roll-up +
single-root legacy-shape preservation + zero-package byte-identical text), `test-render-preflight` +1
(PF7 installable+sf-absent qualifier, non-vacuous flip), `test-install-scanners` +1 (CA9 version-read
helper, hermetic), and a new `test-gate-message-clarity` (+6 — journey/render-preflight prose cross-refs
+ gate-spec functional authorize/launch framing + the first-pass-menu-stays-election non-vacuity guard).
Suite **56 files / 721 checks** (was 55 / 709), all green; each new test mutation-proven (revert the fix →
its test RED). NON-BREAKING: `packageReadiness` pure core byte-unchanged, the single-root `--json` shape
preserved (render-preflight + scope-submission tests still green), the install-scanners change is one
additive manifest field (the pip/npm/git/binary + code-analyzer-stack install LOGIC byte-unchanged). Tag
stays **HELD**.

## [0.8.42] — 2026-06-30

**Code-Analyzer cold-install CLOSE-OUT — the headline security guard (JDK verify-before-extract,
fail-closed) gets EXECUTOR coverage; a defense-in-depth name guard; a run-scans deterministic-band
clarity fix (docs/roadmap-deterministic-findings.md §5).** The 0.8.41 cold-install slice shipped the
`code-analyzer-stack` executor, but its tests drove only the PURE planner + a `dryRun:true` disclosure
(the lone real-execute CA path) — the IMPURE JDK sha256-**verify-before-extract** (the slice's headline
security property) had ZERO standing coverage, and the `code-analyzer-stack` `resolveTool` branch was the
only install method WITHOUT a tool-name allow-list. This slice closes those gaps, additive-only on the
harness. **(A) `CA7` — hermetic executor proof of the JDK fail-closed** (`test-install-scanners`): builds a
real CA-stack PROVISION plan, points the JDK fetch at a LOCAL `file://` artifact with a guaranteed-MISMATCH
checksum (mirrors `E5`'s bad-binary path + `E3`'s planInstalls-then-override idiom), runs
`installScanners({consent:true})`, and asserts the install **fails closed BEFORE extract** — `status:'failed'`
+ the exact `JDK checksum mismatch` guard message, the JDK is NEVER unpacked (no `jdk-17.0.19+10/` under the
extract dir), the pinned-CLI **npm never ran** (no `node_modules` under `cliDir`), and the failed install
**contributes no PATH entry**. Fully hermetic (no network — `file://` + the mismatch fails before any npm).
**Mutation-proven non-vacuous:** deleting the `got !== inst.jdk.checksum` guard turns `CA7` RED (tar then runs
on a non-tarball → a generic failure whose log is NOT `JDK checksum mismatch`). The happy-path executor (real
`npm install @salesforce/cli`) stays operator-cold-validated (Level B), not CI — it needs network + ~1 GB.
**(B) Defense-in-depth name-membership guard** (`install-scanners.mjs`): a `CA_STACK_NAMES = new Set(['sf'])`
gate (the CA stack's only legitimate tool name, fixed in `tool-detect.mjs` FAMILIES) at the top of the
`code-analyzer-stack` branch — an unknown name → a `skip`, never an install — mirroring the
`PIP_TOOLS`/`NPM_TOOLS`/`GIT_TOOLS`/`BINARY_PINS` allow-lists. Not exploitable today (only a trusted `--detect`
JSON could supply another name); it closes the asymmetry. New `CA8` check locks it (`notsf` → skip with the
membership reason; `sf` still plans) and is mutation-proven RED if the guard is removed. **(C) run-scans
Family 1 deterministic-band clarity** (`skills/run-scans/SKILL.md`, prose-only): the engine-explicit workspace
form (`-r AppExchange -r sfge -r pmd --output-file …json`) is now THE primary form for the deterministic
CRUD/FLS band — for **BOTH** a present `sf` and the cold-installed stack (the only difference is how `sf` got
onto PATH). The byte-verified required HTML submission form (`scan-code-analyzer-invocation`) is kept as an
ADDITIONAL pass for the submission artifact, with an explicit note that a present-`sf` user running HTML-only
gets NEITHER the FLS band NOR the `--all`-ingestable JSON — they must run the engine-explicit form. No harness
or `--all` wiring touched. **(D) Cosmetics** (`test-install-scanners`): `CA1` now value-asserts
`SF_DISABLE_AUTOUPDATE === 'true'` (was key-only); `CA2`'s env-path-count comment corrected (`4 SF_*` →
`3 path SF_*` — the three `SF_DISABLE_*`/`AUTOUPDATE` entries are `'true'` flags, not paths; the asserted `7`
was always right). **Additive-only:** the only `install-scanners.mjs` change is the one-line name guard + its
`CA_STACK_NAMES` constant — the pip/npm/git/binary `resolveTool`/`executeOne` branches, the `planInstalls`
core, and the JDK verify/extract logic are byte-unchanged (`CA7` TESTS that logic, it does not edit it). Suite
**55 files / 709 checks** (was 55 / 707; +`CA7`, +`CA8`). Tag stays **HELD** (0.9.0 reserved).

## [0.8.41] — 2026-06-30

**Deterministic-findings cold-install milestone — Code Analyzer CRUD/FLS flips from owner-gated to
consented-deterministic-by-default (docs/roadmap-deterministic-findings.md §5).** CRUD/FLS is the #1
AppExchange review-failure class, and Salesforce Code Analyzer (PMD `ApexCRUDViolation`/`ApexFlsViolation`
+ the SFGE dataflow engine) is the exact static engine the reviewer runs for it. When `sf`+plugin+JDK are
already present the agent runs it as-is and the 0.8.40 `--all` ingest picks it up; the gap was a TRULY-COLD
box (no `sf`, no Java), where `tool-detect.mjs` marked the `code-analyzer` family `install:'owner'`, so the
installer never provisioned it and CRUD/FLS fell to PENDING-OWNER-RUN. This slice flips it to a consented
tmp-install (a new `code-analyzer-stack` method), so even a cold run produces deterministic CRUD/FLS. A
prior spike validated the hermetic cold-install recipe live and re-verified every pin at source.
**(A) The CA-stack installer** (`install-scanners.mjs`): a `JDK_PINS` constant (4-platform Temurin
17.0.19+10, each `{file, sha256}`, `%2B`-encoded release-tag URL) mirroring `BINARY_PINS`; a `resolveJdk`
pure helper (reuse a present `java`≥11 read-only, else provision the pinned tarball); a dedicated
`resolveTool` branch (the compound plan — the pinned `@salesforce/cli@2.140.6` npm step, the
`code-analyzer@5.14.0` plugin step, the JDK detect-or-provision step, the hermetic `env` map + 2-dir
`pathPrepend` all rooted under the tmp root); and a dedicated `executeOne` branch (JDK
download+sha256-verify+extract or reuse → pinned CLI → pinned plugin, hermetic env passed to every exec via
a separate `runEnv`). **(B) The hermeticity contract** (the spike's central, load-bearing finding): `SF_*`
alone is NOT sufficient — `~/.sf`, the npm cache, and `@salesforce/cli`'s postinstall hooks (which fire
during `npm install`) write under `HOME`/`TMPDIR`/`npm_config_cache`, so the FULL contained env is set
BEFORE the npm install and passed to every exec, with every write path under the tmp root, so
`cleanup-scanners.mjs`'s single structural `rm -rf <tmpRoot>` reaches all of it (0 escaped paths). **(C)
tool-detect** flips the `code-analyzer` family to the installable `code-analyzer-stack` method (carrying the
~1 GB / +~320 MB-JDK / JDK-11+ footprint note); a present `sf` is still used as-is, zero-cost. **(D)
run-scans Family 1** documents the cold-install path + the engine-explicit workspace form
`sf code-analyzer run --workspace <root> -r AppExchange -r sfge -r pmd --output-file … --view detail`, with
**`-r sfge` mandatory** for FLS (DevPreview, not in `Recommended`); the 0.8.40 `--all` ingest consumes the
JSON unchanged (the adapter needed NO change — it already extracts only stable fields, so the band is
deterministic given a pinned analyzer). **Consent** disclosure (journey + run-scans) carries the CA-stack
footprint + that it pulls `@salesforce/cli` + the plugin from npm and (if Java absent) the Temurin JDK from
Adoptium. **Additive-only:** the existing `resolveTool`/`executeOne` pip/npm/git/binary branches +
`planInstalls` core + the existing tools' plans are byte-unchanged (the CA-stack branch + `JDK_PINS` + the
manifest `env`/`pathPrepend` fields are NEW; `presentJavaHome` is a new optional planner input threaded
through, not probed in the pure planner). **Tests:** `+6` `CA*` checks in `test-install-scanners` (plan
shape, the **hermeticity-contract structural assertion** — every CA-stack env path + `pathPrepend` entry
under the tmp root, the standing guard for the spike's finding, `JDK_PINS` integrity, the JDK
detect-or-provision decision, `installCommands`, and a hermetic `--dry-run` disclosure) and `+1` `T7` in
`test-tool-detect` (absent `sf` → installable via `code-analyzer-stack`, not owner; present `sf` →
satisfied; footprint/JDK note). Mutation-proven non-vacuous (escape a path → hermeticity RED; corrupt a
`JDK_PINS` sha256 → integrity RED; flip tool-detect back to `owner` → classification RED). The live
install+run is **operator-cold-validated (Level B)**, not CI-hermetic (it needs network + ~1 GB + Java);
the standing tests cover the PURE logic. `docs/deterministic-findings-acceptance.md` Level B B0 now leads
with the cold-install recipe (env-before-install contract, the pins, `-r AppExchange -r sfge -r pmd`, the
hermeticity check, the twice-run byte-identical determinism), keeping the present-`sf` zero-install path.
Suite **55 files / 707 checks** (was 55 / 700; +6 `CA*`, +1 `T7`). Tag stays **HELD** (0.9.0 reserved).

## [0.8.40] — 2026-06-30

**Deterministic-findings Phase 2 · JOURNEY WIRING — the 11 ingest adapters now actually RUN in the journey
(the `--all` ingest mode + a content-shape recognizer) (docs/roadmap-deterministic-findings.md §10).** Through
0.8.39 the `ADAPTERS` registry held all 11 adapters built + unit-tested, but the journey only ever invoked **2**
of them: audit-codebase Step 4b hardcoded `--scanner metadata-viewall` + `--scanner code-analyzer`, so the OTHER
9 Phase-2 adapters (checkov/semgrep/bandit/njsscan/gitleaks/detect-secrets/osv/npm-audit/trivy) were never called
on a real run — their evidence JSONs were produced by `run-scans` but never ingested into the deterministic band.
This slice closes that with two ADDITIVE parts. **(A) Content-shape recognition.** Each file-parser adapter gains
a `detect(raw)→boolean` predicate, and a new exported `recognizeScanner(raw)` routes every `evidence/*.json` to
its adapter by **CONTENT SHAPE, never filename** — filenames are heterogeneous AND ambiguous (`iac-<date>.json`
is checkov with no "checkov" token; `secret-scan-*` collides between gitleaks and detect-secrets; `deps-npm-*` is
sometimes raw `npm audit` and sometimes a toolkit disposition WRAPPER). The recognizer was proven **40/40 on real
evidence across 4 captured runs**, returns the SINGLE matching name / `null` / `{ambiguous:[…]}` (>1 match fails
LOUD, never guesses), and is fail-safe (a `detect` that throws → false). **(B) `--all` mode + the two wiring
points.** A new `ingestAll({target})` + `--all` CLI mode ALWAYS runs metadata-viewall then recognizes + ingests
every evidence file into the band in ONE byte-deterministic pass (sorted file list + id-sorted union), reporting
Code-Analyzer-absent → CRUD/FLS + sharing **PENDING-OWNER-RUN** (never LLM-fill). `--all` is wired at **audit-codebase
Step 4b** (replacing the two `--scanner` calls) AND the **run-scans scan tail** (new step 9b: `--all` then
`reconcile-provenance`). **Design note (flagged):** seeding the band at the run-scans tail is the deliberate choice
over re-running the whole `audit-codebase` pass after scans — a re-audit would double the expensive LLM fan-out for
no new signal. Both harnesses are pure + idempotent + finding-neutral on re-run (stable ids dedup; reconcile only
demotes and a deterministic finding never supersedes another), so running `--all` + reconcile at the run-scans tail
AND again at audit Step 4b / Step 6 is safe and byte-stable. **Additive-only:** `buildFinding` / `ingest` /
`CLASS_DEFS` / the per-`--scanner` CLI dispatch are **byte-unchanged** (verified by direct HEAD-vs-tree diff);
`AD1` stays at **11 adapters** (no new adapter — the recognizer routes the existing ten file-parsers). **Judgment
call (flagged):** the builder spec's `RC-failsafe` case listed `[]`→`null`, but the proven gitleaks `detect`
predicate + the design note recognize an empty top-level array as a CLEAN gitleaks scan (0 findings, harmless) —
the predicate is authoritative, so `recognizeScanner([]) → 'gitleaks'`; the standing test asserts this and notes
the resolved contradiction. Validated by the new `RC*` (recognizer disjointness/failsafe/ambiguous) + `ALL*`
(`--all` behavior: filename-independent ingest, index.json skipped, byte-determinism, PENDING accounting,
secret-never-leaks) checks in `test-ingest-scanner-findings.mjs`, and updated/new W3/W5/**W10/W11** wiring assertions
in `test-deterministic-integration.mjs`. Suite **55 files / 700 checks** (was 55 / 688; +10 `RC*`/`ALL*` in
`test-ingest-scanner-findings`, +2 `W10`/`W11` in `test-deterministic-integration`). Tag stays **HELD** (0.9.0 reserved).

### Added
- **`harness/ingest-scanner-findings.mjs` — content-shape recognition.** A `detect(raw)→boolean` predicate on each
  of the 10 file-parser adapters (the source-scanner `metadata-viewall` has no evidence file → no `detect`), using
  the shared `_isObj`/`_resultsArr`/`_semgrepMarks`/`_banditMarks`/`_osvMarks` shape helpers. The `results[]`-array
  trio (semgrep/bandit/osv) is disambiguated by the element key (`check_id`/`test_id`/`packages`) when non-empty and
  by top-level markers (AND-NOT the higher-priority members) when empty; a top-level array is gitleaks (or a checkov
  multi-framework array, by `RuleID` vs `check_type`); an empty `[]` is a clean gitleaks scan.
- **`recognizeScanner(raw)`** (exported) — iterates the `detect`-bearing adapters, returns the single matching name,
  `null` if none, or `{ambiguous:[names]}` if >1 (each `detect` wrapped try/catch → false on throw).
- **`ingestAll({target, pass, dryRun})`** (exported) + the **`--all` CLI mode** — always runs metadata-viewall, then
  recognizes + ingests every top-level `evidence/*.json` (subdirs like `dast/` skipped; unparseable/empty/
  unrecognized files skipped with a named note), merges the id-sorted union into the ledger once, and emits an honest
  summary (per scanner → N findings; clean → "ran clean, 0 findings"; skipped files named; Code-Analyzer-absent →
  PENDING-OWNER-RUN) with a `--json` structured form. Mutually exclusive with `--scanner`; routed at module bottom so
  `main()` is byte-unchanged.
- **`acceptance/test-ingest-scanner-findings.mjs`** — the `RC*` recognizer block (every committed fixture → its own
  adapter; clean `results:[]` still recognized; non-adapter shapes incl. the `deps-npm` WRAPPER → `null`; a synthetic
  2-match → `{ambiguous}`; failsafe) + the `ALL*` `--all`-behavior block (renamed-evidence content routing, index.json
  skipped, byte-determinism, PENDING accounting with/without Code Analyzer, secret-never-leaks through `--all`). +10 checks.
- **`acceptance/test-deterministic-integration.mjs`** — `W10` (run-scans grants both harnesses) + `W11` (run-scans
  invokes `--all` then `reconcile-provenance --target` at the scan tail, in order, + the PENDING note). +2 checks.

### Changed
- **`skills/audit-codebase/SKILL.md` Step 4b** — the two `--scanner metadata-viewall` / `--scanner code-analyzer`
  invocations replaced by a single `--all` call that ingests every recognized scanner output present; same ordering
  (deterministic pass BEFORE the LLM fan-out), same PENDING-when-absent contract (Code-Analyzer-absent → CRUD/FLS +
  sharing PENDING-OWNER-RUN, the LLM **KEEPS its findings as `llm-inferred`**). The existing `Bash(node
  *harness/ingest-scanner-findings.mjs *)` grant already covers `--all`.
- **`skills/run-scans/SKILL.md`** — new **step 9b** at the scan tail runs `--all` then `reconcile-provenance --target`
  so a single cold run seeds the deterministic band in-pass; **both grants added to `allowed-tools`**
  (`Bash(node *harness/ingest-scanner-findings.mjs *)` + `Bash(node *harness/reconcile-provenance.mjs *)`); the
  "what feeds the next skill" note updated to reflect in-pass seeding + incremental re-ingest by audit-codebase.
- **`acceptance/test-deterministic-integration.mjs`** — `runDeterministicPass` switched to ONE `--all` call; `W3`
  now asserts the `--all` invocation (subsumes metadata-viewall + code-analyzer); `W5` anchors the order check on
  `--all`. (W6/W7 unchanged.)
- **`docs/deterministic-findings-acceptance.md`** — B2 + B5's `run_once()` use the single `--all` command; B5 adds
  that with the full OSS scanner set present, `--all` makes the WHOLE band reproducible run-to-run; cross-references
  note the run-scans tail.
- **`docs/roadmap-deterministic-findings.md`**, **`CONVENTIONS.md`**, **`acceptance/README.md`** — journey-wiring
  milestone + 0.8.40 note; current-state suite counts bumped 688 → **700** (historical version-stamped lines left as-is).

### Unchanged (additive-only proof)
- `buildFinding`, `ingest`, `CLASS_DEFS`, and the per-`--scanner` `main()` dispatch are **byte-identical to HEAD**
  (confirmed by direct HEAD-vs-working-tree extraction). The `--all` mode, `detect` predicates, `recognizeScanner`,
  and `ingestAll` are all NEW code; the existing per-scanner CLI keeps every prior unit test passing.

## [0.8.39] — 2026-06-29

**Deterministic-findings Phase 2 · adapter 2a #9 — the trivy adapter (IaC-misconfig / CONFIG mode only; REUSES
checkov's `iac-misconfig` class at class-severity) (docs/roadmap-deterministic-findings.md §10).** Trivy is the
toolkit's multi-mode scanner (IaC-misconfig over Dockerfile/Terraform/K8s, plus os-pkgs/lang-pkgs SCA and a
secret mode). This slice does exactly ONE mode — **`Class:'config'` (IaC misconfig)** — because that is the only
mode with a REAL captured fixture on disk, and a Trivy `config` finding is the **SAME vuln class as Checkov**, so
trivy **REUSES the `iac-misconfig` class** (NO new `CLASS_DEFS` entry, NO `buildFinding` change — exactly as
detect-secrets reused `hardcoded-secrets`): a **CLASS-severity** adapter at class `high` (from `scan-iac-misconfig`
= `major`), NOT a tool→band path. The **ONLY shared-file touch is the `ADAPTERS` registry line**. The parse is
**CLASS-DISPATCH** and forward-compatible: it handles `Class:'config'` now and **SKIPS** the vuln (os-pkgs/
lang-pkgs) and `secret` classes — those are **Phase-2b** (no captured fixtures yet) — so when a future slice ships
those fixtures the dispatch grows a branch and nothing already-shipped changes. Only `Status:'FAIL'`
misconfigurations become findings (a `PASS` is a satisfied check). **Severity decision (consistency call):** Trivy
DOES carry a per-misconfig `Severity` (LOW/MEDIUM/HIGH/CRITICAL), but Checkov — the OTHER `iac-misconfig` engine —
lands every IaC misconfig at the class `high`; for the same class to be **consistent across engines**, Trivy ALSO
uses class-severity, with its own `Severity` recorded in the reasoning *for reference* (mirroring how Checkov
records the absent tool severity). A per-misconfig-tool-severity refinement for the `iac-misconfig` class (Checkov
+ Trivy both) stays the **same Phase-2b item flagged at Checkov** — no tool→band path for IaC is introduced here.
Trivy + Checkov flag the **SAME Dockerfile misconfig** (Trivy `DS-0026` "No HEALTHCHECK" ↔ Checkov `CKV_DOCKER_2`)
→ two visible `iac-misconfig` rows; neither supersedes the other (both deterministic), the SAFE under-merge —
collapsing it is **§10 extension #3** (Phase-2b). Validated by "parse twice → identical" against the real captured
fixture (genuine Trivy 0.71.2 filesystem scan — 1 `Class:'config'` Result, 1 FAIL misconfig `DS-0026` Severity
`LOW`, no `CauseMetadata.StartLine`) + the class-severity-consistency mutation (the misconfig `Severity` `LOW→
CRITICAL` leaves the band `high`, exactly like Checkov) + a class-dispatch synthetic (an `os-pkgs` Vulnerabilities
Result + a `config` Misconfigurations Result → only the config misconfig becomes a finding; AVDID preferred over
ID; `CauseMetadata.StartLine` → `:line`) + a `Status:'PASS'`-skipped synthetic + a reuses-class assertion (no new
`CLASS_DEFS` entry), NO campaign. Suite **55 files / 688 checks** (was 55 / 677; +11 `TRV*` checks folded into
`test-ingest-scanner-findings`; `AD1` bumped to the 11-adapter registry). Tag stays **HELD** (0.9.0 reserved).

### Added
- **`harness/ingest-scanner-findings.mjs` — the `trivy` adapter** (`file-parser`, `engine:'trivy'`).
  `collect()` reads the `--input` JSON (null-safe on missing/non-JSON/empty); `parse()` iterates `Results[]` with
  a **class dispatch** — only `Class:'config'` Results are read this slice (`os-pkgs`/`lang-pkgs`/`secret` are
  skipped, Phase-2b), then each `Misconfigurations[]` entry that is a `FAIL` (a `PASS` is skipped) becomes a hit:
  `ruleId` prefers `AVDID` (e.g. `AVD-DS-0026`) else `ID` (e.g. `DS-0026`); `file` is the Result `Target`, with
  `:StartLine` appended only when `CauseMetadata.StartLine` is an integer (a file-level misconfig like `DS-0026`
  carries none → the bare Target); the misconfig's `Severity` is recorded in the message **for reference only**;
  `PrimaryURL` becomes the reference URL. `severityNum:null`, no `bandFromTool` — `classify()` is the constant
  **`'iac-misconfig'`** so the **MAPPED class-severity branch governs** (`scan-iac-misconfig` = major → `high`),
  the tool number never moving it (consistent with Checkov). NO `securityRelevant` (security-by-construction —
  every config misconfig is a finding). Registered as the **11th** adapter. **No `buildFinding` change, no
  `CLASS_DEFS` change** — `iac-misconfig` already exists (checkov, 0.8.31); one class definition, two engines.
- **`acceptance/fixtures/trivy-dockerfile-solano.json`** — genuine Trivy 0.71.2 `filesystem` scan output
  (`ArtifactType:'filesystem'`), 1 `Class:'config'` Result with 1 `FAIL` Misconfiguration (`DS-0026` "No
  HEALTHCHECK defined", `Severity:'LOW'`) — the same Dockerfile finding Checkov reports as `CKV_DOCKER_2`. The
  IaC-misconfig anchor for the `TRV*` checks; leak-clean (no secrets, generic Dockerfile guidance only).
- **`acceptance/test-ingest-scanner-findings.mjs` — the `TRV*` checks** (11 new): determinism, the `DS-0026`
  anchor (→ `provenance:'deterministic'`/`engine:'trivy'`/`class:'iac-misconfig'`/`dimension:'infrastructure-iac'`/
  class-severity **`high`**/`file:'Dockerfile'` with the `PrimaryURL` and the "[Trivy severity LOW, recorded for
  reference]" note in the reasoning), the **severity-from-class consistency invariant** (mutating the misconfig
  `Severity` `LOW→CRITICAL` leaves the band `high` — matching Checkov), **class-dispatch** (an `os-pkgs`
  Vulnerabilities Result is skipped while the `config` Misconfigurations Result yields the only finding; AVDID
  preferred; `CauseMetadata.StartLine` → `:line`), `Status:'PASS'`-skipped (case-insensitive), **reuses-class**
  (the constant `classify()`→`iac-misconfig` is the SAME `CLASS_DEFS` entry checkov uses — `Object.keys(CLASS_DEFS)`
  unchanged at the original 5, no `trivy` entry), classify/fail-safe (`securityRelevant===undefined`; the
  degenerate `Results`/Misconfiguration/secret-class shapes → `[]`/skipped, no crash), idempotent merge, schema
  conformance, and the CLI dry-run + merge; `AD1` now asserts the **11-adapter** registry — `trivy` joins as the
  tenth file-parser.

## [0.8.38] — 2026-06-29

**Deterministic-findings Phase 2 · adapter 2a #8 — the npm-audit adapter (the EASY Extension-A REUSE: a direct
severity LABEL per package, no CVSS math) (docs/roadmap-deterministic-findings.md §10).** npm audit is the
Node-ecosystem dependency-CVE scanner (run-scans Family 8, alongside OSV). `npm audit --json`
(`auditReportVersion:2`) gives a **DIRECT severity LABEL per vulnerable package** (`critical/high/moderate/low/
info`) — no CVSS parsing — so the band comes straight from `NPM_SEVERITY_TO_FINDING`, exactly like OSV's
label-fallback path. It **REUSES `buildFinding`'s `bandFromTool` path, the `gateLabel` parameter (already added
at 0.8.37), the `dependency-cve` dimension, and `classify()`→`null` EXACTLY like OSV** — the band SOURCE (an npm
label, not a CVSS) is the only difference — so there is **NO `buildFinding` / `CLASS_DEFS` change** (gateLabel
already exists); the **ONLY shared-file touch is the `ADAPTERS` registry line**. It is gated by
`scan-dependency-vulnerabilities` (`applies_to: [all]`, `severity_if_missing: major` — the npm-deps gate,
**distinct** from OSV's `scan-external-sca`; both `major`). One finding per vulnerable package (npm's
`vulnerabilities` map is keyed by package; its `severity` is that package's MAX advisory severity); `via`
supplies the advisory title/url — a `via[i]` that is a **STRING** is a transitive package name ("vulnerable via
that one"), a `via[i]` that is an **OBJECT** is the direct advisory (`{source,name,title,url,severity,cwe,cvss,
range}`). Validated by "parse twice → identical" against the real captured fixture (4 vulnerable packages —
`body-parser`/`express`/`path-to-regexp`/`qs`, `moderate`×2 + `high`×2) + inline label→band synthetics + a
via-shape matrix (string-via → "vulnerable via …"; object-via → its title in the message, its url as the
`ruleId` and in `resources`) + the package-severity-wins assertion (`qs` is package `moderate` though its first
advisory is `low` → bands medium) + a no-CVSS-vector-leak check + a gate-label regression, NO campaign. Suite
**55 files / 677 checks** (was 55 / 665; +12 `NPM*` checks folded into `test-ingest-scanner-findings`; `AD1`
bumped to the 10-adapter registry). Tag stays **HELD** (0.9.0 reserved).

### Added
- **`harness/ingest-scanner-findings.mjs` — the `npm-audit` adapter** (`file-parser`, `engine:'npm-audit'`).
  `collect()` reads the `--input` JSON (null-safe on missing/non-JSON/empty); `parse()` iterates the
  `vulnerabilities` OBJECT keyed by package (defensive: a non-object `vulnerabilities` — including an array — a
  `null`/non-object entry are all skipped, never crash), bands each package from its `severity` LABEL via
  `NPM_SEVERITY_TO_FINDING` (unknown/blank → `medium`), and derives the advisory title/url from the first OBJECT
  `via`-entry (string `via`-entries form the "vulnerable via …" chain). dep-CVEs have **no file:line** — `file`
  is the lockfile `package-lock.json`, `startLine:null`. `ruleId` prefers the advisory url/id, else the package
  name. `classify()` is constant **`null`** (owns no class, supersedes nothing); NO `securityRelevant`
  (security-by-construction — every entry is a known CVE). `dimension:'dependency-cve'` (the same
  deterministic-only grouping label OSV uses — no LLM dependency finder, so no methodology file). Registered as
  the **10th** adapter. **No `buildFinding` change** (`gateLabel` already exists), **no `CLASS_DEFS` change**.
- **`harness/ingest-scanner-findings.mjs` — `NPM_SEVERITY_TO_FINDING`** (`{critical, high, moderate→medium, low,
  info}`). npm's own LOWERCASE spelling, using `moderate` (NOT `medium`); its OWN named map per the per-tool
  idiom — it does NOT reuse OSV's UPPERCASE `OSV_LABEL_TO_FINDING`. Exported + unit-tested at every label.
- **`acceptance/fixtures/npm-audit-solano.json`** — genuine captured `npm audit --json` v2 output (4 vulnerable
  packages, `moderate`×2 + `high`×2). Leak-clean by construction (package names + version ranges + GHSA urls
  only — no host/partner identifiers). The anchor is `express` (package severity `high`, `via` 3 transitive
  strings → `ruleId` is the package name).
- **`acceptance/test-ingest-scanner-findings.mjs`** — an `NPM*` section (+12 checks): determinism, count +
  band-mix (exactly 4 findings, distinct ids, 2 high · 2 medium, all `npm-audit`/`dependency-cve`/no-class/
  `package-lock.json` locus), the `express` anchor (deterministic/npm-audit/`dependency-cve`/no-class/`high`,
  package name + range in the title, no `:line`), the **label→band map** (each npm label + unknown/blank →
  `medium`) directly and through `parse`, the **via-shape matrix** (string-via → "vulnerable via …"; object-via
  → advisory title in the message + url as `ruleId` and in hit `resources`; the package severity wins over the
  first advisory's; no CVSS-vector leak), `classify()`→null/no-class + the `scan-dependency-vulnerabilities`
  gate on every hit, fail-safe over the degenerate shapes (missing severity → `medium` hit, never dropped),
  idempotent merge, schema conformance, and the CLI (dry-run + merge). The **NPM-gate-label** check asserts an
  npm-audit finding says `gated by scan-dependency-vulnerabilities` while OSV STILL says `scan-external-sca` and
  semgrep STILL says `scan-external-sast`. `AD1` bumped to the 10-adapter registry.

### Decided (four judgment calls — implemented as specified, documented not hidden)
- **Unknown/blank severity → `medium`** (NOT `info`, NOT the gate's `high`) — consistent with OSV's unscored-CVE
  rule: a known CVE of unknown severity is real, and the conservative middle neither over- nor under-states it.
- **One finding per vulnerable package.** npm's `vulnerabilities` map is keyed by package and its `severity` is
  the package's MAX advisory severity, so one package → one finding; `via` supplies the advisory context. The
  band uses the PACKAGE severity, **NOT** the first advisory's own (`qs` is package `moderate` though its first
  via-advisory is `low` → it bands medium). `ruleId` prefers the advisory url/id, else the package name.
- **`gateLabel:'scan-dependency-vulnerabilities'`** (the npm-deps gate, `applies_to: [all]`, `major`) — DISTINCT
  from OSV's `scan-external-sca`; both `major`. The two dep-CVE engines name different gates.
- **`classify()`→null — owns no class, supersedes nothing.** There is no LLM dependency-CVE finder to supersede;
  npm-audit findings only populate the band. With two dep-CVE engines now live, OSV + npm-audit can flag the
  SAME CVE — the duplicate is **visible** (the SAFE under-merge); collapsing it is **§10 extension #3
  (cross-engine dedup), Phase-2b**, NOT this slice.

## [0.8.37] — 2026-06-29

**Deterministic-findings Phase 2 · adapter 2a #7 — the OSV-Scanner adapter, and with it Extension A: the
CVSS→enum advisory-severity fork (docs/roadmap-deterministic-findings.md §10 extension #1).** OSV-Scanner is
the toolkit's dependency-CVE / SCA scanner (run-scans Family 8, over every lockfile under a non-package
source root). It is the SEVENTH `§10` adapter and forces the **third design pivot**: unlike the SAST family
(`semgrep`/`bandit`/`njsscan` → ERROR/WARNING/INFO tool tier) and the class-severity adapters
(`checkov`/`gitleaks`/`detect-secrets` → class), a dep CVE carries a **REAL CVSS base score**, while the only
CLASS severity (`scan-external-sca` = `major`) is a *missing-scan* GATE severity. So the per-FINDING band is
**PER-ADVISORY** (`severityKind:'advisory'`): resolved from the advisory's CVSS via `CVSS_SCORE_TO_FINDING`
(the industry-standard CVSS 3.x scale — ≥9.0 critical · ≥7.0 high · ≥4.0 medium · >0 low · 0 info), and the
class governs **only the gate**. It **REUSES `buildFinding`'s `bandFromTool` path** exactly like the SAST
adapters (`classify()`→`null`, no `securityRelevant`, a `dimensionHint`, `severityNum:null`) — the band
SOURCE is the only difference (CVSS, not a tool tier). The **ONE additive shared-code change** is a
`gateLabel` parameter on `buildFinding`'s tool→band branch (`${gateLabel || 'scan-external-sast'}`): OSV/SCA
passes `scan-external-sca`; because the SAST adapters never pass `gateLabel`, the default preserves their
severity-reasoning **byte-for-byte** (`CLASS_DEFS` and the mapped/unmapped branches are untouched). Validated
by "parse twice → identical" against the real captured fixture (1 source `mcp/requirements.txt`, 3 PyPI
packages, 11 vulns: 1 critical `h11` · 3 high + 6 medium + 1 low across `starlette`/`idna`) + inline CVSS→enum
threshold synthetics + a gate-label-default-preserved regression, NO campaign. Suite **55 files / 665 checks**
(was 55 / 651; +14 `OSV*` checks folded into `test-ingest-scanner-findings`; `AD1` bumped to the 9-adapter
registry). Tag stays **HELD** (0.9.0 reserved).

### Added
- **`harness/ingest-scanner-findings.mjs` — the `osv` adapter** (`file-parser`, `engine:'osv'`). `collect()`
  reads the `--input` JSON (null-safe on missing/non-JSON/empty); `parse()` iterates `results[] → packages[]
  → vulnerabilities[]` (defensive at every level — missing `results`/`packages`/`groups`/`vulnerabilities`,
  a `null` vuln, or a vuln with no `id` are all skipped, never crash), and resolves each vuln's band by the
  **severity priority** (1) the numeric `max_severity` of the package `group` that contains this vuln id →
  `CVSS_SCORE_TO_FINDING`; (2) else the vuln's `database_specific.severity` LABEL → `OSV_LABEL_TO_FINDING`;
  (3) else `'medium'`. dep-CVEs have **no file:line** — `file` = the lockfile `source.path` (or
  `ecosystem:name` when OSV gives no source), `startLine:null`. `classify()` is constant **`null`** (owns no
  class, supersedes nothing); NO `securityRelevant` (security-by-construction — every hit is a known CVE).
  `dimension:'dependency-cve'` (a deterministic-only grouping label, like `external-sast`/`infrastructure-iac`
  — no LLM dependency finder, so no methodology file). Registered as the **9th** adapter.
- **`harness/ingest-scanner-findings.mjs` — `CVSS_SCORE_TO_FINDING` + `OSV_LABEL_TO_FINDING`** (Extension A).
  `CVSS_SCORE_TO_FINDING(score)` maps a CVSS base score to a toolkit band; `OSV_LABEL_TO_FINDING` maps OSV's
  `database_specific.severity` LABEL (GitHub's `CRITICAL/HIGH/MODERATE/LOW`; `MEDIUM` accepted as a `MODERATE`
  synonym). Both exported + unit-tested at every band boundary.
- **`harness/ingest-scanner-findings.mjs` — the `gateLabel` parameter on `buildFinding`** (the only shared-code
  edit). The tool→band branch's gate clause now reads `gated by ${gateLabel || 'scan-external-sast'} (major)`.
  Additive: omitting `gateLabel` (semgrep/bandit/njsscan) preserves their reasoning byte-for-byte; OSV passes
  `scan-external-sca`. No change to the mapped-class branch, the unmapped fallback, or `CLASS_DEFS`.
- **`acceptance/fixtures/osv-coldstart-full.json`** — genuine captured OSV-Scanner output (1 source, 3 PyPI
  packages, 11 vulnerabilities), genericized per CONVENTIONS §3 (the one host-absolute lockfile path →
  repo-relative `mcp/requirements.txt`; no other partner identifiers). The anchor is `GHSA-82w8-qh3p-5jfq`
  (`starlette@0.38.6`, single-id group `max_severity` 7.5 → `high`).
- **`acceptance/test-ingest-scanner-findings.mjs`** — an `OSV*` section (+14 checks): determinism, count +
  band-mix (exactly 11 findings, distinct ids, 1 critical · 3 high · 6 medium · 1 low), the `GHSA-82w8-qh3p-5jfq`
  anchor (deterministic/osv/`dependency-cve`/no-class/`high`, package@version + ecosystem in the title, no
  `:line`), the **CVSS→enum thresholds** (each band boundary 9.0/7.0/4.0/0.1 + a real `0`→`info` + blank/absent
  →`null`) both directly and through `parse`, the **severity priority** (numeric wins over label · no group →
  label · neither/blank-scored → `medium`), no-vector-leak, `classify()`→null/no-class, fail-safe over the
  degenerate shapes, idempotent merge, schema conformance, the CLI (dry-run + merge), and the **load-bearing
  GATE-LABEL regression** (an OSV finding says `gated by scan-external-sca`, a semgrep finding STILL says
  `gated by scan-external-sast`). `AD1` bumped to the 9-adapter registry.

### Decided (three judgment calls — implemented as specified, documented not hidden)
- **An unscored CVE → `medium`** (NOT `info`, NOT the gate's `high`). A known CVE with no resolvable CVSS is
  still a real finding; over- or under-stating it is dishonest, so the conservative middle is the faithful
  call. Load-bearing detail: `Number('') === 0` and `Number(null) === 0` are both *finite*, so `CVSS_SCORE_TO_FINDING`
  guards blank/absent input → `null` (falls through to the label → `medium` path) BEFORE the numeric coercion;
  an EXPLICIT numeric zero (`'0'`/`'0.0'`, a genuinely 0.0-scored CVE) is not blank → still `info`.
- **No file:line for a dep-CVE.** A dependency CVE locates to the lockfile/package, not a code line, so `file`
  is the lockfile path (or `ecosystem:name`) and `startLine` is `null`. Two vulns of one package = distinct ids
  (distinct GHSA/CVE); the SAME CVE under two lockfiles = distinct loci (distinct `file`) — correct, two real
  install sites.
- **`classify()`→null — owns no class, supersedes nothing.** There is no LLM dependency-CVE finder to supersede;
  OSV findings only populate the band. Cross-engine dedup with npm-audit/Trivy on the SAME CVE is
  **§10 extension #3 (cross-engine dedup), Phase-2b**, NOT this slice.

## [0.8.36] — 2026-06-29

**Deterministic-findings Phase 2 · adapter 2a #6 — the detect-secrets adapter (the secrets SIBLING of
gitleaks; REUSES the `hardcoded-secrets` class; the nested-by-file parse; the hash/secret-never-leaks
invariant; cross-engine dedup now concrete → ext #3) (docs/roadmap-deterministic-findings.md §10).**
detect-secrets is the toolkit's SECOND hardcoded-secret scanner (run-scans Family 6, alongside gitleaks).
It is the same vuln class — a hardcoded secret — so it **REUSES the `hardcoded-secrets` class** gitleaks
added: **NO new `CLASS_DEFS` entry, NO `buildFinding`/`recommendationFor` change** — a `class`-severity
adapter (like Checkov/gitleaks, NOT `tool→band`), severity from the `fail-hardcoded-secrets` CLASS
(`severity_if_missing: major` → **high**) via a CONSTANT `classify()`→`'hardcoded-secrets'` and NO tag
filter (security-by-construction). The **only shared-file touch is the `ADAPTERS` registry line**. Like
gitleaks it owns a class AND the REAL `secrets-credentials` methodology dimension, so it **SUPERSEDES a
co-located LLM `secrets-credentials` finding**. Two things are new vs gitleaks: (1) detect-secrets' **OWN
nested-object JSON** — `{ results: { <file>: [occurrence, …] } }`, keyed by FILE (each value an array),
NOT gitleaks' flat top-level array — so its own `parse`; (2) with **TWO secrets engines now live**, the
same secret at one locus produces TWO deterministic ledger rows (one per engine), which `reconcile-provenance`
does NOT collapse (it only supersedes an `llm-inferred` finding; a deterministic finding never supersedes
another deterministic finding) — so the cross-engine duplicate is **visible** (the SAFE under-merge);
collapsing it is cross-engine dedup = **§10 extension #3 (cross-engine dedup), Phase-2b**, NOT this slice.
The **hash/secret-never-leaks invariant** applies again: an occurrence carries a `hashed_secret` (a SHA —
leak-safe by detect-secrets' design) and, under `--show-secrets`, could carry plaintext; the adapter emits
from ONLY `type`/file/`line_number` and **never** the hash or plaintext. Validated by "parse twice →
identical" against the real captured fixture (24 occurrences across 6 files, 3 detector types) + a
load-bearing hash+plaintext leak test, NO campaign. Suite **55 files / 651 checks** (was 55 / 639; +12 `DS*`
checks folded into `test-ingest-scanner-findings`). Tag stays **HELD** (0.9.0 reserved).

### Added
- **`harness/ingest-scanner-findings.mjs` — the `detect-secrets` adapter** (`file-parser`,
  `engine:'detect-secrets'`). `collect()` reads the `--input` JSON (null-safe on missing/non-JSON/empty);
  `parse()` reads detect-secrets' **nested-by-file** `results` object (`{<file>: [occurrence, …]}`),
  iterating the file keys then each occurrence, skipping any with no `type` or no file, and builds each hit
  from ONLY the non-sensitive fields — `type` (as `ruleId`), the file path, and `line_number`. It
  **DELIBERATELY never reads `hashed_secret`, `is_verified`, or any plaintext field** (the hash/secret-never-
  leaks invariant; the PRIMARY, structural control — `buildFinding`'s `redact()` is only a backstop);
  `message` names the `type` only — never the hash. `classify()` is the constant **`'hardcoded-secrets'`**,
  **reusing the SAME class gitleaks added** (one `CLASS_DEFS` entry, two adapters). NO `securityRelevant`
  (security-by-construction). Registered as the **8th** adapter; `AD1` now asserts the 8-adapter registry.
- **`acceptance/fixtures/detect-secrets-solano.json`** — genuine captured detect-secrets 1.5.0 output (the
  `results` object keyed by 6 files; 24 occurrences; 3 detector types: `Secret Keyword` / `Hex High Entropy
  String` / `Base64 High Entropy String`), **leak-safe by detect-secrets' design** — every occurrence carries
  only a `hashed_secret` SHA (no plaintext), and all paths are relative (no partner paths). The anchor is the
  first `Secret Keyword` occurrence (`.security-review/audit-engine.mjs:181`).
- **`acceptance/test-ingest-scanner-findings.mjs`** — a `DS*` section (+12 checks): determinism, the
  `Secret Keyword` anchor (`.security-review/audit-engine.mjs:181` → deterministic/detect-secrets/
  `hardcoded-secrets`/`secrets-credentials`/class-severity `high`), count + multi-file (exactly 24 findings
  spanning 6 distinct files + ≥2 detector types, distinct ids), the **load-bearing DS-HASH/SECRET-NEVER-LEAKS**
  (a synthetic occurrence with a fake `hashed_secret` AND a synthetic `--show-secrets` plaintext leaks NEITHER
  into any finding field), **DS-reuses-class** (`classify()`→`hardcoded-secrets` is the SAME entry gitleaks
  uses, no new `CLASS_DEFS`; class-severity, `severityNum:null`), **DS-supersedes-LLM** (a detect-secrets
  finding supersedes a co-located LLM `secrets-credentials` finding), **DS-two-deterministic-coexist** (a
  detect-secrets finding AND a gitleaks finding at the SAME locus both stay `confirmed` — neither supersedes
  the other; the deferred §3 behaviour captured as a test), fail-safe over the nested/degenerate shapes,
  idempotent merge, schema conformance, and the CLI (dry-run + merge). `AD1` bumped to the 8-adapter registry.

### Decided (one judgment call — implemented as specified, documented not hidden)
- **Cross-engine dedup is now CONCRETE but stays §10 extension #3 (Phase-2b).** With gitleaks AND
  detect-secrets both emitting `hardcoded-secrets` findings, the same secret at one locus now produces two
  deterministic ledger rows. `reconcile-provenance` leaves BOTH `confirmed` (it only supersedes `llm-inferred`
  findings) — the correct, conservative behaviour: no engine's finding silently hides another's, the duplicate
  is visible (the SAFE under-merge). Collapsing gitleaks↔detect-secrets↔njsscan `node_secret` into one row is
  extension #3 (cross-engine dedup), captured as the `DS-two-deterministic-coexist` test, NOT this slice.

## [0.8.35] — 2026-06-29

**Deterministic-findings Phase 2 · adapter 2a #5 — the gitleaks adapter (the DESIGN PIVOT BACK to
`class`-severity; the FIRST adapter to SUPERSEDE an LLM finding for its class; the secret-never-leaks
invariant) (docs/roadmap-deterministic-findings.md §10).** gitleaks is the toolkit's hardcoded-secret
scanner (run-scans Family 6, tree + git-history). UNLIKE the SAST family (semgrep/bandit/njsscan) it
carries NO per-finding severity tier — every hit is "a secret is present" — so it is a
**`class`-severity** adapter (like Checkov, NOT `tool→band`): severity comes from the
`fail-hardcoded-secrets` CLASS (`severity_if_missing: major` → **high**), via a CONSTANT
`classify()`→`'hardcoded-secrets'` and NO tag filter (security-by-construction). **No
`buildFinding`/`CLASS_DEFS`-machinery change** — one new `CLASS_DEFS` entry + one adapter object + one
`recommendationFor` arm; it rides the existing MAPPED-class severity path. Two things make it distinct:
(1) it owns a class AND a **real methodology dimension** (`secrets-credentials`), so it **SUPERSEDES a
co-located LLM `secrets-credentials` finding** — the first adapter to enforce, for its class, that the
LLM does not re-report what the scanner determined; (2) gitleaks output CONTAINS the live secret
(`Match`/`Secret`) + commit PII (`Author`/`Email`/`Message`), so the adapter is built so **none of it
ever reaches the ledger** (the load-bearing requirement of the slice). Validated by "parse twice →
identical" against the real captured fixture (3 `generic-api-key` findings) + a load-bearing leak test,
NO campaign. Suite **55 files / 639 checks** (was 55 / 627; +12 `GL*` checks folded into
`test-ingest-scanner-findings`). Tag stays **HELD** (0.9.0 reserved).

### Added
- **`harness/ingest-scanner-findings.mjs` — the `gitleaks` adapter** (`file-parser`,
  `engine:'gitleaks'`). `collect()` reads the `--input` JSON (null-safe on missing/non-JSON/empty);
  `parse()` iterates the JSON ARRAY of gitleaks findings, skipping any hit with no `RuleID`/`File`, and
  builds each hit from ONLY the non-sensitive fields — `RuleID`, `File`, `StartLine`, and `Description`
  (as `message`). It **DELIBERATELY never reads `Match`, `Secret`, `Message`, `Author`, or `Email`** —
  the secret-never-leaks invariant (the PRIMARY, structural control; `buildFinding`'s `redact()` is only
  a backstop). `classify()` is the constant **`'hardcoded-secrets'`** (every gitleaks hit is a hardcoded
  secret). NO `securityRelevant` (security-by-construction). Registered as the **7th** adapter; `AD1` now
  asserts the 7-adapter registry.
- **`CLASS_DEFS['hardcoded-secrets']`** — `{ baselineId: 'fail-hardcoded-secrets', dimension:
  'secrets-credentials', fallback: 'high' }`. `fail-hardcoded-secrets` is `severity_if_missing: major`
  → **high**. Unlike `iac-misconfig`'s deterministic-only label, `secrets-credentials` is a REAL
  methodology dimension (`methodology/dimensions/secrets-credentials.md`), so a gitleaks finding owns a
  class AND a real dimension and therefore supersedes a co-located LLM secrets finding. Plus a
  `recommendationFor` arm (remove the credential → approved store, rotate the secret; code obscurity is
  explicitly not a defense).
- **`acceptance/fixtures/gitleaks-coldstart-full.json`** — genuine captured gitleaks output (3
  `generic-api-key` findings: the anchor on `mcp/server.py:27` + 2× on `ops/deploy-notes.md`),
  **leak-clean by construction**: secret values are synthetic placeholders and `Author`/`Email`/`Message`
  are blanked (no real secret, no commit PII); `RuleID`/`File`/`StartLine`/`Description`/`Commit` kept.
- **`acceptance/test-ingest-scanner-findings.mjs`** — a `GL*` section (+12 checks): determinism, the
  `generic-api-key` anchor (`mcp/server.py:27` → deterministic/gitleaks/`hardcoded-secrets`/
  `secrets-credentials`/class-severity `high`), count (exactly 3), the **load-bearing
  GL-SECRET-NEVER-LEAKS** (a synthetic finding with a fake secret + PII in EVERY sensitive field —
  `Match`/`Secret`/`Message`/`Author`/`Email` — leaks NONE of it into any finding field),
  severity-FROM-CLASS (no tool number exists to move it), **GL-supersedes-LLM** (a gitleaks finding
  supersedes a co-located LLM `secrets-credentials` finding via `reconcileProvenance`), the constant
  `classify()`→`hardcoded-secrets` + no `securityRelevant`, fail-safe over non-array/degenerate input,
  idempotent merge, schema conformance, and the CLI (dry-run + merge). `AD1` bumped to the 7-adapter
  registry.

### Decided (two judgment calls — implemented as specified, documented not hidden)
- **gitleaks SUPERSEDES a co-located LLM `secrets-credentials` finding** (desired — it enforces the core
  principle for its class). The bounded over-supersede risk (a DIFFERENT secrets-credentials issue at the
  same overlapping line) is the same already-accepted dimension-fallback risk as `crud-fls`/`sharing`
  (both share `apex-exposed-surface`); hardening is tracked under §10 extension #3 (Phase-2b).
- **Cross-DETERMINISTIC-engine dedup stays §10 extension #3 (Phase-2b).** The same secret found by
  gitleaks AND njsscan's `node_secret` (and later detect-secrets) produces N ledger rows; that
  cross-engine collapse is extension #3 — the SAFE under-merge — NOT this slice.

## [0.8.34] — 2026-06-29

**Deterministic-findings Phase 2 · adapter 2a #4 — the njsscan adapter (the THIRD `tool→band`
adapter, the FIRST with a different input shape) (docs/roadmap-deterministic-findings.md §10).**
njsscan is the Node language-gate SAST tool (run-scans Family 7, alongside Semgrep/Bandit/gosec).
It carries a real per-finding `severity` (`ERROR`/`WARNING`/`INFO`), owns no toolkit class, and
groups under `external-sast` — the same severity model as Semgrep/Bandit — so it **reuses
`buildFinding`'s `bandFromTool` path with ZERO harness-core change** (one new adapter object + one
severity map + tests; **no `buildFinding` edit, no `CLASS_DEFS` edit**). The ONE new thing is
njsscan's **nested-object JSON** (`{nodejs:{…},templates:{…}}`, each section keyed by rule_id), NOT
a flat `results[]`, so it has its own `parse` that reads BOTH sections (a rule can list multiple
files → one finding per file occurrence) and derives the CWE reference URL from a `CWE-###` prefix.
Validated by "parse twice → identical" against the real captured fixture (2 nodejs findings — one
`ERROR`, one `WARNING`), NO campaign. Suite **55 files / 627 checks** (was 55 / 611; +16 `NJ*`
checks folded into `test-ingest-scanner-findings`). Tag stays **HELD** (0.9.0 reserved).

### Added
- **`harness/ingest-scanner-findings.mjs` — the `njsscan` adapter** (`file-parser`,
  `engine:'njsscan'`). `collect()` reads the `--input` JSON (null-safe on missing/non-JSON/empty);
  `parse()` iterates BOTH the `nodejs` and `templates` sections — each an object keyed by rule_id —
  defensively (an absent/null/non-object section, a null rule object, a missing `files`/`metadata`,
  a file with no `file_path` are all skipped, never a crash), mapping each file occurrence to a hit
  carrying the resolved tool band and a CWE reference URL derived from `metadata.cwe`. `classify()`
  is the constant **`null`** — an njsscan finding owns **no toolkit class** (its severity is the tool
  band, and it must not over-escalate onto a `fail-*` blocker class). NO `securityRelevant`
  (security-by-construction — njsscan is a security scanner). `dimension: 'external-sast'` (the same
  deterministic-only grouping label as Semgrep/Bandit). Registered as the **6th** adapter; `AD1` now
  asserts the 6-adapter registry.
- **`NJSSCAN_SEVERITY_TO_FINDING`** export — `{ ERROR: 'high', WARNING: 'medium', INFO: 'low' }`; any
  other/unknown or missing `severity` maps to `info` with an honest note, never dropped. (It equals
  `SEMGREP_SEVERITY_TO_FINDING`, but njsscan is a distinct tool so it carries its own named map per the
  per-tool idiom.)
- **`acceptance/fixtures/njsscan-solano.json`** — genuine captured njsscan 0.4.3 output (2 nodejs
  findings; relative-path, leak-clean): the ERROR anchor `node_secret` (CWE-798 hardcoded secret) on
  `server/index.js:23` and the WARNING anchor `helmet_feature_disabled` (CWE-693) on
  `server/index.js:14`. Because the real fixture has no `templates`-section / multi-file / `INFO`
  occurrences, those cases use small INLINE synthetic input.
- **`acceptance/test-ingest-scanner-findings.mjs`** — an `NJ*` section (+16 checks): determinism, the
  `ERROR→high` anchor (`external-sast`, no `class`, the derived CWE URL in the reasoning), the
  `WARNING→medium` anchor, count (exactly 2), the **templates-section** + **multi-file** synthetics
  (proves BOTH sections are read and one finding lands per file occurrence), the inline
  `INFO→low`/`CRITICAL→info-never-dropped` band synthetics, the **tool→band severity** check (mutating
  `WARNING→ERROR` MOVES the band — the same deliberate behaviour as `SG`/`BN`, the INVERSE of
  `S1`/`CK-severity-from-class`), the constant `classify()`→`null` + no `securityRelevant` + no `class`
  key, the `NJSSCAN_SEVERITY_TO_FINDING` shape, the **no-CWE** case (missing/non-CWE `metadata.cwe` →
  `resources:[]`, still ingested), fail-safe over every degenerate nested shape
  (`parse(null/{}/{nodejs:null}/{nodejs:{}}`/ a null rule / no `files` / no `file_path`)), idempotent
  merge, schema conformance, and the CLI (dry-run + merge). `AD1` bumped to the 6-adapter registry.

### Decided (one judgment call — implemented as specified, documented not hidden)
- **`ERROR → high`, NOT critical/blocker** (the same calibration call as Semgrep `ERROR→high` /
  Bandit `HIGH→high`). A mechanical SAST hit flags a sink but does NOT confirm reachability;
  escalating to a critical/blocker is the reachability judgment that belongs to the LLM/human residual.
  `scan-external-sast` is `major`; that requirement gate governs the band, not the per-finding tool
  severity.
- **`node_secret` ↔ secrets-class dedup is deferred.** njsscan's `node_secret` rule (CWE-798 hardcoded
  secret) OVERLAPS the secrets class the future `gitleaks`/`detect-secrets` (`fail-hardcoded-secrets`)
  adapters will own. Here it ingests as an `external-sast` `tool→band` finding; de-duplicating it
  against a co-located secrets-scanner finding is **cross-engine dedup = §10 extension #3 (Phase-2b)**,
  not this slice — the SAFE under-merge (a duplicate may survive in the band, never a dropped finding).

## [0.8.33] — 2026-06-29

**Deterministic-findings Phase 2 · adapter 2a #3 — the Bandit adapter (the proof the `tool→band`
path GENERALIZES) (docs/roadmap-deterministic-findings.md §10).** Bandit is the Python language-gate
SAST tool (run-scans Family 7, alongside Semgrep/njsscan/gosec). It is the SECOND genuine `tool→band`
adapter and the proof the 0.8.32 Semgrep generalization GENERALIZES: Bandit carries a real per-finding
`issue_severity` (`HIGH`/`MEDIUM`/`LOW`), owns no toolkit class, and groups under `external-sast` —
exactly Semgrep's shape — so it **reuses `buildFinding`'s `bandFromTool` path with ZERO harness-core
change**. One new adapter object + one severity map + tests; **no `buildFinding` edit, no `CLASS_DEFS`
edit**. Validated by "parse twice → identical" against the real captured fixture (4 results, all
`MEDIUM`), NO campaign. Suite **55 files / 611 checks** (was 55 / 598; +13 `BN*` checks folded into
`test-ingest-scanner-findings`). Tag stays **HELD** (0.9.0 reserved).

### Added
- **`harness/ingest-scanner-findings.mjs` — the `bandit` adapter** (`file-parser`, `engine:'bandit'`).
  `collect()` reads the `--input` JSON (null-safe on missing/non-JSON/empty); `parse()` reads
  `results[]` (defensive on a missing `results`/`line_number`; skips a result with no `test_id`),
  mapping each to a hit carrying the resolved tool band (`more_info` URL preferred for `resources`,
  falling back to `issue_cwe.link`). `classify()` is the constant **`null`** — a Bandit finding owns
  **no toolkit class** (its severity is the tool band, and it must not over-escalate onto a `fail-*`
  blocker class). NO `securityRelevant` (security-by-construction — Bandit is a security scanner).
  `dimension: 'external-sast'` (the same deterministic-only grouping label as Semgrep). Registered as
  the **5th** adapter; `AD1` now asserts the 5-adapter registry.
- **`BANDIT_SEVERITY_TO_FINDING`** export — `{ HIGH: 'high', MEDIUM: 'medium', LOW: 'low' }`; any
  other/unknown or missing `issue_severity` maps to `info` with an honest note, never dropped.
- **`acceptance/fixtures/bandit-coldstart-full.json`** — genuine captured Bandit output (4 results,
  all `MEDIUM`; relative-path, leak-clean): the anchor `B608` (`hardcoded_sql_expressions`, CWE-89) on
  `mcp/server.py:46`, plus 2× `B310` (urllib at `:76` & `:89`, same `test_id` → 2 distinct findings)
  and `B104` (bind-all-interfaces). Because the real fixture is all-`MEDIUM`, the `HIGH`/`LOW`/unknown
  band cases use small INLINE synthetic results.
- **`acceptance/test-ingest-scanner-findings.mjs`** — a `BN*` section (+13 checks): determinism, the
  `MEDIUM` anchor (`→ medium`, `external-sast`, no `class`, the `more_info` URL in the reasoning),
  count (4 medium), two-distinct (same `test_id`, lines 76/89), the inline `HIGH→high`/`LOW→low`/
  `CRITICAL→info-never-dropped` band synthetics (also exercising the `more_info`-vs-`issue_cwe.link`
  resources fallback), the **tool→band severity** check (mutating `MEDIUM→HIGH` MOVES the band —
  the same deliberate behaviour as `SG`, the INVERSE of `S1`/`CK-severity-from-class`), the constant
  `classify()`→`null` + no `securityRelevant` + no `class` key, the `BANDIT_SEVERITY_TO_FINDING`
  shape, fail-safe (missing file / `parse(null/{}/{results:null}/{results:[]})` / missing
  `line_number`/`test_id`), idempotent merge, schema conformance, and the CLI (dry-run + merge).

### Decided (two judgment calls — implemented as specified, documented not hidden)
- **`HIGH → high`, NOT critical/blocker** (the same calibration call as Semgrep `ERROR→high`). A
  mechanical SAST hit flags a sink but does NOT confirm reachability; escalating to a critical/blocker
  is a reachability judgment that belongs to the LLM/human residual (the
  "reachability-is-a-precondition" rule). `scan-external-sast` is `major`; that requirement gate
  governs the band, not the per-finding tool severity.
- **`issue_confidence` is NOT used for the band** in this slice. Bandit emits an `issue_confidence`
  (`HIGH`/`MEDIUM`/`LOW`) alongside `issue_severity`; the band is taken from `issue_severity` only, and
  confidence is recorded for reference. A confidence-weighted refinement is a deliberate, tracked
  **Phase-2b** deferral (mirrors Checkov's per-check-severity deferral) — not an oversight.

## [0.8.32] — 2026-06-29

**Deterministic-findings Phase 2 · adapter 2a #2 — the Semgrep adapter + the `tool→band`
severity generalization (docs/roadmap-deterministic-findings.md §10).** Semgrep is the
multi-language SAST keystone (run-scans Family 7). Its findings cleared the
`scan-external-sast` requirement in `evidence/index.json` but never became ledger findings;
this adapter parses Semgrep's JSON into `provenance:'deterministic'` findings. The decisive
difference from Checkov / Code-Analyzer: Semgrep carries a REAL per-result severity
(`ERROR`/`WARNING`/`INFO`), so this is the **FIRST genuine `tool→band` adapter** — the tool's
own band drives the finding severity (the INVERSE of the class-severity adapters). One new
adapter object in the existing registry **plus a small additive generalization of
`buildFinding`** — no harness rewrite. Validated by "parse twice → identical" against TWO real
fixtures (a WARNING anchor + an ERROR anchor), NO campaign. Suite **55 files / 598 checks**
(was 55 / 583; +15 `SG*` checks folded into `test-ingest-scanner-findings`). Tag stays
**HELD** (0.9.0 reserved).

### Added
- **`harness/ingest-scanner-findings.mjs` — the `semgrep` adapter** (`file-parser`,
  `engine:'semgrep'`). `collect()` reads the `--input` JSON (null-safe on missing/non-JSON/empty);
  `parse()` reads `results[]` (defensive on a missing `results`/`extra`/`start`; skips a result
  with no `check_id`), mapping each to a hit carrying the resolved tool band. `classify()` is the
  constant **`null`** — a Semgrep finding owns **no toolkit class** (its severity is the tool band,
  and it must not over-escalate onto a `fail-*` blocker class). NO `securityRelevant`
  (security-by-construction — the toolkit runs Semgrep with the security rulesets
  `p/security-audit` / `p/secrets` / `p/<lang>`). `dimension: 'external-sast'` is a
  deterministic-only grouping label (no `methodology/dimensions/` file, like checkov's
  `infrastructure-iac`). Registered as the **4th** adapter; `AD1` now asserts the 4-adapter registry.
- **`SEMGREP_SEVERITY_TO_FINDING`** export — `{ ERROR: 'high', WARNING: 'medium', INFO: 'low' }`;
  any other/unknown severity (Semgrep's rare `INVENTORY`/`EXPERIMENT` rule classes) maps to `info`
  with an honest note, never dropped.
- **`buildFinding` `tool→band` generalization (ADDITIVE).** A THIRD severity path on the
  **unmapped side only**, gated on a new optional `bandFromTool` (with `dimensionHint` +
  `toolSevLabel`): when set, the finding's severity IS the resolved tool band and its dimension is
  the hint, with a `severity from the <engine> tool band (<label> → <band>); … gated by
  scan-external-sast (major)` reasoning. When absent, the existing `CA_SEVERITY_TO_FINDING`
  fallback is unchanged (now also honouring `dimensionHint`). **The MAPPED class-severity branch
  is UNTOUCHED** — a mapped `classKey` always wins (proven by `S1` + the new
  `SG-buildFinding-MAPPED-regression`: a deliberately-low `bandFromTool` cannot pull a `crud-fls`
  finding off its class severity). The ingest core's unmapped-hit note is now band-aware (an
  accurate "the semgrep tool band (WARNING → medium)" instead of the misleading
  "Code-Analyzer-severity fallback" for a tool→band hit).
- **`acceptance/fixtures/semgrep-coldstart-full.json`** (2× `WARNING`, dynamic-urllib / SSRF on
  `mcp/server.py:76` & `:89`; same `check_id`, distinct lines → 2 distinct findings) and
  **`acceptance/fixtures/semgrep-helios.json`** (1× `ERROR`, `detect-child-process` / CWE-78 on
  `server/index.js:28`) — genuine captured Semgrep OSS output (both relative-path, leak-clean), the
  two real anchors covering BOTH tool severities.
- **`acceptance/test-ingest-scanner-findings.mjs`** — an `SG*` section (+15 checks): determinism,
  the WARNING anchor (`→ medium`, `external-sast`, no `class`, the metadata reference URL in the
  reasoning), the ERROR anchor (`→ high`), two-distinct (same `check_id`, lines 76/89), the
  **tool-band severity** check (mutating `WARNING→ERROR` MOVES the band — explicitly the INVERSE of
  `S1`/`CK-severity-from-class`, with an in-test comment forbidding "harmonization"), the constant
  `classify()`→`null` + no `securityRelevant` + no `class` key, unknown-severity (`INVENTORY` → info
  with a note), the `SEMGREP_SEVERITY_TO_FINDING` shape, two `buildFinding` unit checks (the
  tool-band path AND the mapped-path regression), fail-safe, idempotent merge, schema conformance,
  and the CLI (dry-run + merge).

### Decided (two judgment calls — implemented as specified, documented not hidden)
- **`ERROR → high`, NOT critical/blocker** (calibration-faithful). A raw Semgrep `ERROR` flags a
  sink but does NOT confirm reachability; escalation to a critical/blocker is a reachability
  judgment that belongs to the LLM/human residual (the "reachability-is-a-precondition" rule,
  sessions 120-122), which a mechanical SAST hit lacks. `scan-external-sast` is `major`; a blocker
  on a confirmed critical in reviewer-reachable code requires that confirmation.
- **Semgrep owns no class → it supersedes nothing.** De-duplicating a co-located LLM injection
  finding against a Semgrep finding at the same sink is **cross-engine dedup = roadmap §10
  extension #3 (Phase-2b)**, NOT this slice — the SAFE under-merge (a duplicate may survive in the
  band), never a dropped scanner finding. Tracked as a §10 follow-up, not a silent gap.
- **`tool→band` is NOT a violation of severity-from-class (§9).** Code Analyzer's Apex rules re-home
  onto the review's 3 wobbled CLASSES whose severity the review defines; Semgrep's general SAST
  rules map onto NO such class, so the tool's own `ERROR/WARNING/INFO` is the meaningful per-finding
  signal (a `WARNING` SSRF is genuinely *medium*, not the class-`high` you'd get by collapsing every
  SAST hit to `scan-external-sast = major`). This is the honest model *for SAST* — and the path
  `bandit` / `njsscan` / `gosec` will reuse verbatim.

## [0.8.31] — 2026-06-29

**Deterministic-findings Phase 2 · adapter 2a #1 — the Checkov adapter
(docs/roadmap-deterministic-findings.md §10).** Phase 1 made the three wobbled blocker classes
(CRUD/FLS, sharing, ViewAll/ModifyAll) deterministic; Phase 2 rolls the §10 per-scanner adapters,
one new adapter object per scanner. This is the FIRST: **Checkov** (IaC misconfig — run-scans
Family 8 over the Dockerfile / Terraform / CloudFormation / K8s). Checkov's `failed_checks` now
become `provenance:'deterministic'` ledger findings grounded in the new `iac-misconfig` class
(baseline `scan-iac-misconfig`). No harness rewrite — it is one new adapter in the existing
registry, validated by "parse twice → identical", NO campaign. Suite **55 files / 583 checks**
(was 55 / 570; +13 `CK*` checks folded into `test-ingest-scanner-findings`). Tag stays **HELD**
(0.9.0 reserved).

### Added
- **`harness/ingest-scanner-findings.mjs` — the `checkov` adapter** (`file-parser`, `engine:'checkov'`).
  `collect()` reads the `--input` JSON (null-safe on missing/non-JSON/empty); `parse()` handles
  BOTH Checkov shapes — a single framework result OBJECT *and* an ARRAY of result objects (Checkov
  emits an array when several frameworks run) — reading only `results.failed_checks` (defensive on
  a missing `results`/`failed_checks`); each failed check → an `iac-misconfig` finding. `classify()`
  is the constant `iac-misconfig` (every Checkov failed check is an IaC misconfig — Checkov is NOT
  in `RULE_CLASS`). Like `metadata-viewall` it is **security-by-construction**: NO `securityRelevant`
  predicate (no ApexDoc-style noise to filter — the ingest core keeps every emitted hit). Only
  `failed_checks` become findings; `passed_checks` / `skipped_checks` / `parsing_errors` never do.
- **`acceptance/fixtures/checkov-dockerfile-solano.json`** — genuine Checkov 3.3.2 dockerfile
  output (host path prefix genericized per CONVENTIONS §3; the adapter never reads it). The anchor
  `CKV_DOCKER_2` (missing HEALTHCHECK) over `passed=24 / failed=1` is the deterministic test ground.
- **`acceptance/test-ingest-scanner-findings.mjs`** — a `CK*` section (+13 checks): determinism,
  the `CKV_DOCKER_2` anchor (deterministic/checkov/iac-misconfig/`infrastructure-iac`/high/`Dockerfile:1`,
  guideline URL in reasoning), failed-only (the 24 passed → 0), severity-from-class (an enterprise
  `severity:LOW` stays high), the multi-framework ARRAY shape, multiple-and-skip, the constant
  `classify()` + no `securityRelevant`, malformed-check skip, fail-safe, idempotent merge, schema
  conformance, and the CLI (dry-run + merge). `AD1` now asserts the 3-adapter registry.

### Decided
- **Severity = the `iac-misconfig` CLASS, never the tool number** (faithful to the ratified
  severity-from-class decision, roadmap §9). It is also the only deterministic option in practice:
  Checkov OSS emits `severity: null` (per-check severity is a Prisma/Bridgecrew enterprise field), so
  a literal tool→band mapping has no input cold. The roadmap §10 `checkov` row's *Severity source*
  is reconciled from `tool→band` to `class (scan-iac-misconfig)`.
- **Precision trade-off (documented, not hidden):** every Checkov failed check lands at the class
  band (high), so a hygiene-only check (the fixture's missing-HEALTHCHECK `CKV_DOCKER_2`) surfaces
  as a high the owner dispositions in the FP dossier — consistent with how `metadata-viewall` lands
  every over-grant at high. A curated per-check (CKV-id → severity) refinement, or an enterprise
  `severity` / Prisma `severityKind:'advisory'` fork, is a **Phase-2b follow-up** (deferred with the
  OSV/npm CVSS fork).

## [0.8.30] — 2026-06-26

**Deterministic-findings Phase 1 · Slice 3 — journey integration + live acceptance
(docs/roadmap-deterministic-findings.md). PHASE 1 COMPLETE.** Slices 1+2 built and unit-tested
the two engines; this slice WIRES them into the real flow so they APPLY. The deterministic pass
now runs **FIRST** (before the LLM fan-out) and reconcile runs **LAST** (after the merge), in
the skills the journey actually drives. Net effect: the three wobbled blocker classes (CRUD/FLS,
sharing, ViewAll/ModifyAll) are deterministic end-to-end — validated by "run the engine twice →
identical", not a 5-run campaign. Suite **55 files / 570 checks** (was 54 / 554;
+`test-deterministic-integration` (16)). Tag stays **HELD** (0.9.0 reserved). Phase 2 = the §10
per-scanner adapters (build order 2a/2b) next.

### Added
- **`acceptance/test-deterministic-integration.mjs`** (16 checks) — the standing INTEGRATION
  guard that drives the **real CLI sequence** end to end on a tmp ledger off the committed
  `acceptance/fixtures/` (no `sf`, no LLM, no network): the deterministic pass
  (`metadata-viewall` source scan + `code-analyzer` file-parser) seeds
  `provenance:'deterministic'` CRUD/FLS + ViewAll findings; a co-located same-class LLM finding
  (standing in for merge-ledger's product) is SUPERSEDED by `reconcile-provenance.mjs` while
  off-class / off-locus LLM findings SURVIVE; reconcile is idempotent; the reconciled open band
  excludes the superseded finding. Plus **WIRING assertions**: audit-codebase GRANTS + INVOKES
  both harnesses with the ingest BEFORE the LLM fan-out (`build-audit-engine.mjs --plugin`) and
  the reconcile AFTER the merge (`merge-ledger.mjs`), the `sf`-absent → PENDING-OWNER-RUN (never
  LLM-fill) note present; the journey REFERENCES both harnesses with the same ordering + note.
- **`docs/deterministic-findings-acceptance.md`** — the operator runbook for the **live** Solano
  acceptance (Level B, needs `sf` + Code Analyzer): generate the fixture, run Code Analyzer into
  `evidence/`, run the deterministic pass, confirm the three anchors come through
  `provenance:'deterministic'` from the scanner (severity-from-class, no LLM in that path), the
  co-located LLM duplicates are superseded, and — the campaign replacement — the **deterministic
  band is byte-identical run-to-run**. Documents the honest ceiling (only the deterministic-owned
  classes are stable; the LLM residual is still a sample; Salesforce pen-tests regardless).

### Changed
- **`skills/audit-codebase/SKILL.md`** — new **Step 4b "Deterministic pass FIRST"**: before the
  Step 5 LLM fan-out, run `ingest-scanner-findings.mjs --scanner metadata-viewall` (always) and
  `--scanner code-analyzer` (when a `.security-review/evidence/code-analyzer-*.json` exists), so a
  `provenance:'deterministic'` finding exists when the verifier defers; **`sf` absent →
  PENDING-OWNER-RUN, never LLM-fill, never drop** (the LLM KEEPS those findings as `llm-inferred`
  — the fixrun4 dropped-blocker fix). At the end of **Step 6** (after `merge-ledger.mjs`), run
  `reconcile-provenance.mjs --target` as the LAST merge step; **Step 7** now RE-RENDERS the recap
  so the headline + band reflect the reconciled state. Both harnesses added to `allowed-tools`.
- **`skills/security-review-journey/SKILL.md`** — the Audit step (AUTONOMOUS RUN Step 2) now
  documents the deterministic-pass-before-fan-out + reconcile-after-merge ordering audit-codebase
  introduces, the `sf`-absent → PENDING posture, and the cold-run note (Scans produces the Code
  Analyzer JSON after the audit, so CRUD/FLS is PENDING on a first run and deterministic on
  re-audit).
- **`skills/run-scans/SKILL.md`** — "What feeds the next skill" now states that Family 1's
  `code-analyzer-<date>.json` is consumed by audit-codebase's deterministic pass: running this
  phase is what flips the CRUD/FLS + sharing classes from PENDING-OWNER-RUN to deterministic.

### Roadmap
- `docs/roadmap-deterministic-findings.md` — **Slice 3 shipped; Phase 1 COMPLETE.** The three
  wobbled blocker classes are now deterministic end-to-end, validated without a campaign. Phase 2
  (the §10 per-scanner adapters, build order 2a/2b) is next.

## [0.8.29] — 2026-06-26

**Deterministic-findings Phase 1 · Slice 2 — the correctness core
(docs/roadmap-deterministic-findings.md).** Slice 1 shipped the scanner→ledger INGEST path;
this slice makes it correct and authoritative. Three changes: (1) a Security/AppExchange **tag
filter** so the deterministic band carries security findings, not the ApexDoc/naming/codestyle/
Performance noise that dominates raw Code Analyzer output; (2) **LLM-supersession enforcement**
— a deterministic engine finding now structurally demotes a co-located, same-class LLM finding,
so the LLM can never re-report or re-judge what a scanner already determined; (3) the **engine-
absent → KEEP** methodology fix — defer a CRUD/FLS gap to SFGE ONLY on proof the engine ran,
never via a phantom hand-off that drops a real blocker (the `fixrun4` failure). Validated
deterministically (run-twice-identical unit assertions), NOT a campaign. The deterministic-pass-
first journey re-sequencing + the live Solano acceptance are Slice 3. Suite **54 files / 554
checks** (was 53 / 532 — +`test-reconcile-provenance` (18); +3 in `test-ingest-scanner-findings`;
+1 in `test-calibration-fp-patterns`). Tag stays **HELD** (0.9.0 reserved).

### Added
- **`harness/reconcile-provenance.mjs`** — the LLM-supersession ENFORCEMENT engine
  (roadmap §3). `reconcileProvenance(findings)` is a pure, idempotent reconciliation: when a
  `provenance:'deterministic'` finding and an `llm-inferred` finding occupy the SAME owned class
  at the SAME locus (same normalized file + overlapping line span — reusing
  `finding-clusters.mjs` `sameLocation`), the deterministic one WINS and the LLM one is marked
  `status:'superseded'` with `superseded_by` → the deterministic finding's id (kept, never
  deleted — auditable + recoverable, mirroring the refuted-finding posture). CONSERVATIVE by
  design (the "never hide a finding" contract): only a deterministic finding that OWNS a class
  (carries a `class`) supersedes — an unmapped-fallback deterministic finding supersedes nothing;
  the class match is PRECISE when the LLM finding carries an explicit `class`, with a `dimension`
  fallback otherwise; two independent signals (locus AND class) are always required, never locus
  alone; and supersede MARKS, never deletes. A CLI (`--target`, `--json`, `--dry-run`) reconciles
  a target ledger and refuses a corrupted (non-array `findings`) one. Guarded by
  `acceptance/test-reconcile-provenance.mjs` (18 checks: supersession, the different-class /
  different-locus / unmapped-owner negatives, precise-vs-dimension matching, owner-state
  preservation, byte-identical idempotency, input non-mutation, schema conformance, and the CLI).
- **`harness/ingest-scanner-findings.mjs`** — a **Security/AppExchange tag filter** (roadmap §10
  extension #2): `hasSecurityTag(tags)` + an adapter-level `securityRelevant(hit)` predicate
  consulted by `ingest()`. Only a Code Analyzer rule tagged `Security` or `AppExchange` becomes a
  finding; a non-security best-practices rule (ApexDoc, naming, codestyle) and the `Performance`-
  tagged `MissingNullCheckOnSoqlVariable` are FILTERED (with an honest note), so the real Solano
  fixture goes 6 violations → 4 findings. This is a filter on non-security NOISE, **never a drop
  of a security finding** — an unmapped *security*-tagged rule still ingests via the CA-severity
  fallback (the "never drop an unmapped security rule" rule holds). The metadata source-scanner
  carries no filter (every emission is a security over-grant). A MAPPED deterministic finding now
  also carries its owned-`class` label (the key `reconcile-provenance` reads).
- **`templates/audit-ledger.schema.json`** — additively extended `$defs/finding`: a new
  `superseded` value on the `status` enum, plus optional `class` (the owned-class label, kebab
  pattern), `superseded_by` (16-hex id pattern), and `superseded_reason`. No existing required
  field changes; a finding written before this slice validates unchanged.

### Changed
- **`methodology/dimensions/apex-exposed-surface.md` §5/§6** — the defer-to-SFGE / don't-double-
  report verifier guidance is now CONDITIONED on the engine having actually run. A new §5 bullet
  ("Defer to SFGE/Code Analyzer ONLY when that engine actually ran — engine-absent → KEEP") and the
  §6 FP-table row both require a `code-analyzer-*.json` evidence file under
  `.security-review/evidence/` before deferring; with no such file the LLM KEEPS the finding as
  `llm-inferred` at its real severity and flags the class PENDING-OWNER-RUN — never refuting by a
  phantom hand-off to a scan that never ran (the `fixrun4` dropped a real FLS blocker exactly this
  way). Guarded by a presence check in `acceptance/test-calibration-fp-patterns.mjs`.
- **`harness/finding-clusters.mjs`** — exported `sameLocation(a, b)` (was module-private) so
  `reconcile-provenance.mjs` reuses the SAME tested same-code-location primitive instead of
  re-deriving it.

## [0.8.28] — 2026-06-26

**Deterministic-findings Phase 1 · Slice 1 — the scanner→ledger ingest foundation
(docs/roadmap-deterministic-findings.md).** A 5-run cold campaign proved the LLM-generated
blocker band is unstable run-to-run (the Solano CRUD/FLS anchors flickered
`high·high·ABSENT·high·high`), while Code Analyzer (PMD/SFGE) finds those exact bugs
DETERMINISTICALLY every run — its output just never reached the ledger. This slice builds the
missing path: a scanner finding becomes a `provenance:'deterministic'` ledger finding carrying the
`engine` + `ruleId` that fired and a severity taken from the requirement CLASS, never the scanner's
1–5 number and never an LLM. Validated by a unit assertion ("run the parser twice → identical"),
NOT a campaign. INGEST ONLY — LLM-supersession enforcement (reject an LLM finding in a class the
engine owns and ran), the engine-absent→PENDING fix, and journey re-sequencing are Slice 2. Suite
**53 files / 532 checks** (was 52 / 499 — +`test-ingest-scanner-findings` (33)). Tag stays **HELD**.

### Added
- **`harness/ingest-scanner-findings.mjs`** — a PLUGGABLE per-scanner adapter registry, not a
  Code-Analyzer-specific parser. The pure core `ingest(raw, adapter, {repoRoot, pass})` (no Date /
  Math.random / network; byte-deterministic given `raw`) turns scanner/metadata output into ledger
  findings; `collect()` is the only I/O seam. Every adapter is `{ name, kind, collect, parse,
  classify }` and declares one of two KINDS, both shipped in Slice 1 to prove the seam handles N>1
  and both up front:
  - **`code-analyzer`** (`kind:'file-parser'`) — parses a captured Code Analyzer v5 violations JSON
    (`--input`); each violation → one finding at `locations[primaryLocationIndex]`. Future Semgrep /
    OSV / gitleaks / Checkov are new file-parser adapters, not surgery.
  - **`metadata-viewall`** (`kind:'source-scanner'`, `engine:'metadata'`) — greps the repo's
    `permissionsets/*.permissionset-meta.xml` directly (no external tool) for `viewAllRecords` /
    `modifyAllRecords` / `modifyAllData = true` on a CUSTOM object — the one class Code Analyzer
    doesn't cover (it's permission-set XML, not Apex). Standard objects are out of scope (the org
    admin owns the standard-object policy).
  - **Severity from the requirement CLASS, never the scanner number.** A frozen `RULE_CLASS` map
    homes the three campaign-wobbled classes — `ApexCRUDViolation`/`ApexFlsViolation` → crud-fls,
    `DatabaseOperationsMustUseWithSharing`/`ApexSharingViolations` → sharing, the metadata grant →
    viewall-overgrant — and `adjusted_severity` is READ FROM the baseline (`fail-crud-fls` /
    `fail-sharing-model` = `major` → `high`), grounded by a live read of
    `baseline/requirements-baseline.yaml`. The new canonical `REQ_SEVERITY_TO_FINDING`
    (`blocker→critical / major→high / minor→low / informational→info`) is the first conversion
    between the baseline's `severity_if_missing` taxonomy and the finding-severity taxonomy.
  - **An unmapped rule is NEVER dropped** — a scanner finding is real. It is still ingested as
    `deterministic` with a documented Code-Analyzer-severity fallback (`CA_SEVERITY_TO_FINDING`,
    1→critical … 5→info) and a note that Phase 2 extends the class map.
  - **Idempotent, additive merge.** A deterministic finding's id is stable from
    `engine+ruleId+file:line` (one entry per scanner violation at one sink — N distinct sites stay
    N findings), so re-ingesting yields no duplicates; existing llm-inferred findings survive
    untouched; a corrupted (non-array `findings`) ledger is refused, never overwritten.
- **`templates/audit-ledger.schema.json`** — additively extended `$defs/finding` with `provenance`
  (enum `deterministic|llm-inferred`, **default `llm-inferred`** for back-compat — a finding written
  before this field validates unchanged), `engine`, and `ruleId`, plus an `allOf` conditional
  (gated on `provenance` being present) requiring `engine`+`ruleId` when `provenance` is
  `deterministic`. No existing required field changes.
- **`acceptance/fixtures/`** — REAL captured scanner output as test data (kills the
  hand-authored-fixture authorship ceiling): `code-analyzer-solano.json` (the primary — 6 real PMD/
  SFGE violations incl. the `ApexCRUDViolation` Contact-PII anchor the LLM ledger dropped),
  `code-analyzer-sfge-meridian.json` (real SFGE `DatabaseOperationsMustUseWithSharing` for the
  sharing class), and a representative `permissionsets/Solano_Admin.permissionset-meta.xml`
  exercising the custom-over-grant / standard-object / non-over-grant branches.
- **`acceptance/test-ingest-scanner-findings.mjs`** (33 checks) — determinism (ingest twice →
  byte-identical), the anchor landing deterministic with class-severity, severity-from-class
  invariance under a mutated `violation.severity`, the sharing + ViewAll classes, unmapped-but-kept,
  idempotent + additive merge, fail-safe on missing/non-JSON/empty input, schema conformance (a
  focused `$defs/finding` validator: a deterministic finding validates, a legacy llm-inferred
  finding validates, a deterministic finding missing `engine` fails the conditional), the 2-adapter
  / 2-kind registry, and the CLI for both adapters.

### Roadmap
- `docs/roadmap-deterministic-findings.md` — Slice 1 marked shipped under Phase 1. Slice 2 (the
  enforcement half): the merge engine rejects an LLM finding in a deterministic-owned class when
  that engine ran; engine-absent → PENDING-OWNER-RUN (never LLM-fill, never drop); deterministic
  pass FIRST in the journey; the deterministic acceptance on the live Solano fixture.

## [0.8.27] — 2026-06-26

**Presentation-consistency Slice 5 — WI-06 GATES half (the scope-submission gates + final
confirm; INV-05/30/31/32/06). COMPLETES WI-06.** Slice 4 (0.8.25) pinned the scope-submission
REPORT renders; this pins the GATES, applying the gate-spec contract (the ENGINE owns the option
set, the driver renders it VERBATIM) to the last freehand-prompt surfaces in Phase 0. Two semantic
classes, encoded by a new `kind` field on every catalog entry (`consent` ⟺ `consent:true`,
validated at load): **CONSENT-to-act** gates (force-injected decline + the chosen `decision` pipes
to `record-consent`) and **ANSWER** gates (the selected option is RECORDED into the scope manifest,
NOT a consent-to-act — no force-injected decline, not piped). Presentation-only — the finding band
is unchanged, so the 0.8.21 cold tag still certifies it; do NOT re-run the campaign. Suite
**52 files / 499 checks** (was 50 / 471 — +`test-scope-gates` (17) + `test-render-scope-summary`
(11)). Tag stays **HELD**.

### Added
- **`harness/gate-spec.mjs`** — six new gates pinning the scope-submission option sets, plus a
  `kind` taxonomy (`consent | election | answer`) returned on every payload and load-validated
  (`consent ⟺ kind:'consent'`):
  - **`mcp-probe`** (WI-30/INV-30, CONSENT) — the live-endpoint read-only-probe gate. The operator
    picks `STAGING` or `PRODUCTION` (both `affirm`) — that selection IS the environment
    confirmation, so production is never probed silently — or the force-injected `Skip — do not
    probe` (`deny`). `{{URL}}` is the only fillable datum, rendered via a function-replacer so a
    `$`-bearing URL can't expand the template. Throws without `facts.url`.
  - **`scope-confirm`** (WI-06/INV-06, CONSENT) — the final-manifest confirm, mirroring the WI-02
    audit-tier confirm: `{Confirm scope & proceed (default) → affirm, Correct the scope → deny,
    Cancel → deny}`. `Correct the scope` is a navigation-by-label re-open; both non-confirm options
    are the FAIL-SAFE `deny` (never authorize a proceed).
  - **`partner-program`** (WI-05/INV-05, ANSWER family) — the SIX preflight gates (agreement · PBO ·
    promoted · namespace · listing · contacts) via `facts.subGate`, each a FIXED `Yes → affirm /
    No → deny` whose answer is recorded into `operatorConfirmed.<key>`. The `promoted` gate offers
    an `N/A — no package in scope` option ONLY when `facts.noPackage` (no package element); that N/A
    is recorded (by its LABEL) as the distinct `"n/a"` sentinel — NOT `false` — so a legitimate
    MCP-server-only / external-app listing is never shown as a failed promotion gate. Throws on a
    missing/unknown sub-gate.
  - **`clarify-detection`** (WI-31/INV-31, ANSWER) — the NEED-FROM-YOU gate for an ambiguous element
    (`present → affirm / not present → deny / unsure-investigate → deny`); `{{ELEMENT}}` fills the
    question. Throws without `facts.element`. ASK rather than omit — an undetected element drops a
    dimension, an over-detected one drags in a track.
  - **`listing-type`** + **`tenancy`** (WI-32/INV-32, ANSWER) — the two CLOSED choices (managed-pkg /
    mcp-server / both; multi-tenant / single-tenant). Categorical (all `affirm`), the chosen LABEL
    recorded into the manifest. The free-text security-model CLAIMS stay free-text, deliberately
    un-pinned.
  - CLI conveniences `--sub-gate`, `--no-package`, `--url`, `--element` (an explicit `--facts` wins);
    `assertCatalogWellFormed` now EXERCISES every gate through the real selector at load (the
    strongest catalog self-check) and validates the new templates + the partner-program sub-catalog.
- **`harness/render-scope-summary.mjs`** (WI-06/INV-06) — the VERBATIM final scope-manifest summary
  printed at Step 9: a FIXED-field readout (listing type · direction · auto-resolution · repo
  commit · element list in `CANONICAL_ELEMENT_ORDER` · endpoints WITH environment labels, a missing
  one flagged `⚠ UNLABELED` · the applicable count = exact `applicableBaselineIds` length · the
  partner-program gate states rendered HONESTLY from `operatorConfirmed`: ✓ confirmed / ✗ NOT
  confirmed / — N/A (the promoted gate's `"n/a"` sentinel, never a ✗ blocker) / (not recorded),
  never a fabricated ✓ and never collapsing an N/A into a ✗). Deterministic + pure; a
  missing/non-JSON/non-object manifest → an explicit "scope not finalized" line, NEVER a fabricated
  "ready/confirmed" state. Registered in `REGISTERED_SURFACES` (`render-readiness-verdict.mjs`).
- **`acceptance/test-scope-gates.mjs`** (17) + **`acceptance/test-render-scope-summary.mjs`** (11) —
  the Slice-5 standing tests: per-gate determinism + golden option snapshots + fail-closed throws +
  the force-injected decline on the CONSENT gates / none on the ANSWER gates + the `kind` semantics
  distinction + the consent decisions round-tripping through `recordConsent` + the promoted-N/A
  conditional + the `$`-bearing-URL/element-literal guards + the gate→manifest→render N/A honesty
  seam (the `"n/a"` sentinel renders not-applicable, never ✗) + the writer/reader manifest-key
  cross-lock (`PARTNER_PROGRAM_SUBGATES.manifestKey` == `PREFLIGHT_GATES` keys) + the
  whitespace-only-environment loud-flag + the scope-summary skeleton/fail-safe/registration + the
  scope-submission wiring.

### Changed
- **`skills/scope-submission/SKILL.md`** — Steps 2/3/5/6/9 now route their gates through `gate-spec`
  and render VERBATIM (replacing the freehand table-as-prompt in step 5): Step 2 `clarify-detection`
  on ambiguous detection; Step 3 `mcp-probe` CONSENT + `record-consent` BEFORE any curl probe; Step 5
  the six `partner-program` sub-gates (with the sub-gate → `operatorConfirmed` key map); Step 6
  `listing-type` + `tenancy`; Step 9 prints `render-scope-summary` verbatim then runs the
  `scope-confirm` CONSENT gate + records it. `allowed-tools` grants `gate-spec`, `record-consent`,
  and `render-scope-summary`; the Automated-vs-manual recap records the gate-pinning.
- **`acceptance/test-gate-spec.mjs`** — the G4 "every consent gate" reps map gains `mcp-probe` and
  `scope-confirm` (a new consent gate must register representative facts there).
- **`docs/roadmap-presentation-consistency.md`** — WI-06 flipped PARTIAL → DONE; INV-05/06/30/31/32
  flipped to ✓ (0.8.27). WI-07…WI-12 remain backlog.

## [0.8.26] — 2026-06-26

**Honesty-hardening — three contract fixes the Slice-4 off-disk grade surfaced (presentation /
honesty-only, no finding-band change).** Each closes a path where an operator-facing render could
read as cleaner/safer than the truth. (1) `render-recap.mjs --target` no longer emits a false
PROCEED on a dict-corrupted ledger: `factsFromLedger` was coercing a PRESENT-but-non-array
`findings` to `[]` BEFORE the dict-vs-array guard could fire, so the standalone `--target`
re-render read "no open confirmed findings" + PROCEED on an unreadable ledger; it now preserves
the shape into the guard → **UNAVAILABLE** (the legit empty-array / absent-findings cases still
read NONE/PROCEED). (2) `merge-ledger.mjs` no longer SILENTLY drops a corrupted prior ledger's
`findings`: a present-but-non-array prior `findings` was coerced to `[]` then OVERWRITTEN on the
next write (silent false-clean / data loss); it now refuses LOUDLY — a `[merge-ledger] WARNING` to
stderr + `exit 2`, leaving the on-disk ledger untouched so it can be restored. (3)
`render-sf-autoresolve.mjs` secret-guard now covers EVERY cell it renders, not just row values:
the derived-flag host, the row/endpoint/flag/conflict `source`, the recorded-flag detail, and the
conflict's auto-resolved value all route through `safeValue`, and the docstring is softened from
the overclaimed "NEVER RENDERS A SECRET" to its HONEST scope (the producer — scope-submission
step 4 — is the secret-exclusion boundary; a secret embedded mid-string in a free-form value is a
documented defense-in-depth LIMIT, not a guarantee). Presentation/honesty-only — the finding band
is unchanged, so the 0.8.21 cold tag still certifies it; do NOT re-run the campaign. Suite
**50 files / 471 checks** (was 50 / 468 — +1 each to `test-render-recap`, `test-merge-ledger`,
`test-render-sf-autoresolve`). Tag stays **HELD**.

### Fixed
- **`harness/render-recap.mjs`** — `factsFromLedger` preserves a PRESENT-but-non-array `findings`
  (a dict-corrupted/hand-edited ledger) into `renderAuditRecap`'s `findingsPresentNonArray` guard
  instead of coercing it to `[]`, so the `--target` standalone re-render renders **UNAVAILABLE**,
  never a false PROCEED. The dict-vs-array guard (0.8.25) now covers the `--target` path, not just
  the in-process call. An ABSENT `findings` still defaults to `[]` (the legit empty/zero-open case
  still PROCEEDs). Regression-locked by `test-render-recap` RC7.
- **`harness/merge-ledger.mjs`** — a present-but-non-array prior ledger `findings` now triggers a
  LOUD `console.error` warning + `process.exit(2)` (matching the file's existing
  exit-2-on-malformed-`--result` posture) and leaves the on-disk ledger untouched, instead of
  silently coercing it to `[]` and overwriting the recoverable file. A genuinely absent/null
  `findings` still defaults to `[]` silently (no data to lose). Regression-locked by
  `test-merge-ledger` M15.

### Changed
- **`harness/render-sf-autoresolve.mjs`** — the defense-in-depth secret guard (`safeValue`) now
  also covers the derived-flag host, the row/endpoint/flag/conflict `source`, the recorded-flag
  detail, and the conflict's auto-resolved value (previously only the row VALUE column was
  guarded), so a secret-shaped value is redacted EVERYWHERE, not just in one cell. The docstring is
  softened from "NEVER RENDERS A SECRET" to its honest scope: the producer is the actual
  secret-exclusion boundary, this render is a backstop over the cells it guards, and an
  embedded-mid-string secret in a free-form value is a documented LIMIT (the entropy match is
  whole-value-anchored). No over-redaction of legitimate non-secret values — determinism + every
  existing render is unchanged. Regression-locked by `test-render-sf-autoresolve` SA6.

## [0.8.25] — 2026-06-26

**The scope-submission REPORT renders are now pinned by engines — presentation-consistency
Slice 4 (WI-06, reports half).** Slice 3 pinned the entry-experience surfaces; this pins the
five scope-submission REPORT surfaces that were still driver-improvised prose: the detected-
architecture-elements summary (INV-15), the applicable-requirements presentation (INV-16), the
MCP listing-direction/auth-profile (INV-43) and live-probe result (INV-44), and the SF-CLI
auto-resolution flags + conflicts (INV-45). **WI-06 is now PARTIAL** — the reports half ships
here; the scope GATES + final confirm (INV-05/30/31/32/06) are Slice 5. Same contract (the
ENGINE owns the skeleton, the driver pastes it verbatim): each render is pure over deterministic
JSON — no LLM, no Date, no random — and fails safe to an HONEST line, never a fabricated
"clean"/"ready". The MCP renders never present an un-probed fact as probed; the auto-resolution
render SURFACES every security flag + operator-answer conflict (never silently dropped or
resolved) and NEVER renders a secret (a secret-named key / token-shaped value is redacted).
Folds in two Slice-3 grade nits: the dict-vs-array honesty guard (a PRESENT-but-non-array
`findings` renders UNAVAILABLE, never NONE/PROCEED) in
`finding-clusters.mjs` + `render-recap.mjs`, and a `render-scan-status.mjs` docstring clarify
(the DONE gate is enforced at the producer). Presentation-only — the finding band is unchanged,
so the 0.8.21 cold tag still certifies it; do NOT re-run the campaign. Suite **50 files / 468
checks** (was 47 / 440). Tag stays **HELD**.

### Added
- **`harness/render-detected-elements.mjs`** (INV-15) — the VERBATIM detected-architecture-
  elements summary: a fixed `| Element | Detected how (evidence) |` table in a frozen
  `CANONICAL_ELEMENT_ORDER` (unknown types appended in manifest order, never dropped) + the
  `listingType` line; the evidence column is the operator's dispute-this provenance. Pure; a
  missing/non-JSON manifest or one with no elements → an honest "scope not detected yet" line.
  Printed verbatim at scope-submission Step 2.
- **`harness/render-mcp-scope.mjs`** (INV-43 + INV-44) — two VERBATIM MCP renders. DIRECTION:
  a fixed listing-direction (B/A/both) caption + the auth-profile table rendered straight from
  the manifest's `mcp.authExpectations` (rendered, NOT re-derived — inbound and outbound have
  opposite rules, never collapsed). PROBE: a probe-status line + the recorded MCP facts table,
  where `probed:false` renders an explicit "recorded from code, NOT live-probed" status and never
  presents an un-probed fact as a probe. No MCP surface → an honest "no MCP surface in scope"
  line. Printed verbatim at scope-submission Steps 2 (direction) + 3 (probe).
- **`harness/render-sf-autoresolve.mjs`** (INV-45) — the VERBATIM SF-CLI auto-resolution render:
  the auto-resolved-rows table + a **Security flags** section (every `http://` non-TLS host,
  wildcard host, host with no matching Named Credential, and `ViewAllRecords`/`ModifyAllData`
  over-grant — DERIVED from the endpoint inventory + permission matrix, merged with any recorded
  flags, deduped — surfaced, never dropped) + a **Conflicts with operator answers** section (the
  CLI is EVIDENCE, not an override — never silently substituted). Gated on the manifest's
  `sfAutoResolved` flag → an honest "auto-resolution skipped" line when it did not run. NEVER
  renders a secret (CONVENTIONS §6): a secret-named key / token-shaped value is redacted. Printed
  verbatim at scope-submission Step 4.

### Changed
- **`harness/applicable-requirements.mjs`** (INV-16) — gains a `--render` mode + exported
  `renderApplicable(entries, elementTypes)`: the VERBATIM operator-facing "which requirements
  apply to you" block (the applicable COUNT = exact list length, ids grouped by track, a
  **Conflicting requirements** section surfacing every applicable `conflicting` entry with its
  `conflicts` text per CONVENTIONS §4, and the **Mobile gap** line when a `mobile` element is in
  scope), DISTINCT from `--json` (which the manifest consumes). `parseBaselineApplies` now
  additively captures `verification` + the folded `conflicts` block scalar (the legacy
  `{id, applies_to}` shape is preserved). Printed verbatim at scope-submission Step 7.
- **`harness/render-readiness-verdict.mjs`** — `REGISTERED_SURFACES` extends with the four
  Slice-4 scope-submission surfaces (detected-elements · applicable-requirements · mcp-scope ·
  sf-autoresolve), so the render-verbatim contract governs them.
- **`skills/scope-submission/SKILL.md`** — `allowed-tools` grants the four render harnesses;
  Steps 2/3/4/7 each call their render and print its stdout VERBATIM (replacing the freehand
  prose), per the pinned-output contract.

### Fixed
- **Dict-vs-array honesty guard, defense-in-depth.** In
  `harness/finding-clusters.mjs` (new exported `clusterOrNullFromFindings`, used by the
  `--headline` ledger-read path) and `harness/render-recap.mjs` (`renderAuditRecap` `present`
  derivation): a `findings` value that is PRESENT but NOT an array (a dict like `{factor:{...}}`)
  now renders the **UNAVAILABLE** branch — never NONE ("no open confirmed findings") or PROCEED.
  A malformed-but-present ledger is not "no findings". Unreachable via the merge-ledger pipeline
  (it forces an array); regression-locked in `test-finding-clusters-headline` + `test-render-recap`.

### Hardened
- **`harness/render-scan-status.mjs`** docstring clarifies (docs-in-code only, no behavior
  change) that the on-disk DONE gate is enforced + regression-locked at the PRODUCER
  (`build-evidence-index.mjs`); the renderer trusts the index's `disposition`/`reviewer_reproducible`
  flags BY DESIGN to stay pure + byte-deterministic.

### Tests
- New `acceptance/test-render-detected-elements.mjs` (6), `test-render-mcp-scope.mjs` (7),
  `test-render-sf-autoresolve.mjs` (7); extended `test-applicable-requirements.mjs` (+6 `--render`
  cases incl. the verification/conflicts parse), `test-finding-clusters-headline.mjs` (+1 dict
  guard), `test-render-recap.mjs` (+1 dict guard). Each new render: determinism + golden snapshot
  + fail-safe on missing/non-JSON/empty input + skill-wiring (grants + references + "print
  verbatim"). Suite **50 files / 468 checks**.

## [0.8.24] — 2026-06-26

**The entry-experience renders are now pinned by engines — presentation-consistency Slice 3
(WI-04 + WI-05).** Slices 1–2 pinned the gate option sets and the readiness verdict; this pins
the six most-seen ENTRY surfaces that were still driver-improvised prose: the finding-cluster
triage headline (the FAILURE VERDICT — it now reads byte-identically at the audit exec summary
AND the journey blocker gate), the target-map approval table, the end-of-run audit recap, the
3-tier preflight report (with the deployed-org power-up as a FIXED 4-state enum), the scan-status
summary, and the router "where are we?" status. Same contract (the ENGINE owns the skeleton, the
driver pastes it verbatim): each render is pure over deterministic engine JSON — no LLM, no Date,
no random — and fails safe to an honest line, never a fabricated "clean". Presentation-only — the
finding band is unchanged, so the 0.8.21 cold tag still certifies it; do NOT re-run the campaign.
Suite **47 files / 440 checks** (was 41 / 402). Tag stays **HELD**.

### Added
- **`harness/render-target-map.mjs`** (INV-12) — the VERBATIM target-map approval display: a
  fixed `{dimension | applicable | targets | why | confidence | unresolved}` table, applicable
  rows FIRST (in file order), UNRESOLVED dimensions flagged. Pure; a missing/non-JSON source →
  an honest "not resolved yet" line, never a fabricated map. Printed verbatim in the one
  pre-fan-out approval `AskUserQuestion` (audit-codebase Step 3).
- **`harness/render-preflight.mjs`** (INV-07) — the VERBATIM one-page 3-tier preflight report
  (✓ DETECTED / ⚠ NEED-FROM-YOU / ✦ OPTIONAL POWER-UPS) rendered from the deterministic detector
  JSONs (baseline-counts · package-readiness · tool-detect · stack-detect · docker-check). The
  deployed-org power-up line is a FIXED 4-state enum (`installable` / `needs-build-buildable` /
  `needs-build-unregistered` / `no-package`) — `DEEP_AUDIT_STATES` + the total `deepAuditState()`
  selector; only the readiness-reason fills. A missing detector → an honest "not detected" line.
- **`harness/render-scan-status.mjs`** (INV-13) — the VERBATIM scan-status summary: a FIXED 8-row
  Family table in canonical Family 1–8 order with locked columns (`Family | Applies | Runner |
  Status | Evidence file | Gate id | Next command if PENDING`), rendered from the evidence
  `index.json` + the scope manifest. DONE requires a reviewer-reproducible report ON DISK — a
  plan with no report is PARTIAL, never DONE (CONVENTIONS §2). `SCAN_FAMILIES` is the frozen catalog.
- **`harness/render-router-status.mjs`** (INV-33) — the VERBATIM router-mode "where are we?" block:
  a FIXED 3-line status (resume-point · single next-skill · one-sentence reason) over a frozen
  phase ladder; drift → re-scope, a stale ledger → re-audit. A null facts source → "fresh start".
- **`harness/render-recap.mjs`** (INV-34) — the VERBATIM end-of-run audit recap, LED BY the
  finding-cluster headline (byte-identical to the exec summary + blocker gate), then this-pass
  counts, the PROCEED/HALT verdict, and the fixed not-covered caveat. `merge-ledger.mjs` emits it
  to stdout at the end of every pass; audit-codebase Step 7 prints it verbatim.
- **`harness/finding-clusters.mjs` — `renderClusterHeadline` + `--headline`/`--format md`** (INV-08)
  — the VERBATIM finding-cluster triage headline: raw per-severity counts FIRST, then the clustered
  distinct-file view, then the headline narrative. The SAME block at the audit exec summary and the
  journey blocker gate; a missing ledger → an honest "unavailable" line, never a false clean.
- **`harness/package-readiness.mjs` — additive `registered` field** — splits the `needs-build`
  verdict into buildable (a real 0Ho package-id alias exists) vs unregistered, feeding the
  preflight 4-state enum. Additive only; every prior status/verdict is unchanged.
- **Six standing tests** (`test-finding-clusters-headline` · `test-render-target-map` ·
  `test-render-preflight` · `test-render-scan-status` · `test-render-router-status` ·
  `test-render-recap`) + new `registered`-field checks in `test-package-readiness` — determinism,
  a golden snapshot of each fixed structure (column set, row/section order, the 4-state enum, the
  canonical Family 1–8 order), fail-safe on missing/non-JSON input, and a wiring assertion that the
  consuming skill grants + references the harness and states "print verbatim".

### Changed
- **`audit-codebase` Steps 3/6/7** — the target-map approval (Step 3) now shows
  `render-target-map.mjs` stdout verbatim; the exec-summary cluster view (Step 6) is now
  `finding-clusters.mjs --headline` verbatim (the SAME block as the journey blocker gate); Step 7
  prints the `merge-ledger`/`render-recap` recap verbatim. New harness grants in `allowed-tools`.
- **`security-review-journey`** — the preflight report (Step 6) is rendered by `render-preflight.mjs`
  verbatim (the freehand 3-tier bullet contents are gone); the blocker gate uses
  `finding-clusters.mjs --headline` verbatim; the status-only "where are we?" path prints
  `render-router-status.mjs` verbatim. New harness grants in `allowed-tools`.
- **`run-scans` Step 11** — the scan-status readout is rendered by `render-scan-status.mjs` verbatim.
- **`harness/render-readiness-verdict.mjs`** — `REGISTERED_SURFACES` extended with the six Slice-3
  surfaces, so `lintRenderVerbatim` polices them centrally.
- **`CONVENTIONS.md`** — §7 lists the new renders, §8 adds the harnesses to the layout, and the
  test-count line is bumped. **`acceptance/README.md`** — file/check counts updated + the Slice-3
  renders described.

### Roadmap
- `docs/roadmap-presentation-consistency.md` — **WI-04** + **WI-05** marked **done (0.8.24)**;
  inventory rows INV-07 / 08 / 12 / 13 / 33 / 34 flipped to ✓.

## [0.8.23] — 2026-06-25

**Operator-facing OUTPUT is now pinned by an engine — presentation-consistency Slice 2
(WI-00B substrate + WI-03 readiness-verdict).** Slice 1 pinned the gate option sets;
this pins the OTHER improvised surface class — the readiness verdict, rendered from
table-vs-prose / reordered-sections / re-worded-caveat skill prose run-to-run. Same
contract (the ENGINE owns the skeleton, the driver supplies data): a fixed-header
`{{SLOT}}` template + a deterministic fill engine that pastes the SCI block byte-for-byte,
force-injects a single canonical standing caveat, and FAILS CLOSED on any unfilled slot.
Presentation-only — the finding band is unchanged, so the 0.8.21 cold tag still certifies
it; do NOT re-run the campaign. Suite **41 files / 402 checks** (was 39 / 389). Tag stays **HELD**.

### Added
- **`harness/render-stability.mjs`** — the VERBATIM Finding-Stability render (WI-00B
  render-harness). Mirrors `compute-sci.mjs`'s verbatim-block mode: reads
  `recurrence-confidence.json` and emits ONE fixed block in two branches — PRESENT (n≥2):
  the `bucket_counts` table + the `reliably_recurring_blockers` set + the contestable band
  named consistently + a mixed-commit note when `commit_consistency != consistent`;
  ABSENT/single-run: one honest one-liner. Both carry the "informational only — changes
  NOTHING about the SCI gate" caveat; neither ever claims the audit is complete/passed.
  Pure, byte-identical on re-run.
- **`harness/render-readiness-verdict.mjs`** — the verdict FILL ENGINE. Exports the single
  canonical `STANDING_CAVEAT` constant, `fillVerdict(template, slots)` (force-injects the
  caveat so a driver can't paraphrase it; FAILS CLOSED — throws on a missing caveat slot or
  any unfilled `{{SLOT}}`, the "not submission-ready" lint promoted from skill prose to an
  engine), `REGISTERED_SURFACES`, `hasMarkdownTable`, and `lintRenderVerbatim` (flags a
  skill that hand-builds a table for a surface with a registered renderer/template).
- **`templates/operator/readiness-verdict.md.tmpl`** — the new `templates/operator/` dir's
  first skeleton: fixed `##` section order, each a `{{SLOT}}`, every engine block wrapped in
  `<!-- RENDER:… -->` sentinels (SCI block · Ledger Freshness · Finding Stability ·
  Per-category · Blockers · NOT-verified · Open conflicting baseline · Standing caveat).
- **`acceptance/test-render-stability.mjs`** (6 checks) + **`acceptance/test-readiness-verdict.mjs`**
  (7 checks) — determinism, both stability branches, the byte-for-byte SCI paste, the
  force-injected caveat constant, the fail-closed unfilled-slot throw, and the hand-built-table lint.

### Changed
- **`compile-submission` Step 8 (WI-03)** — the readiness verdict is now rendered by FILLING
  the template through `render-readiness-verdict.mjs`, not hand-built. The improvisable
  "render the verdict (pick table-vs-prose / reorder / drop a sub-block)" prose is gone; the
  SCI block is locked to a byte-for-byte `compute-sci` paste, Finding Stability to a
  `render-stability` paste, and the standing caveat to the force-injected constant. Added the
  render-harness grants to `allowed-tools`.
- **`CONVENTIONS.md`** — documents the output render-verbatim substrate + the
  render-verbatim contract/lint (§7), adds the new harnesses + `templates/operator/` to the
  §8 layout, and bumps the test-count line.

### Roadmap
- `docs/roadmap-presentation-consistency.md` — WI-00B / WI-03 marked **done (0.8.23)**;
  inventory rows INV-10 (readiness-verdict) / INV-11 (Finding Stability) / INV-35
  (ledger-freshness) flipped to ✓.

## [0.8.22] — 2026-06-25

**Operator-facing GATES are now pinned by an engine — presentation-consistency Slice 1
(WI-00A + WI-01 + WI-02).** The findings engine is deterministic, but the in-skill
`AskUserQuestion` gate option sets were driver-improvised prose, and a cold campaign caught
the drift: the same depth gate offered a different option set run-to-run (run 1 hard-removed
Exhaustive → `{Standard, Quick}`; run 2 offered it → `{Standard, Quick, Exhaustive}`), and
the tier was re-asked in audit-codebase after the journey already collected it. This applies
the repo's proven contract (the ENGINE owns structure, the driver supplies data) to the gate
class: a frozen catalog + a pure selector own the option set; the driver renders
`label`/`description` VERBATIM and pipes the chosen `decision` to `record-consent`.
Presentation-only — the finding band is unchanged, so the 0.8.21 cold tag still certifies it;
do NOT re-run the campaign. Suite **39 files / 389 checks** (was 37 / 366). Tag stays **HELD**.

### Added
- **`harness/gate-spec.mjs`** — the FROZEN gate catalog + the pure `gateOptions(gateId, facts)`
  selector (WI-00A). Mirrors three shipped patterns: `build-audit-engine`'s `ALWAYS_ON` (the
  decline/skip option is FORCE-INJECTED on every consent gate, so a caller cannot drop it),
  `build-artifact-engine`'s `FOCUS_MIN` THROW (FAIL CLOSED on an unknown gate id or any option
  missing `label`/`description`/`decision`, or a decision that is not a valid `record-consent`
  token), and `applicable-requirements`'s pure set-operation selector style (no LLM, no
  network, byte-identical; the CLI's `--target` ledger read is the only FS touch). Registers
  three gates for this slice — `run-mode`, `audit-tier`, `scanner-install` — and THROWS on any
  other id (later WIs register the rest). CLI
  `--gate <id> [--facts f.json] [--target <repo>] [--scanners "n:m,…"]` prints the exact
  `AskUserQuestion` payload (+ per-option decision tokens) as JSON.
- **`acceptance/test-gate-spec.mjs`** (17 checks) + **`acceptance/test-tier-no-reask.mjs`**
  (6 checks) — determinism (byte-identical re-runs), golden option snapshots, the fail-closed
  throws, the force-injected safe-default present on every consent gate, every emitted
  `decision` round-tripping through the real `recordConsent`, and the journey→audit-codebase
  collect-once / confirm-don't-re-ask flow.

### Changed
- **`security-review-journey` preflight (WI-01)** — the run-mode + audit-tier gate (rendered
  in one `AskUserQuestion` call) and the scanner-install gate now render their option sets
  from `gate-spec.mjs` VERBATIM instead of improvising the prose. The tier election is recorded
  there with the controlled `--decision` token so the launch can be CONFIRMED downstream.
  `audit-tier`'s menu is identical every run — `standard` default, `exhaustive` OFFERED but
  never pre-selected (transparency + agency over silent removal — the run-1-hid-it /
  run-2-offered-it drift is gone), `quick` triage. scanner-install's sha256 / tmp-removed /
  evidence-kept / "this yes also covers RUNNING them, which fetches rules" disclosure is the
  verbatim install description; only the count + the `name(method)` list fill from `tool-detect`.
- **`audit-codebase` Step 2 (WI-02)** — when a tier token is already recorded (journey gate 1),
  gate-spec emits a CONFIRM-and-authorize variant `{Authorize the <locked> launch, Change tier,
  Cancel}` and the step records the LAUNCH authorization (reusing the prior `audit-tier` token
  via `verifyConsent`) instead of re-offering the election. Only "Change tier" re-opens the
  full menu. Kills the redundant tier re-ask. No silent behavior change: `build-audit-engine`
  still verifies `audit-tier` + `audit-targetmap` and fails closed without them.
- **`CONVENTIONS.md`** — documents the gate-spec engine + the render-verbatim-gate contract,
  adds `gate-spec.mjs` to the §8 harness layout, and bumps the test-count line.

### Roadmap
- `docs/roadmap-presentation-consistency.md` — WI-00A / WI-01 / WI-02 marked **done (0.8.22)**.

## [0.8.21] — 2026-06-24

**The ARTIFACT phase is now data-driven — P2 parity with the audit phase.** A cold run AND the
0.8.20 builder's own verification both hit JS-escaping/parse errors authoring a Workflow script
with inline prompt strings (`{status:'ok'}`, nested backticks, regex). The AUDIT phase already
retired this class (the driver supplies scope as DATA in scope-input.json and
`build-audit-engine.mjs` injects it into the shipped, tested `workflow-template.mjs`); the ARTIFACT
phase (generate-artifacts) was still pre-P2 — the driver hand-authored `artifact-engine.mjs` per
run. This brings the same pattern to artifacts. Suite **37 files / 366 checks** (was 36 / 357). Tag
stays **HELD**.

### Hardened
- **New `harness/artifact-workflow-template.mjs`** — the P2 artifact-drafting substrate, a faithful
  mirror of `workflow-template.mjs`: `export const meta` (a `Draft` phase), the
  `/* {{ARGS_OBJECT}} */ null` injection marker, the `const ARGS = … : INJECTED` resolve, the
  loud run-args guard if the marker wasn't replaced, and a `Draft` phase that `parallel()`s one
  read-only agent per artifact — each drafts its `out` from its pre-read `templateContent` + the
  repo + the shared authoritative `facts` (so cross-cutting claims agree by construction). Agents
  RETURN the content; the driver writes each `out` after the Workflow (the runtime has no FS).
- **New `harness/build-artifact-engine.mjs`** — the P2 assembler, a mirror of
  `build-audit-engine.mjs`: `--plugin/--repo/--input`, reads `{artifacts:[{key,tmpl,out,focus}],
  facts, gate}` DATA (the per-artifact `focus` content contract + facts live in DATA, never in JS —
  the escaping class is gone), attaches each pre-read template (THROWS loud on a missing template),
  validates each `focus`, and **ENGINE-ENFORCES the gate**: an artifact whose `key` is in
  `gate.suppress` is DROPPED before injection (`WARN: artifact <key> withheld by the gate — not
  drafted`), so a withheld doc (e.g. authn-authz-flow over an open authN/authZ critical/high)
  PHYSICALLY cannot be drafted — the same fail-closed posture as the audit engine. Injects into a
  copy of the template at the marker (loud-fail if absent) → `.security-review/artifact-engine.mjs`.
- **Rewired `skills/generate-artifacts/SKILL.md`** — replaced the hand-authored-Workflow drafting
  with a data-driven assembly step: write `artifact-input.json` (the `{artifacts,facts,gate}` DATA,
  focus strings in DATA), run `build-artifact-engine.mjs`, then launch the produced
  `artifact-engine.mjs` via the Workflow tool with `scriptPath` (not `args`). The gate honoring is
  now engine-enforced; the content contracts (steps 6–11), the step-12 cross-read, and provenance
  (step 13) are PRESERVED unchanged and stay driver-side. Added
  `Write(**/.security-review/artifact-input.json)` + `Bash(node *harness/{artifact-gate,build-artifact-engine}.mjs *)`
  to allowed-tools.

### Added
- **`acceptance/test-build-artifact-engine.mjs` (9 checks)** — mirrors `test-build-audit-engine.mjs`:
  valid input → engine written + INJECTED carries repoRoot + the artifacts with pre-read templates;
  a suppressed artifact is dropped + warned (gate enforcement); missing template / empty focus /
  absent marker each abort loud; the template's own run-args guard AND its per-artifact guard fire
  against the real source (exercised via the Workflow-runtime async wrapper); every-artifact-withheld
  → exit 2; determinism.

## [0.8.20] — 2026-06-24

**Consolidated driver-improvisation + audit hardening cycle** (three cold-run + external-audit
reviews). Suite **36 files / 357 checks** (was 35 / 349). Tag stays **HELD**.

### Hardened
- **WI-C — deterministic baseline-currency (kills a documented preflight hand-roll).**
  `security-review-journey` SKILL.md told the driver to HAND-ROLL the baseline-currency check
  (rank by newest non-null `last_verified`, avoid the "null sorts ahead of a real date" trap the
  skill itself documented); a cold-run driver tripped on a malformed token doing this.
  `harness/baseline-counts.mjs` now emits currency via `--currency`: `newest_verified` (max
  non-null `last_verified`), `newest_verified_count`, `oldest_verified` — with `null`/malformed
  tokens EXCLUDED from the ranking (ISO `YYYY-MM-DD` sorts lexicographically, so no `Date`
  parsing; Workflow-runtime safe). The skill now runs the counter instead of hand-rolling the
  sort. `acceptance/test-baseline-counts.mjs` adds a case proving a malformed `9999-99-99` never
  out-ranks a real date.
- **WI-G — codify the exhaustive stop-rule for the contestable-band flip.**
  `methodology/audit-methodology.md` §6 stop rule ("two consecutive dry passes") didn't cover a
  pass whose only net-new finding is a contestable-band FLIP (refuted↔confirmed on UNCHANGED code,
  same `audited_commit`) — the run never went "dry," so a cold-run driver had to override by hand.
  Added a clause: such a flip **counts as DRY for the stop rule** (the band is surfaced by
  `recurrence-confidence.mjs` for human adjudication, not certified by run count). A presence
  guard in `test-calibration-fp-patterns.mjs` keeps the clause from silently regressing out.
- **WI-F.1 — head+tail failure-log truncation (better diagnostics; code-level audit).** Scanner/
  DAST failure logs were truncated TAIL-ONLY (`.slice(-1500)`/`.slice(-2000)`), discarding the
  ROOT CAUSE at the TOP of a deep stack trace. New pure `harness/clamp-log.mjs` (`clampLog`) keeps
  the head AND the tail with an elision marker; every LOG truncation in `run-dast.mjs` (×4) and
  `install-scanners.mjs` (×4) now uses it. Guarded by `acceptance/test-clamp-log.mjs`.
- **WI-F.2 — tightened the DAST URL pre-filter (belt-and-suspenders).** `run-dast.mjs` `URL_OK`
  went from `/^https?:\/\/\S+$/i` to `/^https?:\/\/[^\s\x00-\x1f<>"'\\]+$/i`, rejecting control/
  encoding-trick chars. The real boundary stays the `new URL()` + LOOPBACK host-check; the
  bracketed-IPv6 and all loopback cases are unaffected (no test changes).

## [0.8.19] — 2026-06-24

**WI-E — CI least-privilege (caught by an external security audit of the public repo).** Suite
**35 files / 349 checks** (was 34 / 346). Tag stays **HELD**.

### Hardened
- **`.github/workflows/test.yml` pinned to a least-privilege `GITHUB_TOKEN`.** The workflow had no
  top-level `permissions:` block, so its token inherited the repo-default scope — the first thing a
  Salesforce Product Security reviewer checks. The workflow only checks out the repo and runs the
  dependency-free test suite, so it now declares a top-level `permissions: { contents: read }` and
  nothing else. No write token, no inherited scope.

### Added
- **`acceptance/test-ci-hygiene.mjs` (3 checks) locks it.** A dependency-free standing test reads
  `.github/workflows/test.yml` as text and asserts it declares a TOP-LEVEL `permissions:` block
  granting `contents: read` and **no** write scope (rejects any `: write` token and `write-all`). A
  future edit that drops or widens the workflow's permissions then fails the build (verified: a
  `contents: write` workflow fails the test).

## [0.8.18] — 2026-06-24

**WI-D — the final piece of the driver-improvisation hardening: make the post-Workflow ledger-merge
step unambiguous so the driver stops fumbling it.** A cold run PROBED the Workflow output file
(parse-failed), needlessly hand-extracted `.result` into a separate file, and fumbled the
`merge-ledger.mjs` invocation — because the skill said only "write the return to a file, then merge",
while `merge-ledger.mjs:59` already unwraps the Workflow envelope (`wrapper.result.ledger_updates ?
wrapper.result : wrapper`). Skill-clarity + a test that locks the unwrap. Suite **34 files / 346
checks** (was 34 / 344). Tag stays **HELD**.

### Hardened
- **Explicit, zero-improvisation merge step (`skills/audit-codebase/SKILL.md`).** Rewrote the merge
  instruction: the Workflow tool already writes its run to a TASK-OUTPUT FILE as an envelope
  (`{summary, result, workflowProgress}`); point `merge-ledger --result` DIRECTLY at that
  task-output file — the engine unwraps `.result` automatically (`merge-ledger.mjs:59`). Do NOT probe
  the file, hand-extract `.result`, or re-parse the envelope. The exact command form is spelled out
  with `--result <workflow-task-output-file>`.
- **Mirrored in the sequential fallback (`harness/sequential-fallback.md`).** The "ledger merge stays
  mechanical" bullet now names the SAME `merge-ledger.mjs` engine and its both-shapes tolerance (raw
  envelope or pre-extracted `{ledger_updates}`), so the no-Workflow substrate gets the same
  point-`--result`-at-the-file-directly guidance.
- **Defensive clear error (`harness/merge-ledger.mjs`).** The line-59 unwrap's downstream guard now,
  when the resolved object has no `ledger_updates` array, exits 2 with a CLEAR error naming BOTH
  accepted shapes (raw Workflow task-output envelope vs pre-extracted result) and telling the caller
  not to hand-extract — instead of the prior terse "no result.ledger_updates array" (which read like
  a bug rather than a shape mismatch). Never a silent empty merge.

### Added
- **Two `test-merge-ledger.mjs` checks (M13, M14; 15 checks total).** M13 — UNWRAP LOCK: a RAW Workflow
  envelope `{summary, result:{ledger_updates}, workflowProgress}` merges to byte-IDENTICAL findings as a
  pre-extracted `{ledger_updates}` (locks the `:59` unwrap so the skill's "point at the raw file" promise
  can't silently regress). M14 — the clear error fires (exit 2, names both shapes) on a `--result` with no
  `ledger_updates`.

### Roadmap
- **WI-C still DEFERRED** (carried from 0.8.17): a deterministic baseline-currency-date harness. The driver
  hand-rolls the currency-date calc and tripped on a token; it does not affect findings. Promote it to a
  pure `harness/*.mjs` + standing test in a later cycle.

## [0.8.17] — 2026-06-24

**Driver-improvisation hardening — make the engine enforce two things a cold run showed the
LLM driver can slip on.** Both are deterministic + test-proven; their effect on cold-run
variance is for the next campaign to measure, not claimed here. Suite **34 files / 344 checks**
(was 34 / 338). Tag stays **HELD**.

### Hardened
- **WI-A — engine-enforced always-on dimensions (`harness/build-audit-engine.mjs`).** The
  assembler built its dimension set from the driver's `scope-input.applicable` verbatim, so a
  driver that forgot a methodology-mandated always-on dimension silently under-covered an
  auto-fail class (a cold run DROPPED `secrets-credentials`, then re-added it by luck). The
  engine now force-injects `ALWAYS_ON = ['sessionid-egress','secrets-credentials',
  'error-handling-disclosure']` (cited to `audit-methodology.md` :77/:78/:91) into EVERY built
  dimension set regardless of scope-input — de-duped (a driver-listed key keeps its
  targets/stackNotes), and an always-on key the driver marked N/A is moved back to applicable
  with a loud stderr `WARN`. Deterministic, fixed set, no LLM. `injection-xss` (:81 — CONDITIONAL,
  "always for the injection half") is deliberately NOT forced. Guarded by `test-build-audit-engine.mjs`
  (A1 auto-inject / A2 na→applicable+WARN / A3 no-duplicate-when-listed; 8 checks total).
- **WI-B — controlled consent decision (`harness/record-consent.mjs`).** The skill recorded
  consent with `--answer "<operator's yes>"`, but the driver passed the raw selected
  AskUserQuestion option label (e.g. "Exhaustive now"), which carries no affirm word → the gate
  stayed false → re-record churn. Added a controlled `--decision affirm|deny` token: when given,
  it is AUTHORITATIVE (`affirmative = decision === 'affirm'`) and the free-text label is recorded
  for the trail but NOT regex-scanned — a controlled selection must not be second-guessed by a
  regex. Invalid `--decision` → exit 2; the exit-0-affirmative / exit-3-otherwise contract and the
  free-text fallback (with its deny-precedence) are preserved; a `deny` decision always wins. Skill
  prose now records consent from a SELECTION via `--decision affirm|deny` in `audit-codebase`,
  `security-review-journey`, and `sequential-fallback`. Guarded by `test-record-consent.mjs`
  (C11 token decides / C12 invalid→exit 2 + CLI exit codes / C13 back-compat + deny-precedence; 13 checks total).

### Roadmap
- **WI-C (DEFERRED — not built this cycle):** a deterministic baseline-currency-date harness. The
  driver currently hand-rolls the currency-date calc and tripped on a token; it does not affect
  findings. Promote it to a pure `harness/*.mjs` + standing test in a later cycle (same
  determinizable-honesty-claim pattern as the other engines).

## [0.8.16] — 2026-06-24

**Phase 1 of the adjudication-drift hardening (Threads 1 & 2).** Targets the run-to-run
instability the ceiling test (0.8.14) exposed: a verified Contact-PII finding wrongly refuted as
"unreachable" across cold runs, and a `viewAllRecords` over-grant wobbling medium/HIGH/medium.
Static / deterministic changes only — their EFFECT on cold-run stability is measured by the next
cold campaign, not claimed here. Suite **34 files / 338 checks** (was 32 / 313). Tag stays **HELD**.

### Hardened
- **Reachability-vs-exposed-surface carve-out for packaged Apex (`apex-exposed-surface` §5/§6).**
  A defined-but-not-wired packaged Apex entry point
  (`@AuraEnabled`/`@RestResource`/`@InvocableMethod`/`@RemoteAction`/`webservice`/`global`/
  `@NamespaceAccessible`) is a SHIPPED surface a subscriber admin can grant or wire post-install,
  so unreachability DOWNGRADES severity (`low`/`info`, "not currently wired", verdict
  `partially_real`) but NEVER yields `false_positive` — mirroring `agentforce-package` §5. Defects
  in the method's OWN authorization (CRUD/FLS, sharing, IDOR, mass assignment) stay real findings.
  Closes the gap that let a verified Contact-PII finding be refuted as "unreachable."
- **Baseline-checked refutations — the v67 auto-enforcement gate (`apex-exposed-surface` §5/§6 +
  `audit-methodology` §3 cross-cut).** A refutation citing "the platform auto-enforces user mode /
  `with sharing` at API 67.0+" is INVALID when the package `sourceApiVersion` is ≤66.0 (the old
  system-mode / `without sharing` defaults hold) — the finding stands. A one-line verifier-loop
  cross-cut now requires checking the package version before accepting that rationale.
- **Least-privilege over-grant severity anchor (`admin-surface` §5).** An over-broad object
  permission (`viewAllRecords`/`modifyAllRecords`/`modifyAllData`) granted via a packaged
  permission set on a sensitive/financial custom object (forecast/revenue/pipeline/snapshot/
  compensation/billing) has a stable HIGH floor — downgrade below HIGH only with a documented
  business justification; ceiling is HIGH (within-org, not cross-tenant; read-only ≠ write bypass).

### Added
- **`harness/baseline-refutation-check.mjs`** (report-only, opt-in, gates nothing) — flags
  `refuted` findings whose reasoning leans on platform auto-enforcement the package's
  `sourceApiVersion` (`--api-version` / `--sfdx-project` / `--scope-manifest`, that precedence)
  does not buy: `<67.0` → invalid, `>=67.0` → valid, null → unknown; `--strict` exits 3 on any
  invalid refutation. Guarded by `acceptance/test-baseline-refutation-check.mjs` (13 checks).
- **`harness/union-convergence.mjs`** (report-only, opt-in, gates nothing) — answers "does the
  union of confirmed loci across N independent runs STOP growing?": cumulative `union_size_series`,
  `marginal_new`, `converged`, `plateau_run`, and a completeness-disclaiming `caveat`. Reuses the
  recurrence engine's locus identity (path-suffix file match + line-span overlap, same OPEN_STATES)
  so a converged union means the same thing both engines mean. Guarded by
  `acceptance/test-union-convergence.mjs` (11 checks).
- **A 5th calibration false-positive pattern** (`acceptance/test-calibration-fp-patterns.mjs`):
  the packaged-surface "a subscriber admin can grant or wire" anchor in `apex-exposed-surface` §6,
  asserted present so the carve-out cannot silently regress out.
- **A prominent BETA disclaimer at the top of `README.md`** — honest beta: reliably finds the
  unambiguous blockers and builds the evidence pack, but the contestable-severity band is an
  incomplete, unstable sample needing repeated runs + human adjudication (links `docs/ceiling-test.md`
  and `docs/recurrence-confidence.md`); no "catches everything / every time," and a passing run does
  not replace the Salesforce security review.

### Changed
- **`acceptance/solano-adjudication-key.md` — C5 reconciled to `high`** (was "medium, defensibly
  low"): a packaged permission set granting `viewAllRecords` on `Solano_Forecast_Snapshot__c` is the
  HIGH-floor least-privilege class; a blind-30-judge calibration ruled the prior `medium`/`low` too
  lenient. The deterministic `test-solano-band.mjs` fixture deliberately KEEPS its seed at `medium`
  (it asserts SCI math/shape, not calibration) — the divergence is documented in the C5 entry.
- **README `Status` reconciled to `0.8.16`** — adds the Phase-1 adjudication-drift component, the
  HELD-tag rationale (effect proven by the next cold run), and the 34-files / 338-checks suite count.
- Docs cross-refs updated for the two new engines (`CONVENTIONS.md`).

## [0.8.15] — 2026-06-23

- **Pre-public file-level polish — docs genericization + CHANGELOG restructure (docs-only).**
  The repo is heading public as a portfolio piece; this is the last file-level pass before the
  separate, operator-run history rewrite. Four changes, no engine or behavior touched:
  (1) genericized the worked example in `docs/recurrence-confidence.md` §3.2 to a role-neutral
  illustration (a service file with two disjoint confirmed defects plus a broad refuted span),
  preserving the interval-transitivity point exactly; (2) genericized the remaining
  synthetic-fixture class/component names in this CHANGELOG to role descriptions (a
  without-sharing controller's detail method, an Einstein summarize/coaching action, an
  access-guard class, a safe-reply enclosure) — the bare `Solano` / `Helios` / `Atlas` fixture
  **umbrella** names stay, since their generators ship in `acceptance/`; (3) restructured the
  single large `[Unreleased]` blockquote into Keep-a-Changelog versioned sections with an
  honest untagged-on-`main` banner, preserving the original change-typed detail verbatim under
  a **Detailed record** section; and (4) reconciled the README `Status` section to current `main` (it
  was stale at `0.8.7` — added the SF-ops safety gate, marked the recurrence skill-wiring shipped, and
  updated the version reference to `0.8.15`). Suite unchanged at **32 files / 313 checks**. Tag stays **HELD**.

## [0.8.14] — 2026-06-23

- **published the ceiling test** (`docs/ceiling-test.md`) — the experiment that REFUTED
  the toolkit's strongest claim, written up as a falsification test rather than buried (the honesty IS
  the value, CONVENTIONS §2). The doc carries: the **hypothesis** ("at exhaustive the full
  generate→verify→synthesize pipeline reliably calls the contestable-severity band"), named distinct
  from the separately-proven "multi-vote stabilizes an ISOLATED pre-identified finding" — the variance
  lives in the pipeline's GENERATION step, not in adjudicating a fixed input; the **method** (N=3 cold
  exhaustive runs over identical Solano-fixture code; a two-axis pass/fail bar committed BEFORE run #1
  and held off-repo so the plugin cache couldn't read it; graded off disk, axes reported separately);
  the **pre-committed bar** ported generically (Axis 1 generation-set stability — every crit/high
  recurs in all 3 AND pairwise Jaccard ≥ 0.70; Axis 2 severity stability + correctness vs blind truth;
  the self-interpreting verdict table) with the findings **role-described**, not named; and the
  **result — both axes FAILED.** As-graded (issue-class key) pairwise Jaccard **0.56 / 0.67 / 0.44**,
  the shipped locus-key engine **0.40 / 0.67 / 0.44** — every pair below 0.70; only **one** high
  (the without-sharing-controller FLS gap) recurs in all 3 runs; the contestable anchors are unstable
  (the view-all over-grant medium/high/medium and mis-called MEDIUM in 2/3 vs blind HIGH; the prompt
  delimiter info/high/low; a real contact-PII high confirmed→refuted→confirmed). Verified mechanism:
  genuine generation churn + a reachability-vs-exposed-surface contestability + severity instability —
  **not** a single false claim. **Verdict:** Axis-2 FAIL → the hard ceiling: exhaustive does NOT
  reliably call the contestable band even at max rigor; the scoped true claim (finds the unambiguous
  blockers + builds the evidence pack; the contestable band needs repeated runs + human adjudication;
  no fixed run-count is complete; SF pen-tests regardless) is why the tag is HELD. Cross-links:
  `README.md` honest-scope section → `docs/ceiling-test.md`; `docs/recurrence-confidence.md` →
  ceiling-test as its motivating result; the doc points back to recurrence-confidence (the product
  response that makes the variance visible) and distinguishes it from `methodology/known-escapes.md`
  (novel-CLASS coverage gaps, not contestable-band stability). **Docs-only**; suite unchanged at
  **32 files / 313 checks**. Tag stays **HELD**.


## [0.8.13] — 2026-06-23

- **sf-ops-gate honesty recalibration + a cheap wrapper gap** (final calibration of the
  0.8.12 hardening). The defect: `timeout` was omitted from the wrapper strip-list, yet the HONEST
  RESIDUAL claimed "only EXOTIC runtime/shell-eval forms still evade" — FALSE (a plain `timeout` wrapper
  is not exotic eval and it evaded). For a fail-closed safety gate whose value IS honesty, the shipped
  claim must be true. **Recalibrated** the residual (hook header + `docs/sf-ops-safety-gate.md`): the
  wrapper list is **best-effort, not a complete shell parser** — an UNCOMMON process wrapper can still
  front a gated op, alongside the exotic eval/substitution forms; dropped the false "only exotic evades."
  **Closed the easy gap**: added `doas` / `stdbuf` / `xargs` / `timeout` / `ionice` / `setsid` to the
  wrappers, with `timeout`'s POSITIONAL duration consumed (`timeout [flags] 60 sf …`, `1m`/`5s`). Tests:
  DENY for `timeout 60` / `doas` / `stdbuf -oL` / `xargs` / `ionice` / `setsid` sf-promote, plus an
  explicit ALLOW + comment for an UNCOMMON wrapper (`chrt`) that stays a documented residual — so the
  honest scope is regression-locked exactly like the exotic-eval locks. +1 check → suite **32 files /
  313 checks**. Consent/scope/deny machinery untouched. Tag stays **HELD**.

## [0.8.12] — 2026-06-23

- **sf-ops-gate classifier hardening** (off-disk 6-skeptic adversarial-bypass grade). The
  hook's architecture was verified sound (consent coupling, managed-repo scope, gate separation,
  fail-closed, no fail-open — all UNCHANGED), but the COMMAND CLASSIFIER leaked ~15 irreversible-op
  bypasses in the forbidden direction (op → ALLOW without consent), several reachable by an honest driver.
  Closed: **CLI identification** (basename + unquote/unescape — `/usr/local/bin/sf`, `./sf`, `"sf"`, `\sf`);
  **wrapper + grouping stripping** (`command`/`exec`/`time`/`nice`/`nohup`/`watch` added; `sudo -u nobody`
  value-flags; `(sf …)`/`{ sf …; }`/`((sf …))`); **`sh -c`/`eval` unwrapping** (best-effort, incl. a
  separator inside the quoted inner command + a chained `… && bash -c "…"`); **separator split** (added
  single `&` + `|&`); **flag-robust verb scan** (skip interspersed flags throughout + match the gated verb
  as a CONTIGUOUS run, so `sf --json … promote` / `sf -o foo package install` / `--json sf …` /
  `sf -- … promote` classify); and **gated-op completeness** (`sf package delete`, `sf package version
  delete`, `sf sandbox create`/`delete`, `npm uninstall -g`/`un`/`rm`). The honest residual TIGHTENS from
  "deliberate obfuscation can evade" to "only EXOTIC runtime/shell-eval forms evade" (`$(…)`/backticks,
  `$CMD`/`${CMD}`, `source <(…)`, base64-decode-eval) — these require running the shell, which a static
  classifier cannot, and stay ALLOW BY DESIGN. A standing **adversarial bypass battery** regression-locks
  ~36 bypass forms (must DENY), a benign no-false-denies set, and the exotic residual (stays ALLOW). +3
  checks → suite **32 files / 312 checks**. Docs: `docs/sf-ops-safety-gate.md`; hook header. Tag stays
  **HELD**.

## [0.8.11] — 2026-06-23

- **the SF-ops safety gate: fail-closed consent enforcement for IRREVERSIBLE Salesforce /
  host operations.** The deployed-package deep-audit skills run live, irreversible ops as prose-only
  Bash (worst: `sf package version promote`, which PERMANENTLY releases a 2GP version that can never be
  removed); a prior full-auto run skipped the consent asks and fanned out anyway. New PreToolUse hook
  `hooks/sf-ops-gate-hook.mjs` (matcher `Bash`, the 2nd hook in `hooks.json`) classifies each command on
  its ACTION VERB and **DENIES** a gated op — inside a `.security-review/`-managed repo — unless an
  affirmative consent for its gate is recorded (`harness/record-consent.mjs`, Phase-1 substrate). **Three
  gates:** `sf-package-promote` (its OWN gate, for the permanent release, with a permanence-emphasizing
  deny), `sf-deep-audit-ops` (version create / install / uninstall, scratch|sandbox create, org delete,
  data delete, deploy), `sf-cli-setup` (`sf org login`, `npm install -g`). **Robust normalization** (the
  adversarial surface): splits on `&& || ; |` + newlines and gates a chain on ANY segment; strips leading
  env-assignments + `sudo`/`npx`; accepts `sf`/`sfdx`, space-verb + colon + `force:*` legacy forms;
  verb-based so read-only verbs (`… version list`, `org list`, `config get`, `--help`) and all non-sf Bash
  pass. **Fail-to-ALLOW** on a malformed/absent payload or out-of-scope cwd — it never blocks arbitrary
  Bash. **Wired into the 6 gated skills** (`bootstrap-cli-auth`, `build-managed-package` [+ a SEPARATE
  permanence ask before promote], `install-and-verify-package`, `audit-deployed-package`,
  `teardown-mcp-registration`, `run-scans`): each couples a mandatory operator `AskUserQuestion` to a
  `record-consent` call and narrows `allowed-tools` to permit it — a skipped ask means the op is denied,
  not silently run. **Honest residual** (documented): a deliberately obfuscated op (base64-eval, `$(…)`,
  variable indirection) can still evade the classifier — "an honest driver running the documented ops is
  gated," not "impossible to bypass." New standing test `acceptance/test-sf-ops-gate-hook.mjs` (22 checks,
  inline payloads, no live sf) + one carried-over recurrence nit (by_file `has_reliable_blocker` false
  branch) → suite **32 files / 309 checks**. Docs: `docs/sf-ops-safety-gate.md`; CONVENTIONS §7/§8. Tag
  stays **HELD**.

## [0.8.10] — 2026-06-23

- **recurrence-confidence wired in end-to-end** (it was built at 0.8.7 but inert — nothing
  produced or surfaced its artifact). Three engine refinements (still pure/deterministic/byte-identical):
  (a) a **commit-consistency honesty guard** — each run's commit = its last pass's `audited_commit`;
  output adds `generated_from.runs` + `summary.commit_consistency` (`consistent`/`mixed`/`unknown`), and
  on `mixed` the caveat warns that an appear/disappear may be a CODE CHANGE (a fix between runs) rather
  than instability — so the fix→re-run loop's output is never misread as drift (descriptive, never gates);
  (b) a **`summary.by_file` rollup** — one row per file with `locus_count`, a `{high,review,investigate}`
  tally, and `has_reliable_blocker`, a presentation view over the per-locus classification (which stays the
  source of truth); (c) an optional **`--repo-root`** display relativization (strip the prefix from emitted
  paths, segment-aware, matching unaffected). **Skill wiring:** `audit-codebase` gains **step 9** — archive
  each independent run's ledger to `.security-review/runs/run-<k>/`, and (≥2 snapshots at the SAME commit)
  run the engine to `recurrence-confidence.json`; sharply distinguished from the fix→re-run step 8, never
  auto-orchestrated, with the honest contract stated (no fixed run-count is complete; the human adjudicates
  the contestable band; SF pen-tests regardless). `compile-submission` step 8 renders an **informational**
  "Finding Stability (N-run consensus)" section from that artifact (or one honest line in the single-run
  common case) that **MUST NOT** change the SCI computation, invocation, or gate — finding-stability never
  inflates readiness or clears a blocker. Three new standing checks (commit-consistency, by_file, repo-root)
  → suite **31 files / 286 checks**. Re-run on the three real ledgers: load-bearing facts unchanged
  (confirmed-per-run 8/6/7; controller-FLS the one reliably-recurring blocker; Jaccard 0.40/0.67/0.44);
  `commit_consistency` reports `consistent` (all three at one commit). Docs: `docs/recurrence-confidence.md`
  §7 "Wiring & usage". Tag stays **HELD**.

## [0.8.9] — 2026-06-23

- **public-readiness scrub** (the repo is heading open-source as a portfolio piece; file-
  level only, no git-history rewrite). Portable defaults in `acceptance/build-run-args.mjs` (plugin
  root resolves from the file's own location via `import.meta.url`; the fixture repo defaults under
  `os.homedir()` — no machine-specific absolute path baked into shipped code). `.gitignore` hardened so
  a contributor can never commit a partner's run-state or findings (`.security-review/`,
  `docs/security-review/`, `.claude/`, `*.jsonl`; verified none are currently tracked). Author host
  paths used as **test data** genericized to neutral roots (`/abs/repo`, `/home/user/project`) in
  `test-ledger-staleness-adversary.mjs` — input, repoRoot, and expected tokens changed together, both
  staleness tests re-run green — and the residual prose mention neutralized to "the host product repo".
  New OSS community files in the toolkit's voice: **`SECURITY.md`** (vuln-disclosure policy — honest
  scope: prepares submissions, not a hosted service, no guarantee about your package; report via GitHub
  private reporting or `dev@runverdict.com`), **`CONTRIBUTING.md`** (the green-suite bar, the §2/§3/§4/§9
  rules, conventional commits, Node 18+), and **`CODE_OF_CONDUCT.md`** (Contributor Covenant v2.1). Plus
  **CI**: `.github/workflows/test.yml` runs the full acceptance suite on push/PR (Node 20), a status
  badge on the README, and the Node 18+ prerequisite documented. No code/engine behavior changed; suite
  unchanged at **31 files / 280 checks**. Tag stays **HELD**.

## [0.8.8] — 2026-06-23

- off-disk audit fix-up of the 0.8.7 slice. **(P0 bug) bare-basename over-merge in
  `fileSuffixMatch`**: a single-segment file cite (a bare basename) was treated as a valid suffix of
  any deeper path with the same basename, so `package.json` matched BOTH `frontend/package.json` and
  `backend/package.json` and single-linkage clustering fused three different files into one
  `all_runs` / `confidence=high` locus — false confidence, the forbidden direction (over-merge can
  hide a distinct finding; the M10/M11 lesson). Latent on the Solano data (its basenames are unique
  multi-segment paths) but fixed in the load-bearing matcher: **exact** path equality always matches
  (a root-level `Dockerfile` cited identically still merges), but at **differing depth** the shorter
  segment list must be **≥ 2** (basename + a parent dir) before it counts as a tail — a bare basename
  can no longer bridge. **Two new invariant tests** lock it: the bare-basename non-over-merge (three
  same-basename files in different dirs → three `single_run` loci, plus the identical-`Dockerfile`
  positive) and the **two-phase anti-bridge** (a broad refuted finding overlapping two disjoint
  confirmed defects attaches to one without fusing them — the confirmed-anchored clustering had no
  test). Plus **§3 genericization** of `docs/recurrence-confidence.md` §6 (real fixture class names →
  role descriptions; one provenance line). Re-run on the three real ledgers: load-bearing facts
  **unchanged** (confirmed-per-run 8/6/7; pairwise Jaccard 0.40/0.67/0.44; the controller-FLS the one
  reliably-recurring blocker) — the stricter matcher is a no-op on that data, confirming the bug was
  latent. Suite now **31 files / 280 checks**. Tag stays **HELD**.

## [0.8.7] — 2026-06-23

- the **recurrence-confidence engine** (`harness/recurrence-confidence.mjs`), the first
  build off the Solano refutation: a pure, deterministic, dependency-free engine that takes **N
  independent run-ledgers of the same codebase** and classifies each finding by how reliably it
  recurred — `all_runs` / `some_runs` / `single_run`, with `confidence=high` reserved for the
  `all_runs` + confirmed-every-run + severity-stable set (the **reliably-recurring blocker** set),
  everything else `review` / `investigate` (the contestable band the human owns). Cross-run matching
  is **locus-based** (reusing the now-exported `normFile` / `lineSpan` / `spansOverlap` primitives
  from `finding-clusters.mjs`; `finding.id` is unusable across runs because finder titles drift),
  with path-suffix reconciliation for absolute-vs-relative file cites and **confirmed-anchored
  clustering** so a broad refuted finding can't fuse two disjoint confirmed defects. Per-run
  confirmed counts + pairwise Jaccard are reported as **metrics only** (they gate nothing); the
  standing honesty caveat is embedded (no fixed run-count = complete; SF pen-tests regardless). Run
  against the three real Solano ledgers it reproduces the ground truth — the controller-FLS high
  recurs 3/3 (`confidence=high`), `viewAllRecords` / prompt-delimiter are `all_runs` but
  severity-unstable, the Contact-PII high flips confirmed→refuted→confirmed, pairwise Jaccard
  **0.40 / 0.67 / 0.44** (consistent with the 0.44–0.67 refutation). Standing test
  `acceptance/test-recurrence-confidence.mjs` (15 checks, inline synthetic fixtures); spec in
  `docs/recurrence-confidence.md`. Skill wiring + cold validation pending; the tag stays **HELD**.

## [0.8.4–0.8.6] — 2026-06-22

- the **durable consent coupling**: `record-consent.mjs` + a fail-closed
  audit-launch gate (a skipped consent ask physically cannot launch the audit); the journey +
  audit-codebase gates made mandatory `AskUserQuestion` stops; **four adversarial bypasses closed**
  (second-substrate, forge-asymmetry, isAffirmative-leaks-declines, forgeable belt); and
  `isAffirmative` deny-precedence so a natural "no" never records as consent.

## [0.8.3] — 2026-06-22

- version bump so a cold run pulls the current code (the `plugin update` trigger).

## [0.8.2] — 2026-06-20

- three **calibration false-positive patterns** encoded into verifier guidance from a
  blind 30-judge verification (reachability-is-a-precondition-for-severity; availability ≠
  security; a missing grant is fail-closed, not a vuln); **Track-1b** cross-dimension ledger dedup
  (collapse same-file + overlapping-line-span multi-lens findings into one entry); and a
  **webhook / HMAC-compute-DoS** resource-consumption recalibration.

## [0.8.1] — 2026-06-20

- Solano middle-band fixture Phase-A rebuild + `namespace-check` honest-fix + the
  journey "triage → blocker-policy gate" relabel.

## [0.7.2] — 2026-06-19

- **`namespace-check` — the deep-audit BUILD precondition.** The managed-2GP build is offered
  only when an authed Dev Hub actually carries the package's `namespacePrefix`, so the toolkit
  never offers a build that would fail at `sf package version create` (and mutate the repo
  first); otherwise it shows the prerequisite. Full detail under **Detailed record** below.

## [0.7.1] — 2026-06-19

- **`docker-check` — the throwaway-DAST docker precondition (graceful degradation).** Detects
  Docker (`available` | `absent` | `daemon-down`) and offers the throwaway DAST only when it can
  actually run; else an honest "install Docker once, or DAST stays owner-run" (Docker is a
  *guided* prerequisite, never tmp-installed — it is a privileged daemon). Full detail under
  **Detailed record** below.

## [0.7.0] — 2026-06-19 — last published tag (cold-validated)

- **The autonomous throwaway-DAST harness.** The server-tier analogue of the deployed-org deep
  audit: `stack-detect` classifies whether the external backend can stand up; `standup-stack`
  runs it as an isolated throwaway container (copy-in, synthetic secrets, names-not-values
  manifest, `127.0.0.1`-only); `run-dast` runs a digest-pinned ZAP against that disposable
  mirror and writes self-labelled *local-throwaway* evidence; `teardown-stack` destroys it
  (name-scoped, guaranteed); `scaffold-env` handles a `needs-secrets` stack. 12 adversarial-audit
  findings (several HIGH) were fixed before the tag. Shipped in the unified `0.6.0`+`0.7.0`
  `main` build. Full detail under **Detailed record** below.

## [0.6.0] — 2026-06-19

- **Consented, tmp-scoped scanner install.** `tool-detect` reports which scan tools are present
  vs installable-on-consent; `install-scanners` (the one network-touching engine, fail-closed
  without explicit consent; raw binaries sha256-pinned and verified before exec) installs the
  missing ones to a tmp dir, turning the external-SAST/SCA/secret/TLS families from
  `PENDING-OWNER-RUN` into real evidence; `cleanup-scanners` removes the binaries while keeping
  the evidence. 13 adversarial-audit findings were fixed before validation. Shipped in the
  unified `0.6.0`+`0.7.0` `main` build. Full detail under **Detailed record** below.

## Detailed record & program notes — the 0.6.0–0.8.x arc (untagged on `main`)

The full change-typed detail behind the per-version summaries above, preserved verbatim — the
program-note checkpoints first, then the `Fixed` / `Changed` / `Added` / `Hardened` / `Changed`
/ `Roadmap` record. (Restructured into the versioned sections above in 0.8.15; this section is
the original detail, kept intact.)

> **The load-bearing result (2026-06-23): the Solano cold-at-exhaustive test REFUTED the toolkit's
> strong contestable-band claim.** Three full-pipeline exhaustive runs of identical code, graded
> against a pre-committed bar, showed the contestable-severity band is UNSTABLE run-to-run (Jaccard
> 0.44–0.67; a real high blinking in/out across runs). Honest scope going forward: the toolkit
> **reliably finds the unambiguous blockers and builds the evidence pack**, but the
> **contestable-severity band is an incomplete, unstable sample needing repeated runs + human
> adjudication** — no fixed run-count is certified complete; Salesforce pen-tests regardless. The
> tag stays **HELD** (the claim that would justify it is refuted). **Shipped off this result:** the
> **recurrence-confidence engine** (0.8.7) that makes the run-to-run variance a visible, classified
> output, and (0.8.10) its **end-to-end wiring** — audit-codebase step 9 archives independent runs and
> produces the artifact; compile-submission renders it informational-only (never touching the SCI gate).
> Not yet built: the adjudication-drift fixes (multi-vote-on-drops, baseline-checked refutations,
> reachability-vs-exposed-surface resolve) and a union-convergence test. Suite: 32 files / 313 checks, green.
> **Doc-debt note (resolved by 0.8.15):** the detailed 2026-06-19 note below is the
> prior checkpoint (accurate for its scope). The `[Unreleased]` restructuring into versioned
> sections landed in 0.8.15 (the versioned sections above; this block preserves the original
> change-typed detail verbatim), and the live-SF deep-audit `sf`-ops prose-only-consent gap was
> closed by the SF-ops safety gate in 0.8.11–0.8.13.

> **Release state (2026-06-19).** **`v0.7.0` is tagged + cold-validated** — one full autonomous
> journey on a 0-context seeded fixture (Atlas), graded off disk vs both pass-conditions: the
> consented **scanner install** (0.6.0) and the **throwaway-DAST harness** (0.7.0) + their two
> adversarial-audit hardening passes, all detailed below. `main` is now at **0.8.6**, UNTAGGED —
> ahead of the v0.7.0 tag by the two environment preconditions (`docker-check` 0.7.1 +
> `namespace-check` 0.7.2), the **coverage-gap dimensions (16→19)**, the **Solano
> middle-band judgment fixture** (rebuilt in PHASE A below), a journey-skill
> **triage→blocker-gate relabel** (0.8.1), and the **calibration false-positive patterns**
> (0.8.6 — three verifier-guidance rules from a blind 30-judge verification, below).
> **The Solano cold RE-RUN gates the v0.8.6 tag.**
> Cold run #1 (2026-06-20) validated the TOOLKIT — it correctly caught everything — but exposed
> FOUR unintended fixture defects that landed Solano BLOCKED, so the middle-band JUDGMENT test
> never actually ran; **PHASE A rebuilt the fixture to be genuinely mostly-compliant** (execution-
> identity, prompt-injection, denial-of-wallet, and a deploy-blocking field gap all fixed). The
> 0.7.2→0.8.x bumps are load-bearing, not cosmetic: the installed plugin was last updated at 0.7.2,
> BEFORE the coverage-gap work, so without them `claude plugin update` no-ops and a cold run would
> audit the PRE-coverage plugin — missing the three new dimensions
> (`error-handling-disclosure` / `untrusted-deserialization` / `resource-consumption-abuse`)
> that Solano's calibration depends on (they are its statically-cleared entries).
> **Coverage-gap map: closed** — the two
> default PMD AppExchange rules (the prediction quick wins) are predicted in the baseline +
> dimensions, and **all three new dimensions** shipped — **error-handling-disclosure**
> (verbose-error/secret-log disclosure + fail-open security logic), **untrusted-deserialization**
> (native-object/pickle/prototype-pollution/Apex-sObject deserialize → RCE/priv-esc), and
> **resource-consumption-abuse** (rate-limit/unbounded-read gaps + denial-of-wallet on metered
> Agentforce/MCP/LLM round-trips + ReDoS — API4:2023/LLM10:2025). The **P2 extensions** are
> now in as dimension prose + baseline entries: mass-assignment/BOPLA →
> apex-exposed-surface/mcp-surface, within-org BOLA → tenant-isolation, outbound-callout-trust →
> crypto-internals, system-prompt-leakage + business-logic → agentforce-package. **The
> coverage-gap map's P1 + P2 items are all closed** — only the intentionally-deferred P3
> (XXE / TOCTOU / exotic-MCP cluster) remains. **The middle-band judgment fixture — PHASE 1
> (author + band check) BUILT; cold run #1 done (toolkit validated, fixture had 4 unintended
> defects); PHASE A (fixture rebuild) BUILT.** Remaining: the cold RE-RUN (gates v0.8.6) and the
> DEFERRED **Phase B** — owner-artifact pre-population so the SCI lands 65–75% (today the fixture
> is mostly-compliant in CODE but the SCI stays low/BLOCKED on owner-completable materials — the
> 9% lesson). Other **Roadmap** specs not
> yet built: the throwaway-DAST slice-5b, and **preconditions & guided remediation**
> (`docs/roadmap-preconditions-guided-remediation.md`, NEW) — the "why-blocked, ask-don't-default"
> contract prompted by the Solano preflight offering a deep audit for an uninstallable package
> (a §2 honesty gap: capabilities must resolve to ready | blocked+remediation | needs-input, never
> a silent owner-run). The coverage-gap
> changeset was adversarially audited (5-lens read-only Workflow → 12 raw → 5 confirmed → all
> fixed). Suite: 30 files / 262 checks, green. Earlier checkpoints tagged through v0.5.5.

> **Cold-run key isolation (2026-06-20).** For cold run #1 the sealed adjudication key
> (`acceptance/solano-adjudication-key.md`) was **held off-repo** at `~/solano-adjudication-key.md`
> and removed from `main` for the run window — stronger isolation than the Helios
> `expected-findings.md` precedent, on purpose, because the run's whole value is honest judgment.
> PHASE A **restores the key to the repo and updates it to the corrected post-rebuild reality**
> (the execution-identity bot + the Einstein summarize action are now clean controls; C5 is reframed as a
> SOURCE-permset finding; the Expected-SCI section is rewritten honestly). Re-isolate the key the
> same way before the cold RE-RUN (see the key's *Cold-run isolation* section).

### Fixed
- **`isAffirmative` — catch general negation so natural declines never record as consent
  (0.8.6; engine + test-backed).** DENY-precedence landed in 0.8.5, but DENY lacked bare `not`
  and the n't contractions, so (verified at f446559) "not ok" / "I would not approve this" /
  "we should not proceed" leaked as affirmative, and "won't approve" / "can't allow" /
  "wouldn't consent" would too. DENY now also matches **bare `\bnot\b`** and the **n't
  contractions** (`\b\w+n['’]t\b` — won't/can't/wouldn't/shouldn't/isn't/…), keeping
  deny-precedence (any negation → false). The contraction rule REQUIRES the apostrophe ON
  PURPOSE: the optional-apostrophe form `\w+n['’]?t` would also match `grant`/`consent` —
  both AFFIRM tokens that merely END in "nt" — and false-NEGATIVE a real "I consent" /
  "I grant approval"; apostrophe-less negations ("do not", "dont") are caught explicitly. A
  short comment flags the durable next-hardening (record the SELECTED AskUserQuestion option
  as a controlled `affirm|deny` token instead of scanning free text) — not implemented here.
  `test-record-consent` C9's decline set is extended to lock it, plus the grant/consent
  stay-affirmative guard.
- **Consent coupling — close the 4 adversarial bypasses (0.8.6; 2026-06-22; engine + test-backed).**
  An adversarial pass found the 0.8.4 coupling bypassable four ways. The goal is NOT unforgeability
  (a driver that runs everything can fabricate) — it is that an honest driver cannot ACCIDENTALLY skip
  on EITHER substrate, complying is lower-friction than forging, and a NO never records as a YES:
  - **(1) Substrate parity — the keystone.** The sequential fallback (`harness/sequential-fallback.md`,
    used when the Workflow tool is unavailable) fans out via Task and never calls `build-audit-engine.mjs`,
    so `verifyConsent` never ran — its pre-fix "show the target map" prose had no ask/record/fail-closed.
    Now §3 step 1 runs the SAME gate: ask Step 2/3 via `AskUserQuestion`, record via `record-consent.mjs`,
    `verifyConsent` `audit-tier` + `audit-targetmap`, and launch NO finder Task if either is NOT CONSENTED.
    The consent gate is added to BOTH "survives either substrate" non-negotiable lists (audit-codebase §5 +
    audit-methodology §8.2) and the §1 fallback list. `test-record-consent` C10 fails the build if the
    fallback ever loses the precondition.
  - **(2) Forge asymmetry flipped.** `record-consent.mjs`'s invocation is added to both driving skills'
    `allowed-tools` (`Bash(node *harness/record-consent.mjs *)`), so complying does NOT trip a prompt; and
    `audit-codebase`'s bare `Write` is path-scoped to its legit targets (scope-input/target-map/ledger/
    run-log/pass-*/docs) so it CANNOT target `.security-review/consent/` — consent is written only by the
    engine. The sanctioned record path is now least-resistance; a direct forge needs an out-of-band act.
  - **(3) `isAffirmative` DENY precedence.** Any deny token now fails closed regardless of an affirm token:
    "no, do not proceed" / "do not allow" / "I do not consent" / "please don't go ahead" → FALSE; "yes" /
    "go ahead" / "approve the install" → TRUE (`test-record-consent` C9). A NO can no longer record as a YES.
  - **(4) `consentVerified` belt re-documented.** The check stays, but `workflow-template.mjs`'s comment now
    states plainly that belt #1 (the assembler `verifyConsent`) is the SOLE real boundary and this flag is a
    defense-in-depth tripwire that ASSUMES the assembler was used — JS data, trivially forgeable, no security
    claim — whose only job is to catch an HONEST mistake (an engine that reached the runtime un-gated) loudly.
- **Consent COUPLING — the launch path fails closed on a skipped ask (0.8.6; 2026-06-22; engine
  + test-backed).** A full-auto cold run inferred "silence-is-yes" past its scope and skipped THREE
  mandatory stops — the journey consent gate, audit-codebase Step 3 (show the target map), and Step 2
  (declare the tier + get a go-ahead) — fanning out agents with no ask. Root cause: the interactive
  ASK and the downstream ACTION were DECOUPLED, and silence-is-yes had no hard scope boundary. The fix
  couples them:
  - **NEW `harness/record-consent.mjs`** (pure, deterministic, tested): `recordConsent(gate, answer)`
    writes an affirmative answer to `.security-review/consent/<gate>.json` (gate id, clock-free
    monotonic `seq`, the question, the answer, an `affirmative` flag); `verifyConsent(gate)` is TRUE
    only on a recorded affirmative — missing/negative/empty → FALSE (fail closed).
  - **The durable gate: `harness/build-audit-engine.mjs` verifyConsent's `audit-tier` &&
    `audit-targetmap` before it assembles anything** — exit non-zero, NOTHING written, when either is
    missing. A skipped show-map/tier-go-ahead PHYSICALLY CANNOT launch the audit (no engine = nothing
    for the Workflow tool to run). The Workflow runtime has no filesystem access, so this Node-side
    assembler is the only place the recorded ask can be verified; it stamps `consentVerified`, and
    `workflow-template.mjs` refuses to fan out any agent without that flag.
  - **`install-scanners.mjs` / `run-dast.mjs` / `standup-stack.mjs`**: in ADDITION to `--consent`, the
    CLI now verifies the matching recorded token (`scanner-install` / `throwaway-dast`) — the flag
    alone (driver-set, ask-skipped) is no longer sufficient. The exported functions are unchanged.
  - **`security-review-journey` + `audit-codebase` skills**: the "single gate" markdown-report block
    is replaced by MANDATORY `AskUserQuestion` calls (one per consent), each recorded via
    record-consent; audit Steps 2/3 are MANDATORY recorded `AskUserQuestion` stops (gates `audit-tier`
    / `audit-targetmap`) and re-assert "never `exhaustive` on a first pass" as a hard tier default.
    `silence-is-yes` is HARD-BOUND to the DETECTED-ARCHITECTURE inputs only — never the consent gates,
    never the audit-phase stops — and the "don't wait for a go" / "decide once and I'll launch"
    language is removed.
  - Tests: `test-record-consent` (round-trip, fail-closed-on-missing, monotonic seq, the
    **audit-launch-fails-closed** check, and the scope/gate-shape prose guards); the two tests that run
    the assembler now record the consents in setup.
- **Cross-dimension severity dedup IN the ledger — Track-1b (2026-06-22; engine + test-backed).**
  The Solano cold-at-standard run double-reported ONE root cause — "Missing FLS enforcement in
  a without-sharing controller's detail method" — as TWO HIGH ledger entries, one under
  `apex-exposed-surface` and one under `web-client`. The dedup id is `SHA-256(normalized_file +
  "\n" + normalized_title)`, so two dimensions giving the SAME file but DIFFERENT titles hash
  distinct and never merge. The §5.2 note already said "one root cause → one row at the single
  highest verified severity", but only the per-FILE headline (`finding-clusters.mjs`) enforced it —
  not the ledger.
  - `harness/finding-clusters.mjs` gains an exported, pure, **idempotent** `collapseCrossDimension`:
    two OPEN findings on the same normalized file AND an **OVERLAPPING LINE SPAN** (the ONLY key) but
    DIFFERENT dimensions collapse into ONE entry at the highest verified `adjusted_severity`, with
    every lens's reasoning/evidence preserved (a structured `lenses[]` + a labelled `verdict_reasoning`).
    CONSERVATIVE — same file ALONE never merges, so a genuine second bug at a different location stays
    separate.
  - **Off-disk-grade hardening (2026-06-22): removed the title-symbol merge path.** The grade tested
    `collapseCrossDimension` against the real Solano ledger (line-span path correctly collapsed the
    triple-lens FLS, all at `:21-2x` → kept) and an adversarial case where a title-symbol path
    OVER-MERGED two DISTINCT vulns — a high FLS gap and a critical SOQL injection in `Acct.getDetail`,
    no line spans — into one entry because both titles said `getDetail`. That hides a finding (the
    missed-finding failure), and it has zero upside (every real multi-lens Solano cluster carries line
    spans). So `sameLocation` now merges on **file + overlapping line span ONLY**; `codeSymbols` is
    deleted. Deliberate posture: when two lenses of one issue have non-overlapping/absent spans the
    engine UNDER-merges (noisier headline) rather than risk hiding a second bug — under-merge is the
    safe failure.
  - `harness/merge-ledger.mjs` EXPLODES any prior merged entry back to per-dimension lenses, runs the
    normal per-id merge, then re-collapses — so an incremental re-run that re-finds only one dimension
    never drops the others' audit trail, and one root cause is COUNTED ONCE in the pass stats.
  - `templates/audit-ledger.schema.json`: new optional `merged_dimensions` + `lenses` (a `$defs/lens`)
    on the finding; `methodology/audit-methodology.md` §5.2 updated (collapse is now IN the ledger, on
    overlapping line span only).
  - Tests: `test-merge-ledger` M6–M12 (collapse to one entry at max severity + both reasonings;
    different-location-stays-separate; incremental keeps first_seen; pure idempotency; the **over-merge
    regression guard** M10/M11 — same file + same method in both titles, no/non-overlapping spans →
    stays TWO entries; M12 the 3-dimension real-Solano overlapping-span shape → one entry).
- **Solano fixture rebuild — PHASE A (2026-06-20).** Cold run #1 validated the toolkit (every
  issue correctly caught) but surfaced that the FIXTURE carried four UNINTENDED real defects — all
  author blind spots — so it landed BLOCKED and the middle-band judgment never ran. Rebuilt the
  generator so a re-audit surfaces ONLY the six intended contestable issues (C1–C6), all
  low/medium or dispositioned, ZERO open critical/high:
  - **Execution-identity (was an auto-fail):** the bot was `ExternalCopilot` (a SERVICE agent),
    making its `UserInfo.getUserId()` scoping the VerifiedCustomerId auto-fail. Retyped to
    `EinsteinCopilot` (employee-facing, runs as the prompting user) → `getUserId()` is now correct
    and the bot is a clean control. Action-classification doc updated to match.
  - **Prompt-injection (the Einstein summarize action):** raw `req.context` flowed straight into
    `ConnectApi.EinsteinLLM`. Now fenced in a per-inference cryptographically-random enclosure with
    a data-cannot-override clause (the safe-reply enclosure design) → clean control.
  - **Denial-of-wallet (the Einstein summarize action):** the metered `generateMessages` callout sat in
    an unbounded per-element loop. Now the request count is capped and the per-call input is
    truncated → bounded paid round-trips, clean control.
  - **Deploy blocker:** an Einstein coaching action referenced `Body__c`/`Opportunity__c` (and the
    controller referenced `Opportunity.Forecast_System_Score__c`) with no field metadata → the
    package would not deploy. Added all three custom-field definitions (the master-detail
    `Opportunity__c` satisfies the object's `ControlledByParent` sharing). A build-time
    deploy-cleanliness self-check now fails loud if an Apex-referenced custom field lacks metadata.
- **Namespace honest-fix (PHASE B-adjacent).** Dropped the synthetic `04t` package-version alias
  from the fixture's `sfdx-project.json`: the `04t` was fake AND namespace `solano` is unregistered,
  so a deployed-org deep-audit install would fail. `package-readiness` now reads **`needs-build`**
  and `namespace-check` declines the build offer; C5 is reframed as a SOURCE-permset finding. The
  build-time self-check now asserts `needs-build` (catches a future fake-`04t` regression).

### Changed
- **Webhook / rate-limit resource-consumption calibration — verifier-guidance (2026-06-22;
  NOT-deterministically-test-backed prose, CONVENTIONS §7).** A blind 15-judge multi-vote (3 rounds ×
  5) on the Solano "/webhook lacks rate limiting → HMAC-compute DoS" finding returned
  not-a-finding(9)/low(6) — modal NOT-A-FINDING, ZERO high/medium — while the cold run called it
  HIGH (the same over-fire shape as the three Track-1 patterns). Encoded a §5 verifier sentence +
  a §6 Known-false-positive row in `resource-consumption-abuse`: app-level rate-limiting on a
  webhook/endpoint, and an "HMAC-compute / signature-verify DoS", is `low`/`info` (not `high`/
  `medium`) when the per-request work is cheap (HMAC-SHA256 is microseconds; rate-limiting is the
  gateway/infra layer's job) — it rises to a real finding ONLY when the per-request work is
  EXPENSIVE (bcrypt/scrypt, a heavy unindexed query, an LLM/paid callout) AND unbounded AND
  attacker-triggerable pre-auth. Presence-guarded by `test-calibration-fp-patterns` (the §6 phrase
  can't regress out); the real proof is a future cold run no longer over-firing the webhook.
- **Calibration false-positive patterns — verifier-guidance (0.8.6; NOT-deterministically-test-backed
  prose, CONVENTIONS §7).** A blind 30-judge calibration verification (5 independent judges × 6
  findings, reading only the fixture source) found three CONSISTENT, blind-converged severity bugs
  the verifier over-fired. Encoded each as a §5 verifier sentence + a §6 Known-false-positive row in
  the dimensions where the adversarial verifier reads them, so it refutes/downgrades them next time.
  These are LLM-verifier prose — **not** deterministically test-backed; the real proof is the next
  Solano cold re-run no longer over-firing H1/H2/H4. (A presence test guards the rules from silently
  regressing out — see `test-calibration-fp-patterns` — but does NOT test the judgment itself.)
  - **Reachability is a precondition for severity** (blind H2, 0/5 real — an exported-but-uninvoked
    `snapshot(orgId)` worker scored HIGH). A function/route/handler defined-or-exported with no
    attacker-reachable caller (no wiring, grep finds zero call sites) cannot carry high/critical —
    downgrade to low/info or refute. → `background-jobs`, `tenant-isolation` (§5 + §6) + a
    cross-cutting directionality line in `audit-methodology.md`'s §3 verifier prompt (which preserves
    the agentforce-package exception: a shipped packaged artifact a subscriber admin can bind
    downgrades but never refutes).
  - **Availability/robustness ≠ security severity** (blind H1, 0/5 real — "worker doesn't validate
    `SOLANO_DB_URL` at init" scored HIGH). Failing to validate a non-security config (a DB URL,
    endpoint, flag) at boot is fail-CLOSED on availability (it crashes, no security impact) — low/info.
    Fail-open requires a SECURITY control defaulting to ALLOW. → `error-handling-disclosure` (§5 + §6,
    plus sharpened §1.4 + §4 fail-open so config-validation is explicitly excluded), `secrets-credentials`
    (§5 + §6).
  - **A missing grant is fail-closed, not a vulnerability** (blind H4, 5/5 not-a-finding — "the permset
    doesn't grant the agent-action Apex classes" scored HIGH). A missing permission/grant is
    fail-CLOSED (the feature can't run for that user) — a functionality/packaging gap (info at most),
    never a finding; the security finding is always an OVER-grant, never an under-grant. →
    `agentforce-package`, `apex-exposed-surface`, `admin-surface` (§5 + §6).
- **Cross-dimension single-severity reconciliation note (`audit-methodology.md` §5.2).** A blind run
  surfaced one root cause (a single background-worker source line) at HIGH from `secrets-credentials` AND LOW from
  `error-handling-disclosure`. Added a one-line note: a merged cross-dimension duplicate is presented
  ONCE at the single highest VERIFIED `adjusted_severity` (`finding-clusters.mjs` already does this
  per-file for the headline; the report's per-finding list must reconcile the same way). Prose note;
  no engine change.
- **Journey skill: triage→blocker-gate relabel (0.8.1).** The blocker policy has been automatic
  (no election) since 0.5.2, but the journey step was still named "Triage gate". Renamed the step,
  the AuthN/AuthZ-suppression cross-ref, and dropped the stale "triage" phase from the end-to-end
  phase list (matching the README's canonical journey). Legitimate finding-triage uses
  (quick-tier "a triage", machine-triage, SFGE triage, the informational `triage-decision.json`)
  are unchanged. `plugin.json` → 0.8.1 so a cold re-run pulls the relabel.

### Added
- **Middle-band judgment fixture — "Solano Pipeline Guardian" (Phase 1; 2026-06-20).** The next
  high-value validation artifact after the v0.7.0 catastrophe cold run, per
  `docs/roadmap-middle-band-judgment-fixture.md`. A catastrophe scores near-0 the way a clean
  package scores near-100 — neither needs fine judgment; the product lives in the *band between*,
  where the call between "blocker" and "hardening item" is genuinely contestable. This builds the
  target that forces that call.
  - **`acceptance/generate-solano-fixture.mjs`** (NEW generator, not an extension of the Helios
    one — kept separate so Helios's "every probe fires / scores BLOCKED" recall contract stays
    clean and the band stays governable). Builds a **mostly-compliant** Agentforce managed 2GP +
    companion endpoint on demand into `~/srt-solano` (never committed): `with sharing`, CRUD/FLS
    in user mode, no injection, **no live secrets** (secret-scan-clean by construction, no deleted
    blob), `installable` (a real-shaped non-placeholder `04t` version alias → the deep-audit path
    is exercised; a build-time self-check fails loud if that regresses). Seeded with **6 genuinely
    contestable issues**, each a distinct judgment axis, each with a clean negative near-control
    beside it: C1 severity-boundary (owner-scoped PII read with no explicit FLS — low vs medium),
    C2 tempting FP (a `without sharing` AuraEnabled that LOOKS like IDOR but routes every id
    through a separate access-guard class first — refute), C3 fix-vs-document (a DAST medium —
    missing HSTS behind an edge TLS terminator — acceptable-with-justification), C4 partial
    evidence (a second `worker/` source root the external SAST does not cover), C5 deployed
    artifact (an installed permission set granting `viewAllRecords` on the snapshot object — a
    real, non-catastrophic least-privilege finding), C6 prompt-hardening-middle (a template WITH
    data/instruction separation but a static delimiter, not a per-inference enclosure).
  - **`acceptance/solano-adjudication-key.md`** — the **sealed adjudications** (off-fixture, in the
    repo, never readable from `~/srt-solano`). Per issue: the intended call + why + the
    defensible-consistency bar for the genuinely-50/50 calls, with explicit FAIL modes
    (over-escalation AND under-detection both fail — the point of the middle band). Mirrors the
    `expected-findings.md` off-fixture pattern.
  - **`acceptance/test-solano-band.mjs`** — the **standing deterministic band check** (the gate
    before any cold run; "encode-don't-park"). Hand-authors the representative scope-manifest +
    audit-ledger + evidence-index that a Solano run would produce (the 6 issues dispositioned per
    the sealed key + the realistic mid-prep materials gaps), runs the REAL `compute-sci` against
    the REAL baseline, and asserts the rollup lands at **exactly 71% / `MATERIALS COMPLETE`** —
    90/126 SATISFIED, 8 statically-cleared, 4 PARTIAL, 24 MISSING, 0 open critical/high, all 22
    blocker requirements satisfied, the currency floor correctly silent (materials incomplete).
    A PRIMARY layer (fixed 126-id manifest) keeps the count stable against baseline growth; a
    CORROBORATE layer re-derives the live applicable set and fails loud on a renamed/removed id or
    drift out of a [60,80] sanity band — so the design "can't silently drift" (+10 checks).
  - **NOT a tag / no `plugin.json` bump.** Phase 1 is author + band check only; the cold run that
    would gate a tag is a separate, later session.
- **Coverage-gap adversarial-audit hardening (2026-06-20).** After the coverage work landed, a
  5-lens read-only Workflow (honesty/sourcing · cross-dimension boundaries · technical accuracy ·
  genericization/voice · extraction-contract; hard-anchored to the toolkit repo, the host product
  repo forbidden)
  audited the whole changeset and adversarially verified each finding: **12 raw → 5 confirmed**
  (7 rejected as nitpicks/false alarms). All 5 fixed:
  - **`agentforce-system-prompt-leakage` cited a non-resolving SF URL** (the bare
    `secure_agentforce_prompt_injection.htm`; the real pages are the umbrella
    `secure_agentforce_prompts.htm` + the `_harden`/`_data`/`_enclosure`/`_resources` sub-pages).
    Repointed to the umbrella; dropped the `(doc v262.0)` annotation I had not inspected. (The
    requirement is independently carried by the resolving OWASP LLM07 source; the entry was
    already honestly `web_research_unverified`.)
  - **`Object.assign` was wrongly listed as a JS prototype-pollution source** in
    `untrusted-deserialization` §1 — it is shallow/own-enumerable and not a sink (the file's §3
    grep seeds, §4 finder prompt, and §5/§6 already excluded it). Corrected to name it as NOT a
    source.
  - **`visible_user_ids` (a partner-of-origin INTERNAL variable name) leaked** into the shipped
    `within-org-bola` baseline entry + `tenant-isolation` as "the visible_user_ids pattern"
    (CONVENTIONS §3). Genericized to "an explicit owner/visible-user/subtree filter" everywhere.
  - **"simply" ×2** in the new `error-handling-disclosure` dimension (CONVENTIONS §9 bans the
    word) — removed, plus a pre-existing one in `apex-exposed-surface`.
  - **SOURCES.md registry row for the PMD reference was stale** (last-checked 2026-06-12) vs the
    2026-06-20 `verified_primary` promotion — bumped to 2026-06-20 and now names the two rules.
  - **`acceptance/test-prose-hygiene.mjs`** (4 checks, NEW) — encodes the two recurring-risk
    rules the audit caught: the §9 "simply" ban (methodology prose) + the §3 partner-internal-
    symbol ban (`visible_user_ids`/`app.current_org_id` must not ship in methodology/baseline).
    So the voice/genericization slip class can't recur. Suite 26 → 27 files / 224 → 228 checks.
    *(Test-backed; no cold run — deterministic.)*
- **Coverage-gap closure, P2 extensions (2026-06-20) — authz/trust classes whose GENERAL case
  had no baseline owner, threaded into existing dimensions (no new dimension files).** Closes
  the coverage-gap map's P1.4 + P2.6/P2.8/P2.9/P2.10. **With this, all P1 + P2 items are
  closed** (only the intentionally-deferred P3 cluster remains).
  - **mass-assignment / BOPLA (P1.4)** — `mass-assignment-bopla` baseline + a write-side probe
    in `apex-exposed-surface` §4 (the cousin of the IDOR probe: does a create/update bind a
    caller-supplied whole sObject, letting them set `OwnerId`/status/price/internal fields, vs
    an allowlist/DTO/`stripInaccessible`) and in `mcp-surface` (a permissive tool-param schema
    binding privileged fields). The general per-property write-authz beyond role
    (admin-surface), tenant-id (tenant-isolation), and deserialize (untrusted-deserialization).
  - **within-org BOLA (P2.8)** — `within-org-bola` baseline + a within-org owner/subtree
    sub-probe in `tenant-isolation` §1 + §4, explicitly delineated as the lower-severity
    intra-tenant layer (the service-layer owner/visible-user filter RLS does not catch), distinct
    from the cross-org boundary the dimension owns.
  - **outbound-callout-trust (P2.6)** — `outbound-callout-trust` baseline + a transport-trust
    sub-class in `crypto-internals` §1/§3/§4: outbound TLS validation disabled
    (`verify=False`/`rejectUnauthorized:false`/trust-all `TrustManager`) or a redirect re-sending
    credentials to a new host (CWE-295). Inbound TLS grading never saw the outbound leg; Named/
    External Credentials are excluded (TLS by construction).
  - **system-prompt-leakage (P2.10) + business-logic (P2.9)** — `agentforce-system-prompt-leakage`
    baseline + a prompt-CONTENT probe in `agentforce-package` §4 (a hardcoded secret in a
    packaged `genAiPromptTemplate`, or a guardrail expressed only in prompt text the model is
    trusted to enforce — OWASP LLM07:2025), plus a deliberately-modest out-of-order/abusive-flow
    note (business logic is hard for any tool — kept to a one-line-lead probe).
  - 4 new baseline entries (all `web_research_unverified`, OWASP API/LLM-Top-10 + CWE-derived);
    no new dimension files (19 dimensions) and no new test files — `test-baseline-integrity` +
    `test-dimension-extraction` cover them. Baseline now 165 entries (121 `verified_primary` /
    43 `web_research_unverified` / 1 `conflicting`); suite 26 files / 224 checks.
    *(Test-backed; no cold run — deterministic.)*
- **Coverage-gap closure, new dimension (2026-06-20): `resource-consumption-abuse` (P1.5).**
  The third and last of the new dimensions — and the one for the failure mode a pen-tester hits
  at runtime that no static dimension owned: how much, and how fast. Three shapes:
  **unrestricted consumption** (no rate limit/quota, unbounded page size/read/memory — OWASP
  API4:2023; the reviewer's DAST fuzzes at volume, so an unmetered endpoint is a standard
  finding), **denial-of-wallet** (each Agentforce inference / MCP tool call / LLM callout is a
  *metered, paid* round-trip — an attacker who drives them without a quota runs up the bill;
  OWASP LLM10:2025), and **algorithmic amplification** (ReDoS, decompression/parser bombs,
  unbounded N+1 fan-out, plus the Apex governor-limit self-DoS). Per-stack detection adds an
  MCP/Agentforce row (per-tenant budget? loop/recursion guard? `max_tokens`? callout timeout?)
  and an Apex row (SOQL without `LIMIT`, queries in loops, recursive async). Finder prompt +
  verifier guidance pin the three decisive facts: attacker-reachable trigger, presence of a
  cap/quota/guard, and the per-request *cost*.
  - **`resource-consumption-abuse`** (baseline, `web_research_unverified`) — API4:2023 +
    CWE-1333 (ReDoS); the general rate/quota/unbounded-read bar. Gated `[external-endpoint,
    mcp-server, managed-package]`.
  - **`cost-amplification-denial-of-wallet`** (baseline, `web_research_unverified`) — LLM10:2025;
    metered inference must be quota'd + token-capped + loop-guarded. Gated `[external-endpoint,
    mcp-server, agentforce]`.
  - `audit-methodology.md` §1.2 roster + count: 18 → 19 dimensions; `test-dimension-extraction`
    covers it automatically. **All three coverage-gap new dimensions are now in.**
  - Baseline now 161 entries (121 `verified_primary` / 39 `web_research_unverified` / 1
    `conflicting`); suite 26 files / 224 checks. *(Test-backed; no cold run — deterministic.)*
- **Coverage-gap closure, new dimension (2026-06-20): `untrusted-deserialization` (P1.2).**
  The second of the three new dimensions. No dimension owned object reconstruction from
  untrusted bytes before this (`injection-xss` is query/template-only). It owns three sinks:
  **native-object deserializers** (Python pickle/`yaml.load`, Node `node-serialize`'s
  `_$$ND_FUNC$$_`, Ruby `Marshal`, Java `ObjectInputStream`/`XMLDecoder` → RCE on
  reconstruction), **JavaScript prototype pollution** (`__proto__`/`constructor` deep-merged
  via `lodash.merge`/hand-rolled merges → property injection), and **Apex `JSON.deserialize`
  into sObjects** (caller-tampered `OwnerId`/`RecordTypeId`/status fields reaching DML without
  `Security.stripInaccessible`). Per-stack detection (Python/Node/Ruby/Java/Apex), a finder
  prompt that splits the three sinks and pins the trust-boundary question, verifier guidance
  that pins "trace the input to a trust boundary" + "read for `stripInaccessible` before DML".
  Boundaries: query/template injection → `injection-xss`; the write-authz angle →
  `apex-exposed-surface`/`mcp-surface`; XXE → scanner rule.
  - **`untrusted-deserialization`** (baseline, `web_research_unverified`) — OWASP A08:2021 /
    CWE-502; plain-data formats only over untrusted input, and Apex sObject deserialize must
    strip inaccessible fields before DML. Gated `[managed-package, external-endpoint,
    mcp-server]`.
  - `audit-methodology.md` §1.2 roster + count: 17 → 18 dimensions. The
    `test-dimension-extraction` standing test now covers it automatically (no new test file).
  - Baseline now 159 entries (121 `verified_primary` / 37 `web_research_unverified` / 1
    `conflicting`); suite 26 files / 223 checks. *(Test-backed; no cold run — deterministic.)*
- **Coverage-gap closure, new dimension (2026-06-20): `error-handling-disclosure` (P1.3).**
  The first of the coverage-gap map's three new dimensions — and the one with a live instance
  (a cold-fixture Node error handler that returned `err.stack` on a 401). It owns the
  error/exception path in two halves: **disclosure** (verbose errors, stack traces, framework
  debug pages, secrets/PII in logs — consolidating the previously-scattered `fail-info-disclosure`
  + `endpoint-error-hygiene-debug-off` + `violation-secret-data-in-debug` baseline coverage) and
  **fail-open security logic** (a `try`/`catch` around an authz / HMAC / license / CSRF /
  tenant-binding check whose exceptional branch *grants* access — CWE-636/755, which had no
  baseline owner). Per-stack detection heuristics (Python/Node/Ruby/Java/Apex), a finder prompt
  that prioritizes the stack-trace-on-401 case and reads the *catch body* for fail-open, and a
  verifier-guidance section that pins "read the catch, not the try" and "confirm the throwing
  input is attacker-reachable." Dimension roster + count updated in `audit-methodology.md` §1.2
  (16 → 17 dimensions).
  - **`error-handling-fail-open`** (baseline, `web_research_unverified`) — the new fail-closed
    requirement: a security decision must DENY on any exceptional path, never fall through to
    allow. Default-deny; access requires the check to affirmatively succeed.
  - **`acceptance/test-dimension-extraction.mjs`** (18 checks, NEW) — drives the real
    `build-audit-engine` over EVERY `methodology/dimensions/*.md`, asserting each file's §4/§5
    extraction markers + non-empty finder/verifier prompts. Closes the gap that
    `test-build-audit-engine` only exercised two hand-picked keys, so every current AND future
    dimension is guarded the moment its file lands. (This is the coverage-gap map's standing-test
    discipline made structural.)
  - Baseline now 158 entries (121 `verified_primary` / 36 `web_research_unverified` / 1
    `conflicting`); suite 26 files / 222 checks. *(Test-backed; no cold run — deterministic.)*
- **Coverage-gap closure, quick wins (2026-06-20) — the two default PMD AppExchange rules we
  scanned for but did not PREDICT.** A coverage audit (`docs/roadmap-coverage-gap-map.md`)
  found that while `run-scans` invokes `--rule-selector AppExchange`, the baseline named the
  rule *set* but not these two rules individually — so a partner running this toolkit then the
  real review would get a Code Analyzer hit we never anticipated (the "no-surprises" failure
  the Checkmarx-prediction exists to prevent). Both rule names + severity tiers re-verified
  against the official PMD AppExchange rules reference 2026-06-20.
  - **`violation-feature-management-change-protection`** (baseline, `verified_primary`) — the
    Critical rule `AvoidFeatureManagementChangeProtection`: runtime Apex calling
    `FeatureManagement.changeProtection(...)` to *unprotect* a packaged Feature Parameter =
    license-gate / entitlement tampering. Threaded into the **admin-surface** dimension
    (privilege escalation sub-class + the Apex detection row + the finder prompt) as the
    platform analogue of role escalation.
  - **`violation-getinstance-with-taint`** (baseline, `verified_primary`) — the Moderate rule
    `AvoidGetInstanceWithTaint`: Custom Settings/Custom Metadata `getInstance(userId/profileId)`
    with caller-influenceable Id = an IDOR cross-user config read. Threaded into the
    **apex-exposed-surface** dimension's per-record (IDOR) detection + finder prompt; the safe
    idiom (`getInstance()` / `getOrgDefaults()`) is named.
  - The existing **`scan-pmd-appexchange-rules`** entry is promoted `web_research_unverified →
    verified_primary` (the full ~37-rule set + Critical/High/Moderate tiering re-confirmed
    against the official reference today) and now names both rules. `run-scans` Family 1 names
    them in the load-bearing AppExchange-selector description.
  - **`acceptance/test-baseline-integrity.mjs`** (9 checks, NEW) — a stricter-than-counts
    standing test: every baseline entry's `applies_to` tokens, `severity_if_missing`, and the
    per-entry `verified_primary ⟹ non-null last_verified` / `web_research_unverified ⟹ null`
    implication (which the count-equality test could not catch), plus the two PMD-rule
    predictions' presence (encode-don't-park: a coverage win must not silently regress out of
    the data). Baseline now 157 entries (121 `verified_primary` / 35 `web_research_unverified` /
    1 `conflicting`); suite 25 files / 204 checks. *(Test-backed; no cold run — deterministic.)*
- **`harness/namespace-check.mjs`** (+ `test-namespace-check.mjs`, 3 checks) — the 0.7.2
  deployed-org deep-audit BUILD precondition (a real cold run surfaced the gap; Aiden caught
  it). When `package-readiness = needs-build`, the gate offered "build a managed 2GP first,
  then deep-audit" **without checking the package's namespace is registered to the authed
  Dev Hub** — so for a fictional-namespace fixture it offered a build that would fail at
  `sf package version create` AND mutate the repo with packaging scaffolding first. Now the
  gate confirms feasibility before asking: a namespace is **confirmed-buildable iff an authed
  org carries that `namespacePrefix`** (no CLI lists a Dev Hub's namespace registries
  cleanly, so this is the honest positive signal), and the build is offered ONLY on
  confirmation. It errs **conservative** — unconfirmed = "register + link it first," **never
  a false 'impossible'**. No namespace-corruption risk (a build *uses* a registered
  namespace, never registers/hijacks one; it operates on the package's own declared ns).
  Pure `classifyNamespace` + impure `namespaceStatus`. Validated live: Atlas (`atlas`,
  unregistered) → not-confirmed + the prereq; a `verdict`-namespace repo → buildable.
  `plugin.json` → 0.7.2.
- **`harness/docker-check.mjs`** (+ `test-docker-check.mjs`, 2 checks) — the 0.7.1
  throwaway-DAST environment prerequisite. The containerized throwaway (standup-stack +
  run-dast) needs Docker; this reports `available | absent | daemon-down` so the gate
  offers the throwaway-DAST **only when it can actually run**, and the engines now return
  `status:"no-docker"` with an honest install hint instead of a raw `docker: not found`.
  **Docker is a documented prerequisite, NOT something the toolkit tmp-installs** — unlike
  the userland scanners, it's a privileged daemon needing root-level setup (setuid uidmap
  binaries, subuid/subgid, kernel user-namespace settings) that can't be dropped into a tmp
  dir, so the honest move is to GUIDE the one-time system install and fall back to owner-run
  DAST when it's absent. Pure `classifyDocker` + impure `dockerStatus`. The journey gate's
  third consent now also **discloses the one-time ~3.6 GB digest-pinned ZAP image pull**
  (validated this session: a fresh-machine `run-dast` pulls the pinned image, 2m29s, then
  scans). `plugin.json` → 0.7.1.
- **`harness/tool-detect.mjs`** (+ `test-tool-detect.mjs`, 6 checks) — deterministic
  scan-tool detector: per scan family, which local tools are PRESENT vs
  installable-on-consent vs owner / owner-portal. Detection only — it never installs or
  fetches. The foundation for the 0.6.0 preflight auto-gate.
- **`harness/install-scanners.mjs`** (+ `test-install-scanners.mjs`, 14 checks) — the
  consented, tmp-scoped scanner installer (0.6.0 build step 1). Installs tool-detect's
  `installable_missing` set into `/tmp/sf-srt-scanners/<runid>/` (OUTSIDE the partner's
  repo), records an install manifest, and writes a gitignored project pointer
  (`.security-review/scanner-install.json`) so cleanup can later remove exactly those
  paths while keeping the evidence. Split so the honesty model holds: **`planInstalls()`
  is PURE** (byte-identical plan: per-tool dir, literal commands, pinned URL+sha256, the
  PATH to prepend — what the standing test asserts), **`installScanners()` is the ONE
  harness engine that touches the network** and **fails closed without explicit consent**
  (`--consent`; silence-is-yes never authorizes a network install — the 0.5.4 P0 class —
  and the gate is re-asserted at the engine boundary so a forgetful caller still can't
  install). Per method: `pip`→tmp venv, `npm`→`--prefix`, `git`→shallow clone, `binary`→
  pinned download that is **sha256-verified before it is ever made executable or extracted**
  (a mismatch aborts that tool — an unverified binary is never run). pip/npm/git rest on
  the package manager's own integrity (PyPI/npm/Git-over-TLS); the sha256 pin covers the
  raw binary downloads that have none. Binaries pinned (version + per-platform sha256,
  verified 2026-06-19): **osv-scanner 2.4.0, gitleaks 8.30.1, gosec 2.27.1, trivy 0.71.2,
  nuclei 3.9.0** (raw / tar.gz / zip — zip via `unzip` or a `python3 -m zipfile` fallback
  on hosts without `unzip`); a tool/platform with no pin is **skipped → PENDING-OWNER-RUN**,
  never installed unverified. ZAP is reclassified **owner-run** (a ~hundreds-of-MB Java/JRE
  GUI app, not a pinnable static binary — run-scans Family 3 already treats it as owner-
  executed; nuclei + schemathesis cover the automatable DAST surface). Validated both
  hermetically (git clone from a local repo + `file://` checksum good/bad, zero network)
  and with real network smokes (osv-scanner raw, detect-secrets pip venv, nuclei zip,
  gosec tar.gz — all install + run + checksum-verify on the dev host). The CC permission
  boundary is the outer Bash call, so one approved `node install-scanners.mjs --consent`
  covers every pip/curl/git/npm subprocess unprompted (verified vs the CC permissions/hooks
  docs 2026-06-19) — the mechanism behind "one gate → prompt-free installs".
- **`harness/stack-detect.mjs`** (+ `test-stack-detect.mjs`, 6 checks) — the 0.7.0
  foundation: the deterministic throwaway-DAST-target detector (the server-tier analogue
  of `package-readiness`/`tool-detect`). From a repo it classifies whether the external
  backend can be stood up as a disposable prod-equivalent for an active DAST —
  `runnable | needs-recipe | needs-secrets | n/a` — and classifies each required env var
  as **synthesizable** (a self-contained secret the toolkit generates itself, e.g. a JWT
  signing key — exactly what the prototype did), **external** (a real outside dependency
  the owner must supply → the scaffold-and-guide path), or **benign** (safe default). Pure
  `classifyStack`/`classifyEnvName` core + a dependency-free CLI fact-gather. Smoke-true on
  Atlas (Node forecast API, port 8080, `ATLAS_JWT_SECRET` synthesizable → `runnable`).
- **`harness/standup-stack.mjs`** (+ `test-standup-stack.mjs`, 6) + **`harness/teardown-stack.mjs`**
  (+ `test-teardown-stack.mjs`, 6) — the 0.7.0 slice-3 pair: the server-tier analogue of
  install-scanners/cleanup-scanners. `standup-stack` stands a runnable stack up as an
  ISOLATED throwaway container — encoding the prototype's lessons: **COPY the source into
  the container** (`docker create → cp → start`), never bind-mount it (so the working tree
  is ephemeral inside the container, never root-owned host files); **synthesize the
  self-contained secrets** (random values set on the throwaway → the toolkit can mint its
  own auth tokens for an authenticated scan) with the **values living only in the container
  env and the manifest recording NAMES only**; publish on `127.0.0.1` only; record a
  manifest of exactly the resources created. Fails closed without consent; pure
  `planStandup` + impure executor. `teardown-stack` is the asymmetric, manifest-driven
  remover: it deletes EXACTLY the recorded resources (container/image/network/tmp) and
  keeps the evidence, **name-scoped** so a non-`sf-srt-stack-` docker name is REFUSED (the
  docker analogue of assertSafeTmpRoot — a tampered manifest can never `docker rm` an
  unrelated container), idempotent + guaranteed (works from the manifest alone). Validated
  hermetically (12 checks) + a real Atlas smoke: the engines autonomously stood the Node
  API up (synth secret, `/healthz` 200), then tore it down (container + tmp gone, evidence
  kept, fixture left pristine). This makes the prototype's manual loop real engines.
- **`harness/run-dast.mjs`** (+ `test-run-dast.mjs`, 4) — the 0.7.0 slice-5 payoff: the
  autonomous DAST against the throwaway. Runs **digest-pinned ZAP** (`zaproxy/zap-stable@sha256:7c2f…`
  — the strongest acquisition path: the registry verifies it cryptographically and it bundles
  the JRE) against the URL `standup-stack` published, writes a host-owned copy of the report
  to `<repo>/.security-review/evidence/dast/`, and summarizes it by risk. ZAP runs as root and
  writes its working files root-owned, so the wrk dir lives in its OWN tmp tree and is removed
  via a throwaway root container — neither the project nor stack-teardown ever chases a
  root-owned file. Fails closed without consent; pure `planDast` + `summarizeZap` + an impure
  executor. Validated hermetically (4 checks) + the **full engine-chain Atlas smoke**:
  `standup-stack → run-dast → teardown-stack` produced a real 10 KB ZAP report (4 alerts —
  CSP missing, X-Powered-By leak, …), host-owned, kept through teardown, fixture pristine.
  Unauthenticated baseline this slice; the authenticated, endpoint-fed AF-plan pass (using a
  token minted from the throwaway's own synthesized secret) is the depth refinement (slice 5b).
- **`harness/scaffold-env.mjs`** (+ `test-scaffold-env.mjs`, 3) — the 0.7.0 slice-6
  credential scaffold-and-guide loop for a `needs-secrets` stack (one the toolkit can't
  fully synthesize — a real DATABASE_URL, a third-party key). It writes an env STUB naming
  the required external keys, the operator fills it, and a **deterministic re-check**
  (`envStatus`: a key counts filled only with a non-empty, non-placeholder value; `ready`
  iff all filled) lets the autonomous loop resume. The credential contract (CONVENTIONS §6)
  is load-bearing: the stub lives in the throwaway's **tmp dir, never the repo / not
  `.security-review/`**; `standup-stack` now takes `--env-file` and loads it via docker's
  `--env-file` so the **VALUES go straight into the container — never into argv, the
  manifest, or any state file** — and the tmp dir (values and all) is destroyed at teardown.
  `planStandup` now accepts a `needs-secrets` stack ONLY once a filled env-file satisfies it.
  Validated hermetically (4 checks across scaffold-env + standup) + a real loop smoke
  (needs-secrets repo → stub → WAITING → fill → READY).
- **`harness/cleanup-scanners.mjs`** (+ `test-cleanup-scanners.mjs`, 7 checks) — the
  ASYMMETRIC, manifest-driven teardown (0.6.0 build step 2). Removes ONLY the tmp tool dir
  the install created (`/tmp/sf-srt-scanners/<runid>/`) and keeps every evidence file —
  and the asymmetry is structural, not a careful filter: the tools live under the tmp root,
  the evidence lives under `<repo>/.security-review/evidence/` (a different tree), so a
  single `rm -rf <tmpRoot>` can never reach the evidence (the SCI's on-disk proof). It
  never touches a pre-existing tool (it only knows the paths the manifest recorded). Reuses
  the installer's `assertSafeTmpRoot` as the single safety source: a tampered/garbled
  manifest whose `tmpRoot` is `/`, `$HOME`, or the repo root is **REFUSED — nothing
  removed** (a bad manifest can never become an `rm -rf` disaster). Idempotent
  (`already-clean` on a second run), resolves from the project pointer / `--manifest` /
  `--tmp-root`, and marks the pointer `cleaned` (with `pathPrepend: []`) so run-scans knows
  the tmp tools are gone. Validated hermetically (6 checks: asymmetry, refusal, idempotency,
  nothing-to-clean) + a live install→evidence→cleanup roundtrip (tmp removed, a 75-byte
  evidence file survived byte-for-byte).

### Hardened (post-build adversarial audit of the 0.7.0 throwaway-DAST engines)
A 4-lens adversarial Workflow (credential-leak, docker-safety, honesty/teardown, wiring)
over the new engines surfaced 12 confirmed findings — several HIGH on this higher-stakes
surface (docker + credentials + active scanning). All fixed + test-backed + re-smoked on Atlas:
- **HIGH — credential leak via `docker logs`.** On a failed stand-up `standup-stack` captured
  the partner app's boot output (`docker logs`) into the manifest + stdout — an operator-filled
  external secret echoed at boot (a DSN with a password on a connect error) would land in a
  state file, violating the NAMES-only contract. The capture is REMOVED; on failure the engine
  records only a generic toolkit message, never partner output.
- **HIGH — `run-dast` now enforces a LOOPBACK target.** `planDast` parses the base url and
  fails closed on any non-loopback host (`refusing to active-scan a non-loopback host …`), so
  an active scan can only ever hit a local throwaway — never live prod, a remote host, or
  Salesforce infra. (Validated: it refuses `https://api.example.com`.)
- **HIGH — secrets off the docker argv.** Synth secret values were passed as `-e KEY=value`
  (visible in `ps`); they now go through a `0600` `--env-file` in the tmp dir alongside the
  operator-filled externals — no secret value ever reaches argv.
- **HIGH — guaranteed teardown.** A signal-handler safety net (`SIGINT`/`SIGTERM`/uncaught) in
  `standup-stack` removes the container if its own process is interrupted, and a new
  `teardown-stack --sweep` (name-scoped) removes every orphaned `sf-srt-stack-*` container +
  tmp tree from a crashed prior run — the engine-backed backstop the journey runs at start.
- **HIGH — needs-secrets run-id threading.** The journey now threads ONE run-id through
  scaffold-env → standup → teardown so the filled secret stub lives in the tmp tree teardown
  destroys (a different run-id would have orphaned it); `standup-stack` re-runs the deterministic
  `envStatus` and refuses to stand up on an unfilled env-file.
- **MEDIUM — orphan-on-failure + evidence honesty + grouping guard.** The name-stub manifest is
  written BEFORE `docker create` (deterministic names) so a crash is always teardown-able; DAST
  evidence is renamed `zap-throwaway-local-*.json` with a `README-throwaway-dast.md` stating it
  is NOT the production-equivalent submission scan; `assertSafeTmpRoot` now boxes the
  `sf-srt-stack`/`sf-srt-dast`/`sf-srt-net` grouping dirs too (not just `sf-srt-scanners`).
- **LOW — port validation** (`planStandup` rejects a non-1..65535 port).
- New/extended standing tests lock the fixes (loopback refusal, port validation, the four
  grouping-dir rejections, the sweep, the unfilled-env-file refusal). Suite **22 files /
  187 → 190 checks**, all green; the full hardened chain re-smoked on Atlas end-to-end.

### Hardened (post-build adversarial audit of the 0.6.0 install/cleanup engines)
A 4-lens adversarial Workflow (supply-chain, rm-safety, honesty, wiring) over the new
engines surfaced 13 LOW latent findings (none exploitable today — all pin-/consent-gated);
the real ones are now fixed + test-backed:
- **Degenerate `--run-id` no longer collapses the tmp dir onto the SHARED grouping base.**
  An empty / `.` / path run-id would have made `tmpRoot` = `<tmp>/sf-srt-scanners` (the
  container that holds every run), which cleanup's `rm -rf` would then nuke across
  concurrent runs. `planInstalls` now rejects a non-token run-id, and `assertSafeTmpRoot`
  rejects the bare grouping dir (must be a per-run sub-path). (audit #8 — the one real bug)
- **Only the verified binary lands on the scan PATH.** Archive tools (tar.gz/zip) now
  extract to a scratch `_pkg/` dir; just the intended binary is copied out and the rest
  (LICENSE/README/any second executable) discarded — so a future pin-bump can't silently
  put an extra executable on the scan PATH where it could shadow a system tool. (audit #1)
- **Smaller TOCTOU surface in `/tmp`:** the default run-id gets a `crypto.randomBytes`
  suffix (unpredictable path) and all tmp dirs are created `0700`. (audit #2)
- **`cleanup-scanners` refuses a symlink tmp root** (a real install never makes one) and
  the allowed-deletion bases are snapshotted at module load (a late `TMPDIR`/`HOME` change
  can't widen them). (audit #5/#6)
- `hasCmd` is now a shell-free PATH probe (no `sh -c` string). (audit #3)
- Honesty wording corrected: `planInstalls` is "deterministic / no mutation / no network"
  (it does one read-only realpath, so not literally "no I/O"); the post-install check is a
  "presence + exec-bit" check, not a full run-smoke; `run-scans` verifies each `pathPrepend`
  dir still exists (a reboot wipes `/tmp`) before trusting the pointer. (audit #7/#9/#12)
- Doc counts corrected (`test-install-scanners` is 14 checks, not 13). (audit #4/#10/#11)
- New standing tests lock the safety fixes: degenerate-run-id rejection, grouping-dir
  rejection, extract-to-scratch (only-the-bin-on-PATH), and the cleanup symlink refusal.

### Changed
- **`plugin.json` → 0.7.0.** The version is the `claude plugin update` trigger, NOT
  cosmetic: the updater compares the installed version to the marketplace's `plugin.json`
  version and is a no-op when they match — so building on `main` without bumping left the
  installed plugin stuck at 0.5.5 and a cold run would have tested the OLD code. Bumping to
  0.7.0 (the unified 0.6.0 + 0.7.0 build) makes the update pull the new code. **Lesson:
  bump `plugin.json` before a cold-validation run** (`marketplace update` + `plugin update`
  then pulls it); the git TAG is still the cold-validated release marker.
- **`skills/security-review-journey/SKILL.md` + `skills/run-scans/SKILL.md` — the
  throwaway-DAST engine chain wired into the journey (0.7.0 slice 4).** The preflight
  quick-scan now also runs `stack-detect`; the single gate gains a **THIRD distinct
  consent** — "stand up your backend as an isolated throwaway + active-scan it? yes/no"
  — explicit-yes-only (a live op), surfaced beside the scratch-org / scanner-install
  floor (never silence-is-yes). On yes (and `stack-detect = runnable`), the autonomous
  run invokes `standup-stack → run-dast → teardown-stack` (active scan hits a disposable
  mirror only — never live prod / Salesforce infra / a third party), ALWAYS tearing down
  even on abort, and labels the evidence **local-throwaway** (corroborating + a dry run,
  not the production-equivalent submission scan). `needs-secrets` → the scaffold-and-guide
  loop first; `needs-recipe`/`n/a`/declined → DAST stays owner-run with the generated plan.
  run-scans Family 3 recognizes the throwaway evidence with the same honesty label.
- **`skills/security-review-journey/SKILL.md` — the single up-front consent gate wired in
  (0.6.0 build step 3).** The preflight quick-scan now also runs `tool-detect.mjs` up front
  (Step 4) so the gate states the true scanner situation the first time. The preflight
  report's single gate now carries **two distinct consents**: (1) ask-tolerance
  (full-auto vs guided) and (2) **install the `installable_missing` scanners to a tmp dir
  for this run** — and the install consent is an **explicit yes only** (a network fetch =
  the 0.5.4 P0 class; silence-is-yes never covers it), surfaced alongside the live-probe /
  scratch-org floor, not as a silence-is-yes power-up. On yes the run invokes
  `install-scanners.mjs --consent` before scans and `cleanup-scanners.mjs` after; the
  consent explicitly covers **running** the tools (their standard Semgrep-rule / Nuclei-
  template / OSV-DB fetches), since that is inseparable from producing the evidence.
- **`skills/run-scans/SKILL.md` — consumes the consented tmp install (0.6.0 build step 4),
  and the 0.5.4 HARD BOUNDARY updated.** run-scans still **never installs anything itself**,
  but the consent-gated install now EXISTS as a separate gated step: when the journey gate's
  install-yes ran, run-scans reads `<target>/.security-review/scanner-install.json` (unless
  `status: cleaned`), prepends its `pathPrepend` to the scan-subprocess PATH, and turns the
  external-SAST/SCA/secret/TLS/DAST families from `PENDING-OWNER-RUN` into real evidence.
  Absent the pointer (declined / standalone run), the hard boundary holds in full — absent
  scanner = `PENDING-OWNER-RUN`. The boundary now also scopes the consented scanners'
  standard rule/template fetches as within the install-yes (the cold run's Semgrep/Nuclei/OSV
  fetches are consented, not an unconsented-egress violation).

### Roadmap — 0.6.0 preflight auto-gate + consent-gated scanner install (owner-pitched)
- Specced in **`docs/roadmap-0.6.0-preflight-autogate.md`**. Startup quick-scan (scope +
  `tool-detect` + `package-readiness` + `sf` auth) → ONE up-front consent gate (full-auto
  vs guided; install the missing scanners to a tmp dir for the run, removed at cleanup with
  the evidence kept) → everything downstream "just works" (real DAST/TLS/SAST output instead
  of PENDING-OWNER-RUN). The network install is the 0.5.4 P0 class → explicit consent only,
  test-backed + cold-validated before it ships. Honest constraint recorded: the toolkit
  cannot flip Claude Code's permission mode (shift+tab stays the user's), so it only
  consolidates its OWN confirmations into the single gate.
- **Build progress:** steps 1 (`install-scanners.mjs`) + 2 (`cleanup-scanners.mjs`) +
  3 (wire the single two-consent gate into the `security-review-journey` preflight) +
  4 (`run-scans` consumes the tmp-installed tools; else PENDING-OWNER-RUN) **all done**
  (above). Remaining: (5) cold-validate the gate fires once with two distinct consents +
  real Semgrep/OSV/DAST evidence on disk + cleanup removes binaries and keeps evidence → tag.

### Roadmap — the middle-band "judgment" fixture (post-v0.7.0-validation)
- Specced in **`docs/roadmap-middle-band-judgment-fixture.md`**. The v0.7.0 cold run landed
  at SCI 6% (catastrophe-tier) — a strong recall + honesty-gate proof, but the catastrophe
  and clean cases bracket the *easy* end. The differentiating value lives in the contestable
  middle band (~65–75% SCI): the *almost-ready* package where blocker-vs-hardening is
  arguable, path-to-green is 3 subtle items, and the toolkit must make the call a consultant
  gets paid for. Design: a mostly-compliant fixture + 4–6 contestable issues (severity-
  boundary, tempting-FP, fix-vs-document, partial/stale evidence, near-ready deploy) each with
  a sealed adjudication; grade the cold run on severity calls + subtle-FP precision + the SCI
  band + the path-to-green shape. Honest ceiling: still self-authored (tests judgment-on-
  anticipated, not coverage-of-novel — only a real external review closes that), but precision/
  calibration on the *subtle* case is far more authorship-independent than recall. Also tracked
  there: a large-target scale stress test (the fan-out scales with surface) + slice-5b.

### Roadmap — 0.7.0 throwaway prod-equivalent DAST harness (owner-pitched)
- Specced in **`docs/roadmap-0.7.0-throwaway-dast-harness.md`**. The server-tier analogue
  of the deployed-org deep audit, reusing the 0.6.0 install/cleanup machinery: a third
  up-front consent ("stand up a throwaway prod-equivalent stack + DAST it? yes/no"; either
  answer proceeds autonomously, marked toolkit-run vs owner-run), an auto-resolve →
  clarify loop, and a strict credential contract (discover the env *names* not values;
  consent to read a declared source else scaffold-an-env-stub + guide + confirm + resume;
  secret values never persisted, burned at teardown). Organizing principle:
  *throwaway-everything* — you only ever active-scan your own disposable mirror, never
  live prod / Salesforce infra / anyone else's. New engines mirror 0.6.0:
  `stack-detect` ↔ `tool-detect`, `standup-stack` ↔ `install-scanners`,
  `teardown-stack` ↔ `cleanup-scanners` (asymmetric, guaranteed teardown, keep evidence);
  ZAP folds in as a Docker-digest scan container. Honest ceiling: prod-equivalence is
  bounded by the repo's recipe, and the evidence is labelled with the throwaway's fidelity.

## [0.5.5] — 2026-06-18

The two larger items the 0.5.2 cold run surfaced and 0.5.4 deferred: the SCI must
not grade its own exam (P1), and the per-run audit/merge/index engines must ship in
`harness/` instead of being re-authored by the LLM every run (P2). Both encoded with
standing tests in the same changeset. Suite: 11 files/112 checks → **14 files/134 checks**.

### Fixed
- **P1 — the SCI no longer credits the toolkit's own static clears (anti-self-grading).**
  In the cold run, the (then LLM-authored) evidence index marked auto-fail classes
  (CRUD/FLS, sharing, SOQL-injection, sessionid-egress, XSS) SATISFIED from the toolkit's
  OWN white-box audit, moving the Submission Completeness Index 9%→17% — the tool grading
  its own exam. `compute-sci.mjs` now applies a **reviewer-reproducible credit rule**: a
  requirement counts SATISFIED only on evidence a Salesforce reviewer can independently
  reproduce (a scanner report the reviewer re-runs — Code Analyzer/SFGE/Checkmarx/gitleaks/
  Semgrep/OSV — an owner-signed artifact, or a structural N/A). A clear that rests only on
  the white-box static audit is the new `statically-cleared` disposition: surfaced as a
  separate signal, **never counted toward the completeness %, never clears the blocker
  floor** (Salesforce pen-tests these classes regardless). It **fails closed** — a
  satisfied/verified entry with no `reviewer_reproducible: true` flag is treated as
  statically-cleared, so an over-crediting or hand-authored index under-credits (safe)
  rather than inflating the headline. The clean-package path survives: a reviewer-
  reproducible scanner clear of a blocker class still clears the floor. Grounded in the
  live SF review (Code Analyzer is the tool SF itself runs; SFGE is the only user-mode-
  complete engine for CRUD/FLS), so a scanner clear is reviewer-meaningful while an LLM
  audit conclusion is not part of what the reviewer consumes.

### Added
- **`harness/build-evidence-index.mjs` (P1+P2)** — the deterministic evidence-index
  producer that compute-sci reads. The driver supplies its evidence MAPPING as DATA
  (`evidence-input.json`); the engine assembles `evidence/index.json` and **adjudicates
  the credit rule from the evidence location, never from anything the input asserts** —
  a cleared class backed by a scanner file under `.security-review/evidence/` (on disk) is
  reviewer-reproducible+satisfied; the same class backed only by the `docs/` audit report
  is statically-cleared. Fail-safe: a cleared class pointing at a non-existent scanner file
  degrades to statically-cleared.
- **`harness/merge-ledger.mjs` (P2)** — the mechanical, INCREMENTAL ledger merge (was
  LLM-re-authored and pass-1-only/overwrite each run). Loads the existing ledger, computes
  the dedup ids per `audit-ledger.schema.json`, maps verdicts to states, flips a re-found
  `fixed` entry to `confirmed`+`regression`, tracks first/last-seen across passes, redacts
  credential values, stamps the pass `audited_commit`, and appends `run-log.md`. Accepts
  the audit Workflow's bare result or the `{result, agentCount}` wrapper.
- **`harness/build-audit-engine.mjs` (P2)** — the deterministic assembler (was LLM-
  re-authored). The driver supplies its scoping as DATA (`scope-input.json`: applicable
  dimensions + per-dimension targets/stackNotes + context + N/A); the engine extracts each
  dimension's §4 finder prompt + §5/§6 verifier notes by marker, injects the run-args into a
  project-local `audit-engine.mjs`, and writes `target-map.json`. Shipping the marker
  extraction as tested engine code retires the slice-fragility G5 hardened; it aborts LOUD
  on a missing/malformed dimension file rather than emitting an empty prompt.
- Three standing tests: `test-build-evidence-index.mjs` (5), `test-merge-ledger.mjs` (6),
  `test-build-audit-engine.mjs` (5), plus 5 new P1 credit-rule cases in `test-sci.mjs`.

### Changed
- `templates/evidence-index.schema.json`: added the `reviewer_reproducible` boolean (the
  credit discriminator, set deterministically by the engine, never asserted by an LLM) and
  the `statically-cleared` disposition.
- `skills/audit-codebase/SKILL.md` (steps 5–6) and `skills/compile-submission/SKILL.md`
  (step 8) rewired to **invoke the shipped engines** (write the scope/evidence mapping as
  data → run the engine) instead of hand-assembling/hand-merging/hand-writing the index —
  closing the methodology's "engine code, never an LLM" contradiction that let the per-run
  scripts drift.
- `methodology/audit-methodology.md`, `CONVENTIONS.md` (§7 engine list + §8 layout),
  `README.md`, `acceptance/README.md` updated for the three engines, the credit rule, and
  the 133-check suite.
- `plugin.json` → 0.5.5.

### Validation
- All 14 standing-test files / 134 checks pass off disk.
- **Cold-validated (2026-06-18).** A full-surface fixture (managed package + Agentforce +
  MCP server + external API; ~23 organic planted issues + 5 negative controls) ran the
  autonomous journey end to end → SCI **BLOCKED 5%** (10 open critical / 42 high). Graded
  off disk:
  - **P2 confirmed** — the journey wrote `scope-input.json` + `evidence-input.json` and ran
    the shipped `harness/` engines; NONE of the three were re-authored into `.security-review/`.
  - **P1 confirmed** — audit-only clears were registered `statically-cleared` (not credited),
    `0` satisfied-without-`reviewer_reproducible`; re-deriving `compute-sci` off disk matched
    the run exactly. The 9%→17% self-grading is closed in a live run.
  - Recall complete (incl. the git-history secret via the Family-6 scan); precision `0/5` on
    the negative controls (incl. an injection-resistant prompt template).
  - **G4 live arm-and-deny** — armed, a Write to `authn-authz-flow.md` was DENIED by the
    PreToolUse hook (Claude Code discovered + invoked + honored the deny); disarmed, the same
    write proceeded.

## [0.5.4] — 2026-06-17

Hardening from the 0.5.2 cold-validation run + a parallel adversarial truth-audit
of the 0.5.2/0.5.3 code. Encoded immediately rather than parked (the toolkit's own
"encode the fix, don't remember it" rule). Two larger items the same run surfaced —
the SCI must not credit auto-fail classes from the toolkit's OWN static read, and
the per-run audit/merge/index engines should ship in `harness/` rather than being
re-authored each run — are scoped for the next checkpoint, not this one.

### Fixed
- **Scans never mutate the host or auto-fetch (P0, the cold-run's main finding).**
  `run-scans` now has a HARD BOUNDARY: it **detects** scanners but **never installs**
  them (`pip`/`pipx`/`npm i -g`/`brew`/venv bootstrap all forbidden) and never runs a
  scan that fetches third-party content over the network (e.g. Semgrep pulling
  registry rule packs). An absent scanner — or a scan needing an install/remote
  fetch — is `PENDING-OWNER-RUN` with the exact command. The cold run had
  `pip install`ed Semgrep + detect-secrets (then bootstrapped a venv) and fetched
  rule packs in a full-auto run; `silence-is-yes` authorizes neither. The
  `security-review-journey` consent contract now names installs/network egress
  alongside live-probe + scratch-org as actions that need explicit consent.
  Carve-out: an already-present tool's standard read (`npm audit`, RetireJS's
  bundled DB) is fine. (Consent-gated local install is a planned later capability.)
- **Artifact gate fails SAFE on a malformed ledger.** `computeGate` treated a
  non-array `findings` (a dict/string — the dict-shaped-payload class) as "no
  findings → clean → generate everything", silently fail-OPEN. It now WITHHOLDS the
  AuthN/AuthZ doc when `findings` is present but not an array (null/undefined keep
  the documented "no findings = clean" meaning). The **G4 hook** inherits this and
  also guards explicitly (a parsed-but-malformed ledger → DENY, fail-closed).
- **`package-readiness` no longer false-positives on an unrelated `04t` alias.** The
  `installable` scan matched ANY `04t` version alias in `packageAliases`, so a
  dependency package's alias — or a stale/renamed one — could mark the current
  (source-only) package `installable` and cite the wrong version. It now requires
  the alias key to be bound to the configured package (`${pkgName}` / `${pkgName}@…`).

### Changed
- `methodology/audit-methodology.md` dimension→category table: `crypto-internals`
  secondary is now `authentication/session-management` (JWT verification), reconciling
  the table with the code (`AUTHN_AUTHZ_DIMENSIONS`) and the prose two paragraphs below.
- `security-review-journey` Step 6 (deep audit) no longer hedges it as a "later-release
  capability / not a guaranteed step" — all five lifecycle skills ship; it runs whenever
  the preflight's proactive deployed-org offer is accepted (it's gated by LIVE consent,
  not by being unwired).
- `integration-pass-condition-0.5.2.md`: the brittle "(84)" suite-count annotation is
  replaced with "zero failing files" (the count grows each checkpoint), plus an explicit
  scope note (this bar grades the frozen-cache 0.5.2 behavior; 0.5.3/0.5.4 get their own).
- `acceptance/README.md` standing-tests section refreshed (dropped the stale "all eight"
  + the "STOP mode" description; enumerated the hook / injection / readiness families).

### Tests
- `test-artifact-gate.mjs` +3 (malformed dict/string → withhold; null/undefined/[] →
  clean). `test-authz-gate-hook.mjs` +2 (malformed dict / missing-findings → fail-closed
  DENY). `test-package-readiness.mjs` +1 (unrelated/dependency `04t` alias → needs-build).
  Suite **106 → 112 checks** / 11 files, all green.

## [0.5.3] — 2026-06-17

Preflight accuracy + proactive power-up offers. From watching a live cold run: the
preflight announced "deployed-org deep audit available (sf authed)" but only
discovered the blocker — a placeholder package alias / unbuilt version, i.e. nothing
installable — later, in the scope phase. So it told the operator "I have the auth"
before knowing the auth was moot. (Implemented immediately rather than parked in
notes — the toolkit's own "encode the fix, don't remember it" rule.)

### Added
- `harness/package-readiness.mjs` — deterministic deep-audit install-readiness from
  `sfdx-project.json`: `installable` (a real `04t…` version alias), `needs-build` (a
  2GP package is defined but has a placeholder `0Ho…XXXX` alias / `…NEXT`
  versionNumber / no `04t` alias), or `no-package`. Pure, no deps. Standing test
  `test-package-readiness.mjs` (incl. the exact Lumina placeholder shape →
  needs-build). Suite 100 → **106 checks** / 11 files.

### Changed
- Preflight (`security-review-journey` step 4) now runs `package-readiness` in the
  same pass as the `sf` auth sense, so **all** deep-audit preconditions are gathered
  UP FRONT — `sf` auth is necessary but not sufficient.
- The deployed-org deep-audit power-up is surfaced **proactively and accurately**:
  `installable` → a proactive consent point ("run it?"); `needs-build` → "no
  installable version (<reason>) — build first, then deep-audit?"; `no-package` / no
  auth → N/A. The operator's one up-front decision is fully informed instead of a
  mid-run "wait, the auth won't work" surprise. (A LIVE power-up still runs only on an
  explicit yes — the hard floor; the change is that the offer is true the first time.)

### Validated
- Deterministic core proven by `test-package-readiness.mjs` (6) + a live verdict on
  the Lumina fixture (`needs-build`, exact diagnostic). The preflight's integration
  behavior (gathers up front + offers accurately) is validated in the
  deployed-org-deep-audit coverage run (which needs an installable-version fixture).

## [0.5.2] — 2026-06-17

Triage simplification + a wider, election-independent AuthN/AuthZ withhold. Two
product calls from the 0.5.1 cold-validation run drove this: (1) the toolkit is an
AUDIT tool — it should always produce the full report and never pause to "fix or
flag" (and never offer to fix code — a 0.5.1 run improvised a draft-fixes offer the
skill never contained); (2) the gate had a secondary-category gap (JWT verification)
the grade surfaced. An adversarial pass over the reworked gate then caught a third
gap — session-token egress, the review's own named critical auto-fail class — that
would have generated the AuthN/AuthZ doc over a live hole.

### Changed — the gate is audit-only (no STOP, no fix-first, no election)
- `harness/artifact-gate.mjs` — collapsed STOP/election into auto-proceed: an open
  critical/high → `flagged` (full NOT-READY report, findings carried forward
  verbatim), never STOP, never a fix-first/continue-with-flags election. The one
  honesty line — withhold the AuthN/AuthZ doc over an open authN/authZ
  critical/high — now fires purely from the **ledger**, independent of any election
  (closing the bypass where a missing/non-continue-with-flags election skipped it).
  The `election` field is informational only.
- Skill prose (`security-review-journey`, `generate-artifacts`, `audit-methodology`,
  CONVENTIONS) — removed the fix-first triage option and the halt-on-open-critical
  default; the gate auto-proceeds. Made the identity boundary explicit: the toolkit
  **audits and reports, never pauses to fix, never drafts/suggests/writes code, and
  is read-only on partner source** (per-finding remediation *guidance* in the report
  is the ceiling).

### Added — AuthN/AuthZ withhold coverage (gaps caught by the 0.5.1 grade + an adversarial pass)
- `crypto-internals` → the authN/authZ dimension set (JWT verification: a broken
  alg-pin / claim-validation IS an authentication hole). Surfaced by the 0.5.1 grade.
- `sessionid-egress` → the set (a leaked SessionId is a bearer credential — the
  review's named critical auto-fail class). The methodology dimension→category map
  (which routed it to `communications-security`, contradicting its own category
  *definition* listing egress under authentication) is reconciled to match.
- The dimension membership match now trims+lowercases (a stray serialization
  whitespace can't silently drop the withhold).
- `acceptance/test-artifact-gate.mjs` — rewritten for the new contract (withhold
  fires with no election; no STOP; crypto-internals + sessionid-egress withhold;
  whitespace tolerated; `injection-xss` correctly NOT withheld).
- **G5 — audit-engine pre-launch check hardened.** The launch copies the Workflow
  template, replaces the `const INJECTED = … null` marker with the run-args, and
  validates it parses before running. The old recipe ("`JSON.parse` the slice
  between `const INJECTED = ` and the next `const`") matched the template's own
  header-comment mention of the marker → a false SyntaxError a weak model misreads
  as "injection failed" and aborts a healthy run. New `harness/injection-check.mjs`
  anchors on the real line-start `\nconst INJECTED = {` (string-aware brace match),
  with a decoy-bearing standing test (`test-injection-check.mjs`). Sweep: no other
  slice-parse fragility exists (the `{{…}}` template slots are fill-the-slot, a
  different mechanism; the cwd-during-perl wobble was a session incident, not a
  shipped artifact).
- Deliberately NOT added: `injection-xss` and `secrets-credentials` — inclusion is
  by **defect category, not blast-radius** (documented in the gate + methodology so
  a future change is a conscious one, not a silent re-introduction).
- **G4 — opt-in runtime-independent enforcement hook** (`hooks/hooks.json` +
  `hooks/authz-gate-hook.mjs`, auto-discovered on plugin enable). Backstops the
  AuthN/AuthZ withhold at the tool-call level, so a resume / refactor / direct
  write can't author the doc over a live hole even if it bypasses the skill gate.
  It is a **no-op by default**: it acts only when (a) the write targets the
  toolkit's own `docs/security-review/authn-authz-flow.md` AND (b) the operator
  opted in by creating `.security-review/hook-armed`; every other write exits
  immediately (the partner's unrelated work is never touched). Armed + gate
  withholds → it denies via the documented `permissionDecision: "deny"` (verified
  against current hook docs — exit 0 + JSON, not exit 2); **fail-closed** if the
  ledger can't be read. Reuses `computeGate` so the hook and skill can't disagree.
  Disarm = delete the flag. Defense-in-depth the human opts into, NOT structural
  impossibility. Standing test `test-authz-gate-hook.mjs` (9 checks). Suite 80 →
  **100 checks**.

### Validated
- The deterministic core is proven by the standing tests (**100 green**). The
  end-to-end LLM-loop behavior — the journey auto-proceeds (never halts at triage,
  no fix-offer), the withhold holds from the ledger, G5's anchored assembler
  launches the audit, and the G4 hook actually denies a live write when armed — is
  gated by `acceptance/integration-pass-condition-0.5.2.md`, a fresh cold
  full-journey run before the 0.5.2 tag.

## [0.5.1] — 2026-06-17

Closing the two honest residuals 0.5.0 left open — and the close of the first
was earned by *exercising* the engine, not reasoning about it.

**C1 staleness — the detect-changed-code path, finally run for real.** 0.5.0
shipped `ledger-staleness.mjs` with the fingerprint + no-change path live-proven,
but the path that *flags* a finding whose code changed had only ever run against
clean, hand-written paths in the unit test. Run against the real Lumina ledger it
immediately under-counted — **14/10 where the truth was 15/11** — because three
messy-but-real `finding.file` shapes a live finder actually writes defeated the
normalizer and were silently reported *current* (the worst direction for a
staleness check): comma/range line suffixes (`…:5,15-19`), a single finding citing
**two files** (`…server/index.js:27 and /abs/…/panel.html:7`), and target-absolute
path tokens. The normalizer is rebuilt (`fileTokens`): a conditional multi-file
split (only when `" and "` sits between real file cites, so `Command and Control/`
or `docs/sales and marketing/` is *not* fragmented), a letter-led extension check
(drops version strings like `v2.0`), a broader location-suffix stripper
(`#L7`, `:L5`, `(line 5)`, spaced commas), absolute-token relativization against
the git top-level with an absolute-suffix fallback, and the reported `file` is now
the *matched* changed path (not the first cite). A finding is stale if **any** file
it cites changed.

### Added
- `acceptance/test-ledger-staleness-detect.mjs` — a **hermetic** detect-path test:
  it stands up a throwaway git repo, writes a ledger with the real messy shapes,
  advances HEAD with real commits, and drives the CLI `main()` end to end (the
  git-shelling path the unit test never touched). Red on the 0.5.0 engine, green now.
- `acceptance/test-ledger-staleness-adversary.mjs` — 29 adversarial cases from a
  4-lens skeptic panel (false-positive / false-negative / encoding / crash),
  hand-adjudicated, plus the display + two-file contracts. The panel found a real
  false-positive class the first hardening introduced (the unconditional `" and "`
  split); it is fixed and locked here. Two out-of-domain limitations are asserted at
  their accepted behavior (extension-less bare-filename joins; a Windows repoRoot
  that is a subdir of the git top-level) so a future "fix" is a conscious choice.
- The standing-test suite is now **8 files / 80 checks** (was 6 / 43).

### Validated (no code change — the proof 0.5.0 deferred)
- **C1 detect path, LIVE.** On the real `~/srt-coldstart` fixture: a one-commit
  change to `ForecastService.cls` (+ `.gitignore` run-state hygiene) advanced HEAD
  past the audited commit, and `ledger-staleness` flagged **exactly the 15
  ForecastService findings** as stale while leaving the unchanged `server/index.js`,
  `ForecastController`, and Named Credential findings current — the two-sided bar.
- **fix-first — the gate's positive side, end to end.** 0.5.0 only ever proved the
  *withhold* (negative) side of the artifact gate. On a throwaway copy of the
  fixture, the three root causes + the XSS sink were remediated, then **every**
  confirmed finding was re-verified against the remediated source by an independent
  skeptic (default-to-still-present if the fix can't be quoted). Result: 22 fixed, 3
  honest low/medium residuals kept open → **0 open critical/high** →
  `artifact-gate` flips `flagged`→`clean` (suppress `[authn-authz-flow]`→`[]`) → the
  withheld `authn-authz-flow.WITHHELD.md` is **regenerated** as the real document.
  Staleness also flipped `stale`→`current` once the re-audit recorded the new
  fingerprint. The re-verification is the verifier half of a re-audit (not a full
  finder re-discovery); the deterministic gate flip is the proven mechanism. A
  process note from this run: an *ad-hoc* validation harness that let an agent read
  "the ledger" from the session cwd wandered into a foreign project's
  `.security-review/` — a guard caught it loud; the toolkit's own engine is
  unaffected because it anchors to the target repo (the 0.3.1 REPOSITORY ANCHOR
  discipline is exactly why).

### Changed — repo moved + renamed to the `runverdict` org
- `.claude-plugin/plugin.json` — version `0.5.1`; `repository` / `homepage` / `author`
  URLs → `github.com/runverdict`.
- `.claude-plugin/marketplace.json` — marketplace **`redbeardenduro-plugins` →
  `runverdict-plugins`** (owner → Verdict / `github.com/runverdict`).
- `templates/evidence-index.schema.json` `$id` and the README `marketplace add` command
  → `runverdict`. No `redbeardenduro` reference remains anywhere in the repo.
- **Install path changed** to:
  `claude plugin marketplace add runverdict/sf-security-review-toolkit` then
  `plugin install`/`update sf-security-review-toolkit@runverdict-plugins`. Note: the new
  marketplace name resolves only once this changeset lands on `main` — until merge,
  `main` still advertises `redbeardenduro-plugins` (the marketplace manifest is read from
  the default branch).

## [0.5.0] — 2026-06-16

Cold-start acceptance hardening. Two distinct inputs surfaced the gaps in this
release, and both mattered: **(1)** a 0-context, partner-style run of the whole
journey against a fresh bare-bones managed package (the cold-start exhibited the
behaviors a fixture-based acceptance test structurally cannot), and **(2)** an
**external critical-reader review pass** that named which of them are
publication-blocking — G4 in particular was escalated from "follow-up" to
"the thing that cannot ship" by that second reader, not by the run alone. The
combination is the leverage; neither a green fixture nor a self-review would have
produced this batch. The honesty-critical **determinizable** properties — the
artifact gate (G4), element-precise applicability (G1 data), the baseline counts
(F2), the SCI currency floor + freshness split (A4/A3), cross-dimension de-dup
(G2), and ledger staleness (C1) — are each **encoded as enforced logic with a
deterministic standing test**: 6 self-asserting test files (43 checks) that fail
the build if a refactor silently breaks them. The remaining fixes — the Checkmarx
"run #1 = discovery" framing (D1), the ADDRESSED sub-labels (B1), the `agentforce`
element *detection* (a model-run grep self-check), and the recall-capture wiring
(F4) — are skill/prose changes and are **NOT yet test-backed**: the same residual
class as the G4 lesson (a prose layer is only as strong as the model invoking it).
The first cut of all of this was then run through an **adversarial self-audit**
(skeptics told to assume a bug or overstatement the tests miss), which surfaced
real issues in the new code — including a false-negative in the very G4 gate this
release adds, and an over-stripped SSRF control — all fixed here before release.
That pass, not the summary, is the reason to trust the result.

### Added — deterministic engines + standing tests (no LLM, no deps)
- `harness/artifact-gate.mjs` — the enforced generate-artifacts gate (G4, below).
- `harness/applicable-requirements.mjs` — pure `applies_to ∩ elements` applicability
  computer; scope-submission now uses it for an exact, non-narrated applicable count.
- `harness/baseline-counts.mjs` — deterministic source of truth for the baseline's
  self-description numbers (so they can't drift again).
- `harness/finding-clusters.mjs` — deterministic cross-dimension de-dup for the triage
  headline (G2, below).
- `harness/ledger-staleness.mjs` — the resumption fingerprint check (C1, below).
- `acceptance/test-{artifact-gate,applicable-requirements,baseline-counts,sci,finding-clusters,ledger-staleness}.mjs`.
- `methodology/known-escapes.md` — a seeded-empty, honest recall log ("zero real-review
  outcomes recorded to date"). The one validation the fixtures cannot provide — recall
  against the failure classes the maintainer never thought of — accrues here, one real
  review outcome at a time. `stay-listed` now captures review outcomes into it.
- New `agentforce` architecture element + Bot/GenAiPlugin/GenAiPlanner/GenAiFunction detection in
  scope-submission; `audited_commit` on the ledger `pass` object (schema).

### Fixed — the publication gate (G4)
- generate-artifacts' "open critical/high → STOP; withhold the AuthN/AuthZ artifact"
  rule lived only in the journey's triage **narration** — a resume-into-artifacts (or a
  direct invocation) improvised past it and generated the very AuthN/AuthZ doc the gate
  exists to prevent (it would map a live, unremediated auth hole for the reviewer). The
  gate is now **enforced logic** (`artifact-gate.mjs`), consulted on every entry path;
  the continue-with-flags election is **persisted** to `.security-review/triage-decision.json`
  so a resume re-derives it deterministically; the AuthN/AuthZ doc is withheld (with an
  explicit placeholder) whenever an open finding sits in the authN/authZ category.
- **Precision about what this guarantees (the lesson of G4, applied to its own fix):**
  the gate is now enforced by a script the skills invoke on every entry path — strong,
  and a large step up from prose — but it is **not yet model-independent**. It still
  depends on the model actually running `artifact-gate.mjs` before generating; a future
  resume path, direct invocation, or skill-text refactor that reaches artifact generation
  without invoking it would be the same class of failure, one level less likely. The
  model-independent version is a **PreToolUse hook** that fires on the artifact-write tool
  call itself, regardless of which skill prose led there — the next hardening step, tracked
  as a residual. This release does NOT claim the bypass is structurally impossible; it
  claims it is enforced by a gate the skills invoke and proven against the exact failure
  case. (Overstating the fix to the bug whose lesson was "don't trust the bypassable
  layer" would be the wrong note to ship.)

### Fixed — scope step asserting inapplicable requirements (G1)
- `agentforce-*` and `mcp-*` requirements were gated on the generic `managed-package`
  element, so a plain managed package with no agent and no MCP server was told to satisfy
  Agentforce/MCP requirements it can never meet — manufacturing blockers and distorting
  the SCI. Re-gated 12 baseline entries (10 agentforce-* + 2 mcp-* listing reqs) onto the
  precise `agentforce` / `mcp-server` element tokens; scope-submission now detects an
  `agentforce` element (with a deterministic grep self-check) and computes applicability
  deterministically. Regression-guarded: a plain package drops all of them, a real
  agent/MCP package keeps them. (Deliberately NOT re-gated: `mcpthreat-ssrf-mitigation`
  keeps `external-endpoint` — SSRF is a real risk for any partner-hosted server that
  performs server-side fetches, not only MCP servers; the adversarial self-audit caught
  an over-strip of this one and it was restored.)

### Fixed / Changed — honesty surfaces
- **Currency now costs confidence, not the partner's score (A4):** a new band-level
  currency floor caps the readiness band below MATERIALS COMPLETE when a material share of
  applicable requirements rest on baseline entries verified >180d ago — but it **never**
  decrements completeness % (that would be false-incompleteness, penalizing the partner
  for the maintainer's lag). The two-axes reasoning is documented in `compute-sci.mjs`.
- **SCI freshness split (A3):** `caveated` now reports `stale` (verified-but-aged) vs
  `unverified` (never primary-confirmed) separately — different asks on the partner.
- **Cross-dimension de-dup (G2):** the triage headline now reports the raw count AND a
  conservative clustered view (distinct affected files, file-level critical/high,
  cross-dimension overlap), so the per-dimension fan-out re-finding one root cause under
  several lenses is never presented as that many distinct problems.
- **Resumption integrity (C1):** a resumed run now diffs the repo HEAD against each pass's
  `audited_commit` and flags findings whose files changed since — so a clean verdict is
  never presented against code that has regressed since the audit.
- **Checkmarx framing (D1):** the prediction now states explicitly that it is
  one-directional — Checkmarx runs proprietary queries the local stack lacks and WILL
  flag categories the prediction cannot see; treat portal run #1 as discovery, not
  confirmation. The caveat is echoed into the emitted prediction file's header.
- **ADDRESSED sub-labels (B1):** the reviewer-simulation verdict splits into
  `ADDRESSED-fixed` (a verified remediation, disclosed as resolved) vs
  `ADDRESSED-refuted(FP)` (a non-exploitable finding, disclosed via the FP dossier,
  never as a fix) — so a refuted finding can't be skim-read as fixed.
- **Baseline self-description counts (F2):** corrected the drifted README/SOURCES numbers
  to the deterministic count (155 entries: 118 verified_primary, 36 web_research_unverified,
  1 conflicting) and nulled the 6 WI-19 stub `last_verified` dates (they were never
  verified; null is honest). `baseline-counts.mjs` + a standing test keep prose and data
  in lockstep.
- `compute-sci.mjs` `--plugin` default is now relative (`import.meta.url`), not a
  hardcoded path — portability/cleanliness.

### Validation — clean full-journey integration run (2026-06-16)

A realistic cold-start (a fresh session, `run the security review` against a
managed-package + external-endpoint fixture) drove the whole journey end to end and
confirmed the back half **on the live path**, graded off disk:
- **G4 holds end-to-end** — the continue-with-flags election persisted, the gate was
  consulted (`flagged`, `suppress` exactly `["authn-authz-flow"]`), and generate-artifacts
  withheld the AuthN/AuthZ doc (real doc never drafted) for the correct reason, naming all
  13 open authN/authZ findings — **including A1's regression case** (`web-client` /
  `package-metadata` *secondary*-category findings, the exact class the gate's first
  version let escape).
- **G1 confirmed where the partner reads it** — the compiled SCI returned `BLOCKED`
  (3 criticals as the floor) with **no phantom `agentforce`/`mcp` blockers** in the
  blocker list, not just absent from the upstream scope count.
- **G2 / B1 / D1** rendered correctly live — the cluster view at triage; `ADDRESSED-refuted`
  sub-labels in the reviewer simulation; the Checkmarx "run #1 = discovery" caveat verbatim.
- **Smart-resume** recovered a real mid-run API connection-drop.
- Independent corroboration: Code Analyzer v5 + the Graph Engine (SFGE) — deterministic,
  non-LLM — flagged the **same** IDOR/CRUD-FLS root cause at the **same lines** the LLM
  audit found.

**Precisely what is NOT yet live-proven (kept honest — the lesson of this batch):** C1's
staleness **detection** — flagging a finding whose code *changed* since it was audited.
The `audited_commit` fingerprint stamps, the staleness harness runs, and the *no-change*
case correctly reports "current" — all confirmed live. But the code did not change between
audit and resume this run, so the detect-actual-staleness path remains **unit-test-only**:
a remaining live test, not a closed one. The G4 PreToolUse-hook hardening and the
prose-only fixes (D1/B1/agentforce-detection/F4) remain residuals as noted above.

## [0.4.4] — 2026-06-15

WI-16 + WI-22 — the last two roadmap items. With these the autonomous-orchestration
extensions (gap-audit §3a) are **feature-complete**: the toolkit now runs the whole
journey end to end and tells the partner, deterministically, exactly what to fix and
in what order.

### Added — WI-16: Checkmarx prediction (`run-scans` Family 2)
- The portal Checkmarx scan is owner-gated (auth + upload + 3 runs/version) and is
  never claimed as agent-run. Instead, after Family 1 + the LLM package dimensions,
  run-scans now **maps every confirmed package finding to its likely Checkmarx query
  category** and emits `evidence/checkmarx-prediction-<date>.md` — so the partner's
  three precious portal runs come back with *no surprises*. Honest framing: a
  prediction, never an equivalence. Optional genuinely-headless path: if `CX_APIKEY`
  (a paid CxOne licence) is set, run the real `cx scan create … --report-format sarif`
  as Family 2b; absent it, prediction-only.

### Added — WI-22: path-to-green
- `compile-submission` now writes `docs/security-review/path-to-green.md` — the single
  ordered remediation checklist from the current SCI band to `NO-SURPRISES READY`,
  sequenced **blocker → major → minor**: open critical/high findings (file:line + fix),
  unsatisfied blocker requirements, MISSING/PARTIAL artifacts (incl. the WI-19 policy
  stubs + the reviewer-simulation NOT-STATICALLY-EXAMINED list), and caveated/conflicting
  baseline entries — each tagged with the gate/SCI point it unblocks. A view over
  existing state; an empty path-to-green is what readiness looks like.
- README leads with outcomes (what you get) ahead of the component counts.

## [0.4.3] — 2026-06-15

WI-21 — reviewer-simulation. A new (14th) skill that reframes everything the audit
+ scans found as **what Salesforce Product Security will see**, ranked by the
reviewer's own attack priority. An external review rated "audit AS THE REVIEWER WILL" the
toolkit's strongest idea; this makes it first-class. It introduces no new finding
and no new SCI gate — it is the narrative over the ledger + SCI.

### Added
- **`methodology/reviewer-challenges.md`** — the Product-Security challenge
  checklist: the reviewer's questions + probes, ordered by their attack priority
  (Tier 1 public/guest reach → 2 authz bypass → 3 injection → 4 egress → 5 package
  hygiene → 6 infra/supply-chain), each mapped to the dimension(s)/scan family and
  baseline id that answers it, and the scope element that triggers it.
- **`skills/reviewer-simulation/SKILL.md`** — synthesizes
  `docs/security-review/reviewer-simulation.md`: each applicable challenge marked
  **WILL-FIND** (a confirmed-open ledger/scan entry matches — the reviewer
  reproduces it), **ADDRESSED** (a fixed/refuted entry with evidence — a
  no-surprises disclosure for the FP dossier), or **NOT-STATICALLY-EXAMINED**
  (named pen-test territory, never implied clean). Headed by "the first things the
  reviewer will hit." Filters by manifest elements (no TLS challenge for a
  package-only listing).
- Wired as journey step 7 (after scans/deep-audit, before compile; its
  open-challenge list seeds the path-to-green). Skill catalog + journey diagram
  updated (14 skills).

### Validated
- Against the Helios audit ledger (61 confirmed findings, managed-package +
  external-endpoint): the verdict mapping correctly surfaces Tier-1 guest-reach
  (WILL-FIND), Tier-2 IDOR×16 + VerifiedCustomerId (WILL-FIND), and Tier-4
  third-party-LLM (WILL-FIND) as the headline.

## [0.4.2] — 2026-06-15

WI-19 — the written-policy / org-config artifact pack. Closes the surface where a
submission stalls *after* the code is clean: the questionnaire's written-policy +
org-config materials that no static finder can produce. All six are owner-completed
**stubs** `generate-artifacts` pre-fills from detected facts — policy is a human
deliverable; the SCI counts each SATISFIED only with an owner-signed evidence entry,
never an un-signed stub.

### Added — six policy templates + baseline gates
- **`templates/`**: `incident-response-plan` (incl. the mandatory 24-hour Salesforce
  reporting duty), `data-retention-deletion` (retention per data class +
  deletion-on-uninstall), `disaster-recovery-backup` (RPO/RTO + restore testing),
  `vulnerability-remediation-sla` (time-to-fix by severity + the scan cadence),
  `hosting-architecture` (provider/region/network/prod-access/encryption, **extending**
  the data-flow subprocessor table, not duplicating it), `prior-pentest-attestation`
  (declare prior pen test / Checkmarx / SOC2 / ISO — or an explicit none + compensating
  posture). Authored multi-agent in the toolkit idiom (STATUS-PARTIAL header, `{{slots}}`,
  owner-input markers, provenance footer); secret-scan clean.
- Six baseline gates (`artifact-incident-response-plan`, `-data-retention-deletion`,
  `-disaster-recovery-backup`, `-vuln-remediation-sla`, `-hosting-architecture`,
  `-prior-pentest-attestation`), `applies_to` keyed to listing class, honestly calibrated
  `major` / `web_research_unverified` (toolkit-recommended completeness materials, pending
  per-item confirmation against the login-gated questionnaire).

### Wired — autonomous orchestration
- `generate-artifacts` step 11 auto-drafts the pack from the required-materials matrix for
  the detected listing class, pre-filling from §7/§8 facts (hosts, subprocessors, data
  classes, scan families) and leaving the rest owner-input + owner-signed. Bucket table,
  prerequisites, and description updated. `readiness-tracker` §1.7 carries the rows
  (SATISFIED only when signed).

### Validated
- For an external-endpoint + package scope the six policy ids select into
  `applicableBaselineIds` and read `MISSING` in the SCI (0 satisfied — correctly *not*
  credited until owner-completed + signed). Each template confirmed STATUS-PARTIAL +
  slots + provenance; `hosting-architecture` extends the subprocessor table.

## [0.4.1] — 2026-06-15

WI-17 — the OSS external-surface scanners. The biggest coverage add: the
partner-hosted server tree + its IaC, which Code Analyzer never sees but
Salesforce explicitly pen-tests ("Test Your Entire Solution"), goes from
LLM-read + secret-scanned to mechanically **SAST'd, SCA'd, and IaC-scanned**.
All tools free/OSS. `run-scans` is now eight families.

### Added — two scan families + two extensions (all free/OSS)
- **Family 7 — External SAST:** **Semgrep** (multi-language keystone, custom-rule
  capable) + **Bandit**/**njsscan**/**gosec** per detected language, over every
  non-package source root.
- **Family 8 — External SCA + IaC:** **OSV-Scanner** (multi-ecosystem CVE scan of
  every external lockfile) + **Checkov** (Terraform/CloudFormation/K8s/Dockerfile
  misconfig); **Trivy** is a one-tool substitute.
- **Family 3 (DAST) extension:** **Nuclei** (community CVE/misconfig templates) +
  **Schemathesis** (OpenAPI-driven contract fuzzing, riding the OpenAPI artifact
  `generate-artifacts` already emits) + ZAP OpenAPI import.
- **Family 4 (TLS) extension:** **testssl.sh / sslyze** producing *local,
  deterministic* TLS evidence — the file that **satisfies
  `endpoint-ssl-labs-a-grade` deterministically and clears its `conflicting`
  status** (no reliance on a contested external letter grade).
- Three new baseline gates (`scan-external-sast`, `scan-external-sca`,
  `scan-iac-misconfig`, `applies_to: [external-endpoint]`, `major`) — they
  auto-flow into `applicableBaselineIds` and feed the SCI; a confirmed critical in
  reviewer-reachable server code is a fix-now blocker.

### Fixed
- `compute-sci.mjs` now **fails closed** on an empty/missing scope manifest
  (0 applicable requirements → `NOT READY`, not the prior fail-open
  `NO-SURPRISES READY`).

### Validated (on the seeded Helios fixture — extended with a vulnerable server
route, a CVE-bearing lockfile, a misconfigured Dockerfile + Terraform)
- Semgrep caught the OS command injection (`server/index.js`); OSV-Scanner caught
  14 GHSAs (lodash/minimist/express); Checkov caught the Terraform `0.0.0.0/0`
  security group + public-read S3 and the Dockerfile latest-tag + runs-as-root.
  The scan evidence registers into the evidence index → the three external-scan
  requirements read `SATISFIED` in the SCI; the SAST-found critical flows to the
  ledger → `BLOCKED`. Every probe proven by running the actual tool, not asserted.

## [0.4.0] — 2026-06-15

The **autonomous-orchestration extensions** spine (roadmap §3a, WI-20 + WI-18) —
the dependency root the rest of the 0.4.x work hangs off. Built and wired into the
existing journey so it fires with no manual step; the remaining extensions (WI-17
OSS external-surface scanners, WI-19 written-policy artifacts, WI-21 reviewer-sim,
WI-16 Checkmarx-predict, WI-22 path-to-green) are queued behind it. Provenance:
synthesized from the 2026-06-15 external design-review pass, reconciled against the 0.3.1 dimension internals (most reviewer-flagged
code gaps were already covered — see the gap-audit §3a).

### Added — WI-20: the formal evidence model
- **`templates/evidence-index.schema.json`** — every readiness claim, scan family,
  generated artifact, and confirmed finding registers a typed evidence entry
  (`source`, `collected_by` agent/owner/scanner, `verified{value,how}`, `location`,
  `sha256`, `disposition`). Makes the toolkit's implicit HAVE-requires-evidence
  rule explicit data: a requirement is SATISFIED only with a registered, verified,
  on-disk file — no credit for un-evidenced self-attestation. `compile-submission`
  materializes the index from its artifact/evidence inventory.

### Added — WI-18: the Submission Completeness Index (SCI)
- **`harness/compute-sci.mjs`** — a deterministic, explainable readiness number
  that measures *materials + disposition completeness, never pass likelihood*
  (Salesforce pen-tests regardless). Pure rollup, no LLM, no learned weights, no
  network, no dependencies — same inputs yield byte-identical output. It reads the
  audit ledger + the evidence index + the scope-filtered baseline and emits a
  GATED block: a hard **blocker floor** (any open critical finding or unsatisfied
  `severity_if_missing: blocker` requirement → `BLOCKED`), over a 3-part vector
  (coverage `SATISFIED/PARTIAL/MISSING`, disposition of undispositioned
  critical/high, evidence freshness vs the 90-day window + `conflicting` baseline
  entries), a completeness % **explicitly labelled not-a-pass-prediction**, and the
  standing "NOT verified by this toolkit" list. Bands:
  `BLOCKED → NOT READY → MATERIALS COMPLETE → NO-SURPRISES READY`. Honesty by
  construction: never a naked single number, never the % without the gate and the
  not-verified list (CONVENTIONS §2).

### Wired — autonomous orchestration
- `compile-submission` (Phase 5) writes the evidence index, runs `compute-sci`, and
  renders its block at the top of `readiness-verdict.md` and the readiness-tracker
  header (new `{{SUBMISSION_COMPLETENESS_INDEX_BLOCK}}` slot).
- `security-review-journey` surfaces the SCI as the **pre-compile go/no-go signal**:
  `BLOCKED`/`NOT READY` halts and names the blockers; `MATERIALS COMPLETE`/
  `NO-SURPRISES READY` proceeds.

### Validated
- Ran `compute-sci` against the 0.3.1 Helios acceptance run: correctly `BLOCKED`
  (14 open critical findings + 18 unsatisfied blocker requirements), coverage
  5/107 satisfied, disposition 14 critical / 39 high / 14 dispositioned, freshness
  flagged the 1 `conflicting` baseline entry (`endpoint-ssl-labs-a-grade`),
  completeness 5% — and byte-identical on re-run (deterministic).

## [0.3.1] — 2026-06-15

Acceptance-proven release. The 0.3.0 coverage dimensions were validated by a
fresh-context run against a fixture that actually *contains* their failure
classes — and that run found (and this release fixes) two engine-robustness gaps
and one verifier-guidance loophole that would have let a real partner run silently
under-report. The dimension *concepts* were sound; the gaps were all in the shared
engine and the verifier's refute rules.

### Added — the acceptance harness (`acceptance/`)
- **`generate-fixture.mjs`** — builds "Helios Service Agent", a synthetic
  Agentforce managed 2GP seeded with one concrete instance of every probe in the
  three 0.3.0 dimensions, negative controls, and a deleted-but-recoverable
  git-history secret. Synthetic secrets are assembled from parts at runtime so the
  generator itself stays secret-scan-clean; the fixture is regenerated on demand,
  never committed.
- **`expected-findings.md`** — the sealed ground-truth plant list (grading key),
  kept out of the fixture so finders cannot read it.
- **`build-run-args.mjs`** — mechanically performs the `audit-codebase` run-args
  step (extract §4 finder prompt + §5/§6 verifier guidance per dimension, inject a
  project-local engine), with a focused single-dimension re-run mode.
- **`acceptance-report-2026-06-15.md`** — the graded result: `apex-exposed-surface`
  8/8 planted classes, `package-metadata` 10/10, `agentforce-package` caught the
  VerifiedCustomerId/third-party-LLM/confirmation/invocable/LLM-output/logging/
  prompt-hardening classes, Family 6 recovered the deleted secret from history, and
  0 false positives on the 8 negative controls.

### Fixed — engine robustness (`harness/workflow-template.mjs`)
- **Finder repo-anchoring.** A finder could be derailed onto the current working
  directory's *foreign* `scope-manifest.json` (when the engine runs from another
  project's directory) and return "the codebase is not present" — a silent false
  "clean". The shared context now hard-anchors every finder and verifier to
  `REPO_ROOT`, forbids reading the cwd or any foreign manifest, and forbids an
  empty result on a "could-not-find-the-repo" basis. (Surfaced when one finder
  produced 0 findings on a fixture loaded with planted issues; with the fix it went
  0 → 19.)
- **Verifier now receives §5/§6.** The adversarial verifier previously saw only a
  generic "confirm only if the exploit is reachable in real code" prompt and never
  the dimension's own verifier guidance / false-positive patterns — so it
  over-refuted declaration-level metadata violations (exposed message channel,
  `http://`/wildcard trusted host, `position:absolute` in component CSS) on a "no
  live caller / dormant config" rationale the Salesforce static review does not
  apply. The engine now threads each dimension's §5+§6 as a `verifierNotes` run-arg
  and treats declaration-level violations as confirmed-on-declaration (reachability
  sets severity, not validity). Documented in the template header and the
  `audit-codebase` skill so a partner's run threads it too.

### Fixed — dimension verifier guidance (`agentforce-package.md` §5)
- **"Reachability first" no longer reads as license to refute.** A packaged
  `genAiPromptTemplate`/`GenAiFunction`/action that ships in the managed package is
  a reviewer-visible artifact even when not currently wired to a live agent. §5 now
  states that reachability sets *severity* (downgrade to low/info, verdict
  `partially_real`) and **never** issues `false_positive` on a "dead packaged code
  / not currently invoked" basis — closing the loophole by which the under-hardened
  prompt-template finding (AP7/8/9/12) was being dropped.

## [0.3.0] — 2026-06-15

Coverage-completeness release — the recall-defining structural work. A maintainer
coverage-gap audit mapped the toolkit against the *complete* AppExchange/AgentExchange
review surface (the baseline's `fail-*`/`violation-*`/`agentforce-*` corpus + the Top-20 +
the reviewer categories) and found the recall holes were **structural** — whole classes a
real reviewer catches that no dimension or scan family touched. This release closes the four
CRITICAL ones. Built multi-agent (author → adversarial-review, with a "specificity" gate so
every probe is a concrete imperative command, not a vague mention a finder could skip);
engine-wiring done by hand. Honesty posture unchanged: this raises *recall on the known
failure classes* — a no-surprises submission, never a guaranteed pass; Salesforce pen-tests
regardless.

### Added — three new audit dimensions (the toolkit now has 16)
- **`agentforce-package.md`** — the single largest gap closed. Audits the *packaged*
  Agentforce/AI surface (GenAiPlanner/Plugin/Function, prompt templates, Bot, invocable-Apex
  actions) **independent of whether an MCP server exists** — so a managed-package-only
  AgentExchange listing is no longer un-audited. Covers the BLOCKER auto-fail classes
  (`VerifiedCustomerId` scoping, user-controlled record refs, third-party-LLM-in-package),
  prompt-injection hardening, LLM-output-as-taint, action classification + per-action
  CRUD/FLS, confirmation-required, prompt/response logging.
- **`package-metadata.md`** — the metadata/XML violation class no code-AST dimension reads:
  Locker apiVersion <40, LMC `isExposed`, JS-in-Salesforce-domain (`onClickJavaScript`
  weblinks, `REQUIRESCRIPT`), CSS-isolation (`position:absolute/fixed`), static-resource
  hotlinking, open-redirect `PageReference`, CSRF `confirmationTokenRequired`,
  RemoteSiteSettings/CspTrustedSites inventory, sensitive-info-in-URL.
- **`apex-exposed-surface.md`** — the exposed-entry-point authorization surface Code
  Analyzer path-traces but doesn't reason about: `@AuraEnabled`/`@RestResource`/`webservice`/
  `@InvocableMethod`/`global`/guest-reachable Apex — should it be exposed? per-record/IDOR
  authz? over-exposure? (Complements, never duplicates, SFGE's structured CRUD/FLS dataflow.)

### Added — new scan family
- **`run-scans` Family 6 — Secret scan (working tree + full git history).** Closes the gap
  where the checklist *asserts* a secret-scan evidence file that nothing produced. Mechanical
  gitleaks/trufflehog over every source root + IaC paths AND full history (deleted-blob
  surfacing — the `git log --diff-filter=D` heuristic becomes a real tool invocation), gated
  on `fail-hardcoded-secrets`, backing `artifact-credential-storage-attestation`. Keeps the
  private-repo-history vs submitted-surface distinction + a rotation-evidence field, and
  states the mechanical-scanner ceiling (misses custom-format/low-entropy secrets — the
  `secrets-credentials` LLM finder is the standing complement).

### Wired
- `audit-methodology.md` §1.2 applicability matrix + §4.1 dimension→category table + §6
  pass-1 band; the "Packaged Apex is not a dimension" note reconciled (structured CRUD/FLS
  dataflow stays Code Analyzer; should-this-be-exposed/per-record-authz + metadata violations
  are now dimensions). `CONVENTIONS §8` repo layout. So the engine **auto-selects** the new
  dimensions on detection — a fresh skill-guided run includes them with no manual step.

### Notes
- Remaining roadmap: 0.2.2 quick-wins (Code-Analyzer engine-selection by element, RetireJS
  over static resources, Apex-test-coverage gate, injection-xss SOSL/open-redirect, ZAP
  error-hygiene/header probes, agentforce metadata-lint, compile-submission gates) + the
  HIGH/MEDIUM probes. Two cosmetic minors deferred (an inlined §4.1 subsection that restates
  the now-authoritative central table; one host-anchored grep seed).
- **Acceptance test pending:** a fresh-context run against a fixture containing a packaged
  Agentforce agent + LWC/Aura + Flows + a git-history secret, to prove the toolkit (not a
  clever operator) auto-fires the new dimensions.

## [0.2.1] — 2026-06-13

Fixes from the first **fresh-window end-to-end run** of the autonomous flow against
a from-scratch test fixture (a generic ISV repo the toolkit had never seen). The
run drove correctly through preflight → scope → audit-launch and the engine
self-recovered from the issue below, but these are the seams worth closing so the
next partner doesn't hit them.

### Fixed
- **`audit-codebase` engine launch is now robust, not just recoverable** (the #1
  fix). The launch step was ambiguous ("inject the placeholder *or* the runtime
  binds `args`"), which led to passing run-args via the Workflow `args` parameter
  — where they arrive as a JSON *string*, `args.repoRoot` is undefined, and the
  run fails fast with "run args missing or incomplete" (0 agents). The step is now
  unconditional: **always** copy the template to
  `<target>/.security-review/audit-engine.mjs`, replace the `INJECTED` placeholder
  with the JSON run-args, and run that copy via `scriptPath` — never the `args`
  param (which remains only a safety net). Mirrored in the template header.
- **`node --check` caveat documented.** The template's top-level `return {…}` is
  legal in the Workflow runtime's async scope but `node --check` reports it as an
  "Illegal return statement." Both `audit-codebase` and the template header now
  state this is expected and must not be "fixed" — to pre-check, `JSON.parse` only
  the injected object, not the whole module.
- **Deterministic applicable-count** (`scope-submission`): report the count as the
  exact length of the compiled `applicableBaselineIds` list, never an estimate; an
  "applicable" count exceeding the baseline total is a counting bug.
- **Baseline-currency ranking** (`security-review-journey` preflight): rank by the
  newest **non-null** `last_verified` (a `null` must never sort ahead of a real
  date — a naive `sort | tail` misreports a fresh baseline as stale), and report
  the verified-count + newest date separately from the unverified (null) count.

### Added
- **README "Running it hands-off (permissions)"** — a recommended read-only
  allowlist for `.claude/settings.json` (only non-destructive sensing; no writes,
  nothing live) and a note that the multi-agent audit runs smoothest with
  auto-accept on for the run's duration (some finder commands like
  `find … -exec grep` can't be covered by a prefix allowlist). The optional
  deployed-org deep audit and any live probe always pause for consent regardless.

## [0.2.0] — 2026-06-13

The autonomous release. The toolkit goes from a set of à-la-carte skills to a
single, fully-orchestrated autonomous flow: say "run the security review" and a
cheap preflight scan reports what it found, what it actually needs, and what
optional power-ups apply — then it runs the whole journey to a complete,
downloadable submission package, pausing only at genuine safety gates. Built by
multi-agent authoring with an adversarial-review pass on every component, then
fixed and re-verified. The honesty posture is unchanged and non-negotiable: it is
read-only on your source and never claims you "will pass."

### Added
- **Autonomous, preflight-gated orchestrator** (`security-review-journey`,
  rewritten from router to driver). A universal preflight detects architecture
  (and reads the Dev Hub when `sf` is authed), emits a three-tier report
  (✓ detected · ⚠ audit-blocking needs · ✦ optional power-ups), then drives
  scope → audit → artifacts → scans → compile autonomously. The only hard stops
  are an audit-blocking missing input and consent before touching anything live;
  open critical/high findings halt-and-report by default (continue-with-flags is
  an explicit operator election). Broadened triggers so natural phrasings
  activate it; router/"where are we" behavior preserved.
- **Dev Hub auto-resolution** in `scope-submission`: with an operator-consented
  `sf` connection it auto-answers ~a dozen inputs from the Tooling API
  (released/coverage/validation-skipped, `IsSecurityReviewed`, the
  RemoteSiteSettings + CspTrustedSites external-endpoint inventory that becomes
  the DAST target list, the permission matrix, Named/External-Credential
  topology, test-org security posture) into `sf-autoresolve.json` — with a
  `describeSObject`-first guardrail. Submission/business acts stay
  Partner-Console-only. Adds a listing-direction (A/B) classifier that branches
  the MCP auth rules (outbound `client_credentials`-OK vs inbound ECA+PKCE).
- **Submission-package assembler** in `compile-submission`: assembles
  `docs/security-review/submission-package/` with an `INDEX.md` mapping every
  artifact to its exact Security Review Wizard step + upload slot, a
  `PENDING-OWNER-RUN.md` handoff, and conditional slot suppression (no empty
  Desktop/Mobile slots).
- **Eight-category report spine** (authN/session · authZ CRUD-FLS+sharing ·
  input-validation · output-encoding · crypto · comms-security · logging/error ·
  secrets-storage) across the audit report, and **agent/ForcedLeak detectors**
  in the MCP threat-model dimension (output-egress allowlist, stale/expired
  allowlisted-domain exfil, untrusted-CRM-text-as-instructions).
- **Optional `sf`-CLI-gated deployed-org deep audit** — five lifecycle skills
  brought in and adapted (à-la-carte → orchestrated): `bootstrap-cli-auth`,
  `build-managed-package`, `install-and-verify-package`,
  `teardown-mcp-registration`, and the new `audit-deployed-package`. They stand
  the package up in a throwaway org and audit the *deployed* artifact (the
  reviewer's own test): least-privilege grants as a subscriber gets them
  (including install-time UEC grant-drop verification), Graph-Engine CRUD/FLS on
  the installed package, callout resolution, and install+uninstall integrity.
  Self-contained (no runtime dependency on any other plugin); the four reused
  skills were authored by this toolkit's author and contributed to
  `mvogelgesang/sf-mcp-partner-toolkit` — attributed in the new `CREDITS.md`.

### Notes
- Validated end to end by a fresh-context run against a real production codebase
  on 2026-06-13 (see Status in the README).
- Honesty/genericization guardrails enforced: the public repo carries no
  references to private design/research docs, no perishable fee literals (the
  fee lives in the baseline), and the leakage sweep is clean.

## [0.1.1] — 2026-06-13

First fine-tuning pass driven by a **fresh-context end-to-end validation run**: the
toolkit was executed cold against a real production codebase (a multi-tenant SaaS backend with an MCP server and two managed 2GP packages). The audit engine performed well — from an empty ledger it
re-discovered every known-open finding, refuted 4 of 9 candidate findings against the
source with precise code evidence (zero unverified), did not re-confirm a single
already-fixed item, and surfaced real findings a prior hand-built audit had under-rated;
the generated artifact pack matched a hand-built reference pack on substance and exceeded
it on honest open-gap flagging and tool-count reconciliation. The changes below are the
refinements that validation surfaced.

### Changed
- **scope-submission: the manifest's `package` block is now `packages[]` (an array).**
  An AgentExchange MCP listing commonly ships **two** packages — a thin MCP-registration
  package (ESR + External/Named Credential + permission set) *and* a separate Canvas/UI
  embed package — which the previous single-`package` schema could not represent. The
  step-7 schema example and the surrounding prose now record each detected package as its
  own entry.
- **scope-submission: `canvas` added to the endpoint `role` enum** in the manifest schema
  example (was `mcp | identity | web-app | api`), since Canvas is a first-class scoped
  element with its own audit dimension.
- **secrets-credentials dimension: sharper review-gating guidance on git-history secrets.**
  A committed production secret is always a critical, rotate-now item — but the report must
  distinguish *security* from *review-gating*: a secret in the partner's **private source
  repo history** is a breach item the Salesforce reviewer does **not** scan for (the review
  reads the submitted package, the live endpoints, and the docs — not the partner's repo),
  whereas a secret in the **submitted package** or reviewer-reachable code is also a
  guaranteed flagged finding. Rotate either way; only frame a finding as
  "submission-blocking because the reviewer will catch it" when the secret is in the
  submitted surface. This keeps the report precise without softening the rotation imperative.

### Notes
- No engine, schema-of-findings, or skill-contract changes — re-running the audit against
  the same codebase reproduces the same findings (convergent). These are documentation and
  manifest-shape refinements.

## [0.1.0] — 2026-06-12

Initial release. Eight skills (security-review-journey orchestrator + scope-submission,
audit-codebase, generate-artifacts, run-scans, prepare-test-environment,
compile-submission, stay-listed), 13 audit dimensions, 9 artifact templates, the
multi-agent audit workflow harness + authenticated-DAST (ZAP) plan generator, and the
baseline-as-data requirement map. Apache-2.0.

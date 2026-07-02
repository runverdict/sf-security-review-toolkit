# Authoring Conventions — sf-security-review-toolkit

Binding rules for every file in this repo. They exist so the toolkit stays honest,
generic, and current. Contributions that violate the honesty or genericization
rules get rejected regardless of quality.

## 1. What this toolkit is (and is not)

It **prepares** an ISV partner's AppExchange/AgentExchange security review
submission: it audits the partner's own codebase, generates the required artifacts,
orchestrates the required scans, and walks the human through the steps no tool can
do. It does **not** pass the review, replace the reviewers' own pen test, or
certify anything. Every skill, template, and report must preserve that distinction.

## 2. Honesty guardrails (non-negotiable)

- Never mark a scan, test, or certification complete without an evidence file the
  skill actually verified (report output, SSL Labs JSON, screenshot path).
- Every generated artifact distinguishes **automated** (what an agent did, from
  what inputs) vs **owner-run** (what the human did or must do).
- Every skill run ends with an **"Automated vs. manual recap"** section.
- The readiness verdict must list what was NOT verified, with the explicit caveat
  that Salesforce performs its own penetration testing regardless of submitted
  evidence.
- White-box agent audits are described as static/code review — never as DAST or a
  pen test.

## 3. Genericization (public-repo hygiene)

- No partner-specific endpoints, org IDs, credentials, file paths, internal
  hostnames, or company-identifying detail. Field-tested patterns appear
  anonymized ("a FastAPI backend with Postgres row-level security", "a thin 2GP
  registration package").
- No partner-gated identifiers: no Trialforce Template IDs, no W-numbers
  (Salesforce work items), no verbatim text from login-gated docs. Cite them the
  way the sibling MCP toolkit does: "the MCP Client Partner Technical Guide
  (login-gated; ask in the Partnerblazer Slack MCP channel or via your Partner
  Account Manager)."
- The Salesforce partner Slack is referenced as a *place to ask*, never quoted.

## 4. Baseline-as-data (currency model)

All requirement facts live in `baseline/requirements-baseline.yaml` — never
hard-coded in skill prose. Each entry carries:

```yaml
- id: dast-scope-includes-identity-endpoints   # stable kebab id
  requirement: ...                   # one sentence
  details: ...                       # thresholds, formats, exact expectations
  applies_to: [managed-package | external-endpoint | mcp-server | canvas | both | all]
  automation: fully | partially | manual_only
  automation_notes: ...
  severity_if_missing: blocker | major | minor | informational
  sources:
    - url: ...
      date: ...                      # publication/updated date or "unknown"
      kind: official | community | partner_gated | empirical
  verification: verified_primary | web_research_unverified | conflicting
  last_verified: YYYY-MM-DD | null
  conflicts: ...                     # only when verification: conflicting
```

Rules:
- Skills MUST read the baseline at run time and warn when `last_verified` on the
  entries they use is older than **90 days** (the review process changed three
  times in 18 months: Chimera retirement, Code Analyzer v5, AgentExchange).
- `conflicting` entries are surfaced to the user as "verify with your Partner
  Account Manager / partner Slack before relying on this" — never silently picked.
- `partner_gated` sources are cited by name only (see §3).
- `baseline/SOURCES.md` is the registry: every source URL once, with what it
  corroborates and when it was last checked.

## 5. Skill structure (mirrors sf-mcp-partner-toolkit)

- Frontmatter: `name`, `description` (when to use it, in one breath),
  `allowed-tools` (narrowest workable set).
- Body sections in order: title · one-paragraph promise · **When to use** (with
  NOT-for bullets) · **Prerequisites** · numbered **Steps** · **Automated vs.
  manual recap** · **What feeds the next skill**.
- Steps encode *failure modes*, not happy paths — every "why" that cost someone a
  review cycle gets a sentence.
- Skills are self-contained: never assume another skill ran first; detect state
  and degrade. Cross-references use the installed form
  `/sf-security-review-toolkit:<skill>`.
- Shared assets are referenced as `${CLAUDE_PLUGIN_ROOT}/baseline/...`,
  `${CLAUDE_PLUGIN_ROOT}/methodology/...`, `${CLAUDE_PLUGIN_ROOT}/templates/...`,
  `${CLAUDE_PLUGIN_ROOT}/harness/...`.
- Multi-agent work: prefer the Workflow tool when available; every workflow has a
  documented sequential fallback using plain subagent (Task/Agent) calls.
- Declare token-cost expectations up front for anything that fans out agents
  (`quick` / `standard` / `exhaustive` tiers with approximate agent counts).

## 6. Target-repo state model

Skills write into the PARTNER's repo, never into the plugin:

- `<target>/docs/security-review/` — generated artifacts (committed, reviewable).
- `<target>/.security-review/` — machine state: `scope-manifest.json`,
  `audit-ledger.json`, `evidence/` (scan outputs, SSL Labs JSON, screenshots),
  `run-log.md`, `runs/run-<k>/audit-ledger.json` (per-run ledger snapshots for the
  cross-run stability read, audit-codebase step 9), and
  `recurrence-confidence.json` (the deterministic recurrence-confidence artifact).
  Recommend the partner commits this too (the ledger is what makes re-audits
  incremental), excluding any credential material.
- Nothing in state files may contain secrets; skills must refuse to write captured
  credentials and say where to put them instead (env vars, vaults).

## 7. Audit engine rules

- The find → **adversarial-verify** → synthesize loop is mandatory. Findings that
  skip verification are never shown as findings.
- Precision over volume: a finding requires exact file:line, a concrete
  `exploit_scenario` (attacker, request, impact), and survives a skeptical
  verifier who read the gating code. Correct controls are not findings.
- Severity taxonomy: `critical` (auto-fail / cross-tenant / key compromise),
  `high` (must fix before submission), `medium` (likely flagged; should fix),
  `low` (hardening), `info`. Verifiers emit `adjusted_severity`.
- The known-findings ledger (`audit-ledger.json`) carries every confirmed,
  refuted, fixed, and accepted-risk finding across runs; finder prompts embed
  the ledger as "do NOT re-report" context. This is what makes pass N+1 cheap
  and quiet.
- Dimensions are concept-stable, target-variable: each dimension file defines the
  threat concept, what "good" looks like, and **detection heuristics** for
  locating the relevant code per stack (the stack-adapter step resolves real
  paths before finders run).
- **Determinizable honesty claims are engine-backed, not narrated (0.5.0).** Any
  self-describing count, applicability set, readiness band/gate, finding de-dup,
  or staleness check MUST be computed by a pure `harness/*.mjs` engine — no LLM,
  no network, no dependencies, byte-identical on re-run — and guarded by a
  self-asserting `acceptance/test-*.mjs` standing test that fails the build if the
  property breaks. A rule that exists only as skill prose is only as strong as the
  model that remembers to invoke it (a cold-start run proved this twice: the
  AuthN/AuthZ-withhold gate, when it lived in journey narration, was improvised
  past on a resume path). The enforced form lives in `harness/artifact-gate.mjs`,
  `applicable-requirements.mjs`, `baseline-counts.mjs`, `finding-clusters.mjs`,
  `ledger-staleness.mjs`, `injection-check.mjs`, `package-readiness.mjs`,
  `compute-sci.mjs`, `recurrence-confidence.mjs` (cross-run recurrence
  classification over N ledgers — the variance is engine-classified, never
  narrated), and the per-run engines that replaced LLM-authored
  scripts — `build-audit-engine.mjs` (extract + inject the audit run-args),
  `build-artifact-engine.mjs` (the 0.8.21 P2-PARITY twin for the ARTIFACT phase:
  inject the artifact-drafting DATA into `artifact-workflow-template.mjs`, the same
  shipped-template-plus-injected-DATA pattern, so neither phase hand-authors a
  Workflow with inline prompt strings — the JS-escaping/parse-error class is gone
  from BOTH phases now),
  `merge-ledger.mjs` (mechanical ledger merge), and `build-evidence-index.mjs`
  (the evidence index + the reviewer-reproducible credit rule). The credit rule
  is the load-bearing one: SATISFIED requires reviewer-reproducible evidence;
  an audit-only clear is `statically-cleared` and never moves the headline (the
  toolkit must not grade its own exam). Prose-only fixes are permitted
  but must be labelled NOT-test-backed in the CHANGELOG (same residual class), and
  a high-stakes prose layer is a candidate for promotion to an engine + a
  PreToolUse hook (runtime-independent enforcement).
- **Operator-facing GATES are pinned by an engine, rendered VERBATIM by the driver
  (0.8.22).** The `AskUserQuestion` gate option sets were driver-improvised prose, and a
  cold campaign caught the drift (the same depth gate offered a different option set
  run-to-run). The fix applies the repo's contract — the ENGINE owns structure, the driver
  supplies data — to the gate class. `harness/gate-spec.mjs` is a FROZEN catalog keyed by
  gate id + a PURE `gateOptions(gateId, facts)` selector that returns
  `{gate, consent, header, question, options:[{label, description, decision}]}`. It mirrors
  `build-audit-engine`'s `ALWAYS_ON` (the decline/skip option is FORCE-INJECTED on every
  consent gate, so a caller cannot drop it), `build-artifact-engine`'s `FOCUS_MIN` THROW
  (FAIL CLOSED on an unknown gate id or any option missing `label`/`description`/`decision`,
  or a decision that is not a valid `record-consent` token — exactly `affirm`/`deny`), and
  `applicable-requirements`'s pure set-operation style (no LLM/network; the CLI's `--target`
  ledger read is the only FS touch). **The render-verbatim-gate contract:** the driver lists
  `gate-spec.mjs` in `allowed-tools`, calls it, renders each option's `label`/`description`
  VERBATIM (never paraphrases, reorders, or invents the option set), and pipes ONLY the
  chosen option's `decision` token to `record-consent.mjs --decision`. The engine owns the
  option set upstream; `record-consent` pins the decision downstream; the driver improvises
  neither. No silent behavior change — gate-spec only fixes WHICH options appear and their
  wording; the consent semantics (`record-consent` token, `build-audit-engine` fail-closed
  verify) are unchanged. **Slice 5 (0.8.27)** extends the catalog to the scope-submission gates
  (`mcp-probe`, `scope-confirm`, the `partner-program` six-gate family, `clarify-detection`,
  `listing-type`, `tenancy`) and adds a `kind` taxonomy (`consent | election | answer`,
  load-validated as `consent ⟺ kind:'consent'`) encoding TWO semantic classes: a CONSENT-to-act
  gate force-injects the decline and pipes its `decision` to `record-consent`; an ANSWER gate's
  selected option is RECORDED into the scope manifest (no force-injected decline, not piped).
  Guarded by `test-gate-spec.mjs` + `test-tier-no-reask.mjs` + `test-scope-gates.mjs`.
- **Operator-facing OUTPUT is pinned by render harnesses + `{{SLOT}}` templates,
  rendered VERBATIM by the driver (0.8.23–0.8.24).** The gate-spec rule's twin for the OUTPUT
  class — the readiness verdict / status / target-map renders were driver-improvised
  (a table one run, prose the next; reordered sections; a re-worded standing caveat).
  Two mechanisms, both ENGINE-owns-skeleton / driver-supplies-data:
  (1) **Render harnesses** extend a deterministic-JSON emitter with a fixed-block mode
  the way `compute-sci.mjs` does — `harness/render-stability.mjs` emits the verbatim
  Finding-Stability block from `recurrence-confidence.json` (0.8.23). Slice 3 (0.8.24,
  WI-04/WI-05) adds the entry-experience siblings: `render-target-map.mjs` (the approval
  table), `render-preflight.mjs` (the 3-tier report with the FIXED 4-state deployed-org
  enum), `render-scan-status.mjs` (the 8-row Family table), `render-router-status.mjs`
  (the 3-line "where are we?"), `render-recap.mjs` (the end-of-run recap, emitted by
  `merge-ledger.mjs`), and `finding-clusters.mjs --headline` (the triage headline — the
  FAILURE VERDICT, byte-identical at the audit exec summary AND the journey blocker gate).
  (2) **`templates/operator/*.md.tmpl`** `{{SLOT}}` skeletons with fixed `##` section
  order, each engine block wrapped in `<!-- RENDER:… -->` sentinels — filled by
  `harness/render-readiness-verdict.mjs`, which force-injects the SINGLE canonical
  `STANDING_CAVEAT` constant (so source and output can't diverge) and FAILS CLOSED on
  any unfilled `{{SLOT}}` (the "not submission-ready" lint, promoted from skill prose to
  an engine — mirrors `build-artifact-engine`'s missing-template throw).
  **The render-verbatim-output contract:** each pinned surface's skill (a) lists the
  render harness / template in `allowed-tools`, (b) carries "print the harness stdout /
  fill the `.tmpl` VERBATIM — never paraphrase, reorder, drop a column, or flip
  table↔prose", and (c) pastes deterministic blocks (the SCI block, the stability block)
  byte-for-byte. Policed by `lintRenderVerbatim` (`render-readiness-verdict.mjs`), which
  flags a skill that hand-builds a Markdown table for a surface that has a registered
  renderer/template. Guarded by `test-render-stability.mjs` + `test-readiness-verdict.mjs`
  + the Slice-3 tests (`test-finding-clusters-headline`, `test-render-target-map`,
  `test-render-preflight`, `test-render-scan-status`, `test-render-router-status`,
  `test-render-recap`) + the Slice-4 scope-submission REPORT renders (0.8.25, WI-06 reports
  half: `render-detected-elements.mjs` INV-15, `applicable-requirements.mjs --render` INV-16,
  `render-mcp-scope.mjs` INV-43+44 — the MCP renders never present an un-probed fact as probed —
  and `render-sf-autoresolve.mjs` INV-45 — which SURFACES every security flag + operator-answer
  conflict and NEVER renders a secret), guarded by `test-render-detected-elements`,
  `test-render-mcp-scope`, `test-render-sf-autoresolve`, and the extended
  `test-applicable-requirements`; each asserting determinism + a golden snapshot + fail-safe + the
  skill-wiring (grants + references + "print verbatim"). The Slice-5 final scope-summary
  (0.8.27, WI-06/INV-06: `render-scope-summary.mjs` — the fixed Step-9 readout whose
  operatorConfirmed gate states render HONESTLY (✓/✗/not-recorded, never a fabricated ✓) and whose
  missing-manifest branch renders "scope not finalized", never a fabricated "ready") is guarded by
  `test-render-scope-summary.mjs`.
- **Irreversible sf/host ops are consent-gated, fail-closed (0.8.11).** The
  deployed-package deep-audit skills run live, irreversible Salesforce / host ops
  (`sf package version promote` — a PERMANENT release — plus package install/uninstall,
  scratch-org create/delete, `sf data delete`, destructive deploy, `sf org login`,
  `npm install -g`) as prose-only Bash. Three consent gates back them —
  `sf-package-promote` (its own, for the permanent release), `sf-deep-audit-ops`, and
  `sf-cli-setup` — recorded via `harness/record-consent.mjs` under
  `.security-review/consent/`. The shipped PreToolUse hook `hooks/sf-ops-gate-hook.mjs`
  (matcher `Bash`) classifies the command on its ACTION VERB and **DENIES** a gated op,
  inside a managed audit repo, unless an affirmative consent is recorded — so a skipped
  ask cannot run the op. Scoped to a `.security-review/` tree (never blocks arbitrary
  Bash) and verb-based (read-only verbs always pass). Honest residual: a deliberately
  obfuscated op can still evade the classifier — the same limit the consent belt
  documents (see `docs/sf-ops-safety-gate.md`).
- **The ONE network-touching engine is `install-scanners.mjs`, and it is split to
  keep the no-network rule intact (0.6.0).** Every other `harness/*.mjs` is pure,
  no-network, byte-identical. `install-scanners.mjs` installs missing scan tools, so
  its EXECUTOR must reach the network — the documented exception. It is split so the
  honesty model still holds: `planInstalls()` is the PURE, byte-identical, test-backed
  half (the plan — per-tool dir, literal commands, pinned URL+sha256, PATH-prepend);
  `installScanners()` is the impure executor and **fails closed without explicit
  `consent` at the engine boundary** (a network install is the 0.5.4 P0 class —
  silence-is-yes never covers it, and the gate is re-asserted in code so a forgetful
  caller still cannot install). Raw binary downloads are **sha256-verified against an
  author-pinned checksum before the file is ever made executable or extracted**; no pin
  ⇒ skipped → PENDING-OWNER-RUN, never run unverified. Bumping a pinned tool means
  re-pinning the version AND every per-platform sha256 from the release's published
  checksums. `cleanup-scanners.mjs` (the asymmetric remover) is manifest-driven and
  likewise reads/removes only what the executor recorded. **(0.8.41)** the consented
  install set also includes the **Code Analyzer stack** (`code-analyzer-stack` method:
  the pinned `@salesforce/cli` + the `code-analyzer` plugin from npm + a JDK 11+ — a
  present `java`≥11 reused, else the sha256-pinned Temurin), so CRUD/FLS is
  deterministic-by-default on a cold box. Its load-bearing rule is the **hermeticity
  contract**: the full contained env (`HOME`/`SF_*`/`TMPDIR`/`npm_config_cache`/
  `JAVA_HOME`, every path under the tmp root) is set BEFORE the npm install (the CLI's
  postinstall hooks fire during it) and passed to every exec, so the same structural
  `rm -rf <tmpRoot>` removes it with zero residue — `test-install-scanners` asserts every
  CA-stack env path + `pathPrepend` entry stays under the tmp root.

- **Findings carry PROVENANCE; a deterministic engine's result is relayed, never
  re-judged (0.8.28, Phase 1 · Slice 1 of `docs/roadmap-deterministic-findings.md`).** A
  5-run cold campaign proved the LLM-generated blocker band is unstable run-to-run while
  Code Analyzer (PMD/SFGE) finds the same CRUD/FLS bugs deterministically every run — its
  output just never reached the ledger. `harness/ingest-scanner-findings.mjs` is that path:
  a scanner/metadata finding becomes a `provenance:'deterministic'` ledger finding carrying
  the `engine` + `ruleId` that fired, with `adjusted_severity` taken from the requirement
  CLASS (read live from `baseline/requirements-baseline.yaml` via the new canonical
  `REQ_SEVERITY_TO_FINDING` map — `blocker→critical / major→high / minor→low /
  informational→info`), never the scanner's own 1–5 number and never an LLM. It is a
  PLUGGABLE adapter registry (`ingest(raw, adapter)` core + `{name, kind, collect, parse,
  classify}` adapters) with two KINDS — `file-parser` (Code Analyzer; future Semgrep/OSV/
  gitleaks/Checkov are new adapter objects, not surgery) and `source-scanner` (the
  `metadata-viewall` ViewAll/ModifyAll over-grant check, the one class Code Analyzer
  doesn't cover). The core is pure/byte-deterministic (`collect()` is the only I/O seam),
  an unmapped rule is still ingested (never dropped) with a documented Code-Analyzer-severity
  fallback, and re-ingest is idempotent (a deterministic id is stable from
  `engine+ruleId+file:line`). **Slice 2 (0.8.29) adds the correctness core:** (1) a
  Security/AppExchange **tag filter** — only a Code Analyzer rule tagged `Security` or
  `AppExchange` becomes a finding (raw CA output is dominated by ApexDoc/naming/codestyle/
  Performance noise); a FILTER on non-security noise, never a drop of a security finding
  (an unmapped *security* rule still ingests via the CA-severity fallback). (2) A mapped
  finding now carries its owned-`class` label, and `harness/reconcile-provenance.mjs`
  ENFORCES supersession — a `deterministic` finding in the SAME owned class at the SAME
  locus (reusing `finding-clusters.mjs` `sameLocation`) demotes a co-located `llm-inferred`
  finding to `status:'superseded'` (`superseded_by` → the deterministic id), pure +
  idempotent, so the LLM can never re-report or re-judge what an engine determined. (3) The
  engine-absent→**KEEP** methodology fix (`apex-exposed-surface.md` §5/§6): defer a CRUD/FLS
  gap to SFGE ONLY when a `code-analyzer-*.json` evidence file proves it ran — engine-absent
  → keep the finding `llm-inferred` and mark the class PENDING-OWNER-RUN, never refute by a
  phantom hand-off (the fixrun4 dropped-blocker). **Slice 3 (0.8.30) WIRES both engines into
  the flow — PHASE 1 COMPLETE:** audit-codebase runs the deterministic pass FIRST (Step 4,
  before the ledger digest is compiled and before the LLM fan-out — `metadata-viewall` always + `code-analyzer` when a
  `code-analyzer-*.json` evidence file exists; `sf` absent → PENDING-OWNER-RUN, never LLM-fill,
  never drop) and `reconcile-provenance.mjs` LAST (end of Step 6, after `merge-ledger.mjs`),
  with Step 7 re-rendering the recap off the reconciled band; the journey + run-scans document
  the same ordering; and `docs/deterministic-findings-acceptance.md` is the live-Solano runbook
  (the campaign replacement — run the engine twice → identical, end-to-end). The three wobbled
  classes are now deterministic end-to-end. Guarded by `test-ingest-scanner-findings.mjs`
  (determinism + severity-from-class + the tag filter + schema conformance over REAL captured
  Code Analyzer fixtures), `test-reconcile-provenance.mjs` (supersession is precise,
  conservative, idempotent), `test-deterministic-integration.mjs` (the real CLI sequence
  end-to-end + the journey/audit-codebase grant+invoke+order wiring), and a
  `test-calibration-fp-patterns.mjs` presence guard on the engine-absent → KEEP clause. **Phase 2
  (0.8.31) ships the first §10 per-scanner adapter — `checkov`** (file-parser, `engine:'checkov'`,
  IaC misconfig): Checkov `failed_checks` (single-object OR multi-framework array shape) become
  `provenance:'deterministic'` `iac-misconfig` findings (baseline `scan-iac-misconfig` = major →
  high), via a CONSTANT `classify()` and NO tag filter (security-by-construction, like
  `metadata-viewall`). Severity is the CLASS, never the tool — Checkov OSS emits `severity:null`,
  so a literal tool→band map has no input (a curated per-check / enterprise-severity refinement is
  a Phase-2b follow-up). One new adapter object in the existing registry, never a rewrite; guarded
  by the `CK*` checks in `test-ingest-scanner-findings.mjs`. **Phase 2 (0.8.32) ships the second §10
  adapter — `semgrep`** (file-parser, `engine:'semgrep'`, multi-language SAST), the FIRST genuine
  **`tool→band`** adapter: unlike code-analyzer/checkov, Semgrep carries a real per-result severity
  (`ERROR`/`WARNING`/`INFO`), so the tool's own band DRIVES the finding severity
  (`SEMGREP_SEVERITY_TO_FINDING` — `ERROR→high` [deliberately NOT critical/blocker: reachability is
  the LLM/human residual], `WARNING→medium`, `INFO→low`, unknown→`info`). This required a small
  ADDITIVE generalization of `buildFinding` — a third severity path on the UNMAPPED side gated on an
  optional `bandFromTool`/`dimensionHint`/`toolSevLabel`; the MAPPED class-severity branch is
  UNCHANGED (a mapped `classKey` always wins). A Semgrep finding owns NO toolkit class
  (`classify()`→`null`) so it supersedes nothing — cross-engine dedup against a co-located LLM
  finding is §10 extension #3 (Phase-2b). `dimension:'external-sast'`; NO tag filter
  (security-by-construction, the security rulesets). Guarded by the `SG*` checks (two real
  fixtures — a WARNING anchor + an ERROR anchor). **Phase 2 (0.8.33) ships the third §10 adapter —
  `bandit`** (file-parser, `engine:'bandit'`, Python SAST), the SECOND `tool→band` adapter and the
  PROOF the Semgrep generalization GENERALIZES: Bandit carries a real per-result `issue_severity`
  (`HIGH`/`MEDIUM`/`LOW`, via `BANDIT_SEVERITY_TO_FINDING` — `HIGH→high` [same call as Semgrep
  `ERROR→high`, not critical/blocker], `MEDIUM→medium`, `LOW→low`, unknown/missing→`info`), owns no
  class (`classify()`→`null`), and groups under `external-sast` — exactly Semgrep's shape — so it
  REUSES `buildFinding`'s `bandFromTool` path with **ZERO harness-core change** (one new adapter +
  one severity map; no `buildFinding`/`CLASS_DEFS` edit). `issue_confidence` is recorded but NOT
  band-weighting here (a Phase-2b note). Guarded by the `BN*` checks (one real all-`MEDIUM` fixture +
  inline `HIGH`/`LOW`/unknown synthetics). **Phase 2 (0.8.34) ships the fourth §10 adapter —
  `njsscan`** (file-parser, `engine:'njsscan'`, Node SAST), the THIRD `tool→band` adapter and the
  FIRST with a DIFFERENT input shape: njsscan's JSON is a NESTED OBJECT (`{nodejs:{…},templates:{…}}`,
  each section keyed by rule_id), NOT a flat `results[]` — so it has its own `parse` that reads BOTH
  sections (a rule can list multiple files → one finding per file occurrence) and derives the CWE
  reference URL from a `CWE-###` prefix. Everything downstream is the established `tool→band` pattern:
  severity from `metadata.severity` (`NJSSCAN_SEVERITY_TO_FINDING` — `ERROR→high` [same call as
  Semgrep/Bandit], `WARNING→medium`, `INFO→low`, unknown/missing→`info`), `classify()`→`null` (owns no
  class), `dimension:'external-sast'`, NO tag filter (security-by-construction) — so it REUSES
  `buildFinding`'s `bandFromTool` path with **ZERO harness-core change** (one new adapter + one
  severity map; no `buildFinding`/`CLASS_DEFS` edit). njsscan's `node_secret` (CWE-798) OVERLAPS the
  secrets class the future gitleaks/detect-secrets adapters will own; de-duplicating it is cross-engine
  dedup = §10 ext #3 (Phase-2b), not this slice (the SAFE under-merge). Guarded by the `NJ*` checks
  (one real fixture — an ERROR anchor + a WARNING anchor — plus templates-section / multi-file /
  no-CWE / band synthetics). **Phase 2 (0.8.35) ships the fifth §10 adapter — `gitleaks`**
  (file-parser, `engine:'gitleaks'`, hardcoded secrets), a DESIGN PIVOT BACK to **`class`-severity**
  (like checkov, NOT `tool→band`): a secret has no tool-severity tier, so severity comes from the
  `fail-hardcoded-secrets` CLASS (major → high) via a CONSTANT `classify()`→`'hardcoded-secrets'` and
  NO tag filter (security-by-construction), with **ZERO `buildFinding`/`CLASS_DEFS`-machinery change**
  beyond one new `CLASS_DEFS` entry + one adapter + one `recommendationFor` arm. TWO things make
  gitleaks distinct: (1) it owns a class AND a REAL methodology dimension (`secrets-credentials`), so —
  unlike the deterministic-only `external-sast` label — it **SUPERSEDES a co-located LLM
  `secrets-credentials` finding** (the first adapter to enforce, for its class, that the LLM does not
  re-report what the scanner determined; the bounded over-supersede risk is the same already-accepted
  dimension-fallback risk as `crud-fls`/`sharing`, hardening tracked under §10 ext #3); (2) gitleaks
  output CONTAINS the live secret (`Match`/`Secret`) + commit PII (`Author`/`Email`/`Message`), so the
  adapter is built to emit a finding from ONLY the non-sensitive fields
  (`RuleID`/`File`/`StartLine`/`Description`) and NEVER pass any secret/PII downstream — the
  **secret-never-leaks invariant** (`buildFinding`'s `redact()` is only a backstop, not the primary
  control). Cross-engine dedup of the same secret found by gitleaks AND njsscan's `node_secret` is still
  §10 ext #3 (Phase-2b — the SAFE under-merge). Guarded by the `GL*` checks (one real 3×
  `generic-api-key` fixture, the load-bearing secret-never-leaks test, and the LLM-supersession test).
  **Phase 2 (0.8.36) ships the sixth §10 adapter — `detect-secrets`** (file-parser,
  `engine:'detect-secrets'`, hardcoded secrets), the secrets SIBLING of gitleaks: the same vuln class, so
  it **REUSES the `hardcoded-secrets` class** gitleaks added — **NO new `CLASS_DEFS` entry, NO
  `buildFinding`/`recommendationFor` change** (a `class`-severity adapter, severity from
  `fail-hardcoded-secrets` → high via a CONSTANT `classify()`→`'hardcoded-secrets'`, NO tag filter,
  security-by-construction). The ONLY shared-file touch is the `ADAPTERS` registry line. Like gitleaks it
  owns a class AND the real `secrets-credentials` dimension, so it SUPERSEDES a co-located LLM secrets
  finding. TWO things are new vs gitleaks: (1) detect-secrets' OWN **nested-by-file** JSON
  (`{results:{<file>:[occurrence,…]}}`, `results` keyed by FILE, NOT gitleaks' flat array), so its own
  `parse`; (2) with TWO secrets engines now live, the same secret at one locus produces TWO deterministic
  ledger rows — `reconcile-provenance` does NOT collapse them (it only supersedes an `llm-inferred` finding;
  a deterministic finding never supersedes another deterministic finding), so the cross-engine duplicate is
  VISIBLE (the SAFE under-merge) — collapsing it is cross-engine dedup = §10 ext #3 (Phase-2b), now
  concrete. The **hash/secret-never-leaks invariant** applies again: an occurrence carries a `hashed_secret`
  (a SHA) and, under `--show-secrets`, could carry plaintext; the adapter emits from ONLY
  `type`/file/`line_number` and NEVER the hash or plaintext (`redact()` is only a backstop). Guarded by the
  `DS*` checks (one real 24-occurrence / 6-file / 3-type fixture, the load-bearing hash+plaintext leak test,
  the LLM-supersession test, and the two-deterministic-coexist test). **Phase 2 (0.8.37) ships the seventh §10
  adapter — `osv`** (file-parser, `engine:'osv'`, dependency-CVE / SCA), and with it **Extension A: the
  CVSS→enum advisory-severity fork** (§10 extension #1). Unlike the SAST family (tool tier ERROR/WARNING/INFO →
  band) and the class-severity adapters (checkov/gitleaks/detect-secrets → class), a dep CVE carries a REAL
  CVSS, while the only CLASS severity (`scan-external-sca` = major) is a *missing-scan* GATE severity — so the
  per-FINDING band is PER-ADVISORY (`severityKind:'advisory'`): numeric group `max_severity` →
  `CVSS_SCORE_TO_FINDING` (the CVSS 3.x scale — ≥9.0 critical · ≥7.0 high · ≥4.0 medium · >0 low · 0 info), else
  the vuln's `database_specific.severity` LABEL → `OSV_LABEL_TO_FINDING`, else `medium` (an unscored CVE is real
  — the conservative middle, NOT info, NOT the gate's high). It REUSES `buildFinding`'s `bandFromTool` path
  (`classify()`→`null`, owns no class, supersedes nothing; `dimension:'dependency-cve'`, deterministic-only; NO
  tag filter) — the band SOURCE (CVSS, not a tool tier) is the only difference — so the **ONLY shared-code change
  is the additive `gateLabel` parameter** on `buildFinding`'s tool→band branch (`scan-external-sca` for SCA;
  the default `scan-external-sast` preserves the SAST adapters' reasoning byte-for-byte). dep-CVEs have no
  file:line (locus = the lockfile/package). Guarded by the `OSV*` checks (one real 11-vuln fixture + inline
  CVSS→enum threshold synthetics + the severity-priority cases + the load-bearing gate-label-default-preserved
  regression). **Phase 2 (0.8.38) ships the eighth §10 adapter — `npm-audit`** (file-parser,
  `engine:'npm-audit'`, Node dependency-CVE), the **EASY Extension-A REUSE**: `npm audit --json`
  (`auditReportVersion:2`) gives a DIRECT severity LABEL per vulnerable package
  (`critical/high/moderate/low/info`), so the band comes straight from `NPM_SEVERITY_TO_FINDING` (npm's own
  lowercase `moderate`→medium spelling, its OWN named map — NOT OSV's UPPERCASE one), a label-only band with no
  CVSS parsing. It REUSES OSV's path EXACTLY — the `bandFromTool` branch, the `gateLabel` parameter (already
  added at 0.8.37), the `dependency-cve` dimension, `classify()`→`null` (owns no class, supersedes nothing), NO
  tag filter — so there is **NO `buildFinding`/`CLASS_DEFS` change**; the ONLY shared-file touch is the
  `ADAPTERS` registry line. Gated by `scan-dependency-vulnerabilities` (`applies_to: [all]`, major — DISTINCT
  from OSV's `scan-external-sca`; both major). One finding per vulnerable package (npm keys by package, severity
  is the package MAX); `via` supplies the advisory title/url (a STRING via-entry is a transitive chain, an
  OBJECT via-entry is the direct advisory; the band uses the PACKAGE severity, not the first advisory's).
  Unknown/blank → medium (judgment call, as OSV). Guarded by the `NPM*` checks (one real 4-package fixture +
  inline label→band synthetics + the via-shape matrix + the package-severity-wins + no-vector-leak +
  gate-label checks). **Phase 2 (0.8.39) ships the ninth §10 adapter — `trivy`** (file-parser,
  `engine:'trivy'`, IaC misconfig), done **CONFIG mode only** (the only mode with a captured fixture). A Trivy
  `Class:'config'` finding is the SAME vuln class as Checkov, so it **REUSES the `iac-misconfig` class** (NO new
  `CLASS_DEFS` entry, NO `buildFinding` change — like detect-secrets reused `hardcoded-secrets`): a CLASS-severity
  adapter at class `high` (`scan-iac-misconfig`=major), NOT a tool→band path; the ONLY shared-file touch is the
  `ADAPTERS` registry line. The parse is **CLASS-DISPATCH** (forward-compatible): `Class:'config'` handled now, the
  vuln (os-pkgs/lang-pkgs) and `secret` classes SKIPPED (Phase-2b — no fixtures yet). Only `Status:'FAIL'`
  misconfigs are findings; `ruleId` prefers `AVDID` else `ID`; `file` is the `Target` (+`:StartLine` when
  `CauseMetadata.StartLine` is present). **Consistency call:** Trivy carries a per-misconfig `Severity`, but for the
  same class to be consistent across engines it lands at class-severity EXACTLY like Checkov (its `Severity`
  recorded in the message *for reference*, never moving the band) — the per-tool-severity refinement for
  `iac-misconfig` (Checkov + Trivy both) stays the same Phase-2b item flagged at Checkov. Guarded by the `TRV*`
  checks (one real DS-0026 fixture + the class-severity-consistency mutation `LOW→CRITICAL` stays `high` + a
  class-dispatch synthetic + a `Status:'PASS'`-skip + a reuses-class assertion). The remaining §10 adapters
  (build order 2b) continue: **trivy SCA/secret modes** still 2b, then ext #3 (cross-engine dedup: OSV↔npm on the
  same CVE + Checkov↔Trivy on the same IaC misconfig — now concrete with two IaC engines) + `gosec` (needs a Go
  fixture) + `retire` + the tls/dast specials.

## 8. Repository layout (canonical — keep cross-references consistent)

```
sf-security-review-toolkit/
├── .claude-plugin/{plugin.json, marketplace.json}
├── .gitignore  LICENSE  README.md  CONVENTIONS.md
├── baseline/
│   ├── requirements-baseline.yaml   # the requirement map as data (§4)
│   └── SOURCES.md                   # source registry + verification status
├── methodology/
│   ├── audit-methodology.md         # engine spec: loop, severity, ledger, adapters
│   ├── reviewer-challenges.md       # Product-Security challenge checklist (reviewer-simulation)
│   ├── known-escapes.md             # seeded-empty recall log: real-review misses accrue here
│   └── dimensions/                  # one file per audit dimension (19)
│       ├── oauth-identity.md        ├── tenant-isolation.md
│       ├── sessionid-egress.md      ├── secrets-credentials.md
│       ├── mcp-surface.md           ├── mcp-threat-model.md
│       ├── injection-xss.md         ├── web-client.md
│       ├── crypto-internals.md      ├── background-jobs.md
│       ├── data-export.md           ├── email-outbound.md
│       ├── admin-surface.md         ├── agentforce-package.md
│       ├── package-metadata.md      ├── apex-exposed-surface.md
│       ├── error-handling-disclosure.md  ├── untrusted-deserialization.md
│       └── resource-consumption-abuse.md
├── templates/                       # 16 reviewer-facing artifact templates + 2 schemas + operator/ render skeletons (0.8.23)
│   ├── submission-checklist.md.tmpl # the required-artifacts table, per-row
│   ├── authn-authz-flow.md.tmpl     ├── data-flow-diagram.md.tmpl
│   ├── data-sensitivity.md.tmpl     ├── access-control.md.tmpl
│   ├── fp-dossier.md.tmpl           ├── questionnaire.md.tmpl
│   ├── readiness-tracker.md.tmpl    # HAVE/PARTIAL/TODO × owner
│   ├── incident-response-plan.md.tmpl        ├── data-retention-deletion.md.tmpl
│   ├── disaster-recovery-backup.md.tmpl      ├── vulnerability-remediation-sla.md.tmpl
│   ├── hosting-architecture.md.tmpl          ├── prior-pentest-attestation.md.tmpl  # WI-19 owner-completed pack
│   ├── audit-ledger.schema.json     # ledger shape (+ per-pass audited_commit fingerprint)
│   ├── evidence-index.schema.json   # WI-20 typed evidence model
│   └── operator/                    # 0.8.23: operator-facing render skeletons (WI-00B) — fixed {{SLOT}} templates, RENDER:… sentinels, filled by render-readiness-verdict.mjs
│       └── readiness-verdict.md.tmpl # WI-03: the pinned readiness-verdict skeleton (SCI block · Ledger Freshness · Finding Stability · Per-category · Blockers · NOT-verified · Open conflicting · Standing caveat)
├── harness/                         # deterministic engines: no LLM, no deps, byte-identical, each test-backed (one network exception: install-scanners.mjs — §7)
│   ├── workflow-template.mjs        # parameterized multi-agent audit workflow
│   ├── artifact-workflow-template.mjs # 0.8.21: P2 ARTIFACT-drafting substrate — mirror of workflow-template.mjs (export meta, INJECTED marker, ARGS guard, Draft-phase parallel() fan-out, return {drafted}); one agent per artifact from its template + repo + shared facts
│   ├── sequential-fallback.md       # same engine without the Workflow tool
│   ├── compute-sci.mjs              # deterministic Submission Completeness Index + currency floor + reviewer-reproducible credit rule (WI-18/A3/A4/P1)
│   ├── record-consent.mjs           # 0.8.4: durable consent COUPLING — record/verify an affirmative answer per gate (.security-review/consent/<gate>.json); the launch path fails closed on a missing token so a skipped ask can't proceed. 0.8.17: controlled `--decision affirm|deny` token (the SELECTED AskUserQuestion option is authoritative — the free-text label is recorded but NOT regex-scanned; deny-precedence; invalid→exit 2)
│   ├── gate-spec.mjs                # 0.8.22: FROZEN gate catalog + pure gateOptions(gateId,facts) selector — PINS each AskUserQuestion gate's option set so the driver renders label/description VERBATIM + pipes the chosen `decision` to record-consent (the engine owns the options, the driver never improvises them). ALWAYS_ON-style FORCE-INJECTED safe-default decline on every consent gate; FOCUS_MIN-style FAIL CLOSED on an unknown gate / malformed option / non-record-consent decision. Registers run-mode/audit-tier/scanner-install; audit-tier confirms a journey-recorded tier instead of re-asking (WI-02). 0.8.27: + the scope-submission gates (mcp-probe/scope-confirm/partner-program family/clarify-detection/listing-type/tenancy) + a `kind` taxonomy (consent|election|answer) — CONSENT gates force-inject + pipe to record-consent, ANSWER gates record the selection into the manifest (WI-05/30/31/32/06)
│   ├── render-stability.mjs         # 0.8.23: VERBATIM Finding-Stability block from recurrence-confidence.json (WI-00B render-harness) — compute-sci-style fixed-block mode; present (n≥2)=bucket table+reliably-recurring blockers+contestable band+mixed-commit note / absent=honest one-liner; informational-only, never a gate input
│   ├── render-readiness-verdict.mjs # 0.8.23: readiness-verdict FILL ENGINE (WI-00B+WI-03) — STANDING_CAVEAT constant + fillVerdict(template,slots) (force-injects the caveat, FAILS CLOSED on any unfilled {{SLOT}}) + lintRenderVerbatim (flags a hand-built table for a registered surface). REGISTERED_SURFACES extended in 0.8.24 with the six Slice-3 surfaces + 0.8.25 with the four Slice-4 scope-submission surfaces. The output-class twin of gate-spec.mjs
│   ├── render-target-map.mjs        # 0.8.24: VERBATIM target-map approval display (WI-04/INV-12) — fixed {dimension|applicable|targets|why|confidence|unresolved} table over target-map.json, applicable rows first, unresolved flagged; missing → honest "not resolved yet"
│   ├── render-preflight.mjs         # 0.8.24: VERBATIM 3-tier preflight report (WI-05/INV-07) — DETECTED/NEED-FROM-YOU/POWER-UPS from the detector JSONs (baseline-counts·package-readiness·tool-detect·stack-detect·docker-check); deployed-org power-up = FIXED 4-state enum (DEEP_AUDIT_STATES + deepAuditState)
│   ├── render-scan-status.mjs       # 0.8.24: VERBATIM scan-status summary (WI-05/INV-13) — FIXED 8-row Family table (frozen SCAN_FAMILIES, canonical 1–8 order, locked columns) over evidence/index.json + manifest; DONE needs an on-disk report, a plan = PARTIAL
│   ├── render-router-status.mjs     # 0.8.24: VERBATIM router "where are we?" block (WI-05/INV-33) — FIXED 3-line resume-point·next-skill·reason over a frozen phase ladder; drift→re-scope, stale ledger→re-audit; null→fresh start
│   ├── render-recap.mjs             # 0.8.24: VERBATIM end-of-run audit recap (WI-04/INV-34) — LED BY the finding-cluster headline (byte-identical to the exec summary + blocker gate), then counts·PROCEED/HALT·not-covered caveat; emitted by merge-ledger.mjs to stdout. 0.8.25: dict-vs-array honesty guard (a PRESENT-but-non-array `findings` → UNAVAILABLE, never PROCEED)
│   ├── render-detected-elements.mjs # 0.8.25: VERBATIM detected-architecture-elements summary (WI-06/INV-15) — fixed {Element|Detected how (evidence)} table in CANONICAL_ELEMENT_ORDER (unknown types appended, never dropped) + listingType line over scope-manifest.json; missing → honest "scope not detected yet"
│   ├── render-mcp-scope.mjs         # 0.8.25: VERBATIM MCP direction/auth-profile (WI-06/INV-43) + live-probe result (INV-44) — direction caption + authExpectations fields rendered NOT re-derived; probed:false → "recorded from code, NOT live-probed" (never presents an un-probed fact as probed); no MCP surface → honest line
│   ├── render-sf-autoresolve.mjs    # 0.8.25: VERBATIM SF-CLI auto-resolution (WI-06/INV-45) — rows table + Security flags (http://·wildcard·no-NamedCredential·ViewAll/ModifyAll over-grant, derived+deduped, never dropped) + Conflicts (CLI is evidence not override); gated on manifest sfAutoResolved; NEVER renders a secret (CONVENTIONS §6 redaction)
│   ├── render-scope-summary.mjs     # 0.8.27: VERBATIM final scope-manifest summary (WI-06/INV-06) — fixed Step-9 readout (listingType·direction·auto-resolution·repoCommit·element list·endpoints WITH env labels·applicable count·operatorConfirmed gate states) over scope-manifest.json; gate states render HONESTLY (✓/✗/not-recorded, never a fabricated ✓); missing/non-JSON manifest → "scope not finalized", never a fabricated "ready"
│   ├── build-audit-engine.mjs       # extract §4/§5 per dimension + inject run-args → audit-engine.mjs + target-map.json (P2); FAILS CLOSED without verifyConsent(audit-tier)&&audit-targetmap (the durable gate — no engine = no fan-out). 0.8.17: ENGINE-ENFORCED always-on dims (sessionid-egress/secrets-credentials/error-handling-disclosure auto-injected regardless of the driver's scope-input; an always-on key in `na` is forced applicable with a WARN)
│   ├── build-artifact-engine.mjs    # 0.8.21: P2 ARTIFACT assembler (mirror of build-audit-engine.mjs) — reads {artifacts:[{key,tmpl,out,focus}],facts,gate} DATA, attaches each pre-read template (THROWS on missing), validates focus, ENGINE-ENFORCES the gate (drops gate.suppress keys → a withheld doc can't be drafted), injects into artifact-workflow-template.mjs → artifact-engine.mjs. Ends the hand-authored-Workflow escaping class
│   ├── merge-ledger.mjs             # mechanical incremental ledger merge: dedup, regression flip, redact, audited_commit (P2). 0.8.18: --result accepts the RAW Workflow task-output envelope ({summary,result,workflowProgress}) OR a pre-extracted {ledger_updates} — unwraps .result automatically; clear exit-2 error naming BOTH shapes when neither is present (no silent empty merge). 0.8.24: emits the fixed render-recap.mjs operator recap to stdout (WI-04/INV-34)
│   ├── build-evidence-index.mjs     # deterministic evidence index producer + the credit rule (reviewer-reproducible vs statically-cleared) (P1/P2)
│   ├── ingest-scanner-findings.mjs  # 0.8.28: scanner/metadata output → provenance:'deterministic' ledger findings (roadmap-deterministic-findings.md Phase 1·Slice 1). PLUGGABLE adapter registry — pure ingest(raw,adapter) core + {name,kind,collect,parse,classify} adapters in two KINDS: file-parser (code-analyzer; future Semgrep/OSV/gitleaks) + source-scanner (metadata-viewall ViewAll/ModifyAll over-grant). adjusted_severity from the requirement CLASS (REQ_SEVERITY_TO_FINDING over the baseline), never the scanner number/LLM; unmapped rule still ingested (CA-severity fallback); idempotent merge (id = engine+ruleId+file:line). 0.8.29 (Slice 2): Security/AppExchange tag filter (hasSecurityTag — only a security-tagged CA rule becomes a finding; non-security noise filtered, an unmapped SECURITY rule still kept) + a mapped finding carries its owned-`class` label. 0.8.31 (Phase 2·2a #1): the `checkov` adapter (file-parser, engine:'checkov', IaC misconfig) — parses Checkov failed_checks (single-object OR multi-framework array) into iac-misconfig findings, CONSTANT classify() (not in RULE_CLASS), NO tag filter (security-by-construction like metadata-viewall), severity from the iac-misconfig CLASS (scan-iac-misconfig=major→high; Checkov OSS severity is null so tool→band has no input — per-check/enterprise severity deferred to Phase 2b); only failed_checks become findings. 0.8.32 (Phase 2·2a #2): the `semgrep` adapter (file-parser, engine:'semgrep', multi-language SAST) — the FIRST tool→band adapter: severity from the tool's own ERROR/WARNING/INFO via SEMGREP_SEVERITY_TO_FINDING (ERROR→high [not critical/blocker — reachability is the LLM/human residual], WARNING→medium, INFO→low, unknown→info), NOT a class; needed a small ADDITIVE buildFinding generalization (a third severity path on the unmapped side gated on bandFromTool/dimensionHint/toolSevLabel — the MAPPED class-severity branch UNCHANGED, a mapped classKey always wins); classify()→null (owns no class → supersedes nothing — cross-engine dedup is §10 ext #3, Phase-2b); dimension 'external-sast'; NO tag filter (security-by-construction). 0.8.33 (Phase 2·2a #3): the `bandit` adapter (file-parser, engine:'bandit', Python SAST) — the SECOND tool→band adapter, the PROOF the Semgrep tool→band path GENERALIZES with ZERO harness-core change (reuses bandFromTool; one new adapter + BANDIT_SEVERITY_TO_FINDING map, no buildFinding/CLASS_DEFS edit): severity from issue_severity HIGH→high [same call as semgrep ERROR→high]/MEDIUM→medium/LOW→low/unknown→info, classify()→null, dimension 'external-sast', NO tag filter (security-by-construction); issue_confidence recorded but NOT band-weighting (Phase-2b). 0.8.34 (Phase 2·2a #4): the `njsscan` adapter (file-parser, engine:'njsscan', Node SAST) — the THIRD tool→band adapter and the FIRST with a DIFFERENT input shape (a NESTED object {nodejs:{…},templates:{…}} keyed by rule_id, not a flat results[]) so it has its OWN parse reading BOTH sections (one finding per file occurrence) + deriving the CWE URL from a CWE-### prefix; severity from metadata.severity via NJSSCAN_SEVERITY_TO_FINDING (ERROR→high/WARNING→medium/INFO→low/unknown→info), classify()→null, dimension 'external-sast', NO tag filter — reuses bandFromTool with ZERO harness-core change (one new adapter + one severity map); node_secret/CWE-798 overlaps the future secrets class → cross-engine dedup is §10 ext #3 (Phase-2b). 0.8.35 (Phase 2·2a #5): the `gitleaks` adapter (file-parser, engine:'gitleaks', hardcoded secrets) — a DESIGN PIVOT BACK to class-severity (like checkov): a secret carries no tool tier, so severity from the fail-hardcoded-secrets CLASS (major→high) via a CONSTANT classify()→'hardcoded-secrets'; owns a class AND the real secrets-credentials dimension, so it SUPERSEDES a co-located LLM secrets finding; the secret-never-leaks invariant (emit only RuleID/File/StartLine/Description, NEVER Match/Secret/Message/Author/Email); input is a JSON array. 0.8.36 (Phase 2·2a #6): the `detect-secrets` adapter (file-parser, engine:'detect-secrets', hardcoded secrets) — the secrets SIBLING of gitleaks: REUSES the hardcoded-secrets class (NO new CLASS_DEFS/buildFinding change), nested-by-file JSON ({results:{<file>:[…]}}), the hash/secret-never-leaks invariant (emit only type/file/line_number); two secrets engines → the same secret yields two deterministic rows (the SAFE under-merge, cross-engine dedup = ext #3). 0.8.37 (Phase 2·2a #7): the `osv` adapter (file-parser, engine:'osv', dependency-CVE/SCA) — Extension A: the CVSS→enum advisory-severity fork: per-FINDING band from the advisory's CVSS via CVSS_SCORE_TO_FINDING (else database_specific.severity LABEL → OSV_LABEL_TO_FINDING, else medium), the class governs only the gate; the ONLY shared-code change is the additive gateLabel param (scan-external-sca; default scan-external-sast preserves the SAST adapters byte-for-byte); classify()→null, dimension 'dependency-cve', no file:line (locus=lockfile/package). 0.8.38 (Phase 2·2a #8): the `npm-audit` adapter (file-parser, engine:'npm-audit', Node dependency-CVE) — the EASY Extension-A REUSE: a DIRECT severity LABEL per package via NPM_SEVERITY_TO_FINDING (npm's lowercase moderate→medium spelling; unknown/blank→medium), no CVSS math; reuses OSV's path EXACTLY (bandFromTool, the gateLabel param, dimension 'dependency-cve', classify()→null) with NO buildFinding/CLASS_DEFS change — only the ADAPTERS line; gated by scan-dependency-vulnerabilities (applies_to all, major — distinct from OSV's scan-external-sca); one finding per package, via supplies the advisory title/url (string via = transitive chain, object via = direct advisory), band uses the PACKAGE severity. 0.8.39 (Phase 2·2a #9): the `trivy` adapter (file-parser, engine:'trivy', IaC misconfig) — CONFIG mode ONLY this slice (the only mode with a captured fixture). A Trivy Class:'config' finding is the SAME vuln class as Checkov, so it REUSES the iac-misconfig class (NO new CLASS_DEFS/buildFinding change — like detect-secrets reused hardcoded-secrets), a CLASS-severity adapter at class high (scan-iac-misconfig=major), NOT a tool→band path; the ONLY shared-file touch is the ADAPTERS line. The parse is CLASS-DISPATCH (forward-compatible): Class:'config' now, the vuln (os-pkgs/lang-pkgs) and secret classes SKIPPED (Phase-2b — no fixtures). Only Status:'FAIL' misconfigs are findings; ruleId prefers AVDID else ID; file is the Target (+:StartLine when CauseMetadata.StartLine is present); classify()→'iac-misconfig' (constant), NO tag filter (security-by-construction). CONSISTENCY CALL: Trivy carries a per-misconfig Severity, but lands at class-severity EXACTLY like Checkov (its Severity recorded in the message for reference, never moving the band) — the per-tool-severity refinement for iac-misconfig (Checkov+Trivy both) is the same Phase-2b item flagged at Checkov; Checkov↔Trivy on the same IaC misconfig (DS-0026↔CKV_DOCKER_2) = §10 ext #3 (Phase-2b, the SAFE under-merge). 0.8.40 (Phase 2 journey-wiring): the `--all` mode + content-shape recognizer — each file-parser adapter carries a `detect(raw)→boolean` predicate, `recognizeScanner(raw)` returns the SINGLE matching adapter name by CONTENT SHAPE (never filename, which is heterogeneous/ambiguous) / null / {ambiguous} (the shapes are provably disjoint, 40/40 on real evidence; >1 match fails loud, never guesses), and `ingestAll({target})` ALWAYS runs metadata-viewall then recognizes + ingests every `evidence/*.json` into the deterministic band in ONE byte-deterministic pass (Code-Analyzer-absent → CRUD/FLS+sharing PENDING-OWNER-RUN). WIRED into the journey at audit-codebase Step 4b (replaces the two `--scanner` calls) + the run-scans scan tail (`--all` then reconcile). buildFinding/ingest/CLASS_DEFS/the per-`--scanner` dispatch are byte-UNCHANGED (additive-only)
│   ├── reconcile-provenance.mjs     # 0.8.29 (Slice 2): LLM-supersession ENFORCEMENT (roadmap-deterministic-findings.md §3). A `deterministic` finding in the SAME owned class at the SAME locus (reuses finding-clusters.mjs sameLocation) demotes a co-located `llm-inferred` finding → status:'superseded' + superseded_by(det id). PURE + IDEMPOTENT; conservative (only an OWNED class supersedes; precise class match, dimension fallback; mark-not-delete). The LLM can never re-report/re-judge what an engine determined
│   #   (Slice 2 also conditions apex-exposed-surface.md §5/§6 defer-to-SFGE on a code-analyzer-*.json proving the engine ran — engine-absent → KEEP llm-inferred + PENDING-OWNER-RUN, never a phantom hand-off)
│   ├── tool-detect.mjs              # deterministic scan-tool detector (present|installable-on-consent|owner|owner-portal) — 0.6.0 preflight foundation
│   ├── install-scanners.mjs         # 0.6.0 step 1: consented, tmp-scoped scanner install — PURE planInstalls() + impure executor (sha256-pinned binaries, fails closed w/o consent); 0.8.41 adds the code-analyzer-stack method (sf+plugin+JDK, hermeticity contract); the ONE network-touching engine (§7)
│   ├── cleanup-scanners.mjs         # 0.6.0 step 2: asymmetric manifest-driven teardown — remove the tmp tool dir, KEEP the evidence; reuses assertSafeTmpRoot (refuses an unsafe root)
│   ├── artifact-gate.mjs            # enforced gate: auto-proceed + AuthN/AuthZ withhold from the ledger (G4)
│   ├── applicable-requirements.mjs  # exact applies_to ∩ elements applicability (G1). 0.8.25: parseBaselineApplies additively captures verification + the folded conflicts block scalar; `--render` + renderApplicable() emit the VERBATIM operator-facing applicability block (count·by-track·conflicting·mobile-gap), distinct from --json (WI-06/INV-16)
│   ├── baseline-counts.mjs          # deterministic baseline self-description counter (F2). 0.8.20: --currency emits newest_verified + count + oldest_verified (null/malformed dates EXCLUDED from the ISO-lexicographic ranking; no Date) so the journey stops hand-rolling the date sort
│   ├── clamp-log.mjs                # 0.8.20: pure head+tail failure-log truncation (clampLog) — keeps the ROOT CAUSE at the top, not just the tail; used by run-dast + install-scanners
│   ├── finding-clusters.mjs         # cross-dimension finding de-dup for the triage headline (G2); exports normFile/lineSpan/spansOverlap (0.8.7). 0.8.24: renderClusterHeadline + --headline/--format md — the VERBATIM triage block (raw counts first, then clustered), printed identically at the audit exec summary + journey blocker gate (WI-04/INV-08)
│   ├── recurrence-confidence.mjs    # 0.8.7: classify findings by cross-run recurrence over N ledgers (all_runs/some_runs/single_run + confidence high|review|investigate); locus-based, confirmed-anchored, pairwise-Jaccard reported as a metric only
│   ├── union-convergence.mjs        # 0.8.16: does the UNION of confirmed loci across N runs STOP growing? cumulative union_size_series + marginal_new + converged + plateau_run + completeness-disclaiming caveat; reuses recurrence locus identity; REPORT-ONLY, gates nothing (Thread 2)
│   ├── baseline-refutation-check.mjs # 0.8.16: flags `refuted` findings citing platform auto-enforcement (user-mode/with-sharing at API 67.0+) the package sourceApiVersion (<67.0) doesn't buy; --strict exits 3; REPORT-ONLY, gates nothing
│   ├── ledger-staleness.mjs         # resumption fingerprint: flag findings whose code changed (C1)
│   ├── injection-check.mjs          # audit-engine pre-launch check: decoy-anchored INJECTED-object validate (G5)
│   ├── package-readiness.mjs        # preflight power-up precondition: deep-audit install-readiness (installable|needs-build|no-package) from sfdx-project.json. 0.8.24: additive `registered` field splits needs-build into buildable vs unregistered (feeds the render-preflight 4-state enum)
│   ├── stack-detect.mjs             # 0.7.0 foundation: throwaway-DAST-target detector (runnable|needs-recipe|needs-secrets|n/a) + env class (synthesizable|external|benign)
│   ├── standup-stack.mjs            # 0.7.0 slice 3: consented stand-up of an isolated throwaway container (copy-in, synth secrets, manifest); fails closed w/o consent
│   ├── teardown-stack.mjs           # 0.7.0 slice 3: asymmetric manifest-driven teardown — remove the container/image/tmp, KEEP evidence; name-scoped (refuses a non-sf-srt-stack resource)
│   ├── run-dast.mjs                 # 0.7.0 slice 5: autonomous DAST — digest-pinned ZAP vs the throwaway's URL → host-owned evidence; fails closed w/o consent; cleans its own root-owned wrk
│   ├── scaffold-env.mjs             # 0.7.0 slice 6: credential scaffold-and-guide loop — env stub (tmp, never the repo) + deterministic filled-check; standup loads it via docker --env-file
│   ├── docker-check.mjs             # 0.7.1: throwaway-DAST docker prerequisite (available|absent|daemon-down) — gate offers only when runnable; engines fail with an honest install hint (docker is GUIDED, never tmp-installed)
│   ├── namespace-check.mjs          # 0.7.2: deep-audit BUILD precondition (buildable iff an authed org carries the pkg namespacePrefix) — gate offers the build only when confirmed, else shows the prereq
│   └── zap/{README.md, zap-plan-template.yaml}   # authenticated DAST plan generator assets
├── acceptance/                      # the acceptance + standing-test harness
│   ├── generate-fixture.mjs         # builds the synthetic "Helios" RECALL fixture on demand (never committed)
│   ├── generate-solano-fixture.mjs  # builds the "Solano" MIDDLE-BAND judgment fixture on demand (never committed)
│   ├── expected-findings.md         # Helios sealed ground-truth plant list (recall grading key)
│   ├── solano-adjudication-key.md   # Solano sealed adjudications (grading key; off-fixture; re-isolated off-repo for a cold run — see acceptance/README)
│   ├── build-run-args.mjs           # mechanizes the audit-codebase run-args step
│   ├── fixtures/                    # 0.8.28: REAL captured scanner output as deterministic-ingest test data (committed) — code-analyzer-{solano,sfge-meridian}.json + permissionsets/*.permissionset-meta.xml. 0.8.31: checkov-dockerfile-solano.json (genuine Checkov 3.3.2 dockerfile output, host path genericized — the iac-misconfig adapter anchor). 0.8.32: semgrep-{coldstart-full,helios}.json (genuine Semgrep OSS output, relative-path/leak-clean — the tool→band anchors: 2× WARNING→medium + 1× ERROR→high). 0.8.33: bandit-coldstart-full.json (genuine Bandit Python-SAST output, all-MEDIUM — the B608 SQLi anchor + 2× B310 + B104). 0.8.34: njsscan-solano.json (genuine njsscan 0.4.3 Node-SAST output, leak-clean — the nested-object anchors: node_secret ERROR→high + helmet_feature_disabled WARNING→medium). 0.8.35: gitleaks-coldstart-full.json (genuine gitleaks output, secret-never-leaks — 3× generic-api-key, class-severity high). 0.8.36: detect-secrets-solano.json (genuine detect-secrets 1.5.0, nested-by-file — 24 occ / 6 files / 3 types, hash-never-leaks). 0.8.37: osv-coldstart-full.json (genuine OSV-Scanner SCA, lockfile path genericized — 1 source / 3 PyPI pkgs / 11 vulns, Extension A CVSS→enum: 1 critical·3 high·6 medium·1 low). 0.8.38: npm-audit-solano.json (genuine `npm audit --json` v2, leak-clean — 4 vulnerable pkgs body-parser/express/path-to-regexp/qs, Extension-A reuse label-only band: 2 high·2 medium). 0.8.39: trivy-dockerfile-solano.json (genuine Trivy 0.71.2 filesystem scan, leak-clean — 1 Class:'config' Result / 1 FAIL misconfig DS-0026 "No HEALTHCHECK", Severity LOW, no StartLine — the IaC-misconfig anchor, class-severity high; the same Dockerfile finding Checkov reports as CKV_DOCKER_2)
│   ├── README.md
│   └── test-*.mjs                   # 57 dependency-free standing tests (746 checks) guarding the harness/ + hooks/ + CI hygiene
│                                    # (incl. ledger-staleness {unit, hermetic -detect, -adversary}; test-reconcile-provenance = 0.8.29 LLM-supersession enforcement; test-deterministic-integration = 0.8.30 Slice-3 journey wiring + real-CLI sequence)
├── hooks/                           # plugin-shipped PreToolUse hooks — auto-discovered on enable
│   ├── hooks.json                   # PreToolUse: Edit|Write → authz-gate-hook; Bash → sf-ops-gate-hook
│   ├── authz-gate-hook.mjs          # NO-OP unless armed (.security-review/hook-armed) + writing authn-authz-flow.md → consults the gate, denies on a live authz hole (fail-closed)
│   └── sf-ops-gate-hook.mjs         # 0.8.11: fail-closed consent gate for IRREVERSIBLE sf/host ops (sf-package-promote / sf-deep-audit-ops / sf-cli-setup) — DENIES a classified op in a managed repo unless verifyConsent passes; scoped to a .security-review/ tree, verb-based, never blocks arbitrary Bash (docs/sf-ops-safety-gate.md)
└── skills/                          # 14 skills
    ├── security-review-journey/     # orchestrator: state detection + routing
    ├── scope-submission/            # Phase 0: architecture detection + preflight gates
    ├── audit-codebase/              # Phase 1: the autonomous audit engine
    ├── generate-artifacts/          # Phase 2: submission docs from code + audit
    ├── run-scans/                   # Phase 3: Code Analyzer / DAST / SSL Labs / deps (8 families)
    ├── prepare-test-environment/    # Phase 4: Trialforce, agent+Topics, test users
    ├── compile-submission/          # Phase 5: questionnaire + checklist + SCI + path-to-green
    ├── reviewer-simulation/         # audit AS the reviewer will see it (WI-21, 14th skill)
    ├── stay-listed/                 # post-approval recurring obligations + recall-capture
    ├── bootstrap-cli-auth/          # deployed-org deep audit: install + auth the Salesforce CLI
    ├── build-managed-package/       # deep audit: cut a released 2GP when none exists
    ├── install-and-verify-package/  # deep audit: stand up the package in a throwaway org
    ├── audit-deployed-package/      # deep audit: security pass over the installed artifact
    └── teardown-mcp-registration/   # deep audit: zero-residue org cleanup
```

## 9. Writing voice

Dense, specific, failure-encoded — match the sibling MCP toolkit. Tables for
matrices, prose for reasoning. No marketing language, no "simply", no unexplained
acronyms on first use. American spelling.

## 10. Docs lifecycle (prevent roadmap rot)

`docs/` stays current and tracked, never a graveyard of half-built plans. The rules:

- **`docs/INDEX.md` is the canonical index** — one row per doc: state · purpose (and the
  shipped version, if delivered). **Every file in `docs/` MUST have an INDEX row; a doc with
  no row is the rot signal.** Update it in the same changeset that adds or retires a doc.
- **Doc states:**
  - `REFERENCE` — documents current shipped behavior or architecture (e.g. `ARCHITECTURE.md`,
    the sf-ops gate, a shipped-engine spec, a live acceptance runbook).
  - `HONEST-ARTIFACT` — a published result that is part of the toolkit's credibility (e.g.
    the ceiling test). Preserved verbatim; a negative result is never edited away.
  - `ACTIVE` — a roadmap driving in-progress work.
  - `DESIGN` — a roadmap spec **not yet built**. MUST appear in `INDEX.md` so an unbuilt plan
    can never become an untracked half-done doc.
  - `DELIVERED vX.Y` — a roadmap whose work shipped. Kept as design-of-record (harness /
    acceptance file headers cite it by path), carries a `DELIVERED in vX.Y` banner, and is
    never mistaken for active work. Delivered roadmaps are **not** deleted and **not** moved
    without updating every file that cites them.
- **Every `roadmap-*.md` opens with a status header**: state, shipped-version (if any), and a
  build-order checklist — so each slice's completion is visible at a glance.
- **Honesty extends to docs (§2):** if a doc's thesis is later refuted by a published result,
  it MUST link the refutation. A doc may not present, unqualified, a claim the repo has
  falsified.

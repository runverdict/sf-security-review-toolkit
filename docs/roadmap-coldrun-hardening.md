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
- **`main` @ 0.8.44**, suite **57 files / 736 checks**, tag **HELD** (newest `v0.7.0`; `0.9.0` reserved).
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

---

## OPEN BACKLOG — prioritized

Suggested order: **B1 (reorder) → B2 (throwaway tiers + OpenAPI) → B3 (verdict-reflection) → B4 (PENDING
labeling) → B5 (residual-shrinking) → B6 (prose) → B7 (gate-consolidation)**. One item at a time, each
test-backed. Tag stays HELD until a clean cold run on the post-hardening build justifies it.

### B1 — Run static deterministic scanners BEFORE the LLM fan-out  *(the #1 PENDING-drainer)*
- **Why.** Every static scanner now cold-installs (Code Analyzer, Semgrep, OSV, Checkov, secrets,
  local TLS). But the journey order is `scope → audit (LLM) → artifacts → scans`, so on a single pass
  the LLM audits *without* the scanner findings, and the scanners only get folded in via `--all` at the
  run-scans tail + a **re-audit** (double the expensive fan-out). And in the SCI they sit
  PENDING/statically-cleared until they run. The cold-run driver *spontaneously backgrounded the scans
  early* to compensate — strong signal the order is wrong.
- **Fix.** Reorder so the static deterministic scanners run **before** the audit fan-out: seed the band
  first → the LLM **defers** (doesn't re-report what a scanner found) + focuses on the residual → the
  SCI credits them as reviewer-reproducible **SATISFIED** on the first pass → the re-audit double-cost
  disappears. Keep **live/conditional** scans later (live-prod DAST, deployed-org deep audit, TLS that
  needs a reachable host) — they're additional, not the static substrate.
- **Files.** `skills/security-review-journey/SKILL.md` (phase order), `skills/audit-codebase/SKILL.md`
  (Step 4b already runs `--all`; ensure it ingests a populated evidence dir), `skills/run-scans/SKILL.md`.
- **Tests.** Wiring assertions in `test-deterministic-integration` (scans-before-fan-out order; SATISFIED
  credit on a populated evidence dir). The live flow is operator-cold-validated.
- **Note.** Complements the deterministic-findings arc: B1 makes the LLM *defer* on the first pass;
  B5 makes the scanners *find more*.

### B2 — Throwaway-tier pull-forward engines + container-isolated OpenAPI
Three "throwaway" tiers exist: scanner-dir (DONE, 0.6.0), server/mirror (PARTIAL — **node-only**), org
(**not built — still prose**). Two slices:
- **B2-P3 — compose/dockerfile/python `standup-stack` support.** Today `standup-stack.mjs` supports only
  the `node` recipe (`compose`/`dockerfile` return `unsupported` — its own "later slice" TODO). Most real
  backends are compose, so their throwaway-DAST can't stand up. Extend it → unblocks the corroborating
  throwaway-DAST AND the OpenAPI capture below.
- **B2-#11 — OpenAPI spec, Route B (DECIDED, container-isolated).** Flip the OpenAPI/endpoint-spec
  artifact from code-derived/PENDING → real, by capturing `/openapi.json` from the throwaway-DAST
  **container mirror** once it's up (the app runs isolated, with synthetic secrets). **Route A (a
  host-venv `pip install` + `app.openapi()`) was rejected** — it runs partner code on the host, breaking
  the toolkit's static + container-isolation principle. So OpenAPI **rides on B2-P3**. Optional zero-cost
  pre-step: a benign read-only GET of the prod `/openapi.json` (often disabled in prod). Wire-in: after
  the mirror is up → GET `/openapi.json` (+ live `tools/list`) → evidence → `generate-artifacts` consumes
  the real spec, keeping PENDING only on the prod-equivalence attestation line; feed the spec to the
  Schemathesis/ZAP DAST scope. Files: `harness/standup-stack.mjs`, `harness/run-dast.mjs`,
  `skills/generate-artifacts/SKILL.md`.
- **B2-P2 — org-tier `standup-org`/`teardown-org` engine.** The deployed-org deep audit currently
  improvises scratch-org create/install/teardown via inline `sf` commands. Build
  `standup-org.mjs`/`teardown-org.mjs` mirroring `install-scanners`/`standup-stack`: consented
  `sf org create scratch` (features `[Einstein1AIPlatform]`, `--no-ancestors`) + a resource manifest +
  asymmetric `sf org delete scratch --no-prompt` (keep evidence, fail-closed on a malformed manifest).
  The ops are **already** in the `sf-deep-audit-ops` consent gate (no new consent). A born-clean scratch
  org collapses the contamination-teardown UI path and the "can't prove pristineness" caveat. The Dev Hub
  auth stays owner-interactive; the org *lifecycle* pulls forward.

### B3 — Deterministic-band disposition → verdict reflection  *(verdict-honesty)*
- **Why.** `--all` ingests deterministic scanner findings as `status:confirmed`. The driver
  class-dispositions most as FP (e.g. a large class of constant-GUC/RLS-predicate SAST highs the audit
  confirmed FP) into the **FP dossier**, but the **ledger status stays `confirmed`** — so the headline
  verdict over-states (a cold run showed "4 critical / 112 high" when the real blockers were ~1 critical
  + 4 high + a deep-audit medium). Alarming-but-mostly-noise.
- **Fix.** A deterministic class-disposition harness: applying a dossier class-disposition updates the
  matching deterministic ledger entries' **status** (confirmed → refuted/accepted-FP), so the
  blocker-floor + the cluster-headline + the SCI count the **real** blockers. Alternatively/additionally,
  the cluster-headline distinguishes "raw deterministic band" from "LLM-adjudicated blockers." Keep the
  scanner-relayed provenance intact (the disposition is the layer on top).
- **GAP-Y (fold in, cosmetic).** The scan-status render mislabels the External-SAST/SCA families as
  "N/A" when the manifest element is typed `external-web-app` (the render keys those rows on
  `external-endpoint`) even though they ran and are credited SATISFIED. Fix the render element-type keying.
- **GAP-Z (separate, minor).** The Workflow runtime can't write files, so the driver hand-scripts the
  artifact-content extraction + write each pass (plus recurring inline-`node` shell-escaping slips it
  recovers from). A deterministic "extract drafted content + write" harness would cut the improvisation.

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

# Changelog

All notable changes to the sf-security-review-toolkit are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/); versions
follow semantic versioning.

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
  whitespace tolerated; `injection-xss` correctly NOT withheld). Suite 80 → **84
  checks**.
- Deliberately NOT added: `injection-xss` and `secrets-credentials` — inclusion is
  by **defect category, not blast-radius** (documented in the gate + methodology so
  a future change is a conscious one, not a silent re-introduction).

### Validated
- The deterministic core is proven by the standing tests (84 green). The full
  end-to-end behavior (the journey auto-proceeds, never halts at triage, the
  withhold holds from the ledger) is gated by
  `acceptance/integration-pass-condition-0.5.2.md` — a fresh cold full-journey run
  before the 0.5.2 tag.

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
reviewer's own attack priority. ChatGPT rated "audit AS THE REVIEWER WILL" the
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
synthesized from the 2026-06-15 external-review pass (Gemini / ChatGPT / Claude
web), reconciled against the 0.3.1 dimension internals (most reviewer-flagged
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
  not-verified list (CONVENTIONS §2; Claude-web's warning).

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
toolkit was executed cold against a real production codebase (a multi-tenant FastAPI +
Postgres row-level-security backend with an OAuth 2.1 authorization server, a partner-
hosted MCP server, and two thin 2GP managed packages — a Canvas-on-ECA embed and an MCP
registration package). The audit engine performed well — from an empty ledger it
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

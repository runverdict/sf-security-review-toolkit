---
name: compile-submission
description: Phase 5 of security review prep. Inventories every artifact and evidence file against the baseline, fills the required-artifacts checklist (HAVE only with verified evidence), pre-fills the questionnaire with the hard N/A lint, cross-checks answers against artifacts, compiles the readiness tracker, computes the deterministic Submission Completeness Index (the gated go/no-go), emits an honest readiness verdict + a sequenced path-to-green remediation checklist, and assembles the downloadable submission-package with a wizard-slot INDEX, a PENDING-OWNER-RUN handoff, and step-grouped artifacts. Use as the go/no-go check before paying the review fee — the human submits; this skill makes sure nothing bounces at the materials check.
allowed-tools: Read Grep Glob Write Edit Bash(ls *) Bash(find *) Bash(cat *) Bash(curl *) Bash(git log *) Bash(git rev-parse *) Bash(mkdir *) Bash(cp *) Bash(tar *) Bash(node *harness/build-evidence-index.mjs *) Bash(node *harness/compute-sci.mjs *) Bash(node *harness/ledger-staleness.mjs *) Bash(node *harness/render-stability.mjs *) Bash(node *harness/render-readiness-verdict.mjs *) Bash(node *harness/gate-spec.mjs *) Bash(node *harness/assemble-submission-package.mjs *) AskUserQuestion
---

# Compile Submission

Aggregate everything the prior phases produced into the submission package,
verify each piece actually exists and holds together, and tell the operator
plainly whether to submit. The three failure classes this phase kills:
bouncing at the pre-queue materials check (a missing artifact or dead
credential costs queue position without a reviewer ever being assigned —
baseline: `process-prequeue-validation`), thin or undocumented-N/A answers
that cost weeks of back-and-forth (baseline: `fail-incomplete-questionnaire`),
and a questionnaire that contradicts its own attached artifacts — the
contradiction reads as concealment and costs credibility on every other
answer. The verdict this skill emits is *preparation guidance, never a pass
prediction* — Salesforce runs its own penetration test regardless of anything
submitted (baseline: `dast-salesforce-runs-own-pentest`).

## When to use

- The prior phases have state to compile (degrade gracefully: compile what
  exists, list what doesn't as TODO — the gaps ARE the output)
- A go/no-go check before paying the review fee (paid per review; a
  remediated retest pays again — Returned and FP-only resubmits don't)
- Re-compiling after remediation, a re-scan, or a scope change — the compile
  is cheap and idempotent; re-run it whenever upstream state moves
- NOT for generating missing artifacts (route to
  `/sf-security-review-toolkit:generate-artifacts` or the owning phase), NOT
  for running scans (`/sf-security-review-toolkit:run-scans`), and NOT the
  submission itself — the wizard is operator-driven (baseline:
  `process-submission-wizard`)

## Prerequisites

- `.security-review/scope-manifest.json` — hard requirement; this skill
  refuses to compile without it (step 1)
- Whatever exists of: `.security-review/audit-ledger.json`, artifacts in
  `docs/security-review/`, evidence in `.security-review/evidence/`,
  `docs/security-review/test-environment.md`
- Templates: `submission-checklist.md.tmpl`, `questionnaire.md.tmpl`,
  `readiness-tracker.md.tmpl` in `${CLAUDE_PLUGIN_ROOT}/templates/`
- Token cost: trivial — this phase is a single-pass compile with no agent
  fan-out; the expensive phases are behind you

## Steps

1. **Refuse to compile against a stale scope manifest.** Read
   `.security-review/scope-manifest.json`; if absent, route to
   `/sf-security-review-toolkit:scope-submission` and stop — every row set,
   questionnaire section, and tracker family keys off the manifest's
   architecture elements. If present, spot-check it for drift before
   trusting it: does `sfdx-project.json` still exist if the manifest claims a
   package; does the tool count in code still match the manifest's count; are
   there endpoints or callouts in the repo the manifest doesn't list
   (`git log --since` the manifest's generation date on the surface-defining
   paths is a fast tell). A checklist compiled from a drifted manifest
   carries rows for surfaces that no longer exist and silently lacks rows for
   new ones — and the reviewer finds the new surface anyway, as an
   *undisclosed* one. When drifted: re-run scope-submission first, then come
   back. Then check baseline currency (CONVENTIONS §4): for every baseline
   entry this compile touches, warn when `last_verified` is older than 90
   days or null, and collect every `verification: conflicting` entry whose id
   is in the manifest's `applicableBaselineIds` (as of the 2026-06 sweep a
   single entry remains: `endpoint-ssl-labs-a-grade` — whether reviewers
   enforce the letter grade as pass/fail in practice; two further open
   FACETS ride on otherwise-verified entries and surface from their
   `details` text — the questionnaire field list on
   `artifact-agentexchange-questionnaire-na-reasons`, and MCP-listing fee
   applicability on `process-review-fee`) — these feed
   the verdict's confirm-with-your-Partner-Account-Manager list in step 8,
   never a silently picked side. Read the persisted `applicableBaselineIds`
   list verbatim; never re-derive applicability by intersecting `applies_to`
   against the manifest's element types. One staleness class the spot-checks
   above cannot see — correct elements but a truncated persisted id list —
   is caught deterministically at the SCI run below, whose `STALE SCOPE
   MANIFEST` refusal aborts the compile.

2. **Inventory what exists against what applies.** Filter the baseline to the
   entries whose ids are in the manifest's `applicableBaselineIds` — the
   persisted list is THE applicable set, read verbatim: it was computed with
   element-type canonicalization and is exactly the set `compute-sci`
   consumes, whereas re-deriving it by raw `applies_to`-vs-element
   intersection re-drops the element-gated controls a synonym-typed
   manifest requires — then
   walk `docs/security-review/` and `.security-review/evidence/` and classify
   every applicable artifact: **present and verifiable**, **present but
   defective**, or **missing**. "Verifiable" is mechanical, not impressionistic:
   the file exists at the exact referenced path, is non-empty, parses (JSON
   parses; an HTML report renders content, not a zero-byte shell), contains
   no unfilled `{{SLOTS}}`, and carries none of the template guidance
   comments that were supposed to be stripped. Then chase every link: each
   markdown link and evidence pointer inside each artifact gets a
   target-exists check. **Evidence links that 404 are how a true row becomes
   a false one** — the scan really ran, then the report moved during a
   cleanup, and now the checklist asserts evidence that isn't there; to a
   reviewer "the file moved" is indistinguishable from "the file never
   existed". Defective artifacts are named with what's wrong (the unfilled
   slot, the dead link, the parse failure) — they demote to PARTIAL or TODO,
   never squeak through as HAVE.

   **OpenAPI-capture ordering — refresh a code-derived `api-endpoints-spec` when the
   mirror capture postdates it.** On a journey run the api-endpoints artifact is
   drafted in the artifacts phase, BEFORE the live-tail mirror capture lands
   `evidence/openapi-<date>.json` — so a first run's draft is code-derived even
   though the captured spec now exists. During this inventory, when a captured
   `openapi-*.json` (with its mirror-provenance sidecar) is newer than the drafted
   `docs/security-review/api-endpoints-spec.md`, re-draft/refresh the wrapper from
   the captured spec (re-run `generate-artifacts` step 9c against the capture) before
   classifying the row — never ship the stale code-derived draft when the
   mirror-captured evidence is already on disk.

3. **Run the open-findings gate.** From the audit ledger:
   - `confirmed` at critical/high, open: **any value > 0 blocks the
     compile's READY verdict** (audit-methodology §4). The only override is
     an explicit `accepted_risk` ledger entry carrying
     `accepted_risk_justification` — structurally enforced by
     `${CLAUDE_PLUGIN_ROOT}/templates/audit-ledger.schema.json`, which
     rejects the status without the justification field. An accepted risk is
     a real defect the partner has decided to carry: it surfaces by name in
     the readiness tracker and the verdict so the acceptance is a visible
     decision, never a buried one. Do not coach the operator toward this
     override; it exists for compensating-control cases, not for schedule
     pressure.
   - `confirmed` at medium, undispositioned: each needs a fix, an FP-dossier
     entry, or an accepted_risk entry. The undocumented finding is the
     failure, not the finding (baseline: `scan-no-clean-scan-required`).
   - `fixed` awaiting a regression pass: not closed — a later
     `/sf-security-review-toolkit:audit-codebase` pass confirms before the
     related row goes HAVE.
   - **No ledger at all**: the audit never ran. That is not "zero findings" —
     the verdict must say "unaudited", and the honest recommendation is to
     run Phase 1 before submitting a pen-testable surface.
   Whatever the gate says, keep compiling — the operator needs the full
   picture, not a truncated one.

4. **Fill the submission checklist row by row** from
   `${CLAUDE_PLUGIN_ROOT}/templates/submission-checklist.md.tmpl` into
   `<target>/docs/security-review/submission-checklist.md`. The row set comes
   from the manifest (the template's 13-row set for an MCP-server listing;
   add the package-track rows per the template's own guidance when the
   manifest shows a managed package). Status vocabulary is exactly HAVE /
   PARTIAL / TODO, and **a row is HAVE only when its evidence cell points at
   a file step 2 verified** — that is the template's own contract and
   CONVENTIONS §2. PARTIAL names the missing sub-item in the row; TODO still
   carries an owner. Credentials never appear in the document — those cells
   say "supplied separately through the submission channel" and point at the
   runbook. One false HAVE costs the credibility of every true one: a
   reviewer who finds a single HAVE row whose artifact is missing a section
   stops trusting the whole table.

5. **Pre-fill the questionnaire** from
   `${CLAUDE_PLUGIN_ROOT}/templates/questionnaire.md.tmpl` into
   `<target>/docs/security-review/submission/questionnaire.md`, drawing on
   the scope manifest, the audit ledger, the generated artifacts, and the
   evidence directory. Every pre-filled answer carries its provenance line
   (`agent-prefilled from <source>`); certification answers (§F) are never
   pre-filled — those are representations only the owner can make. Then run
   **the N/A lint, which blocks the compile** (baseline:
   `artifact-agentexchange-questionnaire-na-reasons`,
   `fail-incomplete-questionnaire`):
   - grep the filled questionnaire for any `N/A` not followed by
     `— because` — each hit is an incomplete answer;
   - reconcile inline N/As against the §J N/A Register both directions —
     every inline N/A needs a register row with a non-empty reason, every
     register row needs its inline counterpart.
   Either check failing means the questionnaire stays DRAFT and the compile
   does not mark it done — a bare N/A in the wizard costs a review cycle.
   Say plainly to the operator what this worksheet is NOT: **the canonical
   field list is login-gated** — the Checklist Builder generates it per
   solution in the Partner Console and there is no fixed public question set
   (baseline: `process-checklist-builder`). The worksheet pre-drafts the
   known categories so the wizard session is transcription, not composition;
   at submission the operator reconciles field-by-field against the live
   wizard in the worksheet's §K Reconciliation Log, and any wizard field the
   worksheet didn't anticipate gets a fresh owner-written answer — never a
   forced fit.

6. **Cross-check the questionnaire against the artifacts it ships with.**
   The reviewer reads both; an answer the attached artifact contradicts is
   worse than a gap, because it looks like either carelessness or
   concealment. Mechanical checks, not vibes:
   - the Q-D1 egress table matches the data-flow diagram's egress ledger —
     same destinations, same stored-vs-transient calls, no row in one absent
     from the other;
   - tool counts in the MCP disclosures equal the exposed-tools list equal
     the captured live `tools/list` — a three-way reconciliation;
   - the session-ID answer (Q-B2) matches the audit ledger's
     sessionid-egress dimension state — never draft a "No" over an open
     finding in the auto-fail class (baseline: `fail-sessionid-egress`);
   - TLS claims match the SSL Labs JSON actually in evidence — grade, host,
     scan date;
   - the §G scan-status table is re-derived from the evidence directory at
     compile time, never copied forward from a previous compile;
   - the certifications in the questionnaire header match the readiness
     tracker's honesty-posture block word for word.
   On any mismatch, fix the *wrong side*: if the artifact is wrong, the bug
   is upstream — regenerate it via
   `/sf-security-review-toolkit:generate-artifacts` rather than hand-editing
   the answer to match a defective document.

7. **Compile the readiness tracker** from
   `${CLAUDE_PLUGIN_ROOT}/templates/readiness-tracker.md.tmpl` into
   `<target>/docs/security-review/submission/readiness-tracker.md`. Seed the
   row families from the manifest and delete the ones that don't apply,
   recording each deletion in the tracker's §6 so the omission is visibly
   deliberate. Every row gets status × exactly one owner (docs /
   salesforce-session / business / vendor — the template's owner legend);
   §2 open-findings counts come mechanically from the ledger; §5 lists every
   cited baseline id with stale or null `last_verified`. Run the demotion
   lint: a HAVE row with an empty evidence cell is invalid and demotes to
   PARTIAL. Fill the provenance footer on the tracker *and* the checklist
   *and* the questionnaire: generation date, git commit, baseline ids used,
   oldest `last_verified`, and the conflicting-entries line — that footer is
   how a future re-compile knows what this one was built from.

8. **Emit the readiness verdict** to
   `<target>/docs/security-review/submission/readiness-verdict.md` and echo it in
   the run output. **The verdict SKELETON is PINNED — render it by FILLING
   `${CLAUDE_PLUGIN_ROOT}/templates/operator/readiness-verdict.md.tmpl` through the
   engine, NEVER by hand-building it as prose or a Markdown table.** This is the same
   ENGINE-owns-structure / driver-supplies-data contract gate-spec applied to gates
   (CONVENTIONS §7): the template owns the fixed `##` section ORDER, you supply the
   DATA slots, and `render-readiness-verdict.mjs` pastes the deterministic blocks
   VERBATIM, force-injects the standing caveat, and FAILS CLOSED on any unfilled
   `{{SLOT}}`. Never paraphrase a slot, reorder a section, drop a sub-block, or flip a
   table to prose — fill the slots and print the engine's output verbatim. Build the
   slot values, then fill:
   - **FIRST — resolve the partner-program answers the journey deferred (the
     Phase-0 asks land HERE; WO-108).** The SCI's
     `process-partner-program-prerequisites` requirement (`severity_if_missing:
     blocker`) is computed by `compute-sci` from the manifest's
     `operatorConfirmed` block — a full-auto journey run defers those six
     answers out of scope-submission, so THIS is where they are asked. Read
     `operatorConfirmed` from the scope manifest; for EVERY key still
     not-recorded, render the pinned gate and ask via `AskUserQuestion` — the
     question + option set are FROZEN by `gate-spec`; render each option's
     `label`/`description` VERBATIM, exactly as scope-submission does:

     ```bash
     node ${CLAUDE_PLUGIN_ROOT}/harness/gate-spec.mjs --gate partner-program --sub-gate <agreement|pbo|promoted|namespace|listing|contacts>
     # add --no-package to the `promoted` sub-gate when the manifest carries no package element
     ```

     These are ANSWER gates: record each selection into the manifest's
     `operatorConfirmed.<key>` (`affirm`→`true`, `deny`→`false`; the promoted
     gate's `N/A — no package in scope` option — detected by LABEL — records the
     `"n/a"` sentinel, never `false`), NOT through record-consent. Updating
     `operatorConfirmed` touches neither `elements` nor `applicableBaselineIds`,
     so the stale-manifest refusal below is unaffected. `compute-sci` reads the
     answers directly: all six affirmatively confirmed → the requirement is
     SATISFIED; any `false` or missing → it stays an unsatisfied BLOCKER and the
     band reports it honestly. An operator who declines to answer leaves the key
     not-recorded and the SCI reports the requirement MISSING — never fabricate
     a `true`.
   - **`SCI_BLOCK` — build the evidence index, then compute the Submission
     Completeness Index (the headline gate); paste the block BYTE-FOR-BYTE.** You do
     NOT hand-write the index. Write your evidence MAPPING as DATA —
     `<target>/.security-review/evidence-input.json` (which scan produced which
     requirement, which artifacts were drafted, which owner-run items were prepared,
     which auto-fail classes the audit cleared and with what evidence; schema in
     `${CLAUDE_PLUGIN_ROOT}/harness/build-evidence-index.mjs`'s header) — then run the
     shipped producer:
     `node ${CLAUDE_PLUGIN_ROOT}/harness/build-evidence-index.mjs --repo <target> --date <runDate> --input <target>/.security-review/evidence-input.json`.
     It writes `evidence/index.json` and ENFORCES the credit rule DETERMINISTICALLY
     (the engine decides credit from the evidence location, never from anything the
     input asserts): a requirement is SATISFIED only on REVIEWER-REPRODUCIBLE evidence
     — a scanner report the reviewer re-runs (Code Analyzer/SFGE/Checkmarx/gitleaks/
     Semgrep/OSV under `.security-review/evidence/`), an owner-signed artifact, or a
     structural N/A. An auto-fail class cleared ONLY by the white-box static audit is
     `statically-cleared`: surfaced as a separate signal, **never headline credit and
     never a blocker-floor clear** — you do not grade your own exam; Salesforce
     pen-tests these classes regardless. A row with no real, on-disk file is dropped
     or PARTIAL (no credit for un-evidenced self-attestation). Then run the SCI engine
     and capture its stdout block BYTE-FOR-BYTE as the `SCI_BLOCK` slot:
     `node ${CLAUDE_PLUGIN_ROOT}/harness/compute-sci.mjs --target <target> --plugin ${CLAUDE_PLUGIN_ROOT} --date <runDate>`.
     It emits a GATED block — `READINESS: BLOCKED | NOT READY | MATERIALS COMPLETE |
     NO-SURPRISES READY`, a coverage/disposition/freshness vector, a completeness %
     **explicitly labelled materials-not-pass-odds**, and the standing "NOT verified
     by this toolkit" list. Paste it verbatim — never edit the number by hand, never
     collapse it to a single naked figure, never show the % without the gate and the
     not-verified list. It is also the autonomous go/no-go signal
     `security-review-journey` surfaces at the pre-compile gate, and it fills the
     readiness-tracker header (§ readiness-tracker SCI_BLOCK) identically.
     If it instead prints a `STALE SCOPE MANIFEST` block and exits non-zero (exit
     2), the manifest's persisted applicable set no longer matches a recompute
     from its own elements (a pre-canonicalization scope, or a baseline changed
     by a plugin upgrade after scoping) — re-run
     `/sf-security-review-toolkit:scope-submission`, then restart this compile;
     never hand-edit the manifest to silence the refusal.
   - **`LEDGER_FRESHNESS` — guard against a verdict over moved code.** Paste the
     one-liner from
     `node ${CLAUDE_PLUGIN_ROOT}/harness/ledger-staleness.mjs --target <target>` (the
     non-json `[status] verdict` line). If it reports `stale` (findings whose files
     changed since their `audited_commit`) or `no-fingerprint`, ALSO degrade the
     readiness language in the `PER_CATEGORY`/`BLOCKERS` slots and recommend a re-audit
     pass — a clean band computed from findings the code has moved past is not
     trustworthy. Never present a band over a drifted ledger as if it were current.
   - **`FINDING_STABILITY` — INFORMATIONAL ONLY; paste the rendered block.** Paste the
     block from `node ${CLAUDE_PLUGIN_ROOT}/harness/render-stability.mjs --target <target>`
     verbatim. It reads `<target>/.security-review/recurrence-confidence.json` (produced
     by `/sf-security-review-toolkit:audit-codebase` step 9 from ≥2 independent runs of
     the same commit) and renders BOTH branches itself: present (≥2 runs) → the
     `bucket_counts` table + the `reliably_recurring_blockers` set + the named
     contestable band + a mixed-commit note when `commit_consistency != consistent`;
     absent / single-run → one honest line. **It changes NOTHING about the SCI gate** —
     it MUST NOT alter the `compute-sci` invocation or the band; it never inflates
     readiness, never clears a blocker, and is never a go/no-go input. It describes how
     reliably findings recurred — not whether the submission is ready. No fixed
     run-count is "complete"; Salesforce pen-tests regardless.
   - **`PER_CATEGORY`** — ready / not-ready per the tracker's section boundaries
     (documentation artifacts; package code-scan artifacts; external-endpoint
     artifacts; CI scanning evidence; test environment; listing lifecycle/business),
     each with the blocking rows named.
   - **`BLOCKERS`** — one line each: the row, the owner, the concrete closing action
     ("run the authenticated DAST against the staging URL using the plan generated from
     `${CLAUDE_PLUGIN_ROOT}/harness/zap/`", not "complete security testing").
   - **`NOT_VERIFIED`** — the white-box agent audit is static code review (not DAST,
     not a pen test); owner-run scans were verified only as evidence files on disk, not
     re-executed; "wired into CI" was verified as workflow-plus-output, not a clean
     baseline; anything resting on a credential this skill couldn't use is asserted by
     the owner, not checked. If the ledger is absent or the audit ran at a reduced tier,
     say so with the tier and pass count.
   - **`OPEN_CONFLICTING_BASELINE`** — the conflicting baseline entries from step 1,
     each with: confirm via your Partner Account Manager or the partner Slack before
     relying on it — never resolved silently.
   - **The standing caveat is NOT yours to write** — the engine force-injects the
     canonical constant from `render-readiness-verdict.mjs` (Salesforce pen-tests
     regardless; the strongest verdict the toolkit emits is "no known blockers remain in
     what this toolkit can verify", never "will pass"). You cannot paraphrase it; there
     is no slot to fill.

   Then write the slot values to `<target>/.security-review/verdict-slots.json` (one
   JSON object — the `SCI_BLOCK`/`LEDGER_FRESHNESS`/`FINDING_STABILITY` values are the
   captured harness stdout, pasted byte-for-byte; the rest — including the `SOLUTION_NAME`/`RUN_DATE` header slots (the listing's solution name from the scope manifest + this compile's run date) — are the DATA slots above; OMIT
   `STANDING_CAVEAT`, the engine injects it) and render:
   `node ${CLAUDE_PLUGIN_ROOT}/harness/render-readiness-verdict.mjs --template ${CLAUDE_PLUGIN_ROOT}/templates/operator/readiness-verdict.md.tmpl --slots <target>/.security-review/verdict-slots.json --out <target>/docs/security-review/submission/readiness-verdict.md`.
   The engine fills every `{{SLOT}}`, force-injects the standing caveat, and ABORTS (exit
   non-zero) if any slot is left unfilled — so a partial verdict can never ship. Echo the
   rendered file verbatim.

   Then write **`<target>/docs/security-review/path-to-green.md` (WI-22) — the
   single ordered remediation checklist** that takes the partner from the current
   SCI band to `NO-SURPRISES READY`. Assemble it mechanically from the same inputs
   the SCI read, sequenced **blocker → major → minor**:
   1. every open `critical`/`high` ledger finding (file:line + the one-line fix +
      "unblocks: SCI disposition / the reviewer-simulation WILL-FIND it");
   2. every unsatisfied `severity_if_missing: blocker` requirement (what closes it
      + its owner);
   3. every `MISSING`/`PARTIAL` required artifact (incl. the WI-19 owner-signed
      policy stubs and the reviewer-simulation NOT-STATICALLY-EXAMINED list);
   4. every `caveated`/`conflicting` baseline entry (confirm with your PAM).
   Each item carries which gate or SCI point it unblocks, so the partner works the
   list top-down and watches the band climb. It is a view over existing state —
   never invent an item, never soften a severity to shorten the list; an empty
   path-to-green is what `NO-SURPRISES READY` looks like.

9. **Walk the operator to the wizard.** Everything below the first item is
   read from the baseline at walkthrough time — fees, windows, and queue
   semantics are perishable and partly contested; do not quote this skill's
   prose as the fact source.
   - **Where:** Partner Console → Technologies → Solutions → Start Review —
     the Security Review Wizard (baseline: `process-submission-wizard`). The
     wizard's five steps per that entry: contacts → technical details →
     documentation/reports/FP justifications → test-environment credentials →
     review and submit. The compiled checklist, questionnaire worksheet, and
     evidence bundle map onto steps 2–4; the §K reconciliation happens live
     during the session.
   - **Contacts:** a primary contact plus a backup distribution list. Use a
     real distribution list, not a second individual — review windows are
     long enough to outlast vacations (length: `process-review-timeline`),
     and a reviewer question that sits unanswered burns queue position.
   - **Fee and timeline:** read `process-review-fee` and
     `process-review-timeline` from the baseline now and confirm the fee
     amount in the Partner Console (the amount is verified as of the
     entry's `last_verified`, but fees are perishable). The settled fee
     semantics: Returned submissions and false-positive-only responses
     resubmit free; any code change — even mixed FP + true-positive
     responses — is a remediated retest (new version + new paid attempt);
     budget for one. The entry's one open facet is whether the schedule
     applies as-is to MCP-server/API-solution listings — confirm with your
     Partner Account Manager. The
     timeline entry is verified — plan from its total-from-complete-
     submission figure and stage decomposition, not from a number quoted
     in prose.
   - **Day-of-submission revalidation** — the materials check, run by us
     before Salesforce runs theirs (baseline: `process-prequeue-validation`,
     `fail-untestable-environment`): every credential in the manifest
     authenticates *today* (org users, test personas, external components —
     passwords rotated since compile are the classic bounce); MFA is off for
     the review users; every documented agent utterance replays successfully;
     endpoints respond in production mode; the cheap scans are re-run if the
     code moved since their report dates (baseline: `scan-report-freshness`);
     every checklist evidence link still resolves. This hour is the
     single highest-leverage hour in the journey.
   - **Track status:** Partner Console → Technologies → Check Status.
   - **If the review fails:** download the failure report from the wizard's
     Overview page — it lists vulnerabilities with descriptions and fix
     guidance. Ingest it into the audit ledger and run the class-sweep via
     `/sf-security-review-toolkit:audit-codebase` — the expected response is
     reviewing ALL code for each cited vulnerability class, not just the
     cited instances (baseline: `process-failure-remediation-flow`). Two
     paths with different fee consequences: code remediation requires a NEW
     package/API-solution version and a NEW paid review; false-positive-only
     responses attach to the SAME failed review and resubmit free. Use
     technical office hours to pressure-test FP claims with Product Security
     before burning the attempt; resubmission testing is materially faster
     than first-time testing (`process-review-timeline`). Re-run this skill
     before resubmitting; the re-compile is what proves the remediation
     didn't break a different row.

10. **Assemble the downloadable submission package — run the engine, paste
    its summary verbatim.** Everything before this step produced scattered
    artifacts and a verdict; this step gathers them into one self-describing
    directory so the Partner Console session is *transcription, not
    composition*. The assembly is ENGINE-owned (CONVENTIONS §7 — two operators
    hand-building the deliverable produced two different packages); you never
    hand-build the directory, the index, or the runbook. Run the shipped
    assembler and paste its summary output verbatim:

    ```bash
    node ${CLAUDE_PLUGIN_ROOT}/harness/assemble-submission-package.mjs --target <target> --plugin ${CLAUDE_PLUGIN_ROOT} --date <runDate>
    ```

    It builds `<target>/docs/security-review/submission-package/` —
    `INDEX.md`, `PENDING-OWNER-RUN.md`, `readiness-verdict.md` (copied in
    from step 8; an honest TODO placeholder when step 8 hasn't run), and the
    artifacts/evidence COPIED into the step-named subdirectories
    (`step2-technical/`, `step3-docs/`, `step3-scans/`,
    `step4-environments/`) **grouped by the wizard step that consumes them**.
    Copies, never moves — `audit-codebase` and a re-compile still read from
    the canonical paths, and a moved original is how step 2's
    link-verification starts 404ing on the next run. What the engine
    enforces, so prose no longer has to:
    - **The wizard-slot map is a FROZEN CONSTANT** (`WIZARD_STEPS`,
      `STEP3_UPLOAD_SLOTS`, `STEP4_CREDENTIAL_SUBBLOCKS`, and the
      baseline-id-keyed `SLOT_MAP` in the harness, guarded by its standing
      test): the five wizard steps (baseline: `process-submission-wizard`),
      the Step-3 upload slots (*Architecture & Usage Documentation*, *API
      Callouts documentation*, *Security scanner reports*, *False-positives
      documentation*, *Other documentation*), and the Step-4 credential
      sub-blocks (*Username/Password Authentication*, *API/OAuth/SAML
      Access*, *Desktop Clients*, *Mobile Apps*, *Other Test Environment
      Information*). Every `INDEX.md` row carries its exact step, exact slot,
      a `[A]`/`[A/h]`/`[M]` provenance marker, and a status **inherited from
      the evidence-index disposition** — the engine never re-classifies:
      reviewer-reproducible satisfied evidence → HAVE; a draft → PARTIAL,
      never HAVE; pending-owner → TODO (its prepared plan still ships, with
      that status); statically-cleared → surfaced as its own status, never
      HAVE. Never write or imply "will pass" anywhere around the index — the
      strongest row is HAVE-with-verified-evidence, and even a full sheet of
      HAVE rows means "no known blockers in what this toolkit can verify,"
      not a prediction (CONVENTIONS §2).
    - **Conditional suppression (P-1) is engine-computed**: a slot is emitted
      only when its baseline id is in the manifest's `applicableBaselineIds`
      (read verbatim — the same list steps 1–2 read), and the Desktop
      Clients / Mobile Apps sub-blocks auto-suppress when the manifest
      carries no desktop-client or mobile element. Element-type rules match
      through the canonical form — synonyms per
      `harness/render-detected-elements.mjs`'s `ELEMENT_TYPE_SYNONYMS` (e.g.
      `external-web-app` ≡ `external-endpoint`) — never the raw manifest
      string. The index closes with a "suppressed (not applicable)" list so
      the omission is visibly deliberate: Desktop was *decided* out, not
      *forgotten*.
    - **`PENDING-OWNER-RUN.md` is the human tail** — the toolkit stops at
      Step 5 and the human submits, a hard boundary. The engine unions (a)
      every `pending-owner` evidence-index row (the DAST the owner runs from
      the plan under `${CLAUDE_PLUGIN_ROOT}/harness/zap/`, the withheld
      artifacts — each with its prepared location and note) with (b) the
      fixed owner tail — the wizard walk, the Checkmarx portal scan (package
      leg only), the review fee + Submit — whose **perishable text (fee
      amount, portal run budget, wizard mechanics) is parsed from the
      baseline entries (`process-review-fee`,
      `scan-checkmarx-partner-portal`, `process-submission-wizard`) at
      assembly time**, never hardcoded in the engine and never quoted from
      this skill's prose. Free-retry semantics ride the quoted fee entry;
      test-environment credentials are *supplied separately through the
      submission channel*, never written into any package file
      (CONVENTIONS §6). Two owner items the engine cannot derive stay with
      you to append context for in the wizard session: the reviewer-IP
      allowlist window (open it for the review window with an explicit
      revert step after approval; the current reviewer IPs come from the
      live wizard — they change and are environment-specific) and the
      contacts block (step 9).
    - **Fail-closed gates**: the engine re-runs `compute-sci.mjs` first and
      inherits its `STALE SCOPE MANIFEST` refusal (exit 2 → nothing
      assembled; re-run scope-submission, never hand-edit the manifest); an
      unreadable manifest or evidence index aborts; and a CREDENTIAL-REFUSAL
      scan runs over everything that would land in the package **before any
      copy** — credential-shaped content anywhere means nothing is written
      and the operator is pointed at the env-var / vault location instead
      (CONVENTIONS §6). `--date` is required: the package is date-pinned and
      byte-identical on re-run, never wall-clock.

    **Optionally `tar` the package** (`tar -czf submission-package.tgz -C
    <target>/docs/security-review submission-package`) for a single
    downloadable handoff — only after the engine ran clean, since the
    engine's credential refusal is what makes the tree safe to bundle. The
    tarball is a convenience over the directory, not a substitute for the
    `INDEX.md` the operator reads live.

## Automated vs. manual recap

**Automated:** manifest drift spot-check, baseline currency sweep, the
inventory walk with file/parse/link verification, the open-findings gate,
checklist/questionnaire/tracker compilation with provenance footers, the N/A
lint, the questionnaire-vs-artifact cross-check, the verdict, and the
submission-package assembly — copying the verified artifacts into step-named
slots, generating `INDEX.md` (artifact→wizard-slot map with `[A]`/`[A/h]`/`[M]`
provenance and step-2-inherited HAVE/PARTIAL/TODO status), auto-suppressing
the inapplicable Step-4 sub-blocks, generating `PENDING-OWNER-RUN.md`, and the
optional `tar`.

**Manual (owner-run, never agent-asserted):** every questionnaire answer's
final wording and every `owner-confirmed` promotion, all certification
claims, the accepted_risk decision and its justification, credential
creation/rotation and the day-of revalidation actions, the fee, the live
wizard session including the §K reconciliation, and — the human tail every
`PENDING-OWNER-RUN.md` item enumerates — running the authenticated DAST and
Checkmarx scans, entering the test creds, opening and reverting the
reviewer-IP allowlist window, paying, and clicking Submit. This skill never
represents a draft as complete, never moves a `[A/h]` draft to HAVE on the
owner's behalf, never submits anything, and never predicts the review outcome.

## What feeds the next skill

The assembled `submission-package/` (with `INDEX.md`, `PENDING-OWNER-RUN.md`,
and the step-grouped artifacts) IS the deliverable the operator carries into
the Partner Console — the toolkit's flow ends here, at Step 5, and the human
submits. After approval, `/sf-security-review-toolkit:stay-listed` takes the
readiness tracker and the test-environment manifest as its recurring-
obligations baseline — periodic re-review, the per-release gate (listing
association + readiness inheritance), incident-reporting window, and
environment liveness. The verdict's confirm-with-your-Partner-Account-Manager
list is the operator's open-questions queue; answers learned there — and any
wizard field, reviewer question, or failure category the live submission
surfaces that the package didn't anticipate — should flow back into
`baseline/requirements-baseline.yaml` as updated `last_verified` dates (or
resolved conflicts) so the next compile and the next `INDEX.md` are sharper.
If the review fails, the failure report routes back through
`/sf-security-review-toolkit:audit-codebase` and this skill re-compiles and
re-assembles the package for the resubmission.

---
name: compile-submission
description: Phase 5 of security review prep. Inventories every artifact and evidence file against the baseline, fills the required-artifacts checklist (HAVE only with verified evidence), pre-fills the questionnaire with the hard N/A lint, cross-checks answers against artifacts, compiles the readiness tracker, emits an honest readiness verdict, and assembles the downloadable submission-package with a wizard-slot INDEX, a PENDING-OWNER-RUN handoff, and step-grouped artifacts. Use as the go/no-go check before paying the review fee — the human submits; this skill makes sure nothing bounces at the materials check.
allowed-tools: Read Grep Glob Write Edit Bash(ls *) Bash(find *) Bash(cat *) Bash(curl *) Bash(git log *) Bash(git rev-parse *) Bash(mkdir *) Bash(cp *) Bash(tar *) AskUserQuestion
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
   days or null, and collect every entry whose `verification: conflicting`
   intersects the manifest's `applies_to` set (as of the 2026-06 sweep a
   single entry remains: `endpoint-ssl-labs-a-grade` — whether reviewers
   enforce the letter grade as pass/fail in practice; two further open
   FACETS ride on otherwise-verified entries and surface from their
   `details` text — the questionnaire field list on
   `artifact-agentexchange-questionnaire-na-reasons`, and MCP-listing fee
   applicability on `process-review-fee`) — these feed
   the verdict's confirm-with-your-Partner-Account-Manager list in step 8,
   never a silently picked side.

2. **Inventory what exists against what applies.** Filter the baseline to the
   entries whose `applies_to` matches the manifest, then walk
   `docs/security-review/` and `.security-review/evidence/` and classify
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
   `<target>/docs/security-review/submission/readiness-verdict.md` and echo
   it in the run output. Structure, in order — the honesty block is
   mandatory, not decoration (CONVENTIONS §2):
   - **Write the evidence index, then compute the Submission Completeness
     Index (SCI) — the headline gate.** First materialize the WI-20 evidence
     model from the inventory you already built: write
     `<target>/.security-review/evidence/index.json` per
     `${CLAUDE_PLUGIN_ROOT}/templates/evidence-index.schema.json`, one entry per
     artifact/scan/finding that backs a baseline id — a row is SATISFIED only
     with a real, on-disk, verified evidence file (no credit for un-evidenced
     self-attestation; a questionnaire "yes" with no file is PARTIAL). Then run
     the deterministic engine:
     `node ${CLAUDE_PLUGIN_ROOT}/harness/compute-sci.mjs --target <target> --plugin ${CLAUDE_PLUGIN_ROOT} --date <runDate>`.
     It reads the audit ledger + the evidence index + the scope-filtered baseline
     and emits a GATED block — `READINESS: BLOCKED | NOT READY | MATERIALS
     COMPLETE | NO-SURPRISES READY`, a coverage/disposition/freshness vector, a
     completeness % **explicitly labelled materials-not-pass-odds**, and the
     standing "NOT verified by this toolkit" list. Render that block verbatim at
     the TOP of this verdict and the readiness-tracker header. It is a pure
     rollup: never edit the number by hand, never collapse it to a single naked
     figure, never show the % without the gate and the not-verified list. The
     SCI is the autonomous go/no-go signal `security-review-journey` surfaces at
     the pre-compile gate.
   - **Per-category ready / not-ready**, using the tracker's section
     boundaries (documentation artifacts; package code-scan artifacts;
     external-endpoint artifacts; CI scanning evidence; test environment;
     listing lifecycle/business), each with the blocking rows named.
   - **Blockers**, one line each: the row, the owner, the concrete closing
     action ("run the authenticated DAST against the staging URL using the
     plan generated from `${CLAUDE_PLUGIN_ROOT}/harness/zap/`", not "complete
     security testing").
   - **What was NOT verified, and how the rest was**: the white-box agent
     audit is static code review — not DAST, not a pen test; owner-run scans
     were verified only as evidence files on disk, not re-executed; "wired
     into CI" was verified as workflow-plus-output, which is not the same as
     a clean baseline; anything resting on a credential this skill couldn't
     use is asserted by the owner, not checked. If the ledger is absent or
     the audit ran at a reduced tier, say so with the tier and pass count.
   - **Open conflicting baseline entries** from step 1, each with the
     instruction: confirm via your Partner Account Manager or the partner
     Slack before relying on it — never resolved silently.
   - **The standing caveat, verbatim in spirit**: Salesforce performs its own
     penetration testing regardless of submitted evidence. The strongest
     verdict this toolkit ever emits is "no known blockers remain in what
     this toolkit can verify" — never "will pass".

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

10. **Assemble the downloadable submission package.** Everything before this
    step produced scattered artifacts and a verdict; this step gathers them
    into one self-describing directory so the Partner Console session is
    *transcription, not composition*. Build
    `<target>/docs/security-review/submission-package/` and populate it with
    `INDEX.md`, `PENDING-OWNER-RUN.md`, `readiness-verdict.md` (copied in from
    step 8), and the artifacts/evidence **grouped by the wizard step that
    consumes them**, not by where they happened to live in `docs/` and
    `.security-review/evidence/`. Copy artifacts into step-named
    subdirectories (`step2-technical/`, `step3-docs/`, `step3-scans/`,
    `step4-environments/`); never move the originals — `audit-codebase` and a
    re-compile still read from the canonical paths, and a moved original is
    how step 2's link-verification starts 404ing on the next run. The
    assembler runs from the manifest and the same inventory step 2 already
    built — it does not re-classify; a file that step 2 demoted to PARTIAL or
    TODO is copied with that status, never silently upgraded by being placed
    in a slot.

    **`INDEX.md` is the canonical artifact→wizard-slot map**, and it is the
    one file the operator reads top-to-bottom in front of the live wizard. The Security Review Wizard has **five steps** (baseline:
    `process-submission-wizard`): (1) Add Contacts, (2) Add Technical Details,
    (3) Upload Documentation — the artifact-heavy step, with named upload
    slots: *Architecture & Usage Documentation*, *API Callouts documentation*,
    *Security scanner reports*, *False-positives documentation*, *Other
    documentation*; (4) Provide Environments — credential sub-blocks split by
    access path: *Username/Password Authentication*, *API/OAuth/SAML Access*,
    *Desktop Clients*, *Mobile Apps*, *Other Test Environment Information*; (5)
    Review & Submit. Tag **every** file in the index with its exact step, its
    exact upload slot, and a provenance marker:
    - `[A]` — toolkit-generated outright (e.g. the SSL Labs JSON, the Code
      Analyzer HTML).
    - `[A/h]` — toolkit-drafted, owner-run or owner-confirms before it ships
      (e.g. the questionnaire pre-fill whose certification answers only the
      owner can make; the DAST report the owner must actually run; the
      access-control matrix from the permission inventory, which depends on the
      optional owner-consented SF-CLI auto-resolution to populate).
    - `[M]` — manual: the toolkit supplies a runbook only, no artifact it can
      generate (e.g. the contacts block, the ISMS policy suite, the per-attempt
      review fee — baseline: `process-review-fee`, read it at run time).
    A file is **HAVE in the index only when step 2 verified its evidence** —
    the index inherits step 2's status verbatim. A drafted-but-unconfirmed
    `[A/h]` artifact is **PARTIAL, never HAVE**: "the agent wrote a draft" is
    not "the owner ran the scan." Never write or imply "will pass" anywhere in
    the index — the strongest status a row carries is HAVE-with-verified-
    evidence, and even a full sheet of HAVE rows means "no known blockers in
    what this toolkit can verify," not a prediction (CONVENTIONS §2).

    **Conditional suppression — the operator must never face an empty slot
    (P-1).** Emit a slot **only when the artifact's `applies_to` matched the
    scope manifest** (the same filter step 2 used). A managed-package-only
    listing has no MCP-server-details artifact and no API/OAuth slot; an
    external-server-only listing has no Code Analyzer / Checkmarx package leg.
    For Step 4 specifically, **auto-suppress the Desktop Clients and Mobile
    Apps sub-blocks when the manifest carries no desktop-client or mobile
    element** — render them as a one-line "not applicable: no <element> in
    scope" note in the index's audit trail rather than as an empty upload
    block the operator would otherwise stare at and wonder what they forgot.
    Render the surviving conditional sub-blocks from the **detected** elements,
    not a fixed list: a Username/Password block appears because a Trialforce /
    test-org credential runbook exists; an API/OAuth/SAML block appears because
    the manifest shows an external endpoint or MCP server. The index closes
    with a short "suppressed (not applicable)" list so the omission is visibly
    deliberate — a reviewer (and a future re-compile) sees that Desktop was
    *decided* out, not *forgotten*.

    **`PENDING-OWNER-RUN.md` is the human tail** — the precise, ordered
    runbook for everything the toolkit cannot do, each item with the exact
    command or click-path and its blocking prerequisite, because the toolkit
    **stops at Step 5 and the human submits** — a hard boundary of this toolkit.
    Read the perishable specifics (commands, fee, windows) from the baseline
    at assembly time, not from this skill's prose. Each item names its owner
    and its gate:
    - **Run the authenticated DAST** against the live identity + MCP/endpoint
      surface, using the ZAP plan generated under
      `${CLAUDE_PLUGIN_ROOT}/harness/zap/` — capture the report HTML plus a
      scanned-URL screenshot into `step3-scans/`; the `[A/h]` row in the index
      stays PARTIAL until that evidence exists.
    - **Run the Checkmarx portal scan** via the Partner Security Portal —
      **prerequisite: the listing must be linked first** (baseline:
      `scan-checkmarx-partner-portal`); package leg only, not the API/MCP leg; 3
      runs/version are included in the fee.
    - **Enter the test-environment credentials** into the wizard Step-4 slots —
      they are *supplied separately through the submission channel*, never
      written into any package file (CONVENTIONS §6); the package carries only
      the runbook that says which persona goes in which slot.
    - **Open the reviewer-IP allowlist window** — a temporary firewall
      exception scoped to the reviewer source IPs for the review window, with
      an explicit revert step after approval. The package gives the runbook
      and the revert checklist; the operator fills in the current reviewer IPs
      from the live wizard (they are not hardcoded here — they change, and
      they are environment-specific).
    - **Pay the review fee** in the Partner Console and **click Submit** — read
      the per-attempt review fee from baseline `process-review-fee` and confirm
      it live; state the **free-retry semantics** (Returned submissions and
      false-positive-only responses resubmit **free**; only a code change is a
      new paid attempt — **never** treat every resubmission as a fresh paid
      attempt). The cost-of-failure note in the verdict uses these same
      free-retry lanes.

    **Optionally `tar` the package** (`tar -czf submission-package.tgz -C
    <target>/docs/security-review submission-package`) for a single
    downloadable handoff — but only after a final refusal check: if any file
    under the package tree looks like captured credential material, **do not
    tar it and do not write it** — point the operator at the env-var / vault
    location instead (CONVENTIONS §6). The tarball is a convenience over the
    directory, not a substitute for the `INDEX.md` the operator reads live.

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

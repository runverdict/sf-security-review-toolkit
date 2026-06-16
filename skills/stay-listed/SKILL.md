---
name: stay-listed
description: Post-approval obligations on a recurring cadence — re-review trigger watch, the per-release security-relevance gate before listing association, the 24-hour incident-reporting duty, platform mandate sweeps, evidence-freshness re-runs, test-environment liveness, and re-verification of this toolkit's own baseline. Use immediately after approval to set the cadence, then on every recurrence and before every release. Approval is a state to maintain, not a finish line.
allowed-tools: Read Grep Glob Write Edit Bash(ls *) Bash(cat *) Bash(find *) Bash(curl *) Bash(git log *) Bash(git diff *) Bash(git tag *) Bash(sf *) AskUserQuestion
---

# Stay Listed

Turn the post-approval duties into a dated checklist and run it on a
schedule. Listings lapse quietly, and every lapse class has the same shape:
nothing breaks on the day it happens. The test org expires and nobody logs
in to notice; a platform mandate lands with a deadline and a delisting
consequence; three "minor" releases each sail through listing association
while their *sum* changes the architecture; the SSL Labs grade drops on a protocol
deprecation with zero code change — and the partner discovers all of it the
day Salesforce asks, which is the most expensive possible day. This skill
computes the next-due dates, runs what an agent can run, and puts the rest
in front of the operator with the deadline attached. The stake is the
listing itself: the mandate class carries delisting/suspension as its
published consequence (baseline: `post-pkce-refresh-rotation-mandate`).

## When to use

- Immediately after approval: anchor the last-reviewed state and establish
  the cadence (step 2 — the anchor only exists if you set it now)
- On each recurrence — quarterly is the sensible default checkpoint given
  the annual re-review horizon (step 10 wires it)
- Before shipping ANY new version of a listed solution — the release gate
  (step 4)
- The moment a post-approval security finding lands — the ledger/incident
  interaction in step 5 has a 24-hour clock attached
- NOT for first-time review preparation — that is
  `/sf-security-review-toolkit:security-review-journey`
- NOT a substitute for the partner's own incident response or legal
  obligations — this skill schedules and surfaces; the partner remains the
  one accountable to Salesforce

## Prerequisites

- An approved listing. The final submission state is the ideal input
  (`docs/security-review/submission/readiness-tracker.md`,
  `docs/security-review/test-environment.md`,
  `.security-review/scope-manifest.json`, `.security-review/audit-ledger.json`,
  `.security-review/evidence/`) — but degrade gracefully: a partner who was
  approved before adopting this toolkit has none of it, and step 1
  reconstructs what is known and marks the gaps
- The baseline at `${CLAUDE_PLUGIN_ROOT}/baseline/requirements-baseline.yaml`
  — the `post-*` entries drive this skill; read them at run time, never
  from this prose
- Token cost: trivial — single-pass checks and probes, no agent fan-out.
  The only expensive thing this skill ever *recommends* is a maintenance
  `/sf-security-review-toolkit:audit-codebase` pass, and that runs cheap
  against a mature ledger

## Steps

1. **Rebuild the picture; never assume the submission state survived.**
   Read whatever exists of the prerequisite files. Each one that is missing
   gets reconstructed by asking, not guessed: approval date, listing type
   (managed package / MCP server / both), the external endpoint list, the
   shipped version at review time. A partner approved before adopting this
   toolkit starts here with nothing — that is fine; the register in step 2
   is buildable from answers, and the gaps themselves become register rows
   ("no audit ledger — schedule a baseline audit pass"). Then read the
   baseline's `post-*` entries and check currency (CONVENTIONS §4): warn on
   every entry whose `last_verified` is null or older than 90 days, and
   collect any `verification: conflicting` entries touched this cycle
   (e.g. `process-review-fee`, whose dollar amount is the open question
   when budgeting a re-review) for the confirm-through-partner-channels
   list — never silently pick a side.

2. **Anchor the last-reviewed state and establish the obligations
   register.** Two anchors, set at the first run after approval and updated
   only when a review passes:

   - **The last-reviewed commit.** Tag it:
     `git tag security-review/approved-<date> <commit>`. Every release-gate
     diff in step 4 runs against this anchor. Without it, "diff against the
     previous version" is the only available comparison, and that
     understates cumulative drift — the question that matters is *changes
     since the last review*, not changes since the last release. Three
     individually innocuous releases can sum to an architecture change, and
     only the anchored diff shows the sum.
   - **The approval date**, from which the re-review horizon is computed:
     the published band is six months to two years (with notification),
     and Salesforce can run random penetration tests at any time (baseline:
     `post-periodic-rereview` — re-reviews resemble the initial review,
     enforce CURRENT bars retroactively, and carry applicable review fees,
     so the budget conversation belongs on the calendar too).

   Write both into
   `<target>/docs/security-review/post-approval-obligations.md` — the
   register: one row per obligation × cadence × next-due date × owner ×
   evidence pointer. Schedule one off-cycle run ~60 days before the
   re-review horizon; that pre-horizon run is the one that triggers the
   maintenance audit and the expensive evidence refreshes (step 7) while
   there is still time to fix what they find.

3. **Know what re-triggers a full review.** Three trigger classes:

   | Trigger | Comes from | What this skill does about it |
   |---|---|---|
   | Calendar | The periodic default (baseline: `post-periodic-rereview`) | Computes the horizon, schedules the pre-horizon run |
   | Product-Security-initiated | Salesforce, at any time, with no warning | Nothing can predict it — this is *why* environment liveness (step 8) and evidence freshness (step 7) cannot wait for the calendar; a surprise re-review against a dead test org is the worst opening position |
   | Change-driven | The partner's own releases | The release gate (step 4) |

   The official release mechanics are verified (baseline:
   `post-version-attestation`, `process-listing-readiness-inheritance`):
   after a pass, new package versions need NO re-review — the partner
   associates the updated version to the listing, and unreviewed
   managed-released versions inherit readiness from their direct ancestor.
   What no platform check covers is whether the new version's changes are
   security-neutral: security-relevant drift between versions remains the
   partner's risk, and re-reviews enforce current bars retroactively. The
   table below is this toolkit's conservative classification — treat a hit
   as "ask through partner channels before shipping," not "automatically
   re-review":

   | Change class | Examples | Why it forces the question |
   |---|---|---|
   | New external endpoint or origin | A second API host; a new webhook receiver; a new region behind a new hostname | The reviewed DAST (Dynamic Application Security Testing) scope and architecture diagram no longer cover the surface |
   | Auth-flow change | Swapping OAuth grant types; a new token type or session mechanism; adding a Connected App / External Client App; changing how per-user identity reaches the backend | Authentication is the most heavily reviewed dimension; the reviewed AuthN/AuthZ doc now describes a different system |
   | New data-category egress | A data category that previously never left the platform now flows to the external service; a transient value becomes stored | The reviewed data-flow diagram and sensitivity classification are now wrong in the direction reviewers care about most |
   | New surface kind | First Canvas app; first Lightning component in a previously metadata-only package; adding an MCP (Model Context Protocol) server to a package listing; a new admin console | A surface kind the review never tested at all |
   | Isolation-model change | Tenancy model rework; a shared cache or queue introduced across tenants; row-level-security policy restructuring | Cross-tenant isolation failures are in the auto-fail class |

4. **Gate every release on the security-relevance check.** New package
   versions ship by associating the updated version to the listing — no
   re-review, no per-version submission; readiness is inherited from the
   direct ancestor at version-creation time (baseline:
   `post-version-attestation`). Two inheritance gotchas with teeth
   (baseline: `process-listing-readiness-inheritance`): a version created
   BEFORE its ancestor passes review never becomes ready retroactively —
   wait for the pass before cutting new versions — and patch versions
   inherit poorly, so submit major/minor versions only. Mechanics, per
   release:

   - Diff the shipping commit against the step 2 anchor (`git diff
     security-review/approved-<date>..HEAD --stat` first, then targeted
     diffs on the surface-defining paths from the scope manifest).
   - Flag every hit against the step 3 change-class table. New callout
     hosts, modified auth/credential code, new tools in an MCP manifest,
     and permission-set changes are mechanical greps; data-category changes
     need the data-flow artifact open beside the diff.
   - Write the diff summary and the release decision into the obligations
     register, with the evidence pointer. At re-review time, the register's
     release-gate history is what proves the partner managed
     security-relevant drift deliberately.
   - The human associates the version in the Partner Console and confirms
     the listing shows "Ready to List". On any borderline hit, ask through
     partner channels (Partner Account Manager or the partner Slack)
     **before** shipping — security-relevant drift discovered at the next
     re-review as *undisclosed* change is a worse position than a voluntary
     re-submission volunteered early.

   The failure mode this step exists for: releasing without running it.
   Nothing enforces the gate but habit — the Console associates the version
   either way, and drift compounds invisibly until the next review surfaces
   it as undisclosed change.

5. **Keep the incident duty warm.** Security incidents affecting customer
   data must reach Salesforce within 24 hours — and the obligation as
   written includes vulnerabilities *reasonably expected* to result in
   unauthorized disclosure, access, or use of customer data, not just
   confirmed exploitation (baseline: `post-incident-reporting-24h`; the
   authoritative wording and the reporting channel are in the partner
   program policies that entry cites — verify the current address there
   each cycle rather than trusting any hardcoded one). Three things to
   verify every cycle:

   - **The runbook names this duty**, the channel, and an owner, *now* —
     wiring it during an incident is how the 24 hours get missed. The
     report needs a technical account, an impact analysis, and contact
     information; keep a pre-staged skeleton with those three headings in
     the runbook so the clock is spent on investigation, not formatting.
   - **The ledger interaction.** A new `confirmed` finding at critical
     severity in `.security-review/audit-ledger.json` — cross-tenant read,
     key compromise, exposed credential — is potentially *in the
     reportable class while it is still just a finding*. When this skill
     (or any audit pass) lands one post-approval, surface it with the
     24-hour clock note attached. The agent never judges reportability —
     that is incident-scope judgment with contractual weight, and it
     belongs to the human — but the agent failing to *surface* the
     connection is how a fix-it-quietly instinct turns into a missed
     obligation.
   - **Leaked credentials count.** A leaked client secret or refresh token
     for the listing's Connected App / External Client App is unauthorized-
     access-expected territory, not merely a rotation chore.

6. **Sweep platform security mandates.** The standing example of the class:
   PKCE (Proof Key for Code Exchange) and refresh-token rotation required
   on Connected Apps / External Client Apps in multi-org production use,
   with delisting/suspension as the consequence (baseline:
   `post-pkce-refresh-rotation-mandate` — already past its reported
   deadline at baseline-compile time, so treat it as in force and verify
   the fleet's compliance status in the Partner Console, not from the
   entry's dates). Each cycle:

   - Re-read the baseline's `post-*` section in full — mandates are the
     fastest-moving obligation class, and a new entry means a new register
     row with a deadline. The specific mandates named in this skill's prose
     are examples; the baseline is the source.
   - Sweep platform release notes for auth-affecting retirements (baseline:
     `post-oauth-legacy-flow-retirements`) and grep the codebase for the
     deprecated flows they name — finding the usage is automatable; the
     migration is a planned engineering task with the retirement date as
     its deadline.
   - Confirm each mandate's *verification surface*: most are checkable in
     the Partner Console or org Setup, which means the human verifies and
     the register records the date and what was seen.

7. **Re-run what rots.** Evidence ages out even when nothing ships —
   that is the property that makes a calendar necessary:

   | Evidence | Rots because | Re-run cadence | Who runs it |
   |---|---|---|---|
   | SSL Labs grade (`evidence/ssllabs-<host>.json`) | Protocol/cipher deprecations and certificate or infrastructure changes drop the grade with zero code change — the canonical silent rot (baseline: `endpoint-ssl-labs-a-grade` — the codified bar is qualitative TLS hygiene; the A grade is the recommended target and a dropped grade is the early warning) | Quarterly, plus after any certificate or edge-infrastructure change | Agent — the API check is nearly free |
   | Dependency scans (`evidence/deps-<ecosystem>-<date>.json`) | New CVEs (Common Vulnerabilities and Exposures) publish daily against an unchanged lockfile | Monthly, or wire into CI and let every build refresh it | Agent / CI |
   | Code Analyzer report (`evidence/code-analyzer-<date>.html`) | Rots with every code change; rule packs also update under it | Every release, in CI | Agent / CI |
   | DAST report (`evidence/dast/`) | Every deploy to the scanned endpoints invalidates it; the most expensive evidence to refresh | Ahead of the re-review horizon (the step 2 pre-horizon run), plus after any endpoint or auth-surface change | Owner-run — regenerate the plan from `${CLAUDE_PLUGIN_ROOT}/harness/zap/` via `/sf-security-review-toolkit:run-scans` |
   | The audit ledger itself | Code moved since the last audit pass | A maintenance `/sf-security-review-toolkit:audit-codebase` pass at the pre-horizon run — cheap against a mature ledger, and its findings feed step 5's reportability surface |

   Write refreshed evidence into `.security-review/evidence/` under the
   same naming conventions `/sf-security-review-toolkit:run-scans` uses, so
   the re-review compile finds current files in the expected places instead
   of dated ones from the original submission. There is no codified
   validity window for scan reports — the at-submission expectation is
   roughly a month and "scan immediately before submitting" (baseline:
   `scan-report-freshness`); the between-reviews operating rule is
   different: *fresh enough that what the scan finds can be fixed before
   the horizon*.

8. **Probe environment liveness.** Re-reviews and Salesforce-initiated
   checks assume a testable environment, and bounded-lifespan orgs rot
   silently (baseline: `post-test-environment-liveness`,
   `testenv-trialforce-org-lifespan` — the latter records the current
   lifespan figure; still check the actual expiry on the org rather than
   trusting any figure). Each cycle: the review org authenticates, the test personas
   authenticate, the external test tenant responds, and — for MCP listings
   — a spot-check of the documented agent utterances still replays. The
   probe battery and the re-provision checklist live in
   `/sf-security-review-toolkit:prepare-test-environment`'s validation
   step; run them from here rather than re-deriving. Re-provision *ahead*
   of expiry: an org that expires mid-re-review reproduces the
   un-testable-environment bounce (baseline: `fail-untestable-environment`)
   with a reviewer already assigned.

9. **Re-verify the toolkit's own baseline.** When the `post-*` entries this
   skill acted on carry `last_verified` older than 90 days (or null —
   step 1 already flagged them), the cycle's duty list itself is suspect:
   the review process changed three times in eighteen months, and the
   post-approval rules have moved with it. List the stale entries that
   *gate this partner* (the ones whose `applies_to` intersects the scope
   manifest), confirm each through the Partner Account Manager or the
   partner Slack, and write the confirmed dates — or corrected facts —
   back into `baseline/requirements-baseline.yaml`. The currency model
   (CONVENTIONS §4) only works if some cycle closes the loop; this is the
   cycle that does.

   **Close the recall loop too.** Whenever a review stage concludes — the
   initial approval, an annual or Product-Security-initiated re-review, or the
   penetration test — compare what Product Security actually surfaced against
   what the audit ledger had. For every finding the real review raised that the
   toolkit's audit did **not** confirm (or never raised), record an escape in
   `${CLAUDE_PLUGIN_ROOT}/methodology/known-escapes.md`: the finding class, where
   the review caught it, the dimension/scan-family that *should* have caught it,
   why it escaped, and the toolkit change that closes it. This is the one
   validation the acceptance fixtures cannot provide (recall against the classes
   the maintainer never thought of), so it is the highest-signal feedback the
   toolkit gets — and it is the canonical input to the next coverage-gap audit.
   Anonymize the partner; the finding class and the dimension mapping are what
   generalize. Per the standing rule, every escape becomes a toolkit change
   proven by a fresh acceptance run — never a note left for a future session.

10. **Wire the cadence.** The schedule: quarterly recurring runs, the
    pre-horizon run ~60 days before the re-review horizon, and the
    release gate on every release. The mechanism is deliberately
    tool-agnostic — anything that reliably puts "run
    `/sf-security-review-toolkit:stay-listed` in the partner repo" in front
    of a human or an agent on schedule works: a recurring calendar entry
    whose body is the invocation line, a ticket-automation recurrence, a
    scheduled CI job, or a scheduled agent. One concrete example — a cron
    entry on a machine with the repo checked out and an agent CLI
    installed:

    ```cron
    # Quarterly stay-listed cycle, 09:00 on the 1st of Jan/Apr/Jul/Oct
    0 9 1 1,4,7,10 *  cd /path/to/partner-repo && claude -p "/sf-security-review-toolkit:stay-listed quarterly cycle" >> .security-review/stay-listed-cron.log 2>&1
    ```

    Unattended runs of this skill are safe by construction: it reads,
    probes, and writes the report — version associations, payments, and
    incident reports are structurally outside it. Two cautions: never put
    credentials in the scheduler entry (probes read from the environment or
    a secret store, per CONVENTIONS §6), and if unattended agent runs are
    not acceptable in your environment, schedule the *reminder* instead and
    run the skill interactively — the calendar is the load-bearing part,
    not the automation.

11. **Write the cycle report.** Append a dated entry to
    `<target>/.security-review/run-log.md`: what was checked and the
    evidence pointer for each check, every next-due date moved, the deltas
    since the last cycle (new mandates, refreshed evidence, release-gate
    decisions recorded, findings surfaced), and the open items with owner and
    deadline. Update the next-due column in the obligations register to
    match. The register plus the run-log history is what makes the
    re-review compile an update instead of an excavation — and it is the
    artifact that shows Salesforce, if ever asked, that the obligations
    were tracked continuously rather than reconstructed retroactively.

## Automated vs. manual recap

**Automated:** state reconstruction prompts and register/anchor setup,
horizon and due-date computation, the release-gate diff and change-class
flagging, deprecated-flow greps, SSL Labs / dependency / Code Analyzer
evidence refreshes, credential and endpoint liveness probes, ledger
re-checks (including surfacing the incident-clock connection), baseline
staleness detection, the cycle report.

**Manual (owner-run, never agent-asserted):** every version association in
the Partner Console, the judgment on whether a change is security-relevant and
whether a finding is a reportable incident, sending any incident report,
executing the DAST scan, mandate remediation and compliance verification in
the Console, re-provisioning orgs and rotating credentials, fees and
support cases and anything else contractual, and confirming stale baseline
entries through partner channels. This skill schedules and surfaces; the
partner remains the one accountable to Salesforce.

## What feeds the next skill

Each cycle's report and the updated obligations register are the input to
the next cycle — the recurrence is self-feeding. At re-review time, the
journey restarts with `/sf-security-review-toolkit:security-review-journey`,
which finds the state current instead of archaeological, and
`/sf-security-review-toolkit:compile-submission` re-compiles from evidence
this skill kept fresh. Findings surfaced here flow into the audit ledger for
the next `/sf-security-review-toolkit:audit-codebase` pass; baseline answers
confirmed in step 9 flow back into
`baseline/requirements-baseline.yaml` so every user of the toolkit inherits
the verification.

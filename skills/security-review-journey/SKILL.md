---
name: security-review-journey
description: Autonomous driver for AppExchange/AgentExchange security-review SUBMISSION readiness. Runs a seconds-long preflight (greps + architecture detection + sf CLI auto-resolve when authed), emits one 3-tier preflight report, then drives the whole journey end to end — scope, audit, artifacts, scans, package — pausing only for audit-blocking gaps and live-probe/scan-org consent. Auto-activates on "run the security review", "run/continue the audit", "audit my codebase for AppExchange", "am I ready for AppExchange/AgentExchange", "prep my app for the Salesforce review", "where are we on the review". Use to start, resume, or run the full submission-prep journey. NOT a general "is my app secure?" tool — it is scoped to the Salesforce ISV review.
allowed-tools: Read Grep Glob Bash(ls *) Bash(cat *) Bash(find *) Bash(git ls-files*) Bash(git log *) Bash(git status *) Bash(git rev-parse *) Bash(sf org list*) Bash(sf config get*) AskUserQuestion Skill
---

# Security Review Journey

The autonomous driver for the AppExchange/AgentExchange security-review
submission. One trigger phrase runs a seconds-long preflight, surfaces a single
3-tier report, then drives every phase to a finished, downloadable submission
package — pausing only when an input would actually degrade the audit, or when
touching something live (a read-only probe, a scratch org) needs consent. It
never says "will pass": the strongest verdict it can reach is "first-attempt-
ready / no known blockers in what we can verify — Salesforce pen-tests
regardless." It is read-only on the partner's source.

This is a deliberate change from the 0.1 router: that version only detected
state and handed off. This one *drives*. It still answers "just this step" and
"where are we?" as a router when that's all you asked — but the default for a
run-shaped request is to run.

## When to use

- **Run it all**: "run the security review", "prep my app for the Salesforce
  review", "get me ready to submit to AppExchange / AgentExchange". → full
  autonomous run.
- **Readiness question**: "am I ready for AppExchange/AgentExchange?" → preflight
  + run (the honest answer requires the audit, not just a checklist glance).
- **Resume**: "continue the review", "pick up where we left off" → preflight
  detects the furthest-complete phase and resumes from there.
- **Status only**: "where are we on the review?", "what's left?" → router mode:
  report state and the single next action, run nothing.
- **One step**: "just run the audit", "regenerate the artifacts" → router mode:
  hand to that one skill and stop.
- **NOT** a general application security review. This skill is scoped to *the
  Salesforce ISV security-review submission* — its findings, artifacts, and
  verdict are shaped to that review's eight categories and five-step wizard. A
  bare "is my app secure?" with no AppExchange/AgentExchange intent is out of
  scope; say so and offer the scoped run rather than hijacking the request.
- **NOT** a substitute for Salesforce's own penetration test, and **NOT** a
  certifier — it prepares evidence and gets you close, for free, before the fee.

## Prerequisites

- A local checkout of the partner's repository (the `<target>`). Everything
  else the preflight detects, auto-resolves, or asks for.
- `${CLAUDE_PLUGIN_ROOT}/baseline/requirements-baseline.yaml` readable — the
  requirement facts are data, not prose (CONVENTIONS §4).
- Optional, and only ever opt-in: an authenticated `sf` CLI (unlocks the
  deployed-org deep audit and DevHub auto-resolution); a staging URL for any
  live endpoint (unlocks the read-only probe). Their absence never blocks the
  source audit.

## Steps

### Step 0 — PREFLIGHT (the entry experience)

Before spending a single audit agent, run a cheap pass — greps, one
architecture-detection sweep, and `sf` org auto-resolution *if already authed* —
and classify every input the run needs. This exists so a misread is caught in
five seconds, not after a forty-agent audit. **Even a full-auto run does this
first** — there is no point burning a 40-agent audit if a required input is
missing or a key piece of the architecture was misread.

1. **Check baseline currency.** Read the baseline. Rank by the newest **non-null**
   `last_verified` date — entries with `last_verified: null` are *unverified*,
   not "newest"; never let a `null` sort ahead of a real date (a naive
   `sort | tail` does exactly that and misreports a fresh baseline as stale).
   Report two numbers: the newest verified date (and how many entries carry it),
   and separately the count of `null`/unverified entries. If that newest non-null
   date is older than 90 days, say so before anything else — the review process
   changed three times in eighteen months (Chimera retirement, Code Analyzer v5,
   AgentExchange), and stale guidance burns review cycles (CONVENTIONS §4). Point
   at `baseline/SOURCES.md` for what to re-verify. This is a warning, not a stop.

2. **Cheap architecture sense + smart-resume scan, in one pass.** Reuse
   `/sf-security-review-toolkit:scope-submission`'s detection heuristics (do not
   re-implement them — the element table and the MCP-client-vs-server failure
   mode live there). At preflight depth you are only deciding *what tier each
   input lands in*, not writing the manifest. In the target repo, in one sweep:
   - **Detect architecture elements** by evidence: `sfdx-project.json` +
     `force-app/` (managed package, namespace, Apex/LWC/Aura), MCP SDK imports /
     JSON-RPC `initialize`+`tools/list` dispatch in the partner's *own* code
     (MCP **server** — not a Named Credential pointing at someone else's, which
     makes them an MCP client), server frameworks + route definitions (external
     web/API), `signed_request`/Canvas SDK (Canvas), mobile project trees,
     queue/scheduler config (async workers), OAuth/token/`.well-known` routes
     (identity surface).
   - **Detect prior state** for smart-resume (the table below). This is the same
     state model the 0.1 router used — now it feeds *where to resume*, not just
     *what to report*.

   | Evidence | Phase reached | Resume implication |
   |---|---|---|
   | `<target>/.security-review/scope-manifest.json` | Phase 0 done | reuse it unless it drifted (step 3) |
   | `<target>/.security-review/sf-autoresolve.json` | DevHub auto-resolve ran | reuse the resolved endpoint/permission/coverage facts |
   | `<target>/.security-review/audit-ledger.json` | Phase 1 ran | read `confirmed`/`fixed`/`accepted` — open criticals/highs gate artifacts (Step in AUTONOMOUS RUN) |
   | `<target>/docs/security-review/*.md` artifacts | Phase 2 partial/full | list which required artifacts exist; regenerate only the stale/missing |
   | `<target>/.security-review/evidence/` (scan reports, SSL Labs JSON, screenshots) | Phase 3 partial | match each evidence file to its baseline scan requirement; a plan with no report is NOT done |
   | `<target>/docs/security-review/submission/` + `submission-checklist.md` | Phase 5 compiled | the package exists; offer a refresh, don't rebuild blindly |

3. **Trust nothing stale — spot-check the manifest against the repo.** A scope
   manifest written weeks ago may not match the code (new endpoints, a package
   that grew Apex, an MCP tool count that changed). Spot-check its architecture
   elements: does `sfdx-project.json` still exist, did the MCP tool count move,
   are there new route files? **On drift, the resume point becomes Phase 0** —
   re-scope before anything downstream, because every later phase keys off the
   manifest. Drift is normal operation, not failure.

4. **Auto-resolve from `sf` — only if already authed, never prompting here.**
   Run `sf org list`/`sf config get target-org` to sense an existing
   authenticated DevHub or scratch org. If one is present, note that the deep
   DevHub auto-resolution — `IsSecurityReviewed` status, Remote Site /
   CSP-Trusted-Sites endpoint inventory, permission matrix, code coverage,
   namespace — and the deployed-org deep audit are *available* — they surface
   as OPTIONAL POWER-UPS, not as work the preflight does unprompted. The
   deployed-org deep audit is offered and invoked only when its lifecycle
   skills are present and enabled in this toolkit version; it is not a
   guaranteed step of every run. If no auth is sensed, do not run a single
   Tooling query; the offer to "install + auth `sf`" is itself an optional
   power-up. The preflight stays cheap and read-only.

5. **Classify every needed input into exactly one tier, and per applicable
   dimension assign GREEN/YELLOW/RED audit-readiness.** The classification rule
   is the whole reason this can be autonomous: block **only** on
   what would degrade the *audit of the code*; everything submission-context
   flows to the package's owner-run tail and is never a question.

   | Tier | What lands here | Behavior |
   |---|---|---|
   | **✓ DETECTED** | architecture elements with evidence, endpoints found in config, package facts, prior-phase state to resume from, and any `sf`-authed auto-resolved inputs | **silence-is-yes** — proceed with these unless corrected. No "confirm every line." |
   | **⚠ NEED-FROM-YOU** | the **only** hard-stop, and only for audit-BLOCKING gaps: source not findable; an MCP server claimed (in docs/scope) but neither reachable nor present in the partner's own code; an applicable dimension whose targets can't be resolved (e.g. an external-endpoint element with zero discoverable base URLs) | ask the minimum to unblock, or abort. Nothing else stops the run. |
   | **✦ OPTIONAL POWER-UP** | contextual, generated from what the preflight sensed; opt-in; **defaults to skip so "go" runs immediately** | never blocks. See the generated offers below. |

   **Optional power-ups are generated from sensed context, not a fixed menu:**
   - `sf` auth sensed → "spin up a fresh scratch org and audit the **deployed**
     package — what the Salesforce reviewer actually does (install your package
     and test the artifact)?" This runs the §3 deep-audit composition.
   - No `sf` auth → "install + authenticate `sf` so I can audit the deployed
     package and auto-resolve your endpoint/permission/coverage facts from the
     DevHub?"
   - A live endpoint URL present in config/docs → "probe it **read-only** to
     capture the real protocol version / tool inventory / auth mode?" (the
     handshake is read-only; consent + an explicit staging-vs-production label
     are mandatory — never probe an environment you haven't confirmed).

   **Deferrable items are NOT power-ups and NOT questions** — partner-program
   gates (agreement, PBO, listing, namespace, contacts), owner-run DAST /
   Checkmarx credentials, the questionnaire field list, the review fee, and the
   Submit click itself all flow to `PENDING-OWNER-RUN.md` in the final package.
   The preflight never asks about them; it can't know them, and they don't
   degrade the code audit.

6. **Emit ONE preflight report, then act on the tier behaviors.** A single
   scannable message, the only interaction in the common case:

   ```
   PREFLIGHT — AppExchange/AgentExchange security-review readiness
   Repo: <target> @ <short commit>   Baseline last_verified: <date> (<N>d old)
   Resume point: <fresh start | resuming from Phase X | re-scoping on drift>

   ✓ DETECTED (proceeding with these — interrupt only to correct)
     • <element> — <evidence>
     • <endpoint> — <where found>, env: <unknown until labeled>
     • <prior-phase state being resumed / reused>

   ⚠ NEED-FROM-YOU (blocks a good audit — the only hard-stop)
     • <only if a genuinely audit-blocking gap exists; otherwise: "none">

   ✦ OPTIONAL POWER-UPS (opt-in; skipped by default so the run starts now)
     • <deep audit / live probe / install-sf — generated from what was sensed>

   Ask-tolerance: <full-auto | guided>   →  say "go" to run, or correct anything above.
   ```

   - **If ⚠ NEED-FROM-YOU is empty** and the request was run-shaped: proceed to
     the autonomous run immediately under the silence-is-yes contract. Don't wait
     for "go" you don't need — though a misread correction is always honored.
   - **If ⚠ NEED-FROM-YOU is non-empty**: this is the only hard-stop. Ask the
     minimum (use `AskUserQuestion`), or, if the operator can't supply it, narrow
     scope and proceed with that surface honestly flagged as unaudited — never
     fabricate the missing input.
   - **Status-only / one-step requests stop here** in router mode: report the
     state and the single recommended next skill with its reason, and run nothing.

### AUTONOMOUS RUN (no further questions beyond NEED-FROM-YOU + consent)

Drive the phases in order. On any contradiction discovered mid-run (a manifest
claim the code refutes, an endpoint that 404s, a tool count that moved), apply
the chosen ask-tolerance policy: flag it inline and continue, or — in guided
mode on a YELLOW ambiguity — ask. Use the `Skill` tool to invoke each phase;
pass the detected-state summary forward so no phase re-detects from scratch.

1. **Scope** → `/sf-security-review-toolkit:scope-submission`. Skip only if a
   non-drifted manifest already exists (Step 0.3). It writes
   `scope-manifest.json` (+ `sf-autoresolve.json` when the DevHub power-up was
   accepted). Re-run it whenever Step 0 flagged drift.

2. **Audit** → `/sf-security-review-toolkit:audit-codebase`. The find →
   adversarial-verify → synthesize engine, fanned out across the applicable
   dimensions. It refuses to run without a manifest and embeds the existing
   ledger so confirmed/refuted findings are not re-reported. Declare the
   token-cost tier up front (`quick`/`standard`/`exhaustive`).

3. **Triage gate (the blocker policy).** Read `audit-ledger.json`. On any open
   critical/high finding the autonomous run **DEFAULTS to halt-and-report** —
   the same safe default the audit and artifact skills enforce. Surface the
   blockers and offer two ways forward: **continue with honest inline flags**
   (the open findings called out verbatim in the verdict) or **fix-first** (pause
   while the partner remediates, then re-audit). "Continue with honest inline
   flags" is the **explicit blocker-policy the operator selects** (the
   ask-tolerance choice), never the silent default — the orchestrator does not
   ship a package over an open critical/high without the operator electing that
   path. The one rule that holds regardless of which path is chosen: **if an
   open finding is in the AuthN/AuthZ category, SKIP the AuthN/AuthZ artifact**
   in the next phase and state why — generating an authn-authz-flow doc that
   describes a flow with a live, unremediated auth hole would hand the reviewer
   a self-incriminating document and misrepresent the posture. When the operator
   elects continue-with-flags, every other artifact still generates and the
   verdict carries the open findings forward verbatim.

4. **Artifacts** → `/sf-security-review-toolkit:generate-artifacts`. Generates
   only the artifacts whose `applies_to` matched the manifest; honors the
   triage-gate AuthN/AuthZ suppression. Each generated doc is labeled
   automated-vs-owner-run; none is presented as reviewer-final.

5. **Scans** → `/sf-security-review-toolkit:run-scans`. Code Analyzer (the
   agent can run it), SSL Labs and dependency scans where targets resolve; DAST
   and Checkmarx are owner-run (creds + the live target are the human's) — those
   become tasks in `PENDING-OWNER-RUN.md`, not blockers. A scan is only "done"
   with a verified evidence file; a plan with no report is not (CONVENTIONS §2).

6. **Deep audit (offered + invoked only when its lifecycle skills are present
   and enabled, and only if the deployed-org power-up was accepted).** Before
   compile, fold in the CLI-gated deployed-org pass — *what the Salesforce
   reviewer actually does*: stand the package up in a throwaway org and audit the
   installed artifact. This native deployed-org pass is a later-release
   capability; treat it as an offer that runs when those skills are wired, not
   a guaranteed step of every run. When present and accepted, compose the
   authored lifecycle steps, in order, each pausing for scratch-org consent:
   `/sf-security-review-toolkit:bootstrap-cli-auth` (headless auth) →
   `/sf-security-review-toolkit:teardown-mcp-registration` (clean baseline) →
   `/sf-security-review-toolkit:build-managed-package` (skip if a released
   version exists) → `/sf-security-review-toolkit:install-and-verify-package`
   (contamination check, permission-chain / UEC grant-drop verification, smoke
   test) → `/sf-security-review-toolkit:audit-deployed-package` (the security
   pass over the installed artifact) → `/sf-security-review-toolkit:teardown-mcp-registration`
   (zero-residue removal). Source reading cannot verify install-time behavior;
   this previews the reviewer's own install/uninstall test. Skip silently when
   the power-up was declined — the source audit is the always-on core.

7. **Compile** → `/sf-security-review-toolkit:compile-submission`. Assembles the
   complete downloadable `submission-package/` with the wizard-slot `INDEX.md`
   (each artifact mapped to its exact Security Review Wizard step + upload slot),
   `PENDING-OWNER-RUN.md` (the human tail), and `readiness-verdict.md`. The
   verdict is per-category, lists **what was NOT verified**, carries any open
   ledger findings forward, and ends on the fixed caveat: Salesforce performs its
   own penetration test regardless of submitted evidence. Empty conditional slots
   self-suppress — the operator never faces a slot for an element that doesn't
   exist.

### Ask-tolerance (the only knob)

Inferred from the trigger phrasing; the operator rarely sets it explicitly.

- **Full-auto** — default for "just do it" / "run the whole thing": on a YELLOW
  ambiguity, make the best call and **flag it** in the run log and verdict; stop
  on RED (a NEED-FROM-YOU audit-blocker), at the triage gate when the audit
  surfaces an open critical/high finding (halt-and-report, then let the operator
  pick continue-with-flags or fix-first), and at live-probe / scratch-org
  consent. This is the path that gets a complete package with everything
  uncertain honestly marked.
- **Guided** — default for an apparent first run, or when the operator says
  "walk me through it": on a YELLOW ambiguity, ask before deciding; on GREEN,
  proceed. Same RED hard-stops.
- Either way, the two consent points (a read-only live probe; standing up a
  scratch org) are always honored — those touch something live, so the run
  pauses for them regardless of tolerance.

## Automated vs. manual recap

Automated: the preflight (baseline-currency check, architecture detection, prior-
state + drift scan, `sf`-authed sense and — only if opted in — DevHub auto-
resolve), the tier classification + the single preflight report, and the
end-to-end drive across scope → audit → triage → artifacts → scans →
(opt-in deep audit) → compile, with every contradiction flagged inline.

Manual: correcting a misread in the preflight; supplying any ⚠ NEED-FROM-YOU
audit-blocker; choosing the blocker policy at the triage gate when the audit
surfaces an open critical/high (continue-with-flags or fix-first); consenting to
a live read-only probe and to standing up a scratch
org; and every deferred owner-run item in `PENDING-OWNER-RUN.md` — the DAST and
Checkmarx runs, all credentials and the vault they belong in, the partner-program
gates, the questionnaire field entry, the review fee, and the Submit click. The
toolkit auto-answers the evidence; the human owns the Partner-Console residue and
the decision to submit. This skill never modifies the partner's source, and never
says "will pass."

## What feeds the next skill

The preflight's detected-state summary and tier classification flow into every
phase invocation, so no downstream skill re-detects from scratch. In router mode
(status-only / one-step) the output is the state summary plus the single
recommended next skill and its reason — paste it into that skill's invocation.
In a full run, the orchestrator chains the phases itself; the terminal output is
the path to the assembled `submission-package/` and its `readiness-verdict.md`.

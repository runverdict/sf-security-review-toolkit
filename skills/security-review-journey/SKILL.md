---
name: security-review-journey
description: Autonomous driver for AppExchange/AgentExchange security-review SUBMISSION readiness. Runs a seconds-long preflight (greps + architecture detection + sf CLI auto-resolve when authed), emits one 3-tier preflight report, then drives the whole journey end to end — scope, audit, artifacts, scans, package — pausing only for audit-blocking gaps and live-probe/scan-org consent. Auto-activates on "run the security review", "run/continue the audit", "audit my codebase for AppExchange", "am I ready for AppExchange/AgentExchange", "prep my app for the Salesforce review", "where are we on the review". Use to start, resume, or run the full submission-prep journey. NOT a general "is my app secure?" tool — it is scoped to the Salesforce ISV review.
allowed-tools: Read Grep Glob Bash(ls *) Bash(cat *) Bash(find *) Bash(git ls-files*) Bash(git log *) Bash(git status *) Bash(git rev-parse *) Bash(sf org list*) Bash(sf config get*) Bash(node *harness/gate-spec.mjs *) Bash(node *harness/record-consent.mjs *) AskUserQuestion Skill
---

# Security Review Journey

The autonomous driver for the AppExchange/AgentExchange security-review
submission. One trigger phrase runs a seconds-long preflight, surfaces a single
3-tier report, then drives every phase to a finished, downloadable submission
package — pausing only when an input would actually degrade the audit, or when
an action reaches **outside read-only-local**: touching something live (a
read-only probe, a scratch org) OR mutating the host / egressing to the network
(installing a scanner, fetching third-party rule packs). Those all need
explicit consent — `silence-is-yes` / full-auto authorizes ONLY the inputs the
preflight already DETECTED (elements, endpoints, package facts, resume state),
never an install, a network fetch, a live op, the consent gates, or the
audit-phase stops (the tier go-ahead and the show-the-target-map step) — every
one of those is asked via `AskUserQuestion` and recorded. It
never says "will pass": the strongest verdict it can reach is "first-attempt-
ready / no known blockers in what we can verify — Salesforce pen-tests
regardless." It is read-only on the partner's source, and never installs
software or fetches remote content without a yes (see `run-scans`' hard
boundary; an absent scanner is `PENDING-OWNER-RUN`, not an auto-install).

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

1. **Check baseline currency.** Do NOT hand-roll the date sort (a naive `sort | tail`
   lets a `null`/malformed token sort ahead of a real date and misreports a fresh
   baseline as stale — a cold-run driver tripped on exactly this). Run the deterministic
   counter:
   `node ${CLAUDE_PLUGIN_ROOT}/harness/baseline-counts.mjs --currency --baseline ${CLAUDE_PLUGIN_ROOT}/baseline/requirements-baseline.yaml`
   It excludes `null`/malformed tokens from the ranking (ISO dates sort lexicographically;
   no `Date` parsing). Report what it prints: `newest_verified` + how many entries carry it,
   and separately the `null`/unverified count. If that newest non-null date is older than
   90 days, say so before anything else — the review process changed three times in eighteen
   months (Chimera retirement, Code Analyzer v5, AgentExchange), and stale guidance burns
   review cycles (CONVENTIONS §4). Point at `baseline/SOURCES.md` for what to re-verify. This
   is a warning, not a stop.

2. **Cheap architecture sense + smart-resume scan, in one pass.** Reuse
   `/sf-security-review-toolkit:scope-submission`'s detection heuristics (do not
   re-implement them — the element table and the MCP-client-vs-server failure
   mode live there). At preflight depth you are only deciding *what tier each
   input lands in*, not writing the manifest. In the target repo, in one sweep:
   - **Detect architecture elements** by evidence: `sfdx-project.json` +
     `force-app/` (managed package, namespace, Apex/LWC/Aura),
     `Bot`/`GenAiPlugin`/`GenAiPlanner`/`GenAiFunction`/`genAiPromptTemplate`
     metadata (an **`agentforce`** element — the AgentExchange-listing signal
     that gates the agentforce-* requirements; a miss silently drops 12 of them,
     so do not infer it from `managed-package` alone), MCP SDK imports /
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

   **Spot-check the LEDGER against the repo too — manifest drift is not the only
   way a resume goes stale.** When an `audit-ledger.json` exists, run
   `node ${CLAUDE_PLUGIN_ROOT}/harness/ledger-staleness.mjs --target <target>
   --json`. It diffs the repo HEAD against each pass's `audited_commit`
   fingerprint and flags findings whose files changed since they were audited —
   a `fixed` whose fix was reverted, a `refuted` whose non-exploitability no
   longer holds, a `confirmed` already remediated. Stale findings are surfaced as
   "re-audit before the verdict relies on this" and added to the re-audit
   dimension set; they are NEVER silently carried into the readiness verdict. A
   ledger with no fingerprint (written before this field) cannot be verified —
   say so and recommend a fresh pass rather than trusting it. This is what stops
   a resumed run from presenting a clean verdict against code that has since
   regressed.

4. **Auto-resolve from `sf` — only if already authed, never prompting here —
   AND settle deployed-audit readiness UP FRONT.** Run `sf org list` /
   `sf config get target-org` to sense an existing authenticated DevHub or
   scratch org; the DevHub auto-resolution (`IsSecurityReviewed`, Remote Site /
   CSP-Trusted-Sites endpoint inventory, permission matrix, code coverage,
   namespace) and the deployed-org deep audit surface as OPTIONAL POWER-UPS, not
   work the preflight does unprompted. **In the same pass, run
   `node ${CLAUDE_PLUGIN_ROOT}/harness/package-readiness.mjs --target <target>
   --json`** — because `sf` auth is **necessary but not sufficient** for the deep
   audit: it installs an *installable released version*, and a placeholder package
   alias / `…NEXT` versionNumber / missing `04t` alias means there is nothing to
   install (`needs-build`). Gather this make-or-break fact HERE, before the
   summary, so the power-up offer below states the true situation the first time —
   never "I have the auth" only to discover downstream the auth is moot. If no auth
   is sensed, do not run a single Tooling query; "install + auth `sf`" is itself an
   optional power-up. The preflight stays cheap and read-only (`package-readiness`
   reads only `sfdx-project.json`; a live `sf package version list` confirms an
   alias is PROMOTED only if the deep audit is later accepted).

   **In the same up-front pass, run
   `node ${CLAUDE_PLUGIN_ROOT}/harness/tool-detect.mjs --json`** — the deterministic
   scan-tool detector (it probes PATH, installs nothing). It returns, per scan family,
   which tools are PRESENT vs `installable_missing` (semgrep/osv-scanner/checkov/…,
   each with its install method) vs owner / owner-portal. Gather this HERE so the
   single gate's scanner-install offer (Step 5 + the report) states the true situation
   the first time — which families would go from `PENDING-OWNER-RUN` to real evidence
   if the operator consents to a tmp install. Detection only; it never fetches.

   **And run
   `node ${CLAUDE_PLUGIN_ROOT}/harness/stack-detect.mjs --target <target> --json`** —
   the deterministic throwaway-DAST-target detector. If the repo has an external backend
   it reports whether it can be stood up as a disposable, prod-equivalent throwaway for
   an **autonomous active DAST** (`runnable | needs-recipe | needs-secrets | n/a`) and
   classifies the env it needs (synthesizable secrets the toolkit fabricates vs external
   creds the owner must supply). Gather this HERE so the gate's third consent (Step 5 +
   the report) is accurate: `runnable` → "stand it up + DAST it?"; `needs-secrets` →
   "…after you drop these creds where I scaffold them"; `needs-recipe`/`n/a` → DAST stays
   owner-run. Detection only; it stands up nothing here.

   **And check the containerized-throwaway prerequisite:
   `node ${CLAUDE_PLUGIN_ROOT}/harness/docker-check.mjs --json`** — the throwaway DAST
   runs in containers, so it needs Docker. `available` → offer it; `absent`/`daemon-down`
   → DON'T offer the autonomous throwaway-DAST; instead surface the engine's honest hint
   ("Docker is required … install it once system-wide, or your DAST stays owner-run").
   Docker is a documented prerequisite, NOT something the toolkit tmp-installs — unlike the
   userland scanners, it's a privileged daemon needing root-level setup, so the honest move
   is to GUIDE the install, never auto-provision it.

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

   **Optional power-ups are generated from sensed context, not a fixed menu.
   Surface them PROACTIVELY and ACCURATELY in the summary (per the up-front
   precondition scan) so the operator decides once, up front — never buried as
   "available on request" only to be corrected mid-run:**
   - `sf` authed **AND `package-readiness` = `installable`** → the deployed-org
     deep audit is READY. Offer it as a proactive consent point: "stand up a fresh
     scratch org and audit the **deployed** package (what the Salesforce reviewer
     actually does)? It's a live op, so it pauses for your explicit yes." On yes,
     run the §3 deep-audit composition end to end — no further mid-run interruption.
   - `sf` authed **AND `package-readiness` = `needs-build`** → before offering the
     build, **confirm the build can actually succeed**:
     `node ${CLAUDE_PLUGIN_ROOT}/harness/namespace-check.mjs --target <target> --json`
     verifies the package's namespace is registered to the authed Dev Hub (a managed 2GP
     build fails at `sf package version create` otherwise — AND would mutate the repo with
     packaging scaffolding first). Only offer the build on `buildable:true`: "a deployed-org
     deep audit needs an installable version, and there isn't one yet
     (`<package-readiness reason>`) — want me to `build-managed-package` first, then
     deep-audit?" If `buildable:false`, do **NOT** ask the yes/no — surface the precondition
     honestly instead (`<namespace-check reason>`: e.g. "sf is authed, but namespace `atlas`
     isn't registered to your Dev Hub, so a build can't succeed — register + link it first").
     Same proactive-accuracy rule as `package-readiness`: never offer a step that can't run.
   - **`package-readiness` = `no-package`**, or no `sf` auth → the deep audit is
     N/A (nothing to install) or needs `sf` first; offer "install + authenticate
     `sf` so I can audit the deployed package and auto-resolve endpoint/permission/
     coverage facts from the DevHub?" Never imply a deep audit is runnable when it
     isn't.
   For any of these the run still proceeds on silence (a LIVE power-up needs an
   explicit yes — the hard floor); the change is that the offer is proactive and
   true, so the operator's one up-front decision is fully informed.
   - A live endpoint URL present in config/docs → "probe it **read-only** to
     capture the real protocol version / tool inventory / auth mode?" (the
     handshake is read-only; consent + an explicit staging-vs-production label
     are mandatory — never probe an environment you haven't confirmed).
   - **`tool-detect` reported `installable_missing` scanners → the scan-tool install
     consent (the second of the gate's two distinct consents).** This is NOT a
     silence-is-yes power-up: a tmp install **fetches software over the network** —
     the 0.5.4 P0 class — so it ships **only on an explicit yes**, exactly like the
     live-probe / scratch-org floor. Offer it once, here: "install the N missing
     scanners (<name (method)>, …) to `/tmp/sf-srt-scanners/<run>/` **for this run**?
     They're sha256-verified (pinned binaries), removed at cleanup, and the evidence
     is kept. This yes also covers **running** them for this run — which fetches their
     standard rules/templates (Semgrep registry rules, Nuclei templates, the OSV DB) —
     since that is inseparable from producing the evidence. → yes: real
     SAST/SCA/secret/DAST/TLS evidence instead of `PENDING-OWNER-RUN`. → no (default):
     those families stay `PENDING-OWNER-RUN` (today's behavior, unchanged)." On yes, the run later invokes
     `node ${CLAUDE_PLUGIN_ROOT}/harness/install-scanners.mjs --consent --target
     <target> --json` (one Bash call = one approval; the CC permission boundary is the
     outer tool call, so its pip/curl/git/npm subprocesses run unprompted under it),
     and tears them down with `cleanup-scanners.mjs` at the end (tools removed, evidence
     kept). On no / silence, install nothing — `run-scans` keeps its hard boundary.
   - **`stack-detect` = `runnable` AND `docker-check` = `available` → the throwaway-DAST
     consent (the gate's third distinct consent).** Also explicit-yes-only — standing up a
     container + running an ACTIVE scan is a live op. The active scan only ever hits a
     **disposable mirror the toolkit stands up** (never live prod, never Salesforce infra,
     never anyone else's), so there's no boundary to cross — but it's a live op + resource
     use, so it needs a real yes. Offer it once: "stand up your external backend as an
     isolated throwaway (synthetic secrets I generate), run a real DAST against it, keep
     the evidence, and destroy it? This uses Docker and, the first time, pulls a
     digest-pinned ZAP image (~3.6 GB, one-time). Local-throwaway evidence is the toolkit's
     corroborating DAST + a de-risking dry run — NOT a substitute for the
     production-equivalent scan the submission ultimately needs." If `docker-check` is
     `absent`/`daemon-down`, do NOT offer this — surface the honest hint (install Docker
     once, or DAST stays owner-run). On yes, the run invokes the engine chain
     `standup-stack.mjs --consent` → `run-dast.mjs --consent` → `teardown-stack.mjs`
     (the evidence lands in `evidence/dast/`). If `stack-detect` = `needs-secrets`,
     offer the scaffold-and-guide path (the toolkit writes an env stub, names the keys,
     you fill + confirm, it resumes); `needs-recipe`/`n/a` → DAST stays owner-run with
     the generated ZAP plan. On no / silence, stand up nothing.

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

   ✦ OPTIONAL POWER-UPS (proactive + accurate; a LIVE power-up runs only on your explicit yes)
     • Deployed-org deep audit — <READY (installable) → "run it?"  |  needs-build +
       namespace registered → "build first, then deep-audit?"  |  needs-build + namespace
       NOT registered → "can't build: namespace not linked to your Dev Hub — register first"
       (no yes/no)  |  N/A (no installable package / no sf auth)>
     • <live probe / install-sf — generated from what was sensed>

   ```

   ── CONSENT GATES — MANDATORY `AskUserQuestion` calls, recorded, NEVER inferred ──
   These are NOT report lines to print and skim past. After emitting the report above,
   for each consent that applies you MUST call **`AskUserQuestion`** and, on an
   affirmative answer, RECORD it — the downstream engine verifies the recorded token
   and a skipped ask physically cannot proceed (the launch path fails closed on it):

   **Every gate's option set is PINNED by `gate-spec.mjs` — render its
   `options[].label/description` VERBATIM, never improvise the set (the engine owns
   the options; the driver only pipes the chosen option's `decision` token to
   `record-consent`). This kills the run-to-run drift a cold campaign caught (the
   same depth gate offered a different option set each run).**

   - **(1) Run-mode + tier** — render BOTH gates in ONE `AskUserQuestion` call (its
     `questions` array carries both):
     `node ${CLAUDE_PLUGIN_ROOT}/harness/gate-spec.mjs --gate run-mode` (full-auto vs
     guided — sets ask-tolerance) and
     `node ${CLAUDE_PLUGIN_ROOT}/harness/gate-spec.mjs --gate audit-tier` (the pinned tier
     menu — `standard` default, `exhaustive` offered but **never pre-selected**, `quick`
     triage; identical every run). Render each gate's options VERBATIM. The tier election
     is RECORDED here with the controlled `decision` token from the chosen option, so
     audit-codebase Step 2 CONFIRMS it instead of re-asking (WI-02):
     `node ${CLAUDE_PLUGIN_ROOT}/harness/record-consent.mjs --gate audit-tier --decision <affirm|deny> --question "<the tier question>" --answer "<the option they picked>" --target <target>`
     (`affirm` for a chosen tier, `deny` for the Cancel option). run-mode sets how much you
     ASK during the run; it does NOT authorize the per-action consents (2)/(3).
   - **(2) Scan-tool install (network fetch)** — only if `tool-detect` reported ≥1
     installable scanner. Render the gate from `gate-spec.mjs` — its install-option
     description is the VERBATIM sha256 / tmp-removed / evidence-kept / "this yes also
     covers RUNNING them, which fetches rules" disclosure; only the count + the
     `name(method)` list are filled, from the `tool-detect` installable set:
     `node ${CLAUDE_PLUGIN_ROOT}/harness/gate-spec.mjs --gate scanner-install --scanners "<name:method,… from tool-detect installable_missing>"`
     `AskUserQuestion` with those options VERBATIM. On the operator's SELECTION of the
     install option (the selection IS the consent — do NOT rely on the label containing
     "yes"; use `--decision deny` if they declined), record then install:
     `node ${CLAUDE_PLUGIN_ROOT}/harness/record-consent.mjs --gate scanner-install --decision affirm --question "<the install-to-tmp question>" --answer "<the option they picked>" --target <target>`
     → `install-scanners.mjs --consent` (which now ALSO verifies the recorded token; the
     flag alone no longer installs).
   - **(3) Throwaway DAST (live op)** — only if stack-detect=runnable AND docker=available.
     `AskUserQuestion`: stand up an isolated throwaway, active-scan it, then destroy it?
     On the operator's SELECTION of the stand-up option (the selection IS the consent — do NOT
     rely on the label containing "yes"; use `--decision deny` if they declined), record then run:
     `node ${CLAUDE_PLUGIN_ROOT}/harness/record-consent.mjs --gate throwaway-dast --decision affirm --question "<the throwaway-DAST question>" --answer "<the option they picked>" --target <target>`
     → `standup-stack.mjs --consent` → `run-dast.mjs --consent` (both verify the token).

   **`silence-is-yes` IS HARD-BOUND — read this exactly.** It authorizes ONLY the
   DETECTED-ARCHITECTURE inputs the preflight already sensed — the elements, endpoints,
   package facts, and resume state ("don't re-confirm what I detected"). It NEVER
   authorizes the consent gates (1)/(2)/(3), and it NEVER authorizes the audit-phase stops
   (audit-codebase **Step 2** tier go-ahead + **Step 3** show-the-target-map). Those are
   always ASKED via `AskUserQuestion` and RECORDED — in full-auto and guided alike.
   Full-auto does NOT collapse any gate or audit stop into a skip-the-ask shortcut: each
   one is asked and recorded on every run, and the engines fail closed without the token.

   - **If ⚠ NEED-FROM-YOU is empty** and the request was run-shaped: proceed with the
     DETECTED inputs under silence-is-yes — but STILL ask + record gate (1) before the
     audit, and gates (2)/(3) at their phase. A misread correction is always honored.
   - **If ⚠ NEED-FROM-YOU is non-empty**: ask the minimum (use `AskUserQuestion`), or, if
     the operator can't supply it, narrow scope and proceed with that surface honestly
     flagged as unaudited — never fabricate the missing input.
   - **Status-only / one-step requests stop here** in router mode: report the state and
     the single recommended next skill with its reason, and run nothing.

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

3. **Blocker-policy gate (automatic — no election since 0.5.2).** Read `audit-ledger.json`. The toolkit is an AUDIT tool: an open critical/high
   does NOT halt the run and does NOT offer a fix path — it **auto-proceeds** to
   the full NOT-READY report. It never pauses to fix, never drafts/suggests/writes
   code, and is read-only on the partner's source; if the partner wants to
   remediate, they do so on their own and re-run (the staleness check re-audits
   the changed dimensions automatically). **Surface the
   blockers via the deterministic cluster view, not the raw ledger count** —
   `node ${CLAUDE_PLUGIN_ROOT}/harness/finding-clusters.mjs --target <target>
   --json`. Report the raw counts AND the clustered headline (distinct affected
   files + the file-level critical/high count + which files carry cross-dimension
   overlap), so "N findings across D dimensions" is never presented as N distinct
   problems — the audit fans out per dimension and re-finds one root cause under
   several lenses (e.g. a `without sharing` class flagged by apex-exposed-surface
   AND web-client AND package-metadata is one issue, not three).

   The one honesty line the gate enforces: **if an open critical/high finding is
   in the AuthN/AuthZ category, the AuthN/AuthZ artifact is WITHHELD** in the next
   phase — an authn-authz-flow doc describing a flow with a live, unremediated auth
   hole would hand the reviewer a self-incriminating map and misrepresent the
   posture. This is ENFORCED LOGIC, not narration, and it does NOT depend on any
   human election: `harness/artifact-gate.mjs` computes the `suppress` list as a
   pure function of the **ledger** (it withholds the AuthN/AuthZ doc when an open
   **critical/high** finding sits in the authN/authZ category — the
   publication-blocking threshold), and `generate-artifacts` honors it on every
   entry path (fresh / resume / direct), so no missing election or resume can skip
   it. Every other artifact still generates and the verdict carries the open
   findings forward verbatim, with `path-to-green` saying exactly what to fix.
   Optionally drop a `<target>/.security-review/triage-decision.json` note
   recording what was open when the report was produced — it is **informational
   only**; the gate never reads it for the decision.

4. **Artifacts** → `/sf-security-review-toolkit:generate-artifacts`. Generates
   only the artifacts whose `applies_to` matched the manifest; honors the
   blocker-gate AuthN/AuthZ suppression. Each generated doc is labeled
   automated-vs-owner-run; none is presented as reviewer-final.

5. **Scans** → `/sf-security-review-toolkit:run-scans`. Code Analyzer (the
   agent can run it), SSL Labs and dependency scans where targets resolve; DAST
   and Checkmarx are owner-run (creds + the live target are the human's) — those
   become tasks in `PENDING-OWNER-RUN.md`, not blockers. A scan is only "done"
   with a verified evidence file; a plan with no report is not (CONVENTIONS §2).
   **If the scanner-install consent was asked + RECORDED at the gate** (gate
   `scanner-install`; `--consent` alone no longer installs — the engine verifies the
   recorded token), run
   `node ${CLAUDE_PLUGIN_ROOT}/harness/install-scanners.mjs --consent --target
   <target> --json` BEFORE this phase so `run-scans` finds the tmp-installed tools
   on the PATH it prepends (from `.security-review/scanner-install.json`) and emits
   **real** Semgrep/OSV/Checkov/secret/TLS evidence instead of `PENDING-OWNER-RUN`;
   then run `node ${CLAUDE_PLUGIN_ROOT}/harness/cleanup-scanners.mjs --target
   <target>` at the end of the run (or in `stay-listed`) to remove the tools and
   keep the evidence. **If it was declined / never offered**, install nothing —
   absent scanners stay `PENDING-OWNER-RUN` (run-scans' hard boundary is unchanged).

   **If the throwaway-DAST consent was asked + RECORDED at the gate** (gate `throwaway-dast`,
   the gate's third consent; `stack-detect` = `runnable` AND `docker-check` = `available`;
   `--consent` alone no longer runs — both engines verify the recorded token), run the chain so
   the active DAST hits a disposable mirror — never a live or third-party target. (The
   engines also self-guard: `standup-stack`/`run-dast` return `status:"no-docker"` with the
   install hint if Docker vanished since the preflight — surface it, don't crash; DAST
   falls back to owner-run.)
   `node ${CLAUDE_PLUGIN_ROOT}/harness/standup-stack.mjs --consent --target <target> --json`
   (isolated container, synthetic secrets, manifest of created resources) →
   `node ${CLAUDE_PLUGIN_ROOT}/harness/run-dast.mjs --consent --base-url <baseUrl from
   standup> --target <target>` (digest-pinned ZAP → real evidence under `evidence/dast/`) →
   `node ${CLAUDE_PLUGIN_ROOT}/harness/teardown-stack.mjs --target <target>` (destroy the
   throwaway, keep the evidence). **ALWAYS run teardown, even on failure/abort** — never
   leave a stack (with secrets in its env) up. As a backstop against a crash between
   processes, run `node ${CLAUDE_PLUGIN_ROOT}/harness/teardown-stack.mjs --sweep` at the
   START of any throwaway-DAST run (and in `stay-listed`) — it removes every orphaned
   `sf-srt-stack-*` container + tmp tree from a prior crashed run (name-scoped; evidence
   untouched). Label the evidence as **local-throwaway**
   (corroborating + a de-risking dry run), NOT the production-equivalent submission scan.
   If `stack-detect` = `needs-secrets`, do the scaffold-and-guide loop first — and **thread
   ONE run-id through scaffold-env → standup → teardown** so the filled secret stub lives in
   the SAME tmp dir the teardown destroys (a different run-id would orphan the filled stub):
   pick `<id>`, then
   `node ${CLAUDE_PLUGIN_ROOT}/harness/scaffold-env.mjs --target <target> --run-id <id>`
   writes the env STUB at `/tmp/sf-srt-stack/<id>/throwaway.env` (NEVER the repo) naming the
   external creds; tell the operator to fill it, then re-check with the same `--run-id <id>
   --check` (deterministic — a key counts filled only with a non-empty, non-placeholder
   value); on `ready`, stand up with `standup-stack.mjs --run-id <id> --env-file
   /tmp/sf-srt-stack/<id>/throwaway.env …` (standup re-verifies the file is filled, then
   docker loads the values straight into the container — they never touch argv, the manifest,
   or `.security-review/`; the whole `/tmp/sf-srt-stack/<id>/` tree, stub included, is
   destroyed at teardown). If `needs-recipe`/`n/a`, or the consent was declined, DAST
   stays owner-run — emit the ZAP plan into `PENDING-OWNER-RUN.md`, no stand-up.

6. **Deep audit (runs when the deployed-org power-up was accepted at preflight).**
   Before compile, fold in the CLI-gated deployed-org pass — *what the Salesforce
   reviewer actually does*: stand the package up in a throwaway org and audit the
   installed artifact. The five lifecycle skills below are all shipped, so this is
   NOT a "later-release maybe" — it runs whenever the preflight's proactive
   deployed-org offer was accepted (gated on `package-readiness`: `installable` →
   run it; `needs-build` → build first then run, on the same yes). It is not a
   step of *every* run only because it is a LIVE op behind explicit consent — not
   because the capability is unwired. When accepted, compose the
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

7. **Reviewer simulation** → `/sf-security-review-toolkit:reviewer-simulation`.
   Reframes everything the audit + scans (+ deep audit) found as **what Salesforce
   Product Security will see** — the challenge checklist run against the ledger,
   ranked by the reviewer's own attack priority (public reach → authz → injection
   → egress → package hygiene → infra), headed by the first things they will hit.
   Introduces no new finding; it is the narrative over the ledger + SCI. Always
   runs (it only needs the ledger); its open-challenge list seeds the
   path-to-green in compile.

8. **Compile** → `/sf-security-review-toolkit:compile-submission`. Assembles the
   complete downloadable `submission-package/` with the wizard-slot `INDEX.md`
   (each artifact mapped to its exact Security Review Wizard step + upload slot),
   `PENDING-OWNER-RUN.md` (the human tail), and `readiness-verdict.md`. The
   verdict is headed by the **Submission Completeness Index** — a deterministic,
   gated rollup (`harness/compute-sci.mjs`) of the ledger + evidence index +
   scope-filtered baseline that this skill surfaces as the autonomous **pre-compile
   go/no-go signal**: `BLOCKED`/`NOT READY` is the honest verdict (the full report
   is still produced — it just says *don't submit yet* and names the blockers to
   fix + re-run), `MATERIALS COMPLETE`/`NO-SURPRISES READY` means the materials
   are ready. The verdict is also
   per-category, lists **what was NOT verified**, carries any open ledger findings
   forward, and ends on the fixed caveat: Salesforce performs its own penetration
   test regardless of submitted evidence, and the SCI measures completeness, never
   a pass. Empty conditional slots self-suppress — the operator never faces a slot
   for an element that doesn't exist.

### Ask-tolerance (the only knob)

Inferred from the trigger phrasing; the operator rarely sets it explicitly.

- **Full-auto** — default for "just do it" / "run the whole thing": on a YELLOW
  ambiguity, make the best call and **flag it** in the run log and verdict; stop
  on RED (a NEED-FROM-YOU audit-blocker) and at live-probe / scratch-org consent.
  An open critical/high does NOT stop the run — it auto-proceeds to the full
  NOT-READY report (the toolkit audits and reports; it never pauses to fix). This
  is the path that gets a complete package with everything uncertain honestly
  marked.
- **Guided** — default for an apparent first run, or when the operator says
  "walk me through it": on a YELLOW ambiguity, ask before deciding; on GREEN,
  proceed. Same RED hard-stops.
- Either way, the explicit-consent points — a read-only live probe; standing up a
  scratch org; **installing the missing scanners to a tmp dir (a network fetch)**;
  **standing up a throwaway backend + active-scanning it (a live op)** — are always
  honored. Those touch something live or mutate the host / egress to the network, so the
  run pauses for them regardless of tolerance; full-auto / silence-is-yes never covers them.

## Automated vs. manual recap

Automated: the preflight (baseline-currency check, architecture detection, prior-
state + drift scan, `sf`-authed sense and — only if opted in — DevHub auto-
resolve), the tier classification + the single preflight report, and the
end-to-end drive across scope → audit → artifacts → scans →
(opt-in deep audit) → compile, with every contradiction flagged inline.

Manual: correcting a misread in the preflight; supplying any ⚠ NEED-FROM-YOU
audit-blocker; consenting to a live read-only probe, to standing up a scratch
org, to the tmp scanner install (a network fetch), and to the throwaway-DAST stand-up
(a live op) — plus, for a `needs-secrets` stack, dropping the scaffolded creds where the
toolkit points and confirming; and every deferred owner-run
item in `PENDING-OWNER-RUN.md` — the DAST and
Checkmarx runs, all credentials and the vault they belong in, the partner-program
gates, the questionnaire field entry, the review fee, and the Submit click. The
toolkit auto-answers the evidence; the human owns the Partner-Console residue and
the decision to submit. This skill never modifies the partner's source — it
**audits and reports**; it never pauses to fix, and never drafts, suggests, or
writes code changes (per-finding remediation *guidance* in the report is the
ceiling) — and never says "will pass."

## What feeds the next skill

The preflight's detected-state summary and tier classification flow into every
phase invocation, so no downstream skill re-detects from scratch. In router mode
(status-only / one-step) the output is the state summary plus the single
recommended next skill and its reason — paste it into that skill's invocation.
In a full run, the orchestrator chains the phases itself; the terminal output is
the path to the assembled `submission-package/` and its `readiness-verdict.md`.

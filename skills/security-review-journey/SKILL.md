---
name: security-review-journey
description: Autonomous driver for AppExchange/AgentExchange security-review SUBMISSION readiness. Runs a seconds-long preflight (greps + architecture detection + sf CLI auto-resolve when authed), emits one 3-tier preflight report, then drives the whole journey end to end — scope, static scans, audit, artifacts, live scans, package — pausing only for audit-blocking gaps and live-probe/scan-org consent. Auto-activates on "run the security review", "run/continue the audit", "audit my codebase for AppExchange", "am I ready for AppExchange/AgentExchange", "prep my app for the Salesforce review", "where are we on the review". Use to start, resume, or run the full submission-prep journey. NOT a general "is my app secure?" tool — it is scoped to the Salesforce ISV review.
allowed-tools: Read Grep Glob Bash(ls *) Bash(cat *) Bash(find *) Bash(git ls-files*) Bash(git log *) Bash(git status *) Bash(git rev-parse *) Bash(sf org list*) Bash(sf config get*) Bash(node *harness/gate-spec.mjs *) Bash(node *harness/record-consent.mjs *) Bash(node *harness/emit-permission-set.mjs *) Bash(node *harness/render-preflight.mjs *) Bash(node *harness/render-router-status.mjs *) Bash(node *harness/finding-clusters.mjs *) Bash(node *harness/detect-agentforce.mjs *) Bash(node *harness/enumerate-app-roots.mjs *) AskUserQuestion Skill
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

**AUTO-MODE LEGIBILITY — an operating rule for every step in this skill.**
Claude Code auto mode runs a safety classifier that FAILS CLOSED on compound
or opaque shell it "could not evaluate": `cd X && cmd1 && cmd2` chains,
batched `for …; do …; done` loops, inline `node -e "…"`, and `python3 - <<PY`
heredocs all get DENIED mid-run, while atomic single-purpose commands and the
dedicated tools evaluate cleanly. So: when inspecting files or repos, PREFER
the dedicated Read / Grep / Glob tools over compound shell; and run every
prescribed harness command as its OWN atomic Bash call —
`node …/harness/X.mjs --flags`, one command per call, never `&&`-chained,
never looped, never inlined. A denied call reads to the operator as a broken
toolkit; atomic invocations are what keep the run legible to the classifier.

**SOURCE OF TRUTH & MEMORY-INDEPENDENCE — an operating rule for every step in
this skill.** The toolkit is SELF-AUTHORITATIVE. Its LIVE engine output, its
consent GATES, and its own ON-DISK artifacts under `.security-review/`
(audit-ledger, scope-manifest, deterministic-dispositions, `consent/`) are the
SOLE source of truth for how the toolkit operates — every run RE-DERIVES its
facts from the current engine state. Prior host/session MEMORY about this
toolkit or this repo is UNTRUSTED and MAY BE STALE: the toolkit updates
constantly, so a memory written weeks or versions ago may describe behavior
that has since been FIXED IN CODE. A memory NEVER overrides a live engine
decision, and NEVER pre-empts, pre-decides, or auto-declines a consent gate —
when a memory contradicts what the live engines report, the engines win, and
the memory is at most a note to raise (see NEVER AUTO-DECIDE A GATE at the
consent gates). And the write side is the important half, because it stops the
contamination at the source: DO NOT WRITE host-session operational memories
about the toolkit's behavior or a defect it hit. A toolkit defect is fixed in
the toolkit's CODE and recorded in its CHANGELOG and `.security-review/`
artifacts — never in a host memory that silently contaminates future runs (a
stale "never do X here" memory is exactly what blocks a toolkit that has since
been fixed in code).

**FIRST — the SELF-SKIPPING autorun-permissions gate (asked once, ever).**
Before sub-step 1, run
`node ${CLAUDE_PLUGIN_ROOT}/harness/emit-permission-set.mjs --check --target <target> --json`
as its OWN atomic Bash call (the AUTO-MODE LEGIBILITY rule above). It reports
whether the target repo's `.claude/settings.local.json` already pre-approves the
toolkit's curated READ-ONLY command surface (`permissions.allow` entries only —
the engine never touches `deny`/`ask`/`defaultMode`/`env` or any other key), and
whether this gate was already answered (`askedBefore`). Branch on it:
- **Satisfied (exit 0)** → say NOTHING about permissions; proceed.
- **Not satisfied (exit 2) AND `askedBefore: true`** → the operator already
  decided (either way); proceed silently with prompts as they come. NEVER re-ask.
- **Not satisfied AND `askedBefore: false`** → render the pinned gate as the
  FIRST gate of the run:
  `node ${CLAUDE_PLUGIN_ROOT}/harness/gate-spec.mjs --gate autorun-permissions`
  (its options VERBATIM via `AskUserQuestion`), then record the choice (atomic):
  `node ${CLAUDE_PLUGIN_ROOT}/harness/record-consent.mjs --gate autorun-permissions --decision <affirm|deny> --question "<the gate question>" --answer "<the option they picked>" --target <target>`
  On **affirm**, THEN run (its own atomic call):
  `node ${CLAUDE_PLUGIN_ROOT}/harness/emit-permission-set.mjs --apply --target <target> --consent --json`
  — the engine re-verifies the recorded token (fail closed: no token → exit 3,
  nothing written) and is code-bounded to APPENDING `permissions.allow` entries
  from its curated read-only set; a merge that would change ANY other settings
  key aborts and writes nothing. Then tell the operator: the read-only allowlist
  was written to `.claude/settings.local.json` (partner-facing note at
  `.security-review/autorun-permissions.md`); **RESTART Claude Code and run in
  default mode for an uninterrupted run** — this run continues now with prompts
  as they come, the next one is clean. Installs, org ops, and live probes still
  prompt and stay consent-gated regardless — the allowlist never covers them.
  On **decline**, proceed normally (prompts as they come); the recorded deny is
  exactly what keeps this gate from ever being asked again.

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
     `force-app/` (managed package, namespace, Apex/LWC/Aura), MCP SDK imports /
     JSON-RPC `initialize`+`tools/list` dispatch in the partner's *own* code
     (MCP **server** — not a Named Credential pointing at someone else's, which
     makes them an MCP client), server frameworks + route definitions (external
     web/API), `signed_request`/Canvas SDK (Canvas), mobile project trees,
     queue/scheduler config (async workers), OAuth/token/`.well-known` routes
     (identity surface).
   - **Agentforce — run the deterministic detector, never a hand grep.** As its
     OWN atomic Bash call (the AUTO-MODE LEGIBILITY rule above), run
     `node ${CLAUDE_PLUGIN_ROOT}/harness/detect-agentforce.mjs --target <target> --json`
     — it covers the packaged `Bot`/`GenAiPlugin`/`GenAiPlanner`/`GenAiFunction`/
     `genAiPromptTemplate` metadata AND the subscriber-built shapes an XML grep
     misses: an `agent/*.agentscript.yaml` agent and the (heuristic, weaker-signal)
     ESR-registered agent-action. A match on ANY shape is the **`agentforce`**
     element — the AgentExchange-listing signal that gates the agentforce-*
     requirements; a miss silently drops 11 of them, so never infer it from
     `managed-package` alone and never hand-detect it: a live cold run's
     packaged-metadata-only grep reported "no Agentforce" for a subscriber-built
     agent, and the scope phase had to correct it downstream every run. Fold a
     match into the detected `elements[]` (a heuristic-only ESR match rides in
     with its confidence note — the scope phase's `clarify-detection` gate is
     where it gets corroborated, never silently asserted or dropped).
   - **App roots — run the deterministic enumerator, never a hand sweep.** As its
     OWN atomic Bash call, run
     `node ${CLAUDE_PLUGIN_ROOT}/harness/enumerate-app-roots.mjs --target <target> --json`
     — the SAME engine the scope phase runs (WO-108): a preflight hand-sweep
     missed a third app (`apps/admin`) that this engine then caught in the scope
     phase; running it here makes the preflight as accurate as the scope phase.
     Fold every `candidate: true` root into `elements[]` as its own
     external-web-app element carrying the engine's evidence (path, framework,
     declared port).
   - **Detect prior state** for smart-resume (the table below). This is the same
     state model the 0.1 router used — now it feeds *where to resume*, not just
     *what to report*.

   | Evidence | Phase reached | Resume implication |
   |---|---|---|
   | `<target>/.security-review/scope-manifest.json` | Phase 0 done | reuse it unless it drifted (step 3) |
   | `<target>/.security-review/sf-autoresolve.json` | DevHub auto-resolve ran | reuse the resolved endpoint/permission/coverage facts |
   | `<target>/.security-review/audit-ledger.json` | Phase 1 ran | read `confirmed`/`fixed`/`accepted` — open criticals/highs gate artifacts (Step 4 in AUTONOMOUS RUN) |
   | `<target>/docs/security-review/*.md` artifacts | Phase 2 partial/full | list which required artifacts exist; regenerate only the stale/missing |
   | `<target>/.security-review/evidence/` (scan reports, SSL Labs JSON, screenshots) | scans ran — with NO audit ledger, the static-scan substrate; with a ledger, Phase 3 partial | no audit ledger → the static substrate ran and the AUDIT is the resume point (its ingest seeds the deterministic band from this evidence on the first pass); with a ledger → match each evidence file to its baseline scan requirement; a plan with no report is NOT done |
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

   **Run these four detectors as FOUR separate atomic Bash calls.** "The same
   pass" means the same preflight stage, never one `&&`-chained compound
   command or a `for`-looped batch — a batched detector chain is exactly what
   auto mode's classifier denies (the AUTO-MODE LEGIBILITY rule above).

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
     isn't. **This deep-audit `sf` is a SEPARATE authed, global install** (for the
     scratch-org stand-up) — distinct from the **unauthed, tmp `sf`** the
     scanner-install gate provisions (inside `code-analyzer-stack`) for the static
     CRUD/FLS Code Analyzer; so when both run, `sf` is installed twice, two
     different ways, on purpose. Say so if you offer both.
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
     is kept. When the **Code Analyzer stack** is among them (no `sf` present), that one
     is heavier: it pulls `@salesforce/cli` + the `code-analyzer` plugin from npm and,
     if no `java`≥11 is present, the pinned Temurin JDK from Adoptium — **~1 GB (+~320 MB
     if Java must be provisioned)** of tmp, contained under the run dir and removed at
     cleanup the same way; in exchange CRUD/FLS becomes deterministic instead of
     `PENDING-OWNER-RUN`. **This tmp `sf` is UNAUTHED and for the static Code Analyzer
     only — NOT the authed, global `sf` the deployed-org deep audit installs** to stand
     up a scratch org; the two are separate installs with separate purposes. This yes also covers **running** them for this run — which fetches
     their standard rules/templates (Semgrep registry rules, Nuclei templates, the OSV DB,
     the Code Analyzer engines) — since that is inseparable from producing the evidence.
     → yes: real SAST/SCA/secret/DAST/TLS + deterministic CRUD/FLS evidence instead of
     `PENDING-OWNER-RUN`. → no (default): those families stay `PENDING-OWNER-RUN` (today's
     behavior, unchanged)." On yes, the run later invokes
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
     `standup-stack.mjs --consent` → `capture-openapi.mjs --consent` (the read-only
     framework-spec capture from the mirror — the same yes covers it, no separate gate) →
     `run-dast.mjs --consent` → `teardown-stack.mjs`
     (the evidence lands in `evidence/dast/` + `evidence/openapi-<date>.json`). If `stack-detect` = `needs-secrets`,
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
   scannable message, the only interaction in the common case. **Render it VERBATIM**
   from `node ${CLAUDE_PLUGIN_ROOT}/harness/render-preflight.mjs --facts <facts.json>`,
   where `<facts.json>` is the `{ repo, commit, resumePoint, elements, needFromYou,
   baseline, packageReadiness, toolDetect, stackDetect, dockerCheck }` you assembled in
   Steps 0.2–0.4 — the detector JSONs piped straight in, plus your scan's architecture
   `elements` and any audit-blocking `needFromYou` gaps. The engine owns the 3-tier
   SKELETON (✓ DETECTED / ⚠ NEED-FROM-YOU / ✦ OPTIONAL POWER-UPS) and the deployed-org
   power-up's FIXED 4-state enum (installable / needs-build-buildable /
   needs-build-unregistered / no-package); print its stdout verbatim — never hand-rebuild
   the bullets, reorder the tiers, or re-word the 4-state line. The fixed shape:

   ```
   PREFLIGHT — AppExchange/AgentExchange security-review readiness
   Repo: <repo> @ <commit>   Baseline currency: <newest_verified, N unverified>
   Resume point: <fresh start | resuming from Phase X | re-scoping on drift>

   ✓ DETECTED (proceeding with these — interrupt only to correct)
     • <architecture elements · managed package · external backend · scan tools · docker — from the detectors>

   ⚠ NEED-FROM-YOU (blocks a good audit — the only hard-stop)
     • <only a genuinely audit-blocking gap; otherwise: "none">

   ✦ OPTIONAL POWER-UPS (proactive + accurate; a LIVE power-up runs only on your explicit yes)
     • Deployed-org deep audit — <FIXED 4-state: READY (installable) | needs-build
       (buildable) | needs-build (unregistered) | N/A (no installable package)>
     • <throwaway-DAST · scan-tool install · sf CLI — generated from what was sensed>

   ```

   ── CONSENT GATES — MANDATORY `AskUserQuestion` calls, recorded, NEVER inferred ──
   These are NOT report lines to print and skim past. After emitting the report above,
   every consent that applies is asked via **`AskUserQuestion`** and RECORDED — the
   downstream engine verifies the recorded token and a skipped ask physically cannot
   proceed (the launch path fails closed on it). **A full-auto run collects them on
   exactly TWO screens — the run-mode election, then ONE batched consent screen — and
   then proceeds uninterrupted.** A cold full-auto run stopped the operator 13 times
   across 6 screens; only the recorded tokens gate anything, so the asks batch — the
   batching changes HOW MANY SCREENS ask, never WHETHER a token is recorded.

   **NEVER AUTO-DECIDE A GATE.** EVERY consent gate is surfaced LIVE for the
   operator's decision via `AskUserQuestion`. The driver NEVER records an
   affirm or deny the operator did not just make on THIS run — it NEVER
   pre-decides a gate from a host/session memory, a standing instruction, or
   its own read of the source (the SOURCE OF TRUTH & MEMORY-INDEPENDENCE rule
   above). A standing constraint or a memory is a NOTE the driver RAISES inside
   the gate — context in the question text — and the OPERATOR decides. The
   concrete failure this forbids: a driver once recorded `throwaway-dast` as
   DENY on its own, from a stale memory, without surfacing the gate —
   pre-empting the operator's decision with a constraint the toolkit had since
   fixed in code. That is forbidden: surface the gate, mention the memory as
   context, let the operator choose.

   **Every gate's option set is PINNED by `gate-spec.mjs` — render its
   `options[].label/description` VERBATIM, never improvise the set (the engine owns
   the options; the driver only pipes the chosen option's `decision` token to
   `record-consent`). This kills the run-to-run drift a cold campaign caught (the
   same depth gate offered a different option set each run).**

   **ATOMIC INVOCATIONS — one gate = one Bash call. NEVER batch the recordings.**
   Every `record-consent.mjs` call below (and every `gate-spec.mjs` render) is
   its OWN separate Bash tool call. NEVER chain two recordings with `&&`, NEVER
   wrap them in a `cd <dir> && T=… && call1 && call2` compound, NEVER emit them
   from a `for`-loop or heredoc. Claude Code auto mode's safety classifier FAILS
   CLOSED on compound/opaque commands it "could not evaluate" — a live cold run
   had six recordings batched into one `&&`-chain DENIED outright, while the
   SAME six recorded one-per-Bash-call all passed. Batching consolidates the
   SCREENS (how many times the operator is asked); the recordings themselves
   stay atomic — one `node …/record-consent.mjs` per Bash call, every time. The
   same rule holds for every multi-step harness sequence this skill prescribes
   (the Step 0 detectors, the install/standup/capture/run engine chains):
   separate atomic calls, in order, never one compound command.

   - **SCREEN 1 — Run-mode + tier** — render BOTH gates in ONE `AskUserQuestion` call
     (its `questions` array carries both):
     `node ${CLAUDE_PLUGIN_ROOT}/harness/gate-spec.mjs --gate run-mode` (full-auto vs
     guided — sets ask-tolerance) and
     `node ${CLAUDE_PLUGIN_ROOT}/harness/gate-spec.mjs --gate audit-tier` (the pinned tier
     menu — `standard` default, `exhaustive` offered but **never pre-selected**, `quick`
     triage; identical every run). Render each gate's options VERBATIM. RECORD BOTH with
     the controlled `decision` token from the chosen option — the tier so audit-codebase
     Step 2 CONFIRMS it instead of re-asking (WI-02), and the run-mode so downstream
     skills can gate their full-auto fast-paths on the recorded mode:
     `node ${CLAUDE_PLUGIN_ROOT}/harness/record-consent.mjs --gate audit-tier --decision <affirm|deny> --question "<the tier question>" --answer "<the option they picked>" --target <target>`
     (`affirm` for a chosen tier, `deny` for the Cancel option), then
     `node ${CLAUDE_PLUGIN_ROOT}/harness/record-consent.mjs --gate run-mode --decision affirm --question "<the run-mode question>" --answer "<Full-auto | Guided — the option they picked>" --target <target>`
     (both run-mode options proceed — the ANSWER text carries the elected mode;
     `.security-review/consent/run-mode.json` is what audit-codebase / scope-submission /
     compile-submission read to decide full-auto vs guided behavior). run-mode sets how
     much you ASK during the run; it does NOT authorize the per-action consents below —
     each of those still requires its own recorded token.

   - **SCREEN 2 (FULL-AUTO ONLY) — the ONE batched consent screen.** When the operator
     elected **Full-auto**, ask every remaining applicable consent in ONE
     `AskUserQuestion` call (its `questions` array carries up to four), then record EVERY
     token via `record-consent` — full invocation form, never abbreviated (`--answer` is
     REQUIRED; `record-consent` exits 2 without it). After this screen the run proceeds
     uninterrupted to the finished package (audit-codebase Steps 2/3 auto-record on the
     recorded tokens instead of stopping; scope-confirm auto-records with the summary as
     a note; the partner-program answers defer to compile-submission):
     - **Q1 — "Launch the audit (tier + target map)"**: render
       `node ${CLAUDE_PLUGIN_ROOT}/harness/gate-spec.mjs --gate audit-tier --target <target>`
       — Screen 1 already recorded the tier, so this emits the WI-02 CONFIRM-and-authorize
       variant, whose pinned question already states it authorizes the launch (the fan-out
       token spend) AND the target-map approval that follows. On **Authorize**, record BOTH
       tokens (the target map is COMPUTED by `render-target-map.mjs`, never authored, so it
       rides this authorization — audit-codebase still prints the resolved map VERBATIM as
       a correctable note before the fan-out):
       `node ${CLAUDE_PLUGIN_ROOT}/harness/record-consent.mjs --gate audit-tier --decision affirm --question "<the launch confirm question>" --answer "<the Authorize option>" --target <target>`
       `node ${CLAUDE_PLUGIN_ROOT}/harness/record-consent.mjs --gate audit-targetmap --decision affirm --question "<the launch confirm question — the map approval rides the launch authorization>" --answer "<the Authorize option>" --target <target>`
       On **Cancel**, the same two calls with `--decision deny` — the fan-out fails closed.
     - **Q2 — "Install scanners (network fetch to a per-run temp dir)"**: only if
       `tool-detect` reported ≥1 installable scanner. Render
       `node ${CLAUDE_PLUGIN_ROOT}/harness/gate-spec.mjs --gate scanner-install --scanners "<name:method,… from tool-detect installable_missing>"`
       VERBATIM (the sha256 / tmp-removed / evidence-kept / "this yes also covers RUNNING
       them, which fetches rules" disclosure is the pinned option text). Record the
       selection (the selection IS the consent — `--decision deny` if declined):
       `node ${CLAUDE_PLUGIN_ROOT}/harness/record-consent.mjs --gate scanner-install --decision affirm --question "<the install-to-tmp question>" --answer "<the option they picked>" --target <target>`
     - **Q3 — "Live & outbound ops (deep-audit org ops + throwaway DAST)"**: only if the
       deployed-org deep audit is offerable (`sf` authed + `package-readiness`) and/or the
       throwaway DAST is runnable (`stack-detect` = `runnable` AND `docker-check` =
       `available`). Render the pinned umbrella
       `node ${CLAUDE_PLUGIN_ROOT}/harness/gate-spec.mjs --gate sf-deep-audit-ops`
       VERBATIM, stating in the question text which of the two live tracks apply on this
       run. On the affirm selection, record EACH applicable token:
       `node ${CLAUDE_PLUGIN_ROOT}/harness/record-consent.mjs --gate sf-deep-audit-ops --decision affirm --question "<the live-ops question>" --answer "<the option they picked>" --target <target>`
       `node ${CLAUDE_PLUGIN_ROOT}/harness/record-consent.mjs --gate throwaway-dast --decision affirm --question "<the live-ops question — throwaway DAST rider>" --answer "<the option they picked>" --target <target>`
       (`--decision deny` for each on decline; omit the `throwaway-dast` record entirely
       when the stack is not runnable — never record a consent for an op that cannot run).
     - **Q4 — read-only live probe (staging/production label)**: only if a live endpoint
       URL was detected. Render
       `node ${CLAUDE_PLUGIN_ROOT}/harness/gate-spec.mjs --gate mcp-probe --url "<URL>"`
       VERBATIM — the operator's staging-vs-production selection IS the environment label,
       so a production endpoint is never probed silently. Record it:
       `node ${CLAUDE_PLUGIN_ROOT}/harness/record-consent.mjs --gate mcp-probe --decision <affirm|deny> --question "<the probe question>" --answer "<the option they picked — carries the STAGING/PRODUCTION label>" --target <target>`

   - **GUIDED — per-gate stops at their phase (unchanged).** When the operator elected
     **Guided**, there is NO batched screen: each consent below is a MANDATORY
     `AskUserQuestion` at its own step, recorded the same way —
     - **Scan-tool install (network fetch)**: render `gate-spec.mjs --gate scanner-install`
       with the `tool-detect` installable set as above; record via
       `record-consent.mjs --gate scanner-install` with the chosen option's decision →
       `install-scanners.mjs --consent` (which ALSO verifies the recorded token; the flag
       alone no longer installs).
     - **Throwaway DAST (live op)**: only if stack-detect=runnable AND docker=available;
       ask, then record via
       `record-consent.mjs --gate throwaway-dast --decision <affirm|deny> --question "<the throwaway-DAST question>" --answer "<the option they picked>" --target <target>`
       → `standup-stack.mjs --consent` → `capture-openapi.mjs --consent` →
       `run-dast.mjs --consent` (all three verify the token).
     - **Deep-audit live ops / read-only probe**: asked at their phase through the same
       pinned gates (`sf-deep-audit-ops`, `mcp-probe`), recorded per gate.
     - audit-codebase **Step 2** (launch confirm) and **Step 3** (show the target map)
       remain mandatory stops in guided mode.

   **`silence-is-yes` IS HARD-BOUND — read this exactly.** It authorizes ONLY the
   DETECTED-ARCHITECTURE inputs the preflight already sensed — the elements, endpoints,
   package facts, and resume state ("don't re-confirm what I detected"). It NEVER
   authorizes the consent gates, and it NEVER authorizes the audit-phase stops
   (audit-codebase **Step 2** launch go-ahead + **Step 3** show-the-target-map). Every one
   of those proceeds ONLY on a RECORDED affirmative token from a real `AskUserQuestion` —
   in full-auto the tokens are all collected up front on the batched consent screen
   (asked once, recorded per gate via `record-consent`); in guided each is asked at its
   own step. Either way the engines verify each token and fail closed without it —
   batching consolidates the SCREENS, it never skips an ask or infers a yes.

   - **If ⚠ NEED-FROM-YOU is empty** and the request was run-shaped: proceed with the
     DETECTED inputs under silence-is-yes — but STILL ask + record gate (1) before the
     audit, and gates (2)/(3) at their phase. A misread correction is always honored.
   - **If ⚠ NEED-FROM-YOU is non-empty**: ask the minimum (use `AskUserQuestion`), or, if
     the operator can't supply it, narrow scope and proceed with that surface honestly
     flagged as unaudited — never fabricate the missing input.
   - **Status-only / one-step requests stop here** in router mode: report the state via
     the FIXED 3-line block — print VERBATIM the stdout of
     `node ${CLAUDE_PLUGIN_ROOT}/harness/render-router-status.mjs --target <target>`
     (resume-point · single next-skill · one-sentence reason; pass a richer `--facts`
     JSON when you have run the drift / ledger-staleness checks so it reflects them).
     Never hand-author the status — the engine owns the resume ladder. Then run nothing.

### AUTONOMOUS RUN (no further questions beyond NEED-FROM-YOU + consent)

Drive the phases in order. On any contradiction discovered mid-run (a manifest
claim the code refutes, an endpoint that 404s, a tool count that moved), apply
the chosen ask-tolerance policy: flag it inline and continue, or — in guided
mode on a YELLOW ambiguity — ask. Use the `Skill` tool to invoke each phase;
pass the detected-state summary forward so no phase re-detects from scratch.

1. **Scope** → `/sf-security-review-toolkit:scope-submission`. Skip only if a
   non-drifted manifest already exists (Step 0.3). It writes
   `scope-manifest.json` (+ `sf-autoresolve.json` when the DevHub power-up was
   accepted). Re-run it whenever Step 0 flagged drift. **In FULL-AUTO the scope
   phase runs without stops** (scope-submission reads the recorded run-mode):
   the six partner-program answers are DEFERRED to compile-submission (left
   `not-recorded`, rendered honestly in the summary — they are submission
   logistics that cannot gate the audit, so they belong where readiness is
   computed), and the final `scope-confirm` is AUTO-RECORDED with the
   `render-scope-summary` block emitted VERBATIM as a note the operator can act
   on (the later COMPUTED target map is the real correction point). The one
   scope stop that survives full-auto is a genuine `clarify-detection`
   ambiguity — the audit-blocking carve-out.

2. **Static scans (the static-scan substrate)** → `/sf-security-review-toolkit:run-scans`,
   invoked in **static-substrate mode** — state the mode explicitly in the invocation
   (run-scans documents both journey entry modes; a bare invocation with no mode is a
   standalone full sweep). This step runs the **host-independent** scan families BEFORE
   the audit, so the audit's deterministic ingest has real scanner evidence on its
   FIRST pass: Code Analyzer (the CRUD/FLS + sharing band), the external SAST
   (Semgrep + the language gates), SCA + IaC (OSV-Scanner/Checkov), the secret scan,
   and the dependency audit — every manifest-selected family that needs no reachable
   host and no deployed org. Evidence lands under `.security-review/evidence/`, and
   the substrate's own tail runs the idempotent `--all` ingest + reconcile, so the
   deterministic band is already seeded when the audit launches.

   **If the scanner-install consent was asked + RECORDED at the gate** (gate
   `scanner-install`; `--consent` alone no longer installs — the engine verifies the
   recorded token), run
   `node ${CLAUDE_PLUGIN_ROOT}/harness/install-scanners.mjs --consent --target
   <target> --json` BEFORE invoking the substrate so `run-scans` finds the
   tmp-installed tools on the PATH it prepends (from
   `.security-review/scanner-install.json`) and emits **real** Code Analyzer /
   Semgrep / OSV / Checkov / secret evidence instead of `PENDING-OWNER-RUN`.
   **If it was declined / never offered**, install nothing — the substrate uses only
   tools already present, and absent scanners stay `PENDING-OWNER-RUN` (run-scans'
   hard boundary is unchanged; this step NEVER installs anything itself).
   `cleanup-scanners.mjs` stays at END-OF-RUN, after the live/conditional tail —
   the tmp tools remain on the PATH for it.

   **An absent scanner never blocks the audit.** Zero static tools → this step
   reports those families `PENDING-OWNER-RUN` and the run proceeds straight to the
   audit, which keeps its findings `llm-inferred` (the standing contract, unchanged —
   the substrate only changes WHEN deterministic evidence can exist, never what
   happens without it).

   **TLS placement (a host-reaching probe never re-times a gate):** testssl.sh/sslyze
   still reach a host, so local TLS joins this static pass ONLY when a manifest
   endpoint host is reachable AND its read-only live-probe consent was already
   recorded at the preflight gate — the same consent, asked at the same point,
   fail-closed the same way. With no reachable/consented host, TLS stays in the
   live/conditional tail (Step 6) or `PENDING-OWNER-RUN`.

3. **Audit** → `/sf-security-review-toolkit:audit-codebase`. The find →
   adversarial-verify → synthesize engine, fanned out across the applicable
   dimensions. It refuses to run without a manifest and embeds the existing
   ledger so confirmed/refuted findings are not re-reported. Declare the
   token-cost tier up front (`quick`/`standard`/`exhaustive`).

   **Deterministic pass FIRST, then reconcile (Phase 1 of
   `docs/roadmap-deterministic-findings.md`).** audit-codebase runs the
   deterministic engines BEFORE its LLM fan-out and reconciles AFTER its merge:
   `harness/ingest-scanner-findings.mjs` seeds `provenance:'deterministic'` findings
   (the `metadata-viewall` source scan ALWAYS — ViewAll/ModifyAll over-grants, no
   `sf` needed; plus every scanner output the static substrate (Step 2) already
   landed under `.security-review/evidence/` — Code Analyzer CRUD/FLS + sharing,
   the OSS SAST / SCA / IaC / secret families), then after the merge
   `harness/reconcile-provenance.mjs` supersedes any co-located `llm-inferred`
   finding the engine now owns, and `harness/apply-dispositions.mjs` applies any
   structured deterministic-class adjudications the audit recorded in
   `.security-review/deterministic-dispositions.json` (a scanner class the audit
   adjudicated false-positive flips `confirmed → refuted` in the ledger — the same
   reason the FP dossier carries; an `llm-inferred` finding is NEVER flipped, so a
   disposition can never hide an LLM-confirmed blocker). Because the static substrate ran FIRST, the `--all`
   ingest seeds the deterministic band on the FIRST audit pass: the finders defer
   to it immediately (audit-codebase compiles the ledger digest AFTER its
   deterministic pass, so the band is in the digest the fan-out reads), the SCI
   credits those families as reviewer-reproducible SATISFIED in the same run, and
   the old double-cost — auditing blind, then paying a full re-audit just to
   ingest late-arriving scan evidence — is gone. PENDING remains only for
   declined-consent / absent-tool families and the genuinely-owner scans (the
   portal run, the live-prod DAST). **`sf`/Code Analyzer absent →
   PENDING-OWNER-RUN, never LLM-fill, never drop:** with no `code-analyzer-*.json`,
   CRUD/FLS + sharing stay PENDING and the LLM KEEPS those findings as
   `llm-inferred` — and the deterministic band recurs identically run-to-run (the
   §8 "run the engine twice → identical" replacement for the 5-run campaign).

4. **Blocker-policy gate (automatic — no election since 0.5.2).** Read `audit-ledger.json`. The toolkit is an AUDIT tool: an open critical/high
   does NOT halt the run and does NOT offer a fix path — it **auto-proceeds** to
   the full NOT-READY report. It never pauses to fix, never drafts/suggests/writes
   code, and is read-only on the partner's source; if the partner wants to
   remediate, they do so on their own and re-run (the staleness check re-audits
   the changed dimensions automatically). **Surface the
   blockers via the deterministic cluster view, not the raw ledger count** — print
   VERBATIM the fixed block from
   `node ${CLAUDE_PLUGIN_ROOT}/harness/finding-clusters.mjs --target <target> --headline`:
   raw confirmed counts FIRST, then the clustered distinct-file headline (distinct
   affected files + the file-level critical/high count + which files carry cross-dimension
   overlap). This is the SAME block audit-codebase Step 6 prints, so the failure verdict
   reads identically at both sites; never hand-rebuild, reorder, or flip it to prose. So
   "N findings across D dimensions" is never presented as N distinct
   problems — the audit fans out per dimension and re-finds one root cause under
   several lenses (e.g. a `without sharing` class flagged by apex-exposed-surface
   AND web-client AND package-metadata is one issue, not three). The headline reads
   the DISPOSITIONED band: audit Step 6's `apply-dispositions.mjs` already flipped
   any deterministic scanner class the audit adjudicated false-positive out of the
   open band (structured entries in `.security-review/deterministic-dispositions.json`),
   so the count reflects the real blockers — with the dispositioned count surfaced
   in the audit recap's deterministic-band line, never a silent shrink. No new
   consent, no gate change.

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

5. **Artifacts** → `/sf-security-review-toolkit:generate-artifacts`. Generates
   only the artifacts whose baseline ids are in the manifest's
   `applicableBaselineIds` (the persisted applicable set, read verbatim —
   never re-derived by intersecting `applies_to` against element types);
   honors the blocker-gate AuthN/AuthZ suppression. Each generated doc is
   labeled automated-vs-owner-run; none is presented as reviewer-final.

6. **Scans (the live/conditional tail)** → `/sf-security-review-toolkit:run-scans`,
   invoked in **live-tail mode** (state the mode in the invocation, as at Step 2).
   The static substrate (Step 2) already produced the host-independent evidence;
   what remains is the live and conditional work: the authenticated-DAST plan
   (+ the throwaway-DAST chain below), the Checkmarx portal prediction (it maps
   the audit ledger's CONFIRMED findings, so it can only run after the audit),
   host-grade TLS — SSL Labs, or local testssl/sslyze where a consented reachable
   host exists — any family the substrate left `PENDING-OWNER-RUN`, and the scan
   tail's `--all` ingest + reconcile. That tail is idempotent (stable ids dedup;
   reconcile only demotes), so re-running it after the substrate already seeded
   the band is safe and folds in whatever THIS pass added. DAST and Checkmarx are
   owner-run (creds + the live target are the human's) — those become tasks in
   `PENDING-OWNER-RUN.md`, not blockers. A scan is only "done" with a verified
   evidence file; a plan with no report is not (CONVENTIONS §2). At the END of the
   run, run `node ${CLAUDE_PLUGIN_ROOT}/harness/cleanup-scanners.mjs --target
   <target>` (or in `stay-listed`) to remove the consent-installed tmp tools and
   keep the evidence.

   **If the throwaway-DAST consent was asked + RECORDED at the gate** (gate `throwaway-dast`,
   the gate's third consent; `stack-detect` = `runnable` AND `docker-check` = `available`;
   `--consent` alone no longer runs — both engines verify the recorded token), run the chain so
   the active DAST hits a disposable mirror — never a live or third-party target. (The
   engines also self-guard: `standup-stack`/`run-dast` return `status:"no-docker"` with the
   install hint if Docker vanished since the preflight — surface it, don't crash; DAST
   falls back to owner-run.)
   `node ${CLAUDE_PLUGIN_ROOT}/harness/standup-stack.mjs --consent --target <target> --json`
   (isolated container, synthetic secrets, manifest of created resources) →
   `node ${CLAUDE_PLUGIN_ROOT}/harness/capture-openapi.mjs --consent --from-standup
   --target <target>` (while the mirror is up: a read-only GET of the
   framework's own spec — `/openapi.json` first — lands the REAL api-endpoints spec in
   `evidence/openapi-<date>.json` with a container-isolated-mirror provenance sidecar;
   prod-equivalence stays PENDING owner attestation. **NO new consent** — it rides on the
   recorded `throwaway-dast` token that stood the mirror up and verifies that token exactly
   as `run-dast` does; the capture resolves the mirror URL from the stand-up pointer and
   REFUSES an explicit `--base-url` (exit 3) — it only ever reads the toolkit-built mirror.
   On `not-exposed` /
   declined consent, nothing is captured and the api-endpoints artifact stays code-derived —
   unchanged behavior) →
   `node ${CLAUDE_PLUGIN_ROOT}/harness/run-dast.mjs --consent --from-standup
   --target <target> [--guarded] [--migration <tool>]` (digest-pinned ZAP → real
   evidence under `evidence/dast/`; run-dast reads the manifest's health/tier flags, prefixes
   the alert counts with a **DEGRADED** line when the stand-up was not verified `up` or the
   scanned port is not the detected web tier, and stamps a machine-readable
   `dast-provenance.json` — the field `compile-submission`/`reviewer-simulation` ingest, since
   they cannot read the prose README) →
   `node ${CLAUDE_PLUGIN_ROOT}/harness/teardown-stack.mjs --target <target>` (destroy the
   throwaway, keep the evidence). **ALWAYS run teardown, even on failure/abort** — never
   leave a stack (with secrets in its env) up. As a backstop against a crash between
   processes, run `node ${CLAUDE_PLUGIN_ROOT}/harness/teardown-stack.mjs --sweep` at the
   START of any throwaway-DAST run (and in `stay-listed`) — it removes every orphaned
   `sf-srt-stack-*` container + tmp tree from a prior crashed run (name-scoped; evidence
   untouched). Label the evidence as **local-throwaway**
   (corroborating + a de-risking dry run), NOT the production-equivalent submission scan.
   **HARD RULE — never touch anything already running.** The driver NEVER touches,
   stops, removes, or deletes ANYTHING already running that the toolkit did not itself
   stand up — not files, not containers, not volumes, not Salesforce orgs. A
   container-name / port / resource collision with something already running means
   the toolkit DEGRADES — DAST → PENDING-OWNER-RUN with the honest diagnosis ("a
   container named X is already running — it may be your live stack; I will NOT touch
   it") — it NEVER clears the collision by hand. NEVER run `docker rm` / `docker stop`
   / `docker kill` / `docker compose down` (or `sf org delete`) against a resource the
   toolkit did not create: diagnosing a failed stand-up is never a licence to
   improvise a destructive op, and ALL removal goes through the name-anchored teardown
   engines (`teardown-stack.mjs`, `teardown-org.mjs` — the sweep above included),
   which refuse non-toolkit names structurally. The rule is general, not
   docker-specific: the same "improvise a destructive op while diagnosing a failure"
   mode recurs as `sf org delete` in the deep-audit lane — degrade honestly there too;
   only `teardown-org.mjs` ever deletes an org.
   **Branch on the stand-up health** (`stack-standup.json.status`, one of
   `up` / `unhealthy` / `redirect-only` / `failed` / `unknown`): on **`up`**, capture +
   run-dast as above; on **`unhealthy`** / **`redirect-only`**, STILL run capture-openapi
   (the framework spec is served at import time, before any DB hit — keep the evidence) AND
   run-dast, but the scan carries a degraded label (the manifest's `guarded`/`readiness`
   flags qualify it); on **`failed`** / **`unknown`**, skip capture + DAST and go straight to
   teardown, recording evidence-of-absence with
   `node ${CLAUDE_PLUGIN_ROOT}/harness/run-dast.mjs --absent --reason "<status: shape>" --target
   <target>` (writes a `not-run` `dast-provenance.json` so `compile-submission` renders an
   explicit "corroboration not attempted", never a silent gap) and emitting the ZAP plan into
   `PENDING-OWNER-RUN.md` (on `unknown` the detected web tier may be wrong — hint `--port`).
   Teardown ALWAYS runs, on every branch. (`--from-standup` is the ONLY input form:
   run-dast + capture-openapi resolve the `baseUrl`/health/tier from the gitignored
   `stack-standup.json` pointer through ONE shared resolver — it re-asserts loopback,
   gates on `{up, unhealthy}`, and refuses a torn-down, swept-stale, or foreign pointer.
   Both engines REFUSE an explicit `--base-url` outright, exit 3: they never scan or read
   a pre-existing/running instance — that could be a partner's real product, and loopback
   alone is not a sufficient guard, since a real instance is also on loopback.)
   **No running-instance fallback:** when the mirror never stood up (`failed`/`unknown`,
   or Docker is unavailable), capture + DAST DEGRADE to PENDING-OWNER-RUN with the honest
   diagnosis (`mirror-fixes.md` names any build defect the mirror could not work around);
   the api-endpoints artifact stays code-derived. There is no path that points either
   engine at something already running.
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
   stays owner-run — emit the ZAP plan into `PENDING-OWNER-RUN.md`, no stand-up, AND record the
   evidence-of-absence stub (`run-dast.mjs --absent --reason "<needs-recipe / n-a / declined:
   shape>" --target <target>`) so the not-attempted corroboration is explicit downstream, never
   a silent gap.

7. **Deep audit (runs when the deployed-org power-up was accepted at preflight).**
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
   test — **the version to install is NEVER a question**: there is NO version
   gate in `gate-spec.mjs`'s catalog and none may be improvised; resolve it
   DETERMINISTICALLY to the highest released `04t` from the
   `sf package version list` output the run already gathered, and surface the
   chosen version as a note) →
   `/sf-security-review-toolkit:audit-deployed-package` (the security
   pass over the installed artifact) → `/sf-security-review-toolkit:teardown-mcp-registration`
   (zero-residue removal). The scratch-org create/delete inside those steps is
   ENGINE-RUN, never hand-scripted: `harness/standup-org.mjs` creates the
   born-clean org (toolkit alias `sf-srt-org-<runId>`, resource manifest,
   fails closed without the recorded `sf-deep-audit-ops` consent — the same
   token those ops already classify to, no new gate) and
   `harness/teardown-org.mjs` deletes exactly the org its manifest records
   (name-guarded: a non-toolkit alias is refused, so a foreign org can never
   be deleted; `--sweep` clears toolkit orgs left behind by a crashed run —
   machine-wide, so only when no other toolkit audit is in flight). Dev Hub
   authentication stays owner-interactive — the engine detects a missing hub
   and degrades honestly (`no-devhub`); it never authenticates. Source
   reading cannot verify install-time behavior; this previews the reviewer's
   own install/uninstall test. Skip silently when the power-up was declined —
   the source audit is the always-on core.

8. **Reviewer simulation** → `/sf-security-review-toolkit:reviewer-simulation`.
   Reframes everything the audit + scans (+ deep audit) found as **what Salesforce
   Product Security will see** — the challenge checklist run against the ledger,
   ranked by the reviewer's own attack priority (public reach → authz → injection
   → egress → package hygiene → infra), headed by the first things they will hit.
   Introduces no new finding; it is the narrative over the ledger + SCI. Always
   runs (it only needs the ledger); its open-challenge list seeds the
   path-to-green in compile.

9. **Compile** → `/sf-security-review-toolkit:compile-submission`. Assembles the
   complete downloadable `submission-package/` with the wizard-slot `INDEX.md`
   (each artifact mapped to its exact Security Review Wizard step + upload slot),
   `PENDING-OWNER-RUN.md` (the human tail), and `readiness-verdict.md`. The
   verdict is headed by the **Submission Completeness Index** — a deterministic,
   gated rollup (`harness/compute-sci.mjs`) of the ledger + evidence index +
   scope-filtered baseline that this skill surfaces as the autonomous **pre-compile
   go/no-go signal**: `BLOCKED`/`NOT READY` is the honest verdict (the full report
   is still produced — it just says *don't submit yet* and names the blockers to
   fix + re-run), `MATERIALS COMPLETE`/`NO-SURPRISES READY` means the materials
   are ready. If `compute-sci` instead refuses with a `STALE SCOPE MANIFEST`
   block (exit 2 — the manifest's persisted applicable set no longer matches a
   recompute from its own elements), the resume point is Phase 0: route back to
   `/sf-security-review-toolkit:scope-submission` and re-scope before compiling.
   Past that gate, the verdict is also
   per-category, lists **what was NOT verified**, carries any open ledger findings
   forward, and ends on the fixed caveat: Salesforce performs its own penetration
   test regardless of submitted evidence, and the SCI measures completeness, never
   a pass. Empty conditional slots self-suppress — the operator never faces a slot
   for an element that doesn't exist.

### Ask-tolerance (the only knob)

Inferred from the trigger phrasing; the operator rarely sets it explicitly.

- **Full-auto** — default for "just do it" / "run the whole thing": on a YELLOW
  ambiguity, make the best call and **flag it** in the run log and verdict; stop
  ONLY on RED (a NEED-FROM-YOU audit-blocker) — every consent (live probe,
  scratch org, scanner install, throwaway DAST, the audit launch + target map)
  was already asked and recorded on the up-front batched consent screen, so no
  further stop exists between the batched screen and the finished package.
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
  honored: each proceeds ONLY on its own recorded token, and silence-is-yes never covers
  them. What differs by mode is WHERE the ask happens, never whether it does: full-auto
  collects every applicable consent up front on the ONE batched consent screen (Step 0.6)
  and then runs uninterrupted; guided asks each at its phase. The engines verify the
  recorded token either way and fail closed without it.

## Automated vs. manual recap

Automated: the preflight (baseline-currency check, architecture detection, prior-
state + drift scan, `sf`-authed sense and — only if opted in — DevHub auto-
resolve), the tier classification + the single preflight report, and the
end-to-end drive across scope → static scans → audit → artifacts →
live/conditional scans → (opt-in deep audit) → compile, with every
contradiction flagged inline.

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

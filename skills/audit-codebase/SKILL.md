---
name: audit-codebase
description: Phase 1 of security review prep. Runs the autonomous multi-agent white-box audit of the partner's own codebase across the applicable threat dimensions — find, adversarially verify, synthesize — maintaining a findings ledger that makes every re-run incremental. Use after scope-submission, after fixing findings, or after a failed review to sweep for a vulnerability class.
allowed-tools: Read Grep Glob Write Bash(ls *) Bash(find *) Bash(git log *) Bash(git status*) Bash(git diff*) Bash(cat *) Bash(sha256sum *) Bash(shasum *) Task AskUserQuestion
---

# Audit Codebase

Execute the audit engine specified in
`${CLAUDE_PLUGIN_ROOT}/methodology/audit-methodology.md` against the partner's
repo. That spec is binding — pipeline, schemas, severity taxonomy, ledger
mechanics, pass planning, and honesty constraints all live there; this skill is
the operating procedure that runs it. The output is a verified findings report
under `docs/security-review/` plus an updated ledger under `.security-review/`.
**This is static code review by LLM agents reading source — never DAST, never a
pen test** (CONVENTIONS §2); Salesforce performs its own penetration testing
regardless of anything this engine produces.

## When to use

- After `/sf-security-review-toolkit:scope-submission` wrote a scope manifest
- Re-audit after remediation — cheap, because the ledger digest suppresses
  everything already found (the re-run loop, step 8)
- After a failed review: ingest the failure report into the ledger as
  confirmed findings, then sweep the codebase for the same *class* — the
  remediation flow expects ALL instances of a flagged pattern fixed, not just
  the cited ones (baseline: `process-failure-remediation-flow`)
- NOT for scanning packaged Apex — CRUD/FLS and the structured package pass
  belong to Code Analyzer in `/sf-security-review-toolkit:run-scans`
- NOT a substitute for the authenticated DAST scan the review requires, and
  NOT for first-time architecture detection (`/sf-security-review-toolkit:scope-submission`)

## Prerequisites

- `<target>/.security-review/scope-manifest.json` — **refuse to run without
  it** (audit-methodology §1.1) and route to scope-submission. Dimension
  selection keys off the manifest; an audit of the wrong surface set is wasted
  spend
- The dimension files in `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/`
- Baseline currency: read the baseline entries this skill leans on
  (`process-failure-remediation-flow`; the severity table in
  audit-methodology §4 points at `process-review-fee` and
  `process-review-timeline`) and warn if their `last_verified` is older than
  90 days (CONVENTIONS §4)
- A clean-enough working tree that file:line citations and ledger dedup keys
  stay meaningful across the run

## Steps

1. **Load the manifest — and check it is still true.** A manifest is stale
   when the repo has outgrown it: an `sfdx-project.json` that appeared since,
   a changed MCP tool count, a new route tree or worker queue. Warn and offer
   `/sf-security-review-toolkit:scope-submission` re-scoping before fanning
   out — auditing yesterday's architecture produces today's false confidence.

2. **Declare the token tier before launching anything** (CONVENTIONS §5,
   audit-methodology §7), and get an explicit go-ahead:

   | Tier | What runs | Approx. agents | Honest cost note |
   |---|---|---|---|
   | `quick` | Top-failure dimensions, one pass | ~8–10 | Triage only. Catches the auto-fail classes; says nothing about the rest — never present its output as review readiness |
   | `standard` | All applicable dimensions, one pass | ~20–30 | The default. Each finder reads tens of files; expect millions of tokens and an hour-plus of wall clock on a real codebase |
   | `exhaustive` | Multi-pass per audit-methodology §6 until two consecutive dry passes | ~50–80 across passes | Several times `standard`; spread across work sessions — the ledger makes resumption incremental |

   The verify fan-out scales with what the finders find, so a target-rich
   codebase costs more at every tier — report the live agent count as the run
   progresses. **Do not run `exhaustive` on a first pass.** A never-audited
   codebase yields its first batch of critical/high findings to `standard`;
   burning the multi-pass budget before those are fixed pays verifiers to
   re-walk code that is about to change. Field sequence that works: `standard`
   → fix → re-run (step 8) → `exhaustive` once the ledger is quiet.

3. **Resolve the target map** (audit-methodology §1.3). Select dimensions per
   the §1.2 applicability matrix × the manifest × the pass band (§6) — every
   inapplicable dimension gets an explicit `na_reason`, never a silent skip.
   Then run each applicable dimension's detection heuristics (§3 of its file)
   against the real repo and write
   `<target>/.security-review/target-map.json`. Three rules with teeth:

   - **Show the map to the user BEFORE any agent launches.** This is the one
     cheap moment to correct course — let them edit paths, add the module the
     heuristics missed, or veto a dimension. A wrong target map silently
     audits the wrong code for the entire run.
   - **`applicable: true` with no targets = `unresolved: true`**, surfaced as
     "couldn't map dimension X — point me at the code or confirm N/A." A
     skipped dimension is false coverage, worse than no audit.
   - **Exclude generated and vendored code from targets**: `node_modules/`,
     `vendor/`, `dist/`, `build/`, virtualenvs, minified bundles, lockfiles,
     generated API clients and protobuf stubs. Finders that wade into
     third-party or machine-written code burn their context on findings the
     partner cannot act on — defects in dependencies are the dependency
     scanner's job (`/sf-security-review-toolkit:run-scans`, baseline:
     `scan-dependency-vulnerabilities`), and for generated code the right
     target is the generator's template, not its output. One exception:
     committed credential material is in scope wherever it lives — a real key
     in a vendored config is still a finding.

   `stack_notes` carries the partner's *claimed* security model, labeled as
   claims — the single most productive finder instruction in the field runs
   was "verify the claimed model against the actual code, do not assume it."

4. **Compile the ledger digest** from
   `<target>/.security-review/audit-ledger.json`: one line per entry,
   `[state] title — file (one-line resolution or refute reason)` (§5.3).
   First run: empty digest is fine. Include `refuted` entries (they stop
   finders re-raising the same non-issue) and `fixed` entries (re-report only
   if regressed). Skipping the digest is the expensive mistake: every pass
   re-discovers the same top findings and pays the verify fan-out for them
   again. Never let an LLM rewrite ledger entries — the merge is mechanical
   (step 6) or the dedup keys corrupt.

5. **Run the engine.** Preferred substrate: the Workflow tool with
   `${CLAUDE_PLUGIN_ROOT}/harness/workflow-template.mjs`. The invocation, per
   its header: extract each selected dimension's threat-focus paragraph from
   the §4 finder prompt block of its dimension file, build the run-args
   object, and JSON-serialize it. For each dimension extract TWO blocks: the
   threat-focus paragraph (the `finderPrompt`) AND the Verifier-guidance +
   false-positive-patterns block (the `verifierNotes`). **Both are
   load-bearing.** The verifier only sees the generic skepticism prompt unless
   you pass `verifierNotes`; without the dimension's own refute rules it
   over-refutes declaration-level metadata violations (an exposed message
   channel, an `http://`/wildcard trusted host, `position:absolute` in component
   CSS, an unenclosed prompt template) on a "no live caller / dead-code
   artifact" rationale the Salesforce static review — which flags whatever the
   package SHIPS — does not apply.

   **Then — unconditionally — inject it and run a project-local copy:**

   1. Copy the template into the target repo:
      `cp ${CLAUDE_PLUGIN_ROOT}/harness/workflow-template.mjs <target>/.security-review/audit-engine.mjs`.
      (A copy, never the installed plugin file: the plugin is read-only/shared,
      and a project-local copy keeps the exact run reproducible and committable.)
   2. In that copy, **replace** the marked `const INJECTED = /* {{ARGS_OBJECT}} */ null`
      line so `INJECTED` is your JSON run-args object (JSON is valid JS — paste
      it raw as the value).
   3. Invoke the Workflow tool with `scriptPath` pointing at the copy.

   **Do NOT pass the run-args through the Workflow tool's `args` parameter.** In
   practice they arrive as a JSON *string*, so `args.repoRoot` is undefined, the
   template falls through to its `null` placeholder, and the run fails fast with
   *"run args missing or incomplete"* (0 agents, ~20ms). The `args`-binding
   branch in the template (`args && args.repoRoot ? args : INJECTED`) is only a
   safety net — injecting `INJECTED` is the load-bearing path, every time.

   **`node --check` caveat:** if you sanity-check the assembled script, know that
   `node --check` reports the template's top-level `return {…}` as
   `SyntaxError: Illegal return statement`. That is **expected** — the Workflow
   runtime wraps the script body in an async function scope where top-level
   `return` is legal. **Do not "fix" it** by removing, wrapping, or `export`-ing
   the `return`; that breaks how the script hands results back. If you want a
   pre-launch check, validate only that the injected `INJECTED` object parses as
   JSON (`JSON.parse` the slice between `const INJECTED = ` and the next `const`),
   not that the whole module passes `node --check`.

   The run-args shape:

   ```jsonc
   {
     "repoRoot": "/abs/path/to/partner/repo",
     "scopeManifestPath": "/abs/path/to/partner/repo/.security-review/scope-manifest.json",
     "tier": "standard",
     "passNumber": 1,
     "runDate": "YYYY-MM-DD",          // pass it in — the runtime restricts Date.now()
     "reportPath": "/abs/path/to/partner/repo/docs/security-review/audit-report-YYYY-MM-DD-pass1.md",
     "ledger": "<the step-4 digest, or '' on a first pass>",
     "context": {                       // assembled FROM THE SCOPE MANIFEST
       "productOneLiner": "...",
       "reviewSurfaces": "...",         // what the review pen-tests
       "stackSummary": "...",
       "securityModelClaims": "..."     // labeled as claims — finders verify, never assume
     },
     "dimensions": [
       { "key": "tenant-isolation",
         "targets": "src/db/policies.py\nsrc/api/deps.py",
         "stackNotes": "<per-dimension repo facts from the adapter>",
         "verifierNotes": "<the dimension file's Verifier-guidance + false-positive-patterns block, verbatim — the verifier's refute rules>",
         "finderPrompt": "<the dimension file's §4 threat-focus paragraph, verbatim>" }
     ]
   }
   ```

   Without the Workflow tool, degrade to
   `${CLAUDE_PLUGIN_ROOT}/harness/sequential-fallback.md`: same prompts, same
   schemas, one dimension at a time with every stage persisted under
   `.security-review/pass-<N>/` before the next starts, verifiers in small
   parallel batches, schema enforcement by instruct-validate-retry, resume
   from the last persisted dimension. Token cost is comparable; wall clock
   roughly doubles — say so when offering it. The non-negotiables that survive
   either substrate: read-only finder/verifier agents (the audit never mutates
   the repo it audits), fresh-context verifiers that never see the finder's
   reasoning, and **findings that skip verification are never reported**
   (§3.3) — a verifier that fails twice sends its finding to the run log as
   `unverified — re-run`, not to the report.

6. **Merge mechanically; let synthesis write the report.** The synthesis agent
   writes `<target>/docs/security-review/audit-report-<date>-pass<N>.md` from
   confirmed/partial findings only, with the §9 contract: (1) executive
   summary — blocking vs hardening, stated plainly, and headed by the
   deterministic cluster view (`node ${CLAUDE_PLUGIN_ROOT}/harness/finding-clusters.mjs
   --target <target> --json`): report the raw confirmed counts AND the distinct
   affected files / file-level critical-high / cross-dimension-overlap headline,
   so the per-dimension fan-out re-finding one root cause under several lenses is
   never presented as that many distinct problems; (2) prioritized findings
   table sorted by the verifier's `adjusted_severity` (the finder's severity
   is provenance only); (3) a short, concrete remediation plan per
   critical/high finding; (4) **strong controls observed** — written for reuse
   in the reviewer-facing artifacts; (5) **coverage and residual risk** —
   which dimensions ran, which were N/A and why, which were unresolved, and
   the white-box-static caveat (a report without this section is dishonest by
   omission); (6) readiness-tracker mapping. Then engine code — you, working
   the rote procedure, never an LLM agent — merges verdicts into the ledger:
   dedup id = first 16 hex chars of SHA-256 over the normalized file path +
   `\n` + normalized title (exact normalization in
   `${CLAUDE_PLUGIN_ROOT}/templates/audit-ledger.schema.json` — never the
   description, never line numbers); `confirmed_real`/`partially_real` →
   `confirmed`, `false_positive` → `refuted`; a candidate matching a `fixed`
   entry's key flips it back to `confirmed` with `regression: true`. Redact
   any credential value captured in an evidence snippet (`***redacted***`)
   before writing anything (CONVENTIONS §6), append the pass entry to
   `.security-review/run-log.md`, and surface the unverified list. **Stamp the
   pass object's `audited_commit` with `git -C <target> rev-parse HEAD`** — the
   resumption fingerprint. Without it a later resume cannot tell whether the code
   behind a finding moved since the audit (step 7 / `harness/ledger-staleness.mjs`).

7. **Gate and route.** Open `critical`/`high` findings halt the journey: fix
   before `/sf-security-review-toolkit:generate-artifacts`, because the
   AuthN/AuthZ artifact would otherwise document the vulnerable flow.
   Quiet ledger → proceed. Two phrasings are banned everywhere — "secure" and
   "clean": a dry pass means *this method found nothing new within the audited
   dimensions*, never that nothing is there. Verification bounds false
   positives; nothing here bounds false negatives except dimension coverage
   and more passes (§11).

8. **The re-run loop** — how fixes become a quiet ledger:

   1. The partner fixes a finding. Mark the ledger entry `fixed` with a
      `fix_commit` only after verifying the fix actually landed in the code —
      never on the partner's word alone (CONVENTIONS §2). A real defect the
      partner chooses not to fix becomes `accepted_risk` with a written
      justification and a named owner — that is an owner decision, never
      agent-made.
   2. Re-run **dirty dimensions only**: the dimensions whose entries changed
      state since the last pass, plus any dimension whose target files moved
      per `git diff`. Same tier, same prompts, full digest — the finders
      re-probe the fixed paths (regression check) and the adjacent code the
      fix may have disturbed, while the digest keeps everything else quiet.
      This is what makes pass N+1 a fraction of pass 1's cost.
   3. Escalate to `exhaustive` only now, if the submission warrants it, and
      run until the §6 stop rule: two consecutive dry passes, the second a
      full-band pass — one dry pass may only mean the band missed where the
      bugs live.

## Automated vs. manual recap

Automated: manifest staleness check, dimension selection, target-map
resolution, the find → verify → synthesize fan-out, the mechanical ledger
merge, report and run-log writing. Manual: tier choice, target-map
confirmation and pruning, every remediation, the `fixed`/`accepted_risk`
dispositions, and the judgment call on what a finding means for the business.
The run recap states which dimensions ran, candidates vs confirmed vs refuted
vs unverified counts, and what was NOT covered: packaged Apex CRUD/FLS belongs
to Code Analyzer, dynamic behavior belongs to DAST, and this was white-box
static review by LLM agents — Salesforce pen-tests the surface regardless.

## What feeds the next skill

The report's "strong controls observed" section is mined by
`/sf-security-review-toolkit:generate-artifacts` for the controls narrative;
the ledger gates `/sf-security-review-toolkit:compile-submission` (zero
undispositioned critical/high, and the readiness verdict records which tier
and how many passes produced it); refuted entries' verifier reasoning
pre-classifies scanner false positives for the dossier in
`/sf-security-review-toolkit:run-scans`.

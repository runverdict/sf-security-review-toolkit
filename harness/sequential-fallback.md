# Sequential Fallback — the audit engine without the Workflow tool

The same engine `${CLAUDE_PLUGIN_ROOT}/harness/workflow-template.mjs` implements,
executed with plain subagent (Task/Agent) calls. Workflow-tool availability
varies by environment; the method must not. Read this together with
`${CLAUDE_PLUGIN_ROOT}/methodology/audit-methodology.md` — every rule there
(schemas, severity, ledger, §3.3) binds here unchanged.

**The honest trade-off:** sequential runs are slower (no find/verify overlap, no
wide fan-out — wall clock roughly doubles on a real codebase) and put more load
on the orchestrating agent's context (it carries every intermediate result
unless it persists aggressively — so it persists aggressively, see §3). Token
cost is comparable; rigor is identical. What you must NOT do is "save time" by
letting one agent find and verify in the same context — a verifier that
marinated in the finder's argument confirms it. The substrate changes; the
method does not.

## 1. What does not degrade (non-negotiables)

- **Same prompts, same schemas, same shared context.** Assemble the exact
  strings `workflow-template.mjs` builds: the slotted shared-context template,
  the finder prompt (targets → stack notes → threat focus → ledger digest →
  conduct rules), the verifier prompt (refute-first framing, RFC 8252 example,
  the gating-code instruction). Do not paraphrase them — the wording is
  field-tuned; "improved" phrasings are how verifiers drift agreeable.
- **Verifier independence.** Each verifier is a fresh subagent that receives
  the finding and the shared context — never the finder's transcript, never
  your own commentary on whether the finding looks plausible.
- **Findings that skip verification are never reported** (§3.3). A verifier
  that fails twice sends its finding to `_unverified.json` and the run log,
  not to the report and not to the ledger as confirmed.
- **Read-only finder/verifier subagents.** The audit never mutates the repo it
  audits. Only the orchestrator writes — and only under
  `<target>/.security-review/` and the report path.
- **The ledger merge stays mechanical.** The orchestrator merges verdicts by
  dedup key (normalized file + normalized title, §5.2) as a rote procedure —
  no subagent, no judgment, no rewording of entries. It runs the SAME
  `${CLAUDE_PLUGIN_ROOT}/harness/merge-ledger.mjs` engine the Workflow substrate
  uses; point `--result` at the synthesized result file DIRECTLY — the engine
  accepts BOTH shapes (a raw `{result:{ledger_updates:[...]}}` envelope and a
  pre-extracted `{ledger_updates:[...]}`, unwrapping `.result` at
  `merge-ledger.mjs:59`), so do NOT hand-extract `.result` or re-parse it.
- **The recorded consent gate (`audit-tier` + `audit-targetmap`).** The fallback
  asks Step 2/3 via `AskUserQuestion`, records each affirmative via
  `record-consent.mjs`, and `verifyConsent`'s both — FAILING CLOSED (no finder Task)
  if either is missing — exactly as `build-audit-engine.mjs` does on the Workflow
  path (§3 step 1). Consent does not degrade with the substrate.

## 2. State layout (persistence is the resume mechanism)

A sequential run is long; an interrupted run that persisted nothing is a total
loss. Write every stage's output to disk the moment it exists:

```
<target>/.security-review/
├── pass-<N>/
│   ├── args.json                    # the assembled run args (workflow-template.mjs header shape)
│   ├── <dimension>.findings.json    # finder output, persisted BEFORE verification starts
│   ├── <dimension>.verdicts.json    # the dimension's verified findings
│   └── _unverified.json             # §3.3 casualties, appended as they happen
├── audit-ledger.json                # merged after synthesis (mechanical)
└── run-log.md                       # appended after synthesis
```

No secrets in any of these files (CONVENTIONS §6): if a finding's evidence
snippet captured a credential value, redact it (`***redacted***`) at persist
time, not at report time.

## 3. Execution recipe

1. **Build the run args** exactly as the `workflow-template.mjs` header
   documents (scope manifest → dimension selection → stack-adapter target
   resolution → ledger digest → context slots). Write `pass-<N>/args.json`.

   **THE CONSENT GATE BINDS HERE TOO.** The sequential fallback never calls
   `build-audit-engine.mjs`, so it must run the SAME `record-consent` gate itself —
   consent must not be skippable just because the Workflow tool is unavailable.
   Before the first finder Task:
   - **Step 2 (tier go-ahead) and Step 3 (show the target map) are MANDATORY
     `AskUserQuestion` stops**, never silence-is-yes inputs. Show the resolved target
     map, ask for the tier + go-ahead and the map approval, and RECORD each affirmative with
     the controlled `--decision` token (the operator's SELECTION IS the consent — do NOT rely
     on the option label containing "yes"; use `--decision deny` if they declined):
     `node ${CLAUDE_PLUGIN_ROOT}/harness/record-consent.mjs --gate audit-tier --decision affirm --question "<tier + go-ahead>" --answer "<the option they picked>" --target <target>`
     `node ${CLAUDE_PLUGIN_ROOT}/harness/record-consent.mjs --gate audit-targetmap --decision affirm --question "<map approval>" --answer "<the option they picked>" --target <target>`
   - **Then verifyConsent and FAIL CLOSED.** Run
     `node ${CLAUDE_PLUGIN_ROOT}/harness/record-consent.mjs --verify --gate audit-tier --target <target>`
     and the same for `audit-targetmap`; if EITHER exits non-zero (NOT CONSENTED),
     **launch NO finder Task — the audit does not start.** This is the exact gate
     `build-audit-engine.mjs` enforces on the Workflow path; the method must not depend
     on the substrate.

2. **Per dimension, one at a time** — find, verify, persist, then move on:

   a. **Find.** Launch ONE read-only finder subagent with the assembled finder
      prompt plus the schema-enforcement block (§4 below). Subagent output =
      the JSON object, nothing else.

   b. **Validate mechanically** (you, not another agent): parse the JSON;
      check `findings` is an array; check every item carries all seven
      required keys with valid enum values. On failure, re-prompt the same
      subagent once with the specific validation error. On a second failure,
      record the dimension as `failed — re-run` in the run log and continue to
      the next dimension; never hand-repair a finder's JSON into findings it
      didn't quite make.

   c. **Persist `<dimension>.findings.json`** before any verifier launches. An
      empty `findings` array is a valid result — persist it too (it is what
      marks the dimension complete on resume).

   d. **Verify.** One fresh subagent per finding with the verifier prompt.
      Where the environment can launch several subagents in one message, run
      verifiers in small parallel batches (3–5) — they are independent by
      design, so batching is safe; going wider than that just makes the
      failure-retry bookkeeping error-prone in a hand-orchestrated run.
      Validate each verdict against VERDICT_SCHEMA the same way: re-prompt
      once, then `_unverified.json`.

   e. **Persist `<dimension>.verdicts.json`.** Only now start the next
      dimension. This per-dimension checkpoint is what makes interruption
      cheap.

3. **Barrier.** All selected dimensions have a `verdicts.json` (or a recorded
   failure). Compute the buckets: confirmed (`confirmed_real` +
   `partially_real`), refuted (`false_positive`), unverified.

4. **Synthesize.** One subagent, fed only the confirmed/partial findings read
   back from disk, writes `docs/security-review/audit-report-<date>-pass<N>.md`
   per the §9 report contract — including the coverage-and-residual-risk
   section naming which dimensions ran, that this was static review by LLM
   agents (not DAST, not a pen test), and that verification bounds false
   positives, not false negatives.

5. **Merge the ledger mechanically** (§5: dedup key = normalized file +
   normalized title; confirmed_real/partially_real → `confirmed`,
   false_positive → `refuted`; a new candidate matching a `fixed` entry flips
   it back to `confirmed` with a regression marker). Append the run-log entry:
   pass number, tier, dimensions run, candidates/confirmed/refuted/unverified
   counts, report path.

## 4. Schema enforcement without a harness

The Workflow tool enforces structured output; here it degrades to
instruct-validate-retry. Append this block to every finder prompt (and the
VERDICT_SCHEMA equivalent to every verifier prompt):

```
Return ONLY a JSON object matching this schema — no prose before or after, no
markdown fences, no commentary:
<the FINDING_SCHEMA / VERDICT_SCHEMA JSON, verbatim from workflow-template.mjs>
An empty findings array is a valid result — do not invent findings.
```

Validation checklist per response: (1) parses as JSON; (2) required keys all
present; (3) `severity` / `confidence` / `verdict` / `adjusted_severity` values
are in their enums; (4) `file` is non-empty. Anything else in the response —
fences, preamble, trailing notes — strip only if the JSON inside is intact;
otherwise it counts as a validation failure. One retry with the specific
error, then the §3.3 path.

## 5. Resume protocol

On resume (interrupted run, new session, context exhaustion):

| `pass-<N>/` state | Resume at |
|---|---|
| no `args.json` | the beginning — rebuild args, re-show the target map, and re-run the consent gate (`verifyConsent` `audit-tier` + `audit-targetmap`; re-ask + re-record if either is NOT CONSENTED) before any finder Task |
| `args.json` only | dimension 1 find |
| `<dim>.findings.json` without `<dim>.verdicts.json` | that dimension's verification, finding by finding |
| every dimension has `verdicts.json` | synthesis |
| report exists, ledger not merged | the mechanical merge |

Trust the persisted files over memory of the conversation — they are the run's
ground truth. If `args.json` is older than the repo's latest commits by enough
that targets may have moved, re-run the stack-adapter step before resuming the
find stage rather than auditing stale paths.

## 6. Reporting the run honestly

Same recap obligations as the workflow substrate (CONVENTIONS §2): which
dimensions ran, candidate/confirmed/refuted/unverified counts, what remains
owner-run. Name the substrate in the run log (`substrate: sequential`) — a
future re-audit should know whether find/verify overlap existed when comparing
wall-clock or interpreting partial state.

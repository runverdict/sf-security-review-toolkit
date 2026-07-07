---
name: prepare-test-environment
description: Phase 4 of security review prep. Guided runbooks for the reviewer-facing test environment — the review org, the configured agent with Topics and a validated utterance list (MCP listings), two test users with a bidirectional authorization proof, the isolated external test tenant, and the end-to-end self-test that makes "un-testable environment" bounces impossible. Use after scans; the environment must stay alive through the whole review window.
allowed-tools: Read Write Edit Bash(sf *) Bash(curl *) Bash(ls *) Bash(cat *) AskUserQuestion
---

# Prepare Test Environment

Build and validate the environment the reviewer actually logs into. This is
the guided-manual phase: org provisioning, agent wiring, and account
creation are operator actions no tool can perform — but the generation work
(utterance lists, probe scripts, runbook drafts) and the validation pass are
automatable, and the validation pass is the entire point. An un-testable
environment is a pure process failure that bounces the submission without a
reviewer reading a line of code (baseline: `fail-untestable-environment`,
`process-prequeue-validation`) — and unlike a code finding, it is 100%
preventable from this side. Every step below encodes a way real submissions
bounce.

## When to use

- After `/sf-security-review-toolkit:run-scans` — the endpoints the reviewer
  attacks here are the ones the DAST evidence already covered, in the same
  production-mode configuration
- Re-validating before a re-review, after an org neared expiry, or after any
  change to the package, the agent, or the server's tool descriptions
- NOT for the partner's dev environment — this is the reviewer-facing one,
  isolated and never production (baseline: `testenv-external-test-instances`)
- NOT a substitute for the reviewer's own testing — Salesforce pen-tests the
  environment regardless of how thoroughly it was self-tested (baseline:
  `dast-salesforce-runs-own-pentest`)

## Prerequisites

- `<target>/.security-review/scope-manifest.json` (from
  `/sf-security-review-toolkit:scope-submission`) — which environment
  components apply. Missing? Offer to route there first; degraded mode walks
  every component and asks the operator which apply.
- The access-control artifact's persona definitions (from
  `/sf-security-review-toolkit:generate-artifacts`) — the test users
  instantiate them. Missing? The personas can be defined inline here, but
  record that the access-control artifact must be reconciled afterward.
- Partner Business Org / Environment Hub access for org creation (operator).
- `${CLAUDE_PLUGIN_ROOT}/baseline/requirements-baseline.yaml` readable.
- Credentials never enter files this skill writes — locations and labels
  only (CONVENTIONS §6).

## The six components

| Component | Applies when (manifest) | Blocking gate(s) |
|---|---|---|
| 1. The review org | all | `testenv-developer-edition-default-settings`, `testenv-mfa-disabled-for-reviewers`, `artifact-org-credentials` |
| 2. Install + seeded data | all | `testenv-usage-documentation`, `testenv-realistic-test-data` |
| 3. The configured agent + utterance list | mcp-server | `artifact-testing-environment-agent-utterances` |
| 4. Two test users + authorization proof | all (a required artifact for mcp-server) | `testenv-test-personas-documented`, `artifact-third-party-creds-two-test-users` |
| 5. External test tenant + credential packaging | external-endpoint / mcp-server | `testenv-external-test-instances`, `artifact-mcp-server-details` |
| 6. Pre-submission self-test | all | `fail-untestable-environment` |

## Steps

1. **Read the manifest and the baseline; surface the conflicts before
   provisioning anything.** Select components from the manifest's elements
   (table above), matching element types through their canonical form
   (synonyms per `harness/render-detected-elements.mjs`'s
   `ELEMENT_TYPE_SYNONYMS` — a manifest typed `external-web-app` selects the
   `external-endpoint` rows). Warn when any `testenv-*`/`artifact-*` entry this run uses
   has `last_verified` older than 90 days (CONVENTIONS §4). Surface every
   `conflicting` entry with its `conflicts` text — never silently pick a
   side. As of the 2026-06 sweep, no entry this phase uses remains
   conflicting: the per-user question behind the two-user proof is fully
   settled — including the once-open identity-forwarding mechanics, settled
   NEGATIVELY (`mcp-per-user-authz-mechanics`, verified; see step 10).
   Formerly contested entries are now
   verified — read the current figures from `testenv-trialforce-org-lifespan`
   (how long the org lives) and `process-review-timeline` (how long it must
   live). Their combination is still the silent killer: an org that expires
   mid-review becomes un-testable with nobody watching.

2. **Provision the review org.** Developer Edition. Two routes:
   - *Program template route (MCP listings):* create the org from the
     Partner Business Org's Environment Hub using the Trialforce Template Id
     from the MCP Client Partner Technical Guide (login-gated; ask in the
     partner Slack MCP channel or via your Partner Account Manager). Never
     copy a template ID from a guide or a forum — it is partner-gated for a
     reason and the program's current ID is the only valid one.
   - *Plain DE signup:* where the manifest carries no template-org
     requirement.

   Whichever route, **check the org's actual expiry empirically** rather
   than trusting the documented lifespan — the baseline records the
   MCP-path Trialforce-templated org's lifespan (and that the Trialforce
   route is prescribed, not optional, for the MCP review path), but the org
   in front of you is the fact that matters (baseline:
   `testenv-trialforce-org-lifespan`):

   ```bash
   sf data query -o {REVIEW_ORG_ALIAS} -q "SELECT TrialExpirationDate, OrganizationType FROM Organization"
   ```

   Compare against the planning window in `process-review-timeline` (now
   verified — read the current total-from-complete-submission figure from
   the entry at run time, never from a week count quoted in prose).
   If expiry lands inside the window, calendar a re-provisioning date now
   and record it in the runbook. Then the org-state rules: default security
   settings unchanged (password policy, timeout, session settings), only
   review-relevant packages installed (baseline:
   `testenv-developer-edition-default-settings`), and the platform's
   component security / CSP enforcement NOT relaxed to make the app work —
   an app that needs them off will fail review anyway (baseline:
   `testenv-locker-csp-enabled`; the entry also carries the
   Locker-vs-Lightning-Web-Security terminology caveat — verify current
   setting names before quoting them to the operator).

3. **Start the MFA exemption case now — it is the longest-lead item in this
   phase.** Reviewer credentials must log in cleanly; an MFA prompt is an
   un-testable environment in one screen (baseline:
   `testenv-mfa-disabled-for-reviewers`). If org-wide MFA enforcement
   applies to the review org, the exemption path runs through a Salesforce
   Support case — and the baseline entry notes enforcement has been
   tightening platform-wide, so do not assume last year's exemption
   mechanics. Validation is empirical: log in with the reviewer-destined
   credentials from a clean browser profile (no cookies, no remembered
   device). An MFA prompt at validation time is the bounce caught early.

4. **Provision the isolated external test tenant — before the org-side
   install, because the install configuration points at it.** A dedicated
   tenant on the partner's own service, never production, and never a
   shared dev environment: a reviewer who screenshots another customer's
   record name into a finding has just created a second incident. For
   multi-tenant backends the fresh tenant is also part of the test surface —
   its isolation from every other tenant is exactly what the reviewer
   probes (baseline: `endpoint-multi-tenant-isolation`). Requirements that
   bite: production-equivalent build and hardening — the same deployment
   posture the DAST evidence covered, debug off, generic errors (baseline:
   `dast-endpoints-production-mode`; a softer test backend invalidates the
   scan evidence's relevance); credentials valid past the end of the
   planning window — a free-trial account that expires in 30 days is a
   time-bomb the reviewer discovers, not you (baseline:
   `testenv-external-test-instances`).

5. **Install and configure the solution by executing the partner's own
   post-install documentation — literally.** The reviewer follows the doc
   verbatim, so the validation is to do the same: someone who did not write
   the doc performs every step from a clean seat (baseline:
   `testenv-usage-documentation`). Every gap found is a bounce avoided. Two
   rules: fix discrepancies in the DOC, not just in the org — a correctly
   configured org with a wrong doc still bounces the *next* environment
   (re-reviews provision fresh); and record every Setup step performed
   outside the doc as a doc bug, because "I clicked something extra to make
   it work" is precisely the step the reviewer won't know to click.

6. **Create the two test users from the persona definitions.** Distinct
   personas at genuinely different permission tiers — different permission
   sets, different data scopes, not two admins with different names
   (baseline: `testenv-test-personas-documented`). For MCP listings the two
   differently-privileged users are themselves a required submission
   artifact (baseline: `artifact-third-party-creds-two-test-users`,
   blocker). Document per user: role/persona, permission assignments, what
   they can reach, what they must NOT be able to reach, and typical paths.
   If one of the two is intentionally all-seeing (an admin persona), write
   that down explicitly — step 10's proof reads differently for that
   topology and the reviewer should never have to guess which topology was
   intended.

7. **Seed realistic data — where "realistic" has a testable definition:
   every tool and every feature returns non-empty results for BOTH test
   users.** A tool that returns an empty list reads as a broken tool to a
   reviewer with no context, and an empty-state environment hides exactly
   the functionality under review (baseline: `testenv-realistic-test-data`).
   Seed every entity the solution touches, on both sides (org and external
   tenant), never with real customer data. Then the rule that makes step 10
   possible: **seed asymmetrically and attributably.** Each user owns
   records the other must not see, with record names that make ownership
   visible at a glance (e.g. a persona-prefixed naming scheme) — if both
   users see identical data, the authorization proof is vacuous, and if
   leaked records aren't visually attributable, a probe transcript proves
   nothing a reviewer can read. Document the data model and seeding
   approach; the agent drafts this from the seed scripts.

8. **Wire the agent (MCP listings).** Four sub-steps, each encoding a
   failure mode:
   - *Register the MCP server in the org.* "Active" status only means a
     Named Credential is associated — it is not evidence of a working
     connection; verify with a real handshake and a tools/list round-trip
     through the org (baseline: `mcp-registration-active-status-semantics`).
   - *Wire the tool actions.* They are generated at registration time and
     attached manually — they cannot ship in the package, which means they
     exist only in THIS org and must be re-wired after any re-provisioning
     (baseline: `mcp-tool-actions-not-packageable`). Put that on the
     re-provision checklist now.
   - *Build the agent in the supported builder.* The beta builder silently
     fails to route to MCP tools — no error, just an agent that never calls
     anything (baseline: `mcp-agent-builder-beta-unsupported`).
   - *Configure Topics, instructions, and THE forgotten step: the
     reasoning-engine setting,* per the partner-gated guidance. A
     default-engine agent silently fails to route — the review guidance
     calls this out explicitly because partners forget it (baseline:
     `artifact-testing-environment-agent-utterances`). Reference tools by
     API name, not label, in Topic instructions.

9. **Generate the example-utterance list from the live tools/list — then
   validate every utterance before a reviewer sees it.**
   *Generation:* pull the server's actual tools/list (the same capture the
   api-endpoints artifact uses — one source of truth) and emit, per tool
   family: one **happy-path** utterance (exercises the tool against seeded
   data, returns non-empty results) and one **authorization-boundary**
   utterance (asks for data the current user must NOT see — the expected
   result is a refusal or empty set, stated as such). Never draft utterances
   from documentation or memory of the tool surface; an utterance written
   against a stale tool name routes to nothing.
   *Structure the artifact for the reader:* a short preamble explaining how
   utterance → Topic classification → action selection → tool call works,
   so the reviewer can interpret a routing failure; then the utterance
   table (utterance · expected tool · expected result shape); tiered by
   privilege — read-tier utterances safe for the primary review pass listed
   first, write/admin-tier utterances flagged and grouped separately with
   the credentials they require; closing with a suggested reviewer
   quick-start order. Write it to
   `<target>/docs/security-review/agent-utterances.md`.
   *Validation:* validate every utterance HEADLESSLY with the `sf agent
   test` CLI (baseline: `testenv-agent-testing-center`) and capture the
   machine-readable results to `.security-review/evidence/utterance-validation/`
   — per-test-case pass/fail, expected-vs-actual topic, expected-vs-actual
   actions, evaluator scores, and duration, with the generated test-spec
   YAML deposited alongside. This replaces the old Testing Center /
   Agent Preview UI punt with reproducible evidence.
   *Author the test-spec YAML first (local, no org op).* From the
   already-generated `agent-utterances.md`, hand-map each utterance →
   expected topic → expected action(s) → expected outcome into a test-spec
   YAML. Seed it with `sf agent generate test-spec --output-file
   specs/<AGENT>-testSpec.yaml` (add `--force-overwrite` to replace; pick
   the runner with `--test-runner testing-center` for the legacy
   `AiEvaluationDefinition` or `--test-runner agentforce-studio` for the
   NGT `AiTestingDefinition`), or derive it from an existing definition
   with `sf agent generate test-spec --from-definition <meta XML>`. Note
   plainly: `generate test-spec` is INTERACTIVE and reads the DX-project
   METADATA (not the live tools/list), so the spec is authored from
   `agent-utterances.md` by hand (or via `--from-definition`), NOT
   auto-generated from the live tools/list — one clean autonomous call
   does not exist here.
   *Path A — PRIMARY, residue-free (spec-direct via the Einstein Eval
   API):* `sf agent test run-eval --spec specs/<AGENT>-testSpec.yaml
   --result-format json` — the agent is inferred from the spec's
   `subjectName` (override with `--api-name <DeveloperName>`); it supports
   8+ evaluator types including **subagent-routing assertions** and
   **action-invocation checks** — exactly the routing/authz evidence this
   step needs — and deposits NO metadata in the review org. `run-eval` has
   NO `--output-dir` flag; it prints to stdout, so capture it by redirect:
   `sf agent test run-eval --spec specs/<AGENT>-testSpec.yaml
   --result-format json > .security-review/evidence/utterance-validation/<AGENT>-run-eval.json`.
   Requires the Einstein Eval API enabled in the org; optional
   `--batch-size <=5`, `--no-normalize`.
   *Path B — DURABLE ARTIFACT (a reusable `AiEvaluationDefinition` the
   reviewer can re-run):* `sf agent test create --spec
   specs/<AGENT>-testSpec.yaml --api-name <NEW_NAME>` then `sf agent test
   run --api-name <NEW_NAME> --wait <minutes> --result-format json
   --output-dir .security-review/evidence/utterance-validation/`. Here
   `agent test create` DEPLOYS an `AiEvaluationDefinition` (a metadata
   mutation) into the review org — `--api-name` must NOT already exist
   (`--test-runner agentforce-studio` for NGT; `--preview` to build
   without deploying; `--force-overwrite` to replace) — and `agent test
   run --wait <min>` blocks for the run and writes the JSON results to
   disk. Re-fetch later with `sf agent test results --use-most-recent
   --result-format json --output-dir .security-review/evidence/utterance-validation/`
   (or `--job-id <id>`).
   *Trade-off (both genuine, neither a false friend):* Path A is richer
   (8+ evaluators, subagent-routing + action-invocation) and residue-free
   but needs the Einstein Eval API; Path B leaves a reusable
   `AiEvaluationDefinition` the reviewer can re-run but MUTATES the review
   org. Pick per what the org has enabled and whether a durable artifact
   is wanted.
   *Live-leg boundary:* `agent test create` / `run` / `run-eval` require a
   real ACTIVATED + PUBLISHED agent in the review org — without one they
   error `No published version found for agent` / `No agent found with
   DeveloperName`. All of `create` / `run` / `run-eval` stay
   OWNER-executed against the live review org and are cold-run-validated,
   exactly as the throwaway scratch-org stand-up keeps `sf org create
   scratch` operator-cold. The toolkit's buildable-now surface is this
   runbook plus the deterministic argv-builder + JSON→evidence normalizer
   in `harness/normalize-agent-test.mjs`.
   The driver folds this evidence into the index via `build-evidence-index.mjs`:
   the spec-YAML alone ⇒ `pending-owner` (owner still has to run the live
   leg); the on-disk JSON result under
   `.security-review/evidence/utterance-validation/` ⇒ reviewer-reproducible
   and satisfied. The submitted list contains ONLY utterances that
   demonstrably produced successful tool calls — a routing-FAIL utterance
   is never credited as passing (enforced in code by
   `normalize-agent-test.mjs`, not just prose); an utterance that fails to
   route is an un-testable-environment bounce in slow motion. And a
   non-obvious invalidation rule: routing is classification over tool
   *descriptions*, so a server-side description edit can silently break a
   previously validated utterance — re-validate the full list after any
   tools/list change, not just after org changes.

10. **Run the bidirectional authorization probe and record the transcript.**
    This is the evidence behind the two-user requirement. The agent
    generates the probe script from the tool inventory plus step 7's
    persona-attributed data map; the operator runs it with both users'
    credentials. The matrix, per data-bearing tool family:

    | Probe | As user A | As user B |
    |---|---|---|
    | List-level | sees A's records, zero of B's | sees B's records, zero of A's |
    | Object-level (direct ID fetch of the OTHER user's record) | B's record ID → denied/empty | A's record ID → denied/empty |

    **Both directions, both levels, no shortcuts.** One-way checks pass by
    accident (if B is the all-seeing admin persona, B-sees-A's-data is
    by-design — which is why step 6 wrote the topology down). List-level
    checks alone miss the classic leak: list filtering correct while a
    direct-ID fetch returns the other user's object. Where the architecture
    allows it, run the probe at two layers — through the agent (utterances)
    AND directly against the MCP/API surface with each user's identity —
    because an agent that politely declines to ask for other-user data can
    mask an API that would happily return it. Record the full transcript
    (request, acting identity, response) to
    `.security-review/evidence/two-user-probe/`, alongside the
    expected-results matrix.
    **State the settled identity model honestly in the artifact** — the
    purpose AND the mechanics are now fully settled (baseline:
    `mcp-per-user-authz-mechanics`, verified): per-user auth is NOT
    supported by the Agentforce MCP client — platform connection auth is
    org-level (No-Auth, client_credentials, or the ~2026-03 Authorization
    Code option, which is service-account only; transport modes per
    `mcp-auth-no-auth-or-client-credentials`) — and NO end-user identity is
    forwarded to the MCP server at tool-call time. Per-end-user enforcement
    at the MCP layer is platform-impossible today (roadmapped post-GA, no
    committed date), so say so plainly rather than implying otherwise.
    Write what the proof actually demonstrates, layer by layer: through
    Agentforce, the differential behavior between the two users comes from
    SALESFORCE-side gating (permission sets, agent access, tool access per
    user) on top of the partner's TENANT-level scoping; per-user data
    scoping is provable only at the partner's own API layer, where each
    user's own identity binds (the direct-probe half above — which is why
    the two-layer probe is not optional). Never claim per-end-user MCP
    enforcement in the artifact — the reviewer can falsify that in one
    probe — and name the mechanism that binds requests to the tenant so
    the reviewer isn't left to reverse-engineer it.

11. **Package the credentials — into the submission, never into the repo.**
    What the submission carries: the review org's URL/username/password
    (baseline: `artifact-org-credentials`), the MCP endpoint list, protocol
    version, and credentials for every authenticated external component
    (baseline: `artifact-mcp-server-details`), and the two test users plus
    third-party service credentials (baseline:
    `artifact-third-party-creds-two-test-users`). Where they go: the
    submission's credential fields in the Partner Console wizard — and
    nowhere else. Not in `docs/security-review/`, not in
    `.security-review/`, not in the runbook, not in git history. This skill
    refuses to write credential values into any file and records *locations
    and labels only* (CONVENTIONS §6); the runbook says "org admin
    credential — in the submission wizard" and stops there. Two operational
    rules: validate every credential the day of submission (step 12 may
    have run a week earlier — tokens and trial accounts rot), and plan the
    post-review rotation now, because credentials handed to a third party
    are spent the moment the review ends.

12. **The pre-submission self-test: walk every artifact-promised flow
    end-to-end, as each test user.** The closing gate, and the reason this
    phase exists: if the reviewer can't complete testing, the review stalls
    regardless of code quality. From a clean browser profile, per user: log
    in (no MFA prompt), follow the usage documentation to every major
    feature, fire every utterance in the submitted list, touch every
    external component with its submitted credentials. Cross-check against
    the submitted artifacts — every flow the architecture and usage docs
    promise must be demonstrable in THIS org, because the reviewer reads
    those documents as a test plan. Then write the runbook to
    `<target>/docs/security-review/test-environment.md`: org identifiers
    (never credentials), configuration steps performed, personas and their
    scopes, pointers to the utterance list and probe evidence, validation
    results with dates, org/credential expiry dates, and the re-provision
    checklist (including step 8's manual tool-action re-wiring). Append a
    dated entry to `.security-review/run-log.md` listing what was validated
    and what remains owner-attested. Set a re-validation date before the
    expected review-window end.

## Failure modes that cost a review cycle

| Failure | Why it bites | Guard |
|---|---|---|
| Org expires mid-review | The org lifespan and the review window are the same order of magnitude; expiry produces an un-testable environment with nobody watching | Step 2's empirical expiry query vs the planning window; calendared re-provision (baseline: `testenv-trialforce-org-lifespan`, `process-review-timeline` — both verified; read the current figures from the entries) |
| MFA prompt on reviewer login | Bounces at first contact; the exemption case has the longest lead time in the phase | Step 3 starts the case first; clean-profile login validation (baseline: `testenv-mfa-disabled-for-reviewers`) |
| Default-reasoning-engine agent | Silently fails to route utterances to MCP tools — looks configured, never works | Step 8's explicit engine setting; step 9's per-utterance validation catches it end-to-end |
| Utterances drafted from docs, not tools/list | Route to nothing when the live tool surface drifted | Generate from the live capture; validate every utterance; re-validate after any description change |
| Empty results for a test user | A tool returning nothing reads as broken; the feature under review goes untested | Step 7's definition of realistic: non-empty for BOTH users, every tool |
| Symmetric seed data | Both users see the same records — the authorization proof proves nothing | Asymmetric, persona-attributed seeding (step 7) |
| One-direction or list-only probe | Passes by accident (admin sees all by design); direct-ID IDOR leak missed entirely | Step 10's full matrix: both directions, list AND object level, transcript recorded |
| Credentials in the repo or runbook | A leaked credential file in a security review submission is its own finding | This skill writes locations only; values go in the submission wizard (CONVENTIONS §6) |
| Environment validated once, submitted weeks later | Tokens expire, trial accounts rot, orgs age — validation evidence goes stale silently | Day-of-submission credential check (step 11); re-validation date (step 12) |

## Automated vs. manual recap

**Automated:** manifest/baseline reading and conflict surfacing, org expiry
and settings queries via the CLI where credentials allow, utterance-list
generation from the live tools/list, validation-CSV generation, the
two-user probe script and expected-results matrix, direct API-layer probe
execution where credentials are env-supplied, seeding-approach and runbook
drafting, evidence-file verification, run-log entries.
**Owner-run:** org creation in Environment Hub, the MFA exemption case,
package install and configuration, the clean-seat documentation walkthrough,
user and tenant creation, agent + Topics + reasoning-engine wiring and
tool-action attachment, executing the utterance batch in the org UI,
running the probe as each user, placing credentials in the submission
wizard, and the final end-to-end self-test. The recap distinguishes every
component *validated* (evidence on disk) from every component only
*documented* — and Salesforce tests the environment with its own hands
regardless.

## What feeds the next skill

`test-environment.md`, `agent-utterances.md`, and the probe/validation
evidence feed the checklist rows and the pre-submission validation in
`/sf-security-review-toolkit:compile-submission` (which re-verifies
credential liveness and demotes any environment row lacking evidence). The
environment must then stay alive — `/sf-security-review-toolkit:stay-listed`
schedules the liveness checks and re-provision reminders (baseline:
`post-test-environment-liveness`), and the re-provision checklist written
in step 12 is what makes that re-provisioning a runbook instead of an
archaeology dig.

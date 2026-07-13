---
name: audit-deployed-package
description: The opt-in deep audit of the INSTALLED package, run against the throwaway org it was installed into — the thin dynamic pass that previews what the Salesforce reviewer actually does (install your package, then test it). Verifies the subscriber-effective permission grants (including the install-time UEC grant drop), the post-install handler's real granted scope, Code Analyzer Graph Engine CRUD/FLS data-flow on the installed source, that Named/External-Credential callouts resolve with org-entered secrets, and install + uninstall integrity. Use only after sf is authed and /sf-security-review-toolkit:install-and-verify-package has stood the package up in a clean org. Augments — never replaces — the source audit-codebase pass.
allowed-tools: Bash(sf *) Bash(export SF_AUTOUPDATE_DISABLE=true SF_DISABLE_AUTOUPDATE=true) Bash(node *harness/record-consent.mjs *) Bash(node *harness/agent-trace-probe.mjs *) Read Write Grep AskUserQuestion
---

# Audit Deployed Package

Audit the package the way the reviewer audits it: as an **installed artifact in a
real org**, not as source on disk. Source reading cannot see what install-time
behavior does to the grants a subscriber actually receives, whether the
post-install handler grants *more* than the packaged permission sets define,
whether the data-flow engine flags CRUD/FLS on the compiled package, whether the
callouts resolve against org-entered secrets, or whether **uninstall** leaves the
org clean — and every one of those is a thing the Salesforce reviewer installs your
package to check. This skill runs that pass and folds its findings into the same
ledger the source audit feeds (`.security-review/audit-ledger.json`), under the
`deployed-package` dimension, with evidence under
`.security-review/evidence/deployed-package/`.

**Honesty boundary, restated up front (CONVENTIONS §2):** this is *dynamic
verification in a throwaway org* — a **complementary lens** to static source
reading, not a stronger one: it previews the reviewer's own install-into-their-org
test by really installing and really querying the package, which source on disk
cannot do (source cannot verify install-time behavior). But it is still **not
Salesforce's own penetration test**. Salesforce's Product Security team installs your package and
tests the surface regardless of anything this pass finds. Nothing here ever earns
"will pass." The strongest thing it can say is "no known blockers in what this org
let us verify."

## When to use

- **AFTER** `/sf-security-review-toolkit:install-and-verify-package` has installed a
  **released** version into a **fresh** org and its verification battery is green —
  that skill solves the hard part (headless install past every SF quirk, the
  credential config, the permission-chain battery). This skill is the thin **security
  pass on top** of an org that is already standing.
- As the **opt-in deep-audit power-up** offered by
  `/sf-security-review-toolkit:security-review-journey` when `sf` is authed (or the
  operator opts to auth) — the journey spins a clean org, installs, runs this, then
  tears down. Never the always-on core.
- After a package **upgrade**, re-run it: the install-time grant drop and the
  uninstall residue both change shape across versions.

**NOT for:**

- **NOT a replacement for `/sf-security-review-toolkit:audit-codebase`.** That static
  pass reads the partner's *source* across every threat dimension and is the
  always-on core that runs on any repo with zero setup. This pass sees only what the
  *installed metadata + the live org* expose — a much narrower lens that catches a
  *different* class (install-time grant drift, handler escalation, post-install
  reality vs. packaged intent). Run both; this one **augments**, it does not stand in.
- **NOT the first audit.** If the ledger has no source-pass findings yet, you are
  auditing the deployed shape of code you have not statically reviewed — run
  `/sf-security-review-toolkit:audit-codebase` first so the deployed findings land
  *next to* the source findings, not instead of them.
- **NOT the always-on path.** It is CLI-gated and org-gated: no `sf` auth, no clean
  org, no installed package → it cannot run, and it says so rather than degrading into
  a static re-read (that is the other skill's job).
- **NOT Salesforce's pen test, and NOT DAST of the external endpoint.** Dynamic
  scanning of the live MCP/Canvas endpoint is `/sf-security-review-toolkit:run-scans`
  Family 3 (owner-run). This skill queries the *org*, not the *endpoint* — the one
  callout it fires (step 5) is an Apex smoke test to prove the credential chain
  resolves, not a scan.

## Prerequisites

- **`sf` authed to the install target org.** Run
  `/sf-security-review-toolkit:bootstrap-cli-auth` if not. You also need the DevHub
  alias if you intend to query `IsSecurityReviewed` (step 1) or per-class coverage.
- **A released `04t...` package version installed into a FRESH org** by
  `/sf-security-review-toolkit:install-and-verify-package` — its battery green. A
  contaminated org (one that has had MCP registrations created/deleted/renamed, or a
  prior version installed) is **not evidence**: that skill's trust rule applies here
  in full — runtime conclusions only count from a pristine install. If you cannot
  confirm the org is fresh, say so in the run notes and treat every "clean" result as
  unverified.
- **The package's component names on hand:** the namespace prefix, the packaged
  permission-set name(s), the External/Named Credential developer names, and the
  Platform Integration User pattern (`cloud@{orgId18}`). Pull them from the install
  step's output or the package source — a name-keyed query with a guessed name returns
  empty and **reads falsely as clean** (the teardown skill's trap, here too).
- **`.security-review/scope-manifest.json`** (from
  `/sf-security-review-toolkit:scope-submission`) so this pass knows the architecture
  — most importantly the **target API version** (the v67 user-mode awareness in step 3
  keys off it) and whether the listing carries a managed-package element at all. No
  manifest → run, but flag that the API-version-dependent triage in step 3 is running
  blind.
- **The audit ledger** at `.security-review/audit-ledger.json` (the schema is
  `${CLAUDE_PLUGIN_ROOT}/templates/audit-ledger.schema.json`). First run: an empty
  ledger is fine; this pass appends to it mechanically (step 6).
- Baseline currency: read the entries this pass leans on —
  `fail-crud-fls`, `fail-sharing-model`, `scan-sfge-crud-fls-dataflow`,
  `artifact-access-control-permsets`, `endpoint-named-credentials-callouts` — and warn
  if any `last_verified` is **`null` (unverified — found in web research only) OR older
  than 90 days** (CONVENTIONS §4). `endpoint-named-credentials-callouts` currently
  carries `last_verified: null`, so it trips the warning until it is primary-source
  confirmed — surface that caveat when this pass leans on its callout-credential
  posture. The v67 user-mode default lives in `fail-crud-fls`/`fail-sharing-model`; read
  it from the baseline, not from this prose.

## Steps

**Consent gate (fail-closed) — record before the uninstall step.** Most of this audit is
read-only SOQL/scan, but the install+uninstall-integrity step (step 7) runs
`sf package uninstall`, which mutates the throwaway org. Before that step, ask the operator
ONCE with `AskUserQuestion` (name the uninstall against the throwaway org), and on a yes
record it: `node ${CLAUDE_PLUGIN_ROOT}/harness/record-consent.mjs --gate sf-deep-audit-ops --answer "<operator's exact yes>" --target <repo>`.
The PreToolUse hook (`hooks/sf-ops-gate-hook.mjs`) is the fail-closed backstop: without that
recorded consent `sf package uninstall` is **DENIED**, so a skipped ask means the op is
denied, not silently run.

Every step writes its raw query/scan output to
`.security-review/evidence/deployed-package/<step>-<date>.json|html|txt` **before**
you interpret it — an interpreted result with no evidence file on disk is not a
finding (CONVENTIONS §2). Redact any secret value to `***redacted***` before writing
(CONVENTIONS §6); the queries below are designed to never *return* a secret, but the
Connect-API discovery in step 4 can echo principal coordinates — strip them.

Every Bash tool call runs in a **fresh shell** — an `export` never carries to the
next call — so the banner-disable flags must sit at the **top of every Bash block
that runs `sf`** in this skill, on their own line above the `sf` command. The CLI's
update-availability banner otherwise prints to stdout ahead of the JSON payload and
corrupts `--json` parsing. Prepend this line to each `sf` fence below:

```bash
export SF_AUTOUPDATE_DISABLE=true SF_DISABLE_AUTOUPDATE=true
```

1. **Confirm the org is fresh, the version is released, and the package is not already
   reviewed — before auditing anything.** Three cheap gates, because auditing the wrong
   org wastes the whole pass:

   - **Freshness.** You cannot prove an org is pristine after the fact, but you can
     catch the obvious disqualifier: a second registration of the same server, or a
     prior version's residue. Re-run the install skill's contamination check
     (NamedCredential / ESR name sweep) and treat any unexpected hit as "this org is
     not evidence" — go get a fresh one. The trust rule is not optional here: a
     silently-broken package in a contaminated org will produce *false clean results*
     in exactly the queries this pass runs.
   - **Released, not beta.** A beta version's grants and handler behavior differ from
     the released artifact the reviewer installs. Confirm `IsReleased` for the `04t...`
     id (`sf package version list --packages "{PKG}" -v {DEVHUB} --json` from the
     package root, or `sf package version report --json`). Auditing a beta is auditing
     something the reviewer will never see.
   - **Already reviewed?** If this exact version already passed review, the whole flow
     is moot — query it and stop early if true:

     ```bash
     export SF_AUTOUPDATE_DISABLE=true SF_DISABLE_AUTOUPDATE=true
     sf data query -o {DEVHUB} -t -q "SELECT IsSecurityReviewed FROM SubscriberPackageVersion WHERE Id = '{PACKAGE_VERSION_ID_04t}'" --json
     ```

     **FAILURE MODE (the keystone trap):** `IsSecurityReviewed` may only flip `true`
     *post-review*, and may read differently in the publishing DevHub vs. a subscriber
     org. A `false`/empty result on a not-yet-reviewed package is **expected and proves
     nothing** — do not present "IsSecurityReviewed = false" as a finding. Run
     `sf sobject describe --sobject SubscriberPackageVersion -t -o {DEVHUB}` first to
     confirm the field even exists for your CLI/API version before trusting the query —
     a query against a field your API version does not expose errors out and must not be
     read as "not reviewed." This gate exists to *skip the flow on a true*, never to flag
     a false.

2. **Audit the subscriber-EFFECTIVE permission grants — what a subscriber ACTUALLY
   gets, not what the package source declares.** This is the heart of the pass and the
   #1 review category (`artifact-access-control-permsets`). Source XML tells you what
   the permission set *intends* to grant; only the installed org tells you what landed.
   Query the live grants, not the package metadata:

   ```bash
   export SF_AUTOUPDATE_DISABLE=true SF_DISABLE_AUTOUPDATE=true
   # The packaged permission set(s) and what object permissions they actually carry post-install
   sf data query -o {ORG_ALIAS} -q "SELECT Parent.Name, Parent.NamespacePrefix, SobjectType, PermissionsRead, PermissionsCreate, PermissionsEdit, PermissionsDelete, PermissionsViewAllRecords, PermissionsModifyAllRecords FROM ObjectPermissions WHERE Parent.NamespacePrefix = '{NAMESPACE}'" --json
   # System-level permissions on the packaged perm set(s) — the over-grant hunt
   sf data query -o {ORG_ALIAS} -q "SELECT Name, NamespacePrefix, PermissionsViewAllData, PermissionsModifyAllData, PermissionsAuthorApex, PermissionsManageUsers, PermissionsApiEnabled FROM PermissionSet WHERE NamespacePrefix = '{NAMESPACE}'" --json
   # Field-level grants, for the least-privilege read
   sf data query -o {ORG_ALIAS} -q "SELECT Parent.Name, SobjectType, Field, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE Parent.NamespacePrefix = '{NAMESPACE}'" --json
   ```

   Then judge against least privilege, and raise a `deployed-package` finding for each:

   - **`PermissionsViewAllData` / `PermissionsModifyAllData` on a packaged permission
     set = an over-grant the reviewer flags hard.** A package that ships `ViewAllData`
     or `ModifyAllData` is granting a subscriber's data to itself wholesale — there is
     almost never a least-privilege justification, and "the app needs to read all of X"
     is satisfied by object/field permissions on X, not by `ViewAllData`. Same posture
     for **`PermissionsAuthorApex`** (a runtime app does not need to author Apex) and
     **`PermissionsManageUsers`** (a vector for privilege escalation inside the
     subscriber org). Each is a finding with a concrete exploit scenario, not a style
     note.
   - **`PermissionsViewAllRecords` / `PermissionsModifyAllRecords` per object** (the
     sharing-bypass grants) on objects the app does not own: flag unless the package
     documents why the sharing model is intentionally bypassed for that object
     (`fail-sharing-model`'s sanctioned-exception list).
   - **CRUCIAL — verify the UEC read grant ACTUALLY LANDED.** The install-time
     **UserExternalCredential grant drop** is a real, documented Salesforce known issue
     (the MCP Client Partner Technical Guide — login-gated; ask in the Partnerblazer
     Slack `#mcp-client` channel or via your Partner Account Manager): the packaged
     permission set's `UserExternalCredential` read grant is **silently dropped during
     install**. The **packaged post-install handler** is the thing that heals the drop
     (it creates the `{MCP_NAME}_UEC_Access` fallback perm set);
     `/sf-security-review-toolkit:install-and-verify-package` step 4 is the post-install
     **verification battery** that *confirms* whether the drop fired and the heal landed
     — it does not perform the heal itself. And **"the heal fired" is not "the grant
     landed."** Verify the END STATE, on a permission set that is actually **assigned**:

     ```bash
     export SF_AUTOUPDATE_DISABLE=true SF_DISABLE_AUTOUPDATE=true
     sf data query -o {ORG_ALIAS} -q "SELECT Parent.Name, Parent.NamespacePrefix, PermissionsRead FROM ObjectPermissions WHERE SobjectType = 'UserExternalCredential' AND PermissionsRead = true" --json
     sf data query -o {ORG_ALIAS} -q "SELECT PermissionSet.Name, Assignee.Username FROM PermissionSetAssignment WHERE PermissionSet.Name LIKE '%{NAMESPACE}%'" --json
     ```

     **FAILURE MODE:** zero `UserExternalCredential` read rows, OR rows that point only
     at an **unassigned** permission set, means a subscriber's runtime cannot resolve
     the credential and the integration silently never works post-install — **and that
     is a review-relevant finding even when the heal makes the partner's own org work**,
     because the reviewer installs into *their* org and may hit the drop with the heal
     mis-timed. Cross-check the two queries: at least one perm set that carries the UEC
     read grant must also appear in the assignment list (for the installing admin AND
     the Platform Integration User `cloud@{orgId18}` — the identity that makes the
     egress callout). If the grant rides only on a handler-created fallback perm set
     (`{MCP_NAME}_UEC_Access`) rather than the packaged perm set, record that as the
     *shape* of the finding: the package ships a grant that install drops and a script
     re-creates — the reviewer will want it documented, and a future install where the
     handler fails to fire leaves the subscriber broken. Do not file the *expected* heal
     itself as a defect; file the **drop-requiring-a-heal** as the reviewable issue, and
     confirm the end state is correct.

3. **Run Code Analyzer's Graph Engine (CRUD/FLS data-flow) against the INSTALLED
   package source — the #1 review failure class.** Missing CRUD/FLS enforcement is the
   top review-failure cause "by a significant margin" (`fail-crud-fls`). The Graph
   Engine traces data flow across method boundaries, which the per-file rules miss.
   Retrieve the installed package's Apex (or scan the package source tree you built
   from — same source, the install just proves it is the released shape), and run:

   ```bash
   export SF_AUTOUPDATE_DISABLE=true SF_DISABLE_AUTOUPDATE=true
   sf code-analyzer run --rule-selector AppExchange --rule-selector Recommended:Security \
     --output-file .security-review/evidence/deployed-package/code-analyzer-graph-{date}.html
   ```

   Emit JSON alongside the HTML for machine triage (`--output-file ...json` in the same
   run). The **AppExchange selector is load-bearing** — it activates the
   review-specific rules; a scan without it looks diligent and misses exactly the rules
   the reviewer runs (`scan-sfge-crud-fls-dataflow`, `scan-code-analyzer-invocation`).
   The Graph Engine is slow and has per-entry-point timeouts — budget for it and triage
   its output first.

   **FAILURE MODE — do NOT false-positive on the v67 user-mode default.** Read the
   target API version from the scope manifest. At **API 67.0+** Apex runs in **user
   mode by default** (object permissions and FLS enforced at execution), undeclared
   classes default to **`with sharing`**, and `WITH SECURITY_ENFORCED` is removed in
   favor of `WITH USER_MODE` (`fail-crud-fls`, `fail-sharing-model`, verified Summer
   '26). A class that lacks an explicit `with sharing` declaration or a SOQL query
   without an explicit access check is **not automatically a finding when the package
   targets 67.0+** — the platform enforces it. Confirm the engine's findings against
   the manifest's API version before raising them: a CRUD/FLS finding on a 67.0+ package
   needs a reason the platform default does *not* cover it (e.g. an explicit
   `without sharing`, a `system`-mode DML, or one of the five sanctioned bypasses used
   without documentation). On a `<=66.0` package the older system-mode default applies
   and the finding stands. Raising v67-default findings as real is the single easiest
   way to drown the partner in false positives — the baseline carries the version logic;
   honor it.

   Findings here are `deployed-package`-dimension entries tagged to the CRUD/FLS class.
   If `/sf-security-review-toolkit:run-scans` already ran Code Analyzer on the package
   track, this is the *installed-artifact* confirmation of those findings, not a
   duplicate — note the overlap in the run log and let the mechanical merge (step 6)
   dedup by key rather than re-reporting.

4. **Verify the External/Named-Credential topology RESOLVES in the real org — callouts
   work AND secrets are org-entered, not packaged values.** Source can show a Named
   Credential exists; only the live org proves it resolves and that the secret is
   stored encrypted on the principal rather than baked into metadata
   (`endpoint-named-credentials-callouts`). Inventory the installed credential metadata,
   then prove resolution:

   ```bash
   export SF_AUTOUPDATE_DISABLE=true SF_DISABLE_AUTOUPDATE=true
   sf data query -o {ORG_ALIAS} -t -q "SELECT Id, DeveloperName, MasterLabel, NamespacePrefix FROM NamedCredential WHERE NamespacePrefix = '{NAMESPACE}'" --json
   sf data query -o {ORG_ALIAS} -q "SELECT Parent.Name, Parent.NamespacePrefix FROM SetupEntityAccess WHERE SetupEntityType = 'ExternalCredentialParameter'" --json
   # Resolution proof — calloutStatus must be a live, resolvable status, not 'NotConfigured'
   sf api request rest "/services/data/v{API}/named-credentials/named-credential-setup/{NAMESPACE}__{NC_NAME}" -o {ORG_ALIAS}
   ```

   Then, **only if the credential is configured**, fire the Apex smoke test from
   `/sf-security-review-toolkit:install-and-verify-package` step 7 (a read-only
   `tools/call` through `callout:{NAMESPACE}__{NC_NAME}`) and capture the status code to
   `evidence/deployed-package/callout-smoke-{date}.txt`. A 200 proves the secret
   resolves and the callout reaches the host; a `CalloutException` against an
   org-entered secret is a token/scope issue, not necessarily a finding — match it to
   that skill's gotcha table.

   **FAILURE MODE — the hardcoded-secret tell.** Cross-reference the callout hosts
   against the credential inventory: a host the package calls out to (a
   `RemoteSiteSetting` / `CspTrustedSite` the package ships) that has **no Named
   Credential routing it** is the classic signal that auth is hand-rolled and the secret
   is likely hardcoded in Apex or a custom setting — a `deployed-package` finding, and
   one of the auto-fail classes (`SessionId`/secret egress). Equally: if the smoke test
   succeeds with **no credential configured in the org** (the discovery GET shows a
   packaged value, not an org-entered one), the secret shipped *inside the package* —
   raise it. The honest read is "the secret must be entered by the subscriber, encrypted
   on the External Credential principal"; anything that makes a callout work without that
   step is the finding. Never write a captured secret to evidence — reference it by its
   last four characters at most (CONVENTIONS §6).

4b. **Executed-action evidence — the Agentforce-RUNTIME lens (agent-trace probe).** Step 4's
   Apex smoke test proves the credential chain *resolves*; it does not exercise the
   Agentforce runtime (Apex egress ≠ Agentforce egress). If
   `/sf-security-review-toolkit:install-and-verify-package` step 6 activated the agent and
   registered its MCP tools (Manage Tools → **Save**), drive a scripted conversation and
   capture the executed-action surface + egress-host observations:

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/harness/agent-trace-probe.mjs --consent --target <repo> \
     --api-name {PUBLISHED_AGENT_API_NAME} --org-alias {ORG_ALIAS} \
     --utterances-file .security-review/evidence/utterance-validation/agent-utterances.md
   ```

   **Same recorded `sf-deep-audit-ops` token — no new consent** (the engine's own
   `verifyConsent` fails closed before any `sf agent preview` spawn, because the
   sf-ops-gate-hook does not classify `agent preview` verbs — that guard is the only thing
   stopping an ungated conversation). It emits, under `evidence/deployed-package/`:
   `agent-trace-actions-{date}.json` (per-turn action name / inputs / output / latency — THE
   "what can this agent do" evidence) + `agent-trace-errors-{date}.json` (session errors /
   tool-failure egress) + `agent-trace-routing-{date}.json` (subagent routing), each
   **redacted per CONVENTIONS §6** (any secret-shaped value is `***redacted***` before write;
   never a raw secret). Fold findings into `audit-ledger.json` in the SAME `deployed-package`
   dimension as steps 2–5 (step 6), keyed with a stable synthetic path
   `deployed-package/agent-trace:<action-or-egress-host>` so re-runs dedup — e.g. an action
   that calls out to a host with no Named Credential routing it, or a tool that egresses a
   record handle. An empty `actions` dimension is recorded honestly as **"no observed
   actions"** (the agent wasn't activated, or the scripted utterances triggered no tools) —
   never a clean pass. This does **NOT** edit the frozen merge engine (`merge-ledger.mjs`):
   the probe writes evidence; step 6 folds the finding by key exactly like `callout-smoke`.
   Coverage is bounded to the scripted utterance list — dynamic evidence, not Salesforce's
   live pen test; the live conversation is cold-run-validated (run the executor with `cwd`
   inside the package DX project — `agent trace read` reads the local DX project's traces).

5. **Verify the post-install handler's REAL granted scope — does it grant MORE than the
   packaged permission sets define? (privilege-escalation check).** The post-install
   script runs with elevated rights and can assign permission sets, create the fallback
   UEC perm set, and configure principals. A handler that grants the installing user (or
   the Platform Integration User) *beyond* what the packaged permission sets declare is a
   privilege-escalation surface the reviewer scrutinizes. Compare what the handler
   *actually granted* against what the package metadata *declares*:

   ```bash
   export SF_AUTOUPDATE_DISABLE=true SF_DISABLE_AUTOUPDATE=true
   # Everything assigned to the installer and the Platform Integration User post-install
   sf data query -o {ORG_ALIAS} -q "SELECT PermissionSet.Name, PermissionSet.NamespacePrefix, Assignee.Username FROM PermissionSetAssignment WHERE Assignee.Username LIKE 'cloud@%' OR Assignee.Username = '{INSTALLER_USERNAME}'" --json
   # Handler-created artifacts that are NOT in the package source (the fallback perm set is the known one)
   sf data query -o {ORG_ALIAS} -q "SELECT Id, Name, NamespacePrefix FROM PermissionSet WHERE NamespacePrefix = null AND (Name LIKE '%UEC%' OR Name LIKE '%{MCP_NAME}%')" --json
   ```

   **FAILURE MODE:** any assignment of a permission set that the package source does
   **not** ship, or any handler-created permission set that carries grants **broader**
   than the packaged set (re-run the step 2 over-grant queries against the
   handler-created perm set specifically), is an escalation finding. The known-benign
   case is narrow and documented: the `{MCP_NAME}_UEC_Access` fallback perm set the
   handler creates to heal the install-time UEC drop (step 2) grants **only**
   `UserExternalCredential` read — confirm it carries *only* that, nothing more. A
   fallback perm set that also carries `ViewAllData`, an extra object grant, or a system
   permission is the package quietly widening its footprint at install time — a finding.
   Tag it to the authZ category. The distinction that matters: the handler **healing a
   documented platform drop** is expected; the handler **granting scope the package
   never declared** is a privilege-escalation defect.

6. **Fold findings into the ledger — mechanically, never by an LLM rewrite.** Every
   confirmed finding from steps 2–5 enters `.security-review/audit-ledger.json` exactly
   like a source-pass finding (schema:
   `${CLAUDE_PLUGIN_ROOT}/templates/audit-ledger.schema.json`), with
   `dimension: "deployed-package"`. The dedup `id` is the first 16 hex of
   `SHA-256(normalized_file + "\n" + normalized_title)` — for a deployed finding with no
   single source file, use a stable synthetic path
   (`deployed-package/<query-or-component>`, e.g.
   `deployed-package/PermissionSet:{NAMESPACE}` for an over-grant) so re-runs dedup
   instead of re-raising. A finding that **matches a key already in the ledger** (the
   source pass flagged the same CRUD/FLS path, or a prior deployed pass flagged the same
   over-grant) is the *same* finding — merge, do not duplicate; let the deployed evidence
   strengthen the existing entry's `evidence`/`verdict_reasoning`, and flip a `fixed`
   entry back to `confirmed` with `regression: true` if it reappears installed. Append a
   `pass` record (tier `standard` by convention for this pass; the deployed pass is not
   tiered like the multi-agent audit) and the per-pass counts. Redact secrets before
   write. Update `.security-review/run-log.md` with one line: which org, which version,
   which checks ran, and the **freshness caveat** if the org's pristineness could not be
   confirmed.

   **Apply the adversarial-verify discipline (CONVENTIONS §7):** a deployed finding is
   only a finding if it survives a skeptical re-read of the live evidence — e.g. an
   over-grant that turns out to be the platform's own standard permission set, not a
   packaged one (check `NamespacePrefix`); a "missing UEC grant" that is actually present
   on an assigned perm set you keyed by the wrong name (the empty-result-reads-clean
   trap, inverted); a CRUD/FLS hit the v67 default already enforces (step 3). Findings
   that do not survive that re-read go to the run log as refuted, with the reasoning kept
   for the FP dossier — they are not silently dropped.

7. **Install + UNINSTALL integrity — the reviewer tests uninstall, so test it.** A
   handler that fails on install, or metadata that survives uninstall, is exactly what
   the reviewer catches when they install-then-uninstall your package. You have already
   confirmed install integrity (the install skill's battery + steps 2/5 here). Now prove
   uninstall is clean — **in the throwaway org, which is about to be torn down anyway**:

   ```bash
   export SF_AUTOUPDATE_DISABLE=true SF_DISABLE_AUTOUPDATE=true
   sf package uninstall -p {PACKAGE_VERSION_ID_04t} -o {ORG_ALIAS} --wait 10
   ```

   Then re-query for residue — packaged components, the handler-created fallback perm
   set, credential principals, and any assignment — every query must come back empty:

   ```bash
   export SF_AUTOUPDATE_DISABLE=true SF_DISABLE_AUTOUPDATE=true
   sf data query -o {ORG_ALIAS} -q "SELECT Id, Name FROM PermissionSet WHERE NamespacePrefix = '{NAMESPACE}'" --json
   sf data query -o {ORG_ALIAS} -q "SELECT Id, Name FROM PermissionSet WHERE NamespacePrefix = null AND Name LIKE '%UEC%'" --json
   sf data query -o {ORG_ALIAS} -t -q "SELECT Id, DeveloperName FROM NamedCredential WHERE NamespacePrefix = '{NAMESPACE}'" --json
   ```

   **FAILURE MODES, two distinct ones:** (a) the **uninstall itself fails** — usually
   because a handler error, an agent/ESR still references a packaged component, or a
   leftover assignment blocks the cascade (the dependency-order problem
   `/sf-security-review-toolkit:teardown-mcp-registration` exists to solve — route there
   to clear references, then retry the uninstall). A package that cannot be cleanly
   uninstalled is a blocker the reviewer will hit. (b) the uninstall **succeeds but
   leaves residue** — the handler-created fallback perm set is the prime suspect, since
   it was *created by a script*, not shipped in the package, so the package uninstall
   does not necessarily remove it. Leftover metadata after uninstall is a review finding;
   raise it as a `deployed-package` entry tagged to the install/uninstall-handler class.
   **Why uninstall is in scope by default:** including the uninstall half is the
   recommended posture precisely because this is where handler failures and residue
   surface — if the operator opts out of the uninstall test, record that the
   install/uninstall-integrity check was **not run** in the verdict's "what was NOT
   verified," never silently.

8. **Hand back to teardown — leave zero residue.** Whether or not you ran step 7's
   uninstall, the throwaway org is disposable and should be removed:
   `/sf-security-review-toolkit:teardown-mcp-registration` — the same skill that
   provisioned the clean throwaway org also tears it down to zero residue — deletes the
   org so no half-configured credential principal or partial registration lingers. State
   in the run log that the audited org was torn down — a deployed-package conclusion is
   only trustworthy from a fresh org, and a torn-down org cannot be silently re-used to
   manufacture a second "clean" result.

## What to explain to the partner

- "This pass installs your package the way the Salesforce reviewer does and audits the
  *result*, not the source — it catches install-time grant drift, handler escalation,
  and uninstall residue that reading the code cannot show. It does **not** replace the
  source audit, and it is **not** Salesforce's pen test."
- "The `UserExternalCredential` read grant your package ships gets silently dropped at
  install (a documented Salesforce known issue). We verified the *end state*, not just
  that your heal script fired — because the reviewer installs into their org, where the
  heal timing can differ. If the grant only lands via the fallback perm set, the
  reviewer will want that documented."
- "We test **uninstall** too — the reviewer does. A handler that fails to clean up, or a
  script-created permission set the package uninstall leaves behind, is a finding even
  though your own install worked."
- "A 67.0+ target means the platform enforces user-mode CRUD/FLS by default — we tuned
  the data-flow findings to that so you aren't chasing false positives the platform
  already handles."

## Automated vs. manual recap

**Executed headlessly (agent, from the installed org + the package version id):**
- Freshness/contamination re-check, released-version + IsSecurityReviewed gates (step 1)
- The subscriber-effective permission grant queries — ObjectPermissions /
  PermissionSet / FieldPermissions, the ViewAll/ModifyAll/AuthorApex/ManageUsers
  over-grant hunt, and the UEC-grant-landed verification (step 2)
- Code Analyzer Graph Engine CRUD/FLS data-flow on the installed source, with v67
  user-mode awareness applied (step 3)
- Named/External-Credential inventory + resolution proof + the read-only Apex callout
  smoke test (step 4)
- The agent-trace probe (`harness/agent-trace-probe.mjs`) — a scripted conversation against
  the activated agent capturing the executed-action / error / routing trace as
  `deployed-package` evidence (the Agentforce-runtime egress lens the Apex smoke test cannot
  reach), redacted names-only, fail-closed on the `sf-deep-audit-ops` consent (step 4b)
- The post-install handler scope comparison — assignments + handler-created perm sets
  vs. packaged declarations (step 5)
- The mechanical ledger merge + run-log update (step 6)
- The uninstall + residue battery (step 7), and the scratch-org teardown (step 8)

**Required a human / an owner decision:**
- Authing `sf` and confirming the install target org is genuinely fresh (the agent can
  catch the obvious disqualifier; it cannot *prove* pristineness)
- Disposing of every confirmed finding: fix, or `accepted_risk` with a written
  justification and a named owner (acceptance is never agent-made — CONVENTIONS §7)
- Deciding whether to run the uninstall-integrity test (step 7) — recommended; opting
  out is recorded in "what was NOT verified," never silent
- Re-confirming any callout-smoke `CalloutException` is a token/scope issue and not a
  real credential-resolution defect

This pass is **dynamic verification in a throwaway org** — it really installs and
really queries, so it sees install-time reality the source audit cannot. It is still
**not Salesforce's penetration test**: their Product Security team installs your package
and tests the surface regardless. The strongest honest statement this pass supports is
"no known blockers in what this org let us verify" — never "will pass."

## What feeds the next skill

The deployed-package findings live in the **same ledger** the source pass feeds, so
`/sf-security-review-toolkit:compile-submission` gates on them identically — zero
undispositioned critical/high before the readiness verdict, with the verdict recording
that a deployed-org pass ran (and against which version), the over-grants found and
dispositioned, whether the UEC grant landed, and whether install/uninstall integrity was
verified or skipped. The credential-resolution evidence and the access-control grant
matrix feed `/sf-security-review-toolkit:generate-artifacts`' access-control and
API-callouts artifacts as **installed-org-confirmed** facts (stronger than
source-inferred). Any refuted deployed finding's reasoning pre-classifies the matching
Code Analyzer false positive for the dossier in
`/sf-security-review-toolkit:run-scans`. The honesty line travels with every one of
these: deployed-org verified, not Salesforce-pen-tested.

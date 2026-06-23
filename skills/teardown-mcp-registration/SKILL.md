---
name: teardown-mcp-registration
description: Provision a clean throwaway org and leave zero residue after the deployed-package audit — remove an MCP server registration (agent references, tool actions, the MCP Servers registry row, ESR/Named Credential/External Credential, and the permission set) in the dependency order that works. Used by the deep audit to clean a contaminated org before install, and to tear the package down to nothing after the audit.
allowed-tools: Bash(sf *) Bash(grep *) Bash(node *harness/record-consent.mjs *) Read Write AskUserQuestion
---

# Teardown MCP Registration

_Adapted from the author's ISV-lifecycle tranche contributed to mvogelgesang/sf-mcp-partner-toolkit (Apache-2.0); see CREDITS.md._

Remove every trace of an MCP server registration. Naive deletion attempts chain into `setup object in use` / `referenced elsewhere` errors — the components reference each other, and the order below is the one that works. One MCP registration per server per org, ever: an org carrying two registrations of the same server (same label, same tool names) breaks instantly, and the residue keeps poisoning runtime enablement even after partial cleanup.

## Role in the autonomous deep audit

This skill bookends the deployed-org deep audit on **both** sides, and is **opt-in and CLI-gated** like the rest of it (invoked only when `sf` is authed and the operator opted into auditing the deployed package):

- **Clean-org provisioning (before install):** ensures the throwaway target org is pristine — a contaminated org silently filters a correctly-installed package's tools, so an audit run there is worthless. The orchestrator routes here before `/sf-security-review-toolkit:install-and-verify-package` whenever the org has registration history.
- **Zero-residue teardown (after the audit):** removes the package and every registration trace once the deployed-artifact evidence is captured — the *uninstall* half of the cycle the Salesforce reviewer also runs, so leftover-metadata and failed-handler problems surface here too.

**Consumes:** an authenticated target org from `/sf-security-review-toolkit:bootstrap-cli-auth`, and the registration/component names.

## When to use

- **Before installing the package** into any throwaway org that hand-registered the same MCP server, or that has registration history — `/sf-security-review-toolkit:install-and-verify-package` step 1 routes here when its contamination check finds a hand registration.
- **After the deployed-package audit**, to tear the installed package and its registration down to nothing (the uninstall half of the reviewer's install/uninstall cycle).
- **Duplicate-registration recovery**: a previously-working agent broke with `tool validation failed while setting up the external MCP connection` the moment a second registration of the same server appeared.
- **Contamination recovery** when stale registry state from prior create/delete/rename cycles is silently filtering tools (the standalone agent-runtime diagnostic that pinpoints this lives in the sibling sf-mcp-partner-toolkit).

## Prerequisites

- The target org is authenticated (run `/sf-security-review-toolkit:bootstrap-cli-auth` first)
- The registration's component names on hand: `{MCP_NAME}` (ESR + Named Credential + External Credential developer name) and `{MCP_NAME}_Perm_Set`. **If the registration was created through the Setup UI (Setup → MCP Servers) rather than the metadata wizard**, the auto-created Named/External Credential and "<ServerName> - Permission Set" may not follow these conventions — discover the real names first and substitute them throughout (a name-keyed verification query with a guessed name returns empty and falsely reads as clean):

  ```bash
  sf data query -o {ORG_ALIAS} --json -q "SELECT Id, Name, Label FROM PermissionSet WHERE Label LIKE '%{SERVER_LABEL}%'"
  sf data query -o {ORG_ALIAS} --json -q "SELECT Id, DeveloperName, MasterLabel FROM NamedCredential"
  ```
- This skill targets **hand-created (no-namespace) registrations**. Managed components cannot be destructive-deployed — if the registration came from a package, remove it with `sf package uninstall` instead (steps 1–3 still apply first — expect the uninstall to be blocked while agents and the registry row still reference the components).

## Steps

0. **Consent gate (fail-closed) — record before the destructive teardown.** This skill
   removes registry rows and metadata (`sf data delete`, `sf package uninstall`, and
   destructive `sf project deploy` of post-destructive changes) — all irreversible against
   the org. Before the first destructive op, ask the operator ONCE with `AskUserQuestion`
   (name the org being torn down and that the deletes are irreversible), and on a yes record
   it: `node ${CLAUDE_PLUGIN_ROOT}/harness/record-consent.mjs --gate sf-deep-audit-ops --answer "<operator's exact yes>" --target <repo>`.
   The PreToolUse hook (`hooks/sf-ops-gate-hook.mjs`) is the fail-closed backstop: without
   that recorded consent `sf data delete`, `sf package uninstall`, and `sf project deploy`
   are **DENIED**, so a skipped ask means the op is denied, not silently run.

1. **Remove tool-action references from EVERY agent — including agents you forgot about.** Find them headlessly via the Tooling API. Execute all three sweeps:

   ```bash
   sf data query --use-tooling-api -o {ORG_ALIAS} --json \
     -q "SELECT Id, DeveloperName, MasterLabel FROM GenAiFunctionDefinition"
   sf data query --use-tooling-api -o {ORG_ALIAS} --json \
     -q "SELECT Id, DeveloperName, MasterLabel FROM GenAiPluginDefinition"
   sf data query --use-tooling-api -o {ORG_ALIAS} --json \
     -q "SELECT Id, DeveloperName, MasterLabel FROM GenAiPlannerDefinition"
   ```

   Grep the output for your server's label and tool names — in our experience, generated MCP tool actions carry both (e.g. `my_tool - MyMCP`). Sweep **all** planners (agents), not just the one you built: an orphaned action hid inside the stock out-of-the-box Employee Agent for us, and it blocked the teardown until found.

   For each referencing agent: open it in the builder, deactivate it, and remove the MCP actions from its topics. Agent Studio is the current builder — legacy agent creation retires the week of 2026-07-13. Generate the org link (never assume a local browser can launch):

   ```bash
   sf org open -o {ORG_ALIAS} --url-only
   ```

   Setup breadcrumb: Setup → Quick Find "Agentforce Agents" (under Agent Studio) → open the agent → deactivate → remove the actions → save.

2. **Delete the MCP Tool Actions.** Headless path — delete each `GenAiFunctionDefinition` row found in step 1:

   ```bash
   sf data delete record --use-tooling-api -s GenAiFunctionDefinition -i {FUNCTION_ID} -o {ORG_ALIAS}
   ```

   If the delete is rejected as still referenced, join rows may need deleting first (e.g. `GenAiPluginFunctionDef`, the plugin↔function link). Discover its shape, query, and delete:

   ```bash
   sf sobject describe --sobject GenAiPluginFunctionDef --use-tooling-api -o {ORG_ALIAS}
   sf data delete record --use-tooling-api -s GenAiPluginFunctionDef -i {JOIN_ID} -o {ORG_ALIAS}
   ```

   UI alternative: generate the org link, breadcrumb Setup → Quick Find "Agentforce Assets" → delete the server's tool actions there. (This is also the recovery path for GACK `-1826465994`.)

   ```bash
   sf org open -o {ORG_ALIAS} --url-only
   ```

   **CLI quirk:** `sf api request rest --method DELETE` demands a body-mode flag and is awkward for this — use `sf data delete record --use-tooling-api` for all Tooling deletes.

3. **Delete the MCP Server registry row — UI only.** `McpServerDefinition` is not API-writable, and while the row exists it pins the ESR: every destructive deploy fails with `setup object in use`. Hand the human a deep link:

   ```bash
   sf org open -o {ORG_ALIAS} --path "/lightning/setup/McpServer/home" --url-only
   ```

   Setup breadcrumb: Setup → MCP Servers → row menu → Delete. The list shows **no differentiator** between two same-labeled servers — disambiguate via the `0Led…` record id in each row's URL before deleting. (A registration that was only ever CLI-deployed and never registered or synced in Setup may have no registry row at all — absence here just means skip to step 4. Do NOT try to verify via a Tooling query: `McpServerDefinition` accepts `SELECT` but returns zero rows even in orgs whose Setup page shows registered servers — an empty result proves nothing; the Setup page is the only trustworthy read.)

4. **Destructive-deploy the metadata in dependency order: ESR → Named Credential → External Credential.** Write `/tmp/mcp-teardown/package.xml` (empty — the standard destructive-deploy shape):

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <Package xmlns="http://soap.sforce.com/2006/04/metadata">
       <version>66.0</version>
   </Package>
   ```

   And `/tmp/mcp-teardown/destructiveChanges.xml`, starting with the ESR:

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <Package xmlns="http://soap.sforce.com/2006/04/metadata">
       <types>
           <members>{MCP_NAME}</members>
           <name>ExternalServiceRegistration</name>
       </types>
       <version>66.0</version>
   </Package>
   ```

   Execute:

   ```bash
   sf project deploy start --metadata-dir /tmp/mcp-teardown -o {ORG_ALIAS} --wait 10
   ```

   Then rewrite `destructiveChanges.xml` with `<name>NamedCredential</name>` and re-run, then `<name>ExternalCredential</name>` and re-run. Three sequential deploys, in that dependency order — `destructiveChanges.xml` gives no control over delete ordering within a single deploy, and this is the order that works.

5. **Permission set last — assignments first.** A perm set with live assignments will not delete. Query the `PermissionSetAssignment` rows, delete each, then delete the perm set itself:

   ```bash
   sf data query -o {ORG_ALIAS} --json \
     -q "SELECT Id, Assignee.Username FROM PermissionSetAssignment WHERE PermissionSet.Name = '{MCP_NAME}_Perm_Set'"
   sf data delete record -s PermissionSetAssignment -i {PSA_ID} -o {ORG_ALIAS}
   sf data query -o {ORG_ALIAS} --json \
     -q "SELECT Id FROM PermissionSet WHERE Name = '{MCP_NAME}_Perm_Set'"
   sf data delete record -s PermissionSet -i {PERM_SET_ID} -o {ORG_ALIAS}
   ```

6. **Verification battery — confirm zero residue.** Re-query every object class touched. Execute all of these; every one must come back empty (or, for the GenAi sweeps, free of your server's label and tool names):

   ```bash
   sf data query --use-tooling-api -o {ORG_ALIAS} --json \
     -q "SELECT Id, DeveloperName, MasterLabel FROM GenAiFunctionDefinition"
   sf data query --use-tooling-api -o {ORG_ALIAS} --json \
     -q "SELECT Id, DeveloperName, MasterLabel FROM GenAiPluginDefinition"
   sf data query --use-tooling-api -o {ORG_ALIAS} --json \
     -q "SELECT Id, DeveloperName, MasterLabel FROM GenAiPlannerDefinition"
   sf data query --use-tooling-api -o {ORG_ALIAS} --json \
     -q "SELECT Id, DeveloperName FROM ExternalServiceRegistration WHERE DeveloperName = '{MCP_NAME}'"
   sf data query -o {ORG_ALIAS} --json \
     -q "SELECT Id, DeveloperName, Endpoint FROM NamedCredential WHERE DeveloperName = '{MCP_NAME}'"
   sf data query -o {ORG_ALIAS} --json \
     -q "SELECT Id FROM PermissionSet WHERE Name = '{MCP_NAME}_Perm_Set'"
   sf data query -o {ORG_ALIAS} --json \
     -q "SELECT Id FROM PermissionSetAssignment WHERE PermissionSet.Name = '{MCP_NAME}_Perm_Set'"
   ```

   Also re-check the MCP Servers list (step 3 deep link) for any remaining row pointing at the same endpoint. Any residue restarts the chain at the step that owns that object class.

## Teardown error taxonomy

| Error | Where it appears | Cause | Fix |
|---|---|---|---|
| `setup object in use` | Destructive deploy of the ESR | The MCP Servers registry row still exists and pins the ESR | Step 3 first — the row is UI-delete only |
| `referenced elsewhere` (or a delete rejected as in-use) | Deleting tool actions or the ESR | An agent topic still references the action — often a stock agent you forgot | Re-run the step 1 sweep across ALL agents; check the out-of-the-box Employee Agent |
| Tool action delete rejected after agents are clean | `sf data delete record` on `GenAiFunctionDefinition` | Join rows (e.g. `GenAiPluginFunctionDef`) still link it | Delete the join rows first (step 2) |
| GACK `-1826465994` | Manage Tools → Save, before or after teardown | Stale tool actions | Delete them in Agentforce Assets, then retry |
| Error asking for a body-mode flag | `sf api request rest --method DELETE` | CLI quirk on body-less DELETEs | Use `sf data delete record --use-tooling-api` instead |
| `tool validation failed while setting up the external MCP connection` | A previously-working agent, right after a second registration of the same server appeared | Duplicate registration of the same server | This teardown — then validate in a fresh org (below) |

## Post-teardown trust caveat

An org that has been through registration create/delete/rename cycles is **no longer a trustworthy environment for runtime conclusions** — in our experience, corrupted registry residue can silently filter a correctly-installed package's tools in that org while the identical package works first-try in a pristine one. After teardown:

- Install and verify here if you must (it is fine for practice), but do the **final** deployed-package audit in a fresh org created from the Trialforce Template Id in the MCP Client Partner Technical Guide (login-gated partner doc — ask in the Partnerblazer Slack `#mcp-client` channel or via your Partner Account Manager if you don't have it) — then run `/sf-security-review-toolkit:install-and-verify-package` there.
- If you re-register in this org, two ESRs with the same name error outright — confirm the step 6 ESR query is empty first.
- The MCP Servers list shows no differentiator for same-labeled servers — always disambiguate via the `0Led…` record id in the URL before trusting which row you are looking at.

## What to explain to the partner

- "One MCP registration per server per org — ever. We are removing this one completely before the package install, because installing alongside it breaks working agents and corrupts the org's registry state."
- "The order matters: agents reference actions, actions reference the server row, the server row pins the ESR, the ESR references the credentials, and the permission set references the credential principal. Deleting out of order just produces `setup object in use` errors."
- "After this teardown the org is clean for an install, but runtime conclusions should come from a fresh template org — this org has registration history now, and that history has fooled us before."

## Automated vs. manual recap

**Executed headlessly:**
- The three Tooling API sweeps for agent/action references (`GenAiFunctionDefinition`, `GenAiPluginDefinition`, `GenAiPlannerDefinition`)
- Tool action and join-row deletes via `sf data delete record --use-tooling-api`
- Destructive deploys of ESR → Named Credential → External Credential
- `PermissionSetAssignment` and permission set deletes
- The full zero-residue verification battery

**Required a human in Setup:**
- Removing MCP actions from each referencing agent's topics in Agent Studio (Setup → Quick Find "Agentforce Agents" — deactivate, edit, save)
- Deleting the MCP Servers registry row (Setup → MCP Servers — `McpServerDefinition` is not API-writable; deep link generated in step 3)
- Deleting tool actions in Agentforce Assets, when taking the UI path or clearing GACK `-1826465994`

## What feeds the next skill

- **Feeds:** on the **provisioning side**, a pristine org into `/sf-security-review-toolkit:install-and-verify-package` — the clean environment the deployed-artifact audit requires. On the **teardown side**, a zero-residue org back to the operator: the package and every registration trace removed, the *uninstall* half of the cycle the Salesforce reviewer also runs completed and verified empty.

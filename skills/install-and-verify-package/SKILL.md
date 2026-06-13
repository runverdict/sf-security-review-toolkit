---
name: install-and-verify-package
description: Stand up the partner's EXISTING released managed package in a throwaway scratch/trial org and audit the deployed artifact — exactly what the Salesforce reviewer does when they install your package. Pre-install contamination check, headless permission-chain verification (the install-time UEC grant drop), Connect API credential configuration, Manage Tools sync, install+uninstall integrity, and an Apex smoke test through the installed Named Credential. The core of the CLI-gated deployed-org deep audit.
allowed-tools: Bash(sf *) Bash(rm *) Read Write AskUserQuestion
---

# Install and Verify Package

_Adapted from the author's ISV-lifecycle tranche contributed to mvogelgesang/sf-mcp-partner-toolkit (Apache-2.0); see CREDITS.md._

Install the managed package into a clean throwaway org and verify every link in the chain headlessly — then audit the **deployed** artifact, which source reading alone cannot reach (install-time permission grants, registration collisions, credential resolution). This is *what the Salesforce reviewer does* when they install your package, previewed before submission. Each step below encodes a failure we hit on real subscriber installs.

## Role in the autonomous deep audit

This is the **core** of the deployed-org deep audit — the step the whole CLI-gated path exists to reach. It is **opt-in and CLI-gated**: the orchestrator invokes it only when `sf` is authed and the operator opted into auditing the deployed package; the always-on source audit never depends on it. The common case is that the partner already has a released version, so the orchestrator hands its auto-resolved `04t…` id straight here — the build step is skipped entirely.

- **Consumes:** a released `04t…` package version id (auto-resolved by the orchestrator querying the Dev Hub for the package's released version, or produced by `/sf-security-review-toolkit:build-managed-package` in the no-release-yet fallback), an authenticated target org from `/sf-security-review-toolkit:bootstrap-cli-auth`, and a clean throwaway org provisioned by `/sf-security-review-toolkit:teardown-mcp-registration`.

## When to use

- During the deployed-org deep audit, with a **promoted (released)** version on hand — the partner's existing release in the common case, or one produced by `/sf-security-review-toolkit:build-managed-package` only when no release existed
- When standing the package up in a clean throwaway org (a fresh scratch org or Trialforce template org) to audit the deployed artifact the way the reviewer will
- After **every** package upgrade, when re-auditing an upgraded release (see the upgrade runbook at the end)

## Prerequisites

- A released `04t...` package version id
- The throwaway target org is authenticated (run `/sf-security-review-toolkit:bootstrap-cli-auth` first) and clean (run `/sf-security-review-toolkit:teardown-mcp-registration` first if it has registration history)
- The MCP server's OAuth client id + secret on hand (for step 5)

## Steps

1. **Pre-install contamination check — one MCP registration per server per org. Ever.** Installing the package into an org that still has a hand-created registration of the same server (same label, same tool names — every PoC org has one) breaks a previously-working agent instantly with `tool validation failed while setting up the external MCP connection`, and leaves registry state that keeps poisoning runtime enablement even after cleanup. Detect it headlessly — look for any existing row registering the same server:

   ```bash
   sf data query -o {ORG_ALIAS} -q "SELECT Id, DeveloperName, MasterLabel, NamespacePrefix, Endpoint FROM NamedCredential" --json
   sf data query -o {ORG_ALIAS} -t -q "SELECT Id, DeveloperName, MasterLabel, NamespacePrefix FROM ExternalServiceRegistration" --json
   ```

   (The ESR is a Tooling API object — `-t` is required; standard SOQL returns `sObject type 'ExternalServiceRegistration' is not supported`.)

   The **primary signal is the name**: a `NamespacePrefix = null` Named Credential or ESR whose `DeveloperName`/`MasterLabel` matches your server is a hand registration. Do **not** key on `Endpoint` — hand registrations created via the MCP Servers Setup UI (and the toolkit scaffold) are `SecuredEndpoint`-type Named Credentials whose URL lives in `NamedCredentialParameter` rows, so the legacy `Endpoint` field is null on exactly the rows you're hunting (a null `Endpoint` with a matching name still counts as a hit). To match by URL anyway, query the parameters via the Tooling API:

   ```bash
   sf data query -o {ORG_ALIAS} -t -q "SELECT NamedCredentialId, ParameterValue FROM NamedCredentialParameter WHERE ParameterType = 'Url'" --json
   ```

   (For a single known credential, the Connect resource is simpler — one call returns `calloutUrl` and `calloutStatus` directly, and accepts installed prefixed names: `sf api request rest "/services/data/v66.0/named-credentials/named-credential-setup/{NAMESPACE}__{MCP_NAME}" -o {ORG_ALIAS}`. The Tooling sweep above remains the right tool for the org-wide hunt.)

   **Fully remove any hit before installing** — run `/sf-security-review-toolkit:teardown-mcp-registration` and come back. Do not install alongside it and clean up later; that ordering is what corrupts orgs.

   To eyeball the registry, generate a deep link (never assume a local browser can launch) — Setup → MCP Servers:

   ```bash
   sf org open -o {ORG_ALIAS} --path "/lightning/setup/McpServer/home" --url-only
   ```

   Note: the MCP Servers list shows **no differentiator** between two same-labeled servers — disambiguate via the `0Led…` record id in each row's URL. And don't substitute a Tooling query for this eyeball check: `McpServerDefinition` accepts `SELECT` but returns zero rows even in orgs whose Setup page shows registered servers — an empty result proves nothing.

   **Trust rule:** runtime conclusions only count from fresh template orgs. An org that has had MCP registrations created, deleted, or renamed is no longer evidence — in our experience a managed package can be silently broken in a contaminated org and work first-try in a pristine one. If this org has registration history, install here for practice, but validate in a fresh org before concluding anything.

2. **Check the version is promoted (beta gate).** Only released versions install into Trialforce template test orgs — beta installs fail with `Unable to install beta package ... only in sandbox or Developer Edition organizations`, even though the template orgs are nominally Developer Edition. Execute:

   ```bash
   sf package version list --packages "{MCP_NAME}" -v {DEVHUB_ALIAS} --json
   ```

   Run this from the package project root — `--packages` resolves through `packageAliases` in `sfdx-project.json`; from any other directory, pass the `0Ho…` package id instead (a bare display name fails with `InvalidPackageIdError ... must start with "0Ho"`). Check `IsReleased` for your target `04t...` id. If `false`, promote first via `/sf-security-review-toolkit:build-managed-package` (`sf package version promote`, needs ≥75% Apex coverage).

3. **Install the package.** Execute:

   ```bash
   sf package install -p {PACKAGE_VERSION_ID} -o {ORG_ALIAS} --wait 10 --security-type AdminsOnly
   ```

   `--security-type` takes `AdminsOnly` (default) or `AllUsers` — either way, actual callout access is governed by the packaged permission set, which the post-install handler assigns (next step verifies). If the package ships a `CspTrustedSite` or `RemoteSiteSetting` (the `/sf-security-review-toolkit:build-managed-package` template does), the CLI prompts to grant the third-party website access even on a first install — add `--no-prompt` to auto-grant it headlessly. For upgrades, `--no-prompt` also skips the confirmation on metadata changes.

4. **Post-install verification battery (all SOQL, all headless).** This is where the install-time UEC grant drop shows (a Salesforce known issue documented in the MCP Client Partner Technical Guide): the packaged permission set's `UserExternalCredential` read grant is silently dropped during install — we reproduced it on 3 of 3 subscriber installs. Run all four checks:

   a. **Permission set assignments** — the installing admin AND the Platform Integration User (the identity that makes the egress callout at runtime; deterministic username `cloud@{orgId18}`, 18-char org id lowercased). Execute:

   ```bash
   sf data query -o {ORG_ALIAS} -q "SELECT PermissionSet.Name, Assignee.Username FROM PermissionSetAssignment WHERE PermissionSet.Name = '{MCP_NAME}_Perm_Set'" --json
   sf data query -o {ORG_ALIAS} -q "SELECT PermissionSet.Name, Assignee.Username FROM PermissionSetAssignment WHERE Assignee.Username LIKE 'cloud@%'" --json
   ```

   Expect both the installer and `cloud@{orgId18}` assigned. If the Platform Integration User is missing, the agent-side symptom is silent tool filtering — and a missing assignment here is itself a least-privilege finding the deployed-package audit records. (Deeper agent-runtime triage — silent tool filtering, enablement debugging — is out of scope for this audit pass; the standalone diagnostic playbook for it lives in the sibling sf-mcp-partner-toolkit.)

   b. **Which permission sets actually carry the UEC read grant.** Execute:

   ```bash
   sf data query -o {ORG_ALIAS} -q "SELECT Parent.Name, PermissionsRead FROM ObjectPermissions WHERE SobjectType = 'UserExternalCredential' AND PermissionsRead = true" --json
   ```

   At least one row must point at a perm set assigned in (a). Zero rows = the runtime cannot resolve the credential and tools will never enable. (Some rows return a null `Parent` — tolerate it when parsing.)

   c. **The handler's fallback perm set.** Execute:

   ```bash
   sf data query -o {ORG_ALIAS} -q "SELECT Id, Name, NamespacePrefix FROM PermissionSet WHERE Name = '{MCP_NAME}_UEC_Access'" --json
   ```

   If it exists, the packaged grant **was** dropped (the known issue fired) and the post-install handler healed it. **Expected, not a bug** — explain this to the partner before they panic.

   d. **External Credential parameter access.** Execute:

   ```bash
   sf data query -o {ORG_ALIAS} -q "SELECT Parent.Name, Parent.NamespacePrefix FROM SetupEntityAccess WHERE SetupEntityType = 'ExternalCredentialParameter'" --json
   ```

   Expect a row for your **packaged** perm set carrying your namespace. In a customer org, rows pointing at other integrations' external credentials may also appear — ignore them. The fallback perm set will **not** appear here — the handler grants it only the `UserExternalCredential` object read (the principal access rides on the packaged perm set) — so its absence from this query is normal, even on a handler-healed org.

   Zero rows in (b) AND no fallback in (c) = the handler never ran at all — verify the installed version actually carried `postInstallScript` (the `sfdx-project.json` rewrite trap — `/sf-security-review-toolkit:build-managed-package` step 4).

5. **Configure credentials headlessly (Connect API — the primary path).** The MCP registration modal does not accept credentials for packaged servers (documented known issue); the Connect API configures the principal cleanly using the admin's own CLI auth (verified on API v66.0). The browser-only Setup-UI credential-entry walk remains a fallback (the Connect REST resource below is the headless equivalent, and it works for hand-deployed credentials too) — that à-la-carte Setup walkthrough lives in the sibling sf-mcp-partner-toolkit if you need it.

   First, GET the resource to discover the expected per-protocol field names (the GET takes the principal coordinates as query params):

   ```bash
   sf api request rest "/services/data/v66.0/named-credentials/credential?externalCredential={NAMESPACE}__{MCP_NAME}&principalType=NamedPrincipal&principalName={PRINCIPAL_NAME}" -o {ORG_ALIAS}
   ```

   (`sf api request rest` prints a beta-command warning — expected; the Connect REST endpoint itself is GA.)

   Get the client id and secret WITHOUT routing them through the chat: prefer having the partner place them in a local file (mode 600) and tell you the path, or read them from the server project's own config when you're running inside it — secrets pasted into a session persist in the transcript. Build `/tmp/mcp-credential.json` from that source **programmatically** — e.g. a short python script that reads the creds file and `json.dump`s the body — never by inlining the values in a heredoc or command argument, which renders the secret in the session transcript (reference it by its last four characters if you must confirm):

   ```json
   {
     "authenticationProtocol": "OAuth",
     "authenticationProtocolVariant": "ClientCredentialsClientSecret",
     "externalCredential": "{NAMESPACE}__{MCP_NAME}",
     "principalName": "{PRINCIPAL_NAME}",
     "principalType": "NamedPrincipal",
     "credentials": {
       "clientId":     { "value": "{CLIENT_ID}", "encrypted": false },
       "clientSecret": { "value": "{CLIENT_SECRET}", "encrypted": true }
     }
   }
   ```

   (`{PRINCIPAL_NAME}` is the NamedPrincipal defined in your External Credential. The scaffold wizard names it `MCPAuthentication` — matching the partner guide's packaged example `ns__MyMCP-MCPAuthentication`; other packages may differ. Confirm via the GET discovery call above or the package's `externalCredentials/` source before POSTing.) Then execute, and delete the body file after:

   ```bash
   sf api request rest "/services/data/v66.0/named-credentials/credential" --method POST --body @/tmp/mcp-credential.json -o {ORG_ALIAS}
   rm /tmp/mcp-credential.json
   ```

   Expect `authenticationStatus: "Configured"`. Every detail of the body matters:

   | Gotcha | Result |
   |---|---|
   | `"Oauth"` instead of `"OAuth"` (capital O-A exactly) | `INVALID_API_INPUT` |
   | Re-running POST against an already-configured principal | `CONFLICT — Authentication credentials ... already exist. Use the PUT method to overwrite them.` Switch to `--method PUT` for rotation/overwrite |
   | The External Credential's `Scope` parameter doesn't match the server (the scaffold wizard hardcodes `Scope = read`) | Credentials save as `Configured`, then every callout fails with the opaque `Unable to fetch the OAuth token. Error: . Error description: .` — fix the EC's `Scope` AuthParameter to the server's actual scope (check `scopes_supported` / your server docs), redeploy, re-PUT |
   | Wrong token endpoint URL in the External Credential | `System.CalloutException: The expired credentials couldn't be refreshed. Try again later.` — verify against the server's `/.well-known/oauth-authorization-server` `token_endpoint` |
   | `"encrypted": true` on `clientId` | Rejected |
   | Local name (`{MCP_NAME}`) instead of installed prefixed name (`{NAMESPACE}__{MCP_NAME}`) in `externalCredential` | Credential lands on the wrong (or no) External Credential |
   | Custom/API-key protocol | The `credentials` map key is your parameter name (e.g. `"key"`), and the returned status reads `"Unknown"` — there is no handshake to validate. Normal, not a failure. |

   (The metadata XML's `authenticationProtocol` is legitimately `Oauth` — the capital-A `OAuth` spelling is required only in this Connect API body.)

6. **Register the tools (human step — Manage Tools).** Generate the deep link; the breadcrumb is Setup → MCP Servers → {your server} → **Manage Tools**:

   ```bash
   sf org open -o {ORG_ALIAS} --path "/lightning/setup/McpServer/home" --url-only
   ```

   Guide the partner: open the server (disambiguate same-labeled rows via the `0Led…` id in the URL), click **Manage Tools**, enable the tools agents should see, click **Save**. Quirks they will hit:

   | Symptom | Meaning | Action |
   |---|---|---|
   | "Out of Sync — outdated tool definition" | The org compared a live `tools/list` against the ESR's embedded schema snapshot and found drift | Click **Save** — it syncs, and it doubles as proof your connectivity works |
   | Transient GACK on Manage Tools load | Transient | Refresh the page before hunting further |
   | GACK `-1826465994` on Save | Stale tool actions | Delete the server's tool actions in Agentforce Assets first (Setup → Quick Find "Agentforce Assets"), then retry |
   | Tools show pre-selected on a packaged server | The packaged ESR shipped with operations active | Expected — toggle one tool + **Save** to force action generation |

7. **Apex smoke test (headless) — prove the full credential chain without an agent in the loop.** Write `/tmp/mcp-smoke.apex` (substitute a real read-only tool name from your server's `tools/list`):

   ```apex
   HttpRequest r = new HttpRequest();
   r.setEndpoint('callout:{NAMESPACE}__{MCP_NAME}');
   r.setMethod('POST');
   r.setHeader('Content-Type','application/json');
   r.setHeader('Accept','application/json, text/event-stream');
   r.setBody('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"{TOOL_NAME}","arguments":{}}}');
   HttpResponse res = new Http().send(r);
   System.debug(res.getStatusCode());
   System.debug(res.getBody());
   ```

   Execute:

   ```bash
   sf apex run -o {ORG_ALIAS} --file /tmp/mcp-smoke.apex
   ```

   A `CalloutException` here is usually the token exchange, not the server — match it against the step 5 gotcha table (wrong token URL, scope mismatch; empty `Error: .` fields also mean the server's error response isn't RFC 6749-shaped top-level `error`/`error_description`, which Salesforce parses). A 200 proves OAuth token exchange + the Named Credential + the **running admin's** credential chain (anonymous Apex runs as you, not the Platform Integration User — the PIU's enablement is the separate axis step 4 verifies). A 200 here **plus** tools not firing in the agent = org-side enablement problem, full stop (not credentials) — for the deep audit, record it as an enablement (not credential-chain) observation; standalone agent-runtime triage lives in the sibling sf-mcp-partner-toolkit. (Caveat: Apex egress ≠ Agentforce egress, so this proves credentials, not the runtime path.)

8. **Verify uninstall integrity, then hand off.** With the battery green, the deployed-artifact evidence — the four-query permission battery, the least-privilege / over-grant read, the credential-resolution proof — is ready for the `audit-deployed-package` pass and the readiness verdict (tag every finding *automated, from this throwaway org*). Before tearing down, complete the install/**uninstall** half of the cycle the reviewer runs: `sf package uninstall -p {PACKAGE_VERSION_ID} -o {ORG_ALIAS} --wait 10`, and confirm it leaves no orphaned metadata behind (a failed uninstall handler or leftover components is exactly what the reviewer flags). Then hand the org to `/sf-security-review-toolkit:teardown-mcp-registration` for zero-residue removal. When asserting against live data in a fresh Trialforce template org, note these orgs ship their own sample CRM records — assert counts ≥ what you planted (or filter by seeded external ids), never exact-match.

## Upgrade runbook

After **every** package upgrade: Manage Tools → **Save** (re-syncs the tool definitions; step 6 link). If the upgrade re-stamped a baked ESR schema, the org can wedge: runtime "tool failed validation" with no `tools/call` egress, tools locked as "available as agent action" and un-toggleable in Manage Tools, GACK `-1826465994` on every Save. Recovery order:

1. Agentforce Assets → delete **all** of the server's tool actions (generate the org link: `sf org open -o {ORG_ALIAS} --url-only`; breadcrumb Setup → Quick Find "Agentforce Assets")
2. Setup → MCP Servers → {server} → Manage Tools → re-add the tools → **Save** (succeeds now)
3. Rebuild the subagent and re-attach the actions

Prevention belongs in the package, not the runbook: ship the ESR in the `Incomplete` state with no baked operations — see `/sf-security-review-toolkit:build-managed-package` step 7.

## What to explain to the partner

- "One MCP registration per server per org — ever. Your customers' PoC orgs almost certainly have a hand registration of this same server; the install guide must have them remove it first, or the install breaks a working agent."
- "If you see a `{MCP_NAME}_UEC_Access` permission set you didn't ship, that's the post-install handler healing a known platform issue (documented in the MCP Client Partner Technical Guide) — it's the package working as designed."
- "The client secret never touches metadata or source control — the Connect API stores it encrypted on the External Credential principal, same as typing it into Setup."
- "The Apex smoke test exercises the exact credential path the runtime uses. If it returns 200, any remaining agent failure is enablement or routing — not your server, not the credentials."

## Automated vs. manual recap

**Executed headlessly:**
- Contamination detection queries (NamedCredential/ESR name match + URL-parameter fallback)
- Version promotion check, package install
- The four-query permission battery (assignments, UEC ObjectPermissions, fallback perm set, SetupEntityAccess)
- Credential configuration via the Connect API (GET discovery + POST)
- The Apex smoke test through the installed Named Credential

**Required a human in Setup:**
- Manage Tools: enabling tools and clicking Save (Setup → MCP Servers — deep link generated in step 6)
- Deleting stale tool actions in Agentforce Assets when clearing GACK `-1826465994` or a post-upgrade wedge
- Removing a pre-existing hand registration's MCP Servers row, if step 1 found one (UI-only — handled in `/sf-security-review-toolkit:teardown-mcp-registration`)

## What feeds the next skill

- **Feeds:** the deployed-artifact evidence — the four-query permission battery, the least-privilege / over-grant read, the credential-resolution proof, and install+uninstall integrity — into the `audit-deployed-package` pass and the readiness verdict, each finding tagged *automated, from this throwaway org*. Then hands the org to `/sf-security-review-toolkit:teardown-mcp-registration` for zero-residue removal.

---
name: build-managed-package
description: Cut a released managed 2GP from the partner's source — ONLY when the deployed-org deep audit finds no released version to audit yet. The common case is the partner already has a release; this is the fallback that produces an installable artifact so the deep audit has something to stand up. It does not modify the partner's application logic, but it DOES generate packaging scaffolding (a post-install handler, a CspTrustedSite) into force-app/ and edit sfdx-project.json — and only on the no-existing-release path.
allowed-tools: Bash(sf *) Bash(export SF_AUTOUPDATE_DISABLE=true SF_DISABLE_AUTOUPDATE=true) Bash(git diff*) Bash(cat *) Bash(grep *) Bash(node *harness/record-consent.mjs *) Bash(node *harness/standup-org.mjs *) Bash(node *harness/teardown-org.mjs *) Read Write Edit AskUserQuestion
---

# Build Managed Package

_Adapted from the author's ISV-lifecycle tranche contributed to mvogelgesang/sf-mcp-partner-toolkit (Apache-2.0); see CREDITS.md._

Promote the four MCP metadata components (plus a post-install handler and a CSP Trusted Site) into a released managed 2GP. Every step below encodes a packaging failure we hit on the way to a released version — the order matters.

This skill is **not blanket read-only**: it does not touch the partner's application logic, but it **does** generate packaging scaffolding into `force-app/` (the `MCPPostInstall` handler and a `CspTrustedSite`) and edit `sfdx-project.json` — and it does so only on the no-existing-release path, when there is no released version to audit and one has to be cut.

## Role in the autonomous deep audit

This is the **build-only-if-needed** step of the deployed-org deep audit. The common case is the opposite: the partner is prepping a package they have **already released**, so the orchestrator skips this entirely and goes straight to standing up the existing `04t…` version. This skill runs only when the `sf` auto-resolution (the orchestrator querying the Dev Hub for the package's released version) finds nothing — `sf package version list` shows no row with `IsReleased = true` for this package — yet the operator opted into the deployed-org deep audit and there is source to package. It is **opt-in and CLI-gated** like the rest of the deep audit: never part of the always-on source audit, never invoked unless `sf` is authed.

- **Consumes:** an authenticated `devhub` + `ns-holder` fleet from `/sf-security-review-toolkit:bootstrap-cli-auth`, and the partner's integration metadata in `force-app/main/default/`. The orchestrator routes here only after auto-resolution confirms no released version exists.
- **Feeds:** a promoted (released) `04t…` package version id that `/sf-security-review-toolkit:install-and-verify-package` stands up in the throwaway org for the deployed-artifact audit.

## When to use

- During the deployed-org deep audit, **only when no released package version exists yet** — auto-resolution found nothing with `IsReleased = true`, so there is no deployed artifact to audit until one is built
- When the partner wants customers to one-click install the integration (an installable AgentExchange package listing must be **Managed** — partner-hosted MCP-server listings without a package exist, but they are not this skill's path)
- NOT for iterating on metadata, and NOT for building an integration from scratch — that à-la-carte authoring/deploy path lives in the sibling sf-mcp-partner-toolkit (the autonomous orchestrator does not author code)

## Prerequisites

- Working integration metadata already present in `force-app/main/default/` (the partner's own source — this skill packages it, it does not generate it)
- Dev Hub authenticated (run `/sf-security-review-toolkit:bootstrap-cli-auth` first)
- The project is a git repo — step 4's guard depends on `git diff`

## Steps

0. **Consent gate (fail-closed) — record before the first irreversible build op.** This
   skill creates scratch orgs, deploys metadata, and creates a package version (steps 9)
   — all mutate orgs / build artifacts. Before the first such op, ask the operator ONCE
   with `AskUserQuestion` (name the scratch-org create + version create), and on a yes
   record it: `node ${CLAUDE_PLUGIN_ROOT}/harness/record-consent.mjs --gate sf-deep-audit-ops --answer "<operator's exact yes>" --target <repo>`.
   The PreToolUse hook (`hooks/sf-ops-gate-hook.mjs`) is the fail-closed backstop: without
   it, `sf org create scratch`, `sf project deploy`, and `sf package version create` are
   **DENIED** — and the `standup-org.mjs`/`teardown-org.mjs` engines step 9 uses for the
   scratch-org lifecycle verify the SAME recorded token before running (no new consent).
   **Promotion (step 10) is a SEPARATE, distinctly-worded ask** — this consent
   does NOT cover it. A skipped ask means the op is denied, not silently run.

Every Bash tool call runs in a **fresh shell** — an `export` never carries to the
next call — so the banner-disable flags must sit at the **top of every Bash block
that runs `sf`** in this skill, on their own line above the `sf` command. The CLI's
update-availability banner otherwise prints to stdout ahead of the JSON payload and
corrupts `--json` parsing. Prepend this line to each `sf` fence below:

```bash
export SF_AUTOUPDATE_DISABLE=true SF_DISABLE_AUTOUPDATE=true
```

1. **Verify the namespace prerequisites.** A managed 2GP requires a registered namespace LINKED to the Dev Hub. The namespace lives in a plain signup Developer Edition org (the "namespace holder" — don't use the Dev Hub itself, it can't be linked). Verify headlessly:

   ```bash
   export SF_AUTOUPDATE_DISABLE=true SF_DISABLE_AUTOUPDATE=true
   sf data query -o {NS_HOLDER_ALIAS} -q "SELECT NamespacePrefix, OrganizationType FROM Organization"
   ```

   `NamespacePrefix` must show the registered namespace. Verify the Dev Hub link headlessly too (note: the object has no `Status` field):

   ```bash
   export SF_AUTOUPDATE_DISABLE=true SF_DISABLE_AUTOUPDATE=true
   sf data query -o {DEVHUB_ALIAS} -q "SELECT Id, NamespacePrefix FROM NamespaceRegistry" --json
   ```

   If registration or linking fails, two common gotchas:

   | Symptom | Cause | Fix |
   |---|---|---|
   | Setup → Package Manager renders "This content is blocked" | Classic Setup page served in a cross-domain iframe; third-party-cookie blocking kills it | Open it top-level: `https://{my-domain}.develop.my.salesforce.com/0A2?setupid=Package` — or allow cookies for `[*.]salesforce.com` / `[*.]force.com` / `[*.]visualforce.com` |
   | Namespace Registry link fails: "The org you are logging in to must be a Developer Edition org with a registered namespace" | (a) browser autofill logged the popup into the Dev Hub instead of the namespace DE org; (b) the namespace wasn't actually saved; (c) the target org has Dev Hub enabled (can't be linked) | Run the query above against the DE org first, then type that org's exact username into the popup |

   Both registration steps are browser-only. Generate the links (never assume a local browser can launch):

   ```bash
   export SF_AUTOUPDATE_DISABLE=true SF_DISABLE_AUTOUPDATE=true
   sf org open -o {NS_HOLDER_ALIAS} --path "/0A2?setupid=Package" --url-only   # Setup → Package Manager (classic page, opened top-level)
   sf org open -o {DEVHUB_ALIAS} --path "/lightning/setup/NamespaceRegistry/home" --url-only   # Setup → Namespace Registry → Link Namespace
   ```

2. **Prepare `sfdx-project.json`.** Execute `cat sfdx-project.json` and bring it to this shape:

   ```json
   {
     "packageDirectories": [
       {
         "path": "force-app",
         "default": true,
         "package": "{MCP_NAME}",
         "versionNumber": "0.1.0.NEXT",
         "postInstallScript": "MCPPostInstall",
         "ancestorVersion": "HIGHEST"
       }
     ],
     "namespace": "{NAMESPACE}",
     "sourceApiVersion": "66.0"
   }
   ```

   - `sourceApiVersion`: 66.0 is the floor for the MCP metadata shapes. Check the current GA before going higher — as of June 2026, a package cut at an API version newer than a not-yet-upgraded customer instance fails to install.
   - `postInstallScript` is load-bearing for steps 8–11; set it now and step 4 keeps it alive.
   - `ancestorVersion: "HIGHEST"` — **only after your first version is released.** On a first-ever cut it fails the build with `ErrorNoMatchingAncestorError` (and even scratch-org creation in the project fails with `NoMatchingAncestorError` unless you pass `--no-ancestors`). Pattern: omit it for the first cut, add it immediately after promoting 0.1.0.

3. **Create the package — explicitly Managed.** Pass `--package-type Managed` explicitly — an installable AgentExchange listing must be Managed, and `postInstallScript` requires it. Execute:

   ```bash
   export SF_AUTOUPDATE_DISABLE=true SF_DISABLE_AUTOUPDATE=true
   sf package create --name "{MCP_NAME}" --package-type Managed --path force-app -v {DEVHUB_ALIAS}
   ```

   Verify via the Container Options column:

   ```bash
   export SF_AUTOUPDATE_DISABLE=true SF_DISABLE_AUTOUPDATE=true
   sf package list -v {DEVHUB_ALIAS}
   ```

   If an Unlocked package with this name already exists from an earlier attempt, execute `sf package delete --package "{MCP_NAME}" -v {DEVHUB_ALIAS}` and recreate. Unlocked packages also reject `postInstallScript` — Managed is required twice over. On sf CLI ≥ 2.137.7 the `--package-type` flag is required (no default), so the unlocked-by-default trap is retired on current CLIs; the explicit-flag habit stands for older installs.

4. **THE GUARD — diff `sfdx-project.json` after EVERY package command.** Execute:

   ```bash
   git diff sfdx-project.json
   ```

   `sf package create` and `sf package version create` can silently rewrite this file — in our runs the packageDirectories entry **lost `"postInstallScript"` and `"default": true`**. If that goes unnoticed, the install handler (the UEC-grant-drop mitigation, step 8) never runs on customer installs, and nothing tells you. Restore any dropped keys with Edit immediately. Re-run this guard after steps 3, 8, and 9 — make it muscle memory.

5. **Apply the namespacing rules to the metadata.** Three rules, each learned from a failed deploy or a runtime failure:

   | Component | Rule | Getting it wrong looks like |
   |---|---|---|
   | Permission set → External Credential principal | Must use the namespaced form: `<externalCredentialPrincipal>{NAMESPACE}__{MCP_NAME}-{PRINCIPAL_NAME}</externalCredentialPrincipal>` (format: `<ExternalCredentialName>-<PrincipalName>`, e.g. `ns__MyMCP-MCPAuthentication` — the scaffold wizard's principal name is `MCPAuthentication`) | Deploy fails with `invalid cross reference id` |
   | ESR `namedCredential` / `namedCredentialReference` | May stay **unprefixed** in source — the platform normalizes both to the prefixed form on install (verified by retrieving installed ESRs from subscriber orgs) | n/a — do not hand-prefix these |
   | ESR name + label vs. Named Credential name + label | Must match exactly (documented known issue). Convention: `{MCP_NAME}.namedCredential-meta.xml` + `{MCP_NAME}.externalServiceRegistration-meta.xml` with identical labels | MCP tool validation fails at runtime |

6. **Package a CspTrustedSite for the MCP server origin.** Salesforce removed the default `*.salesforce.com` egress wildcard effective 2026-02-28 (KB 005135034); a missing Trusted URL is the canonical first suspect when the agent runtime bare-fast-fail-500s (a high-probability first check, not documented platform behavior — the orchestrator surfaces it in the deployed-package audit). Shipping the Trusted Site in the package pre-provisions the subscriber org's allowlist entry so customers never hit it as a manual setup step — the googleMapsMCP reference package also ships CSP Trusted Sites to pre-provision its allowlist entries (theirs img-src, for rendering returned map images). Write `force-app/main/default/cspTrustedSites/{MCP_NAME}_MCP.cspTrustedSite-meta.xml`:

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <CspTrustedSite xmlns="http://soap.sforce.com/2006/04/metadata">
       <context>All</context>
       <description>MCP server origin — pre-provisions the Trusted URL so the Agentforce runtime can reach the server without a manual allowlist step.</description>
       <endpointUrl>https://mcp.example.com</endpointUrl>
       <isActive>true</isActive>
       <isApplicableToConnectSrc>true</isApplicableToConnectSrc>
       <isApplicableToFontSrc>false</isApplicableToFontSrc>
       <isApplicableToFrameSrc>false</isApplicableToFrameSrc>
       <isApplicableToImgSrc>false</isApplicableToImgSrc>
       <isApplicableToMediaSrc>false</isApplicableToMediaSrc>
       <isApplicableToStyleSrc>false</isApplicableToStyleSrc>
   </CspTrustedSite>
   ```

   `endpointUrl` is the **origin** (no `/mcp` path).

7. **Ship the ESR in the `Incomplete` state — no baked operations.** If the package bakes the tool schema into the ESR (active `<operations>` + a `<schema>` snapshot), **every package upgrade re-stamps the subscriber org's synced schema with the packaged snapshot** — stale the moment your server's tool descriptions drift. Post-upgrade symptoms: runtime "tool failed validation" (no `tools/call` egress), tools wedged un-toggleable in Manage Tools, and GACK `-1826465994` on Save. `Incomplete` lets the platform hydrate the tool list live from your server, per org — the googleMapsMCP reference packages its ESR this way. Verify headlessly:

   ```bash
   grep -c "<operations>" force-app/main/default/externalServiceRegistrations/{MCP_NAME}.externalServiceRegistration-meta.xml   # want: 0
   grep "<status>" force-app/main/default/externalServiceRegistrations/{MCP_NAME}.externalServiceRegistration-meta.xml          # want: Incomplete
   ```

   Independent of the operations state, the ESR's `<systemVersion>` must be pinned to a value valid for the package's target API version — the v67 source default is rejected on a v66 cut (the pinned value that works for a 66.0 package is `8`).

   If a subscriber org is already wedged from a baked-schema upgrade, the recovery runbook lives in `/sf-security-review-toolkit:install-and-verify-package`. Also put "after upgrading: Manage Tools → Save" in your subscriber upgrade notes regardless.

8. **Generate the post-install handler (the install-time UEC grant drop).** A Salesforce known issue (documented in the MCP Client Partner Technical Guide, the login-gated partner doc): the packaged permission set's read grant on `UserExternalCredential` is **silently dropped during install** — we reproduced it on 3 of 3 subscriber installs. Without that grant the runtime cannot resolve the External Credential and the MCP tools never enable (the agent-side symptom is silent tool filtering — the deployed-package audit's permission-chain verification in `/sf-security-review-toolkit:install-and-verify-package` catches it).

   Read `templates/MCPPostInstall.cls` and `templates/MCPPostInstallTest.cls` from this skill's directory, replace `MyMCP` with the partner's MCP name, and Write them to `force-app/main/default/classes/` with standard `-meta.xml` companions (`apiVersion` matching `sourceApiVersion`, `status` Active). The reference implementation is `GoogleMapsMCPPostInstall.cls` in https://github.com/mvogelgesang/sf-mcp-registration-api-key. What the handler does:

   - Assigns the packaged perm set to the **installer** AND the **Platform Integration User** — found deterministically by username `cloud@{orgId18}` / email `noreply@{orgId18}` (18-char org id, lowercased); the integration user is what makes the egress callout at runtime
   - Verifies the perm set actually carries the `UserExternalCredential` read grant; when missing, creates and assigns a fallback perm set carrying only that grant — an **unmanaged** one created at install time, because an install script cannot modify metadata belonging to its own managed package (patching the packaged perm set would fail)
   - Idempotent throughout — query-before-insert, `Database.insert(..., false)` — safe on re-runs and upgrades
   - Namespace-aware perm-set lookup: derives the namespace from `String.valueOf(MCPPostInstall.class)`, queries `WHERE Name = :dev AND NamespacePrefix = :ns` first, falls back to `NamespacePrefix = null`. This mattered in the wild: a subscriber org had a local perm set with the identical developer name, and a bare `WHERE Name = :dev LIMIT 1` would have grabbed the wrong one
   - Apex trivia that bites when extending the handler: identifiers cannot end in an underscore (`HttpRequest list_` fails at the declaration) — keep snake_case tool names out of Apex variable names

   Confirm `"postInstallScript": "MCPPostInstall"` is in `sfdx-project.json`, then **re-run the step 4 guard** — package commands are exactly what drops it. Deploy the classes to the dev org (`sf project deploy start --source-dir force-app/main/default/classes -o {ORG_ALIAS}`; if deploying alongside the credentials and perm set, follow the two-step ordering in the footnote), then run the tests before packaging:

   ```bash
   export SF_AUTOUPDATE_DISABLE=true SF_DISABLE_AUTOUPDATE=true
   sf apex run test --class-names MCPPostInstallTest -o {ORG_ALIAS} --code-coverage --result-format human --wait 10
   ```

9. **Create the package version.** Gate it on a **namespaced scratch-org deploy** first: `sf project deploy start` into a scratch org created under your namespace is the mandatory validation step before `sf package version create` — metadata element values are best-effort until they survive a namespaced deploy. Create that scratch org through the org engine, run from the project root so the project's namespace applies:

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/harness/standup-org.mjs --consent --def-file config/project-scratch-def.json --target <repo>
   ```

   with the definition carrying the MCP feature — `"features": ["Einstein1AIPlatform"]` plus the `EinsteinGptSettings` settings block (`Einstein1AIPlatform` enables third-party MCP server registration; the older `Chatbot` feature is retired — as of June 2026 it fails org creation with `INVALID_INPUT: Chatbot is not a valid Features value` — and `botSettings` has failed the scratch settings deploy with `ProblemDeployingSettings`; omit both unless you need them). The engine always passes `--no-ancestors` — exactly right on this path, since this skill only runs while the package has no released version — creates the org under the toolkit alias `sf-srt-org-<runId>`, and records the manifest its paired `teardown-org.mjs` deletes from (name-guarded: only orgs the engine created are deletable; it rides the step-0 `sf-deep-audit-ops` consent, nothing new to ask). Before promoting, test-install the beta into a **namespace-less** scratch org (a second engine run without `--def-file`, outside the namespaced project root; betas install fine into scratch orgs) and run the post-install battery from `/sf-security-review-toolkit:install-and-verify-package` — cheaper to catch an install-time problem before the promote is burned. After the version builds, test-install it into the same org to verify the perm sets auto-assign. When the orgs have served their purpose, delete each with `node ${CLAUDE_PLUGIN_ROOT}/harness/teardown-org.mjs --consent --run-id <id>`. Then execute:

   ```bash
   export SF_AUTOUPDATE_DISABLE=true SF_DISABLE_AUTOUPDATE=true
   sf package version create --package "{MCP_NAME}" --code-coverage --installation-key-bypass --wait 30 -v {DEVHUB_ALIAS}
   ```

   `--code-coverage` is required for promotion. Then run the step 4 guard again: a new `packageAliases` entry is expected; a vanished `postInstallScript` is not.

10. **Promote the version to released — SEPARATE PERMANENCE CONSENT (fail-closed).**
    `sf package version promote` PERMANENTLY releases a 2GP version: it can never be
    deleted, un-promoted, or hidden. Before running it, ask the operator a SECOND,
    distinctly-worded `AskUserQuestion` that spells out this irreversibility (this is NOT
    covered by the step-0 deep-audit consent), and only on an affirmative yes record it:
    `node ${CLAUDE_PLUGIN_ROOT}/harness/record-consent.mjs --gate sf-package-promote --answer "<operator's exact yes>" --target <repo>`.
    The PreToolUse hook (`hooks/sf-ops-gate-hook.mjs`) **DENIES** `sf package version promote`
    until that `sf-package-promote` consent is recorded — a skipped ask means the promote is
    denied, not silently run. Beta versions cannot install into the Trialforce-template test orgs the MCP Client Partner Technical Guide prescribes — exact error: `Unable to install beta package ... only in sandbox or Developer Edition organizations` (yes, even though those orgs are nominally Developer Edition). Promotion requires ≥75% Apex coverage (the template test class lands well above it), and security review needs a released version anyway. Execute:

    ```bash
    export SF_AUTOUPDATE_DISABLE=true SF_DISABLE_AUTOUPDATE=true
    sf package version promote --package "{MCP_NAME}@0.1.0-1" -v {DEVHUB_ALIAS}
    ```

11. **Know the lineage rules before the next cut.**

    | Rule | Detail |
    |---|---|
    | Ancestry | Once a version is released, the next `sf package version create` fails with `ErrorAncestorNotHighestError` unless the package directory declares `"ancestorVersion": "HIGHEST"` — add it right after promoting your first version (it fails a first-ever cut; step 2), and the step 4 guard keeps it |
    | Patch versions | Patch-digit bumps (0.1.0 → 0.1.1) are gated behind a Partner Community case to enable patch versioning. Until granted, bump the minor (0.2.0) |

12. **Hand off.** Install the now-released version into a fresh throwaway org and verify the handler did its job, then run the deployed-package audit pass over it: `/sf-security-review-toolkit:install-and-verify-package`.

## Footnote: source-deploy ordering during development

While iterating on this metadata with CLI source deploys, a combined deploy containing the External/Named Credential **and** the permission set can fail atomically with `invalid cross reference id` (forcedotcom/cli#1781 family — we hit it during namespaced packaging; on current CLIs a non-namespaced combined deploy can succeed). If it fails, split it: deploy the credentials (+ ESR + Apex) first, the perm set second. Package installs handle ordering internally — this bites only source deploys.

## What to explain to the partner

- "Managed is non-negotiable for this path: AgentExchange won't list an Unlocked package, post-install scripts require Managed, and it's what makes upgrades and namespace isolation work."
- "The post-install handler is not optional polish. A Salesforce known issue (see the MCP Client Partner Technical Guide) dropped a permission grant on every install we measured — without the handler, your tools silently never enable for customers."
- "The package ships zero secrets. Each customer enters their own client ID and secret after install — that flow is covered in the install skill."
- "Shipping the ESR Incomplete means the tool list always comes live from your server — upgrades can never wedge a customer's tool state with a stale snapshot."

## Automated vs. manual recap

**Executed headlessly:**
- Namespace verification query; package create / list / delete; version create; promote
- `sfdx-project.json` preparation, post-command diffs, and key restoration
- CspTrustedSite + handler/test generation from templates; ESR state checks; Apex test run

**Required a human in Setup:**
- Registering the namespace in the holder DE org (Setup → Package Manager — classic page, open top-level via the step 1 link)
- Linking the namespace to the Dev Hub (Setup → Quick Find "Namespace Registry" → Link Namespace — popup login; watch browser autofill)
- Filing the Partner Community case if patch versioning is ever needed

## What feeds the next skill

- **Feeds:** a promoted (released) `04t…` package version id that `/sf-security-review-toolkit:install-and-verify-package` stands up in the throwaway org for the deployed-artifact audit. This skill runs only in the no-release-yet fallback; once it produces that released version id, the deep audit rejoins the common path at the install-and-verify step.

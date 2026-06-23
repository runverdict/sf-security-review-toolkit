---
name: bootstrap-cli-auth
description: Install the Salesforce CLI and authenticate the orgs the deployed-org deep audit needs — from a machine that may have no local browser (CI box, remote server, devcontainer). The CLI-gated entry step the autonomous orchestrator invokes only when the operator opts into auditing the deployed package; read-only on the partner's source.
allowed-tools: Bash(node --version) Bash(npm install -g @salesforce/cli) Bash(sf *) Bash(node *harness/record-consent.mjs *) Write AskUserQuestion
---

# Bootstrap CLI Auth

_Adapted from the author's ISV-lifecycle tranche contributed to mvogelgesang/sf-mcp-partner-toolkit (Apache-2.0); see CREDITS.md._

Build a working Salesforce CLI environment from a bare machine and authenticate the org fleet the deployed-org deep audit touches — the Dev Hub, the namespace holder (only if a version still has to be built), and the throwaway scratch/trial orgs the package is stood up in. Headless throughout: this is the auth foundation for installing the partner's *existing* package version into a clean org and auditing the deployed artifact.

## Role in the autonomous deep audit

This is an **opt-in, CLI-gated** step. The autonomous orchestrator invokes it only when **both** are true: `sf` is authed (or the operator agrees to install + auth it here), **and** the operator opted into the deployed-org deep audit (the ✦ OPTIONAL POWER-UP the preflight offers when it senses an `sf` install). The always-on core — the read-only source audit — never reaches this skill; nothing here is required to produce a readiness verdict from source alone.

- **Consumes:** nothing from a prior step — it detects bare-machine state and builds from it. If the orchestrator has already resolved a released `04t…` package version id (by querying the Dev Hub for the package's released version), it carries through as context for what gets installed downstream; this skill only needs the org fleet authed.

## When to use

- On a fresh machine — CI runner, remote server, devcontainer, cloud IDE — where `sf` is not installed or no org is authenticated, and the operator has opted into the deployed-org deep audit
- When the preflight sensed no `sf` auth and offered to install + authenticate it so the deployed package can be audited
- When the deep audit needs more than one org (Dev Hub plus a throwaway test org, and a namespace holder only if a version must still be built) and you want a clean alias scheme before standing the package up
- **NOT** for the always-on source audit — that read-only core never reaches this skill; nothing here is required to produce a readiness verdict from source alone
- **NOT** for scaffolding or authoring an MCP integration from scratch — that à-la-carte path lives in the sibling sf-mcp-partner-toolkit, not here

## Prerequisites

- Node.js present, or installable on this box (the skill installs the `sf` CLI via npm but cannot install Node itself)
- The operator has opted into the deployed-org deep audit (this skill never runs for the source-only readiness pass)
- Network access from this machine to the orgs being authenticated (Dev Hub, namespace holder if building, throwaway test orgs)
- **Either** a forwardable port 1717 (VS Code Remote auto-forwards it; plain SSH uses `ssh -L 1717:localhost:1717`) **or**, for a fully-headless box with no forwardable port, a stored auth URL (`sfdx-url`) captured from a machine that *can* complete a browser login

## The org fleet

The deep audit is never one org, and mixing the roles up is the most expensive class of mistake (a deploy into the Dev Hub, a namespace linked to the wrong org). For the common case — the partner already has a released version and you are auditing it — you need the Dev Hub plus a throwaway test org; the namespace holder only matters if a version still has to be built. Establish the alias convention up front:

| Alias | Org | Role in the deep audit |
|---|---|---|
| `devhub` | Dev Hub / Partner Business Org | `sf` auto-resolution (package version report, security-reviewed flag, permission/endpoint inventory), scratch org management, and — only if a version must be built — package create/version commands |
| `ns-holder` | Plain signup Developer Edition org | Holds the registered namespace — a name reservation only, nothing is built here. **Needed only if `/sf-security-review-toolkit:build-managed-package` has to cut a version because none is released yet**; skip it when auditing an existing release |
| `test-1`, `test-2`, … | Disposable throwaway orgs the package is installed into (a fresh scratch org, or a Trialforce template org created from the Template Id in the MCP Client Partner Technical Guide — a login-gated partner doc distributed through the Salesforce partner program; if you don't have it, ask in the Partnerblazer Slack `#mcp-client` channel or via your Partner Account Manager. Template orgs have a 120-day lifespan, so expect these aliases to expire) | Standing up the deployed artifact and auditing it — exactly what the Salesforce reviewer does when they install your package. One fresh org per pass/fail conclusion; once an org has had MCP registrations created, deleted, or renamed, stop trusting its runtime behavior |
| `golden` | One long-lived validation org | Optional long-lived deep-audit / demo environment |

`/sf-security-review-toolkit:build-managed-package` consumes `devhub` and `ns-holder` (only when a version must be built); `/sf-security-review-toolkit:install-and-verify-package` consumes the `test-*` orgs and `golden`.

## Steps

0. **Consent gate (fail-closed) — record before installing the CLI or logging in any
   org.** This skill installs the CLI globally (`npm install -g`) and writes org
   credentials (`sf org login`) — both modify the host or store secrets. Before either,
   ask the operator ONCE with `AskUserQuestion` (name that it installs `@salesforce/cli`
   globally and captures org auth on this machine), and on an affirmative yes record it:
   `node ${CLAUDE_PLUGIN_ROOT}/harness/record-consent.mjs --gate sf-cli-setup --answer "<operator's exact yes>" --target <repo>`.
   The shipped PreToolUse hook (`hooks/sf-ops-gate-hook.mjs`) is the fail-closed backstop:
   without that recorded consent it **DENIES** `npm install -g` and `sf org login`, so a
   skipped ask means the op is denied, not silently run. A decline → stop; do not install.

1. **Check Node.js.** Execute:

   ```bash
   node --version
   ```

   Must be v18 or later. If missing or too old, direct the user to https://nodejs.org/ — installing Node itself varies by platform and is the one bootstrap step this skill does not automate.

2. **Install the Salesforce CLI.** Execute:

   ```bash
   npm install -g @salesforce/cli
   ```

   Then verify:

   ```bash
   sf --version
   ```

   **Then install the auth plugin** — current CLI builds ship only `access-token` and `jwt` login in core; the `web` and `sfdx-url` flows live in a plugin (a missing flow errors with `Warning: org login web is not a sf command`):

   ```bash
   sf plugins install auth
   ```

3. **Pick the auth flow per org.** Use AskUserQuestion to determine whether this machine has a local browser, then choose:

   | Situation | Flow | Command |
   |---|---|---|
   | Local browser available | Web flow | `sf org login web --alias {ORG_ALIAS}` |
   | Headless box reached over SSH / VS Code Remote / devcontainer | Web flow **through a forwarded port** (step 4) | `sf org login web --alias {ORG_ALIAS}` |
   | Auth already captured on another machine | Stored auth URL | `sf org login sfdx-url --sfdx-url-file authfile.txt --alias {ORG_ALIAS}` |
   | Unattended CI pipeline | JWT bearer flow | `sf org login jwt ...` (see step 7) |

   **The device flow (`sf org login device`) no longer exists** — removed from current tooling (verified on sf CLI 2.137.7 + plugin-auth 4.4.1, June 2026). If you find it referenced in older guides, substitute the forwarded-port web flow below.

4. **Headless auth via the forwarded-port web flow.** The web-server flow binds `localhost:1717` on the machine running the CLI and prints a login URL. On a headless box the trick is getting the human's browser to reach that port:

   - **VS Code Remote-SSH / devcontainers**: ports are auto-forwarded — have the human run the command in the editor's integrated terminal, click the printed URL, and log in; the OAuth redirect tunnels back automatically.
   - **Plain SSH**: reconnect with `ssh -L 1717:localhost:1717 {user}@{host}` first, then the printed URL works in the human's local browser.

   ```bash
   sf org login web --alias {ORG_ALIAS} --instance-url https://login.salesforce.com
   ```

   (`--instance-url https://test.salesforce.com` for sandboxes.) The login lands in the box's shared CLI auth store, so an agent session on the same machine picks the alias up immediately. If no port can be forwarded at all, fall back to the stored-auth-URL transfer (step 5) from any machine that can log in.

5. **Capture stored auth for re-use.** Once any org is authenticated, capture its auth URL so the same org can be authorized on another machine without a human:

   ```bash
   sf org display --target-org {ORG_ALIAS} --verbose --json
   ```

   The `result.sfdxAuthUrl` field (format `force://...`) is the portable credential. Store it in a secrets manager. To re-authenticate anywhere, write it to a file and execute:

   ```bash
   sf org login sfdx-url --sfdx-url-file authfile.txt --alias {ORG_ALIAS}
   ```

   **The auth URL is a credential — it embeds a refresh token. Never commit it, never paste it into an issue, and delete the temp file after use.** Note: `--verbose` only surfaces `sfdxAuthUrl` for orgs authorized via a flow that mints a refresh token (the web flow does); JWT-authorized orgs have none to export.

6. **Repeat per fleet org.** Run the chosen flow once per alias (`devhub`, `ns-holder`, `test-1`, `golden`). Then set the defaults so subsequent commands don't need `-o` flags:

   ```bash
   sf config set target-dev-hub=devhub
   sf config set target-org=test-1
   ```

7. **CI-grade auth (brief).** For fully unattended pipelines, use the JWT bearer flow: `sf org login jwt --username {USERNAME} --client-id {CONSUMER_KEY} --jwt-key-file server.key --alias {ORG_ALIAS}`. It requires a certificate and a connected app (or External Client App) configured in the org — setup is involved enough that we defer to the official walkthrough: "Authorize an Org Using the JWT Bearer Flow" in the Salesforce DX Developer Guide. The forwarded-port web flow plus stored auth URLs covers most partner-journey automation without that setup cost.

8. **Verify the fleet.** Execute:

   ```bash
   sf org list
   ```

   Confirm every alias is present and connected, and that the default org and default Dev Hub markers point where you expect. Then spot-check each alias:

   ```bash
   sf org display -o {ORG_ALIAS} --json
   ```

   Record each alias's org ID and instance URL — the rest of the deep-audit steps reference them when debugging. If everything is green, hand off to `/sf-security-review-toolkit:teardown-mcp-registration` to provision a clean throwaway org, then `/sf-security-review-toolkit:install-and-verify-package` to stand up the package — or, only if no released version exists yet, `/sf-security-review-toolkit:build-managed-package` first. (Building the integration from scratch is out of scope here — that à-la-carte path lives in the sibling sf-mcp-partner-toolkit.)

## The `--url-only` convention

Convention across the deep-audit steps (`/sf-security-review-toolkit:build-managed-package`, `/sf-security-review-toolkit:install-and-verify-package`, `/sf-security-review-toolkit:teardown-mcp-registration`): **never assume the machine can launch a browser.** Whenever a human must perform a Setup step, generate a clickable deep link instead of opening one:

```bash
sf org open -o {ORG_ALIAS} --path "/lightning/setup/NamedCredential/home" --url-only
```

This prints the URL (the human opens it on whatever machine has their browser) rather than trying to launch one locally. Always state the Setup breadcrumb path next to the link, e.g. *Setup → Security → Named Credentials*. The printed URL carries an active session token — treat it like a credential and don't log it.

## Error recovery

| Symptom | Cause | Fix |
|---|---|---|
| Commands that worked yesterday now fail with an expired access/refresh token error | Refresh token revoked or expired (admin revoked sessions, org token policy) | Re-run the web flow for that alias; stored auth URLs minted from the old token are dead too — re-capture |
| `Warning: org login web is not a sf command` | The auth plugin isn't installed — core CLI ships only `access-token`/`jwt` login | `sf plugins install auth` (step 2) |
| `sf org login web` starts but the printed URL never completes login | The OAuth redirect can't reach `localhost:1717` on this box | Forward the port (VS Code Remote does it automatically; plain SSH: `ssh -L 1717:localhost:1717`), or fall back to a stored auth URL (step 5) |
| A deploy or query lands in the wrong org | Default `target-org` points elsewhere | `sf org list` shows the default markers; fix with `sf config set target-org={ORG_ALIAS}`, and pass `-o` explicitly in anything scripted |
| A login popup authenticated the *wrong* org — e.g., a Setup flow that asks you to log into a second org silently lands in your Dev Hub | Browser password-manager autofill submitted saved credentials for a different org on the shared login domain | Verify which org you actually hit before proceeding (`sf org display`, or `SELECT NamespacePrefix, OrganizationType FROM Organization` via `sf data query`); redo the popup in a private window with autofill off. In our experience this is the classic failure inside the Dev Hub's Namespace Registry link flow — full namespace-linking context in `/sf-security-review-toolkit:build-managed-package` step 1 |
| Alias points to an org that no longer exists | Scratch/test org expired or was deleted | `sf org list --clean` removes stale scratch-org auth entries; for deleted non-scratch orgs (e.g. an expired Trialforce test org) use `sf org logout --target-org {ORG_ALIAS}` |
| `sfdxAuthUrl` missing from `sf org display --verbose` | Org was authorized via JWT (no refresh token) | Capture the auth URL from a machine that used the web flow, or keep using JWT directly in that pipeline |

## What to explain to the partner

- "This server never needs its own browser. The CLI's web flow binds `localhost:1717` here and prints a login URL; we forward that port to your machine — VS Code Remote does it automatically, plain SSH uses `ssh -L 1717:localhost:1717` — so you approve the login in your own browser and the session lands here. If no port can be forwarded, we capture a stored auth URL from a machine that *can* log in and replay it here."
- "The auth URL we captured is a password-equivalent credential. It goes in your secrets manager, never in git."
- "We alias every org by its role — devhub, ns-holder, test-1, golden — because the packaging journey needs different org types for different jobs, and the expensive mistakes all start with 'I thought I was logged into the other org.'"
- "Test orgs are disposable on purpose. Runtime conclusions only count when they come from a fresh org — see `/sf-security-review-toolkit:install-and-verify-package` for why."

## Automated vs. manual recap

**Executed headlessly:**
- Node.js and `sf` CLI version checks; CLI installation via npm
- Auth-plugin installation, web-flow initiation, stored-auth-URL capture and replay, JWT login (given cert + client ID)
- Alias assignment, default org / default Dev Hub configuration, fleet verification (`sf org list`, per-alias `sf org display`)

**Required a human:**
- Installing Node.js itself, if absent
- Completing each web-flow login in a browser (via the auto-forwarded port in VS Code Remote, or an `ssh -L 1717:localhost:1717` tunnel)
- Logging into popups for browser-based flows — with the autofill wrong-org hazard above in mind
- Creating fleet orgs that don't exist yet — the namespace-holder org's role and registration gotchas are covered in `/sf-security-review-toolkit:build-managed-package` step 1 (needed only when a version must be built); throwaway scratch/template org provisioning is handled by `/sf-security-review-toolkit:teardown-mcp-registration` as part of standing up a clean org for the deployed-package audit

## What feeds the next skill

- **Feeds:** an authenticated `sf` fleet (aliases + defaults set) that `/sf-security-review-toolkit:teardown-mcp-registration` (clean-org provisioning), the optional `/sf-security-review-toolkit:build-managed-package` step, and `/sf-security-review-toolkit:install-and-verify-package` all consume. Records each alias's org id + instance URL so the rest of the deep audit can reference them when debugging.

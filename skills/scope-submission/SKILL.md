---
name: scope-submission
description: Phase 0 of security review prep. Detects the partner's architecture elements (managed package, MCP server, external web app/API, Canvas, LWC/Aura, mobile) from the repo plus an optional live MCP probe, runs the partner-program preflight gates, compiles which baseline requirements apply, and writes the scope manifest every later phase keys off. Use first, or whenever the architecture has changed since the last manifest.
allowed-tools: Read Grep Glob Write Bash(ls *) Bash(find *) Bash(git ls-files*) Bash(git log *) Bash(git rev-parse *) Bash(sf package *) Bash(sf data query *) Bash(sf project retrieve *) Bash(sf org *) Bash(sf sobject *) Bash(curl *) AskUserQuestion
---

# Scope Submission

Establish what is actually being submitted before anything is audited, generated,
or scanned. The output is `<target>/.security-review/scope-manifest.json` — the
input contract for every downstream skill. A wrong manifest is the most expensive
mistake in the journey: the audit fans out agents against the wrong surface set,
the artifacts describe the wrong architecture, and the DAST scope comes up
narrower than the architecture diagram — which reads to a reviewer as an
incomplete submission. This phase mirrors what Salesforce's own checklist-builder
wizard does (baseline: `process-checklist-builder`): select architecture
elements, get the requirement list those elements imply.

## When to use

- Starting review preparation on a repo with no `.security-review/` state
- The architecture changed since the last manifest — new endpoints, MCP tools
  added or removed, a package that grew a UI — re-scope before re-auditing
- NOT for auditing code (`/sf-security-review-toolkit:audit-codebase`), running
  scans (`/sf-security-review-toolkit:run-scans`), or checking overall progress
  (`/sf-security-review-toolkit:security-review-journey`)

## Prerequisites

- The partner's repo checked out locally (the `<target>`)
- `${CLAUDE_PLUGIN_ROOT}/baseline/requirements-baseline.yaml` readable
- The operator available — half this phase is questions no tool can answer
- Optional: a **staging** URL for any live MCP server (see step 3 for why
  staging matters)
- Optional power-up: `sf` (Salesforce CLI) installed and authed to the
  partner's **DevHub** — with that and operator consent, step 4 auto-resolves a
  dozen wizard inputs from the Tooling API into `sf-autoresolve.json`. Absent
  it the phase still completes; those inputs fall back to operator-asked /
  code-inferred

## Steps

1. **Check baseline currency.** Read the baseline; if the newest `last_verified`
   is older than 90 days, warn before doing anything else (CONVENTIONS §4 — the
   review process changed three times in eighteen months).

2. **Detect architecture elements from the repo, with evidence per element.**
   Record *how* each was detected — the operator and downstream skills need to
   be able to dispute it:

   | Element | Detection |
   |---|---|
   | Managed package | `sfdx-project.json`, `force-app/` tree, `*-meta.xml`; record package type (1GP/2GP), namespace, and whether Apex/LWC/Aura/Flows exist |
   | Agentforce agent | `Bot`/`BotVersion`, `GenAiPlugin`/`GenAiPlanner`/`GenAiFunction`, `genAiPromptTemplate` metadata, or invocable actions wired to a planner — the **AgentExchange listing** signal. Emit a distinct `agentforce` element; it rides the package element but is what makes the `agentforce-*` requirements apply. **Do NOT infer it from `managed-package` alone** — a plain managed package that ships no agent is not an Agentforce listing, and asserting `agentforce-*` requirements against it manufactures blockers it can never satisfy (the cold-start finding this row closes) |
   | MCP server | MCP SDK imports, JSON-RPC `initialize`/`tools/list` dispatch in the partner's own code, an `/mcp`-shaped route they serve |
   | MCP client integration (inbound) | Code that **calls into** a Salesforce-hosted MCP server — a Connected/External Client App config, `mcp_api`+`refresh_token` scope requests, a PKCE+ECA OAuth flow targeting `*.salesforce.com`, redirect-URI handlers pointed at SF. This is the Direction-A signal (see the classifier below) |
   | External web app / API | Server frameworks in manifest files (FastAPI/Express/Rails/Spring…), route definitions, deploy configs; list every base URL the docs and configs claim |
   | Canvas app | `signed_request` handling, Canvas SDK references, `frame-ancestors` CSP scoped to Salesforce domains |
   | LWC / Aura | `lwc/` and `aura/` trees under `force-app/` — rides the package element but adds the web-client audit dimensions |
   | Mobile app | iOS/Android project trees, Mobile SDK dependencies |
   | Async workers | Queue/scheduler config (Celery/Sidekiq/BullMQ/cron) |
   | Identity surface | OAuth/token endpoints, login/reset routes, `/.well-known/*` |

   Two failure modes live here, one per direction. An element you fail to
   detect is a dimension that silently never runs — when detection is
   ambiguous, ask rather than omit. And the inverse: **a Named Credential or
   External Service Registration pointing at someone else's MCP server makes
   the partner an MCP *client*, not an MCP server operator** — do not put an
   `mcp-server` element in scope unless the partner's own code serves the
   protocol. Scoping a package-only solution as if it shipped an MCP server
   drags in the entire MCP requirement track (DAST of MCP + identity
   endpoints, tools metadata, per-user authz proof) for surfaces that don't
   exist, and the submission reads as confused.

   **Agentforce detection self-check — a miss silently drops 12 requirements.**
   The `agentforce-*` baseline requirements (incl. the three BLOCKER auto-fails:
   VerifiedCustomerId scoping, user-controlled record refs, third-party-LLM)
   now gate **solely** on the `agentforce` element, not on `managed-package`. So
   a failure to detect the agent under-prepares the partner for an entire
   AgentExchange track with no error. Before writing the manifest, run a
   deterministic confirmation: grep `force-app/` for any
   `Bot`/`GenAiPlugin`/`GenAiPlanner`/`GenAiFunction`/`genAiPromptTemplate`
   metadata (e.g. `grep -rlE '<(Bot|GenAiPlugin|GenAiPlanner|GenAiFunction)' force-app`
   plus `find force-app -name '*.genAiPlugin-meta.xml' -o -name '*.bot-meta.xml'`).
   If any matches but no `agentforce` element was emitted, that is a detection
   miss — emit the element. (This is the inverse of the MCP-client trap above:
   there, over-detection drags in a track; here, under-detection drops one.)

   **Classify the listing direction — it branches every MCP auth/transport
   check.** A single merged "MCP auth check" emits contradictory guidance,
   because inbound and outbound MCP have *opposite* auth rules; conflating
   them is a common and costly analysis error. Set `listingDirection` in the
   manifest from what you detected:

   | Direction | What the partner ships | Auth/transport rule profile |
   |---|---|---|
   | **B — outbound MCP server** (the common ISV case) | Agentforce/an external agent calls *into* the partner's own MCP server (`mcp-server` element present, `mcp-client-integration` absent) | Auth is **optional**; if present it must be OAuth 2.0 and **`client_credentials` is the natural fit, NOT forbidden**. **Per baseline `mcp-per-user-authz-mechanics`: per-user auth is NOT supported for outbound — no end-user identity is forwarded at tool-call time; the Auth Code flow that exists is service-account-only. Two-user authz proof = SF-side gating + tenant-level scoping, never per-user token forwarding. Encode this; do not let later analysis re-open per-user for outbound.** |
   | **A — inbound MCP client integration** (the partner ALSO ships a client that calls a Salesforce-hosted MCP server) | An `mcp-client-integration` element is detected alongside or instead of the server | **ECA (External Client App) required, PKCE required, `client_credentials` FORBIDDEN**, scopes `mcp_api`+`refresh_token`, plus the ECA four codified controls (PKCE, refresh-token rotation, 30-day idle refresh TTL, refresh-token IP allowlist ≤256 IPs; localhost/custom-scheme callbacks exempt), plus IP monitoring as recommended-not-codified. |

   A partner that ships **both** carries **both** profiles — never collapse them
   into one. Record `listingDirection` as `"B"`, `"A"`, or `"both"`; downstream
   MCP-surface and identity dimensions read it to pick which rule set to assert.
   When neither MCP element is present, omit `listingDirection` entirely.

3. **Probe the live MCP server — after confirming which environment you are
   pointing at.** Ask the operator for the URL *and* whether it is staging or
   production; never probe a URL whose environment you haven't confirmed, and
   never probe production silently. The handshake itself is read-only, but the
   endpoints recorded here become the DAST target list in
   `/sf-security-review-toolkit:run-scans` — a production URL recorded without
   an environment label becomes a production DAST scan three phases later.
   Label every endpoint.

   With consent, a single pass captures everything the manifest needs:

   ```bash
   curl -sS -D - -X POST {MCP_URL} \
     -H 'Content-Type: application/json' \
     -H 'Accept: application/json, text/event-stream' \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"{NEWEST_BASELINE_VERSION}","capabilities":{},"clientInfo":{"name":"scope-probe","version":"0.1"}}}'
   ```

   Offer the newest protocol version listed in the baseline entry
   `mcp-protocol-versions-supported` and validate what the server negotiates
   against that same entry. Under Streamable HTTP every JSON-RPC message is
   its own HTTP POST — the two follow-ups below are **separate curl
   invocations**, not continuations of the first request's stream. The `-D -`
   on the initialize call prints response headers for exactly one reason: if
   the server issued an `Mcp-Session-Id` header, replay it verbatim on every
   subsequent request — a server that issued one will reject (typically
   `400`) requests that omit it. If no header came back, omit it entirely;
   inventing a value is its own failure mode. Complete the handshake, then
   list tools:

   ```bash
   # Follow-up 1: handshake completion — a notification (no id);
   # expect 202 Accepted with an empty body
   curl -sS -D - -X POST {MCP_URL} \
     -H 'Content-Type: application/json' \
     -H 'Accept: application/json, text/event-stream' \
     -H 'Mcp-Session-Id: {SESSION_ID_FROM_INITIALIZE_RESPONSE}' \
     -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

   # Follow-up 2: tool inventory
   curl -sS -D - -X POST {MCP_URL} \
     -H 'Content-Type: application/json' \
     -H 'Accept: application/json, text/event-stream' \
     -H 'Mcp-Session-Id: {SESSION_ID_FROM_INITIALIZE_RESPONSE}' \
     -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
   ```

   Responses may arrive as plain JSON or as a one-event SSE body
   (`data: {...}` lines) — both are valid Streamable HTTP; parse the `data:`
   payload in the latter case rather than concluding the server is broken.
   From the `tools/list` response, capture the tool count and check metadata
   completeness (baseline: `mcp-tools-list-metadata-completeness`). Record
   the transport —
   the Agentforce client is Streamable-HTTP-only, so a STDIO-only or
   legacy-SSE-only server is a preflight **blocker**, not an audit finding
   (baseline: `mcp-transport-streamable-http-only`). Record the auth mode: a
   `401` + `WWW-Authenticate` means OAuth-protected; note which flow the
   server accepts against `mcp-auth-no-auth-or-client-credentials`. If probe
   credentials are involved, use them and discard them — nothing they touch
   goes in the manifest. No live URL, or no consent? Record the MCP facts
   from code as `"probed": false` and move on — downstream skills re-probe.

4. **SF-CLI auto-resolution (optional, operator-consented DevHub connection).**
   When `sf` is already authed to a DevHub — or the operator consents to auth
   one — run the Tooling surface to turn ~a dozen human-asked / code-guessed
   inputs into deterministic evidence, and write
   `<target>/.security-review/sf-autoresolve.json`.
   This is **optional and opt-in**: no DevHub, no consent, or `sf` not
   installed → skip the whole step, record `"sfAutoResolved": false` in the
   manifest, and let the operator-asked / code-inferred values stand. Never
   block the phase on it.

   First, two hard guardrails before any query — skipping either is how this
   step produces confident garbage:

   - **Describe before you query.** Run `sf sobject describe` (Tooling) against
     the **live** DevHub for every Tooling object you are about to touch
     (`SubscriberPackageVersion`, `ApexCodeCoverageAggregate`, `PermissionSet`,
     `ObjectPermissions`, `FieldPermissions`, plus `RemoteSiteSettings` /
     `CspTrustedSites` on the version) to **confirm the field exists in this
     org's API version** before relying on it. The dev-doc pages are
     JS-rendered and were corroborated only from secondary sources — never
     hardcode a query you have not described. A query against a field the org
     doesn't expose fails the whole pass; describe-first makes it degrade
     per-field instead.

     ```bash
     sf sobject describe --use-tooling-api --sobject SubscriberPackageVersion --target-org <devhub> --json
     ```

   - **Per-class coverage from a finished 2GP version is unreliable.**
     `CodeCoveragePercentages` / `ApexCodeCoverageAggregate` on code already
     compiled into a released 2GP version can come back empty (open `sf`
     issues #2239/#3499/#688). Treat the
     `audit-deployed-package` / scratch-org test run as the **primary** coverage
     path; the version-report number here is corroborating, not authoritative.
     Label it as such in `sf-autoresolve.json` so nobody downstream treats an
     empty coverage field as "0% covered."

   Then resolve, each row written to `sf-autoresolve.json` with its source
   command and a `provenance: "automated"` marker (this is agent-run evidence,
   distinct from owner-run scans):

   | Auto-resolved | `sf` / Tooling source | Feeds |
   |---|---|---|
   | Promotion / coverage / validation-skipped | `sf package version report --json` (`IsReleased`, `CodeCoveragePercentages`, `HasPassedCodeCoverageCheck`, `ValidationSkipped`) + `ApexCodeCoverageAggregate` per-class | The promotion gate (step 5) **and the exact under-covered class names** — far better than a bare 75% pass/fail |
   | **Already security-reviewed?** (the keystone) | Tooling SOQL `SELECT IsSecurityReviewed FROM SubscriberPackageVersion WHERE Id='04t...'` | **If true, SKIP the whole flow — the package already passed.** ⚠ caveat: `IsSecurityReviewed` may only flip true *after* a review; for an own not-yet-reviewed package confirm via the `describeSObject` + a live query that the field is queryable and reads `false`, and never report "already reviewed" off an absent/null field |
   | **External-endpoint inventory** | Tooling SOQL over `RemoteSiteSettings` + `CspTrustedSites` for the package version | **This is THE DAST target list AND the API-callouts doc** — the exact host list reviewers scrutinize, fed straight into the `endpoints` array and `/sf-security-review-toolkit:run-scans` scope. Flag every `http://` (non-TLS), every wildcard host, and every host with **no matching Named Credential** |
   | **Permission matrix** (the #1 review category) | Tooling SOQL over `PermissionSet` / `ObjectPermissions` / `FieldPermissions` | The access-control artifact; **flag `PermissionsViewAllRecords` / `PermissionsModifyAllData` (ViewAll/ModifyAll) over-grants** on packaged permission sets — the most common authZ rejection |
   | **Per-class coverage** | `ApexCodeCoverageAggregate` (with the empty-coverage caveat above) | Names the under-covered classes for the operator to fix — corroborating only, scratch-org run is primary |
   | Auth/integration topology + secrets posture | `sf project retrieve start -m NamedCredential` / `-m ExternalCredential` / `-m SecuritySettings` (**secrets excluded** — the XML carries config, not secret values) | Credential-storage attestation; **flag a callout host that appears in `RemoteSiteSettings`/`CspTrustedSites` but has NO Named Credential — that is the signature of a likely hardcoded secret.** The retrieved `SecuritySettings` (session timeout, password/session policy, trusted-IP ranges) flags a weak posture before the reviewer logs in — but label it **"test-org evidence,"** the posture of the org the reviewer logs into, NOT packaged behavior |

   Two refusals are absolute. **Never write a secret to
   `sf-autoresolve.json`** — the retrieve commands return credential *config*,
   not values; if any captured field looks like a token/key/password, drop it
   and note where the secret belongs (env var, vault), per CONVENTIONS §6.
   And **never silently substitute auto-resolved values for the operator's
   own claims** — when an auto-resolved fact contradicts an operator answer
   (e.g. the operator said "promoted" but `IsReleased=false`), surface the
   conflict for the operator to reconcile; the CLI is evidence, not an
   override.

   **Hard honesty boundary — what the CLI does NOT touch.** The toolkit
   auto-answers the *evidence*; the *submission act and all business/legal
   context* are **Partner-Console-UI-only with no CLI/API path** and stay
   runbook + `AskUserQuestion` (the partner-program gates in step 5, then the
   later phases): the partner agreement, **namespace REGISTRATION**
   (`NamespaceRegistry` records are **not API-writable** — the DevHub
   "Link Namespace" button is the only path; you can *read* the linked
   namespace via SOQL but never create it), listing creation, review contacts,
   the architecture questionnaire, doc/credential entry, the per-attempt review
   fee (baseline: `process-review-fee` — read it at run time), the Submit
   button, and status monitoring. The toolkit auto-answers the evidence;
   the human owns the Console residue.

5. **Run the partner-program preflight gates.** These are operator questions,
   not detections (baseline: `process-partner-program-prerequisites`) — a
   submission can be technically perfect and still blocked here:

   | Gate | Question | Why it blocks |
   |---|---|---|
   | Partner agreement | Signed and active? | Nothing can be submitted without program enrollment |
   | Partner Business Org | PBO exists, and you have Partner Console access? | The Security Review Wizard lives in the Partner Console |
   | Package promoted | Is the package version promoted/released? If step 4 ran, `sf-autoresolve.json` already carries `IsReleased` / `ValidationSkipped` — read it; otherwise verify with `sf package version list`. A **beta 2GP cannot be submitted** | Review attaches to a released version; beta versions are rejected at intake |
   | Namespace | Registered and linked to the Dev Hub? Step 4 can *read* the linked namespace, but **registration stays a manual DevHub "Link Namespace" action** (`NamespaceRegistry` is not API-writable) | Packaging and listing identity both hang off it |
   | Listing | Created in the Partner Console? | The review attaches to a listing object |
   | Review contacts | Primary **and** backup contact designated? | Reviewer questions to an unmonitored inbox stall the clock silently |

   Note the review fee for paid listings — the settled per-attempt
   semantics: Returned submissions and false-positive-only responses
   resubmit free; any code change (even mixed FP + true-positive responses)
   means a remediated retest — new version, new paid attempt. The amount is
   now verified — read it from `process-review-fee` at run time, and treat
   it as perishable (confirm in the Partner Console at submission). The
   entry's one open facet: whether the schedule applies as-is to
   MCP-server/API-solution listings — route that to the operator's Partner
   Account Manager. Record every answer in the manifest under
   `operatorConfirmed`; skip the package-promoted gate only when no package
   element was detected.

6. **Ask what code cannot reveal.** Listing type (managed package, external
   MCP server, both), multi-tenant or single-tenant-per-deployment (drives the
   tenant-isolation dimension), the claimed security model (isolation
   mechanism, auth design — recorded as *claims* for the audit to verify,
   never as facts), and a one-line product description for the shared audit
   context.

7. **Compile "which requirements apply to you" — deterministically.** Run
   `node ${CLAUDE_PLUGIN_ROOT}/harness/applicable-requirements.mjs
   --elements <comma-list of detected element types> --json`. It filters every
   baseline entry's `applies_to` against the detected elements (`all` always
   matches; the intersection is a pure set operation) and returns the exact
   `applicableBaselineIds` + count. Use its output verbatim as the manifest's
   `applicableBaselineIds` — do **not** hand-filter or narrate an estimate; the
   element→requirement mapping is data, and computing it by judgment is what let
   agentforce-*/mcp-* requirements leak onto a non-agent, non-MCP package. The
   applicable count is the **exact length of that list** by construction; a
   count that exceeds the baseline total is a counting bug, not a result. The baseline has a fixed
   total number of entries, so an "applicable" count that exceeds it is a
   counting bug, not a result. Two special cases:
   mobile elements have **no baseline coverage** — record the element, state
   the gap, and point the operator at Salesforce's mobile-app review guidance
   rather than pretending the toolkit audits it. And surface every matching
   entry whose `verification` is `conflicting` with its `conflicts` text —
   these go to the operator as "confirm via Partner Console / your Partner
   Account Manager / partner Slack before relying on this," never silently
   resolved (CONVENTIONS §4). One journey-shaping fact is settled and worth
   stating at scope time: `mcp-listing-managed-package` is verified — every
   AgentExchange listing is an installable managed package, so an
   AgentExchange MCP listing carries BOTH the package-scanning track (the
   thin registration package) and the external-endpoint/DAST track for the
   server itself. Scope both from the start.

8. **Write the manifest** to `<target>/.security-review/scope-manifest.json`.
   Exact shape:

   ```json
   {
     "version": 1,
     "generatedAt": "2026-06-12T14:00:00Z",
     "repoCommit": "<git rev-parse HEAD>",
     "listingType": "managed-package | mcp-server | both",
     "listingDirection": "B | A | both",
     "elements": [
       { "type": "managed-package", "evidence": "sfdx-project.json + force-app/ (Apex, LWC)" },
       { "type": "agentforce", "evidence": "Bot + GenAiPlanner + genAiPromptTemplate in force-app/ — AgentExchange listing (omit when no agent metadata exists)" },
       { "type": "mcp-server", "evidence": "JSON-RPC dispatch in src/mcp/router.*; live probe 2026-06-12" }
     ],
     "endpoints": [
       { "url": "https://staging.example.com", "environment": "staging", "role": "mcp | identity | web-app | api | canvas", "probeConsent": true }
     ],
     "mcp": {
       "url": "https://staging.example.com/mcp",
       "probed": true,
       "protocolVersion": "2025-06-18",
       "toolCount": 24,
       "authType": "oauth2-client-credentials | no-auth",
       "authExpectations": {
         "direction": "B",
         "clientCredentialsAllowed": true,
         "ecaRequired": false,
         "pkceRequired": false,
         "perUserAuthSupported": false,
         "requiredScopes": [],
         "note": "Direction B (outbound): auth optional, client_credentials is the natural fit; per-user NOT supported (baseline mcp-per-user-authz-mechanics)"
       }
     },
     "packages": [
       { "name": "Example", "dir": "force-app/", "type": "2GP", "namespace": "examplens", "promoted": true }
     ],
     "securityModelClaims": { "tenancy": "multi-tenant", "isolation": "<operator's claim, verbatim, unverified>" },
     "applicableBaselineIds": ["scan-code-analyzer-v5-required", "endpoint-ssl-labs-a-grade", "..."],
     "conflictingBaselineIds": ["endpoint-ssl-labs-a-grade"],
     "operatorConfirmed": {
       "partnerAgreementSigned": true,
       "partnerConsoleAccess": true,
       "packagePromoted": true,
       "namespaceRegisteredAndLinked": true,
       "listingCreated": false,
       "reviewContactsDesignated": true
     },
     "sfAutoResolved": true
   }
   ```

   `listingDirection` is set per the step-2 classifier — `"B"` (outbound MCP
   server, the common ISV case: `client_credentials` OK, auth optional,
   per-user NOT supported), `"A"` (inbound MCP client integration: ECA + PKCE
   required, `client_credentials` forbidden, `mcp_api`+`refresh_token` scopes),
   or `"both"` — and `mcp.authExpectations` carries the resolved rule profile
   the MCP-surface and identity dimensions read. For Direction A, set
   `"clientCredentialsAllowed": false`, `"ecaRequired": true`,
   `"pkceRequired": true`, and `"requiredScopes": ["mcp_api", "refresh_token"]`;
   `perUserAuthSupported` stays `false` for outbound (Direction B) per baseline
   `mcp-per-user-authz-mechanics` regardless. Omit `listingDirection` and
   `authExpectations` when no MCP element exists.

   `sfAutoResolved` records whether step 4 ran — `true` when a DevHub connection
   resolved the Tooling surface into `sf-autoresolve.json` (which downstream
   skills read alongside this manifest), `false` when skipped (no auth / no
   consent / no `sf`). Downstream skills must not assume `sf-autoresolve.json`
   exists; gate on this flag.

   Omit `mcp` and `packages` blocks for elements that don't exist. `packages`
   is an array: an AgentExchange MCP listing commonly carries **two** packages
   — a thin MCP-registration package (ESR + External/Named Credential +
   permission set) **and** a separate Canvas/UI-embed package — so record each
   detected `sfdx-project.json` / package as its own entry, never collapse them
   into one. No credentials in this file, ever (CONVENTIONS §6) — if the
   operator pasted a URL with an embedded token, strip it and say where the
   secret belongs (env var, vault).

9. **Show the manifest summary and get an explicit confirm/correct from the
   operator** before recommending the next phase. This is the cheap moment to
   fix scope; every later phase multiplies an error here. Then state the
   staleness contract out loud: the manifest is a snapshot at `repoCommit`.
   Downstream skills spot-check it against the repo (changed
   `sfdx-project.json`, changed MCP tool count, new routes) and will bounce
   back here when it drifts — re-running this skill after an architecture
   change is normal operation, not failure.

## Automated vs. manual recap

Automated: baseline currency check, element detection with evidence, the
Direction A/B classification, the optional MCP handshake + `tools/list` capture
(with environment confirmation), the optional SF-CLI auto-resolution
(`describeSObject`-gated Tooling SOQL/retrieve → `sf-autoresolve.json`:
promotion/coverage/validation-skipped, `IsSecurityReviewed`, the
RemoteSiteSettings + CspTrustedSites endpoint inventory, the permission matrix,
NamedCredential/ExternalCredential/SecuritySettings posture — secrets excluded),
baseline filtering, conflict surfacing, manifest writing.
Manual (no CLI/API path, by design — the Console residue): confirming which
environment a probe URL points at, the operator consent to connect a DevHub,
every partner-program gate answer, namespace **registration** (DevHub Link-
Namespace button only), listing-type decision, security-model claims, and the
final confirmation of the element list. Nothing in this phase verifies
security — it decides what will be examined.

## What feeds the next skill

`scope-manifest.json` (and, when `sfAutoResolved` is true, the sibling
`sf-autoresolve.json`) drives dimension selection in
`/sf-security-review-toolkit:audit-codebase` (which refuses to run without the
manifest and spot-checks it for drift) — including which MCP auth/transport rule
profile to assert, from `listingDirection` + `mcp.authExpectations`. It feeds
artifact selection in `/sf-security-review-toolkit:generate-artifacts` (the
auto-resolved RemoteSiteSettings + CspTrustedSites inventory becomes the
API-callouts doc; the permission matrix becomes the access-control artifact;
the test-org `SecuritySettings` posture is labeled "test-org evidence"), scan
scope and DAST environment labels in `/sf-security-review-toolkit:run-scans`
(the same endpoint inventory becomes the DAST target list), and the gate
answers reappear in the readiness verdict from
`/sf-security-review-toolkit:compile-submission`.

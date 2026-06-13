---
name: scope-submission
description: Phase 0 of security review prep. Detects the partner's architecture elements (managed package, MCP server, external web app/API, Canvas, LWC/Aura, mobile) from the repo plus an optional live MCP probe, runs the partner-program preflight gates, compiles which baseline requirements apply, and writes the scope manifest every later phase keys off. Use first, or whenever the architecture has changed since the last manifest.
allowed-tools: Read Grep Glob Write Bash(ls *) Bash(find *) Bash(git ls-files*) Bash(git log *) Bash(git rev-parse *) Bash(sf package *) Bash(curl *) AskUserQuestion
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
   | MCP server | MCP SDK imports, JSON-RPC `initialize`/`tools/list` dispatch in the partner's own code, an `/mcp`-shaped route they serve |
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

4. **Run the partner-program preflight gates.** These are operator questions,
   not detections (baseline: `process-partner-program-prerequisites`) — a
   submission can be technically perfect and still blocked here:

   | Gate | Question | Why it blocks |
   |---|---|---|
   | Partner agreement | Signed and active? | Nothing can be submitted without program enrollment |
   | Partner Business Org | PBO exists, and you have Partner Console access? | The Security Review Wizard lives in the Partner Console |
   | Package promoted | Is the package version promoted/released? Verify with `sf package version list` — a **beta 2GP cannot be submitted** | Review attaches to a released version; beta versions are rejected at intake |
   | Namespace | Registered and linked to the Dev Hub? | Packaging and listing identity both hang off it |
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

5. **Ask what code cannot reveal.** Listing type (managed package, external
   MCP server, both), multi-tenant or single-tenant-per-deployment (drives the
   tenant-isolation dimension), the claimed security model (isolation
   mechanism, auth design — recorded as *claims* for the audit to verify,
   never as facts), and a one-line product description for the shared audit
   context.

6. **Compile "which requirements apply to you."** Filter every baseline entry's
   `applies_to` against the detected elements (`all` always matches). This is
   the toolkit's mirror of the checklist-builder step. Two special cases:
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

7. **Write the manifest** to `<target>/.security-review/scope-manifest.json`.
   Exact shape:

   ```json
   {
     "version": 1,
     "generatedAt": "2026-06-12T14:00:00Z",
     "repoCommit": "<git rev-parse HEAD>",
     "listingType": "managed-package | mcp-server | both",
     "elements": [
       { "type": "managed-package", "evidence": "sfdx-project.json + force-app/ (Apex, LWC)" },
       { "type": "mcp-server", "evidence": "JSON-RPC dispatch in src/mcp/router.*; live probe 2026-06-12" }
     ],
     "endpoints": [
       { "url": "https://staging.example.com", "environment": "staging", "role": "mcp | identity | web-app | api", "probeConsent": true }
     ],
     "mcp": {
       "url": "https://staging.example.com/mcp",
       "probed": true,
       "protocolVersion": "2025-06-18",
       "toolCount": 24,
       "authType": "oauth2-client-credentials | no-auth"
     },
     "package": { "type": "2GP", "namespace": "examplens", "promoted": true },
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
     }
   }
   ```

   Omit `mcp` and `package` blocks for elements that don't exist. No
   credentials in this file, ever (CONVENTIONS §6) — if the operator pasted a
   URL with an embedded token, strip it and say where the secret belongs
   (env var, vault).

8. **Show the manifest summary and get an explicit confirm/correct from the
   operator** before recommending the next phase. This is the cheap moment to
   fix scope; every later phase multiplies an error here. Then state the
   staleness contract out loud: the manifest is a snapshot at `repoCommit`.
   Downstream skills spot-check it against the repo (changed
   `sfdx-project.json`, changed MCP tool count, new routes) and will bounce
   back here when it drifts — re-running this skill after an architecture
   change is normal operation, not failure.

## Automated vs. manual recap

Automated: baseline currency check, element detection with evidence, the
optional MCP handshake + `tools/list` capture (with environment confirmation),
`sf package version list` promotion check, baseline filtering, conflict
surfacing, manifest writing.
Manual: confirming which environment a probe URL points at, every
partner-program gate answer, listing-type decision, security-model claims, the
final confirmation of the element list. Nothing in this phase verifies
security — it decides what will be examined.

## What feeds the next skill

`scope-manifest.json` drives dimension selection in
`/sf-security-review-toolkit:audit-codebase` (which refuses to run without it
and spot-checks it for drift), artifact selection in
`/sf-security-review-toolkit:generate-artifacts`, scan scope and DAST
environment labels in `/sf-security-review-toolkit:run-scans`, and the gate
answers reappear in the readiness verdict from
`/sf-security-review-toolkit:compile-submission`.

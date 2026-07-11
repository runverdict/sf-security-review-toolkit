---
name: generate-artifacts
description: Phase 2 of security review prep. Drafts every reviewer-facing submission artifact from the partner's actual code, config, and live server — AuthN/AuthZ flow, architecture/data-flow diagram, data-sensitivity classification, access control, exposed tools + OpenAPI, FP-dossier skeleton, and the written-policy / org-config pack (incident-response, data-retention + deletion-on-uninstall, DR/backup, vuln-remediation SLA, hosting architecture, prior-pen-test attestation) as owner-completed stubs — each claim citation-backed, each artifact provenance-footered, all cross-read for contradictions. Use after the audit ledger is clean of critical/high findings.
allowed-tools: Read Grep Glob Write Write(**/.security-review/artifact-input.json) Bash(ls *) Bash(find *) Bash(cat *) Bash(git log *) Bash(git rev-parse *) Bash(curl *) Bash(node *harness/artifact-gate.mjs *) Bash(node *harness/build-artifact-engine.mjs *) Bash(node *harness/write-drafted-content.mjs *) Bash(node *harness/capture-org-mcp.mjs *) AskUserQuestion
---

# Generate Artifacts

Draft every submission artifact that can be drafted from code into
`<target>/docs/security-review/`, using the templates in
`${CLAUDE_PLUGIN_ROOT}/templates/`. The governing rule for this whole phase:
**generate from the as-built code, never from the design docs or memory.** The
reviewer reads these artifacts and then attacks exactly what they describe — a
claim the live system contradicts costs more than an honestly documented gap,
and the most common way partners produce such a claim is documenting what the
system was *intended* to do. Every artifact is a draft for owner review; every
claim is either traceable to code the generator actually read (path:line) or
marked owner-input.

## When to use

- After `/sf-security-review-toolkit:audit-codebase` left no open
  critical/high findings — an AuthN/AuthZ doc written over an open auth
  finding documents the vulnerable flow for the reviewer
- Refreshing artifacts after an architecture change, before a re-review, or
  when the consistency check (step 11) flagged drift
- NOT for the questionnaire, checklist compilation, or readiness verdict
  (`/sf-security-review-toolkit:compile-submission`), NOT for scan evidence
  (`/sf-security-review-toolkit:run-scans`), and NOT for the test-environment
  runbook (`/sf-security-review-toolkit:prepare-test-environment`)

## Prerequisites

- `<target>/.security-review/scope-manifest.json` — refuse to run without it
  (artifact selection keys off the listing type); route to
  `/sf-security-review-toolkit:scope-submission`
- Ideally `<target>/.security-review/audit-ledger.json` plus the latest audit
  report — the "strong controls observed" section feeds the control
  narratives and refuted entries seed the FP dossier. Degrade gracefully
  without them, but say plainly the drafts are thinner for it
- For the live captures (step 3): a reachable server URL with its environment
  confirmed by the operator, same consent discipline as scope-submission
- Templates in `${CLAUDE_PLUGIN_ROOT}/templates/` — this phase consumes
  `submission-checklist.md.tmpl`, `authn-authz-flow.md.tmpl`,
  `data-flow-diagram.md.tmpl`, `data-sensitivity.md.tmpl`,
  `access-control.md.tmpl`, `exposed-tools-list.md.tmpl`,
  `mcp-server-details.md.tmpl`, `api-endpoints-spec.md.tmpl`,
  `fp-dossier.md.tmpl`, and the WI-19 written-policy
  pack (`incident-response-plan.md.tmpl`, `data-retention-deletion.md.tmpl`,
  `disaster-recovery-backup.md.tmpl`, `vulnerability-remediation-sla.md.tmpl`,
  `hosting-architecture.md.tmpl`, `prior-pentest-attestation.md.tmpl`)

## Steps

1. **Run the gates.** Three, in order. (a) Manifest exists and is not stale —
   spot-check it against the repo (tool count, route tree, `sfdx-project.json`
   presence); drift means re-scope first. (b) **Run the artifact gate —
   `node ${CLAUDE_PLUGIN_ROOT}/harness/artifact-gate.mjs --target <target>
   --json`** and honor its `mode` exactly. This is the ENFORCED form of the
   AuthN/AuthZ withhold; do not reason about the ledger by hand, and never skip
   it on a resume — the gate is a pure function of the **ledger** (the toolkit is
   an audit tool: it always produces the full report, so there is no STOP mode
   and no election to consult), so it returns the same verdict whether this skill
   is entered fresh, on resume, or invoked directly (a path that trusted the
   journey's triage *narration* instead would generate over an open hole — that
   is the bug this gate closes):
   - **`flagged`** — open critical/high. Generate the full NOT-READY set, but for
     every artifact id in the gate's `suppress` list **do NOT draft it** — write
     the withheld placeholder instead (step 6, AuthN/AuthZ). Pass the gate result
     verbatim into `artifact-input.json` (drafting mechanism below): the assembler
     ENGINE-ENFORCES the suppress list — it drops every suppressed `key` before
     injection, so a withheld doc physically cannot be drafted by the Workflow (you
     still write the placeholder driver-side). The `suppress` list fires purely from
     the ledger (an open critical/high in the authN/authZ category), independent of
     any election. The verdict still carries the open findings verbatim
     (`compile-submission`).
   - **`clean`** — no open critical/high; generate the full set normally.
   (c) Baseline currency — read every `artifact-*` entry
   the selected set references and warn when any `last_verified` is older
   than 90 days (CONVENTIONS §4). Surface `verification: conflicting` entries
   to the operator now, not mid-draft. As of the 2026-06 sweep none touch
   this phase's artifact set — the formerly conflicting
   `mcp-per-user-authz-mechanics` is now verified (settled negatively: no
   per-user auth on the Agentforce MCP client), and that settled identity
   model is load-bearing for step 6's AuthN/AuthZ draft.

2. **Select the artifact set from the manifest.** MCP-server listings carry
   the full required-artifacts table (baseline ids `artifact-org-credentials`
   through `artifact-agentexchange-questionnaire-na-reasons`); package
   listings add `artifact-package-architecture-usage-docs` and
   `artifact-user-documentation`. Partition every row into three buckets and
   show the partition before drafting anything:

   | Bucket | Rows | Owner |
   |---|---|---|
   | Drafted this phase | AuthN/AuthZ flow · architecture/data-flow · data sensitivity · access control · exposed tools (templated: `exposed-tools-list.md.tmpl`, step 9a) · API-spec wrapper (templated: `api-endpoints-spec.md.tmpl`, step 9c — the evidence pair itself stays capture-emitted) · FP-dossier skeleton · endpoint inventory half of MCP server details (templated: `mcp-server-details.md.tmpl`, step 9b; credential cells owner-run) · the written-policy pack (IR plan · retention + deletion-on-uninstall · DR/backup · vuln-remediation SLA · hosting architecture · prior-pen-test attestation) as owner-completed stubs | this skill |
   | Other phases | DAST reports (`/sf-security-review-toolkit:run-scans`) · test environment + utterances (`/sf-security-review-toolkit:prepare-test-environment`) · questionnaire + final checklist (`/sf-security-review-toolkit:compile-submission`) | route, don't duplicate |
   | Owner-run, registered only | org credentials · third-party credentials + two test users · every credential-bearing cell | human |

   The credential rule has no exceptions: this skill registers
   credential-bearing rows as owner-run and **refuses to write credential
   values into any artifact or state file** (CONVENTIONS §6). If the operator
   pastes a secret mid-session, say where it belongs (env var, vault) and keep
   it out of every output.

3. **Capture the live surface once — it is the shared input everything else
   reconciles against.** Two captures, both into
   `<target>/.security-review/evidence/` with dates in the filenames:

   - **`tools/list` from the LIVE server.** The review wants valid, current
     output — a capture from memory, from docs, or from a month-old session
     does not satisfy `artifact-api-endpoints-spec` and a stale capture gets
     rejected (the spirit of baseline `scan-report-freshness`). Run the
     handshake the way scope-submission does (`initialize` →
     `notifications/initialized` → `tools/list`, replaying any
     `Mcp-Session-Id` header), against an operator-confirmed environment,
     never production silently. Then **cross-check the capture against the
     tool registration/dispatch table in code** — the structure that actually
     maps tool names to handlers, wherever the stack puts it (a decorator
     registry, a dispatch dict, a router). Three diff outcomes:
     tools in both (good); tools in code but absent from the capture
     (conditional, feature-flagged, or admin-gated tools — these MUST appear
     in the exposed-tools inventory anyway, because an unlisted-but-callable
     tool the reviewer discovers reads as concealment); tools in the capture
     but not in code (you are probing the wrong deployment — stop and
     re-confirm the URL). The registration/dispatch registry is the SOURCE
     OF TRUTH for the exposed-tools row set (step 4); the capture is the
     cross-check — never invert that. The client/ESR-exposed operation
     surface can be a strict subset of the code registry, and when the
     client-exposed count happens to equal one privilege tier's count, that
     numeric collision is exactly how a refresh silently drafts the subset
     as if it were the whole registry — reconcile the two counts explicitly
     (step 4), never substitute one for the other. While here, check
     metadata completeness per
     baseline `mcp-tools-list-metadata-completeness`: every tool needs a
     name, an honest description, and schemas — gaps are findings for the
     draft, not silent fixes.
   - **The org-effective Agentforce API-Catalog view — ADDITIVE, deep-audit-gated.**
     The `tools/list` above is the CLIENT-advertised surface; it does not reveal
     which tools the Salesforce ORG actually ingested and ACTIVATED. When the
     deployed-package deep audit stood up a throwaway org (an
     `.security-review/org-standup.json` pointer exists AND the partner MCP server
     was registered), run `harness/capture-org-mcp.mjs` to capture what the org
     sees: which registered MCP servers Agentforce ingested into its API-Catalog,
     and — the unique evidence neither the code registry nor the raw `tools/list`
     reveals — which of their tools/prompts/resources are `active` and wired as
     callable **agent actions** (`is-agent-action`). It reads the org through
     `sf agent mcp list/get/asset list` (names/ids only — server URL tokens, session
     ids, and auth material are field-allowlisted out) into
     `evidence/mcp-org-effective-<date>.json` plus a provenance sidecar (source
     `org-effective-agentforce-api-catalog`, prod-equivalence PENDING owner
     attestation — captured from the throwaway audit org, not production). It rides
     the SAME recorded `sf-deep-audit-ops` consent that stood the org up —
     **no new gate**; the opt-in `--fetch` live callout to the partner's MCP endpoint is
     covered by the same token and recorded as a names-only delta. This lane is
     strictly **ADDITIVE** and gated on the deep-audit opt-in: in the source-only
     journey there is nothing to capture, the engine degrades to `no-mcp-servers`,
     and the exposed-tools artifact stays code+protocol-derived.
   - **The API spec from framework introspection, never hand-written.** A
     hand-authored OpenAPI drifts from the routes the moment someone edits a
     handler, and the reviewer imports the spec and diffs it against live
     behavior. **Best source — the container-isolated mirror capture.** When
     the throwaway-DAST chain ran, `harness/capture-openapi.mjs` captured the
     framework's own spec from the stood-up mirror into
     `evidence/openapi-<date>.json` with its provenance sidecar
     (`openapi-<date>.provenance.json`, source:
     `container-isolated-throwaway-mirror`). When that pair exists, emit THAT
     capture as `artifact-api-endpoints-spec` — it IS the framework-generated
     spec (real paths, schemas, identity endpoints), captured without touching
     prod on synthetic secrets; the ONLY line that stays `PENDING` is the
     **prod-equivalence attestation** (the spec came from the isolated mirror;
     only the owner attests production matches it) — never mark the whole
     artifact PENDING, and never present the capture as the production spec.
     No mirror capture? Generate from the framework's own model: FastAPI's
     `/openapi.json` (or `app.openapi()` offline), Express via its swagger
     integration, Rails via rswag, Spring via springdoc — whatever the stack
     exposes. Include the identity surface (OAuth/token/discovery paths) and
     any path aliases, not just the MCP route; the spec seeds the DAST scope
     in `/sf-security-review-toolkit:run-scans`, and an identity endpoint
     missing here becomes an identity endpoint missing from the scan
     (baseline `dast-scope-includes-identity-endpoints` — a first-try fail).
     If the framework has no introspection, generate from the route
     definitions in code and mark every path `code-derived` in the spec
     description so the owner knows to verify against live. Validate the
     spec parses before calling it an artifact. The human-readable wrapper
     document over the pair (`docs/security-review/api-endpoints-spec.md`)
     is drafted through the templated fan-out (step 9c,
     `api-endpoints-spec.md.tmpl`) — it points at the evidence pair and
     carries the sidecar's honesty notes; it never regenerates the JSON.

   No reachable server, or no consent? Generate the code-derived halves,
   mark every live-capture slot `PENDING live capture`, and say so in the
   recap — downstream skills re-probe, and an honest PENDING beats a
   fabricated capture by the full width of CONVENTIONS §2.

4. **Write the exposed-tools inventory** (baseline
   `artifact-exposed-tools-list` — the tiered tool inventory lives on THIS
   row, not in the MCP-server-details endpoint doc) from the step-3
   reconciliation. Enumerate the row set from the full code
   registration/dispatch registry — the superset the audit AST-verifies,
   which may be LARGER than the `tools/list`/ESR operation surface the
   client sees; the live capture is the cross-check, never the source of
   truth for the row set, and registry-only tools (admin-gated /
   conditional / approval-tier) are enumerated regardless. One row per
   registry tool, tiered by the privilege tiers the dispatch table actually
   defines (e.g. the read / propose / admin tiering the audit side names
   under `mcpthreat-scope-minimization`); never collapse or drop a tier,
   and a refresh must never replace a fuller prior inventory with a thinner
   subset. Close with the reconciliation statement the checklist's Row 7
   guidance demands, naming all three counts: "the registry defines N tools
   (tiers a/b/c); the client/ESR exposes M operations;
   the org catalog has A active agent actions of the N registered;
   the delta is the X admin + Y conditional/approval tools that are
   registry-resident but not client-listed because…". The org-catalog A (from
   `harness/capture-org-mcp.mjs`, when the deployed-package deep audit ran) is
   CORROBORATING — it uniquely shows which registered tools are actually ACTIVE
   agent actions, grounding the baseline's "including the administrative ones" +
   privilege-tiering ask; the registry N stays the source of truth and A is
   never substituted for N (the same numeric-collision trap: when A happens to
   equal one tier's count, a refresh must not silently draft A as the whole
   registry). A count that doesn't reconcile is a generator
   bug to fix now — every later artifact (access-control matrix,
   data-sensitivity tool map) reconciles against this number, and fudging it
   here propagates the lie three documents deep. The inventory DOCUMENT
   itself is drafted through the templated fan-out (step 9a,
   `exposed-tools-list.md.tmpl`): this step produces the reconciliation and
   the counts, which travel into `facts` and the step-9a `focus` — the
   drafting agent cannot read the captures, so what this step assembles is
   all it will ever see of the live surface.

5. **Mine the audit for the controls narrative.** From the latest audit
   report, lift the "strong controls observed" entries — they were written
   for exactly this reuse — into the control sections of the artifacts that
   follow, each keeping its file-level evidence. Two hard rules: a claim the
   audit **refuted** never appears as a control (cross-check every control
   claim against the ledger before writing it), and controls the audit never
   examined are written as code observations with citations, not as
   audit-confirmed. Running without a ledger? Every control claim downgrades
   to "code reading, unaudited" in the provenance footer.

### Drafting mechanism — data-driven (P2), NOT a hand-authored Workflow

The drafting fan-out (steps 6–11 below, including 9a–9c) is assembled from DATA and run through the
shipped, tested template — exactly as the audit phase does (`build-audit-engine.mjs` +
`workflow-template.mjs`). **Do NOT hand-author a per-run Workflow script** with inline
prompt strings (`focus` text, nested backticks, regex): that improvisation is the
JS-escaping/parse-error class the audit phase already retired, and a cold run plus the
0.8.20 verification both tripped on it. Steps 6–11 (including 9a–9c) are the
per-artifact **content contracts** — they define what goes in each artifact's `focus`
string; they are no longer hand-coded into a script. One constraint shapes every
contract: drafting agents CANNOT read `.security-review/` or anything outside the
repo and have no network, so every LIVE input a contract needs (the tools/list
capture, the org-catalog counts, the OpenAPI path count, the negotiated protocol
version, the org-registration host) is injected DRIVER-SIDE through `facts` and the
per-artifact `focus` — and when a live input is absent, the contract says so and the
template's slot reads `PENDING live capture`, never a fabricated value.

- **(a) Assemble `artifact-input.json`** at `<target>/.security-review/` — the drafting
  plan as DATA (the `focus` strings and the shared facts live HERE, never in JS):

  ```json
  {
    "runDate": "<YYYY-MM-DD>",
    "facts": "<the shared authoritative facts — tool inventory + reconciliation (step 4), controls narrative (step 5), the settled org-level identity model + session-ID posture (step 6), hosts/regions + data classes (steps 7-8); the single source of truth every artifact reconciles to. CODE TRUTH OVERRIDES THIS BLOCK: it is an operator-assembled input and can carry a driver error (a cold run wrote 'OpenAI' as the LLM when the code truth was Vertex/Gemini). Every drafting agent VERIFIES each fact it relies on against the actual code/config — the provider/dispatcher, credential storage, egress — and where the code contradicts a fact here, the CODE WINS (the way the data-flow agent already behaves), so a facts-block error never propagates into data-sensitivity/data-retention/authn-authz>",
    "gate": "<paste the step-1b artifact-gate.mjs --json result verbatim>",
    "artifacts": [
      { "key": "authn-authz-flow", "tmpl": "authn-authz-flow.md.tmpl", "out": "docs/security-review/authn-authz-flow.md", "focus": "<the step-6 content contract>" },
      { "key": "data-flow-diagram", "tmpl": "data-flow-diagram.md.tmpl", "out": "docs/security-review/data-flow-diagram.md", "focus": "<the step-7 content contract>" },
      { "key": "exposed-tools-list", "tmpl": "exposed-tools-list.md.tmpl", "out": "docs/security-review/exposed-tools-list.md", "focus": "<the step-9a content contract, carrying the step-4 three-count reconciliation>" },
      { "key": "mcp-server-details", "tmpl": "mcp-server-details.md.tmpl", "out": "docs/security-review/mcp-server-details.md", "focus": "<the step-9b content contract>" },
      { "key": "api-endpoints-spec", "tmpl": "api-endpoints-spec.md.tmpl", "out": "docs/security-review/api-endpoints-spec.md", "focus": "<the step-9c content contract, carrying the step-3 evidence-pair filenames>" }
    ]
  }
  ```

  One `artifacts[]` entry per doc selected in step 2, each `focus` lifted from its step
  below. Put every cross-cutting number in `facts` (tool count, identity model,
  session-ID sentence, hosts/regions, data classes), not just inside one artifact — that
  is what makes the set cross-consistent BY CONSTRUCTION (step 12).

- **(b) Run the assembler** (read-only on source, deterministic):
  `node ${CLAUDE_PLUGIN_ROOT}/harness/build-artifact-engine.mjs --plugin ${CLAUDE_PLUGIN_ROOT} --repo <target> --input <target>/.security-review/artifact-input.json`.
  It reads each `tmpl` (THROWS loud on a missing template), validates each `focus`, and
  **ENGINE-ENFORCES the gate**: every artifact whose `key` is in `gate.suppress` is
  DROPPED before injection (logged `WARN: artifact <key> withheld by the gate — not
  drafted`), so a withheld doc PHYSICALLY cannot be drafted — the same fail-closed
  posture as the audit engine. It writes `<target>/.security-review/artifact-engine.mjs`.

- **(c) Launch it via the Workflow tool with `scriptPath`** = the produced
  `<target>/.security-review/artifact-engine.mjs` (NOT `args` — args arrive as a JSON
  string and the engine fails fast). It fans out one read-only agent per artifact and
  returns `{ drafted: [{ key, out, content }] }`.

- **(d) Write the drafted content with the write harness — never by hand** (the Workflow
  runtime has no filesystem access; the same envelope doctrine as merge-ledger applies:
  point `--result` DIRECTLY at the Workflow task-output file — do not hand-extract
  `.result` or re-parse the envelope):

  `node ${CLAUDE_PLUGIN_ROOT}/harness/write-drafted-content.mjs --repo <target> --result <workflow-task-output-file> --input <target>/.security-review/artifact-input.json`

  It unwraps `{ drafted: [{ key, out, content }] }` (raw envelope or pre-extracted),
  validates EVERY Workflow-returned `out` on its RESOLVED path — inside the repo, under
  `docs/security-review/` or `.security-review/` only, never absolute / traversal /
  `.git/` / through an escaping symlink — and is ALL-OR-NOTHING: one invalid path refuses
  the entire envelope with zero files written (exit 2; re-run the engine, never hand-fix
  a returned path). Valid entries are written byte-exact from the first H1 onward for
  markdown — the harness's deterministic leading-preamble strip drops chatter/leftover
  authoring-header lines above the H1, and no-H1 or non-markdown content stays verbatim
  (parent dirs created inside the allowed roots; overwrite is normal — artifacts
  regenerate per pass); an empty/dead-agent
  draft is SKIPPED LOUDLY so it never blanks a good prior draft; `--input` cross-checks
  `gate.suppress` so a stale/resumed envelope cannot resurrect a withheld doc (the engine
  in (b) remains the enforcement point). For every artifact the gate suppressed, write the
  WITHHELD placeholder driver-side instead (the step-6 withhold text — it is gate-data-
  derived, not envelope content). Then run the step-12 cross-read and the step-13
  provenance footers driver-side.

The content contract each artifact's `focus` carries:

6. **Draft the AuthN/AuthZ flow** from `authn-authz-flow.md.tmpl` (baseline
   `artifact-authn-authz-flow-doc`, plus the § Credential storage section
   doubling as `artifact-credential-storage-attestation`).

   **First, honor the gate (step 1b).** If `authn-authz-flow` is in the gate's
   `suppress` list (`flagged` mode — an open critical/high finding sits in the
   authN/authZ category), **do NOT draft this artifact.** Instead write
   `<target>/docs/security-review/authn-authz-flow.WITHHELD.md` stating: the
   AuthN/AuthZ flow document is withheld because open authN/authZ finding(s)
   `<ids + file:line from the gate's open_authz_findings>` remain unremediated;
   per the toolkit's honesty gate an AuthN/AuthZ flow doc is not generated over
   a live auth hole because it would map the vulnerability for the reviewer; the
   open findings are carried verbatim in the readiness verdict instead; resolve
   the finding(s) and re-run the audit to regenerate.
   Footer it with the same provenance block, then skip the rest of step 6.

   Otherwise (`clean` mode, or `flagged` with no authN/authZ finding) draft it.
   What the agent reads, in trace order:

   - **The middleware/decorator chain, from the entry point.** Find where a
     bearer credential enters (the auth dependency, decorator, or middleware
     the routes actually use — grep for the framework's idiom) and walk the
     real call chain. The actor table (§2) falls out of which token types the
     chain accepts and how it routes between them.
   - **Token issuance routes.** Every route that mints a credential:
     authorization-code + PKCE, client_credentials, refresh, any first-party
     login or SSO handshake. For each, transcribe the validations **in
     execution order from the code** — order is itself a security property
     (a redirect that fires before `redirect_uri` validation is an open
     redirect). The flow you skip is the one the reviewer finds via the
     discovery metadata.
   - **The validation chain on the hot path.** The exact ordered checks
     between "token arrives" and "first business query": lookup form (hash
     compare / signature verify / introspection), expiry, revocation,
     principal liveness, and where the tenant/user context binds for the
     request (session variables, connection-level settings, request context).
     A field-tested pattern worth documenting when present: tokens stored
     only as SHA-256 hashes, with the why (no brute-force surface on
     high-entropy randoms; a per-call KDF would tax the hot path) — reviewers
     ask.
   - **Scope checks and per-tool authz.** Where the scope gate runs (it must
     gate `tools/call` and not just `tools/list` — a client can call a tool
     by name it never saw listed), the role filter, the data-layer tenant
     isolation, per-user visibility. One template §5 block per independent
     layer, each with its negative test named — a layer without a test is a
     claim, not a control.
   - **The platform identity model, stated honestly — mandatory.** The flow
     doc MUST state the settled facts (baseline:
     `mcp-per-user-authz-mechanics`, verified — settled negatively): the
     Agentforce connection authenticates as an ORG-LEVEL identity
     (client_credentials, or the Authorization Code option via External
     Credential — which is SERVICE-ACCOUNT only, and whose
     redirect-allowlist configuration belongs in the doc when used:
     baseline `auth-code-service-account-redirect-allowlist`, i.e. the
     partner's OAuth authorization server allow-lists the Salesforce
     redirect URL used during principal authentication); NO end-user
     identity is forwarded to the server at tool-call time; per-user
     visibility through Agentforce is therefore Salesforce-side gating
     (permission sets / agent + tool access per user) layered on the
     partner's TENANT-level scoping. Never over-claim per-end-user MCP
     enforcement — that over-claim is the one the reviewer falsifies in a
     single probe, and it poisons the credibility of every honest sentence
     around it.
   - **Sequence diagrams from the traced chain, not memory.** Build the
     Mermaid from the call sequence you just walked, participant names
     matching the §2 actor table exactly. A diagram drawn from the
     architect's mental model is precisely the "intended vs. actual" failure
     this phase exists to kill.

   The session-ID sentence (template §1) is mandatory and evidence-backed:
   grep the codebase for any acceptance, forwarding, or storage of a
   Salesforce session ID before writing "never" (baseline
   `fail-sessionid-egress` — the canonical auto-fail; if the answer is
   anything but "never", stop drafting and route back to remediation).
   *Human verifies:* every flow against the running system, deployed token
   TTLs (env-dependent — code shows defaults, not what production runs), and
   the §9 no-hardcoded-secrets signature — which waits for the run-scans
   secret scan, so leave that slot visibly unfilled.

7. **Draft the architecture / data-flow diagram** from
   `data-flow-diagram.md.tmpl` (baseline `artifact-architecture-diagram`;
   contributes the data-flow view to
   `artifact-package-architecture-usage-docs` on a package track). What the
   agent reads:

   - **Deploy config for the boxes**: compose files, k8s manifests,
     Terraform, Procfiles — the services that actually run, their ports, and
     what fronts them (reverse-proxy/TLS-termination config names the edge).
   - **DNS/hosts and base URLs** from configs and the manifest's endpoint
     inventory — every hostname the system answers on or calls out to.
   - **Outbound call sites for the edges**: grep the HTTP-client idioms
     (requests/httpx/axios/fetch/RestTemplate and the stack's SDK clients —
     AI inference SDKs, email gateways, error trackers, payment clients).
     Every outbound call site is an edge; every distinct destination is a
     box and a candidate subprocessor row.
   - **Serializers/response models for the egress ledger** (template §5 —
     the table the reviewer reads most carefully). What leaves the boundary
     is what the response models actually emit — read the serializer/schema
     definitions, not the database schema; a column the serializer never
     emits doesn't egress, and a computed field the serializer adds does.
     Include the explicit NEVER rows (session ID, platform passwords, raw
     tool arguments), and reconcile the "stored on your side" column against
     the AuthN/AuthZ doc's credential-storage table — a contradiction
     between the two is a finding.

   The failure mode reviewers reliably catch: **a diagram that omits the
   AI/LLM egress path.** If any code path sends customer-adjacent text to an
   inference provider, that provider is a hop, an egress-ledger row, and a
   subprocessor row — "it's just an API call" is how the pen test finds an
   undisclosed egress by watching outbound connections, and an undisclosed
   egress costs credibility on the whole submission. State plainly whether
   no-training/no-retention is your technical control or a reliance on the
   provider's terms. *Human verifies:* the deployment facts code cannot see —
   CDN/WAF mode, firewall rules, managed-DB encryption settings, regions,
   subprocessor contract terms — each marked owner-attested in the footer.

8. **Draft the data-sensitivity classification** from
   `data-sensitivity.md.tmpl` (baseline
   `artifact-data-sensitivity-classification`). What the agent reads: the
   MCP tool inventory from step 4 — group tools by the **entities each reads
   or writes** (walk each handler to its data access; the input/output
   schemas plus the queries name the entities), draft one data category per
   entity group, and assign classes by the template's high-water-mark rule
   (a category that can carry a personal-data field classifies up — when in
   doubt, up, never down). Generate the §5 tool→category map from the live
   capture so its count reconciles with step 4's inventory. Draft the §6
   negative assurances only from schema/code truth — a negative assurance
   the pen test falsifies is a serious credibility hit. *Human owns:* the
   business-context column — §1 and every rationale that depends on what a
   field means commercially. An agent cannot know that, and a classification
   without business context reads as generated filler; pre-fill the
   inventory, leave the business judgment visibly to the owner.

9. **Draft access control** from `access-control.md.tmpl` (baseline
   `artifact-access-control-permsets` — the row with the weakest public
   documentation of reviewer expectations; when in doubt, over-document).
   Both sides, each from its primary source:

   - **Salesforce side from package metadata — parse the actual XML, never
     paraphrase docs.** Read every `permissionsets/*.permissionset-meta.xml`
     and profile under the package tree: `objectPermissions` (CRUD per
     object), `fieldPermissions`, `userPermissions` (scan for the dangerous
     ones — modify-all-data, view-all-data, author-apex, manage-users — and
     write the explicit dangerous-permission statement either way),
     `classAccesses`, tab/page visibility, and External Credential principal
     access. If a post-install handler assigns or repairs grants, read the
     handler class and document what it assigns to whom and that it grants
     no more than the permission sets define. No package element in the
     manifest? Write Part A's explicit not-applicable block per the
     template — never delete the heading silently.
   - **Server side from the role/scope definitions in code**: the canonical
     role map (the cascade, single- vs multi-role posture), the scope
     constants, and — for the B.4 matrix — **the tool × scope × role mapping
     from the actual registration/dispatch table, never from docs.** The
     dispatch table is where the per-tool scope tier and role gate actually
     bind; documentation of that mapping drifts, code doesn't. Reconcile the
     matrix row count against step 4's inventory and step 8's tool map, and
     name the negative tests (B.5) that prove the refusals — a low-scope
     token denied a write tool, a peer denied another tenant's data, a tool
     called by name without being listed still refused.

   *Human verifies:* every least-privilege justification ("this is the
   minimum the feature needs" is the owner's claim — the agent can read the
   grant but not the necessity), the dangerous-permission statement, and the
   Part C persona definitions — which become the test users
   `/sf-security-review-toolkit:prepare-test-environment` provisions.

9a. **Draft the exposed-tools inventory artifact** from
   `exposed-tools-list.md.tmpl` (baseline `artifact-exposed-tools-list` —
   the templated form of the step-4 inventory). The `focus` MUST carry the
   step-4 reconciliation VERBATIM — all three counts and the tier breakdown:
   "the registry defines N tools (tiers a/b/c); the client/ESR exposes M
   operations; the org catalog has A active agent actions of the N
   registered; the delta is …" — because the drafting agent cannot read the
   live captures; the counts arrive only through `facts`/`focus`. What the
   agent reads: the code registration/dispatch registry (the row-set source
   of truth — one row per registry tool, tiered by the tiers the dispatch
   table actually defines, each row cited path:line), the gates that keep
   admin/conditional/approval tools off the client surface (§3), and the
   resource/prompt registrations (§4). The template's §1 three-count table is
   STRUCTURAL: N from the registry read, M and A from the injected facts —
   when the org lane is absent, A reads `PENDING — org-effective capture
   absent (source-only run)` and the inventory stays code+protocol-derived;
   when no live `tools/list` capture exists, M reads `PENDING live capture`.
   Never substitute M or A for N (the numeric-collision trap step 4 names —
   a refresh that drafts the client subset as the full registry), and never
   replace a fuller prior inventory with a thinner subset. Metadata gaps
   (name/description/schema, baseline
   `mcp-tools-list-metadata-completeness`) land in §5 as findings.

9b. **Draft the MCP server details** from `mcp-server-details.md.tmpl`
   (baseline `artifact-mcp-server-details` — the endpoint-inventory half;
   the credentials half of that row is owner-run by definition). The `focus`
   MUST carry the live values the agent cannot capture: the negotiated MCP
   protocol version from the step-3 `initialize` capture (or the instruction
   to write `PENDING live capture`), the base-URL host, and — when the
   deep-audit org lane ran — the org-registration `serverUrlHost`, which is
   HOST-ONLY by construction (the capture allowlist discards path, query,
   and any embedded token; never re-derive the full URL). What the agent
   reads: the route definitions for the §1 endpoint table (every reachable
   endpoint including the identity/OAuth/discovery paths, each with its auth
   and citation), the handshake handler for the code-declared protocol
   version(s) and transport, and the session-header handling. §4's external
   components carry URLs and roles from code/config; every credential cell
   is the FIXED text "Supplied separately (owner-run)" — writing a
   credential value anywhere is a CONVENTIONS §6 violation and the write
   harness never receives one.

9c. **Draft the API-endpoints-spec wrapper** from `api-endpoints-spec.md.tmpl`
   (baseline `artifact-api-endpoints-spec` — the HUMAN-READABLE WRAPPER that
   POINTS AT the step-3 evidence pair; do NOT regenerate the JSON spec —
   `capture-openapi.mjs` already emitted `evidence/openapi-<date>.json` plus
   its provenance sidecar, and a second hand-assembled copy is exactly the
   drift the capture exists to end). The `focus` MUST carry the evidence-pair
   FILENAMES, the spec's path count, the capture source, the `tools/list`
   evidence filename, and the sidecar's two honesty notes so the wrapper
   restates them faithfully: scan coverage is CAPTURE-ONLY (the throwaway
   DAST loopback spider does not consume the spec), and prod-equivalence is
   PENDING owner attestation SCOPED to that one line (never mark the whole
   artifact PENDING, never present the capture as the production spec). The
   agent reads the route definitions to draft the §4 human-readable summary
   and the identity-surface column. Degraded mode (no capture pair this
   run): the wrapper says so, the spec is generated from the framework's own
   model or route definitions per step 3, and EVERY §4 row's Source reads
   `code-derived`; the `tools/list` row reads `PENDING live capture`.

10. **Instantiate the FP-dossier skeleton** from `fp-dossier.md.tmpl`
    (baseline `scan-false-positive-documentation` plus the disposition half
    of `artifact-dast-scan-reports`). This phase seeds;
    `/sf-security-review-toolkit:run-scans` fills further. Seed from:
    the ledger's **refuted** entries (the verifier's reasoning is a
    ready-made non-exploitability argument — reuse it verbatim where a
    scanner will flag the same construct); the ledger's **accepted_risk**
    entries (each becomes an Accepted-residual register row, status DRAFT
    until the owner signs the residual-risk line — the agent never accepts
    risk on the owner's behalf); any scan outputs already sitting in
    `.security-review/evidence/` (register them in the source-artifacts
    cell); and the template's §4 pre-classified intentional-controls table
    for the deliberate controls scanners flag by design — each entry still
    requires a real code citation, pre-classification is not pre-excusal.
    §5 (genuine findings) stays a single PENDING line and §6 (TLS grade)
    stays PENDING until owner-run scans produce evidence. Do not hard-code
    the fix-vs-document severity bar anywhere — the dossier reads
    `dast-severity-bar` from the baseline at fill time (verified: critical
    and high findings require fix-or-documented-FP; action on low/medium is
    not required, only investigation encouraged), so a future bar change
    never strands stale prose.

11. **Draft the written-policy / org-config pack (WI-19) — owner-completed
    stubs, driven by the required-materials matrix.** This is the questionnaire's
    written-policy + org-config surface that no static finder can produce — the
    place a submission stalls *after* the code is clean. For each `artifact-*`
    policy id the matrix selects for THIS listing class, instantiate its template
    from `${CLAUDE_PLUGIN_ROOT}/templates/` and **pre-fill only what the toolkit
    already detected, leaving the rest owner-input**:

    | Template | Pre-fill from | Baseline id |
    |---|---|---|
    | `incident-response-plan.md.tmpl` | security owner (access-control personas); the 24-hour reporting duty | `artifact-incident-response-plan` |
    | `data-retention-deletion.md.tmpl` | data classes (§8); hosts/regions (§7) | `artifact-data-retention-deletion` |
    | `disaster-recovery-backup.md.tmpl` | hosting provider/region (§7) | `artifact-disaster-recovery-backup` |
    | `vulnerability-remediation-sla.md.tmpl` | the scan families that run (run-scans) | `artifact-vuln-remediation-sla` |
    | `hosting-architecture.md.tmpl` | hosts/regions/subprocessors (§7) — **EXTEND** the data-flow subprocessor table, never duplicate it | `artifact-hosting-architecture` |
    | `prior-pentest-attestation.md.tmpl` | the toolkit's own audit + scan evidence as the compensating-posture baseline | `artifact-prior-pentest-attestation` |

    Policy is a HUMAN deliverable: every one is **STATUS PARTIAL until the owner
    completes and SIGNS it**. Register each as a PARTIAL checklist + readiness-
    tracker row; the Submission Completeness Index counts it SATISFIED only with an
    owner-signed evidence entry (never an un-evidenced stub — the stub *asks*, it
    does not *assert*). Do not invent a policy the partner has not stated. These
    are recommended completeness materials (baseline `verification:
    web_research_unverified` pending per-item confirmation) — say so in the recap,
    not a verbatim mandate.

12. **Cross-read the full set before handing anything to the owner —
    artifacts contradicting each other is the failure mode reviewers exploit
    first**, because a contradiction means at least one document is wrong
    and they get to pick which to test. The minimum diff set:

    | Check | Documents that must agree |
    |---|---|
    | Tool count and names | exposed-tools inventory · access-control B.4 · data-sensitivity §5 · OpenAPI paths · live capture |
    | Registry vs client/ESR-exposed count | exposed-tools reconciliation sentence · live capture · access-control B.4 |
    | Credential storage vs egress | authn-authz §8 storage table · data-flow §5 "stored on your side" column |
    | Session-ID posture | authn-authz §1 · data-flow §1 and §8 — identical sentence, identical evidence |
    | Actor/participant names | authn-authz §2 actors · both Mermaid diagrams · data-flow §2 boundary table |
    | Scope tiers and roles | authn-authz §6 model · access-control B.2/B.3 · per-tool matrix |
    | Endpoint list | OpenAPI · data-flow hops · the manifest's endpoint inventory (the future DAST scope) |

    Every mismatch is a generator bug — fix the artifact, re-diff, never
    round a number or soften a sentence to force agreement. Record the
    cross-read result in the run log.

13. **Mark provenance and hand off for review.** Every artifact carries its
    mandatory footer (CONVENTIONS §2): per-section `Drafted by` (agent, with
    the exact inputs read) vs owner rows, generation date, `git rev-parse
    HEAD` commit, baseline ids referenced with the oldest `last_verified`.
    Agent-drafted means static code reading — never describe it as a scan,
    DAST, or pen test. Leave unfilled `{{SLOTS}}` visible — an unfilled slot
    means not-submission-ready, and papering over it converts an honest gap
    into a false claim. Update the artifact-pointer columns of the
    submission checklist (`submission-checklist.md.tmpl` working state) for
    the rows drafted here — status **PARTIAL**, never HAVE: HAVE requires
    owner verification, and `/sf-security-review-toolkit:security-review-journey`
    counts unreviewed drafts as in-progress by design. Close by listing, for
    the owner: every open owner-input slot, every claim flagged
    low-confidence, and every PENDING live capture. The artifacts are done
    when the owner says each claim is true — not when the files exist.

## Automated vs. manual recap

**Automated:** gate checks, live tools/list and OpenAPI capture with
code cross-check, artifact drafting from code/config/metadata (middleware
traces, deploy configs, serializer egress extraction, permission-set XML
parsing, dispatch-table matrices), controls-narrative mining, FP-dossier
seeding, the consistency cross-read, provenance footers, checklist pointer
updates.
**Manual:** confirming probe environment and consent; business context and
data-sensitivity rationales; deployment facts code cannot see; least-privilege
justifications and the dangerous-permission statement; the credential-storage
sign-off (after the secret scan); every residual-risk acceptance; final review
of every claim in every artifact. Drafts are not completed artifacts, and
nothing in this phase is a scan or a pen test — Salesforce performs its own
penetration testing regardless of any document generated here.

## What feeds the next skill

The OpenAPI/endpoint inventory seeds the authenticated DAST scope in
`/sf-security-review-toolkit:run-scans` — same spec, same scope, and that
match is itself checkable evidence; the FP-dossier skeleton is what run-scans
triages real scanner output into. The access-control Part C personas define
the test users `/sf-security-review-toolkit:prepare-test-environment`
provisions, including the two differently-privileged users for the
authorization proof. Every artifact lands as a PARTIAL checklist row that
`/sf-security-review-toolkit:compile-submission` upgrades to HAVE only after
owner verification.

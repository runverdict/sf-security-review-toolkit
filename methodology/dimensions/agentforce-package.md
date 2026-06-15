# Dimension: agentforce-package

The agent-era failure classes that live in **packaged AI metadata** — agent
actions, GenAi planner/plugin/function descriptors, and prompt templates — that
no traditional Salesforce SAST reasons about and that no other dimension in this
toolkit reaches. Applies whenever the scope manifest shows a managed-package
element carrying packaged-AI metadata, **independent of whether an MCP server
exists.** This is the deliberate fix for the MCP-gated blind spot:
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/mcp-threat-model.md` is selected
only when a partner-hosted MCP server is present, so a managed-package-only
AgentExchange listing (a packaged agent surface with no MCP server) would
otherwise get zero finder coverage of its actions, prompt templates, and GenAi
metadata. The reviewer reads that metadata directly against the binding "Secure
Your Agentforce Solution" pages and runs the same Checkmarx + Code Analyzer + own
pen test regardless of MCP — so this dimension audits it regardless.

Boundaries. The same threat *concepts* the MCP dimension owns for a
**partner-hosted server** are owned **here** for a **packaged agent**:
prompt-injection hardening, LLM-output-as-untrusted, untrusted-CRM-text-as-
instructions, and over-broad data egress all reappear sourced from
`genAiPromptTemplate` merge fields and `GenAiFunction` action schemas rather
than from MCP tool definitions and outbound HTTP. The split is the *artifact*,
not the concept: file a packaged-action / prompt-template defect here, a
server-side tool-poisoning / token-passthrough / SSRF defect in
`mcp-threat-model`; when both surfaces exist and one path spans them, file under
the surface that is the root cause. Plain packaged-Apex CRUD/FLS dataflow stays
Code Analyzer's Graph Engine pass
(`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions` carries no Apex CRUD/FLS
dimension — see `audit-methodology.md` §1.2); this dimension owns only the
**agent-specific** authorization questions SFGE cannot reason about: which Apex
classes are *reachable as agent actions*, whether a private service-agent action
*scopes by VerifiedCustomerId*, and whether an action self-authorizes. The
generic `injection-xss` and `web-client` dimensions own their sinks; this
dimension is what tells those sinks that **LLM-generated content is a taint
origin** — cross-reference, do not duplicate. Crypto mechanics of the enclosure
randomness (CSPRNG vs `Math.random()`) belong to
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/crypto-internals.md`; this
dimension owns whether an enclosure is *present and per-inference* at all.

## 1. Threat concept

Whether the Salesforce review runs a named checklist against each of these or
finds them in its own pen test is not the question — the binding "Secure Your
Agentforce Solution" and prompt-injection-hardening pages (official, Summer '26)
state them as requirements for any packaged agent surface, three of them carry a
**blocker / auto-fail** weight, and an exploitable instance fails the reviewer's
test whether or not a checklist names it. The classes, in the order a verifier
should fear them:

1. **Execution-identity / VerifiedCustomerId scoping (BLOCKER — the agent-era
   cross-tenant / IDOR auto-fail).** Employee-facing agents execute actions *as
   the prompting user*; **service agents execute as the agent identity**, so a
   service-agent flow or Apex class carries no end-user authorization of its own
   and must do it explicitly. A **private** service-agent action (one that
   returns nonpublic data or performs a sensitive operation) must source
   `VerifiedCustomerId` as a **context-variable input** (a variable assignment in
   Agent Builder — never a user-controlled or LLM-controlled action input),
   validate it is non-null and maps to a real customer identity (a `User` or
   `Contact` under the out-of-the-box Customer Verification topic), associate
   *every* record it reads, alters, or returns with that identity, and prevent
   reaching any record not associated with it (baseline:
   `agentforce-execution-identity-verifiedcustomerid`). A service-agent action
   that queries by an Id the caller supplied, or that returns records without
   filtering on the verified identity, is the agent-era IDOR: one customer's
   utterance reaches another customer's data. User verification is *distinct
   from* authentication — the subscriber configures authn; the action still owes
   the scoping.

2. **No user-controlled record references (BLOCKER — agent-era IDOR at the
   input).** A custom action may **not** accept a generic record reference,
   record Id, object name, or field name as user- or LLM-controlled input
   (baseline: `agentforce-no-user-controlled-record-references`). Enforcement is
   mechanical and deterministic: `"copilotAction:isUserInput": false` in the
   action's input-schema metadata for every input that carries a record
   reference / Id / object name / field name, **and** "Collect data from user"
   disabled for those inputs in Setup. Letting the model or the user name the
   record is IDOR by another route — the LLM is talked into supplying an Id it
   was never meant to, and the action obediently reads it.

3. **No third-party LLM in the package (BLOCKER).** In-package agent actions may
   **not** call an external LLM provider directly — `api.openai.com`,
   `generativelanguage.googleapis.com`, `api.anthropic.com`, Azure OpenAI
   (`*.openai.azure.com`), Cohere, Mistral, or any other model-provider host —
   in any action code path (baseline:
   `agentforce-no-third-party-llm-in-package`, verbatim: "Integrations with
   third-party LLM services, such as OpenAI and Google, aren't allowed"). The
   only sanctioned generation paths are platform **prompt templates** (invoked by
   a custom action, Apex, or flow) and the **Models API** (Apex or REST).
   Separately, an action that **mutates Einstein Trust Layer settings** is also
   prohibited in a managed package. Note the scope boundary: a *generic external
   backend* reached as a third-party integration (not an LLM provider) is
   governed by the in-scope external-endpoint rules, not banned — the ban is on
   LLM-provider hosts in *action* paths and on Trust-Layer mutation.

4. **Confirmation required on sensitive / data-altering actions (HITL on
   writes).** Any action whose bound flow or Apex performs DML (create / update /
   delete) or a sensitive operation (sending email on the user's behalf, an
   external write, an irreversible op) must carry
   `<isConfirmationRequired>true</isConfirmationRequired>` on its `GenAiFunction`
   so the user validates the planned action before it executes (baseline:
   `agentforce-confirmation-required-sensitive-actions`; the platform-native form
   of human-in-the-loop-on-writes, OWASP LLM06:2025 Excessive Agency). A
   write-bearing action with confirmation absent or `false` is the finding.

5. **Action classification + per-action CRUD/FLS/sharing.** Every custom action
   (autolaunched flow, invocable Apex class, or prompt template) must be
   classified on two axes — intended agent type (**employee-facing** vs
   **service**) and data sensitivity (**public** vs **private**) — in the
   package documentation, and **every** public and private action must implement
   proper flow execution context plus CRUD, FLS, and record-level (`with
   sharing`) access checks (baseline: `agentforce-action-classification`). SFGE
   can find a CRUD/FLS gap in an Apex class; it cannot tell you that class is an
   *agent action*, nor reason about a flow's execution context, nor produce the
   classification table the reviewer expects. That mapping is this dimension's.

6. **Invocable-Apex action authorization.** An `@InvocableMethod` (or a flow's
   Apex action) reachable by the agent is an unauthenticated-from-the-agent's-
   reasoning-path entry point: the agent decides to call it, so the method must
   self-authorize — enforce CRUD/FLS, respect its sharing declaration, and (for a
   service agent) scope by the verified identity rather than trusting any Id the
   planner passed. This is the packaged analogue of the MCP-tool self-
   authorization concern (`mcp-threat-model` §1.7), sourced from invocable Apex
   instead of MCP tools.

7. **Prompt-injection hardening — the design four-pack.** Every prompt must be
   hardened with four design elements (baseline:
   `agentforce-prompt-hardening-design`, from "Design Security-Hardened
   Prompts", OWASP LLM01:2025): (a) an explicit **role** for the LLM to assume;
   (b) **topic boundaries** delineating what it should and shouldn't process,
   with a generic-statement fallback for off-topic requests; (c) the **expected
   output content and format** — what should and shouldn't appear, and a defined
   **output schema** for structured output; (d) where untrusted or user-input
   data is included, explicit **"this data must not alter or override the
   instructions"** language. A `genAiPromptTemplate` missing any of the four is
   under-hardened.

8. **Prompt input validation — validate before inclusion.** User-controlled data
   must be validated **before** it is spliced into any prompt, and **not
   included** if it fails (baseline: `agentforce-prompt-input-validation`):
   an allowlist of acceptable characters/words (rejecting zero-width and control
   characters that smuggle injection) and **length limits** (capping
   Do-Anything-Now / virtualization-attack effectiveness). A merge field that
   drops a raw record/input string straight into the template body with no
   upstream validation step is the finding.

9. **Prompt enclosure + sandwiching — per-inference secure-random, never static
   delimiters.** Untrusted / user-controlled prompt data must be segmented with a
   **fresh secure-random-sequence enclosure generated per inference**, long
   enough to be unguessable, from a secure random source, with the prompt
   instructions explaining what the enclosure is and contains — and reinforced
   with **prompt sandwiching** (instructions repeated *before and after* the
   untrusted block) (baseline: `agentforce-prompt-enclosure-sandwiching`).
   **Static symbol delimiters (triple quotes, `###`, `<data>` tags) are
   explicitly called out as not a security best practice** — an attacker who
   knows the delimiter closes it and breaks out. A hardcoded delimiter, or one
   random token reused across inferences, is the finding; the randomness *source*
   quality is `crypto-internals`' probe, the *presence and per-inference
   freshness* is this dimension's.

10. **LLM output is untrusted (OWASP LLM05:2025 Improper Output Handling).** ALL
    LLM-generated content — from a prompt template or the Models API — is
    untrusted input to whatever consumes it. Before it reaches DML or SOQL it
    must be **format- and value-constrained** (length, character set, integer
    bounds; the worked example: validate an LLM-returned record Id is a correctly
    sized Salesforce Id of allowlisted characters before it touches the
    database); before it reaches a UI it must be **output-encoded** (escaped for
    the LWC context) (baseline: `agentforce-llm-output-untrusted`). The
    downstream sinks are `injection-xss`'s and `web-client`'s; this dimension's
    job is to name the **LLM output as the taint origin** those sinks must treat
    as hostile — generated content flowing into `Database.query`, a DML call, or
    an LWC render with no constraint/encode step between is the finding.

11. **No prompt/response logging.** Never log Agentforce prompts or agent
    responses — no `System.debug`, no other logging method on prompt or response
    variables in action code paths; use enhanced event logs in Agent Builder when
    logs are needed (baseline: `agentforce-no-prompt-response-logging`; the
    agent-surface specialization of secret-data-in-debug). Prompts and responses
    carry the customer data the agent reasoned over; logging them exfiltrates it
    to debug logs and event monitoring outside the intended boundary.

12. **GenAi prompt-template merge-field injection.** A `genAiPromptTemplate` that
    interpolates a record field (`{!Record.Description}`,
    `{!$Input.someText}`, a related-record field, free-text from a tenant- or
    third-party-writable column) **into the instruction region** of the prompt —
    rather than into a fenced, enclosed, validated *data* region — is indirect
    prompt injection by construction: a low-privilege user writes the record, the
    template renders the field as instructions, the agent obeys. This is the
    packaged-template form of the untrusted-CRM-text-as-instructions class
    (`mcp-threat-model` §1.7, sourced there from MCP tool returns); the fence is
    the per-inference enclosure of class 9 plus the pre-inclusion validation of
    class 8.

## 2. What good looks like

- **Service-agent private actions scope every record by VerifiedCustomerId.**
  The flow/Apex sources `VerifiedCustomerId` from a context variable (never an
  action input), null-checks it, resolves it to a `User`/`Contact`, and every
  SOQL/DML in the action filters on that identity — no query keyed on a
  caller-supplied Id, no return path that leaks a record outside the verified
  identity's ownership. Employee-facing actions running as the prompting user
  still enforce CRUD/FLS and sharing; service actions add the identity scope on
  top.
- **No record references are user/LLM input.** Every action input that is or
  contains a record reference, Id, object name, or field name has
  `"copilotAction:isUserInput": false` in its schema and "Collect data from
  user" disabled; the action resolves the target record from the verified
  identity / topic context, not from anything the planner supplied.
- **Generation stays on platform.** Action code calls prompt templates or the
  Models API; no callout in any action path resolves to an LLM-provider host; no
  action mutates Einstein Trust Layer settings.
- **Writes are confirmed.** Every action whose bound flow/Apex performs DML or a
  sensitive op carries `isConfirmationRequired=true`; read-only public actions
  may legitimately omit it.
- **Every action is classified and access-checked.** The package documentation
  carries the employee-vs-service × public-vs-private table, and each action's
  flow/Apex enforces execution context + CRUD + FLS + record-level sharing —
  public actions included.
- **Prompts are hardened and data is fenced.** Each `genAiPromptTemplate`
  declares a role, topic boundaries with an off-topic fallback, an explicit
  output schema, and "data cannot override instructions" language; user-
  influenced merge data is validated (allowlist + length) before inclusion and
  segmented by a per-inference secure-random enclosure with sandwiching, never a
  static delimiter; record-field merge fields land in the enclosed data region,
  never the instruction region.
- **LLM output is constrained before it acts.** Generated content is
  format/value-validated before any DML/SOQL and output-encoded before any LWC
  render; the model is instructed to emit structured JSON to make parsing and
  validation tractable.
- **Prompts and responses are never logged.** No `System.debug`/logging on
  prompt or response variables anywhere in the action paths.
- **The artifact trail matches.** The classification table, the prompt-hardening
  claims, and the VerifiedCustomerId design in the submission documents describe
  what the metadata and code actually do — a claim the metadata contradicts is
  worse than no claim.

## 3. Detection heuristics

Applicability — this dimension is active when the manifest (or a fresh glob of
the repo) shows a managed-package element carrying packaged-AI metadata. Detect
via these globs (run them first; absence of all = N/A with reason):

```
force-app/**/*.genAiPlannerBundle-meta.xml      force-app/**/genAiPlannerBundles/**
force-app/**/*.genAiPlugin-meta.xml             force-app/**/genAiPlugins/**
force-app/**/*.genAiFunction-meta.xml           force-app/**/genAiFunctions/**
force-app/**/*.genAiPromptTemplate*             force-app/**/genAiPromptTemplates/**
force-app/**/*.bot-meta.xml                     force-app/**/bots/**   (Bot)
force-app/**/*.flow-meta.xml                     (autolaunched-flow agent actions)
```

…plus any Apex class with `@InvocableMethod` (an invocable-Apex agent action).
The presence of `genAiPlanner*`/`genAiPlugin*`/`genAiFunction*`/
`genAiPromptTemplate`/`Bot` metadata, OR an autolaunched flow / invocable-Apex
class wired as an agent action, triggers the dimension **even with no MCP
server**.

Resolve and read: the `GenAiFunction` input schemas, the `genAiPromptTemplate`
bodies, the flows and Apex classes those functions/plugins bind to, and every
callout site in those action code paths.

**Metadata XML — exact element/key names to grep and read:**
- `isUserInput` / `copilotAction:isUserInput` — in `GenAiFunction` input-schema
  metadata; flag any input that is/contains a record reference, Id, object name,
  or field name where this is **absent or `true`** (class 2). Also look for
  "Collect data from user" enablement on those inputs.
- `isConfirmationRequired` — on `GenAiFunction`; flag **absent or `false`** on
  any function whose bound flow/Apex does DML or a sensitive op (class 4).
- `VerifiedCustomerId` — should appear as a **context-variable input** assignment
  feeding service-agent private actions; its **absence** in a service-agent
  action that reads/returns nonpublic data is the lead (class 1). Trace it into
  the flow/Apex and confirm every query filters on it.
- `GenAiFunction` input schema (the `input`/`inputs`/parameter type
  declarations) — enumerate every parameter; record-reference / Id / object /
  field shapes are the IDOR-input candidates (classes 2, 6).
- `genAiPromptTemplate` merge fields — `{!$Input.<name>}`, `{!Record.<Field>}`,
  `{!Record.<Relation>.<Field>}`, `{!$User...}`, `{!$Apex...}` — read each: is
  the value a **record/free-text field** (Description, Notes, Subject, Comments,
  case/email body, any tenant- or third-party-writable column)? Does it land in
  the **instruction region** or a **fenced data region**? Is there a validation
  step (allowlist/length) and a per-inference enclosure between the merge and the
  instructions (classes 8, 9, 12)?
- Prompt-template hardening elements — read the template body for a declared
  **role**, **topic boundaries** + off-topic fallback, an **output
  schema/format** statement, and **"data must not override instructions"**
  language; any of the four missing is class 7.
- Enclosure/sandwiching — look for a **per-inference random token** wrapping the
  untrusted block (a fresh secure-random sequence, not a literal `"""`/`###`/
  `<data>` delimiter) and for instructions **repeated before and after** the
  data block; a hardcoded delimiter or a reused/absent random token is class 9.

**Action code (Apex + flow) — grep seeds:**
- Callout hosts in action paths — `callout:`, `HttpRequest`, `setEndpoint(`,
  `Http().send(`, named-credential refs, and the LLM-provider hosts
  `api.openai.com`, `generativelanguage.googleapis.com`, `api.anthropic.com`,
  `*.openai.azure.com`, `api.cohere.ai`, `api.mistral.ai`, `bedrock` (class 3).
  Cross-check against the `scope-submission` callout inventory; classify each
  host as LLM-provider vs generic-backend. Also grep for Trust-Layer-setting
  mutation (`EinsteinGpt...`/Trust-Layer config DML).
- `@InvocableMethod` — every occurrence is an agent-reachable entry point; for
  each, check for CRUD/FLS enforcement (`WITH SECURITY_ENFORCED`, `USER_MODE`,
  `Security.stripInaccessible`, `Schema.*.isAccessible/isUpdateable/isCreateable/
  isDeletable` describe calls), the class's sharing declaration (`with sharing`
  vs `without sharing`/`inherited sharing`), and — for service agents — a
  VerifiedCustomerId scope (classes 1, 5, 6).
- LLM-output-as-taint — trace the variable holding prompt-template / Models-API
  output (`ConnectApi.EinsteinLLM*`, `aiPlatform`/Models-API response, prompt-
  template invocation result) into any `Database.query(`, DML statement, or
  value returned to an `@AuraEnabled` method / LWC; a missing format/value
  validation or output-encode step between is class 10.
- Logging of prompt/response — `System.debug(` (and `logger`/event-log writes)
  whose argument is a prompt or response variable in an action path is class 11.

| Stack / surface | Where to look |
|---|---|
| GenAi metadata | `genAiPlannerBundle`/`genAiPlugin`/`genAiFunction`/`genAiPromptTemplate` files — read input schemas (`isUserInput`, parameter types), `isConfirmationRequired`, and template bodies (merge fields, hardening elements, enclosure). |
| Apex actions | `@InvocableMethod` classes and any Apex a `GenAiFunction`/flow binds to — CRUD/FLS describe calls, sharing keyword, VerifiedCustomerId scoping, callout hosts, output validation, `System.debug` of prompt/response. |
| Flow actions | Autolaunched `*.flow-meta.xml` wired as agent actions — execution context (run mode / `<runInMode>`), record queries (do they filter on VerifiedCustomerId), DML elements (paired with `isConfirmationRequired`). |
| Bot / planner | `*.bot-meta.xml` + planner bundle — which plugins/functions are wired as actions, employee-vs-service agent type, topic set (test/internal topics leaking in). |

Also resolve the partner's **claimed** classification table and prompt-hardening
posture from the stack notes — verify each claim against the actual metadata and
code, never assume.

## 4. Finder prompt block

```
Primary targets (read these first, then follow imports/call-sites; use grep to
locate the real files when a path is approximate):
{{TARGETS}}

Stack notes (claims from the partner's own docs — verify against the ACTUAL
code, never assume):
{{STACK_NOTES}}

Threat focus — the packaged-Agentforce / AI failure classes the binding "Secure
Your Agentforce Solution" + prompt-injection-hardening pages (official, Summer
'26) require, that no other dimension reaches for a managed-package-only agent
listing. Probe. Execution-identity scoping (BLOCKER): for EVERY action wired to
a SERVICE agent (executes as the agent identity, not the prompting user), read
the bound flow/Apex — does a PRIVATE action (returns nonpublic data or does a
create/update/delete or other sensitive op) source VerifiedCustomerId as a
CONTEXT-VARIABLE input (never a user/LLM-controlled action input), null-check
it, resolve it to a User/Contact, and filter EVERY record it reads/alters/
returns on that identity; a query keyed on a caller-supplied Id or a return path
that leaks records outside the verified identity is the agent-era IDOR/cross-
tenant auto-fail. User-controlled record references (BLOCKER): in every
GenAiFunction input schema, find any input that is/contains a record reference,
record Id, object name, or field name — is "copilotAction:isUserInput": false
set AND "Collect data from user" disabled for it, or can the LLM/user name the
record (IDOR at the input). Third-party LLM in package (BLOCKER): read every
callout host in every ACTION code path — does any resolve to an LLM provider
(api.openai.com, generativelanguage.googleapis.com, api.anthropic.com,
*.openai.azure.com, api.cohere.ai, api.mistral.ai, bedrock); only platform
prompt templates or the Models API are sanctioned; also flag any action that
mutates Einstein Trust Layer settings (a generic non-LLM backend is governed by
the external-endpoint rules, not banned — classify the host before flagging).
Confirmation on writes: assert isConfirmationRequired=true on every
GenAiFunction whose bound flow/Apex performs DML or a sensitive op (send email,
external write, irreversible op) — absent/false on a write-bearing action is the
finding (OWASP LLM06 excessive agency). Action classification + per-action
authz: for each custom action (autolaunched flow, invocable Apex, prompt
template) determine employee-vs-service and public-vs-private, and confirm the
flow execution context + CRUD + FLS + record-level (with sharing) checks are
present — for PUBLIC actions too; note any action with no classification.
Invocable-Apex authz: every @InvocableMethod is an agent-reachable entry point —
does it self-authorize (CRUD/FLS via USER_MODE/WITH SECURITY_ENFORCED/
stripInaccessible/describe), respect its sharing declaration, and (service
agent) scope by the verified identity instead of trusting a planner-passed Id.
Prompt hardening (read the ACTUAL genAiPromptTemplate body): does each template
declare an LLM role, topic boundaries with an off-topic fallback, an explicit
output content/format + schema, and "data must not alter or override the
instructions" language — any of the four missing is under-hardened. Prompt input
validation: is user-controlled merge data validated (allowlist of characters/
words rejecting zero-width/control chars, length limits) BEFORE it is included,
and dropped if it fails — a raw record/input string spliced straight into the
template is the finding. Enclosure + sandwiching: is untrusted prompt data
segmented by a FRESH secure-random-sequence enclosure generated PER INFERENCE
(static symbol delimiters — triple quotes, ###, <data> tags — are explicitly NOT
best practice; an attacker who knows the delimiter breaks out), with the
instructions explaining the enclosure AND repeated before+after the data block
(sandwiching); a hardcoded delimiter or a reused/absent random token is the
finding. Prompt-template merge-field injection: every {!Record.<Field>}/
{!$Input.<name>} merge that carries a tenant- or third-party-writable field
(Description, Notes, Subject, Comments, case/email body) — does it land in the
INSTRUCTION region (indirect prompt injection: a low-privilege user writes the
record, the template renders it as instructions, the agent obeys) or a fenced/
enclosed/validated DATA region. LLM output untrusted (OWASP LLM05): trace prompt-
template / Models-API output into every DML, SOQL (Database.query), and LWC/
@AuraEnabled return — is it format/value-constrained (length, char set, integer
bounds; an LLM-returned record Id validated as a correctly sized allowlisted-
char Salesforce Id) before DML/SOQL and output-encoded before display; the sinks
belong to injection-xss/web-client but the LLM output is the TAINT ORIGIN they
must treat as hostile — flag a missing constraint/encode in one line and file it
here as the root cause. No prompt/response logging: any System.debug or logging
call whose argument is a prompt or response variable in an action path. Plain
Apex CRUD/FLS dataflow unrelated to an agent action is Code Analyzer's Graph
Engine pass, not this dimension — flag a cross-dimension lead in one line
instead.

Known findings — do NOT re-report any of these:
{{LEDGER}}

Report ONLY findings grounded in metadata/code you have READ, with exact
file:line. Prefer precision over volume — a false alarm wastes the verifier's
time and the partner's. If a control is correctly implemented, do NOT report it
(one info-level note for a notably strong control is allowed). For each finding
give a concrete exploit_scenario: the attacker (a malicious customer of a
service agent, a low-privilege user who writes a record field, a prompt-
injection author), the utterance / record / input they control, and what data
or authority it reaches.
```

### 4.1 Category mapping

Default reviewer category (`audit-methodology.md` §4.1): **`authorization`** —
VerifiedCustomerId scoping, user-controlled record references, invocable-Apex
authz, and action classification are all access-control defects, the bucket a
reviewer reads most of this dimension on. Secondary, title-resolved:
**`input-validation`** for the prompt-injection classes (prompt hardening, input
validation, enclosure/sandwiching, merge-field injection — untrusted data
becoming instructions) and **`output-encoding`** for LLM-output handling
(generated content reaching DML/SOQL/render unvalidated/unencoded — the
root-cause origin even though the *sink* is `injection-xss`/`web-client`).
Tertiary: the third-party-LLM-callout class files under
`communications-security` only when the root cause is the off-platform egress
itself; the no-prompt/response-logging class files under
`logging/error-handling`. The synthesis step picks the single best-fit category
per confirmed finding from this set, by the §4.1 one-category-per-finding rule
(root cause wins; the secondary is named in the finding's report row, never
double-counted).

## 5. Verifier guidance

- **For VerifiedCustomerId claims, confirm the agent type first.** The scoping
  duty is a SERVICE-agent obligation — an EMPLOYEE-facing agent action runs as
  the prompting user and is correctly authorized by CRUD/FLS + sharing without
  VerifiedCustomerId; flagging its absence there is an error. For a service-agent
  private action, read the flow/Apex: a `VerifiedCustomerId` sourced from a
  context variable and used as the filter on every query refutes; a query keyed
  on a caller-supplied Id, or a missing/null-unchecked identity, confirms. The
  identity→data *association* semantics (does this `Contact` actually own these
  records) is partly owner-confirmable against the data model — mark
  `partially_real` and route the data-model confirmation to the owner rather than
  asserting an ownership mapping the metadata doesn't encode.
- **For user-controlled-record-reference claims, read the schema flag, not the
  field name.** `"copilotAction:isUserInput": false` (and "Collect data from
  user" disabled) on the record-shaped input refutes; its absence or `true`
  confirms. An input that is plainly a free-text *query string* the topic
  resolves server-side — not a record reference/Id/object/field — is not this
  finding.
- **For third-party-LLM claims, classify the host.** An LLM-provider host
  (`api.openai.com`, `generativelanguage.googleapis.com`, `api.anthropic.com`,
  Azure OpenAI, Cohere, Mistral, Bedrock) in an action callout confirms; a call
  to a platform prompt template or the Models API (`ConnectApi.EinsteinLLM*`,
  Models-API REST) refutes; a callout to the partner's OWN generic backend that
  is not an LLM provider is out of scope here (governed by the external-endpoint
  rules) — refute with a one-line cross-dimension note. Confirm the callout is
  actually on an *agent-action* path, not unrelated package code.
- **For confirmation-required claims, prove the action writes.** Read the bound
  flow/Apex for a DML element / sensitive op; if present and
  `isConfirmationRequired` is absent or `false`, confirm. A read-only action
  legitimately omits confirmation — flagging it is an error.
- **For prompt-hardening / enclosure / merge-field claims, read the actual
  template body.** A finding requires reading the `genAiPromptTemplate` — assert
  the specific missing element (no role, no boundaries, no output schema, no
  "data cannot override" clause, a STATIC delimiter, a record-field merge in the
  instruction region). A template that already declares all four elements,
  validates and encloses its untrusted data per inference, and keeps record
  merges in a fenced data region refutes. The enclosure *randomness source*
  quality (CSPRNG vs weak PRNG) is `crypto-internals`' call — route it there;
  this dimension confirms only presence + per-inference freshness. A template
  with no untrusted/user merge data at all (fully static, operator-authored) does
  not need an enclosure — refute. **A packaged `genAiPromptTemplate` that
  interpolates untrusted record/user merge fields into the instruction region is
  a DECLARATION-level finding: it confirms on the template body ALONE.** Whether
  the template is currently bound to a live `GenAiFunction`/agent is a SEVERITY
  input (see reachability below), never grounds to refute — the under-hardened
  template ships in the managed package and a subscriber admin can bind it, so
  "not wired to any function / dead packaged code / no execution path" is NOT a
  valid refute. The only valid refutes are the two §6 cases (fully static
  operator-authored content, or a template already carrying all four hardening
  elements).
- **For LLM-output-untrusted claims, find the constraint/encode step.** Trace the
  generated-content variable to its sink: a format/value validation (size,
  char-set, integer bounds, Salesforce-Id shape check) before DML/SOQL, or an
  output-encode before the LWC render, refutes; their absence confirms, filed
  here as root cause with the sink dimension named. Generated content that is
  only ever displayed as inert, escaped text the agent never acts on is lower
  severity, not high.
- **Reachability sets SEVERITY; it never refutes a shipped artifact.** A
  violating action behind an unshipped / inactive plugin, a flow not wired to any
  agent, an unbound prompt template, or an operator-only topic is `low`/`info`
  with a note — that is a **downgrade, not a false positive**. Anything that
  SHIPS in the managed package (`genAiPromptTemplate`, `GenAiFunction`, action
  Apex/flow, `Bot`/plugin metadata) is a reviewer-visible artifact even when
  nothing currently wires it to a live agent: a subscriber admin can bind it, and
  the Salesforce reviewer flags shipped metadata regardless. So downgrade the
  SEVERITY and confirm with verdict `partially_real` plus a "not currently wired"
  note — **never** issue `false_positive` on a "dead packaged code / no execution
  path / not currently invoked" rationale. Confirm live-agent reachability before
  assigning a BLOCKER severity, never before assigning the finding at all.

## 6. Known false-positive patterns

| Pattern | Why it is not a finding |
|---|---|
| An EMPLOYEE-facing agent action with no VerifiedCustomerId scope | Employee agents execute as the prompting user; CRUD/FLS + sharing is the correct authorization. VerifiedCustomerId scoping is a SERVICE-agent duty (baseline: `agentforce-execution-identity-verifiedcustomerid`) — confirm the agent type before flagging. |
| An action input that takes a free-text query/utterance string the topic resolves server-side | Not a record reference / Id / object / field name — `isUserInput` need not be `false`. The ban (baseline: `agentforce-no-user-controlled-record-references`) is on user/LLM-controlled record *handles*, not on natural-language input. |
| A callout to a platform prompt template or the Models API (`ConnectApi.EinsteinLLM*`, Models-API REST) | The sanctioned generation path, not a third-party LLM. Only LLM-PROVIDER hosts (OpenAI/Google/Anthropic/Azure-OpenAI/Cohere/Mistral/Bedrock) in action paths are the violation (baseline: `agentforce-no-third-party-llm-in-package`). |
| A callout to the partner's own non-LLM backend from an action | Governed by the in-scope external-endpoint rules (Test Your Entire Solution), not the no-third-party-LLM ban. Classify the host before flagging; cross-reference, don't double-report. |
| A READ-ONLY action without `isConfirmationRequired` | Confirmation is required only for data-altering / sensitive actions (baseline: `agentforce-confirmation-required-sensitive-actions`). A read action legitimately omits it. |
| A `genAiPromptTemplate` with only STATIC, operator-authored content and no untrusted/user/record merge fields | No untrusted data to enclose or validate — the enclosure/sandwiching and pre-inclusion-validation requirements apply to untrusted-data inclusion. A static prompt is not under-hardened for lacking an enclosure. |
| Imperative language inside a prompt instructing the model how to behave ("respond only about X") | That IS prompt hardening (role/topic boundaries), not an injection. The finding is *untrusted DATA* reaching the instruction region, not the author's own instructions. |
| A record-field merge rendered into a clearly FENCED data region behind a per-inference enclosure with "data cannot override instructions" language | The correct control for untrusted CRM text, not the merge-field-injection vulnerability — the vulnerability requires the field to reach the INSTRUCTION region or an unfenced/unvalidated path. |
| Plain packaged Apex with a CRUD/FLS gap that is NOT an agent action | Code Analyzer's Salesforce Graph Engine pass (`run-scans`), not this dimension. This dimension owns the agent-specific authz (which Apex is an action, VerifiedCustomerId scoping, self-authorization) — flag a cross-dimension lead in one line. |
| LLM output validated to a strict schema / encoded before its sink | The correct handling of untrusted generated content (baseline: `agentforce-llm-output-untrusted`); the finding requires a MISSING constraint/encode between the generated value and the DML/SOQL/render sink. |
| A non-secure enclosure randomness source where the enclosure IS present and per-inference | The presence/per-inference question is confirmed here; the randomness-source weakness (e.g. `Math.random()`/weak PRNG) is a `crypto-internals` finding — route it there rather than double-reporting under this dimension. |

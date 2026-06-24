# Dimension: apex-exposed-surface

Every Apex method a non-Apex principal can call from outside the package's
own call graph — and, for each, the authorization question the structured
scanners do not answer: should this be exposed at all, and does it check that
*this caller* may act on *this record*? Applies when the scope manifest shows
a managed-package element containing Apex. Boundaries: the SOQL/SOSL
*construction* a parameter reaches belongs to
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/injection-xss.md`; raw secrets
in metadata to `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/secrets-credentials.md`;
the package↔external-endpoint session/credential handoff to
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/sessionid-egress.md`; packaged
GenAi metadata, invocable agent-action authorization, and prompt-template
hardening to `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/agentforce-package.md`
(an `@InvocableMethod` reachable *by an agent* is that dimension's probe; an
`@InvocableMethod` as a generic exposed authorization surface is this one's —
file the agent-reachability concern there, the entry-point authz here). This
dimension owns the **entry-point inventory** and the **per-record / should-this-
be-exposed** authorization semantics for each one.

**This COMPLEMENTS, never duplicates, the Salesforce Graph Engine (SFGE)
CRUD/FLS dataflow scan** orchestrated by `/sf-security-review-toolkit:run-scans`
(baseline: `scan-sfge-crud-fls-dataflow`). SFGE path-traces from each Apex
entry point and flags a DML/SOQL operation that reaches a sink without a
describe/user-mode guard — it answers *"does data flow to a write/read without
an access check."* It does **not** reason about whether a method *should be an
entry point*, whether a `global`/`webservice` surface is over-exposed, or
whether a per-record (object-instance) authorization check is present so that
a caller cannot pass *another* user's or tenant's record Id and act on it
(IDOR). That is LLM-semantic work — it requires understanding the method's
intent and the caller's entitlement, not just tracing a taint to a sink. The
engine performs exactly this should-this-be-exposed / per-record-authz reasoning
for every *non-Apex* surface (REST routes, MCP tools, admin endpoints) and the
carve-out at `audit-methodology.md` §1.2 ("packaged Apex is deliberately not a
dimension") dropped it for the one surface a reviewer enumerates first. The
report must say so: where this dimension reports an FLS/CRUD *dataflow* gap that
SFGE also catches, defer to SFGE and do not double-report; where it reports
over-exposure, a missing per-record check, or guest reachability, that is the
gap SFGE structurally cannot see.

## 1. Threat concept

A managed package ships its Apex into a subscriber org the partner does not
control. Every method reachable from *outside the package's own call graph* —
by a Lightning component, a REST/SOAP client, a Flow, an agent, a Visualforce
page, a guest user on a Site — is an attack surface a reviewer enumerates
*first*, because the failure classes here are the two ranked top of the
published Top-20: missing CRUD/FLS enforcement (baseline: `fail-crud-fls`,
`violation-crud-fls-bypass`; "#1 by a significant margin") and a missing or
wrong sharing declaration (baseline: `fail-sharing-model`,
`violation-sharing-rules-bypass`; "#3"). The reviewer's own pen test and
SFGE run reproduce these; an exposed method with no access check is a near-
certain failed cycle.

The exposed entry points, and the authorization question each one forces:

1. **`@AuraEnabled` (LWC/Aura controller methods).** Called by any component
   the subscriber — or a *guest user* — can reach. `cacheable=true` methods
   are read paths; non-cacheable can write. Each one needs CRUD/FLS for the
   running user **and** a per-record check: a method that takes a `recordId`
   parameter and does `[SELECT ... WHERE Id = :recordId]` or `update`/`delete`
   on it without confirming the running user can see/edit *that specific record*
   is an IDOR — the component passes any Id the attacker supplies. Sharing
   declaration matters: the controller class must be `with sharing` (or `with
   inherited sharing`) or row-level access is silently bypassed.
2. **`@RestResource` + `@HttpGet`/`@HttpPost`/`@HttpPut`/`@HttpPatch`/
   `@HttpDelete`.** A custom REST endpoint mounted at `/services/apexrest/...`.
   The `RestContext.request` body and URL carry attacker-controlled record Ids
   and field values; the same per-record-authz and CRUD/FLS questions apply,
   plus over-exposure (a `global` REST class is callable by every authenticated
   integration user in the subscriber org — is that intended?).
3. **`webservice` methods (SOAP).** The legacy exposed surface; `webservice
   static` methods are callable via the SOAP API. Same authz questions; these
   are easy to forget because they predate the `@RestResource`/`@AuraEnabled`
   conventions.
4. **`@InvocableMethod`.** Reachable from Flow, Process Builder, the REST
   Invocable Actions API — and, in an Agentforce package, from an agent. The
   input is a list the caller fully controls (including record Ids). The
   Flow/agent calling context may run in **system mode**, so the method's own
   sharing declaration and explicit access checks are the only boundary. (The
   *agent-reachable* slice — `VerifiedCustomerId` scoping, no-user-controlled-
   record-references, confirmation-on-writes — is `agentforce-package`'s probe,
   baseline `agentforce-execution-identity-verifiedcustomerid`,
   `agentforce-no-user-controlled-record-references`; this dimension owns the
   generic invocable-as-entry-point authz.)
5. **`@RemoteAction` (Visualforce remoting).** Called by `Visualforce.remoting`
   JavaScript on a page. Methods are `global`/`public static`; the JS sends
   arbitrary arguments. The VF remoting framework does *not* enforce CRUD/FLS
   or sharing for you — the method must.
6. **`global` classes and `@NamespaceAccessible` members.** The package's
   *public API* to subscribers and other packages. The codified rule (baseline:
   `fail-sharing-model`) is `with sharing` on **all** `global` classes and any
   class containing `@NamespaceAccessible` methods — omitting the declaration
   on these entry points counts the *same as* `without sharing`. Over-exposure
   is its own finding: a method that is `global` or `public` when nothing
   outside the package needs it widens the attack surface for no reason
   (least-privilege on the API itself).
7. **Visualforce / Aura controller methods.** `public` getters/setters/action
   methods on a `StandardController`/custom controller, action methods bound to
   a page. These execute on page interaction with the controller's sharing
   context; the per-record and CRUD/FLS questions apply to whatever record the
   page operates on. (DML on *page instantiation* — constructors, `action=`,
   `init` — is the CSRF class owned by `package-metadata` /
   `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/web-client.md`, baseline
   `violation-csrf-page-instantiation`; this dimension owns the controller-
   method authorization, not the instantiation-time CSRF.)

8. **Guest-user / unauthenticated reachability (the top real-world breach
   class).** Any of the above that a **Salesforce Site or Experience Cloud
   guest user** can reach runs as the low-privilege, *unauthenticated* guest
   profile. This is sanctioned-bypass case 4 in the codified CRUD/FLS rules
   (baseline: `violation-crud-fls-bypass` — "denying guest user access on
   communities/sites" is the *only* sanctioned guest case; everything the guest
   *can* reach must therefore deny or strictly gate it) and the explicit
   guest-user exception in the sharing rules (baseline:
   `violation-sharing-rules-bypass`). The breach pattern: an `@AuraEnabled`
   method exposed to a guest profile, with a class that is `without sharing` or
   forgets `WITH USER_MODE`/`stripInaccessible`, lets an anonymous internet
   visitor read or write records the org never meant to expose. This has been
   the root of multiple public Salesforce data-exposure incidents. The probe is
   reachability *and* over-exposure together: does a guest-accessible Apex class
   exist, and does it enforce its own access — because for the guest, the class's
   declarations are the *entire* security boundary.

Platform-version note (baseline: `fail-crud-fls`, `fail-sharing-model`): at API
version **67.0+**, Apex runs in **user mode by default** (the running user's
object permissions and FLS are enforced during execution) and `WITH
SECURITY_ENFORCED` is removed in favor of `WITH USER_MODE`; undeclared classes
default to **`with sharing`**. At **≤66.0** the old defaults hold — system-mode
execution, fall-through to `without sharing` on undeclared classes. Read the
`apiVersion` in the class `.cls-meta.xml`: a low API version is *not itself* a
finding, but it flips which defaults you must reason about, and a `<40.0`
Lightning surface is a separate Locker/LWS violation owned by `package-metadata`
(baseline: `violation-lockerservice-disabled`). The per-record (IDOR) check is
**version-independent** — user-mode enforces *object* and *field* access, never
*row/instance* access, so an IDOR is unguarded even at 67.0+ in user mode.

## 2. What good looks like

- **Every exposed method enforces CRUD/FLS for the running user.** User-mode
  database operations (`Database.query(..., AccessLevel.USER_MODE)`, `insert as
  user`, `WITH USER_MODE` in SOQL at API 67.0+; `WITH SECURITY_ENFORCED` or
  `Security.stripInaccessible(...)` on older code), or explicit describe checks
  (`Schema.sObjectType.X.isAccessible()/isCreateable()/isUpdateable()/
  isDeletable()`, `Schema.DescribeFieldResult.isAccessible()`), with graceful
  degradation (an insufficient-access message, not a swallowed exception) when
  access is denied. The five sanctioned bypass cases (baseline:
  `violation-crud-fls-bypass`) — roll-ups/aggregates that expose no data,
  partner-internal logs/system metadata, high-privileged methods non-admins
  cannot reach, guest-user *denial*, bespoke own-namespace policies — are
  documented in the submission, not silent.
- **Every exposed class declares its sharing model, correctly.** `with sharing`
  on all `global` classes and any class with `@NamespaceAccessible` methods, and
  on every class that directly performs data access; `with sharing` or `with
  inherited sharing` on other controller entry points (`with inherited sharing`
  acceptable only if no class in the solution is `without sharing`). A
  deliberate `without sharing` carries a documented justification in the FP
  dossier. Undeclared on a non-entry-point class is the version-dependent case
  (with-sharing at 67.0+, without-sharing fall-through ≤66.0).
- **Every method that operates on a caller-supplied record Id checks that the
  caller is entitled to that record.** The record is fetched/written through a
  sharing-respecting context (`with sharing` + the query honoring sharing), or
  the method explicitly verifies access to the *instance* (a `UserRecordAccess`
  check, a sharing-enforced re-query that returns zero rows for unentitled
  records, an ownership/relationship predicate) — so passing another user's Id
  yields no data and no write. Object-level (CRUD/FLS) enforcement alone is
  **not** an IDOR control: it lets the caller touch the *type*, not arbitrary
  *instances*.
- **The exposed surface is as narrow as the use case.** Methods are `global`/
  `webservice`/`@AuraEnabled`/`@RestResource` only where an out-of-package caller
  genuinely needs them; everything else is `private`/`public` and unannotated.
  The package API is the attack surface — least privilege applies to *which
  methods are reachable*, not only to what they do.
- **Methods return no more than the caller is entitled to.** A list/query method
  filters to the caller's scope before returning; it does not return all rows of
  a type and rely on the component to hide some. `stripInaccessible` is applied
  to *outbound* records so inaccessible fields are not serialized to the client.
- **Guest-reachable Apex denies or strictly gates.** Any class in a guest
  profile's permission set / a Site's public-access controllers enforces access
  as if the caller is anonymous (because it is): `with sharing`, user-mode/
  describe checks, per-record entitlement, and no `global`/`@AuraEnabled`
  surface the guest needs no access to. The guest case is *deny by default*
  (baseline: `violation-crud-fls-bypass` sanctioned case 4).

## 3. Detection heuristics

Enumerate every exposed entry point first; then, for each, locate the access
checks, the sharing declaration on its class, and the per-record handling of any
Id-shaped parameter. Apex lives under `force-app/**/classes/*.cls` (with a
sibling `*.cls-meta.xml` carrying `apiVersion`); Visualforce under
`**/pages/*.page`; Aura under `**/aura/**`; LWC under `**/lwc/**`.

**Entry-point inventory — exact grep seeds (case-insensitive over `*.cls`):**

| Entry point | Grep seed |
|---|---|
| Aura/LWC controller methods | `@AuraEnabled` (and `cacheable=true` / `cacheable = true` to split read vs write) |
| Custom REST | `@RestResource`, `@HttpGet`, `@HttpPost`, `@HttpPut`, `@HttpPatch`, `@HttpDelete`, `RestContext` |
| SOAP | `webservice ` (the `webservice` keyword on a method) |
| Invocable | `@InvocableMethod`, `@InvocableVariable` |
| VF remoting | `@RemoteAction` |
| Package public API | `global class`, `global ` (method/property), `@NamespaceAccessible` |
| VF/Aura controllers | `ApexPages`, `PageReference`, `StandardController`, `extensions=`/`controller=` in `*.page`, `getController`/`get`/action methods |

**Sharing declaration — read the class header for each entry-point class:**
`with sharing`, `without sharing`, `inherited sharing`, or *no declaration*
(scan the `class` line; an entry-point class with no `with sharing`/`without
sharing`/`inherited sharing` keyword is the omission case — finding on
`global`/`@NamespaceAccessible` classes regardless of API version, version-
dependent otherwise). Cross-check `apiVersion` in the matching `*.cls-meta.xml`
to know which default applies (≥67.0 → user-mode + with-sharing defaults;
≤66.0 → system-mode + without-sharing fall-through).

**CRUD/FLS enforcement presence/absence inside each entry point:**
`USER_MODE`, `AccessLevel.USER_MODE`, ` as user`, ` as system`, `WITH
USER_MODE`, `WITH SECURITY_ENFORCED`, `stripInaccessible`, `isAccessible`,
`isCreateable`, `isUpdateable`, `isDeletable`, `getDescribe`, `Schema.`. Their
**presence** is good (someone enforced access); their **absence** in a method
that does `Database.query`/`[SELECT ...]`/`insert`/`update`/`delete`/`upsert`/
`Database.` is the lead — but defer the pure dataflow-to-sink case to SFGE
(§intro) and report here the over-exposure / per-record / guest specializations.

**Per-record (IDOR) handling:** find Id-shaped parameters reaching a query or
DML — method signatures with `Id `, `String recordId`, `Id recordId`,
`List<Id>`, `Set<Id>`, or `RestContext.request.params`/`requestURI` feeding a
`WHERE Id = :` / `WHERE Id IN :` / a direct `update`/`delete` on a
caller-supplied sObject. The question is whether the surrounding context is
sharing-enforced (the class is `with sharing` **and** the query/DML honors it)
or whether an explicit instance-access check exists (`UserRecordAccess`,
`hasReadAccess`/`HasEditAccess`, an ownership predicate). Object-level checks
alone do not satisfy this. A specific Apex IDOR pattern to grep:
**hierarchy Custom Settings / Custom Metadata `getInstance(<id>)` where the Id
is caller-influenceable** (`getInstance(recordId)`, `getInstance(someUserId)`,
`getInstance(profileId)`) — it returns the settings row resolved for THAT
user/profile, leaking another user's hierarchy-scoped configuration (feature
flags, limits, sometimes embedded secrets); the safe forms are the no-argument
`getInstance()` (the running user) or `getOrgDefaults()` (the org row). Baseline:
`violation-getinstance-with-taint`, the Moderate PMD AppExchange rule
`AvoidGetInstanceWithTaint`.

**Guest / unauthenticated reachability:** grep the project for the guest
surface, then map guest-exposed classes:
- `*.page` / Aura / LWC referenced from a Site or Experience Cloud build, and
  `force-app/**/sites/*.site-meta.xml`, `*.network-meta.xml` (Experience
  Cloud), `*.experiencebundle/**`.
- Guest permission set / profile grants of Apex class access:
  `*.permissionset-meta.xml` and `*.profile-meta.xml` containing
  `<classAccesses>` whose `apexClass` is one of the entry-point classes, where
  the permission set/profile is a Site/community **guest** one (names commonly
  contain `Guest`, `Site`, `Profile`, or are referenced from the
  `*.site-meta.xml`/`*.network-meta.xml` `guestProfile`/`siteGuestRecordDefault`).
- In `.cls`, the conventional guest tells: `Site.`, `getSiteId`,
  `ConnectApi.*` from a community context, `Network.getNetworkId`, and any
  class whose components are placed on a guest-accessible page. The probe is:
  does a guest-reachable Apex method exist, is its class `with sharing`, does it
  enforce CRUD/FLS, and does it gate per record — because for the guest the
  class declarations are the *only* boundary.

| Stack | Where to look |
|---|---|
| Apex classes | `force-app/**/classes/*.cls`; the `class` declaration line for sharing keywords; the sibling `*.cls-meta.xml` `<apiVersion>`; every annotated method per the inventory table. |
| Visualforce | `**/pages/*.page` (`controller=`/`extensions=` wiring, `action=` on `<apex:page>`), `**/components/*.component`; the referenced controller `.cls`. |
| Lightning | `**/lwc/**/*.js` `@wire`/imperative calls to `@AuraEnabled` Apex (which controllers are component-reachable); `**/aura/**/*.cmp` + `*Controller.js`/`*Helper.js`. |
| Site / community metadata | `**/sites/*.site-meta.xml`, `**/*.network-meta.xml`, `**/experiences/**`, and the guest `*.profile-meta.xml`/`*.permissionset-meta.xml` `<classAccesses>` that expose entry-point classes to an unauthenticated profile. |

Also resolve: the partner's claimed access model from the AuthN/AuthZ artifact
and the package architecture docs (which methods they *say* are exposed and how
they *say* access is enforced) — and verify it against the actual annotations,
sharing keywords, and access checks. Most confirmed findings here are the gap
between "the docs say `with sharing` everywhere" and the one `global` class that
forgot it, or the one guest-exposed method that trusts a caller-supplied Id.

## 4. Finder prompt block

```
Primary targets (read these first, then follow imports/call-sites; use grep to
locate the real files when a path is approximate):
{{TARGETS}}

Stack notes (claims from the partner's own docs — verify against the ACTUAL
code, never assume):
{{STACK_NOTES}}

Threat focus — the authorization of every EXPOSED Apex entry point, the
should-this-be-exposed and per-record (IDOR) questions the Salesforce Graph
Engine CRUD/FLS dataflow scan structurally cannot answer. You COMPLEMENT, never
duplicate, SFGE: where a finding is a pure data-flow-to-sink CRUD/FLS gap SFGE
already catches, do NOT re-report it — report the entry-point over-exposure, the
missing per-record authorization, and the guest reachability SFGE cannot reason
about. First ENUMERATE every exposed entry point by grepping the Apex:
`@AuraEnabled` (split cacheable read paths vs writable non-cacheable),
`@RestResource` + `@HttpGet`/`@HttpPost`/`@HttpPut`/`@HttpPatch`/`@HttpDelete`,
`webservice ` methods, `@InvocableMethod`, `@RemoteAction`, `global class` /
`global ` methods / `@NamespaceAccessible`, and Visualforce/Aura controller +
action methods (`ApexPages`, `PageReference`, `controller=`/`extensions=`,
`action=`). For EACH entry point probe: (1) CRUD/FLS — does the method enforce
object- and field-level access for the RUNNING user via user-mode operations
(`WITH USER_MODE`, `AccessLevel.USER_MODE`, ` as user`), `WITH
SECURITY_ENFORCED`, `Security.stripInaccessible`, or explicit `Schema`
`isAccessible`/`isCreateable`/`isUpdateable`/`isDeletable` describe checks — or
does it query/DML in system mode with no check (read the `apiVersion` in the
`*.cls-meta.xml`: ≥67.0 runs user-mode by default, ≤66.0 system-mode — the
default flips which gap is real); (2) sharing — read the class declaration: is
it `with sharing` (or `with inherited sharing`) as the codified rules require on
ALL `global` classes and any class with `@NamespaceAccessible` methods and any
data-access class, or is it `without sharing`, or is the declaration OMITTED
(omission on a `global`/`@NamespaceAccessible` entry point counts the same as
`without sharing` regardless of API version); (3) PER-RECORD AUTHORIZATION
(IDOR) — does the method take a caller-supplied record Id (`Id recordId`,
`String recordId`, `List<Id>`, `RestContext.request` params/URI) and
SELECT/`update`/`delete`/`upsert` on it WITHOUT confirming the running user may
see/edit THAT specific record — can an attacker pass another user's or another
tenant's Id and read or mutate it? Object-level CRUD/FLS does NOT satisfy this:
user mode enforces the TYPE, never the INSTANCE, so an IDOR is unguarded even at
API 67.0+ in user mode unless the context is sharing-enforced or an explicit
instance check (`UserRecordAccess`, ownership predicate, sharing-respecting
re-query that returns zero rows for unentitled records) exists — and a specific
Apex IDOR to grep is a hierarchy Custom Settings / Custom Metadata
`getInstance(<id>)` whose Id traces to caller input
(`getInstance(recordId)`/`getInstance(userId)`/`getInstance(profileId)`): it
returns the settings row for THAT user/profile (a cross-user config read), where
the safe idiom is the no-argument `getInstance()` or `getOrgDefaults()` (the
Moderate PMD AppExchange rule `AvoidGetInstanceWithTaint`); (4)
OVER-EXPOSURE — is the method `global`/`webservice`/`@AuraEnabled`/
`@RestResource` when nothing outside the package needs it reachable (should it
be `private`/`public`), and does it return MORE than the caller is entitled to
(returning all rows of a type and trusting the client to hide some, or
serializing inaccessible fields without `stripInaccessible`). (5) MASS
ASSIGNMENT (per-property write-authz, the write-side cousin of IDOR) — for a
create/update/upsert entry point, does it bind a CALLER-SUPPLIED whole
object/sObject into the record, letting the caller set fields they cannot
legitimately write (`OwnerId`, a status/`IsApproved`/`Amount`, a price, an
internal flag, a parent relationship Id), or does it allowlist the writable
fields (a purpose-built DTO / field-by-field copy, or
`Security.stripInaccessible(UPSERTABLE/CREATABLE, …)` before the DML)? IDOR is
touching the wrong RECORD; mass assignment is writing the wrong FIELDS of a
record you may touch — both are findings (baseline: `mass-assignment-bopla`; the
`JSON.deserialize`-into-sObject variant is the untrusted-deserialization
dimension). Then the
GUEST-USER reachability probe (a top real-world breach class — sanctioned
CRUD/FLS bypass case 4 is guest-user DENIAL, so anything a guest CAN reach must
deny or strictly gate): find Apex reachable from a Salesforce Site or Experience
Cloud guest profile — `*.site-meta.xml`/`*.network-meta.xml`, the guest
`*.profile-meta.xml`/`*.permissionset-meta.xml` `<classAccesses>` exposing an
entry-point class, `Site.`/`Network.getNetworkId` context in the `.cls`, and
components placed on guest-accessible pages — and for each guest-reachable
method check whether its class is `with sharing`, enforces CRUD/FLS, and gates
per record, because for the UNAUTHENTICATED guest the class's own declarations
are the ENTIRE security boundary: an `@AuraEnabled` method exposed to a guest
profile on a `without sharing` class with no access check lets an anonymous
internet visitor read or write org records. SOQL/SOSL string-construction from
a parameter is the injection dimension's probe, not yours; packaged GenAi /
agent-action invocable authorization and prompt-template hardening belong to the
agentforce-package dimension; instantiation-time VF CSRF
(`confirmationTokenRequired`) belongs to package-metadata — report here the
entry-point authorization, exposure breadth, per-record check, and guest
reachability.

Known findings — do NOT re-report any of these:
{{LEDGER}}

Report ONLY findings grounded in code you have READ, with exact file:line. Cite
the entry-point annotation/keyword, the class's sharing declaration (or its
absence), the missing access check, and — for IDOR — the caller-supplied Id
parameter and the unguarded SELECT/DML it reaches. Prefer precision over volume;
a false alarm wastes the verifier's time and the partner's. If a control is
correctly implemented, do NOT report it (one info-level note for a notably
strong, consistently-applied access pattern is allowed). For each finding give a
concrete exploit_scenario: the caller (a subscriber-org user, an integration
user hitting the REST/SOAP endpoint, an agent/Flow invoking the action, an
anonymous Site guest), the request or Id they supply, and the data they read or
mutate.
```

## 5. Verifier guidance

- **Confirm the method is actually exposed AND the gap is the authz one, not the
  dataflow SFGE owns.** An annotation (`@AuraEnabled`, `webservice`, etc.) on a
  `public`/`global` method confirms exposure. If the only defect is a DML/SOQL
  reaching a sink with no describe/user-mode guard — and nothing about *which*
  records or *whether it should be exposed* — that is SFGE's dataflow finding;
  mark it `false_positive` for this dimension with a note to route it to the
  Code Analyzer pass, to avoid double-counting a CRUD/FLS finding the scanners
  already produce.
- **For CRUD/FLS claims, read the API version before deciding the default.**
  Open the `*.cls-meta.xml` `<apiVersion>`: at **≥67.0** the method runs in user
  mode by default, so object/field access IS enforced even with no explicit
  check — a "missing CRUD/FLS" claim on a 67.0+ class that does an ordinary
  `[SELECT ...]`/`insert` in user mode is a `false_positive` unless the code
  opts into system mode (` as system`, `AccessLevel.SYSTEM_MODE`, an explicit
  `without sharing` data path). At **≤66.0** the default is system mode and the
  absence of a check is real. Do not assert a CRUD/FLS gap without checking
  which default applies.
- **Before ACCEPTING a refutation that cites 67.0+ auto-enforcement, verify the
  package's `sourceApiVersion`.** The inverse of the rule above is the more
  dangerous miss: a verifier can wrongly REFUTE or downgrade an FLS/CRUD or
  sharing finding on the rationale "the platform auto-enforces user mode / `with
  sharing` at API 67.0+, so no explicit check is needed." That rationale is
  **INVALID unless the package actually compiles at ≥67.0** — and the package
  version is a single number for the whole artifact, not the per-class
  `apiVersion`. Read the `sourceApiVersion` in `sfdx-project.json` (or the scope
  manifest's `package.sourceApiVersion`). If it is **≤66.0** (the Solano fixture
  is `64.0`), the old **system-mode / `without sharing`** defaults hold, the
  auto-enforcement rationale does NOT apply, and the finding **stands** — the
  refutation is the bug, not the finding. The deterministic backstop is
  `harness/baseline-refutation-check.mjs` (opt-in, report-only, gates nothing):
  it scans `refuted` findings whose reasoning cites the user-mode / `with sharing`
  / auto-enforce / `67.0` rationale and flags any whose package `apiVersion` is
  `< 67.0` as an invalid refutation to re-open.
- **For sharing-declaration claims, the rule is entry-point-specific.** Omission
  on a `global` class or a class with `@NamespaceAccessible` methods is a finding
  *regardless* of API version (omission counts as `without sharing` on those
  entry points, codified — baseline `fail-sharing-model`). Omission on a
  non-entry-point class is version-dependent (with-sharing default at 67.0+,
  without-sharing fall-through ≤66.0). A documented deliberate `without sharing`
  with an FP-dossier justification, or a sanctioned guest-denial/own-namespace
  case, refutes. `with inherited sharing` refutes only if no class in the
  solution is `without sharing` (check before confirming).
- **For per-record / IDOR claims, prove the Id is caller-supplied AND the access
  to the instance is unchecked.** Trace the Id parameter to its origin: a
  component/REST/SOAP/Flow caller supplying it confirms control; an Id derived
  server-side from the authenticated user's own context refutes. Then read for
  an instance check: a `with sharing` class whose query honors sharing returns
  zero rows for an unentitled Id and refutes; an explicit `UserRecordAccess`/
  ownership predicate refutes. Object-level CRUD/FLS or user mode alone does
  **not** refute an IDOR — say so in the evidence. A method that only ever
  operates on records the running user owns by construction (e.g. queries
  `WHERE OwnerId = :UserInfo.getUserId()`) refutes.
- **For over-exposure claims, distinguish breadth from a live exploit.** A
  `global`/`@AuraEnabled` method with correct CRUD/FLS, sharing, and per-record
  checks that is merely *more reachable than necessary* is a `low`/`medium`
  least-privilege hardening note, not a `high` — unless the broad exposure is
  what enables one of the other gaps (a `global` method missing the per-record
  check is `high` because *anyone* in the org reaches it). Returning more than
  entitled (all rows of a type, inaccessible fields serialized) is a real
  finding; calibrate severity by what leaks.
- **For guest-user claims, prove the guest path actually reaches the method.**
  The finding requires both: (a) the class/method is reachable from a guest
  profile (a `<classAccesses>` grant in the guest profile/permission set, a
  component on a guest-accessible Site/Experience page) AND (b) the method lacks
  `with sharing` / CRUD/FLS / per-record gating. A guest-reachable method that
  correctly *denies* (the sanctioned case 4) refutes. A violating method with NO
  guest path (reachable only by authenticated subscriber users) is the ordinary
  entry-point case at its own severity, not the guest-breach severity — do not
  inflate it to the public-exposure tier without the guest reachability.
- **Reachability first, always.** A violating method behind a permission set the
  package never assigns, on a class no exposed surface reaches, or in dead code
  is `low`/`info` with a note — not the headline severity.
- **A shipped packaged entry point is a reviewer-visible surface even when
  nothing currently wires it — that is a DOWNGRADE, never a refute.** An
  `@AuraEnabled`/`@RestResource`/`@InvocableMethod`/`@RemoteAction`/`webservice`/
  `global`/`@NamespaceAccessible` method DEFINED in the managed package but not
  currently wired to a live caller (no LWC/Aura component imports it, no Flow
  invokes it, no permission set grants its class yet) still **ships** in the
  package: a subscriber admin can grant or wire it post-install (a class-access
  grant on a permission set, a new component, a Flow), and the Salesforce
  reviewer flags packaged metadata regardless of current wiring. So "defined but
  not reachable / dead packaged code / no caller" lowers severity (to `low`/
  `info` with a "not currently wired" note) and the verdict is `partially_real`
  — it is **NEVER** grounds for `false_positive`. This mirrors `agentforce-package`
  §5 (a packaged artifact a subscriber can bind never refutes on unreachability);
  the one carve-out the prior `apex-exposed-surface` §5 lacked, which let a
  verified Contact-PII finding on a defined-but-unwired entry point be wrongly
  refuted as "unreachable." A defect in the method's OWN authorization — missing
  CRUD/FLS, a wrong or absent sharing declaration, an unguarded per-record (IDOR)
  read or write, mass assignment — is a REAL finding in shipped code at its own
  (reachability-downgraded) severity; only the live-exposure TIER (anonymous
  guest vs authenticated-only) is gated on actual wiring.
- **Directionality: a missing grant is fail-closed, not an exposure.** A class
  absent from a permission set's `classAccesses`, a missing object/field
  permission, or any un-granted access is fail-CLOSED — the method cannot be
  reached by that user — so it is a functionality/packaging gap (`info` at most),
  NEVER a finding. The exposure finding is always an OVER-grant (a class granted
  to a GUEST profile, an over-broad object/field permission), never an
  under-grant.

## 6. Known false-positive patterns

| Pattern | Why it is not a finding (or not at the reported severity) |
|---|---|
| A method that does `[SELECT ...]`/`insert`/`update` with no explicit describe check, on a class whose `*.cls-meta.xml` `apiVersion` is **≥67.0** and that does not opt into system mode | At 67.0+ Apex runs in user mode by default — object/field access IS enforced. The "missing CRUD/FLS" finding requires an explicit system-mode opt-in (` as system`, `AccessLevel.SYSTEM_MODE`, a `without sharing` data path) or an API version ≤66.0. |
| A pure DML/SOQL-to-sink CRUD/FLS dataflow gap with no over-exposure / per-record / guest dimension | Code Analyzer's SFGE pass owns this (`scan-sfge-crud-fls-dataflow`); reporting it here double-counts a scanner finding. Route it to the run-scans pass; this dimension reports only the should-this-be-exposed / per-record / guest specializations. |
| An entry point that takes a record Id but the class is `with sharing` and the query/DML honors sharing | Sharing-enforced access returns zero rows for an unentitled Id and blocks the DML — the per-record boundary IS the sharing model. Confirm the query is not `without sharing`/system-mode before refuting; a `with sharing` class with a sharing-respecting query is the correct IDOR control. |
| A method whose record Id is derived from the authenticated user's own context (`UserInfo.getUserId()`, the user's own related records), not a caller parameter | No caller-controlled Id, no IDOR. The attacker cannot substitute another principal's record. |
| `with inherited sharing` on a controller entry point | The codified rules accept `with inherited sharing` on controller entry points; it is a finding only if some class in the solution is `without sharing` (which makes inherited resolve to without-sharing) — check the whole solution before flagging. |
| A `global`/`@AuraEnabled` method with correct CRUD/FLS, sharing, and per-record checks that is broader than strictly needed | Least-privilege hardening (`low`/`medium`), not a `high` exploit — the access controls hold. Over-exposure is a finding when the breadth enables an *unguarded* path, not when the method is merely reachable. |
| A `without sharing` class with a documented FP-dossier justification, or a sanctioned bypass case (roll-up/aggregate exposing no data, partner-internal log/system-metadata object, high-privileged method non-admins can't reach, guest-user **denial**, bespoke own-namespace policy documented at submission) | These are the five sanctioned CRUD/FLS cases and the documented sharing exceptions (baseline: `violation-crud-fls-bypass`, `violation-sharing-rules-bypass`). A documented, justified exception is the correct posture, not a finding. |
| A guest-reachable method that explicitly DENIES guest access or strictly gates it | Sanctioned bypass case 4 is guest *denial* — denying or gating the guest is the required control, not the vulnerability. The finding requires a guest path that READS or WRITES without gating. |
| A method annotated `@AuraEnabled cacheable=true` flagged as a write risk | Cacheable methods cannot perform DML (the platform forbids it); treat them as read paths. The read-path CRUD/FLS, per-record, and over-return questions still apply, but not a write/IDOR-mutation claim. |
| `webservice`/`@RestResource`/`@InvocableMethod` reachable only by an authenticated subscriber/integration user, flagged at the guest-breach (public-exposure) severity | Without a verified guest/unauthenticated path, this is the ordinary authenticated entry-point case at its own severity — not the anonymous-internet-visitor tier. Confirm the guest reachability before applying the higher severity. |
| A permission set/profile that does NOT grant access to a class/object/field the feature uses | **A missing grant is fail-closed** (the feature can't run for that user) — a functionality/packaging gap (`info` at most), never an exposure finding. The finding is an OVER-grant (guest-profile class access, an over-broad permission), never an under-grant. |
| A packaged exposed Apex method (`@AuraEnabled`/`@RestResource`/`@InvocableMethod`/`@RemoteAction`/`webservice`/`global`/`@NamespaceAccessible`) refuted as "defined but not wired / not currently reachable / dead packaged code / no caller" | This is a **DOWNGRADE, not a refutation.** The method SHIPS in the managed package, so it is a reviewer-visible surface — **a subscriber admin can grant or wire** it post-install (a class-access grant, a new component, a Flow), and Salesforce flags packaged metadata regardless of current wiring. Unreachability lowers severity (`low`/`info`, a "not currently wired" note, verdict `partially_real`); it NEVER yields `false_positive`. A defect in the method's OWN authorization (missing CRUD/FLS, wrong/absent sharing, IDOR, mass assignment) stays a real finding in shipped code. Mirrors `agentforce-package` §5. |
| An FLS/CRUD or sharing finding refuted as "the platform auto-enforces user mode / `with sharing` at API 67.0+" on a package whose `sourceApiVersion` is ≤66.0 | **Invalid refutation — the finding stands.** Auto-enforcement is real only at ≥67.0; at ≤66.0 (the Solano fixture is `64.0`) the old system-mode / `without sharing` defaults hold, so the absent check is a genuine gap. Read the package `sourceApiVersion` (`sfdx-project.json` / scope manifest), not just a class `apiVersion`, before accepting the auto-enforcement rationale. `harness/baseline-refutation-check.mjs` flags this class of bad refutation deterministically. |

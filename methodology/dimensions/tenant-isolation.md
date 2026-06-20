# Dimension: tenant-isolation

The multi-tenant boundary: can data belonging to customer A reach customer B,
in either direction, through any code path. Applies when the scope manifest
shows a shared multi-tenant backend; single-tenant-per-deployment architectures
are marked N/A in the target map with the reason, never silently skipped.

## 1. Threat concept

Cross-tenant read or write is the **auto-fail class** for any shared external
endpoint behind a Salesforce listing: the review's manual penetration test
provisions users in different tenants and probes the boundary directly, and the
submission must document the isolation model (baseline:
`endpoint-multi-tenant-isolation`). Severity is `critical` by definition — there is no
"minor" cross-tenant leak.

Three sub-classes, in descending order of how often field audits confirmed them:

1. **The one endpoint that forgot.** The partner's claimed model (row-level
   security, a global query scope, a tenant-scoping middleware) is sound, and
   one code path bypasses it: a raw SQL query outside the ORM, a lookup added
   before the scoping dependency existed, an aggregate/count that skips the
   scoped repository. Most confirmed findings are gaps between the claimed
   model and one path that doesn't participate in it.
2. **IDOR across the boundary.** Object references (UUIDs, sequential ids) in
   detail/mutation endpoints honored without verifying the object belongs to
   the caller's tenant — including write-side IDOR (PATCH/DELETE with a foreign
   id) and **mass-assignment of the tenant id itself** (a create/update payload
   that accepts `org_id`/`tenant_id`/`account_id` from the request body).
3. **Second-order leaks.** Code that runs *without* a request context:
   background jobs, scheduled fan-outs, exports, webhook handlers, search
   indexers. These act with elevated database privileges or no tenant binding
   at all, and they don't show up in route-by-route review. (Deep treatment of
   the async half lives in
   `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/background-jobs.md`; exports in
   `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/data-export.md` — this
   dimension establishes the boundary model those re-use.)

**Within-org owner/subtree authorization is a related but distinct layer.** The
three sub-classes above are the *cross-tenant* boundary (critical by definition).
*Within* one org, "a rep sees own deals, a manager sees their subtree" is
hand-written application authorization on every owner-scoped path (the
`visible_user_ids` pattern), not RLS — a missing filter there leaks a *peer's*
records to a *peer* (OWASP API1:2023, within-org BOLA; baseline:
`within-org-bola`). It is `major`, not `critical` (intra-tenant), and its
per-record half overlaps `apex-exposed-surface`'s IDOR probe — but the *list*
path that returns every owner's rows in the org is flagged here.

## 2. What good looks like

- **Enforcement below the app layer where the stack allows it.** The strongest
  field-tested pattern: Postgres row-level security `ENABLE` **and** `FORCE` on
  every tenant-owned table, policy keyed on a per-request session variable
  (e.g. `current_setting('app.current_tenant_id')`), application connecting as
  a role **without** `BYPASSRLS`. App-layer `.where(tenant_id = …)` filters are
  then a performance optimization, not the security boundary. ORM-scope
  equivalents (global scopes, Hibernate tenant filters, Prisma client
  extensions) are acceptable when they are *non-optional* — a scope each query
  must opt into is a convention, not a control.
- **Tenant identity derived from the authenticated principal only.** Token
  claims or session → tenant id. Never from a header, query parameter, or
  body field on customer-facing routes.
- **Context binding has a single choke point with a defined lifecycle**: bound
  per request (or per job) after authentication, scoped to the
  transaction/connection, and not able to leak across pooled connections.
  Transaction-scoped binding (`SET LOCAL`) is cleared by commit — code that
  commits mid-request and keeps querying is silently unscoped afterward.
- **Fail closed, loudly.** Know the failure mode when the binding is missing:
  RLS without the session variable typically returns *zero rows silently* —
  fail-closed for confidentiality but it masks bugs (a count of 0, an empty
  export) and corrupts test results. Good implementations assert the binding
  exists before tenant-scoped work.
- **Belt-and-suspenders on cross-tenant-scannable lookups.** Single-row
  lookups that would match any tenant's row if the boundary were bypassed
  (`…WHERE is_active = TRUE LIMIT 1`) carry an explicit tenant filter even
  though RLS is the boundary — this makes a missing binding or a privileged
  connection fail closed instead of silently leaking.
- **Coverage is enforced, not remembered**: a CI test that scans every table
  (or model) carrying a tenant column and fails the build when one lacks a
  policy/scope — including join-through tables whose tenant affiliation is
  only via foreign key.
- **In-tenant visibility is a separate, documented layer.** "Rep sees own
  records, manager sees their subtree" enforced at the service layer is an
  authorization feature, not the tenant boundary — keep the two distinguishable
  in code and in the artifacts, because the review asks about both separately.
- **The evidence the review expects: a two-user bidirectional proof.** Two
  test users in two tenants; demonstrate A cannot read or mutate B's objects
  *by direct id* and vice versa — bidirectional, because an asymmetric bug
  (B-to-A only) is real and a one-direction test misses it. The reviewer-facing
  environment for this is built in
  `/sf-security-review-toolkit:prepare-test-environment`; the access-control
  artifact template (`${CLAUDE_PLUGIN_ROOT}/templates/access-control.md.tmpl`)
  has the section this proof feeds.

## 3. Detection heuristics

Locate (a) the enforcement mechanism, (b) the binding choke point, (c) the
query surfaces that might bypass both.

**All stacks** — grep seeds: `tenant_id`, `org_id`, `organization_id`,
`account_id`, `current_setting`, `SET LOCAL`, `set_config`, `RLS`,
`CREATE POLICY`, `BYPASSRLS`, raw-SQL markers (`text(`, `raw(`, `query(`,
`execute(`), and the suspicious trio in list endpoints: `findAll`, `SELECT …`
without a tenant predicate, `LIMIT 1`.

| Stack | Where to look |
|---|---|
| Python (FastAPI/Django) | SQLAlchemy: session factories and dependencies binding the session variable (`set_config`/`SET LOCAL` in a `Depends` or context manager); Alembic migrations for `CREATE POLICY` / `ENABLE ROW LEVEL SECURITY` / `FORCE`; raw `sql_text()` call sites. Django: `django-tenants` (schema-per-tenant — different model, different probes: schema switching middleware), custom managers/`get_queryset` overrides, middleware setting thread-locals. |
| Node (Express/Nest) | Prisma `$extends`/middleware injecting tenant predicates; TypeORM global scopes/subscribers; `pg`/`knex` raw query sites; Nest interceptors/CLS (`AsyncLocalStorage`) carrying tenant context — check what happens when the ALS store is empty. |
| Ruby (Rails) | `acts_as_tenant` (`set_current_tenant`, `default_scope`), `apartment` (schema-per-tenant), `Current.tenant` attributes; `find_by_sql`/`connection.execute` raw sites; controllers calling `Model.find(params[:id])` without `current_tenant` scoping. |
| Java (Spring) | Hibernate multi-tenancy (`CurrentTenantIdentifierResolver`, `@TenantId`), `@Filter`/`@FilterDef` activation (a filter that must be enabled per-session is a per-call opt-in — find who enables it), Spring Data specifications, `JdbcTemplate` raw sites, AOP aspects binding context. |
| Apex/LWC (where relevant) | In-org isolation is the platform's job (sharing model). The relevant probe is the **package↔endpoint contract**: does the external endpoint derive the tenant from its own authenticated credential, or does it trust an org id the package sends in the payload? A client-supplied org id honored server-side is sub-class 2 above, regardless of how the package behaves. |

Also locate: the DB role/connection string the app uses (superuser or
`BYPASSRLS` would hollow out an RLS claim), the connection-pooling mode
(statement/transaction/session pooling changes whether `SET LOCAL` vs `SET` is
safe), and the migration that most recently added a tenant table (newest tables
are the likeliest to have missed the policy).

## 4. Finder prompt block

```
Primary targets (read these first, then follow imports/call-sites; use grep to
locate the real files when a path is approximate):
{{TARGETS}}

Stack notes (claims from the partner's own docs — verify against the ACTUAL
code, never assume; most real findings are gaps between the claimed isolation
model and one code path that forgot it):
{{STACK_NOTES}}

Threat focus — the cross-tenant boundary, bidirectional. Probe: every
customer-visible LIST/DETAIL/mutation service — does it run inside the claimed
enforcement mechanism (RLS session-variable binding, global scope, tenant
middleware), and is the tenant id derived from the authenticated principal
rather than any request-supplied value? Raw SQL / aggregate / count paths that
bypass the ORM scope. The binding lifecycle: where is the tenant context bound,
is it transaction-scoped, can a mid-request commit or a pooled connection leave
subsequent queries unscoped, can context leak across requests? The silent-zero
failure mode: queries that run with NO binding (background entrypoints, health
checks, CLI/scripts) — do they fail loudly or return empty/cross-tenant
results? Single-row lookups that would match any tenant's row if enforcement
were bypassed (… WHERE active LIMIT 1) lacking an explicit tenant filter —
defense-in-depth gap, usually low/medium unless the path runs privileged.
Tables/models with a tenant column missing a policy/scope, INCLUDING
join-through tables whose tenancy is only via FK; check the newest migrations
first. IDOR both directions: can a detail or mutation endpoint be fed another
tenant's object id (UUID or sequential) and act on it; mass-assignment of
tenant_id/org_id/owner fields in create/update payloads. WITHIN-ORG BOLA (a
DISTINCT, lower-severity layer — major not critical, because it is intra-tenant,
not cross-tenant): within one org, owner/subtree-scoped records (a rep sees own
deals, a manager sees their subtree) are filtered by hand-written application
authorization (the visible_user_ids pattern), NOT by RLS — does every
owner-scoped LIST/DETAIL/tool path apply that visible-user/owner filter, or can a
peer read a peer's rows (a same-tenant IDOR that RLS cannot catch because both
rows share the org)? The per-record half overlaps apex-exposed-surface's IDOR
probe; the LIST path returning every owner's rows in the org is this dimension's
to flag (baseline: within-org-bola). Second-order
surfaces: exports, webhook receivers, scheduled fan-outs, search indexers
acting without tenant context (flag here; deep async coverage belongs to the
background-jobs dimension — don't duplicate its findings). The DB role the app
connects as (BYPASSRLS/superuser hollows out an RLS claim) and the pooling
mode vs SET LOCAL semantics.

Known findings — do NOT re-report any of these:
{{LEDGER}}

Report ONLY findings grounded in code you have READ, with exact file:line.
Prefer precision over volume — a cross-tenant claim that doesn't survive
verification wastes everyone's time, and a real one is critical: state plainly
which it is. If a control is correctly implemented, do NOT report it (one
info-level note for a notably strong control is allowed). For each finding give
a concrete exploit_scenario: the attacker (which tenant, which role), the
request they send, and exactly what foreign data they read or mutate.
```

## 5. Verifier guidance

A cross-tenant confirmation is the most consequential verdict this engine
emits — read all of the following before confirming:

- **The enforcement layer itself**: the actual RLS policies (both `ENABLE` and
  `FORCE`; a policy without FORCE exempts the table owner), or the global
  scope/middleware source. A finder claiming "service X has no tenant filter"
  is refuted if the DB layer enforces it — and downgraded to a
  defense-in-depth note, not dismissed, if the path can ever run on a
  privileged connection.
- **The binding choke point and its position** relative to the cited code:
  does the request/job actually pass through it before the query runs?
- **The connection configuration**: which role the app authenticates as, and
  the pooler mode. `SET LOCAL` under transaction pooling is sound; session-level
  `SET` under shared pooling is a real cross-request leak vector.
- **For IDOR claims**: the full dependency chain on the route (auth dependency,
  object-ownership check in the service, the DB-layer policy). Confirm the
  foreign id would actually resolve — under RLS it returns not-found, which
  refutes the exploit.
- **For mass-assignment claims**: the schema/serializer that whitelists fields
  (Pydantic model, strong parameters, DTO) — the field reaching the ORM is
  what matters, not its presence in the raw payload.
- **For silent-zero claims**: distinguish confidentiality impact (none — it
  fails closed) from integrity/correctness impact (real but lower severity),
  unless the code reacts to the empty result by retrying on a privileged
  connection — read the error path before adjusting severity.

## 6. Known false-positive patterns

| Pattern | Why it is not a finding (or not at the reported severity) |
|---|---|
| Service query lacks an explicit tenant `WHERE` but the table is under forced RLS and the request path binds the session variable | The DB layer is the boundary; absence of the redundant filter is at most a low defense-in-depth note on cross-tenant-scannable lookups — not a cross-tenant finding. |
| A query with no binding returns empty results | Fail-closed, not a leak. Correctness bug (silent zero) — report as low/medium integrity, never critical, unless a privileged-retry path exists. |
| Global reference tables (roles catalog, feature flags, plan definitions) without tenant scoping | Intentional shared data — a finding only if rows carry tenant-confidential content. Look for a documented exemption (migration docstring, coverage-test allowlist) before flagging. |
| An org-wide endpoint visible to admin/leader roles without per-user visibility filtering | In-tenant *visibility* policy, not the tenant boundary. Only a finding if a low-privilege role reaches it — check the role gate before confirming, and never label it cross-tenant. |
| Tenant id appears in a request payload on admin/system/webhook paths | Legitimate when the handler resolves-and-verifies it against the authenticated credential or a signed payload (e.g. a per-tenant webhook secret). The finding requires the value to be *trusted*, not merely present. |
| Test fixtures/seeds creating multiple tenants in one session | Test plumbing, not a production path. |
| Schema-per-tenant architectures "missing RLS" | Different isolation model — the probes shift to schema-switching correctness and shared-schema spillover; absence of row policies is expected. |

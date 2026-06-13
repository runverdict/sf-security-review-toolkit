# Dimension: background-jobs

The async half of the application: queued tasks, scheduled fan-outs, workers,
cron-alikes — any code that runs **without an incoming request context**.
Applies when the scope manifest shows a task queue, worker, or scheduler that
touches tenant data. This is the second-order continuation of
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/tenant-isolation.md` §3: that
dimension establishes the tenant boundary model; this one probes every code
path that runs outside it.

## 1. Threat concept

A request handler inherits an authenticated principal, a bound tenant context,
and (often) a database role chosen for least privilege. A background task
inherits **none of that** unless the partner re-established it explicitly — and
the failure is invisible in route-by-route review because there is no route.
The review cares because shared multi-tenant backends are pen-tested for
cross-tenant access (baseline: `endpoint-multi-tenant-isolation`), and the
async surface is where the claimed isolation model most often has a hole that
the synchronous surface does not.

Two failure directions, both real, with opposite symptoms:

1. **Silent-empty (confidentiality fails closed, correctness fails).** A worker
   queries a tenant-scoped table with no tenant context bound. Under row-level
   security keyed on a session variable, the query returns **zero rows, with no
   error**. Nothing leaks — but the nightly rescore processes nothing, the
   export is empty, the digest is blank, and no alarm fires. Field audits found
   this masking real bugs for weeks; it also silently corrupts any test that
   reads back through the worker's session.
2. **Cross-tenant (confidentiality fails open).** The same unbound task, if it
   ever runs under a privileged/`BYPASSRLS`/superuser database connection —
   or if the isolation model is app-layer scoping rather than a DB boundary —
   reads and writes **every tenant's rows at once**. A fan-out job that loops
   "all active orgs" and binds the context once (or not at all) instead of
   per-org will happily write org A's computed values onto org B's records.

Plus the task-specific classes:

- **Attacker-influenced task arguments.** A tenant id, object id, file path, or
  URL that flows from a request into an enqueued task and is *trusted* on the
  worker side — re-validation that happened in the request handler does not
  travel with the message. Enqueue-time authorization is not execution-time
  authorization.
- **System-actor writes without tenant context.** Audit rows, notifications,
  and derived records written by a task with a `system`/`null` actor and no
  explicit tenant id — which under a forced-RLS insert policy either gets
  rejected (`new row violates row-level security policy`) or, on a privileged
  connection, lands unscoped.
- **Replay / non-idempotency.** At-least-once delivery means tasks re-run;
  retries re-run; a duplicate enqueue re-runs. A task that isn't idempotent
  double-charges, double-sends, or double-applies a state transition.
- **Per-task session lifecycle bugs.** A worker process that shares one
  long-lived DB session/engine across tasks, or builds an event loop per task
  over a connection pool bound to a different loop, deadlocks or leaks context
  between tasks — and context that leaks between tasks is a cross-tenant vector
  on its own.

## 2. What good looks like

- **Every task re-establishes context as its first act.** A task touching
  tenant data binds the tenant session variable (the same choke point requests
  use — ideally the *same* context-manager, e.g. a `tenant_session(org_id)`
  wrapper) before any query or write, and the org id it binds comes from the
  task's own validated argument, re-checked against the actor where one exists.
- **Fan-outs bind per unit, not per batch.** A loop over orgs opens (and binds)
  a fresh scoped context inside the loop body, per org — never binds once
  outside the loop, never relies on the previous iteration's binding having
  been cleared.
- **Task arguments are treated as untrusted input.** Ids and paths arriving in
  a task payload are re-authorized on the worker side as if they came from an
  anonymous request: the tenant the task claims to act on is verified, not
  assumed, and the task fails closed if the binding/authorization can't be
  established.
- **System-actor writes carry an explicit tenant id.** Audit and derived-record
  writes from a context with no authenticated user pass the resolved tenant id
  explicitly (and bind the session variable for the insert), so the forced-RLS
  insert policy is satisfied and the row is correctly scoped.
- **Idempotency is designed in.** Tasks key on an idempotency token or a
  natural unique key, use upsert/guard-before-write, and are safe under
  at-least-once delivery and retry. State transitions are conditional
  (compare-and-set), not blind.
- **Session/loop lifecycle is per-task and clean.** Each task gets a scoped
  session that is committed-or-rolled-back and closed at task end; async
  workers don't reuse an event loop bound to a pool from a previous task
  (a documented failure: a per-task new loop over a shared async engine pool
  bound to the first loop, which freezes every task after the first on a
  prefork worker). Connection-pool sizing accounts for worker concurrency
  against the database's connection ceiling.
- **Failures are loud.** A missing binding, a zero-row result where rows were
  expected, or an RLS insert rejection raises and is observable — not swallowed
  by a bare `except` that lets the schedule march on green.

## 3. Detection heuristics

Locate (a) the task/worker entrypoints, (b) what context each establishes
before its first tenant query, (c) the enqueue call sites and what flows from
request into payload, (d) the scheduler/fan-out loops.

**All stacks** — grep seeds: `delay(`, `apply_async`, `enqueue`, `perform_`,
`@task`, `@shared_task`, `@app.task`, `cron`, `schedule`, `beat`,
`every(`, the tenant-context binder's name (from the tenant-isolation target
map — its *absence* in a worker file is the signal), `system`/`actor` in audit
writes, `SET LOCAL`/`set_config`/`current_setting` inside task modules.

| Stack | Where to look |
|---|---|
| Python (FastAPI/Django) | Celery: `@app.task`/`@shared_task` in `tasks/`, `worker`/`beat` config, `apply_async`/`delay` call sites; RQ/Dramatiq/`arq` actors; APScheduler/`celery beat` schedules; FastAPI `BackgroundTasks`; Django `management/commands/` and `django-q`/`celery`. The tell: a task module that imports the model layer but **not** the tenant-session context manager. For async tasks, the `asyncio.new_event_loop()`-per-task pattern over a shared SQLAlchemy async engine. |
| Node (Express/Nest) | BullMQ/Bee `Queue`/`Worker` processors, `agenda`/`bree`/`node-cron` jobs, Nest `@Processor`/`@Cron`/`@Interval`; check whether the AsyncLocalStorage tenant store that requests populate is *also* populated in the processor (it is not, unless code does it) — an empty ALS store in a worker is the silent-empty bug. |
| Ruby (Rails) | Sidekiq workers (`perform`), ActiveJob (`perform_later`), `sidekiq-cron`/`whenever`/`clockwork`; `acts_as_tenant` requires `ActsAsTenant.with_tenant(t) { }` in the job — its absence is the finding; `Current.tenant` reset between jobs (Sidekiq reuses threads — stale `Current` attributes leak across jobs if not reset). |
| Java (Spring) | `@Async` methods, `@Scheduled` tasks, `@KafkaListener`/`@RabbitListener`/`@JmsListener`, Spring Batch, Quartz jobs; the Hibernate tenant resolver (`CurrentTenantIdentifierResolver`) is request-thread-bound — confirm async threads resolve a tenant at all; `@Transactional` propagation on async boundaries. |
| Apex/LWC (where relevant) | `Queueable`, `@future`, `Batchable`, `Schedulable` run as a *system* context where the org sharing model and FLS are **not** automatically enforced — the probe is `with sharing`/`WITH USER_MODE`/`stripInaccessible` discipline inside async Apex, which the platform does not apply for you. (Apex CRUD/FLS coverage overall is Code Analyzer's job per the methodology — flag the async-specific gap here, don't claim full coverage.) |

Also locate: the database role the worker connects as (a worker on a privileged
connection turns silent-empty into cross-tenant), and any request handler that
passes a client-supplied id straight into an enqueue call.

## 4. Finder prompt block

```
Primary targets (read these first, then follow imports/call-sites; use grep to
locate the real files when a path is approximate):
{{TARGETS}}

Stack notes (claims from the partner's own docs — verify against the ACTUAL
code; the tenant-context binder's NAME and the worker's DB role matter most):
{{STACK_NOTES}}

Threat focus — background-task authorization and tenant safety. Probe: does
EVERY task that touches a tenant-scoped table bind the tenant context (the same
session-variable / context-manager choke point the request path uses) BEFORE
its first query or write? An unbound task either silently returns zero rows
under row-level security (fail-closed for confidentiality but it masks bugs and
corrupts results) OR, if the worker ever runs on a privileged/BYPASSRLS/
superuser connection or the isolation model is app-layer scoping, reads and
writes across ALL tenants — establish which by reading the worker's DB role.
Fan-out/scheduled loops over multiple orgs: is the context bound PER ORG inside
the loop, or once outside (or never)? A once-bound or unbound fan-out writing
one org's computed values onto another's records is cross-tenant — critical.
Attacker-influenced arguments: trace every id/path/URL that flows from a
request into an enqueued task payload — is it re-validated on the worker side,
or trusted because "the handler already checked"? Enqueue-time authz is not
execution-time authz. System-actor writes (audit rows, notifications, derived
records) from a no-authenticated-user context: do they pass an EXPLICIT tenant
id and bind the session variable for the insert, or will the forced-RLS insert
policy reject them / land them unscoped on a privileged connection? Idempotency
and replay: at-least-once delivery and retries re-run tasks — is each task safe
to run twice (idempotency key, upsert, compare-and-set), or does it double-send
/ double-apply? Per-task session/loop lifecycle: shared long-lived session
across tasks, an event loop built per task over a pool bound to a different
loop, Current/thread-local context leaking between tasks on a reused worker
thread. Error paths that swallow a missing-binding / zero-row / RLS-rejection
failure with a bare except and let the schedule continue green. Secrets or
tokens logged in task context.

Known findings — do NOT re-report any of these:
{{LEDGER}}

Report ONLY findings grounded in code you have READ, with exact file:line.
Prefer precision over volume. State plainly for each unbound-context finding
whether it is silent-empty (correctness, lower severity) or cross-tenant
(critical) — that turns entirely on the worker's DB role and isolation model,
so READ them before assigning severity. If a control is correctly implemented,
do NOT report it (one info-level note for a notably strong control is allowed).
For each finding give a concrete exploit_scenario: the trigger (enqueue path or
schedule), the missing context, and exactly what data is read empty, leaked, or
mutated across the boundary.
```

## 5. Verifier guidance

The severity of nearly every finding here swings on facts the finder may not
have read. Before confirming:

- **The worker's database role and the isolation model.** This is the pivot:
  unbound-context on a non-`BYPASSRLS` role over forced RLS is silent-empty
  (`low`/`medium`, correctness); the same code on a privileged connection or
  under app-layer-only scoping is cross-tenant (`critical`). Read the
  connection string / role the worker authenticates as before you assign a
  severity — do not inherit the finder's.
- **The binding choke point, inside the task.** Confirm the task does *not*
  pass through the tenant context manager (read the task body and what it
  calls), and that the table it touches is actually tenant-scoped. A task that
  delegates to a service which itself binds the context is fine.
- **The argument's trust path, end to end.** For an attacker-influenced-arg
  claim, trace the value from the enqueue call site (is it client-supplied?)
  through the message to the worker's use of it (is it re-authorized?). Both
  halves must hold: client-controlled AND trusted on execution.
- **The fan-out loop's binding position.** Bound-inside-loop refutes;
  bound-once-outside or never confirms. Check whether the binder clears on
  context exit (a `with` block) — a leaked binding from iteration N into N+1 is
  itself the bug.
- **Idempotency at the data layer.** A non-idempotent-looking task is refuted
  if the write is an upsert / guarded by a unique constraint / conditional
  state transition. Read the actual write, not the task name.
- **Whether the failure is loud.** A "swallowed RLS failure" claim needs an
  actual bare `except`/rescue that continues; structured error handling that
  re-raises or alerts refutes it.

## 6. Known false-positive patterns

| Pattern | Why it is not a finding (or not at the reported severity) |
|---|---|
| A task with no tenant binding that operates only on global/reference/operational tables (job ledger, feature flags, system metrics) | No tenant data touched — nothing to scope. Confirm the tables are genuinely non-tenant before clearing. |
| Unbound-context task on a forced-RLS, non-`BYPASSRLS` connection | Silent-empty: fail-closed for confidentiality. Real correctness bug, report as `low`/`medium` — never `critical` and never "cross-tenant" unless a privileged-connection or app-scoping path exists. |
| A fan-out that binds per org inside the loop via a `with` context manager | Correct pattern. The redundant-looking re-bind each iteration is the control, not waste. |
| Task argument is an internal id minted server-side and signed/opaque, not client-supplied | Re-validation is belt-and-suspenders, not required, if the value cannot be attacker-chosen. Confirm provenance. |
| At-least-once / retry on a task whose only effect is an idempotent upsert or a conditional state transition | Designed for replay. Not a finding. |
| A `system`-actor audit write that passes an explicit resolved tenant id and binds the GUC for the insert | The correct pattern for context-less writes — this is what good looks like, not a finding. |
| Worker logs a task id, org id, or job name | Operational telemetry. The finding is a secret/token/credential in the task log, not the identifiers. |
| `BackgroundTasks`/`after_response` work that runs in the request's own context (and thus inherits its binding) | Still inside the request lifecycle — not the context-less class this dimension targets. |

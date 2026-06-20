# Dimension: error-handling-disclosure

Two failure modes of the same code path — how the application behaves when
something goes wrong. **Disclosure**: an error returns the internals (a stack
trace, a SQL fragment, a file path, a framework debug page, a config value) to
the caller, or writes a secret/PII into a log a lower-privileged operator can
read. **Fail-open**: a `try`/`catch` (or a missing check on an exceptional
branch) around a *security decision* swallows the exception and falls through to
**allow** — the control is present in the happy path and absent the moment
anything throws. Applies to **every architecture in scope** — server code, Apex,
and any endpoint all have error paths. Boundaries: the cryptographic mechanics
of a verifier that throws (constant-time compare, algorithm pinning) belong to
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/crypto-internals.md`; the
tenant-binding-missing fail-closed question to
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/tenant-isolation.md`; the at-rest
storage of the secret that a log then leaks to
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/secrets-credentials.md`. This
dimension owns the **error/exception path itself**: what it reveals, and which
way it fails.

## 1. Threat concept

Information disclosure through verbose errors is two of the review's named
recurring failure causes (baseline: `fail-info-disclosure` — verbose errors,
stack traces, sensitive data in logs; `endpoint-error-hygiene-debug-off` — the
endpoint-side "production mode, generic error pages" bar) and a codified Top-20
violation for secrets in debug output (baseline: `violation-secret-data-in-debug`,
verbatim: *"Don't log secret data, sensitive information, passwords, keys, or
stack traces in production environments"* — the rationale being that the profiles
permitted to read logs are not the profiles permitted to read secrets). The
fail-open half is the classier and quieter defect (baseline:
`error-handling-fail-open`): a security control that is real in the test that
exercises the happy path but evaporates under an exception — CWE-636 (Not Failing
Securely) / CWE-755 (Improper Handling of Exceptional Conditions). A DAST run
that forces exceptions (malformed input, oversized bodies, denied access,
upstream timeouts) is exactly how the reviewer surfaces both halves at once.

Sub-classes, in the order field audits rank them:

1. **Stack trace / internals in the response.** An unhandled exception, or a
   handler that serializes the exception, returns `err.stack`, a SQL error
   verbatim, a file-system path, the ORM's query, or a framework debug page to
   the caller. The sharpest real instance: an error handler that returns the
   stack trace **on the auth-failure path** — a `401`/`403` that leaks the
   server's internals to precisely the unauthenticated caller probing it.
2. **Debug mode / verbose framework errors in production.** `DEBUG=True`
   (Django), `app.debug`/`FLASK_DEBUG`, `NODE_ENV` not `production`, Express
   default error handler, `display_errors=On`, a Spring whitelabel/actuator
   error page with a stack trace, an Apex un-caught exception surfacing the full
   trace to a Visualforce page or an integration caller.
3. **Secrets / PII in logs.** `console.log`/`logger.info`/`System.debug` of a
   token, password, API key, full request body, decrypted value, or a customer
   record — written where a support/ops profile (or an aggregated log sink, or a
   third-party log shipper) can read what that profile is not entitled to see.
4. **Fail-open security logic.** A `try`/`catch` wrapping an authorization /
   HMAC / signature / license / CSRF / tenant-binding check whose `catch`
   returns success, `true`, an empty-but-truthy result, or does not
   re-raise — so a malformed token, a thrown verifier, or an upstream error
   *grants* access. Variants: a verification function that returns `false` only
   on an explicit mismatch but `true`/`undefined` on the exception path; a guard
   that `continue`s past the check on error; a webhook signature check inside a
   `try` whose `catch` logs and proceeds; an Apex permission check whose
   exception is swallowed by a bare `catch (Exception e) {}`. **This is a
   SECURITY-control class, not a config-validation class.** Failing to validate a
   NON-security config value (a DB URL, a service endpoint, a feature flag) at
   boot is fail-CLOSED on availability — the app crashes at use time, it does not
   grant access — so it is a robustness nit (`low`/`info`), not fail-open. The
   fail-open finding requires a security control (authz / HMAC / signature /
   license / CSRF / tenant-binding) that DEFAULTS TO ALLOW on the exceptional
   path, never a config whose absence halts the process.
5. **Error-message oracles.** Distinguishable error responses that leak
   existence/structure: a login that says "no such user" vs "wrong password"
   (account enumeration), a record fetch that 404s for "not yours" but 403s for
   "exists-but-denied" (existence oracle), a validation error echoing which
   field/constraint failed in a way that maps the schema. Lower severity, real
   for identity and per-record surfaces.

## 2. What good looks like

- **One centralized error boundary that returns a generic, safe shape.** A
  single handler (Express error middleware, FastAPI exception handler, a Spring
  `@ControllerAdvice`, an Apex top-level catch that maps to `AuraHandledException`
  with a curated message) converts every unhandled error into a generic message
  plus a correlation id — the *details* go to the server log, never the
  response. The caller gets "something went wrong (ref: abc123)", not the trace.
- **Production runs in production mode, asserted.** `DEBUG`/`display_errors`/
  framework debug is off in production and the off-state is enforced at boot or
  by config the deploy guarantees (not "remember to set it"). No actuator/debug
  endpoint is internet-reachable.
- **Logs are structured and scrubbed.** Secrets, tokens, full bodies, and
  decrypted values are redacted or omitted by a logging filter, not by author
  discipline at each call site; stack traces go to the log at the boundary, with
  the sensitive fields stripped. (`violation-secret-data-in-debug` is satisfied
  by construction, not by grep.)
- **Security decisions fail CLOSED.** Every authorization / signature / HMAC /
  license / tenant-binding check denies on *any* exceptional path: the verifier
  returns `false` (or raises) on a thrown error, the guard's `catch` re-raises or
  denies, and there is no code path where a malformed input or upstream failure
  yields access. The default is deny; access requires the check to *affirmatively
  succeed*, never merely "not have failed yet."
- **Apex error hygiene.** `catch` blocks log via the platform and rethrow a
  curated `AuraHandledException`/custom exception with a safe message; no
  `System.debug` of sensitive data (it persists in debug logs readable by a
  different profile); no bare `catch (Exception e) {}` around a permission or
  CRUD/FLS check; DML/SOQL exceptions don't surface raw to the caller.
- **Uniform, non-oracular error responses** on identity and per-record paths:
  the same generic failure for "no such user" and "wrong password", for
  "doesn't exist" and "exists but not yours" — existence and validity are not
  inferable from the error.

## 3. Detection heuristics

Find the error boundaries, the debug toggles, the log sinks, and — the
load-bearing probe — every `try`/`catch` that *wraps a security check*. The
disclosure half greps well; the fail-open half needs the catch read in context.

**All stacks** — grep seeds, disclosure half: `err.stack`, `.stack`,
`printStackTrace`, `traceback`, `format_exc`, `DEBUG = True`, `DEBUG=`,
`display_errors`, `app.debug`, `FLASK_DEBUG`, `NODE_ENV`, `whitelabel`,
`actuator`, `console.log(err`, `console.error(err`, `res.send(err`,
`res.json({ error: err`, `String(err)`/`${err}` in a response body,
`System.debug(`, `getMessage()` flowing to a response. Fail-open half:
`catch` blocks whose body `return true`/`return`/`pass`/`continue`/is empty near
a `verify`/`auth`/`authorize`/`hasAccess`/`checkPermission`/`isValid`/`hmac`/
`signature`/`license`/`csrf` call; `except: pass`, `except Exception:` with a
permissive fallthrough, `catch (e) {}`, `catch (Exception e) {}`,
`rescue => e` with no re-raise around a check.

| Stack | Where to look |
|---|---|
| Python (FastAPI/Django) | `DEBUG` in settings + how it's set per env; custom `exception_handler`/middleware and whether it returns `str(exc)`/`traceback`; `logging` config + any `logger.*(secret/body)`; `except` clauses around auth/permission dependencies that `return`/`pass` instead of raising; DRF `DEFAULT_EXCEPTION_HANDLER`. |
| Node (Express/Nest) | The error middleware (`(err, req, res, next)`) and whether it leaks `err.stack`/`err.message` in non-prod (and whether prod is actually set); `res.send`/`res.json` of an error object; webhook/HMAC verification inside a `try` whose `catch` proceeds; Nest exception filters; `process.env.NODE_ENV` guards that default to verbose. |
| Ruby (Rails) | `config.consider_all_requests_local`, `config.action_dispatch.show_exceptions`; `rescue_from` handlers; `rescue => e` around `authorize!`/Pundit/Cancan that don't re-raise; `logger.info(params)` dumping the full body; `Rails.env.production?` gating debug. |
| Java (Spring) | `server.error.include-stacktrace`/`include-message` (must not be `always`); `@ControllerAdvice`/`@ExceptionHandler` returning the exception message; actuator endpoint exposure; `try/catch` around `@PreAuthorize`-adjacent manual checks or a `JwtDecoder` that swallows and proceeds; `printStackTrace()` call sites. |
| Apex/VF/LWC | `catch (Exception e)` blocks — does the body rethrow a curated `AuraHandledException`/custom exception, or `System.debug` the message, or swallow it around a permission/CRUD-FLS check (`isAccessible`/`hasPermission`/`Security.stripInaccessible`)? `System.debug(` of record/credential data; un-caught exceptions on `@AuraEnabled`/`@RestResource`/Visualforce action methods surfacing the full trace; `e.getMessage()`/`e.getStackTraceString()` placed in a response or page. A bare `catch (Exception e) {}` around a security check is the fail-open finding. |

Also resolve: which env actually runs in production (so a "debug on" finding is
real, not a dev default), and where logs are shipped (a third-party sink widens
the blast radius of a logged secret).

## 4. Finder prompt block

```
Primary targets (read these first, then follow imports/call-sites; use grep to
locate the real files when a path is approximate):
{{TARGETS}}

Stack notes (claims from the partner's own docs — verify against the ACTUAL
code, never assume — the central questions are WHAT an error reveals and WHICH
WAY a security check fails):
{{STACK_NOTES}}

Threat focus — how the application behaves when something goes wrong, two
halves. DISCLOSURE: does any error path return internals to the caller — a stack
trace (err.stack/.stack/printStackTrace/traceback), a raw SQL/ORM error, a file
path, a framework debug page (Django DEBUG=True, Flask/Express debug, Spring
whitelabel/actuator, display_errors), or a serialized exception (res.send(err),
String(exc) in a body, AuraHandledException/getMessage() carrying the raw
message)? The sharpest case is a stack trace or verbose error on the AUTH-FAILURE
path (a 401/403 that leaks internals to the unauthenticated prober) — look there
first. Does any log write a secret, token, password, full request body,
decrypted value, or customer PII (console.log/logger/System.debug) where a
lower-privileged ops/support profile or a third-party log sink can read it? Is
production actually running in production mode (is the debug flag OFF and
enforced, not just defaulted)? FAIL-OPEN: find every try/catch (except/rescue)
that WRAPS a security decision — an authorization, HMAC/signature, license,
CSRF, or tenant-binding check — and read the exceptional branch: does the catch
return success / true / an empty-but-truthy value / does not re-raise, so a
malformed token, a thrown verifier, or an upstream error GRANTS access instead of
denying it? Flag any verifier that returns false only on an explicit mismatch but
true/undefined on the throw path; any guard that continues past the check on
error; any bare catch (Exception e) {} / except: pass / catch(e){} around a
permission or CRUD/FLS check. A config value whose absence merely CRASHES the
worker/app (an unvalidated DB URL, endpoint, or feature flag at boot) is
fail-CLOSED on availability, NOT fail-open — do not flag it; fail-open requires a
SECURITY control that grants access on the error path. Also note error-message ORACLES on identity/
per-record paths (no-such-user vs wrong-password, doesn't-exist vs not-yours) at
lower severity. Cryptographic compare/algorithm mechanics belong to
crypto-internals; the missing-tenant-binding fail-closed question to
tenant-isolation; secret at-rest storage to secrets-credentials — flag those as
one-line cross-dimension leads, and own here the error path's disclosure and its
fail direction.

Known findings — do NOT re-report any of these:
{{LEDGER}}

Report ONLY findings grounded in code you have READ, with exact file:line. A
fail-open security check is HIGH/CRITICAL (it is an authorization or signature
bypass under a trivially-induced exception) — say so plainly and give the input
that throws. A stack-trace-on-401 or a logged secret is the disclosure finding.
Prefer precision over volume — a generic 500 page with no detail is NOT a
finding, and a catch that re-raises or denies is NOT fail-open. If a control is
correctly implemented (centralized generic errors, fail-closed checks), do NOT
report it (one info note for a notably clean error boundary is allowed). For each
finding give a concrete exploit_scenario: the attacker, the input or condition
that triggers the error, what is disclosed OR what access the fail-open path
grants, and to whom.
```

## 5. Verifier guidance

- **Read the catch body, not the try body.** A fail-open claim is confirmed only
  by reading what the `catch`/`except`/`rescue` actually does on the security
  path: returning `true`/success, an empty-but-truthy value, or omitting a
  re-raise/deny *is* the finding; a `catch` that logs and then re-raises or
  returns deny refutes it. Name the exact line that grants on error.
- **Confirm the input that throws is attacker-reachable.** Fail-open is only
  exploitable if an attacker can *induce* the exception (a malformed token, an
  oversized/garbage body, a forced upstream failure). If the only way to reach
  the catch is a server-side invariant the caller can't influence, downgrade —
  state which input you believe triggers it.
- **Production-mode is a fact, not an inference.** A `DEBUG`/`display_errors`/
  `include-stacktrace` finding requires that production *actually* runs with it
  on. Read how the env is set in the deployed configuration; a verbose default
  that production overrides to off refutes. Conversely, "off by default" that
  production turns on for troubleshooting confirms.
- **Trace what the error response actually contains.** A handler that catches and
  returns a *generic* message refutes a disclosure claim even if an inner layer
  threw a detailed exception — confirm the detail reaches the *response*, not
  just an internal log. For `getMessage()`/`AuraHandledException`, read what the
  message string is built from.
- **For logged-secret claims, confirm the value is sensitive and the sink is
  readable by the wrong audience.** A redaction filter on the logger refutes; a
  log of a non-secret id is not a finding; a token/decrypted value/full body to a
  support-readable or third-party sink confirms. Cross-reference
  secrets-credentials for the value's classification.
- **Reachability and audience set severity.** A stack trace on an
  internet-reachable unauthenticated endpoint is higher than the same on an
  admin-only internal tool; a fail-open authz on a public route is critical, the
  same on a path already gated upstream is lower — say which in
  `adjusted_severity`.
- **Availability/robustness ≠ security severity.** A missing validation of a
  NON-security config value (a DB URL, a service endpoint, a feature flag) at
  init crashes the process at use time — that is **fail-closed on availability**,
  not a security defect; it is `low`/`info` robustness hygiene, not fail-open.
  Confirm a SECURITY control (authz / HMAC / signature / license / CSRF /
  tenant-binding) actually defaults to ALLOW on the exception path before any
  fail-open severity. (Blind 30-judge: "worker doesn't validate `SOLANO_DB_URL`
  at init" scored HIGH, 0/5 real — it just crashes, no security impact.)

## 6. Known false-positive patterns

| Pattern | Why it is not a finding (or not at the reported severity) |
|---|---|
| A generic 500 response ("an error occurred, ref: …") with the detail going only to the server log | The correct pattern. Disclosure requires the *response* to carry internals, not an internal log line. |
| `err.stack`/`traceback` logged server-side (not returned) at the error boundary | Logging the trace is expected; the finding is returning it to the caller, or logging a *secret* alongside it. |
| A `catch` that logs and then **re-raises** or returns an explicit deny/`false` around a security check | Fails closed. Fail-open requires the exceptional path to grant access, not to deny-and-log. |
| `DEBUG`/`display_errors`/`include-stacktrace` enabled in a dev/test settings file that production overrides to off | Not a production finding. Confirm the deployed/production config before flagging. |
| `AuraHandledException` thrown with a curated, non-sensitive message | The sanctioned Apex pattern — the caller gets a safe message, the platform logs the cause. The finding is `getMessage()` of the raw exception or a `System.debug` of sensitive data. |
| A verifier returning `false` on both mismatch and exception (an explicit deny in the catch) | Fail-closed by construction. The finding is `return true`/`undefined`/empty-truthy on the throw path. |
| Distinct error messages on a non-identity, non-record surface (a generic 400 with a field name on a public form) | Not every distinguishable error is an oracle — the class matters. Account-enumeration / per-record existence oracles are the finding; a form-validation hint usually is not. |
| `System.debug` in test classes or `@isTest` code | Not the deployed surface. Note for hygiene at most; debug-log secret-leak is about runtime production code. |
| A non-security config value (a DB URL, an endpoint, a feature flag) not validated at boot, where its absence CRASHES the process | **Fail-closed on availability** — the app stops at use time, it does not grant access. Robustness nit (`low`/`info`), never a fail-open security finding. Fail-open requires a SECURITY control defaulting to ALLOW, not a config whose absence halts the app. |

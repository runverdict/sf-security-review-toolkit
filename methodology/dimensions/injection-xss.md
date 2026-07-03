# Dimension: injection-xss

Untrusted data becoming code: query injection (SQL/SOQL/NoSQL/command/
template) on the server, and cross-site scripting where a UI renders. The
injection half **always applies** — server code exists in every architecture
in scope; the XSS half applies when the manifest shows a rendered UI (web
app, LWC/Aura/Visualforce). Boundaries: file-path traversal belongs to
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/data-export.md`; HTML injection
into outbound email/chat to
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/email-outbound.md`; consent-
screen metadata injection to
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/oauth-identity.md`; browser
defense-in-depth (CSP, headers, token storage) to
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/web-client.md`. This dimension
owns the construction and the escaping.

## 1. Threat concept

Injection and XSS are two of the review's named recurring failure causes
(baseline: `fail-soql-injection`, `fail-xss`), sit at the top of the OWASP
bar the reviewers test against (baseline: `endpoint-owasp-top10-bar`), and —
for MCP products — gain a new entry point: tool parameters arrive
machine-generated, schema-blessed, and utterly attacker-influenceable
(baseline: `mcpthreat-input-validation-schemas`; the dispatch-gate half is
`mcp-surface`'s probe, the construction half is this one's).

Sub-classes, in the order field audits and the published failure taxonomy
rank them:

1. **Dynamic query construction.** String-built SQL/SOQL/NoSQL where any
   fragment traces to a request: f-strings/concatenation into `execute()`,
   dynamic `ORDER BY`/column names "validated" by nothing, LIKE patterns
   assembled raw, Apex `Database.query(...)` with concatenated user input.
   The ORM is not a guarantee — raw-SQL escape hatches (`text()`, `raw()`,
   `$queryRawUnsafe`, `find_by_sql`) are exactly where field audits found
   the real instances, usually in search, reporting, and CSV-filter code
   where the ORM got awkward.
2. **Command and template injection.** User data reaching `subprocess`/
   `exec`/shell wrappers (PDF generators, image converters, git/CLI
   integrations), or server-side template engines evaluating user-influenced
   template *strings* (not values) — SSTI escalates to RCE in most engines.
3. **Stored XSS through the data plane.** Multi-tenant SaaS + CRM sync makes
   this the sharp one: a field synced from an external CRM (a deal note, a
   contact name typed by anyone) is stored, then rendered in another user's
   browser. "We escape on input" claims fail the first time a second write
   path (import, API, sync job) skips the sanitizer — escape-on-output is
   the only model that survives.
4. **Framework escape hatches.** React/Vue/Angular escape by default; the
   findings live where someone opted out: `dangerouslySetInnerHTML`,
   `v-html`, `[innerHTML]`, `bypassSecurityTrust*`, jQuery `.html()`,
   hand-built DOM in LWC (`lwc:dom="manual"` + `innerHTML`), Visualforce
   `escape="false"` / unescaped `<apex:outputText>`, Aura `aura:unescapedHtml`.
   DOM XSS via `location`/`document.referrer`/`postMessage` data flowing to
   sinks counts even with a clean server.
5. **URL-scheme injection.** User-influenced `href`/`src`/redirect values
   rendered without scheme validation — `javascript:` in a link is XSS
   without angle brackets.

Packaged-Apex caveat (CONVENTIONS-consistent): the *structured* scan for
SOQL injection and CRUD/FLS in Apex is Code Analyzer's job, orchestrated by
`/sf-security-review-toolkit:run-scans` (baseline:
`scan-sfge-crud-fls-dataflow`). This dimension carries the Apex heuristics
because the concept overlaps — but the engine never claims Apex coverage from
this dimension alone.

## 2. What good looks like

- **Parameterization as the only query idiom.** Bind variables everywhere a
  value meets a query; dynamic *structure* (column, direction, table) mapped
  through hardcoded allowlists, never validated-then-interpolated. Raw-SQL
  escape hatches concentrated in a reviewed module, each call site
  parameterized. In Apex: bind variables in SOQL, `String.escapeSingleQuotes`
  only as a last resort with a written reason.
- **No shell when an API exists.** Process execution via argument arrays
  (`shell=False`, `execFile`), never interpolated command strings; user data
  appearing only as arguments, validated against the narrowest shape.
- **Escape-on-output, encode-per-context.** The template engine's
  auto-escaping on everywhere; raw/`safe` filters greppably rare and each
  one justified; data entering HTML, attributes, JS, CSS, and URLs encoded
  for the context it lands in. Sanitization (DOMPurify-class, server-side
  equivalent) reserved for the genuinely-rich-text fields, applied at
  render/output time, with a documented allowlist.
- **Escape hatches wrapped, not scattered.** One audited component/helper
  wraps `dangerouslySetInnerHTML`/`v-html`/manual DOM, applying
  sanitization internally — so the grep surface for "where do we render raw
  HTML" is one file, and a new feature can't quietly add a second.
- **URLs validated by scheme.** Anything user-influenced that becomes an
  `href`/`src`/redirect passes an `https?:`/relative allowlist;
  `javascript:`, `data:`, `vbscript:` rejected at write AND render.
- **Tool parameters treated as request input.** MCP tool arguments, webhook
  payloads, and CRM-synced fields get the same parameterization/escaping
  discipline as form fields — schema validation upstream is a type gate,
  not an injection defense.

## 3. Detection heuristics

Find the raw-query escape hatches, the process-execution sites, the
template configuration, and the framework opt-outs. This dimension greps
well — the opt-outs are syntactically loud.

**All stacks** — grep seeds, injection half: `execute(`, `executemany(`,
`text(`, `raw(`, `query(` with `+` or f-string/`${}`/`%` interpolation
nearby; `ORDER BY`, `LIKE '%`, `IN (` inside string literals being built;
`subprocess`, `os.system`, `exec(`, `spawn(`, `shell=True`, `` ` `` command
templates; template-engine `from_string`/`render_str`/`new Function`.
XSS half: `dangerouslySetInnerHTML`, `v-html`, `[innerHTML]`, `innerHTML =`,
`insertAdjacentHTML`, `document.write`, `bypassSecurityTrust`, `.html(`,
`escape=false`, `unescapedHtml`, `lwc:dom="manual"`, `|safe`, `| raw`,
`html_safe`, `raw(`, `mark_safe`, `format_html`, `__html`.

| Stack | Where to look |
|---|---|
| Python (FastAPI/Django) | SQLAlchemy `sql_text()` call sites (every one — search/report/aggregate services are the usual offenders); Django `.extra()`, `.raw()`, `cursor.execute` with `%`-formatting; Jinja2 `autoescape` config and `|safe` usage; `mark_safe`/`format_html` with non-literal args; `subprocess` wrappers in export/PDF/integration code. |
| Node (Express/Nest) | `$queryRawUnsafe`, `sequelize.query` with template literals, `knex.raw`; `child_process.exec` (vs `execFile`); EJS/Handlebars `<%-` and triple-stash `{{{ }}}`; SSR string concatenation into HTML responses. |
| Ruby (Rails) | `find_by_sql`/`connection.execute` with interpolation, `where("col = #{...}")`; `raw`/`html_safe` call sites; ERB `<%==`; `` system/`` `` with interpolation. |
| Java (Spring) | `JdbcTemplate` with concatenated SQL, JPQL `createQuery` string building; Thymeleaf `th:utext`; `Runtime.exec`/`ProcessBuilder` with single-string commands. |
| Apex/VF/LWC | `Database.query`/`Database.queryWithBinds` call sites — trace every dynamic SOQL string to its inputs; `escapeSingleQuotes` used on non-quoted contexts (field/object names — it does NOT protect those); Visualforce `escape="false"`, `<apex:outputText value="{!...}" escape="false"`; Aura `aura:unescapedHtml`; LWC `lwc:dom="manual"` blocks and what writes into them. Structured coverage is Code Analyzer's (`/sf-security-review-toolkit:run-scans`) — read what the greps surface and judge dataflow. |

Also resolve: where CRM-synced/imported data enters storage (the write paths
that bypass form validation), and the rich-text fields the product
intentionally renders (those need the sanitizer review, not a reflexive
finding).

For the XPath (CWE-643) and LDAP (CWE-90) sub-shapes, the toolkit ships its own
curated Semgrep taint rules (`rules/injection/`, run by `/sf-security-review-toolkit:run-scans`
Family 7 via `--config`) covering the stacks no OSS pack detects — Python XPath and
LDAP, Go XPath and LDAP, Node LDAP, and the `xpath` npm evaluation sinks
(`select`/`select1`/`evaluate`) that njsscan's `parse()`-only rule misses. They are
`mode: taint` (a real source→sink flow is required, never a bare sink), and each
collision-prone sink is anchored to its library (receiver type / import / factory) so
it stays low-FP — but **intra-file / intraprocedural**: a tainted value that crosses a
function or module boundary before the sink is a false negative for the pack and
belongs to this dimension's model finder, not to a noisy rule.

## 4. Finder prompt block

```
Primary targets (read these first, then follow imports/call-sites; use grep to
locate the real files when a path is approximate):
{{TARGETS}}

Stack notes (claims from the partner's own docs — verify against the ACTUAL
code, never assume):
{{STACK_NOTES}}

Threat focus — untrusted data becoming code: injection on the server, XSS
where a UI renders. Probe, injection half: every raw-query escape hatch
(text()/raw()/$queryRawUnsafe/find_by_sql/cursor.execute/Database.query) —
trace each interpolated fragment to its origin; dynamic ORDER BY / column /
table names (is the structure mapped through a hardcoded allowlist or
"validated" then interpolated); LIKE/IN clauses assembled by hand; MCP tool
parameters, webhook payloads, and CRM-synced fields reaching any query
builder (schema validation upstream is a type gate, not an injection
defense); process execution (shell=True, exec, backtick/template commands —
does user data appear in a command STRING vs an argument array);
server-side template injection (user-influenced template STRINGS compiled,
from_string/new Function). Probe, XSS half (only when a UI exists): every
framework escape-hatch call site (dangerouslySetInnerHTML, v-html,
[innerHTML], innerHTML=, document.write, bypassSecurityTrust*, |safe,
html_safe, mark_safe, escape="false", aura:unescapedHtml, lwc:dom="manual")
— what flows in, is it sanitized AT OUTPUT with a real sanitizer, and can a
second write path (import, API, CRM sync) store unsanitized content the
renderer trusts; stored XSS via externally-synced fields rendered in another
user's browser; DOM XSS (location/hash/referrer/postMessage data reaching
innerHTML/eval-class sinks); user-influenced href/src/redirect values
without scheme validation (javascript:/data: URIs); auto-escaping config
(is it ON globally, which templates opt out). Do not report path traversal
(data-export dimension), email HTML injection (email-outbound), or missing
CSP headers (web-client) — flag cross-dimension leads in one line instead.

Known findings — do NOT re-report any of these:
{{LEDGER}}

Report ONLY findings grounded in code you have READ, with exact file:line.
Prefer precision over volume — a false alarm wastes the verifier's time and
the partner's. If a control is correctly implemented, do NOT report it (one
info-level note for a notably strong control is allowed). For each finding
give a concrete exploit_scenario: the attacker, the input they control, the
sink it reaches, and what executes where.
```

## 5. Verifier guidance

- **Trace the interpolated value to its true origin.** Most raw-SQL false
  positives interpolate a *server-side constant* (a table name from an enum,
  a tenant id from the session GUC) — not request data. Confirm the value is
  attacker-influenceable before confirming the finding; parameterized values
  alongside an interpolated constant refute.
- **For dynamic-structure claims**: a dict/enum lookup that maps user input
  to hardcoded column names refutes; a regex "sanitizer" on an identifier
  confirms at lower severity only if a bypass plausibly survives it — write
  the bypass into the evidence or downgrade.
- **For XSS claims, identify the encoding context** the data lands in
  (element, attribute, JS string, URL). Framework auto-escaping refutes
  element-context claims but NOT `javascript:` URL claims or unquoted
  attributes — context decides, not the framework's reputation.
- **For sanitizer claims**: read the sanitizer config. DOMPurify with
  defaults refutes; a hand-rolled regex stripper or a sanitizer applied at
  *input* with a second unsanitized write path confirms.
- **For `lwc:dom="manual"` / manual-DOM claims**: find what writes into the
  node. `textContent` refutes; `innerHTML` with non-literal input confirms.
- **For escapeSingleQuotes claims in Apex**: it protects quoted string
  literals only — confirm the injected fragment lands in a quoted context
  before refuting, because field/object-name injection sails through it.
- **Reachability**: dev-only endpoints, admin-only inputs, and
  feature-flagged paths lower severity, not existence — say which in
  `adjusted_severity` reasoning.

## 6. Known false-positive patterns

| Pattern | Why it is not a finding |
|---|---|
| Raw SQL interpolating server-side constants (enum table names, a session-bound tenant GUC, migration DDL) | Not attacker-influenceable. The finding requires request-traceable data in the fragment. |
| `text()`/raw SQL with bound parameters (`:param` style) | That IS parameterization — raw SQL is not the violation, interpolation is. |
| ORM `filter`/`where` chains with user values | Bound by the ORM. Only the escape hatches (`extra`, `raw`, `queryRawUnsafe`) re-open the question. |
| Template `|safe` / `mark_safe` on content the server itself generated from literals (icon SVGs, static help HTML) | Trusted-origin content. Confirm no user-influenced fragment is concatenated in before refuting. |
| `dangerouslySetInnerHTML` fed exclusively from a sanitizer wrapper (DOMPurify-class, default config) at render time | The sanctioned rich-text pattern. Verify every call site goes through the wrapper — one bypass flips it back. |
| React/Vue/Angular interpolation (`{value}`, `{{value}}`) of user data | Auto-escaped element context. The probes are the opt-outs and URL/attribute contexts, not standard interpolation. |
| `subprocess` with argument arrays (`shell=False`) and validated file paths | The safe API. Command-string assembly is the finding, not process execution per se. |
| `String.escapeSingleQuotes` around a value landing inside quotes in dynamic SOQL | The documented Apex mitigation for that context. (The same call "protecting" a field/object name is NOT — context decides.) |
| Scanner-style findings on test fixtures, seeds, or scripts outside the deployed surface | Not reachable in production; note for hygiene at most. |

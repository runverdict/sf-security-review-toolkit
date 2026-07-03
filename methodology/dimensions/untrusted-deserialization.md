# Dimension: untrusted-deserialization

Reconstructing a language object from attacker-controlled bytes. A deserializer
that accepts a *serialized object* (not plain data) from an untrusted source
hands the attacker a primitive that runs far ahead of the application's own
logic: native-object formats (pickle, Ruby/Java `Marshal`/`ObjectInputStream`,
`node-serialize`) execute attacker code during reconstruction (RCE); JavaScript
prototype pollution injects properties into `Object.prototype` that downstream
code trusts (auth bypass, RCE via gadget); and Apex `JSON.deserialize` into an
sObject lets a tampered field (`OwnerId`, `RecordTypeId`, a `userType`, a parent
relationship) flow into DML the running user was never authorized to write.
Applies when the manifest shows server code, an external endpoint, an MCP server,
or Apex that deserializes input. Boundaries: query/template injection belongs to
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/injection-xss.md`; XML external
entities (XXE) are a Semgrep/scanner rule, noted here only as a lead; the
per-property *write authorization* angle (mass assignment / BOPLA) is
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/apex-exposed-surface.md` /
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/mcp-surface.md`. This dimension
owns the **reconstruction step** — that untrusted bytes become a live object at
all.

## 1. Threat concept

Insecure deserialization is OWASP A08:2021 (Software and Data Integrity
Failures) and CWE-502, and it is the rare web bug whose default outcome is
remote code execution rather than data exposure. The review's OWASP bar
(baseline: `endpoint-owasp-top10-bar`) and the package's "do not trust input"
posture both reach it, but no existing dimension probes the *deserializer*
itself — `injection-xss` is query/template-only. The class splits by language
and by sink (baseline: `untrusted-deserialization`):

1. **Native-object deserializers → RCE.** The format carries *code or
   constructor instructions*, not just values, so reconstruction executes:
   - **Python** — `pickle.loads`/`cPickle`, `yaml.load` without
     `SafeLoader`, `jsonpickle.decode`, `marshal.loads`, `shelve`, a
     `__reduce__` gadget. Any of these over a request body, a cache entry an
     attacker can poison, a message-queue payload, or a cookie is RCE.
   - **Node** — `node-serialize`/`serialize-to-js`/`funcster`/`cryo`
     `unserialize()` (the `_$$ND_FUNC$$_` immediately-invoked-function gadget),
     `eval`-backed "JSON" parsers, `vm` run on input.
   - **Ruby** — `Marshal.load`, `YAML.load`/`Psych.load` (vs `safe_load`),
     `Oj` in object mode.
   - **Java** — `ObjectInputStream.readObject`, `XMLDecoder`, Kryo/XStream in
     default mode, with a gadget chain on the classpath
     (commons-collections, etc.).
2. **Prototype pollution (JavaScript) → property injection.** Attacker JSON with
   `__proto__` / `constructor` / `prototype` keys deep-merged or path-set into an
   object pollutes `Object.prototype`, and any later `if (obj.isAdmin)` /
   `options.shell` / template lookup inherits the planted property — escalating
   to auth bypass, denial of service, or RCE via a sink. Sources: `lodash.merge`/
   `set`/`defaultsDeep` (the CVE family), hand-rolled recursive deep-merge/
   `extend`/`clone` utilities, and query-string/`qs` parsers. (Native
   `Object.assign` is NOT a source — it is shallow and copies only own
   enumerable properties; the danger is a RECURSIVE merge or a path-set that
   walks into a `__proto__`/`constructor` key.)
3. **Apex `JSON.deserialize` into sObjects → privilege escalation / FLS
   bypass.** `JSON.deserialize(body, Account.class)` (or
   `deserializeUntyped` then cast) reconstructs an sObject whose *every field*
   came from the caller — including fields the running user cannot write
   (`OwnerId`, `RecordTypeId`, a status/`IsApproved`/`Amount`, a parent
   relationship Id) — and a subsequent `insert`/`update`/`upsert` writes them
   unless `Security.stripInaccessible(AccessType.UPSERTABLE, ...)` (or an
   explicit field allowlist) is applied first. The `userType`/relationship-
   tamper variant flips records to another owner or record type. `Type.forName`
   + `JSON.deserialize` into an attacker-named type is the type-confusion
   escalation.
4. **Type / schema confusion at the boundary.** Deserializing untrusted input
   into a class with side-effecting constructors/getters, or trusting a
   polymorphic `@type`/`$type` discriminator the attacker controls, even in an
   otherwise "safe" parser.

## 2. What good looks like

- **Plain-data formats only, from untrusted sources.** `json.loads` /
  `JSON.parse` / `yaml.safe_load` / `Marshal`-never; the codebase contains no
  native-object deserializer reachable from a request, cache, queue, cookie, or
  file an attacker can influence. Where a native format is genuinely required
  (internal trusted IPC), the trust boundary is explicit and the source is
  authenticated + integrity-checked (a signed/HMAC'd payload), not "it's our own
  service."
- **Schema validation AFTER parse, allowlist of fields.** Input is parsed to a
  plain structure, then validated against an explicit schema (pydantic/zod/Joi/
  JSON-schema) that *names the permitted fields* — extra/unknown keys are
  rejected or dropped, never reflected into an object or a DML write.
- **Prototype-pollution-safe merges.** Deep-merge/clone utilities reject or skip
  `__proto__`/`constructor`/`prototype` keys (or use `Object.create(null)` /
  `Map`); dependencies with known prototype-pollution CVEs are patched (the SCA
  scan is the cross-check); no user JSON is deep-merged into a config/options
  object that later gates behavior.
- **Apex deserializes into DTOs, not sObjects — or strips before DML.** Untrusted
  JSON is deserialized into a **purpose-built Apex class** with only the fields
  the operation needs (not a live sObject), or, when an sObject is unavoidable,
  `Security.stripInaccessible(AccessType.UPSERTABLE/CREATABLE, records)` (or an
  explicit field allowlist) runs *before* the DML so caller-supplied
  inaccessible fields are dropped. `deserializeUntyped` over untrusted input is
  avoided; `Type.forName` driven by input is allowlisted.
- **No code-bearing formats as a trust shortcut.** No `eval`-backed parsing, no
  `vm`/`exec` on input, no `XMLDecoder`/`ObjectInputStream` on request data; the
  serialization format never carries executable instructions across a trust
  boundary.

## 3. Detection heuristics

Grep the deserializer call sites first, then trace each one's *input source* to
decide whether it crosses a trust boundary. The dangerous APIs are syntactically
loud; the judgment is reachability.

There is a deterministic substrate under this dimension: an external-SAST hit the
scanner already labelled with a deserialization-family CWE routes here automatically
via the shared `CWE_TO_DIMENSION` map in `harness/ingest-scanner-findings.mjs` —
native-object deserialization (CWE-502, from `pickle`/`node-serialize`), XXE (CWE-611),
and JavaScript prototype pollution (CWE-915, the id the OSS rule emits; CWE-1321 is
tracked as fixture-pending). The Apex `JSON.deserialize` → sObject mass-assignment /
BOPLA variant (the Apex threat in §1) has no OSS scanner rule, so it is not routed automatically and
stays a model-inferred residual — the finder/verifier blocks below are its only
coverage.

**All stacks** — grep seeds: `pickle`, `cPickle`, `yaml.load(` (without
`Loader=SafeLoader`/`safe_load`), `jsonpickle`, `marshal.loads`, `shelve`,
`__reduce__`, `node-serialize`, `serialize-to-js`, `funcster`, `cryo`,
`unserialize(`, `_$$ND_FUNC$$_`, `Marshal.load`, `YAML.load`/`Psych.load`,
`ObjectInputStream`, `readObject`, `XMLDecoder`, `XStream`, `Kryo`,
`JSON.deserialize(`, `JSON.deserializeUntyped(`, `Type.forName`,
`lodash.merge`/`_.merge`/`_.set`/`defaultsDeep`, `deepmerge`, `extend(true`,
`__proto__`, `constructor.prototype`, `eval(`, `new Function(`, `vm.runIn`.

| Stack | Where to look |
|---|---|
| Python (FastAPI/Django) | `pickle.loads`/`yaml.load` over request bodies, Redis/Memcache cache entries (a poisoned cache is an RCE vector), Celery task payloads (the broker serializer — `pickle` vs `json`), session cookies (`itsdangerous`/`pickle` sessions), and file uploads. Confirm `yaml.safe_load`/`SafeLoader` vs bare `yaml.load`. |
| Node (Express/Nest) | `require('node-serialize').unserialize(req…)` and the `_$$ND_FUNC$$_` gadget; `lodash.merge`/`set`/`defaultsDeep` and hand-rolled deep-merge over `req.body`/`req.query`; `qs`/body-parser feeding a merge; `JSON.parse` is safe but a *custom* reviver/`eval` is not; `vm`/`Function` on input. |
| Ruby (Rails) | `Marshal.load` over cookies/cache/params; `YAML.load`/`Psych.load` vs `safe_load`; `Oj.load` default mode; `Object#send`/`constantize` on input (type confusion). |
| Java (Spring) | `ObjectInputStream.readObject` on request streams; `XMLDecoder`; XStream/Kryo default-mode; Jackson polymorphic typing (`@JsonTypeInfo`/`enableDefaultTyping`) over untrusted JSON; a gadget library on the classpath. |
| Apex | `JSON.deserialize(<untrusted>, <sObject>.class)` and `JSON.deserializeUntyped` over `RestContext.request.requestBody`/an `@AuraEnabled` String param/a Named-Credential callout response — then trace to the `insert`/`update`/`upsert`/`Database.*` and check for `Security.stripInaccessible(AccessType.UPSERTABLE/CREATABLE, …)` (or a field allowlist) BEFORE it. `Type.forName(<input>)` and deserialization into a side-effecting class. The over-write fields to watch: `OwnerId`, `RecordTypeId`, status/approval/amount fields, parent relationship Ids. |

Also resolve: the **broker/cache/session serializer config** (Celery
`task_serializer`, Rails cookie store, a Redis-backed cache) — a "safe-looking"
app that deserializes its *own* queue/cache with `pickle`/`Marshal` is RCE the
moment an attacker can write one entry.

## 4. Finder prompt block

```
Primary targets (read these first, then follow imports/call-sites; use grep to
locate the real files when a path is approximate):
{{TARGETS}}

Stack notes (claims from the partner's own docs — verify against the ACTUAL
code, never assume; the central question is whether a deserializer reconstructs
an OBJECT from input that crosses a trust boundary):
{{STACK_NOTES}}

Threat focus — untrusted bytes becoming a live object. Find every deserializer
call site and trace its INPUT SOURCE. NATIVE-OBJECT FORMATS (the format carries
code/constructor instructions → RCE on reconstruction): Python
pickle.loads/cPickle/marshal/jsonpickle, yaml.load WITHOUT SafeLoader/safe_load;
Node node-serialize/serialize-to-js/funcster/cryo unserialize() (the
_$$ND_FUNC$$_ gadget), eval/vm/new Function on input; Ruby Marshal.load,
YAML.load/Psych.load (vs safe_load); Java ObjectInputStream.readObject,
XMLDecoder, XStream/Kryo default mode, Jackson default-typing — any over a
request body, a cache/queue/session an attacker can poison, a cookie, or an
upload is the finding. PROTOTYPE POLLUTION (JavaScript): attacker JSON with
__proto__/constructor/prototype keys deep-merged or path-set into an object
(lodash.merge/set/defaultsDeep, hand-rolled deep-merge/extend, qs parsers) that
pollutes Object.prototype and a later property read trusts — trace from the
merge to a security-relevant property use (isAdmin/options.shell/template
lookup). APEX JSON.deserialize INTO sOBJECTS: JSON.deserialize(body,
SObject.class) / deserializeUntyped over RestContext/@AuraEnabled/callout-
response input, then an insert/update/upsert — is there a
Security.stripInaccessible(AccessType.UPSERTABLE/CREATABLE, ...) or an explicit
field allowlist BEFORE the DML, or can the caller set fields they cannot write
(OwnerId, RecordTypeId, status/approval/amount, a parent relationship Id)? Also
Type.forName(<input>) and deserialization into a side-effecting class. For each
hit, the decisive facts are: (1) does the input cross a trust boundary
(request/cache/queue/cookie/file vs a hardcoded server constant), and (2) is the
format/sink dangerous (native-object → RCE; sObject-without-strip → priv-esc;
__proto__ merge → property injection). Query/template injection is the
injection-xss dimension; XXE is a scanner rule (flag as a one-line lead); the
per-property write-authz question beyond deserialization is apex-exposed-surface
/ mcp-surface.

Known findings — do NOT re-report any of these:
{{LEDGER}}

Report ONLY findings grounded in code you have READ, with exact file:line. A
native-object deserializer over attacker-reachable input is CRITICAL (RCE) —
state the input path and the gadget/format. An Apex sObject deserialize-then-DML
with no stripInaccessible is HIGH (priv-esc/FLS bypass) — name the over-writable
field. Prefer precision over volume — JSON.parse/json.loads/yaml.safe_load of
data into a validated schema is NOT a finding, and a native deserializer over a
hardcoded server-side constant is not attacker-reachable. If a control is correct
(safe parser + schema validation, stripInaccessible before DML, a
prototype-safe merge), do NOT report it. For each finding give a concrete
exploit_scenario: the attacker, the bytes they supply, the deserializer they
reach, and what executes or what record/field they tamper.
```

## 5. Verifier guidance

- **Trace the input to a trust boundary before confirming.** The finding
  requires the deserialized bytes to be attacker-influenceable — a request body,
  a cache/queue/session entry an attacker can write, a cookie, an upload, a
  callout response from an untrusted host. `pickle.loads` of a hardcoded
  server-side blob, or `Marshal` of the app's own constant, refutes (note it for
  hygiene). A "trusted internal service" claim is only valid if that channel is
  authenticated and integrity-checked — read how.
- **Confirm the format actually executes (native) vs merely parses (plain).**
  `yaml.safe_load`, `JSON.parse`, `json.loads` into a *validated* schema are not
  findings. `yaml.load` without a safe loader, `node-serialize.unserialize`,
  `ObjectInputStream` are. For prototype pollution, confirm the merge writes
  `__proto__`/`constructor` (a guarded merge that skips them, or `Map`/
  `Object.create(null)`, refutes) AND that a downstream read trusts the polluted
  property — a pollution with no consuming sink is lower severity.
- **For Apex: read for `stripInaccessible` / an allowlist BEFORE the DML.**
  `Security.stripInaccessible(AccessType.UPSERTABLE, …)` (or a field-by-field
  allowlist copy into a fresh sObject) before `insert`/`update`/`upsert` refutes;
  its absence on a caller-supplied sObject with writable privileged fields
  confirms. Deserializing into a **purpose-built DTO class** (not an sObject)
  also refutes — the fields are constrained by the class. Note whether the
  operation runs in user mode (`as user`/`USER_MODE`), which strips inaccessible
  fields on DML at API ≥ a supporting version — but confirm the version and that
  the field is FLS-protected, don't assume.
- **Gadget availability changes RCE severity, not existence.** A native
  deserializer over untrusted input is the finding regardless; the presence of a
  known gadget chain on the classpath/deps raises confidence/severity — say which
  in `adjusted_severity`.
- **Reachability and source set severity.** A deserializer behind authentication
  or on an admin-only path is lower than one on a public endpoint; a cache/queue
  vector requires the attacker to first land a write — note the precondition.

## 6. Known false-positive patterns

| Pattern | Why it is not a finding (or not at the reported severity) |
|---|---|
| `json.loads` / `JSON.parse` / `yaml.safe_load` of untrusted input into a validated schema | Plain-data parse — no object reconstruction. The finding is a native-object/code-bearing deserializer, not parsing data. |
| `pickle`/`Marshal`/`ObjectInputStream` over a hardcoded server-side constant or the app's own trusted, integrity-checked artifact | Not attacker-reachable. Confirm no request/cache/queue/cookie path feeds it before flagging (note for hygiene). |
| A deep-merge utility that explicitly skips `__proto__`/`constructor`/`prototype`, or uses `Map`/`Object.create(null)` | Prototype-pollution-safe by construction. The finding is an unguarded merge of user JSON. |
| Prototype pollution with no downstream property read that trusts the planted key | Real but lower severity — pollution needs a consuming sink (auth flag, options, template) to escalate. State the missing sink. |
| Apex `JSON.deserialize` into a **purpose-built DTO class** (not an sObject), or followed by `Security.stripInaccessible`/a field allowlist before DML | The sanctioned pattern — caller-supplied fields are constrained or stripped before they reach DML. |
| `JSON.deserializeUntyped` whose result is read field-by-field with explicit type checks and never written to DML | Reading parsed values defensively is fine; the finding is reconstructing a writable sObject or executing on the structure. |
| Jackson/`JSON.parse` with default/polymorphic typing **disabled** over untrusted input | Default typing off removes the gadget vector. The finding is `enableDefaultTyping`/`@JsonTypeInfo` on attacker-controlled `@type`. |
| A native deserializer in a test fixture, migration, or developer script outside the deployed surface | Not reachable in production; hygiene note at most. |

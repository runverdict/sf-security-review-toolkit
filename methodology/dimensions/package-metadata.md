# Dimension: package-metadata

The package's **metadata and markup** — the `*-meta.xml`, component bundles,
trusted-host XML, and button/link definitions a reviewer reads with their own
eyes, distinct from the code-AST surface the SAST engines parse. Applies when
the scope manifest shows a managed-package element (a `force-app/` tree under
an `sfdx-project.json`). This dimension exists because the code-AST tools and
the other dimensions read the *wrong files* for an entire cluster of
verified-primary, Top-20-named violations: PMD and ESLint parse `.cls`,
`.trigger`, and `.js`, the Graph Engine path-traces Apex — **none of them read
`*.weblink-meta.xml`, component `.css`, an Aura `apiVersion`, or
`*.messageChannel-meta.xml`**. Those checks are pure metadata reads a reviewer
always does, and they fall in the seam between code-AST and the dimensions
shaped for running services. This file owns that seam.

Boundaries. The *escaping* of values rendered by markup is
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/injection-xss.md` (the
`aura:unescapedHtml`/DOM-sink half); the *browser-side* token custody, CSP
header posture, and `frame-ancestors` of a delivered/Canvas UI are
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/web-client.md`; raw secret
*values* baked into metadata fields, `customMetadata`, or constants are
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/secrets-credentials.md`; the
*live* TLS/redirect/SSRF behavior of any host this metadata names is the DAST
pass plus `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/mcp-threat-model.md`'s
egress-allowlist reasoning. This dimension owns the **static metadata
declaration itself** — the XML element, attribute, or value that is a finding
on sight, before any code runs. When a finding spans both (an
`onClickJavaScript` web link whose script *also* builds a SOQL string), file it
under the root cause and name the second in the report row: the metadata
declaration is this dimension's; the injection sink is `injection-xss`'s.
Salesforce Apex CRUD/FLS and sharing-declaration enforcement are **not** this
dimension's — those are Code Analyzer's Graph Engine pass
(`/sf-security-review-toolkit:run-scans`); this dimension never claims them.

## 1. Threat concept

A managed package ships *metadata* into every subscriber org, and the reviewer
inspects that metadata directly in the submitted Developer Edition org — not
only the Apex. Several of the most frequently-cited failure classes are
metadata facts a single XML read settles, and they recur precisely because the
SAST tooling the partner ran does not look at the files they live in. Each is a
named, codified violation in the Summer '26 secure-coding catalog, several are
on the official 2023 Top-20 (the failure-cause canon still designated official
prep reading, per baseline `fail-taxonomy-currency`), and most are enforced at
**periodic re-reviews** as well as new reviews — so a package that passed years
ago can fail a re-review on a metadata bar that has not changed.

The classes, in the order a verifier should fear them:

1. **LockerService / Lightning Web Security disabled — Aura/LWC `apiVersion`
   below 40.0** (baseline: `violation-lockerservice-disabled`, also
   `fail-lightning-component-hygiene`). Locker is the component security
   architecture; it is **disabled at API version ≤ 39.0 and enforced at ≥
   40.0** (Locker activated Summer '17). The verbatim load-bearing rule: "New
   AppExchange security reviews and periodic re-reviews require components to be
   version 40.0 or higher so that Locker is enabled." Detection is a literal
   number read out of the `<apiVersion>` element in an `AuraDefinitionBundle`
   (`*.cmp-meta.xml`) or an LWC `*.js-meta.xml` — any value `< 40.0` is the
   finding, and it is one of the few violations the guide explicitly says
   re-reviews enforce retroactively, which is also official proof that periodic
   re-reviews apply current bars to already-listed packages.

2. **Exposed Lightning Message Channel — `<isExposed>true</isExposed>`**
   (baseline: `fail-lightning-component-hygiene`; Top-20 #15). A
   `*.messageChannel-meta.xml` with `isExposed` set to `true` lets code outside
   the package's namespace publish to and subscribe on the channel — a
   cross-component data leak the reviewer scans the LMC XML for directly. The
   flag **cannot be toggled on an existing channel** (the platform forbids
   flipping it on a released channel), so the accepted resolutions are Managed
   Component Deletion or documenting genuine non-usage in the false-positive
   dossier — an officially accepted path for #15 specifically. The finding is
   the `true` value where no cross-namespace use case justifies it.

3. **JavaScript running in the Salesforce origin — `onClickJavaScript` web
   links / custom buttons, `REQUIRESCRIPT`** (baseline:
   `violation-js-in-salesforce-domain`; Top-20 #12). Vendor JS is meant to be
   sandboxed in a Visualforce origin or a Lightning locker; a web link or custom
   button that runs script in the Salesforce origin breaks out of that sandbox
   and "injects its code into a Salesforce origin." The codified detection
   pattern is a `*.weblink-meta.xml` (or a custom button in object/list-view
   metadata) whose `<openType>` is `onClickJavaScript`, especially one using the
   `REQUIRESCRIPT()` function to pull in a script, or a `javascript:` URL in the
   link target. The accepted remediation is to rebuild the behavior in
   Visualforce, Aura, or LWC, which run in the correct origin — so the metadata
   declaration *is* the violation; there is no in-code fix.

4. **CSS that escapes component isolation — `position: absolute` / `fixed` in a
   component `.css`** (baseline: `violation-css-outside-components`; Top-20 #14,
   where absolute positioning is named "the top reason" the category fails). The
   platform treats each namespace as an isolated sandbox; CSS that breaches
   isolation lets one component overlay and steal clicks from another
   (UI-redress/clickjacking inside the org). The flagged pattern is
   `position: absolute` or `position: fixed` in an Aura/LWC component stylesheet;
   the accepted remediation is relative positioning and component-scoped CSS
   (the `.THIS` selector in Aura). No code-AST tool greps component CSS — this is
   a pure stylesheet read, and it is the single highest-leverage check in this
   dimension because it is the most-cited reason this category fails.

5. **Third-party JS/CSS hotlinking — `<script src="http…">` / `<link
   href="http…">` to a CDN instead of `$Resource`** (baseline:
   `violation-third-party-js-css-hosting`, empirically `fail-js-not-static-resources`;
   Top-20 #9/#11). Two codified pages (third-party JS endpoints; third-party CSS
   in Lightning components). Dynamically loaded external code "can change without
   the package version ID changing" — no admin or security-team notification —
   and the external endpoint gains code-injection into every subscriber org. The
   trigger is any markup or component reference that loads script/style from an
   off-platform URL (a raw `<link>` to an external stylesheet is itself the
   trigger) instead of from a packaged static resource via `$Resource` /
   `apex:includeScript` / `ltng:require` / `lightning/platformResourceLoader`'s
   `loadScript`. Vendored static-resource *contents* with their own CVEs are
   RetireJS's pass (`/sf-security-review-toolkit:run-scans`); this dimension owns
   the **hotlink declaration**, not the library version.

6. **Open redirect — `PageReference` built from a request parameter +
   `setRedirect(true)` with no allowlist** (baseline: `violation-open-redirects`).
   A controller that constructs a `PageReference` from a `redirect`-style query
   parameter and calls `setRedirect(true)` sends the user wherever the parameter
   says — a phishing primitive. The guide demonstrates a hardcoded redirect
   target as the accepted remediation and acknowledges allowlisting validated
   destinations as the general strategy. This is a metadata-adjacent Apex
   pattern (the `PageReference` sink, distinct from the DOM `href`/`src` sink
   `injection-xss` owns); it lives here because the reviewer reaches it through
   the page/controller wiring, and the fix is a declaration of allowed targets.

7. **CSRF on page/component instantiation — DML in a VF `action=`/constructor/
   init, `confirmationTokenRequired` absent** (baseline:
   `violation-csrf-page-instantiation`). The platform's default CSRF protection
   covers form requests and user-action-triggered DML — but "state change or DML
   operations triggered on page instantiation execute before the rest of the
   page loads, and they bypass the platform's default CSRF protection."
   Vulnerable contexts: a Visualforce page `action` attribute, a controller
   constructor that performs DML, and LWC/Aura `init`/`connectedCallback`
   handlers that mutate state. Accepted remediations: for Visualforce, set
   `confirmationTokenRequired="true"` on the page (its default is `false`, and
   with it set, GET requests must carry a CSRF token); for Lightning, never
   perform state change/DML during instantiation — trigger it from an explicit
   user action. The metadata read is the page's `confirmationTokenRequired`
   attribute and the `action=` binding; the DML reachability is the confirming
   evidence.

8. **Sample / copied code shipped in the production package** (baseline:
   `violation-sample-code-in-production`). "When building your production code,
   always write the code yourself. Avoid copying code from sources that you
   don't directly control." Direct reuse propagates one sample's vulnerability
   across many packages. Detection is heuristic (boilerplate headers, verbatim
   blocks matching known sample corpora, copy-paste markers) — the metadata/
   markup pass surfaces candidates; provenance is owner-confirmed.

This dimension also **inventories two host-bearing metadata classes** that seed
downstream work rather than being findings in isolation:

- **RemoteSiteSettings / CspTrustedSites inventory** — every
  `*.remoteSite-meta.xml` and `*.cspTrustedSite-meta.xml` entry, read for its
  *contents*: any `http://` (plaintext) URL, any `*` wildcard host, any entry
  with no corresponding Named/External Credential governing the callout, and any
  host that is parked, lapsed, or no longer partner-owned. This inventory seeds
  the DAST scope (every trusted host is in-scope for the live scan) and feeds the
  ForcedLeak staleness reasoning — a stale allowlisted egress domain is
  re-registrable by an attacker (the staleness/over-breadth judgment itself
  belongs to `mcp-threat-model`'s egress-allowlist analysis; this dimension owns
  the *enumeration* and the `http://`/wildcard flags, which stand on their own).
  Cross-references `endpoint-https-only` (a hardcoded `http://` in a Remote Site
  Setting is itself a finding) and `violation-insecure-storage-sensitive-data`.
  As of 0.8.66 the `http://` flag routes here deterministically: the
  `egress-plain-http` source-scanner ingests every plain-HTTP endpoint declared
  in Remote Site Settings, CSP Trusted Sites, and Named Credentials (legacy and
  modern shapes) as an owned-class `plain-http-egress` finding grounded in
  `endpoint-https-only` — the wildcard-host and staleness judgments above stay
  this dimension's finder/verifier residual.

- **Packaged-UI URL sensitive-info** — record Ids or sensitive parameters
  placed into Visualforce page URLs or `NavigationMixin.Navigate` `state`
  (Top-20 #16, the packaged-UI-navigation half of secrets-in-URLs). A record Id
  or token in a URL leaks into browser history, referrer headers, and server
  logs. The raw-secret-in-URL half is `secrets-credentials`'; this dimension
  owns the **VF/LWC navigation construction** that places the value there.

## 2. What good looks like

- **Every Aura/LWC bundle is API version 40.0 or higher.** No
  `AuraDefinitionBundle` `*.cmp-meta.xml` and no LWC `*.js-meta.xml` carries an
  `<apiVersion>` below `40.0`; the package's `sourceApiVersion` and any
  per-bundle override both clear the Locker threshold. A version bump is the
  whole fix — there is no FP justification for a sub-40 component.
- **No Message Channel is exposed without a documented cross-namespace need.**
  `*.messageChannel-meta.xml` carries `<isExposed>false</isExposed>` unless an
  external subscriber is a deliberate, documented feature; where a legacy
  channel is genuinely unused, non-usage is argued in the FP dossier (the
  accepted path for #15), not left as a bare `true`.
- **No JavaScript runs in the Salesforce origin.** No `*.weblink-meta.xml` or
  custom button uses `<openType>onClickJavaScript</openType>`, `REQUIRESCRIPT`,
  or a `javascript:` URL target; the same behavior is delivered through
  Visualforce/Aura/LWC, which run in the proper sandboxed origin.
- **Component CSS stays inside its sandbox.** No component `.css` uses
  `position: absolute` or `position: fixed`; positioning is relative and
  component-scoped (Aura `.THIS`), so one component cannot overlay another.
- **All scripts and styles load from packaged static resources.** No `<script
  src>` / `<link href>` / dynamic loader points at an off-platform URL; every
  third-party library is vendored into a static resource and loaded via
  `$Resource` / `apex:includeScript` / `ltng:require` / `loadScript`, so the
  shipped code cannot change out from under the reviewed package version.
- **Redirects resolve to a server-side allowlist or hardcoded target.** No
  `PageReference` is built from an unvalidated request parameter and redirected;
  redirect destinations are fixed or validated against an allowlist before
  `setRedirect(true)`.
- **No DML on instantiation without CSRF protection.** Visualforce pages that
  must act on load set `confirmationTokenRequired="true"`; Lightning components
  perform no state change or DML in `init`/`connectedCallback`/constructor —
  every mutation is bound to an explicit user action.
- **The trusted-host inventory is HTTPS-only, narrow, and current.** Every
  `*.remoteSite-meta.xml` / `*.cspTrustedSite-meta.xml` entry is `https://`,
  names a specific host (no `*` wildcard), is governed by a Named/External
  Credential where it carries auth, and points at a domain the partner currently
  owns. The list is maintained — a lapsed entry is removed, not left to rot.
- **No record Ids or secrets travel in UI URLs.** Visualforce navigation and
  `NavigationMixin` state pass record references by a mechanism that does not
  expose sensitive identifiers in the address bar, history, or referrer.
- **The metadata matches the artifacts.** The architecture/usage documentation
  and the FP dossier describe the same component versions, trusted hosts, and
  exposed channels the metadata actually declares; a doc that contradicts the
  XML is worse than no doc.

## 3. Detection heuristics

This is a **metadata/XML and markup-scanning** dimension — resolve the concrete
files first, then read the named element/attribute/value out of each. All paths
are under the package's `force-app/` tree (or the equivalent `sfdx-project.json`
`packageDirectories` root). Be literal: a glob, an element, and the value that
triggers.

**Locker / API-version (class 1).** Glob `force-app/**/aura/**/*.cmp-meta.xml`
and `force-app/**/lwc/**/*.js-meta.xml`; read the `<apiVersion>` element —
**flag any numeric value `< 40.0`**. Also read `sourceApiVersion` in
`sfdx-project.json` (the default applied to bundles without an explicit
override) and any `<apiVersion>` in `*.cmp-meta.xml`'s sibling
`*.design-meta.xml` / `*.svg-meta.xml` set. Grep seed: `grep -rE
'<apiVersion>(3[0-9]|[12][0-9]|[0-9])\.' force-app/**/aura force-app/**/lwc`
(matches sub-40 majors) — then read each hit to confirm.

**Exposed LMC (class 2).** Glob
`force-app/**/messageChannels/*.messageChannel-meta.xml`; read `<isExposed>` —
**flag `true`**. Grep seed: `grep -rl '<isExposed>true</isExposed>'
force-app/**/messageChannels`.

**JS-in-origin (class 3).** Glob `force-app/**/*.weblink-meta.xml` and custom
buttons/links inside `force-app/**/objects/**/webLinks/*.weblink-meta.xml` and
list-view button metadata; read `<openType>` and `<url>`/`<content>` —
**flag `onClickJavaScript`**, any `REQUIRESCRIPT(`, and any `javascript:`
scheme in the link body. Grep seeds: `grep -rEl
'onClickJavaScript|REQUIRESCRIPT\(|javascript:' force-app/**/*.weblink-meta.xml`
and the same over `objects/`.

**CSS isolation (class 4).** Glob `force-app/**/aura/**/*.css` and
`force-app/**/lwc/**/*.css`; read declarations — **flag `position: absolute`
and `position: fixed`**. Grep seed: `grep -rnE
'position\s*:\s*(absolute|fixed)' force-app/**/aura force-app/**/lwc`
(component stylesheets only — ignore static-resource CSS, which is the hotlink
class, not isolation).

**Hotlinking (class 5).** Read Visualforce pages
(`force-app/**/pages/*.page`), Aura markup (`force-app/**/aura/**/*.cmp`,
`*.app`), and LWC templates (`force-app/**/lwc/**/*.html`); **flag any
`<script src="http…">` / `<link href="http…">` / `@import url(http…)` /
`apex:includeScript value="http…"` / `loadScript(... 'http…')` pointing
off-platform** — i.e. a URL that is not `$Resource`, a relative path, or a
packaged-resource reference. Grep seeds: `grep -rnE
'(src|href)\s*=\s*["'\'']https?://' force-app/**/pages force-app/**/aura
force-app/**/lwc/**/*.html` and `grep -rn 'loadScript\|includeScript\|ltng:require'`
— then confirm each loads `$Resource`, not an external host.

**Open redirect (class 6).** Glob `force-app/**/classes/*.cls`; **find
`PageReference` constructed from a `getParameters().get(...)` /
`ApexPages.currentPage().getParameters()` value, followed by `setRedirect(true)`
on that reference**, with no allowlist/hardcoded-target check between. Grep
seed: `grep -rnE 'PageReference|setRedirect\(true\)|getParameters\(\)\.get'
force-app/**/classes` — read the data flow from parameter to the redirected
reference.

**Instantiation CSRF (class 7).** Glob `force-app/**/pages/*.page` and
`*.page-meta.xml`; **read the `action=` attribute and the
`confirmationTokenRequired` attribute** — flag a page whose `action=` (or whose
controller constructor) performs DML while `confirmationTokenRequired` is
absent or `false`. For Lightning: `force-app/**/lwc/**/*.js`
`connectedCallback`/`constructor` and Aura `init` handlers that call an
`@AuraEnabled` DML method on load. Grep seeds: `grep -rn 'action=' force-app/**/pages`,
`grep -rn 'confirmationTokenRequired' force-app/**/pages`, `grep -rnE
'connectedCallback|init.*handler|new .*Controller\(' force-app/**/lwc force-app/**/aura`
— then confirm a DML/state-change reachable from the load path.

**Sample code (class 8).** Heuristic — scan `force-app/**/classes/*.cls` and
component bundles for verbatim sample headers, license/attribution comments
referencing tutorials/blogs/Stack Overflow, and copy-paste markers; surface
candidates for owner provenance review, never auto-confirm.

**Trusted-host inventory (host class).** Glob
`force-app/**/remoteSiteSettings/*.remoteSite-meta.xml` and
`force-app/**/cspTrustedSites/*.cspTrustedSite-meta.xml`; for **each entry**
read `<url>` / `<endpointUrl>` and record: scheme (**flag `http://`**), host
(**flag any `*` wildcard**), whether `<isActive>` is `true`, and whether a
Named/External Credential governs callouts to that host. Emit the full list as
the DAST-scope + staleness seed. Grep seeds: `grep -rnE
'<url>|<endpointUrl>|http://|\*' force-app/**/remoteSiteSettings
force-app/**/cspTrustedSites`.

**Packaged-UI URL sensitive-info (host class).** Read VF pages and LWC/Aura JS
for URL construction and `NavigationMixin.Navigate` `state`/`attributes` and
`PageReference` building that places a record `Id`, token, or sensitive
parameter into a URL. Grep seeds: `grep -rnE
'NavigationMixin|PageReference|\?id=|recordId.*=.*Id|state\s*:' force-app/**/lwc
force-app/**/aura force-app/**/pages` — confirm the value placed in the URL is a
record Id or sensitive parameter.

| Surface | Where to look |
|---|---|
| Aura bundles | `aura/**/*.cmp-meta.xml` `<apiVersion>`; `aura/**/*.css` positioning; `aura/**/*.cmp`/`*.app` script/link/`ltng:require`; Aura `init` handlers |
| LWC bundles | `lwc/**/*.js-meta.xml` `<apiVersion>`; `lwc/**/*.css` positioning; `lwc/**/*.html` `<script>`/`<link>`; `lwc/**/*.js` `connectedCallback`, `loadScript`, `NavigationMixin` |
| Message channels | `messageChannels/*.messageChannel-meta.xml` `<isExposed>` |
| Web links / buttons | `*.weblink-meta.xml` and `objects/**/webLinks/*` `<openType>`/`<url>` — `onClickJavaScript`, `REQUIRESCRIPT`, `javascript:` |
| Visualforce | `pages/*.page` + `*.page-meta.xml` — `action=`, `confirmationTokenRequired`, `<apex:includeScript>`, inline `<script src>` |
| Apex controllers | `classes/*.cls` — `PageReference` + `setRedirect(true)` from a request param; DML in constructors |
| Trusted hosts | `remoteSiteSettings/*.remoteSite-meta.xml`, `cspTrustedSites/*.cspTrustedSite-meta.xml` — scheme, wildcard, `isActive`, NC governance |
| Project root | `sfdx-project.json` `sourceApiVersion`, `packageDirectories` |

Also resolve: the package's `sourceApiVersion` (the default `apiVersion` a
bundle inherits when it declares none), and whether the architecture/usage doc's
claimed component versions and trusted-host list match what the metadata
actually declares (verify the claim against the XML, never assume).

## 4. Finder prompt block

```
Primary targets (read these first, then follow the bundle/object metadata; use
grep with the seeds below to locate the real files when a path is approximate):
{{TARGETS}}

Stack notes (claims from the partner's own docs — verify against the ACTUAL
metadata, never assume):
{{STACK_NOTES}}

Threat focus — the package METADATA and MARKUP violations a reviewer reads with
their own eyes, distinct from the Apex/JS code-AST the SAST engines parse (these
are verified-primary, codified secure-coding violations, several on the official
Top-20; most are enforced at periodic re-reviews too). Probe each as a literal
XML/CSS/markup read: LockerService disabled (glob
`force-app/**/aura/**/*.cmp-meta.xml` and `force-app/**/lwc/**/*.js-meta.xml`,
read `<apiVersion>` — flag EVERY value < 40.0; check `sourceApiVersion` in
`sfdx-project.json` for the inherited default; a sub-40 bundle disables the
component security architecture and is enforced at new AND periodic reviews);
exposed Lightning Message Channel (glob
`force-app/**/messageChannels/*.messageChannel-meta.xml`, read `<isExposed>` —
flag `true`, since out-of-namespace code can then publish/subscribe; Top-20
#15); JavaScript in the Salesforce origin (glob `force-app/**/*.weblink-meta.xml`
and `objects/**/webLinks/*`, read `<openType>` — flag `onClickJavaScript`, any
`REQUIRESCRIPT(`, any `javascript:` link target; the vendor is injecting code
into a Salesforce origin; Top-20 #12); CSS escaping component isolation (glob
`force-app/**/aura/**/*.css` and `force-app/**/lwc/**/*.css`, read declarations
— flag `position: absolute` and `position: fixed`, which let one component
overlay/steal clicks from another; Top-20 #14, "the top reason"); third-party
JS/CSS hotlinking (read `pages/*.page`, `aura/**/*.cmp`/`*.app`, `lwc/**/*.html`
— flag any `<script src="http…">`, `<link href="http…">`, `@import url(http…)`,
`apex:includeScript value="http…"`, or `loadScript`/`ltng:require` pointing
off-platform instead of at `$Resource`; externally hosted code can change
without the package version changing and grants the endpoint code-injection into
every subscriber org; Top-20 #9/#11); open redirect (glob `classes/*.cls` —
flag a `PageReference` built from `getParameters().get(...)` /
`ApexPages.currentPage().getParameters()` then `setRedirect(true)` with no
allowlist/hardcoded-target check between; phishing primitive); CSRF on page
instantiation (glob `pages/*.page` + `*.page-meta.xml` — flag a page whose
`action=` or controller constructor performs DML while
`confirmationTokenRequired` is absent/false, since instantiation DML runs before
the page loads and bypasses default CSRF protection; for LWC/Aura, flag DML in
`connectedCallback`/`constructor`/`init` on load); sample/copied code (heuristic
— surface verbatim sample headers, tutorial/Stack-Overflow attribution comments,
copy-paste markers as candidates for owner provenance review, never auto-confirm).
Then the host-bearing metadata inventory (seeds DAST scope + ForcedLeak
staleness): trusted-host inventory (glob
`force-app/**/remoteSiteSettings/*.remoteSite-meta.xml` and
`force-app/**/cspTrustedSites/*.cspTrustedSite-meta.xml`, read EVERY entry's
`<url>`/`<endpointUrl>` — flag any `http://` plaintext entry and any `*` wildcard
host as standalone findings, and emit the full host list (with `isActive` and
whether a Named/External Credential governs each) as the trusted-host inventory
the DAST scope and the egress-staleness analysis consume — an `http://` Remote
Site Setting is itself a Secure-Communication violation); packaged-UI URL
sensitive-info (read VF pages and LWC/Aura `NavigationMixin.Navigate`
state/attributes and `PageReference` building — flag a record `Id`, token, or
sensitive parameter placed into a URL that then leaks via history/referrer/logs;
Top-20 #16).

Read the ACTUAL metadata/markup, never the partner's description of it. Apex
CRUD/FLS and sharing-declaration enforcement are OUT of scope here — those are
the Graph Engine's Code Analyzer pass; report a metadata declaration, not a
dataflow finding. Library *versions* inside a vendored static resource are
RetireJS's pass — report the hotlink declaration, not the library CVE.

Known findings — do NOT re-report any of these:
{{LEDGER}}

Report ONLY findings grounded in metadata you have READ, with the exact
file:line of the offending element/attribute/value. Prefer precision over
volume — a false alarm wastes the verifier's time and the partner's. If a
control is correct (a bundle at API 45.0, an `isExposed=false` channel, a
`$Resource`-loaded script), do NOT report it (one info-level note for a notably
clean metadata surface is allowed). For each finding give a concrete
exploit_scenario: the attacker (a subscriber-org user, a phishing target, an
out-of-namespace component author, an attacker who re-registers a lapsed
trusted host), the metadata that enables it, and the impact.
```

## 5. Verifier guidance

- **For API-version claims, read the number, and read the inheritance.** A
  bundle with no `<apiVersion>` inherits `sourceApiVersion` from
  `sfdx-project.json` — if that default is ≥ 40.0 the bundle is fine; if the
  bundle declares its own `<apiVersion>` below 40.0 it confirms regardless of
  the project default. `40.0` exactly is compliant (Locker enabled); `39.0` and
  below confirm. There is no FP justification for a sub-40 component — the fix is
  a version bump, so do not soften this to `partially_real` on a "could document
  it" rationale.
- **For LMC-exposed claims, the value is the finding, but reachability sets
  severity.** `<isExposed>true</isExposed>` confirms the mechanism; whether an
  out-of-namespace subscriber actually exists to abuse it is the severity input.
  A channel exposed by design with a documented cross-namespace consumer is an
  FP-dossier item, not a high; an exposed channel with no documented external use
  is the finding. Confirm against the channel's actual publishers/subscribers,
  not its mere existence.
- **For JS-in-origin claims, distinguish the origin.** `onClickJavaScript` /
  `REQUIRESCRIPT` / a `javascript:` target in a `*.weblink-meta.xml` or custom
  button confirms — that script runs in the Salesforce origin. A web link with
  `openType` `url` (a plain navigation) or `massAction` is **not** this
  violation; read the `<openType>` value, do not assume from the file name.
- **For CSS-isolation claims, read which stylesheet.** `position: absolute` /
  `fixed` in an Aura/LWC **component** `.css` confirms. The same property in a
  **static-resource** CSS (a vendored library's stylesheet) is the hotlink/
  vendoring class, not the isolation class — and `position: relative` /
  `sticky` is fine. A `.THIS`-scoped Aura rule that happens to use absolute
  positioning still confirms (the platform flags the property, not the scope).
- **For hotlink claims, prove the URL is off-platform.** A `<script src>` /
  `<link href>` / `loadScript` whose target is `$Resource`, a relative path, or
  a `c__`/namespaced static-resource reference refutes — that is the correct
  vendored pattern. An absolute `https://` (or `http://`) to a CDN or vendor host
  confirms. Read the actual `value=`/`src=`/`href=` string; a variable resolved
  from a static resource at runtime refutes, a literal external URL confirms.
- **For open-redirect claims, trace the redirect target to its source.** A
  `PageReference` whose path/URL is a literal, a fixed page reference, or a value
  validated against an allowlist before `setRedirect(true)` refutes. A
  `PageReference` built from `getParameters().get('retURL')`-style request input
  with `setRedirect(true)` and no validation confirms. The platform's own
  `retURL` handling on standard pages is **not** the violation — the finding is
  the package's own controller redirecting to an unvalidated parameter.
- **For instantiation-CSRF claims, prove DML runs on load.** A VF page with
  `action=` or a constructor that performs DML while `confirmationTokenRequired`
  is absent/`false` confirms; the same page with `confirmationTokenRequired="true"`
  refutes. An LWC `connectedCallback` that only reads data (no DML, no state
  mutation) is not this violation — confirm a write reachable from the load path.
  A page that performs DML only from an explicit user action (a button handler,
  not `action=`) refutes.
- **For trusted-host inventory, separate the standalone findings from the
  owner-confirmable ones.** An `http://` entry and a `*` wildcard host are
  standalone, code-confirmable findings (a plaintext Remote Site Setting is also
  a Secure-Communication violation). **Domain expiry/ownership is NOT
  code-confirmable** — do not assert a trusted host is lapsed from the metadata
  alone; mark a suspected-stale entry `partially_real` and route "verify each
  trusted host is still partner-owned" to the owner. The inventory itself (every
  host enumerated for the DAST scope) is the deliverable, not a finding.
- **For packaged-UI URL claims, prove the value is sensitive.** A record `Id`,
  session token, or sensitive parameter placed into a VF URL / `NavigationMixin`
  state confirms (it leaks via history/referrer/logs). A `NavigationMixin`
  navigation that passes a record Id through the platform's standard
  `recordId`/`pageReference` mechanism (not a raw query string the partner
  builds) refutes — that is the sanctioned navigation API, not a hand-built
  leaking URL.
- **Reachability first, always.** A violating component behind a feature flag,
  an unpackaged dev artifact excluded from `packageDirectories`, or dead metadata
  not in the released package is `low`/`info` with a note — confirm the offending
  file is actually inside the submitted package surface, not a sample or a test
  fixture outside it.

## 6. Known false-positive patterns

| Pattern | Why it is not a finding |
|---|---|
| A bundle with no `<apiVersion>` element where `sourceApiVersion` in `sfdx-project.json` is ≥ 40.0 | The bundle inherits the project default; the effective version is ≥ 40.0 and Locker is enabled. Read the inherited value before confirming a missing element. |
| An `apiVersion` of exactly `40.0` | 40.0 is the threshold AT which Locker is enabled — compliant. The violation is strictly `< 40.0`. |
| `<isExposed>true</isExposed>` on a channel with a documented, intended cross-namespace consumer | Exposure can be a designed feature; the finding is an UNINTENTIONALLY exposed channel. Confirm against the documented use case — but a bare `true` with no documented external consumer still confirms. |
| A `*.weblink-meta.xml` with `<openType>url</openType>` or `massAction` | A plain navigation link, not JS-in-origin. The violation requires `onClickJavaScript`/`REQUIRESCRIPT`/`javascript:` specifically. |
| `position: relative`, `sticky`, or `static` in a component `.css` | Only `absolute` and `fixed` breach isolation. Relative/scoped positioning is the accepted remediation, not the violation. |
| `position: absolute`/`fixed` in a STATIC-RESOURCE stylesheet (a vendored library's own CSS) | That is the hotlink/vendoring surface, not the component-isolation surface; the isolation rule applies to component bundle CSS. (The vendored library may still be a third-party-hosting or RetireJS finding on its own grounds.) |
| A `<script src>` / `loadScript` / `apex:includeScript` resolving to `$Resource`, a relative path, or a namespaced static resource | The correct vendored-static-resource pattern — exactly the accepted remediation, not the hotlink violation. |
| A `PageReference` redirecting to a hardcoded target or a destination validated against an allowlist before `setRedirect(true)` | The accepted remediation for open redirects; no user-controlled redirect target, no finding. |
| A VF page with `confirmationTokenRequired="true"`, or DML triggered only from an explicit user action (not `action=`/constructor) | The accepted CSRF remediation; instantiation-CSRF requires DML that runs on page load without the token. |
| A `NavigationMixin.Navigate` passing `recordId` through the platform's standard `standard__recordPage` pageReference | The sanctioned navigation API, not a hand-built query-string URL leaking the Id. |
| An `http://` URL in a code COMMENT, a test fixture, or a `*-meta.xml` outside `packageDirectories` | Not a shipped Remote Site Setting / trusted site; confirm the entry is an active, packaged `remoteSite`/`cspTrustedSite` before flagging. |
| A trusted-host entry the verifier merely SUSPECTS is expired, with no metadata evidence | Domain ownership/expiry is owner-confirmable, not code-confirmable — route it to the owner as a verification step. (An `http://` or `*` wildcard entry stands on its own regardless.) |
| Apex CRUD/FLS or sharing-declaration findings surfaced while reading controller metadata | Out of this dimension's scope — the Graph Engine's Code Analyzer pass owns CRUD/FLS and sharing; report the metadata declaration here, route the dataflow finding there. |

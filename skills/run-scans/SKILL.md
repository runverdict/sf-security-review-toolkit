---
name: run-scans
description: Phase 3 of security review prep. Orchestrates every scan family the review consumes — Code Analyzer (package SAST), the Partner Security Portal scanner check, authenticated DAST (+ Nuclei/Schemathesis) plan generation, TLS grading (SSL Labs or local testssl/sslyze), dependency audits, secret scan, and the external-endpoint OSS scanners (Semgrep SAST, OSV-Scanner SCA, Checkov IaC) — runs what an agent can run, hands the owner exactly what it cannot, and folds every finding into a dispositioned false-positive dossier. On a journey run it enters twice — the early host-independent static substrate (before the audit, needing only the scope manifest) and the late live/conditional tail (after artifacts exist); standalone it is the full sweep. The scan evidence is what the submission attaches.
allowed-tools: Read Grep Glob Write Edit Bash Bash(node *harness/ingest-scanner-findings.mjs *) Bash(node *harness/reconcile-provenance.mjs *) Bash(node *harness/apply-dispositions.mjs *) Bash(node *harness/capture-openapi.mjs *) AskUserQuestion
---

# Run Scans

Produce the scan evidence the review requires, with the honesty line drawn
per family: what an agent ran (from what inputs, with the report file on
disk) versus what only the owner can run (and is therefore PENDING until the
owner's report file exists). Evidence lands in
`<target>/.security-review/evidence/`; dispositions land in the FP dossier
(`${CLAUDE_PLUGIN_ROOT}/templates/fp-dossier.md.tmpl` →
`<target>/docs/security-review/fp-dossier.md`). The failure class this phase
exists to kill: a submission whose scan reports are missing, stale,
unauthenticated, scoped narrower than the architecture doc, or carrying
undispositioned findings — each of those bounces at the materials check
(baseline: `process-prequeue-validation`, `scan-no-clean-scan-required`).

## When to use

- As the journey's **static-scan substrate** (early, BEFORE the audit): the
  host-independent families need only the scope manifest — see "The
  static/live partition" below
- As the journey's **live/conditional tail** (late): artifacts drafted and the
  scope manifest's endpoint inventory exists — the DAST scope is generated
  from it (this prerequisite belongs to the DAST/live tail, not the static
  substrate)
- Re-scanning after fixes: the submitted report must be the post-fix run
- Refreshing evidence before submission (baseline: `scan-report-freshness`)
- NOT a replacement for the white-box audit
  (`/sf-security-review-toolkit:audit-codebase` is static code review — a
  different evidence class, never presentable as DAST)
- NOT for executing the DAST scan itself — that is owner-run by nature, and
  this skill never claims otherwise (CONVENTIONS §2)
- NOT the reviewer's pen test — Salesforce's Product Security team tests the
  surface regardless of anything submitted (baseline:
  `dast-salesforce-runs-own-pentest`)

## Prerequisites

- `<target>/.security-review/scope-manifest.json` (from
  `/sf-security-review-toolkit:scope-submission`). Missing? Offer to route
  there first; degraded mode runs only the track the repo itself proves
  (package tree → Code Analyzer; lockfiles → dependency audit) and records
  that the endpoint families were skipped for lack of an inventory.
- `${CLAUDE_PLUGIN_ROOT}/baseline/requirements-baseline.yaml` readable.
- Per family: the Code Analyzer CLI + JDK 11+ (PMD engine) for the package
  track — present `sf` used as-is, else consent-installable as the whole stack
  to the tmp dir (0.8.41, the same gate as the OSS scanners); a ZAP install (or
  the container) wherever the owner will run DAST;
  network access for the TLS check; ecosystem package managers for the
  dependency audit. For the external-endpoint families (7/8) and the DAST/TLS
  extensions, the free/OSS tools — **Semgrep**, **OSV-Scanner**, **Checkov**,
  and optionally **Trivy / Nuclei / Schemathesis / testssl.sh / sslyze**; each
  is auto-**detected** (never auto-installed by THIS skill — see the hard
  boundary below), found on the prepended PATH when the operator consented to a tmp
  install at the journey gate (`<target>/.security-review/scanner-install.json`),
  and, if still absent, handed to the owner as the exact install + run command
  (`PENDING-OWNER-RUN`) rather than skipped silently.
- Credentials only ever via environment variables — this skill refuses to
  write a secret into a plan, an evidence file, or the run log
  (CONVENTIONS §6).

> **HARD BOUNDARY — THIS skill never mutates the host, never auto-fetches.** It
> **detects** scanners and **consumes** any the operator already consented to install;
> it **never installs them itself**. It MUST NOT run `pip install` / `pipx` /
> `npm i -g` / `brew` / a venv bootstrap / any package manager, and MUST NOT run a
> scan that **fetches third-party content over the network** (e.g. Semgrep pulling
> registry rule packs like `p/security-audit`). Installing software and fetching
> remote rule sets are **environment mutations / network egress** that
> `silence-is-yes` / full-auto never authorizes (it covers only inputs the preflight
> already DETECTED). A scanner that is absent — with no consented tmp install present
> (below) — is **`PENDING-OWNER-RUN`**: emit the exact install + run command for the
> owner, and move on. "Real evidence beats a PENDING stub" is **not** a license to
> self-install — a PENDING stub with the precise command IS the honest evidence here.
> The one always-allowed carve-out: a tool that is **already present** doing its
> **standard, bundled** read (`npm audit` hitting the registry it already targets;
> Code Analyzer's RetireJS using its shipped vuln DB).
>
> **The consent-gated install now EXISTS — and it is a SEPARATE, gated step, not
> something this skill does.** When the operator says yes at the journey's single
> preflight gate (the second of its two consents), `harness/install-scanners.mjs`
> installs the missing scanners to a tmp dir OUTSIDE the repo
> (`/tmp/sf-srt-scanners/<runid>/`, sha256-pinned binaries) and records them in
> `<target>/.security-review/scanner-install.json`. **As of 0.8.41 that consented set
> also includes the Code Analyzer stack** (`@salesforce/cli` + the `code-analyzer`
> plugin from npm + a JDK 11+ — a present `java`≥11 reused, else the pinned Temurin from
> Adoptium; ~1 GB, +~320 MB if Java must be provisioned), so on a cold box CRUD/FLS is
> deterministic-by-default rather than owner-gated. **This skill READS that pointer
> (when its `status` is not `cleaned`), prepends its `pathPrepend` to the PATH for the
> scan subprocesses, and uses those tools** — turning the absent families into real
> evidence (the Code Analyzer record's hermetic `env` + 2-dir `pathPrepend` is what
> Family 1's engine-explicit form exports). It still never runs the installer itself; absent the pointer (declined, or
> a standalone run with no journey gate), the answer stays `PENDING-OWNER-RUN`. The
> tmp tools are removed by `cleanup-scanners.mjs` at end-of-run (evidence kept).
> **When that consent was given, running the consented scanners with their STANDARD
> rule/template fetches (Semgrep registry rules, Nuclei templates, the OSV DB) is
> within scope** — the gate's install-yes covers installing AND running them for this
> run, since the fetch is inseparable from producing the evidence. Absent the consent,
> the no-remote-fetch rule above holds in full.
>
> **The tmp-scoped `install-scanners.mjs` path above is the PREFERRED install route** (it
> never touches the host's global state). A **global `npm install -g`** is only ever a
> gated fallback — and the shipped PreToolUse hook (`hooks/sf-ops-gate-hook.mjs`)
> **DENIES** `npm install -g` unless an affirmative `sf-cli-setup` consent is recorded
> (`node ${CLAUDE_PLUGIN_ROOT}/harness/record-consent.mjs --gate sf-cli-setup --answer "<operator's yes>" --target <repo>`,
> coupled to a mandatory `AskUserQuestion`). A skipped ask means the global install is
> denied, not silently run — so the tmp-scoped path stays the default.

## The eight families

Families 1–6 cover the Salesforce-package surface + secrets/deps/TLS. Families 7–8
(0.4.x, WI-17) close the **external-endpoint mechanical-scan gap**: the
partner-hosted server tree (Python/Node/Java/Go) + its IaC, which Code Analyzer
never sees and the LLM dimensions read but do not mechanically scan — yet
Salesforce explicitly pen-tests it ("Test Your Entire Solution… include all
external endpoints"). All Family 7/8 tools are free/OSS, no paid tier.

| Family | Applies when (manifest) | Scan runner | Evidence file(s) under `.security-review/evidence/` | Gate |
|---|---|---|---|---|
| 1. Code Analyzer | managed-package element | agent | `code-analyzer-<date>.html` + `.json` | `scan-code-analyzer-v5-required` (blocker) |
| 2. Partner Security Portal scanner (Checkmarx) | managed-package element | owner (portal); agent parses the report | `portal-scan-<date>.*` | `scan-checkmarx-partner-portal` (blocker — required IN ADDITION to Code Analyzer) |
| 3. Authenticated DAST (+ Nuclei templates, Schemathesis OpenAPI fuzz) | external-endpoint / mcp-server | owner executes; agent generates the plan + runs what it can | `dast/dast-report.{html,json}`, `dast/dast-url-proof.png`, `dast/nuclei-<date>.json`, `dast/schemathesis-<date>.json`, `dast/run-notes.md` | `dast-self-run-required`, `dast-authenticated-scans` (blockers) |
| 4. TLS grade (SSL Labs **or** local testssl.sh/sslyze) | external-endpoint / mcp-server | agent | `ssllabs-<host>.json` **or** `tls-<host>-<date>.json` + capture | `endpoint-ssl-labs-a-grade` (qualitative bar; local TLS evidence satisfies it deterministically) |
| 5. Dependency audit | always | agent | `deps-<ecosystem>-<date>.json` + the register | `scan-dependency-vulnerabilities` (major) |
| 6. Secret scan (tree + full git history) | always | agent | `secret-scan-<date>.json` (redacted) | `fail-hardcoded-secrets` (blocker) |
| 7. External SAST | external-endpoint with source (Python/Node/Java/Go) | agent | `semgrep-<date>.json`/`.sarif` + `opengrep-<date>.json`/`.sarif` (the reachability leg) (+ `bandit`/`njsscan`/`gosec`-<date>.json per language, + `redos-<date>.txt` — the regexploit ReDoS leg, verbatim text) | `scan-external-sast` (major; blocker on a confirmed critical in reviewer-reachable code); ReDoS leg → `resource-consumption-abuse` (major) |
| 8. External SCA + IaC | any lockfile / Dockerfile / IaC under a non-package source root | agent | `osv-<date>.json`, `iac-<date>.json` | `scan-external-sca` (major), `scan-iac-misconfig` (major) |

The *Applies when (manifest)* column — here and in every per-family *Applies
when:* line below — matches element types through their canonical form
(synonyms per `harness/render-detected-elements.mjs`'s
`ELEMENT_TYPE_SYNONYMS`, e.g. `external-web-app` ≡ `external-endpoint`): a
synonym-typed manifest selects exactly the families its canonical twin would.

## The static/live partition — two journey entry modes

The eight families split cleanly by what they need, and the journey drives the
two halves at different points:

- **Static substrate (host-independent — the journey runs these EARLY, before
  the audit):** Family 1 (Code Analyzer — CRUD/FLS + sharing), Family 5
  (dependency audit), Family 6 (secret scan), Family 7 (external SAST), and
  Family 8 (SCA + IaC). These read the repo and consume only tools already
  present or consent-installed at the journey gate; they need no reachable
  host and no deployed org, only the scope manifest. Family 4's **local TLS**
  form (testssl.sh/sslyze) MAY join the static pass, but ONLY when a manifest
  endpoint host is reachable AND its read-only live-probe consent is already
  recorded — a host-reaching probe stays behind the same gate at the same
  ask-point regardless of when it runs; otherwise TLS stays in the tail or
  `PENDING-OWNER-RUN`.
- **Live/conditional tail (the journey runs these LATE, after artifacts):**
  Family 3 (the authenticated-DAST plan + the consented throwaway DAST — live
  ops), Family 2 (the portal prediction — it maps the audit ledger's CONFIRMED
  findings, which exist only after the audit), Family 4's host-grade TLS
  (SSL Labs / host-reachable testssl where not already produced), anything the
  static pass left `PENDING-OWNER-RUN`, and the Step 9b ingest + reconcile
  tail.

**How the journey signals the mode:** it SAYS so in the invocation — "run the
static-scan substrate" vs "run the live/conditional tail" — and this skill runs
only that half's families (family selection from the manifest is unchanged;
the mode only partitions WHICH selected families run now). Each mode ends with
the Step 9b `--all` ingest + reconcile over whatever evidence now exists — both
harnesses are idempotent (stable ids dedup; reconcile only demotes), so running
them at the substrate tail AND again at the live tail is safe. **A standalone
invocation with no mode stated is the full sweep — all selected families, both
halves, exactly as before.** Consent posture is identical in every mode: this
skill installs nothing, and an absent tool is `PENDING-OWNER-RUN` (the hard
boundary above, verbatim). On a journey run, the static substrate is what makes
the audit's first pass ingest real scanner findings instead of leaving those
families PENDING until a re-audit.

## Steps

1. **Read the scope manifest and the baseline; establish the tool PATH; surface
   the conflicts before running anything.** Select families from the manifest's
   elements (table above). **Then read
   `<target>/.security-review/scanner-install.json` (if present and `status` is not
   `cleaned`) and prepend its `pathPrepend` entries to the PATH for every scan
   subprocess** — those are the scanners the operator consented to install for this
   run; with them on the PATH, the external-SAST/SCA/secret/TLS/DAST families that
   would otherwise be `PENDING-OWNER-RUN` now resolve to real tools and real evidence.
   **Verify each `pathPrepend` dir still EXISTS before trusting it** — the tmp dir
   lives under `/tmp`, which a reboot wipes, so a stale pointer can outlive its tools;
   a missing dir means treat that family as `PENDING-OWNER-RUN`, not present. Re-detect
   availability with the (surviving) PATH in place (a tool both present-on-PATH and in
   the pointer is just present). Warn when any `scan-*`/`dast-*`/`endpoint-*` entry
   this run uses has `last_verified` older than 90 days (CONVENTIONS §4). Surface every
   `conflicting` entry with its `conflicts` text — never silently pick a
   side. As of the 2026-06 baseline sweep the scan-relevant remainder is
   narrow: `endpoint-ssl-labs-a-grade` (only whether reviewers enforce the
   letter grade in practice — the codified bar is qualitative) and
   `process-review-fee` (the dollar amount). Formerly contested entries are
   now verified — read them from the baseline, not from memory of old
   prose: `scan-checkmarx-partner-portal` (the portal scanner is
   operational and required for package-bearing submissions),
   `dast-severity-bar` (the fix-vs-document bar is published),
   `scan-code-analyzer-v5-required` (v5 tooling is prescribed verbatim,
   though never assert a GA date), and `mcp-listing-managed-package` (an
   AgentExchange MCP listing carries BOTH the package-scanning track and
   the external-endpoint track).

2. **Family 1 — Code Analyzer (package track).**
   *Requires:* the current Code Analyzer's HTML report, submitted with the
   review; the prior major version is retired (baseline:
   `scan-code-analyzer-v5-required`).
   *Install check:* verify the CLI is present and reports the currently
   required major version — read that from the baseline entry at run time,
   don't trust this prose. PMD needs JDK 11+; check `java -version` before
   blaming the scanner.
   *Cold-install path (0.8.41):* when `sf` / the plugin / a JDK are ABSENT and
   the operator consented at the journey gate, `install-scanners.mjs`
   provisions the whole Code Analyzer stack — the pinned `@salesforce/cli` +
   the `code-analyzer` plugin + a JDK 11+ (a present `java`≥11 is reused, else
   the pinned Temurin is fetched + sha256-verified) — into the tmp root, so
   CRUD/FLS is deterministic-by-default instead of `PENDING-OWNER-RUN`. The
   `code-analyzer` record inside the manifest that
   `<target>/.security-review/scanner-install.json` points at carries a
   hermetic `env` map and a 2-dir `pathPrepend` (the sf `.bin` AND
   `JAVA_HOME/bin`). **Export that `env` and prepend both `pathPrepend` dirs**
   for the scan subprocess, then run the workspace form below. Everything the
   stack writes is contained under the tmp root, so `cleanup-scanners.mjs`
   removes it structurally at end-of-run (evidence kept). When a present `sf`
   is already on PATH, use it as-is — it is never re-installed.
   **Report the Code Analyzer plugin version from the manifest record's
   `code-analyzer` → `plugin.installed` field (read deterministically from the
   installed plugin's `package.json`), NOT an ad-hoc `sf plugins` listing** — a
   cold run misreported `5.13.0` while the pinned `5.14.0` was on disk because
   it read the version from an LLM-parsed `sf plugins` instead of the manifest.
   *Invocation — the deterministic-band form is PRIMARY.* Run the v5 workspace
   form that selects the engines explicitly. This is the form that produces the
   FLS band AND the `--all`-ingestable evidence JSON, and it is the primary
   command for **BOTH** a present `sf` and the cold-installed stack — the only
   difference between the two is how `sf` got onto PATH (a pre-existing install
   vs. the 0.8.41 cold-install provision above), not which command you run:

   ```bash
   sf code-analyzer run --workspace <force-app-root> \
     -r AppExchange -r sfge -r pmd \
     --output-file .security-review/evidence/code-analyzer-<date>.json --view detail
   ```

   **`-r sfge` is mandatory for FLS:** `ApexFlsViolation` is DevPreview and NOT
   in `Recommended`, so it only fires when sfge is selected explicitly;
   `ApexCRUDViolation` comes in via `-r AppExchange` / `-r pmd`. All three
   CRUD/FLS rules carry a Security/AppExchange tag, so they survive the ingest
   adapter's security-tag filter. **A present `sf` does NOT exempt you from this
   form:** the HTML-only submission form below, run on its own, yields NEITHER
   the FLS band NOR the `--all`-ingestable JSON — so a box that already has `sf`
   on PATH still MUST run this engine-explicit form (with `-r sfge` + the
   evidence JSON) to get the deterministic CRUD/FLS band. SFGE has
   per-entry-point timeouts and a JVM heap knob (`--sfge-jvm-args`); defaults
   are fine at small sizes (the 0.8.41 spike ran 45 files in ~30 s) but budget
   the timeout for large Apex trees. The 0.8.40 `--all` ingest then consumes the
   resulting JSON into the deterministic band (already wired — don't re-wire).

   Verify the flag syntax against YOUR installed CLI (`--help`) before
   running — the last major-version transition changed the command shape
   once already. The **AppExchange selector is load-bearing** (in BOTH forms):
   it activates the review-specific PMD rule set (session-ID retrieval,
   hardcoded credentials, install/uninstall-handler rules, the Critical
   `FeatureManagement.changeProtection` license-gate-tampering rule
   `AvoidFeatureManagementChangeProtection`, and the Moderate
   `getInstance(userId/profileId)` taint rule `AvoidGetInstanceWithTaint` —
   baseline: `scan-pmd-appexchange-rules`,
   `violation-feature-management-change-protection`,
   `violation-getinstance-with-taint`); a scan without it looks diligent and
   misses the rules the reviewer cares about. The Graph Engine (`-r sfge`)
   data-flow CRUD/FLS findings target the #1 review-failure cause, so triage
   its output first (baseline: `scan-sfge-crud-fls-dataflow`, `fail-crud-fls`).

   *Submission HTML artifact (an ADDITIONAL pass, NOT the primary/only
   command).* The reviewer requires the HTML report, so ALSO emit it — the
   byte-verified required invocation recorded in `scan-code-analyzer-invocation`:

   ```bash
   sf code-analyzer run --rule-selector AppExchange \
     --rule-selector Recommended:Security \
     --output-file CodeAnalyzerReport.html
   ```

   Run BOTH passes every time: the engine-explicit JSON above (the deterministic
   band + machine triage — what feeds the ledger) AND this HTML (the submission
   format — what gets uploaded). HTML alone is not enough; the engine-explicit
   form is what makes CRUD/FLS deterministic.
   *Agent runs:* install check, scan, JSON parsing, diffing findings against
   the audit ledger, dossier-row drafting. *Owner runs:* the code fixes, and
   confirmation of every FP justification.
   *Evidence:* `evidence/code-analyzer-<date>.html` + `.json`.
   *Disposition:* every violation becomes **fixed** (then re-scan — the
   submitted report must come from the submitted code, not three fixes ago)
   or a **dossier row**. Critical/High are must-fix; Code Analyzer has no
   numeric pass threshold (the published bar is effort-based: fix what you
   can, re-scan, document the rest) and CLI exit codes are not a readiness
   signal (baseline: `scan-severity-threshold-unpublished`). The posture is
   `scan-no-clean-scan-required`: **false positives are expected — justify
   them.** Do not tune selectors down to manufacture a clean report; the
   reviewer runs their own tooling, and a suspiciously empty report reads
   worse than a documented one.

3. **Family 2 — Partner Security Portal scanner (Checkmarx): required IN
   ADDITION to Code Analyzer for any submission that includes a package or
   component.** The baseline entry (`scan-checkmarx-partner-portal`) is
   verified current: the portal's Source Code Scanner scans Apex,
   Visualforce, and Lightning code; it is not an alternative to Code
   Analyzer, and it is not required for API-only or mobile-client
   submissions. Two mechanics with budget teeth:
   - **Three portal runs per solution version are included in the review
     fee.** Develop against free PMD (unlimited runs — but PMD results are
     NOT accepted with the submission) and spend the portal runs only on
     submission-grade reports: an early sanity run, the post-fix run, one
     spare. A paid Checkmarx license lifts the limit (and the linking
     prerequisite below, and allows scanning unpackaged code).
   - **The package version must be linked to an AppExchange listing before
     the portal will scan it** — schedule the listing-link step ahead of
     the scan, not the day of submission. Portal access needs a
     Partner-Console-connected DevHub/packaging org plus the 'Author Apex'
     permission.
   *Owner runs:* the portal login, listing link, scan initiation, and
   report download to `evidence/portal-scan-<date>.*`. *Agent runs:*
   parsing the report and folding findings into the same dossier — one
   disposition discipline across all scanners. The published Checkmarx
   bar: every finding requires attention — fix or documented false
   positive — EXCEPT those labeled "Code Quality" (baseline:
   `scan-severity-threshold-unpublished`; the DAST companion bar lives in
   `dast-severity-bar`).
   *Prediction — pre-empt your 3 portal runs (WI-16).* The portal scan is
   owner-gated, but the toolkit already ran Code Analyzer (Family 1) + the LLM
   package dimensions (audit-codebase), which overlap heavily with Checkmarx's
   Apex/VF/Lightning query families. Map every CONFIRMED package finding in the
   ledger to its likely Checkmarx category and emit
   `evidence/checkmarx-prediction-<date>.md`. Head that file with the
   one-directional caveat verbatim so it reaches a partner who never opens this
   skill: *"This predicts only the categories our local stack can see; Checkmarx
   runs proprietary queries we don't have and WILL flag categories listed
   nowhere below. Treat portal run #1 as DISCOVERY, not confirmation."* Then:
   "your 3 portal runs will likely surface these; fix or pre-disposition first."
   The mapping (finding class →
   Checkmarx category): SOQL/SOSL injection → SQL/SOQL Injection · missing
   CRUD/FLS → Missing Object/Field-Level Security · sharing bypass → Insecure
   Sharing · XSS sinks → Stored/Reflected XSS · open redirect → Unvalidated
   Redirect · hardcoded secret/ID → Hardcoded Credentials/Salesforce ID ·
   JS-in-origin / Locker<40 → Lightning component hygiene · CSRF-on-instantiation
   → CSRF. **Honesty: this is a PREDICTION, not an equivalence** — Checkmarx's
   proprietary queries find classes the local stack misses and vice versa; the
   value is that your portal runs come back with *no surprises*, never "Checkmarx
   will find nothing." **The prediction is one-directional: it covers only the
   categories the local stack can see. Checkmarx runs proprietary queries we do
   not have and WILL surface categories this prediction structurally cannot.
   Treat portal run #1 as DISCOVERY of those blind-spot categories, not
   confirmation of a clean bill — budget the three runs accordingly (run #1
   finds, #2 confirms the fixes, #3 is the margin), and do not assume #1 is the
   post-fix run.** Pre-fill the FP dossier with the dispositions you already
   hold so a predicted finding the portal confirms is answered before you spend
   run #2. *Optional, genuinely headless (paid CxOne licence):* if `CX_APIKEY` is
   in the env, run the real Checkmarx One CLI (`cx scan create … --report-format
   sarif`) as Family 2b over the package source and parse the SARIF — a licence
   lifts the 3-run limit + the listing-link prerequisite; absent the key,
   prediction-only.

4. **Family 3 — Authenticated DAST: the agent generates the plan; the owner
   executes the scan against production — OR the toolkit runs it against a
   throwaway.** *Autonomous option (0.7.0):* when the journey's throwaway-DAST consent
   was given, the toolkit stands the backend up as a disposable mirror and runs a
   digest-pinned ZAP against THAT
   (`harness/{standup-stack,capture-openapi,run-dast,teardown-stack}.mjs`),
   landing real evidence in `evidence/dast/zap-baseline-*.json` — **labelled
   local-throwaway**: it's corroborating DAST + a de-risking dry run, NOT the
   production-equivalent submission scan (the active scan only ever hits a mirror the
   toolkit built, never live prod / Salesforce infra / a third party). While the mirror
   is up, `capture-openapi.mjs` also GETs the framework's own spec (read-only,
   loopback-only, riding the same recorded consent) into `evidence/openapi-<date>.json` —
   that is what upgrades the api-endpoints artifact `generate-artifacts` emits from
   code-derived to mirror-captured, with prod-equivalence PENDING owner attestation. *Requires (the
   submission scan):* partner-run DAST of every external
   endpoint with an industry tool — there is no hosted alternative (baseline:
   `dast-self-run-required`); the scan must be **authenticated** (baseline:
   `dast-authenticated-scans` — an anonymous scan covers only the public
   shell and misses the authorization-flaw classes the review cares most
   about); for MCP submissions the **identity/OAuth endpoints are in scope
   as first-class targets** (baseline: `dast-scope-includes-identity-endpoints`
   — driving the scanner *through* the login flow is not the same as
   scanning the identity surface itself); the target must be
   production-equivalent (baseline: `dast-endpoints-production-mode`); the
   exported report must include the scan date, the targeted endpoints, and
   all findings — that is what proves the stated endpoints were actually
   scanned (baseline: `dast-screenshot-proof-of-scanned-url`).
   *Agent runs:* generate the ZAP Automation Framework plan from
   `${CLAUDE_PLUGIN_ROOT}/harness/zap/zap-plan-template.yaml` per
   `${CLAUDE_PLUGIN_ROOT}/harness/zap/README.md` — the README carries the
   binding rules. Fill the slots from the scope manifest's endpoint
   inventory plus the same OpenAPI/endpoint spec submitted as the
   api-endpoints artifact (one source of truth: the report scope provably
   matches the docs, and the active scan reaches documented POST endpoints a
   spider never finds). Seed the authorize/token/register/revoke paths and
   `/.well-known/*` discovery docs explicitly. Pick the auth pattern (bearer
   token via `${DAST_BEARER_TOKEN}`, or browser-login with poll
   re-verification); secrets arrive via environment variables at run time,
   never in the plan file. Validate the plan loads against the installed ZAP
   — a half-loaded plan scans half the scope and tells you in a log line,
   not an error. Confirm the environment label on every target URL from the
   manifest; never point a scan at a URL whose staging-vs-production status
   is unconfirmed.
   *Owner runs:* authorization to scan, token minting (lifetime exceeding
   the scan window — an expired token silently degrades the rest of the run
   to an anonymous scan that still prints a green-looking report), CDN/WAF
   edge handling per the README, the scan itself, and the post-fix re-scan.
   This skill **never marks the scan executed** — it verifies the report
   files exist in `evidence/dast/` and parses them when they do.
   *Evidence:* `evidence/dast/dast-report.html` + `.json`,
   `dast-url-proof.png` (must visibly show the target URL and scan date),
   `run-notes.md` (ZAP version, plan file, token scope, edge allowlist
   made/reverted).
   *Disposition:* every finding **above informational** gets one — fixed
   (the owner re-scans; the submission report is the post-fix run, and the
   fixed finding leaves the dossier, replaced by the re-scan-clean evidence)
   or a dossier row with code evidence. The README's FP-class catalog
   pre-classifies the predictable noise from hardened endpoints
   (anti-enumeration always-200s, 405-on-GET MCP paths, by-design 429s); a
   class match is a hypothesis, not a disposition. The fix-vs-document
   severity bar is published (baseline: `dast-severity-bar`): critical and
   high findings require attention — fix or justified false-positive
   documentation — while action on low/medium findings is not required,
   only investigation encouraged. The toolkit's posture stays stricter
   than that bar (a disposition for every finding, fix don't document
   anything High/Critical) because undocumented low/medium noise still
   invites reviewer questions.
   *Extension — template DAST + spec-driven fuzzing (WI-17, agent-runnable where
   a staging URL + probe consent exist):* beyond the authenticated ZAP crawl, run
   **Nuclei** (`nuclei -u <url> -severity low,medium,high,critical -json-export
   evidence/dast/nuclei-<date>.json`) for the community CVE / misconfig / exposure
   template library, and **Schemathesis** (`schemathesis run <openapi-spec>
   --base-url <url> --checks all`) driven from the OpenAPI artifact
   `generate-artifacts` already emits — a genuinely different test class than the
   crawl (it exercises the CONTRACT: 500s, auth-bypass on undocumented methods,
   spec/implementation drift). Feed that same spec to ZAP's OpenAPI import so the
   authenticated scan covers documented endpoints explicitly, not only what it
   crawled. Same fix-vs-document bar; evidence under `evidence/dast/`.

5. **Family 4 — TLS grade, every external hostname.** *Requires:* the
   codified transport bar per `endpoint-ssl-labs-a-grade` is qualitative —
   HTTPS-only, secure TLS versions, weak ciphers disabled, HTTP-to-HTTPS
   redirect, HSTS — with the SSL Labs A grade as official *recommended*
   practice ("aim for an A"), not a codified pass/fail gate; the entry's
   one remaining conflict is whether reviewers enforce the letter grade in
   practice. Plus full trusted chain and expiry headroom (baseline:
   `endpoint-trusted-ca-certificates`).
   *Agent runs:* query SSL Labs for **every** external hostname in the
   manifest's endpoint inventory — app, API, MCP host, identity host if
   separate, webhook receivers. Use the API (poll the analyze call until the
   assessment is READY; request a **fresh** assessment, not a cached one —
   a result from before your last config change is not evidence) or walk the
   owner through the web UI. Save the JSON per host to
   `evidence/ssllabs-<host>.json` plus a capture showing hostname, grade,
   and date. Cheap header probes ride along into the same evidence: HSTS,
   HTTPS-only/redirect behavior (baseline: `endpoint-hsts`,
   `endpoint-https-only`).
   *The gotcha that costs a cycle:* the grade measures **whatever terminates
   TLS for the public hostname** — when a CDN/proxy edge fronts the origin,
   the edge's configuration (minimum TLS version, cipher policy at the edge)
   is what grades, not your origin. A field-tested pattern: an origin with a
   flawless TLS config still grades down because the edge's minimum-TLS
   setting admitted legacy protocols; the fix was one edge setting, no
   origin change. Before raising the edge's floor beyond the bar, check what
   your legitimate callers negotiate (Salesforce callouts included) so the
   fix doesn't break the integration it protects.
   *Disposition:* a hostname failing the qualitative bar (plain HTTP, weak
   ciphers, no HSTS) is a **fix-now blocker, never a dossier entry**. A
   hostname below A technically passes the codified gate but cedes
   reviewer discretion — fix it anyway; exceeding the gate is cheap.
   Record the failing protocol/cipher detail from the JSON as the
   remediation pointer.
   *Extension — local deterministic TLS evidence (WI-17):* the SSL Labs grade is
   a contested external dependency (this entry's one open conflict — whether
   reviewers enforce the letter grade). Produce **local, deterministic** TLS
   evidence instead with **testssl.sh** (`testssl.sh --jsonfile
   evidence/tls-<host>-<date>.json <host>:443`) or **sslyze** (`sslyze
   --json_out=evidence/tls-<host>-<date>.json <host>:443`): protocol versions,
   cipher list, cert chain + expiry, HSTS — the same qualitative bar, evidenced
   offline with no third-party grade. This is the evidence file that **satisfies
   `endpoint-ssl-labs-a-grade` deterministically** and clears its `conflicting`
   status: you assert the qualitative properties directly (HTTPS-only, secure
   versions, weak ciphers disabled, HSTS) rather than leaning on a letter grade.

6. **Family 5 — Dependency audit, every detected stack.** *Requires:*
   bundled third-party components free of known CVEs (baseline:
   `scan-dependency-vulnerabilities`) — outdated JS libraries with known
   CVEs are a recurring failure cause, and **packaged static resources are
   the classic miss** (an old framework copy vendored into the package's
   static resources, invisible to the app repo's lockfile audit).
   *Agent runs:* the ecosystem-native scanner per detected stack —
   `npm audit` against the lockfile (record prod-vs-dev scope), `pip-audit`
   for Python, RetireJS (bundled with Code Analyzer) over packaged JS and
   static resources, the native equivalent for anything else the repo
   contains. Evidence: `evidence/deps-<ecosystem>-<date>.json`.
   *Disposition:* a known CVE **with a patched version available is
   upgraded, not documented around** — flag breaking-change risk, but the
   reviewer expects the upgrade. A finding with no fix available yet goes in
   the **tracked-vulnerability register**
   (`<target>/docs/security-review/vulnerability-register.md`): CVE,
   component, exploitability-in-context, compensating control, remediation
   path with a named owner and target date. The register backs the
   readiness tracker's CI-evidence rows, and the dossier cross-references it
   whenever another scanner flags the same library.

7. **Family 6 — Secret scan, working tree AND full git history.** *Requires:* a
   no-hardcoded-secrets posture backed by a **mechanical** scan, not an assertion
   (baseline: `fail-hardcoded-secrets` — an auto-fail class; managed-package code
   obscurity is explicitly not a defense; `artifact-credential-storage-attestation`
   (blocker) pairs the scan output with an owner signature, and the *absence* of
   that scan output is itself the bounce). This family is the mechanical
   complement to the `secrets-credentials` dimension's LLM finder, never its
   replacement.
   *Tool:* **gitleaks** (preferred — native full-history mode + deleted-blob
   surfacing); trufflehog / detect-secrets are substitutes. *Two passes, both
   mandatory:* (1) **working-tree** over every resolved source root including IaC
   paths (Dockerfile `ENV`/`ARG`, terraform `*.tf`/`*.tfvars`/`*.tfstate`,
   CloudFormation/Ansible) — catches a secret in the submittable surface a
   reviewer's bundled scanner reaches; (2) **full git history** (`gitleaks
   detect` over all history) — surfaces deleted-but-recoverable blobs explicitly
   (the mechanical form of the `secrets-credentials` `git log --diff-filter=D`
   heuristic — a tool invocation, not an LLM spot-check). *Agent runs:* both
   passes, parsing, dossier rows. *Owner runs:* the **rotation** of every
   confirmed live secret — the agent cannot certify a credential dead.
   *Evidence:* `evidence/secret-scan-<date>.json` (redacted). *Gate:*
   `fail-hardcoded-secrets` (blocker); it also **backs**
   `artifact-credential-storage-attestation`. *Disposition — keep the per-finding
   distinction:* a secret in the partner's **private repo history** is rotate-now
   breach debt the reviewer does not scan for; a secret in the **submitted
   package/code** is a literal review gate — both NOT-CLEAN until dispositioned;
   remediation is **rotation first, scrub second** (scrubbing without rotation is
   theater); the dossier carries a **rotation-evidence** field (changed key-id /
   revocation record / dated owner-signed note). *Honest ceiling — state it in the
   evidence summary (CONVENTIONS §2):* mechanical scanners reliably catch
   **provider-prefixed** (`AKIA…`/`sk-…`/`ghp_…`/`-----BEGIN … PRIVATE KEY-----`)
   and **high-entropy** secrets but **MISS custom-format / low-entropy** ones (a
   bespoke token shaped like a UUID or a base64 config blob); the
   `secrets-credentials` LLM finder is the standing complement. Full mechanics:
   `${CLAUDE_PLUGIN_ROOT}/skills/run-scans/SECRET-SCAN-FAMILY-6.md`.

8. **Family 7 — External SAST (the partner-hosted server tree).** *Applies when:*
   the manifest shows an `external-endpoint` element with source — every detected
   non-package language root (Code Analyzer scans only Apex/VF/Aura; it never sees
   the Python/Node/Java/Go server Salesforce explicitly pen-tests). *Tool:*
   **Semgrep** (OSS engine + free community rulesets) is the keystone — one tool
   across languages, and custom-rule capable (a future pack can re-express the LLM
   dimensions' heuristics as deterministic rules). Add a language gate where it
   sharpens recall: **Bandit** (Python), **njsscan** (Node), **gosec** (Go).
   Ingest note (0.8.83): bandit **test-path LOW** hygiene hits (B101 assert / B404
   import under `tests/`, `test_*.py`, `*_test.py`, `conftest.py`) are filtered at
   ingest as non-security noise with one aggregated note per evidence file — prod-path
   LOW (e.g. a B105 hardcoded password) and every MEDIUM/HIGH hit ingest unchanged.
   *Invocation (verify flags against your installed version):*

   ```bash
   semgrep scan --config p/security-audit --config p/secrets \
     --config p/<language> --config ${CLAUDE_PLUGIN_ROOT}/rules/injection/ \
     --json --dataflow-traces \
     --output evidence/semgrep-<date>.json <server-root>
   semgrep scan --config p/security-audit --config p/secrets \
     --config p/<language> --config ${CLAUDE_PLUGIN_ROOT}/rules/injection/ \
     --sarif --dataflow-traces \
     --output evidence/semgrep-<date>.sarif <server-root>
   ```

   `--config ${CLAUDE_PLUGIN_ROOT}/rules/injection/` is a toolkit-authored taint-rule
   pack (additive with the registry packs above — a local directory, so no network or
   login, free CE). It covers the XPath (CWE-643) + LDAP (CWE-90) injection classes the
   OSS packs miss on Python/Go/JS (`p/security-audit` + `p/csharp` cover Java + C# only,
   and njsscan's `node_xpath_injection` fires on `xpath.parse()` alone). Each rule is
   `mode: taint` (it requires a real source→sink flow, never a bare sink) and
   `semgrep --test`-validated; the CWE it tags routes the hit to `injection-xss` through
   the same `metadata.cwe` path as the registry rules — no ingest change. *Honest scope:*
   Semgrep CE taint is intra-file / intraprocedural, so the pack is low-FP but
   moderate-FN — a tainted value that crosses a function or module boundary before the
   sink falls to the LLM residual, not to a noisy bare-sink rule.

   `--dataflow-traces` is load-bearing: it explicitly requests the source→sink
   dataflow trace for taint-mode results — `extra.dataflow_trace` in the JSON is
   what the ingest adapter captures as the finding's `reachabilityPath`
   (+ `reachable: true`), so the live command must ask for the trace rather than
   depend on any version's default. *Substrate ceiling:* whether `--json`
   actually carries the trace is version-dependent (verified on a seeded
   source→sink sample: 1.85.0 emits `extra.dataflow_trace`; 1.168.0 omits it
   even with the flag — newer CLIs serialize the trace to text/SARIF output
   only). The `--sarif` capture is the version-portable second surface: SARIF
   `codeFlows` is the standardized taint-path serialization the ingest also
   normalizes to `reachabilityPath` — but on current Semgrep CE the SARIF
   codeFlows may be ABSENT too (verified 1.168.0: none emitted on a taint
   finding that provably has a trace — Pro-gated), so **Opengrep below is the
   OSS engine that actually produces the trace on current tooling**. The ingest
   now says this deterministically (0.8.80): when a toolkit taint rule (the
   `rules/injection/` pack — the one rule set whose taint mode is knowable from
   the output, via its `rules.injection.` check_id prefix) fires with no
   dataflow trace, the harness emits one aggregated "reachability substrate
   unavailable on this engine version / output surface" note per evidence file
   instead of leaving the report to this prose — relay that note in the
   evidence summary. Honest scope: the marker covers the toolkit's own taint
   pack only (registry/third-party rules carry no output-visible taint marker,
   so their trace-lessness stays unmarked); the findings themselves still
   ingest normally; only `reachabilityPath` is absent. The ingest also emits a
   version-drift note when an opengrep evidence file records a version
   different from the pinned install (opengrep only — the one ingest tool that
   both records its producing version and is version-pinned).

   **The Opengrep reachability leg (rides this family).** Opengrep (the
   LGPL-2.1, consortium-governed Semgrep fork; installed as a pinned release
   binary — it is not on PyPI) empirically emits the machine-readable trace
   current Semgrep CE withholds, in BOTH output formats, and adds
   cross-function (intra-file) taint via `--taint-intrafile`. Capture both
   surfaces:

   ```bash
   opengrep scan --config <rules> --taint-intrafile --dataflow-traces \
     --json --output evidence/opengrep-<date>.json <server-root>
   opengrep scan --config <rules> --taint-intrafile --dataflow-traces \
     --sarif --output evidence/opengrep-<date>.sarif <server-root>
   ```

   Flag note (verified on 1.25.0 over a seeded source→sink sample): Opengrep's
   `--json` emits `extra.dataflow_trace` even WITHOUT `--dataflow-traces`, but
   its `--sarif` emits `codeFlows` ONLY WITH the flag — keep it on both so the
   two surfaces stay consistent. The `--all` ingest enumerates both
   `evidence/*.json` and `evidence/*.sarif`; keep the `opengrep-<date>.*`
   evidence names as written — Opengrep's JSON is content-identical to
   Semgrep's format, and the documented name is what lets the ingest label the
   findings' provenance `engine: 'opengrep'` honestly (SARIF self-identifies
   via `tool.driver.name`; the JSON cannot).

   The registry configs are fetched once; if the host is offline, vendor the rules
   first (`semgrep --config <dir>`). The `--config p/security-audit --config
   p/<language>` pair above is what routes findings to real methodology dimensions:
   the ingest reads each scanner-emitted CWE and files injection-class hits under
   `injection-xss` — including XPath (CWE-643) and LDAP (CWE-90), which route for
   the languages an OSS rule already covers (Java + C# via `p/security-audit` +
   `p/csharp`; Node XPath via njsscan's `node_xpath_injection`, `xpath.parse()`
   only). No extra config is needed for those — njsscan already emits the routable
   CWE. *Agent runs:* the scan, JSON parsing, diffing
   against the audit ledger (the `injection-xss`/`oauth-identity` dimensions may
   already have flagged the same sink — cross-reference, don't double-report),
   dossier rows. *Owner runs:* the code fixes. *Evidence:*
   `evidence/semgrep-<date>.json` (+ per-language files). *Gate:*
   `scan-external-sast` (major; a confirmed critical in reviewer-reachable server
   code — an injection, an auth bypass, an SSRF — is a blocker, because the
   reviewer's pen test reaches it). *Honest ceiling:* SAST has a false-negative
   floor; it complements the LLM dimensions + the reviewer's pen test, it replaces
   neither.

   **The ReDoS leg (rides this family).** When Family 7 runs, ALSO run the
   **regexploit** ReDoS scan over every detected non-package language root — the
   catastrophic-backtracking-regex *pattern* substrate of
   `resource-consumption-abuse` is machine-checkable (regex-AST ambiguity
   analysis), so it belongs to the deterministic band, not the LLM fan-out:

   ```bash
   { regexploit-py <server-root>; regexploit-js <server-root>; } > evidence/redos-<date>.txt
   ```

   regexploit emits TEXT only (no JSON output exists in the tool), so the evidence
   file is its VERBATIM stdout — and because the `--all` ingest enumerates
   `evidence/*.json` + `evidence/*.sarif`, the ReDoS TEXT evidence is NOT
   auto-recognized there; ingest it with the explicit scanner form (see step 9b):

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/harness/ingest-scanner-findings.mjs \
     --scanner regexploit --input evidence/redos-<date>.txt --target <target>
   ```

   The JS/TS parser needs a one-time `npm install` inside the regexploit package —
   the tool prints the exact command when the modules are missing; `regexploit-py`
   needs nothing extra. Exit code is 0 whether or not vulnerable patterns are
   found. *Gate:* `resource-consumption-abuse` (major). *Honest note:* the scanner
   proves the PATTERN is catastrophic (exponential/polynomial backtracking);
   whether attacker-controlled input reaches it is the audit's judgment — the
   labelled `llm-inferred` residual — and the deterministic row sits beside, never
   silences, the dimension's rate-limit / denial-of-wallet findings.

9. **Family 8 — External SCA + IaC.** *Applies when:* any lockfile, Dockerfile, or
   IaC file exists under a non-package source root — the supply-chain + infra
   surface the reviewer treats as in-scope when data flows through it. *Tools:*
   **OSV-Scanner** (Google, OSS — multi-ecosystem, queries the OSV DB; leaner +
   lower-noise than a per-ecosystem `npm/pip audit`) for SCA; **Checkov** (OSS) for
   IaC misconfig (Terraform/CloudFormation/Kubernetes/Dockerfile); **Trivy** (OSS)
   is an acceptable one-tool substitute covering container image + deps +
   Dockerfile + secrets together. *Invocations:*

   ```bash
   osv-scanner -r <server-root> --format json > evidence/osv-<date>.json
   checkov -d <iac-dir> --framework terraform -o json > evidence/iac-terraform-<date>.json
   checkov -f <Dockerfile> --framework dockerfile -o json > evidence/iac-dockerfile-<date>.json
   trivy config -f json <compose-dir> > evidence/iac-compose-<date>.json   # docker-compose / compose files
   ```

   **docker-compose / compose IaC is scanned with `trivy config -f json <dir>`, NOT
   checkov** — checkov has no `docker_compose` framework (a cold run improvised that
   framework value and got an empty/errored scan; never pass it — route compose files
   to Trivy as above). Both the checkov and trivy ingest adapters already file
   `iac-misconfig` at class severity, so the ingest is unchanged either way.

   *Agent runs:* both passes, parsing, the SBOM / component-version table for the
   security-program element-4 slot (reuse the OSV output), dossier rows. *Owner
   runs:* dependency bumps + infra fixes. *Evidence:* `evidence/osv-<date>.json`,
   `evidence/iac-*-<date>.json`. *Gate:* `scan-external-sca` (major — a known-CVE
   dependency reachable in the deployed server), `scan-iac-misconfig` (major — an
   open security group, a public bucket, a hardcoded image secret). A secret in a
   Dockerfile `ENV`/`ARG` is ALSO a Family-6 `fail-hardcoded-secrets` hit —
   cross-reference, don't double-disposition. *Honest ceiling:* SCA catches *known*
   CVEs in *declared* deps; a vendored copy or a zero-day is invisible to it
   (RetireJS over packaged static resources + the reviewer's pen test are the
   complements).

9b. **Seed the deterministic band IN THIS PASS — `--all` ingest, then reconcile**
   (Phase 1/2 of `docs/roadmap-deterministic-findings.md`). The families this pass ran
   have now written their evidence JSONs under `.security-review/evidence/`. Fold every
   recognized scanner output into the deterministic band right here — this closes EVERY
   entry mode: on a journey run the static substrate does it EARLY (so the band is
   seeded before the first audit pass), the live tail does it again over whatever the
   tail added, and a standalone sweep does it so a single cold run is meaningful on
   its own:

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/harness/ingest-scanner-findings.mjs --all --target <target>
   node ${CLAUDE_PLUGIN_ROOT}/harness/reconcile-provenance.mjs --target <target>
   node ${CLAUDE_PLUGIN_ROOT}/harness/apply-dispositions.mjs --target <target>
   ```

   `--all` ALWAYS runs the metadata source scan and recognizes every other scanner output
   present by CONTENT SHAPE (never filename) — Code Analyzer + the OSS SAST / secret /
   dependency-CVE / IaC-misconfig families this phase just produced — ingesting each as a
   `provenance:'deterministic'` finding. `reconcile-provenance.mjs` then demotes any
   co-located `llm-inferred` finding a scanner now OWNS (gitleaks / detect-secrets own
   `hardcoded-secrets`; Code Analyzer / metadata own crud-fls / sharing / viewall; the
   SAST + dependency-CVE adapters own no class, so they only ADD to the band). **When no
   `code-analyzer-*.json` is present, `--all` reports CRUD/FLS + sharing as
   PENDING-OWNER-RUN (never LLM-fill, never drop) — exactly the audit-codebase Step 4
   contract.**

   One format-C exception: the Family-7 ReDoS evidence (`redos-<date>.txt`) is the
   tool's verbatim TEXT, so `--all` does not auto-recognize it — ingest it with the
   explicit `--scanner regexploit --input evidence/redos-<date>.txt` form (shown in
   Family 7) alongside the `--all` run; reconcile then covers it like every other
   deterministic finding.

   **Design note (in-pass ingest+reconcile, NOT a re-audit).** On a journey run the
   EARLY static substrate is what flips the deterministic families from PENDING to
   real findings BEFORE the first audit — the audit's own `--all` ingest then reads
   that evidence on its FIRST pass, so nothing waits for a re-audit. The ingest at
   the live tail (and on a standalone sweep) is the same machinery closing the same
   loop for the families that legitimately run late — the deliberate choice over
   re-running the whole `audit-codebase` pass after scans, which would double the
   expensive LLM fan-out for no new signal. Both harnesses are pure + idempotent and
   finding-neutral on re-run (stable ids dedup; reconcile only demotes, and a
   deterministic finding never supersedes another deterministic one), so running
   `--all` + reconcile at the substrate tail, again at the live tail, and again at
   audit Step 4 / Step 6 is safe — the band is byte-stable run-to-run.

   `apply-dispositions.mjs` then RE-APPLIES any structured deterministic-class
   adjudications already recorded in
   `<target>/.security-review/deterministic-dispositions.json` (written by the audit
   when it adjudicates a scanner class false-positive/accepted-risk — see
   audit-codebase Step 6), so a standalone scan pass's band is honest too: a
   re-ingested finding of an adjudicated class lands `confirmed` and is immediately
   flipped back to its dispositioned status. Absent file → clean no-op; pure +
   idempotent; it NEVER flips an `llm-inferred` finding, never moves anything into
   the open band, never sets `fixed`.

10. **Fold everything into one dossier.** Instantiate
   `${CLAUDE_PLUGIN_ROOT}/templates/fp-dossier.md.tmpl` at
   `<target>/docs/security-review/fp-dossier.md` (or update it
   incrementally). The template's per-finding structure mirrors the official
   False Positive Documentation template's field list (login-gated; baseline
   `artifact-fp-documentation-format` — verified): official fields first
   (Vulnerability Name, Detected By, Detailed explanation, Evidence,
   References, the reviewer-reserved section), toolkit value-add fields in
   the marked Supplementary section — so the filled dossier drops into the
   wizard's FP slot without reformatting, and a wrong FP format never costs
   the review cycle. One dossier across all eight families: register row plus a
   per-finding block with all four required parts (flagged issue at
   file:line, functional explanation, the concrete mitigation, technical
   non-exploitability argument with evidence). Where the audit ledger
   already refuted the same pattern, reuse its reasoning/evidence verbatim —
   that is what the ledger is for. **Single source of truth for deterministic
   findings:** a dossier FP row for a `provenance:'deterministic'` finding
   MUST correspond to a disposition entry in
   `<target>/.security-review/deterministic-dispositions.json` — the entry's
   `reason` IS the dossier row's justification, and `apply-dispositions.mjs`
   flips the ledger from the same entry, so a dossier FP and a ledger
   refutation can never disagree. Author the dossier row FROM the disposition
   entry (write the entry first if it does not exist), never as free-standing
   prose. Never downgrade an exploitable finding to
   "false positive" to dodge a fix; an Accepted-residual disposition always
   carries an owner signature the agent cannot supply. **Exit bar: zero
   undispositioned findings** — the undocumented finding is the bounce, not
   the finding itself (baseline: `scan-false-positive-documentation`,
   `scan-no-clean-scan-required`).

11. **Verify evidence on disk, then report status VERBATIM.** List
   `.security-review/evidence/` and confirm each selected family's files
   exist before stating any family's status; append a dated entry to
   `.security-review/run-log.md` (what ran, tool versions, repo commit, what
   is PENDING owner-run). **Then render the scan-status summary and print it
   VERBATIM** — assemble this run's evidence mapping and build the index
   (`node ${CLAUDE_PLUGIN_ROOT}/harness/build-evidence-index.mjs --repo <target>
   --date <date> --input <evidence-input.json>`), then render
   `node ${CLAUDE_PLUGIN_ROOT}/harness/render-scan-status.mjs --target <target>
   --commit <repo HEAD> --tools "<tool versions>"`. It emits the FIXED 8-row Family
   table in canonical Family 1–8 order with locked columns `Family | Applies | Runner |
   Status | Evidence file | Gate id | Next command if PENDING`, rendered from the
   evidence `index.json` + the scope manifest (the manifest drives the Applies column).
   Print its stdout verbatim — never hand-rebuild the table, reorder the families, or
   drop a column. The readiness rule it enforces: a family reads **DONE only with the
   report file on disk** — a generated plan with no
   report is PARTIAL, full stop. `/sf-security-review-toolkit:compile-submission`
   lints for HAVE-without-evidence and demotes it, but the lie should never
   be written in the first place (CONVENTIONS §2).

## Failure modes that cost a review cycle

| Failure | Why it bites | Guard |
|---|---|---|
| Scanning a staging target that differs from production | The reviewer attacks production-equivalent infrastructure; evidence from a softer target (debug on, different auth, no edge) proves nothing and the delta surfaces as their finding, not yours | Same build, same hardening, debug off (baseline: `dast-endpoints-production-mode`); record which deployment was scanned in `run-notes.md` |
| DAST without authentication — or silently de-authenticated mid-scan | Covers only the public shell; an expired token mid-run degrades everything after it to anonymous while still printing a green report | Authenticated context is the requirement (baseline: `dast-authenticated-scans`); token lifetime > scan window; poll re-verification for session logins |
| Screenshot/report that doesn't show the URL | The reviewer cross-checks scan evidence against the architecture doc's endpoint list; proof that doesn't bind report-to-endpoint reads as no proof | Capture must visibly show target URL + scan date (baseline: `dast-screenshot-proof-of-scanned-url`) |
| Evidence older than the freshness expectation at submission | The validity window is not codified, which cuts both ways — stale-looking reports invite a bounce | Re-run the cheap scans (Code Analyzer, SSL Labs, dependency audit) at compile time; flag owner-run reports older than ~30 days for refresh (baseline: `scan-report-freshness`) |
| Report from three fixes ago | A report that predates the fixes it claims drove neither matches the submitted commit nor the dossier | Re-scan after fixes; record the repo commit alongside each report in the run log |
| Marking the scan row HAVE with a plan but no report | **Forbidden.** "Plan generated" is agent work; "scan executed" is owner work with a report file — conflating them is the exact dishonesty CONVENTIONS §2 exists to prevent | Step 8's on-disk check; the tracker's HAVE-requires-evidence contract |
| Blind scan through a CDN/WAF edge | Bot rules mangle probes, rate limits throttle the crawl, the report is noise — and the scan pages whoever watches the security alerts | Edge-handling decision per `${CLAUDE_PLUGIN_ROOT}/harness/zap/README.md`: scan an edge-free production-equivalent deployment, or temporarily allowlist the scanner and revert (documented in run notes) |

## Automated vs. manual recap

**Automated:** family selection from the manifest, baseline currency and
conflict surfacing, Code Analyzer install check + scan + parsing, dependency
scans + register drafting, SSL Labs API evidence, ZAP plan generation +
load validation, report parsing and FP-class matching, dossier drafting,
evidence-file verification, run-log entries.
**Owner-run:** the Partner Security Portal scan (login, listing link, the
three budgeted runs, report download), executing the DAST scan
(authorization, token minting, edge allowlist, the re-scan), every code
fix, dependency upgrades, and confirming each FP justification and signing
every accepted residual — an agent cannot certify non-exploitability.
Salesforce pen-tests the surface regardless of all of it.

## What feeds the next skill

The evidence files, the dossier, and the vulnerability register feed the
checklist rows and readiness verdict in
`/sf-security-review-toolkit:compile-submission` (which re-runs the cheap
scans when stale and demotes HAVE rows lacking evidence). The
production-mode verification carries into
`/sf-security-review-toolkit:prepare-test-environment` — the reviewer
attacks the same endpoints the DAST did, with the credentials that phase
stages. Findings fixed here belong in the audit ledger so the next
`/sf-security-review-toolkit:audit-codebase` pass doesn't re-report them.

Step 9b already seeded the deterministic band IN THIS PASS — `--all` ingested
every scanner output the pass produced and `reconcile-provenance.mjs` demoted the
co-located LLM duplicates. On a journey run the **static substrate** is the pass
that matters most here: it runs BEFORE the audit, so the audit's own deterministic
pass (`harness/ingest-scanner-findings.mjs --all`) reads the SAME evidence
(`evidence/code-analyzer-<date>.json` et al.) on its FIRST fan-out — stable ids
dedup, so re-ingest never duplicates and the band recurs identically run-to-run
(`docs/roadmap-deterministic-findings.md` Phase 1). The live tail and any
standalone sweep flip whatever remained. So running THIS phase is what flips the
CRUD/FLS + sharing classes from PENDING-OWNER-RUN to deterministic — the
replacement for the unstable LLM-only blocker sample.

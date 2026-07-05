#!/usr/bin/env node
/*
 * ingest-scanner-findings.mjs — turn DETERMINISTIC scanner / metadata output into
 * provenance-tagged `deterministic` audit-ledger findings (Phase 1 · Slice 1 of
 * docs/roadmap-deterministic-findings.md — the ingest foundation).
 *
 * WHY this exists. A 5-run cold campaign proved the LLM-generated blocker band is
 * unstable run-to-run (CRUD/FLS findings flickered high·high·ABSENT·high·high). Yet
 * Code Analyzer (PMD/SFGE) finds those exact bugs DETERMINISTICALLY every run — its
 * output just never reached the ledger. This engine is that missing path: a scanner
 * finding becomes a ledger finding with provenance:'deterministic', the engine +
 * ruleId that fired, and a severity taken from the REQUIREMENT CLASS (not the LLM,
 * and not the scanner's own 1-5 number). The LLM stops being the source of truth for
 * anything an engine already determined.
 *
 * PLUGGABLE ADAPTER REGISTRY (so Semgrep / OSV / gitleaks / Checkov land as a new
 * adapter object, never a rewrite). Every adapter is the SAME shape:
 *
 *   { name, kind, collect({input,target}) -> raw|null, parse(raw) -> hits[], classify(ruleId) -> classKey|null }
 *
 * Two adapter KINDS, both shipped in Slice 1 to prove the seam handles N>1 and both:
 *   - file-parser   — collect() reads a scanner's CAPTURED output file (--input).
 *                     Adapter #1: `code-analyzer` (PMD + SFGE violations JSON).
 *                     Adapter #3 (Phase 2 · 2a #1): `checkov` (IaC-misconfig JSON; engine:'checkov').
 *                     Adapter #4 (Phase 2 · 2a #2): `semgrep` (multi-language SAST JSON;
 *                       engine:'semgrep') — the FIRST tool→band adapter (severity from the
 *                       tool's own ERROR/WARNING/INFO, owns no toolkit class). B5 · E0.1
 *                       (0.8.57): a taint-mode result's `extra.dataflow_trace` — the
 *                       source→sink dataflow path the engine computed — is captured as a
 *                       `reachabilityPath` attribute (+ `reachable:true`) on the finding;
 *                       an absent/malformed trace attaches NOTHING (attribute capture only —
 *                       no id/severity/band/reasoning change, every trace-less finding is
 *                       byte-identical).
 *                     Adapter #5 (Phase 2 · 2a #3): `bandit` (Python SAST JSON; engine:'bandit')
 *                       — the SECOND tool→band adapter, the proof the Semgrep tool→band path
 *                       GENERALIZES (severity from HIGH/MEDIUM/LOW, owns no class, NO harness change).
 *                     Adapter #6 (Phase 2 · 2a #4): `njsscan` (Node SAST JSON; engine:'njsscan')
 *                       — the THIRD tool→band adapter (severity from ERROR/WARNING/INFO, owns no
 *                       class, NO harness change), the FIRST with a DIFFERENT input shape: a nested
 *                       object `{nodejs:{…},templates:{…}}` keyed by rule_id, NOT a flat results[].
 *                     Adapter #7 (Phase 2 · 2a #5): `gitleaks` (hardcoded-secrets JSON;
 *                       engine:'gitleaks') — a DESIGN PIVOT BACK to CLASS-severity (like checkov, NOT
 *                       tool→band): a secret carries no tool-severity tier, so severity comes from the
 *                       `fail-hardcoded-secrets` CLASS (major → high). UNIQUE in two ways: (1) it owns a
 *                       class AND a REAL methodology dimension (`secrets-credentials`), so it SUPERSEDES
 *                       a co-located LLM secrets finding — the first adapter to enforce "the LLM does not
 *                       re-report what the scanner determined" for its class; (2) gitleaks output carries
 *                       the LIVE secret (Match/Secret) plus commit PII (Author/Email/Message), so the
 *                       adapter is built to emit a finding from ONLY non-sensitive fields and NEVER pass
 *                       any of those downstream (§3 of the slice — the secret-never-leaks invariant).
 *                     Adapter #8 (Phase 2 · 2a #6): `detect-secrets` (hardcoded-secrets JSON;
 *                       engine:'detect-secrets') — the secrets SIBLING of gitleaks. It REUSES the
 *                       `hardcoded-secrets` class (NO new CLASS_DEFS entry, NO buildFinding change): a
 *                       class-severity adapter, severity from `fail-hardcoded-secrets` (major → high). Two
 *                       new things only: (a) detect-secrets' OWN nested-object JSON `{results:{<file>:[…]}}`
 *                       keyed by FILE (NOT gitleaks' flat array), so its own `parse`; (b) it carries a
 *                       `hashed_secret` (a SHA) and, under `--show-secrets`, could carry plaintext — the
 *                       same secret-never-leaks invariant applies (emit ONLY `type`/file/`line_number`,
 *                       never the hash or plaintext). With TWO secrets engines now live, the same secret at
 *                       one locus produces TWO deterministic ledger rows — visible, the SAFE under-merge;
 *                       collapsing them is cross-engine dedup = §10 extension #3 (Phase-2b), NOT this slice.
 *                     Adapter #9 (Phase 2 · 2a #7): `osv` (dependency-CVE / SCA JSON; engine:'osv') — the
 *                       SEVENTH §10 adapter and **Extension A: the CVSS→enum severity fork**. A dep CVE
 *                       carries a REAL CVSS base score, while the only CLASS severity (scan-external-sca =
 *                       major) is a *missing-scan* GATE severity — so the per-FINDING band is PER-ADVISORY
 *                       (`severityKind:'advisory'`), resolved from the advisory's CVSS via
 *                       CVSS_SCORE_TO_FINDING, and the class governs ONLY the gate. It REUSES the
 *                       `bandFromTool` path EXACTLY like semgrep/bandit/njsscan (the band SOURCE is the only
 *                       difference: CVSS, not a tool tier), so the ONLY shared-code change is the additive
 *                       `gateLabel` parameter in buildFinding (whose default preserves the SAST output
 *                       byte-for-byte). Severity priority per vuln: numeric group `max_severity` → the vuln's
 *                       `database_specific.severity` LABEL → `medium` (a known CVE of unknown severity is
 *                       still real). dep-CVEs have no file:line (locus = the lockfile/package); classify()→null
 *                       so it owns no class and supersedes nothing (cross-engine dedup with npm/Trivy = §10
 *                       extension #3, Phase-2b).
 *                     Adapter #10 (Phase 2 · 2a #8): `npm-audit` (Node dependency-CVE JSON; engine:'npm-audit') —
 *                       the EASY Extension-A REUSE. `npm audit --json` (auditReportVersion 2) gives a DIRECT
 *                       severity LABEL per vulnerable package (`critical/high/moderate/low/info`) — no CVSS math —
 *                       so the band comes straight from NPM_SEVERITY_TO_FINDING, exactly like OSV's label-fallback
 *                       path. It REUSES the `bandFromTool` path, the `gateLabel` param, the `dependency-cve`
 *                       dimension, and classify()→null EXACTLY like OSV — so there is NO buildFinding/CLASS_DEFS
 *                       change (gateLabel already exists), only the ADAPTERS registry line. It is gated by
 *                       `scan-dependency-vulnerabilities` (applies_to all, major — the npm-deps gate, distinct from
 *                       OSV's scan-external-sca). One finding per vulnerable package (npm keys by package); `via`
 *                       supplies the advisory title/url (a STRING via-entry is a transitive chain, an OBJECT via-
 *                       entry is the direct advisory). Unknown/blank severity → medium (judgment call, as OSV).
 *                       With two dep-CVE engines now live, OSV+npm-audit can flag the SAME CVE — the duplicate is
 *                       visible (the SAFE under-merge); collapsing it is §10 extension #3 (Phase-2b).
 *                     Adapter #11 (Phase 2 · 2a #9): `trivy` (IaC-misconfig JSON; engine:'trivy') — the multi-mode
 *                       scanner, done CONFIG-mode only this slice (the only mode with a captured fixture). A Trivy
 *                       `Class:'config'` finding is the SAME vuln class as Checkov, so it REUSES the `iac-misconfig`
 *                       class (NO new CLASS_DEFS, NO buildFinding change — like detect-secrets reused
 *                       `hardcoded-secrets`): a CLASS-severity adapter at class `high`, NOT a tool→band path. The
 *                       parse is CLASS-DISPATCH (forward-compatible): it handles `Class:'config'` now and SKIPS the
 *                       vuln (os-pkgs/lang-pkgs) and `secret` classes (Phase-2b — no fixtures yet). CONSISTENCY CALL:
 *                       Trivy DOES carry a per-misconfig Severity, but for the same class to be consistent across
 *                       engines it lands at class-severity exactly like Checkov (its Severity recorded in the message
 *                       for reference, never moving the band) — a per-tool-severity refinement for `iac-misconfig`
 *                       (Checkov + Trivy both) is the same Phase-2b item flagged at Checkov. Trivy + Checkov flag the
 *                       SAME Dockerfile misconfig (DS-0026 ↔ CKV_DOCKER_2) → two visible rows; collapsing = §10 ext #3.
 *                     Adapter #12 (residual-shrinking · B5 #1): `regexploit` (ReDoS / catastrophic-
 *                       backtracking-regex TEXT output; engine:'regexploit') — the FIRST format-C
 *                       (non-JSON) adapter. regexploit emits human-readable text ONLY (its output/
 *                       text.py is the package's only writer — no JSON/JSONL exists), so the evidence
 *                       file is the tool's VERBATIM stdout (evidence/redos-<date>.txt), this adapter
 *                       parses that format, and `--all` (which enumerates evidence/*.json and
 *                       JSON-parses each) does NOT auto-recognize it — a DOCUMENTED limitation that
 *                       beats a lossy wrapper format; the explicit `--scanner regexploit --input`
 *                       path ingests it. `detect(raw)` matches only the raw TEXT shape (a string
 *                       carrying the tool's own markers) and is an honest false for every parsed-JSON
 *                       shape. Tool→band via REDOS_DEGREE_TO_FINDING (exponential → high; polynomial
 *                       degrees → medium; unknown → medium) — NEVER critical/blocker from the tool
 *                       alone: the scanner proves the PATTERN is catastrophic, and whether attacker-
 *                       controlled input REACHES it is the reachability residual (the semgrep
 *                       ERROR→high ceiling precedent). classify()→null — see the adapter comment for
 *                       WHY owning a class here would be a correctness hazard (resource-consumption-
 *                       abuse is a MULTI-SHAPE dimension). Gated by `resource-consumption-abuse`
 *                       (the RCA baseline id, major — the osv gateLabel-param precedent).
 *                     Adapter #13 (B5 · E0.2b, 0.8.61): `sarif` (SARIF 2.1.0 JSON; engine from
 *                       `run.tool.driver.name`, NEVER hardcoded — 'opengrep'/'semgrep'/'codeql') —
 *                       the VERSION-PORTABLE reachability surface: SARIF `codeFlows` is the
 *                       OASIS-standardized taint-path serialization, normalized by
 *                       _sarifReachabilityPath into the SAME `reachabilityPath` shape as the
 *                       semgrep-JSON dataflow_trace path (one normal form across engines).
 *                       Tool→band from result `level` (via the rule's defaultConfiguration
 *                       fallback); the same per-hit CWE routing (rule properties.tags); classify()
 *                       → null. `--all` now also enumerates evidence/*.sarif.
 *                     Adapter #14 (B5 · E0.2b, 0.8.61): `opengrep` (engine:'opengrep') — the honest
 *                       engine label for Opengrep --json output, which is content-INDISTINGUISHABLE
 *                       from semgrep's (verified on the fixture pair): parse delegates to
 *                       semgrepAdapter verbatim + re-labels the engine; NO detect (the format
 *                       recognizer honestly says 'semgrep'; the explicit --scanner form and
 *                       ingestAll's documented opengrep-* evidence-name refinement carry provenance).
 *   - source-scanner — collect() greps the repo source directly (no external tool).
 *                     Adapter #2: `metadata-viewall` (engine:'metadata') — scans
 *                     permissionsets/*.permissionset-meta.xml for ViewAll/ModifyAll
 *                     over-grants, the one class Code Analyzer doesn't cover (it's
 *                     permission-set XML, not Apex).
 *                     Adapter #15 (B5 · E0.3b-1, 0.8.66): `egress-plain-http`
 *                       (engine:'metadata') — scans the package's declarative
 *                       egress-config metadata (*.remoteSite-meta.xml <url>,
 *                       *.cspTrustedSite-meta.xml <endpointUrl>,
 *                       *.namedCredential-meta.xml <endpoint> legacy /
 *                       <parameterValue> where the sibling <parameterType> is Url,
 *                       modern) and flags every endpoint declared over plain
 *                       http:// — the codified Secure Communication violation
 *                       (class `plain-http-egress` → endpoint-https-only, high,
 *                       dimension package-metadata). Scheme-anchored (https://
 *                       never flags) and element-scoped (an http:// inside a
 *                       <description> never flags).
 *                     Adapter #16 (B5 · E0.3c-1, 0.8.67; reframed 0.8.68):
 *                       `view-modify-all-data`
 *                       (engine:'metadata') — scans *.permissionset-meta.xml AND
 *                       *.profile-meta.xml for the org-wide ViewAllData /
 *                       ModifyAllData system permission granted via
 *                       <userPermissions> with <enabled>true</enabled> — a
 *                       least-privilege ADVISORY (class `view-modify-all-data`
 *                       → least-privilege-permission-grants, informational →
 *                       info, dimension admin-surface; OFF the blocker floor):
 *                       user permissions are excluded from managed-package
 *                       permsets/profiles at install, so a packaged grant may
 *                       not reach subscribers — verify the effective grant.
 *                       Exact-name + enabled-required +
 *                       element-scoped; covers the gap metadata-viewall leaves
 *                       (system <userPermissions>, and profiles, which that scan
 *                       never reads) — the two are disjoint, no double-report.
 *                     Adapter #17 (B5 · E0.3b-2, 0.8.69):
 *                       `remote-site-protocol-security` (engine:'metadata') —
 *                       scans *.remoteSite-meta.xml for
 *                       <disableProtocolSecurity>true</disableProtocolSecurity>,
 *                       the Remote Site Setting flag that permits code to pass
 *                       data between an HTTPS session and an HTTP session (a
 *                       transport downgrade) — the codified Secure Communication
 *                       violation (class `protocol-security-disabled` →
 *                       endpoint-https-only, high, dimension package-metadata).
 *                       True-required (an explicit false element, the platform
 *                       default, never flags) and element-scoped (a
 *                       <description> mention never flags). Disjoint from
 *                       egress-plain-http (a DIFFERENT flag on the same file
 *                       type: that adapter reads <url> schemes, this one reads
 *                       the protocol-security element — no double-report).
 *                     Adapter #18 (B5 · E0.3c-2, 0.8.70):
 *                       `admin-privilege-grant` (engine:'metadata') — scans
 *                       *.permissionset-meta.xml AND *.profile-meta.xml for the
 *                       high-risk ADMIN/PRIVILEGE system permissions —
 *                       ManageUsers / AuthorApex / CustomizeApplication /
 *                       ModifyMetadata — granted via <userPermissions> with
 *                       <enabled>true</enabled> — a least-privilege ADVISORY
 *                       (class `admin-privilege-grant` →
 *                       least-privilege-permission-grants, informational →
 *                       info, dimension admin-surface; OFF the blocker floor):
 *                       user permissions are excluded from managed-package
 *                       permsets/profiles at install, so a packaged grant may
 *                       not reach subscribers — verify the effective grant.
 *                       Exact-name + enabled-required + element-scoped;
 *                       view-modify-all-data's sibling (that class covers the
 *                       org-wide DATA-access perms ViewAllData/ModifyAllData;
 *                       this one covers the admin/privilege perms — the two
 *                       Sets are disjoint, no double-report).
 *
 * The core `ingest(raw, adapter, {repoRoot, pass})` is PURE (no Date / Math.random /
 * network; byte-deterministic given `raw`) — `collect()` is the only I/O seam, so the
 * standing test drives `ingest` on in-memory fixtures. Re-ingesting the same scanner
 * output is idempotent: a deterministic finding's id is stable from engine+ruleId+file:line,
 * so the merge dedups it (no duplicates).
 *
 * SCOPE: ingest + a Security/AppExchange TAG FILTER (Slice 2) — the three wobbled
 * classes (CRUD/FLS, sharing, ViewAll/ModifyAll) get provenance + class-severity, and a
 * MAPPED finding also carries its toolkit `class` (the owned-class label the supersession
 * engine reads). Only a Security/AppExchange-tagged Code Analyzer rule becomes a finding
 * (raw CA output is dominated by ApexDoc/naming/codestyle/Performance noise) — this is a
 * filter on non-security NOISE, NOT a drop of a security finding: an unmapped *security*
 * rule is still ingested as deterministic (never silently dropped) with the documented
 * Code-Analyzer-severity fallback. LLM-supersession ENFORCEMENT (a deterministic finding
 * supersedes a co-located same-class LLM finding) lives in its own pure engine,
 * harness/reconcile-provenance.mjs (Slice 2); journey re-sequencing is Slice 3.
 *
 * Read-only on partner source except the ledger it merges into
 * (<target>/.security-review/audit-ledger.json).
 *
 * Usage:
 *   node ingest-scanner-findings.mjs --scanner code-analyzer  --input CodeAnalyzer.json --target <repo> [--json] [--dry-run] [--pass N]
 *   node ingest-scanner-findings.mjs --scanner metadata-viewall                          --target <repo> [--json] [--dry-run] [--pass N]
 *   node ingest-scanner-findings.mjs --scanner egress-plain-http                         --target <repo> [--json] [--dry-run] [--pass N]
 *   node ingest-scanner-findings.mjs --scanner view-modify-all-data                      --target <repo> [--json] [--dry-run] [--pass N]
 *   node ingest-scanner-findings.mjs --scanner remote-site-protocol-security             --target <repo> [--json] [--dry-run] [--pass N]
 *   node ingest-scanner-findings.mjs --scanner admin-privilege-grant                     --target <repo> [--json] [--dry-run] [--pass N]
 *   node ingest-scanner-findings.mjs --scanner checkov         --input checkov.json       --target <repo> [--json] [--dry-run] [--pass N]
 *   node ingest-scanner-findings.mjs --scanner semgrep         --input semgrep.json       --target <repo> [--json] [--dry-run] [--pass N]
 *   node ingest-scanner-findings.mjs --scanner bandit          --input bandit.json        --target <repo> [--json] [--dry-run] [--pass N]
 *   node ingest-scanner-findings.mjs --scanner njsscan         --input njsscan.json       --target <repo> [--json] [--dry-run] [--pass N]
 *   node ingest-scanner-findings.mjs --scanner gitleaks        --input gitleaks.json      --target <repo> [--json] [--dry-run] [--pass N]
 *   node ingest-scanner-findings.mjs --scanner detect-secrets  --input detect-secrets.json --target <repo> [--json] [--dry-run] [--pass N]
 *   node ingest-scanner-findings.mjs --scanner osv             --input osv.json            --target <repo> [--json] [--dry-run] [--pass N]
 *   node ingest-scanner-findings.mjs --scanner npm-audit       --input npm-audit.json      --target <repo> [--json] [--dry-run] [--pass N]
 *   node ingest-scanner-findings.mjs --scanner trivy           --input trivy.json          --target <repo> [--json] [--dry-run] [--pass N]
 *   node ingest-scanner-findings.mjs --scanner regexploit      --input redos.txt           --target <repo> [--json] [--dry-run] [--pass N]
 *     (regexploit evidence is VERBATIM text, not JSON — the --all mode below does not auto-recognize
 *      it; this explicit form is the ingest path for the ReDoS leg. See adapter #12.)
 *
 *   node ingest-scanner-findings.mjs --all                                                 --target <repo> [--json] [--dry-run] [--pass N]
 *     JOURNEY-WIRING mode (Phase 2, 0.8.40): ALWAYS runs the source-scanners
 *     (metadata-viewall + egress-plain-http + view-modify-all-data +
 *     remote-site-protocol-security + admin-privilege-grant, 0.8.70) +
 *     recognizes every scanner output present under <repo>/.security-review/evidence/*.json
 *     by CONTENT SHAPE (never filename) and ingests each into the deterministic band in one
 *     pass. Mutually exclusive with --scanner (the per-scanner dispatch is untouched). This is
 *     what the audit Step 4 and the run-scans tail invoke so a cold run actually ingests the
 *     full OSS scanner set, not just code-analyzer + metadata.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
// B5 · item 7: the single-sourced install pin the version-drift honesty marker compares
// against (derived from BINARY_PINS — never a second version literal; see install-scanners.mjs).
import { PINNED_TOOL_VERSIONS } from './install-scanners.mjs'

// ----------------------------------------------------------------------------
// Severity taxonomies. The baseline speaks `blocker/major/minor/informational`
// (severity_if_missing); the finding schema speaks `critical/high/medium/low/info`.
// This is the single canonical conversion — there was none before this slice.
// ----------------------------------------------------------------------------
export const REQ_SEVERITY_TO_FINDING = {
  blocker: 'critical',
  major: 'high',
  minor: 'low',
  informational: 'info',
}
// Code Analyzer's own 1-5 scale (1 = most severe). Used ONLY as the fallback for a
// rule with no toolkit class mapping — never for a mapped class (whose severity is
// the requirement-class severity, full stop).
export const CA_SEVERITY_TO_FINDING = {
  1: 'critical',
  2: 'high',
  3: 'medium',
  4: 'low',
  5: 'info',
}
// Semgrep's per-finding severity (Phase 2 · 2a #2 — the FIRST genuine tool→band adapter,
// roadmap §10). Semgrep — unlike Code Analyzer / Checkov — carries a REAL per-result
// severity (`ERROR`/`WARNING`/`INFO`), so for SAST the tool's own band IS the honest
// per-finding signal: a `WARNING` SSRF is genuinely medium, not the class-`high` you'd get
// by collapsing every SAST hit to `scan-external-sast` (major). This is NOT a violation of
// severity-from-class (§9): Code Analyzer's Apex rules re-home onto the review's 3 wobbled
// CLASSES whose severity the review defines; Semgrep's general SAST rules map onto NO such
// class, so the tool band is the meaningful source. DELIBERATE calibration choice (documented
// in the CHANGELOG): `ERROR → high`, NOT critical/blocker — a raw Semgrep ERROR flags a sink
// but does NOT confirm reachability; escalating to a blocker is a reachability judgment that
// belongs to the LLM/human residual (the "reachability-is-a-precondition" rule), which a
// mechanical SAST hit lacks. An unknown/rare severity (Semgrep's `INVENTORY`/`EXPERIMENT` rule
// classes) maps to `info` — never dropped. (The toolkit's canonical invocation uses the
// security rulesets p/security-audit / p/secrets / p/<lang>, which emit only ERROR/WARNING/INFO.)
export const SEMGREP_SEVERITY_TO_FINDING = { ERROR: 'high', WARNING: 'medium', INFO: 'low' }
// Bandit's per-finding severity (Phase 2 · 2a #3 — the THIRD tool→band adapter, the proof the
// Semgrep `tool→band` generalization GENERALIZES with ZERO harness-core change). Bandit is the
// Python language-gate SAST tool (run-scans Family 7, alongside Semgrep/njsscan/gosec). It carries
// a REAL per-result `issue_severity` (`HIGH`/`MEDIUM`/`LOW`), owns no toolkit class, and groups
// under `external-sast` — exactly Semgrep's shape, so it reuses `buildFinding`'s `bandFromTool`
// path verbatim. Same calibration call as Semgrep `ERROR→high`: `HIGH → high`, NOT critical/blocker
// — a mechanical SAST hit flags a sink but does NOT confirm reachability; blocker-escalation is the
// LLM/human residual. An unknown/missing `issue_severity` → `info`, never dropped. NOTE: Bandit also
// emits `issue_confidence` (HIGH/MEDIUM/LOW); it is NOT used for the band in this slice (the band is
// `issue_severity`, confidence is recorded only for reference) — a confidence-weighted refinement is
// a Phase-2b note, like Checkov's per-check-severity deferral.
export const BANDIT_SEVERITY_TO_FINDING = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low' }
// njsscan's per-finding severity (Phase 2 · 2a #4 — the THIRD genuine tool→band adapter, the
// FIRST with a DIFFERENT input shape). njsscan is the Node language-gate SAST tool (run-scans
// Family 7, alongside Semgrep/Bandit/gosec). It carries a REAL per-finding `severity`
// (`ERROR`/`WARNING`/`INFO`), owns no toolkit class, and groups under `external-sast` — the same
// severity model as Semgrep, so it REUSES `buildFinding`'s `bandFromTool` path with ZERO
// harness-core change. The ONLY new shape is njsscan's nested-object JSON (`{nodejs:{…},
// templates:{…}}`, each section keyed by rule_id), NOT a flat `results[]` — hence its own `parse`.
// Same calibration call as Semgrep/Bandit: `ERROR → high`, NOT critical/blocker — a mechanical SAST
// hit flags a sink but does NOT confirm reachability, which is the LLM/human residual. An
// unknown/missing `severity` → `info`, never dropped. (Even though this map EQUALS
// SEMGREP_SEVERITY_TO_FINDING, njsscan is a distinct tool, so it carries its own named map per the
// per-tool idiom.) NOTE: njsscan's `node_secret` rule (CWE-798 hardcoded secret) OVERLAPS the
// secrets class the future gitleaks/detect-secrets (`fail-hardcoded-secrets`) adapters will own;
// here it ingests as an `external-sast` tool→band finding — de-duplicating it against a co-located
// secrets-scanner finding is cross-engine dedup = roadmap §10 extension #3 (Phase-2b), NOT this
// slice (the SAFE under-merge — a duplicate may survive in the band, never a dropped finding).
export const NJSSCAN_SEVERITY_TO_FINDING = { ERROR: 'high', WARNING: 'medium', INFO: 'low' }
// SARIF's per-result `level` (B5 · E0.2b — the version-portable `sarif` adapter). SARIF 2.1.0
// defines exactly `error`/`warning`/`note` (+ `none`) as the result-level vocabulary, and every
// SARIF-emitting SAST engine (opengrep / semgrep / codeql) serializes its own tier onto that
// scale (opengrep/semgrep: ERROR→error, WARNING→warning, INFO→note — verified on the captured
// fixtures), so `error → high` here IS the same calibration call as SEMGREP_SEVERITY_TO_FINDING's
// `ERROR → high` (never critical/blocker — reachability stays the labelled residual even when the
// SAME result carries a codeFlows trace; the trace is attribute capture, not band escalation).
// A result with no own `level` inherits its rule's `defaultConfiguration.level` (the SARIF
// defaulting chain — both captured fixtures use it); unknown/absent after that → `info`, never dropped.
export const SARIF_LEVEL_TO_FINDING = { error: 'high', warning: 'medium', note: 'low', none: 'info' }
// OSV-Scanner's per-advisory severity (Phase 2 · 2a #7 — the dependency-CVE scanner, run-scans Family 8
// over every lockfile under a non-package source root). This is **Extension A: the CVSS→enum severity fork**
// (roadmap §10 extension #1) — the FIRST adapter whose severity is neither a toolkit CLASS (checkov/secrets)
// nor a tool TIER (semgrep/bandit/njsscan's ERROR/WARNING/INFO), but a per-advisory CVSS base score. A dep
// CVE carries a REAL CVSS, while the only CLASS severity (scan-external-sca = major) is a *missing-scan*
// GATE severity — so the per-FINDING band comes from the advisory's CVSS, and the class governs ONLY the
// gate. `CVSS_SCORE_TO_FINDING` is the industry-standard CVSS 3.x qualitative scale (≥9.0 critical · ≥7.0
// high · ≥4.0 medium · >0 low · 0 info); a non-numeric/absent score → `null` so the caller can fall through.
// `OSV_LABEL_TO_FINDING` maps OSV's `database_specific.severity` LABEL when no numeric score exists (GitHub's
// CRITICAL/HIGH/MODERATE/LOW; MEDIUM accepted as a MODERATE synonym). Severity PRIORITY per vulnerability
// (see osvAdapter): (1) numeric `max_severity` of the package `group` that contains this vuln id →
// CVSS_SCORE_TO_FINDING; (2) else the vuln's database_specific.severity LABEL → OSV_LABEL_TO_FINDING; (3)
// else `'medium'` — a known CVE of UNKNOWN severity is still a real finding, and the conservative middle
// (NOT info, NOT the gate's high) neither over- nor under-states it. This is `severityKind:'advisory'` in
// roadmap terms; it REUSES `buildFinding`'s `bandFromTool` path (the band is just resolved from CVSS instead
// of a tool tier), the ONE additive harness tweak being the parameterized `gateLabel` (scan-external-sca).
export const CVSS_SCORE_TO_FINDING = (score) => {
  // ABSENT/BLANK → null so the caller FALLS THROUGH to the label → 'medium' path (judgment call #1:
  // an UNSCORED CVE is 'medium', NOT 'info'). This guard is load-bearing: `Number('') === 0` and
  // `Number(null) === 0` are both FINITE, so without it an unscored advisory — OSV-Scanner emits
  // `max_severity:""` when no CVSS exists — would mis-map to 'info' and silently downgrade a real CVE.
  // An EXPLICIT numeric zero (`'0'`/`'0.0'`, a genuinely 0.0-scored CVE) is NOT blank → still 'info'.
  if (score == null || String(score).trim() === '') return null
  const n = Number(score)
  if (!Number.isFinite(n)) return null
  if (n >= 9.0) return 'critical'
  if (n >= 7.0) return 'high'
  if (n >= 4.0) return 'medium'
  if (n > 0.0) return 'low'
  return 'info'
}
export const OSV_LABEL_TO_FINDING = { CRITICAL: 'critical', HIGH: 'high', MODERATE: 'medium', MEDIUM: 'medium', LOW: 'low' }
// npm audit's per-package severity LABEL (Phase 2 · 2a #8 — the dependency-CVE scanner for Node, run-scans
// Family 8 alongside OSV). This is the EASY Extension-A REUSE: `npm audit --json` (auditReportVersion 2) gives a
// DIRECT severity LABEL per vulnerable package — no CVSS math — so the band comes straight from this map, exactly
// like OSV's label-fallback path (OSV_LABEL_TO_FINDING) and unlike the SAST tool-tier maps or the class-severity
// adapters. npm's own spelling is lowercase and uses `moderate` (NOT `medium`); it carries its OWN named map per
// the per-tool idiom — do NOT reuse OSV's UPPERCASE map. An unknown/blank severity falls through to `medium` in the
// adapter (judgment call #1, consistent with OSV's unscored-CVE rule — a known CVE of unknown severity is real, and
// the conservative middle neither over- nor under-states it). Like OSV it REUSES buildFinding's `bandFromTool` path
// (the band SOURCE is the npm label) with ZERO buildFinding/CLASS_DEFS change — the only shared-file touch is the
// ADAPTERS registry line — and is gated by `scan-dependency-vulnerabilities` (applies_to all, major), the npm-deps
// gate (distinct from OSV's scan-external-sca; both major).
export const NPM_SEVERITY_TO_FINDING = { critical: 'critical', high: 'high', moderate: 'medium', low: 'low', info: 'info' }
// regexploit's per-pattern ambiguity degree (residual-shrinking · B5 #1 — the ReDoS scanner, run-scans
// Family 7 leg over every non-package language root). regexploit derives a `starriness` per ambiguous
// regex and prints its degree word: `exponential` (starriness > 10) or a polynomial-degree word
// (`linear`…`decic` for starriness 1–10; the tool only REPORTS starriness > 2, i.e. cubic and up, but
// the full scale is mapped so a future tool version reporting lower degrees still bands honestly).
// The map is the DEGREE → finding band: an exponential (catastrophic) pattern is `high`; a polynomial
// pattern is `medium`; an unknown/unparseable degree falls through to `medium` in the adapter (a
// scanner-proven ambiguous regex of unknown degree is still real — the conservative middle, the same
// judgment call as OSV's unscored CVE). DELIBERATE ceiling, same calibration as semgrep ERROR→high:
// NEVER critical/blocker from the tool alone — regexploit proves the PATTERN backtracks
// catastrophically; whether attacker-controlled input REACHES it is a reachability judgment that
// belongs to the LLM/human residual (the resource-consumption-abuse dimension's own rule: "the regex
// must be both catastrophic and fed untrusted input").
export const REDOS_DEGREE_TO_FINDING = {
  exponential: 'high',
  linear: 'medium',
  quadratic: 'medium',
  cubic: 'medium',
  quartic: 'medium',
  quintic: 'medium',
  sextic: 'medium',
  septic: 'medium',
  octic: 'medium',
  nonic: 'medium',
  decic: 'medium',
}

// ----------------------------------------------------------------------------
// Security/AppExchange tag filter (Slice 2 — roadmap §10 extension #2).
// Raw Code Analyzer output is dominated by NON-security rules (ApexDoc, naming,
// codestyle, Performance — one captured fixture was 23/23 best-practices). A SECURITY
// ledger must not ingest those: only a violation whose `tags` include `Security` or
// `AppExchange` becomes a finding. This is a FILTER on non-security noise — NOT a drop
// of a security finding: a security-tagged rule with no class mapping still passes here
// and ingests via the Code-Analyzer-severity fallback (the "never drop an unmapped
// SECURITY rule" rule holds). The metadata source-scanner emits only over-grants, so it
// has no filter (every emission is security by construction). SFGE's Performance-tagged
// `MissingNullCheckOnSoqlVariable` is excluded by this same rule (Performance ∌ Security).
export const SECURITY_TAGS = ['security', 'appexchange']
export function hasSecurityTag(tags) {
  if (!Array.isArray(tags)) return false
  return tags.some((t) => SECURITY_TAGS.includes(String(t).toLowerCase()))
}

// The three wobbled classes Slice 1 re-homes onto the scanners. Each carries the
// baseline requirement its severity is READ FROM (so "severity from class" literally
// tracks the baseline), a `fallback` if the baseline can't be read, and the dimension.
//   viewall-overgrant grounds its severity in fail-sharing-model because a ViewAll/
//   ModifyAll over-grant IS a sharing-rules bypass (official taxonomy + the Solano C5
//   adjudication: "viewAllRecords=true ... a sharing bypass", HIGH floor).
//   iac-misconfig (Phase 2 · adapter 2a #1, Checkov) grounds its severity in scan-iac-misconfig
//   (severity_if_missing: major → high). Its `dimension` 'infrastructure-iac' is a
//   DETERMINISTIC-ONLY grouping label: IaC misconfig is fully deterministic (Checkov/Trivy),
//   so it has NO LLM finder dimension and deliberately NO methodology/dimensions/ file — the
//   schema declares `dimension` a free kebab-case string (not an enum), and nothing validates a
//   finding's dimension against the methodology-file set, so this label needs no dimension doc.
//   hardcoded-secrets (Phase 2 · adapter 2a #5, gitleaks) grounds its severity in
//   fail-hardcoded-secrets (severity_if_missing: major → high). UNLIKE iac-misconfig's
//   deterministic-only label, its `dimension` 'secrets-credentials' is a REAL methodology
//   dimension (methodology/dimensions/secrets-credentials.md — it owns secret custody), so a
//   gitleaks finding OWNS a class AND a real dimension and therefore SUPERSEDES a co-located LLM
//   secrets-credentials finding (reconcile-provenance reads the owned class, falling back to the
//   dimension when the LLM finding carries no class). This is the same real-dimension pattern as
//   crud-fls→apex-exposed-surface, NOT the deterministic-only external-sast label — gitleaks maps
//   cleanly to one dimension, so it uses the real one. The bounded over-supersede risk (a DIFFERENT
//   secrets-credentials issue at the same overlapping line) is the same already-accepted dimension-
//   fallback risk as crud-fls/sharing (both share apex-exposed-surface); hardening is §10 ext #3.
export const CLASS_DEFS = {
  'crud-fls': { baselineId: 'fail-crud-fls', dimension: 'apex-exposed-surface', fallback: 'high' },
  'sharing': { baselineId: 'fail-sharing-model', dimension: 'apex-exposed-surface', fallback: 'high' },
  'viewall-overgrant': { baselineId: 'fail-sharing-model', dimension: 'admin-surface', fallback: 'high' },
  'iac-misconfig': { baselineId: 'scan-iac-misconfig', dimension: 'infrastructure-iac', fallback: 'high' },
  'hardcoded-secrets': { baselineId: 'fail-hardcoded-secrets', dimension: 'secrets-credentials', fallback: 'high' },
  // B5 · E0.3b-1 (0.8.66): a plain-http:// endpoint statically declared in the package's
  // egress-config metadata (RemoteSiteSetting / CspTrustedSite / NamedCredential) — the
  // codified Secure Communication violation. endpoint-https-only is major → high, and
  // package-metadata is the dimension whose charter owns the trusted-host XML flags.
  // SINGLE-SHAPE at its locus: the finding sits on the specific http:// URL line, so the
  // owned class supersedes only a co-located LLM finding at that same endpoint (correct —
  // the deterministic row is authoritative there), never a different-shape package-metadata
  // finding elsewhere in the file (sameLocation is line-span-scoped).
  'plain-http-egress': { baselineId: 'endpoint-https-only', dimension: 'package-metadata', fallback: 'high' },
  // B5 · E0.3c-1 (0.8.67; regrounded 0.8.68): the org-wide ViewAllData / ModifyAllData
  // SYSTEM permission granted (<userPermissions> with enabled=true) in a packaged
  // permission set OR profile. Reframed to a least-privilege ADVISORY (0.8.68): user
  // permissions are EXCLUDED from managed-package permission sets/profiles at install
  // (Salesforce 2GP), so a packaged grant may not reach subscribers via the package,
  // and no named AppExchange requirement auto-fails a permission grant — reviewers
  // apply least privilege case-by-case. Grounding: least-privilege-permission-grants
  // is informational → info (OFF the blocker floor — flagged for review, never a
  // submission gate); admin-surface still owns the permission-grant plane. The finding
  // advises verifying the EFFECTIVE grant (integration/running user, Guest User,
  // unmanaged/org-deployed context) and documenting a business justification.
  // SINGLE-SHAPE at its locus: the finding sits on the specific <userPermissions>
  // grant line, so the owned class supersedes only a co-located LLM finding at that
  // same grant (correct — the deterministic row is authoritative there), never a
  // different-shape admin-surface finding elsewhere in the file (sameLocation is
  // line-span-scoped).
  'view-modify-all-data': { baselineId: 'least-privilege-permission-grants', dimension: 'admin-surface', fallback: 'info' },
  // B5 · E0.3b-2 (0.8.69): a RemoteSiteSetting with <disableProtocolSecurity>true</
  // disableProtocolSecurity> — the flag that permits code to pass data between an
  // HTTPS session and an HTTP session (a transport downgrade). Exactly the transport
  // the codified Secure Communication requirement forbids, so it grounds in the SAME
  // endpoint-https-only baseline as plain-http-egress (major → high); package-metadata
  // owns the trusted-host XML flags. LOW FP: the flag defaults to false and Salesforce
  // explicitly warns against enabling it — the rare internal/localhost HTTP case is
  // dispositionable via the FP dossier, never suppressed. SINGLE-SHAPE at its locus:
  // the finding sits on the specific <disableProtocolSecurity> element line, so the
  // owned class supersedes only a co-located LLM finding at that same flag (correct —
  // the deterministic row is authoritative there), never a different-shape
  // package-metadata finding elsewhere in the file (sameLocation is line-span-scoped).
  'protocol-security-disabled': { baselineId: 'endpoint-https-only', dimension: 'package-metadata', fallback: 'high' },
  // B5 · E0.3c-2 (0.8.70): a high-risk ADMIN/PRIVILEGE system permission — ManageUsers /
  // AuthorApex / CustomizeApplication / ModifyMetadata — granted (<userPermissions> with
  // enabled=true) in a packaged permission set OR profile. view-modify-all-data's SIBLING
  // (that class covers the org-wide DATA-access perms ViewAllData/ModifyAllData; this one
  // covers the admin/privilege perms — disjoint Sets, no double-report) with the SAME
  // grounding: a least-privilege ADVISORY, never an auto-fail — user permissions are
  // EXCLUDED from managed-package permission sets/profiles at install (Salesforce 2GP),
  // so a packaged grant may not reach subscribers via the package, and no named
  // AppExchange requirement auto-fails a permission grant — reviewers apply least
  // privilege case-by-case (legitimate justifications exist: identity management →
  // ManageUsers, DevOps tooling → AuthorApex/ModifyMetadata). Grounding:
  // least-privilege-permission-grants is informational → info (OFF the blocker floor —
  // flagged for review, never a submission gate); admin-surface owns the permission-grant
  // plane. The finding advises verifying the EFFECTIVE grant (integration/running user,
  // Guest User, unmanaged/org-deployed context) and documenting a business justification.
  // SINGLE-SHAPE at its locus: the finding sits on the specific <userPermissions> grant
  // line, so the owned class supersedes only a co-located LLM finding at that same grant
  // (correct — the deterministic row is authoritative there), never a different-shape
  // admin-surface finding elsewhere in the file (sameLocation is line-span-scoped).
  'admin-privilege-grant': { baselineId: 'least-privilege-permission-grants', dimension: 'admin-surface', fallback: 'info' },
}
const DEFAULT_DIMENSION = 'apex-exposed-surface'

// The single-shape (class-owning) registry — the supersession-safety invariant made
// EXPLICIT. An adapter may OWN a class (its classify() returns a non-null CLASS_DEFS
// key) ONLY when that class is a distinct SINGLE-SHAPE finding: the deterministic row
// sits on one specific locus (the CRUD call, the http:// URL line, the <userPermissions>
// grant line), so when reconcile-provenance's class-less dimension-fallback supersedes a
// co-located LLM finding, it can only be the SAME finding at the SAME locus (sameLocation
// is line-span-scoped) — the deterministic row is authoritative there. A MULTI-SHAPE
// dimension (injection-xss, sessionid-egress, resource-consumption-abuse, external-sast,
// dependency-cve) must keep classify()→null, or a routed finding would silence a
// co-located LLM finding of a DIFFERENT shape via that same dimension-fallback. Each
// registered class carries a `*-non-supersession` standing lock in
// acceptance/test-ingest-scanner-findings.mjs (EG-/PV-/DP-/AP-non-supersession lock the
// locus-scoped owners; RD-/INJ-/SESS-non-supersession lock the null posture on the
// multi-shape dimensions; the pre-lock classes crud-fls/sharing ride the same
// locus-scoped protection with the bounded dimension-fallback risk documented above
// CLASS_DEFS). Until now this shape-decision was a silent manual invariant; the SS-*
// standing checks enforce it: every non-null classify() result MUST be registered here,
// every entry MUST be a real CLASS_DEFS key, and the registry MUST equal the actual
// owned set. Adding a class-owning adapter therefore REQUIRES adding its class here —
// a deliberate, reviewable declaration that the new class is single-shape at its locus.
export const SINGLE_SHAPE = new Set([
  'crud-fls',
  'sharing',
  'viewall-overgrant',
  'iac-misconfig',
  'hardcoded-secrets',
  'plain-http-egress',
  'view-modify-all-data',
  'protocol-security-disabled',
  'admin-privilege-grant',
])

// Scanner rule name -> toolkit class. Extend in Phase 2 (hardcoded secrets, SOQLi,
// XSS, deps). The prompt named `ApexFlsViolationRule`; the real fixtures emit
// `ApexFlsViolation` — both alias to crud-fls so neither spelling is ever dropped.
export const RULE_CLASS = {
  ApexCRUDViolation: 'crud-fls',
  ApexFlsViolation: 'crud-fls',
  ApexFlsViolationRule: 'crud-fls',
  DatabaseOperationsMustUseWithSharing: 'sharing',
  ApexSharingViolations: 'sharing',
}

// Scanner rule name -> methodology DIMENSION (RULE_CLASS's class-less sibling), for
// security-tagged Code Analyzer rules that own NO toolkit class but belong to a specific
// dimension. A rule either owns a class OR routes a class-less dimension, never both —
// the standing test asserts the two maps are disjoint. Code Analyzer v5 output carries NO
// CWE field for any engine (verified against the committed CA fixtures + the v5 output
// schema), so the CWE_TO_DIMENSION mechanism the semgrep/bandit/njsscan/sarif/opengrep
// adapters share CANNOT apply here — CA routing is by RULE NAME. A routed hit stays
// class-less (classify() reads only RULE_CLASS), takes buildFinding's dimensionHint path,
// and supersedes nothing: `sessionid-egress` is a MULTI-SHAPE dimension (package-side
// retrieval→callout plus the external-service token-passthrough / header-logging / raw-
// persistence / URL-embedding shapes), so an owned class here would let a routed
// retrieval-site finding silence a co-located LLM finding of a DIFFERENT shape via the
// reconcile-provenance dimension fallback. HONEST FLOOR: the pmd-appexchange session-id
// rules are BARE-RETRIEVAL detectors — they flag every UserInfo.getSessionId() /
// $Api.Session_ID retrieval site, including the approved on-platform uses. The routing
// makes the retrieval SITE deterministic and correctly filed under the auto-fail heading;
// whether the value actually LEAVES the platform (the egress VERDICT) stays the labelled
// LLM/human residual, as does the whole external-service side (no clean deterministic
// substrate — a generic CWE-532/CWE-200 log-exposure hit is secrets-credentials territory
// and would OVER-ROUTE into this auto-fail band). Activate a row ONLY once a genuine
// captured CA fixture emits that exact rule name (code-analyzer-sessionid-seeded.json —
// Code Analyzer core 0.48.0 / pmd engine 0.41.0 / plugin 5.13.0).
export const RULE_DIMENSION = {
  AvoidUnauthorizedGetSessionIdInApex: 'sessionid-egress', // UserInfo.getSessionId() retrieval site (Apex)
  AvoidUnauthorizedApiSessionIdInVisualforce: 'sessionid-egress', // $Api.Session_ID retrieval site (Visualforce)
  // fixture-pending (NOT active until a genuine capture emits the exact name): the formula /
  // merge-field GETSESSIONID() sibling documented at rules-pmd-appexchange.html
  //
  // ── pmd-appexchange catalog routing, high-confidence clusters (0.8.76). Every row below is
  // fixture-proven by acceptance/fixtures/code-analyzer-catalog-seeded.json — a GENUINE
  // `sf code-analyzer run --rule-selector AppExchange` capture (Code Analyzer core 0.48.0 /
  // pmd engine 0.41.0 / @salesforce/plugin-code-analyzer 5.13.0) over a seeded multi-rule
  // corpus; each key is the EXACT rule name that capture emitted. All rows stay class-less
  // (none is in RULE_CLASS) — same posture as the two session-id rows above.
  //
  // session-id retrieval-site siblings (same bare-retrieval honesty floor as the rows above —
  // the SITE is deterministic, the egress VERDICT stays the labelled LLM/human residual):
  AvoidApiSessionId: 'sessionid-egress', // $Api.Session_ID in XML metadata (e.g. a WebLink URL)
  AvoidUnauthorizedApiSessionIdInApex: 'sessionid-egress', // '{!API.Session_ID}' literal in Apex
  AvoidUnauthorizedGetSessionIdInVisualforce: 'sessionid-egress', // GETSESSIONID() merge-function (Visualforce)
  //
  // hardcoded credentials / secrets. Class-less on purpose: the OWNED `hardcoded-secrets` class
  // stays with the secret scanners (gitleaks/detect-secrets), so the routed rows never double-OWN
  // the class — a co-located LLM re-report is superseded by the OWNED secret finding (never by a
  // routed row), and co-located deterministic rows of the same dimension coexist, never hidden:
  AvoidHardcodedCredentialsInVarDecls: 'secrets-credentials', // credential-named local, literal initializer (Apex)
  AvoidHardcodedCredentialsInVarAssign: 'secrets-credentials', // credential-named local, literal re-assignment (Apex)
  AvoidHardcodedCredentialsInFieldDecls: 'secrets-credentials', // credential-named field, literal initializer (Apex)
  AvoidHardcodedCredentialsInHttpHeader: 'secrets-credentials', // literal secret in an HTTP request header (Apex)
  AvoidHardcodedCredentialsInSetPassword: 'secrets-credentials', // literal password in System.setPassword (Apex)
  AvoidHardCodedCredentialsInAura: 'secrets-credentials', // credential-named aura:attribute default (the capital-C spelling is the catalog's)
  AvoidHardcodedSecretsInVFAttrs: 'secrets-credentials', // literal secret in a Visualforce component attribute
  //
  // feature-management protection state (FeatureManagement.changeProtection → 'Unprotected' in an
  // externally-invocable context; the permission-grant plane — grounded by baseline
  // violation-feature-management-change-protection, the same heading CLASS_DEFS routes to admin-surface):
  AvoidChangeProtectionUnprotected: 'admin-surface',
  //
  // ── E0.1d-EXPAND-2 (0.8.77): the catalog's CLASS-LESS-SAFE metadata/markup clusters. Every row
  //    fixture-proven by acceptance/fixtures/code-analyzer-catalog-markup-seeded.json — a GENUINE
  //    `sf code-analyzer run --rule-selector AppExchange` capture (Code Analyzer core 0.48.0 / pmd
  //    engine 0.41.0) over a seeded corpus; each key is the EXACT rule name that capture emitted.
  //    injection-xss + oauth-identity own NO toolkit class (neither appears in any CLASS_DEFS
  //    dimension), so routing here is PURE GROUPING: a routed row supersedes nothing — both are
  //    multi-shape dimensions and every row stays class-less (the SESS posture).
  //
  // XSS construction/escaping sinks — injection-xss.md owns "the construction and the escaping"
  // and names the aura:unescapedHtml escape hatch + hand-built DOM among its framework opt-outs:
  AvoidUnescapedHtmlInAura: 'injection-xss', // <aura:unescapedHtml> escape hatch (Aura markup)
  AvoidCreateElementScriptLinkTag: 'injection-xss', // dynamic <script>/<link> DOM construction (Visualforce JS)
  //
  // connected-app OAuth config — oauth-identity.md owns redirect/callback correctness and the
  // connected-app OAuth settings surface. NOT the plain-http-egress source-scanner's territory
  // (that scanner reads only the RemoteSiteSetting/CspTrustedSite/NamedCredential suffixes), so
  // no EXP-skip-style double-report; the routed row is a grouping, and the RFC 8252 loopback
  // allowance stays a disposition concern for the dimension's FP table:
  UseHttpsCallbackUrlConnectedApp: 'oauth-identity', // OAuth callback URL over plain HTTP (connected app)
  LimitConnectedAppScope: 'oauth-identity', // connected app requesting the Full OAuth scope
  //
  // DELIBERATELY NOT ROUTED — AvoidInsecureHttpRemoteSiteSetting + AvoidDisableProtocolSecurityRemoteSiteSetting:
  // the `plain-http-egress` + `protocol-security-disabled` metadata source-scanners already flag those
  // exact patterns deterministically (they OWN the checks); routing the CA twins would double-report
  // the same locus, and cross-engine dedup for that pair is not landed. Staying unrouted (the CA
  // default dimension) is the deliberate posture, NOT a coverage gap — the EXP-skip standing check
  // locks it.
  //
  // ── E0.1d-EXPAND-3 (0.8.78): the catalog's OWNED-CLASS-DIMENSION metadata clusters — same
  //    class-less posture as the 7 hardcoded-credential rows above. Every row fixture-proven by
  //    acceptance/fixtures/code-analyzer-catalog-owned-dim-seeded.json — a GENUINE
  //    `sf code-analyzer run --rule-selector AppExchange` capture (Code Analyzer core 0.48.0 / pmd
  //    engine 0.41.0) over a seeded corpus; each key is the EXACT rule name that capture emitted.
  //    Rows stay CLASS-LESS: they supersede nothing and, being deterministic, are never themselves
  //    superseded; the dimension's owned class keeps sole supersession authority over co-located
  //    LLM re-reports. The egress/protocol scanners' loci (RemoteSiteSetting / CspTrustedSite /
  //    NamedCredential config) are disjoint from the package-metadata rows' loci (S-Control /
  //    Aura bundle / messageChannel); the secrets row's owner (the secret scanners) scans all
  //    files — co-located deterministic rows of the same dimension coexist, never hidden.
  AvoidSControls: 'package-metadata', // S-Control present — prohibited managed-pkg markup (package-metadata.md charter; named in baseline/SOURCES.md "S-Controls Not Allowed Through Security Review" + requirements-baseline.yaml)
  AvoidAuraWithLockerDisabled: 'package-metadata', // Aura apiVersion<40 → Locker off (package-metadata.md names Aura apiVersion)
  AvoidLmcIsExposedTrue: 'package-metadata', // Lightning Message Channel isExposed=true (package-metadata.md names messageChannel-meta.xml)
  ProtectSensitiveData: 'secrets-credentials', // sensitive data in XML metadata → Protected Custom (package-metadata.md boundary → secrets)
  //
  // ── E0.1d-EXPAND-4 (0.8.79): the catalog's JavaScript-in-metadata + resource-loader clusters —
  //    ALL → package-metadata (already in the routed-dimension set; this slice adds NO new
  //    dimension). Every row fixture-proven by
  //    acceptance/fixtures/code-analyzer-catalog-jsmeta-seeded.json — a GENUINE
  //    `sf code-analyzer run --rule-selector AppExchange` capture (Code Analyzer core 0.48.0 / pmd
  //    engine 0.41.0) over a seeded corpus; each key is the EXACT rule name that capture emitted.
  //    Rows stay CLASS-LESS (the EXP3 posture): they supersede nothing and, deterministic, are never
  //    themselves superseded; package-metadata's owned classes (plain-http-egress +
  //    protocol-security-disabled) fire only on the {.remoteSite,.cspTrustedSite,.namedCredential}-
  //    meta.xml config suffixes — disjoint from these rules' loci (custom page weblink /
  //    object-nested webLink / home-page-component / Visualforce page), so co-located deterministic
  //    rows of the dimension coexist, never hidden.
  //
  // JavaScript actions / javascript: URLs DECLARED in package metadata (package-metadata.md class 3 —
  // the metadata DECLARATION is package-metadata's concern; the eventual in-page XSS SINK stays
  // injection-xss territory — the seam the dimension doc resolves in-text):
  AvoidJavaScriptInUrls: 'package-metadata', // javascript: URL in a metadata <url> link target
  AvoidJavaScriptWebLink: 'package-metadata', // onClickJavaScript custom action (CustomPageWebLink, *.weblink-meta.xml)
  AvoidJavaScriptCustomObject: 'package-metadata', // onClickJavaScript action in an object-nested webLink
  AvoidJavaScriptHomePageComponent: 'package-metadata', // <script>/javascript: markup in a home-page-component body
  //
  // resource-loader hotlinks (package-metadata.md class 5 — a <script src>/<link href>/apex resource
  // load from an external host instead of $Resource). FIXTURE-GATED by the probe inside the jsmeta
  // capture: a Visualforce page with ONLY inline <script>/<style> blocks plus the safe
  // {!$Resource...} includeScript/stylesheet idiom produced ZERO violations; all four rules fired
  // ONLY on the non-$Resource external-host loads — hotlink detectors, not high-volume inline flags:
  LoadCSSApexStylesheet: 'package-metadata', // <apex:stylesheet value="http…"> non-$Resource hotlink
  LoadCSSLinkHref: 'package-metadata', // <link href="http…"> non-$Resource hotlink
  LoadJavaScriptHtmlScript: 'package-metadata', // <script src="http…"> non-$Resource hotlink
  LoadJavaScriptIncludeScript: 'package-metadata', // <apex:includeScript value="http…"> non-$Resource hotlink
  //
  // NO-OP — the 5 Apex-behavior rules (AvoidGlobalInstallUninstallHandlers /
  // AvoidUnsafePasswordManagementUse / AvoidGetInstanceWithTaint / AvoidSecurityEnforcedOldApiVersion /
  // AvoidInvalidCrudContentDistribution) are DELIBERATELY UNROUTED: they already default to
  // apex-exposed-surface (DEFAULT_DIMENSION), and that IS the correct dimension — apex-exposed-surface
  // owns global-method over-exposure, Apex CRUD/FLS behavior, and the password/setPassword
  // over-exposed entry points. A RULE_DIMENSION row would be a no-op that BREAKS the build: the
  // SESS-disjoint set-membership lock deliberately excludes apex-exposed-surface from the routed-value
  // set, and EXP4-noop locks each of the five names to the default. This is a settled posture, not a
  // "needs grounding" deferral.
  //
  // SKIP — AvoidLwcBubblesComposedTrue: an advisory-hedged flag on a standard LWC idiom
  // (component-event composition); no methodology dimension owns it, so it stays out on FP-breadth
  // grounds. The EXP2-defer / EXP3-defer standing checks lock it out of this map.
}

const VIEWALL_DOC =
  'https://developer.salesforce.com/docs/atlas.en-us.packagingGuide.meta/packagingGuide/secure_code_violation_access_settings.htm'
const PS_OVERGRANT_FLAGS = ['viewAllRecords', 'modifyAllRecords', 'modifyAllData']

// ----------------------------------------------------------------------------
// baseline-grounded class severity (cached read of the committed baseline)
// ----------------------------------------------------------------------------
let _baselineText
function baselineText() {
  if (_baselineText != null) return _baselineText
  try {
    _baselineText = readFileSync(new URL('../baseline/requirements-baseline.yaml', import.meta.url), 'utf8')
  } catch {
    _baselineText = ''
  }
  return _baselineText
}
export function baselineSeverityFor(reqId) {
  const txt = baselineText()
  if (!txt) return null
  const lines = txt.split('\n')
  const i = lines.findIndex((l) => l.replace(/\s+$/, '') === `- id: ${reqId}`)
  if (i < 0) return null
  for (let j = i + 1; j < lines.length; j++) {
    if (/^-\s+id:\s/.test(lines[j])) break // ran into the next entry; not in this block
    const sm = /^\s*severity_if_missing:\s*([a-z]+)\s*$/.exec(lines[j])
    if (sm) return sm[1]
  }
  return null
}
export function classSeverity(classKey) {
  const def = CLASS_DEFS[classKey]
  if (!def) return null
  const reqSev = baselineSeverityFor(def.baselineId)
  const mapped = reqSev ? REQ_SEVERITY_TO_FINDING[reqSev] : null
  return { severity: mapped || def.fallback, reqSev, baselineId: def.baselineId, fromBaseline: !!mapped }
}

// ----------------------------------------------------------------------------
// small deterministic helpers
// ----------------------------------------------------------------------------
function repoRel(p, root) {
  let s = String(p || '').replace(/\\/g, '/')
  if (root) {
    const r = String(root).replace(/\\/g, '/').replace(/\/+$/, '')
    if (r && s.startsWith(r + '/')) s = s.slice(r.length + 1)
  }
  return s.replace(/^\/+/, '')
}
const sha256id = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 16)
const oneLine = (s, n = 200) => {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}
// generic secret redaction (CONVENTIONS §6) — values, never names; mirrors merge-ledger.mjs
const redact = (s) =>
  String(s == null ? '' : s)
    .replace(
      /((?:secret|password|passwd|pwd|api[_-]?key|apikey|access[_-]?key|client[_-]?secret|private[_-]?key|token|bearer|authorization)\s*["']?\s*[:=]\s*)["']?[A-Za-z0-9._\-+/=]{6,}["']?/gi,
      '$1***redacted***'
    )
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, '***redacted-jwt***')

function recommendationFor(classKey) {
  switch (classKey) {
    case 'crud-fls':
      return 'Enforce object- and field-level access before this DML/SOQL (WITH USER_MODE, Security.stripInaccessible, or an explicit describe check) and degrade gracefully when access is denied.'
    case 'sharing':
      return 'Perform this data access from a class that declares an explicit sharing model (with sharing, or with inherited sharing where the whole solution is sharing-clean).'
    case 'viewall-overgrant':
      return 'Remove the ViewAll/ModifyAll grant on this custom object and scope access through sharing rules; if the broad grant is a documented business requirement, justify it in the false-positive dossier.'
    case 'iac-misconfig':
      return 'Remediate the flagged infrastructure-as-code misconfiguration (or document a justified false positive in the dossier — scan-iac-misconfig). Follow the linked Checkov guideline.'
    case 'hardcoded-secrets':
      return 'Remove the hardcoded credential and move it to an approved store (named credential, protected custom metadata/settings, or an env var/vault); rotate the exposed secret. Do not rely on code obscurity — it is explicitly not a defense.'
    case 'plain-http-egress':
      return 'Declare the endpoint over https:// — all connections to and from the platform must use TLS (the codified Secure Communication requirement, endpoint-https-only); update the Remote Site Setting / CSP Trusted Site / Named Credential accordingly, or document a justified false positive in the dossier.'
    case 'view-modify-all-data':
      return 'Least-privilege advisory: review the org-wide View All Data / Modify All Data grant. User permissions are excluded from managed-package permission sets/profiles at install, so a packaged grant may not reach subscribers via the package — verify the EFFECTIVE grant on the integration/running user, the Guest User, or an unmanaged/org-deployed context; remove the grant where it is not needed, and document a business justification for any high-risk grant that stays (least-privilege-permission-grants).'
    case 'protocol-security-disabled':
      return 'Remove <disableProtocolSecurity>true</disableProtocolSecurity> from the Remote Site Setting (the platform default is false) — the flag permits data transfer between an HTTPS session and an HTTP session, the transport downgrade the codified Secure Communication requirement forbids (endpoint-https-only); if an internal/on-premises HTTP endpoint genuinely requires it, document a justified false positive in the dossier.'
    case 'admin-privilege-grant':
      return 'Least-privilege advisory: review the high-risk admin/privilege permission grant (Manage Users / Author Apex / Customize Application / Modify Metadata). User permissions are excluded from managed-package permission sets/profiles at install, so a packaged grant may not reach subscribers via the package — verify the EFFECTIVE grant on the integration/running user, the Guest User, or an unmanaged/org-deployed context; remove the grant where it is not needed, and document a business justification for any high-risk grant that stays (least-privilege-permission-grants).'
    default:
      return 'Fix the flagged code or document a justified false positive in the dossier (baseline scan-no-clean-scan-required).'
  }
}

// ----------------------------------------------------------------------------
// CONTENT-SHAPE RECOGNITION (Phase 2 journey-wiring, 0.8.40 — the `--all` ingest mode).
// Evidence filenames are heterogeneous AND ambiguous across real runs: `iac-<date>.json`
// is checkov in one run and carries no "checkov" token; `secret-scan-detect-secrets-*`
// collides with gitleaks' `secret-scan-*` prefix; `deps-npm-*` is sometimes raw `npm audit`
// and sometimes a toolkit disposition WRAPPER. Filename routing misroutes silently, so
// `--all` routes each evidence file to its adapter by CONTENT SHAPE. The recognizer was
// proven against 40 real evidence files across 4 captured runs (40/40 correct, 0 mismatch):
// every scanner output → exactly one adapter, every non-adapter file (index.json, openapi-*,
// retire-*, the deps-npm WRAPPER, portal-scan/checkmarx) → none.
//
// Each FILE-PARSER adapter carries a `detect(raw) -> boolean` predicate (below, on the
// adapter object); the source-scanner (metadata-viewall) has NO evidence file → NO detect.
// `recognizeScanner` returns the SINGLE matching adapter name (the shapes are provably
// disjoint), null if none match, or `{ambiguous:[names]}` if >1 match (a recognizer bug —
// NEVER guess). The shared shape helpers:
//   _resultsArr — the `results[]`-array trio (semgrep/bandit/osv) is disambiguated by the
//     ELEMENT key when results is non-empty (check_id / test_id / packages) and by the
//     TOP-LEVEL markers below when results is EMPTY. A clean scan (`results:[]`) is still that
//     scanner's output — recognize it for honest accounting (it just yields 0 findings).
//   _semgrepMarks / _banditMarks / _osvMarks — the empty-results disambiguators; the bandit
//     and osv detects AND-NOT the higher-priority marks so at most one of the trio matches.
// A top-level ARRAY is gitleaks (or a checkov multi-framework array; disambiguated by
// `RuleID` vs `check_type` on the first element). An empty top-level `[]` → gitleaks (a clean
// secret scan; 0 findings, harmless). [NOTE: the per-adapter `detect` table is reproduced in
// the auditor's proof; do not chase the degenerate empty-output tail with fragile heuristics —
// an unrecognized empty output is skipped harmlessly (0 findings either way).]
// ----------------------------------------------------------------------------
const _isObj = (x) => x && typeof x === 'object' && !Array.isArray(x)
const _resultsArr = (r) => (_isObj(r) && Array.isArray(r.results) ? r.results : null)
// top-level markers that disambiguate the results[]-array trio when results is EMPTY
const _semgrepMarks = (r) =>
  'engine_requested' in r || 'skipped_rules' in r || 'profiling_results' in r || ('paths' in r && 'version' in r)
const _banditMarks = (r) => 'metrics' in r && 'generated_at' in r
const _osvMarks = (r) => 'experimental_config' in r

// ----------------------------------------------------------------------------
// the finding builder — shared by every adapter / kind
// ----------------------------------------------------------------------------
export function buildFinding({ engine, ruleId, severityNum, file, startLine, message, resources, classKey, repoRoot, pass, bandFromTool, dimensionHint, toolSevLabel, gateLabel, reachabilityPath }) {
  const passId = Number.isInteger(pass) && pass >= 1 ? pass : 1
  const rel = repoRel(file, repoRoot)
  const loc = startLine != null ? `${rel}:${startLine}` : rel
  const id = sha256id(`${engine}\n${ruleId}\n${loc}`)

  let adjusted, dimension, sevReason
  if (classKey && CLASS_DEFS[classKey]) {
    // MAPPED CLASS — severity from the class, NEVER the scanner number/band. UNTOUCHED by
    // the tool→band generalization: a mapped classKey always wins, even if bandFromTool is
    // also present (class-severity adapters like code-analyzer/checkov never let the tool move
    // a mapped finding). Guarded by S1 + the buildFinding regression check.
    const cs = classSeverity(classKey)
    adjusted = cs.severity
    dimension = CLASS_DEFS[classKey].dimension
    sevReason = `severity fixed from the ${classKey} class (baseline requirement ${cs.baselineId}${cs.reqSev ? ` = ${cs.reqSev}` : ''})`
  } else if (bandFromTool) {
    // TOOL→BAND (Phase 2 · 2a #2 Semgrep — the first genuine tool→band path). The hit owns no
    // toolkit class, but the scanner carries a real per-finding severity already resolved to a
    // finding band (via SEMGREP_SEVERITY_TO_FINDING; OSV's Extension A resolves the band from the
    // advisory's CVSS instead — same path). Use it directly; the requirement GATE governs the band,
    // not this per-finding severity. `gateLabel` names that gate — `scan-external-sast` (major) for
    // the SAST family by default; OSV/SCA passes `scan-external-sca`. The default preserves the
    // SAST adapters' reasoning byte-for-byte (they never pass gateLabel).
    adjusted = bandFromTool
    dimension = dimensionHint || DEFAULT_DIMENSION
    sevReason =
      `severity from the ${engine} tool band (${toolSevLabel || 'unknown'} → ${adjusted}); ` +
      `${engine} carries its own per-finding severity, gated by ${gateLabel || 'scan-external-sast'} (major)`
  } else {
    // UNMAPPED FALLBACK — the Code-Analyzer 1-5 scale (a security-tagged CA rule with no class
    // mapping). dimensionHint is honoured so a future no-band adapter can still group, but
    // Semgrep always supplies a band so it never reaches here.
    adjusted = (severityNum != null && CA_SEVERITY_TO_FINDING[severityNum]) || 'medium'
    dimension = dimensionHint || DEFAULT_DIMENSION
    sevReason =
      `no toolkit class maps rule ${ruleId} yet (Phase 2 extends the class map) — severity falls back to the ` +
      `Code Analyzer scale (sev ${severityNum == null ? 'n/a' : severityNum} → ${adjusted})`
  }

  const ref = Array.isArray(resources) && resources[0] ? ` See ${resources[0]}.` : ''
  const caNote = severityNum != null && classKey && CLASS_DEFS[classKey]
    ? ` Code Analyzer severity ${severityNum} is recorded for reference, not authoritative.`
    : ''
  const reasoning = redact(
    `${String(engine).toUpperCase()} rule ${ruleId} deterministically flagged this at ${loc}. ${oneLine(message, 240)}${ref} ` +
      `Provenance: deterministic (scanner-relayed, not an LLM judgment); ${sevReason}.${caNote}`
  )

  const finding = {
    id,
    dimension,
    title: `${ruleId}: ${oneLine(message, 140)}`,
    severity: adjusted,
    adjusted_severity: adjusted,
    file: loc,
    status: 'confirmed',
    first_seen: passId,
    last_seen: passId,
    verdict: 'confirmed_real',
    verdict_reasoning: reasoning,
    evidence: redact(`${loc} — ${oneLine(message, 240)}`),
    recommendation: recommendationFor(classKey),
    resolution_note: oneLine(`${ruleId} (${classKey || 'unmapped rule'}) — ${message}`, 160),
    provenance: 'deterministic',
    engine: String(engine),
    ruleId: String(ruleId),
  }
  // The owned-class label, set ONLY for a MAPPED class (an unmapped fallback finding owns
  // no class). harness/reconcile-provenance.mjs reads this: a deterministic finding
  // supersedes a co-located LLM finding ONLY in a class it owns — so an unmapped
  // deterministic finding (no `class`) never supersedes anything.
  if (classKey && CLASS_DEFS[classKey]) finding.class = classKey
  // Reachability (B5 · E0.1): the scanner-computed source→sink dataflow path, relayed when
  // the producing adapter captured one (Semgrep taint mode — see _reachabilityPath). A PURE
  // ADDITIVE attribute: it never enters the id hash, the severity, the band, or the
  // reasoning, and a finding without a trace carries NEITHER field (absence means "the
  // scanner recorded no path", never "unreachable") — so every trace-less finding, from
  // every adapter, stays byte-identical.
  if (_isObj(reachabilityPath)) {
    finding.reachabilityPath = reachabilityPath
    finding.reachable = true
  }
  return finding
}

// ----------------------------------------------------------------------------
// the PURE core: raw (already collected) + adapter -> findings. No I/O, no Date.
// ----------------------------------------------------------------------------
// Dev-only dependency down-rank (devcve-band) — the dev-scope resolver + the shared cap.
// A CVE on a DIRECT npm devDependency (in the target package.json's `devDependencies`, NOT its
// `dependencies`) is never shipped in the managed package, so it must not occupy the blocker/
// high band (compute-sci.mjs's critical floor + high gate). This down-ranks such a hit to a
// CEILING of `low` — cleared off both gates but STILL VISIBLE — and never DROPS it.
//
// SCOPE (deliberately narrow, honest in the CHANGELOG): npm, DIRECT devDependencies only.
// Transitive dev-only (package-lock `dev:true`) and Python dev-scope are a follow-on slice.
const DEV_CVE_DOWNRANK_CEILING = 'low'
// Only these bands are DOWN-ranked to the ceiling; a hit already `low`/`info` is UNCHANGED —
// the cap NEVER raises a band (a prod-dep hit, and a dev hit already at/below the ceiling, are
// byte-identical to today).
const DEV_CVE_DOWNRANKABLE = new Set(['critical', 'high', 'medium'])

/**
 * Resolve a target's DIRECT npm dev-dependency scope: package names in `devDependencies` AND
 * NOT in `dependencies`. Follows stack-detect's `JSON.parse(readOr(...))` idiom — one file read,
 * no clock; a missing/malformed package.json yields an EMPTY set (fail-open — never over-cap).
 * Returns `{ npm: Set<string> }`.
 */
export function resolveDevScope(target) {
  const npm = new Set()
  try {
    const pkg = JSON.parse(readFileSync(join(target || '.', 'package.json'), 'utf8'))
    const deps = pkg && typeof pkg.dependencies === 'object' && pkg.dependencies ? pkg.dependencies : {}
    const dev = pkg && typeof pkg.devDependencies === 'object' && pkg.devDependencies ? pkg.devDependencies : {}
    for (const name of Object.keys(dev)) {
      if (!Object.prototype.hasOwnProperty.call(deps, name)) npm.add(name)
    }
  } catch { /* missing/malformed package.json → empty set (never over-cap) */ }
  return { npm }
}

/**
 * The shared cap the osv/npm-audit `capDevBand` hooks delegate to. Returns the ceiling band
 * (`low`) when `pkgName` is a direct npm dev-only dependency AND the current band is above the
 * ceiling; else null (not dev-only / no scope / already at-or-below the ceiling — never a raise).
 */
function capDevOnlyNpmBand(pkgName, band, devScope) {
  const npm = devScope && devScope.npm
  if (!npm || typeof npm.has !== 'function') return null // no scope computed → change nothing
  if (!pkgName || !npm.has(pkgName)) return null // not a direct dev-only npm dependency
  if (!DEV_CVE_DOWNRANKABLE.has(band)) return null // already low/info → never raise
  return DEV_CVE_DOWNRANK_CEILING
}

export function ingest(raw, adapter, opts = {}) {
  const repoRoot = opts.repoRoot || ''
  const pass = Number.isInteger(opts.pass) && opts.pass >= 1 ? opts.pass : 1
  const notes = []
  if (raw == null) {
    notes.push(`${adapter.name}: no input collected (missing/unreadable/empty) — no findings`)
    return { findings: [], notes }
  }
  let hits
  try {
    hits = adapter.parse(raw)
  } catch (e) {
    notes.push(`${adapter.name}: parse failed (${e && e.message}) — no findings`)
    return { findings: [], notes }
  }
  if (!Array.isArray(hits)) hits = []
  if (!hits.length) notes.push(`${adapter.name}: 0 violations in input — no findings`)

  // Version-drift honesty marker (B5 · item 7): an OPTIONAL adapter hook, guarded exactly like
  // `securityRelevant` below — only an adapter that defines `recordedVersion(raw)` participates;
  // every other adapter is untouched. recorded∩pinned = opengrep ONLY (see the opengrep/sarif
  // adapters for why every other tool is deliberately OUT), so a non-empty recorded version is
  // by construction an opengrep version and compares against the single opengrep install pin.
  // A NOTE, never a finding: the evidence still ingests; the operator learns the scanner that
  // produced it is not the sha256-pinned install the toolkit validated. Fires independently of
  // hit count — a clean run from a drifted scanner is exactly the silent case worth flagging.
  if (typeof adapter.recordedVersion === 'function') {
    let recorded = null
    try {
      recorded = adapter.recordedVersion(raw)
    } catch {
      recorded = null
    }
    if (typeof recorded === 'string' && recorded && recorded !== PINNED_TOOL_VERSIONS.opengrep) {
      notes.push(
        `opengrep: evidence records version ${recorded} but the toolkit pins ${PINNED_TOOL_VERSIONS.opengrep} — ` +
          `stale/unexpected scanner version; re-run with the pinned install`
      )
    }
  }

  const findings = []
  // B5 · item 7: ingested hits from a TOOLKIT taint rule (adapter.expectsTrace — the one rule
  // set whose taint mode is knowable from output) that carry NO dataflow trace. Aggregated
  // below into ONE substrate-unavailable note per ingest, never one-per-hit.
  let tracelessTaint = 0
  // Test-path LOW hygiene filter (cold-run fix, 0.8.83): hits an adapter marks as hygiene
  // noise (bandit-only today — LOW-band B101 assert / B404 import under test paths, which
  // buried the deterministic band at ~93.6% bandit on a real target). Aggregated into ONE
  // note per ingest below, never one-per-hit. OPTIONAL hook, guarded like `securityRelevant`.
  let hygieneFiltered = 0
  // Dev-only dependency down-rank accounting (devcve-band). Aggregated into ONE note per
  // ingest below, never one-per-hit — mirrors hygieneFiltered.
  let devCapped = 0
  for (const h of hits) {
    if (!h || !h.file || h.ruleId == null || h.engine == null) {
      notes.push(`${adapter.name}: skipped a malformed hit (missing engine/ruleId/file)`)
      continue
    }
    // Hygiene-noise filter: the separating axis is PATH × band (test-path AND tool-LOW),
    // NEVER a severity floor — a prod-path LOW (a B105 hardcoded password) or a test-path
    // MEDIUM/HIGH must always ingest. The adapter owns the predicate; the core just counts.
    if (typeof adapter.hygieneNoise === 'function' && adapter.hygieneNoise(h)) {
      hygieneFiltered++
      continue
    }
    // Security/AppExchange tag filter (Slice 2): only a security-relevant hit becomes a
    // finding. The adapter decides relevance (code-analyzer → Security/AppExchange tag);
    // an adapter with no `securityRelevant` is security-by-construction and keeps all. A
    // FILTER on non-security NOISE, never a drop of a security finding (an unmapped
    // SECURITY rule passes here and ingests via the CA-severity fallback below).
    if (typeof adapter.securityRelevant === 'function' && !adapter.securityRelevant(h)) {
      const tg = Array.isArray(h.tags) && h.tags.length ? h.tags.join(', ') : 'no tags'
      notes.push(`${adapter.name}: rule ${h.ruleId} is not Security/AppExchange-tagged (${tg}) — filtered as non-security noise, not a finding`)
      continue
    }
    let classKey = null
    try {
      classKey = adapter.classify(h.ruleId)
    } catch {
      classKey = null
    }
    // Dev-only dependency down-rank (devcve-band): OPTIONAL hook, guarded exactly like
    // `hygieneNoise` / `securityRelevant` above. A CVE on a DIRECT npm devDependency is never
    // shipped in the managed package, so a critical/high/medium band is capped to `low` —
    // cleared off the blocker floor + the high gate but STILL a finding. Down-rank ONLY (the
    // hook never raises); the finding is KEPT with an honest caveat on the band label + message,
    // never dropped (mirrors the PV-advisory caveat precedent). osv/npm-audit only.
    let hit = h
    if (typeof adapter.capDevBand === 'function') {
      const cap = adapter.capDevBand(h, opts.devScope)
      if (cap) {
        hit = {
          ...h,
          bandFromTool: cap,
          // buildFinding renders the reasoning as `(<toolSevLabel> → <cappedBand>)`, so the label
          // carries the WHY of the cap; the message carries the operator-facing caveat.
          toolSevLabel: `${h.toolSevLabel || 'unknown'}; dev-only dependency, not shipped`,
          message: `${h.message} — dev-only dependency (not shipped in the managed package) — downgraded from ${h.bandFromTool}`,
        }
        devCapped++
      }
    }
    findings.push(buildFinding({ ...hit, classKey, repoRoot, pass }))
    // Substrate-unavailable accounting (B5 · item 7): an OPTIONAL hook, same guard shape as
    // `securityRelevant` above. Counts only hits that actually became findings.
    if (typeof adapter.expectsTrace === 'function' && adapter.expectsTrace(h) && !h.reachabilityPath) {
      tracelessTaint++
    }
    if (!classKey) {
      // Honest note on the severity SOURCE of an unmapped hit: a tool→band adapter (Semgrep)
      // carries its own per-finding band, while a class-severity adapter (code-analyzer) with
      // an unmapped SECURITY rule uses the Code-Analyzer-severity fallback. Keeps the word
      // "unmapped" either way (the owned-class is still none). Reads the EFFECTIVE hit so a
      // dev-only down-rank reports its capped band, not the tool's pre-cap band.
      const how = hit.bandFromTool
        ? `the ${adapter.name} tool band (${hit.toolSevLabel || 'unknown'} → ${hit.bandFromTool})`
        : 'the Code-Analyzer-severity fallback'
      notes.push(`${adapter.name}: rule ${hit.ruleId} is unmapped (owns no toolkit class) — ingested as deterministic with ${how}`)
    }
  }
  // Substrate-unavailable honesty marker (B5 · item 7): a toolkit taint rule fired but the
  // evidence carries no dataflow trace — the reachability substrate this engine version /
  // output surface can withhold (semgrep CE ≥1.168 omits it from --json and Pro-gates SARIF
  // codeFlows). Previously operator-prose only (skills/run-scans/SKILL.md); now the harness
  // says it deterministically. A NOTE, never a finding: the findings themselves ingest
  // byte-identically, only `reachabilityPath` is absent.
  if (tracelessTaint > 0) {
    let recorded = null
    if (typeof adapter.recordedVersion === 'function') {
      try {
        recorded = adapter.recordedVersion(raw)
      } catch {
        recorded = null
      }
    }
    notes.push(
      `${adapter.name}: ${tracelessTaint} toolkit taint rule(s) fired with no dataflow trace ` +
        `(${adapter.name} v${recorded || 'unknown'}) — reachability substrate unavailable on this engine ` +
        `version / output surface; findings ingest normally, reachabilityPath absent (use Opengrep or SARIF codeFlows)`
    )
  }
  // Hygiene-noise honesty marker (0.8.83): ONE aggregated note per ingest — the operator
  // learns the deterministic band was de-noised and by how much, without N note rows.
  if (hygieneFiltered > 0) {
    notes.push(
      `${adapter.name}: ${hygieneFiltered} test-path LOW hygiene hit(s) (assert/import, e.g. B101/B404 under tests) ` +
        `filtered as non-security noise — not findings`
    )
  }
  // Dev-only dependency down-rank honesty marker (devcve-band): ONE aggregated note per ingest —
  // the operator learns how many dep-CVEs were capped below the blocker floor because the
  // package is a direct npm devDependency (not shipped), without N note rows. The findings are
  // KEPT (visible at `low` with the caveat on the message), never dropped.
  if (devCapped > 0) {
    notes.push(
      `${adapter.name}: ${devCapped} dev-only npm dependency CVE(s) capped to '${DEV_CVE_DOWNRANK_CEILING}' ` +
        `(direct devDependency, not shipped in the managed package) — below the blocker floor, still recorded`
    )
  }
  // stable order so the output is byte-identical regardless of scanner emission order
  findings.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { findings, notes }
}

// ----------------------------------------------------------------------------
// ADAPTER #1 — code-analyzer (file-parser): parses a captured Code Analyzer v5 JSON
// ----------------------------------------------------------------------------
export const codeAnalyzerAdapter = {
  name: 'code-analyzer',
  kind: 'file-parser',
  // CONTENT-SHAPE recognizer for --all: a Code Analyzer v5 run is an object with a violations[] array.
  detect: (r) => _isObj(r) && Array.isArray(r.violations),
  collect({ input } = {}) {
    if (!input) return null
    try {
      const txt = readFileSync(input, 'utf8')
      if (!txt.trim()) return null
      return JSON.parse(txt)
    } catch {
      return null
    }
  },
  parse(raw) {
    if (!raw || !Array.isArray(raw.violations)) return []
    const hits = []
    for (const v of raw.violations) {
      if (!v || v.rule == null) continue
      const locs = Array.isArray(v.locations) ? v.locations : []
      const idx =
        Number.isInteger(v.primaryLocationIndex) && v.primaryLocationIndex >= 0 && v.primaryLocationIndex < locs.length
          ? v.primaryLocationIndex
          : 0
      const loc = locs[idx] || locs[0] || null
      if (!loc || !loc.file) continue
      hits.push({
        engine: v.engine || 'code-analyzer',
        ruleId: String(v.rule),
        severityNum: Number.isInteger(v.severity) ? v.severity : null,
        file: loc.file,
        startLine: Number.isInteger(loc.startLine) ? loc.startLine : null,
        message: v.message == null ? '' : String(v.message),
        resources: Array.isArray(v.resources) ? v.resources : [],
        tags: Array.isArray(v.tags) ? v.tags : [],
        // rule-name dimension routing (RULE_DIMENSION — CA output carries no CWE, so this is
        // the CA analogue of the SAST adapters' dimensionForCwes hint). undefined when
        // unmapped (harmless); buildFinding ignores it for a class-owning rule.
        dimensionHint: RULE_DIMENSION[String(v.rule)],
      })
    }
    return hits
  },
  classify(ruleId) {
    return RULE_CLASS[ruleId] || null
  },
  // Slice 2: only a Security/AppExchange-tagged Code Analyzer rule is a security finding.
  // Filters out ApexDoc / naming / codestyle / Performance noise (incl. the Performance-
  // tagged MissingNullCheckOnSoqlVariable). An unmapped SECURITY rule still passes (then
  // ingests via the CA-severity fallback) — this never drops a security finding.
  securityRelevant(hit) {
    return hasSecurityTag(hit && hit.tags)
  },
}

// ----------------------------------------------------------------------------
// ADAPTER #2 — metadata-viewall (source-scanner): greps the repo's permission sets
// ----------------------------------------------------------------------------
const SKIP_DIRS = new Set(['.git', 'node_modules', '.security-review'])
function findPermissionSetFiles(root) {
  const out = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue
        walk(join(dir, e.name))
      } else if (e.isFile() && e.name.endsWith('.permissionset-meta.xml')) {
        out.push(join(dir, e.name))
      }
    }
  }
  walk(root)
  out.sort()
  return out
}
function lineOfIndex(text, idx) {
  let line = 1
  for (let i = 0; i < idx && i < text.length; i++) if (text[i] === '\n') line++
  return line
}
// PURE: extract over-granting objectPermissions blocks from one permission set's XML.
function extractObjectOvergrants(text) {
  const out = []
  const re = /<objectPermissions>([\s\S]*?)<\/objectPermissions>/g
  let m
  while ((m = re.exec(text)) !== null) {
    const block = m[1]
    const objM = /<object>\s*([^<\s][^<]*?)\s*<\/object>/.exec(block)
    if (!objM) continue
    const object = objM[1].trim()
    // Custom objects only. Standard objects are out of scope — "the org admin solely
    // owns the security policy for standard objects" (baseline violation-sharing-rules-bypass).
    if (!/__c$/i.test(object)) continue
    const flags = PS_OVERGRANT_FLAGS.filter((fl) => new RegExp(`<${fl}>\\s*true\\s*</${fl}>`, 'i').test(block))
    if (!flags.length) continue
    const objAbsIdx = m.index + m[0].indexOf(objM[0])
    out.push({ object, flags, line: lineOfIndex(text, objAbsIdx) })
  }
  return out
}
export const metadataViewAllAdapter = {
  name: 'metadata-viewall',
  kind: 'source-scanner',
  collect({ target } = {}) {
    if (!target) return null
    let files
    try {
      files = findPermissionSetFiles(target)
    } catch {
      return null
    }
    const out = []
    for (const p of files) {
      try {
        out.push({ path: p, text: readFileSync(p, 'utf8') })
      } catch {
        /* unreadable file — skip, never crash */
      }
    }
    return { files: out, repoRoot: target }
  },
  parse(raw) {
    if (!raw || !Array.isArray(raw.files)) return []
    const hits = []
    for (const f of raw.files) {
      if (!f || typeof f.text !== 'string') continue
      for (const og of extractObjectOvergrants(f.text)) {
        hits.push({
          engine: 'metadata',
          ruleId: 'viewall-overgrant',
          severityNum: null,
          file: f.path,
          startLine: og.line,
          message: `Permission set grants ${og.flags.join(' + ')}=true on custom object ${og.object} — an all-records sharing bypass on a partner-namespace object.`,
          resources: [VIEWALL_DOC],
          tags: ['AppExchange', 'Security', 'Metadata'],
        })
      }
    }
    return hits
  },
  classify() {
    return 'viewall-overgrant'
  },
}

// ----------------------------------------------------------------------------
// ADAPTER #15 — egress-plain-http (source-scanner, B5 · E0.3b-1): scans the repo's
// declarative egress-config metadata and flags every endpoint declared over plain
// http:// — the codified Secure Communication violation (endpoint-https-only,
// Top-20 #17 "Insecure endpoint"). The clone of metadata-viewall: same walk, a pure
// per-file extractor, CONSTANT classify(), NO securityRelevant (security-by-
// construction — every emission is a statically-declared insecure-transport
// endpoint). The endpoint-bearing elements per metadata type (Metadata API schema):
//   *.remoteSite-meta.xml      — RemoteSiteSetting <url>
//   *.cspTrustedSite-meta.xml  — CspTrustedSite <endpointUrl>
//   *.namedCredential-meta.xml — NamedCredential <endpoint> (legacy) OR the modern
//                                (API 56.0+) <namedCredentialParameters> block's
//                                <parameterValue> where the sibling <parameterType>
//                                is Url — BOTH shapes are read.
// PRECISION: the scheme test is ANCHORED at the value's start and case-insensitive,
// so https:// never matches (no /https?/ shortcut), and the URL is read ONLY from
// the named elements of the file type that owns them — an http:// inside a
// <description> (or anywhere else in the file) never flags.
// HONEST FLOOR: the finding is a statically-declared plain-HTTP endpoint in
// committed config — a transport-security misconfiguration; whether data actually
// flows over it is runtime behavior (the DAST/TLS scan families). NO "secret"
// finding is ever emitted from a credential file: the secret VALUE is org-encrypted
// and never present in metadata, and hardcoded-secret detection is a different
// engine. Wildcard-host / over-broad egress, Apex setEndpoint('http://…') literals,
// and the host↔NamedCredential join are named follow-on slices — NOT this adapter.
// ----------------------------------------------------------------------------
const EGRESS_HTTPS_DOC =
  'https://developer.salesforce.com/docs/atlas.en-us.packagingGuide.meta/packagingGuide/secure_code_violation_communication.htm'
// endpoint-bearing simple elements, keyed by the metadata-file suffix that owns them
const EGRESS_META_ELEMENTS = [
  { suffix: '.remoteSite-meta.xml', type: 'Remote Site Setting', elements: ['url'] },
  { suffix: '.cspTrustedSite-meta.xml', type: 'CSP Trusted Site', elements: ['endpointUrl'] },
  { suffix: '.namedCredential-meta.xml', type: 'Named Credential', elements: ['endpoint'] },
]
// anchored + case-insensitive: `http://` only — the trailing-`s` exclusion is by
// construction (the literal `p://` after `htt` cannot match `https://`)
const PLAIN_HTTP_RE = /^http:\/\//i
function findEgressMetadataFiles(root) {
  const out = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue
        walk(join(dir, e.name))
      } else if (e.isFile() && EGRESS_META_ELEMENTS.some((t) => e.name.endsWith(t.suffix))) {
        out.push(join(dir, e.name))
      }
    }
  }
  walk(root)
  out.sort()
  return out
}
// PURE: extract each plain-http endpoint from one egress-config file's XML. `path`
// picks WHICH elements are read (element-scoped, never a whole-file grep); the line
// points at the offending URL value itself.
function extractPlainHttpEndpoints(path, text) {
  const meta = EGRESS_META_ELEMENTS.find((t) => String(path || '').endsWith(t.suffix))
  if (!meta) return []
  const out = []
  const pushIfPlainHttp = (element, url, urlAbsIdx) => {
    const u = String(url).trim()
    if (!PLAIN_HTTP_RE.test(u)) return
    out.push({ type: meta.type, element, url: u, line: lineOfIndex(text, urlAbsIdx) })
  }
  for (const el of meta.elements) {
    const re = new RegExp(`<${el}>\\s*([^<]*?)\\s*</${el}>`, 'g')
    let m
    while ((m = re.exec(text)) !== null) {
      pushIfPlainHttp(el, m[1], m.index + m[0].indexOf(m[1]))
    }
  }
  // the modern NamedCredential shape: a <namedCredentialParameters> block whose
  // <parameterType> is Url carries the endpoint in <parameterValue>
  if (meta.suffix === '.namedCredential-meta.xml') {
    const blockRe = /<namedCredentialParameters>([\s\S]*?)<\/namedCredentialParameters>/g
    let b
    while ((b = blockRe.exec(text)) !== null) {
      const block = b[1]
      const typeM = /<parameterType>\s*Url\s*<\/parameterType>/i.exec(block)
      if (!typeM) continue
      const valM = /<parameterValue>\s*([^<]*?)\s*<\/parameterValue>/.exec(block)
      if (!valM) continue
      pushIfPlainHttp('parameterValue', valM[1], b.index + b[0].indexOf(valM[0]) + valM[0].indexOf(valM[1]))
    }
  }
  return out
}
export const egressPlainHttpAdapter = {
  name: 'egress-plain-http',
  kind: 'source-scanner',
  collect({ target } = {}) {
    if (!target) return null
    let files
    try {
      files = findEgressMetadataFiles(target)
    } catch {
      return null
    }
    const out = []
    for (const p of files) {
      try {
        out.push({ path: p, text: readFileSync(p, 'utf8') })
      } catch {
        /* unreadable file — skip, never crash */
      }
    }
    return { files: out, repoRoot: target }
  },
  parse(raw) {
    if (!raw || !Array.isArray(raw.files)) return []
    const hits = []
    for (const f of raw.files) {
      if (!f || typeof f.text !== 'string') continue
      for (const ep of extractPlainHttpEndpoints(f.path, f.text)) {
        hits.push({
          engine: 'metadata',
          ruleId: 'plain-http-egress',
          severityNum: null,
          file: f.path,
          startLine: ep.line,
          message: `${ep.type} declares a plain-HTTP endpoint in <${ep.element}>: ${ep.url} — HTTPS is required for every connection to and from the platform (Secure Communication).`,
          resources: [EGRESS_HTTPS_DOC],
          tags: ['AppExchange', 'Security', 'Metadata'],
        })
      }
    }
    return hits
  },
  classify() {
    return 'plain-http-egress'
  },
}

// ----------------------------------------------------------------------------
// ADAPTER #16 — view-modify-all-data (source-scanner, B5 · E0.3c-1; reframed 0.8.68):
// scans the repo's permission sets AND profiles and flags the two ORG-WIDE system
// permissions — ViewAllData / ModifyAllData — granted via a <userPermissions> block
// with <enabled>true</enabled>. These permissions ignore ALL sharing rules and
// org-wide defaults on every object (they still respect field-level security), so a
// declared grant is genuine least-privilege signal — but the finding is an ADVISORY
// (least-privilege-permission-grants, informational → info, dimension admin-surface),
// never an auto-fail: user permissions are excluded from managed-package permission
// sets/profiles at install (Salesforce 2GP), so a packaged grant may not reach
// subscribers via the package, and no named AppExchange requirement auto-fails a
// permission grant. The clone of
// metadata-viewall / egress-plain-http: same walk, a pure per-file extractor,
// CONSTANT classify(), NO securityRelevant (security-by-construction — every emission
// is a statically-declared org-wide grant), NO detect (a source-scanner has no
// evidence file). Covers EXACTLY the gap metadata-viewall leaves: that adapter reads
// <objectPermissions> blocks in *.permissionset-meta.xml only — it never reads
// <userPermissions> and never scans *.profile-meta.xml — so the two source-scanners
// are disjoint (no double-report; the standing test locks it).
// PRECISION: the <name> match is EXACT against {ViewAllData, ModifyAllData} (a
// ViewAll*-prefixed permission like ViewAllUsers never matches), <enabled>true</enabled>
// is REQUIRED within the SAME <userPermissions> block (since API v29.0+ only enabled
// permissions are serialized, but a rare explicit enabled=false row must stay clean),
// and the read is element-scoped — a mention inside a <description> or a comment
// never flags.
// HONEST FLOOR: the finding is a statically-declared org-wide grant in committed
// metadata — an advisory signal, NEVER a confirmed subscriber grant (managed-package
// permission sets/profiles drop user permissions at install; the grant still
// respects FLS and needs real data + a running user to expose anything, and source
// metadata cannot see whether it is exercised). The EFFECTIVE grant — on the
// integration/running user, the Guest User, or an unmanaged/org-deployed context —
// is the real signal; verifying it is the deployed-package audit plus human review.
// And retrieved profile metadata is
// often PARTIAL (only in-scope components), so the ABSENCE of a grant is not
// least-privilege proof — the adapter flags what is present + enabled, nothing more.
// ManageUsers/AuthorApex, per-object viewAllRecords/modifyAllRecords in PROFILES, the
// permission-set-group + muting effective-permission composition, and the
// release-to-release grant-widening diff are named follow-on slices — NOT this adapter.
// ----------------------------------------------------------------------------
const VMAD_PERMS = new Set(['ViewAllData', 'ModifyAllData'])
const VMAD_FILE_KINDS = [
  { suffix: '.permissionset-meta.xml', type: 'Permission set' },
  { suffix: '.profile-meta.xml', type: 'Profile' },
]
function findUserPermissionFiles(root) {
  const out = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue
        walk(join(dir, e.name))
      } else if (e.isFile() && VMAD_FILE_KINDS.some((t) => e.name.endsWith(t.suffix))) {
        out.push(join(dir, e.name))
      }
    }
  }
  walk(root)
  out.sort()
  return out
}
// PURE: extract each ENABLED org-wide View/Modify All Data grant from one file's XML.
// Element-scoped: only a <userPermissions> block's own <name> + <enabled> are read; the
// line points at the grant's <name> element itself.
function extractViewModifyAllGrants(text) {
  const out = []
  const re = /<userPermissions>([\s\S]*?)<\/userPermissions>/g
  let m
  while ((m = re.exec(text)) !== null) {
    const block = m[1]
    const nameM = /<name>\s*([^<\s][^<]*?)\s*<\/name>/.exec(block)
    if (!nameM) continue
    const name = nameM[1].trim()
    // EXACT name only — ViewAllUsers / any ViewAll*-prefixed permission never matches
    if (!VMAD_PERMS.has(name)) continue
    // the grant must be ENABLED within the SAME block — an explicit enabled=false row is clean
    if (!/<enabled>\s*true\s*<\/enabled>/i.test(block)) continue
    const nameAbsIdx = m.index + m[0].indexOf(nameM[0])
    out.push({ name, line: lineOfIndex(text, nameAbsIdx) })
  }
  return out
}
export const viewModifyAllDataAdapter = {
  name: 'view-modify-all-data',
  kind: 'source-scanner',
  collect({ target } = {}) {
    if (!target) return null
    let files
    try {
      files = findUserPermissionFiles(target)
    } catch {
      return null
    }
    const out = []
    for (const p of files) {
      try {
        out.push({ path: p, text: readFileSync(p, 'utf8') })
      } catch {
        /* unreadable file — skip, never crash */
      }
    }
    return { files: out, repoRoot: target }
  },
  parse(raw) {
    if (!raw || !Array.isArray(raw.files)) return []
    const hits = []
    for (const f of raw.files) {
      if (!f || typeof f.text !== 'string') continue
      const kind = VMAD_FILE_KINDS.find((t) => String(f.path || '').endsWith(t.suffix))
      if (!kind) continue
      for (const g of extractViewModifyAllGrants(f.text)) {
        hits.push({
          engine: 'metadata',
          ruleId: 'view-modify-all-data',
          severityNum: null,
          file: f.path,
          startLine: g.line,
          message: `${kind.type} grants the org-wide ${g.name} system permission (<userPermissions> enabled=true) — advisory (least privilege): user permissions are excluded from managed-package permission sets/profiles at install, so this may not reach subscribers via the package; verify the effective grant on the integration/running user or an unmanaged/org-deployed context, and document a business justification for any high-risk grant.`,
          resources: [VIEWALL_DOC],
          tags: ['AppExchange', 'Security', 'Metadata'],
        })
      }
    }
    return hits
  },
  classify() {
    return 'view-modify-all-data'
  },
}

// ----------------------------------------------------------------------------
// ADAPTER #17 — remote-site-protocol-security (source-scanner, B5 · E0.3b-2): scans
// the repo's *.remoteSite-meta.xml and flags every RemoteSiteSetting that sets
// <disableProtocolSecurity>true</disableProtocolSecurity> — the flag that permits
// code to pass data between an HTTPS session and an HTTP session (a transport
// downgrade), exactly what the codified Secure Communication requirement forbids
// (endpoint-https-only, the same baseline plain-http-egress grounds in). The clone
// of egress-plain-http: same walk, a pure per-file extractor, CONSTANT classify(),
// NO securityRelevant (security-by-construction — every emission is a statically-
// declared protocol-security opt-out), NO detect (a source-scanner has no evidence
// file). INDEPENDENT of egress-plain-http: that adapter reads endpoint-URL schemes
// (<url> et al.), this one reads ONLY the <disableProtocolSecurity> element — a
// different flag, a different class, no double-report (the standing DP-no-overlap
// check locks the disjointness).
// PRECISION: the read is element-scoped — only the <disableProtocolSecurity>
// element's own value is tested (a <description> mentioning the flag in prose
// never flags) — and the value must be `true` (case-insensitive, whitespace-
// tolerant); an explicit false element, the platform default, never flags, and an
// absent element never flags.
// HONEST FLOOR: the finding is a statically-declared protocol-security opt-out in
// committed config — a transport-security misconfiguration; whether data actually
// crosses an HTTP session at runtime is the DAST/TLS scan families' territory. The
// flag defaults to false and Salesforce explicitly warns against enabling it, so
// the finding is LOW-FP; the one rare benign case (an internal/on-premises/
// localhost HTTP endpoint) is dispositionable via the FP dossier, never
// suppressed. Wildcard-host egress and Apex http:// literals are research-
// adjudicated separately — NOT this adapter.
// ----------------------------------------------------------------------------
const RSS_PROTOCOL_SUFFIX = '.remoteSite-meta.xml'
function findRemoteSiteFiles(root) {
  const out = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue
        walk(join(dir, e.name))
      } else if (e.isFile() && e.name.endsWith(RSS_PROTOCOL_SUFFIX)) {
        out.push(join(dir, e.name))
      }
    }
  }
  walk(root)
  out.sort()
  return out
}
// PURE: extract each disableProtocolSecurity=true opt-out from one Remote Site
// Setting's XML. Element-scoped: only the <disableProtocolSecurity> element's own
// value is read; the value must be true; the line points at the element itself.
function extractProtocolSecurityOptOuts(text) {
  const out = []
  const re = /<disableProtocolSecurity>\s*([^<]*?)\s*<\/disableProtocolSecurity>/g
  let m
  while ((m = re.exec(text)) !== null) {
    // true-required (case-insensitive, whitespace already trimmed by the capture):
    // an explicit false element — the platform default — never flags
    if (!/^true$/i.test(m[1])) continue
    out.push({ line: lineOfIndex(text, m.index) })
  }
  return out
}
export const remoteSiteProtocolSecurityAdapter = {
  name: 'remote-site-protocol-security',
  kind: 'source-scanner',
  collect({ target } = {}) {
    if (!target) return null
    let files
    try {
      files = findRemoteSiteFiles(target)
    } catch {
      return null
    }
    const out = []
    for (const p of files) {
      try {
        out.push({ path: p, text: readFileSync(p, 'utf8') })
      } catch {
        /* unreadable file — skip, never crash */
      }
    }
    return { files: out, repoRoot: target }
  },
  parse(raw) {
    if (!raw || !Array.isArray(raw.files)) return []
    const hits = []
    for (const f of raw.files) {
      if (!f || typeof f.text !== 'string') continue
      for (const opt of extractProtocolSecurityOptOuts(f.text)) {
        hits.push({
          engine: 'metadata',
          ruleId: 'protocol-security-disabled',
          severityNum: null,
          file: f.path,
          startLine: opt.line,
          message:
            'Remote Site Setting sets <disableProtocolSecurity>true</disableProtocolSecurity> — the flag permits data transfer between an HTTPS session and an HTTP session (a transport downgrade); HTTPS is required for every connection to and from the platform (Secure Communication).',
          resources: [EGRESS_HTTPS_DOC],
          tags: ['AppExchange', 'Security', 'Metadata'],
        })
      }
    }
    return hits
  },
  classify() {
    return 'protocol-security-disabled'
  },
}

// ----------------------------------------------------------------------------
// ADAPTER #18 — admin-privilege-grant (source-scanner, B5 · E0.3c-2): scans the
// repo's permission sets AND profiles and flags the high-risk ADMIN/PRIVILEGE
// system permissions — ManageUsers (Manage Users), AuthorApex (Author Apex),
// CustomizeApplication (Customize Application), ModifyMetadata (Modify Metadata
// Through Metadata API Functions) — granted via a <userPermissions> block with
// <enabled>true</enabled>. These permissions confer broad administrative
// capability (user administration, code authorship, org configuration, metadata
// mutation), so a declared grant is genuine least-privilege signal — but the
// finding is an ADVISORY (least-privilege-permission-grants, informational →
// info, dimension admin-surface), never an auto-fail: user permissions are
// excluded from managed-package permission sets/profiles at install (Salesforce
// 2GP), so a packaged grant may not reach subscribers via the package, no named
// AppExchange requirement auto-fails a permission grant, and legitimate
// justifications exist (identity management → ManageUsers, DevOps tooling →
// AuthorApex/ModifyMetadata). The clone of view-modify-all-data: same
// permission-set + profile walk, a pure per-file extractor, CONSTANT classify(),
// NO securityRelevant (security-by-construction — every emission is a
// statically-declared admin/privilege grant), NO detect (a source-scanner has no
// evidence file). view-modify-all-data's SIBLING, not its extension: that
// adapter's Set is the org-wide DATA-access pair {ViewAllData, ModifyAllData};
// this adapter's Set is the admin/privilege quartet — the two Sets are DISJOINT,
// so the same grant line is never double-reported (the standing AP-no-overlap
// check locks the disjointness in both directions).
// PRECISION: the <name> match is EXACT against the quartet (an adjacent
// delegated-administration permission like ManageInternalUsers never matches),
// <enabled>true</enabled> is REQUIRED within the SAME <userPermissions> block
// (since API v29.0+ only enabled permissions are serialized, but a rare explicit
// enabled=false row must stay clean), and the read is element-scoped — a mention
// inside a <description> or a comment never flags.
// HONEST FLOOR: the finding is a statically-declared grant in committed metadata
// — an advisory signal, NEVER a confirmed subscriber grant (managed-package
// permission sets/profiles drop user permissions at install; the EFFECTIVE grant
// — on the integration/running user, the Guest User, or an unmanaged/
// org-deployed context — is the real signal; verifying it is the
// deployed-package audit plus human review). Retrieved profile metadata is often
// PARTIAL (only in-scope components), so the ABSENCE of a grant is not
// least-privilege proof — the adapter flags what is present + enabled, nothing
// more. Every name in the Set is a CONFIRMED Profile/PermissionSet
// <userPermissions> API name (an unconfirmed name would be a dead row that never
// matches real metadata). ManageSharing and the wider admin-permission tail, the
// permission-set-group + muting effective-permission composition, and the
// release-to-release grant-widening diff are named follow-on slices — NOT this
// adapter.
// ----------------------------------------------------------------------------
const ADMIN_PRIV_PERMS = new Set(['ManageUsers', 'AuthorApex', 'CustomizeApplication', 'ModifyMetadata'])
const ADMIN_PRIV_FILE_KINDS = [
  { suffix: '.permissionset-meta.xml', type: 'Permission set' },
  { suffix: '.profile-meta.xml', type: 'Profile' },
]
const ADMIN_PRIV_DOC = 'https://security.salesforce.com/security-best-practices'
function findAdminPrivilegeFiles(root) {
  const out = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue
        walk(join(dir, e.name))
      } else if (e.isFile() && ADMIN_PRIV_FILE_KINDS.some((t) => e.name.endsWith(t.suffix))) {
        out.push(join(dir, e.name))
      }
    }
  }
  walk(root)
  out.sort()
  return out
}
// PURE: extract each ENABLED admin/privilege permission grant from one file's XML.
// Element-scoped: only a <userPermissions> block's own <name> + <enabled> are read; the
// line points at the grant's <name> element itself.
function extractAdminPrivilegeGrants(text) {
  const out = []
  const re = /<userPermissions>([\s\S]*?)<\/userPermissions>/g
  let m
  while ((m = re.exec(text)) !== null) {
    const block = m[1]
    const nameM = /<name>\s*([^<\s][^<]*?)\s*<\/name>/.exec(block)
    if (!nameM) continue
    const name = nameM[1].trim()
    // EXACT name only — ManageInternalUsers / any adjacent admin permission never matches
    if (!ADMIN_PRIV_PERMS.has(name)) continue
    // the grant must be ENABLED within the SAME block — an explicit enabled=false row is clean
    if (!/<enabled>\s*true\s*<\/enabled>/i.test(block)) continue
    const nameAbsIdx = m.index + m[0].indexOf(nameM[0])
    out.push({ name, line: lineOfIndex(text, nameAbsIdx) })
  }
  return out
}
export const adminPrivilegeGrantAdapter = {
  name: 'admin-privilege-grant',
  kind: 'source-scanner',
  collect({ target } = {}) {
    if (!target) return null
    let files
    try {
      files = findAdminPrivilegeFiles(target)
    } catch {
      return null
    }
    const out = []
    for (const p of files) {
      try {
        out.push({ path: p, text: readFileSync(p, 'utf8') })
      } catch {
        /* unreadable file — skip, never crash */
      }
    }
    return { files: out, repoRoot: target }
  },
  parse(raw) {
    if (!raw || !Array.isArray(raw.files)) return []
    const hits = []
    for (const f of raw.files) {
      if (!f || typeof f.text !== 'string') continue
      const kind = ADMIN_PRIV_FILE_KINDS.find((t) => String(f.path || '').endsWith(t.suffix))
      if (!kind) continue
      for (const g of extractAdminPrivilegeGrants(f.text)) {
        hits.push({
          engine: 'metadata',
          ruleId: 'admin-privilege-grant',
          severityNum: null,
          file: f.path,
          startLine: g.line,
          message: `${kind.type} grants the high-risk ${g.name} admin/privilege system permission — advisory (least privilege): the grant is declared via <userPermissions> enabled=true, and user permissions are excluded from managed-package permission sets/profiles at install, so this may not reach subscribers via the package; verify the effective grant on the integration/running user or an unmanaged/org-deployed context, and document a business justification for any high-risk grant.`,
          resources: [ADMIN_PRIV_DOC],
          tags: ['AppExchange', 'Security', 'Metadata'],
        })
      }
    }
    return hits
  },
  classify() {
    return 'admin-privilege-grant'
  },
}

// ----------------------------------------------------------------------------
// ADAPTER #3 — checkov (file-parser, Phase 2 · 2a): parses captured Checkov JSON.
// Checkov is the toolkit's IaC-misconfig scanner (run-scans Family 8 over the Dockerfile /
// Terraform / CloudFormation / K8s). Like metadata-viewall it is SECURITY-BY-CONSTRUCTION —
// every `failed_check` is an IaC misconfig, there is no ApexDoc-style noise — so it has a
// CONSTANT classify() and NO `securityRelevant` (the ingest core keeps every emitted hit).
// Severity comes from the iac-misconfig CLASS (scan-iac-misconfig = major → high), NEVER the
// tool: Checkov OSS emits `severity: null` (per-check severity is a Prisma/Bridgecrew
// enterprise field), so a literal tool→band mapping has no input anyway — class-severity is the
// faithful AND the only deterministic option. Only `failed_checks` become findings;
// passed/skipped/parsing_errors never do.
export const checkovAdapter = {
  name: 'checkov',
  kind: 'file-parser',
  // CONTENT-SHAPE recognizer for --all: a single-framework object (check_type + results.failed_checks[])
  // OR a multi-framework ARRAY whose first element carries check_type (disambiguates vs gitleaks' RuleID).
  detect: (r) =>
    (_isObj(r) && r.check_type != null && _isObj(r.results) && Array.isArray(r.results.failed_checks)) ||
    (Array.isArray(r) && r[0] && _isObj(r[0]) && r[0].check_type != null),
  collect({ input } = {}) {
    if (!input) return null
    try {
      const txt = readFileSync(input, 'utf8')
      if (!txt.trim()) return null
      return JSON.parse(txt)
    } catch {
      return null
    }
  },
  parse(raw) {
    if (raw == null) return []
    // Checkov emits a single result OBJECT for one framework, or an ARRAY of result objects
    // when several frameworks run (dockerfile + terraform + k8s). Normalize to a list.
    const frameworks = Array.isArray(raw) ? raw : [raw]
    const hits = []
    for (const fw of frameworks) {
      if (!fw || typeof fw !== 'object') continue
      const results = fw.results
      const failed = results && Array.isArray(results.failed_checks) ? results.failed_checks : []
      for (const check of failed) {
        // Skip a malformed check with no rule id (the ingest core also drops a hit with no
        // file_path, with an honest note — that is correct).
        if (!check || check.check_id == null) continue
        const range = Array.isArray(check.file_line_range) ? check.file_line_range : null
        const startLine = range && Number.isInteger(range[0]) ? range[0] : null
        hits.push({
          engine: 'checkov',
          ruleId: String(check.check_id),
          severityNum: null, // Checkov OSS severity is null; we never use it (severity is from the class)
          file: check.file_path,
          startLine,
          message: String(check.check_name || ''),
          resources: check.guideline ? [String(check.guideline)] : [],
          tags: [],
        })
      }
    }
    return hits
  },
  // Constant: every Checkov failed check is an IaC misconfig (like metadata-viewall's constant).
  // Checkov is NOT in RULE_CLASS (that map is the code-analyzer rule→class table).
  classify() {
    return 'iac-misconfig'
  },
  // NO securityRelevant — security-by-construction (mirror metadata-viewall): a compliance
  // scanner whose every emission is a finding, so the ingest core applies no tag filter.
}

// ----------------------------------------------------------------------------
// CWE→dimension ROUTING for the external-SAST adapters (B5 · E0.1b, 0.8.58;
// taxonomy EXPANDED across the injection classes + njsscan wired, E0.1b-EXPAND, 0.8.59;
// unified into a single extensible CWE_TO_DIMENSION map + the untrusted-deserialization
// family activated, E0.1c, 0.8.62). The routing key is the shared `CWE_TO_DIMENSION` table
// below: every SAST adapter calls `dimensionForCwes(<cwe field>)`, which reads the ids the
// scanner already emitted and looks them up in that one map — so adding a class = adding rows,
// and the new class routes across all five adapters (semgrep/bandit/njsscan/SARIF/opengrep) for
// free, with no adapter or call-site change.
// `injection-xss` is a REAL methodology dimension (methodology/dimensions/injection-xss.md),
// so an external-SAST finding the scanner has ALREADY labelled with an injection-class CWE
// belongs under that heading, not the catch-all 'external-sast' grouping label. The routing
// key is an EXACT integer-CWE membership check — never a substring / rule-name / message
// match, which would misroute the co-resident non-injection findings (CWE-939 custom-URL-
// scheme authorization, CWE-22 path traversal, CWE-798 hardcoded credential, CWE-693
// protection-mechanism failure, CWE-352 CSRF all live in the SAME captured fixtures and MUST
// stay 'external-sast'; SSRF CWE-918 and path traversal CWE-22 belong to data-export per the
// injection-xss.md boundary, NOT here). The allowlist holds ONLY the CWE ids a captured
// fixture proves end-to-end — the repo routes only what a genuine scanner emitted on a minimal
// seeded sample (each id below cites the tool + rule that produced it).
//
// HONESTY CAVEAT (fixture = source of truth, and its scope is narrow): a green fixture proves
// the router handles the ONE RULE that fired on the seed — it is RULE-PATH-PROVEN, not
// class-proven. Scanners populate the CWE field inconsistently across rules for the same class,
// so a partner who hits the same class via a DIFFERENT rule (one with absent or different CWE
// metadata) can still route to 'external-sast'. `// fixture-pending` below means "no OSS rule
// emitted this id on a minimal seed"; it does NOT mean "every rule for the class emits it" —
// for an ACTIVE id, some rules of its class may still omit the CWE and thus not route.
//
// ROUTING ONLY — nothing else moves: the band/severity, the id hash, the reasoning, and the
// scan-external-sast gate are untouched, and ALL THREE consuming adapters (semgrep/bandit/
// njsscan) keep classify()→null. injection-xss is a MULTI-SHAPE dimension (SQL/SOQL, OS-command,
// XSS, code/eval, template/SSTI, NoSQL, URL-scheme shapes), so an owned class here would let a
// routed finding supersede a co-located LLM finding of a DIFFERENT injection shape via
// sameOwnedClass's dimension fallback — the exact over-supersede the regexploit adapter's design
// (the RD-non-supersession lock) already rejects. A class-less finding creates no owner and
// supersedes nothing (reconcile-provenance filters owners on classOf(f)).
// The single extensible CWE→dimension table (B5 · E0.1c). One row per fixture-proven CWE id;
// every SAST adapter routes through it via dimensionForCwes. Every ACTIVE id is proven by a
// GENUINE captured scanner run on a minimal seed — an id no OSS rule emits on a minimal seed
// stays `// fixture-pending` (comment only, NOT active) so the router never claims coverage a
// fixture doesn't back. classify() stays null on every SAST adapter, so a routed finding owns
// no class and supersedes nothing (see the multi-shape note above) regardless of its dimension.
export const CWE_TO_DIMENSION = {
  // ── injection-xss (methodology/dimensions/injection-xss.md) ──
  // The pre-0.8.62 allowlist, UNCHANGED — every id below already routed to injection-xss, and
  // the whole injection suite (INJ-allowlist + INJ-fixture-* + INJ-negative-* + SG/BN anchors)
  // proves the map moved none of it (behavior-identical refactor). Each id is fixture-proven.
  89: 'injection-xss', // SQL/SOQL injection (bandit issue_cwe.id integer; semgrep metadata.cwe 'CWE-89')
  78: 'injection-xss', // OS command injection (semgrep 'CWE-78'; bandit issue_cwe.id 78)
  79: 'injection-xss', // XSS (njsscan express_xss 'CWE-79'; semgrep raw-html-format/direct-response-write 'CWE-79')
  94: 'injection-xss', // code injection (bandit B701 jinja2_autoescape_false issue_cwe.id 94)
  95: 'injection-xss', // eval / dynamically-evaluated code (njsscan eval_nodejs 'CWE-95'; semgrep eval-injection 'CWE-95')
  96: 'injection-xss', // template / SSTI — statically-saved code (semgrep render-template-string 'CWE-96')
  643: 'injection-xss', // XPath injection (B5 · E0.1e-A, 0.8.63). semgrep 'CWE-643' from p/security-audit java tainted-xpath-from-http-request AND p/csharp csharp.dotnet.security.audit.xpath-injection; njsscan node_xpath_injection 'CWE-643' (xpath.parse() only). acceptance/fixtures/{semgrep-xpath-ldap,njsscan-xpath}-seeded.json. Python/Go/JS XPath have no OSS rule → E0.1e-B custom taint rules.
  90: 'injection-xss', // LDAP injection (B5 · E0.1e-A, 0.8.63). semgrep 'CWE-90' from p/security-audit java tainted-ldapi-from-http-request (taint) + ldap-injection (structural) AND p/csharp csharp.dotnet.security.audit.ldap-injection (DirectorySearcher.Filter). acceptance/fixtures/semgrep-xpath-ldap-seeded.json. Python/Go/JS LDAP have no OSS rule → E0.1e-B custom taint rules.
  943: 'injection-xss', // NoSQL / data-query injection (njsscan node_nosqli_js_injection 'CWE-943')
  // ── untrusted-deserialization (methodology/dimensions/untrusted-deserialization.md; B5 · E0.1c) ──
  // The deser family: native-object deserializers, XXE, JS prototype pollution. Each ACTIVE id
  // is proven by a genuine captured fixture (bandit 1.9.4 / semgrep 1.168.0 / njsscan 0.4.2 —
  // acceptance/fixtures/{bandit,semgrep,njsscan}-deser-seeded.json).
  502: 'untrusted-deserialization', // native-object deserialization — Python pickle (bandit B403/B301 issue_cwe.id 502; semgrep avoid-pickle 'CWE-502') AND Node node-serialize.unserialize (njsscan node_deserialize 'CWE-502'; semgrep express-third-party-object-deserialization 'CWE-502')
  611: 'untrusted-deserialization', // XXE / XML external entity (semgrep use-defused-xml 'CWE-611'). NOTE: bandit's XML rules (B314/B405) tag the SAME sink 'CWE-20', which stays external-sast (INJ-allowlist proves it) — a live illustration that scanners tag one class inconsistently across rules (the fixture, never a guessed CWE, is the source of truth).
  915: 'untrusted-deserialization', // JS prototype pollution as the OSS tool tags it: semgrep prototype-pollution-loop emits 'CWE-915' (Improperly Controlled Modification of Dynamically-Determined Object Attributes) on a minimal seed — NOT 1321. 1321 (the more specific id) is fixture-pending below.
  // fixture-pending / future (comment only — NOT active until a genuine fixture proves the id):
  //   injection-xss: 91 XML injection · 917/1336 expression-language / SSTI variants (the real tools
  //     tag server-side template injection as 96, not 917/1336). 643 XPath + 90 LDAP were PROMOTED
  //     (active above) in E0.1e-A once genuine Java/C#/Node fixtures emitted each — XML-91 stays
  //     LLM-residual (E0.1e-C); Python/Go/JS XPath+LDAP need custom taint rules (E0.1e-B).
  //   untrusted-deserialization: 1321 JS prototype pollution — semgrep emits 915 (above) for the
  //     prototype-pollution-loop rule and njsscan 0.4.2 has no prototype-pollution rule, so NO OSS
  //     rule emitted 1321 on a minimal seed. The Apex JSON.deserialize → sObject mass-assignment /
  //     BOPLA deser variant has NO OSS scanner rule at all (Code Analyzer/PMD don't cover it) → it
  //     stays an LLM-residual finding, never routed here (an LLM finding carries no scanner CWE and
  //     never reaches dimensionForCwes) — the honest uncovered sub-shape, same posture as the
  //     no-OSS-rule XPath/LDAP languages (Python/Go/JS) that E0.1e-B must cover with custom rules.
}
// A DERIVED view: the injection subset of the map. Kept so INJ-allowlist and any consumer that
// wants "just the injection ids" still reads a Set, while the map stays the single source of
// truth — the two can never drift (the behavior-identity assertion in INJ-allowlist locks it).
export const INJECTION_XSS_CWES = new Set(
  Object.entries(CWE_TO_DIMENSION)
    .filter(([, dim]) => dim === 'injection-xss')
    .map(([cwe]) => Number(cwe))
)
// Normalize a scanner-emitted CWE field to a set of integer CWE ids. Accepts the REAL
// captured shapes: bandit `issue_cwe.id` (an integer) and semgrep `extra.metadata.cwe`
// (a 'CWE-###[: title]' string OR an array of them). The string pattern is anchored, so
// 'CWE-789' reads as 789 (not 78) and a mid-sentence mention contributes nothing.
// Malformed/absent input contributes nothing — never a throw.
export function cweIdsOf(value) {
  const ids = new Set()
  const add = (v) => {
    if (Number.isInteger(v) && v > 0) ids.add(v)
    else if (typeof v === 'string') {
      const m = /^\s*CWE-(\d+)\b/i.exec(v)
      if (m) ids.add(Number(m[1]))
    }
  }
  if (Array.isArray(value)) for (const v of value) add(v)
  else add(value)
  return ids
}
// The routing decision: the FIRST CWE id present in CWE_TO_DIMENSION wins (a finding almost
// always carries exactly one CWE; cweIdsOf returns a Set, iterated in insertion order — the
// same first-match-wins semantics as the pre-0.8.62 early-return). Anything else — including a
// malformed or absent CWE, or a CWE with no map row — keeps the current 'external-sast' default.
export function dimensionForCwes(value) {
  for (const id of cweIdsOf(value)) {
    const dim = CWE_TO_DIMENSION[id]
    if (dim) return dim
  }
  return 'external-sast'
}

// ----------------------------------------------------------------------------
// ADAPTER #4 — semgrep (file-parser, Phase 2 · 2a #2): parses captured Semgrep JSON.
// Semgrep is the toolkit's multi-language SAST keystone (run-scans Family 7 over each
// non-package source root, with the security rulesets p/security-audit / p/secrets / p/<lang>).
// It is the FIRST genuine TOOL→BAND adapter: unlike Code Analyzer (Apex rules → 3 wobbled
// CLASSES) and Checkov (severity:null → class), Semgrep carries a real per-result severity
// (`ERROR`/`WARNING`/`INFO`), which IS the honest per-finding signal for general SAST. So a
// Semgrep hit owns NO toolkit class — `classify()` is constant `null`:
//   - it must NOT map to a `fail-*` blocker class (that would over-escalate every SAST hit
//     to a class-high/critical), and
//   - its severity source is the tool band (SEMGREP_SEVERITY_TO_FINDING), not a class.
// Owning no class, a Semgrep finding SUPERSEDES nothing (reconcile-provenance only supersedes
// in an OWNED class) — so de-duplicating a co-located LLM injection finding against a Semgrep
// finding is cross-engine dedup = roadmap §10 extension #3 (Phase-2b), NOT this slice; the SAFE
// under-merge (a duplicate may survive in the band), never a dropped scanner finding.
// dimension: 'external-sast' stays the DETERMINISTIC-ONLY grouping label (like checkov's
// 'infrastructure-iac') for the general case — Semgrep spans many vuln classes, and an honest
// "external SAST" grouping beats false-precision dimensioning where the class is uncertain.
// The ONE fixture-proven exception (B5 · E0.1b, 0.8.58): a result whose `extra.metadata.cwe`
// carries an allowlisted injection CWE routes PER HIT to the REAL `injection-xss` dimension
// via dimensionForCwes (exact integer-CWE membership — see the routing block above). ROUTING
// ONLY: classify() stays null, so a routed finding owns no class and supersedes nothing; the
// gate, band, and id are untouched. The schema declares `dimension` a free kebab-case string.
// Like checkov/metadata it is SECURITY-BY-CONSTRUCTION (the security rulesets), so NO
// `securityRelevant` — the ingest core keeps every emitted hit. Only `results[]` become findings.
//
// ---- reachability-path normalization (B5 · E0.1, 0.8.57) ----
// A Semgrep taint-mode result can carry `extra.dataflow_trace` — the ordered source→sink
// dataflow path the engine computed. That path is the deterministic reachability substrate
// the residual-shrinking slices consume, so the adapter captures it as a `reachabilityPath`
// attribute instead of discarding it. The REAL captured shape (semgrep 1.85.0 JSON, fixture
// acceptance/fixtures/semgrep-taint-seeded.json):
//   taint_source / taint_sink — a TAGGED PAIR: ['CliLoc', [ { path, start:{line,col,offset},
//                               end:{…} }, '<matched content>' ]] (the pair's second element
//                               carries the location object first);
//   intermediate_vars         — [ { content, location: { path, start:{line,…}, end:{…} } }, … ]
//                               (may be empty).
// _traceStep normalizes ANY of those step encodings to { file, line }; the content strings
// are DROPPED — the attribute records WHERE the path runs, never source text. Newer Semgrep
// CLIs serialize the trace to text/SARIF output only (their --json omits it); a capture from
// one carries no attribute — the designed degradation: an absent or malformed trace yields
// null (no attribute, base finding unchanged), NEVER a throw.
const _traceStep = (x, depth = 0) => {
  if (x == null || depth > 4) return null
  if (Array.isArray(x)) {
    // tagged pair ['CliLoc', [location, content]] → recurse into the tagged value; a bare
    // [location, …] value → recurse into its first element.
    if (typeof x[0] === 'string' && x.length > 1) return _traceStep(x[1], depth + 1)
    return _traceStep(x[0], depth + 1)
  }
  if (!_isObj(x)) return null
  if (x.location) return _traceStep(x.location, depth + 1)
  const file = typeof x.path === 'string' && x.path ? x.path : null
  const line = _isObj(x.start) && Number.isInteger(x.start.line) && x.start.line >= 1 ? x.start.line : null
  return file && line ? { file, line } : null
}
function _reachabilityPath(trace) {
  if (!_isObj(trace)) return null
  const source = _traceStep(trace.taint_source)
  const sink = _traceStep(trace.taint_sink)
  if (!source || !sink) return null // a path needs BOTH ends — anything less attaches nothing
  const intermediate = (Array.isArray(trace.intermediate_vars) ? trace.intermediate_vars : [])
    .map((v) => _traceStep(v))
    .filter(Boolean) // a malformed middle step is skipped; the proven ends still stand
  return { source, intermediate, sink }
}

// ---- SARIF codeFlows reachability normalization (B5 · E0.2b, 0.8.61) ----
// The engine-agnostic sibling of _traceStep/_reachabilityPath: SARIF 2.1.0 standardizes the
// taint path as `result.codeFlows[] → threadFlows[] → locations[]` (threadFlowLocation), and
// opengrep, semgrep-Pro, and CodeQL (`@kind path-problem`) all emit that IDENTICAL shape — so
// ONE normalizer covers every SARIF-emitting engine, current and future. Steps are ordered by
// `executionOrder` when every location carries one (SARIF: absent means unspecified), else by
// array order (the captured opengrep 1.25.0 fixture has no executionOrder — array order IS the
// flow order); `[0]` = source, `[last]` = sink, the middle steps are the intermediates. Every
// sub-object on this path is spec-OPTIONAL ("MAY"), so each access is guarded: zero/malformed
// codeFlows → null (no attribute, base finding unchanged), NEVER a throw. Multiple
// codeFlows/threadFlows (CodeQL emits several per result) → take `[0]` — one proven path is the
// attribute's contract; enumerating alternates is a future refinement, not a correctness gap.
// `artifactLocation.uri` is used VERBATIM (minus a defensive file:// scheme-strip): the captured
// engines emit repo-relative URIs (uriBaseId %SRCROOT%), which is exactly the locus shape every
// adapter emits — resolving against `originalUriBaseIds` would re-embed the SCAN HOST's absolute
// path into the ledger, the opposite of the genericization rule. Code snippets/messages DROPPED
// (locations only), same discipline as _traceStep.
const _sarifTraceStep = (tfl) => {
  if (!_isObj(tfl)) return null
  const loc = _isObj(tfl.location) ? tfl.location : null
  const phys = loc && _isObj(loc.physicalLocation) ? loc.physicalLocation : null
  if (!phys) return null
  const art = _isObj(phys.artifactLocation) ? phys.artifactLocation : null
  const uri = art && typeof art.uri === 'string' ? art.uri.replace(/^file:\/\//, '') : ''
  const region = _isObj(phys.region) ? phys.region : null
  const rawLine = region ? region.startLine : null
  // coerce a numeric-string startLine (a producer quirk SARIF consumers tolerate); ≥1 or nothing
  const line = Number.isInteger(rawLine)
    ? rawLine
    : typeof rawLine === 'string' && /^\d+$/.test(rawLine)
      ? parseInt(rawLine, 10)
      : null
  return uri && Number.isInteger(line) && line >= 1 ? { file: uri, line } : null
}
function _sarifReachabilityPath(result) {
  if (!_isObj(result) || !Array.isArray(result.codeFlows)) return null
  const flow = _isObj(result.codeFlows[0]) ? result.codeFlows[0] : null
  const threads = flow && Array.isArray(flow.threadFlows) ? flow.threadFlows : []
  const thread = _isObj(threads[0]) ? threads[0] : null
  const locs = thread && Array.isArray(thread.locations) ? thread.locations : []
  if (locs.length < 2) return null // a 1-step flow has no source→sink pair to relay
  // executionOrder ONLY when every step carries an integer one (mixed presence = unspecified
  // relative order per spec → keep array order); the sort is stable, so ties keep array order
  const ordered = locs.every((l) => _isObj(l) && Number.isInteger(l.executionOrder))
    ? [...locs].sort((a, b) => a.executionOrder - b.executionOrder)
    : locs
  const steps = ordered.map((l) => _sarifTraceStep(l))
  const source = steps[0]
  const sink = steps[steps.length - 1]
  if (!source || !sink) return null // same contract as _reachabilityPath: BOTH ends or nothing
  const intermediate = steps.slice(1, -1).filter(Boolean) // a malformed middle step is skipped
  return { source, intermediate, sink }
}
export const semgrepAdapter = {
  name: 'semgrep',
  kind: 'file-parser',
  // CONTENT-SHAPE recognizer for --all: a results[] array whose elements carry `check_id` (the SAST
  // trio is keyed by element when non-empty); an EMPTY results[] is still semgrep via its top markers.
  detect: (r) => {
    const a = _resultsArr(r)
    return !!a && (a.length > 0 ? a[0] && a[0].check_id !== undefined : _semgrepMarks(r))
  },
  collect({ input } = {}) {
    if (!input) return null
    try {
      const txt = readFileSync(input, 'utf8')
      if (!txt.trim()) return null
      return JSON.parse(txt)
    } catch {
      return null
    }
  },
  parse(raw) {
    if (!raw || !Array.isArray(raw.results)) return []
    const hits = []
    for (const r of raw.results) {
      // Skip a malformed result with no check_id (the ingest core also drops a hit with no
      // file, with an honest note — that is correct).
      if (!r || r.check_id == null) continue
      const extra = r && r.extra && typeof r.extra === 'object' ? r.extra : {}
      const metadata = extra.metadata && typeof extra.metadata === 'object' ? extra.metadata : {}
      const sev = extra.severity
      const refs =
        Array.isArray(metadata.references) && metadata.references[0] ? [String(metadata.references[0])] : []
      const hit = {
        engine: 'semgrep',
        ruleId: String(r.check_id),
        severityNum: null, // Semgrep has no 1-5 number; the band comes from extra.severity
        file: r.path,
        startLine: r.start && Number.isInteger(r.start.line) ? r.start.line : null,
        message: String((extra && extra.message) || ''),
        resources: refs,
        bandFromTool: SEMGREP_SEVERITY_TO_FINDING[sev] || 'info', // unknown/INVENTORY → info, never dropped
        toolSevLabel: String(sev || 'unknown'),
        // per-hit CWE routing (B5 · E0.1b): an allowlisted injection CWE → 'injection-xss';
        // everything else (including a malformed/absent CWE) keeps 'external-sast'
        dimensionHint: dimensionForCwes(metadata.cwe),
        tags: [],
      }
      // B5 · E0.1: capture the taint-mode source→sink dataflow path when the result carries
      // one. Wrapped so a malformed trace can NEVER take down the base finding — extraction
      // failure = no attribute, nothing else changes.
      let reachabilityPath = null
      try {
        reachabilityPath = _reachabilityPath(extra.dataflow_trace)
      } catch {
        reachabilityPath = null
      }
      if (reachabilityPath) hit.reachabilityPath = reachabilityPath
      hits.push(hit)
    }
    return hits
  },
  // Constant null: a Semgrep finding owns NO toolkit class (its severity is the tool band, and
  // it must not over-escalate onto a fail-* blocker class). Owning no class, it supersedes nothing.
  classify() {
    return null
  },
  // NO securityRelevant — security-by-construction (the security rulesets), like checkov/metadata.
  // B5 · item 7 — the substrate-unavailable contract: Semgrep/Opengrep JSON carries NO
  // `mode: taint` marker on results, so "a taint rule fired" is generally UNKNOWABLE from the
  // output alone. The ONE deterministic exception is the toolkit's OWN rule pack
  // (rules/injection/*.yaml — every rule `mode: taint`), whose emitted check_ids carry the
  // `rules.injection.` prefix (the path-derived id semgrep assigns a --config directory).
  // expectsTrace marks EXACTLY those hits; registry/third-party rules stay OUT — their
  // taintness is unknowable, and the marker never guesses.
  expectsTrace(hit) {
    return typeof hit.ruleId === 'string' && hit.ruleId.startsWith('rules.injection.')
  },
}

// ----------------------------------------------------------------------------
// ADAPTER #14 — opengrep (file-parser, B5 · E0.2b, 0.8.61): the HONEST ENGINE LABEL for
// Opengrep's `--json` output. Opengrep (the LGPL-2.1, consortium-governed Semgrep fork) emits
// JSON that is BYTE-SHAPE-COMPATIBLE with Semgrep CE's — verified on the captured fixture pair:
// identical top-level keys, identical `results[].extra.*` keys, `engine_kind: 'OSS'` on BOTH —
// so NO content shape can distinguish the two engines' JSON, and this adapter deliberately
// carries NO `detect` (like metadata-viewall it is invisible to recognizeScanner; the format
// recognizer honestly routes the SHAPE to 'semgrep'). Provenance instead comes from the two
// places that genuinely know the producer:
//   1. the explicit `--scanner opengrep --input …` CLI form (the operator names the engine), and
//   2. ingestAll's evidence-name refinement: a semgrep-SHAPED file captured under the documented
//      `opengrep-<date>.json` evidence name (run-scans Family 7) re-labels to this adapter — the
//      FILENAME refines only the LABEL, never the routing (a renamed capture still ingests
//      correctly as the semgrep FORMAT; it just keeps the semgrep label — the honest ceiling of
//      an indistinguishable format, noted in the ingest output).
// parse DELEGATES to semgrepAdapter.parse verbatim (dataflow_trace→reachabilityPath, CWE routing,
// tool→band — all identical semantics; Opengrep emits `extra.dataflow_trace` in `--json` even
// without `--dataflow-traces`, verified 1.25.0) and re-labels `engine: 'opengrep'` — so the
// finding id (engine+ruleId+file:line) honestly attributes the producer, and an opengrep JSON +
// SARIF capture of the SAME hit converge on the SAME id (cross-surface dedup by construction).
export const opengrepAdapter = {
  name: 'opengrep',
  kind: 'file-parser',
  // NO detect — see above: opengrep JSON is content-indistinguishable from semgrep JSON.
  collect({ input } = {}) {
    if (!input) return null
    try {
      const txt = readFileSync(input, 'utf8')
      if (!txt.trim()) return null
      return JSON.parse(txt)
    } catch {
      return null
    }
  },
  parse(raw) {
    return semgrepAdapter.parse(raw).map((h) => ({ ...h, engine: 'opengrep' }))
  },
  // Constant null, same reasoning as semgrep: tool→band, owns no class, supersedes nothing.
  classify() {
    return null
  },
  // NO securityRelevant — security-by-construction (the security rulesets), like semgrep.
  // B5 · item 7: the ingest core reads hooks off THE ADAPTER OBJECT, so the parse-delegation
  // above does NOT inherit them — and ingestAll routes opengrep-*.json evidence through THIS
  // adapter, so without its own expectsTrace the substrate marker would silently vanish on
  // the opengrep surface. Same rule-pack prefix contract as semgrep (the check_ids are
  // identical either way — the id comes from the --config path, not the engine).
  expectsTrace: semgrepAdapter.expectsTrace,
  // B5 · item 7 — the version-drift contract: recorded∩pinned = opengrep ONLY. Opengrep JSON
  // records the producing version at top-level `version`, and install-scanners.mjs sha256-pins
  // the opengrep binary — the one ingest-adapter tool where "evidence version ≠ pinned install"
  // is both knowable and meaningful. Every other adapter is deliberately OUT of the drift
  // check: the pip tools (semgrep/checkov/detect-secrets/bandit/njsscan/regexploit) install
  // floating-latest (`version: null` by design — nothing to drift from), gitleaks/osv/trivy
  // record no version in their output, and code-analyzer's per-engine versions vs the plugin
  // pin are a namespace mismatch. No hook on those adapters = no check, by design.
  recordedVersion(raw) {
    return _isObj(raw) && typeof raw.version === 'string' ? raw.version : null
  },
}

// ----------------------------------------------------------------------------
// ADAPTER #5 — bandit (file-parser, Phase 2 · 2a #3): parses captured Bandit JSON.
// Bandit is the toolkit's Python language-gate SAST tool (run-scans Family 7, alongside
// Semgrep/njsscan/gosec). It is the THIRD adapter and the SECOND genuine TOOL→BAND adapter —
// the PROOF the Semgrep tool→band generalization GENERALIZES: bandit reuses buildFinding's
// `bandFromTool` path with ZERO harness-core change (one new adapter + one severity map). Like
// Semgrep it carries a real per-result severity (`HIGH`/`MEDIUM`/`LOW`, via
// BANDIT_SEVERITY_TO_FINDING) which IS the honest per-finding signal for general SAST, so a Bandit
// hit owns NO toolkit class — `classify()` is constant `null`:
//   - it must NOT map to a `fail-*` blocker class (that would over-escalate every SAST hit), and
//   - its severity source is the tool band, not a class (gated by scan-external-sast = major).
// Owning no class, a Bandit finding SUPERSEDES nothing (cross-engine dedup is roadmap §10 ext #3,
// Phase-2b — the SAFE under-merge). dimension: the same per-hit CWE routing as Semgrep (B5 ·
// E0.1b, 0.8.58) — an allowlisted `issue_cwe.id` (an integer in the real captured shape) routes
// the hit to `injection-xss` via dimensionForCwes; every other hit keeps the deterministic-only
// 'external-sast' grouping label (Python SAST belongs to the same external-endpoint SAST grouping). Like
// semgrep/checkov/metadata it is SECURITY-BY-CONSTRUCTION (Bandit is a security scanner), so NO
// `securityRelevant` — the ingest core keeps every emitted hit. Only `results[]` become findings.
// `issue_confidence` is recorded by Bandit but deliberately NOT band-weighting here (Phase-2b note).
// Test-path predicate for the bandit hygiene filter (0.8.83) — SEGMENT-ANCHORED, never a
// substring match: a path is a test path iff a whole '/'-segment is `test`/`tests`/`__tests__`
// or the basename is `test_*.py` / `*_test.py` / `conftest.py`. So `latest/`, `contest/`,
// `mytest.py` do NOT match. Works on absolute or relative paths (the raw pre-repoRoot-strip
// filename bandit emits).
function isTestPath(file) {
  const segs = String(file || '').split('/')
  if (segs.some((s) => s === 'test' || s === 'tests' || s === '__tests__')) return true
  const base = segs[segs.length - 1] || ''
  return /^test_.*\.py$/.test(base) || /_test\.py$/.test(base) || base === 'conftest.py'
}

export const banditAdapter = {
  name: 'bandit',
  kind: 'file-parser',
  // CONTENT-SHAPE recognizer for --all: a results[] array whose elements carry `test_id`; an EMPTY
  // results[] is bandit via metrics+generated_at top markers, AND-NOT semgrep's (priority order).
  detect: (r) => {
    const a = _resultsArr(r)
    return !!a && (a.length > 0 ? a[0] && a[0].test_id !== undefined : _banditMarks(r) && !_semgrepMarks(r))
  },
  collect({ input } = {}) {
    if (!input) return null
    try {
      const txt = readFileSync(input, 'utf8')
      if (!txt.trim()) return null
      return JSON.parse(txt)
    } catch {
      return null
    }
  },
  parse(raw) {
    if (!raw || !Array.isArray(raw.results)) return []
    const hits = []
    for (const r of raw.results) {
      // Skip a malformed result with no test_id (the ingest core also drops a hit with no
      // file, with an honest note — that is correct).
      if (!r || r.test_id == null) continue
      const cwe = r.issue_cwe && typeof r.issue_cwe === 'object' ? r.issue_cwe : null
      const resources = r.more_info
        ? [String(r.more_info)]
        : cwe && cwe.link
          ? [String(cwe.link)]
          : []
      const sev = r.issue_severity
      hits.push({
        engine: 'bandit',
        ruleId: String(r.test_id),
        severityNum: null, // Bandit has no 1-5 number; the band comes from issue_severity
        file: r.filename,
        startLine: Number.isInteger(r.line_number) ? r.line_number : null,
        message: String(r.issue_text || r.test_name || ''),
        resources,
        bandFromTool: BANDIT_SEVERITY_TO_FINDING[sev] || 'info', // unknown/missing → info, never dropped
        toolSevLabel: String(sev || 'unknown'),
        // per-hit CWE routing (B5 · E0.1b): an allowlisted issue_cwe.id → 'injection-xss';
        // everything else (including a malformed/absent CWE) keeps 'external-sast'
        dimensionHint: dimensionForCwes(cwe && cwe.id),
        tags: [],
      })
    }
    return hits
  },
  // Constant null: a Bandit finding owns NO toolkit class (its severity is the tool band, and it
  // must not over-escalate onto a fail-* blocker class). Owning no class, it supersedes nothing.
  classify() {
    return null
  },
  // NO securityRelevant — security-by-construction (Bandit is a security scanner), like semgrep/checkov/metadata.
  // Test-path LOW hygiene (cold-run fix, 0.8.83): a DISTINCT hook — deliberately NOT
  // `securityRelevant` (the BN-adapter-contract pins that as undefined; bandit stays
  // security-by-construction). The separating axis is PATH × band: bandit's own LOW band
  // (B101 assert_used / B404 blacklist-import) under a test path is hygiene lint, not a
  // security finding — on the cold-run target it was ~93.6% of the whole deterministic band.
  // NEVER a severity floor: a prod-path LOW (B105/B106/B107 hardcoded password) and every
  // test-path MEDIUM/HIGH ingest unchanged. Bandit-only; not generalized to semgrep/njsscan.
  hygieneNoise(hit) {
    return Boolean(hit && hit.bandFromTool === 'low' && isTestPath(hit.file))
  },
}

// ----------------------------------------------------------------------------
// ADAPTER #6 — njsscan (file-parser, Phase 2 · 2a #4): parses captured njsscan JSON.
// njsscan is the toolkit's Node language-gate SAST tool (run-scans Family 7, alongside
// Semgrep/Bandit/gosec). It is the THIRD genuine TOOL→BAND adapter — it reuses buildFinding's
// `bandFromTool` path with ZERO harness-core change (one new adapter + the NJSSCAN_SEVERITY_TO_FINDING
// map). Like Semgrep/Bandit it carries a real per-finding severity (`ERROR`/`WARNING`/`INFO`, via
// NJSSCAN_SEVERITY_TO_FINDING) which IS the honest per-finding signal for general SAST, so an njsscan
// hit owns NO toolkit class — `classify()` is constant `null` (it must not over-escalate onto a
// `fail-*` blocker class; its severity source is the tool band, gated by scan-external-sast = major).
// Owning no class, an njsscan finding SUPERSEDES nothing (cross-engine dedup is roadmap §10 ext #3,
// Phase-2b — the SAFE under-merge). dimension: the same per-hit CWE routing as Semgrep/Bandit (B5 ·
// E0.1b-EXPAND, 0.8.59) — an allowlisted `metadata.cwe` (njsscan's real 'CWE-###: …' string shape)
// routes the hit to `injection-xss` via dimensionForCwes; every other hit keeps the deterministic-only
// 'external-sast' grouping label. Like Semgrep/Bandit it is SECURITY-BY-CONSTRUCTION (njsscan is a
// security scanner), so NO `securityRelevant` — the ingest core keeps every emitted hit.
//
// THE ONE NEW SHAPE: njsscan's JSON is a NESTED OBJECT, not a flat `results[]`. The top level is
// `{ errors, njsscan_version, nodejs:{…}, templates:{…} }`; `nodejs` and `templates` are each an
// OBJECT keyed by rule_id, whose value is `{ files:[{file_path, match_lines:[start,end], …}],
// metadata:{ cwe, description, "owasp-web", severity } }`. BOTH sections are read; a rule can list
// MULTIPLE files (multiple occurrences) → each file occurrence is a distinct finding. The CWE
// reference URL is derived from a `CWE-###` prefix in `metadata.cwe` when present (else no resource).
export const njsscanAdapter = {
  name: 'njsscan',
  kind: 'file-parser',
  // CONTENT-SHAPE recognizer for --all: njsscan's nested object — `njsscan_version` present, or both
  // the `nodejs` and `templates` sections present (its rule_id-keyed shape, NOT a flat results[]).
  detect: (r) => _isObj(r) && (r.njsscan_version != null || (_isObj(r.nodejs) && _isObj(r.templates))),
  collect({ input } = {}) {
    if (!input) return null
    try {
      const txt = readFileSync(input, 'utf8')
      if (!txt.trim()) return null
      return JSON.parse(txt)
    } catch {
      return null
    }
  },
  parse(raw) {
    if (!raw || typeof raw !== 'object') return []
    const hits = []
    // iterate BOTH sections; each is an object keyed by rule_id (defensive: may be absent/null/non-object)
    for (const section of ['nodejs', 'templates']) {
      const rules = raw[section]
      if (!rules || typeof rules !== 'object') continue
      for (const ruleId of Object.keys(rules)) {
        const ruleObj = rules[ruleId]
        if (!ruleObj || typeof ruleObj !== 'object') continue
        const md = ruleObj.metadata && typeof ruleObj.metadata === 'object' ? ruleObj.metadata : {}
        const sev = md.severity
        const files = Array.isArray(ruleObj.files) ? ruleObj.files : []
        for (const f of files) {
          if (!f || !f.file_path) continue // a hit with no file is dropped here (mirrors the ingest core)
          const ml = Array.isArray(f.match_lines) ? f.match_lines : null
          // derive the CWE reference URL from "CWE-###: …" if present, else no resource
          const cweNum = typeof md.cwe === 'string' ? (md.cwe.match(/CWE-(\d+)/) || [])[1] : null
          hits.push({
            engine: 'njsscan',
            ruleId: String(ruleId),
            severityNum: null, // njsscan has no 1-5 number; the band comes from metadata.severity
            file: f.file_path,
            startLine: ml && Number.isInteger(ml[0]) ? ml[0] : null,
            message: String(md.description || ruleId),
            resources: cweNum ? [`https://cwe.mitre.org/data/definitions/${cweNum}.html`] : [],
            bandFromTool: NJSSCAN_SEVERITY_TO_FINDING[sev] || 'info', // unknown/missing → info, never dropped
            toolSevLabel: String(sev || 'unknown'),
            // per-hit CWE routing (B5 · E0.1b-EXPAND, 0.8.59): an allowlisted metadata.cwe (the real
            // 'CWE-###: …' string shape — the SAME shape cweIdsOf already normalizes, so no helper
            // change) → 'injection-xss'; everything else (incl. a malformed/absent CWE) → 'external-sast'
            dimensionHint: dimensionForCwes(md.cwe),
            tags: [],
          })
        }
      }
    }
    return hits
  },
  // Constant null: an njsscan finding owns NO toolkit class (its severity is the tool band, and it
  // must not over-escalate onto a fail-* blocker class). Owning no class, it supersedes nothing.
  classify() {
    return null
  },
  // NO securityRelevant — security-by-construction (njsscan is a security scanner), like semgrep/bandit/checkov/metadata.
}

// ----------------------------------------------------------------------------
// ADAPTER #7 — gitleaks (file-parser, Phase 2 · 2a #5): parses captured gitleaks JSON.
// gitleaks is the toolkit's hardcoded-secret scanner (run-scans Family 6, tree + git-history). It is
// a DESIGN PIVOT BACK to CLASS-severity (like checkov, NOT the semgrep/bandit/njsscan tool→band path):
// a secret carries no per-finding severity tier — every hit is "a secret is present" — so severity
// comes from the `fail-hardcoded-secrets` CLASS (major → high), exactly as Checkov grounds in
// scan-iac-misconfig. So `classify()` is the CONSTANT 'hardcoded-secrets' (every gitleaks hit is one),
// there is no `securityRelevant` (security-by-construction), and there is NO `buildFinding`/`CLASS_DEFS`-
// machinery change — it rides the existing MAPPED-class severity path. Two things make it distinct:
//   (1) a hardcoded-secret maps cleanly onto a REAL methodology dimension (`secrets-credentials`), so —
//       unlike the deterministic-only `external-sast` label — this adapter OWNS a class AND a real
//       dimension and therefore SUPERSEDES a co-located LLM `secrets-credentials` finding (the first
//       adapter to enforce, for its class, that the LLM never re-reports what the scanner determined).
//   (2) gitleaks output CONTAINS THE LIVE SECRET — `Match` (the matched line) and `Secret` (the raw
//       value) — plus commit PII on history scans (`Author`/`Email`/`Message`). THE SECRET MUST NEVER
//       REACH THE LEDGER (the defining requirement of this slice). The PRIMARY control is structural:
//       `parse()` builds each hit from ONLY the non-sensitive fields (RuleID, File, StartLine,
//       Description) and DELIBERATELY NEVER reads Match/Secret/Message/Author/Email into ANY field, so
//       no secret/PII is ever handed to `buildFinding`. `buildFinding`'s `redact()` is a defense-in-
//       depth BACKSTOP, not the primary control. `message` is the rule `Description` (a generic rule
//       sentence — it never contains the secret). gitleaks gives no reference URL → resources is [].
// Cross-DETERMINISTIC-engine dedup (the same secret found by gitleaks AND njsscan's `node_secret`) is
// roadmap §10 extension #3 (Phase-2b — the safe under-merge), NOT this slice. Input is a JSON ARRAY.
export const gitleaksAdapter = {
  name: 'gitleaks',
  kind: 'file-parser',
  // CONTENT-SHAPE recognizer for --all: a top-level ARRAY whose first element carries `RuleID`
  // (disambiguates vs a checkov multi-framework array's `check_type`); an empty `[]` → gitleaks
  // (a clean secret scan; 0 findings, harmless).
  detect: (r) => Array.isArray(r) && (r.length === 0 || (_isObj(r[0]) && r[0].RuleID != null)),
  collect({ input } = {}) {
    if (!input) return null
    try {
      const txt = readFileSync(input, 'utf8')
      if (!txt.trim()) return null
      return JSON.parse(txt)
    } catch {
      return null
    }
  },
  parse(raw) {
    if (!Array.isArray(raw)) return [] // gitleaks output is a JSON ARRAY of findings
    const hits = []
    for (const f of raw) {
      if (!f || f.RuleID == null || !f.File) continue // the ingest core also drops a hit with no file
      hits.push({
        engine: 'gitleaks',
        ruleId: String(f.RuleID),
        severityNum: null, // no tool tier — class-severity (fail-hardcoded-secrets → high)
        file: f.File,
        startLine: Number.isInteger(f.StartLine) ? f.StartLine : null,
        message: String(f.Description || f.RuleID), // Description ONLY — NEVER Match/Secret/Message
        resources: [], // gitleaks gives no reference URL
        tags: [],
      })
      // DELIBERATELY ABSENT from the hit: Match, Secret, Message, Author, Email — the secret-never-
      // leaks invariant. The adapter must never hand a secret/PII to buildFinding (redact() is only a
      // backstop). Do NOT add any of those fields here, even "for context".
    }
    return hits
  },
  // Constant: every gitleaks hit is a hardcoded secret — owns the `hardcoded-secrets` class, whose
  // severity is the class (fail-hardcoded-secrets → high) and whose real dimension is secrets-credentials.
  classify() {
    return 'hardcoded-secrets'
  },
  // NO securityRelevant — security-by-construction (every gitleaks hit is a secret), like checkov/metadata.
}

// ----------------------------------------------------------------------------
// ADAPTER #8 — detect-secrets (file-parser, Phase 2 · 2a #6): parses captured detect-secrets JSON.
// detect-secrets is the toolkit's SECOND hardcoded-secret scanner (run-scans Family 6, alongside
// gitleaks). It is the same vuln class — a hardcoded secret — so it REUSES the `hardcoded-secrets` class
// gitleaks added (NO new `CLASS_DEFS` entry, NO `buildFinding` change): a CLASS-severity adapter (like
// checkov/gitleaks, NOT the SG/BN/NJ tool→band path), severity from the `fail-hardcoded-secrets` CLASS
// (major → high) via a CONSTANT `classify()`→`'hardcoded-secrets'`, NO tag filter (security-by-construction).
// Like gitleaks it OWNS a class AND the REAL `secrets-credentials` methodology dimension, so it SUPERSEDES a
// co-located LLM `secrets-credentials` finding. The ONLY shared-file touch is the `ADAPTERS` registry line.
// TWO things make it distinct from gitleaks:
//   (1) detect-secrets' OWN nested-object JSON: `{ results: { <file>: [occurrence, …] } }` — `results` is an
//       OBJECT keyed by FILE (each value an array of occurrences), NOT gitleaks' flat top-level ARRAY. Hence
//       its own `parse` that iterates the file keys then each occurrence; no harness-core change.
//   (2) with TWO secrets engines now live, the same secret at one locus produces TWO deterministic ledger
//       rows (one per engine). `reconcile-provenance` does NOT collapse them — it only supersedes an
//       `llm-inferred` finding, and a deterministic finding never supersedes another deterministic finding —
//       so the cross-engine duplicate is VISIBLE (the SAFE under-merge — no engine silently hides another's
//       finding). Collapsing gitleaks↔detect-secrets↔njsscan `node_secret` is cross-engine dedup = §10
//       extension #3 (Phase-2b), NOT this slice. (detect-secrets DOES still supersede a co-located *LLM*
//       secrets finding — that part is wired via the shared `hardcoded-secrets` class, same as gitleaks.)
// THE SECRET/HASH-NEVER-LEAKS INVARIANT (same as gitleaks). A detect-secrets occurrence carries a
// `hashed_secret` (a SHA of the secret — leak-safe by detect-secrets' design) and, if scanned with
// `--show-secrets`, could carry plaintext. The adapter builds each hit from ONLY `type`, the file path, and
// `line_number`, and DELIBERATELY never passes `hashed_secret` (or any plaintext field) into ANY finding
// field; `message` names the `type` only — never the hash. (`buildFinding`'s `redact()` is a defense-in-
// depth BACKSTOP, not the primary control.) Input is a JSON OBJECT (`{ results: {<file>: [...] } }`).
export const detectSecretsAdapter = {
  name: 'detect-secrets',
  kind: 'file-parser',
  // CONTENT-SHAPE recognizer for --all: detect-secrets' `plugins_used` present with a `results` OBJECT
  // (keyed by file — NOT an array, so the SAST trio's _resultsArr never matches it).
  detect: (r) => _isObj(r) && r.plugins_used != null && _isObj(r.results),
  collect({ input } = {}) {
    if (!input) return null
    try {
      const txt = readFileSync(input, 'utf8')
      if (!txt.trim()) return null
      return JSON.parse(txt)
    } catch {
      return null
    }
  },
  parse(raw) {
    const results = raw && typeof raw === 'object' ? raw.results : null
    // `results` MUST be an object keyed by file (NOT an array, NOT null) — detect-secrets' own shape
    if (!results || typeof results !== 'object' || Array.isArray(results)) return []
    const hits = []
    for (const filePath of Object.keys(results)) {
      const occs = Array.isArray(results[filePath]) ? results[filePath] : []
      for (const o of occs) {
        if (!o || o.type == null) continue // need a detector type (e.g. 'Secret Keyword')
        const file = o.filename || filePath // they match; prefer the occurrence's own filename
        if (!file) continue // the ingest core also drops a hit with no file
        hits.push({
          engine: 'detect-secrets',
          ruleId: String(o.type), // e.g. 'Secret Keyword', 'Hex High Entropy String', 'Base64 High Entropy String'
          severityNum: null, // no tool tier — class-severity (fail-hardcoded-secrets → high)
          file,
          startLine: Number.isInteger(o.line_number) ? o.line_number : null,
          message: `detect-secrets flagged a possible ${o.type} (hardcoded secret).`, // NEVER hashed_secret/plaintext
          resources: [], // detect-secrets gives no reference URL
          tags: [],
        })
        // DELIBERATELY ABSENT from the hit: hashed_secret, is_verified, any plaintext (--show-secrets) — the
        // secret/hash-never-leaks invariant. Do NOT add any of those here, even "for context".
      }
    }
    return hits
  },
  // Constant: every detect-secrets hit is a hardcoded secret — REUSES the `hardcoded-secrets` class gitleaks
  // added (NO new CLASS_DEFS entry), whose severity is the class (fail-hardcoded-secrets → high) and whose
  // real dimension is secrets-credentials. One class definition, two adapters.
  classify() {
    return 'hardcoded-secrets'
  },
  // NO securityRelevant — security-by-construction (every detect-secrets hit is a secret), like gitleaks/checkov/metadata.
}

// ----------------------------------------------------------------------------
// ADAPTER #9 — osv (file-parser, Phase 2 · 2a #7): parses captured OSV-Scanner JSON.
// OSV-Scanner is the toolkit's dependency-CVE / SCA scanner (run-scans Family 8, over every lockfile —
// requirements.txt / package-lock.json / go.sum / … — under a non-package source root). It is the SEVENTH
// §10 adapter and forces **Extension A: the CVSS→enum severity fork**: unlike the SAST family (tool tier
// ERROR/WARNING/INFO → band) and the class-severity adapters (checkov/secrets → class), a dep CVE carries a
// REAL CVSS base score, while the only CLASS severity (scan-external-sca = major) is a *missing-scan* GATE
// severity. So the per-FINDING band is PER-ADVISORY (`severityKind:'advisory'`) — resolved from the
// advisory's CVSS via CVSS_SCORE_TO_FINDING — and the class governs ONLY the gate (carried as
// `gateLabel:'scan-external-sca'` on each hit). It REUSES buildFinding's `bandFromTool` path EXACTLY like
// semgrep/bandit/njsscan (classify()→null, no securityRelevant, a dimensionHint, severityNum:null) — the
// band SOURCE is the only difference (CVSS, not a tool tier) — so the ONLY shared-code change is the additive
// `gateLabel` parameter in buildFinding (whose default preserves the SAST adapters' output byte-for-byte).
//
// SEVERITY PRIORITY per vulnerability: (1) the numeric `max_severity` of the package `group` that contains
// this vuln id → CVSS_SCORE_TO_FINDING (an enum band); (2) else the vuln's `database_specific.severity`
// LABEL → OSV_LABEL_TO_FINDING; (3) else `'medium'` — a known CVE of unknown severity is still a real
// finding, and the conservative middle (NOT info, NOT the gate's high) is the honest call.
//
// THREE judgment calls (documented in the CHANGELOG + roadmap):
//   1. Unscored CVE → `medium` (not info, not the gate's high) — over/under-stating an unknown-severity CVE
//      is dishonest; the conservative middle is the faithful call.
//   2. No file:line — a dep CVE locates to the lockfile/package, not a code line; `file` = the lockfile
//      source path (or `ecosystem:name` when OSV gives no source), `startLine:null`. Two vulns of one
//      package = distinct ids (distinct GHSA/CVE); the SAME CVE under two lockfiles = distinct loci (distinct
//      `file`) — correct, those are two real install sites.
//   3. `classify()`→null, owns no class, supersedes nothing — there is no LLM dependency-CVE finder to
//      supersede; OSV findings only populate the band. Cross-engine dedup with npm-audit/Trivy on the SAME
//      CVE is §10 extension #3 (Phase-2b), NOT this slice.
//
// dimension 'dependency-cve' is a DETERMINISTIC-ONLY grouping label (like checkov's 'infrastructure-iac' and
// semgrep's 'external-sast'): there is no LLM dependency finder, so it needs no methodology file. Like the
// other deterministic scanners it is SECURITY-BY-CONSTRUCTION (every OSV hit is a known CVE), so NO
// `securityRelevant` — the ingest core keeps every emitted hit. Input is a JSON OBJECT with a `results[]`.
export const osvAdapter = {
  name: 'osv',
  kind: 'file-parser',
  // CONTENT-SHAPE recognizer for --all: a results[] array whose elements carry `packages`; an EMPTY
  // results[] is osv via `experimental_config`, AND-NOT semgrep's/bandit's marks (lowest priority).
  detect: (r) => {
    const a = _resultsArr(r)
    return !!a && (a.length > 0 ? a[0] && a[0].packages !== undefined : _osvMarks(r) && !_semgrepMarks(r) && !_banditMarks(r))
  },
  collect({ input } = {}) {
    if (!input) return null
    try {
      const txt = readFileSync(input, 'utf8')
      if (!txt.trim()) return null
      return JSON.parse(txt)
    } catch {
      return null
    }
  },
  parse(raw) {
    const results = raw && Array.isArray(raw.results) ? raw.results : null
    if (!results) return []
    const hits = []
    for (const r of results) {
      const src = (r && r.source && r.source.path) || ''
      const packages = Array.isArray(r && r.packages) ? r.packages : []
      for (const p of packages) {
        const pkg = (p && p.package) || {}
        const groups = Array.isArray(p && p.groups) ? p.groups : []
        const vulns = Array.isArray(p && p.vulnerabilities) ? p.vulnerabilities : []
        for (const v of vulns) {
          if (!v || v.id == null) continue // need an advisory id (GHSA/CVE/PYSEC)
          // severity priority: numeric max_severity of THIS vuln's group → label → 'medium'
          const grp = groups.find((g) => g && Array.isArray(g.ids) && g.ids.includes(v.id))
          const numBand = grp ? CVSS_SCORE_TO_FINDING(grp.max_severity) : null
          const lblBand =
            (v.database_specific && OSV_LABEL_TO_FINDING[String(v.database_specific.severity || '').toUpperCase()]) || null
          const band = numBand || lblBand || 'medium'
          const sevLabel = numBand
            ? `CVSS ${grp.max_severity} (advisory)`
            : lblBand
              ? `advisory severity ${v.database_specific.severity}`
              : 'advisory severity unknown'
          hits.push({
            engine: 'osv',
            ruleId: String(v.id), // GHSA-… / CVE-… / PYSEC-…
            severityNum: null,
            file: src || (pkg.ecosystem ? `${pkg.ecosystem}:${pkg.name}` : String(pkg.name || 'dependency')),
            startLine: null, // dep-CVEs have no file:line — they locate to the lockfile/package
            message: `${pkg.name || 'dependency'}@${pkg.version || '?'} (${pkg.ecosystem || 'dep'}): ${v.summary || v.id}`,
            resources: [],
            bandFromTool: band,
            toolSevLabel: sevLabel,
            gateLabel: 'scan-external-sca', // the dep-CVE gate (NOT scan-external-sast)
            dimensionHint: 'dependency-cve', // deterministic-only grouping label (no LLM dep finder)
            tags: [],
            // devcve-band: the package name + ecosystem let capDevBand key the dev-only down-rank
            // (npm ecosystem only). Ignored by buildFinding — findings stay byte-identical.
            pkgName: pkg.name || null,
            ecosystem: pkg.ecosystem || null,
          })
          // DELIBERATELY ABSENT from the hit: the raw CVSS vector (v.severity[].score), affected ranges,
          // references — the band is the numeric max_severity (or the label), NEVER the vector string.
        }
      }
    }
    return hits
  },
  // Constant null: an OSV finding owns NO toolkit class (its severity is the per-advisory CVSS band, and the
  // class governs only the scan-external-sca gate). Owning no class, it supersedes nothing.
  classify() {
    return null
  },
  // NO securityRelevant — security-by-construction (every OSV hit is a known CVE), like checkov/semgrep/secrets.
  // devcve-band: down-rank a DIRECT npm dev-only dependency CVE (npm ecosystem only — a PyPI/Go
  // dep is out of scope); returns the ceiling band or null (never a raise). Keys on pkg.name.
  capDevBand(hit, devScope) {
    if (String(hit && hit.ecosystem || '').toLowerCase() !== 'npm') return null
    return capDevOnlyNpmBand(hit && hit.pkgName, hit && hit.bandFromTool, devScope)
  },
}

// ----------------------------------------------------------------------------
// ADAPTER #10 — npm-audit (file-parser, Phase 2 · 2a #8): parses captured `npm audit --json` (v2) output.
// npm audit is the Node-ecosystem dependency-CVE scanner (run-scans Family 8, alongside OSV). It is the TENTH §10
// adapter and the EASY **Extension-A REUSE**: `auditReportVersion:2` gives a DIRECT severity LABEL per vulnerable
// package (`critical/high/moderate/low/info`) — NO CVSS parsing — so the band comes straight from
// NPM_SEVERITY_TO_FINDING, exactly like OSV's label-fallback path. It REUSES buildFinding's `bandFromTool` path
// EXACTLY like OSV (classify()→null, no securityRelevant, severityNum:null, dimensionHint 'dependency-cve',
// gateLabel) — the band SOURCE (an npm label, not a CVSS) is the only difference — so there is NO buildFinding /
// CLASS_DEFS change (gateLabel already exists since OSV/0.8.37); the ONLY shared-file touch is the ADAPTERS line.
//
// FOUR judgment calls (documented in the CHANGELOG + roadmap):
//   1. Unknown/blank severity → `medium` (not info, not the gate's high) — consistent with OSV's unscored-CVE rule:
//      a known CVE of unknown severity is real, and the conservative middle is the honest call.
//   2. ONE finding per vulnerable package — npm's `vulnerabilities` map is keyed by package, and its `severity` is
//      that package's MAX advisory severity. `via` supplies the advisory title/url: a `via[i]` that is a STRING is a
//      transitive package name ("vulnerable via that one"); a `via[i]` that is an OBJECT is a direct advisory
//      (`{source,name,title,url,severity,cwe,cvss,range}`). The first OBJECT via-entry is the advisory; string
//      via-entries form the "vulnerable via …" chain. `ruleId` prefers the advisory URL/id, else the package name.
//      NOTE: the band uses the PACKAGE severity (`e.severity`, the max), NOT the first advisory's own severity — so
//      `qs` (package `moderate`, first advisory `low`) bands as medium, not low.
//   3. `gateLabel:'scan-dependency-vulnerabilities'` (the npm-deps gate, applies_to all, major) — DISTINCT from
//      OSV's `scan-external-sca`; both major. npm-audit findings say "gated by scan-dependency-vulnerabilities".
//   4. `classify()`→null, owns no class, supersedes nothing — there is no LLM dependency-CVE finder to supersede;
//      npm-audit findings only populate the band. Cross-engine dedup with OSV/Trivy on the SAME CVE (now even more
//      concrete with two dep-CVE engines — the duplicate is visible, the SAFE under-merge) is §10 extension #3
//      (Phase-2b), NOT this slice.
//
// No file:line — npm-audit gives no source path, so `file` is the lockfile (`package-lock.json`) and
// `startLine:null`. The raw CVSS vector that a direct advisory MAY carry (`via[i].cvss.vectorString`) is
// DELIBERATELY never read into any field (only the advisory title/url are) — the band is the npm label.
// dimension 'dependency-cve' is the same DETERMINISTIC-ONLY grouping label OSV uses (no LLM dep finder → no
// methodology file). Like the other deterministic scanners it is SECURITY-BY-CONSTRUCTION (every entry is a known
// CVE), so NO `securityRelevant`. Input is a JSON OBJECT with `vulnerabilities` keyed by package.
export const npmAuditAdapter = {
  name: 'npm-audit',
  kind: 'file-parser',
  // CONTENT-SHAPE recognizer for --all: npm audit v2's `auditReportVersion` present with a
  // `vulnerabilities` OBJECT (keyed by package). This is what disambiguates the raw `npm audit`
  // output from the toolkit's `deps-npm` disposition WRAPPER (which has neither field) — the proof
  // content-recognition beats filename routing.
  detect: (r) => _isObj(r) && r.auditReportVersion != null && _isObj(r.vulnerabilities),
  collect({ input } = {}) {
    if (!input) return null
    try {
      const txt = readFileSync(input, 'utf8')
      if (!txt.trim()) return null
      return JSON.parse(txt)
    } catch {
      return null
    }
  },
  parse(raw) {
    // `vulnerabilities` MUST be a plain OBJECT keyed by package (NOT an array, NOT null) — npm audit v2's shape
    const vulns =
      raw && raw.vulnerabilities && typeof raw.vulnerabilities === 'object' && !Array.isArray(raw.vulnerabilities)
        ? raw.vulnerabilities
        : null
    if (!vulns) return []
    const hits = []
    for (const pkg of Object.keys(vulns)) {
      // one finding per vulnerable package (npm keys by package; severity is the package's MAX advisory severity)
      const e = vulns[pkg]
      if (!e || typeof e !== 'object') continue
      const sev = String(e.severity || '').toLowerCase()
      // the first OBJECT via-entry is the direct advisory (title/url); a STRING via-entry is a transitive chain
      const adv = Array.isArray(e.via) ? e.via.find((x) => x && typeof x === 'object') : null
      const viaChain = Array.isArray(e.via) ? e.via.filter((x) => typeof x === 'string') : []
      const title =
        adv && adv.title
          ? String(adv.title)
          : viaChain.length
            ? `vulnerable via ${viaChain.join(', ')}`
            : 'known dependency vulnerability'
      hits.push({
        engine: 'npm-audit',
        ruleId: String((adv && (adv.url || adv.source)) || pkg), // GHSA url / npm advisory id, else the package name
        severityNum: null,
        file: 'package-lock.json', // npm-audit gives no path; the lockfile is the locus
        startLine: null,
        message: `${pkg}${e.range ? ' (' + e.range + ')' : ''} — ${sev || 'unknown'} severity npm dependency vulnerability: ${title}`,
        resources: adv && adv.url ? [String(adv.url)] : [],
        bandFromTool: NPM_SEVERITY_TO_FINDING[sev] || 'medium', // unknown → medium (judgment call #1, as OSV)
        toolSevLabel: `npm severity ${sev || 'unknown'}`,
        gateLabel: 'scan-dependency-vulnerabilities', // the npm-deps gate (applies_to all, major) — NOT scan-external-sca
        dimensionHint: 'dependency-cve',
        tags: [],
        // devcve-band: npm audit keys by package name; carry it so capDevBand can key the
        // dev-only down-rank. Ignored by buildFinding — findings stay byte-identical.
        pkgName: pkg,
      })
      // DELIBERATELY ABSENT from the hit: the advisory's CVSS vector (via[i].cvss.vectorString), cwe, the affected
      // `range` of each sub-advisory, `nodes`, `fixAvailable` — the band is the npm severity label, never the vector.
    }
    return hits
  },
  // Constant null: an npm-audit finding owns NO toolkit class (its severity is the per-package npm band, and the
  // class governs only the scan-dependency-vulnerabilities gate). Owning no class, it supersedes nothing.
  classify() {
    return null
  },
  // NO securityRelevant — security-by-construction (every npm-audit entry is a known CVE), like osv/checkov/secrets.
  // devcve-band: npm audit is npm-by-construction, so every hit is npm ecosystem — key the
  // dev-only down-rank straight off the package name; returns the ceiling band or null.
  capDevBand(hit, devScope) {
    return capDevOnlyNpmBand(hit && hit.pkgName, hit && hit.bandFromTool, devScope)
  },
}

// ----------------------------------------------------------------------------
// ADAPTER #11 — trivy (file-parser, Phase 2 · 2a #9): parses captured Trivy JSON (CONFIG / IaC-misconfig mode).
// Trivy is the toolkit's multi-mode scanner (run-scans: IaC-misconfig over Dockerfile/Terraform/K8s, plus
// os-pkgs/lang-pkgs SCA and a secret mode). THIS slice does exactly ONE mode — `Class:'config'` (IaC misconfig) —
// because that is the only mode with a REAL captured fixture on disk, and that mode is the SAME vuln class as
// Checkov, so trivy REUSES the `iac-misconfig` class (NO new `CLASS_DEFS` entry, NO `buildFinding` change — like
// detect-secrets reused `hardcoded-secrets`): a CLASS-severity adapter, severity from the `iac-misconfig` CLASS
// (scan-iac-misconfig = major → high) via a CONSTANT `classify()`→`'iac-misconfig'`, NO tag filter
// (security-by-construction, like checkov/metadata). The ONLY shared-file touch is the `ADAPTERS` registry line.
//
// THE PARSE IS CLASS-DISPATCH (forward-compatible). Trivy's `Results[]` each carry a `Class`: `'config'`
// (IaC misconfig), `'os-pkgs'`/`'lang-pkgs'` (a dependency-CVE/SCA list — would reuse Extension A's
// `dependency-cve` band), or `'secret'` (would reuse the `hardcoded-secrets` class). THIS slice handles ONLY
// `Class:'config'` and SKIPS the vuln/secret classes — those are **Phase-2b** (no captured fixtures yet) — so the
// parse is forward-compatible: when a future slice ships the SCA/secret fixtures, the dispatch grows a branch and
// nothing already-shipped changes. Only `Status:'FAIL'` misconfigurations become findings (a `PASS` is a satisfied
// check, not a finding).
//
// THREE judgment calls (documented in the CHANGELOG + roadmap):
//   1. **Class-severity, CONSISTENT WITH CHECKOV** — Trivy DOES carry a per-misconfig `Severity`
//      (LOW/MEDIUM/HIGH/CRITICAL), but Checkov (the OTHER `iac-misconfig` engine) lands EVERY IaC misconfig at the
//      class `high`. For the same toolkit class to be consistent across engines, Trivy ALSO uses class-severity:
//      the misconfig's `Severity` is recorded in the message *for reference* (mirroring how Checkov records its
//      absent tool severity), but it does NOT move the band — a `Severity:'LOW'` misconfig is STILL `high`, exactly
//      like Checkov. A per-misconfig-tool-severity refinement for the `iac-misconfig` class (Checkov + Trivy both)
//      stays the SAME Phase-2b item flagged at Checkov — this slice introduces NO tool→band path for IaC. (Hence
//      `severityNum:null`, no `bandFromTool`: the mapped class-severity branch governs, the tool number never reaches it.)
//   2. **Config mode only this slice** — the vuln (os-pkgs/lang-pkgs) and secret classes are skipped (Phase-2b),
//      so there is no fabricated SCA/secret finding from a Trivy run; the dispatch is forward-compatible.
//   3. **Cross-engine dedup now concrete for IaC too** — Trivy + Checkov both flag the SAME Dockerfile misconfig
//      (Trivy `DS-0026` "No HEALTHCHECK" ↔ Checkov `CKV_DOCKER_2`) → TWO `iac-misconfig` rows. Neither supersedes
//      the other (both deterministic; a deterministic finding never supersedes another), so the duplicate is
//      VISIBLE — the SAFE under-merge; collapsing it is roadmap §10 extension #3 (Phase-2b), NOT this slice.
//
// `file` = the Result `Target` (the scanned file); `:StartLine` is appended ONLY when the misconfig's
// `CauseMetadata.StartLine` is an integer (a file-level misconfig like DS-0026 carries none → the bare Target).
// `ruleId` prefers `AVDID` (e.g. AVD-DS-0026) and falls back to `ID` (e.g. DS-0026). Input is a JSON OBJECT with `Results[]`.
export const trivyAdapter = {
  name: 'trivy',
  kind: 'file-parser',
  // CONTENT-SHAPE recognizer for --all: Trivy's `Results` array (capital R — distinct from the SAST
  // trio's lowercase `results`) plus `SchemaVersion`.
  detect: (r) => _isObj(r) && Array.isArray(r.Results) && r.SchemaVersion != null,
  collect({ input } = {}) {
    if (!input) return null
    try {
      const txt = readFileSync(input, 'utf8')
      if (!txt.trim()) return null
      return JSON.parse(txt)
    } catch {
      return null
    }
  },
  parse(raw) {
    const results = raw && Array.isArray(raw.Results) ? raw.Results : null
    if (!results) return []
    const hits = []
    for (const r of results) {
      if (!r || typeof r !== 'object') continue
      // CLASS DISPATCH. Only 'config' (IaC misconfig) is handled this slice; the vuln (os-pkgs/lang-pkgs) and
      // 'secret' classes are Phase-2b (no captured fixtures yet) — skip them, forward-compatible.
      if (r.Class !== 'config') continue
      const target = r.Target || ''
      const miscs = Array.isArray(r.Misconfigurations) ? r.Misconfigurations : []
      for (const m of miscs) {
        if (!m || m.ID == null) continue // a malformed misconfig with no rule id is skipped
        if (String(m.Status || '').toUpperCase() === 'PASS') continue // only FAIL is a finding (a PASS is a satisfied check)
        const cm = m.CauseMetadata && typeof m.CauseMetadata === 'object' ? m.CauseMetadata : {}
        hits.push({
          engine: 'trivy',
          ruleId: String(m.AVDID || m.ID), // AVD-DS-0026 (preferred) / DS-0026 (fallback)
          severityNum: null, // class-severity (iac-misconfig → high); Trivy's own Severity is noted below for reference
          file: target,
          startLine: Number.isInteger(cm.StartLine) ? cm.StartLine : null,
          message: `${m.Title || m.ID}${m.Message ? ' — ' + m.Message : ''} [Trivy severity ${m.Severity || 'n/a'}, recorded for reference]`,
          resources: m.PrimaryURL ? [String(m.PrimaryURL)] : [],
          tags: [],
        })
      }
    }
    return hits
  },
  // Constant: every Trivy config misconfig is an IaC misconfig — REUSES the `iac-misconfig` class checkov added
  // (NO new CLASS_DEFS entry), whose severity is the class (scan-iac-misconfig → high) and dimension infrastructure-iac.
  // One class definition, two engines (checkov + trivy).
  classify() {
    return 'iac-misconfig'
  },
  // NO securityRelevant — Trivy config findings are security/compliance by construction, like checkov/metadata.
}

// ----------------------------------------------------------------------------
// ADAPTER #12 — regexploit (file-parser, residual-shrinking · B5 #1): parses captured regexploit
// TEXT output (ReDoS / catastrophic-backtracking regex — CWE-1333). regexploit is the toolkit's ReDoS
// scanner (run-scans Family 7 leg: `regexploit-py` / `regexploit-js` over every detected non-package
// language root; pip package `regexploit`, exit 0 whether or not vulnerable patterns are found). It
// moves the catastrophic-regex *pattern* substrate of the `resource-consumption-abuse` dimension from
// LLM-inferred to deterministic — the baseline entry's own automation note ("catastrophic regex
// patterns are statically detectable") made true — leaving REACHABILITY as the labelled residual.
//
// FORMAT C — the FIRST non-JSON adapter. regexploit emits human-readable TEXT only (the package's
// output/text.py is its only writer; no JSON/JSONL output exists, and the npm `recheck` alternative
// ships no repo-scanning bin at all), so:
//   - the evidence file is the tool's VERBATIM stdout (evidence/redos-<date>.txt) — never a wrapper
//     format that re-writes tool output;
//   - `collect()` reads the input as TEXT (no JSON.parse) and `parse()` parses the tool's own format;
//   - `detect(raw)` matches ONLY the raw TEXT shape (a string carrying the tool's own markers) and is
//     an honest `false` for every parsed-JSON shape — so `--all` (which enumerates evidence/*.json
//     and JSON-parses each) does NOT auto-recognize regexploit evidence. DOCUMENTED limitation, not a
//     bug: the explicit `--scanner regexploit --input <redos.txt>` path is the ingest route (run-scans
//     Family 7 narrates it). A text fixture still proves detect-disjointness: every existing detect
//     requires an object/array shape, so a string can never be ambiguous with them.
//
// THE PARSE (regexploit's own format, per its output/text.py):
//   Vulnerable regex in <file> #<lineno>      ← one BLOCK per vulnerable regex; #<lineno> is the
//   Pattern: <regex>                            source line (absent for stdin scans → startLine null)
//   Context: <source line>                    ← optional (the JS scanner omits it)
//   ---
//   Redos(starriness=N, …)                    ← one or MORE records per block (one per ambiguous
//   Worst-case complexity: N ⭐… (<degree>)     subsequence); the block's band is the WORST record
//   …                                           (max starriness — exponential=11 always beats
//   Example: …                                  polynomial ≤ 10)
// Trailer lines ("Processed N regexes", parser errors) are ignored. ONE finding per block: file:line
// + pattern IS the vulnerable regex; two blocks of the same pattern at distinct lines are distinct
// findings (distinct loci).
//
// TOOL→BAND via REDOS_DEGREE_TO_FINDING (exponential → high · polynomial → medium · unknown →
// medium), gated by `resource-consumption-abuse` (the RCA baseline id, major — the osv gateLabel-param
// precedent, NOT the scan-external-sast default). NEVER critical/blocker from the tool alone —
// reachability is the residual (the semgrep ERROR→high ceiling precedent).
//
// THE DESIGN DECISION — classify() is the CONSTANT null: this adapter owns NO class and supersedes
// NOTHING (the semgrep/bandit precedent, NOT the gitleaks one). WHY, from the code:
// reconcile-provenance.mjs::sameOwnedClass falls back to a DIMENSION match when the LLM finding
// carries no explicit class (the realistic case) — and `resource-consumption-abuse` is a MULTI-SHAPE
// dimension (unrestricted consumption / denial-of-wallet / algorithmic amplification). A class-owning
// deterministic ReDoS finding at api/server.py would therefore supersede a co-located LLM
// missing-rate-limit or denial-of-wallet finding in the same file — a real correctness hazard.
// gitleaks could own its class safely ONLY because secrets-credentials is single-shape. So the
// deterministic ReDoS row sits BESIDE, never silences, the dimension's other findings; two rows for
// the same regex (one deterministic, one pre-existing LLM) is the documented SAFE under-merge, and
// cross-engine dedup stays §10 extension #3 (Phase-2b). The B1 ordering (static substrate BEFORE the
// LLM fan-out + the ledger digest compiled AFTER the deterministic pass) already prevents duplicate
// find-time work. Locked by the RD-non-supersession standing test (mutation-proven: a classify() that
// returns an owned class turns that test RED).
//
// `ruleId` is a deterministic derivation from the pattern (regexploit has no rule ids):
// `redos-<sha16(pattern)>` — stable across runs, no timestamps. The pattern itself IS source code
// (regexploit prints Pattern/Context from the scanned code, never runtime user data), so it appears
// in the message; the hash keeps the ruleId flat. Like the other scanners it is SECURITY-BY-
// CONSTRUCTION (every reported block is an ambiguous regex), so NO `securityRelevant`.
const REDOS_DOC = 'https://cwe.mitre.org/data/definitions/1333.html'
export const regexploitAdapter = {
  name: 'regexploit',
  kind: 'file-parser',
  // CONTENT-SHAPE recognizer: the raw TEXT shape only (format C). Every parsed-JSON shape (object /
  // array — all 11 existing file-parser detects require one) is an honest false, so `--all` never
  // routes a JSON evidence file here and a string can never be ambiguous with the JSON adapters.
  detect: (r) =>
    typeof r === 'string' && /(^|\n)Vulnerable regex in /.test(r) && /(^|\n)Worst-case complexity: /.test(r),
  collect({ input } = {}) {
    if (!input) return null
    try {
      const txt = readFileSync(input, 'utf8')
      if (!txt.trim()) return null
      return txt // VERBATIM text — regexploit has no JSON output (format C); parse() reads this format
    } catch {
      return null
    }
  },
  parse(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return [] // format C: the raw IS the tool's text
    const hits = []
    let cur = null // the open block: { file, line, pattern, star, degree }
    const flush = () => {
      if (cur && cur.pattern != null && cur.degree != null) {
        hits.push({
          engine: 'regexploit',
          ruleId: `redos-${sha256id(cur.pattern)}`, // deterministic pattern derivation (no tool rule ids)
          severityNum: null, // no 1-5 number; the band comes from the ambiguity degree
          file: cur.file,
          startLine: cur.line,
          message:
            `Catastrophic-backtracking regex (worst-case ${cur.degree}` +
            `${Number.isInteger(cur.star) ? `, starriness ${cur.star}` : ''}): ${cur.pattern}`,
          resources: [REDOS_DOC],
          bandFromTool: REDOS_DEGREE_TO_FINDING[cur.degree] || 'medium', // unknown degree → medium, never dropped
          toolSevLabel: `regex ambiguity ${cur.degree}`,
          gateLabel: 'resource-consumption-abuse', // the RCA baseline id (major) — NOT scan-external-sast
          dimensionHint: 'resource-consumption-abuse', // the REAL methodology dimension; no class → supersedes nothing
          tags: [],
        })
      }
      cur = null
    }
    for (const ln of raw.split(/\r?\n/)) {
      const head = /^Vulnerable regex in (.+?)(?: #(\d+))?\s*$/.exec(ln)
      if (head) {
        flush() // close the previous block; a new vulnerable regex starts
        cur = { file: head[1], line: head[2] ? parseInt(head[2], 10) : null, pattern: null, star: null, degree: null }
        continue
      }
      if (!cur) continue // trailer/preamble lines outside a block are ignored
      const pat = /^Pattern: (.*)$/.exec(ln)
      if (pat && cur.pattern == null) {
        cur.pattern = pat[1]
        continue
      }
      // one or more records per block — keep the WORST (max starriness; exponential=11 > polynomial ≤ 10)
      const wc = /^Worst-case complexity: (\d+) .*\((\S+?)\)\s*$/.exec(ln)
      if (wc) {
        const star = parseInt(wc[1], 10)
        if (cur.star == null || star > cur.star) {
          cur.star = star
          cur.degree = wc[2]
        }
      }
    }
    flush() // close the final block (EOF ends it)
    return hits
  },
  // Constant null — THE design decision: a regexploit finding owns NO toolkit class and supersedes
  // NOTHING. resource-consumption-abuse is a MULTI-SHAPE dimension and sameOwnedClass falls back to a
  // dimension match, so an owned class here would supersede co-located rate-limit/denial-of-wallet
  // LLM findings (a correctness hazard). Do NOT change this to an owned class; the RD-non-supersession
  // standing test goes red if you do.
  classify() {
    return null
  },
  // NO securityRelevant — security-by-construction (every reported block is an ambiguous regex).
}

// ----------------------------------------------------------------------------
// ADAPTER #13 — sarif (file-parser, B5 · E0.2b, 0.8.61): parses captured SARIF 2.1.0 output —
// the VERSION-PORTABLE reachability surface. SARIF is the OASIS-standardized interchange format
// every serious SAST engine emits (`--sarif` on opengrep/semgrep, CodeQL's native output), and
// its `codeFlows` construct is the STANDARDIZED serialization of the source→sink taint path —
// so one adapter + one normalizer (_sarifReachabilityPath) ingests the reachability substrate
// from ANY of those engines, decoupled from any single tool's JSON quirks (the durable bet:
// Semgrep CE 1.168 omits `dataflow_trace` from --json AND Pro-gates SARIF codeFlows, while
// Opengrep 1.25.0 emits codeFlows for free — the adapter doesn't care which engine wins).
//   engine    — from `run.tool.driver.name`, first token lowercased ('Opengrep OSS'→'opengrep',
//               'Semgrep OSS'→'semgrep', 'CodeQL'→'codeql') — NEVER hardcoded: provenance is the
//               producer's own declaration; an unnamed driver falls back to 'sarif'.
//   severity  — tool→band like semgrep: `result.level`, else the rule's
//               `defaultConfiguration.level` (the SARIF defaulting chain — both captured
//               fixtures rely on it), via SARIF_LEVEL_TO_FINDING (error→high · warning→medium ·
//               note→low · unknown→info, never dropped).
//   dimension — the SAME per-hit CWE routing as semgrep/bandit/njsscan: the rule's
//               `properties.tags` carry 'CWE-###' strings (the exact array shape cweIdsOf
//               already normalizes), so an allowlisted injection CWE routes to `injection-xss`;
//               everything else keeps 'external-sast'. ROUTING/ATTRIBUTE ONLY — classify() is
//               constant null (owns no class, supersedes nothing — the semgrep posture).
//   reachability — `result.codeFlows` → _sarifReachabilityPath, attached in a try/catch exactly
//               like the semgrep-JSON path: extraction failure = no attribute, never a lost finding.
// Only `runs[].results[]` become findings. NO securityRelevant — the documented invocations run
// the security rulesets (security-by-construction, like semgrep).
export const sarifAdapter = {
  name: 'sarif',
  kind: 'file-parser',
  // CONTENT-SHAPE recognizer: a top-level `runs[]` ARRAY plus a SARIF version/schema marker.
  // Provably disjoint from all other detects: no other adapter's shape carries `runs[]` (the
  // SAST trio keys on a top-level `results[]`, which SARIF nests INSIDE runs[]).
  detect: (r) =>
    _isObj(r) &&
    Array.isArray(r.runs) &&
    ((typeof r.version === 'string' && r.version.startsWith('2.')) ||
      (typeof r.$schema === 'string' && r.$schema.toLowerCase().includes('sarif'))),
  collect({ input } = {}) {
    if (!input) return null
    try {
      const txt = readFileSync(input, 'utf8')
      if (!txt.trim()) return null
      return JSON.parse(txt)
    } catch {
      return null
    }
  },
  parse(raw) {
    if (!_isObj(raw) || !Array.isArray(raw.runs)) return []
    const hits = []
    for (const run of raw.runs) {
      if (!_isObj(run)) continue
      const driver = _isObj(run.tool) && _isObj(run.tool.driver) ? run.tool.driver : {}
      const engine =
        typeof driver.name === 'string' && driver.name.trim()
          ? driver.name.trim().split(/\s+/)[0].toLowerCase()
          : 'sarif' // an unnamed driver — honest fallback, never a guessed engine
      // rule index by id — the SARIF defaulting chain reads level/tags/helpUri off the rule
      const ruleById = new Map()
      for (const ru of Array.isArray(driver.rules) ? driver.rules : []) {
        if (_isObj(ru) && typeof ru.id === 'string') ruleById.set(ru.id, ru)
      }
      for (const r of Array.isArray(run.results) ? run.results : []) {
        if (!_isObj(r) || r.ruleId == null) continue
        const rule = ruleById.get(r.ruleId)
        const level =
          typeof r.level === 'string' && r.level
            ? r.level
            : rule && _isObj(rule.defaultConfiguration) && typeof rule.defaultConfiguration.level === 'string'
              ? rule.defaultConfiguration.level
              : ''
        const loc = Array.isArray(r.locations) && _isObj(r.locations[0]) ? r.locations[0] : null
        const phys = loc && _isObj(loc.physicalLocation) ? loc.physicalLocation : null
        const art = phys && _isObj(phys.artifactLocation) ? phys.artifactLocation : null
        // uri VERBATIM minus a defensive file:// strip — see the _sarifTraceStep rationale
        const file = art && typeof art.uri === 'string' && art.uri ? art.uri.replace(/^file:\/\//, '') : null
        const region = phys && _isObj(phys.region) ? phys.region : null
        const tags = rule && _isObj(rule.properties) && Array.isArray(rule.properties.tags) ? rule.properties.tags : []
        const hit = {
          engine,
          ruleId: String(r.ruleId),
          severityNum: null, // SARIF has no 1-5 number; the band comes from level
          file,
          startLine: region && Number.isInteger(region.startLine) ? region.startLine : null,
          message: _isObj(r.message) && typeof r.message.text === 'string' ? r.message.text : '',
          resources: rule && typeof rule.helpUri === 'string' && rule.helpUri ? [rule.helpUri] : [],
          bandFromTool: SARIF_LEVEL_TO_FINDING[level] || 'info', // unknown level → info, never dropped
          toolSevLabel: String(level || 'unknown'),
          // per-hit CWE routing (the semgrep/bandit/njsscan posture): rule tags carry 'CWE-###'
          dimensionHint: dimensionForCwes(tags),
          tags: [],
        }
        // B5 · E0.2b: the standardized codeFlows taint path → reachabilityPath. Wrapped so a
        // malformed flow can NEVER take down the base finding (mirrors the semgrep-JSON path).
        let reachabilityPath = null
        try {
          reachabilityPath = _sarifReachabilityPath(r)
        } catch {
          reachabilityPath = null
        }
        if (reachabilityPath) hit.reachabilityPath = reachabilityPath
        hits.push(hit)
      }
    }
    return hits
  },
  // Constant null: a SARIF finding owns NO toolkit class (tool→band severity; an owned class
  // would over-escalate + supersede co-located LLM findings across every producing engine).
  classify() {
    return null
  },
  // NO securityRelevant — security-by-construction (the documented security-ruleset invocations).
  // B5 · item 7: the toolkit rule pack keeps its `rules.injection.` check_id prefix on the
  // SARIF surface too (the id is path-derived, engine- and format-independent), so the same
  // substrate-unavailable contract applies — see the semgrep adapter.
  expectsTrace: semgrepAdapter.expectsTrace,
  // B5 · item 7 — drift stays opengrep-ONLY on the SARIF surface: return the recorded
  // `semanticVersion` ONLY when the producing driver declares itself Opengrep. 'Semgrep OSS'
  // MUST return nothing — semgrep is pip-installed floating-latest (no pin to drift from),
  // and its SARIF (e.g. the frozen 1.168.0 fixture) would false-fire against the opengrep
  // pin. Any other driver (CodeQL, Checkmarx, …) has no toolkit pin either — nothing returned.
  recordedVersion(raw) {
    if (!_isObj(raw) || !Array.isArray(raw.runs)) return null
    const run = _isObj(raw.runs[0]) ? raw.runs[0] : null
    const driver = run && _isObj(run.tool) && _isObj(run.tool.driver) ? run.tool.driver : null
    if (!driver || typeof driver.name !== 'string' || !/^opengrep\b/i.test(driver.name.trim())) return null
    return typeof driver.semanticVersion === 'string' ? driver.semanticVersion : null
  },
}

export const ADAPTERS = {
  'code-analyzer': codeAnalyzerAdapter,
  'metadata-viewall': metadataViewAllAdapter,
  'egress-plain-http': egressPlainHttpAdapter,
  'view-modify-all-data': viewModifyAllDataAdapter,
  'remote-site-protocol-security': remoteSiteProtocolSecurityAdapter,
  'admin-privilege-grant': adminPrivilegeGrantAdapter,
  'checkov': checkovAdapter,
  'semgrep': semgrepAdapter,
  'opengrep': opengrepAdapter,
  'bandit': banditAdapter,
  'njsscan': njsscanAdapter,
  'gitleaks': gitleaksAdapter,
  'detect-secrets': detectSecretsAdapter,
  'osv': osvAdapter,
  'npm-audit': npmAuditAdapter,
  'trivy': trivyAdapter,
  'regexploit': regexploitAdapter,
  'sarif': sarifAdapter,
}

// ----------------------------------------------------------------------------
// recognizeScanner — content-shape routing for the --all journey-wiring mode.
// Returns the SINGLE file-parser adapter NAME whose `detect(raw)` matches, `null` if none
// match, or `{ ambiguous: [names] }` if MORE THAN ONE matches (a recognizer bug — the caller
// logs it loudly and SKIPS the file, never guessing). Iterates only ADAPTERS entries that
// carry a `detect` fn (metadata-viewall + egress-plain-http + view-modify-all-data + remote-site-protocol-security + admin-privilege-grant, the source-scanners, have none; opengrep has none
// BY DESIGN — its JSON is content-indistinguishable from semgrep's, see the adapter). Each `detect` is
// wrapped in try/catch → treated as false on throw (fail-safe: a malformed shape can never
// crash recognition). The shapes are provably disjoint (40/40 on real fixtures), so a single
// match is the norm; the >1 branch exists so a future shape collision fails LOUD, not silent.
// ----------------------------------------------------------------------------
export function recognizeScanner(raw) {
  const matched = []
  for (const [name, adapter] of Object.entries(ADAPTERS)) {
    if (typeof adapter.detect !== 'function') continue
    let ok = false
    try {
      ok = !!adapter.detect(raw)
    } catch {
      ok = false
    }
    if (ok) matched.push(name)
  }
  if (matched.length === 1) return matched[0]
  if (matched.length === 0) return null
  return { ambiguous: matched }
}

// ----------------------------------------------------------------------------
// ledger merge (additive + idempotent). LLM-supersession enforcement is Slice 2;
// here a deterministic finding is keyed by engine+ruleId+file:line and added once
// (or refreshed in place on re-ingest), never duplicated.
// ----------------------------------------------------------------------------
export function loadLedger(ledgerPath) {
  let ledger
  try {
    ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
  } catch {
    ledger = null
  }
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) {
    ledger = { schema_version: '1', findings: [], passes: [] }
  }
  // HONESTY (data-loss guard, mirrors merge-ledger.mjs): a present-but-non-array
  // `findings` is a corrupted/hand-edited ledger, not an empty one — refuse loudly
  // rather than overwrite a recoverable file.
  if (ledger.findings != null && !Array.isArray(ledger.findings)) {
    throw new Error(
      'prior ledger `findings` is not an array (corrupted or hand-edited); refusing to overwrite — restore from version control and re-run'
    )
  }
  if (!Array.isArray(ledger.findings)) ledger.findings = []
  if (!Array.isArray(ledger.passes)) ledger.passes = []
  if (!ledger.schema_version) ledger.schema_version = '1'
  return ledger
}
export function mergeFindings(ledger, newFindings, pass) {
  const passId = Number.isInteger(pass) && pass >= 1 ? pass : 1
  const byId = new Map(ledger.findings.map((f) => [f.id, f]))
  let added = 0
  let updated = 0
  for (const nf of newFindings) {
    const prev = byId.get(nf.id)
    if (prev) {
      // owner-touched lifecycle states are never re-written by an automated re-ingest
      if (prev.status === 'accepted_risk' || prev.status === 'fixed') {
        prev.last_seen = passId
        updated++
        continue
      }
      const firstSeen = prev.first_seen
      Object.assign(prev, nf, { first_seen: firstSeen, last_seen: passId })
      updated++
    } else {
      // insert a COPY, never the caller's object: when the incoming batch itself carries
      // two findings with one id (the JSON+SARIF routes of the same hit converge by design),
      // aliasing would let the second copy Object.assign ONTO the caller's first band object
      // — fabricating a hybrid finding no adapter produced, and making the returned band
      // differ between a fresh-ledger run and a re-run. The ledger row is the merge surface;
      // the caller's band stays exactly what the adapters emitted (locked by
      // test-determinism-band).
      const row = { ...nf }
      ledger.findings.push(row)
      byId.set(row.id, row)
      added++
    }
  }
  return { added, updated }
}

// ----------------------------------------------------------------------------
// ingestAll — the --all journey-wiring orchestrator (Phase 2, 0.8.40). The I/O seam that
// makes the whole Phase-2 build run in the real journey: it ALWAYS runs the source-scanners
// (metadata-viewall + egress-plain-http + view-modify-all-data + remote-site-protocol-security + admin-privilege-grant), then
// recognizes + ingests every scanner output present under <target>/.security-review/evidence/
// by CONTENT SHAPE, and merges the whole deterministic band into the ledger in ONE pass. It
// reuses the pure ingest() (per scanner) + loadLedger/mergeFindings verbatim; the existing
// per-`--scanner` path is untouched. Byte-deterministic: the evidence list is sorted and the
// combined band is id-sorted before merge, so `--all` twice on the same evidence dir → a
// byte-identical ledger (no Date / Math.random anywhere on the path).
// ----------------------------------------------------------------------------
export function ingestAll({ target, pass, dryRun } = {}) {
  const root = target || process.cwd()
  const ledgerPath = join(root, '.security-review', 'audit-ledger.json')
  const evidenceDir = join(root, '.security-review', 'evidence')

  let ledger = { schema_version: '1', findings: [], passes: [] }
  let defaultPass = 1
  if (!dryRun) {
    ledger = loadLedger(ledgerPath) // may throw on a corrupted ledger — mainAll surfaces it
    defaultPass = ledger.passes.length ? Math.max(...ledger.passes.map((p) => p.id || 1)) : 1
  }
  const passId = Number.isInteger(pass) && pass >= 1 ? pass : defaultPass

  // devcve-band: resolve the target's direct npm dev-dependency scope ONCE at this journey
  // boundary and thread it into every ingest() below. This path bypasses collect() (raw is
  // read inline at L~3357), so the enrichment MUST live here, not in an adapter's collect().
  const devScope = resolveDevScope(root)

  const notes = []
  const scanners = [] // { scanner, kind, [file], findings, status:'ran'|'clean' }
  const skipped = [] // { file, reason }
  const allFindings = []
  const recognized = new Set()

  // (1) ALWAYS run the metadata source scans — they need no evidence file, no `sf`, no network
  // (metadata-viewall greps the repo's *.permissionset-meta.xml for ViewAll/ModifyAll
  // over-grants; egress-plain-http greps the egress-config metadata for plain-http endpoints;
  // view-modify-all-data greps permission sets + profiles for the org-wide
  // ViewAllData/ModifyAllData system-permission grants; remote-site-protocol-security greps
  // *.remoteSite-meta.xml for disableProtocolSecurity=true opt-outs; admin-privilege-grant
  // greps permission sets + profiles for the high-risk admin/privilege system-permission
  // grants — ManageUsers/AuthorApex/CustomizeApplication/ModifyMetadata).
  let metaRaw = null
  try {
    metaRaw = metadataViewAllAdapter.collect({ target: root })
  } catch {
    metaRaw = null
  }
  const metaRes = ingest(metaRaw, metadataViewAllAdapter, { repoRoot: root, pass: passId })
  notes.push(...metaRes.notes)
  allFindings.push(...metaRes.findings)
  scanners.push({
    scanner: 'metadata-viewall',
    kind: metadataViewAllAdapter.kind,
    findings: metaRes.findings.length,
    status: metaRes.findings.length ? 'ran' : 'clean',
  })
  let egressRaw = null
  try {
    egressRaw = egressPlainHttpAdapter.collect({ target: root })
  } catch {
    egressRaw = null
  }
  const egressRes = ingest(egressRaw, egressPlainHttpAdapter, { repoRoot: root, pass: passId })
  notes.push(...egressRes.notes)
  allFindings.push(...egressRes.findings)
  scanners.push({
    scanner: 'egress-plain-http',
    kind: egressPlainHttpAdapter.kind,
    findings: egressRes.findings.length,
    status: egressRes.findings.length ? 'ran' : 'clean',
  })
  let vmadRaw = null
  try {
    vmadRaw = viewModifyAllDataAdapter.collect({ target: root })
  } catch {
    vmadRaw = null
  }
  const vmadRes = ingest(vmadRaw, viewModifyAllDataAdapter, { repoRoot: root, pass: passId })
  notes.push(...vmadRes.notes)
  allFindings.push(...vmadRes.findings)
  scanners.push({
    scanner: 'view-modify-all-data',
    kind: viewModifyAllDataAdapter.kind,
    findings: vmadRes.findings.length,
    status: vmadRes.findings.length ? 'ran' : 'clean',
  })
  let rspRaw = null
  try {
    rspRaw = remoteSiteProtocolSecurityAdapter.collect({ target: root })
  } catch {
    rspRaw = null
  }
  const rspRes = ingest(rspRaw, remoteSiteProtocolSecurityAdapter, { repoRoot: root, pass: passId })
  notes.push(...rspRes.notes)
  allFindings.push(...rspRes.findings)
  scanners.push({
    scanner: 'remote-site-protocol-security',
    kind: remoteSiteProtocolSecurityAdapter.kind,
    findings: rspRes.findings.length,
    status: rspRes.findings.length ? 'ran' : 'clean',
  })
  let apgRaw = null
  try {
    apgRaw = adminPrivilegeGrantAdapter.collect({ target: root })
  } catch {
    apgRaw = null
  }
  const apgRes = ingest(apgRaw, adminPrivilegeGrantAdapter, { repoRoot: root, pass: passId })
  notes.push(...apgRes.notes)
  allFindings.push(...apgRes.findings)
  scanners.push({
    scanner: 'admin-privilege-grant',
    kind: adminPrivilegeGrantAdapter.kind,
    findings: apgRes.findings.length,
    status: apgRes.findings.length ? 'ran' : 'clean',
  })

  // (2) enumerate evidence/*.json + *.sarif — TOP LEVEL only (skip subdirs like dast/), sorted
  // for determinism. .sarif joined in B5 · E0.2b (0.8.61): SARIF is JSON on the wire, so the
  // same JSON.parse + content-shape recognition below routes it (the sarif adapter's runs[]
  // shape is disjoint from every .json adapter's).
  let files = []
  try {
    files = readdirSync(evidenceDir, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.(json|sarif)$/.test(e.name.toLowerCase()))
      .map((e) => e.name)
      .sort()
  } catch {
    files = [] // no evidence dir yet — fine; the band is metadata-only this pass
  }

  for (const name of files) {
    const rel = `evidence/${name}`
    let raw
    try {
      const txt = readFileSync(join(evidenceDir, name), 'utf8')
      if (!txt.trim()) {
        skipped.push({ file: rel, reason: 'empty file' })
        notes.push(`${rel} is empty — skipped`)
        continue
      }
      raw = JSON.parse(txt)
    } catch (e) {
      skipped.push({ file: rel, reason: 'unparseable JSON' })
      notes.push(`${rel} is not valid JSON (${e && e.message}) — skipped`)
      continue
    }
    let rec = recognizeScanner(raw)
    if (rec == null) {
      skipped.push({ file: rel, reason: 'not recognized by any adapter' })
      notes.push(`${rel} not recognized by any adapter — skipped`)
      continue
    }
    if (_isObj(rec) && Array.isArray(rec.ambiguous)) {
      skipped.push({ file: rel, reason: `ambiguous — matched ${rec.ambiguous.join(', ')}` })
      notes.push(`${rel} matched MULTIPLE adapters (${rec.ambiguous.join(', ')}) — recognizer bug, skipped (never guess)`)
      continue
    }
    // Engine-label refinement (B5 · E0.2b — the D1 provenance fix): Opengrep's --json is
    // byte-shape-compatible with Semgrep's (verified: no distinguishing field exists), so the
    // FORMAT recognizer above honestly says 'semgrep'. When the file was captured under the
    // documented `opengrep-<date>.json` evidence name (run-scans Family 7), re-label to the
    // opengrep adapter — same parse, honest `engine:'opengrep'` provenance. The filename refines
    // ONLY the label, never the routing; a renamed capture still ingests as the semgrep format.
    if (rec === 'semgrep' && name.toLowerCase().startsWith('opengrep')) {
      rec = 'opengrep'
      notes.push(
        `${rel} carries the semgrep JSON format under the documented opengrep-* evidence name — ` +
          `engine label refined to 'opengrep' (the two engines' JSON is content-indistinguishable)`
      )
    }
    const adapter = ADAPTERS[rec]
    const res = ingest(raw, adapter, { repoRoot: root, pass: passId, devScope })
    notes.push(...res.notes)
    allFindings.push(...res.findings)
    recognized.add(rec)
    scanners.push({
      scanner: rec,
      kind: adapter.kind,
      file: rel,
      findings: res.findings.length,
      status: res.findings.length ? 'ran' : 'clean',
    })
  }

  // (3) deterministic combined order, independent of file-iteration order (ingest already
  // sorts each adapter's findings; this re-sorts the union so the merged ledger is stable).
  allFindings.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  // (4) PENDING accounting — preserve the Step-4b contract: Code Analyzer absent ⇒ the CRUD/FLS +
  // sharing classes stay PENDING-OWNER-RUN (never LLM-filled, never dropped). Now the HARNESS
  // reports it deterministically instead of the prose.
  const pending = []
  if (!recognized.has('code-analyzer')) {
    pending.push('crud-fls', 'sharing')
    notes.push(
      'Code Analyzer output absent (no code-analyzer evidence recognized) — CRUD/FLS + sharing classes remain ' +
        'PENDING-OWNER-RUN; run `sf` + the Code Analyzer plugin to make them deterministic. The LLM fan-out keeps ' +
        'its co-located findings as llm-inferred (never dropped, never LLM-filled into the deterministic band).'
    )
  }

  // (5) merge the whole band into the ledger once (idempotent — stable ids dedup on re-run).
  let merged = null
  if (!dryRun) {
    merged = mergeFindings(ledger, allFindings, passId)
    try {
      mkdirSync(join(root, '.security-review'), { recursive: true })
    } catch {
      /* dir may already exist */
    }
    writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2))
  }

  return { mode: 'all', pass: passId, scanners, skipped, pending, findings: allFindings, notes, merged }
}

// ----------------------------------------------------------------------------
// CLI
// ----------------------------------------------------------------------------
function arg(flag, def) {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
function main() {
  const scanner = arg('--scanner', 'code-analyzer')
  const input = arg('--input', null)
  const target = arg('--target', process.cwd())
  const asJson = process.argv.includes('--json')
  const dryRun = process.argv.includes('--dry-run')
  const passArg = parseInt(arg('--pass', ''), 10)

  const adapter = ADAPTERS[scanner]
  if (!adapter) {
    console.error(`ingest-scanner-findings: unknown --scanner '${scanner}'. Known: ${Object.keys(ADAPTERS).join(', ')}`)
    process.exit(2)
  }

  let raw
  try {
    raw = adapter.collect({ input, target })
  } catch {
    raw = null
  }

  const ledgerPath = join(target, '.security-review', 'audit-ledger.json')
  let ledger = { schema_version: '1', findings: [], passes: [] }
  let defaultPass = 1
  if (!dryRun) {
    try {
      ledger = loadLedger(ledgerPath)
    } catch (e) {
      console.error(`ingest-scanner-findings: ${e.message}`)
      process.exit(2)
    }
    defaultPass = ledger.passes.length ? Math.max(...ledger.passes.map((p) => p.id || 1)) : 1
  }
  const pass = Number.isInteger(passArg) && passArg >= 1 ? passArg : defaultPass

  // devcve-band: resolve the target's direct npm dev-dependency scope at THIS I/O boundary and
  // thread it into the pure ingest() (the file read happens here; ingest() stays pure).
  const { findings, notes } = ingest(raw, adapter, { repoRoot: target, pass, devScope: resolveDevScope(target) })

  let merged = null
  if (!dryRun) {
    merged = mergeFindings(ledger, findings, pass)
    try {
      mkdirSync(join(target, '.security-review'), { recursive: true })
    } catch {
      /* dir may already exist */
    }
    writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2))
  }

  if (asJson) {
    process.stdout.write(JSON.stringify({ scanner: adapter.name, kind: adapter.kind, findings, notes, merged }, null, 2) + '\n')
  } else {
    process.stdout.write(
      `ingest-scanner-findings [${adapter.name}/${adapter.kind}]: ${findings.length} deterministic finding(s)` +
        (dryRun ? ' (dry-run, not merged)' : `; merged +${merged.added} new / ${merged.updated} refreshed → ${ledgerPath}`) +
        '\n'
    )
    for (const n of notes) process.stdout.write(`  note: ${n}\n`)
  }
}

// --all CLI mode (journey-wiring). Thin wrapper over ingestAll(): resolve flags, run, print
// the honest summary (per recognized scanner → N findings; clean → "ran clean, 0 findings";
// unrecognized → skipped, named; Code-Analyzer-absent → PENDING-OWNER-RUN). `main()` above is
// byte-unchanged — the dispatch at module bottom routes --all here, so the per-`--scanner` path
// is untouched.
function mainAll() {
  const target = arg('--target', process.cwd())
  const asJson = process.argv.includes('--json')
  const dryRun = process.argv.includes('--dry-run')
  const passArg = parseInt(arg('--pass', ''), 10)
  const pass = Number.isInteger(passArg) && passArg >= 1 ? passArg : undefined

  let result
  try {
    result = ingestAll({ target, pass, dryRun })
  } catch (e) {
    console.error(`ingest-scanner-findings --all: ${e.message}`)
    process.exit(2)
  }

  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return
  }
  process.stdout.write(
    `ingest-scanner-findings --all [${target}]: ${result.findings.length} deterministic finding(s) from ` +
      `${result.scanners.length} scanner(s)` +
      (dryRun ? ' (dry-run, not merged)' : `; merged +${result.merged.added} new / ${result.merged.updated} refreshed`) +
      '\n'
  )
  for (const s of result.scanners) {
    const tag = s.status === 'clean' ? ' — ran clean, 0 findings' : ''
    process.stdout.write(`  ${s.scanner} [${s.kind}]: ${s.findings} finding(s)${tag}${s.file ? ` (${s.file})` : ''}\n`)
  }
  for (const sk of result.skipped) process.stdout.write(`  skipped ${sk.file}: ${sk.reason}\n`)
  if (result.pending.length) {
    process.stdout.write(
      `  PENDING-OWNER-RUN: ${result.pending.join(' + ')} — Code Analyzer output absent; run sf + the Code ` +
        `Analyzer plugin to make these deterministic (the LLM keeps its co-located findings as llm-inferred).\n`
    )
  }
  for (const n of result.notes) process.stdout.write(`  note: ${n}\n`)
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
  } catch {
    return fileURLToPath(import.meta.url) === process.argv[1]
  }
}
if (invokedDirectly()) (process.argv.includes('--all') ? mainAll() : main())

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
 *   - source-scanner — collect() greps the repo source directly (no external tool).
 *                     Adapter #2: `metadata-viewall` (engine:'metadata') — scans
 *                     permissionsets/*.permissionset-meta.xml for ViewAll/ModifyAll
 *                     over-grants, the one class Code Analyzer doesn't cover (it's
 *                     permission-set XML, not Apex).
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
 *     JOURNEY-WIRING mode (Phase 2, 0.8.40): ALWAYS runs metadata-viewall (source scan) +
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
}
const DEFAULT_DIMENSION = 'apex-exposed-surface'

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

  const findings = []
  for (const h of hits) {
    if (!h || !h.file || h.ruleId == null || h.engine == null) {
      notes.push(`${adapter.name}: skipped a malformed hit (missing engine/ruleId/file)`)
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
    findings.push(buildFinding({ ...h, classKey, repoRoot, pass }))
    if (!classKey) {
      // Honest note on the severity SOURCE of an unmapped hit: a tool→band adapter (Semgrep)
      // carries its own per-finding band, while a class-severity adapter (code-analyzer) with
      // an unmapped SECURITY rule uses the Code-Analyzer-severity fallback. Keeps the word
      // "unmapped" either way (the owned-class is still none).
      const how = h.bandFromTool
        ? `the ${adapter.name} tool band (${h.toolSevLabel || 'unknown'} → ${h.bandFromTool})`
        : 'the Code-Analyzer-severity fallback'
      notes.push(`${adapter.name}: rule ${h.ruleId} is unmapped (owns no toolkit class) — ingested as deterministic with ${how}`)
    }
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
// dimension 'external-sast' is a DETERMINISTIC-ONLY grouping label (like checkov's
// 'infrastructure-iac'): Semgrep spans many vuln classes, so an honest "external SAST" grouping
// beats false-precision dimensioning into injection-xss — the schema declares `dimension` a free
// kebab-case string, so no methodology/dimensions/ file is needed. Like checkov/metadata it is
// SECURITY-BY-CONSTRUCTION (the security rulesets), so NO `securityRelevant` — the ingest core
// keeps every emitted hit. Only `results[]` become findings.
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
        dimensionHint: 'external-sast',
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
// Phase-2b — the SAFE under-merge). dimension 'external-sast' is the same deterministic-only
// grouping label as Semgrep (Python SAST belongs to the same external-endpoint SAST grouping). Like
// semgrep/checkov/metadata it is SECURITY-BY-CONSTRUCTION (Bandit is a security scanner), so NO
// `securityRelevant` — the ingest core keeps every emitted hit. Only `results[]` become findings.
// `issue_confidence` is recorded by Bandit but deliberately NOT band-weighting here (Phase-2b note).
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
        dimensionHint: 'external-sast',
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
// Phase-2b — the SAFE under-merge). dimension 'external-sast' is the same deterministic-only grouping
// label as Semgrep/Bandit. Like them it is SECURITY-BY-CONSTRUCTION (njsscan is a security scanner),
// so NO `securityRelevant` — the ingest core keeps every emitted hit.
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
            dimensionHint: 'external-sast',
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

export const ADAPTERS = {
  'code-analyzer': codeAnalyzerAdapter,
  'metadata-viewall': metadataViewAllAdapter,
  'checkov': checkovAdapter,
  'semgrep': semgrepAdapter,
  'bandit': banditAdapter,
  'njsscan': njsscanAdapter,
  'gitleaks': gitleaksAdapter,
  'detect-secrets': detectSecretsAdapter,
  'osv': osvAdapter,
  'npm-audit': npmAuditAdapter,
  'trivy': trivyAdapter,
  'regexploit': regexploitAdapter,
}

// ----------------------------------------------------------------------------
// recognizeScanner — content-shape routing for the --all journey-wiring mode.
// Returns the SINGLE file-parser adapter NAME whose `detect(raw)` matches, `null` if none
// match, or `{ ambiguous: [names] }` if MORE THAN ONE matches (a recognizer bug — the caller
// logs it loudly and SKIPS the file, never guessing). Iterates only ADAPTERS entries that
// carry a `detect` fn (metadata-viewall, the source-scanner, has none). Each `detect` is
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
      ledger.findings.push(nf)
      byId.set(nf.id, nf)
      added++
    }
  }
  return { added, updated }
}

// ----------------------------------------------------------------------------
// ingestAll — the --all journey-wiring orchestrator (Phase 2, 0.8.40). The I/O seam that
// makes the whole Phase-2 build run in the real journey: it ALWAYS runs metadata-viewall, then
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

  const notes = []
  const scanners = [] // { scanner, kind, [file], findings, status:'ran'|'clean' }
  const skipped = [] // { file, reason }
  const allFindings = []
  const recognized = new Set()

  // (1) ALWAYS run the metadata source scan — it needs no evidence file, no `sf`, no network
  // (greps the repo's *.permissionset-meta.xml for ViewAll/ModifyAll over-grants).
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

  // (2) enumerate evidence/*.json — TOP LEVEL only (skip subdirs like dast/), sorted for determinism.
  let files = []
  try {
    files = readdirSync(evidenceDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.json'))
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
    const rec = recognizeScanner(raw)
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
    const adapter = ADAPTERS[rec]
    const res = ingest(raw, adapter, { repoRoot: root, pass: passId })
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

  const { findings, notes } = ingest(raw, adapter, { repoRoot: target, pass })

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

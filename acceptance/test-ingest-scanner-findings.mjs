#!/usr/bin/env node
/**
 * Standing test for harness/ingest-scanner-findings.mjs — the deterministic-findings
 * ingest foundation (Phase 1 · Slice 1 of docs/roadmap-deterministic-findings.md).
 *
 * The whole point of this slice is that a `deterministic` finding is validated by
 * "run the engine twice → identical" (a unit test), NOT a 5-run campaign. These checks
 * drive the REAL Code Analyzer output captured from the frozen Solano + Meridian
 * fixtures and assert the three campaign-wobbled classes land deterministically with a
 * severity taken from the requirement CLASS, never the scanner's number and never an LLM.
 *
 * Guards:
 *   D — determinism: ingest the real fixture twice → byte-identical findings.
 *   A — anchor: the ApexCRUDViolation on SolanoAccountInsightController.cls:19 (the
 *       Contact-PII FLS the LLM ledger dropped) becomes a deterministic crud-fls finding.
 *   S — severity-from-CLASS, not the scanner number: mutating violation.severity does
 *       NOT move a mapped finding's severity; the canonical taxonomy maps are correct.
 *   SH/V — sharing (SFGE) + ViewAll/ModifyAll (metadata source-scanner) ingest with the
 *       right engine/class/severity; standard objects + non-over-grants are NOT flagged.
 *   EG — the egress-plain-http source-scanner (B5 · E0.3b-1, 0.8.66): flags every endpoint
 *       declared over plain http:// in the package's egress-config metadata (RemoteSiteSetting
 *       <url> · CspTrustedSite <endpointUrl> · NamedCredential legacy <endpoint> + modern
 *       <parameterValue> with sibling <parameterType>Url) — the codified Secure Communication
 *       violation, class plain-http-egress → endpoint-https-only (major → high), dimension
 *       package-metadata. PRECISION: scheme-anchored (https:// never flags) + element-scoped
 *       (an http:// in a <description>, or the xmlns URI itself, never flags). The owned class
 *       is SINGLE-SHAPE at its locus — the finding sits on the specific http:// URL line, so
 *       supersession never reaches a different-shape package-metadata finding at a different
 *       locus (EG-non-supersession; a SAME-locus supersession would be correct — the
 *       deterministic row is authoritative for that endpoint). HONEST FLOOR: a statically-
 *       declared insecure-transport endpoint, never a confirmed leak, and NO secret finding
 *       is emitted from a credential file (secret values are org-encrypted, never in metadata).
 *   PV — the view-modify-all-data source-scanner (B5 · E0.3c-1, 0.8.67; reframed 0.8.68):
 *       flags the org-wide ViewAllData / ModifyAllData system permission granted via
 *       <userPermissions> with <enabled>true</enabled> in permission sets AND profiles — a
 *       least-privilege ADVISORY, class view-modify-all-data →
 *       least-privilege-permission-grants (informational → info, OFF the blocker floor),
 *       dimension admin-surface: user permissions are excluded from managed-package
 *       permsets/profiles at install, so a packaged grant may not reach subscribers via the
 *       package, and no named AppExchange requirement auto-fails a permission grant — the
 *       finding advises verifying the effective grant + documenting a justification
 *       (PV-advisory locks the caveat + the off-blocker-floor severity). Covers exactly the
 *       gap metadata-viewall leaves (that scan reads
 *       <objectPermissions> in permission sets only — never <userPermissions>, never profiles;
 *       PV-no-overlap locks the disjointness in both directions). PRECISION: exact-name
 *       ({ViewAllData, ModifyAllData} only — ViewAllUsers never matches) + enabled-required
 *       (an explicit enabled=false row never flags) + element-scoped (a <description> mention
 *       never flags). SINGLE-SHAPE at its locus (the <name> grant line), so supersession never
 *       reaches a different-shape admin-surface finding at a different locus
 *       (PV-non-supersession; a SAME-locus supersession would be correct). HONEST FLOOR: a
 *       statically-declared grant is an advisory signal (FLS still applies), never a
 *       confirmed subscriber grant or leak, and retrieved profile metadata may be PARTIAL —
 *       absence is not least-privilege proof.
 *   DP — the remote-site-protocol-security source-scanner (B5 · E0.3b-2, 0.8.69): flags a
 *       RemoteSiteSetting that sets <disableProtocolSecurity>true</disableProtocolSecurity> —
 *       the flag that permits data transfer between an HTTPS session and an HTTP session (a
 *       transport downgrade), the codified Secure Communication violation, class
 *       protocol-security-disabled → endpoint-https-only (major → high), dimension
 *       package-metadata (the SAME baseline plain-http-egress grounds in — one requirement,
 *       two metadata shapes, two distinct classes). PRECISION: true-required (an explicit
 *       false element, the platform default, never flags; an absent element never flags) +
 *       element-scoped (a <description> mentioning the flag in prose never flags).
 *       INDEPENDENT of egress-plain-http — that adapter reads endpoint-URL schemes, this one
 *       reads only the protocol-security element (DP-no-overlap locks the disjointness in
 *       both directions). SINGLE-SHAPE at its locus (the <disableProtocolSecurity> element
 *       line), so supersession never reaches a different-shape package-metadata finding at a
 *       different locus (DP-non-supersession; a SAME-locus supersession would be correct).
 *       HONEST FLOOR: a statically-declared protocol-security opt-out, LOW FP (defaults
 *       false, explicitly warned against); the rare internal/on-premises HTTP case is
 *       dispositionable via the FP dossier, never suppressed.
 *   AP — the admin-privilege-grant source-scanner (B5 · E0.3c-2, 0.8.70): flags the
 *       high-risk ADMIN/PRIVILEGE system permissions — ManageUsers / AuthorApex /
 *       CustomizeApplication / ModifyMetadata — granted via <userPermissions> with
 *       <enabled>true</enabled> in permission sets AND profiles — a least-privilege
 *       ADVISORY, class admin-privilege-grant → least-privilege-permission-grants
 *       (informational → info, OFF the blocker floor), dimension admin-surface: the SAME
 *       grounding as its sibling view-modify-all-data (that class covers the org-wide
 *       DATA-access pair {ViewAllData, ModifyAllData}; this one covers the admin/privilege
 *       quartet — disjoint Sets, no double-report; AP-no-overlap locks it in both
 *       directions, on a shared fixture dir). Every Set name is a CONFIRMED
 *       Profile/PermissionSet <userPermissions> API name. PRECISION: exact-name (the
 *       adjacent delegated-administration ManageInternalUsers never matches) +
 *       enabled-required (an explicit enabled=false row never flags) + element-scoped (a
 *       <description> mention never flags). SINGLE-SHAPE at its locus (the <name> grant
 *       line), so supersession never reaches a different-shape admin-surface finding at a
 *       different locus (AP-non-supersession; a SAME-locus supersession would be correct).
 *       HONEST FLOOR: a statically-declared grant is an advisory signal, never a confirmed
 *       subscriber grant (user permissions are excluded from managed-package
 *       permsets/profiles at install — verify the effective grant), and retrieved profile
 *       metadata may be PARTIAL — absence is not least-privilege proof.
 *   U — an unmapped rule is still ingested as deterministic (never dropped) with the
 *       documented Code-Analyzer-severity fallback + a note.
 *   M — merge is additive + idempotent (re-ingest → no duplicates; LLM findings survive).
 *   F — fail-safe: missing / non-JSON / empty input → no findings, no crash.
 *   SC — a deterministic finding validates against the extended audit-ledger.schema.json;
 *        an existing llm-inferred finding (no provenance) still validates; a deterministic
 *        finding missing engine FAILS (the conditional bites).
 *   AD — the pluggable adapter registry: 18 adapters across both kinds (file-parser:
 *        code-analyzer/checkov/semgrep/opengrep/bandit/njsscan/gitleaks/detect-secrets/osv/npm-audit/trivy/regexploit/sarif + source-scanner: metadata-viewall/egress-plain-http/view-modify-all-data/remote-site-protocol-security/admin-privilege-grant).
 *   SS — the single-shape (class-owning) registry (B5, 0.8.74): the
 *        supersession-safety invariant mechanically ENFORCED. An adapter may own a class
 *        (classify() → a non-null CLASS_DEFS key) ONLY when that class is registered in
 *        SINGLE_SHAPE — the explicit declaration that it is a distinct single-shape finding,
 *        safe to supersede only the co-located LLM finding at its own locus. Every adapter's
 *        classify() is exercised over the full RULE_CLASS + RULE_DIMENSION key sets plus
 *        arbitrary/unknown ruleIds to enumerate the ACTUAL owned set, then the registry is
 *        pinned from both directions: owned ⊆ registry (the forcing function — a new
 *        classify() returning an unregistered class fails the build), registry ⊆ CLASS_DEFS
 *        (no phantom/stale rows), registry == owned (deepEqual — no stale declaration), and
 *        the CWE-routing / dependency / ReDoS adapters stay classify()→null (the multi-shape
 *        posture can never quietly start owning). Before this registry the shape-decision
 *        was a silent manual invariant.
 *   CLI — the CLI runs every adapter, --json + merge, idempotent on the ledger.
 *   CK/SG/BN/NJ/GL/DS/OSV/NPM/TRV — the Phase-2 per-scanner adapters (checkov IaC · semgrep/bandit/njsscan tool→band ·
 *        gitleaks/detect-secrets class-severity hardcoded-secrets · osv dependency-CVE Extension A CVSS→enum ·
 *        npm-audit dependency-CVE Extension-A reuse, label-only band · trivy IaC-misconfig config-mode,
 *        REUSES checkov's iac-misconfig class at class-severity — Trivy's own Severity recorded for reference only).
 *   RD — the regexploit ReDoS adapter (residual-shrinking · B5 #1, 0.8.56): the FIRST format-C (non-JSON)
 *        adapter — parses the tool's VERBATIM text (blocks, line loci, multi-record worst-degree), bands via
 *        REDOS_DEGREE_TO_FINDING (exponential→high · polynomial→medium · unknown→medium, never blocker),
 *        gated by resource-consumption-abuse; classify()→null is THE design decision, locked by the
 *        RD-non-supersession check (a co-located llm-inferred resource-consumption-abuse finding is NOT
 *        superseded — the dimension is multi-shape, so an owned class here would silence rate-limit /
 *        denial-of-wallet findings; mutation-proven).
 *   INJ / XPATHLDAP — the CWE→dimension routing (B5 · E0.1b, 0.8.58; taxonomy EXPANDED + njsscan
 *        wired, E0.1b-EXPAND, 0.8.59; XPath 643 + LDAP 90 promoted, E0.1e-A, 0.8.63): a
 *        semgrep/bandit/njsscan hit whose scanner-emitted CWE is in the exact INJECTION_XSS_CWES
 *        allowlist (89 SQL/SOQLi · 78 OS-command · 79 XSS · 94/95 code/eval · 96 template/SSTI ·
 *        90 LDAP · 643 XPath · 943 NoSQL — each proven by a GENERATED per-sub-class fixture, semgrep
 *        1.168.0 / bandit 1.9.4 / njsscan 0.4.2; XPath/LDAP from semgrep-xpath-ldap-seeded.json
 *        [java+csharp] + njsscan-xpath-seeded.json [node xpath.parse() only]) files under the REAL
 *        injection-xss dimension;
 *        CWE-939 / CWE-22 / CWE-352 CSRF / every other co-resident stays external-sast (the
 *        negative-routing lock — exact integer membership, never a substring/rule-name match; SSRF
 *        918 and path-traversal 22 belong to data-export). Fixtures are RULE-PATH-PROVEN, not
 *        class-proven (see the honesty caveat on the allowlist). classify() stays null on ALL THREE
 *        adapters, locked by INJ-non-supersession (an owned class would silence a co-located
 *        llm-inferred injection finding of a DIFFERENT shape; mutation-proven — the RD posture ported).
 *   SESS — the Code Analyzer rule-name→dimension routing (B5 · E0.1d, 0.8.65): CA v5 output
 *        carries NO CWE field, so the pmd-appexchange session-id retrieval rules
 *        (AvoidUnauthorizedGetSessionIdInApex + AvoidUnauthorizedApiSessionIdInVisualforce,
 *        both fixture-proven from a genuine AppExchange-selector capture) route by RULE NAME
 *        via RULE_DIMENSION (RULE_CLASS's disjoint class-less sibling) to the sessionid-egress
 *        dimension. The routed finding is class-less (classify() stays null, AD2 intact) so it
 *        supersedes nothing — the multi-shape lock, SESS-non-supersession (mutation-proven);
 *        the retrieval SITE is deterministic, the egress VERDICT stays the labelled residual.
 *   SG-RP-SARIF/SG-RP-OG/SG-SARIF-CE-PENDING/ALL-SARIF — the SARIF codeFlows reachability surface
 *        (B5 · E0.2b, 0.8.61): the version-portable `sarif` adapter (engine from tool.driver.name,
 *        codeFlows→reachabilityPath via _sarifReachabilityPath, level→band, rule-tag CWE routing,
 *        classify()→null) + the `opengrep` engine-label adapter (D1: opengrep JSON is content-
 *        indistinguishable from semgrep's — the honest label comes from --scanner/the documented
 *        opengrep-* evidence name, never a content guess) + the --all *.sarif enumeration + the
 *        CE-SARIF adjudication pin (semgrep 1.168.0 emitted NO codeFlows — PENDING, not fabricated).
 *   SG-RP-SUB/SG-RP-DRIFT — the substrate-unavailable + version-drift honesty markers (B5 ·
 *        item 7, 0.8.80): a toolkit taint rule (`rules.injection.` check_id prefix — the one
 *        rule set whose taint mode is knowable from output; registry taintness is unknowable,
 *        never guessed) firing with NO dataflow trace → ONE aggregated deterministic note;
 *        an opengrep evidence version ≠ the pinned install (recorded∩pinned = opengrep ONLY;
 *        the SARIF hook is driver-gated so Semgrep OSS never false-fires) → a drift note with
 *        a single-sourced comparand (PINNED_TOOL_VERSIONS derived from BINARY_PINS, locked).
 *        NOTES only — findings byte-identical, hooks optional per adapter, others inert.
 *   RC — the content-shape recognizer (--all routing, 0.8.40): every committed fixture → its OWN adapter;
 *        a clean (results:[]) scan still recognized; non-adapter shapes (index.json/retire/openapi/the deps-npm
 *        WRAPPER) → null; a 2-match → {ambiguous}, never a guess; failsafe (null/{}/non-object → null, no throw).
 *   ALL — the --all journey-wiring mode (0.8.40): recognizes + ingests every RENAMED scanner output by content
 *        shape (filename-independent), skips the non-adapter index.json (named), is byte-deterministic run-to-run,
 *        reports Code-Analyzer-absent → PENDING-OWNER-RUN, and preserves the secret-never-leaks invariant.
 *
 * Dependency-free: `node acceptance/test-ingest-scanner-findings.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  ingest,
  buildFinding,
  codeAnalyzerAdapter,
  metadataViewAllAdapter,
  egressPlainHttpAdapter,
  viewModifyAllDataAdapter,
  remoteSiteProtocolSecurityAdapter,
  adminPrivilegeGrantAdapter,
  checkovAdapter,
  semgrepAdapter,
  opengrepAdapter,
  sarifAdapter,
  banditAdapter,
  njsscanAdapter,
  gitleaksAdapter,
  detectSecretsAdapter,
  osvAdapter,
  npmAuditAdapter,
  trivyAdapter,
  regexploitAdapter,
  ADAPTERS,
  classSeverity,
  baselineSeverityFor,
  mergeFindings,
  loadLedger,
  recognizeScanner,
  ingestAll,
  resolveDevScope,
  hasSecurityTag,
  REQ_SEVERITY_TO_FINDING,
  CA_SEVERITY_TO_FINDING,
  SEMGREP_SEVERITY_TO_FINDING,
  SARIF_LEVEL_TO_FINDING,
  BANDIT_SEVERITY_TO_FINDING,
  NJSSCAN_SEVERITY_TO_FINDING,
  CVSS_SCORE_TO_FINDING,
  OSV_LABEL_TO_FINDING,
  NPM_SEVERITY_TO_FINDING,
  REDOS_DEGREE_TO_FINDING,
  INJECTION_XSS_CWES,
  CWE_TO_DIMENSION,
  dimensionForCwes,
  CLASS_DEFS,
  RULE_CLASS,
  RULE_DIMENSION,
  SINGLE_SHAPE,
} from '../harness/ingest-scanner-findings.mjs'
import { reconcileProvenance } from '../harness/reconcile-provenance.mjs'
import { sameLocation } from '../harness/finding-clusters.mjs'
import { BINARY_PINS, PINNED_TOOL_VERSIONS } from '../harness/install-scanners.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'ingest-scanner-findings.mjs')
const FIX = join(PLUGIN, 'acceptance', 'fixtures')
const SOLANO = join(FIX, 'code-analyzer-solano.json')
const SFGE = join(FIX, 'code-analyzer-sfge-meridian.json')
const CHECKOV = join(FIX, 'checkov-dockerfile-solano.json')
const SEMGREP_WARN = join(FIX, 'semgrep-coldstart-full.json') // 2× WARNING (dynamic-urllib, CWE-939 — stays external-sast: the negative-routing anchor)
const SEMGREP_ERR = join(FIX, 'semgrep-helios.json') // 1× ERROR (detect-child-process, CWE-78 → injection-xss: the semgrep routing anchor)
const BANDIT = join(FIX, 'bandit-coldstart-full.json') // 4× MEDIUM (B608 CWE-89 → injection-xss anchor + 2× B310 CWE-22 + B104 CWE-605 — all three stay external-sast)
const BANDIT_HYG = join(FIX, 'bandit-test-hygiene-seeded.json') // genuine-SHAPED, seeded (0.8.83): the test-path LOW hygiene anchor — B101/B404 under tests/ filtered; prod-LOW B105 + MEDIUM B608 + test-path HIGH B602 kept
const NJSSCAN = join(FIX, 'njsscan-solano.json') // 2 nodejs findings: node_secret ERROR + helmet_feature_disabled WARNING
const GITLEAKS = join(FIX, 'gitleaks-coldstart-full.json') // 3× generic-api-key (anchor mcp/server.py:27 + 2× ops/deploy-notes.md)
const DETECT_SECRETS = join(FIX, 'detect-secrets-solano.json') // genuine detect-secrets 1.5.0: 24 occ across 6 files, 3 types (anchor .security-review/audit-engine.mjs:181 Secret Keyword)
const OSV = join(FIX, 'osv-coldstart-full.json') // genuine OSV-Scanner: 1 source (mcp/requirements.txt), 3 PyPI pkgs, 11 vulns (1 critical h11 / 3 high / 6 medium / 1 low starlette)
const NPM_AUDIT = join(FIX, 'npm-audit-solano.json') // genuine `npm audit --json` v2: 4 vulnerable pkgs (body-parser/express/path-to-regexp/qs), moderate×2 + high×2
const TRIVY = join(FIX, 'trivy-dockerfile-solano.json') // genuine Trivy 0.71.2 filesystem scan: 1 Class:'config' Result, 1 FAIL misconfig (DS-0026 No HEALTHCHECK, Severity LOW, no StartLine — the IaC anchor, class-severity high)
const REDOS = join(FIX, 'regexploit-seeded.txt') // genuine regexploit 1.0.0 VERBATIM stdout (format C — text, not JSON) over seeded vulnerable py/js: 4 blocks — (a+)+$ exp @server.py:3 + (.*)*x exp @:4 + a*a*a*$ cubic @:5 (Context lines) + (x+)+y(z+)+w exp @validate.js:1 (JS: no Context, TWO Redos records in ONE block), with a mid-file "Processed N regexes" trailer between the two tools' outputs
const SESSFIX = join(FIX, 'code-analyzer-sessionid-seeded.json') // genuine `sf code-analyzer run --rule-selector AppExchange` capture (CA core 0.48.0 / pmd engine 0.41.0 / plugin 5.13.0) over a minimal seeded sample: AvoidUnauthorizedGetSessionIdInApex @SeedSession.cls:3 + AvoidUnauthorizedApiSessionIdInVisualforce @SeedSessionPage.page:3 — the RULE_DIMENSION sessionid-egress routing anchors
const CATFIX = join(FIX, 'code-analyzer-catalog-seeded.json') // genuine `sf code-analyzer run --rule-selector AppExchange` capture (CA core 0.48.0 / pmd engine 0.41.0 / plugin 5.13.0) over a seeded multi-rule corpus: 12 violations / 7 files firing all 11 catalog-cluster rules (3 session-id siblings + 7 hardcoded-credential rules + AvoidChangeProtectionUnprotected) — the E0.1d-EXPAND routing anchors
const MARKFIX = join(FIX, 'code-analyzer-catalog-markup-seeded.json') // genuine `sf code-analyzer run --rule-selector AppExchange` capture (CA core 0.48.0 / pmd engine 0.41.0) over a seeded corpus: 4 violations / 3 files firing all 4 class-less-safe markup/OAuth-cluster rules (AvoidUnescapedHtmlInAura + AvoidCreateElementScriptLinkTag → injection-xss; UseHttpsCallbackUrlConnectedApp + LimitConnectedAppScope → oauth-identity) — the E0.1d-EXPAND-2 routing anchors
const OWNDIMFIX = join(FIX, 'code-analyzer-catalog-owned-dim-seeded.json') // genuine `sf code-analyzer run --rule-selector AppExchange` capture (CA core 0.48.0 / pmd engine 0.41.0) over a seeded corpus: 4 violations / 4 files firing all 4 owned-class-dimension cluster rules (AvoidSControls + AvoidAuraWithLockerDisabled + AvoidLmcIsExposedTrue → package-metadata; ProtectSensitiveData → secrets-credentials) — the E0.1d-EXPAND-3 routing anchors
const JSMETAFIX = join(FIX, 'code-analyzer-catalog-jsmeta-seeded.json') // genuine `sf code-analyzer run --rule-selector AppExchange` capture (CA core 0.48.0 / pmd engine 0.41.0) over a seeded corpus: 8 violations / 5 files firing all 8 JS-in-metadata + resource-loader cluster rules (AvoidJavaScriptInUrls + AvoidJavaScriptWebLink + AvoidJavaScriptCustomObject + AvoidJavaScriptHomePageComponent + the 4 Load* hotlink rules → package-metadata), INCLUDING the Load* FP-breadth probe (an inline-script/$Resource page that produced zero violations) — the E0.1d-EXPAND-4 routing anchors
const SCHEMA_PATH = join(PLUGIN, 'templates', 'audit-ledger.schema.json')

const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'))
const readText = (p) => readFileSync(p, 'utf8')
const clone = (o) => JSON.parse(JSON.stringify(o))

let pass = 0
let fail = 0
const dirs = []
const check = (name, fn) => {
  try {
    fn()
    pass++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    fail++
    console.log(`  ✗ ${name}\n    ${e.message}`)
  }
}

// ---- a focused JSON-Schema validator for $defs/finding (the subset the schema uses) ----
const FINDING_DEF = readJSON(SCHEMA_PATH).$defs.finding
const SEVERITY_ENUM = ['critical', 'high', 'medium', 'low', 'info']
function validateFinding(f, fdef = FINDING_DEF) {
  const errors = []
  for (const r of fdef.required) if (!(r in f)) errors.push(`missing required '${r}'`)
  const allowed = new Set(Object.keys(fdef.properties))
  for (const k of Object.keys(f)) if (!allowed.has(k)) errors.push(`additional property '${k}'`)
  for (const [k, v] of Object.entries(f)) {
    const p = fdef.properties[k]
    if (!p) continue
    if (p.type === 'string' && typeof v !== 'string') errors.push(`'${k}' must be string`)
    if (p.type === 'integer' && !Number.isInteger(v)) errors.push(`'${k}' must be integer`)
    if (p.type === 'boolean' && typeof v !== 'boolean') errors.push(`'${k}' must be boolean`)
    if (Array.isArray(p.enum) && !p.enum.includes(v)) errors.push(`'${k}'='${v}' not in enum`)
    if (p.pattern && typeof v === 'string' && !new RegExp(p.pattern).test(v)) errors.push(`'${k}' fails pattern`)
    if (p.minLength != null && typeof v === 'string' && v.length < p.minLength) errors.push(`'${k}' below minLength`)
    if (p.$ref === '#/$defs/severity' && !SEVERITY_ENUM.includes(v)) errors.push(`'${k}'='${v}' not a severity`)
  }
  for (const cond of fdef.allOf || []) {
    const ifr = cond.if || {}
    const reqOk = (ifr.required || []).every((r) => r in f)
    const propsOk = Object.entries(ifr.properties || {}).every(([k, c]) => c.const === undefined || f[k] === c.const)
    if (reqOk && propsOk) {
      for (const r of (cond.then && cond.then.required) || []) if (!(r in f)) errors.push(`conditional: missing '${r}'`)
    }
  }
  return errors
}

console.log('ingest-scanner-findings standing test')

// helper: ingest the solano file-parser fixture in-memory (PURE — no collect/I-O)
const ingestSolano = (raw) => ingest(raw || readJSON(SOLANO), codeAnalyzerAdapter, { repoRoot: '', pass: 1 })
const findById = (fs, pred) => fs.find(pred)

// ────────────────────────────────────────────────────────────── determinism
check('D1 determinism: ingest the real Solano fixture twice → byte-identical findings', () => {
  const a = ingestSolano().findings
  const b = ingestSolano().findings
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})

check('D2 the 4 Security/AppExchange-tagged Solano violations ingest (the 2 Performance-tagged filtered, no security finding dropped)', () => {
  const { findings } = ingestSolano()
  // 6 real violations → 4 findings: 2× ApexCRUDViolation + 1× AvoidHardcodedCredentialsInVarDecls
  // + 1× ApexFlsViolation are Security-tagged; the 2× MissingNullCheckOnSoqlVariable are
  // Performance-tagged (∌ Security/AppExchange) → filtered as non-security noise.
  assert.equal(findings.length, 4)
  assert.ok(findings.every((f) => f.provenance === 'deterministic'))
})

// ────────────────────────────────────────────────────────────── the anchor
check('A1 anchor: ApexCRUDViolation on SolanoAccountInsightController.cls:19 → deterministic crud-fls (engine pmd, class severity high)', () => {
  const { findings } = ingestSolano()
  const anchor = findById(
    findings,
    (f) => f.ruleId === 'ApexCRUDViolation' && f.file.endsWith('SolanoAccountInsightController.cls:19')
  )
  assert.ok(anchor, 'anchor finding not present')
  assert.equal(anchor.provenance, 'deterministic')
  assert.equal(anchor.engine, 'pmd')
  assert.equal(anchor.ruleId, 'ApexCRUDViolation')
  assert.equal(anchor.status, 'confirmed')
  assert.equal(anchor.dimension, 'apex-exposed-surface')
  // severity from the crud-fls baseline class (fail-crud-fls=major → high), NOT Code Analyzer's 2
  assert.equal(anchor.adjusted_severity, 'high')
  assert.match(anchor.id, /^[0-9a-f]{16}$/)
})

check('A2 the two ApexCRUDViolation files are DISTINCT findings (distinct ids)', () => {
  const { findings } = ingestSolano()
  const crud = findings.filter((f) => f.ruleId === 'ApexCRUDViolation')
  assert.equal(crud.length, 2)
  assert.notEqual(crud[0].id, crud[1].id)
  const files = crud.map((f) => f.file).sort()
  assert.ok(files.some((f) => f.endsWith('SolanoAccountInsightController.cls:19')))
  assert.ok(files.some((f) => f.endsWith('SolanoOpportunityController.cls:21')))
})

check('A3 a MAPPED deterministic finding carries its owned-class label (`class`); reconcile-provenance reads it', () => {
  const { findings } = ingestSolano()
  const anchor = findById(findings, (f) => f.ruleId === 'ApexCRUDViolation' && f.file.endsWith('SolanoAccountInsightController.cls:19'))
  assert.equal(anchor.class, 'crud-fls') // mapped → owns the crud-fls class
  const meta = ingest(metadataViewAllAdapter.collect({ target: FIX }), metadataViewAllAdapter, { repoRoot: FIX, pass: 1 }).findings[0]
  assert.equal(meta.class, 'viewall-overgrant')
})

// ──────────────────────────────────────────────────── severity FROM THE CLASS
check('S1 severity-from-CLASS: mutating violation.severity does NOT move a mapped finding', () => {
  const raw = clone(readJSON(SOLANO))
  // bump every ApexCRUDViolation to the scanner's LEAST-severe number (5)
  for (const v of raw.violations) if (v.rule === 'ApexCRUDViolation') v.severity = 5
  const { findings } = ingestSolano(raw)
  const anchor = findById(
    findings,
    (f) => f.ruleId === 'ApexCRUDViolation' && f.file.endsWith('SolanoAccountInsightController.cls:19')
  )
  // would be 'info' if it followed Code Analyzer's number; stays 'high' because severity is from the class
  assert.equal(anchor.adjusted_severity, 'high')
})

check('S2 classSeverity reads the BASELINE: crud-fls → fail-crud-fls=major → high', () => {
  assert.equal(baselineSeverityFor('fail-crud-fls'), 'major')
  const cs = classSeverity('crud-fls')
  assert.equal(cs.severity, 'high')
  assert.equal(cs.reqSev, 'major')
  assert.equal(cs.baselineId, 'fail-crud-fls')
  assert.equal(cs.fromBaseline, true)
})

check('S3 canonical requirement→finding severity map (blocker/major/minor/informational)', () => {
  assert.deepEqual(REQ_SEVERITY_TO_FINDING, {
    blocker: 'critical',
    major: 'high',
    minor: 'low',
    informational: 'info',
  })
})

check('S4 Code-Analyzer 1–5 fallback map (1→critical … 5→info)', () => {
  assert.deepEqual(CA_SEVERITY_TO_FINDING, { 1: 'critical', 2: 'high', 3: 'medium', 4: 'low', 5: 'info' })
})

// ─────────────────────────────────────────────────────────────────── sharing
check('SH1 sharing (SFGE): DatabaseOperationsMustUseWithSharing → sharing class, engine sfge, high', () => {
  const { findings } = ingest(readJSON(SFGE), codeAnalyzerAdapter, { repoRoot: '', pass: 1 })
  const sharing = findings.filter((f) => f.ruleId === 'DatabaseOperationsMustUseWithSharing')
  assert.ok(sharing.length >= 1)
  for (const f of sharing) {
    assert.equal(f.engine, 'sfge')
    assert.equal(f.provenance, 'deterministic')
    assert.equal(f.adjusted_severity, 'high')
    assert.equal(f.dimension, 'apex-exposed-surface')
  }
  // the SFGE fixture also carries crud-fls (ApexFlsViolation) at high
  const fls = findings.filter((f) => f.ruleId === 'ApexFlsViolation')
  assert.ok(fls.length >= 1 && fls.every((f) => f.adjusted_severity === 'high'))
})

check('SH2 classSeverity reads the BASELINE: sharing → fail-sharing-model=major → high', () => {
  assert.equal(baselineSeverityFor('fail-sharing-model'), 'major')
  assert.equal(classSeverity('sharing').severity, 'high')
})

// ──────────────────────────────────────────────────── ViewAll metadata (source-scanner)
check('V1 metadata-viewall (source-scanner): viewAllRecords on a CUSTOM object → metadata/viewall-overgrant/high/admin-surface', () => {
  const raw = metadataViewAllAdapter.collect({ target: FIX })
  const { findings } = ingest(raw, metadataViewAllAdapter, { repoRoot: FIX, pass: 1 })
  assert.equal(findings.length, 1)
  const f = findings[0]
  assert.equal(f.provenance, 'deterministic')
  assert.equal(f.engine, 'metadata')
  assert.equal(f.ruleId, 'viewall-overgrant')
  assert.equal(f.adjusted_severity, 'high')
  assert.equal(f.dimension, 'admin-surface')
  assert.match(f.file, /Solano_Admin\.permissionset-meta\.xml:\d+$/)
  assert.match(f.title, /Solano_Forecast_Snapshot__c/)
})

check('V2 metadata-viewall does NOT flag a standard object or a non-over-grant', () => {
  const raw = metadataViewAllAdapter.collect({ target: FIX })
  const { findings } = ingest(raw, metadataViewAllAdapter, { repoRoot: FIX, pass: 1 })
  // Account (standard, viewAllRecords=true) and Solano_Coaching_Note__c (custom, false) must NOT appear
  assert.ok(!findings.some((f) => /\bAccount\b/.test(f.title)))
  assert.ok(!findings.some((f) => /Solano_Coaching_Note__c/.test(f.title)))
})

check('V3 classSeverity: viewall-overgrant grounds in fail-sharing-model (a sharing bypass) → high', () => {
  const cs = classSeverity('viewall-overgrant')
  assert.equal(cs.severity, 'high')
  assert.equal(cs.baselineId, 'fail-sharing-model')
  assert.equal(CLASS_DEFS['viewall-overgrant'].dimension, 'admin-surface')
})

// ────────────────────────── egress plain-HTTP metadata (source-scanner, B5 · E0.3b-1)
// The THIRD source-scanner (metadata-viewall's clone): reads the package's declarative
// egress-config metadata and flags every endpoint declared over plain http:// — the codified
// Secure Communication violation (endpoint-https-only, major → high, dimension
// package-metadata, whose charter owns the trusted-host XML http:// flags). The fixtures are
// AUTHORED schema-faithful metadata XML (the permissionsets/ source-scanner convention):
// 4 positives (RemoteSiteSetting <url> · CspTrustedSite <endpointUrl> · legacy NamedCredential
// <endpoint> · modern NamedCredential <parameterValue> with sibling <parameterType>Url) +
// 2 https negatives, one carrying an http:// inside its <description> (the element-scoped
// guard; the xmlns URI on every root element is http:// and must never flag either).
const EGFIX = join(FIX, 'egress-metadata')
const ingestEgress = () => {
  const raw = egressPlainHttpAdapter.collect({ target: EGFIX })
  return ingest(raw, egressPlainHttpAdapter, { repoRoot: EGFIX, pass: 1 })
}
// the fixture line that carries the offending element — computed from the fixture itself so
// the exact-locus assertions never go stale
const egLineOf = (file, needle) => readText(join(EGFIX, file)).split('\n').findIndex((l) => l.includes(needle)) + 1

check('EG1 egress-plain-http (source-scanner): a plain-http RemoteSiteSetting <url> → metadata/plain-http-egress/high/package-metadata at the <url> line, deterministic + schema-valid', () => {
  const { findings } = ingestEgress()
  const f = findings.find((x) => /Insecure_RSS\.remoteSite-meta\.xml/.test(x.file))
  assert.ok(f, 'the plain-http Remote Site Setting is flagged')
  assert.equal(f.provenance, 'deterministic')
  assert.equal(f.engine, 'metadata')
  assert.equal(f.ruleId, 'plain-http-egress')
  assert.equal(f.class, 'plain-http-egress')
  assert.equal(f.adjusted_severity, 'high')
  assert.equal(f.dimension, 'package-metadata')
  // the locus is the <url> line itself, not the file or the root element
  assert.equal(f.file, `Insecure_RSS.remoteSite-meta.xml:${egLineOf('Insecure_RSS.remoteSite-meta.xml', '<url>http://api.example.com')}`)
  assert.match(f.title, /<url>: http:\/\/api\.example\.com/)
  assert.match(f.verdict_reasoning, /severity fixed from the plain-http-egress class \(baseline requirement endpoint-https-only = major\)/)
  assert.deepEqual(validateFinding(f), [])
})

check('EG2 precision: https endpoints are NOT flagged; an http:// inside a <description> is NOT flagged (element-scoped, never a whole-file grep); the http:// xmlns URI never flags', () => {
  const { findings } = ingestEgress()
  assert.equal(findings.length, 4, 'exactly the four declared plain-http endpoints in the fixture dir — nothing more')
  assert.ok(!findings.some((f) => /Secure_RSS/.test(f.file)), 'the https <url> file is clean — including its <description> mentioning http://legacy.example.com')
  assert.ok(!findings.some((f) => /^Modern_NC\.namedCredential/.test(f.file)), 'the modern https <parameterValue> file is clean')
  assert.ok(!findings.some((f) => f.title.includes('soap.sforce.com')), 'the http:// metadata-namespace URI on every root element never flags')
})

check('EG3 a plain-http CspTrustedSite <endpointUrl> flags at the <endpointUrl> line', () => {
  const f = ingestEgress().findings.find((x) => /Insecure_CSP\.cspTrustedSite-meta\.xml/.test(x.file))
  assert.ok(f, 'the plain-http CSP Trusted Site is flagged')
  assert.equal(f.file, `Insecure_CSP.cspTrustedSite-meta.xml:${egLineOf('Insecure_CSP.cspTrustedSite-meta.xml', '<endpointUrl>http://cdn.example.com')}`)
  assert.match(f.title, /<endpointUrl>: http:\/\/cdn\.example\.com/)
  assert.equal(f.class, 'plain-http-egress')
  assert.equal(f.adjusted_severity, 'high')
  assert.equal(f.dimension, 'package-metadata')
})

check('EG4 NamedCredential: the legacy <endpoint> shape flags, the modern <parameterValue> (sibling <parameterType>Url) shape flags, the modern https shape does not — and NO secret finding is emitted from a credential file', () => {
  const { findings } = ingestEgress()
  const legacy = findings.find((x) => /Legacy_NC\.namedCredential-meta\.xml/.test(x.file))
  assert.ok(legacy, 'the legacy <endpoint> shape flags')
  assert.match(legacy.title, /<endpoint>: http:\/\/legacy\.example\.com/)
  const modern = findings.find((x) => /Modern_NC_Insecure\.namedCredential-meta\.xml/.test(x.file))
  assert.ok(modern, 'the modern <parameterValue> shape flags')
  assert.match(modern.title, /<parameterValue>: http:\/\/callout\.example\.com/)
  assert.equal(modern.file, `Modern_NC_Insecure.namedCredential-meta.xml:${egLineOf('Modern_NC_Insecure.namedCredential-meta.xml', '<parameterValue>http://callout.example.com')}`)
  assert.ok(!findings.some((x) => /^Modern_NC\.namedCredential/.test(x.file)), 'the modern https shape stays clean')
  // the honest floor: every emission from a credential file is the insecure-transport
  // endpoint — never a "secret" finding (the secret value is org-encrypted, not in metadata)
  assert.ok(findings.every((x) => x.ruleId === 'plain-http-egress'))
  assert.ok(!findings.some((x) => /secret|credential value/i.test(x.title)))
})

check('EG-classSeverity: plain-http-egress grounds in the BASELINE endpoint-https-only (major) → high, dimension package-metadata', () => {
  assert.equal(baselineSeverityFor('endpoint-https-only'), 'major')
  const cs = classSeverity('plain-http-egress')
  assert.equal(cs.severity, 'high')
  assert.equal(cs.baselineId, 'endpoint-https-only')
  assert.equal(cs.fromBaseline, true)
  assert.equal(CLASS_DEFS['plain-http-egress'].dimension, 'package-metadata')
})

check('EG-adapter: egress-plain-http is a registered source-scanner ({name,kind,collect,parse,classify}, NO securityRelevant, NO detect) and ingest is byte-deterministic', () => {
  assert.equal(ADAPTERS['egress-plain-http'], egressPlainHttpAdapter)
  assert.equal(egressPlainHttpAdapter.name, 'egress-plain-http')
  assert.equal(egressPlainHttpAdapter.kind, 'source-scanner')
  for (const m of ['collect', 'parse', 'classify']) assert.equal(typeof egressPlainHttpAdapter[m], 'function')
  // security-by-construction: every emission is a declared plain-http endpoint → no filter
  assert.equal(egressPlainHttpAdapter.securityRelevant, undefined)
  // a source-scanner has no evidence file → invisible to the content-shape recognizer
  assert.equal(egressPlainHttpAdapter.detect, undefined)
  assert.equal(egressPlainHttpAdapter.classify('anything'), 'plain-http-egress')
  const a = ingestEgress().findings
  const b = ingestEgress().findings
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})

check('EG-non-supersession: an owned-class plain-http-egress finding does NOT supersede a co-located llm-inferred package-metadata finding of a DIFFERENT shape at a DIFFERENT locus — locus-specificity is the protection', () => {
  const det = ingestEgress().findings.find((x) => /Insecure_RSS/.test(x.file)) // …remoteSite-meta.xml:<url> line
  assert.equal(det.class, 'plain-http-egress')
  assert.equal(det.dimension, 'package-metadata')
  // an llm-inferred package-metadata finding of a DIFFERENT shape (the trusted-host-inventory
  // staleness reasoning the dimension charter also owns), SAME file, NON-overlapping lines —
  // class-less, so sameOwnedClass falls back to the dimension match, which DOES hold here:
  const llm = {
    id: '7'.repeat(16),
    dimension: 'package-metadata',
    title: 'Trusted-host inventory entry looks stale — host ownership should be re-verified',
    severity: 'medium',
    adjusted_severity: 'medium',
    file: 'Insecure_RSS.remoteSite-meta.xml:1-7', // the file header block, NOT the <url> line
    status: 'confirmed',
    first_seen: 1,
    last_seen: 1,
    verdict: 'confirmed_real',
    verdict_reasoning: 'reasoned over the trusted-host inventory',
  }
  // the dimension fallback WOULD match (det owns a class, llm is class-less, same dimension);
  // the ONLY missing supersession ingredient is the locus — assert that explicitly:
  assert.equal(sameLocation(det, llm), false, 'different line span → not the same locus')
  const { findings, superseded, supersededIds } = reconcileProvenance([det, llm])
  assert.equal(superseded, 0, 'the different-locus LLM finding is NOT superseded — the deterministic row sits beside it')
  assert.deepEqual(supersededIds, [])
  assert.equal(findings.find((f) => f.id === llm.id).status, 'confirmed')
  assert.equal(findings.find((f) => f.id === det.id).status, 'confirmed')
  // NOTE: at the SAME locus (an LLM finding on the same http:// URL line) supersession WOULD
  // fire and WOULD be correct — the deterministic finding is authoritative for that endpoint.
  // The guard is that ownership never reaches a different-shape finding elsewhere in the file.
  // MUTATION: pointing llm.file at det's exact line turns `superseded === 0` red (the
  // supersession visibly fires), proving the protection is locus-specificity, not an accident.
})

// ────────────────────── org-wide View/Modify All Data grants (source-scanner, B5 · E0.3c-1)
// The FOURTH source-scanner (metadata-viewall's clone): reads the package's permission sets
// AND profiles and flags the two org-wide system permissions — ViewAllData /
// ModifyAllData — granted via <userPermissions> with <enabled>true</enabled>. These ignore
// ALL sharing rules and org-wide defaults on every object (they still respect FLS), so a
// declared grant is genuine least-privilege signal — but the finding is an ADVISORY
// (reframed 0.8.68: least-privilege-permission-grants, informational → info, dimension
// admin-surface, OFF the blocker floor): user permissions are excluded from managed-package
// permsets/profiles at install, so a packaged grant may not reach subscribers via the
// package, and no named AppExchange requirement auto-fails a permission grant. The
// fixtures are AUTHORED schema-faithful metadata XML (the permissionsets/ + egress-metadata/
// convention): 3 positives (permset ViewAllData + permset ModifyAllData + PROFILE
// ModifyAllData — the surface metadata-viewall never reads) and 1 negative file exercising
// every precision guard (enabled=false ViewAllData · a <description> mention · benign
// ViewSetup · the ViewAll*-prefixed ViewAllUsers). HONEST FLOOR: a statically-declared
// grant is an advisory signal, never a confirmed subscriber grant or leak — and retrieved
// profile metadata may be PARTIAL, so the
// absence of a grant is never least-privilege proof.
const VMADFIX = join(FIX, 'dangerous-permissions')
const ingestVmad = () => {
  const raw = viewModifyAllDataAdapter.collect({ target: VMADFIX })
  return ingest(raw, viewModifyAllDataAdapter, { repoRoot: VMADFIX, pass: 1 })
}
// the fixture line that carries the grant's <name> element — computed from the fixture
// itself so the exact-locus assertions never go stale
const vmadLineOf = (file, needle) => readText(join(VMADFIX, file)).split('\n').findIndex((l) => l.includes(needle)) + 1

check('PV1 view-modify-all-data (source-scanner): the permission set granting ViewAllData + ModifyAllData → 2 findings, metadata/view-modify-all-data/info/admin-surface, each at its <name> grant line, deterministic + schema-valid', () => {
  const { findings } = ingestVmad()
  const ps = findings.filter((x) => /Overreach\.permissionset-meta\.xml/.test(x.file))
  assert.equal(ps.length, 2, 'both org-wide grants flag — one finding per grant')
  for (const [perm, f] of [['ViewAllData', ps.find((x) => x.title.includes('ViewAllData'))], ['ModifyAllData', ps.find((x) => x.title.includes('ModifyAllData'))]]) {
    assert.ok(f, `the ${perm} grant is flagged`)
    assert.equal(f.provenance, 'deterministic')
    assert.equal(f.engine, 'metadata')
    assert.equal(f.ruleId, 'view-modify-all-data')
    assert.equal(f.class, 'view-modify-all-data')
    assert.equal(f.adjusted_severity, 'info')
    assert.equal(f.dimension, 'admin-surface')
    // the locus is the grant's <name> line itself, not the file or the root element
    assert.equal(f.file, `Overreach.permissionset-meta.xml:${vmadLineOf('Overreach.permissionset-meta.xml', `<name>${perm}</name>`)}`)
    assert.match(f.verdict_reasoning, /severity fixed from the view-modify-all-data class \(baseline requirement least-privilege-permission-grants = informational\)/)
    assert.deepEqual(validateFinding(f), [])
  }
})

check('PV2 profile coverage: the .profile-meta.xml ModifyAllData grant flags — the surface metadata-viewall never reads (its collect() walks *.permissionset-meta.xml only), so THIS adapter is the one covering it', () => {
  const { findings } = ingestVmad()
  const f = findings.find((x) => /Overreach_Profile\.profile-meta\.xml/.test(x.file))
  assert.ok(f, 'the profile grant is flagged')
  assert.match(f.title, /Profile grants the org-wide ModifyAllData/)
  assert.equal(f.class, 'view-modify-all-data')
  assert.equal(f.adjusted_severity, 'info')
  assert.equal(f.dimension, 'admin-surface')
  assert.equal(f.file, `Overreach_Profile.profile-meta.xml:${vmadLineOf('Overreach_Profile.profile-meta.xml', '<name>ModifyAllData</name>')}`)
  // metadata-viewall would NOT have flagged it: the profile file is invisible to its
  // collect() (permission sets only), and its parse() reads <objectPermissions> only —
  // this adapter is the one that covers the profile surface (the E0.3c-1 gap).
  const mvRaw = metadataViewAllAdapter.collect({ target: VMADFIX })
  assert.ok(!mvRaw.files.some((x) => /profile-meta\.xml/.test(x.path)), 'metadata-viewall never collects profiles')
})

check('PV3 precision: an enabled=false ViewAllData does NOT flag, a <description> mention does NOT flag, ViewSetup does NOT flag, and the ViewAll*-prefixed ViewAllUsers does NOT flag (exact-name + enabled-required + element-scoped)', () => {
  const { findings } = ingestVmad()
  assert.equal(findings.length, 3, 'exactly the three enabled org-wide grants across the fixture dir — nothing more')
  assert.ok(!findings.some((f) => /LeastPriv/.test(f.file)), 'the least-privilege permission set is clean — enabled=false + prose mention + benign/prefixed names all stay silent')
})

check('PV-classSeverity: view-modify-all-data grounds in the BASELINE least-privilege-permission-grants (informational) → info, dimension admin-surface — the 0.8.68 advisory regrounding, no longer fail-sharing-model/high', () => {
  assert.equal(baselineSeverityFor('least-privilege-permission-grants'), 'informational')
  const cs = classSeverity('view-modify-all-data')
  assert.equal(cs.severity, 'info')
  assert.equal(cs.baselineId, 'least-privilege-permission-grants')
  assert.equal(cs.fromBaseline, true)
  assert.equal(CLASS_DEFS['view-modify-all-data'].dimension, 'admin-surface')
})

check('PV-advisory: the finding is an honest least-privilege ADVISORY — the message carries the managed-package user-permission-exclusion caveat + verify-effective-grant guidance, and the severity is info (OFF the blocker floor, never critical)', () => {
  const { findings } = ingestVmad()
  const f = findings.find((x) => /Overreach\.permissionset-meta\.xml/.test(x.file) && x.title.includes('ViewAllData'))
  assert.ok(f, 'the ViewAllData grant is flagged')
  // the advisory framing leads the message and survives the title truncation
  assert.match(f.title, /advisory \(least privilege\)/)
  // the caveat text is present on the raw hit message (pre-truncation) …
  const raw = viewModifyAllDataAdapter.collect({ target: VMADFIX })
  const hit = viewModifyAllDataAdapter.parse(raw).find((h) => /Overreach\.permissionset/.test(h.file) && h.message.includes('ViewAllData'))
  assert.ok(hit, 'the raw parse hit exists')
  assert.match(hit.message, /user permissions are excluded from managed-package permission sets\/profiles at install/)
  assert.match(hit.message, /may not reach subscribers via the package/)
  assert.match(hit.message, /verify the effective grant/)
  assert.match(hit.message, /business justification/)
  // … and the full advisory + caveat is carried untruncated on the recommendation
  assert.match(f.recommendation, /Least-privilege advisory/)
  assert.match(f.recommendation, /excluded from managed-package permission sets\/profiles at install/)
  assert.match(f.recommendation, /EFFECTIVE grant/)
  assert.match(f.recommendation, /business justification/)
  // OFF the blocker floor: compute-sci blocks only on severity 'critical' —
  // an info advisory is flagged for review, never a submission gate
  assert.equal(f.adjusted_severity, 'info')
  assert.equal(f.severity, 'info')
  assert.notEqual(f.adjusted_severity, 'critical')
})

check('PV-adapter: view-modify-all-data is a registered source-scanner ({name,kind,collect,parse,classify}, NO securityRelevant, NO detect) and ingest is byte-deterministic', () => {
  assert.equal(ADAPTERS['view-modify-all-data'], viewModifyAllDataAdapter)
  assert.equal(viewModifyAllDataAdapter.name, 'view-modify-all-data')
  assert.equal(viewModifyAllDataAdapter.kind, 'source-scanner')
  for (const m of ['collect', 'parse', 'classify']) assert.equal(typeof viewModifyAllDataAdapter[m], 'function')
  // security-by-construction: every emission is a declared org-wide grant → no filter
  assert.equal(viewModifyAllDataAdapter.securityRelevant, undefined)
  // a source-scanner has no evidence file → invisible to the content-shape recognizer
  assert.equal(viewModifyAllDataAdapter.detect, undefined)
  assert.equal(viewModifyAllDataAdapter.classify('anything'), 'view-modify-all-data')
  const a = ingestVmad().findings
  const b = ingestVmad().findings
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})

check('PV-no-overlap: metadata-viewall over the SAME fixture dir emits 0 findings (it reads <objectPermissions> on custom objects, never <userPermissions>) — the two source-scanners are disjoint, no double-report', () => {
  const mv = ingest(metadataViewAllAdapter.collect({ target: VMADFIX }), metadataViewAllAdapter, { repoRoot: VMADFIX, pass: 1 })
  assert.equal(mv.findings.length, 0, 'metadata-viewall emits nothing on the userPermissions fixtures')
  // and the REVERSE: this adapter over metadata-viewall's own fixture dir (objectPermissions
  // over-grants, no <userPermissions>) emits 0 — disjoint in BOTH directions
  const rev = ingest(viewModifyAllDataAdapter.collect({ target: join(FIX, 'permissionsets') }), viewModifyAllDataAdapter, { repoRoot: FIX, pass: 1 })
  assert.equal(rev.findings.length, 0, 'view-modify-all-data emits nothing on the objectPermissions fixture')
})

check('PV-non-supersession: an owned-class view-modify-all-data finding does NOT supersede a co-located llm-inferred admin-surface finding of a DIFFERENT shape at a DIFFERENT locus — locus-specificity is the protection', () => {
  const det = ingestVmad().findings.find((x) => /Overreach\.permissionset-meta\.xml/.test(x.file) && x.title.includes('ViewAllData'))
  assert.equal(det.class, 'view-modify-all-data')
  assert.equal(det.dimension, 'admin-surface')
  // an llm-inferred admin-surface finding of a DIFFERENT shape (the grant-inventory /
  // least-privilege-justification reasoning the dimension charter also owns), SAME file,
  // NON-overlapping lines — class-less, so sameOwnedClass falls back to the dimension
  // match, which DOES hold here:
  const llm = {
    id: '8'.repeat(16),
    dimension: 'admin-surface',
    title: 'Packaged admin-persona permission set lacks a documented least-privilege justification',
    severity: 'medium',
    adjusted_severity: 'medium',
    file: 'Overreach.permissionset-meta.xml:1-8', // the file header block, NOT the grant line
    status: 'confirmed',
    first_seen: 1,
    last_seen: 1,
    verdict: 'confirmed_real',
    verdict_reasoning: 'reasoned over the packaged grant inventory',
  }
  // the dimension fallback WOULD match (det owns a class, llm is class-less, same dimension);
  // the ONLY missing supersession ingredient is the locus — assert that explicitly:
  assert.equal(sameLocation(det, llm), false, 'different line span → not the same locus')
  const { findings, superseded, supersededIds } = reconcileProvenance([det, llm])
  assert.equal(superseded, 0, 'the different-locus LLM finding is NOT superseded — the deterministic row sits beside it')
  assert.deepEqual(supersededIds, [])
  assert.equal(findings.find((f) => f.id === llm.id).status, 'confirmed')
  assert.equal(findings.find((f) => f.id === det.id).status, 'confirmed')
  // NOTE: at the SAME locus (an LLM finding on the same <userPermissions> grant line)
  // supersession WOULD fire and WOULD be correct — the deterministic finding is
  // authoritative for that grant. The guard is that ownership never reaches a
  // different-shape admin-surface finding elsewhere in the file.
  // MUTATION: pointing llm.file at det's exact line turns `superseded === 0` red (the
  // supersession visibly fires), proving the protection is locus-specificity, not an accident.
})

// ────────────────── Remote Site Setting protocol-security opt-out (source-scanner, B5 · E0.3b-2)
// The FIFTH source-scanner (egress-plain-http's clone): reads the package's
// *.remoteSite-meta.xml and flags every RemoteSiteSetting that sets
// <disableProtocolSecurity>true</disableProtocolSecurity> — the flag that permits code to
// pass data between an HTTPS session and an HTTP session (a transport downgrade), the
// codified Secure Communication violation, class protocol-security-disabled →
// endpoint-https-only (major → high), dimension package-metadata. INDEPENDENT of
// egress-plain-http (that adapter reads endpoint-URL schemes; this one reads ONLY the
// protocol-security element — DP-no-overlap locks the disjointness in both directions).
// The fixtures are AUTHORED schema-faithful metadata XML (the egress-metadata/ convention):
// 1 positive (Downgrade_RSS: disableProtocolSecurity=true on an https:// url — so
// egress-plain-http never flags it) + 2 negatives (Secure_RSS: an explicit false element,
// the platform default; NoFlag_RSS: no element at all + a <description> mentioning the
// flag in prose — the absent + element-scoped guards). HONEST FLOOR: a statically-declared
// protocol-security opt-out is a transport-security misconfiguration, LOW FP (the flag
// defaults to false and Salesforce explicitly warns against it); the rare
// internal/on-premises HTTP case is dispositionable via the FP dossier, never suppressed.
const DPFIX = join(FIX, 'remote-site-protocol')
const ingestRsp = () => {
  const raw = remoteSiteProtocolSecurityAdapter.collect({ target: DPFIX })
  return ingest(raw, remoteSiteProtocolSecurityAdapter, { repoRoot: DPFIX, pass: 1 })
}
// the fixture line that carries the offending element — computed from the fixture itself so
// the exact-locus assertions never go stale
const dpLineOf = (file, needle) => readText(join(DPFIX, file)).split('\n').findIndex((l) => l.includes(needle)) + 1

check('DP1 remote-site-protocol-security (source-scanner): a disableProtocolSecurity=true RemoteSiteSetting → metadata/protocol-security-disabled/high/package-metadata at the <disableProtocolSecurity> line, deterministic + schema-valid', () => {
  const { findings } = ingestRsp()
  const f = findings.find((x) => /Downgrade_RSS\.remoteSite-meta\.xml/.test(x.file))
  assert.ok(f, 'the protocol-security opt-out Remote Site Setting is flagged')
  assert.equal(f.provenance, 'deterministic')
  assert.equal(f.engine, 'metadata')
  assert.equal(f.ruleId, 'protocol-security-disabled')
  assert.equal(f.class, 'protocol-security-disabled')
  assert.equal(f.adjusted_severity, 'high')
  assert.equal(f.dimension, 'package-metadata')
  // the locus is the <disableProtocolSecurity> element's own line, not the file or the root element
  assert.equal(f.file, `Downgrade_RSS.remoteSite-meta.xml:${dpLineOf('Downgrade_RSS.remoteSite-meta.xml', '<disableProtocolSecurity>true')}`)
  assert.match(f.title, /<disableProtocolSecurity>true<\/disableProtocolSecurity>/)
  // the downgrade framing survives the title's oneLine truncation only up to the HTTPS
  // token — the full sentence is asserted on the untruncated reasoning below
  assert.match(f.title, /permits data transfer between an HTTPS session/)
  assert.match(f.verdict_reasoning, /an HTTPS session and an HTTP session \(a transport downgrade\)/)
  assert.match(f.verdict_reasoning, /severity fixed from the protocol-security-disabled class \(baseline requirement endpoint-https-only = major\)/)
  assert.deepEqual(validateFinding(f), [])
})

check('DP2 precision: an explicit disableProtocolSecurity=false element is NOT flagged (true-required); a file with NO element whose <description> mentions the flag in prose is NOT flagged (absent + element-scoped) — exactly ONE finding in the fixture dir', () => {
  const { findings } = ingestRsp()
  assert.equal(findings.length, 1, 'exactly the one declared protocol-security opt-out in the fixture dir — nothing more')
  assert.ok(!findings.some((f) => /Secure_RSS/.test(f.file)), 'the explicit-false file is clean — false is the platform default posture')
  assert.ok(!findings.some((f) => /NoFlag_RSS/.test(f.file)), 'the no-element file is clean — including its <description> mentioning disableProtocolSecurity in prose')
})

check('DP-classSeverity: protocol-security-disabled grounds in the BASELINE endpoint-https-only (major) → high, dimension package-metadata — the SAME requirement plain-http-egress grounds in (one Secure-Communication baseline, two metadata shapes)', () => {
  assert.equal(baselineSeverityFor('endpoint-https-only'), 'major')
  const cs = classSeverity('protocol-security-disabled')
  assert.equal(cs.severity, 'high')
  assert.equal(cs.baselineId, 'endpoint-https-only')
  assert.equal(cs.fromBaseline, true)
  assert.equal(CLASS_DEFS['protocol-security-disabled'].dimension, 'package-metadata')
  // the shared grounding is deliberate: both classes are Secure-Communication violations —
  // but they stay DISTINCT classes (different flag, different locus shape, no cross-supersession)
  assert.equal(CLASS_DEFS['plain-http-egress'].baselineId, CLASS_DEFS['protocol-security-disabled'].baselineId)
})

check('DP-adapter: remote-site-protocol-security is a registered source-scanner ({name,kind,collect,parse,classify}, NO securityRelevant, NO detect) and ingest is byte-deterministic', () => {
  assert.equal(ADAPTERS['remote-site-protocol-security'], remoteSiteProtocolSecurityAdapter)
  assert.equal(remoteSiteProtocolSecurityAdapter.name, 'remote-site-protocol-security')
  assert.equal(remoteSiteProtocolSecurityAdapter.kind, 'source-scanner')
  for (const m of ['collect', 'parse', 'classify']) assert.equal(typeof remoteSiteProtocolSecurityAdapter[m], 'function')
  // security-by-construction: every emission is a declared protocol-security opt-out → no filter
  assert.equal(remoteSiteProtocolSecurityAdapter.securityRelevant, undefined)
  // a source-scanner has no evidence file → invisible to the content-shape recognizer
  assert.equal(remoteSiteProtocolSecurityAdapter.detect, undefined)
  assert.equal(remoteSiteProtocolSecurityAdapter.classify('anything'), 'protocol-security-disabled')
  const a = ingestRsp().findings
  const b = ingestRsp().findings
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})

check('DP-no-overlap: egress-plain-http over the SAME fixture dir emits 0 findings (the downgrade RSS declares an https:// url — the scheme scan never fires) and remote-site-protocol-security over egress-metadata/ emits 0 (every RSS there carries disableProtocolSecurity=false) — the two egress adapters are disjoint, no double-report', () => {
  const eg = ingest(egressPlainHttpAdapter.collect({ target: DPFIX }), egressPlainHttpAdapter, { repoRoot: DPFIX, pass: 1 })
  assert.equal(eg.findings.length, 0, 'egress-plain-http never flags the protocol-security fixture dir')
  const rsp = ingest(remoteSiteProtocolSecurityAdapter.collect({ target: EGFIX }), remoteSiteProtocolSecurityAdapter, { repoRoot: EGFIX, pass: 1 })
  assert.equal(rsp.findings.length, 0, 'remote-site-protocol-security never flags the egress-metadata fixture dir (both RSS files there are explicit-false)')
})

check('DP-non-supersession: an owned-class protocol-security-disabled finding does NOT supersede a co-located llm-inferred package-metadata finding of a DIFFERENT shape at a DIFFERENT locus — locus-specificity is the protection', () => {
  const det = ingestRsp().findings.find((x) => /Downgrade_RSS/.test(x.file)) // …remoteSite-meta.xml:<disableProtocolSecurity> line
  assert.equal(det.class, 'protocol-security-disabled')
  assert.equal(det.dimension, 'package-metadata')
  // an llm-inferred package-metadata finding of a DIFFERENT shape (the trusted-host-inventory
  // staleness reasoning the dimension charter also owns), SAME file, NON-overlapping lines —
  // class-less, so sameOwnedClass falls back to the dimension match, which DOES hold here:
  const llm = {
    id: '9'.repeat(16),
    dimension: 'package-metadata',
    title: 'Trusted-host inventory entry looks stale — host ownership should be re-verified',
    severity: 'medium',
    adjusted_severity: 'medium',
    file: 'Downgrade_RSS.remoteSite-meta.xml:1-11', // the file header block, NOT the flag line
    status: 'confirmed',
    first_seen: 1,
    last_seen: 1,
    verdict: 'confirmed_real',
    verdict_reasoning: 'reasoned over the trusted-host inventory',
  }
  // the dimension fallback WOULD match (det owns a class, llm is class-less, same dimension);
  // the ONLY missing supersession ingredient is the locus — assert that explicitly:
  assert.equal(sameLocation(det, llm), false, 'different line span → not the same locus')
  const { findings, superseded, supersededIds } = reconcileProvenance([det, llm])
  assert.equal(superseded, 0, 'the different-locus LLM finding is NOT superseded — the deterministic row sits beside it')
  assert.deepEqual(supersededIds, [])
  assert.equal(findings.find((f) => f.id === llm.id).status, 'confirmed')
  assert.equal(findings.find((f) => f.id === det.id).status, 'confirmed')
  // NOTE: at the SAME locus (an LLM finding on the same <disableProtocolSecurity> line)
  // supersession WOULD fire and WOULD be correct — the deterministic finding is
  // authoritative for that flag. The guard is that ownership never reaches a
  // different-shape package-metadata finding elsewhere in the file.
  // MUTATION: pointing llm.file at det's exact line turns `superseded === 0` red (the
  // supersession visibly fires), proving the protection is locus-specificity, not an accident.
})

// ────────────────── admin/privilege permission-grant advisory (source-scanner, B5 · E0.3c-2)
// The SIXTH source-scanner (view-modify-all-data's clone): scans permission sets AND
// profiles for the high-risk ADMIN/PRIVILEGE system permissions — ManageUsers / AuthorApex /
// CustomizeApplication / ModifyMetadata — granted via <userPermissions> with enabled=true,
// class admin-privilege-grant → least-privilege-permission-grants (informational → info,
// OFF the blocker floor), dimension admin-surface. The SIBLING of view-modify-all-data:
// that class covers the org-wide DATA-access pair {ViewAllData, ModifyAllData}; this one
// covers the admin/privilege quartet — the two permission Sets are DISJOINT (AP-no-overlap
// locks it in both directions, on a shared fixture dir). Every name in the Set is a
// CONFIRMED Profile/PermissionSet <userPermissions> API name. HONEST FLOOR: a
// statically-declared grant is an advisory signal, never a confirmed subscriber grant
// (user permissions are excluded from managed-package permsets/profiles at install), and
// retrieved profile metadata may be PARTIAL — absence is not least-privilege proof.
const APGFIX = join(FIX, 'admin-privilege')
const ingestApg = () => {
  const raw = adminPrivilegeGrantAdapter.collect({ target: APGFIX })
  return ingest(raw, adminPrivilegeGrantAdapter, { repoRoot: APGFIX, pass: 1 })
}
// the fixture line that carries the grant's <name> element — computed from the fixture
// itself so the exact-locus assertions never go stale
const apgLineOf = (file, needle) => readText(join(APGFIX, file)).split('\n').findIndex((l) => l.includes(needle)) + 1

check('AP1 admin-privilege-grant (source-scanner): the permission set granting ManageUsers + AuthorApex → 2 findings, metadata/admin-privilege-grant/info/admin-surface, each at its <name> grant line, deterministic + schema-valid', () => {
  const { findings } = ingestApg()
  const ps = findings.filter((x) => /AdminOverreach\.permissionset-meta\.xml/.test(x.file))
  assert.equal(ps.length, 2, 'both admin/privilege grants flag — one finding per grant')
  for (const [perm, f] of [['ManageUsers', ps.find((x) => x.title.includes('ManageUsers'))], ['AuthorApex', ps.find((x) => x.title.includes('AuthorApex'))]]) {
    assert.ok(f, `the ${perm} grant is flagged`)
    assert.equal(f.provenance, 'deterministic')
    assert.equal(f.engine, 'metadata')
    assert.equal(f.ruleId, 'admin-privilege-grant')
    assert.equal(f.class, 'admin-privilege-grant')
    assert.equal(f.adjusted_severity, 'info')
    assert.equal(f.dimension, 'admin-surface')
    // the locus is the grant's <name> line itself, not the file or the root element
    assert.equal(f.file, `AdminOverreach.permissionset-meta.xml:${apgLineOf('AdminOverreach.permissionset-meta.xml', `<name>${perm}</name>`)}`)
    assert.match(f.verdict_reasoning, /severity fixed from the admin-privilege-grant class \(baseline requirement least-privilege-permission-grants = informational\)/)
    assert.deepEqual(validateFinding(f), [])
  }
})

check('AP2 profile coverage + precision: the .profile CustomizeApplication + ModifyMetadata grants flag (the remaining two Set names); in LeastPriv the enabled=false ManageUsers, the <description> mention, ViewSetup, and the adjacent-name ManageInternalUsers do NOT flag', () => {
  const { findings } = ingestApg()
  const prof = findings.filter((x) => /AdminOverreach_Profile\.profile-meta\.xml/.test(x.file))
  assert.equal(prof.length, 2, 'both profile admin/privilege grants flag')
  for (const perm of ['CustomizeApplication', 'ModifyMetadata']) {
    const f = prof.find((x) => x.title.includes(perm))
    assert.ok(f, `the profile ${perm} grant is flagged`)
    assert.match(f.title, new RegExp(`Profile grants the high-risk ${perm}`))
    assert.equal(f.class, 'admin-privilege-grant')
    assert.equal(f.adjusted_severity, 'info')
    assert.equal(f.dimension, 'admin-surface')
    assert.equal(f.file, `AdminOverreach_Profile.profile-meta.xml:${apgLineOf('AdminOverreach_Profile.profile-meta.xml', `<name>${perm}</name>`)}`)
  }
  // precision: exactly the four enabled admin/privilege grants across the fixture dir —
  // LeastPriv stays silent (enabled=false ManageUsers · a prose <description> mention ·
  // benign ViewSetup · the adjacent delegated-administration name ManageInternalUsers,
  // which a sloppy non-exact matcher could confuse · a ViewAllData grant that belongs to
  // the SIBLING view-modify-all-data class, not this one)
  assert.equal(findings.length, 4, 'exactly the four enabled admin/privilege grants across the fixture dir — nothing more')
  assert.ok(!findings.some((f) => /LeastPriv/.test(f.file)), 'the least-privilege permission set is clean for this adapter')
  assert.ok(!findings.some((f) => f.title.includes('ManageInternalUsers')), 'exact-name: the adjacent ManageInternalUsers never matches')
  assert.ok(!findings.some((f) => f.title.includes('ViewAllData')), 'the DATA-access grant belongs to view-modify-all-data, never this class')
})

check('AP-classSeverity: admin-privilege-grant grounds in the SAME baseline as view-modify-all-data — least-privilege-permission-grants (informational) → info, dimension admin-surface (one requirement, two disjoint permission Sets, two sibling classes)', () => {
  assert.equal(baselineSeverityFor('least-privilege-permission-grants'), 'informational')
  const cs = classSeverity('admin-privilege-grant')
  assert.equal(cs.severity, 'info')
  assert.equal(cs.baselineId, 'least-privilege-permission-grants')
  assert.equal(cs.fromBaseline, true)
  assert.equal(CLASS_DEFS['admin-privilege-grant'].dimension, 'admin-surface')
  // the sibling grounds identically — same baseline, same dimension, same info severity
  assert.equal(CLASS_DEFS['view-modify-all-data'].baselineId, CLASS_DEFS['admin-privilege-grant'].baselineId)
  assert.equal(CLASS_DEFS['view-modify-all-data'].dimension, CLASS_DEFS['admin-privilege-grant'].dimension)
})

check('AP-advisory: the finding is an honest least-privilege ADVISORY — the message carries the managed-package user-permission-exclusion caveat + verify-effective-grant guidance, and the severity is info (OFF the blocker floor, never critical)', () => {
  const { findings } = ingestApg()
  const f = findings.find((x) => /AdminOverreach\.permissionset-meta\.xml/.test(x.file) && x.title.includes('ManageUsers'))
  assert.ok(f, 'the ManageUsers grant is flagged')
  // the advisory framing leads the message and survives the title truncation
  assert.match(f.title, /advisory \(least privilege\)/)
  // the caveat text is present on the raw hit message (pre-truncation) …
  const raw = adminPrivilegeGrantAdapter.collect({ target: APGFIX })
  const hit = adminPrivilegeGrantAdapter.parse(raw).find((h) => /AdminOverreach\.permissionset/.test(h.file) && h.message.includes('ManageUsers'))
  assert.ok(hit, 'the raw parse hit exists')
  assert.match(hit.message, /user permissions are excluded from managed-package permission sets\/profiles at install/)
  assert.match(hit.message, /may not reach subscribers via the package/)
  assert.match(hit.message, /verify the effective grant/)
  assert.match(hit.message, /business justification/)
  // … and the full advisory + caveat is carried untruncated on the recommendation
  assert.match(f.recommendation, /Least-privilege advisory/)
  assert.match(f.recommendation, /excluded from managed-package permission sets\/profiles at install/)
  assert.match(f.recommendation, /EFFECTIVE grant/)
  assert.match(f.recommendation, /business justification/)
  // OFF the blocker floor: compute-sci blocks only on severity 'critical' —
  // an info advisory is flagged for review, never a submission gate
  assert.equal(f.adjusted_severity, 'info')
  assert.equal(f.severity, 'info')
  assert.notEqual(f.adjusted_severity, 'critical')
})

check('AP-adapter: admin-privilege-grant is a registered source-scanner ({name,kind,collect,parse,classify}, NO securityRelevant, NO detect) and ingest is byte-deterministic', () => {
  assert.equal(ADAPTERS['admin-privilege-grant'], adminPrivilegeGrantAdapter)
  assert.equal(adminPrivilegeGrantAdapter.name, 'admin-privilege-grant')
  assert.equal(adminPrivilegeGrantAdapter.kind, 'source-scanner')
  for (const m of ['collect', 'parse', 'classify']) assert.equal(typeof adminPrivilegeGrantAdapter[m], 'function')
  // security-by-construction: every emission is a declared admin/privilege grant → no filter
  assert.equal(adminPrivilegeGrantAdapter.securityRelevant, undefined)
  // a source-scanner has no evidence file → invisible to the content-shape recognizer
  assert.equal(adminPrivilegeGrantAdapter.detect, undefined)
  assert.equal(adminPrivilegeGrantAdapter.classify('anything'), 'admin-privilege-grant')
  const a = ingestApg().findings
  const b = ingestApg().findings
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})

check('AP-no-overlap: over the SAME admin-privilege fixture dir, view-modify-all-data emits ONLY its own class on the ViewAllData row (never the admin perms); and admin-privilege-grant emits 0 over the dangerous-permissions fixtures — the two permission Sets are disjoint, no double-report', () => {
  // view-modify-all-data over THIS adapter's fixtures: exactly the one ViewAllData grant
  // in LeastPriv (its own class), none of the four admin/privilege grants
  const vm = ingest(viewModifyAllDataAdapter.collect({ target: APGFIX }), viewModifyAllDataAdapter, { repoRoot: APGFIX, pass: 1 })
  assert.equal(vm.findings.length, 1, 'view-modify-all-data sees only the ViewAllData row')
  assert.equal(vm.findings[0].class, 'view-modify-all-data')
  assert.ok(/LeastPriv\.permissionset-meta\.xml/.test(vm.findings[0].file))
  assert.ok(vm.findings[0].title.includes('ViewAllData'))
  assert.ok(!vm.findings.some((f) => /ManageUsers|AuthorApex|CustomizeApplication|ModifyMetadata/.test(f.title)), 'the admin perms never match the DATA-access Set')
  // and the REVERSE: this adapter over view-modify-all-data's own fixture dir
  // (ViewAllData/ModifyAllData + its negatives — no admin/privilege perm) emits 0
  const rev = ingest(adminPrivilegeGrantAdapter.collect({ target: join(FIX, 'dangerous-permissions') }), adminPrivilegeGrantAdapter, { repoRoot: FIX, pass: 1 })
  assert.equal(rev.findings.length, 0, 'admin-privilege-grant emits nothing on the DATA-access fixtures')
})

check('AP-non-supersession: an owned-class admin-privilege-grant finding does NOT supersede a co-located llm-inferred admin-surface finding of a DIFFERENT shape at a DIFFERENT locus — locus-specificity is the protection', () => {
  const det = ingestApg().findings.find((x) => /AdminOverreach\.permissionset-meta\.xml/.test(x.file) && x.title.includes('ManageUsers'))
  assert.equal(det.class, 'admin-privilege-grant')
  assert.equal(det.dimension, 'admin-surface')
  // an llm-inferred admin-surface finding of a DIFFERENT shape (the grant-inventory /
  // least-privilege-justification reasoning the dimension charter also owns), SAME file,
  // NON-overlapping lines — class-less, so sameOwnedClass falls back to the dimension
  // match, which DOES hold here:
  const llm = {
    id: 'a'.repeat(16),
    dimension: 'admin-surface',
    title: 'Packaged admin-persona permission set lacks a documented least-privilege justification',
    severity: 'medium',
    adjusted_severity: 'medium',
    file: 'AdminOverreach.permissionset-meta.xml:1-9', // the file header block, NOT the grant line
    status: 'confirmed',
    first_seen: 1,
    last_seen: 1,
    verdict: 'confirmed_real',
    verdict_reasoning: 'reasoned over the packaged grant inventory',
  }
  // the dimension fallback WOULD match (det owns a class, llm is class-less, same dimension);
  // the ONLY missing supersession ingredient is the locus — assert that explicitly:
  assert.equal(sameLocation(det, llm), false, 'different line span → not the same locus')
  const { findings, superseded, supersededIds } = reconcileProvenance([det, llm])
  assert.equal(superseded, 0, 'the different-locus LLM finding is NOT superseded — the deterministic row sits beside it')
  assert.deepEqual(supersededIds, [])
  assert.equal(findings.find((f) => f.id === llm.id).status, 'confirmed')
  assert.equal(findings.find((f) => f.id === det.id).status, 'confirmed')
  // NOTE: at the SAME locus (an LLM finding on the same <userPermissions> grant line)
  // supersession WOULD fire and WOULD be correct — the deterministic finding is
  // authoritative for that grant. The guard is that ownership never reaches a
  // different-shape admin-surface finding elsewhere in the file.
  // MUTATION: pointing llm.file at det's exact line turns `superseded === 0` red (the
  // supersession visibly fires), proving the protection is locus-specificity, not an accident.
})

// ──────────────────────────────────────────────── Security/AppExchange tag filter
check('U1 tag filter: a non-security rule (ApexDoc, tags Documentation/BestPractices) → 0 findings; the Performance-tagged MissingNullCheckOnSoqlVariable is filtered out of the real fixture', () => {
  // inline a synthetic non-security best-practices violation (NOT in the real captured
  // fixture, which stays genuine) — it must NOT become a security finding.
  const apexDoc = {
    violations: [
      {
        rule: 'ApexDoc',
        engine: 'pmd',
        severity: 3,
        tags: ['Documentation', 'BestPractices'],
        primaryLocationIndex: 0,
        locations: [{ file: 'force-app/main/default/classes/Anything.cls', startLine: 3 }],
        message: 'Document this method.',
      },
    ],
  }
  const { findings, notes } = ingest(apexDoc, codeAnalyzerAdapter, { repoRoot: '', pass: 1 })
  assert.equal(findings.length, 0, 'a non-security best-practices rule must NOT be ingested as a finding')
  assert.ok(notes.some((n) => /not Security\/AppExchange-tagged/.test(n)), 'expected a non-security-filtered note')
  // and the REAL Performance-tagged rule is filtered too (same rule, no special-casing)
  const real = ingestSolano().findings
  assert.ok(
    !real.some((f) => f.ruleId === 'MissingNullCheckOnSoqlVariable'),
    'Performance-tagged MissingNullCheckOnSoqlVariable leaked through the Security/AppExchange tag filter'
  )
})

check('U2 an unmapped SECURITY rule (AvoidHardcodedCredentialsInVarDecls, security-tagged, not in RULE_CLASS) is STILL ingested with the CA-severity fallback — never dropped', () => {
  const { findings, notes } = ingestSolano()
  const hc = findById(findings, (f) => f.ruleId === 'AvoidHardcodedCredentialsInVarDecls')
  assert.ok(hc, 'unmapped security rule was dropped — the tag filter must keep an unmapped SECURITY rule')
  assert.equal(hc.provenance, 'deterministic')
  assert.equal(hc.engine, 'pmd')
  assert.equal(hc.adjusted_severity, 'medium') // CA sev 3 → medium (unmapped fallback)
  assert.equal(hc.class, undefined) // unmapped → owns no class
  assert.match(hc.verdict_reasoning, /no toolkit class maps rule/)
  assert.ok(notes.some((n) => /unmapped/.test(n)))
})

check('TF1 hasSecurityTag: Security/AppExchange (any case) pass; Performance/Documentation/BestPractices do not', () => {
  assert.equal(hasSecurityTag(['Recommended', 'Security', 'Apex']), true)
  assert.equal(hasSecurityTag(['AppExchange', 'Security']), true)
  assert.equal(hasSecurityTag(['appexchange']), true) // case-insensitive
  assert.equal(hasSecurityTag(['DevPreview', 'Performance', 'Apex']), false)
  assert.equal(hasSecurityTag(['Documentation', 'BestPractices']), false)
  assert.equal(hasSecurityTag([]), false)
  assert.equal(hasSecurityTag(undefined), false)
})

check('TF2 code-analyzer adapter filters via securityRelevant; metadata-viewall keeps all (security by construction)', () => {
  assert.equal(typeof codeAnalyzerAdapter.securityRelevant, 'function')
  assert.equal(codeAnalyzerAdapter.securityRelevant({ tags: ['Security'] }), true)
  assert.equal(codeAnalyzerAdapter.securityRelevant({ tags: ['Performance'] }), false)
  // metadata-viewall has NO filter — every emission is a security over-grant → all pass
  assert.equal(metadataViewAllAdapter.securityRelevant, undefined)
})

// ───────────────────────────────────────────────────────────── ledger merge
check('M1 merge is idempotent: ingest twice into a ledger → no duplicate findings', () => {
  const ledger = { schema_version: '1', findings: [], passes: [] }
  const { findings } = ingestSolano()
  const r1 = mergeFindings(ledger, findings, 1)
  assert.equal(r1.added, 4)
  assert.equal(ledger.findings.length, 4)
  const r2 = mergeFindings(ledger, findings, 1)
  assert.equal(r2.added, 0)
  assert.equal(ledger.findings.length, 4) // still 4 — no dupes
})

check('M2 merge is additive: a pre-existing llm-inferred finding survives', () => {
  const llm = {
    id: 'a'.repeat(16),
    dimension: 'oauth-identity',
    title: 'JWT verify without algorithm allowlist',
    severity: 'high',
    adjusted_severity: 'high',
    file: 'server/index.js:13',
    status: 'confirmed',
    first_seen: 1,
    last_seen: 1,
    verdict: 'confirmed_real',
    verdict_reasoning: 'reasoned over the code',
  }
  const ledger = { schema_version: '1', findings: [llm], passes: [] }
  mergeFindings(ledger, ingestSolano().findings, 1)
  assert.equal(ledger.findings.length, 5) // 1 pre-existing llm + 4 deterministic
  assert.ok(ledger.findings.some((f) => f.id === 'a'.repeat(16) && !('provenance' in f)))
})

check('M3 idempotent refresh preserves first_seen, advances last_seen', () => {
  const ledger = { schema_version: '1', findings: [], passes: [] }
  mergeFindings(ledger, ingest(readJSON(SOLANO), codeAnalyzerAdapter, { repoRoot: '', pass: 1 }).findings, 1)
  const before = ledger.findings.find((f) => f.file.endsWith('SolanoAccountInsightController.cls:19'))
  assert.equal(before.first_seen, 1)
  mergeFindings(ledger, ingest(readJSON(SOLANO), codeAnalyzerAdapter, { repoRoot: '', pass: 2 }).findings, 2)
  const after = ledger.findings.find((f) => f.file.endsWith('SolanoAccountInsightController.cls:19'))
  assert.equal(after.first_seen, 1) // preserved
  assert.equal(after.last_seen, 2) // advanced
})

check('M4 loadLedger refuses a corrupted (non-array findings) ledger rather than overwrite', () => {
  const d = mkdtempSync(join(tmpdir(), 'ingest-merge-'))
  dirs.push(d)
  mkdirSync(join(d, '.security-review'), { recursive: true })
  const lp = join(d, '.security-review', 'audit-ledger.json')
  writeFileSync(lp, JSON.stringify({ schema_version: '1', findings: { not: 'an array' }, passes: [] }))
  assert.throws(() => loadLedger(lp), /not an array/)
})

// ──────────────────────────────────────────────────────────────── fail-safe
check('F1 ingest(null) → no findings, honest note, no crash', () => {
  const { findings, notes } = ingest(null, codeAnalyzerAdapter, { repoRoot: '', pass: 1 })
  assert.equal(findings.length, 0)
  assert.ok(notes.some((n) => /no input collected/.test(n)))
})

check('F2 code-analyzer collect() on a missing file → null (→ no findings)', () => {
  const raw = codeAnalyzerAdapter.collect({ input: join(tmpdir(), 'definitely-not-here-xyz.json') })
  assert.equal(raw, null)
  assert.equal(ingest(raw, codeAnalyzerAdapter, {}).findings.length, 0)
})

check('F3 non-JSON input → collect() null; an empty object {} → 0 findings + note', () => {
  const d = mkdtempSync(join(tmpdir(), 'ingest-bad-'))
  dirs.push(d)
  const bad = join(d, 'bad.json')
  writeFileSync(bad, 'this is not json {{{')
  assert.equal(codeAnalyzerAdapter.collect({ input: bad }), null)
  const { findings, notes } = ingest({}, codeAnalyzerAdapter, { repoRoot: '', pass: 1 })
  assert.equal(findings.length, 0)
  assert.ok(notes.some((n) => /0 violations/.test(n)))
})

check('F4 empty violations array → 0 findings, no crash', () => {
  const { findings } = ingest({ violations: [] }, codeAnalyzerAdapter, { repoRoot: '', pass: 1 })
  assert.equal(findings.length, 0)
})

// ─────────────────────────────────────────────────────── schema conformance
check('SC1 a deterministic finding validates against $defs/finding', () => {
  const f = ingestSolano().findings[0]
  assert.deepEqual(validateFinding(f), [])
})

check('SC2 an existing llm-inferred finding (no provenance) still validates (provenance defaults)', () => {
  const llm = {
    id: 'b'.repeat(16),
    dimension: 'tenant-isolation',
    title: 'cross-tenant read',
    severity: 'high',
    adjusted_severity: 'high',
    file: 'app/x.py:9',
    status: 'confirmed',
    first_seen: 1,
    last_seen: 1,
    verdict: 'confirmed_real',
    verdict_reasoning: 'reasoned',
  }
  assert.deepEqual(validateFinding(llm), [])
})

check('SC3 a deterministic finding MISSING engine FAILS validation (the conditional bites)', () => {
  const f = ingestSolano().findings[0]
  const broken = clone(f)
  delete broken.engine
  const errs = validateFinding(broken)
  assert.ok(errs.some((e) => /missing 'engine'/.test(e)), `expected conditional failure, got ${JSON.stringify(errs)}`)
})

check('SC4 schema declares provenance (default llm-inferred) + engine + ruleId, additively', () => {
  const props = FINDING_DEF.properties
  assert.equal(props.provenance.default, 'llm-inferred')
  assert.deepEqual(props.provenance.enum, ['deterministic', 'llm-inferred'])
  assert.ok(props.engine && props.ruleId)
  // additive: none of the three is newly required at the top level
  for (const k of ['provenance', 'engine', 'ruleId']) assert.ok(!FINDING_DEF.required.includes(k))
})

// ─────────────────────────────────────────────────── pluggable adapter seam
check('AD1 registry has 18 adapters (admin-privilege-grant added), both KINDS, each {name,kind,collect,parse,classify}', () => {
  assert.deepEqual(Object.keys(ADAPTERS).sort(), ['admin-privilege-grant', 'bandit', 'checkov', 'code-analyzer', 'detect-secrets', 'egress-plain-http', 'gitleaks', 'metadata-viewall', 'njsscan', 'npm-audit', 'opengrep', 'osv', 'regexploit', 'remote-site-protocol-security', 'sarif', 'semgrep', 'trivy', 'view-modify-all-data'])
  assert.equal(ADAPTERS['code-analyzer'].kind, 'file-parser')
  assert.equal(ADAPTERS['metadata-viewall'].kind, 'source-scanner')
  assert.equal(ADAPTERS['egress-plain-http'].kind, 'source-scanner')
  assert.equal(ADAPTERS['view-modify-all-data'].kind, 'source-scanner')
  assert.equal(ADAPTERS['remote-site-protocol-security'].kind, 'source-scanner')
  assert.equal(ADAPTERS['admin-privilege-grant'].kind, 'source-scanner')
  assert.equal(ADAPTERS['checkov'].kind, 'file-parser')
  assert.equal(ADAPTERS['semgrep'].kind, 'file-parser')
  assert.equal(ADAPTERS['bandit'].kind, 'file-parser')
  assert.equal(ADAPTERS['njsscan'].kind, 'file-parser')
  assert.equal(ADAPTERS['gitleaks'].kind, 'file-parser')
  assert.equal(ADAPTERS['detect-secrets'].kind, 'file-parser')
  assert.equal(ADAPTERS['osv'].kind, 'file-parser')
  assert.equal(ADAPTERS['npm-audit'].kind, 'file-parser')
  assert.equal(ADAPTERS['trivy'].kind, 'file-parser')
  assert.equal(ADAPTERS['regexploit'].kind, 'file-parser')
  for (const a of Object.values(ADAPTERS)) {
    for (const m of ['collect', 'parse', 'classify']) assert.equal(typeof a[m], 'function', `${a.name}.${m}`)
    assert.equal(typeof a.name, 'string')
  }
})

check('AD2 code-analyzer.classify maps the wobbled classes and returns null for the rest', () => {
  assert.equal(codeAnalyzerAdapter.classify('ApexCRUDViolation'), 'crud-fls')
  assert.equal(codeAnalyzerAdapter.classify('ApexFlsViolation'), 'crud-fls')
  assert.equal(codeAnalyzerAdapter.classify('DatabaseOperationsMustUseWithSharing'), 'sharing')
  assert.equal(codeAnalyzerAdapter.classify('SomeRuleWeDoNotMapYet'), null)
  assert.equal(RULE_CLASS.ApexSharingViolations, 'sharing') // PMD sharing rule aliased too
})

check('AD3 buildFinding is pure over its inputs (no Date/random): two builds byte-identical', () => {
  const args = {
    engine: 'pmd',
    ruleId: 'ApexCRUDViolation',
    severityNum: 2,
    file: 'force-app/x.cls',
    startLine: 10,
    message: 'Validate CRUD',
    resources: ['http://x'],
    classKey: 'crud-fls',
    repoRoot: '',
    pass: 1,
  }
  assert.equal(JSON.stringify(buildFinding(args)), JSON.stringify(buildFinding(args)))
})

// ────────────────────────────── SS: the single-shape (class-owning) registry
// Enumerate the ACTUAL owned set by exercising EVERY adapter's classify() over the full
// RULE_CLASS map (the only keyed classifier), the RULE_DIMENSION keys (routing rules —
// they own no class), and arbitrary/unknown ruleIds (constant classifiers return their
// constant for any probe; keyed ones return null). The probe list reads RULE_CLASS /
// RULE_DIMENSION dynamically, so a future row added to either map is probed automatically.
const CLASSIFY_PROBES = [
  ...Object.keys(RULE_CLASS),
  ...Object.keys(RULE_DIMENSION),
  'CKV_DOCKER_2',
  'generic-api-key',
  'B608',
  'a-rule-no-adapter-maps',
  undefined,
]
const ownedClasses = () => {
  const owned = new Set()
  for (const a of Object.values(ADAPTERS)) {
    for (const probe of CLASSIFY_PROBES) {
      const c = a.classify(probe)
      if (c != null) owned.add(c)
    }
  }
  return owned
}

check('SS-owned-⊆-registry: every non-null classify() result across ALL adapters is registered in SINGLE_SHAPE — a new class-owning adapter MUST declare its class single-shape', () => {
  for (const a of Object.values(ADAPTERS)) {
    for (const probe of CLASSIFY_PROBES) {
      const c = a.classify(probe)
      if (c != null)
        assert.ok(
          SINGLE_SHAPE.has(c),
          `${a.name}.classify(${JSON.stringify(probe)}) owns '${c}' but SINGLE_SHAPE does not register it — declare the shape or return null`
        )
    }
  }
})

check('SS-registry-⊆-CLASS_DEFS: every SINGLE_SHAPE entry is a real CLASS_DEFS key (no phantom/stale registry rows)', () => {
  for (const c of SINGLE_SHAPE) assert.ok(c in CLASS_DEFS, `SINGLE_SHAPE registers '${c}' but CLASS_DEFS has no such class`)
})

check('SS-registry-==-owned: SINGLE_SHAPE equals the ACTUAL currently-owned set — no owned-but-unregistered class, no registered-but-not-owned stale declaration', () => {
  assert.deepEqual([...SINGLE_SHAPE].sort(), [...ownedClasses()].sort())
})

check('SS-null-adapters: the CWE-routing / dependency / ReDoS adapters own NO class — classify() → null on every probe (the multi-shape posture cannot quietly claim a routing dimension)', () => {
  for (const name of ['semgrep', 'opengrep', 'bandit', 'njsscan', 'sarif', 'osv', 'npm-audit', 'regexploit']) {
    for (const probe of CLASSIFY_PROBES) {
      assert.equal(ADAPTERS[name].classify(probe), null, `${name}.classify(${JSON.stringify(probe)}) must stay null`)
    }
  }
})

// ─────────────────────────────────────────────────────────────────────── CLI
check('CLI1 --scanner code-analyzer --json --dry-run prints valid JSON with the anchor; exit 0', () => {
  const out = execFileSync(
    'node',
    [CLI, '--scanner', 'code-analyzer', '--input', SOLANO, '--target', join(tmpdir(), 'nope'), '--dry-run', '--json'],
    { encoding: 'utf8' }
  )
  const parsed = JSON.parse(out)
  assert.equal(parsed.scanner, 'code-analyzer')
  assert.equal(parsed.kind, 'file-parser')
  assert.equal(parsed.merged, null) // dry-run
  assert.ok(parsed.findings.some((f) => f.ruleId === 'ApexCRUDViolation' && f.file.endsWith('SolanoAccountInsightController.cls:19')))
})

check('CLI2 merge into a target ledger writes deterministic findings + is idempotent on re-run', () => {
  const d = mkdtempSync(join(tmpdir(), 'ingest-cli-'))
  dirs.push(d)
  const lp = join(d, '.security-review', 'audit-ledger.json')
  execFileSync('node', [CLI, '--scanner', 'code-analyzer', '--input', SOLANO, '--target', d], { encoding: 'utf8' })
  const l1 = readJSON(lp)
  assert.equal(l1.findings.length, 4)
  assert.ok(l1.findings.every((f) => f.provenance === 'deterministic'))
  execFileSync('node', [CLI, '--scanner', 'code-analyzer', '--input', SOLANO, '--target', d], { encoding: 'utf8' })
  const l2 = readJSON(lp)
  assert.equal(l2.findings.length, 4) // idempotent — no duplicates
})

check('CLI3 --scanner metadata-viewall runs the source-scanner over --target and writes the over-grant', () => {
  const d = mkdtempSync(join(tmpdir(), 'ingest-cli-meta-'))
  dirs.push(d)
  // copy the permissionset fixture under the target so the source-scanner finds it
  mkdirSync(join(d, 'force-app', 'main', 'default', 'permissionsets'), { recursive: true })
  writeFileSync(
    join(d, 'force-app', 'main', 'default', 'permissionsets', 'Solano_Admin.permissionset-meta.xml'),
    readFileSync(join(FIX, 'permissionsets', 'Solano_Admin.permissionset-meta.xml'), 'utf8')
  )
  execFileSync('node', [CLI, '--scanner', 'metadata-viewall', '--target', d], { encoding: 'utf8' })
  const l = readJSON(join(d, '.security-review', 'audit-ledger.json'))
  const va = l.findings.find((f) => f.ruleId === 'viewall-overgrant')
  assert.ok(va, 'viewall-overgrant finding not written')
  assert.equal(va.engine, 'metadata')
  assert.equal(va.adjusted_severity, 'high')
})

// ───────────────────────────────────── checkov (Phase 2 · 2a #1 — IaC misconfig)
// The REAL fixture (genuine Checkov 3.3.2 dockerfile output, host path genericized) is the
// anchor; small INLINE synthetic JSON covers shape edge cases (array shape, enterprise sev).
const ingestCheckov = (raw) => ingest(raw || readJSON(CHECKOV), checkovAdapter, { repoRoot: '', pass: 1 })

check('CK-determinism: ingest the real Checkov fixture twice → byte-identical findings', () => {
  const a = ingestCheckov().findings
  const b = ingestCheckov().findings
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})

check('CK-anchor: CKV_DOCKER_2 → one deterministic iac-misconfig finding (checkov/low via the sourced RULE_BAND_FLOOR — availability-only HEALTHCHECK, 0.8.105 — Dockerfile:1, guideline in reasoning)', () => {
  const raw = readJSON(CHECKOV)
  const guideline = raw.results.failed_checks[0].guideline
  const { findings } = ingestCheckov(raw)
  assert.equal(findings.length, 1)
  const f = findings[0]
  assert.equal(f.provenance, 'deterministic')
  assert.equal(f.engine, 'checkov')
  assert.equal(f.ruleId, 'CKV_DOCKER_2')
  assert.equal(f.class, 'iac-misconfig')
  assert.equal(f.dimension, 'infrastructure-iac')
  assert.equal(f.adjusted_severity, 'low') // the sourced availability-only band floor (checkov/CKV_DOCKER_2) lowers the class high → low
  assert.match(f.verdict_reasoning, /banded low by the sourced rule-band floor for checkov\/CKV_DOCKER_2/)
  assert.ok(f.file.endsWith('Dockerfile:1'), `file was ${f.file}`)
  assert.equal(f.status, 'confirmed')
  assert.match(f.id, /^[0-9a-f]{16}$/)
  assert.ok(guideline && f.verdict_reasoning.includes(guideline), 'the Checkov guideline URL must appear in verdict_reasoning')
})

check('CK-failed-only: the 24 passed_checks produce 0 findings (only the 1 failed_check does)', () => {
  const raw = readJSON(CHECKOV)
  assert.equal(raw.results.passed_checks.length, 24)
  assert.equal(raw.results.failed_checks.length, 1)
  assert.equal(ingestCheckov(raw).findings.length, 1)
})

check('CK-severity-from-class: a failed check carrying enterprise severity:LOW is STILL high (class, not tool) — on a floor-UNMAPPED rule (CKV_DOCKER_3; CKV_DOCKER_2 now rides RULE_BAND_FLOOR, see test-rule-band-floor.mjs)', () => {
  const synthetic = {
    check_type: 'dockerfile',
    results: {
      passed_checks: [],
      failed_checks: [
        { check_id: 'CKV_DOCKER_3', check_name: 'Ensure that a user for the container has been created', file_path: 'Dockerfile', file_line_range: [1, 7], severity: 'LOW', guideline: 'https://example.test/g' },
      ],
      skipped_checks: [],
      parsing_errors: [],
    },
  }
  const { findings } = ingest(synthetic, checkovAdapter, { repoRoot: '', pass: 1 })
  assert.equal(findings.length, 1)
  // would be 'low' if it followed the tool's enterprise severity; stays 'high' from the class
  assert.equal(findings[0].adjusted_severity, 'high')
})

check('CK-array-shape: an ARRAY of two framework result objects → two distinct findings (multi-framework run)', () => {
  const arr = [
    { check_type: 'dockerfile', results: { passed_checks: [], skipped_checks: [], parsing_errors: [], failed_checks: [
      { check_id: 'CKV_DOCKER_2', check_name: 'Healthcheck', file_path: 'Dockerfile', file_line_range: [1, 7], guideline: 'https://example.test/a' },
    ] } },
    { check_type: 'terraform', results: { passed_checks: [], skipped_checks: [], parsing_errors: [], failed_checks: [
      { check_id: 'CKV_AWS_18', check_name: 'Ensure S3 bucket has access logging', file_path: 'main.tf', file_line_range: [10, 20], guideline: 'https://example.test/b' },
    ] } },
  ]
  const { findings } = ingest(arr, checkovAdapter, { repoRoot: '', pass: 1 })
  assert.equal(findings.length, 2)
  assert.notEqual(findings[0].id, findings[1].id)
  assert.ok(findings.every((f) => f.class === 'iac-misconfig' && f.engine === 'checkov'))
  // the floor-unmapped terraform rule keeps the class high; CKV_DOCKER_2 rides the sourced band floor → low
  assert.equal(findings.find((f) => f.ruleId === 'CKV_AWS_18').adjusted_severity, 'high')
  assert.equal(findings.find((f) => f.ruleId === 'CKV_DOCKER_2').adjusted_severity, 'low')
  assert.deepEqual(findings.map((f) => f.ruleId).sort(), ['CKV_AWS_18', 'CKV_DOCKER_2'])
})

check('CK-multiple-and-skip: 2 failed + 1 skipped + 1 passed → exactly 2 findings', () => {
  const fw = {
    check_type: 'dockerfile',
    results: {
      passed_checks: [{ check_id: 'CKV_DOCKER_5', check_name: 'Update alone', file_path: 'Dockerfile', file_line_range: [1, 7] }],
      failed_checks: [
        { check_id: 'CKV_DOCKER_2', check_name: 'Healthcheck', file_path: 'Dockerfile', file_line_range: [1, 7] },
        { check_id: 'CKV_DOCKER_3', check_name: 'No root user', file_path: 'Dockerfile', file_line_range: [3, 3] },
      ],
      skipped_checks: [{ check_id: 'CKV_DOCKER_7', check_name: 'Skipped', file_path: 'Dockerfile', file_line_range: [1, 1] }],
      parsing_errors: [],
    },
  }
  const { findings } = ingest(fw, checkovAdapter, { repoRoot: '', pass: 1 })
  assert.equal(findings.length, 2)
  assert.deepEqual(findings.map((f) => f.ruleId).sort(), ['CKV_DOCKER_2', 'CKV_DOCKER_3'])
})

check('CK-classify: classify() is the constant iac-misconfig; no securityRelevant (security-by-construction)', () => {
  assert.equal(checkovAdapter.classify('CKV_AWS_123'), 'iac-misconfig')
  assert.equal(checkovAdapter.classify('anything-at-all'), 'iac-misconfig')
  assert.equal(checkovAdapter.securityRelevant, undefined) // no tag filter — every failed check is a finding
})

check('CK-malformed: parse skips a check with no check_id; ingest drops a hit with no file_path (with a note)', () => {
  const mixed = {
    results: {
      failed_checks: [
        { check_name: 'no id', file_path: 'Dockerfile', file_line_range: [1, 1] }, // no check_id → skipped in parse
        { check_id: 'CKV_X', check_name: 'no file', file_line_range: [1, 1] }, // no file_path → dropped by ingest core
        { check_id: 'CKV_Y', check_name: 'ok', file_path: 'Dockerfile', file_line_range: [2, 2] },
      ],
    },
  }
  const hits = checkovAdapter.parse(mixed)
  assert.equal(hits.length, 2) // the no-check_id one is skipped in parse
  const { findings, notes } = ingest(mixed, checkovAdapter, { repoRoot: '', pass: 1 })
  assert.equal(findings.length, 1) // CKV_X dropped by the ingest core (no file)
  assert.equal(findings[0].ruleId, 'CKV_Y')
  assert.ok(notes.some((n) => /malformed hit/.test(n)))
})

check('CK-fail-safe: collect() missing → null; parse(null/{}/{results:null}/[]) → []; ingest(null) → 0 + honest note', () => {
  assert.equal(checkovAdapter.collect({ input: join(tmpdir(), 'definitely-not-here-checkov.json') }), null)
  assert.deepEqual(checkovAdapter.parse(null), [])
  assert.deepEqual(checkovAdapter.parse({}), [])
  assert.deepEqual(checkovAdapter.parse({ results: null }), [])
  assert.deepEqual(checkovAdapter.parse([]), [])
  const { findings, notes } = ingest(null, checkovAdapter, { repoRoot: '', pass: 1 })
  assert.equal(findings.length, 0)
  assert.ok(notes.some((n) => /no input collected/.test(n)))
})

check('CK-merge-idempotent: ingest the fixture twice into a ledger → no dupes; a pre-existing llm finding survives', () => {
  const llm = {
    id: 'c'.repeat(16),
    dimension: 'oauth-identity',
    title: 'pre-existing llm-inferred finding',
    severity: 'high',
    adjusted_severity: 'high',
    file: 'server/index.js:7',
    status: 'confirmed',
    first_seen: 1,
    last_seen: 1,
    verdict: 'confirmed_real',
    verdict_reasoning: 'reasoned over the code',
  }
  const ledger = { schema_version: '1', findings: [llm], passes: [] }
  const ck = ingestCheckov().findings
  const r1 = mergeFindings(ledger, ck, 1)
  assert.equal(r1.added, 1)
  assert.equal(ledger.findings.length, 2) // 1 llm + 1 checkov
  const r2 = mergeFindings(ledger, ck, 1)
  assert.equal(r2.added, 0)
  assert.equal(ledger.findings.length, 2) // idempotent — no dupes
  assert.ok(ledger.findings.some((f) => f.id === 'c'.repeat(16) && !('provenance' in f)))
})

check('CK-schema: a Checkov finding validates against $defs/finding', () => {
  const f = ingestCheckov().findings[0]
  assert.deepEqual(validateFinding(f), [])
})

check('CK-CLI: --scanner checkov --json --dry-run prints valid JSON with the anchor; exit 0', () => {
  const out = execFileSync(
    'node',
    [CLI, '--scanner', 'checkov', '--input', CHECKOV, '--target', join(tmpdir(), 'nope-ck'), '--dry-run', '--json'],
    { encoding: 'utf8' }
  )
  const parsed = JSON.parse(out)
  assert.equal(parsed.scanner, 'checkov')
  assert.equal(parsed.kind, 'file-parser')
  assert.equal(parsed.merged, null) // dry-run
  assert.ok(parsed.findings.some((f) => f.ruleId === 'CKV_DOCKER_2' && f.file.endsWith('Dockerfile:1')))
})

check('CK-CLI-merge: --scanner checkov writes the deterministic finding to the target ledger + is idempotent', () => {
  const d = mkdtempSync(join(tmpdir(), 'ingest-cli-ck-'))
  dirs.push(d)
  const lp = join(d, '.security-review', 'audit-ledger.json')
  execFileSync('node', [CLI, '--scanner', 'checkov', '--input', CHECKOV, '--target', d], { encoding: 'utf8' })
  const l1 = readJSON(lp)
  const ck1 = l1.findings.filter((f) => f.engine === 'checkov')
  assert.equal(ck1.length, 1)
  assert.equal(ck1[0].ruleId, 'CKV_DOCKER_2')
  assert.equal(ck1[0].adjusted_severity, 'low') // the sourced availability-only band floor (0.8.105)
  execFileSync('node', [CLI, '--scanner', 'checkov', '--input', CHECKOV, '--target', d], { encoding: 'utf8' })
  const l2 = readJSON(lp)
  assert.equal(l2.findings.filter((f) => f.engine === 'checkov').length, 1) // idempotent — no duplicate
})

// ───────────────────────────────────── semgrep (Phase 2 · 2a #2 — external SAST, tool→band)
// The DECISIVE difference from checkov/code-analyzer: Semgrep carries a real per-result
// severity (ERROR/WARNING/INFO), so this is the FIRST genuine tool→band adapter — the tool's
// own band DRIVES the finding severity (the INVERSE of the class-severity adapters). Two REAL
// fixtures anchor it: coldstart-full (2× WARNING → medium) and helios (1× ERROR → high).
const ingestSemgrep = (raw) => ingest(raw, semgrepAdapter, { repoRoot: '', pass: 1 })
const URLLIB_RULE = readJSON(SEMGREP_WARN).results[0].check_id // the dynamic-urllib rule (CWE-939 custom-URL-scheme authorization — NOT SSRF; real SSRF is CWE-918 → data-export)
const URLLIB_REF = readJSON(SEMGREP_WARN).results[0].extra.metadata.references[0]

check('SG-determinism: ingest the real coldstart-full fixture twice → byte-identical findings', () => {
  const a = ingestSemgrep(readJSON(SEMGREP_WARN)).findings
  const b = ingestSemgrep(readJSON(SEMGREP_WARN)).findings
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})

check('SG-anchor-WARNING: coldstart urllib (severity WARNING) → deterministic/semgrep/external-sast/MEDIUM, mcp/server.py:76, NO class, ref URL in reasoning', () => {
  const { findings } = ingestSemgrep(readJSON(SEMGREP_WARN))
  const f = findById(findings, (x) => x.file.endsWith('mcp/server.py:76'))
  assert.ok(f, 'the :76 WARNING anchor is not present')
  assert.equal(f.provenance, 'deterministic')
  assert.equal(f.engine, 'semgrep')
  assert.equal(f.ruleId, URLLIB_RULE)
  assert.equal(f.dimension, 'external-sast')
  assert.equal(f.adjusted_severity, 'medium') // WARNING → medium (the TOOL band, not a class)
  assert.equal(f.status, 'confirmed')
  assert.equal(f.class, undefined) // owns NO toolkit class
  assert.ok(!('class' in f), 'a Semgrep finding must carry no `class` key')
  assert.match(f.id, /^[0-9a-f]{16}$/)
  assert.ok(URLLIB_REF && f.verdict_reasoning.includes(URLLIB_REF), 'the metadata reference URL must appear in verdict_reasoning')
})

check('SG-anchor-ERROR: helios detect-child-process (severity ERROR, CWE-78) → HIGH, injection-xss, server/index.js:28', () => {
  const { findings } = ingestSemgrep(readJSON(SEMGREP_ERR))
  assert.equal(findings.length, 1)
  const f = findings[0]
  assert.equal(f.engine, 'semgrep')
  assert.equal(f.adjusted_severity, 'high') // ERROR → high (the TOOL band)
  assert.equal(f.dimension, 'injection-xss') // CWE-78 routes (B5 · E0.1b) — the real methodology dimension
  assert.ok(f.file.endsWith('server/index.js:28'), `file was ${f.file}`)
  assert.equal(f.class, undefined)
})

check('SG-two-distinct: the same check_id at lines 76 & 89 → TWO distinct findings (distinct ids)', () => {
  const { findings } = ingestSemgrep(readJSON(SEMGREP_WARN))
  const urllib = findings.filter((x) => x.ruleId === URLLIB_RULE)
  assert.equal(urllib.length, 2)
  assert.notEqual(urllib[0].id, urllib[1].id)
  const files = urllib.map((x) => x.file).sort()
  assert.ok(files.some((p) => p.endsWith('mcp/server.py:76')))
  assert.ok(files.some((p) => p.endsWith('mcp/server.py:89')))
})

check('SG-severity-FROM-TOOL-BAND: mutating extra.severity WARNING→ERROR MOVES the band medium→high — INTENTIONALLY the INVERSE of S1', () => {
  // For Semgrep the tool severity DOES drive the band (that is the tool→band design). For
  // Code-Analyzer/Checkov it must NOT (class-severity, see S1 / CK-severity-from-class). Do NOT
  // "harmonize" these two checks — the divergence is the whole point of the tool→band adapter.
  const base = ingestSemgrep(readJSON(SEMGREP_WARN)).findings
  assert.ok(base.every((f) => f.adjusted_severity === 'medium')) // both WARNING → medium
  const raw = clone(readJSON(SEMGREP_WARN))
  for (const r of raw.results) r.extra.severity = 'ERROR' // WARNING → ERROR
  const bumped = ingestSemgrep(raw).findings
  assert.ok(bumped.every((f) => f.adjusted_severity === 'high'), 'ERROR must move the band to high — the tool band drives Semgrep severity')
})

check('SG-no-class / classify: classify() is the constant null, no securityRelevant, finding carries no `class`', () => {
  assert.equal(semgrepAdapter.classify('anything'), null)
  assert.equal(semgrepAdapter.classify(URLLIB_RULE), null)
  assert.equal(semgrepAdapter.securityRelevant, undefined) // security-by-construction — no tag filter
  const f = ingestSemgrep(readJSON(SEMGREP_ERR)).findings[0]
  assert.ok(!('class' in f), 'a Semgrep finding owns no class → supersedes nothing (Phase-2b dedup deferred)')
})

check('SG-unknown-severity: a result with extra.severity:INVENTORY → ingested at INFO with a note, never dropped', () => {
  const raw = {
    version: '1.0.0',
    results: [
      { check_id: 'python.lang.misc.inventory-rule', path: 'mcp/x.py', start: { line: 3 }, extra: { severity: 'INVENTORY', message: 'an inventory/experiment rule class', metadata: {} } },
    ],
  }
  const { findings, notes } = ingestSemgrep(raw)
  assert.equal(findings.length, 1)
  assert.equal(findings[0].adjusted_severity, 'info') // unknown band → info (never dropped)
  assert.ok(notes.some((n) => /tool band/.test(n) && /INVENTORY/.test(n)), `expected an INVENTORY→info band note, got ${JSON.stringify(notes)}`)
})

check('SG-sev-map: SEMGREP_SEVERITY_TO_FINDING is exactly ERROR→high / WARNING→medium / INFO→low', () => {
  assert.deepEqual(SEMGREP_SEVERITY_TO_FINDING, { ERROR: 'high', WARNING: 'medium', INFO: 'low' })
})

check('SG-buildFinding-tool-band: buildFinding with bandFromTool + NO classKey → the tool band, dimensionHint, tool-band reasoning, no class', () => {
  const f = buildFinding({
    engine: 'semgrep',
    ruleId: 'some.semgrep.rule',
    severityNum: null,
    file: 'mcp/server.py',
    startLine: 5,
    message: 'a SAST hit',
    resources: [],
    classKey: null,
    bandFromTool: 'medium',
    dimensionHint: 'external-sast',
    toolSevLabel: 'WARNING',
    repoRoot: '',
    pass: 1,
  })
  assert.equal(f.adjusted_severity, 'medium')
  assert.equal(f.severity, 'medium')
  assert.equal(f.dimension, 'external-sast')
  assert.equal(f.class, undefined)
  assert.match(f.verdict_reasoning, /tool band \(WARNING → medium\)/)
})

check('SG-buildFinding-MAPPED-regression: a mapped crud-fls finding is class-severity (high) EVEN WHEN bandFromTool is present — the mapped path is UNCHANGED', () => {
  // The tool→band generalization is ADDITIVE on the unmapped side only. A mapped classKey must
  // ALWAYS win: a deliberately-low bandFromTool must NOT pull a crud-fls finding off its class
  // severity. (This is the unit twin of S1, which proves the same over the real fixture.)
  const withBand = buildFinding({
    engine: 'pmd', ruleId: 'ApexCRUDViolation', severityNum: 5, file: 'force-app/x.cls', startLine: 10,
    message: 'Validate CRUD', resources: [], classKey: 'crud-fls', bandFromTool: 'low', dimensionHint: 'external-sast',
    toolSevLabel: 'INFO', repoRoot: '', pass: 1,
  })
  assert.equal(withBand.adjusted_severity, 'high') // class wins over bandFromTool='low' AND severityNum=5
  assert.equal(withBand.dimension, 'apex-exposed-surface') // class dimension, NOT the dimensionHint
  assert.equal(withBand.class, 'crud-fls')
  // and WITHOUT a band the mapped path is identical (no behavioural drift from the new params)
  const noBand = buildFinding({
    engine: 'pmd', ruleId: 'ApexCRUDViolation', severityNum: 5, file: 'force-app/x.cls', startLine: 10,
    message: 'Validate CRUD', resources: [], classKey: 'crud-fls', repoRoot: '', pass: 1,
  })
  assert.equal(noBand.adjusted_severity, 'high')
})

check('SG-fail-safe: collect() missing → null; parse(null/{}/{results:null}/{results:[]}) → []; a result missing extra/start does not crash; ingest(null) → 0 + note', () => {
  assert.equal(semgrepAdapter.collect({ input: join(tmpdir(), 'definitely-not-here-semgrep.json') }), null)
  assert.deepEqual(semgrepAdapter.parse(null), [])
  assert.deepEqual(semgrepAdapter.parse({}), [])
  assert.deepEqual(semgrepAdapter.parse({ results: null }), [])
  assert.deepEqual(semgrepAdapter.parse({ results: [] }), [])
  // a result with no check_id is skipped in parse; one with no extra/start still parses (no crash)
  const hits = semgrepAdapter.parse({ results: [{ path: 'a.py' }, { check_id: 'r', path: 'a.py' }] })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].startLine, null)
  assert.equal(hits[0].message, '')
  assert.equal(hits[0].bandFromTool, 'info') // no severity → info
  const { findings, notes } = ingestSemgrep(null)
  assert.equal(findings.length, 0)
  assert.ok(notes.some((n) => /no input collected/.test(n)))
})

check('SG-merge-idempotent: ingest the coldstart fixture twice into a ledger → no dupes; a pre-existing llm finding survives', () => {
  const llm = {
    id: 'd'.repeat(16),
    dimension: 'oauth-identity',
    title: 'pre-existing llm-inferred finding',
    severity: 'high',
    adjusted_severity: 'high',
    file: 'mcp/server.py:5',
    status: 'confirmed',
    first_seen: 1,
    last_seen: 1,
    verdict: 'confirmed_real',
    verdict_reasoning: 'reasoned over the code',
  }
  const ledger = { schema_version: '1', findings: [llm], passes: [] }
  const sg = ingestSemgrep(readJSON(SEMGREP_WARN)).findings
  const r1 = mergeFindings(ledger, sg, 1)
  assert.equal(r1.added, 2)
  assert.equal(ledger.findings.length, 3) // 1 llm + 2 semgrep
  const r2 = mergeFindings(ledger, sg, 1)
  assert.equal(r2.added, 0)
  assert.equal(ledger.findings.length, 3) // idempotent — no dupes
  assert.ok(ledger.findings.some((f) => f.id === 'd'.repeat(16) && !('provenance' in f)))
})

check('SG-schema: a Semgrep finding (no class, CWE-routed dimension injection-xss) validates against $defs/finding', () => {
  const f = ingestSemgrep(readJSON(SEMGREP_ERR)).findings[0]
  assert.deepEqual(validateFinding(f), [])
})

// ───────────── semgrep reachability path (B5 · E0.1 — the taint-mode source→sink dataflow trace)
// A Semgrep taint-mode result carries `extra.dataflow_trace` — the ordered source→sink dataflow
// path the engine computed. The adapter captures it as a `reachabilityPath` attribute
// (+ `reachable: true`) instead of discarding it; EVERYTHING else about the finding is untouched,
// and a trace-less result attaches NEITHER field. The fixture is GENUINE semgrep 1.85.0
// `--json --dataflow-traces` output over a seeded request-parameter→SQL-sink sample (newer
// Semgrep CLIs serialize the trace to text/SARIF only — a capture from one carries no
// attribute, the exact degradation RP2 locks).
const SEMGREP_TAINT = join(FIX, 'semgrep-taint-seeded.json') // genuine 1.85.0: 1× ERROR taint result WITH extra.dataflow_trace (source app.py:10 → intermediates :10/:11 → sink app.py:13)

check('SG-RP1 reachability: the taint fixture → reachabilityPath {source app.py:10, ordered intermediates :10/:11, sink app.py:13} + reachable:true; CWE-89 routes to injection-xss; id/band/reasoning untouched; validates against $defs/finding', () => {
  const { findings } = ingestSemgrep(readJSON(SEMGREP_TAINT))
  assert.equal(findings.length, 1)
  const f = findings[0]
  assert.equal(f.reachable, true)
  assert.equal(f.dimension, 'injection-xss') // metadata.cwe 'CWE-89' routes (B5 · E0.1b)
  assert.deepEqual(f.reachabilityPath, {
    source: { file: 'app.py', line: 10 },
    intermediate: [
      { file: 'app.py', line: 10 },
      { file: 'app.py', line: 11 },
    ],
    sink: { file: 'app.py', line: 13 },
  })
  assert.equal(f.adjusted_severity, 'high') // ERROR → high — the trace does NOT move the band
  assert.ok(f.file.endsWith('app.py:13'), `file was ${f.file}`)
  // The attribute is INVISIBLE to everything else: the same fixture with the trace REMOVED
  // must produce a finding byte-identical to this one minus the two new fields (same id, same
  // band, same reasoning — attribute capture only).
  const raw = clone(readJSON(SEMGREP_TAINT))
  delete raw.results[0].extra.dataflow_trace
  const bare = ingestSemgrep(raw).findings[0]
  const { reachabilityPath: _rp, reachable: _re, ...rest } = f
  assert.equal(JSON.stringify(rest), JSON.stringify(bare))
  assert.deepEqual(validateFinding(f), []) // the ledger schema covers the new attribute
})

check('SG-RP2 additive-only: the existing coldstart-full + helios fixtures (no dataflow_trace) produce findings with NEITHER reachabilityPath NOR reachable', () => {
  for (const fx of [SEMGREP_WARN, SEMGREP_ERR]) {
    const { findings } = ingestSemgrep(readJSON(fx))
    assert.ok(findings.length >= 1)
    for (const f of findings) {
      assert.ok(!('reachabilityPath' in f), `unexpected reachabilityPath on ${f.file}`)
      assert.ok(!('reachable' in f), `unexpected reachable on ${f.file}`)
    }
  }
})

check('SG-RP3 malformed-trace safety: non-object trace / missing taint_sink / junk steps → NO attribute, base finding still emitted, never a throw', () => {
  const variants = [
    () => 'not-an-object', // a non-object trace
    (t) => {
      delete t.taint_sink // a path needs BOTH ends
      return t
    },
    (t) => ({ ...t, taint_source: 42 }), // a junk source step
    (t) => ({ ...t, taint_sink: [] }), // an empty tagged pair — no location to normalize
  ]
  for (const mutate of variants) {
    const raw = clone(readJSON(SEMGREP_TAINT))
    raw.results[0].extra.dataflow_trace = mutate(raw.results[0].extra.dataflow_trace)
    const { findings } = ingestSemgrep(raw)
    assert.equal(findings.length, 1, 'the base finding must still be emitted')
    assert.ok(!('reachabilityPath' in findings[0]) && !('reachable' in findings[0]))
  }
  // a malformed MIDDLE step is skipped (the proven source/sink ends still stand, the
  // intermediate list is present-but-empty — the schema-required shape)
  const raw = clone(readJSON(SEMGREP_TAINT))
  raw.results[0].extra.dataflow_trace.intermediate_vars = [null, { content: 'x' }, 7]
  const f = ingestSemgrep(raw).findings[0]
  assert.equal(f.reachable, true)
  assert.deepEqual(f.reachabilityPath.intermediate, [])
})

// The reachabilityPath capture above is worthless if the LIVE scan stops requesting the trace:
// `--dataflow-traces` is the explicit ask for `extra.dataflow_trace`, and whether `--json`
// carries it is VERSION-dependent (verified: 1.85.0 emits it, 1.168.0 serializes traces to
// text/SARIF only) — dropping the flag from the documented command silently re-dormants the
// feature on every version that honors the request (B5 · E0.2a). The borrowed substrate must
// assert its input: lock the documented Family 7 command shape. Scoped to the fenced invocation
// blocks, NOT the prose — a note mentioning the flag while the command lost it must still go red.
check('SG-RP4 wiring: the run-scans Family 7 Semgrep invocation carries --dataflow-traces (the flag that makes reachabilityPath populate on a live run) alongside --json', () => {
  const skill = readText(join(PLUGIN, 'skills', 'run-scans', 'SKILL.md'))
  const blocks = [...skill.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1])
  const semgrepBlocks = blocks.filter((b) => b.includes('semgrep scan'))
  assert.ok(semgrepBlocks.length >= 1, 'no fenced `semgrep scan` invocation found in skills/run-scans/SKILL.md')
  for (const b of semgrepBlocks) {
    assert.ok(b.includes('--dataflow-traces'), `a Family 7 semgrep invocation lost --dataflow-traces:\n${b}`)
    assert.ok(b.includes('--json'), `a Family 7 semgrep invocation lost --json (the ingest input format):\n${b}`)
  }
})

// ───────────── SARIF codeFlows reachability (B5 · E0.2b — the version-portable taint-path surface)
// SARIF 2.1.0 standardizes the source→sink taint path as `result.codeFlows[] → threadFlows[] →
// locations[]`, and opengrep / semgrep-Pro / CodeQL all emit that IDENTICAL construct — so the ONE
// `sarif` adapter + _sarifReachabilityPath normalizer ingests reachability from any of them,
// decoupled from any single tool's JSON. The fixtures are GENUINE captured output over the SAME
// seeded request-parameter→SQL-sink sample as semgrep-taint-seeded.json (leak-clean relative paths):
//   opengrep-taint-seeded.sarif — opengrep 1.25.0 `opengrep scan --config <taint rule>
//       --taint-intrafile --dataflow-traces --sarif` — 1 result WITH codeFlows (4 threadFlow
//       locations: source :10 → propagators :10/:11 → sink :13; NO executionOrder — array order).
//       Flag truth (empirical, 1.25.0): opengrep SARIF emits codeFlows ONLY WITH --dataflow-traces.
//   opengrep-taint-seeded.json  — opengrep 1.25.0 `opengrep scan --config <taint rule>
//       --taint-intrafile --json` (NO --dataflow-traces — the JSON trace is default-on) —
//       byte-shape-COMPATIBLE with semgrep's JSON (identical key sets, engine_kind 'OSS' on both;
//       NO distinguishing field exists — the D1 engine-label ceiling the OG checks pin).
//   semgrep-taint-seeded.sarif  — semgrep 1.168.0 `semgrep scan --config <taint rule>
//       --dataflow-traces --sarif` — the CE-SARIF ADJUDICATION fixture (see SG-SARIF-CE-PENDING).
const OPENGREP_SARIF = join(FIX, 'opengrep-taint-seeded.sarif')
const OPENGREP_JSON = join(FIX, 'opengrep-taint-seeded.json')
const SEMGREP_SARIF = join(FIX, 'semgrep-taint-seeded.sarif')
const ingestSarif = (raw) => ingest(raw, sarifAdapter, { repoRoot: '', pass: 1 })

check('SG-RP-SARIF1 reachability: the opengrep SARIF fixture → reachabilityPath {source app.py:10, intermediates :10/:11, sink app.py:13} + reachable:true; engine \'opengrep\' from tool.driver.name; CWE-89 rule tag routes to injection-xss; level from the rule\'s defaultConfiguration (error → high); additive-only; validates', () => {
  const { findings } = ingestSarif(readJSON(OPENGREP_SARIF))
  assert.equal(findings.length, 1)
  const f = findings[0]
  assert.equal(f.engine, 'opengrep') // 'Opengrep OSS' lowercased first token — NEVER hardcoded
  assert.equal(f.reachable, true)
  assert.equal(f.dimension, 'injection-xss') // the rule's properties.tags carry 'CWE-89'
  assert.deepEqual(f.reachabilityPath, {
    source: { file: 'app.py', line: 10 },
    intermediate: [
      { file: 'app.py', line: 10 },
      { file: 'app.py', line: 11 },
    ],
    sink: { file: 'app.py', line: 13 },
  })
  // the result carries NO own `level` — the band comes from the rule's defaultConfiguration
  // ('error' → high via SARIF_LEVEL_TO_FINDING); the trace does NOT move the band
  assert.equal(f.adjusted_severity, 'high')
  assert.equal(SARIF_LEVEL_TO_FINDING['error'], 'high')
  assert.ok(f.file.endsWith('app.py:13'), `file was ${f.file}`)
  assert.equal(f.provenance, 'deterministic')
  assert.ok(!('class' in f), 'a sarif finding owns NO toolkit class (classify → null)')
  // additive-only: the same fixture with codeFlows REMOVED → byte-identical minus the two fields
  const raw = clone(readJSON(OPENGREP_SARIF))
  delete raw.runs[0].results[0].codeFlows
  const bare = ingestSarif(raw).findings[0]
  const { reachabilityPath: _rp, reachable: _re, ...rest } = f
  assert.equal(JSON.stringify(rest), JSON.stringify(bare))
  assert.deepEqual(validateFinding(f), []) // the E0.1 schema already covers the attribute
})

check('SG-RP-SARIF2 additive-only on a codeFlows-less SARIF: the semgrep 1.168.0 SARIF fixture ingests a base finding (engine \'semgrep\' from ITS driver name, error→high, injection-xss) with NEITHER reachabilityPath NOR reachable', () => {
  const { findings } = ingestSarif(readJSON(SEMGREP_SARIF))
  assert.equal(findings.length, 1)
  const f = findings[0]
  assert.equal(f.engine, 'semgrep') // 'Semgrep OSS' — the same driver-name derivation, different producer
  assert.equal(f.adjusted_severity, 'high')
  assert.equal(f.dimension, 'injection-xss')
  assert.ok(!('reachabilityPath' in f), 'no fabricated trace on a trace-less SARIF')
  assert.ok(!('reachable' in f))
  assert.deepEqual(validateFinding(f), [])
})

check('SG-RP-SARIF3 malformed/partial codeFlows safety: every spec-optional sub-object missing/junk → NO attribute, base finding intact, never a throw; a malformed MIDDLE step is skipped; executionOrder orders when complete', () => {
  const mutate = (fn) => {
    const raw = clone(readJSON(OPENGREP_SARIF))
    fn(raw.runs[0].results[0])
    return raw
  }
  const noAttr = [
    (r) => { r.codeFlows = [] }, // zero codeFlows
    (r) => { r.codeFlows = [{}] }, // a codeFlow with no threadFlows
    (r) => { r.codeFlows = 'junk' }, // non-array codeFlows
    (r) => { r.codeFlows[0].threadFlows = [] }, // zero threadFlows
    (r) => { r.codeFlows[0].threadFlows = [{}] }, // a threadFlow with no locations
    (r) => { r.codeFlows[0].threadFlows[0].locations = [] }, // zero steps
    (r) => { r.codeFlows[0].threadFlows[0].locations.length = 1 }, // ONE step — no source→sink pair
    (r) => { r.codeFlows[0].threadFlows[0].locations[0] = { location: {} } }, // source unresolvable → BOTH-ends contract
    (r) => { r.codeFlows[0].threadFlows[0].locations[3] = 42 }, // sink junk → BOTH-ends contract
    // multiple codeFlows: [0] is taken AND guarded — a junk [0] yields nothing even with a valid [1]
    (r) => { r.codeFlows = ['junk', r.codeFlows[0]] },
  ]
  for (const [i, fn] of noAttr.entries()) {
    const { findings } = ingestSarif(mutate(fn))
    assert.equal(findings.length, 1, `variant ${i}: the base finding must still be emitted`)
    assert.ok(!('reachabilityPath' in findings[0]) && !('reachable' in findings[0]), `variant ${i}: no attribute`)
  }
  // a malformed MIDDLE step is skipped — the proven ends still stand (the _reachabilityPath contract)
  const mid = ingestSarif(mutate((r) => { r.codeFlows[0].threadFlows[0].locations[1] = null })).findings[0]
  assert.equal(mid.reachable, true)
  assert.deepEqual(mid.reachabilityPath.source, { file: 'app.py', line: 10 })
  assert.deepEqual(mid.reachabilityPath.intermediate, [{ file: 'app.py', line: 11 }])
  assert.deepEqual(mid.reachabilityPath.sink, { file: 'app.py', line: 13 })
  // executionOrder: REVERSE the array but stamp each step with its true order → the normalizer
  // re-orders by executionOrder (when EVERY step carries one) and yields the SAME path
  const eo = ingestSarif(mutate((r) => {
    const locs = r.codeFlows[0].threadFlows[0].locations
    locs.forEach((l, i) => { l.executionOrder = i })
    locs.reverse()
  })).findings[0]
  assert.deepEqual(eo.reachabilityPath, {
    source: { file: 'app.py', line: 10 },
    intermediate: [{ file: 'app.py', line: 10 }, { file: 'app.py', line: 11 }],
    sink: { file: 'app.py', line: 13 },
  })
  // a numeric-string startLine coerces (producer quirk); a file:// scheme is stripped, never joined
  // against originalUriBaseIds (which would re-embed the scan host's absolute path)
  const co = ingestSarif(mutate((r) => {
    r.codeFlows[0].threadFlows[0].locations[0].location.physicalLocation.region.startLine = '10'
  })).findings[0]
  assert.deepEqual(co.reachabilityPath.source, { file: 'app.py', line: 10 })
  const fu = ingestSarif(mutate((r) => {
    const pl = r.codeFlows[0].threadFlows[0].locations[0].location.physicalLocation
    pl.artifactLocation.uri = 'file://app.py'
  })).findings[0]
  assert.deepEqual(fu.reachabilityPath.source, { file: 'app.py', line: 10 })
})

check('SG-RP-SARIF-EQ engine-agnostic equivalence: the opengrep SARIF codeFlows and the semgrep-JSON dataflow_trace normalize to the SAME {source,intermediate,sink} — one normal form across engines and formats', () => {
  const viaSarif = ingestSarif(readJSON(OPENGREP_SARIF)).findings[0].reachabilityPath
  const viaJson = ingestSemgrep(readJSON(SEMGREP_TAINT)).findings[0].reachabilityPath
  assert.deepEqual(viaSarif, viaJson) // both describe the identical seeded sample — the E0.2b payoff
})

check('SG-RP-OG1 engine-label (D1): opengrep JSON ingests with engine \'opengrep\' — NEVER \'semgrep\' — via the opengrep adapter; the existing _reachabilityPath parses it (trace default-on in opengrep --json); the JSON-route and SARIF-route ids CONVERGE', () => {
  const { findings } = ingest(readJSON(OPENGREP_JSON), opengrepAdapter, { repoRoot: '', pass: 1 })
  assert.equal(findings.length, 1)
  const f = findings[0]
  assert.equal(f.engine, 'opengrep')
  assert.equal(f.reachable, true)
  assert.deepEqual(f.reachabilityPath, {
    source: { file: 'app.py', line: 10 },
    intermediate: [{ file: 'app.py', line: 10 }, { file: 'app.py', line: 11 }],
    sink: { file: 'app.py', line: 13 },
  })
  assert.ok(f.verdict_reasoning.includes('OPENGREP'), 'the reasoning names the real producer')
  assert.deepEqual(validateFinding(f), [])
  // the SAME hit captured on the SARIF surface converges on the SAME id (engine+ruleId+file:line)
  // — an opengrep JSON + SARIF evidence pair dedups idempotently instead of double-reporting
  const viaSarif = ingestSarif(readJSON(OPENGREP_SARIF)).findings[0]
  assert.equal(f.id, viaSarif.id)
  // the D1 honest ceiling, pinned: opengrep JSON is content-INDISTINGUISHABLE from semgrep JSON
  // (verified: identical key sets), so the FORMAT recognizer says 'semgrep' and the opengrep
  // adapter carries NO detect — provenance comes from --scanner opengrep / the documented
  // opengrep-* evidence name (ALL-SARIF1), never from a content guess
  assert.equal(recognizeScanner(readJSON(OPENGREP_JSON)), 'semgrep')
  assert.equal(opengrepAdapter.detect, undefined)
})

check('SG-SARIF-CE-PENDING adjudication: semgrep CE 1.168.0 `--sarif --dataflow-traces` emitted NO codeFlows on a taint finding that PROVABLY has a trace (opengrep emits a 4-step flow on the same sample+rule) — CE-SARIF reachability stays PENDING (Pro-gated), relied on from Opengrep instead; nothing fabricated', () => {
  const raw = readJSON(SEMGREP_SARIF)
  assert.equal(raw.runs[0].tool.driver.semanticVersion, '1.168.0') // the capture IS the claimed version
  assert.equal(raw.runs[0].results.length, 1)
  assert.ok(!('codeFlows' in raw.runs[0].results[0]),
    'the captured CE fixture carries no codeFlows — if a re-capture ever changes this, flip the semgrep-SARIF status from pending to proven (docs + this check)')
  // and the opengrep capture of the SAME sample DOES carry the flow — the contrast that adjudicates
  const og = readJSON(OPENGREP_SARIF)
  assert.equal(og.runs[0].results[0].codeFlows[0].threadFlows[0].locations.length, 4)
})

// The SARIF ingest above is worthless if the LIVE scan never captures the surface — the SG-RP4
// posture, extended to E0.2b's two new invocations. Scoped to the fenced blocks, NOT the prose.
check('SG-RP-SARIF-wiring: run-scans Family 7 carries a semgrep --sarif capture WITH --dataflow-traces, and an opengrep invocation emitting BOTH --json and --sarif WITH --taint-intrafile + --dataflow-traces (opengrep SARIF codeFlows needs the flag — verified 1.25.0)', () => {
  const skill = readText(join(PLUGIN, 'skills', 'run-scans', 'SKILL.md'))
  const blocks = [...skill.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1])
  const sgSarif = blocks.filter((b) => b.includes('semgrep scan') && b.includes('--sarif'))
  assert.ok(sgSarif.length >= 1, 'no fenced `semgrep scan … --sarif` capture in skills/run-scans/SKILL.md')
  for (const b of sgSarif) assert.ok(b.includes('--dataflow-traces'), `the semgrep SARIF capture lost --dataflow-traces (required for CE/Pro codeFlows):\n${b}`)
  const ogBlocks = blocks.filter((b) => b.includes('opengrep scan'))
  assert.ok(ogBlocks.length >= 1, 'no fenced `opengrep scan` invocation in skills/run-scans/SKILL.md')
  assert.ok(ogBlocks.some((b) => b.includes('--json')), 'the opengrep invocation lost its --json surface')
  assert.ok(ogBlocks.some((b) => b.includes('--sarif')), 'the opengrep invocation lost its --sarif surface (the codeFlows producer)')
  for (const b of ogBlocks) {
    assert.ok(b.includes('--taint-intrafile'), `an opengrep invocation lost --taint-intrafile (the cross-function taint CE cannot do):\n${b}`)
    assert.ok(b.includes('--dataflow-traces'), `an opengrep invocation lost --dataflow-traces (SARIF codeFlows require it on 1.25.0):\n${b}`)
    assert.ok(b.includes('evidence/opengrep-'), `an opengrep invocation lost the documented opengrep-* evidence name (the D1 engine-label anchor):\n${b}`)
  }
})

check('SG-CLI: --scanner semgrep --input <fixture> --json --dry-run prints valid JSON with the anchor; exit 0', () => {
  const out = execFileSync(
    'node',
    [CLI, '--scanner', 'semgrep', '--input', SEMGREP_WARN, '--target', join(tmpdir(), 'nope-sg'), '--dry-run', '--json'],
    { encoding: 'utf8' }
  )
  const parsed = JSON.parse(out)
  assert.equal(parsed.scanner, 'semgrep')
  assert.equal(parsed.kind, 'file-parser')
  assert.equal(parsed.merged, null) // dry-run
  assert.ok(parsed.findings.some((f) => f.ruleId === URLLIB_RULE && f.file.endsWith('mcp/server.py:76') && f.adjusted_severity === 'medium'))
})

check('SG-CLI-merge: --scanner semgrep writes the deterministic findings to the target ledger + is idempotent', () => {
  const d = mkdtempSync(join(tmpdir(), 'ingest-cli-sg-'))
  dirs.push(d)
  const lp = join(d, '.security-review', 'audit-ledger.json')
  execFileSync('node', [CLI, '--scanner', 'semgrep', '--input', SEMGREP_WARN, '--target', d], { encoding: 'utf8' })
  const l1 = readJSON(lp)
  const sg1 = l1.findings.filter((f) => f.engine === 'semgrep')
  assert.equal(sg1.length, 2)
  assert.ok(sg1.every((f) => f.adjusted_severity === 'medium' && f.provenance === 'deterministic'))
  execFileSync('node', [CLI, '--scanner', 'semgrep', '--input', SEMGREP_WARN, '--target', d], { encoding: 'utf8' })
  const l2 = readJSON(lp)
  assert.equal(l2.findings.filter((f) => f.engine === 'semgrep').length, 2) // idempotent — no dupes
})

// ───────────────────────────────────── bandit (Phase 2 · 2a #3 — Python SAST, tool→band)
// The PROOF the Semgrep tool→band path GENERALIZES: bandit reuses buildFinding's bandFromTool
// path with ZERO harness-core change (one new adapter + one severity map). Same shape as Semgrep
// (real per-result severity HIGH/MEDIUM/LOW, owns no class, external-sast). The real fixture is
// all-MEDIUM, so the HIGH/LOW/unknown band cases use small INLINE synthetic results.
const ingestBandit = (raw) => ingest(raw, banditAdapter, { repoRoot: '', pass: 1 })

check('BN-determinism: ingest the real coldstart-full fixture twice → byte-identical findings', () => {
  const a = ingestBandit(readJSON(BANDIT)).findings
  const b = ingestBandit(readJSON(BANDIT)).findings
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})

check('BN-anchor: B608 hardcoded_sql_expressions (severity MEDIUM, issue_cwe.id 89) → deterministic/bandit/injection-xss/MEDIUM, mcp/server.py:46, NO class, more_info URL in reasoning', () => {
  const raw = readJSON(BANDIT)
  const moreInfo = raw.results.find((r) => r.test_id === 'B608').more_info
  const { findings } = ingestBandit(raw)
  const f = findById(findings, (x) => x.file.endsWith('mcp/server.py:46'))
  assert.ok(f, 'the B608 :46 anchor is not present')
  assert.equal(f.provenance, 'deterministic')
  assert.equal(f.engine, 'bandit')
  assert.equal(f.ruleId, 'B608')
  assert.equal(f.dimension, 'injection-xss') // CWE-89 routes (B5 · E0.1b) — the real methodology dimension
  assert.equal(f.adjusted_severity, 'medium') // MEDIUM → medium (the TOOL band, not a class)
  assert.equal(f.status, 'confirmed')
  assert.equal(f.class, undefined) // owns NO toolkit class
  assert.ok(!('class' in f), 'a Bandit finding must carry no `class` key')
  assert.match(f.id, /^[0-9a-f]{16}$/)
  assert.ok(moreInfo && f.verdict_reasoning.includes(moreInfo), 'the more_info URL must appear in verdict_reasoning')
})

check('BN-count: the real fixture → exactly 4 findings, all medium; B608 (CWE-89) files under injection-xss, B310/B104 stay external-sast', () => {
  const { findings } = ingestBandit(readJSON(BANDIT))
  assert.equal(findings.length, 4)
  assert.ok(findings.every((f) => f.adjusted_severity === 'medium'), 'every real-fixture finding is medium')
  assert.ok(findings.every((f) => f.engine === 'bandit'))
  // per-hit CWE routing (B5 · E0.1b): ONLY the allowlisted CWE-89 hit moves; the rest keep the label
  for (const f of findings) assert.equal(f.dimension, f.ruleId === 'B608' ? 'injection-xss' : 'external-sast', `dimension for ${f.ruleId}`)
  assert.deepEqual(findings.map((f) => f.ruleId).sort(), ['B104', 'B310', 'B310', 'B608'])
})

check('BN-two-distinct: B310 at lines 76 & 89 → TWO distinct findings (same test_id, distinct ids)', () => {
  const { findings } = ingestBandit(readJSON(BANDIT))
  const b310 = findings.filter((x) => x.ruleId === 'B310')
  assert.equal(b310.length, 2)
  assert.notEqual(b310[0].id, b310[1].id)
  const files = b310.map((x) => x.file).sort()
  assert.ok(files.some((p) => p.endsWith('mcp/server.py:76')))
  assert.ok(files.some((p) => p.endsWith('mcp/server.py:89')))
})

check('BN-band HIGH/LOW/unknown (inline synthetic): HIGH→high, LOW→low, CRITICAL(not a real bandit level)→info-never-dropped', () => {
  const raw = {
    errors: [],
    results: [
      // HIGH carries more_info → resources[0] is the more_info URL
      { test_id: 'B602', test_name: 'subprocess_popen_with_shell_equals_true', issue_severity: 'HIGH', issue_confidence: 'HIGH', filename: 'mcp/a.py', line_number: 10, more_info: 'https://bandit.example/b602', issue_cwe: { id: 78, link: 'https://cwe.mitre.org/data/definitions/78.html' } },
      // LOW carries NO more_info → resources falls back to issue_cwe.link
      { test_id: 'B311', test_name: 'random', issue_severity: 'LOW', issue_confidence: 'HIGH', filename: 'mcp/b.py', line_number: 20, issue_cwe: { id: 330, link: 'https://cwe.mitre.org/data/definitions/330.html' } },
      // CRITICAL is NOT a Bandit severity level → unknown band → info (never dropped); no more_info/cwe → empty resources
      { test_id: 'B999', test_name: 'synthetic_unknown', issue_severity: 'CRITICAL', issue_confidence: 'LOW', filename: 'mcp/c.py', line_number: 30, issue_text: 'a synthetic out-of-range severity' },
    ],
  }
  const { findings } = ingestBandit(raw)
  assert.equal(findings.length, 3) // none dropped
  const byRule = Object.fromEntries(findings.map((f) => [f.ruleId, f]))
  assert.equal(byRule.B602.adjusted_severity, 'high') // HIGH → high
  assert.ok(byRule.B602.verdict_reasoning.includes('https://bandit.example/b602'), 'more_info URL preferred for resources')
  assert.equal(byRule.B602.dimension, 'injection-xss') // issue_cwe.id 78 routes — the bandit integer-shape proof for CWE-78
  assert.equal(byRule.B311.dimension, 'external-sast') // issue_cwe.id 330 is not allowlisted — stays put
  assert.equal(byRule.B311.adjusted_severity, 'low') // LOW → low
  assert.ok(byRule.B311.verdict_reasoning.includes('https://cwe.mitre.org/data/definitions/330.html'), 'issue_cwe.link is the fallback when no more_info')
  assert.equal(byRule.B999.adjusted_severity, 'info') // unknown CRITICAL → info, never dropped
})

check('BN-hygiene: test-path LOW (B101 assert / B404 import under tests/) filtered at ingest; prod-LOW + MEDIUM + test-path HIGH kept; ONE aggregated note', () => {
  // The cold-run separating axis is PATH × band — NOT a severity floor (a blanket
  // "drop bandit LOW" would kill the prod-path B105 hardcoded password below, a
  // real-secret honesty violation) and NOT confidence (-iii: B101 is high-confidence).
  const { findings, notes } = ingestBandit(readJSON(BANDIT_HYG))
  // MUTATION: removing the hygieneNoise guard in the ingest core loop turns this red first (5 kept, not 3)
  assert.deepEqual(findings.map((f) => f.ruleId).sort(), ['B105', 'B602', 'B608'])
  assert.ok(findings.some((f) => f.ruleId === 'B105' && f.adjusted_severity === 'low' && f.file.includes('mcp/app.py')),
    'prod-path LOW B105 (hardcoded password) MUST survive — the honesty case')
  assert.ok(findings.some((f) => f.ruleId === 'B602' && f.adjusted_severity === 'high' && f.file.includes('tests/')),
    'a test-path HIGH survives — only the LOW band is hygiene')
  assert.ok(findings.some((f) => f.ruleId === 'B608' && f.adjusted_severity === 'medium'),
    'a prod MEDIUM survives untouched')
  const hyg = notes.filter((n) => /test-path .*hygiene|filtered as non-security noise/.test(n))
  assert.equal(hyg.length, 1, 'ONE aggregated note per ingest, never one-per-hit')
  assert.match(hyg[0], /bandit: 2 test-path LOW hygiene hit\(s\)/)
  // BN-adapter-contract intact: hygieneNoise is a DISTINCT hook — securityRelevant stays undefined
  assert.equal(banditAdapter.securityRelevant, undefined)
})

check('BN-hygiene-anchoring: the predicate is SEGMENT-anchored — latest/, contest/, mytest.py are NOT test paths; tests/, test_*.py, *_test.py, conftest.py, __tests__/ are', () => {
  const mk = (filename) => ({ test_id: 'B101', test_name: 'assert_used', issue_severity: 'LOW', issue_confidence: 'HIGH', filename, line_number: 1, issue_text: 'Use of assert detected.' })
  // clean side: substring lookalikes must NOT be filtered (the FP guard on the path axis)
  const kept = ingestBandit({ results: [mk('latest/util.py'), mk('contest/entry.py'), mk('src/mytest.py')] }).findings
  assert.equal(kept.length, 3, 'latest/, contest/, mytest.py are NOT test paths')
  // fires side: every documented test-path shape is filtered at LOW
  const { findings: dropped, notes } = ingestBandit({ results: [mk('pkg/tests/util.py'), mk('src/test_util.py'), mk('src/util_test.py'), mk('src/conftest.py'), mk('a/__tests__/x.py')] })
  assert.equal(dropped.length, 0, 'segment tests/ + test_*.py + *_test.py + conftest.py + __tests__/ filter at LOW')
  assert.ok(notes.some((n) => /5 test-path LOW hygiene hit\(s\)/.test(n)), 'the aggregated note carries the count')
})

check('BN-severity-FROM-TOOL-BAND: mutating issue_severity MEDIUM→HIGH MOVES the band medium→high (the tool→band behaviour, same as SG)', () => {
  // For Bandit (like Semgrep) the tool severity DOES drive the band. For Code-Analyzer/Checkov it
  // must NOT (class-severity, see S1 / CK-severity-from-class). The divergence is the tool→band point.
  const base = ingestBandit(readJSON(BANDIT)).findings
  assert.ok(base.every((f) => f.adjusted_severity === 'medium')) // all MEDIUM → medium
  const raw = clone(readJSON(BANDIT))
  for (const r of raw.results) r.issue_severity = 'HIGH' // MEDIUM → HIGH
  const bumped = ingestBandit(raw).findings
  assert.ok(bumped.every((f) => f.adjusted_severity === 'high'), 'HIGH must move the band to high — the tool band drives Bandit severity')
})

check('BN-no-class / classify: classify() is the constant null, no securityRelevant, finding carries no `class`', () => {
  assert.equal(banditAdapter.classify('x'), null)
  assert.equal(banditAdapter.classify('B608'), null)
  assert.equal(banditAdapter.securityRelevant, undefined) // security-by-construction — no tag filter
  const f = ingestBandit(readJSON(BANDIT)).findings[0]
  assert.ok(!('class' in f), 'a Bandit finding owns no class → supersedes nothing (Phase-2b dedup deferred)')
})

check('BN-sev-map: BANDIT_SEVERITY_TO_FINDING is exactly HIGH→high / MEDIUM→medium / LOW→low', () => {
  assert.deepEqual(BANDIT_SEVERITY_TO_FINDING, { HIGH: 'high', MEDIUM: 'medium', LOW: 'low' })
})

check('BN-fail-safe: collect() missing → null; parse(null/{}/{results:null}/{results:[]}) → []; a result missing line_number/test_id is handled; ingest(null) → 0 + note', () => {
  assert.equal(banditAdapter.collect({ input: join(tmpdir(), 'definitely-not-here-bandit.json') }), null)
  assert.deepEqual(banditAdapter.parse(null), [])
  assert.deepEqual(banditAdapter.parse({}), [])
  assert.deepEqual(banditAdapter.parse({ results: null }), [])
  assert.deepEqual(banditAdapter.parse({ results: [] }), [])
  // a result with no test_id is skipped in parse; one with no line_number still parses (no crash)
  const hits = banditAdapter.parse({ results: [{ filename: 'a.py', issue_severity: 'MEDIUM' }, { test_id: 'B1', filename: 'a.py', issue_severity: 'MEDIUM' }] })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].startLine, null)
  assert.equal(hits[0].message, '') // no issue_text/test_name → ''
  assert.equal(hits[0].bandFromTool, 'medium')
  const { findings, notes } = ingestBandit(null)
  assert.equal(findings.length, 0)
  assert.ok(notes.some((n) => /no input collected/.test(n)))
})

check('BN-merge-idempotent: ingest the fixture twice into a ledger → no dupes; a pre-existing llm finding survives', () => {
  const llm = {
    id: 'e'.repeat(16),
    dimension: 'oauth-identity',
    title: 'pre-existing llm-inferred finding',
    severity: 'high',
    adjusted_severity: 'high',
    file: 'mcp/server.py:5',
    status: 'confirmed',
    first_seen: 1,
    last_seen: 1,
    verdict: 'confirmed_real',
    verdict_reasoning: 'reasoned over the code',
  }
  const ledger = { schema_version: '1', findings: [llm], passes: [] }
  const bn = ingestBandit(readJSON(BANDIT)).findings
  const r1 = mergeFindings(ledger, bn, 1)
  assert.equal(r1.added, 4)
  assert.equal(ledger.findings.length, 5) // 1 llm + 4 bandit
  const r2 = mergeFindings(ledger, bn, 1)
  assert.equal(r2.added, 0)
  assert.equal(ledger.findings.length, 5) // idempotent — no dupes
  assert.ok(ledger.findings.some((f) => f.id === 'e'.repeat(16) && !('provenance' in f)))
})

check('BN-schema: a Bandit finding (no class, CWE-routed dimension injection-xss) validates against $defs/finding', () => {
  const f = ingestBandit(readJSON(BANDIT)).findings[0]
  assert.deepEqual(validateFinding(f), [])
})

check('BN-CLI: --scanner bandit --input <fixture> --json --dry-run prints valid JSON with the anchor; exit 0', () => {
  const out = execFileSync(
    'node',
    [CLI, '--scanner', 'bandit', '--input', BANDIT, '--target', join(tmpdir(), 'nope-bn'), '--dry-run', '--json'],
    { encoding: 'utf8' }
  )
  const parsed = JSON.parse(out)
  assert.equal(parsed.scanner, 'bandit')
  assert.equal(parsed.kind, 'file-parser')
  assert.equal(parsed.merged, null) // dry-run
  assert.ok(parsed.findings.some((f) => f.ruleId === 'B608' && f.file.endsWith('mcp/server.py:46') && f.adjusted_severity === 'medium'))
})

check('BN-CLI-merge: --scanner bandit writes the deterministic findings to the target ledger + is idempotent', () => {
  const d = mkdtempSync(join(tmpdir(), 'ingest-cli-bn-'))
  dirs.push(d)
  const lp = join(d, '.security-review', 'audit-ledger.json')
  execFileSync('node', [CLI, '--scanner', 'bandit', '--input', BANDIT, '--target', d], { encoding: 'utf8' })
  const l1 = readJSON(lp)
  const bn1 = l1.findings.filter((f) => f.engine === 'bandit')
  assert.equal(bn1.length, 4)
  assert.ok(bn1.every((f) => f.adjusted_severity === 'medium' && f.provenance === 'deterministic'))
  execFileSync('node', [CLI, '--scanner', 'bandit', '--input', BANDIT, '--target', d], { encoding: 'utf8' })
  const l2 = readJSON(lp)
  assert.equal(l2.findings.filter((f) => f.engine === 'bandit').length, 4) // idempotent — no dupes
})

// ───────────────────────────────────── CWE→dimension routing (B5 · E0.1b — semgrep + bandit)
// An external-SAST hit the scanner already labelled with a fixture-proven injection CWE (89
// SQL/SOQL, 78 OS command) files under the REAL `injection-xss` methodology dimension instead of
// the catch-all 'external-sast' grouping label. The routing key is EXACT integer-CWE membership
// over INJECTION_XSS_CWES — never a substring / rule-name / message match — and it moves ONLY the
// `dimension` (the review heading): gate, band, id, and reasoning are untouched, and classify()
// stays null on both adapters, so a routed finding owns no class and supersedes nothing (the
// RD-non-supersession posture, ported here as INJ-non-supersession). The positive anchors live in
// SG-anchor-ERROR / SG-RP1 / BN-anchor / BN-count above; this section holds the allowlist unit,
// the negative-routing (FP) guards, and the non-supersession standing lock.

check('INJ-allowlist: INJECTION_XSS_CWES is exactly {78,79,89,90,94,95,96,643,943} (each fixture-proven); dimensionForCwes is EXACT integer membership over the real captured shapes — never substring; fixture-pending + malformed/absent → external-sast, no throw', () => {
  assert.deepEqual([...INJECTION_XSS_CWES].sort((a, b) => a - b), [78, 79, 89, 90, 94, 95, 96, 643, 943])
  // the real captured shapes: bandit integer id / njsscan+semgrep titled string / semgrep titled-array
  assert.equal(dimensionForCwes(89), 'injection-xss') // bandit int
  assert.equal(dimensionForCwes('CWE-89'), 'injection-xss')
  assert.equal(dimensionForCwes(['CWE-78: Improper Neutralization of Special Elements used in an OS Command']), 'injection-xss')
  // the EXPANDED taxonomy — each id proven by a generated fixture (see INJ-fixture-*)
  assert.equal(dimensionForCwes("CWE-79: Improper Neutralization of Input During Web Page Generation ('Cross-site Scripting')"), 'injection-xss') // XSS (njsscan/semgrep)
  assert.equal(dimensionForCwes(94), 'injection-xss') // code injection (bandit B701 integer id)
  assert.equal(dimensionForCwes("CWE-95: Improper Neutralization of Directives in Dynamically Evaluated Code ('Eval Injection')"), 'injection-xss') // eval (njsscan/semgrep)
  assert.equal(dimensionForCwes(['CWE-96: Improper Neutralization of Directives in Statically Saved Code']), 'injection-xss') // SSTI (semgrep)
  assert.equal(dimensionForCwes('CWE-943: Improper Neutralization of Special Elements in Data Query Logic'), 'injection-xss') // NoSQL (njsscan)
  // XPath (643) + LDAP (90) — PROMOTED in E0.1e-A once genuine Java/C#/Node fixtures emitted each
  // (see XPATHLDAP-fixture-*). The real captured shapes: semgrep titled-array + njsscan titled string.
  assert.equal(dimensionForCwes(["CWE-643: Improper Neutralization of Data within XPath Expressions ('XPath Injection')"]), 'injection-xss') // XPath (semgrep java/csharp + njsscan node)
  assert.equal(dimensionForCwes("CWE-643: Improper Neutralization of Data within XPath Expressions ('XPath Injection')"), 'injection-xss') // XPath (njsscan titled string)
  assert.equal(dimensionForCwes(["CWE-90: Improper Neutralization of Special Elements used in an LDAP Query ('LDAP Injection')"]), 'injection-xss') // LDAP (semgrep java/csharp)
  // EXACT membership, not substring: a longer/shorter neighbour must NOT read as an active id
  // (incl. the newly-active 90 → 900/9 traps and 643 → 6430/64 traps)
  for (const trap of ['CWE-789', ['CWE-8'], 'CWE-790', 'CWE-940', 'CWE-9430', 'CWE-960', 'CWE-900', ['CWE-9'], 'CWE-6430', 'CWE-64']) {
    assert.equal(dimensionForCwes(trap), 'external-sast', `substring trap ${JSON.stringify(trap)} must NOT route`)
  }
  // co-resident non-injection CWEs (fixtures) + fixture-pending ids all stay external-sast:
  // 939 URL-scheme-authz · 352 CSRF · 918 SSRF (→data-export) · 22 path-traversal (→data-export) ·
  // 798 secrets · 693 protection-mechanism · 605 · 20 (bandit's XXE tag) · 328 (weak-hash MD5, the
  // xpath-ldap fixture's co-resident negative) · the fixture-pending injection 91/917/1336 · and the
  // fixture-pending deser 1321. (611/502/915 no longer stay here — they route to
  // untrusted-deserialization as of 0.8.62; 90/643 no longer stay here — they route to injection-xss
  // as of 0.8.63/E0.1e-A; see the DESER-routing and XPATHLDAP-routing sections.)
  for (const kept of [
    939, 352, 918, 22, 798, 693, 605, 20, 328, 91, 917, 1336, 1321,
    'CWE-939: Improper Authorization in Handler for Custom URL Scheme', 'CWE-352: Cross-Site Request Forgery (CSRF)', 'CWE-22',
  ]) {
    assert.equal(dimensionForCwes(kept), 'external-sast', `CWE ${kept} must stay external-sast`)
  }
  // malformed / absent → the current default, never a throw
  for (const junk of [null, undefined, '', 'not-a-cwe', {}, [], ['x', null], NaN, -89, 89.5]) {
    assert.equal(dimensionForCwes(junk), 'external-sast')
  }
  // behavior-identity (the refactor proof): CWE_TO_DIMENSION maps EVERY injection id to
  // 'injection-xss', and INJECTION_XSS_CWES is EXACTLY the injection subset of the map — the two
  // can never drift, so the map is a byte-behavior-identical replacement for the pre-0.8.62 Set.
  for (const id of INJECTION_XSS_CWES) assert.equal(CWE_TO_DIMENSION[id], 'injection-xss', `map row ${id} must be injection-xss`)
  const injectionSubset = Object.entries(CWE_TO_DIMENSION)
    .filter(([, dim]) => dim === 'injection-xss')
    .map(([cwe]) => Number(cwe))
  assert.deepEqual(injectionSubset.sort((a, b) => a - b), [...INJECTION_XSS_CWES].sort((a, b) => a - b))
})

check('INJ-negative-semgrep: dynamic-urllib (CWE-939, custom-URL-scheme authorization) stays external-sast — the FP guard against substring/rule-name routing', () => {
  const { findings } = ingestSemgrep(readJSON(SEMGREP_WARN))
  const urllib = findings.filter((f) => f.ruleId === URLLIB_RULE)
  assert.equal(urllib.length, 2)
  for (const f of urllib) assert.equal(f.dimension, 'external-sast', `${f.file} must NOT route to injection-xss`)
})

check('INJ-negative-bandit: B310 (CWE-22 path traversal) ×2 and B104 (CWE-605) stay external-sast — only the exact allowlisted CWEs route', () => {
  const { findings } = ingestBandit(readJSON(BANDIT))
  const kept = findings.filter((f) => f.ruleId !== 'B608')
  assert.equal(kept.length, 3)
  for (const f of kept) assert.equal(f.dimension, 'external-sast', `${f.ruleId} must NOT route to injection-xss`)
})

check('INJ-non-supersession (the standing lock, the RD posture ported): a routed deterministic injection-xss finding does NOT supersede a co-located llm-inferred injection-xss finding of a DIFFERENT injection shape', () => {
  const det = ingestSemgrep(readJSON(SEMGREP_ERR)).findings[0] // CWE-78 → injection-xss @ server/index.js:28
  assert.equal(det.provenance, 'deterministic')
  assert.equal(det.dimension, 'injection-xss')
  // an llm-inferred injection-xss finding of a DIFFERENT SHAPE (a missing-output-encoding / XSS
  // shape — a shape no OS-command CWE describes), same file, overlapping lines
  const llm = {
    id: '5'.repeat(16),
    dimension: 'injection-xss',
    title: 'Response interpolates request input without output encoding',
    severity: 'high',
    adjusted_severity: 'high',
    file: 'server/index.js:20-40', // overlaps det's :28
    status: 'confirmed',
    first_seen: 1,
    last_seen: 1,
    verdict: 'confirmed_real',
    verdict_reasoning: 'reasoned over the response-templating path',
  }
  // PRECONDITIONS that WOULD fire supersession if the adapter owned a class: same dimension +
  // same locus. Asserting them keeps the guard sharp — the ONLY missing ingredient is the owned
  // class (classify()→null). MUTATION: adding a CLASS_DEFS['injection-xss'] entry + classify()
  // →'injection-xss' turns THIS red at `superseded === 0` (the supersession visibly FIRES),
  // proving the protection is the null classify, not an accident.
  assert.equal(det.dimension, llm.dimension, 'same dimension (the sameOwnedClass fallback signal)')
  assert.equal(sameLocation(det, llm), true, 'overlapping locus (the other supersession signal)')
  const { findings, superseded, supersededIds } = reconcileProvenance([det, llm])
  assert.equal(superseded, 0, 'the LLM output-encoding finding is NOT superseded — the routed SAST row sits beside it')
  assert.deepEqual(supersededIds, [])
  assert.equal(findings.find((f) => f.id === llm.id).status, 'confirmed') // status unchanged
  assert.equal(findings.find((f) => f.id === det.id).status, 'confirmed')
  // the guard itself, asserted LAST so a class-owning mutation fails first at "superseded === 0"
  assert.equal('class' in det, false, 'no owned class on the routed deterministic finding')
})

// ───────────────────────────────────── njsscan (Phase 2 · 2a #4 — Node SAST, tool→band)
// The THIRD tool→band adapter and the FIRST with a DIFFERENT input shape: njsscan's JSON is a
// NESTED OBJECT (`{nodejs:{…},templates:{…}}` keyed by rule_id), NOT a flat `results[]` — so it
// needs its own `parse`, but everything downstream (the bandFromTool path, external-sast, classify
// → null) is the established tool→band pattern. The real fixture covers BOTH severities: node_secret
// (ERROR → high) and helmet_feature_disabled (WARNING → medium). The templates-section, multi-file,
// and INFO/unknown band cases use small INLINE synthetic input.
const ingestNjsscan = (raw) => ingest(raw, njsscanAdapter, { repoRoot: '', pass: 1 })

check('NJ-determinism: ingest the real njsscan fixture twice → byte-identical findings', () => {
  const a = ingestNjsscan(readJSON(NJSSCAN)).findings
  const b = ingestNjsscan(readJSON(NJSSCAN)).findings
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})

check('NJ-anchor-ERROR: node_secret (severity ERROR, CWE-798) → deterministic/njsscan/external-sast/HIGH, server/index.js:23, NO class, CWE URL in reasoning', () => {
  const { findings } = ingestNjsscan(readJSON(NJSSCAN))
  const f = findById(findings, (x) => x.ruleId === 'node_secret')
  assert.ok(f, 'the node_secret ERROR anchor is not present')
  assert.equal(f.provenance, 'deterministic')
  assert.equal(f.engine, 'njsscan')
  assert.equal(f.ruleId, 'node_secret')
  assert.equal(f.dimension, 'external-sast')
  assert.equal(f.adjusted_severity, 'high') // ERROR → high (the TOOL band, not a class)
  assert.equal(f.status, 'confirmed')
  assert.equal(f.class, undefined) // owns NO toolkit class
  assert.ok(!('class' in f), 'an njsscan finding must carry no `class` key')
  assert.ok(f.file.endsWith('server/index.js:23'), `file was ${f.file}`) // match_lines[0] = 23
  assert.match(f.id, /^[0-9a-f]{16}$/)
  // the CWE reference URL is DERIVED from the "CWE-798: …" prefix, not present verbatim in the fixture
  assert.ok(f.verdict_reasoning.includes('https://cwe.mitre.org/data/definitions/798.html'), 'the derived CWE-798 URL must appear in verdict_reasoning')
})

check('NJ-anchor-WARNING: helmet_feature_disabled (severity WARNING, CWE-693) → MEDIUM, server/index.js:14', () => {
  const { findings } = ingestNjsscan(readJSON(NJSSCAN))
  const f = findById(findings, (x) => x.ruleId === 'helmet_feature_disabled')
  assert.ok(f, 'the helmet_feature_disabled WARNING anchor is not present')
  assert.equal(f.engine, 'njsscan')
  assert.equal(f.adjusted_severity, 'medium') // WARNING → medium (the TOOL band)
  assert.equal(f.dimension, 'external-sast')
  assert.ok(f.file.endsWith('server/index.js:14'), `file was ${f.file}`) // match_lines[0] = 14
  assert.equal(f.class, undefined)
  assert.ok(f.verdict_reasoning.includes('https://cwe.mitre.org/data/definitions/693.html'), 'the derived CWE-693 URL must appear in verdict_reasoning')
})

check('NJ-count: the real fixture → exactly 2 findings (node_secret high + helmet_feature_disabled medium)', () => {
  const { findings } = ingestNjsscan(readJSON(NJSSCAN))
  assert.equal(findings.length, 2)
  assert.ok(findings.every((f) => f.engine === 'njsscan' && f.dimension === 'external-sast'))
  const bySev = Object.fromEntries(findings.map((f) => [f.ruleId, f.adjusted_severity]))
  assert.deepEqual(bySev, { node_secret: 'high', helmet_feature_disabled: 'medium' })
})

check('NJ-templates-section: an inline finding under `templates` (not `nodejs`) is ingested — BOTH sections are read', () => {
  const raw = {
    errors: [],
    njsscan_version: '0.4.3',
    nodejs: {},
    templates: {
      template_xss: {
        files: [{ file_path: 'views/profile.hbs', match_lines: [5, 5], match_position: [1, 9] }],
        metadata: { cwe: 'CWE-79: Improper Neutralization of Input', description: 'Unescaped template output', 'owasp-web': 'A7', severity: 'WARNING' },
      },
    },
  }
  const { findings } = ingestNjsscan(raw)
  assert.equal(findings.length, 1)
  assert.equal(findings[0].ruleId, 'template_xss')
  assert.equal(findings[0].adjusted_severity, 'medium')
  assert.ok(findings[0].file.endsWith('views/profile.hbs:5'), `file was ${findings[0].file}`)
})

check('NJ-multi-file: one rule with 2 entries in `files` (distinct file_path/lines) → 2 distinct findings', () => {
  const raw = {
    nodejs: {
      path_traversal: {
        files: [
          { file_path: 'server/a.js', match_lines: [10, 10], match_position: [1, 2] },
          { file_path: 'server/b.js', match_lines: [20, 22], match_position: [1, 2] },
        ],
        metadata: { cwe: 'CWE-22: Path Traversal', description: 'Path traversal sink', severity: 'ERROR' },
      },
    },
    templates: {},
  }
  const { findings } = ingestNjsscan(raw)
  assert.equal(findings.length, 2)
  assert.notEqual(findings[0].id, findings[1].id)
  assert.ok(findings.every((f) => f.ruleId === 'path_traversal' && f.adjusted_severity === 'high'))
  const files = findings.map((f) => f.file).sort()
  assert.ok(files.some((p) => p.endsWith('server/a.js:10')))
  assert.ok(files.some((p) => p.endsWith('server/b.js:20'))) // match_lines[0] = 20
})

check('NJ-band/unknown (inline synthetic): INFO→low, CRITICAL(not a real njsscan level)→info-never-dropped', () => {
  const raw = {
    nodejs: {
      info_rule: {
        files: [{ file_path: 'server/a.js', match_lines: [1, 1] }],
        metadata: { cwe: 'CWE-1004: x', description: 'an info-level note', severity: 'INFO' },
      },
      crit_rule: {
        files: [{ file_path: 'server/b.js', match_lines: [2, 2] }],
        metadata: { cwe: 'CWE-2: y', description: 'a synthetic out-of-range severity', severity: 'CRITICAL' },
      },
    },
    templates: {},
  }
  const { findings } = ingestNjsscan(raw)
  assert.equal(findings.length, 2) // none dropped
  const byRule = Object.fromEntries(findings.map((f) => [f.ruleId, f]))
  assert.equal(byRule.info_rule.adjusted_severity, 'low') // INFO → low
  assert.equal(byRule.crit_rule.adjusted_severity, 'info') // unknown CRITICAL → info, never dropped
})

check('NJ-severity-FROM-TOOL-BAND: mutating metadata.severity WARNING→ERROR MOVES the band medium→high (the tool→band behaviour, same as SG/BN)', () => {
  // For njsscan (like Semgrep/Bandit) the tool severity DOES drive the band. For Code-Analyzer/Checkov
  // it must NOT (class-severity, see S1 / CK-severity-from-class). The divergence is the tool→band point.
  const base = ingestNjsscan(readJSON(NJSSCAN)).findings
  const helmet = findById(base, (f) => f.ruleId === 'helmet_feature_disabled')
  assert.equal(helmet.adjusted_severity, 'medium') // WARNING → medium
  const raw = clone(readJSON(NJSSCAN))
  raw.nodejs.helmet_feature_disabled.metadata.severity = 'ERROR' // WARNING → ERROR
  const bumped = findById(ingestNjsscan(raw).findings, (f) => f.ruleId === 'helmet_feature_disabled')
  assert.equal(bumped.adjusted_severity, 'high', 'ERROR must move the band to high — the tool band drives njsscan severity')
})

check('NJ-no-class / classify: classify() is the constant null, no securityRelevant, finding carries no `class`', () => {
  assert.equal(njsscanAdapter.classify('x'), null)
  assert.equal(njsscanAdapter.classify('node_secret'), null)
  assert.equal(njsscanAdapter.securityRelevant, undefined) // security-by-construction — no tag filter
  const f = ingestNjsscan(readJSON(NJSSCAN)).findings[0]
  assert.ok(!('class' in f), 'an njsscan finding owns no class → supersedes nothing (Phase-2b dedup deferred)')
})

check('NJ-sev-map: NJSSCAN_SEVERITY_TO_FINDING is exactly ERROR→high / WARNING→medium / INFO→low', () => {
  assert.deepEqual(NJSSCAN_SEVERITY_TO_FINDING, { ERROR: 'high', WARNING: 'medium', INFO: 'low' })
})

check('NJ-no-cwe: a rule whose metadata.cwe is missing or non-CWE → resources:[], no crash, still ingested', () => {
  const raw = {
    nodejs: {
      missing_cwe: {
        files: [{ file_path: 'server/a.js', match_lines: [3, 3] }],
        metadata: { description: 'no cwe field at all', severity: 'WARNING' },
      },
      non_cwe: {
        files: [{ file_path: 'server/b.js', match_lines: [4, 4] }],
        metadata: { cwe: 'not-a-cwe-string', description: 'cwe present but no CWE-### prefix', severity: 'ERROR' },
      },
    },
    templates: {},
  }
  const hits = njsscanAdapter.parse(raw)
  assert.equal(hits.length, 2)
  for (const h of hits) assert.deepEqual(h.resources, []) // no derivable CWE → no resource
  const { findings } = ingestNjsscan(raw)
  assert.equal(findings.length, 2) // still ingested
  assert.deepEqual(findings.map((f) => f.adjusted_severity).sort(), ['high', 'medium'])
})

check('NJ-fail-safe: collect() missing → null; defensive parse over every degenerate shape → []/skip; ingest(null) → 0 + note', () => {
  assert.equal(njsscanAdapter.collect({ input: join(tmpdir(), 'definitely-not-here-njsscan.json') }), null)
  assert.deepEqual(njsscanAdapter.parse(null), [])
  assert.deepEqual(njsscanAdapter.parse({}), [])
  assert.deepEqual(njsscanAdapter.parse({ nodejs: null }), [])
  assert.deepEqual(njsscanAdapter.parse({ nodejs: {} }), [])
  assert.deepEqual(njsscanAdapter.parse({ nodejs: 'not-an-object' }), [])
  assert.deepEqual(njsscanAdapter.parse({ nodejs: { r: null } }), []) // a null rule object → skipped
  assert.deepEqual(njsscanAdapter.parse({ nodejs: { r: { metadata: { severity: 'ERROR' } } } }), []) // no files → []
  assert.deepEqual(njsscanAdapter.parse({ nodejs: { r: { files: 'nope', metadata: {} } } }), []) // non-array files → []
  assert.deepEqual(njsscanAdapter.parse({ nodejs: { r: { files: [{ match_lines: [1, 1] }], metadata: { severity: 'ERROR' } } } }), []) // a file with no file_path → skipped
  const { findings, notes } = ingestNjsscan(null)
  assert.equal(findings.length, 0)
  assert.ok(notes.some((n) => /no input collected/.test(n)))
})

check('NJ-merge-idempotent: ingest the fixture twice into a ledger → no dupes; a pre-existing llm finding survives', () => {
  const llm = {
    id: 'f'.repeat(16),
    dimension: 'oauth-identity',
    title: 'pre-existing llm-inferred finding',
    severity: 'high',
    adjusted_severity: 'high',
    file: 'server/index.js:5',
    status: 'confirmed',
    first_seen: 1,
    last_seen: 1,
    verdict: 'confirmed_real',
    verdict_reasoning: 'reasoned over the code',
  }
  const ledger = { schema_version: '1', findings: [llm], passes: [] }
  const nj = ingestNjsscan(readJSON(NJSSCAN)).findings
  const r1 = mergeFindings(ledger, nj, 1)
  assert.equal(r1.added, 2)
  assert.equal(ledger.findings.length, 3) // 1 llm + 2 njsscan
  const r2 = mergeFindings(ledger, nj, 1)
  assert.equal(r2.added, 0)
  assert.equal(ledger.findings.length, 3) // idempotent — no dupes
  assert.ok(ledger.findings.some((f) => f.id === 'f'.repeat(16) && !('provenance' in f)))
})

check('NJ-schema: an njsscan finding (no class, dimension external-sast) validates against $defs/finding', () => {
  const f = ingestNjsscan(readJSON(NJSSCAN)).findings[0]
  assert.deepEqual(validateFinding(f), [])
})

check('NJ-CLI: --scanner njsscan --input <fixture> --json --dry-run prints valid JSON with the anchor; exit 0', () => {
  const out = execFileSync(
    'node',
    [CLI, '--scanner', 'njsscan', '--input', NJSSCAN, '--target', join(tmpdir(), 'nope-nj'), '--dry-run', '--json'],
    { encoding: 'utf8' }
  )
  const parsed = JSON.parse(out)
  assert.equal(parsed.scanner, 'njsscan')
  assert.equal(parsed.kind, 'file-parser')
  assert.equal(parsed.merged, null) // dry-run
  assert.ok(parsed.findings.some((f) => f.ruleId === 'node_secret' && f.file.endsWith('server/index.js:23') && f.adjusted_severity === 'high'))
})

check('NJ-CLI-merge: --scanner njsscan writes the deterministic findings to the target ledger + is idempotent', () => {
  const d = mkdtempSync(join(tmpdir(), 'ingest-cli-nj-'))
  dirs.push(d)
  const lp = join(d, '.security-review', 'audit-ledger.json')
  execFileSync('node', [CLI, '--scanner', 'njsscan', '--input', NJSSCAN, '--target', d], { encoding: 'utf8' })
  const l1 = readJSON(lp)
  const nj1 = l1.findings.filter((f) => f.engine === 'njsscan')
  assert.equal(nj1.length, 2)
  assert.ok(nj1.every((f) => f.provenance === 'deterministic'))
  assert.deepEqual(nj1.map((f) => f.adjusted_severity).sort(), ['high', 'medium'])
  execFileSync('node', [CLI, '--scanner', 'njsscan', '--input', NJSSCAN, '--target', d], { encoding: 'utf8' })
  const l2 = readJSON(lp)
  assert.equal(l2.findings.filter((f) => f.engine === 'njsscan').length, 2) // idempotent — no dupes
})

// ───────────────────────────── generated-fixture injection routing (B5 · E0.1b-EXPAND, 0.8.59)
// The allowlist EXPANDED from {78,89} to the full injection taxonomy the OSS scanners actually emit
// on minimal seeded samples, and njsscan JOINED semgrep/bandit as a CWE-routed adapter. Each new
// active id is proven by a GENUINE captured scanner fixture (semgrep 1.168.0 / bandit 1.9.4 /
// njsscan 0.4.2), not by the CWE this test names — the fixture is the source of truth. Placed after
// the njsscan section because these lean on ingestNjsscan (defined above; `check` runs eagerly).
// RULE-PATH-PROVEN, not class-proven: a green fixture proves the router handles the ONE rule that
// fired on the seed; a partner hitting the same class through a rule with absent/different CWE
// metadata can still land in external-sast. (Sub-classes 643 XPath / 90 LDAP / 91 XML-injection /
// 917·1336 EL stayed fixture-pending — no OSS rule emitted those ids on a minimal seed.)
const NJSSCAN_INJ = join(FIX, 'njsscan-injection-seeded.json') // njsscan 0.4.2: express_xss 79 + eval_nodejs 95 + node_nosqli_js_injection 943
const SEMGREP_INJ = join(FIX, 'semgrep-injection-seeded.json') // semgrep 1.168.0: render-template-string 96 + raw-html-format/direct-response-write 79 (positives) + express-check-csurf-middleware-usage 352 CSRF (co-resident NEGATIVE)
const BANDIT_INJ = join(FIX, 'bandit-injection-seeded.json') // bandit 1.9.4: B701 jinja2_autoescape_false issue_cwe.id 94

check('INJ-fixture-njsscan: the generated njsscan fixture routes XSS(79) / eval(95) / NoSQL(943) to injection-xss — the njsscan wiring proof; each carries the derived CWE URL for the id the tool emitted', () => {
  const { findings } = ingestNjsscan(readJSON(NJSSCAN_INJ))
  assert.equal(findings.length, 3)
  const byRule = Object.fromEntries(findings.map((f) => [f.ruleId, f]))
  for (const f of findings) assert.equal(f.dimension, 'injection-xss', `${f.ruleId} must route to injection-xss`) // njsscan wiring
  assert.ok(byRule.express_xss.verdict_reasoning.includes('https://cwe.mitre.org/data/definitions/79.html'), 'XSS carries CWE-79')
  assert.ok(byRule.eval_nodejs.verdict_reasoning.includes('https://cwe.mitre.org/data/definitions/95.html'), 'eval carries CWE-95')
  assert.ok(byRule.node_nosqli_js_injection.verdict_reasoning.includes('https://cwe.mitre.org/data/definitions/943.html'), 'NoSQL carries CWE-943')
  for (const f of findings) assert.ok(!('class' in f), 'routing only — no owned class') // classify() stays null
})

check('INJ-njsscan-negative: a non-injection njsscan finding (node_secret CWE-798, helmet_feature_disabled CWE-693) stays external-sast — wiring njsscan did NOT blanket-route it', () => {
  const { findings } = ingestNjsscan(readJSON(NJSSCAN))
  assert.equal(findings.length, 2)
  for (const f of findings) assert.equal(f.dimension, 'external-sast', `${f.ruleId} (non-injection) must NOT route`)
})

check('INJ-fixture-semgrep: the generated semgrep fixture routes SSTI(96) + XSS(79) to injection-xss; the co-resident CSRF(352) stays external-sast — the exact-id negative on a fresh capture', () => {
  const { findings } = ingestSemgrep(readJSON(SEMGREP_INJ))
  const ssti = findings.find((f) => f.ruleId.endsWith('render-template-string'))
  assert.ok(ssti, 'render-template-string (CWE-96) present')
  assert.equal(ssti.dimension, 'injection-xss') // CWE-96 routes
  const xss = findings.filter((f) => f.ruleId.endsWith('raw-html-format') || f.ruleId.endsWith('direct-response-write'))
  assert.ok(xss.length >= 1, 'at least one XSS (CWE-79) finding present')
  for (const f of xss) assert.equal(f.dimension, 'injection-xss', `${f.ruleId} (CWE-79) must route`)
  const csrf = findings.find((f) => f.ruleId.endsWith('express-check-csurf-middleware-usage'))
  assert.ok(csrf, 'the co-resident CSRF finding is present')
  assert.equal(csrf.dimension, 'external-sast') // CWE-352 CSRF is NOT injection — stays external-sast
  for (const f of findings) assert.ok(!('class' in f), 'routing only — no owned class')
  // belt-and-suspenders: the fixture genuinely carries the CWEs this test names (source of truth)
  const raw = readJSON(SEMGREP_INJ)
  const cweOf = (suffix) => raw.results.find((r) => r.check_id.endsWith(suffix)).extra.metadata.cwe
  assert.equal(dimensionForCwes(cweOf('render-template-string')), 'injection-xss')
  assert.equal(dimensionForCwes(cweOf('express-check-csurf-middleware-usage')), 'external-sast')
})

check('INJ-fixture-bandit: the generated bandit fixture routes code injection (B701 jinja2_autoescape_false, issue_cwe.id 94) to injection-xss', () => {
  const raw = readJSON(BANDIT_INJ)
  assert.equal(raw.results[0].issue_cwe.id, 94) // the real captured CWE — the source of truth, not this test's guess
  const { findings } = ingestBandit(raw)
  assert.equal(findings.length, 1)
  assert.equal(findings[0].ruleId, 'B701')
  assert.equal(findings[0].dimension, 'injection-xss') // CWE-94 routes
  assert.equal(findings[0].adjusted_severity, 'high') // tool band unchanged (routing only)
  assert.ok(!('class' in findings[0]), 'routing only — no owned class')
})

check('INJ-non-supersession-new-subclass: a routed NEWLY-ACTIVATED sub-class finding (njsscan express_xss, CWE-79) does NOT supersede a co-located llm injection finding of a DIFFERENT injection shape', () => {
  const det = ingestNjsscan(readJSON(NJSSCAN_INJ)).findings.find((f) => f.ruleId === 'express_xss')
  assert.equal(det.provenance, 'deterministic')
  assert.equal(det.dimension, 'injection-xss') // CWE-79 → injection-xss @ server/xss.js:5
  // an llm injection-xss finding of a DIFFERENT injection SHAPE (a SOQL/SQL query-construction shape
  // — a shape no XSS CWE describes), same file, overlapping lines
  const llm = {
    id: '7'.repeat(16),
    dimension: 'injection-xss',
    title: 'User filter concatenated into a SOQL query',
    severity: 'high',
    adjusted_severity: 'high',
    file: `${det.file.split(':')[0]}:1-40`, // overlaps det's :5
    status: 'confirmed',
    first_seen: 1,
    last_seen: 1,
    verdict: 'confirmed_real',
    verdict_reasoning: 'reasoned over the query-construction path',
  }
  assert.equal(det.dimension, llm.dimension, 'same dimension (the sameOwnedClass fallback signal)')
  assert.equal(sameLocation(det, llm), true, 'overlapping locus (the other supersession signal)')
  // MUTATION: adding CLASS_DEFS['injection-xss'] + classify()→'injection-xss' turns this RED at
  // `superseded === 0` — same lock as INJ-non-supersession, now proven for a newly-added sub-class.
  const { superseded, supersededIds } = reconcileProvenance([det, llm])
  assert.equal(superseded, 0, 'the LLM SOQL-shape finding is NOT superseded by the routed XSS row')
  assert.deepEqual(supersededIds, [])
  assert.equal('class' in det, false, 'no owned class on the routed deterministic finding')
})

// ─────────────────── generated-fixture untrusted-deserialization routing (B5 · E0.1c, 0.8.62)
// The unified CWE_TO_DIMENSION map (the scalability refactor) now files the deser FAMILY under its
// real methodology dimension (methodology/dimensions/untrusted-deserialization.md): native-object
// deserializers (pickle/node-serialize, CWE-502), XXE (CWE-611), and JS prototype pollution
// (CWE-915, as semgrep's prototype-pollution-loop rule actually tags it). Each ACTIVE deser id is
// proven by a GENUINE captured scanner fixture (bandit 1.9.4 / semgrep 1.168.0 / njsscan 0.4.2) —
// never by the CWE a test names; the fixture is the source of truth. classify() stays null on every
// SAST adapter, so a routed deser finding owns no class and supersedes nothing (DESER-non-supersession,
// the RD/INJ posture ported to the multi-shape deser dimension). RULE-PATH-PROVEN, not class-proven:
// a green fixture proves the ONE rule that fired on the seed. HONEST FLOOR: 1321 (prototype pollution's
// specific id) stayed fixture-pending — semgrep emits 915 for prototype-pollution-loop and njsscan
// 0.4.2 has no prototype-pollution rule, so NO OSS rule emitted 1321 on a minimal seed; the Apex
// JSON.deserialize → sObject mass-assignment variant has NO OSS rule at all and stays LLM-residual.
const SEMGREP_DESER = join(FIX, 'semgrep-deser-seeded.json') // semgrep 1.168.0: avoid-pickle 502 + express-third-party-object-deserialization 502 + use-defused-xml 611 + prototype-pollution-loop 915
const BANDIT_DESER = join(FIX, 'bandit-deser-seeded.json') // bandit 1.9.4: B403/B301 pickle issue_cwe.id 502 (positives) + B405/B314 XML issue_cwe.id 20 (co-resident NEGATIVES → external-sast — bandit tags XXE 20, NOT 611)
const NJSSCAN_DESER = join(FIX, 'njsscan-deser-seeded.json') // njsscan 0.4.2: node_deserialize (node-serialize.unserialize) CWE-502

check('DESER-fixture-semgrep: the generated semgrep fixture routes native-deser pickle(502) + node-serialize(502), XXE(611), and prototype pollution(915) ALL to untrusted-deserialization, class-less; the band is the tool band (routing only)', () => {
  const raw = readJSON(SEMGREP_DESER)
  // source of truth: the fixture genuinely carries these CWEs (never a guessed id)
  const cweOf = (suffix) => raw.results.find((r) => r.check_id.endsWith(suffix)).extra.metadata.cwe
  assert.equal(dimensionForCwes(cweOf('avoid-pickle')), 'untrusted-deserialization') // 502 (python pickle)
  assert.equal(dimensionForCwes(cweOf('express-third-party-object-deserialization')), 'untrusted-deserialization') // 502 (node-serialize)
  assert.equal(dimensionForCwes(cweOf('use-defused-xml')), 'untrusted-deserialization') // 611 (XXE)
  assert.equal(dimensionForCwes(cweOf('prototype-pollution-loop')), 'untrusted-deserialization') // 915 (prototype pollution)
  const { findings } = ingestSemgrep(raw)
  assert.equal(findings.length, 4)
  for (const f of findings) {
    assert.equal(f.dimension, 'untrusted-deserialization', `${f.ruleId} must route to untrusted-deserialization`)
    assert.ok(!('class' in f), 'routing only — classify() stays null, no owned class')
  }
  // the band is the tool band, untouched by routing (ERROR→high on the XXE rule, WARNING→medium elsewhere)
  const bySuffix = (s) => findings.find((f) => f.ruleId.endsWith(s))
  assert.equal(bySuffix('use-defused-xml').adjusted_severity, 'high')
  assert.equal(bySuffix('prototype-pollution-loop').adjusted_severity, 'medium')
})

check('DESER-fixture-bandit: pickle (B403 import + B301 loads, issue_cwe.id 502) routes to untrusted-deserialization; the co-resident XML rules (B405/B314, issue_cwe.id 20) STAY external-sast — the exact-id negative on the SAME seed', () => {
  const raw = readJSON(BANDIT_DESER)
  // source of truth: pickle rules tag 502; XML rules tag 20 (bandit tags XXE CWE-20, NOT 611)
  const byId = Object.fromEntries(raw.results.map((r) => [r.test_id, r.issue_cwe.id]))
  assert.equal(byId.B403, 502)
  assert.equal(byId.B301, 502)
  assert.equal(byId.B405, 20)
  assert.equal(byId.B314, 20)
  const { findings } = ingestBandit(raw)
  assert.equal(findings.length, 4)
  const byRule = Object.fromEntries(findings.map((f) => [f.ruleId, f]))
  for (const id of ['B403', 'B301']) {
    assert.equal(byRule[id].dimension, 'untrusted-deserialization', `${id} (pickle CWE-502) must route`)
    assert.ok(!('class' in byRule[id]), 'routing only — no owned class')
  }
  for (const id of ['B405', 'B314']) {
    assert.equal(byRule[id].dimension, 'external-sast', `${id} (XML CWE-20) must stay external-sast`)
  }
})

check('DESER-fixture-njsscan: node_deserialize (node-serialize.unserialize, CWE-502) routes to untrusted-deserialization; carries the derived CWE-502 URL; the tool band (ERROR→high) is untouched', () => {
  const raw = readJSON(NJSSCAN_DESER)
  assert.ok(raw.nodejs.node_deserialize.metadata.cwe.startsWith('CWE-502'), 'source of truth: the njsscan rule tags CWE-502')
  const { findings } = ingestNjsscan(raw)
  assert.equal(findings.length, 1)
  const f = findings[0]
  assert.equal(f.ruleId, 'node_deserialize')
  assert.equal(f.dimension, 'untrusted-deserialization')
  assert.equal(f.adjusted_severity, 'high') // ERROR → high, the tool band, unchanged by routing
  assert.ok(!('class' in f), 'routing only — no owned class')
  assert.ok(f.verdict_reasoning.includes('https://cwe.mitre.org/data/definitions/502.html'), 'the derived CWE-502 URL must appear in verdict_reasoning')
})

check('DESER-cross-adapter: the ONE unified CWE_TO_DIMENSION map routes deser across MULTIPLE adapters — 502 from bandit AND njsscan AND semgrep, 611 + 915 from semgrep — proving the map (not per-adapter code) does the routing', () => {
  const bn = ingestBandit(readJSON(BANDIT_DESER)).findings.filter((f) => f.dimension === 'untrusted-deserialization')
  const nj = ingestNjsscan(readJSON(NJSSCAN_DESER)).findings.filter((f) => f.dimension === 'untrusted-deserialization')
  const sg = ingestSemgrep(readJSON(SEMGREP_DESER)).findings.filter((f) => f.dimension === 'untrusted-deserialization')
  assert.ok(bn.length >= 1 && nj.length >= 1 && sg.length >= 1, 'deser routed from bandit, njsscan, AND semgrep — the cross-adapter proof')
  assert.ok(bn.some((f) => f.ruleId === 'B301'), 'bandit pickle → 502 → deser')
  assert.ok(nj.some((f) => f.ruleId === 'node_deserialize'), 'njsscan node-serialize → 502 → deser')
  assert.ok(sg.some((f) => f.ruleId.endsWith('use-defused-xml')), 'semgrep XXE → 611 → deser')
  assert.ok(sg.some((f) => f.ruleId.endsWith('prototype-pollution-loop')), 'semgrep prototype pollution → 915 → deser')
  // the map is the single source: the active deser subset is EXACTLY {502,611,915}, adapter-independent
  assert.deepEqual(
    Object.entries(CWE_TO_DIMENSION)
      .filter(([, d]) => d === 'untrusted-deserialization')
      .map(([c]) => Number(c))
      .sort((a, b) => a - b),
    [502, 611, 915]
  )
})

check('DESER-negative: activating the deser family did NOT blanket-route non-deser findings — a real njsscan secrets hit (node_secret CWE-798) + helmet (CWE-693) stay external-sast, and the bandit XML CWE-20 rows stay external-sast', () => {
  const nj = ingestNjsscan(readJSON(NJSSCAN)).findings // the pre-existing real fixture: node_secret 798 + helmet 693
  assert.equal(nj.length, 2)
  for (const f of nj) assert.equal(f.dimension, 'external-sast', `${f.ruleId} (non-deser) must stay external-sast`)
  const xml = ingestBandit(readJSON(BANDIT_DESER)).findings.filter((f) => f.ruleId === 'B405' || f.ruleId === 'B314')
  assert.equal(xml.length, 2)
  for (const f of xml) assert.equal(f.dimension, 'external-sast', `${f.ruleId} (CWE-20) must stay external-sast`)
})

check('DESER-non-supersession (the standing lock): a routed deterministic untrusted-deserialization finding does NOT supersede a co-located llm-inferred untrusted-deserialization finding of a DIFFERENT deser shape — the null classify() is the protection', () => {
  const det = ingestNjsscan(readJSON(NJSSCAN_DESER)).findings[0] // node_deserialize CWE-502 → untrusted-deserialization @ server/nodeserialize.js:5
  assert.equal(det.provenance, 'deterministic')
  assert.equal(det.dimension, 'untrusted-deserialization')
  // an llm untrusted-deserialization finding of a DIFFERENT deser SHAPE (a prototype-pollution shape —
  // a shape no native-object-deserialization CWE describes), same file, overlapping lines
  const llm = {
    id: '9'.repeat(16),
    dimension: 'untrusted-deserialization',
    title: 'User JSON deep-merged into an object without a __proto__ guard',
    severity: 'high',
    adjusted_severity: 'high',
    file: `${det.file.split(':')[0]}:1-40`, // overlaps det's :5
    status: 'confirmed',
    first_seen: 1,
    last_seen: 1,
    verdict: 'confirmed_real',
    verdict_reasoning: 'reasoned over the merge path',
  }
  // PRECONDITIONS that WOULD fire supersession if the adapter owned a class: same dimension + same
  // locus. The ONLY missing ingredient is the owned class (classify()→null on every SAST adapter).
  assert.equal(det.dimension, llm.dimension, 'same dimension (the sameOwnedClass fallback signal)')
  assert.equal(sameLocation(det, llm), true, 'overlapping locus (the other supersession signal)')
  // MUTATION: adding CLASS_DEFS['untrusted-deserialization'] + a classify()→'untrusted-deserialization'
  // turns THIS red at `superseded === 0` (the supersession visibly FIRES), proving the protection is the
  // null classify, not an accident — AND that an owned class would over-supersede across the multi-shape
  // deser dimension (native-deser vs prototype-pollution vs XXE vs Apex mass-assignment).
  const { findings, superseded, supersededIds } = reconcileProvenance([det, llm])
  assert.equal(superseded, 0, 'the LLM prototype-pollution finding is NOT superseded by the routed native-deser row')
  assert.deepEqual(supersededIds, [])
  assert.equal(findings.find((f) => f.id === llm.id).status, 'confirmed') // status unchanged
  assert.equal('class' in det, false, 'no owned class on the routed deterministic finding')
})

// ───────────────────────────────────── XPath (643) + LDAP (90) routing (B5 · E0.1e-A — the injection-gap close)
// XPath (CWE-643) and LDAP (CWE-90) injection findings ALREADY FIRED for Java + C# (semgrep
// p/security-audit + p/csharp) and Node XPath via njsscan, but they routed to the catch-all
// 'external-sast' because 643/90 were parked as fixture-pending comments — NOT in CWE_TO_DIMENSION.
// "A pack fires" ≠ "the dimension gap is closed." E0.1e-A captures the genuine fixtures below and
// PROMOTES 643 + 90 into the map (→ injection-xss), routing them across every SAST adapter for free
// (the unified-map property, E0.1c). CAPTURE-ONLY: no rule was authored — Python/Go/JS XPath+LDAP
// (no OSS rule) are the sibling slice E0.1e-B's custom taint rules, and XML-injection (91) stays the
// LLM-residual E0.1e-C. classify() stays null on every SAST adapter, so a routed XPath/LDAP finding
// owns no class and supersedes nothing (XPATHLDAP-non-supersession, the RD/INJ/DESER posture ported).
// RULE-PATH-PROVEN, not class-proven: each green fixture proves the ONE rule that fired on the seed.
const SEMGREP_XPATHLDAP = join(FIX, 'semgrep-xpath-ldap-seeded.json') // semgrep 1.168.0 (p/security-audit + p/csharp): java tainted-xpath-from-http-request 643 + tainted-ldapi-from-http-request 90 (taint) + ldap-injection 90 (structural); csharp xpath-injection 643 + ldap-injection 90; co-resident use-of-md5 328 (weak-hash NEGATIVE → external-sast)
const NJSSCAN_XPATH = join(FIX, 'njsscan-xpath-seeded.json') // njsscan 0.4.2: node_xpath_injection (xpath.parse() only) CWE-643

check('XPATHLDAP-fixture-semgrep: the generated semgrep fixture routes XPath(643) — java tainted-xpath + csharp xpath-injection — and LDAP(90) — java tainted-ldapi(taint) + java ldap-injection(structural) + csharp ldap-injection — ALL to injection-xss, class-less; the band is the tool band; the co-resident weak-hash use-of-md5(328) STAYS external-sast (the exact-id negative on the SAME seed)', () => {
  const raw = readJSON(SEMGREP_XPATHLDAP)
  // source of truth: the fixture genuinely carries these CWEs (never a guessed id)
  const cweOf = (suffix) => raw.results.find((r) => r.check_id.endsWith(suffix)).extra.metadata.cwe
  assert.equal(dimensionForCwes(cweOf('tainted-xpath-from-http-request')), 'injection-xss') // 643 (java XPath, taint)
  assert.equal(dimensionForCwes(cweOf('xpath-injection.xpath-injection')), 'injection-xss') // 643 (csharp XPath)
  assert.equal(dimensionForCwes(cweOf('tainted-ldapi-from-http-request')), 'injection-xss') // 90 (java LDAP, taint)
  assert.equal(dimensionForCwes(cweOf('java.lang.security.audit.ldap-injection.ldap-injection')), 'injection-xss') // 90 (java LDAP, structural)
  assert.equal(dimensionForCwes(cweOf('csharp.dotnet.security.audit.ldap-injection.ldap-injection')), 'injection-xss') // 90 (csharp LDAP)
  assert.equal(dimensionForCwes(cweOf('use-of-md5')), 'external-sast') // 328 (weak-hash) STAYS external-sast
  const { findings } = ingestSemgrep(raw)
  assert.equal(findings.length, 6)
  const byRule = Object.fromEntries(findings.map((f) => [f.ruleId, f]))
  // the FIVE XPath/LDAP injection findings route + own no class
  const injRules = [
    'java.lang.security.audit.tainted-xpath-from-http-request.tainted-xpath-from-http-request',
    'csharp.dotnet.security.audit.xpath-injection.xpath-injection',
    'java.lang.security.audit.tainted-ldapi-from-http-request.tainted-ldapi-from-http-request',
    'java.lang.security.audit.ldap-injection.ldap-injection',
    'csharp.dotnet.security.audit.ldap-injection.ldap-injection',
  ]
  for (const rid of injRules) {
    assert.equal(byRule[rid].dimension, 'injection-xss', `${rid} must route to injection-xss`)
    assert.ok(!('class' in byRule[rid]), 'routing only — classify() stays null, no owned class')
  }
  // the co-resident weak-hash finding is the NEGATIVE — a non-injection CWE stays external-sast
  const md5 = byRule['java.lang.security.audit.crypto.use-of-md5.use-of-md5']
  assert.equal(md5.dimension, 'external-sast', 'use-of-md5 (CWE-328) must stay external-sast')
  // the band is the tool band, untouched by routing (csharp ERROR→high; java WARNING→medium)
  assert.equal(byRule['csharp.dotnet.security.audit.xpath-injection.xpath-injection'].adjusted_severity, 'high')
  assert.equal(byRule['csharp.dotnet.security.audit.ldap-injection.ldap-injection'].adjusted_severity, 'high')
  assert.equal(byRule['java.lang.security.audit.tainted-xpath-from-http-request.tainted-xpath-from-http-request'].adjusted_severity, 'medium')
})

check('XPATHLDAP-fixture-njsscan: node_xpath_injection (xpath.parse(), CWE-643) routes to injection-xss; carries the derived CWE-643 URL; the tool band (ERROR→high) is untouched; class-less. NARROW — the njsscan rule flags parse() only, not select()/evaluate()', () => {
  const raw = readJSON(NJSSCAN_XPATH)
  assert.ok(raw.nodejs.node_xpath_injection.metadata.cwe.startsWith('CWE-643'), 'source of truth: the njsscan rule tags CWE-643')
  const { findings } = ingestNjsscan(raw)
  assert.equal(findings.length, 1)
  const f = findings[0]
  assert.equal(f.ruleId, 'node_xpath_injection')
  assert.equal(f.dimension, 'injection-xss')
  assert.equal(f.adjusted_severity, 'high') // ERROR → high, the tool band, unchanged by routing
  assert.ok(!('class' in f), 'routing only — no owned class')
  assert.ok(f.verdict_reasoning.includes('https://cwe.mitre.org/data/definitions/643.html'), 'the derived CWE-643 URL must appear in verdict_reasoning')
})

check('XPATHLDAP-cross-adapter: the ONE unified CWE_TO_DIMENSION map routes XPath/LDAP across MULTIPLE adapters — 643 from semgrep (java+csharp) AND njsscan, 90 from semgrep (java+csharp) — proving the map (not per-adapter code) does the routing; the active injection subset now includes 90+643', () => {
  const sg = ingestSemgrep(readJSON(SEMGREP_XPATHLDAP)).findings.filter((f) => f.dimension === 'injection-xss')
  const nj = ingestNjsscan(readJSON(NJSSCAN_XPATH)).findings.filter((f) => f.dimension === 'injection-xss')
  assert.ok(sg.length === 5 && nj.length === 1, 'XPath/LDAP routed from semgrep (5) AND njsscan (1) — the cross-adapter proof')
  assert.ok(sg.some((f) => f.ruleId.endsWith('tainted-xpath-from-http-request.tainted-xpath-from-http-request')), 'semgrep java XPath → 643 → injection-xss')
  assert.ok(sg.some((f) => f.ruleId.endsWith('xpath-injection.xpath-injection')), 'semgrep csharp XPath → 643 → injection-xss')
  assert.ok(sg.some((f) => f.ruleId.endsWith('tainted-ldapi-from-http-request.tainted-ldapi-from-http-request')), 'semgrep java LDAP → 90 → injection-xss')
  assert.ok(sg.some((f) => f.ruleId.endsWith('csharp.dotnet.security.audit.ldap-injection.ldap-injection')), 'semgrep csharp LDAP → 90 → injection-xss')
  assert.ok(nj.some((f) => f.ruleId === 'node_xpath_injection'), 'njsscan node XPath → 643 → injection-xss')
  // the map is the single source: the active injection subset now contains BOTH 90 and 643
  assert.ok(INJECTION_XSS_CWES.has(90) && INJECTION_XSS_CWES.has(643), 'the promoted ids are in the derived injection subset')
  assert.equal(CWE_TO_DIMENSION[90], 'injection-xss')
  assert.equal(CWE_TO_DIMENSION[643], 'injection-xss')
})

check('XPATHLDAP-non-supersession (the standing lock): a routed deterministic injection-xss finding (semgrep XPath, CWE-643) does NOT supersede a co-located llm-inferred injection-xss finding of a DIFFERENT injection shape — the null classify() is the protection, now proven for the newly-promoted 643/90', () => {
  const det = ingestSemgrep(readJSON(SEMGREP_XPATHLDAP)).findings.find((f) =>
    f.ruleId.endsWith('tainted-xpath-from-http-request.tainted-xpath-from-http-request')
  ) // CWE-643 → injection-xss @ java/XPathSink.java:19
  assert.equal(det.provenance, 'deterministic')
  assert.equal(det.dimension, 'injection-xss')
  // an llm injection-xss finding of a DIFFERENT SHAPE (an OS-command shape — a shape no XPath CWE
  // describes), same file, overlapping lines
  const llm = {
    id: '7'.repeat(16),
    dimension: 'injection-xss',
    title: 'Shell command interpolates request input without escaping',
    severity: 'high',
    adjusted_severity: 'high',
    file: `${det.file.split(':')[0]}:10-30`, // overlaps det's :19
    status: 'confirmed',
    first_seen: 1,
    last_seen: 1,
    verdict: 'confirmed_real',
    verdict_reasoning: 'reasoned over the process-exec path',
  }
  // PRECONDITIONS that WOULD fire supersession if the adapter owned a class: same dimension + same
  // locus. The ONLY missing ingredient is the owned class (classify()→null on every SAST adapter).
  assert.equal(det.dimension, llm.dimension, 'same dimension (the sameOwnedClass fallback signal)')
  assert.equal(sameLocation(det, llm), true, 'overlapping locus (the other supersession signal)')
  // MUTATION: adding CLASS_DEFS['injection-xss'] + a classify()→'injection-xss' turns THIS red at
  // `superseded === 0` (the supersession visibly FIRES), proving the protection is the null classify —
  // AND that an owned class would over-supersede across the multi-shape injection dimension.
  const { findings, superseded, supersededIds } = reconcileProvenance([det, llm])
  assert.equal(superseded, 0, 'the LLM OS-command finding is NOT superseded by the routed XPath row')
  assert.deepEqual(supersededIds, [])
  assert.equal(findings.find((f) => f.id === llm.id).status, 'confirmed') // status unchanged
  assert.equal('class' in det, false, 'no owned class on the routed deterministic finding')
})

// ─────────────────── toolkit-authored custom injection taint rules (B5 · E0.1e-B — the OSS-gap close)
// E0.1e-A promoted 643/90 into the map and captured the OSS packs' XPath/LDAP hits, but ONLY for the
// languages an OSS rule covers (Java/C# via p/security-audit + p/csharp; Node XPath via njsscan parse()).
// Python XPath+LDAP, JS/Go LDAP, and Go XPath have NO OSS rule at all. E0.1e-B ships the toolkit's OWN
// curated Semgrep taint rules (rules/injection/*.yaml, mode: taint — a real source→sink flow is required,
// never a bare sink) run via `--config`. NO harness change and NO new map int: each rule tags CWE-643 or
// CWE-90, which the SAME unified CWE_TO_DIMENSION map (already carrying 643/90 from E0.1e-A) routes to
// injection-xss via dimensionForCwes — the E0.1c unified-map property, now proven for toolkit-authored
// content. classify() stays null, so a routed hit owns no class and supersedes nothing. HONEST SCOPE: CE
// taint is intra-file, so the pack is low-FP (every fixture flow is a real source→sink) but moderate-FN
// (cross-function flows fall to the LLM residual, not to a noisy rule). Every SHIPPED rule passed
// `semgrep --test` (fires on the vuln line, silent on the sanitized/parameterized/string-literal line);
// the fixture below is GENUINE `semgrep --config rules/injection/ --json` output (semgrep 1.168.0) over a
// minimal seeded sample per (class, language) — never fabricated.
const SEMGREP_CUSTOM_INJ = join(FIX, 'semgrep-custom-injection-seeded.json') // semgrep 1.168.0, --config rules/injection/: python/js/go XPath(643) + python/js/go LDAP(90) — 7 hits across the 6 toolkit-authored rules (xpath-python fires twice: ElementTree + lxml sinks)
const RULES_INJ = join(PLUGIN, 'rules', 'injection')
const CUSTOM_INJ_RULES = [
  ['python-xpath-injection-taint', 643],
  ['python-ldap-injection-taint', 90],
  ['javascript-xpath-injection-taint', 643],
  ['javascript-ldap-injection-taint', 90],
  ['go-xpath-injection-taint', 643],
  ['go-ldap-injection-taint', 90],
]

check('CUSTOM-INJ-fixture-routing: every hit in the genuine `semgrep --config rules/injection/` capture routes to injection-xss (class-less, engine semgrep, tool band medium); the CWE the rule tags (643 XPath / 90 LDAP) is what routes it — NOT the rule name; all 6 toolkit-authored rules are represented', () => {
  const raw = readJSON(SEMGREP_CUSTOM_INJ)
  // source of truth: the fixture genuinely carries a 643/90 CWE for each rule id (never a guessed id)
  const cweOf = (idSuffix) => raw.results.find((r) => r.check_id.endsWith(idSuffix)).extra.metadata.cwe
  for (const [id, cweInt] of CUSTOM_INJ_RULES) {
    const cwe = cweOf(id)
    assert.ok(String(cwe[0]).startsWith(`CWE-${cweInt}`), `${id} must tag CWE-${cweInt} in the captured fixture`)
    assert.equal(dimensionForCwes(cwe), 'injection-xss', `${id} (CWE-${cweInt}) must route to injection-xss`)
  }
  const { findings } = ingestSemgrep(raw)
  assert.equal(findings.length, 7) // 6 rules; xpath-python fires twice (ElementTree + lxml sinks) on its seed
  for (const f of findings) {
    assert.ok(f.ruleId.includes('.injection.'), `${f.ruleId} must come from the rules/injection/ pack`)
    assert.equal(f.engine, 'semgrep', 'the toolkit pack is ingested by the semgrep adapter')
    assert.equal(f.dimension, 'injection-xss', `${f.ruleId} must route to injection-xss`)
    assert.ok(!('class' in f), 'routing only — classify() stays null, no owned class')
    assert.equal(f.adjusted_severity, 'medium') // WARNING → medium tool band, untouched by routing
  }
  // all 6 rule ids are represented (no rule silently absent from the capture)
  const ids = new Set(findings.map((f) => f.ruleId.replace(/^.*\.injection\./, '')))
  for (const [id] of CUSTOM_INJ_RULES) assert.ok(ids.has(id), `${id} produced no finding in the capture`)
})

check('CUSTOM-INJ-no-new-map-ints: E0.1e-B adds ZERO map ints — the toolkit pack RIDES the 643/90 rows E0.1e-A already promoted; every CWE in the captured fixture is in the pre-existing injection allowlist, and the semgrep adapter classify() stays null (routed hit owns no class)', () => {
  // the unified injection allowlist is UNCHANGED by this slice (same set as INJ-allowlist above)
  assert.deepEqual([...INJECTION_XSS_CWES].sort((a, b) => a - b), [78, 79, 89, 90, 94, 95, 96, 643, 943])
  const raw = readJSON(SEMGREP_CUSTOM_INJ)
  for (const r of raw.results) {
    // each fixture CWE is one of the pre-existing injection ids — no int was added for this slice
    assert.equal(dimensionForCwes(r.extra.metadata.cwe), 'injection-xss')
  }
  assert.equal(CWE_TO_DIMENSION[643], 'injection-xss')
  assert.equal(CWE_TO_DIMENSION[90], 'injection-xss')
  assert.equal(semgrepAdapter.classify(), null) // the pack is routing-only; it supersedes nothing
})

check('CUSTOM-INJ-wiring-command (mirror SG-RP4): the run-scans Family 7 `semgrep scan` invocation carries --config .../rules/injection/ — scoped to the fenced command block, not the prose; dropping it re-dormants the toolkit pack on every live run', () => {
  const skill = readText(join(PLUGIN, 'skills', 'run-scans', 'SKILL.md'))
  const blocks = [...skill.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1])
  const semgrepBlocks = blocks.filter((b) => b.includes('semgrep scan'))
  assert.ok(semgrepBlocks.length >= 1, 'no fenced `semgrep scan` invocation in skills/run-scans/SKILL.md')
  for (const b of semgrepBlocks) {
    assert.ok(/--config\s+\S*rules\/injection\/?/.test(b), `a Family 7 semgrep invocation lost --config .../rules/injection/:\n${b}`)
  }
})

check('CUSTOM-INJ-wiring-pack: rules/injection/ ships a .yaml + a matching `semgrep --test` companion for each rule (same basename), with NO dangling half either way — a rule dropped-to-residual removes BOTH its yaml and its companion', () => {
  const SRC_EXTS = ['.py', '.js', '.ts', '.go', '.java', '.cs', '.rb', '.php']
  const files = readdirSync(RULES_INJ)
  const yamls = files.filter((f) => f.endsWith('.yaml')).map((f) => f.replace(/\.yaml$/, ''))
  const companions = files.filter((f) => SRC_EXTS.some((e) => f.endsWith(e))).map((f) => f.replace(/\.[^.]+$/, ''))
  assert.ok(yamls.length >= 6, `expected >=6 shipped rules in rules/injection/, found ${yamls.length}`)
  for (const base of yamls) {
    assert.ok(companions.includes(base), `rule ${base}.yaml has no semgrep --test companion (dangling rule)`)
  }
  for (const base of companions) {
    assert.ok(yamls.includes(base), `companion ${base}.* has no rule yaml (dangling companion)`)
  }
  // the 6 shipped rules are exactly the (class, language) pairs the fixture routes
  const bases = new Set(yamls)
  for (const name of ['xpath-python', 'ldap-python', 'xpath-js', 'ldap-js', 'xpath-go', 'ldap-go']) {
    assert.ok(bases.has(name), `expected rules/injection/${name}.yaml`)
  }
})

// ───────────── substrate-unavailable + version-drift honesty markers (B5 · item 7, 0.8.80)
// Two silent-degradation channels that were operator-prose only (skills/run-scans/SKILL.md)
// become deterministic ingest NOTES: (1) substrate-unavailable — a TOOLKIT taint rule
// (rules/injection/*.yaml, the one rule set whose taint mode is knowable from output via the
// path-derived `rules.injection.` check_id prefix; registry/third-party taintness is
// unknowable and stays out) fired with NO dataflow trace, i.e. the reachability substrate is
// withheld on that engine version / output surface; (2) version-drift — an opengrep evidence
// file records a producing version ≠ the sha256-pinned install (recorded∩pinned = opengrep
// ONLY: pip tools float by design, gitleaks/osv/trivy record no version, code-analyzer pins
// live in a different namespace — all deliberately OUT). Both are NOTES, never findings: the
// findings ingest byte-identically, the ledger and schema are untouched, and only adapters
// that define the optional expectsTrace/recordedVersion hooks participate (the
// securityRelevant pattern). The drift comparand is single-sourced: PINNED_TOOL_VERSIONS is
// DERIVED from install-scanners' BINARY_PINS, locked below.
const SUBSTRATE_RE = /reachability substrate unavailable/
const DRIFT_RE = /stale\/unexpected scanner version/
const ingestOpengrep = (raw) => ingest(raw, opengrepAdapter, { repoRoot: '', pass: 1 })

check('SG-RP-SUB1 substrate-unavailable fires: the trace-less toolkit-pack capture (7 hits, 6 rules.injection.* taint rules, zero dataflow_trace) → ONE aggregated note (never one-per-hit) naming the count + the honest vunknown (semgrep has NO recordedVersion — pip floating-latest); findings byte-identical to a hook-less ingest, no reachabilityPath/reachable added', () => {
  const { findings, notes } = ingestSemgrep(readJSON(SEMGREP_CUSTOM_INJ))
  assert.equal(findings.length, 7)
  assert.ok(notes.some((n) => SUBSTRATE_RE.test(n)))
  assert.ok(notes.some((n) => n.includes('semgrep: 7 toolkit taint rule(s) fired with no dataflow trace (semgrep vunknown)')))
  assert.equal(notes.filter((n) => SUBSTRATE_RE.test(n)).length, 1, 'aggregated: ONE note per ingest, not one-per-hit')
  for (const f of findings) {
    assert.ok(!('reachabilityPath' in f), `no fabricated trace on ${f.file}`)
    assert.ok(!('reachable' in f))
  }
  // the marker changed ONLY notes: the same adapter WITHOUT the hook (the pre-marker shape —
  // and the shape of every non-participating adapter) produces byte-identical findings and
  // no marker. Proves both findings-byte-safety AND other-adapter inertness.
  const { expectsTrace: _et, ...hookless } = semgrepAdapter
  const bare = ingest(readJSON(SEMGREP_CUSTOM_INJ), hookless, { repoRoot: '', pass: 1 })
  assert.equal(JSON.stringify(findings), JSON.stringify(bare.findings))
  assert.ok(!bare.notes.some((n) => SUBSTRATE_RE.test(n)), 'no hook → no marker')
})

check('SG-RP-SUB2 substrate silent on with-trace: the taint fixtures (trace PRESENT, non-toolkit rule — doubly negative) → NO note; the SHARP control — the toolkit-pack capture with a genuine dataflow_trace grafted onto every hit → still NO note (the marker keys on trace-ABSENCE, not the rule name)', () => {
  assert.ok(!ingestSemgrep(readJSON(SEMGREP_TAINT)).notes.some((n) => SUBSTRATE_RE.test(n)))
  assert.ok(!ingestOpengrep(readJSON(OPENGREP_JSON)).notes.some((n) => SUBSTRATE_RE.test(n)))
  // graft the genuine 1.85.0 trace (both ends: source + sink) onto every rules.injection.* hit
  const donor = readJSON(SEMGREP_TAINT).results[0].extra.dataflow_trace
  const raw = clone(readJSON(SEMGREP_CUSTOM_INJ))
  for (const r of raw.results) r.extra.dataflow_trace = clone(donor)
  const res = ingestSemgrep(raw)
  assert.equal(res.findings.length, 7)
  assert.ok(res.findings.every((f) => f.reachable === true), 'the grafted trace actually parsed — the control is live, not vacuous')
  assert.ok(!res.notes.some((n) => SUBSTRATE_RE.test(n)))
})

check('SG-RP-SUB3 substrate silent on non-taint: ordinary Security hits (non-rules.injection.* search-mode rules, no trace — the coldstart/helios captures) → NO note; the marker never fires on a rule whose taintness is unknowable', () => {
  for (const fx of [SEMGREP_WARN, SEMGREP_ERR]) {
    assert.ok(!ingestSemgrep(readJSON(fx)).notes.some((n) => SUBSTRATE_RE.test(n)), `unexpected substrate note on ${fx}`)
  }
})

check('SG-RP-SUB4 the opengrep + SARIF surfaces carry the marker: hooks live on EACH adapter object (parse-delegation does NOT inherit them, and ingestAll routes opengrep-*.json through the opengrep adapter — without its own expectsTrace the marker would silently vanish there)', () => {
  assert.equal(opengrepAdapter.expectsTrace, semgrepAdapter.expectsTrace, 'the opengrep hook is the semgrep contract, explicitly aliased')
  // opengrep surface: the toolkit-pack capture as opengrep evidence, version neutralized to
  // the pin so ONLY the substrate marker is under test — and recordedVersion feeds the note
  const raw = clone(readJSON(SEMGREP_CUSTOM_INJ))
  raw.version = BINARY_PINS.opengrep.version
  const og = ingestOpengrep(raw)
  assert.equal(og.findings.length, 7)
  assert.ok(og.notes.some((n) => n.includes(`opengrep: 7 toolkit taint rule(s) fired with no dataflow trace (opengrep v${BINARY_PINS.opengrep.version})`)))
  assert.ok(!og.notes.some((n) => DRIFT_RE.test(n)), 'pin-matched version — no drift note')
  // SARIF surface: no trace-less toolkit-taint SARIF capture is frozen (the taint fixtures all
  // carry codeFlows), so mutate in memory — re-id the opengrep SARIF result to a toolkit-pack
  // rule and strip its codeFlows
  const sarifRaw = clone(readJSON(OPENGREP_SARIF))
  const run = sarifRaw.runs[0]
  run.results[0].ruleId = 'rules.injection.python-ldap-injection-taint'
  if (Array.isArray(run.tool.driver.rules) && run.tool.driver.rules[0]) run.tool.driver.rules[0].id = 'rules.injection.python-ldap-injection-taint'
  delete run.results[0].codeFlows
  const sf = ingestSarif(sarifRaw)
  assert.equal(sf.findings.length, 1)
  assert.ok(sf.notes.some((n) => n.includes('sarif: 1 toolkit taint rule(s) fired with no dataflow trace')))
})

check('SG-RP-DRIFT1 version-drift fires on opengrep JSON: raw.version mutated to 9.9.9 → the note naming BOTH versions; the unmutated fixture (1.25.0 == pin) → NO note; findings byte-identical either way (notes only, never a finding)', () => {
  const clean = ingestOpengrep(readJSON(OPENGREP_JSON))
  assert.ok(!clean.notes.some((n) => DRIFT_RE.test(n)))
  const raw = clone(readJSON(OPENGREP_JSON))
  raw.version = '9.9.9'
  const drift = ingestOpengrep(raw)
  assert.ok(drift.notes.some((n) => DRIFT_RE.test(n)))
  assert.ok(drift.notes.some((n) => n.includes(`opengrep: evidence records version 9.9.9 but the toolkit pins ${PINNED_TOOL_VERSIONS.opengrep}`)))
  assert.equal(JSON.stringify(drift.findings), JSON.stringify(clean.findings))
})

check('SG-RP-DRIFT2 version-drift on the SARIF surface: a mutated semanticVersion on the Opengrep OSS driver → the note; clean (1.25.0 == pin) → none; the DRIVER GATE — the frozen Semgrep OSS 1.168.0 SARIF NEVER drift-fires (pip floating-latest, no pin — it would be a false alarm against the opengrep pin), nor does any other driver', () => {
  assert.ok(!ingestSarif(readJSON(OPENGREP_SARIF)).notes.some((n) => DRIFT_RE.test(n)))
  const raw = clone(readJSON(OPENGREP_SARIF))
  raw.runs[0].tool.driver.semanticVersion = '9.9.9'
  const drift = ingestSarif(raw)
  assert.ok(drift.notes.some((n) => n.includes(`opengrep: evidence records version 9.9.9 but the toolkit pins ${PINNED_TOOL_VERSIONS.opengrep}`)))
  // the gate, both ways: the REAL semgrep SARIF fixture records 1.168.0 ≠ pin → silent;
  // a non-opengrep driver with a junk version → silent
  assert.equal(readJSON(SEMGREP_SARIF).runs[0].tool.driver.semanticVersion, '1.168.0')
  assert.ok(!ingestSarif(readJSON(SEMGREP_SARIF)).notes.some((n) => DRIFT_RE.test(n)), 'Semgrep OSS must never drift-fire')
  const other = clone(readJSON(OPENGREP_SARIF))
  other.runs[0].tool.driver.name = 'Checkmarx'
  other.runs[0].tool.driver.semanticVersion = '9.9.9'
  assert.ok(!ingestSarif(other).notes.some((n) => DRIFT_RE.test(n)), 'a non-opengrep driver must never drift-fire')
})

check('SG-RP-DRIFT3 single-source lock: PINNED_TOOL_VERSIONS.opengrep is DERIVED from BINARY_PINS.opengrep.version — the drift comparand can never diverge from the actual sha256-pinned install', () => {
  assert.equal(PINNED_TOOL_VERSIONS.opengrep, BINARY_PINS.opengrep.version)
  assert.ok(/^\d+\.\d+\.\d+$/.test(PINNED_TOOL_VERSIONS.opengrep), 'a real semver pin, not a placeholder')
})

check('SG-RP-SUB5 determinism: twice-ingest of both markers\' fixtures → identical notes AND identical findings (no Date/random anywhere on the path)', () => {
  const sub = () => ingestSemgrep(readJSON(SEMGREP_CUSTOM_INJ))
  assert.equal(JSON.stringify(sub()), JSON.stringify(sub()))
  const drift = () => {
    const r = clone(readJSON(OPENGREP_JSON))
    r.version = '9.9.9'
    return ingestOpengrep(r)
  }
  assert.equal(JSON.stringify(drift()), JSON.stringify(drift()))
})

// ───────────────────────────────────── session-id retrieval routing (B5 · E0.1d, 0.8.65)
// Code Analyzer's built-in pmd-appexchange session-id rules fire on EVERY retrieval site
// (bare retrieval — including the approved on-platform uses Salesforce's session-id guidance
// carves out), and CA v5 JSON carries NO CWE field for any engine — so these route by RULE
// NAME via RULE_DIMENSION (RULE_CLASS's class-less sibling; the two maps are disjoint) to the
// sessionid-egress methodology dimension. The routing files the retrieval SITE under the
// auto-fail heading; the egress VERDICT (does the value leave the platform) stays the
// labelled LLM/human residual, and the external-service token-passthrough side of the
// dimension has no clean deterministic substrate (a generic log-exposure CWE would over-route
// into an auto-fail band), so it stays LLM-residual too. Fixture: a GENUINE
// `sf code-analyzer run --rule-selector AppExchange` capture (Code Analyzer core 0.48.0 /
// pmd engine 0.41.0 / @salesforce/plugin-code-analyzer 5.13.0) over a minimal seeded sample
// (an Apex UserInfo.getSessionId() read + a Visualforce $Api.Session_ID merge-field),
// emitting exactly AvoidUnauthorizedGetSessionIdInApex (tags AppExchange/Security/Apex,
// engine 'pmd', severity 3) + AvoidUnauthorizedApiSessionIdInVisualforce (tags AppExchange/
// Security/Visualforce, engine 'pmd', severity 3) — the exact spellings the map activates;
// the formula/merge-field GETSESSIONID() sibling stays fixture-pending.
const ingestSess = (raw) => ingest(raw === undefined ? readJSON(SESSFIX) : raw, codeAnalyzerAdapter, { repoRoot: '', pass: 1 })
const sessHit = (rule) => ({
  violations: [
    {
      rule,
      engine: 'pmd',
      severity: 3,
      tags: ['AppExchange', 'Security', 'Apex'],
      primaryLocationIndex: 0,
      locations: [{ file: 'force-app/main/default/classes/Other.cls', startLine: 4 }],
      message: 'm',
      resources: [],
    },
  ],
})

check('SESS-routing: RULE_DIMENSION routes both fixture-proven pmd-appexchange session-id rules to sessionid-egress; a security-tagged CA hit with that rule name ingests deterministic/sessionid-egress with NO owned class', () => {
  assert.equal(RULE_DIMENSION['AvoidUnauthorizedGetSessionIdInApex'], 'sessionid-egress')
  assert.equal(RULE_DIMENSION['AvoidUnauthorizedApiSessionIdInVisualforce'], 'sessionid-egress')
  const { findings } = ingestSess(sessHit('AvoidUnauthorizedGetSessionIdInApex'))
  assert.equal(findings.length, 1)
  const f = findings[0]
  assert.equal(f.provenance, 'deterministic')
  assert.equal(f.dimension, 'sessionid-egress')
  assert.equal(f.status, 'confirmed')
  assert.ok(!('class' in f), 'a routed session-id finding owns no class')
})

check('SESS-fixture: the genuine CA AppExchange capture lands both retrieval sites deterministic/sessionid-egress, class-less, at the seed loci (CA core 0.48.0 / pmd 0.41.0 / plugin 5.13.0); byte-deterministic', () => {
  const { findings } = ingestSess()
  assert.equal(findings.length, 2)
  const apex = findById(findings, (x) => x.ruleId === 'AvoidUnauthorizedGetSessionIdInApex')
  const vf = findById(findings, (x) => x.ruleId === 'AvoidUnauthorizedApiSessionIdInVisualforce')
  assert.ok(apex, 'the Apex retrieval-site finding is present')
  assert.ok(vf, 'the Visualforce retrieval-site finding is present')
  for (const f of [apex, vf]) {
    assert.equal(f.provenance, 'deterministic')
    assert.equal(f.engine, 'pmd') // the engine label the capture emitted — routing keys on the rule NAME, not the engine
    assert.equal(f.dimension, 'sessionid-egress')
    assert.equal(f.adjusted_severity, 'medium') // class-less CA-severity fallback: sev 3 → medium
    assert.ok(!('class' in f), 'no owned class')
  }
  assert.equal(apex.file, 'force-app/main/default/classes/SeedSession.cls:3')
  assert.equal(vf.file, 'force-app/main/default/pages/SeedSessionPage.page:3')
  assert.equal(JSON.stringify(findings), JSON.stringify(ingestSess().findings))
})

check('SESS-disjoint: RULE_DIMENSION and RULE_CLASS share no key — a rule either owns a class or routes a class-less dimension, never both', () => {
  const overlap = Object.keys(RULE_DIMENSION).filter((k) => k in RULE_CLASS)
  assert.deepEqual(overlap, [])
  // Every routed value is one of the fixture-proven catalog dimensions. Was `=== 'sessionid-egress'`
  // when the session-id pair was the whole map; the catalog expansion (0.8.76) added the
  // secrets-credentials + admin-surface clusters, E0.1d-EXPAND-2 (0.8.77) added the class-less-safe
  // markup/OAuth clusters (injection-xss + oauth-identity), and E0.1d-EXPAND-3 (0.8.78) added the
  // owned-class-dimension metadata clusters (package-metadata; secrets-credentials was already in
  // the set), so the lock is set-membership — a typo'd or guessed dimension string still fails here.
  const routedDims = new Set(['sessionid-egress', 'secrets-credentials', 'admin-surface', 'injection-xss', 'oauth-identity', 'package-metadata'])
  for (const v of Object.values(RULE_DIMENSION)) assert.ok(routedDims.has(v), `unexpected RULE_DIMENSION value ${v}`)
})

check('SESS-negative: RULE_CLASS routing untouched (ApexCRUDViolation → crud-fls/apex-exposed-surface); a security-tagged rule in NEITHER map still falls to apex-exposed-surface; classify() stays null for the session-id rules (AD2 intact)', () => {
  const crud = ingestSess(sessHit('ApexCRUDViolation')).findings[0]
  assert.equal(crud.class, 'crud-fls')
  assert.equal(crud.dimension, 'apex-exposed-surface')
  const other = ingestSess(sessHit('SomeSecurityRuleInNeitherMap')).findings[0]
  assert.equal(other.dimension, 'apex-exposed-surface')
  assert.ok(!('class' in other))
  assert.equal(codeAnalyzerAdapter.classify('AvoidUnauthorizedGetSessionIdInApex'), null)
  assert.equal(codeAnalyzerAdapter.classify('AvoidUnauthorizedApiSessionIdInVisualforce'), null)
})

check('SESS-non-supersession (the standing lock — the RD/INJ/DESER posture ported): a routed deterministic sessionid-egress finding does NOT supersede a co-located llm-inferred sessionid-egress finding of a DIFFERENT session-egress shape', () => {
  const det = findById(ingestSess().findings, (x) => x.ruleId === 'AvoidUnauthorizedGetSessionIdInApex')
  assert.equal(det.provenance, 'deterministic')
  assert.equal(det.dimension, 'sessionid-egress')
  // an llm-inferred sessionid-egress finding of a DIFFERENT SHAPE (the retrieved value reaching
  // a callout Authorization header — the egress-verdict shape no bare-retrieval rule describes),
  // same file, overlapping lines
  const llm = {
    id: '6'.repeat(16),
    dimension: 'sessionid-egress',
    title: 'Retrieved session id reaches an external callout Authorization header',
    severity: 'critical',
    adjusted_severity: 'critical',
    file: 'force-app/main/default/classes/SeedSession.cls:1-10', // overlaps det's :3
    status: 'confirmed',
    first_seen: 1,
    last_seen: 1,
    verdict: 'confirmed_real',
    verdict_reasoning: 'reasoned over the retrieval-to-callout dataflow',
  }
  // PRECONDITIONS that WOULD fire supersession if the adapter owned a class: same dimension +
  // same locus. Asserting them keeps the guard sharp — the ONLY missing ingredient is the owned
  // class (classify()→null + no CLASS_DEFS['sessionid-egress']). MUTATION: adding a
  // CLASS_DEFS['sessionid-egress'] entry + a classify()→'sessionid-egress' for the routed rule
  // turns THIS red at `superseded === 0` (the supersession visibly FIRES), proving the
  // protection is the null classify, not an accident.
  assert.equal(det.dimension, llm.dimension, 'same dimension (the sameOwnedClass fallback signal)')
  assert.equal(sameLocation(det, llm), true, 'overlapping locus (the other supersession signal)')
  const { findings, superseded, supersededIds } = reconcileProvenance([det, llm])
  assert.equal(superseded, 0, 'the LLM egress-verdict finding is NOT superseded — the routed retrieval-site row sits beside it')
  assert.deepEqual(supersededIds, [])
  assert.equal(findings.find((f) => f.id === llm.id).status, 'confirmed') // status unchanged
  assert.equal(findings.find((f) => f.id === det.id).status, 'confirmed')
  // the guard itself, asserted LAST so a class-owning mutation fails first at "superseded === 0"
  assert.equal('class' in det, false, 'no owned class on the routed deterministic finding')
})

// ───────────────────────────────────── pmd-appexchange catalog routing (B5 · E0.1d-EXPAND, 0.8.76)
// The installed pmd-appexchange catalog carries 37 Security rules; E0.1d routed the first two
// session-id rules by name. This slice routes the remaining HIGH-CONFIDENCE clusters — the rules
// whose methodology dimension is unambiguous — leaving the markup/JS/CSS/LWC + remaining rules for
// a grounded per-rule decision (E0.1d-EXPAND-2) and deliberately NOT routing the two Remote-Site-
// Setting rules that the plain-http-egress + protocol-security-disabled metadata source-scanners
// already own (EXP-skip). Fixture: a GENUINE `sf code-analyzer run --rule-selector AppExchange`
// capture (Code Analyzer core 0.48.0 / pmd engine 0.41.0 / @salesforce/plugin-code-analyzer 5.13.0)
// over a seeded multi-rule SFDX corpus — 12 violations across 7 files, firing ALL 11 targeted rules
// with these exact spellings (engine 'pmd', tags AppExchange/Security/<lang>):
//   sessionid-egress:    AvoidApiSessionId (XML WebLink, sev 2) + AvoidUnauthorizedApiSessionIdInApex
//                        (Apex '{!API.Session_ID}' literal, sev 3) + AvoidUnauthorizedGetSessionIdInVisualforce
//                        (VF GETSESSIONID() merge-function, sev 2)
//   secrets-credentials: AvoidHardcodedCredentialsInVarDecls / -VarAssign / -FieldDecls / -HttpHeader
//                        (sev 3) + -SetPassword (sev 1) + AvoidHardCodedCredentialsInAura (HTML, sev 2;
//                        the capital-C spelling is the catalog's) + AvoidHardcodedSecretsInVFAttrs
//                        (VF, sev 2 — fires TWICE on one two-attribute tag, same startLine locus)
//   admin-surface:       AvoidChangeProtectionUnprotected (Apex, sev 1 — fires on
//                        FeatureManagement.changeProtection(...,'Unprotected') inside an
//                        externally-invocable @AuraEnabled method)
// All routed rows stay class-less: classify() reads only RULE_CLASS, so none of these supersedes
// anything (the SESS posture), and the OWNED hardcoded-secrets class stays with the secret scanners.
const ingestCat = (raw) => ingest(raw === undefined ? readJSON(CATFIX) : raw, codeAnalyzerAdapter, { repoRoot: '', pass: 1 })
const EXP_SESSION_RULES = ['AvoidApiSessionId', 'AvoidUnauthorizedApiSessionIdInApex', 'AvoidUnauthorizedGetSessionIdInVisualforce']
const EXP_SECRET_RULES = [
  'AvoidHardcodedCredentialsInVarDecls',
  'AvoidHardcodedCredentialsInVarAssign',
  'AvoidHardcodedCredentialsInFieldDecls',
  'AvoidHardcodedCredentialsInHttpHeader',
  'AvoidHardcodedCredentialsInSetPassword',
  'AvoidHardCodedCredentialsInAura',
  'AvoidHardcodedSecretsInVFAttrs',
]
const EXP_ADMIN_RULES = ['AvoidChangeProtectionUnprotected']
const EXP_SKIP_RULES = ['AvoidInsecureHttpRemoteSiteSetting', 'AvoidDisableProtocolSecurityRemoteSiteSetting']

check('EXP-routing: every catalog-cluster rule routes by exact name to its dimension (session-id siblings → sessionid-egress, hardcoded credentials → secrets-credentials, changeProtection → admin-surface); a security-tagged CA hit ingests deterministic / that dimension / class-less; none is in RULE_CLASS', () => {
  const want = new Map([
    ...EXP_SESSION_RULES.map((r) => [r, 'sessionid-egress']),
    ...EXP_SECRET_RULES.map((r) => [r, 'secrets-credentials']),
    ...EXP_ADMIN_RULES.map((r) => [r, 'admin-surface']),
  ])
  for (const [rule, dim] of want) {
    assert.equal(RULE_DIMENSION[rule], dim, `RULE_DIMENSION[${rule}]`)
    assert.ok(!(rule in RULE_CLASS), `${rule} must not own a class`)
    assert.equal(codeAnalyzerAdapter.classify(rule), null, `classify(${rule}) must stay null`)
    const { findings } = ingestCat(sessHit(rule))
    assert.equal(findings.length, 1)
    assert.equal(findings[0].provenance, 'deterministic')
    assert.equal(findings[0].dimension, dim, `ingested dimension for ${rule}`)
    assert.equal(findings[0].status, 'confirmed')
    assert.ok(!('class' in findings[0]), `routed ${rule} finding owns no class`)
  }
})

check('EXP-fixture: the genuine multi-rule CA catalog capture (core 0.48.0 / pmd 0.41.0 / plugin 5.13.0) lands all 11 rules in their dimensions, class-less, at the seed loci; CA severity fallback intact; byte-deterministic', () => {
  const raw = readJSON(CATFIX)
  assert.equal(raw.versions['code-analyzer'], '0.48.0') // provenance lock on the committed capture
  assert.equal(raw.versions['pmd'], '0.41.0')
  const { findings } = ingestCat()
  // 12 violations → 12 findings: AvoidHardcodedSecretsInVFAttrs fires twice on the one
  // two-attribute seed tag at the SAME startLine locus (columns differ; the locus id ignores
  // columns), and ingest() relays hits — it never collapses them (merge-ledger dedups by id later).
  assert.equal(findings.length, 12)
  const byRule = new Map()
  for (const f of findings) {
    if (!byRule.has(f.ruleId)) byRule.set(f.ruleId, [])
    byRule.get(f.ruleId).push(f)
  }
  assert.equal(byRule.size, 11, 'all 11 catalog-cluster rules fired')
  for (const r of EXP_SESSION_RULES) assert.equal(byRule.get(r)[0].dimension, 'sessionid-egress', r)
  for (const r of EXP_SECRET_RULES) assert.equal(byRule.get(r)[0].dimension, 'secrets-credentials', r)
  for (const r of EXP_ADMIN_RULES) assert.equal(byRule.get(r)[0].dimension, 'admin-surface', r)
  for (const f of findings) {
    assert.equal(f.provenance, 'deterministic')
    assert.equal(f.engine, 'pmd')
    assert.ok(!('class' in f), `${f.ruleId} must stay class-less`)
    assert.match(f.verdict_reasoning, /no toolkit class maps rule/) // the unmapped-CLASS severity fallback branch
  }
  // anchor loci + the class-less CA-severity fallback across all three catalog severities
  const cp = byRule.get('AvoidChangeProtectionUnprotected')[0]
  assert.equal(cp.file, 'force-app/main/default/classes/SeedFeature.cls:4')
  assert.equal(cp.adjusted_severity, 'critical') // CA sev 1 → critical
  const api = byRule.get('AvoidApiSessionId')[0]
  assert.equal(api.file, 'force-app/main/default/objects/Account/webLinks/SeedLink.webLink-meta.xml:11')
  assert.equal(api.adjusted_severity, 'high') // CA sev 2 → high
  const vd = byRule.get('AvoidHardcodedCredentialsInVarDecls')[0]
  assert.equal(vd.file, 'force-app/main/default/classes/SeedCreds.cls:5')
  assert.equal(vd.adjusted_severity, 'medium') // CA sev 3 → medium
  const vf = byRule.get('AvoidHardcodedSecretsInVFAttrs')
  assert.equal(vf.length, 2)
  assert.equal(vf[0].file, 'force-app/main/default/pages/SeedVfSecret.page:2')
  assert.equal(vf[0].id, vf[1].id) // same rule + same startLine locus → same id (columns are not in the locus)
  assert.equal(JSON.stringify(findings), JSON.stringify(ingestCat().findings))
})

check('EXP-skip: the two Remote-Site-Setting rules are DELIBERATELY unrouted — the plain-http-egress + protocol-security-disabled metadata source-scanners own those checks, so routing the CA twins would double-report the same locus (cross-engine dedup is not landed for that pair); a hit ingests at the CA default dimension', () => {
  for (const rule of EXP_SKIP_RULES) {
    assert.ok(!(rule in RULE_DIMENSION), `${rule} must NOT be routed (the source-scanners own the check)`)
    assert.ok(!(rule in RULE_CLASS), `${rule} must not own a class either`)
    const { findings } = ingestCat(sessHit(rule))
    assert.equal(findings.length, 1) // still ingested — security-tagged rules are never dropped
    assert.equal(findings[0].dimension, 'apex-exposed-surface') // DEFAULT_DIMENSION: undifferentiated, not a routed cluster
    assert.ok(!('class' in findings[0]))
  }
})

check('EXP-non-supersession: a routed class-less catalog finding does NOT supersede a co-located llm-inferred finding of a DIFFERENT shape in the same dimension — both the sessionid-egress and the secrets-credentials cluster (where gitleaks/detect-secrets own the hardcoded-secrets class)', () => {
  const findings = ingestCat().findings
  const scenarios = [
    {
      det: findById(findings, (x) => x.ruleId === 'AvoidUnauthorizedApiSessionIdInApex'),
      llm: {
        id: '7'.repeat(16),
        dimension: 'sessionid-egress',
        title: 'Session token forwarded to an external service in a callout header',
        severity: 'critical',
        adjusted_severity: 'critical',
        file: 'force-app/main/default/classes/SeedSessionApi.cls:1-8', // overlaps det's :3
        status: 'confirmed',
        first_seen: 1,
        last_seen: 1,
        verdict: 'confirmed_real',
        verdict_reasoning: 'reasoned over the retrieval-to-callout dataflow',
      },
    },
    {
      det: findById(findings, (x) => x.ruleId === 'AvoidHardcodedCredentialsInHttpHeader'),
      llm: {
        id: '8'.repeat(16),
        dimension: 'secrets-credentials',
        title: 'Credential material logged to a debug sink',
        severity: 'high',
        adjusted_severity: 'high',
        file: 'force-app/main/default/classes/SeedCreds.cls:1-20', // overlaps det's :10
        status: 'confirmed',
        first_seen: 1,
        last_seen: 1,
        verdict: 'confirmed_real',
        verdict_reasoning: 'reasoned over the credential-to-log dataflow',
      },
    },
  ]
  for (const { det, llm } of scenarios) {
    assert.ok(det, 'deterministic catalog finding present')
    assert.equal(det.provenance, 'deterministic')
    // PRECONDITIONS that WOULD fire supersession if the routed rule owned a class: same
    // dimension + overlapping locus. The ONLY missing ingredient is the owned class.
    assert.equal(det.dimension, llm.dimension, 'same dimension')
    assert.equal(sameLocation(det, llm), true, 'overlapping locus')
    const { superseded, supersededIds, findings: out } = reconcileProvenance([det, llm])
    assert.equal(superseded, 0, `${det.ruleId} must not supersede the co-located LLM ${llm.dimension} finding`)
    assert.deepEqual(supersededIds, [])
    assert.equal(out.find((f) => f.id === llm.id).status, 'confirmed')
    assert.equal('class' in det, false, 'no owned class on the routed catalog finding')
  }
})

check('EXP-single-shape: the catalog expansion adds NO owned class — SINGLE_SHAPE is exactly the same 9-set (registry untouched; class-less routing cannot move class ownership)', () => {
  assert.deepEqual(
    [...SINGLE_SHAPE].sort(),
    [
      'admin-privilege-grant',
      'crud-fls',
      'hardcoded-secrets',
      'iac-misconfig',
      'plain-http-egress',
      'protocol-security-disabled',
      'sharing',
      'view-modify-all-data',
      'viewall-overgrant',
    ]
  )
})

// ───────────────────────────────────── pmd-appexchange catalog routing, class-less-safe markup/OAuth clusters (B5 · E0.1d-EXPAND-2, 0.8.77)
// E0.1d-EXPAND routed the catalog's high-confidence clusters; this slice routes the CLASS-LESS-SAFE
// remainder — the rules whose methodology dimension owns NO toolkit class, so routing is pure grouping
// with zero supersession risk: injection-xss (owns "the construction and the escaping"; names the
// aura:unescapedHtml escape hatch + hand-built DOM) and oauth-identity (owns redirect/callback
// correctness + the connected-app OAuth settings surface). The owned-class-dimension remainder
// (package-metadata / secrets-credentials profiles) ROUTED in E0.1d-EXPAND-3, 0.8.78 — see the
// EXP3-* checks; the JS-in-metadata + resource-loader clusters ROUTED in E0.1d-EXPAND-4, 0.8.79 —
// see the EXP4-* checks; the SKIP/NO-OP remainder stays out (EXP2-defer locks the representatives,
// EXP4-noop locks all five Apex-behavior rules). Fixture: a GENUINE `sf code-analyzer run
// --rule-selector AppExchange` capture (Code Analyzer core 0.48.0 / pmd engine 0.41.0) over a seeded
// SFDX corpus — 4 violations across 3 files, firing ALL 4 targeted rules with these exact spellings
// (engine 'pmd', tags AppExchange/Security/<lang>):
//   injection-xss:   AvoidUnescapedHtmlInAura (Aura .cmp <aura:unescapedHtml value="{!v.markup}"/>,
//                    HTML, sev 2) + AvoidCreateElementScriptLinkTag (VF page document.createElement
//                    script+link in one <script> block — fires ONCE at the block's locus, sev 2)
//   oauth-identity:  UseHttpsCallbackUrlConnectedApp (connectedApp-meta.xml http:// <callbackUrl> on a
//                    NON-loopback host — the RFC 8252 loopback allowance is a disposition concern, not
//                    a routing one, sev 3) + LimitConnectedAppScope (<scopes>Full</scopes>, sev 3 —
//                    both fire on the ONE seeded connected app at different loci)
// All routed rows stay class-less: classify() reads only RULE_CLASS, so none of these supersedes
// anything (the SESS posture), and neither dimension appears in any CLASS_DEFS entry.
const ingestMark = (raw) => ingest(raw === undefined ? readJSON(MARKFIX) : raw, codeAnalyzerAdapter, { repoRoot: '', pass: 1 })
const EXP2_XSS_RULES = ['AvoidUnescapedHtmlInAura', 'AvoidCreateElementScriptLinkTag']
const EXP2_OAUTH_RULES = ['UseHttpsCallbackUrlConnectedApp', 'LimitConnectedAppScope']
// the unrouted remainder — after E0.1d-EXPAND-4 (0.8.79) routed the js:-URL/web-link metadata +
// resource-loader clusters (see the EXP4-* checks), what stays out of RULE_DIMENSION is the SKIP
// (AvoidLwcBubblesComposedTrue — LWC event composition, no owning dimension) and the 5 NO-OP
// Apex-behavior rules that deliberately ride DEFAULT_DIMENSION (represented here by
// AvoidUnsafePasswordManagementUse; EXP4-noop locks all five). The owned-class-dimension profile
// (AvoidSControls / ProtectSensitiveData) ROUTED in E0.1d-EXPAND-3 (0.8.78) with its supersession
// posture proven by the EXP3-* checks below: routed rows stay class-less — they supersede nothing
// and, deterministic, are never superseded (no det-vs-det dedup exists in the routing/supersession
// contract; same-dimension co-located deterministic rows coexist).
const EXP2_DEFER_RULES = ['AvoidLwcBubblesComposedTrue', 'AvoidUnsafePasswordManagementUse']

check('EXP2-routing: every class-less-safe markup/OAuth-cluster rule routes by exact name to its dimension (unescaped-HTML + createElement DOM sinks → injection-xss, connected-app callback/scope → oauth-identity); a security-tagged CA hit ingests deterministic / that dimension / class-less; none is in RULE_CLASS', () => {
  const want = new Map([
    ...EXP2_XSS_RULES.map((r) => [r, 'injection-xss']),
    ...EXP2_OAUTH_RULES.map((r) => [r, 'oauth-identity']),
  ])
  for (const [rule, dim] of want) {
    assert.equal(RULE_DIMENSION[rule], dim, `RULE_DIMENSION[${rule}]`)
    assert.ok(!(rule in RULE_CLASS), `${rule} must not own a class`)
    assert.equal(codeAnalyzerAdapter.classify(rule), null, `classify(${rule}) must stay null`)
    const { findings } = ingestMark(sessHit(rule))
    assert.equal(findings.length, 1)
    assert.equal(findings[0].provenance, 'deterministic')
    assert.equal(findings[0].dimension, dim, `ingested dimension for ${rule}`)
    assert.equal(findings[0].status, 'confirmed')
    assert.ok(!('class' in findings[0]), `routed ${rule} finding owns no class`)
  }
})

check('EXP2-fixture: the genuine markup/OAuth CA catalog capture (core 0.48.0 / pmd 0.41.0) lands all 4 rules in their dimensions, class-less, at the seed loci; CA severity fallback intact; byte-deterministic', () => {
  const raw = readJSON(MARKFIX)
  assert.equal(raw.versions['code-analyzer'], '0.48.0') // provenance lock on the committed capture
  assert.equal(raw.versions['pmd'], '0.41.0')
  const { findings } = ingestMark()
  assert.equal(findings.length, 4)
  const byRule = new Map(findings.map((f) => [f.ruleId, f]))
  assert.equal(byRule.size, 4, 'all 4 markup/OAuth-cluster rules fired')
  for (const r of EXP2_XSS_RULES) assert.equal(byRule.get(r).dimension, 'injection-xss', r)
  for (const r of EXP2_OAUTH_RULES) assert.equal(byRule.get(r).dimension, 'oauth-identity', r)
  for (const f of findings) {
    assert.equal(f.provenance, 'deterministic')
    assert.equal(f.engine, 'pmd')
    assert.ok(!('class' in f), `${f.ruleId} must stay class-less`)
    assert.match(f.verdict_reasoning, /no toolkit class maps rule/) // the unmapped-CLASS severity fallback branch
  }
  // anchor loci + the class-less CA-severity fallback across the capture's two catalog severities
  const un = byRule.get('AvoidUnescapedHtmlInAura')
  assert.equal(un.file, 'force-app/main/default/aura/SeedUnescaped/SeedUnescaped.cmp:3')
  assert.equal(un.adjusted_severity, 'high') // CA sev 2 → high
  const ce = byRule.get('AvoidCreateElementScriptLinkTag')
  assert.equal(ce.file, 'force-app/main/default/pages/SeedDomSink.page:2')
  assert.equal(ce.adjusted_severity, 'high') // CA sev 2 → high
  const cb = byRule.get('UseHttpsCallbackUrlConnectedApp')
  assert.equal(cb.file, 'force-app/main/default/connectedApps/SeedConnected.connectedApp-meta.xml:6')
  assert.equal(cb.adjusted_severity, 'medium') // CA sev 3 → medium
  const sc = byRule.get('LimitConnectedAppScope')
  assert.equal(sc.file, 'force-app/main/default/connectedApps/SeedConnected.connectedApp-meta.xml:7')
  assert.equal(sc.adjusted_severity, 'medium') // CA sev 3 → medium
  assert.equal(JSON.stringify(findings), JSON.stringify(ingestMark().findings))
})

check('EXP2-defer: the unrouted remainder stays OUT of RULE_DIMENSION — the SKIP (AvoidLwcBubblesComposedTrue, no owning dimension) and a NO-OP Apex-behavior rep (AvoidUnsafePasswordManagementUse, deliberately riding the default); a hit ingests at the CA default dimension', () => {
  for (const rule of EXP2_DEFER_RULES) {
    assert.ok(!(rule in RULE_DIMENSION), `${rule} must NOT be routed (SKIP / deliberate-default posture)`)
    assert.ok(!(rule in RULE_CLASS), `${rule} must not own a class either`)
    const { findings } = ingestMark(sessHit(rule))
    assert.equal(findings.length, 1) // still ingested — security-tagged rules are never dropped
    assert.equal(findings[0].dimension, 'apex-exposed-surface') // DEFAULT_DIMENSION: undifferentiated, not a routed cluster
    assert.ok(!('class' in findings[0]))
  }
})

check('EXP2-non-supersession: a routed class-less markup/OAuth finding does NOT supersede a co-located llm-inferred finding of a DIFFERENT shape in the same dimension — both the injection-xss and the oauth-identity cluster (neither dimension owns any toolkit class)', () => {
  const findings = ingestMark().findings
  const scenarios = [
    {
      det: findById(findings, (x) => x.ruleId === 'AvoidUnescapedHtmlInAura'),
      llm: {
        id: '9'.repeat(16),
        dimension: 'injection-xss',
        title: 'Stored XSS via an externally-synced field rendered in the component',
        severity: 'high',
        adjusted_severity: 'high',
        file: 'force-app/main/default/aura/SeedUnescaped/SeedUnescaped.cmp:1-4', // overlaps det's :3
        status: 'confirmed',
        first_seen: 1,
        last_seen: 1,
        verdict: 'confirmed_real',
        verdict_reasoning: 'reasoned over the sync-write-then-render dataflow',
      },
    },
    {
      det: findById(findings, (x) => x.ruleId === 'UseHttpsCallbackUrlConnectedApp'),
      llm: {
        id: 'a'.repeat(16),
        dimension: 'oauth-identity',
        title: 'Callback host accepts a prefix-matched redirect target',
        severity: 'high',
        adjusted_severity: 'high',
        file: 'force-app/main/default/connectedApps/SeedConnected.connectedApp-meta.xml:1-9', // overlaps det's :6
        status: 'confirmed',
        first_seen: 1,
        last_seen: 1,
        verdict: 'confirmed_real',
        verdict_reasoning: 'reasoned over the redirect-target matching behavior',
      },
    },
  ]
  for (const { det, llm } of scenarios) {
    assert.ok(det, 'deterministic catalog finding present')
    assert.equal(det.provenance, 'deterministic')
    // PRECONDITIONS that WOULD fire supersession if the routed rule owned a class: same
    // dimension + overlapping locus. The ONLY missing ingredient is the owned class.
    assert.equal(det.dimension, llm.dimension, 'same dimension')
    assert.equal(sameLocation(det, llm), true, 'overlapping locus')
    const { superseded, supersededIds, findings: out } = reconcileProvenance([det, llm])
    assert.equal(superseded, 0, `${det.ruleId} must not supersede the co-located LLM ${llm.dimension} finding`)
    assert.deepEqual(supersededIds, [])
    assert.equal(out.find((f) => f.id === llm.id).status, 'confirmed')
    assert.equal('class' in det, false, 'no owned class on the routed catalog finding')
  }
})

check('EXP2-single-shape: the markup/OAuth expansion adds NO owned class — SINGLE_SHAPE is exactly the same 9-set, and neither injection-xss nor oauth-identity appears in any CLASS_DEFS dimension (the class-less-safe premise, asserted)', () => {
  assert.deepEqual(
    [...SINGLE_SHAPE].sort(),
    [
      'admin-privilege-grant',
      'crud-fls',
      'hardcoded-secrets',
      'iac-misconfig',
      'plain-http-egress',
      'protocol-security-disabled',
      'sharing',
      'view-modify-all-data',
      'viewall-overgrant',
    ]
  )
  const ownedDims = new Set(Object.values(CLASS_DEFS).map((d) => d.dimension))
  assert.ok(!ownedDims.has('injection-xss'), 'injection-xss must own no toolkit class')
  assert.ok(!ownedDims.has('oauth-identity'), 'oauth-identity must own no toolkit class')
})

// ───────────────────────────────────── pmd-appexchange catalog routing, owned-class-dimension metadata clusters (B5 · E0.1d-EXPAND-3, 0.8.78)
// E0.1d-EXPAND-2 routed the class-less-safe clusters (dimensions owning NO toolkit class); this slice
// routes the OWNED-CLASS-DIMENSION remainder — the rules whose target dimension DOES own a toolkit
// class: package-metadata (owned by plain-http-egress + protocol-security-disabled) and
// secrets-credentials (owned by hardcoded-secrets, the secret scanners). Same class-less posture as
// the 0.8.76 credential cluster. The supersession contract the EXP3-* checks lock (verified against
// reconcile-provenance.mjs, which supersedes llm-inferred candidates ONLY — a deterministic finding
// is never touched):
//   (1) a routed class-less row supersedes NOTHING (EXP3-non-supersession);
//   (2) the dimension's owned class keeps SOLE supersession authority over a co-located LLM
//       re-report, undisturbed by the routed row's presence (EXP3-authority — for package-metadata
//       a NEW positive owner-supersedes-LLM lock among the ingested-adapter locks, alongside the
//       secrets dimension's GL-/DS-supersedes-LLM; the generic reconcile suite's R1 exercises a
//       crud-fls owner);
//   (3) the routed deterministic row is NEVER the superseded party — co-located deterministic rows
//       of the same dimension COEXIST as separate ledger entries, never hidden (EXP3-authority +
//       EXP3-det-coexist). No det-vs-det dedup exists in the routing/supersession contract.
// The owned scanners' REAL loci are disjoint from the routed rules' loci (the egress/protocol
// config suffixes {.remoteSite,.cspTrustedSite,.namedCredential}-meta.xml vs S-Control / Aura
// bundle / messageChannel files), so the co-locations below are SYNTHETIC — safety-property locks,
// not observed collisions.
// Fixture: a GENUINE `sf code-analyzer run --rule-selector AppExchange` capture (Code Analyzer core
// 0.48.0 / pmd engine 0.41.0) over a seeded SFDX corpus — 4 violations across 4 files, firing ALL 4
// targeted rules with these exact spellings (engine 'pmd', tags AppExchange/Security/XML):
//   package-metadata:    AvoidSControls (a Scontrol metadata root element present — prohibited
//                        managed-package markup, sev 1) + AvoidAuraWithLockerDisabled (Aura bundle
//                        .cmp-meta.xml <apiVersion>39.0 — below the Locker floor, sev 1) +
//                        AvoidLmcIsExposedTrue (messageChannel-meta.xml <isExposed>true, sev 2)
//   secrets-credentials: ProtectSensitiveData (a credential-shaped custom-setting field on a
//                        public List custom setting — belongs in Protected Custom
//                        Metadata/Settings; the rule reads the field NAME, not a value, sev 3)
const ingestOwnDim = (raw) => ingest(raw === undefined ? readJSON(OWNDIMFIX) : raw, codeAnalyzerAdapter, { repoRoot: '', pass: 1 })
const EXP3_PKG_RULES = ['AvoidSControls', 'AvoidAuraWithLockerDisabled', 'AvoidLmcIsExposedTrue']
const EXP3_SECRET_RULES = ['ProtectSensitiveData']
// a synthetic plain-http-egress OWNED-class deterministic finding placed at a routed row's locus
// (SYNTHETIC co-location per the disjointness note above — real egress loci never share these files)
const exp3EgressOwnerAt = (file) => ({
  id: 'e'.repeat(16),
  provenance: 'deterministic',
  engine: 'egress-plain-http',
  ruleId: 'egress-plain-http',
  class: 'plain-http-egress',
  dimension: 'package-metadata',
  severity: 'high',
  adjusted_severity: 'high',
  file,
  status: 'confirmed',
  first_seen: 1,
  last_seen: 1,
})
// an INGESTED gitleaks-shaped owned-class finding (the GL-supersedes-LLM party) at a chosen locus
const exp3GitleaksOwnerAt = (file, line) =>
  ingest([{ RuleID: 'generic-api-key', File: file, StartLine: line }], gitleaksAdapter, { repoRoot: '', pass: 1 }).findings[0]

check('EXP3-routing: every owned-class-dimension cluster rule routes by exact name to its dimension (S-Control / Aura-Locker-apiVersion / LMC-isExposed → package-metadata, sensitive-data-in-XML → secrets-credentials); a security-tagged CA hit ingests deterministic / that dimension / class-less; none is in RULE_CLASS', () => {
  const want = new Map([
    ...EXP3_PKG_RULES.map((r) => [r, 'package-metadata']),
    ...EXP3_SECRET_RULES.map((r) => [r, 'secrets-credentials']),
  ])
  for (const [rule, dim] of want) {
    assert.equal(RULE_DIMENSION[rule], dim, `RULE_DIMENSION[${rule}]`)
    assert.ok(!(rule in RULE_CLASS), `${rule} must not own a class`)
    assert.equal(codeAnalyzerAdapter.classify(rule), null, `classify(${rule}) must stay null`)
    const { findings } = ingestOwnDim(sessHit(rule))
    assert.equal(findings.length, 1)
    assert.equal(findings[0].provenance, 'deterministic')
    assert.equal(findings[0].dimension, dim, `ingested dimension for ${rule}`)
    assert.equal(findings[0].status, 'confirmed')
    assert.ok(!('class' in findings[0]), `routed ${rule} finding owns no class`)
  }
})

check('EXP3-fixture: the genuine owned-class-dimension CA catalog capture (core 0.48.0 / pmd 0.41.0) lands all 4 rules in their dimensions, class-less, at the seed loci; CA severity fallback intact across all three catalog severities; byte-deterministic', () => {
  const raw = readJSON(OWNDIMFIX)
  assert.equal(raw.versions['code-analyzer'], '0.48.0') // provenance lock on the committed capture
  assert.equal(raw.versions['pmd'], '0.41.0')
  const { findings } = ingestOwnDim()
  assert.equal(findings.length, 4)
  const byRule = new Map(findings.map((f) => [f.ruleId, f]))
  assert.equal(byRule.size, 4, 'all 4 owned-class-dimension cluster rules fired')
  for (const r of EXP3_PKG_RULES) assert.equal(byRule.get(r).dimension, 'package-metadata', r)
  for (const r of EXP3_SECRET_RULES) assert.equal(byRule.get(r).dimension, 'secrets-credentials', r)
  for (const f of findings) {
    assert.equal(f.provenance, 'deterministic')
    assert.equal(f.engine, 'pmd')
    assert.ok(!('class' in f), `${f.ruleId} must stay class-less`)
    assert.match(f.verdict_reasoning, /no toolkit class maps rule/) // the unmapped-CLASS severity fallback branch
  }
  // anchor loci + the class-less CA-severity fallback across all three catalog severities
  const sc = byRule.get('AvoidSControls')
  assert.equal(sc.file, 'force-app/main/default/scontrols/SeedLegacyControl.scf-meta.xml:2')
  assert.equal(sc.adjusted_severity, 'critical') // CA sev 1 → critical
  const au = byRule.get('AvoidAuraWithLockerDisabled')
  assert.equal(au.file, 'force-app/main/default/aura/SeedLocker/SeedLocker.cmp-meta.xml:3')
  assert.equal(au.adjusted_severity, 'critical') // CA sev 1 → critical
  const lmc = byRule.get('AvoidLmcIsExposedTrue')
  assert.equal(lmc.file, 'force-app/main/default/messageChannels/SeedChannel.messageChannel-meta.xml:4')
  assert.equal(lmc.adjusted_severity, 'high') // CA sev 2 → high
  const psd = byRule.get('ProtectSensitiveData')
  assert.equal(psd.file, 'force-app/main/default/objects/Seed_Config__c/fields/API_Key__c.field-meta.xml:1')
  assert.equal(psd.adjusted_severity, 'medium') // CA sev 3 → medium
  assert.equal(JSON.stringify(findings), JSON.stringify(ingestOwnDim().findings))
})

check('EXP3-non-supersession (routed row supersedes nothing): a routed class-less owned-dim-cluster finding does NOT supersede a co-located llm-inferred finding of the SAME dimension — both the package-metadata and the secrets-credentials cluster (each dimension\'s owned class stays with its source scanner)', () => {
  const findings = ingestOwnDim().findings
  const scenarios = [
    {
      det: findById(findings, (x) => x.ruleId === 'AvoidAuraWithLockerDisabled'),
      llm: {
        id: 'b'.repeat(16),
        dimension: 'package-metadata',
        title: 'Component bundle metadata declares a pre-Locker apiVersion band',
        severity: 'high',
        adjusted_severity: 'high',
        file: 'force-app/main/default/aura/SeedLocker/SeedLocker.cmp-meta.xml:1-6', // overlaps det's :3
        status: 'confirmed',
        first_seen: 1,
        last_seen: 1,
        verdict: 'confirmed_real',
        verdict_reasoning: 'reasoned over the bundle metadata declaration',
      },
    },
    {
      det: findById(findings, (x) => x.ruleId === 'ProtectSensitiveData'),
      llm: {
        id: 'c'.repeat(16),
        dimension: 'secrets-credentials',
        title: 'Credential-shaped field stored outside Protected Custom Settings',
        severity: 'high',
        adjusted_severity: 'high',
        file: 'force-app/main/default/objects/Seed_Config__c/fields/API_Key__c.field-meta.xml:1-5', // overlaps det's :1
        status: 'confirmed',
        first_seen: 1,
        last_seen: 1,
        verdict: 'confirmed_real',
        verdict_reasoning: 'reasoned over the field storage posture',
      },
    },
  ]
  for (const { det, llm } of scenarios) {
    assert.ok(det, 'deterministic catalog finding present')
    assert.equal(det.provenance, 'deterministic')
    // PRECONDITIONS that WOULD fire supersession if the routed rule owned a class: same
    // dimension + overlapping locus. The ONLY missing ingredient is the owned class.
    assert.equal(det.dimension, llm.dimension, 'same dimension')
    assert.equal(sameLocation(det, llm), true, 'overlapping locus')
    const { superseded, supersededIds, findings: out } = reconcileProvenance([det, llm])
    assert.equal(superseded, 0, `${det.ruleId} must not supersede the co-located LLM ${llm.dimension} finding`)
    assert.deepEqual(supersededIds, [])
    assert.equal(out.find((f) => f.id === llm.id).status, 'confirmed')
    assert.equal('class' in det, false, 'no owned class on the routed catalog finding')
  }
})

check('EXP3-authority (owner authority undisturbed + routed row never the superseded party): a three-party reconcile [owned-class det, routed class-less CA det, co-located LLM] supersedes EXACTLY the LLM finding, by the OWNER — package-metadata via a synthetic plain-http-egress owner (a NEW positive owner-supersedes-LLM lock) and secrets-credentials via the ingested gitleaks shape; SYNTHETIC co-location (real loci are disjoint — a safety-property lock, not an observed collision)', () => {
  const findings = ingestOwnDim().findings
  const scenarios = [
    {
      routed: findById(findings, (x) => x.ruleId === 'AvoidLmcIsExposedTrue'),
      owned: exp3EgressOwnerAt('force-app/main/default/messageChannels/SeedChannel.messageChannel-meta.xml:1-8'),
      llm: {
        id: 'd'.repeat(16),
        dimension: 'package-metadata',
        title: 'Package metadata exposes a cross-namespace surface',
        severity: 'high',
        adjusted_severity: 'high',
        file: 'force-app/main/default/messageChannels/SeedChannel.messageChannel-meta.xml:2-6', // overlaps both dets
        status: 'confirmed',
        first_seen: 1,
        last_seen: 1,
        verdict: 'confirmed_real',
        verdict_reasoning: 'reasoned over the exposed metadata surface',
      },
    },
    {
      routed: findById(findings, (x) => x.ruleId === 'ProtectSensitiveData'),
      owned: exp3GitleaksOwnerAt('force-app/main/default/objects/Seed_Config__c/fields/API_Key__c.field-meta.xml', 1),
      llm: {
        id: 'f'.repeat(16),
        dimension: 'secrets-credentials',
        title: 'Hardcoded credential material in package metadata',
        severity: 'high',
        adjusted_severity: 'high',
        file: 'force-app/main/default/objects/Seed_Config__c/fields/API_Key__c.field-meta.xml:1-5', // overlaps both dets
        status: 'confirmed',
        first_seen: 1,
        last_seen: 1,
        verdict: 'confirmed_real',
        verdict_reasoning: 'reasoned the field looks credential-bearing',
      },
    },
  ]
  for (const { routed, owned, llm } of scenarios) {
    assert.ok(routed && owned, 'both deterministic parties present')
    assert.equal(routed.provenance, 'deterministic')
    assert.equal(owned.provenance, 'deterministic')
    assert.ok(owned.class, 'the owner carries its toolkit class')
    // synthetic co-location preconditions: one dimension, every locus overlapping
    assert.equal(owned.dimension, llm.dimension, 'owner shares the dimension')
    assert.equal(routed.dimension, llm.dimension, 'routed row shares the dimension')
    assert.equal(sameLocation(owned, llm), true, 'owner overlaps the LLM locus')
    assert.equal(sameLocation(routed, llm), true, 'routed row overlaps the LLM locus')
    const { findings: out, superseded, supersededIds } = reconcileProvenance([owned, routed, llm])
    assert.equal(superseded, 1, 'exactly the LLM finding is superseded')
    assert.deepEqual(supersededIds, [llm.id])
    const outLlm = out.find((f) => f.id === llm.id)
    assert.equal(outLlm.status, 'superseded')
    assert.equal(outLlm.superseded_by, owned.id, 'the OWNER supersedes — never the routed row')
    const outRouted = out.find((f) => f.id === routed.id)
    assert.equal(outRouted.status, 'confirmed', 'the routed deterministic row is never the superseded party')
    assert.ok(!('class' in outRouted), 'the routed row stays class-less')
    const outOwned = out.find((f) => f.id === owned.id)
    assert.equal(outOwned.status, 'confirmed', 'the owner is untouched')
  }
})

check('EXP3-det-coexist: reconcile over [owned-class det, routed class-less CA det] ALONE (no LLM party) supersedes nothing — co-located deterministic rows of the same dimension coexist as separate ledger entries, independent of any LLM path (no det-vs-det dedup in the routing/supersession contract)', () => {
  const findings = ingestOwnDim().findings
  const scenarios = [
    {
      routed: findById(findings, (x) => x.ruleId === 'AvoidLmcIsExposedTrue'),
      owned: exp3EgressOwnerAt('force-app/main/default/messageChannels/SeedChannel.messageChannel-meta.xml:1-8'),
    },
    {
      routed: findById(findings, (x) => x.ruleId === 'ProtectSensitiveData'),
      owned: exp3GitleaksOwnerAt('force-app/main/default/objects/Seed_Config__c/fields/API_Key__c.field-meta.xml', 1),
    },
  ]
  for (const { routed, owned } of scenarios) {
    // SYNTHETIC co-location (real loci are disjoint in practice — see the section note)
    assert.equal(owned.dimension, routed.dimension, 'same dimension')
    assert.equal(sameLocation(owned, routed), true, 'overlapping locus')
    const { findings: out, superseded, supersededIds } = reconcileProvenance([owned, routed])
    assert.equal(superseded, 0, 'no deterministic row supersedes another')
    assert.deepEqual(supersededIds, [])
    for (const f of out) assert.equal(f.status, 'confirmed')
  }
})

check('EXP3-single-shape: the owned-class-dimension expansion adds NO owned class — SINGLE_SHAPE is exactly the same 9-set; the routed dimensions ARE class-owning (package-metadata via plain-http-egress + protocol-security-disabled, secrets-credentials via hardcoded-secrets — the owned-class premise the EXP3 supersession locks rest on)', () => {
  assert.deepEqual(
    [...SINGLE_SHAPE].sort(),
    [
      'admin-privilege-grant',
      'crud-fls',
      'hardcoded-secrets',
      'iac-misconfig',
      'plain-http-egress',
      'protocol-security-disabled',
      'sharing',
      'view-modify-all-data',
      'viewall-overgrant',
    ]
  )
  const ownedDims = new Set(Object.values(CLASS_DEFS).map((d) => d.dimension))
  assert.ok(ownedDims.has('package-metadata'), 'package-metadata owns toolkit classes (the EXP3 premise)')
  assert.ok(ownedDims.has('secrets-credentials'), 'secrets-credentials owns a toolkit class (the EXP3 premise)')
  assert.equal(CLASS_DEFS['plain-http-egress'].dimension, 'package-metadata')
  assert.equal(CLASS_DEFS['protocol-security-disabled'].dimension, 'package-metadata')
  assert.equal(CLASS_DEFS['hardcoded-secrets'].dimension, 'secrets-credentials')
})

check('EXP3-defer: the unrouted catalog remainder stays OUT of RULE_DIMENSION — after E0.1d-EXPAND-4 routed the js:-URL/web-link + resource-loader clusters, the representatives left are the SKIP (AvoidLwcBubblesComposedTrue, LWC event composition — no owning dimension) and the NO-OP Apex-behavior rep (AvoidUnsafePasswordManagementUse, deliberately riding DEFAULT_DIMENSION): unrouted, class-less, classify() null', () => {
  for (const rule of ['AvoidLwcBubblesComposedTrue', 'AvoidUnsafePasswordManagementUse']) {
    assert.ok(!(rule in RULE_DIMENSION), `${rule} must NOT be routed (SKIP / deliberate-default posture)`)
    assert.ok(!(rule in RULE_CLASS), `${rule} must not own a class either`)
    assert.equal(codeAnalyzerAdapter.classify(rule), null, `classify(${rule}) must stay null`)
  }
})

// ───────────────────────────────────── pmd-appexchange catalog routing, JS-in-metadata + resource-loader clusters (B5 · E0.1d-EXPAND-4, 0.8.79)
// E0.1d-EXPAND-3 routed the owned-class-dimension metadata clusters; this slice routes the catalog's
// JavaScript-in-metadata + resource-loader rules, ALL into package-metadata (already in the routed
// 6-set — NO new dimension, no SESS-disjoint change). Same class-less posture as every routed row:
// a routed finding supersedes nothing and, deterministic, is never itself superseded; the
// package-metadata owner-supersedes-LLM authority is already locked by EXP3-authority and is NOT
// re-proven here. The owned scanners' loci ({.remoteSite,.cspTrustedSite,.namedCredential}-meta.xml)
// stay disjoint from these rules' loci (weblink / object webLink / home-page-component / VF page).
// Grounding: package-metadata.md class 3 (JavaScript actions / javascript: URLs DECLARED in package
// metadata — the in-page XSS SINK stays injection-xss's territory, the seam the dimension doc
// resolves in-text) + class 5 (resource-loader hotlinks — external-host loads instead of $Resource).
// Fixture: a GENUINE `sf code-analyzer run --rule-selector AppExchange` capture (Code Analyzer core
// 0.48.0 / pmd engine 0.41.0) over a seeded SFDX corpus — 8 violations across 5 files, firing ALL 8
// targeted rules with these exact spellings (engine 'pmd', tags AppExchange/Security/<lang>):
//   class 3 (JS-in-metadata): AvoidJavaScriptInUrls (a javascript: <url> link target on a custom
//                             page weblink, sev 1) + AvoidJavaScriptWebLink (CustomPageWebLink
//                             <openType>onClickJavaScript, sev 2) + AvoidJavaScriptCustomObject
//                             (object-nested WebLink onClickJavaScript action, sev 2) +
//                             AvoidJavaScriptHomePageComponent (<script> markup in a
//                             home-page-component <body>, sev 2)
//   class 5 (resource loader): LoadJavaScriptHtmlScript + LoadCSSLinkHref +
//                             LoadJavaScriptIncludeScript + LoadCSSApexStylesheet (one seeded VF
//                             page hotlinking script/css from a non-$Resource external host, sev 2)
// THE Load* FP-BREADTH PROBE (the fixture-gate the routing decision hung on): the same capture
// seeded a SECOND VF page with ONLY inline <script>/<style> blocks plus the safe {!$Resource...}
// includeScript/stylesheet idiom — it produced ZERO violations. The Load* rules fire ONLY on the
// non-$Resource external load, so they are hotlink detectors (low-FP), not high-volume inline
// flags → ROUTED, none dropped.
const ingestJsMeta = (raw) => ingest(raw === undefined ? readJSON(JSMETAFIX) : raw, codeAnalyzerAdapter, { repoRoot: '', pass: 1 })
const EXP4_JS_RULES = ['AvoidJavaScriptInUrls', 'AvoidJavaScriptWebLink', 'AvoidJavaScriptCustomObject', 'AvoidJavaScriptHomePageComponent']
const EXP4_LOADER_RULES = ['LoadCSSApexStylesheet', 'LoadCSSLinkHref', 'LoadJavaScriptHtmlScript', 'LoadJavaScriptIncludeScript']
// the 5 NO-OP Apex-behavior rules — deliberately UNROUTED (they already default to
// apex-exposed-surface, the CORRECT dimension: global-method over-exposure, Apex CRUD/FLS behavior,
// password/setPassword over-exposed entry points). A RULE_DIMENSION row would be a no-op that BREAKS
// the build: SESS-disjoint's set-membership lock excludes apex-exposed-surface from the routed-value
// set. EXP4-noop locks each name to the default.
const EXP4_NOOP_RULES = ['AvoidGlobalInstallUninstallHandlers', 'AvoidUnsafePasswordManagementUse', 'AvoidGetInstanceWithTaint', 'AvoidSecurityEnforcedOldApiVersion', 'AvoidInvalidCrudContentDistribution']

check('EXP4-routing: every JS-in-metadata + resource-loader cluster rule routes by exact name to package-metadata (javascript:-URL/weblink/object-webLink/home-page-component declarations + the 4 non-$Resource hotlink loaders); a security-tagged CA hit ingests deterministic / package-metadata / class-less; none is in RULE_CLASS', () => {
  for (const rule of [...EXP4_JS_RULES, ...EXP4_LOADER_RULES]) {
    assert.equal(RULE_DIMENSION[rule], 'package-metadata', `RULE_DIMENSION[${rule}]`)
    assert.ok(!(rule in RULE_CLASS), `${rule} must not own a class`)
    assert.equal(codeAnalyzerAdapter.classify(rule), null, `classify(${rule}) must stay null`)
    const { findings } = ingestJsMeta(sessHit(rule))
    assert.equal(findings.length, 1)
    assert.equal(findings[0].provenance, 'deterministic')
    assert.equal(findings[0].dimension, 'package-metadata', `ingested dimension for ${rule}`)
    assert.equal(findings[0].status, 'confirmed')
    assert.ok(!('class' in findings[0]), `routed ${rule} finding owns no class`)
  }
})

check('EXP4-fixture: the genuine JS-in-metadata + resource-loader CA catalog capture (core 0.48.0 / pmd 0.41.0) lands all 8 rules in package-metadata, class-less, at the seed loci; the inline/$Resource probe page produced ZERO violations (the Load* fixture-gate); CA severity fallback intact; byte-deterministic', () => {
  const raw = readJSON(JSMETAFIX)
  assert.equal(raw.versions['code-analyzer'], '0.48.0') // provenance lock on the committed capture
  assert.equal(raw.versions['pmd'], '0.41.0')
  const { findings } = ingestJsMeta()
  assert.equal(findings.length, 8)
  const byRule = new Map(findings.map((f) => [f.ruleId, f]))
  assert.equal(byRule.size, 8, 'all 8 JS-in-metadata + resource-loader cluster rules fired')
  for (const f of findings) {
    assert.equal(f.provenance, 'deterministic')
    assert.equal(f.engine, 'pmd')
    assert.equal(f.dimension, 'package-metadata', f.ruleId)
    assert.ok(!('class' in f), `${f.ruleId} must stay class-less`)
    assert.match(f.verdict_reasoning, /no toolkit class maps rule/) // the unmapped-CLASS severity fallback branch
  }
  // THE PROBE EVIDENCE, asserted: the capture's workspace held a SeedInlineProbe.page (inline
  // <script>/<style> + {!$Resource...} loads) and NOTHING in the capture fired on it — the Load*
  // rules flag only the non-$Resource external hotlink page.
  assert.ok(findings.every((f) => !f.file.includes('SeedInlineProbe')), 'the inline/$Resource probe page must stay violation-free')
  // anchor loci + the class-less CA-severity fallback across the capture's two catalog severities
  const ju = byRule.get('AvoidJavaScriptInUrls')
  assert.equal(ju.file, 'force-app/main/default/weblinks/SeedJsUrl.weblink-meta.xml:11')
  assert.equal(ju.adjusted_severity, 'critical') // CA sev 1 → critical
  const jw = byRule.get('AvoidJavaScriptWebLink')
  assert.equal(jw.file, 'force-app/main/default/weblinks/SeedJsAction.weblink-meta.xml:8')
  assert.equal(jw.adjusted_severity, 'high') // CA sev 2 → high
  const jo = byRule.get('AvoidJavaScriptCustomObject')
  assert.equal(jo.file, 'force-app/main/default/objects/Seed_Widget__c/webLinks/SeedObjJsAction.webLink-meta.xml:9')
  assert.equal(jo.adjusted_severity, 'high') // CA sev 2 → high
  const jh = byRule.get('AvoidJavaScriptHomePageComponent')
  assert.equal(jh.file, 'force-app/main/default/homePageComponents/SeedHomeWidget.homePageComponent-meta.xml:3')
  assert.equal(jh.adjusted_severity, 'high') // CA sev 2 → high
  // all four Load* hotlink rules fired on the ONE external-probe page, one locus each
  const loaderLoci = new Map([
    ['LoadJavaScriptHtmlScript', 'force-app/main/default/pages/SeedExternalProbe.page:2'],
    ['LoadCSSLinkHref', 'force-app/main/default/pages/SeedExternalProbe.page:3'],
    ['LoadJavaScriptIncludeScript', 'force-app/main/default/pages/SeedExternalProbe.page:4'],
    ['LoadCSSApexStylesheet', 'force-app/main/default/pages/SeedExternalProbe.page:5'],
  ])
  for (const [rule, locus] of loaderLoci) {
    assert.equal(byRule.get(rule).file, locus, rule)
    assert.equal(byRule.get(rule).adjusted_severity, 'high', rule) // CA sev 2 → high
  }
  assert.equal(JSON.stringify(findings), JSON.stringify(ingestJsMeta().findings))
})

check('EXP4-non-supersession (routed row supersedes nothing): a routed class-less JS-in-metadata / resource-loader finding does NOT supersede a co-located llm-inferred package-metadata finding — the preconditions that WOULD fire supersession (same dimension + overlapping locus) hold, and only the owned class is missing (EXP3-authority already locks the owner direction; not re-proven here)', () => {
  const findings = ingestJsMeta().findings
  const scenarios = [
    {
      det: findById(findings, (x) => x.ruleId === 'AvoidJavaScriptWebLink'),
      llm: {
        id: '1a'.repeat(8),
        dimension: 'package-metadata',
        title: 'Custom weblink action declares an executable JavaScript payload',
        severity: 'high',
        adjusted_severity: 'high',
        file: 'force-app/main/default/weblinks/SeedJsAction.weblink-meta.xml:1-11', // overlaps det's :8
        status: 'confirmed',
        first_seen: 1,
        last_seen: 1,
        verdict: 'confirmed_real',
        verdict_reasoning: 'reasoned over the weblink action declaration',
      },
    },
    {
      det: findById(findings, (x) => x.ruleId === 'LoadJavaScriptHtmlScript'),
      llm: {
        id: '2b'.repeat(8),
        dimension: 'package-metadata',
        title: 'Page pulls executable script from an uncontrolled external host',
        severity: 'high',
        adjusted_severity: 'high',
        file: 'force-app/main/default/pages/SeedExternalProbe.page:1-6', // overlaps det's :2
        status: 'confirmed',
        first_seen: 1,
        last_seen: 1,
        verdict: 'confirmed_real',
        verdict_reasoning: 'reasoned over the external script load',
      },
    },
  ]
  for (const { det, llm } of scenarios) {
    assert.ok(det, 'deterministic catalog finding present')
    assert.equal(det.provenance, 'deterministic')
    // PRECONDITIONS that WOULD fire supersession if the routed rule owned a class: same
    // dimension + overlapping locus. The ONLY missing ingredient is the owned class.
    assert.equal(det.dimension, llm.dimension, 'same dimension')
    assert.equal(sameLocation(det, llm), true, 'overlapping locus')
    const { superseded, supersededIds, findings: out } = reconcileProvenance([det, llm])
    assert.equal(superseded, 0, `${det.ruleId} must not supersede the co-located LLM package-metadata finding`)
    assert.deepEqual(supersededIds, [])
    assert.equal(out.find((f) => f.id === llm.id).status, 'confirmed')
    assert.equal('class' in det, false, 'no owned class on the routed catalog finding')
  }
})

check('EXP4-noop (the NO-OP lock): each of the 5 Apex-behavior rules is NOT in RULE_DIMENSION and a security-tagged hit ingests at apex-exposed-surface (DEFAULT_DIMENSION) — the CORRECT dimension for global-method over-exposure / Apex CRUD-FLS / password entry points; a RULE_DIMENSION row would be a no-op that fails SESS-disjoint (apex-exposed-surface is outside the routed-value set)', () => {
  for (const rule of EXP4_NOOP_RULES) {
    assert.ok(!(rule in RULE_DIMENSION), `${rule} must stay UNROUTED (deliberate DEFAULT_DIMENSION posture)`)
    assert.ok(!(rule in RULE_CLASS), `${rule} must not own a class`)
    assert.equal(codeAnalyzerAdapter.classify(rule), null, `classify(${rule}) must stay null`)
    const { findings } = ingestJsMeta(sessHit(rule))
    assert.equal(findings.length, 1) // still ingested — security-tagged rules are never dropped
    assert.equal(findings[0].dimension, 'apex-exposed-surface', `${rule} rides DEFAULT_DIMENSION`)
    assert.ok(!('class' in findings[0]))
  }
})

check('EXP4-single-shape: the JS-in-metadata + resource-loader expansion adds NO owned class — SINGLE_SHAPE is exactly the same 9-set', () => {
  assert.deepEqual(
    [...SINGLE_SHAPE].sort(),
    [
      'admin-privilege-grant',
      'crud-fls',
      'hardcoded-secrets',
      'iac-misconfig',
      'plain-http-egress',
      'protocol-security-disabled',
      'sharing',
      'view-modify-all-data',
      'viewall-overgrant',
    ]
  )
})

// ───────────────────────────────────── gitleaks (Phase 2 · 2a #5 — hardcoded secrets, class-severity)
// The DESIGN PIVOT BACK to class-severity (like checkov, NOT the SG/BN/NJ tool→band path): a secret
// has no tool-severity tier, so severity comes from the `fail-hardcoded-secrets` CLASS (major → high).
// TWO things make gitleaks distinct from every prior adapter: (1) it owns a class AND a REAL methodology
// dimension (`secrets-credentials`), so it SUPERSEDES a co-located LLM secrets finding (GL-supersedes-LLM);
// (2) its raw output CONTAINS the live secret (Match/Secret) + commit PII (Author/Email/Message), so the
// adapter is built to NEVER pass any of those downstream — the secret-never-leaks invariant, the
// load-bearing test of this slice (GL-SECRET-NEVER-LEAKS). The real fixture is 3× generic-api-key.
const ingestGitleaks = (raw) => ingest(raw === undefined ? readJSON(GITLEAKS) : raw, gitleaksAdapter, { repoRoot: '', pass: 1 })

check('GL-determinism: ingest the real gitleaks fixture twice → byte-identical findings', () => {
  const a = ingestGitleaks().findings
  const b = ingestGitleaks().findings
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})

check('GL-anchor: generic-api-key @ mcp/server.py:27 → deterministic/gitleaks/hardcoded-secrets/secrets-credentials/HIGH (class, from fail-hardcoded-secrets)', () => {
  const { findings } = ingestGitleaks()
  const f = findById(findings, (x) => x.file.endsWith('mcp/server.py:27'))
  assert.ok(f, 'the mcp/server.py:27 anchor is not present')
  assert.equal(f.provenance, 'deterministic')
  assert.equal(f.engine, 'gitleaks')
  assert.equal(f.ruleId, 'generic-api-key')
  assert.equal(f.class, 'hardcoded-secrets') // owns the hardcoded-secrets class
  assert.equal(f.dimension, 'secrets-credentials') // a REAL methodology dimension
  assert.equal(f.adjusted_severity, 'high') // from the class (fail-hardcoded-secrets=major→high), NOT a tool tier
  assert.equal(f.status, 'confirmed')
  assert.match(f.id, /^[0-9a-f]{16}$/)
})

check('GL-count: the real fixture → exactly 3 generic-api-key findings, all gitleaks/hardcoded-secrets/high', () => {
  const { findings } = ingestGitleaks()
  assert.equal(findings.length, 3)
  assert.deepEqual(findings.map((f) => f.ruleId), ['generic-api-key', 'generic-api-key', 'generic-api-key'])
  assert.ok(findings.every((f) => f.engine === 'gitleaks' && f.class === 'hardcoded-secrets' && f.dimension === 'secrets-credentials' && f.adjusted_severity === 'high'))
  const files = findings.map((f) => f.file).sort()
  assert.ok(files.some((p) => p.endsWith('mcp/server.py:27')))
  assert.equal(files.filter((p) => p.endsWith('ops/deploy-notes.md:7') || p.endsWith('ops/deploy-notes.md:9')).length, 2)
})

check('GL-SECRET-NEVER-LEAKS: a finding carrying a live secret + PII in Match/Secret/Message/Author/Email leaks NONE of it (the load-bearing invariant)', () => {
  const SECRET = 'ZZZsk_live_FAKE_DO_NOT_SHIP_999'
  // an inline synthetic gitleaks finding with the fake secret in EVERY sensitive field + commit PII
  const raw = [
    {
      RuleID: 'aws-access-token',
      Description: 'Detected a hardcoded credential.', // the rule's generic description — never the secret
      StartLine: 5,
      EndLine: 5,
      File: 'src/config.js',
      Match: `API_KEY = "${SECRET}"`,
      Secret: SECRET,
      Message: `commit leaked ${SECRET}`,
      Author: 'Jane Dev',
      Email: 'jane@x.com',
      Commit: 'deadbeefcafe',
    },
  ]
  const { findings } = ingestGitleaks(raw)
  assert.equal(findings.length, 1)
  const blob = JSON.stringify(findings[0])
  assert.ok(!blob.includes(SECRET), 'the secret VALUE leaked into a finding field — the adapter must never read Match/Secret/Message')
  assert.ok(!blob.includes('Jane Dev'), 'the commit author (PII) leaked into a finding field')
  assert.ok(!blob.includes('jane@x.com'), 'the commit email (PII) leaked into a finding field')
  // …and it is STILL a well-formed deterministic hardcoded-secrets finding built from the safe fields
  assert.equal(findings[0].class, 'hardcoded-secrets')
  assert.equal(findings[0].ruleId, 'aws-access-token')
  assert.equal(findings[0].dimension, 'secrets-credentials')
  assert.ok(findings[0].file.endsWith('src/config.js:5'))
  assert.deepEqual(validateFinding(findings[0]), [])
})

check('GL-severity-from-class: severity is the class high — gitleaks carries NO tool number to move it', () => {
  // class-severity, like CK-severity-from-class — NOT the SG/BN/NJ tool→band path.
  assert.equal(baselineSeverityFor('fail-hardcoded-secrets'), 'major')
  const cs = classSeverity('hardcoded-secrets')
  assert.equal(cs.severity, 'high')
  assert.equal(cs.baselineId, 'fail-hardcoded-secrets')
  assert.equal(cs.fromBaseline, true)
  assert.equal(CLASS_DEFS['hardcoded-secrets'].dimension, 'secrets-credentials')
  // every parsed hit has severityNum:null (there is no tool tier); the finding is still high (the class)
  const hits = gitleaksAdapter.parse(readJSON(GITLEAKS))
  assert.ok(hits.length === 3 && hits.every((h) => h.severityNum === null))
  assert.ok(ingestGitleaks().findings.every((f) => f.adjusted_severity === 'high' && f.severity === 'high'))
})

check('GL-supersedes-LLM: a gitleaks finding supersedes a co-located LLM secrets-credentials finding; the deterministic finding is untouched', () => {
  const det = ingestGitleaks().findings.find((f) => f.file.endsWith('mcp/server.py:27'))
  assert.ok(det && det.class === 'hardcoded-secrets' && det.dimension === 'secrets-credentials')
  // an llm-inferred secrets-credentials finding (no `class`, dimension fallback), overlapping :27
  const llm = {
    id: '2'.repeat(16),
    dimension: 'secrets-credentials',
    title: 'Hardcoded API key literal in mcp/server.py',
    severity: 'high',
    adjusted_severity: 'high',
    file: 'mcp/server.py:25-30', // overlaps det's :27
    status: 'confirmed',
    first_seen: 1,
    last_seen: 1,
    verdict: 'confirmed_real',
    verdict_reasoning: 'reasoned the literal looks like a credential',
  }
  const { findings, superseded, supersededIds } = reconcileProvenance([det, llm])
  assert.equal(superseded, 1)
  const outLlm = findings.find((f) => f.id === llm.id)
  const outDet = findings.find((f) => f.id === det.id)
  assert.equal(outLlm.status, 'superseded')
  assert.equal(outLlm.superseded_by, det.id)
  assert.deepEqual(supersededIds, [llm.id])
  // the deterministic gitleaks finding is never superseded
  assert.equal(outDet.status, 'confirmed')
  assert.equal(outDet.provenance, 'deterministic')
})

check('GL-classify / no-filter: classify() is the constant hardcoded-secrets; no securityRelevant (security-by-construction)', () => {
  assert.equal(gitleaksAdapter.classify('anything'), 'hardcoded-secrets')
  assert.equal(gitleaksAdapter.classify('generic-api-key'), 'hardcoded-secrets')
  assert.equal(gitleaksAdapter.securityRelevant, undefined) // every gitleaks hit is a secret — no tag filter
})

check('GL-fail-safe: collect() missing → null; parse(null/{}/"x"/[]) → []; a hit missing File/RuleID → skipped; ingest(null) → 0 + note', () => {
  assert.equal(gitleaksAdapter.collect({ input: join(tmpdir(), 'definitely-not-here-gitleaks.json') }), null)
  assert.deepEqual(gitleaksAdapter.parse(null), [])
  assert.deepEqual(gitleaksAdapter.parse({}), []) // gitleaks output is an ARRAY — a non-array is []
  assert.deepEqual(gitleaksAdapter.parse('x'), [])
  assert.deepEqual(gitleaksAdapter.parse([]), [])
  assert.deepEqual(gitleaksAdapter.parse([{ RuleID: 'generic-api-key', StartLine: 1 }]), []) // no File → skipped
  assert.deepEqual(gitleaksAdapter.parse([{ File: 'a.js', StartLine: 1 }]), []) // no RuleID → skipped
  // a valid hit alongside malformed entries still parses (no crash)
  const hits = gitleaksAdapter.parse([{ RuleID: 'x', File: 'a.js', StartLine: 3 }, null, { RuleID: 'y' }])
  assert.equal(hits.length, 1)
  assert.equal(hits[0].startLine, 3)
  const { findings, notes } = ingestGitleaks(null)
  assert.equal(findings.length, 0)
  assert.ok(notes.some((n) => /no input collected/.test(n)))
})

check('GL-merge-idempotent: ingest the fixture twice into a ledger → no dupes; a pre-existing llm finding survives', () => {
  const llm = {
    id: '1'.repeat(16),
    dimension: 'oauth-identity',
    title: 'pre-existing llm-inferred finding',
    severity: 'high',
    adjusted_severity: 'high',
    file: 'mcp/server.py:5',
    status: 'confirmed',
    first_seen: 1,
    last_seen: 1,
    verdict: 'confirmed_real',
    verdict_reasoning: 'reasoned over the code',
  }
  const ledger = { schema_version: '1', findings: [llm], passes: [] }
  const gl = ingestGitleaks().findings
  const r1 = mergeFindings(ledger, gl, 1)
  assert.equal(r1.added, 3)
  assert.equal(ledger.findings.length, 4) // 1 llm + 3 gitleaks
  const r2 = mergeFindings(ledger, gl, 1)
  assert.equal(r2.added, 0)
  assert.equal(ledger.findings.length, 4) // idempotent — no dupes
  assert.ok(ledger.findings.some((f) => f.id === '1'.repeat(16) && !('provenance' in f)))
})

check('GL-schema: a gitleaks finding (class hardcoded-secrets, dimension secrets-credentials) validates against $defs/finding', () => {
  const f = ingestGitleaks().findings[0]
  assert.deepEqual(validateFinding(f), [])
})

check('GL-CLI: --scanner gitleaks --input <fixture> --json --dry-run prints valid JSON with the anchor; exit 0', () => {
  const out = execFileSync(
    'node',
    [CLI, '--scanner', 'gitleaks', '--input', GITLEAKS, '--target', join(tmpdir(), 'nope-gl'), '--dry-run', '--json'],
    { encoding: 'utf8' }
  )
  const parsed = JSON.parse(out)
  assert.equal(parsed.scanner, 'gitleaks')
  assert.equal(parsed.kind, 'file-parser')
  assert.equal(parsed.merged, null) // dry-run
  assert.ok(
    parsed.findings.some((f) => f.ruleId === 'generic-api-key' && f.file.endsWith('mcp/server.py:27') && f.adjusted_severity === 'high' && f.class === 'hardcoded-secrets')
  )
})

check('GL-CLI-merge: --scanner gitleaks writes the deterministic findings to the target ledger + is idempotent', () => {
  const d = mkdtempSync(join(tmpdir(), 'ingest-cli-gl-'))
  dirs.push(d)
  const lp = join(d, '.security-review', 'audit-ledger.json')
  execFileSync('node', [CLI, '--scanner', 'gitleaks', '--input', GITLEAKS, '--target', d], { encoding: 'utf8' })
  const l1 = readJSON(lp)
  const gl1 = l1.findings.filter((f) => f.engine === 'gitleaks')
  assert.equal(gl1.length, 3)
  assert.ok(gl1.every((f) => f.adjusted_severity === 'high' && f.class === 'hardcoded-secrets' && f.provenance === 'deterministic'))
  execFileSync('node', [CLI, '--scanner', 'gitleaks', '--input', GITLEAKS, '--target', d], { encoding: 'utf8' })
  const l2 = readJSON(lp)
  assert.equal(l2.findings.filter((f) => f.engine === 'gitleaks').length, 3) // idempotent — no dupes
})

// ───────────────────────────────────── detect-secrets (Phase 2 · 2a #6 — hardcoded secrets, class-severity)
// The SECRETS SIBLING of gitleaks: same vuln class, so it REUSES the `hardcoded-secrets` class (NO new
// CLASS_DEFS entry, NO buildFinding change) — a class-severity adapter, severity from `fail-hardcoded-secrets`
// (major → high). TWO new things vs gitleaks: (1) detect-secrets' OWN nested-object JSON `{results:{<file>:[…]}}`
// keyed by FILE (its own `parse`); (2) with TWO secrets engines now live, the same secret at one locus yields
// TWO deterministic ledger rows — reconcile leaves BOTH confirmed (cross-engine dedup = §10 ext #3, deferred).
// The HASH/SECRET-NEVER-LEAKS invariant applies again: an occurrence carries a `hashed_secret` (a SHA) and,
// under --show-secrets, could carry plaintext — the adapter emits NEITHER. The real fixture is genuine
// detect-secrets 1.5.0 output: 24 occurrences across 6 files, 3 types (Secret Keyword / Hex / Base64 High Entropy).
const ingestDetectSecrets = (raw) => ingest(raw === undefined ? readJSON(DETECT_SECRETS) : raw, detectSecretsAdapter, { repoRoot: '', pass: 1 })
const DS_ANCHOR = '.security-review/audit-engine.mjs:181' // the first Secret Keyword occurrence (stable anchor)

check('DS-determinism: ingest the real detect-secrets fixture twice → byte-identical findings', () => {
  const a = ingestDetectSecrets().findings
  const b = ingestDetectSecrets().findings
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})

check('DS-anchor: Secret Keyword @ .security-review/audit-engine.mjs:181 → deterministic/detect-secrets/hardcoded-secrets/secrets-credentials/HIGH (class, from fail-hardcoded-secrets)', () => {
  const { findings } = ingestDetectSecrets()
  const f = findById(findings, (x) => x.ruleId === 'Secret Keyword' && x.file.endsWith(DS_ANCHOR))
  assert.ok(f, 'the audit-engine.mjs:181 Secret Keyword anchor is not present')
  assert.equal(f.provenance, 'deterministic')
  assert.equal(f.engine, 'detect-secrets')
  assert.equal(f.ruleId, 'Secret Keyword')
  assert.equal(f.class, 'hardcoded-secrets') // REUSES the hardcoded-secrets class
  assert.equal(f.dimension, 'secrets-credentials') // a REAL methodology dimension
  assert.equal(f.adjusted_severity, 'high') // from the class (fail-hardcoded-secrets=major→high), NOT a tool tier
  assert.equal(f.status, 'confirmed')
  assert.match(f.id, /^[0-9a-f]{16}$/)
})

check('DS-count + multi-file: the real fixture → exactly 24 findings spanning 6 distinct files + ≥2 types (distinct ids)', () => {
  const { findings } = ingestDetectSecrets()
  assert.equal(findings.length, 24)
  assert.ok(findings.every((f) => f.engine === 'detect-secrets' && f.class === 'hardcoded-secrets' && f.dimension === 'secrets-credentials' && f.adjusted_severity === 'high'))
  assert.equal(new Set(findings.map((f) => f.id)).size, 24) // all distinct ids
  const files = new Set(findings.map((f) => f.file.replace(/:\d+$/, ''))) // strip the trailing :line → the file
  assert.equal(files.size, 6) // 6 distinct files (the nested-by-file parse spanned all of them)
  assert.ok(files.size >= 2)
  const types = new Set(findings.map((f) => f.ruleId))
  assert.ok(types.size >= 2, `expected ≥2 detector types, got ${[...types].join(', ')}`)
  assert.ok(types.has('Secret Keyword') && types.has('Hex High Entropy String') && types.has('Base64 High Entropy String'))
})

check('DS-HASH/SECRET-NEVER-LEAKS: an occurrence carrying a fake hashed_secret + a synthetic --show-secrets plaintext leaks NEITHER (the load-bearing invariant)', () => {
  const HASH = 'HASHZZZ_DO_NOT_SHIP'
  const PLAIN = 'PLAINZZZ_DO_NOT_SHIP'
  // an inline synthetic detect-secrets occurrence with a fake hash AND a synthetic plaintext field
  const raw = {
    version: '1.5.0',
    results: {
      'src/config.py': [
        {
          type: 'Secret Keyword',
          filename: 'src/config.py',
          hashed_secret: HASH,
          plaintext: PLAIN, // as if `detect-secrets scan --show-secrets` ran — MUST NOT leak
          is_verified: true,
          line_number: 12,
        },
      ],
    },
  }
  const { findings } = ingestDetectSecrets(raw)
  assert.equal(findings.length, 1)
  const blob = JSON.stringify(findings[0])
  assert.ok(!blob.includes(HASH), 'the hashed_secret leaked into a finding field — the adapter must never read hashed_secret')
  assert.ok(!blob.includes(PLAIN), 'the plaintext secret leaked into a finding field — the adapter must never read a plaintext field')
  // …and it is STILL a well-formed deterministic hardcoded-secrets finding built from the safe fields
  assert.equal(findings[0].class, 'hardcoded-secrets')
  assert.equal(findings[0].ruleId, 'Secret Keyword')
  assert.equal(findings[0].dimension, 'secrets-credentials')
  assert.ok(findings[0].file.endsWith('src/config.py:12'))
  assert.deepEqual(validateFinding(findings[0]), [])
})

check('DS-reuses-class (no new CLASS_DEFS): classify() is the constant hardcoded-secrets, the SAME class entry gitleaks uses (one definition, two adapters); no securityRelevant', () => {
  assert.equal(detectSecretsAdapter.classify('x'), 'hardcoded-secrets')
  assert.equal(detectSecretsAdapter.classify('Secret Keyword'), 'hardcoded-secrets')
  // the SAME single class serves BOTH adapters — gitleaks and detect-secrets resolve to one CLASS_DEFS entry
  assert.equal(detectSecretsAdapter.classify('a'), gitleaksAdapter.classify('a'))
  assert.ok(CLASS_DEFS['hardcoded-secrets'], 'the hardcoded-secrets class exists (added by gitleaks, reused here)')
  assert.equal(CLASS_DEFS['hardcoded-secrets'].baselineId, 'fail-hardcoded-secrets')
  assert.equal(CLASS_DEFS['hardcoded-secrets'].dimension, 'secrets-credentials')
  // class-severity (like gitleaks/checkov), NOT a tool→band: every hit has severityNum:null, finding is class-high
  assert.equal(baselineSeverityFor('fail-hardcoded-secrets'), 'major')
  assert.equal(classSeverity('hardcoded-secrets').severity, 'high')
  const hits = detectSecretsAdapter.parse(readJSON(DETECT_SECRETS))
  assert.ok(hits.length === 24 && hits.every((h) => h.severityNum === null))
  assert.equal(detectSecretsAdapter.securityRelevant, undefined) // every detect-secrets hit is a secret — no tag filter
})

check('DS-supersedes-LLM: a detect-secrets finding supersedes a co-located LLM secrets-credentials finding; the deterministic finding is untouched', () => {
  const det = ingestDetectSecrets().findings.find((f) => f.file.endsWith(DS_ANCHOR))
  assert.ok(det && det.class === 'hardcoded-secrets' && det.dimension === 'secrets-credentials')
  // an llm-inferred secrets-credentials finding (no `class`, dimension fallback), overlapping :181
  const llm = {
    id: '3'.repeat(16),
    dimension: 'secrets-credentials',
    title: 'Hardcoded credential literal in audit-engine.mjs',
    severity: 'high',
    adjusted_severity: 'high',
    file: '.security-review/audit-engine.mjs:179-184', // overlaps det's :181
    status: 'confirmed',
    first_seen: 1,
    last_seen: 1,
    verdict: 'confirmed_real',
    verdict_reasoning: 'reasoned the literal looks like a credential',
  }
  const { findings, superseded, supersededIds } = reconcileProvenance([det, llm])
  assert.equal(superseded, 1)
  const outLlm = findings.find((f) => f.id === llm.id)
  const outDet = findings.find((f) => f.id === det.id)
  assert.equal(outLlm.status, 'superseded')
  assert.equal(outLlm.superseded_by, det.id)
  assert.deepEqual(supersededIds, [llm.id])
  // the deterministic detect-secrets finding is never superseded
  assert.equal(outDet.status, 'confirmed')
  assert.equal(outDet.provenance, 'deterministic')
})

check('DS-two-deterministic-coexist (§3): a detect-secrets finding AND a gitleaks finding at the SAME locus both stay confirmed — neither supersedes the other (cross-engine dedup = ext #3, Phase-2b)', () => {
  const ds = ingestDetectSecrets().findings.find((f) => f.file.endsWith(DS_ANCHOR))
  // a gitleaks finding at the SAME file:line (built through the real gitleaks adapter for fidelity)
  const gl = ingest(
    [{ RuleID: 'generic-api-key', File: '.security-review/audit-engine.mjs', StartLine: 181, Description: 'Detected a hardcoded credential.' }],
    gitleaksAdapter,
    { repoRoot: '', pass: 1 }
  ).findings[0]
  assert.ok(ds && gl)
  assert.equal(ds.file, gl.file) // same locus
  assert.notEqual(ds.id, gl.id) // distinct ids (engine differs) → two ledger rows
  assert.ok(ds.class === 'hardcoded-secrets' && gl.class === 'hardcoded-secrets')
  const { findings, superseded } = reconcileProvenance([ds, gl])
  assert.equal(superseded, 0) // a deterministic finding never supersedes another deterministic finding
  assert.ok(findings.every((f) => f.status === 'confirmed')) // the cross-engine duplicate is VISIBLE (safe under-merge)
})

check('DS-fail-safe: collect() missing → null; parse(null/{}/{results:null}/{results:[]}/{results:{f:non-array}}/occ-missing-type) → []/skip; ingest(null) → 0 + note', () => {
  assert.equal(detectSecretsAdapter.collect({ input: join(tmpdir(), 'definitely-not-here-detect-secrets.json') }), null)
  assert.deepEqual(detectSecretsAdapter.parse(null), [])
  assert.deepEqual(detectSecretsAdapter.parse({}), [])
  assert.deepEqual(detectSecretsAdapter.parse({ results: null }), [])
  assert.deepEqual(detectSecretsAdapter.parse({ results: [] }), []) // results must be an OBJECT keyed by file, not an array
  assert.deepEqual(detectSecretsAdapter.parse({ results: 'nope' }), [])
  assert.deepEqual(detectSecretsAdapter.parse({ results: { 'a.py': 'not-an-array' } }), []) // non-array occurrences → skipped
  assert.deepEqual(detectSecretsAdapter.parse({ results: { 'a.py': [{ filename: 'a.py', line_number: 1 }] } }), []) // occurrence missing type → skipped
  // an occurrence missing line_number still parses (startLine null); a null occurrence is skipped; no crash
  const hits = detectSecretsAdapter.parse({ results: { 'a.py': [{ type: 'Secret Keyword', filename: 'a.py' }, null] } })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].startLine, null)
  const { findings, notes } = ingestDetectSecrets(null)
  assert.equal(findings.length, 0)
  assert.ok(notes.some((n) => /no input collected/.test(n)))
})

check('DS-merge-idempotent: ingest the fixture twice into a ledger → no dupes; a pre-existing llm finding survives', () => {
  const llm = {
    id: '4'.repeat(16),
    dimension: 'oauth-identity',
    title: 'pre-existing llm-inferred finding',
    severity: 'high',
    adjusted_severity: 'high',
    file: 'server/index.js:5',
    status: 'confirmed',
    first_seen: 1,
    last_seen: 1,
    verdict: 'confirmed_real',
    verdict_reasoning: 'reasoned over the code',
  }
  const ledger = { schema_version: '1', findings: [llm], passes: [] }
  const ds = ingestDetectSecrets().findings
  const r1 = mergeFindings(ledger, ds, 1)
  assert.equal(r1.added, 24)
  assert.equal(ledger.findings.length, 25) // 1 llm + 24 detect-secrets
  const r2 = mergeFindings(ledger, ds, 1)
  assert.equal(r2.added, 0)
  assert.equal(ledger.findings.length, 25) // idempotent — no dupes
  assert.ok(ledger.findings.some((f) => f.id === '4'.repeat(16) && !('provenance' in f)))
})

check('DS-schema: a detect-secrets finding (class hardcoded-secrets, dimension secrets-credentials) validates against $defs/finding', () => {
  const f = ingestDetectSecrets().findings[0]
  assert.deepEqual(validateFinding(f), [])
})

check('DS-CLI: --scanner detect-secrets --input <fixture> --json --dry-run prints valid JSON with the anchor; exit 0', () => {
  const out = execFileSync(
    'node',
    [CLI, '--scanner', 'detect-secrets', '--input', DETECT_SECRETS, '--target', join(tmpdir(), 'nope-ds'), '--dry-run', '--json'],
    { encoding: 'utf8' }
  )
  const parsed = JSON.parse(out)
  assert.equal(parsed.scanner, 'detect-secrets')
  assert.equal(parsed.kind, 'file-parser')
  assert.equal(parsed.merged, null) // dry-run
  assert.ok(
    parsed.findings.some((f) => f.ruleId === 'Secret Keyword' && f.file.endsWith(DS_ANCHOR) && f.adjusted_severity === 'high' && f.class === 'hardcoded-secrets')
  )
})

check('DS-CLI-merge: --scanner detect-secrets writes the deterministic findings to the target ledger + is idempotent', () => {
  const d = mkdtempSync(join(tmpdir(), 'ingest-cli-ds-'))
  dirs.push(d)
  const lp = join(d, '.security-review', 'audit-ledger.json')
  execFileSync('node', [CLI, '--scanner', 'detect-secrets', '--input', DETECT_SECRETS, '--target', d], { encoding: 'utf8' })
  const l1 = readJSON(lp)
  const ds1 = l1.findings.filter((f) => f.engine === 'detect-secrets')
  assert.equal(ds1.length, 24)
  assert.ok(ds1.every((f) => f.adjusted_severity === 'high' && f.class === 'hardcoded-secrets' && f.provenance === 'deterministic'))
  execFileSync('node', [CLI, '--scanner', 'detect-secrets', '--input', DETECT_SECRETS, '--target', d], { encoding: 'utf8' })
  const l2 = readJSON(lp)
  assert.equal(l2.findings.filter((f) => f.engine === 'detect-secrets').length, 24) // idempotent — no dupes
})

// ───────────────────────────────────── osv (Phase 2 · 2a #7 — dependency CVEs, Extension A: CVSS→enum)
// OSV-Scanner is the dependency-CVE / SCA scanner (run-scans Family 8, lockfiles). It forces **Extension A:
// the CVSS→enum severity fork** — unlike the SAST tool→band family (ERROR/WARNING/INFO) and the class-severity
// adapters (checkov/secrets), a dep CVE carries a REAL CVSS, while the only class severity (scan-external-sca)
// is a *missing-scan* GATE severity. So the per-FINDING band is PER-ADVISORY: numeric group `max_severity` →
// CVSS_SCORE_TO_FINDING, else the `database_specific.severity` LABEL → OSV_LABEL_TO_FINDING, else 'medium'. It
// REUSES buildFinding's `bandFromTool` path (the band SOURCE is the CVSS, not a tool tier); the ONLY shared-code
// change is the additive `gateLabel` (scan-external-sca, not scan-external-sast). classify()→null (owns no
// class, supersedes nothing). The real fixture is genuine OSV-Scanner output: 1 source (mcp/requirements.txt),
// 3 PyPI packages, 11 vulns (1 critical h11 · 3 high + 6 medium + 1 low across starlette/idna).
const ingestOsv = (raw) => ingest(raw === undefined ? readJSON(OSV) : raw, osvAdapter, { repoRoot: '', pass: 1 })
const OSV_ANCHOR = 'GHSA-82w8-qh3p-5jfq' // starlette@0.38.6, single-id group max_severity 7.5 → high (stable HIGH anchor)

check('OSV-determinism: ingest the real OSV fixture twice → byte-identical findings', () => {
  const a = ingestOsv().findings
  const b = ingestOsv().findings
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})

check('OSV-count: the real fixture → exactly 11 findings (one per vuln), distinct ids, all osv/dependency-cve/no-class; band mix 1 critical·3 high·6 medium·1 low', () => {
  const { findings } = ingestOsv()
  assert.equal(findings.length, 11) // one finding per vulnerability
  assert.equal(new Set(findings.map((f) => f.id)).size, 11) // all distinct ids (distinct GHSA/CVE/PYSEC)
  assert.ok(findings.every((f) => f.engine === 'osv' && f.provenance === 'deterministic'))
  assert.ok(findings.every((f) => f.dimension === 'dependency-cve'))
  assert.ok(findings.every((f) => !('class' in f))) // OSV owns no toolkit class
  const byBand = {}
  for (const f of findings) byBand[f.adjusted_severity] = (byBand[f.adjusted_severity] || 0) + 1
  assert.deepEqual(byBand, { critical: 1, high: 3, medium: 6, low: 1 }) // the genuine fixture's distribution
})

check('OSV-anchor: GHSA-82w8-qh3p-5jfq → deterministic/osv/dependency-cve/no-class/HIGH (CVSS 7.5 advisory); starlette@0.38.6 (PyPI) in title+evidence; no :line', () => {
  const { findings } = ingestOsv()
  const f = findById(findings, (x) => x.ruleId === OSV_ANCHOR)
  assert.ok(f, 'the GHSA-82w8-qh3p-5jfq anchor is not present')
  assert.equal(f.provenance, 'deterministic')
  assert.equal(f.engine, 'osv')
  assert.equal(f.ruleId, OSV_ANCHOR)
  assert.equal(f.dimension, 'dependency-cve')
  assert.equal(f.class, undefined) // OSV owns no class (classify()→null)
  assert.equal(f.adjusted_severity, 'high') // CVSS 7.5 → high (the advisory band, NOT a class)
  assert.equal(f.severity, 'high')
  assert.equal(f.status, 'confirmed')
  assert.match(f.id, /^[0-9a-f]{16}$/)
  assert.ok(f.file.endsWith('mcp/requirements.txt')) // the lockfile locus
  assert.ok(!/:\d+$/.test(f.file), 'a dep-CVE finding must have NO :line (it locates to the lockfile/package)')
  assert.ok(f.title.includes('starlette@0.38.6') && f.title.includes('(PyPI)'), 'package@version + ecosystem in the title')
  assert.ok(f.evidence.includes('starlette@0.38.6 (PyPI):'))
  assert.match(f.verdict_reasoning, /CVSS 7\.5 \(advisory\) → high/)
})

check('OSV-CVSS→enum thresholds (the Extension-A crux): CVSS_SCORE_TO_FINDING maps each band boundary (9.0/7.0/4.0/0.1) + a real 0 → info + unscored/blank → null', () => {
  // the industry-standard CVSS 3.x qualitative scale
  assert.equal(CVSS_SCORE_TO_FINDING('9.8'), 'critical')
  assert.equal(CVSS_SCORE_TO_FINDING('9.0'), 'critical') // ≥9.0 boundary
  assert.equal(CVSS_SCORE_TO_FINDING('8.99'), 'high')
  assert.equal(CVSS_SCORE_TO_FINDING('7.5'), 'high')
  assert.equal(CVSS_SCORE_TO_FINDING('7.0'), 'high') // ≥7.0 boundary
  assert.equal(CVSS_SCORE_TO_FINDING('6.99'), 'medium')
  assert.equal(CVSS_SCORE_TO_FINDING('5.0'), 'medium')
  assert.equal(CVSS_SCORE_TO_FINDING('4.0'), 'medium') // ≥4.0 boundary
  assert.equal(CVSS_SCORE_TO_FINDING('3.99'), 'low')
  assert.equal(CVSS_SCORE_TO_FINDING('2.0'), 'low')
  assert.equal(CVSS_SCORE_TO_FINDING('0.1'), 'low') // >0 boundary
  assert.equal(CVSS_SCORE_TO_FINDING('0'), 'info') // an EXPLICIT 0.0-scored CVE → info
  assert.equal(CVSS_SCORE_TO_FINDING('0.0'), 'info')
  assert.equal(CVSS_SCORE_TO_FINDING(7.5), 'high') // numbers, not just strings
  // ABSENT/BLANK/non-numeric → null so the caller FALLS THROUGH to label → 'medium' (judgment call #1):
  // load-bearing — Number('')===0 and Number(null)===0 are finite, so without the guard an UNSCORED advisory
  // (OSV emits max_severity:'' when no CVSS exists) would silently downgrade to 'info'.
  assert.equal(CVSS_SCORE_TO_FINDING(''), null)
  assert.equal(CVSS_SCORE_TO_FINDING('   '), null)
  assert.equal(CVSS_SCORE_TO_FINDING(null), null)
  assert.equal(CVSS_SCORE_TO_FINDING(undefined), null)
  assert.equal(CVSS_SCORE_TO_FINDING('not-a-score'), null)
  // OSV's database_specific.severity LABEL map (GitHub bands; MEDIUM accepted as a MODERATE synonym)
  assert.deepEqual(OSV_LABEL_TO_FINDING, { CRITICAL: 'critical', HIGH: 'high', MODERATE: 'medium', MEDIUM: 'medium', LOW: 'low' })
})

check('OSV-CVSS→enum via parse (end-to-end): synthetic groups 9.8→critical, 7.5→high, 5.0→medium, 2.0→low, 0→info each reach the finding band', () => {
  const mk = (id) => ({ id, summary: `synthetic ${id}` })
  const raw = {
    results: [
      {
        source: { path: 'requirements.txt' },
        packages: [
          {
            package: { name: 'synthpkg', version: '1.0.0', ecosystem: 'PyPI' },
            groups: [
              { ids: ['V-CRIT'], max_severity: '9.8' },
              { ids: ['V-HIGH'], max_severity: '7.5' },
              { ids: ['V-MED'], max_severity: '5.0' },
              { ids: ['V-LOW'], max_severity: '2.0' },
              { ids: ['V-INFO'], max_severity: '0' },
            ],
            vulnerabilities: [mk('V-CRIT'), mk('V-HIGH'), mk('V-MED'), mk('V-LOW'), mk('V-INFO')],
          },
        ],
      },
    ],
  }
  const { findings } = ingestOsv(raw)
  assert.equal(findings.length, 5)
  const band = (id) => findings.find((f) => f.ruleId === id).adjusted_severity
  assert.equal(band('V-CRIT'), 'critical')
  assert.equal(band('V-HIGH'), 'high')
  assert.equal(band('V-MED'), 'medium')
  assert.equal(band('V-LOW'), 'low')
  assert.equal(band('V-INFO'), 'info') // a genuine 0.0 score → info
})

check('OSV-severity-priority: (a) numeric max_severity WINS over the label; (b) no group → label used (MODERATE→medium); (c)/(c2) neither & blank-scored → medium (an unscored CVE is real, conservative middle)', () => {
  const pkg = { name: 'p', version: '1.0', ecosystem: 'PyPI' }
  const one = (groups, v) => ingestOsv({ results: [{ source: { path: 'r.txt' }, packages: [{ package: pkg, groups, vulnerabilities: [v] }] }] }).findings
  // (a) numeric 7.5 (→high) WINS over a LOW label
  const a = one([{ ids: ['A'], max_severity: '7.5' }], { id: 'A', database_specific: { severity: 'LOW' }, summary: 'x' })
  assert.equal(a.length, 1)
  assert.equal(a[0].adjusted_severity, 'high') // numeric beats the LOW label
  assert.match(a[0].verdict_reasoning, /CVSS 7\.5 \(advisory\)/)
  // (b) NO group → the database_specific.severity LABEL is used
  const b = one([], { id: 'B', database_specific: { severity: 'HIGH' }, summary: 'x' })
  assert.equal(b[0].adjusted_severity, 'high')
  assert.match(b[0].verdict_reasoning, /advisory severity HIGH/)
  const bm = one([], { id: 'BM', database_specific: { severity: 'MODERATE' }, summary: 'x' })
  assert.equal(bm[0].adjusted_severity, 'medium') // MODERATE → medium (the GitHub synonym)
  // (c) NEITHER a group NOR a label → 'medium'
  const c = one([], { id: 'C', summary: 'x' })
  assert.equal(c[0].adjusted_severity, 'medium')
  assert.match(c[0].verdict_reasoning, /advisory severity unknown/)
  // (c2) an UNSCORED group (blank max_severity) ALSO falls through to medium, NOT info (judgment call #1)
  const c2 = one([{ ids: ['C2'], max_severity: '' }], { id: 'C2', summary: 'x' })
  assert.equal(c2[0].adjusted_severity, 'medium')
})

check('OSV-no-leak-of-vector: the title/evidence carry package@version + summary; the raw CVSS vector (CVSS:3.1/…) is NEVER dumped anywhere in a finding', () => {
  const { findings } = ingestOsv()
  const blob = JSON.stringify(findings)
  assert.ok(!blob.includes('CVSS:3.1/'), 'the raw CVSS vector must never appear in a finding')
  assert.ok(!/AV:N\/AC:[LH]/.test(blob), 'no CVSS vector components leak')
  const f = findById(findings, (x) => x.ruleId === OSV_ANCHOR)
  assert.ok(f.title.includes('starlette@0.38.6 (PyPI):'), 'title carries package@version (ecosystem): summary')
  assert.ok(f.evidence.includes('starlette@0.38.6 (PyPI):'))
  assert.match(f.verdict_reasoning, /CVSS 7\.5 \(advisory\)/) // the band label is the qualitative phrase, not the vector
})

check('OSV-classify/no-class: osvAdapter.classify() is constant null; hits carry severityNum:null + gateLabel scan-external-sca + dimensionHint dependency-cve; no securityRelevant; findings carry no class', () => {
  assert.equal(osvAdapter.classify('GHSA-x'), null)
  assert.equal(osvAdapter.classify('anything'), null)
  assert.equal(osvAdapter.securityRelevant, undefined) // every OSV hit is a known CVE — no tag filter
  const hits = osvAdapter.parse(readJSON(OSV))
  assert.equal(hits.length, 11)
  assert.ok(hits.every((h) => h.severityNum === null))
  assert.ok(hits.every((h) => h.gateLabel === 'scan-external-sca' && h.dimensionHint === 'dependency-cve'))
  assert.ok(ingestOsv().findings.every((f) => !('class' in f)))
})

check('OSV-fail-safe: collect() missing → null; parse(null/{}/{results:null}/{results:[]}/no-pkgs/no-vulns/no-id) → []/skip; no-severity-anywhere → medium; no-source → ecosystem:name; ingest(null) → 0 + note', () => {
  assert.equal(osvAdapter.collect({ input: join(tmpdir(), 'definitely-not-here-osv.json') }), null)
  assert.deepEqual(osvAdapter.parse(null), [])
  assert.deepEqual(osvAdapter.parse({}), [])
  assert.deepEqual(osvAdapter.parse({ results: null }), [])
  assert.deepEqual(osvAdapter.parse({ results: [] }), [])
  assert.deepEqual(osvAdapter.parse({ results: [{ source: { path: 'r' } }] }), []) // a result with no packages
  assert.deepEqual(osvAdapter.parse({ results: [{ packages: [{ package: { name: 'p' } }] }] }), []) // a package with no vulnerabilities
  assert.deepEqual(osvAdapter.parse({ results: [{ packages: [{ package: { name: 'p' }, vulnerabilities: [] }] }] }), [])
  assert.deepEqual(osvAdapter.parse({ results: [{ packages: [{ package: { name: 'p' }, vulnerabilities: [{ summary: 'no id' }, null] }] }] }), []) // vuln with no id / null vuln → skipped
  // a vuln with NO severity anywhere (no group, no label) → still a hit at band 'medium'
  const hits = osvAdapter.parse({ results: [{ source: { path: 'r' }, packages: [{ package: { name: 'p', version: '1', ecosystem: 'PyPI' }, vulnerabilities: [{ id: 'X', summary: 's' }] }] }] })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].bandFromTool, 'medium')
  assert.equal(hits[0].startLine, null)
  // a package with NO source path → file falls back to ecosystem:name
  const hits2 = osvAdapter.parse({ results: [{ packages: [{ package: { name: 'p', version: '1', ecosystem: 'PyPI' }, vulnerabilities: [{ id: 'Y', summary: 's' }] }] }] })
  assert.equal(hits2[0].file, 'PyPI:p')
  const { findings, notes } = ingestOsv(null)
  assert.equal(findings.length, 0)
  assert.ok(notes.some((n) => /no input collected/.test(n)))
})

check('OSV-schema: every osv finding (no class, dimension dependency-cve) validates against $defs/finding', () => {
  for (const f of ingestOsv().findings) assert.deepEqual(validateFinding(f), [])
})

check('OSV-merge-idempotent: ingest the fixture twice into a ledger → no dupes; a pre-existing llm finding survives', () => {
  const llm = {
    id: '5'.repeat(16),
    dimension: 'oauth-identity',
    title: 'pre-existing llm-inferred finding',
    severity: 'high',
    adjusted_severity: 'high',
    file: 'server/index.js:5',
    status: 'confirmed',
    first_seen: 1,
    last_seen: 1,
    verdict: 'confirmed_real',
    verdict_reasoning: 'reasoned over the code',
  }
  const ledger = { schema_version: '1', findings: [llm], passes: [] }
  const osv = ingestOsv().findings
  const r1 = mergeFindings(ledger, osv, 1)
  assert.equal(r1.added, 11)
  assert.equal(ledger.findings.length, 12) // 1 llm + 11 osv
  const r2 = mergeFindings(ledger, osv, 1)
  assert.equal(r2.added, 0)
  assert.equal(ledger.findings.length, 12) // idempotent — no dupes
  assert.ok(ledger.findings.some((f) => f.id === '5'.repeat(16) && !('provenance' in f)))
})

check('OSV-CLI: --scanner osv --input <fixture> --json --dry-run prints valid JSON with the anchor; exit 0', () => {
  const out = execFileSync(
    'node',
    [CLI, '--scanner', 'osv', '--input', OSV, '--target', join(tmpdir(), 'nope-osv'), '--dry-run', '--json'],
    { encoding: 'utf8' }
  )
  const parsed = JSON.parse(out)
  assert.equal(parsed.scanner, 'osv')
  assert.equal(parsed.kind, 'file-parser')
  assert.equal(parsed.merged, null) // dry-run
  assert.equal(parsed.findings.length, 11)
  assert.ok(
    parsed.findings.some((f) => f.ruleId === OSV_ANCHOR && f.adjusted_severity === 'high' && f.dimension === 'dependency-cve' && !('class' in f))
  )
})

check('OSV-CLI-merge: --scanner osv writes the deterministic findings to the target ledger + is idempotent', () => {
  const d = mkdtempSync(join(tmpdir(), 'ingest-cli-osv-'))
  dirs.push(d)
  const lp = join(d, '.security-review', 'audit-ledger.json')
  execFileSync('node', [CLI, '--scanner', 'osv', '--input', OSV, '--target', d], { encoding: 'utf8' })
  const l1 = readJSON(lp)
  const o1 = l1.findings.filter((f) => f.engine === 'osv')
  assert.equal(o1.length, 11)
  assert.ok(o1.every((f) => f.provenance === 'deterministic' && f.dimension === 'dependency-cve'))
  execFileSync('node', [CLI, '--scanner', 'osv', '--input', OSV, '--target', d], { encoding: 'utf8' })
  const l2 = readJSON(lp)
  assert.equal(l2.findings.filter((f) => f.engine === 'osv').length, 11) // idempotent — no dupes
})

check('GATE-LABEL regression (the buildFinding tweak): an OSV finding says "gated by scan-external-sca"; a semgrep finding STILL says "gated by scan-external-sast" (default preserved byte-for-byte)', () => {
  // an OSV finding through the real adapter → the new gate label
  const osvF = ingestOsv().findings.find((f) => f.ruleId === OSV_ANCHOR)
  assert.match(osvF.verdict_reasoning, /gated by scan-external-sca \(major\)/)
  assert.doesNotMatch(osvF.verdict_reasoning, /scan-external-sast/) // OSV must NOT use the SAST gate
  // a semgrep finding through the real adapter → the DEFAULT gate label is UNCHANGED
  const sgF = ingest(readJSON(SEMGREP_WARN), semgrepAdapter, { repoRoot: '', pass: 1 }).findings[0]
  assert.match(sgF.verdict_reasoning, /gated by scan-external-sast \(major\)/)
  assert.doesNotMatch(sgF.verdict_reasoning, /scan-external-sca/)
  // buildFinding unit: gateLabel parameterizes the clause; OMITTING it preserves scan-external-sast byte-for-byte
  const withGate = buildFinding({
    engine: 'osv', ruleId: 'CVE-X', severityNum: null, file: 'r.txt', startLine: null, message: 'm', resources: [],
    classKey: null, bandFromTool: 'high', dimensionHint: 'dependency-cve', toolSevLabel: 'CVSS 7.5 (advisory)', gateLabel: 'scan-external-sca', repoRoot: '', pass: 1,
  })
  assert.match(withGate.verdict_reasoning, /gated by scan-external-sca \(major\)/)
  const noGate = buildFinding({
    engine: 'semgrep', ruleId: 'r', severityNum: null, file: 'r', startLine: 1, message: 'm', resources: [],
    classKey: null, bandFromTool: 'medium', dimensionHint: 'external-sast', toolSevLabel: 'WARNING', repoRoot: '', pass: 1,
  })
  assert.match(noGate.verdict_reasoning, /gated by scan-external-sast \(major\)/) // default preserved when gateLabel omitted
})

// ─────────────────────────────── npm-audit (Phase 2 · 2a #8 — Node dependency CVEs, Extension-A REUSE: label-only band)
// npm audit is the Node-ecosystem dependency-CVE scanner (run-scans Family 8, alongside OSV). It is the EASY
// Extension-A REUSE: `npm audit --json` (auditReportVersion 2) gives a DIRECT severity LABEL per vulnerable package
// (`critical/high/moderate/low/info`) — NO CVSS math — so the band comes straight from NPM_SEVERITY_TO_FINDING,
// exactly like OSV's label-fallback path. It REUSES buildFinding's `bandFromTool` path, the `gateLabel` param, the
// `dependency-cve` dimension, and classify()→null EXACTLY like OSV — so NO buildFinding/CLASS_DEFS change (gateLabel
// already exists), only the ADAPTERS line. Gated by `scan-dependency-vulnerabilities` (applies_to all, major — the
// npm-deps gate, distinct from OSV's scan-external-sca). One finding per vulnerable package; `via` supplies the
// advisory title/url (a STRING via-entry is a transitive chain, an OBJECT via-entry is the direct advisory). The real
// fixture is genuine `npm audit --json` v2: 4 vulnerable packages (body-parser/express/path-to-regexp/qs), moderate×2
// + high×2. NOTE: the band uses the PACKAGE severity, NOT the first advisory's — qs (package moderate, first advisory
// low) bands as medium. Unknown/blank severity → medium (judgment call #1, as OSV).
const ingestNpm = (raw) => ingest(raw === undefined ? readJSON(NPM_AUDIT) : raw, npmAuditAdapter, { repoRoot: '', pass: 1 })
const NPM_ANCHOR = 'express' // package severity high, via 3 transitive strings → ruleId is the package name (stable HIGH anchor)
const NPM_ADV_URL = 'https://github.com/advisories/GHSA-37ch-88jc-xwx2' // path-to-regexp's direct OBJECT advisory url (= its ruleId)
const NPM_QS_URL = 'https://github.com/advisories/GHSA-w7fw-mjwx-w883' // qs's first OBJECT via-advisory url (= its ruleId)

check('NPM-determinism: ingest the real npm-audit fixture twice → byte-identical findings', () => {
  const a = ingestNpm().findings
  const b = ingestNpm().findings
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})

check('NPM-count: the real fixture → exactly 4 findings (one per vulnerable package), distinct ids, all npm-audit/dependency-cve/no-class; band mix 2 high·2 medium', () => {
  const { findings } = ingestNpm()
  assert.equal(findings.length, 4) // one finding per vulnerable package
  assert.equal(new Set(findings.map((f) => f.id)).size, 4) // distinct ids
  assert.ok(findings.every((f) => f.engine === 'npm-audit' && f.provenance === 'deterministic'))
  assert.ok(findings.every((f) => f.dimension === 'dependency-cve'))
  assert.ok(findings.every((f) => !('class' in f))) // npm-audit owns no toolkit class
  assert.ok(findings.every((f) => f.file === 'package-lock.json' && !/:\d+$/.test(f.file))) // lockfile locus, no :line
  const byBand = {}
  for (const f of findings) byBand[f.adjusted_severity] = (byBand[f.adjusted_severity] || 0) + 1
  assert.deepEqual(byBand, { high: 2, medium: 2 }) // matches the fixture metadata {moderate:2, high:2}
})

check('NPM-anchor: express → deterministic/npm-audit/dependency-cve/no-class/HIGH; package name + range in the title; package-lock.json locus, no :line', () => {
  const { findings } = ingestNpm()
  const f = findById(findings, (x) => x.ruleId === NPM_ANCHOR)
  assert.ok(f, 'the express anchor is not present')
  assert.equal(f.provenance, 'deterministic')
  assert.equal(f.engine, 'npm-audit')
  assert.equal(f.ruleId, NPM_ANCHOR)
  assert.equal(f.dimension, 'dependency-cve')
  assert.equal(f.class, undefined) // npm-audit owns no class (classify()→null)
  assert.equal(f.adjusted_severity, 'high') // package severity high → high (the npm label band, NOT a class)
  assert.equal(f.severity, 'high')
  assert.equal(f.status, 'confirmed')
  assert.match(f.id, /^[0-9a-f]{16}$/)
  assert.equal(f.file, 'package-lock.json') // npm-audit gives no source path → the lockfile is the locus
  assert.ok(!/:\d+$/.test(f.file), 'a dep-CVE finding must have NO :line')
  assert.ok(f.title.includes('express') && f.title.includes('4.0.0-rc1 - 4.22.1'), 'package name + range in the title')
  assert.ok(f.evidence.includes('express (4.0.0-rc1 - 4.22.1 || 5.0.0-alpha.1 - 5.0.1)'))
})

check('NPM-label→band: NPM_SEVERITY_TO_FINDING maps each npm label (moderate→medium) + unknown/blank → medium; reaches the finding band end-to-end', () => {
  // npm's own lowercase spelling — `moderate`, NOT `medium`
  assert.deepEqual(NPM_SEVERITY_TO_FINDING, { critical: 'critical', high: 'high', moderate: 'medium', low: 'low', info: 'info' })
  const mk = (severity) => ({ name: 's', severity, range: '1.0.0', via: [] })
  const raw = {
    auditReportVersion: 2,
    vulnerabilities: {
      crit: mk('critical'),
      hi: mk('high'),
      mod: mk('moderate'), // npm spelling → medium
      lo: mk('low'),
      inf: mk('info'),
      blank: mk(''), // blank → medium (judgment call #1)
      missing: { name: 'missing', range: '1.0.0', via: [] }, // NO severity key → medium
      bogus: mk('frobnicate'), // unknown label → medium
    },
  }
  const hits = npmAuditAdapter.parse(raw)
  const band = (id) => hits.find((h) => h.ruleId === id).bandFromTool
  assert.equal(band('crit'), 'critical')
  assert.equal(band('hi'), 'high')
  assert.equal(band('mod'), 'medium') // moderate → medium
  assert.equal(band('lo'), 'low')
  assert.equal(band('inf'), 'info')
  assert.equal(band('blank'), 'medium') // unknown/blank → medium, never dropped
  assert.equal(band('missing'), 'medium')
  assert.equal(band('bogus'), 'medium')
  // and the same bands reach the finding's adjusted_severity end-to-end
  const { findings } = ingestNpm(raw)
  assert.equal(findings.length, 8)
  const sev = (id) => findings.find((f) => f.ruleId === id).adjusted_severity
  assert.equal(sev('mod'), 'medium')
  assert.equal(sev('crit'), 'critical')
  assert.equal(sev('bogus'), 'medium')
})

check('NPM-via-shapes: a STRING via → "vulnerable via …" (no crash); an OBJECT via → its title in the message + url in resources + as the ruleId; the package severity wins over the first advisory; the CVSS vector never leaks', () => {
  const { findings } = ingestNpm()
  // (a) STRING via — body-parser: via:["qs"] → "vulnerable via qs", ruleId is the package name
  const bp = findById(findings, (f) => f.ruleId === 'body-parser')
  assert.ok(bp, 'body-parser (string-via) finding missing')
  assert.ok(bp.evidence.includes('vulnerable via qs'), 'string via → "vulnerable via <pkg>"')
  assert.equal(bp.adjusted_severity, 'medium') // package moderate → medium
  // (b) OBJECT via — path-to-regexp: via:[{title,url,…}] → advisory title + url surfaced, url is the ruleId
  const ptr = findById(findings, (f) => f.ruleId === NPM_ADV_URL)
  assert.ok(ptr, 'path-to-regexp (object-via) finding missing — ruleId should be the advisory url')
  assert.equal(ptr.ruleId, NPM_ADV_URL)
  assert.ok(ptr.evidence.includes('Regular Expression Denial of Service'), 'the advisory title is in the message')
  assert.ok(ptr.verdict_reasoning.includes(`See ${NPM_ADV_URL}`), 'the advisory url surfaces (from resources) in the reasoning')
  assert.equal(ptr.adjusted_severity, 'high')
  // the url lands in the hit-level `resources` (the finding folds resources[0] into the "See …" ref above)
  const ptrHit = npmAuditAdapter.parse(readJSON(NPM_AUDIT)).find((h) => h.ruleId === NPM_ADV_URL)
  assert.deepEqual(ptrHit.resources, [NPM_ADV_URL])
  const bpHit = npmAuditAdapter.parse(readJSON(NPM_AUDIT)).find((h) => h.ruleId === 'body-parser')
  assert.deepEqual(bpHit.resources, []) // a string-via entry has no advisory url
  // (c) the band uses the PACKAGE severity, NOT the first advisory's — qs is package `moderate` but its first
  //     via-advisory is `low`; it must band as medium (the package max), and its ruleId is that first advisory url
  const qs = findById(findings, (f) => f.ruleId === NPM_QS_URL)
  assert.ok(qs, 'qs (object-via) finding missing')
  assert.equal(qs.adjusted_severity, 'medium') // package moderate beats the first advisory's low
  // (d) no-leak: the raw CVSS vector that a direct advisory carries (via[i].cvss.vectorString) is NEVER dumped
  const blob = JSON.stringify(findings)
  assert.ok(!blob.includes('CVSS:3.1/'), 'the raw CVSS vector must never appear in a finding')
  assert.ok(!/AV:N\/AC:[LH]/.test(blob), 'no CVSS vector components leak')
})

check('NPM-gate-label: an npm-audit finding says "gated by scan-dependency-vulnerabilities"; OSV STILL says scan-external-sca and semgrep STILL says scan-external-sast', () => {
  const npmF = ingestNpm().findings.find((f) => f.ruleId === NPM_ANCHOR)
  assert.match(npmF.verdict_reasoning, /gated by scan-dependency-vulnerabilities \(major\)/)
  assert.doesNotMatch(npmF.verdict_reasoning, /scan-external-sca/) // npm-audit must NOT use OSV's SCA gate
  assert.doesNotMatch(npmF.verdict_reasoning, /scan-external-sast/) // nor the SAST gate
  // cross-engine: the other dep-CVE / SAST gates are unchanged (the gateLabel param is per-adapter)
  const osvF = ingest(readJSON(OSV), osvAdapter, { repoRoot: '', pass: 1 }).findings[0]
  assert.match(osvF.verdict_reasoning, /gated by scan-external-sca \(major\)/)
  const sgF = ingest(readJSON(SEMGREP_WARN), semgrepAdapter, { repoRoot: '', pass: 1 }).findings[0]
  assert.match(sgF.verdict_reasoning, /gated by scan-external-sast \(major\)/)
})

check('NPM-classify/no-class: npmAuditAdapter.classify() is constant null; hits carry severityNum:null + gateLabel scan-dependency-vulnerabilities + dimensionHint dependency-cve; no securityRelevant; findings carry no class', () => {
  assert.equal(npmAuditAdapter.classify('express'), null)
  assert.equal(npmAuditAdapter.classify('anything'), null)
  assert.equal(npmAuditAdapter.securityRelevant, undefined) // every npm-audit entry is a known CVE — no tag filter
  const hits = npmAuditAdapter.parse(readJSON(NPM_AUDIT))
  assert.equal(hits.length, 4)
  assert.ok(hits.every((h) => h.severityNum === null))
  assert.ok(hits.every((h) => h.gateLabel === 'scan-dependency-vulnerabilities' && h.dimensionHint === 'dependency-cve'))
  assert.ok(ingestNpm().findings.every((f) => !('class' in f)))
})

check('NPM-fail-safe: collect() missing → null; parse(null/{}/{vulnerabilities:null}/{vulnerabilities:[]}/{} -keyed/null-entry/non-object-entry) → []/skip; missing severity → medium hit; ingest(null) → 0 + note', () => {
  assert.equal(npmAuditAdapter.collect({ input: join(tmpdir(), 'definitely-not-here-npm.json') }), null)
  assert.deepEqual(npmAuditAdapter.parse(null), [])
  assert.deepEqual(npmAuditAdapter.parse({}), []) // no vulnerabilities key
  assert.deepEqual(npmAuditAdapter.parse({ vulnerabilities: null }), [])
  assert.deepEqual(npmAuditAdapter.parse({ vulnerabilities: [] }), []) // an ARRAY, not the keyed object → []
  assert.deepEqual(npmAuditAdapter.parse({ vulnerabilities: {} }), []) // empty keyed object → no hits
  assert.deepEqual(npmAuditAdapter.parse({ vulnerabilities: { a: null } }), []) // null entry skipped
  assert.deepEqual(npmAuditAdapter.parse({ vulnerabilities: { a: 'oops' } }), []) // non-object entry skipped
  // an entry with NO severity anywhere → still a hit at band 'medium' (never dropped), file = the lockfile, no line
  const hits = npmAuditAdapter.parse({ vulnerabilities: { p: { name: 'p', range: '1.0.0', via: [] } } })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].bandFromTool, 'medium')
  assert.equal(hits[0].startLine, null)
  assert.equal(hits[0].file, 'package-lock.json')
  assert.equal(hits[0].ruleId, 'p') // no advisory → the package name
  const { findings, notes } = ingestNpm(null)
  assert.equal(findings.length, 0)
  assert.ok(notes.some((n) => /no input collected/.test(n)))
})

check('NPM-schema: every npm-audit finding (no class, dimension dependency-cve) validates against $defs/finding', () => {
  for (const f of ingestNpm().findings) assert.deepEqual(validateFinding(f), [])
})

check('NPM-merge-idempotent: ingest the fixture twice into a ledger → no dupes; a pre-existing llm finding survives', () => {
  const llm = {
    id: '7'.repeat(16),
    dimension: 'oauth-identity',
    title: 'pre-existing llm-inferred finding',
    severity: 'high',
    adjusted_severity: 'high',
    file: 'server/index.js:5',
    status: 'confirmed',
    first_seen: 1,
    last_seen: 1,
    verdict: 'confirmed_real',
    verdict_reasoning: 'reasoned over the code',
  }
  const ledger = { schema_version: '1', findings: [llm], passes: [] }
  const npm = ingestNpm().findings
  const r1 = mergeFindings(ledger, npm, 1)
  assert.equal(r1.added, 4)
  assert.equal(ledger.findings.length, 5) // 1 llm + 4 npm-audit
  const r2 = mergeFindings(ledger, npm, 1)
  assert.equal(r2.added, 0)
  assert.equal(ledger.findings.length, 5) // idempotent — no dupes
  assert.ok(ledger.findings.some((f) => f.id === '7'.repeat(16) && !('provenance' in f)))
})

check('NPM-CLI: --scanner npm-audit --input <fixture> --json --dry-run prints valid JSON with the anchor; exit 0', () => {
  const out = execFileSync(
    'node',
    [CLI, '--scanner', 'npm-audit', '--input', NPM_AUDIT, '--target', join(tmpdir(), 'nope-npm'), '--dry-run', '--json'],
    { encoding: 'utf8' }
  )
  const parsed = JSON.parse(out)
  assert.equal(parsed.scanner, 'npm-audit')
  assert.equal(parsed.kind, 'file-parser')
  assert.equal(parsed.merged, null) // dry-run
  assert.equal(parsed.findings.length, 4)
  assert.ok(
    parsed.findings.some((f) => f.ruleId === NPM_ANCHOR && f.adjusted_severity === 'high' && f.dimension === 'dependency-cve' && !('class' in f))
  )
})

check('NPM-CLI-merge: --scanner npm-audit writes the deterministic findings to the target ledger + is idempotent', () => {
  const d = mkdtempSync(join(tmpdir(), 'ingest-cli-npm-'))
  dirs.push(d)
  const lp = join(d, '.security-review', 'audit-ledger.json')
  execFileSync('node', [CLI, '--scanner', 'npm-audit', '--input', NPM_AUDIT, '--target', d], { encoding: 'utf8' })
  const l1 = readJSON(lp)
  const o1 = l1.findings.filter((f) => f.engine === 'npm-audit')
  assert.equal(o1.length, 4)
  assert.ok(o1.every((f) => f.provenance === 'deterministic' && f.dimension === 'dependency-cve'))
  execFileSync('node', [CLI, '--scanner', 'npm-audit', '--input', NPM_AUDIT, '--target', d], { encoding: 'utf8' })
  const l2 = readJSON(lp)
  assert.equal(l2.findings.filter((f) => f.engine === 'npm-audit').length, 4) // idempotent — no dupes
})

// ─────────────────────────────── devcve-band (down-rank dev-only npm dependency CVEs below the blocker floor)
// A CVE on a DIRECT npm devDependency (∈ the target package.json devDependencies, ∉ dependencies) is never
// shipped in the managed package, so it must not sit in the critical/high band (compute-sci's blocker floor +
// high gate). The cap is a DOWN-rank to a ceiling of `low` — cleared off both gates but STILL a finding, with an
// honest caveat on the message — never a raise, never a drop. Scope: npm, direct devDependencies only (osv/
// npm-audit). Prod deps + the `--all` journey boundary are proven byte-identical / threaded here.
const devcveOsv = {
  results: [{
    source: { path: 'package-lock.json' },
    packages: [
      { package: { name: 'vitest', ecosystem: 'npm', version: '1.2.3' },
        groups: [{ ids: ['GHSA-devonly-vitest'], max_severity: '9.8' }],
        vulnerabilities: [{ id: 'GHSA-devonly-vitest', summary: 'vitest arbitrary code execution' }] },
      { package: { name: 'express', ecosystem: 'npm', version: '4.17.1' },
        groups: [{ ids: ['GHSA-prod-express'], max_severity: '9.8' }],
        vulnerabilities: [{ id: 'GHSA-prod-express', summary: 'express prod RCE' }] },
    ],
  }],
}

check('DEVCVE-osv-cap: a critical CVE on a direct npm devDependency caps to low with the honest caveat; a prod dep is byte-identical; id + provenance unchanged', () => {
  const devScope = { npm: new Set(['vitest']) }
  const capped = ingest(devcveOsv, osvAdapter, { repoRoot: '', pass: 1, devScope }).findings
  const uncapped = ingest(devcveOsv, osvAdapter, { repoRoot: '', pass: 1 }).findings // no devScope → today's behavior
  const vitC = findById(capped, (f) => f.ruleId === 'GHSA-devonly-vitest')
  const vitU = findById(uncapped, (f) => f.ruleId === 'GHSA-devonly-vitest')
  const expC = findById(capped, (f) => f.ruleId === 'GHSA-prod-express')
  const expU = findById(uncapped, (f) => f.ruleId === 'GHSA-prod-express')
  // dev-only: critical → low (clears the blocker floor + the high gate; still visible, not dropped)
  assert.equal(vitU.adjusted_severity, 'critical', 'untouched without a dev scope')
  assert.equal(vitC.adjusted_severity, 'low')
  assert.equal(vitC.severity, 'low')
  assert.equal(vitC.status, 'confirmed') // kept, not dropped
  // the honest caveat rides the message → the finding evidence + reasoning, naming the origin band
  assert.match(vitC.evidence, /dev-only dependency \(not shipped in the managed package\) — downgraded from critical/)
  assert.match(vitC.verdict_reasoning, /dev-only dependency, not shipped → low/)
  // still deterministic; the id is band-independent (band is not in the hash) → unchanged by the cap
  assert.equal(vitC.provenance, 'deterministic')
  assert.equal(vitC.id, vitU.id)
  // a PROD dependency (not in the dev set) is byte-identical to today
  assert.equal(JSON.stringify(expC), JSON.stringify(expU), 'a prod-dep CVE is byte-identical with or without the dev scope')
  assert.equal(expC.adjusted_severity, 'critical')
})

check('DEVCVE-osv-noraise + ecosystem gate: an already-low dev CVE is NOT raised; a PyPI dev package is NOT capped (npm only)', () => {
  // an already-low dev CVE → unchanged; the cap only ever DOWN-ranks (a low→low no-op carries no caveat)
  const lowOsv = { results: [{ source: { path: 'package-lock.json' }, packages: [
    { package: { name: 'vitest', ecosystem: 'npm', version: '1' }, groups: [{ ids: ['GHSA-low-vitest'], max_severity: '2.0' }], vulnerabilities: [{ id: 'GHSA-low-vitest', summary: 'minor' }] },
  ] }] }
  const f = findById(ingest(lowOsv, osvAdapter, { repoRoot: '', pass: 1, devScope: { npm: new Set(['vitest']) } }).findings, () => true)
  assert.equal(f.adjusted_severity, 'low') // 2.0 → low already; the cap never raises to a higher band
  assert.ok(!/downgraded from/.test(f.evidence), 'an already-low dev CVE carries no down-rank caveat (no-op)')
  // a PyPI dev package is out of scope — the cap keys the npm ecosystem only
  const pyOsv = { results: [{ source: { path: 'requirements.txt' }, packages: [
    { package: { name: 'pytest', ecosystem: 'PyPI', version: '7' }, groups: [{ ids: ['PYSEC-dev-pytest'], max_severity: '9.8' }], vulnerabilities: [{ id: 'PYSEC-dev-pytest', summary: 'x' }] },
  ] }] }
  const py = findById(ingest(pyOsv, osvAdapter, { repoRoot: '', pass: 1, devScope: { npm: new Set(['pytest']) } }).findings, () => true)
  assert.equal(py.adjusted_severity, 'critical', 'a PyPI dev package is never capped by the npm dev scope')
})

check('DEVCVE-npm-cap: a high npm-audit CVE on a direct devDependency caps to low; a prod dep is byte-identical', () => {
  const raw = { auditReportVersion: 2, vulnerabilities: {
    vitest: { name: 'vitest', severity: 'high', isDirect: true, via: [{ title: 'vitest advisory', url: 'https://example.test/GHSA-nv', severity: 'high' }], range: '<1.0', fixAvailable: true },
    express: { name: 'express', severity: 'high', isDirect: true, via: [{ title: 'express advisory', url: 'https://example.test/GHSA-ne', severity: 'high' }], range: '<4.18', fixAvailable: true },
  } }
  const capped = ingest(raw, npmAuditAdapter, { repoRoot: '', pass: 1, devScope: { npm: new Set(['vitest']) } }).findings
  const uncapped = ingest(raw, npmAuditAdapter, { repoRoot: '', pass: 1 }).findings
  const vitC = findById(capped, (f) => /vitest/.test(f.evidence))
  const expC = findById(capped, (f) => /express/.test(f.evidence))
  const expU = findById(uncapped, (f) => /express/.test(f.evidence))
  assert.equal(vitC.adjusted_severity, 'low')
  assert.match(vitC.evidence, /dev-only dependency \(not shipped in the managed package\) — downgraded from high/)
  assert.equal(vitC.provenance, 'deterministic')
  assert.equal(JSON.stringify(expC), JSON.stringify(expU), 'a prod-dep npm-audit CVE is byte-identical')
  assert.equal(expC.adjusted_severity, 'high')
})

check('DEVCVE-resolveDevScope: direct devDependencies minus dependencies; a package in BOTH is excluded; missing/malformed package.json → empty set (never over-cap)', () => {
  const d = mkdtempSync(join(tmpdir(), 'ingest-devscope-')); dirs.push(d)
  writeFileSync(join(d, 'package.json'), JSON.stringify({
    dependencies: { express: '^4', lodash: '^4' },
    devDependencies: { vitest: '^1', lodash: '^4' }, // lodash is in BOTH → NOT dev-only
  }))
  const scope = resolveDevScope(d)
  assert.ok(scope.npm.has('vitest'), 'a dev-only package is in the npm set')
  assert.ok(!scope.npm.has('lodash'), 'a package in BOTH deps + devDeps is NOT dev-only')
  assert.ok(!scope.npm.has('express'), 'a prod-only package is not in the dev set')
  // no package.json → empty set (fail-open, never over-cap)
  const e = mkdtempSync(join(tmpdir(), 'ingest-devscope-empty-')); dirs.push(e)
  assert.equal(resolveDevScope(e).npm.size, 0)
  // malformed package.json → empty set
  writeFileSync(join(e, 'package.json'), '{ not valid json')
  assert.equal(resolveDevScope(e).npm.size, 0)
})

check('DEVCVE-all-boundary: the --all/ingestAll journey path threads devScope (bypasses collect()) — the dev CVE caps, the prod CVE stays critical', () => {
  const d = mkdtempSync(join(tmpdir(), 'ingest-devcve-all-')); dirs.push(d)
  writeFileSync(join(d, 'package.json'), JSON.stringify({ dependencies: { express: '^4' }, devDependencies: { vitest: '^1' } }))
  const ev = join(d, '.security-review', 'evidence'); mkdirSync(ev, { recursive: true })
  writeFileSync(join(ev, 'osv-devcve.json'), JSON.stringify(devcveOsv))
  const result = ingestAll({ target: d, dryRun: true })
  const vit = findById(result.findings, (f) => f.ruleId === 'GHSA-devonly-vitest')
  const exp = findById(result.findings, (f) => f.ruleId === 'GHSA-prod-express')
  assert.ok(vit && exp, 'both the dev + prod CVEs are ingested via the --all evidence path')
  // the crux: --all hands inline-read raw straight to ingest() (never collect()), so a
  // collect()-only enrichment would silently no-op here and vitest would stay critical
  assert.equal(vit.adjusted_severity, 'low', 'the --all path capped the dev-only CVE (devScope threads past collect())')
  assert.equal(exp.adjusted_severity, 'critical', 'the prod CVE stays critical on the --all path')
  assert.match(vit.evidence, /downgraded from critical/)
})

// ─────────────────────────────── trivy (Phase 2 · 2a #9 — IaC misconfig, CONFIG mode only)
// Trivy is the multi-mode scanner, done CONFIG-mode only this slice (the only mode with a captured fixture). A Trivy
// `Class:'config'` finding is the SAME vuln class as Checkov, so it REUSES the `iac-misconfig` class (NO new
// CLASS_DEFS, NO buildFinding change — like detect-secrets reused `hardcoded-secrets`): a CLASS-severity adapter at
// class `high`, NOT a tool→band path. The parse is CLASS-DISPATCH (forward-compatible): `Class:'config'` now, the
// vuln (os-pkgs/lang-pkgs) and `secret` classes SKIPPED (Phase-2b). CONSISTENCY CALL: Trivy DOES carry a per-misconfig
// Severity, but it lands at class-severity EXACTLY like Checkov (Severity recorded in the message for reference, never
// moving the band). The real fixture is genuine Trivy 0.71.2 output: 1 `Class:'config'` Result, 1 FAIL misconfig
// (DS-0026 "No HEALTHCHECK", Severity LOW, no CauseMetadata.StartLine — the same Dockerfile finding Checkov reports as
// CKV_DOCKER_2). Small INLINE synthetics cover the class dispatch, PASS-skip, AVDID preference, and :line formatting.
const ingestTrivy = (raw) => ingest(raw === undefined ? readJSON(TRIVY) : raw, trivyAdapter, { repoRoot: '', pass: 1 })

check('TRV-determinism: ingest the real Trivy fixture twice → byte-identical findings', () => {
  const a = ingestTrivy().findings
  const b = ingestTrivy().findings
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})

check('TRV-anchor: DS-0026 → one deterministic iac-misconfig finding (trivy/low via the sourced RULE_BAND_FLOOR — availability-only HEALTHCHECK, 0.8.105 — Dockerfile, PrimaryURL in reasoning, Trivy severity noted for reference)', () => {
  const raw = readJSON(TRIVY)
  const url = raw.Results[0].Misconfigurations[0].PrimaryURL
  const { findings } = ingestTrivy(raw)
  assert.equal(findings.length, 1)
  const f = findings[0]
  assert.equal(f.provenance, 'deterministic')
  assert.equal(f.engine, 'trivy')
  assert.equal(f.ruleId, 'DS-0026') // the real misconfig carries no AVDID → falls back to ID
  assert.equal(f.class, 'iac-misconfig') // REUSES checkov's class
  assert.equal(f.dimension, 'infrastructure-iac')
  assert.equal(f.adjusted_severity, 'low') // the sourced availability-only band floor (trivy/DS-0026) lowers the class high → low
  assert.match(f.verdict_reasoning, /banded low by the sourced rule-band floor for trivy\/DS-0026/)
  // the real DS-0026 (a file-level "No HEALTHCHECK") carries NO CauseMetadata.StartLine → the locus is the bare Target
  // (the `:StartLine` path is exercised by TRV-class-dispatch's synthetic, which DOES carry a StartLine)
  assert.equal(f.file, 'Dockerfile')
  assert.ok(!/:\d+$/.test(f.file), 'a misconfig with no StartLine must have NO :line')
  assert.equal(f.status, 'confirmed')
  assert.match(f.id, /^[0-9a-f]{16}$/)
  assert.ok(url && f.verdict_reasoning.includes(url), 'the Trivy PrimaryURL must appear in verdict_reasoning')
  assert.ok(f.verdict_reasoning.includes('[Trivy severity LOW, recorded for reference]'), 'Trivy tool severity is recorded for reference')
  assert.match(f.verdict_reasoning, /severity fixed from the iac-misconfig class/) // class-severity first, then the sourced floor
})

check('TRV-severity-from-class (the consistency invariant): mutating the misconfig Severity LOW→CRITICAL leaves the band high (class-severity, matching Checkov; the tool number never moves it) — on a floor-UNMAPPED rule (DS-0002; DS-0026 now rides RULE_BAND_FLOOR, see test-rule-band-floor.mjs)', () => {
  const raw = clone(readJSON(TRIVY))
  raw.Results[0].Misconfigurations[0].ID = 'DS-0002' // root-user rule — class-mapped, floor-unmapped
  raw.Results[0].Misconfigurations[0].Severity = 'CRITICAL'
  const { findings } = ingestTrivy(raw)
  assert.equal(findings.length, 1)
  // would be 'critical' if it followed Trivy's per-misconfig tier; stays 'high' from the iac-misconfig class
  assert.equal(findings[0].adjusted_severity, 'high')
  assert.ok(findings[0].verdict_reasoning.includes('[Trivy severity CRITICAL, recorded for reference]'), 'the (now CRITICAL) tool severity is still only recorded for reference')
})

check('TRV-class-dispatch: a synthetic with an os-pkgs (Vulnerabilities) Result AND a config (Misconfigurations) Result → only the config misconfig becomes a finding (the vuln class is Phase-2b); AVDID preferred + CauseMetadata.StartLine → :line', () => {
  const synthetic = {
    SchemaVersion: 2,
    ArtifactType: 'filesystem',
    Results: [
      // a Class:'os-pkgs' SCA list — SKIPPED this slice (Phase-2b, no fixture)
      { Target: 'go.sum', Class: 'os-pkgs', Type: 'gobinary', Vulnerabilities: [{ VulnerabilityID: 'CVE-2024-9999', PkgName: 'foo', Severity: 'CRITICAL' }] },
      // a Class:'config' IaC misconfig — the ONLY finding
      { Target: 'k8s/deploy.yaml', Class: 'config', Type: 'kubernetes', Misconfigurations: [
        { ID: 'KSV001', AVDID: 'AVD-KSV-0001', Title: 'Process can elevate its own privileges', Message: 'Set allowPrivilegeEscalation to false', Severity: 'HIGH', PrimaryURL: 'https://avd.aquasec.com/misconfig/ksv001', Status: 'FAIL', CauseMetadata: { StartLine: 12, EndLine: 14 } },
      ] },
    ],
  }
  const { findings } = ingest(synthetic, trivyAdapter, { repoRoot: '', pass: 1 })
  assert.equal(findings.length, 1) // only the config misconfig — the os-pkgs vuln class is skipped this slice
  const f = findings[0]
  assert.equal(f.ruleId, 'AVD-KSV-0001') // AVDID preferred over ID
  assert.equal(f.class, 'iac-misconfig')
  assert.equal(f.adjusted_severity, 'high')
  assert.ok(f.file.endsWith('k8s/deploy.yaml:12'), `CauseMetadata.StartLine → :line formatting; file was ${f.file}`)
  assert.ok(!findings.some((x) => /CVE-2024-9999/.test(x.ruleId)), 'the os-pkgs CVE must NOT become a finding this slice')
  // the parse drops the os-pkgs Result entirely (class dispatch) — only the config Result yields a hit
  const hits = trivyAdapter.parse(synthetic)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].engine, 'trivy')
})

check('TRV-status-pass-skipped: a Misconfiguration with Status:PASS is NOT a finding (only FAIL is)', () => {
  const synthetic = {
    Results: [
      { Target: 'Dockerfile', Class: 'config', Misconfigurations: [
        { ID: 'DS-0001', Title: 'Use a tagged base image', Severity: 'MEDIUM', Status: 'PASS', CauseMetadata: {} }, // satisfied → not a finding
        { ID: 'DS-0026', Title: 'No HEALTHCHECK defined', Severity: 'LOW', Status: 'FAIL', CauseMetadata: {} },
      ] },
    ],
  }
  const { findings } = ingest(synthetic, trivyAdapter, { repoRoot: '', pass: 1 })
  assert.equal(findings.length, 1)
  assert.equal(findings[0].ruleId, 'DS-0026')
  // lowercase/whitespace PASS is still skipped (case-insensitive)
  assert.equal(trivyAdapter.parse({ Results: [{ Target: 'D', Class: 'config', Misconfigurations: [{ ID: 'X', Status: 'pass' }] }] }).length, 0)
})

check('TRV-reuses-class: trivyAdapter.classify() is the constant iac-misconfig — the SAME CLASS_DEFS entry checkov uses (one definition, two engines); NO new CLASS_DEFS entry was added for trivy', () => {
  assert.equal(trivyAdapter.classify('x'), 'iac-misconfig')
  assert.equal(trivyAdapter.classify('AVD-DS-0026'), 'iac-misconfig')
  assert.equal(checkovAdapter.classify('CKV_DOCKER_2'), 'iac-misconfig') // the other engine maps to the SAME class
  // ONE definition: the iac-misconfig entry is checkov's, grounded in scan-iac-misconfig / infrastructure-iac
  assert.equal(CLASS_DEFS['iac-misconfig'].baselineId, 'scan-iac-misconfig')
  assert.equal(CLASS_DEFS['iac-misconfig'].dimension, 'infrastructure-iac')
  // NO new CLASS_DEFS entry for trivy — the class map is the original 5 + plain-http-egress
  // (the egress source-scanner's own class, 0.8.66) + view-modify-all-data (the org-wide
  // grant source-scanner's own class, 0.8.67) + protocol-security-disabled (the Remote Site
  // Setting protocol-security source-scanner's own class, 0.8.69) + admin-privilege-grant
  // (the admin/privilege grant source-scanner's own class, 0.8.70) — none is trivy's
  assert.deepEqual(Object.keys(CLASS_DEFS).sort(), ['admin-privilege-grant', 'crud-fls', 'hardcoded-secrets', 'iac-misconfig', 'plain-http-egress', 'protocol-security-disabled', 'sharing', 'view-modify-all-data', 'viewall-overgrant'])
  assert.equal(CLASS_DEFS['trivy'], undefined)
})

check('TRV-classify/fail-safe: securityRelevant===undefined; collect() missing → null; parse(null/{}/{Results:null}/{Results:[]}/config-no-Misconfigs/misconfig-no-ID) → []/skipped, no crash; ingest(null) → 0 + honest note', () => {
  assert.equal(trivyAdapter.securityRelevant, undefined) // Trivy config findings are security/compliance by construction — no tag filter
  assert.equal(trivyAdapter.collect({ input: join(tmpdir(), 'definitely-not-here-trivy.json') }), null)
  assert.deepEqual(trivyAdapter.parse(null), [])
  assert.deepEqual(trivyAdapter.parse({}), []) // no Results key
  assert.deepEqual(trivyAdapter.parse({ Results: null }), [])
  assert.deepEqual(trivyAdapter.parse({ Results: [] }), [])
  assert.deepEqual(trivyAdapter.parse({ Results: [{ Target: 'x', Class: 'config' }] }), []) // a config Result with no Misconfigurations
  assert.deepEqual(trivyAdapter.parse({ Results: [{ Target: 'x', Class: 'config', Misconfigurations: [{ Title: 'no id', Status: 'FAIL' }] }] }), []) // a misconfig with no ID → skipped
  assert.deepEqual(trivyAdapter.parse({ Results: [{ Class: 'secret', Secrets: [{ RuleID: 'aws-key' }] }] }), []) // the secret class is Phase-2b → skipped
  const { findings, notes } = ingest(null, trivyAdapter, { repoRoot: '', pass: 1 })
  assert.equal(findings.length, 0)
  assert.ok(notes.some((n) => /no input collected/.test(n)))
})

check('TRV-merge-idempotent: ingest the fixture twice into a ledger → no dupes; a pre-existing llm finding survives', () => {
  const llm = {
    id: 't'.repeat(16),
    dimension: 'oauth-identity',
    title: 'pre-existing llm-inferred finding',
    severity: 'high',
    adjusted_severity: 'high',
    file: 'server/index.js:9',
    status: 'confirmed',
    first_seen: 1,
    last_seen: 1,
    verdict: 'confirmed_real',
    verdict_reasoning: 'reasoned over the code',
  }
  const ledger = { schema_version: '1', findings: [llm], passes: [] }
  const trv = ingestTrivy().findings
  const r1 = mergeFindings(ledger, trv, 1)
  assert.equal(r1.added, 1)
  assert.equal(ledger.findings.length, 2) // 1 llm + 1 trivy
  const r2 = mergeFindings(ledger, trv, 1)
  assert.equal(r2.added, 0)
  assert.equal(ledger.findings.length, 2) // idempotent — no dupes
  assert.ok(ledger.findings.some((f) => f.id === 't'.repeat(16) && !('provenance' in f)))
})

check('TRV-schema: a Trivy finding (class iac-misconfig, dimension infrastructure-iac) validates against $defs/finding', () => {
  for (const f of ingestTrivy().findings) assert.deepEqual(validateFinding(f), [])
})

check('TRV-CLI: --scanner trivy --input <fixture> --json --dry-run prints valid JSON with the anchor; exit 0', () => {
  const out = execFileSync(
    'node',
    [CLI, '--scanner', 'trivy', '--input', TRIVY, '--target', join(tmpdir(), 'nope-trivy'), '--dry-run', '--json'],
    { encoding: 'utf8' }
  )
  const parsed = JSON.parse(out)
  assert.equal(parsed.scanner, 'trivy')
  assert.equal(parsed.kind, 'file-parser')
  assert.equal(parsed.merged, null) // dry-run
  assert.equal(parsed.findings.length, 1)
  assert.ok(
    parsed.findings.some((f) => f.ruleId === 'DS-0026' && f.adjusted_severity === 'low' && f.class === 'iac-misconfig' && f.file === 'Dockerfile')
  )
})

check('TRV-CLI-merge: --scanner trivy writes the deterministic finding to the target ledger + is idempotent', () => {
  const d = mkdtempSync(join(tmpdir(), 'ingest-cli-trivy-'))
  dirs.push(d)
  const lp = join(d, '.security-review', 'audit-ledger.json')
  execFileSync('node', [CLI, '--scanner', 'trivy', '--input', TRIVY, '--target', d], { encoding: 'utf8' })
  const l1 = readJSON(lp)
  const t1 = l1.findings.filter((f) => f.engine === 'trivy')
  assert.equal(t1.length, 1)
  assert.equal(t1[0].ruleId, 'DS-0026')
  assert.equal(t1[0].adjusted_severity, 'low') // the sourced availability-only band floor (0.8.105)
  assert.equal(t1[0].class, 'iac-misconfig')
  execFileSync('node', [CLI, '--scanner', 'trivy', '--input', TRIVY, '--target', d], { encoding: 'utf8' })
  const l2 = readJSON(lp)
  assert.equal(l2.findings.filter((f) => f.engine === 'trivy').length, 1) // idempotent — no duplicate
})

// ───────────────────────────────── regexploit ReDoS adapter (RD*) — residual-shrinking · B5 #1 (0.8.56)
// The FIRST format-C (non-JSON) adapter: regexploit emits VERBATIM text only, so the evidence file IS the
// tool's stdout, `--all` (JSON-only enumeration) does not auto-recognize it (documented), and the explicit
// `--scanner regexploit --input` path ingests it. Tool→band from the ambiguity DEGREE
// (REDOS_DEGREE_TO_FINDING: exponential→high · polynomial→medium · unknown→medium — NEVER critical/blocker
// from the tool alone; reachability is the labelled residual). THE DESIGN DECISION under standing guard:
// classify()→null — resource-consumption-abuse is a MULTI-SHAPE dimension and sameOwnedClass falls back to
// a dimension match, so an owned class here would supersede co-located rate-limit / denial-of-wallet LLM
// findings (RD-non-supersession is the lock; its mutation — an owned class — turns it red). The fixture is
// genuine regexploit 1.0.0 output over seeded vulnerable py/js (3 py blocks with Context + 1 js block with
// no Context and TWO Redos records; a "Processed N regexes" trailer sits mid-file between the two tools).
const ingestRedos = (raw) => ingest(raw === undefined ? readText(REDOS) : raw, regexploitAdapter, { repoRoot: '', pass: 1 })

check('RD-determinism: ingest the real regexploit fixture twice → byte-identical findings', () => {
  const a = ingestRedos().findings
  const b = ingestRedos().findings
  assert.equal(JSON.stringify(a), JSON.stringify(b))
  assert.equal(a.length, 4)
})

check('RD-count: the real fixture → exactly 4 findings (3 exponential high + 1 cubic medium), all regexploit/resource-consumption-abuse/deterministic/no-class', () => {
  const fs = ingestRedos().findings
  assert.equal(fs.length, 4)
  assert.ok(fs.every((f) => f.engine === 'regexploit' && f.provenance === 'deterministic'))
  assert.ok(fs.every((f) => f.dimension === 'resource-consumption-abuse'))
  assert.ok(fs.every((f) => !('class' in f)), 'no regexploit finding ever carries an owned class')
  assert.deepEqual(fs.map((f) => f.adjusted_severity).sort(), ['high', 'high', 'high', 'medium'])
})

check('RD-anchor-exponential: (a+)+$ @ api/server.py:3 → HIGH from the exponential degree; CWE-1333 + the RCA gate (major) in the reasoning; the pattern (code, not user data) in the title', () => {
  const f = ingestRedos().findings.find((x) => x.file === 'api/server.py:3')
  assert.ok(f, 'the exponential anchor exists at api/server.py:3 (the #3 suffix IS the source line)')
  assert.equal(f.severity, 'high')
  assert.equal(f.adjusted_severity, 'high')
  assert.match(f.ruleId, /^redos-[0-9a-f]{16}$/) // deterministic pattern derivation, no tool rule ids
  assert.ok(f.title.includes('(a+)+$') && f.title.includes('exponential'), 'pattern + degree in the title')
  assert.match(f.verdict_reasoning, /regex ambiguity exponential → high/)
  assert.match(f.verdict_reasoning, /gated by resource-consumption-abuse \(major\)/) // the RCA gate, NOT scan-external-sast
  assert.match(f.verdict_reasoning, /cwe\.mitre\.org\/data\/definitions\/1333/)
  assert.equal(f.status, 'confirmed')
  assert.equal(f.verdict, 'confirmed_real')
})

check('RD-anchor-polynomial: a*a*a*$ @ api/server.py:5 (cubic) → MEDIUM — a polynomial degree is never high, never dropped', () => {
  const f = ingestRedos().findings.find((x) => x.file === 'api/server.py:5')
  assert.ok(f, 'the cubic anchor exists')
  assert.equal(f.adjusted_severity, 'medium')
  assert.ok(f.title.includes('cubic'))
  assert.match(f.verdict_reasoning, /regex ambiguity cubic → medium/)
})

check('RD-multi-record: the JS block (x+)+y(z+)+w carries TWO Redos records → ONE finding (one vulnerable regex at one locus), banded from the worst record', () => {
  const js = ingestRedos().findings.filter((x) => x.file.startsWith('api/validate.js'))
  assert.equal(js.length, 1, 'two Worst-case-complexity records in one block collapse to one finding')
  assert.equal(js[0].file, 'api/validate.js:1')
  assert.equal(js[0].adjusted_severity, 'high')
  assert.ok(js[0].title.includes('(x+)+y(z+)+w'))
})

check('RD-degree-map: REDOS_DEGREE_TO_FINDING is exactly exponential→high + the 10 polynomial degrees→medium; an unknown degree (?) → medium via parse, never dropped', () => {
  assert.equal(REDOS_DEGREE_TO_FINDING.exponential, 'high')
  const poly = ['linear', 'quadratic', 'cubic', 'quartic', 'quintic', 'sextic', 'septic', 'octic', 'nonic', 'decic']
  for (const d of poly) assert.equal(REDOS_DEGREE_TO_FINDING[d], 'medium', `${d} → medium`)
  assert.deepEqual(Object.keys(REDOS_DEGREE_TO_FINDING).sort(), [...poly, 'exponential'].sort())
  assert.ok(!Object.values(REDOS_DEGREE_TO_FINDING).some((v) => v === 'critical'), 'never critical/blocker from the tool alone')
  // an unknown degree word (regexploit prints "(?)" for starriness ≤ 0) still ingests at medium
  const synth = 'Vulnerable regex in a.py #7\nPattern: x*\n---\nWorst-case complexity: 1 ⭐ (?)\n'
  const { findings } = ingestRedos(synth)
  assert.equal(findings.length, 1)
  assert.equal(findings[0].adjusted_severity, 'medium')
  assert.match(findings[0].verdict_reasoning, /regex ambiguity \? → medium/)
})

check('RD-stable-ruleId: the ruleId is a deterministic derivation from the PATTERN — same pattern in two files → same ruleId but distinct ids (distinct loci); matches the fixture anchor', () => {
  const synth =
    'Vulnerable regex in a.py #1\nPattern: (a+)+$\n---\nWorst-case complexity: 11 ⭐ (exponential)\n\n' +
    'Vulnerable regex in b.py #2\nPattern: (a+)+$\n---\nWorst-case complexity: 11 ⭐ (exponential)\n'
  const { findings } = ingestRedos(synth)
  assert.equal(findings.length, 2)
  assert.equal(findings[0].ruleId, findings[1].ruleId, 'same pattern → same deterministic ruleId')
  assert.notEqual(findings[0].id, findings[1].id, 'distinct loci → distinct finding ids')
  const anchor = ingestRedos().findings.find((x) => x.file === 'api/server.py:3')
  assert.equal(findings[0].ruleId, anchor.ruleId, 'the derivation is stable across inputs/runs (no timestamps)')
})

check('RD-no-class / classify: classify() is the constant null (THE design decision), no securityRelevant, findings carry no class', () => {
  assert.equal(regexploitAdapter.classify('anything'), null)
  assert.equal(regexploitAdapter.classify('redos-abc'), null)
  assert.equal(regexploitAdapter.securityRelevant, undefined) // every reported block is an ambiguous regex
  assert.ok(ingestRedos().findings.every((f) => !('class' in f)))
})

check('RD-non-supersession (the design-decision standing lock): a co-located llm-inferred resource-consumption-abuse finding (no class — a missing-rate-limit shape) is NOT superseded after ingest + reconcile', () => {
  const det = ingestRedos().findings.find((x) => x.file === 'api/server.py:3')
  assert.ok(det && det.provenance === 'deterministic')
  // an llm-inferred RCA finding of a DIFFERENT SHAPE (missing rate limit), same file, overlapping lines
  const llm = {
    id: '3'.repeat(16),
    dimension: 'resource-consumption-abuse',
    title: 'No rate limit on the token-validation endpoint',
    severity: 'high',
    adjusted_severity: 'high',
    file: 'api/server.py:1-40', // overlaps det's :3
    status: 'confirmed',
    first_seen: 1,
    last_seen: 1,
    verdict: 'confirmed_real',
    verdict_reasoning: 'reasoned the endpoint is unmetered',
  }
  // PRECONDITIONS that WOULD fire supersession if the adapter owned a class: same dimension + same locus.
  // Asserting them makes the guard sharp — the ONLY missing ingredient is the owned class (classify()→null).
  assert.equal(det.dimension, llm.dimension, 'same dimension (the sameOwnedClass fallback signal)')
  assert.equal(sameLocation(det, llm), true, 'overlapping locus (the other supersession signal)')
  const { findings, superseded, supersededIds } = reconcileProvenance([det, llm])
  assert.equal(superseded, 0, 'the LLM rate-limit finding is NOT superseded — the ReDoS row sits beside it')
  assert.deepEqual(supersededIds, [])
  assert.equal(findings.find((f) => f.id === llm.id).status, 'confirmed') // status unchanged
  assert.equal(findings.find((f) => f.id === det.id).status, 'confirmed')
  // the guard itself, asserted LAST so a class-owning mutation fails first at "superseded === 0"
  // (the supersession visibly FIRES), proving the protection is the null classify, not an accident
  assert.equal('class' in det, false, 'no owned class on the deterministic finding')
})

check('RD-fail-safe: collect() missing/empty → null; parse over every degenerate + parsed-JSON shape → []/skip (a block missing Pattern or complexity is dropped); ingest(null) → 0 + honest note', () => {
  assert.equal(regexploitAdapter.collect({ input: join(tmpdir(), 'definitely-not-here-redos.txt') }), null)
  const emptyP = join(tmpdir(), `redos-empty-${process.pid}.txt`)
  writeFileSync(emptyP, '   \n')
  assert.equal(regexploitAdapter.collect({ input: emptyP }), null)
  rmSync(emptyP, { force: true })
  // parse is format-C: only a marker-carrying STRING yields hits; parsed-JSON shapes are honest []
  assert.deepEqual(regexploitAdapter.parse(null), [])
  assert.deepEqual(regexploitAdapter.parse({}), [])
  assert.deepEqual(regexploitAdapter.parse([]), [])
  assert.deepEqual(regexploitAdapter.parse(42), [])
  assert.deepEqual(regexploitAdapter.parse('Processed 12 regexes\n'), []) // a clean run — no blocks
  assert.deepEqual(regexploitAdapter.parse('{"results":[]}'), []) // JSON text is not the regexploit format
  // a header with no Pattern line, and a header+Pattern with no complexity line → both dropped, no crash
  assert.deepEqual(regexploitAdapter.parse('Vulnerable regex in a.py #1\n---\n'), [])
  assert.deepEqual(regexploitAdapter.parse('Vulnerable regex in a.py #1\nPattern: (a+)+$\n---\n'), [])
  // a header with NO #line (stdin scans) still ingests, with a bare-file locus
  const noLine = ingestRedos('Vulnerable regex in a.py\nPattern: (a+)+$\n---\nWorst-case complexity: 11 ⭐ (exponential)\n').findings
  assert.equal(noLine.length, 1)
  assert.equal(noLine[0].file, 'a.py')
  const { findings, notes } = ingestRedos(null)
  assert.equal(findings.length, 0)
  assert.ok(notes.some((n) => /no input collected/.test(n)))
})

check('RD-merge-idempotent: ingest the fixture twice into a ledger → no dupes; a pre-existing llm finding survives', () => {
  const llm = {
    id: '4'.repeat(16),
    dimension: 'resource-consumption-abuse',
    title: 'pre-existing llm-inferred finding',
    severity: 'medium',
    adjusted_severity: 'medium',
    file: 'api/other.py:9',
    status: 'confirmed',
    first_seen: 1,
    last_seen: 1,
    verdict: 'confirmed_real',
    verdict_reasoning: 'reasoned over the code',
  }
  const ledger = { schema_version: '1', findings: [llm], passes: [] }
  const rd = ingestRedos().findings
  const r1 = mergeFindings(ledger, rd, 1)
  assert.equal(r1.added, 4)
  assert.equal(ledger.findings.length, 5) // 1 llm + 4 regexploit
  const r2 = mergeFindings(ledger, rd, 1)
  assert.equal(r2.added, 0)
  assert.equal(ledger.findings.length, 5) // idempotent — no dupes
  assert.ok(ledger.findings.some((f) => f.id === '4'.repeat(16) && !('provenance' in f)))
})

check('RD-schema: a regexploit finding (no class, dimension resource-consumption-abuse) validates against $defs/finding', () => {
  for (const f of ingestRedos().findings) assert.deepEqual(validateFinding(f), [])
})

check('RD-CLI: --scanner regexploit --input <fixture> --json --dry-run prints valid JSON with the anchor; exit 0', () => {
  const out = execFileSync('node', [CLI, '--scanner', 'regexploit', '--input', REDOS, '--json', '--dry-run'], {
    encoding: 'utf8',
  })
  const parsed = JSON.parse(out)
  assert.equal(parsed.scanner, 'regexploit')
  assert.equal(parsed.kind, 'file-parser')
  assert.equal(parsed.findings.length, 4)
  assert.ok(parsed.findings.some((f) => f.file === 'api/server.py:3' && f.adjusted_severity === 'high'))
  assert.ok(parsed.findings.some((f) => f.file === 'api/server.py:5' && f.adjusted_severity === 'medium'))
})

check('RD-CLI-merge: --scanner regexploit writes the deterministic findings to the target ledger + is idempotent', () => {
  const d = mkdtempSync(join(tmpdir(), 'ingest-redos-'))
  dirs.push(d)
  execFileSync('node', [CLI, '--scanner', 'regexploit', '--input', REDOS, '--target', d], { encoding: 'utf8' })
  const lp = join(d, '.security-review', 'audit-ledger.json')
  const l1 = readJSON(lp)
  assert.equal(l1.findings.filter((f) => f.engine === 'regexploit').length, 4)
  execFileSync('node', [CLI, '--scanner', 'regexploit', '--input', REDOS, '--target', d], { encoding: 'utf8' })
  const l2 = readJSON(lp)
  assert.equal(l2.findings.filter((f) => f.engine === 'regexploit').length, 4) // idempotent — no duplicates
})

// ───────────────────────────────── recognizer (RC*) — content-shape routing for --all
// Drives recognizeScanner() on the REAL committed fixtures + synthetic non-adapter shapes. The
// shapes are provably disjoint (40/40 on real evidence); these guards lock that contract so a
// regression in any `detect` predicate (or a new collision) is caught.
const RC_FIXMAP = {
  'code-analyzer': SOLANO,
  'checkov': CHECKOV,
  'semgrep': SEMGREP_WARN,
  'bandit': BANDIT,
  'njsscan': NJSSCAN,
  'gitleaks': GITLEAKS,
  'detect-secrets': DETECT_SECRETS,
  'osv': OSV,
  'npm-audit': NPM_AUDIT,
  'trivy': TRIVY,
}
check('RC-each: every committed fixture recognizes as its OWN adapter (content shape, not filename)', () => {
  for (const [name, path] of Object.entries(RC_FIXMAP)) {
    assert.equal(recognizeScanner(readJSON(path)), name, `${path} → ${name}`)
  }
  // the second code-analyzer (SFGE) + the second semgrep (helios) fixtures also route correctly,
  // as does the sessionid-seeded CA capture (0.8.65)
  assert.equal(recognizeScanner(readJSON(SFGE)), 'code-analyzer')
  assert.equal(recognizeScanner(readJSON(SESSFIX)), 'code-analyzer')
  assert.equal(recognizeScanner(readJSON(SEMGREP_ERR)), 'semgrep')
  // the format-C TEXT fixture (0.8.56): a STRING shape, provably disjoint from every JSON adapter
  // by construction (all 11 other detects require an object/array) — a single match, never ambiguous.
  assert.equal(recognizeScanner(readText(REDOS)), 'regexploit')
  // the SARIF fixtures (0.8.61): the top-level runs[] shape is disjoint from every other detect
  // (the SAST trio keys on a TOP-LEVEL results[], which SARIF nests inside runs[]) — a single
  // match each, 0 ambiguous, whichever engine produced the file
  assert.equal(recognizeScanner(readJSON(join(FIX, 'opengrep-taint-seeded.sarif'))), 'sarif')
  assert.equal(recognizeScanner(readJSON(join(FIX, 'semgrep-taint-seeded.sarif'))), 'sarif')
  // opengrep JSON: content-INDISTINGUISHABLE from semgrep's format (D1) — the recognizer honestly
  // reports the FORMAT; the engine label comes from --scanner opengrep / the opengrep-* evidence name
  assert.equal(recognizeScanner(readJSON(join(FIX, 'opengrep-taint-seeded.json'))), 'semgrep')
})

check('RC-regexploit-honest-false: detect() is false for EVERY parsed-JSON shape (the --all path never routes a JSON file to the text adapter) and for a marker-less string', () => {
  // every committed JSON fixture → false (format C: --all JSON-parses evidence before recognition,
  // so the regexploit detect can only ever see parsed JSON there — and honestly declines it all)
  for (const path of [...Object.values(RC_FIXMAP), SFGE, SEMGREP_ERR]) {
    assert.equal(regexploitAdapter.detect(readJSON(path)), false, `${path} → false`)
  }
  assert.equal(regexploitAdapter.detect({}), false)
  assert.equal(regexploitAdapter.detect([]), false)
  assert.equal(regexploitAdapter.detect(null), false)
  assert.equal(regexploitAdapter.detect('Processed 12 regexes\n'), false) // a clean run carries no block markers
  assert.equal(recognizeScanner('Processed 12 regexes\n'), null) // ...so the recognizer honestly declines it too
})

check('RC-empty: a clean (results:[]) scan is STILL recognized as its scanner (honest accounting)', () => {
  // an EMPTY results[] is disambiguated by the top-level markers, AND-NOT the higher-priority trio members
  assert.equal(
    recognizeScanner({ version: '1.55.0', results: [], paths: { scanned: [] }, errors: [], engine_requested: 'OSS', skipped_rules: [] }),
    'semgrep'
  )
  assert.equal(recognizeScanner({ errors: [], generated_at: '2026-06-30T00:00:00Z', metrics: { _totals: {} }, results: [] }), 'bandit')
  assert.equal(recognizeScanner({ results: [], experimental_config: { call_analysis_params: {} } }), 'osv')
})

check('RC-none: non-adapter evidence shapes → null (incl. the deps-npm WRAPPER ≠ npm-audit — content beats filename)', () => {
  assert.equal(recognizeScanner({ satisfied: ['fail-crud-fls'], cleared: [], na: [], collected_by: 'build-evidence-index' }), null) // index.json
  assert.equal(recognizeScanner({ version: '5.2.4', data: [{ file: 'x.js', results: [] }] }), null) // retire
  assert.equal(recognizeScanner({ openapi: '3.0.3', paths: {} }), null) // an openapi-mcp-* spec
  // the toolkit's own `deps-npm` disposition WRAPPER — has NO auditReportVersion/vulnerabilities, so it is
  // NOT recognized as npm-audit even though its FILENAME (deps-npm-*.json) collides — the proof of content routing
  assert.equal(
    recognizeScanner({ family: 'deps', tool: 'npm', osv_scanner_result: {}, gap: 'x', disposition: 'documented', honest_ceiling: 'declared-only' }),
    null
  )
})

check('RC-ambiguous: a raw matching TWO detects returns {ambiguous:[…]}, NEVER a single guessed name', () => {
  // a synthetic Frankenstein object carrying BOTH code-analyzer's violations[] AND trivy's Results[]+SchemaVersion
  const both = recognizeScanner({ violations: [], Results: [], SchemaVersion: 2 })
  assert.equal(typeof both, 'object')
  assert.ok(both && Array.isArray(both.ambiguous), 'returns the {ambiguous:[…]} sentinel, not a string')
  assert.deepEqual([...both.ambiguous].sort(), ['code-analyzer', 'trivy'])
  // structural property: a bare adapter NAME is returned ONLY when exactly one detect matches
  assert.equal(recognizeScanner(readJSON(TRIVY)), 'trivy')
})

check('RC-failsafe: null/{}/{results:null}/non-object → null, NO throw ([] → gitleaks per the proven predicate)', () => {
  for (const raw of [null, undefined, {}, { results: null }, 5, 'x']) {
    assert.equal(recognizeScanner(raw), null, `${JSON.stringify(raw)} → null, no throw`)
  }
  // NOTE (documented in the 0.8.40 CHANGELOG): the BUILDER prompt's RC-failsafe line lists `[]`→null, but the
  // PROVEN gitleaks predicate + the design note recognize an empty top-level array as a CLEAN gitleaks scan
  // (0 findings, harmless). The predicate is authoritative, so `[]` → 'gitleaks' — never a throw either way.
  assert.equal(recognizeScanner([]), 'gitleaks')
})

// ───────────────────────────────── --all (journey-wiring mode) BEHAVIOR
// Build a tmp target whose evidence/ carries SEVERAL real fixtures RENAMED to plausible evidence names
// (checkov→iac-*, gitleaks→secret-scan-*, npm-audit→deps-npm-*, …) to exercise filename-independence, PLUS a
// non-adapter index.json and a permissionset over-grant fixture. Then run `--all --json` via the CLI.
function setupAllTarget({ withCodeAnalyzer = true } = {}) {
  const T = mkdtempSync(join(tmpdir(), 'ingest-all-'))
  dirs.push(T)
  const ev = join(T, '.security-review', 'evidence')
  mkdirSync(ev, { recursive: true })
  mkdirSync(join(T, 'force-app', 'permissionsets'), { recursive: true })
  writeFileSync(
    join(T, 'force-app', 'permissionsets', 'Solano_Admin.permissionset-meta.xml'),
    readFileSync(join(FIX, 'permissionsets', 'Solano_Admin.permissionset-meta.xml'), 'utf8')
  )
  const cp = (src, asName) => writeFileSync(join(ev, asName), readFileSync(src, 'utf8'))
  cp(CHECKOV, 'iac-dockerfile-2026-06-30.json') // checkov under a name with NO "checkov" token
  cp(SEMGREP_WARN, 'semgrep-2026-06-30.json')
  cp(GITLEAKS, 'secret-scan-history-2026-06-30.json') // gitleaks under the secret-scan-* prefix
  cp(DETECT_SECRETS, 'secret-scan-detect-secrets-2026-06-30.json') // collides with gitleaks' prefix — disambiguated by shape
  cp(OSV, 'osv-2026-06-30.json')
  cp(NPM_AUDIT, 'deps-npm-2026-06-30.json') // the real npm audit output under the deps-npm-* name (NOT the wrapper)
  cp(BANDIT, 'bandit-2026-06-30.json')
  cp(NJSSCAN, 'njsscan-2026-06-30.json')
  cp(TRIVY, 'trivy-2026-06-30.json')
  if (withCodeAnalyzer) cp(SOLANO, 'code-analyzer-2026-06-30.json')
  // a non-adapter evidence-index file MUST be skipped (named), never ingested
  writeFileSync(join(ev, 'index.json'), JSON.stringify({ satisfied: ['fail-crud-fls'], cleared: [], na: [], collected_by: 'build-evidence-index' }))
  return T
}
const runAll = (T) => JSON.parse(execFileSync('node', [CLI, '--all', '--target', T, '--json'], { encoding: 'utf8' }))

check('ALL1 --all recognizes + ingests every renamed scanner output by content shape; each engine lands deterministic', () => {
  const out = runAll(setupAllTarget())
  const engines = new Set(out.findings.map((f) => f.engine))
  for (const e of ['metadata', 'pmd', 'sfge', 'checkov', 'semgrep', 'gitleaks', 'detect-secrets', 'osv', 'npm-audit', 'bandit', 'njsscan', 'trivy']) {
    assert.ok(engines.has(e), `engine ${e} present in the --all band`)
  }
  assert.ok(out.findings.length >= 12, 'a full band across all families')
  assert.ok(out.findings.every((f) => f.provenance === 'deterministic'), 'every --all finding is provenance:deterministic')
  // the always-on metadata source scan landed its over-grant
  assert.ok(out.findings.some((f) => f.engine === 'metadata' && f.ruleId === 'viewall-overgrant'), 'metadata-viewall over-grant present')
  // spot-check the engine tagging routed correctly (checkov→checkov, gitleaks→gitleaks, osv→osv)
  assert.ok(out.findings.some((f) => f.engine === 'checkov' && f.class === 'iac-misconfig'))
  assert.ok(out.findings.some((f) => f.engine === 'gitleaks' && f.class === 'hardcoded-secrets'))
})

check('ALL2 the non-adapter index.json is SKIPPED (named) — no findings, no scanner row, no engine named after it', () => {
  const out = runAll(setupAllTarget())
  assert.ok(out.skipped.some((s) => s.file === 'evidence/index.json'), 'index.json is named in skipped[]')
  assert.ok(!out.findings.some((f) => /index/i.test(String(f.engine))), 'no engine named after index.json')
  assert.ok(!out.scanners.some((s) => /index\.json/.test(s.file || '')), 'index.json is not counted as a scanner')
})

check('ALL3 --all is byte-deterministic — two runs on the same target → identical ledger', () => {
  const T = setupAllTarget()
  const lp = join(T, '.security-review', 'audit-ledger.json')
  execFileSync('node', [CLI, '--all', '--target', T], { encoding: 'utf8' })
  const l1 = readFileSync(lp, 'utf8')
  execFileSync('node', [CLI, '--all', '--target', T], { encoding: 'utf8' })
  assert.equal(readFileSync(lp, 'utf8'), l1, 'the ledger is byte-identical on the second --all run')
})

check('ALL4 PENDING accounting: Code Analyzer absent → crud-fls+sharing PENDING; present → crud-fls findings appear', () => {
  const outNo = runAll(setupAllTarget({ withCodeAnalyzer: false }))
  assert.deepEqual([...outNo.pending].sort(), ['crud-fls', 'sharing'])
  assert.ok(!outNo.findings.some((f) => f.class === 'crud-fls'), 'no crud-fls band when Code Analyzer is absent')
  assert.ok(outNo.notes.some((n) => /PENDING-OWNER-RUN/.test(n)), 'an explicit PENDING-OWNER-RUN note is emitted')
  const outYes = runAll(setupAllTarget({ withCodeAnalyzer: true }))
  assert.deepEqual(outYes.pending, [], 'no PENDING when Code Analyzer is present')
  assert.ok(outYes.findings.some((f) => f.class === 'crud-fls' && f.provenance === 'deterministic'), 'crud-fls appears when Code Analyzer is present')
})

check('ALL5 secret-never-leaks holds THROUGH --all — no secret/PII/hash token reaches the ledger', () => {
  const T = setupAllTarget()
  execFileSync('node', [CLI, '--all', '--target', T], { encoding: 'utf8' })
  const ledgerText = readFileSync(join(T, '.security-review', 'audit-ledger.json'), 'utf8')
  // gitleaks fixture: its Match line + raw Secret are deliberately never read by the adapter
  for (const f of readJSON(GITLEAKS)) {
    if (f.Match) assert.ok(!ledgerText.includes(f.Match), `a gitleaks Match line never reaches the ledger`)
    if (f.Secret) assert.ok(!ledgerText.includes(f.Secret), `a gitleaks raw Secret value never reaches the ledger`)
  }
  // detect-secrets fixture: the hashed_secret SHA is deliberately never read
  const ds = readJSON(DETECT_SECRETS)
  for (const occs of Object.values(ds.results)) {
    for (const o of occs) {
      if (o.hashed_secret) assert.ok(!ledgerText.includes(o.hashed_secret), `a detect-secrets hashed_secret never reaches the ledger`)
    }
  }
  // belt-and-suspenders: no canonical live-secret pattern survives
  for (const re of [/AKIA[0-9A-Z]{16}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /ghp_[A-Za-z0-9]{20,}/, /xox[baprs]-[A-Za-z0-9-]{10,}/]) {
    assert.ok(!re.test(ledgerText), `no secret matching ${re} in the ledger`)
  }
})

check('ALL-SARIF1 (0.8.61): --all enumerates evidence/*.sarif; SARIF findings label their engine from tool.driver.name; the opengrep-*.json evidence name refines the semgrep-format label to \'opengrep\' (D1 — never \'semgrep\'); JSON+SARIF of the same hit merge to ONE row; byte-deterministic', () => {
  const T = mkdtempSync(join(tmpdir(), 'ingest-sarif-'))
  dirs.push(T)
  const ev = join(T, '.security-review', 'evidence')
  mkdirSync(ev, { recursive: true })
  writeFileSync(join(ev, 'opengrep-2026-07-03.json'), readText(OPENGREP_JSON))
  writeFileSync(join(ev, 'opengrep-2026-07-03.sarif'), readText(OPENGREP_SARIF))
  writeFileSync(join(ev, 'semgrep-2026-07-03.sarif'), readText(SEMGREP_SARIF))
  const out = runAll(T)
  // both .sarif files are enumerated and route to the sarif adapter
  const sarifRows = out.scanners.filter((s) => s.scanner === 'sarif')
  assert.equal(sarifRows.length, 2, `.sarif evidence enumerated (got ${JSON.stringify(out.scanners)})`)
  // the JSON capture lands under the opengrep adapter via the documented evidence name, with a note
  assert.ok(out.scanners.some((s) => s.scanner === 'opengrep' && s.file === 'evidence/opengrep-2026-07-03.json'))
  assert.ok(out.notes.some((n) => /engine label refined to 'opengrep'/.test(n)), 'the label refinement is honest + visible')
  // engine labels: the seeded rule appears ONCE per producer — opengrep (JSON+SARIF converge on
  // ONE id: same engine+ruleId+file:line) and semgrep (its own SARIF) — and the opengrep rows
  // NEVER say semgrep
  const seeded = out.findings.filter((f) => f.ruleId === 'seeded-request-param-to-sql-sink')
  const og = seeded.filter((f) => f.engine === 'opengrep')
  const sg = seeded.filter((f) => f.engine === 'semgrep')
  assert.equal(new Set(og.map((f) => f.id)).size, 1, 'the JSON-route and SARIF-route opengrep findings share ONE id')
  assert.equal(sg.length, 1)
  assert.ok(og.every((f) => f.reachable === true), 'the opengrep rows carry the trace')
  assert.ok(!('reachable' in sg[0]), 'the CE-semgrep row honestly carries none')
  // ledger: the converged opengrep id is ONE row (idempotent same-id merge), and re-running --all
  // twice yields a byte-identical ledger (determinism holds through the .sarif enumeration)
  const lp = join(T, '.security-review', 'audit-ledger.json')
  const l1 = readFileSync(lp, 'utf8')
  const ledger = JSON.parse(l1)
  assert.equal(ledger.findings.filter((f) => f.engine === 'opengrep').length, 1)
  execFileSync('node', [CLI, '--all', '--target', T], { encoding: 'utf8' })
  assert.equal(readFileSync(lp, 'utf8'), l1, 'the ledger is byte-identical on the second --all run')
})

check('ALL6 format-C evidence (0.8.56): redos-*.txt is invisible to --all (the .json/.sarif enumeration — no crash, no row); the same text misnamed .json is skipped HONESTLY as unparseable; the explicit --scanner path ingests it', () => {
  const T = setupAllTarget()
  const ev = join(T, '.security-review', 'evidence')
  writeFileSync(join(ev, 'redos-2026-07-03.txt'), readText(REDOS))
  writeFileSync(join(ev, 'redos-misnamed-2026-07-03.json'), readText(REDOS)) // an operator misnaming the text .json
  const out = runAll(T)
  // the .txt is not even enumerated (documented format-C limitation) — no findings, no scanner row, no skip row
  assert.ok(!out.findings.some((f) => f.engine === 'regexploit'), 'no regexploit findings via --all')
  assert.ok(!out.scanners.some((s) => s.scanner === 'regexploit'), 'no regexploit scanner row via --all')
  assert.ok(!out.skipped.some((s) => /redos-2026-07-03\.txt/.test(s.file || '')), 'the .txt is outside the *.json enumeration')
  // the misnamed .json IS enumerated and skipped honestly (never guessed, never crashes the pass)
  const sk = out.skipped.find((s) => s.file === 'evidence/redos-misnamed-2026-07-03.json')
  assert.ok(sk && /not valid JSON|unparseable JSON/.test(`${sk.reason}`), 'the misnamed text is an honest unparseable-JSON skip')
  // the documented ingest route: the explicit --scanner form lands all 4 findings in the SAME ledger
  execFileSync('node', [CLI, '--scanner', 'regexploit', '--input', join(ev, 'redos-2026-07-03.txt'), '--target', T], { encoding: 'utf8' })
  const ledger = readJSON(join(T, '.security-review', 'audit-ledger.json'))
  assert.equal(ledger.findings.filter((f) => f.engine === 'regexploit').length, 4)
  assert.ok(ledger.findings.every((f) => f.engine !== 'regexploit' || !('class' in f)))
})

check('EG-all (--all journey wiring): egress-plain-http ALWAYS runs — a plain-http RemoteSiteSetting under the target lands in the band + ledger with a scanner row; a target with no egress metadata reports it clean', () => {
  const T = mkdtempSync(join(tmpdir(), 'ingest-egress-all-'))
  dirs.push(T)
  // copy the fixture under the target so the source-scanner finds it (no evidence/ needed)
  mkdirSync(join(T, 'force-app', 'main', 'default', 'remoteSiteSettings'), { recursive: true })
  writeFileSync(
    join(T, 'force-app', 'main', 'default', 'remoteSiteSettings', 'Insecure_RSS.remoteSite-meta.xml'),
    readFileSync(join(EGFIX, 'Insecure_RSS.remoteSite-meta.xml'), 'utf8')
  )
  const out = runAll(T)
  assert.ok(
    out.scanners.some((s) => s.scanner === 'egress-plain-http' && s.kind === 'source-scanner' && s.findings === 1 && s.status === 'ran'),
    `egress-plain-http scanner row present (got ${JSON.stringify(out.scanners)})`
  )
  const f = out.findings.find((x) => x.ruleId === 'plain-http-egress')
  assert.ok(f, 'the declared plain-http endpoint is in the --all band')
  assert.equal(f.class, 'plain-http-egress')
  assert.equal(f.dimension, 'package-metadata')
  assert.equal(f.adjusted_severity, 'high')
  const ledger = readJSON(join(T, '.security-review', 'audit-ledger.json'))
  assert.ok(ledger.findings.some((x) => x.ruleId === 'plain-http-egress'), 'merged into the ledger')
  // and a target with NO egress-config metadata reports the scanner honestly clean — no crash
  const out2 = runAll(setupAllTarget())
  assert.ok(out2.scanners.some((s) => s.scanner === 'egress-plain-http' && s.findings === 0 && s.status === 'clean'))
})

check('PV-all (--all journey wiring): view-modify-all-data ALWAYS runs — a granted-ViewAllData permission set under the target lands in the band + ledger with a scanner row; a target with no org-wide grant reports it clean', () => {
  const T = mkdtempSync(join(tmpdir(), 'ingest-vmad-all-'))
  dirs.push(T)
  // copy the fixture under the target so the source-scanner finds it (no evidence/ needed)
  mkdirSync(join(T, 'force-app', 'main', 'default', 'permissionsets'), { recursive: true })
  writeFileSync(
    join(T, 'force-app', 'main', 'default', 'permissionsets', 'Overreach.permissionset-meta.xml'),
    readFileSync(join(VMADFIX, 'Overreach.permissionset-meta.xml'), 'utf8')
  )
  const out = runAll(T)
  assert.ok(
    out.scanners.some((s) => s.scanner === 'view-modify-all-data' && s.kind === 'source-scanner' && s.findings === 2 && s.status === 'ran'),
    `view-modify-all-data scanner row present (got ${JSON.stringify(out.scanners)})`
  )
  const f = out.findings.find((x) => x.ruleId === 'view-modify-all-data')
  assert.ok(f, 'the declared org-wide grant is in the --all band')
  assert.equal(f.class, 'view-modify-all-data')
  assert.equal(f.dimension, 'admin-surface')
  assert.equal(f.adjusted_severity, 'info')
  const ledger = readJSON(join(T, '.security-review', 'audit-ledger.json'))
  assert.ok(ledger.findings.some((x) => x.ruleId === 'view-modify-all-data'), 'merged into the ledger')
  // and a target with NO org-wide grant (setupAllTarget's permission set carries only
  // objectPermissions) reports the scanner honestly clean — no crash, no double-report
  const out2 = runAll(setupAllTarget())
  assert.ok(out2.scanners.some((s) => s.scanner === 'view-modify-all-data' && s.findings === 0 && s.status === 'clean'))
})

check('AP-all (--all journey wiring): admin-privilege-grant ALWAYS runs — a granted-ManageUsers permission set under the target lands in the band + ledger with a scanner row; a target with no admin/privilege grant reports it clean', () => {
  const T = mkdtempSync(join(tmpdir(), 'ingest-apg-all-'))
  dirs.push(T)
  // copy the fixture under the target so the source-scanner finds it (no evidence/ needed)
  mkdirSync(join(T, 'force-app', 'main', 'default', 'permissionsets'), { recursive: true })
  writeFileSync(
    join(T, 'force-app', 'main', 'default', 'permissionsets', 'AdminOverreach.permissionset-meta.xml'),
    readFileSync(join(APGFIX, 'AdminOverreach.permissionset-meta.xml'), 'utf8')
  )
  const out = runAll(T)
  assert.ok(
    out.scanners.some((s) => s.scanner === 'admin-privilege-grant' && s.kind === 'source-scanner' && s.findings === 2 && s.status === 'ran'),
    `admin-privilege-grant scanner row present (got ${JSON.stringify(out.scanners)})`
  )
  const f = out.findings.find((x) => x.ruleId === 'admin-privilege-grant')
  assert.ok(f, 'the declared admin/privilege grant is in the --all band')
  assert.equal(f.class, 'admin-privilege-grant')
  assert.equal(f.dimension, 'admin-surface')
  assert.equal(f.adjusted_severity, 'info')
  const ledger = readJSON(join(T, '.security-review', 'audit-ledger.json'))
  assert.ok(ledger.findings.some((x) => x.ruleId === 'admin-privilege-grant'), 'merged into the ledger')
  // and a target with NO admin/privilege grant (setupAllTarget's permission set carries
  // only objectPermissions) reports the scanner honestly clean — no crash, no double-report
  const out2 = runAll(setupAllTarget())
  assert.ok(out2.scanners.some((s) => s.scanner === 'admin-privilege-grant' && s.findings === 0 && s.status === 'clean'))
})

// ─────────────────────────────────────────────────────────────────── cleanup
for (const d of dirs) {
  try {
    rmSync(d, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

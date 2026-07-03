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
 *   U — an unmapped rule is still ingested as deterministic (never dropped) with the
 *       documented Code-Analyzer-severity fallback + a note.
 *   M — merge is additive + idempotent (re-ingest → no duplicates; LLM findings survive).
 *   F — fail-safe: missing / non-JSON / empty input → no findings, no crash.
 *   SC — a deterministic finding validates against the extended audit-ledger.schema.json;
 *        an existing llm-inferred finding (no provenance) still validates; a deterministic
 *        finding missing engine FAILS (the conditional bites).
 *   AD — the pluggable adapter registry: 12 adapters across both kinds (file-parser:
 *        code-analyzer/checkov/semgrep/bandit/njsscan/gitleaks/detect-secrets/osv/npm-audit/trivy/regexploit + source-scanner: metadata-viewall).
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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  ingest,
  buildFinding,
  codeAnalyzerAdapter,
  metadataViewAllAdapter,
  checkovAdapter,
  semgrepAdapter,
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
  hasSecurityTag,
  REQ_SEVERITY_TO_FINDING,
  CA_SEVERITY_TO_FINDING,
  SEMGREP_SEVERITY_TO_FINDING,
  BANDIT_SEVERITY_TO_FINDING,
  NJSSCAN_SEVERITY_TO_FINDING,
  CVSS_SCORE_TO_FINDING,
  OSV_LABEL_TO_FINDING,
  NPM_SEVERITY_TO_FINDING,
  REDOS_DEGREE_TO_FINDING,
  CLASS_DEFS,
  RULE_CLASS,
} from '../harness/ingest-scanner-findings.mjs'
import { reconcileProvenance } from '../harness/reconcile-provenance.mjs'
import { sameLocation } from '../harness/finding-clusters.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'ingest-scanner-findings.mjs')
const FIX = join(PLUGIN, 'acceptance', 'fixtures')
const SOLANO = join(FIX, 'code-analyzer-solano.json')
const SFGE = join(FIX, 'code-analyzer-sfge-meridian.json')
const CHECKOV = join(FIX, 'checkov-dockerfile-solano.json')
const SEMGREP_WARN = join(FIX, 'semgrep-coldstart-full.json') // 2× WARNING (dynamic-urllib / SSRF)
const SEMGREP_ERR = join(FIX, 'semgrep-helios.json') // 1× ERROR (detect-child-process / CWE-78)
const BANDIT = join(FIX, 'bandit-coldstart-full.json') // 4× MEDIUM (B608 SQLi anchor + 2× B310 + B104)
const NJSSCAN = join(FIX, 'njsscan-solano.json') // 2 nodejs findings: node_secret ERROR + helmet_feature_disabled WARNING
const GITLEAKS = join(FIX, 'gitleaks-coldstart-full.json') // 3× generic-api-key (anchor mcp/server.py:27 + 2× ops/deploy-notes.md)
const DETECT_SECRETS = join(FIX, 'detect-secrets-solano.json') // genuine detect-secrets 1.5.0: 24 occ across 6 files, 3 types (anchor .security-review/audit-engine.mjs:181 Secret Keyword)
const OSV = join(FIX, 'osv-coldstart-full.json') // genuine OSV-Scanner: 1 source (mcp/requirements.txt), 3 PyPI pkgs, 11 vulns (1 critical h11 / 3 high / 6 medium / 1 low starlette)
const NPM_AUDIT = join(FIX, 'npm-audit-solano.json') // genuine `npm audit --json` v2: 4 vulnerable pkgs (body-parser/express/path-to-regexp/qs), moderate×2 + high×2
const TRIVY = join(FIX, 'trivy-dockerfile-solano.json') // genuine Trivy 0.71.2 filesystem scan: 1 Class:'config' Result, 1 FAIL misconfig (DS-0026 No HEALTHCHECK, Severity LOW, no StartLine — the IaC anchor, class-severity high)
const REDOS = join(FIX, 'regexploit-seeded.txt') // genuine regexploit 1.0.0 VERBATIM stdout (format C — text, not JSON) over seeded vulnerable py/js: 4 blocks — (a+)+$ exp @server.py:3 + (.*)*x exp @:4 + a*a*a*$ cubic @:5 (Context lines) + (x+)+y(z+)+w exp @validate.js:1 (JS: no Context, TWO Redos records in ONE block), with a mid-file "Processed N regexes" trailer between the two tools' outputs
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
check('AD1 registry has 12 adapters (regexploit added), both KINDS, each {name,kind,collect,parse,classify}', () => {
  assert.deepEqual(Object.keys(ADAPTERS).sort(), ['bandit', 'checkov', 'code-analyzer', 'detect-secrets', 'gitleaks', 'metadata-viewall', 'njsscan', 'npm-audit', 'osv', 'regexploit', 'semgrep', 'trivy'])
  assert.equal(ADAPTERS['code-analyzer'].kind, 'file-parser')
  assert.equal(ADAPTERS['metadata-viewall'].kind, 'source-scanner')
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

check('CK-anchor: CKV_DOCKER_2 → one deterministic iac-misconfig finding (checkov/high/Dockerfile:1, guideline in reasoning)', () => {
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
  assert.equal(f.adjusted_severity, 'high') // from the iac-misconfig class (scan-iac-misconfig=major→high)
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

check('CK-severity-from-class: a failed check carrying enterprise severity:LOW is STILL high (class, not tool)', () => {
  const synthetic = {
    check_type: 'dockerfile',
    results: {
      passed_checks: [],
      failed_checks: [
        { check_id: 'CKV_DOCKER_2', check_name: 'Healthcheck', file_path: 'Dockerfile', file_line_range: [1, 7], severity: 'LOW', guideline: 'https://example.test/g' },
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
  assert.ok(findings.every((f) => f.class === 'iac-misconfig' && f.adjusted_severity === 'high' && f.engine === 'checkov'))
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
  assert.equal(ck1[0].adjusted_severity, 'high')
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
const URLLIB_RULE = readJSON(SEMGREP_WARN).results[0].check_id // the dynamic-urllib SSRF rule
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

check('SG-anchor-ERROR: helios detect-child-process (severity ERROR) → HIGH, server/index.js:28', () => {
  const { findings } = ingestSemgrep(readJSON(SEMGREP_ERR))
  assert.equal(findings.length, 1)
  const f = findings[0]
  assert.equal(f.engine, 'semgrep')
  assert.equal(f.adjusted_severity, 'high') // ERROR → high (the TOOL band)
  assert.equal(f.dimension, 'external-sast')
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

check('SG-schema: a Semgrep finding (no class, dimension external-sast) validates against $defs/finding', () => {
  const f = ingestSemgrep(readJSON(SEMGREP_ERR)).findings[0]
  assert.deepEqual(validateFinding(f), [])
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

check('BN-anchor: B608 hardcoded_sql_expressions (severity MEDIUM) → deterministic/bandit/external-sast/MEDIUM, mcp/server.py:46, NO class, more_info URL in reasoning', () => {
  const raw = readJSON(BANDIT)
  const moreInfo = raw.results.find((r) => r.test_id === 'B608').more_info
  const { findings } = ingestBandit(raw)
  const f = findById(findings, (x) => x.file.endsWith('mcp/server.py:46'))
  assert.ok(f, 'the B608 :46 anchor is not present')
  assert.equal(f.provenance, 'deterministic')
  assert.equal(f.engine, 'bandit')
  assert.equal(f.ruleId, 'B608')
  assert.equal(f.dimension, 'external-sast')
  assert.equal(f.adjusted_severity, 'medium') // MEDIUM → medium (the TOOL band, not a class)
  assert.equal(f.status, 'confirmed')
  assert.equal(f.class, undefined) // owns NO toolkit class
  assert.ok(!('class' in f), 'a Bandit finding must carry no `class` key')
  assert.match(f.id, /^[0-9a-f]{16}$/)
  assert.ok(moreInfo && f.verdict_reasoning.includes(moreInfo), 'the more_info URL must appear in verdict_reasoning')
})

check('BN-count: the real fixture → exactly 4 findings, all medium (all 4 results are MEDIUM)', () => {
  const { findings } = ingestBandit(readJSON(BANDIT))
  assert.equal(findings.length, 4)
  assert.ok(findings.every((f) => f.adjusted_severity === 'medium'), 'every real-fixture finding is medium')
  assert.ok(findings.every((f) => f.engine === 'bandit' && f.dimension === 'external-sast'))
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
  assert.equal(byRule.B311.adjusted_severity, 'low') // LOW → low
  assert.ok(byRule.B311.verdict_reasoning.includes('https://cwe.mitre.org/data/definitions/330.html'), 'issue_cwe.link is the fallback when no more_info')
  assert.equal(byRule.B999.adjusted_severity, 'info') // unknown CRITICAL → info, never dropped
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

check('BN-schema: a Bandit finding (no class, dimension external-sast) validates against $defs/finding', () => {
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

check('TRV-anchor: DS-0026 → one deterministic iac-misconfig finding (trivy/high/Dockerfile, PrimaryURL in reasoning, Trivy severity noted for reference, class-severity not LOW)', () => {
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
  assert.equal(f.adjusted_severity, 'high') // from the iac-misconfig class (scan-iac-misconfig=major→high), NOT Trivy's LOW
  // the real DS-0026 (a file-level "No HEALTHCHECK") carries NO CauseMetadata.StartLine → the locus is the bare Target
  // (the `:StartLine` path is exercised by TRV-class-dispatch's synthetic, which DOES carry a StartLine)
  assert.equal(f.file, 'Dockerfile')
  assert.ok(!/:\d+$/.test(f.file), 'a misconfig with no StartLine must have NO :line')
  assert.equal(f.status, 'confirmed')
  assert.match(f.id, /^[0-9a-f]{16}$/)
  assert.ok(url && f.verdict_reasoning.includes(url), 'the Trivy PrimaryURL must appear in verdict_reasoning')
  assert.ok(f.verdict_reasoning.includes('[Trivy severity LOW, recorded for reference]'), 'Trivy tool severity is recorded for reference')
  assert.match(f.verdict_reasoning, /severity fixed from the iac-misconfig class/) // class-severity, not the tool
})

check('TRV-severity-from-class (the consistency invariant): mutating the misconfig Severity LOW→CRITICAL leaves the band high (class-severity, matching Checkov; the tool number never moves it)', () => {
  const raw = clone(readJSON(TRIVY))
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
  // NO new CLASS_DEFS entry for trivy — the class map is unchanged (the original 5)
  assert.deepEqual(Object.keys(CLASS_DEFS).sort(), ['crud-fls', 'hardcoded-secrets', 'iac-misconfig', 'sharing', 'viewall-overgrant'])
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
    parsed.findings.some((f) => f.ruleId === 'DS-0026' && f.adjusted_severity === 'high' && f.class === 'iac-misconfig' && f.file === 'Dockerfile')
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
  assert.equal(t1[0].adjusted_severity, 'high')
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
  // the second code-analyzer (SFGE) + the second semgrep (helios) fixtures also route correctly
  assert.equal(recognizeScanner(readJSON(SFGE)), 'code-analyzer')
  assert.equal(recognizeScanner(readJSON(SEMGREP_ERR)), 'semgrep')
  // the format-C TEXT fixture (0.8.56): a STRING shape, provably disjoint from every JSON adapter
  // by construction (all 11 other detects require an object/array) — a single match, never ambiguous.
  assert.equal(recognizeScanner(readText(REDOS)), 'regexploit')
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

check('ALL6 format-C evidence (0.8.56): redos-*.txt is invisible to --all (JSON-only enumeration — no crash, no row); the same text misnamed .json is skipped HONESTLY as unparseable; the explicit --scanner path ingests it', () => {
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

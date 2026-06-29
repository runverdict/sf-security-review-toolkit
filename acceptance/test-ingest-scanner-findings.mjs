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
 *   AD — the pluggable adapter registry: 6 adapters across both kinds (file-parser:
 *        code-analyzer/checkov/semgrep/bandit/njsscan + source-scanner: metadata-viewall).
 *   CLI — the CLI runs every adapter, --json + merge, idempotent on the ledger.
 *   CK/SG/BN/NJ — the Phase-2 per-scanner adapters (checkov IaC · semgrep/bandit/njsscan tool→band).
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
  ADAPTERS,
  classSeverity,
  baselineSeverityFor,
  mergeFindings,
  loadLedger,
  hasSecurityTag,
  REQ_SEVERITY_TO_FINDING,
  CA_SEVERITY_TO_FINDING,
  SEMGREP_SEVERITY_TO_FINDING,
  BANDIT_SEVERITY_TO_FINDING,
  NJSSCAN_SEVERITY_TO_FINDING,
  CLASS_DEFS,
  RULE_CLASS,
} from '../harness/ingest-scanner-findings.mjs'
import { reconcileProvenance } from '../harness/reconcile-provenance.mjs'

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
const SCHEMA_PATH = join(PLUGIN, 'templates', 'audit-ledger.schema.json')

const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'))
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
check('AD1 registry has 7 adapters (gitleaks added), both KINDS, each {name,kind,collect,parse,classify}', () => {
  assert.deepEqual(Object.keys(ADAPTERS).sort(), ['bandit', 'checkov', 'code-analyzer', 'gitleaks', 'metadata-viewall', 'njsscan', 'semgrep'])
  assert.equal(ADAPTERS['code-analyzer'].kind, 'file-parser')
  assert.equal(ADAPTERS['metadata-viewall'].kind, 'source-scanner')
  assert.equal(ADAPTERS['checkov'].kind, 'file-parser')
  assert.equal(ADAPTERS['semgrep'].kind, 'file-parser')
  assert.equal(ADAPTERS['bandit'].kind, 'file-parser')
  assert.equal(ADAPTERS['njsscan'].kind, 'file-parser')
  assert.equal(ADAPTERS['gitleaks'].kind, 'file-parser')
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

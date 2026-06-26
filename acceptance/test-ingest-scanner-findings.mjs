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
 *   AD — the pluggable adapter registry: 2 adapters, both kinds (file-parser + source-scanner).
 *   CLI — the CLI runs both adapters, --json + merge, idempotent on the ledger.
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
  ADAPTERS,
  classSeverity,
  baselineSeverityFor,
  mergeFindings,
  loadLedger,
  hasSecurityTag,
  REQ_SEVERITY_TO_FINDING,
  CA_SEVERITY_TO_FINDING,
  CLASS_DEFS,
  RULE_CLASS,
} from '../harness/ingest-scanner-findings.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'ingest-scanner-findings.mjs')
const FIX = join(PLUGIN, 'acceptance', 'fixtures')
const SOLANO = join(FIX, 'code-analyzer-solano.json')
const SFGE = join(FIX, 'code-analyzer-sfge-meridian.json')
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
check('AD1 registry has 2 adapters, both KINDS, each {name,kind,collect,parse,classify}', () => {
  assert.deepEqual(Object.keys(ADAPTERS).sort(), ['code-analyzer', 'metadata-viewall'])
  assert.equal(ADAPTERS['code-analyzer'].kind, 'file-parser')
  assert.equal(ADAPTERS['metadata-viewall'].kind, 'source-scanner')
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

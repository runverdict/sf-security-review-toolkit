#!/usr/bin/env node
/**
 * Standing test for harness/apply-dispositions.mjs — deterministic-band DISPOSITION
 * application (B3a: the audit's structured false-positive / accepted-risk adjudication of
 * a scanner class flips the matching `provenance:'deterministic'` ledger entries out of
 * the open band, so the headline / blocker floor / SCI count the REAL blockers).
 *
 * Guards:
 *   D1   flip — a disposition refuting an engine+ruleId class flips its deterministic
 *        `confirmed` findings to `refuted` with a `disposition_reason`; provenance/
 *        engine/ruleId/class/severity KEPT; findings of OTHER rules stay confirmed.
 *   D2   THE SAFETY TEST — an `llm-inferred` finding is NEVER flipped by a disposition,
 *        even one carrying the same engine/ruleId fields at the same locus — whether its
 *        provenance is ABSENT (the pre-0.8.93 absence-default) or EXPLICITLY
 *        `provenance:'llm-inferred'` (the merge-ledger self-declaration). This is the
 *        "a disposition cannot hide an LLM-confirmed blocker" guarantee: only what a
 *        scanner mechanically relayed can be class-dispositioned; the LLM's own confirmed
 *        findings are untouchable here.
 *   D3   EXACT match only — an engine mismatch or a ruleId prefix/substring never flips
 *        (no fuzzy over-flip).
 *   D4   scope is MANDATORY (A2, 0.8.103) — a scope-less disposition is rejected whole
 *        (nothing applied); `scope.files` narrows the flip to the named files;
 *        `scope.as_of_pass` covers the class within its pass bound.
 *   D5   accepted_risk sets status + the REQUIRED accepted_risk_justification
 *        (schema-valid); a disposition WITHOUT the justification is rejected as a whole
 *        (reported invalid, finding untouched — never an invalid ledger entry).
 *   D6   PROTECTED states (fixed / accepted_risk / superseded) are never overwritten.
 *   D7   idempotent — a 2nd apply flips 0 and the findings are byte-identical.
 *   D8   never→open / never→fixed — a disposition targeting confirmed/regressed/fixed is
 *        rejected (illegal target; a disposition only moves OUT of the open band).
 *   D9   pure — the input array/objects are not mutated (shallow copies returned).
 *   D10  empty / absent / malformed dispositions input tolerated (0 applied, no crash).
 *   D11  a disposition matching nothing is a reported no-op (never guessed).
 *   SC1-3 schema conformance — flipped refuted + accepted_risk findings validate against
 *        $defs/finding; the schema declares `disposition_reason` additively.
 *   CLI1-5 the CLI flips a target ledger (idempotent re-run), --dry-run does not write,
 *        an absent dispositions file is a clean no-op, a corrupted ledger or a corrupted
 *        dispositions file is refused loudly.
 *   V1-V2 VERDICT HONESTY (the point of the slice, real CLIs on a tmp ledger) — BEFORE
 *        apply, `compute-sci` + `finding-clusters --headline` count the raw deterministic
 *        band (1 noise critical + 3 noise high + 1 real LLM critical) as open blockers;
 *        AFTER applying the disposition that refutes the noise class, they count ONLY the
 *        real remaining blocker — and the recap surfaces the dispositioned count (the
 *        drop is visible, never a silent shrink).
 *   W1-W6 wiring — audit-codebase + run-scans GRANT + INVOKE apply-dispositions AFTER
 *        reconcile-provenance (and before the recap re-render); the dossier note names
 *        the single-source deterministic-dispositions.json; the journey references the
 *        dispositioned band.
 *
 * Dependency-free: `node acceptance/test-apply-dispositions.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { applyDispositions, validateDisposition, DISPOSITION_TARGETS } from '../harness/apply-dispositions.mjs'
import { buildFinding } from '../harness/ingest-scanner-findings.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'apply-dispositions.mjs')
const CLUSTERS = join(PLUGIN, 'harness', 'finding-clusters.mjs')
const SCI = join(PLUGIN, 'harness', 'compute-sci.mjs')
const RECAP = join(PLUGIN, 'harness', 'render-recap.mjs')
const SCHEMA_PATH = join(PLUGIN, 'templates', 'audit-ledger.schema.json')
const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'))
const node = (args) => execFileSync('node', args, { encoding: 'utf8', stdio: 'pipe' })

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

// ---- a focused JSON-Schema validator for $defs/finding (mirrors the sibling tests) ----
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
    if (Array.isArray(p.enum) && !p.enum.includes(v)) errors.push(`'${k}'='${v}' not in enum`)
    if (p.pattern && typeof v === 'string' && !new RegExp(p.pattern).test(v)) errors.push(`'${k}' fails pattern`)
    if (p.minLength != null && typeof v === 'string' && v.length < p.minLength) errors.push(`'${k}' below minLength`)
    if (p.$ref === '#/$defs/severity' && !SEVERITY_ENUM.includes(v)) errors.push(`'${k}'='${v}' not a severity`)
  }
  // the conditional the schema enforces: accepted_risk requires its justification
  if (f.status === 'accepted_risk' && !f.accepted_risk_justification) errors.push('accepted_risk without justification')
  return errors
}

// ---- fixtures: real deterministic findings via buildFinding + llm-inferred literals ----
const NOISE_RULE = 'python.lang.security.audit.raw-sql'
// a deterministic semgrep tool→band finding of the NOISE class (band passed explicitly)
const detNoise = (file, line, band) =>
  buildFinding({
    engine: 'semgrep',
    ruleId: NOISE_RULE,
    severityNum: null,
    file,
    startLine: line,
    message: 'raw SQL string built near a query call',
    resources: [],
    classKey: null,
    repoRoot: '',
    pass: 1,
    bandFromTool: band,
    toolSevLabel: 'ERROR',
    dimensionHint: 'external-sast',
  })
// a deterministic finding of a DIFFERENT rule (must never be flipped by the noise disposition)
const detOtherRule = () =>
  buildFinding({
    engine: 'semgrep',
    ruleId: 'python.flask.security.audit.debug-enabled',
    severityNum: null,
    file: 'app/server.py',
    startLine: 4,
    message: 'flask debug mode enabled',
    resources: [],
    classKey: null,
    repoRoot: '',
    pass: 1,
    bandFromTool: 'high',
    toolSevLabel: 'ERROR',
    dimensionHint: 'external-sast',
  })
// an llm-inferred finding (provenance omitted ⇒ llm-inferred by schema default) — D2 gives
// it the SAME engine/ruleId field values a hostile disposition could name; it must still
// never flip, because only provenance:'deterministic' findings are ever touched.
const llm = (over = {}) => ({
  id: 'ab12cd34ef560789',
  dimension: 'apex-exposed-surface',
  title: 'SOQL injection reachable from the public endpoint (LLM-verified)',
  severity: 'critical',
  adjusted_severity: 'critical',
  file: 'app/routes.py:10-20',
  status: 'confirmed',
  first_seen: 1,
  last_seen: 1,
  verdict: 'confirmed_real',
  verdict_reasoning: 'reasoned over the code: user input reaches the query string unescaped',
  ...over,
})
// A2 (0.8.103): a scope is now MANDATORY. The default here is the rule-wide-but-bounded
// form (`as_of_pass: 1` — every fixture finding above is first_seen: 1), which preserves
// the whole-class flip these checks exercise while staying schema-valid.
const refuteNoise = (over = {}) => ({
  engine: 'semgrep',
  ruleId: NOISE_RULE,
  disposition: 'refuted',
  reason: 'constant GUC bound at request entry; the flagged predicate is not user-influenced',
  scope: { as_of_pass: 1 },
  ...over,
})

console.log('apply-dispositions standing test')

// ───────────────────────────────────────────────────────────────── the flip
check('D1 a refuting disposition flips the matching deterministic class to refuted; provenance kept; other rules untouched', () => {
  const a = detNoise('app/a.py', 10, 'high')
  const b = detNoise('app/b.py', 20, 'high')
  const other = detOtherRule()
  const { findings, applied, appliedIds } = applyDispositions([a, b, other], { dispositions: [refuteNoise()] })
  assert.equal(applied, 2)
  assert.deepEqual(appliedIds, [a.id, b.id].sort())
  for (const id of [a.id, b.id]) {
    const out = findings.find((f) => f.id === id)
    assert.equal(out.status, 'refuted')
    assert.match(out.disposition_reason, /dispositioned by adjudication/)
    assert.match(out.disposition_reason, /not user-influenced/)
    // the disposition is a LAYER on top, never a rewrite — everything else is intact
    assert.equal(out.provenance, 'deterministic')
    assert.equal(out.engine, 'semgrep')
    assert.equal(out.ruleId, NOISE_RULE)
    assert.equal(out.severity, 'high')
    assert.equal(out.adjusted_severity, 'high')
  }
  assert.equal(findings.find((f) => f.id === other.id).status, 'confirmed')
})

check('D2 THE SAFETY TEST — an llm-inferred finding is NEVER flipped (a disposition cannot hide an LLM-confirmed blocker)', () => {
  // the hostile shape: an llm-inferred finding that even CARRIES the disposition's
  // engine/ruleId field values — once with provenance ABSENT (the absence-default) and
  // once EXPLICITLY self-declared `provenance:'llm-inferred'` (the 0.8.93 merge-ledger
  // stamp) — and one that plainly omits everything. None may flip — the provenance
  // guard, not the field match, is what protects the LLM's own blocker.
  const impostor = llm({ engine: 'semgrep', ruleId: NOISE_RULE })
  const labeled = llm({ id: 'ab12cd34ef560787', provenance: 'llm-inferred', engine: 'semgrep', ruleId: NOISE_RULE })
  const plain = llm({ id: 'ab12cd34ef560788' })
  const det = detNoise('app/a.py', 10, 'high')
  const { findings, applied, appliedIds } = applyDispositions([impostor, labeled, plain, det], { dispositions: [refuteNoise()] })
  assert.equal(applied, 1, 'only the deterministic finding flips')
  assert.deepEqual(appliedIds, [det.id])
  assert.equal(findings.find((f) => f.id === impostor.id).status, 'confirmed', 'llm-inferred (absent provenance, with engine/ruleId fields) untouched')
  assert.equal(findings.find((f) => f.id === labeled.id).status, 'confirmed', 'llm-inferred (EXPLICIT label, with engine/ruleId fields) untouched — still confirmed, never flipped')
  assert.equal(findings.find((f) => f.id === plain.id).status, 'confirmed', 'llm-inferred (plain) untouched')
  assert.equal(findings.find((f) => f.id === impostor.id).disposition_reason, undefined)
  assert.equal(findings.find((f) => f.id === labeled.id).disposition_reason, undefined)
})

check('D3 EXACT engine+ruleId match only — engine mismatch and ruleId prefix/substring never flip', () => {
  const det = detNoise('app/a.py', 10, 'high')
  // engine mismatch
  assert.equal(applyDispositions([det], { dispositions: [refuteNoise({ engine: 'bandit' })] }).applied, 0)
  // ruleId PREFIX of the finding's ruleId (a fuzzy matcher would over-flip here)
  assert.equal(applyDispositions([det], { dispositions: [refuteNoise({ ruleId: 'python.lang.security.audit' })] }).applied, 0)
  // finding's ruleId is a SUBSTRING of the disposition's (the other direction)
  assert.equal(applyDispositions([det], { dispositions: [refuteNoise({ ruleId: NOISE_RULE + '.extra' })] }).applied, 0)
  // exact → flips
  assert.equal(applyDispositions([det], { dispositions: [refuteNoise()] }).applied, 1)
})

check('D4 scope is MANDATORY — scope-less rejected whole; scope.files narrows; as_of_pass covers the class within its bound', () => {
  const a = detNoise('app/a.py', 10, 'high')
  const b = detNoise('app/b.py', 20, 'high')
  // A2 (0.8.103): a scope-less disposition is a HARD validation error, rejected as a
  // whole — reported by index, NOTHING applied. An unbounded, unbounded-in-time
  // rule-wide suppression is unexpressible.
  const bare = { ...refuteNoise() }
  delete bare.scope
  const rejected = applyDispositions([a, b], { dispositions: [bare] })
  assert.equal(rejected.applied, 0, 'a scope-less disposition applies NOTHING')
  assert.equal(rejected.invalid.length, 1)
  assert.equal(rejected.invalid[0].index, 0, 'rejected entries are reported by index')
  assert.match(rejected.invalid[0].errors.join(' '), /scope/, 'the error names the missing scope')
  assert.ok(rejected.findings.every((f) => f.status === 'confirmed'), 'no finding was touched')
  // scope.files still narrows the flip to the named loci (semantics unchanged)
  const scoped = applyDispositions([a, b], { dispositions: [refuteNoise({ scope: { files: ['app/a.py'] } })] })
  assert.equal(scoped.applied, 1)
  assert.equal(scoped.findings.find((f) => f.id === a.id).status, 'refuted')
  assert.equal(scoped.findings.find((f) => f.id === b.id).status, 'confirmed', 'out-of-scope file untouched')
  // as_of_pass covers the whole class WITHIN its pass bound (both fixtures are
  // first_seen: 1 <= 1) — the honest replacement for the old unbounded whole-class form.
  const bounded = applyDispositions([a, b], { dispositions: [refuteNoise()] })
  assert.equal(bounded.applied, 2, 'as_of_pass covers the engine+ruleId class within its pass bound')
})

check('D5 accepted_risk sets the REQUIRED justification (schema-valid); without it the entry is rejected whole', () => {
  const det = detNoise('app/a.py', 10, 'high')
  const ok = applyDispositions([det], {
    dispositions: [refuteNoise({
      disposition: 'accepted_risk',
      accepted_risk_justification: 'compensating WAF rule blocks the only reachable path; fix scheduled post-submission',
    })],
  })
  assert.equal(ok.applied, 1)
  const out = ok.findings.find((f) => f.id === det.id)
  assert.equal(out.status, 'accepted_risk')
  assert.match(out.accepted_risk_justification, /compensating WAF rule/)
  assert.deepEqual(validateFinding(out), [], 'the accepted_risk flip validates against $defs/finding')
  // no justification → the WHOLE entry is rejected: 0 applied, reported invalid, finding untouched
  const bad = applyDispositions([det], { dispositions: [refuteNoise({ disposition: 'accepted_risk' })] })
  assert.equal(bad.applied, 0)
  assert.equal(bad.invalid.length, 1)
  assert.match(bad.invalid[0].errors.join(' '), /accepted_risk_justification/)
  assert.equal(bad.findings.find((f) => f.id === det.id).status, 'confirmed')
})

check('D6 PROTECTED states (fixed / accepted_risk / superseded) are never overwritten', () => {
  for (const status of ['fixed', 'accepted_risk', 'superseded']) {
    const det = { ...detNoise('app/a.py', 10, 'high'), status }
    const { findings, applied } = applyDispositions([det], { dispositions: [refuteNoise()] })
    assert.equal(applied, 0, `${status} must not be overwritten`)
    assert.equal(findings.find((f) => f.id === det.id).status, status)
  }
})

check('D7 idempotent — a 2nd apply flips 0 and the findings are byte-identical', () => {
  const input = [detNoise('app/a.py', 10, 'high'), detNoise('app/b.py', 20, 'high'), llm()]
  const disp = { dispositions: [refuteNoise()] }
  const r1 = applyDispositions(input, disp)
  const r2 = applyDispositions(r1.findings, disp)
  assert.equal(r1.applied, 2)
  assert.equal(r2.applied, 0)
  assert.equal(JSON.stringify(r1.findings), JSON.stringify(r2.findings))
})

check('D8 never→open / never→fixed — confirmed/regressed/fixed are illegal targets, rejected whole', () => {
  // a refuted deterministic finding must not be resurrectable INTO the open band, and a
  // disposition can never mint a `fixed` (that requires a real fix reference)
  const det = { ...detNoise('app/a.py', 10, 'high'), status: 'refuted', disposition_reason: 'earlier adjudication' }
  for (const target of ['confirmed', 'regressed', 'fixed']) {
    const { findings, applied, invalid } = applyDispositions([det], { dispositions: [refuteNoise({ disposition: target })] })
    assert.equal(applied, 0, `'${target}' must be an illegal disposition target`)
    assert.equal(invalid.length, 1)
    assert.match(invalid[0].errors.join(' '), /illegal `disposition`/)
    assert.equal(findings.find((f) => f.id === det.id).status, 'refuted')
  }
  assert.deepEqual([...DISPOSITION_TARGETS].sort(), ['accepted_risk', 'refuted'])
})

check('D9 the input array/objects are not mutated (pure — returns shallow copies)', () => {
  const input = [detNoise('app/a.py', 10, 'high'), llm()]
  const before = JSON.stringify(input)
  applyDispositions(input, { dispositions: [refuteNoise()] })
  assert.equal(JSON.stringify(input), before)
})

check('D10 empty / absent / malformed dispositions input tolerated (0 applied, no crash)', () => {
  const det = detNoise('app/a.py', 10, 'high')
  assert.equal(applyDispositions([det], null).applied, 0)
  assert.equal(applyDispositions([det], undefined).applied, 0)
  assert.equal(applyDispositions([det], {}).applied, 0)
  assert.equal(applyDispositions([det], { dispositions: [] }).applied, 0)
  assert.equal(applyDispositions([det], { dispositions: 'not-an-array' }).applied, 0)
  assert.equal(applyDispositions(null, { dispositions: [refuteNoise()] }).applied, 0)
  assert.equal(validateDisposition(null).length, 1)
})

check('D11 a disposition matching nothing is a reported no-op (never guessed)', () => {
  const det = detNoise('app/a.py', 10, 'high')
  const { applied, unmatched } = applyDispositions([det], { dispositions: [refuteNoise({ ruleId: 'no.such.rule' })] })
  assert.equal(applied, 0)
  assert.deepEqual(unmatched, [{ engine: 'semgrep', ruleId: 'no.such.rule' }])
})

// ─────────────────────────────────────────────────────── schema conformance
check('SC1 a dispositioned (refuted) deterministic finding validates against $defs/finding', () => {
  const out = applyDispositions([detNoise('app/a.py', 10, 'high')], { dispositions: [refuteNoise()] })
    .findings.find((f) => f.status === 'refuted')
  assert.ok(out)
  assert.deepEqual(validateFinding(out), [])
})

check('SC2 the schema declares disposition_reason additively (present, never newly required)', () => {
  const props = FINDING_DEF.properties
  assert.ok(props.disposition_reason, 'disposition_reason declared in $defs/finding')
  assert.equal(props.disposition_reason.type, 'string')
  assert.match(props.disposition_reason.description, /deterministic-dispositions\.json/)
  assert.ok(!FINDING_DEF.required.includes('disposition_reason'), 'additive — not required')
})

// ─────────────────────────────────────────────────────────────────────── CLI
const DISP_FILE = { dispositions: [refuteNoise()] }
function setupTarget({ withDispositions = true, findings } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'apply-disp-'))
  dirs.push(d)
  mkdirSync(join(d, '.security-review'), { recursive: true })
  const ledger = {
    schema_version: '1',
    findings: findings || [detNoise('app/a.py', 10, 'high'), detNoise('app/b.py', 20, 'high'), llm()],
    passes: [{ id: 1, tier: 'standard', dimensions: ['external-sast'], candidates: 3, confirmed: 3, refuted: 0, unverified: 0 }],
  }
  writeFileSync(join(d, '.security-review', 'audit-ledger.json'), JSON.stringify(ledger, null, 2))
  if (withDispositions) {
    writeFileSync(join(d, '.security-review', 'deterministic-dispositions.json'), JSON.stringify(DISP_FILE, null, 2))
  }
  return d
}
const ledgerPath = (d) => join(d, '.security-review', 'audit-ledger.json')

check('CLI1 flips a target ledger, marks disposition_reason, idempotent on re-run', () => {
  const d = setupTarget()
  node([CLI, '--target', d])
  const l1 = readJSON(ledgerPath(d))
  const flipped = l1.findings.filter((f) => f.status === 'refuted')
  assert.equal(flipped.length, 2)
  assert.ok(flipped.every((f) => /dispositioned by adjudication/.test(f.disposition_reason)))
  assert.equal(l1.findings.find((f) => f.id === 'ab12cd34ef560789').status, 'confirmed', 'the llm finding is untouched')
  node([CLI, '--target', d])
  const l2 = readJSON(ledgerPath(d))
  assert.equal(JSON.stringify(l1), JSON.stringify(l2), 'idempotent re-run leaves the ledger byte-identical')
})

check('CLI2 --dry-run --json reports the flip WITHOUT writing the ledger', () => {
  const d = setupTarget()
  const before = readFileSync(ledgerPath(d), 'utf8')
  const out = JSON.parse(node([CLI, '--target', d, '--dry-run', '--json']))
  assert.equal(out.applied, 2)
  assert.equal(out.dryRun, true)
  assert.equal(readFileSync(ledgerPath(d), 'utf8'), before, 'unchanged on disk')
})

check('CLI3 an ABSENT dispositions file is a clean no-op (exit 0, 0 applied, statuses unchanged)', () => {
  const d = setupTarget({ withDispositions: false })
  const out = JSON.parse(node([CLI, '--target', d, '--json']))
  assert.equal(out.applied, 0)
  assert.equal(out.dispositionsFile, 'absent')
  const l = readJSON(ledgerPath(d))
  assert.ok(l.findings.every((f) => f.status === 'confirmed'))
})

check('CLI4 refuses a corrupted (non-array findings) ledger rather than overwrite', () => {
  const d = mkdtempSync(join(tmpdir(), 'apply-disp-bad-'))
  dirs.push(d)
  mkdirSync(join(d, '.security-review'), { recursive: true })
  writeFileSync(ledgerPath(d), JSON.stringify({ schema_version: '1', findings: { not: 'an array' }, passes: [] }))
  let threw = false
  try {
    node([CLI, '--target', d])
  } catch {
    threw = true // exit 2
  }
  assert.ok(threw, 'CLI should exit non-zero on a corrupted ledger')
})

check('CLI5 refuses a corrupted dispositions file LOUDLY (a typo must not silently skip the honesty flip)', () => {
  const d = setupTarget({ withDispositions: false })
  writeFileSync(join(d, '.security-review', 'deterministic-dispositions.json'), '{ not json')
  const before = readFileSync(ledgerPath(d), 'utf8')
  let threw = false
  try {
    node([CLI, '--target', d])
  } catch {
    threw = true // exit 2
  }
  assert.ok(threw, 'CLI should exit non-zero on an unparseable dispositions file')
  assert.equal(readFileSync(ledgerPath(d), 'utf8'), before, 'the ledger is untouched')
  // present-but-wrong-shape is refused the same way
  writeFileSync(join(d, '.security-review', 'deterministic-dispositions.json'), JSON.stringify({ dispositions: 'nope' }))
  let threw2 = false
  try {
    node([CLI, '--target', d])
  } catch {
    threw2 = true
  }
  assert.ok(threw2, 'CLI should exit non-zero on a wrong-shape dispositions file')
})

// ─────────────────────────────── VERDICT HONESTY (the point of the slice; real CLIs)
// the raw deterministic band: 1 noise critical + 3 noise high (all confirmed) + 1 REAL
// llm-inferred critical. Before apply, the verdict counts 2 critical + 3 high open; after
// the adjudication refutes the noise class, only the real blocker remains — and the
// disposition provably CANNOT hide the LLM-confirmed one.
function setupVerdictTarget() {
  return setupTarget({
    findings: [
      detNoise('app/a.py', 10, 'critical'),
      detNoise('app/b.py', 20, 'high'),
      detNoise('app/c.py', 30, 'high'),
      detNoise('app/d.py', 40, 'high'),
      llm(), // the real critical blocker (llm-inferred)
    ],
  })
}

check('V1 the blocker floor + headline count the inflated band BEFORE apply, and ONLY the real blocker AFTER', () => {
  const d = setupVerdictTarget()
  // BEFORE — the raw deterministic band inflates the verdict
  const cBefore = JSON.parse(node([CLUSTERS, '--target', d, '--json']))
  assert.equal(cBefore.confirmed_count, 5)
  assert.equal(cBefore.by_severity.critical, 2)
  assert.equal(cBefore.by_severity.high, 3)
  const sciBefore = JSON.parse(node([SCI, '--target', d, '--plugin', PLUGIN, '--date', '2026-07-02', '--json']))
  assert.equal(sciBefore.blocked, true)
  assert.equal(sciBefore.disposition.open_critical, 2)
  assert.equal(sciBefore.disposition.open_high, 3)
  assert.equal(sciBefore.blocker_findings.length, 2, 'the noise critical counts as a blocker before adjudication')
  // APPLY the structured adjudication of the noise class
  node([CLI, '--target', d])
  // AFTER — only the REAL blocker remains; the llm-inferred critical is untouched
  const cAfter = JSON.parse(node([CLUSTERS, '--target', d, '--json']))
  assert.equal(cAfter.confirmed_count, 1)
  assert.equal(cAfter.by_severity.critical, 1)
  assert.equal(cAfter.by_severity.high ?? 0, 0)
  const headline = node([CLUSTERS, '--target', d, '--headline'])
  assert.match(headline, /\*\*Raw confirmed findings: 1\*\* \(critical 1 · high 0/)
  const sciAfter = JSON.parse(node([SCI, '--target', d, '--plugin', PLUGIN, '--date', '2026-07-02', '--json']))
  assert.equal(sciAfter.blocked, true, 'the REAL llm-confirmed blocker still blocks — the disposition cannot hide it')
  assert.equal(sciAfter.disposition.open_critical, 1)
  assert.equal(sciAfter.disposition.open_high, 0)
  assert.deepEqual(sciAfter.blocker_findings, ['ab12cd34ef560789'], 'only the llm-inferred critical remains a blocker')
  assert.equal(sciAfter.disposition.dispositioned, 4, 'the 4 noise findings are dispositioned, not deleted')
})

check('V2 the recap SURFACES the dispositioned count (the drop is visible, never a silent shrink)', () => {
  const d = setupVerdictTarget()
  const before = node([RECAP, '--target', d])
  assert.match(before, /\*\*Deterministic band:\*\* 4 scanner finding\(s\) — 4 open · 0 dispositioned by adjudication/)
  node([CLI, '--target', d])
  const after = node([RECAP, '--target', d])
  assert.match(after, /\*\*Deterministic band:\*\* 4 scanner finding\(s\) — 0 open · 4 dispositioned by adjudication/)
  // A2 (0.8.103): the recap also attributes the rule-wide (as_of_pass) suppressions and
  // the pending-re-adjudication total — the fixture disposition is rule-wide, so all 4
  // flips are credited to it, and nothing is pending (every fixture is first_seen: 1).
  assert.match(after, /dispositioned by adjudication \(4 rule-wide\) · 0 pending re-adjudication/)
  assert.match(after, /deterministic-dispositions\.json/, 'the recap names the single-source adjudication file')
  assert.match(after, /never silent/)
})

// ─────────────────────────────────────────────────────────────────── wiring
const AUDIT_SKILL = readFileSync(join(PLUGIN, 'skills', 'audit-codebase', 'SKILL.md'), 'utf8')
const RUNSCANS_SKILL = readFileSync(join(PLUGIN, 'skills', 'run-scans', 'SKILL.md'), 'utf8')
const JOURNEY_SKILL = readFileSync(join(PLUGIN, 'skills', 'security-review-journey', 'SKILL.md'), 'utf8')
const auditFm = AUDIT_SKILL.split('---')[1] || ''
const auditAllowed = auditFm.split('\n').find((l) => l.startsWith('allowed-tools:')) || ''
const runScansFm = RUNSCANS_SKILL.split('---')[1] || ''
const runScansAllowed = runScansFm.split('\n').find((l) => l.startsWith('allowed-tools:')) || ''
const auditBody = AUDIT_SKILL.slice(AUDIT_SKILL.indexOf('# Audit Codebase'))

check('W1 audit-codebase GRANTS apply-dispositions.mjs + the dispositions-file Write in allowed-tools', () => {
  assert.ok(auditAllowed.includes('Bash(node *harness/apply-dispositions.mjs *)'), 'apply-dispositions grant present')
  assert.ok(auditAllowed.includes('Write(**/.security-review/deterministic-dispositions.json)'), 'dispositions-file Write grant present')
})

check('W2 audit-codebase INVOKES apply-dispositions AFTER reconcile-provenance and BEFORE the recap re-render', () => {
  const reconcileAt = auditBody.indexOf('reconcile-provenance.mjs --target')
  const applyAt = auditBody.indexOf('apply-dispositions.mjs --target')
  const rerenderAt = auditBody.indexOf('render-recap.mjs --target')
  assert.ok(reconcileAt > -1 && applyAt > -1 && rerenderAt > -1, 'all three markers present')
  assert.ok(reconcileAt < applyAt, 'apply-dispositions runs AFTER reconcile-provenance')
  assert.ok(applyAt < rerenderAt, 'apply-dispositions runs BEFORE the Step-7 recap re-render')
})

check('W3 audit-codebase documents the structured deterministic-dispositions.json the audit writes', () => {
  assert.ok(auditBody.includes('deterministic-dispositions.json'), 'the dispositions file is named')
  assert.ok(/NEVER flips? an? `?llm-inferred`?/i.test(auditBody), 'the llm-never-flipped guarantee is stated')
  assert.ok(/KEEPING provenance\/engine\/ruleId\/class\//.test(auditBody), 'provenance-kept is stated')
})

check('W4 run-scans GRANTS + INVOKES apply-dispositions AFTER reconcile at the scan tail', () => {
  assert.ok(runScansAllowed.includes('Bash(node *harness/apply-dispositions.mjs *)'), 'grant present in run-scans')
  const reconcileAt = RUNSCANS_SKILL.indexOf('reconcile-provenance.mjs --target')
  const applyAt = RUNSCANS_SKILL.indexOf('apply-dispositions.mjs --target')
  assert.ok(reconcileAt > -1 && applyAt > -1, 'both invocations present')
  assert.ok(reconcileAt < applyAt, 'apply-dispositions follows reconcile in the scan tail')
})

check('W5 run-scans states the dossier/ledger single source — a deterministic FP row MUST have a disposition entry', () => {
  assert.ok(RUNSCANS_SKILL.includes('deterministic-dispositions.json'), 'the dispositions file is named in run-scans')
  assert.ok(/MUST correspond to a disposition entry/.test(RUNSCANS_SKILL), 'the single-source rule is stated')
})

check('W6 the journey notes the headline/recap reflect the DISPOSITIONED band', () => {
  assert.ok(JOURNEY_SKILL.includes('apply-dispositions.mjs'), 'the journey references the harness')
  assert.ok(JOURNEY_SKILL.includes('deterministic-dispositions.json'), 'the journey names the adjudication file')
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

#!/usr/bin/env node
/**
 * Standing test for the FAIL-CLOSED CLI contract of harness/apply-dispositions.mjs
 * (0.8.106). The reproduced defect: the CLI rejected an invalid disposition entry
 * (e.g. the mandatory `scope` missing), applied nothing from it — and exited 0. The
 * safety property held (nothing was suppressed), but an automated driver that checks
 * the exit code saw success and walked past a silently-skipped adjudication: the FP
 * dossier said "refuted" while the ledger said "confirmed", and the run proceeded on
 * a partially-adjudicated ledger. The fix is ALL-OR-NOTHING AT THE FILE LEVEL, in the
 * CLI: ANY invalid entry → every offender named, NOTHING written, exit 2. The pure
 * applyDispositions() function keeps its skip-invalid-apply-valid semantics — the
 * gate lives only in the CLI, so these checks drive the REAL CLI (a pure-function
 * test would be vacuous against a CLI defect).
 *
 * Guards:
 *   BR1  one invalid (scope-less) entry → exit 2, EVERY offender named (proven with a
 *        second, differently-invalid entry: both indexes reported), the consequence
 *        summary printed, and the ledger file byte-identical to before the run.
 *   BR2  regression — an all-valid dispositions file → exit 0 and the flips land
 *        exactly as the pure engine computes them (byte-compared against the expected
 *        post-apply findings; the llm-inferred finding untouched).
 *   BR3  --dry-run + an invalid entry → exit 2, nothing written.
 *   BR4  THE ALL-OR-NOTHING LOCK — one valid + one invalid entry → exit 2 AND the
 *        valid entry's finding is STILL `confirmed` (never flipped), asserted on the
 *        ledger BYTES: the valid subset must not be applied while the exit code
 *        reports rejection.
 *   BR5  the pre-existing exit-2 refusals keep their behaviour — corrupted (non-array
 *        findings) ledger; unparseable dispositions file; wrong-shape dispositions
 *        file (ledger untouched in each case).
 *   BR6  wiring — audit-codebase (Step 6) and run-scans (Step 9b tail) both state the
 *        HARD STOP and the remedy: add `scope.files` / `scope.as_of_pass` to the named
 *        entries and re-run ONCE; never hand-edit `audit-ledger.json`.
 *
 * Dependency-free: `node acceptance/test-dispositions-fail-closed.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { applyDispositions } from '../harness/apply-dispositions.mjs'
import { buildFinding } from '../harness/ingest-scanner-findings.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'apply-dispositions.mjs')
const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'))
// the REAL CLI, exit code captured — the defect was in the CLI's exit code, so every
// behavioural check here goes through a spawned process, never the imported function
const runCLI = (args) => {
  try {
    const stdout = execFileSync('node', args, { encoding: 'utf8', stdio: 'pipe' })
    return { status: 0, stdout, stderr: '' }
  } catch (e) {
    return { status: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

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

// ---- fixtures (mirrors test-apply-dispositions.mjs) ----
const NOISE_RULE = 'python.lang.security.audit.raw-sql'
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
const refuteNoise = (over = {}) => ({
  engine: 'semgrep',
  ruleId: NOISE_RULE,
  disposition: 'refuted',
  reason: 'constant GUC bound at request entry; the flagged predicate is not user-influenced',
  scope: { as_of_pass: 1 },
  ...over,
})
// the reproduced offender: the now-mandatory scope missing entirely
const scopeless = (over = {}) => {
  const d = refuteNoise(over)
  delete d.scope
  return d
}

function setupTarget({ findings, dispositions } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'disp-fail-closed-'))
  dirs.push(d)
  mkdirSync(join(d, '.security-review'), { recursive: true })
  const ledger = {
    schema_version: '1',
    findings: findings || [detNoise('app/a.py', 10, 'high'), detNoise('app/b.py', 20, 'high'), llm()],
    passes: [{ id: 1, tier: 'standard', dimensions: ['external-sast'], candidates: 3, confirmed: 3, refuted: 0, unverified: 0 }],
  }
  writeFileSync(join(d, '.security-review', 'audit-ledger.json'), JSON.stringify(ledger, null, 2))
  if (dispositions) {
    writeFileSync(
      join(d, '.security-review', 'deterministic-dispositions.json'),
      JSON.stringify({ dispositions }, null, 2)
    )
  }
  return d
}
const ledgerPath = (d) => join(d, '.security-review', 'audit-ledger.json')
const dispPath = (d) => join(d, '.security-review', 'deterministic-dispositions.json')

console.log('dispositions fail-closed standing test (0.8.106)')

// ──────────────────────────────────────────────── BR1 invalid entry → exit 2
check('BR1 one invalid (scope-less) entry → exit 2, every offender named, consequence stated, ledger byte-identical', () => {
  const d = setupTarget({ dispositions: [scopeless()] })
  const before = readFileSync(ledgerPath(d), 'utf8')
  const r = runCLI([CLI, '--target', d])
  assert.equal(r.status, 2, `an invalid entry must exit 2, got ${r.status}`)
  const out = r.stdout + r.stderr
  assert.match(out, /REJECTED entry #0/, 'the offender is named by index')
  assert.match(out, /scope/, 'the offender reason names the missing scope')
  assert.match(out, /NOTHING was applied and the ledger is unchanged/, 'the consequence summary is explicit')
  assert.match(out, /re-run/, 'the summary tells the operator to fix the file and re-run')
  assert.equal(readFileSync(ledgerPath(d), 'utf8'), before, 'the ledger file is byte-identical')
  // EVERY offender: two differently-invalid entries → BOTH indexes reported, still exit 2
  const d2 = setupTarget({
    dispositions: [scopeless(), refuteNoise({ disposition: 'accepted_risk' })], // #1: no justification
  })
  const before2 = readFileSync(ledgerPath(d2), 'utf8')
  const r2 = runCLI([CLI, '--target', d2])
  assert.equal(r2.status, 2)
  const out2 = r2.stdout + r2.stderr
  assert.match(out2, /REJECTED entry #0/, 'first offender named')
  assert.match(out2, /REJECTED entry #1/, 'second offender named')
  assert.match(out2, /accepted_risk_justification/, 'each offender carries its own reason')
  assert.equal(readFileSync(ledgerPath(d2), 'utf8'), before2, 'the ledger file is byte-identical')
})

// ─────────────────────────────────────────────── BR2 all-valid regression
check('BR2 an all-valid dispositions file → exit 0 and the flips land exactly as the pure engine computes them', () => {
  const findings = [detNoise('app/a.py', 10, 'high'), detNoise('app/b.py', 20, 'high'), llm()]
  const d = setupTarget({
    findings: JSON.parse(JSON.stringify(findings)),
    dispositions: [refuteNoise()],
  })
  const r = runCLI([CLI, '--target', d])
  assert.equal(r.status, 0, `an all-valid file must exit 0, got ${r.status}: ${r.stderr}`)
  assert.match(r.stdout, /2 deterministic finding\(s\) dispositioned out of the open band/)
  const after = readJSON(ledgerPath(d))
  // the expected post-apply state, computed by the (unchanged) pure engine
  const expected = applyDispositions(JSON.parse(JSON.stringify(findings)), { dispositions: [refuteNoise()] }).findings
  assert.equal(
    JSON.stringify(after.findings),
    JSON.stringify(expected),
    'the written findings match the pure engine byte-for-byte — the gate changed nothing on the valid path'
  )
  assert.equal(after.findings.filter((f) => f.status === 'refuted').length, 2, 'both deterministic findings flipped')
  assert.equal(after.findings.find((f) => f.id === 'ab12cd34ef560789').status, 'confirmed', 'the llm-inferred finding untouched')
})

// ─────────────────────────────────────────────── BR3 --dry-run + invalid
check('BR3 --dry-run with an invalid entry → exit 2, nothing written (the exit code is the signal)', () => {
  const d = setupTarget({ dispositions: [scopeless()] })
  const before = readFileSync(ledgerPath(d), 'utf8')
  const r = runCLI([CLI, '--target', d, '--dry-run'])
  assert.equal(r.status, 2, `--dry-run with an invalid entry must exit 2, got ${r.status}`)
  assert.match(r.stdout + r.stderr, /REJECTED entry #0/)
  assert.equal(readFileSync(ledgerPath(d), 'utf8'), before, 'nothing written')
})

// ─────────────────────────────────────────── BR4 the all-or-nothing lock
check('BR4 THE ALL-OR-NOTHING LOCK — one valid + one invalid entry → exit 2 AND the valid entry is NOT applied (ledger bytes unchanged)', () => {
  const a = detNoise('app/a.py', 10, 'high')
  const d = setupTarget({
    findings: [JSON.parse(JSON.stringify(a)), llm()],
    dispositions: [
      refuteNoise({ scope: { files: ['app/a.py'] } }), // VALID — matches finding `a`
      scopeless({ ruleId: 'some.other.rule' }), // INVALID — rejects the whole file
    ],
  })
  const before = readFileSync(ledgerPath(d), 'utf8')
  const r = runCLI([CLI, '--target', d])
  assert.equal(r.status, 2, `a mixed file must exit 2, got ${r.status}`)
  assert.match(r.stdout + r.stderr, /REJECTED entry #1/, 'the invalid entry is named')
  // the lock: the ledger BYTES are untouched — the valid subset was NOT applied
  assert.equal(
    readFileSync(ledgerPath(d), 'utf8'),
    before,
    'the ledger must be byte-identical — applying the valid subset while exiting 2 is the mut2 lie'
  )
  const after = readJSON(ledgerPath(d))
  const fa = after.findings.find((f) => f.id === a.id)
  assert.equal(fa.status, 'confirmed', "the valid entry's finding is STILL confirmed — not flipped")
  assert.equal(fa.disposition_reason, undefined, 'no disposition_reason was recorded')
})

// ─────────────────────────────────── BR5 pre-existing exit-2 paths still hold
check('BR5 the pre-existing exit-2 refusals hold — corrupted ledger; unparseable and wrong-shape dispositions files', () => {
  // corrupted (non-array findings) ledger
  const d1 = mkdtempSync(join(tmpdir(), 'disp-fail-closed-bad-'))
  dirs.push(d1)
  mkdirSync(join(d1, '.security-review'), { recursive: true })
  writeFileSync(ledgerPath(d1), JSON.stringify({ schema_version: '1', findings: { not: 'an array' }, passes: [] }))
  const r1 = runCLI([CLI, '--target', d1])
  assert.equal(r1.status, 2, 'a corrupted ledger still exits 2')
  // unparseable dispositions file — ledger untouched
  const d2 = setupTarget()
  writeFileSync(dispPath(d2), '{ not json')
  const before2 = readFileSync(ledgerPath(d2), 'utf8')
  const r2 = runCLI([CLI, '--target', d2])
  assert.equal(r2.status, 2, 'an unparseable dispositions file still exits 2')
  assert.match(r2.stderr, /cannot parse/, 'the refusal names the parse failure')
  assert.equal(readFileSync(ledgerPath(d2), 'utf8'), before2, 'the ledger is untouched')
  // wrong-shape dispositions file
  writeFileSync(dispPath(d2), JSON.stringify({ dispositions: 'nope' }))
  const r3 = runCLI([CLI, '--target', d2])
  assert.equal(r3.status, 2, 'a wrong-shape dispositions file still exits 2')
  assert.equal(readFileSync(ledgerPath(d2), 'utf8'), before2, 'the ledger is untouched')
})

// ──────────────────────────────────────────────────────────── BR6 wiring
check('BR6 audit-codebase + run-scans state the HARD STOP and the remedy', () => {
  const audit = readFileSync(join(PLUGIN, 'skills', 'audit-codebase', 'SKILL.md'), 'utf8')
  const scans = readFileSync(join(PLUGIN, 'skills', 'run-scans', 'SKILL.md'), 'utf8')
  for (const [name, text] of [['audit-codebase', audit], ['run-scans', scans]]) {
    // collapse the markdown line-wrapping so a future re-wrap cannot break the check
    const flat = text.replace(/\s+/g, ' ')
    assert.match(flat, /non-zero exit.{0,120}?HARD STOP/, `${name}: a non-zero exit is a HARD STOP`)
    assert.ok(
      flat.includes('`scope.files` or `scope.as_of_pass` to the NAMED entries and re-run ONCE'),
      `${name}: the remedy — add scope.files/scope.as_of_pass to the named entries, re-run ONCE`
    )
    assert.ok(flat.includes('NEVER hand-edit `audit-ledger.json`'), `${name}: never hand-edit the ledger`)
    assert.ok(flat.includes('NEVER proceed past the failure'), `${name}: never proceed past it`)
    assert.ok(flat.includes('NEVER loop re-running an unchanged file'), `${name}: never loop an unchanged file`)
  }
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

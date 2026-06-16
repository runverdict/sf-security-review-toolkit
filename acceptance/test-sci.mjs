#!/usr/bin/env node
/**
 * Standing test for the Submission Completeness Index (harness/compute-sci.mjs).
 *
 * Guards the two properties the SCI's credibility rests on, which were only
 * ever OBSERVED once during validation:
 *   A1 — FAIL CLOSED: an empty/missing manifest must NOT produce a
 *        "NO-SURPRISES READY" verdict (a readiness tool that defaults to ready
 *        on missing input is dangerous). The 0.4.1 fix; a refactor of the
 *        `!applicable.length` branch could silently re-open it.
 *   A2 — DETERMINISM: same inputs + same --date ⇒ byte-identical stdout. A
 *        future Date.now()/unordered Object.keys() would break the "re-run
 *        yields the same verdict" promise the verdict text itself prints.
 *
 * Dependency-free: `node acceptance/test-sci.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const SCI = join(PLUGIN, 'harness', 'compute-sci.mjs')

function runSci(target) {
  const out = execFileSync('node', [SCI, '--target', target, '--plugin', PLUGIN, '--date', '2026-06-16', '--json'], { encoding: 'utf8' })
  return { raw: out, json: JSON.parse(out) }
}
function fixture(setup) {
  const dir = mkdtempSync(join(tmpdir(), 'sci-test-'))
  mkdirSync(join(dir, '.security-review'), { recursive: true })
  setup(dir)
  return dir
}
const write = (dir, name, obj) => writeFileSync(join(dir, '.security-review', name), JSON.stringify(obj))

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

console.log('compute-sci standing test')

// A1a — completely empty target (no .security-review files at all)
check('A1 fail-closed: empty target → NOT NO-SURPRISES READY, completeness 0', () => {
  const d = fixture(() => {}); dirs.push(d)
  const { json } = runSci(d)
  assert.notEqual(json.band, 'NO-SURPRISES READY', 'must not default to ready on missing input')
  assert.equal(json.completeness_pct, 0)
  assert.equal(json.band, 'NOT READY')
})

// A1b — manifest present but applicableBaselineIds empty
check('A1 fail-closed: empty applicable set → NOT NO-SURPRISES READY, completeness 0', () => {
  const d = fixture((dir) => {
    write(dir, 'scope-manifest.json', { applicableBaselineIds: [], elements: [] })
    write(dir, 'audit-ledger.json', { findings: [] })
  }); dirs.push(d)
  const { json } = runSci(d)
  assert.notEqual(json.band, 'NO-SURPRISES READY')
  assert.equal(json.completeness_pct, 0)
})

// A2 — determinism: a non-trivial state, run twice, byte-identical stdout
check('A2 determinism: identical inputs + fixed date → byte-identical stdout', () => {
  const d = fixture((dir) => {
    write(dir, 'scope-manifest.json', {
      applicableBaselineIds: ['scan-code-analyzer-invocation', 'artifact-authn-authz-flow-doc', 'process-review-fee'],
      elements: [{ type: 'managed-package' }],
    })
    write(dir, 'audit-ledger.json', {
      findings: [
        { id: 'a1', dimension: 'apex-exposed-surface', status: 'confirmed', adjusted_severity: 'high', title: 'x', file: 'a.cls:1' },
        { id: 'b2', dimension: 'crypto-internals', status: 'confirmed', adjusted_severity: 'critical', title: 'y', file: 'b.js:2' },
      ],
    })
    mkdirSync(join(dir, '.security-review', 'evidence'), { recursive: true })
    writeFileSync(join(dir, '.security-review', 'evidence', 'index.json'),
      JSON.stringify({ entries: [{ ref_type: 'requirement', ref_id: 'scan-code-analyzer-invocation', disposition: 'satisfied', verified: { value: true, how: 'ran it' } }] }))
  }); dirs.push(d)
  const a = runSci(d).raw
  const b = runSci(d).raw
  assert.equal(a, b, 'two runs with the same input + --date diverged')
  // and the run echoes the pinned date (date-pinning contract)
  assert.equal(JSON.parse(a).run_date, '2026-06-16')
})

// A4 — baseline-currency band floor. A clean, fully-satisfied state of
// verified_primary (2026-06-12) requirements: fresh → NO-SURPRISES READY; run
// 18 months later (baseline rotted) → the floor caps the band to NOT READY, and
// crucially completeness % is UNCHANGED (currency caps confidence, not the score).
// Use a SYNTHETIC baseline (a temp --plugin dir) so the floor tests control
// verification/last_verified themselves and are NOT coupled to the live
// baseline's mutable dates — a maintainer re-verifying the shipped baseline
// must not silently break these. compute-sci reads <plugin>/baseline/requirements-baseline.yaml
// for per-req verification/last_verified/severity_if_missing.
function synthPlugin(reqs) {
  const dir = mkdtempSync(join(tmpdir(), 'sci-plugin-'))
  mkdirSync(join(dir, 'baseline'), { recursive: true })
  const yaml = reqs
    .map((r) =>
      `- id: ${r.id}\n  applies_to: [managed-package]\n  severity_if_missing: ${r.sev || 'major'}\n` +
      `  verification: ${r.verification || 'verified_primary'}\n  last_verified: ${r.last_verified ? `"${r.last_verified}"` : 'null'}\n`
    )
    .join('')
  writeFileSync(join(dir, 'baseline', 'requirements-baseline.yaml'), yaml)
  return dir
}
function runSciDate(target, date, plugin) {
  const out = execFileSync('node', [SCI, '--target', target, '--plugin', plugin, '--date', date, '--json'], { encoding: 'utf8' })
  return JSON.parse(out)
}
// 3 verified_primary, non-blocker reqs, all last_verified a controlled date.
const A4_REQS = ['req-a', 'req-b', 'req-c']
const synthDir = synthPlugin(A4_REQS.map((id) => ({ id, verification: 'verified_primary', last_verified: '2026-06-12' })))
dirs.push(synthDir)
const a4dir = fixture((dir) => {
  write(dir, 'scope-manifest.json', { applicableBaselineIds: A4_REQS, elements: [{ type: 'managed-package' }] })
  write(dir, 'audit-ledger.json', { findings: [] })
  mkdirSync(join(dir, '.security-review', 'evidence'), { recursive: true })
  writeFileSync(join(dir, '.security-review', 'evidence', 'index.json'),
    JSON.stringify({ entries: A4_REQS.map((id) => ({ ref_type: 'requirement', ref_id: id, disposition: 'satisfied', verified: { value: true, how: 'test' } })) }))
})
dirs.push(a4dir)

check('A4 fresh baseline → NO-SURPRISES READY at 100% completeness', () => {
  const j = runSciDate(a4dir, '2026-06-16', synthDir)
  assert.equal(j.completeness_pct, 100)
  assert.equal(j.band, 'NO-SURPRISES READY')
  assert.equal(j.freshness.hard_stale, 0)
})

check('A4 currency floor: aged baseline → band capped to NOT READY, completeness UNCHANGED', () => {
  const j = runSciDate(a4dir, '2027-12-01', synthDir)
  assert.equal(j.band, 'NOT READY', 'rotted baseline must cap confidence')
  assert.equal(j.completeness_pct, 100, 'completeness must NOT be docked for maintainer currency — false-incompleteness guard')
  assert.ok(j.freshness.hard_stale_pct >= 33)
  assert.match(j.gate_reason, /currency/i)
})

// C1 — the floor must NOT fire (and must NOT clobber the "finish materials"
// reason) when MATERIALS COMPLETE was reached because items are still MISSING.
const c1dir = fixture((dir) => {
  write(dir, 'scope-manifest.json', { applicableBaselineIds: A4_REQS, elements: [{ type: 'managed-package' }] })
  write(dir, 'audit-ledger.json', { findings: [] })
  mkdirSync(join(dir, '.security-review', 'evidence'), { recursive: true })
  // satisfy only ONE of the three → two MISSING → MATERIALS COMPLETE (not ready)
  writeFileSync(join(dir, '.security-review', 'evidence', 'index.json'),
    JSON.stringify({ entries: [{ ref_type: 'requirement', ref_id: A4_REQS[0], disposition: 'satisfied', verified: { value: true, how: 'test' } }] }))
})
dirs.push(c1dir)
check('C1: aged baseline + MISSING items → MATERIALS COMPLETE preserved, floor does NOT clobber', () => {
  const j = runSciDate(c1dir, '2027-12-01', synthDir)
  assert.equal(j.band, 'MATERIALS COMPLETE', 'must not be flipped to NOT READY by the currency floor while materials are incomplete')
  assert.ok(j.completeness_pct < 100)
  assert.doesNotMatch(j.gate_reason, /baseline currency/i, 'the finish-materials reason must survive')
  assert.match(j.gate_reason, /MISSING|finish/i)
})

// C2 — small-manifest guard: a single hard-stale req must NOT trip the floor
// (hardStale.length >= 2 required), even though 1/1 = 100% >= 33%.
const c2dir = fixture((dir) => {
  write(dir, 'scope-manifest.json', { applicableBaselineIds: [A4_REQS[1]], elements: [{ type: 'managed-package' }] })
  write(dir, 'audit-ledger.json', { findings: [] })
  mkdirSync(join(dir, '.security-review', 'evidence'), { recursive: true })
  writeFileSync(join(dir, '.security-review', 'evidence', 'index.json'),
    JSON.stringify({ entries: [{ ref_type: 'requirement', ref_id: A4_REQS[1], disposition: 'satisfied', verified: { value: true, how: 'test' } }] }))
})
dirs.push(c2dir)
check('C2: single hard-stale req → hard floor does NOT fire (needs ≥2)', () => {
  const j = runSciDate(c2dir, '2027-12-01', synthDir)
  assert.equal(j.freshness.hard_stale, 1)
  // The soft caveated cap (caveated>0) legitimately drops it to MATERIALS COMPLETE,
  // but the HARD floor (which flips to NOT READY) must NOT fire on a single stale req.
  assert.notEqual(j.band, 'NOT READY', 'one stale req must not trip the hard currency floor on a tiny manifest')
  assert.equal(j.band, 'MATERIALS COMPLETE')
  assert.doesNotMatch(j.gate_reason, /baseline currency:/i)
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

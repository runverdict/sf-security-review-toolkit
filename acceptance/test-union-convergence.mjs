#!/usr/bin/env node
/**
 * Standing test for harness/union-convergence.mjs — the deterministic engine that
 * answers "does the UNION of confirmed loci across N independent runs STOP
 * growing?" (Thread 2). Report-only; it gates nothing.
 *
 * Guards: (1) a converging run-set is read as converged with the right plateau;
 * (2) a run-set that keeps surfacing new loci is NOT read as converged; (3) locus
 * identity is the overlapping-line-span match shared with the recurrence engine;
 * (4) byte-determinism; (5) the >= 2-run guard; (6) only OPEN findings count.
 *
 * Self-contained + dependency-free: INLINE synthetic ledgers (files A/B/C/D…).
 *   node acceptance/test-union-convergence.mjs
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { computeUnionConvergence } from '../harness/union-convergence.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const ENGINE = join(PLUGIN, 'harness', 'union-convergence.mjs')

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

console.log('union-convergence standing test')

// --- fixture helpers -------------------------------------------------------
const conf = (file, title = 't') => ({
  id: 'x', dimension: 'apex-exposed-surface', title, severity: 'high', adjusted_severity: 'high',
  file, status: 'confirmed', verdict: 'confirmed_real', first_seen: 1, last_seen: 1,
})
const ref = (file, title = 't') => ({
  id: 'x', dimension: 'apex-exposed-surface', title, severity: 'high', adjusted_severity: 'high',
  file, status: 'refuted', verdict: 'false_positive', first_seen: 1, last_seen: 1,
})
const led = (...findings) => ({ schema_version: '1', findings, passes: [] })
const tmp = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); dirs.push(d); return d }

// --- 1. CONVERGING set: runs 3..N add nothing → converged, plateau_run set --
check('1 converging: union plateaus after run 2 → converged=true, plateau_run=2', () => {
  // run1 {A,B}; run2 adds C; runs 3,4 re-find the same three (overlapping spans) → 0 new.
  const out = computeUnionConvergence([
    led(conf('force-app/classes/A.cls:10-20'), conf('force-app/classes/B.cls:5-9')),
    led(conf('force-app/classes/A.cls:10-20'), conf('force-app/classes/B.cls:5-9'), conf('force-app/classes/C.cls:1-3')),
    led(conf('force-app/classes/A.cls:15-22'), conf('force-app/classes/B.cls:6-8'), conf('force-app/classes/C.cls:1-3')),
    led(conf('force-app/classes/A.cls:10-20'), conf('force-app/classes/B.cls:5-9'), conf('force-app/classes/C.cls:2-3')),
  ])
  assert.equal(out.n_runs, 4)
  assert.deepEqual(out.marginal_new, [2, 1, 0, 0], 'run1 +2, run2 +1 (C), runs 3-4 +0')
  assert.deepEqual(out.union_size_series, [2, 3, 3, 3])
  assert.equal(out.total_union, 3)
  assert.equal(out.converged, true, 'last two runs each add 0 → converged')
  assert.equal(out.plateau_run, 2, 'union stopped growing after run 2')
  assert.match(out.caveat, /does not certify the audit complete/i)
})

// --- 2. NON-CONVERGING set: every run adds a fresh locus → never converged ---
check('2 non-converging: each run adds a new locus → converged=false, plateau_run=null', () => {
  const out = computeUnionConvergence([
    led(conf('force-app/classes/A.cls:1-5')),
    led(conf('force-app/classes/B.cls:1-5')),
    led(conf('force-app/classes/C.cls:1-5')),
    led(conf('force-app/classes/D.cls:1-5')),
  ])
  assert.deepEqual(out.marginal_new, [1, 1, 1, 1], 'every run contributes a brand-new locus')
  assert.deepEqual(out.union_size_series, [1, 2, 3, 4])
  assert.equal(out.total_union, 4)
  assert.equal(out.converged, false)
  assert.equal(out.plateau_run, null, 'no run after which all deltas are 0')
})

// --- 3. locus identity = overlapping line span (mirrors the recurrence engine) ---
check('3a same file, OVERLAPPING spans across runs → ONE locus, run 2 adds nothing', () => {
  const out = computeUnionConvergence([
    led(conf('force-app/classes/E.cls:21-26')),
    led(conf('force-app/classes/E.cls:19-25')), // overlaps 21-26 → same locus
  ])
  assert.equal(out.total_union, 1, 'overlapping spans collapse to one locus')
  assert.deepEqual(out.marginal_new, [1, 0])
})
check('3b same file, NON-overlapping spans → TWO loci (under-merge safe failure)', () => {
  const out = computeUnionConvergence([
    led(conf('force-app/classes/F.cls:10-15')),
    led(conf('force-app/classes/F.cls:40-45')), // disjoint from 10-15 → distinct locus
  ])
  assert.equal(out.total_union, 2, ':10-15 and :40-45 do not overlap → two loci')
  assert.deepEqual(out.marginal_new, [1, 1])
  assert.equal(out.converged, false)
})
check('3c two same-locus findings WITHIN one run collapse (no double-count)', () => {
  const out = computeUnionConvergence([
    led(conf('force-app/classes/G.cls:21-26', 'lens one'), conf('force-app/classes/G.cls:20-24', 'lens two')),
    led(conf('force-app/classes/G.cls:21-26')),
  ])
  assert.equal(out.total_union, 1, 'two overlapping lenses in run 1 are one locus')
  assert.deepEqual(out.marginal_new, [1, 0])
})

// --- 4. only OPEN/confirmed findings count toward the union -----------------
check('4 a refuted finding is NOT union growth (only OPEN_STATES count)', () => {
  const out = computeUnionConvergence([
    led(conf('force-app/classes/A.cls:1-5'), ref('force-app/classes/B.cls:1-5')),
    led(conf('force-app/classes/A.cls:1-5'), ref('force-app/classes/B.cls:1-5')),
  ])
  assert.equal(out.total_union, 1, 'only the confirmed A counts; the refuted B is not a locus')
  assert.deepEqual(out.marginal_new, [1, 0])
  assert.equal(out.converged, false, 'N=2: run 1 establishes the union, so the last two are not both 0')
})

// --- 5. byte-determinism (pure core + CLI) ---------------------------------
check('5 pure core + CLI are byte-deterministic', () => {
  const ledgers = [
    led(conf('force-app/classes/A.cls:10-20'), conf('server/index.js:30-34')),
    led(conf('force-app/classes/A.cls:11-21'), conf('server/index.js:30-34'), conf('worker/w.js:1-2')),
    led(conf('force-app/classes/A.cls:10-20')),
  ]
  const a = JSON.stringify(computeUnionConvergence(ledgers), null, 2)
  const b = JSON.stringify(computeUnionConvergence(ledgers), null, 2)
  assert.equal(a, b, 'pure + deterministic')
  const d = tmp('union-det-')
  const p1 = join(d, 'r1.json'); const p2 = join(d, 'r2.json'); const p3 = join(d, 'r3.json')
  writeFileSync(p1, JSON.stringify(ledgers[0])); writeFileSync(p2, JSON.stringify(ledgers[1])); writeFileSync(p3, JSON.stringify(ledgers[2]))
  const o1 = execFileSync('node', [ENGINE, p1, p2, p3], { encoding: 'utf8' })
  const o2 = execFileSync('node', [ENGINE, p1, p2, p3], { encoding: 'utf8' })
  assert.equal(o1, o2, 'CLI byte-identical on re-run')
  const parsed = JSON.parse(o1)
  assert.equal(parsed.n_runs, 3)
})

// --- 6. >= 2-run guard + fail-closed ---------------------------------------
check('6a fewer than 2 ledger paths → exit 2', () => {
  const d = tmp('union-guard-')
  const p1 = join(d, 'r1.json'); writeFileSync(p1, JSON.stringify(led(conf('force-app/classes/A.cls:1-5'))))
  let code = 0
  try { execFileSync('node', [ENGINE, p1], { stdio: 'pipe' }) } catch (e) { code = e.status }
  assert.equal(code, 2, 'one ledger → exit 2')
  let code2 = 0
  try { execFileSync('node', [ENGINE], { stdio: 'pipe' }) } catch (e) { code2 = e.status }
  assert.equal(code2, 2, 'zero ledgers → exit 2')
})
check('6b an unreadable ledger path → exit 2', () => {
  const d = tmp('union-bad-')
  const p1 = join(d, 'r1.json'); writeFileSync(p1, JSON.stringify(led(conf('force-app/classes/A.cls:1-5'))))
  let code = 0
  try { execFileSync('node', [ENGINE, p1, '/no/such/run2.json'], { stdio: 'pipe' }) } catch (e) { code = e.status }
  assert.equal(code, 2, 'unreadable ledger fails closed with exit 2')
})
check('6c a ledger whose findings is a non-array (dict) contributes zero, no crash', () => {
  const out = computeUnionConvergence([
    { schema_version: '1', findings: { not: 'an array' }, passes: [] },
    led(conf('force-app/classes/A.cls:1-5')),
  ])
  assert.equal(out.n_runs, 2)
  assert.deepEqual(out.marginal_new, [0, 1], 'run 1 (non-array findings) → 0; run 2 → 1')
  assert.equal(out.total_union, 1)
})

// --- 7. plateau_run is the LITERAL "smallest k after which all deltas are 0" ---
// It is computed independently of `converged`, so a non-converged run-set CAN carry a
// non-null plateau_run when only the FINAL run adds 0 after a late re-growth. This locks
// the spec-literal definition (a trailing single 0 sets plateau_run; convergence still
// needs the last TWO runs at 0). marginals here are [1,0,1,0].
check('7 [1,0,1,0]: plateau_run=3 (literal "all deltas after k are 0") while converged=false', () => {
  const out = computeUnionConvergence([
    led(conf('force-app/classes/A.cls:1-5')),              // +1 (A new)
    led(conf('force-app/classes/A.cls:1-5')),              // +0 (A re-found)
    led(conf('force-app/classes/B.cls:1-5')),              // +1 (B new — late re-growth)
    led(conf('force-app/classes/A.cls:1-5'), conf('force-app/classes/B.cls:1-5')), // +0
  ])
  assert.deepEqual(out.marginal_new, [1, 0, 1, 0])
  assert.equal(out.total_union, 2)
  assert.equal(out.converged, false, 'last two marginals [1,0] are not both 0 → not converged')
  assert.equal(out.plateau_run, 3, 'only run 4 follows run 3, and it added 0 → smallest k after which all deltas are 0 is 3')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

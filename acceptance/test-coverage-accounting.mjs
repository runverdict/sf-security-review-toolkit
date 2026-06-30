#!/usr/bin/env node
/**
 * Standing test for the PURE logic inside harness/workflow-template.mjs — the audit fan-out's
 * dimension validation + coverage accounting. The Workflow fan-out itself is NOT CI-runnable
 * (it needs the Workflow runtime), so this test exercises the pure helpers the two 0.8.44 bugs
 * live in. It does so by SLICING the helper block out of the template source and evaluating it,
 * because workflow-template.mjs cannot be imported directly: its top-level `return {…}` is legal
 * only inside the Workflow runtime's async wrapper (a plain `import` throws "Illegal return
 * statement"). Slicing the SAME source the live pipeline runs is what makes the engine and this
 * test share ONE code path — a mutation to the source helpers turns these checks RED.
 *
 * Guards:
 *   B / validation (BUG-B):
 *     WT1 — the PURE-helper block is present + extracts to real functions.
 *     WT2 — isFullTree('' / '.' / './' / '  ') → true; a real path → false.
 *     WT3 — isValidDimension ACCEPTS an always-on full-tree dimension (empty AND '.' targets) —
 *           the auto-inject default. Mutation: re-add `&& d.targets` to the validator → RED.
 *     WT4 — isValidDimension REJECTS a genuinely malformed entry (no key / no finderPrompt).
 *   A / coverage accounting (BUG-A):
 *     CA1 — perDimension with one null entry + one {coverageFailed:true} marker + normal results
 *           → coverageFailed lists BOTH dimensions (count non-zero), excluded from
 *           confirmed/refuted/unverified. Mutation: drop the null-dimension reconciliation → RED.
 *     CA2 — a CLEAN find (result was {findings:[]} → perDimension[i] === []) is a real
 *           0-findings dimension, NOT a coverage failure; a CRASHED find (the marker) IS one.
 *     CA3 — an all-clean run (no nulls, no markers) → coverageFailed empty.
 *   WIRE — the LIVE pipeline calls these helpers + emits the marker + the envelope carries
 *          coverage_failed (so the helpers are not dead test-only code).
 *
 * Dependency-free: `node acceptance/test-coverage-accounting.mjs`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const TEMPLATE = join(PLUGIN, 'harness', 'workflow-template.mjs')

let pass = 0, fail = 0
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

// ---- extract the pure helpers VERBATIM from the template source (shared code path) ----
const SRC = readFileSync(TEMPLATE, 'utf8')
const S = '// ===== BEGIN PURE COVERAGE HELPERS ====='
const E = '// ===== END PURE COVERAGE HELPERS ====='
function loadHelpers() {
  const a = SRC.indexOf(S), b = SRC.indexOf(E)
  if (a < 0 || b < 0 || b < a) throw new Error('PURE COVERAGE HELPERS markers not found in workflow-template.mjs')
  const block = SRC.slice(a + S.length, b)
  // The block is three standalone function declarations — no closure refs to module state.
  // eslint-disable-next-line no-new-func
  const factory = new Function(block + '\nreturn { isFullTree, isValidDimension, computeCoverage }')
  return factory()
}

console.log('coverage-accounting standing test (workflow-template pure logic)')

let H
check('WT1 PURE-helper block present + extracts to real functions', () => {
  H = loadHelpers()
  for (const name of ['isFullTree', 'isValidDimension', 'computeCoverage']) {
    assert.equal(typeof H[name], 'function', `${name} must extract to a function`)
  }
})

check('WT2 isFullTree: empty / "." / "./" / whitespace → true; a real path → false', () => {
  for (const t of ['', '.', './', '   ', null, undefined]) assert.equal(H.isFullTree(t), true, `${JSON.stringify(t)} is full-tree`)
  for (const t of ['a.cls', 'force-app/classes/X.cls', 'server/index.js\nlib/y.js', './src/a.js']) {
    assert.equal(H.isFullTree(t), false, `${JSON.stringify(t)} is NOT full-tree`)
  }
})

check('WT3 BUG-B: isValidDimension ACCEPTS an always-on full-tree dimension (empty AND "." targets)', () => {
  const long = 'x'.repeat(300)
  // the auto-inject default the engine produces: targets '.' (FULL_TREE_TARGET)
  assert.equal(H.isValidDimension({ key: 'secrets-credentials', targets: '.', finderPrompt: long }), true,
    'an always-on full-tree dimension with targets "." must be valid')
  // and the defensive empty-string sentinel (any path that emits empty targets)
  assert.equal(H.isValidDimension({ key: 'secrets-credentials', targets: '', finderPrompt: long }), true,
    'an always-on full-tree dimension with empty targets must be valid (empty == full-tree, not malformed)')
  // targets entirely absent → still valid (full-tree)
  assert.equal(H.isValidDimension({ key: 'error-handling-disclosure', finderPrompt: long }), true,
    'a dimension with NO targets key must be valid (full-tree)')
})

check('WT4 isValidDimension REJECTS a genuinely malformed entry (no key / no finderPrompt / nullish)', () => {
  assert.equal(H.isValidDimension({ key: '', targets: 'a.cls', finderPrompt: 'p' }), false, 'no key → invalid')
  assert.equal(H.isValidDimension({ targets: 'a.cls', finderPrompt: 'p' }), false, 'missing key → invalid')
  assert.equal(H.isValidDimension({ key: 'k', targets: 'a.cls', finderPrompt: '' }), false, 'empty finderPrompt → invalid')
  assert.equal(H.isValidDimension({ key: 'k', targets: 'a.cls' }), false, 'missing finderPrompt → invalid')
  assert.equal(H.isValidDimension(null), false, 'null → invalid')
  assert.equal(H.isValidDimension(undefined), false, 'undefined → invalid')
})

check('CA1 BUG-A: null entry + crash-marker + normal results → coverageFailed lists BOTH, excluded from confirmed/refuted/unverified', () => {
  const dimensions = [
    { key: 'dim-null' },   // index 0 — whole pipeline result dropped (a stage threw) → null
    { key: 'dim-crash' },  // index 1 — finder crashed (retry cap) → marker
    { key: 'dim-clean' },  // index 2 — ran clean, found nothing → []
    { key: 'dim-real' },   // index 3 — real findings: 1 confirmed, 1 refuted, 1 unverified
  ]
  const perDimension = [
    null,
    [{ dimension: 'dim-crash', coverageFailed: true, verdict: null }],
    [],
    [
      { title: 'A', dimension: 'dim-real', verdict: { verdict: 'confirmed_real' } },
      { title: 'B', dimension: 'dim-real', verdict: { verdict: 'false_positive' } },
      { title: 'C', dimension: 'dim-real', verdict: null },
    ],
  ]
  const cov = H.computeCoverage(perDimension, dimensions)
  // BOTH failure modes are surfaced, count non-zero.
  assert.deepEqual([...cov.coverageFailed].sort(), ['dim-crash', 'dim-null'], 'both the null-dimension and the crash-marker dimension must be coverage failures')
  assert.ok(cov.coverageFailed.length > 0, 'the count is non-zero when a finder crashed (the BUG-A "0 unverified" regression)')
  // normal findings reconcile correctly.
  assert.equal(cov.confirmed.length, 1, 'one confirmed')
  assert.equal(cov.refuted.length, 1, 'one refuted')
  assert.equal(cov.unverified.length, 1, 'one unverified finding')
  assert.equal(cov.all.length, 3, 'three real candidates (markers are NOT candidates)')
  // coverage-failure markers never leak into the finding buckets.
  for (const bucket of ['all', 'verified', 'unverified', 'confirmed', 'refuted']) {
    assert.ok(!cov[bucket].some((f) => f && f.coverageFailed), `${bucket} must not contain a coverage-failure marker`)
  }
  // the clean-empty dimension is NOT a coverage failure.
  assert.ok(!cov.coverageFailed.includes('dim-clean'), 'a clean 0-findings dimension is NOT a coverage failure')
})

check('CA2 distinguish CLEAN find (found nothing) from CRASHED find (finder failed)', () => {
  // clean find: result had {findings:[]} → stage 2 returned [] → perDimension[i] === []
  const clean = H.computeCoverage([[]], [{ key: 'd' }])
  assert.deepEqual(clean.coverageFailed, [], 'a clean 0-findings find is NOT a coverage failure')
  assert.equal(clean.all.length, 0, 'and contributes no candidates')
  // crashed find: finder returned null → stage 2 returned the marker
  const crash = H.computeCoverage([[{ dimension: 'd', coverageFailed: true, verdict: null }]], [{ key: 'd' }])
  assert.deepEqual(crash.coverageFailed, ['d'], 'a crashed find IS a coverage failure')
  assert.equal(crash.all.length, 0, 'and contributes no candidates')
  // whole-dimension drop (null): also a coverage failure, by index
  const drop = H.computeCoverage([null], [{ key: 'd' }])
  assert.deepEqual(drop.coverageFailed, ['d'], 'a wholly-dropped dimension (null) IS a coverage failure')
})

check('CA3 an all-clean run (no nulls, no markers) → coverageFailed empty', () => {
  const cov = H.computeCoverage(
    [
      [{ title: 'A', verdict: { verdict: 'confirmed_real' } }],
      [],
    ],
    [{ key: 'a' }, { key: 'b' }]
  )
  assert.deepEqual(cov.coverageFailed, [], 'no coverage failures when every finder completed')
  assert.equal(cov.confirmed.length, 1)
})

check('WIRE: the LIVE pipeline calls these helpers + emits the marker + the envelope carries coverage_failed', () => {
  assert.match(SRC, /computeCoverage\(perDimension, ARGS\.dimensions\)/, 'the live pipeline must call computeCoverage on the raw perDimension')
  assert.match(SRC, /if \(!isValidDimension\(d\)\)/, 'the live validation must call isValidDimension')
  assert.match(SRC, /isFullTree\(dim\.targets\)/, 'the finder prompt must scope full-tree via isFullTree')
  assert.match(SRC, /coverageFailed: true/, 'stage 2 must emit the coverage-failure marker on a crashed finder')
  assert.match(SRC, /coverage_failed: coverageFailed/, 'the envelope must carry coverage_failed')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

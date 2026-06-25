#!/usr/bin/env node
/**
 * Standing test for harness/render-stability.mjs — the VERBATIM Finding-Stability
 * block (WI-00B render-harness + WI-03). The "Finding Stability (N-run consensus)"
 * section of the readiness verdict was driver-improvised prose (a table one run,
 * text the next, the contestable band named differently each time). This pins it.
 *
 * RS1  determinism — same JSON twice → byte-identical.
 * RS2  PRESENT branch (n>=2) — the bucket_counts table + the reliably-recurring
 *      blocker list + the contestable band + the informational caveat.
 * RS3  ABSENT / single-run branch — the fixed honest one-liner (no stability signal).
 * RS4  mixed-commit note appears IFF commit_consistency != 'consistent'.
 * RS5  HONESTY — the block never claims the audit is complete/passed; it carries the
 *      "informational only — changes NOTHING about the SCI gate" caveat on both branches.
 *
 * Dependency-free: `node acceptance/test-render-stability.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { renderStability } from '../harness/render-stability.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'render-stability.mjs')

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) } }
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'render-stab-')); dirs.push(d); return d }

const PRESENT = {
  summary: {
    n_runs: 3,
    commit_consistency: 'consistent',
    confirmed_per_run: { 1: 2, 2: 2, 3: 2 },
    pairwise_jaccard: [{ pair: '1-2', jaccard: 0.67, shared: 2, union: 3 }],
    bucket_counts: { all_runs_stable: 2, all_runs_unstable: 1, some_runs: 4, single_run: 5 },
    reliably_recurring_blockers: [
      { file: 'src/a.cls', line_span: { lo: 10, hi: 20 }, adjusted_severity: 'high', dimensions: ['tenant-isolation'], stability_note: 'confirmed at high in all 3 runs' },
    ],
  },
}

console.log('render-stability standing test')

check('RS1 determinism: same JSON twice → byte-identical', () => {
  assert.equal(renderStability(PRESENT), renderStability(PRESENT))
  // and via the CLI on a real file
  const d = tmp()
  const f = join(d, 'rc.json')
  writeFileSync(f, JSON.stringify(PRESENT))
  const a = execFileSync('node', [CLI, '--input', f], { encoding: 'utf8' })
  const b = execFileSync('node', [CLI, '--input', f], { encoding: 'utf8' })
  assert.equal(a, b)
})

check('RS2 PRESENT branch: bucket table + reliably-recurring blockers + contestable band + caveat', () => {
  const block = renderStability(PRESENT)
  assert.match(block, /### Finding Stability \(N-run consensus\)/)
  assert.match(block, /\| Recurrence bucket \| Count \| Meaning \|/)
  // pin EVERY bucket row value, so a mis-rendered count is caught
  assert.match(block, /\| all-runs, stable \| 2 \|/)
  assert.match(block, /\| all-runs, unstable \| 1 \|/)
  assert.match(block, /\| some-runs \| 4 \|/)
  assert.match(block, /\| single-run \| 5 \|/)
  assert.match(block, /\*\*Reliably-recurring blockers \(1\)\*\*/)
  assert.match(block, /src\/a\.cls:10-20 — high \[tenant-isolation\]/)
  // contestable band = all_runs_unstable (1) + some_runs (4) = 5, NAMED consistently
  assert.match(block, /\*\*Contestable band: 5\*\*/)
  assert.match(block, /Informational only/)
})

check('RS2b PRESENT branch with NO reliable blockers → explicit "none"', () => {
  const noBlockers = { summary: { ...PRESENT.summary, reliably_recurring_blockers: [] } }
  const block = renderStability(noBlockers)
  assert.match(block, /\*\*Reliably-recurring blockers:\*\* none/)
})

check('RS3 ABSENT / single-run branch → the fixed honest one-liner', () => {
  const absent = renderStability(null)
  assert.match(absent, /Finding stability not assessed: no multi-run recurrence data found/)
  assert.ok(!/Recurrence bucket/.test(absent), 'absent branch renders NO bucket table')
  const single = renderStability({ summary: { n_runs: 1, bucket_counts: { single_run: 3 } } })
  assert.match(single, /Finding stability not assessed: only one audit run/)
  assert.ok(!/Recurrence bucket/.test(single), 'single-run branch renders NO bucket table')
})

check('RS4 mixed-commit note appears IFF commit_consistency != consistent', () => {
  assert.ok(!/commit_consistency=/.test(renderStability(PRESENT)), 'consistent → NO note')
  const mixed = renderStability({ summary: { ...PRESENT.summary, commit_consistency: 'mixed' } })
  assert.match(mixed, /commit_consistency=mixed/)
  assert.match(mixed, /may reflect a CODE CHANGE/)
  const unknown = renderStability({ summary: { ...PRESENT.summary, commit_consistency: 'unknown' } })
  assert.match(unknown, /commit_consistency=unknown/, 'unknown (also != consistent) → note')
})

check('RS5 HONESTY: never claims complete/passed; the informational caveat is on BOTH branches', () => {
  for (const block of [renderStability(PRESENT), renderStability(null)]) {
    assert.match(block, /Informational only/)
    assert.match(block, /changes NOTHING about the SCI gate/)
    // the no-completeness statement (it wraps across a blockquote line, so assert the parts)
    assert.match(block, /No fixed run-count/)
    assert.match(block, /certifies the audit complete/)
    assert.match(block, /Salesforce performs its own penetration test regardless/)
    assert.ok(!/\bwill pass\b/i.test(block), 'never says "will pass"')
    assert.ok(!/\bpassed\b/i.test(block), 'never says "passed"')
    assert.ok(!/submission is ready|ready to submit/i.test(block), 'never claims the submission is ready')
  }
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

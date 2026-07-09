#!/usr/bin/env node
/**
 * Standing test for the durable run-log re-render (harness/rerender-runlog.mjs).
 * merge-ledger.mjs appends `- Open confirmed (all passes): …` BEFORE
 * reconcile-provenance/apply-dispositions run, so the committed run-log carried
 * pre-disposition counts (a real cold run shipped 441/273-high against a ledger
 * holding 86/25). The engine re-derives that ONE line, in the FINAL `## Pass N`
 * block only, from the CURRENT ledger.
 *
 * RL1  the rewritten line equals the post-disposition ledger count (and the
 *      correction is printed, visible, never silent).
 * RL2  idempotence — the second run is a byte no-op (CLI + pure fn).
 * RL3  earlier `## Pass` blocks are byte-identical (historical record).
 * RL4  missing ledger / missing run-log / no-`## Pass`-block / dict-shaped
 *      `findings` → non-zero exit, file untouched — never a partial write,
 *      never an invented count.
 * RL5  the severity breakdown matches merge-ledger's ordering + formatting
 *      exactly — proven by a LIVE merge-ledger run (parity, not a lookalike),
 *      plus the `|| '(none above info)'` fallback branch.
 * RL6  wiring — audit-codebase grants the engine and Step 7 runs it after
 *      apply-dispositions.
 *
 * Dependency-free: `node acceptance/test-rerender-runlog.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { renderOpenConfirmedLine, rerenderRunlog } from '../harness/rerender-runlog.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'rerender-runlog.mjs')
const MERGE = join(PLUGIN, 'harness', 'merge-ledger.mjs')

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) } }
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'rrl-')); dirs.push(d); return d }
const run = (args) => {
  try { return { code: 0, out: execFileSync('node', args, { encoding: 'utf8' }) } }
  catch (e) { return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` } }
}

// Post-disposition ledger: 3 still-confirmed (1 critical, 2 high); a refuted, a
// superseded, and an accepted_risk entry must all be OUT of the count.
const LEDGER = {
  schema_version: '1',
  findings: [
    { id: 'a1', dimension: 'apex-exposed-surface', title: 'T1', status: 'confirmed', adjusted_severity: 'critical', file: 'a.cls:5' },
    { id: 'b2', dimension: 'web-client', title: 'T2', status: 'confirmed', adjusted_severity: 'high', file: 'b.ts:10' },
    { id: 'c3', dimension: 'web-client', title: 'T3', status: 'confirmed', adjusted_severity: 'high', file: 'c.ts:12' },
    { id: 'd4', dimension: 'x', title: 'T4', status: 'refuted', adjusted_severity: 'high', file: 'd.ts:1' },
    { id: 'e5', dimension: 'x', title: 'T5', status: 'superseded', adjusted_severity: 'critical', file: 'e.ts:2' },
    { id: 'f6', dimension: 'x', title: 'T6', status: 'accepted_risk', adjusted_severity: 'medium', file: 'f.ts:3' },
  ],
  passes: [],
}
const EXPECTED_LINE = '- Open confirmed (all passes): 3 — 1 critical, 2 high'

const PASS1_BLOCK = `
## Pass 1 — 2026-07-01 (standard)
- Commit: aaa1111
- Dimensions: apex-exposed-surface
- Agents: 1 finders + 12 verifiers + 1 synthesis
- This pass: confirmed/partial 12, refuted 2, unverified 0
- Open confirmed (all passes): 12 — 5 high, 7 medium
- Dry (no new ≥low confirmed): false
- Report: docs/security-review/audit-report-2026-07-01-pass1.md
- Key collisions merged: 0
`
const PASS2_BLOCK = `
## Pass 2 — 2026-07-08 (standard)
- Commit: bbb2222
- Dimensions: apex-exposed-surface, web-client
- Agents: 2 finders + 441 verifiers + 1 synthesis
- This pass: confirmed/partial 441, refuted 12, unverified 3
- Open confirmed (all passes): 441 — 2 critical, 273 high, 166 medium
- Dry (no new ≥low confirmed): false
- Report: docs/security-review/audit-report-2026-07-08-pass2.md
- Key collisions merged: 4
`
const RUNLOG = `# Audit run log\n${PASS1_BLOCK}${PASS2_BLOCK}`

const mkTarget = ({ ledger = LEDGER, runlog = RUNLOG } = {}) => {
  const d = tmp()
  mkdirSync(join(d, '.security-review'), { recursive: true })
  if (ledger !== undefined && ledger !== null) writeFileSync(join(d, '.security-review', 'audit-ledger.json'), JSON.stringify(ledger, null, 2))
  if (runlog !== undefined && runlog !== null) writeFileSync(join(d, '.security-review', 'run-log.md'), runlog)
  return d
}
const runlogOf = (d) => readFileSync(join(d, '.security-review', 'run-log.md'), 'utf8')

console.log('rerender-runlog standing test')

check('RL1 the rewritten line equals the post-disposition ledger count, and the correction is printed', () => {
  const d = mkTarget()
  const r = run([CLI, '--target', d])
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`)
  const after = runlogOf(d)
  assert.ok(after.includes(EXPECTED_LINE), 'the final Pass block carries the ledger-derived line')
  assert.ok(!after.includes('441 — 2 critical, 273 high, 166 medium'), 'the stale pre-disposition line is gone')
  // the correction is VISIBLE on stdout, old → new, never silent
  assert.equal(r.out, 'run-log: open confirmed 441 → 3 (2 critical, 273 high, 166 medium → 1 critical, 2 high)\n')
})

check('RL2 idempotence: the second run is a byte no-op (CLI + pure fn)', () => {
  const d = mkTarget()
  run([CLI, '--target', d])
  const once = runlogOf(d)
  const r2 = run([CLI, '--target', d])
  assert.equal(r2.code, 0)
  assert.equal(runlogOf(d), once, 'second CLI run changed bytes')
  assert.match(r2.out, /no change/, 'the no-op is stated, not silent')
  // pure fn: re-rendering its own output reports changed:false with identical text
  const first = rerenderRunlog(RUNLOG, LEDGER.findings)
  const second = rerenderRunlog(first.text, LEDGER.findings)
  assert.equal(first.ok && second.ok, true)
  assert.equal(second.changed, false)
  assert.equal(second.text, first.text)
})

check('RL3 earlier `## Pass` blocks are byte-identical (historical record untouched)', () => {
  const d = mkTarget()
  run([CLI, '--target', d])
  const after = runlogOf(d)
  const cut = RUNLOG.indexOf('## Pass 2')
  assert.ok(cut > 0, 'fixture sanity: Pass 2 heading present')
  assert.equal(after.slice(0, cut), RUNLOG.slice(0, cut), 'everything before the final Pass block is byte-identical')
  assert.ok(after.includes('- Open confirmed (all passes): 12 — 5 high, 7 medium'), 'Pass 1 keeps its own (stale) historical line')
})

check('RL4 missing ledger → non-zero exit, run-log byte-untouched', () => {
  const d = mkTarget({ ledger: null })
  const r = run([CLI, '--target', d])
  assert.equal(r.code, 2, `expected exit 2, got ${r.code}`)
  assert.match(r.out, /invented count|cannot read the ledger/i)
  assert.equal(runlogOf(d), RUNLOG, 'run-log bytes untouched')
})

check('RL4b run-log with no `## Pass` block → non-zero exit, file untouched', () => {
  const d = mkTarget({ runlog: '# Audit run log\n' })
  const r = run([CLI, '--target', d])
  assert.equal(r.code, 2)
  assert.match(r.out, /no `## Pass` block/)
  assert.equal(runlogOf(d), '# Audit run log\n')
})

check('RL4c dict-shaped ledger `findings` → non-zero exit, file untouched (never an invented count)', () => {
  const d = mkTarget({ ledger: { schema_version: '1', findings: { 'apex.fls': { severity: 'high' } }, passes: [] } })
  const r = run([CLI, '--target', d])
  assert.equal(r.code, 2)
  assert.match(r.out, /not an array/)
  assert.equal(runlogOf(d), RUNLOG)
})

check('RL4d missing run-log → non-zero exit; final block missing the line → non-zero, untouched', () => {
  const d = mkTarget({ runlog: null })
  const r = run([CLI, '--target', d])
  assert.equal(r.code, 2)
  assert.match(r.out, /no run-log/)
  // a final Pass block WITHOUT the open-confirmed line: refuse, never guess
  const noLine = `# Audit run log\n${PASS1_BLOCK}\n## Pass 2 — 2026-07-08 (standard)\n- Commit: bbb\n`
  const d2 = mkTarget({ runlog: noLine })
  const r2 = run([CLI, '--target', d2])
  assert.equal(r2.code, 2)
  assert.match(r2.out, /has no `- Open confirmed \(all passes\):` line/)
  assert.equal(runlogOf(d2), noLine)
})

check('RL5 severity breakdown matches merge-ledger exactly — LIVE parity run, not a lookalike', () => {
  // Run the REAL merge-ledger on a fresh target, then assert the engine's
  // renderer reproduces the very line merge-ledger just wrote, byte-for-byte.
  const d = tmp()
  mkdirSync(join(d, '.security-review'), { recursive: true })
  const upd = (title, file, sev, verdict = 'confirmed_real') => ({
    dimension: 'apex-exposed-surface', title, file, verdict,
    finder_severity: sev, adjusted_severity: sev,
    verdict_reasoning: 'r', evidence: 'e', exploit_scenario: 's', recommendation: 'fix',
  })
  const result = {
    ledger_updates: [
      upd('SOQL injection', 'classes/A.cls:10', 'critical'),
      upd('Missing FLS read', 'classes/B.cls:20', 'high'),
      upd('Missing FLS write', 'classes/C.cls:30', 'high'),
      upd('Verbose stack trace', 'classes/D.cls:40', 'info'),
      upd('Tempting but safe', 'classes/E.cls:50', 'high', 'false_positive'),
    ],
    dimensions_run: ['apex-exposed-surface'],
    total_candidates: 5,
  }
  const resultPath = join(d, 'result.json')
  writeFileSync(resultPath, JSON.stringify(result))
  execFileSync('node', [MERGE, '--repo', d, '--result', resultPath, '--date', '2026-07-09', '--pass', '1', '--tier', 'standard'], { encoding: 'utf8' })
  const written = runlogOf(d).split('\n').find((l) => l.startsWith('- Open confirmed (all passes):'))
  const merged = JSON.parse(readFileSync(join(d, '.security-review', 'audit-ledger.json'), 'utf8'))
  assert.equal(renderOpenConfirmedLine(merged.findings), written, 'renderer output ≠ the line merge-ledger itself wrote')
  assert.equal(written, '- Open confirmed (all passes): 4 — 1 critical, 2 high, 1 info', 'ordering + formatting pinned')
})

check('RL5b the `(none above info)` fallback branch is reproduced (zero + non-canonical severity)', () => {
  assert.equal(renderOpenConfirmedLine([]), '- Open confirmed (all passes): 0 — (none above info)')
  // merge-ledger counts a confirmed finding with a non-canonical severity but
  // excludes it from sevStr — the fallback must fire, never a trailing empty string
  assert.equal(
    renderOpenConfirmedLine([{ status: 'confirmed', adjusted_severity: 'weird' }]),
    '- Open confirmed (all passes): 1 — (none above info)'
  )
  assert.equal(
    renderOpenConfirmedLine([{ status: 'refuted', adjusted_severity: 'critical' }]),
    '- Open confirmed (all passes): 0 — (none above info)'
  )
})

check('RL6 wiring: audit-codebase grants the engine and Step 7 runs it after apply-dispositions', () => {
  const audit = readFileSync(join(PLUGIN, 'skills', 'audit-codebase', 'SKILL.md'), 'utf8')
  assert.match(audit, /Bash\(node \*harness\/rerender-runlog\.mjs \*\)/, 'allowed-tools grants rerender-runlog (no grant = the gate prompts and gets skipped)')
  assert.match(audit, /rerender-runlog\.mjs --target/, 'Step 7 states the exact invocation')
  assert.ok(
    audit.indexOf('apply-dispositions.mjs') < audit.indexOf('rerender-runlog.mjs --target'),
    'the run-log re-render is stated AFTER apply-dispositions'
  )
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

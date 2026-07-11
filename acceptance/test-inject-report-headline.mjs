#!/usr/bin/env node
/*
 * test-inject-report-headline.mjs — the deterministic report-headline injector
 * (harness/inject-report-headline.mjs). It guarantees the mandated cluster-headline block is
 * present in the report regardless of the synthesis LLM, so verify-report-headline can no
 * longer hard-stop on a MISSING block.
 *
 *   IH1  a placeholder in the exec summary → replaced with the wrapped block
 *   IH2  IDEMPOTENT: re-injecting the same block is a byte no-op
 *   IH3  no marker → the block is inserted right after the first heading (the exec summary)
 *   IH4  no heading at all → the block is prepended
 *   IH5  a STALE injected block → REPLACED with the current block (never duplicated / nested)
 *   IH6  round-trip: the injected block == verify-report-headline's `expected` (no
 *        missing-verbatim-block failure) — the injector and the gate cannot drift
 *   IH7  CLI: writes the report + exit 0; an unreadable ledger or missing report → exit 2 (fail closed)
 *
 * Dependency-free: `node acceptance/test-inject-report-headline.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { injectHeadline, HEADLINE_START, HEADLINE_END } from '../harness/inject-report-headline.mjs'
import { renderClusterHeadline, clusterOrNullFromFindings } from '../harness/finding-clusters.mjs'
import { verifyReportHeadline } from '../harness/verify-report-headline.mjs'

const CLI = fileURLToPath(new URL('../harness/inject-report-headline.mjs', import.meta.url))
let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`) } }
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'irh-')); dirs.push(d); return d }

const FINDINGS = [
  { id: 'c1', provenance: 'deterministic', engine: 'bandit', ruleId: 'gh', dimension: 'admin-surface', title: 'crit', adjusted_severity: 'critical', file: 'a.cls:1', status: 'confirmed', first_seen: 1, last_seen: 1 },
  { id: 'h1', provenance: 'llm-inferred', dimension: 'injection-xss', title: 'high', adjusted_severity: 'high', file: 'b.py:4', status: 'confirmed', first_seen: 1, last_seen: 1 },
]
const BLOCK = renderClusterHeadline(clusterOrNullFromFindings(FINDINGS))
const countMarkers = (s, m) => s.split(m).length - 1

console.log('inject-report-headline:')

check('IH1 a placeholder in the exec summary → replaced with the wrapped block', () => {
  const report = '# Audit report\n\n## Executive summary\n\n<!-- SRT:CLUSTER-HEADLINE -->\n\nBlocking items to follow.\n'
  const out = injectHeadline(report, BLOCK)
  assert.ok(out.includes(BLOCK), 'the block must be present')
  assert.ok(out.includes(HEADLINE_START) && out.includes(HEADLINE_END), 'wrapped in markers')
  assert.ok(!/<!--\s*SRT:CLUSTER-HEADLINE -->/.test(out.replace(HEADLINE_START, '')), 'the bare placeholder is consumed')
})

check('IH2 IDEMPOTENT: re-injecting the same block is a byte no-op', () => {
  // MUTATION: breaking the START-marker in-place replace (case 1) turns this red (the block would nest/duplicate)
  const report = '# R\n\n<!-- SRT:CLUSTER-HEADLINE -->\n\nprose\n'
  const once = injectHeadline(report, BLOCK)
  const twice = injectHeadline(once, BLOCK)
  assert.equal(twice, once, 'a second injection over the same block must be byte-identical')
  assert.equal(countMarkers(twice, HEADLINE_START), 1, 'exactly one START marker')
  assert.equal(countMarkers(twice, HEADLINE_END), 1, 'exactly one END marker')
})

check('IH3 no marker → the block is inserted right after the first heading', () => {
  const report = '# Audit report — 2026\n\nSome intro prose with no marker.\n'
  const out = injectHeadline(report, BLOCK)
  assert.ok(out.includes(BLOCK))
  const hi = out.indexOf('# Audit report')
  const bi = out.indexOf(BLOCK)
  assert.ok(hi >= 0 && bi > hi, 'the block lands after the first heading')
})

check('IH4 no heading at all → the block is prepended', () => {
  const out = injectHeadline('just prose, no heading\n', BLOCK)
  assert.ok(out.startsWith(HEADLINE_START), 'the region leads the report')
  assert.ok(out.includes(BLOCK))
})

check('IH5 a STALE injected block → REPLACED with the current block (never duplicated)', () => {
  // MUTATION: dropping case 1 (the START..END replace) turns this red — the stale block would survive alongside the new one
  const stale = renderClusterHeadline(clusterOrNullFromFindings([{ id: 'x', dimension: 'd', title: 't', adjusted_severity: 'critical', file: 'z.py:1', status: 'confirmed' }, { id: 'y', dimension: 'd', title: 't2', adjusted_severity: 'critical', file: 'z2.py:1', status: 'confirmed' }]))
  const seeded = injectHeadline('# R\n\n<!-- SRT:CLUSTER-HEADLINE -->\n', stale)
  assert.ok(seeded.includes(stale) && !seeded.includes(BLOCK))
  const refreshed = injectHeadline(seeded, BLOCK)
  assert.ok(refreshed.includes(BLOCK), 'the current block is present')
  assert.ok(!refreshed.includes(stale), 'the stale block is gone')
  assert.equal(countMarkers(refreshed, HEADLINE_START), 1, 'no nested markers')
})

check('IH6 round-trip: the injected block == verify-report-headline expected (no drift)', () => {
  const report = '# Audit report\n\n## Executive summary\n\n<!-- SRT:CLUSTER-HEADLINE -->\n\nStrong controls observed.\n'
  const out = injectHeadline(report, BLOCK)
  const r = verifyReportHeadline(out, FINDINGS)
  assert.ok(!r.failures.some((f) => f.code === 'missing-verbatim-block'), 'the injected block satisfies the presence check')
  assert.equal(r.expected, BLOCK, 'the injector composes the same block verify recomputes')
})

check('IH7 CLI: writes the report + exit 0; unreadable ledger / missing report → exit 2 (fail closed)', () => {
  const d = tmp()
  const sr = join(d, '.security-review'); mkdirSync(sr, { recursive: true })
  writeFileSync(join(sr, 'audit-ledger.json'), JSON.stringify({ schema_version: '1', findings: FINDINGS, passes: [{ id: 1 }] }))
  const reportPath = join(d, 'report.md')
  writeFileSync(reportPath, '# Audit report\n\n## Executive summary\n\n<!-- SRT:CLUSTER-HEADLINE -->\n\nprose\n')
  execFileSync('node', [CLI, '--target', d, '--report', reportPath], { encoding: 'utf8', stdio: 'pipe' })
  const after = readFileSync(reportPath, 'utf8')
  assert.ok(after.includes(BLOCK) && after.includes(HEADLINE_START), 'the CLI wrote the block into the report')

  // unreadable ledger → exit 2
  const bad = tmp(); mkdirSync(join(bad, '.security-review'), { recursive: true })
  writeFileSync(join(bad, '.security-review', 'audit-ledger.json'), 'not json')
  const rp2 = join(bad, 'r.md'); writeFileSync(rp2, '# R\n')
  let code = 0
  try { execFileSync('node', [CLI, '--target', bad, '--report', rp2], { stdio: 'pipe' }) } catch (e) { code = e.status }
  assert.equal(code, 2, 'an unreadable ledger fails closed (exit 2)')

  // missing report → exit 2
  const d3 = tmp(); mkdirSync(join(d3, '.security-review'), { recursive: true })
  writeFileSync(join(d3, '.security-review', 'audit-ledger.json'), JSON.stringify({ findings: FINDINGS, passes: [{ id: 1 }] }))
  let code3 = 0
  try { execFileSync('node', [CLI, '--target', d3, '--report', join(d3, 'nope.md')], { stdio: 'pipe' }) } catch (e) { code3 = e.status }
  assert.equal(code3, 2, 'a missing report fails closed (exit 2)')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

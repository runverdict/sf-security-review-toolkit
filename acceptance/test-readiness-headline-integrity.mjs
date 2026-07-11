#!/usr/bin/env node
/*
 * test-readiness-headline-integrity.mjs — the tag gate that the readiness headline's
 * critical/high count is the ADJUDICATED (post-disposition) ledger, NOT the raw scanner band.
 *
 * WHY. On a cold run the raw deterministic band was 3 critical / 121 high; the HONEST number
 * (1 critical / 34 high) only emerged after the audit adjudicated the known-safe noise. A
 * readiness headline that reads the RAW band presents a plausible-looking WRONG number — the
 * exact failure mode #1. This drives the REAL adjudication pipeline end-to-end
 * (apply-dispositions → render-recap) over a raw band and asserts the emitted cluster headline
 * (`report-headline.md`) counts the adjudicated blockers, not the scanner band.
 *
 * This is NOT a re-test of render-recap's unit behaviour (test-render-recap owns that); it is
 * the end-to-end assertion that the SHIPPED chain a driver runs produces an honest headline.
 *
 *   RH1  the raw seeded band's headline shows the raw counts (baseline meaningfulness)
 *   RH2  apply-dispositions adjudicates the band deterministically (raw → adjudicated in the ledger)
 *   RH3  render-recap's report-headline.md shows the ADJUDICATED counts, never the raw band
 *   RH4  the emitted headline == the block over the post-disposition ledger AND its stated
 *        critical/high == the independently-counted open (confirmed) critical/high
 *   RH5  verify-report-headline binds a report to the ADJUDICATED ledger — a report parroting
 *        the raw band count HALTS
 *
 * Dependency-free: `node acceptance/test-readiness-headline-integrity.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { renderClusterHeadline, clusterOrNullFromFindings } from '../harness/finding-clusters.mjs'
import { verifyReportHeadline } from '../harness/verify-report-headline.mjs'

const APPLY = fileURLToPath(new URL('../harness/apply-dispositions.mjs', import.meta.url))
const RECAP = fileURLToPath(new URL('../harness/render-recap.mjs', import.meta.url))
let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`) } }
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'rhi-')); dirs.push(d); return d }
const node = (args) => execFileSync('node', args, { encoding: 'utf8', stdio: 'pipe' })

// A deterministic scanner finding (the shape ingest-scanner-findings emits + merge-ledger keeps).
function det(engine, ruleId, sev, file) {
  return {
    id: `${engine}::${ruleId}::${file}`, provenance: 'deterministic', engine, ruleId,
    dimension: 'external-sast', title: `${ruleId} at ${file}`,
    severity: sev, adjusted_severity: sev, file, status: 'confirmed',
    first_seen: 1, last_seen: 1, verdict: 'confirmed_real', verdict_reasoning: 'seeded', evidence: 'seeded',
  }
}

// Seed a RAW deterministic band mirroring the cold run's shape:
//   critical 3  = 2 in a refuted class (bandit/B608-crit) + 1 kept (bandit/global-handler, the
//                 deterministic critical the seeder deliberately SPARES)
//   high    120 = 87 in a refuted class (semgrep/avoid-sqlalchemy-text, migration DDL) +
//                 33 kept (osv/prod-cve, a production dependency CVE the audit leaves OPEN)
// Adjudicated open ⇒ 1 critical / 33 high.
const findings = []
findings.push(det('bandit', 'B608-crit', 'critical', 'crit-refuted-0.py:1'))
findings.push(det('bandit', 'B608-crit', 'critical', 'crit-refuted-1.py:1'))
findings.push(det('bandit', 'global-handler', 'critical', 'crit-kept-0.cls:1'))
for (let i = 0; i < 87; i++) findings.push(det('semgrep', 'avoid-sqlalchemy-text', 'high', `high-refuted-${i}.py:1`))
for (let i = 0; i < 33; i++) findings.push(det('osv', 'prod-cve', 'high', `high-kept-${i}.py:1`))

const RAW_CRIT = 3, RAW_HIGH = 120, ADJ_CRIT = 1, ADJ_HIGH = 33

function seed(dir) {
  const sr = join(dir, '.security-review')
  mkdirSync(sr, { recursive: true })
  writeFileSync(join(sr, 'audit-ledger.json'), JSON.stringify({
    schema_version: '1', findings,
    passes: [{ id: 1, date: '2026-07-11', audited_commit: '', tier: 'standard', dimensions: ['external-sast'], candidates: findings.length, confirmed: findings.length, refuted: 0, unverified: 0, dry: false, report_path: 'r.md' }],
  }, null, 2))
  writeFileSync(join(sr, 'deterministic-dispositions.json'), JSON.stringify({
    dispositions: [
      { engine: 'bandit', ruleId: 'B608-crit', disposition: 'refuted', reason: 'migration-dir DDL — server-authored, not user input (test fixture)', scope: { as_of_pass: 1 } },
      { engine: 'semgrep', ruleId: 'avoid-sqlalchemy-text', disposition: 'refuted', reason: 'migration-dir DDL — server-authored, not user input (test fixture)', scope: { as_of_pass: 1 } },
    ],
  }, null, 2))
  return sr
}
const readLedger = (sr) => JSON.parse(readFileSync(join(sr, 'audit-ledger.json'), 'utf8'))
const openBy = (led, sev) => led.findings.filter((f) => ['confirmed', 'regressed'].includes(String(f.status || '').toLowerCase()) && f.adjusted_severity === sev).length
const sevLine = (block, sev) => { const m = block.match(new RegExp(`${sev} (\\d+)`)); return m ? Number(m[1]) : null }

console.log('readiness-headline-integrity:')

check('RH1 the raw seeded band headline shows the RAW counts (baseline meaningfulness)', () => {
  const raw = renderClusterHeadline(clusterOrNullFromFindings(findings))
  assert.equal(sevLine(raw, 'critical'), RAW_CRIT)
  assert.equal(sevLine(raw, 'high'), RAW_HIGH)
})

check('RH2 apply-dispositions adjudicates the band deterministically (raw → adjudicated in the ledger)', () => {
  const dir = tmp(); const sr = seed(dir)
  node([APPLY, '--target', dir]) // exit 0 — valid scoped dispositions; a throw here fails the check
  const led = readLedger(sr)
  // MUTATION-of-premise: without a real apply, these stay 3/120 — the whole gate rides on this drop.
  assert.equal(openBy(led, 'critical'), ADJ_CRIT, 'one deterministic critical (global-handler) must remain OPEN')
  assert.equal(openBy(led, 'high'), ADJ_HIGH, 'the 33 kept production-CVE highs must remain OPEN')
})

check('RH3 render-recap report-headline.md shows the ADJUDICATED counts, NEVER the raw band', () => {
  const dir = tmp(); const sr = seed(dir)
  node([APPLY, '--target', dir])
  node([RECAP, '--target', dir])
  const sidecar = readFileSync(join(sr, 'report-headline.md'), 'utf8')
  assert.equal(sevLine(sidecar, 'critical'), ADJ_CRIT, `headline critical must be ${ADJ_CRIT} (adjudicated), got ${sevLine(sidecar, 'critical')}`)
  assert.equal(sevLine(sidecar, 'high'), ADJ_HIGH, `headline high must be ${ADJ_HIGH} (adjudicated), got ${sevLine(sidecar, 'high')}`)
  assert.ok(!/critical 3 · high 120/.test(sidecar), 'the readiness headline must NEVER show the raw scanner band')
})

check('RH4 the emitted headline == the post-disposition ledger block AND its counts == the open critical/high', () => {
  const dir = tmp(); const sr = seed(dir)
  node([APPLY, '--target', dir]); node([RECAP, '--target', dir])
  const led = readLedger(sr)
  const sidecar = readFileSync(join(sr, 'report-headline.md'), 'utf8')
  // the sidecar is byte-identical to the block over the CURRENT ledger (the verify gate's expected)
  assert.equal(sidecar, renderClusterHeadline(clusterOrNullFromFindings(led.findings)) + '\n')
  // and its stated counts equal the independently-counted OPEN critical/high (the ledger is truth)
  assert.equal(sevLine(sidecar, 'critical'), openBy(led, 'critical'))
  assert.equal(sevLine(sidecar, 'high'), openBy(led, 'high'))
})

check('RH5 verify-report-headline binds the report to the ADJUDICATED ledger — a raw-band claim HALTS', () => {
  const dir = tmp(); const sr = seed(dir)
  node([APPLY, '--target', dir]); node([RECAP, '--target', dir])
  const led = readLedger(sr)
  const sidecar = readFileSync(join(sr, 'report-headline.md'), 'utf8')
  // a report whose exec summary IS the adjudicated headline passes
  assert.equal(verifyReportHeadline(sidecar, led.findings).ok, true)
  // a report parroting the RAW band's blocking count (3+120=123) contradicts the adjudicated ledger (1+33=34) → HALT
  const rawClaim = verifyReportHeadline(sidecar + `\n\nBlocking items (critical/high): ${RAW_CRIT + RAW_HIGH}\n`, led.findings)
  assert.equal(rawClaim.ok, false)
  assert.ok(rawClaim.failures.some((f) => f.code === 'blocking-items-contradiction'))
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

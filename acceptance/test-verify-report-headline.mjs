#!/usr/bin/env node
/**
 * Standing test for the report-headline gate (harness/verify-report-headline.mjs).
 * audit-codebase Step 6 mandates the exec summary be HEADED by the verbatim
 * cluster block; a real cold run skipped it and hand-wrote "Blocking items
 * (critical/high): none this pass" over a ledger holding confirmed criticals.
 * The gate turns that prose mandate into an exit code — and MUST never fire on
 * legitimate prose (a checker that false-positives gets disabled and is worse
 * than none).
 *
 * VH1  a report missing the verbatim block → exit 2.
 * VH2  a report claiming "none" against a ledger with a confirmed critical → exit 2.
 * VH3  an agreeing report → exit 0 + a one-line confirmation.
 * VH4  anti-false-positive — a correct report that merely DISCUSSES severity
 *      words in prose (remediation sentences, "high-priority", "high-availability",
 *      an unparseable blocking-items value, historical counts outside the
 *      headline region, file-level vs raw count readings) does NOT trip it.
 * VH5  wiring — audit-codebase grants the engine and Step 7 treats non-zero as
 *      a HARD STOP.
 * VH6  fail-closed — an unreadable ledger (missing file / dict findings) → exit 2,
 *      never a false PASS.
 * VH7  ROUND-TRIP LOCK — the emitted sidecar block
 *      (`renderClusterHeadline(clusterOrNullFromFindings(FINDINGS))`, the exact bytes
 *      merge-ledger/render-recap write to `.security-review/report-headline.md`), placed
 *      as the report headline, PASSES the gate (no missing-block failure, no self-tripped
 *      contradiction from the block's own counts) — and a contradicting labelled claim
 *      pasted BESIDE the correct block still FAILS it. Pins the emitter contract to
 *      verify's expected block so the two can never drift apart.
 *
 * Dependency-free: `node acceptance/test-verify-report-headline.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { verifyReportHeadline } from '../harness/verify-report-headline.mjs'
import { clusterFindings, renderClusterHeadline, clusterOrNullFromFindings } from '../harness/finding-clusters.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'verify-report-headline.mjs')

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) } }
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'vrh-')); dirs.push(d); return d }
const run = (args) => {
  try { return { code: 0, out: execFileSync('node', args, { encoding: 'utf8' }) } }
  catch (e) { return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` } }
}

// Ledger truth: 1 open critical + 1 open high (distinct files → raw == file-level),
// plus a refuted entry that must stay out of every count.
const FINDINGS = [
  { id: '1', dimension: 'apex-exposed-surface', title: 'SOQL injection', status: 'confirmed', adjusted_severity: 'critical', file: 'classes/A.cls:5' },
  { id: '2', dimension: 'web-client', title: 'Missing FLS', status: 'confirmed', adjusted_severity: 'high', file: 'app/api.ts:10' },
  { id: '3', dimension: 'web-client', title: 'Tempting but safe', status: 'refuted', adjusted_severity: 'high', file: 'app/z.ts:1' },
]
const BLOCK = renderClusterHeadline(clusterFindings(FINDINGS))

const mkTarget = (findings = FINDINGS) => {
  const d = tmp()
  mkdirSync(join(d, '.security-review'), { recursive: true })
  writeFileSync(join(d, '.security-review', 'audit-ledger.json'), JSON.stringify({ schema_version: '1', findings, passes: [] }))
  return d
}
const withReport = (d, text) => { const p = join(d, 'report.md'); writeFileSync(p, text); return p }

const AGREEING_REPORT = `# Audit report — pass 1

## 1. Executive summary

${BLOCK}

Blocking items (critical/high): 2 — 1 critical (SOQL injection) and 1 high (Missing FLS). Not ready to submit until both are fixed.

## 2. Prioritized findings

| adjusted_severity | title | file |
|---|---|---|
| critical | SOQL injection | classes/A.cls:5 |
| high | Missing FLS | app/api.ts:10 |

## 3. Remediation plan

It is critical that the org parameterizes the dynamic query. The FLS gap is high-risk; treat the fix as high-priority.
`

console.log('verify-report-headline standing test')

check('VH1 a report missing the verbatim block → exit 2, loudly', () => {
  const d = mkTarget()
  const p = withReport(d, `# Audit report

## Executive summary

Hand-written triage: 441 open confirmed findings across 9 dimensions.

Blocking items (critical/high): 2 — see the table.
`)
  const r = run([CLI, '--target', d, '--report', p])
  assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`)
  assert.match(r.out, /missing-verbatim-block/)
  assert.match(r.out, /finding-clusters\.mjs --target <target> --headline/, 'tells the driver exactly what to paste')
})

check('VH2 a report claiming "none" against a ledger with a confirmed critical → exit 2', () => {
  const d = mkTarget()
  const p = withReport(d, `# Audit report

## 1. Executive summary

${BLOCK}

Blocking items (critical/high): none this pass — ready to proceed.

## 2. Prioritized findings
`)
  const r = run([CLI, '--target', d, '--report', p])
  assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`)
  assert.match(r.out, /blocking-items-contradiction/)
  assert.match(r.out, /1 open critical \+ 1 open high/, 'the contradiction cites the ledger counts')
})

check('VH2b a stated in-region count the ledger refutes ("0 critical" / "273 high") → exit 2', () => {
  const d = mkTarget()
  const p = withReport(d, `# Audit report

## 1. Executive summary

${BLOCK}

This pass surfaced 0 critical issues and 273 high findings overall.

## 2. Prioritized findings
`)
  const r = run([CLI, '--target', d, '--report', p])
  assert.equal(r.code, 2)
  assert.match(r.out, /critical-count-contradiction/)
  assert.match(r.out, /high-count-contradiction/)
})

check('VH3 an agreeing report → exit 0 with a one-line confirmation', () => {
  const d = mkTarget()
  const p = withReport(d, AGREEING_REPORT)
  const r = run([CLI, '--target', d, '--report', p])
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`)
  assert.match(r.out, /^verify-report-headline: PASS — .*critical 1 · high 1/, 'one line, states the ledger counts')
})

check('VH4 anti-false-positive: severity words in legitimate prose never trip the gate', () => {
  const d = mkTarget()
  const p = withReport(d, `# Audit report — pass 1

## 1. Executive summary

The submission is not ready; the criticality of the injection finding is severe, and fixing it is critical.

${BLOCK}

Blocking items (critical/high): unresolved — pending owner triage of the injection finding.

The rollout spans 3 high-availability zones and 3 high-priority sprints.

## 2. Prioritized findings

| adjusted_severity | title |
|---|---|
| critical | SOQL injection |

## 3. Remediation plan

It is critical to rotate the leaked key. The retry loop is high-risk. A prior
engagement resolved 5 high findings and 2 critical findings; that history does
not change this pass. Allocate 3 high-priority tasks.
`)
  const r = run([CLI, '--target', d, '--report', p])
  assert.equal(r.code, 0, `false positive — the gate fired on legitimate prose: ${r.out}`)
})

check('VH4b conservatism: a numeric claim matching EITHER the raw count OR the file-level count passes', () => {
  // two confirmed criticals in ONE file: raw critical = 2, file-level critical = 1
  const two = [
    { id: 'x1', dimension: 'apex-exposed-surface', title: 'SOQL injection A', status: 'confirmed', adjusted_severity: 'critical', file: 'classes/A.cls:5' },
    { id: 'x2', dimension: 'apex-exposed-surface', title: 'SOQL injection B', status: 'confirmed', adjusted_severity: 'critical', file: 'classes/A.cls:80' },
  ]
  const blockTwo = renderClusterHeadline(clusterFindings(two))
  const rawReading = verifyReportHeadline(`${blockTwo}\n\nThe audit confirmed 2 critical findings.\n`, two)
  assert.equal(rawReading.ok, true, `raw-count reading tripped: ${JSON.stringify(rawReading.failures)}`)
  const fileReading = verifyReportHeadline(`${blockTwo}\n\nThe audit confirmed 1 critical file.\n`, two)
  assert.equal(fileReading.ok, true, `file-level reading tripped: ${JSON.stringify(fileReading.failures)}`)
  // but a count matching NEITHER is a demonstrable contradiction
  const wrong = verifyReportHeadline(`${blockTwo}\n\nThe audit confirmed 7 critical findings.\n`, two)
  assert.equal(wrong.ok, false)
  assert.equal(wrong.failures[0].code, 'critical-count-contradiction')
})

check('VH4c region discipline: counts BELOW the next heading (findings table, remediation) are never scanned', () => {
  // "5 high" appears after a heading that closes the exec-summary region — a
  // historical statement, not a headline claim. Must not trip.
  const report = `${BLOCK}\n\nNot ready to submit.\n\n## History\n\nA 2024 engagement closed 5 high findings and 9 critical findings.\n`
  const r = verifyReportHeadline(report, FINDINGS)
  assert.equal(r.ok, true, `region leak — out-of-region counts tripped the gate: ${JSON.stringify(r.failures)}`)
})

check('VH5 wiring: audit-codebase grants the engine and Step 7 treats non-zero as a hard stop', () => {
  const audit = readFileSync(join(PLUGIN, 'skills', 'audit-codebase', 'SKILL.md'), 'utf8')
  assert.match(audit, /Bash\(node \*harness\/verify-report-headline\.mjs \*\)/, 'allowed-tools grants verify-report-headline (no grant = the gate prompts and gets skipped)')
  assert.match(audit, /verify-report-headline\.mjs\s*\n?\s*--target <target> --report <report-path>/, 'Step 7 states the exact invocation')
  assert.match(audit, /HARD STOP/, 'non-zero exit is a hard stop, not a warning')
})

check('VH6 fail-closed: an unreadable ledger (missing / dict findings) → exit 2, never a false PASS', () => {
  // missing ledger file entirely
  const d1 = tmp()
  mkdirSync(join(d1, '.security-review'), { recursive: true })
  const p1 = withReport(d1, AGREEING_REPORT)
  const r1 = run([CLI, '--target', d1, '--report', p1])
  assert.equal(r1.code, 2)
  assert.match(r1.out, /fails closed/)
  // dict-shaped findings (corrupted / hand-edited)
  const d2 = mkTarget({})
  writeFileSync(join(d2, '.security-review', 'audit-ledger.json'), JSON.stringify({ schema_version: '1', findings: { 'apex.fls': {} }, passes: [] }))
  const p2 = withReport(d2, AGREEING_REPORT)
  const r2 = run([CLI, '--target', d2, '--report', p2])
  assert.equal(r2.code, 2)
  assert.match(r2.out, /ledger-unreadable/)
  // missing --report is a usage error, also non-zero
  const r3 = run([CLI, '--target', d1])
  assert.equal(r3.code, 2)
})

check('VH7 round-trip lock: the emitted sidecar block passes the gate as-is; a contradicting claim beside it still fails', () => {
  // FINDINGS holds a confirmed critical — the exact shape the cold run lied about.
  // B is the byte-exact sidecar content (sans the trailing newline the writers append):
  // the same composition merge-ledger (Step 6) and render-recap --target (Step 7) emit.
  const B = renderClusterHeadline(clusterOrNullFromFindings(FINDINGS))
  // (a) the emitted block, placed as the report headline, passes: verify recomputes the
  // identical bytes from the same findings, and the block's own counts never self-trip
  // the contradiction scans.
  const ok = verifyReportHeadline(B, FINDINGS)
  assert.equal(ok.ok, true, `the emitted block must pass the Step-7 gate: ${JSON.stringify(ok.failures)}`)
  assert.equal(B, ok.expected, 'the emitter block is byte-identical to the block verify expects')
  // (b) CONTRAST — the gate still catches the labelled contradiction pasted BESIDE the
  // correct block (the `Blocking items (critical/high): none` shape verify parses).
  const bad = verifyReportHeadline(B + '\n\nBlocking items (critical/high): none\n', FINDINGS)
  assert.equal(bad.ok, false, 'a contradicting labelled claim beside the correct block must still fail')
  assert.equal(bad.failures[0].code, 'blocking-items-contradiction')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

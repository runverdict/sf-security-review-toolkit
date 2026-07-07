#!/usr/bin/env node
/**
 * Standing test for harness/build-evidence-index.mjs — the deterministic evidence
 * index producer that enforces the P1 credit rule.
 *
 * Guards:
 *   B1 — provenance adjudication: a cleared auto-fail class backed by a scanner file
 *        under .security-review/evidence/ is reviewer-reproducible + satisfied; the
 *        same class backed only by the docs/ audit report is statically-cleared. The
 *        engine decides from the LOCATION, never from the input.
 *   B2 — fail-safe: a cleared entry pointing at a NON-EXISTENT scanner file degrades
 *        to statically-cleared (no credit for a file that isn't on disk).
 *   B3 — end-to-end: the produced index, fed to compute-sci, credits ONLY the
 *        reviewer-reproducible clear (the 9%→17% self-grading regression stays closed).
 *   B4 — determinism: same input + same files ⇒ byte-identical index.json.
 *   B6/B7 — agent-test evidence fold (S1): the fragment normalize-agent-test.mjs
 *        emits is classified by THIS engine unchanged — a spec-only (no result)
 *        fold ⇒ pending-owner; an on-disk `sf agent test` result under
 *        .security-review/evidence/ ⇒ reviewer-reproducible + satisfied.
 *
 * Dependency-free: `node acceptance/test-build-evidence-index.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { foldToEvidenceInput, parseAgentTestResult } from '../harness/normalize-agent-test.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const BUILD = join(PLUGIN, 'harness', 'build-evidence-index.mjs')
const SCI = join(PLUGIN, 'harness', 'compute-sci.mjs')

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

// Build a target repo: a real SFGE scanner file on disk, a docs audit report, and an
// evidence-input that clears one class via the scanner and one via the audit report.
function makeRepo(inputOverride) {
  const dir = mkdtempSync(join(tmpdir(), 'bei-test-'))
  mkdirSync(join(dir, '.security-review', 'evidence'), { recursive: true })
  mkdirSync(join(dir, 'docs', 'security-review'), { recursive: true })
  writeFileSync(join(dir, '.security-review', 'evidence', 'code-analyzer-sfge.json'), JSON.stringify({ violations: [] }))
  writeFileSync(join(dir, 'docs', 'security-review', 'audit-report.md'), '# audit pass 1\nno SOQLi found\n')
  const input = inputOverride || {
    cleared: [
      { req: 'fail-crud-fls', how: 'SFGE clean', loc: '.security-review/evidence/code-analyzer-sfge.json' },
      { req: 'fail-soql-injection', how: 'audit: bound vars only', loc: 'docs/security-review/audit-report.md' },
    ],
    na: [{ req: 'scan-iac-misconfig', how: 'no IaC in repo', loc: '.security-review/run-log.md' }],
  }
  writeFileSync(join(dir, '.security-review', 'evidence-input.json'), JSON.stringify(input))
  return dir
}
function build(dir) {
  return execFileSync('node', [BUILD, '--repo', dir, '--date', '2026-06-17'], { encoding: 'utf8' })
}
function indexOf(dir) {
  return JSON.parse(readFileSync(join(dir, '.security-review', 'evidence', 'index.json'), 'utf8'))
}
const reqEntry = (idx, id) => idx.entries.find((e) => e.ref_type === 'requirement' && e.ref_id === id)

console.log('build-evidence-index standing test')

check('B1 provenance: scanner-backed clear → reproducible+satisfied; audit-report clear → statically-cleared', () => {
  const d = makeRepo(); dirs.push(d)
  build(d)
  const idx = indexOf(d)
  const crud = reqEntry(idx, 'fail-crud-fls')
  assert.equal(crud.disposition, 'satisfied')
  assert.equal(crud.reviewer_reproducible, true, 'SFGE-on-disk clear must be reviewer-reproducible')
  const soql = reqEntry(idx, 'fail-soql-injection')
  assert.equal(soql.disposition, 'statically-cleared', 'audit-report-only clear must be statically-cleared')
  assert.equal(soql.reviewer_reproducible, false)
  const na = reqEntry(idx, 'scan-iac-misconfig')
  assert.equal(na.disposition, 'satisfied')
  assert.equal(na.reviewer_reproducible, true, 'structural N/A is reviewer-confirmable')
})

check('B1b the engine IGNORES an input that tries to assert credit on an audit-only clear', () => {
  // Even if the input lies (reviewer_reproducible:true on a docs/ location), the engine
  // adjudicates from the LOCATION and still marks it statically-cleared.
  const d = makeRepo({
    cleared: [{ req: 'fail-xss', how: 'audit said clean', loc: 'docs/security-review/audit-report.md', reviewer_reproducible: true, disposition: 'satisfied' }],
  }); dirs.push(d)
  build(d)
  const xss = reqEntry(indexOf(d), 'fail-xss')
  assert.equal(xss.disposition, 'statically-cleared', 'engine must not honor an input-asserted credit')
  assert.equal(xss.reviewer_reproducible, false)
})

check('B2 fail-safe: a cleared class pointing at a NON-EXISTENT scanner file → statically-cleared', () => {
  const d = makeRepo({
    cleared: [{ req: 'fail-sharing-model', how: 'SFGE clean', loc: '.security-review/evidence/does-not-exist.json' }],
  }); dirs.push(d)
  build(d)
  const sm = reqEntry(indexOf(d), 'fail-sharing-model')
  assert.equal(sm.disposition, 'statically-cleared', 'a missing scanner file must NOT confer reproducible credit')
  assert.equal(sm.reviewer_reproducible, false)
})

check('B3 end-to-end into compute-sci: only the reproducible clear is credited', () => {
  const d = makeRepo(); dirs.push(d)
  build(d)
  // elements deliberately empty: this pins an arbitrary 3-id applicable set (the
  // property under test is the credit rule, not scope consistency); with an element
  // present, compute-sci's stale-manifest refusal would correctly reject the
  // inconsistent pair (see test-sci.mjs S checks).
  writeFileSync(join(d, '.security-review', 'scope-manifest.json'),
    JSON.stringify({ applicableBaselineIds: ['fail-crud-fls', 'fail-soql-injection', 'scan-iac-misconfig'], elements: [] }))
  writeFileSync(join(d, '.security-review', 'audit-ledger.json'), JSON.stringify({ findings: [] }))
  const out = execFileSync('node', [SCI, '--target', d, '--plugin', PLUGIN, '--date', '2026-06-17', '--json'], { encoding: 'utf8' })
  const j = JSON.parse(out)
  // 2 reviewer-reproducible (fail-crud-fls + scan-iac-misconfig) of 3 applicable; the
  // audit-only fail-soql-injection is statically-cleared, NOT credited.
  assert.equal(j.coverage.satisfied, 2)
  assert.equal(j.coverage.statically_cleared, 1)
  assert.ok(j.statically_cleared_requirements.includes('fail-soql-injection'))
  assert.equal(j.completeness_pct, 67, 'the audit-only clear must not inflate the headline')
})

check('B5 vuln-class N/A credit is SURFACED for review; a structural N/A is not flagged', () => {
  // the engine cannot deterministically reject a (possibly legitimate) "no DML at all"
  // N/A on a fail-* class, but it must not SILENTLY grant it — that would re-open the
  // self-grading hole through the N/A door. It credits + surfaces it for review.
  const d1 = makeRepo({ na: [{ req: 'fail-crud-fls', how: 'no DML in package', loc: '.security-review/run-log.md' }] }); dirs.push(d1)
  const out1 = build(d1)
  assert.match(out1, /N\/A credit granted to auto-fail class/, 'a fail-* N/A must be surfaced')
  assert.match(out1, /fail-crud-fls/)
  assert.equal(reqEntry(indexOf(d1), 'fail-crud-fls').reviewer_reproducible, true, 'still credits — engine cannot reject a structural absence')

  const d2 = makeRepo({ na: [{ req: 'scan-iac-misconfig', how: 'no IaC', loc: '.security-review/run-log.md' }] }); dirs.push(d2)
  assert.doesNotMatch(build(d2), /N\/A credit granted to auto-fail class/, 'a non-vuln structural N/A must NOT trigger the warning')
})

check('B4 determinism: same input + files → byte-identical index.json', () => {
  const d = makeRepo(); dirs.push(d)
  build(d)
  const a = readFileSync(join(d, '.security-review', 'evidence', 'index.json'), 'utf8')
  build(d)
  const b = readFileSync(join(d, '.security-review', 'evidence', 'index.json'), 'utf8')
  assert.equal(a, b)
})

// S1 — the normalize-agent-test evidence fold flows through this engine unchanged.
const AGENT_RESULT = {
  status: 'COMPLETED',
  testCases: [
    { testCaseName: 'ok', testResults: [{ name: 'topic_sequence_match', result: 'PASS', expectedValue: 'T', actualValue: 'T', score: 1 }] },
    { testCaseName: 'misroute', testResults: [{ name: 'topic_sequence_match', result: 'FAILURE', expectedValue: 'T', actualValue: 'U', score: 0 }] },
  ],
}
function makeAgentRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'bei-agent-'))
  mkdirSync(join(dir, 'specs'), { recursive: true })
  mkdirSync(join(dir, '.security-review'), { recursive: true })
  writeFileSync(join(dir, 'specs', 'A-testSpec.yaml'), 'subjectName: A\ntestCases: []\n')
  return dir
}

check('B6 agent-test: spec-only fold ⇒ pending-owner for testenv-agent-testing-center', () => {
  const d = makeAgentRepo(); dirs.push(d)
  const records = parseAgentTestResult(AGENT_RESULT)
  // no result on disk yet — fold produces the pending fragment
  const frag = foldToEvidenceInput(records, { specPath: 'specs/A-testSpec.yaml', resultPath: join('.security-review', 'evidence', 'utterance-validation', 'A-run-eval.json'), repo: d })
  assert.ok(frag.pending, 'spec-only fold must be pending')
  writeFileSync(join(d, '.security-review', 'evidence-input.json'), JSON.stringify(frag))
  build(d)
  const e = reqEntry(indexOf(d), 'testenv-agent-testing-center')
  assert.equal(e.disposition, 'pending-owner', 'no on-disk result ⇒ pending-owner')
  assert.equal(e.reviewer_reproducible, false)
})

check('B7 agent-test: on-disk result ⇒ reviewer-reproducible + satisfied', () => {
  const d = makeAgentRepo(); dirs.push(d)
  const rel = join('.security-review', 'evidence', 'utterance-validation', 'A-run-eval.json')
  mkdirSync(join(d, '.security-review', 'evidence', 'utterance-validation'), { recursive: true })
  writeFileSync(join(d, rel), JSON.stringify(AGENT_RESULT))
  const records = parseAgentTestResult(AGENT_RESULT)
  const frag = foldToEvidenceInput(records, { specPath: 'specs/A-testSpec.yaml', resultPath: rel, repo: d })
  assert.ok(frag.scans, 'a present result must fold to a scans fragment')
  writeFileSync(join(d, '.security-review', 'evidence-input.json'), JSON.stringify(frag))
  build(d)
  const e = reqEntry(indexOf(d), 'testenv-agent-testing-center')
  assert.equal(e.disposition, 'satisfied', 'on-disk agent-test result ⇒ satisfied')
  assert.equal(e.reviewer_reproducible, true, 'a result under .security-review/evidence/ is reviewer-reproducible')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

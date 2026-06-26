#!/usr/bin/env node
/**
 * Standing test for harness/merge-ledger.mjs — the mechanical, incremental ledger merge.
 * HERMETIC: builds a throwaway git repo so the audited_commit stamp is real.
 *
 * Guards:
 *   M1 — pass 1: verdicts map to states; stable dedup id; redaction; first/last_seen=1.
 *   M2 — incremental pass 2: a re-found finding keeps first_seen, advances last_seen;
 *        a NEW finding enters with first_seen=2. The merge is INTO the existing ledger,
 *        not an overwrite (the cold-run improvisation overwrote).
 *   M3 — regression: a `fixed` entry re-found flips to confirmed + regression:true.
 *   M4 — dedup: same file+title at a different line collapses to one entry.
 *   M5 — wrapper: accepts both the bare result and the tool wrapper ({result, agentCount}).
 *   M6 — Track-1b: cross-dimension same-location dupes (different titles) collapse to ONE
 *        entry at the max verified severity, both reasonings retained, counted once.
 *   M7 — Track-1b conservative: same file, DIFFERENT location stays two entries.
 *   M8 — Track-1b incremental: re-running the dupes keeps ONE entry (first_seen=1, last_seen=2).
 *   M9 — collapseCrossDimension is pure + idempotent (collapse(collapse(x)) === collapse(x)).
 *   M10/M11 — OVER-MERGE GUARD (the off-disk-grade regression): same file + same method named in
 *        both titles but NO line spans (M10) / NON-overlapping spans (M11) + different dimensions +
 *        different vulns (high FLS / critical SOQLi) → MUST stay TWO entries, both severities kept.
 *        Fails the build if a same-file-alone / title-symbol merge ever returns.
 *   M12 — real-Solano shape: 3 dimensions, overlapping line spans (:21-2x) → ONE entry, 3 lenses.
 *   M13 — UNWRAP LOCK: a RAW Workflow task-output envelope {summary, result:{ledger_updates}, workflowProgress}
 *         merges IDENTICALLY to a pre-extracted {ledger_updates} — locks the line-59 unwrap so the skill's
 *         "point --result DIRECTLY at the raw task-output file" promise can't silently regress.
 *   M14 — a --result with NO ledger_updates (neither accepted shape) → exit 2 with a CLEAR error naming
 *         BOTH shapes (raw Workflow envelope vs pre-extracted result), never a silent empty merge.
 *
 * Dependency-free: `node acceptance/test-merge-ledger.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { collapseCrossDimension } from '../harness/finding-clusters.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const MERGE = join(PLUGIN, 'harness', 'merge-ledger.mjs')

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'merge-test-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t.t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  writeFileSync(join(dir, 'f.txt'), 'x')
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })
  mkdirSync(join(dir, '.security-review'), { recursive: true })
  return dir
}
function runMerge(dir, result, passN = 1) {
  const rp = join(dir, '.security-review', `result-${passN}.json`)
  writeFileSync(rp, JSON.stringify(result))
  execFileSync('node', [MERGE, '--repo', dir, '--result', rp, '--date', '2026-06-17', '--pass', String(passN), '--tier', 'standard'], { encoding: 'utf8' })
  return JSON.parse(readFileSync(join(dir, '.security-review', 'audit-ledger.json'), 'utf8'))
}
const u = (o) => ({ verdict: 'confirmed_real', dimension: 'crypto-internals', finder_severity: 'high', adjusted_severity: 'high', verdict_reasoning: 'reasoned', evidence: 'snippet', exploit_scenario: 'x', recommendation: 'fix it', ...o })

console.log('merge-ledger standing test')

check('M1 pass 1: verdict→state, stable id, first/last_seen=1, run echoes commit', () => {
  const d = gitRepo(); dirs.push(d)
  const l = runMerge(d, { ledger_updates: [
    u({ file: 'server/index.js:13', title: 'JWT verify without algorithm allowlist' }),
    u({ verdict: 'false_positive', file: 'a.cls:5', title: 'SOQL injection in getRows', verdict_reasoning: 'bound variable only' }),
  ], dimensions_run: ['crypto-internals'], total_candidates: 2 })
  assert.equal(l.findings.length, 2)
  const jwt = l.findings.find((f) => f.title.startsWith('JWT'))
  assert.equal(jwt.status, 'confirmed')
  assert.match(jwt.id, /^[0-9a-f]{16}$/)
  assert.equal(jwt.first_seen, 1)
  assert.equal(jwt.last_seen, 1)
  assert.equal(jwt.file, 'server/index.js:13')
  assert.equal(l.findings.find((f) => f.title.startsWith('SOQL')).status, 'refuted')
  assert.equal(l.passes[0].confirmed, 1)
  assert.equal(l.passes[0].refuted, 1)
  assert.ok(l.passes[0].audited_commit && l.passes[0].audited_commit.length >= 7)
})

check('M2 incremental: re-found keeps first_seen=1/last_seen=2; new finding first_seen=2', () => {
  const d = gitRepo(); dirs.push(d)
  runMerge(d, { ledger_updates: [u({ file: 'server/index.js:13', title: 'JWT verify without algorithm allowlist' })], dimensions_run: ['crypto-internals'], total_candidates: 1 }, 1)
  const l = runMerge(d, { ledger_updates: [
    u({ file: 'server/index.js:13', title: 'JWT verify without algorithm allowlist' }),
    u({ file: 'b.cls:9', title: 'Missing CRUD check on update', dimension: 'apex-exposed-surface' }),
  ], dimensions_run: ['crypto-internals', 'apex-exposed-surface'], total_candidates: 2 }, 2)
  assert.equal(l.findings.length, 2, 'must merge INTO the ledger, not overwrite')
  const jwt = l.findings.find((f) => f.title.startsWith('JWT'))
  assert.equal(jwt.first_seen, 1)
  assert.equal(jwt.last_seen, 2)
  const crud = l.findings.find((f) => f.title.startsWith('Missing CRUD'))
  assert.equal(crud.first_seen, 2)
  assert.equal(l.passes.length, 2)
})

check('M3 regression: a fixed entry re-found flips to confirmed + regression:true', () => {
  const d = gitRepo(); dirs.push(d)
  const l1 = runMerge(d, { ledger_updates: [u({ file: 'server/index.js:13', title: 'JWT verify without algorithm allowlist' })], dimensions_run: ['crypto-internals'], total_candidates: 1 }, 1)
  // mark it fixed by hand (as a remediation step would)
  const lp = join(d, '.security-review', 'audit-ledger.json')
  const led = JSON.parse(readFileSync(lp, 'utf8'))
  led.findings[0].status = 'fixed'; led.findings[0].fix_commit = 'abc1234'
  writeFileSync(lp, JSON.stringify(led))
  const l = runMerge(d, { ledger_updates: [u({ file: 'server/index.js:13', title: 'JWT verify without algorithm allowlist' })], dimensions_run: ['crypto-internals'], total_candidates: 1 }, 2)
  const jwt = l.findings[0]
  assert.equal(jwt.status, 'confirmed')
  assert.equal(jwt.regression, true)
  assert.equal(jwt.last_seen, 2)
})

check('M4 dedup: same file+title at a different line → one entry', () => {
  const d = gitRepo(); dirs.push(d)
  const l = runMerge(d, { ledger_updates: [
    u({ file: 'server/index.js:13', title: 'JWT verify without algorithm allowlist' }),
    u({ file: 'server/index.js:99', title: 'JWT verify without algorithm allowlist' }),
  ], dimensions_run: ['crypto-internals'], total_candidates: 2 })
  assert.equal(l.findings.length, 1, 'line-only difference must not create a second finding')
})

check('M4b redaction: a secret value in evidence is redacted, the name is kept', () => {
  const d = gitRepo(); dirs.push(d)
  const l = runMerge(d, { ledger_updates: [
    u({ file: 'server/index.js:5', title: 'hardcoded token', evidence: 'const t = "abcd1234efgh5678"; token = "abcd1234efgh5678"' }),
  ], dimensions_run: ['secrets-credentials'], total_candidates: 1 })
  const f = l.findings[0]
  assert.match(f.evidence, /redacted/, 'secret value must be redacted')
  assert.doesNotMatch(f.evidence, /abcd1234efgh5678(?!")/, 'raw secret must not survive in the assignment form')
})

check('M5 wrapper: accepts the tool wrapper {result, agentCount}', () => {
  const d = gitRepo(); dirs.push(d)
  const l = runMerge(d, { result: { ledger_updates: [u({ file: 'x.js:1', title: 'a finding' })], dimensions_run: ['crypto-internals'], total_candidates: 1 }, agentCount: 7 })
  assert.equal(l.findings.length, 1)
  assert.equal(l.findings[0].status, 'confirmed')
})

check('M6 Track-1b: cross-dimension same-location dupes collapse to ONE entry at the max severity', () => {
  const d = gitRepo(); dirs.push(d)
  const l = runMerge(d, { ledger_updates: [
    u({ file: 'classes/SolanoOpportunityController.cls:25', title: 'Missing FLS enforcement on getOpportunityDetail', dimension: 'apex-exposed-surface', finder_severity: 'high', adjusted_severity: 'high', verdict_reasoning: 'no WITH USER_MODE on the SELECT', evidence: 'SELECT Id, Amount FROM Opportunity (no FLS)' }),
    u({ file: 'classes/SolanoOpportunityController.cls:25', title: 'Opportunity fields returned to the LWC without field-level security', dimension: 'web-client', finder_severity: 'low', adjusted_severity: 'low', verdict_reasoning: 'fields reach the component unredacted', evidence: 'return new OpportunityView(o)' }),
  ], dimensions_run: ['apex-exposed-surface', 'web-client'], total_candidates: 2 })
  assert.equal(l.findings.length, 1, 'one root cause → one ledger entry')
  const f = l.findings[0]
  assert.equal(f.adjusted_severity, 'high', 'highest verified severity wins')
  assert.deepEqual(f.merged_dimensions, ['apex-exposed-surface', 'web-client'])
  assert.equal(f.dimension, 'apex-exposed-surface', 'base = highest-severity lens')
  assert.equal(Array.isArray(f.lenses) && f.lenses.length, 2)
  assert.match(f.verdict_reasoning, /WITH USER_MODE/, 'apex lens reasoning retained')
  assert.match(f.verdict_reasoning, /unredacted/, 'web-client lens reasoning retained')
  assert.equal(l.passes[0].confirmed, 1, 'one root cause counted once, not twice')
})

check('M7 Track-1b conservative: same file, DIFFERENT location → stays two entries', () => {
  const d = gitRepo(); dirs.push(d)
  const l = runMerge(d, { ledger_updates: [
    u({ file: 'classes/Foo.cls:25', title: 'Missing FLS on the read path', dimension: 'apex-exposed-surface', adjusted_severity: 'high' }),
    u({ file: 'classes/Foo.cls:200', title: 'Open redirect in the save handler', dimension: 'web-client', adjusted_severity: 'medium' }),
  ], dimensions_run: ['apex-exposed-surface', 'web-client'], total_candidates: 2 })
  assert.equal(l.findings.length, 2, 'non-overlapping lines + no shared symbol must stay separate')
})

check('M8 Track-1b incremental: re-running the dupes keeps ONE entry, first_seen=1/last_seen=2', () => {
  const d = gitRepo(); dirs.push(d)
  const up = [
    u({ file: 'x.cls:10', title: 'A: missing FLS in loadThing', dimension: 'apex-exposed-surface', adjusted_severity: 'high', verdict_reasoning: 'apex reason' }),
    u({ file: 'x.cls:10', title: 'B: field exposure in loadThing', dimension: 'web-client', adjusted_severity: 'low', verdict_reasoning: 'web reason' }),
  ]
  runMerge(d, { ledger_updates: up, dimensions_run: ['apex-exposed-surface', 'web-client'], total_candidates: 2 }, 1)
  const l = runMerge(d, { ledger_updates: up, dimensions_run: ['apex-exposed-surface', 'web-client'], total_candidates: 2 }, 2)
  assert.equal(l.findings.length, 1, 'still one merged entry after re-run')
  const f = l.findings[0]
  assert.equal(f.first_seen, 1, 'earliest first_seen preserved')
  assert.equal(f.last_seen, 2)
  assert.equal(f.adjusted_severity, 'high')
  assert.equal(f.lenses.length, 2, 'both lenses survive the incremental re-run')
})

check('M9 collapseCrossDimension is pure + idempotent', () => {
  const F = [
    { id: 'a'.repeat(16), dimension: 'apex-exposed-surface', title: 'X getFoo', file: 'p.cls:5', adjusted_severity: 'high', status: 'confirmed', verdict: 'confirmed_real', verdict_reasoning: 'r1', evidence: 'e1', first_seen: 1, last_seen: 1 },
    { id: 'b'.repeat(16), dimension: 'web-client', title: 'Y getFoo', file: 'p.cls:5', adjusted_severity: 'low', status: 'confirmed', verdict: 'confirmed_real', verdict_reasoning: 'r2', evidence: 'e2', first_seen: 1, last_seen: 1 },
    { id: 'c'.repeat(16), dimension: 'crypto-internals', title: 'unrelated bug', file: 'q.js:9', adjusted_severity: 'medium', status: 'confirmed', verdict: 'confirmed_real', verdict_reasoning: 'r3', evidence: 'e3', first_seen: 1, last_seen: 1 },
  ]
  const once = collapseCrossDimension(F)
  const twice = collapseCrossDimension(once)
  assert.equal(once.length, 2, 'two location-dupes merge; the unrelated stays')
  assert.equal(JSON.stringify(twice), JSON.stringify(once), 'collapse(collapse(x)) === collapse(x)')
  const merged = once.find((f) => f.merged_dimensions)
  assert.equal(merged.adjusted_severity, 'high')
  assert.deepEqual(merged.merged_dimensions, ['apex-exposed-surface', 'web-client'])
  assert.match(merged.verdict_reasoning, /r1/)
  assert.match(merged.verdict_reasoning, /r2/)
})

check('M10 OVER-MERGE GUARD: same file + same method in both titles, NO line spans → stays TWO entries', () => {
  const d = gitRepo(); dirs.push(d)
  const l = runMerge(d, { ledger_updates: [
    u({ file: 'classes/Acct.cls', title: 'FLS gap in Acct.getDetail', dimension: 'apex-exposed-surface', finder_severity: 'high', adjusted_severity: 'high', verdict_reasoning: 'no FLS on the read' }),
    u({ file: 'classes/Acct.cls', title: 'SOQL injection in Acct.getDetail', dimension: 'injection-xss', finder_severity: 'critical', adjusted_severity: 'critical', verdict_reasoning: 'string-built WHERE clause' }),
  ], dimensions_run: ['apex-exposed-surface', 'injection-xss'], total_candidates: 2 })
  assert.equal(l.findings.length, 2, 'two DISTINCT vulns sharing a method name (no spans) must NOT merge')
  const sevs = l.findings.map((f) => f.adjusted_severity).sort()
  assert.deepEqual(sevs, ['critical', 'high'], 'both severities preserved (no max-collapse)')
  assert.ok(l.findings.every((f) => !f.merged_dimensions), 'no entry may be a cross-dimension merge')
})

check('M11 OVER-MERGE GUARD: same file + same method in both titles, NON-overlapping spans → stays TWO entries', () => {
  const d = gitRepo(); dirs.push(d)
  const l = runMerge(d, { ledger_updates: [
    u({ file: 'classes/Acct.cls:10-15', title: 'FLS gap in Acct.getDetail', dimension: 'apex-exposed-surface', finder_severity: 'high', adjusted_severity: 'high' }),
    u({ file: 'classes/Acct.cls:40-45', title: 'SOQL injection in Acct.getDetail', dimension: 'injection-xss', finder_severity: 'critical', adjusted_severity: 'critical' }),
  ], dimensions_run: ['apex-exposed-surface', 'injection-xss'], total_candidates: 2 })
  assert.equal(l.findings.length, 2, ':10-15 vs :40-45 do not overlap → must stay separate')
  assert.deepEqual(l.findings.map((f) => f.adjusted_severity).sort(), ['critical', 'high'])
})

check('M12 real-Solano shape: 3 dimensions at overlapping spans (:21-2x) → ONE entry, 3 lenses, max severity', () => {
  const d = gitRepo(); dirs.push(d)
  const l = runMerge(d, { ledger_updates: [
    u({ file: 'classes/SolanoCtl.cls:21-25', title: 'Missing FLS on the SELECT', dimension: 'apex-exposed-surface', finder_severity: 'high', adjusted_severity: 'high', verdict_reasoning: 'no WITH USER_MODE' }),
    u({ file: 'classes/SolanoCtl.cls:21-23', title: 'PII fields returned to the LWC unredacted', dimension: 'web-client', finder_severity: 'medium', adjusted_severity: 'medium', verdict_reasoning: 'fields reach the component' }),
    u({ file: 'classes/SolanoCtl.cls:22-24', title: 'Contact fields exported without FLS', dimension: 'data-export', finder_severity: 'low', adjusted_severity: 'low', verdict_reasoning: 'export path lacks the check' }),
  ], dimensions_run: ['apex-exposed-surface', 'web-client', 'data-export'], total_candidates: 3 })
  assert.equal(l.findings.length, 1, 'three lenses of one root cause at overlapping spans → one entry')
  const f = l.findings[0]
  assert.equal(f.adjusted_severity, 'high', 'highest verified severity across the three lenses')
  assert.deepEqual(f.merged_dimensions, ['apex-exposed-surface', 'data-export', 'web-client'])
  assert.equal(f.lenses.length, 3)
  assert.equal(l.passes[0].confirmed, 1, 'one root cause counted once, not three times')
})

check('M13 unwrap-lock: a RAW Workflow envelope merges IDENTICALLY to a pre-extracted result', () => {
  const updates = [
    u({ file: 'server/index.js:13', title: 'JWT verify without algorithm allowlist' }),
    u({ verdict: 'false_positive', file: 'a.cls:5', title: 'SOQL injection in getRows', verdict_reasoning: 'bound variable only' }),
    u({ file: 'classes/SolanoCtl.cls:21-25', title: 'Missing FLS on the SELECT', dimension: 'apex-exposed-surface', verdict_reasoning: 'no WITH USER_MODE' }),
  ]
  const inner = { ledger_updates: updates, dimensions_run: ['crypto-internals', 'apex-exposed-surface'], total_candidates: 3 }
  // (1) feed it as the RAW Workflow task-output envelope — point --result at the file AS-IS.
  const dEnv = gitRepo(); dirs.push(dEnv)
  const env = runMerge(dEnv, { summary: 'Audit workflow completed', result: inner, workflowProgress: { phases: [] }, agentCount: 9 })
  // (2) feed the SAME updates already pre-extracted.
  const dRaw = gitRepo(); dirs.push(dRaw)
  const raw = runMerge(dRaw, inner)
  // The merged FINDINGS must be byte-identical (the per-repo audited_commit lives in passes[], not findings),
  // so the line-59 unwrap genuinely makes "point --result at the raw envelope" equivalent to hand-extracting.
  assert.equal(JSON.stringify(env.findings), JSON.stringify(raw.findings),
    'the line-59 unwrap must make the raw envelope merge identically to the pre-extracted result')
  assert.ok(env.findings.length >= 2 && env.passes[0].confirmed >= 1, 'the envelope path produced a real merge, not a silent empty')
})

check('M14 clear error: a --result with no ledger_updates (neither shape) → exit 2 naming BOTH shapes', () => {
  const d = gitRepo(); dirs.push(d)
  const rp = join(d, '.security-review', 'bad-result.json')
  writeFileSync(rp, JSON.stringify({ summary: 'oops', workflowProgress: {}, notTheRightShape: true }))
  let err = null
  try { execFileSync('node', [MERGE, '--repo', d, '--result', rp, '--date', '2026-06-17', '--pass', '1', '--tier', 'standard'], { stdio: 'pipe', encoding: 'utf8' }) }
  catch (e) { err = e }
  assert.ok(err, 'must exit non-zero on a shape with no ledger_updates')
  assert.equal(err.status, 2, 'exit code 2')
  const msg = String(err.stderr || '')
  assert.match(msg, /ledger_updates/, 'error names the missing key')
  assert.match(msg, /Workflow task-output envelope/i, 'error names the raw-envelope shape')
  assert.match(msg, /pre-extracted/i, 'error names the pre-extracted shape')
})

check('M15 corruption guard: a PRESENT-but-non-array prior `findings` (dict) → exit 2, LOUD warning, on-disk ledger UNTOUCHED (never a silent drop)', () => {
  const d = gitRepo(); dirs.push(d)
  // Seed a CORRUPTED prior ledger: `findings` is a DICT (a hand-edit / out-of-band write), not an
  // array. The OLD code silently coerced it to [] then overwrote the file → silent false-clean.
  const lp = join(d, '.security-review', 'audit-ledger.json')
  const corrupt = { schema_version: '1', findings: { 'apex.fls': { severity: 'high' } }, passes: [{ id: 1 }] }
  writeFileSync(lp, JSON.stringify(corrupt))
  // A perfectly valid result for THIS pass — the merge must STILL refuse because of the prior corruption.
  const rp = join(d, '.security-review', 'result-1.json')
  writeFileSync(rp, JSON.stringify({ ledger_updates: [u({ file: 'x.cls:1', title: 'a finding' })], dimensions_run: ['apex-exposed-surface'], total_candidates: 1 }))
  let err = null
  try { execFileSync('node', [MERGE, '--repo', d, '--result', rp, '--date', '2026-06-17', '--pass', '1', '--tier', 'standard'], { stdio: 'pipe', encoding: 'utf8' }) }
  catch (e) { err = e }
  assert.ok(err, 'must exit non-zero on a corrupted prior ledger, never silently drop it')
  assert.equal(err.status, 2, 'exit code 2')
  const msg = String(err.stderr || '')
  assert.match(msg, /\[merge-ledger\] WARNING/, 'a LOUD stderr warning fires (never silent)')
  assert.match(msg, /not an array/i, 'the warning names the corruption (non-array findings)')
  assert.match(msg, /refusing to silently drop/i, 'states it refuses to drop the prior findings')
  // The on-disk ledger is LEFT UNTOUCHED (not overwritten with an empty/clean one) so it can be restored.
  assert.deepEqual(JSON.parse(readFileSync(lp, 'utf8')), corrupt, 'the corrupted ledger on disk is preserved, never overwritten')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

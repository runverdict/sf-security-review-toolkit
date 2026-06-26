#!/usr/bin/env node
/**
 * Standing test for the VERBATIM finding-cluster triage headline
 * (harness/finding-clusters.mjs `renderClusterHeadline` + `--headline`, WI-04 / INV-08).
 * This is the FAILURE VERDICT — an open critical/high halts the run — so it must read
 * IDENTICALLY at the two sites that print it (audit-codebase Step 6 exec summary +
 * security-review-journey blocker gate). This pins the block.
 *
 * FH1  determinism — same cluster twice → byte-identical (function + CLI).
 * FH2  PRESENT — raw per-severity counts FIRST, then the clustered distinct-file table,
 *      then the headline narrative verbatim (fixed order).
 * FH3  NONE — 0 open confirmed → the false-negative-aware "nothing new" line, NO table.
 * FH4  UNAVAILABLE — null/bad input → an honest "could not read" line, never a fake clean.
 * FH5  HONESTY — never "secure"/"will pass"/"passed"; the pen-test caveat on the non-PRESENT
 *      branches.
 * FH6  WIRING — BOTH consuming skills grant + reference `finding-clusters.mjs --headline`,
 *      say "verbatim", and assert the two sites read identically.
 *
 * Dependency-free: `node acceptance/test-finding-clusters-headline.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { clusterFindings, renderClusterHeadline, clusterOrNullFromFindings } from '../harness/finding-clusters.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'finding-clusters.mjs')

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) } }
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'fc-headline-')); dirs.push(d); return d }

// One root cause on one file from three dimensions + a second file — the classic shape.
const FINDINGS = [
  { id: '1', dimension: 'apex-exposed-surface', status: 'confirmed', adjusted_severity: 'high', file: 'force-app/classes/Svc.cls:5' },
  { id: '2', dimension: 'web-client', status: 'confirmed', adjusted_severity: 'critical', file: 'force-app/classes/Svc.cls:13' },
  { id: '4', dimension: 'oauth-identity', status: 'confirmed', adjusted_severity: 'high', file: 'server/index.js:13' },
]

console.log('finding-cluster headline standing test')

check('FH1 determinism: same cluster twice → byte-identical (fn + CLI)', () => {
  const c = clusterFindings(FINDINGS)
  assert.equal(renderClusterHeadline(c), renderClusterHeadline(c))
  const d = tmp()
  mkdirSync(join(d, '.security-review'), { recursive: true })
  writeFileSync(join(d, '.security-review', 'audit-ledger.json'), JSON.stringify({ findings: FINDINGS }))
  const a = execFileSync('node', [CLI, '--target', d, '--headline'], { encoding: 'utf8' })
  const b = execFileSync('node', [CLI, '--target', d, '--format', 'md'], { encoding: 'utf8' })
  assert.equal(a, b, '--headline and --format md are the same block')
})

check('FH2 PRESENT: raw counts FIRST, then the clustered table, then the headline narrative', () => {
  const block = renderClusterHeadline(clusterFindings(FINDINGS))
  assert.match(block, /### Finding triage — cluster view/)
  // raw per-severity counts, fixed canonical order
  assert.match(block, /\*\*Raw confirmed findings: 3\*\* \(critical 1 · high 2 · medium 0 · low 0 · info 0\) across 3 dimension\(s\)\./)
  // ORDER: raw counts strictly BEFORE the clustered view (the gating count is never hidden)
  const rawIdx = block.indexOf('Raw confirmed findings')
  const clusterIdx = block.indexOf('Clustered (distinct affected files')
  assert.ok(rawIdx >= 0 && clusterIdx > rawIdx, 'raw counts render before the clustered view')
  // the clustered distinct-file table with its locked rows
  assert.match(block, /\| Metric \| Count \|/)
  assert.match(block, /\| Distinct affected files \| 2 \|/)
  assert.match(block, /\| Files topping out at critical \| 1 \|/)
  assert.match(block, /\| Files topping out at high \| 1 \|/)
  assert.match(block, /\| Files with cross-dimension overlap \| 1 \|/)
  // the headline narrative verbatim (its lower-bound caveat is the single source)
  assert.match(block, /lower bound on distinct issues/)
})

check('FH3 NONE: 0 open confirmed → honest "nothing new" line, NO table', () => {
  const block = renderClusterHeadline(clusterFindings([]))
  assert.match(block, /\*\*No open confirmed findings\.\*\*/)
  assert.ok(!/\| Metric \| Count \|/.test(block), 'the NONE branch renders no table')
  assert.match(block, /does NOT bound false negatives/)
})

check('FH4 UNAVAILABLE: null / bad input → honest "could not read", never a fake clean', () => {
  for (const bad of [null, undefined, 42, 'x', {}]) {
    const block = renderClusterHeadline(bad)
    assert.match(block, /Finding cluster view unavailable/)
    assert.match(block, /NOT a clean result/)
  }
  // the CLI on a genuinely missing ledger renders the UNAVAILABLE branch (not "no findings")
  const out = execFileSync('node', [CLI, '--target', join(tmp(), 'does-not-exist'), '--headline'], { encoding: 'utf8' })
  assert.match(out, /Finding cluster view unavailable/)
})

check('FH5 HONESTY: never will-pass/passed; pen-test caveat on non-PRESENT branches', () => {
  for (const block of [renderClusterHeadline(clusterFindings([])), renderClusterHeadline(null)]) {
    assert.ok(!/\bwill pass\b/i.test(block), 'never "will pass"')
    assert.ok(!/\bpassed\b/i.test(block), 'never "passed"')
    assert.match(block, /Salesforce performs its own penetration test regardless/)
  }
  // the NONE branch explicitly refuses the "secure"/"clean" framing (a negation, not a claim)
  assert.match(renderClusterHeadline(clusterFindings([])), /never "secure"\/"clean"/)
})

check('FH7 dict-vs-array guard (rule-8 corollary): a PRESENT-but-non-array findings → UNAVAILABLE, never NONE', () => {
  // a dict-shaped `findings` (e.g. {factor:{...}}) is an UNREADABLE shape, NOT "no findings"
  assert.equal(clusterOrNullFromFindings({ factor: { x: 1 } }), null, 'dict findings → null cluster (UNAVAILABLE)')
  // a legitimate empty array stays a real 0-count cluster (NONE), NOT UNAVAILABLE
  const emptyCluster = clusterOrNullFromFindings([])
  assert.ok(emptyCluster !== null && emptyCluster.confirmed_count === 0, 'empty array → a 0-count cluster, not null')
  const block = renderClusterHeadline(clusterOrNullFromFindings({ factor: {} }))
  assert.match(block, /Finding cluster view unavailable/, 'dict findings render UNAVAILABLE')
  assert.ok(!/No open confirmed findings/.test(block), 'NEVER reads as "no findings" for a malformed-but-present ledger')
  // the CLI on a ledger whose `findings` is a dict → UNAVAILABLE, never a false clean
  const d = tmp(); mkdirSync(join(d, '.security-review'), { recursive: true })
  writeFileSync(join(d, '.security-review', 'audit-ledger.json'), JSON.stringify({ findings: { factor: { sev: 'critical' } } }))
  const out = execFileSync('node', [CLI, '--target', d, '--headline'], { encoding: 'utf8' })
  assert.match(out, /Finding cluster view unavailable/)
  assert.ok(!/No open confirmed findings/.test(out), 'CLI never reports a dict ledger as "no findings"')
})

check('FH6 WIRING: both skills grant + reference --headline, say verbatim, claim identical at both sites', () => {
  const audit = readFileSync(join(PLUGIN, 'skills', 'audit-codebase', 'SKILL.md'), 'utf8')
  const journey = readFileSync(join(PLUGIN, 'skills', 'security-review-journey', 'SKILL.md'), 'utf8')
  for (const [name, skill] of [['audit-codebase', audit], ['security-review-journey', journey]]) {
    assert.match(skill, /Bash\(node \*harness\/finding-clusters\.mjs \*\)/, `${name} grants finding-clusters`)
    assert.match(skill, /finding-clusters\.mjs --target <target> --headline/, `${name} calls --headline`)
    assert.match(skill, /verbatim/i, `${name} states the verbatim contract`)
    assert.match(skill, /identical/i, `${name} asserts the headline reads identically at both sites`)
  }
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

#!/usr/bin/env node
/**
 * Standing test for deterministic finding clustering (harness/finding-clusters.mjs).
 * Guards the cold-start finding: cross-dimension overlap must not inflate the
 * triage headline. Same root cause on one file from several dimensions collapses
 * to one cluster at its MAX severity; non-open entries are excluded.
 *
 * Dependency-free: `node acceptance/test-finding-clusters.mjs`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clusterFindings, renderReachabilityPath } from '../harness/finding-clusters.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))

let pass = 0, fail = 0
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

console.log('finding-clusters standing test')

// The without-sharing root cause: one file, three dimensions, mixed severities.
const withoutSharing = [
  { id: '1', dimension: 'apex-exposed-surface', status: 'confirmed', adjusted_severity: 'high', file: 'force-app/classes/Svc.cls:5' },
  { id: '2', dimension: 'web-client', status: 'confirmed', adjusted_severity: 'critical', file: 'force-app/classes/Svc.cls:13' },
  { id: '3', dimension: 'package-metadata', status: 'confirmed', adjusted_severity: 'high', file: 'force-app/classes/Svc.cls' },
]
// The JWT root cause: one file, two dimensions.
const jwt = [
  { id: '4', dimension: 'oauth-identity', status: 'confirmed', adjusted_severity: 'high', file: 'server/index.js:13' },
  { id: '5', dimension: 'crypto-internals', status: 'confirmed', adjusted_severity: 'critical', file: 'server/index.js:13' },
]

check('cross-dimension overlap collapses to one cluster per file at max severity', () => {
  const r = clusterFindings([...withoutSharing, ...jwt])
  assert.equal(r.confirmed_count, 5)
  assert.equal(r.by_severity.critical, 2) // raw
  assert.equal(r.by_severity.high, 3) // raw
  assert.equal(r.distinct_files, 2) // collapsed
  assert.equal(r.distinct_critical_files, 2) // each file's max severity is critical
  assert.equal(r.distinct_high_files, 0) // no file tops out at high — both top at critical
  assert.equal(r.multi_dimension_overlap.length, 2) // both files carry overlap
})

check('a single-dimension single-file finding is not flagged as overlap', () => {
  const r = clusterFindings([{ id: 'x', dimension: 'injection-xss', status: 'confirmed', adjusted_severity: 'medium', file: 'a.js:1' }])
  assert.equal(r.distinct_files, 1)
  assert.equal(r.multi_dimension_overlap.length, 0)
})

check('non-open entries (refuted/fixed/accepted_risk) are excluded', () => {
  const r = clusterFindings([
    { id: 'a', dimension: 'oauth-identity', status: 'refuted', adjusted_severity: 'critical', file: 'x.js:1' },
    { id: 'b', dimension: 'oauth-identity', status: 'fixed', adjusted_severity: 'critical', file: 'x.js:1' },
    { id: 'c', dimension: 'oauth-identity', status: 'accepted_risk', adjusted_severity: 'critical', file: 'x.js:1' },
  ])
  assert.equal(r.confirmed_count, 0)
  assert.equal(r.distinct_files, 0)
})

check('headline reports both raw and clustered counts honestly', () => {
  const r = clusterFindings([...withoutSharing, ...jwt])
  assert.match(r.headline, /5 confirmed findings/)
  assert.match(r.headline, /2 distinct affected file/)
  assert.match(r.headline, /lower bound/)
})

// ---- 0.8.71 — RGP: reachability-path rendering into the LLM-facing surfaces ----
// The renderer relays the machine-verified taint path (locations only) to the verifier
// prompt + the finder-facing ledger digest. Contract: PURE, TOTAL, '' on anything less
// than BOTH proven ends, never a throw.

check('RGP-render: full source → intermediates → sink renders the exact one-line path', () => {
  const path = {
    source: { file: 'server/routes/in.js', line: 3 },
    intermediate: [{ file: 'server/lib/mid.js', line: 7 }, { file: 'server/lib/mid2.js', line: 11 }],
    sink: { file: 'server/db/out.js', line: 9 },
  }
  assert.equal(
    renderReachabilityPath(path),
    'source server/routes/in.js:3 → server/lib/mid.js:7 → server/lib/mid2.js:11 → sink server/db/out.js:9'
  )
})

check('RGP-render: {source,sink} with empty or absent intermediate renders source → sink', () => {
  const ends = { source: { file: 'a.js', line: 1 }, sink: { file: 'b.js', line: 2 } }
  assert.equal(renderReachabilityPath({ ...ends, intermediate: [] }), 'source a.js:1 → sink b.js:2')
  assert.equal(renderReachabilityPath(ends), 'source a.js:1 → sink b.js:2')
})

check('RGP-render: a finding carrying reachabilityPath renders its nested path; malformed middle steps are skipped', () => {
  const f = {
    title: 'T', file: 'a.js:1',
    reachabilityPath: {
      source: { file: 'in.js', line: 3 },
      intermediate: [null, { bogus: 1 }, { file: 'mid.js', line: 7 }, { file: '', line: 4 }],
      sink: { file: 'out.js', line: 9 },
    },
  }
  assert.equal(renderReachabilityPath(f), 'source in.js:3 → mid.js:7 → sink out.js:9')
})

check("RGP-render: one-ended / malformed / absent input renders '' and NEVER throws", () => {
  const src = { file: 'a.js', line: 1 }
  const garbage = [
    null, undefined, 42, 'source a.js:1', [], {}, { source: src }, { sink: src },
    { source: src, sink: null }, { source: null, sink: src },
    { source: 'a.js:1', sink: 'b.js:2' },
    { source: { file: 'a.js' }, sink: src },
    { source: { file: 'a.js', line: 0 }, sink: src },
    { source: { file: 'a.js', line: 1.5 }, sink: src },
    { source: { file: '', line: 1 }, sink: src },
    { title: 'no path at all', file: 'a.js:1' },
    { reachabilityPath: 'not-an-object' },
    { reachabilityPath: { source: src } },
    { reachabilityPath: [] },
  ]
  for (const g of garbage) {
    let out
    assert.doesNotThrow(() => { out = renderReachabilityPath(g) }, `must not throw on ${JSON.stringify(g)}`)
    assert.equal(out, '', `must render '' for ${JSON.stringify(g)}`)
  }
})

check('RGP-skill: audit-codebase Step 4b instructs embedding the machine-verified path into the digest via renderReachabilityPath', () => {
  const skill = readFileSync(join(PLUGIN, 'skills', 'audit-codebase', 'SKILL.md'), 'utf8')
  const a = skill.indexOf('4b.'), b = skill.indexOf('\n5. ')
  assert.ok(a > 0 && b > a, 'Step 4b and Step 5 anchors must exist in SKILL.md')
  const step4b = skill.slice(a, b)
  assert.match(step4b, /reachabilityPath/, 'Step 4b must name the reachabilityPath attribute')
  assert.match(step4b, /renderReachabilityPath/, 'Step 4b must render via renderReachabilityPath (mechanical, never a re-word)')
  assert.match(step4b, /provenance: ?'deterministic'/, "Step 4b must scope the path line to provenance:'deterministic' entries")
  assert.match(step4b, /attacker-controlled/, 'Step 4b must carry the source-trust framing (the path is proven; judge the source)')
  assert.match(step4b, /never paraphrase/i, 'Step 4b must keep the digest mechanical (no LLM re-write of the path)')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

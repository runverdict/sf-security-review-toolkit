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
import { clusterFindings } from '../harness/finding-clusters.mjs'

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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

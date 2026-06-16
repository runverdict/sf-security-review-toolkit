#!/usr/bin/env node
/**
 * Standing test for the generate-artifacts gate (harness/artifact-gate.mjs).
 *
 * This is the regression guard for the cold-start finding that the
 * open-critical/high hard stop + AuthN/AuthZ suppression was bypassable on a
 * resume-into-artifacts path. The gate is now enforced logic; this test proves
 * the decision is correct on EVERY entry path (it is a pure function of the
 * ledger + the persisted triage election, so a fresh run, a resume, and a
 * direct invocation all get the same verdict).
 *
 * Dependency-free: `node acceptance/test-artifact-gate.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { computeGate } from '../harness/artifact-gate.mjs'

let pass = 0
let fail = 0
function check(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

const f = (over) => ({ id: 'x', dimension: 'apex-exposed-surface', status: 'confirmed', adjusted_severity: 'critical', ...over })
const ELECT = { decision: 'continue-with-flags' }
const FIXFIRST = { decision: 'fix-first' }

console.log('artifact-gate standing test')

// 1. The exact run-2 failure case: open critical in an authZ dimension, NO
//    election persisted → must STOP (not generate).
check('open critical authZ + no election → STOP, no generation', () => {
  const r = computeGate([f({ dimension: 'oauth-identity' })], null)
  assert.equal(r.mode, 'STOP')
  assert.equal(r.proceed, false)
  assert.deepEqual(r.suppress, [])
})

// 2. Same ledger + a persisted continue-with-flags election → flagged mode,
//    proceeds BUT withholds the AuthN/AuthZ flow (the doc that would map the hole).
check('open authZ + continue-with-flags → flagged, withhold authn-authz-flow', () => {
  const r = computeGate([f({ dimension: 'oauth-identity' })], ELECT)
  assert.equal(r.mode, 'flagged')
  assert.equal(r.proceed, true)
  assert.deepEqual(r.suppress, ['authn-authz-flow'])
})

// 3. continue-with-flags but the open critical/high is NOT in an authN/authZ
//    dimension → flagged, and the AuthN/AuthZ flow is NOT withheld.
check('open non-authZ + continue-with-flags → flagged, no withholding', () => {
  const r = computeGate([f({ dimension: 'injection-xss' })], ELECT)
  assert.equal(r.mode, 'flagged')
  assert.equal(r.proceed, true)
  assert.deepEqual(r.suppress, [])
})

// 4. Clean ledger (no open critical/high) → clean mode, generate everything.
check('no open critical/high → clean', () => {
  const r = computeGate(
    [f({ adjusted_severity: 'medium' }), f({ status: 'fixed' }), f({ status: 'refuted', verdict: 'false_positive' })],
    null
  )
  assert.equal(r.mode, 'clean')
  assert.equal(r.proceed, true)
  assert.deepEqual(r.suppress, [])
})

// 5. Only `continue-with-flags` opens the flagged path — `fix-first` does not.
check('open critical + fix-first election → STOP (not flagged)', () => {
  const r = computeGate([f()], FIXFIRST)
  assert.equal(r.mode, 'STOP')
  assert.equal(r.proceed, false)
})

// 6. Severity contract: `severity` is honored when `adjusted_severity` absent;
//    refuted/fixed/accepted_risk are never "open".
check('severity fallback + non-open states ignored', () => {
  const r = computeGate(
    [
      { id: 'a', dimension: 'tenant-isolation', status: 'confirmed', severity: 'high' },
      { id: 'b', dimension: 'oauth-identity', status: 'accepted_risk', adjusted_severity: 'critical' },
    ],
    null
  )
  assert.equal(r.open.high, 1)
  assert.equal(r.open.critical, 0) // accepted_risk is not open
  assert.equal(r.mode, 'STOP')
})

// A1 — secondary-category dimensions must withhold too (the gate false-negative).
// web-client (secondary authN/session — token storage) and package-metadata
// (secondary authZ — CSRF) are authN/authZ findings the dimension-only set missed.
check('A1: high web-client (token storage) + continue-with-flags → withhold authn-authz-flow', () => {
  const r = computeGate([f({ dimension: 'web-client', adjusted_severity: 'high' })], ELECT)
  assert.equal(r.mode, 'flagged')
  assert.deepEqual(r.suppress, ['authn-authz-flow'])
})
check('A1: high package-metadata (CSRF) + continue-with-flags → withhold authn-authz-flow', () => {
  const r = computeGate([f({ dimension: 'package-metadata', adjusted_severity: 'high' })], ELECT)
  assert.deepEqual(r.suppress, ['authn-authz-flow'])
})

// A2 — a medium/low authZ finding must NOT withhold the doc, even when an
// unrelated non-authZ critical puts the run into flagged mode.
check('A2: medium authZ + unrelated critical non-authZ → flagged but NOT withheld', () => {
  const r = computeGate(
    [
      f({ id: 'authz-med', dimension: 'tenant-isolation', adjusted_severity: 'medium' }),
      f({ id: 'crit-nonauthz', dimension: 'secrets-credentials', adjusted_severity: 'critical' }),
    ],
    ELECT
  )
  assert.equal(r.mode, 'flagged')
  assert.deepEqual(r.suppress, [], 'a medium authZ finding must not withhold the AuthN/AuthZ doc')
  assert.deepEqual(r.open_authz_findings, [], 'a medium authZ finding must not appear in the placeholder-naming list')
})

// F-1 — the placeholder names ONLY critical/high authZ findings (open_authz_findings
// is the field generate-artifacts interpolates into the withheld placeholder text).
check('F-1: open_authz_findings lists only the critical/high authZ finding, not the medium', () => {
  const r = computeGate(
    [
      f({ id: 'authz-crit', dimension: 'oauth-identity', adjusted_severity: 'critical' }),
      f({ id: 'authz-med', dimension: 'tenant-isolation', adjusted_severity: 'medium' }),
    ],
    ELECT
  )
  assert.deepEqual(r.suppress, ['authn-authz-flow'])
  assert.deepEqual(r.open_authz_findings, ['authz-crit (oauth-identity)'])
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

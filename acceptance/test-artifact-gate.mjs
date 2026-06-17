#!/usr/bin/env node
/**
 * Standing test for the generate-artifacts gate (harness/artifact-gate.mjs).
 *
 * The toolkit is an AUDIT tool: an open critical/high never STOPs the run and
 * never waits for a human "fix-or-flags" election — the gate always produces the
 * full (NOT-READY) report. The one honesty line: the AuthN/AuthZ flow doc is
 * WITHHELD whenever an open critical/high sits in the authN/authZ category, and
 * that withhold is now a pure function of the LEDGER — it fires regardless of any
 * election (closing the bypass where a missing/non-continue-with-flags election
 * skipped it). This test pins that contract on every entry path.
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

console.log('artifact-gate standing test')

// 1. The 0.5.2 core change: open critical/high in an authZ dim with NO election →
//    flagged + withhold (NOT STOP). The withhold no longer needs a human to have
//    clicked continue-with-flags.
check('open authZ critical + NO election → flagged + withhold (no STOP, no election needed)', () => {
  const r = computeGate([f({ dimension: 'oauth-identity' })], null)
  assert.equal(r.mode, 'flagged')
  assert.equal(r.proceed, true)
  assert.deepEqual(r.suppress, ['authn-authz-flow'])
})

// 2. Election-independence: a persisted continue-with-flags election gives the
//    IDENTICAL result (election is informational only now).
check('same ledger + continue-with-flags election → identical flagged + withhold', () => {
  const r = computeGate([f({ dimension: 'oauth-identity' })], { decision: 'continue-with-flags' })
  assert.equal(r.mode, 'flagged')
  assert.deepEqual(r.suppress, ['authn-authz-flow'])
})

// 3. Open critical/high NOT in authN/authZ → flagged, but the AuthN/AuthZ doc is NOT withheld.
check('open non-authZ critical → flagged, no withholding', () => {
  const r = computeGate([f({ dimension: 'injection-xss' })], null)
  assert.equal(r.mode, 'flagged')
  assert.deepEqual(r.suppress, [])
})

// 4. Clean ledger (no open critical/high) → clean; generate everything.
check('no open critical/high → clean', () => {
  const r = computeGate(
    [f({ adjusted_severity: 'medium' }), f({ status: 'fixed' }), f({ status: 'refuted', verdict: 'false_positive' })],
    null
  )
  assert.equal(r.mode, 'clean')
  assert.equal(r.proceed, true)
  assert.deepEqual(r.suppress, [])
})

// 5. There is NO STOP mode — an audit always reports. Any/legacy/absent election
//    over an open critical yields flagged, never STOP.
check('NO STOP mode: open critical with null / legacy fix-first|stop election → flagged', () => {
  for (const tri of [null, { decision: 'fix-first' }, { decision: 'stop' }, { decision: 'anything' }]) {
    const r = computeGate([f()], tri)
    assert.equal(r.mode, 'flagged', `election=${JSON.stringify(tri)} should be flagged`)
    assert.notEqual(r.mode, 'STOP')
    assert.equal(r.proceed, true)
  }
})

// 6. Severity contract: `severity` honored when `adjusted_severity` absent;
//    refuted/fixed/accepted_risk are never "open"; open high → flagged.
check('severity fallback + non-open states ignored → flagged on the open high', () => {
  const r = computeGate(
    [
      { id: 'a', dimension: 'tenant-isolation', status: 'confirmed', severity: 'high' },
      { id: 'b', dimension: 'oauth-identity', status: 'accepted_risk', adjusted_severity: 'critical' },
    ],
    null
  )
  assert.equal(r.open.high, 1)
  assert.equal(r.open.critical, 0) // accepted_risk is not open
  assert.equal(r.mode, 'flagged')
})

// A1 — secondary-category dimensions withhold too, with NO election needed.
// web-client (token storage) and package-metadata (CSRF) resolve to authN/authZ.
check('A1: high web-client (token storage), no election → withhold authn-authz-flow', () => {
  const r = computeGate([f({ dimension: 'web-client', adjusted_severity: 'high' })], null)
  assert.equal(r.mode, 'flagged')
  assert.deepEqual(r.suppress, ['authn-authz-flow'])
})
check('A1: high package-metadata (CSRF), no election → withhold authn-authz-flow', () => {
  const r = computeGate([f({ dimension: 'package-metadata', adjusted_severity: 'high' })], null)
  assert.deepEqual(r.suppress, ['authn-authz-flow'])
})

// 0.5.2 NEW — crypto-internals (JWT verification) is a secondary authN dimension.
// A JWT-verification critical ALONE (no oauth-identity / other authz finding) must
// still withhold the AuthN/AuthZ doc. This is the gap the 0.5.1 cold-grade found:
// a broken JWT verify IS an auth hole, but crypto-internals wasn't in the set.
check('0.5.2: crypto-internals JWT critical ALONE → withhold (the secondary-authN gap)', () => {
  const r = computeGate([f({ id: 'jwt', dimension: 'crypto-internals', adjusted_severity: 'critical' })], null)
  assert.equal(r.mode, 'flagged')
  assert.deepEqual(r.suppress, ['authn-authz-flow'])
  assert.deepEqual(r.open_authz_findings, ['jwt (crypto-internals)'])
})

// 0.5.2 NEW (adversarial pass) — sessionid-egress is the review's named auto-fail
// authN class (a leaked SessionId is a bearer credential for the org session). An
// open critical there ALONE must withhold the AuthN/AuthZ doc; the gate missed it
// before — the doc would have generated over a live token-egress hole.
check('0.5.2: sessionid-egress critical ALONE → withhold (named auth auto-fail class)', () => {
  const r = computeGate([f({ id: 'sess', dimension: 'sessionid-egress', adjusted_severity: 'critical' })], null)
  assert.equal(r.mode, 'flagged')
  assert.deepEqual(r.suppress, ['authn-authz-flow'])
  assert.deepEqual(r.open_authz_findings, ['sess (sessionid-egress)'])
})

// 0.5.2 — a stray serialization whitespace/case in the dimension must NOT silently
// drop the withhold (the cardinal direction): the membership match trims+lowercases.
check('0.5.2: whitespace/case dimension still withholds (no silent drop)', () => {
  const r = computeGate([f({ id: 'ws', dimension: '  OAuth-Identity  ', adjusted_severity: 'critical' })], null)
  assert.deepEqual(r.suppress, ['authn-authz-flow'])
})

// Boundary control (adversarial pass confirmed this is CORRECT, not a gap):
// injection-xss is deliberately NOT an authN/authZ dim — its defect category is
// output-encoding, not auth (even if a payload could steal a session). So an open
// XSS critical flags but does NOT withhold the AuthN/AuthZ doc. Inclusion is by
// defect-category, not blast-radius.
check('boundary: injection-xss critical → flagged, NOT withheld (defect-category, not blast-radius)', () => {
  const r = computeGate([f({ dimension: 'injection-xss', adjusted_severity: 'critical' })], null)
  assert.equal(r.mode, 'flagged')
  assert.deepEqual(r.suppress, [])
})

// A2 — a medium/low authZ finding must NOT withhold the doc, even when an
// unrelated non-authZ critical puts the run into flagged mode.
check('A2: medium authZ + unrelated critical non-authZ → flagged but NOT withheld', () => {
  const r = computeGate(
    [
      f({ id: 'authz-med', dimension: 'tenant-isolation', adjusted_severity: 'medium' }),
      f({ id: 'crit-nonauthz', dimension: 'secrets-credentials', adjusted_severity: 'critical' }),
    ],
    null
  )
  assert.equal(r.mode, 'flagged')
  assert.deepEqual(r.suppress, [], 'a medium authZ finding must not withhold the AuthN/AuthZ doc')
  assert.deepEqual(r.open_authz_findings, [], 'a medium authZ finding must not appear in the placeholder-naming list')
})

// F-1 — the placeholder names ONLY critical/high authZ findings.
check('F-1: open_authz_findings lists only the critical/high authZ finding, not the medium', () => {
  const r = computeGate(
    [
      f({ id: 'authz-crit', dimension: 'oauth-identity', adjusted_severity: 'critical' }),
      f({ id: 'authz-med', dimension: 'tenant-isolation', adjusted_severity: 'medium' }),
    ],
    null
  )
  assert.deepEqual(r.suppress, ['authn-authz-flow'])
  assert.deepEqual(r.open_authz_findings, ['authz-crit (oauth-identity)'])
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

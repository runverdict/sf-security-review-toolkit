#!/usr/bin/env node
/**
 * Standing test for the resumption-fingerprint staleness check
 * (harness/ledger-staleness.mjs). Guards C1: a resumed run must flag findings
 * whose files changed since the audit, rather than presenting their verdict
 * against code that has since moved.
 *
 * Dependency-free: `node acceptance/test-ledger-staleness.mjs`.
 */
import assert from 'node:assert/strict'
import { staleFindings, latestAuditedCommit } from '../harness/ledger-staleness.mjs'

let pass = 0, fail = 0
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

const findings = [
  { id: '1', dimension: 'apex-exposed-surface', status: 'confirmed', file: 'force-app/classes/Svc.cls:13' },
  { id: '2', dimension: 'oauth-identity', status: 'refuted', file: 'server/index.js:11' },
  { id: '3', dimension: 'crypto-internals', status: 'fixed', file: 'server/index.js' },
  { id: '4', dimension: 'package-metadata', status: 'confirmed', file: 'force-app/lwc/panel/panel.js:1' },
]

console.log('ledger-staleness standing test')

check('findings whose file changed (line-suffix normalized) are flagged stale', () => {
  const s = staleFindings(findings, ['server/index.js'])
  assert.deepEqual(s.map((x) => x.id).sort(), ['2', '3']) // both server/index.js entries, :line stripped
})

check('a confirmed finding on a changed file is flagged (regression risk)', () => {
  const s = staleFindings(findings, ['force-app/classes/Svc.cls'])
  assert.deepEqual(s.map((x) => x.id), ['1'])
})

check('no changed files → nothing stale', () => {
  assert.deepEqual(staleFindings(findings, []), [])
})

check('changed file backing no finding → nothing stale', () => {
  assert.deepEqual(staleFindings(findings, ['README.md', 'docs/x.md']), [])
})

check('findings without a file are never flagged', () => {
  assert.deepEqual(staleFindings([{ id: 'z', status: 'confirmed' }], ['anything']), [])
})

// D1 — path canonicalization: a finding whose file is "./"-prefixed or uses
// backslashes must still match git's clean repo-relative forward-slash output,
// or a genuinely-changed file is silently reported current (false-negative).
check('D1: ./-prefixed finding path matches git-clean changed path', () => {
  const s = staleFindings([{ id: 'p', dimension: 'web-client', status: 'confirmed', file: './server/index.js:13' }], ['server/index.js'])
  assert.deepEqual(s.map((x) => x.id), ['p'])
})
check('D1: backslash finding path matches posix changed path', () => {
  const s = staleFindings([{ id: 'q', dimension: 'apex-exposed-surface', status: 'confirmed', file: 'force-app\\classes\\Svc.cls:5' }], ['force-app/classes/Svc.cls'])
  assert.deepEqual(s.map((x) => x.id), ['q'])
})

// D2 — the fingerprint is the NEWEST pass's commit, not the newest pass that
// happens to carry one. If the latest pass lacks it → null (no-fingerprint),
// never silently diff against an older pass's stale commit.
check('D2: latest pass lacking audited_commit → null (not an older pass\'s commit)', () => {
  assert.equal(latestAuditedCommit([{ id: 1, audited_commit: 'oldsha' }, { id: 2 }]), null)
})
check('D2: latest pass with a commit → that commit', () => {
  assert.equal(latestAuditedCommit([{ id: 1, audited_commit: 'oldsha' }, { id: 2, audited_commit: 'newsha' }]), 'newsha')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

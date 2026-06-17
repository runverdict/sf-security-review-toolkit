#!/usr/bin/env node
/**
 * Standing test for the deployed-org-deep-audit precondition check
 * (harness/package-readiness.mjs). Guards the preflight ordering fix: the deep
 * audit's install-readiness is computed UP FRONT and accurately, so the proactive
 * power-up gate never says "deep audit available" when there is no installable
 * version (the placeholder-alias case that the live cold run surfaced too late).
 *
 * Dependency-free: `node acceptance/test-package-readiness.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { packageReadiness } from '../harness/package-readiness.mjs'

let pass = 0, fail = 0
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`) }
}

console.log('package-readiness standing test')

// The exact Lumina fixture shape that fooled the live preflight: package defined,
// but a placeholder 0Ho alias, an unbuilt .NEXT versionNumber, and no 04t alias.
check('Lumina shape (placeholder 0Ho alias, .NEXT, no 04t) → needs-build', () => {
  const r = packageReadiness({
    packageDirectories: [{ path: 'force-app', default: true, package: 'Lumina Forecast Connector', versionNumber: '1.2.0.NEXT' }],
    packageAliases: { 'Lumina Forecast Connector': '0Ho5e000000XXXXCAW' },
  })
  assert.equal(r.status, 'needs-build')
  assert.match(r.reason, /placeholder|build-managed-package/)
})

check('a real 04t version alias → installable', () => {
  const r = packageReadiness({
    packageDirectories: [{ path: 'force-app', package: 'Acme', versionNumber: '1.0.0.1' }],
    packageAliases: { Acme: '0Ho5e0000008aBcCAE', 'Acme@1.0.0-1': '04t5e0000004XyZAAU' },
  })
  assert.equal(r.status, 'installable')
  assert.equal(r.versionAlias, 'Acme@1.0.0-1')
})

check('no sfdx-project.json (null) → no-package', () => {
  assert.equal(packageReadiness(null).status, 'no-package')
})

check('source-only project (no `package` field) → no-package', () => {
  const r = packageReadiness({ packageDirectories: [{ path: 'force-app', default: true }] })
  assert.equal(r.status, 'no-package')
})

check('real 0Ho package id but no 04t version → needs-build', () => {
  const r = packageReadiness({
    packageDirectories: [{ path: 'force-app', package: 'Acme', versionNumber: '1.0.0.NEXT' }],
    packageAliases: { Acme: '0Ho5e0000008aBcCAE' },
  })
  assert.equal(r.status, 'needs-build')
})

check('a PLACEHOLDER 04t alias does not count as installable → needs-build', () => {
  const r = packageReadiness({
    packageDirectories: [{ path: 'force-app', package: 'Acme', versionNumber: '1.0.0.NEXT' }],
    packageAliases: { Acme: '0Ho5e0000008aBcCAE', 'Acme@1.0.0-1': '04t5e000000XXXXAAU' },
  })
  assert.equal(r.status, 'needs-build')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

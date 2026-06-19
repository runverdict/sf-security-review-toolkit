#!/usr/bin/env node
/**
 * Standing test for harness/namespace-check.mjs — the deep-audit BUILD precondition
 * (0.7.2). Pure classifier tested exhaustively; the impure prober confirmed to return
 * a valid shape (its result depends on the host's authed orgs).
 *
 *   N1  classifyNamespace: no Dev Hub / no namespace / registered / not-registered
 *   N2  the conservative posture: an unconfirmed namespace is NOT buildable, but the
 *       reason says "can't confirm / set it up", never a false "impossible"
 *   N3  namespaceStatus() returns a valid {buildable, namespace, reason}
 *
 * Dependency-free: `node acceptance/test-namespace-check.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { classifyNamespace, namespaceStatus } from '../harness/namespace-check.mjs'

let pass = 0, fail = 0
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message)}`) } }

console.log('namespace-check standing test')

check('N1 classifyNamespace: devhub / namespace matrix', () => {
  // no Dev Hub → not buildable, names the Dev Hub need
  const noHub = classifyNamespace({ pkgNamespace: 'atlas', authedNamespaces: ['atlas'], hasDevHub: false })
  assert.equal(noHub.buildable, false)
  assert.match(noHub.reason, /Dev Hub/)
  // no namespace declared → namespace isn't the blocker → buildable (re namespace)
  const noNs = classifyNamespace({ pkgNamespace: '', authedNamespaces: [], hasDevHub: true })
  assert.equal(noNs.buildable, true)
  // namespace registered (an authed org carries it) → buildable
  const reg = classifyNamespace({ pkgNamespace: 'verdict', authedNamespaces: ['verdict'], hasDevHub: true })
  assert.equal(reg.buildable, true)
  assert.match(reg.reason, /registered/)
  // namespace NOT carried by any authed org → NOT confirmed (the Atlas-fixture case)
  const unreg = classifyNamespace({ pkgNamespace: 'atlas', authedNamespaces: ['verdict'], hasDevHub: true })
  assert.equal(unreg.buildable, false)
  assert.equal(unreg.namespace, 'atlas')
})

check('N2 conservative posture: unconfirmed ≠ false "impossible"', () => {
  const unreg = classifyNamespace({ pkgNamespace: 'atlas', authedNamespaces: ['verdict'], hasDevHub: true })
  assert.equal(unreg.buildable, false)
  assert.match(unreg.reason, /NOT confirmed|register|link/i)   // names the prerequisite
  assert.doesNotMatch(unreg.reason, /\bimpossible\b/i)          // never claims impossible (can't read the registry)
})

check('N3 namespaceStatus(): returns a valid shape', () => {
  const r = namespaceStatus('/nonexistent-repo-xyz')
  assert.equal(typeof r.buildable, 'boolean')
  assert.equal(typeof r.reason, 'string')
  assert.ok('namespace' in r)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

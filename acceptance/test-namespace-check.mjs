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
 *   N4  collectDeclaredNamespaces (PURE, the nested fail-OPEN lock): a nested
 *       two-package layout with NO root sfdx-project.json returns the declared
 *       set — a root-only read would return {} and fail OPEN into the
 *       "no namespace declared → buildable" branch. Hermetic on a tmp fixture;
 *       deliberately NOT driven through the impure namespaceStatus (which needs a
 *       live Dev Hub and short-circuits to buildable:false without one, making a
 *       hermetic namespaceStatus assertion vacuous).
 *
 * Dependency-free: `node acceptance/test-namespace-check.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { classifyNamespace, namespaceStatus, collectDeclaredNamespaces } from '../harness/namespace-check.mjs'

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message)}`) } }
const box = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'srt-nsc-'))); dirs.push(d); return d }

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
  const reg = classifyNamespace({ pkgNamespace: 'beacon', authedNamespaces: ['beacon'], hasDevHub: true })
  assert.equal(reg.buildable, true)
  assert.match(reg.reason, /registered/)
  // namespace NOT carried by any authed org → NOT confirmed (the Atlas-fixture case)
  const unreg = classifyNamespace({ pkgNamespace: 'atlas', authedNamespaces: ['beacon'], hasDevHub: true })
  assert.equal(unreg.buildable, false)
  assert.equal(unreg.namespace, 'atlas')
})

check('N2 conservative posture: unconfirmed ≠ false "impossible"', () => {
  const unreg = classifyNamespace({ pkgNamespace: 'atlas', authedNamespaces: ['beacon'], hasDevHub: true })
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

check('N4 collectDeclaredNamespaces: a nested two-package layout (no root sfdx-project.json) is not fail-OPEN', () => {
  // The real cold-run layout: the namespaces live in SUBDIRS, the root has none.
  // A root-only read returns '' → classifyNamespace's "no namespace declared →
  // buildable" branch — the fail-OPEN this helper closes.
  const b = box()
  mkdirSync(join(b, 'pkg-core'), { recursive: true })
  mkdirSync(join(b, 'pkg-mcp'), { recursive: true })
  mkdirSync(join(b, 'pkg-plain'), { recursive: true })
  const proj = (ns) => JSON.stringify({ packageDirectories: [{ path: 'force-app', package: 'P', default: true }], ...(ns === undefined ? {} : { namespace: ns }) })
  writeFileSync(join(b, 'pkg-core', 'sfdx-project.json'), proj('nebula'))
  writeFileSync(join(b, 'pkg-mcp', 'sfdx-project.json'), proj('nebula'))
  // a namespace-less sibling contributes nothing (no '' pollution of the set)
  writeFileSync(join(b, 'pkg-plain', 'sfdx-project.json'), proj(undefined))
  assert.deepEqual(collectDeclaredNamespaces(b), new Set(['nebula']), 'both nested declarations collected, deduped, no empty entry')
  // and feeding that namespace forward hits the conservative unconfirmed branch,
  // never the fail-OPEN "no namespace declared → buildable" one
  const classified = classifyNamespace({ pkgNamespace: 'nebula', authedNamespaces: [], hasDevHub: true })
  assert.equal(classified.buildable, false, 'a declared-but-unconfirmed nested namespace is NOT buildable')
  assert.equal(classified.namespace, 'nebula')
  // an empty repo declares nothing — the genuine no-namespace case stays reachable
  assert.deepEqual(collectDeclaredNamespaces(box()), new Set(), 'no sfdx-project.json anywhere → empty set')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

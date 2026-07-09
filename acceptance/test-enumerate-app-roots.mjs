#!/usr/bin/env node
/**
 * Standing test for harness/enumerate-app-roots.mjs (WO-108 scope breadth) —
 * the deterministic monorepo app-root enumerator that replaced prose-strength
 * multi-app detection in scope-submission. The defect it locks against: a full
 * Next.js admin console (`apps/admin`, its own port) was ABSENT from a scope
 * manifest and only surfaced during the SCA phase, because second-surface
 * detection was LLM prose no test could pin.
 *
 * E1  THE regression lock — a fixture with apps/web + apps/admin emits BOTH as
 *     candidate elements (a first-app-only regression drops admin → RED), and
 *     admin carries its Dockerfile-declared port.
 * E2  library negative control — packages/ui (manifest, no app signal) is
 *     reported candidate:false with its reason, never a candidate element.
 * E3  determinism — same tree twice → byte-identical stdout (--json and text).
 * E4  empty repo — no manifests → zero roots, exit 0, honest empty line.
 * E5  python service — services/api with fastapi in requirements.txt is a
 *     candidate with the framework named.
 * E6  the emitted element type canonicalizes to external-endpoint through the
 *     EXISTING render synonym map (the fold-in path scope-submission uses).
 * E7  wiring — scope-submission grants the engine in allowed-tools and runs it
 *     at step 2.
 * E8  root workspace manifest with no app signal → discovered, candidate:false.
 *
 * Dependency-free: `node acceptance/test-enumerate-app-roots.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { enumerateAppRoots, APP_CONTAINERS } from '../harness/enumerate-app-roots.mjs'
import { canonicalElementType } from '../harness/render-detected-elements.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'enumerate-app-roots.mjs')

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) } }
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'app-roots-')); dirs.push(d); return d }
const put = (repo, rel, content) => {
  const p = join(repo, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, content)
}

/** The monorepo fixture that reproduces the missed-admin-console defect. */
function monorepoFixture() {
  const repo = tmp()
  // root: a workspaces-only manifest — NOT an app.
  put(repo, 'package.json', JSON.stringify({ name: 'monorepo-root', private: true, workspaces: ['apps/*', 'packages/*'] }))
  // apps/web — the primary app (framework dep + config file).
  put(repo, 'apps/web/package.json', JSON.stringify({ name: 'web', dependencies: { next: '14.0.0', react: '18.0.0' }, scripts: { start: 'next start' } }))
  put(repo, 'apps/web/next.config.js', 'module.exports = {}\n')
  // apps/admin — THE surface the prose missed: a second Next.js console on :3001.
  put(repo, 'apps/admin/package.json', JSON.stringify({ name: 'admin', dependencies: { next: '14.0.0' }, scripts: { start: 'next start -p 3001' } }))
  put(repo, 'apps/admin/Dockerfile', 'FROM node:20\nEXPOSE 3001\nCMD ["npm","start"]\n')
  // packages/ui — a shared library: manifest present, no app signal.
  put(repo, 'packages/ui/package.json', JSON.stringify({ name: 'ui', main: 'index.js', dependencies: { clsx: '2.0.0' } }))
  // services/api — a Python FastAPI backend.
  put(repo, 'services/api/requirements.txt', 'fastapi==0.111.0\nuvicorn==0.30.0\n')
  return repo
}

console.log('enumerate-app-roots (WO-108 scope breadth) standing test')

check('E1 apps/web + apps/admin BOTH emitted as candidate elements (the missed-admin regression lock)', () => {
  const repo = monorepoFixture()
  const r = enumerateAppRoots(repo)
  const candidates = r.appRoots.filter((a) => a.candidate).map((a) => a.path)
  assert.ok(candidates.includes('apps/web'), 'apps/web must be a candidate')
  assert.ok(candidates.includes('apps/admin'), 'apps/admin must be a candidate — the second surface may NEVER be dropped')
  const admin = r.appRoots.find((a) => a.path === 'apps/admin')
  assert.equal(admin.framework, 'next', 'admin carries its framework signal')
  assert.equal(admin.port, 3001, 'admin carries its declared port (Dockerfile EXPOSE)')
  assert.ok(admin.evidence.some((e) => /Dockerfile/.test(e)), 'admin evidence names the Dockerfile')
  // and the count roll-up matches (web + admin + services/api)
  assert.equal(r.candidates, candidates.length)
  assert.ok(r.candidates >= 3, 'web + admin + the python service are all candidates')
})

check('E2 library negative control: packages/ui is candidate:false with a named reason, never an element', () => {
  const r = enumerateAppRoots(monorepoFixture())
  const ui = r.appRoots.find((a) => a.path === 'packages/ui')
  assert.ok(ui, 'the library root is still DISCOVERED (reported, never silently dropped)')
  assert.equal(ui.candidate, false, 'a manifest with no app signal is not a candidate element')
  assert.equal(ui.elementType, null)
  assert.match(ui.reason, /no app signal/, 'the classification carries its disputable reason')
})

check('E3 determinism: same tree twice → byte-identical stdout (--json and text)', () => {
  const repo = monorepoFixture()
  for (const flags of [['--json'], []]) {
    const a = execFileSync('node', [CLI, '--target', repo, ...flags], { encoding: 'utf8' })
    const b = execFileSync('node', [CLI, '--target', repo, ...flags], { encoding: 'utf8' })
    assert.equal(a, b, `two runs diverged (${flags.join(' ') || 'text'})`)
  }
  // sorted by path — stable order is part of the determinism contract
  const j = JSON.parse(execFileSync('node', [CLI, '--target', repo, '--json'], { encoding: 'utf8' }))
  const paths = j.appRoots.map((a) => a.path)
  assert.deepEqual(paths, [...paths].sort(), 'appRoots are path-sorted')
})

check('E4 empty repo → zero roots, exit 0, honest empty line', () => {
  const repo = tmp()
  const r = enumerateAppRoots(repo)
  assert.deepEqual(r.appRoots, [])
  assert.equal(r.candidates, 0)
  const out = execFileSync('node', [CLI, '--target', repo], { encoding: 'utf8' })
  assert.match(out, /No app-root manifests found/, 'the text render states the empty result honestly')
})

check('E5 python service: services/api with fastapi in requirements.txt is a candidate, framework named', () => {
  const r = enumerateAppRoots(monorepoFixture())
  const api = r.appRoots.find((a) => a.path === 'services/api')
  assert.ok(api && api.candidate, 'the python backend is a candidate')
  assert.equal(api.framework, 'fastapi')
  assert.ok(api.evidence.some((e) => /requirements\.txt/.test(e)))
})

check('E6 the emitted element type folds through the EXISTING synonym map to external-endpoint', () => {
  const r = enumerateAppRoots(monorepoFixture())
  for (const a of r.appRoots.filter((x) => x.candidate)) {
    assert.equal(a.elementType, 'external-web-app', `${a.path} emits the synonym type the skill folds in`)
    assert.equal(canonicalElementType(a.elementType), 'external-endpoint', `${a.path} canonicalizes via ELEMENT_TYPE_SYNONYMS`)
  }
})

check('E7 wiring: scope-submission grants the engine + runs it at step 2 + folds candidates as elements', () => {
  const skill = readFileSync(join(PLUGIN, 'skills', 'scope-submission', 'SKILL.md'), 'utf8')
  assert.match(skill, /Bash\(node \*harness\/enumerate-app-roots\.mjs \*\)/, 'allowed-tools grants the engine')
  assert.match(skill, /enumerate-app-roots\.mjs --target <target> --json/, 'step 2 runs the engine')
  assert.match(skill, /candidate: true/, 'step 2 folds candidate:true roots into the element set')
  assert.match(skill, /ELEMENT_TYPE_SYNONYMS/, 'step 2 names the canonical synonym home for the fold-in')
})

check('E8 root workspaces manifest with no app signal → discovered, candidate:false (never a phantom element)', () => {
  const r = enumerateAppRoots(monorepoFixture())
  const root = r.appRoots.find((a) => a.path === '.')
  assert.ok(root, 'the repo root manifest is discovered')
  assert.equal(root.candidate, false, 'a workspaces-only root is not an app')
})

check('E9 the container convention set is frozen + scanned containers are reported', () => {
  assert.ok(Object.isFrozen(APP_CONTAINERS), 'APP_CONTAINERS is frozen')
  assert.deepEqual([...APP_CONTAINERS], ['apps', 'packages', 'services'])
  const r = enumerateAppRoots(monorepoFixture())
  assert.deepEqual(r.scanned, ['apps', 'packages', 'services'])
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

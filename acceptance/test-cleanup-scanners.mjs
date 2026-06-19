#!/usr/bin/env node
/**
 * Standing test for harness/cleanup-scanners.mjs — the asymmetric, manifest-driven
 * teardown. Fully hermetic (no network, no real installs): it stands up a fake
 * install state (a safe tmp tool dir + a partner repo with evidence + the project
 * pointer) and drives the cleanup.
 *
 *   C1  cleaned: the tmp tool dir is removed; the pointer is marked `cleaned`
 *   C2  THE ASYMMETRY — evidence files survive, and a sibling path next to the tmp
 *       dir survives (only the recorded tmp root is removed, nothing else)
 *   C3  idempotent: a second run → `already-clean`, evidence still intact
 *   C4  SAFETY REFUSAL — a pointer whose tmpRoot is an unsafe path (no sf-srt
 *       segment / outside the temp bases) is REFUSED: nothing removed, repo intact
 *   C5  nothing-to-clean: --target with no pointer → no-op, no error
 *   C6  planCleanup is pure: throws on an unsafe root, else removePaths=[tmpRoot]
 *       + the installed tool names
 *   C7  resolves via --manifest and --tmp-root, not only --target
 *
 * Dependency-free: `node acceptance/test-cleanup-scanners.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { planCleanup, cleanupScanners } from '../harness/cleanup-scanners.mjs'
import { MANIFEST_SCHEMA } from '../harness/install-scanners.mjs'

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`) }
}
const sandbox = (p) => { const d = realpathSync(mkdtempSync(join(tmpdir(), p))); dirs.push(d); return d }
const w = (p, body) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, body) }

/** Build a fake install: a safe tmp tool dir + a partner repo w/ evidence + pointer. */
function fakeInstall(box) {
  const tmpRoot = join(box, 'scanners-run1')            // safe: under tmpdir, box carries an sf-srt segment
  const repo = join(box, 'repo')
  const sibling = join(box, 'KEEP-sibling')             // a peer of the tmp dir — must survive
  mkdirSync(join(tmpRoot, 'osv-scanner'), { recursive: true }); writeFileSync(join(tmpRoot, 'osv-scanner', 'osv-scanner'), 'bin')
  mkdirSync(join(tmpRoot, 'semgrep', 'venv', 'bin'), { recursive: true }); writeFileSync(join(tmpRoot, 'semgrep', 'venv', 'bin', 'semgrep'), 'bin')
  mkdirSync(sibling, { recursive: true }); writeFileSync(join(sibling, 'keep.txt'), 'do not remove me')
  const manifest = {
    schema: MANIFEST_SCHEMA, runId: 'run1', tmpRoot, target: repo, createdPaths: [tmpRoot],
    installs: [
      { name: 'osv-scanner', status: 'installed', binDir: join(tmpRoot, 'osv-scanner') },
      { name: 'semgrep', status: 'installed', binDir: join(tmpRoot, 'semgrep', 'venv', 'bin') },
      { name: 'gosec', status: 'failed' },
    ],
  }
  writeFileSync(join(tmpRoot, 'install-manifest.json'), JSON.stringify(manifest, null, 2))
  // partner repo: evidence (KEEP) + the gitignored pointer
  const evid = join(repo, '.security-review', 'evidence')
  mkdirSync(evid, { recursive: true }); writeFileSync(join(evid, 'osv-2026.json'), '{"results":[]}')
  writeFileSync(join(repo, '.security-review', 'scanner-install.json'), JSON.stringify({
    schema: MANIFEST_SCHEMA, runId: 'run1', tmpRoot, manifestPath: join(tmpRoot, 'install-manifest.json'),
    installed: ['osv-scanner', 'semgrep'], pathPrepend: [join(tmpRoot, 'osv-scanner')],
  }, null, 2))
  return { tmpRoot, repo, sibling, evidenceFile: join(evid, 'osv-2026.json'), pointer: join(repo, '.security-review', 'scanner-install.json') }
}

console.log('cleanup-scanners standing test')

check('C1+C2 cleaned: tmp dir removed; evidence + sibling KEPT; pointer marked cleaned', () => {
  const box = sandbox('sf-srt-clean-')
  const f = fakeInstall(box)
  assert.ok(existsSync(f.tmpRoot))
  const r = cleanupScanners({ target: f.repo })
  assert.equal(r.status, 'cleaned')
  assert.deepEqual(r.removed, [f.tmpRoot])
  assert.deepEqual(r.removedTools.sort(), ['osv-scanner', 'semgrep'])     // 'failed' gosec is not listed
  assert.ok(!existsSync(f.tmpRoot), 'the tmp tool dir is removed')
  assert.ok(existsSync(f.evidenceFile), 'ASYMMETRY: evidence survives')
  assert.ok(existsSync(join(f.sibling, 'keep.txt')), 'ASYMMETRY: a sibling of the tmp dir survives')
  const ptr = JSON.parse(readFileSync(f.pointer, 'utf8'))
  assert.equal(ptr.status, 'cleaned')
  assert.deepEqual(ptr.pathPrepend, [], 'cleaned pointer reports no PATH so run-scans knows the tools are gone')
})

check('C3 idempotent: a second cleanup → already-clean, evidence still intact', () => {
  const box = sandbox('sf-srt-clean-')
  const f = fakeInstall(box)
  cleanupScanners({ target: f.repo })
  const r2 = cleanupScanners({ target: f.repo })
  assert.equal(r2.status, 'already-clean')
  assert.deepEqual(r2.removed, [])
  assert.ok(existsSync(f.evidenceFile))
})

check('C4 SAFETY: a pointer with an unsafe tmpRoot is REFUSED — nothing removed', () => {
  // a plain repo (NO sf-srt path segment) whose pointer points tmpRoot at itself
  const repo = sandbox('plainrepo-')
  const evid = join(repo, '.security-review', 'evidence')
  mkdirSync(evid, { recursive: true }); writeFileSync(join(evid, 'keep.json'), '{}')
  writeFileSync(join(repo, '.security-review', 'scanner-install.json'), JSON.stringify({
    schema: MANIFEST_SCHEMA, tmpRoot: repo, manifestPath: join(repo, 'nope.json'),
  }, null, 2))
  const r = cleanupScanners({ target: repo })
  assert.equal(r.status, 'refused', JSON.stringify(r))
  assert.deepEqual(r.removed, [])
  assert.ok(existsSync(join(evid, 'keep.json')), 'a refused cleanup removes nothing')
  assert.ok(existsSync(repo))
})

check('C5 nothing-to-clean: --target with no pointer → no-op, no error', () => {
  const repo = sandbox('sf-srt-clean-')
  const r = cleanupScanners({ target: repo })
  assert.equal(r.status, 'nothing-to-clean')
  assert.deepEqual(r.removed, [])
})

check('C6 planCleanup is pure: throws on unsafe, else removePaths + installed names', () => {
  assert.throws(() => planCleanup({ tmpRoot: '/' }), /unsafe tmp root/)
  assert.throws(() => planCleanup({ tmpRoot: join(tmpdir(), 'no-segment-here') }), /unsafe tmp root/)
  const tmpRoot = join(tmpdir(), 'sf-srt-scanners', 'p')
  const plan = planCleanup({ tmpRoot, manifest: { installs: [{ name: 'a', status: 'installed' }, { name: 'b', status: 'failed' }] } })
  assert.deepEqual(plan.removePaths, [tmpRoot])
  assert.deepEqual(plan.names, ['a'])
})

check('C7 resolves via --manifest and --tmp-root', () => {
  // via --manifest
  const box1 = sandbox('sf-srt-clean-'); const f1 = fakeInstall(box1)
  const r1 = cleanupScanners({ manifestPath: join(f1.tmpRoot, 'install-manifest.json') })
  assert.equal(r1.status, 'cleaned')
  assert.ok(!existsSync(f1.tmpRoot))
  assert.ok(existsSync(f1.evidenceFile), 'evidence kept even when driven by --manifest')
  // via --tmp-root
  const box2 = sandbox('sf-srt-clean-'); const f2 = fakeInstall(box2)
  const r2 = cleanupScanners({ tmpRoot: f2.tmpRoot })
  assert.equal(r2.status, 'cleaned')
  assert.ok(!existsSync(f2.tmpRoot))
  assert.ok(existsSync(f2.evidenceFile))
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

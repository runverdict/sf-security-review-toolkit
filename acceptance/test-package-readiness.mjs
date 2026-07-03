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
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { packageReadiness, discoverPackages, rollupReadiness } from '../harness/package-readiness.mjs'

const CLI = fileURLToPath(new URL('../harness/package-readiness.mjs', import.meta.url))
const dirs = []
const mktmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d }

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

// truth-audit: the configured package is source-only (.NEXT, only a 0Ho id), but an
// UNRELATED package's real 04t alias also lives in packageAliases (a dependency, or
// a stale/renamed package — both routine). The old "match ANY 04t alias" marked THIS
// package installable and cited the wrong version. It must read needs-build.
check('cross-package: only an UNRELATED 04t alias present → needs-build (no false installable)', () => {
  const r = packageReadiness({
    packageDirectories: [{ path: 'force-app', package: 'Acme', versionNumber: '1.0.0.NEXT' }],
    packageAliases: {
      Acme: '0Ho5e0000008aBcCAE', // this package: only the 0Ho id, source-only
      'DepLib@2.3.0-4': '04t5e0000004DEPAAU', // a DEPENDENCY package's real version alias
      'OldName@9.9.9-1': '04t5e0000009OLDAAU', // a stale/renamed package's alias
    },
  })
  assert.equal(r.status, 'needs-build')
})

// ── the `registered` field — the needs-build split for the preflight 4-state enum ──
check('registered: a real 0Ho id (no 04t) → needs-build + registered:true (buildable)', () => {
  const r = packageReadiness({
    packageDirectories: [{ path: 'force-app', package: 'Acme', versionNumber: '1.0.0.NEXT' }],
    packageAliases: { Acme: '0Ho5e0000008aBcCAE' },
  })
  assert.equal(r.status, 'needs-build')
  assert.equal(r.registered, true, 'a valid 0Ho alias means build-managed-package can cut a version')
  assert.match(r.reason, /build-managed-package/)
})

check('registered: a PLACEHOLDER 0Ho alias → needs-build + registered:false (unregistered)', () => {
  const r = packageReadiness({
    packageDirectories: [{ path: 'force-app', default: true, package: 'Lumina Forecast Connector', versionNumber: '1.2.0.NEXT' }],
    packageAliases: { 'Lumina Forecast Connector': '0Ho5e000000XXXXCAW' },
  })
  assert.equal(r.status, 'needs-build')
  assert.equal(r.registered, false, 'a placeholder 0Ho alias is not a real Dev-Hub registration')
  assert.match(r.reason, /not created against your Dev Hub/)
})

check('registered: no package-id alias at all → needs-build + registered:false', () => {
  const r = packageReadiness({
    packageDirectories: [{ path: 'force-app', package: 'Acme', versionNumber: '1.0.0.NEXT' }],
    packageAliases: {},
  })
  assert.equal(r.status, 'needs-build')
  assert.equal(r.registered, false)
})

check('registered: installable → registered:true; no-package → registered:false', () => {
  const inst = packageReadiness({
    packageDirectories: [{ path: 'force-app', package: 'Acme', versionNumber: '1.0.0.1' }],
    packageAliases: { Acme: '0Ho5e0000008aBcCAE', 'Acme@1.0.0-1': '04t5e0000004XyZAAU' },
  })
  assert.equal(inst.registered, true)
  assert.equal(packageReadiness(null).registered, false)
})

// ── discoverPackages — NESTED-SFDX discovery (0.8.43, the headline cold-run gap) ──
// A repo whose SFDX packages live in SUBDIRECTORIES (core/ + mcp/, no
// root sfdx-project.json) returned no-package from a root-only read. discoverPackages
// finds them all and classifies each; main() drives it so the CLI reports the roll-up.
const INSTALLABLE_PKG = {
  packageDirectories: [{ path: 'force-app', package: 'Atlas', versionNumber: '1.0.0.1' }],
  packageAliases: { Atlas: '0Ho5e0000008aBcCAE', 'Atlas@1.0.0-1': '04t5e0000004XyZAAU' },
}
const NEEDS_BUILD_PKG = {
  packageDirectories: [{ path: 'force-app', package: 'Relay', versionNumber: '2.0.0.NEXT' }],
  packageAliases: { Relay: '0Ho5e0000009ZyXCAW' },
}
// A nested-only repo: NO root sfdx-project.json, two packages each in a subdir.
const mkNestedRepo = () => {
  const root = mktmp('srt-nested-')
  mkdirSync(join(root, 'core'), { recursive: true })
  writeFileSync(join(root, 'core', 'sfdx-project.json'), JSON.stringify(INSTALLABLE_PKG))
  mkdirSync(join(root, 'mcp'), { recursive: true })
  writeFileSync(join(root, 'mcp', 'sfdx-project.json'), JSON.stringify(NEEDS_BUILD_PKG))
  // decoys that MUST be skipped: a node_modules copy and a too-deep one (> maxDepth)
  mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
  writeFileSync(join(root, 'node_modules', 'pkg', 'sfdx-project.json'), JSON.stringify(INSTALLABLE_PKG))
  return root
}

check('discoverPackages: nested-only repo → finds BOTH, classifies each, anyInstallable roll-up true', () => {
  const root = mkNestedRepo()
  const pkgs = discoverPackages(root)
  assert.equal(pkgs.length, 2, 'both nested packages discovered (node_modules copy skipped)')
  const byRel = Object.fromEntries(pkgs.map((p) => [p.relPath, p.readiness]))
  assert.equal(byRel['core'].status, 'installable', 'the 04t-bound nested package is installable')
  assert.equal(byRel['core'].versionAlias, 'Atlas@1.0.0-1')
  assert.equal(byRel['mcp'].status, 'needs-build', 'the .NEXT nested package needs a build')
  assert.equal(byRel['mcp'].registered, true, 'its 0Ho id means it is registered/buildable')
  assert.equal(pkgs.some((p) => p.readiness.status === 'installable'), true, 'anyInstallable holds across the set')
  // the roll-up rep is the MOST-actionable (the installable one)
  assert.equal(rollupReadiness(pkgs).status, 'installable')
})

check('main() recurses (NOT root-only): CLI --json on a nested-only repo reports the nested packages', () => {
  const root = mkNestedRepo()
  const out = JSON.parse(execFileSync('node', [CLI, '--target', root, '--json'], { encoding: 'utf8' }))
  // a root-only read (the pre-0.8.43 bug) would emit { status:'no-package', … } with no packages[].
  assert.equal(out.anyInstallable, true, 'roll-up reports an installable package — a root-only read would say no-package')
  assert.equal(out.status, 'installable', 'top-level roll-up rep is the installable nested package')
  assert.ok(Array.isArray(out.packages) && out.packages.length === 2, 'packages[] lists every discovered package')
  assert.deepEqual(out.packages.map((p) => p.relPath).sort(), ['core', 'mcp'])
})

check('single-root package: legacy top-level shape preserved + packages[] / anyInstallable ADDED', () => {
  const root = mktmp('srt-root-')
  writeFileSync(join(root, 'sfdx-project.json'), JSON.stringify(INSTALLABLE_PKG))
  // discoverPackages → exactly one entry, relPath '.', roll-up == its readiness
  const pkgs = discoverPackages(root)
  assert.equal(pkgs.length, 1)
  assert.equal(pkgs[0].relPath, '.')
  assert.deepEqual(rollupReadiness(pkgs), pkgs[0].readiness)
  // CLI --json: every key the pure packageReadiness emits is preserved byte-for-byte at the
  // TOP LEVEL (render-preflight + scope-submission read those), plus the additive roll-up.
  const out = JSON.parse(execFileSync('node', [CLI, '--target', root, '--json'], { encoding: 'utf8' }))
  const direct = packageReadiness(JSON.parse(readFileSync(join(root, 'sfdx-project.json'), 'utf8')))
  for (const k of Object.keys(direct)) assert.deepEqual(out[k], direct[k], `legacy top-level key '${k}' preserved`)
  assert.equal(out.anyInstallable, true)
  assert.ok(Array.isArray(out.packages) && out.packages.length === 1 && out.packages[0].relPath === '.')
})

check('no SFDX project anywhere → no-package roll-up (byte-identical legacy single line)', () => {
  const root = mktmp('srt-empty-')
  assert.deepEqual(discoverPackages(root), [])
  assert.equal(rollupReadiness(discoverPackages(root)).status, 'no-package')
  const text = execFileSync('node', [CLI, '--target', root], { encoding: 'utf8' })
  assert.match(text, /^\[no-package\] no readable sfdx-project\.json/, 'unchanged single-line text for the zero-package case')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

#!/usr/bin/env node
/*
 * cleanup-scanners.mjs — ASYMMETRIC, manifest-driven teardown of a consented
 * scanner install (0.6.0 build step 2). The other half of install-scanners.mjs.
 * See docs/roadmap-0.6.0-preflight-autogate.md.
 *
 * THE ASYMMETRY (the whole point). It removes ONLY the tmp tool dir the install
 * created (`/tmp/sf-srt-scanners/<runid>/` — binaries + venvs + the manifest) and
 * KEEPS every evidence file. That holds structurally, not by careful filtering:
 * the tools live under the tmp root; the evidence lives under
 * `<repo>/.security-review/evidence/` — a different tree entirely — so a single
 * `rm -rf <tmpRoot>` can never reach the evidence (the SCI's on-disk proof). It
 * NEVER touches a pre-existing tool either: it only knows the paths the install
 * manifest recorded, all of which are under the tmp root it created.
 *
 * SAFETY (load-bearing). Before removing anything, the resolved tmp root is run
 * through the SAME `assertSafeTmpRoot` the installer used (single source of truth)
 * — it must be a boxed `sf-srt` sub-path under the OS temp dir / ~/.cache. A
 * tampered or garbled manifest whose `tmpRoot` is '/', `$HOME`, or the repo root is
 * REFUSED (nothing removed), so a bad manifest can never become an `rm -rf`
 * disaster. Idempotent: an already-removed tmp dir is a clean no-op. Disclosed,
 * never silent — it prints exactly what it removed and that the evidence was kept,
 * and it marks the project pointer `cleaned` so run-scans knows the tmp tools are
 * gone (and won't think they're still available).
 *
 * Pure decision core `planCleanup(source)` (validate + classify, no I/O) +
 * `cleanupScanners(opts)` (does the one rm). Reads the install manifest / the
 * project pointer; writes only the gitignored pointer — never the partner's source.
 *
 * USAGE: node cleanup-scanners.mjs [--target <repo>] [--manifest <file>] [--tmp-root <dir>] [--json]
 */
import { readFileSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { realpathSync } from 'node:fs'
import { assertSafeTmpRoot, MANIFEST_SCHEMA } from './install-scanners.mjs'

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }
const POINTER_REL = join('.security-review', 'scanner-install.json')

/**
 * PURE. From a resolved tmpRoot (+ optional manifest for disclosure), classify the
 * cleanup and validate safety. Throws (REFUSED) iff the tmpRoot fails the safety
 * guard — a bad/garbled source must never be turned into a removal plan.
 * Returns { tmpRoot, names, removePaths }.
 */
export function planCleanup({ tmpRoot, manifest } = {}) {
  if (!tmpRoot) throw new Error('planCleanup: no tmp root resolved (nothing to clean)')
  const safe = assertSafeTmpRoot(tmpRoot) // throws on an unsafe root → REFUSED
  const names = manifest && Array.isArray(manifest.installs)
    ? manifest.installs.filter((r) => r && r.status === 'installed').map((r) => r.name)
    : []
  return { tmpRoot: safe, names, removePaths: [safe] }
}

/** Resolve the tmp root + manifest from whichever source the caller supplied. */
function resolveSource({ target, manifestPath, tmpRoot }) {
  // 1. explicit --manifest
  if (manifestPath) {
    const m = readJson(manifestPath)
    if (!m || !m.tmpRoot) return { error: `--manifest ${manifestPath} is missing or has no tmpRoot` }
    return { tmpRoot: m.tmpRoot, manifest: m, pointerDir: m.target ? join(m.target, '.security-review') : null }
  }
  // 2. explicit --tmp-root (read its manifest for disclosure if present)
  if (tmpRoot) {
    const m = readJson(join(tmpRoot, 'install-manifest.json'))
    return { tmpRoot, manifest: m, pointerDir: m && m.target ? join(m.target, '.security-review') : null }
  }
  // 3. --target → the gitignored project pointer
  if (target) {
    const ptr = readJson(join(target, POINTER_REL))
    if (!ptr || !ptr.tmpRoot) return { none: true } // nothing recorded → nothing to clean
    const m = readJson(ptr.manifestPath || join(ptr.tmpRoot, 'install-manifest.json'))
    return { tmpRoot: ptr.tmpRoot, manifest: m, pointerDir: join(target, '.security-review'), pointer: ptr }
  }
  return { error: 'no source: pass --target <repo>, --manifest <file>, or --tmp-root <dir>' }
}

/** Mark the project pointer cleaned (disclosure + so run-scans knows the tmp tools are gone). */
function markPointerCleaned(pointerDir, info) {
  if (!pointerDir) return
  const p = join(pointerDir, 'scanner-install.json')
  const prev = readJson(p) || {}
  try {
    writeFileSync(p, JSON.stringify({
      ...prev, status: 'cleaned', cleanedAt: new Date().toISOString(),
      removed: info.removePaths, removedTools: info.names, pathPrepend: [],
    }, null, 2) + '\n')
  } catch { /* pointer is best-effort disclosure, never load-bearing */ }
}

/**
 * Remove the tmp tool dir, keep the evidence. opts: { target, manifestPath, tmpRoot }.
 * Returns { status, tmpRoot, removed, removedTools, evidenceKept }.
 */
export function cleanupScanners(opts = {}) {
  const src = resolveSource(opts)
  if (src.none) return { status: 'nothing-to-clean', removed: [], removedTools: [], note: 'no scanner-install pointer found — nothing was installed by the toolkit' }
  if (src.error) return { status: 'error', error: src.error, removed: [] }

  // Validate + plan (throws REFUSED on an unsafe tmp root — caught and surfaced).
  let plan
  try { plan = planCleanup(src) }
  catch (e) { return { status: 'refused', tmpRoot: src.tmpRoot, error: String(e && e.message || e), removed: [] } }

  const existed = existsSync(plan.tmpRoot)
  if (existed) rmSync(plan.tmpRoot, { recursive: true, force: true })
  const info = { removePaths: plan.removePaths, names: plan.names }
  markPointerCleaned(src.pointerDir, info)

  return {
    status: existed ? 'cleaned' : 'already-clean',
    tmpRoot: plan.tmpRoot,
    removed: existed ? plan.removePaths : [],
    removedTools: plan.names,
    evidenceKept: src.pointerDir ? join(src.pointerDir, 'evidence') : '(unchanged — evidence lives in <repo>/.security-review/evidence/, never under the tmp root)',
  }
}

function main() {
  const argv = process.argv
  const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
  const r = cleanupScanners({ target: arg('--target', null), manifestPath: arg('--manifest', null), tmpRoot: arg('--tmp-root', null) })
  if (argv.includes('--json')) { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); process.exitCode = r.status === 'refused' || r.status === 'error' ? 2 : 0; return }
  const L = ['## cleanup-scanners']
  if (r.status === 'refused') { L.push(`REFUSED — unsafe tmp root, removed nothing: ${r.error}`); process.exitCode = 2 }
  else if (r.status === 'error') { L.push(`error: ${r.error}`); process.exitCode = 2 }
  else if (r.status === 'nothing-to-clean') L.push(r.note)
  else {
    L.push(r.status === 'cleaned' ? `removed the tmp scanner dir: ${r.tmpRoot}` : `already clean (tmp dir gone): ${r.tmpRoot}`)
    if (r.removedTools.length) L.push(`tools removed: ${r.removedTools.join(', ')}`)
    L.push(`evidence KEPT: ${r.evidenceKept}`)
  }
  process.stdout.write(L.join('\n') + '\n')
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) }
  catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

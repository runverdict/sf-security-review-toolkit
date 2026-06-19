#!/usr/bin/env node
/*
 * teardown-stack.mjs — ASYMMETRIC, manifest-driven teardown of a throwaway DAST
 * stack (0.7.0 slice 3). The docker analogue of cleanup-scanners. See
 * docs/roadmap-0.7.0-throwaway-dast-harness.md.
 *
 * Removes EXACTLY the resources standup-stack recorded (the container, a built image,
 * a created network, the tmp dir) and KEEPS every evidence file — evidence lives under
 * `<repo>/.security-review/evidence/`, never in the container or the tmp dir, so the
 * asymmetry is structural. NEVER touches a resource it didn't create: every docker
 * name is checked against the `sf-srt-stack-` / `sf-srt-net-` convention (the docker
 * analogue of assertSafeTmpRoot) and a non-matching name is REFUSED — a tampered
 * manifest can never `docker rm` an unrelated container. Idempotent; guaranteed (works
 * from the manifest alone, so even a crashed stand-up is cleanable); disclosed.
 *
 * Pure `planTeardown` (validate + classify, no I/O) + `teardownStack` (the removals).
 *
 * USAGE: node teardown-stack.mjs [--target <repo>] [--manifest <file>] [--run-id <id>] [--json]
 */
import { readFileSync, writeFileSync, existsSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assertSafeTmpRoot } from './install-scanners.mjs'

const NAME_OK = /^sf-srt-(stack|net)-[A-Za-z0-9][A-Za-z0-9._:-]*$/
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }
const POINTER_REL = join('.security-review', 'stack-standup.json')

/** Guard: a docker resource name we may remove MUST be one we created. Throws otherwise. */
export function assertStackName(name) {
  if (!NAME_OK.test(String(name || ''))) throw new Error(`refusing to remove a non-toolkit docker resource: '${name}'`)
  return name
}

/**
 * PURE. From a manifest, validate the recorded resource names + tmp root and return the
 * removal plan. Throws (REFUSED) on any name/path that isn't ours.
 */
export function planTeardown(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('planTeardown: no manifest')
  const res = manifest.resources || {}
  const container = res.container || null
  const image = res.image || null
  const network = res.network || null
  if (container) assertStackName(container)
  if (image) assertStackName(image)
  if (network) assertStackName(network)
  const tmpRoot = manifest.tmpRoot ? assertSafeTmpRoot(manifest.tmpRoot) : null // throws on an unsafe root
  return { container, image, network, tmpRoot, baseUrl: manifest.baseUrl || null }
}

const quiet = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true } catch { return false } }
const exists = (kind, name) => { try { execFileSync('docker', kind === 'image' ? ['image', 'inspect', name] : kind === 'network' ? ['network', 'inspect', name] : ['inspect', name], { stdio: 'ignore' }); return true } catch { return false } }

/** Resolve the manifest from --target pointer / --manifest / --run-id. */
function resolveManifest({ target, manifestPath, runId }) {
  if (manifestPath) { const m = readJson(manifestPath); return m ? { manifest: m, pointerDir: m.target ? join(m.target, '.security-review') : null } : { error: `--manifest ${manifestPath} unreadable` } }
  if (runId) { const p = join('/tmp', 'sf-srt-stack', runId, 'stack-manifest.json'); const m = readJson(p); return m ? { manifest: m, pointerDir: m.target ? join(m.target, '.security-review') : null } : { error: `no manifest at ${p}` } }
  if (target) {
    const ptr = readJson(join(target, POINTER_REL))
    if (!ptr || !ptr.manifestPath) return { none: true }
    const m = readJson(ptr.manifestPath)
    return m ? { manifest: m, pointerDir: join(target, '.security-review') } : { none: true }
  }
  return { error: 'no source: pass --target, --manifest, or --run-id' }
}

function markCleaned(pointerDir, info) {
  if (!pointerDir) return
  const p = join(pointerDir, 'stack-standup.json'); const prev = readJson(p) || {}
  try { writeFileSync(p, JSON.stringify({ ...prev, status: 'torn-down', removed: info, baseUrl: null }, null, 2) + '\n') } catch {}
}

/** Remove the throwaway, keep the evidence. Returns { status, removed }. */
export function teardownStack(opts = {}) {
  const src = resolveManifest(opts)
  if (src.none) return { status: 'nothing-to-tear-down', removed: [], note: 'no stack-standup pointer — nothing stood up' }
  if (src.error) return { status: 'error', error: src.error, removed: [] }

  let plan
  try { plan = planTeardown(src.manifest) }
  catch (e) { return { status: 'refused', error: String(e.message), removed: [] } }

  const removed = []
  if (plan.container && exists('container', plan.container)) { quiet('docker', ['rm', '-f', plan.container]); removed.push(`container:${plan.container}`) }
  if (plan.image && exists('image', plan.image)) { quiet('docker', ['rmi', '-f', plan.image]); removed.push(`image:${plan.image}`) }
  if (plan.network && exists('network', plan.network)) { quiet('docker', ['network', 'rm', plan.network]); removed.push(`network:${plan.network}`) }
  if (plan.tmpRoot && existsSync(plan.tmpRoot)) { rmSync(plan.tmpRoot, { recursive: true, force: true }); removed.push(`tmp:${plan.tmpRoot}`) }
  markCleaned(src.pointerDir, removed)
  return {
    status: removed.length ? 'torn-down' : 'already-clean',
    removed,
    evidenceKept: src.pointerDir ? join(src.pointerDir, 'evidence') : '(evidence lives in <repo>/.security-review/evidence/, never in the container or tmp dir)',
  }
}

function main() {
  const argv = process.argv
  const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
  const r = teardownStack({ target: arg('--target', null), manifestPath: arg('--manifest', null), runId: arg('--run-id', null) })
  if (argv.includes('--json')) { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); process.exitCode = (r.status === 'refused' || r.status === 'error') ? 2 : 0; return }
  const L = ['## teardown-stack']
  if (r.status === 'refused') { L.push(`REFUSED — ${r.error} (removed nothing)`); process.exitCode = 2 }
  else if (r.status === 'error') { L.push(`error: ${r.error}`); process.exitCode = 2 }
  else if (r.status === 'nothing-to-tear-down') L.push(r.note)
  else { L.push(r.status === 'torn-down' ? `removed: ${r.removed.join(', ')}` : 'already clean'); L.push(`evidence KEPT: ${r.evidenceKept}`) }
  process.stdout.write(L.join('\n') + '\n')
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) }
  catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

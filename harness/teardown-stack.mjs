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
 * manifest can never `docker rm` an unrelated container. A `compose` manifest tears
 * down as a PROJECT: one `docker compose -p <project> down -v --remove-orphans`
 * removes all the project's containers + network + volumes atomically (no per-name
 * enumeration), and the project NAME must pass the same toolkit-name gate first — a
 * tampered manifest can never `down` a foreign project. Idempotent; guaranteed (works
 * from the manifest alone, so even a crashed stand-up is cleanable); disclosed.
 *
 * Pure `planTeardown` (validate + classify, no I/O) + `teardownStack` (the removals).
 *
 * USAGE: node teardown-stack.mjs [--target <repo>] [--manifest <file>] [--run-id <id>] [--sweep] [--json]
 */
import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assertSafeTmpRoot } from './install-scanners.mjs'

const NAME_OK = /^sf-srt-(stack|net)-[A-Za-z0-9][A-Za-z0-9._:-]*$/
// a compose PROJECT must be the run-name itself (`sf-srt-stack-<runId>`) — stricter
// than NAME_OK (no `sf-srt-net-` form): the project name scopes an entire `down`
const PROJECT_OK = /^sf-srt-stack-[A-Za-z0-9][A-Za-z0-9._-]*$/
// compose project resources carry `_` separators (`<project>_default`, `<project>_<vol>`)
// that the strict NAME_OK class deliberately lacks — this wider (still name-scoped) form
// is used ONLY by the sweep's network/volume removal, never for arbitrary names
const COMPOSE_RES_OK = /^sf-srt-stack-[A-Za-z0-9][\w.:-]*$/
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }
const POINTER_REL = join('.security-review', 'stack-standup.json')

/** Guard: a docker resource name we may remove MUST be one we created. Throws otherwise. */
export function assertStackName(name) {
  if (!NAME_OK.test(String(name || ''))) throw new Error(`refusing to remove a non-toolkit docker resource: '${name}'`)
  return name
}

/** Guard: a compose PROJECT we may `down` MUST be one we created (run-name-scoped). */
export function assertProjectName(name) {
  if (!PROJECT_OK.test(String(name || ''))) throw new Error(`refusing to tear down a non-toolkit compose project: '${name}'`)
  return name
}

/**
 * PURE. From a manifest, validate the recorded resource names + tmp root and return the
 * removal plan. Throws (REFUSED) on any name/path that isn't ours.
 */
export function planTeardown(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('planTeardown: no manifest')
  if (manifest.kind === 'compose') {
    // project-scoped teardown: the project NAME is the security boundary — it is
    // asserted BEFORE any `down`, so a tampered manifest can never down a foreign project
    const project = assertProjectName(manifest.project || (manifest.resources && manifest.resources.container))
    const tmpRoot = manifest.tmpRoot ? assertSafeTmpRoot(manifest.tmpRoot) : null // throws on an unsafe root
    return { kind: 'compose', project, composeFile: manifest.composeFile || null, overridePath: manifest.overridePath || null, tmpRoot, baseUrl: manifest.baseUrl || null }
  }
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

/**
 * PURE (0.8.109). The same-run compose `down` argv. `--rmi local` removes images the project
 * BUILT this run — the locally-built, project-tagged `<project>-<svc>` images a
 * build-succeeds/health-fails run leaves on disk until a later `--sweep`. `local` (NOT `all`)
 * is deliberate: a PREBUILT image the partner shipped (`myapp-api:latest` — a custom registry
 * tag) is NOT locally built, so `--rmi local` leaves it untouched (we never remove a partner
 * artifact). `composeFile`/`overridePath` are passed already existence-checked by the caller.
 */
export function composeDownArgs(project, { composeFile = null, overridePath = null } = {}) {
  const args = ['compose', '-p', project]
  if (composeFile) args.push('-f', composeFile)
  if (overridePath) args.push('-f', overridePath)
  args.push('down', '-v', '--rmi', 'local', '--remove-orphans')
  return args
}
const exists = (kind, name) => { try { execFileSync('docker', kind === 'image' ? ['image', 'inspect', name] : kind === 'network' ? ['network', 'inspect', name] : ['inspect', name], { stdio: 'ignore' }); return true } catch { return false } }

/** Resolve the manifest from --target pointer / --manifest / --run-id. */
function resolveManifest({ target, manifestPath, runId }) {
  if (manifestPath) { const m = readJson(manifestPath); return m ? { manifest: m, pointerDir: m.target ? join(m.target, '.security-review') : null } : { error: `--manifest ${manifestPath} unreadable` } }
  if (runId) { const p = join(tmpdir(), 'sf-srt-stack', runId, 'stack-manifest.json'); const m = readJson(p); return m ? { manifest: m, pointerDir: m.target ? join(m.target, '.security-review') : null } : { error: `no manifest at ${p}` } }
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

  // a compose stack tears down as ONE project-scoped `down` (name already asserted)
  if (plan.kind === 'compose') return teardownCompose(plan, src)

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

const runOut = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return '' } }

/**
 * Compose teardown: ONE project-scoped `docker compose down -v --remove-orphans`
 * removes all the project's containers + the default network + volumes atomically —
 * no per-name enumeration. `planTeardown` already asserted the project name is ours.
 * The tmp dir (override + env files) is removed; evidence is KEPT, as ever.
 */
function teardownCompose(plan, src) {
  const removed = []
  const label = `label=com.docker.compose.project=${plan.project}`
  const ctrs = runOut('docker', ['ps', '-aq', '--filter', label]).split('\n').filter(Boolean)
  const nets = runOut('docker', ['network', 'ls', '-q', '--filter', label]).split('\n').filter(Boolean)
  const vols = runOut('docker', ['volume', 'ls', '-q', '--filter', label]).split('\n').filter(Boolean)
  // `down` works from the project label even if the compose files are gone — pass the
  // files when they still exist (exact reconstruction), fall back to `-p` alone otherwise.
  // `--rmi local` (via the pure composeDownArgs helper) removes the same-run built image so a
  // build-succeeds/health-fails run doesn't strand a `<project>-*` image until a later `--sweep`.
  const composeFile = (plan.composeFile && existsSync(plan.composeFile)) ? plan.composeFile : null
  const overridePath = (plan.overridePath && existsSync(plan.overridePath)) ? plan.overridePath : null
  quiet('docker', composeDownArgs(plan.project, { composeFile, overridePath }))
  if (ctrs.length || nets.length || vols.length) removed.push(`compose-project:${plan.project} (${ctrs.length} containers, ${nets.length} networks, ${vols.length} volumes)`)
  if (plan.tmpRoot && existsSync(plan.tmpRoot)) { rmSync(plan.tmpRoot, { recursive: true, force: true }); removed.push(`tmp:${plan.tmpRoot}`) }
  markCleaned(src.pointerDir, removed)
  return {
    status: removed.length ? 'torn-down' : 'already-clean',
    removed,
    evidenceKept: src.pointerDir ? join(src.pointerDir, 'evidence') : '(evidence lives in <repo>/.security-review/evidence/, never in the container or tmp dir)',
  }
}

/**
 * SWEEP: remove EVERY toolkit throwaway container + tmp tree (orphan cleanup from a crashed
 * run where the same-run teardown never fired). Name-scoped — only ever touches
 * `sf-srt-stack-*` containers/images/networks/volumes (compose projects included) and
 * `<tmpdir>/sf-srt-{stack,dast}/*` trees, never anything else; evidence (in the repo) is
 * untouched. This is the engine-backed backstop for the "always tear down" guarantee an
 * LLM-orchestrated multi-process run can't make on its own.
 */
export function sweepStacks() {
  const removed = []
  for (const n of runOut('docker', ['ps', '-aq', '--filter', 'name=sf-srt-stack-', '--format', '{{.Names}}']).split('\n').filter(Boolean)) {
    if (NAME_OK.test(n)) { quiet('docker', ['rm', '-f', n]); removed.push(`container:${n}`) }
  }
  for (const img of runOut('docker', ['images', '--filter', 'reference=sf-srt-stack-*', '--format', '{{.Repository}}:{{.Tag}}']).split('\n').filter(Boolean)) {
    if (NAME_OK.test(img)) { quiet('docker', ['rmi', '-f', img]); removed.push(`image:${img}`) }
  }
  // compose residue (a crashed compose run): the container filter above already catches
  // the `<project>-<svc>-N` names, but the project NETWORK (`<project>_default`) and
  // VOLUMES (`<project>_<name>`) need their own name-scoped removal — same `sf-srt-stack-`
  // convention, so only toolkit resources are ever touched (evidence is in the repo, untouched)
  for (const n of runOut('docker', ['network', 'ls', '--filter', 'name=sf-srt-stack-', '--format', '{{.Name}}']).split('\n').filter(Boolean)) {
    if (COMPOSE_RES_OK.test(n)) { quiet('docker', ['network', 'rm', n]); removed.push(`network:${n}`) }
  }
  for (const v of runOut('docker', ['volume', 'ls', '--filter', 'name=sf-srt-stack-', '--format', '{{.Name}}']).split('\n').filter(Boolean)) {
    if (COMPOSE_RES_OK.test(v)) { quiet('docker', ['volume', 'rm', '-f', v]); removed.push(`volume:${v}`) }
  }
  for (const group of [join(tmpdir(), 'sf-srt-stack'), join(tmpdir(), 'sf-srt-dast')]) {
    let subs = []; try { subs = readdirSync(group) } catch {}
    for (const s of subs) {
      const d = join(group, s)
      try { assertSafeTmpRoot(d); rmSync(d, { recursive: true, force: true }); removed.push(`tmp:${d}`) } catch { /* skip anything not a safe per-run dir */ }
    }
  }
  return { status: removed.length ? 'swept' : 'already-clean', removed }
}

function main() {
  const argv = process.argv
  const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
  if (argv.includes('--sweep')) {
    const s = sweepStacks()
    process.stdout.write((argv.includes('--json') ? JSON.stringify(s, null, 2) : `## teardown-stack --sweep — ${s.status}${s.removed.length ? ': ' + s.removed.join(', ') : ''}`) + '\n')
    return
  }
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

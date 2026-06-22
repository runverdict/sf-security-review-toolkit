#!/usr/bin/env node
/*
 * standup-stack.mjs — consented stand-up of a throwaway, prod-equivalent backend in
 * an ISOLATED container, for an active DAST against a disposable mirror (0.7.0
 * slice 3). The server-tier analogue of install-scanners. Paired with
 * teardown-stack.mjs. See docs/roadmap-0.7.0-throwaway-dast-harness.md.
 *
 * THE PROTOTYPE'S LESSONS, ENCODED:
 *   • COPY the source INTO the container (docker create → docker cp → start), never
 *     bind-mount it — a container writes node_modules as root and the host then can't
 *     clean them up. The throwaway's working tree is ephemeral inside the container
 *     and dies with `docker rm`; only the EVIDENCE is extracted to the host.
 *   • Synthesize the self-contained secrets (the toolkit sets a random JWT/API secret
 *     on the throwaway → it can mint its own auth tokens for an authenticated scan).
 *     Secret VALUES live only in the container's runtime env; the manifest records
 *     the NAMES only, and the values are burned at teardown.
 *   • Publish on 127.0.0.1 only (isolation), and record a manifest of EXACTLY the
 *     resources created so teardown removes precisely those.
 *
 * It FAILS CLOSED without explicit consent (standing up a container + active scanning
 * is a live op). PURE planner `planStandup` (deterministic spec) + impure executor
 * `standupStack` (docker). This slice supports the `node` recipe (the common external-
 * API shape); `dockerfile`/`compose` are a later slice (returned as unsupported, honest).
 *
 * USAGE: node standup-stack.mjs --target <repo> --consent [--run-id <id>] [--port N] [--json]
 */
import {
  mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { assertSafeTmpRoot } from './install-scanners.mjs'
import { envStatus } from './scaffold-env.mjs'
import { dockerStatus } from './docker-check.mjs'
import { verifyConsent } from './record-consent.mjs'

export const STACK_SCHEMA = 'sf-srt-stack/1'
export const NAME_PREFIX = 'sf-srt-stack'
const RUN_ID_OK = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const NODE_BASE = 'node:18-alpine'

/** Resource names are derived ONLY from the validated run-id → teardown can name-scope. */
export function stackNames(runId) {
  if (!RUN_ID_OK.test(String(runId || ''))) throw new Error(`standup-stack: invalid run-id '${runId}'`)
  return { container: `${NAME_PREFIX}-${runId}`, image: `${NAME_PREFIX}-${runId}:throwaway`, network: `sf-srt-net-${runId}` }
}

/**
 * PURE. From a stack-detect result, compute the throwaway stand-up spec.
 * Deterministic given (stack, runId, tmpRoot, port). Throws on an unrunnable stack.
 */
export function planStandup(stack, { runId, target, tmpRoot, port, envFile } = {}) {
  if (!RUN_ID_OK.test(String(runId || ''))) throw new Error(`planStandup: invalid run-id '${runId}'`)
  if (!target) throw new Error('planStandup: target repo required')
  assertSafeTmpRoot(tmpRoot)
  // 'runnable' stands up directly; a 'needs-secrets' stack stands up only once an
  // operator-filled env-file satisfies the external creds (the scaffold-env loop).
  const ok = stack && (stack.status === 'runnable' || (stack.status === 'needs-secrets' && envFile))
  if (!ok) {
    throw new Error(`planStandup: stack is '${stack && stack.status}', not standable — resolve recipe/secrets first (needs-secrets needs a filled --env-file via scaffold-env)`)
  }
  const recipe = stack.recipe || {}
  const names = stackNames(runId)
  const webPort = Number(port || (stack.webTier && stack.webTier.port) || 8080)
  if (!Number.isInteger(webPort) || webPort < 1 || webPort > 65535) {
    throw new Error(`planStandup: invalid port '${port || (stack.webTier && stack.webTier.port)}'`)
  }
  if (recipe.kind !== 'node') {
    return { schema: STACK_SCHEMA, runId, unsupported: recipe.kind || 'unknown',
      reason: `standup of a '${recipe.kind}' recipe is a later slice; this slice stands up 'node' (copy-in) only` }
  }
  const root = recipe.root || '.'
  const sourceDir = root === '.' ? target : join(target, root)
  const entry = recipe.entry || 'index.js'
  // env the toolkit fabricates for the throwaway: synthesizable secrets get random
  // values (set at execution, never in the plan); benign vars get safe defaults.
  const synthNames = (stack.env && stack.env.synthesizable) || []
  const benign = { PORT: String(webPort), NODE_ENV: 'production', HOST: '0.0.0.0' }
  return {
    schema: STACK_SCHEMA, runId, kind: 'node',
    container: names.container, image: null, network: null, baseImage: NODE_BASE,
    host: '127.0.0.1', port: webPort, baseUrl: `http://127.0.0.1:${webPort}`,
    sourceDir, entry, workdir: '/app',
    command: `npm install --no-audit --no-fund --loglevel=error && node ${entry}`,
    synthEnvNames: [...synthNames], benignEnv: benign,
    // operator-filled external creds (from scaffold-env) loaded via docker --env-file →
    // the VALUES go straight into the container, never into argv or the manifest.
    envFile: envFile || null, externalEnvNames: (stack.env && stack.env.external) || [],
    tmpRoot, manifestPath: join(tmpRoot, 'stack-manifest.json'),
    pointerRel: join('.security-review', 'stack-standup.json'),
  }
}

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const quiet = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true } catch { return false } }

/** Is something listening on the published URL? (any HTTP status = connected; refused = down) */
function listening(url) { try { execFileSync('curl', ['-sS', '-o', '/dev/null', '--max-time', '3', url], { stdio: 'ignore' }); return true } catch { return false } }

/** Write the manifest + the gitignored project pointer (NAMES only — never secret values). */
function writeManifest(plan, rec, target) {
  mkdirSync(plan.tmpRoot, { recursive: true, mode: 0o700 })
  const manifest = {
    schema: plan.schema, runId: plan.runId, kind: plan.kind,
    resources: { container: plan.container, image: rec.builtImage || null, network: rec.network || null },
    host: plan.host, port: plan.port, baseUrl: plan.baseUrl,
    synthEnvNames: plan.synthEnvNames, // NAMES only; the random values live only in the container env
    status: rec.status, createdAt: rec.createdAt, log: rec.log || '',
    tmpRoot: plan.tmpRoot, target: target || null,
  }
  writeFileSync(plan.manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  if (target) {
    try {
      const dir = join(target, '.security-review'); mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'stack-standup.json'), JSON.stringify({
        schema: plan.schema, runId: plan.runId, container: plan.container, baseUrl: plan.baseUrl,
        manifestPath: plan.manifestPath, status: rec.status, createdAt: rec.createdAt,
      }, null, 2) + '\n')
    } catch { /* pointer is best-effort */ }
  }
  return manifest
}

/**
 * IMPURE executor. Stands the throwaway up. FAILS CLOSED without consent.
 * opts: { consent, target, createdAt(ISO), timeoutMs }
 */
export function standupStack(plan, { consent = false, target, createdAt, timeoutMs = 90000 } = {}) {
  assertSafeTmpRoot(plan.tmpRoot)
  if (plan.unsupported) return { status: 'unsupported', reason: plan.reason }
  if (consent !== true) {
    throw new Error('standup-stack: refusing to stand up a live container without explicit consent (a live op + active scan). Pass --consent.')
  }
  // Docker is the containerized-throwaway prerequisite — fail with an honest hint, not a
  // raw `docker: not found` (audit/portability: a docker-less user gets graceful guidance).
  const dock = dockerStatus()
  if (!dock.runnable) return { status: 'no-docker', reason: dock.hint, resources: { container: plan.container, image: null, network: null } }
  // needs-secrets: the supplied env-file must actually be FILLED (deterministic re-check),
  // not merely present — else we'd stand up with empty externals (audit: unfilled-env-file).
  if (plan.envFile) {
    const content = existsSync(plan.envFile) ? readFileSync(plan.envFile, 'utf8') : ''
    const st = envStatus(content, plan.externalEnvNames || [])
    if (!st.ready) return { status: 'needs-secrets', reason: `env-file is missing ${st.missing.join(', ') || '(file absent)'} — fill it (scaffold-env) before stand-up`, resources: { container: plan.container, image: null, network: null } }
  }

  const stamp = createdAt || new Date().toISOString()
  const rec = { status: 'creating', createdAt: stamp, network: null, builtImage: null, log: '' }

  // Secret VALUES go via env-FILEs, never the docker argv — so they don't appear in host
  // process listings (audit: no secret on argv). The synth file lives in tmpRoot (0600),
  // destroyed at teardown. The operator-filled external file (if any) is a second --env-file.
  mkdirSync(plan.tmpRoot, { recursive: true, mode: 0o700 })
  const synthFile = join(plan.tmpRoot, '.synth.env')
  writeFileSync(synthFile, [
    ...Object.entries(plan.benignEnv).map(([k, v]) => `${k}=${v}`),
    ...plan.synthEnvNames.map((n) => `${n}=${randomBytes(24).toString('hex')}`),
  ].join('\n') + '\n', { mode: 0o600 })
  const fileArgs = ['--env-file', synthFile]
  if (plan.envFile && existsSync(plan.envFile)) fileArgs.push('--env-file', plan.envFile)

  // Name-stub manifest written BEFORE create (names are deterministic) so a create/start
  // crash is still teardown-able — never orphan a secret-bearing container (audit: orphan).
  writeManifest(plan, rec, target)

  // Best-effort teardown safety net for THIS process's synchronous window: a SIGINT/SIGTERM/
  // fatal between create and teardown must not leave a secret-bearing container up (audit:
  // guaranteed teardown). teardown-stack remains the authoritative removal.
  const cleanup = () => { try { execFileSync('docker', ['rm', '-f', plan.container], { stdio: 'ignore' }) } catch {} }
  const handlers = {
    SIGINT: () => { cleanup(); process.exit(130) },
    SIGTERM: () => { cleanup(); process.exit(143) },
    uncaughtException: (e) => { cleanup(); throw e },
  }
  for (const [s, h] of Object.entries(handlers)) process.on(s, h)
  try {
    quiet('docker', ['rm', '-f', plan.container]) // clear any stale same-name container
    // COPY-IN, not bind-mount: create → cp source → start (working tree stays in the container).
    run('docker', ['create', '--name', plan.container, '-p', `${plan.host}:${plan.port}:${plan.port}`,
      ...fileArgs, '-w', plan.workdir, plan.baseImage, 'sh', '-c', plan.command])
    run('docker', ['cp', `${plan.sourceDir}/.`, `${plan.container}:${plan.workdir}`])
    run('docker', ['start', plan.container])
    rec.status = 'starting'
    const deadline = Date.now() + timeoutMs
    let up = false
    while (Date.now() < deadline) {
      if (listening(plan.baseUrl + '/healthz') || listening(plan.baseUrl + '/')) { up = true; break }
      const running = (() => { try { return run('docker', ['inspect', '-f', '{{.State.Running}}', plan.container]).trim() === 'true' } catch { return false } })()
      if (!running) break
      execFileSync('sleep', ['1'])
    }
    rec.status = up ? 'up' : 'failed'
    // We deliberately do NOT capture `docker logs`: partner app boot output can echo
    // operator-filled secrets, and persisting it would violate the NAMES-only contract
    // (audit: container-log leak). rec.log carries only this toolkit message.
    if (!up) rec.log = 'stand-up failed: the web tier did not become reachable in time (run `docker logs` yourself while the container exists — the toolkit does not capture it, to avoid persisting secret-bearing app output)'
  } catch (e) {
    rec.status = 'failed'
    rec.log = 'stand-up failed during a docker step (the toolkit does not capture container output, to avoid persisting secrets)'
  } finally {
    for (const [s, h] of Object.entries(handlers)) process.removeListener(s, h)
  }
  return writeManifest(plan, rec, target)
}

function main() {
  const argv = process.argv
  const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
  const target = arg('--target', process.cwd())
  const runId = arg('--run-id', `${Date.now().toString(36)}-${process.pid}-${randomBytes(3).toString('hex')}`)
  const tmpRoot = arg('--tmp-root', join(tmpdir(), 'sf-srt-stack', runId))
  // --consent alone is insufficient: a recorded affirmative 'throwaway-dast' consent
  // (the journey's third gate, asked via AskUserQuestion) is also required.
  const consentFlag = argv.includes('--consent')
  const consentRecorded = verifyConsent('throwaway-dast', { target })
  const consent = consentFlag && consentRecorded
  const asJson = argv.includes('--json')
  const portArg = arg('--port', null)
  const envFile = arg('--env-file', null) // operator-filled externals (scaffold-env)

  // stack-detect's CLI already returns the classified result — use it directly.
  const stackDetect = fileURLToPath(new URL('./stack-detect.mjs', import.meta.url))
  const stack = JSON.parse(run('node', [stackDetect, '--target', target, '--json']))
  let plan
  try { plan = planStandup(stack, { runId, target, tmpRoot, port: portArg, envFile }) }
  catch (e) {
    const msg = { status: 'not-runnable', stackStatus: stack.status, error: String(e.message) }
    process.stdout.write((asJson ? JSON.stringify(msg, null, 2) : `## standup-stack — cannot stand up: ${msg.error}`) + '\n')
    process.exitCode = 3; return
  }
  if (plan.unsupported) { process.stdout.write((asJson ? JSON.stringify({ status: 'unsupported', plan }, null, 2) : `## standup-stack — ${plan.reason}`) + '\n'); process.exitCode = 3; return }
  if (!consent) {
    const why = consentFlag && !consentRecorded
      ? `--consent is set but no affirmative consent is recorded for gate 'throwaway-dast' (the flag alone is not enough). Ask + record it first via record-consent.mjs.`
      : `re-run with --consent (and the recorded consent).`
    process.stdout.write(`## standup-stack — NOT STARTED (no consent)\nWould stand up ${plan.container} (${plan.kind}) on ${plan.baseUrl}; synth env: ${plan.synthEnvNames.join(', ') || 'none'}.\n${why}\n`); process.exitCode = 3; return
  }

  const m = standupStack(plan, { consent, target })
  if (asJson) { process.stdout.write(JSON.stringify(m, null, 2) + '\n'); if (m.status !== 'up') process.exitCode = 1; return }
  process.stdout.write(`## standup-stack — ${m.status}\ncontainer: ${m.resources.container}   url: ${m.baseUrl}\nsynth env (names): ${m.synthEnvNames.join(', ') || 'none'}\nteardown: node harness/teardown-stack.mjs --target <repo>\n${m.status !== 'up' ? 'LOG: ' + (m.log || '').split('\n').pop() : ''}\n`)
  if (m.status !== 'up') process.exitCode = 1
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) }
  catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

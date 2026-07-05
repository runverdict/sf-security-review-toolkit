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
 * `standupStack` (docker). Supported recipes: `node` + `python` (copy-in — toolkit base
 * image, source copied in), `dockerfile` (build-then-run — the partner's own
 * Dockerfile brings the source + base image; the built image carries the toolkit
 * run-name so teardown removes it), and `compose` (multi-container — docker's OWN
 * parser resolves the file [`docker compose config --format json`; the harness bundles
 * no YAML lib], the PURE `planCompose` picks the web tier and templates a loopback
 * override that rebinds it to 127.0.0.1 and strips every other service's host ports,
 * and the whole project runs under the toolkit run-name so teardown-stack can remove
 * it project-scoped). `procfile` is returned as unsupported, honest.
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
// compose service names land in the string-templated loopback override — only plain
// one-line YAML keys are accepted (anything else could inject structure into the
// override we generate, so it is REFUSED, not escaped)
const SERVICE_OK = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const NODE_BASE = 'node:18-alpine'
export const PYTHON_BASE = 'python:3.12-slim' // pinned minor tag, never :latest (same discipline as NODE_BASE)

// Health vocabulary (Slice B1): the terminal state of a stand-up, written into
// stack-standup.json.status. run-dast / capture-openapi / the base-url resolver import
// this — no hard-coded status strings anywhere downstream.
export const HEALTH_STATES = Object.freeze({ UP: 'up', UNHEALTHY: 'unhealthy', FAILED: 'failed', UNKNOWN: 'unknown', REDIRECT_ONLY: 'redirect-only' })
// Statuses that ABORT the run (exitCode 1). unhealthy / redirect-only DEGRADE — the scan
// still runs, with a loud caveat — rather than abort: the honesty floor is a degraded
// label, not a hard stop.
export const FATAL_STATUS = new Set(['failed', 'unknown', 'no-docker', 'no-compose', 'unsupported', 'needs-secrets'])

// PYTHON RUN HEURISTIC (deterministic — the command is a pure function of the recipe):
// install from `requirements.txt` when the recipe root has one, else `pyproject.toml`/
// `Pipfile` (`pip install .`), else no install — resolved by the shell INSIDE the
// container so the planner stays pure (an `if` with no matched branch exits 0, so the
// run command still starts). Run: `manage.py` → the Django dev server; `asgi.py`/
// `wsgi.py` → the conventional `<module>:application` via uvicorn/gunicorn (installed
// by the dependency file, or the stand-up fails honestly); anything else →
// `python <entry>` with HOST/PORT in the env. Every variant binds 0.0.0.0 INSIDE the
// container so the 127.0.0.1-only host publish reaches it.
const PY_INSTALL = 'if [ -f requirements.txt ]; then pip install --no-input --quiet -r requirements.txt; elif [ -f pyproject.toml ] || [ -f Pipfile ]; then pip install --no-input --quiet .; fi'
function pythonRunCommand(recipe, port) {
  const run = recipe && recipe.run
  if (run && run.server) {
    const m = run.module
    if (run.server === 'uvicorn') return `python -m uvicorn ${m}:${run.factory || run.var}${run.factory ? ' --factory' : ''} --host 0.0.0.0 --port ${port}`
    if (run.server === 'gunicorn') return `python -m gunicorn --bind 0.0.0.0:${port} ${run.factory ? `"${m}:${run.factory}()"` : `${m}:${run.var}`}`
    if (run.server === 'flask') return `python -m flask --app ${m}:${run.factory || run.var} run --host 0.0.0.0 --port ${port}`
    if (run.server === 'self') return `python ${recipe.entry}`
  }
  // fallback (recipe.run absent) — the legacy entry-name branches keep U9/U11 green
  const entry = recipe && recipe.entry
  if (entry === 'manage.py') return `python manage.py runserver 0.0.0.0:${port}`
  if (entry === 'asgi.py') return `python -m uvicorn asgi:application --host 0.0.0.0 --port ${port}`
  if (entry === 'wsgi.py') return `python -m gunicorn --bind 0.0.0.0:${port} wsgi:application`
  return `python ${entry}`
}

// ── Health classification (pure seams — the hermetic core of the stand-up honesty) ──

/**
 * PURE. Classify ONE HTTP status code from a liveness probe → 'up' | 'unhealthy' | 'retry'.
 * The ONE retunable predicate. `isRoot` is load-bearing: a 3xx/4xx on `/` means the server
 * is ANSWERING (liveness), so a no-root JSON API (FastAPI/Express under /api that 404s on /)
 * classifies `up`, NOT failed — a naive "404 → keep trying" aborts the DAST on a healthy app.
 */
export function classifyHealthCode(code, { isRoot = false } = {}) {
  const c = Number(code)
  if (c >= 200 && c < 300) return 'up'
  if (c === 401 || c === 403 || c === 405) return 'up'   // answering, auth/method-guarded
  if (c >= 500 && c < 600) return 'unhealthy'            // alive but server-erroring
  if (isRoot && c >= 300 && c < 500) return 'up'         // 3xx/4xx on / == the server is answering
  return 'retry'                                          // 000, or a non-root 3xx/404 (probe path absent)
}

/**
 * PURE. Terminal health from the probe observations + whether the container is still
 * running. `up` wins (covers a transient-5xx-then-2xx window); a dead container is `failed`;
 * a running-but-5xx surface is `unhealthy`; an http→https-only surface is `redirect-only`;
 * running-but-never-answered is `unknown` (likely the wrong tier/port — cross-ref --port).
 */
export function resolveHealth({ observedUp, observedUnhealthy, observedRedirectOnly, containerRunning } = {}) {
  if (observedUp) return HEALTH_STATES.UP
  if (!containerRunning) return HEALTH_STATES.FAILED
  if (observedUnhealthy) return HEALTH_STATES.UNHEALTHY
  if (observedRedirectOnly) return HEALTH_STATES.REDIRECT_ONLY
  return HEALTH_STATES.UNKNOWN
}

/**
 * PURE. Map a `docker inspect` container-health string to our vocabulary. Honors the
 * partner's OWN declared HEALTHCHECK — the most honest readiness signal available. An empty
 * string (no declared healthcheck) falls through to the HTTP liveness probe.
 */
export function mapDockerHealth(s) {
  const v = String(s || '').trim().toLowerCase()
  if (v === 'healthy') return 'up'
  if (v === 'unhealthy') return 'unhealthy'
  if (v === 'starting') return 'retry'
  return '' // none declared → let the HTTP probe decide
}

/**
 * PURE. The stand-up health note. Never claims clean/healthy/prod-equivalent on a non-`up`
 * status; every `up` carries the universal liveness-only caveat (readiness NOT asserted).
 */
export function standupHealthNote(status, { guarded = false, saw400 = false } = {}) {
  if (status === HEALTH_STATES.UP) {
    return (guarded
      ? 'liveness-verified but the target answered only auth/method-guarded — unauthenticated coverage is a floor, not a bill of health; '
      : '') + 'liveness-verified only; readiness NOT asserted; DB-backed endpoints unverified (may error); NOT the production-equivalent scan'
  }
  if (status === HEALTH_STATES.UNHEALTHY) return 'DEGRADED: the throwaway booted but the web tier returned 5xx — liveness/header-level only; DB-backed endpoints unverified (may error); the corroborating scan continues with a degraded label'
  if (status === HEALTH_STATES.REDIRECT_ONLY) return 'DEGRADED: the app forces https and the throwaway serves http — only redirects were observed; the baseline reached little surface'
  if (status === HEALTH_STATES.UNKNOWN) return saw400
    ? 'the container is running but every liveness path returned 400 — likely a Host-header/ALLOWED_HOSTS rejection; the baseline reached little surface (re-run with the right host or --port)'
    : 'the container is running but never answered on any liveness path — the detected web tier may be wrong (re-run with --port), or the app bound to container-localhost; set HOST=0.0.0.0 / -b 0.0.0.0 / ASPNETCORE_URLS=http://0.0.0.0:PORT / server.address=0.0.0.0 by stack'
  return 'stand-up failed: the web tier did not become reachable in time (run docker logs / docker compose logs yourself while the container exists — the toolkit does not capture it, to avoid persisting secret-bearing app output)'
}

/**
 * PURE (Slice D). Run-id integrity (Option 1 — NOT tmpRoot-derivation, which would break
 * `teardown --run-id`): a TOOLKIT-convention env-file path
 * (`.../sf-srt-stack/<id>/<name>.env`) whose embedded id != runId is REFUSED (orphan
 * prevention — the filled secret stub would live in a tmp dir teardown never destroys). A
 * non-convention custom path is allowed (the operator owns its lifecycle).
 */
export function checkEnvFileRunId(envFile, runId) {
  const m = String(envFile || '').match(/[\\/]sf-srt-stack[\\/]([A-Za-z0-9][A-Za-z0-9._-]*)[\\/][^\\/]+\.env$/)
  if (m && m[1] !== runId) throw new Error(`checkEnvFileRunId: env-file '${envFile}' belongs to run '${m[1]}', not '${runId}' — refusing (orphan prevention); use the matching --run-id or a custom path`)
  return true
}

/**
 * PURE (Slice D). Port-collision decision: a pre-existing dev service already on the loopback
 * port would be read as `up` and scanned, misattributing findings to the partner. `freeBefore`
 * = was the port free before we published; `ownedAfter` = does OUR container own the socket.
 * The impure probe is operator-cold-run-only; this predicate is the retunable decision.
 */
export function classifyPortOwnership({ freeBefore, ownedAfter } = {}) {
  if (!freeBefore && !ownedAfter) return { ok: false, reason: 'a pre-existing service already held the loopback port before stand-up and our container does not own it — refusing to scan (findings would be misattributed to the partner); free the port or pass --port' }
  if (!ownedAfter) return { ok: false, reason: 'our container does not own the published loopback socket after stand-up — refusing to scan' }
  return { ok: true, reason: null }
}

/** Resource names are derived ONLY from the validated run-id → teardown can name-scope. */
export function stackNames(runId) {
  if (!RUN_ID_OK.test(String(runId || ''))) throw new Error(`standup-stack: invalid run-id '${runId}'`)
  return { container: `${NAME_PREFIX}-${runId}`, image: `${NAME_PREFIX}-${runId}:throwaway`, network: `sf-srt-net-${runId}` }
}

/**
 * PURE. From a stack-detect result, compute the throwaway stand-up spec.
 * Deterministic given (stack, runId, tmpRoot, port). Throws on an unrunnable stack.
 */
export function planStandup(stack, { runId, target, tmpRoot, port, envFile, hostPort } = {}) {
  if (!RUN_ID_OK.test(String(runId || ''))) throw new Error(`planStandup: invalid run-id '${runId}'`)
  if (!target) throw new Error('planStandup: target repo required')
  if (envFile) checkEnvFileRunId(envFile, runId) // Slice D: refuse an orphaning toolkit-path env-file
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
  // THREE concepts were conflated into one number; this DECOUPLES the HOST published port
  // from the CONTAINER listen port + compose web-tier selector (both stay `webPort`). The
  // impure executor publishes on an EPHEMERAL 127.0.0.1 host port (so a busy host port can
  // never block stand-up) and threads the assigned port back as `hostPort`. Absent — the
  // pure-planner default — `hostPort` falls back to `webPort`, so every planner test stays
  // byte-identical; only `baseUrl` and the manifest's host-facing port follow it.
  const hostPub = (hostPort == null || hostPort === '') ? webPort : Number(hostPort)
  if (!Number.isInteger(hostPub) || hostPub < 1 || hostPub > 65535) {
    throw new Error(`planStandup: invalid host-port '${hostPort}'`)
  }
  // Per-kind dispatch: node + python are COPY-IN plans (toolkit base image, source
  // copied in); dockerfile is a BUILD plan (the partner's Dockerfile brings both).
  if (recipe.kind === 'python') {
    const root = recipe.root || '.'
    const sourceDir = root === '.' ? target : join(target, root)
    const entry = recipe.entry || 'app.py'
    const synthNames = (stack.env && stack.env.synthesizable) || []
    // PYTHONUNBUFFERED so boot output isn't buffered; HOST/PORT tell an env-reading app
    // (Flask/FastAPI-style) where to bind — 0.0.0.0 is the in-container bind ONLY.
    const benign = { PORT: String(webPort), PYTHONUNBUFFERED: '1', HOST: '0.0.0.0' }
    return {
      schema: STACK_SCHEMA, runId, kind: 'python',
      container: names.container, image: null, network: null, baseImage: PYTHON_BASE,
      host: '127.0.0.1', port: webPort, hostPort: hostPub, baseUrl: `http://127.0.0.1:${hostPub}`,
      sourceDir, entry, workdir: '/app',
      // recipe.run (Slice E) drives the exact server command; a provideServer hint (an ASGI
      // framework with no ASGI server in deps) adds a best-effort harness install.
      command: `${PY_INSTALL}${recipe.run && recipe.run.provideServer ? ` && pip install --no-input --quiet ${recipe.run.provideServer}` : ''} && ${pythonRunCommand({ entry, run: recipe.run }, webPort)}`,
      synthEnvNames: [...synthNames], benignEnv: benign,
      envFile: envFile || null, externalEnvNames: (stack.env && stack.env.external) || [],
      migration: (stack && stack.migration) || null,
      tmpRoot, manifestPath: join(tmpRoot, 'stack-manifest.json'),
      pointerRel: join('.security-review', 'stack-standup.json'),
    }
  }
  if (recipe.kind === 'dockerfile') {
    const root = recipe.root || '.'
    const buildContext = root === '.' ? target : join(target, root)
    const dockerfilePath = join(target, recipe.file || join(root, 'Dockerfile'))
    const synthNames = (stack.env && stack.env.synthesizable) || []
    return {
      schema: STACK_SCHEMA, runId, kind: 'dockerfile',
      // the built image carries the toolkit run-name → teardown's name gate accepts + rmi's it
      container: names.container, image: names.image, network: null, baseImage: null,
      host: '127.0.0.1', port: webPort, hostPort: hostPub, baseUrl: `http://127.0.0.1:${hostPub}`,
      buildContext, dockerfilePath,
      synthEnvNames: [...synthNames], benignEnv: { PORT: String(webPort) },
      envFile: envFile || null, externalEnvNames: (stack.env && stack.env.external) || [],
      migration: (stack && stack.migration) || null,
      tmpRoot, manifestPath: join(tmpRoot, 'stack-manifest.json'),
      pointerRel: join('.security-review', 'stack-standup.json'),
    }
  }
  if (recipe.kind === 'compose') {
    // COMPOSE (multi-container): the planner is pure, so it cannot run `docker compose
    // config` itself — it returns a needs-config-resolution PRE-plan carrying every
    // deterministic field; the executor resolves the file through docker's own parser
    // and the pure `planCompose` completes it (web-tier pick + loopback override).
    const composeFile = join(target, recipe.file || 'docker-compose.yml')
    const synthNames = (stack.env && stack.env.synthesizable) || []
    return {
      schema: STACK_SCHEMA, runId, kind: 'compose', needsConfigResolution: true,
      // the compose PROJECT carries the toolkit run-name (the stackNames convention), so
      // every project resource (containers <project>-<svc>-N, network <project>_default,
      // volumes <project>_*) is name-scoped for the project-scoped teardown + sweep
      project: names.container,
      container: names.container, image: null, network: null, baseImage: null,
      host: '127.0.0.1', port: webPort, hostPort: hostPub, baseUrl: `http://127.0.0.1:${hostPub}`,
      composeFile, overridePath: join(tmpRoot, 'compose.loopback-override.yml'),
      synthEnvNames: [...synthNames], benignEnv: { PORT: String(webPort) },
      envFile: envFile || null, externalEnvNames: (stack.env && stack.env.external) || [],
      migration: (stack && stack.migration) || null,
      tmpRoot, manifestPath: join(tmpRoot, 'stack-manifest.json'),
      pointerRel: join('.security-review', 'stack-standup.json'),
    }
  }
  if (recipe.kind !== 'node') {
    return { schema: STACK_SCHEMA, runId, unsupported: recipe.kind || 'unknown',
      reason: `standup of a '${recipe.kind}' recipe is not supported — this build stands up 'node'/'python' (copy-in), 'dockerfile' (build), and 'compose' (multi-container, loopback-overridden, project-scoped teardown); 'procfile' stays owner-run` }
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
    host: '127.0.0.1', port: webPort, hostPort: hostPub, baseUrl: `http://127.0.0.1:${hostPub}`,
    sourceDir, entry, workdir: '/app',
    command: `npm install --no-audit --no-fund --loglevel=error && node ${entry}`,
    synthEnvNames: [...synthNames], benignEnv: benign,
    // operator-filled external creds (from scaffold-env) loaded via docker --env-file →
    // the VALUES go straight into the container, never into argv or the manifest.
    envFile: envFile || null, externalEnvNames: (stack.env && stack.env.external) || [],
    migration: (stack && stack.migration) || null,
    tmpRoot, manifestPath: join(tmpRoot, 'stack-manifest.json'),
    pointerRel: join('.security-review', 'stack-standup.json'),
  }
}

/**
 * PURE. Complete a compose pre-plan from the docker-resolved config JSON
 * (`docker compose config --format json` — docker's OWN parser did the YAML work;
 * the harness bundles no YAML lib). Picks the web tier and templates the loopback
 * override; deterministic given (config, prePlan). Returns the full plan, or
 * `{ unsupported: 'compose' }` when the web tier cannot be identified safely —
 * REFUSE, never guess: a mis-identified web tier would publish the wrong service
 * to the host.
 */
export function planCompose(config, prePlan) {
  const services = config && typeof config === 'object' && config.services && typeof config.services === 'object' ? config.services : {}
  const svcNames = Object.keys(services)
  const port = Number(prePlan.port)
  const refuse = (reason) => ({ schema: prePlan.schema, runId: prePlan.runId, unsupported: 'compose', reason })
  const badNames = svcNames.filter((n) => !SERVICE_OK.test(n))
  if (badNames.length) return refuse(`unsafe compose service name(s) '${badNames.join("', '")}' — refusing to template the loopback override`)
  // network_mode guard: a service sharing the host's (or another container's) network
  // namespace bypasses compose port publishing ENTIRELY — under `network_mode: host`
  // the app binds the host interface directly and the loopback override's `ports:`
  // rewrite is a silent no-op (Compose ignores `ports:` under host networking). Must
  // run BEFORE web-tier selection: a host-networked service could itself declare the
  // web port and be picked, templating an override that confines nothing. Absent /
  // `bridge` / `default` / `none` go through normal port publishing (allowed).
  for (const n of svcNames) {
    const mode = services[n] && typeof services[n].network_mode === 'string' ? services[n].network_mode : ''
    if (mode === 'host' || mode.startsWith('container:') || mode.startsWith('service:')) {
      return refuse(`service '${n}' uses network_mode '${mode}', which bypasses compose port publishing — the toolkit cannot confine it to 127.0.0.1; refusing the compose stand-up`)
    }
  }
  // resolved-config port entries: `target` is a number, `published` a string — coerce both
  const portsOf = (n) => (Array.isArray(services[n] && services[n].ports) ? services[n].ports : [])
  const publishers = svcNames.filter((n) => portsOf(n).length > 0)
  const matchesWebPort = (p) => Number(p && p.published) === port || Number(p && p.target) === port
  const matched = publishers.filter((n) => portsOf(n).some(matchesWebPort))
  let webService
  if (matched.length === 1) webService = matched[0]
  else if (matched.length === 0 && publishers.length === 1) webService = publishers[0] // the sole publisher IS the web tier
  else if (publishers.length === 0) return refuse('no compose service publishes a port — cannot identify a web tier to rebind on 127.0.0.1')
  else if (matched.length > 1) return refuse(`ambiguous web service — ${matched.length} services publish the detected web port ${port}; cannot enforce loopback safely`)
  else return refuse(`ambiguous web service — ${publishers.length} services publish ports, none matches the detected web port ${port}; cannot enforce loopback safely`)
  // rebind the HOST side to 127.0.0.1:<hostPub>; keep the service's own container-side
  // target (a `8080:3000` mapping stays →3000 — the app listens where it listens).
  // `hostPub` is the HOST published port: absent (the pure-planner default) it falls back
  // to the web-tier port so U-tests stay byte-identical; the executor threads `hostPort: 0`
  // to publish on an EPHEMERAL 127.0.0.1 port that is read back after `up` (no bind-race).
  const hostPub = (prePlan.hostPort == null || prePlan.hostPort === '') ? port : Number(prePlan.hostPort)
  const webEntry = portsOf(webService).find(matchesWebPort) || portsOf(webService)[0]
  const targetPort = Number(webEntry && webEntry.target) || port
  const others = svcNames.filter((n) => n !== webService)
  // `!override`/`!reset` are load-bearing: a PLAIN `ports:` in a compose override file
  // CONCATENATES with the base file's list, which would leave the original 0.0.0.0
  // publish alive next to ours — the exact isolation failure this override exists to
  // prevent. The tags REPLACE (Compose V2 merge semantics, verified empirically).
  const overrideContent = [
    '# generated loopback override — the throwaway publishes ONLY the web tier, ONLY on',
    '# 127.0.0.1; every other service loses its host ports (services still reach each',
    '# other over the compose network).',
    'services:',
    `  ${webService}:`,
    '    ports: !override',
    `      - "127.0.0.1:${hostPub}:${targetPort}"`,
    ...others.flatMap((n) => [`  ${n}:`, '    ports: !reset []']),
  ].join('\n') + '\n'
  const { needsConfigResolution, ...plan } = prePlan
  // targetPort is the container-side port the executor reads the assigned host port back on
  return { ...plan, webService, targetPort, overrideContent }
}

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const quiet = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true } catch { return false } }

/**
 * IMPURE. Parse the host port docker assigned to an ephemeral publish. `docker port
 * <container> <containerPort>` / `docker compose port <service> <containerPort>` prints
 * `127.0.0.1:<hostPort>`; take the port off the first `IP:port` line. Throws if none is
 * found (the container didn't come up / expose the port — a failed stand-up).
 */
function parseHostPort(out, label) {
  const line = String(out || '').split('\n').map((s) => s.trim()).find((s) => /:\d+$/.test(s)) || ''
  const m = line.match(/:(\d+)$/)
  if (!m) throw new Error(`standup-stack: could not read the published host port for ${label} (docker returned '${String(out || '').trim()}')`)
  return Number(m[1])
}

/** IMPURE. Body-free probe → { code, redirect }. `000` = down/refused. NAMES-only: no
 *  body/headers persisted; the redirect target is read in-memory only to detect http→https. */
function probeHealth(url) {
  try {
    const out = execFileSync('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code} %{redirect_url}', '--max-time', '3', url],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const sp = out.indexOf(' ')
    return sp < 0 ? { code: out || '000', redirect: '' } : { code: out.slice(0, sp) || '000', redirect: out.slice(sp + 1) }
  } catch { return { code: '000', redirect: '' } }
}

// The ordered liveness probe set — readiness-named paths first, `/` last (the only isRoot).
const HEALTH_PROBE_PATHS = ['/readyz', '/health/ready', '/healthz', '/health', '/']
const READINESS_PATHS = new Set(['/readyz', '/health/ready', '/healthz', '/health'])

/**
 * IMPURE. Poll the ordered liveness set until a deadline, classifying via the pure seams.
 * `dockerHealth()` (optional) returns the container's declared HEALTHCHECK status — when
 * present it is preferred (the partner's own readiness definition); an empty string falls
 * through to the HTTP probe. `isRunning()` gates failed-vs-unknown. Returns
 * { status, guarded, readiness, saw400, log }.
 */
function pollHealth(baseUrl, { isRunning, dockerHealth } = {}, deadline) {
  const base = String(baseUrl).replace(/\/+$/, '')
  let observedUp = false, observedUnhealthy = false, observedRedirectOnly = false
  let sawOk = false, sawGuarded = false, sawReadiness = false, saw400 = false, declared = false
  let containerRunning = true
  while (Date.now() < deadline) {
    if (dockerHealth) {
      const dh = mapDockerHealth(dockerHealth())
      if (dh) { declared = true; if (dh === 'up') observedUp = true; else if (dh === 'unhealthy') observedUnhealthy = true }
    }
    if (!observedUp) {
      for (const path of HEALTH_PROBE_PATHS) {
        const isRoot = path === '/'
        const { code, redirect } = probeHealth(base + path)
        const c = Number(code)
        const cls = classifyHealthCode(code, { isRoot })
        if (cls === 'up') {
          if (c >= 200 && c < 300) { observedUp = true; sawOk = true; if (READINESS_PATHS.has(path)) sawReadiness = true }
          else if (c === 401 || c === 403 || c === 405) { observedUp = true; sawGuarded = true }
          else if (isRoot && c >= 300 && c < 400) { if (/^https:\/\//i.test(redirect)) observedRedirectOnly = true; else observedUp = true }
          else if (isRoot) observedUp = true // 4xx on / == the server is answering
        } else if (cls === 'unhealthy') observedUnhealthy = true
        if (c === 400) saw400 = true
      }
    }
    if (observedUp) break
    containerRunning = isRunning ? isRunning() : true
    if (!containerRunning) break
    execFileSync('sleep', ['1'])
  }
  const status = resolveHealth({ observedUp, observedUnhealthy, observedRedirectOnly, containerRunning })
  const guarded = (sawGuarded && !sawOk) || (saw400 && !sawOk && !observedUnhealthy && status !== HEALTH_STATES.UP)
  const readiness = (sawReadiness || (declared && status === HEALTH_STATES.UP)) ? 'app-declared' : 'liveness-only'
  return { status, guarded, readiness, saw400, log: standupHealthNote(status, { guarded, saw400 }) }
}

/** Write the manifest + the gitignored project pointer (NAMES only — never secret values). */
function writeManifest(plan, rec, target) {
  mkdirSync(plan.tmpRoot, { recursive: true, mode: 0o700 })
  // The host-facing port follows the HOST publish (`hostPort`), not the container/web port —
  // `scannedPort` MUST equal `new URL(baseUrl).port` or run-dast's dastDegrade false-flags the
  // run as "wrong tier". `plan.baseUrl` already carries the same host port (planStandup / the
  // executor keep the two in lockstep). Legacy plans without `hostPort` fall back to port.
  const hostPort = plan.hostPort != null ? plan.hostPort : plan.port
  const manifest = {
    schema: plan.schema, runId: plan.runId, kind: plan.kind,
    resources: { container: plan.container, image: rec.builtImage || null, network: rec.network || null },
    // compose only: what the project-scoped teardown needs to reconstruct the `down`
    ...(plan.kind === 'compose' ? { project: plan.project, composeFile: plan.composeFile, overridePath: plan.overridePath, webService: plan.webService || null } : {}),
    host: plan.host, port: hostPort, baseUrl: plan.baseUrl,
    synthEnvNames: plan.synthEnvNames, // NAMES only; the random values live only in the container env
    status: rec.status, createdAt: rec.createdAt, log: rec.log || '',
    // health-honesty flags (Slice B1): status is a HEALTH_STATES value; these qualify it so a
    // downstream consumer can degrade a scan label without reading prose. scannedService/Port
    // name the tier that was actually reached (Slice A's web-tier pick).
    guarded: rec.guarded || false,
    readiness: rec.readiness || 'liveness-only',
    scannedService: plan.webService || plan.scannedService || plan.kind || null,
    scannedPort: hostPort,
    migration: plan.migration || null,
    tmpRoot: plan.tmpRoot, target: target || null,
  }
  writeFileSync(plan.manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  if (target) {
    try {
      const dir = join(target, '.security-review'); mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'stack-standup.json'), JSON.stringify({
        schema: plan.schema, runId: plan.runId, container: plan.container, baseUrl: plan.baseUrl,
        manifestPath: plan.manifestPath, status: rec.status, createdAt: rec.createdAt,
        guarded: rec.guarded || false, readiness: rec.readiness || 'liveness-only',
        scannedService: plan.webService || plan.scannedService || plan.kind || null,
        scannedPort: hostPort, migration: plan.migration || null,
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
  // COMPOSE dispatches to its own executor (multi-container: config-resolve →
  // planCompose → override → `up`); the kind-agnostic gates above — consent
  // fail-closed, docker present, needs-secrets re-check — have already held.
  if (plan.kind === 'compose') return standupCompose(plan, { target, createdAt, timeoutMs })

  // No fixed-port collision guard: the throwaway publishes on an EPHEMERAL 127.0.0.1 host
  // port (`-p 127.0.0.1:0:<containerPort>`), which docker only ever assigns from FREE ports,
  // so a busy host port can never collide or misattribute findings. The assigned host port is
  // read back after start (below) and becomes the scan baseUrl.
  const stamp = createdAt || new Date().toISOString()
  const rec = { status: 'creating', createdAt: stamp, network: null, builtImage: null, log: '' }
  // A dockerfile stand-up BUILDS a toolkit-named image; record it from the name-stub on
  // (the name is deterministic) so even a crashed build stays teardown-able (docker rmi).
  if (plan.kind === 'dockerfile') rec.builtImage = plan.image

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
  // `live` carries the plan patched with the ephemeral host port docker assigns (read back
  // after start); it drives the health probe + the final manifest. Until then it is the plan
  // as planned (hostPort == webPort), so a create/start crash still writes a coherent stub.
  let live = plan
  try {
    quiet('docker', ['rm', '-f', plan.container]) // clear any stale same-name container
    if (plan.kind === 'dockerfile') {
      // BUILD-THEN-RUN: the partner's own Dockerfile brings the source + base image.
      run('docker', ['build', '-t', plan.image, '-f', plan.dockerfilePath, plan.buildContext])
      run('docker', ['run', '-d', '--name', plan.container, '-p', `${plan.host}:0:${plan.port}`,
        ...fileArgs, plan.image])
    } else {
      // COPY-IN, not bind-mount: create → cp source → start (working tree stays in the container).
      run('docker', ['create', '--name', plan.container, '-p', `${plan.host}:0:${plan.port}`,
        ...fileArgs, '-w', plan.workdir, plan.baseImage, 'sh', '-c', plan.command])
      run('docker', ['cp', `${plan.sourceDir}/.`, `${plan.container}:${plan.workdir}`])
      run('docker', ['start', plan.container])
    }
    // Read back the ephemeral host port docker assigned (`-p 127.0.0.1:0:<containerPort>`) —
    // done AFTER start so the mapping is live; this avoids the find-a-free-port-then-bind race.
    const hostPort = parseHostPort(run('docker', ['port', plan.container, String(plan.port)]), `${plan.container}:${plan.port}`)
    live = { ...plan, hostPort, baseUrl: `http://${plan.host}:${hostPort}` }
    rec.status = 'starting'
    // 3-state liveness (Slice B1): up / unhealthy / redirect-only / failed / unknown, via the
    // pure classifyHealthCode + resolveHealth seams. Prefer the container's own declared
    // HEALTHCHECK when present; else the ordered HTTP liveness set. We still deliberately do
    // NOT capture `docker logs` — partner boot output can echo operator-filled secrets, so
    // rec.log carries only the toolkit's health note (NAMES-only contract).
    const isRunning = () => { try { return run('docker', ['inspect', '-f', '{{.State.Running}}', plan.container]).trim() === 'true' } catch { return false } }
    const dockerHealth = () => { try { return run('docker', ['inspect', '-f', '{{if .State.Health}}{{.State.Health.Status}}{{end}}', plan.container]).trim() } catch { return '' } }
    const h = pollHealth(live.baseUrl, { isRunning, dockerHealth }, Date.now() + timeoutMs)
    rec.status = h.status; rec.guarded = h.guarded; rec.readiness = h.readiness; rec.log = h.log
  } catch (e) {
    rec.status = 'failed'
    rec.log = 'stand-up failed during a docker step (the toolkit does not capture container output, to avoid persisting secrets)'
  } finally {
    for (const [s, h] of Object.entries(handlers)) process.removeListener(s, h)
  }
  return writeManifest(live, rec, target)
}

/**
 * IMPURE compose executor. Called only from `standupStack` AFTER the kind-agnostic
 * gates (consent fail-closed, docker present, needs-secrets re-check) have held.
 * GATHER IMPURELY, CLASSIFY PURELY (the stack-detect pattern): docker's own parser
 * resolves the compose file to JSON, the pure `planCompose` picks the web tier and
 * templates the loopback override, and the project comes up under the toolkit
 * run-name (`-p sf-srt-stack-<runId>`) so teardown-stack removes it project-scoped.
 */
function standupCompose(plan, { target, createdAt, timeoutMs = 90000 } = {}) {
  // Compose V2 is its own prerequisite beyond the docker daemon (the plugin can be
  // absent) — mirror the no-docker honest-hint pattern; the legacy `docker-compose`
  // V1 binary is deliberately NOT used as a fallback.
  if (!quiet('docker', ['compose', 'version'])) {
    return { status: 'no-compose', reason: 'Docker Compose V2 is not available (`docker compose version` failed) — install the compose plugin once, system-wide (Linux: `sudo apt-get install docker-compose-plugin`; Docker Desktop bundles it), then re-run — or this multi-container stack stays owner-run.', resources: { container: plan.container, image: null, network: null }, baseUrl: plan.baseUrl, synthEnvNames: plan.synthEnvNames }
  }
  // No fixed-port collision guard: the loopback override publishes the web tier on an
  // EPHEMERAL 127.0.0.1 host port (`127.0.0.1:0:<targetPort>`), which docker only assigns
  // from FREE ports; the assigned port is read back after `up` (below).
  const stamp = createdAt || new Date().toISOString()
  const rec = { status: 'creating', createdAt: stamp, network: null, builtImage: null, log: '' }

  // Secret VALUES go via env-FILEs (compose interpolation), never the docker argv —
  // written BEFORE config resolution so `${VAR}` interpolation in the compose file
  // sees the same env at `config` time as at `up` time.
  mkdirSync(plan.tmpRoot, { recursive: true, mode: 0o700 })
  const synthFile = join(plan.tmpRoot, '.synth.env')
  writeFileSync(synthFile, [
    ...Object.entries(plan.benignEnv).map(([k, v]) => `${k}=${v}`),
    ...plan.synthEnvNames.map((n) => `${n}=${randomBytes(24).toString('hex')}`),
  ].join('\n') + '\n', { mode: 0o600 })
  const fileArgs = ['--env-file', synthFile]
  if (plan.envFile && existsSync(plan.envFile)) fileArgs.push('--env-file', plan.envFile)

  let full
  try {
    const config = JSON.parse(run('docker', ['compose', '-p', plan.project, ...fileArgs, '-f', plan.composeFile, 'config', '--format', 'json']))
    // hostPort:0 → the loopback override publishes the web tier on an EPHEMERAL 127.0.0.1
    // host port; the real port is read back after `up`. planCompose's baseUrl is unaffected
    // (it inherits plan.baseUrl), so only the override host slot carries the `0`.
    full = planCompose(config, { ...plan, hostPort: 0 })
  } catch {
    rec.status = 'failed'
    rec.log = 'compose stand-up failed: `docker compose config` could not resolve the compose file (run it yourself for the parser error — the toolkit does not capture command output, to avoid persisting secret-bearing interpolations)'
    return writeManifest(plan, rec, target)
  }
  if (full.unsupported) return { status: 'unsupported', reason: full.reason, resources: { container: plan.container, image: null, network: null }, baseUrl: plan.baseUrl, synthEnvNames: plan.synthEnvNames }
  // The `0` was only the override's ephemeral marker; the pre-`up` stub records the
  // container/web port as a placeholder host port (the real one is read back after `up`).
  full = { ...full, hostPort: plan.port }
  // The loopback override is the compose isolation boundary: the web tier publishes on
  // 127.0.0.1 ONLY, and every other service is stripped of host ports entirely.
  writeFileSync(full.overridePath, full.overrideContent, { mode: 0o600 })
  const composeArgs = ['compose', '-p', full.project, ...fileArgs, '-f', full.composeFile, '-f', full.overridePath]

  // Name-stub manifest BEFORE `up` (project + file paths are deterministic) so even a
  // crashed `up` stays teardown-able from the manifest alone (audit: orphan).
  writeManifest(full, rec, target)

  // Same synchronous-window safety net as the single-container path — the project-scoped
  // `down` removes every project resource; teardown-stack remains authoritative.
  const cleanup = () => { try { execFileSync('docker', [...composeArgs, 'down', '-v', '--remove-orphans'], { stdio: 'ignore' }) } catch {} }
  const handlers = {
    SIGINT: () => { cleanup(); process.exit(130) },
    SIGTERM: () => { cleanup(); process.exit(143) },
    uncaughtException: (e) => { cleanup(); throw e },
  }
  for (const [s, h] of Object.entries(handlers)) process.on(s, h)
  // `live` carries `full` patched with the ephemeral host port compose assigned (read back
  // after `up`); it drives the health probe + the final manifest. Until then it is `full`
  // (hostPort == web port), so a crashed `up` still writes a coherent stub.
  let live = full
  try {
    run('docker', [...composeArgs, 'up', '-d', '--build'])
    // Read the assigned ephemeral host port back off the web tier (127.0.0.1:0:<targetPort>) —
    // done AFTER `up` so the mapping is live; avoids the find-a-free-port-then-bind race.
    const hostPort = parseHostPort(run('docker', [...composeArgs, 'port', full.webService, String(full.targetPort)]), `${full.webService}:${full.targetPort}`)
    live = { ...full, hostPort, baseUrl: `http://${full.host}:${hostPort}` }
    rec.status = 'starting'
    // Same 3-state liveness (Slice B1) as the single-container path — deliberately NO
    // `docker compose logs` capture (boot output can echo operator-filled secrets). The
    // declared HEALTHCHECK is read off the web-tier container (`<project>-<service>-1`).
    const isRunning = () => { try { return run('docker', [...composeArgs, 'ps', '--status', 'running', '-q']).trim() !== '' } catch { return false } }
    const dockerHealth = full.webService
      ? () => { try { return run('docker', ['inspect', '-f', '{{if .State.Health}}{{.State.Health.Status}}{{end}}', `${full.project}-${full.webService}-1`]).trim() } catch { return '' } }
      : undefined
    const h = pollHealth(live.baseUrl, { isRunning, dockerHealth }, Date.now() + timeoutMs)
    rec.status = h.status; rec.guarded = h.guarded; rec.readiness = h.readiness; rec.log = h.log
  } catch {
    rec.status = 'failed'
    rec.log = 'stand-up failed during a docker compose step (the toolkit does not capture compose output, to avoid persisting secrets)'
  } finally {
    for (const [s, h] of Object.entries(handlers)) process.removeListener(s, h)
  }
  return writeManifest(live, rec, target)
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
  // DEGRADE-not-abort (Slice B1): only a FATAL_STATUS aborts. unhealthy / redirect-only stand
  // up with a loud degraded label (the downstream capture + scan still run, degraded).
  const degraded = m.status === HEALTH_STATES.UNHEALTHY || m.status === HEALTH_STATES.REDIRECT_ONLY
  if (asJson) { process.stdout.write(JSON.stringify(m, null, 2) + '\n'); if (FATAL_STATUS.has(m.status)) process.exitCode = 1; return }
  process.stdout.write(`## standup-stack — ${m.status}${degraded ? ' (DEGRADED — not a clean scan target)' : ''}\ncontainer: ${m.resources.container}   url: ${m.baseUrl}\nsynth env (names): ${(m.synthEnvNames || []).join(', ') || 'none'}\nteardown: node harness/teardown-stack.mjs --target <repo>\n${(FATAL_STATUS.has(m.status) || degraded) ? 'LOG: ' + (m.log || '').split('\n').pop() : ''}\n`)
  if (FATAL_STATUS.has(m.status)) process.exitCode = 1
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) }
  catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

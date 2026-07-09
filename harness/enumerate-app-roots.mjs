#!/usr/bin/env node
/*
 * enumerate-app-roots.mjs — the DETERMINISTIC monorepo app-root enumerator
 * (WO-108 scope breadth). scope-submission step 2 runs this engine and folds
 * its output into the detected element set.
 *
 * WHY THIS EXISTS. A full Next.js admin console (`apps/admin`, its own port)
 * was ABSENT from a scope manifest and only surfaced during the SCA phase —
 * because element detection for second/third app surfaces was LLM prose in the
 * scope-submission skill, and prose-strength detection is exactly how a
 * surface gets missed (and why no mechanical test could lock it). This engine
 * replaces that prose grep with a pure function of the repo tree: every
 * conventional app root (`apps/*`, `services/*`, `packages/*`, plus the repo
 * root) that carries an app manifest is emitted as a CANDIDATE element with
 * its evidence — path, framework signal, declared port — so a second
 * front-end/admin surface surfaces deterministically, run after run, and a
 * fixture test can prove it.
 *
 * Mirrors the shipped detector contract (tool-detect / stack-detect /
 * package-readiness): PURE — no network, no LLM, read-only on the target; same
 * tree in → byte-identical output out (entries sorted by path). It DETECTS and
 * CLASSIFIES; it never writes the manifest — the skill folds `candidate: true`
 * roots into the element set as `external-web-app` (the render synonym map
 * canonicalizes that to `external-endpoint`) and routes a genuinely ambiguous
 * root through the `clarify-detection` gate rather than silently omitting it.
 *
 * CLASSIFICATION (fail toward surfacing, never toward silence):
 *   candidate: true  — the root carries an APP signal: a known web/server
 *                      framework dependency or config file, a Dockerfile, or a
 *                      `start` script. These are the surfaces a reviewer will
 *                      find; each becomes its own element candidate.
 *   candidate: false — a manifest with NO app signal (a shared library /
 *                      tooling package). Reported with its reason so the
 *                      operator can dispute the classification — never
 *                      silently dropped from the readout.
 *
 * USAGE
 *   node enumerate-app-roots.mjs --target <repo> [--json]
 *     default: a fixed human-readable block. --json: the machine shape
 *     { target, scanned, appRoots: [ { path, name, container, candidate,
 *       elementType, framework, port, evidence, reason } ], candidates }
 */
import { readFileSync, readdirSync, existsSync, statSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Conventional monorepo app-root containers, scanned one level deep. `packages/*`
// is included because pnpm/turbo workspaces routinely put deployable apps there —
// the library/app split is decided by the APP-SIGNAL classification, not the
// container name. The repo root itself is always checked (single-app repos).
export const APP_CONTAINERS = Object.freeze(['apps', 'packages', 'services'])

// Web/server framework dependencies that mark a package.json as an APP (not a
// library). Names are matched exactly against dependencies + devDependencies.
const JS_FRAMEWORK_DEPS = Object.freeze([
  'next', 'nuxt', 'react-scripts', 'gatsby', 'astro', 'remix', '@remix-run/node',
  '@remix-run/serve', '@sveltejs/kit', 'express', 'fastify', 'koa', '@koa/router',
  '@nestjs/core', 'hapi', '@hapi/hapi', 'hono', 'restify',
])

// Framework config files that mark an app root even when the dep name is indirect.
const FRAMEWORK_CONFIG_FILES = Object.freeze([
  ['next.config.js', 'next'], ['next.config.mjs', 'next'], ['next.config.ts', 'next'],
  ['nuxt.config.js', 'nuxt'], ['nuxt.config.ts', 'nuxt'],
  ['astro.config.mjs', 'astro'], ['astro.config.ts', 'astro'],
  ['svelte.config.js', 'sveltekit'],
  ['remix.config.js', 'remix'],
])

// Python web frameworks matched in requirements.txt lines / pyproject.toml deps.
const PY_FRAMEWORKS = Object.freeze(['fastapi', 'flask', 'django', 'starlette', 'aiohttp', 'tornado', 'sanic'])

// App manifests that make a directory a discoverable root at all.
const MANIFESTS = Object.freeze(['package.json', 'Dockerfile', 'pyproject.toml', 'requirements.txt', 'go.mod'])

const readText = (p) => { try { return readFileSync(p, 'utf8') } catch { return null } }
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }
const isDir = (p) => { try { return statSync(p).isDirectory() } catch { return false } }

/** First declared port: Dockerfile EXPOSE wins, then -p/--port/PORT= in scripts. */
function detectPort(dir, pkg) {
  const docker = readText(join(dir, 'Dockerfile'))
  if (docker) {
    const m = docker.match(/^\s*EXPOSE\s+(\d{2,5})/m)
    if (m) return Number(m[1])
  }
  const scripts = pkg && pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {}
  for (const key of Object.keys(scripts).sort()) {
    const s = String(scripts[key])
    const m = s.match(/(?:^|\s)(?:-p|--port)[ =](\d{2,5})\b/) || s.match(/\bPORT=(\d{2,5})\b/)
    if (m) return Number(m[1])
  }
  return null
}

/** Examine one directory; return an appRoots entry or null (no manifest at all). */
function examineRoot(target, relPath, container) {
  const dir = relPath === '.' ? target : join(target, relPath)
  const found = MANIFESTS.filter((m) => existsSync(join(dir, m)))
  if (!found.length) return null

  const evidence = []
  let framework = null
  const pkg = found.includes('package.json') ? readJson(join(dir, 'package.json')) : null

  if (pkg) {
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
    const hit = JS_FRAMEWORK_DEPS.find((d) => Object.prototype.hasOwnProperty.call(deps, d))
    if (hit) { framework = hit; evidence.push(`${relPath}/package.json (dep: ${hit})`) }
  }
  for (const [file, fw] of FRAMEWORK_CONFIG_FILES) {
    if (existsSync(join(dir, file))) {
      if (!framework) framework = fw
      evidence.push(`${relPath}/${file}`)
      break
    }
  }
  // Python: a framework named in requirements.txt / pyproject.toml dependencies.
  for (const pyFile of ['requirements.txt', 'pyproject.toml']) {
    if (!found.includes(pyFile)) continue
    const text = (readText(join(dir, pyFile)) || '').toLowerCase()
    const hit = PY_FRAMEWORKS.find((f) => new RegExp(`(^|["'\\s])${f}([\\s<>=~!\\["']|$)`, 'm').test(text))
    if (hit) { if (!framework) framework = hit; evidence.push(`${relPath}/${pyFile} (dep: ${hit})`) }
  }

  const hasDockerfile = found.includes('Dockerfile')
  if (hasDockerfile) evidence.push(`${relPath}/Dockerfile`)
  const hasStart = !!(pkg && pkg.scripts && typeof pkg.scripts === 'object' && typeof pkg.scripts.start === 'string')
  if (hasStart) evidence.push(`${relPath}/package.json (scripts.start)`)

  const port = detectPort(dir, pkg)
  if (port != null) {
    const src = hasDockerfile && (readText(join(dir, 'Dockerfile')) || '').match(/^\s*EXPOSE\s+\d/m) ? 'Dockerfile EXPOSE' : 'scripts port'
    evidence.push(`${relPath} declares port ${port} (${src})`)
  }

  const candidate = !!(framework || hasDockerfile || hasStart)
  return {
    path: relPath,
    name: relPath === '.' ? (pkg && pkg.name) || '.' : relPath.split('/').pop(),
    container,
    candidate,
    // The element type the skill folds in — 'external-web-app' canonicalizes to
    // 'external-endpoint' via render-detected-elements.mjs ELEMENT_TYPE_SYNONYMS.
    elementType: candidate ? 'external-web-app' : null,
    framework,
    port,
    evidence: evidence.length ? evidence : found.map((m) => `${relPath}/${m}`),
    reason: candidate
      ? 'app signal: ' + [framework ? `framework ${framework}` : null, hasDockerfile ? 'Dockerfile' : null, hasStart ? 'start script' : null].filter(Boolean).join(' + ')
      : `no app signal (library/tooling package: ${found.join(', ')} present, but no framework dep/config, no Dockerfile, no start script)`,
  }
}

/**
 * PURE core: enumerate every app root under the conventional containers plus
 * the repo root. Deterministic: containers in APP_CONTAINERS order, entries
 * sorted by path; same tree → byte-identical result.
 */
export function enumerateAppRoots(target) {
  const scanned = []
  const appRoots = []
  const root = examineRoot(target, '.', '.')
  if (root) appRoots.push(root)
  for (const container of APP_CONTAINERS) {
    const cDir = join(target, container)
    if (!isDir(cDir)) continue
    scanned.push(container)
    let children = []
    try { children = readdirSync(cDir, { withFileTypes: true }) } catch { children = [] }
    for (const e of children) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue
      const entry = examineRoot(target, `${container}/${e.name}`, container)
      if (entry) appRoots.push(entry)
    }
  }
  appRoots.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return {
    target,
    scanned,
    appRoots,
    candidates: appRoots.filter((r) => r.candidate).length,
  }
}

function renderBlock(result) {
  const L = []
  L.push('### App roots (deterministic monorepo enumeration)')
  L.push('')
  if (!result.appRoots.length) {
    L.push('No app-root manifests found under the repo root or the conventional containers ' +
      `(${APP_CONTAINERS.join('/, ')}/). Nothing to fold in from this engine.`)
    return L.join('\n')
  }
  L.push('| Path | Candidate element | Framework | Port | Evidence |')
  L.push('|---|---|---|---|---|')
  for (const r of result.appRoots) {
    L.push(`| ${r.path} | ${r.candidate ? r.elementType : `no — ${r.reason}`} | ${r.framework || '—'} | ${r.port != null ? r.port : '—'} | ${r.evidence.join('; ')} |`)
  }
  L.push('')
  L.push(`${result.candidates} candidate element(s) of ${result.appRoots.length} discovered root(s). ` +
    'Each candidate folds into the detected element set as its own element (external-web-app → ' +
    'external-endpoint via the canonical synonym map); dispute a row through the clarify-detection gate, ' +
    'never by silent omission.')
  return L.join('\n')
}

function main() {
  const arg = (flag, def) => {
    const i = process.argv.indexOf(flag)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
  }
  const target = arg('--target', process.cwd())
  if (!isDir(target)) {
    console.error(`enumerate-app-roots: --target ${target} is not a directory`)
    process.exit(2)
  }
  const result = enumerateAppRoots(target)
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  } else {
    process.stdout.write(renderBlock(result) + '\n')
  }
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) }
  catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

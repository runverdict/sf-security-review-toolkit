#!/usr/bin/env node
/*
 * stack-detect.mjs — deterministic throwaway-DAST-target detector (0.7.0 foundation).
 * The server-tier analogue of package-readiness/tool-detect. See
 * docs/roadmap-0.7.0-throwaway-dast-harness.md.
 *
 * From a partner repo it answers: can the external backend be stood up as a
 * disposable, production-equivalent throwaway for an active DAST — and if not,
 * what's missing? Verdict:
 *   runnable      → a run recipe + a web tier are resolvable and every required env
 *                   var is either benign (safe default) or a SYNTHESIZABLE secret the
 *                   toolkit can generate itself (e.g. a JWT signing secret — exactly
 *                   what the prototype did). Stand-up can proceed autonomously.
 *   needs-recipe  → an external source root exists but no runnable recipe was found
 *                   (no compose / Dockerfile / start script) — needs a start command.
 *   needs-secrets → a recipe exists but the stack needs EXTERNAL-service credentials
 *                   the toolkit cannot synthesize (a real DATABASE_URL, a third-party
 *                   API key) — the scaffold-and-guide credential path.
 *   n/a           → no external server source at all (package-only listing).
 *
 * The env classification is the load-bearing, separately-tested part: a throwaway
 * only needs the OWNER for env it genuinely can't fabricate. PURE core
 * (`classifyStack`, `classifyEnvName`); the CLI gathers facts from the repo
 * (dependency-free, regex/file scans — no YAML/JSON parser deps). No network.
 *
 * USAGE: node stack-detect.mjs --target <repo> [--json]
 */
import { readFileSync, existsSync, readdirSync, statSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Env-name classification — order matters: EXTERNAL (points at a real outside service)
// wins over SECRET (e.g. REDIS_PASSWORD / STRIPE_API_KEY need the real thing).
const BENIGN_ENV = /^(PORT|HOST|HOSTNAME|BIND|ADDR|ADDRESS|NODE_ENV|ENV|ENVIRONMENT|LOG_?LEVEL|DEBUG|VERBOSE|TZ|LANG|LC_|PYTHONUNBUFFERED|PYTHONPATH|WORKERS|CONCURRENCY|TIMEOUT|MAX_|MIN_)/i
const EXTERNAL_ENV = /(_URL|_URI|_DSN|_HOST|_ENDPOINT|DATABASE|POSTGRES|PGHOST|MYSQL|MARIADB|MONGO|REDIS|MEMCACHE|RABBIT|AMQP|KAFKA|ELASTIC|OPENSEARCH|S3_|AWS_|GCP_|GOOGLE_APPLICATION|AZURE_|STRIPE|TWILIO|SENDGRID|MAILGUN|SES_|SMTP|SLACK|GITHUB_TOKEN|OPENAI|GEMINI|ANTHROPIC|VERTEX|LDAP|OKTA|AUTH0|SENTRY|DATADOG)/i
const SECRET_ENV = /(SECRET|TOKEN|_KEY$|_KEYS$|APIKEY|API_KEY|SALT|PASSWORD|PASSPHRASE|JWT|HMAC|SIGNING|PRIVATE_KEY|CLIENT_SECRET|ENCRYPTION|CIPHER)/i

/** Pure: classify ONE env-var name → how the throwaway gets a value for it. */
export function classifyEnvName(name) {
  const n = String(name || '')
  if (!n) return 'unknown'
  if (EXTERNAL_ENV.test(n)) return 'external'        // a real outside dependency → owner must supply
  if (SECRET_ENV.test(n)) return 'synthesizable'     // a self-contained secret → toolkit generates it
  if (BENIGN_ENV.test(n)) return 'benign'            // non-secret config → safe default / leave unset
  return 'unknown'                                    // unclassified non-secret → default/leave-unset, flagged
}

/** Pure: from gathered facts, classify the throwaway-DAST readiness. */
export function classifyStack(facts = {}) {
  const roots = Array.isArray(facts.serverRoots) ? facts.serverRoots : []
  const recipe = facts.recipe || null
  if (!roots.length && !recipe) {
    return { status: 'n/a', reason: 'no external server source root found — nothing to stand up (package-only)' }
  }
  const buckets = { external: [], synthesizable: [], benign: [], unknown: [] }
  for (const n of [...new Set(facts.envNames || [])]) buckets[classifyEnvName(n)].push(n)
  for (const k of Object.keys(buckets)) buckets[k] = [...new Set(buckets[k])].sort()
  const env = { external: buckets.external, synthesizable: buckets.synthesizable, benign: buckets.benign, unknown: buckets.unknown }

  if (!recipe) {
    return { status: 'needs-recipe', serverRoots: roots, env,
      reason: `external source at ${roots.join(', ')} but no runnable recipe (no compose / Dockerfile / start script) — provide a start command` }
  }
  if (env.external.length) {
    return { status: 'needs-secrets', recipe, webTier: facts.webTier || null, serverRoots: roots, env,
      reason: `recipe present but needs external-service credentials the toolkit cannot synthesize: ${env.external.join(', ')} — scaffold-and-guide` }
  }
  return { status: 'runnable', recipe, webTier: facts.webTier || null, serverRoots: roots, env,
    reason: `standable: ${recipe.kind} recipe${facts.webTier ? `, web tier port ${facts.webTier.port}` : ''}; env the toolkit generates: ${env.synthesizable.join(', ') || 'none'}` }
}

// ── CLI fact-gathering (dependency-free; best-effort regex/file scans) ──────────
const SKIP_DIRS = new Set(['.git', 'node_modules', 'force-app', '.security-review', 'docs', '.claude', 'venv', '.venv', '__pycache__', 'dist', 'build'])
const readOr = (p) => { try { return readFileSync(p, 'utf8') } catch { return '' } }
const isDir = (p) => { try { return statSync(p).isDirectory() } catch { return false } }
const isFile = (p) => { try { return statSync(p).isFile() } catch { return false } }

function firstExisting(target, names) { for (const n of names) { const p = join(target, n); if (isFile(p)) return p } return null }

/** Discover the non-package server source roots (top-level dirs with a server signal). */
function serverRoots(target) {
  const roots = []
  let entries = []
  try { entries = readdirSync(target) } catch { return roots }
  for (const e of entries) {
    if (SKIP_DIRS.has(e) || e.startsWith('.')) continue
    const d = join(target, e)
    if (!isDir(d)) continue
    const hasNode = isFile(join(d, 'package.json'))
    const hasPy = isFile(join(d, 'requirements.txt')) || isFile(join(d, 'pyproject.toml')) || isFile(join(d, 'Pipfile'))
    const hasDocker = isFile(join(d, 'Dockerfile'))
    const hasSrc = (() => { try { return readdirSync(d).some((f) => /\.(js|ts|py|go|java|rb)$/.test(f)) } catch { return false } })()
    if (hasNode || hasPy || hasDocker || hasSrc) roots.push(e)
  }
  // a server at the repo root (package.json/requirements at top level, not a package-only repo)
  if ((isFile(join(target, 'package.json')) || isFile(join(target, 'requirements.txt'))) && !roots.includes('.')) {
    if (!isFile(join(target, 'sfdx-project.json')) || roots.length === 0) roots.unshift('.')
  }
  // Prefer the obvious web-API tier when a repo has several server roots (an external
  // API + an MCP sidecar both qualify; the full build stands up each — for now pick the
  // web-named one first so detection lands on the primary DAST target, not a sidecar).
  const WEB_FIRST = /^(api|server|app|backend|web|service|forecast|gateway)/i
  return roots.sort((a, b) => (WEB_FIRST.test(b) ? 1 : 0) - (WEB_FIRST.test(a) ? 1 : 0))
}

/** Collect env-var names referenced across recipe files + source. */
function gatherEnvNames(target, roots) {
  const names = new Set()
  const add = (re, text, idx = 1) => { let m; const r = new RegExp(re, 'g'); while ((m = r.exec(text))) names.add(m[idx]) }
  // declared sources: .env.example / compose environment / Dockerfile ENV-ARG
  for (const f of ['.env.example', '.env.sample', '.env.template', '.env.dist']) {
    add('^\\s*([A-Z][A-Z0-9_]+)\\s*=', readOr(join(target, f)))
  }
  const compose = readOr(firstExisting(target, ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) || '')
  add('\\$\\{?([A-Z][A-Z0-9_]+)', compose)
  add('^\\s*-?\\s*([A-Z][A-Z0-9_]+)\\s*[:=]', compose)
  // source refs in each root
  for (const root of roots) {
    const dir = root === '.' ? target : join(target, root)
    let files = []
    try { files = readdirSync(dir).map((f) => join(dir, f)).filter((p) => isFile(p) && /\.(js|ts|mjs|cjs|py|go|env|example|sample)$/i.test(p)) } catch {}
    for (const ef of ['.env.example', '.env.sample']) { const p = join(dir, ef); if (isFile(p)) files.push(p) }
    for (const p of files.slice(0, 40)) {
      const t = readOr(p)
      add('process\\.env\\.([A-Z][A-Z0-9_]+)', t)
      add("process\\.env\\[['\"]([A-Z][A-Z0-9_]+)['\"]\\]", t)
      add("os\\.environ(?:\\.get)?\\[?\\(?['\"]([A-Z][A-Z0-9_]+)['\"]", t)
      add("getenv\\(['\"]([A-Z][A-Z0-9_]+)['\"]", t)
      add('^\\s*([A-Z][A-Z0-9_]+)\\s*=', t) // env files
    }
  }
  return [...names]
}

/** Resolve a run recipe + web tier (kind, command, port). */
function gatherRecipe(target, roots) {
  const compose = firstExisting(target, ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'])
  if (compose) {
    const t = readOr(compose)
    const portM = t.match(/(\d{2,5})\s*:\s*(\d{2,5})/) // host:container
    return { recipe: { kind: 'compose', file: compose.replace(target + '/', '') }, webTier: portM ? { port: Number(portM[1]) } : null }
  }
  // per-root recipes
  for (const root of roots) {
    const dir = root === '.' ? target : join(target, root)
    if (isFile(join(dir, 'Dockerfile'))) {
      const t = readOr(join(dir, 'Dockerfile'))
      const expose = t.match(/EXPOSE\s+(\d{2,5})/i)
      return { recipe: { kind: 'dockerfile', root, file: join(root, 'Dockerfile') }, webTier: expose ? { port: Number(expose[1]) } : null }
    }
    const pkgPath = join(dir, 'package.json')
    if (isFile(pkgPath)) {
      let pkg = {}; try { pkg = JSON.parse(readOr(pkgPath)) } catch {}
      const start = pkg.scripts && pkg.scripts.start
      if (start) {
        const src = readOr(join(dir, pkg.main || 'index.js')) + readOr(join(dir, 'server.js')) + readOr(join(dir, 'app.js'))
        const listenM = src.match(/listen\(\s*(?:process\.env\.PORT\s*\|\|\s*)?(\d{2,5})/) || src.match(/PORT\s*\|\|\s*(\d{2,5})/)
        return { recipe: { kind: 'node', root, command: 'npm start', entry: pkg.main || 'index.js' }, webTier: listenM ? { port: Number(listenM[1]) } : { port: 8080 } }
      }
    }
    if (isFile(join(dir, 'requirements.txt')) || isFile(join(dir, 'pyproject.toml'))) {
      const entry = ['app.py', 'main.py', 'server.py', 'wsgi.py', 'asgi.py', 'manage.py'].find((f) => isFile(join(dir, f)))
      if (entry) return { recipe: { kind: 'python', root, entry }, webTier: { port: 8000 } }
    }
  }
  const proc = firstExisting(target, ['Procfile'])
  if (proc && /web:/.test(readOr(proc))) return { recipe: { kind: 'procfile', file: 'Procfile' }, webTier: null }
  return { recipe: null, webTier: null }
}

function gatherFacts(target) {
  const roots = serverRoots(target)
  const { recipe, webTier } = gatherRecipe(target, roots)
  const envNames = gatherEnvNames(target, roots)
  return { serverRoots: roots, recipe, webTier, envNames }
}

function main() {
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d }
  const target = arg('--target', process.cwd())
  const r = classifyStack(gatherFacts(target))
  if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); return }
  const L = [`[${r.status}] ${r.reason}`]
  if (r.env) {
    if (r.env.synthesizable.length) L.push(`  toolkit generates: ${r.env.synthesizable.join(', ')}`)
    if (r.env.external.length) L.push(`  owner must supply (external): ${r.env.external.join(', ')}`)
    if (r.env.unknown.length) L.push(`  unclassified (default/leave-unset, review): ${r.env.unknown.join(', ')}`)
  }
  process.stdout.write(L.join('\n') + '\n')
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) }
  catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

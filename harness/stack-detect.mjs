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
 * COMPOSE-SATISFIABILITY (0.8.81): a SELF-CONTAINED compose (in-compose postgres/
 * redis, `${VAR:-default}` creds, concrete `KEY: value` assignments) satisfies its
 * own external-named env — those vars are NOT owner-supplied, so they must not
 * block the throwaway-DAST gate. `classifyStack` reclassifies an `external` env
 * name that the compose itself satisfies (`facts.satisfiable`) to `synthesizable`
 * (secret-named) or `benign`; and when the recipe is a compose with NO `env_file:`
 * directive, env gathering is scoped to the compose file alone — env referenced
 * only by source the compose never runs (one-off scripts, alt entrypoints) is not
 * a stand-up blocker. `${VAR:?required}` / `${VAR:+alt}` / bare `${VAR}` have no
 * fallback and stay owner-supplied.
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

// ── Compose-satisfiability helpers (pure, regex-only — no YAML parser) ──────────

/**
 * Pure: the service names a compose file defines (top-level keys under `services:`).
 * Captures `name:` lines at the FIRST child indent and BREAKS at the first
 * zero-indent line, so a sibling top-level block (`volumes:` with
 * postgres_data/redis_data) is never captured as a service.
 */
export function composeServiceNames(text) {
  const names = []
  let inServices = false
  let childIndent = -1
  for (const line of String(text || '').split('\n')) {
    if (!inServices) {
      if (/^services:\s*(?:#.*)?$/.test(line)) inServices = true
      continue
    }
    if (/^\S/.test(line)) break // first zero-indent line → left the services block
    const m = line.match(/^(\s+)([A-Za-z0-9_.-]+):\s*(?:#.*)?$/)
    if (!m) continue
    if (childIndent < 0) childIndent = m[1].length // first child sets the service indent
    if (m[1].length === childIndent) names.push(m[2])
  }
  return names
}

/**
 * Pure: env vars the compose interpolates WITH a fallback — `${VAR:-def}` /
 * `${VAR:=def}`. The `:[-=]` deliberately EXCLUDES `${VAR:?required}` and
 * `${VAR:+alt}` (no fallback value → the var stays owner-supplied).
 */
export function composeDefaultedVars(text) {
  const out = new Set()
  const re = /\$\{([A-Z][A-Z0-9_]+):[-=]/g
  let m
  while ((m = re.exec(String(text || '')))) out.add(m[1])
  return out
}

/**
 * Pure: env keys the compose assigns a CONCRETE value (`KEY: value` /
 * `- KEY=value`): strip `${VAR:-..}` / `${VAR:=..}` interpolations from the
 * value — if no bare `${` remains, the compose supplies the value itself
 * (subsumes "URL points at an in-compose service" and plain literals).
 * `KEY:` with no value (host pass-through) is NOT concrete.
 */
export function composeConcreteAssigned(text) {
  const out = new Set()
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*(?:-\s*)?([A-Z][A-Z0-9_]+)\s*[:=]\s*(.+)$/)
    if (!m || !m[2].trim()) continue // whitespace-only value = pass-through, not concrete
    const stripped = m[2].replace(/\$\{[A-Z][A-Z0-9_]+:[-=][^}]*\}/g, '')
    if (!stripped.includes('${')) out.add(m[1])
  }
  return out
}

// ── Compose web-tier selection (pure, raw-text — picks the DAST target service) ──
// The naive "first bare digit:digit in the whole file" picker mis-selects: an
// interpolated infra mapping (`${VAR:-N}:N`) is skipped because the `}` breaks the
// digit run, so a frontend's bare `"3000:3000"` wins and the DAST scans the UI, not
// the API. composeWebTier scores every host-publishing service — API-name and
// run-command fingerprint UP, frontend/proxy DOWN, +1 per incoming depends_on — hard-
// excludes datastores by NAME and by IMAGE, and degrades the label loudly on a
// frontend-only / expose-only-API / zero-candidate shape rather than guessing.
const INFRA_NAME = /^(postgres|postgresql|pg|mysql|mariadb|mongo|mongodb|redis|valkey|memcache|rabbit|rabbitmq|amqp|kafka|zookeeper|elastic|opensearch|etcd|minio|clickhouse|cassandra|cockroach|nats|vault|db|database|cache|queue|broker|mailhog|mailpit|adminer|pgadmin|prometheus|grafana)/i
const INFRA_IMAGE = /(postgres|postgresql|mysql|mariadb|mongo|redis|valkey|memcached?|rabbitmq|kafka|zookeeper|elasticsearch|opensearch|etcd|minio|clickhouse|cassandra|cockroach|nats|vault|adminer|pgadmin|prometheus|grafana|mailhog|mailpit)/i
// API-name matches the keyword at the start OR after a `-`/`_` separator (so `db-gateway`
// and `database-api` are rescued from the infra name filter), plus `api` anywhere.
const API_NAME = /(?:^|[-_])(api|backend|server|app|gateway|service|core|rest|graphql)\b|-?api/i
const FRONTEND_NAME = /(web|frontend|ui|client|next|nuxt|vite|react|vue|angular|svelte|static|nginx|traefik|caddy|envoy|haproxy|proxy|admin|dashboard|console|backoffice)/i
const PROXY_NAME = /(nginx|traefik|caddy|envoy|haproxy|proxy)/i
const WEBSERVER_CMD = /\b(uvicorn|gunicorn|hypercorn|daphne|granian|node|nodemon|next|npm(?:\s+run)?\s+(?:start|dev)|yarn\s+(?:start|dev)|http-server|serve|puma|unicorn|rails\s+s|flask\s+run|waitress)\b/i

const unq = (s) => String(s == null ? '' : s).trim().replace(/^["']|["']$/g, '')

/** Pure: segment the `services:` block into per-service { name, lines } records —
 *  indent-walk mirroring composeServiceNames (BREAK at the first zero-indent line so a
 *  top-level volumes:/networks: block is never captured as a service). */
function composeServiceBlocks(text) {
  const blocks = []
  let inServices = false
  let childIndent = -1
  let current = null
  for (const line of String(text || '').split('\n')) {
    if (!inServices) {
      if (/^services:\s*(?:#.*)?$/.test(line)) inServices = true
      continue
    }
    if (/^\S/.test(line)) break // first zero-indent line → left the services block
    const m = line.match(/^(\s+)([A-Za-z0-9_.-]+):\s*(?:#.*)?$/)
    if (m && (childIndent < 0 || m[1].length === childIndent)) {
      if (childIndent < 0) childIndent = m[1].length
      if (m[1].length === childIndent) { current = { name: m[2], lines: [] }; blocks.push(current); continue }
    }
    if (current) current.lines.push(line)
  }
  return blocks
}

/** Pure: split a port spec on top-level `:` (never inside `${...}`). */
function splitColon(s) {
  const parts = []; let cur = ''; let depth = 0
  for (const ch of String(s)) {
    if (ch === '{') depth++
    else if (ch === '}') depth = Math.max(0, depth - 1)
    if (ch === ':' && depth === 0) { parts.push(cur); cur = '' } else cur += ch
  }
  parts.push(cur); return parts
}

/** Pure: resolve one port token → a number, or null when it interpolates with no default.
 *  `${VAR:-N}`/`${VAR:=N}` → N; `${VAR}`/`${VAR:?..}`/`${VAR:+..}`/`$VAR` → null; bare N → N. */
function resolveTok(tok) {
  const t = String(tok == null ? '' : tok).trim()
  const def = t.match(/^\$\{[A-Za-z_][A-Za-z0-9_]*:[-=]([0-9]+)\}/)
  if (def) return Number(def[1])
  if (/\$\{|\$[A-Za-z_]/.test(t)) return null
  if (/^[0-9]+$/.test(t)) return Number(t)
  return null
}

/** Pure: `H:C` | `IP:H:C` | `C` | `${VAR:-H}:C` → { host, container, port }. An
 *  unresolvable host interpolation falls back to the container port (aligns with
 *  planCompose's `target` match). */
function resolvePortSpec(spec) {
  const parts = splitColon(unq(spec)).map((x) => x.trim()).filter((x) => x !== '')
  if (!parts.length) return null
  let hostTok = null; let contTok = null
  if (parts.length === 1) contTok = parts[0]
  else if (parts.length === 2) { hostTok = parts[0]; contTok = parts[1] }
  else { hostTok = parts[parts.length - 2]; contTok = parts[parts.length - 1] }
  const container = resolveTok(contTok)
  const host = hostTok == null ? null : resolveTok(hostTok)
  const port = host != null ? host : container
  if (port == null && container == null) return null
  return { host, container, port }
}

/** Pure: long-form `{ target, published }` → { host, container, port }. */
function resolveMapPort(map) {
  const container = resolveTok(map.target)
  const host = map.published != null ? resolveTok(map.published) : null
  const port = host != null ? host : container
  if (port == null && container == null) return null
  return { host, container, port }
}

/** Pure: parse `[a, b]` / bare-scalar inline YAML list → trimmed, unquoted items. */
function inlineList(s) {
  const t = String(s).trim()
  const arr = t.match(/^\[(.*)\]$/)
  const items = arr ? arr[1].split(',') : [t]
  return items.map(unq).filter(Boolean)
}

/** Pure: a service's host-published ports (short, long, bind-IP, and interpolated forms). */
function svcPorts(lines) {
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)ports:\s*(.*)$/)
    if (!m) continue
    const indent = m[1].length
    if (m[2].trim()) { for (const tok of inlineList(m[2])) { const p = resolvePortSpec(tok); if (p) out.push(p) } ; continue }
    let map = null
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) continue
      const subIndent = lines[j].match(/^(\s*)/)[1].length
      if (subIndent <= indent) break
      const li = lines[j].match(/^\s*-\s*(.*)$/)
      if (li) {
        if (map) { const p = resolveMapPort(map); if (p) out.push(p); map = null }
        const rest = li[1].trim()
        const kv = rest.match(/^([A-Za-z_]+):\s*(.+)$/)
        if (kv) map = { [kv[1]]: unq(kv[2]) }
        else { const p = resolvePortSpec(rest); if (p) out.push(p) }
      } else if (map) {
        const kv = lines[j].match(/^\s*([A-Za-z_]+):\s*(.+)$/)
        if (kv) map[kv[1]] = unq(kv[2])
      }
    }
    if (map) { const p = resolveMapPort(map); if (p) out.push(p) }
  }
  return out
}

/** Pure: a service's `expose:` container-only ports (never host-reachable). */
function svcExpose(lines) {
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)expose:\s*(.*)$/)
    if (!m) continue
    const indent = m[1].length
    if (m[2].trim()) { for (const tok of inlineList(m[2])) { const n = resolveTok(tok); if (n) out.push(n) } ; continue }
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) continue
      const subIndent = lines[j].match(/^(\s*)/)[1].length
      if (subIndent <= indent) break
      const li = lines[j].match(/^\s*-\s*(.+)$/)
      if (li) { const n = resolveTok(unq(li[1])); if (n) out.push(n) }
    }
  }
  return out
}

/** Pure: the service `image:` string, or null. */
function svcImage(lines) {
  for (const line of lines) { const m = line.match(/^\s*image:\s*["']?([^"'#\s]+)/); if (m) return m[1] }
  return null
}

/** Pure: the concatenated `command:`/`entrypoint:` text (inline + list forms). */
function svcCommand(lines) {
  let cmd = ''
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(command|entrypoint):\s*(.*)$/)
    if (!m) continue
    const indent = m[1].length
    if (m[3].trim()) { cmd += ' ' + m[3]; continue }
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) continue
      const subIndent = lines[j].match(/^(\s*)/)[1].length
      if (subIndent <= indent) break
      cmd += ' ' + lines[j].replace(/^\s*-?\s*/, '')
    }
  }
  return cmd
}

/** Pure: `depends_on` service names in BOTH list-form (`- name`) and map-form
 *  (`name:` child, with nested `condition:` ignored). */
function svcDependsOn(lines) {
  const deps = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)depends_on:\s*(.*)$/)
    if (!m) continue
    const indent = m[1].length
    if (m[2].trim()) { for (const tok of inlineList(m[2])) deps.push(tok); continue }
    let depIndent = -1
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) continue
      const subIndent = lines[j].match(/^(\s*)/)[1].length
      if (subIndent <= indent) break
      const li = lines[j].match(/^\s*-\s*(.+)$/)
      if (li) { deps.push(unq(li[1])); continue }
      const kv = lines[j].match(/^(\s*)([A-Za-z0-9_.-]+):\s*(.*)$/)
      if (kv) { if (depIndent < 0) depIndent = kv[1].length; if (kv[1].length === depIndent) deps.push(kv[2]) }
    }
  }
  return deps
}

/**
 * PURE. Pick the DAST-target web tier from raw compose text. Returns
 * `{ port, service, ambiguous, candidates[], exposedApiTier[], note }`. `port` is null
 * when no non-infra service host-publishes (REFUSE — never scan a datastore). Never
 * throws; a malformed file yields `port:null`.
 */
export function composeWebTier(text) {
  const parsed = composeServiceBlocks(text).map((b) => ({
    name: b.name,
    ports: svcPorts(b.lines),
    expose: svcExpose(b.lines),
    image: svcImage(b.lines),
    command: svcCommand(b.lines),
    dependsOn: svcDependsOn(b.lines),
  }))
  const incoming = {}
  for (const s of parsed) for (const d of s.dependsOn) incoming[d] = (incoming[d] || 0) + 1
  // datastore hard-exclude (name OR image), with the api-named rescue
  const isInfra = (s) => (INFRA_NAME.test(s.name) || (s.image && INFRA_IMAGE.test(s.image))) && !API_NAME.test(s.name)
  const candidates = parsed.filter((s) => s.ports.length > 0 && !isInfra(s))
  const exposedApiTier = parsed
    .filter((s) => s.ports.length === 0 && s.expose.length > 0 && API_NAME.test(s.name) && !isInfra(s))
    .map((s) => s.name)
  if (!candidates.length) {
    const apiNote = exposedApiTier.length
      ? `API tier ${exposedApiTier.join(', ')} is expose-only and is NOT host-reachable / NOT scanned — ` : ''
    return { port: null, service: null, ambiguous: false, candidates: [], exposedApiTier, note: `${apiNote}no application web tier is host-published` }
  }
  const portOf = (s) => { for (const p of s.ports) if (p.port != null) return p.port; return null }
  const scoreOf = (s) => {
    let sc = 0
    if (API_NAME.test(s.name)) sc += 3
    if (s.command && WEBSERVER_CMD.test(s.command)) sc += 3
    if (FRONTEND_NAME.test(s.name)) sc -= 2
    return sc + (incoming[s.name] || 0)
  }
  const scored = candidates.map((s, i) => ({ service: s.name, port: portOf(s), score: scoreOf(s), order: i, svc: s }))
  scored.sort((a, b) => b.score - a.score || a.order - b.order)
  const winner = scored[0]
  const tied = scored.filter((s) => s.score === winner.score)
  const ambiguous = tied.length > 1
  const notes = []
  if (ambiguous) notes.push(`multiple web tiers tie (${tied.map((s) => `${s.service}:${s.port}`).join(', ')}) — inferred ${winner.service}:${winner.port}; pass --port to target another`)
  if (winner.score < 0) {
    const forwards = PROXY_NAME.test(winner.service) && winner.svc.dependsOn.some((d) => exposedApiTier.includes(d))
    notes.push(forwards
      ? `scanned via the front proxy ${winner.service} — reaches the API transitively if it forwards`
      : `web tier ${winner.service} is a UI/frontend — this is a UI/frontend scan, not an API scan`)
  }
  if (exposedApiTier.length) notes.push(`API tier ${exposedApiTier.join(', ')} is expose-only and is NOT host-reachable / NOT scanned — this baseline covers only the host-published ${winner.service} tier`)
  return {
    port: winner.port, service: winner.service, ambiguous, exposedApiTier,
    candidates: scored.map((s) => ({ service: s.service, port: s.port, score: s.score })),
    note: notes.join('; '),
  }
}

/** Pure: the classifyStack reason fragment for a resolved web tier (or the no-tier note). */
function webTierReason(wt) {
  if (!wt) return ''
  if (wt.port == null) return `; NO SCANNABLE WEB TIER — ${wt.note || 'no application web tier is host-published'}; pass --port to target one`
  let frag = `, web tier port ${wt.port}${wt.service ? ` (${wt.service})` : ''}`
  if (wt.ambiguous) frag += ` AMBIGUOUS — ${wt.note}`
  else if (wt.note) frag += `; NOTE: ${wt.note}`
  return frag
}

/** Pure: from gathered facts, classify the throwaway-DAST readiness. */
export function classifyStack(facts = {}) {
  const roots = Array.isArray(facts.serverRoots) ? facts.serverRoots : []
  const recipe = facts.recipe || null
  if (!roots.length && !recipe) {
    return { status: 'n/a', reason: 'no external server source root found — nothing to stand up (package-only)' }
  }
  // Compose-satisfiability: env the compose itself satisfies (defaulted `${VAR:-..}`
  // interpolations + concrete `KEY: value` assignments) is not owner-supplied, so an
  // external-named var the compose covers downgrades to synthesizable (secret-named:
  // the toolkit may still generate a value) or benign (the compose's own default runs).
  const satisfiable = facts.satisfiable instanceof Set
    ? facts.satisfiable
    : new Set(Array.isArray(facts.satisfiable) ? facts.satisfiable : [])
  const buckets = { external: [], synthesizable: [], benign: [], unknown: [] }
  for (const n of [...new Set(facts.envNames || [])]) {
    let cls = classifyEnvName(n)
    if (cls === 'external' && satisfiable.has(n)) cls = SECRET_ENV.test(n) ? 'synthesizable' : 'benign'
    buckets[cls].push(n)
  }
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
  const services = Array.isArray(facts.composeServices) ? facts.composeServices.filter(Boolean) : []
  return { status: 'runnable', recipe, webTier: facts.webTier || null, serverRoots: roots, env,
    reason: `standable: ${recipe.kind} recipe${webTierReason(facts.webTier)}` +
      (services.length ? ` (in-compose services: ${services.join(', ')})` : '') +
      `; env the toolkit generates: ${env.synthesizable.join(', ') || 'none'}` +
      '; note: stand-up is HTTP-liveness-verified only (a port answers), not app-health-verified — migrations/deep readiness are not asserted' }
}

// ── CLI fact-gathering (dependency-free; best-effort regex/file scans) ──────────
const SKIP_DIRS = new Set(['.git', 'node_modules', 'force-app', '.security-review', 'docs', '.claude', 'venv', '.venv', '__pycache__', 'dist', 'build'])
const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']
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
function gatherEnvNames(target, roots, recipe = null) {
  const names = new Set()
  const add = (re, text, idx = 1) => { let m; const r = new RegExp(re, 'g'); while ((m = r.exec(text))) names.add(m[idx]) }
  const compose = readOr(firstExisting(target, COMPOSE_FILES) || '')
  // Compose-scoped gathering: when the run recipe IS the compose and it declares no
  // `env_file:`, the compose defines the app's entire env surface — env referenced
  // only by source files the compose never runs (one-off scripts, alt entrypoints,
  // e.g. a scripts/*.py ADMIN_DATABASE_URL) must not block stand-up. Any `env_file:`
  // directive falls back to the full union gathering (safe over-flag direction).
  const composeScoped = Boolean(recipe && recipe.kind === 'compose' && compose && !/^\s*env_file\s*:/m.test(compose))
  add('\\$\\{?([A-Z][A-Z0-9_]+)', compose)
  add('^\\s*-?\\s*([A-Z][A-Z0-9_]+)\\s*[:=]', compose)
  if (composeScoped) return [...names]
  // declared sources: .env.example / compose environment / Dockerfile ENV-ARG
  for (const f of ['.env.example', '.env.sample', '.env.template', '.env.dist']) {
    add('^\\s*([A-Z][A-Z0-9_]+)\\s*=', readOr(join(target, f)))
  }
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
  const compose = firstExisting(target, COMPOSE_FILES)
  if (compose) {
    const t = readOr(compose)
    // full honesty object (port + service + ambiguity + expose-only-API note), NOT the
    // naive first-bare-digit:digit pick — and returned even when .port === null so the
    // no-scannable-tier note survives into the classifyStack reason.
    return { recipe: { kind: 'compose', file: compose.replace(target + '/', '') }, webTier: composeWebTier(t) }
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
  const envNames = gatherEnvNames(target, roots, recipe)
  // Compose-satisfiability facts (empty when no compose file → non-compose stacks unchanged)
  const composeText = readOr(firstExisting(target, COMPOSE_FILES) || '')
  const satisfiable = new Set([...composeDefaultedVars(composeText), ...composeConcreteAssigned(composeText)])
  const composeServices = composeServiceNames(composeText)
  return { serverRoots: roots, recipe, webTier, envNames, satisfiable, composeServices }
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

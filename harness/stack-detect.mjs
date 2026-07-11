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
import { join, dirname, resolve } from 'node:path'
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

/** Pure: does the service declare a `build:` key — inline (`build: ./api`) or block form
 *  (`build:` with `context:`/`dockerfile:` children)? A tier that declares BOTH `image:`
 *  and `build:` still builds from source (the `image:` is the tag Compose applies to the
 *  build), so `image:` alone must never read as "prebuilt". */
export function svcBuild(lines) {
  for (const line of lines) { if (/^\s*build\s*:/.test(line)) return true }
  return false
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
 * PURE. The `env_file:` target paths a compose declares — short form (`env_file: .env`)
 * and list form (`env_file:` + `- .env` children), across every service. Mirrors the
 * svcPorts/composeServiceBlocks scanner idioms. A referenced env_file that is ABSENT on
 * disk hard-fails `docker compose config` at stand-up, so the detector must see these
 * paths to gate them (existsSync) instead of dying on a swallowed stderr later.
 */
export function composeEnvFiles(text) {
  const out = []
  const lines = String(text || '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)env_file\s*:\s*(.*?)\s*(?:#.*)?$/)
    if (!m) continue
    const indent = m[1].length
    if (m[2].trim()) { for (const tok of inlineList(m[2])) out.push(tok); continue }
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) continue
      const subIndent = lines[j].match(/^(\s*)/)[1].length
      if (subIndent <= indent) break
      const li = lines[j].match(/^\s*-\s*(.+)$/)
      if (li) out.push(unq(li[1]))
    }
  }
  return [...new Set(out)]
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

/**
 * PURE. Does the compose's picked web/api tier resolve an `image:` (a PREBUILT image) rather
 * than build from source? The signal the fires-path ladder's rung 2 keys off (0.8.109): a
 * `*.prod.yml` whose web tier ships `image: <name>:latest` can be stood up with ZERO image
 * build — no heavy `docker build` competing with the audit fan-out. Reuses composeWebTier's
 * scored web-tier pick, then reads that service's `image:` via svcImage. Returns
 * `{ prebuilt, service, image }`; prebuilt is false when no web tier is host-published or the
 * picked tier builds from source. Never throws.
 */
export function composeWebTierImage(text) {
  const wt = composeWebTier(text)
  if (!wt || !wt.service) return { prebuilt: false, service: null, image: null }
  const block = composeServiceBlocks(text).find((b) => b.name === wt.service)
  const image = block ? svcImage(block.lines) : null
  // `image:` + `build:` together = a build-from-source tier whose built image gets that
  // tag — on a clean box the tag is not cached, so rung 2's "zero build" claim would be
  // false; only an image WITHOUT a build directive is genuinely prebuilt.
  const builds = block ? svcBuild(block.lines) : false
  return { prebuilt: Boolean(image) && !builds, service: wt.service, image: image || null }
}

/**
 * PURE. Detect a schema-migration mechanism from PRESENCE signals — DETECTION ONLY, for the
 * honesty label (never run). `signals.files` is a list of canonical presence keys; a compose
 * migration service (name in the set below) counts too. Returns `{tool,command}` or null.
 * The command is a descriptive hint the label surfaces ("DETECTED but NOT run"), never executed.
 */
export function detectMigration(signals = {}) {
  const files = new Set((Array.isArray(signals.files) ? signals.files : []).map(String))
  const services = Array.isArray(signals.composeServices) ? signals.composeServices : []
  const has = (p) => files.has(p)
  if (has('alembic.ini') || has('alembic/') || has('migrations/env.py')) return { tool: 'alembic', command: 'alembic upgrade head' }
  if (has('prisma/schema.prisma')) return { tool: 'prisma', command: 'prisma migrate deploy' }
  if (has('manage.py')) return { tool: 'django', command: 'python manage.py migrate' }
  if (has('knexfile.js') || has('knexfile.ts')) return { tool: 'knex', command: 'knex migrate:latest' }
  const svc = services.find((n) => /^(migrate|migration|db-migrate|init|flyway|liquibase)$/i.test(String(n)))
  if (svc) return { tool: `compose:${svc}`, command: `docker compose run ${svc}` }
  return null
}

/**
 * PURE. Resolve a compose-less Python entry's run command from its CONSTRUCTOR (never a bare
 * `app =` match — routing a WSGI Flask callable to uvicorn crashes at boot). Returns
 * `{server,kind,module,var|factory,bestEffort?,note?}` or `{unsupported,reason}`. Decision
 * order, most-reliable first: ASGI ctor → uvicorn; WSGI ctor → gunicorn/flask; factory →
 * uvicorn --factory / gunicorn by deps (refuse to GUESS when deps can't disambiguate);
 * self-launcher → best-effort `python <entry>`; else unsupported (→ needs-recipe).
 */
export function resolvePythonRun(entry, entryText, depsText) {
  const text = String(entryText || '')
  const deps = String(depsText || '').toLowerCase()
  const module = String(entry || '').replace(/\.py$/, '').replace(/[\\/]/g, '.')
  const asgiServer = /\b(uvicorn|hypercorn|daphne|granian)\b/.test(deps)
  const asgiFramework = /\b(fastapi|starlette|litestar|quart)\b/.test(deps)
  const asgiSignal = asgiServer || asgiFramework
  const flaskSignal = /\bflask\b/.test(deps)
  const hasGunicorn = /\bgunicorn\b/.test(deps)
  const asgiNote = 'ASGI server not in the partner deps; uvicorn provided by the harness — the partner container would not boot this way'
  // 1. ASGI constructor (FastAPI/Starlette/Litestar/Quart, or Django get_asgi_application)
  let m = text.match(/(\w+)\s*=\s*(?:FastAPI|Starlette|Litestar|Quart)\s*\(/)
    || text.match(/(\w+)\s*=\s*get_asgi_application\s*\(/)
  if (m) {
    const r = { server: 'uvicorn', kind: 'asgi', module, var: m[1] }
    if (!asgiServer) Object.assign(r, { bestEffort: true, provideServer: 'uvicorn', note: asgiNote })
    return r
  }
  // 2. WSGI constructor (Flask, or Django get_wsgi_application) → gunicorn if present, else the
  //    flask CLI (which always ships with Flask)
  m = text.match(/(\w+)\s*=\s*Flask\s*\(/) || text.match(/(\w+)\s*=\s*get_wsgi_application\s*\(/)
  if (m) return hasGunicorn
    ? { server: 'gunicorn', kind: 'wsgi', module, var: m[1] }
    : { server: 'flask', kind: 'wsgi', module, var: m[1] }
  // 3. Factory — disambiguate by deps; REFUSE to guess uvicorn-vs-gunicorn (the honesty trap)
  m = text.match(/def\s+(create_app|get_app|make_app)\s*\(/)
  if (m) {
    const factory = m[1]
    if (asgiSignal && !flaskSignal) {
      const r = { server: 'uvicorn', kind: 'asgi', module, factory }
      if (!asgiServer) Object.assign(r, { bestEffort: true, provideServer: 'uvicorn', note: asgiNote })
      return r
    }
    if (flaskSignal && !asgiSignal) return hasGunicorn
      ? { server: 'gunicorn', kind: 'wsgi', module, factory }
      : { server: 'flask', kind: 'wsgi', module, factory }
    return { unsupported: true, reason: `factory ${factory}() in ${entry} but deps can't disambiguate ASGI vs WSGI — provide a start command` }
  }
  // 4. Self-launcher (__main__ + a .run(/.serve() call) with NO ctor → best-effort python <entry>
  if (/if\s+__name__\s*==\s*['"]__main__['"]\s*:/.test(text) && /\.(?:run|serve)\s*\(/.test(text)) {
    return { server: 'self', kind: 'self', module, var: null, bestEffort: true,
      note: 'self-launcher (__main__) — the app owns its bind and may pin container-127.0.0.1 (unreachable through the host loopback publish); HOST=0.0.0.0 is a mitigation only if honored' }
  }
  // 5. Nothing resolvable → unsupported (honest, owner-run)
  return { unsupported: true, reason: `no ASGI/WSGI app object or __main__ launcher found in ${entry} — provide a start command` }
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

// DB-shaped env names for the external-managed-DB honesty note: a compose whose database
// is an EXTERNAL managed service (a real DATABASE_URL) with NO in-compose datastore leaves
// the isolated throwaway DB-less — the api tier may not come up even with a filled env-file.
const EXTERNAL_DB_ENV = /(DATABASE|POSTGRES|PGHOST|MYSQL|MARIADB|MONGO)/i

/** Pure: from gathered facts, classify the throwaway-DAST readiness. */
export function classifyStack(facts = {}) {
  const roots = Array.isArray(facts.serverRoots) ? facts.serverRoots : []
  const recipe = facts.recipe || null
  if (!roots.length && !recipe) {
    return { status: 'n/a', migration: facts.migration || null, reason: 'no external server source root found — nothing to stand up (package-only)' }
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
    return { status: 'needs-recipe', serverRoots: roots, env, migration: facts.migration || null,
      reason: `external source at ${roots.join(', ')} but no runnable recipe (no compose / Dockerfile / start script) — provide a start command` }
  }
  // External-managed-DB honesty note: a compose recipe with a DB-shaped EXTERNAL env var and
  // NO in-compose datastore service means the isolated throwaway has no database at all —
  // never a silent degrade; steer to rung 1 instead of a doomed stand-up. Reads
  // facts.composeServices directly (the `services` local below is only built on the
  // runnable path, after the needs-secrets returns).
  const composeSvcs = Array.isArray(facts.composeServices) ? facts.composeServices.filter(Boolean) : []
  const externalDbNote = (recipe.kind === 'compose'
    && env.external.some((n) => EXTERNAL_DB_ENV.test(n))
    && !composeSvcs.some((n) => INFRA_NAME.test(n)))
    ? '; NOTE: a DB-shaped env var is EXTERNAL-managed and the compose defines no in-compose database service — the isolated throwaway has no DB, so the api tier may not come up even with a filled env-file; prefer rung 1 (an already-running --base-url)'
    : ''
  // A compose recipe referencing an env_file that is ABSENT on disk cannot be runnable —
  // `docker compose config` hard-fails on it at stand-up. Name the file here, up front,
  // instead of a swallowed stderr later. Env buckets are already computed (above), so
  // env.external stays fully populated on this branch too.
  const missingEnvFiles = (Array.isArray(facts.missingEnvFiles) ? facts.missingEnvFiles : []).filter(Boolean)
  if (missingEnvFiles.length) {
    return { status: 'needs-secrets', recipe, webTier: facts.webTier || null, migration: facts.migration || null, serverRoots: roots, env,
      reason: `recipe compose references env_file '${missingEnvFiles.join("', '")}' which is absent — provide it (or scaffold-env) before stand-up` +
        (env.external.length ? `; external creds also needed: ${env.external.join(', ')}` : '') + externalDbNote }
  }
  if (env.external.length) {
    return { status: 'needs-secrets', recipe, webTier: facts.webTier || null, migration: facts.migration || null, serverRoots: roots, env,
      reason: `recipe present but needs external-service credentials the toolkit cannot synthesize: ${env.external.join(', ')} — scaffold-and-guide` + externalDbNote }
  }
  const services = Array.isArray(facts.composeServices) ? facts.composeServices.filter(Boolean) : []
  return { status: 'runnable', recipe, webTier: facts.webTier || null, migration: facts.migration || null, serverRoots: roots, env,
    reason: `standable: ${recipe.kind} recipe${webTierReason(facts.webTier)}` +
      (services.length ? ` (in-compose services: ${services.join(', ')})` : '') +
      `; env the toolkit generates: ${env.synthesizable.join(', ') || 'none'}` +
      '; note: stand-up is HTTP-liveness-verified only — classified up / unhealthy / redirect-only / unknown from an unauthenticated liveness probe (readiness is NOT asserted; DB-backed endpoints unverified, may error), not the production-equivalent scan' }
}

// ── CLI fact-gathering (dependency-free; best-effort regex/file scans) ──────────
const SKIP_DIRS = new Set(['.git', 'node_modules', 'force-app', '.security-review', 'docs', '.claude', 'venv', '.venv', '__pycache__', 'dist', 'build'])
const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']
// Prebuilt-image compose names (0.8.109) — a DEDICATED set for the fires-path ladder's rung-2
// preference pass in gatherRecipe. Kept OUT of COMPOSE_FILES on purpose: that set is consumed by
// `firstExisting` at three env/satisfiability call-sites, and adding prod variants there would
// over-broaden them (they must keep reading the app's canonical env surface). The prod compose
// only changes WHICH recipe file is stood up (prebuilt vs build-from-source), never the env read.
const PROD_COMPOSE_FILES = ['docker-compose.prod.yml', 'docker-compose.prod.yaml', 'compose.prod.yml', 'compose.prod.yaml']
const readOr = (p) => { try { return readFileSync(p, 'utf8') } catch { return '' } }
const isDir = (p) => { try { return statSync(p).isDirectory() } catch { return false } }
const isFile = (p) => { try { return statSync(p).isFile() } catch { return false } }

function firstExisting(target, names) { for (const n of names) { const p = join(target, n); if (isFile(p)) return p } return null }

/** The compose file a compose recipe stands up (absolute path), or null (non-compose / none). */
function recipeComposeFile(target, recipe) {
  return recipe && recipe.kind === 'compose' && recipe.file ? join(target, recipe.file) : null
}

/** The compose text env-gathering, satisfiability, services, and the env_file checks
 *  classify off: the recipe's OWN file when the recipe IS a compose — the file actually
 *  stood up. A rung-2-preferred `*.prod.yml` can declare `env_file:`/env the dev compose
 *  lacks; classifying off the dev file while standing up the prod file left `docker
 *  compose config` to hard-fail on an env surface the detector never read (the cold-run
 *  mystery). Non-compose / no-recipe behavior is unchanged: the first canonical compose. */
function composeTextFor(target, recipe) {
  return readOr(recipeComposeFile(target, recipe) || firstExisting(target, COMPOSE_FILES) || '')
}

/** Discover a prebuilt-image compose file: the known `*.prod.{yml,yaml}` names first, then any
 *  top-level `*.prod.{yml,yaml}` (sorted → deterministic). Returns an absolute path or null. */
function findProdCompose(target) {
  const known = firstExisting(target, PROD_COMPOSE_FILES)
  if (known) return known
  let entries = []
  try { entries = readdirSync(target) } catch { return null }
  const prod = entries.filter((e) => /\.prod\.ya?ml$/i.test(e) && isFile(join(target, e))).sort()
  return prod.length ? join(target, prod[0]) : null
}

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
  const compose = composeTextFor(target, recipe)
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
  // FIRES-PATH LADDER rung 2 (0.8.109): PREFER a prebuilt-image compose over a build-from-source
  // dev compose. When a `*.prod.yml` exists whose picked web/api tier resolves an `image:` (not a
  // `build:`), stand up THAT — no heavy image build competes with the audit fan-out (the run-time
  // DAST failure was resource contention, not a broken build). Records buildsFromSource:false.
  // A prod compose whose web tier still builds from source, or none, falls through to the dev path.
  const prodCompose = findProdCompose(target)
  if (prodCompose) {
    const pt = readOr(prodCompose)
    const img = composeWebTierImage(pt)
    if (img.prebuilt) {
      return {
        recipe: { kind: 'compose', file: prodCompose.replace(target + '/', ''), buildsFromSource: false, prebuiltImage: img.image },
        webTier: composeWebTier(pt),
      }
    }
  }
  const compose = firstExisting(target, COMPOSE_FILES)
  if (compose) {
    const t = readOr(compose)
    // full honesty object (port + service + ambiguity + expose-only-API note), NOT the
    // naive first-bare-digit:digit pick — and returned even when .port === null so the
    // no-scannable-tier note survives into the classifyStack reason.
    return { recipe: { kind: 'compose', file: compose.replace(target + '/', ''), buildsFromSource: true }, webTier: composeWebTier(t) }
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
      // Content-guided (Slice E): resolve the run command from the entry's constructor. Pick the
      // FIRST entry whose resolver is non-unsupported (a stub app.py no longer shadows a real
      // main.py); manage.py stays the conventional Django runserver (no ctor to resolve). All
      // generic entries unsupported → no python recipe → the honest needs-recipe.
      const depsText = readOr(join(dir, 'requirements.txt')) + '\n' + readOr(join(dir, 'pyproject.toml')) + '\n' + readOr(join(dir, 'Pipfile'))
      let chosen = null
      for (const f of ['app.py', 'main.py', 'server.py', 'wsgi.py', 'asgi.py', 'manage.py']) {
        if (!isFile(join(dir, f))) continue
        if (f === 'manage.py') { chosen = { entry: f }; break } // Django management script — conventional
        const run = resolvePythonRun(f, readOr(join(dir, f)), depsText)
        if (!run.unsupported) { chosen = { entry: f, run }; break }
      }
      if (chosen) return { recipe: { kind: 'python', root, entry: chosen.entry, ...(chosen.run ? { run: chosen.run } : {}) }, webTier: { port: 8000 } }
    }
  }
  const proc = firstExisting(target, ['Procfile'])
  if (proc && /web:/.test(readOr(proc))) return { recipe: { kind: 'procfile', file: 'Procfile' }, webTier: null }
  return { recipe: null, webTier: null }
}

/** Collect schema-migration PRESENCE signals (no file contents, no secrets) → detectMigration. */
function gatherMigrationSignals(target, roots, composeServices) {
  const files = new Set()
  const bases = ['.', ...roots.filter((r) => r !== '.')]
  const probes = ['alembic.ini', 'migrations/env.py', 'prisma/schema.prisma', 'manage.py', 'knexfile.js', 'knexfile.ts']
  for (const root of bases) {
    const base = root === '.' ? target : join(target, root)
    for (const rel of probes) if (isFile(join(base, rel))) files.add(rel)
    if (isDir(join(base, 'alembic'))) files.add('alembic/')
  }
  return { files: [...files], composeServices: composeServices || [] }
}

function gatherFacts(target) {
  const roots = serverRoots(target)
  const { recipe, webTier } = gatherRecipe(target, roots)
  const envNames = gatherEnvNames(target, roots, recipe)
  // Compose-satisfiability facts (empty when no compose file → non-compose stacks
  // unchanged). The text is the recipe's own compose file when the recipe IS a compose —
  // satisfiability/services read off the file actually stood up (see composeTextFor).
  const composeText = composeTextFor(target, recipe)
  const satisfiable = new Set([...composeDefaultedVars(composeText), ...composeConcreteAssigned(composeText)])
  const composeServices = composeServiceNames(composeText)
  // An env_file the recipe compose references but which is ABSENT on disk (resolved
  // relative to the compose file's own dir) hard-fails `docker compose config` — surface
  // it as a fact so classifyStack lands an honest needs-secrets NAMING the file.
  const composePath = recipeComposeFile(target, recipe)
  const missingEnvFiles = composePath
    ? composeEnvFiles(composeText).filter((f) => !existsSync(resolve(dirname(composePath), f)))
    : []
  const migration = detectMigration(gatherMigrationSignals(target, roots, composeServices))
  return { serverRoots: roots, recipe, webTier, envNames, satisfiable, composeServices, migration, missingEnvFiles }
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

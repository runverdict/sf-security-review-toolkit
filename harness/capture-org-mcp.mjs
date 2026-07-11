#!/usr/bin/env node
/*
 * capture-org-mcp.mjs — the THIRD, org-effective provenance lane for the
 * `artifact-exposed-tools-list` submission artifact (S3, docs/roadmap-coldrun-hardening.md).
 * The toolkit already has two lanes: (1) the CODE REGISTRY — the tool
 * registration/dispatch table the audit AST-verifies (the SOURCE OF TRUTH); and
 * (2) the raw MCP protocol `tools/list` — the client-advertised surface. The
 * MISSING lane is what the Salesforce ORG actually sees: which registered MCP
 * servers Agentforce ingested into its API-Catalog, and — the UNIQUE evidence —
 * which of their tools/prompts/resources are ACTIVE and wired as callable AGENT
 * ACTIONS (`is-agent-action`). Neither the code registry nor the raw `tools/list`
 * reveals activation state; only reading the org through `sf agent mcp …` does.
 *
 * The `sf` analogue of capture-openapi's inverse: capture-openapi is loopback-only
 * `curl` GET against a container-isolated mirror (throwaway-dast gate); THIS engine
 * spawns `sf agent mcp …` against a REAL Salesforce org, parses banner-polluted
 * `--json`, and rides the org-touching `sf-deep-audit-ops` gate. It mirrors
 * `standup-org.mjs` structure verbatim (pure planner / impure executor split,
 * strict field-allowlist manifest, --dry-run purity, consent fail-closed in main,
 * invokedDirectly guard).
 *
 * BOUNDARIES, ENCODED:
 *   • NAMES/IDS ONLY. `sf agent mcp get`/`fetch --json` bodies can carry a
 *     `serverUrl` with query tokens / session ids and an `authFields`-shaped blob.
 *     The manifest + evidence are assembled FIELD-BY-FIELD from a strict allowlist,
 *     never spread. Per server: `{ id, label, type, status, serverUrlHost }` where
 *     `serverUrlHost` is the URL HOST ONLY (path/query/token DISCARDED; unparseable
 *     → null, never the raw string). Per asset: `{ name, kind, active, isAgentAction }`.
 *   • ENUMERATE REGARDLESS. `list` runs WITHOUT `--status` so DISCONNECTED /
 *     admin-registered servers are enumerated too; each server's `status` is
 *     RECORDED, never filtered on.
 *   • TOLERATE the PREVIEW shape. The CLI is in preview ("This command is in
 *     preview" prints on every invocation) and the JSON field names
 *     (`kind`/`active`/`is-agent-action`) are NOT contract-stable — record what you
 *     got, default a MISSING boolean to `null` (not `false`), never assert completeness.
 *   • NO NEW CONSENT. The org this reads only exists because the recorded
 *     `sf-deep-audit-ops` consent already stood it up (via standup-org). This
 *     executor verifies that SAME token and FAILS CLOSED (throws before any `sf`
 *     spawn) without it — exactly as capture-openapi rides `throwaway-dast`. The
 *     `--fetch` live-callout leg is covered by the same token. NO catalog entry,
 *     NO gate-spec.mjs edit.
 *   • ORG-EFFECTIVE ONLY. This engine reads the org, never the code registry, so
 *     its provenance `counts` are org-effective only: `{ servers, activeAgentActions,
 *     registeredAssets }`. The org-effective active-agent-action count `A`
 *     CORROBORATES the code-registry count `N` (the source of truth) — it never
 *     SUBSTITUTES it. That N-vs-A reconciliation lives in generate-artifacts step 4;
 *     this provenance carries a note to that effect and does NOT restate N.
 *
 * LIVE-LEG BOUNDARY (cold-run-validated, NOT hermetically testable): the actual
 * `sf agent mcp list/get/asset list/fetch` calls need a real authed org with the
 * partner MCP server registered (Einstein1AIPlatform + Agentforce, package
 * installed, Connect-API MCP registration done) — none of that is CI-hermetic.
 * Exactly like standup-org's live `sf org create scratch` and capture-openapi's
 * loopback GETs, the live leg is OPERATOR-COLD-RUN-VALIDATED at the midpoint cold
 * run; the `--fetch` egress leg in particular defers entirely to the cold run
 * behind the recorded gate. The standing tests stub `sf` and pin ONLY what
 * regresses silently (planner argv, consent fail-closed, dry-run purity, names-only
 * manifest, kind/activation bucketing, reconciliation surfacing, fetch-off-by-default).
 *
 * USAGE: node capture-org-mcp.mjs --consent [--fetch] [--date YYYY-MM-DD]
 *          [--target <repo>] [--dry-run] [--json]
 *        (alias is resolved from the .security-review/org-standup.json pointer)
 */
import { mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assertSafeTmpRoot } from './install-scanners.mjs'
import { verifyConsent } from './record-consent.mjs'
import { sfEnv, parseSfJson } from './sf-env.mjs'

export const ORG_MCP_SCHEMA = 'sf-srt-org-mcp/1'
export const ORG_MCP_TMP_PREFIX = 'sf-srt-org-mcp'
const DATE_OK = /^\d{4}-\d{2}-\d{2}$/
// A target-org alias OR username: a bare token, no whitespace / newline / shell
// metachar (a username carries `@` and `.`). Fails closed on an injection-shaped
// value even though `sf` is spawned via execFileSync (no shell) — belt + suspenders,
// mirroring standup-org's assertOrgAlias posture.
const ALIAS_OK = /^[A-Za-z0-9][A-Za-z0-9._@+-]*$/
// An MCP server id: a strict alnum-leading token (Salesforce 15/18-char id shape),
// no injection surface. THROW on a foreign/injection-shaped id.
const MCP_ID_OK = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** A safe, non-empty target-org alias/username. Throws on an injection-shaped value. */
export function assertCaptureAlias(alias) {
  const s = typeof alias === 'string' ? alias : ''
  if (!ALIAS_OK.test(s)) {
    throw new Error(`capture-org-mcp: refusing an unsafe target-org alias '${alias}' — it must be a bare alias/username token (no whitespace, newline, or shell metacharacter)`)
  }
  return s
}

/** A safe MCP server id. Throws on a foreign/injection-shaped id (mirrors assertOrgAlias). */
export function assertMcpServerId(id) {
  const s = typeof id === 'string' ? id : ''
  if (!MCP_ID_OK.test(s)) {
    throw new Error(`capture-org-mcp: refusing an unsafe mcp-server-id '${id}' — it must be a bare alnum-leading id token`)
  }
  return s
}

const pickStr = (v) => (v == null ? null : (typeof v === 'string' ? (v || null) : (typeof v === 'number' ? String(v) : null)))
// A MISSING boolean defaults to null (NOT false) — the PREVIEW CLI's shape is not
// contract-stable; a null says "not observed", a false would ASSERT the negative.
const pickBool = (v) => (v === true ? true : (v === false ? false : (v === 'true' ? true : (v === 'false' ? false : null))))

/** URL HOST ONLY (host:port kept, path/query/token DISCARDED). Unparseable → null, never the raw string. */
export function hostOnly(u) {
  if (!u || typeof u !== 'string') return null
  try { return new URL(u).host || null } catch { return null }
}

/**
 * PURE. The per-server argv, built AFTER `list` resolves the runtime ids (the ids
 * are the only impure input, passed into the executor loop, so the planner stays
 * pure). `alias` is an INPUT (every argv carries `--target-org <alias>`; it is not
 * derivable from (id, verb)). Deterministic given (alias, id, verb); validates both
 * alias and id; FAILS CLOSED on an unknown verb.
 */
export function serverArgv(alias, id, verb) {
  const a = assertCaptureAlias(alias)
  const i = assertMcpServerId(id)
  switch (verb) {
    case 'get': return ['agent', 'mcp', 'get', '--mcp-server-id', i, '--target-org', a, '--json']
    case 'asset list': return ['agent', 'mcp', 'asset', 'list', '--mcp-server-id', i, '--target-org', a, '--json']
    case 'fetch': return ['agent', 'mcp', 'fetch', '--mcp-server-id', i, '--target-org', a, '--json']
    default: throw new Error(`capture-org-mcp: unknown verb '${verb}' (expected 'get' | 'asset list' | 'fetch')`)
  }
}

/**
 * PURE. Compute the deterministic org-MCP capture spec. Deterministic given
 * (target, alias, date, tmpRoot); throws on an unsafe alias, an invalid date, a
 * missing target, or an unsafe tmp root. `tmpRoot` is optional — derived
 * deterministically from (alias, date) when absent so the planner stays pure.
 */
export function planMcpCapture({ target, alias, date, tmpRoot } = {}) {
  const a = assertCaptureAlias(alias) // validates the alias
  if (!target) throw new Error('planMcpCapture: target repo required')
  if (!DATE_OK.test(String(date || ''))) throw new Error(`planMcpCapture: invalid date '${date}' (need YYYY-MM-DD)`)
  const tmp = tmpRoot || join(tmpdir(), ORG_MCP_TMP_PREFIX, `${a}-${date}`)
  assertSafeTmpRoot(tmp)
  const evidenceDir = join(target, '.security-review', 'evidence')
  return {
    schema: ORG_MCP_SCHEMA, alias: a, date,
    // The deterministic list argv — WITHOUT `--status` so DISCONNECTED / admin-
    // registered servers are enumerated too; each server's status is recorded, never
    // filtered on.
    listArgv: ['agent', 'mcp', 'list', '--type', 'EXTERNAL', '--json', '--target-org', a],
    evidenceDir,
    evidencePath: join(evidenceDir, `mcp-org-effective-${date}.json`),
    provenancePath: join(evidenceDir, `mcp-org-effective-${date}.provenance.json`),
    tmpRoot: tmp,
    manifestPath: join(tmp, 'org-mcp-manifest.json'),
    pointerRel: join('.security-review', 'org-mcp-capture.json'),
  }
}

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: sfEnv() })

/** Tolerant extraction of the server array from a preview-shaped `list --json` body. */
function extractServers(j) {
  const r = j && j.result != null ? j.result : j
  if (Array.isArray(r)) return r
  if (r && typeof r === 'object') {
    for (const k of ['mcpServers', 'servers', 'records', 'items']) if (Array.isArray(r[k])) return r[k]
  }
  return []
}

/** Tolerant extraction of the asset array from a preview-shaped `asset list`/`fetch --json` body. */
function extractAssets(j) {
  const r = j && j.result != null ? j.result : j
  if (Array.isArray(r)) return r
  if (r && typeof r === 'object') {
    for (const k of ['assets', 'records', 'items', 'tools']) if (Array.isArray(r[k])) return r[k]
  }
  return []
}

/** STRICT allowlist per asset — NAMES/kind/activation only, never a spread. Missing booleans → null. */
function pickAsset(a) {
  const o = a && typeof a === 'object' ? a : {}
  return {
    name: pickStr(o.name ?? o.Name ?? o.label ?? o.Label),
    // kind is recorded VERBATIM (MCP_TOOL | MCP_PROMPT | MCP_RESOURCE) — consumers
    // bucket on it; a preview shape we don't recognize is recorded, never dropped.
    kind: pickStr(o.kind ?? o.Kind ?? o.type ?? o.Type ?? o.assetType),
    active: pickBool(o.active ?? o.Active ?? o.isActive ?? o.IsActive),
    isAgentAction: pickBool(o['is-agent-action'] ?? o.isAgentAction ?? o.IsAgentAction ?? o.agentAction),
  }
}

/**
 * STRICT allowlist per server — assembled FIELD-BY-FIELD from named values, NEVER
 * spread. The `get` body may carry a serverUrl token / authFields; only the URL HOST
 * survives. `list` is the primary source; `get` fills gaps.
 */
function buildServerEntry(listServer, getBody, assetsBody) {
  const ls = listServer && typeof listServer === 'object' ? listServer : {}
  const grr = getBody && getBody.result != null ? getBody.result : getBody
  const g = grr && typeof grr === 'object' && !Array.isArray(grr) ? grr : {}
  const serverUrlRaw = pickStr(g.serverUrl) ?? pickStr(g.serverURL) ?? pickStr(ls.serverUrl) ?? pickStr(ls.serverURL)
  return {
    id: pickStr(ls.id ?? ls.mcpServerId ?? ls.Id ?? g.id ?? g.mcpServerId),
    label: pickStr(ls.label ?? ls.Label ?? ls.name ?? ls.Name ?? g.label ?? g.name),
    type: pickStr(ls.type ?? ls.Type ?? g.type ?? g.Type),
    status: pickStr(ls.status ?? ls.Status ?? g.status ?? g.Status),
    serverUrlHost: hostOnly(serverUrlRaw), // HOST ONLY — token/query/path discarded
    assets: extractAssets(assetsBody).map(pickAsset),
  }
}

/** A NAMES-ONLY advertised-now vs catalog-ingested delta — never the raw fetch body. */
function buildFetchDelta(catalogAssets, fetchBody) {
  const advertised = extractAssets(fetchBody).map((a) => pickStr((a && typeof a === 'object' ? a : {}).name ?? (a && a.Name))).filter(Boolean)
  const catalog = (catalogAssets || []).map((a) => a && a.name).filter(Boolean)
  const advSet = new Set(advertised), catSet = new Set(catalog)
  return {
    note: 'advertised-now (live fetch) vs catalog-ingested — names only; the raw fetch body is never persisted',
    advertisedCount: advertised.length,
    catalogCount: catalog.length,
    onlyAdvertised: advertised.filter((n) => !catSet.has(n)),
    onlyCatalog: catalog.filter((n) => !advSet.has(n)),
  }
}

/**
 * PURE. The provenance sidecar. ORG-EFFECTIVE counts only: `{ servers,
 * activeAgentActions, registeredAssets }`. `activeAgentActions` (A) CORROBORATES the
 * code-registry N (the source of truth); the N-vs-A reconciliation lives in
 * generate-artifacts step 4 — this envelope does NOT restate N. `org` is names-only;
 * `orgId` is read from the standup manifest (or null). prodEquivalence stays PENDING.
 */
export function buildProvenance(plan, rec) {
  const servers = Array.isArray(rec.servers) ? rec.servers : []
  let registeredAssets = 0, activeAgentActions = 0
  for (const s of servers) for (const a of (Array.isArray(s.assets) ? s.assets : [])) {
    registeredAssets++
    if (a.active === true && a.isAgentAction === true) activeAgentActions++
  }
  return {
    schema: plan.schema,
    artifact: 'artifact-exposed-tools-list',
    source: 'org-effective-agentforce-api-catalog',
    org: { alias: plan.alias, orgId: rec.orgId ?? null }, // names-only
    prodEquivalence: 'PENDING', // owner attestation — captured from the throwaway audit org, NOT the customer's production org
    secrets: 'sf --json output was field-allowlisted; no server URL token, session id, or auth material persisted',
    capturedAt: rec.capturedAt ?? null,
    status: rec.status,
    counts: { servers: servers.length, activeAgentActions, registeredAssets },
    reconciliation: 'org-effective A (activeAgentActions) CORROBORATES the code-registry count N (the source of truth); it NEVER SUBSTITUTES it. The N-vs-A reconciliation is stated in generate-artifacts step 4 — this org-effective provenance does not restate N.',
  }
}

/**
 * Write the strict-allowlist manifest, the gitignored `.security-review` pointer,
 * and (when we captured, not on a dry-run plan) the two evidence files. Mirrors
 * standup-org's writeOrgManifest: mkdir 0o700 tmp grouping, field-by-field manifest,
 * NAMES/IDS only. A `null` target (dry-run) writes ONLY the tmp manifest.
 */
function writeMcpManifest(plan, rec, target) {
  mkdirSync(plan.tmpRoot, { recursive: true, mode: 0o700 })
  const servers = Array.isArray(rec.servers) ? rec.servers : []
  const manifest = {
    schema: plan.schema, alias: plan.alias, date: plan.date,
    status: rec.status,
    orgId: rec.orgId ?? null,
    capturedAt: rec.capturedAt ?? null,
    fetch: rec.fetch === true,
    serverCount: servers.length,
    evidencePath: plan.evidencePath, provenancePath: plan.provenancePath,
    tmpRoot: plan.tmpRoot, target: target || null,
    reason: rec.reason || null,
  }
  writeFileSync(plan.manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  if (target) {
    try {
      const dir = join(target, '.security-review'); mkdirSync(dir, { recursive: true })
      writeFileSync(join(target, plan.pointerRel), JSON.stringify({
        schema: plan.schema, alias: plan.alias, date: plan.date,
        manifestPath: plan.manifestPath, status: rec.status, capturedAt: rec.capturedAt ?? null,
      }, null, 2) + '\n')
    } catch { /* pointer is best-effort */ }
  }
  // Evidence files: only when we actually captured (never on a dry-run plan, and
  // only when the org yielded servers — an empty catalog stays code+protocol-derived).
  if (target && rec.status === 'captured') {
    try {
      mkdirSync(plan.evidenceDir, { recursive: true })
      writeFileSync(plan.evidencePath, JSON.stringify({
        schema: plan.schema, artifact: 'artifact-exposed-tools-list',
        source: 'org-effective-agentforce-api-catalog',
        alias: plan.alias, capturedAt: rec.capturedAt ?? null, status: rec.status,
        servers,
      }, null, 2) + '\n')
      writeFileSync(plan.provenancePath, JSON.stringify(buildProvenance(plan, rec), null, 2) + '\n')
    } catch { /* evidence write is best-effort; the manifest already records intent */ }
  }
  return { ...manifest, servers, fetchRan: rec.fetch === true }
}

/**
 * IMPURE executor. Reads the org MCP catalog. FAILS CLOSED without consent — thrown
 * BEFORE any `sf` call. Empty list → status 'no-mcp-servers' (honest, no fabricated
 * tools; the exposed-tools artifact stays code+protocol-derived). `sf` unavailable /
 * list error → 'list-failed'. opts: { consent, target, fetch, orgId, capturedAt }
 */
export function captureOrgMcp(plan, { consent = false, target, fetch = false, orgId = null, capturedAt } = {}) {
  assertSafeTmpRoot(plan.tmpRoot)
  assertCaptureAlias(plan.alias)
  if (consent !== true) {
    throw new Error("capture-org-mcp: refusing to read the org MCP catalog without explicit consent (a live, org-touching op under the sf-deep-audit-ops gate). Pass --consent with the recorded consent.")
  }
  const stamp = capturedAt || new Date().toISOString()

  // 1. list (no --status) — enumerate ACTIVE and DISCONNECTED alike.
  let listOut
  try { listOut = run('sf', plan.listArgv) }
  catch {
    return writeMcpManifest(plan, {
      status: 'list-failed', servers: [], orgId, capturedAt: stamp, fetch,
      reason: '`sf agent mcp list` failed (the Salesforce CLI / plugin-agent may be absent or the org unreachable) — nothing captured; the exposed-tools artifact stays code+protocol-derived',
    }, target)
  }
  let servers = []
  try { servers = extractServers(parseSfJson(listOut)) } catch { servers = [] }

  // 3. Empty list → degrade honestly. No fabricated tools.
  if (!servers.length) {
    return writeMcpManifest(plan, {
      status: 'no-mcp-servers', servers: [], orgId, capturedAt: stamp, fetch,
      reason: 'the org API-Catalog lists no EXTERNAL MCP servers — nothing to capture; the exposed-tools artifact stays code+protocol-derived',
    }, target)
  }

  // 4. Per server: get + asset list (+ fetch ONLY when fetch === true). Strict
  //    field-allowlist assembly; a missing/non-conforming id skips per-server queries.
  const outServers = []
  for (const ls of (servers || [])) {
    const rawId = pickStr((ls && typeof ls === 'object' ? ls : {}).id ?? (ls && ls.mcpServerId) ?? (ls && ls.Id))
    if (!rawId || !MCP_ID_OK.test(rawId)) {
      const lo = ls && typeof ls === 'object' ? ls : {}
      outServers.push({
        id: rawId || null,
        label: pickStr(lo.label ?? lo.Label ?? lo.name),
        type: pickStr(lo.type ?? lo.Type),
        status: pickStr(lo.status ?? lo.Status),
        serverUrlHost: hostOnly(pickStr(lo.serverUrl) ?? pickStr(lo.serverURL)),
        assets: [],
        note: 'skipped per-server queries: the server id is missing or non-conforming',
      })
      continue
    }
    let getBody = null, assetsBody = null
    try { getBody = parseSfJson(run('sf', serverArgv(plan.alias, rawId, 'get'))) } catch { /* preview shape / unreachable — record what we have */ }
    try { assetsBody = parseSfJson(run('sf', serverArgv(plan.alias, rawId, 'asset list'))) } catch { /* ditto */ }
    const entry = buildServerEntry(ls, getBody, assetsBody)
    if (fetch === true) {
      let fetchBody = null
      try { fetchBody = parseSfJson(run('sf', serverArgv(plan.alias, rawId, 'fetch'))) } catch { /* live callout may fail; record a names-only delta from what we got */ }
      entry.fetchDelta = buildFetchDelta(entry.assets, fetchBody)
    }
    outServers.push(entry)
  }

  return writeMcpManifest(plan, { status: 'captured', servers: outServers, orgId, capturedAt: stamp, fetch }, target)
}

/** Read the standup pointer standup-org wrote (carries the --target-org alias). */
function readStandupPointer(target) {
  try { return JSON.parse(readFileSync(join(target, '.security-review', 'org-standup.json'), 'utf8')) }
  catch { return null }
}

/**
 * The pointer carries NO orgId (only { schema, runId, alias, manifestPath, status,
 * createdAt }). Read orgId from the standup MANIFEST via pointer.manifestPath; if
 * absent/unreadable, null.
 */
function readStandupOrgId(pointer) {
  if (!pointer || !pointer.manifestPath) return null
  try { const m = JSON.parse(readFileSync(pointer.manifestPath, 'utf8')); return (m && m.orgId) || null }
  catch { return null }
}

function main() {
  const argv = process.argv
  const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
  const target = arg('--target', process.cwd())
  const date = arg('--date', new Date().toISOString().slice(0, 10))
  const fetch = argv.includes('--fetch')
  const asJson = argv.includes('--json')

  // Resolve the alias (and orgId) from the standup pointer standup-org wrote. No
  // pointer → no org stood up → nothing to capture (honest degrade).
  const pointer = readStandupPointer(target)
  if (!pointer || !pointer.alias) {
    const msg = 'no .security-review/org-standup.json pointer (no throwaway org stood up) — nothing to capture; the exposed-tools artifact stays code+protocol-derived. Run the deployed-package deep audit first (standup-org, under sf-deep-audit-ops consent).'
    process.stdout.write((asJson ? JSON.stringify({ status: 'no-standup', reason: msg }, null, 2) : `## capture-org-mcp — no-standup\n${msg}`) + '\n')
    process.exitCode = 3; return
  }
  const alias = pointer.alias
  const orgId = readStandupOrgId(pointer)

  let plan
  try { plan = planMcpCapture({ target, alias, date }) }
  catch (e) {
    process.stdout.write((asJson ? JSON.stringify({ status: 'invalid', error: String(e.message) }, null, 2) : `## capture-org-mcp — cannot plan: ${e.message}`) + '\n')
    process.exitCode = 3; return
  }

  // --dry-run: the planned manifest ONLY — no `sf` call, no consent needed.
  if (argv.includes('--dry-run')) {
    const m = writeMcpManifest(plan, { status: 'planned', servers: [], orgId, capturedAt: null, fetch }, null)
    process.stdout.write((asJson ? JSON.stringify(m, null, 2) : `## capture-org-mcp — planned (dry-run, no live op)\nalias: ${m.alias}   argv: sf ${plan.listArgv.join(' ')}\nmanifest: ${plan.manifestPath}`) + '\n')
    return
  }

  // --consent alone is insufficient: the recorded affirmative 'sf-deep-audit-ops'
  // consent (the deep audit's gate) is also required — same AND standup-org uses.
  const consentFlag = argv.includes('--consent')
  const consentRecorded = verifyConsent('sf-deep-audit-ops', { target })
  const consent = consentFlag && consentRecorded
  if (!consent) {
    const why = consentFlag && !consentRecorded
      ? "--consent is set but no affirmative consent is recorded for gate 'sf-deep-audit-ops' (the flag alone is not enough). The capture rides on the same recorded consent that stood the org up."
      : consentRecorded
        ? "consent for gate 'sf-deep-audit-ops' is ALREADY recorded — add the --consent flag to THIS command to run it (--consent is required on EVERY live-op invocation, on top of the one-time recorded consent; a recorded token alone never runs it)."
        : 'a live op needs BOTH — record consent first (record-consent.mjs), THEN re-run with --consent on the command.'
    process.stdout.write(`## capture-org-mcp — NOT RUN (no consent)\nWould read the Agentforce API-Catalog for org ${plan.alias} (list: sf ${plan.listArgv.join(' ')}) → ${plan.evidencePath}\n${why}\n`)
    process.exitCode = 3; return
  }

  const m = captureOrgMcp(plan, { consent, target, fetch, orgId })
  if (asJson) { process.stdout.write(JSON.stringify(m, null, 2) + '\n'); if (m.status !== 'captured') process.exitCode = 1; return }
  const L = [`## capture-org-mcp — ${m.status}`]
  if (m.status === 'captured') {
    L.push(`servers: ${m.serverCount}   evidence: ${m.evidencePath}`)
    L.push('org-effective active-agent-action count CORROBORATES the code-registry count (never substitutes it — reconciled in generate-artifacts step 4)')
    L.push('prod-equivalence: PENDING owner attestation (captured from the throwaway audit org, not production)')
  } else {
    L.push(m.reason || '')
    L.push('the exposed-tools artifact stays code+protocol-derived (unchanged, honest fallback)')
  }
  process.stdout.write(L.join('\n') + '\n')
  if (m.status !== 'captured') process.exitCode = 1
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) }
  catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

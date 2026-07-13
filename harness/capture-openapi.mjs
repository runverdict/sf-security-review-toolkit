#!/usr/bin/env node
/*
 * capture-openapi.mjs — capture the framework's own OpenAPI/endpoint spec from the
 * container-isolated throwaway mirror (B2, docs/roadmap-coldrun-hardening.md). While
 * standup-stack has the partner's backend up on 127.0.0.1 (synthetic secrets, loopback-only
 * publish), a benign read-only GET of `/openapi.json` (and the other framework default
 * locations) yields the REAL framework-generated spec — the paths, the schemas, the identity
 * endpoints — without a host-venv install of partner code and without ever touching prod.
 * The api-endpoints artifact upgrades from code-derived to mirror-captured; the ONLY thing
 * that stays PENDING is the prod-equivalence attestation (the spec came from the isolated
 * mirror — only the owner can attest production matches it).
 *
 * MIRROR-ONLY: the capture reads ONLY the disposable throwaway mirror the toolkit itself
 * stood up (`--from-standup`). An explicit `--base-url` is REFUSED outright — a
 * pre-existing/running instance could be a partner's real product holding real
 * credentials and real data, and even a read-only GET of it is a touch the toolkit must
 * never make. The stand-up pointer requirement is the real guard.
 *
 * LOOPBACK-ONLY IS DEFENSE IN DEPTH: `planCapture` shares run-dast's exact URL
 * pre-filter + LOOPBACK host set and REFUSES any non-loopback base URL, and the
 * executor re-asserts the same check on the plan it actually runs. But loopback alone
 * is NOT sufficient (a real instance is also on loopback) — the pointer requirement
 * above is what keeps the capture off anything the toolkit did not build.
 *
 * READ-ONLY: HTTP GET only, short timeout — the capture observes the mirror, it does not
 * exercise it. Nothing is persisted except the VALIDATED spec (re-serialized from its own
 * parse) and the provenance sidecar — raw response bodies/headers are never written, so a
 * synth-token echo can't land on disk.
 *
 * CONSENT: NO NEW GATE — the capture rides the same recorded `throwaway-dast` token that
 * stood the mirror up (the mirror's consent covers reading the mirror), and the executor
 * FAILS CLOSED without consent. `throwaway-dast` is the ONLY DAST consent.
 *
 * Pure `planCapture` + pure `validateSpec` + pure `buildProvenance` + an impure executor.
 * The live GETs are operator-cold-validated (they need a running mirror), like run-dast's
 * ZAP run; the standing tests pin the pure planner/validator/provenance + the skill wiring.
 *
 * USAGE: node capture-openapi.mjs --from-standup --target <repo> --consent [--run-id <id>] [--date YYYY-MM-DD] [--root-path </prefix>] [--json]
 */
import { mkdirSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { URL_OK, LOOPBACK, resolveBaseUrl, readStandupPointer } from './run-dast.mjs'
import { verifyConsent } from './record-consent.mjs'

export const CAPTURE_SCHEMA = 'sf-srt-openapi/1'

/**
 * The common framework spec locations, probed in this FIXED order (deterministic; first
 * valid spec wins). JSON-serving locations only, deliberately: the validator is a
 * dependency-free JSON.parse, and every framework the stand-up recipes cover serves the
 * JSON form (a YAML-only spec comes back `not-exposed` — honest, the code-derived
 * artifact stands).
 */
export const CANDIDATE_SPEC_PATHS = [
  '/openapi.json', // FastAPI/Starlette default — the python recipe's most common shape (index 0, pinned)
  '/api/openapi.json', // mounted-under-/api variants
  '/api/v1/openapi.json', // versioned-prefix / proxied-FastAPI (root_path='/api/v1') variants
  '/docs/openapi.json', // docs-mounted variants
  '/swagger.json', // classic swagger-tools / express swagger integrations
  '/swagger/v1/swagger.json', // ASP.NET Core Swashbuckle default
  '/v3/api-docs', // Spring springdoc default (serves JSON)
  '/api-docs', // swagger-ui-express common mount
  '/v1/openapi.json', // versioned-prefix variants
  '/api-json', // NestJS SwaggerModule default (setup('api'))
  '/docs-json', // NestJS setup('docs') — the common documentation-mount shape
  '/api/docs-json', // NestJS nested setup('api/docs')
]

const DATE_OK = /^\d{4}-\d{2}-\d{2}$/
// A candidate must be a bare rooted path — never a full URL that could re-aim the GET.
const SPEC_PATH_OK = /^\/[A-Za-z0-9._/-]*$/

/** Shared with the planner AND re-asserted by the executor — the one loopback check. */
function assertLoopback(baseUrl, who) {
  let host
  try { host = new URL(baseUrl).hostname } catch { throw new Error(`${who}: unparseable base url '${baseUrl}'`) }
  if (!LOOPBACK.has(host) && !/^127\./.test(host)) {
    throw new Error(`capture-openapi: refusing to capture from a non-loopback host '${host}' — the capture may only read the local throwaway mirror the toolkit stood up, never a remote target. (got ${baseUrl})`)
  }
}

/**
 * PURE. Normalize an optional proxy root-path (FastAPI `root_path='/api/v1'`, etc.) to a
 * single-leading-slash, no-trailing-slash rooted path. FAILS CLOSED: a scheme/colon/full URL
 * (`http://evil` → `/http://evil`) fails SPEC_PATH_OK and THROWS, so the GET can never be
 * re-aimed off the loopback host. Empty/absent → '' (no root-path prefix).
 */
export function normalizeRootPath(rootPath) {
  let rp = String(rootPath == null ? '' : rootPath).trim()
  if (!rp) return ''
  rp = '/' + rp.replace(/^\/+/, '').replace(/\/+$/, '')
  if (!SPEC_PATH_OK.test(rp)) throw new Error(`normalizeRootPath: refusing unsafe root-path '${rootPath}' — must be a bare rooted path`)
  return rp
}

/** PURE. Compute the capture plan. Deterministic given (baseUrl, target, date, rootPath).
 *  ONE source only: the toolkit-built throwaway mirror — the plan carries no source knob,
 *  so a caller cannot select a pre-existing instance. */
export function planCapture(baseUrl, { target, date, rootPath } = {}) {
  if (!URL_OK.test(String(baseUrl || ''))) throw new Error(`planCapture: invalid base url '${baseUrl}'`)
  // HARD: the capture must target the LOOPBACK throwaway mirror only (audit: loopback enforcement).
  assertLoopback(baseUrl, 'planCapture')
  if (!target) throw new Error('planCapture: target repo required')
  if (!DATE_OK.test(String(date || ''))) throw new Error(`planCapture: invalid date '${date}' (need YYYY-MM-DD)`)
  const evidenceDir = join(target, '.security-review', 'evidence')
  // A proxy root-path prepends `${rp}/openapi.json` to the front (deduped) — never mutating
  // the exported constant (keeps O9's constant-untouched invariant). Fails closed on a
  // non-rooted-path root (throws above).
  const rp = normalizeRootPath(rootPath)
  const candidatePaths = rp ? [...new Set([`${rp}/openapi.json`, ...CANDIDATE_SPEC_PATHS])] : [...CANDIDATE_SPEC_PATHS]
  return {
    schema: CAPTURE_SCHEMA, baseUrl, date,
    candidatePaths,
    evidenceDir,
    evidencePath: join(evidenceDir, `openapi-${date}.json`),
    provenancePath: join(evidenceDir, `openapi-${date}.provenance.json`),
  }
}

/**
 * PURE. Is this response body a real OpenAPI/Swagger spec? Valid ⇔ parses as JSON AND
 * carries a top-level `openapi` (3.x) or `swagger` (2.0) version key AND a `paths` object.
 * An HTML error page, a 404 body, or `{}` is invalid — this is what stops a hardened
 * always-200 endpoint from being mistaken for a spec.
 */
export function validateSpec(body) {
  let doc
  try { doc = JSON.parse(String(body)) } catch { return { valid: false, reason: 'not JSON' } }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { valid: false, reason: 'not a JSON object' }
  const kind = typeof doc.openapi === 'string' ? 'openapi' : (typeof doc.swagger === 'string' ? 'swagger' : null)
  if (!kind) return { valid: false, reason: 'no top-level openapi/swagger version key' }
  const version = kind === 'openapi' ? doc.openapi : doc.swagger
  if (kind === 'openapi' && !/^3\./.test(version)) return { valid: false, reason: `unrecognized openapi version '${version}'` }
  if (kind === 'swagger' && version !== '2.0') return { valid: false, reason: `unrecognized swagger version '${version}'` }
  if (!doc.paths || typeof doc.paths !== 'object' || Array.isArray(doc.paths)) return { valid: false, reason: 'no paths object' }
  return { valid: true, kind, version, pathCount: Object.keys(doc.paths).length }
}

/**
 * PURE. The provenance sidecar: says exactly where the spec came from — the ONE source,
 * the container-isolated throwaway mirror the toolkit stood up — and keeps
 * prod-equivalence PENDING owner attestation, never asserted (the mirror is not
 * production).
 */
export function buildProvenance(plan, { capturedFrom, kind, version, pathCount, runId } = {}) {
  return {
    schema: plan.schema,
    artifact: 'artifact-api-endpoints-spec',
    source: 'container-isolated-throwaway-mirror',
    baseUrl: plan.baseUrl,
    capturedFrom,
    capturedAt: plan.date,
    runId: runId || null,
    spec: { kind, version, pathCount },
    secrets: 'The mirror ran on synthetic secrets the toolkit generated at stand-up — no production credential was present in the container, and the spec body is public API shape only.',
    // capture-only honesty: the spec was READ, not SCANNED. Closes the adjacency over-claim
    // where an openapi-*.json sitting beside a zap-throwaway-local-*.json implies the DAST
    // exercised those endpoints — it does not (the baseline is an unauthenticated spider from /).
    scanCoverage: 'CAPTURE-ONLY. This spec was read for the api-endpoints artifact; the throwaway DAST is an unauthenticated loopback spider that does NOT consume it, so these endpoints were not necessarily exercised. Authenticated / prod-equivalent endpoint testing remains owner-run.',
    singleSpec: 'first-match single-spec capture — a gateway/multi-service partner may expose additional specs not enumerated here.',
    prodEquivalence: 'PENDING owner attestation — this spec was captured from the container-isolated throwaway mirror the toolkit stood up, NOT from production. Only the owner can attest that production serves an equivalent spec.',
  }
}

/**
 * IMPURE executor. GETs each candidate path (read-only, short timeout) and, on the FIRST
 * valid spec, writes the spec + provenance sidecar into the project evidence dir. No valid
 * spec → `not-exposed` (the caller keeps the code-derived artifact — honest, no
 * fabrication). FAILS CLOSED without consent.
 */
export function captureOpenapi(plan, { consent = false, runId = null, timeoutSec = 5 } = {}) {
  if (consent !== true) {
    throw new Error('capture-openapi: refusing to read a stood-up mirror without explicit consent (part of the throwaway-dast live op). Pass --consent.')
  }
  // Belt-and-suspenders: re-assert the planner's loopback invariant on the plan actually
  // executed — a hand-built plan must not smuggle a remote URL past the pure guard.
  assertLoopback(plan.baseUrl, 'captureOpenapi')
  const base = String(plan.baseUrl).replace(/\/+$/, '')
  const tried = []
  for (const path of plan.candidatePaths || []) {
    if (!SPEC_PATH_OK.test(String(path))) { tried.push({ path, reason: 'refused: not a bare rooted path' }); continue }
    let body
    try {
      // curl -sf: GET only; -f turns an HTTP >=400 into a skip. stderr is discarded and the
      // raw body lives only in memory — nothing unvalidated is ever persisted.
      body = execFileSync('curl', ['-sf', '--max-time', String(timeoutSec), base + path],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
    } catch { tried.push({ path, reason: 'unreachable or HTTP error' }); continue }
    const v = validateSpec(body)
    if (!v.valid) { tried.push({ path, reason: v.reason }); continue }
    mkdirSync(plan.evidenceDir, { recursive: true })
    // Persist the VALIDATED spec re-serialized from its own parse — normalized JSON, never
    // the raw response bytes.
    writeFileSync(plan.evidencePath, JSON.stringify(JSON.parse(body), null, 2) + '\n')
    writeFileSync(plan.provenancePath, JSON.stringify(
      buildProvenance(plan, { capturedFrom: path, kind: v.kind, version: v.version, pathCount: v.pathCount, runId }), null, 2) + '\n')
    return {
      status: 'captured', evidencePath: plan.evidencePath, provenancePath: plan.provenancePath,
      capturedFrom: path, kind: v.kind, version: v.version, pathCount: v.pathCount,
    }
  }
  return { status: 'not-exposed', reason: `no candidate path served a valid OpenAPI/Swagger JSON spec (tried ${(plan.candidatePaths || []).length})`, tried }
}

function main() {
  const argv = process.argv
  const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
  let baseUrl = arg('--base-url', null)
  const target = arg('--target', process.cwd())
  const runId = arg('--run-id', null)
  const date = arg('--date', new Date().toISOString().slice(0, 10))
  const rootPath = arg('--root-path', null) // optional proxy root_path (e.g. /api/v1); fails closed if unsafe

  // MIRROR-ONLY REFUSAL: an explicit --base-url is retired, unconditionally. A pre-existing/
  // running instance could be a partner's real product holding real credentials and real
  // data — even a read-only GET of it is a touch the toolkit must never make, and no
  // recorded consent unlocks this path (the refusal fires BEFORE any consent is looked up).
  if (baseUrl) {
    process.stdout.write('## capture-openapi — REFUSED: capture-openapi reads ONLY the disposable mirror the toolkit built (`--from-standup`); it will NEVER read a pre-existing `--base-url` instance — that could be a partner\'s real product/data. Stand up the mirror, or the api-endpoints artifact stays code-derived.\n')
    process.exitCode = 3; return
  }
  if (!argv.includes('--from-standup')) {
    process.stdout.write('## capture-openapi — nothing to read: pass --from-standup (the stand-up pointer to the disposable mirror the toolkit built). capture-openapi never reads a pre-existing instance; without a stood-up mirror, the api-endpoints artifact stays code-derived.\n')
    process.exitCode = 3; return
  }

  // --from-standup (Slice D): reuse run-dast's ONE resolver — it re-asserts loopback + the
  // scannable-status gate; the staleness guard catches a swept manifest. The capture is
  // DB-independent, so it still runs on an `unhealthy` mirror.
  {
    const pointer = readStandupPointer(target)
    let resolved
    try { resolved = resolveBaseUrl(null, pointer) }
    catch (e) { process.stdout.write(`## capture-openapi — ${e.message}\n`); process.exitCode = 3; return }
    if (pointer && pointer.manifestPath && !existsSync(pointer.manifestPath)) {
      process.stdout.write(`## capture-openapi — the stand-up pointer references a manifest that no longer exists (${pointer.manifestPath}) — the throwaway is gone; stand up again\n`); process.exitCode = 3; return
    }
    baseUrl = resolved.baseUrl
  }
  // --consent alone is insufficient: the recorded 'throwaway-dast' consent — the SAME token
  // that stood the mirror up (no new gate), and the ONLY DAST consent — is also required.
  const consentFlag = argv.includes('--consent')
  const consentGate = 'throwaway-dast'
  const consentRecorded = verifyConsent(consentGate, { target })
  const consent = consentFlag && consentRecorded
  const asJson = argv.includes('--json')

  let plan
  try { plan = planCapture(baseUrl, { target, date, rootPath }) }
  catch (e) { process.stdout.write(`## capture-openapi — ${e.message}\n`); process.exitCode = 3; return }
  if (!consent) {
    const why = consentFlag && !consentRecorded
      ? `--consent is set but no affirmative consent is recorded for gate '${consentGate}' (the flag alone is not enough). The capture rides on the same recorded consent that stood the mirror up.`
      : `re-run with --consent (and the recorded ${consentGate} consent).`
    process.stdout.write(`## capture-openapi — NOT RUN (no consent)\nWould GET the framework spec from ${plan.baseUrl} (candidates: ${plan.candidatePaths.join(', ')}) → ${plan.evidencePath}\n${why}\n`)
    process.exitCode = 3; return
  }

  const r = captureOpenapi(plan, { consent, runId })
  if (asJson) { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); if (r.status !== 'captured') process.exitCode = 1; return }
  const L = [`## capture-openapi — ${r.status}`]
  if (r.status === 'captured') {
    L.push(`evidence: ${r.evidencePath}`)
    L.push(`spec: ${r.kind} ${r.version} · ${r.pathCount} paths (from ${r.capturedFrom})`)
    L.push('coverage: CAPTURE-ONLY — the throwaway DAST does NOT consume this spec; these endpoints were not necessarily exercised (authenticated endpoint testing remains owner-run)')
    L.push('prod-equivalence: PENDING owner attestation (captured from the isolated mirror, not production)')
  } else {
    L.push(r.reason)
    L.push('the api-endpoints artifact stays code-derived (unchanged, honest fallback)')
  }
  process.stdout.write(L.join('\n') + '\n')
  if (r.status !== 'captured') process.exitCode = 1
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) }
  catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

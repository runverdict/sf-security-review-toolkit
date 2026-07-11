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
 * RUNG-1 FALLBACK (fires-path ladder, mirrors run-dast): when the throwaway mirror never
 * stood up, an explicit `--base-url` pointed at an ALREADY-RUNNING loopback instance the
 * operator started captures the same spec with ZERO build and ZERO stand-up — the same
 * read-only GET, the same loopback-only invariant, a source-matched consent gate (see
 * below), and provenance that names the live instance instead of the mirror.
 *
 * LOOPBACK-ONLY IS THE HARD SECURITY INVARIANT: `planCapture` shares run-dast's exact
 * URL pre-filter + LOOPBACK host set and REFUSES any non-loopback base URL, and the
 * executor re-asserts the same check on the plan it actually runs — the capture may only
 * ever read a loopback instance (the local throwaway the toolkit built, or the operator's
 * own already-running local app), never prod, a remote host, or Salesforce infra.
 *
 * READ-ONLY: HTTP GET only, short timeout — the capture observes the mirror, it does not
 * exercise it. Nothing is persisted except the VALIDATED spec (re-serialized from its own
 * parse) and the provenance sidecar — raw response bodies/headers are never written, so a
 * synth-token echo can't land on disk.
 *
 * CONSENT IS SOURCE-SELECTED, NO NEW GATE (exactly run-dast's rung-1 pattern): the spec's
 * source picks which RECORDED live-op consent authorizes the read. A toolkit-built mirror
 * (`--from-standup`, source 'standup') rides the same recorded `throwaway-dast` token that
 * stood it up; an ALREADY-RUNNING loopback instance the operator started (explicit
 * `--base-url`, source 'explicit') rides the recorded `live-instance-dast` token instead —
 * there is no mirror on that path and the instance holds the operator's own (possibly
 * real) credentials, so the throwaway's consent must never stand in for it. Both gates
 * already exist in gate-spec; the CLI verifies the source-matched token the way run-dast
 * selects its gate, and the executor FAILS CLOSED without consent.
 *
 * Pure `planCapture` + pure `validateSpec` + pure `buildProvenance` + an impure executor.
 * The live GETs are operator-cold-validated (they need a running mirror), like run-dast's
 * ZAP run; the standing tests pin the pure planner/validator/provenance + the skill wiring.
 *
 * USAGE: node capture-openapi.mjs --base-url <url> --target <repo> --consent [--run-id <id>] [--date YYYY-MM-DD] [--json]
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
    throw new Error(`capture-openapi: refusing to capture from a non-loopback host '${host}' — the capture may only read a loopback instance (the local throwaway mirror, or an already-running local app via an explicit --base-url), never a remote target. (got ${baseUrl})`)
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

/** PURE. Compute the capture plan. Deterministic given (baseUrl, target, date, rootPath,
 *  source). `source` is 'explicit' (rung 1: an already-running loopback instance the operator
 *  started) or anything else → 'standup' (the toolkit-built throwaway mirror) — the default
 *  keeps every pre-rung-1 caller's plan and provenance unchanged. */
export function planCapture(baseUrl, { target, date, rootPath, source } = {}) {
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
    source: source === 'explicit' ? 'explicit' : 'standup',
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
 * PURE. The provenance sidecar: says exactly where the spec came from — SOURCE-CONDITIONAL
 * (plan.source 'explicit' → an already-running loopback instance the operator started; a
 * rung-1 capture has no container-isolated mirror and no toolkit-generated synthetic-secret
 * set, so the envelope must claim neither; the standup branch stays byte-identical to the
 * pre-rung-1 envelope) — and keeps prod-equivalence PENDING owner attestation on BOTH
 * branches, never asserted (a local dev instance is still not production).
 */
export function buildProvenance(plan, { capturedFrom, kind, version, pathCount, runId } = {}) {
  const explicit = plan.source === 'explicit'
  return {
    schema: plan.schema,
    artifact: 'artifact-api-endpoints-spec',
    source: explicit ? 'already-running-loopback-instance' : 'container-isolated-throwaway-mirror',
    baseUrl: plan.baseUrl,
    capturedFrom,
    capturedAt: plan.date,
    runId: runId || null,
    spec: { kind, version, pathCount },
    secrets: explicit
      ? "The spec was read from an already-running loopback instance the operator started — NOT a toolkit-built mirror, so the toolkit makes no claim about the credentials that instance holds (they are the operator's own, and may be real). The spec body is public API shape only; nothing beyond the validated spec is persisted."
      : 'The mirror ran on synthetic secrets the toolkit generated at stand-up — no production credential was present in the container, and the spec body is public API shape only.',
    // capture-only honesty: the spec was READ, not SCANNED. Closes the adjacency over-claim
    // where an openapi-*.json sitting beside a zap-throwaway-local-*.json implies the DAST
    // exercised those endpoints — it does not (the baseline is an unauthenticated spider from /).
    scanCoverage: 'CAPTURE-ONLY. This spec was read for the api-endpoints artifact; the throwaway DAST is an unauthenticated loopback spider that does NOT consume it, so these endpoints were not necessarily exercised. Authenticated / prod-equivalent endpoint testing remains owner-run.',
    singleSpec: 'first-match single-spec capture — a gateway/multi-service partner may expose additional specs not enumerated here.',
    prodEquivalence: explicit
      ? 'PENDING owner attestation — this spec was captured from an already-running loopback instance the operator started, NOT from production. Only the owner can attest that production serves an equivalent spec.'
      : 'PENDING owner attestation — this spec was captured from the container-isolated throwaway mirror the toolkit stood up, NOT from production. Only the owner can attest that production serves an equivalent spec.',
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
    // Name the SOURCE-matched gate (run-dast's rung-1 pattern): an explicit already-running
    // instance is authorized by live-instance-dast, the stood-up mirror by throwaway-dast.
    const gate = plan && plan.source === 'explicit' ? 'live-instance-dast' : 'throwaway-dast'
    const what = plan && plan.source === 'explicit' ? 'an already-running instance' : 'a stood-up mirror'
    throw new Error(`capture-openapi: refusing to read ${what} without explicit consent (part of the ${gate} live op). Pass --consent.`)
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

  // The capture SOURCE selects which recorded live-op consent authorizes this read — run-dast's
  // ONE resolveBaseUrl is the single arbiter of `source`, exactly as in run-dast's main(). An
  // explicit --base-url is an ALREADY-RUNNING loopback instance the operator started (source
  // 'explicit' → the live-instance-dast gate — the rung-1 fallback when the throwaway mirror
  // never stood up); the --from-standup pointer below stays the disposable mirror (source
  // 'standup' → throwaway-dast). Resolving the explicit URL HERE re-asserts loopback BEFORE
  // any consent is even looked up.
  let captureSource = null
  if (baseUrl) {
    try { captureSource = resolveBaseUrl(baseUrl, null).source } // 'explicit'
    catch (e) {
      // The shared resolver refused (invalid / non-loopback). Route the refusal through
      // planCapture — same shared URL_OK + LOOPBACK — so it names the capture-native
      // invariant; keep the resolver's message if the planner (unexpectedly) accepts.
      // FAIL CLOSED either way: no source, no consent lookup, no GET.
      let msg = String(e.message)
      try { planCapture(baseUrl, { target, date, rootPath }) } catch (pe) { msg = String(pe.message) }
      process.stdout.write(`## capture-openapi — ${msg}\n`); process.exitCode = 3; return
    }
  }

  // --from-standup (Slice D): reuse run-dast's ONE resolver — explicit --base-url still wins;
  // the resolver re-asserts loopback + the scannable-status gate; staleness guard catches a
  // swept manifest. The capture is DB-independent, so it still runs on an `unhealthy` mirror.
  if (argv.includes('--from-standup') && !baseUrl) {
    const pointer = readStandupPointer(target)
    let resolved
    try { resolved = resolveBaseUrl(null, pointer) }
    catch (e) { process.stdout.write(`## capture-openapi — ${e.message}\n`); process.exitCode = 3; return }
    if (pointer && pointer.manifestPath && !existsSync(pointer.manifestPath)) {
      process.stdout.write(`## capture-openapi — the stand-up pointer references a manifest that no longer exists (${pointer.manifestPath}) — the throwaway is gone; stand up again\n`); process.exitCode = 3; return
    }
    baseUrl = resolved.baseUrl
    captureSource = resolved.source // 'standup'
  }
  // --consent alone is insufficient: the recorded live-op consent for THIS capture's source is
  // also required, selected exactly the way run-dast selects its gate. Source 'explicit'
  // verifies 'live-instance-dast' (the read hits the operator's OWN running instance — the
  // throwaway's token never stands in for it); source 'standup' verifies the SAME recorded
  // 'throwaway-dast' consent that stood the mirror up (no new gate).
  const consentFlag = argv.includes('--consent')
  const consentGate = captureSource === 'explicit' ? 'live-instance-dast' : 'throwaway-dast'
  const consentRecorded = verifyConsent(consentGate, { target })
  const consent = consentFlag && consentRecorded
  const asJson = argv.includes('--json')

  let plan
  try { plan = planCapture(baseUrl, { target, date, rootPath, source: captureSource }) }
  catch (e) { process.stdout.write(`## capture-openapi — ${e.message}\n`); process.exitCode = 3; return }
  if (!consent) {
    const why = consentFlag && !consentRecorded
      ? `--consent is set but no affirmative consent is recorded for gate '${consentGate}' (the flag alone is not enough). ${captureSource === 'explicit'
        ? `An explicit --base-url reads an ALREADY-RUNNING instance you started, so the capture requires the recorded live-instance-dast consent — the throwaway's token never stands in for it.`
        : 'The capture rides on the same recorded consent that stood the mirror up.'}`
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
    L.push(captureSource === 'explicit'
      ? 'prod-equivalence: PENDING owner attestation (captured from your already-running loopback instance, not production)'
      : 'prod-equivalence: PENDING owner attestation (captured from the isolated mirror, not production)')
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

#!/usr/bin/env node
/*
 * run-dast.mjs — the autonomous DAST against a throwaway (0.7.0 slice 5). Runs a
 * digest-pinned ZAP against the URL standup-stack published, writes real evidence to
 * the project, and cleans its own (root-owned) scan working files. The payoff that
 * chains stack-detect → standup-stack → run-dast → teardown-stack into real cold-run
 * DAST output. See docs/roadmap-0.7.0-throwaway-dast-harness.md.
 *
 * INTEGRITY: ZAP is pinned by IMAGE DIGEST (the strongest acquisition path — the
 * registry verifies it cryptographically, and the image bundles the JRE). Validated
 * in the 0.7.0 prototype.
 *
 * ROOT-OWNED FILES: ZAP runs as root in its container and writes the report to a
 * bind-mounted wrk dir as root. So the wrk dir lives in its OWN tmp tree (NOT the
 * stack's), the host-owned copy of the report is what lands in the project evidence
 * dir, and the root-owned wrk is removed via a throwaway root container — so neither
 * the project nor stack-teardown ever has to chase a root-owned file.
 *
 * It FAILS CLOSED without consent (an active scan is a live op). Pure `planDast` +
 * `summarizeZap` + an impure executor. Unauthenticated baseline scan this slice; the
 * authenticated, endpoint-fed AF-plan pass (using a token minted from the throwaway's
 * own synthesized secret) is the depth refinement (slice 5b).
 *
 * USAGE: node run-dast.mjs --base-url <url> --target <repo> --consent [--run-id <id>] [--json]
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { assertSafeTmpRoot } from './install-scanners.mjs'
import { dockerStatus } from './docker-check.mjs'
import { verifyConsent } from './record-consent.mjs'
import { clampLog } from './clamp-log.mjs'

// ZAP pinned by image digest (verified 2026-06-19, the 0.7.0 prototype). Bump = re-pin.
export const ZAP_IMAGE = 'zaproxy/zap-stable'
export const ZAP_DIGEST = 'sha256:7c2f8afc893e4e4000be8ad3fd22013fc36e5cce59359349f5a2d45626e2ccb9'
const RUN_ID_OK = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
// http(s):// + a non-empty authority/path with NO whitespace, control chars, or
// encoding-trick chars (`<>"'\`). The real boundary is the new URL() + LOOPBACK
// host-check below; this is a belt-and-suspenders pre-filter (WI-F.2).
// Exported: capture-openapi.mjs shares this exact pre-filter + LOOPBACK set so the
// throwaway tier has ONE definition of the loopback-only invariant, not two drifting copies.
export const URL_OK = /^https?:\/\/[^\s\x00-\x1f<>"'\\]+$/i

/** Loopback-only hosts — an active DAST may ONLY ever hit a local throwaway. */
export const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0'])

/** Additive 5th loopback layer (Slice D) — REUSES the shared LOOPBACK set; the 4 frozen
 *  layers are untouched. A resolved/pointer URL must be loopback or it is refused. */
function assertLoopbackHost(baseUrl, who = 'resolveBaseUrl') {
  let host
  try { host = new URL(baseUrl).hostname } catch { throw new Error(`${who}: unparseable base url '${baseUrl}'`) }
  if (!LOOPBACK.has(host) && !/^127\./.test(host)) throw new Error(`${who}: refusing a non-loopback target '${host}' — the DAST may only hit a local throwaway`)
}

/** IMPURE. Read the gitignored stand-up pointer (the ONLY fs read — kept out of the pure
 *  resolver so it stays hermetic). Returns the parsed pointer or null. */
export function readStandupPointer(target) {
  try { return JSON.parse(readFileSync(join(target, '.security-review', 'stack-standup.json'), 'utf8')) } catch { return null }
}

/**
 * PURE. Resolve the scan base URL. Explicit `--base-url` ALWAYS wins (source 'explicit');
 * otherwise the stand-up pointer must be `sf-srt-stack/1`, not torn-down (teardown nulls the
 * baseUrl + sets status 'torn-down'), and `up`/`unhealthy` (the SCANNABLE gate — `unhealthy`
 * is reachable-but-degraded, Slice G's label covers it). Every URL — explicit or pointer — is
 * re-asserted loopback, so a tampered pointer can never smuggle a non-loopback target.
 *
 * FIRES-PATH LADDER rung 1 (0.8.109): explicit `--base-url` winning IS the "scan an
 * already-running loopback instance" primitive — point it at a live 127.0.0.1:<port> and DAST
 * fires with ZERO build and ZERO stand-up, independent of app size. It wins even over a
 * torn-down pointer (the early return never consults the pointer's status), so a running app
 * is always the cheapest rung. run-scans surfaces this as the ladder's first-class first option.
 */
export function resolveBaseUrl(explicitBaseUrl, pointer) {
  if (explicitBaseUrl) {
    if (!URL_OK.test(String(explicitBaseUrl))) throw new Error(`resolveBaseUrl: invalid base url '${explicitBaseUrl}'`)
    assertLoopbackHost(explicitBaseUrl)
    return { baseUrl: explicitBaseUrl, source: 'explicit', runId: (pointer && pointer.runId) || null, status: (pointer && pointer.status) || null }
  }
  if (!pointer || typeof pointer !== 'object') throw new Error('resolveBaseUrl: no --base-url and no stand-up pointer — stand up first, or pass --base-url')
  if (pointer.schema !== 'sf-srt-stack/1') throw new Error(`resolveBaseUrl: refusing a foreign pointer schema '${pointer.schema}'`)
  if (pointer.status === 'torn-down' || pointer.baseUrl == null) throw new Error('resolveBaseUrl: the stand-up pointer is torn-down (no live throwaway) — stand up again')
  const SCANNABLE = new Set(['up', 'unhealthy'])
  if (!SCANNABLE.has(pointer.status)) throw new Error(`resolveBaseUrl: stand-up status '${pointer.status}' is not scannable (need up/unhealthy)`)
  if (!URL_OK.test(String(pointer.baseUrl))) throw new Error(`resolveBaseUrl: pointer base url '${pointer.baseUrl}' is invalid`)
  assertLoopbackHost(pointer.baseUrl)
  return { baseUrl: pointer.baseUrl, source: 'standup', runId: pointer.runId || null, status: pointer.status }
}

/** PURE. Compute the ZAP scan plan. Deterministic given (baseUrl, target, runId, tmpRoot).
 *  The honesty inputs (health/migration/guarded/service/scoredPort/exposedApiTier — all
 *  optional, from the stand-up manifest) are carried on the plan and consumed by runDast to
 *  degrade the label + stamp the provenance sidecar. */
export function planDast(baseUrl, { target, runId, tmpRoot, health = 'unverified', migration = null, guarded = false, service = null, scoredPort = null, exposedApiTier = [] } = {}) {
  if (!URL_OK.test(String(baseUrl || ''))) throw new Error(`planDast: invalid base url '${baseUrl}'`)
  // HARD: the active scan must target a LOOPBACK throwaway only — never live prod, a remote
  // host, or Salesforce infra. Fail closed on anything else (audit: loopback enforcement).
  let host
  try { host = new URL(baseUrl).hostname } catch { throw new Error(`planDast: unparseable base url '${baseUrl}'`) }
  if (!LOOPBACK.has(host) && !/^127\./.test(host)) {
    throw new Error(`run-dast: refusing to active-scan a non-loopback host '${host}' — the DAST may only hit a local throwaway, never a live/remote target. (got ${baseUrl})`)
  }
  if (!RUN_ID_OK.test(String(runId || ''))) throw new Error(`planDast: invalid run-id '${runId}'`)
  if (!target) throw new Error('planDast: target repo required')
  assertSafeTmpRoot(tmpRoot)
  const image = `${ZAP_IMAGE}@${ZAP_DIGEST}`
  // self-identifying name: this is a LOCAL THROWAWAY scan, not the production-equivalent submission scan.
  const reportName = `zap-throwaway-local-${runId}.json`
  const evidenceDir = join(target, '.security-review', 'evidence', 'dast')
  return {
    schema: 'sf-srt-dast/1', runId, baseUrl, image,
    wrkDir: tmpRoot, reportInWrk: join(tmpRoot, 'report.json'),
    evidenceDir, evidencePath: join(evidenceDir, reportName),
    // ZAP in a container reaches the host-published 127.0.0.1:<port> via --network host.
    dockerArgs: ['run', '--rm', '--network', 'host', '-v', `${tmpRoot}:/zap/wrk:rw`, image,
      'zap-baseline.py', '-t', baseUrl, '-J', 'report.json', '-m', '1'],
    // honesty inputs (Slice G) — consumed by runDast, never affect the scan command itself
    health, migration, guarded: Boolean(guarded), service,
    scoredPort: scoredPort != null ? Number(scoredPort) : null,
    exposedApiTier: Array.isArray(exposedApiTier) ? exposedApiTier : [],
  }
}

/** PURE. Summarize a ZAP JSON report → counts by risk + the top alerts. */
export function summarizeZap(report) {
  const site = (report && Array.isArray(report.site) ? report.site[0] : null) || {}
  const alerts = Array.isArray(site.alerts) ? site.alerts : []
  const byRisk = { High: 0, Medium: 0, Low: 0, Informational: 0 }
  for (const a of alerts) {
    const r = String(a.riskdesc || '').split(' ')[0] // "Medium (High)" → "Medium"
    if (r in byRisk) byRisk[r] += 1
  }
  return {
    target: site['@name'] || null,
    total: alerts.length,
    byRisk,
    top: alerts.slice(0, 15).map((a) => ({ risk: String(a.riskdesc || '').split(' ')[0], alert: a.alert, count: Number(a.count) || (a.instances ? a.instances.length : 1) })),
  }
}

export const DAST_PROVENANCE_SCHEMA = 'sf-srt-dast-provenance/1'

/**
 * PURE. The self-labelling README body. Always states the base boundary (loopback,
 * unauthenticated, shallow spider from `/`, corroborating, NOT production-equivalent, and
 * that it did NOT import the captured OpenAPI spec — the spec feeds the api-endpoints
 * ARTIFACT only). Appends a caveat for each non-clean condition; never claims clean/healthy.
 */
export function dastDisclaimer({ health = 'unverified', migration = null, guarded = false, service = null, port = null, exposedApiTier = [] } = {}) {
  const L = [
    '# Throwaway DAST evidence — LOCAL, not production-equivalent',
    '',
    "This is the toolkit's **corroborating** DAST + a de-risking dry run: a digest-pinned ZAP",
    'baseline against a disposable throwaway the toolkit stood up on 127.0.0.1 (loopback only).',
    'It is UNAUTHENTICATED and shallow — a spider from `/`. It is NOT the production-equivalent,',
    "authenticated submission scan (debug off, same hardening, same edge), nor Salesforce's own",
    'penetration test.',
    '',
    'It did NOT import the captured OpenAPI spec — the captured spec feeds the api-endpoints',
    'ARTIFACT only, so this baseline did not necessarily exercise those endpoints.',
  ]
  const caveats = []
  if (health !== 'up') caveats.push(`the throwaway was \`${health}\` at scan time — liveness/header-level only; DB-backed endpoints unverified (may error)`)
  if (migration) caveats.push(`a migration mechanism was DETECTED (\`${migration}\`) but NOT run — the DB schema is unverified`)
  if (guarded) caveats.push('the target answered only auth/method-guarded — unauthenticated coverage is a floor, not a bill of health')
  if (Array.isArray(exposedApiTier) && exposedApiTier.length) {
    caveats.push(`the API tier \`${exposedApiTier.join(', ')}\` is expose-only and was NOT scanned — this baseline covers only the host-published ${service ? `\`${service}\`` : 'web'} tier`)
  }
  if (caveats.length) L.push('', 'CAVEATS (this run):', ...caveats.map((c) => `- ${c}`))
  L.push('', `Scanned tier: ${service || 'n/a'}${port != null ? ` (port ${port})` : ''}. Fidelity is bounded by the repo's run recipe.`)
  return L.join('\n') + '\n'
}

/**
 * PURE. The machine-readable provenance sidecar `compile-submission`/`reviewer-simulation`
 * ingest (they read JSON, never the README). authenticated + specFedScan are HARD false —
 * this baseline is neither authenticated nor spec-fed; prod-equivalence stays PENDING.
 */
export function buildDastProvenance(plan, { health = 'unverified', migration = null, guarded = false, scannedTier = {} } = {}) {
  return {
    schema: DAST_PROVENANCE_SCHEMA,
    artifact: 'artifact-dast-throwaway',
    scanKind: 'unauthenticated-baseline-spider',
    authenticated: false,
    specFedScan: false,
    healthState: health,
    guarded: Boolean(guarded),
    migration: migration || null,
    scannedTier: { port: scannedTier.port != null ? scannedTier.port : null, service: scannedTier.service || null },
    baseUrl: plan.baseUrl,
    runId: plan.runId || null,
    prodEquivalence: 'PENDING owner attestation — throwaway loopback mirror, not production',
    note: 'corroborating only; NOT the production-equivalent authenticated submission scan',
  }
}

/**
 * PURE. The evidence-of-absence stub written for every terminal NOT-scanned state
 * (needs-secrets-declined, needs-recipe, n/a, failed, unknown, non-REST/GraphQL, TLS-only)
 * so a downstream consumer renders "corroboration not attempted: <reason>", never a silent gap.
 */
export function absentCorroborationStub({ reason = 'not attempted', partnerShape = null } = {}) {
  return {
    schema: DAST_PROVENANCE_SCHEMA,
    artifact: 'artifact-dast-throwaway',
    scanKind: 'not-run',
    authenticated: false,
    specFedScan: false,
    reason,
    partnerShape: partnerShape || null,
    honestyBoundary: 'NOT-ATTEMPTED',
    note: 'corroboration not attempted — evidence of absence, not a scan result',
  }
}

/**
 * PURE. Whether this scan must carry a degraded label: a non-`up` stand-up health (or the
 * unverified default — we never claim clean without a verified `up`) OR a scanned port that
 * doesn't match the detected web-tier port (wrong tier). Deterministic given the plan.
 */
export function dastDegrade(plan) {
  let scanPort = ''
  try { scanPort = new URL(plan.baseUrl).port } catch {}
  const wrongTier = plan.scoredPort != null && String(plan.scoredPort) !== String(scanPort)
  const notUp = (plan.health || 'unverified') !== 'up'
  const degraded = notUp || wrongTier
  let degradeReason = null
  if (wrongTier) degradeReason = `scanned port ${scanPort || '(none)'} != detected web-tier port ${plan.scoredPort} — likely the wrong tier`
  else if (notUp) degradeReason = plan.health && plan.health !== 'unverified'
    ? `stand-up health was '${plan.health}' at scan time — the alert counts are not a clean bill of health`
    : 'stand-up health was not verified (no status threaded) — the alert counts are not a clean bill of health'
  return { degraded, degradeReason }
}

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
const quiet = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true } catch { return false } }

/**
 * IMPURE executor. Runs the ZAP scan, copies the report into the project evidence dir
 * (host-owned), summarizes it, and removes the root-owned wrk. FAILS CLOSED w/o consent.
 */
export function runDast(plan, { consent = false } = {}) {
  assertSafeTmpRoot(plan.wrkDir)
  if (consent !== true) throw new Error('run-dast: refusing to run an active scan without explicit consent (a live op). Pass --consent.')
  // Docker runs the digest-pinned ZAP — fail with an honest hint if it's unavailable.
  const dock = dockerStatus()
  if (!dock.runnable) return { status: 'no-docker', baseUrl: plan.baseUrl, image: plan.image, evidencePath: null, summary: null, degraded: true, degradeReason: 'docker unavailable — no scan ran', log: dock.hint }
  // honesty consumption (Slice G): degrade the label when the stand-up was not verified `up`
  // or the scanned port is not the detected web-tier port — never emit a clean-looking count.
  const { degraded, degradeReason } = dastDegrade(plan)
  const rec = { status: 'scanning', baseUrl: plan.baseUrl, image: plan.image, evidencePath: null, summary: null, degraded, degradeReason, log: '' }
  try {
    mkdirSync(plan.wrkDir, { recursive: true, mode: 0o777 }) // ZAP's container user must write here
    mkdirSync(plan.evidenceDir, { recursive: true })
    if (!quiet('docker', ['image', 'inspect', plan.image])) run('docker', ['pull', plan.image]) // pull the pinned digest
    // zap-baseline.py exits non-zero when it FINDS warnings/fails — that's a result, not an error.
    try { rec.log = clampLog(run('docker', plan.dockerArgs), 1500) } catch (e) { rec.log = clampLog(String(e.stdout || e.message || ''), 1500) }
    if (!existsSync(plan.reportInWrk)) { rec.status = 'failed'; rec.log = clampLog(`ZAP produced no report — ${rec.log}`, 1500); return rec }
    copyFileSync(plan.reportInWrk, plan.evidencePath) // root-readable → host-owned copy in the project
    rec.evidencePath = plan.evidencePath
    // self-labelling: the prose README + the machine-readable provenance sidecar (the field
    // compile-submission/reviewer-simulation ingest — they cannot read a README). Both encode
    // the same degraded/health/guarded/expose-only caveats, so the label can never drift.
    try {
      writeFileSync(join(plan.evidenceDir, 'README-throwaway-dast.md'),
        dastDisclaimer({ health: plan.health, migration: plan.migration, guarded: plan.guarded, service: plan.service, port: plan.scoredPort, exposedApiTier: plan.exposedApiTier }))
      writeFileSync(join(plan.evidenceDir, 'dast-provenance.json'),
        JSON.stringify(buildDastProvenance(plan, { health: plan.health, migration: plan.migration, guarded: plan.guarded, scannedTier: { port: plan.scoredPort, service: plan.service } }), null, 2) + '\n')
    } catch { /* self-labelling is best-effort */ }
    try { rec.summary = summarizeZap(JSON.parse(readFileSync(plan.evidencePath, 'utf8'))) } catch (e) { rec.summary = { error: String(e.message) } }
    rec.status = 'done'
  } catch (e) {
    rec.status = 'failed'; rec.log = clampLog(`${rec.log}\n${String(e && e.message || e)}`.trim(), 1500)
  } finally {
    // remove the root-owned ZAP wrk CONTENTS via a throwaway root container (host can't rm
    // root files), then the now-empty host-owned wrk dir itself.
    quiet('docker', ['run', '--rm', '-v', `${plan.wrkDir}:/x`, 'alpine', 'sh', '-c', 'rm -rf /x/* /x/.[!.]* 2>/dev/null || true'])
    try { rmSync(plan.wrkDir, { recursive: true, force: true }) } catch {}
  }
  return rec
}

function main() {
  const argv = process.argv
  const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
  let baseUrl = arg('--base-url', null)
  const target = arg('--target', process.cwd())
  const asJson = argv.includes('--json')

  // ABSENT-CORROBORATION stub (Slice G): for a terminal NOT-scanned state the journey records
  // evidence-of-absence — no scan runs, so no consent is needed (writing "we did not scan" is
  // not a live op). compile-submission renders it as an explicit gap, never a silent one.
  if (argv.includes('--absent')) {
    const stub = absentCorroborationStub({ reason: arg('--reason', 'not attempted'), partnerShape: arg('--shape', null) })
    try { mkdirSync(join(target, '.security-review', 'evidence', 'dast'), { recursive: true }); writeFileSync(join(target, '.security-review', 'evidence', 'dast', 'dast-provenance.json'), JSON.stringify(stub, null, 2) + '\n') } catch {}
    process.stdout.write((asJson ? JSON.stringify(stub, null, 2) : `## run-dast — corroboration NOT attempted: ${stub.reason}`) + '\n')
    return
  }

  const runId = arg('--run-id', `${Date.now().toString(36)}-${process.pid}-${randomBytes(3).toString('hex')}`)
  const tmpRoot = arg('--tmp-root', join(tmpdir(), 'sf-srt-dast', runId))
  // The recorded live-op consent is selected by SOURCE below (once resolveBaseUrl has told us
  // whether this is an already-running instance or a stood-up throwaway); --consent alone is never
  // enough. Read the CLI flag here; pair it with the source-matched recorded token further down.
  const consentFlag = argv.includes('--consent')
  // honesty inputs from the stand-up manifest (Slice B1 wrote them; the journey threads them)
  let health = arg('--health', 'unverified')
  let migration = arg('--migration', null)
  let service = arg('--service', null)
  let scoredPort = arg('--scored-port', arg('--port', null))
  let guarded = argv.includes('--guarded')

  // The scan SOURCE selects which live-op consent gate authorizes this run — resolveBaseUrl is the
  // single arbiter of `source`. An explicit --base-url is an ALREADY-RUNNING instance the operator
  // started (source 'explicit' → the live-instance-dast gate, which active-scans their own live app
  // and its real data); a --from-standup pointer is a disposable throwaway (source 'standup' →
  // throwaway-dast). Resolving the explicit URL HERE also re-asserts loopback before any consent is
  // even looked up, so the loopback-only invariant holds on the already-running path too.
  let scanSource = null
  if (baseUrl) {
    let resolved
    try { resolved = resolveBaseUrl(baseUrl, null) }
    catch (e) { process.stdout.write(`## run-dast — ${e.message}\n`); process.exitCode = 3; return }
    scanSource = resolved.source // 'explicit'
  }

  // --from-standup (Slice D): resolve the base URL + honesty flags from the stand-up pointer,
  // removing the hand-copy foot-gun. Explicit --base-url still wins; the resolver re-asserts
  // loopback + the {up,unhealthy} status gate; the staleness guard catches a swept manifest.
  if (argv.includes('--from-standup') && !baseUrl) {
    const pointer = readStandupPointer(target)
    let resolved
    try { resolved = resolveBaseUrl(null, pointer) }
    catch (e) { process.stdout.write(`## run-dast — ${e.message}\n`); process.exitCode = 3; return }
    if (pointer && pointer.manifestPath && !existsSync(pointer.manifestPath)) {
      process.stdout.write(`## run-dast — the stand-up pointer references a manifest that no longer exists (${pointer.manifestPath}) — the throwaway is gone; stand up again\n`); process.exitCode = 3; return
    }
    baseUrl = resolved.baseUrl
    scanSource = resolved.source // 'standup'
    if (health === 'unverified') health = resolved.status || 'unverified'
    if (!migration && pointer.migration) migration = pointer.migration.tool || pointer.migration
    if (!service && pointer.scannedService) service = pointer.scannedService
    if (!scoredPort && pointer.scannedPort != null) scoredPort = pointer.scannedPort
    guarded = guarded || Boolean(pointer.guarded)
    if (!asJson) process.stdout.write(`## run-dast — resolved from stand-up ${pointer.runId} (created ${pointer.createdAt}), status ${resolved.status}\n`)
  }

  // --consent alone is insufficient: the recorded live-op consent for THIS scan's source is also
  // required. An already-running instance (source 'explicit') verifies 'live-instance-dast' — it
  // active-scans the operator's REAL app; a stood-up throwaway (source 'standup') verifies
  // 'throwaway-dast'. Fail closed when the source-matched token is missing — the flag never
  // authorizes a live op on its own. (No source resolved → default to throwaway-dast; planDast
  // rejects the null base url below before the consent check is reached anyway.)
  const consentGate = scanSource === 'explicit' ? 'live-instance-dast' : 'throwaway-dast'
  const consentRecorded = verifyConsent(consentGate, { target })
  const consent = consentFlag && consentRecorded

  let plan
  try { plan = planDast(baseUrl, { target, runId, tmpRoot, health, migration, guarded, service, scoredPort }) }
  catch (e) { process.stdout.write(`## run-dast — ${e.message}\n`); process.exitCode = 3; return }
  if (!consent) {
    const why = consentFlag && !consentRecorded
      ? `--consent is set but no affirmative consent is recorded for gate '${consentGate}' (the flag alone is not enough). Ask + record it first via record-consent.mjs.`
      : `re-run with --consent (and the recorded consent).`
    process.stdout.write(`## run-dast — NOT RUN (no consent)\nWould run digest-pinned ZAP (${plan.image}) against ${plan.baseUrl} → ${plan.evidencePath}\n${why}\n`); process.exitCode = 3; return
  }

  const r = runDast(plan, { consent })
  if (asJson) { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); if (r.status !== 'done') process.exitCode = 1; return }
  const L = [`## run-dast — ${r.status}${r.degraded ? ' (DEGRADED)' : ''}`]
  if (r.status === 'done') {
    // degrade prefix BEFORE the counts — never present a bare clean-looking alert total
    if (r.degraded) L.push(`DEGRADED — ${r.degradeReason}; the alert counts below are NOT a clean bill of health`)
    L.push(`evidence: ${r.evidencePath}`)
    const s = r.summary || {}
    L.push(`alerts: ${s.total} (High ${s.byRisk?.High || 0} · Medium ${s.byRisk?.Medium || 0} · Low ${s.byRisk?.Low || 0} · Info ${s.byRisk?.Informational || 0})`)
    for (const a of (s.top || []).slice(0, 8)) L.push(`  [${a.risk}] ${a.alert} (x${a.count})`)
  } else L.push('LOG: ' + (r.log || '').split('\n').pop())
  process.stdout.write(L.join('\n') + '\n')
  if (r.status !== 'done') process.exitCode = 1
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) }
  catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

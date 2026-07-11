#!/usr/bin/env node
/**
 * Standing test for harness/run-dast.mjs — the autonomous DAST-against-a-throwaway
 * engine (0.7.0 slice 5). Pure planner + ZAP-report summarizer + consent gate,
 * hermetic (no docker). The real ZAP scan is validated by an Atlas smoke.
 *
 *   D1  planDast: digest-pinned image, --network host, the zap-baseline command, paths
 *   D2  planDast validates the base url + run-id
 *   D3  summarizeZap: counts by risk + total + top, from a sample ZAP report
 *   D4  runDast FAILS CLOSED without consent
 *   G1  dastDisclaimer: up → no degrade caveat + spec-not-imported; non-up → all caveats, no over-claim
 *   G2  buildDastProvenance: field set, authenticated:false + specFedScan:false, PENDING prod-equivalence
 *   G3  dastDegrade: non-up health OR scored-port mismatch degrades; matching port + up → clean
 *   G4  absentCorroborationStub: NOT-ATTEMPTED evidence-of-absence, never a clean result
 *   D5  resolveBaseUrl: pointer-only — an explicit base url THROWS (retired); up/unhealthy
 *       resolve; torn-down/failed/foreign/non-loopback throw
 *   L1  the explicit path is RETIRED at the resolver layer: any explicit url throws, even
 *       loopback, even alongside a valid pointer — the pointer is the ONLY source
 *   L2  MIRROR-ONLY refusal (the mutation-proof): an explicit --base-url through the CLI is
 *       REFUSED (exit 3, honest message, no scan) even WITH --consent and recorded consent
 *       tokens; --from-standup is the only scan path and verifies throwaway-dast — the ONLY
 *       DAST consent; the loopback guard stays on the pointer path (defense in depth)
 *
 * Dependency-free: `node acceptance/test-run-dast.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  planDast, summarizeZap, runDast, ZAP_IMAGE, ZAP_DIGEST,
  dastDisclaimer, buildDastProvenance, absentCorroborationStub, dastDegrade, DAST_PROVENANCE_SCHEMA,
  resolveBaseUrl,
} from '../harness/run-dast.mjs'
import { recordConsent } from '../harness/record-consent.mjs'

let pass = 0, fail = 0
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`) } }

const TMP = join(tmpdir(), 'sf-srt-dast', 'd1')
console.log('run-dast standing test')

check('D1 planDast: digest-pinned image + correct ZAP command + self-labelled local evidence', () => {
  const p = planDast('http://127.0.0.1:8080', { target: '/repo', runId: 'd1', tmpRoot: TMP })
  assert.equal(p.image, `${ZAP_IMAGE}@${ZAP_DIGEST}`)
  assert.match(p.image, /@sha256:[0-9a-f]{64}$/)            // pinned by digest, not a tag
  assert.ok(p.dockerArgs.includes('--network'))            // reaches the host-published port
  assert.ok(p.dockerArgs.includes('zap-baseline.py'))
  assert.ok(p.dockerArgs.includes('http://127.0.0.1:8080'))
  // evidence self-identifies as a LOCAL THROWAWAY scan, not a production submission scan
  assert.equal(p.evidencePath, join('/repo', '.security-review', 'evidence', 'dast', 'zap-throwaway-local-d1.json'))
  assert.equal(p.reportInWrk, join(TMP, 'report.json'))
})

check('D2 planDast validates base url + run-id (loopback host)', () => {
  assert.throws(() => planDast('not-a-url', { target: '/r', runId: 'x', tmpRoot: TMP }), /invalid base url/)
  assert.throws(() => planDast('ftp://x', { target: '/r', runId: 'x', tmpRoot: TMP }), /invalid base url/)
  assert.throws(() => planDast('http://127.0.0.1', { target: '/r', runId: '', tmpRoot: TMP }), /invalid run-id/)
  assert.throws(() => planDast('http://localhost', { target: '', runId: 'x', tmpRoot: TMP }), /target repo required/)
})

check('D2b planDast REFUSES a non-loopback target (the active scan may only hit a local throwaway)', () => {
  for (const bad of ['http://example.com', 'https://api.partner.com/v1', 'http://10.0.0.5:8080', 'http://verdict.my.salesforce.com']) {
    assert.throws(() => planDast(bad, { target: '/r', runId: 'd2b', tmpRoot: TMP }), /non-loopback host/, `should refuse ${bad}`)
  }
  // loopback forms are accepted
  for (const ok of ['http://127.0.0.1:8080', 'http://localhost:3000', 'http://127.5.5.5', 'http://[::1]:9000']) {
    assert.doesNotThrow(() => planDast(ok, { target: '/r', runId: 'd2b', tmpRoot: TMP }))
  }
})

check('D3 summarizeZap: counts by risk + total + top', () => {
  const report = { site: [{ '@name': 'http://127.0.0.1:8080', alerts: [
    { alert: 'CSP missing', riskdesc: 'Medium (High)', count: '2' },
    { alert: 'X-Powered-By leak', riskdesc: 'Low (Medium)', count: '4' },
    { alert: 'X-Content-Type-Options', riskdesc: 'Low (Medium)', instances: [{}, {}] },
    { alert: 'Cacheable', riskdesc: 'Informational (Medium)', count: '1' },
  ] }] }
  const s = summarizeZap(report)
  assert.equal(s.target, 'http://127.0.0.1:8080')
  assert.equal(s.total, 4)
  assert.deepEqual(s.byRisk, { High: 0, Medium: 1, Low: 2, Informational: 1 })
  assert.equal(s.top[0].alert, 'CSP missing')
  assert.equal(s.top[2].count, 2) // from instances length
  // empty/malformed report → zeros, no throw
  assert.equal(summarizeZap({}).total, 0)
  assert.equal(summarizeZap(null).total, 0)
})

check('D4 runDast FAILS CLOSED without consent', () => {
  const p = planDast('http://127.0.0.1:8080', { target: '/repo', runId: 'd4', tmpRoot: join(tmpdir(), 'sf-srt-dast', 'd4') })
  assert.throws(() => runDast(p, { consent: false }), /without explicit consent/)
})

// ── Honesty consumption + machine-readable provenance (Slice G) — the keystone. The live
//    ZAP run is operator-cold-validated; these pin the pure disclaimer/provenance/degrade. ──

check('G1 dastDisclaimer: up → no degrade caveat + spec-not-imported line; non-up+migration+guarded+expose → all caveats, no over-claim', () => {
  const up = dastDisclaimer({ health: 'up' })
  assert.match(up, /did NOT import the captured OpenAPI spec/)
  assert.match(up, /api-endpoints\s+ARTIFACT only/)
  assert.ok(!/at scan time/.test(up), 'a healthy scan carries no health-degrade sentence')
  assert.ok(!/migration mechanism was DETECTED/.test(up))
  const deg = dastDisclaimer({ health: 'unhealthy', migration: 'alembic', guarded: true, service: 'web', exposedApiTier: ['api'] })
  assert.match(deg, /was `unhealthy` at scan time/)
  assert.match(deg, /migration mechanism was DETECTED \(`alembic`\)/)
  assert.match(deg, /auth\/method-guarded/)
  assert.match(deg, /API tier `api` is expose-only/)
  // disclaims, never claims: no clean/healthy positive claim; states NOT production-equivalent
  assert.ok(!/\bclean\b/i.test(deg) && !/\bhealthy\b/i.test(deg), 'no clean/healthy claim: ' + deg)
  assert.match(deg, /NOT the production-equivalent/)
})

check('G2 buildDastProvenance: field set, authenticated:false + specFedScan:false, PENDING prod-equivalence', () => {
  const plan = planDast('http://127.0.0.1:8000', { target: '/repo', runId: 'g2', tmpRoot: TMP })
  const p = buildDastProvenance(plan, { health: 'unhealthy', migration: 'alembic', guarded: true, scannedTier: { port: 8000, service: 'api' } })
  assert.equal(p.schema, DAST_PROVENANCE_SCHEMA)
  assert.equal(p.scanKind, 'unauthenticated-baseline-spider')
  // MUTATION: flipping authenticated→true or specFedScan→true over-claims the scan depth (red)
  assert.equal(p.authenticated, false)
  assert.equal(p.specFedScan, false)
  assert.equal(p.healthState, 'unhealthy')
  assert.equal(p.guarded, true)
  assert.deepEqual(p.scannedTier, { port: 8000, service: 'api' })
  assert.equal(p.baseUrl, 'http://127.0.0.1:8000')
  assert.match(p.prodEquivalence, /PENDING owner attestation/)
  assert.ok(!/\bclean\b|\bhealthy\b/i.test(JSON.stringify(p)), 'provenance never asserts clean/healthy')
})

check('G3 dastDegrade: non-up health OR scored-port mismatch degrades; matching port + up → not degraded', () => {
  const base = { target: '/r', runId: 'g3', tmpRoot: TMP }
  // matching port + healthy → NOT degraded (the one clean path)
  assert.equal(dastDegrade(planDast('http://127.0.0.1:8000', { ...base, health: 'up', scoredPort: 8000 })).degraded, false)
  // wrong tier: scanned 3000, detected 8000 → degraded, reason names the mismatch
  const wd = dastDegrade(planDast('http://127.0.0.1:3000', { ...base, health: 'up', scoredPort: 8000 }))
  assert.equal(wd.degraded, true)
  assert.match(wd.degradeReason, /wrong tier|!= detected web-tier/)
  // non-up health → degraded
  assert.equal(dastDegrade(planDast('http://127.0.0.1:8000', { ...base, health: 'unhealthy', scoredPort: 8000 })).degraded, true)
  // unverified default (no status threaded) → degraded (never claim clean without a verified up)
  assert.equal(dastDegrade(planDast('http://127.0.0.1:8000', { ...base, scoredPort: 8000 })).degraded, true)
})

check('G3b host-port decoupling: an ephemeral host port ≠ container port does NOT false-degrade (scoredPort == baseUrl.port)', () => {
  const base = { target: '/r', runId: 'g3b', tmpRoot: TMP }
  // wo-c-standup publishes on an EPHEMERAL 127.0.0.1 host port; the manifest records
  // scannedPort = that host port = new URL(baseUrl).port, even though the container listens on
  // a DIFFERENT port. scoredPort must track the HOST port, or every real ephemeral run degrades
  // as "wrong tier".
  const hostPort = 49712 // an ephemeral host port docker might assign; distinct from the 8000 container port
  const p = planDast(`http://127.0.0.1:${hostPort}`, { ...base, health: 'up', scoredPort: hostPort })
  assert.equal(dastDegrade(p).degraded, false, 'a hostPort ≠ containerPort run must NOT false-degrade when scoredPort == baseUrl.port')
  assert.equal(String(p.scoredPort), new URL(p.baseUrl).port) // the pointer contract the manifest guarantees
  // the loopback gate still accepts an ephemeral host port on the pointer path
  const resolved = resolveBaseUrl(null, { schema: 'sf-srt-stack/1', runId: 'g3b', baseUrl: `http://127.0.0.1:${hostPort}`, status: 'up', scannedPort: hostPort })
  assert.equal(resolved.baseUrl, `http://127.0.0.1:${hostPort}`)
  // MUTATION the slice prevents: recording scannedPort = the CONTAINER port when the host port
  // differs WOULD false-degrade — the exact regression the pointer contract locks out
  assert.equal(dastDegrade(planDast(`http://127.0.0.1:${hostPort}`, { ...base, health: 'up', scoredPort: 8000 })).degraded, true)
})

check('G4 absentCorroborationStub: NOT-ATTEMPTED evidence-of-absence, never a clean result', () => {
  const s = absentCorroborationStub({ reason: 'needs-recipe: Rails detected', partnerShape: 'rails' })
  assert.equal(s.schema, DAST_PROVENANCE_SCHEMA)
  assert.equal(s.scanKind, 'not-run')
  assert.equal(s.honestyBoundary, 'NOT-ATTEMPTED')
  assert.equal(s.authenticated, false)
  assert.equal(s.reason, 'needs-recipe: Rails detected')
  assert.equal(s.partnerShape, 'rails')
  assert.ok(!/\bclean\b|\bhealthy\b/i.test(JSON.stringify(s)))
})

// ── Base-url pointer resolution (Slice D) — pointer-only; the {up,unhealthy} status gate; the
//    additive 5th loopback layer re-asserts on the resolved URL. Pure resolver, hermetic. ──

check('D5 resolveBaseUrl: pointer-only; explicit THROWS (retired); up/unhealthy resolve; torn-down/failed/foreign/non-loopback throw', () => {
  const P = (over) => ({ schema: 'sf-srt-stack/1', runId: 'r', baseUrl: 'http://127.0.0.1:8000', status: 'up', ...over })
  // an explicit base url is RETIRED — it throws even with a valid pointer present
  assert.throws(() => resolveBaseUrl('http://127.0.0.1:9000', P({})), /retired/)
  // up + unhealthy resolve from the pointer (unhealthy is reachable-but-degraded)
  assert.equal(resolveBaseUrl(null, P({ status: 'up' })).baseUrl, 'http://127.0.0.1:8000')
  assert.equal(resolveBaseUrl(null, P({ status: 'up' })).source, 'standup', 'the pointer is the ONLY source')
  assert.equal(resolveBaseUrl(null, P({ status: 'unhealthy' })).status, 'unhealthy')
  // MUTATION: widening SCANNABLE to include failed/unknown would let a dead throwaway resolve (red)
  assert.throws(() => resolveBaseUrl(null, P({ status: 'failed' })), /not scannable/)
  assert.throws(() => resolveBaseUrl(null, P({ status: 'unknown' })), /not scannable/)
  // torn-down (teardown nulls baseUrl + sets status 'torn-down') → refuse
  assert.throws(() => resolveBaseUrl(null, P({ status: 'torn-down', baseUrl: null })), /torn-down/)
  assert.throws(() => resolveBaseUrl(null, P({ baseUrl: null })), /torn-down/)
  // a foreign pointer schema → refuse
  assert.throws(() => resolveBaseUrl(null, P({ schema: 'other/1' })), /foreign pointer schema/)
  // a tampered pointer with a non-loopback baseUrl → refuse (the additive 5th loopback layer)
  assert.throws(() => resolveBaseUrl(null, P({ baseUrl: 'http://evil.com:8000' })), /non-loopback/)
  // no pointer → honest error naming the stand-up path
  assert.throws(() => resolveBaseUrl(null, null), /no stand-up pointer/)
})

// ── The explicit path is RETIRED (mirror-only). A pre-existing/running instance could be a
//    partner's real product and real data; the resolver refuses ANY explicit url — loopback or
//    not — so the stand-up pointer is the only way a scan target can ever be produced. ──

check('L1 the explicit path is RETIRED at the resolver layer: any explicit url throws, loopback included', () => {
  const tornDown = { schema: 'sf-srt-stack/1', runId: 'l1', baseUrl: null, status: 'torn-down' }
  // MUTATION: restoring the explicit-wins early return makes these resolve instead of throw (red)
  assert.throws(() => resolveBaseUrl('http://127.0.0.1:8000', tornDown), /retired/, 'loopback does not exempt an explicit url')
  assert.throws(() => resolveBaseUrl('http://127.0.0.1:8000', null), /retired/)
  assert.throws(() => resolveBaseUrl('http://evil.com', null), /retired/)
  // the pointer alone still refuses a torn-down throwaway — nothing to scan means no scan
  assert.throws(() => resolveBaseUrl(null, tornDown), /torn-down/)
})

// ── MIRROR-ONLY through the CLI (the core mutation-proof). An explicit --base-url could point
//    at a pre-existing/running instance — someone's real product and real data — so main()
//    REFUSES it outright, before any consent is even looked up. No recorded token unlocks it.
//    --from-standup (the toolkit-built disposable throwaway) is the ONLY scan path, and it
//    verifies 'throwaway-dast' — the ONLY DAST consent. ──

const DAST_CLI = fileURLToPath(new URL('../harness/run-dast.mjs', import.meta.url))
const cliDirs = []
const mkTarget = () => { const d = mkdtempSync(join(tmpdir(), 'run-dast-cli-')); cliDirs.push(d); return d }
const runCli = (args) => {
  try { return { stdout: execFileSync('node', [DAST_CLI, ...args], { encoding: 'utf8' }), status: 0 } }
  catch (e) { return { stdout: String(e.stdout || ''), status: e.status == null ? -1 : e.status } }
}

check('L2 refuses explicit target: an explicit --base-url is REFUSED (exit 3, honest message, NO scan) — no recorded token unlocks it', () => {
  const d = mkTarget()
  // MUTATION-PROOF: record the throwaway-dast consent BEFORE the attempt. If the refusal were
  // reverted (explicit re-allowed), this recorded token plus --consent would let the run
  // proceed to the executor (a scanning/no-docker record, exit != 3, no refusal text) — turning
  // every assertion below RED. With the refusal in place, the run never reaches a consent
  // lookup, never plans, never scans.
  recordConsent('throwaway-dast', 'yes', { target: d, decision: 'affirm' })
  const a = runCli(['--base-url', 'http://127.0.0.1:8080', '--target', d, '--consent'])
  assert.equal(a.status, 3, 'explicit --base-url must exit 3, even with --consent + a recorded token')
  assert.match(a.stdout, /REFUSED/, 'the refusal is explicit, not a silent skip')
  assert.match(a.stdout, /NEVER scan a pre-existing/, 'the message states the invariant honestly')
  assert.match(a.stdout, /--from-standup/, 'the message points at the only supported path')
  assert.match(a.stdout, /PENDING-OWNER-RUN/, 'the message names the honest fallback')
  assert.ok(!/Would run|scanning|no-docker|evidence:/.test(a.stdout), 'nothing was planned or scanned')
  assert.ok(!/NOT RUN \(no consent\)/.test(a.stdout), 'this is a refusal, not a consent prompt — consent is never consulted')

  // and without any --base-url or --from-standup: an honest nothing-to-scan message, exit 3
  const b = runCli(['--target', d, '--consent'])
  assert.equal(b.status, 3)
  assert.match(b.stdout, /--from-standup/)
  assert.match(b.stdout, /never scans a pre-existing instance/)
})

check('L2b the standup pointer path verifies throwaway-dast — the ONLY DAST consent', () => {
  const d = mkTarget()
  mkdirSync(join(d, '.security-review'), { recursive: true })
  writeFileSync(join(d, '.security-review', 'stack-standup.json'),
    JSON.stringify({ schema: 'sf-srt-stack/1', runId: 't1', baseUrl: 'http://127.0.0.1:8080', status: 'up', createdAt: '2026-07-10' }))
  // a stood-up throwaway, no consent recorded → fail closed naming throwaway-dast
  const r = runCli(['--from-standup', '--target', d, '--consent'])
  assert.equal(r.status, 3)
  assert.match(r.stdout, /NOT RUN \(no consent\)/)
  assert.match(r.stdout, /gate 'throwaway-dast'/, 'the standup path names throwaway-dast')
  assert.ok(!/live-instance-dast/.test(r.stdout), 'no other DAST gate exists to name')
})

check('L2c loopback stays enforced on the pointer path (defense in depth) — a tampered non-loopback pointer is refused', () => {
  const d = mkTarget()
  recordConsent('throwaway-dast', 'yes', { target: d, decision: 'affirm' })
  mkdirSync(join(d, '.security-review'), { recursive: true })
  writeFileSync(join(d, '.security-review', 'stack-standup.json'),
    JSON.stringify({ schema: 'sf-srt-stack/1', runId: 't2', baseUrl: 'http://evil.example.com:8080', status: 'up', createdAt: '2026-07-10' }))
  // even with the recorded throwaway-dast token, a tampered pointer cannot smuggle a remote host
  const r = runCli(['--from-standup', '--target', d, '--consent'])
  assert.equal(r.status, 3, 'a non-loopback pointer target must be refused')
  assert.match(r.stdout, /non-loopback/, 'the refusal cites the loopback-only invariant')
})

for (const d of cliDirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

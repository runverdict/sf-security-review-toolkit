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
 *   D5  resolveBaseUrl: explicit wins; up/unhealthy resolve; torn-down/failed/foreign/non-loopback throw
 *   L1  rung 1: explicit --base-url wins + fires even over a torn-down pointer (no stand-up)
 *   L2  rung 1 consent gate is SOURCE-selected: explicit --base-url verifies live-instance-dast
 *       (NOT throwaway-dast) + fails closed without the token; standup verifies throwaway-dast;
 *       loopback-only enforcement survives the explicit path
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

// ── Base-url pointer resolution (Slice D) — explicit wins; the {up,unhealthy} status gate; the
//    additive 5th loopback layer re-asserts on the resolved URL. Pure resolver, hermetic. ──

check('D5 resolveBaseUrl: explicit wins; up/unhealthy resolve; torn-down/failed/foreign/non-loopback throw', () => {
  const P = (over) => ({ schema: 'sf-srt-stack/1', runId: 'r', baseUrl: 'http://127.0.0.1:8000', status: 'up', ...over })
  // explicit --base-url ALWAYS wins, even with a pointer present
  const ex = resolveBaseUrl('http://127.0.0.1:9000', P({ baseUrl: 'http://127.0.0.1:8000' }))
  assert.equal(ex.baseUrl, 'http://127.0.0.1:9000')
  assert.equal(ex.source, 'explicit')
  // up + unhealthy resolve from the pointer (unhealthy is reachable-but-degraded)
  assert.equal(resolveBaseUrl(null, P({ status: 'up' })).baseUrl, 'http://127.0.0.1:8000')
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
  // no --base-url and no pointer → honest error; an explicit non-loopback is still refused
  assert.throws(() => resolveBaseUrl(null, null), /no --base-url and no stand-up pointer/)
  assert.throws(() => resolveBaseUrl('http://evil.com', null), /non-loopback/)
})

// ── Fires-path ladder rung 1 (0.8.109): an explicit --base-url is the "scan an already-running
//    loopback instance" primitive — ZERO build, ZERO stand-up, and it wins even over a
//    torn-down pointer (the cheapest, most size-independent rung). ──

check('L1 rung 1: explicit --base-url ALWAYS wins and fires even over a TORN-DOWN pointer (no stand-up needed)', () => {
  // a torn-down pointer alone would refuse (rung 3/4), but an explicit loopback --base-url resolves it
  const tornDown = { schema: 'sf-srt-stack/1', runId: 'l1', baseUrl: null, status: 'torn-down' }
  // MUTATION: removing resolveBaseUrl's explicit-wins early return → the torn-down pointer throws (red)
  const resolved = resolveBaseUrl('http://127.0.0.1:8000', tornDown)
  assert.equal(resolved.baseUrl, 'http://127.0.0.1:8000')
  assert.equal(resolved.source, 'explicit', 'an explicit base-url resolves as source=explicit, never the pointer')
  // the pointer alone (no --base-url) still refuses a torn-down throwaway — the two-sided proof
  assert.throws(() => resolveBaseUrl(null, tornDown), /torn-down/)
  // rung 1 still plans a real scan from the explicit URL (loopback re-asserted), no pointer involved
  const p = planDast('http://127.0.0.1:8000', { target: '/repo', runId: 'l1', tmpRoot: join(tmpdir(), 'sf-srt-dast', 'l1') })
  assert.ok(p.dockerArgs.includes('http://127.0.0.1:8000'))
})

// ── Rung-1 consent gate is SELECTED BY SOURCE (the distinct live-instance-dast gate). An explicit
//    --base-url active-scans the operator's OWN running app — real data — so it verifies
//    'live-instance-dast', NOT the throwaway's 'throwaway-dast' consent (which promises the scan
//    touches only a disposable throwaway). Driven through the CLI so the whole main() path is
//    exercised. Fail-closed and loopback-only enforcement must survive on every path. ──

const DAST_CLI = fileURLToPath(new URL('../harness/run-dast.mjs', import.meta.url))
const cliDirs = []
const mkTarget = () => { const d = mkdtempSync(join(tmpdir(), 'run-dast-cli-')); cliDirs.push(d); return d }
const runCli = (args) => {
  try { return { stdout: execFileSync('node', [DAST_CLI, ...args], { encoding: 'utf8' }), status: 0 } }
  catch (e) { return { stdout: String(e.stdout || ''), status: e.status == null ? -1 : e.status } }
}

check('L2 explicit --base-url verifies live-instance-dast (NOT throwaway-dast) and fails closed without the token', () => {
  const d = mkTarget()
  // no consent recorded at all → the explicit path fails closed naming the live-instance-dast gate
  const a = runCli(['--base-url', 'http://127.0.0.1:8080', '--target', d, '--consent'])
  assert.equal(a.status, 3, 'no recorded token → fail closed with exit 3')
  assert.match(a.stdout, /NOT RUN \(no consent\)/)
  assert.match(a.stdout, /gate 'live-instance-dast'/, 'the explicit path names the live-instance-dast gate')
  assert.ok(!/gate 'throwaway-dast'/.test(a.stdout), 'the explicit path must NOT name throwaway-dast')

  // MUTATION BITE: record ONLY the throwaway-dast consent. If run-dast reverted to always verifying
  // 'throwaway-dast' on every path, THIS token would let the explicit path proceed. With the
  // source-selected gate it STILL fails closed — the explicit already-running scan does not read
  // the throwaway's consent. (Reverting consentGate to a constant 'throwaway-dast' turns this red.)
  recordConsent('throwaway-dast', 'yes', { target: d, decision: 'affirm' })
  const b = runCli(['--base-url', 'http://127.0.0.1:8080', '--target', d, '--consent'])
  assert.equal(b.status, 3, 'a recorded throwaway-dast token must NOT authorize the already-running scan')
  assert.match(b.stdout, /NOT RUN \(no consent\)/)
  assert.match(b.stdout, /gate 'live-instance-dast'/)
})

check('L2b the standup pointer path still verifies throwaway-dast (unchanged)', () => {
  const d = mkTarget()
  mkdirSync(join(d, '.security-review'), { recursive: true })
  writeFileSync(join(d, '.security-review', 'stack-standup.json'),
    JSON.stringify({ schema: 'sf-srt-stack/1', runId: 't1', baseUrl: 'http://127.0.0.1:8080', status: 'up', createdAt: '2026-07-10' }))
  // a stood-up throwaway (source 'standup'), no consent recorded → fail closed naming throwaway-dast
  const r = runCli(['--from-standup', '--target', d, '--consent'])
  assert.equal(r.status, 3)
  assert.match(r.stdout, /NOT RUN \(no consent\)/)
  assert.match(r.stdout, /gate 'throwaway-dast'/, 'the standup path still names throwaway-dast')
  assert.ok(!/gate 'live-instance-dast'/.test(r.stdout), 'the standup path must NOT name live-instance-dast')
})

check('L2c loopback-only enforcement survives on the explicit path (non-loopback host refused)', () => {
  const d = mkTarget()
  // even with a recorded live-instance-dast token, a non-loopback host is refused before any scan
  recordConsent('live-instance-dast', 'yes', { target: d, decision: 'affirm' })
  const r = runCli(['--base-url', 'http://evil.example.com:8080', '--target', d, '--consent'])
  assert.equal(r.status, 3, 'a non-loopback explicit target must be refused')
  assert.match(r.stdout, /non-loopback/, 'the refusal cites the loopback-only invariant')
})

for (const d of cliDirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

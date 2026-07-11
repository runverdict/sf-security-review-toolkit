#!/usr/bin/env node
/**
 * Standing test for harness/capture-openapi.mjs — the container-isolated OpenAPI capture
 * (B2: the real framework spec, read from the throwaway mirror standup-stack built).
 * Pure planner + spec validator + provenance envelope + consent/loopback gates, hermetic
 * (no docker, no running mirror). The live capture GET is OPERATOR-COLD-VALIDATED, not
 * CI-hermetic — it needs a stood-up mirror, exactly like run-dast's ZAP run; these checks
 * pin the pure core + the skill wiring, which are what regress silently.
 *
 *   O1   planCapture: plan shape (schema, candidates, evidence + provenance paths)
 *   O2   planCapture REFUSES a non-loopback base url (THE security invariant)
 *   O3   planCapture validates url / target / date
 *   O4   validateSpec accepts real OpenAPI 3.x + Swagger 2.0 bodies
 *   O5   validateSpec rejects HTML / `{}` / non-JSON / no-paths / array bodies
 *   O6   buildProvenance: mirror source + PENDING prod-equivalence, never asserted
 *   O6b  rung-1 provenance (source 'explicit'): live-instance source, NO mirror /
 *        synthetic-secrets claim, prod-equivalence still PENDING; standup branch unchanged
 *   O7   captureOpenapi FAILS CLOSED without consent
 *   O7b  the executor's consent refusal names the SOURCE-matched gate (explicit →
 *        live-instance-dast; standup → throwaway-dast)
 *   O8   captureOpenapi re-asserts loopback on the executed plan (even WITH consent)
 *   O9   candidate paths: fixed deterministic order, /openapi.json first, bare rooted only
 *        (+ Slice C: proxied-FastAPI /api/v1/openapi.json + NestJS /api-json /docs-json shapes)
 *   O10  no listener → `not-exposed`, and NOTHING is written (honest no-capture path)
 *   O11  planCapture --root-path: prepend+dedupe to front; no-rootPath byte-identical; fail-closed
 *        (a scheme/URL root-path throws — the GET can never be re-aimed off loopback)
 *   O12  base-url resolver reuse (Slice D): capture imports the ONE resolveBaseUrl; torn-down refused
 *   O13  rung-1 consent gate is SOURCE-selected (mirrors run-dast L2): an explicit --base-url
 *        verifies live-instance-dast (NOT throwaway-dast) and fails closed without the token —
 *        a recorded throwaway-dast token must NOT authorize the already-running capture
 *   O13b the --from-standup pointer path still verifies throwaway-dast (unchanged)
 *   O13c loopback-only enforcement survives the explicit path — a non-loopback --base-url is
 *        refused before any GET, even WITH a recorded live-instance-dast token
 *   W1   generate-artifacts Step 3 consumes the mirror capture; PENDING only on
 *        prod-equivalence; the code-derived + `PENDING live capture` fallback survives
 *   W2   ORDER: the journey invokes capture-openapi AFTER standup-stack, BEFORE teardown-stack
 *   W3   run-scans GRANTS capture-openapi.mjs in allowed-tools
 *   W4   the journey states the capture rides the recorded throwaway-dast consent (no new gate)
 *
 * Dependency-free: `node acceptance/test-capture-openapi.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, rmSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  planCapture, validateSpec, buildProvenance, captureOpenapi, normalizeRootPath,
  CANDIDATE_SPEC_PATHS, CAPTURE_SCHEMA,
} from '../harness/capture-openapi.mjs'
import { resolveBaseUrl } from '../harness/run-dast.mjs'
import { recordConsent } from '../harness/record-consent.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
let pass = 0, fail = 0
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`) } }

console.log('capture-openapi standing test')

check('O1 planCapture: schema + candidates + dated evidence/provenance paths', () => {
  const p = planCapture('http://127.0.0.1:8000', { target: '/repo', date: '2026-07-02' })
  assert.equal(p.schema, CAPTURE_SCHEMA)
  assert.equal(p.baseUrl, 'http://127.0.0.1:8000')
  assert.ok(Array.isArray(p.candidatePaths) && p.candidatePaths.length > 0)
  assert.equal(p.evidencePath, join('/repo', '.security-review', 'evidence', 'openapi-2026-07-02.json'))
  assert.equal(p.provenancePath, join('/repo', '.security-review', 'evidence', 'openapi-2026-07-02.provenance.json'))
})

check('O2 planCapture REFUSES a non-loopback base url (the capture may only read the local mirror)', () => {
  for (const bad of ['http://example.com', 'https://api.partner.com/v1', 'http://10.0.0.5:8080', 'http://verdict.my.salesforce.com', 'https://runverdict.example']) {
    assert.throws(() => planCapture(bad, { target: '/r', date: '2026-07-02' }), /non-loopback host/, `should refuse ${bad}`)
  }
  // loopback forms are accepted
  for (const ok of ['http://127.0.0.1:8000', 'http://localhost:3000', 'http://127.5.5.5', 'http://[::1]:9000']) {
    assert.doesNotThrow(() => planCapture(ok, { target: '/r', date: '2026-07-02' }))
  }
})

check('O3 planCapture validates url + target + date', () => {
  assert.throws(() => planCapture('not-a-url', { target: '/r', date: '2026-07-02' }), /invalid base url/)
  assert.throws(() => planCapture('ftp://127.0.0.1', { target: '/r', date: '2026-07-02' }), /invalid base url/)
  assert.throws(() => planCapture('http://127.0.0.1', { target: '', date: '2026-07-02' }), /target repo required/)
  assert.throws(() => planCapture('http://127.0.0.1', { target: '/r', date: 'July 2' }), /invalid date/)
  assert.throws(() => planCapture('http://127.0.0.1', { target: '/r' }), /invalid date/)
})

check('O4 validateSpec accepts OpenAPI 3.x + Swagger 2.0', () => {
  const v3 = validateSpec(JSON.stringify({ openapi: '3.0.0', info: { title: 't' }, paths: { '/mcp': {}, '/oauth/token': {} } }))
  assert.deepEqual(v3, { valid: true, kind: 'openapi', version: '3.0.0', pathCount: 2 })
  const v31 = validateSpec(JSON.stringify({ openapi: '3.1.0', paths: { '/a': {} } }))
  assert.ok(v31.valid && v31.pathCount === 1)
  const v2 = validateSpec(JSON.stringify({ swagger: '2.0', paths: { '/a': {}, '/b': {}, '/c': {} } }))
  assert.deepEqual(v2, { valid: true, kind: 'swagger', version: '2.0', pathCount: 3 })
})

check('O5 validateSpec rejects HTML / {} / non-JSON / no-paths / array (a hardened always-200 is not a spec)', () => {
  assert.equal(validateSpec('<html><body>Not Found</body></html>').valid, false)
  assert.equal(validateSpec('{}').valid, false)
  assert.equal(validateSpec('not json at all').valid, false)
  assert.equal(validateSpec(JSON.stringify({ openapi: '3.0.0', info: {} })).valid, false) // no paths
  assert.equal(validateSpec(JSON.stringify({ status: 'ok', paths: { '/a': {} } })).valid, false) // no version key
  assert.equal(validateSpec(JSON.stringify([{ openapi: '3.0.0' }])).valid, false)
  assert.equal(validateSpec('null').valid, false)
})

check('O6 buildProvenance: isolated-mirror source + PENDING prod-equivalence, never asserted', () => {
  const p = planCapture('http://127.0.0.1:8000', { target: '/repo', date: '2026-07-02' })
  const prov = buildProvenance(p, { capturedFrom: '/openapi.json', kind: 'openapi', version: '3.0.0', pathCount: 12, runId: 'r1' })
  assert.equal(prov.source, 'container-isolated-throwaway-mirror')
  assert.equal(prov.baseUrl, 'http://127.0.0.1:8000')
  assert.equal(prov.artifact, 'artifact-api-endpoints-spec')
  assert.match(prov.prodEquivalence, /PENDING owner attestation/)
  assert.match(prov.prodEquivalence, /NOT from production/)
  assert.match(prov.secrets, /synthetic secrets/)
  // the envelope never claims to BE the production spec
  assert.notEqual(prov.source, 'production')
  assert.ok(!/source[":\s]+production/i.test(JSON.stringify(prov)), 'no production-source claim anywhere in the envelope')
  // capture-only provenance (Slice C): the spec was READ, not SCANNED — two-sided (present +
  // the disclaimer NEGATES scanned/exercised rather than claiming them)
  assert.match(prov.scanCoverage, /CAPTURE-ONLY/)
  assert.match(prov.scanCoverage, /does NOT consume it/)
  assert.match(prov.scanCoverage, /not necessarily exercised/)
  assert.match(prov.singleSpec, /first-match single-spec/)
})

check('O6b rung-1 provenance (source explicit): live-instance source, NO mirror/synthetic-secrets claim, PENDING survives', () => {
  const p = planCapture('http://127.0.0.1:8000', { target: '/repo', date: '2026-07-02', source: 'explicit' })
  assert.equal(p.source, 'explicit', 'planCapture threads the resolved source onto the plan')
  const prov = buildProvenance(p, { capturedFrom: '/openapi.json', kind: 'openapi', version: '3.1.0', pathCount: 4 })
  // MUTATION: reverting buildProvenance's source to the constant mirror string turns this red
  assert.equal(prov.source, 'already-running-loopback-instance')
  assert.notEqual(prov.source, 'container-isolated-throwaway-mirror')
  // no synthetic-secrets claim — the toolkit did not stand this instance up and generated
  // nothing for it; the operator's instance may hold REAL credentials
  assert.ok(!/synthetic secrets/.test(prov.secrets), 'no synthetic-secrets sentence on the rung-1 branch')
  assert.ok(!/mirror ran/.test(prov.secrets), 'no mirror claim on the rung-1 branch')
  assert.match(prov.secrets, /operator/)
  // a local dev instance is STILL not production — the PENDING attestation survives rung 1
  assert.match(prov.prodEquivalence, /PENDING owner attestation/)
  assert.match(prov.prodEquivalence, /NOT from production/)
  assert.ok(!/source[":\s]+production/i.test(JSON.stringify(prov)), 'no production-source claim anywhere in the envelope')
  // O6 parallel branch: the default (standup) envelope is UNCHANGED
  const std = buildProvenance(planCapture('http://127.0.0.1:8000', { target: '/repo', date: '2026-07-02' }),
    { capturedFrom: '/openapi.json', kind: 'openapi', version: '3.0.0', pathCount: 1 })
  assert.equal(std.source, 'container-isolated-throwaway-mirror')
  assert.match(std.secrets, /synthetic secrets/)
})

check('O7 captureOpenapi FAILS CLOSED without consent', () => {
  const p = planCapture('http://127.0.0.1:8000', { target: '/repo', date: '2026-07-02' })
  assert.throws(() => captureOpenapi(p, { consent: false }), /without explicit consent/)
  assert.throws(() => captureOpenapi(p, {}), /without explicit consent/)
})

check('O7b the executor consent refusal names the SOURCE-matched gate', () => {
  const explicitPlan = planCapture('http://127.0.0.1:8000', { target: '/repo', date: '2026-07-02', source: 'explicit' })
  assert.throws(() => captureOpenapi(explicitPlan, { consent: false }), /live-instance-dast/)
  assert.throws(() => captureOpenapi(explicitPlan, { consent: false }), /already-running instance/)
  const standupPlan = planCapture('http://127.0.0.1:8000', { target: '/repo', date: '2026-07-02' })
  assert.throws(() => captureOpenapi(standupPlan, { consent: false }), /throwaway-dast/)
})

check('O8 captureOpenapi re-asserts loopback on the executed plan (a hand-built remote plan is refused even with consent)', () => {
  assert.throws(() => captureOpenapi({ baseUrl: 'http://example.com', candidatePaths: ['/openapi.json'] }, { consent: true }), /non-loopback host/)
})

check('O9 candidate paths: deterministic order, /openapi.json first, bare rooted paths only', () => {
  assert.equal(CANDIDATE_SPEC_PATHS[0], '/openapi.json')
  for (const path of CANDIDATE_SPEC_PATHS) assert.match(path, /^\/[A-Za-z0-9._/-]*$/, `bare rooted path: ${path}`)
  // Slice C extensions: proxied-FastAPI + NestJS shapes present, /openapi.json still index 0
  assert.equal(CANDIDATE_SPEC_PATHS[2], '/api/v1/openapi.json', 'proxied-FastAPI spec after /api/openapi.json')
  for (const p of ['/api-json', '/docs-json', '/api/docs-json']) assert.ok(CANDIDATE_SPEC_PATHS.includes(p), `NestJS path ${p} present`)
  assert.equal(CANDIDATE_SPEC_PATHS.length, 12)
  const p1 = planCapture('http://127.0.0.1:1', { target: '/r', date: '2026-07-02' })
  const p2 = planCapture('http://127.0.0.1:1', { target: '/r', date: '2026-07-02' })
  assert.deepEqual(p1.candidatePaths, p2.candidatePaths) // deterministic plan
  p1.candidatePaths.pop() // a caller mutating its plan copy must not mutate the shared list
  assert.equal(CANDIDATE_SPEC_PATHS.length, p2.candidatePaths.length)
})

check('O11 planCapture --root-path: prepends+dedupes to front; no-rootPath byte-identical; fails closed', () => {
  const withRp = planCapture('http://127.0.0.1:8000', { target: '/r', date: '2026-07-02', rootPath: '/api/v1' })
  assert.equal(withRp.candidatePaths[0], '/api/v1/openapi.json', 'root-path spec prepended to the front')
  // dedupe: the constant already carries /api/v1/openapi.json → it appears exactly once
  assert.equal(withRp.candidatePaths.filter((p) => p === '/api/v1/openapi.json').length, 1)
  // no-rootPath order is byte-identical to the exported constant (O9 stays valid)
  assert.deepEqual(planCapture('http://127.0.0.1:8000', { target: '/r', date: '2026-07-02' }).candidatePaths, [...CANDIDATE_SPEC_PATHS])
  assert.equal(normalizeRootPath('api/v2/'), '/api/v2')  // single leading slash, trailing trimmed
  assert.equal(normalizeRootPath(''), '')
  assert.equal(normalizeRootPath(null), '')
  // FAIL CLOSED: a scheme/URL normalizes to /http://evil, fails SPEC_PATH_OK → throws (the GET
  // can never be re-aimed off loopback).
  // MUTATION: dropping the SPEC_PATH_OK throw in normalizeRootPath makes this pass a remote URL (red)
  assert.throws(() => normalizeRootPath('http://evil'), /refusing unsafe root-path/)
  assert.throws(() => planCapture('http://127.0.0.1:8000', { target: '/r', date: '2026-07-02', rootPath: 'http://evil' }), /refusing unsafe root-path/)
})

check('O10 no listener → not-exposed, and NOTHING is written (the honest no-capture path)', () => {
  const target = join(tmpdir(), 'sf-srt-openapi-test', 'o10')
  rmSync(target, { recursive: true, force: true }) // self-cleaning: a prior run's residue must not decide this assert
  const p = planCapture('http://127.0.0.1:59173', { target, date: '2026-07-02' })
  const r = captureOpenapi(p, { consent: true, timeoutSec: 2 })
  assert.equal(r.status, 'not-exposed')
  assert.match(r.reason, /no candidate path served a valid OpenAPI/)
  assert.equal(existsSync(p.evidencePath), false, 'no evidence file fabricated')
  assert.equal(existsSync(p.provenancePath), false, 'no provenance fabricated')
})

check('O12 base-url resolver reuse (Slice D): capture imports the ONE resolveBaseUrl from run-dast; torn-down refused', () => {
  const src = readFileSync(join(ROOT, 'harness', 'capture-openapi.mjs'), 'utf8')
  // ONE loopback/resolution definition — capture imports the shared resolver, never forks it
  assert.match(src, /import \{[^}]*resolveBaseUrl[^}]*\} from '\.\/run-dast\.mjs'/, 'capture imports the shared resolveBaseUrl')
  assert.match(src, /readStandupPointer/, 'capture reuses the shared pointer reader')
  // behavioral: the shared resolver refuses a torn-down pointer (no live throwaway)
  assert.throws(() => resolveBaseUrl(null, { schema: 'sf-srt-stack/1', baseUrl: null, status: 'torn-down' }), /torn-down/)
})

// ── Rung-1 fallback (mirrors run-dast's L2 series): the consent gate is SELECTED BY SOURCE.
//    An explicit --base-url reads an ALREADY-RUNNING loopback instance the operator started,
//    so it verifies the recorded 'live-instance-dast' token — NEVER the throwaway's, whose
//    affirmative promises the op touches only a disposable mirror. Driven through the CLI so
//    the whole main() path (resolver → gate selection → fail-closed) is exercised. ──

const CAPTURE_CLI = fileURLToPath(new URL('../harness/capture-openapi.mjs', import.meta.url))
const cliDirs = []
const mkTarget = () => { const d = mkdtempSync(join(tmpdir(), 'capture-openapi-cli-')); cliDirs.push(d); return d }
const runCli = (args) => {
  try { return { stdout: execFileSync('node', [CAPTURE_CLI, ...args], { encoding: 'utf8' }), status: 0 } }
  catch (e) { return { stdout: String(e.stdout || ''), status: e.status == null ? -1 : e.status } }
}

check('O13 explicit --base-url verifies live-instance-dast (NOT throwaway-dast) and fails closed without the token', () => {
  const d = mkTarget()
  // no consent recorded at all → the explicit path fails closed naming the live-instance-dast gate
  const a = runCli(['--base-url', 'http://127.0.0.1:8080', '--target', d, '--consent'])
  assert.equal(a.status, 3, 'no recorded token → fail closed with exit 3')
  assert.match(a.stdout, /NOT RUN \(no consent\)/)
  assert.match(a.stdout, /gate 'live-instance-dast'/, 'the explicit path names the live-instance-dast gate')
  assert.ok(!/gate 'throwaway-dast'/.test(a.stdout), 'the explicit path must NOT name throwaway-dast')

  // MUTATION BITE: record ONLY the throwaway-dast consent. If the capture reverted to always
  // verifying 'throwaway-dast' on every path, THIS token would let the explicit path proceed.
  // With the source-selected gate it STILL fails closed — the already-running instance never
  // rides the throwaway's consent. (Reverting consentGate to a constant 'throwaway-dast'
  // turns this red.)
  recordConsent('throwaway-dast', 'yes', { target: d, decision: 'affirm' })
  const b = runCli(['--base-url', 'http://127.0.0.1:8080', '--target', d, '--consent'])
  assert.equal(b.status, 3, 'a recorded throwaway-dast token must NOT authorize the already-running capture')
  assert.match(b.stdout, /NOT RUN \(no consent\)/)
  assert.match(b.stdout, /gate 'live-instance-dast'/)
})

check('O13b the --from-standup pointer path still verifies throwaway-dast (unchanged)', () => {
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

check('O13c loopback-only enforcement survives the explicit path (non-loopback refused before any GET, even WITH the token)', () => {
  const d = mkTarget()
  // even with a recorded live-instance-dast token, a non-loopback host is refused before any GET
  recordConsent('live-instance-dast', 'yes', { target: d, decision: 'affirm' })
  const r = runCli(['--base-url', 'http://198.51.100.7:8080', '--target', d, '--consent'])
  assert.equal(r.status, 3, 'a non-loopback explicit target must be refused')
  assert.match(r.stdout, /non-loopback host/, 'the refusal cites the capture loopback-only invariant')
  assert.ok(!/status.*captured|evidence:/.test(r.stdout), 'nothing was captured')
})

for (const d of cliDirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }

// ─────────────────────────────────────────────────────────────── WIRING (read the skills)

const journeyText = readFileSync(join(ROOT, 'skills', 'security-review-journey', 'SKILL.md'), 'utf8')
const genArtText = readFileSync(join(ROOT, 'skills', 'generate-artifacts', 'SKILL.md'), 'utf8')
const runScansText = readFileSync(join(ROOT, 'skills', 'run-scans', 'SKILL.md'), 'utf8')
const runScansFm = runScansText.split('---')[1] || ''
const runScansAllowed = runScansFm.split('\n').find((l) => l.startsWith('allowed-tools:')) || ''

check('W1 generate-artifacts consumes the mirror capture; PENDING only on prod-equivalence; honest fallback survives', () => {
  assert.ok(genArtText.includes('capture-openapi.mjs'), 'Step 3 references the capture engine')
  assert.ok(genArtText.includes('openapi-<date>.json'), 'Step 3 names the captured evidence file')
  assert.ok(genArtText.includes('container-isolated-throwaway-mirror'), 'provenance source named')
  assert.ok(/prod-equivalence attestation/.test(genArtText), 'PENDING is scoped to the prod-equivalence attestation')
  assert.ok(/never present the capture as the production spec/.test(genArtText), 'honest-provenance rule stated')
  // the no-capture fallback is UNCHANGED behavior: code-derived + PENDING live capture
  assert.ok(genArtText.includes('code-derived'), 'code-derived fallback survives')
  assert.ok(genArtText.includes('PENDING live capture'), 'the honest PENDING-live-capture fallback survives')
})

check('W2 ORDER — the journey invokes capture-openapi AFTER standup-stack and BEFORE teardown-stack', () => {
  // anchor on the ACTUAL live-tail invocation command, not a prose mention of the engine
  const ci = journeyText.indexOf('harness/capture-openapi.mjs --consent --base-url')
  assert.ok(ci > -1, 'the journey live tail invokes capture-openapi.mjs')
  assert.ok(journeyText.lastIndexOf('standup-stack.mjs', ci) > -1, 'a standup-stack invocation precedes the capture')
  assert.ok(journeyText.indexOf('teardown-stack.mjs', ci) > -1, 'a teardown-stack invocation follows the capture (the mirror is still up)')
})

check('W3 run-scans GRANTS capture-openapi.mjs in allowed-tools', () => {
  assert.ok(runScansAllowed.includes('Bash(node *harness/capture-openapi.mjs *)'), 'capture grant present in run-scans')
})

check('W4 the journey states the capture rides the recorded throwaway-dast consent (no new gate)', () => {
  const ci = journeyText.indexOf('harness/capture-openapi.mjs --consent --base-url')
  const nearby = journeyText.slice(ci, ci + 1200)
  assert.ok(/NO new consent/.test(nearby), 'no-new-consent stated at the invocation')
  assert.ok(/recorded `throwaway-dast` token/.test(nearby), 'the throwaway-dast token is named as the gate it rides')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

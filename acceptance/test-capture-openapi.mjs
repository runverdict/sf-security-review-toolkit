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
 *   O7   captureOpenapi FAILS CLOSED without consent
 *   O8   captureOpenapi re-asserts loopback on the executed plan (even WITH consent)
 *   O9   candidate paths: fixed deterministic order, /openapi.json first, bare rooted only
 *        (+ Slice C: proxied-FastAPI /api/v1/openapi.json + NestJS /api-json /docs-json shapes)
 *   O10  no listener → `not-exposed`, and NOTHING is written (honest no-capture path)
 *   O11  planCapture --root-path: prepend+dedupe to front; no-rootPath byte-identical; fail-closed
 *        (a scheme/URL root-path throws — the GET can never be re-aimed off loopback)
 *   O12  base-url resolver reuse (Slice D): capture imports the ONE resolveBaseUrl; torn-down refused
 *   W1   generate-artifacts Step 3 consumes the mirror capture; PENDING only on
 *        prod-equivalence; the code-derived + `PENDING live capture` fallback survives
 *   W2   ORDER: the journey invokes capture-openapi AFTER standup-stack, BEFORE teardown-stack
 *   W3   run-scans GRANTS capture-openapi.mjs in allowed-tools
 *   W4   the journey states the capture rides the recorded throwaway-dast consent (no new gate)
 *
 * Dependency-free: `node acceptance/test-capture-openapi.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  planCapture, validateSpec, buildProvenance, captureOpenapi, normalizeRootPath,
  CANDIDATE_SPEC_PATHS, CAPTURE_SCHEMA,
} from '../harness/capture-openapi.mjs'
import { resolveBaseUrl } from '../harness/run-dast.mjs'

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

check('O7 captureOpenapi FAILS CLOSED without consent', () => {
  const p = planCapture('http://127.0.0.1:8000', { target: '/repo', date: '2026-07-02' })
  assert.throws(() => captureOpenapi(p, { consent: false }), /without explicit consent/)
  assert.throws(() => captureOpenapi(p, {}), /without explicit consent/)
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

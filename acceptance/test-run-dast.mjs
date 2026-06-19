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
 *
 * Dependency-free: `node acceptance/test-run-dast.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { planDast, summarizeZap, runDast, ZAP_IMAGE, ZAP_DIGEST } from '../harness/run-dast.mjs'

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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

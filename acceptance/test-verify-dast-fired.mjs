#!/usr/bin/env node
/*
 * test-verify-dast-fired.mjs — the DAST-fired tag gate (harness/verify-dast-fired.mjs).
 *
 * The FIRE itself needs live docker (a stood-up throwaway or a rung-1 instance), so it
 * cannot run in CI. What IS hermetic — and what this pins — is the PREDICATE + the CLI's
 * exit code: a real fire (scanKind ≠ not-run + a zap-throwaway-local-*.json report on
 * disk) → fired / exit 0; every degrade / absence → not-fired / exit 2 (fail closed).
 *
 *   DF1  dastFired: a real fire (scanKind + report present) → fired
 *   DF2  a not-run stub → NOT fired (evidence of absence)
 *   DF3  a real scanKind but NO report on disk → NOT fired (a fire must leave its report)
 *   DF4  the zap-baseline naming trap: only a `zap-baseline-*.json` present → NOT fired
 *        (that is the ZAP SCRIPT name, never an evidence file)
 *   DF5  a missing / unreadable provenance → NOT fired (fail closed)
 *   DF6  a provenance with no scanKind → NOT fired (fail closed)
 *   DF7  THROWAWAY_REPORT_RE matches the throwaway output, never zap-baseline
 *   DF8  CLI: exit 0 on a fire, exit 2 on a degrade / missing evidence
 *
 * Dependency-free: `node acceptance/test-verify-dast-fired.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dastFired, THROWAWAY_REPORT_RE } from '../harness/verify-dast-fired.mjs'

const CLI = fileURLToPath(new URL('../harness/verify-dast-fired.mjs', import.meta.url))
let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`) } }
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'vdf-')); dirs.push(d); return d }

const FIRED_PROV = { schema: 'sf-srt-dast-provenance/1', scanKind: 'unauthenticated-baseline-spider', authenticated: false }
const NOTRUN_PROV = { schema: 'sf-srt-dast-provenance/1', scanKind: 'not-run', reason: 'needs-secrets-declined' }

/** Seed <dir>/.security-review/evidence/dast/ with the given provenance + report file names. */
function seed(dir, { provenance, reports = [] } = {}) {
  const d = join(dir, '.security-review', 'evidence', 'dast')
  mkdirSync(d, { recursive: true })
  if (provenance !== undefined) writeFileSync(join(d, 'dast-provenance.json'), JSON.stringify(provenance, null, 2) + '\n')
  for (const r of reports) writeFileSync(join(d, r), '{"site":[]}')
  return d
}
/** Run the CLI → { code, out }. */
function cli(target) {
  try { const out = execFileSync('node', [CLI, '--target', target], { encoding: 'utf8', stdio: 'pipe' }); return { code: 0, out } }
  catch (e) { return { code: e.status == null ? -1 : e.status, out: String(e.stdout || '') + String(e.stderr || '') } }
}

console.log('verify-dast-fired:')

check('DF1 a real fire (scanKind + zap-throwaway-local report) → fired', () => {
  const r = dastFired({ provenance: FIRED_PROV, reportFiles: ['zap-throwaway-local-abc123.json', 'dast-provenance.json', 'README-throwaway-dast.md'] })
  assert.equal(r.fired, true, r.reason)
})

check('DF2 a not-run stub → NOT fired, even with a STALE report on disk (provenance is authoritative)', () => {
  // A stale zap-throwaway-local report from a PRIOR fire must not make a not-run degrade read as
  // fired — the provenance decides. MUTATION: dropping the `kind === 'not-run'` branch in dastFired
  // turns this red (the stale report would then satisfy hasReport and the degrade would read fired).
  const r = dastFired({ provenance: NOTRUN_PROV, reportFiles: ['zap-throwaway-local-stale.json'] })
  assert.equal(r.fired, false)
  assert.match(r.reason, /not-run|degrad|absence/i)
})

check('DF3 a real scanKind but NO report on disk → NOT fired (a fire must leave its report)', () => {
  const r = dastFired({ provenance: FIRED_PROV, reportFiles: ['dast-provenance.json'] })
  assert.equal(r.fired, false)
  assert.match(r.reason, /no zap-throwaway-local/i)
})

check('DF4 the zap-baseline naming trap: only a zap-baseline-*.json present → NOT fired', () => {
  // MUTATION: broadening THROWAWAY_REPORT_RE to also match zap-baseline turns this red
  const r = dastFired({ provenance: FIRED_PROV, reportFiles: ['zap-baseline-2026-07-11.json', 'dast-provenance.json'] })
  assert.equal(r.fired, false, 'a zap-baseline-*.json is the ZAP SCRIPT name, never the throwaway output')
})

check('DF5 a missing / unreadable provenance → NOT fired (fail closed)', () => {
  assert.equal(dastFired({ provenance: null, reportFiles: ['zap-throwaway-local-x.json'] }).fired, false)
  assert.equal(dastFired({ provenance: [], reportFiles: ['zap-throwaway-local-x.json'] }).fired, false) // a non-object is unreadable
})

check('DF6 a provenance with no scanKind → NOT fired (fail closed)', () => {
  const r = dastFired({ provenance: { schema: 'sf-srt-dast-provenance/1' }, reportFiles: ['zap-throwaway-local-x.json'] })
  assert.equal(r.fired, false)
  assert.match(r.reason, /no scanKind/i)
})

check('DF7 THROWAWAY_REPORT_RE matches the throwaway output, never zap-baseline', () => {
  assert.ok(THROWAWAY_REPORT_RE.test('zap-throwaway-local-abc.json'))
  assert.ok(!THROWAWAY_REPORT_RE.test('zap-baseline-2026-07-11.json'))
  assert.ok(!THROWAWAY_REPORT_RE.test('zap-throwaway-local-abc.html'))
})

check('DF8 CLI: exit 0 on a fire, exit 2 on a degrade / missing evidence', () => {
  const fired = tmp(); seed(fired, { provenance: FIRED_PROV, reports: ['zap-throwaway-local-run1.json'] })
  const a = cli(fired)
  assert.equal(a.code, 0, `expected exit 0 on a fire, got ${a.code}: ${a.out}`)
  assert.match(a.out, /PASS/)

  const degraded = tmp(); seed(degraded, { provenance: NOTRUN_PROV, reports: [] })
  const b = cli(degraded)
  assert.equal(b.code, 2, `expected exit 2 on a not-run degrade, got ${b.code}: ${b.out}`)
  assert.match(b.out, /FAIL/)

  const empty = tmp() // no .security-review at all → fail closed
  const c = cli(empty)
  assert.equal(c.code, 2, `expected exit 2 on missing evidence, got ${c.code}: ${c.out}`)
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

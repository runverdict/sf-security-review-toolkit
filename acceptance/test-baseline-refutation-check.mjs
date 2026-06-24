#!/usr/bin/env node
/**
 * Standing test for harness/baseline-refutation-check.mjs — the deterministic
 * engine that catches a refutation leaning on platform auto-enforcement (user
 * mode / `with sharing` defaults at API 67.0+) the package's actual
 * `sourceApiVersion` does NOT buy.
 *
 * Guards the v67 auto-enforcement gate: a "missing CRUD/FLS"/"missing sharing"
 * finding refuted as "the platform enforces it by default" is INVALID on a
 * package whose sourceApiVersion is <= 66.0 (the Solano fixture is 64.0), where
 * the old system-mode / `without sharing` defaults still hold — so that
 * refutation drops a real finding and must be re-opened.
 *
 * Self-contained + dependency-free: INLINE synthetic findings + temp ledgers.
 *   node acceptance/test-baseline-refutation-check.mjs
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { checkBaselineRefutations } from '../harness/baseline-refutation-check.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const ENGINE = join(PLUGIN, 'harness', 'baseline-refutation-check.mjs')

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

console.log('baseline-refutation-check standing test')

// --- fixture helpers -------------------------------------------------------
// A refuted finding whose reasoning cites the platform auto-enforcement rationale.
const refutedCitingAutoEnforce = (over = {}) => ({
  id: 'F1',
  dimension: 'apex-exposed-surface',
  title: 'Missing FLS on an @AuraEnabled read path',
  file: 'force-app/main/default/classes/AcctController.cls:21-26',
  status: 'refuted',
  verdict: 'false_positive',
  reasoning: 'No explicit FLS check, but Apex runs in user mode by default at 67.0+, so object/field access is auto-enforced by the platform.',
  evidence: 'AcctController.cls:21 — [SELECT Email FROM Contact ...] with no WITH USER_MODE',
  ...over,
})
// A refuted finding with a DIFFERENT (non-auto-enforcement) rationale.
const refutedNoCite = (over = {}) => ({
  id: 'F2',
  dimension: 'apex-exposed-surface',
  title: 'IDOR-shaped read',
  file: 'force-app/main/default/classes/OppController.cls:10-14',
  status: 'refuted',
  verdict: 'false_positive',
  reasoning: 'The upstream SolanoAccessGuard scopes every path to the running user before the read; the id is owner-checked.',
  evidence: 'AccessGuard.cls:3 — assertVisible(id) throws for an unentitled record',
  ...over,
})
const led = (...findings) => ({ schema_version: '1', findings, passes: [] })
const tmp = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); dirs.push(d); return d }

// --- (a) refuted + cites 67.0 auto-enforcement + apiVersion 64 → INVALID ----
check('a refuted finding citing 67.0 auto-enforcement on a 64.0 package → invalid_refutations', () => {
  const out = checkBaselineRefutations([refutedCitingAutoEnforce()], 64.0)
  assert.equal(out.apiVersion, 64)
  assert.equal(out.checked, 1, 'the auto-enforcement-citing refutation is a candidate')
  assert.equal(out.invalid_refutations.length, 1, 'flagged invalid on a <67.0 package')
  assert.equal(out.unknown.length, 0)
  const r = out.invalid_refutations[0]
  assert.equal(r.id, 'F1')
  assert.equal(r.file, 'force-app/main/default/classes/AcctController.cls:21-26')
  assert.equal(r.apiVersion, 64)
  assert.ok(typeof r.citedSignal === 'string' && r.citedSignal.length > 0, 'reports which signal it matched')
})

// --- (b) same finding + apiVersion 68 → NOT flagged (auto-enforce IS real) ---
check('b same refutation on a 68.0 package → NOT flagged (auto-enforcement holds at >=67.0)', () => {
  const out = checkBaselineRefutations([refutedCitingAutoEnforce()], 68.0)
  assert.equal(out.apiVersion, 68)
  assert.equal(out.checked, 1)
  assert.equal(out.invalid_refutations.length, 0, '>=67.0 → the rationale is valid')
  assert.equal(out.unknown.length, 0)
})
// boundary: exactly 67.0 is valid (>=67.0), 66.x is invalid (<67.0)
check('b2 boundary: 67.0 valid (not flagged); 66.0 invalid (flagged)', () => {
  assert.equal(checkBaselineRefutations([refutedCitingAutoEnforce()], 67.0).invalid_refutations.length, 0)
  assert.equal(checkBaselineRefutations([refutedCitingAutoEnforce()], 66.0).invalid_refutations.length, 1)
})

// --- (c) refuted, NO auto-enforcement cite → not flagged --------------------
check('c refuted finding with a non-auto-enforcement rationale → not checked, not flagged', () => {
  const out = checkBaselineRefutations([refutedNoCite()], 64.0)
  assert.equal(out.checked, 0, 'no cited auto-enforcement signal → not a candidate')
  assert.equal(out.invalid_refutations.length, 0)
  assert.equal(out.unknown.length, 0)
})
// a CONFIRMED (open) finding that happens to mention user mode is never a candidate.
check('c2 a non-refuted (confirmed) finding is never a candidate, even if it mentions user mode', () => {
  const confirmed = refutedCitingAutoEnforce({ status: 'confirmed', verdict: 'confirmed_real' })
  const out = checkBaselineRefutations([confirmed], 64.0)
  assert.equal(out.checked, 0)
  assert.equal(out.invalid_refutations.length, 0)
})

// --- (d) apiVersion null (no version source) → unknown ----------------------
check('d apiVersion null → the matching refutation lands in unknown, not invalid', () => {
  const out = checkBaselineRefutations([refutedCitingAutoEnforce()], null)
  assert.equal(out.apiVersion, null)
  assert.equal(out.checked, 1)
  assert.equal(out.invalid_refutations.length, 0, 'cannot decide without a version')
  assert.equal(out.unknown.length, 1)
  assert.equal(out.unknown[0].apiVersion, null)
})

// --- (e) --strict exits 3 when invalid; 0 otherwise -------------------------
check('e --strict exits 3 when an invalid refutation is found; plain run exits 0', () => {
  const d = tmp('brc-strict-')
  const p = join(d, 'ledger.json')
  writeFileSync(p, JSON.stringify(led(refutedCitingAutoEnforce())))
  // strict + 64.0 → invalid present → exit 3
  let code = 0
  try { execFileSync('node', [ENGINE, '--ledger', p, '--api-version', '64', '--strict'], { stdio: 'pipe' }) }
  catch (e) { code = e.status }
  assert.equal(code, 3, '--strict with an invalid refutation → exit 3')
  // non-strict same inputs → exit 0, invalid still reported in stdout
  const stdout = execFileSync('node', [ENGINE, '--ledger', p, '--api-version', '64'], { encoding: 'utf8' })
  const parsed = JSON.parse(stdout)
  assert.equal(parsed.invalid_refutations.length, 1, 'non-strict still REPORTS the invalid refutation')
  // strict + 68.0 → no invalid → exit 0
  const ok = execFileSync('node', [ENGINE, '--ledger', p, '--api-version', '68', '--strict'], { encoding: 'utf8' })
  assert.equal(JSON.parse(ok).invalid_refutations.length, 0)
})

// --- (f) byte-determinism ---------------------------------------------------
check('f pure core + CLI are byte-deterministic', () => {
  const findings = [refutedCitingAutoEnforce(), refutedNoCite(), refutedCitingAutoEnforce({ id: 'F3', file: 'x/Y.cls:1' })]
  const a = JSON.stringify(checkBaselineRefutations(findings, 64.0), null, 2)
  const b = JSON.stringify(checkBaselineRefutations(findings, 64.0), null, 2)
  assert.equal(a, b, 'pure + deterministic')
  const d = tmp('brc-det-')
  const p = join(d, 'ledger.json')
  writeFileSync(p, JSON.stringify(led(...findings)))
  const o1 = execFileSync('node', [ENGINE, '--ledger', p, '--api-version', '64'], { encoding: 'utf8' })
  const o2 = execFileSync('node', [ENGINE, '--ledger', p, '--api-version', '64'], { encoding: 'utf8' })
  assert.equal(o1, o2, 'CLI byte-identical on re-run')
})

// --- version source precedence + file readers ------------------------------
check('g --sfdx-project reads top-level sourceApiVersion (64.0 → invalid)', () => {
  const d = tmp('brc-sfdx-')
  const p = join(d, 'ledger.json'); writeFileSync(p, JSON.stringify(led(refutedCitingAutoEnforce())))
  const proj = join(d, 'sfdx-project.json'); writeFileSync(proj, JSON.stringify({ sourceApiVersion: '64.0', packageDirectories: [] }))
  const out = JSON.parse(execFileSync('node', [ENGINE, '--ledger', p, '--sfdx-project', proj], { encoding: 'utf8' }))
  assert.equal(out.apiVersion, 64)
  assert.equal(out.invalid_refutations.length, 1)
})
check('h --scope-manifest reads package.sourceApiVersion (68.0 → not flagged)', () => {
  const d = tmp('brc-man-')
  const p = join(d, 'ledger.json'); writeFileSync(p, JSON.stringify(led(refutedCitingAutoEnforce())))
  const man = join(d, 'scope.json'); writeFileSync(man, JSON.stringify({ package: { sourceApiVersion: 68.0 } }))
  const out = JSON.parse(execFileSync('node', [ENGINE, '--ledger', p, '--scope-manifest', man], { encoding: 'utf8' }))
  assert.equal(out.apiVersion, 68)
  assert.equal(out.invalid_refutations.length, 0)
})
check('i precedence: --api-version wins over --sfdx-project', () => {
  const d = tmp('brc-prec-')
  const p = join(d, 'ledger.json'); writeFileSync(p, JSON.stringify(led(refutedCitingAutoEnforce())))
  const proj = join(d, 'sfdx-project.json'); writeFileSync(proj, JSON.stringify({ sourceApiVersion: '64.0' }))
  // --api-version 70 should win → not flagged, despite the 64.0 sfdx file
  const out = JSON.parse(execFileSync('node', [ENGINE, '--ledger', p, '--api-version', '70', '--sfdx-project', proj], { encoding: 'utf8' }))
  assert.equal(out.apiVersion, 70)
  assert.equal(out.invalid_refutations.length, 0)
})

// --- fail-closed ------------------------------------------------------------
check('j a ledger whose findings is a non-array (dict) → empty result, no crash', () => {
  const out = checkBaselineRefutations({ not: 'an array' }, 64.0)
  assert.equal(out.checked, 0)
  assert.equal(out.invalid_refutations.length, 0)
})
check('k missing/unreadable --ledger → exit 2; absent --ledger → exit 2', () => {
  let code = 0
  try { execFileSync('node', [ENGINE, '--ledger', '/no/such/ledger.json', '--api-version', '64'], { stdio: 'pipe' }) }
  catch (e) { code = e.status }
  assert.equal(code, 2, 'unreadable ledger fails closed with exit 2')
  let code2 = 0
  try { execFileSync('node', [ENGINE, '--api-version', '64'], { stdio: 'pipe' }) } catch (e) { code2 = e.status }
  assert.equal(code2, 2, 'no --ledger → exit 2')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

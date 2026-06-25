#!/usr/bin/env node
/**
 * Standing test for WI-02 — the audit-launch gate CONFIRMS the locked tier, it
 * does not re-ask it. A cold campaign caught the tier being re-elected in
 * audit-codebase after the journey already collected it (the launch gate
 * re-litigating the choice). gate-spec's selector emits a confirm-and-authorize
 * variant when a tier token is already recorded; this test keeps it that way.
 *
 * T1  with a recorded audit-tier token → exactly {Authorize, Change tier, Cancel}.
 * T2  with NO prior token → the full first-pass menu (Standard/Exhaustive/Quick/Cancel).
 * T3  pass-1 NEVER pre-selects Exhaustive — Standard is the recommended default;
 *     Exhaustive is OFFERED (present) but never the recommended one.
 * T4  journey→audit-codebase fixture (via the CLI, exactly as the driver invokes):
 *     the tier menu is collected ONCE; the SECOND surface is a confirm, not a
 *     re-election. Only "Change tier" re-opens the full menu.
 * T5  WI-02 wiring — audit-codebase Step 2 calls gate-spec with the resume facts
 *     and still records the launch authorization via record-consent --gate audit-tier.
 *
 * Dependency-free: `node acceptance/test-tier-no-reask.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { gateOptions } from '../harness/gate-spec.mjs'
import { recordConsent } from '../harness/record-consent.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'gate-spec.mjs')

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) } }
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'tier-reask-')); dirs.push(d); return d }
const labels = (payload) => payload.options.map((o) => o.label)
const isTierMenu = (lbls) => lbls.some((l) => /^Standard/.test(l)) && lbls.some((l) => /^Exhaustive/.test(l)) && lbls.some((l) => /^Quick/.test(l))
const isConfirm = (lbls) => lbls.some((l) => /^Authorize/.test(l)) && lbls.includes('Change tier')

console.log('tier-no-reask (WI-02) standing test')

check('T1 a recorded audit-tier token → exactly {Authorize, Change tier, Cancel}', () => {
  const p = gateOptions('audit-tier', { recordedTier: 'standard' })
  assert.deepEqual(labels(p), ['Authorize the standard launch (recommended)', 'Change tier', 'Cancel — do not launch'])
  assert.ok(isConfirm(labels(p)) && !isTierMenu(labels(p)), 'confirm variant must NOT re-offer the tier menu')
  // the locked tier is reflected, not re-asked
  assert.match(p.options[0].description, /REUSED, not re-asked/)
})

check('T2 NO prior token → the full first-pass menu', () => {
  const p = gateOptions('audit-tier', {})
  assert.ok(isTierMenu(labels(p)), 'first pass must offer the full tier menu')
  assert.ok(!isConfirm(labels(p)), 'first pass is not a confirm')
  assert.deepEqual(labels(p), ['Standard (recommended)', 'Exhaustive', 'Quick (triage)', 'Cancel — do not launch'])
})

check('T3 pass-1 never pre-selects Exhaustive (Standard is the recommended default)', () => {
  const p = gateOptions('audit-tier', {})
  const recommended = p.options.filter((o) => /recommended/i.test(o.label))
  assert.equal(recommended.length, 1, 'exactly one option is labeled recommended')
  assert.match(recommended[0].label, /^Standard/, 'the recommended default is Standard, never Exhaustive')
  const exhaustive = p.options.find((o) => /^Exhaustive/.test(o.label))
  assert.ok(exhaustive, 'Exhaustive is OFFERED, not hidden')
  assert.ok(!/recommended/i.test(exhaustive.label), 'Exhaustive is never the recommended one')
  assert.match(exhaustive.description, /never\s+pre-selected/i)
})

check('T4 journey→audit-codebase: tier collected ONCE, second surface is a confirm', () => {
  const repo = tmp()
  // --- journey gate 1: full menu, collect the tier ONCE ---
  const surface1 = JSON.parse(execFileSync('node', [CLI, '--gate', 'audit-tier', '--target', repo], { encoding: 'utf8' }))
  assert.ok(isTierMenu(labels(surface1)), 'surface 1 (journey) offers the tier menu')
  // operator picks Standard → journey records it (controlled --decision token)
  recordConsent('audit-tier', 'Standard (recommended)', { target: repo, decision: 'affirm', question: 'tier?' })

  // --- audit-codebase Step 2 resume: SAME CLI call, now sees the recorded token ---
  const surface2 = JSON.parse(execFileSync('node', [CLI, '--gate', 'audit-tier', '--target', repo], { encoding: 'utf8' }))
  assert.ok(isConfirm(labels(surface2)), 'surface 2 (audit-codebase) is a confirm')
  assert.ok(!isTierMenu(labels(surface2)), 'surface 2 does NOT re-offer the tier menu — collected once')

  // --- only "Change tier" re-opens the full menu (reelect fact) ---
  const reelectFile = join(repo, 'reelect.json')
  writeFileSync(reelectFile, JSON.stringify({ reelect: true }))
  const reopened = JSON.parse(execFileSync('node', [CLI, '--gate', 'audit-tier', '--target', repo, '--facts', reelectFile], { encoding: 'utf8' }))
  assert.ok(isTierMenu(labels(reopened)), '"Change tier" re-opens the full menu')
})

check('T4b the confirm authorize → affirm, both Change tier and Cancel → deny (fail-safe non-launch)', () => {
  const p = gateOptions('audit-tier', { recordedTier: 'exhaustive' })
  const byLabel = Object.fromEntries(p.options.map((o) => [o.label, o.decision]))
  assert.equal(byLabel['Authorize the exhaustive launch (recommended)'], 'affirm')
  assert.equal(byLabel['Change tier'], 'deny', 'Change tier must NOT authorize a launch')
  assert.equal(byLabel['Cancel — do not launch'], 'deny')
})

check('T5 WI-02 wiring: audit-codebase Step 2 calls gate-spec with resume facts + records the launch', () => {
  const a = readFileSync(join(PLUGIN, 'skills', 'audit-codebase', 'SKILL.md'), 'utf8')
  assert.match(a, /gate-spec\.mjs --gate audit-tier --target/, 'Step 2 calls gate-spec with the resume facts (--target)')
  assert.match(a, /record-consent\.mjs --gate audit-tier/, 'Step 2 still records the launch authorization via record-consent')
  assert.match(a, /Bash\(node \*harness\/gate-spec\.mjs \*\)/, 'audit-codebase allowed-tools grants gate-spec')
  // the confirm-not-re-ask intent is documented in the LOAD-BEARING phrasing (anchored,
  // not the ubiquitous bare word "confirm" — so deleting the WI-02 docs fails this test)
  assert.match(a, /CONFIRM-and-authorize variant|redundant tier re-ask/, 'Step 2 documents confirm-the-locked-tier, not re-ask')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

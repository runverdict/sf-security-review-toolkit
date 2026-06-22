#!/usr/bin/env node
/**
 * Standing test for the consent COUPLING (harness/record-consent.mjs + the gated
 * audit launch). A full-auto cold run skipped THREE mandatory stops by inferring
 * silence-is-yes past its scope and fanning out agents with no ask; these guard the fix.
 *
 * C1  record → verify round-trip (affirmative) → true.
 * C2  verifyConsent on a missing gate → false (fail closed).
 * C3  a recorded NEGATIVE / empty answer → verify false.
 * C4  isAffirmative yes / no / ambiguous.
 * C5  seq is clock-free monotonic (second record > first).
 * C6  AUDIT-LAUNCH FAILS CLOSED: build-audit-engine refuses (exit !=0, NO engine written)
 *     without audit-tier + audit-targetmap; with both recorded it assembles + stamps
 *     consentVerified (which the workflow template then requires before fanning out).
 * C7  SCOPE: the journey hard-bounds silence-is-yes to detected inputs, and the removed
 *     "don't wait for a go" / "decide once" language is gone.
 * C8  GATE SHAPE: the journey + audit-codebase use AskUserQuestion + record-consent per gate.
 *
 * Dependency-free: `node acceptance/test-record-consent.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { recordConsent, verifyConsent, isAffirmative } from '../harness/record-consent.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const BUILD = join(PLUGIN, 'harness', 'build-audit-engine.mjs')

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) } }
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'consent-')); dirs.push(d); return d }

console.log('record-consent + consent-coupling standing test')

check('C1 record → verify round-trip (affirmative) → true', () => {
  const d = tmp()
  assert.equal(verifyConsent('audit-tier', { target: d }), false, 'unrecorded → false')
  const rec = recordConsent('audit-tier', 'yes, standard', { target: d, question: 'tier + go-ahead?' })
  assert.equal(rec.affirmative, true)
  assert.equal(rec.gate, 'audit-tier')
  assert.equal(verifyConsent('audit-tier', { target: d }), true)
})

check('C2 verifyConsent on a missing gate → false (fail closed)', () => {
  assert.equal(verifyConsent('audit-targetmap', { target: tmp() }), false)
})

check('C3 a recorded NEGATIVE or empty answer → verify false', () => {
  const d = tmp()
  recordConsent('scanner-install', 'no, skip the install', { target: d })
  assert.equal(verifyConsent('scanner-install', { target: d }), false)
  recordConsent('throwaway-dast', '', { target: d })
  assert.equal(verifyConsent('throwaway-dast', { target: d }), false)
})

check('C4 isAffirmative yes / no / ambiguous', () => {
  for (const a of ['yes', 'y', 'go', 'proceed', 'approve the install', 'ok do it', 'yes, standard']) assert.equal(isAffirmative(a), true, `affirmative: ${a}`)
  for (const a of ['no', 'n', 'skip', 'cancel', 'do not install', "don't", '', '   ', 'maybe later']) assert.equal(isAffirmative(a), false, `not affirmative: ${JSON.stringify(a)}`)
})

check('C5 seq is clock-free monotonic', () => {
  const d = tmp()
  const a = recordConsent('audit-tier', 'yes', { target: d })
  const b = recordConsent('audit-targetmap', 'yes', { target: d })
  assert.ok(b.seq > a.seq, `seq must increase: ${a.seq} → ${b.seq}`)
})

check('C6 AUDIT-LAUNCH FAILS CLOSED without the two consents; assembles + stamps consentVerified with them', () => {
  const d = tmp()
  mkdirSync(join(d, '.security-review'), { recursive: true })
  writeFileSync(join(d, '.security-review', 'scope-input.json'), JSON.stringify({
    tier: 'standard', passNumber: 1, runDate: '2026-06-22',
    context: {}, applicable: [{ key: 'crypto-internals', targets: 'server/index.js' }], na: [],
  }))
  // No consent → refuse, exit non-zero, NOTHING written.
  let threw = false
  try { execFileSync('node', [BUILD, '--plugin', PLUGIN, '--repo', d], { stdio: 'pipe' }) } catch { threw = true }
  assert.ok(threw, 'build-audit-engine must exit non-zero without the recorded consents')
  assert.equal(existsSync(join(d, '.security-review', 'audit-engine.mjs')), false, 'no engine may be assembled without consent')
  // Record both → it assembles + stamps consentVerified.
  recordConsent('audit-tier', 'yes, standard', { target: d })
  recordConsent('audit-targetmap', 'yes, the map is right', { target: d })
  execFileSync('node', [BUILD, '--plugin', PLUGIN, '--repo', d], { encoding: 'utf8' })
  const eng = readFileSync(join(d, '.security-review', 'audit-engine.mjs'), 'utf8')
  assert.match(eng, /"consentVerified": true/, 'the assembled engine must carry consentVerified:true')
})

check('C7 SCOPE: silence-is-yes is hard-bound + the removed "don\'t wait" / "decide once" language is gone', () => {
  // whitespace-normalized so a phrase that wraps across a prose line still matches
  const jn = readFileSync(join(PLUGIN, 'skills', 'security-review-journey', 'SKILL.md'), 'utf8').toLowerCase().replace(/\s+/g, ' ')
  assert.ok(jn.includes('silence-is-yes') && jn.includes('hard-bound'), 'must state silence-is-yes IS HARD-BOUND')
  assert.ok(jn.includes('never authorizes the consent gates'), 'silence-is-yes never authorizes the consent gates')
  assert.ok(jn.includes('audit-phase stops'), 'silence-is-yes never authorizes the audit-phase stops')
  assert.ok(!/don'?t wait for/.test(jn), 'the "don\'t wait for a go" language must be removed')
  assert.ok(!jn.includes('decide once'), 'the "decide once …" language must be removed')
})

check('C8 GATE SHAPE: journey + audit-codebase use AskUserQuestion + record-consent per gate', () => {
  const j = readFileSync(join(PLUGIN, 'skills', 'security-review-journey', 'SKILL.md'), 'utf8')
  assert.match(j, /MANDATORY `AskUserQuestion`/, 'the journey gate must be a mandatory AskUserQuestion, not a printed report line')
  assert.match(j, /record-consent\.mjs --gate scanner-install/, 'scanner-install consent is recorded')
  assert.match(j, /record-consent\.mjs --gate throwaway-dast/, 'throwaway-dast consent is recorded')
  const a = readFileSync(join(PLUGIN, 'skills', 'audit-codebase', 'SKILL.md'), 'utf8')
  assert.match(a, /MANDATORY `AskUserQuestion` stop/i, 'audit Step 2/3 are mandatory AskUserQuestion stops')
  assert.match(a, /record-consent\.mjs --gate audit-tier/, 'Step 2 records audit-tier')
  assert.match(a, /record-consent\.mjs --gate audit-targetmap/, 'Step 3 records audit-targetmap')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

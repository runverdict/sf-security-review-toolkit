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
const REC = join(PLUGIN, 'harness', 'record-consent.mjs')

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

check('C8b WO-108 STOP DUALITY: audit Step 2/3 mandatory in GUIDED, auto-recorded (no stop) in full-auto-with-token', () => {
  const a = readFileSync(join(PLUGIN, 'skills', 'audit-codebase', 'SKILL.md'), 'utf8')
  // the fast-path exists and is gated on BOTH the recorded run-mode AND the recorded token
  assert.match(a, /FULL-AUTO fast-path/, 'the full-auto fast-path directive is present')
  assert.match(a, /consent\/run-mode\.json/, 'the fast-path reads the recorded run-mode')
  assert.match(a, /record-consent\.mjs --verify --gate audit-tier/, 'Step 2 verifies the recorded audit-tier token before skipping the stop')
  assert.match(a, /record-consent\.mjs --verify --gate audit-targetmap/, 'Step 3 verifies the recorded audit-targetmap token before skipping the stop')
  // the fast-path RECORDS instead of prompting — never a silent skip
  assert.match(a, /record the confirmation instead of prompting|record the approval\s+instead of prompting/i, 'the fast-path records via record-consent instead of prompting')
  // and guided (or a missing token) keeps the mandatory stop — the duality, both directions
  assert.match(a, /GUIDED mode, or ANY missing\/negative token, keeps the/i, 'guided/missing-token keeps the mandatory stop')
})

check('C9 DENY precedence: natural declines (bare "not" + n\'t contractions) fail closed', () => {
  const declines = [
    'no, do not proceed', 'do not allow', 'I do not consent', "please don't go ahead", 'no, go ahead',
    "don't proceed",
    // general negation that the pre-fix DENY leaked as affirmative:
    'not ok', 'I would not approve this', 'we should not proceed',
    "won't approve", "can't allow this", "wouldn't consent",
    'no', 'skip', 'do not proceed',
  ]
  for (const a of declines) assert.equal(isAffirmative(a), false, `a decline must never record as yes: ${JSON.stringify(a)}`)
  const yeses = ['yes', 'y', 'go ahead', 'approve the install', 'ok do it', 'yes standard']
  for (const a of yeses) assert.equal(isAffirmative(a), true, `a clear yes must record: ${JSON.stringify(a)}`)
  // and the apostrophe-mandatory contraction rule must NOT false-negate AFFIRM tokens
  // that merely END in "nt" — "grant"/"consent":
  for (const a of ['I consent', 'I grant approval']) assert.equal(isAffirmative(a), true, `must stay affirmative: ${a}`)
})

check('C10 SUBSTRATE PARITY: sequential-fallback.md carries the verifyConsent/record-consent fail-closed gate', () => {
  const sf = readFileSync(join(PLUGIN, 'harness', 'sequential-fallback.md'), 'utf8')
  assert.match(sf, /record-consent\.mjs --gate audit-tier/, 'fallback records audit-tier')
  assert.match(sf, /record-consent\.mjs --gate audit-targetmap/, 'fallback records audit-targetmap')
  assert.match(sf, /--verify --gate audit-tier/, 'fallback verifyConsents audit-tier before the first finder')
  assert.match(sf, /launch NO finder|fail closed/i, 'fallback FAILS CLOSED before the first finder Task')
  // and the consent gate is in BOTH "survives either substrate" non-negotiable lists
  assert.match(readFileSync(join(PLUGIN, 'skills', 'audit-codebase', 'SKILL.md'), 'utf8'),
    /recorded consent gate \(`audit-tier` \+ `audit-targetmap`\)/, 'audit-codebase §5 substrate list includes consent')
  assert.match(readFileSync(join(PLUGIN, 'methodology', 'audit-methodology.md'), 'utf8'),
    /recorded consent gate \(`audit-tier` \+ `audit-targetmap`\)/, 'methodology §8.2 substrate list includes consent')
})

check('C11 WI-B controlled --decision token: affirm/deny decide regardless of the answer label', () => {
  const d = tmp()
  // affirm on a label with NO affirm word AND a stray "no" (the churn case) → affirmative TRUE.
  const a = recordConsent('audit-tier', 'Exhaustive now — no caps', { target: d, decision: 'affirm', question: 'tier + go-ahead?' })
  assert.equal(a.affirmative, true, 'a controlled affirm makes it affirmative even with no "yes" word and a stray "no" in the label')
  assert.equal(a.decision, 'affirm', 'the decision token is recorded for the trail')
  assert.equal(verifyConsent('audit-tier', { target: d }), true)
  // deny decision → non-affirmative EVEN over an affirm-looking answer (controlled deny wins).
  const b = recordConsent('audit-targetmap', 'yes, looks great', { target: d, decision: 'deny' })
  assert.equal(b.affirmative, false, 'a controlled deny wins over an affirm-looking answer')
  assert.equal(verifyConsent('audit-targetmap', { target: d }), false)
})

check('C12 WI-B invalid --decision → exit 2; CLI affirm → exit 0/verify true; CLI deny → exit 3', () => {
  const d = tmp()
  // invalid decision via the exported fn throws
  assert.throws(() => recordConsent('audit-tier', 'x', { target: d, decision: 'xyz' }), /must be exactly 'affirm' or 'deny'/)
  // invalid decision via the CLI → exit 2 (clear error, nothing affirmative recorded)
  let badCode = 0
  try { execFileSync('node', [REC, '--gate', 'audit-tier', '--answer', 'Exhaustive now', '--decision', 'maybe', '--target', d], { stdio: 'pipe' }) } catch (e) { badCode = e.status }
  assert.equal(badCode, 2, 'a bad --decision exits 2')
  // CLI affirm → exit 0 + verify true
  execFileSync('node', [REC, '--gate', 'audit-tier', '--answer', 'Exhaustive now', '--decision', 'affirm', '--question', 'tier?', '--target', d], { stdio: 'pipe' })
  assert.equal(verifyConsent('audit-tier', { target: d }), true, 'CLI --decision affirm records affirmative (exit 0)')
  // CLI deny → exit 3 (the non-affirmative contract is preserved)
  let denyCode = 0
  try { execFileSync('node', [REC, '--gate', 'scanner-install', '--answer', 'Install to tmp', '--decision', 'deny', '--target', d], { stdio: 'pipe' }) } catch (e) { denyCode = e.status }
  assert.equal(denyCode, 3, 'CLI --decision deny exits 3 (not affirmative)')
  assert.equal(verifyConsent('scanner-install', { target: d }), false)
})

check('C13 WI-B back-compat: the free-text path (no --decision) is unchanged + deny-precedence holds', () => {
  const d = tmp()
  assert.equal(recordConsent('audit-tier', 'yes, standard', { target: d }).affirmative, true, 'free-text affirm unchanged')
  // a free-text record carries NO decision field (record-shape back-compat)
  assert.equal('decision' in recordConsent('audit-targetmap', 'go ahead', { target: d }), false, 'free-text records omit the decision field')
  // free-text deny-precedence still wins (a deny token beats an affirm token)
  assert.equal(recordConsent('scanner-install', 'no, go ahead', { target: d }).affirmative, false, 'free-text deny token beats an affirm token')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

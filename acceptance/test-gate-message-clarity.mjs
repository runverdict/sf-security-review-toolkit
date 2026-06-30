#!/usr/bin/env node
/**
 * Standing test for the 0.8.43 gate-message clarity fixes (PROSE only — NOT the
 * structural consent-flow consolidation, which is a separate designed slice). Two
 * cold-run operator confusions are closed:
 *
 *   (a) DEEP-AUDIT ↔ SCANNER-INSTALL `sf` cross-reference. The deployed-org deep
 *       audit installs an AUTHED, GLOBAL `sf` (for the scratch-org stand-up); the
 *       scanner-install gate ALSO installs an `sf` — but an UNAUTHED, TMP one inside
 *       `code-analyzer-stack` for the static CRUD/FLS Code Analyzer. A cold-run
 *       operator read the deep-audit "install sf" as if sf weren't otherwise being
 *       installed. The journey + render-preflight now cross-reference the two so it
 *       reads as two deliberate, separate installs.
 *
 *   (b) AUDIT-LAUNCH framing. When the tier is already recorded from the journey,
 *       gate-spec's confirm variant must frame the stop as a LAUNCH / token-spend
 *       authorization (+ the target-map approval that follows), NOT a tier
 *       re-election — so it doesn't read as "why are you asking my tier again".
 *
 * These are LLM/operator-facing PROSE guards (mirrors test-calibration-fp-patterns):
 * they assert the specific clarifying phrases are PRESENT so the fix can't silently
 * regress out — plus a FUNCTIONAL gate-spec assertion that the confirm-variant
 * payload itself carries the authorize/launch framing and the first-pass menu stays
 * the tier election (non-vacuous: the two variants differ).
 *
 * Dependency-free: `node acceptance/test-gate-message-clarity.mjs`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gateOptions } from '../harness/gate-spec.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const read = (...p) => readFileSync(join(PLUGIN, ...p), 'utf8')
const flat = (s) => s.toLowerCase().replace(/\s+/g, ' ')

let pass = 0, fail = 0
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`) }
}

console.log('gate-message-clarity standing test')

// ── (a) deep-audit ↔ scanner-install `sf` cross-reference ──────────────────────
const journey = flat(read('skills', 'security-review-journey', 'SKILL.md'))

check('journey deep-audit offer cross-references the scanner-install tmp `sf` (separate authed-global vs unauthed-tmp)', () => {
  // the deep-audit `sf` framed as a SEPARATE authed, global install...
  assert.ok(journey.includes('separate authed, global install'),
    'the deep-audit `sf` is no longer framed as a separate authed, global install')
  // ...distinct from the scanner-install gate's unauthed, tmp `sf`
  assert.ok(journey.includes('unauthed, tmp `sf`'),
    'the cross-reference to the unauthed, tmp scanner-install `sf` regressed out')
  assert.ok(journey.includes('scanner-install gate provisions'),
    'the deep-audit offer no longer names the scanner-install gate as the other `sf` install')
})

check('journey scanner-install offer cross-references the deep-audit authed-global `sf` (the inverse direction)', () => {
  assert.ok(journey.includes('this tmp `sf` is unauthed and for the static code analyzer only'),
    'the scanner-install tmp `sf` no longer disclaims being the deep-audit `sf`')
  assert.ok(journey.includes('not the authed, global `sf` the deployed-org deep audit installs'),
    'the inverse cross-reference (tmp sf is NOT the deep-audit global sf) regressed out')
})

const renderPreflight = flat(read('harness', 'render-preflight.mjs'))
check('render-preflight sf-CLI power-up line cross-references the unauthed tmp scanner-install `sf`', () => {
  assert.ok(renderPreflight.includes('separate authed, global `sf` for the scratch-org stand-up'),
    'the render-preflight sf-CLI line no longer marks it a separate authed, global install')
  assert.ok(renderPreflight.includes('not the unauthed, tmp `sf` the scan-tool install gate provisions'),
    'the render-preflight cross-reference to the scanner-install tmp `sf` regressed out')
})

// ── (b) audit-launch framing — functional (gate-spec) + prose (audit-codebase) ──
check('gate-spec audit-tier CONFIRM variant frames the stop as a launch / token-spend authorization, not a tier re-election', () => {
  const confirm = gateOptions('audit-tier', { recordedTier: 'standard' })
  const q = flat(confirm.question)
  assert.ok(q.includes('authorizes the launch') || q.includes('authorize the launch'),
    'the confirm question no longer leads with authorizing the launch')
  assert.ok(q.includes('token spend'), 'the confirm question no longer names the token spend being authorized')
  assert.ok(q.includes('target-map approval'), 'the confirm question no longer mentions the target-map approval that follows')
  assert.ok(q.includes('not a re-election'), 'the confirm question no longer states this is NOT a tier re-election')
  // the Authorize option itself carries the launch / token-spend framing
  const authorize = confirm.options.find((o) => /authorize/i.test(o.label))
  assert.ok(authorize, 'an Authorize option is present')
  const d = flat(authorize.description)
  assert.ok(d.includes('token spend'), 'the Authorize option description no longer names the token spend')
  assert.ok(d.includes('reused, not re-asked'), 'the Authorize option no longer states the tier is REUSED, not re-asked')
})

check('gate-spec audit-tier FIRST-PASS menu stays the tier election (non-vacuous: the two variants differ)', () => {
  const firstPass = gateOptions('audit-tier', {})
  const confirm = gateOptions('audit-tier', { recordedTier: 'standard' })
  // the first-pass (no recorded tier) question IS the depth election...
  assert.ok(flat(firstPass.question).includes('which audit depth'),
    'the first-pass question is no longer the tier-depth election')
  // ...and it is NOT the authorize-the-launch confirm framing
  assert.ok(!flat(firstPass.question).includes('authorize'),
    'the first-pass menu must not borrow the confirm-variant authorize framing')
  // the two variants are genuinely different surfaces
  assert.notEqual(firstPass.question, confirm.question)
})

const auditCodebase = flat(read('skills', 'audit-codebase', 'SKILL.md'))
check('audit-codebase Step 2 frames the recorded-tier stop as authorizing the LAUNCH, not a tier re-election', () => {
  assert.ok(auditCodebase.includes('authorizing the launch'),
    'audit-codebase Step 2 no longer frames the confirm stop as authorizing the launch')
  assert.ok(auditCodebase.includes('not a tier re-election'),
    'audit-codebase Step 2 no longer says this is NOT a tier re-election')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

#!/usr/bin/env node
/**
 * Standing test for the WO-108 prompt diet — 13 full-auto stops → 2 screens.
 * The journey/skill flow is LLM prose (there is no journey engine to mock), so
 * this locks the flow with what IS mechanical: grep-style directive-presence
 * assertions over the SKILL files (the same prose-guard pattern
 * test-prose-hygiene.mjs uses) plus the frozen-catalog cross-checks. The
 * engine-level halves of the diet are locked elsewhere: the operatorConfirmed
 * SCI join in test-sci.mjs (PP*), the app-root enumerator in
 * test-enumerate-app-roots.mjs.
 *
 * PD1  journey: the ONE batched full-auto consent screen exists and records
 *      ALL FIVE fail-closed tokens via record-consent (audit-tier,
 *      audit-targetmap, scanner-install, sf-deep-audit-ops, throwaway-dast) —
 *      full invocation form with --decision and --answer.
 * PD2  journey: the run-mode election is RECORDED so downstream skills can
 *      gate their full-auto fast-paths on the recorded mode.
 * PD3  journey: version-to-install is deterministic (highest released 04t,
 *      surfaced as a note) — and NO version gate exists in GATE_CATALOG.
 * PD4  audit-codebase: Step 2 AND Step 3 gate their asks on
 *      full-auto && token-recorded (auto-record, no stop) while GUIDED keeps
 *      the mandatory AskUserQuestion stops.
 * PD5  scope-submission: the partner-program answers DEFER to
 *      compile-submission in full-auto; scope-confirm auto-records with the
 *      summary as a note; the clarify-detection carve-out keeps its ask.
 * PD6  the value-lock invariants held: GATE_CATALOG is frozen, unedited in
 *      shape (consent ⟺ kind:'consent', every consent gate keeps its
 *      safeDefault decline) — the batched screen is journey orchestration,
 *      not a catalog change.
 *
 * Dependency-free: `node acceptance/test-prompt-diet.mjs`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GATE_CATALOG } from '../harness/gate-spec.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const read = (...p) => readFileSync(join(PLUGIN, ...p), 'utf8')

let pass = 0, fail = 0
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) } }

const journey = read('skills', 'security-review-journey', 'SKILL.md')
const audit = read('skills', 'audit-codebase', 'SKILL.md')
const scope = read('skills', 'scope-submission', 'SKILL.md')
const compile = read('skills', 'compile-submission', 'SKILL.md')

console.log('prompt-diet (WO-108) standing test')

check('PD1 journey: ONE batched full-auto consent screen recording ALL FIVE fail-closed tokens', () => {
  assert.match(journey, /batched consent screen/i, 'the batched consent screen is named')
  assert.match(journey, /exactly TWO screens/i, 'the two-screen full-auto budget is stated')
  assert.match(journey, /proceeds uninterrupted/i, 'the uninterrupted-after-batch contract is stated')
  // all five fail-closed tokens are recorded via record-consent in the journey
  for (const gate of ['audit-tier', 'audit-targetmap', 'scanner-install', 'sf-deep-audit-ops', 'throwaway-dast']) {
    assert.match(journey, new RegExp(`record-consent\\.mjs --gate ${gate}\\b`), `the journey records ${gate} via record-consent`)
  }
  // full invocation form — --answer is REQUIRED (record-consent exits 2 without it)
  assert.match(journey, /--answer.*is\s+REQUIRED|`--answer` is\s+REQUIRED/s, 'the full-invocation (--answer required) rule is stated')
  assert.match(journey, /record-consent\.mjs --gate audit-targetmap --decision affirm --question .+--answer .+--target/, 'audit-targetmap is recorded with the FULL invocation form')
  // Q1 rides the launch authorization for the COMPUTED target map
  assert.match(journey, /Launch the audit \(tier \+ target map\)/, 'Q1 is the launch (tier + target map) question')
  assert.match(journey, /COMPUTED by `render-target-map\.mjs`, never authored/, 'the map rides the authorization because it is computed, not authored')
  // batching never skips an ask
  assert.match(journey, /batching[^.]*never skips an ask|never skips an ask/i, 'batching-consolidates-screens-never-skips-asks is stated')
})

check('PD2 journey: the run-mode election is RECORDED for downstream full-auto gating', () => {
  assert.match(journey, /record-consent\.mjs --gate run-mode/, 'run-mode is recorded via record-consent')
  assert.match(journey, /consent\/run-mode\.json/, 'the recorded-mode file downstream skills read is named')
})

check('PD3 journey: version-to-install is deterministic — no invented gate', () => {
  assert.match(journey, /version to install is NEVER a question/i, 'the never-a-question rule is stated')
  assert.match(journey, /highest released `04t`/, 'the deterministic resolution (highest released 04t) is stated')
  assert.match(journey, /NO version\s+gate in `gate-spec\.mjs`'s catalog|NO version gate/, 'states there is no version gate to render')
  // and the catalog really has none — the invented prompt has nothing to render
  assert.ok(!Object.keys(GATE_CATALOG).some((g) => /version/i.test(g)), 'GATE_CATALOG carries no version gate')
})

check('PD4 audit-codebase: Step 2 + Step 3 gate on full-auto && token-recorded; GUIDED keeps the stops', () => {
  // Step 2: fast-path verifies the recorded audit-tier token
  assert.match(audit, /FULL-AUTO fast-path/, 'the fast-path directive is present')
  assert.match(audit, /record-consent\.mjs --verify --gate audit-tier/, 'Step 2 verifies the recorded audit-tier token')
  assert.match(audit, /consent\/run-mode\.json/, 'the recorded run-mode is what gates the fast-path')
  // Step 3: fast-path verifies the recorded audit-targetmap token + still shows the map
  assert.match(audit, /record-consent\.mjs --verify --gate audit-targetmap/, 'Step 3 verifies the recorded audit-targetmap token')
  assert.match(audit, /VERBATIM as a NOTE/, 'the map is still shown verbatim as a correctable note in full-auto')
  // GUIDED (or missing token) keeps the mandatory stops
  assert.match(audit, /MANDATORY `AskUserQuestion` stop/i, 'the mandatory stop survives for guided')
  assert.match(audit, /GUIDED mode, or ANY missing\/negative token, keeps the/i, 'the fast-path is token-gated, never unconditional')
})

check('PD5 scope-submission: partner-program defers to compile; scope-confirm auto-records with the summary as a note', () => {
  assert.match(scope, /FULL-AUTO deferral/, 'the partner-program deferral directive is present')
  assert.match(scope, /compile-submission/, 'the deferral names where the asks land')
  assert.match(scope, /not-recorded/i, 'phase 0 leaves the deferred answers not-recorded (rendered honestly)')
  assert.match(scope, /auto-record/i, 'scope-confirm auto-records in full-auto')
  assert.match(scope, /summary emitted as a note|summary as a NOTE/i, 'the scope summary is emitted as a note in full-auto')
  assert.match(scope, /clarify-detection[`\s]+ambiguity/, 'the clarify-detection audit-blocking carve-out survives')
  // and the guided asks stay wired (the SG8 contract is not weakened by the deferral)
  assert.match(scope, /gate-spec\.mjs --gate partner-program --sub-gate agreement/, 'guided still asks through the pinned sub-gates')
  assert.match(scope, /gate-spec\.mjs --gate scope-confirm/, 'guided still renders the scope-confirm gate')
})

check('PD6 value-lock: the batched screen changed NO gate definition (frozen catalog, consent ⟺ kind, safeDefault declines)', () => {
  assert.ok(Object.isFrozen(GATE_CATALOG), 'GATE_CATALOG is frozen')
  for (const [gate, spec] of Object.entries(GATE_CATALOG)) {
    assert.equal(!!spec.consent, spec.kind === 'consent', `${gate}: consent ⟺ kind:'consent' held`)
    if (spec.consent) {
      assert.ok(spec.safeDefault && spec.safeDefault.decision === 'deny', `${gate}: the safeDefault decline survived`)
    }
  }
  // the five journey-recorded fail-closed consents: four catalog consent gates +
  // audit-targetmap (a record-consent token by NAME, deliberately not a catalog entry)
  for (const g of ['audit-tier', 'scanner-install', 'sf-deep-audit-ops', 'throwaway-dast']) {
    assert.equal(GATE_CATALOG[g] && GATE_CATALOG[g].kind, 'consent', `${g} stays a catalog consent gate`)
  }
  assert.ok(!('audit-targetmap' in GATE_CATALOG), 'audit-targetmap stays a token name, not a new catalog gate')
})

check('PD7 compile-submission: the deferred partner-program asks land at the SCI step', () => {
  assert.match(compile, /partner-program answers the journey deferred/i, 'the deferred-asks step is present')
  assert.match(compile, /gate-spec\.mjs --gate partner-program --sub-gate/, 'compile renders the pinned sub-gates')
  assert.match(compile, /--no-package/, 'the promoted no-package variant is carried')
  assert.match(compile, /never fabricate\s+a `true`/i, 'a declined answer is never fabricated')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

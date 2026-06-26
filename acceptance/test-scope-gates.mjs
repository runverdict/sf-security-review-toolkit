#!/usr/bin/env node
/**
 * Standing test for the scope-submission GATES (harness/gate-spec.mjs Slice 5 entries —
 * WI-05/30/31/32/06). The reports half of WI-06 (the renders) shipped in 0.8.25; this guards
 * the gates half: the partner-program preflight family, the live-endpoint probe CONSENT, the
 * NEED-FROM-YOU clarification, the listing-type/tenancy closed choices, and the final
 * scope-confirm. The option sets were freehand prose in scope-submission; gate-spec PINS them,
 * and this test keeps them pinned + keeps the two semantic classes honest.
 *
 * SG1  determinism — same (gate, facts) twice → byte-identical (fn + CLI).
 * SG2  golden — each gate's option labels + decisions + load-bearing VERBATIM clauses are pinned.
 * SG3  fail-closed — mcp-probe with no url / clarify-detection with no element / partner-program
 *      with a missing/unknown subGate each THROW; a malformed option / bad decision THROWS.
 * SG4  force-injection — the decline is present on the two CONSENT gates (mcp-probe, scope-confirm)
 *      even though their selector omits it; the ANSWER gates get NO injected decline.
 * SG5  semantics distinction — kind taxonomy (consent vs answer); the CONSENT gates' decisions
 *      round-trip through the real recordConsent; the ANSWER gates carry the recorded polarity
 *      and are NOT consent (the driver records the selection into the manifest, not record-consent).
 * SG6  the promoted gate offers N/A ONLY when no package element (--no-package / facts.noPackage).
 * SG7  mcp-probe renders a $-bearing URL LITERALLY (no replace-pattern expansion).
 * SG8  wiring — scope-submission grants gate-spec + record-consent + references each gate at its
 *      step and states the record-via-record-consent / render-verbatim contract.
 *
 * Dependency-free: `node acceptance/test-scope-gates.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { gateOptions, GATE_CATALOG, PARTNER_PROGRAM_SUBGATES } from '../harness/gate-spec.mjs'
import { recordConsent, verifyConsent } from '../harness/record-consent.mjs'
import { PREFLIGHT_GATES } from '../harness/render-scope-summary.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'gate-spec.mjs')

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) } }
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'scopegate-')); dirs.push(d); return d }
const labelsDecisions = (p) => p.options.map((o) => [o.label, o.decision])
const labels = (p) => p.options.map((o) => o.label)

const SUBGATES = ['agreement', 'pbo', 'promoted', 'namespace', 'listing', 'contacts']
const SUBGATE_HEADER = {
  agreement: 'Partner agreement', pbo: 'Partner Business Org', promoted: 'Package promoted',
  namespace: 'Namespace', listing: 'Listing', contacts: 'Review contacts',
}

console.log('scope-submission gates (Slice 5) standing test')

check('SG1 determinism: every new gate, same (gate, facts) twice → byte-identical (fn + CLI)', () => {
  const cases = [
    ['mcp-probe', { url: 'https://x.test/mcp' }],
    ['scope-confirm', {}],
    ['partner-program', { subGate: 'agreement' }],
    ['partner-program', { subGate: 'promoted', noPackage: true }],
    ['clarify-detection', { element: 'mcp-server' }],
    ['listing-type', {}],
    ['tenancy', {}],
  ]
  for (const [gate, facts] of cases) {
    assert.equal(JSON.stringify(gateOptions(gate, facts)), JSON.stringify(gateOptions(gate, facts)), `${gate} fn must be byte-identical`)
  }
  // CLI determinism via the convenience flags
  const a = execFileSync('node', [CLI, '--gate', 'mcp-probe', '--url', 'https://x.test/mcp'], { encoding: 'utf8' })
  const b = execFileSync('node', [CLI, '--gate', 'mcp-probe', '--url', 'https://x.test/mcp'], { encoding: 'utf8' })
  assert.equal(a, b, 'mcp-probe CLI must be byte-identical')
  const c = execFileSync('node', [CLI, '--gate', 'partner-program', '--sub-gate', 'promoted', '--no-package'], { encoding: 'utf8' })
  const d = execFileSync('node', [CLI, '--gate', 'partner-program', '--sub-gate', 'promoted', '--no-package'], { encoding: 'utf8' })
  assert.equal(c, d, 'partner-program CLI must be byte-identical')
})

check('SG2 golden: mcp-probe — 2 affirm probe options (staging/production) + force-injected decline', () => {
  const p = gateOptions('mcp-probe', { url: 'https://staging.example.com/mcp' })
  assert.equal(p.consent, true)
  assert.equal(p.kind, 'consent')
  assert.deepEqual(labelsDecisions(p), [
    ['Probe — this is a STAGING endpoint', 'affirm'],
    ['Probe — this is a PRODUCTION endpoint', 'affirm'],
    ['Skip — do not probe', 'deny'],
  ])
  // the URL fills both probe descriptions; the "never silently" production framing is verbatim
  assert.match(p.options[0].description, /Confirm https:\/\/staging\.example\.com\/mcp is a STAGING endpoint/)
  assert.match(p.options[1].description, /Production is probed ONLY with this explicit confirmation, never silently/)
})

check('SG2 golden: scope-confirm — {Confirm & proceed, Correct the scope, Cancel} mirroring WI-02', () => {
  const p = gateOptions('scope-confirm', {})
  assert.equal(p.consent, true)
  assert.equal(p.kind, 'consent')
  assert.equal(p.header, 'Confirm scope')
  assert.deepEqual(labelsDecisions(p), [
    ['Confirm scope & proceed (recommended)', 'affirm'],
    ['Correct the scope', 'deny'],
    ['Cancel — do not proceed', 'deny'],
  ])
  // Correct + Cancel are both deny (fail-safe non-proceed); only Confirm authorizes
  assert.match(p.options[0].description, /cheapest\s+moment to fix scope/)
})

check('SG2 golden: partner-program — each sub-gate is a FIXED Yes/No, distinct header', () => {
  for (const sub of SUBGATES) {
    const p = gateOptions('partner-program', { subGate: sub })
    assert.equal(p.consent, false, `${sub} is an answer gate, not consent`)
    assert.equal(p.kind, 'answer')
    assert.equal(p.header, SUBGATE_HEADER[sub], `${sub} header`)
    assert.deepEqual(labelsDecisions(p), [['Yes', 'affirm'], ['No', 'deny']], `${sub} Yes/No polarity`)
    assert.ok(p.question && p.question.length > 5, `${sub} carries a fixed question`)
  }
  // a load-bearing "why it blocks" clause is verbatim in the No description
  assert.match(gateOptions('partner-program', { subGate: 'contacts' }).options[1].description, /stall the clock silently/)
  assert.match(gateOptions('partner-program', { subGate: 'promoted' }).options[1].description, /beta 2GP|released version/i)
})

check('SG2 golden: clarify-detection — present/absent/unsure, the element fills the question', () => {
  const p = gateOptions('clarify-detection', { element: 'mcp-server' })
  assert.equal(p.kind, 'answer')
  assert.equal(p.consent, false)
  assert.deepEqual(labelsDecisions(p), [
    ['Present — include it', 'affirm'],
    ['Not present — exclude it', 'deny'],
    ['Unsure — investigate first', 'deny'],
  ])
  assert.match(p.question, /Detection is ambiguous for "mcp-server"/)
  assert.match(p.options[0].description, /"mcp-server" IS part of the submission/)
})

check('SG2 golden: listing-type (3 categorical, all affirm) + tenancy (2 categorical, all affirm)', () => {
  const lt = gateOptions('listing-type', {})
  assert.equal(lt.kind, 'answer')
  assert.deepEqual(labelsDecisions(lt), [['Managed package', 'affirm'], ['MCP server', 'affirm'], ['Both', 'affirm']])
  const tn = gateOptions('tenancy', {})
  assert.equal(tn.kind, 'answer')
  assert.deepEqual(labelsDecisions(tn), [['Multi-tenant', 'affirm'], ['Single-tenant per deployment', 'affirm']])
})

check('SG3 fail-closed: mcp-probe w/o url, clarify-detection w/o element, partner-program w/o subGate all THROW', () => {
  assert.throws(() => gateOptions('mcp-probe', {}), /mcp-probe requires facts\.url/)
  assert.throws(() => gateOptions('mcp-probe', { url: '   ' }), /mcp-probe requires facts\.url/)
  assert.throws(() => gateOptions('clarify-detection', {}), /clarify-detection requires facts\.element/)
  assert.throws(() => gateOptions('partner-program', {}), /partner-program requires facts\.subGate/)
  assert.throws(() => gateOptions('partner-program', { subGate: 'nope' }), /partner-program requires facts\.subGate/)
})

check('SG3 fail-closed (CLI): a throwing gate exits non-zero with the message on stderr', () => {
  for (const args of [['--gate', 'mcp-probe'], ['--gate', 'clarify-detection'], ['--gate', 'partner-program', '--sub-gate', 'nope']]) {
    let threw = false
    try { execFileSync('node', [CLI, ...args], { encoding: 'utf8', stdio: 'pipe' }) }
    catch (e) { threw = true; assert.ok(e.status === 2, 'exit 2'); assert.match(String(e.stderr), /gate-spec:/) }
    assert.ok(threw, `${args.join(' ')} must exit non-zero`)
  }
})

check('SG4 force-injection: the decline is on the two CONSENT gates, NOT on the ANSWER gates', () => {
  // CONSENT gates carry their force-injected safeDefault decline (a deny)
  for (const [gate, facts] of [['mcp-probe', { url: 'https://x.test/mcp' }], ['scope-confirm', {}]]) {
    const opts = gateOptions(gate, facts).options
    const sd = opts.find((o) => o.label === GATE_CATALOG[gate].safeDefault.label)
    assert.ok(sd && sd.decision === 'deny', `${gate} must carry its force-injected decline`)
  }
  // ANSWER gates get NO injected decline — their option set is exactly the selector's (no extra
  // safeDefault appended). Proven by: no option matches a "Skip/Cancel — …" injected decline shape,
  // and the catalog entry has no safeDefault to inject.
  for (const [gate, facts] of [['partner-program', { subGate: 'agreement' }], ['clarify-detection', { element: 'x' }], ['listing-type', {}], ['tenancy', {}]]) {
    assert.ok(!GATE_CATALOG[gate].safeDefault, `${gate} (answer) has no safeDefault to force-inject`)
    const opts = gateOptions(gate, facts).options
    assert.ok(!opts.some((o) => /^(Skip|Cancel) —/.test(o.label)), `${gate} must NOT get an injected decline`)
  }
})

check('SG5 semantics: kind taxonomy is consistent across the whole catalog (consent ⟺ kind:consent)', () => {
  for (const [gate, spec] of Object.entries(GATE_CATALOG)) {
    assert.ok(['consent', 'election', 'answer'].includes(spec.kind), `${gate} has a valid kind`)
    assert.equal(!!spec.consent, spec.kind === 'consent', `${gate}: consent must agree with kind`)
  }
  // the new gates land in the right class
  assert.equal(GATE_CATALOG['mcp-probe'].kind, 'consent')
  assert.equal(GATE_CATALOG['scope-confirm'].kind, 'consent')
  for (const g of ['partner-program', 'clarify-detection', 'listing-type', 'tenancy']) assert.equal(GATE_CATALOG[g].kind, 'answer')
})

check('SG5 CONSENT-gate decisions round-trip through the real recordConsent (affirm→yes, deny→no)', () => {
  const d = tmp()
  for (const [gate, facts] of [['mcp-probe', { url: 'https://x.test/mcp' }], ['scope-confirm', {}]]) {
    for (const o of gateOptions(gate, facts).options) {
      const rec = recordConsent('scopegate-probe', o.label, { target: d, decision: o.decision })
      assert.equal(rec.affirmative, o.decision === 'affirm', `${gate} '${o.label}': decision must round-trip`)
    }
  }
  // a recorded deny keeps verify FALSE (the fail-safe non-proceed end to end)
  recordConsent('scope-confirm', 'Cancel — do not proceed', { target: d, decision: 'deny' })
  assert.equal(verifyConsent('scope-confirm', { target: d }), false)
  recordConsent('scope-confirm', 'Confirm scope & proceed (recommended)', { target: d, decision: 'affirm' })
  assert.equal(verifyConsent('scope-confirm', { target: d }), true)
})

check('SG5 ANSWER-gate decision is the recorded POLARITY (present/yes→affirm, absent/no/unsure→deny)', () => {
  // partner-program Yes→affirm (records true), No→deny (records false)
  const pp = gateOptions('partner-program', { subGate: 'agreement' })
  assert.equal(pp.options.find((o) => o.label === 'Yes').decision, 'affirm')
  assert.equal(pp.options.find((o) => o.label === 'No').decision, 'deny')
  // clarify-detection present→affirm (adds element), absent/unsure→deny (does not add)
  const cd = gateOptions('clarify-detection', { element: 'x' })
  assert.equal(cd.options[0].decision, 'affirm')
  assert.ok(cd.options.slice(1).every((o) => o.decision === 'deny'))
})

check('SG6 promoted N/A: offered ONLY when no package element (facts.noPackage / --no-package)', () => {
  const withPkg = gateOptions('partner-program', { subGate: 'promoted' })
  assert.deepEqual(labels(withPkg), ['Yes', 'No'], 'with a package: just Yes/No')
  const noPkg = gateOptions('partner-program', { subGate: 'promoted', noPackage: true })
  assert.deepEqual(labels(noPkg), ['Yes', 'No', 'N/A — no package in scope'], 'no package: Yes/No/N-A')
  assert.equal(noPkg.options[2].decision, 'deny')
  // the N/A option is promoted-only — another sub-gate with noPackage does NOT grow an N/A
  const otherNoPkg = gateOptions('partner-program', { subGate: 'agreement', noPackage: true })
  assert.deepEqual(labels(otherNoPkg), ['Yes', 'No'], 'N/A is the promoted gate only')
})

check('SG7 mcp-probe renders a $-bearing URL LITERALLY (function-replacer, no pattern expansion)', () => {
  const p = gateOptions('mcp-probe', { url: "https://x.test/mcp?t=$'$&z" })
  assert.ok(p.options[0].description.includes("https://x.test/mcp?t=$'$&z"), '$-patterns render literally, not expand')
})

check('SG7b clarify-detection renders a $-bearing ELEMENT LITERALLY (the third free-text fill site)', () => {
  // a regression from the function-replacer to a string-replacer would expand $&/$'/$` in an element
  // name — the same "scanner-install lesson" the repo locks at every fill site.
  const p = gateOptions('clarify-detection', { element: "a$'$&b" })
  assert.ok(p.question.includes("a$'$&b"), '$-patterns in the element render literally in the question')
  assert.ok(p.options[0].description.includes("a$'$&b"), '...and in the option description')
})

check('SG8 wiring: scope-submission grants the harnesses + references each gate at its step + the contract', () => {
  const skill = readFileSync(join(PLUGIN, 'skills', 'scope-submission', 'SKILL.md'), 'utf8')
  // allowed-tools grants
  assert.match(skill, /Bash\(node \*harness\/gate-spec\.mjs \*\)/, 'grants gate-spec')
  assert.match(skill, /Bash\(node \*harness\/record-consent\.mjs \*\)/, 'grants record-consent')
  assert.match(skill, /Bash\(node \*harness\/render-scope-summary\.mjs \*\)/, 'grants render-scope-summary')
  // step 2 clarify-detection, step 3 mcp-probe (+ record-consent), step 5 partner-program, step 6
  // listing-type/tenancy, step 9 scope-confirm (+ record-consent)
  assert.match(skill, /gate-spec\.mjs --gate clarify-detection --element/, 'step 2 wires clarify-detection')
  assert.match(skill, /gate-spec\.mjs --gate mcp-probe --url/, 'step 3 wires mcp-probe')
  assert.match(skill, /record-consent\.mjs --gate mcp-probe/, 'step 3 records the probe consent')
  // ALL SIX partner-program sub-gates are invoked + ALL SIX manifest keys mapped (dropping five of
  // either would otherwise leave a single-occurrence grep green)
  for (const sub of SUBGATES) {
    assert.match(skill, new RegExp(`gate-spec\\.mjs --gate partner-program --sub-gate ${sub}\\b`), `step 5 wires sub-gate ${sub}`)
  }
  for (const def of Object.values(PARTNER_PROGRAM_SUBGATES)) {
    assert.ok(skill.includes(def.manifestKey), `step 5 maps the manifest key ${def.manifestKey}`)
  }
  // the promoted N/A is recorded distinctly as the "n/a" sentinel, NOT false (the major-fix contract)
  assert.match(skill, /packagePromoted: "n\/a"/, 'step 5 documents the N/A → "n/a" sentinel recording (not false)')
  assert.match(skill, /gate-spec\.mjs --gate listing-type/, 'step 6 wires listing-type')
  assert.match(skill, /gate-spec\.mjs --gate tenancy/, 'step 6 wires tenancy')
  assert.match(skill, /gate-spec\.mjs --gate scope-confirm/, 'step 9 wires scope-confirm')
  assert.match(skill, /record-consent\.mjs --gate scope-confirm/, 'step 9 records the scope confirmation')
  // the contract language: answer gates record into the manifest (not record-consent); render verbatim
  assert.match(skill, /NOT through record-consent/, 'answer gates are recorded into the manifest, not record-consent')
  assert.match(skill, /VERBATIM/, 'states the render-verbatim contract')
})

check('SG9 writer/reader key cross-lock: PARTNER_PROGRAM_SUBGATES.manifestKey == render-scope-summary PREFLIGHT_GATES keys', () => {
  // The partner-program manifest-key contract is defined twice — the WRITER (gate-spec) and the
  // READER (render-scope-summary). If they drift, a gate the operator confirmed renders "(not
  // recorded)" in the Step-9 summary (a silent under-report). Lock the two sets equal.
  const writer = new Set(Object.values(PARTNER_PROGRAM_SUBGATES).map((d) => d.manifestKey))
  const reader = new Set(PREFLIGHT_GATES.map(([k]) => k))
  assert.equal(writer.size, reader.size, 'same number of keys on both sides')
  for (const k of writer) assert.ok(reader.has(k), `reader (PREFLIGHT_GATES) must carry writer key ${k}`)
  for (const k of reader) assert.ok(writer.has(k), `writer (PARTNER_PROGRAM_SUBGATES) must carry reader key ${k}`)
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

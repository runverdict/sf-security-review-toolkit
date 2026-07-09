#!/usr/bin/env node
/**
 * Standing test for the Submission Completeness Index (harness/compute-sci.mjs).
 *
 * Guards the two properties the SCI's credibility rests on, which were only
 * ever OBSERVED once during validation:
 *   A1 — FAIL CLOSED: an empty/missing manifest must NOT produce a
 *        "NO-SURPRISES READY" verdict (a readiness tool that defaults to ready
 *        on missing input is dangerous). The 0.4.1 fix; a refactor of the
 *        `!applicable.length` branch could silently re-open it.
 *   A2 — DETERMINISM: same inputs + same --date ⇒ byte-identical stdout. A
 *        future Date.now()/unordered Object.keys() would break the "re-run
 *        yields the same verdict" promise the verdict text itself prints.
 *
 * Dependency-free: `node acceptance/test-sci.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { parseBaselineApplies, computeApplicable } from '../harness/applicable-requirements.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const SCI = join(PLUGIN, 'harness', 'compute-sci.mjs')

function runSci(target) {
  const out = execFileSync('node', [SCI, '--target', target, '--plugin', PLUGIN, '--date', '2026-06-16', '--json'], { encoding: 'utf8' })
  return { raw: out, json: JSON.parse(out) }
}
function fixture(setup) {
  const dir = mkdtempSync(join(tmpdir(), 'sci-test-'))
  mkdirSync(join(dir, '.security-review'), { recursive: true })
  setup(dir)
  return dir
}
const write = (dir, name, obj) => writeFileSync(join(dir, '.security-review', name), JSON.stringify(obj))

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

console.log('compute-sci standing test')

// A1a — completely empty target (no .security-review files at all)
check('A1 fail-closed: empty target → NOT NO-SURPRISES READY, completeness 0', () => {
  const d = fixture(() => {}); dirs.push(d)
  const { json } = runSci(d)
  assert.notEqual(json.band, 'NO-SURPRISES READY', 'must not default to ready on missing input')
  assert.equal(json.completeness_pct, 0)
  assert.equal(json.band, 'NOT READY')
})

// A1b — manifest present but applicableBaselineIds empty
check('A1 fail-closed: empty applicable set → NOT NO-SURPRISES READY, completeness 0', () => {
  const d = fixture((dir) => {
    write(dir, 'scope-manifest.json', { applicableBaselineIds: [], elements: [] })
    write(dir, 'audit-ledger.json', { findings: [] })
  }); dirs.push(d)
  const { json } = runSci(d)
  assert.notEqual(json.band, 'NO-SURPRISES READY')
  assert.equal(json.completeness_pct, 0)
})

// A2 — determinism: a non-trivial state, run twice, byte-identical stdout.
// elements deliberately empty: this fixture pins an ARBITRARY stored applicable
// set (the property under test is byte-determinism, not scope consistency);
// with elements present, the stale-manifest refusal would correctly reject the
// inconsistent pair — the S checks below cover that path.
check('A2 determinism: identical inputs + fixed date → byte-identical stdout', () => {
  const d = fixture((dir) => {
    write(dir, 'scope-manifest.json', {
      applicableBaselineIds: ['scan-code-analyzer-invocation', 'artifact-authn-authz-flow-doc', 'process-review-fee'],
      elements: [],
    })
    write(dir, 'audit-ledger.json', {
      findings: [
        { id: 'a1', dimension: 'apex-exposed-surface', status: 'confirmed', adjusted_severity: 'high', title: 'x', file: 'a.cls:1' },
        { id: 'b2', dimension: 'crypto-internals', status: 'confirmed', adjusted_severity: 'critical', title: 'y', file: 'b.js:2' },
      ],
    })
    mkdirSync(join(dir, '.security-review', 'evidence'), { recursive: true })
    writeFileSync(join(dir, '.security-review', 'evidence', 'index.json'),
      JSON.stringify({ entries: [{ ref_type: 'requirement', ref_id: 'scan-code-analyzer-invocation', disposition: 'satisfied', verified: { value: true, how: 'ran it' }, reviewer_reproducible: true }] }))
  }); dirs.push(d)
  const a = runSci(d).raw
  const b = runSci(d).raw
  assert.equal(a, b, 'two runs with the same input + --date diverged')
  // and the run echoes the pinned date (date-pinning contract)
  assert.equal(JSON.parse(a).run_date, '2026-06-16')
})

// A4 — baseline-currency band floor. A clean, fully-satisfied state of
// verified_primary (2026-06-12) requirements: fresh → NO-SURPRISES READY; run
// 18 months later (baseline rotted) → the floor caps the band to NOT READY, and
// crucially completeness % is UNCHANGED (currency caps confidence, not the score).
// Use a SYNTHETIC baseline (a temp --plugin dir) so the floor tests control
// verification/last_verified themselves and are NOT coupled to the live
// baseline's mutable dates — a maintainer re-verifying the shipped baseline
// must not silently break these. compute-sci reads <plugin>/baseline/requirements-baseline.yaml
// for per-req verification/last_verified/severity_if_missing.
function synthPlugin(reqs) {
  const dir = mkdtempSync(join(tmpdir(), 'sci-plugin-'))
  mkdirSync(join(dir, 'baseline'), { recursive: true })
  const yaml = reqs
    .map((r) =>
      `- id: ${r.id}\n  applies_to: [managed-package]\n  severity_if_missing: ${r.sev || 'major'}\n` +
      `  verification: ${r.verification || 'verified_primary'}\n  last_verified: ${r.last_verified ? `"${r.last_verified}"` : 'null'}\n`
    )
    .join('')
  writeFileSync(join(dir, 'baseline', 'requirements-baseline.yaml'), yaml)
  return dir
}
function runSciDate(target, date, plugin) {
  const out = execFileSync('node', [SCI, '--target', target, '--plugin', plugin, '--date', date, '--json'], { encoding: 'utf8' })
  return JSON.parse(out)
}
// 3 verified_primary, non-blocker reqs, all last_verified a controlled date.
const A4_REQS = ['req-a', 'req-b', 'req-c']
const synthDir = synthPlugin(A4_REQS.map((id) => ({ id, verification: 'verified_primary', last_verified: '2026-06-12' })))
dirs.push(synthDir)
const a4dir = fixture((dir) => {
  write(dir, 'scope-manifest.json', { applicableBaselineIds: A4_REQS, elements: [{ type: 'managed-package' }] })
  write(dir, 'audit-ledger.json', { findings: [] })
  mkdirSync(join(dir, '.security-review', 'evidence'), { recursive: true })
  writeFileSync(join(dir, '.security-review', 'evidence', 'index.json'),
    JSON.stringify({ entries: A4_REQS.map((id) => ({ ref_type: 'requirement', ref_id: id, disposition: 'satisfied', verified: { value: true, how: 'test' }, reviewer_reproducible: true })) }))
})
dirs.push(a4dir)

check('A4 fresh baseline → NO-SURPRISES READY at 100% completeness', () => {
  const j = runSciDate(a4dir, '2026-06-16', synthDir)
  assert.equal(j.completeness_pct, 100)
  assert.equal(j.band, 'NO-SURPRISES READY')
  assert.equal(j.freshness.hard_stale, 0)
})

check('A4 currency floor: aged baseline → band capped to NOT READY, completeness UNCHANGED', () => {
  const j = runSciDate(a4dir, '2027-12-01', synthDir)
  assert.equal(j.band, 'NOT READY', 'rotted baseline must cap confidence')
  assert.equal(j.completeness_pct, 100, 'completeness must NOT be docked for maintainer currency — false-incompleteness guard')
  assert.ok(j.freshness.hard_stale_pct >= 33)
  assert.match(j.gate_reason, /currency/i)
})

// C1 — the floor must NOT fire (and must NOT clobber the "finish materials"
// reason) when MATERIALS COMPLETE was reached because items are still MISSING.
const c1dir = fixture((dir) => {
  write(dir, 'scope-manifest.json', { applicableBaselineIds: A4_REQS, elements: [{ type: 'managed-package' }] })
  write(dir, 'audit-ledger.json', { findings: [] })
  mkdirSync(join(dir, '.security-review', 'evidence'), { recursive: true })
  // satisfy only ONE of the three → two MISSING → MATERIALS COMPLETE (not ready)
  writeFileSync(join(dir, '.security-review', 'evidence', 'index.json'),
    JSON.stringify({ entries: [{ ref_type: 'requirement', ref_id: A4_REQS[0], disposition: 'satisfied', verified: { value: true, how: 'test' }, reviewer_reproducible: true }] }))
})
dirs.push(c1dir)
check('C1: aged baseline + MISSING items → MATERIALS COMPLETE preserved, floor does NOT clobber', () => {
  const j = runSciDate(c1dir, '2027-12-01', synthDir)
  assert.equal(j.band, 'MATERIALS COMPLETE', 'must not be flipped to NOT READY by the currency floor while materials are incomplete')
  assert.ok(j.completeness_pct < 100)
  assert.doesNotMatch(j.gate_reason, /baseline currency/i, 'the finish-materials reason must survive')
  assert.match(j.gate_reason, /MISSING|finish/i)
})

// C2 — small-manifest guard: a single hard-stale req must NOT trip the floor
// (hardStale.length >= 2 required), even though 1/1 = 100% >= 33%.
// elements deliberately empty: the stored set is a deliberate SUBSET of the
// synth baseline's managed-package set, which the stale-manifest refusal would
// correctly reject if elements were present (the S checks cover that path).
const c2dir = fixture((dir) => {
  write(dir, 'scope-manifest.json', { applicableBaselineIds: [A4_REQS[1]], elements: [] })
  write(dir, 'audit-ledger.json', { findings: [] })
  mkdirSync(join(dir, '.security-review', 'evidence'), { recursive: true })
  writeFileSync(join(dir, '.security-review', 'evidence', 'index.json'),
    JSON.stringify({ entries: [{ ref_type: 'requirement', ref_id: A4_REQS[1], disposition: 'satisfied', verified: { value: true, how: 'test' }, reviewer_reproducible: true }] }))
})
dirs.push(c2dir)
check('C2: single hard-stale req → hard floor does NOT fire (needs ≥2)', () => {
  const j = runSciDate(c2dir, '2027-12-01', synthDir)
  assert.equal(j.freshness.hard_stale, 1)
  // The soft caveated cap (caveated>0) legitimately drops it to MATERIALS COMPLETE,
  // but the HARD floor (which flips to NOT READY) must NOT fire on a single stale req.
  assert.notEqual(j.band, 'NOT READY', 'one stale req must not trip the hard currency floor on a tiny manifest')
  assert.equal(j.band, 'MATERIALS COMPLETE')
  assert.doesNotMatch(j.gate_reason, /baseline currency:/i)
})

// ---------------------------------------------------------------------------
// P1 — THE CREDIT RULE (no self-grading). A requirement counts SATISFIED only on
// REVIEWER-REPRODUCIBLE evidence; a clear that rests only on the toolkit's own
// white-box static audit is statically-cleared — never headline credit, never a
// floor clear. The cold-run regression these guard: an LLM-authored evidence index
// marked auto-fail classes satisfied from its OWN static audit, inflating SCI 9%→17%.
// elements deliberately empty: these fixtures pin arbitrary stored id sets (the
// property under test is the CREDIT RULE, not scope consistency); with elements
// present, the stale-manifest refusal would correctly reject them (S checks).
function evFixture(applicable, entries, findings = []) {
  return fixture((dir) => {
    write(dir, 'scope-manifest.json', { applicableBaselineIds: applicable, elements: [] })
    write(dir, 'audit-ledger.json', { findings })
    mkdirSync(join(dir, '.security-review', 'evidence'), { recursive: true })
    writeFileSync(join(dir, '.security-review', 'evidence', 'index.json'), JSON.stringify({ entries }))
  })
}

check('P1a statically-cleared disposition → NOT credited, completeness 0, surfaced separately', () => {
  const d = evFixture(['r1'], [
    { ref_type: 'requirement', ref_id: 'r1', disposition: 'statically-cleared', verified: { value: true, how: 'white-box audit only' }, reviewer_reproducible: false, location: 'docs/security-review/audit-report-2026-06-16-pass1.md' },
  ]); dirs.push(d)
  const { json } = runSci(d)
  assert.equal(json.coverage.satisfied, 0, 'static clear must not be SATISFIED')
  assert.equal(json.coverage.statically_cleared, 1)
  assert.equal(json.completeness_pct, 0, 'static clear must not inflate the headline %')
  assert.deepEqual(json.statically_cleared_requirements, ['r1'])
  assert.notEqual(json.band, 'NO-SURPRISES READY')
})

check('P1b FAIL CLOSED: satisfied+verified but NO reviewer_reproducible flag → statically-cleared, not credited', () => {
  const d = evFixture(['r1'], [
    { ref_type: 'requirement', ref_id: 'r1', disposition: 'satisfied', verified: { value: true, how: 'audit said clean' } },
  ]); dirs.push(d)
  const { json } = runSci(d)
  assert.equal(json.coverage.satisfied, 0, 'a missing reviewer_reproducible flag must NOT credit (the self-grading guard)')
  assert.equal(json.coverage.statically_cleared, 1)
  assert.equal(json.completeness_pct, 0)
})

check('P1c reviewer-reproducible scanner clear → SATISFIED, credited, completeness 100', () => {
  const d = evFixture(['r1'], [
    { ref_type: 'requirement', ref_id: 'r1', disposition: 'satisfied', verified: { value: true, how: 'SFGE exit + report on disk' }, reviewer_reproducible: true, location: '.security-review/evidence/code-analyzer-sfge.json' },
  ]); dirs.push(d)
  const { json } = runSci(d)
  assert.equal(json.coverage.satisfied, 1)
  assert.equal(json.coverage.statically_cleared, 0)
  assert.equal(json.completeness_pct, 100)
})

// P1d — the blocker floor. A BLOCKER-severity requirement that is only statically
// cleared must keep the band BLOCKED; the SAME requirement with reviewer-reproducible
// scanner evidence clears the floor. Uses a synthetic blocker baseline.
const blockPlugin = synthPlugin([{ id: 'r-block', sev: 'blocker', verification: 'verified_primary', last_verified: '2026-06-12' }])
dirs.push(blockPlugin)
check('P1d blocker floor: statically-cleared blocker stays BLOCKED', () => {
  const d = evFixture(['r-block'], [
    { ref_type: 'requirement', ref_id: 'r-block', disposition: 'statically-cleared', verified: { value: true, how: 'audit only' }, reviewer_reproducible: false, location: 'docs/security-review/audit-report.md' },
  ]); dirs.push(d)
  const j = runSciDate(d, '2026-06-16', blockPlugin)
  assert.equal(j.blocked, true, 'an audit-only clear must NOT unblock a blocker class')
  assert.equal(j.band, 'BLOCKED')
  assert.ok(j.blocker_requirements.includes('r-block'))
})
check('P1d blocker floor: reviewer-reproducible scanner clear of the SAME blocker → unblocked', () => {
  const d = evFixture(['r-block'], [
    { ref_type: 'requirement', ref_id: 'r-block', disposition: 'satisfied', verified: { value: true, how: 'Code Analyzer clean on disk' }, reviewer_reproducible: true, location: '.security-review/evidence/code-analyzer.html' },
  ]); dirs.push(d)
  const j = runSciDate(d, '2026-06-16', blockPlugin)
  assert.equal(j.blocked, false, 'a reviewer-reproducible scanner clear must clear the blocker floor (clean-package path survives)')
  assert.notEqual(j.band, 'BLOCKED')
})

// ---------------------------------------------------------------------------
// PP — the partner-program operatorConfirmed join (WO-108). The
// process-partner-program-prerequisites requirement is automation:manual_only —
// the operator's recorded answers in the manifest ARE the evidence, and
// compute-sci must actually READ them. Before 0.8.108 they were WRITE-ONLY
// (recorded by scope-submission, rendered by render-scope-summary, consumed by
// nothing that gates), so a partner who answered "No" could still compile a
// green SCI. These checks are the load-bearing lock: a compute-sci that
// ignores operatorConfirmed goes RED here.
// ---------------------------------------------------------------------------
const PP_REQ = 'process-partner-program-prerequisites'
const ppPlugin = synthPlugin([{ id: PP_REQ, sev: 'blocker', verification: 'verified_primary', last_verified: '2026-06-12' }])
dirs.push(ppPlugin)
const PP_ALL_CONFIRMED = Object.freeze({
  partnerAgreementSigned: true, partnerConsoleAccess: true, packagePromoted: true,
  namespaceRegisteredAndLinked: true, listingCreated: true, reviewContactsDesignated: true,
})
function ppFixture(operatorConfirmed, entries = []) {
  return fixture((dir) => {
    write(dir, 'scope-manifest.json', {
      applicableBaselineIds: [PP_REQ], elements: [],
      ...(operatorConfirmed ? { operatorConfirmed } : {}),
    })
    write(dir, 'audit-ledger.json', { findings: [] })
    mkdirSync(join(dir, '.security-review', 'evidence'), { recursive: true })
    writeFileSync(join(dir, '.security-review', 'evidence', 'index.json'), JSON.stringify({ entries }))
  })
}

check('PP1 all six operatorConfirmed keys true → requirement SATISFIED, blocker floor clear', () => {
  const d = ppFixture(PP_ALL_CONFIRMED); dirs.push(d)
  const j = runSciDate(d, '2026-06-16', ppPlugin)
  assert.equal(j.coverage.satisfied, 1, 'a fully-confirmed partner-program block must SATISFY the requirement')
  assert.equal(j.blocked, false, 'the blocker floor must clear on full confirmation')
  assert.ok(!j.blocker_requirements.includes(PP_REQ))
})

check('PP2 partnerAgreementSigned:false (others true) → UNSATISFIED, stays a BLOCKER', () => {
  const d = ppFixture({ ...PP_ALL_CONFIRMED, partnerAgreementSigned: false }); dirs.push(d)
  const j = runSciDate(d, '2026-06-16', ppPlugin)
  assert.equal(j.coverage.satisfied, 0, 'an explicit operator "No" must NOT satisfy the requirement')
  assert.equal(j.blocked, true, 'an unconfirmed program gate keeps the blocker floor')
  assert.ok(j.blocker_requirements.includes(PP_REQ), 'the blocker names the requirement')
  assert.equal(j.band, 'BLOCKED')
})

check('PP3 nothing recorded → MISSING (compile-submission asks the gates there), blocked', () => {
  const d = ppFixture(null); dirs.push(d)
  const j = runSciDate(d, '2026-06-16', ppPlugin)
  assert.equal(j.coverage.satisfied, 0)
  assert.equal(j.coverage.missing, 1, 'not-recorded answers render the requirement MISSING')
  assert.equal(j.blocked, true)
})

check('PP4 packagePromoted "n/a" sentinel + others true → SATISFIED (a no-package listing is never a blocker)', () => {
  const d = ppFixture({ ...PP_ALL_CONFIRMED, packagePromoted: 'n/a' }); dirs.push(d)
  const j = runSciDate(d, '2026-06-16', ppPlugin)
  assert.equal(j.coverage.satisfied, 1, 'the promoted gate\'s "n/a" sentinel must count as confirmed')
  assert.equal(j.blocked, false)
})

check('PP4b the "n/a" sentinel is packagePromoted-ONLY — on any other key it does not confirm', () => {
  const d = ppFixture({ ...PP_ALL_CONFIRMED, listingCreated: 'n/a' }); dirs.push(d)
  const j = runSciDate(d, '2026-06-16', ppPlugin)
  assert.equal(j.coverage.satisfied, 0, '"n/a" on a non-promoted key must NOT satisfy')
  assert.equal(j.blocked, true)
})

check('PP5 an evidence-index self-attestation never satisfies the manual-only requirement, and never overrides an operator "No"', () => {
  const creditable = [{ ref_type: 'requirement', ref_id: PP_REQ, disposition: 'satisfied', verified: { value: true, how: 'asserted' }, reviewer_reproducible: true }]
  // an operator "No" with a stray creditable index row → still unsatisfied
  const dNo = ppFixture({ ...PP_ALL_CONFIRMED, partnerAgreementSigned: false }, creditable); dirs.push(dNo)
  const jNo = runSciDate(dNo, '2026-06-16', ppPlugin)
  assert.equal(jNo.coverage.satisfied, 0, 'an index row must never override an explicit operator No')
  assert.equal(jNo.blocked, true)
  // no answers at all + the index row → still MISSING (the answers are the only evidence)
  const dNone = ppFixture(null, creditable); dirs.push(dNone)
  const jNone = runSciDate(dNone, '2026-06-16', ppPlugin)
  assert.equal(jNone.coverage.satisfied, 0, 'an index row alone must not satisfy the manual-only requirement')
  assert.equal(jNone.coverage.missing, 1)
})

check('PP6 wiring: compile-submission carries the deferred asks (gate-spec grant + the pinned sub-gate render + the manifest recording)', () => {
  const skill = readFileSync(join(PLUGIN, 'skills', 'compile-submission', 'SKILL.md'), 'utf8')
  assert.match(skill, /Bash\(node \*harness\/gate-spec\.mjs \*\)/, 'compile-submission allowed-tools grants gate-spec')
  assert.match(skill, /gate-spec\.mjs --gate partner-program --sub-gate/, 'compile-submission renders the pinned partner-program sub-gates')
  assert.match(skill, /operatorConfirmed/, 'compile-submission records into manifest operatorConfirmed')
  assert.match(skill, /NOT through record-consent/, 'answer gates are recorded into the manifest, not record-consent')
  assert.match(skill, /"n\/a"/, 'the promoted N/A sentinel recording is documented')
})

// ---------------------------------------------------------------------------
// S — the stale-scope-manifest refusal. `applicableBaselineIds` is a CACHE of
// scope-submission's computation; a manifest scoped before the applicability
// gate canonicalized element-type synonyms persists a truncated set, and
// compute-sci consumed it verbatim — under-requiring the blocker floor and
// inflating completeness (the falsely-ready failure the gate fix closed,
// surviving via the persisted cache). compute-sci must recompute from the
// manifest's own elements and REFUSE (exit 2) on any set difference —
// order-insensitive, duplicates ignored, and it never substitutes either set.
// ---------------------------------------------------------------------------
const BASELINE_ENTRIES = parseBaselineApplies(
  readFileSync(join(PLUGIN, 'baseline', 'requirements-baseline.yaml'), 'utf8')
)
// What the pre-canonicalization gate computed for a synonym-typed scope: the raw
// synonym matched no applies_to token, so only the `all`-gated floor survived.
const TRUNCATED = computeApplicable(BASELINE_ENTRIES, ['no-such-element-type'])
const CORRECT = computeApplicable(BASELINE_ENTRIES, ['external-web-app'])
const WEB_SYNONYM_ELEMENTS = [{ type: 'external-web-app' }]

function runSciRaw(target, extraArgs = []) {
  // execFileSync throws on a non-zero exit; normalize to { status, stdout }.
  try {
    const out = execFileSync('node', [SCI, '--target', target, '--plugin', PLUGIN, '--date', '2026-06-16', ...extraArgs], { encoding: 'utf8' })
    return { status: 0, stdout: out }
  } catch (e) {
    return { status: e.status, stdout: String(e.stdout || '') }
  }
}

check('S1 stale refusal: synonym-typed manifest + truncated stored set → exit 2 + STALE block (text and --json)', () => {
  assert.ok(CORRECT.length > TRUNCATED.length, 'precondition: the synonym scope must require more than the all-gated floor')
  const d = fixture((dir) => {
    write(dir, 'scope-manifest.json', { applicableBaselineIds: TRUNCATED, elements: WEB_SYNONYM_ELEMENTS })
    write(dir, 'audit-ledger.json', { findings: [] })
  }); dirs.push(d)
  for (const flags of [[], ['--json']]) {
    const r = runSciRaw(d, flags)
    assert.equal(r.status, 2, 'stale manifest must exit 2 (the documented refusal code) — never silently compute')
    assert.match(r.stdout, /STALE SCOPE MANIFEST/)
    assert.ok(r.stdout.includes(`(${TRUNCATED.length} distinct id(s))`), 'names the stored count')
    assert.ok(r.stdout.includes(`(${CORRECT.length} id(s))`), 'names the recomputed count')
    assert.match(r.stdout, /scope-submission/, 'routes to re-scoping')
    const missing = CORRECT.filter((id) => !new Set(TRUNCATED).has(id)).sort()
    assert.ok(r.stdout.includes(missing[0]), 'samples the missing ids')
    assert.doesNotMatch(r.stdout, /READINESS:/, 'no SCI may be emitted alongside the refusal')
  }
})

check('S2 fresh manifest passes; synonym scope ≡ canonical scope byte-identically (text and --json)', () => {
  const mk = (els, ids) => fixture((dir) => {
    write(dir, 'scope-manifest.json', { applicableBaselineIds: ids, elements: els })
    write(dir, 'audit-ledger.json', { findings: [] })
  })
  const dSyn = mk(WEB_SYNONYM_ELEMENTS, CORRECT); dirs.push(dSyn)
  const dCan = mk([{ type: 'external-endpoint' }], computeApplicable(BASELINE_ENTRIES, ['external-endpoint'])); dirs.push(dCan)
  for (const flags of [[], ['--json']]) {
    const a = runSciRaw(dSyn, flags)
    const b = runSciRaw(dCan, flags)
    assert.equal(a.status, 0, 'a fresh (stored == recomputed) manifest must compute normally')
    assert.equal(b.status, 0)
    assert.doesNotMatch(a.stdout, /STALE SCOPE MANIFEST/)
    assert.equal(a.stdout, b.stdout, 'a synonym-typed scope must compute the same SCI as its canonical twin')
    assert.match(a.stdout, flags.length ? /"band"/ : /READINESS:/)
  }
})

check('S3 shuffled + duplicated stored set → NOT stale (set comparison, order/duplicates ignored)', () => {
  const shuffled = [...CORRECT].reverse().concat(CORRECT[0])
  const d = fixture((dir) => {
    write(dir, 'scope-manifest.json', { applicableBaselineIds: shuffled, elements: WEB_SYNONYM_ELEMENTS })
    write(dir, 'audit-ledger.json', { findings: [] })
  }); dirs.push(d)
  const r = runSciRaw(d)
  assert.equal(r.status, 0, 'order/duplicates must not false-positive the staleness check')
  assert.doesNotMatch(r.stdout, /STALE SCOPE MANIFEST/)
})

check('S4 missing applicableBaselineIds with a non-empty recompute → stale (exit 2)', () => {
  const d = fixture((dir) => {
    write(dir, 'scope-manifest.json', { elements: WEB_SYNONYM_ELEMENTS })
    write(dir, 'audit-ledger.json', { findings: [] })
  }); dirs.push(d)
  const r = runSciRaw(d)
  assert.equal(r.status, 2, 'a manifest with elements but no stored set must refuse, not silently compute')
  assert.match(r.stdout, /STALE SCOPE MANIFEST/)
})

check('S5 stray whitespace in an element type → NOT stale (trimmed like the producer path)', () => {
  // The manifest is LLM-authored JSON; the applicable-requirements --elements
  // producer path trims its tokens, so the recompute must trim too or a
  // trailing space would false-positive the refusal on a genuinely fresh scope.
  const d = fixture((dir) => {
    write(dir, 'scope-manifest.json', { applicableBaselineIds: CORRECT, elements: [{ type: ' external-web-app ' }] })
    write(dir, 'audit-ledger.json', { findings: [] })
  }); dirs.push(d)
  const r = runSciRaw(d)
  assert.equal(r.status, 0, 'a whitespace-padded element type must not trip the staleness refusal')
  assert.doesNotMatch(r.stdout, /STALE SCOPE MANIFEST/)
})

// ---------------------------------------------------------------------------
// W — prose wiring: the manifest's applicableBaselineIds is THE applicable set
// for every consumer (single source of truth with the SCI gate), and the
// element-consuming skills match types through the canonical form.
// ---------------------------------------------------------------------------
check('W1 compile-submission reads applicableBaselineIds verbatim at the three sites; no raw applies_to re-derivation', () => {
  const skill = readFileSync(join(PLUGIN, 'skills', 'compile-submission', 'SKILL.md'), 'utf8')
  const mentions = skill.match(/applicableBaselineIds/g) || []
  assert.ok(mentions.length >= 3, `expected ≥3 applicableBaselineIds read sites, got ${mentions.length}`)
  assert.doesNotMatch(skill, /intersects the manifest's `applies_to` set/, 'step 1 must not re-intersect applies_to')
  assert.doesNotMatch(skill, /whose `applies_to` matches the manifest/, 'step 2 must not re-derive by applies_to')
  assert.doesNotMatch(skill, /`applies_to` matched the scope manifest/, 'slot suppression must key on baseline ids')
  assert.match(skill, /ELEMENT_TYPE_SYNONYMS/, 'element-type conditionals reference the canonical synonym home')
  assert.match(skill, /STALE SCOPE MANIFEST/, 'documents the stale refusal and where it routes')
})

check('W2 security-review-journey documents the stale refusal routing; no raw applies_to re-derivation', () => {
  const skill = readFileSync(join(PLUGIN, 'skills', 'security-review-journey', 'SKILL.md'), 'utf8')
  assert.match(skill, /STALE SCOPE MANIFEST/)
  assert.match(skill, /scope-submission/)
  assert.match(skill, /applicableBaselineIds/, 'the artifact step reads the persisted applicable set')
  assert.doesNotMatch(skill, /whose `applies_to` matched the manifest/, 'the artifact step must not re-derive by applies_to')
})

check('W3 the four element-consuming skills carry the canonical-form note; stay-listed reads the persisted set', () => {
  for (const s of ['reviewer-simulation', 'prepare-test-environment', 'run-scans', 'stay-listed']) {
    const skill = readFileSync(join(PLUGIN, 'skills', s, 'SKILL.md'), 'utf8')
    assert.match(skill, /ELEMENT_TYPE_SYNONYMS/, `${s} must reference the canonical synonym home (never duplicate the map)`)
  }
  const stayListed = readFileSync(join(PLUGIN, 'skills', 'stay-listed', 'SKILL.md'), 'utf8')
  assert.match(stayListed, /applicableBaselineIds/, 'stay-listed gates on the persisted applicable set, not a re-intersection')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

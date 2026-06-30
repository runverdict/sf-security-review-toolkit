#!/usr/bin/env node
/**
 * Standing test for the VERBATIM end-of-run audit recap
 * (harness/render-recap.mjs, WI-04 / INV-34). merge-ledger.mjs emits this fixed block
 * to stdout at the end of every pass; audit-codebase Step 7 prints it verbatim. It is
 * LED BY the finding-cluster triage headline, byte-identical to the Step-6 exec summary
 * and the journey blocker gate.
 *
 * RC1  determinism — same facts twice → byte-identical (fn + CLI).
 * RC2  golden — led by the cluster headline; this-pass counts; the PROCEED/HALT verdict;
 *      the fixed not-covered caveat lines.
 * RC3  byte-identical lead — the recap embeds renderClusterHeadline(clusterFindings(findings))
 *      VERBATIM (the failure verdict can't differ from the exec summary / blocker gate).
 * RC4  fail-safe — null facts → renders (no crash); empty findings → the NONE headline + PROCEED.
 * RC5  wiring — merge-ledger imports + calls renderAuditRecap and emits it to stdout;
 *      audit-codebase Step 7 grants + references the harness + states verbatim.
 *
 * Dependency-free: `node acceptance/test-render-recap.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { renderAuditRecap } from '../harness/render-recap.mjs'
import { clusterFindings, renderClusterHeadline } from '../harness/finding-clusters.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'render-recap.mjs')

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) } }
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'rrc-')); dirs.push(d); return d }

const FINDINGS = [
  { id: '1', dimension: 'apex-exposed-surface', status: 'confirmed', adjusted_severity: 'high', file: 'force-app/classes/Svc.cls:5' },
  { id: '2', dimension: 'web-client', status: 'confirmed', adjusted_severity: 'critical', file: 'force-app/classes/Svc.cls:13' },
]
const FACTS = { findings: FINDINGS, dimensions: ['apex-exposed-surface', 'web-client'], candidates: 7, confirmed: 2, refuted: 2, unverified: 1, pass: 1, tier: 'standard' }

console.log('render-recap standing test')

check('RC1 determinism: same facts twice → byte-identical (fn + CLI)', () => {
  assert.equal(renderAuditRecap(FACTS), renderAuditRecap(FACTS))
  const d = tmp(); const f = join(d, 'facts.json'); writeFileSync(f, JSON.stringify(FACTS))
  const a = execFileSync('node', [CLI, '--input', f], { encoding: 'utf8' })
  const b = execFileSync('node', [CLI, '--input', f], { encoding: 'utf8' })
  assert.equal(a, b)
})

check('RC2 golden: led by the cluster headline + counts + verdict + caveat', () => {
  const block = renderAuditRecap(FACTS)
  assert.match(block, /## Audit pass 1 recap \(standard\)/)
  // led by the cluster headline
  const headIdx = block.indexOf('### Finding triage — cluster view')
  const countsIdx = block.indexOf('**This pass:**')
  assert.ok(headIdx >= 0 && countsIdx > headIdx, 'the cluster headline leads, then the counts')
  assert.match(block, /\*\*This pass:\*\* 2 dimension\(s\) ran — apex-exposed-surface, web-client\./)
  assert.match(block, /Candidates 7 · confirmed\/partial 2 · refuted 2 · unverified 1\./)
  // HALT (open critical/high present — the two findings collapse to ONE critical cluster,
  // so the RAW open severities are 1 critical + 1 high)
  assert.match(block, /\*\*Verdict: HALT\.\*\* 1 critical \+ 1 high open/)
  // the fixed not-covered caveat lines
  assert.match(block, /Packaged Apex CRUD\/FLS → Code Analyzer \/ Graph Engine\./)
  assert.match(block, /Dynamic runtime behavior → DAST\./)
  assert.match(block, /Salesforce performs its own penetration test on the live solution regardless\./)
})

check('RC3 byte-identical lead: recap embeds renderClusterHeadline verbatim', () => {
  const lead = renderClusterHeadline(clusterFindings(FINDINGS))
  const block = renderAuditRecap(FACTS)
  assert.ok(block.includes(lead), 'the recap lead is byte-identical to finding-clusters --headline')
})

check('RC4 fail-safe: NO audit data → UNAVAILABLE (never a false PROCEED/clean)', () => {
  // null / {} / no-findings-signal facts = the audit never ran = UNAVAILABLE, NOT "zero findings"
  for (const bad of [null, undefined, {}, 42, 'x']) {
    const block = renderAuditRecap(bad)
    assert.match(block, /## Audit pass \? recap \(unknown-tier\)/)
    assert.match(block, /Finding cluster view unavailable/, 'the lead is the UNAVAILABLE headline')
    assert.match(block, /\*\*Verdict: UNAVAILABLE\.\*\*/, 'verdict is UNAVAILABLE')
    assert.ok(!/\*\*Verdict: PROCEED\.\*\*/.test(block), 'NEVER a false PROCEED when the audit never ran')
    assert.ok(!/No open confirmed findings/.test(block), 'NEVER reads as "zero findings" when there is no data')
  }
  // CLI with a missing input file → UNAVAILABLE, no crash
  const out = execFileSync('node', [CLI, '--input', join(tmp(), 'nope.json')], { encoding: 'utf8' })
  assert.match(out, /\*\*Verdict: UNAVAILABLE\.\*\*/)
})

check('RC4b audit RAN with zero open (findings:[] present) → NONE headline + PROCEED', () => {
  // a PRESENT facts object whose audit produced zero open confirmed → legitimate PROCEED
  const proceed = renderAuditRecap({ findings: [], dimensions: ['x'], candidates: 3, confirmed: 0, refuted: 3, unverified: 0, pass: 2, tier: 'quick' })
  assert.match(proceed, /\*\*No open confirmed findings\.\*\*/)
  assert.match(proceed, /\*\*Verdict: PROCEED\.\*\*/)
})

check('RC4c refuted-only ledger (no open) → PROCEED, never a false "secure"', () => {
  const block = renderAuditRecap({ findings: [{ id: 'r', dimension: 'x', status: 'refuted', adjusted_severity: 'critical', file: 'a.cls:1' }], dimensions: ['x'], pass: 1, tier: 'standard' })
  assert.match(block, /\*\*Verdict: PROCEED\.\*\*/)
  assert.match(block, /not "secure"/)
})

check('RC6 dict-vs-array guard (rule-8 corollary): PRESENT-but-non-array findings → UNAVAILABLE, never PROCEED', () => {
  // a dict-shaped `findings` ALONGSIDE a pass/dimensions field must NOT become a false PROCEED:
  // a malformed-but-present ledger is unreadable, not "zero findings".
  for (const facts of [
    { findings: { factor: {} }, pass: 2, dimensions: ['x'], tier: 'standard' },
    { findings: { a: 1 }, pass: 3, candidates: 5, confirmed: 0, refuted: 5 },
    { findings: 'not-an-array', dimensions: ['y'] },
  ]) {
    const block = renderAuditRecap(facts)
    assert.match(block, /\*\*Verdict: UNAVAILABLE\.\*\*/, 'a non-array findings forces UNAVAILABLE')
    assert.match(block, /Finding cluster view unavailable/, 'the lead is the UNAVAILABLE headline')
    assert.ok(!/\*\*Verdict: PROCEED\.\*\*/.test(block), 'NEVER a false PROCEED for a malformed-but-present ledger')
    assert.ok(!/No open confirmed findings/.test(block), 'NEVER reads as "no findings"')
  }
})

check('RC7 --target dict-vs-array guard: a dict-findings ledger WITH passes[] → UNAVAILABLE via the CLI (the factsFromLedger path), never a false PROCEED', () => {
  // The corrupted ledger: `findings` is a DICT (rule-8 shape) but a real pass IS recorded. The
  // OLD factsFromLedger coerced findings→[] BEFORE renderAuditRecap's guard, so `--target` read
  // "no open confirmed findings" + PROCEED on an unreadable ledger. It must now be UNAVAILABLE.
  const d = tmp(); mkdirSync(join(d, '.security-review'), { recursive: true })
  writeFileSync(join(d, '.security-review', 'audit-ledger.json'), JSON.stringify({
    schema_version: '1',
    findings: { 'apex.fls': { severity: 'high' } },
    passes: [{ id: 1, dimensions: ['apex-exposed-surface'], candidates: 4, confirmed: 1, refuted: 3, unverified: 0, tier: 'standard' }],
  }))
  const out = execFileSync('node', [CLI, '--target', d], { encoding: 'utf8' })
  assert.match(out, /\*\*Verdict: UNAVAILABLE\.\*\*/, 'a dict-findings ledger forces UNAVAILABLE on the --target path')
  assert.ok(!/\*\*Verdict: PROCEED\.\*\*/.test(out), 'NEVER a false PROCEED from a corrupted ledger via --target')
  assert.ok(!/No open confirmed findings/.test(out), 'NEVER reads "no open confirmed findings" for an unreadable ledger')

  // A LEGIT array ledger with an open high still renders the real HALT via --target (not broken).
  const dH = tmp(); mkdirSync(join(dH, '.security-review'), { recursive: true })
  writeFileSync(join(dH, '.security-review', 'audit-ledger.json'), JSON.stringify({
    schema_version: '1',
    findings: [{ id: '1', dimension: 'apex-exposed-surface', status: 'confirmed', adjusted_severity: 'high', file: 'a.cls:5' }],
    passes: [{ id: 1, dimensions: ['apex-exposed-surface'], candidates: 1, confirmed: 1, refuted: 0, unverified: 0, tier: 'standard' }],
  }))
  const outH = execFileSync('node', [CLI, '--target', dH], { encoding: 'utf8' })
  assert.match(outH, /\*\*Verdict: HALT\.\*\*/, 'a legit array ledger with an open high still HALTs via --target')
  assert.ok(!/\*\*Verdict: UNAVAILABLE\.\*\*/.test(outH), 'a legit ledger is NOT UNAVAILABLE')

  // A LEGIT array ledger with ZERO open (refuted only) still PROCEEDs via --target.
  const dP = tmp(); mkdirSync(join(dP, '.security-review'), { recursive: true })
  writeFileSync(join(dP, '.security-review', 'audit-ledger.json'), JSON.stringify({
    schema_version: '1',
    findings: [{ id: 'r', dimension: 'x', status: 'refuted', adjusted_severity: 'critical', file: 'a.cls:1' }],
    passes: [{ id: 2, dimensions: ['x'], candidates: 1, confirmed: 0, refuted: 1, unverified: 0, tier: 'quick' }],
  }))
  const outP = execFileSync('node', [CLI, '--target', dP], { encoding: 'utf8' })
  assert.match(outP, /\*\*Verdict: PROCEED\.\*\*/, 'a legit array ledger with zero open still PROCEEDs via --target')
})

check('RC5 wiring: merge-ledger imports + emits the recap; audit-codebase Step 7 verbatim', () => {
  const merge = readFileSync(join(PLUGIN, 'harness', 'merge-ledger.mjs'), 'utf8')
  assert.match(merge, /import \{ renderAuditRecap \} from '\.\/render-recap\.mjs'/, 'merge-ledger imports renderAuditRecap')
  assert.match(merge, /renderAuditRecap\(\{/, 'merge-ledger calls renderAuditRecap')
  assert.match(merge, /process\.stdout\.write\(/, 'merge-ledger emits to stdout')
  const audit = readFileSync(join(PLUGIN, 'skills', 'audit-codebase', 'SKILL.md'), 'utf8')
  assert.match(audit, /Bash\(node \*harness\/render-recap\.mjs \*\)/, 'audit-codebase grants render-recap')
  assert.match(audit, /render-recap\.mjs/, 'audit-codebase references the harness')
  assert.match(audit, /Print[^.]*recap[^.]*VERBATIM|recap block VERBATIM|stdout block VERBATIM/i, 'states print-the-recap verbatim')
})

check('RC8 BUG-A: a crashed finder (coverageFailed) over ZERO open findings forces a NON-clean verdict (never a false PROCEED)', () => {
  // zero open findings BUT a dimension's finder crashed → coverage incomplete, must NOT read PROCEED/clean.
  const block = renderAuditRecap({
    findings: [], dimensions: ['secrets-credentials', 'crypto-internals'],
    candidates: 3, confirmed: 0, refuted: 3, unverified: 0,
    coverageFailed: ['resource-consumption-abuse'], pass: 4, tier: 'standard',
  })
  assert.match(block, /Coverage INCOMPLETE/, 'surfaces the coverage-incomplete caveat')
  assert.match(block, /resource-consumption-abuse/, 'names the dimension to re-run')
  assert.match(block, /coverage-FAILED 1/, 'the counts line shows the coverage-failed count')
  assert.ok(!/\*\*Verdict: PROCEED\.\*\*/.test(block), 'NEVER a clean PROCEED over a crashed dimension')
  assert.match(block, /\*\*Verdict: COVERAGE INCOMPLETE — re-run required\.\*\*/, 'the verdict is COVERAGE INCOMPLETE, not PROCEED')
  assert.match(block, /re-run/i, 'tells the operator to re-run')
})

check('RC9 coverage failure WITH an open high → HALT, and still names the crashed dimension to re-run', () => {
  const block = renderAuditRecap({
    findings: [{ id: '1', dimension: 'apex-exposed-surface', status: 'confirmed', adjusted_severity: 'high', file: 'a.cls:5' }],
    dimensions: ['apex-exposed-surface'], candidates: 2, confirmed: 1, refuted: 0, unverified: 0,
    coverageFailed: ['resource-consumption-abuse'], pass: 5, tier: 'standard',
  })
  assert.match(block, /\*\*Verdict: HALT\.\*\*/, 'an open high still HALTs')
  assert.match(block, /Coverage INCOMPLETE/, 'the coverage caveat is still surfaced alongside HALT')
  assert.match(block, /resource-consumption-abuse/, 'the crashed dimension is named in the HALT verdict too')
})

check('RC10 no coverage failure → verdict + counts unchanged (PROCEED on zero open, no coverage caveat)', () => {
  const block = renderAuditRecap({
    findings: [], dimensions: ['x'], candidates: 1, confirmed: 0, refuted: 1, unverified: 0,
    coverageFailed: [], pass: 1, tier: 'quick',
  })
  assert.match(block, /\*\*Verdict: PROCEED\.\*\*/, 'an empty coverageFailed leaves PROCEED intact')
  assert.ok(!/Coverage INCOMPLETE/.test(block), 'no coverage caveat when nothing crashed')
  assert.ok(!/coverage-FAILED/.test(block), 'no coverage-failed count when nothing crashed')
})

check('RC11 wiring: merge-ledger threads R.coverage_failed → pass object + the recap (coverageFailed)', () => {
  const merge = readFileSync(join(PLUGIN, 'harness', 'merge-ledger.mjs'), 'utf8')
  assert.match(merge, /R\.coverage_failed/, 'merge-ledger reads coverage_failed off the workflow envelope')
  assert.match(merge, /coverage_failed: coverageFailed/, 'merge-ledger persists coverage_failed in the pass object')
  assert.match(merge, /coverageFailed,/, 'merge-ledger passes coverageFailed into renderAuditRecap')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

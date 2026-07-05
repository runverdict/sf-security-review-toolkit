#!/usr/bin/env node
/**
 * Standing test for harness/reconcile-provenance.mjs — LLM-supersession ENFORCEMENT
 * (Phase 1 · Slice 2 of docs/roadmap-deterministic-findings.md §3).
 *
 * The deterministic-findings architecture's enforcement half: a deterministic engine is
 * AUTHORITATIVE for the class it owns, so an llm-inferred finding in the SAME owned class
 * at the SAME locus is SUPERSEDED (status:'superseded', superseded_by → the deterministic
 * id) — the LLM never re-reports, re-judges, or duplicates what an engine determined. This
 * is a unit test (a `deterministic` property is validated by "run it twice → identical",
 * not a campaign).
 *
 * Guards:
 *   R1  same class + same locus → the LLM finding is superseded; the deterministic stands.
 *   R2  a DIFFERENT class (explicit class mismatch) at the same locus → untouched.
 *   R3  a DIFFERENT locus (non-overlapping span), same class → untouched.
 *   R4  idempotent: reconcile twice → byte-identical findings; 2nd pass supersedes 0.
 *   R5  an UNMAPPED deterministic finding (no `class`) supersedes nothing (safety).
 *   R6  a deterministic finding is NEVER superseded (only llm-inferred is).
 *   R7  precise class match when the LLM carries an explicit class; dimension fallback
 *       when it does not (the realistic dimension-tagged LLM finding).
 *   R7b an EXPLICITLY-labeled finding (provenance:'llm-inferred' — the 0.8.93
 *       merge-ledger self-declaration) supersedes IDENTICALLY to the label-less
 *       absence-default case; the locus is counted once and the label survives.
 *   R8  owner/terminal LLM states (fixed / accepted_risk / already-superseded) preserved.
 *   R9  the input array is not mutated (pure — returns shallow copies).
 *   SC  a superseded finding + a `class` field validate against $defs/finding; the schema
 *       declares status:'superseded' + class + superseded_by + superseded_reason.
 *   CLI the CLI reconciles a target ledger, is idempotent, and --dry-run does not write.
 *
 * Dependency-free: `node acceptance/test-reconcile-provenance.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  reconcileProvenance,
  classOf,
  sameOwnedClass,
  SUPERSEDED,
} from '../harness/reconcile-provenance.mjs'
import { buildFinding } from '../harness/ingest-scanner-findings.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'reconcile-provenance.mjs')
const SCHEMA_PATH = join(PLUGIN, 'templates', 'audit-ledger.schema.json')
const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'))
const clone = (o) => JSON.parse(JSON.stringify(o))

let pass = 0
let fail = 0
const dirs = []
const check = (name, fn) => {
  try {
    fn()
    pass++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    fail++
    console.log(`  ✗ ${name}\n    ${e.message}`)
  }
}

// ---- a focused JSON-Schema validator for $defs/finding (mirrors the ingest test) ----
const FINDING_DEF = readJSON(SCHEMA_PATH).$defs.finding
const SEVERITY_ENUM = ['critical', 'high', 'medium', 'low', 'info']
function validateFinding(f, fdef = FINDING_DEF) {
  const errors = []
  for (const r of fdef.required) if (!(r in f)) errors.push(`missing required '${r}'`)
  const allowed = new Set(Object.keys(fdef.properties))
  for (const k of Object.keys(f)) if (!allowed.has(k)) errors.push(`additional property '${k}'`)
  for (const [k, v] of Object.entries(f)) {
    const p = fdef.properties[k]
    if (!p) continue
    if (p.type === 'string' && typeof v !== 'string') errors.push(`'${k}' must be string`)
    if (p.type === 'integer' && !Number.isInteger(v)) errors.push(`'${k}' must be integer`)
    if (Array.isArray(p.enum) && !p.enum.includes(v)) errors.push(`'${k}'='${v}' not in enum`)
    if (p.pattern && typeof v === 'string' && !new RegExp(p.pattern).test(v)) errors.push(`'${k}' fails pattern`)
    if (p.minLength != null && typeof v === 'string' && v.length < p.minLength) errors.push(`'${k}' below minLength`)
    if (p.$ref === '#/$defs/severity' && !SEVERITY_ENUM.includes(v)) errors.push(`'${k}'='${v}' not a severity`)
  }
  return errors
}

// ---- fixtures: a real deterministic finding (via buildFinding) + llm-inferred literals ----
// crud-fls deterministic finding at A.cls:19 (class:'crud-fls', dimension:'apex-exposed-surface').
const detCrud = (startLine = 19) =>
  buildFinding({
    engine: 'pmd',
    ruleId: 'ApexCRUDViolation',
    severityNum: 2,
    file: 'force-app/main/default/classes/A.cls',
    startLine,
    message: 'Validate CRUD permission before SOQL/DML operation or enforce user mode',
    resources: [],
    classKey: 'crud-fls',
    repoRoot: '',
    pass: 1,
  })
// an UNMAPPED deterministic finding (classKey null → no `class`, owns nothing).
const detUnmapped = (startLine = 19) =>
  buildFinding({
    engine: 'pmd',
    ruleId: 'SomeUnmappedRule',
    severityNum: 3,
    file: 'force-app/main/default/classes/A.cls',
    startLine,
    message: 'an unmapped rule',
    resources: [],
    classKey: null,
    repoRoot: '',
    pass: 1,
  })
// an llm-inferred finding (provenance defaults to llm-inferred — field omitted).
// id is a valid 16-hex dedup key (schema $defs/finding/id pattern).
const llm = (over = {}) => ({
  id: 'ab12cd34ef560789',
  dimension: 'apex-exposed-surface',
  title: 'Contact PII read without FLS in getAccountInsight',
  severity: 'high',
  adjusted_severity: 'high',
  file: 'force-app/main/default/classes/A.cls:19-25',
  status: 'confirmed',
  first_seen: 1,
  last_seen: 1,
  verdict: 'confirmed_real',
  verdict_reasoning: 'reasoned over the code that no describe/strip guards the Contact read',
  ...over,
})

console.log('reconcile-provenance standing test')

// ───────────────────────────────────────────────────────────── supersession
check('R1 same owned class + overlapping locus → the LLM finding is superseded; the deterministic stands', () => {
  const det = detCrud(19) // A.cls:19
  const l = llm() // A.cls:19-25, dimension apex-exposed-surface, no class
  const { findings, superseded, supersededIds } = reconcileProvenance([det, l])
  assert.equal(superseded, 1)
  const outL = findings.find((f) => f.id === l.id)
  const outD = findings.find((f) => f.id === det.id)
  assert.equal(outL.status, SUPERSEDED)
  assert.equal(outL.superseded_by, det.id)
  assert.match(outL.superseded_reason, /authoritative/)
  assert.deepEqual(supersededIds, [l.id])
  // the deterministic finding is untouched
  assert.equal(outD.status, 'confirmed')
  assert.equal(outD.provenance, 'deterministic')
})

check('R2 a DIFFERENT class (explicit class mismatch) at the same locus → untouched', () => {
  const det = detCrud(19) // class crud-fls
  const l = llm({ class: 'sharing' }) // explicitly a different class, same locus + dimension
  const { findings, superseded } = reconcileProvenance([det, l])
  assert.equal(superseded, 0)
  assert.equal(findings.find((f) => f.id === l.id).status, 'confirmed')
})

check('R3 a DIFFERENT locus (non-overlapping span), same class → untouched', () => {
  const det = detCrud(19) // A.cls:19
  const l = llm({ file: 'force-app/main/default/classes/A.cls:40-45' }) // no overlap with :19
  const { findings, superseded } = reconcileProvenance([det, l])
  assert.equal(superseded, 0)
  assert.equal(findings.find((f) => f.id === l.id).status, 'confirmed')
})

check('R3b a DIFFERENT file, same class + same line numbers → untouched (locus is file AND span)', () => {
  const det = detCrud(19)
  const l = llm({ file: 'force-app/main/default/classes/B.cls:19-25' }) // different file
  const { superseded } = reconcileProvenance([det, l])
  assert.equal(superseded, 0)
})

check('R4 idempotent: reconcile twice → byte-identical findings; the 2nd pass supersedes 0', () => {
  const input = [detCrud(19), llm()]
  const r1 = reconcileProvenance(input)
  const r2 = reconcileProvenance(r1.findings)
  assert.equal(r1.superseded, 1)
  assert.equal(r2.superseded, 0)
  assert.equal(JSON.stringify(r1.findings), JSON.stringify(r2.findings))
})

check('R5 an UNMAPPED deterministic finding (no `class`) supersedes nothing — only an OWNED class wins', () => {
  const det = detUnmapped(19) // deterministic but no class
  assert.equal(det.class, undefined)
  const l = llm() // same locus + dimension
  const { superseded } = reconcileProvenance([det, l])
  assert.equal(superseded, 0)
})

check('R6 a deterministic finding is NEVER superseded (even co-located with another owned-class deterministic)', () => {
  const det1 = detCrud(19)
  const det2 = { ...detCrud(20), id: 'd'.repeat(16) } // a second deterministic at overlapping span
  const { findings, superseded } = reconcileProvenance([det1, det2])
  assert.equal(superseded, 0) // neither side is llm-inferred
  assert.ok(findings.every((f) => f.status === 'confirmed'))
})

check('R7 precise class match when the LLM carries an explicit class; dimension fallback when it does not', () => {
  const det = detCrud(19) // class crud-fls, dimension apex-exposed-surface
  // explicit matching class → superseded
  assert.equal(reconcileProvenance([det, llm({ class: 'crud-fls' })]).superseded, 1)
  // no class, matching dimension → superseded (fallback)
  assert.equal(reconcileProvenance([det, llm({ class: undefined })]).superseded, 1)
  // no class, DIFFERENT dimension → untouched (the fallback needs the dimension to match)
  assert.equal(reconcileProvenance([det, llm({ class: undefined, dimension: 'tenant-isolation' })]).superseded, 0)
})

check('R7b an EXPLICITLY-labeled llm finding (provenance:llm-inferred) supersedes IDENTICALLY to the label-less case — locus counted once', () => {
  const det = detCrud(19)
  const labeled = reconcileProvenance([det, llm({ provenance: 'llm-inferred' })])
  const unlabeled = reconcileProvenance([det, llm()])
  assert.equal(labeled.superseded, 1, 'the explicitly-labeled finding is superseded (never double-counted, never skipped)')
  assert.deepEqual(labeled.supersededIds, unlabeled.supersededIds, 'identical supersession to the absence-default case')
  const outL = labeled.findings.find((f) => f.id === 'ab12cd34ef560789')
  assert.equal(outL.status, SUPERSEDED)
  assert.equal(outL.superseded_by, det.id)
  assert.equal(outL.provenance, 'llm-inferred', 'the self-declared label survives the supersession untouched')
})

check('R8 owner/terminal LLM states are preserved (fixed / accepted_risk / already-superseded never re-touched)', () => {
  const det = detCrud(19)
  for (const status of ['fixed', 'accepted_risk', SUPERSEDED]) {
    const l = llm({ status })
    const { findings, superseded } = reconcileProvenance([det, l])
    assert.equal(superseded, 0, `${status} should not be superseded`)
    assert.equal(findings.find((f) => f.id === l.id).status, status)
  }
})

check('R9 the input array/objects are not mutated (pure — returns shallow copies)', () => {
  const input = [detCrud(19), llm()]
  const before = JSON.stringify(input)
  reconcileProvenance(input)
  assert.equal(JSON.stringify(input), before)
})

check('R10 classOf / sameOwnedClass helpers behave', () => {
  assert.equal(classOf({ class: 'crud-fls' }), 'crud-fls')
  assert.equal(classOf({ dimension: 'apex-exposed-surface' }), null) // dimension is NOT a class
  assert.equal(classOf(null), null)
  const det = detCrud(19)
  assert.equal(sameOwnedClass(det, { class: 'crud-fls' }), true)
  assert.equal(sameOwnedClass(det, { class: 'sharing' }), false)
  assert.equal(sameOwnedClass(det, { dimension: 'apex-exposed-surface' }), true) // fallback
  assert.equal(sameOwnedClass(det, { dimension: 'tenant-isolation' }), false)
  assert.equal(sameOwnedClass({ /* no class */ dimension: 'apex-exposed-surface' }, { dimension: 'apex-exposed-surface' }), false)
})

check('R11 empty / non-array input is tolerated (no crash, supersedes 0)', () => {
  assert.equal(reconcileProvenance([]).superseded, 0)
  assert.equal(reconcileProvenance(null).superseded, 0)
  assert.equal(reconcileProvenance(undefined).superseded, 0)
})

// ─────────────────────────────────────────────────────── schema conformance
check('SC1 a superseded finding validates against $defs/finding', () => {
  const det = detCrud(19)
  const out = reconcileProvenance([det, llm()]).findings.find((f) => f.status === SUPERSEDED)
  assert.deepEqual(validateFinding(out), [])
})

check('SC2 a mapped deterministic finding (with `class`) validates against $defs/finding', () => {
  assert.deepEqual(validateFinding(detCrud(19)), [])
})

check('SC3 schema declares superseded status + class + superseded_by + superseded_reason (additively)', () => {
  const props = FINDING_DEF.properties
  assert.ok(props.status.enum.includes('superseded'))
  assert.ok(props.class && props.superseded_by && props.superseded_reason)
  assert.equal(props.superseded_by.pattern, '^[0-9a-f]{16}$')
  // additive: none newly required at the top level
  for (const k of ['class', 'superseded_by', 'superseded_reason']) assert.ok(!FINDING_DEF.required.includes(k))
})

// ─────────────────────────────────────────────────────────────────────── CLI
check('CLI1 reconciles a target ledger, marks superseded, idempotent on re-run', () => {
  const d = mkdtempSync(join(tmpdir(), 'reconcile-cli-'))
  dirs.push(d)
  const lp = join(d, '.security-review', 'audit-ledger.json')
  mkdirSync(join(d, '.security-review'), { recursive: true })
  const det = detCrud(19)
  writeFileSync(lp, JSON.stringify({ schema_version: '1', findings: [det, llm()], passes: [] }, null, 2))
  execFileSync('node', [CLI, '--target', d], { encoding: 'utf8' })
  const l1 = readJSON(lp)
  const sup1 = l1.findings.filter((f) => f.status === SUPERSEDED)
  assert.equal(sup1.length, 1)
  assert.equal(sup1[0].superseded_by, det.id)
  // re-run → still exactly one superseded (idempotent, no double-mark/crash)
  execFileSync('node', [CLI, '--target', d], { encoding: 'utf8' })
  const l2 = readJSON(lp)
  assert.equal(l2.findings.filter((f) => f.status === SUPERSEDED).length, 1)
  assert.equal(JSON.stringify(l1), JSON.stringify(l2))
})

check('CLI2 --dry-run --json reports the supersession WITHOUT writing the ledger', () => {
  const d = mkdtempSync(join(tmpdir(), 'reconcile-dry-'))
  dirs.push(d)
  const lp = join(d, '.security-review', 'audit-ledger.json')
  mkdirSync(join(d, '.security-review'), { recursive: true })
  const ledger = { schema_version: '1', findings: [detCrud(19), llm()], passes: [] }
  writeFileSync(lp, JSON.stringify(ledger, null, 2))
  const before = readFileSync(lp, 'utf8')
  const out = execFileSync('node', [CLI, '--target', d, '--dry-run', '--json'], { encoding: 'utf8' })
  const parsed = JSON.parse(out)
  assert.equal(parsed.superseded, 1)
  assert.equal(parsed.dryRun, true)
  assert.equal(readFileSync(lp, 'utf8'), before) // unchanged on disk
})

check('CLI3 refuses a corrupted (non-array findings) ledger rather than overwrite', () => {
  const d = mkdtempSync(join(tmpdir(), 'reconcile-bad-'))
  dirs.push(d)
  const lp = join(d, '.security-review', 'audit-ledger.json')
  mkdirSync(join(d, '.security-review'), { recursive: true })
  writeFileSync(lp, JSON.stringify({ schema_version: '1', findings: { not: 'an array' }, passes: [] }))
  let threw = false
  try {
    execFileSync('node', [CLI, '--target', d], { encoding: 'utf8', stdio: 'pipe' })
  } catch {
    threw = true // exit 2
  }
  assert.ok(threw, 'CLI should exit non-zero on a corrupted ledger')
})

// ─────────────────────────────────────────────────────────────────── cleanup
for (const d of dirs) {
  try {
    rmSync(d, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

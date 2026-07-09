#!/usr/bin/env node
/**
 * Standing test for A2 (0.8.103) — a disposition may never suppress a finding nobody has
 * looked at.
 *
 * THE DEFECT THIS LOCKS OUT: a deterministic disposition could omit `scope`, matching by
 * engine+ruleId across the WHOLE repo FOREVER — and apply-dispositions re-runs on every
 * pass. On the real cold run 18 of 23 dispositions were unscoped, matching 342 of the 406
 * deterministic findings (84% of the band). A genuine bug of an adjudicated rule committed
 * months later, at a file that did not exist when the reason was written, was auto-refuted
 * on arrival and never reached the open band. Compounding it, ingest's default pass was
 * the last COMPLETED pass (passes are appended only at pass end and the skills never
 * thread --pass), so a brand-new pass-2 finding was stamped `first_seen: 1` — making even
 * a time-bounded gate decorative. Requirement 0 fixed the assignment (in-progress pass =
 * last completed + 1); this suite locks both halves together.
 *
 * Guards:
 *   BD1  scope is MANDATORY — a scope-less disposition is a hard validation error,
 *        rejected whole, reported by index, NOTHING applied. Both keys → error. Empty
 *        `files` → error. `as_of_pass` of 0 / -1 / "2" / 1.5 → error.
 *   BD2  regression — `scope.files` behaves exactly as before this slice (named-file
 *        flip, sibling untouched, and NO time bound: the adjudicator read that locus).
 *   BD3  `as_of_pass: 2` flips matching findings with `first_seen: 1` AND `first_seen: 2`.
 *   BD4  a finding with `first_seen: 3` under `as_of_pass: 2` stays `status:'confirmed'`
 *        (asserted on status), gains `pending_readjudication`, keeps severity, gains NO
 *        disposition_reason — and the annotated finding validates against $defs/finding
 *        (the schema declares the annotation additively).
 *   BD5  FAIL CLOSED — `first_seen` absent / null / "1" (string) → not flipped, annotated;
 *        a finding we cannot date is a finding we have not adjudicated (never default 1).
 *   BD6  the blast radius is VISIBLE — per-disposition counts (matched / flipped /
 *        pending / distinct files) are returned, printed one line per disposition by the
 *        CLI, carried in --json; and a jointly-flipped merged parent credits EVERY
 *        contributing disposition's matched+flipped tallies (never just the last).
 *   BD7  safety regression — an `llm-inferred` finding with matching engine+ruleId is
 *        never touched, under either scope form.
 *   BD8  A1 composition, PER LENS (the D2 regression lock): the `as_of_pass` gate runs on
 *        each LENS's own `first_seen`, never the merged parent's (a fail-open min). A
 *        parent whose own first_seen (1) passes the bound but with ONE lens first_seen 3
 *        > N is NOT flipped — this check FAILS if a builder gates on the parent.
 *   BD9  idempotence (a 2nd apply flips 0, byte-identical findings — pending annotations
 *        included) and PROTECTED_STATES precedence under `as_of_pass`.
 *   BD10 THE END-TO-END LOCK (real CLIs, no fabricated first_seen): a scanner report is
 *        ingested by the REAL ingest-scanner-findings.mjs (--all AND --scanner paths)
 *        into a seeded ledger whose pass 1 is already closed; the ENGINE must assign the
 *        new finding `first_seen: 2` (Requirement 0 — the in-progress pass, not the last
 *        completed one), and an `as_of_pass: 1` disposition applied by the REAL
 *        apply-dispositions CLI must leave it `confirmed` (+ annotated) while flipping
 *        the pre-existing pass-1 finding of the same rule.
 *
 * Dependency-free: `node acceptance/test-disposition-blast-radius.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { applyDispositions, validateDisposition } from '../harness/apply-dispositions.mjs'
import { collapseCrossDimension } from '../harness/finding-clusters.mjs'
import { buildFinding } from '../harness/ingest-scanner-findings.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const APPLY = join(PLUGIN, 'harness', 'apply-dispositions.mjs')
const INGEST = join(PLUGIN, 'harness', 'ingest-scanner-findings.mjs')
const SEMGREP_FIXTURE = join(PLUGIN, 'acceptance', 'fixtures', 'semgrep-helios.json')
const SCHEMA_PATH = join(PLUGIN, 'templates', 'audit-ledger.schema.json')
const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'))
const node = (args) => execFileSync('node', args, { encoding: 'utf8', stdio: 'pipe' })

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

// ---- a focused $defs/finding validator (mirrors the sibling tests) ----
const FINDING_DEF = readJSON(SCHEMA_PATH).$defs.finding
function validateFinding(f) {
  const errors = []
  for (const r of FINDING_DEF.required) if (!(r in f)) errors.push(`missing required '${r}'`)
  const allowed = new Set(Object.keys(FINDING_DEF.properties))
  for (const k of Object.keys(f)) if (!allowed.has(k)) errors.push(`additional property '${k}'`)
  return errors
}

// ---- fixtures ----
const RULE = 'python.lang.security.audit.raw-sql'
// a deterministic finding of RULE at `file`, first entering the ledger at `passN`
// (buildFinding stamps first_seen from the REAL builder — never hand-fabricated here;
// only BD5's undatable variants mutate the field, because "missing/corrupt" IS the case
// under test there)
const det = (file, line, passN, over = {}) => ({
  ...buildFinding({
    engine: 'semgrep',
    ruleId: RULE,
    severityNum: null,
    file,
    startLine: line,
    message: 'raw SQL string built near a query call',
    resources: [],
    classKey: null,
    repoRoot: '',
    pass: passN,
    bandFromTool: 'high',
    toolSevLabel: 'ERROR',
    dimensionHint: 'external-sast',
  }),
  ...over,
})
const llm = (over = {}) => ({
  id: 'ab12cd34ef560789',
  dimension: 'apex-exposed-surface',
  title: 'SOQL injection reachable from the public endpoint (LLM-verified)',
  severity: 'critical',
  adjusted_severity: 'critical',
  file: 'app/routes.py:10-20',
  status: 'confirmed',
  first_seen: 1,
  last_seen: 1,
  verdict: 'confirmed_real',
  verdict_reasoning: 'reasoned over the code: user input reaches the query string unescaped',
  ...over,
})
const refute = (over = {}) => ({
  engine: 'semgrep',
  ruleId: RULE,
  disposition: 'refuted',
  reason: 'constant GUC bound at request entry; the flagged predicate is not user-influenced',
  ...over,
})
// the real cold-run merged-parent shape: bandit + detect-secrets at one locus, each lens
// entering the ledger at its OWN pass
const mergedParent = (banditPass, dsPass) => {
  const bandit = buildFinding({
    engine: 'bandit', ruleId: 'B105', severityNum: null, file: 'app/config.py', startLine: 41,
    message: 'hardcoded password string', resources: [], classKey: null, repoRoot: '',
    pass: banditPass, bandFromTool: 'high', toolSevLabel: 'HIGH', dimensionHint: 'external-sast',
  })
  const ds = buildFinding({
    engine: 'detect-secrets', ruleId: 'Secret Keyword', severityNum: null, file: 'app/config.py',
    startLine: 41, message: 'secret keyword detected', resources: [], classKey: 'hardcoded-secrets',
    repoRoot: '', pass: dsPass, dimensionHint: null,
  })
  const out = collapseCrossDimension([bandit, ds])
  assert.equal(out.length, 1, 'fixture sanity: the two deterministic lenses merged')
  assert.equal(out[0].lenses.length, 2, 'fixture sanity: 2 lenses')
  return out[0]
}
const dispFor = (engine, ruleId, over = {}) => ({
  engine,
  ruleId,
  disposition: 'refuted',
  reason: `${engine} ${ruleId} flags a seeded demo credential; not reachable in production`,
  ...over,
})

console.log('disposition blast-radius standing test (A2)')

// ─────────────────────────────────────────────── BD1 the scope is mandatory
check('BD1 scope-less / both-keys / empty-files / bad-as_of_pass dispositions are hard validation errors — rejected whole, by index, nothing applied', () => {
  const a = det('app/a.py', 10, 1)
  // scope-less, placed at index 1 so the index report is proven, alongside a valid entry
  const bare = refute()
  const valid = refute({ ruleId: 'some.other.rule', scope: { as_of_pass: 1 } })
  const r = applyDispositions([a], { dispositions: [valid, bare] })
  assert.equal(r.invalid.length, 1, 'exactly the scope-less entry is invalid')
  assert.equal(r.invalid[0].index, 1, 'reported by index')
  assert.match(r.invalid[0].errors.join(' '), /scope/, 'the error names the scope')
  assert.match(r.invalid[0].errors.join(' '), /files|as_of_pass/, 'the error tells the operator both remedies')
  assert.equal(r.applied, 0, 'the rejected entry applied NOTHING')
  assert.equal(r.findings.find((f) => f.id === a.id).status, 'confirmed')
  // both keys → error
  assert.match(
    validateDisposition(refute({ scope: { files: ['app/a.py'], as_of_pass: 1 } })).join(' '),
    /EXACTLY ONE/i
  )
  // empty scope object → error
  assert.equal(validateDisposition(refute({ scope: {} })).length > 0, true)
  // empty files → error
  assert.equal(validateDisposition(refute({ scope: { files: [] } })).length > 0, true)
  // invalid as_of_pass values → error, each one
  for (const bad of [0, -1, '2', 1.5, null]) {
    const errs = validateDisposition(refute({ scope: { as_of_pass: bad } }))
    assert.ok(errs.length > 0, `as_of_pass ${JSON.stringify(bad)} must be rejected`)
    assert.match(errs.join(' '), /as_of_pass/, `the error names as_of_pass for ${JSON.stringify(bad)}`)
  }
  // and nothing is applied by any of them
  for (const bad of [refute({ scope: {} }), refute({ scope: { files: [] } }), refute({ scope: { as_of_pass: '2' } })]) {
    const rr = applyDispositions([det('app/a.py', 10, 1)], { dispositions: [bad] })
    assert.equal(rr.applied, 0)
    assert.equal(rr.invalid.length, 1)
  }
})

// ───────────────────────────────────────── BD2 scope.files regression (unchanged)
check('BD2 scope.files behaves exactly as before — named-file flip, sibling untouched, no time bound', () => {
  const a = det('app/a.py', 10, 1)
  const b = det('app/b.py', 20, 1)
  const r = applyDispositions([a, b], { dispositions: [refute({ scope: { files: ['app/a.py'] } })] })
  assert.equal(r.applied, 1)
  assert.equal(r.findings.find((f) => f.id === a.id).status, 'refuted')
  assert.match(r.findings.find((f) => f.id === a.id).disposition_reason, /dispositioned by adjudication/)
  assert.equal(r.findings.find((f) => f.id === b.id).status, 'confirmed', 'out-of-scope file untouched')
  // a files scope carries NO time bound: the adjudicator read THAT locus, so even a
  // finding first seen later at the named file flips (the pre-A2 scoped path, unchanged)
  const late = det('app/a.py', 99, 7)
  const r2 = applyDispositions([late], { dispositions: [refute({ scope: { files: ['app/a.py'] } })] })
  assert.equal(r2.applied, 1, 'a files-scoped disposition is not time-gated')
  assert.equal(r2.findings.find((f) => f.id === late.id).status, 'refuted')
})

// ─────────────────────────────────────────────── BD3 as_of_pass covers <= N
check('BD3 as_of_pass: 2 flips matching findings with first_seen 1 AND first_seen 2', () => {
  const p1 = det('app/a.py', 10, 1)
  const p2 = det('app/b.py', 20, 2)
  assert.equal(p1.first_seen, 1, 'fixture sanity')
  assert.equal(p2.first_seen, 2, 'fixture sanity')
  const r = applyDispositions([p1, p2], { dispositions: [refute({ scope: { as_of_pass: 2 } })] })
  assert.equal(r.applied, 2, 'both findings are within the pass bound')
  assert.ok(r.findings.every((f) => f.status === 'refuted'))
  assert.ok(r.findings.every((f) => f.pending_readjudication === undefined), 'an in-bound flip carries no pending note')
})

// ─────────────────────────────────── BD4 a new locus is never auto-suppressed
check('BD4 first_seen: 3 under as_of_pass: 2 → status STAYS confirmed, annotated pending_readjudication, schema-valid', () => {
  const oldF = det('app/a.py', 10, 1)
  const newF = det('app/new.py', 5, 3)
  const r = applyDispositions([oldF, newF], { dispositions: [refute({ scope: { as_of_pass: 2 } })] })
  const out = r.findings.find((f) => f.id === newF.id)
  // THE assertion of the slice — on STATUS, not the annotation:
  assert.equal(out.status, 'confirmed', 'a finding nobody has looked at is NEVER suppressed')
  assert.equal(out.disposition_reason, undefined, 'no flip → no disposition_reason')
  assert.equal(out.adjusted_severity, newF.adjusted_severity, 'never a severity change')
  // the auditable annotation:
  assert.ok(typeof out.pending_readjudication === 'string' && out.pending_readjudication.length > 0)
  assert.match(out.pending_readjudication, /semgrep\/python\.lang\.security\.audit\.raw-sql/, 'names the matched adjudication')
  assert.match(out.pending_readjudication, /as of pass 2/, 'names the adjudication bound')
  assert.match(out.pending_readjudication, /re-adjudicate/, 'tells the operator what to do')
  // the annotated finding validates against $defs/finding (the schema declares the
  // annotation additively — requirement 5)
  assert.deepEqual(validateFinding(out), [])
  assert.ok(FINDING_DEF.properties.pending_readjudication, 'pending_readjudication declared in $defs/finding')
  assert.ok(!FINDING_DEF.required.includes('pending_readjudication'), 'additive — never required')
  // while the in-bound sibling flipped
  assert.equal(r.findings.find((f) => f.id === oldF.id).status, 'refuted')
  assert.equal(r.applied, 1)
})

// ─────────────────────────────────────────────── BD5 fail closed on missing data
check('BD5 FAIL CLOSED — first_seen absent / null / "1" → not flipped, annotated (a finding we cannot date is not adjudicated)', () => {
  const absent = det('app/x.py', 1, 1)
  delete absent.first_seen
  const nul = det('app/y.py', 2, 1, { first_seen: null })
  const str = det('app/z.py', 3, 1, { first_seen: '1' })
  const r = applyDispositions([absent, nul, str], { dispositions: [refute({ scope: { as_of_pass: 5 } })] })
  assert.equal(r.applied, 0, 'none of the undatable findings flips, even under a generous bound')
  for (const f of r.findings) {
    assert.equal(f.status, 'confirmed', `undatable finding ${f.id} stays in the open band`)
    assert.ok(typeof f.pending_readjudication === 'string' && f.pending_readjudication.length > 0, `undatable finding ${f.id} is annotated`)
    assert.match(f.pending_readjudication, /fail closed/, 'the note says WHY it did not apply')
  }
})

// ─────────────────────────────────────────────── BD6 the blast radius is visible
check('BD6 per-disposition counts returned + printed + in --json; a jointly-flipped merged parent credits EVERY contributing disposition', () => {
  // (a) pure: counts per disposition
  const a = det('app/a.py', 10, 1)
  const b = det('app/b.py', 20, 1)
  const c = det('app/c.py', 30, 3) // outside the bound → left pending
  const r = applyDispositions([a, b, c], { dispositions: [refute({ scope: { as_of_pass: 1 } })] })
  assert.equal(r.perDisposition.length, 1)
  const p = r.perDisposition[0]
  assert.equal(p.engine, 'semgrep')
  assert.equal(p.ruleId, RULE)
  assert.equal(p.matched, 3, 'matched counts every engine+ruleId hit, pending included')
  assert.equal(p.flipped, 2)
  assert.equal(p.pending, 1)
  assert.equal(p.files, 3, 'distinct normalized files across the matches')
  // (b) joint attribution: two dispositions each match ONE lens of a merged parent —
  // BOTH are credited with the flipped parent, never just the last one to match
  const parent = mergedParent(1, 1)
  const r2 = applyDispositions([parent], {
    dispositions: [
      dispFor('bandit', 'B105', { scope: { as_of_pass: 1 } }),
      dispFor('detect-secrets', 'Secret Keyword', { scope: { as_of_pass: 1 } }),
    ],
  })
  assert.equal(r2.applied, 1, 'the parent flipped (every lens matched)')
  assert.equal(r2.perDisposition.length, 2)
  for (const row of r2.perDisposition) {
    assert.equal(row.matched, 1, `${row.engine} credited with the matched parent`)
    assert.equal(row.flipped, 1, `${row.engine} credited with the jointly-flipped parent`)
    assert.equal(row.pending, 0)
  }
  // (c) the CLI prints one line per disposition and carries perDisposition in --json
  const d = mkdtempSync(join(tmpdir(), 'blast-radius-cli-'))
  dirs.push(d)
  mkdirSync(join(d, '.security-review'), { recursive: true })
  writeFileSync(
    join(d, '.security-review', 'audit-ledger.json'),
    JSON.stringify({ schema_version: '1', findings: [det('app/a.py', 10, 1), det('app/b.py', 20, 1)], passes: [] }, null, 2)
  )
  writeFileSync(
    join(d, '.security-review', 'deterministic-dispositions.json'),
    JSON.stringify({ dispositions: [refute({ scope: { as_of_pass: 1 } })] }, null, 2)
  )
  const out = node([APPLY, '--target', d, '--dry-run'])
  assert.match(
    out,
    new RegExp(`semgrep/${RULE.replace(/\./g, '\\.')} → refuted: 2 matched, 2 flipped, 0 pending \\(2 files\\)`),
    'the CLI prints the blast radius, one line per disposition'
  )
  const js = JSON.parse(node([APPLY, '--target', d, '--dry-run', '--json']))
  assert.ok(Array.isArray(js.perDisposition) && js.perDisposition.length === 1)
  assert.equal(js.perDisposition[0].matched, 2)
  assert.equal(js.perDisposition[0].flipped, 2)
})

// ─────────────────────────────────────────────── BD7 llm-inferred untouchable
check('BD7 an llm-inferred finding with matching engine+ruleId is NEVER touched — under either scope form', () => {
  const impostorA = llm({ engine: 'semgrep', ruleId: RULE })
  const impostorB = llm({ id: 'ab12cd34ef560788', provenance: 'llm-inferred', engine: 'semgrep', ruleId: RULE, file: 'app/a.py:10' })
  for (const scope of [{ files: ['app/a.py', 'app/routes.py'] }, { as_of_pass: 9 }]) {
    const r = applyDispositions([{ ...impostorA }, { ...impostorB }], { dispositions: [refute({ scope })] })
    assert.equal(r.applied, 0, `scope ${JSON.stringify(scope)} flips nothing llm-inferred`)
    for (const f of r.findings) {
      assert.equal(f.status, 'confirmed')
      assert.equal(f.disposition_reason, undefined)
      assert.equal(f.pending_readjudication, undefined, 'an llm-inferred finding is never even annotated')
    }
  }
})

// ─────────────────────────────── BD8 per-LENS gating (the parent-min regression lock)
check('BD8 as_of_pass gates on each LENS\'s own first_seen, NEVER the parent\'s fail-open min — one new lens keeps the parent open', () => {
  // lens A (bandit) first_seen 1, lens B (detect-secrets) first_seen 3; the parent's own
  // first_seen is the MIN → 1, which PASSES the as_of_pass: 2 bound. A builder gating on
  // the parent would flip it here — this check is the regression lock against that.
  const parent = mergedParent(1, 3)
  assert.equal(parent.first_seen, 1, 'fixture sanity: the parent min-first_seen is WITHIN the bound')
  const lensFS = parent.lenses.map((l) => l.first_seen).sort()
  assert.deepEqual(lensFS, [1, 3], 'fixture sanity: one old lens, one new lens')
  const r = applyDispositions([parent], {
    dispositions: [
      dispFor('bandit', 'B105', { scope: { as_of_pass: 2 } }),
      dispFor('detect-secrets', 'Secret Keyword', { scope: { as_of_pass: 2 } }),
    ],
  })
  const out = r.findings.find((f) => f.id === parent.id)
  assert.equal(out.status, 'confirmed', 'THE LOCK: the new lens is unmatched, so the every-lens-matched invariant keeps the parent OPEN')
  assert.equal(r.applied, 0)
  assert.equal(out.disposition_reason, undefined)
  assert.ok(typeof out.partial_disposition === 'string' && /1 of 2 lenses/.test(out.partial_disposition), 'the partial match is auditable')
  assert.ok(typeof out.pending_readjudication === 'string' && /re-adjudicate/.test(out.pending_readjudication), 'the time-excluded lens is annotated for re-adjudication')
  // and when EVERY lens is within the bound, the parent flips (the composition works)
  const oldParent = mergedParent(1, 2)
  const r2 = applyDispositions([oldParent], {
    dispositions: [
      dispFor('bandit', 'B105', { scope: { as_of_pass: 2 } }),
      dispFor('detect-secrets', 'Secret Keyword', { scope: { as_of_pass: 2 } }),
    ],
  })
  assert.equal(r2.applied, 1)
  assert.equal(r2.findings.find((f) => f.id === oldParent.id).status, 'refuted')
})

// ─────────────────────────────────────────────── BD9 idempotence + protected states
check('BD9 idempotent (2nd apply flips 0, byte-identical — pending annotations included); PROTECTED_STATES precedence holds under as_of_pass', () => {
  const input = [det('app/a.py', 10, 1), det('app/new.py', 5, 3), llm()]
  const disps = { dispositions: [refute({ scope: { as_of_pass: 1 } })] }
  const r1 = applyDispositions(input, disps)
  const r2 = applyDispositions(r1.findings, disps)
  assert.equal(r1.applied, 1)
  assert.equal(r2.applied, 0, 'a 2nd apply flips nothing')
  assert.equal(JSON.stringify(r1.findings), JSON.stringify(r2.findings), 'byte-identical re-run, pending annotation included')
  // protected states are never overwritten AND never annotated by the time gate
  for (const status of ['fixed', 'accepted_risk', 'superseded']) {
    const prot = det('app/p.py', 7, 3, { status })
    const r = applyDispositions([prot], { dispositions: [refute({ scope: { as_of_pass: 1 } })] })
    assert.equal(r.applied, 0)
    assert.equal(r.findings[0].status, status, `${status} is never overwritten`)
    assert.equal(r.findings[0].pending_readjudication, undefined, `${status} is owner/terminal — never annotated pending`)
  }
})

// ───────────────── BD10 THE END-TO-END LOCK — the REAL ingest assigns first_seen
check('BD10 real ingest stamps a pass-2 discovery first_seen: 2 (never 1), and an as_of_pass: 1 disposition CANNOT suppress it — both ingest paths', () => {
  const HELIOS_RULE = 'javascript.lang.security.detect-child-process.detect-child-process'
  // a pre-existing pass-1 finding of the SAME rule at another locus — the disposition's
  // legitimate target, proving the flip side works while the new locus is protected
  const preexisting = buildFinding({
    engine: 'semgrep', ruleId: HELIOS_RULE, severityNum: null, file: 'legacy/old.js', startLine: 5,
    message: 'Detected calls to child_process from a function argument', resources: [], classKey: null,
    repoRoot: '', pass: 1, bandFromTool: 'high', toolSevLabel: 'ERROR', dimensionHint: 'external-sast',
  })
  assert.equal(preexisting.first_seen, 1, 'fixture sanity')
  const seedLedger = () =>
    JSON.stringify(
      {
        schema_version: '1',
        findings: [preexisting],
        // pass 1 is CLOSED (merge-ledger appended it at pass end) — the ingest below runs
        // DURING pass 2, before pass 2 is appended: the exact production sequence.
        passes: [{ id: 1, tier: 'standard', dimensions: ['external-sast'], candidates: 1, confirmed: 1, refuted: 0, unverified: 0 }],
      },
      null,
      2
    )
  const dispositions = JSON.stringify(
    {
      dispositions: [
        {
          engine: 'semgrep',
          ruleId: HELIOS_RULE,
          disposition: 'refuted',
          reason: 'every flagged site present at pass 1 interpolates only static tokens',
          scope: { as_of_pass: 1 },
        },
      ],
    },
    null,
    2
  )

  // Path 1 — the journey wiring (`--all`, ingestAll): the invocation both skills use, bare
  // (no --pass), exactly as audit-codebase Step 4 and the run-scans tail run it.
  const d1 = mkdtempSync(join(tmpdir(), 'blast-radius-e2e-all-'))
  dirs.push(d1)
  mkdirSync(join(d1, '.security-review', 'evidence'), { recursive: true })
  writeFileSync(join(d1, '.security-review', 'audit-ledger.json'), seedLedger())
  copyFileSync(SEMGREP_FIXTURE, join(d1, '.security-review', 'evidence', 'semgrep.json'))
  node([INGEST, '--all', '--target', d1])
  // Path 2 — the per-scanner path (`--scanner semgrep --input …`), the Family-7 form.
  const d2 = mkdtempSync(join(tmpdir(), 'blast-radius-e2e-scanner-'))
  dirs.push(d2)
  mkdirSync(join(d2, '.security-review'), { recursive: true })
  writeFileSync(join(d2, '.security-review', 'audit-ledger.json'), seedLedger())
  node([INGEST, '--scanner', 'semgrep', '--input', SEMGREP_FIXTURE, '--target', d2])

  for (const [d, path] of [[d1, '--all'], [d2, '--scanner']]) {
    const ledger = readJSON(join(d, '.security-review', 'audit-ledger.json'))
    const fresh = ledger.findings.find((f) => f.ruleId === HELIOS_RULE && f.id !== preexisting.id)
    assert.ok(fresh, `${path}: the scanner report was ingested as a new finding`)
    // REQUIREMENT 0, asserted against the ENGINE's assignment — never fabricated:
    assert.equal(
      fresh.first_seen,
      2,
      `${path}: a finding discovered while pass 2 is in progress is first_seen: 2 — the in-progress pass, NOT the last completed one`
    )
    assert.equal(ledger.findings.find((f) => f.id === preexisting.id).first_seen, 1, `${path}: re-ingest preserves the original first_seen`)
    // now the disposition adjudicated "as of pass 1" arrives — the REAL apply CLI:
    writeFileSync(join(d, '.security-review', 'deterministic-dispositions.json'), dispositions)
    node([APPLY, '--target', d])
    const after = readJSON(join(d, '.security-review', 'audit-ledger.json'))
    const freshAfter = after.findings.find((f) => f.id === fresh.id)
    assert.equal(
      freshAfter.status,
      'confirmed',
      `${path}: THE POINT OF THE SLICE — the pass-2 discovery is NOT auto-refuted by a pass-1 adjudication`
    )
    assert.match(String(freshAfter.pending_readjudication), /re-adjudicate/, `${path}: it is annotated for re-adjudication`)
    assert.equal(
      after.findings.find((f) => f.id === preexisting.id).status,
      'refuted',
      `${path}: the pass-1 finding the adjudicator actually reviewed IS flipped`
    )
  }
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

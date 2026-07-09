#!/usr/bin/env node
/**
 * Standing test for A1 (0.8.102) — provenance survives the cross-dimension collapse.
 *
 * THE DEFECT THIS LOCKS OUT: `collapseCrossDimension` merged co-located findings from
 * different dimensions into one parent whose explode (`asLenses`) and rebuild
 * (`mergeLensCluster`) field lists STRIPPED `provenance`/`engine`/`ruleId`/`class`.
 * merge-ledger's absence-guard then stamped the field-less parent `llm-inferred`, so a
 * parent merging two DETERMINISTIC scanner lenses (the real cold-run case: bandit
 * B105/B106 + detect-secrets "Secret Keyword" at one locus) became (a) permanently
 * un-dispositionable — apply-dispositions only touches deterministic rows and matches
 * exact engine+ruleId, both destroyed — and (b) silently supersedable by
 * reconcile-provenance, which documents "a deterministic finding is never superseded."
 *
 * Guards:
 *   MP1  two deterministic lenses, different dimensions, same locus → parent
 *        `provenance:'deterministic'`; each `lenses[]` entry carries its OWN
 *        engine/ruleId (+ class only where the source finding carried one).
 *   MP2  one deterministic + one llm-inferred lens → parent `provenance:'llm-inferred'`
 *        (the conjunction rule — deterministic iff EVERY lens is deterministic).
 *   MP3  lenses DISAGREE on engine → parent carries NO top-level engine/ruleId
 *        (inventing one would let a disposition match a rule the partner never
 *        adjudicated — the per-lens records are the authority); lenses AGREE → the
 *        parent carries them.
 *   MP4  applyDispositions with dispositions covering EVERY lens → the merged
 *        deterministic parent flips to `refuted`, provenance/severity intact.
 *   MP5  THE SAFETY INVARIANT — dispositions covering only ONE of two lenses → the
 *        parent STAYS `confirmed` (a merged parent is a conjunction of observations;
 *        a partial flip would let a real finding hide behind a co-located FP). And the
 *        outer gate holds: an llm-inferred parent is never touched even by dispositions
 *        covering every lens.
 *   MP6  explode/collapse round-trip preserves all four fields and is idempotent —
 *        collapse(collapse(x)) is byte-identical and the lens quartet survives.
 *   MP7  regression lock on merge-ledger.mjs:222 + reconcile-provenance. The one-liner
 *        `if (!f.provenance) f.provenance = 'llm-inferred'` is inline module-level code,
 *        so it is REPLICATED here — against a parent built by the REAL
 *        collapseCrossDimension (a hand-built literal would pass against the pre-fix
 *        engine too, a tautology). The parent stays `deterministic`, and
 *        reconcileProvenance does not supersede it.
 *   MP8  determinism proof (the frozen-engine freeze bound): a findings array with NO
 *        cross-dimension co-location collapses to bytes IDENTICAL to the pre-change
 *        engine's output, pinned in acceptance/fixtures/mp8-no-colocation-collapse.txt
 *        (generated at 27a5ec7, before this fix).
 *   MP9  incremental-re-run lock — the ledger is incremental and the cold run ran TWO
 *        passes. This drives the REAL merge-ledger.mjs CLI twice over a seeded ledger:
 *        pass 1's collapse builds a deterministic merged parent, pass 2's explodeForMerge
 *        + re-collapse must KEEP it deterministic (before the A1 explodeForMerge fix, the
 *        explode stripped the lenses' provenance and pass 2 relabeled the parent
 *        llm-inferred). Asserts the parent stays deterministic AND stays dispositionable
 *        after pass 2, and every pass-2 finding validates against $defs/finding.
 *
 * Dependency-free: `node acceptance/test-merged-parent-provenance.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { collapseCrossDimension } from '../harness/finding-clusters.mjs'
import { applyDispositions } from '../harness/apply-dispositions.mjs'
import { reconcileProvenance } from '../harness/reconcile-provenance.mjs'
import { buildFinding } from '../harness/ingest-scanner-findings.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const MERGE = join(PLUGIN, 'harness', 'merge-ledger.mjs')
const SCHEMA_PATH = join(PLUGIN, 'templates', 'audit-ledger.schema.json')

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

// ---- a temp git repo (merge-ledger.mjs stamps `audited_commit` from `git rev-parse`) ----
function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'mp9-merge-'))
  dirs.push(dir)
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t.t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  writeFileSync(join(dir, 'f.txt'), 'x')
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir })
  mkdirSync(join(dir, '.security-review'), { recursive: true })
  return dir
}
// drive the REAL merge-ledger CLI for one pass (empty ledger_updates → the collapse
// re-runs over the existing ledger, exactly the incremental-re-run path) and return the
// on-disk ledger.
function runMerge(dir, passN) {
  const rp = join(dir, '.security-review', `result-${passN}.json`)
  writeFileSync(rp, JSON.stringify({ ledger_updates: [], dimensions_run: ['external-sast', 'secrets-credentials'], total_candidates: 0 }))
  execFileSync('node', [MERGE, '--repo', dir, '--result', rp, '--date', '2026-06-17', '--pass', String(passN), '--tier', 'standard'], { encoding: 'utf8' })
  return JSON.parse(readFileSync(join(dir, '.security-review', 'audit-ledger.json'), 'utf8'))
}
// a compact $defs/finding validator (mirrors the sibling tests) incl. the deterministic
// ⇒ engine+ruleId conditional and its merged-parent (`lenses` present) exemption.
const SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'))
const FINDING_DEF = SCHEMA.$defs.finding
function validateFinding(f) {
  const errors = []
  for (const r of FINDING_DEF.required) if (!(r in f)) errors.push(`missing required '${r}'`)
  const allowed = new Set(Object.keys(FINDING_DEF.properties))
  for (const k of Object.keys(f)) if (!allowed.has(k)) errors.push(`additional property '${k}'`)
  // the deterministic⇒engine+ruleId conditional, exempted for merged parents (lenses present)
  if (f.provenance === 'deterministic' && !(Array.isArray(f.lenses) && f.lenses.length)) {
    if (!('engine' in f)) errors.push('deterministic non-parent missing engine')
    if (!('ruleId' in f)) errors.push('deterministic non-parent missing ruleId')
  }
  return errors
}

// ---- fixtures: the REAL cold-run shape — two deterministic engines, one locus ----
// bandit B105 is a tool→band finding (owns no class, dimension external-sast);
// detect-secrets "Secret Keyword" is a class-severity finding (class hardcoded-secrets,
// dimension secrets-credentials). Same file:line → same locus, different dimensions.
const LOCUS_FILE = 'apps/api/app/core/config.py'
const LOCUS_LINE = 41
const banditB105 = () =>
  buildFinding({
    engine: 'bandit',
    ruleId: 'B105',
    severityNum: null,
    file: LOCUS_FILE,
    startLine: LOCUS_LINE,
    message: 'hardcoded password string',
    resources: [],
    classKey: null,
    repoRoot: '',
    pass: 1,
    bandFromTool: 'high',
    toolSevLabel: 'HIGH',
    dimensionHint: 'external-sast',
  })
const detectSecrets = () =>
  buildFinding({
    engine: 'detect-secrets',
    ruleId: 'Secret Keyword',
    severityNum: null,
    file: LOCUS_FILE,
    startLine: LOCUS_LINE,
    message: 'secret keyword detected',
    resources: [],
    classKey: 'hardcoded-secrets',
    repoRoot: '',
    pass: 1,
    dimensionHint: null,
  })
// an llm-inferred finding at the SAME locus in a third dimension (no provenance field —
// the pre-0.8.93 absence-default; MP2 also exercises the explicit label)
const llmAtLocus = (over = {}) => ({
  id: 'ab12cd34ef560789',
  dimension: 'secrets-management',
  title: 'Credential material reachable in config',
  severity: 'high',
  adjusted_severity: 'high',
  file: `${LOCUS_FILE}:${LOCUS_LINE}`,
  status: 'confirmed',
  first_seen: 1,
  last_seen: 1,
  verdict: 'confirmed_real',
  verdict_reasoning: 'reasoned over the code: the default password reaches the login path',
  ...over,
})
// the real engine's merged deterministic parent (bandit + detect-secrets, one locus)
const mergedDetParent = () => {
  const out = collapseCrossDimension([banditB105(), detectSecrets()])
  assert.equal(out.length, 1, 'fixture sanity: the two deterministic lenses merged')
  assert.ok(Array.isArray(out[0].lenses) && out[0].lenses.length === 2, 'fixture sanity: 2 lenses')
  return out[0]
}
const disp = (engine, ruleId, over = {}) => ({
  engine,
  ruleId,
  disposition: 'refuted',
  reason: `${engine} ${ruleId} flags a seeded demo credential; not reachable in production`,
  ...over,
})

console.log('merged-parent-provenance standing test (A1)')

check('MP1 two deterministic lenses (different dimensions, one locus) → parent provenance:deterministic; each lens carries its own engine/ruleId/class', () => {
  const p = mergedDetParent()
  assert.equal(p.provenance, 'deterministic', 'every lens deterministic → the parent is deterministic')
  assert.deepEqual(p.merged_dimensions, ['external-sast', 'secrets-credentials'])
  const bandit = p.lenses.find((l) => l.dimension === 'external-sast')
  const ds = p.lenses.find((l) => l.dimension === 'secrets-credentials')
  assert.ok(bandit && ds, 'both lenses present')
  assert.equal(bandit.provenance, 'deterministic')
  assert.equal(bandit.engine, 'bandit')
  assert.equal(bandit.ruleId, 'B105')
  assert.ok(!('class' in bandit), 'a tool→band lens owns no class — the field is ABSENT, not null')
  assert.equal(ds.provenance, 'deterministic')
  assert.equal(ds.engine, 'detect-secrets')
  assert.equal(ds.ruleId, 'Secret Keyword')
  assert.equal(ds.class, 'hardcoded-secrets', 'a mapped-class lens keeps its owned class')
})

check('MP2 one deterministic + one llm-inferred lens → parent provenance:llm-inferred (the conjunction rule)', () => {
  const absent = collapseCrossDimension([banditB105(), llmAtLocus()])
  assert.equal(absent.length, 1)
  assert.equal(absent[0].provenance, 'llm-inferred', 'an absent-provenance lens is not deterministic — the parent is llm-inferred')
  const labeled = collapseCrossDimension([banditB105(), llmAtLocus({ provenance: 'llm-inferred' })])
  assert.equal(labeled.length, 1)
  assert.equal(labeled[0].provenance, 'llm-inferred', 'an explicitly-labeled llm lens gives the same conjunction result')
})

check('MP3 lenses disagreeing on engine → NO top-level engine/ruleId on the parent; agreeing lenses → the parent carries them', () => {
  // DISAGREE — the real bandit + detect-secrets parent has two engines and two ruleIds
  const p = mergedDetParent()
  assert.ok(!('engine' in p), 'disagreeing engines → the parent must not carry (or invent) one')
  assert.ok(!('ruleId' in p), 'disagreeing ruleIds → the parent must not carry (or invent) one')
  assert.ok(!('class' in p), 'disagreeing classes (one lens owns none) → absent on the parent')
  // AGREE — same engine/ruleId/class seen through two dimensions
  const mk = (id, dimension) => ({
    id, dimension, title: 'S1000: raw sql', severity: 'high', adjusted_severity: 'high',
    file: 'app/db.py:7', status: 'confirmed', first_seen: 1, last_seen: 1,
    verdict: 'confirmed_real', verdict_reasoning: 'r', evidence: 'e',
    provenance: 'deterministic', engine: 'semgrep', ruleId: 'S1000', class: 'crud-fls',
  })
  const agree = collapseCrossDimension([mk('aaaa000011112222', 'apex-exposed-surface'), mk('bbbb000011112222', 'tenant-isolation')])
  assert.equal(agree.length, 1)
  assert.equal(agree[0].provenance, 'deterministic')
  assert.equal(agree[0].engine, 'semgrep', 'all lenses agree → the parent carries the engine')
  assert.equal(agree[0].ruleId, 'S1000', 'all lenses agree → the parent carries the ruleId')
  assert.equal(agree[0].class, 'crud-fls', 'all lenses agree → the parent carries the class')
})

check('MP4 dispositions covering EVERY lens → the merged deterministic parent flips to refuted (provenance/severity intact)', () => {
  const p = mergedDetParent()
  const { findings, applied, appliedIds } = applyDispositions([p], {
    dispositions: [disp('bandit', 'B105'), disp('detect-secrets', 'Secret Keyword')],
  })
  assert.equal(applied, 1)
  assert.deepEqual(appliedIds, [p.id])
  const out = findings.find((f) => f.id === p.id)
  assert.equal(out.status, 'refuted', 'every lens matched → the parent leaves the open band')
  assert.match(out.disposition_reason, /all 2 lenses/)
  assert.match(out.disposition_reason, /bandit\/B105/)
  assert.match(out.disposition_reason, /detect-secrets\/Secret Keyword/)
  assert.equal(out.partial_disposition, undefined, 'a full flip carries no partial annotation')
  // the flip is a layer, never a rewrite
  assert.equal(out.provenance, 'deterministic')
  assert.equal(out.adjusted_severity, p.adjusted_severity)
  assert.equal(out.verdict, p.verdict)
  assert.equal(JSON.stringify(out.lenses), JSON.stringify(p.lenses), 'the lenses are untouched')
})

check('MP5 THE SAFETY INVARIANT — a disposition covering only ONE of two lenses NEVER flips the parent (status stays confirmed)', () => {
  const p = mergedDetParent()
  const { findings, applied, appliedIds } = applyDispositions([p], {
    dispositions: [disp('bandit', 'B105')], // covers ONE lens; detect-secrets is unmatched
  })
  const out = findings.find((f) => f.id === p.id)
  assert.equal(out.status, 'confirmed', 'a partial match must never clear a merged parent — a real finding could hide behind a co-located FP')
  assert.equal(applied, 0)
  assert.deepEqual(appliedIds, [])
  assert.equal(out.disposition_reason, undefined, 'no flip → no disposition_reason')
  // the outer gate: an llm-inferred parent (mixed lenses) is never touched, even by
  // dispositions naming every lens's engine/ruleId
  const mixed = collapseCrossDimension([banditB105(), llmAtLocus()])[0]
  assert.equal(mixed.provenance, 'llm-inferred')
  const r2 = applyDispositions([mixed], {
    dispositions: [disp('bandit', 'B105'), disp('detect-secrets', 'Secret Keyword')],
  })
  assert.equal(r2.findings.find((f) => f.id === mixed.id).status, 'confirmed', 'an llm-inferred parent is untouchable here')
  assert.equal(r2.applied, 0)
})

check('MP6 explode/collapse round-trip preserves all four fields and is idempotent (byte-identical re-collapse)', () => {
  const once = collapseCrossDimension([banditB105(), detectSecrets()])
  const twice = collapseCrossDimension(once)
  assert.equal(JSON.stringify(twice), JSON.stringify(once), 'collapse(collapse(x)) === collapse(x)')
  const p = twice[0]
  assert.equal(p.provenance, 'deterministic', 'the parent provenance survives the round trip')
  for (const [dim, engine, ruleId] of [['external-sast', 'bandit', 'B105'], ['secrets-credentials', 'detect-secrets', 'Secret Keyword']]) {
    const l = p.lenses.find((x) => x.dimension === dim)
    assert.ok(l, `${dim} lens survives`)
    assert.equal(l.provenance, 'deterministic', `${dim} lens keeps provenance through the explode`)
    assert.equal(l.engine, engine, `${dim} lens keeps engine through the explode`)
    assert.equal(l.ruleId, ruleId, `${dim} lens keeps ruleId through the explode`)
  }
  assert.equal(p.lenses.find((x) => x.dimension === 'secrets-credentials').class, 'hardcoded-secrets', 'the owned class survives the round trip')
})

check('MP7 regression lock — merge-ledger\'s absence-guard no longer relabels a merged deterministic parent; reconcile never supersedes it', () => {
  // The guard at harness/merge-ledger.mjs:222 is inline module-level code, so the
  // one-liner is replicated here — against a parent from the REAL engine (a hand-built
  // literal with provenance:'deterministic' would pass against the pre-fix engine too).
  const findings = [mergedDetParent()]
  for (const f of findings) if (!f.provenance) f.provenance = 'llm-inferred'
  assert.equal(findings[0].provenance, 'deterministic', 'the parent self-declares, so the absence-guard is a structural no-op for it')
  // reconcile-provenance: "a deterministic finding is never superseded" now holds for
  // merged parents too. The adversary: a co-located deterministic class OWNER whose
  // dimension matches the parent's base dimension — pre-fix (field-less parent read as
  // llm-inferred) this superseded the parent; post-fix it must not.
  const owner = {
    id: 'cccc000011112222',
    dimension: findings[0].dimension, // the parent's base dimension — the fallback match path
    title: 'owner', severity: 'high', adjusted_severity: 'high',
    file: `${LOCUS_FILE}:${LOCUS_LINE}`, status: 'confirmed', first_seen: 1, last_seen: 1,
    verdict: 'confirmed_real', verdict_reasoning: 'r', evidence: 'e',
    provenance: 'deterministic', engine: 'gitleaks', ruleId: 'generic-api-key', class: 'hardcoded-secrets',
  }
  const { findings: rec, superseded } = reconcileProvenance([findings[0], owner])
  assert.equal(superseded, 0, 'a merged deterministic parent is never superseded')
  assert.equal(rec.find((f) => f.id === findings[0].id).status, 'confirmed')
  assert.equal(rec.find((f) => f.id === findings[0].id).superseded_by, undefined)
})

check('MP8 determinism proof — a no-co-location findings array collapses byte-identically to the pre-change engine (pinned fixture)', () => {
  // .txt, not .json: test-determinism-band sweeps every TOP-LEVEL fixtures/*.json into
  // its hermetic evidence corpus and fails if an adapter cannot parse it. This file is
  // engine IO (collapse input + pinned expected bytes), not scanner evidence — the
  // extension keeps it out of that sweep (the regexploit-seeded.txt precedent).
  const { input, expected } = JSON.parse(
    readFileSync(join(PLUGIN, 'acceptance', 'fixtures', 'mp8-no-colocation-collapse.txt'), 'utf8')
  )
  assert.ok(Array.isArray(input) && input.length >= 5, 'fixture sanity: the pinned input is present')
  assert.equal(
    JSON.stringify(collapseCrossDimension(input)),
    expected,
    'the collapse of a no-merge input must be byte-identical to the 27a5ec7 (pre-fix) engine output'
  )
})

check('MP9 incremental-re-run lock — the merged deterministic parent stays deterministic + dispositionable after a SECOND real merge-ledger pass', () => {
  // The ledger is incremental by design and the real cold run executed two passes. Pass
  // 1's collapse produces a deterministic merged parent; pass 2 EXPLODES it (the REAL
  // merge-ledger.mjs explodeForMerge) and re-collapses. Before the A1 explodeForMerge
  // fix, pass 2's explode stripped the lenses' provenance and the re-collapse relabeled
  // the parent llm-inferred — silently reintroducing the un-dispositionable phantom
  // HIGHs on every re-run. This drives the ACTUAL CLI twice (not a replica of the
  // one-liner — a replica would pass against the broken code, a tautology; cf. MP6/MP7).
  const d = gitRepo()
  // seed the ledger with two co-located DETERMINISTIC scanner findings (the cold-run
  // shape: bandit + detect-secrets at one locus) — the shape ingest-scanner-findings
  // writes with provenance:'deterministic'.
  const bandit = buildFinding({
    engine: 'bandit', ruleId: 'B105', severityNum: null, file: 'app/config.py', startLine: 41,
    message: 'hardcoded password string', resources: [], classKey: null, repoRoot: '', pass: 1,
    bandFromTool: 'high', toolSevLabel: 'HIGH', dimensionHint: 'external-sast',
  })
  const ds = buildFinding({
    engine: 'detect-secrets', ruleId: 'Secret Keyword', severityNum: null, file: 'app/config.py', startLine: 41,
    message: 'secret keyword detected', resources: [], classKey: 'hardcoded-secrets', repoRoot: '', pass: 1, dimensionHint: null,
  })
  writeFileSync(
    join(d, '.security-review', 'audit-ledger.json'),
    JSON.stringify({ schema_version: '1', findings: [bandit, ds], passes: [] }, null, 2)
  )

  const l1 = runMerge(d, 1)
  const p1 = l1.findings.find((f) => Array.isArray(f.lenses))
  assert.ok(p1, 'pass 1 produced a cross-dimension merged parent')
  assert.equal(p1.provenance, 'deterministic', 'pass 1: the parent is deterministic (the fix on the first pass)')
  assert.equal(p1.lenses.length, 2)

  const l2 = runMerge(d, 2)
  const p2 = l2.findings.find((f) => Array.isArray(f.lenses))
  assert.ok(p2, 'pass 2 still carries the merged parent (explode → re-collapse)')
  assert.equal(
    p2.provenance,
    'deterministic',
    'THE INCREMENTAL LOCK: the parent is STILL deterministic after a second pass — explodeForMerge preserved the lenses\' provenance'
  )
  assert.ok(p2.lenses.every((l) => l.provenance === 'deterministic'), 'every lens keeps its provenance through the pass-2 explode')

  // and it is still dispositionable — the whole point (the phantom HIGHs can be cleared)
  const disp = (engine, ruleId) => ({ engine, ruleId, disposition: 'refuted', reason: 'seeded demo credential; not reachable in production' })
  const r = applyDispositions(l2.findings, { dispositions: [disp('bandit', 'B105'), disp('detect-secrets', 'Secret Keyword')] })
  assert.equal(r.applied, 1, 'the pass-2 parent is still dispositionable')
  assert.equal(r.findings.find((f) => Array.isArray(f.lenses)).status, 'refuted', 'apply-dispositions clears it out of the open band after pass 2')

  // the coordinator's exemption check: every pass-2 ledger finding validates against
  // $defs/finding — the merged parent via the `lenses`-present exemption, and any plain
  // exploded deterministic row still carrying engine+ruleId.
  for (const f of l2.findings) assert.deepEqual(validateFinding(f), [], `pass-2 finding ${f.id} validates against the schema`)
})

for (const d of dirs) {
  try {
    rmSync(d, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

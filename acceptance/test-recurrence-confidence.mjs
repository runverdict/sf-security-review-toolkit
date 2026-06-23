#!/usr/bin/env node
/**
 * Standing test for harness/recurrence-confidence.mjs — the deterministic engine
 * that classifies findings by how reliably they recur across N independent run
 * ledgers of the same codebase (docs/recurrence-confidence.md).
 *
 * Guards the load-bearing refutation result: the toolkit reliably finds the
 * unambiguous blockers, but the contestable band is an UNSTABLE sample — so the
 * engine must make that variance VISIBLE and never assert global completeness.
 *
 * Self-contained + dependency-free: INLINE synthetic fixtures (files A/B/C/D…, no
 * Solano specifics), so the suite runs in CI without the off-repo real ledgers.
 *   node acceptance/test-recurrence-confidence.mjs
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { classifyRecurrence, jaccard } from '../harness/recurrence-confidence.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const ENGINE = join(PLUGIN, 'harness', 'recurrence-confidence.mjs')

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

console.log('recurrence-confidence standing test')

// --- fixture helpers -------------------------------------------------------
// A confirmed (open) finding. Severity is the authoritative adjusted_severity.
const conf = (file, sev, title, dim = 'apex-exposed-surface') => ({
  id: 'x', dimension: dim, title, severity: sev, adjusted_severity: sev,
  file, status: 'confirmed', verdict: 'confirmed_real',
  first_seen: 1, last_seen: 1, verdict_reasoning: 'r', evidence: 'e',
})
const ref = (file, sev, title, dim = 'apex-exposed-surface') => ({
  id: 'x', dimension: dim, title, severity: sev, adjusted_severity: sev,
  file, status: 'refuted', verdict: 'false_positive',
  first_seen: 1, last_seen: 1, verdict_reasoning: 'r', evidence: 'e',
})
const led = (...findings) => ({ schema_version: '1', findings, passes: [] })
// Find the single locus whose canonical file matches `f`.
const locusFor = (out, f) => out.loci.filter((l) => l.file === f)

// --- 1. all-runs, confirmed at one severity → high + a blocker -------------
check('1 confirmed at the same severity in all N → all_runs, stable, confidence=high, blocker-listed', () => {
  const out = classifyRecurrence([
    led(conf('force-app/classes/A.cls:10-20', 'high', 'FLS gap in A')),
    led(conf('force-app/classes/A.cls:10-20', 'high', 'FLS gap in A')),
    led(conf('force-app/classes/A.cls:10-20', 'high', 'FLS gap in A')),
  ])
  const ls = locusFor(out, 'force-app/classes/A.cls')
  assert.equal(ls.length, 1, 'one locus for A')
  const l = ls[0]
  assert.equal(l.recurrence_bucket, 'all_runs')
  assert.equal(l.severity_stable, true)
  assert.equal(l.status_stable, true)
  assert.equal(l.confirmed_count, 3)
  assert.equal(l.confidence, 'high')
  assert.equal(l.stability_note, 'confirmed at high in all 3 runs')
  assert.ok(out.summary.reliably_recurring_blockers.some((b) => b.file === 'force-app/classes/A.cls'),
    'crit/high all-runs-stable locus is a reliably-recurring blocker')
  assert.equal(out.summary.bucket_counts.all_runs_stable, 1)
})

// --- 2. confirmed → refuted → absent (the contestable flip) ----------------
check('2 confirmed run1, refuted run2, absent run3 → some_runs, status_stable=false, confidence=review', () => {
  const out = classifyRecurrence([
    led(conf('force-app/classes/B.cls:5-9', 'high', 'PII exposure in B')),
    led(ref('force-app/classes/B.cls:5-9', 'info', 'PII exposure in B (refuted)')),
    led(conf('force-app/classes/Z.cls:1', 'low', 'unrelated')),
  ])
  const l = locusFor(out, 'force-app/classes/B.cls')[0]
  assert.equal(l.recurrence_bucket, 'some_runs')
  assert.equal(l.present_count, 2)
  assert.equal(l.confirmed_count, 1)
  assert.equal(l.status_stable, false)
  assert.equal(l.confidence, 'review')
  assert.match(l.stability_note, /run1 confirmed \(high\); run2 refuted \(info\); run3 absent/)
  assert.ok(!out.summary.reliably_recurring_blockers.some((b) => b.file === 'force-app/classes/B.cls'),
    'a status-flipping finding is NOT a reliably-recurring blocker')
})

// --- 3. present all N but severity drifts → all_runs, severity_stable=false -
check('3 present all N, adjusted_severity varies (medium/high/medium) → all_runs, severity_stable=false, review', () => {
  const out = classifyRecurrence([
    led(conf('force-app/classes/C.cls:1-3', 'medium', 'over-grant in C')),
    led(conf('force-app/classes/C.cls:1-3', 'high', 'over-grant in C')),
    led(conf('force-app/classes/C.cls:1-3', 'medium', 'over-grant in C')),
  ])
  const l = locusFor(out, 'force-app/classes/C.cls')[0]
  assert.equal(l.recurrence_bucket, 'all_runs')
  assert.equal(l.confirmed_count, 3)
  assert.equal(l.status_stable, true, 'all confirmed → status stable')
  assert.equal(l.severity_stable, false, 'medium/high/medium → NOT severity stable')
  assert.equal(l.confidence, 'review', 'severity drift blocks confidence=high')
  assert.equal(out.summary.bucket_counts.all_runs_unstable >= 1, true)
  assert.ok(!out.summary.reliably_recurring_blockers.some((b) => b.file === 'force-app/classes/C.cls'),
    'severity-unstable all-runs is NOT a reliably-recurring blocker')
})

// --- 4. present in exactly one run → single_run, investigate ---------------
check('4 present in exactly one run → single_run, confidence=investigate', () => {
  const out = classifyRecurrence([
    led(conf('force-app/classes/D.cls:7', 'medium', 'lone finding in D')),
    led(conf('force-app/classes/Z.cls:1', 'low', 'unrelated')),
    led(conf('force-app/classes/Z.cls:1', 'low', 'unrelated')),
  ])
  const l = locusFor(out, 'force-app/classes/D.cls')[0]
  assert.equal(l.recurrence_bucket, 'single_run')
  assert.equal(l.present_count, 1)
  assert.equal(l.confidence, 'investigate')
})

// --- 5. line-span matching: overlap merges, non-overlap stays separate ------
check('5a overlapping spans across runs ("X:21-26" vs "X:19-25") MATCH → one locus, all_runs', () => {
  const out = classifyRecurrence([
    led(conf('force-app/classes/E.cls:21-26', 'high', 'E lens one')),
    led(conf('force-app/classes/E.cls:19-25', 'high', 'E lens two')),
  ])
  const ls = locusFor(out, 'force-app/classes/E.cls')
  assert.equal(ls.length, 1, 'overlapping spans collapse to ONE locus')
  assert.equal(ls[0].recurrence_bucket, 'all_runs')
  assert.deepEqual(ls[0].line_span, { lo: 19, hi: 26 }, 'span is the union of the overlapping spans')
})
check('5b SAME file, NON-overlapping spans ("X:10-15" vs "X:40-45") stay SEPARATE (under-merge safe failure)', () => {
  const out = classifyRecurrence([
    led(conf('force-app/classes/F.cls:10-15', 'high', 'F upper')),
    led(conf('force-app/classes/F.cls:40-45', 'high', 'F lower')),
  ])
  const ls = locusFor(out, 'force-app/classes/F.cls')
  assert.equal(ls.length, 2, ':10-15 and :40-45 do not overlap → two loci')
  assert.ok(ls.every((l) => l.recurrence_bucket === 'single_run'))
})

// --- 5c absolute-vs-relative path reconciliation (the real-ledger case) ----
check('5c same file cited repo-relative vs absolute (path-suffix) MATCHES → all_runs', () => {
  const out = classifyRecurrence([
    led(conf('force-app/main/default/classes/G.cls:21-26', 'high', 'G defect')),
    led(conf('home/u/proj/force-app/main/default/classes/G.cls:21-26', 'high', 'G defect')),
  ])
  // canonical file is the most repo-relative form
  const ls = locusFor(out, 'force-app/main/default/classes/G.cls')
  assert.equal(ls.length, 1, 'absolute + relative cite of one file collapse to ONE locus')
  assert.equal(ls[0].recurrence_bucket, 'all_runs')
})

// --- 5d a BARE BASENAME must NOT bridge unrelated deeper paths (over-merge guard) ---
check('5d bare basename does NOT over-merge: package.json in three DIFFERENT dirs → three single_run loci', () => {
  const out = classifyRecurrence([
    led(conf('package.json:1-5', 'high', 'dep flaw')),
    led(conf('frontend/package.json:1-5', 'high', 'dep flaw')),
    led(conf('backend/package.json:1-5', 'high', 'dep flaw')),
  ])
  const ls = out.loci.filter((l) => l.file.endsWith('package.json'))
  assert.equal(ls.length, 3, 'a bare "package.json" must NOT be a suffix of frontend/ or backend/ paths')
  assert.ok(ls.every((l) => l.recurrence_bucket === 'single_run'), 'three different files → three single_run loci')
  assert.ok(ls.every((l) => l.confidence === 'investigate'), 'NOT all_runs/high — that would be false confidence')
})
// --- 5e companion positive: an IDENTICAL bare-basename cite still merges (exact equality) ---
check('5e an identical root-level single-segment file (Dockerfile:1-3) cited in two runs DOES merge', () => {
  const out = classifyRecurrence([
    led(conf('Dockerfile:1-3', 'medium', 'root image flaw')),
    led(conf('Dockerfile:1-3', 'medium', 'root image flaw')),
  ])
  const ls = out.loci.filter((l) => l.file === 'Dockerfile')
  assert.equal(ls.length, 1, 'exact same single-segment path → ONE locus (the floor only blocks differing-depth bridges)')
  assert.equal(ls[0].recurrence_bucket, 'all_runs')
})

// --- 5f two-phase anti-bridge: a broad REFUTED finding must NOT fuse two disjoint CONFIRMED defects ---
check('5f a broad refuted finding overlapping two disjoint confirmed defects does NOT merge them', () => {
  const out = classifyRecurrence([
    led(conf('src/svc.js:3', 'high', 'defect at top'), conf('src/svc.js:6-10', 'high', 'defect below'), ref('src/svc.js:1-14', 'low', 'whole-function FP')),
    led(conf('src/svc.js:3', 'high', 'defect at top'), conf('src/svc.js:6-10', 'high', 'defect below')),
  ])
  const ls = locusFor(out, 'src/svc.js').filter((l) => l.confirmed_count > 0)
  assert.equal(ls.length, 2, 'the broad refuted :1-14 attaches without bridging :3 and :6-10 into one locus')
  const spans = ls.map((l) => `${l.line_span.lo}-${l.line_span.hi}`).sort()
  assert.ok(spans.some((s) => s.startsWith('3-')) , 'the :3 defect stays its own locus')
  assert.ok(ls.every((l) => l.recurrence_bucket === 'all_runs'), 'each confirmed defect recurs in both runs')
})

// --- 6. determinism --------------------------------------------------------
check('6 running twice on the same inputs yields byte-identical JSON', () => {
  const ledgers = [
    led(conf('force-app/classes/A.cls:10-20', 'high', 'FLS gap in A'), ref('server/index.js:30-34', 'low', 'rate limit')),
    led(conf('force-app/classes/A.cls:11-21', 'high', 'FLS gap in A'), conf('server/index.js:7', 'info', 'content-type')),
    led(conf('force-app/classes/A.cls:10-20', 'high', 'FLS gap in A')),
  ]
  const a = JSON.stringify(classifyRecurrence(ledgers, { ledgerPaths: ['p1', 'p2', 'p3'] }), null, 2)
  const b = JSON.stringify(classifyRecurrence(ledgers, { ledgerPaths: ['p1', 'p2', 'p3'] }), null, 2)
  assert.equal(a, b, 'pure + deterministic')
})

// --- 7. fail-closed --------------------------------------------------------
check('7a a ledger whose findings is a non-array (object) is treated as empty, no crash', () => {
  const out = classifyRecurrence([
    { schema_version: '1', findings: { not: 'an array' }, passes: [] },
    led(conf('force-app/classes/A.cls:10-20', 'high', 'FLS gap in A')),
  ])
  assert.equal(out.summary.n_runs, 2)
  // only run 2 contributed a finding
  const l = locusFor(out, 'force-app/classes/A.cls')[0]
  assert.equal(l.present_count, 1)
  assert.equal(l.recurrence_bucket, 'single_run')
})
check('7b a missing ledger path → CLI exit 2', () => {
  let code = 0
  try { execFileSync('node', [ENGINE, '--ledger', '/no/such/ledger-does-not-exist.json'], { stdio: 'pipe' }) }
  catch (e) { code = e.status }
  assert.equal(code, 2, 'unreadable ledger fails closed with exit 2')
})
check('7c a non-JSON ledger → CLI exit 2; zero --ledger → exit 2', () => {
  const d = mkdtempSync(join(tmpdir(), 'rec-conf-')); dirs.push(d)
  const bad = join(d, 'bad.json'); writeFileSync(bad, 'not json {')
  let code = 0
  try { execFileSync('node', [ENGINE, '--ledger', bad], { stdio: 'pipe' }) } catch (e) { code = e.status }
  assert.equal(code, 2, 'non-JSON ledger → exit 2')
  let code2 = 0
  try { execFileSync('node', [ENGINE], { stdio: 'pipe' }) } catch (e) { code2 = e.status }
  assert.equal(code2, 2, 'no --ledger → exit 2')
})
check('7d CLI happy path + --out write produce identical, parseable JSON', () => {
  const d = mkdtempSync(join(tmpdir(), 'rec-conf-')); dirs.push(d)
  const p1 = join(d, 'r1.json'); const p2 = join(d, 'r2.json'); const o = join(d, 'out.json')
  writeFileSync(p1, JSON.stringify(led(conf('force-app/classes/A.cls:10-20', 'high', 'FLS gap in A'))))
  writeFileSync(p2, JSON.stringify(led(conf('force-app/classes/A.cls:10-20', 'high', 'FLS gap in A'))))
  const stdout = execFileSync('node', [ENGINE, '--ledger', p1, '--ledger', p2, '--out', o], { encoding: 'utf8' })
  const parsed = JSON.parse(stdout)
  assert.equal(parsed.schema_version, '1')
  assert.equal(parsed.summary.n_runs, 2)
  const written = JSON.parse(execFileSync('cat', [o], { encoding: 'utf8' }))
  assert.equal(JSON.stringify(parsed), JSON.stringify(written), '--out matches stdout')
})

// --- 8. N=1 edge -----------------------------------------------------------
check('8 N=1: every locus is single_run and the caveat names the no-recurrence-signal condition', () => {
  const out = classifyRecurrence([
    led(conf('force-app/classes/A.cls:10-20', 'high', 'FLS gap in A'), conf('force-app/classes/C.cls:1', 'medium', 'C')),
  ])
  assert.equal(out.summary.n_runs, 1)
  assert.ok(out.loci.length >= 1)
  assert.ok(out.loci.every((l) => l.recurrence_bucket === 'single_run'), 'one run → no recurrence, all single_run')
  assert.ok(out.loci.every((l) => l.confidence === 'investigate'))
  assert.match(out.caveat, /no recurrence signal/i)
  assert.match(out.caveat, /single run|only one run|re-run/i)
})

// --- 9. pairwise Jaccard math, hand-checkable ------------------------------
check('9 pairwise Jaccard: shared 2 / union 3 → 0.67', () => {
  // run1 confirms {A,B}; run2 confirms {A,B,C}; shared=2, union=3.
  const out = classifyRecurrence([
    led(conf('force-app/classes/A.cls:1', 'high', 'A'), conf('force-app/classes/B.cls:1', 'high', 'B')),
    led(conf('force-app/classes/A.cls:1', 'high', 'A'), conf('force-app/classes/B.cls:1', 'high', 'B'), conf('force-app/classes/C.cls:1', 'high', 'C')),
  ])
  const j = out.summary.pairwise_jaccard.find((p) => p.pair === '1-2')
  assert.equal(j.shared, 2)
  assert.equal(j.union, 3)
  assert.equal(j.jaccard, 0.67)
  assert.deepEqual(out.summary.confirmed_per_run, { 1: 2, 2: 3 })
  // and the pure helper agrees
  const raw = jaccard(['x', 'y'], ['x', 'y', 'z'])
  assert.equal(raw.shared, 2); assert.equal(raw.union, 3); assert.equal(Math.round(raw.jaccard * 100) / 100, 0.67)
})

// --- 10. caveat present + honest; no completeness ASSERTION leaks ----------
check('10 caveat carries the honesty contract; no completeness assertion appears in the classification', () => {
  const out = classifyRecurrence([
    led(conf('force-app/classes/A.cls:10-20', 'high', 'FLS gap in A')),
    led(conf('force-app/classes/A.cls:10-20', 'high', 'FLS gap in A')),
  ])
  // The caveat MUST carry the no-fixed-run-count + human-adjudication + SF-pentest language.
  assert.match(out.caveat, /human adjudication/i)
  assert.match(out.caveat, /no fixed run-count/i)
  assert.match(out.caveat, /penetration test/i)
  // The mandated caveat NEGATES completeness ("does not certify the audit complete, passed, or
  // safe"), so a bare-word "complete"/"passed" scan would false-fire on the honest negation. We
  // therefore scan everything EXCEPT the caveat for a completeness/pass ASSERTION — those must
  // never leak into a per-locus confidence, a stability note, or the summary.
  const { caveat, ...rest } = out
  const body = JSON.stringify(rest).toLowerCase()
  for (const forbidden of ['strong claim earned', 'you can stop', 'coverage is certain', 'certified complete', 'audit is complete', 'ready to submit', '\\bcomplete\\b', '\\bpassed\\b']) {
    assert.doesNotMatch(body, new RegExp(forbidden), `forbidden completeness assertion "${forbidden}" must not appear`)
  }
  // And the caveat itself must phrase complete/passed only inside the negation.
  assert.match(out.caveat, /does not certify the audit complete, passed, or safe/i)
})

// --- 11. commit-consistency honesty guard ----------------------------------
// A ledger records its audited commit in the LAST pass's audited_commit.
const ledAt = (commit, ...findings) => ({
  schema_version: '1', findings, passes: [commit ? { id: 1, audited_commit: commit } : { id: 1 }],
})
check('11a same audited_commit across runs → commit_consistency=consistent, caveat has NO mixed warning', () => {
  const out = classifyRecurrence([
    ledAt('abc123', conf('force-app/classes/A.cls:10-20', 'high', 'A')),
    ledAt('abc123', conf('force-app/classes/A.cls:10-20', 'high', 'A')),
  ])
  assert.equal(out.summary.commit_consistency, 'consistent')
  assert.deepEqual(out.generated_from.runs, [
    { run: 1, audited_commit: 'abc123' },
    { run: 2, audited_commit: 'abc123' },
  ])
  assert.doesNotMatch(out.caveat, /different commits|code change/i)
})
check('11b differing commits → commit_consistency=mixed + caveat warns code-change-vs-instability', () => {
  const out = classifyRecurrence([
    ledAt('aaa111', conf('force-app/classes/A.cls:10-20', 'high', 'A')),
    ledAt('bbb222', conf('force-app/classes/A.cls:10-20', 'high', 'A')),
  ])
  assert.equal(out.summary.commit_consistency, 'mixed')
  assert.match(out.caveat, /different commits/i)
  assert.match(out.caveat, /code change/i)
  assert.match(out.caveat, /same commit/i)
})
check('11c a run missing its commit → commit_consistency=unknown (no false mixed read)', () => {
  const out = classifyRecurrence([
    ledAt('aaa111', conf('force-app/classes/A.cls:10-20', 'high', 'A')),
    ledAt(null, conf('force-app/classes/A.cls:10-20', 'high', 'A')),
  ])
  assert.equal(out.summary.commit_consistency, 'unknown')
  assert.equal(out.generated_from.runs[1].audited_commit, null)
  assert.doesNotMatch(out.caveat, /different commits/i)
})

// --- 12. by_file rollup ----------------------------------------------------
check('12 by_file: 2 loci in fileA + 1 in fileB → 2 entries; fileA locus_count=2, tally + blocker', () => {
  const out = classifyRecurrence([
    led(
      conf('force-app/classes/A.cls:10-20', 'high', 'A1'),
      conf('force-app/classes/A.cls:50-60', 'high', 'A2'),
      conf('force-app/classes/B.cls:1-5', 'high', 'B1'),
    ),
    led(conf('force-app/classes/A.cls:10-20', 'high', 'A1'), conf('force-app/classes/B.cls:1-5', 'high', 'B1')),
  ])
  const bf = out.summary.by_file
  assert.equal(bf.length, 2, 'one entry per distinct file')
  assert.deepEqual(bf.map((e) => e.file), ['force-app/classes/A.cls', 'force-app/classes/B.cls'], 'sorted by file')
  const a = bf.find((e) => e.file === 'force-app/classes/A.cls')
  assert.equal(a.locus_count, 2, 'two non-overlapping spans on A → two loci, one file row')
  assert.deepEqual(a.confidences, { high: 1, review: 0, investigate: 1 }, ':10-20 all_runs high + :50-60 single_run')
  assert.equal(a.has_reliable_blocker, true, 'A carries the all_runs/high :10-20 reliable blocker')
  const b = bf.find((e) => e.file === 'force-app/classes/B.cls')
  assert.equal(b.locus_count, 1)
  assert.equal(b.has_reliable_blocker, true)
  // the rollup does not change the per-locus source of truth
  assert.equal(out.loci.length, 3)
})

// --- 13. --repo-root display relativization (matching unaffected) ----------
check('13a repoRoot strips the prefix from emitted paths; a path NOT under root is left intact', () => {
  const out = classifyRecurrence([
    led(conf('/abs/root/src/x.js:5-9', 'high', 'X'), conf('/elsewhere/y.js:1-3', 'high', 'Y')),
    led(conf('/abs/root/src/x.js:5-9', 'high', 'X')),
  ], { repoRoot: '/abs/root' })
  const files = out.loci.map((l) => l.file)
  assert.ok(files.includes('src/x.js'), 'path under root → relativized to src/x.js')
  assert.ok(files.includes('/elsewhere/y.js'), 'path NOT under root → left intact')
  // relativization is display-only: x.js still matched across both runs
  assert.equal(out.loci.find((l) => l.file === 'src/x.js').recurrence_bucket, 'all_runs')
})
check('13b CLI --repo-root relativizes in the emitted JSON', () => {
  const d = mkdtempSync(join(tmpdir(), 'rec-conf-')); dirs.push(d)
  const p1 = join(d, 'r1.json'); const p2 = join(d, 'r2.json')
  writeFileSync(p1, JSON.stringify(led(conf('/abs/root/src/x.js:5-9', 'high', 'X'))))
  writeFileSync(p2, JSON.stringify(led(conf('/abs/root/src/x.js:5-9', 'high', 'X'))))
  const out = JSON.parse(execFileSync('node', [ENGINE, '--ledger', p1, '--ledger', p2, '--repo-root', '/abs/root'], { encoding: 'utf8' }))
  assert.ok(out.loci.some((l) => l.file === 'src/x.js'), 'CLI threads --repo-root through to display')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

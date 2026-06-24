#!/usr/bin/env node
/*
 * union-convergence.mjs — does the UNION of confirmed findings across N
 * independent runs STOP growing?
 *
 * WHY THIS EXISTS. The recurrence-confidence engine (harness/recurrence-confidence.mjs)
 * answers "how reliably did each finding recur?" — a per-locus stability read. This
 * is the complementary set-level question Thread 2 asks: as you stack independent
 * cold runs of the SAME codebase, does the cumulative set of distinct confirmed
 * loci PLATEAU, or does each new run still surface loci the prior runs missed? A
 * plateau is weak evidence that the generation step has been exhausted on this
 * run-set; continued growth is evidence it has not. It is the descriptive
 * counterpart to the ceiling test (docs/ceiling-test.md), framed as union growth.
 *
 * REPORT-ONLY. This NEVER gates, never moves the SCI, is never wired into
 * compute-sci or any readiness verdict. It is an opt-in diagnostic the operator
 * runs over archived run-ledgers. Convergence on a finite run-set does NOT certify
 * the audit complete (see the caveat) — a class of finding none of the runs ever
 * generates plateaus at zero new just as a genuinely-exhausted search does.
 *
 * LOCUS IDENTITY MATCHES THE RECURRENCE ENGINE. Two confirmed findings are the
 * SAME locus iff their files name the same code path (path-segment-suffix
 * reconciliation of abs-vs-relative cites) AND their line spans overlap. The
 * primitives are imported from harness/finding-clusters.mjs (normFile / lineSpan /
 * spansOverlap); fileSuffixMatch / sameLocus / isOpen are copied VERBATIM from
 * harness/recurrence-confidence.mjs so a finding that the recurrence engine treats
 * as one locus is one locus here too. Only OPEN/confirmed findings count (same
 * OPEN_STATES as both engines) — a refuted finding is not union growth.
 *
 * UNDER-MATCH IS THE SAFE FAILURE (inherited). A finding cited at non-overlapping
 * lines, with an un-located file, or with only a bare basename bridging deeper
 * paths, lands as a SEPARATE locus rather than being falsely merged — so the union
 * is biased toward LOOKING LIKE IT STILL GROWS (conservative against a false
 * "converged"), never toward a false plateau.
 *
 * DETERMINISTIC + PURE (CONVENTIONS §7). No LLM, no network, no deps, no
 * Date/random. Same N ledgers in run order → byte-identical JSON out. Guarded by
 * acceptance/test-union-convergence.mjs.
 *
 * Usage:
 *   node harness/union-convergence.mjs <run1.json> <run2.json> [<run3.json> ...]
 *   (>= 2 ledger paths, POSITIONAL; arg order = run order, 1-based.)
 *
 *   stdout JSON: { n_runs, union_size_series, marginal_new, total_union,
 *                  converged, plateau_run, caveat }
 *   exit 0 always, EXCEPT: < 2 ledger args, or an unreadable/non-JSON ledger → exit 2.
 */
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { normFile, lineSpan, spansOverlap } from './finding-clusters.mjs'

// ---------------------------------------------------------------------------
// Shared vocabulary — copied VERBATIM from harness/recurrence-confidence.mjs so
// "open" and "same locus" mean exactly what the recurrence engine means.
// ---------------------------------------------------------------------------
const OPEN_STATES = new Set(['confirmed', 'regressed'])
const isOpen = (f) =>
  OPEN_STATES.has(String(f.status || '').toLowerCase()) ||
  (String(f.status || '').toLowerCase() === '' && String(f.verdict || '').toLowerCase() === 'confirmed_real')

const pathSegs = (f) => normFile(f).split('/').filter(Boolean)

// Two normalized files name the SAME path (exact equality, or shorter-is-a-tail-of-longer
// with a >= 2-segment floor so a bare basename never bridges a deeper path). Identical to
// recurrence-confidence.mjs::fileSuffixMatch.
function fileSuffixMatch(fileA, fileB) {
  const a = pathSegs(fileA)
  const b = pathSegs(fileB)
  if (!a.length || !b.length) return false
  if (a[a.length - 1] !== b[b.length - 1]) return false // basename gate
  if (a.length === b.length) return a.every((s, i) => s === b[i]) // exact path equality
  const [short, long] = a.length < b.length ? [a, b] : [b, a] // abs-vs-relative reconcile
  if (short.length < 2) return false // a bare basename never bridges a deeper path
  for (let i = 1; i <= short.length; i++) {
    if (short[short.length - i] !== long[long.length - i]) return false
  }
  return true
}

// Same code LOCATION: same path (suffix-reconciled, not '(unattributed)') AND overlapping
// line spans. spansOverlap is false when EITHER span is null. Identical to
// recurrence-confidence.mjs::sameLocus.
function sameLocus(a, b) {
  const fa = normFile(a.file)
  const fb = normFile(b.file)
  if (fa === '(unattributed)' || fb === '(unattributed)') return false
  if (!fileSuffixMatch(a.file, b.file)) return false
  return spansOverlap(lineSpan(a.file), lineSpan(b.file))
}

// The fixed honesty caveat (CONVENTIONS §2): a plateau on THIS run-set is not
// completeness — keep it in the output verbatim.
const CAVEAT =
  'Convergence is measured over the SUPPLIED run-set only: it reports whether the cumulative ' +
  'union of confirmed loci stopped growing across these N runs, NOT whether the audit is complete. ' +
  'A class of finding that none of these runs ever generates plateaus at zero-new exactly like a ' +
  'genuinely-exhausted search, so a converged union does not certify coverage; more independent runs ' +
  'can still surface new loci, and Salesforce performs its own penetration test regardless. This ' +
  'output does not certify the audit complete, passed, or safe.'

/**
 * THE PURE CORE. N parsed ledgers in RUN ORDER → the convergence record.
 * FAIL CLOSED: a ledger whose `findings` is not an array contributes zero loci.
 */
export function computeUnionConvergence(ledgers) {
  const runs = Array.isArray(ledgers) ? ledgers : []
  const n = runs.length

  // The accumulated union, as representative findings (one per distinct locus).
  // A run's finding is NEW iff it matches NO member already in the union; a member
  // is pushed the moment it is found new, so two same-locus findings in ONE run
  // collapse (the second matches the just-added member).
  const unionMembers = []
  const union_size_series = []
  const marginal_new = []

  for (const led of runs) {
    const findings = led && Array.isArray(led.findings) ? led.findings : []
    const open = findings.filter((f) => f && typeof f === 'object' && isOpen(f))
    let added = 0
    for (const f of open) {
      if (!unionMembers.some((m) => sameLocus(m, f))) {
        unionMembers.push(f)
        added++
      }
    }
    marginal_new.push(added)
    union_size_series.push(unionMembers.length)
  }

  // converged iff the LAST 2+ runs each added 0 new loci.
  const converged = n >= 2 && marginal_new[n - 1] === 0 && marginal_new[n - 2] === 0

  // plateau_run = smallest k in [1, n-1] such that every run AFTER k (k+1..n) added
  // 0 new loci; null when even the last run added something (no real plateau).
  let plateau_run = null
  for (let k = 1; k <= n - 1; k++) {
    let allZeroAfter = true
    for (let j = k; j < n; j++) { // marginal_new[j] is run (j+1)'s delta
      if (marginal_new[j] !== 0) { allZeroAfter = false; break }
    }
    if (allZeroAfter) { plateau_run = k; break }
  }

  return {
    n_runs: n,
    union_size_series,
    marginal_new,
    total_union: unionMembers.length,
    converged,
    plateau_run,
    caveat: CAVEAT,
  }
}

function fail2(msg) {
  process.stderr.write(`union-convergence: ${msg}\n`)
  process.exit(2)
}

function main() {
  const paths = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  if (paths.length < 2) fail2('need >= 2 ledger paths (run order): union-convergence.mjs <run1.json> <run2.json> ...')
  const ledgers = []
  for (const p of paths) {
    let led
    try { led = JSON.parse(readFileSync(p, 'utf8')) }
    catch { fail2(`cannot read or parse ledger at ${p}`) }
    ledgers.push(led)
  }
  const result = computeUnionConvergence(ledgers)
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  process.exit(0)
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) }
  catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

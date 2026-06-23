#!/usr/bin/env node
/*
 * recurrence-confidence.mjs — make the audit's run-to-run VARIANCE honest and
 * visible.
 *
 * WHY THIS EXISTS. A full-pipeline cold-at-exhaustive test (three independent
 * exhaustive runs over identical code, graded against a pre-committed bar)
 * REFUTED the strong claim that "at exhaustive the toolkit calls the
 * contestable-severity band reliably." Across three runs of the SAME codebase the
 * confirmed finding SET drifted (pairwise Jaccard 0.44–0.67), and individual
 * findings wobbled run-to-run: a real Contact-PII high confirmed in one run,
 * refuted in another; a viewAllRecords over-grant swinging medium / high / medium.
 * The honest, locked product position: the toolkit RELIABLY finds the unambiguous
 * blockers and builds the evidence pack, but the contestable-severity band is an
 * incomplete, UNSTABLE sample that needs repeated runs + HUMAN adjudication — no
 * fixed run-count is certified complete, and Salesforce pen-tests regardless.
 *
 * This engine takes N independent run-ledgers of the same codebase and classifies
 * each finding by HOW RELIABLY it recurred — so the variance is a visible output,
 * not a buried surprise. It is the descriptive counterpart to that refutation:
 * the all-runs + status/severity-stable set is the reliably-recurring blocker set;
 * everything outside it is the contestable band the human owns.
 *
 * DETERMINISTIC + PURE (CONVENTIONS §7). No LLM, no network, no learned weights,
 * no dependencies. Same N ledgers in → byte-identical JSON out. Guarded by
 * acceptance/test-recurrence-confidence.mjs.
 *
 * CROSS-RUN MATCHING — the spine. finding.id is unusable across runs (it is
 * SHA256(strippedFile + '\n' + normalizedTitle), and titles vary run-to-run, so
 * the SAME defect gets a DIFFERENT id every run). Instead we reuse the proven
 * locus primitives from finding-clusters.mjs (normFile / lineSpan / spansOverlap)
 * and match two findings as the SAME LOCUS iff their files refer to the same code
 * path AND their line spans overlap — mirroring sameLocation() in that file.
 *
 *   One necessary extension over plain normFile equality: real run-ledgers cite
 *   the SAME file with DIFFERENT path depth — one run repo-relative
 *   ("force-app/.../X.cls"), another absolute ("home/u/proj/force-app/.../X.cls").
 *   normFile only strips the :line suffix, so plain equality would split one
 *   defect across runs and miscall it "some_runs". We reconcile this GENERICALLY
 *   (no fixture coupling) by path-segment-SUFFIX matching: two normalized files
 *   are the same path iff their basenames match AND the shorter segment list is a
 *   tail of the longer. This fails toward UNDER-matching (a defect cited at
 *   non-overlapping lines, or one file as a non-suffix of the other, lands in
 *   "some_runs"/separate loci rather than being falsely merged) — under-confidence
 *   is the safe failure, false confidence is the forbidden one. See
 *   docs/recurrence-confidence.md for why this diverges from grade-solano.py's
 *   fixture-tuned canon().
 *
 * FAIL CLOSED. Every incoming JSON field is Array.isArray-guarded (the
 * dict-shaped-payload class the codebase guards against): a ledger whose
 * `findings` is not an array contributes zero findings rather than crashing. A
 * missing / unreadable / non-JSON ledger path is exit 2 — you cannot classify
 * recurrence over a phantom run.
 *
 * Usage:
 *   node recurrence-confidence.mjs --ledger <p1> --ledger <p2> [--ledger <pN> ...] \
 *       [--repo-root <path>] [--out <path>]
 *   (--ledger is repeatable; order = run order, 1-based. --repo-root strips that prefix
 *    from every emitted display path (matching is unaffected). --out also writes the JSON
 *    to <path>, which in production is <target>/.security-review/recurrence-confidence.json.)
 */
import { readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { normFile, lineSpan, spansOverlap } from './finding-clusters.mjs'

// ---------------------------------------------------------------------------
// Shared vocabulary (mirrors finding-clusters.mjs / compute-sci.mjs).
// ---------------------------------------------------------------------------
const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
const OPEN_STATES = new Set(['confirmed', 'regressed'])
const sevOf = (f) => String(f.adjusted_severity || f.severity || '').toLowerCase()
const isOpen = (f) =>
  OPEN_STATES.has(String(f.status || '').toLowerCase()) ||
  (String(f.status || '').toLowerCase() === '' && String(f.verdict || '').toLowerCase() === 'confirmed_real')
// Coarse run-level status class. Open (confirmed/regressed) collapses to
// 'confirmed' so a confirmed→regressed re-find is NOT read as a status flip.
const runStatus = (f) => (isOpen(f) ? 'confirmed' : String(f.status || '').toLowerCase() || 'unknown')
// How strongly a run ASSERTED the locus: a run that both confirmed and refuted
// (different lenses) DID confirm it, so confirmed dominates.
const STATUS_RANK = { confirmed: 3, accepted_risk: 2, fixed: 1, refuted: 0, unknown: -1 }

// All dimensions a finding stands for — a Track-1b merged entry represents every
// lens in merged_dimensions, not just its top-level dimension.
const dimsOf = (f) =>
  Array.isArray(f.merged_dimensions) && f.merged_dimensions.length
    ? f.merged_dimensions.map(String)
    : f.dimension
      ? [String(f.dimension)]
      : []

// The target HEAD a run was audited at = the LAST pass's audited_commit (merge-ledger
// appends passes sorted ascending, so the last element is the newest). Null when the
// run records no commit — which makes commit-consistency 'unknown', never a false read.
function lastAuditedCommit(led) {
  const passes = led && Array.isArray(led.passes) ? led.passes : []
  if (!passes.length) return null
  const last = passes[passes.length - 1]
  const c = last && typeof last === 'object' ? last.audited_commit : null
  return c != null && String(c).trim() ? String(c).trim() : null
}

// Display-only: strip a segment-aware repoRoot prefix from an emitted path so a
// singleton locus does not keep an absolute path in the artifact. A path that is NOT
// under the root is left intact. Does NOT affect matching — only the emitted display.
function relativize(file, repoRoot) {
  if (!repoRoot) return file
  const root = String(repoRoot).split('/').filter(Boolean)
  if (!root.length) return file
  const segs = String(file).split('/').filter(Boolean)
  if (segs.length <= root.length) return file
  for (let i = 0; i < root.length; i++) if (segs[i] !== root[i]) return file
  return segs.slice(root.length).join('/')
}

// ---------------------------------------------------------------------------
// Locus matching — path-segment-suffix file match + overlapping line span.
// ---------------------------------------------------------------------------
const pathSegs = (f) => normFile(f).split('/').filter(Boolean)

// Two normalized files name the SAME path. EXACT equality (same segments, any length)
// always matches — this keeps a root-level single-segment file like "Dockerfile" cited
// identically in two runs together. At DIFFERING depth (the abs-vs-relative reconcile
// this function exists for) the SHORTER list must have length >= 2 (basename + at least
// one parent dir) before it counts as a tail of the longer — so a BARE BASENAME can
// never bridge a deeper path. Without that floor, "package.json" would match BOTH
// "frontend/package.json" and "backend/package.json", and single-linkage clustering
// would FUSE three different files into one all_runs/high locus — false confidence, the
// forbidden direction (over-merge can hide a distinct finding; mirrors M10/M11). The
// residual: two different files sharing a >=2-segment tail ("classes/Foo.cls" in two
// dirs) could still match — acceptable, since Salesforce class names are unique per
// namespace and Node parent dirs distinguish; it fails toward under-confidence for an
// ambiguous short cite, never false confidence.
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

// Same code LOCATION across runs: same path (suffix-reconciled, not '(unattributed)')
// AND overlapping line spans. spansOverlap is false when EITHER span is null, so an
// un-located finding never merges — the documented under-match safe failure.
function sameLocus(a, b) {
  const fa = normFile(a.file)
  const fb = normFile(b.file)
  if (fa === '(unattributed)' || fb === '(unattributed)') return false
  if (!fileSuffixMatch(a.file, b.file)) return false
  return spansOverlap(lineSpan(a.file), lineSpan(b.file))
}

// Overlap length in lines (0 when either span is null) — picks the BEST locus when a
// refuted finding overlaps more than one confirmed cluster (attach to most-overlapping).
function overlapLen(fileA, fileB) {
  const sa = lineSpan(fileA)
  const sb = lineSpan(fileB)
  if (!sa || !sb) return 0
  return Math.max(0, Math.min(sa.hi, sb.hi) - Math.max(sa.lo, sb.lo) + 1)
}

// Transitive (single-linkage) clustering of tagged findings by sameLocus — mirrors
// collapseCrossDimension's grow loop in finding-clusters.mjs.
function clusterTransitive(tagged) {
  const used = new Array(tagged.length).fill(false)
  const clusters = []
  for (let i = 0; i < tagged.length; i++) {
    if (used[i]) continue
    const members = [tagged[i]]
    used[i] = true
    let grew = true
    while (grew) {
      grew = false
      for (let j = 0; j < tagged.length; j++) {
        if (used[j]) continue
        if (members.some((m) => sameLocus(m.f, tagged[j].f))) {
          members.push(tagged[j])
          used[j] = true
          grew = true
        }
      }
    }
    clusters.push(members)
  }
  return clusters
}

// ---------------------------------------------------------------------------
// Pure metric: Jaccard of two sets (the same |A∩B|/|A∪B| as grade-solano.py).
// REPORTED as a metric; it gates / certifies nothing.
// ---------------------------------------------------------------------------
export function jaccard(a, b) {
  const A = a instanceof Set ? a : new Set(a)
  const B = b instanceof Set ? b : new Set(b)
  let shared = 0
  for (const x of A) if (B.has(x)) shared++
  const union = new Set([...A, ...B]).size
  return { shared, union, jaccard: union === 0 ? 0 : shared / union }
}

const round2 = (x) => Math.round(x * 100) / 100

// ---------------------------------------------------------------------------
// The standing honesty caveat (CONVENTIONS §2). Per-locus confidence describes
// how reliably THAT finding recurred — never global completeness.
// ---------------------------------------------------------------------------
function caveatFor(n, commitConsistency) {
  let text =
    `Descriptive recurrence classification across ${n} independent run${n === 1 ? '' : 's'} of the same ` +
    `codebase. The all-runs + status/severity-stable set is the reliably-recurring blocker set. Findings ` +
    `outside it — appearing in only some runs, or flipping status or severity between runs — are the ` +
    `contestable band: an incomplete, unstable sample that requires human adjudication. No fixed run-count ` +
    `certifies the audit complete, and Salesforce performs its own penetration test regardless. This output ` +
    `does not certify the audit complete, passed, or safe.`
  if (n === 1) {
    text +=
      ' With only ONE run there is no recurrence signal at all: every locus is single-run and cannot be ' +
      'classified for stability — re-run the audit independently several times to populate this.'
  }
  if (commitConsistency === 'mixed') {
    text +=
      ' NOTE: the runs were audited at DIFFERENT commits (see generated_from.runs), so a finding appearing ' +
      'or disappearing across runs may reflect a CODE CHANGE (e.g. a fix that landed between runs) rather ' +
      'than run-to-run instability — re-run all passes on the SAME commit for a clean stability read.'
  }
  return text
}

// ---------------------------------------------------------------------------
// Per-cluster → locus record.
// ---------------------------------------------------------------------------
function representative(findings) {
  // strongest assertion (status rank) then most severe; stable on ties.
  let best = null
  for (const f of findings) {
    const r = STATUS_RANK[runStatus(f)] ?? -1
    const s = SEV_RANK[sevOf(f)] ?? 9
    if (!best || r > best.r || (r === best.r && s < best.s)) best = { f, r, s }
  }
  return best ? best.f : null
}

function canonicalFile(members) {
  // The most repo-relative representative: fewest path segments, then lexical.
  let best = null
  for (const m of members) {
    const nf = normFile(m.f.file)
    if (nf === '(unattributed)') continue
    const segs = pathSegs(m.f.file).length
    if (!best || segs < best.segs || (segs === best.segs && nf < best.nf)) best = { nf, segs }
  }
  return best ? best.nf : '(unattributed)'
}

function spanUnion(members) {
  let lo = null
  let hi = null
  for (const m of members) {
    const s = lineSpan(m.f.file)
    if (!s) continue
    lo = lo === null ? s.lo : Math.min(lo, s.lo)
    hi = hi === null ? s.hi : Math.max(hi, s.hi)
  }
  return lo === null ? null : { lo, hi }
}

function stabilityNote(perRun, bucket, severityStable, n) {
  const confirmed = perRun.filter((p) => p.status === 'confirmed')
  if (bucket === 'all_runs' && confirmed.length === n && severityStable) {
    return `confirmed at ${confirmed[0].adjusted_severity} in all ${n} run${n === 1 ? '' : 's'}`
  }
  return perRun
    .map((p) =>
      p.present ? `run${p.run} ${p.status}${p.adjusted_severity ? ` (${p.adjusted_severity})` : ''}` : `run${p.run} absent`
    )
    .join('; ')
}

function locusRecord(members, n) {
  const perRun = []
  const confirmedSeverities = []
  const presentStatuses = []
  const titlesPerRun = {}
  for (let run = 1; run <= n; run++) {
    const fs = members.filter((m) => m.run === run).map((m) => m.f)
    if (!fs.length) {
      perRun.push({ run, present: false, status: null, adjusted_severity: null })
      continue
    }
    const rep = representative(fs)
    const st = runStatus(rep)
    const sev = sevOf(rep) || null
    perRun.push({ run, present: true, status: st, adjusted_severity: sev })
    presentStatuses.push(st)
    titlesPerRun[String(run)] = String(rep.title || '')
    if (st === 'confirmed') confirmedSeverities.push(sev)
  }

  const presentCount = perRun.filter((p) => p.present).length
  const confirmedCount = perRun.filter((p) => p.status === 'confirmed').length
  // N=1 is special: a single run gives NO recurrence signal, so present-in-the-only-run is
  // single_run (not all_runs) — one ledger can never establish reliable recurrence.
  const bucket =
    n === 1 ? 'single_run' : presentCount === n ? 'all_runs' : presentCount >= 2 ? 'some_runs' : 'single_run'
  const severityStable = new Set(confirmedSeverities).size <= 1
  const statusStable = new Set(presentStatuses).size <= 1
  const confidence =
    bucket === 'all_runs' && confirmedCount === n && severityStable
      ? 'high'
      : bucket === 'single_run'
        ? 'investigate'
        : 'review'

  const dimensions = [...new Set(members.flatMap((m) => dimsOf(m.f)))].sort()

  return {
    file: canonicalFile(members),
    line_span: spanUnion(members),
    dimensions,
    titles_per_run: titlesPerRun,
    per_run: perRun,
    present_count: presentCount,
    confirmed_count: confirmedCount,
    recurrence_bucket: bucket,
    severity_stable: severityStable,
    status_stable: statusStable,
    confidence,
    stability_note: stabilityNote(perRun, bucket, severityStable, n),
  }
}

// ---------------------------------------------------------------------------
// THE PURE CORE — N parsed ledgers in run order → the classification object.
// ---------------------------------------------------------------------------
export function classifyRecurrence(ledgers, opts = {}) {
  const runLedgers = Array.isArray(ledgers) ? ledgers : []
  const n = runLedgers.length
  const ledgerPaths = Array.isArray(opts.ledgerPaths) ? opts.ledgerPaths.map(String) : []
  const repoRoot = opts.repoRoot ? String(opts.repoRoot) : null

  // Commit-consistency honesty guard. Each run's commit = its last pass's audited_commit.
  // 'mixed' (runs at different commits) means an appear/disappear may be a CODE CHANGE,
  // not instability — surfaced in the caveat so the fix→re-run loop's output is not
  // misread as run-to-run drift. Descriptive only; it never gates.
  const runs = runLedgers.map((led, i) => ({ run: i + 1, audited_commit: lastAuditedCommit(led) }))
  const commits = runs.map((r) => r.audited_commit)
  const commitConsistency = !commits.length
    ? 'unknown'
    : commits.some((c) => c === null)
      ? 'unknown'
      : new Set(commits).size === 1
        ? 'consistent'
        : 'mixed'

  // 1. Flatten every run's findings tagged with its 1-based run index. FAIL
  //    CLOSED: a ledger whose `findings` is not an array contributes nothing.
  const tagged = []
  runLedgers.forEach((led, i) => {
    const findings = led && Array.isArray(led.findings) ? led.findings : []
    for (const f of findings) if (f && typeof f === 'object') tagged.push({ run: i + 1, f })
  })

  // 2. Cluster across runs by LOCUS — CONFIRMED-ANCHORED, two phase. A locus is
  //    anchored on its CONFIRMED (open) findings, then refuted findings attach to the
  //    confirmed locus they best overlap. Why not one transitive pass over ALL
  //    findings: a single broad REFUTED finding (e.g. a "no caller auth at the worker
  //    entry point" cited :1-14) overlaps two narrow, MUTUALLY-DISJOINT confirmed
  //    defects (DB-URL-validation :3 and missing-LIMIT :6-10) and, by transitivity,
  //    fuses them into one locus — hiding a real second finding. Anchoring on the
  //    confirmed findings keeps disjoint confirmed defects separate; the broad refuted
  //    finding attaches to whichever it overlaps most, marking that run "looked-and-
  //    refuted" without bridging. Refuted findings that match NO confirmed locus
  //    (raised-and-refuted, never confirmed anywhere) cluster among themselves.
  const openTagged = tagged.filter((t) => isOpen(t.f))
  const closedTagged = tagged.filter((t) => !isOpen(t.f))
  const anchored = clusterTransitive(openTagged)
  // Match closed findings against a FROZEN snapshot of the open anchors only — never
  // against other closed findings already attached. Otherwise the broad refuted finding
  // could attach first and then bridge a narrow refuted finding into the wrong locus,
  // which would be order-dependent and re-introduce the fuse this phase exists to prevent.
  const anchorOpenMembers = anchored.map((members) => members.slice())
  const attachments = anchored.map(() => [])
  const residual = []
  for (const ct of closedTagged) {
    let bestIdx = -1
    let bestOverlap = -1
    anchorOpenMembers.forEach((members, idx) => {
      let matched = false
      let ov = 0
      for (const m of members) {
        if (sameLocus(m.f, ct.f)) {
          matched = true
          ov += overlapLen(m.f.file, ct.f.file)
        }
      }
      if (matched && ov > bestOverlap) {
        bestOverlap = ov
        bestIdx = idx
      }
    })
    if (bestIdx >= 0) attachments[bestIdx].push(ct)
    else residual.push(ct)
  }
  const clusters = [...anchored.map((members, i) => [...members, ...attachments[i]]), ...clusterTransitive(residual)]

  // 3. One record per locus. Apply the optional --repo-root display relativization
  //    BEFORE sorting + the summary rollups so every emitted path is consistent
  //    (matching already happened on the raw paths — this is display-only).
  const loci = clusters.map((members) => locusRecord(members, n))
  if (repoRoot) for (const l of loci) l.file = relativize(l.file, repoRoot)
  loci.sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1
    const al = a.line_span ? a.line_span.lo : -1
    const bl = b.line_span ? b.line_span.lo : -1
    if (al !== bl) return al - bl
    const ah = a.line_span ? a.line_span.hi : -1
    const bh = b.line_span ? b.line_span.hi : -1
    if (ah !== bh) return ah - bh
    const at = Object.values(a.titles_per_run).join('|')
    const bt = Object.values(b.titles_per_run).join('|')
    return at < bt ? -1 : at > bt ? 1 : 0
  })

  // 4. Summary — confirmed-per-run, pairwise Jaccard over confirmed-locus SETS,
  //    bucket counts, and the reliably-recurring blocker set.
  const confirmedLociByRun = {}
  const confirmedPerRun = {}
  for (let run = 1; run <= n; run++) {
    const ids = new Set()
    loci.forEach((l, idx) => {
      const pr = l.per_run.find((p) => p.run === run)
      if (pr && pr.status === 'confirmed') ids.add(idx)
    })
    confirmedLociByRun[run] = ids
    confirmedPerRun[String(run)] = ids.size
  }

  const pairwise = []
  for (let i = 1; i <= n; i++) {
    for (let j = i + 1; j <= n; j++) {
      const r = jaccard(confirmedLociByRun[i], confirmedLociByRun[j])
      pairwise.push({ pair: `${i}-${j}`, jaccard: round2(r.jaccard), shared: r.shared, union: r.union })
    }
  }

  const bucketCounts = { all_runs_stable: 0, all_runs_unstable: 0, some_runs: 0, single_run: 0 }
  for (const l of loci) {
    if (l.recurrence_bucket === 'all_runs') {
      if (l.confidence === 'high') bucketCounts.all_runs_stable++
      else bucketCounts.all_runs_unstable++
    } else if (l.recurrence_bucket === 'some_runs') bucketCounts.some_runs++
    else bucketCounts.single_run++
  }

  const reliablyRecurringBlockers = loci
    .filter(
      (l) =>
        l.recurrence_bucket === 'all_runs' &&
        l.confirmed_count === n &&
        l.severity_stable &&
        (l.per_run.find((p) => p.status === 'confirmed')?.adjusted_severity === 'critical' ||
          l.per_run.find((p) => p.status === 'confirmed')?.adjusted_severity === 'high')
    )
    .map((l) => ({
      file: l.file,
      line_span: l.line_span,
      adjusted_severity: l.per_run.find((p) => p.status === 'confirmed')?.adjusted_severity,
      dimensions: l.dimensions,
      stability_note: l.stability_note,
    }))

  // by_file rollup — a PRESENTATION view over the per-locus classification (which
  // stays the source of truth). Real output fragments one logical finding across loci
  // when spans don't overlap (the safe under-merge direction, but noisy for a human);
  // this groups them by file so a reviewer sees one row per file. has_reliable_blocker
  // is membership in the reliably-recurring blocker set, not just any high-confidence.
  const blockerFiles = new Set(reliablyRecurringBlockers.map((b) => b.file))
  const byFileMap = new Map()
  for (const l of loci) {
    if (!byFileMap.has(l.file)) {
      byFileMap.set(l.file, { file: l.file, locus_count: 0, confidences: { high: 0, review: 0, investigate: 0 } })
    }
    const e = byFileMap.get(l.file)
    e.locus_count++
    e.confidences[l.confidence] = (e.confidences[l.confidence] || 0) + 1
  }
  const byFile = [...byFileMap.values()]
    .map((e) => ({ ...e, has_reliable_blocker: blockerFiles.has(e.file) }))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))

  return {
    schema_version: '1',
    generated_from: { run_count: n, ledger_paths: ledgerPaths, runs },
    match_key: 'normFile path-suffix + overlapping-line-span (locus-based)',
    loci,
    summary: {
      n_runs: n,
      commit_consistency: commitConsistency,
      confirmed_per_run: confirmedPerRun,
      pairwise_jaccard: pairwise,
      bucket_counts: bucketCounts,
      reliably_recurring_blockers: reliablyRecurringBlockers,
      by_file: byFile,
    },
    caveat: caveatFor(n, commitConsistency),
  }
}

// ---------------------------------------------------------------------------
// Impure CLI wrapper.
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const ledgers = []
  let out = null
  let repoRoot = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ledger' && argv[i + 1]) ledgers.push(argv[++i])
    else if (argv[i] === '--out' && argv[i + 1]) out = argv[++i]
    else if (argv[i] === '--repo-root' && argv[i + 1]) repoRoot = argv[++i]
  }
  return { ledgers, out, repoRoot }
}

function main() {
  const { ledgers: paths, out, repoRoot } = parseArgs(process.argv.slice(2))
  if (!paths.length) {
    console.error('recurrence-confidence: at least one --ledger <path> is required')
    process.exit(2)
  }
  const parsed = []
  for (const p of paths) {
    let raw
    try {
      raw = readFileSync(p, 'utf8')
    } catch {
      console.error(`recurrence-confidence: cannot read ledger '${p}'`)
      process.exit(2)
    }
    let json
    try {
      json = JSON.parse(raw)
    } catch {
      console.error(`recurrence-confidence: ledger '${p}' is not valid JSON`)
      process.exit(2)
    }
    if (!json || typeof json !== 'object') {
      console.error(`recurrence-confidence: ledger '${p}' is not a JSON object`)
      process.exit(2)
    }
    parsed.push(json)
  }
  const result = classifyRecurrence(parsed, { ledgerPaths: paths, repoRoot })
  const text = JSON.stringify(result, null, 2) + '\n'
  process.stdout.write(text)
  if (out) {
    try {
      writeFileSync(out, text)
    } catch (e) {
      console.error(`recurrence-confidence: cannot write --out '${out}': ${e.message}`)
      process.exit(2)
    }
  }
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
  } catch {
    return fileURLToPath(import.meta.url) === process.argv[1]
  }
}
if (invokedDirectly()) main()

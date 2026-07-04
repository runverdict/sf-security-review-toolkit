#!/usr/bin/env node
/**
 * finding-clusters.mjs — deterministic de-duplication of the audit ledger's
 * OPEN findings for the triage headline.
 *
 * WHY THIS EXISTS. The audit fans out per dimension, and dimension targets
 * overlap (one Apex class is a target for apex-exposed-surface, tenant-isolation,
 * package-metadata, web-client…), so the SAME root cause is independently
 * re-found under several dimensions — at sometimes-different severities. A
 * cold-start run reported "17 confirmed (2 critical, 7 high)" for ~2 underlying
 * issues. The per-dimension ledger keeping every entry is intentional (it makes
 * re-audits incremental), but the triage HEADLINE must not present 17 lenses on
 * 2 problems as 17 problems.
 *
 * HONEST + DETERMINISTIC. The ledger stores `dimension`, not the synthesis-chosen
 * category, so a perfect root-cause merge is not derivable here. The stable
 * signal that IS derivable is the normalized file path plus cross-dimension
 * overlap: findings on the same file from ≥2 dimensions are very likely the same
 * root cause seen through different lenses. So this reports the raw counts AND a
 * conservative clustered view (distinct affected files, which files carry
 * multi-dimension overlap, max severity per file) — labeled as a lower bound on
 * distinct issues, never as an exact root-cause count. The triage decision does
 * not change (any open critical/high still halts); only the headline gets honest.
 *
 * Track-1b — `collapseCrossDimension(findings)` (exported, used by merge-ledger.mjs):
 * the per-FILE headline view above is a lower bound; this is the per-LOCATION ledger
 * merge that the §5.2 note now mandates IN the ledger, not just the report. Two OPEN
 * findings on the SAME normalized file AND an OVERLAPPING LINE SPAN — that is the ONLY
 * key — but DIFFERENT dimensions collapse into ONE entry at the highest verified
 * `adjusted_severity`, with every lens's reasoning/evidence preserved (labelled
 * `verdict_reasoning`/`evidence` for the human view + a structured `lenses[]` for
 * incremental re-merge). CONSERVATIVE by design: same file alone never merges, and a
 * title's method/symbol name is NOT a merge signal — the off-disk grade caught a
 * symbol-name path OVER-MERGING two DISTINCT vulns (a high FLS gap + a critical SOQL
 * injection in `Acct.getDetail`, no line spans) into one entry, hiding a finding. So
 * when two lenses of the SAME issue carry non-overlapping/absent spans the engine
 * UNDER-merges (separate entries, a noisier headline) rather than risk hiding a real
 * second bug — under-merge is the safe failure. It costs nothing: every real multi-lens
 * cluster carries overlapping spans (the cold-at-standard run carried one missing-FLS
 * root cause, all lenses at :21-2x, as multiple entries because the dedup key is
 * file+TITLE and the titles differed — this collapses that to one).
 *
 * PURE: no LLM, no deps, no network. IDEMPOTENT: collapse(collapse(x)) === collapse(x).
 *
 * USAGE: node finding-clusters.mjs --target <repo> [--json]
 */
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OPEN_STATES = new Set(['confirmed', 'regressed'])
const isOpen = (f) =>
  OPEN_STATES.has(String(f.status || '').toLowerCase()) ||
  (String(f.status || '').toLowerCase() === '' && String(f.verdict || '').toLowerCase() === 'confirmed_real')
const sevOf = (f) => String(f.adjusted_severity || f.severity || '').toLowerCase()
const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
// Exported (0.8.7) so harness/recurrence-confidence.mjs reuses the SAME tested
// locus primitives instead of re-deriving them — see docs/recurrence-confidence.md.
export const normFile = (f) => String(f || '').replace(/:[0-9]+(?:[:-][0-9]+)?\s*$/, '').trim() || '(unattributed)'

// ---------------------------------------------------------------------------
// Track-1b — cross-dimension, same-location ledger collapse.
// ---------------------------------------------------------------------------

// Parse a trailing :N / :N-M / :N:M / :N,M line span from a file ref → {lo,hi} | null.
export function lineSpan(file) {
  const m = String(file || '').match(/:(\d+)(?:[-:,](\d+))?\s*$/)
  if (!m) return null
  const a = parseInt(m[1], 10), b = m[2] ? parseInt(m[2], 10) : a
  return { lo: Math.min(a, b), hi: Math.max(a, b) }
}
export const spansOverlap = (a, b) => !!a && !!b && a.lo <= b.hi && b.lo <= a.hi

// Same code LOCATION: same normalized file AND OVERLAPPING LINE SPAN. That is the
// ONLY signal. Same file alone is never enough, and a title's method/symbol name is
// deliberately NOT used: the off-disk grade caught the symbol path OVER-MERGING two
// DISTINCT vulns (a high FLS gap and a critical SOQL injection, both in `Acct.getDetail`,
// no line spans) into one entry because both titles said `getDetail` — conflating two
// bugs that need two fixes, the exact missed-finding failure the toolkit must not produce.
// When two lenses of the SAME issue carry non-overlapping or absent spans, the engine
// UNDER-merges (keeps them separate — a noisier headline) rather than risk merging two
// DIFFERENT issues: under-merge is the safe failure, over-merge hides a finding. It costs
// nothing here — every real multi-lens cluster (e.g. the Solano triple-lens FLS, all at
// :21-2x) carries overlapping line spans, so the line-span path already covers them.
// Exported (Slice 2) so harness/reconcile-provenance.mjs reuses the SAME tested
// "same code location" primitive (deterministic-supersession) instead of re-deriving it.
export function sameLocation(a, b) {
  const fa = normFile(a.file), fb = normFile(b.file)
  if (fa === '(unattributed)' || fa !== fb) return false
  return spansOverlap(lineSpan(a.file), lineSpan(b.file))
}

// ---------------------------------------------------------------------------
// 0.8.71 — reachability-path rendering for the LLM-facing surfaces.
// The deterministic taint engines attach a machine-verified `reachabilityPath`
// to a finding (WHERE the path runs — locations only, never content). Rendering
// it into the verifier prompt and the finder-facing ledger digest hands the LLM
// the half the engine already proved, so its judgment lands on the one open
// question: is the SOURCE attacker-controlled / untrusted before the sink.
// Home is here with the other locus primitives; workflow-template.mjs carries
// the verbatim copy (it cannot import — see its header).
// ---------------------------------------------------------------------------
// ===== BEGIN PURE REACHABILITY RENDERER =====
// Render a machine-verified reachability path ({ source, intermediate[], sink } — locations
// only, the shape ingest-scanner-findings.mjs attaches) to ONE compact line:
//   source <file>:<line> → <file>:<line> → … → sink <file>:<line>
// Accepts a finding (reads its `reachabilityPath` attribute) or a bare path object. PURE +
// TOTAL: locations only (the attribute carries no content strings by design); '' on an
// absent / malformed / one-ended input — a path is relayed only when BOTH proven ends are
// present — and it NEVER throws. A malformed middle step is skipped; the proven ends stand.
// This block is kept byte-identical (minus `export`) between harness/finding-clusters.mjs
// (the importable home) and harness/workflow-template.mjs (self-contained — it cannot
// import); acceptance/test-coverage-accounting.mjs enforces the parity.
export function renderReachabilityPath(input) {
  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x)
  const loc = (s) =>
    isObj(s) && typeof s.file === 'string' && s.file !== '' && Number.isInteger(s.line) && s.line >= 1
      ? `${s.file}:${s.line}`
      : null
  const p = isObj(input) ? (isObj(input.reachabilityPath) ? input.reachabilityPath : input) : null
  if (!p) return ''
  const source = loc(p.source)
  const sink = loc(p.sink)
  if (!source || !sink) return '' // BOTH proven ends or nothing — never a one-ended "path"
  const middle = (Array.isArray(p.intermediate) ? p.intermediate : []).map(loc).filter(Boolean)
  return ['source ' + source, ...middle, 'sink ' + sink].join(' → ')
}
// ===== END PURE REACHABILITY RENDERER =====

const flat1 = (s) => String(s || '').replace(/\s+/g, ' ').trim()

// A finding is one or more lenses: a prior merged entry carries `lenses[]`; a plain
// entry is a single lens. Expanding lets collapse stay IDEMPOTENT + incremental.
function asLenses(f) {
  if (Array.isArray(f.lenses) && f.lenses.length) {
    return f.lenses.map((l) => ({
      id: l.id, dimension: l.dimension, title: l.title ?? f.title, file: l.file ?? f.file,
      severity: l.severity, adjusted_severity: l.adjusted_severity, verdict: l.verdict,
      status: l.status ?? f.status, verdict_reasoning: l.verdict_reasoning, evidence: l.evidence,
      exploit_scenario: l.exploit_scenario, recommendation: l.recommendation,
      first_seen: l.first_seen ?? f.first_seen, last_seen: l.last_seen ?? f.last_seen,
    }))
  }
  return [{
    id: f.id, dimension: f.dimension, title: f.title, file: f.file, severity: f.severity,
    adjusted_severity: sevOf(f), verdict: f.verdict, status: f.status, verdict_reasoning: f.verdict_reasoning,
    evidence: f.evidence, exploit_scenario: f.exploit_scenario, recommendation: f.recommendation,
    first_seen: f.first_seen, last_seen: f.last_seen,
  }]
}

// Merge a set of lenses (≥2 distinct dimensions) at one location into ONE entry.
function mergeLensCluster(lenses) {
  // one lens per dimension — freshest (max last_seen, then highest severity) wins
  const byDim = new Map()
  for (const l of lenses) {
    const ex = byDim.get(l.dimension)
    const better = !ex ||
      (l.last_seen || 0) > (ex.last_seen || 0) ||
      ((l.last_seen || 0) === (ex.last_seen || 0) && (SEV_RANK[l.adjusted_severity] ?? 9) < (SEV_RANK[ex.adjusted_severity] ?? 9))
    if (better) byDim.set(l.dimension, l)
  }
  const ls = [...byDim.values()].sort((a, b) => (a.dimension < b.dimension ? -1 : a.dimension > b.dimension ? 1 : 0))
  // base = highest verified severity (tie: dimension asc) — donates id/title/dimension
  const base = [...ls].sort((a, b) =>
    (SEV_RANK[a.adjusted_severity] ?? 9) - (SEV_RANK[b.adjusted_severity] ?? 9) || (a.dimension < b.dimension ? -1 : 1))[0]
  const maxSev = ls.reduce((m, l) => ((SEV_RANK[l.adjusted_severity] ?? 9) < (SEV_RANK[m] ?? 9) ? l.adjusted_severity : m), 'info')
  const label = (field) => ls.map((l) => `▸ ${l.dimension} [${l.adjusted_severity}]: ${flat1(l[field]) || '(none)'}`).join('\n')
  const out = {
    id: base.id, dimension: base.dimension, title: base.title,
    severity: base.severity || base.adjusted_severity, adjusted_severity: maxSev,
    file: base.file, status: 'confirmed',
    first_seen: Math.min(...ls.map((l) => l.first_seen || 1)),
    last_seen: Math.max(...ls.map((l) => l.last_seen || 1)),
    verdict: base.verdict || 'confirmed_real',
    verdict_reasoning: label('verdict_reasoning'),
    evidence: label('evidence'),
    exploit_scenario: base.exploit_scenario,
    recommendation: base.recommendation,
    resolution_note: flat1(base.recommendation).slice(0, 200) || undefined,
    merged_dimensions: ls.map((l) => l.dimension),
    lenses: ls.map((l) => ({
      id: l.id, dimension: l.dimension, title: l.title, file: l.file,
      severity: l.severity, adjusted_severity: l.adjusted_severity, verdict: l.verdict, status: l.status,
      verdict_reasoning: l.verdict_reasoning, evidence: l.evidence,
      exploit_scenario: l.exploit_scenario, recommendation: l.recommendation,
      first_seen: l.first_seen, last_seen: l.last_seen,
    })),
  }
  return out
}

const lineLo = (f) => { const s = lineSpan(f.file); return s ? s.lo : 0 }
const sortKey = (a, b) =>
  (normFile(a.file) < normFile(b.file) ? -1 : normFile(a.file) > normFile(b.file) ? 1 : 0) ||
  lineLo(a) - lineLo(b) ||
  (String(a.dimension) < String(b.dimension) ? -1 : String(a.dimension) > String(b.dimension) ? 1 : 0) ||
  (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0)

/**
 * Collapse OPEN findings that share the same file + same location across DIFFERENT
 * dimensions into ONE entry at the highest verified adjusted_severity. Non-open
 * findings (refuted/fixed/accepted_risk) pass through untouched. Pure + idempotent.
 */
export function collapseCrossDimension(findings) {
  const arr = Array.isArray(findings) ? findings : []
  const open = arr.filter(isOpen)
  const out = arr.filter((f) => !isOpen(f)) // non-open pass through
  const used = new Array(open.length).fill(false)
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue
    const cluster = [open[i]]
    used[i] = true
    let grew = true
    while (grew) {
      grew = false
      for (let j = 0; j < open.length; j++) {
        if (used[j]) continue
        if (cluster.some((c) => sameLocation(c, open[j]))) { cluster.push(open[j]); used[j] = true; grew = true }
      }
    }
    const lenses = cluster.flatMap(asLenses)
    const dims = new Set(lenses.map((l) => l.dimension))
    if (dims.size >= 2) out.push(mergeLensCluster(lenses))
    else out.push(...cluster)
  }
  return out.sort(sortKey)
}

// All dimensions a finding represents — a Track-1b merged entry stands for every
// lens in `merged_dimensions`, not just its top-level (base) `dimension`.
const dimsOf = (f) =>
  Array.isArray(f.merged_dimensions) && f.merged_dimensions.length
    ? f.merged_dimensions
    : (f.dimension ? [String(f.dimension)] : [])

export function clusterFindings(findings) {
  const open = (Array.isArray(findings) ? findings : []).filter(isOpen)
  const by_severity = {}
  for (const f of open) by_severity[sevOf(f) || 'unknown'] = (by_severity[sevOf(f) || 'unknown'] || 0) + 1

  const fileMap = new Map()
  for (const f of open) {
    const key = normFile(f.file)
    if (!fileMap.has(key)) fileMap.set(key, { file: key, count: 0, dimensions: new Set(), severities: [] })
    const c = fileMap.get(key)
    c.count++
    for (const d of dimsOf(f)) c.dimensions.add(d)
    c.severities.push(sevOf(f))
  }
  const files = [...fileMap.values()]
    .map((c) => ({
      file: c.file,
      count: c.count,
      dimensions: [...c.dimensions].sort(),
      max_severity: c.severities.sort((a, b) => (SEV_RANK[a] ?? 9) - (SEV_RANK[b] ?? 9))[0] || 'unknown',
    }))
    .sort((a, b) => (SEV_RANK[a.max_severity] ?? 9) - (SEV_RANK[b.max_severity] ?? 9) || b.count - a.count)

  const multi_dimension_files = files.filter((f) => f.dimensions.length >= 2)
  // Distinct critical/high at the CLUSTER level (max severity per file), so a
  // root cause flagged critical by one dimension and high by another counts once.
  const distinct_critical = files.filter((f) => f.max_severity === 'critical').length
  const distinct_high = files.filter((f) => f.max_severity === 'high').length

  const allDims = [...new Set(open.flatMap(dimsOf))].sort()
  return {
    confirmed_count: open.length,
    by_severity,
    dimensions_touched: allDims,
    distinct_files: files.length,
    distinct_critical_files: distinct_critical,
    distinct_high_files: distinct_high,
    multi_dimension_overlap: multi_dimension_files.map((f) => ({ file: f.file, dimensions: f.dimensions })),
    files,
    headline: `${open.length} confirmed findings across ${allDims.length} dimensions → ${files.length} distinct affected file(s) (${distinct_critical} critical, ${distinct_high} high at file level); ${multi_dimension_files.length} file(s) carry cross-dimension overlap (LIKELY the same root cause seen through multiple lenses, though distinct co-located defects are possible — see each file's dimension list). The distinct-file count is a lower bound on distinct issues, not an exact root-cause merge; the per-file max severity can also under-count two genuinely-separate criticals in one file, so treat it as a floor.`,
  }
}

// ---------------------------------------------------------------------------
// WI-04 / INV-08 — the VERBATIM finding-cluster triage headline (presentation
// consistency Slice 3). The output-class analog of the gate-spec engine: the
// ENGINE owns the block SKELETON, the driver pastes it byte-for-byte.
//
// WHY THIS EXISTS. The triage headline was driver-improvised prose — rendered as a
// table one run and text the next, and it is the FAILURE VERDICT (an open
// critical/high halts the run), so it MUST read identically at the two sites that
// print it: `security-review-journey` Step 3 (the blocker gate) and `audit-codebase`
// Step 6 (the audit exec summary). This pins it: a fixed-block render over the
// already-deterministic `clusterFindings()` output, mirroring `render-stability.mjs`.
//
// FIXED ORDER (the contract): raw counts FIRST, then the clustered headline. The raw
// per-severity counts come before the clustered file view so an open critical/high is
// never hidden behind the (smaller) distinct-file number — the cluster view is a lower
// bound on distinct issues, never a downgrade of the count that gates the run.
// ---------------------------------------------------------------------------

// Canonical severity print order — always shown so the skeleton is fixed run-to-run.
const SEV_ORDER = ['critical', 'high', 'medium', 'low', 'info']

/**
 * Pure: the `clusterFindings()` result (or null) → the fixed triage-headline block.
 * Three branches, all honest, none ever asserting the code is safe/clean:
 *   - UNAVAILABLE (null / not a cluster object) → an honest "could not read" line, never
 *     a fabricated "clean" (a missing ledger is not a passed audit);
 *   - NONE (a valid cluster with 0 open confirmed) → the false-negative-aware "nothing
 *     new this pass" line;
 *   - PRESENT → raw per-severity counts, then the clustered distinct-file table, then the
 *     `clusterFindings().headline` narrative verbatim (its lower-bound caveat is the
 *     single source — never re-worded here).
 */
export function renderClusterHeadline(cluster) {
  const H = '### Finding triage — cluster view'
  if (!cluster || typeof cluster !== 'object' || !Number.isInteger(cluster.confirmed_count)) {
    return [
      H, '',
      'Finding cluster view unavailable: the audit ledger could not be read (no `.security-review/audit-ledger.json`, ' +
        'or it is unreadable/non-JSON). This is NOT a clean result — run `/sf-security-review-toolkit:audit-codebase` ' +
        'first. Salesforce performs its own penetration test regardless.',
    ].join('\n')
  }
  if (cluster.confirmed_count === 0) {
    return [
      H, '',
      '**No open confirmed findings.** The audited dimensions surfaced nothing new this pass. Verification bounds ' +
        'false positives; it does NOT bound false negatives — "no findings" is never "no vulnerabilities" and never ' +
        '"secure"/"clean" (CONVENTIONS §2). Salesforce performs its own penetration test regardless.',
    ].join('\n')
  }

  const bs = cluster.by_severity && typeof cluster.by_severity === 'object' ? cluster.by_severity : {}
  const sevStr = SEV_ORDER.map((s) => `${s} ${Number.isFinite(bs[s]) ? bs[s] : 0}`).join(' · ')
  const unknown = Number.isFinite(bs.unknown) ? bs.unknown : 0
  const dims = Array.isArray(cluster.dimensions_touched) ? cluster.dimensions_touched.length : 0
  const df = Number.isFinite(cluster.distinct_files) ? cluster.distinct_files : 0
  const dcf = Number.isFinite(cluster.distinct_critical_files) ? cluster.distinct_critical_files : 0
  const dhf = Number.isFinite(cluster.distinct_high_files) ? cluster.distinct_high_files : 0
  const overlap = Array.isArray(cluster.multi_dimension_overlap) ? cluster.multi_dimension_overlap.length : 0

  const L = [H, '']
  // 1) RAW counts first — the number that gates the run, never hidden behind the cluster.
  L.push(
    `**Raw confirmed findings: ${cluster.confirmed_count}** (${sevStr}${unknown ? ` · unknown ${unknown}` : ''}) ` +
      `across ${dims} dimension(s).`
  )
  L.push('')
  // 2) THEN the clustered view — a conservative lower bound on distinct issues.
  L.push('**Clustered (distinct affected files — a conservative lower bound on distinct issues):**')
  L.push('')
  L.push('| Metric | Count |')
  L.push('|---|---|')
  L.push(`| Distinct affected files | ${df} |`)
  L.push(`| Files topping out at critical | ${dcf} |`)
  L.push(`| Files topping out at high | ${dhf} |`)
  L.push(`| Files with cross-dimension overlap | ${overlap} |`)
  L.push('')
  // 3) The headline narrative verbatim — its lower-bound caveat is the single source of truth.
  L.push(String(cluster.headline || ''))
  return L.join('\n')
}

/**
 * Honesty guard (dict-vs-array corollary): a ledger whose `findings` is
 * PRESENT but NOT an array (a dict like `{factor:{...}}`) is an UNREADABLE shape, NOT
 * "no findings". Return null so `renderClusterHeadline` takes its UNAVAILABLE branch
 * ("could not read the ledger") — never the NONE branch ("no open confirmed findings"),
 * which would read as a false clean. A null/undefined/array `findings` is handled as
 * before (`clusterFindings` tolerates it → a 0-count cluster for the legitimate empty case).
 * Unreachable via the merge-ledger pipeline (it forces `findings` to an array); this is
 * defense-in-depth on the honesty contract, not a live bug fix.
 */
export function clusterOrNullFromFindings(findings) {
  if (findings != null && !Array.isArray(findings)) return null
  return clusterFindings(findings)
}

function main() {
  const arg = (flag, def) => {
    const i = process.argv.indexOf(flag)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
  }
  const TARGET = arg('--target', process.cwd())
  const AS_JSON = process.argv.includes('--json')
  // WI-04: `--headline` (alias `--format md`) prints the fixed verbatim triage block.
  const AS_HEADLINE = process.argv.includes('--headline') || arg('--format', '') === 'md'
  let ledger = { findings: [] }
  let ledgerRead = false
  try { ledger = JSON.parse(readFileSync(join(TARGET, '.security-review', 'audit-ledger.json'), 'utf8')); ledgerRead = true } catch {}
  const r = clusterFindings(ledger.findings)
  if (AS_JSON) process.stdout.write(JSON.stringify(r, null, 2) + '\n')
  // A genuinely-missing/unreadable ledger → UNAVAILABLE (pass null). A PRESENT-but-non-array
  // `findings` (a dict) is likewise unreadable, NOT "no findings" → UNAVAILABLE, never a false
  // clean (clusterOrNullFromFindings returns null for that shape).
  else if (AS_HEADLINE) process.stdout.write(renderClusterHeadline(ledgerRead ? clusterOrNullFromFindings(ledger.findings) : null) + '\n')
  else process.stdout.write(r.headline + '\n')
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

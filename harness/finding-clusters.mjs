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
function sameLocation(a, b) {
  const fa = normFile(a.file), fb = normFile(b.file)
  if (fa === '(unattributed)' || fa !== fb) return false
  return spansOverlap(lineSpan(a.file), lineSpan(b.file))
}

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

function main() {
  const arg = (flag, def) => {
    const i = process.argv.indexOf(flag)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
  }
  const TARGET = arg('--target', process.cwd())
  const AS_JSON = process.argv.includes('--json')
  let ledger = { findings: [] }
  try { ledger = JSON.parse(readFileSync(join(TARGET, '.security-review', 'audit-ledger.json'), 'utf8')) } catch {}
  const r = clusterFindings(ledger.findings)
  if (AS_JSON) process.stdout.write(JSON.stringify(r, null, 2) + '\n')
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

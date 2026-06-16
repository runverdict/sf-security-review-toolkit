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
 * PURE: no LLM, no deps, no network.
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
const normFile = (f) => String(f || '').replace(/:[0-9]+(?:[:-][0-9]+)?\s*$/, '').trim() || '(unattributed)'

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
    if (f.dimension) c.dimensions.add(String(f.dimension))
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

  return {
    confirmed_count: open.length,
    by_severity,
    dimensions_touched: [...new Set(open.map((f) => f.dimension).filter(Boolean))].sort(),
    distinct_files: files.length,
    distinct_critical_files: distinct_critical,
    distinct_high_files: distinct_high,
    multi_dimension_overlap: multi_dimension_files.map((f) => ({ file: f.file, dimensions: f.dimensions })),
    files,
    headline: `${open.length} confirmed findings across ${[...new Set(open.map((f) => f.dimension).filter(Boolean))].length} dimensions → ${files.length} distinct affected file(s) (${distinct_critical} critical, ${distinct_high} high at file level); ${multi_dimension_files.length} file(s) carry cross-dimension overlap (LIKELY the same root cause seen through multiple lenses, though distinct co-located defects are possible — see each file's dimension list). The distinct-file count is a lower bound on distinct issues, not an exact root-cause merge; the per-file max severity can also under-count two genuinely-separate criticals in one file, so treat it as a floor.`,
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

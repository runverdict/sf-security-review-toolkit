#!/usr/bin/env node
/**
 * baseline-counts.mjs — deterministic source of truth for the baseline's
 * self-description numbers (total / verified_primary / web_research_unverified /
 * conflicting + the last_verified:null diagnostic).
 *
 * WHY THIS EXISTS. The README and SOURCES.md hand-narrated these counts, and
 * they drifted (claimed 146/115/30 while the data was 155/118/36/1) when WI-17
 * and WI-19 added entries — the exact "narrate an estimate instead of counting
 * the list" failure the toolkit forbids in PARTNER output, committed against its
 * own metadata. This is the counter; the docs cite it instead of guessing, and
 * the standing test (acceptance/test-baseline-counts.mjs) fails the build if the
 * prose drifts from the data again.
 *
 * PURE: dependency-free line parse; no LLM, no deps, no network.
 *
 * USAGE: node baseline-counts.mjs [--plugin <dir>] [--json]
 */
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Strict ISO calendar date (YYYY-MM-DD), bounded month/day so a malformed token
// ("soon", "9999-99-99", "tbd") is REJECTED, not ranked. ISO dates sort
// lexicographically, so max/min need no Date parsing — Workflow-runtime safe
// (no Date.now / argless new Date).
const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

export function countBaseline(yamlText) {
  const counts = { total: 0, verified_primary: 0, web_research_unverified: 0, conflicting: 0, other_verification: 0, last_verified_null: 0, last_verified_malformed: 0 }
  const validDates = [] // one valid ISO last_verified per entry that has one
  let cur = null
  const flush = () => {
    if (!cur) return
    counts.total++
    const v = cur.verification
    if (v === 'verified_primary') counts.verified_primary++
    else if (v === 'web_research_unverified') counts.web_research_unverified++
    else if (v === 'conflicting') counts.conflicting++
    else counts.other_verification++
    const lv = cur.last_verified
    if (lv === null || lv === 'null' || lv === undefined) counts.last_verified_null++
    else if (ISO_DATE.test(lv)) validDates.push(lv)
    else counts.last_verified_malformed++ // a non-null, non-ISO token never ranks
  }
  for (const raw of yamlText.split('\n')) {
    const idm = raw.match(/^- id:\s*(\S+)/)
    if (idm) { flush(); cur = { id: idm[1], verification: null, last_verified: undefined }; continue }
    if (!cur) continue
    const ver = raw.match(/^\s+verification:\s*(\S+)/)
    if (ver) cur.verification = ver[1]
    const lv = raw.match(/^\s+last_verified:\s*(\S+)/)
    if (lv) cur.last_verified = lv[1].replace(/^["']|["']$/g, '')
  }
  flush()
  // ---- currency (deterministic; ISO YYYY-MM-DD sort lexicographically) ----
  let newest_verified = null, oldest_verified = null, newest_verified_count = 0
  if (validDates.length) {
    newest_verified = validDates.reduce((m, d) => (d > m ? d : m), validDates[0])
    oldest_verified = validDates.reduce((m, d) => (d < m ? d : m), validDates[0])
    newest_verified_count = validDates.filter((d) => d === newest_verified).length
  }
  counts.newest_verified = newest_verified
  counts.newest_verified_count = newest_verified_count
  counts.oldest_verified = oldest_verified
  return counts
}

function main() {
  const arg = (flag, def) => {
    const i = process.argv.indexOf(flag)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
  }
  const PLUGIN = arg('--plugin', fileURLToPath(new URL('..', import.meta.url)))
  const BASELINE = arg('--baseline', join(PLUGIN, 'baseline', 'requirements-baseline.yaml'))
  const AS_JSON = process.argv.includes('--json')
  const CURRENCY = process.argv.includes('--currency')
  const text = readFileSync(BASELINE, 'utf8')
  const c = countBaseline(text)
  if (AS_JSON) {
    process.stdout.write(JSON.stringify(c, null, 2) + '\n')
  } else if (CURRENCY) {
    // Deterministic currency — the driver reports this instead of hand-rolling a date sort
    // (a null/malformed token must never out-rank a real date).
    process.stdout.write(
      `Baseline currency: newest_verified ${c.newest_verified ?? 'none'} ` +
        `(${c.newest_verified_count} ${c.newest_verified_count === 1 ? 'entry' : 'entries'}); ` +
        `oldest_verified ${c.oldest_verified ?? 'none'}; ` +
        `${c.last_verified_null} unverified (last_verified: null)` +
        (c.last_verified_malformed ? `; ${c.last_verified_malformed} malformed (excluded from ranking)` : '') +
        '\n'
    )
  } else {
    process.stdout.write(
      `Baseline: ${c.total} entries — ${c.verified_primary} verified_primary, ` +
        `${c.web_research_unverified} web_research_unverified, ${c.conflicting} conflicting` +
        (c.other_verification ? `, ${c.other_verification} other` : '') +
        ` (${c.last_verified_null} carry last_verified: null)\n`
    )
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

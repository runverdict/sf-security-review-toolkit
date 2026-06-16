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

export function countBaseline(yamlText) {
  const counts = { total: 0, verified_primary: 0, web_research_unverified: 0, conflicting: 0, other_verification: 0, last_verified_null: 0 }
  let cur = null
  const flush = () => {
    if (!cur) return
    counts.total++
    const v = cur.verification
    if (v === 'verified_primary') counts.verified_primary++
    else if (v === 'web_research_unverified') counts.web_research_unverified++
    else if (v === 'conflicting') counts.conflicting++
    else counts.other_verification++
    if (cur.last_verified === null || cur.last_verified === 'null' || cur.last_verified === undefined) counts.last_verified_null++
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
  return counts
}

function main() {
  const arg = (flag, def) => {
    const i = process.argv.indexOf(flag)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
  }
  const PLUGIN = arg('--plugin', fileURLToPath(new URL('..', import.meta.url)))
  const AS_JSON = process.argv.includes('--json')
  const text = readFileSync(join(PLUGIN, 'baseline', 'requirements-baseline.yaml'), 'utf8')
  const c = countBaseline(text)
  if (AS_JSON) {
    process.stdout.write(JSON.stringify(c, null, 2) + '\n')
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

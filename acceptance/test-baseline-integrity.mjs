#!/usr/bin/env node
/**
 * Standing test: every baseline entry is well-formed. Guards the data layer
 * the whole toolkit keys off — applicability (applies_to tokens), the SCI
 * severity accounting (severity_if_missing), and the currency model
 * (verification ⟺ last_verified). A malformed entry silently corrupts
 * downstream math (a typo'd applies_to token drops a requirement from every
 * scope; a verified_primary with no last_verified fakes currency).
 *
 * This is STRICTER than test-baseline-counts (which only checks the aggregate
 * count equality web_research_unverified == last_verified:null): it pins the
 * per-entry implications, so a verified_primary-with-null and a
 * web_research-with-date that net to equal counts can no longer hide.
 *
 * Also pins the 2026-06-20 PMD-rule prediction additions are present + correct
 * (encode-don't-park: a coverage win must not silently regress out of the data).
 *
 * Dependency-free: `node acceptance/test-baseline-integrity.mjs`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const text = readFileSync(
  fileURLToPath(new URL('../baseline/requirements-baseline.yaml', import.meta.url)),
  'utf8'
)

// Dependency-free line parse mirroring the harness engines (applies_to is inline
// [a, b]; the scalar fields are `key: value` one per line under the entry).
function parseEntries(yamlText) {
  const out = []
  let cur = null
  for (const raw of yamlText.split('\n')) {
    const idm = raw.match(/^- id:\s*(\S+)/)
    if (idm) {
      cur = { id: idm[1], verification: null, last_verified: undefined, applies_to: [], severity: null, line: out.length }
      out.push(cur)
      continue
    }
    if (!cur) continue
    let m
    if ((m = raw.match(/^\s+verification:\s*(\S+)/))) cur.verification = m[1]
    if ((m = raw.match(/^\s+last_verified:\s*(\S+)/))) cur.last_verified = m[1].replace(/^["']|["']$/g, '')
    if ((m = raw.match(/^\s+applies_to:\s*\[([^\]]*)\]/))) cur.applies_to = m[1].split(',').map((s) => s.trim()).filter(Boolean)
    if ((m = raw.match(/^\s+severity_if_missing:\s*(\S+)/))) cur.severity = m[1]
  }
  return out
}

const APPLIES_TOKENS = new Set(['managed-package', 'external-endpoint', 'mcp-server', 'agentforce', 'canvas', 'all'])
const SEVERITIES = new Set(['blocker', 'major', 'minor', 'informational'])
const VERIFICATIONS = new Set(['verified_primary', 'web_research_unverified', 'conflicting'])
const isNull = (v) => v === undefined || v === 'null'

const entries = parseEntries(text)

let pass = 0, fail = 0
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

console.log(`baseline-integrity standing test (${entries.length} entries)`)

check('parsed a non-trivial number of entries', () => {
  assert.ok(entries.length >= 150, `only parsed ${entries.length} entries — parser or file regressed`)
})

check('no duplicate ids', () => {
  const seen = new Map()
  const dupes = []
  for (const e of entries) { if (seen.has(e.id)) dupes.push(e.id); seen.set(e.id, true) }
  assert.deepEqual(dupes, [], `duplicate ids: ${dupes.join(', ')}`)
})

check('every entry has a non-empty applies_to of known tokens', () => {
  const bad = entries.filter((e) => e.applies_to.length === 0 || e.applies_to.some((t) => !APPLIES_TOKENS.has(t)))
  assert.deepEqual(bad.map((e) => `${e.id}:[${e.applies_to.join(',')}]`), [],
    `entries with empty or unknown applies_to: ${bad.map((e) => e.id).join(', ')}`)
})

check('every entry has a known severity_if_missing', () => {
  const bad = entries.filter((e) => !SEVERITIES.has(e.severity))
  assert.deepEqual(bad.map((e) => `${e.id}:${e.severity}`), [], `bad severity: ${bad.map((e) => e.id).join(', ')}`)
})

check('every entry has a known verification value', () => {
  const bad = entries.filter((e) => !VERIFICATIONS.has(e.verification))
  assert.deepEqual(bad.map((e) => `${e.id}:${e.verification}`), [], `bad verification: ${bad.map((e) => e.id).join(', ')}`)
})

check('verified_primary ⟹ non-null last_verified (no faked currency)', () => {
  const bad = entries.filter((e) => e.verification === 'verified_primary' && isNull(e.last_verified))
  assert.deepEqual(bad.map((e) => e.id), [], `verified_primary with null last_verified: ${bad.map((e) => e.id).join(', ')}`)
})

check('web_research_unverified ⟹ null last_verified (no faked verification)', () => {
  const bad = entries.filter((e) => e.verification === 'web_research_unverified' && !isNull(e.last_verified))
  assert.deepEqual(bad.map((e) => e.id), [], `web_research_unverified with a date: ${bad.map((e) => e.id).join(', ')}`)
})

// Encode-don't-park: the 2026-06-20 PMD-rule prediction additions must persist.
const byId = new Map(entries.map((e) => [e.id, e]))
check('PMD prediction: violation-feature-management-change-protection present + verified_primary + managed-package', () => {
  const e = byId.get('violation-feature-management-change-protection')
  assert.ok(e, 'entry missing — the AvoidFeatureManagementChangeProtection prediction regressed out of the baseline')
  assert.equal(e.verification, 'verified_primary')
  assert.ok(e.applies_to.includes('managed-package'), 'must be gated to managed-package')
  assert.equal(e.severity, 'blocker', 'a Critical-tier PMD auto-fail should carry severity_if_missing: blocker')
})
check('PMD prediction: violation-getinstance-with-taint present + verified_primary + managed-package', () => {
  const e = byId.get('violation-getinstance-with-taint')
  assert.ok(e, 'entry missing — the AvoidGetInstanceWithTaint prediction regressed out of the baseline')
  assert.equal(e.verification, 'verified_primary')
  assert.ok(e.applies_to.includes('managed-package'), 'must be gated to managed-package')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

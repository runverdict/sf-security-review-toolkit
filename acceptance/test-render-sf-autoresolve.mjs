#!/usr/bin/env node
/**
 * Standing test for the VERBATIM SF-CLI auto-resolution render
 * (harness/render-sf-autoresolve.mjs, WI-06 / INV-45, presentation-consistency Slice 4).
 * The render carries the two facts a reviewer scrutinizes hardest — the security FLAGS and
 * the CONFLICTS between CLI evidence and operator answers — both of which must be SURFACED,
 * never dropped or silently resolved. And it must NEVER render a secret (CONVENTIONS §6).
 *
 * SA1  determinism — same inputs twice → byte-identical (fn + CLI).
 * SA2  golden — the auto-resolved rows table, the FLAGS section (every flag class: http://
 *      non-TLS, wildcard, no-Named-Credential, ViewAll/ModifyAll over-grant), the CONFLICTS
 *      section (CLI is evidence, not an override).
 * SA3  secret guard — a secret-named key and a token-shaped value are REDACTED, never echoed.
 * SA4  fail-safe — sfAutoResolved:false / no file → an honest "auto-resolution skipped" line,
 *      never a crash and never a fabricated result.
 * SA5  wiring — scope-submission Step 4 grants + references the harness + states verbatim.
 *
 * Dependency-free: `node acceptance/test-render-sf-autoresolve.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { renderSfAutoResolve, deriveFlags } from '../harness/render-sf-autoresolve.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'render-sf-autoresolve.mjs')

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) } }
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'rsa-')); dirs.push(d); return d }

const SECRET_VALUE = 'AbCdEf0123456789AbCdEf0123456789xx' // a base64-ish blob → must be redacted
const AR = {
  generated: '2026-06-12T14:00:00Z', devhub: 'acme-devhub',
  rows: [
    { key: 'isReleased', value: true, source: 'sf package version report --json', provenance: 'automated' },
    { key: 'isSecurityReviewed', value: false, source: 'Tooling SOQL SubscriberPackageVersion', provenance: 'automated' },
    { key: 'clientSecret', value: SECRET_VALUE, source: 'should-never-happen', provenance: 'automated' },
  ],
  endpoints: [
    { host: 'https://api.example.com', namedCredential: 'Example_API', source: 'RemoteSiteSettings' },
    { host: 'http://legacy.example.com', namedCredential: null, source: 'CspTrustedSites' },
    { host: 'https://*.example.com', namedCredential: 'Wild_NC', source: 'RemoteSiteSettings' },
  ],
  permissions: [{ permissionSet: 'Example_Admin', viewAllRecords: true, modifyAllData: true, source: 'PermissionSet' }],
  conflicts: [{ field: 'packagePromoted', operatorClaim: 'promoted', autoResolved: 'IsReleased=false', source: 'sf package version report' }],
}
const RAN = { autoresolve: AR, manifest: { sfAutoResolved: true } }

console.log('render-sf-autoresolve standing test')

check('SA1 determinism: same inputs twice → byte-identical (fn + CLI)', () => {
  assert.equal(renderSfAutoResolve(RAN), renderSfAutoResolve(RAN))
  const d = tmp()
  const af = join(d, 'ar.json'); writeFileSync(af, JSON.stringify(AR))
  const mf = join(d, 'm.json'); writeFileSync(mf, JSON.stringify({ sfAutoResolved: true }))
  const a = execFileSync('node', [CLI, '--input', af, '--manifest', mf], { encoding: 'utf8' })
  const b = execFileSync('node', [CLI, '--input', af, '--manifest', mf], { encoding: 'utf8' })
  assert.equal(a, b)
})

check('SA2 golden: rows table + FLAGS (all four classes) + CONFLICTS section', () => {
  const block = renderSfAutoResolve(RAN)
  assert.match(block, /### SF-CLI auto-resolution — 2026-06-12T14:00:00Z · DevHub acme-devhub/)
  assert.match(block, /\| Key \| Value \| Source \|/)
  assert.match(block, /\| isReleased \| true \| sf package version report --json \|/)
  // FLAGS — every class surfaced
  assert.match(block, /\*\*Security flags \(5\)\*\*/)
  assert.match(block, /non-TLS \(http:\/\/\) host: http:\/\/legacy\.example\.com/)
  assert.match(block, /wildcard host: https:\/\/\*\.example\.com/)
  assert.match(block, /host with NO matching Named Credential: http:\/\/legacy\.example\.com/)
  assert.match(block, /over-grant: permission set 'Example_Admin' grants ViewAllRecords/)
  assert.match(block, /over-grant: permission set 'Example_Admin' grants ModifyAllData/)
  // CONFLICTS — the CLI is evidence, not an override
  assert.match(block, /\*\*Conflicts with operator answers \(1\)\*\*/)
  assert.match(block, /CLI is EVIDENCE, not an override/)
  assert.match(block, /packagePromoted: operator said "promoted" but auto-resolved IsReleased=false/)
})

check('SA2b deriveFlags surfaces all four classes, deduped (defense-in-depth, never drops an over-grant)', () => {
  const flags = deriveFlags(AR)
  assert.equal(flags.length, 5)
  assert.equal(new Set(flags).size, flags.length, 'deduped')
  // a clean endpoint set → no flags
  assert.deepEqual(deriveFlags({ endpoints: [{ host: 'https://ok.example.com', namedCredential: 'NC' }], permissions: [] }), [])
})

check('SA3 secret guard: a secret-named key / token-shaped value is REDACTED, never echoed', () => {
  const block = renderSfAutoResolve(RAN)
  assert.ok(!block.includes(SECRET_VALUE), 'the secret value is NEVER rendered')
  assert.match(block, /\| clientSecret \| \[redacted — a secret belongs in an env var \/ vault/, 'the secret cell is redacted')
  // a JWT-shaped value in a non-secret-named key is still caught by the value heuristic
  const jwt = renderSfAutoResolve({ autoresolve: { rows: [{ key: 'note', value: 'eyJhbGc.eyJzdWI.sig', source: 's' }] }, manifest: { sfAutoResolved: true } })
  assert.ok(!jwt.includes('eyJhbGc.eyJzdWI.sig'), 'a JWT-shaped value is redacted by the value heuristic')
})

check('SA4 fail-safe: sfAutoResolved:false / no file → honest "auto-resolution skipped", never fabricated', () => {
  for (const inp of [
    { autoresolve: AR, manifest: { sfAutoResolved: false } },
    { autoresolve: null, manifest: { sfAutoResolved: true } },
    { autoresolve: null, manifest: null },
    {},
    undefined,
  ]) {
    const block = renderSfAutoResolve(inp)
    assert.match(block, /Auto-resolution skipped \(no DevHub \/ no consent \/ no `sf`\)/)
    assert.ok(!/\*\*Security flags/.test(block), 'no flags section on the skipped branch')
  }
  // CLI: a manifest with sfAutoResolved:false → skipped, never a crash
  const d = tmp(); const mf = join(d, 'm.json'); writeFileSync(mf, JSON.stringify({ sfAutoResolved: false }))
  const out = execFileSync('node', [CLI, '--input', join(d, 'nope.json'), '--manifest', mf], { encoding: 'utf8' })
  assert.match(out, /Auto-resolution skipped/)
})

check('SA4b ran but no rows/flags/conflicts → honest empty markers, never a fabricated finding', () => {
  const block = renderSfAutoResolve({ autoresolve: { generated: '2026-06-12', rows: [], endpoints: [], permissions: [], conflicts: [] }, manifest: { sfAutoResolved: true } })
  assert.match(block, /\(no auto-resolved rows recorded\)/)
  assert.match(block, /\*\*Security flags:\*\* none recorded/)
  assert.match(block, /\*\*Conflicts with operator answers:\*\* none/)
})

check('SA5 wiring: scope-submission Step 4 grants + references the harness + verbatim', () => {
  const skill = readFileSync(join(PLUGIN, 'skills', 'scope-submission', 'SKILL.md'), 'utf8')
  assert.match(skill, /Bash\(node \*harness\/render-sf-autoresolve\.mjs \*\)/, 'grants render-sf-autoresolve')
  assert.match(skill, /render-sf-autoresolve\.mjs --target/, 'calls the harness')
  assert.match(skill, /verbatim/i, 'states the verbatim contract')
  assert.match(skill, /Security flags|Conflicts with operator/i, 'references the flags/conflicts sections')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

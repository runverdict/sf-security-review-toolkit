#!/usr/bin/env node
/**
 * Standing regression test for element-precise applicability
 * (harness/applicable-requirements.mjs + the baseline `applies_to` re-gate).
 *
 * Guards the cold-start finding: a plain managed package (no Agentforce agent,
 * no MCP server) must NOT pull in agentforce-* / mcp-* requirements. The
 * regression risk of the fix is the inverse — that a REAL agent/MCP package
 * stops getting them — so this test pins both directions:
 *   - Plain-package elements (no agentforce/mcp-server) → those reqs DROP.
 *   - + a synthetic `agentforce` element → agentforce-* COME BACK.
 *   - + a synthetic `mcp-server` element → mcp-* COME BACK.
 *
 * Dependency-free: `node acceptance/test-applicable-requirements.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseBaselineApplies, computeApplicable, renderApplicable } from '../harness/applicable-requirements.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'applicable-requirements.mjs')
const baseline = readFileSync(
  fileURLToPath(new URL('../baseline/requirements-baseline.yaml', import.meta.url)),
  'utf8'
)
const entries = parseBaselineApplies(baseline)
const agentforceIds = entries.filter((e) => e.id.startsWith('agentforce')).map((e) => e.id)
// These two were leaking via the generic `managed-package` token; re-gated to
// require an AgentExchange-listing element (mcp-server/agentforce). NOTE:
// mcpthreat-ssrf-mitigation is deliberately NOT here — it legitimately applies
// to any external-endpoint (SSRF is a real risk for any server-side fetcher),
// so a plain external API must KEEP it (the B1 regression guard below).
const LEAKED_MCP = ['mcp-listing-managed-package', 'mcp-tool-actions-not-packageable']

// A managed package with Apex/LWC + an external
// REST API — NO agentforce agent, NO MCP server.
const PLAIN_PACKAGE = ['managed-package', 'apex', 'lwc', 'named-credential', 'csp-trusted-site', 'external-endpoint']

let pass = 0, fail = 0
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

console.log('applicable-requirements standing test')

check('baseline parses with ≥10 agentforce-* entries', () => {
  assert.ok(agentforceIds.length >= 10, `found ${agentforceIds.length} agentforce-* ids`)
})

check('plain managed package excludes ALL agentforce-* requirements', () => {
  const appl = new Set(computeApplicable(entries, PLAIN_PACKAGE))
  const leaked = agentforceIds.filter((id) => appl.has(id))
  assert.deepEqual(leaked, [], `leaked: ${leaked.join(', ')}`)
})

check('plain managed package excludes the re-gated mcp-* requirements', () => {
  const appl = new Set(computeApplicable(entries, PLAIN_PACKAGE))
  const leaked = LEAKED_MCP.filter((id) => appl.has(id))
  assert.deepEqual(leaked, [], `leaked: ${leaked.join(', ')}`)
})

check('REGRESSION GUARD: + agentforce element → all agentforce-* come back', () => {
  const appl = new Set(computeApplicable(entries, [...PLAIN_PACKAGE, 'agentforce']))
  const missing = agentforceIds.filter((id) => !appl.has(id))
  assert.deepEqual(missing, [], `missing: ${missing.join(', ')}`)
  // and the AgentExchange-listing-as-package reqs apply to an agent listing too
  assert.ok(appl.has('mcp-listing-managed-package'))
  assert.ok(appl.has('mcp-tool-actions-not-packageable'))
})

check('REGRESSION GUARD: + mcp-server element → mcp-* come back', () => {
  const appl = new Set(computeApplicable(entries, [...PLAIN_PACKAGE, 'mcp-server']))
  for (const id of LEAKED_MCP) assert.ok(appl.has(id), `${id} should apply with mcp-server`)
})

check('B1 GUARD: SSRF control applies to a plain external endpoint (NO mcp-server)', () => {
  // mcpthreat-ssrf-mitigation must NOT have been over-stripped: SSRF is a real
  // risk for any partner-hosted server that performs server-side fetches.
  const appl = new Set(computeApplicable(entries, PLAIN_PACKAGE)) // has external-endpoint, no mcp-server
  assert.ok(appl.has('mcpthreat-ssrf-mitigation'), 'SSRF coverage lost for a plain external endpoint')
})

check('`all`-gated requirements always apply (sanity)', () => {
  const allGated = entries.filter((e) => e.applies_to.includes('all')).map((e) => e.id)
  const appl = new Set(computeApplicable(entries, PLAIN_PACKAGE))
  const missing = allGated.filter((id) => !appl.has(id))
  assert.deepEqual(missing, [], `missing all-gated: ${missing.slice(0, 5).join(', ')}`)
})

// ---------------------------------------------------------------------------
// WI-06 / INV-16 (Slice 4) — the VERBATIM `--render` applicable-requirements presentation.
// ---------------------------------------------------------------------------

check('RENDER parse: parseBaselineApplies captures verification + conflicts (block scalar)', () => {
  const conflicting = entries.filter((e) => e.verification === 'conflicting')
  // the baseline carries exactly the one conflicting entry (endpoint-ssl-labs-a-grade)
  assert.ok(conflicting.length >= 1, `found ${conflicting.length} conflicting entries`)
  const ssl = entries.find((e) => e.id === 'endpoint-ssl-labs-a-grade')
  assert.equal(ssl.verification, 'conflicting')
  // the folded `conflicts: >` block scalar is captured + flattened to one line
  assert.match(ssl.conflicts, /whether reviewers in PRACTICE enforce an SSL Labs letter grade/)
  assert.ok(!/\n/.test(ssl.conflicts), 'the conflicts block is flattened to a single line')
})

check('RENDER golden: count = applicable length, by-track table, conflicting section, mobile gap', () => {
  const els = ['managed-package', 'apex', 'lwc', 'external-endpoint', 'mcp-server', 'mobile']
  const N = computeApplicable(entries, els).length
  const block = renderApplicable(entries, els)
  assert.match(block, new RegExp(`### Applicable requirements — ${N} of ${entries.length}`))
  assert.match(block, /\*\*Architecture elements:\*\* managed-package, apex, lwc, external-endpoint, mcp-server, mobile/)
  assert.match(block, /\| Track \| Count \| Requirement ids \|/)
  // the conflicting entry is surfaced WITH its conflicts text (external-endpoint pulls it in)
  assert.match(block, /\*\*Conflicting requirements \(1\)\*\*/)
  assert.match(block, /never silently resolved \(CONVENTIONS §4\)/)
  assert.match(block, /- endpoint-ssl-labs-a-grade — One narrow question remains/)
  // the mobile-no-coverage gap line fires because `mobile` is in scope
  assert.match(block, /\*\*Mobile gap:\*\* a `mobile` element is in scope/)
  // the count line states the exact-length invariant
  assert.match(block, new RegExp(`EXACT length of this list \\(${N}\\)`))
})

check('RENDER no-mobile/no-endpoint → no mobile-gap line and no conflicting section', () => {
  // a plain package with no external-endpoint and no mobile: the SSL conflict does not apply,
  // and there is no mobile gap to surface
  const block = renderApplicable(entries, ['managed-package', 'apex', 'lwc'])
  assert.ok(!/\*\*Mobile gap:\*\*/.test(block), 'no mobile gap without a mobile element')
  assert.ok(!/\*\*Conflicting requirements/.test(block), 'no conflicting section when no conflicting entry applies')
})

check('RENDER empty fallback: no elements → honest "scope not computed yet", no table', () => {
  const block = renderApplicable(entries, [])
  assert.match(block, /Scope not computed yet/)
  assert.ok(!/\| Track \| Count \|/.test(block), 'no table on the empty-elements branch')
})

check('RENDER determinism: renderApplicable + the CLI --render twice → byte-identical', () => {
  const els = ['managed-package', 'external-endpoint', 'mobile']
  assert.equal(renderApplicable(entries, els), renderApplicable(entries, els))
  const a = execFileSync('node', [CLI, '--elements', els.join(','), '--render'], { encoding: 'utf8' })
  const b = execFileSync('node', [CLI, '--elements', els.join(','), '--render'], { encoding: 'utf8' })
  assert.equal(a, b)
  assert.match(a, /### Applicable requirements —/)
})

check('RENDER wiring: scope-submission Step 7 grants + calls --render + states verbatim', () => {
  const skill = readFileSync(join(PLUGIN, 'skills', 'scope-submission', 'SKILL.md'), 'utf8')
  assert.match(skill, /Bash\(node \*harness\/applicable-requirements\.mjs \*\)/, 'grants applicable-requirements')
  assert.match(skill, /applicable-requirements\.mjs --elements <comma-list> --render/, 'calls --render (distinct from --json)')
  assert.match(skill, /verbatim/i, 'states the verbatim contract')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

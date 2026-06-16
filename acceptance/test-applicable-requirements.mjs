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
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseBaselineApplies, computeApplicable } from '../harness/applicable-requirements.mjs'

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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

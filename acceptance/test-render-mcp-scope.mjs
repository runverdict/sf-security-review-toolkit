#!/usr/bin/env node
/**
 * Standing test for the VERBATIM MCP listing-direction/auth-profile (INV-43) and
 * live-probe result (INV-44) renders (harness/render-mcp-scope.mjs, WI-06, Slice 4).
 * Inbound and outbound MCP have OPPOSITE auth rules; a probed:false fact must never read
 * as a live probe. Both pins are tested here.
 *
 * MS1  determinism — same manifest twice → byte-identical (fn + CLI).
 * MS2  DIRECTION (INV-43) — B/A captions + the auth-profile fields rendered straight from
 *      `mcp.authExpectations` (not re-derived); missing authExpectations → an honest line.
 * MS3  PROBE (INV-44) — probed:true → "live-probed"; probed:false → "NOT live-probed"
 *      (never presents an un-probed fact as a probe); an absent field → "(not recorded)".
 * MS4  fail-safe — no MCP surface / null → an honest "no MCP surface in scope" line on BOTH
 *      sections, never a fabricated profile or probe.
 * MS5  wiring — scope-submission grants the harness + calls --section direction (Step 2) and
 *      --section probe (Step 3) + states verbatim.
 *
 * Dependency-free: `node acceptance/test-render-mcp-scope.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { renderMcpDirection, renderMcpProbe, renderMcpScope } from '../harness/render-mcp-scope.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'render-mcp-scope.mjs')

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) } }
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'rms-')); dirs.push(d); return d }

const MB = { listingDirection: 'B', mcp: { url: 'https://staging.example.com/mcp', probed: true, protocolVersion: '2025-06-18', toolCount: 24, authType: 'oauth2-client-credentials', transport: 'streamable-http',
  authExpectations: { direction: 'B', clientCredentialsAllowed: true, ecaRequired: false, pkceRequired: false, perUserAuthSupported: false, requiredScopes: [], note: 'Direction B outbound' } } }
const MA = { listingDirection: 'A', mcp: { probed: false, protocolVersion: '2025-06-18', toolCount: 5, authType: 'oauth2',
  authExpectations: { direction: 'A', clientCredentialsAllowed: false, ecaRequired: true, pkceRequired: true, perUserAuthSupported: false, requiredScopes: ['mcp_api', 'refresh_token'] } } }

console.log('render-mcp-scope standing test')

check('MS1 determinism: same manifest twice → byte-identical (fn + CLI)', () => {
  assert.equal(renderMcpScope(MB), renderMcpScope(MB))
  const d = tmp(); const f = join(d, 'm.json'); writeFileSync(f, JSON.stringify(MB))
  const a = execFileSync('node', [CLI, '--input', f], { encoding: 'utf8' })
  const b = execFileSync('node', [CLI, '--input', f], { encoding: 'utf8' })
  assert.equal(a, b)
})

check('MS2 DIRECTION (INV-43): B/A captions + auth-profile fields rendered from authExpectations', () => {
  const b = renderMcpDirection(MB)
  assert.match(b, /### MCP listing direction & auth profile/)
  assert.match(b, /\*\*Listing direction:\*\* B — outbound MCP server/)
  // the profile FIELDS come straight from authExpectations — rendered, not re-derived
  assert.match(b, /\| clientCredentialsAllowed \| true \|/)
  assert.match(b, /\| ecaRequired \| false \|/)
  assert.match(b, /\| pkceRequired \| false \|/)
  assert.match(b, /\| perUserAuthSupported \| false \|/)
  assert.match(b, /\| requiredScopes \| \(none\) \|/)
  assert.match(b, /recorded, not re-derived/)
  // Direction A: opposite profile — ECA + PKCE required, client_credentials forbidden, scopes set
  const a = renderMcpDirection(MA)
  assert.match(a, /\*\*Listing direction:\*\* A — inbound MCP client integration/)
  assert.match(a, /\| clientCredentialsAllowed \| false \|/)
  assert.match(a, /\| ecaRequired \| true \|/)
  assert.match(a, /\| pkceRequired \| true \|/)
  assert.match(a, /\| requiredScopes \| mcp_api, refresh_token \|/)
})

check('MS2b DIRECTION: a `both` listing + missing authExpectations are honest, never fabricated', () => {
  const both = renderMcpDirection({ listingDirection: 'both', mcp: { probed: false } })
  assert.match(both, /\*\*Listing direction:\*\* both — outbound server AND inbound client/)
  // no authExpectations → an honest "not recorded" line, NOT a fabricated profile table
  assert.match(both, /Auth rule profile not recorded/)
  assert.ok(!/\| clientCredentialsAllowed \|/.test(both), 'no profile table when authExpectations is absent')
})

check('MS3 PROBE (INV-44): probed:true → live-probed; probed:false → NOT live-probed; absent field → (not recorded)', () => {
  const t = renderMcpProbe(MB)
  assert.match(t, /### MCP live-probe result/)
  assert.match(t, /\*\*Probe status:\*\* live-probed https:\/\/staging\.example\.com\/mcp/)
  assert.match(t, /\| protocolVersion \| 2025-06-18 \|/)
  assert.match(t, /\| toolCount \| 24 \|/)
  assert.match(t, /\| transport \| streamable-http \|/)
  const f = renderMcpProbe(MA)
  assert.match(f, /\*\*Probe status:\*\* NOT live-probed/)
  assert.match(f, /recorded from code/)
  // an unrecorded field is honest, never invented
  assert.match(f, /\| transport \| \(not recorded\) \|/)
  // a probed:false render must NOT claim a live probe
  assert.ok(!/live-probed/.test(f) || /NOT live-probed/.test(f), 'probed:false never presented as a live probe')
})

check('MS4 fail-safe: no MCP surface / null → honest "no MCP surface in scope" on both sections', () => {
  for (const bad of [null, undefined, 42, 'x', {}, { elements: [{ type: 'managed-package' }] }]) {
    assert.match(renderMcpDirection(bad), /No MCP surface in scope/)
    assert.match(renderMcpProbe(bad), /No MCP surface in scope/)
    assert.ok(!/\| clientCredentialsAllowed \|/.test(renderMcpDirection(bad)), 'no fabricated profile')
    assert.ok(!/\| protocolVersion \|/.test(renderMcpProbe(bad)), 'no fabricated probe')
  }
  // CLI on a missing file → the honest line, never a crash
  const out = execFileSync('node', [CLI, '--input', join(tmp(), 'nope.json')], { encoding: 'utf8' })
  assert.match(out, /No MCP surface in scope/)
})

check('MS4b CLI --section direction|probe each render only their own section', () => {
  const d = tmp(); const f = join(d, 'm.json'); writeFileSync(f, JSON.stringify(MB))
  const dir = execFileSync('node', [CLI, '--input', f, '--section', 'direction'], { encoding: 'utf8' })
  const probe = execFileSync('node', [CLI, '--input', f, '--section', 'probe'], { encoding: 'utf8' })
  assert.match(dir, /### MCP listing direction & auth profile/)
  assert.ok(!/### MCP live-probe result/.test(dir), '--section direction omits the probe section')
  assert.match(probe, /### MCP live-probe result/)
  assert.ok(!/### MCP listing direction & auth profile/.test(probe), '--section probe omits the direction section')
})

check('MS5 wiring: scope-submission grants + calls --section direction & probe + verbatim', () => {
  const skill = readFileSync(join(PLUGIN, 'skills', 'scope-submission', 'SKILL.md'), 'utf8')
  assert.match(skill, /Bash\(node \*harness\/render-mcp-scope\.mjs \*\)/, 'grants render-mcp-scope')
  assert.match(skill, /render-mcp-scope\.mjs --target <target> --section direction/, 'calls --section direction (Step 2)')
  assert.match(skill, /render-mcp-scope\.mjs --target <target> --section probe/, 'calls --section probe (Step 3)')
  assert.match(skill, /verbatim/i, 'states the verbatim contract')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

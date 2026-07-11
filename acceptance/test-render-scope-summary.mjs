#!/usr/bin/env node
/**
 * Standing test for the VERBATIM final scope-manifest summary
 * (harness/render-scope-summary.mjs, WI-06 / INV-06, presentation-consistency Slice 5). Step 9 is
 * the cheapest moment to fix scope — every later phase multiplies an error in the manifest — so
 * the readout must be fixed: the operator sees the same block every run and only the DATA varies,
 * and the two honesty crux points (a missing manifest never fabricates "ready"; a gate state is
 * never a fabricated ✓) hold.
 *
 * SS1  determinism — same manifest twice → byte-identical (fn + CLI).
 * SS2  golden — the FIXED field order; canonical element order; the applicable count = the exact
 *      list length; the endpoint environment label (and the ⚠ UNLABELED flag on a missing one);
 *      the operatorConfirmed gate states rendered HONESTLY (✓ / ✗ / not recorded).
 * SS3  fail-safe — null / non-object / array / non-JSON → an honest "scope not finalized" line,
 *      never a crash, never a fabricated ✓ / "ready" / "confirmed" state.
 * SS4  registration — REGISTERED_SURFACES carries the scope-summary surface + its harness path.
 * SS5  wiring — scope-submission Step 9 grants + references the harness + states verbatim.
 *
 * Dependency-free: `node acceptance/test-render-scope-summary.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { renderScopeSummary } from '../harness/render-scope-summary.mjs'
import { REGISTERED_SURFACES } from '../harness/render-readiness-verdict.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'render-scope-summary.mjs')

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) } }
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'rss-')); dirs.push(d); return d }

// An UNKNOWN element type listed first (to prove canonical ordering); an endpoint with NO
// environment (to prove the ⚠ UNLABELED flag); a mixed operatorConfirmed (true / false / absent).
const MANIFEST = {
  repoCommit: 'deadbee',
  listingType: 'both',
  listingDirection: 'B',
  sfAutoResolved: true,
  elements: [
    { type: 'weird-thing', evidence: 'unknown token' },
    { type: 'mcp-server', evidence: 'JSON-RPC dispatch' },
    { type: 'managed-package', evidence: 'sfdx-project.json' },
  ],
  endpoints: [
    { url: 'https://staging.example.com/mcp', environment: 'staging', role: 'mcp' },
    { url: 'https://api.example.com', role: 'api' },
  ],
  applicableBaselineIds: ['a', 'b', 'c'],
  operatorConfirmed: { partnerAgreementSigned: true, packagePromoted: false },
}

console.log('render-scope-summary standing test')

check('SS1 determinism: same manifest twice → byte-identical (fn + CLI)', () => {
  assert.equal(renderScopeSummary(MANIFEST), renderScopeSummary(MANIFEST))
  const d = tmp(); const f = join(d, 'm.json'); writeFileSync(f, JSON.stringify(MANIFEST))
  const a = execFileSync('node', [CLI, '--input', f], { encoding: 'utf8' })
  const b = execFileSync('node', [CLI, '--input', f], { encoding: 'utf8' })
  assert.equal(a, b)
})

check('SS2 golden: FIXED field order (listing type → direction → autoresolve → repo → elements → endpoints → applicable → gates)', () => {
  const block = renderScopeSummary(MANIFEST)
  const idx = (s) => block.indexOf(s)
  const order = [
    '**Listing type:**', '**Listing direction:**', '**SF-CLI auto-resolution:**', '**Repo commit:**',
    '**Architecture elements', '**Endpoints', '**Applicable baseline requirements:**', '**Partner-program preflight',
  ].map(idx)
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1] && order[i - 1] >= 0, `field ${i} is in order`)
  assert.match(block, /\*\*Listing type:\*\* both/)
  assert.match(block, /\*\*Listing direction:\*\* B — outbound MCP server/)
  assert.match(block, /\*\*SF-CLI auto-resolution:\*\* ran/)
})

check('SS2 golden: canonical element order (managed-package before mcp-server, unknown appended last)', () => {
  const block = renderScopeSummary(MANIFEST)
  const mp = block.indexOf('- managed-package'); const mcp = block.indexOf('- mcp-server'); const weird = block.indexOf('- weird-thing')
  assert.ok(mp > 0 && mcp > mp, 'managed-package before mcp-server')
  assert.ok(weird > mcp, 'unknown type appended after canonical ones, never dropped')
  assert.match(block, /\*\*Architecture elements \(3\):\*\*/)
})

check('SS2e synonym element sorts under its CANONICAL slot; the type string renders verbatim (0.8.53)', () => {
  // An LLM-authored manifest can type the external backend as 'external-web-app'. The sort
  // must rank it at the external-endpoint slot (BEFORE mobile), not append it last as an
  // unknown — while the element line still shows the manifest's own string (honest provenance).
  const m = {
    ...MANIFEST,
    elements: [
      { type: 'mobile', evidence: 'iOS companion app' },
      { type: 'external-web-app', evidence: 'partner-hosted backend' },
      { type: 'managed-package', evidence: 'sfdx-project.json' },
    ],
  }
  const block = renderScopeSummary(m)
  const mp = block.indexOf('- managed-package')
  const ewa = block.indexOf('- external-web-app')
  const mob = block.indexOf('- mobile')
  assert.ok(mp > 0 && ewa > mp, 'managed-package ranks first')
  assert.ok(mob > ewa, 'the synonym ranks at its canonical (external-endpoint) slot — before mobile, not appended last')
  assert.match(block, /- external-web-app — partner-hosted backend/) // verbatim type string
  // a truly-unknown type still appends last (canonicalization never force-aliases it)
  assert.ok(renderScopeSummary(MANIFEST).indexOf('- weird-thing') > renderScopeSummary(MANIFEST).indexOf('- mcp-server'))
})

check('SS2 golden: applicable count = the EXACT list length', () => {
  assert.match(renderScopeSummary(MANIFEST), /\*\*Applicable baseline requirements:\*\* 3 \(the exact length of applicableBaselineIds\)/)
  // a manifest with no applicable list → honest "(not computed)", never a fabricated count
  assert.match(renderScopeSummary({ ...MANIFEST, applicableBaselineIds: undefined }), /\*\*Applicable baseline requirements:\*\* \(not computed\)/)
})

check('SS2 golden: endpoint environment label rendered; a MISSING one flagged ⚠ UNLABELED', () => {
  const block = renderScopeSummary(MANIFEST)
  assert.match(block, /\| https:\/\/staging\.example\.com\/mcp \| staging \| mcp \|/)
  assert.match(block, /\| https:\/\/api\.example\.com \| ⚠ UNLABELED — must label \| api \|/)
})

check('SS2 golden: operatorConfirmed states are HONEST (✓ / ✗ / not recorded), never a fabricated ✓', () => {
  const block = renderScopeSummary(MANIFEST)
  assert.match(block, /\| Partner agreement signed \| ✓ confirmed \|/)   // true → ✓
  assert.match(block, /\| Package promoted \| ✗ NOT confirmed \|/)        // false → ✗
  assert.match(block, /\| Partner Console access \| \(not recorded\) \|/) // absent → (not recorded), NOT ✓
  assert.match(block, /\| Namespace registered & linked \| \(not recorded\) \|/)
  assert.match(block, /\| Review contacts designated \| \(not recorded\) \|/)
})

check('SS2d N/A sentinel: the promoted gate recorded "n/a" renders an explicit not-applicable cell, NOT ✗/(not recorded)', () => {
  // The gate→manifest→render seam: the promoted N/A option is recorded as the "n/a" sentinel (NOT
  // false), so an MCP-server-only listing is never shown as a FAILED promotion gate. (Catches the
  // major: deny→false→✗ would mis-render a legitimate N/A as a blocker.)
  const block = renderScopeSummary({ ...MANIFEST, operatorConfirmed: { packagePromoted: 'n/a' } })
  assert.match(block, /\| Package promoted \| — N\/A \(not applicable — no package in scope\) \|/)
  assert.ok(!/\| Package promoted \| ✗/.test(block), 'a recorded N/A must NOT render as a ✗ blocker')
  assert.ok(!/\| Package promoted \| \(not recorded\)/.test(block), 'a recorded N/A is NOT "(not recorded)"')
  // any other unexpected non-boolean value renders literally, never silently as ✓
  const odd = renderScopeSummary({ operatorConfirmed: { packagePromoted: 'maybe' } })
  assert.match(odd, /\| Package promoted \| \(recorded: maybe\) \|/)
  assert.ok(!odd.includes('✓'), 'an unexpected value never fabricates a ✓')
})

check('SS3 fail-safe: null / non-object / array / non-JSON → "scope not finalized", never a fabricated ready/✓', () => {
  for (const bad of [null, undefined, 42, 'x', [], [1, 2]]) {
    const block = renderScopeSummary(bad)
    assert.match(block, /Scope not finalized/)
    assert.ok(!block.includes('✓'), 'no fabricated ✓ on the fail-safe branch')
    assert.match(block, /NOT a "scope confirmed" or "ready" state/)
    assert.ok(!/\*\*Partner-program preflight/.test(block), 'no gate table on the fail-safe branch')
  }
  // CLI on a missing / non-JSON file → the fail-safe line, never a crash
  const d = tmp()
  assert.match(execFileSync('node', [CLI, '--input', join(d, 'nope.json')], { encoding: 'utf8' }), /Scope not finalized/)
  const junk = join(d, 'junk.json'); writeFileSync(junk, 'not json {{')
  assert.match(execFileSync('node', [CLI, '--input', junk], { encoding: 'utf8' }), /Scope not finalized/)
})

check('SS3b an empty-but-object manifest renders honestly (no elements/endpoints/applicable → honest cells, not a crash)', () => {
  const block = renderScopeSummary({})
  assert.match(block, /\*\*Listing type:\*\* \(not recorded\)/)
  assert.match(block, /\*\*Listing direction:\*\* \(no MCP surface in scope\)/)
  assert.match(block, /\*\*Architecture elements \(0\):\*\*/)
  assert.match(block, /none recorded/)
  assert.match(block, /\*\*Applicable baseline requirements:\*\* \(not computed\)/)
  // every preflight gate renders (not recorded) — never a fabricated ✓
  assert.ok(!block.includes('✓'), 'an empty manifest fabricates no ✓')
})

check('SS4 registration: REGISTERED_SURFACES carries the scope-summary surface + its harness path', () => {
  const s = REGISTERED_SURFACES.find((x) => x.id === 'scope-summary')
  assert.ok(s, 'scope-summary is a registered surface')
  assert.equal(s.template, 'harness/render-scope-summary.mjs')
  assert.ok(s.renderers.includes('render-scope-summary.mjs'))
  assert.equal(s.skill, 'skills/scope-submission/SKILL.md')
})

check('SS5 wiring: scope-submission Step 9 grants + references the harness + states verbatim', () => {
  const skill = readFileSync(join(PLUGIN, 'skills', 'scope-submission', 'SKILL.md'), 'utf8')
  assert.match(skill, /Bash\(node \*harness\/render-scope-summary\.mjs \*\)/, 'grants render-scope-summary')
  assert.match(skill, /render-scope-summary\.mjs --target/, 'calls the harness')
  assert.match(skill, /BYTE-FOR-BYTE|VERBATIM/, 'states the verbatim contract')
})

check('SS6 agentforce detection includes the subscriber-built agentscript.yaml signal (cold-run miss)', () => {
  const skill = readFileSync(join(PLUGIN, 'skills', 'scope-submission', 'SKILL.md'), 'utf8')
  // The detection self-check must name the subscriber-built shape (an agentscript.yaml agent / ESR
  // tool-action), not only packaged Bot/GenAiPlanner metadata — else an AgentExchange MCP listing
  // whose agent is subscriber-built silently drops the entire agentforce track.
  assert.match(skill, /agentscript\.yaml/, 'names the agentscript.yaml signal')
  assert.match(skill, /GenAiPlanner/, 'still names the packaged-metadata signal')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

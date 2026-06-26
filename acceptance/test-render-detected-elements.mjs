#!/usr/bin/env node
/**
 * Standing test for the VERBATIM detected-architecture-elements summary
 * (harness/render-detected-elements.mjs, WI-06 / INV-15, presentation-consistency Slice 4).
 * Scope is the most expensive thing to get wrong — an element you fail to surface is a
 * dimension that silently never runs — so its presentation must be fixed: the operator sees
 * the same table every run and only the DATA varies.
 *
 * DE1  determinism — same manifest twice → byte-identical (fn + CLI).
 * DE2  golden — the fixed `| Element | Detected how (evidence) |` table, CANONICAL element
 *      order (a late-canonical element renders before an unknown type listed first), the
 *      listingType line, evidence preserved, a no-evidence element → an honest cell.
 * DE3  fail-safe — null / non-object / no-elements → an honest "scope not detected yet" line,
 *      never a crash and never a fabricated element table.
 * DE4  wiring — scope-submission Step 2 grants + references the harness + states verbatim.
 *
 * Dependency-free: `node acceptance/test-render-detected-elements.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { renderDetectedElements, CANONICAL_ELEMENT_ORDER } from '../harness/render-detected-elements.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'render-detected-elements.mjs')

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) } }
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'rde-')); dirs.push(d); return d }

// An UNKNOWN type listed FIRST + canonical types out of order, to prove canonical ordering
// and unknown-appended-last; one element with NO evidence to prove the honest cell.
const MANIFEST = {
  listingType: 'both',
  elements: [
    { type: 'weird-thing', evidence: 'an unknown token' },
    { type: 'mcp-server', evidence: 'JSON-RPC dispatch in src/mcp/router.ts; live probe' },
    { type: 'managed-package', evidence: 'sfdx-project.json + force-app/ (Apex, LWC)' },
    { type: 'mobile' },
  ],
}

console.log('render-detected-elements standing test')

check('DE1 determinism: same manifest twice → byte-identical (fn + CLI)', () => {
  assert.equal(renderDetectedElements(MANIFEST), renderDetectedElements(MANIFEST))
  const d = tmp(); const f = join(d, 'm.json'); writeFileSync(f, JSON.stringify(MANIFEST))
  const a = execFileSync('node', [CLI, '--input', f], { encoding: 'utf8' })
  const b = execFileSync('node', [CLI, '--input', f], { encoding: 'utf8' })
  assert.equal(a, b)
})

check('DE2 golden: fixed columns, canonical order, listingType line, evidence + honest no-evidence cell', () => {
  const block = renderDetectedElements(MANIFEST)
  assert.match(block, /### Detected architecture elements/)
  assert.match(block, /\*\*Listing type:\*\* both/)
  assert.match(block, /\| Element \| Detected how \(evidence\) \|/)
  // canonical order: managed-package BEFORE mcp-server BEFORE mobile, and the UNKNOWN type LAST
  const mp = block.indexOf('| managed-package |')
  const mcp = block.indexOf('| mcp-server |')
  const mob = block.indexOf('| mobile |')
  const weird = block.indexOf('| weird-thing |')
  assert.ok(mp > 0 && mcp > mp && mob > mcp, 'canonical element order')
  assert.ok(weird > mob, 'an unknown type is appended after the canonical ones, never dropped')
  // evidence is preserved verbatim (flattened); a no-evidence element gets the honest cell
  assert.match(block, /\| managed-package \| sfdx-project\.json \+ force-app\/ \(Apex, LWC\) \|/)
  assert.match(block, /\| mobile \| \(no evidence recorded — dispute this\) \|/)
  assert.match(block, /4 element\(s\) detected\./)
})

check('DE2b CANONICAL_ELEMENT_ORDER covers the architecture surfaces (managed-package, mcp, mobile)', () => {
  for (const t of ['managed-package', 'mcp-server', 'mcp-client-integration', 'external-endpoint', 'lwc', 'aura', 'canvas', 'mobile', 'agentforce']) {
    assert.ok(CANONICAL_ELEMENT_ORDER.includes(t), `${t} in canonical order`)
  }
  // managed-package is first (the package element everything rides on)
  assert.equal(CANONICAL_ELEMENT_ORDER[0], 'managed-package')
})

check('DE3 fail-safe: null / non-object / no-elements → honest "scope not detected yet", no table', () => {
  for (const bad of [null, undefined, 42, 'x', {}, { elements: 'nope' }, { elements: [] }, { elements: [{ evidence: 'no type' }] }]) {
    const block = renderDetectedElements(bad)
    assert.match(block, /Scope not detected yet/)
    assert.ok(!/\| Element \| Detected how/.test(block), 'no table on the fail-safe branch')
  }
  // CLI on a missing file → the fail-safe line, never a crash
  const out = execFileSync('node', [CLI, '--input', join(tmp(), 'nope.json')], { encoding: 'utf8' })
  assert.match(out, /Scope not detected yet/)
})

check('DE3b listingType not recorded → honest "(not recorded)", elements still render', () => {
  const block = renderDetectedElements({ elements: [{ type: 'managed-package', evidence: 'pkg' }] })
  assert.match(block, /\*\*Listing type:\*\* \(not recorded\)/)
  assert.match(block, /\| managed-package \| pkg \|/)
})

check('DE4 wiring: scope-submission Step 2 grants + references the harness + verbatim', () => {
  const skill = readFileSync(join(PLUGIN, 'skills', 'scope-submission', 'SKILL.md'), 'utf8')
  assert.match(skill, /Bash\(node \*harness\/render-detected-elements\.mjs \*\)/, 'grants render-detected-elements')
  assert.match(skill, /render-detected-elements\.mjs --target/, 'calls the harness')
  assert.match(skill, /verbatim/i, 'states the verbatim contract')
  assert.match(skill, /Element \| Detected how \(evidence\)/, 'names the fixed columns')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

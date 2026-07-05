#!/usr/bin/env node
/**
 * Standing test for the VERBATIM target-map approval display
 * (harness/render-target-map.mjs, WI-04 / INV-12). The one cheap pre-fan-out
 * course-correction surface — its presentation must be fixed so the operator sees the
 * same table every run and only the DATA varies.
 *
 * TM1  determinism — same JSON twice → byte-identical (fn + CLI).
 * TM2  golden — fixed column set; APPLICABLE rows FIRST (even when N/A is interleaved in
 *      the input); an unresolved (empty-targets) dimension is flagged; the N/A row carries
 *      its na_reason.
 * TM3  fail-safe — null / non-object / no-dimensions → an honest "not resolved yet" line,
 *      never a crash and never a fabricated map.
 * TM4  wiring — audit-codebase Step 3 grants + references the harness + states verbatim.
 * TM5  unknown-key belt — a bogus dimension key + a registry Set → the ⚠ summary line
 *      AND the table still renders (belt, not gate; default null = byte-identical).
 *
 * Dependency-free: `node acceptance/test-render-target-map.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { renderTargetMap } from '../harness/render-target-map.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'render-target-map.mjs')

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) } }
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'rtm-')); dirs.push(d); return d }

// N/A row interleaved BEFORE an applicable row, to prove the applicable-first partition.
const MAP = {
  pass: 1, generated: '2026-06-26', tier: 'standard',
  dimensions: [
    { key: 'mcp-surface', applicable: false, na_reason: 'no MCP server in the partner code' },
    { key: 'apex-exposed-surface', applicable: true, targets: ['force-app/classes/Svc.cls'], stack_notes: '3 @AuraEnabled', confidence: 'high', unresolved: false },
    { key: 'crypto-internals', applicable: true, targets: [], stack_notes: 'JWT signing', confidence: 'medium', unresolved: true },
  ],
}

console.log('render-target-map standing test')

check('TM1 determinism: same JSON twice → byte-identical (fn + CLI)', () => {
  assert.equal(renderTargetMap(MAP), renderTargetMap(MAP))
  const d = tmp(); const f = join(d, 'tm.json'); writeFileSync(f, JSON.stringify(MAP))
  const a = execFileSync('node', [CLI, '--input', f], { encoding: 'utf8' })
  const b = execFileSync('node', [CLI, '--input', f], { encoding: 'utf8' })
  assert.equal(a, b)
})

check('TM2 golden: fixed columns, applicable-first, unresolved flagged, N/A reason kept', () => {
  const block = renderTargetMap(MAP)
  assert.match(block, /### Audit target map — pass 1 \(standard\), generated 2026-06-26/)
  assert.match(block, /\| Dimension \| Applicable \| Targets \| Why \| Confidence \| Unresolved \|/)
  // applicable rows render BEFORE the N/A row, despite N/A being first in the input
  const apexIdx = block.indexOf('apex-exposed-surface')
  const cryptoIdx = block.indexOf('crypto-internals')
  const mcpIdx = block.indexOf('mcp-surface')
  assert.ok(apexIdx > 0 && cryptoIdx > 0 && mcpIdx > 0)
  assert.ok(apexIdx < mcpIdx && cryptoIdx < mcpIdx, 'applicable rows precede the N/A row')
  // the unresolved (empty-targets) applicable dimension is flagged
  assert.match(block, /crypto-internals \| ✓ \| ⚠ none resolved \|.*\| ⚠ yes \|/)
  // resolved applicable dimension is NOT flagged unresolved
  assert.match(block, /apex-exposed-surface \| ✓ \| force-app\/classes\/Svc\.cls \|.*\| — \|/)
  // N/A row carries its reason, no targets
  assert.match(block, /mcp-surface \| — \(N\/A\) \| — \| no MCP server in the partner code \| — \| — \|/)
  // closing summary surfaces the unresolved count
  assert.match(block, /2 applicable, 1 N\/A\./)
  assert.match(block, /1 applicable dimension\(s\) UNRESOLVED/)
})

check('TM2b a pipe / newline in stack_notes is escaped + flattened (table never breaks)', () => {
  const block = renderTargetMap({ pass: 1, generated: '2026-06-26', tier: 'quick',
    dimensions: [{ key: 'x', applicable: true, targets: ['a.cls'], stack_notes: 'line one\nline | two', confidence: 'low' }] })
  assert.ok(!/line one\nline/.test(block), 'newline flattened')
  assert.match(block, /line one line \\\| two/, 'pipe escaped, whitespace collapsed')
})

check('TM3 fail-safe: null / non-object / no dimensions → honest "not resolved yet"', () => {
  for (const bad of [null, undefined, 42, 'x', {}, { dimensions: 'nope' }]) {
    const block = renderTargetMap(bad)
    assert.match(block, /Target map not resolved yet/)
    assert.ok(!/\| Dimension \|/.test(block), 'no table on the fail-safe branch')
  }
  // CLI on a missing file → the fail-safe line, never a crash
  const out = execFileSync('node', [CLI, '--input', join(tmp(), 'nope.json')], { encoding: 'utf8' })
  assert.match(out, /Target map not resolved yet/)
})

check('TM5 unknown-key belt: bogus key + knownKeys → ⚠ line appended, table still renders, never throws', () => {
  const known = new Set(['apex-exposed-surface', 'crypto-internals', 'mcp-surface'])
  const withBogus = { ...MAP, dimensions: [...MAP.dimensions, { key: 'tenant-isolation-web', applicable: false, na_reason: 'hand-written map, key not in the canonical set' }] }
  const block = renderTargetMap(withBogus, known)
  // belt, not gate: the table STILL renders (fail-safe posture — the operator must see the map)
  assert.match(block, /\| Dimension \| Applicable \| Targets \| Why \| Confidence \| Unresolved \|/)
  assert.match(block, /tenant-isolation-web \| — \(N\/A\) \|/, 'the bogus row itself still renders')
  // MUTATION: dropping the knownKeys check in renderTargetMap turns this red (no ⚠ unknown line)
  assert.match(block, /⚠ 1 unknown dimension key\(s\): tenant-isolation-web — not in the canonical set/)
  // clean side: an all-known map is silent
  assert.ok(!/unknown dimension key/.test(renderTargetMap(MAP, known)), 'no unknown-key line on a clean map')
  // default null → byte-identical to the pre-belt output (existing direct callers unaffected)
  assert.equal(renderTargetMap(withBogus), renderTargetMap(withBogus, null))
  assert.ok(!/unknown dimension key/.test(renderTargetMap(withBogus)), 'no registry → no unknown-key claim')
})

check('TM4 wiring: audit-codebase Step 3 grants + references the harness + verbatim', () => {
  const skill = readFileSync(join(PLUGIN, 'skills', 'audit-codebase', 'SKILL.md'), 'utf8')
  assert.match(skill, /Bash\(node \*harness\/render-target-map\.mjs \*\)/, 'grants render-target-map')
  assert.match(skill, /render-target-map\.mjs --target/, 'calls the harness')
  assert.match(skill, /verbatim/i, 'states the verbatim contract')
  assert.match(skill, /dimension \| applicable \| targets \| why \| confidence \| unresolved/i, 'names the fixed columns')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

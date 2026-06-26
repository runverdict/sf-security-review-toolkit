#!/usr/bin/env node
/**
 * Standing test for the VERBATIM 3-tier preflight report
 * (harness/render-preflight.mjs, WI-05 / INV-07). The most-seen operator surface —
 * every journey run opens with it. The skeleton (three tier headers + the deployed-org
 * power-up's FIXED 4-state enum) is pinned; only the DATA varies.
 *
 * PF1  determinism — same facts twice → byte-identical (fn + CLI).
 * PF2  golden — the three tier headers in fixed order; the header line.
 * PF3  4-state enum — DEEP_AUDIT_STATES has EXACTLY the four states; deepAuditState is
 *      TOTAL over package-readiness's outputs (installable / needs-build+registered /
 *      needs-build+!registered / no-package), each rendering its fixed label.
 * PF4  fail-safe — empty {} / null facts → every detector line reads "not detected", the
 *      three tiers still render, no crash.
 * PF5  honesty — empty needFromYou → "none"; a missing package-readiness → the honest
 *      "readiness not sensed" power-up, never a fabricated state.
 * PF6  wiring — the journey grants + references the harness, states verbatim + the 4-state.
 *
 * Dependency-free: `node acceptance/test-render-preflight.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { renderPreflight, deepAuditState, DEEP_AUDIT_STATES } from '../harness/render-preflight.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'render-preflight.mjs')

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) } }
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'rpf-')); dirs.push(d); return d }

const FACTS = {
  repo: '/srv/app', commit: 'abc1234', resumePoint: 'fresh start',
  elements: [{ type: 'managed-package', evidence: 'sfdx-project.json' }, { type: 'external-endpoint', evidence: 'server routes' }],
  needFromYou: [],
  baseline: { total: 155, last_verified_null: 36, newest_verified: '2026-06-20' },
  packageReadiness: { status: 'needs-build', registered: false, package: 'Acme', reason: 'no package-id alias' },
  toolDetect: { families: [1, 2, 3, 4, 5, 6, 7, 8], summary: { present_tools: [{ name: 'npm' }], satisfied_families: ['dependency-audit'], installable_missing: [{ name: 'osv-scanner', install: 'binary' }] } },
  stackDetect: { status: 'runnable', reason: 'node compose recipe' },
  dockerCheck: { status: 'available', runnable: true },
}

console.log('render-preflight standing test')

check('PF1 determinism: same facts twice → byte-identical (fn + CLI)', () => {
  assert.equal(renderPreflight(FACTS), renderPreflight(FACTS))
  const d = tmp(); const f = join(d, 'facts.json'); writeFileSync(f, JSON.stringify(FACTS))
  const a = execFileSync('node', [CLI, '--facts', f], { encoding: 'utf8' })
  const b = execFileSync('node', [CLI, '--facts', f], { encoding: 'utf8' })
  assert.equal(a, b)
})

check('PF2 golden: three tier headers in fixed order + the header line', () => {
  const block = renderPreflight(FACTS)
  assert.match(block, /^PREFLIGHT — AppExchange\/AgentExchange security-review readiness/)
  assert.match(block, /Repo: \/srv\/app @ abc1234   Baseline currency: newest_verified 2026-06-20 \(155 entries, 36 unverified\)/)
  const det = block.indexOf('✓ DETECTED')
  const need = block.indexOf('⚠ NEED-FROM-YOU')
  const power = block.indexOf('✦ OPTIONAL POWER-UPS')
  assert.ok(det >= 0 && need > det && power > need, 'the three tiers render in fixed order')
})

check('PF3 4-state enum is complete + total over package-readiness outputs', () => {
  // EXACTLY the four states, no more, no fewer
  assert.deepEqual(Object.keys(DEEP_AUDIT_STATES).sort(),
    ['installable', 'needs-build-buildable', 'needs-build-unregistered', 'no-package'])
  // total mapping over every package-readiness shape
  assert.equal(deepAuditState({ status: 'installable' }), 'installable')
  assert.equal(deepAuditState({ status: 'needs-build', registered: true }), 'needs-build-buildable')
  assert.equal(deepAuditState({ status: 'needs-build', registered: false }), 'needs-build-unregistered')
  assert.equal(deepAuditState({ status: 'no-package' }), 'no-package')
  // each state renders its FIXED label in the power-up line
  const labels = {
    installable: 'READY (installable)',
    'needs-build-buildable': 'needs-build (buildable)',
    'needs-build-unregistered': 'needs-build (unregistered)',
    'no-package': 'N/A (no installable package)',
  }
  for (const [status, registered, key] of [
    ['installable', true, 'installable'],
    ['needs-build', true, 'needs-build-buildable'],
    ['needs-build', false, 'needs-build-unregistered'],
    ['no-package', false, 'no-package'],
  ]) {
    const block = renderPreflight({ ...FACTS, packageReadiness: { status, registered, reason: 'r' } })
    assert.ok(block.includes(`Deployed-org deep audit — ${labels[key]}`), `renders ${key} label`)
  }
})

check('PF4 fail-safe: empty {} / null → "not detected" lines, three tiers, no crash', () => {
  for (const facts of [{}, null, undefined, 'x', 42]) {
    const block = renderPreflight(facts)
    assert.match(block, /✓ DETECTED/)
    assert.match(block, /⚠ NEED-FROM-YOU/)
    assert.match(block, /✦ OPTIONAL POWER-UPS/)
    assert.match(block, /Managed package: not detected/)
    assert.match(block, /readiness not sensed/)
  }
  // CLI on a missing facts file → the all-"not detected" skeleton, never a crash
  const out = execFileSync('node', [CLI, '--facts', join(tmp(), 'nope.json')], { encoding: 'utf8' })
  assert.match(out, /PREFLIGHT —/)
})

check('PF5 honesty: empty needFromYou → "none"; non-empty renders the gaps', () => {
  assert.match(renderPreflight(FACTS), /none — nothing blocks the audit/)
  const withGaps = renderPreflight({ ...FACTS, needFromYou: ['source not findable', 'MCP server claimed but absent'] })
  assert.match(withGaps, /• source not findable/)
  assert.match(withGaps, /• MCP server claimed but absent/)
  assert.ok(!/none — nothing blocks/.test(withGaps), 'no "none" when gaps exist')
})

check('PF6 wiring: journey grants + references the harness + verbatim + the 4-state', () => {
  const skill = readFileSync(join(PLUGIN, 'skills', 'security-review-journey', 'SKILL.md'), 'utf8')
  assert.match(skill, /Bash\(node \*harness\/render-preflight\.mjs \*\)/, 'grants render-preflight')
  assert.match(skill, /render-preflight\.mjs --facts/, 'calls the harness')
  assert.match(skill, /verbatim/i, 'states the verbatim contract')
  assert.match(skill, /4-state/i, 'references the fixed 4-state enum')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

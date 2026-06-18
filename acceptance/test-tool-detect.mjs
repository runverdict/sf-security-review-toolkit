#!/usr/bin/env node
/**
 * Standing test for harness/tool-detect.mjs — the deterministic scan-tool detector
 * (0.6.0 preflight foundation). Detection only; never installs.
 *
 * Guards:
 *   T1 — empty PATH: no local tools; owner-portal family (Checkmarx) still "satisfied";
 *        installable-missing lists the network-installable scanners (semgrep, osv-scanner…).
 *   T2 — a present tool flips its family satisfied + reports its path, and drops out of
 *        installable-missing.
 *   T3 — multi-bin tool: either alias (zap.sh OR zaproxy) counts as present.
 *   T4 — executable bit required: a non-executable file of the right name is NOT detected.
 *   T5 — determinism: same PATH ⇒ byte-identical JSON.
 *   T6 — owner vs installable split: the sf CLI is 'owner' (never auto-installed), semgrep
 *        is 'pip' (installable-on-consent).
 *
 * Dependency-free: `node acceptance/test-tool-detect.mjs`.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { detectTools, whichOn } from '../harness/tool-detect.mjs'

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}
function binDir(names, { executable = true } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'tooldir-')); dirs.push(d)
  for (const n of names) {
    const p = join(d, n)
    writeFileSync(p, '#!/bin/sh\necho stub\n')
    if (executable) chmodSync(p, 0o755)
  }
  return d
}
const fam = (r, key) => r.families.find((f) => f.key === key)
const missingNames = (r) => r.summary.installable_missing.map((x) => x.name)

console.log('tool-detect standing test')

check('T1 empty PATH: nothing local; owner-portal still satisfied; installable-missing populated', () => {
  const r = detectTools('')
  assert.equal(fam(r, 'external-sast').satisfied, false)
  assert.equal(fam(r, 'source-code-scanner').satisfied, true, 'Checkmarx is owner-portal → counts as satisfied (not locally runnable)')
  assert.ok(missingNames(r).includes('semgrep'))
  assert.ok(missingNames(r).includes('osv-scanner'))
  assert.equal(r.summary.present_tools.length, 0)
})

check('T2 present tool → family satisfied, path reported, out of installable-missing', () => {
  const d = binDir(['semgrep'])
  const r = detectTools(d)
  const sast = fam(r, 'external-sast')
  assert.equal(sast.satisfied, true)
  const sg = sast.tools.find((t) => t.name === 'semgrep')
  assert.equal(sg.present, true)
  assert.equal(sg.path, join(d, 'semgrep'))
  assert.ok(!missingNames(r).includes('semgrep'), 'a present tool must not be listed as installable-missing')
  assert.ok(r.summary.present_tools.some((t) => t.name === 'semgrep'))
})

check('T3 multi-bin tool: the zaproxy alias satisfies the zap tool', () => {
  const r = detectTools(binDir(['zaproxy']))
  const zap = fam(r, 'dast').tools.find((t) => t.name === 'zap')
  assert.equal(zap.present, true)
  assert.equal(fam(r, 'dast').satisfied, true)
})

check('T4 executable bit required: a non-executable file of the right name is NOT detected', () => {
  const d = binDir(['osv-scanner'], { executable: false })
  assert.equal(whichOn('osv-scanner', d), null, 'a non-executable must not resolve')
  assert.equal(detectTools(d).families.find((f) => f.key === 'external-sca-iac').tools.find((t) => t.name === 'osv-scanner').present, false)
})

check('T5 determinism: same PATH → byte-identical JSON', () => {
  const d = binDir(['gitleaks', 'checkov'])
  assert.equal(JSON.stringify(detectTools(d)), JSON.stringify(detectTools(d)))
})

check('T6 owner vs installable split: sf=owner (never auto-installed), semgrep=pip (installable)', () => {
  const r = detectTools('')
  const sf = fam(r, 'code-analyzer').tools.find((t) => t.name === 'sf')
  assert.equal(sf.install, 'owner')
  assert.ok(!missingNames(r).includes('sf'), 'sf is owner-installed → never in installable-on-consent')
  assert.ok(r.summary.owner_missing.some((x) => x.name === 'sf'))
  assert.ok(missingNames(r).includes('semgrep'))
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

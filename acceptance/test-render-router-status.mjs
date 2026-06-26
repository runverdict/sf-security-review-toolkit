#!/usr/bin/env node
/**
 * Standing test for the VERBATIM router-mode "where are we?" status block
 * (harness/render-router-status.mjs, WI-05 / INV-33). A FIXED 3-line block
 * (resume-point · single next-skill · one-sentence reason) computed from the Step-0
 * detection facts — only the phase/skill names fill.
 *
 * RR1  determinism — same facts twice → byte-identical (fn + CLI).
 * RR2  golden — exactly the 3 fixed lines; the phase ladder maps each furthest-reached
 *      phase to the right next skill.
 * RR3  overrides — drift → re-scope; a stale ledger → re-audit; open blockers → the
 *      auto-proceed note.
 * RR4  fail-safe — null / non-object → the honest "fresh start" block, never a crash.
 * RR5  wiring — the journey grants + references the harness + states verbatim.
 *
 * Dependency-free: `node acceptance/test-render-router-status.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { renderRouterStatus } from '../harness/render-router-status.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'render-router-status.mjs')

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) } }
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'rrs-')); dirs.push(d); return d }

const lines = (b) => b.split('\n').filter(Boolean)

console.log('render-router-status standing test')

check('RR1 determinism: same facts twice → byte-identical (fn + CLI)', () => {
  const facts = { scope_manifest: true, audit_ledger: true }
  assert.equal(renderRouterStatus(facts), renderRouterStatus(facts))
  const d = tmp(); const f = join(d, 'f.json'); writeFileSync(f, JSON.stringify(facts))
  const a = execFileSync('node', [CLI, '--facts', f], { encoding: 'utf8' })
  const b = execFileSync('node', [CLI, '--facts', f], { encoding: 'utf8' })
  assert.equal(a, b)
})

check('RR2 golden: exactly 3 fixed lines + the phase ladder', () => {
  const block = renderRouterStatus({ scope_manifest: true })
  const ls = lines(block)
  assert.equal(ls.length, 3, 'exactly three lines')
  assert.match(ls[0], /^Resume point: /)
  assert.match(ls[1], /^Next: /)
  assert.match(ls[2], /^Why: /)
  // the furthest-reached phase wins
  const cases = [
    [{ submission: true, evidence: true, artifacts: true, audit_ledger: true, scope_manifest: true }, /stay-listed/],
    [{ evidence: true, artifacts: true, audit_ledger: true, scope_manifest: true }, /compile-submission/],
    [{ artifacts: true, audit_ledger: true, scope_manifest: true }, /run-scans/],
    [{ audit_ledger: true, scope_manifest: true }, /generate-artifacts/],
    [{ scope_manifest: true }, /audit-codebase/],
    [{}, /scope-submission/],
  ]
  for (const [facts, nextRe] of cases) assert.match(renderRouterStatus(facts), nextRe)
})

check('RR3 overrides: drift → re-scope; stale ledger → re-audit; open blockers → note', () => {
  // drift beats everything
  const drift = renderRouterStatus({ submission: true, audit_ledger: true, drift: true })
  assert.match(drift, /re-scope on drift/)
  assert.match(drift, /Next: \/sf-security-review-toolkit:scope-submission/)
  // a stale ledger routes back to a re-audit
  const stale = renderRouterStatus({ audit_ledger: true, ledger_stale: true })
  assert.match(stale, /ledger is STALE/)
  assert.match(stale, /Next: \/sf-security-review-toolkit:audit-codebase/)
  // open blockers note the auto-proceed
  const blockers = renderRouterStatus({ audit_ledger: true, open_blockers: true })
  assert.match(blockers, /OPEN critical\/high/)
  assert.match(blockers, /auto-proceeds/)
})

check('RR4 fail-safe: null / non-object → "fresh start", never a crash', () => {
  for (const bad of [null, undefined, 42, 'x']) {
    const block = renderRouterStatus(bad)
    assert.match(block, /Resume point: fresh start/)
    assert.match(block, /scope-submission/)
  }
  // CLI with neither --facts nor --target → fresh start
  const out = execFileSync('node', [CLI], { encoding: 'utf8' })
  assert.match(out, /Resume point: fresh start/)
})

check('RR5 wiring: journey grants + references the harness + verbatim', () => {
  const skill = readFileSync(join(PLUGIN, 'skills', 'security-review-journey', 'SKILL.md'), 'utf8')
  assert.match(skill, /Bash\(node \*harness\/render-router-status\.mjs \*\)/, 'grants render-router-status')
  assert.match(skill, /render-router-status\.mjs --target/, 'calls the harness')
  assert.match(skill, /verbatim/i, 'states the verbatim contract')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

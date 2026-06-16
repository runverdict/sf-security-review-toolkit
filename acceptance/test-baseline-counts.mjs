#!/usr/bin/env node
/**
 * Standing test: the baseline self-description prose (README.md, SOURCES.md)
 * must match the deterministic count from harness/baseline-counts.mjs. Guards
 * the drift that shipped (docs said 146/115/30 while data was 155/118/36/1).
 *
 * Dependency-free: `node acceptance/test-baseline-counts.mjs`.
 */
import assert from 'node:assert/strict'
import { readFileSync, symlinkSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { countBaseline } from '../harness/baseline-counts.mjs'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const flat = (s) => s.replace(/\s+/g, ' ')

const c = countBaseline(read('../baseline/requirements-baseline.yaml'))
const README = flat(read('../README.md'))
const SOURCES = flat(read('../baseline/SOURCES.md'))

let pass = 0, fail = 0
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

console.log(`baseline-counts standing test (data: ${c.total}/${c.verified_primary}/${c.web_research_unverified}/${c.conflicting})`)

check('verification fields sum to total', () => {
  assert.equal(c.verified_primary + c.web_research_unverified + c.conflicting + c.other_verification, c.total)
})

check('web_research_unverified ⟺ last_verified:null (consistency invariant)', () => {
  // Every web_research_unverified entry must carry last_verified: null and vice
  // versa — the WI-19 stubs violated this until F2 nulled their dates.
  assert.equal(c.web_research_unverified, c.last_verified_null,
    `web_research_unverified=${c.web_research_unverified} but last_verified:null=${c.last_verified_null}`)
})

check('README "X of Y verified_primary" matches the data', () => {
  const m = README.match(/(\d+) of (\d+) baseline entries are `verified_primary`/)
  assert.ok(m, 'README verified_primary sentence not found')
  assert.equal(Number(m[1]), c.verified_primary, 'README verified_primary count drifted')
  assert.equal(Number(m[2]), c.total, 'README total count drifted')
})

check('README web_research_unverified count matches the data', () => {
  const m = README.match(/(\d+) remain `web_research_unverified`/)
  assert.ok(m, 'README web_research_unverified sentence not found')
  assert.equal(Number(m[1]), c.web_research_unverified, 'README web_research_unverified count drifted')
})

check('SOURCES.md counts match the data', () => {
  const web = SOURCES.match(/(\d+) entries remain here/)
  const vp = SOURCES.match(/NOT a promotion\. (\d+) entries\./)
  assert.ok(web && vp, 'SOURCES count sentences not found')
  assert.equal(Number(web[1]), c.web_research_unverified, 'SOURCES web_research count drifted')
  assert.equal(Number(vp[1]), c.verified_primary, 'SOURCES verified_primary count drifted')
})

// A3 — the realpath CLI guard: a harness script invoked through a SYMLINK must
// still run main() (import.meta.url resolves the real file; argv[1] is the link).
// Guards against the guard silently no-op'ing the CLI under a symlinked layout.
check('A3: harness CLI runs via a symlink (realpath guard)', () => {
  const real = fileURLToPath(new URL('../harness/baseline-counts.mjs', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'symlink-test-'))
  const link = join(dir, 'linked.mjs')
  try {
    symlinkSync(real, link)
    const out = execFileSync('node', [link], { encoding: 'utf8' })
    assert.match(out, /Baseline: \d+ entries/, 'symlinked CLI produced no output — realpath guard regressed')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

#!/usr/bin/env node
/**
 * Standing test for harness/build-audit-engine.mjs — the deterministic assembler that
 * extracts each dimension's §4 finder prompt + §5/§6 verifier notes, injects the run-args
 * into a project-local copy of the workflow template, and writes target-map.json.
 *
 * Guards:
 *   E1 — extraction + injection: real dimension files yield non-empty finderPrompt +
 *        verifierNotes; the injected INJECTED object carries repoRoot + the dimensions.
 *   E2 — the assembled engine PASSES harness/injection-check.mjs (exit 0) — i.e. the
 *        injection that G5 hardened is valid for real, end to end.
 *   E3 — target-map.json records applicable (with targets) + N/A (with reason).
 *   E4 — loud failure: an unknown dimension key aborts non-zero (never a silent empty prompt).
 *   E5 — determinism: same input → byte-identical audit-engine.mjs.
 *
 * Dependency-free: `node acceptance/test-build-audit-engine.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { recordConsent } from '../harness/record-consent.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const BUILD = join(PLUGIN, 'harness', 'build-audit-engine.mjs')
const INJCHK = join(PLUGIN, 'harness', 'injection-check.mjs')

// two dimension keys that must exist in methodology/dimensions/
const KEYS = ['crypto-internals', 'apex-exposed-surface']
for (const k of KEYS) {
  if (!existsSync(join(PLUGIN, 'methodology', 'dimensions', `${k}.md`))) {
    console.error(`pre-req missing: methodology/dimensions/${k}.md`); process.exit(1)
  }
}

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

function makeRepo(input) {
  const dir = mkdtempSync(join(tmpdir(), 'bae-test-'))
  mkdirSync(join(dir, '.security-review'), { recursive: true })
  writeFileSync(join(dir, '.security-review', 'scope-input.json'), JSON.stringify(input))
  // The assembler fails closed without the Step 2/3 consents — record them so these
  // positive tests reach the extraction/injection logic they exercise.
  recordConsent('audit-tier', 'yes, standard', { target: dir })
  recordConsent('audit-targetmap', 'yes, the map is correct', { target: dir })
  return dir
}
const goodInput = {
  tier: 'standard', passNumber: 1, runDate: '2026-06-17', ledger: '',
  context: { productOneLiner: 'a test package', reviewSurfaces: 'apex + external api', stackSummary: 'sf 2gp + node', securityModelClaims: 'claims to verify' },
  applicable: [
    { key: 'crypto-internals', targets: 'server/index.js', stackNotes: 'jwt verify here' },
    { key: 'apex-exposed-surface', targets: 'classes/X.cls', stackNotes: 'auraenabled methods' },
  ],
  na: [{ key: 'mcp-surface', na_reason: 'no MCP server in repo' }],
}
function build(dir) {
  return execFileSync('node', [BUILD, '--plugin', PLUGIN, '--repo', dir], { encoding: 'utf8' })
}

console.log('build-audit-engine standing test')

check('E1 extraction + injection: INJECTED carries repoRoot + dimensions with non-empty prompts', () => {
  const d = makeRepo(goodInput); dirs.push(d)
  build(d)
  const eng = readFileSync(join(d, '.security-review', 'audit-engine.mjs'), 'utf8')
  assert.match(eng, /const INJECTED = \{/)
  // pull the injected object out the same way injection-check does and inspect it
  const m = eng.indexOf('\nconst INJECTED = {')
  const objStart = eng.indexOf('{', m)
  // crude brace match good enough for the test
  let depth = 0, end = objStart
  for (let i = objStart; i < eng.length; i++) { if (eng[i] === '{') depth++; else if (eng[i] === '}') { depth--; if (depth === 0) { end = i; break } } }
  const obj = JSON.parse(eng.slice(objStart, end + 1))
  assert.equal(obj.repoRoot, d)
  assert.equal(obj.dimensions.length, 2)
  assert.ok(obj.dimensions[0].finderPrompt.length > 200, 'finderPrompt must be extracted, not empty')
  assert.ok(obj.dimensions[0].verifierNotes.length > 200, 'verifierNotes must be extracted, not empty')
  assert.match(obj.reportPath, /audit-report-2026-06-17-pass1\.md$/)
})

check('E2 assembled engine passes injection-check.mjs (exit 0)', () => {
  const d = makeRepo(goodInput); dirs.push(d)
  build(d)
  // exit 0 = the injected INJECTED parses + carries repoRoot
  execFileSync('node', [INJCHK, join(d, '.security-review', 'audit-engine.mjs')], { encoding: 'utf8' })
})

check('E3 target-map records applicable (with targets) + N/A (with reason)', () => {
  const d = makeRepo(goodInput); dirs.push(d)
  build(d)
  const tm = JSON.parse(readFileSync(join(d, '.security-review', 'target-map.json'), 'utf8'))
  const crypto = tm.dimensions.find((x) => x.key === 'crypto-internals')
  assert.equal(crypto.applicable, true)
  assert.deepEqual(crypto.targets, ['server/index.js'])
  const mcp = tm.dimensions.find((x) => x.key === 'mcp-surface')
  assert.equal(mcp.applicable, false)
  assert.match(mcp.na_reason, /no MCP/)
})

check('E4 loud failure: an unknown dimension key aborts non-zero', () => {
  const d = makeRepo({ ...goodInput, applicable: [{ key: 'totally-not-a-dimension', targets: 'x', stackNotes: 'y' }] }); dirs.push(d)
  assert.throws(() => execFileSync('node', [BUILD, '--plugin', PLUGIN, '--repo', d], { stdio: 'pipe' }),
    /not found|Command failed/, 'a missing dimension file must abort, not emit an empty prompt')
})

check('E5 determinism: same input → byte-identical audit-engine.mjs', () => {
  const d = makeRepo(goodInput); dirs.push(d)
  build(d)
  const a = readFileSync(join(d, '.security-review', 'audit-engine.mjs'), 'utf8')
  build(d)
  const b = readFileSync(join(d, '.security-review', 'audit-engine.mjs'), 'utf8')
  assert.equal(a, b)
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

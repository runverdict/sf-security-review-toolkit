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
import { execFileSync, spawnSync } from 'node:child_process'
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
// Pull the injected INJECTED object out of the assembled engine (crude brace match
// good enough for the test — the same shape injection-check.mjs parses).
function readInjected(dir) {
  const eng = readFileSync(join(dir, '.security-review', 'audit-engine.mjs'), 'utf8')
  const m = eng.indexOf('\nconst INJECTED = {')
  const objStart = eng.indexOf('{', m)
  let depth = 0, end = objStart
  for (let i = objStart; i < eng.length; i++) { if (eng[i] === '{') depth++; else if (eng[i] === '}') { depth--; if (depth === 0) { end = i; break } } }
  return JSON.parse(eng.slice(objStart, end + 1))
}
// The three dimensions the engine forces into every audit (WI-A).
const ALWAYS_ON = ['sessionid-egress', 'secrets-credentials', 'error-handling-disclosure']

console.log('build-audit-engine standing test')

check('E1 extraction + injection: INJECTED carries repoRoot + dimensions with non-empty prompts', () => {
  const d = makeRepo(goodInput); dirs.push(d)
  build(d)
  const eng = readFileSync(join(d, '.security-review', 'audit-engine.mjs'), 'utf8')
  assert.match(eng, /const INJECTED = \{/)
  const obj = readInjected(d)
  assert.equal(obj.repoRoot, d)
  // 2 driver dims + 3 engine-forced always-on (WI-A) = 5.
  assert.equal(obj.dimensions.length, 5)
  const keys = obj.dimensions.map((x) => x.key)
  for (const k of ['crypto-internals', 'apex-exposed-surface', ...ALWAYS_ON]) {
    assert.ok(keys.includes(k), `dimensions must include ${k}`)
  }
  // driver dims come first (always-on are appended), so [0] is still crypto-internals
  assert.equal(obj.dimensions[0].key, 'crypto-internals')
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

check('A1 WI-A: scope-input missing always-on dims → engine auto-injects all three', () => {
  // goodInput.applicable lists only crypto-internals + apex-exposed-surface (no always-on).
  const d = makeRepo(goodInput); dirs.push(d)
  const stdout = build(d)
  assert.match(stdout, /auto-injected always-on dimensions:.*secrets-credentials/, 'logs the auto-injection')
  const dims = readInjected(d).dimensions
  const keys = dims.map((x) => x.key)
  for (const k of ALWAYS_ON) assert.ok(keys.includes(k), `auto-injected ${k} must be present in the built dimensions`)
  // the auto-injected entries carry a NON-EMPTY full-tree target ('.') + the always-on
  // stackNotes marker (BUG-B: an EMPTY '' would crash a targeted re-run and scope the finder to
  // nothing — see B1 below).
  const sc = dims.find((x) => x.key === 'secrets-credentials')
  assert.equal(sc.targets, '.')
  assert.match(sc.stackNotes, /always-on dimension \(auto-injected\): full source tree/)
  // and the target map lists them applicable
  const tm = JSON.parse(readFileSync(join(d, '.security-review', 'target-map.json'), 'utf8'))
  for (const k of ALWAYS_ON) assert.equal(tm.dimensions.find((x) => x.key === k)?.applicable, true, `${k} applicable in target-map`)
})

check('A2 WI-A: an always-on key in na → moved to applicable + a WARN on stderr', () => {
  const input = { ...goodInput, na: [
    { key: 'secrets-credentials', na_reason: 'driver wrongly claims no secrets' },
    { key: 'mcp-surface', na_reason: 'no MCP server in repo' },
  ] }
  const d = makeRepo(input); dirs.push(d)
  const res = spawnSync('node', [BUILD, '--plugin', PLUGIN, '--repo', d], { encoding: 'utf8' })
  assert.equal(res.status, 0, 'build still succeeds')
  assert.match(res.stderr, /WARN: always-on dimension secrets-credentials cannot be N\/A — forcing applicable/, 'must warn on stderr')
  const tm = JSON.parse(readFileSync(join(d, '.security-review', 'target-map.json'), 'utf8'))
  assert.equal(tm.dimensions.find((x) => x.key === 'secrets-credentials')?.applicable, true, 'secrets-credentials forced applicable')
  const naKeys = tm.dimensions.filter((x) => x.applicable === false).map((x) => x.key)
  assert.ok(!naKeys.includes('secrets-credentials'), 'secrets-credentials removed from the N/A list')
  assert.ok(naKeys.includes('mcp-surface'), 'a genuine N/A (mcp-surface) is preserved')
})

check('A3 WI-A: scope-input already listing all always-on → no duplicates, driver values win', () => {
  const input = { ...goodInput, applicable: [
    { key: 'crypto-internals', targets: 'server/index.js', stackNotes: 'jwt verify here' },
    { key: 'sessionid-egress', targets: 'classes/Y.cls', stackNotes: 'driver-provided notes' },
    { key: 'secrets-credentials', targets: 'config/', stackNotes: 'driver secrets notes' },
    { key: 'error-handling-disclosure', targets: 'server/', stackNotes: 'driver error notes' },
  ] }
  const d = makeRepo(input); dirs.push(d)
  const stdout = build(d)
  assert.doesNotMatch(stdout, /auto-injected always-on/, 'nothing auto-injected when all are already listed')
  const dims = readInjected(d).dimensions
  const keys = dims.map((x) => x.key)
  assert.equal(new Set(keys).size, keys.length, 'no duplicate dimension keys')
  assert.equal(keys.length, 4, 'exactly the 4 driver dims, none duplicated')
  // driver-provided targets/stackNotes are preserved (NOT overwritten by the always-on default)
  const se = dims.find((x) => x.key === 'sessionid-egress')
  assert.equal(se.targets, 'classes/Y.cls')
  assert.match(se.stackNotes, /driver-provided notes/)
})

check('B1 BUG-B: auto-injected always-on carry a NON-EMPTY full-tree target; every assembled dim satisfies the template validation (key && targets && finderPrompt) so a re-run never crashes', () => {
  // The recovery for a coverage failure is a targeted re-run of the dirty dimension. The driver's
  // re-run scope-input lists only that dimension, so the engine auto-injects the always-on trio.
  // Pre-0.8.44 it injected them with `targets: ''`, and workflow-template.mjs threw
  // `dimension entry missing key/targets/finderPrompt` (its `!d.targets` check), killing the
  // whole re-run before the first finder. This pins the fix: a NON-EMPTY full-tree target, and
  // NO assembled dimension that would trip the template's key && targets && finderPrompt guard.
  const d = makeRepo(goodInput); dirs.push(d)
  build(d)
  const dims = readInjected(d).dimensions
  for (const k of ALWAYS_ON) {
    const dim = dims.find((x) => x.key === k)
    assert.ok(dim, `${k} must be present`)
    assert.ok(
      typeof dim.targets === 'string' && dim.targets.trim().length > 0,
      `${k} must carry a NON-EMPTY full-tree target (not '') — an empty target crashes a re-run and scans nothing`
    )
  }
  // BUILD-SIDE invariant (deliberately STRICTER than the template): for this normal scope-input,
  // EVERY assembled dimension carries non-empty targets. The template's own 0.8.44 validation only
  // needs `key && finderPrompt` (targets optional — empty/'.' = full-tree), but the build side
  // never EMITS an empty-targets dimension here, so (a) even the pre-0.8.44 `!d.targets` template
  // wouldn't crash on build output, and (b) no normal dimension is silently scoped to a full-tree
  // by an empty target slipping through assembly. (A deliberately empty-targets normal dimension is
  // the B2 warn case below; the always-on full-tree default is '.', also non-empty.)
  for (const dim of dims) {
    assert.ok(dim.key && dim.targets && dim.finderPrompt,
      `assembled dim ${dim.key || '(no key)'} must carry non-empty key + targets + finderPrompt (build-side invariant)`)
  }
})

check('B2 a DRIVER-provided NORMAL dimension with empty targets → a loud WARN (full-tree), build still succeeds; always-on full-tree stays silent', () => {
  // BUG-B relaxation turned a loud template crash into acceptance of empty targets. For a NORMAL
  // dimension that almost always means the driver forgot to resolve targets — so the build must WARN
  // (never silently broaden a focused dimension to the whole repo), while an always-on dimension is
  // full-tree by design and must NOT warn.
  const input = { ...goodInput, applicable: [
    { key: 'crypto-internals', targets: '', stackNotes: 'driver forgot the targets' }, // normal + empty → WARN
    { key: 'apex-exposed-surface', targets: 'classes/X.cls', stackNotes: 'scoped' },     // normal + scoped → no warn
  ] }
  const d = makeRepo(input); dirs.push(d)
  const res = spawnSync('node', [BUILD, '--plugin', PLUGIN, '--repo', d], { encoding: 'utf8' })
  assert.equal(res.status, 0, 'build still succeeds (warn, not fatal)')
  assert.match(res.stderr, /WARN: dimension crypto-internals has no targets — it will be audited as a FULL-TREE scan/, 'a normal empty-targets dimension must warn loudly')
  // the auto-injected always-on dims are full-tree by design — they must NOT trigger the warn
  for (const k of ALWAYS_ON) {
    assert.doesNotMatch(res.stderr, new RegExp(`WARN: dimension ${k} has no targets`), `always-on ${k} is full-tree by design — no warn`)
  }
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

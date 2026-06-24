#!/usr/bin/env node
/**
 * Standing test for harness/build-artifact-engine.mjs + harness/artifact-workflow-template.mjs —
 * the P2 ARTIFACT-drafting assembler that mirrors the audit engine (build-audit-engine.mjs +
 * workflow-template.mjs). It moves the per-artifact content contract (`focus`) and the shared
 * facts into DATA, ending the pre-P2 hand-authored-Workflow escaping class.
 *
 * Guards:
 *   AE1 — valid input → artifact-engine.mjs written; INJECTED carries repoRoot + the artifacts
 *         with their pre-read templateContent + focus + out (injection-check style).
 *   AE2 — GATE ENFORCEMENT: a gate-suppressed artifact is DROPPED + a WARN emitted; it is not
 *         injected (a withheld doc physically cannot be drafted by the Workflow).
 *   AE3 — a missing template aborts loud (never a silent empty template).
 *   AE4 — an empty/short focus aborts loud (the content contract must live in DATA).
 *   AE5 — the injection marker absent from the template → loud fail.
 *   AE6 — the TEMPLATE's run-args guard fires (no injection → throw) and its happy path drafts,
 *         exercised against the REAL template source.
 *   AE7 — every artifact withheld by the gate → exit 2 (fail closed).
 *   AE8 — determinism: same input → byte-identical artifact-engine.mjs.
 *
 * Dependency-free: `node acceptance/test-build-artifact-engine.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const BUILD = join(PLUGIN, 'harness', 'build-artifact-engine.mjs')
const TEMPLATE = join(PLUGIN, 'harness', 'artifact-workflow-template.mjs')

// two real templates that must exist under templates/
for (const t of ['authn-authz-flow.md.tmpl', 'data-flow-diagram.md.tmpl']) {
  if (!existsSync(join(PLUGIN, 'templates', t))) { console.error(`pre-req missing: templates/${t}`); process.exit(1) }
}

let pass = 0, fail = 0
const dirs = []
const check = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

function makeRepo(input) {
  const dir = mkdtempSync(join(tmpdir(), 'bart-test-'))
  dirs.push(dir)
  mkdirSync(join(dir, '.security-review'), { recursive: true })
  writeFileSync(join(dir, '.security-review', 'artifact-input.json'), JSON.stringify(input))
  return dir
}
const goodInput = {
  runDate: '2026-06-17',
  facts: 'Tool count: 12. Identity: org-level client_credentials, no per-end-user identity forwarded. Session-ID: never accepted/forwarded/stored. Hosts: us-east-1. Data classes: PII (Contact email).',
  gate: { mode: 'clean', suppress: [] },
  artifacts: [
    { key: 'authn-authz-flow', tmpl: 'authn-authz-flow.md.tmpl', out: 'docs/security-review/authn-authz-flow.md', focus: 'Trace the middleware/decorator chain from the entry point; token issuance routes in execution order; the validation chain on the hot path; scope + per-tool authz; the settled org-level identity model; sequence diagrams from the traced chain.' },
    { key: 'data-flow-diagram', tmpl: 'data-flow-diagram.md.tmpl', out: 'docs/security-review/data-flow-diagram.md', focus: 'Boxes from deploy config; edges from outbound call sites; the egress ledger from serializers; the AI/LLM egress path; reconcile stored-on-your-side vs the authn-authz credential-storage table.' },
  ],
}
function build(dir) {
  return execFileSync('node', [BUILD, '--plugin', PLUGIN, '--repo', dir], { encoding: 'utf8' })
}
function readInjected(dir) {
  const eng = readFileSync(join(dir, '.security-review', 'artifact-engine.mjs'), 'utf8')
  const m = eng.indexOf('\nconst INJECTED = {')
  const objStart = eng.indexOf('{', m)
  let depth = 0, end = objStart
  for (let i = objStart; i < eng.length; i++) { if (eng[i] === '{') depth++; else if (eng[i] === '}') { depth--; if (depth === 0) { end = i; break } } }
  return JSON.parse(eng.slice(objStart, end + 1))
}

console.log('build-artifact-engine standing test')

await check('AE1 valid input → INJECTED carries repoRoot + artifacts with pre-read templateContent', () => {
  const d = makeRepo(goodInput)
  build(d)
  const eng = readFileSync(join(d, '.security-review', 'artifact-engine.mjs'), 'utf8')
  assert.match(eng, /const INJECTED = \{/)
  const obj = readInjected(d)
  assert.equal(obj.repoRoot, d)
  assert.equal(obj.runDate, '2026-06-17')
  assert.match(obj.facts, /org-level client_credentials/)
  assert.equal(obj.artifacts.length, 2)
  const a = obj.artifacts.find((x) => x.key === 'authn-authz-flow')
  assert.ok(a.templateContent && a.templateContent.length > 100, 'template was read + attached')
  assert.ok(a.focus && a.focus.length > 40, 'focus carried in DATA')
  assert.match(a.out, /authn-authz-flow\.md$/)
})

await check('AE2 GATE ENFORCEMENT: a suppressed artifact is DROPPED + a WARN emitted', () => {
  const d = makeRepo({ ...goodInput, gate: { mode: 'flagged', suppress: ['authn-authz-flow'] } })
  const res = spawnSync('node', [BUILD, '--plugin', PLUGIN, '--repo', d], { encoding: 'utf8' })
  assert.equal(res.status, 0, 'build still succeeds (the rest drafts)')
  assert.match(res.stderr, /WARN: artifact authn-authz-flow withheld by the gate — not drafted/, 'must warn on stderr')
  const obj = readInjected(d)
  const keys = obj.artifacts.map((x) => x.key)
  assert.ok(!keys.includes('authn-authz-flow'), 'the withheld doc must NOT be injected')
  assert.deepEqual(keys, ['data-flow-diagram'], 'only the non-suppressed artifact is injected')
})

await check('AE3 a missing template aborts loud (never a silent empty template)', () => {
  const d = makeRepo({ ...goodInput, artifacts: [{ key: 'x', tmpl: 'totally-not-a-template.md.tmpl', out: 'x.md', focus: 'a sufficiently long content contract focus string for the test artifact here' }] })
  assert.throws(() => execFileSync('node', [BUILD, '--plugin', PLUGIN, '--repo', d], { stdio: 'pipe' }),
    /template not found|Command failed/, 'a missing template must abort')
})

await check('AE4 an empty/short focus aborts loud (the content contract must live in DATA)', () => {
  const d = makeRepo({ ...goodInput, artifacts: [{ key: 'x', tmpl: null, out: 'x.md', focus: '' }] })
  assert.throws(() => execFileSync('node', [BUILD, '--plugin', PLUGIN, '--repo', d], { stdio: 'pipe' }),
    /short focus|content contract|Command failed/, 'an empty focus must abort')
})

await check('AE5 the injection marker absent from the template → loud fail', () => {
  // A fake plugin whose artifact-workflow-template.mjs lacks the marker. The artifact has
  // tmpl:null so the engine never needs the fake plugin's templates/ dir.
  const fakePlugin = mkdtempSync(join(tmpdir(), 'bart-fakeplugin-')); dirs.push(fakePlugin)
  mkdirSync(join(fakePlugin, 'harness'), { recursive: true })
  writeFileSync(join(fakePlugin, 'harness', 'artifact-workflow-template.mjs'), '// no injection marker here\nconst x = 1\n')
  const d = makeRepo({ ...goodInput, artifacts: [{ key: 'x', tmpl: null, out: 'x.md', focus: 'a sufficiently long content contract focus string for the test artifact here' }] })
  assert.throws(() => execFileSync('node', [BUILD, '--plugin', fakePlugin, '--repo', d], { stdio: 'pipe' }),
    /marker not found|Command failed/, 'a template without the marker must abort')
})

await check('AE6 template run-args guard: no injection → throws; valid args → drafts (real source)', async () => {
  // The Workflow runtime wraps the body in an async scope (top-level return/await legal there).
  // Replicate that minimally so the REAL template's run-args guard is exercised, not a copy.
  const src = readFileSync(TEMPLATE, 'utf8').replace('export const meta', 'const meta')
  const make = (argsVal) => {
    const phase = () => {}, log = () => {}
    const agent = async () => 'STUB DRAFT CONTENT'
    const parallel = async (thunks) => Promise.all(thunks.map((t) => t()))
    const fn = new Function('args', 'phase', 'log', 'parallel', 'agent', `return (async () => { ${src} })()`)
    return fn(argsVal, phase, log, parallel, agent)
  }
  // raw template (INJECTED null) + no bound args → the guard throws
  await assert.rejects(make(undefined), /run args missing or incomplete/, 'the marker-not-replaced guard must fire')
  // valid args bound → it drafts and returns { drafted:[{key,out,content}] }
  const res = await make({
    repoRoot: '/r', runDate: '2026-06-17', facts: 'shared facts',
    artifacts: [{ key: 'k', out: 'docs/x.md', focus: 'a sufficiently long content contract focus string for the artifact' }],
  })
  assert.ok(res && Array.isArray(res.drafted) && res.drafted.length === 1, 'happy path returns one drafted entry')
  assert.equal(res.drafted[0].key, 'k')
  assert.equal(res.drafted[0].out, 'docs/x.md')
  assert.equal(res.drafted[0].content, 'STUB DRAFT CONTENT')
})

await check('AE7 every artifact withheld by the gate → exit 2 (fail closed)', () => {
  const d = makeRepo({ ...goodInput, artifacts: [goodInput.artifacts[0]], gate: { suppress: ['authn-authz-flow'] } })
  const res = spawnSync('node', [BUILD, '--plugin', PLUGIN, '--repo', d], { encoding: 'utf8' })
  assert.equal(res.status, 2, 'nothing to draft → exit 2')
  assert.match(res.stderr, /every artifact was withheld|nothing to draft/)
})

await check('AE8 determinism: same input → byte-identical artifact-engine.mjs', () => {
  const d = makeRepo(goodInput)
  build(d)
  const a = readFileSync(join(d, '.security-review', 'artifact-engine.mjs'), 'utf8')
  build(d)
  const b = readFileSync(join(d, '.security-review', 'artifact-engine.mjs'), 'utf8')
  assert.equal(a, b)
})

await check('AE9 template per-artifact guard: a valid run with an artifact missing focus/out → throws (real source)', async () => {
  // Passes the top-level run-args guard (AE6) but trips the SECONDARY per-artifact loop —
  // exercised against the REAL template source via the Workflow-runtime async wrapper.
  const src = readFileSync(TEMPLATE, 'utf8').replace('export const meta', 'const meta')
  const phase = () => {}, log = () => {}
  const agent = async () => 'STUB'
  const parallel = async (thunks) => Promise.all(thunks.map((t) => t()))
  const fn = new Function('args', 'phase', 'log', 'parallel', 'agent', `return (async () => { ${src} })()`)
  const badArgs = { repoRoot: '/r', runDate: '2026-06-17', facts: 'f', artifacts: [{ key: 'k', out: 'o.md' }] } // no focus
  await assert.rejects(fn(badArgs, phase, log, parallel, agent), /artifact entry missing key\/out\/focus/,
    'the template per-artifact loop must reject an entry missing focus/out')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

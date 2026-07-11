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
 *   AE9 — the TEMPLATE's per-artifact guard rejects an entry missing focus/out.
 *   AE10 — the three templated AgentExchange artifacts (exposed-tools-list,
 *          mcp-server-details, api-endpoints-spec) inject cleanly alongside
 *          goodInput: template read + attached, focus ≥ 40 chars, keys present.
 *   AE11 — MUTATION (AE4 pattern): shortening a new artifact's focus below 40
 *          chars → the engine throws.
 *   AE12 — template content contracts: each new .md.tmpl carries its {{SLOT}}
 *          markers + the mandatory provenance-footer heading, and
 *          exposed-tools-list.md.tmpl carries the three-count reconciliation
 *          STRUCTURE (registry N / client-ESR M / org-active A — the guard
 *          against a refresh drafting the client subset as the full registry).
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

// real templates that must exist under templates/
for (const t of ['authn-authz-flow.md.tmpl', 'data-flow-diagram.md.tmpl',
  'exposed-tools-list.md.tmpl', 'mcp-server-details.md.tmpl', 'api-endpoints-spec.md.tmpl']) {
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

// ---------------------------------------------------------------------------
// The three templated AgentExchange artifacts (0.8.118): exposed-tools-list,
// mcp-server-details, api-endpoints-spec — first-class templated entries, no
// engine change (the registry is DATA). Fictional example facts only.
// ---------------------------------------------------------------------------
const newArtifacts = [
  { key: 'exposed-tools-list', tmpl: 'exposed-tools-list.md.tmpl', out: 'docs/security-review/exposed-tools-list.md',
    focus: 'Row set from the code registration/dispatch registry; carry the three-count reconciliation verbatim (registry N=12 tiers 6 read/4 propose/2 admin; client/ESR M=10; org-active A=PENDING — source-only run); registry-only admin tools enumerated; metadata gaps are findings.' },
  { key: 'mcp-server-details', tmpl: 'mcp-server-details.md.tmpl', out: 'docs/security-review/mcp-server-details.md',
    focus: 'Endpoint inventory from route definitions including identity paths; negotiated MCP protocol version from the injected facts or PENDING live capture; org-registration host is HOST-ONLY; every credential cell stays the fixed owner-run text, never a value.' },
  { key: 'api-endpoints-spec', tmpl: 'api-endpoints-spec.md.tmpl', out: 'docs/security-review/api-endpoints-spec.md',
    focus: 'Human-readable wrapper pointing at the captured OpenAPI evidence pair and its provenance sidecar; carry the CAPTURE-ONLY scan-coverage and scoped prod-equivalence PENDING notes plus the tools/list half; never regenerate the JSON; degrade to code-derived rows without a capture.' },
]

await check('AE10 the three templated AgentExchange artifacts inject cleanly alongside goodInput', () => {
  const d = makeRepo({ ...goodInput, artifacts: [...goodInput.artifacts, ...newArtifacts] })
  build(d)
  const obj = readInjected(d)
  assert.equal(obj.artifacts.length, 5, 'all five artifacts injected')
  for (const na of newArtifacts) {
    const got = obj.artifacts.find((x) => x.key === na.key)
    assert.ok(got, `${na.key} injected`)
    assert.ok(got.focus && got.focus.length >= 40, `${na.key} focus carried in DATA (≥ 40 chars)`)
    assert.ok(got.templateContent && got.templateContent.length > 500, `${na.key} template read + attached`)
    assert.match(got.out, new RegExp(`docs/security-review/${na.key}\\.md$`), `${na.key} out under docs/security-review/`)
  }
})

await check('AE11 MUTATION (AE4 pattern): a new artifact focus shortened below 40 chars → the engine throws', () => {
  const mutated = newArtifacts.map((a) => (a.key === 'exposed-tools-list' ? { ...a, focus: 'too short to be a contract' } : a))
  const d = makeRepo({ ...goodInput, artifacts: mutated })
  assert.throws(() => execFileSync('node', [BUILD, '--plugin', PLUGIN, '--repo', d], { stdio: 'pipe' }),
    /short focus|content contract|Command failed/, 'a sub-40-char focus on a templated artifact must abort')
})

await check('AE12 template content contracts: {{SLOT}} markers + provenance footer + the exposed-tools three-count structure', () => {
  const read = (t) => readFileSync(join(PLUGIN, 'templates', t), 'utf8')
  const FOOTER = '## Automated vs. owner-run provenance'
  const et = read('exposed-tools-list.md.tmpl')
  for (const m of ['{{REGISTRY_TOOL_COUNT_N}}', '{{CLIENT_EXPOSED_COUNT_M}}', '{{ORG_ACTIVE_COUNT_A}}',
    '{{TIER_BREAKDOWN}}', '{{DELTA_EXPLANATION}}', '{{GENERATION_DATE}}', '{{GIT_COMMIT}}', FOOTER,
    'artifact-exposed-tools-list', 'PENDING live capture'])
    assert.ok(et.includes(m), `exposed-tools-list.md.tmpl carries ${m}`)
  // the three-count reconciliation STRUCTURE — all three count rows AND the mandatory
  // statement naming all three (the guard against a refresh shipping the client subset
  // as the full registry when M numerically collides with one tier's count)
  assert.match(et, /N — code-registry tools/, 'count row N (code registry — row-set source of truth)')
  assert.match(et, /M — client\/ESR-exposed operations/, 'count row M (client-advertised surface)')
  assert.match(et, /A — org-active agent actions/, 'count row A (org-effective catalog)')
  assert.match(et, /Reconciliation statement \(mandatory, names all three counts\)/, 'the mandatory three-count statement')
  const md = read('mcp-server-details.md.tmpl')
  for (const m of ['{{MCP_PROTOCOL_VERSION}}', '{{SERVER_URL_HOST}}', '{{TRANSPORT}}',
    'Supplied separately (owner-run)', 'HOST-ONLY', '{{GENERATION_DATE}}', '{{GIT_COMMIT}}', FOOTER,
    'artifact-mcp-server-details', 'PENDING live capture'])
    assert.ok(md.includes(m), `mcp-server-details.md.tmpl carries ${m}`)
  const ae = read('api-endpoints-spec.md.tmpl')
  for (const m of ['{{OPENAPI_EVIDENCE_FILENAME}}', '{{OPENAPI_PROVENANCE_FILENAME}}',
    '{{TOOLS_LIST_EVIDENCE_FILENAME}}', '{{OPENAPI_PATH_COUNT}}', 'CAPTURE-ONLY', 'PENDING owner attestation',
    'code-derived', '{{GENERATION_DATE}}', '{{GIT_COMMIT}}', FOOTER, 'artifact-api-endpoints-spec'])
    assert.ok(ae.includes(m), `api-endpoints-spec.md.tmpl carries ${m}`)
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

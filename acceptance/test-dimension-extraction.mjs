#!/usr/bin/env node
/**
 * Standing test: EVERY methodology/dimensions/*.md file is engine-extractable.
 *
 * WHY THIS EXISTS. build-audit-engine.mjs::extract() imposes a strict section
 * contract on each dimension file — `## 4. Finder prompt block` with a fenced
 * block carrying the `Threat focus` and `Known findings — do NOT re-report`
 * markers, then `## 5. Verifier guidance` running to EOF — and THROWS on any
 * malformed file (so a weak model never audits with an empty prompt). But the
 * existing test-build-audit-engine.mjs only exercises TWO hand-picked keys
 * (crypto-internals, apex-exposed-surface). A newly authored dimension with a
 * renamed heading, a missing marker, or a too-short prompt would ship unguarded
 * and only surface mid-run on a real audit. This drives the REAL engine over
 * the WHOLE directory, so every current and future dimension is covered the
 * moment its file lands.
 *
 * Dependency-free: `node acceptance/test-dimension-extraction.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { recordConsent } from '../harness/record-consent.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const BUILD = join(PLUGIN, 'harness', 'build-audit-engine.mjs')
const DIM_DIR = join(PLUGIN, 'methodology', 'dimensions')

const keys = readdirSync(DIM_DIR)
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace(/\.md$/, ''))
  .sort()

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

console.log(`dimension-extraction standing test (${keys.length} dimension files)`)

// Per-file structural markers — a fast, file-named failure before the engine runs.
const MARKERS = [
  '## 4. Finder prompt block',
  'Threat focus',
  'Known findings — do NOT re-report',
  '## 5. Verifier guidance',
]
for (const k of keys) {
  check(`${k}: carries all §4/§5 extraction markers`, () => {
    const md = readFileSync(join(DIM_DIR, `${k}.md`), 'utf8')
    for (const m of MARKERS) assert.ok(md.includes(m), `missing marker: "${m}"`)
    // §4 marker must precede §5 (extract slices §4..§5, then §5..EOF)
    assert.ok(md.indexOf('## 4. Finder prompt block') < md.indexOf('## 5. Verifier guidance'),
      '§4 must precede §5')
  })
}

// The real end-to-end contract: build-audit-engine over EVERY dimension at once
// must succeed and inject a non-empty finderPrompt + verifierNotes for each.
check('build-audit-engine extracts ALL dimensions with non-empty prompts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dim-extract-')); dirs.push(dir)
  mkdirSync(join(dir, '.security-review'), { recursive: true })
  const input = {
    tier: 'standard', passNumber: 1, runDate: '2026-06-20', ledger: '',
    context: { productOneLiner: 'extraction coverage', reviewSurfaces: 'all', stackSummary: 'n/a', securityModelClaims: 'n/a' },
    applicable: keys.map((k) => ({ key: k, targets: 'x', stackNotes: 'y' })),
    na: [],
  }
  writeFileSync(join(dir, '.security-review', 'scope-input.json'), JSON.stringify(input))
  recordConsent('audit-tier', 'yes', { target: dir })
  recordConsent('audit-targetmap', 'yes', { target: dir })
  // throws (non-zero) if ANY dimension file is malformed — the engine names the key
  execFileSync('node', [BUILD, '--plugin', PLUGIN, '--repo', dir], { encoding: 'utf8', stdio: 'pipe' })

  const eng = readFileSync(join(dir, '.security-review', 'audit-engine.mjs'), 'utf8')
  const objStart = eng.indexOf('{', eng.indexOf('\nconst INJECTED = {'))
  let depth = 0, end = objStart
  for (let i = objStart; i < eng.length; i++) { if (eng[i] === '{') depth++; else if (eng[i] === '}') { depth--; if (depth === 0) { end = i; break } } }
  const obj = JSON.parse(eng.slice(objStart, end + 1))

  assert.equal(obj.dimensions.length, keys.length, `injected ${obj.dimensions.length} dims, expected ${keys.length}`)
  const short = obj.dimensions.filter((d) => d.finderPrompt.length <= 200 || d.verifierNotes.length <= 200)
  assert.deepEqual(short.map((d) => d.key), [], `dimensions with a short prompt/notes: ${short.map((d) => d.key).join(', ')}`)
  const got = obj.dimensions.map((d) => d.key).sort()
  assert.deepEqual(got, keys, 'injected dimension keys do not match the directory')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

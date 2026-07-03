#!/usr/bin/env node
/**
 * Standing test for the readiness-verdict template + fill engine (WI-00B + WI-03):
 * templates/operator/readiness-verdict.md.tmpl + harness/render-readiness-verdict.mjs.
 * The readiness verdict was rendered from improvisable skill prose (table-vs-prose,
 * reordered sections, a re-worded standing caveat). This pins the skeleton: a fixed
 * template, deterministic fill, a byte-for-byte SCI paste, and a single caveat constant.
 *
 * RV1  fill on a frozen fixture → byte-identical twice.
 * RV2  section order matches the template (the RENDER sentinel order is fixed).
 * RV3  the SCI slot equals `compute-sci` stdout EXACTLY (byte-for-byte paste).
 * RV4  the standing caveat equals the committed constant STANDING_CAVEAT (force-injected,
 *      not paraphrasable — a caller value for it is overridden).
 * RV5  the lint flags a deliberately hand-built table for a templated surface, and the
 *      real compile-submission skill passes the lint (routes through the template).
 * RV6  FAIL CLOSED — a missing slot leaves a {{SLOT}} → fillVerdict THROWS; a full fill
 *      leaves no {{...}}; a template without the caveat slot THROWS.
 * RV7  WIRING — compile-submission grants the render harnesses + references the template
 *      and the render-verbatim contract.
 *
 * Dependency-free: `node acceptance/test-readiness-verdict.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  STANDING_CAVEAT, fillVerdict, hasMarkdownTable, lintRenderVerbatim, REGISTERED_SURFACES,
} from '../harness/render-readiness-verdict.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const TEMPLATE_PATH = join(PLUGIN, 'templates', 'operator', 'readiness-verdict.md.tmpl')
const TEMPLATE = readFileSync(TEMPLATE_PATH, 'utf8')
const SCI = join(PLUGIN, 'harness', 'compute-sci.mjs')
const STAB = join(PLUGIN, 'harness', 'render-stability.mjs')

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) } }
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'rv-')); dirs.push(d); return d }

const EXPECTED_ORDER = ['sci-block', 'ledger-freshness', 'finding-stability', 'per-category', 'blockers', 'not-verified', 'open-conflicting', 'standing-caveat']

const baseSlots = () => ({
  SOLUTION_NAME: 'Acme Forecaster',
  RUN_DATE: '2026-06-25',
  SCI_BLOCK: '## Submission Completeness Index (SCI)\n\n**READINESS: BLOCKED**\n- Gate: 1 open critical finding',
  LEDGER_FRESHNESS: '[current] Repo is at the audited commit. Ledger findings are current.',
  FINDING_STABILITY: '### Finding Stability (N-run consensus)\n\nFinding stability not assessed: only one audit run.',
  PER_CATEGORY: '- Documentation: ready\n- Package code-scan: NOT ready',
  BLOCKERS: '- Apex CRUD/FLS — owner salesforce-session — run Code Analyzer',
  NOT_VERIFIED: '- the white-box audit is static review, not DAST',
  OPEN_CONFLICTING_BASELINE: '- process-review-fee — confirm via your PAM',
})

console.log('readiness-verdict template + fill-engine standing test')

check('RV1 fill on a frozen fixture → byte-identical twice', () => {
  const a = fillVerdict(TEMPLATE, baseSlots())
  const b = fillVerdict(TEMPLATE, baseSlots())
  assert.equal(a, b)
})

check('RV2 section order matches the template (fixed RENDER sentinel order)', () => {
  const filled = fillVerdict(TEMPLATE, baseSlots())
  const order = [...filled.matchAll(/RENDER:([a-z-]+) START/g)].map((m) => m[1])
  assert.deepEqual(order, EXPECTED_ORDER)
})

check('RV3 the SCI slot equals compute-sci stdout EXACTLY (byte-for-byte paste)', () => {
  // minimal fixture repo: empty applicable + empty elements → deterministic NOT-READY
  // block (with --date). elements must be empty too: with an element present and no
  // stored ids, compute-sci's stale-manifest refusal exits 2 instead (test-sci S4).
  const repo = tmp()
  mkdirSync(join(repo, '.security-review'), { recursive: true })
  writeFileSync(join(repo, '.security-review', 'scope-manifest.json'), JSON.stringify({ applicableBaselineIds: [], elements: [] }))
  writeFileSync(join(repo, '.security-review', 'audit-ledger.json'), JSON.stringify({ findings: [], passes: [] }))
  const sciStdout = execFileSync('node', [SCI, '--target', repo, '--plugin', PLUGIN, '--date', '2026-06-25'], { encoding: 'utf8' })
  const sci = sciStdout.replace(/\n$/, '') // strip only the trailing newline the CLI adds
  const slots = { ...baseSlots(), SCI_BLOCK: sci }
  const filled = fillVerdict(TEMPLATE, slots)
  // EXACT equality of the verbatim region between the sentinels — not a substring check, so
  // ANY injected text inside the sci-block region (e.g. a driver's editorial note) fails here.
  const afterStart = filled.split('<!-- RENDER:sci-block START')[1]
  const innerWithComment = afterStart.split('<!-- RENDER:sci-block END')[0]
  const inner = innerWithComment.slice(innerWithComment.indexOf('-->') + 3).trim()
  assert.equal(inner, sci, 'the SCI region equals compute-sci stdout EXACTLY (no injected text)')
  assert.match(filled, /## Submission Completeness Index \(SCI\)/)
})

check('RV4 the standing caveat equals the committed constant (force-injected, not paraphrasable)', () => {
  const filled = fillVerdict(TEMPLATE, baseSlots())
  assert.ok(filled.includes(STANDING_CAVEAT), 'the canonical caveat is rendered verbatim')
  // two honesty anchors, so a reword of the rest of the caveat that keeps one phrase still fails
  assert.match(STANDING_CAVEAT, /never \*\*"will pass"\*\*/)
  assert.match(STANDING_CAVEAT, /materials-and-disposition state, not a prediction/)
  // a caller value for the caveat is OVERRIDDEN (the constant wins — cannot be paraphrased)
  const filled2 = fillVerdict(TEMPLATE, { ...baseSlots(), STANDING_CAVEAT: 'this app WILL PASS the review, guaranteed' })
  assert.ok(filled2.includes(STANDING_CAVEAT), 'force-injection beats a caller-supplied caveat')
  assert.ok(!/WILL PASS the review, guaranteed/.test(filled2), 'a paraphrased caveat cannot leak through')
})

check('RV5 the lint flags a hand-built table for a templated surface; the real skill passes', () => {
  // the detector fires on a table, not on prose
  assert.equal(hasMarkdownTable('| Category | Status |\n|---|---|\n| Docs | ready |'), true)
  assert.equal(hasMarkdownTable('just some prose with a | pipe but no table'), false)
  const surface = REGISTERED_SURFACES.find((s) => s.id === 'readiness-verdict')
  // a synthetic BAD step: hand-builds the verdict as a table, references neither template nor renderer
  const badStep = 'Emit the verdict:\n\n| Section | Status |\n|---|---|\n| SCI | BLOCKED |\n| Blockers | 1 |'
  // assert the SPECIFIC table-flagging path fires (not just the template-reference path)
  assert.ok(lintRenderVerbatim(badStep, surface).some((s) => /hand-builds a Markdown table/.test(s)), 'a hand-built verdict table must be flagged by the table path')
  // the REAL compile-submission skill routes through the template → clean
  const skill = readFileSync(join(PLUGIN, 'skills', 'compile-submission', 'SKILL.md'), 'utf8')
  assert.deepEqual(lintRenderVerbatim(skill, surface), [], 'the real skill must reference the template (route through the engine)')
})

check('RV6 FAIL CLOSED: unfilled slot / empty required block / no caveat slot all THROW; full fill → no {{...}}', () => {
  // an UNFILLED non-required slot → the leftover sweep throws
  const missingData = { ...baseSlots() }
  delete missingData.PER_CATEGORY
  assert.throws(() => fillVerdict(TEMPLATE, missingData), /unfilled slot\(s\) survived/)
  // an EMPTY required engine block (a dropped/failed harness capture) → the hollow-verdict guard throws
  assert.throws(() => fillVerdict(TEMPLATE, { ...baseSlots(), SCI_BLOCK: '   ' }), /required block 'SCI_BLOCK' is missing or empty/)
  // a template missing the caveat slot → throws
  assert.throws(() => fillVerdict('# verdict with no caveat slot {{SCI_BLOCK}}', baseSlots()), /missing the \{\{STANDING_CAVEAT\}\} slot/)
  // a full fill leaves no brace placeholder of ANY shape
  const filled = fillVerdict(TEMPLATE, baseSlots())
  assert.ok(!/\{\{[^{}]*\}\}/.test(filled), 'no {{...}} survives a real fill')
})

check('RV7 WIRING: compile-submission grants the render harnesses + references the template + the contract', () => {
  const skill = readFileSync(join(PLUGIN, 'skills', 'compile-submission', 'SKILL.md'), 'utf8')
  assert.match(skill, /Bash\(node \*harness\/render-stability\.mjs \*\)/, 'grants render-stability')
  assert.match(skill, /Bash\(node \*harness\/render-readiness-verdict\.mjs \*\)/, 'grants render-readiness-verdict')
  assert.match(skill, /templates\/operator\/readiness-verdict\.md\.tmpl/, 'references the template')
  assert.match(skill, /verbatim/i, 'states the render-verbatim contract')
  assert.match(skill, /render-stability\.mjs/, 'wires the stability render')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

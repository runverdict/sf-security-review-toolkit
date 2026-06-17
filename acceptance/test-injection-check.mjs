#!/usr/bin/env node
/**
 * Standing test for the audit-engine pre-launch check (harness/injection-check.mjs).
 * Guards G5: the INJECTED-object extraction must anchor on the REAL line-start
 * `const INJECTED = {` assignment and SKIP the template's header-comment decoy
 * (which contains the literal `const INJECTED = `). The naive
 * `indexOf('const INJECTED = ')` slice grabs the comment → a false SyntaxError →
 * a weak model aborts a healthy run; this proves the anchored extractor doesn't.
 *
 * Dependency-free: `node acceptance/test-injection-check.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { extractInjected, checkInjection } from '../harness/injection-check.mjs'

let pass = 0, fail = 0
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`) }
}

// The exact header-comment decoy from workflow-template.mjs:49 — it contains the
// literal `const INJECTED = ` but is NOT a line-start assignment.
const DECOY = ' *      replace the marked `const INJECTED = /* {{ARGS_OBJECT}} */ null` line so'
// A real injected object — note the brace INSIDE a string value (the scan must
// not end early on it) and that the next line is the template's `const ARGS = …`.
const REAL_OBJ = '{"repoRoot":"/abs/partner/repo","tier":"standard","note":"a path with {curly} braces in a string"}'
const assembled = [
  '/**',
  ' * workflow-template.mjs — the audit engine.',
  DECOY,
  ' *      INJECTED is the load-bearing path; the args branch is a safety net.',
  ' */',
  'import { readFileSync } from "node:fs"',
  `const INJECTED = ${REAL_OBJ}`,
  'const ARGS = typeof args !== "undefined" && args && args.repoRoot ? args : INJECTED',
  'phase("audit")',
  'return { ok: true }',
].join('\n')

console.log('injection-check standing test')

check('the decoy appears BEFORE the real assignment (the trap the naive slice falls into)', () => {
  const naive = assembled.indexOf('const INJECTED = ')
  assert.ok(naive >= 0)
  // the first bare-substring hit is inside the comment decoy, not the real line
  const lineStart = assembled.lastIndexOf('\n', naive) + 1
  assert.ok(assembled.slice(lineStart, naive).includes('*'), 'first `const INJECTED = ` hit should be inside the comment decoy')
})

check('extractInjected SKIPS the decoy and returns the REAL object (incl. brace-in-string)', () => {
  const slice = extractInjected(assembled)
  assert.equal(slice, REAL_OBJ)
  const obj = JSON.parse(slice)
  assert.equal(obj.repoRoot, '/abs/partner/repo')
  assert.ok(obj.note.includes('{curly}'), 'a brace inside a JSON string must not truncate the scan')
})

check('checkInjection → ok on a real injected object', () => {
  const r = checkInjection(assembled)
  assert.equal(r.ok, true)
  assert.equal(r.args.repoRoot, '/abs/partner/repo')
})

check('un-injected (still the `= null` marker) → not-ok, names the un-run injection', () => {
  const marker = assembled.replace(`const INJECTED = ${REAL_OBJ}`, 'const INJECTED = /* {{ARGS_OBJECT}} */ null')
  assert.equal(extractInjected(marker), null)
  const r = checkInjection(marker)
  assert.equal(r.ok, false)
  assert.match(r.error, /injection did not run|did not run|marker/i)
})

check('parsed but missing repoRoot → not-ok (run-args incomplete)', () => {
  const t = assembled.replace(`const INJECTED = ${REAL_OBJ}`, 'const INJECTED = {"tier":"standard"}')
  const r = checkInjection(t)
  assert.equal(r.ok, false)
  assert.match(r.error, /repoRoot/)
})

check('non-JSON value → not-ok (does not parse)', () => {
  const t = assembled.replace(`const INJECTED = ${REAL_OBJ}`, 'const INJECTED = {repoRoot: not valid json}')
  const r = checkInjection(t)
  assert.equal(r.ok, false)
  assert.match(r.error, /parse/i)
})

check('indented line-start assignment is still found', () => {
  const t = 'const x = 1\n  const INJECTED = {"repoRoot":"/r"}\nconst ARGS = INJECTED'
  assert.equal(checkInjection(t).ok, true)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

#!/usr/bin/env node
/**
 * Standing test for harness/clamp-log.mjs — head+tail failure-log truncation.
 *
 * Guards the diagnostics fix: scanner/DAST failure logs were truncated TAIL-ONLY
 * (`.slice(-1500)`/`.slice(-2000)`), discarding the ROOT CAUSE at the TOP of a deep
 * stack trace. clampLog keeps BOTH ends with an elision marker, so a truncated log
 * stays diagnosable.
 *
 * Dependency-free: `node acceptance/test-clamp-log.mjs`.
 */
import assert from 'node:assert/strict'
import { clampLog } from '../harness/clamp-log.mjs'

let pass = 0, fail = 0
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

console.log('clamp-log standing test')

check('a short string (length <= max) is returned UNCHANGED', () => {
  assert.equal(clampLog('hello', 1500), 'hello')
  assert.equal(clampLog('', 100), '')
  const exact = 'x'.repeat(100)
  assert.equal(clampLog(exact, 100), exact, 'length === max → unchanged (no marker)')
})

check('a long string keeps the HEAD (root cause) + the TAIL + an elision marker', () => {
  const head = 'ROOTCAUSE'.repeat(60) // distinctive top — the first stack frames
  const mid = 'M'.repeat(5000)
  const tail = 'FINALERR'.repeat(60) // distinctive bottom — the final failure
  const s = head + mid + tail
  const out = clampLog(s, 2000)
  assert.ok(out.length < s.length, 'a long string is truncated')
  assert.ok(out.startsWith(s.slice(0, Math.ceil(2000 / 2))), 'keeps the head — ceil(max/2) chars')
  assert.ok(out.endsWith(s.slice(-Math.floor(2000 / 2))), 'keeps the tail — floor(max/2) chars')
  assert.match(out, /…\[\d+ chars elided\]…/, 'carries the elision marker')
  assert.match(out, new RegExp(`\\[${s.length - 2000} chars elided\\]`), 'the marker reports the right elided count')
  assert.ok(out.includes('ROOTCAUSE'), 'the root cause at the TOP survives — the whole point of head+tail')
  assert.ok(out.includes('FINALERR'), 'the final error at the bottom survives')
})

check('output length is bounded to max content + a small fixed marker overhead', () => {
  const s = 'a'.repeat(100000)
  const out = clampLog(s, 1500)
  const marker = `\n…[${s.length - 1500} chars elided]…\n`
  assert.equal(out.length, 1500 + marker.length, 'exactly head(750)+tail(750) content + the marker')
  assert.ok(out.length < 1600, 'bounded far under the 100k original')
})

check('pure/deterministic + safe on non-string and non-positive max', () => {
  const s = 'z'.repeat(5000)
  assert.equal(clampLog(s, 1500), clampLog(s, 1500), 'byte-deterministic')
  assert.equal(clampLog(null, 100), '', 'null → ""')
  assert.equal(clampLog(undefined, 100), '', 'undefined → ""')
  assert.equal(clampLog(42, 100), '42', 'a short non-string coerces and passes through')
  // a non-positive / non-finite max never throws; a non-empty string then always exceeds it.
  assert.match(clampLog('abcdef', 0), /chars elided/, 'max 0 → everything elided, no crash')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

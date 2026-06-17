#!/usr/bin/env node
/**
 * injection-check.mjs — the audit-engine pre-launch check (G5).
 *
 * WHY THIS EXISTS. The audit launch copies harness/workflow-template.mjs into the
 * target, replaces the marked `const INJECTED = /* {{ARGS_OBJECT}} *\/ null` line
 * with the run-args object, and runs the copy via the Workflow tool. Before
 * launching, the args should be validated to parse — but `node --check` rejects
 * the template's top-level `return` (a legal Workflow-runtime idiom), so the check
 * must validate ONLY the injected INJECTED object. The naive recipe "JSON.parse
 * the slice between `const INJECTED = ` and the next `const`" is FRAGILE: the
 * template's own header comment contains the literal `const INJECTED = ` (it
 * documents the marker), so an indexOf-based slice grabs the COMMENT, not the real
 * assignment, and reports a false SyntaxError — a weak model then misreads
 * "injection failed" and aborts a perfectly healthy run. Same string/path-anchor
 * family as the 0.2.1 args bug and the 0.3.1 finder REPOSITORY-ANCHOR fix.
 *
 * The fix: anchor on the REAL assignment — a line-start `const INJECTED = {` with
 * an OBJECT value (post-injection) — and brace-match the object (string-aware, so
 * a brace inside a JSON string value doesn't end the scan early). The comment
 * decoy (` *  …  `const INJECTED = …``) is not line-start and the pre-injection
 * marker is `= null` (not `= {`), so both are correctly skipped.
 *
 * PURE core (`extractInjected` / `checkInjection`); the CLI reads a file.
 * No LLM, no deps, no network.
 *
 * USAGE: node injection-check.mjs <assembled-script.mjs>   (exit 0 = INJECTED parses + has repoRoot)
 */
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Extract the injected INJECTED object's source text. Anchors on a LINE-START
// `const INJECTED = {` (the real post-injection assignment), NOT the bare
// `const INJECTED = ` substring (which also appears in the header comment and, as
// `= null`, in the pre-injection marker). Returns the balanced `{…}` slice, or
// null if no real object assignment is present (e.g. injection never ran).
export function extractInjected(scriptText) {
  const s = String(scriptText || '')
  const m = s.match(/(?:^|\n)[ \t]*const INJECTED[ \t]*=[ \t]*\{/)
  if (!m) return null
  const open = s.indexOf('{', m.index)
  if (open < 0) return null
  let depth = 0, inStr = false, esc = false
  for (let i = open; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') { if (--depth === 0) return s.slice(open, i + 1) }
  }
  return null // unbalanced braces
}

/** Validate the injected args parse and carry repoRoot. Returns {ok, error?, args?}. */
export function checkInjection(scriptText) {
  const slice = extractInjected(scriptText)
  if (slice == null) {
    return { ok: false, error: 'no `const INJECTED = { … }` object assignment found — injection did not run (still the `= null` marker?), or the assignment is not line-start' }
  }
  let args
  try { args = JSON.parse(slice) }
  catch (e) { return { ok: false, error: `INJECTED does not parse as JSON: ${String(e.message).split('\n')[0]}` } }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return { ok: false, error: 'INJECTED parsed but is not an object' }
  if (!args.repoRoot) return { ok: false, error: 'INJECTED parsed but is missing `repoRoot` (run-args incomplete — the run would fail fast)' }
  return { ok: true, args }
}

function main() {
  const path = process.argv[2]
  if (!path) { process.stderr.write('usage: node injection-check.mjs <assembled-script.mjs>\n'); process.exit(2) }
  let text
  try { text = readFileSync(path, 'utf8') }
  catch (e) { process.stderr.write(`cannot read ${path}: ${String(e.message).split('\n')[0]}\n`); process.exit(2) }
  const r = checkInjection(text)
  if (r.ok) { process.stdout.write(`✓ INJECTED parses (repoRoot=${r.args.repoRoot}, tier=${r.args.tier || 'n/a'})\n`); process.exit(0) }
  process.stderr.write(`✗ injection check FAILED: ${r.error}\n`); process.exit(1)
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) }
  catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

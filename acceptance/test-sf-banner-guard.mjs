#!/usr/bin/env node
/**
 * Standing test: the `sf` update-availability banner-disable guard on the shipped
 * skills. Encodes the fix for a cold-run defect — the CLI's update-availability
 * banner prints to stdout ahead of a `--json` payload and corrupts its parsing.
 *
 * The ONLY reliable mitigation is per-Bash-block: every Claude Code Bash tool call
 * runs in a FRESH shell (shell state does not persist), so an `export` in one block
 * never carries to the next. The banner-disable flags must therefore sit at the TOP
 * of every Bash block that runs `sf`, in the SAME fence as the `sf` command:
 *
 *   export SF_AUTOUPDATE_DISABLE=true SF_DISABLE_AUTOUPDATE=true
 *   sf <command> --json …
 *
 * Two checks over every `skills/<name>/SKILL.md`, plus one on the harness constant:
 *
 *   CHECK A — the broken "disable the … banner once for the session" phrasing is
 *       gone everywhere (proves the six prose paragraphs were REWRITTEN, not merely
 *       supplemented; a survivor means someone re-introduced the export-once model).
 *   CHECK B — every bash fence that runs a real `sf` command carries the literal
 *       `SF_AUTOUPDATE_DISABLE` token IN THE SAME FENCE (a separate adjacent fence is
 *       useless across fresh shells). Fence-boundary detection is WHITESPACE-TOLERANT
 *       (the fences in these skills are indented 2–5 spaces), and the check asserts a
 *       NONZERO FLOOR of sf-bearing fences so a parser that silently matches nothing
 *       fails CLOSED rather than passing vacuously.
 *   CHECK C — `SF_AUTOUPDATE_OFF` (the constant every harness `sf` spawn threads via
 *       `sfEnv()`) carries `SF_SKIP_NEW_VERSION_CHECK`. The two autoupdate flags
 *       disable the auto-UPDATE; they do NOT silence the update-availability banner —
 *       that is a different oclif control (proven off disk: with only the two flags
 *       the banner still prints). Hermetic: asserts on the exported object, no live `sf`.
 *
 * Pure filesystem grep + one exported-constant assert — no network, no `sf`, no org.
 * Dependency-free: `node acceptance/test-sf-banner-guard.mjs`.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SF_AUTOUPDATE_OFF } from '../harness/sf-env.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// every skills/<name>/SKILL.md
const SKILL_FILES = readdirSync(join(ROOT, 'skills'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => join('skills', e.name, 'SKILL.md'))

// Whitespace-tolerant fence marker — the fences under numbered steps / nested
// bullets carry 2–5 leading spaces, so an unanchored `^```` would match ZERO of
// them and let CHECK B pass vacuously (audit correction #2).
const FENCE = /^\s*```/
const SF_LINE = /^\s*sf\s/m // a real `sf ` command line inside a fence body
const SFDX_LINE = /^\s*sfdx\s/m // excluded — `sfdx` is a different binary
const GUARD_TOKEN = 'SF_AUTOUPDATE_DISABLE'
const BANNER_ONCE = /update-availability banner once/i

// Fail-closed floor. The real count of sf-bearing fences across the skills is ~53;
// this floor (well below it, clearly nonzero) trips if the whitespace-tolerant
// parser silently matches (near) nothing, so an empty match fails CLOSED.
const MIN_SF_FENCES = 20

// Collect every fenced block's { rel, startLine, body } from one skill file.
const collectFences = (rel) => {
  const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n')
  const fences = []
  let inFence = false
  let startLine = 0
  let body = []
  for (let i = 0; i < lines.length; i++) {
    if (!inFence && FENCE.test(lines[i])) { inFence = true; startLine = i + 1; body = []; continue }
    if (inFence && FENCE.test(lines[i])) { fences.push({ rel, startLine, body: body.join('\n') }); inFence = false; continue }
    if (inFence) body.push(lines[i])
  }
  return fences
}

let pass = 0, fail = 0
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

console.log(`sf-banner-guard standing test (${SKILL_FILES.length} skill files)`)

// CHECK A — the once-per-session anti-pattern must be gone everywhere.
check('CHECK A: no "update-availability banner once" anti-pattern in any skill', () => {
  const hits = []
  for (const rel of SKILL_FILES) {
    readFileSync(join(ROOT, rel), 'utf8').split('\n').forEach((line, i) => {
      if (BANNER_ONCE.test(line)) hits.push(`${rel}:${i + 1}  ${line.trim().slice(0, 80)}`)
    })
  }
  assert.deepEqual(hits, [], `broken export-once phrasing survives (rewrite to per-block):\n    ${hits.join('\n    ')}`)
})

// CHECK B — every sf-bearing fence carries the export at its top; nonzero floor.
check('CHECK B: every sf-bearing bash fence carries the SF_AUTOUPDATE_DISABLE guard', () => {
  const allFences = SKILL_FILES.flatMap(collectFences)
  const sfFences = allFences.filter((f) => SF_LINE.test(f.body) && !SFDX_LINE.test(f.body))

  // Fail-closed: the parser must actually be finding fences.
  assert.ok(
    sfFences.length >= MIN_SF_FENCES,
    `only ${sfFences.length} sf-bearing fence(s) detected (floor ${MIN_SF_FENCES}) — ` +
      `the whitespace-tolerant fence parser is matching (near) nothing; failing CLOSED`,
  )

  const unguarded = sfFences
    .filter((f) => !f.body.includes(GUARD_TOKEN))
    .map((f) => `${f.rel}:${f.startLine}`)
  assert.deepEqual(
    unguarded,
    [],
    `sf fence(s) missing the ${GUARD_TOKEN} guard at the fence top ` +
      `(the export MUST be in the SAME fence as \`sf\`, not a separate adjacent one):\n    ${unguarded.join('\n    ')}`,
  )
})

// CHECK C — the harness constant actually suppresses the banner, not just the update.
check('CHECK C: SF_AUTOUPDATE_OFF carries SF_SKIP_NEW_VERSION_CHECK (the banner control itself)', () => {
  assert.equal(
    SF_AUTOUPDATE_OFF.SF_SKIP_NEW_VERSION_CHECK,
    'true',
    'the autoupdate flags alone do NOT silence the update-availability banner — ' +
      'SF_SKIP_NEW_VERSION_CHECK is the oclif control that does',
  )
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

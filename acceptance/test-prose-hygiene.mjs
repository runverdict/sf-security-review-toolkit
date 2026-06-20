#!/usr/bin/env node
/**
 * Standing test: prose hygiene on the shipped methodology + baseline surface.
 * Encodes two CONVENTIONS rules that an adversarial audit of the 2026-06-20
 * coverage-gap changeset caught a fresh violation of — so they cannot recur:
 *
 *   §9 (Writing voice): the word "simply" is explicitly banned. The audit found
 *       two fresh occurrences in a new dimension file (the rule reads verbatim:
 *       "No marketing language, no 'simply', no unexplained acronyms").
 *   §3 (Genericization): no partner-of-origin INTERNAL symbol may ship in the
 *       public methodology/baseline. The audit found `visible_user_ids` — the
 *       origin codebase's literal variable name — presented as "the
 *       visible_user_ids pattern", as though it were generic industry vocabulary.
 *       A real partner running the toolkit has no such symbol; it must read as a
 *       concept ("an owner/visible-user/subtree filter"), not a name to match.
 *
 * Dependency-free: `node acceptance/test-prose-hygiene.mjs`.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const mdUnder = (rel) => {
  const dir = join(ROOT, rel)
  let out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out = out.concat(mdUnder(join(rel, e.name)))
    else if (e.name.endsWith('.md')) out.push(join(rel, e.name))
  }
  return out
}

// §9 "simply" ban — scoped to the dimension-authoring voice surface (methodology/).
const VOICE_FILES = mdUnder('methodology')
// §3 partner-internal symbols — must not ship in methodology OR baseline.
const GENERIC_FILES = [...VOICE_FILES, 'baseline/requirements-baseline.yaml', 'baseline/SOURCES.md']

// Internal symbols from the partner-of-origin codebase — NOT generic vocabulary.
const BANNED_TOKENS = ['visible_user_ids', 'VisibleUserIds', 'app.current_org_id']

const scan = (relFiles, re) => {
  const hits = []
  for (const rel of relFiles) {
    const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n')
    lines.forEach((line, i) => { if (re.test(line)) hits.push(`${rel}:${i + 1}  ${line.trim().slice(0, 80)}`) })
  }
  return hits
}

let pass = 0, fail = 0
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

console.log(`prose-hygiene standing test (${VOICE_FILES.length} methodology files)`)

check('CONVENTIONS §9: no "simply" in methodology prose', () => {
  const hits = scan(VOICE_FILES, /\bsimply\b/i)
  assert.deepEqual(hits, [], `banned word "simply" (§9) found:\n    ${hits.join('\n    ')}`)
})

for (const tok of BANNED_TOKENS) {
  check(`CONVENTIONS §3: no partner-internal symbol "${tok}" in methodology/baseline`, () => {
    // word-ish boundary so a substring inside an unrelated identifier is not a false hit
    const re = new RegExp(tok.replace(/[.]/g, '\\.'))
    const hits = scan(GENERIC_FILES, re)
    assert.deepEqual(hits, [], `partner-internal symbol "${tok}" (§3) found — genericize it:\n    ${hits.join('\n    ')}`)
  })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

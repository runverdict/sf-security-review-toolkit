#!/usr/bin/env node
/**
 * Standing PRESENCE test for the calibration false-positive patterns that blind
 * multi-judge verifications found the verifier over-firing: three from a blind
 * 30-judge run (5 judges × 6 findings — H1/H2/H4) and a fourth from a blind
 * 15-judge multi-vote (3 rounds × 5) on the Solano webhook "HMAC-compute DoS"
 * (modal NOT-A-FINDING). The patterns are LLM verifier-guidance prose (CONVENTIONS §7
 * "prose layer", NOT-deterministically-test-backed — the real proof is the next
 * Solano cold re-run no longer over-firing). This test does NOT try to test the
 * LLM judgment; it guards against the rules SILENTLY REGRESSING OUT of the
 * dimensions — it asserts each pattern's stable phrase is present in the
 * §6 Known-false-positive table of every named dimension, plus the cross-cutting
 * lines in audit-methodology.md.
 *
 * Dependency-free: `node acceptance/test-calibration-fp-patterns.mjs`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const DIMS = join(PLUGIN, 'methodology', 'dimensions')

let pass = 0, fail = 0
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

console.log('calibration-fp-patterns presence test')

// Extract a top-level "## N. ..." section (up to the next "## " or EOF).
function section(text, n) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => new RegExp(`^## ${n}\\. `).test(l))
  if (start < 0) return ''
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) { end = i; break }
  }
  return lines.slice(start, end).join('\n')
}

// pattern id → { phrase that must appear in §6, the dimensions it must appear in }
const PATTERNS = [
  { id: '1 reachability-is-a-precondition', phrase: 'no attacker-reachable caller', dims: ['background-jobs', 'tenant-isolation'] },
  { id: '2 availability-is-not-security', phrase: 'fail-closed on availability', dims: ['error-handling-disclosure', 'secrets-credentials'] },
  { id: '3 a-missing-grant-is-fail-closed', phrase: 'a missing grant is fail-closed', dims: ['agentforce-package', 'apex-exposed-surface', 'admin-surface'] },
  { id: '4 webhook-hmac-rate-limit-cheap-work', phrase: 'hmac-compute', dims: ['resource-consumption-abuse'] },
]

for (const p of PATTERNS) {
  for (const dim of p.dims) {
    check(`pattern ${p.id} present in ${dim} §6 Known-false-positive table`, () => {
      const text = readFileSync(join(DIMS, `${dim}.md`), 'utf8')
      const s6 = section(text, 6)
      assert.ok(s6, `${dim}.md has no "## 6." section`)
      assert.ok(
        s6.toLowerCase().includes(p.phrase),
        `${dim}.md §6 is missing the calibration-FP phrase "${p.phrase}" — the rule regressed out`
      )
    })
  }
}

// Cross-cutting lines in the methodology's verifier loop (§3) + the dedup note (§5).
// Whitespace-normalized so a phrase that wraps across a prose line still matches.
const methodology = readFileSync(join(PLUGIN, 'methodology', 'audit-methodology.md'), 'utf8')
  .toLowerCase().replace(/\s+/g, ' ')
check('audit-methodology verifier prompt carries the reachability-precondition directionality line', () => {
  assert.ok(methodology.includes('reachability is a precondition'), 'the §3 verifier-loop directionality line regressed out')
})

check('audit-methodology §5.2 carries the single-highest-severity cross-dimension dedup note', () => {
  assert.ok(methodology.includes('single highest verified'), 'the cross-dimension single-severity dedup note regressed out')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

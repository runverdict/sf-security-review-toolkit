#!/usr/bin/env node
/**
 * Standing test: CI workflow hygiene — least-privilege GITHUB_TOKEN.
 *
 * WHY THIS EXISTS. An external security audit of the public repo flagged that
 * .github/workflows/test.yml had no top-level `permissions:` block, so its
 * GITHUB_TOKEN inherited the repo-default scope. A Salesforce Product Security
 * reviewer checks this first. The workflow only checks out the repo and runs the
 * dependency-free test suite — it needs a READ-ONLY token. This test pins that:
 * the workflow MUST declare a top-level `permissions:` block granting
 * `contents: read` and NO write scope, so a future edit that drops or widens the
 * workflow's permissions fails the build.
 *
 * Dependency-free: `node acceptance/test-ci-hygiene.mjs`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const WF = join(PLUGIN, '.github', 'workflows', 'test.yml')

let pass = 0, fail = 0
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

console.log('ci-hygiene standing test (.github/workflows/test.yml least-privilege token)')

const yml = readFileSync(WF, 'utf8')
const lines = yml.split('\n')

check('declares a TOP-LEVEL `permissions:` block (column 0, not job-scoped)', () => {
  assert.match(yml, /^permissions:\s*$/m,
    'workflow must declare a top-level `permissions:` block at column 0 (least privilege over the default scope)')
})

check('grants `contents: read` (the only scope a checkout + test workflow needs)', () => {
  assert.match(yml, /^\s+contents:\s*read\s*$/m,
    'the permissions block must grant `contents: read`')
})

check('grants NO write scope anywhere (no `: write` token, no `write-all`)', () => {
  // Reject ANY write grant: `contents: write`, `id-token: write`, `packages: write`, …
  const writes = lines
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /:\s*write\b/i.test(l))
  assert.deepEqual(writes, [],
    `no permission may be granted write scope — found:\n    ${writes.map(([n, l]) => `L${n}: ${l.trim()}`).join('\n    ')}`)
  assert.doesNotMatch(yml, /write-all/i, '`permissions: write-all` (or any write-all) is forbidden')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

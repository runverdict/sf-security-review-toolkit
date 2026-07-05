#!/usr/bin/env node
/**
 * Standing test: CI workflow hygiene — least-privilege GITHUB_TOKEN — plus the
 * SC-* supply-chain posture locks (0.8.75).
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
 * SC-* (supply-chain posture). The README "Supply chain" section states the
 * toolkit's own trust floor: no `package.json` anywhere in the tree (zero
 * runtime npm dependencies), every harness/ + hooks/ import is a Node builtin
 * or a relative in-repo file, and the section itself must stay present so the
 * doc and the guard cannot drift apart. A claim like that is only worth making
 * if it cannot silently become false — these checks are the lock.
 *
 * Dependency-free: `node acceptance/test-ci-hygiene.mjs`.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { builtinModules } from 'node:module'

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

// ── SC-* supply-chain posture locks (README "Supply chain", 0.8.75) ──────────

console.log('\nsupply-chain posture locks (README "Supply chain" claims)')

check('SC-no-package-json: no tracked package.json / package-lock.json anywhere', () => {
  let files
  if (existsSync(join(PLUGIN, '.git'))) {
    files = execFileSync('git', ['ls-files'], { cwd: PLUGIN, encoding: 'utf8' })
      .split('\n').filter(Boolean)
  } else {
    // Not a git checkout (e.g. an extracted archive) — walk the tree instead.
    const walk = (rel) => readdirSync(join(PLUGIN, rel), { withFileTypes: true }).flatMap((e) => {
      if (e.name === '.git' || e.name === 'node_modules') return []
      const child = rel ? `${rel}/${e.name}` : e.name
      return e.isDirectory() ? walk(child) : [child]
    })
    files = walk('')
  }
  assert.ok(files.length > 100,
    `expected a full repo file listing, got ${files.length} — refusing a vacuous pass`)
  const offenders = files.filter((f) => /(^|\/)package(-lock)?\.json$/.test(f))
  assert.deepEqual(offenders, [],
    `zero-runtime-npm-dependency posture violated — remove: ${offenders.join(', ')} (or rewrite the README "Supply chain" claim honestly)`)
})

check('SC-harness-stdlib-only: every harness/ + hooks/ import is a node builtin or a relative path', () => {
  const mjsUnder = (dir) => readdirSync(join(PLUGIN, dir), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.mjs'))
    .map((e) => `${dir}/${e.name}`)
  const files = [...mjsUnder('harness'), ...mjsUnder('hooks')]
  // Static `… from '<spec>'` (matches the closing line of a multi-line import too),
  // bare `import '<spec>'`, dynamic `import('<spec>')`, and `require('<spec>')`.
  const specRes = [
    /\bfrom\s+['"]([^'"\n]+)['"]/g,
    /(?:^|[;\n])\s*import\s+['"]([^'"\n]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"\n]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"\n]+)['"]/g,
  ]
  const offenders = []
  let specs = 0
  for (const rel of files) {
    const src = readFileSync(join(PLUGIN, rel), 'utf8')
    for (const re of specRes) {
      for (const m of src.matchAll(re)) {
        // Prose in comments can echo the pattern (e.g. `// … from "CWE-###: …"`).
        // Skip matches on comment lines; real import/export/require lines never are.
        const lineStart = src.lastIndexOf('\n', m.index) + 1
        if (/^\s*(\/\/|\*|\/\*)/.test(src.slice(lineStart, m.index))) continue
        specs++
        const spec = m[1]
        const ok = spec.startsWith('./') || spec.startsWith('../')
          || spec.startsWith('node:') || builtinModules.includes(spec)
        if (!ok) offenders.push(`${rel}: '${spec}'`)
      }
    }
  }
  assert.ok(files.length >= 40 && specs >= 100,
    `expected the full harness surface (got ${files.length} files / ${specs} import specifiers) — refusing a vacuous pass`)
  assert.deepEqual(offenders, [],
    `third-party import in the stdlib-only harness — the README "Supply chain" claim no longer holds:\n    ${offenders.join('\n    ')}`)
})

check('SC-readme-claim: README carries the supply-chain / zero-dependency claim', () => {
  const readme = readFileSync(join(PLUGIN, 'README.md'), 'utf8')
  assert.match(readme, /^## Supply chain$/m,
    'README must keep the "## Supply chain" section (the claim these SC-* checks lock)')
  assert.match(readme, /Zero runtime npm dependencies/,
    'README must state the zero-runtime-npm-dependency posture')
  assert.match(readme, /no `package\.json`/,
    'README must state the no-package.json fact SC-no-package-json pins')
  assert.match(readme, /sha256-verified against author-pinned checksums/,
    'README must state the digest-verified scanner-install posture (install-scanners.mjs)')
})

// ── Skill-prose guard (0.8.84): compose IaC routes to trivy config, never checkov ──

check('F8-compose-iac: run-scans Family 8 scans compose with `trivy config`, never an improvised checkov docker_compose framework', () => {
  const skill = readFileSync(join(PLUGIN, 'skills', 'run-scans', 'SKILL.md'), 'utf8')
  // Cold-run finding: on a compose target the driver improvised a checkov
  // `docker_compose` framework value (not a valid checkov framework) → empty/errored
  // scan, then fell back to trivy. The skill must carry the trivy route explicitly
  // and must never (re)introduce the bogus checkov flag value.
  // MUTATION: adding the literal `--framework docker_compose` anywhere in the skill turns this red first.
  assert.doesNotMatch(skill, /--framework docker_compose/,
    'checkov has no docker_compose framework — the skill must never carry that flag value')
  assert.match(skill, /trivy config -f json/,
    'the compose-IaC invocation (`trivy config -f json <dir>`) must be documented in Family 8')
  assert.match(skill, /compose IaC is scanned with `trivy config[^`]*`, NOT\s+checkov/,
    'the compose→trivy-not-checkov routing line must be present')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

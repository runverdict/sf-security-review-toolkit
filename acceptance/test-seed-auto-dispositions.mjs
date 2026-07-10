#!/usr/bin/env node
/**
 * Standing test for harness/seed-auto-dispositions.mjs — the deterministic AUTO-DISPOSITION
 * SEEDER. It pre-clears the exact known-safe scanner-noise shapes as an OVERRIDABLE PRIOR
 * (emitted in the schema apply-dispositions.mjs consumes, marked `disposition_source:
 * 'heuristic'`) so the readiness headline is not wrong-by-default until a human hand-clears
 * the noise — while never over-clearing a real finding.
 *
 * Guards:
 *   P1   isMigrationPath — a path SEGMENT alembic / migrations / versions matches; a
 *        substring (migrations_helper) or an unrelated path does NOT.
 *   P2   packageFromFinding — recovers the npm package from osv (scoped + unscoped) and
 *        npm-audit titles; a non-npm ecosystem, a bad title, or a non-dep engine → null.
 *   H1a  MIGRATION-DDL — a migration-path text()/B608 finding is cleared.
 *   H1b  the NON-migration text()/B608 finding is NOT cleared (the mutation target — a real
 *        injection must not be auto-refuted by path-blindness).
 *   H2a  DEV-ONLY-DEP — a CVE for a direct dev-only npm dependency is cleared.
 *   H2b  a production-dep CVE, and a transitive dep (in neither list), are NOT cleared.
 *   H3a  HISTORY-ONLY SECRET — a gitleaks finding whose file is absent from HEAD is cleared.
 *   H3b  a secret present IN HEAD is NOT cleared; and with HEAD unreadable (headFiles null)
 *        the heuristic clears NOTHING (fail conservative).
 *   S1   every emitted entry carries disposition_source:'heuristic', heuristic_id, evidence,
 *        and a scope.files; only `provenance:'deterministic'` findings are ever considered.
 *   S2   SCHEMA — every emitted entry passes apply-dispositions' own validateDisposition.
 *   S3   INTEGRATION — the emitted entries flow through applyDispositions and flip EXACTLY
 *        the cleared deterministic findings, and NEVER an llm-inferred finding at the same
 *        locus (the paramount safety property is preserved end to end).
 *   S4   deterministic + idempotent — the pure core returns a byte-identical result on a
 *        re-run over the same inputs.
 *   CLI1 the CLI seeds a fresh dispositions file; a second run adds nothing and leaves the
 *        file byte-identical (idempotent); --dry-run writes nothing.
 *   CLI2 NON-CLOBBERING merge — an existing hand-written entry for the same engine+ruleId
 *        is preserved and the heuristic prior is NOT duplicated.
 *   CLI3 fail-loud — a corrupted ledger, or an unparseable existing dispositions file, exits
 *        2 and writes nothing.
 *   MUT  the mutation harness — with the migration-path guard removed, the NON-migration
 *        text() IS (wrongly) cleared, so H1b would fail. Proves the guard is load-bearing.
 *
 * Dependency-free: `node acceptance/test-seed-auto-dispositions.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  seedAutoDispositions,
  isMigrationPath,
  packageFromFinding,
} from '../harness/seed-auto-dispositions.mjs'
import { applyDispositions, validateDisposition } from '../harness/apply-dispositions.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'seed-auto-dispositions.mjs')

let pass = 0
let fail = 0
const dirs = []
const check = (name, fn) => {
  try {
    fn()
    pass++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    fail++
    console.log(`  ✗ ${name}\n    ${e.message}`)
  }
}

// ---- finding + fact builders -------------------------------------------------
let seq = 0
const det = (over) => ({
  id: `d${(seq++).toString(16).padStart(4, '0')}`,
  provenance: 'deterministic',
  status: 'confirmed',
  severity: 'high',
  first_seen: 1,
  last_seen: 1,
  ...over,
})
// a text()/B608 SQL finding
const textFinding = (file) =>
  det({ engine: 'semgrep', ruleId: 'python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text', file, title: 'avoid-sqlalchemy-text' })
const b608Finding = (file) => det({ engine: 'bandit', ruleId: 'B608', file, title: 'B608: possible SQL injection' })
// a dependency-CVE finding whose title matches the ingest osv shape
const osvFinding = (ruleId, pkg, ecosystem, file) =>
  det({ engine: 'osv', ruleId, file, title: `${ruleId}: ${pkg}@1.2.3 (${ecosystem}): ${pkg} has a known vulnerability` })
const npmAuditFinding = (ruleId, pkg, file) =>
  det({ engine: 'npm-audit', ruleId, file, title: `${ruleId}: ${pkg} (<=1.2.3) — moderate severity npm dependency vulnerability: vulnerable via ${pkg}` })
const secretFinding = (file, ruleId = 'generic-api-key') =>
  det({ engine: 'gitleaks', ruleId, file, title: `${ruleId}: detected a secret` })

// a repo-facts object with an explicit HEAD set + dev-scope map
const facts = ({ head = [], dev = {} } = {}) => ({
  headFiles: head === null ? null : new Set(head),
  devScope: (relDir) => new Set(dev[relDir] || []),
})

// helpers to inspect the emitted dispositions
const clearedFiles = (result, heuristic) =>
  new Set(result.dispositions.filter((d) => d.heuristic_id === heuristic).flatMap((d) => d.scope.files))
const isCleared = (result, file) => result.dispositions.some((d) => d.scope.files.includes(file))

console.log('seed-auto-dispositions standing test\n')

// ---- P1 isMigrationPath ------------------------------------------------------
check('P1 isMigrationPath — alembic/versions + db/migrations + <dir>/versions match; substrings do not', () => {
  assert.equal(isMigrationPath('apps/api/alembic/versions/0001_x.py:12'), true)
  assert.equal(isMigrationPath('service/db/migrations/0002_y.py'), true)
  assert.equal(isMigrationPath('pkg/versions/z.py'), true)
  assert.equal(isMigrationPath('app/api/routes/admin.py:9'), false)
  assert.equal(isMigrationPath('app/migrations_helper.py'), false) // substring, not a segment
  assert.equal(isMigrationPath(''), false)
})

// ---- P2 packageFromFinding ---------------------------------------------------
check('P2 packageFromFinding — osv (scoped + unscoped) + npm-audit npm; non-npm / bad / non-dep → null', () => {
  assert.deepEqual(packageFromFinding(osvFinding('GHSA-1', 'webserver', 'npm', 'x/package-lock.json')), { name: 'webserver', ecosystem: 'npm' })
  assert.deepEqual(packageFromFinding(osvFinding('GHSA-2', '@scope/tool', 'npm', 'x/package-lock.json')), { name: '@scope/tool', ecosystem: 'npm' })
  assert.equal(packageFromFinding(osvFinding('PYSEC-1', 'pylib', 'PyPI', 'requirements.txt')), null) // non-npm ecosystem
  assert.deepEqual(packageFromFinding(npmAuditFinding('dev-linter', 'dev-linter', 'package-lock.json')), { name: 'dev-linter', ecosystem: 'npm' })
  assert.equal(packageFromFinding(det({ engine: 'osv', ruleId: 'GHSA-3', file: 'x', title: 'no colon prefix here' })), null)
  assert.equal(packageFromFinding(b608Finding('app/x.py')), null) // not a dep engine
})

// ---- H1 migration-ddl --------------------------------------------------------
check('H1a MIGRATION-DDL — a migration-path text()/B608 is cleared', () => {
  const r = seedAutoDispositions([textFinding('alembic/versions/0001_x.py:5'), b608Finding('db/migrations/0002_y.py:9')], facts())
  const files = clearedFiles(r, 'migration-ddl')
  assert.ok(files.has('alembic/versions/0001_x.py'), 'migration text() cleared')
  assert.ok(files.has('db/migrations/0002_y.py'), 'migration B608 cleared')
  assert.equal(r.byHeuristic['migration-ddl'].findings, 2)
})

check('H1b NON-migration text()/B608 is NOT cleared (the mutation target)', () => {
  const r = seedAutoDispositions([textFinding('app/api/routes/admin.py:9'), b608Finding('service/reporting.py:4')], facts())
  assert.equal(r.dispositions.length, 0, 'a route-level text()/B608 must stay OPEN for the audit')
})

// ---- H2 dev-only-dep ---------------------------------------------------------
check('H2a DEV-ONLY-DEP — a direct dev-only npm dependency CVE is cleared', () => {
  const r = seedAutoDispositions(
    [osvFinding('GHSA-dev', 'test-harness', 'npm', 'apps/web/package-lock.json')],
    facts({ dev: { 'apps/web': ['test-harness'] } })
  )
  const d = r.dispositions.find((x) => x.heuristic_id === 'dev-only-dep')
  assert.ok(d, 'dev-only dep cleared')
  assert.equal(d.evidence.package, 'test-harness')
  assert.equal(d.evidence.classified_from, 'apps/web/package.json')
})

check('H2b a production-dep CVE and a transitive dep (in neither list) are NOT cleared', () => {
  const r = seedAutoDispositions(
    [
      osvFinding('GHSA-prod', 'web-framework', 'npm', 'apps/web/package-lock.json'), // a prod dep
      osvFinding('GHSA-trans', 'buried-lib', 'npm', 'apps/web/package-lock.json'), // transitive: in neither list
    ],
    facts({ dev: { 'apps/web': ['test-harness'] } }) // only test-harness is dev-only
  )
  assert.equal(r.dispositions.length, 0, 'a prod / transitive dep CVE must stay OPEN')
})

// ---- H3 history-only-secret --------------------------------------------------
check('H3a HISTORY-ONLY SECRET — a gitleaks finding absent from HEAD is cleared', () => {
  const r = seedAutoDispositions([secretFinding('config/leaked.env.bak:20')], facts({ head: ['app/main.py'] }))
  const d = r.dispositions.find((x) => x.heuristic_id === 'history-only-secret')
  assert.ok(d, 'history-only secret cleared')
  assert.deepEqual(d.evidence.absent_from_head, ['config/leaked.env.bak'])
})

check('H3b a secret IN HEAD is NOT cleared; HEAD unreadable → clears nothing', () => {
  const inHead = seedAutoDispositions([secretFinding('app/config.py:3')], facts({ head: ['app/config.py'] }))
  assert.equal(inHead.dispositions.length, 0, 'a secret that ships in HEAD must stay OPEN')
  const noGit = seedAutoDispositions([secretFinding('config/leaked.env.bak:1')], facts({ head: null }))
  assert.equal(noGit.dispositions.length, 0, 'HEAD unreadable → history-only clears nothing (conservative)')
})

// ---- S1 source + evidence + provenance gate ----------------------------------
check('S1 every entry carries source + heuristic_id + evidence + scope.files; only deterministic findings considered', () => {
  const r = seedAutoDispositions(
    [
      textFinding('alembic/versions/0001.py:5'),
      // an llm-inferred secret + dep at clearable loci must be IGNORED (not deterministic)
      { ...secretFinding('config/leaked.env.bak:1'), provenance: 'llm-inferred' },
      { ...osvFinding('GHSA-x', 'test-harness', 'npm', 'apps/web/package-lock.json'), provenance: 'llm-inferred' },
    ],
    facts({ head: ['app/main.py'], dev: { 'apps/web': ['test-harness'] } })
  )
  assert.equal(r.dispositions.length, 1, 'only the deterministic migration finding produces an entry')
  for (const d of r.dispositions) {
    assert.equal(d.disposition_source, 'heuristic')
    assert.ok(['migration-ddl', 'dev-only-dep', 'history-only-secret'].includes(d.heuristic_id))
    assert.ok(d.evidence && typeof d.evidence === 'object')
    assert.ok(Array.isArray(d.scope.files) && d.scope.files.length > 0)
    assert.equal(d.disposition, 'refuted')
  }
})

// ---- S2 schema conformance with apply-dispositions ---------------------------
check('S2 SCHEMA — every emitted entry passes apply-dispositions validateDisposition', () => {
  const r = seedAutoDispositions(
    [
      textFinding('alembic/versions/0001.py:5'),
      b608Finding('db/migrations/0002.py:9'),
      osvFinding('GHSA-dev', 'test-harness', 'npm', 'apps/web/package-lock.json'),
      secretFinding('config/leaked.env.bak:20'),
    ],
    facts({ head: ['app/main.py'], dev: { 'apps/web': ['test-harness'] } })
  )
  assert.ok(r.dispositions.length >= 3)
  for (const d of r.dispositions) {
    const errors = validateDisposition(d)
    assert.equal(errors.length, 0, `entry ${d.engine}/${d.ruleId} must be schema-valid: ${errors.join('; ')}`)
  }
})

// ---- S3 end-to-end apply: flips exactly the cleared set, never llm-inferred ---
check('S3 INTEGRATION — emitted entries flip exactly the cleared findings, never an llm-inferred sibling', () => {
  const findings = [
    textFinding('alembic/versions/0001.py:5'), // cleared
    b608Finding('app/api/routes/admin.py:9'), // NOT cleared (route)
    osvFinding('GHSA-dev', 'test-harness', 'npm', 'apps/web/package-lock.json'), // cleared
    osvFinding('GHSA-prod', 'web-framework', 'npm', 'apps/web/package-lock.json'), // NOT cleared (prod)
    secretFinding('config/leaked.env.bak:20'), // cleared
    secretFinding('app/config.py:3'), // NOT cleared (in HEAD)
    // an llm-inferred finding carrying the SAME engine+ruleId at a cleared locus — untouchable
    { ...secretFinding('config/leaked.env.bak:20'), id: 'llm-secret', provenance: 'llm-inferred' },
  ]
  const r = seedAutoDispositions(findings, facts({ head: ['app/main.py', 'app/config.py'], dev: { 'apps/web': ['test-harness'] } }))
  const applied = applyDispositions(findings, r.dispositions)
  const byId = Object.fromEntries(applied.findings.map((f) => [f.id, f.status]))
  const clearedIds = findings.filter((f) => f.provenance === 'deterministic' && isClearedFinding(r, f)).map((f) => f.id)
  // every cleared deterministic finding flipped to refuted
  for (const id of clearedIds) assert.equal(byId[id], 'refuted', `${id} should flip`)
  assert.equal(clearedIds.length, 3, 'exactly the 3 known-safe shapes flip')
  // the llm-inferred sibling at the same locus is NEVER flipped
  assert.equal(byId['llm-secret'], 'confirmed', 'llm-inferred finding is untouchable — the paramount safety property')
})
function isClearedFinding(result, f) {
  const norm = String(f.file).replace(/:\d+.*$/, '')
  return result.dispositions.some((d) => String(d.engine) === String(f.engine) && String(d.ruleId) === String(f.ruleId) && d.scope.files.includes(norm))
}

// ---- S4 deterministic + idempotent core --------------------------------------
check('S4 deterministic — the pure core returns a byte-identical result on re-run', () => {
  const findings = [
    b608Finding('db/migrations/0002.py:9'),
    textFinding('alembic/versions/0001.py:5'),
    secretFinding('config/leaked.env.bak:20'),
    osvFinding('GHSA-dev', 'test-harness', 'npm', 'apps/web/package-lock.json'),
  ]
  const f = facts({ head: ['app/main.py'], dev: { 'apps/web': ['test-harness'] } })
  const a = seedAutoDispositions(findings, f)
  const b = seedAutoDispositions(findings, f)
  assert.equal(JSON.stringify(a.dispositions), JSON.stringify(b.dispositions))
})

// ---- CLI ---------------------------------------------------------------------
const node = (args, opts = {}) => execFileSync('node', args, { encoding: 'utf8', stdio: 'pipe', ...opts })
const gitInit = (dir) => {
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dir })
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir })
}
// build a tmp target: a git repo with a package.json, a committed migration + source, and a
// ledger of findings; the leaked backup file is left UNTRACKED (absent from HEAD).
function makeTarget() {
  const dir = mkdtempSync(join(tmpdir(), 'seed-auto-'))
  dirs.push(dir)
  mkdirSync(join(dir, '.security-review'), { recursive: true })
  mkdirSync(join(dir, 'db', 'migrations'), { recursive: true })
  mkdirSync(join(dir, 'app'), { recursive: true })
  mkdirSync(join(dir, 'apps', 'web'), { recursive: true })
  writeFileSync(join(dir, 'db', 'migrations', '0001_x.py'), 'op.execute(text("ALTER TABLE t ..."))\n')
  writeFileSync(join(dir, 'app', 'service.py'), 'API_KEY = "sk-live-xxxx"\nq = text("SELECT ...")\n')
  writeFileSync(
    join(dir, 'apps', 'web', 'package.json'),
    JSON.stringify({ dependencies: { 'web-framework': '^1.0.0' }, devDependencies: { 'test-harness': '^2.0.0' } }, null, 2)
  )
  gitInit(dir) // commits the three files above; leaked-old.env is created AFTER, untracked
  writeFileSync(join(dir, 'leaked-old.env'), 'SECRET=zzz\n')
  const findings = [
    b608Finding('db/migrations/0001_x.py:1'), // migration → cleared
    b608Finding('app/service.py:2'), // non-migration → NOT cleared
    secretFinding('leaked-old.env:1'), // absent from HEAD → cleared
    secretFinding('app/service.py:1'), // in HEAD → NOT cleared
    osvFinding('GHSA-dev', 'test-harness', 'npm', 'apps/web/package-lock.json'), // dev-only → cleared
    osvFinding('GHSA-prod', 'web-framework', 'npm', 'apps/web/package-lock.json'), // prod → NOT cleared
  ]
  writeFileSync(join(dir, '.security-review', 'audit-ledger.json'), JSON.stringify({ schema_version: 1, findings, passes: [] }, null, 2))
  return dir
}
const dispPathOf = (dir) => join(dir, '.security-review', 'deterministic-dispositions.json')

check('CLI1 seeds a fresh file (3 shapes), a re-run adds 0 + byte-identical; --dry-run writes nothing', () => {
  const dir = makeTarget()
  // dry-run first — must not create the file
  const dry = JSON.parse(node([CLI, '--target', dir, '--dry-run', '--json']))
  assert.equal(dry.willWrite, true)
  assert.equal(dry.addedEntries, 3, 'migration + dev-dep + history-only')
  assert.equal(dry.findingsCovered, 3)
  assert.throws(() => readFileSync(dispPathOf(dir), 'utf8'), 'dry-run wrote nothing')
  // real run — writes the file
  const first = JSON.parse(node([CLI, '--target', dir, '--json']))
  assert.equal(first.addedEntries, 3)
  const written1 = readFileSync(dispPathOf(dir), 'utf8')
  const parsed = JSON.parse(written1)
  assert.equal(parsed.dispositions.length, 3)
  // exactly the migration B608, the dev-only osv, and the history-only secret
  const keys = parsed.dispositions.map((d) => `${d.engine}/${d.ruleId}`).sort()
  assert.deepEqual(keys, ['bandit/B608', 'gitleaks/generic-api-key', 'osv/GHSA-dev'])
  // idempotent re-run — adds nothing, file byte-identical
  const second = JSON.parse(node([CLI, '--target', dir, '--json']))
  assert.equal(second.addedEntries, 0)
  assert.equal(readFileSync(dispPathOf(dir), 'utf8'), written1, 'file byte-identical on re-run')
})

check('CLI2 NON-CLOBBERING — an existing hand entry for the same engine+ruleId is preserved, not duplicated', () => {
  const dir = makeTarget()
  // a human already adjudicated bandit/B608 rule-wide
  const hand = { dispositions: [{ engine: 'bandit', ruleId: 'B608', disposition: 'refuted', reason: 'human rule-wide review', scope: { as_of_pass: 1 } }] }
  writeFileSync(dispPathOf(dir), JSON.stringify(hand, null, 2))
  node([CLI, '--target', dir])
  const parsed = JSON.parse(readFileSync(dispPathOf(dir), 'utf8'))
  const b608 = parsed.dispositions.filter((d) => d.engine === 'bandit' && d.ruleId === 'B608')
  assert.equal(b608.length, 1, 'the bandit/B608 hand entry is not duplicated')
  assert.equal(b608[0].reason, 'human rule-wide review', 'the human entry wins verbatim')
  // the OTHER heuristics (dev-dep, history-only) were still added
  assert.ok(parsed.dispositions.some((d) => d.engine === 'osv' && d.disposition_source === 'heuristic'))
  assert.ok(parsed.dispositions.some((d) => d.engine === 'gitleaks' && d.disposition_source === 'heuristic'))
})

check('CLI3 fail-loud — a corrupted ledger and an unparseable dispositions file each exit 2, writing nothing', () => {
  // corrupted ledger — a present-but-non-array `findings` is loadLedger's data-loss guard
  const d1 = mkdtempSync(join(tmpdir(), 'seed-auto-'))
  dirs.push(d1)
  mkdirSync(join(d1, '.security-review'), { recursive: true })
  writeFileSync(join(d1, '.security-review', 'audit-ledger.json'), JSON.stringify({ schema_version: 1, findings: 'corrupt' }))
  assert.throws(() => node([CLI, '--target', d1]), (e) => e.status === 2)
  // valid ledger, corrupted existing dispositions file
  const d2 = makeTarget()
  writeFileSync(dispPathOf(d2), '{ broken')
  assert.throws(() => node([CLI, '--target', d2]), (e) => e.status === 2)
  assert.equal(readFileSync(dispPathOf(d2), 'utf8'), '{ broken', 'the corrupted file is left untouched')
})

// ---- MUT — prove the migration-path guard is load-bearing --------------------
// Runs the SAME H1b scenario against a mutant of the engine with the migration-path guard
// removed; the mutant must (wrongly) clear the non-migration text(). Executed in a
// subprocess so the assertion is fully synchronous and the real engine is never mutated.
check('MUT — with the migration-path guard removed, a NON-migration text() IS wrongly cleared (guard is load-bearing)', () => {
  const src = readFileSync(join(PLUGIN, 'harness', 'seed-auto-dispositions.mjs'), 'utf8')
  const mutated = src.replace('if (isTextSqlRule(f) && isMigrationPath(f.file)) {', 'if (isTextSqlRule(f)) {')
  assert.notEqual(mutated, src, 'the guard expression must be present to mutate')
  const mutDir = mkdtempSync(join(tmpdir(), 'seed-mut-'))
  dirs.push(mutDir)
  const mutPath = join(mutDir, 'mutant.mjs')
  // rewrite the relative imports to absolute so the mutant loads from the tmp dir
  writeFileSync(mutPath, mutated.replace(/from '\.\//g, `from '${join(PLUGIN, 'harness')}/`))
  const runner =
    `import { seedAutoDispositions } from ${JSON.stringify('file://' + mutPath)};` +
    `const f = { id: 'm', provenance: 'deterministic', engine: 'semgrep', ruleId: 'x.avoid-sqlalchemy-text.x', file: 'app/api/routes/admin.py:9', title: 't' };` +
    `const r = seedAutoDispositions([f], { headFiles: new Set(), devScope: () => new Set() });` +
    `process.stdout.write(String(r.dispositions.length));`
  const out = node(['--input-type=module', '-e', runner])
  assert.equal(out, '1', 'the mutant (no path guard) clears a non-migration text() — exactly what H1b guards against, so H1b would go red')
})

// -----------------------------------------------------------------------------
for (const d of dirs) {
  try {
    rmSync(d, { recursive: true, force: true })
  } catch {
    /* best-effort cleanup */
  }
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

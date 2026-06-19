#!/usr/bin/env node
/**
 * Standing test for harness/stack-detect.mjs — the throwaway-DAST-target detector
 * (0.7.0 foundation). Pure classifiers tested exhaustively; the CLI fact-gathering
 * driven hermetically against a synthetic repo (no network).
 *
 *   S1  classifyEnvName: external > secret precedence, benign, unknown
 *   S2  classifyStack: n/a / needs-recipe / needs-secrets / runnable
 *   S3  determinism: same facts → byte-identical
 *   S4  CLI on a synthetic Node repo → runnable, port + env classified (the
 *       prototype's ATLAS_JWT_SECRET=synthesizable / PORT=benign shape)
 *   S5  CLI on a repo whose server needs a real DATABASE_URL → needs-secrets
 *   S6  CLI on a package-only repo (sfdx-project.json, no server) → n/a
 *
 * Dependency-free: `node acceptance/test-stack-detect.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { classifyEnvName, classifyStack } from '../harness/stack-detect.mjs'

const DETECT = fileURLToPath(new URL('../harness/stack-detect.mjs', import.meta.url))
let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`) } }
const mkrepo = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'srt-stackd-'))); dirs.push(d); return d }
const w = (root, rel, body) => { const p = join(root, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, body) }
const cli = (target) => JSON.parse(execFileSync('node', [DETECT, '--target', target, '--json'], { encoding: 'utf8' }))

console.log('stack-detect standing test')

check('S1 classifyEnvName: external beats secret; benign; unknown', () => {
  assert.equal(classifyEnvName('ATLAS_JWT_SECRET'), 'synthesizable')  // a self-contained signing secret
  assert.equal(classifyEnvName('SESSION_SECRET'), 'synthesizable')
  assert.equal(classifyEnvName('DATABASE_URL'), 'external')           // points at a real DB
  assert.equal(classifyEnvName('REDIS_PASSWORD'), 'external')         // external service wins over "password"
  assert.equal(classifyEnvName('STRIPE_API_KEY'), 'external')         // third-party account
  assert.equal(classifyEnvName('OPENAI_API_KEY'), 'external')
  assert.equal(classifyEnvName('PORT'), 'benign')
  assert.equal(classifyEnvName('NODE_ENV'), 'benign')
  assert.equal(classifyEnvName('FEATURE_FLAG_X'), 'unknown')
})

check('S2 classifyStack: n/a / needs-recipe / needs-secrets / runnable', () => {
  assert.equal(classifyStack({ serverRoots: [], recipe: null }).status, 'n/a')
  assert.equal(classifyStack({ serverRoots: ['server'], recipe: null, envNames: ['PORT'] }).status, 'needs-recipe')
  const ns = classifyStack({ serverRoots: ['server'], recipe: { kind: 'node' }, webTier: { port: 8080 }, envNames: ['ATLAS_JWT_SECRET', 'DATABASE_URL', 'PORT'] })
  assert.equal(ns.status, 'needs-secrets')
  assert.deepEqual(ns.env.external, ['DATABASE_URL'])
  assert.deepEqual(ns.env.synthesizable, ['ATLAS_JWT_SECRET'])
  const ok = classifyStack({ serverRoots: ['server'], recipe: { kind: 'node' }, webTier: { port: 8080 }, envNames: ['ATLAS_JWT_SECRET', 'PORT'] })
  assert.equal(ok.status, 'runnable')          // only synthesizable + benign env → autonomous stand-up
  assert.deepEqual(ok.env.external, [])
})

check('S3 determinism: same facts → byte-identical', () => {
  const f = { serverRoots: ['server'], recipe: { kind: 'node' }, webTier: { port: 8080 }, envNames: ['B', 'A', 'JWT_SECRET'] }
  assert.equal(JSON.stringify(classifyStack(f)), JSON.stringify(classifyStack(f)))
})

check('S4 CLI on a synthetic Node repo → runnable, port + env classified', () => {
  const r = mkrepo()
  w(r, 'server/package.json', JSON.stringify({ name: 'api', main: 'index.js', scripts: { start: 'node index.js' }, dependencies: { express: '^4' } }))
  w(r, 'server/index.js', "const jwt=process.env.API_JWT_SECRET; const p=process.env.PORT||8080; require('express')().listen(p);")
  const out = cli(r)
  assert.equal(out.status, 'runnable', out.reason)
  assert.equal(out.recipe.kind, 'node')
  assert.equal(out.webTier.port, 8080)
  assert.ok(out.env.synthesizable.includes('API_JWT_SECRET'))
  assert.ok(out.env.benign.includes('PORT'))
})

check('S5 CLI on a server needing a real DATABASE_URL → needs-secrets', () => {
  const r = mkrepo()
  w(r, 'api/package.json', JSON.stringify({ main: 'index.js', scripts: { start: 'node index.js' } }))
  w(r, 'api/index.js', "const db=process.env.DATABASE_URL; const s=process.env.SESSION_SECRET; require('http').createServer().listen(3000);")
  const out = cli(r)
  assert.equal(out.status, 'needs-secrets', out.reason)
  assert.deepEqual(out.env.external, ['DATABASE_URL'])
  assert.ok(out.env.synthesizable.includes('SESSION_SECRET'))
})

check('S6 CLI on a package-only repo → n/a', () => {
  const r = mkrepo()
  w(r, 'sfdx-project.json', JSON.stringify({ packageDirectories: [{ path: 'force-app' }] }))
  w(r, 'force-app/main/default/classes/Foo.cls', 'public class Foo {}')
  const out = cli(r)
  assert.equal(out.status, 'n/a', out.reason)
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

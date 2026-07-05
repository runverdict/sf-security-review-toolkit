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
 *   S7  classifyStack compose-satisfiability: satisfied external env reclassified
 *       (secret-named → synthesizable, else benign); unsatisfied stays external
 *   S8  compose helpers pure: service names break at top-level volumes:;
 *       ${VAR:-x}/${VAR:=x} honored, ${VAR:?req}/${VAR:+alt}/${VAR} not;
 *       concrete KEY:value assignment detected, bare pass-through not
 *   S9  CLI on a SELF-CONTAINED compose (in-compose pg+redis, defaulted creds)
 *       → runnable, external=[] (the cold-run regression pin)
 *   S10 CLI on a compose with a bare ${DATABASE_URL} (external managed DB, no
 *       postgres service) → still needs-secrets (the discriminator)
 *   S11 CLI cold-run shape (self-contained compose + scripts/*.py reading
 *       ADMIN_DATABASE_URL): compose-scoped gathering clears it → runnable;
 *       an env_file: directive falls back to union gathering → needs-secrets
 *
 * Dependency-free: `node acceptance/test-stack-detect.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  classifyEnvName, classifyStack,
  composeServiceNames, composeDefaultedVars, composeConcreteAssigned,
} from '../harness/stack-detect.mjs'

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

// ── Compose-satisfiability (0.8.81) — a self-contained compose must reach the DAST gate ──

// The cold-run shape: in-compose postgres+redis, defaulted creds, concrete DATABASE_URL,
// a sibling top-level volumes: block whose children must NOT read as services.
const SELF_CONTAINED_COMPOSE = [
  'services:',
  '  api:',
  '    build: ./api',
  '    ports:',
  '      - "8000:8000"',
  '    environment:',
  '      DATABASE_URL: postgresql://verdict:${POSTGRES_PASSWORD:-verdict}@postgres:5432/verdict',
  '      REDIS_URL: redis://redis:6379/0',
  '      SECRET_KEY: ${SECRET_KEY:-dev-secret}',
  '    depends_on:',
  '      - postgres',
  '      - redis',
  '  postgres:',
  '    image: postgres:16',
  '    environment:',
  '      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-verdict}',
  '  redis:',
  '    image: redis:7',
  'volumes:',
  '  postgres_data:',
  '  redis_data:',
  '',
].join('\n')

check('S7 classifyStack: compose-satisfied external env reclassified; unsatisfied stays external', () => {
  const base = { serverRoots: ['api'], recipe: { kind: 'compose', file: 'docker-compose.yml' }, webTier: { port: 8000 } }
  const ok = classifyStack({ ...base, envNames: ['POSTGRES_PASSWORD', 'DATABASE_URL'], satisfiable: new Set(['POSTGRES_PASSWORD', 'DATABASE_URL']) })
  // MUTATION: dropping the `satisfiable.has(n)` reclassification in classifyStack turns this red (runnable → needs-secrets)
  assert.equal(ok.status, 'runnable', ok.reason)
  assert.deepEqual(ok.env.external, [])
  assert.ok(ok.env.synthesizable.includes('POSTGRES_PASSWORD')) // secret-named → toolkit may still generate
  assert.ok(ok.env.benign.includes('DATABASE_URL'))             // non-secret-named → compose default runs
  // two-sided: a var the compose does NOT satisfy stays external → needs-secrets
  const bad = classifyStack({ ...base, envNames: ['POSTGRES_PASSWORD', 'DATABASE_URL', 'ADMIN_DATABASE_URL'], satisfiable: new Set(['POSTGRES_PASSWORD', 'DATABASE_URL']) })
  assert.equal(bad.status, 'needs-secrets')
  assert.deepEqual(bad.env.external, ['ADMIN_DATABASE_URL'])
})

check('S8 compose helpers: services break at volumes:; :-/:= honored, :?/:+/bare not; concrete vs pass-through', () => {
  // service names capture first-child-indent keys and BREAK at the zero-indent volumes: block
  assert.deepEqual(composeServiceNames(SELF_CONTAINED_COMPOSE), ['api', 'postgres', 'redis'])
  const ops = [
    'services:', '  api:', '    environment:',
    '      A_SECRET: ${A_SECRET:-x}',
    '      B_SECRET: ${B_SECRET:=y}',
    '      C_URL: ${C_URL:?required}',
    '      D_URL: ${D_URL:+alt}',
    '      E_URL: ${E_URL}', '',
  ].join('\n')
  const dv = composeDefaultedVars(ops)
  assert.ok(dv.has('A_SECRET') && dv.has('B_SECRET'), ':- and := carry a fallback → satisfiable')
  assert.ok(!dv.has('C_URL') && !dv.has('D_URL') && !dv.has('E_URL'), ':? :+ and bare have no fallback → owner-supplied')
  const ca = composeConcreteAssigned(ops)
  assert.ok(ca.has('A_SECRET') && ca.has('B_SECRET'), 'defaulted interpolation strips → concrete')
  assert.ok(!ca.has('C_URL') && !ca.has('D_URL') && !ca.has('E_URL'), 'required/alt/bare interpolation remains → not concrete')
  const lit = 'services:\n  api:\n    environment:\n      - DATABASE_URL=postgresql://u:p@postgres:5432/db\n      - PASSTHRU_URL=${PASSTHRU_URL}\n      EMPTY_URL:\n'
  assert.ok(composeConcreteAssigned(lit).has('DATABASE_URL'), 'literal list-form assignment is concrete')
  assert.ok(!composeConcreteAssigned(lit).has('PASSTHRU_URL'), 'bare interpolation is not concrete')
  assert.ok(!composeConcreteAssigned(lit).has('EMPTY_URL'), 'valueless key (host pass-through) is not concrete')
})

check('S9 CLI self-contained compose (in-compose pg+redis, defaulted creds) → runnable, external=[]', () => {
  const r = mkrepo()
  w(r, 'docker-compose.yml', SELF_CONTAINED_COMPOSE)
  w(r, 'api/requirements.txt', 'fastapi\nuvicorn\n')
  w(r, 'api/main.py', 'app = 1\n')
  const out = cli(r)
  // MUTATION: removing the satisfiable reclassification regresses this to needs-secrets (the cold-run bug)
  assert.equal(out.status, 'runnable', out.reason)
  assert.deepEqual(out.env.external, [])
  assert.equal(out.recipe.kind, 'compose')
  assert.equal(out.webTier.port, 8000)
  assert.ok(out.env.synthesizable.includes('POSTGRES_PASSWORD'))
  assert.ok(/in-compose services: api, postgres, redis/.test(out.reason), out.reason)
  assert.ok(/HTTP-liveness/.test(out.reason), 'runnable reason must state liveness-only verification: ' + out.reason)
})

check('S10 CLI compose with bare ${DATABASE_URL} (external managed DB) → still needs-secrets', () => {
  const r = mkrepo()
  w(r, 'docker-compose.yml', [
    'services:', '  api:', '    build: ./api',
    '    ports:', '      - "8000:8000"',
    '    environment:',
    '      DATABASE_URL: ${DATABASE_URL}',
    '      SESSION_SECRET: ${SESSION_SECRET:-dev}', '',
  ].join('\n'))
  w(r, 'api/requirements.txt', 'fastapi\n')
  w(r, 'api/main.py', 'app = 1\n')
  const out = cli(r)
  assert.equal(out.status, 'needs-secrets', out.reason)
  assert.deepEqual(out.env.external, ['DATABASE_URL'])
  assert.ok(out.env.synthesizable.includes('SESSION_SECRET'))
})

check('S11 CLI cold-run shape: compose-scoped gathering clears scripts-only ADMIN_DATABASE_URL; env_file: falls back', () => {
  // WITH Part B: no env_file → env gathered from the compose alone; the scripts/ ref is not a blocker
  const r = mkrepo()
  w(r, 'docker-compose.yml', SELF_CONTAINED_COMPOSE)
  w(r, 'api/requirements.txt', 'fastapi\n')
  w(r, 'api/main.py', 'app = 1\n')
  w(r, 'scripts/mint.py', 'import os\nu = os.environ.get("ADMIN_DATABASE_URL")\n')
  const out = cli(r)
  assert.equal(out.status, 'runnable', out.reason)
  assert.deepEqual(out.env.external, [])
  // WITHOUT Part B (an env_file: directive forces the union-gathering fallback): the same
  // source ref surfaces as external → needs-secrets (the safe over-flag direction)
  const r2 = mkrepo()
  w(r2, 'docker-compose.yml', SELF_CONTAINED_COMPOSE.replace('    build: ./api', '    build: ./api\n    env_file: .env'))
  w(r2, 'api/requirements.txt', 'fastapi\n')
  w(r2, 'api/main.py', 'app = 1\n')
  w(r2, 'scripts/mint.py', 'import os\nu = os.environ.get("ADMIN_DATABASE_URL")\n')
  const out2 = cli(r2)
  assert.equal(out2.status, 'needs-secrets', out2.reason)
  assert.deepEqual(out2.env.external, ['ADMIN_DATABASE_URL'])
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

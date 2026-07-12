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
 *   S12 CLI env-read follows the recipe: a rung-2-preferred *.prod.yml is what env/
 *       satisfiability classify off, never the dev compose that is NOT stood up
 *   S13 composeEnvFiles + CLI: a referenced env_file ABSENT on disk → needs-secrets
 *       NAMING the file (docker compose config would hard-fail on it); PRESENT → runnable
 *   S14 classifyStack: external-managed DB + no in-compose datastore → the honest
 *       no-DB-in-the-throwaway note; in-compose datastore / non-compose → note absent
 *   A1  composeWebTier via CLI on the Verdict shape → api:8000, not web:3000/db:5432
 *   A2  db-publishes-first not mis-picked (datastore hard-excluded)
 *   A3  port forms parsed: interpolated / long-form target-published / bind-IP
 *   A4  top-score tie → ambiguous + candidates (infer file-order-first, hint --port)
 *   A5  single publisher → picked, not ambiguous (unchanged)
 *   A6  expose-only API + host-published SPA → exposedApiTier + degrade note (two-sided)
 *   A7  zero non-infra host-publishers → port:null (refuse to scan a datastore)
 *   A8  image-based infra exclude (clickhouse image, app-ish name) — two-sided
 *   A9  api-named rescue (database-api / db-gateway survive the infra name filter)
 *   A10 map-form depends_on incoming count fires (breaks a tie list-only would miss)
 *   A11 run-command fingerprint (uvicorn rescues anonymized svc; redis-server stays infra)
 *   B2  detectMigration: alembic / prisma / django / knex / compose-migrate → {tool,command};
 *       none → null; the CLI threads the detected migration onto the classified stack
 *   E1  resolvePythonRun: constructor-grounded ASGI/WSGI/factory/self-launcher; refuse-to-guess
 *   E2  CLI compose-less FastAPI (module-scope ctor) → recipe.run uvicorn main:app
 *   D1  dockerfileStages: ordered FROM…AS names; final = docker's default target; no AS → []
 *   D2  composeBuildTargets: inline + block build forms; context/dockerfile/target read
 *   D3  validateBuildTargets: broken target → fix to the final stage; valid → none;
 *       unreadable Dockerfile / no named stages → diagnosis only (never fabricated)
 *   D4  CLI: a dev compose targeting a stage absent from its Dockerfile →
 *       recipe.buildTargetFixes names the service + the valid final stage; a valid
 *       target → no fixes; a missing Dockerfile → a diagnosis, not a fix
 *   L1  detectCollision pure: match → {colliding, isolatedBy: the FIXED engine-owned
 *       guarantees}; no match / empty / null inputs → null (fail-safe)
 *   L2  composeFixedContainerNames pure: literal names per service; interpolated
 *       (${…}) skipped — not a fixed name; none declared → []
 *   L3  CLI (hermetic docker stub on PATH): a running container matching the compose
 *       fixed container_name → liveCollision emitted, status STILL runnable
 *       (informational, never a block); non-matching running names → no collision
 *   L4  CLI fail-safe: docker ABSENT from PATH, or `docker ps` ERRORING → NO
 *       liveCollision, no crash, status still classifies
 *
 * The pure composeWebTier is tested directly (hermetic); A1 drives the CLI to pin the
 * gatherRecipe → classifyStack threading. The L3/L4 CLI runs control the child PATH
 * (a stub `docker`, or none) so they stay hermetic on any host — including one with a
 * real live stack running. Dependency-free: `node acceptance/test-stack-detect.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  classifyEnvName, classifyStack, composeWebTier, composeWebTierImage, detectMigration, resolvePythonRun,
  composeServiceNames, composeDefaultedVars, composeConcreteAssigned, composeEnvFiles, svcBuild,
  dockerfileStages, composeBuildTargets, validateBuildTargets,
  composeFixedContainerNames, detectCollision, MIRROR_ISOLATION,
} from '../harness/stack-detect.mjs'

const DETECT = fileURLToPath(new URL('../harness/stack-detect.mjs', import.meta.url))
let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`) } }
const mkrepo = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'srt-stackd-'))); dirs.push(d); return d }
const w = (root, rel, body) => { const p = join(root, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, body) }
const cli = (target) => JSON.parse(execFileSync('node', [DETECT, '--target', target, '--json'], { encoding: 'utf8' }))
// The hermetic-PATH variant for the live-collision checks: the child sees ONLY the given
// PATH (a stub-docker dir, or an empty dir = docker absent), and node is invoked by its
// absolute path so the restricted PATH cannot break the CLI itself.
const cliEnv = (target, pathDir) => JSON.parse(execFileSync(process.execPath, [DETECT, '--target', target, '--json'],
  { encoding: 'utf8', env: { ...process.env, PATH: pathDir } }))

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

check('S12 CLI: env/satisfiability classify off the compose ACTUALLY stood up (recipe.file), never the dev compose', () => {
  const r = mkrepo()
  // the dev compose: a benign env surface with a var only IT declares — it is NOT stood up
  w(r, 'docker-compose.yml', [
    'services:', '  api:', '    build: ./api',
    '    ports:', '      - "8000:8000"',
    '    environment:',
    '      DEV_ONLY_API_TOKEN: ${DEV_ONLY_API_TOKEN:-dev}', '',
  ].join('\n'))
  // the prebuilt prod compose (the rung-2 preference pick): a DISTINCT var only IT declares
  w(r, 'docker-compose.prod.yml', [
    'services:', '  api:', '    image: api:1.0',
    '    ports:', '      - "8000:8000"',
    '    environment:',
    '      PROD_SIGNING_SECRET: ${PROD_SIGNING_SECRET:-x}', '',
  ].join('\n'))
  w(r, 'api/requirements.txt', 'fastapi\nuvicorn\n')
  w(r, 'api/main.py', 'app = 1\n')
  const out = cli(r)
  assert.equal(out.status, 'runnable', out.reason)
  assert.ok(out.recipe.file.endsWith('docker-compose.prod.yml'), out.recipe.file)
  // MUTATION: reverting env-gathering to firstExisting(COMPOSE_FILES) (the dev compose)
  // → the prod-only var disappears and the dev-only var reappears (red on both asserts)
  assert.ok(out.env.synthesizable.includes('PROD_SIGNING_SECRET'), 'the stood-up prod compose defines the env surface: ' + JSON.stringify(out.env))
  assert.ok(!JSON.stringify(out.env).includes('DEV_ONLY_API_TOKEN'), 'the dev compose env surface must not classify a prod stand-up: ' + JSON.stringify(out.env))
})

// A prebuilt prod compose referencing an operator env_file. Its OWN env is benign/
// synthesizable only — the present-.env leg below must land runnable for the RIGHT
// reason (an external-cred key here would land needs-secrets for the wrong one).
const PROD_ENVFILE_COMPOSE = [
  'services:',
  '  api:',
  '    image: api:1.0',
  '    env_file: .env',
  '    ports:',
  '      - "8000:8000"',
  '    environment:',
  '      SESSION_SECRET: ${SESSION_SECRET:-dev}',
  '',
].join('\n')

check('S13 composeEnvFiles + CLI: a referenced env_file ABSENT on disk → needs-secrets NAMING the file; PRESENT → runnable', () => {
  // pure helper: short form, list form, none — the same block/inline scanning idiom
  assert.deepEqual(composeEnvFiles('services:\n  api:\n    env_file: .env\n'), ['.env'])
  assert.deepEqual(composeEnvFiles('services:\n  api:\n    env_file:\n      - .env\n      - .env.prod\n'), ['.env', '.env.prod'])
  assert.deepEqual(composeEnvFiles('services:\n  api:\n    image: api:1.0\n'), [])
  const r = mkrepo()
  w(r, 'docker-compose.prod.yml', PROD_ENVFILE_COMPOSE)
  w(r, 'api/requirements.txt', 'fastapi\nuvicorn\n')
  w(r, 'api/main.py', 'app = 1\n')
  // ABSENT: `docker compose config` would hard-fail on the missing .env at stand-up —
  // classify needs-secrets NAMING the file, never a swallowed stand-up death.
  // MUTATION: dropping the existsSync gate on referenced env_files → this classifies runnable (red)
  const absent = cli(r)
  assert.equal(absent.status, 'needs-secrets', absent.reason)
  assert.ok(absent.reason.includes('.env'), 'the reason must NAME the missing env_file: ' + absent.reason)
  // PRESENT (benign + synthesizable keys ONLY — see the fixture note) → runnable
  w(r, '.env', 'PORT=8000\nAPP_JWT_SECRET=x\n')
  const present = cli(r)
  assert.equal(present.status, 'runnable', present.reason)
})

check('S14 classifyStack: external-managed DB + NO in-compose datastore → the honest no-DB note; datastore/non-compose → absent', () => {
  const base = { serverRoots: ['api'], recipe: { kind: 'compose', file: 'docker-compose.yml' }, webTier: { port: 8000 }, envNames: ['DATABASE_URL'] }
  // an external DATABASE_URL and no datastore service: the isolated throwaway has no DB —
  // the reason must say so and steer to rung 1, never leave a doomed stand-up implied fine
  const noDb = classifyStack({ ...base, composeServices: ['api', 'web'] })
  assert.equal(noDb.status, 'needs-secrets')
  // MUTATION: dropping the external-DB note branch → the fragment disappears (red)
  assert.ok(/throwaway has no DB/.test(noDb.reason), noDb.reason)
  assert.ok(/--base-url/.test(noDb.reason), 'the note must steer to rung 1 (an already-running --base-url): ' + noDb.reason)
  // two-sided: an in-compose datastore (the self-contained shape) → note ABSENT
  const withDb = classifyStack({ ...base, composeServices: ['api', 'postgres'] })
  assert.ok(!/throwaway has no DB/.test(withDb.reason), withDb.reason)
  // and a NON-compose recipe never carries the compose-shaped note
  const node = classifyStack({ serverRoots: ['api'], recipe: { kind: 'node' }, webTier: { port: 3000 }, envNames: ['DATABASE_URL'] })
  assert.ok(!/throwaway has no DB/.test(node.reason), node.reason)
})

// ── Compose web-tier selection (Slice A) — the naive first-digit:digit picker scanned
//    the frontend, not the API. composeWebTier scores services, hard-excludes datastores
//    by name AND image, and degrades the label on frontend-only / expose-only shapes. ──

// The grounded Verdict shape: postgres/redis/api publish `${VAR:-N}:N` (the naive regex
// skips them — `}` breaks the digit run), only web publishes a bare `"3000:3000"`, and the
// api carries `command: uvicorn` + map-form depends_on. The old picker landed on web:3000.
const VERDICT_SHAPE_COMPOSE = [
  'services:',
  '  postgres:',
  '    image: postgres:16',
  '    ports:',
  '      - "${POSTGRES_PORT:-5432}:5432"',
  '    environment:',
  '      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-verdict}',
  '  redis:',
  '    image: redis:7',
  '    ports:',
  '      - "${REDIS_PORT:-6379}:6379"',
  '  api:',
  '    build: ./api',
  '    command: uvicorn app.main:app --host 0.0.0.0 --port 8000',
  '    ports:',
  '      - "${API_PORT:-8000}:8000"',
  '    environment:',
  '      DATABASE_URL: postgresql://verdict:${POSTGRES_PASSWORD:-verdict}@postgres:5432/verdict',
  '      REDIS_URL: redis://redis:6379/0',
  '      SECRET_KEY: ${SECRET_KEY:-dev-secret}',
  '    depends_on:',
  '      postgres:',
  '        condition: service_healthy',
  '      redis:',
  '        condition: service_started',
  '  web:',
  '    build: ./web',
  '    ports:',
  '      - "3000:3000"',
  '    depends_on:',
  '      - api',
  'volumes:',
  '  postgres_data:',
  '',
].join('\n')

check('A1 CLI on the Verdict-shape compose → web tier is api:8000, NOT web:3000 or db:5432', () => {
  const r = mkrepo()
  w(r, 'docker-compose.yml', VERDICT_SHAPE_COMPOSE)
  w(r, 'api/requirements.txt', 'fastapi\nuvicorn\n')
  w(r, 'api/main.py', 'app = 1\n')
  const out = cli(r)
  assert.equal(out.status, 'runnable', out.reason)
  assert.equal(out.webTier.port, 8000, `expected api:8000, got ${out.webTier.port} (${out.webTier.service})`)
  assert.equal(out.webTier.service, 'api')
  assert.equal(out.webTier.ambiguous, false)
  // the reason names the picked tier (the honesty label threads through classifyStack)
  assert.ok(/web tier port 8000 \(api\)/.test(out.reason), out.reason)
})

check('A2 db-publishes-first is not mis-picked (datastore hard-excluded before scoring)', () => {
  const wt = composeWebTier(['services:',
    '  db:', '    image: postgres:16', '    ports:', '      - "5432:5432"',
    '  api:', '    ports:', '      - "8000:8000"', ''].join('\n'))
  assert.equal(wt.port, 8000)
  assert.equal(wt.service, 'api')      // NOT db, even though db publishes first in file order
  assert.notEqual(wt.service, 'db')
})

check('A3 port forms parsed: interpolated `${VAR:-N}`, long-form target/published, bind-IP', () => {
  const wt = composeWebTier(['services:',
    '  api:', '    ports:', '      - "${API_PORT:-8000}:8000"',
    '  admin:', '    ports:', '      - target: 9090', '        published: 9090',
    '  metrics:', '    ports:', '      - "127.0.0.1:9100:9100"', ''].join('\n'))
  const byName = Object.fromEntries(wt.candidates.map((c) => [c.service, c.port]))
  assert.equal(byName.api, 8000, 'interpolated ${VAR:-8000}:8000 → 8000')
  assert.equal(byName.admin, 9090, 'long-form target/published → 9090')
  assert.equal(byName.metrics, 9100, 'bind-IP 127.0.0.1:9100:9100 → host 9100')
})

check('A4 top-score tie → ambiguous + candidates (infer file-order-first, tell operator to --port)', () => {
  const wt = composeWebTier(['services:',
    '  api-a:', '    ports:', '      - "8000:8000"',
    '  api-b:', '    ports:', '      - "8001:8001"', ''].join('\n'))
  assert.equal(wt.ambiguous, true)
  assert.equal(wt.port, 8000)          // file-order-first inference
  assert.equal(wt.service, 'api-a')
  assert.equal(wt.candidates.length, 2)
  assert.ok(/api-a:8000/.test(wt.note) && /api-b:8001/.test(wt.note), wt.note)
  assert.ok(/--port/.test(wt.note), 'ambiguous note must tell the operator to pass --port')
})

check('A5 single publisher → picked, not ambiguous (unchanged behavior)', () => {
  const wt = composeWebTier(['services:',
    '  api:', '    ports:', '      - "8000:8000"',
    '  worker:', '    image: python:3.12', ''].join('\n'))
  assert.equal(wt.port, 8000)
  assert.equal(wt.service, 'api')
  assert.equal(wt.ambiguous, false)
  assert.equal(wt.candidates.length, 1)
})

check('A6 expose-only API + host-published SPA → exposedApiTier + degrade note (two-sided)', () => {
  const wt = composeWebTier(['services:',
    '  api:', '    expose:', '      - "8000"',
    '  web:', '    ports:', '      - "3000:3000"', '    depends_on:', '      - api', ''].join('\n'))
  // the SPA is what host-publishes → it wins, but the label must SAY the API was never reached
  assert.equal(wt.service, 'web')
  assert.deepEqual(wt.exposedApiTier, ['api'])
  assert.ok(/api/.test(wt.note) && /expose-only/.test(wt.note), 'note must name the unreachable API: ' + wt.note)
  assert.ok(/not an API scan/.test(wt.note), 'note must state this is a UI/frontend scan')
  // two-sided: no clean/complete claim — the note is a loud, non-empty degrade
  assert.ok(wt.note.length > 0 && !/clean|complete|full(y)? scanned/i.test(wt.note), wt.note)
})

check('A7 zero non-infra host-publishers → port:null (REFUSE — never scan a datastore)', () => {
  const wt = composeWebTier(['services:',
    '  postgres:', '    image: postgres:16', '    ports:', '      - "5432:5432"',
    '  redis:', '    image: redis:7', '    ports:', '      - "6379:6379"', ''].join('\n'))
  assert.equal(wt.port, null)
  assert.equal(wt.service, null)
  assert.ok(/no application web tier is host-published/.test(wt.note), wt.note)
})

check('A8 image-based infra exclude: clickhouse image + app-ish name → excluded (two-sided vs app image)', () => {
  const clickhouse = composeWebTier(['services:',
    '  analytics:', '    image: clickhouse/clickhouse-server:latest', '    ports:', '      - "8123:8123"', ''].join('\n'))
  // MUTATION: dropping the `INFRA_IMAGE.test(image)` clause makes analytics a candidate → port 8123 (red)
  assert.equal(clickhouse.port, null, 'a clickhouse image is infra even with an app-ish service name')
  // two-sided: the SAME app-ish name on a non-datastore image IS a candidate
  const appImage = composeWebTier(['services:',
    '  analytics:', '    image: node:18', '    ports:', '      - "8123:8123"', ''].join('\n'))
  assert.equal(appImage.port, 8123)
  assert.equal(appImage.service, 'analytics')
})

check('A9 api-named rescue survives the infra name filter (database-api / db-gateway)', () => {
  for (const name of ['database-api', 'db-gateway']) {
    const wt = composeWebTier(['services:', `  ${name}:`, '    ports:', '      - "8000:8000"', ''].join('\n'))
    // MUTATION: dropping the `&& !API_NAME.test(name)` rescue → these read as infra → port null (red)
    assert.equal(wt.port, 8000, `${name} must be rescued from the infra name filter`)
    assert.equal(wt.service, name)
  }
})

check('A10 map-form depends_on incoming count fires (breaks a tie the list-only parser would miss)', () => {
  const wt = composeWebTier(['services:',
    '  svca:', '    ports:', '      - "8000:8000"',
    '  svcb:', '    ports:', '      - "8001:8001"',
    '    depends_on:', '      svca:', '        condition: service_started', ''].join('\n'))
  // svcb depends_on svca via MAP form → svca gets +1 incoming → wins; without map-form
  // parsing both score 0 → a tie.
  // MUTATION: making svcDependsOn list-only regresses this to ambiguous:true (red)
  assert.equal(wt.service, 'svca')
  assert.equal(wt.ambiguous, false)
})

check('A11 run-command fingerprint: uvicorn rescues an anonymized svc; a redis-server cmd stays infra-excluded', () => {
  // decisive: svc(uvicorn +3) beats a neutral helper(0); without the fingerprint they tie
  const decisive = composeWebTier(['services:',
    '  svc:', '    command: uvicorn app.main:app --host 0.0.0.0', '    ports:', '      - "8000:8000"',
    '  helper:', '    ports:', '      - "8001:8001"', ''].join('\n'))
  // MUTATION: dropping the WEBSERVER_CMD +3 → svc/helper both score 0 → ambiguous:true (red)
  assert.equal(decisive.service, 'svc')
  assert.equal(decisive.port, 8000)
  assert.equal(decisive.ambiguous, false)
  // fidelity: svc beats an nginx sibling, and a redis-server command stays infra-excluded
  const withInfra = composeWebTier(['services:',
    '  svc:', '    command: uvicorn app.main:app', '    ports:', '      - "8000:8000"',
    '  nginx:', '    image: nginx:latest', '    ports:', '      - "80:80"',
    '  cache:', '    image: redis:7', '    command: redis-server --appendonly yes', '    ports:', '      - "6379:6379"', ''].join('\n'))
  assert.equal(withInfra.service, 'svc')
  assert.ok(!withInfra.candidates.some((c) => c.service === 'cache'), 'a redis-server command does not rescue a datastore from the infra exclude')
})

check('B2 detectMigration: each mechanism → {tool,command}; none → null; CLI threads it onto the stack', () => {
  // pure matrix (PRESENCE only — no file contents)
  assert.deepEqual(detectMigration({ files: ['alembic.ini'] }), { tool: 'alembic', command: 'alembic upgrade head' })
  assert.deepEqual(detectMigration({ files: ['alembic/'] }), { tool: 'alembic', command: 'alembic upgrade head' })
  assert.deepEqual(detectMigration({ files: ['migrations/env.py'] }), { tool: 'alembic', command: 'alembic upgrade head' })
  assert.equal(detectMigration({ files: ['prisma/schema.prisma'] }).tool, 'prisma')
  assert.equal(detectMigration({ files: ['manage.py'] }).tool, 'django')
  assert.equal(detectMigration({ files: ['knexfile.ts'] }).tool, 'knex')
  assert.equal(detectMigration({ composeServices: ['api', 'migrate', 'db'] }).tool, 'compose:migrate')
  assert.equal(detectMigration({ composeServices: ['api', 'flyway'] }).tool, 'compose:flyway')
  // two-sided: no migration signal → null (a plain service name is NOT a migration service)
  assert.equal(detectMigration({ files: [], composeServices: ['api', 'web', 'worker'] }), null)
  assert.equal(detectMigration({}), null)
  // CLI thread: an alembic.ini in the repo surfaces on the classified stack
  const r = mkrepo()
  w(r, 'api/requirements.txt', 'fastapi\n')
  w(r, 'api/main.py', "import os\ndb=os.environ.get('SESSION_SECRET')\napp = 1\n")
  w(r, 'api/alembic.ini', '[alembic]\n')
  const out = cli(r)
  assert.ok(out.migration && out.migration.tool === 'alembic', `migration threaded onto the stack: ${JSON.stringify(out.migration)}`)
})

check('E1 resolvePythonRun: constructor-grounded ASGI/WSGI/factory/self-launcher; refuse to guess', () => {
  // ASGI ctor → uvicorn <module>:<var> (var 'app', NEVER the conventional ':application')
  const fa = resolvePythonRun('main.py', 'from fastapi import FastAPI\napp = FastAPI()\n', 'fastapi\nuvicorn\n')
  assert.deepEqual({ server: fa.server, kind: fa.kind, module: fa.module, var: fa.var }, { server: 'uvicorn', kind: 'asgi', module: 'main', var: 'app' })
  // two-sided: a Flask ctor must NOT route to uvicorn (that crashes at boot). No gunicorn → flask CLI.
  // MUTATION: reverting the ASGI ctor regex flips FastAPI to unsupported (red); a bare `app =` match
  // would route this Flask callable to uvicorn (red on the server assertion).
  const flaskNoG = resolvePythonRun('app.py', 'from flask import Flask\napp = Flask(__name__)\n', 'flask\n')
  assert.equal(flaskNoG.server, 'flask'); assert.equal(flaskNoG.kind, 'wsgi'); assert.equal(flaskNoG.var, 'app')
  assert.equal(resolvePythonRun('app.py', 'app = Flask(__name__)\n', 'flask\ngunicorn\n').server, 'gunicorn')
  // Django get_asgi → var 'application'; but an asgi.py that is FastAPI-shaped → the REAL var 'app'
  assert.equal(resolvePythonRun('asgi.py', 'application = get_asgi_application()\n', 'django\nuvicorn\n').var, 'application')
  assert.equal(resolvePythonRun('asgi.py', 'app = FastAPI()\n', 'fastapi\nuvicorn\n').var, 'app')
  // factory + ASGI deps → --factory; factory + deps that can't disambiguate → unsupported (refuse to guess)
  const fac = resolvePythonRun('main.py', 'def create_app():\n    return FastAPI()\n', 'fastapi\nuvicorn\n')
  assert.equal(fac.factory, 'create_app'); assert.equal(fac.server, 'uvicorn')
  assert.ok(resolvePythonRun('main.py', 'def create_app():\n    ...\n', 'requests\n').unsupported, 'ambiguous-deps factory is unsupported')
  // self-launcher → best-effort python <entry>; nothing resolvable → unsupported
  const self = resolvePythonRun('run.py', "if __name__ == '__main__':\n    app.run(port=5000)\n", 'flask\n')
  assert.equal(self.server, 'self'); assert.equal(self.bestEffort, true)
  assert.ok(resolvePythonRun('x.py', 'x = 1\n', '').unsupported)
  // ASGI framework with NO ASGI server in deps → best-effort (the harness provides uvicorn)
  const noServer = resolvePythonRun('main.py', 'app = FastAPI()\n', 'fastapi\n')
  assert.equal(noServer.bestEffort, true); assert.equal(noServer.provideServer, 'uvicorn')
})

check('E2 CLI: compose-less FastAPI (module-scope ctor, no __main__) → recipe.run uvicorn main:app', () => {
  const r = mkrepo()
  w(r, 'requirements.txt', 'fastapi\nuvicorn\n')
  // module-scope ctor, no __main__ → a bare `python main.py` imports, binds, exits 0 (the failure Slice E fixes)
  w(r, 'main.py', 'from fastapi import FastAPI\napp = FastAPI()\n')
  const out = cli(r)
  assert.equal(out.status, 'runnable', out.reason)
  assert.equal(out.recipe.kind, 'python')
  // MUTATION: reverting resolvePythonRun's ctor detection → main.py unsupported → needs-recipe (red)
  assert.ok(out.recipe.run && out.recipe.run.server === 'uvicorn', `recipe.run resolved: ${JSON.stringify(out.recipe.run)}`)
  assert.equal(out.recipe.run.module, 'main')
  assert.equal(out.recipe.run.var, 'app')
})

// ── Fires-path ladder rung 2 (0.8.109): a prebuilt-image *.prod.yml is PREFERRED over a
//    build-from-source dev compose, so the throwaway stands up with no heavy image build. ──

// A build-from-source dev compose (self-contained env so it classifies runnable on its own).
const DEV_BUILD_COMPOSE = [
  'services:',
  '  api:',
  '    build: ./api',
  '    ports:',
  '      - "8000:8000"',
  '    environment:',
  '      DATABASE_URL: postgresql://verdict:${POSTGRES_PASSWORD:-verdict}@postgres:5432/verdict',
  '      SECRET_KEY: ${SECRET_KEY:-dev-secret}',
  '    depends_on:',
  '      - postgres',
  '  postgres:',
  '    image: postgres:16',
  '    environment:',
  '      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-verdict}',
  'volumes:',
  '  postgres_data:',
  '',
].join('\n')

// The prod compose: the web/api tier ships a PREBUILT `image:` (no build:), plus a prebuilt web SPA.
const PROD_IMAGE_COMPOSE = [
  'services:',
  '  api:',
  '    image: myapp-api:latest',
  '    ports:',
  '      - "8000:8000"',
  '    environment:',
  '      DATABASE_URL: postgresql://verdict:${POSTGRES_PASSWORD:-verdict}@postgres:5432/verdict',
  '      SECRET_KEY: ${SECRET_KEY:-dev-secret}',
  '    depends_on:',
  '      - postgres',
  '  web:',
  '    image: verdict-web:latest',
  '    ports:',
  '      - "3000:3000"',
  '    depends_on:',
  '      - api',
  '  postgres:',
  '    image: postgres:16',
  '    environment:',
  '      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-verdict}',
  'volumes:',
  '  postgres_data:',
  '',
].join('\n')

// A tier declaring BOTH image: AND build: — Compose builds from source and applies the
// image: string as the TAG, so on a clean box the tag is not cached and rung 2's
// "zero build" assumption is false. Never "prebuilt".
const IMAGE_AND_BUILD_COMPOSE = [
  'services:',
  '  api:',
  '    image: api:1.0',
  '    build: ./api',
  '    ports:',
  '      - "8000:8000"',
  '',
].join('\n')

check('C1 composeWebTierImage: prebuilt web tier → prebuilt:true; a build-from-source tier → prebuilt:false', () => {
  const prebuilt = composeWebTierImage(PROD_IMAGE_COMPOSE)
  // MUTATION: dropping svcImage() on the picked tier → prebuilt:false → the preference pass never fires (red)
  assert.equal(prebuilt.prebuilt, true, 'a prod compose whose api tier ships image: is prebuilt')
  assert.equal(prebuilt.service, 'api')          // the scored web/api tier, not web:3000 or postgres
  assert.equal(prebuilt.image, 'myapp-api:latest')
  // two-sided: a build-from-source dev compose's picked tier is NOT prebuilt
  const built = composeWebTierImage(DEV_BUILD_COMPOSE)
  assert.equal(built.prebuilt, false, 'a build: tier resolves no image: → not prebuilt')
  assert.equal(built.service, 'api')
  assert.equal(built.image, null)
  // image: AND build: together = still a build-from-source tier (the image: is the tag
  // Compose applies to the build — not cached on a clean box).
  // MUTATION: dropping the `&& !svcBuild(...)` gate in composeWebTierImage → prebuilt:true here (red)
  const both = composeWebTierImage(IMAGE_AND_BUILD_COMPOSE)
  assert.equal(both.prebuilt, false, 'a tier with BOTH image: and build: is NOT prebuilt')
  assert.equal(both.service, 'api')
  assert.equal(both.image, 'api:1.0')            // the tag is still reported, prebuilt is not claimed
  // svcBuild directly: inline form, block form (context: child), and the image-only negative
  assert.equal(svcBuild(['    build: ./api']), true)
  assert.equal(svcBuild(['    build:', '      context: ./api']), true)
  assert.equal(svcBuild(['    image: api:1.0']), false)
})

check('C2 CLI: BOTH a build dev compose AND a prebuilt-image *.prod.yml → prod PREFERRED, buildsFromSource:false', () => {
  const r = mkrepo()
  w(r, 'docker-compose.yml', DEV_BUILD_COMPOSE)
  w(r, 'docker-compose.prod.yml', PROD_IMAGE_COMPOSE)
  w(r, 'api/requirements.txt', 'fastapi\nuvicorn\n')
  w(r, 'api/main.py', 'app = 1\n')
  const out = cli(r)
  assert.equal(out.status, 'runnable', out.reason)
  assert.equal(out.recipe.kind, 'compose')
  // MUTATION: reverting gatherRecipe to a dev-compose-only search → the prebuilt path is missed →
  // recipe.file is docker-compose.yml and buildsFromSource is true/undefined (RED on both asserts).
  assert.equal(out.recipe.file, 'docker-compose.prod.yml', 'the prebuilt-image prod compose must be preferred')
  assert.equal(out.recipe.buildsFromSource, false, 'the prebuilt path records buildsFromSource:false')
  assert.equal(out.recipe.prebuiltImage, 'myapp-api:latest')
  assert.equal(out.webTier.port, 8000)
  assert.equal(out.webTier.service, 'api')
})

check('C3 CLI: a dev compose alone → dev path, buildsFromSource:true (two-sided, no prod compose)', () => {
  const r = mkrepo()
  w(r, 'docker-compose.yml', DEV_BUILD_COMPOSE)
  w(r, 'api/requirements.txt', 'fastapi\nuvicorn\n')
  w(r, 'api/main.py', 'app = 1\n')
  const out = cli(r)
  assert.equal(out.status, 'runnable', out.reason)
  assert.equal(out.recipe.file, 'docker-compose.yml')
  assert.equal(out.recipe.buildsFromSource, true, 'the build-from-source dev path is not prebuilt')
})

check('C4 CLI: a *.prod.yml whose web tier STILL builds from source → falls through to the dev compose', () => {
  const r = mkrepo()
  w(r, 'docker-compose.yml', DEV_BUILD_COMPOSE)
  // a prod compose that does NOT ship a prebuilt image (api still build:) → NOT preferred
  w(r, 'docker-compose.prod.yml', DEV_BUILD_COMPOSE)
  w(r, 'api/requirements.txt', 'fastapi\nuvicorn\n')
  w(r, 'api/main.py', 'app = 1\n')
  const out = cli(r)
  assert.equal(out.status, 'runnable', out.reason)
  assert.equal(out.recipe.file, 'docker-compose.yml', 'a build-only prod compose does not win the preference')
  assert.equal(out.recipe.buildsFromSource, true)
})

// ── Broken compose `build.target` (mirror robustness): a dev compose targeting a stage
//    its Dockerfile does not declare hard-fails `docker compose build` — the detector must
//    diagnose it and record the fix the disposable mirror can apply (never touch the repo). ──

// A two-stage Dockerfile with NO `development` stage — the grounded defect shape.
const TWO_STAGE_DOCKERFILE = [
  'FROM node:20 AS builder',
  'RUN echo build',
  'FROM node:20-slim AS runtime',
  'COPY --from=builder /tmp /tmp',
  'CMD ["node"]',
  '',
].join('\n')

// A dev compose whose api service targets the absent `development` stage (self-contained
// env, so the broken target is the ONLY defect in the fixture).
const BROKEN_TARGET_COMPOSE = [
  'services:',
  '  api:',
  '    build:',
  '      context: ./api',
  '      target: development',
  '    ports:',
  '      - "8000:8000"',
  '    environment:',
  '      SESSION_SECRET: ${SESSION_SECRET:-seed}',
  '',
].join('\n')

check('D1 dockerfileStages: ordered FROM…AS names; final = docker default target; no AS → []', () => {
  assert.deepEqual(dockerfileStages(TWO_STAGE_DOCKERFILE), ['builder', 'runtime'])
  // the FINAL stage is docker's default build target — what a broken target is overridden to
  assert.equal(dockerfileStages(TWO_STAGE_DOCKERFILE).at(-1), 'runtime')
  // lowercase `as` + --platform tolerated; a stage-as-base FROM without AS is not a stage name
  assert.deepEqual(dockerfileStages('FROM --platform=linux/amd64 alpine:3.20 as base\nFROM base\n'), ['base'])
  assert.deepEqual(dockerfileStages('FROM node:20\nRUN echo hi\n'), [])
  assert.deepEqual(dockerfileStages(''), [])
})

check('D2 composeBuildTargets: inline + block build forms; context/dockerfile/target read; image-only absent', () => {
  const t = ['services:',
    '  api:', '    build:', '      context: ./api', '      dockerfile: Dockerfile.dev', '      target: development',
    '  web:', '    build: ./web', '    ports:', '      - "3000:3000"',
    '  db:', '    image: postgres:16', ''].join('\n')
  assert.deepEqual(composeBuildTargets(t), [
    { service: 'api', context: './api', dockerfile: 'Dockerfile.dev', target: 'development' },
    { service: 'web', context: './web', dockerfile: 'Dockerfile', target: null },
  ])
  // an args: child named `target:` (nested indent) must not read as the build target
  const nested = ['services:', '  api:', '    build:', '      context: ./api',
    '      args:', '        target: not-a-stage', ''].join('\n')
  assert.deepEqual(composeBuildTargets(nested), [{ service: 'api', context: './api', dockerfile: 'Dockerfile', target: null }])
})

check('D3 validateBuildTargets: broken → fix to the final stage; valid → none; unreadable/no-stages → diagnosis only', () => {
  const entries = [{ service: 'api', context: './api', dockerfile: 'Dockerfile', target: 'development' }]
  const stages = ['builder', 'runtime']
  // MUTATION: dropping the stage-existence check → the broken target is not flagged (red)
  const broken = validateBuildTargets(entries, () => stages)
  assert.deepEqual(broken.fixes, [{ service: 'api', badTarget: 'development', validTarget: 'runtime', dockerfile: 'api/Dockerfile', stages }])
  assert.deepEqual(broken.diagnoses, [])
  // a VALID target → no fix (two-sided)
  const valid = validateBuildTargets([{ ...entries[0], target: 'runtime' }], () => stages)
  assert.deepEqual(valid, { fixes: [], diagnoses: [] })
  // no target at all → nothing to validate
  assert.deepEqual(validateBuildTargets([{ ...entries[0], target: null }], () => stages), { fixes: [], diagnoses: [] })
  // an unreadable Dockerfile (stagesFor → null) → a diagnosis, never a fabricated fix
  const unreadable = validateBuildTargets(entries, () => null)
  assert.deepEqual(unreadable.fixes, [])
  assert.equal(unreadable.diagnoses.length, 1)
  assert.match(unreadable.diagnoses[0].reason, /missing or unreadable/)
  // a Dockerfile with NO named stages → no valid stage to override to → diagnosis only
  const noStages = validateBuildTargets(entries, () => [])
  assert.deepEqual(noStages.fixes, [])
  assert.match(noStages.diagnoses[0].reason, /NO named stages/)
  // deterministic: sorted by service regardless of input order
  const two = [{ service: 'web', context: './web', dockerfile: 'Dockerfile', target: 'x' }, entries[0]]
  assert.deepEqual(validateBuildTargets(two, () => stages).fixes.map((f) => f.service), ['api', 'web'])
})

check('D4 CLI: a compose service targeting a stage absent from its Dockerfile → recipe.buildTargetFixes; valid → none; missing Dockerfile → diagnosis', () => {
  const r = mkrepo()
  w(r, 'docker-compose.yml', BROKEN_TARGET_COMPOSE)
  w(r, 'api/Dockerfile', TWO_STAGE_DOCKERFILE)
  w(r, 'api/package.json', JSON.stringify({ name: 'api' }))
  const out = cli(r)
  assert.equal(out.status, 'runnable', out.reason)
  // MUTATION: dropping the stage-existence check in validateBuildTargets → no fix recorded (red)
  assert.ok(Array.isArray(out.recipe.buildTargetFixes), 'the broken target must surface on the recipe: ' + JSON.stringify(out.recipe))
  const f = out.recipe.buildTargetFixes[0]
  assert.equal(f.service, 'api')
  assert.equal(f.badTarget, 'development')
  assert.equal(f.validTarget, 'runtime', 'the fix targets the FINAL stage (docker default)')
  assert.equal(f.dockerfile, 'api/Dockerfile')
  assert.deepEqual(f.stages, ['builder', 'runtime'])
  // two-sided: a VALID target → no fixes, no diagnoses on the recipe
  const r2 = mkrepo()
  w(r2, 'docker-compose.yml', BROKEN_TARGET_COMPOSE.replace('target: development', 'target: runtime'))
  w(r2, 'api/Dockerfile', TWO_STAGE_DOCKERFILE)
  w(r2, 'api/package.json', JSON.stringify({ name: 'api' }))
  const out2 = cli(r2)
  assert.equal(out2.status, 'runnable', out2.reason)
  assert.equal(out2.recipe.buildTargetFixes, undefined, 'a valid target must record no fix')
  assert.equal(out2.recipe.buildTargetDiagnoses, undefined)
  // a MISSING Dockerfile → a diagnosis (cannot validate), never a fabricated fix
  const r3 = mkrepo()
  w(r3, 'docker-compose.yml', BROKEN_TARGET_COMPOSE)
  w(r3, 'api/package.json', JSON.stringify({ name: 'api' }))
  const out3 = cli(r3)
  assert.equal(out3.recipe.buildTargetFixes, undefined, 'no Dockerfile → no fabricated fix')
  assert.equal(out3.recipe.buildTargetDiagnoses.length, 1)
  assert.equal(out3.recipe.buildTargetDiagnoses[0].service, 'api')
  assert.match(out3.recipe.buildTargetDiagnoses[0].reason, /missing or unreadable/)
})

// ── LIVE COLLISION (collision-aware detect): the mirror is fully isolated from a live
//    stack whose fixed container_names match (run-unique project/names/ports/volumes,
//    never-clear-running) — but `runnable` alone never SAID so. The detector must make
//    the collision + the isolation visible, and the docker-ps read must be fail-safe. ──

// The five engine-owned isolation guarantees, pinned VERBATIM: the preflight/gate
// surfacing renders exactly these — a reworded guarantee is drift, not a variant.
const ISOLATED_BY = [
  'run-unique compose project sf-srt-stack-<runId>',
  'container_name rebind to sf-srt-stack-<runId>-<svc>',
  'loopback-ephemeral host publish',
  'volumes !reset (no host binds)',
  'never-clear-running + name-anchored teardown',
]

// A self-contained compose whose api service declares a FIXED container_name (the
// collision surface) — NEUTRAL fixture names, no real partner's. The worker's
// interpolated container_name is deliberately NOT a fixed name (varies by env).
const FIXED_NAME_COMPOSE = [
  'services:',
  '  api:',
  '    build: ./api',
  '    container_name: acme-api',
  '    ports:',
  '      - "8000:8000"',
  '    environment:',
  '      SESSION_SECRET: ${SESSION_SECRET:-dev}',
  '  worker:',
  '    build: ./api',
  '    container_name: ${WORKER_NAME:-acme-worker}',
  '',
].join('\n')

check('L1 detectCollision: match → {colliding, isolatedBy}; no match / empty / null inputs → null (fail-safe)', () => {
  // MUTATION: dropping the collision emit (returning null on a match) reds these
  const hit = detectCollision(['acme-worker', 'acme-api'], ['acme-api', 'acme-worker', 'unrelated'])
  assert.deepEqual(hit.colliding, ['acme-api', 'acme-worker'], 'colliding is sorted + deterministic')
  assert.deepEqual(hit.isolatedBy, ISOLATED_BY, 'isolatedBy is the FIXED engine-owned guarantee list')
  assert.deepEqual([...MIRROR_ISOLATION], ISOLATED_BY, 'MIRROR_ISOLATION is the pinned source of the list')
  assert.ok(Object.isFrozen(MIRROR_ISOLATION), 'the guarantee list is frozen (engine-owned)')
  // partial overlap → only the names actually RUNNING
  assert.deepEqual(detectCollision(['acme-api', 'acme-db'], ['acme-db']).colliding, ['acme-db'])
  // fail-safe nulls: no match; empty either side; null running (= docker ps failed); junk
  assert.equal(detectCollision(['acme-api'], ['other-svc']), null)
  assert.equal(detectCollision([], ['acme-api']), null)
  assert.equal(detectCollision(['acme-api'], []), null)
  assert.equal(detectCollision(['acme-api'], null), null)
  assert.equal(detectCollision(null, ['acme-api']), null)
  assert.equal(detectCollision(undefined, undefined), null)
})

check('L2 composeFixedContainerNames: literal names per service; interpolated skipped; none → []', () => {
  // the interpolated ${WORKER_NAME:-acme-worker} is NOT a fixed name → only acme-api
  assert.deepEqual(composeFixedContainerNames(FIXED_NAME_COMPOSE), ['acme-api'])
  const multi = ['services:',
    '  api:', '    container_name: acme-api',
    '  db:', '    image: postgres:16', '    container_name: "acme-db"', ''].join('\n')
  assert.deepEqual(composeFixedContainerNames(multi), ['acme-api', 'acme-db'])
  // no container_name directives → [] (and the CLI then never invokes docker at all)
  assert.deepEqual(composeFixedContainerNames(SELF_CONTAINED_COMPOSE), [])
  assert.deepEqual(composeFixedContainerNames(''), [])
})

check('L3 CLI (stub docker): a running container matching the fixed container_name → liveCollision, status STILL runnable', () => {
  const r = mkrepo()
  w(r, 'docker-compose.yml', FIXED_NAME_COMPOSE)
  w(r, 'api/requirements.txt', 'fastapi\nuvicorn\n')
  w(r, 'api/main.py', 'app = 1\n')
  // hermetic stub: `docker ps` reports a running acme-api (+ unrelated noise)
  const bin = mkrepo()
  writeFileSync(join(bin, 'docker'), '#!/bin/sh\n[ "$1" = "ps" ] && printf "acme-api\\nunrelated-svc\\n"\nexit 0\n', { mode: 0o755 })
  const out = cliEnv(r, bin)
  // MUTATION: dropping the liveCollision emit (gatherFacts wiring OR the classifyStack
  // ...live spread) reds the liveCollision asserts below while status stays green
  assert.equal(out.status, 'runnable', out.reason) // INFORMATIONAL — the collision never blocks
  assert.ok(out.liveCollision, 'liveCollision must surface on the classified output: ' + JSON.stringify(out.liveCollision))
  assert.deepEqual(out.liveCollision.colliding, ['acme-api'])
  assert.deepEqual(out.liveCollision.isolatedBy, ISOLATED_BY, 'the fixed isolation facts ride the output')
  // two-sided: running containers that do NOT match the fixed names → no collision key
  const bin2 = mkrepo()
  writeFileSync(join(bin2, 'docker'), '#!/bin/sh\n[ "$1" = "ps" ] && printf "other-a\\nother-b\\n"\nexit 0\n', { mode: 0o755 })
  const out2 = cliEnv(r, bin2)
  assert.equal(out2.status, 'runnable', out2.reason)
  assert.equal(out2.liveCollision, undefined, 'non-matching running names must emit NO collision')
})

check('L4 CLI fail-safe: docker ABSENT or `docker ps` ERRORING → NO liveCollision, no crash, status still classifies', () => {
  const r = mkrepo()
  w(r, 'docker-compose.yml', FIXED_NAME_COMPOSE)
  w(r, 'api/requirements.txt', 'fastapi\nuvicorn\n')
  w(r, 'api/main.py', 'app = 1\n')
  // docker ABSENT: the child PATH holds only an empty dir → spawning `docker` ENOENTs
  const empty = mkrepo()
  const absent = cliEnv(r, empty)
  assert.equal(absent.status, 'runnable', absent.reason)
  assert.equal(absent.liveCollision, undefined, 'no docker → no collision claim, never a crash or block')
  // docker ERRORING (daemon-down shape: exit 1, no output) → the same fail-safe null
  const bin = mkrepo()
  writeFileSync(join(bin, 'docker'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  const erroring = cliEnv(r, bin)
  assert.equal(erroring.status, 'runnable', erroring.reason)
  assert.equal(erroring.liveCollision, undefined, 'an erroring docker ps → no collision claim')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

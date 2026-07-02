#!/usr/bin/env node
/**
 * Standing test for harness/standup-stack.mjs — the consented throwaway stand-up
 * (0.7.0 slice 3). Pure planner + safety, hermetic (no docker). The real docker
 * stand-up is validated by an Atlas smoke, not here.
 *
 *   U1  planStandup: runnable node stack → container name, baseUrl, synth env, command
 *   U2  planStandup throws on a non-runnable stack (gate must resolve needs-* first)
 *   U3  planStandup: an as-yet-unsupported recipe (compose) → unsupported (next slice)
 *   U4  stackNames: deterministic + validates the run-id
 *   U5  standupStack FAILS CLOSED without consent
 *   U6  the plan never carries secret VALUES — only the synth env NAMES
 *   U7  needs-secrets stands up ONLY with a filled --env-file
 *   U8  planStandup rejects an invalid port
 *   U9  runnable python stack → copy-in plan (pinned base, pip install + deterministic run)
 *   U10 runnable dockerfile stack → build plan (toolkit-named image the teardown accepts)
 *   U11 the python run command is a pure function of the recipe entry
 *   U12 the python + dockerfile plans carry env NAMES only, never secret values
 *   U13 the kind-agnostic gates (consent, needs-secrets, port) hold for the new kinds
 *
 * Dependency-free: `node acceptance/test-standup-stack.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { planStandup, standupStack, stackNames, STACK_SCHEMA, NAME_PREFIX, PYTHON_BASE } from '../harness/standup-stack.mjs'
import { assertStackName } from '../harness/teardown-stack.mjs'

let pass = 0, fail = 0
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`) } }

const TARGET = '/some/repo'
const TMP = join(tmpdir(), 'sf-srt-stack', 'u1')
const runnable = {
  status: 'runnable', recipe: { kind: 'node', root: 'server', entry: 'index.js' },
  webTier: { port: 8080 }, env: { synthesizable: ['ATLAS_JWT_SECRET', 'ATLAS_API_KEY'], external: [], benign: ['PORT'], unknown: [] },
}
const pyRunnable = {
  status: 'runnable', recipe: { kind: 'python', root: 'api', entry: 'app.py' },
  webTier: { port: 8000 }, env: { synthesizable: ['SESSION_SECRET'], external: [], benign: ['PORT'], unknown: [] },
}
const dfRunnable = {
  status: 'runnable', recipe: { kind: 'dockerfile', root: '.', file: 'Dockerfile' },
  webTier: { port: 9000 }, env: { synthesizable: ['APP_JWT_SECRET'], external: [], benign: ['PORT'], unknown: [] },
}

console.log('standup-stack standing test')

check('U1 planStandup: runnable node stack → container, baseUrl, synth env, command', () => {
  const p = planStandup(runnable, { runId: 'u1', target: TARGET, tmpRoot: TMP, port: 8080 })
  assert.equal(p.schema, STACK_SCHEMA)
  assert.equal(p.container, `${NAME_PREFIX}-u1`)
  assert.equal(p.baseUrl, 'http://127.0.0.1:8080')
  assert.equal(p.host, '127.0.0.1')                       // localhost only — isolation
  assert.equal(p.sourceDir, join(TARGET, 'server'))
  assert.deepEqual(p.synthEnvNames, ['ATLAS_JWT_SECRET', 'ATLAS_API_KEY'])
  assert.match(p.command, /npm install .* && node index\.js/)
  assert.equal(p.benignEnv.PORT, '8080')
})

check('U2 planStandup throws on a non-standable stack', () => {
  assert.throws(() => planStandup({ status: 'needs-secrets' }, { runId: 'u2', target: TARGET, tmpRoot: TMP }), /not standable/)
  assert.throws(() => planStandup({ status: 'needs-recipe' }, { runId: 'u2', target: TARGET, tmpRoot: TMP }), /not standable/)
})

check('U3 planStandup: an as-yet-unsupported recipe (compose) → unsupported (next slice)', () => {
  const p = planStandup({ status: 'runnable', recipe: { kind: 'compose' }, webTier: { port: 3000 }, env: {} }, { runId: 'u3', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u3') })
  assert.equal(p.unsupported, 'compose')
  assert.match(p.reason, /next slice/)
  assert.match(p.reason, /'node'\/'python' \(copy-in\) \+ 'dockerfile' \(build\)/)
  // procfile too — the honest boundary: exactly node/python/dockerfile stand up in this build
  const q = planStandup({ status: 'runnable', recipe: { kind: 'procfile' }, webTier: { port: 3000 }, env: {} }, { runId: 'u3', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u3') })
  assert.equal(q.unsupported, 'procfile')
})

check('U4 stackNames: deterministic + validates run-id', () => {
  const a = stackNames('abc'); const b = stackNames('abc')
  assert.deepEqual(a, b)
  assert.equal(a.container, 'sf-srt-stack-abc')
  assert.ok(a.network.startsWith('sf-srt-net-'))
  for (const bad of ['', '.', '..', 'a/b', 'a b']) assert.throws(() => stackNames(bad), /invalid run-id/)
})

check('U5 standupStack FAILS CLOSED without consent', () => {
  const p = planStandup(runnable, { runId: 'u5', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u5') })
  assert.throws(() => standupStack(p, { consent: false }), /without explicit consent/)
})

check('U6 the plan carries only synth env NAMES, never secret values', () => {
  const p = planStandup(runnable, { runId: 'u6', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u6') })
  const blob = JSON.stringify(p)
  // names present, but no generated 48-hex secret value anywhere in the plan
  assert.ok(blob.includes('ATLAS_JWT_SECRET'))
  assert.ok(!/[0-9a-f]{48}/.test(blob), 'no synthesized secret value should be in the plan')
})

check('U8 planStandup rejects an invalid port (NaN / out of range)', () => {
  for (const bad of ['abc', '0', '70000', '-1']) {
    assert.throws(() => planStandup(runnable, { runId: 'u8', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u8'), port: bad }), /invalid port/)
  }
  assert.equal(planStandup(runnable, { runId: 'u8', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u8'), port: '3000' }).port, 3000)
})

check('U7 needs-secrets stands up ONLY with a filled --env-file (the scaffold-env loop)', () => {
  const needsSecrets = {
    status: 'needs-secrets', recipe: { kind: 'node', root: 'api', entry: 'index.js' },
    webTier: { port: 3000 }, env: { synthesizable: ['SESSION_SECRET'], external: ['DATABASE_URL'], benign: ['PORT'], unknown: [] },
  }
  const tmp = join(tmpdir(), 'sf-srt-stack', 'u7')
  // without an env-file → refused
  assert.throws(() => planStandup(needsSecrets, { runId: 'u7', target: TARGET, tmpRoot: tmp }), /not standable/)
  // with a filled env-file → standable; the plan references the env-file + records the external NAMES (not values)
  const p = planStandup(needsSecrets, { runId: 'u7', target: TARGET, tmpRoot: tmp, envFile: '/tmp/sf-srt-stack/u7/throwaway.env' })
  assert.equal(p.envFile, '/tmp/sf-srt-stack/u7/throwaway.env')
  assert.deepEqual(p.externalEnvNames, ['DATABASE_URL'])
  assert.ok(!JSON.stringify(p).includes('postgres'), 'the plan never carries the external secret VALUE')
})

check('U9 planStandup: runnable python stack → copy-in plan (pinned base, pip install + run)', () => {
  const p = planStandup(pyRunnable, { runId: 'u9', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u9') })
  assert.equal(p.kind, 'python')
  assert.equal(p.baseImage, PYTHON_BASE)
  assert.ok(PYTHON_BASE.includes(':') && !PYTHON_BASE.endsWith(':latest'), 'PYTHON_BASE must be a pinned tag, never :latest')
  assert.match(p.command, /pip install .*requirements\.txt/)
  assert.match(p.command, /&& python app\.py$/)
  assert.equal(p.sourceDir, join(TARGET, 'api'))
  assert.equal(p.port, 8000)
  assert.equal(p.host, '127.0.0.1')                       // localhost-only host publish — isolation
  assert.equal(p.baseUrl, 'http://127.0.0.1:8000')
  assert.deepEqual(p.synthEnvNames, ['SESSION_SECRET'])
  assert.equal(p.benignEnv.PORT, '8000')
  assert.equal(p.benignEnv.HOST, '0.0.0.0')               // the IN-CONTAINER bind; the host publish stays 127.0.0.1
})

check('U10 planStandup: runnable dockerfile stack → build plan (toolkit-named image)', () => {
  const p = planStandup(dfRunnable, { runId: 'u10', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u10') })
  assert.equal(p.kind, 'dockerfile')
  assert.equal(p.image, stackNames('u10').image)
  assert.equal(assertStackName(p.image), p.image)         // teardown's name gate accepts it → the built image gets rmi'd
  assert.equal(p.buildContext, TARGET)
  assert.equal(p.dockerfilePath, join(TARGET, 'Dockerfile'))
  assert.equal(p.port, 9000)
  assert.equal(p.host, '127.0.0.1')
  assert.equal(p.baseUrl, 'http://127.0.0.1:9000')
  // a sub-root recipe: build from the sub-dir, -f the recipe's own Dockerfile path
  const sub = planStandup({ ...dfRunnable, recipe: { kind: 'dockerfile', root: 'svc', file: 'svc/Dockerfile' } }, { runId: 'u10', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u10') })
  assert.equal(sub.buildContext, join(TARGET, 'svc'))
  assert.equal(sub.dockerfilePath, join(TARGET, 'svc', 'Dockerfile'))
})

check('U11 the python run command is a pure function of the recipe entry', () => {
  const cmd = (entry) => planStandup({ ...pyRunnable, recipe: { ...pyRunnable.recipe, entry } }, { runId: 'u11', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u11') }).command
  assert.match(cmd('manage.py'), /&& python manage\.py runserver 0\.0\.0\.0:8000$/)
  assert.match(cmd('asgi.py'), /&& python -m uvicorn asgi:application --host 0\.0\.0\.0 --port 8000$/)
  assert.match(cmd('wsgi.py'), /&& python -m gunicorn --bind 0\.0\.0\.0:8000 wsgi:application$/)
  assert.match(cmd('server.py'), /&& python server\.py$/)
})

check('U12 the python + dockerfile plans carry env NAMES only, never secret values', () => {
  const tmp = join(tmpdir(), 'sf-srt-stack', 'u12')
  const py = planStandup(pyRunnable, { runId: 'u12', target: TARGET, tmpRoot: tmp })
  const df = planStandup(dfRunnable, { runId: 'u12', target: TARGET, tmpRoot: tmp })
  for (const [p, name] of [[py, 'SESSION_SECRET'], [df, 'APP_JWT_SECRET']]) {
    const blob = JSON.stringify(p)
    assert.ok(blob.includes(name), `synth env NAME ${name} present in the ${p.kind} plan`)
    assert.ok(!/[0-9a-f]{48}/.test(blob), 'no synthesized secret value should be in the plan')
  }
  // external creds on a new kind: NAMES in the plan, the VALUE only ever via --env-file
  const ns = { status: 'needs-secrets', recipe: { kind: 'python', root: 'api', entry: 'app.py' }, webTier: { port: 8000 }, env: { synthesizable: [], external: ['DATABASE_URL'], benign: [], unknown: [] } }
  const p = planStandup(ns, { runId: 'u12', target: TARGET, tmpRoot: tmp, envFile: '/tmp/sf-srt-stack/u12/throwaway.env' })
  assert.deepEqual(p.externalEnvNames, ['DATABASE_URL'])
  assert.ok(!JSON.stringify(p).includes('postgres'), 'the plan never carries the external secret VALUE')
})

check('U13 the kind-agnostic gates hold for python + dockerfile (consent, needs-secrets, port)', () => {
  const tmp = join(tmpdir(), 'sf-srt-stack', 'u13')
  // consent: fail-closed for every kind
  assert.throws(() => standupStack(planStandup(pyRunnable, { runId: 'u13', target: TARGET, tmpRoot: tmp }), { consent: false }), /without explicit consent/)
  assert.throws(() => standupStack(planStandup(dfRunnable, { runId: 'u13', target: TARGET, tmpRoot: tmp }), { consent: false }), /without explicit consent/)
  // needs-secrets without a filled --env-file is not standable, regardless of kind
  assert.throws(() => planStandup({ status: 'needs-secrets', recipe: { kind: 'dockerfile', root: '.', file: 'Dockerfile' }, webTier: { port: 9000 }, env: { external: ['DATABASE_URL'] } }, { runId: 'u13', target: TARGET, tmpRoot: tmp }), /not standable/)
  // the invalid-port throw applies to the new kinds too
  assert.throws(() => planStandup(pyRunnable, { runId: 'u13', target: TARGET, tmpRoot: tmp, port: '70000' }), /invalid port/)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

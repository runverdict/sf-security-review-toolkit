#!/usr/bin/env node
/**
 * Standing test for harness/standup-stack.mjs — the consented throwaway stand-up
 * (0.7.0 slice 3). Pure planner + safety, hermetic (no docker). The real docker
 * stand-up is validated by an Atlas smoke, not here.
 *
 *   U1  planStandup: runnable node stack → container name, baseUrl, synth env, command
 *   U2  planStandup throws on a non-runnable stack (gate must resolve needs-* first)
 *   U3  planStandup: the honest unsupported boundary (procfile / unknown; compose is now a plan)
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
 *   U14 compose → needs-config-resolution pre-plan under the toolkit project name
 *   U15 planCompose: the loopback override rebinds the web tier to 127.0.0.1 and strips
 *       every other service's host ports (THE compose isolation boundary)
 *   U16 planCompose REFUSES an ambiguous web service — never guesses
 *   U17 the kind-agnostic gates (consent, needs-secrets, port) hold for compose
 *   U18 the compose plan carries env NAMES only + unsafe service names are refused
 *   U19 planCompose REFUSES network_mode host/container:/service: (modes that bypass
 *       compose port publishing) — and never falsely refuses bridge/default/none/absent
 *   H1  classifyHealthCode: the code map (2xx/401/403/405→up, 5xx→unhealthy, isRoot 404→up)
 *   H2  resolveHealth: up wins; failed / unhealthy / redirect-only / unknown terminal map
 *   H3  standupHealthNote: degrade note present; no clean/healthy/prod-equivalent on non-up
 *   H4  mapDockerHealth: partner's declared HEALTHCHECK honored; empty → HTTP-probe fallthrough
 *   U20 checkEnvFileRunId: matching toolkit path passes; mismatched refuses; custom allowed (fired in planStandup)
 *   U21 classifyPortOwnership: occupied-before + not-ours → refuse (misattribution); ours → ok
 *
 * The live `docker compose config`/`up`/`down` is operator-cold-validated, not
 * CI-hermetic — these tests pin the PURE planCompose (loopback override +
 * refuse-on-ambiguity), which is what regresses silently.
 *
 * Dependency-free: `node acceptance/test-standup-stack.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  planStandup, planCompose, standupStack, stackNames, STACK_SCHEMA, NAME_PREFIX, PYTHON_BASE,
  classifyHealthCode, resolveHealth, mapDockerHealth, standupHealthNote, HEALTH_STATES,
  checkEnvFileRunId, classifyPortOwnership,
} from '../harness/standup-stack.mjs'
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
const composeRunnable = {
  status: 'runnable', recipe: { kind: 'compose', file: 'docker-compose.yml' },
  webTier: { port: 8080 }, env: { synthesizable: ['APP_JWT_SECRET'], external: [], benign: ['PORT'], unknown: [] },
}
// the shape `docker compose config --format json` emits: `target` a number, `published` a string
const composeConfig = {
  services: {
    web: { image: 'node:18-alpine', ports: [{ mode: 'ingress', target: 8080, published: '8080', protocol: 'tcp' }] },
    db: { image: 'postgres:16-alpine', ports: [{ mode: 'ingress', target: 5432, published: '5432', protocol: 'tcp' }] },
    cache: { image: 'redis:7-alpine' },
  },
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

check('U3 planStandup: the honest unsupported boundary (procfile / unknown; compose is now a plan)', () => {
  const p = planStandup({ status: 'runnable', recipe: { kind: 'procfile' }, webTier: { port: 3000 }, env: {} }, { runId: 'u3', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u3') })
  assert.equal(p.unsupported, 'procfile')
  assert.match(p.reason, /'node'\/'python' \(copy-in\), 'dockerfile' \(build\), and 'compose'/)
  const q = planStandup({ status: 'runnable', recipe: {}, webTier: { port: 3000 }, env: {} }, { runId: 'u3', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u3') })
  assert.equal(q.unsupported, 'unknown')
  // compose is NO LONGER unsupported — it returns a real (pre-)plan, not a refusal
  const c = planStandup({ status: 'runnable', recipe: { kind: 'compose', file: 'docker-compose.yml' }, webTier: { port: 3000 }, env: {} }, { runId: 'u3', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u3') })
  assert.equal(c.unsupported, undefined)
  assert.equal(c.kind, 'compose')
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

check('U11 the python run command is a pure function of the recipe (run recipe + legacy fallback)', () => {
  // run-less fallback (Slice E): the legacy entry-name branches still yield the old strings
  const cmd = (entry) => planStandup({ ...pyRunnable, recipe: { ...pyRunnable.recipe, entry } }, { runId: 'u11', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u11') }).command
  assert.match(cmd('manage.py'), /&& python manage\.py runserver 0\.0\.0\.0:8000$/)
  assert.match(cmd('asgi.py'), /&& python -m uvicorn asgi:application --host 0\.0\.0\.0 --port 8000$/)
  assert.match(cmd('wsgi.py'), /&& python -m gunicorn --bind 0\.0\.0\.0:8000 wsgi:application$/)
  assert.match(cmd('server.py'), /&& python server\.py$/)
  // recipe.run drives the exact server command
  const cmdRun = (run) => planStandup({ ...pyRunnable, recipe: { kind: 'python', root: 'api', entry: 'main.py', run } }, { runId: 'u11', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u11') }).command
  assert.match(cmdRun({ server: 'uvicorn', kind: 'asgi', module: 'main', var: 'app' }), /&& python -m uvicorn main:app --host 0\.0\.0\.0 --port 8000$/)
  assert.match(cmdRun({ server: 'uvicorn', kind: 'asgi', module: 'main', factory: 'create_app' }), /&& python -m uvicorn main:create_app --factory --host 0\.0\.0\.0 --port 8000$/)
  assert.match(cmdRun({ server: 'gunicorn', kind: 'wsgi', module: 'app', var: 'app' }), /&& python -m gunicorn --bind 0\.0\.0\.0:8000 app:app$/)
  assert.match(cmdRun({ server: 'flask', kind: 'wsgi', module: 'app', var: 'app' }), /&& python -m flask --app app:app run --host 0\.0\.0\.0 --port 8000$/)
  assert.match(cmdRun({ server: 'self' }), /&& python main\.py$/)
  // a provideServer hint (ASGI framework, no ASGI server in deps) appends a best-effort harness install
  assert.match(cmdRun({ server: 'uvicorn', kind: 'asgi', module: 'main', var: 'app', provideServer: 'uvicorn' }), /pip install --no-input --quiet uvicorn && python -m uvicorn/)
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

check('U14 planStandup: compose → needs-config-resolution pre-plan under the toolkit project name', () => {
  const p = planStandup(composeRunnable, { runId: 'u14', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u14') })
  assert.equal(p.kind, 'compose')
  assert.equal(p.needsConfigResolution, true)               // the pure planner can't run `docker compose config` — the executor completes it
  assert.equal(p.project, stackNames('u14').container)      // sf-srt-stack-u14: the PROJECT carries the run-name…
  assert.equal(assertStackName(p.project), p.project)       // …and the teardown name gate accepts it
  assert.equal(p.host, '127.0.0.1')
  assert.equal(p.baseUrl, 'http://127.0.0.1:8080')          // run-dast/capture-openapi accept loopback only
  assert.equal(p.composeFile, join(TARGET, 'docker-compose.yml'))
  assert.ok(p.overridePath.startsWith(join(tmpdir(), 'sf-srt-stack', 'u14')))
  assert.deepEqual(p.synthEnvNames, ['APP_JWT_SECRET'])
})

check('U15 planCompose: the loopback override rebinds the web tier to 127.0.0.1 and strips every other service (THE compose isolation boundary)', () => {
  const pre = planStandup(composeRunnable, { runId: 'u15', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u15') })
  const p = planCompose(composeConfig, pre)
  assert.equal(p.unsupported, undefined)
  assert.equal(p.webService, 'web')                         // the service publishing the detected web port
  const o = p.overrideContent
  // (a) the web tier is rebound to 127.0.0.1 ONLY, with the REPLACE tag — a plain
  // `ports:` in an override CONCATENATES with the base file and would leave the
  // original 0.0.0.0 publish alive next to ours
  assert.match(o, /web:\n    ports: !override\n      - "127\.0\.0\.1:8080:8080"/)
  assert.ok(!o.includes('0.0.0.0'), 'the override must never publish on 0.0.0.0')
  // (b) EVERY other service loses its host ports (db published 5432 → stripped; the
  // reset must be the REPLACE tag too, for the same merge reason)
  assert.match(o, /db:\n    ports: !reset \[\]/)
  assert.match(o, /cache:\n    ports: !reset \[\]/)
  // the completed plan still points the scanners at loopback
  assert.equal(p.baseUrl, 'http://127.0.0.1:8080')
  assert.equal(p.host, '127.0.0.1')
  // a host:container mismatch keeps the app's own container-side target (8080:3000 → :3000)
  const mm = planCompose({ services: { web: { ports: [{ target: 3000, published: '8080' }] } } }, pre)
  assert.match(mm.overrideContent, /"127\.0\.0\.1:8080:3000"/)
})

check('U16 planCompose REFUSES an ambiguous web service — never guesses', () => {
  const pre = planStandup(composeRunnable, { runId: 'u16', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u16') })
  // two services publish ports, neither matches the detected web port 8080 → REFUSE
  // (a guessed web tier would publish the WRONG service to the host)
  const two = planCompose({ services: {
    api: { ports: [{ target: 3000, published: '3000' }] },
    admin: { ports: [{ target: 9090, published: '9090' }] },
  } }, pre)
  assert.equal(two.unsupported, 'compose')
  assert.match(two.reason, /ambiguous web service — 2 services publish ports, none matches the detected web port 8080/)
  // no publisher at all → equally honest
  const none = planCompose({ services: { worker: { image: 'x' } } }, pre)
  assert.equal(none.unsupported, 'compose')
  assert.match(none.reason, /no compose service publishes a port/)
  // exactly ONE publisher and no port match → that sole publisher IS the web tier (allowed)
  const sole = planCompose({ services: { api: { ports: [{ target: 3000, published: '3000' }] }, worker: { image: 'x' } } }, pre)
  assert.equal(sole.unsupported, undefined)
  assert.equal(sole.webService, 'api')
})

check('U17 the kind-agnostic gates hold for compose (consent, needs-secrets, port)', () => {
  const tmp = join(tmpdir(), 'sf-srt-stack', 'u17')
  // consent: fail-closed for compose too (thrown BEFORE any docker/compose call — hermetic)
  assert.throws(() => standupStack(planStandup(composeRunnable, { runId: 'u17', target: TARGET, tmpRoot: tmp }), { consent: false }), /without explicit consent/)
  // needs-secrets without a filled --env-file is not standable, compose included
  assert.throws(() => planStandup({ status: 'needs-secrets', recipe: { kind: 'compose', file: 'docker-compose.yml' }, webTier: { port: 8080 }, env: { external: ['DATABASE_URL'] } }, { runId: 'u17', target: TARGET, tmpRoot: tmp }), /not standable/)
  // the invalid-port throw applies to compose too
  assert.throws(() => planStandup(composeRunnable, { runId: 'u17', target: TARGET, tmpRoot: tmp, port: '70000' }), /invalid port/)
})

check('U18 the compose plan carries env NAMES only + unsafe service names are refused', () => {
  const pre = planStandup(composeRunnable, { runId: 'u18', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u18') })
  const p = planCompose(composeConfig, pre)
  const blob = JSON.stringify(p)
  assert.ok(blob.includes('APP_JWT_SECRET'), 'synth env NAME present in the compose plan')
  assert.ok(!/[0-9a-f]{48}/.test(blob), 'no synthesized secret value should be in the plan')
  // a service name that could inject lines into the string-templated override → REFUSED
  const evil = planCompose({ services: { 'web:\n    privileged: true\n  x': { ports: [{ target: 8080, published: '8080' }] } } }, pre)
  assert.equal(evil.unsupported, 'compose')
  assert.match(evil.reason, /unsafe compose service name/)
})

check('U19 planCompose REFUSES network_mode host/container:/service: — modes that bypass compose port publishing (the loopback override would be a silent no-op)', () => {
  const pre = planStandup(composeRunnable, { runId: 'u19', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u19') })
  const web = { image: 'node:18-alpine', ports: [{ mode: 'ingress', target: 8080, published: '8080', protocol: 'tcp' }] }
  // (a) a NON-web service on host networking → the whole stand-up is refused: under
  // host networking the app binds the host interface directly, so the generated
  // `ports: !reset []` cannot strip it
  const sidecar = planCompose({ services: { web, metrics: { image: 'prom:v1', network_mode: 'host' } } }, pre)
  assert.equal(sidecar.unsupported, 'compose')
  assert.match(sidecar.reason, /service 'metrics' uses network_mode 'host'.*cannot confine it to 127\.0\.0\.1/)
  // (b) the WEB service itself on host networking while declaring the web port — the
  // guard must hold BEFORE selection, else it gets picked and the `!override` templates
  // a no-op (Compose ignores `ports:` under host networking)
  const webHost = planCompose({ services: { web: { ...web, network_mode: 'host' }, db: { image: 'postgres:16-alpine' } } }, pre)
  assert.equal(webHost.unsupported, 'compose')
  assert.match(webHost.reason, /service 'web' uses network_mode 'host'/)
  // (c) host networking typically declares NO ports at all — the refusal must name the
  // real problem (host networking), never the misleading 'no service publishes a port'
  const noPorts = planCompose({ services: { app: { image: 'x', network_mode: 'host' } } }, pre)
  assert.equal(noPorts.unsupported, 'compose')
  assert.match(noPorts.reason, /service 'app' uses network_mode 'host'/)
  // (d) the other namespace-sharing modes are equally un-confinable
  for (const mode of ['container:api', 'service:api']) {
    const shared = planCompose({ services: { web, worker: { image: 'x', network_mode: mode } } }, pre)
    assert.equal(shared.unsupported, 'compose', `network_mode ${mode} must be refused`)
    assert.match(shared.reason, new RegExp(`service 'worker' uses network_mode '${mode}'`))
  }
  // (e) NO false refusal: absent / bridge / default / none stay inside the port-publishing
  // model the override governs — these must stand up exactly as before
  for (const mode of [undefined, 'bridge', 'default', 'none']) {
    const cache = mode ? { image: 'redis:7-alpine', network_mode: mode } : { image: 'redis:7-alpine' }
    const ok = planCompose({ services: { web, cache } }, pre)
    assert.equal(ok.unsupported, undefined, `network_mode ${mode || '(absent)'} must NOT be refused`)
    assert.equal(ok.webService, 'web')
    assert.match(ok.overrideContent, /"127\.0\.0\.1:8080:8080"/)
    assert.match(ok.overrideContent, /cache:\n    ports: !reset \[\]/)
  }
})

// ── Stand-up health honesty (Slice B1) — the pure seams. The live poll loop is
//    operator-cold-validated (it needs a running container); these pin classifyHealthCode /
//    resolveHealth / mapDockerHealth / standupHealthNote, which are what regress silently. ──

check('H1 classifyHealthCode: the code map (the isRoot correction is load-bearing)', () => {
  assert.equal(classifyHealthCode(200), 'up')
  assert.equal(classifyHealthCode(204), 'up')
  assert.equal(classifyHealthCode(401), 'up')   // auth-guarded == answering
  assert.equal(classifyHealthCode(403), 'up')
  assert.equal(classifyHealthCode(405), 'up')
  assert.equal(classifyHealthCode(500), 'unhealthy')
  assert.equal(classifyHealthCode(503), 'unhealthy')
  // MUTATION: dropping the `isRoot && 3xx/4xx → up` branch regresses a no-root JSON API
  // (FastAPI/Express under /api that 404s on /) to 'retry' → the DAST aborts on a healthy app
  assert.equal(classifyHealthCode(404, { isRoot: true }), 'up')   // 404 on / == the server answers
  assert.equal(classifyHealthCode(302, { isRoot: true }), 'up')
  // two-sided: a NAMED probe path 404 is "try next" (the path is just absent), not up
  assert.equal(classifyHealthCode(404, { isRoot: false }), 'retry')
  assert.equal(classifyHealthCode(0, { isRoot: true }), 'retry')   // 000 down/refused
  assert.equal(classifyHealthCode('000'), 'retry')
})

check('H2 resolveHealth: up wins; failed vs unhealthy vs redirect-only vs unknown', () => {
  assert.equal(resolveHealth({ observedUp: true, containerRunning: true }), HEALTH_STATES.UP)
  // transient 5xx-then-2xx → up (observedUp wins even with observedUnhealthy also set)
  assert.equal(resolveHealth({ observedUp: true, observedUnhealthy: true, containerRunning: true }), HEALTH_STATES.UP)
  assert.equal(resolveHealth({ observedUp: false, containerRunning: false }), HEALTH_STATES.FAILED)
  assert.equal(resolveHealth({ observedUnhealthy: true, containerRunning: true }), HEALTH_STATES.UNHEALTHY)
  assert.equal(resolveHealth({ observedRedirectOnly: true, containerRunning: true }), HEALTH_STATES.REDIRECT_ONLY)
  // ran to the deadline, still running, never answered → unknown (likely the wrong tier/port)
  assert.equal(resolveHealth({ containerRunning: true }), HEALTH_STATES.UNKNOWN)
  // a dead container outranks unhealthy/redirect — it's gone
  assert.equal(resolveHealth({ observedUnhealthy: true, containerRunning: false }), HEALTH_STATES.FAILED)
})

check('H3 standupHealthNote: degrade present; no clean/healthy/prod-equivalent claim on non-up', () => {
  const up = standupHealthNote(HEALTH_STATES.UP)
  assert.match(up, /liveness-verified only/)
  assert.match(up, /readiness NOT asserted/)
  assert.ok(!/\bhealthy\b/i.test(up) && !/\bclean\b/i.test(up), 'the up note must not claim healthy/clean: ' + up)
  const guarded = standupHealthNote(HEALTH_STATES.UP, { guarded: true })
  assert.match(guarded, /auth\/method-guarded/)
  assert.match(guarded, /floor, not a bill of health/)
  for (const st of [HEALTH_STATES.UNHEALTHY, HEALTH_STATES.REDIRECT_ONLY]) {
    const n = standupHealthNote(st)
    assert.match(n, /DEGRADED/)
    assert.ok(!/\bhealthy\b/i.test(n) && !/\bclean\b/i.test(n) && !/production-equivalent/i.test(n), `${st} note must not over-claim: ` + n)
  }
  assert.match(standupHealthNote(HEALTH_STATES.UNKNOWN), /web tier may be wrong|never answered/)
  assert.match(standupHealthNote(HEALTH_STATES.UNKNOWN), /--port/)
  assert.match(standupHealthNote(HEALTH_STATES.UNKNOWN, { saw400: true }), /Host-header|ALLOWED_HOSTS/)
  assert.match(standupHealthNote(HEALTH_STATES.FAILED), /stand-up failed/)
})

check('H4 mapDockerHealth: honors the partner declared HEALTHCHECK; empty → falls through', () => {
  assert.equal(mapDockerHealth('healthy'), 'up')
  assert.equal(mapDockerHealth('unhealthy'), 'unhealthy')
  assert.equal(mapDockerHealth('starting'), 'retry')
  assert.equal(mapDockerHealth(''), '')          // no declared healthcheck → the HTTP probe decides
  assert.equal(mapDockerHealth(null), '')
  assert.equal(mapDockerHealth('HEALTHY'), 'up')  // case-insensitive
})

// ── Run-id integrity + port-collision guards (Slice D). Pure predicates, hermetic. ──

check('U20 checkEnvFileRunId: matching toolkit path passes; mismatched refuses; custom path allowed', () => {
  // matching id (the U7 fixture shape) → no throw
  assert.doesNotThrow(() => checkEnvFileRunId('/tmp/sf-srt-stack/u7/throwaway.env', 'u7'))
  // MUTATION: dropping the `m[1] !== runId` refuse lets an orphaning env-file through (red)
  assert.throws(() => checkEnvFileRunId('/tmp/sf-srt-stack/other/throwaway.env', 'u7'), /belongs to run/)
  // a non-convention custom path → allowed (operator owns its lifecycle); null → allowed
  assert.doesNotThrow(() => checkEnvFileRunId('/home/me/creds.env', 'u7'))
  assert.doesNotThrow(() => checkEnvFileRunId(null, 'u7'))
  // planStandup FIRES it: a mismatched toolkit env-file path is refused at plan time (orphan prevention)
  assert.throws(() => planStandup(
    { status: 'needs-secrets', recipe: { kind: 'node', root: 'api', entry: 'index.js' }, webTier: { port: 3000 }, env: { external: ['DATABASE_URL'] } },
    { runId: 'u20', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u20'), envFile: '/tmp/sf-srt-stack/WRONG/throwaway.env' }), /belongs to run/)
})

check('U21 classifyPortOwnership: occupied-before + not-ours → refuse (misattribution); ours → ok', () => {
  assert.equal(classifyPortOwnership({ freeBefore: true, ownedAfter: true }).ok, true)
  // MUTATION: making the occupied-before-and-not-ours case ok would scan a pre-existing service (red)
  const collide = classifyPortOwnership({ freeBefore: false, ownedAfter: false })
  assert.equal(collide.ok, false)
  assert.match(collide.reason, /misattributed/)
  // free before but our container still didn't own the socket → refuse (don't scan what we don't own)
  assert.equal(classifyPortOwnership({ freeBefore: true, ownedAfter: false }).ok, false)
})

// ── Host-port decoupling (wo-c-standup): the HOST published port is separate from the
//    CONTAINER listen port + compose web-tier selector, so a busy host port can't block a
//    stand-up. The pure planners stay deterministic; the impure executor publishes on an
//    ephemeral 127.0.0.1 host port (validated by the operator cold-run, not here). ──

check('U22 host-port decoupling: planStandup threads a hostPort distinct from the web port; default falls back to webPort', () => {
  const tmp = join(tmpdir(), 'sf-srt-stack', 'u22')
  // no hostPort → the pure-planner default falls back to webPort (baseUrl/port byte-identical to today)
  const def = planStandup(runnable, { runId: 'u22', target: TARGET, tmpRoot: tmp, port: 8080 })
  assert.equal(def.port, 8080)
  assert.equal(def.hostPort, 8080)
  assert.equal(def.baseUrl, 'http://127.0.0.1:8080')
  // a threaded hostPort ≠ webPort: the HOST publish + baseUrl follow hostPort; the CONTAINER
  // side (port, benignEnv.PORT — the app's in-container listen port + the compose selector) keeps webPort
  const p = planStandup(runnable, { runId: 'u22', target: TARGET, tmpRoot: tmp, port: 8080, hostPort: 55555 })
  assert.equal(p.port, 8080, 'container/web/selector port stays webPort')
  assert.equal(p.benignEnv.PORT, '8080', 'the in-container listen port stays webPort')
  assert.equal(p.hostPort, 55555, 'the HOST publish port is the threaded hostPort')
  assert.equal(p.baseUrl, 'http://127.0.0.1:55555', 'baseUrl follows the host port')
  // pointer contract: the manifest scannedPort (= plan.hostPort) MUST equal new URL(baseUrl).port,
  // or run-dast's dastDegrade false-flags the run as "wrong tier"
  assert.equal(String(p.hostPort), new URL(p.baseUrl).port)
  assert.equal(new URL(p.baseUrl).hostname, '127.0.0.1')   // still loopback
  // an invalid threaded host-port is rejected exactly like --port
  assert.throws(() => planStandup(runnable, { runId: 'u22', target: TARGET, tmpRoot: tmp, hostPort: '70000' }), /invalid host-port/)
})

check('U23 host-port decoupling: planCompose templates the override HOST slot from hostPort; container target keeps webPort', () => {
  // default (no hostPort) → the override host slot is the web port (byte-identical to U15)
  const preDef = planStandup(composeRunnable, { runId: 'u23', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u23') })
  const def = planCompose(composeConfig, preDef)
  assert.match(def.overrideContent, /"127\.0\.0\.1:8080:8080"/)
  assert.equal(def.targetPort, 8080)                       // the container-side port the executor reads back on
  // a threaded hostPort ≠ webPort → the override HOST slot uses hostPort; the container-side
  // target stays the web tier's own target (8080); baseUrl follows hostPort
  const pre = planStandup(composeRunnable, { runId: 'u23', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u23'), hostPort: 55555 })
  const p = planCompose(composeConfig, pre)
  assert.match(p.overrideContent, /"127\.0\.0\.1:55555:8080"/)
  assert.ok(!p.overrideContent.includes('0.0.0.0'), 'the override must never publish on 0.0.0.0')
  assert.equal(p.targetPort, 8080)
  assert.equal(p.baseUrl, 'http://127.0.0.1:55555')
  assert.equal(String(p.hostPort), new URL(p.baseUrl).port) // the pointer contract holds for compose too
  // a host:container mismatch keeps the app's own container-side target (8080 published maps to 3000)
  const mm = planCompose({ services: { web: { ports: [{ target: 3000, published: '8080' }] } } }, pre)
  assert.match(mm.overrideContent, /"127\.0\.0\.1:55555:3000"/)
  assert.equal(mm.targetPort, 3000)
  // the ephemeral runtime marker: hostPort 0 → 127.0.0.1:0:<target> (docker assigns a free host port)
  const eph = planCompose(composeConfig, { ...pre, hostPort: 0 })
  assert.match(eph.overrideContent, /"127\.0\.0\.1:0:8080"/)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

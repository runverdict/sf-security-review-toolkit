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
 *   U15 planCompose: the loopback override rebinds the web tier to 127.0.0.1, strips
 *       every other service's host ports, AND resets every service's volumes — no host
 *       bind mount survives into the scanned throwaway (THE compose isolation boundary)
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
 *   U24 composeUpArgs: buildsFromSource:false omits --build (never --no-build);
 *       true/absent keep --build; planStandup threads the recipe flag into the plan
 *   U25 safeComposeConfigError: a missing-env-file stderr surfaces the FILENAME only;
 *       interpolation errors (which echo secret VALUES) and undefined/'' stay null
 *   U26 planCompose merges a buildTargetFixes entry into that service's override block
 *       (`build:` + `target: <validStage>` — the mirror repair, zero partner-file touch);
 *       a clean recipe stays byte-identical; an unsafe stage name is refused;
 *       planStandup threads recipe.buildTargetFixes into the compose pre-plan
 *   U27 renderMirrorFixes: three parts per fix (defect / mirror-only action / partner
 *       fix), diagnoses recorded (no fabrication), deterministic (sorted, no wall clock)
 *   U28 THE PROD-OUTAGE KEY TEST: a partner compose with a FIXED `container_name`
 *       (acme-api) → the loopback override REBINDS every service (web AND others) to
 *       the run-unique toolkit name `sf-srt-stack-<runId>-<svc>`; the fixed name never
 *       survives as the mirror's container name; teardown's name gate accepts every one
 *   U29 planCompose REFUSES a missing/unsafe run-id (never templates an unsafe
 *       container_name); composeContainerName validates both parts
 *   U30 assertRunScopedRemoval: only the two crash-net shapes anchored to THIS run's
 *       own names pass; the outage command (`rm -f` a foreign name), other runs'
 *       names, stop/kill/rmi, and a foreign-project `down` all THROW
 *   U31 safeDockerNameConflictError: the conflict NAME (only) surfaces with the
 *       degrade-not-clear diagnosis; anything else (incl. the stderr tail) stays null
 *   U32 THE BUILT-IMAGE OVERWRITE KEY TEST: a service with BOTH `build:` AND a fixed
 *       `image:` tag (acme-api:latest) → the override rebinds it to the run-unique
 *       throwaway tag `sf-srt-stack-<runId>-<svc>:throwaway`, so `up --build` builds
 *       and tags the toolkit's own image, never the partner's; build-only (no image)
 *       and pulled-image (no build) services get NO image line; a missing/unsafe
 *       run-id refuses (an unsafe image name is never templated)
 *   S1  executor failure path (stub docker, hermetic): `compose up` fails on a name
 *       conflict → status `failed`, the honest diagnosis names the container, and NO
 *       destructive docker command (rm/rmi/stop/kill/down) was issued; the override on
 *       disk carries the run-unique container_name lines; `up` ran under
 *       `-p sf-srt-stack-<runId>`
 *   S2  executor failure path, single-container: `docker create` name-conflict →
 *       `failed`, no destructive docker command (MUTATION: restoring the old pre-create
 *       `docker rm -f` stale-clear turns this red)
 *   S3  executor success path: the declared-HEALTHCHECK read targets the run-unique
 *       container_name (NOT compose's default `<project>-<svc>-1`), and the success
 *       path issues no destructive command either
 *
 * The live `docker compose config`/`up`/`down` is operator-cold-validated, not
 * CI-hermetic — the U-tests pin the PURE planCompose (loopback override +
 * refuse-on-ambiguity), and the S-tests drive the impure executor against a STUB
 * `docker` on PATH (still hermetic: no daemon, no images) to pin the
 * never-destructive-on-failure contract, which is what regresses silently.
 *
 * Dependency-free: `node acceptance/test-standup-stack.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import {
  planStandup, planCompose, standupStack, stackNames, STACK_SCHEMA, NAME_PREFIX, PYTHON_BASE,
  classifyHealthCode, resolveHealth, mapDockerHealth, standupHealthNote, HEALTH_STATES,
  checkEnvFileRunId, classifyPortOwnership, composeUpArgs, safeComposeConfigError, renderMirrorFixes,
  composeContainerName, assertRunScopedRemoval, safeDockerNameConflictError,
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
  // (c) EVERY service — the web tier AND the others — loses its volumes: a prod compose's
  // host bind mounts (a ~/.config credential dir, a root-owned ./data) must never survive
  // into the scanned throwaway.
  // MUTATION: deleting the volumes-reset lines from the override template → these three go red
  assert.match(o, /web:\n    ports: !override\n      - "127\.0\.0\.1:8080:8080"\n    volumes: !reset \[\]/)
  assert.match(o, /db:\n    ports: !reset \[\]\n    volumes: !reset \[\]/)
  assert.match(o, /cache:\n    ports: !reset \[\]\n    volumes: !reset \[\]/)
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

// ── Rung-2 prebuilt honoring + the safe compose-config error surface. The `up` argv and
//    the stderr classifier are pure seams; the live `docker compose up` is operator-cold-
//    validated, not CI-hermetic. ──

check('U24 composeUpArgs: buildsFromSource:false omits --build (never --no-build); true/absent keep --build; planStandup threads it', () => {
  // OMIT --build, do NOT pass --no-build: a clean box has no cached image — omitting lets
  // compose build-if-missing while REUSING a present prebuilt image
  assert.deepEqual(composeUpArgs({ buildsFromSource: false }), ['up', '-d'])
  assert.ok(!composeUpArgs({ buildsFromSource: false }).includes('--no-build'), 'never --no-build (a clean box must still be able to build-if-missing)')
  // MUTATION: flipping the `=== false` condition inverts every deepEqual here (red)
  assert.deepEqual(composeUpArgs({ buildsFromSource: true }), ['up', '-d', '--build'])
  assert.deepEqual(composeUpArgs({}), ['up', '-d', '--build'])   // legacy plan (flag absent) still builds
  assert.deepEqual(composeUpArgs(), ['up', '-d', '--build'])
  // planStandup threads recipe.buildsFromSource into the compose pre-plan, and planCompose's
  // spread carries it into the full plan the executor's `up` reads
  const prebuilt = { ...composeRunnable, recipe: { ...composeRunnable.recipe, file: 'docker-compose.prod.yml', buildsFromSource: false } }
  const pre = planStandup(prebuilt, { runId: 'u24', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u24') })
  assert.equal(pre.buildsFromSource, false, 'the compose pre-plan carries the recipe buildsFromSource flag')
  const p = planCompose(composeConfig, pre)
  assert.equal(p.buildsFromSource, false, 'planCompose completes the plan without dropping the flag')
  assert.deepEqual(composeUpArgs(p), ['up', '-d'])
})

check('U25 safeComposeConfigError: a missing-env-file stderr surfaces the FILENAME; values/unknown/empty stay null', () => {
  const msg = safeComposeConfigError('env file /x/.env not found')
  assert.ok(msg && msg.includes('.env'), 'the safe message names the missing env file: ' + msg)
  // an interpolation error echoes the offending VALUE into stderr — it must NEVER surface.
  // MUTATION: returning the raw stderr unconditionally → the value below leaks (red)
  assert.equal(safeComposeConfigError('invalid interpolation format for DATABASE_URL: "postgres://u:p@h"'), null)
  // the go-toolchain open() shape surfaces too — a FILENAME only
  const open = safeComposeConfigError('open /repo/.env.prod: no such file or directory')
  assert.ok(open && open.includes('.env.prod'), String(open))
  // the same catch swallows JSON.parse failures, which carry no .stderr — undefined/'' → null
  assert.equal(safeComposeConfigError(undefined), null)
  assert.equal(safeComposeConfigError(''), null)
})

// ── Mirror build-target fixes: a compose service targeting a Dockerfile stage that does
//    not exist kills `docker compose build` ("target stage not found"). stack-detect
//    records the fix; planCompose merges it into the loopback override — the disposable
//    MIRROR is repaired, the partner's compose/Dockerfile never touched — and
//    renderMirrorFixes is the partner-facing log of exactly what the mirror needed. ──

check('U26 planCompose merges buildTargetFixes into the override (mirror repair); clean recipe byte-identical; unsafe stage refused', () => {
  const pre = planStandup(composeRunnable, { runId: 'u26', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u26') })
  const clean = planCompose(composeConfig, pre)
  // a fix on the WEB service: its override block gains `build:` + `target: <validStage>`
  // AFTER the ports/volumes isolation lines (Compose V2 map-merge REPLACES the bad target)
  const webFix = [{ service: 'web', badTarget: 'development', validTarget: 'runtime', dockerfile: 'web/Dockerfile', stages: ['builder', 'runtime'] }]
  const p = planCompose(composeConfig, { ...pre, buildTargetFixes: webFix })
  // MUTATION: dropping the fixLines injection in planCompose → no build:/target: lines (red)
  assert.match(p.overrideContent, /web:\n    ports: !override\n      - "127\.0\.0\.1:8080:8080"\n    volumes: !reset \[\]\n    build:\n      target: runtime/)
  // a fix on a NON-web service lands in that service's block, after its reset lines
  const q = planCompose(composeConfig, { ...pre, buildTargetFixes: [{ service: 'db', badTarget: 'development', validTarget: 'runtime' }] })
  assert.match(q.overrideContent, /db:\n    ports: !reset \[\]\n    volumes: !reset \[\]\n    build:\n      target: runtime/)
  assert.ok(!q.overrideContent.split('  db:')[0].includes('build:'), 'the fix lands ONLY on the named service (web block stays fix-free)')
  // a clean recipe (no fixes / empty fixes) → override BYTE-identical to today (U15/U19/U23 hold)
  assert.equal(planCompose(composeConfig, { ...pre, buildTargetFixes: [] }).overrideContent, clean.overrideContent)
  assert.ok(!clean.overrideContent.includes('build:'), 'no fix → no build key in the override')
  // a fix naming a service absent from the resolved config is skipped, not injected
  assert.equal(planCompose(composeConfig, { ...pre, buildTargetFixes: [{ service: 'ghost', badTarget: 'x', validTarget: 'y' }] }).overrideContent, clean.overrideContent)
  // an unsafe stage name could inject structure into the templated override → REFUSED, not escaped
  const evil = planCompose(composeConfig, { ...pre, buildTargetFixes: [{ service: 'web', badTarget: 'dev', validTarget: 'x:\n    privileged: true' }] })
  assert.equal(evil.unsupported, 'compose')
  assert.match(evil.reason, /unsafe Dockerfile stage name/)
  // planStandup threads recipe.buildTargetFixes into the compose pre-plan (the
  // buildsFromSource idiom), and planCompose's spread carries it into the full plan
  const withFix = { ...composeRunnable, recipe: { ...composeRunnable.recipe, buildTargetFixes: webFix } }
  const pre2 = planStandup(withFix, { runId: 'u26', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u26') })
  assert.deepEqual(pre2.buildTargetFixes, webFix, 'the compose pre-plan carries the recipe fixes')
  const full = planCompose(composeConfig, pre2)
  assert.deepEqual(full.buildTargetFixes, webFix)
  assert.match(full.overrideContent, /build:\n      target: runtime/)
})

check('U27 renderMirrorFixes: defect / mirror-only action / partner fix per entry; diagnoses honest; deterministic', () => {
  const fixes = [
    { service: 'web', badTarget: 'production', validTarget: 'runtime', dockerfile: 'web/Dockerfile', stages: ['builder', 'runtime'] },
    { service: 'api', badTarget: 'development', validTarget: 'runtime', dockerfile: 'api/Dockerfile', stages: ['builder', 'runtime'] },
  ]
  const md = renderMirrorFixes({ fixes })
  // (a) the DEFECT names the service, the bad target, the Dockerfile, and its REAL stages
  assert.match(md, /service `api` targets build stage `development`, absent from `api\/Dockerfile` \[stages: builder, runtime\]/)
  // (b) what the MIRROR did — override-only, the real code untouched (stated verbatim)
  assert.match(md, /overrode `build\.target` → `runtime` in the disposable mirror ONLY — your real code was NOT modified/)
  // (c) the PARTNER FIX names the real-repo change (add the stage, or retarget the compose)
  assert.match(md, /in your real repo, add a `development` stage to `api\/Dockerfile`, or set the compose `build\.target` to `runtime`/)
  // the proof-of-untouched statement covers the whole artifact
  assert.match(md, /no compose file, Dockerfile,\nor source file in this repository was modified/)
  // deterministic: sorted by service (api before web), order-insensitive, no wall clock
  assert.ok(md.indexOf('service `api`') < md.indexOf('service `web`'), 'sections sorted by service')
  assert.equal(md, renderMirrorFixes({ fixes: [...fixes].reverse() }), 'input order must not change the artifact')
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(md), 'no wall clock in the pure artifact')
  // MUTATION: dropping any of the three parts from the fix section turns (a)/(b)/(c) red
  // a diagnosis (no honest fix) is recorded — nothing fabricated, the degrade is named
  const diag = renderMirrorFixes({ diagnoses: [{ service: 'api', target: 'development', dockerfile: 'api/Dockerfile', reason: "build target 'development' is not a stage and the Dockerfile declares NO named stages — no valid stage exists to override to" }] })
  assert.match(diag, /could not be validated or fixed/)
  assert.match(diag, /no honest override exists — nothing was fabricated/)
  assert.match(diag, /degrades with its real failure status/)
  assert.match(diag, /PARTNER FIX: in your real repo, make `api\/Dockerfile` declare the stage `development`/)
})

// ── Container-name collision (the prod-outage fix). A partner compose that hard-codes
//    `container_name:` OVERRIDES Docker Compose's project-based naming, so the mirror's
//    containers would collide with — and be mistaken for — the partner's LIVE stack of
//    the same name. The override must rebind EVERY service to a run-unique toolkit
//    name, and the executor must NEVER clear anything on failure. ──

check('U28 KEY: a fixed partner container_name (acme-api) is REBOUND to the run-unique toolkit name on EVERY service', () => {
  const pre = planStandup(composeRunnable, { runId: 'u28', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u28') })
  // neutral fixture for "a partner's fixed container_name" — the web tier AND a non-web service
  const namedConfig = {
    services: {
      web: { image: 'node:18-alpine', container_name: 'acme-api', ports: [{ mode: 'ingress', target: 8080, published: '8080', protocol: 'tcp' }] },
      worker: { image: 'node:18-alpine', container_name: 'acme-worker' },
    },
  }
  const p = planCompose(namedConfig, pre)
  assert.equal(p.unsupported, undefined)
  const o = p.overrideContent
  // MUTATION: dropping the `container_name:` line from the override template turns
  // every assertion below red — the mirror would again collide with a live stack
  // (a) the WEB service is pinned to the run-unique toolkit name (after the isolation lines)
  assert.match(o, /web:\n    ports: !override\n      - "127\.0\.0\.1:8080:8080"\n    volumes: !reset \[\]\n    container_name: sf-srt-stack-u28-web\n/)
  // (b) a NON-web (`others`) service is pinned too
  assert.match(o, /worker:\n    ports: !reset \[\]\n    volumes: !reset \[\]\n    container_name: sf-srt-stack-u28-worker\n/)
  // (c) the partner's fixed names are NOT the mirror's container names — the override
  // scalar REPLACES the base file's container_name under Compose V2 merge, and the
  // generated override never even mentions them
  assert.ok(!o.includes('acme-api') && !o.includes('acme-worker'), 'the fixed partner container_name must never survive into the mirror override')
  // (d) EVERY service in the config gets a container_name line, run-scoped + toolkit-prefixed
  const lines = o.split('\n').filter((l) => l.trim().startsWith('container_name:'))
  assert.equal(lines.length, Object.keys(namedConfig.services).length, 'container_name is set for EVERY service')
  for (const l of lines) {
    assert.match(l, /^    container_name: sf-srt-stack-u28-[A-Za-z0-9][A-Za-z0-9._-]*$/, 'run-scoped (contains the runId) + toolkit-prefixed (sf-srt-stack-)')
  }
  // (e) teardown's name gate accepts every pinned name (sweep/NAME_OK recognize the form)
  assert.equal(assertStackName('sf-srt-stack-u28-web'), 'sf-srt-stack-u28-web')
  assert.equal(assertStackName('sf-srt-stack-u28-worker'), 'sf-srt-stack-u28-worker')
  // (f) the names sit under the toolkit-scoped compose PROJECT (`-p sf-srt-stack-<runId>`,
  // the same run-name the executor passes on `config`/`up`/`port`/`ps` — see S1/S3)
  assert.ok(`sf-srt-stack-u28-web`.startsWith(p.project + '-'), 'container names extend the project run-name')
  // (g) a compose WITHOUT any fixed container_name still gets every service pinned
  //     (project naming alone is not collision-proof against a same-name toolkit leftover)
  const plain = planCompose(composeConfig, pre)
  const plainLines = plain.overrideContent.split('\n').filter((l) => l.trim().startsWith('container_name:'))
  assert.equal(plainLines.length, Object.keys(composeConfig.services).length)
  assert.match(plain.overrideContent, /db:\n    ports: !reset \[\]\n    volumes: !reset \[\]\n    container_name: sf-srt-stack-u28-db\n/)
  // (h) deterministic given (config, prePlan)
  assert.equal(planCompose(namedConfig, pre).overrideContent, o)
})

check('U29 planCompose REFUSES a missing/unsafe run-id — an unsafe container_name is never templated', () => {
  const pre = planStandup(composeRunnable, { runId: 'u29', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u29') })
  // MUTATION: dropping the run-id gate templates `sf-srt-stack-undefined-web` (or an
  // injection) into the override instead of refusing — these go red
  for (const bad of [undefined, null, '', 'u29 bad', 'a/b', '-x', 'x\ny']) {
    const r = planCompose(composeConfig, { ...pre, runId: bad })
    assert.equal(r.unsupported, 'compose', `run-id ${JSON.stringify(bad)} must be refused`)
    assert.match(r.reason, /missing or unsafe run-id/)
    assert.equal(r.overrideContent, undefined, 'no override is templated on refusal')
  }
  // composeContainerName validates BOTH parts and never returns an unsafe name
  assert.equal(composeContainerName('u29', 'web'), 'sf-srt-stack-u29-web')
  assert.throws(() => composeContainerName('a b', 'web'), /invalid run-id/)
  assert.throws(() => composeContainerName('', 'web'), /invalid run-id/)
  assert.throws(() => composeContainerName('u29', 'w eb'), /unsafe service name/)
  assert.throws(() => composeContainerName('u29', ''), /unsafe service name/)
})

check('U30 assertRunScopedRemoval: only THIS run\'s own crash-net shapes pass — the outage command throws', () => {
  // the two sanctioned crash-net shapes, anchored to this run's own names
  assert.deepEqual(assertRunScopedRemoval(['rm', '-f', 'sf-srt-stack-u30'], 'u30'), ['rm', '-f', 'sf-srt-stack-u30'])
  assert.deepEqual(
    assertRunScopedRemoval(['compose', '-p', 'sf-srt-stack-u30', '--env-file', '/tmp/x.env', '-f', 'a.yml', '-f', 'b.yml', 'down', '-v', '--remove-orphans'], 'u30'),
    ['compose', '-p', 'sf-srt-stack-u30', '--env-file', '/tmp/x.env', '-f', 'a.yml', '-f', 'b.yml', 'down', '-v', '--remove-orphans'])
  // MUTATION: loosening the guard to a prefix/any-name match lets these through — red
  assert.throws(() => assertRunScopedRemoval(['rm', '-f', 'acme-api'], 'u30'), /refusing destructive docker command/) // THE outage command
  assert.throws(() => assertRunScopedRemoval(['rm', '-f', 'sf-srt-stack-OTHER'], 'u30'), /refusing/)                  // another run's container
  assert.throws(() => assertRunScopedRemoval(['rm', '-f', 'sf-srt-stack-u30', 'acme-api'], 'u30'), /refusing/)        // no smuggling a foreign name alongside ours
  assert.throws(() => assertRunScopedRemoval(['rm', '-f'], 'u30'), /refusing/)                                        // rm with no names
  assert.throws(() => assertRunScopedRemoval(['stop', 'sf-srt-stack-u30'], 'u30'), /refusing/)                        // unsanctioned verbs — even on our own name
  assert.throws(() => assertRunScopedRemoval(['kill', 'sf-srt-stack-u30'], 'u30'), /refusing/)
  assert.throws(() => assertRunScopedRemoval(['rmi', '-f', 'sf-srt-stack-u30:throwaway'], 'u30'), /refusing/)
  assert.throws(() => assertRunScopedRemoval(['compose', '-p', 'acme', 'down'], 'u30'), /refusing/)                   // foreign project down
  assert.throws(() => assertRunScopedRemoval(['compose', '-p', 'sf-srt-stack-u30', 'rm', '-f'], 'u30'), /refusing/)   // compose verbs other than down
  assert.throws(() => assertRunScopedRemoval(['rm', '-f', 'sf-srt-stack-u30'], ''), /invalid run-id/)                 // no run-id, no destruction
})

check('U31 safeDockerNameConflictError: the conflict NAME surfaces with the degrade-not-clear diagnosis; nothing else leaks', () => {
  const stderr = 'docker: Error response from daemon: Conflict. The container name "/acme-api" is already in use by container "1f2e3d4c5b6a". You have to remove (or rename) that container to be able to reuse that name.'
  const msg = safeDockerNameConflictError(stderr)
  assert.ok(msg && msg.includes("'acme-api'"), 'the conflicting container is NAMED: ' + msg)
  assert.match(msg, /will NOT stop or remove it/, 'the degrade-not-clear doctrine is stated verbatim')
  assert.match(msg, /teardown-stack\.mjs/, 'removal is routed to the separate name-anchored teardown')
  // MUTATION: returning raw stderr leaks the container ID / the "remove that container"
  // instruction that primed the outage improvisation — red
  assert.ok(!msg.includes('1f2e3d4c5b6a'), 'the container ID must not surface')
  assert.ok(!/You have to remove/.test(msg), 'docker\'s own "remove it" advice must not surface')
  // anything not the known-safe shape stays null
  assert.equal(safeDockerNameConflictError('some other failure: postgres://u:p@h leaked'), null)
  assert.equal(safeDockerNameConflictError(undefined), null)
  assert.equal(safeDockerNameConflictError(''), null)
})

// ── Built-image overwrite (the general partner case). A service with BOTH a `build:`
//    directive AND a fixed `image:` tag makes `up --build` build and TAG the result as
//    that fixed name — silently overwriting the partner's REAL image on the shared
//    docker daemon (the shared-resource mutation class the mirror exists to avoid).
//    The override must rebind exactly those services to a run-unique throwaway tag,
//    and ONLY those: a pulled image (image, no build) must stay untouched. ──

check('U32 KEY: a build+image service (fixed acme-api:latest) is rebound to the run-unique throwaway image; build-only + pulled-image services get NO image line', () => {
  const pre = planStandup(composeRunnable, { runId: 'u32', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u32') })
  // neutral fixture: web BUILDS from source AND pins a fixed tag (the overwrite risk);
  // builder BUILDS with no image (compose auto-names it); db is a PULLED image
  const cfg = {
    services: {
      web: { build: { context: './api', dockerfile: 'Dockerfile' }, image: 'acme-api:latest', ports: [{ mode: 'ingress', target: 8080, published: '8080', protocol: 'tcp' }] },
      builder: { build: { context: './worker', dockerfile: 'Dockerfile' } },
      db: { image: 'postgres:16-alpine' },
    },
  }
  const p = planCompose(cfg, pre)
  assert.equal(p.unsupported, undefined)
  const o = p.overrideContent
  // (a) KEY: the build+image service is rebound to the run-unique throwaway tag —
  // `up --build` builds and tags the TOOLKIT's own image, never the partner's.
  // MUTATION: dropping the imageLines injection from the override template → red
  assert.match(o, /web:\n    ports: !override\n      - "127\.0\.0\.1:8080:8080"\n    volumes: !reset \[\]\n    image: sf-srt-stack-u32-web:throwaway\n    container_name: sf-srt-stack-u32-web\n/)
  // (b) the partner's fixed tag is NOT the mirror's image — the override scalar REPLACES
  // the base file's `image:` under Compose V2 merge, and the generated override never
  // even mentions it
  assert.ok(!o.includes('acme-api'), 'the fixed partner image tag must never survive as the mirror\'s image')
  // (c) a BUILD-ONLY service (no image) gets NO image line: compose already auto-names
  // it `<project>-<svc>` under the run-scoped project — no partner image to clobber
  assert.match(o, /builder:\n    ports: !reset \[\]\n    volumes: !reset \[\]\n    container_name: sf-srt-stack-u32-builder\n/)
  // (d) a PULLED image (image, no build) is left exactly as-is: `up --build` never
  // rebuilds it, and overriding it would break the pull.
  // MUTATION: broadening the override to every image-carrying service → red
  assert.match(o, /db:\n    ports: !reset \[\]\n    volumes: !reset \[\]\n    container_name: sf-srt-stack-u32-db\n/)
  assert.ok(!o.includes('postgres'), 'the pulled image is neither overridden nor mentioned')
  // (e) EXACTLY the build+image service carries an image override (scoping, both sides)
  const imgLines = o.split('\n').filter((l) => l.trim().startsWith('image:'))
  assert.deepEqual(imgLines, ['    image: sf-srt-stack-u32-web:throwaway'], 'the image override is scoped to build+image services ONLY')
  // (f) a missing/unsafe run-id REFUSES — an unsafe image name is never templated
  // (the same RUN_ID_OK gate the container_name rebind rides on)
  for (const bad of [undefined, null, '', 'u32 bad', 'a/b']) {
    const r = planCompose(cfg, { ...pre, runId: bad })
    assert.equal(r.unsupported, 'compose', `run-id ${JSON.stringify(bad)} must be refused`)
    assert.match(r.reason, /missing or unsafe run-id/)
    assert.equal(r.overrideContent, undefined, 'no override — hence no image line — is templated on refusal')
  }
  // (g) deterministic given (config, prePlan); a config with no build+image service
  // (U15's pulled-image fixture) templates no image line at all — the override shape
  // for every existing fixture is unchanged
  assert.equal(planCompose(cfg, pre).overrideContent, o)
  const plain = planCompose(composeConfig, pre)
  assert.equal(plain.overrideContent.split('\n').filter((l) => l.trim().startsWith('image:')).length, 0, 'an image-only (pulled) config templates no image line at all')
})

// ── S-tests: the impure executor against a STUB docker on PATH (hermetic — no daemon).
//    What they pin: the failure path DEGRADES and never issues a destructive docker
//    command, and the health read targets the run-unique container_name. ──

const stubEnv = (script, config) => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-srt-stub-'))
  writeFileSync(join(dir, 'docker'), script, { mode: 0o755 })
  const logFile = join(dir, 'docker-log.txt')
  writeFileSync(logFile, '')
  if (config) writeFileSync(join(dir, 'config.json'), JSON.stringify(config))
  return { dir, logFile, configFile: join(dir, 'config.json') }
}
const DESTRUCTIVE = (line) => {
  const t = line.trim().split(/\s+/)
  return ['rm', 'rmi', 'stop', 'kill'].includes(t[0]) || (t[0] === 'compose' && t.includes('down')) || t.includes('down')
}
const withStub = ({ script, config }, fn) => {
  const stub = stubEnv(script, config)
  const target = mkdtempSync(join(tmpdir(), 'sf-srt-tgt-'))
  const oldPath = process.env.PATH
  process.env.PATH = `${stub.dir}:${oldPath}`
  process.env.SRT_DOCKER_LOG = stub.logFile
  process.env.SRT_COMPOSE_CONFIG = stub.configFile
  try { return fn({ ...stub, target }) }
  finally {
    process.env.PATH = oldPath
    delete process.env.SRT_DOCKER_LOG; delete process.env.SRT_COMPOSE_CONFIG
    rmSync(stub.dir, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true })
  }
}
// the resolved-config shape for the stub `docker compose config` — a partner with a
// FIXED container_name on the web tier (the adversarial collision fixture)
const stubConfig = {
  services: {
    web: { container_name: 'acme-api', ports: [{ mode: 'ingress', target: 8080, published: '8080', protocol: 'tcp' }] },
    worker: { container_name: 'acme-worker', image: 'node:18-alpine' },
  },
}
const stubScript = (composeUp, extra = '') => `#!/bin/sh
[ -n "$SRT_DOCKER_LOG" ] && echo "$*" >> "$SRT_DOCKER_LOG"
case "$1" in
  info) exit 0 ;;
${extra}  compose)
    for a in "$@"; do case "$a" in
      version) exit 0 ;;
      config) cat "$SRT_COMPOSE_CONFIG"; exit 0 ;;
      up) ${composeUp} ;;
      port) echo "127.0.0.1:49321"; exit 0 ;;
    esac; done
    exit 0 ;;
  *) exit 0 ;;
esac
`

check('S1 compose `up` fails on a name conflict → failed + honest diagnosis + ZERO destructive docker commands', () => {
  const conflict = `echo 'docker: Error response from daemon: Conflict. The container name "/acme-api" is already in use by container "1f2e3d4c5b6a". You have to remove (or rename) that container to be able to reuse that name.' >&2; exit 1`
  withStub({ script: stubScript(conflict), config: stubConfig }, ({ logFile, target }) => {
    const tmp = join(tmpdir(), 'sf-srt-stack', 's1run')
    const plan = planStandup(composeRunnable, { runId: 's1run', target, tmpRoot: tmp })
    const m = standupStack(plan, { consent: true, target, timeoutMs: 2000 })
    try {
      assert.equal(m.status, 'failed', 'a colliding stand-up DEGRADES to failed')
      // the honest diagnosis: the container is NAMED and explicitly not touched
      assert.match(m.log, /a container named 'acme-api' already exists and may be a live stack/)
      assert.match(m.log, /will NOT stop or remove it/)
      // THE contract: no destructive docker command was issued on the failure path.
      // MUTATION: any `rm`/`stop`/`kill`/`compose … down` "cleanup" reaction → red
      const lines = readFileSync(logFile, 'utf8').split('\n').filter(Boolean)
      assert.ok(lines.length > 0, 'the stub docker was exercised')
      assert.deepEqual(lines.filter(DESTRUCTIVE), [], 'the failure path must issue NO destructive docker command')
      // the compose PROJECT is toolkit-run-scoped on the actual `up` argv
      const up = lines.find((l) => l.split(/\s+/).includes('up'))
      assert.ok(up && /-p sf-srt-stack-s1run\b/.test(up), '`up` runs under -p sf-srt-stack-<runId>: ' + up)
      // the override on disk pinned the run-unique container_name for every service
      const override = readFileSync(plan.overridePath, 'utf8')
      assert.match(override, /container_name: sf-srt-stack-s1run-web/)
      assert.match(override, /container_name: sf-srt-stack-s1run-worker/)
      assert.ok(!override.includes('acme-api'), 'the partner fixed name never reaches the mirror override')
    } finally { rmSync(tmp, { recursive: true, force: true }) }
  })
})

check('S2 single-container `create` name-conflict → failed, NO destructive command (the old pre-create rm -f stale-clear is GONE)', () => {
  const createFail = `  create) echo 'docker: Error response from daemon: Conflict. The container name "/sf-srt-stack-s2run" is already in use by container "9a8b7c6d".' >&2; exit 1 ;;\n`
  withStub({ script: stubScript('exit 0', createFail) }, ({ logFile, target }) => {
    const tmp = join(tmpdir(), 'sf-srt-stack', 's2run')
    const plan = planStandup(runnable, { runId: 's2run', target, tmpRoot: tmp })
    const m = standupStack(plan, { consent: true, target, timeoutMs: 2000 })
    try {
      assert.equal(m.status, 'failed')
      assert.match(m.log, /a container named 'sf-srt-stack-s2run' already exists/)
      assert.match(m.log, /will NOT stop or remove it/)
      // MUTATION: restoring the old `quiet('docker', ['rm', '-f', plan.container])`
      // pre-create stale-clear puts an `rm` line in the log → red. A same-name conflict
      // now degrades honestly; only the separate name-anchored teardown removes residue.
      const lines = readFileSync(logFile, 'utf8').split('\n').filter(Boolean)
      assert.ok(lines.some((l) => l.startsWith('create ')), 'the create was attempted')
      assert.deepEqual(lines.filter(DESTRUCTIVE), [], 'no rm/stop/kill/down — before create OR as a failure reaction')
    } finally { rmSync(tmp, { recursive: true, force: true }) }
  })
})

check('S3 success path: the declared-HEALTHCHECK read targets the run-unique container_name, not `<project>-<svc>-1`', () => {
  const inspectHealthy = `  inspect) echo "healthy"; exit 0 ;;\n`
  withStub({ script: stubScript('exit 0', inspectHealthy), config: stubConfig }, ({ logFile, target }) => {
    const tmp = join(tmpdir(), 'sf-srt-stack', 's3run')
    const plan = planStandup(composeRunnable, { runId: 's3run', target, tmpRoot: tmp })
    const m = standupStack(plan, { consent: true, target, timeoutMs: 5000 })
    try {
      assert.equal(m.status, 'up', 'the declared HEALTHCHECK (stub: healthy) drives the up status')
      assert.equal(m.baseUrl, 'http://127.0.0.1:49321', 'baseUrl follows the read-back ephemeral host port')
      const lines = readFileSync(logFile, 'utf8').split('\n').filter(Boolean)
      // MUTATION: reverting the health read to compose's default `<project>-<web>-1`
      // (which the container_name pin makes nonexistent) → red
      const inspect = lines.find((l) => l.startsWith('inspect '))
      assert.ok(inspect && / sf-srt-stack-s3run-web$/.test(inspect), 'inspect targets the pinned run-unique name: ' + inspect)
      assert.ok(!lines.some((l) => l.includes('sf-srt-stack-s3run-web-1')), 'the stale default `<project>-<svc>-1` name is gone')
      assert.deepEqual(lines.filter(DESTRUCTIVE), [], 'the success path issues no destructive command either')
    } finally { rmSync(tmp, { recursive: true, force: true }) }
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

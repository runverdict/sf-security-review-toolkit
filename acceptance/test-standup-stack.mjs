#!/usr/bin/env node
/**
 * Standing test for harness/standup-stack.mjs — the consented throwaway stand-up
 * (0.7.0 slice 3). Pure planner + safety, hermetic (no docker). The real docker
 * stand-up is validated by an Atlas smoke, not here.
 *
 *   U1  planStandup: runnable node stack → container name, baseUrl, synth env, command
 *   U2  planStandup throws on a non-runnable stack (gate must resolve needs-* first)
 *   U3  planStandup: a non-node recipe → unsupported (honest, later slice)
 *   U4  stackNames: deterministic + validates the run-id
 *   U5  standupStack FAILS CLOSED without consent
 *   U6  the plan never carries secret VALUES — only the synth env NAMES
 *
 * Dependency-free: `node acceptance/test-standup-stack.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { planStandup, standupStack, stackNames, STACK_SCHEMA, NAME_PREFIX } from '../harness/standup-stack.mjs'

let pass = 0, fail = 0
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`) } }

const TARGET = '/some/repo'
const TMP = join(tmpdir(), 'sf-srt-stack', 'u1')
const runnable = {
  status: 'runnable', recipe: { kind: 'node', root: 'server', entry: 'index.js' },
  webTier: { port: 8080 }, env: { synthesizable: ['ATLAS_JWT_SECRET', 'ATLAS_API_KEY'], external: [], benign: ['PORT'], unknown: [] },
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

check('U2 planStandup throws on a non-runnable stack', () => {
  assert.throws(() => planStandup({ status: 'needs-secrets' }, { runId: 'u2', target: TARGET, tmpRoot: TMP }), /not 'runnable'/)
  assert.throws(() => planStandup({ status: 'needs-recipe' }, { runId: 'u2', target: TARGET, tmpRoot: TMP }), /not 'runnable'/)
})

check('U3 planStandup: a non-node recipe → unsupported (honest, later slice)', () => {
  const p = planStandup({ status: 'runnable', recipe: { kind: 'compose' }, webTier: { port: 3000 }, env: {} }, { runId: 'u3', target: TARGET, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'u3') })
  assert.equal(p.unsupported, 'compose')
  assert.match(p.reason, /later slice/)
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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

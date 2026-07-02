#!/usr/bin/env node
/**
 * Standing test for harness/teardown-stack.mjs — the asymmetric, name-scoped,
 * manifest-driven teardown (0.7.0 slice 3). Hermetic: it never needs a real docker
 * resource (a non-existent name is just skipped), so it tests the LOGIC + the
 * load-bearing safety: a non-toolkit docker name is REFUSED.
 *
 *   T1  assertStackName: accepts sf-srt-stack-/net-, refuses anything else
 *   T2  planTeardown: validates the recorded names; refuses a non-toolkit container
 *   T3  planTeardown: refuses an unsafe tmpRoot
 *   T4  teardownStack: a tampered manifest (evil container name) → REFUSED, removes nothing
 *   T5  teardownStack: a valid manifest whose resources don't exist → already-clean
 *   T6  teardownStack: --target with no pointer → nothing-to-tear-down
 *   T7  sweepStacks: name-scoped orphan cleanup, structured result, never throws
 *   T8  planTeardown returns a dockerfile-built toolkit image for removal; refuses a foreign one
 *
 * Dependency-free: `node acceptance/test-teardown-stack.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { assertStackName, planTeardown, teardownStack, sweepStacks } from '../harness/teardown-stack.mjs'

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`) } }
const box = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'srt-tdstack-'))); dirs.push(d); return d }

console.log('teardown-stack standing test')

check('T1 assertStackName: accepts our names, refuses anything else', () => {
  assert.equal(assertStackName('sf-srt-stack-abc'), 'sf-srt-stack-abc')
  assert.equal(assertStackName('sf-srt-stack-abc:throwaway'), 'sf-srt-stack-abc:throwaway')
  assert.equal(assertStackName('sf-srt-net-abc'), 'sf-srt-net-abc')
  for (const bad of ['prod-db', 'postgres', '', 'sf-srt-other-x', 'my-stack']) assert.throws(() => assertStackName(bad), /non-toolkit docker resource/)
})

check('T2 planTeardown: validates names; refuses a non-toolkit container', () => {
  const ok = planTeardown({ resources: { container: 'sf-srt-stack-r1', image: 'sf-srt-stack-r1:throwaway', network: null }, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'r1') })
  assert.equal(ok.container, 'sf-srt-stack-r1')
  assert.throws(() => planTeardown({ resources: { container: 'production-api' } }), /non-toolkit docker resource/)
})

check('T3 planTeardown: refuses an unsafe tmpRoot', () => {
  assert.throws(() => planTeardown({ resources: { container: 'sf-srt-stack-r' }, tmpRoot: '/' }), /unsafe tmp root/)
  assert.throws(() => planTeardown({ resources: { container: 'sf-srt-stack-r' }, tmpRoot: process.cwd() }), /unsafe tmp root/)
})

check('T4 teardownStack: a tampered manifest (evil container) → REFUSED, removes nothing', () => {
  const b = box()
  const mf = join(b, 'm.json')
  writeFileSync(mf, JSON.stringify({ schema: 'sf-srt-stack/1', resources: { container: 'someones-prod-db' }, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'x') }))
  const r = teardownStack({ manifestPath: mf })
  assert.equal(r.status, 'refused')
  assert.deepEqual(r.removed, [])
})

check('T5 teardownStack: valid manifest, resources absent → already-clean', () => {
  const b = box()
  const mf = join(b, 'm.json')
  // a syntactically valid manifest whose container/tmp don't actually exist → no-op
  writeFileSync(mf, JSON.stringify({ schema: 'sf-srt-stack/1', resources: { container: 'sf-srt-stack-doesnotexist', image: null, network: null }, tmpRoot: join(tmpdir(), 'sf-srt-stack', 'doesnotexist-xyz') }))
  const r = teardownStack({ manifestPath: mf })
  assert.equal(r.status, 'already-clean', JSON.stringify(r))
  assert.deepEqual(r.removed, [])
})

check('T6 teardownStack: --target with no pointer → nothing-to-tear-down', () => {
  const b = box()
  const r = teardownStack({ target: b })
  assert.equal(r.status, 'nothing-to-tear-down')
})

check('T7 sweepStacks: name-scoped orphan cleanup, structured result, never throws', () => {
  // hermetic: with no toolkit containers/tmp present, sweep is a clean no-op — it only ever
  // targets sf-srt-stack-* names + /tmp/sf-srt-{stack,dast}/* trees, never anything else.
  const r = sweepStacks()
  assert.ok(['swept', 'already-clean'].includes(r.status), JSON.stringify(r))
  assert.ok(Array.isArray(r.removed))
  for (const item of r.removed) assert.match(item, /^(container|image|tmp):/) // strictly toolkit-named
})

check('T8 planTeardown: a dockerfile-built toolkit image is removable; a foreign image is refused', () => {
  // the build-then-run stand-up names its built image sf-srt-stack-<runId>:throwaway —
  // planTeardown must return it for removal (docker rmi) …
  const ok = planTeardown({ resources: { container: 'sf-srt-stack-abc', image: 'sf-srt-stack-abc:throwaway' } })
  assert.equal(ok.image, 'sf-srt-stack-abc:throwaway')
  // … and must REFUSE an image the toolkit didn't build (a tampered manifest can never rmi it)
  assert.throws(() => planTeardown({ resources: { container: 'sf-srt-stack-abc', image: 'nginx:latest' } }), /non-toolkit docker resource/)
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

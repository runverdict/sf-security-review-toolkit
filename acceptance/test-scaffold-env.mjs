#!/usr/bin/env node
/**
 * Standing test for harness/scaffold-env.mjs — the credential scaffold-and-guide loop
 * (0.7.0 slice 6). Pure planner + the deterministic filled-check + the stub roundtrip.
 *
 *   V1  planEnvScaffold: keys dedup/sorted, stub in TMP (never the repo), validates run-id
 *   V2  envStatus: missing keys, placeholder rejection, ready only when all filled
 *   V3  writeEnvStub roundtrip: stub written empty → not ready; filled → ready; the stub
 *       lives in /tmp (the credential contract — never the repo / .security-review)
 *
 * Dependency-free: `node acceptance/test-scaffold-env.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { planEnvScaffold, envStatus, writeEnvStub } from '../harness/scaffold-env.mjs'

let pass = 0, fail = 0
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`) } }
const TMP = join(tmpdir(), 'sf-srt-stack', 'v1')

console.log('scaffold-env standing test')

check('V1 planEnvScaffold: keys dedup/sorted, stub in TMP, validates run-id', () => {
  const p = planEnvScaffold(['DATABASE_URL', 'STRIPE_KEY', 'DATABASE_URL'], { runId: 'v1', tmpRoot: TMP })
  assert.deepEqual(p.keys, ['DATABASE_URL', 'STRIPE_KEY'])
  assert.equal(p.stubPath, join(TMP, 'throwaway.env'))
  assert.ok(p.stubPath.includes('/sf-srt-stack/'), 'stub lives under the throwaway tmp, never the repo')
  for (const bad of ['', '.', 'a/b']) assert.throws(() => planEnvScaffold([], { runId: bad, tmpRoot: TMP }), /invalid run-id/)
})

check('V2 envStatus: missing keys, placeholder rejection, ready only when all filled', () => {
  const req = ['DATABASE_URL', 'API_KEY']
  assert.deepEqual(envStatus('DATABASE_URL=\nAPI_KEY=', req), { filled: [], missing: ['API_KEY', 'DATABASE_URL'], ready: false })
  // a placeholder is NOT filled
  assert.equal(envStatus('DATABASE_URL=<your-db>\nAPI_KEY=CHANGEME', req).ready, false)
  // partial
  const partial = envStatus('DATABASE_URL=postgres://real\nAPI_KEY=', req)
  assert.deepEqual(partial.filled, ['DATABASE_URL'])
  assert.deepEqual(partial.missing, ['API_KEY'])
  assert.equal(partial.ready, false)
  // fully filled → ready (quotes stripped, comments/blanks ignored)
  const full = envStatus('# comment\n\nDATABASE_URL="postgres://real"\nAPI_KEY=sk_live_123\n', req)
  assert.equal(full.ready, true)
  assert.deepEqual(full.filled, ['API_KEY', 'DATABASE_URL'])
})

check('V3 writeEnvStub roundtrip: empty stub not ready → filled stub ready', () => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'sf-srt-stack-v3-')))
  try {
    const p = planEnvScaffold(['DATABASE_URL', 'REDIS_URL'], { runId: 'v3a', tmpRoot: tmp })
    const stub = writeEnvStub(p)
    assert.equal(stub, p.stubPath)
    const empty = readFileSync(stub, 'utf8')
    assert.ok(empty.includes('DATABASE_URL='))
    assert.ok(/DESTROYED with it at teardown|destroyed/i.test(empty), 'the stub discloses the burn-at-teardown contract')
    assert.equal(envStatus(empty, p.keys).ready, false)               // operator hasn't filled yet
    // operator fills it
    writeFileSync(stub, 'DATABASE_URL=postgres://x\nREDIS_URL=redis://y\n')
    assert.equal(envStatus(readFileSync(stub, 'utf8'), p.keys).ready, true)  // loop may resume
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

#!/usr/bin/env node
/**
 * Standing test for harness/docker-check.mjs — the throwaway-DAST docker prerequisite
 * (0.7.1). Pure classifier tested exhaustively; the impure prober just confirmed to
 * return a valid shape (its result depends on the host).
 *
 *   K1  classifyDocker: absent / daemon-down / available — status, runnable, hint
 *   K2  dockerStatus() returns a valid {status, runnable, hint} on this host
 *
 * Dependency-free: `node acceptance/test-docker-check.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { classifyDocker, dockerStatus } from '../harness/docker-check.mjs'

let pass = 0, fail = 0
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message)}`) } }

console.log('docker-check standing test')

check('K1 classifyDocker: absent / daemon-down / available', () => {
  const absent = classifyDocker({ hasBinary: false, daemonOk: false })
  assert.equal(absent.status, 'absent')
  assert.equal(absent.runnable, false)
  assert.match(absent.hint, /not installed/i)
  assert.match(absent.hint, /owner-run/i)        // honest fallback named

  const down = classifyDocker({ hasBinary: true, daemonOk: false })
  assert.equal(down.status, 'daemon-down')
  assert.equal(down.runnable, false)
  assert.match(down.hint, /daemon/i)

  const ok = classifyDocker({ hasBinary: true, daemonOk: true })
  assert.equal(ok.status, 'available')
  assert.equal(ok.runnable, true)
  assert.equal(ok.hint, '')
})

check('K2 dockerStatus(): returns a valid {status, runnable, hint}', () => {
  const r = dockerStatus()
  assert.ok(['absent', 'daemon-down', 'available'].includes(r.status), `unexpected status ${r.status}`)
  assert.equal(typeof r.runnable, 'boolean')
  assert.equal(r.runnable, r.status === 'available')
  assert.equal(typeof r.hint, 'string')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

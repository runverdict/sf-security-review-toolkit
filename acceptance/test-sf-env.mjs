#!/usr/bin/env node
/**
 * Standing test for harness/sf-env.mjs — the one place that makes every `sf`
 * invocation JSON-safe (the auto-update banner corrupts `--json` reads).
 *
 *   SE1  sfEnv() carries the parent env (PATH must survive — the binary is
 *        resolved via PATH) AND sets both auto-update-off flags
 *   SE2  sfEnv({X:'y'}) merges extra keys; the two flags are forced last and
 *        cannot be clobbered by an extra of the same name
 *   SE3  parseSfJson strips a leading banner line before parsing; clean JSON
 *        (object or array) parses unchanged; non-JSON throws
 *
 * Dependency-free: `node acceptance/test-sf-env.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { SF_AUTOUPDATE_OFF, sfEnv, parseSfJson } from '../harness/sf-env.mjs'

let pass = 0, fail = 0
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message)}`) } }

console.log('sf-env standing test')

check('SE1 sfEnv() carries PATH from process.env and both auto-update flags', () => {
  const env = sfEnv()
  // PATH must survive — execFileSync resolves `sf` via PATH; an env of only the
  // two flags would make the binary unfindable and break every call
  assert.equal(env.PATH, process.env.PATH, 'PATH is carried through unchanged')
  assert.equal(env.SF_AUTOUPDATE_DISABLE, 'true', 'older sf reads SF_AUTOUPDATE_DISABLE')
  assert.equal(env.SF_DISABLE_AUTOUPDATE, 'true', 'newer sf reads SF_DISABLE_AUTOUPDATE')
  // both keys are the constant the module exports
  assert.deepEqual(SF_AUTOUPDATE_OFF, { SF_AUTOUPDATE_DISABLE: 'true', SF_DISABLE_AUTOUPDATE: 'true' })
})

check('SE2 sfEnv(extra) merges extra keys; the flags win over a colliding extra', () => {
  const env = sfEnv({ MY_TOKEN: 'y' })
  assert.equal(env.MY_TOKEN, 'y', 'extra key is merged in')
  assert.equal(env.PATH, process.env.PATH, 'PATH still carried through with extra present')
  // a caller can never accidentally re-enable the banner: the flags spread LAST
  const forced = sfEnv({ SF_AUTOUPDATE_DISABLE: 'false', SF_DISABLE_AUTOUPDATE: 'false' })
  assert.equal(forced.SF_AUTOUPDATE_DISABLE, 'true', 'extra cannot clobber the disable flag')
  assert.equal(forced.SF_DISABLE_AUTOUPDATE, 'true', 'extra cannot clobber the disable flag')
})

check('SE3 parseSfJson strips a leading banner then parses; clean JSON unchanged', () => {
  const banner = '›  Warning: @salesforce/cli update available from 2.1.0 to 2.9.0.\n'
  // object payload behind a banner line
  const withBanner = banner + '{"status":0,"result":{"devHubs":[{"alias":"hub"}]}}'
  assert.deepEqual(parseSfJson(withBanner), { status: 0, result: { devHubs: [{ alias: 'hub' }] } })
  // array payload behind a banner line (slices from the first `[`)
  assert.deepEqual(parseSfJson(banner + '[1,2,3]'), [1, 2, 3])
  // clean JSON with no banner parses unchanged
  assert.deepEqual(parseSfJson('{"a":1}'), { a: 1 })
  // null/undefined coerce to '' → throws like JSON.parse on empty (not a silent {})
  assert.throws(() => parseSfJson(undefined))
  // genuinely non-JSON output still throws (does not swallow the error)
  assert.throws(() => parseSfJson('command not found'))
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

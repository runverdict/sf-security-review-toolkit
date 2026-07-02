#!/usr/bin/env node
/**
 * Standing test for harness/teardown-org.mjs — the DESTRUCTIVE, name-guarded half
 * of the org-tier throwaway pair (B2-P2). Hermetic BY CONSTRUCTION: no check ever
 * reaches a live Salesforce org — the sweep check runs the CLI in a spawned
 * process with a stubbed `sf` on PATH and an isolated TMPDIR, and every other
 * check either exercises pure logic or targets aliases that resolve to nothing.
 * The live `sf org delete` is operator-cold-validated, NOT CI-hermetic — these
 * tests pin the PURE alias name guard + plan shape + consent coupling, which are
 * what regress silently. The name guard is the load-bearing safety of the whole
 * pair: `sf org delete` is IRREVERSIBLE, so a teardown may only ever target an
 * org standup-org created.
 *
 *   T1  assertOrgAlias accepts toolkit-scoped aliases (sf-srt-org-<runId>)
 *   T2  THE security matrix: every foreign alias shape is REFUSED — a production
 *       alias, a Dev Hub, contains-the-prefix, trailing-newline smuggling (JS `$`
 *       without `m` rejects it), whitespace, case drift, a sibling-tier name, a
 *       username, empty, null
 *   T3  planTeardownOrg asserts the alias BEFORE returning; no alias → REFUSED
 *       (no bare --target-org fallback that could resolve to a foreign org)
 *   T4  planTeardownOrg refuses an unsafe tmpRoot
 *   T5  teardownOrg + sweepOrgs FAIL CLOSED without consent (thrown before
 *       anything is read or removed)
 *   T6  a tampered manifest → REFUSED, removes NOTHING (the tmp dir survives)
 *   T7  idempotent + honest resolution: an absent org + absent tmp →
 *       already-clean; no pointer → nothing-to-tear-down; a pointer whose tmp
 *       manifest is gone still tears down by its guarded alias (never a false
 *       "no org stood up"); a path-escaping --run-id → error, never a read
 *   T8  the sweep, HERMETIC end-to-end: spawned CLI with a stubbed `sf` (no org
 *       reachable) + an isolated TMPDIR — seeded toolkit tmp trees are swept,
 *       the grouping dir + non-toolkit siblings survive, no org: items appear
 *   T9  CLI: recorded consent + tampered manifest → REFUSED exit 2 (removed
 *       nothing); --consent flag without recorded consent → NOT RUN exit 3
 *   T10 consent is COUPLED to the org's originating repo: a manifest recording
 *       target=<repo B> refuses under repo A's token until repo B records its
 *       own sf-deep-audit-ops consent
 *   T11 an unavailable `sf` CLI is NOT "the org is gone": a manifest recording a
 *       really-created org (username/orgId) → failed, manifest + tmp survive
 *
 * Dependency-free: `node acceptance/test-teardown-org.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assertOrgAlias, planTeardownOrg, teardownOrg, sweepOrgs } from '../harness/teardown-org.mjs'
import { recordConsent } from '../harness/record-consent.mjs'

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`) } }
const box = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'srt-tdorg-'))); dirs.push(d); return d }

const ENGINE = fileURLToPath(new URL('../harness/teardown-org.mjs', import.meta.url))
const PID = process.pid // per-checkout-unique fixture ids — parallel checkouts never collide

// a stubbed `sf` that always fails: no live org is ever reachable from a spawn
const stubSfDir = () => {
  const d = join(box(), 'bin')
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'sf'), '#!/bin/sh\nexit 1\n')
  chmodSync(join(d, 'sf'), 0o755)
  return d
}
const spawn = (args, env = {}) => {
  try { return { status: 0, out: execFileSync('node', [ENGINE, ...args], { encoding: 'utf8', env: { ...process.env, ...env } }) } }
  catch (e) { return { status: e.status, out: String(e.stdout || '') } }
}

console.log('teardown-org standing test')

check('T1 assertOrgAlias accepts toolkit-scoped aliases', () => {
  for (const ok of ['sf-srt-org-abc', 'sf-srt-org-0', 'sf-srt-org-a.b_c-1', 'sf-srt-org-mcvkw3-12345-a1b2c3']) {
    assert.equal(assertOrgAlias(ok), ok)
  }
})

check('T2 THE security matrix: every foreign alias shape is REFUSED', () => {
  const foreign = [
    'prod', 'acme-devhub', 'my-production-org',      // production-looking aliases
    'x-sf-srt-org-abc', 'notsf-srt-org-abc',         // merely CONTAINS the prefix — ^ anchor refuses
    'sf-srt-org-abc\nprod',                          // newline smuggling — the class excludes \n
    'sf-srt-org-abc\n',                              // trailing newline — JS `$` without `m` refuses it
    ' sf-srt-org-abc', 'sf-srt-org-abc ',            // whitespace padding
    'sf-srt-org-abc prod',                           // an embedded second target
    'SF-SRT-ORG-ABC',                                // case drift is not our convention
    'sf-srt-org-', 'sf-srt-org--x',                  // empty / non-alnum-leading tail
    'sf-srt-stack-abc', 'sf-srt-net-abc',            // sibling-tier names are NOT org aliases
    'test-huj0mspl@example.com',                     // a bare scratch USERNAME is not a guarded alias
    '', null, undefined, 42,
  ]
  for (const bad of foreign) {
    assert.throws(() => assertOrgAlias(bad), /non-toolkit org/, `must refuse ${JSON.stringify(bad)}`)
  }
})

check('T3 planTeardownOrg asserts the alias BEFORE returning; no bare-target fallback', () => {
  const tmp = join(tmpdir(), 'sf-srt-org', 't3')
  const ok = planTeardownOrg({ alias: 'sf-srt-org-t3', username: 'test-x1@example.com', orgId: '00D000000000001EAA', tmpRoot: tmp })
  assert.deepEqual(ok, { alias: 'sf-srt-org-t3', username: 'test-x1@example.com', orgId: '00D000000000001EAA', tmpRoot: tmp })
  // a foreign alias is REFUSED outright
  assert.throws(() => planTeardownOrg({ alias: 'acme-devhub', tmpRoot: tmp }), /non-toolkit org/)
  // NO alias → REFUSED, even when a username/orgId is present — the engine never
  // falls back to a bare --target-org that could resolve to a foreign org
  assert.throws(() => planTeardownOrg({ username: 'admin@acme-prod.com', orgId: '00D000000000002EAA', tmpRoot: tmp }), /non-toolkit org/)
  assert.throws(() => planTeardownOrg(null), /no manifest/)
  assert.throws(() => planTeardownOrg('sf-srt-org-t3'), /no manifest/)
})

check('T4 planTeardownOrg refuses an unsafe tmpRoot', () => {
  assert.throws(() => planTeardownOrg({ alias: 'sf-srt-org-t4', tmpRoot: '/' }), /unsafe tmp root/)
  assert.throws(() => planTeardownOrg({ alias: 'sf-srt-org-t4', tmpRoot: process.cwd() }), /unsafe tmp root/)
  assert.throws(() => planTeardownOrg({ alias: 'sf-srt-org-t4', tmpRoot: join(tmpdir(), 'sf-srt-org') }), /unsafe tmp root/)
})

check('T5 teardownOrg + sweepOrgs FAIL CLOSED without consent', () => {
  const b = box()
  const mf = join(b, 'm.json')
  writeFileSync(mf, JSON.stringify({ schema: 'sf-srt-org/1', alias: 'sf-srt-org-t5', tmpRoot: join(tmpdir(), 'sf-srt-org', 't5-absent') }))
  assert.throws(() => teardownOrg({ manifestPath: mf }), /without explicit consent/)
  assert.throws(() => teardownOrg({ manifestPath: mf, consent: false }), /without explicit consent/)
  assert.throws(() => sweepOrgs(), /without explicit consent/)
  assert.throws(() => sweepOrgs({ consent: 'yes' }), /without explicit consent/) // strictly `true`, not truthy
})

check('T6 a tampered manifest → REFUSED, removes NOTHING (the tmp dir survives)', () => {
  const b = box()
  const tamperTmp = join(tmpdir(), 'sf-srt-org', `t6-tamper-${PID}`)
  mkdirSync(tamperTmp, { recursive: true })
  writeFileSync(join(tamperTmp, 'canary.txt'), 'still here\n')
  const mf = join(b, 'evil.json')
  writeFileSync(mf, JSON.stringify({ schema: 'sf-srt-org/1', alias: 'someones-production-org', username: 'admin@acme.com', tmpRoot: tamperTmp }))
  try {
    const r = teardownOrg({ manifestPath: mf, consent: true })
    assert.equal(r.status, 'refused')
    assert.deepEqual(r.removed, [])
    assert.ok(existsSync(join(tamperTmp, 'canary.txt')), 'a refused teardown removes nothing — not even the tmp dir')
  } finally { rmSync(tamperTmp, { recursive: true, force: true }) }
})

check('T7 idempotent + honest resolution (absent org, missing pointer/manifest, bad run-id)', () => {
  const b = box()
  const mf = join(b, 'm.json')
  writeFileSync(mf, JSON.stringify({ schema: 'sf-srt-org/1', alias: 'sf-srt-org-doesnotexist-xyz', username: null, orgId: null, tmpRoot: join(tmpdir(), 'sf-srt-org', 'doesnotexist-xyz') }))
  const r = teardownOrg({ manifestPath: mf, consent: true })
  assert.equal(r.status, 'already-clean', JSON.stringify(r))
  assert.deepEqual(r.removed, [])
  // --target with no pointer at all → honest nothing-to-tear-down
  const r2 = teardownOrg({ target: b, consent: true })
  assert.equal(r2.status, 'nothing-to-tear-down')
  // a pointer whose tmp manifest is GONE (a reboot cleared /tmp while the org
  // lives for days): the guarded pointer alias still resolves — never a false
  // "no org stood up" while a live org keeps running
  const b2 = box()
  recordConsent('sf-deep-audit-ops', 'yes, proceed', { target: b2, question: 'standing-test fixture consent' }) // the originating repo recorded it at standup time
  writeFileSync(join(b2, '.security-review', 'org-standup.json'), JSON.stringify({ schema: 'sf-srt-org/1', runId: 't7ptr', alias: 'sf-srt-org-doesnotexist-t7ptr', manifestPath: join(b2, 'gone', 'org-manifest.json'), status: 'created' }))
  const r3 = teardownOrg({ target: b2, consent: true })
  assert.equal(r3.status, 'already-clean', JSON.stringify(r3))
  // …and the pointer is now marked torn-down, so a re-run is a clean no-op
  const r4 = teardownOrg({ target: b2, consent: true })
  assert.equal(r4.status, 'nothing-to-tear-down')
  // a path-escaping --run-id is refused as invalid, never used as a path segment
  const r5 = teardownOrg({ runId: '../../etc', consent: true })
  assert.equal(r5.status, 'error')
  assert.match(r5.error, /invalid run-id/)
})

check('T8 sweep, hermetic end-to-end: stubbed sf + isolated TMPDIR — name-scoped tmp removal, no org reachable', () => {
  // the spawned CLI sees (a) a stubbed `sf` that always fails — so `sf org list`
  // yields NO orgs and no delete can ever fire — and (b) TMPDIR pointed at a
  // throwaway box, so the tmp-tree sweep operates on seeded fixtures only. The
  // standing suite therefore NEVER touches a real org or a real run's manifests.
  const stub = stubSfDir()
  const tmpBox = box()
  const consentRepo = box()
  recordConsent('sf-deep-audit-ops', 'yes, proceed', { target: consentRepo, question: 'standing-test fixture consent' })
  mkdirSync(join(tmpBox, 'sf-srt-org', 'run1'), { recursive: true })
  mkdirSync(join(tmpBox, 'sf-srt-org', 'run2'), { recursive: true })
  writeFileSync(join(tmpBox, 'sf-srt-org', 'run1', 'org-manifest.json'), '{}\n')
  mkdirSync(join(tmpBox, 'unrelated-dir'), { recursive: true })
  const r = spawn(['--sweep', '--consent', '--target', consentRepo, '--json'], { PATH: `${stub}:${process.env.PATH}`, TMPDIR: tmpBox })
  assert.equal(r.status, 0, r.out)
  const s = JSON.parse(r.out)
  assert.equal(s.status, 'swept', r.out)
  for (const item of s.removed) {
    assert.match(item, /^(org|tmp):/)
    if (item.startsWith('org:')) assert.match(item, /^org:sf-srt-org-/) // only ever a toolkit-aliased org
  }
  assert.ok(!s.removed.some((i) => i.startsWith('org:')), 'stubbed sf lists no orgs — no delete can have fired')
  assert.ok(s.removed.some((i) => i === `tmp:${join(tmpBox, 'sf-srt-org', 'run1')}`), JSON.stringify(s.removed))
  assert.ok(s.removed.some((i) => i === `tmp:${join(tmpBox, 'sf-srt-org', 'run2')}`), JSON.stringify(s.removed))
  assert.ok(!existsSync(join(tmpBox, 'sf-srt-org', 'run1')), 'seeded toolkit tree swept')
  assert.ok(existsSync(join(tmpBox, 'sf-srt-org')), 'the grouping dir itself survives')
  assert.ok(existsSync(join(tmpBox, 'unrelated-dir')), 'a non-toolkit sibling is untouched')
})

check('T9 CLI: recorded consent + tampered manifest → REFUSED exit 2; flag without recorded consent → NOT RUN exit 3', () => {
  // consent recorded, manifest tampered → the name guard still refuses (exit 2)
  const b1 = box()
  recordConsent('sf-deep-audit-ops', 'yes, proceed', { target: b1, question: 'standing-test fixture consent' })
  const evil = join(b1, 'evil.json')
  writeFileSync(evil, JSON.stringify({ schema: 'sf-srt-org/1', alias: 'acme-devhub', tmpRoot: join(tmpdir(), 'sf-srt-org', 't9') }))
  const r1 = spawn(['--manifest', evil, '--consent', '--target', b1, '--json'])
  assert.equal(r1.status, 2)
  const j = JSON.parse(r1.out)
  assert.equal(j.status, 'refused')
  assert.deepEqual(j.removed, [])
  // --consent flag but NOTHING recorded → fail closed before any resolution (exit 3)
  const b2 = box()
  const mf = join(b2, 'm.json')
  writeFileSync(mf, JSON.stringify({ schema: 'sf-srt-org/1', alias: 'sf-srt-org-t9' }))
  const r2 = spawn(['--manifest', mf, '--consent', '--target', b2])
  assert.equal(r2.status, 3)
  assert.match(r2.out, /NOT RUN \(no consent\)/)
  assert.match(r2.out, /no affirmative consent is recorded for gate 'sf-deep-audit-ops'/)
})

check('T10 consent is COUPLED to the org\'s originating repo', () => {
  // repo A holds a recorded token; the manifest records repo B as the repo that
  // stood the org up. A's token must NOT authorize deleting B's org.
  const repoA = box()
  const repoB = box()
  recordConsent('sf-deep-audit-ops', 'yes, proceed', { target: repoA, question: 'standing-test fixture consent' })
  const mf = join(repoA, 'm.json')
  writeFileSync(mf, JSON.stringify({ schema: 'sf-srt-org/1', alias: 'sf-srt-org-doesnotexist-t10', username: null, orgId: null, tmpRoot: null, target: repoB }))
  const r = teardownOrg({ manifestPath: mf, consent: true }) // consent=true == A's token verified
  assert.equal(r.status, 'refused', JSON.stringify(r))
  assert.match(r.error, /originating repo/)
  assert.deepEqual(r.removed, [])
  // once repo B records its own consent, the same teardown proceeds
  recordConsent('sf-deep-audit-ops', 'yes, proceed', { target: repoB, question: 'standing-test fixture consent' })
  const r2 = teardownOrg({ manifestPath: mf, consent: true })
  assert.equal(r2.status, 'already-clean', JSON.stringify(r2))
})

check('T11 an unavailable sf CLI is NOT "the org is gone" — a created org refuses to lose its teardown record', () => {
  const stub = stubSfDir() // `sf --version` fails → CLI reads as unavailable
  const b = box()
  recordConsent('sf-deep-audit-ops', 'yes, proceed', { target: b, question: 'standing-test fixture consent' })
  const liveTmp = join(tmpdir(), 'sf-srt-org', `t11-live-${PID}`)
  mkdirSync(liveTmp, { recursive: true })
  const mf = join(liveTmp, 'org-manifest.json')
  writeFileSync(mf, JSON.stringify({ schema: 'sf-srt-org/1', runId: `t11-live-${PID}`, alias: `sf-srt-org-t11-${PID}`, username: 'test-t11@example.com', orgId: '00D000000000003EAA', tmpRoot: liveTmp, target: b }))
  try {
    const r = spawn(['--manifest', mf, '--consent', '--target', b, '--json'], { PATH: `${stub}:${process.env.PATH}` })
    assert.equal(r.status, 2, r.out)
    const j = JSON.parse(r.out)
    assert.equal(j.status, 'failed')
    assert.match(j.error, /Salesforce CLI is unavailable/)
    assert.deepEqual(j.removed, [])
    assert.ok(existsSync(mf), 'the manifest survives — the org stays teardown-able later')
  } finally { rmSync(liveTmp, { recursive: true, force: true }) }
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

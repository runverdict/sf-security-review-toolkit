#!/usr/bin/env node
/**
 * Standing test for harness/standup-org.mjs — the consented throwaway scratch-org
 * stand-up (B2-P2, the org tier). Hermetic, pure-planner: the live
 * `sf org create scratch` is operator-cold-validated (like standup-stack's docker
 * run and run-dast's ZAP run), NOT CI-hermetic — these tests pin the PURE planner,
 * the consent fail-closed, the dry-run purity, and the names-only manifest
 * contract, which are what regress silently.
 *
 *   O1  planStandupOrg: deterministic spec — toolkit alias, exact argv, manifest
 *       path under tmpRoot
 *   O2  the generated default definition (Developer + Einstein1AIPlatform); an
 *       operator --def-file is used verbatim (no generated content)
 *   O3  duration-days is CLAMPED to a sane bound; a non-integer is refused
 *   O4  orgAlias: deterministic, toolkit-scoped, validates the run-id
 *   O5  planStandupOrg refuses an unsafe tmpRoot (incl. the bare sf-srt-org
 *       grouping dir — an rm -rf there would nuke sibling runs)
 *   O6  standupOrg FAILS CLOSED without consent (thrown before any `sf` call),
 *       and refuses a hand-built plan whose alias is not toolkit-scoped — every
 *       `sf org delete` in the pair (incl. the crash-cleanup) stays name-guarded
 *   O7  --dry-run writes the `planned` manifest, performs NO live op, and the
 *       manifest carries NAMES/IDS only — no credential-shaped field, ever
 *   O8  cross-engine coherence: the planned alias passes teardown-org's
 *       assertOrgAlias (what makes the org teardown-able and ONLY ours deletable)
 *   O9  CLI fail-closed: no --consent → NOT STARTED; --consent WITHOUT the
 *       recorded sf-deep-audit-ops consent → still NOT STARTED (flag alone is
 *       insufficient); no manifest written on either path
 *
 * Dependency-free: `node acceptance/test-standup-org.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  planStandupOrg, standupOrg, orgAlias, defaultOrgDef,
  ORG_SCHEMA, ORG_ALIAS_PREFIX, DEFAULT_DURATION_DAYS, MAX_DURATION_DAYS,
} from '../harness/standup-org.mjs'
import { assertOrgAlias } from '../harness/teardown-org.mjs'

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`) } }
const box = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'srt-suorg-'))); dirs.push(d); return d }

const ENGINE = fileURLToPath(new URL('../harness/standup-org.mjs', import.meta.url))
const TMP = join(tmpdir(), 'sf-srt-org', 'o1')

console.log('standup-org standing test')

check('O1 planStandupOrg: deterministic spec — toolkit alias, exact argv, manifest under tmpRoot', () => {
  const p = planStandupOrg({ runId: 'o1', tmpRoot: TMP })
  assert.equal(p.schema, ORG_SCHEMA)
  assert.equal(p.alias, `${ORG_ALIAS_PREFIX}-o1`)
  assert.deepEqual(p.argv, [
    'org', 'create', 'scratch',
    '--alias', 'sf-srt-org-o1',
    '--definition-file', join(TMP, 'org-def.json'),
    '--no-ancestors',
    '--duration-days', String(DEFAULT_DURATION_DAYS),
    '--wait', '15',
    '--json',
  ])
  // `--target-dev-hub` is deliberately absent — the authed default hub is used;
  // authenticating/selecting one stays owner-interactive
  assert.ok(!p.argv.includes('--target-dev-hub'))
  assert.equal(p.manifestPath, join(TMP, 'org-manifest.json'))
  assert.equal(p.pointerRel, join('.security-review', 'org-standup.json'))
  // deterministic given inputs
  assert.deepEqual(p, planStandupOrg({ runId: 'o1', tmpRoot: TMP }))
})

check('O2 default definition carries Developer + Einstein1AIPlatform; an operator --def-file is used verbatim', () => {
  const gen = planStandupOrg({ runId: 'o2', tmpRoot: join(tmpdir(), 'sf-srt-org', 'o2') })
  const def = JSON.parse(gen.defFileContent)
  assert.equal(def.edition, 'Developer')
  assert.deepEqual(def.features, ['Einstein1AIPlatform']) // the MCP-registration feature; retired Chatbot/botSettings deliberately absent
  assert.deepEqual(def, defaultOrgDef())
  // an operator definition: argv points at THEIR file, nothing is generated
  const own = planStandupOrg({ runId: 'o2', defFile: '/some/repo/config/project-scratch-def.json', tmpRoot: join(tmpdir(), 'sf-srt-org', 'o2') })
  assert.equal(own.defFileContent, null)
  assert.equal(own.argv[own.argv.indexOf('--definition-file') + 1], '/some/repo/config/project-scratch-def.json')
})

check('O3 duration-days is clamped to a sane bound; a non-integer is refused', () => {
  const tmp = join(tmpdir(), 'sf-srt-org', 'o3')
  const days = (d) => planStandupOrg({ runId: 'o3', tmpRoot: tmp, durationDays: d }).durationDays
  assert.equal(days(undefined), DEFAULT_DURATION_DAYS)
  assert.equal(days('3'), 3)
  assert.equal(days(0), 1)                    // clamped up — sf rejects 0-day orgs
  assert.equal(days('30'), MAX_DURATION_DAYS) // clamped down — a throwaway never needs the platform max
  assert.equal(days(-5), 1)
  for (const bad of ['abc', '2.5', {}]) assert.throws(() => days(bad), /invalid duration-days/)
})

check('O4 orgAlias: deterministic, toolkit-scoped, validates the run-id', () => {
  assert.equal(orgAlias('abc'), 'sf-srt-org-abc')
  assert.equal(orgAlias('abc'), orgAlias('abc'))
  for (const bad of ['', '.', '..', 'a/b', 'a b', '-x', null]) assert.throws(() => orgAlias(bad), /invalid run-id/)
})

check('O5 planStandupOrg refuses an unsafe tmpRoot (incl. the bare sf-srt-org grouping dir)', () => {
  assert.throws(() => planStandupOrg({ runId: 'o5', tmpRoot: '/' }), /unsafe tmp root/)
  assert.throws(() => planStandupOrg({ runId: 'o5', tmpRoot: process.cwd() }), /unsafe tmp root/)
  // the SHARED grouping dir itself is never a per-run root — removing it would
  // nuke every sibling run's tree (the same guard the scanner/stack tiers carry)
  assert.throws(() => planStandupOrg({ runId: 'o5', tmpRoot: join(tmpdir(), 'sf-srt-org') }), /unsafe tmp root/)
})

check('O6 standupOrg FAILS CLOSED without consent; a foreign-alias plan is refused outright', () => {
  const p = planStandupOrg({ runId: 'o6', tmpRoot: join(tmpdir(), 'sf-srt-org', 'o6') })
  assert.throws(() => standupOrg(p, { consent: false }), /without explicit consent/)
  assert.throws(() => standupOrg(p), /without explicit consent/)
  // a hand-built plan with a non-toolkit alias must refuse BEFORE anything runs —
  // the executor's crash-cleanup issues an `sf org delete`, and every delete in
  // the pair stays behind the name guard (even consent cannot bypass it)
  assert.throws(() => standupOrg({ ...p, alias: 'acme-devhub' }, { consent: true }), /non-toolkit org/)
})

check('O7 --dry-run writes the planned manifest, NO live op, NAMES/IDS only', () => {
  const runId = `o7-dryrun-${process.pid}` // per-checkout-unique — parallel checkouts never collide
  const tmp = join(tmpdir(), 'sf-srt-org', runId)
  rmSync(tmp, { recursive: true, force: true })
  try {
    const out = execFileSync('node', [ENGINE, '--dry-run', '--run-id', runId, '--tmp-root', tmp, '--json'], { encoding: 'utf8' })
    const m = JSON.parse(out)
    assert.equal(m.status, 'planned')
    assert.equal(m.alias, `sf-srt-org-${runId}`)
    assert.ok(existsSync(join(tmp, 'org-manifest.json')), 'the planned manifest is written')
    assert.ok(!existsSync(join(tmp, 'org-def.json')), 'dry-run stages nothing for a live create — not even the def file')
    // the manifest is a STRICT allowlist: alias/username/orgId and run metadata,
    // never a credential (`sf org create --json` returns authFields with an
    // ACCESS TOKEN — the executor discards it; no field shaped like it may exist)
    assert.deepEqual(Object.keys(m).sort(), ['alias', 'createdAt', 'defFile', 'durationDays', 'log', 'orgId', 'runId', 'schema', 'status', 'target', 'tmpRoot', 'username'].sort())
    for (const banned of ['accessToken', 'authFields', 'password', 'sfdxAuthUrl', 'refreshToken']) {
      assert.ok(!out.includes(banned), `no credential-shaped field '${banned}' in the manifest`)
    }
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

check('O8 cross-engine coherence: the planned alias passes teardown-org\'s assertOrgAlias', () => {
  const p = planStandupOrg({ runId: 'o8', tmpRoot: join(tmpdir(), 'sf-srt-org', 'o8') })
  assert.equal(assertOrgAlias(p.alias), p.alias)  // teardown's name guard accepts it → the org is deletable, and ONLY ours are
  assert.equal(assertOrgAlias(orgAlias('mcvkw3-12345-a1b2c3')), 'sf-srt-org-mcvkw3-12345-a1b2c3')
})

check('O9 CLI fail-closed: no consent / flag-without-recorded-consent → NOT STARTED, no manifest', () => {
  const b = box() // a fresh --target with NO recorded sf-deep-audit-ops consent
  const runId = `o9-consent-${process.pid}`
  const tmp = join(tmpdir(), 'sf-srt-org', runId)
  rmSync(tmp, { recursive: true, force: true })
  const spawn = (args) => { try { return { status: 0, out: execFileSync('node', [ENGINE, ...args], { encoding: 'utf8' }) } } catch (e) { return { status: e.status, out: String(e.stdout || '') } } }
  try {
    // no --consent flag at all
    const r1 = spawn(['--run-id', runId, '--tmp-root', tmp, '--target', b])
    assert.equal(r1.status, 3)
    assert.match(r1.out, /NOT STARTED \(no consent\)/)
    // --consent flag alone, nothing recorded — still refused (the flag is not the consent)
    const r2 = spawn(['--run-id', runId, '--tmp-root', tmp, '--target', b, '--consent'])
    assert.equal(r2.status, 3)
    assert.match(r2.out, /no affirmative consent is recorded for gate 'sf-deep-audit-ops'/)
    assert.ok(!existsSync(join(tmp, 'org-manifest.json')), 'the executor never ran — no manifest')
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

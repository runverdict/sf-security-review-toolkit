#!/usr/bin/env node
/**
 * Standing test for harness/sf-autoresolve.mjs — the deterministic DevHub Tooling
 * auto-resolve PRODUCER (cold-run robustness slice R2), the producer half of the
 * producer→render pair. Hermetic, pure-planner: the live `sf` spawn (real DevHub
 * Tooling queries) is operator-cold-validated, NOT CI-hermetic — exactly as
 * standup-org keeps `sf org create scratch` operator-cold. The hermetic core is
 * the PURE planner + the PURE normalizers + the per-step executor driven through
 * an INJECTED runner (no live `sf`), which is what regresses silently.
 *
 *   A1  planSfAutoResolve: the reliable argv SEQUENCE + the InvalidPackageIdError
 *       regression — `0Ho` resolved BEFORE `package version report`; the report
 *       step uses `--package <04t>`, NEVER `--packages` and NEVER the raw name;
 *       version-list uses `--packages <0Ho>`, never the name; real per-command
 *       flags (`--target-dev-hub` on package*, `--target-org`/`--query` on data)
 *   A2  short-circuit: a known packageId / versionId drops the matching step
 *   A3  normalizeVersionString: all-present → dotted; ANY absent → `unknown`,
 *       NEVER `"undefined.undefined.undefined.undefined"`, never `includes("undefined")`
 *   A4  normalizeSecurityReviewed: fail-closed to `unknown`; `reviewed` ONLY on
 *       boolean true; a missing/null/false field never a false `reviewed`
 *   A5  normalizeVersionReport: empty coverage → corroborating/unknown, NOT `0% covered`
 *   A6  executor per-step degradation (injected runner): a status-1 keystone step
 *       degrades its OWN rows to `unknown` while the report rows + manifest flag
 *       still write — and NO row value contains the token `undefined`
 *   A7  no-devhub degrade: sets `sfAutoResolved:false`, writes NO sf-autoresolve.json,
 *       preserves the rest of the scope-manifest
 *   A8  cross-engine contract coherence: the emitted sf-autoresolve.json round-trips
 *       through renderSfAutoResolve() → the fixed block, no crash, no `undefined`
 *   A9  wiring: scope-submission frontmatter GRANTS `sf-autoresolve.mjs` and Step 4
 *       invokes the producer BEFORE the render (render block byte-unchanged)
 *   A10 CLI dry-run purity: --dry-run prints the sequence and writes nothing
 *
 * Dependency-free: `node acceptance/test-sf-autoresolve.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  planSfAutoResolve,
  normalizeVersionString,
  normalizeSecurityReviewed,
  normalizeVersionReport,
  runSfAutoResolve,
  PLACEHOLDER_PACKAGE_ID,
  PLACEHOLDER_VERSION_ID,
  AUTORESOLVE_SCHEMA,
} from '../harness/sf-autoresolve.mjs'
import { renderSfAutoResolve } from '../harness/render-sf-autoresolve.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const ENGINE = join(PLUGIN, 'harness', 'sf-autoresolve.mjs')

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`) } }
const box = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'srt-sfar-'))); dirs.push(d); return d }

console.log('sf-autoresolve standing test')

check('A1 planSfAutoResolve: reliable argv sequence + the InvalidPackageIdError regression', () => {
  const p = planSfAutoResolve({ packageName: 'MyPkg', devhub: 'acme-devhub' })
  assert.equal(p.schema, AUTORESOLVE_SCHEMA)
  assert.deepEqual(p.steps.map((s) => s.key), ['resolvePackage', 'resolveVersion', 'versionReport', 'subscriberVersion'])
  // the 0Ho id is resolved BEFORE the version report (the load-bearing order)
  const keys = p.steps.map((s) => s.key)
  assert.ok(keys.indexOf('resolvePackage') < keys.indexOf('versionReport'), '0Ho resolved before report')
  // THE regression: the report step uses a single --package <04t>, NEVER --packages, NEVER the raw name
  const report = p.steps.find((s) => s.key === 'versionReport')
  assert.ok(!report.argv.includes('--packages'), 'report never uses --packages (InvalidPackageIdError)')
  assert.ok(report.argv.includes('--package'), 'report uses --package')
  assert.ok(!report.argv.includes('MyPkg'), 'report argv never carries the raw package name')
  assert.equal(report.argv[report.argv.indexOf('--package') + 1], PLACEHOLDER_VERSION_ID)
  // version-list uses --packages with the 0Ho id (placeholder here), NEVER the human name
  const vlist = p.steps.find((s) => s.key === 'resolveVersion')
  assert.equal(vlist.argv[vlist.argv.indexOf('--packages') + 1], PLACEHOLDER_PACKAGE_ID)
  assert.ok(!vlist.argv.includes('MyPkg'), 'version-list never passes the name to --packages')
  // real per-command flags (verified against sf 2.137.7): package* → --target-dev-hub; data query → --target-org + --query
  assert.ok(p.steps.find((s) => s.key === 'resolvePackage').argv.includes('--target-dev-hub'))
  const keystone = p.steps.find((s) => s.key === 'subscriberVersion')
  assert.ok(keystone.argv.includes('--target-org'), 'data query threads --target-org')
  assert.ok(keystone.argv.includes('--query'), 'the SOQL is a --query flag value, not positional')
  assert.ok(keystone.argv.includes('--use-tooling-api'))
  assert.match(keystone.argv.join(' '), /SELECT IsSecurityReviewed, MajorVersion, MinorVersion, PatchVersion, BuildNumber FROM SubscriberPackageVersion/)
  // deterministic given inputs
  assert.deepEqual(p, planSfAutoResolve({ packageName: 'MyPkg', devhub: 'acme-devhub' }))
})

check('A2 short-circuit: a known packageId / versionId drops the matching resolution step', () => {
  const withPkg = planSfAutoResolve({ packageId: '0Ho000000000001', devhub: 'h' })
  assert.deepEqual(withPkg.steps.map((s) => s.key), ['resolveVersion', 'versionReport', 'subscriberVersion'])
  const rv = withPkg.steps.find((s) => s.key === 'resolveVersion')
  assert.equal(rv.argv[rv.argv.indexOf('--packages') + 1], '0Ho000000000001', 'the real 0Ho, not the placeholder')
  const withVer = planSfAutoResolve({ versionId: '04t000000000001', devhub: 'h' })
  assert.deepEqual(withVer.steps.map((s) => s.key), ['versionReport', 'subscriberVersion'])
  const rr = withVer.steps.find((s) => s.key === 'versionReport')
  assert.equal(rr.argv[rr.argv.indexOf('--package') + 1], '04t000000000001')
})

check('A3 normalizeVersionString: all-present → dotted; ANY absent → unknown, NEVER an undefined token', () => {
  assert.equal(normalizeVersionString({ major: 1, minor: 2, patch: 3, build: 4 }), '1.2.3.4')
  assert.equal(normalizeVersionString({ major: 0, minor: 0, patch: 0, build: 1 }), '0.0.0.1') // 0 is a valid part
  for (const bad of [
    null, undefined, {}, 'nope', 5,
    { major: 1, minor: 2, patch: 3 },                       // build absent
    { major: 1, minor: undefined, patch: 3, build: 4 },     // one undefined
    { major: '', minor: 2, patch: 3, build: 4 },            // one empty string
    { major: 1, minor: null, patch: 3, build: 4 },          // one null
    { major: 1, minor: 'undefined', patch: 3, build: 4 },   // literal "undefined" string
  ]) {
    const s = normalizeVersionString(bad)
    assert.equal(s, 'unknown', `absent/partial parts → unknown, got ${JSON.stringify(s)}`)
    assert.notEqual(s, 'undefined.undefined.undefined.undefined', 'the exact cold-run defect is locked out')
    assert.ok(!s.includes('undefined'), 'never contains the token "undefined"')
  }
})

check('A4 normalizeSecurityReviewed: fail-closed to unknown; reviewed ONLY on boolean true', () => {
  assert.equal(normalizeSecurityReviewed({ status: 0, result: { records: [{ IsSecurityReviewed: true }] } }), 'reviewed')
  assert.equal(normalizeSecurityReviewed({ status: 0, result: { records: [{ IsSecurityReviewed: false }] } }), 'not-reviewed')
  // fail-closed: null / absent / status-1 error / empty records / missing field / null field
  assert.equal(normalizeSecurityReviewed(null), 'unknown')
  assert.equal(normalizeSecurityReviewed(undefined), 'unknown')
  assert.equal(normalizeSecurityReviewed({ status: 1, result: null }), 'unknown', 'a status-1 errored raw fails closed')
  assert.equal(normalizeSecurityReviewed({ status: 0, result: { records: [] } }), 'unknown')
  assert.equal(normalizeSecurityReviewed({ status: 0, result: { records: [{}] } }), 'unknown', 'a missing field is never reviewed')
  assert.equal(normalizeSecurityReviewed({ status: 0, result: { records: [{ IsSecurityReviewed: null }] } }), 'unknown')
  // a truthy-but-not-true value NEVER yields a false-positive "reviewed"
  for (const v of ['true', 1, {}, 'yes', 'TRUE']) {
    assert.notEqual(normalizeSecurityReviewed({ result: { records: [{ IsSecurityReviewed: v }] } }), 'reviewed', `${JSON.stringify(v)} is not an explicit boolean true`)
  }
})

check('A5 normalizeVersionReport: empty coverage → corroborating/unknown, NOT "0% covered"; booleans carried', () => {
  const empty = normalizeVersionReport({ status: 0, result: { IsReleased: true, HasPassedCodeCoverageCheck: true, ValidationSkipped: false, CodeCoveragePercentages: [] } })
  assert.equal(empty.isReleased, true)
  assert.equal(empty.hasPassedCodeCoverageCheck, true)
  assert.equal(empty.validationSkipped, false)
  assert.ok(!empty.coverage.includes('0% covered'), 'empty coverage is NOT "0% covered"')
  assert.ok(!/0%/.test(empty.coverage), 'no fabricated 0% on empty coverage')
  assert.match(empty.coverage, /corroborating|unknown/)
  // error / null → every field unknown
  assert.deepEqual(normalizeVersionReport(null), { isReleased: 'unknown', hasPassedCodeCoverageCheck: 'unknown', validationSkipped: 'unknown', coverage: 'unknown' })
  assert.equal(normalizeVersionReport({ status: 1 }).coverage, 'unknown')
  // a real numeric coverage is carried but labeled corroborating (never authoritative)
  const covered = normalizeVersionReport({ result: { CodeCoveragePercentages: 85 } })
  assert.match(covered.coverage, /85/)
  assert.match(covered.coverage, /corroborating/)
})

check('A6 executor per-step degradation (injected runner): a status-1 keystone degrades its own rows; report + flag still write', () => {
  const b = box()
  const plan = planSfAutoResolve({ versionId: '04t000000000009', devhub: 'acme' }) // short-circuit → [versionReport, subscriberVersion]
  const runner = (cmd, args) => {
    if (args[0] === 'org' && args[1] === 'list') return JSON.stringify({ status: 0, result: { devHubs: [{ alias: 'acme', username: 'a@b.c' }] } })
    if (args.includes('report')) return JSON.stringify({ status: 0, result: { IsReleased: true, HasPassedCodeCoverageCheck: true, ValidationSkipped: false, CodeCoveragePercentages: [] } })
    if (args.includes('query')) throw Object.assign(new Error('sf data query failed'), { status: 1 }) // the keystone step throws
    throw new Error('unexpected argv: ' + args.join(' '))
  }
  const res = runSfAutoResolve(plan, { target: b, devhub: 'acme', generated: '2026-07-07', runner })
  assert.equal(res.status, 'resolved')
  assert.equal(res.sfAutoResolved, true)
  // the report rows still wrote (independent degradation)
  const byKey = Object.fromEntries(res.rows.map((r) => [r.key, r.value]))
  assert.equal(byKey.isReleased, true, 'report step wrote despite the keystone failing')
  // the keystone step degraded ITS OWN rows to unknown — never a fabricated version or a false "reviewed"
  assert.equal(byKey.version, 'unknown', 'a failed keystone degrades the version to unknown, never undefined.undefined…')
  assert.equal(byKey.isSecurityReviewed, 'unknown', 'a failed keystone fails closed to unknown, never a false reviewed')
  // NO row value anywhere contains the token "undefined"
  assert.ok(!JSON.stringify(res.rows).includes('undefined'), 'no row value contains the token "undefined"')
  // step log records independent per-step outcomes
  const log = Object.fromEntries(res.steps.map((s) => [s.step, s.ok]))
  assert.equal(log.versionReport, true)
  assert.equal(log.subscriberVersion, false)
  // the artifact + the manifest flag both wrote
  const outPath = join(b, '.security-review', 'sf-autoresolve.json')
  assert.ok(existsSync(outPath), 'sf-autoresolve.json written even with a degraded step')
  const ar = JSON.parse(readFileSync(outPath, 'utf8'))
  assert.equal(ar.generated, '2026-07-07')
  assert.deepEqual(ar.endpoints, [])
  const m = JSON.parse(readFileSync(join(b, '.security-review', 'scope-manifest.json'), 'utf8'))
  assert.equal(m.sfAutoResolved, true)
})

check('A7 no-devhub degrade: sfAutoResolved:false, no sf-autoresolve.json, scope-manifest preserved', () => {
  const b = box()
  mkdirSync(join(b, '.security-review'), { recursive: true })
  writeFileSync(join(b, '.security-review', 'scope-manifest.json'), JSON.stringify({ foo: 'bar', sfAutoResolved: true }))
  let spawned = 0
  const runner = (cmd, args) => {
    if (args[0] === 'org' && args[1] === 'list') return JSON.stringify({ status: 0, result: { devHubs: [] } }) // no hub authed
    spawned++
    throw new Error('a no-devhub degrade must never spawn a Tooling query')
  }
  const res = runSfAutoResolve(planSfAutoResolve({ packageName: 'X' }), { target: b, runner })
  assert.equal(res.status, 'no-devhub')
  assert.equal(res.sfAutoResolved, false)
  assert.equal(spawned, 0, 'no query spawned when no hub is authed')
  assert.ok(!existsSync(join(b, '.security-review', 'sf-autoresolve.json')), 'nothing written on no-devhub')
  const m = JSON.parse(readFileSync(join(b, '.security-review', 'scope-manifest.json'), 'utf8'))
  assert.equal(m.sfAutoResolved, false, 'the flag flips to false')
  assert.equal(m.foo, 'bar', 'the rest of the manifest is preserved')
})

check('A8 cross-engine contract coherence: emitted sf-autoresolve.json round-trips through renderSfAutoResolve() — no crash', () => {
  const b = box()
  const plan = planSfAutoResolve({ versionId: '04t000000000009', devhub: 'acme' })
  const runner = (cmd, args) => {
    if (args[0] === 'org' && args[1] === 'list') return JSON.stringify({ status: 0, result: { devHubs: [{ alias: 'acme' }] } })
    if (args.includes('report')) return JSON.stringify({ status: 0, result: { IsReleased: true, HasPassedCodeCoverageCheck: true, ValidationSkipped: false, CodeCoveragePercentages: [] } })
    if (args.includes('query')) return JSON.stringify({ status: 0, result: { records: [{ IsSecurityReviewed: false, MajorVersion: 1, MinorVersion: 2, PatchVersion: 3, BuildNumber: 4 }] } })
    throw new Error('unexpected argv')
  }
  runSfAutoResolve(plan, { target: b, devhub: 'acme', generated: '2026-07-07', runner })
  const ar = JSON.parse(readFileSync(join(b, '.security-review', 'sf-autoresolve.json'), 'utf8'))
  // the PRODUCER's JSON feeds the FROZEN render unchanged → the fixed block, no throw
  const block = renderSfAutoResolve({ autoresolve: ar, manifest: { sfAutoResolved: true } })
  assert.match(block, /### SF-CLI auto-resolution — 2026-07-07 · DevHub acme/)
  assert.match(block, /\| version \| 1\.2\.3\.4 \|/, 'the keystone version row renders')
  assert.match(block, /\| isSecurityReviewed \| not-reviewed \|/, 'the fail-closed reviewed row renders')
  assert.match(block, /\| isReleased \| true \|/)
  assert.ok(!block.includes('undefined'), 'the rendered block never contains an undefined token')
  // and the manifest flag gates it: false → the honest skipped line (proves the contract both ways)
  assert.match(renderSfAutoResolve({ autoresolve: ar, manifest: { sfAutoResolved: false } }), /Auto-resolution skipped/)
})

check('A9 wiring: scope-submission grants the producer + Step 4 runs it BEFORE the render (render byte-unchanged)', () => {
  const skill = readFileSync(join(PLUGIN, 'skills', 'scope-submission', 'SKILL.md'), 'utf8')
  // AUDIT CORRECTION #1 — the frontmatter grants the new producer engine
  assert.match(skill, /Bash\(node \*harness\/sf-autoresolve\.mjs \*\)/, 'frontmatter grants sf-autoresolve.mjs')
  // the render grant is still present (append, never a full-line replace)
  assert.match(skill, /Bash\(node \*harness\/render-sf-autoresolve\.mjs \*\)/, 'render grant preserved')
  // Step 4 invokes the producer, then the render
  assert.match(skill, /harness\/sf-autoresolve\.mjs --target/, 'step 4 invokes the producer')
  assert.match(skill, /render-sf-autoresolve\.mjs --target/, 'step 4 still calls the render')
  const prodIdx = skill.indexOf('harness/sf-autoresolve.mjs --target')
  const renderIdx = skill.indexOf('render-sf-autoresolve.mjs --target')
  assert.ok(prodIdx >= 0 && renderIdx >= 0 && prodIdx < renderIdx, 'the producer runs BEFORE the render')
  // the InvalidPackageIdError rule is prescribed in prose
  assert.match(skill, /InvalidPackageIdError/, 'the never-`--packages <NAME>` rule is stated')
})

check('A10 CLI dry-run purity: --dry-run prints the sequence and writes nothing', () => {
  const b = box()
  const out = execFileSync('node', [ENGINE, '--dry-run', '--target', b, '--package-name', 'X', '--json'], { encoding: 'utf8' })
  const j = JSON.parse(out)
  assert.equal(j.status, 'planned')
  assert.deepEqual(j.plan.steps.map((s) => s.key), ['resolvePackage', 'resolveVersion', 'versionReport', 'subscriberVersion'])
  assert.ok(!existsSync(join(b, '.security-review', 'sf-autoresolve.json')), 'dry-run performs no live op — nothing written')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

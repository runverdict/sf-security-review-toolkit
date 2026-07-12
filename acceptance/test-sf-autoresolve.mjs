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
 *   A11 honest degrade (the nested-repo cold-run defect): EVERY row unknown →
 *       status `degraded` + `sfAutoResolved:false` + manifest flag false — a
 *       consumer must never read "resolved" over an artifact that carries nothing
 *   A12 the `resolved` threshold: ONE non-unknown resolvable row is enough —
 *       a partial resolve stays `resolved` / `sfAutoResolved:true` (per-step
 *       degradation is designed behavior, not a failure; A6 locks the same
 *       boundary from the per-step side)
 *   A16 released-signal reconciliation: report IsReleased:true on a concrete 04t
 *       + an EMPTY `--released` list → the inline `releasedReconciliation` row
 *       (names the quirk + the authoritative 04t), landed under `isReleased`,
 *       carried through the frozen render
 *   A17 both-agree: the `--released` list carries released rows → NO note
 *       (no false reconciliation when the signals agree)
 *   A18 fail-closed executor: a not-released / errored report → no note, no
 *       released claim, and the corroborating list is not even spawned
 *   A19 reconcileReleasedSignals (pure): fires ONLY on report-true + concrete
 *       04t + a ran-and-empty list; every other arm → null
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
  reconcileReleasedSignals,
  runSfAutoResolve,
  pickPackageId,
  packageRoster,
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
  assert.deepEqual(p.steps.map((s) => s.key), ['resolvePackage', 'resolveVersion', 'versionReport', 'subscriberVersion', 'releasedCorroboration'])
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
  // the released-list corroboration runs AFTER the report it corroborates, filters --released,
  // and scopes by the 0Ho placeholder until the executor resolves the real id
  const rel = p.steps.find((s) => s.key === 'releasedCorroboration')
  assert.ok(keys.indexOf('versionReport') < keys.indexOf('releasedCorroboration'), 'corroboration follows the report')
  assert.ok(rel.argv.includes('--released'), 'the corroborating list filters --released')
  assert.equal(rel.argv[rel.argv.indexOf('--packages') + 1], PLACEHOLDER_PACKAGE_ID)
  assert.ok(!rel.argv.includes('MyPkg'), 'the corroborating list never carries the raw name')
  // deterministic given inputs
  assert.deepEqual(p, planSfAutoResolve({ packageName: 'MyPkg', devhub: 'acme-devhub' }))
})

check('A2 short-circuit: a known packageId / versionId drops the matching resolution step', () => {
  const withPkg = planSfAutoResolve({ packageId: '0Ho000000000001', devhub: 'h' })
  assert.deepEqual(withPkg.steps.map((s) => s.key), ['resolveVersion', 'versionReport', 'subscriberVersion', 'releasedCorroboration'])
  const rv = withPkg.steps.find((s) => s.key === 'resolveVersion')
  assert.equal(rv.argv[rv.argv.indexOf('--packages') + 1], '0Ho000000000001', 'the real 0Ho, not the placeholder')
  const relP = withPkg.steps.find((s) => s.key === 'releasedCorroboration')
  assert.equal(relP.argv[relP.argv.indexOf('--packages') + 1], '0Ho000000000001', 'the corroboration scopes by the real 0Ho')
  const withVer = planSfAutoResolve({ versionId: '04t000000000001', devhub: 'h' })
  assert.deepEqual(withVer.steps.map((s) => s.key), ['versionReport', 'subscriberVersion', 'releasedCorroboration'])
  const rr = withVer.steps.find((s) => s.key === 'versionReport')
  assert.equal(rr.argv[rr.argv.indexOf('--package') + 1], '04t000000000001')
  const relV = withVer.steps.find((s) => s.key === 'releasedCorroboration')
  assert.ok(!relV.argv.includes('--packages'), 'a 04t-only plan corroborates hub-wide — no 0Ho to scope by')
  assert.ok(relV.argv.includes('--released'))
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
  const plan = planSfAutoResolve({ versionId: '04t000000000009', devhub: 'acme' }) // short-circuit → [versionReport, subscriberVersion, releasedCorroboration]
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
  assert.deepEqual(j.plan.steps.map((s) => s.key), ['resolvePackage', 'resolveVersion', 'versionReport', 'subscriberVersion', 'releasedCorroboration'])
  assert.ok(!existsSync(join(b, '.security-review', 'sf-autoresolve.json')), 'dry-run performs no live op — nothing written')
})

check('A11 honest degrade: EVERY row unknown → degraded + sfAutoResolved:false + manifest flag false', () => {
  const b = box()
  const plan = planSfAutoResolve({ versionId: '04t000000000009', devhub: 'acme' }) // [versionReport, subscriberVersion, releasedCorroboration]
  const runner = (cmd, args) => {
    if (args[0] === 'org' && args[1] === 'list') return JSON.stringify({ status: 0, result: { devHubs: [{ alias: 'acme' }] } })
    // the nested-repo cold run: the queries ran but returned nothing usable
    throw Object.assign(new Error('sf step failed'), { status: 1 })
  }
  const res = runSfAutoResolve(plan, { target: b, devhub: 'acme', generated: '2026-07-09', runner })
  // the defect: this used to report status:'resolved' + sfAutoResolved:true over six unknown rows
  assert.equal(res.status, 'degraded', 'all-unknown rows must NOT report "resolved"')
  assert.equal(res.sfAutoResolved, false, 'a consumer must not trust an artifact that carries nothing')
  assert.match(res.reason, /unknown/, 'the reason states nothing was resolved')
  assert.match(res.reason, /manually/, 'the reason points at the manual path')
  assert.ok(res.rows.length >= 1 && res.rows.every((r) => typeof r.value === 'string' && r.value.startsWith('unknown')), 'the trigger really is every-row-unknown')
  // the manifest flag flips false — the frozen render's gate shows the honest skipped line
  const m = JSON.parse(readFileSync(join(b, '.security-review', 'scope-manifest.json'), 'utf8'))
  assert.equal(m.sfAutoResolved, false, 'manifest flag is false on a degraded resolve')
  // the artifact still writes (an honest all-unknown trail), and no token "undefined"
  const ar = JSON.parse(readFileSync(join(b, '.security-review', 'sf-autoresolve.json'), 'utf8'))
  assert.ok(!JSON.stringify(ar).includes('undefined'), 'no row value contains the token "undefined"')
})

check('A12 resolved threshold: ONE non-unknown row keeps resolved/sfAutoResolved:true (partial resolve)', () => {
  const b = box()
  const plan = planSfAutoResolve({ versionId: '04t000000000009', devhub: 'acme' })
  const runner = (cmd, args) => {
    if (args[0] === 'org' && args[1] === 'list') return JSON.stringify({ status: 0, result: { devHubs: [{ alias: 'acme' }] } })
    // the report resolves exactly ONE real field; the keystone fails entirely
    if (args.includes('report')) return JSON.stringify({ status: 0, result: { IsReleased: true } })
    throw Object.assign(new Error('sf step failed'), { status: 1 })
  }
  const res = runSfAutoResolve(plan, { target: b, devhub: 'acme', generated: '2026-07-09', runner })
  assert.equal(res.status, 'resolved', '≥1 non-unknown resolvable row is the resolved threshold')
  assert.equal(res.sfAutoResolved, true, 'a partial resolve is still a resolve')
  const byKey = Object.fromEntries(res.rows.map((r) => [r.key, r.value]))
  assert.equal(byKey.isReleased, true, 'the one real row survived')
  assert.equal(byKey.version, 'unknown', 'the failed keystone still degraded honestly')
  const m = JSON.parse(readFileSync(join(b, '.security-review', 'scope-manifest.json'), 'utf8'))
  assert.equal(m.sfAutoResolved, true)
})

// ── A13/A14/A15 — package disambiguation (the all-unknown degrade root cause) ──
// A Dev Hub often carries two packages that SHARE a namespace (a rehearsal/dev
// package alongside the real one); with no --package-name the producer cannot pick
// and degraded EVERY row to unknown. These lock the fix: Name/Alias are unique keys,
// NamespacePrefix is not, and an ambiguous hub degrades LOUDLY (names the roster).
const twoNsPkgs = {
  status: 0,
  result: [
    { Id: '0Ho000000000RHR', Name: 'Meridian Rehearsal', NamespacePrefix: 'meridian', Alias: '' },
    { Id: '0Ho000000000REL', Name: 'Meridian Agent', NamespacePrefix: 'meridian', Alias: '' },
  ],
}

check('A13 pickPackageId: unique Name wins even when the namespace collides; ambiguous → null (never first-match)', () => {
  // exact Name disambiguates two packages that SHARE a namespace
  assert.equal(pickPackageId(twoNsPkgs, 'Meridian Agent'), '0Ho000000000REL')
  assert.equal(pickPackageId(twoNsPkgs, 'Meridian Rehearsal'), '0Ho000000000RHR')
  // the shared namespace is NOT a unique key → must NOT resolve to the first row
  assert.equal(pickPackageId(twoNsPkgs, 'meridian'), null, 'a namespace shared by >1 package is ambiguous — never guess')
  // no name + >1 package → degrade, never pick arbitrarily
  assert.equal(pickPackageId(twoNsPkgs, null), null)
  // a lone package with no name is still unambiguous
  assert.equal(pickPackageId({ status: 0, result: [{ Id: '0Ho000000000ONE', Name: 'Solo', NamespacePrefix: 'solo' }] }, null), '0Ho000000000ONE')
  // the roster surfaces the human-readable names for the loud degrade
  assert.deepEqual(packageRoster(twoNsPkgs), ['Meridian Rehearsal', 'Meridian Agent'])
})

check('A14 executor: a multi-package hub + no --package-name degrades LOUDLY, naming the roster (not a silent all-unknown)', () => {
  const b = box()
  const plan = planSfAutoResolve({ devhub: 'acme' }) // no packageName → the degrade-triggering invocation
  const runner = (cmd, args) => {
    if (args[0] === 'org' && args[1] === 'list') return JSON.stringify({ status: 0, result: { devHubs: [{ alias: 'acme' }] } })
    if (args[0] === 'package' && args[1] === 'list') return JSON.stringify(twoNsPkgs)
    throw Object.assign(new Error('no 04t to query'), { status: 1 }) // downstream steps have no version id
  }
  const res = runSfAutoResolve(plan, { target: b, devhub: 'acme', generated: '2026-07-10', runner })
  assert.equal(res.status, 'degraded', 'ambiguous package list must degrade, not resolve')
  assert.match(res.reason, /2 packages on the DevHub/, 'the reason states the ambiguity, not a generic hint')
  assert.match(res.reason, /Meridian Rehearsal/, 'the reason NAMES the packages found')
  assert.match(res.reason, /Meridian Agent/)
  assert.match(res.reason, /--package-name/, 'the reason states the exact fix')
  const pkgStep = res.steps.find((s) => s.step === 'resolvePackage')
  assert.equal(pkgStep.ok, false)
  assert.deepEqual(pkgStep.roster, ['Meridian Rehearsal', 'Meridian Agent'], 'the roster is carried in the step log')
})

check('A15 executor: --package-name resolves the right package on a namespace-colliding hub', () => {
  const b = box()
  const plan = planSfAutoResolve({ packageName: 'Meridian Agent', devhub: 'acme' })
  let queriedVersionsFor = null
  const runner = (cmd, args) => {
    if (args[0] === 'org' && args[1] === 'list') return JSON.stringify({ status: 0, result: { devHubs: [{ alias: 'acme' }] } })
    if (args[0] === 'package' && args[1] === 'list') return JSON.stringify(twoNsPkgs)
    if (args[0] === 'package' && args[1] === 'version' && args[2] === 'list') {
      queriedVersionsFor = args[args.indexOf('--packages') + 1]
      return JSON.stringify({ status: 0, result: [{ SubscriberPackageVersionId: '04t000000000REL', IsReleased: true, MajorVersion: 1, MinorVersion: 0, PatchVersion: 0, BuildNumber: 1 }] })
    }
    if (args.includes('report')) return JSON.stringify({ status: 0, result: { IsReleased: true } })
    if (args.includes('--use-tooling-api')) return JSON.stringify({ status: 0, result: { records: [{ IsSecurityReviewed: false, MajorVersion: 1, MinorVersion: 0, PatchVersion: 0, BuildNumber: 1 }] } })
    throw Object.assign(new Error('unexpected'), { status: 1 })
  }
  const res = runSfAutoResolve(plan, { target: b, devhub: 'acme', generated: '2026-07-10', runner })
  assert.equal(queriedVersionsFor, '0Ho000000000REL', 'version list must query the CORRECT (Meridian Agent) 0Ho, not the rehearsal package')
  assert.equal(res.status, 'resolved')
  assert.equal(res.sfAutoResolved, true)
})

// ── A16/A17/A18/A19 — released-signal reconciliation (the four-contradicting-
// sources cold run). `version report` confirmed IsReleased:true on a concrete 04t
// while `sf package version list --released` returned 0 rows, and the driver had
// to investigate the contradiction manually. These lock the INLINE reconciliation:
// the note fires on exactly that disagreement, never when the signals agree, and
// never fabricates a released status when the report is not-released/unknown.
const hubOk = JSON.stringify({ status: 0, result: { devHubs: [{ alias: 'hub' }] } })
const reconRunner = ({ releasedListJson, reportJson, onReleased }) => (cmd, args) => {
  if (args[0] === 'org' && args[1] === 'list') return hubOk
  if (args[0] === 'package' && args[1] === 'version' && args[2] === 'list' && args.includes('--released')) {
    if (onReleased) onReleased(args)
    return releasedListJson
  }
  if (args[0] === 'package' && args[1] === 'version' && args[2] === 'list') {
    return JSON.stringify({ status: 0, result: [{ SubscriberPackageVersionId: '04txx0000000000', IsReleased: true, MajorVersion: 1, MinorVersion: 0, PatchVersion: 0, BuildNumber: 1 }] })
  }
  if (args.includes('report')) return reportJson
  if (args.includes('--use-tooling-api')) return JSON.stringify({ status: 0, result: { records: [{ IsSecurityReviewed: false, MajorVersion: 1, MinorVersion: 0, PatchVersion: 0, BuildNumber: 1 }] } })
  throw Object.assign(new Error('unexpected argv: ' + args.join(' ')), { status: 1 })
}
const reportReleasedTrue = JSON.stringify({ status: 0, result: { IsReleased: true, HasPassedCodeCoverageCheck: true, ValidationSkipped: false, CodeCoveragePercentages: [] } })

check('A16 reconciliation: report IsReleased:true on a concrete 04t + an EMPTY --released list → the inline note', () => {
  const b = box()
  const plan = planSfAutoResolve({ packageId: '0Hoxx0000000000', devhub: 'hub' })
  let releasedArgv = null
  const runner = reconRunner({
    releasedListJson: JSON.stringify({ status: 0, result: [] }), // the cold-run quirk: 0 released rows
    reportJson: reportReleasedTrue,
    onReleased: (args) => { releasedArgv = args },
  })
  const res = runSfAutoResolve(plan, { target: b, devhub: 'hub', generated: '2026-07-12', runner })
  assert.equal(res.status, 'resolved')
  // the corroborating list really ran: --released, scoped by the known 0Ho
  assert.ok(releasedArgv && releasedArgv.includes('--released'), 'the corroborating --released list was spawned')
  assert.equal(releasedArgv[releasedArgv.indexOf('--packages') + 1], '0Hoxx0000000000')
  assert.equal(res.steps.find((s) => s.step === 'releasedCorroboration').ok, true)
  // the note: the confirming source, the disagreeing source, the quirk, the call, the 04t
  const note = res.rows.find((r) => r.key === 'releasedReconciliation')
  assert.ok(note, 'the disagreement carries an inline reconciliation row')
  assert.match(note.value, /04txx0000000000/, 'names the authoritative 04t')
  assert.match(note.value, /version report/, 'names the confirming source')
  assert.match(note.value, /IsReleased:true/)
  assert.match(note.value, /--released/, 'names the disagreeing source')
  assert.match(note.value, /0 rows/, 'states what the list returned')
  assert.match(note.value, /quirk/, 'names the quirk')
  assert.match(note.value, /NOT a blocker/, 'states the not-a-blocker call')
  assert.match(note.value, /authoritative/, 'states which signal wins')
  assert.equal(note.provenance, 'automated')
  // the note lands DIRECTLY under the isReleased row it reconciles, and the claim
  // itself stays the report boolean — reconciled, not overwritten
  const at = res.rows.findIndex((r) => r.key === 'isReleased')
  assert.equal(res.rows[at].value, true)
  assert.equal(res.rows[at + 1].key, 'releasedReconciliation', 'the note is inline with isReleased')
  // the artifact carries it and the FROZEN render surfaces it — the driver reads ONE line
  const ar = JSON.parse(readFileSync(join(b, '.security-review', 'sf-autoresolve.json'), 'utf8'))
  const block = renderSfAutoResolve({ autoresolve: ar, manifest: { sfAutoResolved: true } })
  assert.match(block, /releasedReconciliation/)
  assert.match(block, /quirk/)
  assert.match(block, /04txx0000000000/)
})

check('A17 both-agree: the --released list carries released rows → NO note (no false reconciliation)', () => {
  const b = box()
  const plan = planSfAutoResolve({ packageId: '0Hoxx0000000000', devhub: 'hub' })
  const runner = reconRunner({
    releasedListJson: JSON.stringify({ status: 0, result: [{ SubscriberPackageVersionId: '04txx0000000000', IsReleased: true }] }),
    reportJson: reportReleasedTrue,
  })
  const res = runSfAutoResolve(plan, { target: b, devhub: 'hub', generated: '2026-07-12', runner })
  assert.equal(res.status, 'resolved')
  const byKey = Object.fromEntries(res.rows.map((r) => [r.key, r.value]))
  assert.equal(byKey.isReleased, true, 'the released claim stands on its own')
  assert.ok(!res.rows.some((r) => r.key === 'releasedReconciliation'), 'agreeing signals carry NO note')
  assert.ok(!JSON.stringify(res.rows).includes('quirk'), 'no reconciliation prose anywhere in the rows')
  const ar = JSON.parse(readFileSync(join(b, '.security-review', 'sf-autoresolve.json'), 'utf8'))
  assert.ok(!JSON.stringify(ar).includes('releasedReconciliation'), 'the artifact carries no note either')
})

check('A18 fail-closed executor: a not-released / errored report → no note, no released claim, list not spawned', () => {
  // (a) report says IsReleased:false — the empty list AGREES on not-released; no note,
  //     and the corroborating list is never even spawned (nothing to corroborate)
  const b1 = box()
  let releasedSpawns = 0
  const runner1 = reconRunner({
    releasedListJson: JSON.stringify({ status: 0, result: [] }),
    reportJson: JSON.stringify({ status: 0, result: { IsReleased: false, HasPassedCodeCoverageCheck: true, ValidationSkipped: false } }),
    onReleased: () => { releasedSpawns++ },
  })
  const res1 = runSfAutoResolve(planSfAutoResolve({ packageId: '0Hoxx0000000000', devhub: 'hub' }), { target: b1, devhub: 'hub', generated: '2026-07-12', runner: runner1 })
  const byKey1 = Object.fromEntries(res1.rows.map((r) => [r.key, r.value]))
  assert.equal(byKey1.isReleased, false, 'the not-released report is carried faithfully')
  assert.ok(!res1.rows.some((r) => r.key === 'releasedReconciliation'), 'no note on a not-released report')
  assert.ok(!JSON.stringify(res1.rows).includes('CONFIRMED'), 'no released claim fabricated anywhere')
  assert.equal(releasedSpawns, 0, 'the corroborating list is not spawned without a released report')
  assert.match(res1.steps.find((s) => s.step === 'releasedCorroboration').reason, /skipped/)
  // (b) report errored (status 1 → unknown) — fail-closed the same way
  const b2 = box()
  const runner2 = reconRunner({
    releasedListJson: JSON.stringify({ status: 0, result: [] }),
    reportJson: JSON.stringify({ status: 1, message: 'report failed' }),
    onReleased: () => { releasedSpawns++ },
  })
  const res2 = runSfAutoResolve(planSfAutoResolve({ packageId: '0Hoxx0000000000', devhub: 'hub' }), { target: b2, devhub: 'hub', generated: '2026-07-12', runner: runner2 })
  const byKey2 = Object.fromEntries(res2.rows.map((r) => [r.key, r.value]))
  assert.equal(byKey2.isReleased, 'unknown', 'an errored report fails closed to unknown')
  assert.ok(!res2.rows.some((r) => r.key === 'releasedReconciliation'), 'no note on an unknown report')
  assert.equal(releasedSpawns, 0, 'the corroborating list is not spawned on an unknown report')
})

check('A19 reconcileReleasedSignals (pure): fires ONLY on report-true + concrete 04t + a ran-and-empty list', () => {
  const fire = reconcileReleasedSignals({ isReleased: true, versionId: '04txx0000000000', releasedList: { status: 0, result: [] } })
  assert.ok(typeof fire === 'string', 'the exact disagreement yields the note')
  assert.match(fire, /0 rows/)
  assert.match(fire, /04txx0000000000/)
  assert.ok(!fire.includes('undefined'), 'the note never carries the token "undefined"')
  // deterministic given inputs
  assert.equal(fire, reconcileReleasedSignals({ isReleased: true, versionId: '04txx0000000000', releasedList: { status: 0, result: [] } }))
  // every fail-closed arm → null (no note, no fabricated released status)
  assert.equal(reconcileReleasedSignals({ isReleased: 'unknown', versionId: '04txx0000000000', releasedList: { status: 0, result: [] } }), null, 'unknown report — never fabricate')
  assert.equal(reconcileReleasedSignals({ isReleased: false, versionId: '04txx0000000000', releasedList: { status: 0, result: [] } }), null, 'not-released + empty list AGREE — no note')
  assert.equal(reconcileReleasedSignals({ isReleased: true, versionId: PLACEHOLDER_VERSION_ID, releasedList: { status: 0, result: [] } }), null, 'a placeholder is never an authoritative 04t')
  assert.equal(reconcileReleasedSignals({ isReleased: true, versionId: '0Hoxx0000000000', releasedList: { status: 0, result: [] } }), null, 'a 0Ho is not a version id')
  assert.equal(reconcileReleasedSignals({ isReleased: true, versionId: null, releasedList: { status: 0, result: [] } }), null)
  assert.equal(reconcileReleasedSignals({ isReleased: true, versionId: '04txx0000000000', releasedList: null }), null, 'a list that never ran grounds no disagreement')
  assert.equal(reconcileReleasedSignals({ isReleased: true, versionId: '04txx0000000000', releasedList: { status: 1 } }), null, 'an errored list grounds no disagreement')
  assert.equal(reconcileReleasedSignals({ isReleased: true, versionId: '04txx0000000000', releasedList: { status: 0, result: {} } }), null, 'an unrecognized list shape grounds no claim')
  assert.equal(reconcileReleasedSignals({ isReleased: true, versionId: '04txx0000000000', releasedList: { status: 0, result: [{ IsReleased: true }] } }), null, 'a populated list agrees — no note')
  assert.equal(reconcileReleasedSignals(), null)
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

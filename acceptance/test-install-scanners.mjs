#!/usr/bin/env node
/**
 * Standing test for harness/install-scanners.mjs — the consented, tmp-scoped
 * scanner installer (0.6.0). The engine is the ONE harness file that touches the
 * network, so this test is split the way the engine is:
 *
 *   PURE planner (no I/O, byte-identical) — the bulk of the guard:
 *     P1  per-method plan shape (pip venv, binary url+sha256+archive, npm, git)
 *     P2  determinism: same inputs → byte-identical plan
 *     P3  binary with no pin for the platform → SKIPPED (PENDING-OWNER-RUN), never
 *         planned unverified; unknown tool per method → skipped
 *     P4  `only` filter; de-dup; pathPrepend = the per-tool bin dirs
 *     P5  assertSafeTmpRoot rejects '/', '', a repo-root/$HOME path, and a path
 *         outside the temp/.cache bases; accepts a boxed sf-srt sub-path
 *     P6  installCommands per method
 *
 *   IMPURE executor — exercised HERMETICALLY (no network):
 *     E1  consent gate: installScanners() without consent THROWS (the P0 boundary)
 *     E2  --dry-run writes a `planned` manifest + project pointer; no install
 *     E3  git method via a LOCAL bare repo → installed, expectedBin executable,
 *         manifest + pointer + pathPrepend correct
 *     E4  binary checksum GOOD via a file:// URL → installed (raw → chmod +x)
 *     E5  binary checksum BAD via a file:// URL → failed, expectedBin NEVER created
 *         (an unverified binary is never executed), download removed
 *
 * Dependency-free: `node acceptance/test-install-scanners.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync,
  chmodSync, statSync, realpathSync,
} from 'node:fs'
import { join, sep } from 'node:path'
import { tmpdir, homedir, platform as osPlatform, arch as osArch } from 'node:os'
import { createHash } from 'node:crypto'
import {
  planInstalls, installScanners, installCommands, assertSafeTmpRoot, MANIFEST_SCHEMA,
} from '../harness/install-scanners.mjs'

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`) }
}
const mkroot = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'sf-srt-test-'))); dirs.push(d); return d }
const isExec = (p) => { try { const s = statSync(p); return s.isFile() && (s.mode & 0o111) !== 0 } catch { return false } }
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

// A fixed installable set covering all four methods (mirrors tool-detect output).
const MISSING = [
  { name: 'semgrep', family: 'external-sast', install: 'pip' },
  { name: 'osv-scanner', family: 'external-sca-iac', install: 'binary' },
  { name: 'retire', family: 'dependency-audit', install: 'npm' },
  { name: 'testssl', family: 'tls', install: 'git' },
]
const ROOT0 = join(tmpdir(), 'sf-srt-scanners', 'fixed-run')
const planFixed = (extra = {}) => planInstalls(MISSING, { runId: 'fixed-run', tmpRoot: ROOT0, platform: 'linux', arch: 'x64', ...extra })

console.log('install-scanners standing test')

// ── PURE planner ──────────────────────────────────────────────────────────────
check('P1 per-method plan shape (pip venv, binary url+sha256+archive, npm, git)', () => {
  const p = planFixed()
  const byName = Object.fromEntries(p.installs.map((i) => [i.name, i]))
  // pip
  const sg = byName['semgrep']
  assert.equal(sg.method, 'pip')
  assert.equal(sg.expectedBin, join(ROOT0, 'semgrep', 'venv', 'bin', 'semgrep'))
  assert.equal(sg.binDir, join(ROOT0, 'semgrep', 'venv', 'bin'))
  // binary (pinned) — has a real pin + sha256 + the matching platform asset
  const osv = byName['osv-scanner']
  assert.equal(osv.method, 'binary')
  assert.equal(osv.version, '2.4.0')
  assert.equal(osv.archive, 'none')
  assert.match(osv.checksum, /^[0-9a-f]{64}$/)
  assert.ok(osv.source.startsWith('https://github.com/google/osv-scanner/releases/download/v2.4.0/'))
  assert.equal(osv.expectedBin, join(ROOT0, 'osv-scanner', 'osv-scanner'))
  // npm
  const re = byName['retire']
  assert.equal(re.method, 'npm')
  assert.equal(re.expectedBin, join(ROOT0, 'retire', 'node_modules', '.bin', 'retire'))
  // git
  const ts = byName['testssl']
  assert.equal(ts.method, 'git')
  assert.equal(ts.source, 'https://github.com/testssl/testssl.sh.git')
  assert.equal(ts.expectedBin, join(ROOT0, 'testssl', 'testssl.sh', 'testssl.sh'))
  assert.equal(p.schema, MANIFEST_SCHEMA)
})

check('P2 determinism: same inputs → byte-identical plan', () => {
  assert.equal(JSON.stringify(planFixed()), JSON.stringify(planFixed()))
})

check('P3 binary with no pin for the platform → SKIPPED, not planned unverified', () => {
  // win32 has no pinned osv-scanner asset → it must skip, never appear in installs.
  const p = planInstalls(MISSING, { runId: 'r', tmpRoot: ROOT0, platform: 'win32', arch: 'x64' })
  assert.ok(!p.installs.some((i) => i.name === 'osv-scanner'), 'osv-scanner must not be planned on an unpinned platform')
  assert.ok(p.skipped.some((s) => s.name === 'osv-scanner' && /no pinned/.test(s.reason)))
  // an unknown binary tool (no pin entry at all) also skips
  const p2 = planInstalls([{ name: 'madeup-scanner', family: 'external-sast', install: 'binary' }], { runId: 'r', tmpRoot: ROOT0, platform: 'linux', arch: 'x64' })
  assert.equal(p2.installs.length, 0)
  assert.ok(p2.skipped.some((s) => s.name === 'madeup-scanner' && /no pinned/.test(s.reason)))
})

check('P3b the pinned Go binaries (gosec/trivy/nuclei) DO plan on linux-x64, with sha256 + correct archive', () => {
  const want = [
    { name: 'gosec', family: 'external-sast', install: 'binary', archive: 'tar.gz' },
    { name: 'trivy', family: 'external-sca-iac', install: 'binary', archive: 'tar.gz' },
    { name: 'nuclei', family: 'dast', install: 'binary', archive: 'zip' },
  ]
  const p = planInstalls(want, { runId: 'r', tmpRoot: ROOT0, platform: 'linux', arch: 'x64' })
  assert.equal(p.skipped.length, 0, 'all three are pinned for linux-x64')
  for (const w of want) {
    const i = p.installs.find((x) => x.name === w.name)
    assert.ok(i, `${w.name} planned`)
    assert.equal(i.archive, w.archive)
    assert.match(i.checksum, /^[0-9a-f]{64}$/)
    assert.equal(i.expectedBin, join(ROOT0, w.name, w.name))
  }
})

check('P4 only-filter, de-dup, pathPrepend = per-tool bin dirs', () => {
  const p = planFixed({ only: ['semgrep', 'testssl'] })
  assert.deepEqual(p.installs.map((i) => i.name).sort(), ['semgrep', 'testssl'])
  // de-dup: a repeated entry collapses
  const dup = planInstalls([MISSING[0], MISSING[0]], { runId: 'r', tmpRoot: ROOT0, platform: 'linux', arch: 'x64' })
  assert.equal(dup.installs.length, 1)
  // pathPrepend mirrors the planned installs' binDirs
  assert.deepEqual(p.pathPrepend, p.installs.map((i) => i.binDir))
})

check('P5 assertSafeTmpRoot rejects dangerous roots (incl. the shared group dir), accepts a boxed sub-path', () => {
  for (const bad of ['', '/', sep, process.cwd(), homedir(), join(homedir(), 'projects', 'app'), join(tmpdir(), 'not-ours', 'x')]) {
    assert.throws(() => assertSafeTmpRoot(bad), new RegExp('unsafe tmp root'), `should reject ${bad}`)
  }
  // the temp dir base itself is rejected (must be a sub-path, not the base)
  assert.throws(() => assertSafeTmpRoot(tmpdir()), /unsafe tmp root/)
  // the SHARED grouping dirs are rejected — a degenerate run-id collapsing onto one must
  // not become an rm -rf target that nukes concurrent runs (audit #8 + the 0.7.0 trees)
  for (const g of ['sf-srt-scanners', 'sf-srt-stack', 'sf-srt-dast', 'sf-srt-net']) {
    assert.throws(() => assertSafeTmpRoot(join(tmpdir(), g)), /grouping dir/, `should reject the bare ${g} group dir`)
  }
  // a boxed per-run path is accepted
  assert.equal(assertSafeTmpRoot(join(tmpdir(), 'sf-srt-scanners', 'abc')), join(tmpdir(), 'sf-srt-scanners', 'abc'))
})

check('P5b planInstalls rejects a degenerate run-id (empty / . / .. / path / space)', () => {
  for (const bad of ['', '.', '..', 'a/b', 'a b', '../x']) {
    assert.throws(() => planInstalls(MISSING, { runId: bad, tmpRoot: ROOT0, platform: 'linux', arch: 'x64' }), /run-id/, `should reject run-id '${bad}'`)
  }
  // a normal token is fine
  assert.ok(planInstalls(MISSING, { runId: 'ok-Run_1.2', tmpRoot: ROOT0, platform: 'linux', arch: 'x64' }).installs.length)
})

check('P6 installCommands per method', () => {
  const p = planFixed()
  const byName = Object.fromEntries(p.installs.map((i) => [i.name, i]))
  assert.deepEqual(installCommands(byName['semgrep']), byName['semgrep'].commands)
  assert.equal(byName['semgrep'].commands.length, 2)
  assert.match(byName['semgrep'].commands[0], /python3 -m venv/)
  assert.match(byName['osv-scanner'].commands[0], /^curl -fsSL -o /)
  assert.match(byName['osv-scanner'].commands[1], /^verify sha256/)
  assert.match(byName['retire'].commands[0], /npm install --prefix/)
  assert.match(byName['testssl'].commands[0], /git clone --depth 1/)
})

// ── IMPURE executor (hermetic) ──────────────────────────────────────────────
check('E1 consent gate: installScanners() without consent THROWS', () => {
  const root = join(mkroot(), 'sf-srt-scanners', 'e1')
  const plan = planInstalls(MISSING, { runId: 'e1', tmpRoot: root, platform: 'linux', arch: 'x64' })
  assert.throws(() => installScanners(plan, { consent: false }), /refusing to install without explicit consent/)
})

check('E2 --dry-run writes a planned manifest + pointer; no install performed', () => {
  const base = mkroot()
  const root = join(base, 'sf-srt-scanners', 'e2')
  const target = join(base, 'repo'); mkdirSync(target, { recursive: true })
  const plan = planInstalls(MISSING, { runId: 'e2', tmpRoot: root, platform: 'linux', arch: 'x64' })
  const m = installScanners(plan, { consent: false, dryRun: true, target })
  assert.equal(m.schema, MANIFEST_SCHEMA)
  assert.ok(m.installs.every((r) => r.status === 'planned'))
  assert.deepEqual(m.createdPaths, [root])
  assert.ok(existsSync(plan.manifestPath), 'manifest written')
  const ptr = JSON.parse(readFileSync(join(target, '.security-review', 'scanner-install.json'), 'utf8'))
  assert.equal(ptr.tmpRoot, root)
  assert.equal(ptr.manifestPath, plan.manifestPath)
  // nothing actually installed: no venv/clone dirs created
  assert.ok(!existsSync(join(root, 'semgrep', 'venv')))
})

check('E3 git method via a LOCAL repo → installed, executable, manifest+pointer correct', () => {
  const base = mkroot()
  // build a local git repo that contains an executable testssl.sh
  const srcRepo = join(base, 'testssl-src'); mkdirSync(srcRepo, { recursive: true })
  const g = (...a) => execFileSync('git', ['-C', srcRepo, ...a], { encoding: 'utf8' })
  writeFileSync(join(srcRepo, 'testssl.sh'), '#!/bin/sh\necho testssl\n'); chmodSync(join(srcRepo, 'testssl.sh'), 0o755)
  g('init', '-q'); g('config', 'user.email', 't@e.com'); g('config', 'user.name', 'T'); g('add', '-A'); g('commit', '-q', '-m', 'x')

  const root = join(base, 'sf-srt-scanners', 'e3')
  const target = join(base, 'repo'); mkdirSync(target, { recursive: true })
  // construct a plan whose git source is the LOCAL repo (no network)
  const plan = planInstalls([{ name: 'testssl', family: 'tls', install: 'git' }], { runId: 'e3', tmpRoot: root, platform: 'linux', arch: 'x64' })
  plan.installs[0].source = srcRepo
  plan.installs[0].commands = installCommands(plan.installs[0])
  const m = installScanners(plan, { consent: true, target })
  const rec = m.installs[0]
  assert.equal(rec.status, 'installed', rec.log)
  assert.ok(rec.runnable)
  assert.ok(isExec(rec.expectedBin), 'cloned testssl.sh is executable')
  assert.deepEqual(m.pathPrepend, [rec.binDir])
  const ptr = JSON.parse(readFileSync(join(target, '.security-review', 'scanner-install.json'), 'utf8'))
  assert.deepEqual(ptr.installed, ['testssl'])
})

check('E4 binary checksum GOOD (file:// URL) → installed, raw bin chmod +x', () => {
  const base = mkroot()
  const fake = join(base, 'osv-fake'); writeFileSync(fake, '#!/bin/sh\necho osv\n')
  const good = sha256(readFileSync(fake))
  const root = join(base, 'sf-srt-scanners', 'e4')
  const target = join(root, 'osv-scanner')
  const plan = {
    schema: MANIFEST_SCHEMA, runId: 'e4', tmpRoot: root, platform: 'linux', arch: 'x64',
    manifestPath: join(root, 'install-manifest.json'), pointerRel: join('.security-review', 'scanner-install.json'),
    skipped: [], pathPrepend: [target],
    installs: [{
      name: 'osv-scanner', family: 'external-sca-iac', method: 'binary', version: '2.4.0',
      targetDir: target, binDir: target, expectedBin: join(target, 'osv-scanner'),
      source: `file://${fake}`, download: join(target, 'osv-scanner_linux_amd64'), checksum: good, archive: 'none',
      commands: ['(hermetic)'],
    }],
  }
  const m = installScanners(plan, { consent: true })
  assert.equal(m.installs[0].status, 'installed', m.installs[0].log)
  assert.ok(isExec(join(target, 'osv-scanner')), 'verified raw binary is placed + executable')
})

check('E5 binary checksum BAD (file:// URL) → failed, bin NEVER created', () => {
  const base = mkroot()
  const fake = join(base, 'osv-evil'); writeFileSync(fake, 'tampered\n')
  const root = join(base, 'sf-srt-scanners', 'e5')
  const target = join(root, 'osv-scanner')
  const plan = {
    schema: MANIFEST_SCHEMA, runId: 'e5', tmpRoot: root, platform: 'linux', arch: 'x64',
    manifestPath: join(root, 'install-manifest.json'), pointerRel: join('.security-review', 'scanner-install.json'),
    skipped: [], pathPrepend: [target],
    installs: [{
      name: 'osv-scanner', family: 'external-sca-iac', method: 'binary', version: '2.4.0',
      targetDir: target, binDir: target, expectedBin: join(target, 'osv-scanner'),
      source: `file://${fake}`, download: join(target, 'osv-scanner_linux_amd64'),
      checksum: 'f'.repeat(64), archive: 'none', commands: ['(hermetic)'],
    }],
  }
  const m = installScanners(plan, { consent: true })
  assert.equal(m.installs[0].status, 'failed')
  assert.match(m.installs[0].log, /checksum mismatch/)
  assert.ok(!existsSync(join(target, 'osv-scanner')), 'an unverified binary must NEVER be placed/executed')
  assert.deepEqual(m.pathPrepend, [], 'a failed install contributes no PATH entry')
})

check('E6 extract-to-scratch (tar.gz): ONLY the verified binary lands on PATH, not the archive aux files', () => {
  const base = mkroot()
  // build a tar.gz carrying [mytool, LICENSE, evil] — only mytool may end up on PATH
  const stage = join(base, 'stage'); mkdirSync(stage, { recursive: true })
  writeFileSync(join(stage, 'mytool'), '#!/bin/sh\necho mytool\n'); chmodSync(join(stage, 'mytool'), 0o755)
  writeFileSync(join(stage, 'LICENSE'), 'license text')
  writeFileSync(join(stage, 'evil'), '#!/bin/sh\necho evil\n'); chmodSync(join(stage, 'evil'), 0o755)
  const tgz = join(base, 'mytool.tar.gz')
  execFileSync('tar', ['-czf', tgz, '-C', stage, '.'])
  const sum = sha256(readFileSync(tgz))
  const root = join(base, 'sf-srt-scanners', 'e6')
  const target = join(root, 'mytool')
  const plan = {
    schema: MANIFEST_SCHEMA, runId: 'e6', tmpRoot: root, platform: 'linux', arch: 'x64',
    manifestPath: join(root, 'install-manifest.json'), pointerRel: join('.security-review', 'scanner-install.json'),
    skipped: [], pathPrepend: [target],
    installs: [{
      name: 'mytool', family: 'external-sast', method: 'binary', version: '1.0.0',
      targetDir: target, binDir: target, expectedBin: join(target, 'mytool'), archiveBin: 'mytool',
      source: `file://${tgz}`, download: join(target, 'mytool.tar.gz'), checksum: sum, archive: 'tar.gz',
      commands: ['(hermetic)'],
    }],
  }
  const m = installScanners(plan, { consent: true })
  assert.equal(m.installs[0].status, 'installed', m.installs[0].log)
  assert.ok(isExec(join(target, 'mytool')), 'the verified binary is placed + executable')
  assert.ok(!existsSync(join(target, 'LICENSE')), 'archive LICENSE must NOT land on PATH')
  assert.ok(!existsSync(join(target, 'evil')), 'a second archive executable must NOT land on PATH')
  assert.ok(!existsSync(join(target, '_pkg')), 'the extraction scratch dir is removed')
  assert.ok(!existsSync(join(target, 'mytool.tar.gz')), 'the downloaded archive is removed')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

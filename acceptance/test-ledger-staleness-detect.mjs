#!/usr/bin/env node
/**
 * HERMETIC detect-path standing test for the resumption-fingerprint staleness
 * check (harness/ledger-staleness.mjs).
 *
 * WHY THIS EXISTS (beyond test-ledger-staleness.mjs). That sibling test exercises
 * only the PURE `staleFindings`/`latestAuditedCommit` helpers with clean,
 * hand-written paths. It never drove the git-shelling CLI `main()`, and it never
 * fed the engine the MESSY `finding.file` strings a real LLM finder writes:
 *   - comma/range line suffixes      `…/ForecastService.cls:5,15-19`
 *   - a single finding citing TWO files `server/index.js:27 and /abs/…/panel.html:7`
 *   - target-ABSOLUTE path tokens     `/home/.../force-app/.../panel.html`
 * Those shapes are exactly what a real cold-start run's ledger carries, and on
 * the unhardened engine each was silently reported "current" when its file had
 * changed — a FALSE NEGATIVE, the single worst direction for a staleness check
 * (the engine's own header says so). This test stands up a throwaway git repo,
 * writes a ledger mirroring those real shapes, advances HEAD with REAL commits,
 * and drives the CLI end to end — proving the detect-changed-code path flags the
 * right findings on BOTH sides and stays quiet on the unaffected ones.
 *
 * Dependency-free: `node acceptance/test-ledger-staleness-detect.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const STALENESS = fileURLToPath(new URL('../harness/ledger-staleness.mjs', import.meta.url))

let pass = 0, fail = 0
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`) }
}

// --- throwaway repo scaffolding ---------------------------------------------
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'srt-stale-')))
const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' }).trim()
const write = (rel, body) => {
  const p = join(ROOT, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, body)
}

// File layout mirrors the Lumina fixture's audited surface.
const CLS = 'force-app/main/default/classes/ForecastService.cls'
const CTRL = 'force-app/main/default/classes/ForecastController.cls'
const SRV = 'server/index.js'
const HTML = 'force-app/main/default/lwc/forecastPanel/forecastPanel.html'
const NC = 'force-app/main/default/namedCredentials/Lumina_API.namedCredential-meta.xml'

write(CLS, 'public without sharing class ForecastService {\n  // v1\n}\n')
write(CTRL, 'public with sharing class ForecastController {\n  // v1\n}\n')
write(SRV, "const express = require('express')\n// v1\n")
write(HTML, '<template><!-- v1 --></template>\n')
write(NC, '<?xml version="1.0"?><NamedCredential><!-- v1 --></NamedCredential>\n')
// Keep run state untracked across scenarios, exactly as a partner repo should
// (the gitignore-hygiene guidance). Without this `git add -A` would commit the
// ledger and a later `git reset --hard` would delete it mid-test.
write('.gitignore', '.security-review/\ndocs/security-review/\n')

git('init', '-q')
git('config', 'user.email', 'test@example.com')
git('config', 'user.name', 'SRT Test')
git('add', '-A')
git('commit', '-q', '-m', 'audited baseline')
const AUDITED = git('rev-parse', 'HEAD')

// Ledger uses the REAL messy file shapes. .security-review/ stays UNTRACKED,
// exactly as in a partner repo — the CLI reads it from the working tree.
const findings = [
  { id: 'cls-clean', dimension: 'apex-exposed-surface', status: 'confirmed', file: CLS },
  // comma/range line suffix — dropped by the unhardened normalizer
  { id: 'cls-range', dimension: 'apex-exposed-surface', status: 'confirmed', file: `${CLS}:5,15-19` },
  { id: 'srv-clean', dimension: 'oauth-identity', status: 'confirmed', file: SRV },
  // single finding citing TWO files, the second an ABSOLUTE path — dropped wholesale
  { id: 'srv-two', dimension: 'web-client', status: 'confirmed', file: `${SRV}:27 and ${join(ROOT, HTML)}:7` },
  // controller comma-range — dropped by the unhardened normalizer
  { id: 'ctrl-range', dimension: 'apex-exposed-surface', status: 'confirmed', file: `${CTRL}:5,12-15` },
  { id: 'nc', dimension: 'secrets-credentials', status: 'confirmed', file: NC },
]
write('.security-review/audit-ledger.json', JSON.stringify({ findings, passes: [{ id: 1, audited_commit: AUDITED }] }, null, 2))

// Drive the CLI; reset tracked files to AUDITED between scenarios so each diff
// is exactly the scenario's change (.security-review/ is untracked → survives).
const run = () => JSON.parse(execFileSync('node', [STALENESS, '--target', ROOT, '--json'], { encoding: 'utf8' }))
const editCommit = (edits, msg) => {
  git('reset', '-q', '--hard', AUDITED)
  for (const [rel, body] of edits) write(rel, body)
  git('add', '-A')
  git('commit', '-q', '-m', msg)
}
const ids = (r) => r.stale_findings.map((f) => f.id).sort()

console.log('ledger-staleness HERMETIC detect-path test')

// T0 — HEAD == audited → current, nothing stale.
check('no change since audit → status=current, 0 stale', () => {
  git('reset', '-q', '--hard', AUDITED)
  const r = run()
  assert.equal(r.status, 'current')
  assert.equal(r.audited_commit, AUDITED)
  assert.deepEqual(r.stale_findings, [])
})

// Side A — edit ForecastService.cls only. BOTH cls findings flag (incl. the
// :5,15-19 range shape); server/controller/namedcred/html stay current.
check('edit ForecastService.cls → both cls findings stale (incl. :5,15-19), nothing else', () => {
  editCommit([[CLS, 'public without sharing class ForecastService {\n  // v2 — IDOR fix in progress\n}\n']], 'edit cls')
  const r = run()
  assert.equal(r.status, 'stale', r.verdict)
  assert.equal(r.audited_commit, AUDITED)
  assert.notEqual(r.head, AUDITED)
  assert.deepEqual(ids(r), ['cls-clean', 'cls-range'])
})

// Side B — edit server/index.js only. Both server findings flag, INCLUDING the
// two-file finding (its first token is server/index.js); cls/controller/nc quiet.
check('edit server/index.js → srv-clean + srv-two stale, nothing else', () => {
  editCommit([[SRV, "const express = require('express')\n// v2 — jwt validation\n"]], 'edit server')
  const r = run()
  assert.equal(r.status, 'stale', r.verdict)
  assert.deepEqual(ids(r), ['srv-clean', 'srv-two'])
})

// Multi-file SECOND token — edit the html the two-file finding also cites (via an
// ABSOLUTE path). The two-file finding must flag; srv-clean must NOT (it only
// cites server/index.js).
check('edit panel.html (abs-path second token) → only srv-two stale', () => {
  editCommit([[HTML, '<template><!-- v2 --></template>\n']], 'edit html')
  const r = run()
  assert.equal(r.status, 'stale', r.verdict)
  assert.deepEqual(ids(r), ['srv-two'])
})

// Controller comma-range shape.
check('edit ForecastController.cls → only ctrl-range stale', () => {
  editCommit([[CTRL, 'public with sharing class ForecastController {\n  // v2\n}\n']], 'edit ctrl')
  const r = run()
  assert.equal(r.status, 'stale', r.verdict)
  assert.deepEqual(ids(r), ['ctrl-range'])
})

// Negative — change a file that backs no finding.
check('edit a file backing no finding → changed-but-unaffected, 0 stale', () => {
  editCommit([['README.md', '# readme v2\n']], 'edit readme')
  const r = run()
  assert.equal(r.status, 'changed-but-unaffected', r.verdict)
  assert.deepEqual(r.stale_findings, [])
})

// No-fingerprint guard via the CLI: a ledger whose latest pass lacks
// audited_commit → no-fingerprint (cannot verify), never a silent false "current".
check('ledger with no audited_commit → status=no-fingerprint', () => {
  git('reset', '-q', '--hard', AUDITED)
  write('.security-review/audit-ledger.json', JSON.stringify({ findings, passes: [{ id: 1 }] }, null, 2))
  const r = run()
  assert.equal(r.status, 'no-fingerprint')
  // restore the fingerprinted ledger for any later use
  write('.security-review/audit-ledger.json', JSON.stringify({ findings, passes: [{ id: 1, audited_commit: AUDITED }] }, null, 2))
})

rmSync(ROOT, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

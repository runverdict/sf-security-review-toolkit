#!/usr/bin/env node
/**
 * Standing test for build-evidence-index.mjs `--check` (0.8.105 — the evidence-index
 * COMPLETENESS lint). The index is driven by the driver-authored evidence-input, NOT
 * a glob over evidence/ — which is exactly how a scan gets run, ingested, and never
 * cited: on a real cold run, detect-secrets-2026-07-08.json had 161 findings ingested
 * yet appeared nowhere in index.json, and opengrep-2026-07-08.sarif was the second
 * orphan of the same driver-authorship bug class. Un-indexed evidence earns no
 * requirement credit in compute-sci / compile-submission, so an orphan must fail LOUD.
 *
 * Guards:
 *   EI1 — an evidence dir with an unindexed file → the orphan is reported BY NAME,
 *         exit 2 (an indexed sibling is NOT reported). [mut2: glob-the-index → RED]
 *   EI2 — a fully-indexed dir → clean, exit 0.
 *   EI3 — `--check` NEVER mutates index.json (byte-compare before/after, on both
 *         the orphaned and the clean dir).
 *   EI4 — the exact cold-run shape: a valid detect-secrets report AND an
 *         opengrep-*.sarif, both on disk, both absent from the index → BOTH
 *         reported. [mut2: → RED]
 *   EI5 — THE EXCLUSION LOCK: a dir containing ONLY index.json, a *.provenance.json
 *         sidecar, and a dast/ subdirectory reports ZERO orphans, exit 0 — the
 *         index never lists itself, sidecars ride their artifact, and enumeration
 *         is top-level-files-only. [mut3: drop the index.json exclusion → RED]
 *
 * Dependency-free: `node acceptance/test-evidence-index-completeness.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const BUILD = join(PLUGIN, 'harness', 'build-evidence-index.mjs')

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

// Build a target repo with an evidence dir. `files` = top-level evidence file names to
// create; `indexedNames` = the subset the written index.json cites (null = NO index).
function makeRepo({ files = [], indexedNames = null, extraIndexLocations = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'eic-test-'))
  dirs.push(dir)
  const ev = join(dir, '.security-review', 'evidence')
  mkdirSync(ev, { recursive: true })
  for (const f of files) writeFileSync(join(ev, f), JSON.stringify({ probe: f }))
  if (indexedNames !== null) {
    const entries = [
      ...indexedNames.map((n) => ({
        ref_type: 'scan', ref_id: `run-scans:${n}`, source: 'run-scans', collected_by: 'scanner',
        verified: { value: true, how: 'scanner exit + parsed report on disk' },
        reviewer_reproducible: true, location: `.security-review/evidence/${n}`,
        disposition: 'satisfied', timestamp: '2026-07-08',
      })),
      ...extraIndexLocations.map((loc) => ({
        ref_type: 'requirement', ref_id: 'dast-self-run-required', source: 'run-scans', collected_by: 'agent',
        verified: { value: false, how: 'agent prepared plan; owner action remains' },
        reviewer_reproducible: false, location: loc, disposition: 'pending-owner', timestamp: '2026-07-08',
      })),
    ]
    writeFileSync(join(ev, 'index.json'), JSON.stringify({ schema_version: 1, generated: '2026-07-08', entries }, null, 2))
  }
  return dir
}

// Run `--check`; execFileSync throws on non-zero exit, so normalize to {status, stdout, stderr}.
// stderr is PIPED (not inherited) so the expected orphan reports don't leak into test output.
function runCheck(dir) {
  try {
    const stdout = execFileSync('node', [BUILD, '--repo', dir, '--check'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { status: 0, stdout, stderr: '' }
  } catch (e) {
    return { status: e.status, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

check('EI1 an unindexed evidence file → the orphan is reported BY NAME, exit 2 (the indexed sibling is not)', () => {
  const dir = makeRepo({ files: ['semgrep-2026-07-08.json', 'bandit-2026-07-08.json'], indexedNames: ['semgrep-2026-07-08.json'] })
  const r = runCheck(dir)
  assert.equal(r.status, 2, `expected exit 2, got ${r.status}\n${r.stdout}${r.stderr}`)
  assert.match(r.stderr, /ORPHAN bandit-2026-07-08\.json/)
  assert.ok(!/ORPHAN semgrep-2026-07-08\.json/.test(r.stderr), 'the indexed file must NOT be reported')
})

check('EI2 a fully-indexed dir → clean, exit 0', () => {
  const dir = makeRepo({ files: ['semgrep-2026-07-08.json', 'redos-2026-07-08.txt'], indexedNames: ['semgrep-2026-07-08.json', 'redos-2026-07-08.txt'] })
  const r = runCheck(dir)
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}\n${r.stdout}${r.stderr}`)
  assert.match(r.stdout, /all indexed \(clean\)/)
  assert.ok(!/ORPHAN/.test(r.stdout + r.stderr))
})

check('EI3 --check NEVER mutates index.json (byte-compare before/after, orphaned AND clean dir)', () => {
  const orphaned = makeRepo({ files: ['a.json', 'b.sarif'], indexedNames: ['a.json'] })
  const clean = makeRepo({ files: ['a.json'], indexedNames: ['a.json'] })
  for (const dir of [orphaned, clean]) {
    const p = join(dir, '.security-review', 'evidence', 'index.json')
    const before = readFileSync(p)
    runCheck(dir)
    const after = readFileSync(p)
    assert.ok(before.equals(after), `--check mutated index.json in ${dir}`)
  }
})

check('EI4 the exact cold-run shape: a valid detect-secrets report AND an opengrep-*.sarif, both on disk, both unindexed → BOTH reported', () => {
  const dir = makeRepo({
    files: ['semgrep-2026-07-08.json', 'opengrep-2026-07-08.json'],
    indexedNames: ['semgrep-2026-07-08.json', 'opengrep-2026-07-08.json'],
  })
  const ev = join(dir, '.security-review', 'evidence')
  // a VALID detect-secrets report (the real shape: version + per-file results + generated_at)
  writeFileSync(join(ev, 'detect-secrets-2026-07-08.json'), JSON.stringify({
    version: '1.5.0',
    plugins_used: [{ name: 'Base64HighEntropyString', limit: 4.5 }],
    filters_used: [{ path: 'detect_secrets.filters.allowlist.is_line_allowlisted' }],
    results: { 'mcp/server.py': [{ type: 'Secret Keyword', filename: 'mcp/server.py', hashed_secret: 'abc123', is_verified: false, line_number: 27 }] },
    generated_at: '2026-07-08T16:52:00Z',
  }))
  // an opengrep SARIF (both on disk, both absent from the index — the cold-run orphan pair)
  writeFileSync(join(ev, 'opengrep-2026-07-08.sarif'), JSON.stringify({
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json', version: '2.1.0',
    runs: [{ tool: { driver: { name: 'Opengrep', semanticVersion: '1.25.0', rules: [] } }, results: [] }],
  }))
  const r = runCheck(dir)
  assert.equal(r.status, 2, `expected exit 2, got ${r.status}\n${r.stdout}${r.stderr}`)
  assert.match(r.stderr, /ORPHAN detect-secrets-2026-07-08\.json/)
  assert.match(r.stderr, /ORPHAN opengrep-2026-07-08\.sarif/)
  assert.match(r.stderr, /2 evidence file\(s\)/)
  assert.ok(!/ORPHAN semgrep/.test(r.stderr) && !/ORPHAN opengrep-2026-07-08\.json/.test(r.stderr))
})

check('EI5 THE EXCLUSION LOCK: only index.json + a *.provenance.json sidecar + a dast/ subdir → ZERO orphans, exit 0', () => {
  const dir = makeRepo({ files: [], indexedNames: [], extraIndexLocations: ['.security-review/evidence/dast/'] })
  const ev = join(dir, '.security-review', 'evidence')
  // the capture-* sidecar (rides its artifact, never independent scan evidence)
  writeFileSync(join(ev, 'openapi-2026-07-08.provenance.json'), JSON.stringify({ captured_by: 'capture-openapi', url: 'https://x.test/openapi.json' }))
  // the subdirectory (owner-run DAST plans — indexed as pending rows, not top-level files)
  mkdirSync(join(ev, 'dast'), { recursive: true })
  writeFileSync(join(ev, 'dast', 'zap-plan.yaml'), 'env: {}\n')
  const r = runCheck(dir)
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}\n${r.stdout}${r.stderr}`)
  assert.ok(!/ORPHAN/.test(r.stdout + r.stderr), `false orphan reported:\n${r.stdout}${r.stderr}`)
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best-effort */ } }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

#!/usr/bin/env node
/**
 * Standing test for the VERBATIM scan-status summary
 * (harness/render-scan-status.mjs, WI-05 / INV-13). A FIXED 8-row Family table in
 * canonical order with locked columns, rendered from the evidence index.json — where
 * DONE requires a reviewer-reproducible report ON DISK (a plan alone is PARTIAL).
 *
 * SC1  determinism — same inputs twice → byte-identical (fn + CLI).
 * SC2  golden — 8 rows in canonical Family 1–8 order; the locked column header; the
 *      Status enum (DONE needs an on-disk report; a pending-owner plan → PENDING;
 *      a structural-N/A entry → N/A).
 * SC3  applicability — the manifest drives Applies (managed-package → families 1,2;
 *      an absent element → N/A; the "always" families 5,6 are always ✓); no manifest → "?".
 * SC3b element-type synonyms — an LLM-authored `external-web-app` element gates the
 *      external families (3/4/7/8) exactly like the canonical `external-endpoint`
 *      (satisfied evidence → DONE, never N/A; byte-identical to the canonical render);
 *      a truly unknown type is never coerced to external (families stay N/A).
 * SC4  fail-safe — no index → applicable families PENDING (with manifest), never a crash
 *      and never a fabricated DONE.
 * SC5  wiring — run-scans Step 11 references the harness + states verbatim.
 *
 * Dependency-free: `node acceptance/test-render-scan-status.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { renderScanStatus, SCAN_FAMILIES } from '../harness/render-scan-status.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'render-scan-status.mjs')

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) } }
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'rss-')); dirs.push(d); return d }

const INDEX = {
  generated: '2026-06-26',
  entries: [
    { ref_type: 'requirement', ref_id: 'scan-code-analyzer-v5-required', reviewer_reproducible: true, location: '.security-review/evidence/code-analyzer-2026-06-26.json', disposition: 'satisfied' },
    { ref_type: 'requirement', ref_id: 'dast-self-run-required', reviewer_reproducible: false, location: '.security-review/evidence/dast/zap-plan.yaml', disposition: 'pending-owner' },
    { ref_type: 'requirement', ref_id: 'scan-dependency-vulnerabilities', reviewer_reproducible: true, location: '.security-review/evidence/deps-npm-2026-06-26.json', disposition: 'satisfied' },
    { ref_type: 'requirement', ref_id: 'scan-external-sast', reviewer_reproducible: true, location: '.security-review/run-log.md', disposition: 'satisfied', note: 'N/A — surface absent' },
  ],
}
const MANIFEST = { elements: [{ type: 'managed-package' }, { type: 'external-endpoint' }] }

console.log('render-scan-status standing test')

check('SC1 determinism: same inputs twice → byte-identical (fn + CLI)', () => {
  const args = { index: INDEX, manifest: MANIFEST, commit: 'abc', tools: 'v1' }
  assert.equal(renderScanStatus(args), renderScanStatus(args))
  const d = tmp(); mkdirSync(join(d, '.security-review', 'evidence'), { recursive: true })
  writeFileSync(join(d, '.security-review', 'evidence', 'index.json'), JSON.stringify(INDEX))
  writeFileSync(join(d, '.security-review', 'scope-manifest.json'), JSON.stringify(MANIFEST))
  const a = execFileSync('node', [CLI, '--target', d, '--commit', 'abc', '--tools', 'v1'], { encoding: 'utf8' })
  const b = execFileSync('node', [CLI, '--target', d, '--commit', 'abc', '--tools', 'v1'], { encoding: 'utf8' })
  assert.equal(a, b)
})

check('SC2 golden: 8 rows in canonical order, locked columns, Status enum', () => {
  const block = renderScanStatus({ index: INDEX, manifest: MANIFEST, commit: 'deadbee', tools: 'ca@5' })
  assert.match(block, /### Scan status — 2026-06-26 · commit deadbee · tools ca@5/)
  assert.match(block, /\| Family \| Applies \| Runner \| Status \| Evidence file \| Gate id \| Next command if PENDING \|/)
  // exactly 8 families, in 1..8 order
  assert.equal(SCAN_FAMILIES.length, 8)
  const nums = [...block.matchAll(/^\| (\d)\. /gm)].map((m) => Number(m[1]))
  assert.deepEqual(nums, [1, 2, 3, 4, 5, 6, 7, 8], 'rows render in canonical Family 1–8 order')
  // DONE needs the report on disk (Family 1, 5)
  assert.match(block, /\| 1\. Code Analyzer \| ✓ \| agent \| DONE \| \.security-review\/evidence\/code-analyzer-2026-06-26\.json \|/)
  assert.match(block, /\| 5\. Dependency audit \| ✓ \| agent \| DONE \|/)
  // a pending-owner plan (Family 3 DAST) → PENDING, not DONE
  assert.match(block, /\| 3\. Authenticated DAST \| ✓ \| owner executes; agent plans \| PENDING \|/)
  // a structural-N/A entry (Family 7) → N/A
  assert.match(block, /\| 7\. External SAST \| ✓ \| agent \| N\/A \|/)
  // applicable-but-no-entry (Family 6 secret scan, always-on) → PENDING with a next command
  assert.match(block, /\| 6\. Secret scan[^|]*\| ✓ \| agent \| PENDING \|.*\| run-scans Family 6/)
  // the legend pins the DONE-needs-evidence rule
  assert.match(block, /a plan with no report is PARTIAL, never DONE/)
})

check('SC3 applicability: manifest drives Applies; no manifest → "?" for element-gated', () => {
  // a package-only manifest → families 3,4,7,8 (external) are N/A
  const pkgOnly = renderScanStatus({ index: { generated: '2026-06-26', entries: [] }, manifest: { elements: [{ type: 'managed-package' }] } })
  assert.match(pkgOnly, /\| 3\. Authenticated DAST \| — \(N\/A\) \|.*\| N\/A \|/)
  assert.match(pkgOnly, /\| 1\. Code Analyzer \| ✓ \|/)
  // always-on families are ✓ regardless
  assert.match(pkgOnly, /\| 5\. Dependency audit \| ✓ \|/)
  assert.match(pkgOnly, /\| 6\. Secret scan[^|]*\| ✓ \|/)
  // no manifest → element-gated families show "?" applicability
  const noManifest = renderScanStatus({ index: { generated: '2026-06-26', entries: [] } })
  assert.match(noManifest, /\| 1\. Code Analyzer \| \? \|/)
  assert.match(noManifest, /\| 5\. Dependency audit \| ✓ \|/, 'always-on stays ✓ even without a manifest')
})

check('SC3b synonym element type: external-web-app gates families 3/4/7/8 — DONE, not N/A', () => {
  // satisfied, reviewer-reproducible evidence for all four external-source families
  const extIndex = {
    generated: '2026-06-26',
    entries: [
      { ref_type: 'requirement', ref_id: 'dast-self-run-required', reviewer_reproducible: true, location: '.security-review/evidence/dast/zap-report.json', disposition: 'satisfied' },
      { ref_type: 'requirement', ref_id: 'endpoint-ssl-labs-a-grade', reviewer_reproducible: true, location: '.security-review/evidence/ssllabs-2026-06-26.json', disposition: 'satisfied' },
      { ref_type: 'requirement', ref_id: 'scan-external-sast', reviewer_reproducible: true, location: '.security-review/evidence/semgrep-2026-06-26.json', disposition: 'satisfied' },
      { ref_type: 'requirement', ref_id: 'scan-external-sca', reviewer_reproducible: true, location: '.security-review/evidence/osv-2026-06-26.json', disposition: 'satisfied' },
    ],
  }
  const synonym = renderScanStatus({ index: extIndex, manifest: { elements: [{ type: 'external-web-app' }] } })
  // the families RAN with reviewer-reproducible reports on disk → DONE, never N/A
  assert.match(synonym, /\| 3\. Authenticated DAST \| ✓ \|[^|]*\| DONE \|/)
  assert.match(synonym, /\| 4\. TLS grade \| ✓ \|[^|]*\| DONE \|/)
  assert.match(synonym, /\| 7\. External SAST \| ✓ \|[^|]*\| DONE \|/)
  assert.match(synonym, /\| 8\. External SCA \+ IaC \| ✓ \|[^|]*\| DONE \|/)
  // and the synonym manifest renders BYTE-IDENTICALLY to the canonical one — the alias
  // changes applicability gating only, nothing else in the block
  const canonical = renderScanStatus({ index: extIndex, manifest: { elements: [{ type: 'external-endpoint' }] } })
  assert.equal(synonym, canonical, 'external-web-app gates exactly like external-endpoint')
})

check('SC3b no false-alias: an unknown element type is never coerced to external', () => {
  const emptyIndex = { generated: '2026-06-26', entries: [] }
  const block = renderScanStatus({ index: emptyIndex, manifest: { elements: [{ type: 'blockchain-widget' }] } })
  // the unknown type does NOT make the element-gated families applicable
  assert.match(block, /\| 1\. Code Analyzer \| — \(N\/A\) \|/)
  assert.match(block, /\| 3\. Authenticated DAST \| — \(N\/A\) \|/)
  assert.match(block, /\| 7\. External SAST \| — \(N\/A\) \|/)
  assert.match(block, /\| 8\. External SCA \+ IaC \| — \(N\/A\) \|/)
  // always-on families are unaffected
  assert.match(block, /\| 5\. Dependency audit \| ✓ \|/)
  assert.match(block, /\| 6\. Secret scan[^|]*\| ✓ \|/)
  // a JSON-authorable NON-STRING type must neither alias nor crash the render: an
  // array-wrapped synonym stays non-applicable, a toString-less object still renders
  const weird = renderScanStatus({
    index: emptyIndex,
    manifest: { elements: [{ type: ['external-web-app'] }, { type: JSON.parse('{"toString":null}') }] },
  })
  assert.match(weird, /\| 3\. Authenticated DAST \| — \(N\/A\) \|/)
  assert.match(weird, /\| 7\. External SAST \| — \(N\/A\) \|/)
})

check('SC4 fail-safe: no index → applicable families PENDING, never DONE, never a crash', () => {
  const block = renderScanStatus({ index: null, manifest: MANIFEST })
  assert.match(block, /\(date not recorded\)/)
  // no family ROW is DONE without an index (the legend legitimately contains the word "DONE")
  assert.ok(!/\| DONE \|/.test(block), 'no family row is DONE without an index')
  assert.match(block, /\| 1\. Code Analyzer \| ✓ \| agent \| PENDING \|/)
  // CLI on a target with no evidence dir → no crash
  const out = execFileSync('node', [CLI, '--target', tmp()], { encoding: 'utf8' })
  assert.match(out, /### Scan status —/)
})

check('SC5 wiring: run-scans Step 11 references the harness + verbatim', () => {
  const skill = readFileSync(join(PLUGIN, 'skills', 'run-scans', 'SKILL.md'), 'utf8')
  assert.match(skill, /render-scan-status\.mjs --target/, 'calls the harness')
  assert.match(skill, /verbatim/i, 'states the verbatim contract')
  // the locked columns are named (the column list wraps across a line in the skill prose,
  // so assert the distinctive column names rather than the full pipe-joined string)
  assert.match(skill, /Evidence file/, 'names the Evidence-file column')
  assert.match(skill, /Next command if PENDING/, 'names the Next-command column')
  assert.match(skill, /canonical Family 1–8 order/, 'states the canonical family order')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

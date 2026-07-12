#!/usr/bin/env node
/**
 * Standing test for harness/assemble-submission-package.mjs — the deterministic
 * submission-package assembler (compile-submission Step 10).
 *
 * Guards:
 *   P1  assembly: step dirs created; artifacts/evidence COPIED into them (originals
 *       stay canonical — copies, never moves); readiness-verdict copied in.
 *   P2  INDEX.md: the pinned five wizard steps; per-row status INHERITED from the
 *       evidence-index dispositions (satisfied+reproducible→HAVE, partial→PARTIAL,
 *       pending-owner→TODO, statically-cleared→STATICALLY-CLEARED never HAVE) with
 *       the [A]/[A/h]/[M] provenance markers.
 *   P3  conditional suppression: a slot is emitted only when its baseline id is in
 *       applicableBaselineIds; Desktop/Mobile sub-blocks auto-suppress when no such
 *       element; a synonym-typed element (external-web-app) gates through
 *       canonicalElementType; the INDEX closes with the suppressed list.
 *   P4  PENDING-OWNER-RUN.md: the union of the evidence-index pending-owner rows and
 *       the owner tail whose perishable text (fee, portal-scan run budget, wizard
 *       mechanics) is PARSED from the baseline at assembly time, never hardcoded.
 *   P5  determinism: same inputs + same --date ⇒ byte-identical package on re-run.
 *   P6  degrade paths: missing readiness-verdict → honest TODO placeholder; a
 *       non-applicable owner-tail item renders as not-applicable, never silently.
 *   M2  stale-SCI inheritance: compute-sci exit 2 ⇒ the assembler exits 2 and
 *       assembles NOTHING.
 *   M3  credential refusal: a credential-shaped value in a to-be-copied file ⇒
 *       fail closed, nothing assembled, and the value itself never echoed.
 *   R1  scanner-evidence auto-redaction: a bandit-shaped report that QUOTES a found
 *       secret literal in its finding text assembles cleanly — the copied evidence
 *       carries <redacted> in the value's place, the finding metadata
 *       (test_id/filename/line_number) is preserved, the canonical original is
 *       untouched, and the §6 scan of the shipped copy is EMPTY.
 *   R2  redaction scoping: a NON-evidence file (artifact doc / runbook) carrying a
 *       secret literal STILL refuses the whole assembly, even when scanner-evidence
 *       redaction is in play in the same run — never redact-and-ship a real leak.
 *   R3  the pure redactor mirrors CREDENTIAL_PATTERNS: values → the marker,
 *       placeholder shapes untouched, and an unbounded private-key header stays in
 *       place so the refusal backstop fires; the evidence-copy predicate needs BOTH
 *       the scanner-reports slot and the evidence-tree source.
 *   F1  fail closed on an unreadable scope manifest / evidence index.
 *   C1  the frozen wizard-slot constants are pinned (the slot names live in the
 *       ENGINE, not prose — this check is the drift guard).
 *   W1  SKILL wiring: compile-submission grants + invokes the engine at Step 10 in
 *       the run-the-engine / paste-verbatim form.
 *
 * Dependency-free: `node acceptance/test-assemble-submission-package.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { parseBaselineApplies, computeApplicable } from '../harness/applicable-requirements.mjs'
import {
  WIZARD_STEPS, STEP3_UPLOAD_SLOTS, STEP4_CREDENTIAL_SUBBLOCKS, PACKAGE_STEP_DIRS, SLOT_MAP,
  slotStatus, findCredentialLikeContent, redactCredentialLikeContent, isScannerEvidenceCopy,
  REDACTION_MARKER,
} from '../harness/assemble-submission-package.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const HARNESS = join(PLUGIN, 'harness', 'assemble-submission-package.mjs')
const FIXED_DATE = '2026-07-01'

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

// ── synthetic plugin: a small controlled baseline (hermetic against live-baseline edits) ──
const SYNTH_BASELINE = `- id: process-submission-wizard
  requirement: Submission happens through the Security Review Wizard in the Partner Console.
  details: >
    Multi-step wizard: (1) contacts, (2) technical details, (3) documentation
    uploads, (4) test environment credentials, (5) review and submit.
  applies_to: [all]
  automation: manual_only
  severity_if_missing: major
  verification: verified_primary
  last_verified: "2026-06-12"
- id: process-review-fee
  requirement: Paid solutions pay USD 777 per security review attempt; free solutions pay USD 1.
  applies_to: [all]
  automation: manual_only
  severity_if_missing: major
  verification: verified_primary
  last_verified: "2026-06-12"
- id: scan-checkmarx-partner-portal
  requirement: A Partner Security Portal source-code scan report is required for package-bearing submissions.
  details: >
    THREE runs per solution version are included in the review fee; the listing
    must be linked before portal scanning.
  applies_to: [managed-package]
  automation: partially
  severity_if_missing: major
  verification: verified_primary
  last_verified: "2026-06-12"
- id: scan-external-sast
  requirement: An external SAST report over the endpoint code.
  applies_to: [external-endpoint]
  automation: fully
  severity_if_missing: major
  verification: verified_primary
  last_verified: "2026-06-12"
- id: scan-sfge-crud-fls-dataflow
  requirement: Graph-engine CRUD/FLS data-flow scan.
  applies_to: [managed-package]
  automation: fully
  severity_if_missing: major
  verification: verified_primary
  last_verified: "2026-06-12"
- id: artifact-architecture-diagram
  requirement: An architecture and data-flow diagram.
  applies_to: [all]
  automation: partially
  severity_if_missing: major
  verification: verified_primary
  last_verified: "2026-06-12"
- id: artifact-dast-scan-reports
  requirement: Authenticated DAST reports over the live endpoints.
  applies_to: [external-endpoint]
  automation: partially
  severity_if_missing: major
  verification: verified_primary
  last_verified: "2026-06-12"
- id: artifact-org-credentials
  requirement: The review-org credential runbook.
  applies_to: [all]
  automation: partially
  severity_if_missing: major
  verification: verified_primary
  last_verified: "2026-06-12"
- id: artifact-third-party-creds-two-test-users
  requirement: Two test users with a bidirectional authorization proof.
  applies_to: [all]
  automation: manual_only
  severity_if_missing: major
  verification: verified_primary
  last_verified: "2026-06-12"
- id: testenv-external-test-instances
  requirement: An isolated external test tenant.
  applies_to: [external-endpoint]
  automation: partially
  severity_if_missing: major
  verification: verified_primary
  last_verified: "2026-06-12"
- id: artifact-exposed-tools-list
  requirement: The exposed-tools list.
  applies_to: [mcp-server]
  automation: fully
  severity_if_missing: major
  verification: verified_primary
  last_verified: "2026-06-12"
`
const SYNTH_ENTRIES = parseBaselineApplies(SYNTH_BASELINE)
function synthPlugin() {
  const dir = mkdtempSync(join(tmpdir(), 'asp-plugin-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'baseline'), { recursive: true })
  writeFileSync(join(dir, 'baseline', 'requirements-baseline.yaml'), SYNTH_BASELINE)
  return dir
}
const SYNTH = synthPlugin()

// ── the target fixture: a fictional Meridian repo ─────────────────────────────────
// The fake-by-inspection secret literal a fictional bandit run "found" — assembled
// from parts so this test file stays secret-scan-clean itself.
const FAKE_FOUND_SECRET = ['Welcome2', 'Meridian!'].join('')
const FAKE_DOC_SECRET = ['somelong', 'secretvalue'].join('')

function makeRepo({ elements, storedIds, withVerdict = true, seedSecret = false, banditEvidence = false, runbookSecret = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'asp-target-'))
  dirs.push(dir)
  const els = elements || [
    { type: 'external-web-app', evidence: 'apps/web manifest' },
    { type: 'managed-package', evidence: 'sfdx-project.json' },
  ]
  const applicable = storedIds || computeApplicable(SYNTH_ENTRIES, els.map((e) => e.type))
  mkdirSync(join(dir, '.security-review', 'evidence', 'dast'), { recursive: true })
  mkdirSync(join(dir, 'docs', 'security-review', 'submission'), { recursive: true })
  writeFileSync(join(dir, '.security-review', 'scope-manifest.json'), JSON.stringify({
    listingType: 'external-api', applicableBaselineIds: applicable, elements: els,
  }))
  writeFileSync(join(dir, '.security-review', 'audit-ledger.json'), JSON.stringify({
    findings: [{ id: 'f1', status: 'confirmed', adjusted_severity: 'high', title: 'open finding', file: 'apps/web/a.js:3' }],
  }))
  writeFileSync(join(dir, '.security-review', 'evidence', 'semgrep-report.sarif'), JSON.stringify({ runs: [] }))
  writeFileSync(join(dir, '.security-review', 'evidence', 'dast', 'zap-plan.yaml'), 'plan: authenticated-dast\n')
  writeFileSync(join(dir, 'docs', 'security-review', 'architecture-diagram.md'),
    `# Meridian architecture\nThe Meridian web app calls the Solano API.\n${seedSecret ? 'client_secret: "s3cr3tvalue99"\n' : ''}`)
  writeFileSync(join(dir, 'docs', 'security-review', 'audit-report.md'), '# audit pass 1\nno data-flow violation found\n')
  writeFileSync(join(dir, 'docs', 'security-review', 'test-environment.md'),
    '# Test environment runbook\nPersona one signs in with credentials supplied through the submission channel.\n' +
    (runbookSecret ? `client_secret: '${FAKE_DOC_SECRET}'\n` : ''))
  if (banditEvidence) {
    // A bandit-report-shaped scan output whose finding text QUOTES the secret it
    // found — the toolkit's own scan evidence, not a leaked config value.
    writeFileSync(join(dir, '.security-review', 'evidence', 'bandit-report.json'), JSON.stringify({
      generated_at: FIXED_DATE,
      metrics: { _totals: { loc: 240, nosec: 0 } },
      results: [{
        code: `41 password = '${FAKE_FOUND_SECRET}'\n`,
        filename: 'apps/web/config/settings.py',
        issue_confidence: 'MEDIUM',
        issue_severity: 'LOW',
        issue_text: `Possible hardcoded password: '${FAKE_FOUND_SECRET}'`,
        line_number: 41,
        line_range: [41],
        test_id: 'B105',
        test_name: 'hardcoded_password_string',
      }],
    }, null, 2))
  }
  if (withVerdict) {
    writeFileSync(join(dir, 'docs', 'security-review', 'submission', 'readiness-verdict.md'),
      '# Readiness verdict\n**READINESS: NOT READY**\n')
  }
  const indexEntries = [
    { ref_type: 'requirement', ref_id: 'scan-external-sast', collected_by: 'scanner', disposition: 'satisfied', verified: { value: true, how: 'scanner report on disk' }, reviewer_reproducible: true, location: '.security-review/evidence/semgrep-report.sarif' },
    { ref_type: 'requirement', ref_id: 'artifact-architecture-diagram', collected_by: 'agent', disposition: 'partial', verified: { value: false, how: 'drafted; owner completes' }, reviewer_reproducible: false, location: 'docs/security-review/architecture-diagram.md' },
    { ref_type: 'requirement', ref_id: 'scan-sfge-crud-fls-dataflow', collected_by: 'agent', disposition: 'statically-cleared', verified: { value: true, how: 'white-box static audit only' }, reviewer_reproducible: false, location: 'docs/security-review/audit-report.md' },
    { ref_type: 'requirement', ref_id: 'artifact-dast-scan-reports', collected_by: 'agent', disposition: 'pending-owner', verified: { value: false, how: 'plan prepared; owner runs it' }, reviewer_reproducible: false, location: '.security-review/evidence/dast/zap-plan.yaml', note: 'owner runs the authenticated DAST' },
    { ref_type: 'requirement', ref_id: 'artifact-org-credentials', collected_by: 'agent', disposition: 'partial', verified: { value: false, how: 'runbook drafted' }, reviewer_reproducible: false, location: 'docs/security-review/test-environment.md' },
  ]
  if (banditEvidence) {
    indexEntries.push({ ref_type: 'requirement', ref_id: 'scan-external-sast', collected_by: 'scanner', disposition: 'satisfied', verified: { value: true, how: 'bandit report on disk' }, reviewer_reproducible: true, location: '.security-review/evidence/bandit-report.json' })
  }
  writeFileSync(join(dir, '.security-review', 'evidence', 'index.json'), JSON.stringify({
    schema_version: 1, generated: FIXED_DATE, entries: indexEntries,
  }))
  return dir
}

function runRaw(args) {
  try {
    return { status: 0, stdout: execFileSync('node', args, { encoding: 'utf8', stdio: 'pipe' }), stderr: '' }
  } catch (e) {
    return { status: e.status, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') }
  }
}
const assemble = (dir, plugin = SYNTH) =>
  runRaw([HARNESS, '--repo', dir, '--date', FIXED_DATE, '--plugin', plugin])
const pkgOf = (dir) => join(dir, 'docs', 'security-review', 'submission-package')
const walk = (root, rel = '') => {
  let out = []
  for (const e of readdirSync(join(root, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = rel ? `${rel}/${e.name}` : e.name
    out = e.isDirectory() ? out.concat([child + '/'], walk(root, child)) : out.concat([child])
  }
  return out
}

console.log('assemble-submission-package standing test')

// One shared assembled fixture for P1–P4.
const repo = makeRepo()
const run1 = assemble(repo)
const PKG = pkgOf(repo)
const INDEX = () => readFileSync(join(PKG, 'INDEX.md'), 'utf8')
const PENDING = () => readFileSync(join(PKG, 'PENDING-OWNER-RUN.md'), 'utf8')

check('P1 assembles: step dirs + copies land; originals STAY canonical (copies, never moves)', () => {
  assert.equal(run1.status, 0, `assembler failed:\n${run1.stdout}\n${run1.stderr}`)
  for (const d of ['step2-technical', 'step3-docs', 'step3-scans', 'step4-environments']) {
    assert.ok(existsSync(join(PKG, d)), `missing step dir ${d}`)
  }
  assert.ok(existsSync(join(PKG, 'step3-scans', 'semgrep-report.sarif')), 'scanner report copied into step3-scans/')
  assert.ok(existsSync(join(PKG, 'step3-docs', 'architecture-diagram.md')), 'architecture doc copied into step3-docs/')
  assert.ok(existsSync(join(PKG, 'step3-scans', 'zap-plan.yaml')), 'a TODO row\'s prepared plan is still copied (with its status)')
  assert.ok(existsSync(join(PKG, 'step4-environments', 'test-environment.md')), 'test-env runbook copied into step4-environments/')
  // originals untouched
  assert.ok(existsSync(join(repo, '.security-review', 'evidence', 'semgrep-report.sarif')), 'original scanner report still present')
  assert.ok(existsSync(join(repo, 'docs', 'security-review', 'architecture-diagram.md')), 'original architecture doc still present')
  // readiness-verdict copied byte-for-byte
  assert.equal(readFileSync(join(PKG, 'readiness-verdict.md'), 'utf8'),
    readFileSync(join(repo, 'docs', 'security-review', 'submission', 'readiness-verdict.md'), 'utf8'))
  assert.match(run1.stdout, /submission-package assembled/)
})

check('P2 INDEX inherits statuses + provenance markers; statically-cleared is never HAVE', () => {
  const idx = INDEX()
  for (const s of ['Add Contacts', 'Add Technical Details', 'Upload Documentation', 'Provide Environments', 'Review & Submit']) {
    assert.ok(idx.includes(`**${s}**`), `pinned wizard step "${s}" missing`)
  }
  assert.ok(idx.includes('| scan-external-sast | HAVE | `[A]` |'), 'reproducible scanner evidence → HAVE [A]')
  assert.ok(idx.includes('| artifact-architecture-diagram | PARTIAL | `[A/h]` |'), 'a partial draft → PARTIAL [A/h], never HAVE')
  assert.ok(idx.includes('| artifact-dast-scan-reports | TODO | `[A/h]` |'), 'a pending-owner row → TODO')
  assert.ok(idx.includes('| scan-sfge-crud-fls-dataflow | STATICALLY-CLEARED |'), 'a static clear is surfaced as its own status')
  assert.ok(!idx.includes('| scan-sfge-crud-fls-dataflow | HAVE |'), 'a static clear must never render HAVE')
  assert.ok(idx.includes('| artifact-third-party-creds-two-test-users | TODO | `[M]` |'), 'a manual-only item with no evidence → TODO [M]')
  assert.match(idx, /1 open finding\(s\) \(confirmed\/regressed\)/, 'the ledger\'s open band is surfaced')
  assert.doesNotMatch(idx, /will pass/i, 'the index never predicts the outcome')
})

check('P3 suppression: id-gated + element-gated (canonicalElementType), closed with the suppressed list', () => {
  const idx = INDEX()
  // synonym-typed element gates the API/OAuth/SAML sub-block IN
  assert.ok(idx.includes('| API/OAuth/SAML Access | testenv-external-test-instances | TODO |'),
    'external-web-app must canonicalize to external-endpoint and emit the API/OAuth/SAML sub-block')
  // no desktop/mobile element → those sub-blocks never appear as map rows…
  assert.ok(!/\|\s*Desktop Clients\s*\|/.test(idx.split('## Suppressed')[0]), 'Desktop Clients must not be an upload row')
  assert.ok(!/\|\s*Mobile Apps\s*\|/.test(idx.split('## Suppressed')[0]), 'Mobile Apps must not be an upload row')
  // …and land in the suppressed list with the honest reason
  const tail = idx.split('## Suppressed')[1]
  assert.match(tail, /Desktop Clients.*no desktop-client element in scope/)
  assert.match(tail, /Mobile Apps.*no mobile element in scope/)
  assert.match(tail, /artifact-exposed-tools-list.*not in the manifest's applicableBaselineIds/)
})

check('P4 PENDING-OWNER-RUN unions the pending rows + the baseline-parsed owner tail (nothing hardcoded)', () => {
  const p = PENDING()
  assert.ok(p.includes('| artifact-dast-scan-reports |'), 'the pending-owner evidence row is listed')
  assert.ok(p.includes('zap-plan.yaml'), 'the prepared plan location rides the row')
  assert.ok(p.includes('owner runs the authenticated DAST'), 'the row note rides along')
  // perishable text quoted from the SYNTHETIC baseline — proof it is parsed at assembly time
  assert.ok(p.includes('USD 777'), 'the fee amount comes from the baseline the run was pointed at, not from engine code')
  assert.ok(p.includes('THREE runs per solution version'), 'the portal-scan run budget is quoted from the baseline details')
  assert.ok(p.includes('Security Review Wizard in the Partner Console'), 'the wizard mechanics are quoted from the baseline')
  assert.ok(p.includes('last_verified 2026-06-12'), 'each tail item carries its baseline currency')
  assert.match(p, /submission channel.*never written into any package file/s, 'the credentials-channel item closes the tail (CONVENTIONS §6)')
})

check('P5 determinism: a second run is byte-identical (files + tree)', () => {
  const before = { idx: INDEX(), pending: PENDING(), tree: walk(PKG).join('\n') }
  const run2 = assemble(repo)
  assert.equal(run2.status, 0)
  assert.equal(INDEX(), before.idx, 'INDEX.md must be byte-identical on re-run')
  assert.equal(PENDING(), before.pending, 'PENDING-OWNER-RUN.md must be byte-identical on re-run')
  assert.equal(walk(PKG).join('\n'), before.tree, 'the assembled tree must be identical on re-run')
  assert.equal(run1.stdout, run2.stdout, 'the summary output is deterministic too')
})

check('P6 degrade: missing readiness-verdict → TODO placeholder; inapplicable owner-tail item surfaced, not dropped', () => {
  // no managed-package element → scan-checkmarx-partner-portal drops out of the applicable set
  const d = makeRepo({ elements: [{ type: 'external-web-app', evidence: 'apps/web manifest' }], withVerdict: false })
  const r = assemble(d)
  assert.equal(r.status, 0, `assembler failed:\n${r.stdout}\n${r.stderr}`)
  const verdict = readFileSync(join(pkgOf(d), 'readiness-verdict.md'), 'utf8')
  assert.match(verdict, /TODO/, 'the placeholder is an honest gap')
  assert.match(verdict, /step 8/, 'routes to the step that produces the verdict')
  assert.match(readFileSync(join(pkgOf(d), 'INDEX.md'), 'utf8'), /readiness-verdict\.md: NOT found/)
  const p = readFileSync(join(pkgOf(d), 'PENDING-OWNER-RUN.md'), 'utf8')
  assert.match(p, /~~.*step3-scans\/\.~~ — not applicable: `scan-checkmarx-partner-portal`/,
    'the portal-scan tail item renders as not-applicable instead of vanishing')
  assert.ok(!p.includes('THREE runs per solution version'), 'an inapplicable tail item must not quote its runbook text')
})

check('M2 stale-SCI inheritance: compute-sci exit 2 → assembler exits 2 and assembles NOTHING', () => {
  const full = computeApplicable(SYNTH_ENTRIES, ['external-web-app', 'managed-package'])
  const d = makeRepo({ storedIds: full.slice(0, full.length - 2) }) // truncated stored set → stale
  const r = assemble(d)
  assert.equal(r.status, 2, 'the stale refusal exit code is inherited')
  assert.match(r.stdout, /STALE SCOPE MANIFEST/)
  assert.match(r.stderr, /refusing to assemble over a refused SCI/)
  assert.ok(!existsSync(pkgOf(d)), 'nothing may be assembled over a refused SCI')
})

check('M3 credential refusal: a secret-shaped value in a to-be-copied file → fail closed, value never echoed', () => {
  const d = makeRepo({ seedSecret: true })
  const r = assemble(d)
  assert.notEqual(r.status, 0, 'credential-shaped content must fail the assembly')
  assert.match(r.stderr, /CREDENTIAL REFUSAL/)
  assert.match(r.stderr, /architecture-diagram\.md/, 'the refusal names the offending file')
  assert.match(r.stderr, /assigned-secret-literal/, 'the refusal names the pattern')
  assert.ok(!(r.stdout + r.stderr).includes('s3cr3tvalue99'), 'the matched value itself must never be echoed')
  assert.ok(!existsSync(pkgOf(d)), 'nothing may be assembled after the refusal')
})

check('R1 scanner-evidence auto-redaction: a bandit report quoting a FOUND secret assembles; the copy ships the marker with metadata intact', () => {
  const d = makeRepo({ banditEvidence: true })
  const originalPath = join(d, '.security-review', 'evidence', 'bandit-report.json')
  const original = readFileSync(originalPath, 'utf8')
  const r = assemble(d)
  assert.equal(r.status, 0, `assembler refused legitimate scanner evidence:\n${r.stdout}\n${r.stderr}`)
  const copiedPath = join(pkgOf(d), 'step3-scans', 'bandit-report.json')
  assert.ok(existsSync(copiedPath), 'the bandit report lands in step3-scans/')
  const copied = readFileSync(copiedPath, 'utf8')
  assert.ok(!copied.includes(FAKE_FOUND_SECRET), 'the found secret literal must not ship in the package')
  assert.ok(copied.includes(REDACTION_MARKER), 'the value is replaced with the redaction marker')
  const parsed = JSON.parse(copied) // the report structure survives the redaction
  assert.equal(parsed.results[0].test_id, 'B105', 'finding rule id preserved')
  assert.equal(parsed.results[0].filename, 'apps/web/config/settings.py', 'finding file preserved')
  assert.equal(parsed.results[0].line_number, 41, 'finding line preserved')
  assert.match(parsed.results[0].issue_text, /hardcoded password: '<redacted>'/, 'the issue text keeps its shape around the marker')
  assert.deepEqual(findCredentialLikeContent(copied), [], 'the §6 scan of the SHIPPED copy is EMPTY — no raw secret in the package')
  assert.equal(readFileSync(originalPath, 'utf8'), original, 'the canonical original stays byte-identical (copies, never mutations)')
  assert.ok(!(r.stdout + r.stderr).includes(FAKE_FOUND_SECRET), 'the found value never echoes in the output')
  assert.match(r.stdout, /evidence redaction: step3-scans\/bandit-report\.json/, 'the redaction is surfaced in the summary')
})

check('R2 redaction scoping: a secret in a NON-evidence runbook still refuses the whole assembly (never redact-and-ship a real leak)', () => {
  const d = makeRepo({ banditEvidence: true, runbookSecret: true })
  const r = assemble(d)
  assert.notEqual(r.status, 0, 'a non-evidence secret must fail the assembly even with evidence redaction in play')
  assert.match(r.stderr, /CREDENTIAL REFUSAL/)
  assert.match(r.stderr, /test-environment\.md/, 'the refusal names the offending NON-evidence file')
  assert.match(r.stderr, /assigned-secret-literal/, 'the refusal names the pattern')
  assert.ok(!(r.stdout + r.stderr).includes(FAKE_DOC_SECRET), 'the matched value itself must never be echoed')
  assert.ok(!r.stderr.includes('bandit-report.json'), 'the redactable scanner evidence is not what refuses')
  assert.ok(!existsSync(pkgOf(d)), 'nothing may be assembled after the refusal')
})

check('R3 the pure redactor mirrors the pattern set; the evidence predicate needs slot AND source', () => {
  const hit = redactCredentialLikeContent(`password: '${FAKE_FOUND_SECRET}' and Bearer abcdefghijklmnopqrstuvwxyz012345`)
  assert.ok(hit.text.includes(`password: '${REDACTION_MARKER}'`), 'the key and quotes survive; the value does not')
  assert.ok(hit.text.includes(`Bearer ${REDACTION_MARKER}`), 'the Bearer keyword survives; the token does not')
  assert.deepEqual([...hit.patterns].sort(), ['assigned-secret-literal', 'bearer-token'])
  assert.deepEqual(findCredentialLikeContent(hit.text), [], 'redacted text can never re-trip the detector')
  const clean = redactCredentialLikeContent('password: "<from-vault>" and api_key: "{{SET_AT_SUBMISSION}}"')
  assert.deepEqual(clean.patterns, [], 'placeholder shapes are not values; nothing to redact')
  assert.ok(clean.text.includes('<from-vault>'), 'placeholders ride through untouched')
  const bounded = redactCredentialLikeContent('-----BEGIN RSA PRIVATE KEY-----\nMIIEfakefakefake\n-----END RSA PRIVATE KEY-----')
  assert.deepEqual(findCredentialLikeContent(bounded.text), [], 'a bounded key block is redacted whole')
  const unbounded = redactCredentialLikeContent('-----BEGIN RSA PRIVATE KEY-----\nMIIEfakefakefake')
  assert.deepEqual(findCredentialLikeContent(unbounded.text), ['private-key-block'],
    'an unbounded key header stays in place so the refusal backstop still fires')
  assert.ok(isScannerEvidenceCopy('Security scanner reports', '.security-review/evidence/bandit-report.json'))
  assert.ok(!isScannerEvidenceCopy('Architecture & Usage Documentation', 'docs/security-review/architecture-diagram.md'),
    'an artifact doc never qualifies')
  assert.ok(!isScannerEvidenceCopy('Security scanner reports', 'docs/security-review/some-report.json'),
    'slot alone is not enough — the source must live in the evidence tree')
  assert.ok(!isScannerEvidenceCopy('False-positives documentation', '.security-review/evidence/fp-dossier.json'),
    'evidence tree alone is not enough — the copy must route to the scanner-reports slot')
})

check('F1 fail closed: unreadable scope manifest / evidence index → non-zero, nothing assembled', () => {
  const bare = mkdtempSync(join(tmpdir(), 'asp-bare-')); dirs.push(bare)
  const r1 = assemble(bare)
  assert.notEqual(r1.status, 0)
  assert.match(r1.stderr, /scope manifest/)
  const d = makeRepo()
  writeFileSync(join(d, '.security-review', 'evidence', 'index.json'), 'not-json')
  const r2 = assemble(d)
  assert.notEqual(r2.status, 0)
  assert.match(r2.stderr, /evidence index/)
  assert.ok(!existsSync(pkgOf(d)), 'a corrupt input must not leave a package behind')
})

check('C1 the wizard-slot constants are FROZEN and pinned (the prose→engine promotion holds)', () => {
  assert.deepEqual(WIZARD_STEPS.map((s) => s.name),
    ['Add Contacts', 'Add Technical Details', 'Upload Documentation', 'Provide Environments', 'Review & Submit'])
  assert.deepEqual([...STEP3_UPLOAD_SLOTS], [
    'Architecture & Usage Documentation', 'API Callouts documentation', 'Security scanner reports',
    'False-positives documentation', 'Other documentation'])
  assert.deepEqual([...STEP4_CREDENTIAL_SUBBLOCKS], [
    'Username/Password Authentication', 'API/OAuth/SAML Access', 'Desktop Clients', 'Mobile Apps',
    'Other Test Environment Information'])
  assert.deepEqual([...PACKAGE_STEP_DIRS], ['step2-technical', 'step3-docs', 'step3-scans', 'step4-environments'])
  for (const frozen of [WIZARD_STEPS, STEP3_UPLOAD_SLOTS, STEP4_CREDENTIAL_SUBBLOCKS, PACKAGE_STEP_DIRS, SLOT_MAP]) {
    assert.ok(Object.isFrozen(frozen), 'every pinned constant must be frozen')
  }
  // every map row targets a pinned slot + a real step dir
  for (const row of SLOT_MAP) {
    assert.ok(PACKAGE_STEP_DIRS.includes(row.dir), `${row.req || row.slot}: dir ${row.dir} not a step dir`)
    if (row.step === 3) assert.ok(STEP3_UPLOAD_SLOTS.includes(row.slot), `${row.req}: "${row.slot}" not a pinned Step-3 slot`)
    if (row.step === 4) assert.ok(STEP4_CREDENTIAL_SUBBLOCKS.includes(row.slot), `${row.req || row.slot}: not a pinned Step-4 sub-block`)
  }
  // the fail-closed status core (the mutation-1 surface): satisfied WITHOUT the
  // reproducible flag is never HAVE, and partial is never HAVE
  assert.equal(slotStatus([{ disposition: 'satisfied', verified: { value: true } }]), 'STATICALLY-CLEARED')
  assert.equal(slotStatus([{ disposition: 'partial' }]), 'PARTIAL')
  assert.equal(slotStatus([]), 'TODO')
  // placeholder shapes must not trip the credential scan; a real literal must
  assert.deepEqual(findCredentialLikeContent('password: "<from-vault>" and api_key: "{{SET_AT_SUBMISSION}}"'), [])
  assert.deepEqual(findCredentialLikeContent('client_secret: "abcdef123456"'), ['assigned-secret-literal'])
})

check('W1 SKILL wiring: compile-submission grants + invokes the assembler at Step 10 (run the engine, paste verbatim)', () => {
  const skill = readFileSync(join(PLUGIN, 'skills', 'compile-submission', 'SKILL.md'), 'utf8')
  const fm = skill.split('---')[1] || ''
  const allowed = fm.split('\n').find((l) => l.startsWith('allowed-tools:')) || ''
  assert.ok(allowed.includes('Bash(node *harness/assemble-submission-package.mjs *)'), 'allowed-tools grants the assembler')
  assert.match(skill, /assemble-submission-package\.mjs --target/, 'Step 10 invokes the shipped engine with --target')
  assert.match(skill, /assemble-submission-package\.mjs --target [^\n]*--plugin [^\n]*--date/, 'the invocation carries --plugin and --date (date-pinned, never wall-clock)')
  const step10 = skill.slice(skill.indexOf('Assemble the downloadable submission package'))
  assert.match(step10, /verbatim/i, 'Step 10 states the paste-verbatim contract')
  assert.match(step10, /never\s+hand-build/i, 'Step 10 forbids hand-building the package')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

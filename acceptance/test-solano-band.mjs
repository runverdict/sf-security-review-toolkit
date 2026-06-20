#!/usr/bin/env node
/**
 * Standing band-check for the MIDDLE-BAND judgment fixture (Solano).
 * docs/roadmap-middle-band-judgment-fixture.md, build step 2: "Sanity-check the
 * band DETERMINISTICALLY first — hand-author a representative ledger →
 * compute-sci.mjs → confirm it lands ~65-75% before the expensive cold run.
 * Encode this as a standing check so it can't silently drift."
 *
 * This IS that standing check. It hand-authors the representative
 * scope-manifest + audit-ledger + evidence-index that a Solano run would
 * produce — the 6 seeded contestable issues dispositioned per
 * acceptance/solano-adjudication-key.md, plus the realistic mid-prep materials
 * gaps — runs the REAL harness/compute-sci.mjs against the REAL shipped
 * baseline, and asserts the rollup lands in the band. If a future change to
 * compute-sci (or to a Solano-applicable requirement's severity) moves the
 * fixture out of band, THIS fails the build — the drift can't slip through.
 *
 * Two layers:
 *   PRIMARY     — a FIXED 126-id Solano manifest (so baseline GROWTH can't drift
 *                 the count) scored against the live baseline. Asserts the exact
 *                 71% / MATERIALS COMPLETE / not-blocked / no open critical-high.
 *   CORROBORATE — re-derives the applicable set from the LIVE baseline for
 *                 Solano's elements and re-scores. Catches a renamed/removed id
 *                 (subset check) and baseline drift large enough to break the
 *                 design (wider sanity band). This is the "can't silently drift"
 *                 guard against baseline edits the fixed manifest would mask.
 *
 * Dependency-free: `node acceptance/test-solano-band.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { parseBaselineApplies, computeApplicable } from '../harness/applicable-requirements.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const SCI = join(PLUGIN, 'harness', 'compute-sci.mjs')
const RUN_DATE = '2026-06-20' // pinned: newest baseline last_verified — keeps the currency calc stable
const ELEMENTS = ['managed-package', 'agentforce', 'external-endpoint']

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

console.log('solano middle-band standing test')

// ---------------------------------------------------------------------------
// The FIXED Solano applicable set (managed-package + agentforce +
// external-endpoint = 126 ids on the 2026-06-20 baseline). Frozen here so
// baseline GROWTH cannot drift the count; the CORROBORATE layer re-derives the
// live set and fails loud if any of these ids vanished/renamed.
// ---------------------------------------------------------------------------
const SOLANO_APPLICABLE = [
  'process-submission-wizard', 'process-checklist-builder', 'process-review-fee', 'process-review-timeline',
  'process-prequeue-validation', 'process-failure-remediation-flow', 'process-agentexchange-marketplace-identity',
  'process-extension-packages', 'process-soc2-informational', 'process-partner-program-prerequisites',
  'process-review-stages', 'process-listing-readiness-inheritance', 'process-office-hours-two-tracks',
  'process-fee-payment-mechanics', 'process-security-program-required', 'scan-code-analyzer-v5-required',
  'scan-code-analyzer-invocation', 'scan-code-analyzer-engines', 'scan-pmd-appexchange-rules',
  'scan-sfge-crud-fls-dataflow', 'scan-checkmarx-partner-portal', 'scan-no-clean-scan-required',
  'scan-false-positive-documentation', 'artifact-fp-documentation-format', 'scan-severity-threshold-unpublished',
  'scan-external-sast', 'scan-external-sca', 'scan-iac-misconfig', 'scan-dependency-vulnerabilities',
  'scan-apex-test-coverage', 'scan-report-freshness', 'endpoint-ssl-labs-a-grade', 'endpoint-https-only',
  'endpoint-trusted-ca-certificates', 'endpoint-hsts', 'endpoint-secure-cookies', 'endpoint-csrf-protection',
  'endpoint-owasp-top10-bar', 'untrusted-deserialization', 'endpoint-error-hygiene-debug-off',
  'endpoint-enumeration-brute-force', 'resource-consumption-abuse', 'cost-amplification-denial-of-wallet',
  'mass-assignment-bopla', 'within-org-bola', 'outbound-callout-trust', 'endpoint-multi-tenant-isolation',
  'endpoint-rate-limiting', 'endpoint-named-credentials-callouts', 'endpoint-third-party-testing-consent',
  'endpoint-review-scanner-ip-allowlist', 'dast-self-run-required', 'dast-authenticated-scans',
  'dast-severity-bar', 'dast-screenshot-proof-of-scanned-url', 'dast-endpoints-production-mode',
  'dast-salesforce-runs-own-pentest', 'mcp-listing-managed-package', 'mcp-tool-actions-not-packageable',
  'mcpthreat-ssrf-mitigation', 'testenv-developer-edition-default-settings', 'testenv-mfa-disabled-for-reviewers',
  'testenv-realistic-test-data', 'testenv-test-personas-documented', 'testenv-external-test-instances',
  'testenv-trialforce-org-lifespan', 'testenv-locker-csp-enabled', 'testenv-usage-documentation',
  'testenv-trialforce-template-content-policy', 'artifact-package-architecture-usage-docs',
  'artifact-user-documentation', 'artifact-required-materials-matrix', 'artifact-incident-response-plan',
  'artifact-data-retention-deletion', 'artifact-disaster-recovery-backup', 'artifact-vuln-remediation-sla',
  'artifact-hosting-architecture', 'artifact-prior-pentest-attestation', 'post-periodic-rereview',
  'post-version-attestation', 'post-incident-reporting-24h', 'post-pkce-refresh-rotation-mandate',
  'post-test-environment-liveness', 'post-oauth-legacy-flow-retirements', 'fail-sessionid-egress',
  'fail-crud-fls', 'fail-sharing-model', 'fail-soql-injection', 'fail-xss', 'fail-hardcoded-secrets',
  'fail-info-disclosure', 'error-handling-fail-open', 'fail-js-not-static-resources',
  'fail-lightning-component-hygiene', 'fail-untestable-environment', 'fail-incomplete-questionnaire',
  'fail-taxonomy-currency', 'violation-third-party-js-css-hosting', 'violation-css-outside-components',
  'violation-js-in-salesforce-domain', 'violation-secret-data-in-debug', 'violation-insecure-storage-sensitive-data',
  'violation-known-vulnerable-software', 'violation-sample-code-in-production', 'violation-crud-fls-bypass',
  'violation-sharing-rules-bypass', 'violation-soql-injection', 'violation-csrf-page-instantiation',
  'violation-open-redirects', 'violation-lockerservice-disabled', 'violation-insufficient-escaping-components',
  'violation-async-code-in-components', 'violation-secure-communication', 'violation-feature-management-change-protection',
  'violation-getinstance-with-taint', 'agentforce-action-classification', 'agentforce-execution-identity-verifiedcustomerid',
  'agentforce-no-user-controlled-record-references', 'agentforce-confirmation-required-sensitive-actions',
  'agentforce-no-third-party-llm-in-package', 'agentforce-no-prompt-response-logging', 'agentforce-llm-output-untrusted',
  'agentforce-prompt-hardening-design', 'agentforce-prompt-input-validation', 'agentforce-prompt-enclosure-sandwiching',
  'agentforce-system-prompt-leakage',
]

// ---------------------------------------------------------------------------
// The seeded disposition state. These three sets are the ONLY non-satisfied
// requirements; everything else applicable is SATISFIED with reviewer-
// reproducible evidence (scanner / owner-signed / structural). NONE of these are
// blocker-severity (verified below) — a single unsatisfied blocker would
// correctly flip the band to BLOCKED. 24 + 4 + 8 = 36 non-satisfied → 90/126.
// ---------------------------------------------------------------------------

// PARTIAL — evidence exists but is narrower than the architecture / drafted-unsigned.
// scan-external-sast is C4 (covers server/, not the worker/ source root).
const PARTIAL = [
  'scan-external-sast', 'artifact-fp-documentation-format', 'scan-false-positive-documentation',
  'artifact-required-materials-matrix',
]

// STATICALLY-CLEARED — newer threat-model classes the white-box audit reasons
// clean, but with NO reviewer-reproducible scanner the reviewer re-runs.
const STATIC_CLEARED = [
  'untrusted-deserialization', 'resource-consumption-abuse', 'mass-assignment-bopla', 'within-org-bola',
  'outbound-callout-trust', 'cost-amplification-denial-of-wallet', 'error-handling-fail-open',
  'agentforce-system-prompt-leakage',
]

// MISSING — owner-completed written-policy / security-program / post-approval /
// test-environment-doc artifacts a mid-prep partner has not produced yet.
const MISSING = [
  'process-security-program-required', 'process-checklist-builder', 'artifact-incident-response-plan',
  'artifact-data-retention-deletion', 'artifact-disaster-recovery-backup', 'artifact-vuln-remediation-sla',
  'artifact-hosting-architecture', 'artifact-prior-pentest-attestation', 'post-incident-reporting-24h',
  'post-periodic-rereview', 'post-version-attestation', 'post-pkce-refresh-rotation-mandate',
  'post-test-environment-liveness', 'post-oauth-legacy-flow-retirements', 'testenv-test-personas-documented',
  'testenv-realistic-test-data', 'testenv-usage-documentation', 'testenv-trialforce-template-content-policy',
  'testenv-developer-edition-default-settings', 'testenv-trialforce-org-lifespan', 'testenv-locker-csp-enabled',
  'dast-endpoints-production-mode', 'dast-screenshot-proof-of-scanned-url', 'artifact-user-documentation',
]

const nonSat = new Set([...PARTIAL, ...STATIC_CLEARED, ...MISSING])

// ---------------------------------------------------------------------------
// The 5 seeded ledger findings (C4 is evidence-only). Dedup id is computed
// exactly as the schema prescribes: first 16 hex of
// sha256(normalized_file + '\n' + normalized_title).
// ---------------------------------------------------------------------------
function findingId(file, title) {
  const nf = String(file).replace(/:\d+(?:[-,]\d+)*$/, '')
  const nt = String(title).toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim()
  return createHash('sha256').update(nf + '\n' + nt).digest('hex').slice(0, 16)
}
function finding(o) {
  return {
    id: findingId(o.file, o.title), dimension: o.dimension, title: o.title,
    severity: o.severity, adjusted_severity: o.adjusted_severity, file: o.file,
    status: o.status, verdict: o.verdict, first_seen: 1, last_seen: 1,
    verdict_reasoning: o.verdict_reasoning,
    ...(o.accepted_risk_justification ? { accepted_risk_justification: o.accepted_risk_justification } : {}),
    ...(o.accepted_by ? { accepted_by: o.accepted_by } : {}),
    ...(o.exploit_scenario ? { exploit_scenario: o.exploit_scenario } : {}),
    ...(o.recommendation ? { recommendation: o.recommendation } : {}),
  }
}
const FINDINGS = [
  finding({ // C1 — severity-boundary (open low; medium defensible)
    dimension: 'apex-exposed-surface',
    title: 'Missing explicit FLS enforcement on Contact PII in cacheable controller',
    file: 'force-app/main/default/classes/SolanoAccountInsightController.cls:25',
    severity: 'medium', adjusted_severity: 'low', status: 'confirmed', verdict: 'confirmed_real',
    verdict_reasoning: 'with sharing + owner-scoped (no caller id) defangs IDOR/cross-tenant; the residual is field-level — no WITH USER_MODE/stripInaccessible on Email/Phone/MobilePhone. Real, but compensated → low hardening, not a blocker.',
    recommendation: 'Add WITH USER_MODE (or Security.stripInaccessible) to enforce FLS explicitly.',
  }),
  finding({ // C2 — tempting FP (refuted; the load-bearing precision result)
    dimension: 'apex-exposed-surface',
    title: 'Possible IDOR in without-sharing AuraEnabled opportunity lookup',
    file: 'force-app/main/default/classes/SolanoOpportunityController.cls:20',
    severity: 'high', adjusted_severity: 'high', status: 'refuted', verdict: 'false_positive',
    verdict_reasoning: 'SolanoAccessGuard.assertVisible runs with sharing + WITH USER_MODE and scopes the caller id to the running user owned/account-team records BEFORE the without-sharing read; the IDOR is defanged. Refuted (hardening nit: prefer with sharing + USER_MODE over guard-then-without-sharing).',
  }),
  finding({ // C3 — fix-vs-document (accepted_risk / documented FP)
    dimension: 'web-client',
    title: 'Strict-Transport-Security header not set on companion endpoint',
    file: 'server/index.js:14', severity: 'medium', adjusted_severity: 'medium',
    status: 'accepted_risk', verdict: 'confirmed_real',
    verdict_reasoning: 'DAST medium. TLS terminates at the edge proxy which injects HSTS; the origin is never reached over plaintext. Acceptable-with-justification per the published bar; documented FP. Owner must confirm the edge HSTS claim.',
    accepted_risk_justification: 'Edge proxy (TLS terminator) injects Strict-Transport-Security for every response; origin unreachable over plaintext. Defense-in-depth header optional. (Owner-confirmed edge config.)',
    accepted_by: 'security-owner (pending owner confirmation of edge config)',
  }),
  finding({ // C5 — near-ready deployed artifact (open medium; deep-audit path)
    dimension: 'package-metadata',
    title: 'End-user permission set grants viewAllRecords on forecast snapshot object',
    file: 'force-app/main/default/permissionsets/Solano_Standard.permissionset-meta.xml:14',
    severity: 'medium', adjusted_severity: 'medium', status: 'confirmed', verdict: 'confirmed_real',
    verdict_reasoning: 'Deployed-artifact finding: Solano_Standard grants viewAllRecords on Solano_Forecast_Snapshot__c — a within-org sharing bypass letting any assigned user read every rep snapshot. Non-catastrophic (derived data, no write bypass, modifyAllRecords=false) → medium least-privilege.',
    recommendation: 'Drop viewAllRecords from the end-user permset; scope cross-rep reads to an admin/dashboard permset or sharing rules.',
  }),
  finding({ // C6 — prompt-hardening middle (open low; not over-fired)
    dimension: 'agentforce-package',
    title: 'Prompt template uses a static delimiter instead of a per-inference enclosure token',
    file: 'force-app/main/default/genAiPromptTemplates/Solano_ForecastSummary.genAiPromptTemplate-meta.xml:8',
    severity: 'low', adjusted_severity: 'low', status: 'confirmed', verdict: 'partially_real',
    verdict_reasoning: 'Template HAS a role, an explicit data-only clause, and sandwiching — real injection mitigations. The residual is the STATIC ----- DATA ----- delimiter (echo-able) vs a per-inference secure-random enclosure (cf. Solano_SafeReply). Low hardening, not a confirmed injection hole.',
    recommendation: 'Adopt a per-inference secure-random enclosure token (the Solano_SafeReply pattern).',
  }),
]

// ---------------------------------------------------------------------------
// Evidence-index builder: satisfy every applicable id EXCEPT the non-satisfied
// sets; mark PARTIAL / STATIC explicitly; OMIT MISSING (no entry → MISSING).
// ---------------------------------------------------------------------------
function evidenceEntry(id) {
  if (MISSING.includes(id)) return null
  if (PARTIAL.includes(id)) {
    return {
      ref_type: 'requirement', ref_id: id, source: 'generate-artifacts:partial',
      collected_by: id.startsWith('scan-') ? 'scanner' : 'owner',
      verified: { value: false, how: 'drafted / scoped narrower than the architecture — owner to complete' },
      reviewer_reproducible: false, disposition: 'partial',
      location: `.security-review/evidence/${id}.partial.json`,
    }
  }
  if (STATIC_CLEARED.includes(id)) {
    return {
      ref_type: 'requirement', ref_id: id, source: 'audit-codebase:pass1',
      collected_by: 'agent', verified: { value: true, how: 'white-box static audit only (no reviewer-reproducible scanner for this class)' },
      reviewer_reproducible: false, disposition: 'statically-cleared',
      location: 'docs/security-review/audit-report-2026-06-20-pass1.md',
    }
  }
  // SATISFIED — reviewer-reproducible (scanner report / owner-signed / structural).
  const isScan = id.startsWith('scan-') || id.startsWith('dast-') || id.startsWith('endpoint-') || id.startsWith('violation-') || id.startsWith('fail-')
  return {
    ref_type: 'requirement', ref_id: id,
    source: isScan ? 'run-scans:reviewer-reproducible' : 'generate-artifacts:owner-signed',
    collected_by: isScan ? 'scanner' : 'owner',
    verified: { value: true, how: isScan ? 'scanner exit + parsed report on disk' : 'owner-signed artifact / structural confirmation a reviewer can re-verify' },
    reviewer_reproducible: true, disposition: 'satisfied',
    location: `.security-review/evidence/${id}.json`,
  }
}

function buildState(dir, applicableIds) {
  mkdirSync(join(dir, '.security-review', 'evidence'), { recursive: true })
  writeFileSync(join(dir, '.security-review', 'scope-manifest.json'), JSON.stringify({
    applicableBaselineIds: applicableIds,
    elements: ELEMENTS.map((t) => ({ type: t })),
  }))
  writeFileSync(join(dir, '.security-review', 'audit-ledger.json'), JSON.stringify({
    schema_version: '1', findings: FINDINGS,
    passes: [{ id: 1, date: RUN_DATE, tier: 'standard', audited_commit: 'solanofixturehead', dimensions: ['apex-exposed-surface', 'agentforce-package', 'web-client', 'package-metadata'], agents: { finders: 12, verifiers: 12 } }],
  }))
  writeFileSync(join(dir, '.security-review', 'evidence', 'index.json'), JSON.stringify({
    schema_version: 1, generated: RUN_DATE,
    entries: applicableIds.map(evidenceEntry).filter(Boolean),
  }))
}

function runSci(dir) {
  const out = execFileSync('node', [SCI, '--target', dir, '--plugin', PLUGIN, '--date', RUN_DATE, '--json'], { encoding: 'utf8' })
  return JSON.parse(out)
}
function fixture(applicableIds) {
  const dir = mkdtempSync(join(tmpdir(), 'solano-band-'))
  dirs.push(dir)
  buildState(dir, applicableIds)
  return dir
}

// ---------------------------------------------------------------------------
// Guard: none of the non-satisfied ids may be a blocker (else the design is
// inconsistent — a missing/partial/static blocker would BLOCK, not mid-band).
// ---------------------------------------------------------------------------
function baselineSeverityMap() {
  const yaml = readFileSync(join(PLUGIN, 'baseline', 'requirements-baseline.yaml'), 'utf8')
  const map = {}
  let cur = null
  for (const raw of yaml.split('\n')) {
    const idm = raw.match(/^- id:\s*(\S+)/)
    if (idm) { cur = idm[1]; continue }
    if (!cur) continue
    const s = raw.match(/^\s+severity_if_missing:\s*(\S+)/)
    if (s) { map[cur] = s[1]; cur = null }
  }
  return map
}

check('design invariant: no non-satisfied requirement is blocker-severity', () => {
  const sev = baselineSeverityMap()
  const offenders = [...nonSat].filter((id) => sev[id] === 'blocker')
  assert.deepEqual(offenders, [], `non-satisfied blocker(s) would force BLOCKED, not mid-band: ${offenders.join(', ')}`)
})

check('design invariant: 126 applicable, 36 non-satisfied → 90 satisfied', () => {
  assert.equal(SOLANO_APPLICABLE.length, 126, 'fixed Solano applicable set must be 126')
  assert.equal(nonSat.size, 36, 'PARTIAL(4)+STATIC(8)+MISSING(24) must be 36 distinct ids')
  assert.equal(PARTIAL.length, 4); assert.equal(STATIC_CLEARED.length, 8); assert.equal(MISSING.length, 24)
})

// ---------------------------------------------------------------------------
// PRIMARY — fixed 126-id manifest scored against the live baseline.
// ---------------------------------------------------------------------------
check('PRIMARY: completeness lands in the 65-75% band (== 71%)', () => {
  const j = runSci(fixture(SOLANO_APPLICABLE))
  assert.ok(j.completeness_pct >= 65 && j.completeness_pct <= 75,
    `completeness ${j.completeness_pct}% is outside the middle band 65-75%`)
  assert.equal(j.completeness_pct, 71, 'exact deterministic completeness drifted from 71% — re-check the seeded sets')
})

check('PRIMARY: band is MATERIALS COMPLETE (close, here is the gap)', () => {
  const j = runSci(fixture(SOLANO_APPLICABLE))
  assert.equal(j.band, 'MATERIALS COMPLETE',
    `band ${j.band} — expected MATERIALS COMPLETE (a BLOCKED here means an unsatisfied blocker; NOT READY means an open high or the currency floor fired)`)
  assert.equal(j.blocked, false)
})

check('PRIMARY: coverage vector — 90 satisfied / 8 statically-cleared / 4 partial / 24 missing', () => {
  const j = runSci(fixture(SOLANO_APPLICABLE))
  assert.equal(j.coverage.applicable, 126)
  assert.equal(j.coverage.satisfied, 90)
  assert.equal(j.coverage.statically_cleared, 8)
  assert.equal(j.coverage.partial, 4)
  assert.equal(j.coverage.missing, 24)
})

check('PRIMARY: disposition — no open critical, no open high (the calibration result)', () => {
  const j = runSci(fixture(SOLANO_APPLICABLE))
  assert.equal(j.disposition.open_critical, 0, 'a contestable issue was mis-escalated to critical')
  assert.equal(j.disposition.open_high, 0, 'a contestable issue was mis-escalated to high')
  assert.equal(j.disposition.dispositioned, 2, 'C2 (refuted) + C3 (accepted_risk) should be dispositioned')
})

check('PRIMARY: currency surfaces but the hard floor does NOT fire (materials incomplete)', () => {
  const j = runSci(fixture(SOLANO_APPLICABLE))
  assert.ok(j.freshness.caveated >= 1, 'unverified/stale baseline entries should surface as caveats')
  assert.equal(j.freshness.hard_stale, 0, 'no entry is >180d stale at the pinned run date')
  // The currency floor only fires when currency is the ONLY thing between the
  // partner and ready; here materials are incomplete, so the band must NOT be
  // flipped to NOT READY by it.
  assert.equal(j.band, 'MATERIALS COMPLETE')
})

check('PRIMARY: the seeded findings round-trips into the blocker list as empty', () => {
  const j = runSci(fixture(SOLANO_APPLICABLE))
  assert.deepEqual(j.blocker_findings, [], 'no open critical findings expected')
  assert.deepEqual(j.blocker_requirements, [], 'every blocker requirement must be satisfied')
})

// ---------------------------------------------------------------------------
// CORROBORATE — re-derive the applicable set from the LIVE baseline and re-score.
// Catches a renamed/removed id and baseline drift large enough to break the design.
// ---------------------------------------------------------------------------
const liveApplicable = computeApplicable(
  parseBaselineApplies(readFileSync(join(PLUGIN, 'baseline', 'requirements-baseline.yaml'), 'utf8')),
  ELEMENTS
)

check('CORROBORATE: every fixed Solano id still exists in the live applicable set', () => {
  const live = new Set(liveApplicable)
  const gone = SOLANO_APPLICABLE.filter((id) => !live.has(id))
  assert.deepEqual(gone, [], `Solano applicable id(s) no longer in the baseline — re-derive SOLANO_APPLICABLE: ${gone.join(', ')}`)
})

check('CORROBORATE: live-derived applicable scores in-band (band MATERIALS COMPLETE)', () => {
  const j = runSci(fixture(liveApplicable))
  // Wider sanity band: the design survives moderate baseline growth; extreme
  // drift (a flood of new applicable reqs auto-credited, or a non-satisfied id
  // turned blocker) trips this loud so the fixture gets re-tuned.
  assert.ok(j.completeness_pct >= 60 && j.completeness_pct <= 80,
    `live-derived completeness ${j.completeness_pct}% drifted out of the [60,80] sanity band — re-tune the Solano fixture`)
  assert.equal(j.band, 'MATERIALS COMPLETE', `live-derived band ${j.band} — a non-satisfied id may have become blocker-severity`)
  assert.equal(j.blocked, false)
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

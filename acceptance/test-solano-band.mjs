#!/usr/bin/env node
/**
 * Standing band-check for the MIDDLE-BAND judgment fixture (Solano).
 * docs/roadmap-middle-band-judgment-fixture.md.
 *
 * THE HONEST POST-PHASE-A STATE (rewritten after cold run #1). Cold run #1 taught
 * the "9% lesson": the JUDGMENT (what the audit FINDS) and the SCI COMPLETENESS
 * (what materials are reviewer-reproducibly evidenced) are SEPARATE measurements,
 * and the fixture rebuild (Phase A) only fixes the first. This standing check
 * therefore asserts the two axes separately:
 *
 *   1. THE JUDGMENT IS CLEAN — the rebuilt fixture's audit surfaces ONLY the six
 *      contestable issues (C1-C6); ZERO open critical, ZERO open high. The block,
 *      if any, comes from owner-completable REQUIREMENTS (blocker_findings EMPTY),
 *      never from a code finding — the precise proof Phase A worked.
 *   2. THE SCI STAYS LOW / BLOCKED until Phase B — the fixture is mostly-compliant
 *      in CODE, but the SCI is dominated by owner-completable requirements (portal
 *      Checkmarx, Apex test coverage, the reviewer test env, authenticated DAST,
 *      the written-policy / security-program pack, post-approval attestations) that
 *      no audit can satisfy. Only the toolkit's OWN automated, reviewer-reproducible
 *      scans (Code Analyzer / SFGE / OSV / Checkov / gitleaks) count SATISFIED.
 *
 * This is NOT the old hand-authored 71% / MATERIALS COMPLETE — that number assumed
 * owner prep the fixture does not carry. Phase B (deferred) pre-populates the owner
 * artifacts and re-grounds this test to the 65-75% band.
 *
 * Two layers:
 *   PRIMARY     — a FIXED 126-id Solano manifest (so baseline GROWTH can't drift
 *                 the count) scored against the live baseline. Asserts the exact
 *                 honest state (7% / BLOCKED-on-materials / empty blocker_findings /
 *                 0 open critical-high).
 *   CORROBORATE — re-derives the applicable set from the LIVE baseline and re-scores:
 *                 catches a renamed/removed id (subset check) and confirms the honest
 *                 low/BLOCKED shape survives baseline drift.
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

console.log('solano middle-band standing test (honest post-Phase-A state)')

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
// The honest disposition state of a partner who has run the audit + the toolkit's
// OWN automated scans, but has NOT done the owner-facing materials (Phase B).
//
// AUTOMATED_SATISFIED — requirements the toolkit satisfies with reviewer-reproducible
//   evidence WITHOUT owner action: the scanners it runs (Code Analyzer / SFGE / OSV /
//   Checkov / gitleaks). These are the ONLY SATISFIED entries.
// PARTIAL — scan-external-sast (C4): the SAST covered server/, not the worker/ root.
// STATIC_CLEARED — the code/threat classes the white-box audit examined + cleared,
//   with no reviewer-reproducible owner/scanner evidence registered (never credited).
// MISSING — everything else (owner artifacts, process, test env, DAST, portal scans,
//   post-approval attestations) — the Phase B gap. Implicit: applicable minus the above.
// ---------------------------------------------------------------------------
const AUTOMATED_SATISFIED = [
  'scan-code-analyzer-v5-required', 'scan-code-analyzer-invocation', 'scan-code-analyzer-engines',
  'scan-pmd-appexchange-rules', 'scan-sfge-crud-fls-dataflow', 'scan-external-sca', 'scan-iac-misconfig',
  'scan-dependency-vulnerabilities', 'fail-hardcoded-secrets',
]
const PARTIAL = ['scan-external-sast']
const STATIC_CLEARED = [
  // fail-* code classes the audit cleared (not the process/materials fail-* ones)
  'fail-crud-fls', 'fail-sharing-model', 'fail-soql-injection', 'fail-xss', 'fail-info-disclosure',
  'fail-sessionid-egress', 'error-handling-fail-open', 'fail-js-not-static-resources',
  'fail-lightning-component-hygiene',
  // newer threat-model classes (no reviewer-reproducible scanner)
  'untrusted-deserialization', 'resource-consumption-abuse', 'mass-assignment-bopla', 'within-org-bola',
  'outbound-callout-trust', 'cost-amplification-denial-of-wallet',
  // violation-* code classes the audit cleared
  'violation-third-party-js-css-hosting', 'violation-css-outside-components', 'violation-js-in-salesforce-domain',
  'violation-secret-data-in-debug', 'violation-insecure-storage-sensitive-data', 'violation-known-vulnerable-software',
  'violation-sample-code-in-production', 'violation-crud-fls-bypass', 'violation-sharing-rules-bypass',
  'violation-soql-injection', 'violation-csrf-page-instantiation', 'violation-open-redirects',
  'violation-lockerservice-disabled', 'violation-insufficient-escaping-components', 'violation-async-code-in-components',
  'violation-secure-communication', 'violation-feature-management-change-protection', 'violation-getinstance-with-taint',
  // agentforce code classes the audit cleared (incl. the blockers — audit clear ≠ reviewer-reproducible)
  'agentforce-action-classification', 'agentforce-execution-identity-verifiedcustomerid',
  'agentforce-no-user-controlled-record-references', 'agentforce-confirmation-required-sensitive-actions',
  'agentforce-no-third-party-llm-in-package', 'agentforce-no-prompt-response-logging', 'agentforce-llm-output-untrusted',
  'agentforce-prompt-hardening-design', 'agentforce-prompt-input-validation', 'agentforce-prompt-enclosure-sandwiching',
  'agentforce-system-prompt-leakage',
]
const satisfiedSet = new Set(AUTOMATED_SATISFIED)
const partialSet = new Set(PARTIAL)
const staticSet = new Set(STATIC_CLEARED)
const MISSING = SOLANO_APPLICABLE.filter((id) => !satisfiedSet.has(id) && !partialSet.has(id) && !staticSet.has(id))

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
    verdict_reasoning: 'DAST medium. TLS terminates at the edge proxy which injects HSTS for production traffic; /healthz is directly reachable so the claim is not airtight. Acceptable-with-justification per the published bar; documented FP. Owner must confirm the edge config.',
    accepted_risk_justification: 'Edge proxy (TLS terminator) injects Strict-Transport-Security for production traffic; origin-level header is defense-in-depth. /healthz direct path is owner-confirmed low-risk. (Owner-confirmed edge config.)',
    accepted_by: 'security-owner (pending owner confirmation of edge config)',
  }),
  finding({ // C5 — source-permset least-privilege (open medium)
    dimension: 'package-metadata',
    title: 'End-user permission set grants viewAllRecords on forecast snapshot object',
    file: 'force-app/main/default/permissionsets/Solano_Standard.permissionset-meta.xml:14',
    severity: 'medium', adjusted_severity: 'medium', status: 'confirmed', verdict: 'confirmed_real',
    verdict_reasoning: 'Source-permset finding (package is needs-build; no deployed artifact): Solano_Standard grants viewAllRecords on Solano_Forecast_Snapshot__c — a within-org sharing bypass letting any assigned user read every rep snapshot. Non-catastrophic (derived data, no write bypass, modifyAllRecords=false) → medium least-privilege.',
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
// Evidence-index builder: SATISFIED only for the toolkit's automated reviewer-
// reproducible scans; PARTIAL / STATIC explicit; OMIT everything else (→ MISSING).
// ---------------------------------------------------------------------------
function evidenceEntry(id) {
  if (satisfiedSet.has(id)) {
    return {
      ref_type: 'requirement', ref_id: id, source: 'run-scans:reviewer-reproducible',
      collected_by: 'scanner',
      verified: { value: true, how: 'scanner exit + parsed report on disk (Code Analyzer/SFGE/OSV/Checkov/gitleaks)' },
      reviewer_reproducible: true, disposition: 'satisfied',
      location: `.security-review/evidence/${id}.json`,
    }
  }
  if (partialSet.has(id)) {
    return {
      ref_type: 'requirement', ref_id: id, source: 'run-scans:family-7:semgrep',
      collected_by: 'scanner',
      verified: { value: false, how: 'SAST covered server/ but not the worker/ source root — scoped narrower than the architecture' },
      reviewer_reproducible: false, disposition: 'partial',
      location: `.security-review/evidence/${id}.partial.json`,
    }
  }
  if (staticSet.has(id)) {
    return {
      ref_type: 'requirement', ref_id: id, source: 'audit-codebase:pass1',
      collected_by: 'agent',
      verified: { value: true, how: 'white-box static audit only (no reviewer-reproducible scanner/owner evidence for this class)' },
      reviewer_reproducible: false, disposition: 'statically-cleared',
      location: 'docs/security-review/audit-report-2026-06-20-pass1.md',
    }
  }
  return null // MISSING — owner-completable materials not done (the Phase B gap)
}

// elements defaults to empty: the PRIMARY layer pins the FROZEN SOLANO_APPLICABLE
// id set so baseline growth cannot drift the count — but with real elements
// present, compute-sci's stale-manifest refusal would (correctly) reject a frozen
// set the moment the baseline grows. Only the CORROBORATE layer, whose id set is
// live-derived from ELEMENTS by construction, passes real elements.
function buildState(dir, applicableIds, elements = []) {
  mkdirSync(join(dir, '.security-review', 'evidence'), { recursive: true })
  writeFileSync(join(dir, '.security-review', 'scope-manifest.json'), JSON.stringify({
    applicableBaselineIds: applicableIds,
    elements,
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
function fixture(applicableIds, elements = []) {
  const dir = mkdtempSync(join(tmpdir(), 'solano-band-'))
  dirs.push(dir)
  buildState(dir, applicableIds, elements)
  return dir
}

// ---------------------------------------------------------------------------
// Design invariants.
// ---------------------------------------------------------------------------
check('design invariant: fixed applicable set is 126; satisfied/partial/static are disjoint subsets', () => {
  assert.equal(SOLANO_APPLICABLE.length, 126, 'fixed Solano applicable set must be 126')
  const all = new Set(SOLANO_APPLICABLE)
  for (const id of [...AUTOMATED_SATISFIED, ...PARTIAL, ...STATIC_CLEARED]) {
    assert.ok(all.has(id), `disposition id ${id} is not in the applicable set`)
  }
  const seen = new Set()
  for (const id of [...AUTOMATED_SATISFIED, ...PARTIAL, ...STATIC_CLEARED]) {
    assert.ok(!seen.has(id), `id ${id} appears in more than one disposition set`)
    seen.add(id)
  }
  // counts: 9 satisfied + 1 partial + 44 static + 72 missing = 126
  assert.equal(AUTOMATED_SATISFIED.length, 9)
  assert.equal(PARTIAL.length, 1)
  assert.equal(STATIC_CLEARED.length, 44)
  assert.equal(MISSING.length, 72)
})

check('design invariant: the seeded findings carry NO critical and NO high open severity', () => {
  const open = FINDINGS.filter((f) => f.status === 'confirmed' || f.status === 'regressed')
  const bad = open.filter((f) => f.adjusted_severity === 'critical' || f.adjusted_severity === 'high')
  assert.deepEqual(bad.map((f) => f.title), [], 'an open finding is critical/high — the Phase A win is broken')
  assert.equal(FINDINGS.length, 5, 'C1, C2, C3, C5, C6 (C4 is evidence-only)')
})

// ---------------------------------------------------------------------------
// PRIMARY — fixed 126-id manifest scored against the live baseline.
// ---------------------------------------------------------------------------
check('PRIMARY: the JUDGMENT is clean — 0 open critical, 0 open high; block is NOT from findings', () => {
  const j = runSci(fixture(SOLANO_APPLICABLE))
  assert.equal(j.disposition.open_critical, 0, 'a contestable issue was mis-escalated to critical')
  assert.equal(j.disposition.open_high, 0, 'a contestable issue was mis-escalated to high')
  assert.equal(j.disposition.dispositioned, 2, 'C2 (refuted) + C3 (accepted_risk) dispositioned')
  assert.deepEqual(j.blocker_findings, [], 'NO code finding may block — the block is owner-materials-only (the Phase A win)')
})

check('PRIMARY: the SCI is LOW / BLOCKED on owner materials (the Phase B gap, not the old 71%)', () => {
  const j = runSci(fixture(SOLANO_APPLICABLE))
  assert.equal(j.completeness_pct, 7, 'exact deterministic completeness drifted from 7% (9 automated-satisfied / 126)')
  assert.ok(j.completeness_pct < 65, 'completeness must be BELOW the 65-75 band until Phase B pre-populates owner artifacts')
  assert.equal(j.band, 'BLOCKED', `band ${j.band} — expected BLOCKED on unsatisfied owner blocker requirements`)
  assert.equal(j.blocked, true)
  assert.ok(j.blocker_requirements.length > 0, 'blocked on owner-completable blocker requirements')
  assert.match(j.gate_reason, /unsatisfied blocker requirement/, 'the block must be on requirements, not findings')
})

check('PRIMARY: coverage vector — 9 satisfied / 44 statically-cleared / 1 partial / 72 missing', () => {
  const j = runSci(fixture(SOLANO_APPLICABLE))
  assert.equal(j.coverage.applicable, 126)
  assert.equal(j.coverage.satisfied, 9)
  assert.equal(j.coverage.statically_cleared, 44)
  assert.equal(j.coverage.partial, 1)
  assert.equal(j.coverage.missing, 72)
})

// ---------------------------------------------------------------------------
// CORROBORATE — re-derive the applicable set from the LIVE baseline and re-score.
// Catches a renamed/removed id and confirms the honest low/BLOCKED shape holds.
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

check('CORROBORATE: live-derived state stays low / BLOCKED with empty blocker_findings', () => {
  // live-derived ids + real elements: consistent by construction, so this layer
  // also exercises compute-sci's stale-manifest check on its passing (fresh) path.
  const j = runSci(fixture(liveApplicable, ELEMENTS.map((t) => ({ type: t }))))
  assert.ok(j.completeness_pct < 20, `live-derived completeness ${j.completeness_pct}% should stay low until Phase B`)
  assert.equal(j.band, 'BLOCKED', `live-derived band ${j.band} — expected BLOCKED on owner materials`)
  assert.equal(j.blocked, true)
  assert.deepEqual(j.blocker_findings, [], 'no code finding may block — the block is owner-materials-only')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

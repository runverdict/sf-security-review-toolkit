#!/usr/bin/env node
/**
 * Standing test for RULE_BAND_FLOOR (0.8.105 — deterministic-band precision):
 * the sourced, narrow, LOWERING-ONLY per-rule override on the class band inside
 * buildFinding, keyed `engine/ruleId`.
 *
 * The defect it locks against: an availability-only Dockerfile lint (missing
 * HEALTHCHECK — trivy/DS-0026, checkov/CKV_DOCKER_2) shipped as a HIGH security
 * finding on a real cold run, carrying the literal suffix "[Trivy severity LOW,
 * recorded for reference]" — the toolkit recorded that the tool said LOW, then
 * banded it HIGH, and both rows needed hand-written accepted_risk justifications.
 *
 * Guards:
 *   BF1 — trivy/DS-0026 (real fixture) bands `low`, carries the honesty note
 *         (availability hygiene, NOT a refutation), and is STILL PRESENT in the
 *         findings — the floor lowers, it never drops.
 *   BF2 — checkov/CKV_DOCKER_2 (real fixture) likewise.
 *   BF3 — LOWERING-ONLY, enforced in code: a map entry that would RAISE a band
 *         above the class band is IGNORED (class band wins); an EQUAL band is a
 *         no-op too (strictly-lower only). [mut1: remove the guard → RED]
 *   BF4 — an UNMAPPED iac-misconfig rule is BYTE-IDENTICAL to the pre-change
 *         buildFinding output (the hand-built expected object below IS the
 *         pre-change construction, field for field).
 *   BF5 — no other adapter's output changes: the map is structurally scoped to
 *         checkov/trivy keys (the lookup is engine-prefixed), and the real
 *         semgrep / gitleaks / detect-secrets fixtures ingest with their known
 *         bands and ZERO floor notes.
 *
 * Dependency-free: `node acceptance/test-rule-band-floor.mjs`.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ingest,
  buildFinding,
  trivyAdapter,
  checkovAdapter,
  semgrepAdapter,
  gitleaksAdapter,
  detectSecretsAdapter,
  RULE_BAND_FLOOR,
  FINDING_BAND_RANK,
  CLASS_DEFS,
} from '../harness/ingest-scanner-findings.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const FIX = join(PLUGIN, 'acceptance', 'fixtures')
const TRIVY = join(FIX, 'trivy-dockerfile-solano.json') // genuine Trivy 0.71.2: 1 FAIL misconfig DS-0026, Severity LOW, no AVDID (matches the cold run)
const CHECKOV = join(FIX, 'checkov-dockerfile-solano.json') // genuine Checkov 3.3.2: 1 failed check CKV_DOCKER_2
const SEMGREP_ERR = join(FIX, 'semgrep-helios.json') // 1× ERROR → high (tool→band path)
const GITLEAKS = join(FIX, 'gitleaks-coldstart-full.json') // 3× hardcoded-secrets → class high
const DETECT_SECRETS = join(FIX, 'detect-secrets-solano.json') // hardcoded-secrets → class high

const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'))
const FLOOR_NOTE_RE = /banded low by the sourced rule-band floor/
const HONESTY_RE = /availability\/orchestration hygiene/

let pass = 0, fail = 0
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

// ─────────────────────────────────────────────────────────────────────────────

check('BF1 trivy/DS-0026 bands low, carries the honesty note, and is STILL PRESENT (lowered, never dropped)', () => {
  const { findings } = ingest(readJSON(TRIVY), trivyAdapter, { repoRoot: '', pass: 1 })
  assert.equal(findings.length, 1, 'the finding must survive — the floor never drops')
  const f = findings[0]
  assert.equal(f.engine, 'trivy')
  assert.equal(f.ruleId, 'DS-0026')
  assert.equal(f.severity, 'low')
  assert.equal(f.adjusted_severity, 'low')
  assert.equal(f.class, 'iac-misconfig') // class ownership unchanged — only the band moved
  assert.equal(f.dimension, 'infrastructure-iac') // dimension deliberately untouched
  assert.equal(f.status, 'confirmed') // real finding, not a refutation
  assert.equal(f.verdict, 'confirmed_real')
  assert.match(f.verdict_reasoning, FLOOR_NOTE_RE)
  assert.match(f.verdict_reasoning, HONESTY_RE)
  // the note states LOW-because-non-blocking, never false-positive language
  assert.ok(!/false.positive|refuted|not a real/i.test(f.verdict_reasoning.replace(/not a security misconfiguration/, '')),
    'the note must not read as a refutation')
})

check('BF2 checkov/CKV_DOCKER_2 bands low, carries the honesty note, and is STILL PRESENT', () => {
  const { findings } = ingest(readJSON(CHECKOV), checkovAdapter, { repoRoot: '', pass: 1 })
  assert.equal(findings.length, 1, 'the finding must survive — the floor never drops')
  const f = findings[0]
  assert.equal(f.engine, 'checkov')
  assert.equal(f.ruleId, 'CKV_DOCKER_2')
  assert.equal(f.severity, 'low')
  assert.equal(f.adjusted_severity, 'low')
  assert.equal(f.class, 'iac-misconfig')
  assert.equal(f.dimension, 'infrastructure-iac')
  assert.equal(f.status, 'confirmed')
  assert.match(f.verdict_reasoning, FLOOR_NOTE_RE)
  assert.match(f.verdict_reasoning, HONESTY_RE)
})

check('BF3 LOWERING-ONLY is enforced in code: a floor entry ABOVE the class band is ignored (class wins); an EQUAL entry is a no-op', () => {
  // Probe with entries injected into the exported map, then always clean up.
  // view-modify-all-data's class band is `info` (least-privilege-permission-grants
  // = informational) — the LOWEST band, so ANY floor on it would be a raise.
  const raiseKey = 'test-engine/RAISE_PROBE'
  const equalKey = 'test-engine/EQUAL_PROBE'
  RULE_BAND_FLOOR[raiseKey] = { band: 'critical', note: 'a raise the guard must ignore' }
  RULE_BAND_FLOOR[equalKey] = { band: 'high', note: 'an equal band the guard must no-op' }
  try {
    const raised = buildFinding({
      engine: 'test-engine', ruleId: 'RAISE_PROBE', severityNum: null,
      file: 'x/PermSet.permissionset-meta.xml', startLine: 3, message: 'probe',
      resources: [], classKey: 'view-modify-all-data', repoRoot: '', pass: 1,
    })
    assert.equal(raised.adjusted_severity, 'info', 'the class band (info) must win over a critical floor — the map can never raise')
    assert.ok(!FLOOR_NOTE_RE.test(raised.verdict_reasoning), 'an ignored raise leaves NO floor note')

    // iac-misconfig's class band is high; an equal high floor is not STRICTLY lower → no-op
    const equal = buildFinding({
      engine: 'test-engine', ruleId: 'EQUAL_PROBE', severityNum: null,
      file: 'Dockerfile', startLine: 1, message: 'probe',
      resources: [], classKey: 'iac-misconfig', repoRoot: '', pass: 1,
    })
    assert.equal(equal.adjusted_severity, 'high')
    assert.ok(!FLOOR_NOTE_RE.test(equal.verdict_reasoning), 'an equal band leaves NO floor note (strictly-lower only)')
  } finally {
    delete RULE_BAND_FLOOR[raiseKey]
    delete RULE_BAND_FLOOR[equalKey]
  }
  // the rank scale the guard compares on is total and ordered
  assert.ok(FINDING_BAND_RANK.critical > FINDING_BAND_RANK.high && FINDING_BAND_RANK.high > FINDING_BAND_RANK.medium
    && FINDING_BAND_RANK.medium > FINDING_BAND_RANK.low && FINDING_BAND_RANK.low > FINDING_BAND_RANK.info)
})

check('BF4 an UNMAPPED iac-misconfig rule (root-user check) is BYTE-IDENTICAL to the pre-change buildFinding output', () => {
  const f = buildFinding({
    engine: 'checkov', ruleId: 'CKV_DOCKER_8', severityNum: null,
    file: 'Dockerfile', startLine: 3, message: 'Ensure the last USER is not root',
    resources: ['https://example.test/g'], classKey: 'iac-misconfig', repoRoot: '', pass: 1,
  })
  // The expected object below IS the pre-change construction, field for field and
  // in buildFinding's own key order — any drift in an unmapped rule's output
  // (band, reasoning, key order, anything) fails the byte-compare.
  const expected = {
    id: createHash('sha256').update('checkov\nCKV_DOCKER_8\nDockerfile:3').digest('hex').slice(0, 16),
    dimension: 'infrastructure-iac',
    title: 'CKV_DOCKER_8: Ensure the last USER is not root',
    severity: 'high',
    adjusted_severity: 'high',
    file: 'Dockerfile:3',
    status: 'confirmed',
    first_seen: 1,
    last_seen: 1,
    verdict: 'confirmed_real',
    verdict_reasoning:
      'CHECKOV rule CKV_DOCKER_8 deterministically flagged this at Dockerfile:3. Ensure the last USER is not root See https://example.test/g. ' +
      'Provenance: deterministic (scanner-relayed, not an LLM judgment); severity fixed from the iac-misconfig class (baseline requirement scan-iac-misconfig = major).',
    evidence: 'Dockerfile:3 — Ensure the last USER is not root',
    recommendation: 'Remediate the flagged infrastructure-as-code misconfiguration (or document a justified false positive in the dossier — scan-iac-misconfig). Follow the linked Checkov guideline.',
    resolution_note: 'CKV_DOCKER_8 (iac-misconfig) — Ensure the last USER is not root',
    provenance: 'deterministic',
    engine: 'checkov',
    ruleId: 'CKV_DOCKER_8',
    class: 'iac-misconfig',
  }
  assert.equal(JSON.stringify(f), JSON.stringify(expected))
  // and end-to-end through the adapter: a trivy KSV privileged-container rule stays class-high
  const { findings } = ingest({
    Results: [{ Target: 'k8s/deploy.yaml', Class: 'config', Misconfigurations: [
      { ID: 'KSV017', Title: 'Privileged container', Message: 'Do not run privileged', Severity: 'HIGH', Status: 'FAIL', CauseMetadata: { StartLine: 9 } },
    ] }],
  }, trivyAdapter, { repoRoot: '', pass: 1 })
  assert.equal(findings.length, 1)
  assert.equal(findings[0].adjusted_severity, 'high')
  assert.ok(!FLOOR_NOTE_RE.test(findings[0].verdict_reasoning))
})

check('BF5 no other adapter changes: the map is scoped to checkov/trivy keys, and semgrep/gitleaks/detect-secrets fixtures ingest with known bands + zero floor notes', () => {
  // structural scope: the lookup key is `${engine}/${ruleId}`, so an engine with no
  // map entries can never hit the floor — and every seeded entry is checkov/ or trivy/
  const keys = Object.keys(RULE_BAND_FLOOR)
  assert.ok(keys.length >= 2)
  assert.ok(keys.every((k) => k.startsWith('checkov/') || k.startsWith('trivy/')),
    `unexpected engine in RULE_BAND_FLOOR: ${keys.join(', ')}`)
  // every entry lowers (low/info) — a critical/high/medium entry would be a latent raise vector
  assert.ok(Object.values(RULE_BAND_FLOOR).every((v) => v.band === 'low' || v.band === 'info'))
  // CLASS_DEFS untouched: iac-misconfig still grounds scan-iac-misconfig/infrastructure-iac/high
  assert.equal(CLASS_DEFS['iac-misconfig'].baselineId, 'scan-iac-misconfig')
  assert.equal(CLASS_DEFS['iac-misconfig'].dimension, 'infrastructure-iac')
  assert.equal(CLASS_DEFS['iac-misconfig'].fallback, 'high')

  const sg = ingest(readJSON(SEMGREP_ERR), semgrepAdapter, { repoRoot: '', pass: 1 }).findings
  assert.equal(sg.length, 1)
  assert.equal(sg[0].adjusted_severity, 'high') // ERROR → high, tool→band path untouched
  const gl = ingest(readJSON(GITLEAKS), gitleaksAdapter, { repoRoot: '', pass: 1 }).findings
  assert.equal(gl.length, 3)
  assert.ok(gl.every((f) => f.adjusted_severity === 'high' && f.class === 'hardcoded-secrets'))
  const ds = ingest(readJSON(DETECT_SECRETS), detectSecretsAdapter, { repoRoot: '', pass: 1 }).findings
  assert.ok(ds.length > 0)
  assert.ok(ds.every((f) => f.adjusted_severity === 'high' && f.class === 'hardcoded-secrets'))
  for (const f of [...sg, ...gl, ...ds]) {
    assert.ok(!FLOOR_NOTE_RE.test(f.verdict_reasoning), `floor note leaked into ${f.engine}/${f.ruleId}`)
  }
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

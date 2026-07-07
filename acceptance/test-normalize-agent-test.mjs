#!/usr/bin/env node
/**
 * Standing test for harness/normalize-agent-test.mjs — the deterministic
 * argv-builder + JSON→evidence normalizer behind prepare-test-environment step 9's
 * headless `sf agent test` utterance-validation flow.
 *
 * Hermetic + dependency-free: `node acceptance/test-normalize-agent-test.mjs`
 * (exit 0 = pass). The PURE planners + parser are driven directly; the impure
 * executor `runAgentTest` is NOT invoked against a real CLI here.
 *
 * LIVE-LEG BOUNDARY (NOT hermetically tested): the actual `sf agent test create` /
 * `run` / `run-eval` invocation against a REAL published agent + the Einstein Eval
 * API is cold-run-validated by the operator, exactly as test-standup-org.mjs does
 * not create a real scratch org. These checks pin the argv shapes, the routing-FAIL
 * invariant, and the fail-closed evidence fold — the parts that regress silently.
 *
 * Guards:
 *   N1  argv builders — exact deterministic shapes, conditional flags only-when-set
 *   N2  planRunEval carries `--result-format json` and NEVER `--output-dir`
 *   N3  planTestCreate exact shape + requires spec & apiName
 *   N4  planTestRun carries `--result-format json` AND `--output-dir <dir>`
 *   N5  invalid --batch-size (>5 / non-integer) + invalid --test-runner + missing
 *       required flags throw
 *   N6  determinism: same input ⇒ identical argv run-to-run
 *   N7  parseAgentTestResult + passingUtterances: a routing-FAIL utterance is NOT
 *       credited as passing ("submitted list contains ONLY successful utterances")
 *   N8  parseAgentTestResult extracts expected/actual topic + actions + score +
 *       duration
 *   N9  foldToEvidenceInput FAIL-CLOSED: an absent result ⇒ `pending`, never `scans`
 *   N10 foldToEvidenceInput: an on-disk result under .security-review/evidence/ ⇒
 *       a `scans` fragment pointing at the repo-relative path
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  planGenerateTestSpec, planRunEval, planTestCreate, planTestRun, planTestResults,
  parseAgentTestResult, passingUtterances, foldToEvidenceInput,
  EVIDENCE_REQ,
} from '../harness/normalize-agent-test.mjs'

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`) } }
const box = () => { const d = mkdtempSync(join(tmpdir(), 'nat-test-')); dirs.push(d); return d }

// A realistic `sf agent test run` --result-format json result: one passing utterance
// and one that MISROUTED (topic expectation FAILURE) — the authz-boundary utterance.
const RESULT_FIXTURE = {
  status: 'COMPLETED',
  testCases: [
    {
      testCaseName: 'read-happy-path', testNumber: 1,
      utterance: 'Show me my open opportunities', status: 'COMPLETED',
      startTime: '2026-07-07T00:00:00.000Z', endTime: '2026-07-07T00:00:03.000Z',
      testResults: [
        { name: 'topic_sequence_match', result: 'PASS', expectedValue: 'PipelineInspection', actualValue: 'PipelineInspection', score: 1 },
        { name: 'action_sequence_match', result: 'PASS', expectedValue: '["ListOpportunities"]', actualValue: '["ListOpportunities"]', score: 1 },
        { name: 'bot_response_rating', result: 'PASS', score: 0.95 },
      ],
    },
    {
      testCaseName: 'authz-boundary-misroute', testNumber: 2,
      utterance: "Show me another rep's private deals", status: 'COMPLETED',
      startTime: '2026-07-07T00:00:03.000Z', endTime: '2026-07-07T00:00:06.500Z',
      testResults: [
        { name: 'topic_sequence_match', result: 'FAILURE', expectedValue: 'AccessDenied', actualValue: 'PipelineInspection', score: 0 },
        { name: 'action_sequence_match', result: 'PASS', expectedValue: '[]', actualValue: '[]', score: 1 },
      ],
    },
  ],
}

console.log('normalize-agent-test standing test')

check('N1 planGenerateTestSpec: exact shape; conditional flags only when set', () => {
  assert.deepEqual(planGenerateTestSpec({}), ['agent', 'generate', 'test-spec'])
  assert.deepEqual(
    planGenerateTestSpec({ outputFile: 'specs/A-testSpec.yaml', testRunner: 'testing-center' }),
    ['agent', 'generate', 'test-spec', '--output-file', 'specs/A-testSpec.yaml', '--test-runner', 'testing-center'],
  )
  assert.deepEqual(
    planGenerateTestSpec({ fromDefinition: 'force-app/main/default/aiEvaluationDefinitions/A_Tests.aiEvaluationDefinition-meta.xml', forceOverwrite: true }),
    ['agent', 'generate', 'test-spec', '--from-definition', 'force-app/main/default/aiEvaluationDefinitions/A_Tests.aiEvaluationDefinition-meta.xml', '--force-overwrite'],
  )
})

check('N2 planRunEval: `--result-format json`, NEVER `--output-dir`; exact shape', () => {
  const bare = planRunEval({ spec: 'specs/A.yaml' })
  assert.deepEqual(bare, ['agent', 'test', 'run-eval', '--spec', 'specs/A.yaml', '--result-format', 'json'])
  assert.ok(bare.includes('--result-format') && bare[bare.indexOf('--result-format') + 1] === 'json')
  assert.ok(!bare.includes('--output-dir'), 'run-eval has NO --output-dir flag — it prints to stdout')
  const full = planRunEval({ spec: 'specs/A.yaml', apiName: 'My_Agent', batchSize: 5, noNormalize: true })
  assert.deepEqual(full, ['agent', 'test', 'run-eval', '--spec', 'specs/A.yaml', '--result-format', 'json', '--api-name', 'My_Agent', '--batch-size', '5', '--no-normalize'])
  assert.ok(!full.includes('--output-dir'), 'run-eval NEVER emits --output-dir, even fully-flagged')
})

check('N3 planTestCreate: exact shape + requires spec & apiName', () => {
  assert.deepEqual(
    planTestCreate({ spec: 'specs/A.yaml', apiName: 'A_Test' }),
    ['agent', 'test', 'create', '--spec', 'specs/A.yaml', '--api-name', 'A_Test'],
  )
  assert.deepEqual(
    planTestCreate({ spec: 'specs/A.yaml', apiName: 'A_Test', testRunner: 'agentforce-studio', preview: true, forceOverwrite: true }),
    ['agent', 'test', 'create', '--spec', 'specs/A.yaml', '--api-name', 'A_Test', '--test-runner', 'agentforce-studio', '--preview', '--force-overwrite'],
  )
  assert.throws(() => planTestCreate({ spec: 'specs/A.yaml' }), /--api-name/)
  assert.throws(() => planTestCreate({ apiName: 'A_Test' }), /--spec/)
})

check('N4 planTestRun: `--result-format json` AND `--output-dir <dir>`', () => {
  const out = join(box(), 'evidence', 'utterance-validation')
  const argv = planTestRun({ apiName: 'A_Test', wait: 10, outputDir: out })
  assert.deepEqual(argv, ['agent', 'test', 'run', '--api-name', 'A_Test', '--wait', '10', '--result-format', 'json', '--output-dir', out])
  assert.ok(argv.includes('--result-format') && argv[argv.indexOf('--result-format') + 1] === 'json')
  assert.ok(argv.includes('--output-dir') && argv[argv.indexOf('--output-dir') + 1] === out)
  // planTestResults: XOR use-most-recent/job-id, --output-dir supported
  assert.deepEqual(planTestResults({ useMostRecent: true, outputDir: out }), ['agent', 'test', 'results', '--use-most-recent', '--result-format', 'json', '--output-dir', out])
})

check('N5 validation: bad --batch-size / --test-runner / missing required flags throw', () => {
  assert.throws(() => planRunEval({ spec: 'specs/A.yaml', batchSize: 6 }), /--batch-size/)   // > 5
  assert.throws(() => planRunEval({ spec: 'specs/A.yaml', batchSize: 2.5 }), /--batch-size/)  // non-integer
  assert.throws(() => planRunEval({ spec: 'specs/A.yaml', batchSize: 'abc' }), /--batch-size/) // non-numeric
  assert.throws(() => planRunEval({}), /--spec/)
  assert.throws(() => planGenerateTestSpec({ testRunner: 'bogus' }), /--test-runner/)
  assert.throws(() => planTestCreate({ spec: 'specs/A.yaml', apiName: 'A', testRunner: 'nope' }), /--test-runner/)
  assert.throws(() => planTestRun({ apiName: 'A_Test', outputDir: '/tmp/x' }), /--wait/)      // missing wait
  assert.throws(() => planTestRun({ apiName: 'A_Test', wait: 2.5, outputDir: '/tmp/x' }), /--wait/) // non-integer wait
  assert.throws(() => planTestRun({ apiName: 'A_Test', wait: 5 }), /--output-dir/)             // missing outputDir
  assert.throws(() => planTestResults({}), /--use-most-recent or --job-id/)
})

check('N6 determinism: same input ⇒ identical argv run-to-run', () => {
  const a = planRunEval({ spec: 'specs/A.yaml', apiName: 'X', batchSize: 3 })
  const b = planRunEval({ spec: 'specs/A.yaml', apiName: 'X', batchSize: 3 })
  assert.deepEqual(a, b)
  assert.deepEqual(planTestRun({ apiName: 'A', wait: 7, outputDir: '/d' }), planTestRun({ apiName: 'A', wait: 7, outputDir: '/d' }))
})

check('N7 routing-FAIL is NOT credited as a passing utterance', () => {
  const records = parseAgentTestResult(RESULT_FIXTURE)
  assert.equal(records.length, 2)
  assert.equal(records[0].status, 'pass')
  assert.equal(records[1].status, 'fail', 'the topic-FAILURE (misroute) utterance must be fail')
  const passing = passingUtterances(records)
  assert.equal(passing.length, 1, 'ONLY the passing utterance is credited')
  assert.equal(passing[0].testCaseName, 'read-happy-path')
  assert.ok(!passing.some((r) => r.testCaseName === 'authz-boundary-misroute'), 'the routing-FAIL utterance is never in the passing set')
})

check('N8 parseAgentTestResult extracts topic + actions + score + duration', () => {
  const [ok, bad] = parseAgentTestResult(RESULT_FIXTURE)
  assert.equal(ok.expectedTopic, 'PipelineInspection')
  assert.equal(ok.actualTopic, 'PipelineInspection')
  assert.deepEqual(ok.expectedActions, ['ListOpportunities'])
  assert.deepEqual(ok.actualActions, ['ListOpportunities'])
  assert.equal(ok.durationMs, 3000)
  assert.equal(ok.score, Number(((1 + 1 + 0.95) / 3).toFixed(4)))
  assert.equal(bad.expectedTopic, 'AccessDenied')
  assert.equal(bad.actualTopic, 'PipelineInspection')
  assert.equal(bad.durationMs, 3500)
  // a case with ZERO expectations is fail-closed (cannot confirm routing)
  assert.equal(parseAgentTestResult({ testCases: [{ testCaseName: 'empty', testResults: [] }] })[0].status, 'fail')
})

check('N9 foldToEvidenceInput FAIL-CLOSED: absent result ⇒ pending, never scans', () => {
  const d = box()
  const specPath = join(d, 'specs', 'A-testSpec.yaml')
  mkdirSync(join(d, 'specs'), { recursive: true })
  writeFileSync(specPath, 'subjectName: A\ntestCases: []\n')
  const records = parseAgentTestResult(RESULT_FIXTURE)
  const frag = foldToEvidenceInput(records, { specPath, resultPath: join(d, 'nope-does-not-exist.json') })
  assert.ok(!frag.scans, 'an absent result must NEVER produce a scans fragment (no fabricated pass)')
  assert.ok(Array.isArray(frag.pending) && frag.pending.length === 1)
  assert.equal(frag.pending[0].req, EVIDENCE_REQ)
  assert.equal(frag.pending[0].loc, specPath)
})

check('N10 foldToEvidenceInput: on-disk result under evidence/ ⇒ scans fragment (repo-relative file)', () => {
  const d = box()
  const rel = join('.security-review', 'evidence', 'utterance-validation', 'A-run-eval.json')
  mkdirSync(join(d, '.security-review', 'evidence', 'utterance-validation'), { recursive: true })
  writeFileSync(join(d, rel), JSON.stringify(RESULT_FIXTURE))
  const records = parseAgentTestResult(RESULT_FIXTURE)
  const frag = foldToEvidenceInput(records, { specPath: 'specs/A-testSpec.yaml', resultPath: rel, repo: d })
  assert.ok(!frag.pending, 'a present result must NOT produce a pending fragment')
  assert.ok(Array.isArray(frag.scans) && frag.scans.length === 1)
  assert.equal(frag.scans[0].file, rel, 'the scans file stays the repo-relative .security-review/evidence path')
  assert.deepEqual(frag.scans[0].reqs, [EVIDENCE_REQ])
  assert.match(frag.scans[0].note, /1\/2 utterances passed/)
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

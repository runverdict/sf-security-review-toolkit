#!/usr/bin/env node
/*
 * normalize-agent-test.mjs — the DETERMINISTIC argv-builder + JSON→evidence
 * normalizer for the headless `sf agent test` utterance-validation flow that
 * prepare-test-environment step 9 prescribes. It replaces the old Agent Testing
 * Center / Agent Preview UI punt with a machine-readable pass/fail evidence path.
 *
 * SHAPE: this mirrors the `render-*.mjs` family — a PURE transform (deterministic
 * planners + a JSON→record parser, no I/O) plus a THIN impure spawn routed through
 * `sf-env.mjs`. It is emphatically NOT a `standup-org`-style live-op engine: no
 * consent gate, no name-guarded irreversible create/delete, no NAMES-only
 * manifest. It follows `standup-org.mjs`'s planner/executor SPLIT SHAPE only — the
 * pure functions are exported so the hermetic standing test drives them directly,
 * and the single impure executor is a utility the OWNER invokes, never spawned
 * from an autonomous orchestrator path.
 *
 * WHY: `agent test run` / `run-eval` produce per-test-case pass/fail, expected-vs-
 * actual topic, expected-vs-actual actions, evaluator scores, and duration — the
 * routing/authz evidence step 9 needs. The "submitted list contains ONLY
 * utterances that demonstrably produced successful tool calls" invariant is
 * enforced here as CODE (parseAgentTestResult marks a routing-FAIL case fail;
 * passingUtterances returns only status:'pass'), not just runbook prose.
 *
 * LIVE-LEG BOUNDARY: `agent test create` / `run` / `run-eval` require a real
 * ACTIVATED + PUBLISHED agent in the owner's review org (and, for run-eval, the
 * Einstein Eval API). Those legs stay OWNER-EXECUTED + cold-run-deferred, exactly
 * as `standup-org` keeps `sf org create scratch` operator-cold. The buildable-now
 * hermetic surface is the pure argv-builder + the JSON→evidence normalizer.
 *
 * HONEST GAP (do NOT silently paper over): hooks/sf-ops-gate-hook.mjs::classifySfVerb
 * does NOT classify `agent test create` or `agent test run` — `agent test create`
 * DEPLOYS an AiEvaluationDefinition (metadata mutation) but is not `project
 * deploy`, so it evades the deploy classifier and returns null (UNGATED). This is
 * acceptable WHILE the leg stays owner-run + interactive: the review org is a
 * persistent owner org, not a disposable `sf-deep-audit-ops` org, so folding it
 * into that gate is a semantic stretch. IF this ever runs non-interactively from
 * an autonomous path it would mutate the review org ungated → it would need a new
 * classifier arm first. This slice does NOT touch the hook. (Mirrored in
 * docs/roadmap-coldrun-hardening.md.)
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { sfEnv, parseSfJson } from './sf-env.mjs'

export const EVIDENCE_REQ = 'testenv-agent-testing-center'
export const EVIDENCE_SRC = 'prepare-test-environment:agent-test'
const TEST_RUNNERS = new Set(['testing-center', 'agentforce-studio'])
const RESULT_FORMATS = new Set(['json', 'junit'])
const MAX_BATCH_SIZE = 5

function assertTestRunner(v) {
  if (!TEST_RUNNERS.has(v)) {
    throw new Error(`normalize-agent-test: invalid --test-runner '${v}' (expected one of ${[...TEST_RUNNERS].join(', ')})`)
  }
}
function assertResultFormat(v) {
  if (!RESULT_FORMATS.has(v)) {
    throw new Error(`normalize-agent-test: invalid --result-format '${v}' (expected one of ${[...RESULT_FORMATS].join(', ')})`)
  }
}
function assertPositiveInt(v, label) {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1) throw new Error(`normalize-agent-test: invalid ${label} '${v}' (expected a positive integer)`)
  return n
}

/* ---- PURE planners (deterministic, no I/O) -------------------------------- */

/**
 * PURE. `sf agent generate test-spec` — INTERACTIVE, reads the DX-project metadata
 * (NOT the live tools/list), writes the YAML the later commands consume. Emits a
 * flag ONLY when its arg is provided; validates the runner enum.
 */
export function planGenerateTestSpec({ outputFile, testRunner, fromDefinition, forceOverwrite } = {}) {
  const argv = ['agent', 'generate', 'test-spec']
  if (outputFile) argv.push('--output-file', String(outputFile))
  if (testRunner != null && testRunner !== '') { assertTestRunner(testRunner); argv.push('--test-runner', testRunner) }
  if (fromDefinition) argv.push('--from-definition', String(fromDefinition))
  if (forceOverwrite) argv.push('--force-overwrite')
  return argv
}

/**
 * PURE. `sf agent test run-eval` — PRIMARY, residue-free (spec-direct via the
 * Einstein Eval API); prints results to STDOUT. NEVER emits `--output-dir` — that
 * flag does not exist on run-eval; the owner captures stdout by redirect. Agent is
 * inferred from the spec's subjectName; `--api-name` overrides. `--batch-size` is
 * validated <= 5.
 */
export function planRunEval({ spec, apiName, resultFormat = 'json', batchSize, noNormalize } = {}) {
  if (!spec) throw new Error('normalize-agent-test: planRunEval requires a --spec path')
  assertResultFormat(resultFormat)
  const argv = ['agent', 'test', 'run-eval', '--spec', String(spec), '--result-format', resultFormat]
  if (apiName) argv.push('--api-name', String(apiName))
  if (batchSize != null && batchSize !== '') {
    const n = Number(batchSize)
    if (!Number.isInteger(n) || n < 1 || n > MAX_BATCH_SIZE) {
      throw new Error(`normalize-agent-test: invalid --batch-size '${batchSize}' (expected an integer 1..${MAX_BATCH_SIZE})`)
    }
    argv.push('--batch-size', String(n))
  }
  if (noNormalize) argv.push('--no-normalize')
  return argv
}

/**
 * PURE. `sf agent test create` — DURABLE ARTIFACT: DEPLOYS an AiEvaluationDefinition
 * (a metadata mutation) into the review org. Requires spec + apiName. `--api-name`
 * must NOT already exist in the org; `--preview` builds without deploying;
 * `--force-overwrite` replaces.
 */
export function planTestCreate({ spec, apiName, testRunner, preview, forceOverwrite } = {}) {
  if (!spec) throw new Error('normalize-agent-test: planTestCreate requires a --spec path')
  if (!apiName) throw new Error('normalize-agent-test: planTestCreate requires an --api-name')
  const argv = ['agent', 'test', 'create', '--spec', String(spec), '--api-name', String(apiName)]
  if (testRunner != null && testRunner !== '') { assertTestRunner(testRunner); argv.push('--test-runner', testRunner) }
  if (preview) argv.push('--preview')
  if (forceOverwrite) argv.push('--force-overwrite')
  return argv
}

/**
 * PURE. `sf agent test run` — runs a deployed AiEvaluationDefinition; `--wait`
 * blocks for the run and `--output-dir` writes the JSON results to disk (this
 * command DOES take `--output-dir`, unlike run-eval). Requires apiName, an integer
 * wait, and outputDir.
 */
export function planTestRun({ apiName, wait, resultFormat = 'json', outputDir } = {}) {
  if (!apiName) throw new Error('normalize-agent-test: planTestRun requires an --api-name')
  const w = assertPositiveInt(wait, '--wait')
  if (!outputDir) throw new Error('normalize-agent-test: planTestRun requires an --output-dir')
  assertResultFormat(resultFormat)
  return ['agent', 'test', 'run', '--api-name', String(apiName), '--wait', String(w), '--result-format', resultFormat, '--output-dir', String(outputDir)]
}

/**
 * PURE. `sf agent test results` — re-fetch a completed run's JSON (owner re-runs
 * later). Exactly one of `useMostRecent` / `jobId` is required. `--output-dir`
 * writes the JSON to disk.
 */
export function planTestResults({ useMostRecent, jobId, resultFormat = 'json', outputDir } = {}) {
  if (!useMostRecent && !jobId) throw new Error('normalize-agent-test: planTestResults requires --use-most-recent or --job-id')
  if (useMostRecent && jobId) throw new Error('normalize-agent-test: planTestResults takes --use-most-recent XOR --job-id, not both')
  assertResultFormat(resultFormat)
  const argv = ['agent', 'test', 'results']
  if (useMostRecent) argv.push('--use-most-recent')
  else argv.push('--job-id', String(jobId))
  argv.push('--result-format', resultFormat)
  if (outputDir) argv.push('--output-dir', String(outputDir))
  return argv
}

/* ---- PURE parser: JSON result → canonical per-utterance records ----------- */

// Coerce an expected/actual action value (array, JSON-array string, delimited
// string, or scalar) into a canonical string[].
function coerceActions(v) {
  if (v == null) return []
  if (Array.isArray(v)) return v.map((x) => String(x))
  const s = String(v).trim()
  if (!s) return []
  if (s.startsWith('[')) {
    try { const j = JSON.parse(s); if (Array.isArray(j)) return j.map((x) => String(x)) } catch { /* fall through */ }
  }
  if (/[;,]/.test(s)) return s.split(/[;,]/).map((x) => x.trim()).filter(Boolean)
  return [s]
}

// The eval framework names its expectation results; match on a substring so
// version drift in the exact name (topic_sequence_match / topic_assertion / …)
// does not silently drop the routing signal.
const isTopicExp = (name) => /topic/i.test(String(name || ''))
const isActionExp = (name) => /action/i.test(String(name || ''))
const isPass = (r) => /^pass/i.test(String(r ?? ''))

function asCases(json) {
  if (Array.isArray(json)) return json
  if (json && Array.isArray(json.testCases)) return json.testCases
  if (json && json.result && Array.isArray(json.result.testCases)) return json.result.testCases
  if (json && Array.isArray(json.tests)) return json.tests
  return []
}

function durationOf(c) {
  if (Number.isFinite(Number(c.durationMs))) return Number(c.durationMs)
  if (Number.isFinite(Number(c.testDuration))) return Number(c.testDuration)
  const start = Date.parse(c.startTime), end = Date.parse(c.endTime)
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) return end - start
  return null
}

/**
 * PURE. Parse a `sf agent test run` / `run-eval` result object into a canonical
 * array of per-utterance records. A record whose case errored OR any of whose
 * expectation results did NOT pass is `status:'fail'` — the routing-FAIL case is
 * NEVER credited as a passing utterance (the "submitted list contains ONLY
 * successful utterances" invariant, enforced in code). Fail-closed on a case with
 * zero expectation results (cannot confirm routing → fail).
 */
export function parseAgentTestResult(json) {
  const cases = asCases(json)
  return cases.map((c) => {
    const exps = Array.isArray(c.testResults) ? c.testResults
      : Array.isArray(c.expectationResults) ? c.expectationResults
      : Array.isArray(c.results) ? c.results : []
    let expectedTopic = null, actualTopic = null, expectedActions = [], actualActions = []
    const scores = []
    for (const e of exps) {
      if (isTopicExp(e.name)) { expectedTopic = e.expectedValue ?? expectedTopic; actualTopic = e.actualValue ?? actualTopic }
      if (isActionExp(e.name)) { expectedActions = coerceActions(e.expectedValue); actualActions = coerceActions(e.actualValue) }
      if (Number.isFinite(Number(e.score))) scores.push(Number(e.score))
    }
    const caseErrored = /^(error|fail)/i.test(String(c.status || ''))
    const allExpPass = exps.length > 0 && exps.every((e) => isPass(e.result ?? e.status))
    const status = (!caseErrored && allExpPass) ? 'pass' : 'fail'
    const score = scores.length ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(4)) : null
    return {
      testCaseName: c.testCaseName ?? c.testName ?? c.name ?? (c.testNumber != null ? `test-${c.testNumber}` : null),
      utterance: c.utterance ?? (c.inputs && c.inputs.utterance) ?? c.input ?? null,
      expectedTopic: expectedTopic ?? null,
      actualTopic: actualTopic ?? null,
      expectedActions,
      actualActions,
      status,
      score,
      durationMs: durationOf(c),
    }
  })
}

/** PURE. Only the records that demonstrably passed routing/expectations. */
export function passingUtterances(records) {
  return (Array.isArray(records) ? records : []).filter((r) => r && r.status === 'pass')
}

/**
 * Fold the parsed records into the fragment the driver merges into
 * `evidence-input.json` for build-evidence-index.mjs. FAIL-CLOSED: the on-disk
 * result JSON is the ONLY thing that produces a `scans` (reviewer-reproducible)
 * fragment; absent/empty result ⇒ a `pending` fragment (owner hasn't run the live
 * leg) — it NEVER fabricates a pass. Does a read-only existence/emptiness check on
 * `resultPath` (resolved under `repo` when given); every emitted path is passed
 * through verbatim so the `scans.file` stays the repo-relative
 * `.security-review/evidence/...` path build-evidence-index credits.
 */
export function foldToEvidenceInput(records, { specPath, resultPath, repo } = {}) {
  const recs = Array.isArray(records) ? records : []
  const resolved = resultPath ? (repo ? join(repo, resultPath) : resultPath) : null
  let hasResult = false
  if (resolved && existsSync(resolved)) {
    try { hasResult = readFileSync(resolved, 'utf8').trim().length > 0 } catch { hasResult = false }
  }
  if (hasResult) {
    const passing = passingUtterances(recs)
    return {
      scans: [{
        reqs: [EVIDENCE_REQ],
        file: resultPath,
        src: EVIDENCE_SRC,
        note: `${passing.length}/${recs.length} utterances passed routing (sf agent test)`,
      }],
    }
  }
  return {
    pending: [{
      req: EVIDENCE_REQ,
      loc: specPath || null,
      src: EVIDENCE_SRC,
      note: 'test-spec authored; owner runs the live sf agent test against a published agent (Einstein Eval API for run-eval)',
    }],
  }
}

/* ---- THIN impure executor (spawn through sf-env.mjs) ---------------------- */

/**
 * IMPURE. Run one `sf agent …` argv (from a planner above) through `sfEnv()` so
 * the auto-update banner never corrupts a `--json` read. Returns { stdout, result }
 * where `result` is the banner-tolerant JSON parse of stdout (run-eval prints its
 * JSON to stdout) or null (an `agent test run --output-dir` invocation writes the
 * JSON to a FILE and prints a human-readable table — read the file, not stdout).
 * OWNER-invoked utility; NOT wired into an autonomous orchestrator path — the live
 * create/run/run-eval legs stay interactive + cold-run-deferred (see the module
 * header's HONEST GAP on classifySfVerb).
 */
export function runAgentTest(argv, { env } = {}) {
  const stdout = execFileSync('sf', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: sfEnv(env) })
  let result = null
  try { result = parseSfJson(stdout) } catch { /* file-output / table stdout — not JSON */ }
  return { stdout, result }
}

/* ---- CLI: PLAN-ONLY reference printer (no live op, no `sf` spawn) --------- */

function main() {
  const argv = process.argv
  const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
  const spec = arg('--spec', 'specs/<AGENT>-testSpec.yaml')
  const apiName = arg('--api-name', '<DeveloperName>')
  const outputDir = arg('--output-dir', '.security-review/evidence/utterance-validation/')
  const lines = [
    '## normalize-agent-test — planned `sf agent test` argv (PLAN ONLY — no live op)',
    'These legs run OWNER-INTERACTIVE against a published agent in the review org (cold-run-deferred).',
    '',
    'generate: sf ' + planGenerateTestSpec({ outputFile: spec, testRunner: 'testing-center' }).join(' '),
    'run-eval: sf ' + planRunEval({ spec }).join(' ') + '   > ' + join(outputDir, '<AGENT>-run-eval.json'),
    '  create: sf ' + planTestCreate({ spec, apiName }).join(' '),
    '     run: sf ' + planTestRun({ apiName, wait: 10, outputDir }).join(' '),
  ]
  process.stdout.write(lines.join('\n') + '\n')
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) }
  catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

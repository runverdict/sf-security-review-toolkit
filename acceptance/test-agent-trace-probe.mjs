#!/usr/bin/env node
/**
 * Standing test for harness/agent-trace-probe.mjs — the consented, scripted agent
 * conversation + execution-trace evidence (the deployed-package runtime lens). Hermetic:
 * the LIVE `agent preview`/`agent trace` conversation against a real ACTIVATED agent is
 * operator-cold-validated (like standup-org's `sf org create scratch`), NOT CI-hermetic.
 * These tests pin the PURE planner (deterministic argv sequence + mode contract), the
 * consent fail-closed, the dry-run purity, the redaction, the sessionId threading +
 * finally cleanup, the names-only manifest, and the empty-actions honesty — which are
 * what regress silently.
 *
 *   A1  planAgentTraceProbe: deterministic argv SEQUENCE (start → send×N → 3 trace
 *       reads → trace list → end), byte-identical on re-run
 *   A2  mode contract: authoring start carries --use-live-actions (never --simulate-
 *       actions); published start carries NEITHER; a simulate request THROWS; selector
 *       XOR + non-empty utterances enforced
 *   A3  consent fail-closed: the executor throws before ANY spawn; the CLI with no
 *       recorded sf-deep-audit-ops token prints NOT STARTED (exit 3) + writes no manifest
 *   A4  --dry-run purity: the `planned` manifest is written, NO sf spawn, NO evidence
 *   A5  NAMES/metadata-only evidence: the manifest keys are the strict allowlist and the
 *       serialized output carries none of the banned secret-shaped fields
 *   A6  redaction: a secret-shaped KEY or VALUE → ***redacted***, non-secret preserved,
 *       AND the written evidence is redacted (raw secret never persisted)
 *   A7  executor sequencing (STUBBED `sf` on PATH): the start sessionId is threaded into
 *       every send/trace/end argv; a mid-sequence send throw STILL ends the session in
 *       the finally block (fail-closed cleanup)
 *   A8  empty-actions honesty: an empty `trace read` dimension is "no observed actions",
 *       NEVER clean/ADDRESSED
 *
 * Dependency-free: `node acceptance/test-agent-trace-probe.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  planAgentTraceProbe, agentTraceProbe, redactSecrets, interpretTraceRead,
  AGENT_TRACE_SCHEMA, SESSION_ID_PLACEHOLDER, MANIFEST_KEYS_PUBLISHED, BANNED_FIELDS,
} from '../harness/agent-trace-probe.mjs'
import { recordConsent } from '../harness/record-consent.mjs'

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`) } }
const box = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'srt-atrace-'))); dirs.push(d); return d }

const ENGINE = fileURLToPath(new URL('../harness/agent-trace-probe.mjs', import.meta.url))
const PID = process.pid // per-checkout-unique fixture ids — parallel checkouts never collide

// A stubbed `sf` (a node script on PATH) that logs every invocation to SF_STUB_LOG and
// returns canned agent-preview / trace JSON. Behaviour toggled by env: FAIL_ON_SEND (the
// Nth send exits non-zero), INJECT_SECRET (an action input apiKey value), EMPTY_ACTIONS
// (the actions dimension returns the CLI's empty-dimension shape).
const SF_STUB = `#!/usr/bin/env node
const fs = require('fs')
const args = process.argv.slice(2)
const log = process.env.SF_STUB_LOG
try { if (log) fs.appendFileSync(log, args.join(' ') + '\\n') } catch {}
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null }
const emit = (o) => { process.stdout.write(JSON.stringify(o)); process.exit(0) }
if (args[0] === 'agent' && args[1] === 'preview' && args[2] === 'start') emit({ status: 0, result: { sessionId: 'SES123' } })
if (args[0] === 'agent' && args[1] === 'preview' && args[2] === 'send') {
  const cf = (log || '') + '.sendcount'
  let n = 0; try { n = parseInt(fs.readFileSync(cf, 'utf8'), 10) || 0 } catch {}
  n += 1; try { fs.writeFileSync(cf, String(n)) } catch {}
  if (process.env.FAIL_ON_SEND && String(n) === String(process.env.FAIL_ON_SEND)) { process.stderr.write('stub: send failed'); process.exit(1) }
  emit({ status: 0, result: { replies: [{ message: 'ok' }] } })
}
if (args[0] === 'agent' && args[1] === 'trace' && args[2] === 'read') {
  const dim = val('--dimension')
  if (dim === 'actions') {
    if (process.env.EMPTY_ACTIONS) emit({ status: 0, result: { emptyDimension: true } })
    emit({ status: 0, result: { actions: [{ action: 'CallExternalApi', input: { apiKey: process.env.INJECT_SECRET || 'nokey', host: 'api.example.com' }, output: { statusCode: 200 }, latencyMs: 42 }] } })
  }
  if (dim === 'errors') emit({ status: 0, result: { errors: [] } })
  if (dim === 'routing') emit({ status: 0, result: { routing: [{ fromTopic: 'Start', toTopic: 'Billing' }] } })
  emit({ status: 0, result: {} })
}
if (args[0] === 'agent' && args[1] === 'trace' && args[2] === 'list') emit({ status: 0, result: [{ sessionId: 'SES123', path: '/tmp/traces/SES123.json' }] })
if (args[0] === 'agent' && args[1] === 'preview' && args[2] === 'end') emit({ status: 0, result: { ended: true } })
emit({ status: 0, result: {} })
`
const writeSfStub = () => {
  const d = join(box(), 'bin')
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'sf'), SF_STUB)
  chmodSync(join(d, 'sf'), 0o755)
  return d
}

const spawnEngine = (args, env = {}) => {
  try { return { status: 0, out: execFileSync('node', [ENGINE, ...args], { encoding: 'utf8', env: { ...process.env, ...env } }) } }
  catch (e) { return { status: e.status, out: String(e.stdout || '') } }
}

console.log('agent-trace-probe standing test')

check('A1 planAgentTraceProbe: deterministic argv SEQUENCE (start → send×N → 3 reads → list → end), byte-identical on re-run', () => {
  const args = {
    runId: 'a1', apiName: 'My_Agent', orgAlias: 'sf-srt-org-a1',
    utterances: ['What can you do?', 'List cases'],
    target: '/repo', tmpRoot: join(tmpdir(), 'sf-srt-agent-trace', 'a1'), date: '2026-07-07',
  }
  const p = planAgentTraceProbe(args)
  assert.equal(p.schema, AGENT_TRACE_SCHEMA)
  assert.deepEqual(p.argv, [
    ['agent', 'preview', 'start', '--api-name', 'My_Agent', '--target-org', 'sf-srt-org-a1', '--json'],
    ['agent', 'preview', 'send', '--utterance', 'What can you do?', '--api-name', 'My_Agent', '--session-id', SESSION_ID_PLACEHOLDER, '--json'],
    ['agent', 'preview', 'send', '--utterance', 'List cases', '--api-name', 'My_Agent', '--session-id', SESSION_ID_PLACEHOLDER, '--json'],
    ['agent', 'trace', 'read', '--session-id', SESSION_ID_PLACEHOLDER, '--format', 'detail', '--dimension', 'actions', '--json'],
    ['agent', 'trace', 'read', '--session-id', SESSION_ID_PLACEHOLDER, '--format', 'detail', '--dimension', 'errors', '--json'],
    ['agent', 'trace', 'read', '--session-id', SESSION_ID_PLACEHOLDER, '--format', 'detail', '--dimension', 'routing', '--json'],
    ['agent', 'trace', 'list', '--session-id', SESSION_ID_PLACEHOLDER, '--json'],
    ['agent', 'preview', 'end', '--session-id', SESSION_ID_PLACEHOLDER, '--api-name', 'My_Agent', '--json'],
  ])
  assert.equal(p.manifestPath, join(tmpdir(), 'sf-srt-agent-trace', 'a1', 'agent-trace-manifest.json'))
  assert.equal(p.pointerRel, join('.security-review', 'agent-trace.json'))
  // byte-identical on re-run (deterministic given inputs)
  assert.deepEqual(p, planAgentTraceProbe(args))
})

check('A2 mode contract: authoring→--use-live-actions (never simulate); published→neither; simulate THROWS; selector XOR + non-empty utterances', () => {
  const common = { runId: 'a2', orgAlias: 'sf-srt-org-a2', utterances: ['hi'], target: '/r', tmpRoot: join(tmpdir(), 'sf-srt-agent-trace', 'a2'), date: 'd' }
  const pubStart = planAgentTraceProbe({ ...common, apiName: 'Pub' }).steps.find((s) => s.kind === 'start').argv
  assert.ok(!pubStart.includes('--use-live-actions'), 'published carries no mode flag')
  assert.ok(!pubStart.includes('--simulate-actions'))
  const authStart = planAgentTraceProbe({ ...common, authoringBundle: 'Bundle' }).steps.find((s) => s.kind === 'start').argv
  assert.ok(authStart.includes('--use-live-actions'), 'authoring is the egress-surfacing live mode')
  assert.ok(!authStart.includes('--simulate-actions'))
  // a simulate request for an egress-evidence run is REFUSED (simulate does not prove egress)
  assert.throws(() => planAgentTraceProbe({ ...common, authoringBundle: 'Bundle', mode: 'simulate' }), /simulate/i)
  assert.throws(() => planAgentTraceProbe({ ...common, apiName: 'Pub', mode: 'simulate-actions' }), /simulate/i)
  // exactly one selector; a non-empty utterance list
  assert.throws(() => planAgentTraceProbe({ ...common, apiName: 'Pub', authoringBundle: 'Bundle' }), /not both/i)
  assert.throws(() => planAgentTraceProbe({ ...common }), /one of|required/i)
  assert.throws(() => planAgentTraceProbe({ ...common, apiName: 'Pub', utterances: [] }), /non-empty/i)
  assert.throws(() => planAgentTraceProbe({ ...common, apiName: 'Pub', orgAlias: '' }), /orgAlias is required/i)
})

check('A3 consent fail-closed: executor throws before any spawn; CLI prints NOT STARTED (exit 3), no manifest', () => {
  const p = planAgentTraceProbe({ runId: 'a3', apiName: 'My_Agent', orgAlias: 'sf-srt-org-a3', utterances: ['hi'], target: box(), tmpRoot: join(tmpdir(), 'sf-srt-agent-trace', 'a3'), date: '2026-07-07' })
  assert.throws(() => agentTraceProbe(p, { consent: false }), /without explicit consent/)
  assert.throws(() => agentTraceProbe(p), /without explicit consent/)
  const repo = box() // a fresh --target with NO recorded sf-deep-audit-ops consent
  const uttFile = join(box(), 'u.txt'); writeFileSync(uttFile, 'What can you do?\n')
  const tmp = join(tmpdir(), 'sf-srt-agent-trace', `a3cli-${PID}`); rmSync(tmp, { recursive: true, force: true })
  try {
    const base = ['--api-name', 'My_Agent', '--org-alias', 'sf-srt-org-a3', '--utterances-file', uttFile, '--tmp-root', tmp, '--target', repo]
    const r1 = spawnEngine(base) // no --consent flag at all
    assert.equal(r1.status, 3)
    assert.match(r1.out, /NOT STARTED \(no consent\)/)
    const r2 = spawnEngine([...base, '--consent']) // --consent flag but nothing recorded
    assert.equal(r2.status, 3)
    assert.match(r2.out, /no affirmative consent is recorded for gate 'sf-deep-audit-ops'/)
    assert.ok(!existsSync(join(tmp, 'agent-trace-manifest.json')), 'the executor never ran — no manifest on either fail-closed path')
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

check('A4 --dry-run purity: the planned manifest is written, NO sf spawn, NO evidence files', () => {
  const repo = box()
  const uttFile = join(box(), 'u.txt'); writeFileSync(uttFile, 'What can you do?\nList cases\n')
  const tmp = join(tmpdir(), 'sf-srt-agent-trace', `a4-${PID}`); rmSync(tmp, { recursive: true, force: true })
  try {
    const r = spawnEngine(['--dry-run', '--api-name', 'My_Agent', '--org-alias', 'sf-srt-org-a4', '--utterances-file', uttFile, '--tmp-root', tmp, '--target', repo, '--json'])
    assert.equal(r.status, 0, r.out)
    const m = JSON.parse(r.out)
    assert.equal(m.status, 'planned')
    assert.equal(m.alias, 'sf-srt-org-a4')
    assert.ok(existsSync(join(tmp, 'agent-trace-manifest.json')), 'the planned manifest is written')
    // dry-run does a live-op NOTHING — no session, no trace evidence written
    const evDir = join(repo, '.security-review', 'evidence', 'deployed-package')
    assert.ok(!existsSync(join(evDir, `agent-trace-actions-${new Date().toISOString().slice(0, 10)}.json`)), 'dry-run writes no evidence')
    assert.ok(!existsSync(evDir), 'dry-run never even creates the evidence dir')
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

check('A5 NAMES/metadata-only evidence: manifest keys are the strict allowlist, no banned secret-shaped field', () => {
  const repo = box()
  const uttFile = join(box(), 'u.txt'); writeFileSync(uttFile, 'What can you do?\n')
  const tmp = join(tmpdir(), 'sf-srt-agent-trace', `a5-${PID}`); rmSync(tmp, { recursive: true, force: true })
  try {
    const r = spawnEngine(['--dry-run', '--api-name', 'My_Agent', '--org-alias', 'sf-srt-org-a5', '--utterances-file', uttFile, '--tmp-root', tmp, '--target', repo, '--json'])
    const m = JSON.parse(r.out)
    assert.deepEqual(Object.keys(m).sort(), [...MANIFEST_KEYS_PUBLISHED].sort())
    for (const banned of ['accessToken', 'authFields', 'sessionToken', 'refreshToken', 'bearer']) {
      assert.ok(!r.out.includes(banned), `no credential-shaped field '${banned}' in the manifest`)
    }
    // the module's banned-field set is the same one the O7-style scan guards against
    for (const b of ['accessToken', 'authFields', 'sessionToken', 'refreshToken', 'bearer']) assert.ok(BANNED_FIELDS.includes(b))
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

check('A6 redaction: secret-shaped KEY or VALUE → ***redacted***, non-secret preserved; written evidence redacted', () => {
  // (a) the PURE helper — key match, value-shape match, and preservation
  const red = redactSecrets({
    action: 'CallApi',
    input: { apiKey: 'sk-live-SECRETTOKENVALUE', host: 'api.x.com', note: 'hello' },
    output: { authorization: 'Bearer abc.def.ghijklmnop', ok: true, jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJ' },
  })
  assert.equal(red.input.apiKey, '***redacted***')            // KEY match
  assert.equal(red.input.host, 'api.x.com')                    // preserved
  assert.equal(red.input.note, 'hello')                        // preserved
  assert.equal(red.output.authorization, '***redacted***')     // KEY match
  assert.equal(red.output.jwt, '***redacted***')               // VALUE shape (JWT)
  assert.equal(red.output.ok, true)                            // preserved
  assert.ok(!JSON.stringify(red).includes('sk-live-SECRETTOKENVALUE'), 'raw secret never survives')
  // a long-hex VALUE under a NON-secret key is still redacted by shape
  assert.equal(redactSecrets({ blob: 'a'.repeat(40) }).blob, '***redacted***')
  // (b) end-to-end — the executor redacts before writing the actions evidence
  const repo = box()
  recordConsent('sf-deep-audit-ops', 'yes, proceed', { target: repo, question: 'standing-test fixture consent' })
  const stub = writeSfStub()
  const uttFile = join(box(), 'u.txt'); writeFileSync(uttFile, 'What can you do?\nList cases\n')
  const tmp = join(tmpdir(), 'sf-srt-agent-trace', `a6-${PID}`); rmSync(tmp, { recursive: true, force: true })
  const log = join(box(), 'calls.log'); rmSync(log, { force: true }); rmSync(log + '.sendcount', { force: true })
  const SECRET = 'abcdef0123456789abcdef0123456789abcdef01' // 40 hex — matches both key + value shape
  try {
    const r = spawnEngine(['--consent', '--api-name', 'My_Agent', '--org-alias', 'sf-srt-org-a6', '--utterances-file', uttFile, '--tmp-root', tmp, '--target', repo, '--json'],
      { PATH: `${stub}:${process.env.PATH}`, SF_STUB_LOG: log, INJECT_SECRET: SECRET })
    assert.equal(r.status, 0, r.out)
    const m = JSON.parse(r.out)
    const actionsEvidence = readFileSync(m.evidencePaths.actions, 'utf8')
    assert.ok(actionsEvidence.includes('***redacted***'), 'the secret-shaped action input is redacted')
    assert.ok(!actionsEvidence.includes(SECRET), 'the raw secret is NEVER written to evidence')
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

check('A7 executor sequencing (stubbed sf): start sessionId threaded into every send/trace/end; mid-send throw STILL ends the session in finally', () => {
  const repo = box()
  recordConsent('sf-deep-audit-ops', 'yes, proceed', { target: repo, question: 'standing-test fixture consent' })
  const stub = writeSfStub()
  const uttFile = join(box(), 'u.txt'); writeFileSync(uttFile, 'What can you do?\nList cases\n')
  const tmp = join(tmpdir(), 'sf-srt-agent-trace', `a7-${PID}`); rmSync(tmp, { recursive: true, force: true })
  const log = join(box(), 'calls.log')
  const runOnce = (extra) => {
    rmSync(log, { force: true }); rmSync(log + '.sendcount', { force: true })
    const r = spawnEngine(['--consent', '--api-name', 'My_Agent', '--org-alias', 'sf-srt-org-a7', '--utterances-file', uttFile, '--tmp-root', tmp, '--target', repo, '--json'],
      { PATH: `${stub}:${process.env.PATH}`, SF_STUB_LOG: log, ...extra })
    return { r, calls: readFileSync(log, 'utf8').trim().split('\n') }
  }
  try {
    // happy path — every send/trace/end argv threads the SES123 sessionId from `start`
    const { r, calls } = runOnce({})
    assert.equal(r.status, 0, r.out)
    const m = JSON.parse(r.out)
    assert.equal(m.status, 'completed')
    assert.equal(m.sessionId, 'SES123')
    assert.equal(m.turnCount, 2)
    const sends = calls.filter((c) => c.startsWith('agent preview send'))
    assert.equal(sends.length, 2)
    for (const c of sends) assert.match(c, /--session-id SES123/, 'send threads the start sessionId')
    const reads = calls.filter((c) => c.startsWith('agent trace read'))
    assert.equal(reads.length, 3)
    for (const c of reads) assert.match(c, /--session-id SES123/, 'trace read threads the sessionId')
    const ends = calls.filter((c) => c.startsWith('agent preview end'))
    assert.ok(ends.length >= 1 && ends.every((c) => /--session-id SES123/.test(c)), 'end threads the sessionId')
    // start never carries a session id (it produces one)
    assert.ok(!calls.find((c) => c.startsWith('agent preview start')).includes('--session-id'))

    // mid-sequence FAILURE — the 2nd send exits non-zero; the session is STILL ended in finally
    const { calls: calls2 } = runOnce({ FAIL_ON_SEND: '2' })
    assert.ok(calls2.some((c) => c.startsWith('agent preview end') && /--session-id SES123/.test(c)),
      'a crashed conversation never leaves a live preview session open — finally ended SES123')
    // trace reads never happened (the conversation broke before them)
    assert.ok(!calls2.some((c) => c.startsWith('agent trace read')), 'a broken conversation skips the trace reads')
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

check('A8 empty-actions honesty: an empty trace read is "no observed actions", NEVER clean/ADDRESSED', () => {
  // (a) the PURE helper
  const empty = interpretTraceRead({ status: 0, result: { emptyDimension: true } }, 'actions')
  assert.equal(empty.status, 'no observed actions')
  assert.equal(empty.observed, false)
  assert.ok(!/clean|addressed/i.test(empty.status), 'an empty dimension is never presented as a pass')
  const full = interpretTraceRead({ status: 0, result: { actions: [{ action: 'X' }] } }, 'actions')
  assert.equal(full.observed, true)
  // (b) end-to-end — the stub's actions dimension is empty; the actions evidence records it honestly
  const repo = box()
  recordConsent('sf-deep-audit-ops', 'yes, proceed', { target: repo, question: 'standing-test fixture consent' })
  const stub = writeSfStub()
  const uttFile = join(box(), 'u.txt'); writeFileSync(uttFile, 'What can you do?\n')
  const tmp = join(tmpdir(), 'sf-srt-agent-trace', `a8-${PID}`); rmSync(tmp, { recursive: true, force: true })
  const log = join(box(), 'calls.log'); rmSync(log, { force: true }); rmSync(log + '.sendcount', { force: true })
  try {
    const r = spawnEngine(['--consent', '--api-name', 'My_Agent', '--org-alias', 'sf-srt-org-a8', '--utterances-file', uttFile, '--tmp-root', tmp, '--target', repo, '--json'],
      { PATH: `${stub}:${process.env.PATH}`, SF_STUB_LOG: log, EMPTY_ACTIONS: '1' })
    assert.equal(r.status, 0, r.out)
    const m = JSON.parse(r.out)
    const actionsEvidence = JSON.parse(readFileSync(m.evidencePaths.actions, 'utf8'))
    assert.equal(actionsEvidence.status, 'no observed actions')
    assert.equal(actionsEvidence.observed, false)
    assert.ok(!/clean|addressed/i.test(actionsEvidence.status))
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

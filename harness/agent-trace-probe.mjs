#!/usr/bin/env node
/*
 * agent-trace-probe.mjs — consented, scripted conversation against the installed +
 * ACTIVATED Agentforce agent in the throwaway scratch org, capturing its execution
 * trace (`sf agent trace read … --dimension actions|errors|routing`) as reviewer
 * evidence answering "what can this agent actually DO / where does it egress." This
 * is the Agentforce-RUNTIME lens the Apex smoke test in install-and-verify
 * explicitly CANNOT reach: Apex egress ≠ Agentforce egress. The smoke test proves the
 * credential chain resolves; this probe proves what the agent does at runtime with
 * those credentials, for a scripted utterance list.
 *
 * SHAPE (mirrors standup-org.mjs exactly): a PURE planner `planAgentTraceProbe`
 * (deterministic spec, no I/O) + a FAIL-CLOSED impure executor `agentTraceProbe`
 * (the `sf` calls) + a load-bearing `verifyConsent('sf-deep-audit-ops')` guard +
 * NAMES/metadata-only evidence + a finally-block that ALWAYS ends the preview session.
 * `--dry-run` writes the `planned` manifest and performs NO live op.
 *
 * BOUNDARIES, ENCODED:
 *   • LOAD-BEARING CONSENT: `hooks/sf-ops-gate-hook.mjs::classifySfVerb` does NOT
 *     enumerate `agent preview` verbs — nothing else stops an ungated
 *     `agent preview send`. This engine's own `verifyConsent`-backed guard is the
 *     ONLY thing that fails a live conversation closed. It throws BEFORE any spawn.
 *   • NO NEW CONSENT / NO NEW GATE: rides the SAME recorded `sf-deep-audit-ops`
 *     token the rest of the deep audit uses (no `gate-spec.mjs` change).
 *   • EVIDENCE IS NAMES/METADATA ONLY: the manifest is assembled field-by-field from
 *     a STRICT allowlist — an `sf agent trace read` payload can carry action
 *     inputs/outputs with secret-shaped values, so every payload is run through
 *     `redactSecrets` BEFORE it is persisted; a raw secret is never written.
 *   • EMPTY IS HONEST: an empty `trace read` dimension is recorded as
 *     "no observed <dimension>", NEVER `clean`/`ADDRESSED` — it means "nothing
 *     observed for these utterances," not "safe."
 *
 * DEPENDENCY ORDER (the operator dispatches these first; the engine + tests are
 * hermetic and buildable NOW — the LIVE conversation leg needs, in order):
 *   1. `standup-org.mjs` — a throwaway scratch org must already exist.
 *   2. `install-and-verify-package` STEP 6 — the agent ACTIVATED + MCP tools
 *      registered via Manage Tools → Save. The agent must be activated for
 *      `--api-name` to resolve; if tools aren't registered the `actions` dimension is
 *      legitimately empty (handled honestly).
 *   3. A recorded `sf-deep-audit-ops` consent token (`record-consent.mjs`) — this
 *      engine's `verifyConsent` is the ONLY guard, because the fail-closed backstop
 *      hook (`sf-ops-gate-hook.mjs::classifySfVerb`) does NOT enumerate
 *      `agent preview` verbs.
 *   4. `prepare-test-environment`'s validated MCP utterance list — the scripted input.
 *   5. `sf-env.mjs` (`sfEnv` + `parseSfJson`) and the
 *      `.security-review/evidence/deployed-package/` + audit-ledger conventions.
 *
 * LIVE-LEG BOUNDARY (cold-run-validated only, NOT hermetically tested — deferred to
 * the midpoint cold run; none of this blocks the deterministic engine + the eight
 * hermetic tests):
 *   (1) the probe needs an ACTIVATED agent — if tools aren't registered the `actions`
 *       dimension is legitimately empty;
 *   (2) coverage is only as good as the scripted utterance list — the trace shows what
 *       the agent DID for those utterances, not the full reachable surface (dynamic
 *       evidence, still not Salesforce's live pen test);
 *   (3) `sf agent trace read` reads from the LOCAL DX project, so the executor must run
 *       with `cwd` inside the package DX project, and the authoring-bundle path needs
 *       the agent script in `aiAuthoringBundles/`.
 *
 * USAGE: node agent-trace-probe.mjs --consent [--api-name <Agent> | --authoring-bundle <Bundle>]
 *          --utterances-file <path> [--org-alias <alias>] [--run-id <id>]
 *          [--tmp-root <dir>] [--target <repo>] [--mode live] [--dry-run] [--json]
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { assertSafeTmpRoot } from './install-scanners.mjs'
import { verifyConsent } from './record-consent.mjs'
import { sfEnv, parseSfJson } from './sf-env.mjs'

export const AGENT_TRACE_SCHEMA = 'sf-srt-agent-trace/1'
// The planner emits this placeholder in every session-scoped argv; the executor
// substitutes the REAL sessionId (from `agent preview start`) at spawn time. Keeping
// it a placeholder is what lets the planner stay pure (it never knows the sessionId).
export const SESSION_ID_PLACEHOLDER = '@@SESSION_ID@@'
export const TRACE_DIMENSIONS = ['actions', 'errors', 'routing']
export const REDACTED = '***redacted***'
const RUN_ID_OK = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

// A secret-shaped KEY name (A6 contract). Any value under a key matching this is
// redacted regardless of the value's own shape.
export const SECRET_KEY_RE = /(token|secret|password|authorization|bearer|apikey|api_key|refresh|access[_-]?token|sessionid|session[_-]?token|credential|private[_-]?key)/i
// A secret-shaped VALUE: JWT / Bearer / sf access token (orgId!token) / long hex.
export const SECRET_VALUE_RE = new RegExp([
  'eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{4,}\\.[A-Za-z0-9_-]{4,}', // JWT
  'Bearer\\s+[A-Za-z0-9._~+/-]{8,}=*',                             // Bearer token
  '\\b00D[A-Za-z0-9]{12,18}![A-Za-z0-9._=+/-]{10,}',               // sf session/access token
  '\\b[A-Fa-f0-9]{32,}\\b',                                        // long hex (token/hash)
].join('|'))

// STRICT manifest allowlists — apiName XOR authoringBundle per path. NOTHING else may
// appear in the manifest: it is assembled field-by-field, never spread from `--json`.
export const MANIFEST_KEYS_PUBLISHED = ['runId', 'apiName', 'mode', 'sessionId', 'utterances', 'turnCount', 'alias', 'evidencePaths', 'status']
export const MANIFEST_KEYS_AUTHORING = ['runId', 'authoringBundle', 'mode', 'sessionId', 'utterances', 'turnCount', 'alias', 'evidencePaths', 'status']
// The banned secret-shaped field-name set the names-only manifest must NEVER contain.
export const BANNED_FIELDS = ['accessToken', 'authFields', 'sessionToken', 'refreshToken', 'bearer', 'password', 'sfdxAuthUrl', 'privateKey', 'clientSecret']

/**
 * PURE recursive redaction. Returns a NEW structure (never mutates the input):
 * a value whose KEY matches SECRET_KEY_RE → `***redacted***`; a string value whose
 * shape matches SECRET_VALUE_RE → `***redacted***`; everything else preserved. This is
 * the A6 contract — redact FIRST, then persist.
 */
export function redactSecrets(node) {
  if (Array.isArray(node)) return node.map(redactSecrets)
  if (node && typeof node === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(node)) {
      if (SECRET_KEY_RE.test(k)) { out[k] = REDACTED; continue }
      out[k] = redactSecrets(v)
    }
    return out
  }
  if (typeof node === 'string') return SECRET_VALUE_RE.test(node) ? REDACTED : node
  return node
}

/** Pull the preview sessionId from `agent preview start --json` output. */
export function extractSessionId(parsed) {
  const r = parsed && parsed.result
  return (r && (r.sessionId || r.sessionID || r.session_id)) || (parsed && parsed.sessionId) || null
}

function isEmptyTrace(parsed) {
  if (!parsed) return true
  const r = parsed.result
  if (r == null) return true
  if (typeof r === 'string') return /no\s+[\w'-]+\s+data|emptydimension|no traces/i.test(r)
  if (Array.isArray(r)) return r.length === 0
  if (typeof r === 'object') {
    if (r.emptyDimension === true || r.empty === true) return true
    for (const key of ['entries', 'actions', 'steps', 'errors', 'routing', 'turns', 'items']) {
      if (Array.isArray(r[key])) return r[key].length === 0
    }
    const msg = String(r.message || r.output || parsed.message || '')
    if (/no\s+[\w'-]+\s+data|emptydimension|no traces/i.test(msg)) return true
    return Object.keys(r).length === 0
  }
  return false
}

function extractTraceEntries(parsed) {
  const r = parsed && parsed.result
  if (Array.isArray(r)) return r
  if (r && typeof r === 'object') {
    for (const key of ['entries', 'actions', 'steps', 'errors', 'routing', 'turns', 'items']) {
      if (Array.isArray(r[key])) return r[key]
    }
    return [r]
  }
  return []
}

/**
 * PURE interpretation of a `trace read --dimension <dim>` payload (A8 contract). An
 * empty dimension is recorded as "no observed <dimension>" — the HONEST reading of an
 * empty trace ("nothing observed for these utterances"), NEVER `clean`/`ADDRESSED`.
 */
export function interpretTraceRead(parsed, dimension) {
  const empty = isEmptyTrace(parsed)
  const entries = empty ? [] : extractTraceEntries(parsed)
  const observed = !empty && entries.length > 0
  return {
    dimension,
    observed,
    status: observed ? `observed ${entries.length}` : `no observed ${dimension}`,
    entries,
  }
}

/**
 * PURE planner. Deterministic on inputs, no I/O (like planStandupOrg). Returns the
 * ordered argv SEQUENCE (multiple spawns), the evidence paths, the manifest path, the
 * pointer rel path, and a redaction spec. Throws on an invalid run-id, an unsafe tmp
 * root, a bad selector (both/neither api-name & authoring-bundle), a missing org alias,
 * a simulate mode (simulated actions do not prove egress), or empty utterances.
 */
export function planAgentTraceProbe({
  runId, apiName, authoringBundle, mode, utterances, orgAlias, target, tmpRoot, date,
} = {}) {
  if (!RUN_ID_OK.test(String(runId || ''))) throw new Error(`planAgentTraceProbe: invalid run-id '${runId}'`)
  assertSafeTmpRoot(tmpRoot)

  // exactly one agent selector — a published/activated agent XOR a local authoring bundle
  const hasApi = apiName != null && String(apiName) !== ''
  const hasBundle = authoringBundle != null && String(authoringBundle) !== ''
  if (hasApi && hasBundle) throw new Error('planAgentTraceProbe: pass exactly one of --api-name / --authoring-bundle, not both')
  if (!hasApi && !hasBundle) throw new Error('planAgentTraceProbe: one of --api-name (published/activated agent) or --authoring-bundle (local DX authoring bundle) is required')

  // the org alias `agent preview start --target-org` needs; from the standup-org pointer
  const alias = String(orgAlias || '')
  if (!alias) throw new Error('planAgentTraceProbe: orgAlias is required (the throwaway scratch org to preview against — from the standup-org pointer or --org-alias)')

  // MODE CONTRACT (A2): an egress-evidence run is ALWAYS live. Published agents always
  // use live actions (no mode flag). Authoring bundles MUST carry --use-live-actions.
  // --simulate-actions is REFUSED outright — simulated actions do not prove egress.
  const rawMode = mode == null || mode === '' ? 'live' : String(mode)
  if (/simulate/i.test(rawMode)) {
    throw new Error('planAgentTraceProbe: refusing --simulate-actions — simulated actions do not prove egress; an egress-evidence run must execute live actions')
  }
  if (rawMode !== 'live' && rawMode !== 'use-live-actions' && rawMode !== 'live-actions') {
    throw new Error(`planAgentTraceProbe: invalid mode '${mode}' (expected 'live'; simulate is refused for an egress-evidence run)`)
  }
  const canonMode = 'live'

  // the scripted utterance list (from prepare-test-environment's validated list)
  if (!Array.isArray(utterances) || utterances.length === 0) {
    throw new Error('planAgentTraceProbe: utterances must be a non-empty array (the validated scripted list from prepare-test-environment)')
  }
  const utter = utterances.map((u) => String(u))

  const stamp = date == null || date === '' ? 'undated' : String(date)

  // send + end BOTH require naming the agent (agent.preview.send.md / .end.md)
  const selector = hasApi ? ['--api-name', String(apiName)] : ['--authoring-bundle', String(authoringBundle)]

  // (1) start — published: no mode flag; authoring: --use-live-actions (the egress mode)
  const startArgv = hasApi
    ? ['agent', 'preview', 'start', '--api-name', String(apiName), '--target-org', alias, '--json']
    : ['agent', 'preview', 'start', '--authoring-bundle', String(authoringBundle), '--use-live-actions', '--target-org', alias, '--json']

  const steps = []
  steps.push({ kind: 'start', argv: startArgv })
  // (2) send — one per utterance, in order; sessionId threaded at EXECUTE time
  for (const u of utter) {
    steps.push({ kind: 'send', utterance: u, argv: ['agent', 'preview', 'send', '--utterance', u, ...selector, '--session-id', SESSION_ID_PLACEHOLDER, '--json'] })
  }
  // (3) trace read — three dimensions; `--format detail` REQUIRES `--dimension`
  for (const dim of TRACE_DIMENSIONS) {
    steps.push({ kind: 'trace-read', dimension: dim, argv: ['agent', 'trace', 'read', '--session-id', SESSION_ID_PLACEHOLDER, '--format', 'detail', '--dimension', dim, '--json'] })
  }
  // (4) trace list — locate the recorded trace file path for the session
  steps.push({ kind: 'trace-list', argv: ['agent', 'trace', 'list', '--session-id', SESSION_ID_PLACEHOLDER, '--json'] })
  // (5) end — runs in the executor's finally block (fail-closed cleanup)
  steps.push({ kind: 'end', argv: ['agent', 'preview', 'end', '--session-id', SESSION_ID_PLACEHOLDER, ...selector, '--json'] })

  const evidenceDir = join(String(target || ''), '.security-review', 'evidence', 'deployed-package')
  const evidencePaths = {
    actions: join(evidenceDir, `agent-trace-actions-${stamp}.json`),
    errors: join(evidenceDir, `agent-trace-errors-${stamp}.json`),
    routing: join(evidenceDir, `agent-trace-routing-${stamp}.json`),
  }

  return {
    schema: AGENT_TRACE_SCHEMA,
    runId,
    apiName: hasApi ? String(apiName) : null,
    authoringBundle: hasBundle ? String(authoringBundle) : null,
    mode: canonMode,
    orgAlias: alias,
    utterances: utter,
    date: stamp,
    tmpRoot,
    target: target || null,
    evidenceDir,
    evidencePaths,
    manifestPath: join(tmpRoot, 'agent-trace-manifest.json'),
    pointerRel: join('.security-review', 'agent-trace.json'),
    steps,
    // the ordered array of argv arrays (a sequence) — A1 pins this byte-for-byte
    argv: steps.map((s) => s.argv),
    redaction: {
      manifestKeys: hasApi ? MANIFEST_KEYS_PUBLISHED : MANIFEST_KEYS_AUTHORING,
      secretKeyPattern: SECRET_KEY_RE.source,
      secretValuePattern: SECRET_VALUE_RE.source,
      bannedFields: BANNED_FIELDS,
    },
  }
}

const run = (args) => execFileSync('sf', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: sfEnv() })
const subst = (argv, sessionId) => argv.map((a) => (a === SESSION_ID_PLACEHOLDER ? sessionId : a))

/**
 * Assemble the STRICT-allowlist manifest field-by-field from named values. NEVER spread
 * a raw `--json` payload into it (that payload can carry auth material). NAMES/metadata
 * only: the preview sessionId, the org alias, the utterance texts, the evidence paths.
 */
function buildManifest(plan, rec) {
  const m = { runId: plan.runId }
  if (plan.apiName) m.apiName = plan.apiName
  else m.authoringBundle = plan.authoringBundle
  m.mode = plan.mode
  m.sessionId = rec.sessionId || null
  m.utterances = plan.utterances
  m.turnCount = rec.turnCount || 0
  m.alias = plan.orgAlias
  m.evidencePaths = plan.evidencePaths
  m.status = rec.status
  return m
}

function writeManifest(plan, rec, target) {
  mkdirSync(plan.tmpRoot, { recursive: true, mode: 0o700 })
  const manifest = buildManifest(plan, rec)
  writeFileSync(plan.manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  if (target) {
    try {
      const dir = join(target, '.security-review'); mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'agent-trace.json'), JSON.stringify({
        schema: plan.schema, runId: plan.runId,
        apiName: plan.apiName, authoringBundle: plan.authoringBundle,
        sessionId: rec.sessionId || null, status: rec.status,
        evidencePaths: plan.evidencePaths,
      }, null, 2) + '\n')
    } catch { /* pointer is best-effort */ }
  }
  return manifest
}

/**
 * Write the three per-dimension evidence files (REDACTED before write) + the manifest +
 * the pointer. THE core "what can this agent do" evidence is the actions file.
 */
function writeTraceEvidence(plan, rec, target) {
  try { mkdirSync(plan.evidenceDir, { recursive: true }) } catch { /* best-effort */ }
  for (const dim of TRACE_DIMENSIONS) {
    const t = rec.traces[dim] || { dimension: dim, observed: false, status: `no observed ${dim}`, entries: [] }
    const body = {
      schema: plan.schema,
      dimension: dim,
      sessionId: rec.sessionId || null,
      alias: plan.orgAlias,
      observed: !!t.observed,
      status: t.status,
      // REDACT FIRST, then write — an action input/output can carry a secret-shaped value
      entries: redactSecrets(t.entries || []),
    }
    try { writeFileSync(plan.evidencePaths[dim], JSON.stringify(body, null, 2) + '\n') } catch { /* best-effort */ }
  }
  return writeManifest(plan, rec, target)
}

/**
 * IMPURE executor. Drives the scripted conversation and captures the trace. FAILS
 * CLOSED without consent — thrown before ANY `sf` spawn (the load-bearing guard: the
 * sf-ops-gate-hook does not classify `agent preview`). ALWAYS ends the preview session
 * in a `finally` block so a crashed conversation never leaves a live session open.
 * opts: { consent, target, orgAlias }
 */
export function agentTraceProbe(plan, { consent = false, target, orgAlias } = {}) {
  assertSafeTmpRoot(plan.tmpRoot)
  // LOAD-BEARING: `hooks/sf-ops-gate-hook.mjs::classifySfVerb` does NOT enumerate
  // `agent preview` verbs, so nothing else stops an ungated `agent preview send`.
  // This guard is the ONLY thing that fails a live agent conversation closed.
  if (consent !== true) {
    throw new Error('agent-trace-probe: refusing to drive a live agent conversation (agent preview start/send) without explicit consent — a live op under the sf-deep-audit-ops gate the sf-ops-gate-hook does not classify. Pass --consent with the recorded consent.')
  }

  const rec = { status: 'failed', sessionId: null, turnCount: 0, traces: {}, log: '' }
  mkdirSync(plan.tmpRoot, { recursive: true, mode: 0o700 })

  const selector = plan.apiName ? ['--api-name', plan.apiName] : ['--authoring-bundle', plan.authoringBundle]
  // fail-closed cleanup: end THIS session even on SIGINT/SIGTERM/fatal between spawns
  const cleanupEnd = () => {
    if (!rec.sessionId) return
    try { execFileSync('sf', ['agent', 'preview', 'end', '--session-id', rec.sessionId, ...selector, '--json'], { stdio: 'ignore', env: sfEnv() }) } catch {}
  }
  const handlers = {
    SIGINT: () => { cleanupEnd(); process.exit(130) },
    SIGTERM: () => { cleanupEnd(); process.exit(143) },
    uncaughtException: (e) => { cleanupEnd(); throw e },
  }
  let handlersInstalled = false

  try {
    // (1) start — extract the sessionId; degrade honestly if it fails or is missing
    const startStep = plan.steps.find((s) => s.kind === 'start')
    let startOut
    try { startOut = run(startStep.argv) }
    catch {
      rec.status = 'failed'; rec.log = 'agent preview start failed'
      return writeTraceEvidence(plan, rec, target) // no session → no sends, no end
    }
    try { rec.sessionId = extractSessionId(parseSfJson(startOut)) } catch { rec.sessionId = null }
    if (!rec.sessionId) {
      rec.status = 'failed'; rec.log = 'agent preview start returned no sessionId'
      return writeTraceEvidence(plan, rec, target)
    }
    // a live session exists — install the fail-closed signal handlers now
    for (const [s, h] of Object.entries(handlers)) process.on(s, h)
    handlersInstalled = true

    // (2) sends — one per utterance, in order. A throw here propagates to `finally`,
    // where the session is STILL ended (never orphaned).
    for (const step of plan.steps.filter((s) => s.kind === 'send')) {
      run(subst(step.argv, rec.sessionId))
      rec.turnCount++
    }

    // (3) trace read — three dimensions; an empty dimension is honest, never a pass
    for (const step of plan.steps.filter((s) => s.kind === 'trace-read')) {
      const out = run(subst(step.argv, rec.sessionId))
      rec.traces[step.dimension] = interpretTraceRead(parseSfJson(out), step.dimension)
    }

    // (4) trace list — best-effort trace-file location (never fatal)
    try {
      const listStep = plan.steps.find((s) => s.kind === 'trace-list')
      run(subst(listStep.argv, rec.sessionId))
    } catch { /* locating the trace path is non-fatal */ }

    rec.status = 'completed'
  } catch {
    rec.status = 'failed'
    // the toolkit does not persist raw `sf` output (it can carry auth material)
    rec.log = 'agent conversation failed mid-sequence (re-run to see the CLI error; the session was ended in finally)'
  } finally {
    // (5) end — MUST run even on a mid-send throw so a crashed conversation never
    // leaves a live preview session open
    cleanupEnd()
    if (handlersInstalled) for (const [s, h] of Object.entries(handlers)) process.removeListener(s, h)
  }

  return writeTraceEvidence(plan, rec, target)
}

function loadUtterances(file) {
  const raw = readFileSync(file, 'utf8')
  try {
    const j = JSON.parse(raw)
    if (Array.isArray(j)) return j.map(String).filter((s) => s.trim() !== '')
    if (j && Array.isArray(j.utterances)) return j.utterances.map(String).filter((s) => s.trim() !== '')
  } catch { /* not JSON — treat as newline-delimited text */ }
  return raw.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'))
}

function resolveOrgAlias(target) {
  try {
    const j = JSON.parse(readFileSync(join(target, '.security-review', 'org-standup.json'), 'utf8'))
    return j && j.alias ? String(j.alias) : null
  } catch { return null }
}

function main() {
  const argv = process.argv
  const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
  const target = arg('--target', process.cwd())
  const runId = arg('--run-id', `${Date.now().toString(36)}-${process.pid}-${randomBytes(3).toString('hex')}`)
  const tmpRoot = arg('--tmp-root', join(tmpdir(), 'sf-srt-agent-trace', runId))
  const asJson = argv.includes('--json')
  const apiName = arg('--api-name', null)
  const authoringBundle = arg('--authoring-bundle', null)
  const mode = arg('--mode', null)
  const utterancesFile = arg('--utterances-file', null)
  const orgAlias = arg('--org-alias', null) || resolveOrgAlias(target)
  // clock read at the impure CLI boundary, NOT in the pure planner
  const date = new Date().toISOString().slice(0, 10)

  let utterances = []
  if (utterancesFile) {
    try { utterances = loadUtterances(utterancesFile) }
    catch (e) {
      process.stdout.write((asJson ? JSON.stringify({ status: 'invalid', error: `cannot read utterances file: ${e.message}` }, null, 2) : `## agent-trace-probe — cannot plan: utterances file unreadable (${e.message})`) + '\n')
      process.exitCode = 3; return
    }
  }

  let plan
  try { plan = planAgentTraceProbe({ runId, apiName, authoringBundle, mode, utterances, orgAlias, target, tmpRoot, date }) }
  catch (e) {
    process.stdout.write((asJson ? JSON.stringify({ status: 'invalid', error: String(e.message) }, null, 2) : `## agent-trace-probe — cannot plan: ${e.message}`) + '\n')
    process.exitCode = 3; return
  }

  // --dry-run: the planned manifest ONLY — no `sf` spawn, no consent, no evidence files
  if (argv.includes('--dry-run')) {
    const m = writeManifest(plan, { status: 'planned', sessionId: null, turnCount: 0 }, null)
    process.stdout.write((asJson ? JSON.stringify(m, null, 2) : `## agent-trace-probe — planned (dry-run, no live op)\nagent: ${plan.apiName || plan.authoringBundle}   alias: ${plan.orgAlias}   turns: ${plan.utterances.length}\nsteps: ${plan.steps.length} sf invocations   manifest: ${plan.manifestPath}`) + '\n')
    return
  }

  // --consent alone is insufficient: the recorded affirmative 'sf-deep-audit-ops'
  // consent (asked via AskUserQuestion) is also required.
  const consentFlag = argv.includes('--consent')
  const consentRecorded = verifyConsent('sf-deep-audit-ops', { target })
  const consent = consentFlag && consentRecorded
  if (!consent) {
    const why = consentFlag && !consentRecorded
      ? `--consent is set but no affirmative consent is recorded for gate 'sf-deep-audit-ops' (the flag alone is not enough). Ask + record it first via record-consent.mjs.`
      : `re-run with --consent (and the recorded consent).`
    process.stdout.write(`## agent-trace-probe — NOT STARTED (no consent)\nWould drive ${plan.utterances.length} scripted utterance(s) against agent ${plan.apiName || plan.authoringBundle} in org ${plan.orgAlias}.\n${why}\n`)
    process.exitCode = 3; return
  }

  const m = agentTraceProbe(plan, { consent, target, orgAlias: plan.orgAlias })
  if (asJson) { process.stdout.write(JSON.stringify(m, null, 2) + '\n'); if (m.status !== 'completed') process.exitCode = 1; return }
  process.stdout.write(`## agent-trace-probe — ${m.status}\nalias: ${m.alias}   sessionId: ${m.sessionId || '(none)'}   turns: ${m.turnCount}\nevidence: ${plan.evidenceDir}\n${m.status !== 'completed' ? 'LOG: ' + (m.log || '') : ''}\n`)
  if (m.status !== 'completed') process.exitCode = 1
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) }
  catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

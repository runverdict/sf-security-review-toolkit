#!/usr/bin/env node
/*
 * merge-ledger.mjs — the MECHANICAL ledger merge (audit-methodology.md §5.2,
 * audit-ledger.schema.json). P2: SHIPPED engine code invoked with args — NOT an
 * LLM-authored per-run script. "Engine code, never an LLM": a synthesis agent
 * paraphrasing entries corrupts the dedup keys, so this step must be deterministic.
 *
 * Takes the audit Workflow's result (its `ledger_updates`) and folds it INTO the
 * existing ledger across passes: computes stable dedup ids, maps verdicts to states,
 * flips a re-found `fixed` entry back to confirmed+regression, tracks first/last-seen,
 * redacts credential material, stamps the pass `audited_commit`, and appends run-log.md.
 *
 * Read-only on partner source; writes only <target>/.security-review/{audit-ledger.json,run-log.md}.
 *
 * Usage:
 *   node merge-ledger.mjs --repo <target> --result <workflow-result.json> \
 *       --date YYYY-MM-DD --pass <N> --report docs/security-review/audit-report-<date>-pass<N>.md [--tier standard]
 *
 * --result is the file the audit Workflow's return was written to; this engine accepts
 * either the bare result object ({ ledger_updates, dimensions_run, ... }) or the tool
 * wrapper ({ result: {...}, agentCount }).
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { join } from 'node:path'

function arg(flag, def) {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const REPO = arg('--repo', process.cwd())
const RESULT = arg('--result', null)
const DATE = arg('--date', new Date().toISOString().slice(0, 10))
const PASS = parseInt(arg('--pass', '1'), 10)
const TIER = arg('--tier', 'standard')
const REPORT = arg('--report', `docs/security-review/audit-report-${DATE}-pass${PASS}.md`)
const LEDGER_PATH = join(REPO, '.security-review', 'audit-ledger.json')
const RUNLOG_PATH = join(REPO, '.security-review', 'run-log.md')

if (!RESULT) { console.error('merge-ledger: --result <workflow-result.json> is required'); process.exit(2) }
const readJSON = (p, def) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return def } }

const wrapper = readJSON(RESULT, null)
if (!wrapper) { console.error(`merge-ledger: cannot read result ${RESULT}`); process.exit(2) }
const R = wrapper.result && wrapper.result.ledger_updates ? wrapper.result : wrapper
const agentCount = wrapper.agentCount
if (!Array.isArray(R.ledger_updates)) { console.error('merge-ledger: no result.ledger_updates array'); process.exit(2) }

let HEAD = ''
try { HEAD = execSync('git rev-parse HEAD', { cwd: REPO }).toString().trim() } catch { HEAD = '' }

// ---- normalization per audit-ledger.schema.json #/$defs/finding/id ----
const repoRel = (p) => {
  let s = String(p || '').replace(/\\/g, '/')
  const root = REPO.replace(/\\/g, '/').replace(/\/+$/, '')
  if (s.startsWith(root + '/')) s = s.slice(root.length + 1)
  return s.replace(/^\/+/, '')
}
const stripLine = (p) => p.replace(/:[0-9]+$/, '')
const normTitle = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim()
const dedupId = (file, title) =>
  createHash('sha256').update(stripLine(repoRel(file)) + '\n' + normTitle(title)).digest('hex').slice(0, 16)

// ---- generic secret redaction (CONVENTIONS §6) — values, never names ----
const redact = (s) =>
  String(s || '')
    .replace(/((?:secret|password|passwd|pwd|api[_-]?key|apikey|access[_-]?key|client[_-]?secret|private[_-]?key|token|bearer|authorization)\s*["']?\s*[:=]\s*)["']?[A-Za-z0-9._\-+/=]{6,}["']?/gi, '$1***redacted***')
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, '***redacted-jwt***')

const statusFor = (v) =>
  v === 'false_positive' ? 'refuted' : v === 'confirmed_real' || v === 'partially_real' ? 'confirmed' : null
const oneLine = (s, n = 200) => {
  const first = String(s || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0] || ''
  return first.length > n ? first.slice(0, n - 1) + '…' : first
}

// ---- load the existing ledger and merge INTO it ----
const ledger = readJSON(LEDGER_PATH, { schema_version: '1', findings: [], passes: [] })
if (!Array.isArray(ledger.findings)) ledger.findings = []
if (!Array.isArray(ledger.passes)) ledger.passes = []
const byId = new Map(ledger.findings.map((f) => [f.id, f]))

let collisions = 0
for (const u of R.ledger_updates) {
  const status = statusFor(u.verdict)
  if (!status) { console.warn('skip (no verdict):', u.title); continue }
  const id = dedupId(u.file, u.title)
  const fileRel = repoRel(u.file)
  const reasoning = redact(u.verdict_reasoning) || '(no verifier reasoning recorded)'
  if (byId.has(id)) {
    collisions++
    const prev = byId.get(id)
    prev.last_seen = PASS
    if (prev.status === 'fixed' && status === 'confirmed') {
      // a remediated finding came back — regression
      prev.status = 'confirmed'
      prev.regression = true
      prev.adjusted_severity = u.adjusted_severity
      prev.verdict = u.verdict
      prev.verdict_reasoning = reasoning
      prev.evidence = redact(u.evidence)
    } else if (prev.status === 'accepted_risk') {
      // owner decision stands; only touch last_seen
    } else {
      // re-confirm / re-refute: refresh the verifier-authored fields
      prev.status = status
      prev.verdict = u.verdict
      prev.adjusted_severity = u.adjusted_severity
      prev.severity = u.finder_severity || prev.severity
      prev.verdict_reasoning = reasoning
      prev.evidence = redact(u.evidence)
      prev.exploit_scenario = u.exploit_scenario || prev.exploit_scenario
      prev.recommendation = u.recommendation || prev.recommendation
      prev.resolution_note = status === 'refuted' ? 'FP: ' + oneLine(u.verdict_reasoning) : oneLine(u.recommendation)
    }
    continue
  }
  const entry = {
    id,
    dimension: u.dimension,
    title: u.title,
    severity: u.finder_severity || u.adjusted_severity,
    adjusted_severity: u.adjusted_severity,
    file: fileRel,
    status,
    first_seen: PASS,
    last_seen: PASS,
    verdict: u.verdict,
    verdict_reasoning: reasoning,
    evidence: redact(u.evidence),
    exploit_scenario: u.exploit_scenario,
    recommendation: u.recommendation,
    resolution_note: status === 'refuted' ? 'FP: ' + oneLine(u.verdict_reasoning) : oneLine(u.recommendation),
  }
  ledger.findings.push(entry)
  byId.set(id, entry)
}

// ---- pass stats, computed from the merged findings (dedup-correct) ----
const touched = ledger.findings.filter((f) => f.last_seen === PASS)
const confirmedThisPass = touched.filter((f) => f.status === 'confirmed').length
const refutedThisPass = touched.filter((f) => f.status === 'refuted').length
const newConfirmedLowPlus = ledger.findings.filter(
  (f) => f.first_seen === PASS && f.status === 'confirmed' && f.adjusted_severity !== 'info'
).length
const candidates = Number.isInteger(R.total_candidates) ? R.total_candidates : R.ledger_updates.length
const unverified = Array.isArray(R.unverified) ? R.unverified.length : (Number(R.unverified) || 0)
const dims = Array.isArray(R.dimensions_run) ? R.dimensions_run : []

const passObj = {
  id: PASS,
  date: DATE,
  audited_commit: HEAD,
  tier: TIER,
  dimensions: dims.length ? dims : ['(unknown)'],
  agents: { finders: dims.length, verifiers: candidates, synthesis: 1 },
  candidates,
  confirmed: confirmedThisPass,
  refuted: refutedThisPass,
  unverified,
  dry: newConfirmedLowPlus === 0,
  report_path: repoRel(REPORT),
}
ledger.passes = ledger.passes.filter((p) => p.id !== PASS)
ledger.passes.push(passObj)
ledger.passes.sort((a, b) => a.id - b.id)
ledger.schema_version = '1'

writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2))

// ---- run-log ----
const confirmed = ledger.findings.filter((f) => f.status === 'confirmed')
const sevCount = {}
for (const f of confirmed) sevCount[f.adjusted_severity] = (sevCount[f.adjusted_severity] || 0) + 1
const sevStr = ['critical', 'high', 'medium', 'low', 'info'].filter((s) => sevCount[s]).map((s) => `${sevCount[s]} ${s}`).join(', ')
const logEntry =
  `\n## Pass ${PASS} — ${DATE} (${TIER})\n` +
  `- Commit: ${HEAD || '(unknown)'}\n` +
  `- Dimensions: ${dims.join(', ') || '(none)'}\n` +
  `- Agents: ${dims.length} finders + ${candidates} verifiers + 1 synthesis${agentCount ? ` = ${agentCount}` : ''}\n` +
  `- This pass: confirmed/partial ${confirmedThisPass}, refuted ${refutedThisPass}, unverified ${unverified}\n` +
  `- Open confirmed (all passes): ${confirmed.length} — ${sevStr || '(none above info)'}\n` +
  `- Dry (no new ≥low confirmed): ${passObj.dry}\n` +
  `- Report: ${passObj.report_path}\n` +
  `- Key collisions merged: ${collisions}\n`
if (!existsSync(RUNLOG_PATH)) writeFileSync(RUNLOG_PATH, `# Audit run log\n`)
appendFileSync(RUNLOG_PATH, logEntry)

console.log(`ledger: ${ledger.findings.length} findings total (${confirmed.length} open confirmed, ${ledger.findings.filter((f) => f.status === 'refuted').length} refuted); pass ${PASS} added ${confirmedThisPass} confirmed / ${refutedThisPass} refuted, collisions=${collisions}`)
if (sevStr) console.log(`open confirmed severities: ${sevStr}`)

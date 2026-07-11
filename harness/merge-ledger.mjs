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
 * redacts credential material, stamps `provenance:'llm-inferred'` so every finding
 * self-declares what the schema's absence-default implied (deterministic rows are never
 * touched — they arrive via ingest-scanner-findings with `provenance:'deterministic'`),
 * stamps the pass `audited_commit`, and appends run-log.md.
 *
 * Track-1b: it also COLLAPSES cross-dimension duplicates of ONE root cause. The dedup
 * id is file+TITLE, so the same defect found under two dimensions with different titles
 * hashes distinct and never merges by id — the cold-at-standard run carried one missing-FLS
 * root cause as TWO HIGH entries (apex-exposed-surface + web-client). On every merge the
 * engine EXPLODES any prior merged entry back to per-dimension lenses, runs the normal per-id
 * merge, then `collapseCrossDimension` (finding-clusters.mjs) re-collapses OPEN findings
 * on the same file + an OVERLAPPING LINE SPAN (the only key) across different dimensions
 * into ONE entry at the highest verified adjusted_severity, preserving each lens's
 * reasoning/evidence (`lenses[]` + labelled `verdict_reasoning`). Conservative: a second
 * bug at a different location stays separate; a title's symbol name is NOT a merge signal
 * (it OVER-merged two distinct vulns in the off-disk grade) — under-merge is the safe failure.
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
import { collapseCrossDimension, clusterOrNullFromFindings, renderClusterHeadline } from './finding-clusters.mjs' // Track-1b collapse + the verbatim headline block
import { renderAuditRecap } from './render-recap.mjs' // WI-04/INV-34 — the fixed end-of-run operator recap

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
if (!Array.isArray(R.ledger_updates)) {
  console.error(
    'merge-ledger: --result has no `ledger_updates` array after unwrap. Two shapes are accepted:\n' +
    '  (1) the RAW Workflow task-output envelope — `{ summary, result: { ledger_updates: [...] }, workflowProgress }`\n' +
    '      (the engine unwraps `.result` automatically); point --result at that task-output file DIRECTLY, or\n' +
    '  (2) a pre-extracted result object — `{ ledger_updates: [...] }`.\n' +
    `  Got neither (no \`ledger_updates\` and no \`result.ledger_updates\`) in ${RESULT}. ` +
    'Do NOT hand-extract `.result` or re-parse the envelope — pass the task-output file as-is.'
  )
  process.exit(2)
}

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
// HONESTY (data-loss guard): a PRESENT-but-non-array `findings` is a CORRUPTED or hand-edited
// prior ledger, NOT an empty one. Silently coercing it to [] (the old bug) would DROP the prior
// findings, and the writeFileSync below would OVERWRITE the recoverable file — a silent
// false-clean. The toolkit never self-writes this shape, so the ledger was altered out-of-band;
// refuse LOUDLY and leave the on-disk ledger untouched so it can be restored (matches the file's
// existing exit-2-on-malformed-input posture for `--result`).
if (ledger.findings != null && !Array.isArray(ledger.findings)) {
  console.error(
    '[merge-ledger] WARNING: prior ledger `findings` was not an array ' +
    `(corrupted or hand-edited) in ${LEDGER_PATH}; refusing to silently drop it. ` +
    'The toolkit never writes this shape — the ledger was altered out-of-band. Restore it from ' +
    'version control (git checkout) and re-run. This pass was NOT recorded and the on-disk ' +
    'ledger was left untouched.'
  )
  process.exit(2)
}
if (!Array.isArray(ledger.findings)) ledger.findings = []
if (!Array.isArray(ledger.passes)) ledger.passes = []

// Track-1b: EXPLODE any prior cross-dimension merged entry back into its per-dimension
// plain lenses (each with its own stable dedup id), so the per-id merge below updates
// ONE lens cleanly on an incremental re-run; collapseCrossDimension re-merges them at
// the end. A ledger with no merged entries is unchanged (no `lenses` ⇒ pass-through).
function explodeForMerge(findings) {
  const out = []
  // A1 (0.8.102) — carry the provenance quartet verbatim from the lens (genuinely
  // absent when the lens lacks it), structurally identical to asLenses/mergeLensCluster
  // in finding-clusters.mjs. WITHOUT this, an INCREMENTAL re-run destroys the fix:
  // pass 1's collapse produces a deterministic merged parent, pass 2's explode here
  // strips its lenses' provenance, and the re-collapse relabels the parent llm-inferred
  // (making it un-dispositionable again). The ledger is incremental by design, so the
  // fix has to hold across passes, not just on the first.
  const provFields = (l) => {
    const o = {}
    for (const k of ['provenance', 'engine', 'ruleId', 'class']) if (l && l[k] !== undefined) o[k] = l[k]
    return o
  }
  for (const f of findings) {
    if (Array.isArray(f.lenses) && f.lenses.length) {
      for (const l of f.lenses) {
        out.push({
          id: l.id || dedupId(l.file || f.file, l.title || f.title),
          dimension: l.dimension, title: l.title || f.title,
          severity: l.severity, adjusted_severity: l.adjusted_severity,
          file: l.file || f.file, status: l.status || 'confirmed',
          first_seen: l.first_seen ?? f.first_seen, last_seen: l.last_seen ?? f.last_seen,
          verdict: l.verdict, verdict_reasoning: l.verdict_reasoning, evidence: l.evidence,
          exploit_scenario: l.exploit_scenario, recommendation: l.recommendation,
          resolution_note: f.resolution_note,
          ...provFields(l),
        })
      }
    } else out.push(f)
  }
  return out
}
ledger.findings = explodeForMerge(ledger.findings)
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
    provenance: 'llm-inferred', // LLM/audit-Workflow findings self-declare provenance (was: absent → implicit)
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

// ---- Track-1b: collapse cross-dimension same-location duplicates into ONE entry
// at the highest verified adjusted_severity (per-lens detail preserved). Done BEFORE
// the pass stats so one root cause found under N dimensions counts ONCE, not N times.
ledger.findings = collapseCrossDimension(ledger.findings)

// ---- Ledger self-declaration (schema honesty, NOT a behavior change): a finding still
// missing `provenance` here is LLM-born — the entry literal above stamps every new entry,
// but the explode/collapse rebuilds (lens reconstructions, cross-dimension merged parents)
// carry explicit field lists that drop optional fields, and pre-existing entries predate
// the field. GUARDED on absence so a `provenance:'deterministic'` row is never relabeled.
// Every consumer already treats an absent provenance as llm-inferred (the schema default);
// this only makes the ledger say so itself.
for (const f of ledger.findings) if (!f.provenance) f.provenance = 'llm-inferred'

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
// BUG-A: dimensions whose FINDER crashed this pass (workflow-template emits `coverage_failed`).
// Coverage is INCOMPLETE for these, NOT clean — they produced no findings because they did not
// run. Carried into the pass object + the recap so the run never reads as a clean verdict over a
// crashed dimension, and the pass is never `dry` while this is non-empty (a crashed dimension
// can't contribute to the two-dry-passes stop rule).
const coverageFailed = Array.isArray(R.coverage_failed) ? R.coverage_failed.filter(Boolean) : []

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
  coverage_failed: coverageFailed,
  // A pass with a coverage failure is NEVER dry: a crashed finder found "nothing new" only
  // because it did not run, so counting it toward the stop rule would falsely declare the audit
  // complete. dry requires zero new ≥low confirmed AND every finder having actually run.
  dry: newConfirmedLowPlus === 0 && coverageFailed.length === 0,
  report_path: repoRel(REPORT),
}
ledger.passes = ledger.passes.filter((p) => p.id !== PASS)
ledger.passes.push(passObj)
ledger.passes.sort((a, b) => a.id - b.id)
ledger.schema_version = '1'

writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2))

// ---- the verbatim cluster-headline sidecar (deterministic headline emission) ----
// Emit the mandated exec-summary block — byte-identical to
// `finding-clusters.mjs --target <target> --headline` over the just-written ledger — to
// a deterministic on-disk artifact, so the synthesis LLM INCLUDES the file instead of
// remembering to run the command (and can never paste a hand-rebuilt or stale block).
// This runs at audit-codebase Step 6, BEFORE reconcile-provenance/apply-dispositions
// modify the ledger, so these bytes are PRE-disposition; `render-recap.mjs --target`
// (Step 7) REFRESHES the same file post-disposition — that refresh is the authoritative
// copy the report is verified against (verify-report-headline.mjs stays the backstop).
// No mkdir needed: the LEDGER_PATH write into `.security-review/` just succeeded.
writeFileSync(
  join(REPO, '.security-review', 'report-headline.md'),
  renderClusterHeadline(clusterOrNullFromFindings(ledger.findings)) + '\n'
)

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
  `- This pass: confirmed/partial ${confirmedThisPass}, refuted ${refutedThisPass}, unverified ${unverified}` +
  (coverageFailed.length ? `, coverage-FAILED ${coverageFailed.length} (finder crashed — re-run: ${coverageFailed.join(', ')})` : '') + `\n` +
  `- Open confirmed (all passes): ${confirmed.length} — ${sevStr || '(none above info)'}\n` +
  `- Dry (no new ≥low confirmed): ${passObj.dry}\n` +
  `- Report: ${passObj.report_path}\n` +
  `- Key collisions merged: ${collisions}\n`
if (!existsSync(RUNLOG_PATH)) writeFileSync(RUNLOG_PATH, `# Audit run log\n`)
appendFileSync(RUNLOG_PATH, logEntry)

console.log(`ledger: ${ledger.findings.length} findings total (${confirmed.length} open confirmed, ${ledger.findings.filter((f) => f.status === 'refuted').length} refuted); pass ${PASS} added ${confirmedThisPass} confirmed / ${refutedThisPass} refuted, collisions=${collisions}`)
if (sevStr) console.log(`open confirmed severities: ${sevStr}`)

// ── WI-04 / INV-34: the FIXED end-of-run operator recap, LED BY the finding-cluster
// triage headline. audit-codebase Step 7 prints this stdout block VERBATIM. It is a pure
// render over the merged ledger + this pass's stats (deterministic; no Date/LLM/network).
process.stdout.write(
  '\n' +
    renderAuditRecap({
      findings: ledger.findings,
      dimensions: dims,
      candidates,
      confirmed: confirmedThisPass,
      refuted: refutedThisPass,
      unverified,
      coverageFailed,
      pass: PASS,
      tier: TIER,
    }) +
    '\n'
)

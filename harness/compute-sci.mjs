#!/usr/bin/env node
/*
 * compute-sci.mjs — the Submission Completeness Index (WI-18).
 *
 * A DETERMINISTIC, EXPLAINABLE readiness number. It measures *what is done and
 * evidenced*, never the probability of passing — Salesforce pen-tests regardless.
 * Pure rollup: same inputs → same output, no LLM, no learned weights, no network,
 * no dependencies. Run by /sf-security-review-toolkit:compile-submission (Phase 5);
 * its output is rendered into the readiness-tracker header and surfaced by
 * security-review-journey at the pre-compile go/no-go gate.
 *
 * It reads only files the toolkit already produces:
 *   <target>/.security-review/audit-ledger.json     (findings[] status + adjusted_severity)
 *   <target>/.security-review/scope-manifest.json    (applicableBaselineIds + elements)
 *   <target>/.security-review/evidence/index.json    (WI-20 evidence model; optional)
 *   <pluginRoot>/baseline/requirements-baseline.yaml (severity_if_missing / last_verified / verification per id)
 *
 * THE HONESTY CONTRACT (CONVENTIONS §2):
 *   - A single naked 0-100 number is forbidden — it reads as "X% likely to pass".
 *     The output is GATED (blocker floor) + a 3-part VECTOR + a completeness %
 *     that is explicitly labelled "materials + disposition completeness, NOT a
 *     pass prediction", and always ships with the "NOT verified by this toolkit"
 *     list. Never collapse to one figure.
 *   - No credit for un-evidenced self-attestation: a requirement counts SATISFIED
 *     only with a registered, verified evidence entry. No evidence → PARTIAL/MISSING.
 *
 * Usage: node compute-sci.mjs --target <repo> --plugin <pluginRoot> [--date YYYY-MM-DD] [--json]
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
function arg(flag, def) {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const TARGET = arg('--target', process.cwd())
const PLUGIN = arg('--plugin', '/home/verdict/sf-security-review-toolkit')
const AS_JSON = process.argv.includes('--json')
const RUN_DATE = arg('--date', new Date().toISOString().slice(0, 10))

const SR = join(TARGET, '.security-review')
function readJSON(p, def) {
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return def }
}

const ledger = readJSON(join(SR, 'audit-ledger.json'), { findings: [] })
const manifest = readJSON(join(SR, 'scope-manifest.json'), { applicableBaselineIds: [], elements: [] })
const evidence = readJSON(join(SR, 'evidence', 'index.json'), { entries: [] })
const findings = Array.isArray(ledger.findings) ? ledger.findings : []
const applicable = Array.isArray(manifest.applicableBaselineIds) ? manifest.applicableBaselineIds : []
const evEntries = Array.isArray(evidence.entries) ? evidence.entries : []

// ---------------------------------------------------------------------------
// Baseline field extract — dependency-free line parse of requirements-baseline.yaml.
// Per top-level `- id:` entry, capture severity_if_missing / last_verified / verification.
// ---------------------------------------------------------------------------
function parseBaseline() {
  const map = {}
  const path = join(PLUGIN, 'baseline', 'requirements-baseline.yaml')
  if (!existsSync(path)) return map
  let cur = null
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const idm = raw.match(/^- id:\s*(\S+)/)
    if (idm) { cur = idm[1]; map[cur] = { id: cur }; continue }
    if (!cur) continue
    const sev = raw.match(/^\s+severity_if_missing:\s*(\S+)/)
    if (sev) map[cur].severity_if_missing = sev[1]
    const lv = raw.match(/^\s+last_verified:\s*["']?([0-9]{4}-[0-9]{2}-[0-9]{2})/)
    if (lv) map[cur].last_verified = lv[1]
    const ver = raw.match(/^\s+verification:\s*(\S+)/)
    if (ver) map[cur].verification = ver[1]
  }
  return map
}
const baseline = parseBaseline()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const OPEN_STATES = new Set(['confirmed', 'regressed']) // not fixed/refuted/accepted_risk
const isOpen = (f) => OPEN_STATES.has(String(f.status || '').toLowerCase()) ||
  (String(f.status || '').toLowerCase() === '' && String(f.verdict || '').toLowerCase() === 'confirmed_real')
const sevOf = (f) => String(f.adjusted_severity || f.severity || '').toLowerCase()

function daysBetween(a, b) {
  const ms = Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')
  return Number.isFinite(ms) ? Math.round(ms / 86400000) : NaN
}

// Requirement satisfaction: a baseline id is SATISFIED iff a verified evidence
// entry registers it (ref_type=requirement, disposition=satisfied, verified=true).
// pending-owner / partial / unverified => PARTIAL. No entry => MISSING.
function requirementStatus(id) {
  const evs = evEntries.filter((e) => e.ref_type === 'requirement' && e.ref_id === id)
  if (!evs.length) return 'MISSING'
  if (evs.some((e) => e.disposition === 'satisfied' && e.verified && e.verified.value === true)) return 'SATISFIED'
  return 'PARTIAL'
}

// ---------------------------------------------------------------------------
// 1. Blocker floor
// ---------------------------------------------------------------------------
const openBlockerFindings = findings.filter((f) => isOpen(f) && sevOf(f) === 'critical')
const openBlockerReqs = applicable.filter(
  (id) => (baseline[id]?.severity_if_missing === 'blocker') && requirementStatus(id) !== 'SATISFIED'
)
const blocked = openBlockerFindings.length > 0 || openBlockerReqs.length > 0

// ---------------------------------------------------------------------------
// 2. Disposition vector — undispositioned critical/high in the ledger
// ---------------------------------------------------------------------------
const openCritical = findings.filter((f) => isOpen(f) && sevOf(f) === 'critical').length
const openHigh = findings.filter((f) => isOpen(f) && sevOf(f) === 'high').length
const dispositioned = findings.filter((f) => !isOpen(f)).length

// ---------------------------------------------------------------------------
// 3. Coverage vector — applicable requirements satisfied with evidence
// ---------------------------------------------------------------------------
let satisfied = 0, partial = 0, missing = 0
for (const id of applicable) {
  const s = requirementStatus(id)
  if (s === 'SATISFIED') satisfied++
  else if (s === 'PARTIAL') partial++
  else missing++
}
const applicableN = applicable.length || 1
const completeness = Math.round((satisfied / applicableN) * 100)

// ---------------------------------------------------------------------------
// 4. Evidence freshness — satisfied-but-stale / unverified baseline currency
// ---------------------------------------------------------------------------
const FRESH_WINDOW = 90
const caveated = applicable.filter((id) => {
  const b = baseline[id]
  if (!b) return false
  const stale = b.last_verified ? daysBetween(b.last_verified, RUN_DATE) > FRESH_WINDOW : true
  const unverified = b.verification && /web_research_unverified|conflicting/.test(b.verification)
  return stale || unverified
})
const conflicting = applicable.filter((id) => baseline[id]?.verification === 'conflicting')

// ---------------------------------------------------------------------------
// 5. Band
// ---------------------------------------------------------------------------
let band, gateReason
if (!applicable.length) {
  // Fail CLOSED: no scope manifest / no applicable requirements is never "ready".
  band = 'NOT READY'
  gateReason =
    'no scope manifest or no applicable requirements found — run /sf-security-review-toolkit:scope-submission first'
} else if (blocked) {
  band = 'BLOCKED'
  const parts = []
  if (openBlockerFindings.length) parts.push(`${openBlockerFindings.length} open critical finding(s)`)
  if (openBlockerReqs.length) parts.push(`${openBlockerReqs.length} unsatisfied blocker requirement(s): ${openBlockerReqs.slice(0, 4).join(', ')}${openBlockerReqs.length > 4 ? '…' : ''}`)
  gateReason = parts.join(' + ') + ' — must close before submission'
} else if (openHigh > 0) {
  band = 'NOT READY'
  gateReason = `${openHigh} open high finding(s) — fix or document before submission`
} else if (missing > 0 || partial > 0) {
  band = 'MATERIALS COMPLETE'
  gateReason = `no open blocker/high; ${missing} required item(s) MISSING, ${partial} PARTIAL — finish materials`
} else if (caveated.length > 0) {
  band = 'MATERIALS COMPLETE'
  gateReason = `all materials satisfied, but ${caveated.length} rely on stale/unverified baseline entries — confirm currency`
} else {
  band = 'NO-SURPRISES READY'
  gateReason = 'every applicable requirement satisfied with current evidence; every critical/high dispositioned'
}

// The standing "not verified by this toolkit" list — always present.
const NOT_VERIFIED = [
  'runtime CSP / Trusted-URL behavior (static metadata only)',
  'data retention + deletion-on-uninstall behavior',
  'disaster-recovery / backup posture',
  "the reviewer's own pen test + Checkmarx + Code Analyzer (run regardless of submission)",
  'the static-review false-negative floor (logic bugs reachable only at runtime)',
]

const result = {
  run_date: RUN_DATE,
  band,
  gate_reason: gateReason,
  blocked,
  completeness_pct: completeness,
  completeness_label: 'materials + disposition completeness, NOT a pass-likelihood',
  coverage: { applicable: applicable.length, satisfied, partial, missing },
  disposition: { open_critical: openCritical, open_high: openHigh, dispositioned },
  freshness: { caveated: caveated.length, conflicting: conflicting.length, window_days: FRESH_WINDOW },
  blocker_findings: openBlockerFindings.map((f) => f.id || f.title).slice(0, 10),
  blocker_requirements: openBlockerReqs.slice(0, 10),
  not_verified_by_toolkit: NOT_VERIFIED,
}

if (AS_JSON) {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
} else {
  const L = []
  L.push(`## Submission Completeness Index (SCI)`)
  L.push('')
  L.push('> Deterministic rollup of the audit ledger + evidence index + baseline. Measures')
  L.push('> **materials + disposition completeness, NOT a pass prediction** — Salesforce')
  L.push('> pen-tests the live solution regardless of this score.')
  L.push('')
  L.push(`**READINESS: ${band}**`)
  L.push(`- Gate: ${gateReason}`)
  L.push(`- Coverage: ${satisfied}/${applicable.length} applicable requirements SATISFIED · ${partial} PARTIAL · ${missing} MISSING`)
  L.push(`- Disposition: ${openCritical} open critical · ${openHigh} open high · ${dispositioned} dispositioned`)
  L.push(`- Evidence: ${caveated.length} caveated (stale >${FRESH_WINDOW}d or unverified) · ${conflicting.length} conflicting`)
  L.push(`- Completeness: **${completeness}%** _(materials + disposition completeness, NOT pass likelihood)_`)
  if (openBlockerFindings.length) L.push(`- Open critical findings: ${result.blocker_findings.join(', ')}`)
  if (openBlockerReqs.length) L.push(`- Unsatisfied blocker requirements: ${openBlockerReqs.join(', ')}`)
  L.push('')
  L.push('**NOT verified by this toolkit (Salesforce tests regardless):**')
  for (const n of NOT_VERIFIED) L.push(`- ${n}`)
  L.push('')
  L.push('_Every input is a file the skill produced; the function is a pure rollup with no learned weights. Re-running on the same state yields the same verdict._')
  process.stdout.write(L.join('\n') + '\n')
}

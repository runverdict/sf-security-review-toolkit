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
 *   - No credit for self-grading (P1): SATISFIED requires REVIEWER-REPRODUCIBLE
 *     evidence (reviewer_reproducible=true — a scanner report the reviewer re-runs,
 *     an owner-signed artifact, or a structural N/A). A clear that rests only on this
 *     toolkit's own white-box LLM static audit is 'statically-cleared': surfaced as a
 *     separate signal, NEVER counted SATISFIED, NEVER clears the blocker floor
 *     (Salesforce pen-tests these classes regardless). FAILS CLOSED: a missing
 *     reviewer_reproducible flag is treated as not-reproducible, so a hand-authored or
 *     over-crediting index under-credits (safe) instead of inflating the headline.
 *
 * Usage: node compute-sci.mjs --target <repo> --plugin <pluginRoot> [--date YYYY-MM-DD] [--json]
 *
 * Exit codes: 0 — SCI computed. 2 — STALE SCOPE MANIFEST refusal: the manifest's
 * stored `applicableBaselineIds` no longer equals a recompute from the manifest's
 * own elements against the current baseline (see the stale-manifest block below).
 * The refusal block is plain text on BOTH the text and --json paths — a non-zero
 * exit means there is no SCI to parse.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseBaselineApplies, computeApplicable } from './applicable-requirements.mjs'

// ---------------------------------------------------------------------------
function arg(flag, def) {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const TARGET = arg('--target', process.cwd())
const PLUGIN = arg('--plugin', fileURLToPath(new URL('..', import.meta.url)))
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
// Stale-scope-manifest refusal (exit code 2).
// `applicableBaselineIds` is the single persisted applicable-set authority every
// number below keys off — but it is a CACHE of scope-submission's computation.
// Two drift classes make the cache lie: a manifest scoped before the
// applicability gate canonicalized element-type synonyms persists a truncated
// set (an under-scoped set INFLATES the completeness % and under-requires the
// blocker floor — the falsely-ready failure), and a plugin upgrade can change
// the baseline after the manifest was scoped. So when the manifest carries
// elements, recompute the set from them (applicable-requirements.mjs — the same
// engine scope-submission ran, canonicalization included) against the same
// baseline file this script already reads, and REFUSE on any set difference
// (order-insensitive; duplicate ids ignored). Never silently proceed with
// EITHER set: the stored one under-requires, and silently substituting the
// recompute would mask the drift compile-submission's manifest spot-check
// exists to catch. A manifest with no usable element types has no scope to
// recompute from, so the check is skipped there (the same "scope not computed
// yet" doctrine renderApplicable applies): the empty-STORED case still fails
// closed via the NOT-READY band below, while stored ids WITHOUT elements are
// out of this check's reach — a hand-edited shape scope-submission never
// writes, and the compile prose forbids hand-editing the manifest. The check
// itself can only refuse, never alter a passing run. Element-type strings are
// trimmed to mirror the applicable-requirements `--elements` producer path, so
// stray whitespace in an element type can never false-positive the refusal.
// ---------------------------------------------------------------------------
const manifestElementTypes = (Array.isArray(manifest.elements) ? manifest.elements : [])
  .map((e) => e && e.type)
  .map((t) => (typeof t === 'string' ? t.trim() : t))
  .filter((t) => t != null && t !== '')
if (manifestElementTypes.length) {
  const baselinePath = join(PLUGIN, 'baseline', 'requirements-baseline.yaml')
  const baselineEntries = existsSync(baselinePath)
    ? parseBaselineApplies(readFileSync(baselinePath, 'utf8'))
    : []
  if (baselineEntries.length) {
    const storedSet = new Set(applicable)
    const recomputedSet = new Set(computeApplicable(baselineEntries, manifestElementTypes))
    const missing = [...recomputedSet].filter((id) => !storedSet.has(id)).sort()
    const extra = [...storedSet].filter((id) => !recomputedSet.has(id)).sort()
    if (missing.length || extra.length) {
      const sample = (ids) => ids.slice(0, 5).join(', ') + (ids.length > 5 ? ` … (+${ids.length - 5} more)` : '')
      const L = []
      L.push('STALE SCOPE MANIFEST — refusing to compute the SCI.')
      L.push(
        `The manifest's stored applicable set (${storedSet.size} distinct id(s)) no longer matches a recompute from ` +
          `its own elements (${manifestElementTypes.join(', ')}) against the current baseline (${recomputedSet.size} id(s)).`
      )
      if (missing.length) L.push(`  Missing from stored (under-required): ${sample(missing)}`)
      if (extra.length) L.push(`  Stored but no longer applicable: ${sample(extra)}`)
      L.push(
        'An under-scoped applicable set INFLATES the completeness % and under-requires the blocker floor. Likely ' +
          'causes: the manifest was scoped before element-type synonyms were canonicalized, or a plugin upgrade ' +
          'changed the baseline after scoping. Re-run /sf-security-review-toolkit:scope-submission to regenerate ' +
          'the manifest, then re-run this step.'
      )
      process.stdout.write(L.join('\n') + '\n')
      process.exit(2)
    }
  }
}

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

// Requirement satisfaction with the CREDIT RULE (P1). A baseline id is:
//   SATISFIED          — a REVIEWER-REPRODUCIBLE verified evidence entry registers it
//                        (disposition=satisfied, verified.value=true, reviewer_reproducible=true).
//   STATICALLY_CLEARED — the only "clear" is the toolkit's own white-box static audit
//                        (disposition='statically-cleared', OR satisfied/verified but
//                        reviewer_reproducible is absent/false — FAIL CLOSED). Real signal,
//                        but never headline credit and never a blocker-floor clear.
//   PARTIAL            — an entry exists but is pending-owner / drafted / unverified.
//   MISSING            — no entry.
const isCreditable = (e) =>
  e.disposition === 'satisfied' && e.verified && e.verified.value === true && e.reviewer_reproducible === true
const isStaticClear = (e) =>
  e.disposition === 'statically-cleared' ||
  (e.disposition === 'satisfied' && e.verified && e.verified.value === true && e.reviewer_reproducible !== true)
function requirementStatus(id) {
  const evs = evEntries.filter((e) => e.ref_type === 'requirement' && e.ref_id === id)
  if (!evs.length) return 'MISSING'
  if (evs.some(isCreditable)) return 'SATISFIED'
  if (evs.some(isStaticClear)) return 'STATICALLY_CLEARED'
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
let satisfied = 0, staticallyCleared = 0, partial = 0, missing = 0
const staticallyClearedIds = []
for (const id of applicable) {
  const s = requirementStatus(id)
  if (s === 'SATISFIED') satisfied++
  else if (s === 'STATICALLY_CLEARED') { staticallyCleared++; staticallyClearedIds.push(id) }
  else if (s === 'PARTIAL') partial++
  else missing++
}
const applicableN = applicable.length || 1
// Statically-cleared is NEVER in the numerator — it does not inflate the headline.
const completeness = Math.round((satisfied / applicableN) * 100)

// ---------------------------------------------------------------------------
// 4. Evidence freshness — satisfied-but-stale / unverified baseline currency
// ---------------------------------------------------------------------------
const FRESH_WINDOW = 90
// Two DISJOINT currency caveats (their union is `caveated`, kept for the band):
//   unverified — the maintainer never confirmed it against a primary source
//                (web_research_unverified / conflicting; carries last_verified:null).
//   stale      — confirmed once, but the confirmation has aged past the window
//                (a real last_verified date older than FRESH_WINDOW).
// Splitting them is honest: "we never verified this" and "we verified it but it
// may have rotted" are different asks on the partner (the first → confirm with
// your PAM; the second → re-check against current docs).
const isUnverified = (b) => b && b.verification && /web_research_unverified|conflicting/.test(b.verification)
const unverified = applicable.filter((id) => isUnverified(baseline[id]))
const stale = applicable.filter((id) => {
  const b = baseline[id]
  if (!b || isUnverified(b)) return false // unverified is its own bucket, not "stale"
  return b.last_verified && daysBetween(b.last_verified, RUN_DATE) > FRESH_WINDOW
})
const caveated = applicable.filter((id) => {
  const b = baseline[id]
  if (!b) return false
  const aged = b.last_verified ? daysBetween(b.last_verified, RUN_DATE) > FRESH_WINDOW : true
  return aged || isUnverified(b)
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
} else if (missing > 0 || partial > 0 || staticallyCleared > 0) {
  band = 'MATERIALS COMPLETE'
  gateReason = `no open blocker/high; ${missing} required item(s) MISSING, ${partial} PARTIAL, ${staticallyCleared} statically-cleared (not reviewer-verified) — finish materials / obtain reviewer-reproducible evidence`
} else if (caveated.length > 0) {
  band = 'MATERIALS COMPLETE'
  gateReason = `all materials satisfied, but ${caveated.length} rely on stale/unverified baseline entries — confirm currency`
} else {
  band = 'NO-SURPRISES READY'
  gateReason = 'every applicable requirement satisfied with current evidence; every critical/high dispositioned'
}

// ---------------------------------------------------------------------------
// 5b. Baseline-currency band floor (the reframed "currency must cost something"
// gate). TWO-AXES PRINCIPLE — do not conflate these, and never dock the partner
// for the maintainer's lag:
//   • completeness % measures whether the PARTNER produced verified evidence
//     (their work) — currency NEVER decrements it (that would be false
//     incompleteness: telling a partner who did everything right they are
//     incomplete because of OUR maintenance lag).
//   • the band is the overall CONFIDENCE signal — and confidence legitimately
//     erodes when the readiness rests on guidance that may have rotted
//     (Salesforce changed the review process three times in eighteen months).
// So currency rot caps the BAND, never the score. We key on STALE (entries
// confirmed once but aged past a HARD window), NOT on `unverified` — unverified
// is a known, stable property of today's baseline (already surfaced as a
// caveat that blocks NO-SURPRISES READY); penalizing the band for it would
// fire on every run. STALE is the rot signal: it is ~0 on a freshly maintained
// baseline and climbs as the guidance ages, which is exactly when a confident
// readiness verdict would be dishonest.
const HARD_WINDOW = 180 // 2× the soft caveat window
const CURRENCY_FLOOR_PCT = 33 // a third of applicable reqs on rotted guidance ⇒ cap confidence
const hardStale = applicable.filter((id) => {
  const b = baseline[id]
  return b && !isUnverified(b) && b.last_verified && daysBetween(b.last_verified, RUN_DATE) > HARD_WINDOW
})
const hardStalePct = applicable.length ? Math.round((hardStale.length / applicable.length) * 100) : 0
// Fire only when currency is the ONLY thing between the partner and ready:
//   - the band is NO-SURPRISES READY, or MATERIALS COMPLETE with nothing missing/partial
//     (firing on a missing/partial MATERIALS-COMPLETE would clobber the "finish
//     materials" reason and tell a mid-prep partner their problem is our baseline);
//   - and at least 2 hard-stale reqs (not a single req crossing 33% on a tiny manifest).
// Calibration note: because real-baseline entries share verification dates, hardStalePct
// is a STEP function — ~0 on a freshly refreshed baseline, then it jumps once the bulk of
// entries cross HARD_WINDOW (≈180d after the last baseline refresh). It is a "the guidance
// has aged out" tripwire, not a gradual ramp; that is the intended, honest behavior.
const materialsTrulyComplete = band === 'NO-SURPRISES READY' || (band === 'MATERIALS COMPLETE' && missing === 0 && partial === 0 && staticallyCleared === 0)
if (!blocked && applicable.length && hardStale.length >= 2 && hardStalePct >= CURRENCY_FLOOR_PCT && materialsTrulyComplete) {
  band = 'NOT READY'
  gateReason =
    `baseline currency: ${hardStalePct}% of applicable requirements rest on baseline entries last verified ` +
    `>${HARD_WINDOW}d ago — the readiness signal is built on guidance that may have rotted (the review process ` +
    `changes often). Re-verify the baseline (see baseline/SOURCES.md) before relying. Your completeness % is ` +
    `unchanged: this caps confidence, not your materials.`
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
  coverage: { applicable: applicable.length, satisfied, statically_cleared: staticallyCleared, partial, missing },
  statically_cleared_requirements: staticallyClearedIds.slice(0, 20),
  disposition: { open_critical: openCritical, open_high: openHigh, dispositioned },
  freshness: { caveated: caveated.length, stale: stale.length, unverified: unverified.length, conflicting: conflicting.length, window_days: FRESH_WINDOW, hard_stale: hardStale.length, hard_stale_pct: hardStalePct, hard_window_days: HARD_WINDOW },
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
  if (staticallyCleared > 0) {
    L.push(`- Statically cleared (NOT reviewer-verified): ${staticallyCleared} — the toolkit's own white-box static audit found these classes clean, but with no reviewer-reproducible scanner/owner evidence. They do NOT count toward the completeness % and do NOT clear the blocker floor; Salesforce pen-tests them regardless. Obtain a Code Analyzer/SFGE/Checkmarx clear to credit them: ${staticallyClearedIds.slice(0, 8).join(', ')}${staticallyClearedIds.length > 8 ? '…' : ''}`)
  }
  L.push(`- Disposition: ${openCritical} open critical · ${openHigh} open high · ${dispositioned} dispositioned`)
  L.push(`- Currency: ${caveated.length} of ${applicable.length} applicable requirements rest on caveated baseline entries — ${unverified.length} UNVERIFIED (never confirmed against a primary source; confirm with your PAM) · ${stale.length} STALE (verified >${FRESH_WINDOW}d ago; re-check against current docs) · ${conflicting.length} conflicting`)
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

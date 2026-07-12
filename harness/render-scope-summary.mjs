#!/usr/bin/env node
/*
 * render-scope-summary.mjs — the VERBATIM final scope-manifest summary (WI-06 / INV-06,
 * presentation-consistency Slice 5). The output-class analog of the gate-spec engine: the
 * ENGINE owns the summary SKELETON, the driver pastes it byte-for-byte into scope-submission
 * Step 9 (the final summary + confirm), right before the `scope-confirm` gate.
 *
 * WHY THIS EXISTS. Step 9 is the cheapest moment to fix scope — every later phase multiplies an
 * error in the manifest (the audit fans out against the wrong surface set; the DAST scope comes
 * up narrower than the architecture diagram). The summary was driver-improvised prose: a table
 * one run, bullets the next, the endpoint environment labels dropped, the partner-program gate
 * states paraphrased into a confident "all set" that the recorded answers did not support. This
 * pins it: a FIXED-field readout filled deterministically from the manifest, with two honesty
 * crux points the engine enforces — (1) a missing / unreadable / non-object manifest renders an
 * explicit "scope not finalized" line, NEVER a fabricated "ready/confirmed" state; (2) each
 * operatorConfirmed gate renders its ACTUAL recorded state (✓ confirmed / ✗ NOT confirmed / — N/A
 * (the promoted gate's not-applicable sentinel) / not recorded), never a fabricated ✓ and never
 * collapsing a legitimate N/A into a ✗ blocker.
 *
 * It reads scope-submission's scope-manifest.json:
 *   { listingType, listingDirection, repoCommit, sfAutoResolved,
 *     elements: [ { type, evidence } ],
 *     endpoints: [ { url, environment, role } ],
 *     applicableBaselineIds: [ ... ],
 *     operatorConfirmed: { partnerAgreementSigned, partnerConsoleAccess, packagePromoted,
 *                          namespaceRegisteredAndLinked, listingCreated, reviewContactsDesignated } }
 * and emits ONE fixed Markdown block in a FIXED field order (listing type · direction ·
 * auto-resolution · repo commit · elements · endpoints w/ environment labels · applicable count ·
 * partner-program preflight gate states), closed by the "this is scope, not a security verdict"
 * honesty line.
 *
 * DETERMINISTIC + PURE (CONVENTIONS §7): same manifest in → byte-identical block out. No LLM, no
 * network, no deps, no Date/Math.random. A missing/unreadable/non-JSON manifest, or a non-object,
 * → the honest "scope not finalized" block, never a crash and never a fabricated ready state.
 *
 * USAGE:
 *   node render-scope-summary.mjs --target <repo>      # reads .security-review/scope-manifest.json
 *   node render-scope-summary.mjs --input <file.json>  # reads an explicit JSON file
 *   (--json → { block })
 */
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CANONICAL_ELEMENT_ORDER, canonicalElementType } from './render-detected-elements.mjs'

// The partner-program preflight gates in scope-submission step-5 order — the manifest
// operatorConfirmed.<key> + its display label. FROZEN so the gate-state table is fixed run-to-run
// and a manifest that omits a key renders an honest "(not recorded)" rather than a fabricated ✓.
export const PREFLIGHT_GATES = Object.freeze([
  ['partnerAgreementSigned', 'Partner agreement signed'],
  ['partnerConsoleAccess', 'Partner Console access'],
  ['packagePromoted', 'Package promoted'],
  ['namespaceRegisteredAndLinked', 'Namespace registered & linked'],
  ['listingCreated', 'Listing created'],
  ['reviewContactsDesignated', 'Review contacts designated'],
])

// The fixed listing-direction caption (a label only; the auth-rule VALUES live in render-mcp-scope).
const DIRECTION_LABEL = Object.freeze({
  B: 'B — outbound MCP server',
  A: 'A — inbound MCP client integration',
  both: 'both — outbound server AND inbound client',
})

// Flatten a value to one safe Markdown-table cell: collapse whitespace/newlines, escape pipes.
const cell = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim() || '—'

const NOT_FINALIZED = [
  '### Scope manifest summary',
  '',
  'Scope not finalized: no readable `.security-review/scope-manifest.json`. Run ' +
    '`/sf-security-review-toolkit:scope-submission` through step 8 (write the manifest) first — ' +
    'there is nothing to confirm yet. This is NOT a "scope confirmed" or "ready" state; it means ' +
    'the scope has not been written.',
].join('\n')

// The promoted gate's N/A sentinel tokens (an MCP-server-only / external-app listing has no
// package to promote — N/A is NOT a ✗ blocker). The driver records this distinctly (by the chosen
// option's LABEL, mirroring scope-confirm's label-detected branch), never as `false`.
const NA_TOKENS = new Set(['n/a', 'na', 'not-applicable', 'not applicable'])

/** Render an operatorConfirmed gate state HONESTLY: true→✓, false→✗, the N/A sentinel → an explicit
 * not-applicable cell (never a ✗ blocker), absent/null→not recorded. Any OTHER non-boolean value is
 * rendered literally — never silently as ✓ — so an unexpected write cannot fabricate a pass. */
function gateState(oc, key) {
  if (!oc || typeof oc !== 'object' || !Object.prototype.hasOwnProperty.call(oc, key) || oc[key] == null) {
    return '(not recorded)'
  }
  const v = oc[key]
  if (v === true) return '✓ confirmed'
  if (v === false) return '✗ NOT confirmed'
  if (NA_TOKENS.has(String(v).trim().toLowerCase())) return '— N/A (not applicable — no package in scope)'
  return `(recorded: ${cell(v)})`
}

/** Stable canonical element order (known types first, unknown appended in manifest order).
 * A recognized synonym ranks under its canonical slot — the type string itself still renders
 * verbatim (honest provenance) — mirroring render-detected-elements' rank. Sort-only. */
function orderElements(els) {
  const rank = (type) => {
    const i = CANONICAL_ELEMENT_ORDER.indexOf(String(canonicalElementType(type)))
    return i >= 0 ? i : CANONICAL_ELEMENT_ORDER.length
  }
  return els
    .map((e, i) => ({ e, i }))
    .sort((a, b) => rank(a.e.type) - rank(b.e.type) || a.i - b.i)
    .map((x) => x.e)
}

/** Pure: the scope-manifest JSON (or null) → the fixed final-summary block. */
export function renderScopeSummary(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return NOT_FINALIZED

  const L = ['### Scope manifest summary', '']
  L.push(
    'The final scope readout before confirmation — the cheapest moment to fix scope; every later ' +
      'phase multiplies an error here.'
  )
  L.push('')

  // ── header facts (fixed order) ──
  const listingType = manifest.listingType ? cell(manifest.listingType) : '(not recorded)'
  L.push(`**Listing type:** ${listingType}`)
  const dir = manifest.listingDirection
  if (dir == null) {
    L.push('**Listing direction:** (no MCP surface in scope)')
  } else if (DIRECTION_LABEL[dir]) {
    L.push(`**Listing direction:** ${DIRECTION_LABEL[dir]}`)
  } else {
    L.push(`**Listing direction:** ${cell(dir)} (unrecognized — expected B, A, or both)`)
  }
  L.push(
    `**SF-CLI auto-resolution:** ${
      manifest.sfAutoResolved === true
        ? 'ran (sf-autoresolve.json written)'
        : 'skipped (no DevHub / no consent / no sf — operator-asked / code-inferred values stand)'
    }`
  )
  L.push(`**Repo commit:** ${manifest.repoCommit ? cell(manifest.repoCommit) : '(not recorded)'}`)
  L.push('')

  // ── architecture elements ──
  const els = Array.isArray(manifest.elements)
    ? manifest.elements.filter((e) => e && typeof e === 'object' && e.type)
    : []
  L.push(`**Architecture elements (${els.length}):**`)
  if (!els.length) {
    L.push('- (none recorded — an element you fail to detect is a dimension that silently never runs)')
  } else {
    for (const e of orderElements(els)) {
      const evidence = e.evidence ? cell(e.evidence) : '(no evidence recorded — dispute this)'
      L.push(`- ${cell(e.type)} — ${evidence}`)
    }
  }
  L.push('')

  // ── endpoints (the environment label is load-bearing PROVENANCE: the DAST only ever hits the
  // disposable loopback mirror — run-dast refuses any non-loopback target — but an unlabeled
  // endpoint muddies every artifact that cites it, so a missing environment renders LOUDLY) ──
  const eps = Array.isArray(manifest.endpoints)
    ? manifest.endpoints.filter((e) => e && typeof e === 'object')
    : []
  L.push(`**Endpoints (${eps.length}):**`)
  if (!eps.length) {
    L.push('(none recorded)')
  } else {
    L.push('| URL | Environment | Role |')
    L.push('|---|---|---|')
    for (const e of eps) {
      // Trim BEFORE the truthiness test so a whitespace-only environment is flagged as loudly as an
      // absent one (a silent blank is exactly how an endpoint's provenance goes unlabeled into evidence).
      const envRaw = typeof e.environment === 'string' ? e.environment.trim() : e.environment
      const env = envRaw ? cell(envRaw) : '⚠ UNLABELED — must label'
      const role = e.role ? cell(e.role) : '(not recorded)'
      L.push(`| ${e.url ? cell(e.url) : '(no url)'} | ${env} | ${role} |`)
    }
  }
  L.push('')

  // ── applicable requirement count (= the EXACT length of applicableBaselineIds) ──
  const applicable = Array.isArray(manifest.applicableBaselineIds) ? manifest.applicableBaselineIds.length : null
  L.push(
    `**Applicable baseline requirements:** ${
      applicable == null ? '(not computed)' : `${applicable} (the exact length of applicableBaselineIds)`
    }`
  )
  L.push('')

  // ── partner-program preflight gate states (HONEST per-gate, never a fabricated ✓) ──
  const oc = manifest.operatorConfirmed
  L.push('**Partner-program preflight (operatorConfirmed):**')
  L.push('')
  L.push('| Gate | State |')
  L.push('|---|---|')
  for (const [key, label] of PREFLIGHT_GATES) L.push(`| ${label} | ${gateState(oc, key)} |`)
  L.push('')

  L.push(
    '_This is scope, not a security verdict — it records WHAT will be examined, nothing about ' +
      'whether the code is secure._'
  )
  return L.join('\n')
}

function main() {
  const arg = (flag, def) => {
    const i = process.argv.indexOf(flag)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
  }
  const target = arg('--target', null)
  const input = arg('--input', null)
  const path = input || (target ? join(target, '.security-review', 'scope-manifest.json') : null)
  let data = null
  if (path) {
    try {
      data = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      data = null // absent / unreadable / non-JSON → the honest "scope not finalized" line, never a crash
    }
  }
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ block: renderScopeSummary(data) }, null, 2) + '\n')
  } else {
    process.stdout.write(renderScopeSummary(data) + '\n')
  }
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
  } catch {
    return fileURLToPath(import.meta.url) === process.argv[1]
  }
}
if (invokedDirectly()) main()

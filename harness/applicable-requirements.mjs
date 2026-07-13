#!/usr/bin/env node
/**
 * applicable-requirements.mjs — deterministic "which baseline requirements
 * apply to this architecture" computer (scope-submission step 7).
 *
 * WHY THIS EXISTS. A cold-start acceptance run on a plain forecasting managed
 * package (no Agentforce agent, no MCP server) found agentforce-* and mcp-*
 * requirements in its applicable set — the scope step asserting requirements
 * that do not apply, which then propagate into the SCI blocker accounting (a
 * partner told to satisfy `agentforce-execution-identity-verifiedcustomerid`
 * for a package that has no agent). Root cause: several agentforce and mcp
 * baseline entries were gated on the generic `managed-package` element, and
 * applicability was computed by judgment. This makes applicability a PURE,
 * deterministic set operation over the (now element-precise) baseline — the
 * same discipline the toolkit imposes on partner counts ("the applicable count
 * is the exact length of the compiled list, never an estimate").
 *
 * RULE: a requirement applies iff its `applies_to` contains `all`, OR its
 * `applies_to` intersects the detected element types. `agentforce` and
 * `mcp-server` are element tokens detected from the partner's own code/metadata
 * (Bot/GenAiPlugin/GenAiPlanner = agentforce; JSON-RPC initialize/tools-list in
 * own code = mcp-server) — NOT inferred from `managed-package`.
 *
 * Element types are canonicalized through `canonicalElementType` (the synonym
 * map owned by render-detected-elements.mjs) INSIDE `computeApplicable`, so a
 * synonym-typed element (`external-web-app`) computes the SAME applicable set
 * as its canonical type (`external-endpoint`). The scope manifest is
 * LLM-authored, and this set feeds compute-sci's blocker floor + completeness
 * % — an un-canonicalized synonym silently dropped the whole external-endpoint
 * control set (DAST, TLS, endpoint-*) from the go/no-go gate.
 *
 * PURE: no LLM, no deps, no network. Dependency-free line parse of the baseline
 * (applies_to is inline `[a, b]`).
 *
 * WI-06 / INV-16 (presentation-consistency Slice 4): `--render` emits the VERBATIM
 * operator-facing "which requirements apply to you" block — the applicable COUNT, the ids
 * grouped by track, the conflicting-requirements section (surfaced per CONVENTIONS §4, never
 * silently resolved), and the mobile-no-coverage gap line. This is DISTINCT from `--json`
 * (which the manifest consumes); the render is what the operator reads at scope-submission
 * step 7. The same compute-sci-style ENGINE-owns-skeleton / driver-pastes-verbatim contract.
 *
 * USAGE
 *   node applicable-requirements.mjs --elements managed-package,apex,lwc [--plugin <dir>] [--json|--render]
 *   node applicable-requirements.mjs --target <repo>            # reads manifest elements
 */
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalElementType } from './render-detected-elements.mjs'

/**
 * Dependency-free parse: [{ id, applies_to:[...], verification, conflicts }] from the
 * baseline YAML. `verification` + `conflicts` (a folded `>` block scalar, flattened to one
 * line) are additive (0.8.25, WI-16) — used by `renderApplicable` to surface conflicting
 * entries; the legacy `{ id, applies_to }` shape is preserved (extra fields only).
 */
export function parseBaselineApplies(yamlText) {
  const out = []
  let cur = null
  let collecting = null // collecting the lines of a `conflicts: >` folded block scalar
  const flush = () => {
    if (cur && collecting) cur.conflicts = collecting.join(' ').replace(/\s+/g, ' ').trim()
    collecting = null
  }
  for (const raw of String(yamlText == null ? '' : yamlText).split('\n')) {
    // Inside a `conflicts: >` block: a blank line OR a 3+-space-indented line continues it;
    // a 2-space key or a new `- id:` ends it (the entry-field indent is 2 spaces).
    if (collecting) {
      if (raw.trim() === '' || /^\s{3,}\S/.test(raw)) { collecting.push(raw.trim()); continue }
      flush() // block ended — fall through and parse this line normally
    }
    const idm = raw.match(/^- id:\s*(\S+)/)
    if (idm) {
      cur = { id: idm[1], applies_to: [], verification: '', conflicts: '' }
      out.push(cur)
      continue
    }
    if (!cur) continue
    const am = raw.match(/^\s+applies_to:\s*\[([^\]]*)\]/)
    if (am) { cur.applies_to = am[1].split(',').map((s) => s.trim()).filter(Boolean); continue }
    const vm = raw.match(/^  verification:\s*(\S+)/)
    if (vm) { cur.verification = vm[1]; continue }
    const cb = raw.match(/^  conflicts:\s*([>|])\s*$/) // folded/literal block scalar
    if (cb) { collecting = []; continue }
    const ci = raw.match(/^  conflicts:\s*(\S.*)$/) // an inline (single-line) conflicts value
    if (ci) { cur.conflicts = ci[1].trim(); continue }
  }
  flush()
  return out
}

/** Pure applicability: a req applies iff applies_to has `all` or intersects elements. */
export function computeApplicable(entries, elementTypes) {
  // Canonicalize HERE — the single chokepoint every caller flows through (the CLI
  // manifest path, the `--elements` arg path, and renderApplicable), so no input site
  // can reintroduce a raw synonym. Lowercase BEFORE aliasing so the gate's existing
  // case-insensitivity extends to synonyms; an unrecognized type passes through
  // unchanged (it can never spuriously ADD requirements), and a canonical type is the
  // helper's identity, so a canonical scope computes exactly what it always did.
  const els = new Set((elementTypes || []).map((e) => canonicalElementType(String(e).toLowerCase())))
  const applicable = []
  for (const r of entries) {
    const at = (r.applies_to || []).map((x) => String(x).toLowerCase())
    if (at.includes('all') || at.some((t) => els.has(t))) applicable.push(r.id)
  }
  return applicable
}

// ---------------------------------------------------------------------------
// WI-06 / INV-16 — the VERBATIM applicable-requirements presentation (Slice 4).
// The output-class analog of the gate-spec engine: the ENGINE owns the block SKELETON,
// the driver pastes it byte-for-byte into scope-submission Step 7. DISTINCT from `--json`
// (which the manifest's `applicableBaselineIds` consumes) — this is the operator-facing read.
// ---------------------------------------------------------------------------

const cell = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim() || '—'
// A requirement's "track" is its stable id prefix (the segment before the first '-').
const trackOf = (id) => String(id || '').split('-')[0] || '(untracked)'

/**
 * Pure: the parsed baseline entries + the detected element types → the fixed applicable-
 * requirements block. Empty elements → an honest "scope not computed yet" line (never a
 * table off only the `all`-gated set, which would read as a real scope). Surfaces every
 * applicable `conflicting` entry with its conflicts text and the mobile-no-coverage gap.
 */
export function renderApplicable(entries, elementTypes) {
  const list = Array.isArray(entries) ? entries : []
  const total = list.length
  const els = (Array.isArray(elementTypes) ? elementTypes : []).map((e) => String(e).trim()).filter(Boolean)

  if (!els.length) {
    return [
      '### Applicable requirements',
      '',
      'Scope not computed yet: no architecture elements detected. Run ' +
        '`/sf-security-review-toolkit:scope-submission` step 2 (element detection) first — applicability is a ' +
        'PURE function of the detected elements (`applies_to` ∩ elements, plus every `all`-gated entry), ' +
        'never an estimate.',
    ].join('\n')
  }

  const applicableIds = computeApplicable(list, els)
  const byId = new Map(list.map((e) => [e.id, e]))
  const N = applicableIds.length

  // Group by track (id prefix), tracks alphabetical, ids alphabetical — fixed every run.
  const tracks = new Map()
  for (const id of applicableIds) {
    const t = trackOf(id)
    if (!tracks.has(t)) tracks.set(t, [])
    tracks.get(t).push(id)
  }
  const trackNames = [...tracks.keys()].sort()

  const L = [`### Applicable requirements — ${N} of ${total}`, '']
  L.push(`**Architecture elements:** ${cell(els.join(', '))}`)
  L.push('')
  L.push('| Track | Count | Requirement ids |')
  L.push('|---|---|---|')
  for (const t of trackNames) {
    const ids = [...tracks.get(t)].sort()
    L.push(`| ${cell(t)} | ${ids.length} | ${cell(ids.join('; '))} |`)
  }
  L.push('')

  // Conflicting requirements — surfaced, never silently resolved (CONVENTIONS §4).
  const conflicting = applicableIds.map((id) => byId.get(id)).filter((e) => e && e.verification === 'conflicting')
  if (conflicting.length) {
    L.push(
      `**Conflicting requirements (${conflicting.length})** — confirm via Partner Console / your Partner ` +
        'Account Manager / partner Slack before relying on these; never silently resolved (CONVENTIONS §4):'
    )
    for (const e of conflicting) L.push(`- ${cell(e.id)}${e.conflicts ? ` — ${cell(e.conflicts)}` : ''}`)
    L.push('')
  }

  // Mobile gap — a mobile element has NO baseline coverage (scope-submission step 7).
  if (els.map((e) => e.toLowerCase()).includes('mobile')) {
    L.push(
      '**Mobile gap:** a `mobile` element is in scope, but the baseline has NO mobile-app coverage — record ' +
        "the gap and follow Salesforce's mobile-app review guidance; the toolkit does not audit mobile."
    )
    L.push('')
  }

  L.push(
    `The applicable count is the EXACT length of this list (${N}) by construction — never an estimate; a count ` +
      `exceeding the baseline total (${total}) would be a counting bug, not a result.`
  )
  return L.join('\n')
}

function main() {
  const arg = (flag, def) => {
    const i = process.argv.indexOf(flag)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
  }
  const PLUGIN = arg('--plugin', fileURLToPath(new URL('..', import.meta.url)))
  const TARGET = arg('--target', process.cwd())
  const AS_JSON = process.argv.includes('--json')
  const baselineText = readFileSync(join(PLUGIN, 'baseline', 'requirements-baseline.yaml'), 'utf8')
  const entries = parseBaselineApplies(baselineText)

  let elements = []
  const elArg = arg('--elements', null)
  if (elArg) {
    elements = elArg.split(',').map((s) => s.trim()).filter(Boolean)
  } else {
    try {
      const m = JSON.parse(readFileSync(join(TARGET, '.security-review', 'scope-manifest.json'), 'utf8'))
      elements = (m.elements || []).map((e) => e.type)
    } catch { elements = [] }
  }

  const applicable = computeApplicable(entries, elements)
  const result = { elements, total_baseline: entries.length, applicable_count: applicable.length, applicableBaselineIds: applicable }
  if (process.argv.includes('--render')) {
    process.stdout.write(renderApplicable(entries, elements) + '\n')
  } else if (AS_JSON) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  } else {
    process.stdout.write(
      `Applicable requirements: ${applicable.length}/${entries.length}\n` +
        `Elements: ${elements.join(', ') || '(none)'}\n`
    )
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

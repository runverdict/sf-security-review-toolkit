#!/usr/bin/env node
/*
 * render-detected-elements.mjs — the VERBATIM detected-architecture-elements summary
 * (WI-06 / INV-15, presentation-consistency Slice 4). The output-class analog of the
 * gate-spec engine: the ENGINE owns the table SKELETON, the driver pastes it byte-for-byte
 * into scope-submission Step 2 (the element-detection summary).
 *
 * WHY THIS EXISTS. The detected-elements summary was driver-improvised prose — the
 * architecture elements shown as a table one run and a bullet list the next, the evidence
 * (the operator's "I can dispute this" provenance) dropped, the listing type omitted.
 * Scope is the most expensive thing to get wrong in the whole journey: an element you fail
 * to surface is a dimension that silently never runs. So the summary must be fixed — the
 * operator sees the SAME table every run and only the DATA varies.
 *
 * It reads scope-submission's scope-manifest.json:
 *   { listingType, listingDirection, elements: [ { type, evidence } ] }
 * and emits ONE fixed Markdown block: a `listingType` line + a FIXED-column table
 *   | Element | Detected how (evidence) |
 * with the elements in a CANONICAL element order (unknown types appended in manifest
 * order, never dropped), each row carrying the manifest's per-element `evidence` string
 * (the provenance the operator disputes). An element with no recorded evidence renders an
 * honest "(no evidence recorded — dispute this)" cell, never a blank that reads as detected-
 * without-basis.
 *
 * DETERMINISTIC + PURE (CONVENTIONS §7): same manifest in → byte-identical block out. No
 * LLM, no network, no deps, no Date/Math.random. A missing/unreadable/non-JSON manifest, or
 * one with no elements → an honest "scope not detected yet" one-liner, never a crash and
 * never a fabricated element table.
 *
 * USAGE:
 *   node render-detected-elements.mjs --target <repo>      # reads .security-review/scope-manifest.json
 *   node render-detected-elements.mjs --input <file.json>  # reads an explicit JSON file
 */
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The canonical element print order (mirrors scope-submission Step 2's detection table +
// the Direction A/B classifier). Frozen so the skeleton is fixed run-to-run; any element
// type NOT in this list is appended after, in manifest order, so nothing is ever dropped.
export const CANONICAL_ELEMENT_ORDER = Object.freeze([
  'managed-package',
  'agentforce',
  'mcp-server',
  'mcp-client-integration',
  'apex',
  'lwc',
  'aura',
  'canvas',
  'external-endpoint',
  'named-credential',
  'csp-trusted-site',
  'async-workers',
  'identity-surface',
  'mobile',
])

// Flatten a cell value to a single safe Markdown-table cell: collapse whitespace/newlines
// to spaces and escape pipes, so a multi-line `evidence` can never break the table or vary
// the rendering. Empty → an em dash so every cell is always filled.
function cell(v) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()
  return s || '—'
}

/** Pure: the scope-manifest JSON (or null) → the fixed detected-elements block. */
export function renderDetectedElements(manifest) {
  const els =
    manifest && typeof manifest === 'object' && Array.isArray(manifest.elements)
      ? manifest.elements.filter((e) => e && typeof e === 'object' && e.type)
      : []

  if (!els.length) {
    return [
      '### Detected architecture elements',
      '',
      'Scope not detected yet: no readable `.security-review/scope-manifest.json` with architecture ' +
        'elements. Run `/sf-security-review-toolkit:scope-submission` step 2 (element detection) first — ' +
        'an element you fail to detect is a dimension that silently never runs, so nothing downstream ' +
        'audits it.',
    ].join('\n')
  }

  // Stable canonical sort: known types in CANONICAL_ELEMENT_ORDER, unknown types appended in
  // manifest order. The original index is the final tiebreak, so a manifest that lists the
  // same type twice keeps a deterministic order.
  const rank = (type) => {
    const i = CANONICAL_ELEMENT_ORDER.indexOf(String(type))
    return i >= 0 ? i : CANONICAL_ELEMENT_ORDER.length
  }
  const ordered = els
    .map((e, i) => ({ e, i }))
    .sort((a, b) => rank(a.e.type) - rank(b.e.type) || a.i - b.i)
    .map((x) => x.e)

  const listingType = manifest.listingType ? String(manifest.listingType) : '(not recorded)'
  const L = ['### Detected architecture elements', '']
  L.push(`**Listing type:** ${cell(listingType)}`)
  L.push('')
  L.push('| Element | Detected how (evidence) |')
  L.push('|---|---|')
  for (const e of ordered) {
    const evidence = e.evidence ? cell(e.evidence) : '(no evidence recorded — dispute this)'
    L.push(`| ${cell(e.type)} | ${evidence} |`)
  }
  L.push('')
  L.push(
    `${ordered.length} element(s) detected. Dispute any row by re-running ` +
      '`/sf-security-review-toolkit:scope-submission` step 2 — the evidence column is the operator-facing ' +
      'provenance, and an under-detected element drops its whole audit dimension silently.'
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
      data = null // absent / unreadable / non-JSON → the honest one-liner, never a crash
    }
  }
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ block: renderDetectedElements(data) }, null, 2) + '\n')
  } else {
    process.stdout.write(renderDetectedElements(data) + '\n')
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

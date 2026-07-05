#!/usr/bin/env node
/*
 * render-target-map.mjs — the VERBATIM audit target-map approval display (WI-04 /
 * INV-12, presentation-consistency Slice 3). The output-class analog of the gate-spec
 * engine: the ENGINE owns the table SKELETON, the driver pastes it byte-for-byte into
 * the ONE pre-fan-out approval `AskUserQuestion` (audit-codebase Step 3).
 *
 * WHY THIS EXISTS. The target-map approval display was driver-improvised prose — the
 * resolved dimensions shown as a table one run and a bullet list the next, columns
 * reordered, the N/A reasons dropped. That is the single cheap moment to course-correct
 * before the audit fans out across the whole codebase, so its presentation must be
 * fixed: the operator should see the SAME table every run and only the DATA varies.
 *
 * It reads `build-audit-engine.mjs`'s target-map.json:
 *   { pass, generated, tier, dimensions: [
 *       { key, applicable:true,  targets:[...], stack_notes, confidence, unresolved },
 *       { key, applicable:false, na_reason } ] }
 * and emits ONE fixed Markdown block: a header line + a FIXED-column table
 *   | Dimension | Applicable | Targets | Why | Confidence | Unresolved |
 * with APPLICABLE rows FIRST (then N/A), each group in FILE ORDER, and a closing
 * one-line summary that surfaces the UNRESOLVED count (the thing to fix before launch).
 *
 * DETERMINISTIC + PURE (CONVENTIONS §7): same JSON in → byte-identical block out. No
 * LLM, no network, no deps, no Date/Math.random. A missing/unreadable/non-JSON source →
 * an honest "target map not resolved yet" one-liner, never a crash and never a fake map.
 *
 * USAGE:
 *   node render-target-map.mjs --target <repo>      # reads .security-review/target-map.json
 *   node render-target-map.mjs --input <file.json>  # reads an explicit JSON file
 */
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { knownDimensionKeys } from './dimension-registry.mjs'

// Flatten a cell value to a single safe Markdown-table cell: collapse whitespace/newlines
// to spaces and escape pipes, so a multi-line `stack_notes` can never break the table or
// vary the rendering. Empty → an em dash so every cell is always filled.
function cell(v) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()
  return s || '—'
}

/**
 * Pure: the target-map JSON (or null) → the fixed target-map approval block.
 * `knownKeys` (optional Set — the dimension-registry basenames): when provided,
 * dimension keys outside the canonical set are called out in the closing summary —
 * the display belt for a HAND-WRITTEN target-map.json that bypassed the engine gate
 * (the audit-codebase skill grants the driver a Write on target-map.json). Belt,
 * not gate: the table still renders, nothing throws (TM3 fail-safe holds). Default
 * null → byte-identical output for every existing caller.
 */
export function renderTargetMap(data, knownKeys = null) {
  const ok = data && typeof data === 'object' && Array.isArray(data.dimensions)
  if (!ok) {
    return [
      '### Audit target map (pre-fan-out approval)',
      '',
      'Target map not resolved yet: no readable `.security-review/target-map.json`. Resolve the ' +
        'dimensions first (`/sf-security-review-toolkit:audit-codebase` Step 3) — the audit fan-out ' +
        'fails closed without a recorded map, so nothing is audited until this exists and is approved.',
    ].join('\n')
  }

  const pass = Number.isInteger(data.pass) ? data.pass : '?'
  const tier = data.tier ? String(data.tier) : 'unknown-tier'
  const generated = data.generated ? String(data.generated) : '(date not recorded)'

  // Partition: applicable rows FIRST, then N/A — each group preserved in FILE ORDER.
  const dims = data.dimensions
  const applicable = dims.filter((d) => d && d.applicable === true)
  const na = dims.filter((d) => d && d.applicable !== true)

  const L = [`### Audit target map — pass ${pass} (${tier}), generated ${generated}`, '']
  L.push('| Dimension | Applicable | Targets | Why | Confidence | Unresolved |')
  L.push('|---|---|---|---|---|---|')

  let unresolvedCount = 0
  for (const d of applicable) {
    const targets = Array.isArray(d.targets) ? d.targets.filter(Boolean) : []
    const isUnresolved = d.unresolved === true || targets.length === 0
    if (isUnresolved) unresolvedCount++
    L.push(
      `| ${cell(d.key)} | ✓ | ${targets.length ? cell(targets.join('; ')) : '⚠ none resolved'} | ` +
        `${cell(d.stack_notes)} | ${cell(d.confidence || 'high')} | ${isUnresolved ? '⚠ yes' : '—'} |`
    )
  }
  for (const d of na) {
    L.push(`| ${cell(d.key)} | — (N/A) | — | ${cell(d.na_reason)} | — | — |`)
  }
  L.push('')

  // Closing summary — surfaces the one thing to fix before launch: an UNRESOLVED applicable
  // dimension is FALSE coverage (worse than no audit), so it is called out explicitly.
  let sum =
    `${applicable.length} applicable, ${na.length} N/A.` +
    (unresolvedCount
      ? ` ⚠ ${unresolvedCount} applicable dimension(s) UNRESOLVED (no targets) — point the audit at the code ` +
        `or confirm N/A BEFORE approving; a skipped dimension is false coverage.`
      : ' All applicable dimensions have resolved targets.') +
    ' This is the one cheap moment to correct the scope before the fan-out audits the whole codebase.'
  // Unknown-key belt (0.8.82): with a registry Set, flag keys outside the canonical
  // dimension set — a hand-written map's bogus key is NOT coverage. Never throws.
  if (knownKeys instanceof Set) {
    const unknown = [...new Set(dims.filter(Boolean).map((d) => d.key).filter((k) => !knownKeys.has(k)))]
    if (unknown.length) {
      sum +=
        ` ⚠ ${unknown.length} unknown dimension key(s): ` +
        `${unknown.map((k) => cell(k)).join(', ')} — not in the canonical set ` +
        '(methodology/dimensions/*.md); an unknown key is NOT audit coverage — fix it before approving.'
    }
  }
  L.push(sum)
  return L.join('\n')
}

function main() {
  const arg = (flag, def) => {
    const i = process.argv.indexOf(flag)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
  }
  const target = arg('--target', null)
  const input = arg('--input', null)
  const path = input || (target ? join(target, '.security-review', 'target-map.json') : null)
  let data = null
  if (path) {
    try {
      data = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      data = null // absent / unreadable / non-JSON → the honest one-liner, never a crash
    }
  }
  // Registry belt: the plugin root is this file's parent dir (harness/..). A failed
  // registry read degrades to null (no unknown-key check) — the render NEVER crashes.
  let knownKeys = null
  try { knownKeys = knownDimensionKeys(fileURLToPath(new URL('..', import.meta.url))) } catch { knownKeys = null }
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ block: renderTargetMap(data, knownKeys) }, null, 2) + '\n')
  } else {
    process.stdout.write(renderTargetMap(data, knownKeys) + '\n')
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

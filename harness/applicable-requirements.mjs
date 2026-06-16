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
 * PURE: no LLM, no deps, no network. Dependency-free line parse of the baseline
 * (applies_to is inline `[a, b]`).
 *
 * USAGE
 *   node applicable-requirements.mjs --elements managed-package,apex,lwc [--json]
 *   node applicable-requirements.mjs --target <repo>            # reads manifest elements
 */
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Dependency-free parse: [{ id, applies_to: [...] }] from the baseline YAML. */
export function parseBaselineApplies(yamlText) {
  const out = []
  let cur = null
  for (const raw of yamlText.split('\n')) {
    const idm = raw.match(/^- id:\s*(\S+)/)
    if (idm) {
      cur = { id: idm[1], applies_to: [] }
      out.push(cur)
      continue
    }
    if (!cur) continue
    const am = raw.match(/^\s+applies_to:\s*\[([^\]]*)\]/)
    if (am) {
      cur.applies_to = am[1].split(',').map((s) => s.trim()).filter(Boolean)
    }
  }
  return out
}

/** Pure applicability: a req applies iff applies_to has `all` or intersects elements. */
export function computeApplicable(entries, elementTypes) {
  const els = new Set((elementTypes || []).map((e) => String(e).toLowerCase()))
  const applicable = []
  for (const r of entries) {
    const at = (r.applies_to || []).map((x) => String(x).toLowerCase())
    if (at.includes('all') || at.some((t) => els.has(t))) applicable.push(r.id)
  }
  return applicable
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
  if (AS_JSON) {
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

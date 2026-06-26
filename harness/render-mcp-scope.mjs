#!/usr/bin/env node
/*
 * render-mcp-scope.mjs — the VERBATIM MCP listing-direction / auth-profile (INV-43) and
 * live-probe-result (INV-44) renders (WI-06, presentation-consistency Slice 4). The
 * output-class analog of the gate-spec engine: the ENGINE owns the block SKELETON, the
 * driver pastes it byte-for-byte into scope-submission Step 2 (the Direction A/B classifier)
 * and Step 3 (the live MCP probe).
 *
 * WHY THIS EXISTS. Two surfaces drifted run-to-run. (1) The MCP auth profile was narrated,
 * and inbound vs outbound MCP have OPPOSITE auth rules — a single merged "MCP auth" line
 * emits contradictory guidance, the costly analysis error the manifest's `listingDirection`
 * + `authExpectations` exist to prevent. (2) The live-probe result was sometimes presented
 * as probed when it was recorded-from-code, the exact HAVE-without-evidence lie CONVENTIONS
 * §2 forbids. This pins both: the profile FIELDS are rendered straight from the manifest's
 * `mcp.authExpectations` (rendered, NOT re-derived — the manifest already resolved the rule
 * set), and `probed:false` is rendered as an explicit "recorded from code, not live-probed"
 * status, never as a probe result.
 *
 * It reads scope-submission's scope-manifest.json:
 *   { listingDirection: "B" | "A" | "both",
 *     mcp: { url, probed, protocolVersion, toolCount, authType, transport,
 *            authExpectations: { direction, clientCredentialsAllowed, ecaRequired,
 *                                pkceRequired, perUserAuthSupported, requiredScopes[], note } } }
 *
 * Two fixed sections (rendered separately or together):
 *   - DIRECTION (INV-43): a `listingDirection` caption + a FIXED table of the
 *     `authExpectations` rule fields (rendered, never re-derived). No authExpectations →
 *     an honest "auth profile not recorded" line, never a fabricated profile.
 *   - PROBE (INV-44): a probe-status line (probed true → "live-probed <url>"; probed false →
 *     "recorded from code, NOT live-probed") + a FIXED table of the recorded MCP facts.
 * When no MCP surface is in scope (no `mcp` block, no `listingDirection`, no mcp element)
 * each section renders an honest "no MCP surface in scope" line.
 *
 * DETERMINISTIC + PURE (CONVENTIONS §7): same manifest in → byte-identical block out. No
 * LLM, no network, no deps, no Date/Math.random. A missing/unreadable/non-JSON manifest → the
 * honest no-MCP lines, never a crash and never a fabricated probe.
 *
 * USAGE:
 *   node render-mcp-scope.mjs --target <repo> [--section direction|probe]
 *   node render-mcp-scope.mjs --input <file.json> [--section direction|probe]
 *   (no --section → BOTH sections; --json → { block })
 */
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The fixed caption per listing direction. The CAPTION is a label; the rule VALUES come from
// `authExpectations` (rendered, not re-derived) — never collapse inbound and outbound.
const DIRECTION_CAPTION = Object.freeze({
  B: 'B — outbound MCP server (the common ISV case: Agentforce / an external agent calls INTO the partner\'s own server).',
  A: 'A — inbound MCP client integration (the partner ALSO calls a Salesforce-hosted MCP server).',
  both: 'both — outbound server AND inbound client. BOTH auth profiles apply; never collapse them into one.',
})

// The canonical authExpectations field order — frozen so the profile table is fixed run-to-run.
const AUTH_FIELDS = Object.freeze([
  'clientCredentialsAllowed',
  'ecaRequired',
  'pkceRequired',
  'perUserAuthSupported',
  'requiredScopes',
])

const cell = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim() || '—'

// Render a single auth-field value honestly: a recorded boolean as true/false, a scopes array
// joined (empty → "(none)"), null/undefined → "(not recorded)" (never silently rendered true).
function authValue(key, ae) {
  if (!Object.prototype.hasOwnProperty.call(ae, key)) return '(not recorded)'
  const v = ae[key]
  if (key === 'requiredScopes') {
    if (!Array.isArray(v)) return v == null ? '(not recorded)' : cell(v)
    return v.length ? cell(v.join(', ')) : '(none)'
  }
  if (v === true || v === false) return String(v)
  if (v == null) return '(not recorded)'
  return cell(v)
}

// Is there any MCP surface in scope at all? (an `mcp` block, a `listingDirection`, or an
// mcp-* element type). If not, both sections say so honestly rather than fabricating one.
function hasMcpSurface(manifest) {
  if (!manifest || typeof manifest !== 'object') return false
  if (manifest.mcp && typeof manifest.mcp === 'object') return true
  if (manifest.listingDirection) return true
  const els = Array.isArray(manifest.elements) ? manifest.elements : []
  return els.some((e) => e && typeof e.type === 'string' && e.type.includes('mcp'))
}

const NO_MCP_DIRECTION = [
  '### MCP listing direction & auth profile',
  '',
  'No MCP surface in scope: the manifest records no `mcp` block, no `listingDirection`, and no ' +
    'MCP element. If the partner ships an MCP server or client integration, re-run ' +
    '`/sf-security-review-toolkit:scope-submission` step 2 (the Direction A/B classifier) — ' +
    'the MCP auth/transport track is silently absent until an MCP element is recorded.',
].join('\n')

/** Pure: the scope-manifest JSON (or null) → the fixed MCP direction & auth-profile block. */
export function renderMcpDirection(manifest) {
  if (!hasMcpSurface(manifest)) return NO_MCP_DIRECTION

  const dir = manifest.listingDirection ? String(manifest.listingDirection) : null
  const caption = dir && DIRECTION_CAPTION[dir] ? DIRECTION_CAPTION[dir] : null

  const L = ['### MCP listing direction & auth profile', '']
  if (caption) {
    L.push(`**Listing direction:** ${caption}`)
  } else if (dir) {
    L.push(`**Listing direction:** ${cell(dir)} (unrecognized — expected B, A, or both).`)
  } else {
    L.push(
      '**Listing direction:** not recorded — an MCP surface exists but the Direction A/B classifier ' +
        'has not run. Re-run scope-submission step 2; inbound and outbound MCP have OPPOSITE auth rules.'
    )
  }
  L.push('')

  const ae =
    manifest.mcp && typeof manifest.mcp === 'object' && manifest.mcp.authExpectations &&
    typeof manifest.mcp.authExpectations === 'object'
      ? manifest.mcp.authExpectations
      : null
  if (!ae) {
    L.push(
      'Auth rule profile not recorded: no `mcp.authExpectations` in the manifest. Re-run scope-submission ' +
        'step 2 — the toolkit renders the recorded profile, it does not invent one.'
    )
    return L.join('\n')
  }

  L.push('Auth rule profile (rendered from the manifest\'s `mcp.authExpectations` — recorded, not re-derived):')
  L.push('')
  L.push('| Auth profile field | Value |')
  L.push('|---|---|')
  for (const k of AUTH_FIELDS) L.push(`| ${k} | ${authValue(k, ae)} |`)
  L.push('')
  L.push(`_Note: ${ae.note ? cell(ae.note) : '(none recorded)'}_`)
  return L.join('\n')
}

const NO_MCP_PROBE = [
  '### MCP live-probe result',
  '',
  'No MCP surface in scope: the manifest records no `mcp` block — there is nothing to probe. If the ' +
    'partner serves the MCP protocol, re-run `/sf-security-review-toolkit:scope-submission` steps 2–3.',
].join('\n')

// The canonical recorded-MCP-fact field order — frozen so the probe table is fixed run-to-run.
const PROBE_FIELDS = Object.freeze([
  ['protocolVersion', 'protocolVersion'],
  ['toolCount', 'toolCount'],
  ['authType', 'authType'],
  ['transport', 'transport'],
])

/** Pure: the scope-manifest JSON (or null) → the fixed MCP live-probe-result block. */
export function renderMcpProbe(manifest) {
  const mcp =
    manifest && typeof manifest === 'object' && manifest.mcp && typeof manifest.mcp === 'object'
      ? manifest.mcp
      : null
  if (!mcp) return NO_MCP_PROBE

  const L = ['### MCP live-probe result', '']
  // The honesty crux: probed:true → a real handshake; anything else → recorded from code, NEVER
  // presented as a probe result. Default to NOT-probed when the flag is absent/falsey.
  if (mcp.probed === true) {
    L.push(`**Probe status:** live-probed${mcp.url ? ` ${cell(mcp.url)}` : ''} — the facts below are from a live handshake.`)
  } else {
    L.push(
      '**Probe status:** NOT live-probed — the MCP facts below were recorded from code, not from a live ' +
        'handshake; downstream skills re-probe (scope-submission step 3).'
    )
  }
  L.push('')
  L.push('| Field | Value |')
  L.push('|---|---|')
  for (const [label, key] of PROBE_FIELDS) {
    const v = Object.prototype.hasOwnProperty.call(mcp, key) && mcp[key] != null ? cell(mcp[key]) : '(not recorded)'
    L.push(`| ${label} | ${v} |`)
  }
  return L.join('\n')
}

/** Pure: both fixed MCP sections, direction then probe. */
export function renderMcpScope(manifest) {
  return renderMcpDirection(manifest) + '\n\n' + renderMcpProbe(manifest)
}

function main() {
  const arg = (flag, def) => {
    const i = process.argv.indexOf(flag)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
  }
  const target = arg('--target', null)
  const input = arg('--input', null)
  const section = arg('--section', null)
  const path = input || (target ? join(target, '.security-review', 'scope-manifest.json') : null)
  let data = null
  if (path) {
    try {
      data = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      data = null // absent / unreadable / non-JSON → the honest no-MCP lines, never a crash
    }
  }
  const out =
    section === 'direction' ? renderMcpDirection(data) : section === 'probe' ? renderMcpProbe(data) : renderMcpScope(data)
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ block: out }, null, 2) + '\n')
  } else {
    process.stdout.write(out + '\n')
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

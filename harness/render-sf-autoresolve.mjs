#!/usr/bin/env node
/*
 * render-sf-autoresolve.mjs — the VERBATIM SF-CLI auto-resolution render (WI-06 / INV-45,
 * presentation-consistency Slice 4). The output-class analog of the gate-spec engine: the
 * ENGINE owns the block SKELETON, the driver pastes it byte-for-byte into scope-submission
 * Step 4 (the optional DevHub Tooling auto-resolution).
 *
 * WHY THIS EXISTS. The auto-resolution readout was driver-improvised, and it carries the two
 * facts a reviewer scrutinizes hardest: the security FLAGS the Tooling scan surfaced (a
 * non-TLS host, a wildcard host, a callout host with no Named Credential — the signature of a
 * likely hardcoded secret, an over-grant on a packaged permission set) and the CONFLICTS
 * between the CLI's evidence and the operator's own answers. Both must be SURFACED, never
 * silently dropped or silently resolved: the CLI is evidence, not an override (SKILL step 4,
 * CONVENTIONS §4). This pins the readout — a fixed rows table, a fixed FLAGS section, a fixed
 * CONFLICTS section.
 *
 * It reads scope-submission's sf-autoresolve.json (gated on the manifest's `sfAutoResolved`):
 *   { generated, devhub?,
 *     rows:        [ { key, value, source, provenance:"automated" } ],
 *     endpoints:   [ { host, namedCredential, source } ],   // RemoteSiteSettings + CspTrustedSites
 *     permissions: [ { permissionSet, viewAllRecords, modifyAllData, source } ],
 *     flags?:      [ { type, detail, source } ],             // any pre-recorded flags (also surfaced)
 *     conflicts:   [ { field, operatorClaim, autoResolved, source } ] }
 *
 * Security flags are DERIVED deterministically from the endpoint inventory + permission matrix
 * (http:// non-TLS · wildcard host · host with no Named Credential · ViewAll/ModifyAll over-
 * grant) AND merged with any pre-recorded `flags`, deduped — so a flag the step recorded OR a
 * flag latent in the raw inventory is surfaced, never dropped.
 *
 * NEVER RENDERS A SECRET (CONVENTIONS §6). The file carries config, not secret values, by
 * contract — but the render defends in depth: a secret-named key or a token/JWT/high-entropy
 * value is redacted to a "[redacted — secret belongs in env var/vault]" cell, so the render
 * can NEVER introduce a secret into operator-facing output.
 *
 * DETERMINISTIC + PURE (CONVENTIONS §7): same inputs → byte-identical block out. No LLM, no
 * network, no deps, no Date/Math.random. `sfAutoResolved:false` / a missing/unreadable file →
 * an honest "auto-resolution skipped" one-liner, never a crash and never a fabricated result.
 *
 * USAGE:
 *   node render-sf-autoresolve.mjs --target <repo>     # reads .security-review/{sf-autoresolve,scope-manifest}.json
 *   node render-sf-autoresolve.mjs --input <file.json> [--manifest <scope-manifest.json>]
 */
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cell = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim() || '—'

const SKIPPED = [
  '### SF-CLI auto-resolution',
  '',
  'Auto-resolution skipped (no DevHub / no consent / no `sf`). The wizard inputs fall back to ' +
    'operator-asked / code-inferred values; scope-submission step 4 records `sfAutoResolved: false`. ' +
    'This is the common path — the DevHub Tooling auto-resolution is an optional power-up, never a blocker.',
].join('\n')

// Defense-in-depth secret guard (CONVENTIONS §6): a secret-named key or a token/JWT/high-entropy
// value is redacted so this render can NEVER echo a secret, even if the file mistakenly carried one.
const SECRET_KEY_RE = /secret|token|password|passwd|private[_-]?key|client[_-]?secret|api[_-]?key|bearer/i
const REDACTED = '[redacted — a secret belongs in an env var / vault, never a state file (CONVENTIONS §6)]'
function looksSecret(key, value) {
  if (SECRET_KEY_RE.test(String(key || ''))) return true
  const v = String(value == null ? '' : value)
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v)) return true // JWT
  if (/^[A-Za-z0-9+/]{32,}={0,2}$/.test(v)) return true // base64-ish blob
  if (/^[a-f0-9]{32,}$/i.test(v)) return true // long hex
  return false
}
function safeValue(key, value) {
  return looksSecret(key, value) ? REDACTED : cell(value)
}

// Derive the security flags deterministically from the endpoint inventory + permission matrix,
// then merge any pre-recorded `flags`. Each flag is { sev:'⚠', text }. Deduped by text so a flag
// recorded AND re-derived appears once. NEVER drops an over-grant or a non-TLS host.
export function deriveFlags(ar) {
  const flags = []
  const push = (text) => flags.push(text)
  const endpoints = Array.isArray(ar.endpoints) ? ar.endpoints : []
  for (const e of endpoints) {
    if (!e || typeof e !== 'object') continue
    const host = String(e.host || '')
    const src = e.source ? ` (${cell(e.source)})` : ''
    if (/^http:\/\//i.test(host)) push(`non-TLS (http://) host: ${cell(host)}${src} — plain HTTP for data transfer is prohibited`)
    if (host.includes('*')) push(`wildcard host: ${cell(host)}${src} — reviewers scrutinize wildcard callout scope`)
    const nc = e.namedCredential
    if (nc == null || nc === '' || nc === false) {
      push(`host with NO matching Named Credential: ${cell(host)}${src} — the signature of a likely hardcoded secret`)
    }
  }
  const perms = Array.isArray(ar.permissions) ? ar.permissions : []
  for (const p of perms) {
    if (!p || typeof p !== 'object') continue
    const ps = cell(p.permissionSet)
    if (p.viewAllRecords) push(`over-grant: permission set '${ps}' grants ViewAllRecords — the #1 authZ rejection category`)
    if (p.modifyAllData) push(`over-grant: permission set '${ps}' grants ModifyAllData — the #1 authZ rejection category`)
  }
  // Merge any pre-recorded flags (the step may record structured flags directly).
  const recorded = Array.isArray(ar.flags) ? ar.flags : []
  for (const f of recorded) {
    if (!f || typeof f !== 'object') continue
    const t = f.type ? `${cell(f.type)}: ${cell(f.detail)}` : cell(f.detail || f.text)
    const src = f.source ? ` (${cell(f.source)})` : ''
    push(`${t}${src}`)
  }
  // Dedupe by text, preserving first-seen order (derived flags before recorded duplicates).
  const seen = new Set()
  return flags.filter((t) => (seen.has(t) ? false : (seen.add(t), true)))
}

/**
 * Pure: { autoresolve, manifest } → the fixed SF-CLI auto-resolution block.
 * Gated on the manifest's `sfAutoResolved` flag: false / missing file → the honest skipped line.
 */
export function renderSfAutoResolve({ autoresolve, manifest } = {}) {
  const ar = autoresolve && typeof autoresolve === 'object' ? autoresolve : null
  const sfAutoResolved = manifest && typeof manifest === 'object' ? manifest.sfAutoResolved === true : null

  // Gate: the manifest says it did not run, OR there is no readable file → skipped line.
  if (sfAutoResolved === false || !ar) return SKIPPED

  const rows = Array.isArray(ar.rows) ? ar.rows.filter((r) => r && typeof r === 'object') : []
  const date = ar.generated ? cell(ar.generated) : '(date not recorded)'
  const devhub = ar.devhub ? ` · DevHub ${cell(ar.devhub)}` : ''

  const L = [`### SF-CLI auto-resolution — ${date}${devhub}`, '']
  L.push('Auto-resolved facts (provenance: automated — agent-run DevHub Tooling evidence, distinct from owner-run scans):')
  L.push('')
  L.push('| Key | Value | Source |')
  L.push('|---|---|---|')
  if (rows.length) {
    for (const r of rows) L.push(`| ${cell(r.key)} | ${safeValue(r.key, r.value)} | ${cell(r.source)} |`)
  } else {
    L.push('| — | (no auto-resolved rows recorded) | — |')
  }
  L.push('')

  // FLAGS — surfaced, never dropped.
  const flags = deriveFlags(ar)
  if (flags.length) {
    L.push(`**Security flags (${flags.length})** — surfaced from the endpoint inventory + permission matrix (never silently dropped):`)
    for (const t of flags) L.push(`- ⚠ ${t}`)
  } else {
    L.push('**Security flags:** none recorded — no non-TLS/wildcard/credential-less host and no ViewAll/ModifyAll over-grant in the resolved inventory.')
  }
  L.push('')

  // CONFLICTS — the CLI is evidence, not an override; the operator reconciles.
  const conflicts = Array.isArray(ar.conflicts) ? ar.conflicts.filter((c) => c && typeof c === 'object') : []
  if (conflicts.length) {
    L.push(
      `**Conflicts with operator answers (${conflicts.length})** — the CLI is EVIDENCE, not an override; the ` +
        'operator reconciles each (never silently substituted, CONVENTIONS §4):'
    )
    for (const c of conflicts) {
      const src = c.source ? ` [${cell(c.source)}]` : ''
      L.push(`- ${cell(c.field)}: operator said "${cell(c.operatorClaim)}" but auto-resolved ${cell(c.autoResolved)}${src}`)
    }
  } else {
    L.push('**Conflicts with operator answers:** none — no auto-resolved fact contradicts a recorded operator answer.')
  }
  return L.join('\n')
}

function main() {
  const arg = (flag, def) => {
    const i = process.argv.indexOf(flag)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
  }
  const target = arg('--target', null)
  const input = arg('--input', target ? join(target, '.security-review', 'sf-autoresolve.json') : null)
  const manifestPath = arg('--manifest', target ? join(target, '.security-review', 'scope-manifest.json') : null)
  const readJSON = (p) => {
    try {
      return JSON.parse(readFileSync(p, 'utf8'))
    } catch {
      return null
    }
  }
  const autoresolve = input ? readJSON(input) : null
  const manifest = manifestPath ? readJSON(manifestPath) : null
  const out = renderSfAutoResolve({ autoresolve, manifest })
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

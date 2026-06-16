#!/usr/bin/env node
/**
 * artifact-gate.mjs — the deterministic generate-artifacts gate (WI / G4).
 *
 * WHY THIS EXISTS. generate-artifacts carries a load-bearing honesty gate:
 * "if the ledger has any open critical/high finding, STOP — generating now
 * bakes the vulnerability into the documentation the reviewer will use as a
 * map," and its named corollary "when the operator elects continue-with-flags,
 * SKIP the AuthN/AuthZ artifact (it would describe a flow with a live,
 * unremediated auth hole)." A cold-start acceptance run proved that gate was
 * NARRATION living only in the journey's triage step: a resume that entered
 * generate-artifacts directly improvised past it and generated the very
 * AuthN/AuthZ doc the gate exists to prevent. A gate that is a story the
 * orchestrator tells when it happens to be driving is not a gate. This makes it
 * ENFORCED LOGIC that every entry path (fresh / resume / direct) must consult.
 *
 * PURE: reads only <target>/.security-review/{audit-ledger.json,
 * triage-decision.json}; no LLM, no deps, no network; byte-identical on re-run
 * for a fixed input. The open-finding + severity contract is identical to
 * compute-sci.mjs (kept in sync deliberately; see OPEN_STATES / sevOf).
 *
 * USAGE
 *   node artifact-gate.mjs --target <repo> [--json]
 *
 * OUTPUT (stdout, --json):
 *   {
 *     "mode": "clean" | "flagged" | "STOP",
 *     "proceed": boolean,
 *     "reason": string,
 *     "open": { "critical": n, "high": n },
 *     "open_authz_findings": [ "<id> (<dimension>)", ... ],
 *     "suppress": [ "authn-authz-flow", ... ],   // artifacts to withhold
 *     "election": "continue-with-flags" | "fix-first" | "stop" | null
 *   }
 *
 *   mode=clean   → no open critical/high; generate the full artifact set.
 *   mode=flagged → open critical/high AND a persisted continue-with-flags
 *                  election exists; generate, but WITHHOLD every artifact in
 *                  `suppress` (write a withheld-placeholder naming the open
 *                  finding instead).
 *   mode=STOP    → open critical/high and no election; do NOT generate. Route
 *                  back to remediation, or record a continue-with-flags election
 *                  at the triage gate first.
 */
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// --- open + severity contract (kept identical to compute-sci.mjs) -----------
const OPEN_STATES = new Set(['confirmed', 'regressed']) // not fixed/refuted/accepted_risk
const isOpen = (f) =>
  OPEN_STATES.has(String(f.status || '').toLowerCase()) ||
  (String(f.status || '').toLowerCase() === '' &&
    String(f.verdict || '').toLowerCase() === 'confirmed_real')
const sevOf = (f) => String(f.adjusted_severity || f.severity || '').toLowerCase()

// --- AuthN/AuthZ category dimensions ----------------------------------------
// Dimensions whose DEFAULT **OR SECONDARY** category is
// `authentication/session-management` or `authorization` per
// methodology/audit-methodology.md (the dimension→category map). The ledger
// stores `dimension`, not the synthesis-chosen category, so dimension is the
// only signal available here — therefore we include EVERY dimension that can
// resolve to an authN/authZ category, including via its secondary:
//   web-client      → secondary authentication/session-management (token storage)
//   package-metadata → secondary authorization (CSRF on instantiation)
// Over-inclusion here fails SAFE for an honesty gate (withhold a doc we could
// have drafted), whereas omission fails OPEN (draft an AuthN/AuthZ flow doc over
// a live token-custody or CSRF hole) — the exact failure the gate exists to
// prevent. An open CRITICAL/HIGH finding from any of these withholds the
// AuthN/AuthZ artifact under the continue-with-flags path (the publication-
// blocking threshold; a medium/low authz finding does not withhold — see below).
export const AUTHN_AUTHZ_DIMENSIONS = new Set([
  'oauth-identity',
  'mcp-surface',
  'mcp-threat-model',
  'tenant-isolation',
  'admin-surface',
  'background-jobs',
  'data-export',
  'agentforce-package',
  'apex-exposed-surface',
  'web-client', // secondary: authentication/session-management (token storage)
  'package-metadata', // secondary: authorization (CSRF on instantiation)
])

/**
 * Pure gate decision. `findings` = audit-ledger findings array; `triage` =
 * the parsed triage-decision.json (or null). No I/O — unit-testable.
 */
export function computeGate(findings, triage) {
  const all = Array.isArray(findings) ? findings : []
  const open = all.filter(isOpen)
  const openCritical = open.filter((f) => sevOf(f) === 'critical')
  const openHigh = open.filter((f) => sevOf(f) === 'high')
  const openBlocking = openCritical.length + openHigh.length
  // Only a CRITICAL/HIGH authN/authZ finding withholds the AuthN/AuthZ artifact —
  // the same publication-blocking threshold the gate uses to enter flagged mode.
  // A medium/low authz finding does not withhold (the doc generates and flags it
  // inline); otherwise an unrelated non-authz critical would make a medium authz
  // finding withhold the doc, and the placeholder would overstate a medium issue
  // as a publication-blocking auth hole.
  const openAuthz = open.filter(
    (f) =>
      (sevOf(f) === 'critical' || sevOf(f) === 'high') &&
      AUTHN_AUTHZ_DIMENSIONS.has(String(f.dimension || '').toLowerCase())
  )
  const election = triage && typeof triage.decision === 'string' ? triage.decision : null

  let mode, proceed, reason, suppress
  if (openBlocking === 0) {
    mode = 'clean'
    proceed = true
    reason = 'no open critical/high findings — generate the full artifact set'
    suppress = []
  } else if (election === 'continue-with-flags') {
    mode = 'flagged'
    proceed = true
    suppress = openAuthz.length ? ['authn-authz-flow'] : []
    reason =
      `continue-with-flags elected (triage-decision.json) over ${openCritical.length} open critical / ` +
      `${openHigh.length} open high — generate, but WITHHOLD: ${suppress.length ? suppress.join(', ') : '(none)'}` +
      (openAuthz.length
        ? `. The AuthN/AuthZ flow is withheld: ${openAuthz.length} open finding(s) sit in the authN/authZ category and the doc would map the live hole.`
        : '. No open critical/high finding is in the authN/authZ category, so the flow doc is not withheld.')
  } else {
    mode = 'STOP'
    proceed = false
    suppress = []
    reason =
      `${openCritical.length} open critical / ${openHigh.length} open high finding(s) and no continue-with-flags ` +
      `election — STOP. Generating now bakes the vulnerability into the documentation the reviewer uses as a map. ` +
      `Remediate and re-audit, or record a continue-with-flags election at the triage gate, then re-run.`
  }

  return {
    mode,
    proceed,
    reason,
    open: { critical: openCritical.length, high: openHigh.length },
    open_authz_findings: openAuthz.map((f) => `${f.id || '?'} (${f.dimension || '?'})`),
    suppress,
    election,
  }
}

// --- CLI (runs only when invoked directly, never on import) -----------------
function main() {
  const arg = (flag, def) => {
    const i = process.argv.indexOf(flag)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
  }
  const TARGET = arg('--target', process.cwd())
  const AS_JSON = process.argv.includes('--json')
  const SR = join(TARGET, '.security-review')
  const readJSON = (p, def) => {
    try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return def }
  }
  const ledger = readJSON(join(SR, 'audit-ledger.json'), { findings: [] })
  const triage = readJSON(join(SR, 'triage-decision.json'), null)
  const result = computeGate(ledger.findings, triage)

  if (AS_JSON) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  } else {
    process.stdout.write(
      `ARTIFACT GATE: ${result.mode}\n` +
        `- ${result.reason}\n` +
        `- Open: ${result.open.critical} critical · ${result.open.high} high` +
        (result.open_authz_findings.length ? ` · ${result.open_authz_findings.length} in authN/authZ category` : '') +
        `\n` +
        (result.suppress.length ? `- Withhold: ${result.suppress.join(', ')}\n` : '') +
        `- Election: ${result.election || '(none recorded)'}\n`
    )
  }
}

// Compare RESOLVED real paths so a symlinked invocation still runs main()
// (import.meta.url resolves the real target while argv[1] may stay the symlink).
function invokedDirectly() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
  } catch {
    return fileURLToPath(import.meta.url) === process.argv[1]
  }
}
if (invokedDirectly()) main()

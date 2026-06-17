#!/usr/bin/env node
/**
 * artifact-gate.mjs — the deterministic generate-artifacts gate (WI / G4).
 *
 * WHY THIS EXISTS. The toolkit is an AUDIT tool: it always produces the full
 * report, even when findings are open — it never pauses to fix and never blocks
 * the report behind a human "fix-or-flags" election. But there is one honesty
 * line it will not cross: it will NOT generate the AuthN/AuthZ flow document
 * while an open critical/high finding sits in the authentication/authorization
 * category, because that doc would map a live, unremediated auth hole for the
 * reviewer. That withhold used to be NARRATION in the journey's triage step (a
 * cold-start run improvised past it on a resume) AND it was gated behind a
 * persisted continue-with-flags election (a missing/other election skipped it).
 * This makes the withhold ENFORCED LOGIC that fires purely from the ledger, on
 * every entry path (fresh / resume / direct) — no election, no STOP, no
 * orchestrator memory required.
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
 *     "mode": "clean" | "flagged",
 *     "proceed": boolean,
 *     "reason": string,
 *     "open": { "critical": n, "high": n },
 *     "open_authz_findings": [ "<id> (<dimension>)", ... ],
 *     "suppress": [ "authn-authz-flow", ... ],   // artifacts to withhold
 *     "election": <informational only, echoed from triage-decision.json if present> | null
 *   }
 *
 *   mode=clean   → no open critical/high; generate the full artifact set.
 *   mode=flagged → open critical/high; generate the full NOT-READY report with
 *                  the findings carried forward verbatim, but WITHHOLD every
 *                  artifact in `suppress` (write a withheld-placeholder naming
 *                  the open finding instead). The toolkit is an audit tool — it
 *                  always reports, never STOPs, never pauses to fix; the only
 *                  thing it withholds is the AuthN/AuthZ flow over an open
 *                  authN/authZ critical/high (it won't map a live hole).
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
// resolve to an authN/authZ category, by default or secondary:
//   sessionid-egress → authentication/session-management (a leaked SessionId is a
//                      bearer credential for the org session — the review's named
//                      auto-fail class; added 0.5.2 after an adversarial pass
//                      caught the AuthN/AuthZ doc generating over a live
//                      token-egress hole)
//   web-client       → secondary authentication/session-management (token storage)
//   package-metadata → secondary authorization (CSRF on instantiation)
//   crypto-internals → secondary authentication (JWT verification: algorithm
//                      pinning + iss/aud/exp claim validation — a broken verify
//                      IS an authentication hole; surfaced by the 0.5.1 grade)
// Inclusion is by DEFECT CATEGORY, not blast-radius. Deliberately EXCLUDED:
// `injection-xss` (the defect is output-encoding even if a payload could steal a
// session) and `secrets-credentials` (defect is secrets-storage; a leaked secret
// that happens to be an auth credential is a blast-radius argument, and the
// dimension can't tell an auth key from a Stripe key — the JWT-verify case is
// already covered by crypto-internals via its own defect category).
// Over-inclusion here fails SAFE for an honesty gate (withhold a doc we could
// have drafted), whereas omission fails OPEN (draft an AuthN/AuthZ flow doc over
// a live auth hole) — the exact failure the gate exists to prevent. An open
// CRITICAL/HIGH finding from any of these withholds the AuthN/AuthZ artifact
// (the publication-blocking threshold; a medium/low authz finding does not
// withhold — see below). The match trims+lowercases the dimension so a stray
// serialization whitespace can't silently drop the withhold. NOTE: the gate
// expects the toolkit's CANONICAL status/severity vocabulary (confirmed/regressed
// + critical/high/…); it does not invent synonyms ('open') or parse non-string
// severities (a CVSS number) — those aren't produced by the toolkit, and handling
// them would mask a real upstream finder bug.
export const AUTHN_AUTHZ_DIMENSIONS = new Set([
  'oauth-identity',
  'sessionid-egress', // a leaked SessionId is a bearer credential = authentication (the review's named auto-fail class)
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
  'crypto-internals', // secondary: authentication (JWT verification — alg pinning + iss/aud/exp claim validation)
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
      AUTHN_AUTHZ_DIMENSIONS.has(String(f.dimension || '').trim().toLowerCase())
  )
  // The election (if any) is INFORMATIONAL ONLY now — echoed for the audit trail,
  // never consulted for the decision. An audit tool always produces the full
  // report; the gate is a pure function of the ledger.
  const election = triage && typeof triage.decision === 'string' ? triage.decision : null

  let mode, proceed, reason, suppress
  if (openBlocking === 0) {
    mode = 'clean'
    proceed = true
    reason = 'no open critical/high findings — generate the full artifact set'
    suppress = []
  } else {
    // Audit-only: ALWAYS generate the full (NOT-READY) report with the open
    // findings carried forward verbatim — never STOP, never pause to fix. The
    // ONLY artifact withheld is the AuthN/AuthZ flow, and only when an open
    // critical/high sits in the authN/authZ category (generating it would map a
    // live, unremediated auth hole). The withhold fires purely from the ledger —
    // it does NOT depend on a human election, which closes the bypass where a
    // missing/non-continue-with-flags election skipped it.
    mode = 'flagged'
    proceed = true
    suppress = openAuthz.length ? ['authn-authz-flow'] : []
    reason =
      `${openCritical.length} open critical / ${openHigh.length} open high finding(s) — generating the full ` +
      `NOT-READY report with the findings carried forward verbatim` +
      (openAuthz.length
        ? `; AuthN/AuthZ flow WITHHELD (${openAuthz.length} open finding(s) in the authN/authZ category would map a live hole).`
        : `; no open critical/high in the authN/authZ category, so the AuthN/AuthZ flow is not withheld.`)
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

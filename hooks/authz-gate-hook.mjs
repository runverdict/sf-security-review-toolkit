#!/usr/bin/env node
/**
 * authz-gate-hook.mjs — PreToolUse hook: runtime-independent enforcement of the
 * AuthN/AuthZ withhold (G4). Defense-in-depth ON TOP OF the generate-artifacts
 * skill gate — so the withhold holds even if a resume/refactor/direct write tries
 * to author the doc without consulting the skill.
 *
 * IDENTITY / CONSENT. This hook is shipped by the plugin (so it loads on enable),
 * but it is a NO-OP unless TWO conditions hold, so it never touches the partner's
 * normal work and never blocks anything without an informed opt-in:
 *   1. PATH-SCOPED — it only ever acts on a write to the toolkit's OWN artifact
 *      (`docs/security-review/authn-authz-flow.md`). Every other Write/Edit the
 *      partner makes exits immediately (allow), so the partner's unrelated work is
 *      never intercepted.
 *   2. CONSENT-FLAGGED — even for that artifact, it does nothing unless the
 *      operator opted in by creating `<repo>/.security-review/hook-armed` (the
 *      journey's "enable the enforcement hook?" yes writes it; disarm = delete it).
 * So it is NOT auto-ship-blocking: enabling the plugin only activates a
 * transparent, path-scoped no-op; the blocking requires the explicit armed flag.
 * Framed honestly: defense-in-depth the human opts into, NOT structural
 * impossibility (they own whether the plugin is enabled and whether the flag is set).
 *
 * DENY MECHANISM (verified against current Claude Code hook docs, 2026-06): a
 * PreToolUse hook denies by exit 0 + a JSON `hookSpecificOutput` with
 * `permissionDecision: "deny"` — NOT exit 2 (that is for other hook events).
 *
 * Reuses computeGate (the SAME gate logic as generate-artifacts), so the hook and
 * the skill can never disagree about what to withhold. No deps beyond the toolkit.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeGate } from '../harness/artifact-gate.mjs'

// The single artifact the gate can withhold (the real doc, NOT the .WITHHELD.md
// placeholder — endsWith('authn-authz-flow.md') is false for '…flow.WITHHELD.md').
const GATED_SUFFIX = 'docs/security-review/authn-authz-flow.md'

const allow = () => process.exit(0) // no stdout = no decision; normal permission flow proceeds
const deny = (reason) => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }) + '\n')
  process.exit(0) // PreToolUse denies on exit 0 + JSON, not exit 2
}

function findRepoRoot(filePath) {
  let dir = dirname(resolve(filePath))
  for (let i = 0; i < 50; i++) {
    if (existsSync(join(dir, '.security-review'))) return dir
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}

function decide(payload) {
  const fp = payload && payload.tool_input && payload.tool_input.file_path
  if (!fp) return { action: 'allow' } // can't scope → don't interfere
  if (!String(fp).replace(/\\/g, '/').endsWith(GATED_SUFFIX)) return { action: 'allow' } // not our artifact → no-op
  const root = findRepoRoot(fp)
  if (!root) return { action: 'allow' } // no run state located → not a managed repo
  if (!existsSync(join(root, '.security-review', 'hook-armed'))) return { action: 'allow' } // not opted in → prose enforcement only
  // Armed + writing the gated artifact → consult the gate. Fail CLOSED here: if we
  // can't read/verify the ledger, do NOT let the authN/authZ doc be written.
  let ledger
  try { ledger = JSON.parse(readFileSync(join(root, '.security-review', 'audit-ledger.json'), 'utf8')) } catch {
    return { action: 'deny', reason: 'AuthN/AuthZ flow withheld: the enforcement hook is armed but the audit ledger could not be read to verify there is no open auth hole. Re-audit, or remove .security-review/hook-armed to disarm.' }
  }
  let triage = null
  try { triage = JSON.parse(readFileSync(join(root, '.security-review', 'triage-decision.json'), 'utf8')) } catch {}
  const gate = computeGate(ledger && ledger.findings, triage)
  if (gate.suppress.includes('authn-authz-flow')) {
    return { action: 'deny', reason: `AuthN/AuthZ flow doc withheld: ${gate.open_authz_findings.length} open authN/authZ critical/high finding(s) [${gate.open_authz_findings.join('; ')}] — generating it would map a live, unremediated auth hole for the reviewer. Resolve them and re-audit, or remove .security-review/hook-armed to disarm.` }
  }
  return { action: 'allow' }
}

function main() {
  let payload
  try { payload = JSON.parse(readFileSync(0, 'utf8') || '{}') } catch { allow() } // malformed hook input → don't interfere
  const d = decide(payload)
  if (d.action === 'deny') deny(d.reason)
  allow()
}

// Compare resolved paths so a symlinked invocation still runs main().
function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return fileURLToPath(import.meta.url) === resolve(process.argv[1]) } catch { return false }
}
if (invokedDirectly()) main()

export { decide } // for the standing test

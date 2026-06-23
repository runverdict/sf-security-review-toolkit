#!/usr/bin/env node
/**
 * sf-ops-gate-hook.mjs — PreToolUse hook (matcher: Bash): fail-closed consent
 * enforcement for IRREVERSIBLE Salesforce / host operations. The deployed-package
 * deep audit runs live, irreversible ops as prose-only Bash inside skills; a prior
 * full-auto run skipped the consent asks and fanned out anyway. This is the durable
 * backstop: a gated op physically cannot run unless an affirmative consent for its
 * gate is recorded (the same consent-COUPLING substrate as record-consent.mjs).
 *
 * IDENTITY / SCOPE. Shipped by the plugin (loads on enable) but it does NOT block
 * arbitrary Bash:
 *   1. SCOPED to a toolkit-managed repo — it acts only when process.cwd() is inside
 *      a tree that contains a `.security-review/` dir (an active audit). Outside one,
 *      every command is allowed: the toolkit never interferes with the partner's own
 *      unrelated `sf` work.
 *   2. CLASSIFIED on the ACTION VERB, not a substring — read-only verbs
 *      (`sf package version list`, `sf org list`, `sf config get`, `--help`) always
 *      pass. Only the enumerated irreversible verbs are gated.
 * A malformed / absent payload, or an un-readable command, fails to ALLOW (mirrors
 * authz-gate-hook): the gate never blocks something it cannot scope.
 *
 * THE THREE GATES (one consent ask per skill per class — see the gated skills):
 *   • sf-package-promote — `sf package version promote` ONLY. Its own gate because it
 *       PERMANENTLY releases a managed 2GP version that can never be deleted,
 *       un-promoted, or hidden. The deny reason emphasizes that permanence.
 *   • sf-deep-audit-ops  — package version create / install / uninstall, org create
 *       scratch|sandbox, org delete, data delete, project deploy (and the sfdx legacy
 *       force:* equivalents).
 *   • sf-cli-setup       — `sf org login *` (writes credentials), `npm install -g`.
 *
 * NORMALIZATION (the adversarial surface). Before classifying, each command is split
 * on shell separators (&& || ; | newline) and EACH segment is normalized: leading
 * env-var assignments and `sudo`/`npx` (with their flags) are stripped; whitespace
 * collapsed; both `sf` and `sfdx`, both the space-verb form (`sf package version
 * promote`) and the colon form (`sf package:version:promote` / legacy
 * `force:package:version:promote`) are accepted. A chain is gated if ANY segment is
 * an irreversible op; the highest-severity match (promote > deep-audit > cli-setup)
 * names the deny.
 *
 * HONEST RESIDUAL. The classifier catches the canonical + normalized command forms.
 * A DELIBERATELY obfuscated op — base64-decode-and-eval, variable indirection,
 * command substitution `$(…)`, writing the command to a file and sourcing it — can
 * still evade a regex over an LLM-driver's free-form Bash. This is the same inherent
 * limit the Phase-1 consent belt documents. The claim is "an honest driver running
 * the documented ops is gated," NOT "impossible to bypass."
 *
 * DENY MECHANISM (PreToolUse, verified 2026-06): exit 0 + stdout JSON
 * hookSpecificOutput.permissionDecision="deny" — NOT exit 2. allow = exit 0, no stdout.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyConsent } from '../harness/record-consent.mjs'

const allow = () => process.exit(0) // no stdout = no decision; normal permission flow proceeds
const deny = (reason) => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }) + '\n')
  process.exit(0) // PreToolUse denies on exit 0 + JSON, not exit 2
}

// Walk up from a directory for the `.security-review/` marker of a managed audit.
function findRepoRoot(startDir) {
  let dir = resolve(startDir)
  for (let i = 0; i < 50; i++) {
    if (existsSync(join(dir, '.security-review'))) return dir
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}

// ---------------------------------------------------------------------------
// Classification — pure, no fs. Returns a gate id or null.
// ---------------------------------------------------------------------------
const GATE_RANK = { 'sf-package-promote': 3, 'sf-deep-audit-ops': 2, 'sf-cli-setup': 1 }

// Strip a leading env-var run + sudo/npx wrappers (with their flags); collapse ws.
function normSegment(seg) {
  let s = String(seg).replace(/\s+/g, ' ').trim()
  let prev
  do {
    prev = s
    s = s.replace(/^[A-Za-z_][A-Za-z0-9_]*=[^\s]*\s+/, '') // one leading NAME=value
    s = s.replace(/^env\s+/i, '') // `env [NAME=val] sf …`
    s = s.replace(/^sudo\s+(?:-\S+\s+)*/i, '') // sudo + its own flags
    s = s.replace(/^npx\s+(?:-\S+\s+)*/i, '') // npx + its own flags
  } while (s !== prev)
  return s
}

// Leading non-flag tokens after the CLI, colon-form expanded → the verb path array.
function extractVerb(toks) {
  const verb = []
  for (let i = 1; i < toks.length; i++) {
    if (toks[i].startsWith('-')) break
    for (const part of toks[i].split(':')) if (part) verb.push(part.toLowerCase())
  }
  return verb
}

function classifySfVerb(v) {
  if (!v.length) return null
  const has = (t) => v.includes(t)
  const pre = (...p) => p.every((x, i) => v[i] === x)

  // PROMOTE — its own gate, highest severity (permanent release).
  if (pre('package', 'version', 'promote')) return 'sf-package-promote'
  if (pre('force', 'package') && has('promote')) return 'sf-package-promote' // sfdx legacy

  // DEEP-AUDIT OPS — install/uninstall, version create, org create/delete, data delete, deploy.
  if (pre('package', 'version', 'create')) return 'sf-deep-audit-ops'
  if (pre('package', 'install') || pre('package', 'uninstall')) return 'sf-deep-audit-ops'
  if (pre('force', 'package') && (has('create') || has('install') || has('uninstall'))) return 'sf-deep-audit-ops'
  if (pre('org', 'create', 'scratch') || pre('org', 'create', 'sandbox') || pre('force', 'org', 'create')) return 'sf-deep-audit-ops'
  if (pre('org', 'delete') || pre('force', 'org', 'delete')) return 'sf-deep-audit-ops'
  if (pre('data', 'delete') || (pre('force', 'data') && has('delete'))) return 'sf-deep-audit-ops'
  if (pre('project', 'deploy') || pre('force', 'source', 'deploy') || pre('force', 'source', 'push') || pre('force', 'mdapi', 'deploy')) {
    return 'sf-deep-audit-ops'
  }

  // CLI SETUP — credential-writing login.
  if (pre('org', 'login') || pre('force', 'auth')) return 'sf-cli-setup'

  return null
}

function classifyNpm(toks) {
  let verb = null
  for (let i = 1; i < toks.length; i++) {
    if (!toks[i].startsWith('-')) { verb = toks[i].toLowerCase(); break }
  }
  if (verb !== 'install' && verb !== 'i') return null
  const global = toks.some((t) => t === '-g' || t === '--global')
  return global ? 'sf-cli-setup' : null // a LOCAL `npm install` is not gated
}

function classifySegment(rawSeg) {
  const seg = normSegment(rawSeg)
  if (!seg) return null
  // A help invocation never executes the op.
  if (/(?:^|\s)(?:--help|-h)(?:\s|$)/.test(seg)) return null
  const toks = seg.split(' ')
  const cli = (toks[0] || '').toLowerCase()
  if (cli === 'npm') return classifyNpm(toks)
  if (cli !== 'sf' && cli !== 'sfdx') return null
  return classifySfVerb(extractVerb(toks))
}

/** Classify a (possibly chained) command → the highest-severity gate id, or null. */
export function classify(command) {
  if (!command || typeof command !== 'string') return null
  let best = null
  for (const seg of command.split(/&&|\|\||;|\||\n/)) {
    const g = classifySegment(seg)
    if (g && (GATE_RANK[g] || 0) > (GATE_RANK[best] || 0)) best = g
  }
  return best
}

// ---------------------------------------------------------------------------
function denyReason(gate, command) {
  const op = '`' + String(command).trim().replace(/\s+/g, ' ').slice(0, 200) + '`'
  const howto =
    `The skill must record an affirmative operator consent first (a mandatory ` +
    `AskUserQuestion coupled to ` +
    `\`node \${CLAUDE_PLUGIN_ROOT}/harness/record-consent.mjs --gate ${gate} --answer "<operator's yes>" ` +
    `--target <repo>\`), or remove \`.security-review/consent/${gate}.json\` to re-decide. A skipped ask ` +
    `means the op is DENIED, not silently run.`
  if (gate === 'sf-package-promote') {
    return (
      `BLOCKED (fail-closed): ${op} would PERMANENTLY release a managed 2GP version. ` +
      `This releases a 2GP version that can never be deleted, un-promoted, or hidden — it is irreversible. ` +
      `No operator consent is recorded for gate 'sf-package-promote'. ${howto}`
    )
  }
  const what =
    gate === 'sf-deep-audit-ops'
      ? 'an irreversible deployed-package deep-audit operation (install/uninstall, scratch/sandbox create or delete, data delete, or deploy)'
      : 'a credential-writing / global-install setup operation (sf org login, or npm install -g)'
  return (
    `BLOCKED (fail-closed): ${op} is ${what}. No operator consent is recorded for gate '${gate}'. ${howto}`
  )
}

/** Pure decision. opts.cwd defaults to process.cwd() (overridable for tests). */
export function decide(payload, opts = {}) {
  const cmd = payload && payload.tool_input && payload.tool_input.command
  if (!cmd || typeof cmd !== 'string') return { action: 'allow' } // can't read a command → don't interfere
  const root = findRepoRoot(opts.cwd || process.cwd())
  if (!root) return { action: 'allow' } // not inside a managed audit repo → no-op
  const gate = classify(cmd)
  if (!gate) return { action: 'allow' } // not an irreversible op → allow
  if (verifyConsent(gate, { target: root })) return { action: 'allow' } // operator consented
  return { action: 'deny', reason: denyReason(gate, cmd) }
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

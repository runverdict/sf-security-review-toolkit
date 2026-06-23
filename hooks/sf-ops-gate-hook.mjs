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
 * NORMALIZATION (the adversarial surface; hardened 0.8.12). Before classifying, a
 * WHOLE `sh -c "…"` / `eval "…"` wrapper is unwrapped and its inner command classified
 * (so a separator inside the quoted inner command survives), then the command is split
 * on shell separators (&& || |& ; & | newline) and a chained `… && bash -c "…"` segment
 * is unwrapped too. Each segment is normalized: leading shell grouping (`(sf …)`,
 * `{ sf …; }`, `((sf …))`), env-var assignments, and the common command wrappers — `env`,
 * `sudo`, `doas`, `npx`, `command`, `exec`, `time`, `timeout`, `nice`, `ionice`, `nohup`,
 * `setsid`, `stdbuf`, `xargs`, `watch`, each with their flags (incl. a `-x val` value-flag
 * like `sudo -u nobody`, and `timeout`'s positional duration `timeout 60 sf …`) — are
 * stripped; whitespace collapsed. The CLI token is basename-matched + unquoted (`/usr/local/bin/sf`, `./sf`,
 * `"sf"`, `\sf` → `sf`); `sf`/`sfdx`/`npm` accepted. The verb scan SKIPS flags
 * throughout (not stop-at-first) and matches the gated verb as a CONTIGUOUS run, so
 * interspersed flags, a global flag's value, and the leading `force` of the sfdx colon
 * form (`force:package:version:promote`) don't defeat it. A chain is gated if ANY
 * segment is an irreversible op; the highest-severity match (promote > deep-audit >
 * cli-setup) names the deny.
 *
 * HONEST RESIDUAL (recalibrated 0.8.13). The classifier catches the documented +
 * normalized forms above, including the COMMON process wrappers (env, sudo, doas, npx,
 * command, exec, time, timeout, nice, ionice, nohup, setsid, stdbuf, xargs, watch). Two
 * classes still evade: (1) an UNCOMMON process wrapper — some unusual scheduler / limiter
 * / runner not in the list above that fronts the real command — because the wrapper list
 * is best-effort, not a complete shell parser; and (2) EXOTIC runtime / shell-eval forms —
 * command substitution `$(…)` / backticks, variable indirection (`$CMD` / `${CMD}`),
 * process-substitution `source <(…)`, a base64-decode-pipe-to-shell one-liner — because
 * resolving them requires actually running the shell, which a static classifier cannot.
 * This is the same inherent limit the Phase-1 consent belt documents. The claim is "an
 * honest driver running the documented ops is gated; the wrapper list is best-effort and
 * not a complete shell parser," NOT "impossible to bypass."
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

const CLIS = new Set(['sf', 'sfdx', 'npm'])
// Common leading command wrappers that hand off to the real command (each may carry
// flags). NOT exhaustive — an uncommon wrapper is the documented residual (see header).
// `timeout` is special: it takes a POSITIONAL duration before the command (handled below).
const WRAPPERS = new Set([
  'env', 'sudo', 'doas', 'npx', 'command', 'exec', 'time', 'timeout',
  'nice', 'ionice', 'nohup', 'setsid', 'stdbuf', 'xargs', 'watch',
])
const DURATION = /^\d+(?:\.\d+)?[smhd]?$/ // a `timeout` positional duration: 60, 1m, 5s, 0.5
const SHELLS = /^(?:bash|sh|zsh|dash|ksh|ash)$/i
const NPM_INSTALL = new Set(['install', 'i', 'in', 'ins', 'inst', 'add'])
const NPM_UNINSTALL = new Set(['uninstall', 'un', 'unlink', 'remove', 'rm', 'r'])

// Basename + unquote/unescape, lowercased → so `/usr/local/bin/sf`, `./sf`, `bin/sf`,
// `~/bin/sf`, `"sf"`, `'sf'`, `\sf` all resolve to `sf`.
function cliName(tok) {
  let t = String(tok || '').trim()
  t = t.replace(/^"([^"]*)"$/, '$1').replace(/^'([^']*)'$/, '$1') // surrounding quotes
  t = t.replace(/\\/g, '') // escape backslashes
  t = t.split('/').pop() || t // basename
  return t.toLowerCase()
}
const isCli = (tok) => CLIS.has(cliName(tok))
const isWrapper = (tok) => WRAPPERS.has(cliName(tok))
const isEnvAssign = (tok) => /^[A-Za-z_][A-Za-z0-9_]*=[^\s]*$/.test(tok)

// Expose the real command: strip leading shell grouping (`(sf …)`, `{ sf …; }`,
// `((sf …))`), leading env-var assignments, and command wrappers — each wrapper with
// its own flags, where a short flag with no `=` may consume a following VALUE token
// (`sudo -u nobody sf …`) but not the command/wrapper itself (`env -i sf …`). Collapse ws.
function normSegment(seg) {
  let s = String(seg).replace(/\s+/g, ' ').trim()
  s = s.replace(/^[\s(){]+/, '').replace(/[\s)};]+$/, '') // shell grouping
  const toks = s.split(' ').filter(Boolean)
  let i = 0
  while (i < toks.length) {
    if (isEnvAssign(toks[i])) { i++; continue }
    if (isWrapper(toks[i])) {
      const w = cliName(toks[i])
      i++
      while (i < toks.length && toks[i].startsWith('-')) {
        const f = toks[i]; i++
        if (!f.includes('=') && i < toks.length && !toks[i].startsWith('-') && !isCli(toks[i]) && !isWrapper(toks[i])) i++
      }
      // `timeout [flags] <duration> sf …` — consume the one leading bare duration token.
      if (w === 'timeout' && i < toks.length && DURATION.test(toks[i])) i++
      continue
    }
    break
  }
  return toks.slice(i).join(' ')
}

// All non-flag tokens after the CLI (flags + the `--` marker skipped THROUGHOUT, not
// stopped-at), colon-form expanded → the verb path. Conservative: a flag VALUE that is
// collected as a verb token only ever OVER-gates a non-executing form, never under-gates.
function extractVerb(toks, start) {
  const verb = []
  for (let i = start + 1; i < toks.length; i++) {
    const t = toks[i]
    if (t === '--' || t.startsWith('-')) continue
    for (const part of t.split(':')) if (part) verb.push(part.toLowerCase())
  }
  return verb
}

// True iff `needle` occurs as a CONTIGUOUS run in `v` (so a leading sfdx `force` token,
// or a global flag's value collected ahead of the verb, doesn't defeat the match).
function seq(v, ...needle) {
  for (let i = 0; i + needle.length <= v.length; i++) {
    let ok = true
    for (let j = 0; j < needle.length; j++) if (v[i + j] !== needle[j]) { ok = false; break }
    if (ok) return true
  }
  return false
}

function classifySfVerb(v) {
  if (!v.length) return null
  const has = (t) => v.includes(t)

  // PROMOTE — its own gate (permanent release). seq() matches the sfdx
  // `force:package:version:promote` legacy form too; the force+promote fallback catches
  // any `force:package:…:promote` variant.
  if (seq(v, 'package', 'version', 'promote') || (seq(v, 'force', 'package') && has('promote'))) return 'sf-package-promote'

  // DEEP-AUDIT OPS — version create/delete, package install/uninstall/delete, org/sandbox
  // create/delete, data delete, deploy (+ the sfdx legacy force:* forms).
  if (seq(v, 'package', 'version', 'create') || seq(v, 'package', 'version', 'delete')) return 'sf-deep-audit-ops'
  if (seq(v, 'package', 'install') || seq(v, 'package', 'uninstall') || seq(v, 'package', 'delete')) return 'sf-deep-audit-ops'
  if (seq(v, 'force', 'package') && (has('create') || has('install') || has('uninstall') || has('delete'))) return 'sf-deep-audit-ops'
  if (seq(v, 'org', 'create', 'scratch') || seq(v, 'org', 'create', 'sandbox') || seq(v, 'force', 'org', 'create')) return 'sf-deep-audit-ops'
  if (seq(v, 'sandbox', 'create') || seq(v, 'sandbox', 'delete')) return 'sf-deep-audit-ops'
  if (seq(v, 'org', 'delete') || seq(v, 'force', 'org', 'delete')) return 'sf-deep-audit-ops'
  if (seq(v, 'data', 'delete') || (seq(v, 'force', 'data') && has('delete'))) return 'sf-deep-audit-ops'
  if (seq(v, 'project', 'deploy') || seq(v, 'force', 'source', 'deploy') || seq(v, 'force', 'source', 'push') || seq(v, 'force', 'mdapi', 'deploy')) {
    return 'sf-deep-audit-ops'
  }

  // CLI SETUP — credential-writing login.
  if (seq(v, 'org', 'login') || seq(v, 'force', 'auth')) return 'sf-cli-setup'

  return null
}

function classifyNpm(toks, start) {
  let verb = null
  for (let i = start + 1; i < toks.length; i++) {
    if (!toks[i].startsWith('-')) { verb = toks[i].toLowerCase(); break }
  }
  if (!verb || (!NPM_INSTALL.has(verb) && !NPM_UNINSTALL.has(verb))) return null
  const global = toks.some((t) => t === '-g' || t === '--global')
  return global ? 'sf-cli-setup' : null // a LOCAL install/uninstall is not gated
}

// Extract the inner string of a single/double-quoted argument; null if not cleanly
// quoted (nested same-quote, or unquoted/variable → the documented exotic residual).
function extractQuoted(arg) {
  const a = String(arg).trim()
  if (a.length < 2) return null
  const q = a[0]
  if ((q === '"' || q === "'") && a[a.length - 1] === q) {
    const inner = a.slice(1, -1)
    if (inner.includes(q)) return null
    return inner
  }
  return null
}

// `sh -c "<cmd>"` / `eval "<cmd>"` → the inner command string (best-effort), else null.
function unwrapShellC(command) {
  const s = normSegment(command) // so `sudo bash -c …` is seen
  const toks = s.split(' ').filter(Boolean)
  if (!toks.length) return null
  const c0 = cliName(toks[0])
  if (SHELLS.test(c0)) {
    let i = 1
    while (i < toks.length && !/^-[a-z]*c$/i.test(toks[i])) i++ // `-c`, `-lc`, …
    if (i < toks.length) return extractQuoted(toks.slice(i + 1).join(' '))
    return null
  }
  if (c0 === 'eval') return extractQuoted(toks.slice(1).join(' '))
  return null
}

function classifySegment(rawSeg) {
  const seg = normSegment(rawSeg)
  if (!seg) return null
  // A help invocation never executes the op.
  if (/(?:^|\s)(?:--help|-h)(?:\s|$)/.test(seg)) return null
  const toks = seg.split(' ').filter(Boolean)
  let idx = 0
  while (idx < toks.length && toks[idx].startsWith('-')) idx++ // skip leading flags / `--` before the CLI
  if (idx >= toks.length) return null
  const cli = cliName(toks[idx])
  if (cli === 'npm') return classifyNpm(toks, idx)
  if (cli !== 'sf' && cli !== 'sfdx') return null
  return classifySfVerb(extractVerb(toks, idx))
}

// Shell separators: && and || and |& and ; and & (background) and | and newline. `&&`
// is first so it wins over single `&`; `|&` before single `|`.
const SEP = /&&|\|\||\|&|;|&|\||\n/

function classifyString(command, depth) {
  if (depth > 6) return null // recursion backstop for nested shell -c / eval
  // best-effort: a WHOLE `sh -c "…"` / `eval "…"` → classify the inner command (this runs
  // BEFORE the separator split, so a separator INSIDE the quoted inner command survives).
  const whole = unwrapShellC(command)
  if (whole !== null) return classifyString(whole, depth + 1)
  let best = null
  for (const rawSeg of command.split(SEP)) {
    let g = classifySegment(rawSeg)
    if (!g) {
      const inner = unwrapShellC(rawSeg) // a CHAINED `… && bash -c "sf promote"` segment
      if (inner !== null) g = classifyString(inner, depth + 1)
    }
    if (g && (GATE_RANK[g] || 0) > (GATE_RANK[best] || 0)) best = g
  }
  return best
}

/** Classify a (possibly chained / wrapped) command → the highest-severity gate id, or null. */
export function classify(command) {
  if (!command || typeof command !== 'string') return null
  return classifyString(command, 0)
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

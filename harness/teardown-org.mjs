#!/usr/bin/env node
/*
 * teardown-org.mjs — ASYMMETRIC, name-guarded teardown of a throwaway scratch
 * org (B2-P2, the org tier). The destructive half of the standup-org pair, and
 * the `sf` analogue of teardown-stack — with the stakes one notch higher:
 * `sf org delete` is IRREVERSIBLE, so the name guard here is the single most
 * load-bearing property of the pair.
 *
 * NEVER DELETES A FOREIGN ORG. Every delete is gated on `assertOrgAlias`: the
 * target must match the fully-anchored toolkit convention `sf-srt-org-<runId>`
 * (the alias standup-org derives from its validated run-id), asserted BEFORE
 * any plan is returned or any `sf` call runs. A tampered manifest, a production
 * alias, a Dev Hub, an alias that merely CONTAINS the prefix, a trailing-newline
 * smuggle — all REFUSE (remove nothing). There is deliberately NO bare
 * `--target-org` fallback: the delete targets the guarded ALIAS from the
 * manifest, never a raw username a tampered manifest could carry.
 *
 * ASYMMETRIC: removes the org + the tmp dir (manifest, generated def file) and
 * KEEPS every evidence file — evidence lives under
 * `<repo>/.security-review/evidence/`, never in the org or the tmp dir.
 * IDEMPOTENT: an already-absent org is `already-clean`, never an error.
 * FAILS CLOSED without consent: `sf org delete` classifies to the recorded
 * `sf-deep-audit-ops` gate (no new consent — the same token the create rides);
 * the executor verifies it exactly as standup-org does.
 *
 * CONSENT IS DOUBLY COUPLED: the executor fails closed without `consent: true`
 * (the CLI derives it from --consent AND the recorded token), and when the
 * manifest records the repo that stood the org up, the recorded consent for
 * THAT repo must exist too — a token recorded in some other repo (or the cwd)
 * never authorizes deleting another run's org.
 *
 * Pure `planTeardownOrg` (validate + classify, no I/O) + impure `teardownOrg`.
 * `--sweep` removes leftover `sf-srt-org-*` scratch orgs after a crashed run —
 * strictly name-scoped: only entries in the CLI's scratchOrgs list whose alias
 * passes `assertOrgAlias` (a Dev Hub / production org never appears there, and
 * `org delete scratch` refuses non-scratch orgs besides). The sweep is
 * MACHINE-WIDE across toolkit orgs — it cannot tell an orphan from another
 * session's in-flight run, so run it only when no toolkit audit is in flight.
 *
 * USAGE: node teardown-org.mjs --consent [--target <repo>] [--manifest <file>]
 *          [--run-id <id>] [--sweep] [--json]
 */
import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assertSafeTmpRoot } from './install-scanners.mjs'
import { verifyConsent } from './record-consent.mjs'
import { sfEnv, parseSfJson } from './sf-env.mjs'

// Fully anchored (^…$, no `m` flag): the match must span the WHOLE string, so a
// value that merely contains the prefix (`x-sf-srt-org-abc`) or smuggles a second
// line (`sf-srt-org-abc\nprod` — JS `$` without `m` rejects a trailing newline)
// can never pass. The character class excludes whitespace and newlines outright.
const ORG_ALIAS_OK = /^sf-srt-org-[A-Za-z0-9][A-Za-z0-9._-]*$/
const RUN_ID_OK = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }
const POINTER_REL = join('.security-review', 'org-standup.json')

/**
 * Guard: an org this engine may delete MUST be one standup-org created.
 * `sf org delete` is irreversible, so this is the security boundary of the whole
 * pair — asserted BEFORE any delete, on every path (manifest, sweep). Throws on
 * anything that isn't a toolkit-scoped alias.
 */
export function assertOrgAlias(alias) {
  const s = typeof alias === 'string' ? alias : ''
  if (!ORG_ALIAS_OK.test(s)) {
    throw new Error(`refusing to touch a non-toolkit org: '${alias}' — teardown-org only ever deletes orgs standup-org created (alias sf-srt-org-<runId>)`)
  }
  return s
}

/**
 * PURE. From a manifest, validate the recorded alias + tmp root and return the
 * removal plan. The alias is asserted BEFORE anything is returned — a manifest
 * whose alias is not toolkit-scoped (a production alias, a Dev Hub, an arbitrary
 * name, empty/null) is REFUSED (throws), and there is no fallback target.
 */
export function planTeardownOrg(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('planTeardownOrg: no manifest')
  const alias = assertOrgAlias(manifest.alias)
  const tmpRoot = manifest.tmpRoot ? assertSafeTmpRoot(manifest.tmpRoot) : null // throws on an unsafe root
  return { alias, username: manifest.username || null, orgId: manifest.orgId || null, tmpRoot }
}

const quiet = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore', env: sfEnv() }); return true } catch { return false } }
const runOut = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: sfEnv() }) } catch { return '' } }

/** Is the alias locally known? (CLI absent or alias unknown both read as absent.) */
const orgExists = (alias) => quiet('sf', ['org', 'display', '--target-org', alias, '--json'])

/** Resolve the manifest from --target pointer / --manifest / --run-id. */
function resolveManifest({ target, manifestPath, runId }) {
  if (manifestPath) { const m = readJson(manifestPath); return m ? { manifest: m, pointerDir: m.target ? join(m.target, '.security-review') : null } : { error: `--manifest ${manifestPath} unreadable` } }
  if (runId) {
    if (!RUN_ID_OK.test(String(runId))) return { error: `invalid run-id '${runId}'` } // never a path segment escape
    const p = join(tmpdir(), 'sf-srt-org', runId, 'org-manifest.json'); const m = readJson(p)
    return m ? { manifest: m, pointerDir: m.target ? join(m.target, '.security-review') : null } : { error: `no manifest at ${p}` }
  }
  if (target) {
    const ptr = readJson(join(target, POINTER_REL))
    if (!ptr || !ptr.alias) return { none: true }
    if (ptr.status === 'torn-down') return { none: true } // idempotent re-run — already recorded as removed
    const m = ptr.manifestPath ? readJson(ptr.manifestPath) : null
    if (m) return { manifest: m, pointerDir: join(target, '.security-review') }
    // The pointer survives but the tmp manifest is gone (a reboot cleared /tmp
    // while the org lives for days). The pointer carries the alias, which the
    // same guard validates — fall back to it rather than falsely reporting
    // "no org stood up" while a live org keeps running.
    return { manifest: { schema: ptr.schema, runId: ptr.runId, alias: ptr.alias, username: null, orgId: null, tmpRoot: null, target }, pointerDir: join(target, '.security-review') }
  }
  return { error: 'no source: pass --target, --manifest, or --run-id' }
}

function markCleaned(pointerDir, info) {
  if (!pointerDir) return
  const p = join(pointerDir, 'org-standup.json'); const prev = readJson(p) || {}
  // strict field allowlist — carry forward only the known pointer fields, never
  // spread whatever the file happened to contain
  try {
    writeFileSync(p, JSON.stringify({
      schema: prev.schema || null, runId: prev.runId || null, alias: prev.alias || null,
      manifestPath: prev.manifestPath || null, createdAt: prev.createdAt || null,
      status: 'torn-down', removed: info,
    }, null, 2) + '\n')
  } catch {}
}

/**
 * IMPURE executor. Deletes the org standup-org recorded, removes the tmp dir,
 * KEEPS the evidence. FAILS CLOSED without consent (before anything is read or
 * removed). Refuses (removes nothing) on a manifest whose alias fails the guard.
 * Idempotent: an absent org / absent tmp → already-clean.
 * opts: { consent, target, manifestPath, runId }
 */
export function teardownOrg(opts = {}) {
  if (opts.consent !== true) {
    throw new Error('teardown-org: refusing to delete a scratch org without explicit consent (`sf org delete` is irreversible, under the sf-deep-audit-ops gate). Pass --consent with the recorded consent.')
  }
  const src = resolveManifest(opts)
  if (src.none) return { status: 'nothing-to-tear-down', removed: [], note: 'no org-standup pointer — no org stood up' }
  if (src.error) return { status: 'error', error: src.error, removed: [] }

  let plan
  try { plan = planTeardownOrg(src.manifest) }
  catch (e) { return { status: 'refused', error: String(e.message), removed: [] } }

  // Consent COUPLING to the org's originating repo: when the manifest records
  // the repo that stood the org up, the recorded sf-deep-audit-ops consent for
  // THAT repo must exist too — a token recorded in a different repo (or the
  // cwd) must not authorize deleting this run's org.
  if (src.manifest.target && !verifyConsent('sf-deep-audit-ops', { target: src.manifest.target })) {
    return { status: 'refused', error: `no recorded sf-deep-audit-ops consent in the org's originating repo (${src.manifest.target}) — record it there, or run the teardown from that repo`, removed: [] }
  }

  const removed = []
  // `sf` being ABSENT must not read as "the org is gone": when the manifest
  // proves an org was really created (it recorded a username/orgId), refuse to
  // destroy the teardown record — a live org silently orphaned with its
  // manifest deleted would report success while the org keeps running.
  const sfAvailable = quiet('sf', ['--version'])
  if (!sfAvailable && (plan.username || plan.orgId)) {
    return { status: 'failed', error: `the Salesforce CLI is unavailable — cannot verify or delete ${plan.alias}; nothing was removed (re-run where \`sf\` is installed)`, removed }
  }
  if (sfAvailable && orgExists(plan.alias)) {
    // the delete targets the GUARDED ALIAS — never a raw username, never a bare
    // --target-org a tampered manifest could point somewhere else
    const ok = quiet('sf', ['org', 'delete', 'scratch', '--no-prompt', '--target-org', plan.alias])
    if (!ok) {
      return { status: 'failed', error: `\`sf org delete scratch --target-org ${plan.alias}\` failed — the org may still exist; nothing else was removed (re-run teardown-org, or delete the org yourself and re-run for the tmp cleanup)`, removed }
    }
    removed.push(`org:${plan.alias}`)
  }
  if (plan.tmpRoot && existsSync(plan.tmpRoot)) { rmSync(plan.tmpRoot, { recursive: true, force: true }); removed.push(`tmp:${plan.tmpRoot}`) }
  markCleaned(src.pointerDir, removed)
  return {
    status: removed.length ? 'torn-down' : 'already-clean',
    removed,
    evidenceKept: src.pointerDir ? join(src.pointerDir, 'evidence') : '(evidence lives in <repo>/.security-review/evidence/, never in the org or the tmp dir)',
  }
}

/**
 * SWEEP: remove leftover toolkit scratch orgs + tmp trees after a crashed run
 * where the same-run teardown never fired. Strictly name-scoped: only entries in
 * the CLI's scratchOrgs list (a Dev Hub or production org never appears there)
 * whose alias passes `assertOrgAlias`, each re-checked before its delete — never
 * a non-toolkit org. Same consent fail-closed as the single teardown. NOTE: the
 * sweep is MACHINE-WIDE across toolkit orgs — it cannot tell a crashed run's
 * orphan from another session's in-flight org, so run it only when no toolkit
 * audit is in flight on this machine.
 */
export function sweepOrgs({ consent } = {}) {
  if (consent !== true) {
    throw new Error('teardown-org: refusing to sweep scratch orgs without explicit consent (`sf org delete` is irreversible, under the sf-deep-audit-ops gate). Pass --consent with the recorded consent.')
  }
  const removed = []
  let scratch = []
  try {
    const j = parseSfJson(runOut('sf', ['org', 'list', '--json']) || '{}')
    scratch = j && j.result && Array.isArray(j.result.scratchOrgs) ? j.result.scratchOrgs : []
  } catch { /* CLI absent / unparseable → no orgs to sweep */ }
  for (const o of scratch) {
    const alias = o && typeof o.alias === 'string' ? o.alias : ''
    try { assertOrgAlias(alias) } catch { continue } // never a non-toolkit org
    if (quiet('sf', ['org', 'delete', 'scratch', '--no-prompt', '--target-org', alias])) removed.push(`org:${alias}`)
  }
  const group = join(tmpdir(), 'sf-srt-org')
  let subs = []; try { subs = readdirSync(group) } catch {}
  for (const s of subs) {
    const d = join(group, s)
    try { assertSafeTmpRoot(d); rmSync(d, { recursive: true, force: true }); removed.push(`tmp:${d}`) } catch { /* skip anything not a safe per-run dir */ }
  }
  return { status: removed.length ? 'swept' : 'already-clean', removed }
}

function main() {
  const argv = process.argv
  const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
  const target = arg('--target', process.cwd())
  const asJson = argv.includes('--json')

  // --consent alone is insufficient: the recorded affirmative 'sf-deep-audit-ops'
  // consent is also required — the delete is irreversible, so this fails closed.
  const consentFlag = argv.includes('--consent')
  const consentRecorded = verifyConsent('sf-deep-audit-ops', { target })
  const consent = consentFlag && consentRecorded
  if (!consent) {
    const why = consentFlag && !consentRecorded
      ? `--consent is set but no affirmative consent is recorded for gate 'sf-deep-audit-ops' (the flag alone is not enough). Ask + record it first via record-consent.mjs.`
      : consentRecorded
        ? `consent for gate 'sf-deep-audit-ops' is ALREADY recorded — add the --consent flag to THIS command to run it (--consent is required on EVERY live-op invocation, on top of the one-time recorded consent; a recorded token alone never runs it).`
        : `a live op needs BOTH — record consent first (record-consent.mjs), THEN re-run with --consent on the command.`
    process.stdout.write(`## teardown-org — NOT RUN (no consent)\n\`sf org delete\` is irreversible; nothing was removed. ${why}\n`)
    process.exitCode = 3; return
  }

  if (argv.includes('--sweep')) {
    const s = sweepOrgs({ consent })
    process.stdout.write((asJson ? JSON.stringify(s, null, 2) : `## teardown-org --sweep — ${s.status}${s.removed.length ? ': ' + s.removed.join(', ') : ''}`) + '\n')
    return
  }

  const r = teardownOrg({ target, manifestPath: arg('--manifest', null), runId: arg('--run-id', null), consent })
  if (asJson) { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); process.exitCode = (r.status === 'refused' || r.status === 'error' || r.status === 'failed') ? 2 : 0; return }
  const L = ['## teardown-org']
  if (r.status === 'refused') { L.push(`REFUSED — ${r.error} (removed nothing)`); process.exitCode = 2 }
  else if (r.status === 'error') { L.push(`error: ${r.error}`); process.exitCode = 2 }
  else if (r.status === 'failed') { L.push(`FAILED — ${r.error}`); process.exitCode = 2 }
  else if (r.status === 'nothing-to-tear-down') L.push(r.note)
  else { L.push(r.status === 'torn-down' ? `removed: ${r.removed.join(', ')}` : 'already clean'); L.push(`evidence KEPT: ${r.evidenceKept}`) }
  process.stdout.write(L.join('\n') + '\n')
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) }
  catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

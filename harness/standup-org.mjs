#!/usr/bin/env node
/*
 * standup-org.mjs — consented stand-up of a throwaway SCRATCH ORG for the
 * deployed-org deep audit (B2-P2, the org tier). The `sf` analogue of
 * standup-stack: the deep audit previously improvised `sf org create scratch`
 * inline in prose each run; this engine makes the create deterministic, records
 * a resource manifest of exactly what it created, and pairs with teardown-org.mjs
 * (the name-guarded, irreversible half). A born-clean scratch org created and
 * destroyed by this pair collapses the contamination-teardown improvisation and
 * the "can't prove pristineness" caveat — a fresh org's pristineness holds by
 * construction.
 *
 * BOUNDARIES, ENCODED:
 *   • Dev Hub authentication stays OWNER-INTERACTIVE. This engine checks that a
 *     Dev Hub is authed (`sf org list`) and degrades honestly (`no-devhub`) when
 *     none is — it NEVER authenticates and NEVER stores an auth secret.
 *   • The scratch org's alias is TOOLKIT-SCOPED: `sf-srt-org-<runId>`. That name
 *     convention is what lets teardown-org refuse to delete any org this engine
 *     didn't create — the load-bearing safety choice of the pair.
 *   • The manifest records NAMES/IDS only (alias, the returned username + orgId).
 *     `sf org create scratch --json` returns `authFields` carrying an ACCESS
 *     TOKEN — the executor parses out the two ids and DISCARDS the rest; the raw
 *     output is never persisted, logged, or spread into the manifest.
 *   • NO NEW CONSENT: `sf org create scratch` already classifies to the recorded
 *     `sf-deep-audit-ops` gate (hooks/sf-ops-gate-hook.mjs); this executor
 *     verifies that same token, exactly as standup-stack verifies
 *     `throwaway-dast`. It FAILS CLOSED without it.
 *
 * PURE planner `planStandupOrg` (deterministic spec, no I/O) + impure executor
 * `standupOrg` (the `sf` call). `--dry-run` writes the `planned` manifest and
 * performs NO live op — the safe way to exercise the planner.
 *
 * USAGE: node standup-org.mjs --consent [--run-id <id>] [--def-file <path>]
 *          [--duration-days <n>] [--tmp-root <dir>] [--target <repo>]
 *          [--dry-run] [--json]
 */
import { mkdirSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { assertSafeTmpRoot } from './install-scanners.mjs'
import { verifyConsent } from './record-consent.mjs'
import { assertOrgAlias } from './teardown-org.mjs'
import { sfEnv, parseSfJson } from './sf-env.mjs'

export const ORG_SCHEMA = 'sf-srt-org/1'
export const ORG_ALIAS_PREFIX = 'sf-srt-org'
const RUN_ID_OK = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
export const DEFAULT_DURATION_DAYS = 1
// a throwaway audit org lives days, not the platform's 30-day max — long enough
// for an install → audit → uninstall pass with room to resume, short enough that
// a forgotten org expires on its own
export const MAX_DURATION_DAYS = 7

/** The org alias is derived ONLY from the validated run-id → teardown can name-guard it. */
export function orgAlias(runId) {
  if (!RUN_ID_OK.test(String(runId || ''))) throw new Error(`standup-org: invalid run-id '${runId}'`)
  return `${ORG_ALIAS_PREFIX}-${runId}`
}

/**
 * The toolkit's default scratch-org definition (used only when the caller passes
 * no --def-file): Developer edition with the Einstein1AIPlatform feature, which
 * is what enables third-party MCP server registration in the org (the retired
 * `Chatbot` feature fails org creation outright as of June 2026, and the
 * `botSettings` block has failed the settings deploy — both deliberately absent;
 * a caller needing a richer definition passes its own file).
 */
export function defaultOrgDef() {
  return {
    orgName: 'sf-srt throwaway deep-audit org',
    edition: 'Developer',
    features: ['Einstein1AIPlatform'],
  }
}

/**
 * PURE. Compute the deterministic scratch-org stand-up spec. Deterministic given
 * (runId, defFile, durationDays, tmpRoot); throws on an invalid run-id, a
 * non-integer duration, or an unsafe tmp root. The duration is CLAMPED to
 * [1, MAX_DURATION_DAYS] — a sane bound for a disposable audit org.
 */
export function planStandupOrg({ runId, defFile, durationDays, tmpRoot } = {}) {
  const alias = orgAlias(runId) // validates the run-id
  assertSafeTmpRoot(tmpRoot)
  let days
  if (durationDays == null || durationDays === '') days = DEFAULT_DURATION_DAYS
  else {
    const n = Number(durationDays)
    if (!Number.isInteger(n)) throw new Error(`planStandupOrg: invalid duration-days '${durationDays}'`)
    days = Math.min(Math.max(n, 1), MAX_DURATION_DAYS)
  }
  // no operator definition → the plan CARRIES the generated default definition
  // (content in the plan, written by the executor) so the planner stays pure
  const generated = !defFile
  const defPath = generated ? join(tmpRoot, 'org-def.json') : String(defFile)
  return {
    schema: ORG_SCHEMA, runId, alias,
    // `--target-dev-hub` is deliberately absent: the create rides the authed
    // default Dev Hub — authenticating or selecting one stays owner-interactive
    argv: [
      'org', 'create', 'scratch',
      '--alias', alias,
      '--definition-file', defPath,
      '--no-ancestors',
      '--duration-days', String(days),
      '--wait', '15',
      '--json',
    ],
    defFile: defPath,
    defFileContent: generated ? JSON.stringify(defaultOrgDef(), null, 2) + '\n' : null,
    durationDays: days,
    tmpRoot, manifestPath: join(tmpRoot, 'org-manifest.json'),
    pointerRel: join('.security-review', 'org-standup.json'),
  }
}

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: sfEnv() })

/**
 * Is a Dev Hub authed? Detection only — authentication is the owner-interactive
 * step this engine assumes and never performs. `sf org list --json` failing (CLI
 * absent, broken install) reads the same as no hub: an honest hint, no create.
 */
export function devHubStatus() {
  let out = ''
  try { out = run('sf', ['org', 'list', '--json']) }
  catch {
    return { authed: false, hint: '`sf org list` failed — is the Salesforce CLI installed? Install + authenticate a Dev Hub first (owner-interactive; see /sf-security-review-toolkit:bootstrap-cli-auth), then re-run' }
  }
  try {
    const j = parseSfJson(out)
    const hubs = j && j.result && Array.isArray(j.result.devHubs) ? j.result.devHubs : []
    if (hubs.length) return { authed: true }
  } catch { /* fall through to the honest hint */ }
  return { authed: false, hint: 'no authenticated Dev Hub found — authenticate one first (owner-interactive: `sf org login web --set-default-dev-hub`, or the device flow in /sf-security-review-toolkit:bootstrap-cli-auth), then re-run; this engine never authenticates for you' }
}

/**
 * Write the manifest + the gitignored project pointer. STRICT field allowlist —
 * the create's raw `--json` output carries `authFields` (an access token), so the
 * manifest is assembled field-by-field from named values, never spread. NAMES and
 * IDS only: alias, username, orgId. No password, no token, no auth URL, ever.
 * ONE pointer slot per repo — a second stand-up against the same --target
 * overwrites it (the newest run wins); tear earlier runs down by --run-id,
 * whose per-run manifest under the tmp grouping dir survives the overwrite.
 */
function writeOrgManifest(plan, rec, target) {
  mkdirSync(plan.tmpRoot, { recursive: true, mode: 0o700 })
  const manifest = {
    schema: plan.schema, runId: plan.runId,
    alias: plan.alias,
    username: rec.username || null,
    orgId: rec.orgId || null,
    durationDays: plan.durationDays, defFile: plan.defFile,
    status: rec.status, createdAt: rec.createdAt || null, log: rec.log || '',
    tmpRoot: plan.tmpRoot, target: target || null,
  }
  writeFileSync(plan.manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  if (target) {
    try {
      const dir = join(target, '.security-review'); mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'org-standup.json'), JSON.stringify({
        schema: plan.schema, runId: plan.runId, alias: plan.alias,
        manifestPath: plan.manifestPath, status: rec.status, createdAt: rec.createdAt || null,
      }, null, 2) + '\n')
    } catch { /* pointer is best-effort */ }
  }
  return manifest
}

/**
 * IMPURE executor. Creates the scratch org. FAILS CLOSED without consent —
 * thrown before any `sf` call. Degrades honestly (`no-devhub`) when no Dev Hub
 * is authed: no create attempted, no manifest written (nothing exists to tear
 * down). opts: { consent, target, createdAt(ISO) }
 */
export function standupOrg(plan, { consent = false, target, createdAt } = {}) {
  assertSafeTmpRoot(plan.tmpRoot)
  // re-assert the alias even though planStandupOrg derives it from a validated
  // run-id: the crash-cleanup below issues an `sf org delete`, and EVERY delete
  // in the pair stays behind the name guard — a hand-built plan with a foreign
  // alias must refuse here, exactly as a tampered manifest refuses in teardown
  assertOrgAlias(plan.alias)
  if (consent !== true) {
    throw new Error('standup-org: refusing to create a scratch org without explicit consent (a live, org-creating op under the sf-deep-audit-ops gate). Pass --consent with the recorded consent.')
  }
  const hub = devHubStatus()
  if (!hub.authed) return { status: 'no-devhub', reason: hub.hint, alias: plan.alias }

  const stamp = createdAt || new Date().toISOString()
  const rec = { status: 'creating', createdAt: stamp, username: null, orgId: null, log: '' }
  mkdirSync(plan.tmpRoot, { recursive: true, mode: 0o700 })
  if (plan.defFileContent) writeFileSync(plan.defFile, plan.defFileContent, { mode: 0o600 })
  else if (!existsSync(plan.defFile)) {
    rec.status = 'failed'
    rec.log = `definition file not found: ${plan.defFile}`
    return writeOrgManifest(plan, rec, target)
  }

  // Alias-stub manifest BEFORE the create (the alias is deterministic) so even a
  // crashed create stays teardown-able from the manifest alone (audit: orphan).
  writeOrgManifest(plan, rec, target)

  // Best-effort cleanup for THIS process's synchronous window: a SIGINT/SIGTERM/
  // fatal between create and hand-off must not orphan a live org. The delete is
  // scoped to OUR toolkit alias only; teardown-org remains the authoritative removal.
  const cleanup = () => { try { execFileSync('sf', ['org', 'delete', 'scratch', '--no-prompt', '--target-org', plan.alias], { stdio: 'ignore', env: sfEnv() }) } catch {} }
  const handlers = {
    SIGINT: () => { cleanup(); process.exit(130) },
    SIGTERM: () => { cleanup(); process.exit(143) },
    uncaughtException: (e) => { cleanup(); throw e },
  }
  for (const [s, h] of Object.entries(handlers)) process.on(s, h)
  try {
    const out = run('sf', plan.argv)
    // the raw JSON result includes `authFields` with an ACCESS TOKEN — extract
    // the two identifiers, discard everything else, never persist the raw output
    try {
      const j = parseSfJson(out)
      rec.username = (j && j.result && j.result.username) || null
      rec.orgId = (j && j.result && j.result.orgId) || null
    } catch { /* created but unparseable output — ids stay null, alias still tears down */ }
    rec.status = 'created'
  } catch {
    rec.status = 'failed'
    // the toolkit does not persist raw `sf` output (it can carry auth material);
    // re-run the argv yourself for the CLI error while the failure is fresh
    rec.log = 'scratch-org create failed during the `sf` call (the toolkit does not capture raw CLI output — re-run the create yourself to see the error; a partially-created org is removable via teardown-org)'
  } finally {
    for (const [s, h] of Object.entries(handlers)) process.removeListener(s, h)
  }
  return writeOrgManifest(plan, rec, target)
}

function main() {
  const argv = process.argv
  const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
  const target = arg('--target', process.cwd())
  const runId = arg('--run-id', `${Date.now().toString(36)}-${process.pid}-${randomBytes(3).toString('hex')}`)
  const tmpRoot = arg('--tmp-root', join(tmpdir(), 'sf-srt-org', runId))
  const asJson = argv.includes('--json')

  let plan
  try { plan = planStandupOrg({ runId, defFile: arg('--def-file', null), durationDays: arg('--duration-days', null), tmpRoot }) }
  catch (e) {
    process.stdout.write((asJson ? JSON.stringify({ status: 'invalid', error: String(e.message) }, null, 2) : `## standup-org — cannot plan: ${e.message}`) + '\n')
    process.exitCode = 3; return
  }

  // --dry-run: the planned manifest ONLY — no `sf` call, no consent needed, no
  // def-file write (nothing live happens; this is how the planner is exercised)
  if (argv.includes('--dry-run')) {
    const m = writeOrgManifest(plan, { status: 'planned', createdAt: null, username: null, orgId: null, log: '' }, null)
    process.stdout.write((asJson ? JSON.stringify(m, null, 2) : `## standup-org — planned (dry-run, no live op)\nalias: ${m.alias}   argv: sf ${plan.argv.join(' ')}\nmanifest: ${plan.manifestPath}`) + '\n')
    return
  }

  // --consent alone is insufficient: the recorded affirmative 'sf-deep-audit-ops'
  // consent (the deep audit's gate, asked via AskUserQuestion) is also required.
  const consentFlag = argv.includes('--consent')
  const consentRecorded = verifyConsent('sf-deep-audit-ops', { target })
  const consent = consentFlag && consentRecorded
  if (!consent) {
    const why = consentFlag && !consentRecorded
      ? `--consent is set but no affirmative consent is recorded for gate 'sf-deep-audit-ops' (the flag alone is not enough). Ask + record it first via record-consent.mjs.`
      : `re-run with --consent (and the recorded consent).`
    process.stdout.write(`## standup-org — NOT STARTED (no consent)\nWould create scratch org ${plan.alias} (${plan.durationDays}d, def: ${plan.defFile}).\n${why}\n`)
    process.exitCode = 3; return
  }

  const m = standupOrg(plan, { consent, target })
  if (asJson) { process.stdout.write(JSON.stringify(m, null, 2) + '\n'); if (m.status !== 'created') process.exitCode = 1; return }
  if (m.status === 'no-devhub') { process.stdout.write(`## standup-org — no-devhub\n${m.reason}\n`); process.exitCode = 1; return }
  process.stdout.write(`## standup-org — ${m.status}\nalias: ${m.alias}   username: ${m.username || '(none)'}   orgId: ${m.orgId || '(none)'}\nteardown: node harness/teardown-org.mjs --consent --target <repo>\n${m.status !== 'created' ? 'LOG: ' + (m.log || '') : ''}\n`)
  if (m.status !== 'created') process.exitCode = 1
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) }
  catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

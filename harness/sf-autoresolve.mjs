#!/usr/bin/env node
/*
 * sf-autoresolve.mjs — the deterministic DevHub Tooling AUTO-RESOLVE PRODUCER
 * (cold-run robustness slice R2). The PRODUCER half of the producer→render pair:
 * `render-sf-autoresolve.mjs` (frozen) is the RENDER half and consumes the
 * `sf-autoresolve.json` this engine writes. Before this engine, scope-submission
 * Step 4 improvised the DevHub Tooling readout in prose each run; on a real cold
 * run the prescribed `SubscriberPackageVersion` query + a wrong `--packages <NAME>`
 * form errored, the agent improvised recovery, and the keystone `version` degraded
 * to the literal string `"undefined.undefined.undefined.undefined"` (and risked a
 * false-positive "already reviewed"). This engine locks both guarantees in code.
 *
 * It is the `sf` analogue of standup-org.mjs: a PURE planner + PURE normalizers +
 * an honest `devHubStatus()` degrade + a FAIL-CLOSED per-step executor, every `sf`
 * spawn routed through `sfEnv()` and every `--json` through `parseSfJson()`.
 *
 * TWO KEYSTONE GUARANTEES, ENCODED (the exact cold-run defects):
 *   • `normalizeVersionString` NEVER emits a string containing the token
 *     `undefined` — an absent/partial version reads `unknown`, never
 *     `"undefined.undefined.undefined.undefined"`.
 *   • `normalizeSecurityReviewed` FAILS CLOSED to `unknown` on an absent / null /
 *     errored field and reports `reviewed` ONLY on an explicit boolean `true` —
 *     it can never fabricate an "already reviewed" off a missing field.
 *
 * THE RELIABLE ID-RESOLUTION ORDER (the `InvalidPackageIdError` fix). The planner
 * builds the argv SEQUENCE in the order the cold run proved necessary:
 *   1. `sf package list`                    → resolve the `0Ho` package id (never assume it)
 *   2. `sf package version list --packages <0Ho>` → resolve the `04t` version id
 *      (pass the `0Ho` id — `--packages <NAME>` is what throws InvalidPackageIdError)
 *   3. `sf package version report --package <04t>` → promotion / coverage / validation-skipped
 *   4. `sf data query --use-tooling-api --query "… SubscriberPackageVersion …"` → the keystone
 * When `packageId`/`versionId` are already known the planner short-circuits the
 * matching resolution step; the DEFAULT path resolves `0Ho`→`04t` live.
 *
 * FLAG NOTE (verified against sf 2.137.7 — the whole point of this slice is
 * real-CLI argv, so the flags are per-command, not a generic `--target-org`):
 * the three `package*` verbs take `-v/--target-dev-hub`; `sf data query` takes
 * `-o/--target-org` AND the SOQL via `-q/--query` (a flag value, not positional).
 *
 * NO NEW CONSENT (unlike standup-org): Step 4 is READ-ONLY Tooling against an
 * already-authed hub and is opt-in at the prose level. This engine NEVER
 * authenticates and sets `sfAutoResolved:false` when no hub is authed — there is
 * no `sf-deep-audit-ops` gate here, and the sf-ops-gate-hook is untouched.
 *
 * NAMES/CONFIG ONLY (CONVENTIONS §6): rows are assembled field-by-field from named
 * scalar values (version parts, booleans, a coverage LABEL) — raw `sf` output is
 * NEVER spread into the manifest. The package/version JSON carries no auth token
 * the way `org create` does, but the strict field-by-field discipline holds.
 *
 * OUTPUT: `<target>/.security-review/sf-autoresolve.json` (where the frozen render
 * reads it) + the scope-manifest's `sfAutoResolved` flag. NOTE the divergence from
 * standup-org's tmp-root manifest: this producer writes to the target's
 * `.security-review` because that is where the render CONSUMES it — the paths are
 * target-relative (in the plan as `outputRel`/`manifestRel`), deterministic, pure.
 *
 * USAGE: node sf-autoresolve.mjs --target <repo>
 *          [--package-name <name>] [--package-id <0Ho>] [--version-id <04t>]
 *          [--devhub <alias>] [--dry-run] [--json]
 *        --dry-run exercises the planner with NO live op.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { sfEnv, parseSfJson } from './sf-env.mjs'

export const AUTORESOLVE_SCHEMA = 'sf-autoresolve/1'
// Placeholders the planner leaves in the argv until the executor resolves the real
// ids from step 1/2 output — a placeholder is NEVER a live id and NEVER the name.
export const PLACEHOLDER_PACKAGE_ID = '<0Ho>'
export const PLACEHOLDER_VERSION_ID = '<04t>'
export const OUTPUT_REL = join('.security-review', 'sf-autoresolve.json')
export const MANIFEST_REL = join('.security-review', 'scope-manifest.json')

const KEYSTONE_SOURCE = 'Tooling SOQL SubscriberPackageVersion'
const REPORT_SOURCE = 'sf package version report --json'
const COVERAGE_SOURCE = 'sf package version report — ApexCodeCoverageAggregate'

// ── PURE argv builders ──────────────────────────────────────────────────────
// `package*` verbs thread the hub via `--target-dev-hub`; `data query` via
// `--target-org`. When no hub is named the flag is omitted (sf uses the default).
const withDevHub = (argv, devhub) => (devhub ? [...argv, '--target-dev-hub', String(devhub)] : argv)
const withTargetOrg = (argv, devhub) => (devhub ? [...argv, '--target-org', String(devhub)] : argv)

export const packageListArgv = (devhub) => withDevHub(['package', 'list', '--json'], devhub)
export const versionListArgv = (packageId, devhub) =>
  withDevHub(['package', 'version', 'list', '--packages', String(packageId), '--json'], devhub)
export const versionReportArgv = (versionId, devhub) =>
  withDevHub(['package', 'version', 'report', '--package', String(versionId), '--json'], devhub)
export const subscriberVersionSoql = (versionId) =>
  `SELECT IsSecurityReviewed, MajorVersion, MinorVersion, PatchVersion, BuildNumber ` +
  `FROM SubscriberPackageVersion WHERE Id='${versionId}'`
export const subscriberVersionArgv = (versionId, devhub) =>
  withTargetOrg(['data', 'query', '--use-tooling-api', '--query', subscriberVersionSoql(String(versionId)), '--json'], devhub)

/**
 * PURE. Build the deterministic auto-resolve spec: the reliable argv SEQUENCE +
 * the resolved-or-placeholder ids + the target-relative output/manifest paths.
 * Deterministic given inputs; NO I/O. The order is load-bearing — the `0Ho`
 * package id is resolved BEFORE `package version report`, and the report step uses
 * a single `--package <04t>`, never `--packages <NAME>` (the InvalidPackageIdError
 * regression). Short-circuits a resolution step when its id is already known.
 */
export function planSfAutoResolve({ packageName, packageId, versionId, devhub } = {}) {
  const dh = devhub || null
  const pkgId = packageId || null
  const verId = versionId || null
  const steps = []
  // 1. Resolve the 0Ho package id first — ONLY when neither it nor the 04t is known.
  if (!pkgId && !verId) {
    steps.push({ key: 'resolvePackage', resolves: '0Ho', argv: packageListArgv(dh) })
  }
  // 2. Resolve the 04t version id — pass the 0Ho id (real or placeholder), NEVER the name.
  if (!verId) {
    steps.push({ key: 'resolveVersion', resolves: '04t', needs: '0Ho', argv: versionListArgv(pkgId || PLACEHOLDER_PACKAGE_ID, dh) })
  }
  const vid = verId || PLACEHOLDER_VERSION_ID
  // 3. Version report — promotion / coverage / validation-skipped (single --package).
  steps.push({ key: 'versionReport', needs: '04t', argv: versionReportArgv(vid, dh) })
  // 4. The Tooling keystone — IsSecurityReviewed + the version parts.
  steps.push({ key: 'subscriberVersion', needs: '04t', argv: subscriberVersionArgv(vid, dh) })
  return {
    schema: AUTORESOLVE_SCHEMA,
    packageName: packageName || null,
    packageId: pkgId,
    versionId: verId,
    devhub: dh,
    steps,
    outputRel: OUTPUT_REL,
    manifestRel: MANIFEST_REL,
  }
}

// ── PURE response normalizers (the fail-closed guarantees) ──────────────────

/**
 * PURE. `{ major, minor, patch, build }` → a clean `"MAJOR.MINOR.PATCH.BUILD"`
 * string ONLY when ALL four parts are present; ANY absent/null/""/`undefined`
 * part → the literal `"unknown"`. NEVER returns a string containing the token
 * `undefined` — this is the exact cold-run defect
 * (`"undefined.undefined.undefined.undefined"`), locked.
 */
export function normalizeVersionString(parts) {
  const p = parts && typeof parts === 'object' ? parts : {}
  const vals = [p.major, p.minor, p.patch, p.build]
  for (const v of vals) {
    if (v === undefined || v === null || v === '' || String(v) === 'undefined') return 'unknown'
  }
  return vals.map((v) => String(v)).join('.')
}

/**
 * PURE. FAIL-CLOSES to `"unknown"` on an absent / null / status-≠0 (errored) raw
 * `sf data query` response, and reports `"reviewed"` ONLY on an explicit boolean
 * `true` in `IsSecurityReviewed`. A boolean `false` → `"not-reviewed"`; a
 * missing/null field → `"unknown"`. NEVER a false-positive "reviewed" off an
 * absent field. Accepts the full sf `--json` shape or a bare record.
 */
export function normalizeSecurityReviewed(raw) {
  if (raw == null || typeof raw !== 'object') return 'unknown'
  if ('status' in raw && Number(raw.status) !== 0) return 'unknown' // sf --json error envelope
  const rec =
    raw.result && Array.isArray(raw.result.records) && raw.result.records.length ? raw.result.records[0]
      : 'IsSecurityReviewed' in raw ? raw
        : null
  const val = rec && typeof rec === 'object' ? rec.IsSecurityReviewed : undefined
  if (val === true) return 'reviewed'
  if (val === false) return 'not-reviewed'
  return 'unknown'
}

const triBool = (v) => (v === true ? true : v === false ? false : 'unknown')
const isEmptyCoverage = (c) =>
  c == null ||
  c === '' ||
  (Array.isArray(c) && c.length === 0) ||
  (typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length === 0)

/**
 * PURE. Normalize a `sf package version report --json` result. Carries
 * `IsReleased` / `HasPassedCodeCoverageCheck` / `ValidationSkipped` faithfully
 * (tri-state: true|false|unknown). An EMPTY `CodeCoveragePercentages` /
 * `ApexCodeCoverageAggregate` (a known finished-2GP behavior) is labeled
 * corroborating/unknown, NEVER `"0% covered"` — the scratch-org run is primary.
 */
export function normalizeVersionReport(raw) {
  if (raw == null || (typeof raw === 'object' && 'status' in raw && Number(raw.status) !== 0)) {
    return { isReleased: 'unknown', hasPassedCodeCoverageCheck: 'unknown', validationSkipped: 'unknown', coverage: 'unknown' }
  }
  const r = raw.result && typeof raw.result === 'object' ? raw.result : typeof raw === 'object' ? raw : {}
  const covRaw = r.CodeCoveragePercentages ?? r.CodeCoverage ?? r.codeCoverage ?? r.ApexCodeCoverageAggregate
  const coverage = isEmptyCoverage(covRaw)
    ? 'unknown — corroborating (empty coverage is a known finished-2GP behavior; scratch-org run is primary)'
    : `${typeof covRaw === 'number' || typeof covRaw === 'string' ? covRaw : JSON.stringify(covRaw)}% — corroborating (scratch-org run is primary)`
  return {
    isReleased: triBool(r.IsReleased),
    hasPassedCodeCoverageCheck: triBool(r.HasPassedCodeCoverageCheck),
    validationSkipped: triBool(r.ValidationSkipped),
    coverage,
  }
}

// ── row assembly (field-by-field, never a spread of raw `sf` output) ────────
const firstRecord = (raw) =>
  raw && raw.result && Array.isArray(raw.result.records) && raw.result.records.length ? raw.result.records[0] : null

function keystoneRows(rawQueryJson) {
  const rec = firstRecord(rawQueryJson)
  const version = normalizeVersionString({
    major: rec ? rec.MajorVersion : undefined,
    minor: rec ? rec.MinorVersion : undefined,
    patch: rec ? rec.PatchVersion : undefined,
    build: rec ? rec.BuildNumber : undefined,
  })
  return [
    { key: 'version', value: version, source: KEYSTONE_SOURCE, provenance: 'automated' },
    { key: 'isSecurityReviewed', value: normalizeSecurityReviewed(rawQueryJson), source: KEYSTONE_SOURCE, provenance: 'automated' },
  ]
}
const keystoneRowsUnknown = () => [
  { key: 'version', value: normalizeVersionString(null), source: KEYSTONE_SOURCE, provenance: 'automated' },
  { key: 'isSecurityReviewed', value: normalizeSecurityReviewed(null), source: KEYSTONE_SOURCE, provenance: 'automated' },
]

function reportRows(norm) {
  return [
    { key: 'isReleased', value: norm.isReleased, source: REPORT_SOURCE, provenance: 'automated' },
    { key: 'hasPassedCodeCoverageCheck', value: norm.hasPassedCodeCoverageCheck, source: REPORT_SOURCE, provenance: 'automated' },
    { key: 'validationSkipped', value: norm.validationSkipped, source: REPORT_SOURCE, provenance: 'automated' },
    { key: 'coverage', value: norm.coverage, source: COVERAGE_SOURCE, provenance: 'automated' },
  ]
}
const reportRowsUnknown = () => reportRows(normalizeVersionReport(null))

// ── id pickers (executor helpers, tolerant of the two `sf` result shapes) ───
function pickPackageId(j, packageName) {
  const arr = Array.isArray(j && j.result) ? j.result : Array.isArray(j && j.result && j.result.records) ? j.result.records : []
  if (!arr.length) return null
  if (packageName) {
    const m = arr.find((p) => p && (p.Name === packageName || p.NamespacePrefix === packageName || p.Alias === packageName))
    return m ? m.Id || m.Package2Id || null : null
  }
  // no name given but exactly one package → unambiguous, pick it; else degrade honestly
  return arr.length === 1 ? arr[0].Id || arr[0].Package2Id || null : null
}

const verKey = (v) =>
  (Number(v && v.MajorVersion) || 0) * 1e9 +
  (Number(v && v.MinorVersion) || 0) * 1e6 +
  (Number(v && v.PatchVersion) || 0) * 1e3 +
  (Number(v && v.BuildNumber) || 0)
function pickVersionId(j) {
  const arr = Array.isArray(j && j.result) ? j.result : []
  if (!arr.length) return null
  const released = arr.filter((v) => v && v.IsReleased === true)
  const pool = released.length ? released : arr
  const best = [...pool].sort((a, b) => verKey(b) - verKey(a))[0]
  return best ? best.SubscriberPackageVersionId || best.Id || null : null
}

const defaultRun = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: sfEnv() })

/**
 * Is a Dev Hub authed? Detection ONLY — authentication is the owner-interactive
 * step this engine assumes and never performs. `sf org list --json` failing reads
 * the same as no hub: an honest hint, no queries. `run` is injectable so the
 * standing test drives the whole executor offline.
 */
export function devHubStatus(run = defaultRun) {
  let out = ''
  try {
    out = run('sf', ['org', 'list', '--json'])
  } catch {
    return { authed: false, hint: '`sf org list` failed — is the Salesforce CLI installed? Install + authenticate a DevHub first (owner-interactive), then re-run; this step is optional' }
  }
  try {
    const j = parseSfJson(out)
    const hubs = j && j.result && Array.isArray(j.result.devHubs) ? j.result.devHubs : []
    if (hubs.length) return { authed: true }
  } catch {
    /* fall through to the honest hint */
  }
  return { authed: false, hint: 'no authenticated DevHub found — the SF-CLI auto-resolution is optional and opt-in; skip it and let operator-asked / code-inferred values stand (sfAutoResolved:false)' }
}

function setManifestFlag(manifestPath, flag) {
  try {
    let m = {}
    if (existsSync(manifestPath)) {
      try {
        m = JSON.parse(readFileSync(manifestPath, 'utf8'))
      } catch {
        m = {}
      }
    }
    if (!m || typeof m !== 'object' || Array.isArray(m)) m = {}
    m.sfAutoResolved = flag
    mkdirSync(dirname(manifestPath), { recursive: true })
    writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n')
  } catch {
    /* best-effort — a manifest write must never crash the (optional) pass */
  }
}

function writeAutoResolve(outputPath, ar) {
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, JSON.stringify(ar, null, 2) + '\n')
}

/**
 * IMPURE executor. Runs the reliable sequence, DEGRADING EACH STEP INDEPENDENTLY
 * in its own try/catch (one failed query degrades ITS OWN row(s); the rest still
 * run and the manifest flag still writes — the describe-first "degrade per-field"
 * doctrine). NO consent gate (read-only Tooling). When no DevHub is authed it sets
 * `sfAutoResolved:false` and returns WITHOUT spawning. The `runner` spawn seam is
 * injectable so the standing test proves every path offline.
 *   opts: { target, devhub, generated(date string), runner }
 */
export function runSfAutoResolve(plan, { target, devhub, generated, runner = defaultRun } = {}) {
  const dh = devhub || plan.devhub || null
  const manifestPath = join(target, plan.manifestRel)
  const outputPath = join(target, plan.outputRel)
  const stamp = generated || new Date().toISOString().slice(0, 10)

  const hub = devHubStatus(runner)
  if (!hub.authed) {
    setManifestFlag(manifestPath, false)
    return { status: 'no-devhub', reason: hub.hint, sfAutoResolved: false, manifestPath }
  }

  let resolvedPackageId = plan.packageId || null
  let resolvedVersionId = plan.versionId || null
  const rows = []
  const stepLog = []

  for (const step of plan.steps) {
    try {
      if (step.key === 'resolvePackage') {
        resolvedPackageId = pickPackageId(parseSfJson(runner('sf', packageListArgv(dh))), plan.packageName)
        stepLog.push({ step: step.key, ok: !!resolvedPackageId })
      } else if (step.key === 'resolveVersion') {
        const pid = resolvedPackageId || plan.packageId
        if (!pid) {
          stepLog.push({ step: step.key, ok: false, reason: 'no package id resolved' })
          continue
        }
        resolvedVersionId = pickVersionId(parseSfJson(runner('sf', versionListArgv(pid, dh))))
        stepLog.push({ step: step.key, ok: !!resolvedVersionId })
      } else if (step.key === 'versionReport') {
        const vid = resolvedVersionId || plan.versionId
        if (!vid) {
          rows.push(...reportRowsUnknown())
          stepLog.push({ step: step.key, ok: false, reason: 'no version id resolved' })
          continue
        }
        rows.push(...reportRows(normalizeVersionReport(parseSfJson(runner('sf', versionReportArgv(vid, dh))))))
        stepLog.push({ step: step.key, ok: true })
      } else if (step.key === 'subscriberVersion') {
        const vid = resolvedVersionId || plan.versionId
        if (!vid) {
          rows.push(...keystoneRowsUnknown())
          stepLog.push({ step: step.key, ok: false, reason: 'no version id resolved' })
          continue
        }
        rows.push(...keystoneRows(parseSfJson(runner('sf', subscriberVersionArgv(vid, dh)))))
        stepLog.push({ step: step.key, ok: true })
      }
    } catch {
      // independent degradation — this step's row(s) fall back to `unknown`,
      // every remaining step still runs, and the manifest flag still writes
      if (step.key === 'versionReport') rows.push(...reportRowsUnknown())
      if (step.key === 'subscriberVersion') rows.push(...keystoneRowsUnknown())
      stepLog.push({ step: step.key, ok: false, reason: 'sf step failed — degraded to unknown' })
    }
  }

  // Assemble the render contract field-by-field (never a spread of raw `sf` output).
  // endpoints/permissions/conflicts stay [] — this thin producer owns the keystone
  // version + reviewed + report rows; the endpoint/permission inventory is a wider
  // scope not in this slice, so the render honestly shows "none recorded".
  const ar = { generated: stamp, rows, endpoints: [], permissions: [], conflicts: [] }
  if (dh) ar.devhub = dh
  writeAutoResolve(outputPath, ar)
  setManifestFlag(manifestPath, true)
  return { status: 'resolved', sfAutoResolved: true, outputPath, manifestPath, rows, steps: stepLog }
}

function main() {
  const argv = process.argv
  const arg = (f, d) => {
    const i = argv.indexOf(f)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d
  }
  const target = arg('--target', process.cwd())
  const asJson = argv.includes('--json')
  const plan = planSfAutoResolve({
    packageName: arg('--package-name', null),
    packageId: arg('--package-id', null),
    versionId: arg('--version-id', null),
    devhub: arg('--devhub', null),
  })

  // --dry-run: the planned argv sequence ONLY — no `sf` call, no writes.
  if (argv.includes('--dry-run')) {
    if (asJson) {
      process.stdout.write(JSON.stringify({ status: 'planned', plan, output: join(target, plan.outputRel) }, null, 2) + '\n')
    } else {
      const lines = plan.steps.map((s) => `  ${s.key}: sf ${s.argv.join(' ')}`)
      process.stdout.write(`## sf-autoresolve — planned (dry-run, no live op)\n${lines.join('\n')}\noutput: ${join(target, plan.outputRel)}\n`)
    }
    return
  }

  const res = runSfAutoResolve(plan, { target, devhub: arg('--devhub', null) })
  if (asJson) {
    process.stdout.write(JSON.stringify(res, null, 2) + '\n')
    return
  }
  if (res.status === 'no-devhub') {
    // the COMMON, honest path — optional/opt-in, never an error (exit 0)
    process.stdout.write(`## sf-autoresolve — no-devhub (sfAutoResolved:false)\n${res.reason}\n`)
    return
  }
  process.stdout.write(
    `## sf-autoresolve — ${res.status} (sfAutoResolved:${res.sfAutoResolved})\n` +
      `rows: ${res.rows.length}   output: ${res.outputPath}\n` +
      `render: node harness/render-sf-autoresolve.mjs --target <repo>\n`
  )
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

#!/usr/bin/env node
/**
 * package-readiness.mjs — preflight power-up precondition: is the deployed-org
 * deep audit RUNNABLE for this package? Feeds the proactive power-up gate so the
 * preflight's offer is accurate up front.
 *
 * WHY THIS EXISTS. The deployed-org deep audit installs a RELEASED package
 * version into a scratch org. `sf` being authed is necessary but NOT sufficient —
 * there must be an installable version. The preflight used to announce "deep
 * audit available (sf authed)" and only discover the blocker (a placeholder
 * package alias / no released version) later, in the scope phase — so it told the
 * operator "I have the auth" before knowing the auth was moot. This computes the
 * install-readiness UP FRONT, deterministically from sfdx-project.json, so the
 * power-up gate states the true situation the first time.
 *
 * Verdicts:
 *   installable  → a real `04t…` version-id alias exists (a built/promoted version
 *                  to install). Deep audit can run (pending sf auth + scratch org).
 *   needs-build  → a 2GP package is defined but has no installable version alias
 *                  (placeholder `0Ho…XXXX`, an unbuilt `…NEXT` versionNumber, or no
 *                  `04t` alias). Deep audit needs `build-managed-package` first.
 *   no-package   → no sfdx-project.json, or no 2GP package configured (nothing to
 *                  install; the deep audit is N/A for this listing).
 *
 * Every verdict also carries `registered` — whether a real `0Ho…` package-id alias
 * exists (the package is created against the Dev Hub, so `build-managed-package` CAN
 * cut a version). This splits the `needs-build` verdict into the two states the
 * preflight's deployed-org power-up line distinguishes: `needs-build` + registered =
 * "build first, then deep-audit"; `needs-build` + NOT registered = "can't build:
 * the package isn't created against your Dev Hub — register it first". The render
 * harness (`render-preflight.mjs`) maps (status, registered) → the fixed 4-state enum.
 *
 * PURE core (`packageReadiness`); the CLI reads the file. No LLM, no deps, no
 * network. (A live `sf package version list` confirms an alias is actually
 * PROMOTED/released — this reads the project config, which is the up-front signal.)
 *
 * NESTED PACKAGES (0.8.43). `packageReadiness` stays per-project + pure; the CLI
 * now drives it via `discoverPackages(target)`, which finds EVERY sfdx-project.json
 * under the repo at a bounded depth (root included) — so a repo whose packages live
 * in subdirectories (`salesforce/`, `salesforce-mcp/`) is classified correctly
 * instead of reading `no-package` from a root-only probe. The `--json` output keeps
 * the legacy single-package top-level shape (a single root package emits unchanged
 * keys) and ADDS a `packages[]` array + an `anyInstallable` roll-up, always.
 *
 * USAGE: node package-readiness.mjs --target <repo> [--json]
 */
import { readFileSync, readdirSync, realpathSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION_ID = /^04t[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$/ // 04t + 15/18-char subscriber-package-version id
const PACKAGE_ID = /^0Ho[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$/ // 0Ho + 15/18-char package2 id
const isPlaceholder = (v) => /X{3,}/.test(String(v || '')) // a literal XXXX placeholder, not a real id

/** Pure: classify install-readiness from a parsed sfdx-project.json (or null). */
export function packageReadiness(proj) {
  if (!proj || typeof proj !== 'object') {
    return { status: 'no-package', registered: false, reason: 'no readable sfdx-project.json (not an SFDX package project)' }
  }
  const dirs = Array.isArray(proj.packageDirectories) ? proj.packageDirectories : []
  const pkgDir = dirs.find((d) => d && d.package)
  if (!pkgDir) {
    return { status: 'no-package', registered: false, reason: 'sfdx-project.json has no packageDirectory with a `package` — source-only project, not a 2GP to install' }
  }
  const pkgName = pkgDir.package
  const aliases = proj.packageAliases && typeof proj.packageAliases === 'object' ? proj.packageAliases : {}
  // The installable artifact is a real 04t version-id alias BOUND TO THIS PACKAGE.
  // `sf package version create` writes the alias key as `${pkgName}@x.y.z-n`, so an
  // alias belongs to this package only if its key is exactly `pkgName` or starts
  // with `${pkgName}@`. Matching ANY 04t alias (the old behavior) let a stale/
  // renamed alias — or a DEPENDENCY package's 04t alias, a routine entry in
  // packageAliases — falsely mark THIS package installable and cite an unrelated
  // version, defeating the helper's whole purpose. (truth-audit, next checkpoint.)
  const isThisPkg = (key) => key === pkgName || key.startsWith(`${pkgName}@`)
  const versionAlias = Object.entries(aliases).find(
    ([k, v]) => isThisPkg(k) && VERSION_ID.test(String(v)) && !isPlaceholder(v)
  )
  if (versionAlias) {
    return {
      status: 'installable',
      // An installable version implies the package is created against the Dev Hub.
      registered: true,
      package: pkgName,
      versionAlias: versionAlias[0],
      reason: `version alias '${versionAlias[0]}' → ${versionAlias[1]} is present — installable into a scratch org (confirm it is PROMOTED via \`sf package version list\` before relying on it)`,
    }
  }
  // No installable version — diagnose why, for the proactive gate's message.
  const pkgIdAlias = aliases[pkgName]
  // `registered`: a real 0Ho package-id alias exists, so the package is created against
  // the Dev Hub and `build-managed-package` can cut a version. A missing/placeholder/
  // non-0Ho alias means the package itself is not registered yet — `sf package create` first.
  const registered = !!pkgIdAlias && !isPlaceholder(pkgIdAlias) && PACKAGE_ID.test(String(pkgIdAlias))
  const why = []
  if (!pkgIdAlias) why.push('no package-id alias')
  else if (isPlaceholder(pkgIdAlias)) why.push(`package alias is a placeholder (${pkgIdAlias})`)
  else if (!PACKAGE_ID.test(String(pkgIdAlias))) why.push(`package alias '${pkgIdAlias}' is not a 0Ho package id`)
  if (/\.NEXT$/i.test(String(pkgDir.versionNumber || ''))) why.push(`versionNumber ${pkgDir.versionNumber} is unbuilt (.NEXT)`)
  why.push('no 04t version alias')
  return {
    status: 'needs-build',
    registered,
    package: pkgName,
    reason: `package '${pkgName}' is defined but has no installable released version (${why.join('; ')}) — ${registered ? 'run build-managed-package before a deployed-org deep audit' : 'the package is not created against your Dev Hub yet — `sf package create`, then build-managed-package, before a deployed-org deep audit'}`,
  }
}

// Directories never worth descending for an SFDX package (deps / VCS / our own
// machine-state). `.`-prefixed dirs are skipped wholesale below; `node_modules`
// is the one non-dot dir that has to be named explicitly.
const SKIP_DIRS = new Set(['node_modules'])

/**
 * Discover EVERY sfdx-project.json under `target` (root included) at a bounded
 * depth, and run the pure `packageReadiness` on each. The headline 0.8.43 fix:
 * a repo whose SFDX packages live in SUBDIRECTORIES (e.g. `salesforce/` +
 * `salesforce-mcp/`, the nested-package layout a real cold run hit) returned
 * `no-package` from a root-only read, forcing the journey to LLM-grep + re-run
 * per directory. This makes the discovery deterministic.
 *
 * Returns `[{ dir, relPath, readiness }, …]` sorted root-first then by relPath.
 * Pure-ish: the only I/O is read-only directory/file reads (no mutation, no
 * network); a single repo state maps to a single result. `packageReadiness`
 * itself stays per-project + pure.
 */
export function discoverPackages(target, { maxDepth = 4 } = {}) {
  const root = String(target || '.')
  const found = []
  const walk = (dir, depth) => {
    if (depth > maxDepth) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    if (entries.some((e) => e.isFile() && e.name === 'sfdx-project.json')) {
      let proj = null
      try { proj = JSON.parse(readFileSync(join(dir, 'sfdx-project.json'), 'utf8')) } catch {}
      const rel = relative(root, dir)
      found.push({ dir, relPath: rel === '' ? '.' : rel, readiness: packageReadiness(proj) })
    }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name)) {
        walk(join(dir, e.name), depth + 1)
      }
    }
  }
  walk(root, 0)
  found.sort((a, b) =>
    a.relPath === '.' ? -1 : b.relPath === '.' ? 1 : a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0
  )
  return found
}

// Most-actionable ordering for the roll-up: installable (deep audit READY) >
// needs-build+registered (buildable) > needs-build+unregistered > no-package.
function actionabilityRank(r) {
  if (!r) return -1
  if (r.status === 'installable') return 3
  if (r.status === 'needs-build') return r.registered ? 2 : 1
  return 0
}

/** The single readiness that best represents a discovered set (the roll-up rep). */
export function rollupReadiness(pkgs) {
  if (!Array.isArray(pkgs) || !pkgs.length) return packageReadiness(null)
  let best = pkgs[0].readiness
  let bestRank = actionabilityRank(best)
  for (let i = 1; i < pkgs.length; i++) {
    const rank = actionabilityRank(pkgs[i].readiness)
    if (rank > bestRank) { best = pkgs[i].readiness; bestRank = rank }
  }
  return best
}

function main() {
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d }
  const TARGET = arg('--target', process.cwd())
  const AS_JSON = process.argv.includes('--json')
  const pkgs = discoverPackages(TARGET)
  const rep = rollupReadiness(pkgs)
  const anyInstallable = pkgs.some((p) => p.readiness.status === 'installable')
  if (AS_JSON) {
    // Back-compat: the roll-up representative's fields stay at the TOP LEVEL, so a
    // single-root-package repo emits the legacy `{ status, registered, reason, … }`
    // shape unchanged (render-preflight + scope-submission read those keys). The
    // `packages[]` array + `anyInstallable` roll-up are ADDED on top, always.
    const out = {
      ...rep,
      packages: pkgs.map((p) => ({ dir: p.dir, relPath: p.relPath, readiness: p.readiness })),
      anyInstallable,
    }
    process.stdout.write(JSON.stringify(out, null, 2) + '\n')
  } else if (pkgs.length <= 1) {
    process.stdout.write(`[${rep.status}] ${rep.reason}\n`) // byte-identical to the pre-0.8.43 single line
  } else {
    const L = [`[${rep.status}] roll-up across ${pkgs.length} packages (anyInstallable=${anyInstallable}) — most-actionable shown; per-package:`]
    for (const p of pkgs) L.push(`  • ${p.relPath}: [${p.readiness.status}] ${p.readiness.reason}`)
    process.stdout.write(L.join('\n') + '\n')
  }
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) }
  catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

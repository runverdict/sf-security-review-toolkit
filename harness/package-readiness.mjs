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
 * PURE core (`packageReadiness`); the CLI reads the file. No LLM, no deps, no
 * network. (A live `sf package version list` confirms an alias is actually
 * PROMOTED/released — this reads the project config, which is the up-front signal.)
 *
 * USAGE: node package-readiness.mjs --target <repo> [--json]
 */
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION_ID = /^04t[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$/ // 04t + 15/18-char subscriber-package-version id
const PACKAGE_ID = /^0Ho[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$/ // 0Ho + 15/18-char package2 id
const isPlaceholder = (v) => /X{3,}/.test(String(v || '')) // a literal XXXX placeholder, not a real id

/** Pure: classify install-readiness from a parsed sfdx-project.json (or null). */
export function packageReadiness(proj) {
  if (!proj || typeof proj !== 'object') {
    return { status: 'no-package', reason: 'no readable sfdx-project.json (not an SFDX package project)' }
  }
  const dirs = Array.isArray(proj.packageDirectories) ? proj.packageDirectories : []
  const pkgDir = dirs.find((d) => d && d.package)
  if (!pkgDir) {
    return { status: 'no-package', reason: 'sfdx-project.json has no packageDirectory with a `package` — source-only project, not a 2GP to install' }
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
      package: pkgName,
      versionAlias: versionAlias[0],
      reason: `version alias '${versionAlias[0]}' → ${versionAlias[1]} is present — installable into a scratch org (confirm it is PROMOTED via \`sf package version list\` before relying on it)`,
    }
  }
  // No installable version — diagnose why, for the proactive gate's message.
  const pkgIdAlias = aliases[pkgName]
  const why = []
  if (!pkgIdAlias) why.push('no package-id alias')
  else if (isPlaceholder(pkgIdAlias)) why.push(`package alias is a placeholder (${pkgIdAlias})`)
  else if (!PACKAGE_ID.test(String(pkgIdAlias))) why.push(`package alias '${pkgIdAlias}' is not a 0Ho package id`)
  if (/\.NEXT$/i.test(String(pkgDir.versionNumber || ''))) why.push(`versionNumber ${pkgDir.versionNumber} is unbuilt (.NEXT)`)
  why.push('no 04t version alias')
  return {
    status: 'needs-build',
    package: pkgName,
    reason: `package '${pkgName}' is defined but has no installable released version (${why.join('; ')}) — run build-managed-package before a deployed-org deep audit`,
  }
}

function main() {
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d }
  const TARGET = arg('--target', process.cwd())
  const AS_JSON = process.argv.includes('--json')
  let proj = null
  try { proj = JSON.parse(readFileSync(join(TARGET, 'sfdx-project.json'), 'utf8')) } catch {}
  const r = packageReadiness(proj)
  if (AS_JSON) process.stdout.write(JSON.stringify(r, null, 2) + '\n')
  else process.stdout.write(`[${r.status}] ${r.reason}\n`)
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) }
  catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

#!/usr/bin/env node
/*
 * namespace-check.mjs — the deployed-org deep-audit BUILD precondition (0.7.2). When
 * package-readiness = needs-build, the deep audit must first cut a managed 2GP — which
 * can only succeed if the package's namespace is REGISTERED + linked to the authed Dev
 * Hub. This reports whether that's confirmable, so the gate offers "build it" ONLY when
 * the build can actually work (mirrors docker-check / package-readiness). A real cold
 * run surfaced the gap: the gate offered a build that would have failed at
 * `sf package version create` (fictional namespace, not linked) AND mutated the repo
 * with packaging scaffolding first. See docs/roadmap-0.7.0-throwaway-dast-harness.md.
 *
 * THE HONEST SIGNAL (no CLI lists Dev-Hub namespace registries cleanly): a namespace is
 * confirmed-buildable iff an AUTHED org carries that `namespacePrefix` (you auth the
 * namespace DE org during packaging setup). We err CONSERVATIVE — only confirm when the
 * signal is positive; otherwise show the prerequisite and DON'T offer the build. We never
 * falsely claim "impossible" (we can't see the registry), only "can't confirm → set it up".
 *
 * NO namespace-corruption risk exists either way: a build USES a registered namespace, it
 * never registers/hijacks one, and it operates on the package's OWN declared namespace.
 *
 * NESTED LAYOUTS (0.8.107): the namespace read goes through `discoverPackages` —
 * a repo with NO root sfdx-project.json but nested package dirs (e.g.
 * `salesforce/` + `salesforce-mcp/`, both declaring a namespace) used to read
 * `pkgNamespace=''` from the root-only probe and FAIL OPEN into the
 * "no namespace declared → buildable" branch. This 0.7.2 gate exists to err
 * CONSERVATIVE: `collectDeclaredNamespaces` gathers every declared namespace
 * across the nested layout, and if ANY package declares one it must be confirmed
 * against an authed org — never silently `buildable:true`.
 *
 * Pure `classifyNamespace` + pure (read-only-fs) `collectDeclaredNamespaces` +
 * impure `namespaceStatus`. USAGE: node namespace-check.mjs --target <repo> [--json]
 */
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { sfEnv, parseSfJson } from './sf-env.mjs'
import { discoverPackages } from './package-readiness.mjs'

/** PURE: from the package namespace + the authed-org facts, classify build-feasibility. */
export function classifyNamespace({ pkgNamespace, authedNamespaces = [], hasDevHub = false } = {}) {
  const ns = String(pkgNamespace || '').trim()
  if (!hasDevHub) {
    return { buildable: false, namespace: ns || null, reason: 'no Dev Hub authed — building a managed 2GP needs one (`sf org login` a Dev Hub), then register the namespace. Not offering the build.' }
  }
  if (!ns) {
    // no namespace declared → an unlocked / no-namespace package; namespace registration is
    // not the blocker (package-readiness covers the rest). The namespace gate is satisfied.
    return { buildable: true, namespace: null, reason: 'no namespace declared (no namespace registration required for the build)' }
  }
  if (authedNamespaces.includes(ns)) {
    return { buildable: true, namespace: ns, reason: `namespace '${ns}' is registered (an authed org carries it) — the 2GP build can proceed` }
  }
  return {
    buildable: false, namespace: ns,
    reason: `namespace '${ns}' is NOT confirmed registered to your Dev Hub — no authed org carries it. A managed 2GP build will fail at \`sf package version create\` unless '${ns}' is registered (a namespace DE org) and linked under the Dev Hub's Namespace Registries. Register + link it first, then re-run. Not offering the build.`,
  }
}

/**
 * PURE (read-only fs, deterministic, no `sf`): the SET of namespaces declared by
 * EVERY sfdx-project.json under `target` — root AND nested (via `discoverPackages`,
 * bounded depth). A root-only read fails OPEN on nested layouts: no root
 * sfdx-project.json → `''` → the "no namespace declared → buildable" branch, even
 * though the nested packages DO declare one. `discoverPackages` returns readiness,
 * not the declared namespace, so each hit's sfdx-project.json is re-read here.
 * Empty/absent/unreadable `namespace` contributes nothing (declares no namespace).
 */
export function collectDeclaredNamespaces(target = process.cwd()) {
  const namespaces = new Set()
  for (const pkg of discoverPackages(target)) {
    try {
      const ns = (JSON.parse(readFileSync(join(pkg.dir, 'sfdx-project.json'), 'utf8')).namespace || '').trim()
      if (ns) namespaces.add(ns)
    } catch { /* unreadable project file → declares no namespace */ }
  }
  return namespaces
}

/** IMPURE: the declared namespaces (root + nested) + the authed orgs from sf. */
export function namespaceStatus(target = process.cwd()) {
  const declared = [...collectDeclaredNamespaces(target)]
  let authedNamespaces = []
  let hasDevHub = false
  try {
    const r = parseSfJson(execFileSync('sf', ['org', 'list', '--json'], { encoding: 'utf8', timeout: 20000, env: sfEnv() })).result || {}
    const orgs = [...(r.nonScratchOrgs || []), ...(r.scratchOrgs || []), ...(r.other || []), ...(r.devHubs || [])]
    authedNamespaces = [...new Set(orgs.map((o) => o && o.namespacePrefix).filter(Boolean))]
    hasDevHub = orgs.some((o) => o && o.isDevHub)
  } catch { /* no sf / not authed → hasDevHub stays false */ }
  // No namespace declared anywhere (root or nested) → the genuine no-namespace branch.
  if (!declared.length) return classifyNamespace({ pkgNamespace: '', authedNamespaces, hasDevHub })
  // Conservative across a nested layout: EVERY declared namespace must classify
  // buildable; the first unconfirmed one decides (never silently buildable:true).
  let last = null
  for (const ns of declared) {
    const r = classifyNamespace({ pkgNamespace: ns, authedNamespaces, hasDevHub })
    if (!r.buildable) return r
    last = r
  }
  return last
}

function main() {
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d }
  const r = namespaceStatus(arg('--target', process.cwd()))
  if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(r, null, 2) + '\n')
  else process.stdout.write(`[namespace:${r.buildable ? 'buildable' : 'not-confirmed'}] ${r.reason}\n`)
  process.exitCode = r.buildable ? 0 : 3
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) }
  catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

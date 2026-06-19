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
 * Pure `classifyNamespace` + impure `namespaceStatus`. USAGE: node namespace-check.mjs --target <repo> [--json]
 */
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

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

/** IMPURE: read the package namespace from sfdx-project.json + the authed orgs from sf. */
export function namespaceStatus(target = process.cwd()) {
  let pkgNamespace = ''
  try { pkgNamespace = (JSON.parse(readFileSync(join(target, 'sfdx-project.json'), 'utf8')).namespace || '').trim() } catch {}
  let authedNamespaces = []
  let hasDevHub = false
  try {
    const r = JSON.parse(execFileSync('sf', ['org', 'list', '--json'], { encoding: 'utf8', timeout: 20000 })).result || {}
    const orgs = [...(r.nonScratchOrgs || []), ...(r.scratchOrgs || []), ...(r.other || []), ...(r.devHubs || [])]
    authedNamespaces = [...new Set(orgs.map((o) => o && o.namespacePrefix).filter(Boolean))]
    hasDevHub = orgs.some((o) => o && o.isDevHub)
  } catch { /* no sf / not authed → hasDevHub stays false */ }
  return classifyNamespace({ pkgNamespace, authedNamespaces, hasDevHub })
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

#!/usr/bin/env node
/*
 * tool-detect.mjs — deterministic scan-tool detector (0.6.0 preflight foundation).
 *
 * Reports, per scan family, which local scanner tools are PRESENT, so the preflight's
 * single up-front consent gate can state the true situation the first time AND — on
 * explicit consent — offer to install the missing INSTALLABLE ones to a tool-scoped
 * temp dir for the run (then remove them at cleanup, keeping the evidence). See
 * docs/roadmap-0.6.0-preflight-autogate.md.
 *
 * DETECTION ONLY. It never installs, never fetches, never mutates anything — it just
 * probes PATH (`which`-equivalent). Pure core `detectTools(pathStr)` + a CLI that reads
 * process.env.PATH. No deps, no network, byte-identical for a given PATH.
 *
 * The P0 line it serves: an absent scanner is PENDING-OWNER-RUN unless the operator
 * EXPLICITLY consents to a tmp install (silence-is-yes never covers a network install).
 * This file only tells you what's there; the install is a separate, consented step.
 *
 * USAGE: node tool-detect.mjs [--path <PATH>] [--json]
 */
import { accessSync, constants } from 'node:fs'
import { join, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import { realpathSync } from 'node:fs'

// Scan families ↔ the tools that satisfy each, with how a missing one is obtained.
// install: 'pip' | 'binary' | 'npm' | 'git'  → installable to a tmp dir on consent.
//          'code-analyzer-stack'              → consented tmp-install of the WHOLE Code Analyzer
//                                               stack (the pinned `@salesforce/cli` + the
//                                               `code-analyzer` plugin + a JDK 11+, detect-or-provision).
//          'owner'                            → the operator installs it themselves (e.g. ZAP).
// owner_portal: true                          → not locally runnable at all (Checkmarx portal).
const FAMILIES = [
  {
    key: 'code-analyzer', label: 'Salesforce Code Analyzer + Graph Engine (package SAST/SFGE)',
    tools: [{ name: 'sf', bins: ['sf'], install: 'code-analyzer-stack', hint: 'present `sf`+plugin used as-is; else consented tmp-install of @salesforce/cli + the code-analyzer plugin + a JDK 11+ (detect-or-provision, pinned Temurin) — ~1 GB (+~320 MB if Java must be provisioned), removed at cleanup; deterministic CRUD/FLS (`-r sfge` for FLS)' }],
  },
  {
    key: 'source-code-scanner', label: 'Checkmarx Source Code Scanner', owner_portal: true, tools: [],
    note: 'owner-run on the Partner Security Portal (auth + 3 runs/version) — NOT locally installable; the toolkit predicts findings (run-scans Family 2)',
  },
  {
    key: 'secret-scan', label: 'Secret scan (tree + full git history)',
    tools: [
      { name: 'gitleaks', bins: ['gitleaks'], install: 'binary', hint: 'download the gitleaks release binary' },
      { name: 'detect-secrets', bins: ['detect-secrets'], install: 'pip', hint: 'pip install detect-secrets' },
    ],
    note: 'the toolkit also ships a deterministic git-history secret scan — this family is never fully blocked',
  },
  {
    key: 'dependency-audit', label: 'Dependency vulnerabilities (SCA over the package tree)',
    tools: [
      { name: 'npm', bins: ['npm'], install: 'owner', hint: 'comes with Node; `npm audit` needs a lockfile' },
      { name: 'retire', bins: ['retire'], install: 'npm', hint: 'npm i -g retire (or npx retire)' },
    ],
  },
  {
    key: 'external-sast', label: 'External SAST (Semgrep keystone)',
    tools: [
      { name: 'semgrep', bins: ['semgrep'], install: 'pip', hint: 'pip install semgrep' },
      { name: 'bandit', bins: ['bandit'], install: 'pip', hint: 'pip install bandit (Python)' },
      { name: 'njsscan', bins: ['njsscan'], install: 'pip', hint: 'pip install njsscan (Node)' },
      { name: 'gosec', bins: ['gosec'], install: 'binary', hint: 'download the gosec release binary (Go)' },
    ],
  },
  {
    key: 'external-sca-iac', label: 'External SCA + IaC (OSV-Scanner / Checkov)',
    tools: [
      { name: 'osv-scanner', bins: ['osv-scanner'], install: 'binary', hint: 'download the osv-scanner release binary' },
      { name: 'checkov', bins: ['checkov'], install: 'pip', hint: 'pip install checkov' },
      { name: 'trivy', bins: ['trivy'], install: 'binary', hint: 'download the trivy release binary' },
    ],
  },
  {
    key: 'dast', label: 'Authenticated DAST',
    tools: [
      // ZAP is owner-run by nature — a ~hundreds-of-MB Java GUI app needing a JRE, not a
      // single pinnable static binary; run-scans Family 3 already treats it as owner-executed.
      { name: 'zap', bins: ['zap.sh', 'zaproxy'], install: 'owner', hint: 'install OWASP ZAP (Java app + JRE) yourself — it is not a tmp-installable static binary; nuclei + schemathesis cover the automatable DAST surface' },
      { name: 'nuclei', bins: ['nuclei'], install: 'binary', hint: 'download the nuclei release binary' },
      { name: 'schemathesis', bins: ['schemathesis'], install: 'pip', hint: 'pip install schemathesis (OpenAPI fuzzing)' },
    ],
  },
  {
    key: 'tls', label: 'TLS grading (local)',
    tools: [
      { name: 'testssl', bins: ['testssl.sh', 'testssl'], install: 'git', hint: 'git clone testssl.sh' },
      { name: 'sslyze', bins: ['sslyze'], install: 'pip', hint: 'pip install sslyze' },
    ],
    note: 'or the SSL Labs API (network, no local tool)',
  },
]

const INSTALLABLE = new Set(['pip', 'binary', 'npm', 'git', 'code-analyzer-stack'])

/** Resolve a binary on a PATH string → its absolute path, or null. Executable-bit checked. */
export function whichOn(bin, pathStr) {
  for (const dir of String(pathStr || '').split(delimiter)) {
    if (!dir) continue
    const p = join(dir, bin)
    try { accessSync(p, constants.X_OK); return p } catch { /* not here / not executable */ }
  }
  return null
}

/** Pure: classify every scan family's tool availability from a PATH string. */
export function detectTools(pathStr) {
  const families = FAMILIES.map((f) => {
    const tools = f.tools.map((t) => {
      const path = t.bins.map((b) => whichOn(b, pathStr)).find(Boolean) || null
      return { name: t.name, present: !!path, path, install: t.install, hint: t.hint }
    })
    const satisfied = !!f.owner_portal || tools.some((t) => t.present)
    return { key: f.key, label: f.label, owner_portal: !!f.owner_portal, note: f.note, satisfied, tools }
  })
  const present_tools = []
  const installable_missing = []
  const owner_missing = []
  for (const f of families) {
    for (const t of f.tools) {
      if (t.present) present_tools.push({ name: t.name, family: f.key, path: t.path })
      else if (INSTALLABLE.has(t.install)) installable_missing.push({ name: t.name, family: f.key, install: t.install, hint: t.hint })
      else if (t.install === 'owner') owner_missing.push({ name: t.name, family: f.key, hint: t.hint })
    }
  }
  // de-dup installable_missing by name (a tool can't appear twice, but be safe)
  const seen = new Set()
  const installable = installable_missing.filter((x) => (seen.has(x.name) ? false : seen.add(x.name)))
  return {
    families,
    summary: {
      satisfied_families: families.filter((f) => f.satisfied).map((f) => f.key),
      unsatisfied_families: families.filter((f) => !f.satisfied).map((f) => f.key),
      present_tools,
      installable_missing: installable,
      owner_missing,
      owner_portal_only: families.filter((f) => f.owner_portal).map((f) => f.key),
    },
  }
}

function main() {
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d }
  const PATH = arg('--path', process.env.PATH || '')
  const AS_JSON = process.argv.includes('--json')
  const r = detectTools(PATH)
  if (AS_JSON) { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); return }
  const L = ['## Scan-tool detection (deterministic — no install performed)', '']
  for (const f of r.families) {
    const mark = f.satisfied ? '✓' : '·'
    const tl = f.owner_portal ? 'owner-portal (not locally runnable)' : f.tools.map((t) => `${t.name}${t.present ? '✓' : '✗'}`).join(' ')
    L.push(`${mark} ${f.label}\n    ${tl}`)
  }
  L.push('')
  L.push(`Satisfied families: ${r.summary.satisfied_families.length}/${r.families.length}`)
  if (r.summary.installable_missing.length)
    L.push(`Installable-on-consent (would go to a tmp dir, removed at cleanup): ${r.summary.installable_missing.map((x) => `${x.name} (${x.install})`).join(', ')}`)
  if (r.summary.owner_missing.length)
    L.push(`Owner must install: ${r.summary.owner_missing.map((x) => x.name).join(', ')}`)
  process.stdout.write(L.join('\n') + '\n')
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) } catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

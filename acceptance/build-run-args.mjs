#!/usr/bin/env node
/*
 * build-run-args.mjs — assemble the audit-engine run-args for the acceptance run.
 *
 * Mechanically performs the audit-codebase §5 step: read the fixture's
 * target-map + scope-manifest, extract each applicable dimension's §4
 * "Threat focus" finder prompt verbatim from its dimension file, build the
 * run-args object, and inject it into a project-local copy of the workflow
 * template. The main loop then invokes the Workflow tool with scriptPath =
 * the injected copy. No hand-authored finder prompts — they come straight
 * from the dimension files under test.
 *
 * Usage: node build-run-args.mjs <pluginRoot> <targetRepo> <runDate>
 */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

// Portable defaults: the plugin root resolves from this file's own location
// (acceptance/ → repo root), and the fixture repo defaults under the caller's
// home dir — both overridable by argv so no machine-specific path is baked in.
const PLUGIN_ROOT = process.argv[2] || fileURLToPath(new URL('..', import.meta.url))
const REPO = process.argv[3] || join(homedir(), 'srt-helios')
const RUN_DATE = process.argv[4] || '2026-06-15'
// Optional: argv[5] = comma-separated dimension allowlist (focused re-run);
//           argv[6] = engine/report filename suffix (so a focused re-run does
//           not overwrite the full pass-1 engine/report).
const ONLY = (process.argv[5] || '').split(',').map((s) => s.trim()).filter(Boolean)
const SUFFIX = process.argv[6] || ''

const tmap = JSON.parse(readFileSync(join(REPO, '.security-review/target-map.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(join(REPO, '.security-review/scope-manifest.json'), 'utf8'))

// Extract the §4 "Threat focus" finder prompt from a dimension file: from the
// "Threat focus" line up to (not including) the next "### 4.1" or "## 5".
function threatFocus(key) {
  const md = readFileSync(join(PLUGIN_ROOT, 'methodology/dimensions', key + '.md'), 'utf8')
  const lines = md.split('\n')
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (/Threat focus/.test(lines[i]) && start === -1) { start = i; break }
  }
  if (start === -1) throw new Error('no Threat focus block in ' + key)
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^### 4\.1/.test(lines[i]) || /^## 5\./.test(lines[i])) { end = i; break }
  }
  let block = lines.slice(start, end).join('\n').trim()
  // Strip a leading "Threat focus —/-/:" lead-in so the template's own
  // "Threat focus:\n" prefix doesn't double it.
  block = block.replace(/^Threat focus\s*[—:-]\s*/, '')
  return block
}

// Extract the dimension's §5 Verifier guidance + §6 Known false-positive
// patterns (from "## 5." to the next "## 7"+ heading or EOF) — the refute rules
// the engine threads into each verifier so declaration-level violations are not
// over-refuted on a "no live caller / dormant config" rationale.
function verifierGuidance(key) {
  const md = readFileSync(join(PLUGIN_ROOT, 'methodology/dimensions', key + '.md'), 'utf8')
  const lines = md.split('\n')
  const start = lines.findIndex((l) => /^## 5\. /.test(l))
  if (start < 0) return ''
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^## (\d+)\./)
    if (m && Number(m[1]) >= 7) { end = i; break }
  }
  return lines.slice(start, end).join('\n').trim()
}

let applicable = tmap.dimensions.filter((d) => d.applicable && Array.isArray(d.targets) && d.targets.length)
if (ONLY.length) applicable = applicable.filter((d) => ONLY.includes(d.key))
const dimensions = applicable.map((d) => ({
  key: d.key,
  targets: d.targets.join('\n'),
  stackNotes: d.stack_notes || '',
  finderPrompt: threatFocus(d.key),
  verifierNotes: verifierGuidance(d.key),
}))

const claims = manifest.securityModelClaims || {}
const runArgs = {
  repoRoot: REPO,
  scopeManifestPath: join(REPO, '.security-review/scope-manifest.json'),
  tier: 'standard',
  passNumber: 1,
  runDate: RUN_DATE,
  reportPath: join(REPO, `docs/security-review/audit-report-${RUN_DATE}-pass1${SUFFIX ? '-' + SUFFIX : ''}.md`),
  ledger: '',
  context: {
    productOneLiner:
      'Helios Service Agent — a packaged Agentforce customer-support service agent (managed 2GP) with custom agent actions (Apex + Flow), prompt templates, LWC/Aura/VF components, and a companion Node webhook',
    reviewSurfaces:
      'the managed package (packaged Agentforce agent metadata + Apex + LWC/Aura/VF + flows + trusted-host config), and the partner-hosted Node webhook endpoint. Salesforce installs the package in a clean org and pen-tests the agent + exposed Apex.',
    stackSummary:
      'Salesforce managed 2GP (namespace helios, sourceApiVersion 59.0 → Apex defaults to system-mode + without-sharing on undeclared classes); Agentforce service agent; LWC/Aura/Visualforce; companion Express/Node webhook',
    securityModelClaims:
      (claims.tenancy ? `Tenancy: ${claims.tenancy}. ` : '') +
      (claims.isolation ? `Isolation: ${claims.isolation}. ` : '') +
      (claims.note ? claims.note : '') +
      ' Verify every claim against the ACTUAL code; do not assume.',
  },
  dimensions,
}

// Inject into a project-local copy of the workflow template.
mkdirSync(join(REPO, '.security-review'), { recursive: true })
const enginePath = join(REPO, `.security-review/audit-engine${SUFFIX ? '-' + SUFFIX : ''}.mjs`)
copyFileSync(join(PLUGIN_ROOT, 'harness/workflow-template.mjs'), enginePath)
let engine = readFileSync(enginePath, 'utf8')
const marker = 'const INJECTED = /* {{ARGS_OBJECT}} */ null'
if (!engine.includes(marker)) throw new Error('INJECTED marker not found in template')
engine = engine.replace(marker, 'const INJECTED = ' + JSON.stringify(runArgs, null, 2))
writeFileSync(enginePath, engine)

// Pre-check: the injected object must parse as JSON (per the skill's guidance —
// do NOT node --check the whole module; its top-level return is legal only in
// the Workflow runtime).
JSON.parse(JSON.stringify(runArgs))

console.log('engine written:', enginePath)
console.log('tier:', runArgs.tier, '| pass:', runArgs.passNumber, '| runDate:', RUN_DATE)
console.log('dimensions (' + dimensions.length + '):', dimensions.map((d) => d.key).join(', '))
for (const d of dimensions) {
  console.log(`  - ${d.key}: ${d.targets.split('\n').length} targets, finderPrompt ${d.finderPrompt.length} chars`)
}

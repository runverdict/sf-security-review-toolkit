#!/usr/bin/env node
/*
 * build-artifact-engine.mjs — assembles the generate-artifacts drafting run-args and
 * injects them into a project-local copy of harness/artifact-workflow-template.mjs.
 * The P2 analog of build-audit-engine.mjs: SHIPPED engine code invoked with DATA —
 * NOT an LLM-authored per-run Workflow script.
 *
 * WHY. The audit phase already moved scope into scope-input.json so the driver stops
 * hand-authoring a Workflow with inline prompt strings (the JS-escaping/parse-error
 * class — nested backticks, regex, `{status:'ok'}`). The ARTIFACT phase was still
 * pre-P2: the driver hand-authored .security-review/artifact-engine.mjs per run. This
 * engine ends that — the per-artifact content contract (`focus`) and the shared facts
 * live in DATA, never in JS.
 *
 * The driver supplies its drafting plan as DATA (artifact-input.json). This engine does
 * the MECHANICAL assembly:
 *   - reads each artifact's template (templates/<tmpl>) and attaches it pre-read
 *     (THROWS loud on a missing template — a weak model handed an empty template drafts
 *     nothing, the failure mode this guards; mirrors build-audit-engine.extract);
 *   - validates each `focus` is present (the content contract must live in DATA);
 *   - ENGINE-ENFORCED GATE: drops any artifact whose key is in gate.suppress, so a
 *     withheld doc (e.g. authn-authz-flow over an open authN/authZ hole) PHYSICALLY
 *     cannot be drafted by the Workflow — same fail-closed posture as the audit engine;
 *   - injects the run-args into a copy of artifact-workflow-template.mjs at the marker.
 *
 * Read-only on partner source; writes only <target>/.security-review/artifact-engine.mjs.
 *
 * Usage:
 *   node build-artifact-engine.mjs --plugin <pluginRoot> --repo <target> --input <artifact-input.json>
 *
 * artifact-input.json:
 *   {
 *     "runDate": "YYYY-MM-DD",
 *     "facts": "the shared authoritative facts string (tool inventory, identity model,
 *               session-ID posture, hosts/regions, data classes, controls narrative)",
 *     "gate": <the harness/artifact-gate.mjs --json result, OR { "suppress": ["authn-authz-flow"] }>,
 *     "artifacts": [
 *       { "key": "authn-authz-flow", "tmpl": "authn-authz-flow.md.tmpl",
 *         "out": "docs/security-review/authn-authz-flow.md",
 *         "focus": "the per-artifact content contract — what this doc must contain" }
 *     ]
 *   }
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

function arg(flag, def) {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const PLUGIN = arg('--plugin', null)
const REPO = arg('--repo', process.cwd())
const INPUT = arg('--input', join(REPO, '.security-review', 'artifact-input.json'))
if (!PLUGIN) { console.error('build-artifact-engine: --plugin <pluginRoot> is required'); process.exit(2) }

const readJSON = (p, def) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return def } }
const input = readJSON(INPUT, null)
if (!input) { console.error(`build-artifact-engine: cannot read artifact input ${INPUT}`); process.exit(2) }

const ARTIFACTS = Array.isArray(input.artifacts) ? input.artifacts : []
if (!ARTIFACTS.length) { console.error('build-artifact-engine: artifact-input.artifacts is empty — nothing to draft'); process.exit(2) }

const RUN_DATE = input.runDate || new Date().toISOString().slice(0, 10)
const FACTS = typeof input.facts === 'string' ? input.facts : ''
const gate = input.gate && typeof input.gate === 'object' ? input.gate : {}
const SUPPRESS = new Set(Array.isArray(gate.suppress) ? gate.suppress.map((s) => String(s)) : [])
const TMPL_DIR = join(PLUGIN, 'templates')

// A focus shorter than this is a driver bug — the content contract (what the doc must
// contain) belongs in DATA, not improvised in JS. Mirrors build-audit-engine's
// finderPrompt-too-short throw.
const FOCUS_MIN = 40

// ---- read + validate each artifact; DROP gate-suppressed ones (engine-enforced) ----
const artifacts = []
const withheld = []
for (const a of ARTIFACTS) {
  if (!a || !a.key) throw new Error('build-artifact-engine: an artifact entry is missing its key')
  // GATE ENFORCEMENT — a gate-suppressed doc (authn-authz-flow over an open authN/authZ
  // critical/high) is dropped BEFORE injection, so the Workflow physically cannot draft
  // it. The driver writes the WITHHELD placeholder separately (generate-artifacts step 6).
  if (SUPPRESS.has(String(a.key))) {
    withheld.push(a.key)
    console.error(`WARN: artifact ${a.key} withheld by the gate — not drafted`)
    continue
  }
  if (typeof a.focus !== 'string' || a.focus.trim().length < FOCUS_MIN) {
    throw new Error(
      `build-artifact-engine: artifact ${a.key} has an empty/short focus (${a.focus ? a.focus.trim().length : 0} chars) — ` +
        'the per-artifact content contract must live in the DATA, not be improvised in JS'
    )
  }
  let templateContent = null
  if (a.tmpl != null && String(a.tmpl).length) {
    const tpath = join(TMPL_DIR, String(a.tmpl))
    try { templateContent = readFileSync(tpath, 'utf8') }
    catch { throw new Error(`build-artifact-engine: template not found for artifact ${a.key} at ${tpath}`) }
  }
  artifacts.push({ key: String(a.key), tmpl: a.tmpl || null, templateContent, out: a.out || '', focus: a.focus })
}
if (!artifacts.length) {
  console.error('build-artifact-engine: every artifact was withheld by the gate — nothing to draft (write the WITHHELD placeholders driver-side)')
  process.exit(2)
}

// ---- run-args object ----
const injected = { repoRoot: REPO, runDate: RUN_DATE, facts: FACTS, artifacts }

// ---- inject into a project-local copy of the template ----
const tpl = readFileSync(join(PLUGIN, 'harness', 'artifact-workflow-template.mjs'), 'utf8')
const marker = 'const INJECTED = /* {{ARGS_OBJECT}} */ null'
if (!tpl.includes(marker)) throw new Error('build-artifact-engine: template injection marker not found in artifact-workflow-template.mjs')
const out = tpl.replace(marker, `const INJECTED = ${JSON.stringify(injected, null, 2)}`)
const sr = join(REPO, '.security-review')
mkdirSync(sr, { recursive: true })
writeFileSync(join(sr, 'artifact-engine.mjs'), out)

console.log('injected artifacts:', artifacts.map((a) => a.key).join(', '))
if (withheld.length) console.log('withheld by the gate (not drafted):', withheld.join(', '))
console.log('wrote: .security-review/artifact-engine.mjs')

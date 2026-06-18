#!/usr/bin/env node
/*
 * build-audit-engine.mjs — assembles the audit pass run-args and injects them into a
 * project-local copy of the workflow template. P2: SHIPPED engine code invoked with
 * args — NOT an LLM-authored per-run script.
 *
 * The driver supplies its SCOPING as DATA (scope-input.json: the applicable dimensions
 * with their per-dimension targets + stackNotes, the N/A list, and the run context — all
 * legitimately the model's reasoning). This engine does the MECHANICAL assembly:
 *   - deterministically extracts each dimension's §4 finder prompt + §5/§6 verifier notes
 *     from methodology/dimensions/<key>.md by marker (this is the marker-extraction that
 *     G5 hardened — shipping it as tested engine code retires the slice-fragility for good);
 *   - injects the run-args into a copy of harness/workflow-template.mjs;
 *   - writes target-map.json.
 *
 * Read-only on partner source; writes only <target>/.security-review/{audit-engine.mjs,target-map.json}.
 *
 * Usage:
 *   node build-audit-engine.mjs --plugin <pluginRoot> --repo <target> --input <scope-input.json>
 *
 * scope-input.json:
 *   {
 *     "tier": "standard", "passNumber": 1, "runDate": "YYYY-MM-DD", "ledger": "<digest or ''>",
 *     "context": { "productOneLiner": "...", "reviewSurfaces": "...", "stackSummary": "...", "securityModelClaims": "..." },
 *     "applicable": [{ "key": "crypto-internals", "targets": "server/index.js", "stackNotes": "<per-dimension repo facts>" }],
 *     "na":         [{ "key": "mcp-surface", "na_reason": "<why N/A>" }]
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
const INPUT = arg('--input', join(REPO, '.security-review', 'scope-input.json'))
if (!PLUGIN) { console.error('build-audit-engine: --plugin <pluginRoot> is required'); process.exit(2) }

const readJSON = (p, def) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return def } }
const input = readJSON(INPUT, null)
if (!input) { console.error(`build-audit-engine: cannot read scope input ${INPUT}`); process.exit(2) }

const APPLICABLE = Array.isArray(input.applicable) ? input.applicable : []
const NA = Array.isArray(input.na) ? input.na : []
if (!APPLICABLE.length) { console.error('build-audit-engine: scope-input.applicable is empty — nothing to audit'); process.exit(2) }
const RUN_DATE = input.runDate || new Date().toISOString().slice(0, 10)
const TIER = input.tier || 'standard'
const PASS = Number.isInteger(input.passNumber) ? input.passNumber : 1
const DIM_DIR = join(PLUGIN, 'methodology', 'dimensions')

// ---- marker-based extraction of finderPrompt (§4) + verifierNotes (§5+§6) ----
// Loud, deterministic. Anchors on real section headings; throws on a malformed
// dimension file rather than silently emitting an empty prompt (a weak model reading
// an empty finder prompt audits nothing — the failure mode this guards).
function extract(key) {
  let md
  try { md = readFileSync(join(DIM_DIR, `${key}.md`), 'utf8') }
  catch { throw new Error(`${key}: dimension file not found at ${join(DIM_DIR, key + '.md')}`) }

  const s4 = md.indexOf('## 4. Finder prompt block')
  if (s4 < 0) throw new Error(`${key}: no '## 4. Finder prompt block'`)
  const fenceStart = md.indexOf('```', s4)
  const fenceEnd = md.indexOf('```', fenceStart + 3)
  if (fenceStart < 0 || fenceEnd < 0) throw new Error(`${key}: §4 fenced block not found`)
  const block = md.slice(fenceStart + 3, fenceEnd)
  const tf = block.indexOf('Threat focus')
  const kf = block.indexOf('Known findings — do NOT re-report')
  if (tf < 0 || kf < 0) throw new Error(`${key}: threat-focus / known-findings markers not found`)
  let finderPrompt = block.slice(tf, kf).trim().replace(/^Threat focus\s*[—:\-]*\s*/i, '').trim()

  const s5 = md.indexOf('## 5. Verifier guidance')
  if (s5 < 0) throw new Error(`${key}: no '## 5. Verifier guidance'`)
  const verifierNotes = md.slice(s5).trim() // §5 + §6 run to EOF in every dimension file

  if (finderPrompt.length < 200) throw new Error(`${key}: finderPrompt suspiciously short (${finderPrompt.length})`)
  if (verifierNotes.length < 200) throw new Error(`${key}: verifierNotes suspiciously short (${verifierNotes.length})`)
  return { finderPrompt, verifierNotes }
}

const dimensions = APPLICABLE.map((d) => {
  if (!d.key) throw new Error('build-audit-engine: an applicable entry is missing its key')
  const { finderPrompt, verifierNotes } = extract(d.key)
  return { key: d.key, targets: d.targets || '', stackNotes: d.stackNotes || '', finderPrompt, verifierNotes }
})

// ---- run-args object ----
const injected = {
  repoRoot: REPO,
  scopeManifestPath: join(REPO, '.security-review', 'scope-manifest.json'),
  tier: TIER,
  passNumber: PASS,
  runDate: RUN_DATE,
  reportPath: join(REPO, 'docs', 'security-review', `audit-report-${RUN_DATE}-pass${PASS}.md`),
  ledger: input.ledger || '',
  context: input.context || {},
  dimensions,
}

// ---- inject into a project-local copy of the template ----
const tpl = readFileSync(join(PLUGIN, 'harness', 'workflow-template.mjs'), 'utf8')
const marker = 'const INJECTED = /* {{ARGS_OBJECT}} */ null'
if (!tpl.includes(marker)) throw new Error('build-audit-engine: template injection marker not found in workflow-template.mjs')
const out = tpl.replace(marker, `const INJECTED = ${JSON.stringify(injected, null, 2)}`)
const sr = join(REPO, '.security-review')
mkdirSync(sr, { recursive: true })
writeFileSync(join(sr, 'audit-engine.mjs'), out)

// ---- target map ----
const targetMap = {
  pass: PASS,
  generated: RUN_DATE,
  tier: TIER,
  dimensions: [
    ...APPLICABLE.map((d) => ({ key: d.key, applicable: true, targets: String(d.targets || '').split('\n').filter(Boolean), stack_notes: d.stackNotes || '', confidence: d.confidence || 'high', unresolved: !!d.unresolved })),
    ...NA.map((n) => ({ key: n.key, applicable: false, na_reason: n.na_reason || '' })),
  ],
}
writeFileSync(join(sr, 'target-map.json'), JSON.stringify(targetMap, null, 2))

console.log('injected dimensions:', dimensions.map((d) => d.key).join(', '))
console.log('finderPrompt lengths:', dimensions.map((d) => `${d.key}=${d.finderPrompt.length}`).join('  '))
console.log('wrote: .security-review/audit-engine.mjs, .security-review/target-map.json')

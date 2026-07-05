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
import { verifyConsent } from './record-consent.mjs'
import { knownDimensionKeys } from './dimension-registry.mjs'

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
let NA = Array.isArray(input.na) ? input.na : []
if (!APPLICABLE.length) { console.error('build-audit-engine: scope-input.applicable is empty — nothing to audit'); process.exit(2) }

// ---- ENGINE-ENFORCED ALWAYS-ON DIMENSIONS (WI-A) ----
// The methodology marks three dimensions unconditional/always-on for this tool, so the
// engine forces them into EVERY audit regardless of the driver's scope-input — a driver
// that forgets one silently under-covers an auto-fail class (a cold run DROPPED
// secrets-credentials, then re-added it by luck). Deterministic, fixed set, no LLM.
// Citations (methodology/audit-methodology.md applicability table):
//   sessionid-egress          — :77 ("always on when Salesforce-adjacent code exists";
//                               this is a Salesforce-review tool, so unconditional here)
//   secrets-credentials       — :78 ("always")
//   error-handling-disclosure — :91 ("always — every architecture has error/exception paths")
// (injection-xss :81 is CONDITIONAL — "always for the injection half" — and is LEFT to the
// driver; it is deliberately NOT forced here.)
const ALWAYS_ON = ['sessionid-egress', 'secrets-credentials', 'error-handling-disclosure']
// FULL_TREE_TARGET — the sentinel scope for an auto-injected always-on dimension: the WHOLE
// source tree. It is deliberately NON-EMPTY ('.'). An EMPTY targets ('') would (a) crash a
// targeted re-run — workflow-template.mjs rejected a dimension whose `!d.targets` was true, so
// re-running only `resource-consumption-abuse` died because the auto-injected always-on trio
// arrived with empty targets (BUG-B) — and (b) scope the finder to NOTHING even if the template
// didn't throw. '.' is the representation the template's finder prompt expands to "scan the
// entire repository tree rooted at <repoRoot>", matching the always-on stackNotes below.
const FULL_TREE_TARGET = '.'
{
  const present = new Set(APPLICABLE.map((d) => d && d.key))
  const autoInjected = []
  for (const key of ALWAYS_ON) {
    // An always-on dimension can never be N/A — if the driver marked it N/A, force it
    // applicable and warn loudly (de-coupling correctness from the driver's judgement).
    if (NA.some((n) => n && n.key === key)) {
      NA = NA.filter((n) => !(n && n.key === key))
      console.error(`WARN: always-on dimension ${key} cannot be N/A — forcing applicable`)
    }
    // De-dup: never inject a key the driver already listed (its targets/stackNotes win).
    if (!present.has(key)) {
      APPLICABLE.push({ key, targets: FULL_TREE_TARGET, stackNotes: 'always-on dimension (auto-injected): full source tree' })
      present.add(key)
      autoInjected.push(key)
    }
  }
  if (autoInjected.length) console.log('auto-injected always-on dimensions:', autoInjected.join(', '))
}

// ---- THE DURABLE CONSENT GATE — fail closed before assembling anything ----
// The audit fan-out PHYSICALLY CANNOT launch without the two recorded affirmative
// consents from audit-codebase Step 2 (declare the tier + get a go-ahead → gate
// 'audit-tier') and Step 3 (show the target map → gate 'audit-targetmap'). A
// skipped stop = no recorded consent = NO engine assembled = nothing for the
// Workflow tool to run. The Workflow runtime has no filesystem access, so this is
// the only place the recorded ask can be verified — and it is the load-bearing one.
const REQUIRED_GATES = ['audit-tier', 'audit-targetmap']
const missingConsent = REQUIRED_GATES.filter((g) => !verifyConsent(g, { target: REPO }))
if (missingConsent.length) {
  console.error(
    `build-audit-engine: REFUSING to assemble the audit engine — no recorded affirmative consent for: ${missingConsent.join(', ')}.\n` +
      `audit-codebase Step 2 (token tier + go-ahead) and Step 3 (show the target map) are MANDATORY stops. ` +
      `Ask via AskUserQuestion, then record each affirmative answer:\n` +
      `  node ${join(PLUGIN, 'harness', 'record-consent.mjs')} --gate <gate> --answer "<the operator's yes>" --target ${REPO}\n` +
      `Nothing is written; the fan-out cannot start until both gates are recorded.`
  )
  process.exit(3)
}
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

// ---- DIMENSION-KEY VALIDATION (cold-run fix, 0.8.82) ----
// Validate EVERY scope-input key — applicable AND N/A — against the canonical
// methodology/dimensions/*.md basenames. The N/A path previously had ZERO validation:
// a hand-written key (`tenant-isolation-web`, `oauth-identity-legacy`) sailed through
// as a "covered" N/A row, silently shrinking coverage without ever touching a
// dimension file. Runs AFTER the always-on injection (so a forced key is validated
// like any other) and BEFORE assembly. No hardcoded list — the registry reads the
// dimension-file basenames, so a new dimension file is self-registering.
{
  const known = knownDimensionKeys(PLUGIN)
  const unknown = [...APPLICABLE.map((d) => d && d.key), ...NA.map((n) => n && n.key)]
    .filter((k) => !known.has(k))
  if (unknown.length) {
    console.error(
      `build-audit-engine: unknown dimension key(s): ${unknown.map((k) => String(k)).join(', ')} — ` +
        `not in the canonical set (methodology/dimensions/*.md basenames):\n  ${[...known].sort().join(', ')}\n` +
        `Fix the key(s) in scope-input.json (a typo here silently drops audit coverage).`
    )
    process.exit(2)
  }
}

const dimensions = APPLICABLE.map((d) => {
  if (!d.key) throw new Error('build-audit-engine: an applicable entry is missing its key')
  const targets = d.targets || ''
  // A dimension with EMPTY targets is treated as a FULL-TREE scan by the template
  // (workflow-template.mjs isFullTree('') === true). That is correct + intended for the always-on
  // dimensions (auto-injected with FULL_TREE_TARGET, or a driver legitimately scoping one to the
  // whole repo). But for a NORMAL dimension an empty targets almost always means the driver forgot
  // to resolve its targets — warn LOUDLY so a hand-written scope-input.json can't SILENTLY broaden
  // a focused dimension to the entire repo. (audit-codebase's target-map step already flags this as
  // `unresolved`; this is the belt for a scope-input that bypassed that path. Not fatal — a
  // full-tree scan is broader coverage, not a hole — and pre-0.8.44 this LOUDLY crashed the
  // template; the warn preserves the loud signal without killing the run.)
  if (!String(targets).trim() && !ALWAYS_ON.includes(d.key)) {
    console.error(
      `WARN: dimension ${d.key} has no targets — it will be audited as a FULL-TREE scan (the whole repo). ` +
        `If you meant to scope it, add its targets in scope-input.json (always-on dimensions are full-tree by design).`
    )
  }
  const { finderPrompt, verifierNotes } = extract(d.key)
  return { key: d.key, targets, stackNotes: d.stackNotes || '', finderPrompt, verifierNotes }
})

// ---- run-args object ----
const injected = {
  repoRoot: REPO,
  // Set ONLY after the gate above passed — the template refuses to fan out without it.
  consentVerified: true,
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

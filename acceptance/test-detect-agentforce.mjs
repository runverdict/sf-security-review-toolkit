#!/usr/bin/env node
/**
 * Standing test for harness/detect-agentforce.mjs — the deterministic Agentforce
 * detector that replaced hand-grep detection in BOTH the journey preflight and
 * scope-submission's self-check. The defect it locks against: a live cold run's
 * preflight grepped only packaged Bot/GenAi* XML and reported "no Agentforce" for
 * a SUBSCRIBER-BUILT agent (`agent/*.agentscript.yaml` + an MCP tool as an agent
 * action); the scope phase's deep check had to correct it every run. One engine,
 * both phases — they can no longer disagree.
 *
 * AF1  packaged metadata — a Bot bot-meta.xml AND a GenAiPlannerBundle xml are each
 *      a hard `packaged-metadata` signal (bundle-suffixed tags included).
 * AF2  prompt template — genAiPromptTemplate metadata is a hard signal.
 * AF3  THE regression lock — an `agent/Ask_Acme.agentscript.yaml` alone (zero
 *      packaged XML) is detected: shape `agentscript`, confidence hard. Dropping
 *      the agentscript branch reds THIS check while AF1 stays green (the packaged
 *      fixture carries no agentscript file) — the mutation proof.
 * AF4  ESR-agent-action heuristic — an ESR with an MCP provider-type marker is
 *      detected as the WEAKER signal: shape `esr-agent-action`, confidence
 *      `heuristic` with the corroborate note, and a heuristic-ONLY repo reports
 *      top-level confidence `heuristic` (never `hard`).
 * AF5  the false-blocker negative control — a plain managed package (sfdx-project +
 *      Apex + a plain OpenAPI ESR with no MCP/agent marker) is NOT detected:
 *      agentforce is never inferred from managed-package alone, and a plain
 *      External Service is not an agent.
 * AF6  fail-safe — empty repo and ABSENT path both return {agentforce:false},
 *      never throw; the CLI exits 0 on both (a detector, not a gate).
 * AF7  determinism — same tree twice → byte-identical stdout (--json and text).
 * AF8  exclusions — an agentscript.yaml under node_modules/ is NOT a signal.
 * AF9  journey presence guard — the preflight architecture sweep runs BOTH engines
 *      (detect-agentforce + enumerate-app-roots) as granted atomic calls, and the
 *      shallow packaged-metadata-only grep prose is gone.
 * AF10 scope presence guard — scope-submission sources the agentforce self-check
 *      from the engine (granted + invoked), keeps the either-shape doctrine, and
 *      no longer prescribes the hand grep.
 * AF11 permission-set coordination — the new read-only detector is in
 *      REQUIRED_ALLOW (colon syntax), so a pre-approved default-mode run never
 *      prompts on it.
 *
 * Dependency-free: `node acceptance/test-detect-agentforce.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { detectAgentforce, EXCLUDED_DIRS, SHAPE_ORDER } from '../harness/detect-agentforce.mjs'
import { REQUIRED_ALLOW } from '../harness/emit-permission-set.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'detect-agentforce.mjs')

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) } }
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'agentforce-')); dirs.push(d); return d }
const put = (repo, rel, content) => {
  const p = join(repo, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, content)
}

const BOT_XML = '<?xml version="1.0" encoding="UTF-8"?>\n<Bot xmlns="http://soap.sforce.com/2006/04/metadata">\n  <label>Acme Assistant</label>\n</Bot>\n'
const PLANNER_XML = '<?xml version="1.0" encoding="UTF-8"?>\n<GenAiPlannerBundle xmlns="http://soap.sforce.com/2006/04/metadata">\n  <masterLabel>Acme Planner</masterLabel>\n</GenAiPlannerBundle>\n'
const PROMPT_XML = '<?xml version="1.0" encoding="UTF-8"?>\n<GenAiPromptTemplate xmlns="http://soap.sforce.com/2006/04/metadata">\n  <masterLabel>Acme Case Summary</masterLabel>\n</GenAiPromptTemplate>\n'
const AGENTSCRIPT = 'agent:\n  name: Ask Acme\n  topics:\n    - billing\n'
const ESR_MCP_XML = '<?xml version="1.0" encoding="UTF-8"?>\n<ExternalServiceRegistration xmlns="http://soap.sforce.com/2006/04/metadata">\n  <label>Acme Tools</label>\n  <registrationProviderType>McpProvider</registrationProviderType>\n  <namedCredentialReference>AcmeTools</namedCredentialReference>\n  <status>Incomplete</status>\n</ExternalServiceRegistration>\n'
const ESR_PLAIN_XML = '<?xml version="1.0" encoding="UTF-8"?>\n<ExternalServiceRegistration xmlns="http://soap.sforce.com/2006/04/metadata">\n  <label>Acme Billing API</label>\n  <schemaType>OpenApi3</schemaType>\n  <namedCredentialReference>AcmeBilling</namedCredentialReference>\n  <status>Complete</status>\n</ExternalServiceRegistration>\n'

/** A packaged-metadata-only repo (NO agentscript, NO ESR) — AF1/AF3's mutation control. */
function packagedFixture() {
  const repo = tmp()
  put(repo, 'sfdx-project.json', JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }))
  put(repo, 'force-app/main/default/bots/Acme_Assistant.bot-meta.xml', BOT_XML)
  put(repo, 'force-app/main/default/genAiPlanners/Acme_Planner.xml', PLANNER_XML) // content-detected, non-conventional name
  return repo
}

/** THE cold-run-miss repo: subscriber-built agent ONLY — zero packaged agent XML. */
function agentscriptFixture() {
  const repo = tmp()
  put(repo, 'sfdx-project.json', JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }))
  put(repo, 'force-app/main/default/classes/AcmeService.cls', 'public with sharing class AcmeService {}\n')
  put(repo, 'agent/Ask_Acme.agentscript.yaml', AGENTSCRIPT)
  return repo
}

/** Heuristic-only repo: an MCP-provider ESR, nothing else agent-shaped. */
function esrFixture() {
  const repo = tmp()
  put(repo, 'sfdx-project.json', JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }))
  put(repo, 'force-app/main/default/externalServiceRegistrations/AcmeTools.externalServiceRegistration-meta.xml', ESR_MCP_XML)
  return repo
}

/** The false-blocker control: a plain managed package shipping NO agent of any shape. */
function plainPackageFixture() {
  const repo = tmp()
  put(repo, 'sfdx-project.json', JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], namespace: 'acme' }))
  put(repo, 'force-app/main/default/classes/AcmeService.cls', 'public with sharing class AcmeService {}\n')
  put(repo, 'force-app/main/default/classes/AcmeService.cls-meta.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">\n  <apiVersion>62.0</apiVersion>\n  <status>Active</status>\n</ApexClass>\n')
  put(repo, 'force-app/main/default/externalServiceRegistrations/AcmeBilling.externalServiceRegistration-meta.xml', ESR_PLAIN_XML)
  return repo
}

console.log('detect-agentforce standing test (deterministic Agentforce detector)')

check('AF1 packaged Bot + GenAiPlannerBundle xml → hard packaged-metadata signals', () => {
  const r = detectAgentforce(packagedFixture())
  assert.equal(r.agentforce, true, 'packaged metadata is detected')
  assert.equal(r.confidence, 'hard', 'packaged metadata is a HARD signal')
  const packaged = r.signals.filter((s) => s.shape === 'packaged-metadata')
  assert.ok(packaged.some((s) => /bot-meta\.xml/.test(s.evidence)), 'the bot-meta.xml is evidence')
  assert.ok(packaged.some((s) => /Acme_Planner\.xml/.test(s.evidence)), 'the GenAiPlannerBundle content is evidence even under a non-conventional file name')
  assert.ok(packaged.every((s) => s.confidence === 'hard'))
  // mutation control for AF3: this repo carries NO agentscript signal
  assert.ok(!r.signals.some((s) => s.shape === 'agentscript'), 'the packaged fixture has no agentscript signal')
})

check('AF2 genAiPromptTemplate metadata → detected (hard)', () => {
  const repo = tmp()
  put(repo, 'force-app/main/default/genAiPromptTemplates/Acme_CaseSummary.genAiPromptTemplate-meta.xml', PROMPT_XML)
  const r = detectAgentforce(repo)
  assert.equal(r.agentforce, true)
  assert.equal(r.confidence, 'hard')
  assert.ok(r.signals.some((s) => s.shape === 'prompt-template' && /genAiPromptTemplate/.test(s.evidence)))
})

check('AF3 THE cold-run miss: agent/Ask_Acme.agentscript.yaml alone → detected (subscriber-built)', () => {
  const r = detectAgentforce(agentscriptFixture())
  assert.equal(r.agentforce, true, 'the subscriber-built agent may NEVER be missed — the exact live cold-run defect')
  assert.equal(r.confidence, 'hard', 'an agentscript.yaml is a clear-cut signal, not a heuristic')
  const sig = r.signals.find((s) => s.shape === 'agentscript')
  assert.ok(sig, 'shape agentscript is emitted')
  assert.match(sig.evidence, /agent\/Ask_Acme\.agentscript\.yaml/, 'evidence names the file')
  // and NO packaged signal — so a regression that drops the agentscript branch
  // reds this check while AF1 (packaged-only fixture) stays green.
  assert.ok(!r.signals.some((s) => s.shape === 'packaged-metadata'), 'no packaged signal in this fixture')
})

check('AF4 ESR-agent-action heuristic → detected as the WEAKER signal (confidence heuristic, noted)', () => {
  const r = detectAgentforce(esrFixture())
  assert.equal(r.agentforce, true, 'the ESR-agent-action shape still surfaces')
  assert.equal(r.confidence, 'heuristic', 'a heuristic-ONLY repo reports top-level confidence heuristic, never hard')
  const sig = r.signals.find((s) => s.shape === 'esr-agent-action')
  assert.ok(sig, 'shape esr-agent-action is emitted')
  assert.equal(sig.confidence, 'heuristic', 'the ESR shape is flagged weaker')
  assert.match(sig.note, /heuristic/i, 'the confidence note rides the signal')
  assert.match(sig.note, /clarify-detection/, 'the note routes a heuristic-only match to the corroboration gate')
  // independence: adding the hard agentscript shape flips top-level confidence to hard
  const repo = esrFixture()
  put(repo, 'agent/Ask_Acme.agentscript.yaml', AGENTSCRIPT)
  const both = detectAgentforce(repo)
  assert.equal(both.confidence, 'hard', 'a clear-cut shape is never suppressed by the heuristic one')
  assert.ok(both.shapes.includes('esr-agent-action') && both.shapes.includes('agentscript'))
})

check('AF5 a plain managed package (Apex + plain OpenAPI ESR, no agent metadata) → NOT detected', () => {
  const r = detectAgentforce(plainPackageFixture())
  assert.equal(r.agentforce, false, 'agentforce is NEVER inferred from managed-package alone (the false-blocker case)')
  assert.deepEqual(r.signals, [], 'no signal of any shape')
  assert.equal(r.confidence, null)
  const text = execFileSync('node', [CLI, '--target', plainPackageFixture()], { encoding: 'utf8' })
  assert.match(text, /No Agentforce signal/, 'the text render states the negative honestly')
  assert.match(text, /managed-package/, 'and restates the do-not-infer doctrine')
})

check('AF6 fail-safe: empty repo AND absent path → {agentforce:false}, no throw, CLI exit 0', () => {
  const empty = detectAgentforce(tmp())
  assert.deepEqual({ agentforce: empty.agentforce, signals: empty.signals }, { agentforce: false, signals: [] })
  const absent = detectAgentforce(join(tmp(), 'no', 'such', 'repo'))
  assert.deepEqual({ agentforce: absent.agentforce, signals: absent.signals }, { agentforce: false, signals: [] })
  // the CLI is a DETECTOR, not a gate: exit 0 either way
  const out = execFileSync('node', [CLI, '--target', join(tmp(), 'nope'), '--json'], { encoding: 'utf8' })
  assert.equal(JSON.parse(out).agentforce, false)
})

check('AF7 determinism: same tree twice → byte-identical stdout (--json and text); shapes follow SHAPE_ORDER', () => {
  const repo = agentscriptFixture()
  put(repo, 'force-app/main/default/bots/Acme_Assistant.bot-meta.xml', BOT_XML)
  put(repo, 'force-app/main/default/externalServiceRegistrations/AcmeTools.externalServiceRegistration-meta.xml', ESR_MCP_XML)
  for (const flags of [['--json'], []]) {
    const a = execFileSync('node', [CLI, '--target', repo, ...flags], { encoding: 'utf8' })
    const b = execFileSync('node', [CLI, '--target', repo, ...flags], { encoding: 'utf8' })
    assert.equal(a, b, `two runs diverged (${flags.join(' ') || 'text'})`)
  }
  const r = detectAgentforce(repo)
  assert.ok(Object.isFrozen(SHAPE_ORDER), 'SHAPE_ORDER is frozen')
  const order = r.signals.map((s) => SHAPE_ORDER.indexOf(s.shape))
  assert.deepEqual(order, [...order].sort((x, y) => x - y), 'signals are shape-ordered')
})

check('AF8 exclusions: an agentscript.yaml under node_modules/ is NOT a signal', () => {
  assert.ok(Object.isFrozen(EXCLUDED_DIRS) && EXCLUDED_DIRS.includes('node_modules'))
  const repo = tmp()
  put(repo, 'node_modules/some-dep/agent/Ask_Acme.agentscript.yaml', AGENTSCRIPT)
  put(repo, 'dist/agent/Ask_Acme.agentscript.yaml', AGENTSCRIPT)
  const r = detectAgentforce(repo)
  assert.equal(r.agentforce, false, 'vendored/build trees never produce a signal')
})

check('AF9 journey presence guard: the preflight runs BOTH engines and the shallow grep prose is gone', () => {
  const j = readFileSync(join(PLUGIN, 'skills', 'security-review-journey', 'SKILL.md'), 'utf8')
  assert.match(j, /Bash\(node \*harness\/detect-agentforce\.mjs \*\)/, 'allowed-tools grants detect-agentforce')
  assert.match(j, /Bash\(node \*harness\/enumerate-app-roots\.mjs \*\)/, 'allowed-tools grants enumerate-app-roots')
  assert.match(j, /detect-agentforce\.mjs --target <target> --json/, 'Step 0.2 runs the agentforce detector')
  assert.match(j, /enumerate-app-roots\.mjs --target <target> --json/, 'Step 0.2 runs the app-root enumerator')
  assert.match(j, /agentscript\.yaml/, 'the preflight names the subscriber-built shape the old grep missed')
  assert.match(j, /candidate: true/, 'the app-root fold-in rule is stated')
  // the shallow hand-detection is really replaced, not merely supplemented:
  assert.doesNotMatch(j, /`Bot`\/`GenAiPlugin`\/`GenAiPlanner`\/`GenAiFunction`\/`genAiPromptTemplate`\n\s*metadata \(an/, 'the packaged-metadata-only grep prose is gone from the element sweep')
})

check('AF10 scope presence guard: the self-check sources the signal from the engine, hand grep gone', () => {
  const s = readFileSync(join(PLUGIN, 'skills', 'scope-submission', 'SKILL.md'), 'utf8')
  assert.match(s, /Bash\(node \*harness\/detect-agentforce\.mjs \*\)/, 'allowed-tools grants detect-agentforce')
  assert.match(s, /detect-agentforce\.mjs --target <target> --json/, 'the self-check runs the engine')
  assert.match(s, /A match on EITHER shape/, 'the either-shape doctrine survives')
  assert.match(s, /agentscript\.yaml/, 'the subscriber-built shape is still named (SS6)')
  assert.match(s, /GenAiPlanner/, 'the packaged shape is still named (SS6)')
  assert.doesNotMatch(s, /grep -rlE '<\(Bot\|GenAiPlugin/, 'the hand grep is no longer prescribed')
  assert.doesNotMatch(s, /-name '\*\.agentscript\.yaml' -print/, 'the hand find is no longer prescribed')
})

check('AF11 permission-set coordination: detect-agentforce is in REQUIRED_ALLOW (colon syntax)', () => {
  assert.ok(REQUIRED_ALLOW.includes('Bash(node *harness/detect-agentforce.mjs:*)'),
    'the new read-only detector must be pre-approved, or a default-mode run prompts on it')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

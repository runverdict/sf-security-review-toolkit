#!/usr/bin/env node
/*
 * detect-agentforce.mjs — the DETERMINISTIC Agentforce-element detector. The journey
 * preflight (Step 0.2) and scope-submission's detection self-check both source the
 * `agentforce` signal from THIS engine, so the two phases can never disagree.
 *
 * WHY THIS EXISTS. A live cold run's preflight hand-detected Agentforce by grepping
 * ONLY packaged `Bot`/`GenAiPlugin`/`GenAiPlanner`/`GenAiFunction`/`genAiPromptTemplate`
 * metadata — and reported "no Agentforce" for a SUBSCRIBER-BUILT agent whose declarative
 * definition ships OUTSIDE packaged XML (an `agent/*.agentscript.yaml` + an MCP tool as
 * an agent action). The scope phase had the deep check and corrected it every run, but
 * that is the same root cause enumerate-app-roots.mjs closed for app surfaces
 * (CONVENTIONS "Scope / element DETECTION lives in a deterministic engine, not SKILL
 * prose"): prose-strength hand detection is exactly how an element gets missed. A missed
 * `agentforce` element silently drops the 11 agentforce-* baseline requirements (incl.
 * the three BLOCKER auto-fails) — the most expensive miss in the journey.
 *
 * THE SHAPES (a match on ANY is an `agentforce` signal — the scope doctrine):
 *   packaged-metadata  — *.xml containing <Bot|BotVersion|GenAiPlugin|GenAiPlanner|
 *                        GenAiFunction (bundle suffixes included), or the metadata-named
 *                        files (*.bot-meta.xml, *.genAiPlugin-meta.xml, …). HARD signal.
 *   prompt-template    — genAiPromptTemplate metadata (file name or <GenAiPromptTemplate
 *                        content). HARD signal.
 *   agentscript        — an *.agentscript.yaml / *.agentscript.yml file (typically under
 *                        an `agent/` path) — the SUBSCRIBER-BUILT agent, the exact
 *                        cold-run miss. HARD signal.
 *   esr-agent-action   — an ExternalServiceRegistration that looks wired as an agent
 *                        action (the AgentExchange-MCP shape): MCP markers in its
 *                        provider type / service binding / name-label, or explicit
 *                        agent-action wording. BEST-EFFORT HEURISTIC — a WEAKER signal
 *                        (confidence 'heuristic', never 'hard'), detected independently
 *                        so a false negative here can never suppress the clear-cut
 *                        shapes above. A plain OpenAPI External Service with no MCP/agent
 *                        marker does NOT match — an ESR alone is not an agent.
 *
 * NEVER inferred from `managed-package` alone: a plain managed package that ships no
 * agent metadata returns { agentforce: false } — asserting agentforce-* requirements
 * against it manufactures blockers it can never satisfy (the false-blocker direction
 * the scope element table warns about).
 *
 * Mirrors the shipped detector contract (enumerate-app-roots / tool-detect /
 * stack-detect): PURE core — read-only on the target, no network, no LLM, no deps,
 * Node built-ins only; same tree in → byte-identical output out (signals sorted by
 * shape order then evidence). Bounded-depth walk (MAX_DEPTH), skipping
 * node_modules/.git (all dot-dirs)/dist/build/venv and any file over the read cap.
 * FAIL-SAFE: a missing/unreadable target or an unreadable file is skipped, never
 * thrown — no repo / no match → { agentforce: false, signals: [] }.
 *
 * A DETECTOR, not a gate: the CLI always exits 0. The caller folds a match into the
 * detected element set; a heuristic-only match (top-level confidence 'heuristic')
 * should be corroborated through the `clarify-detection` gate, never silently
 * asserted or dropped.
 *
 * USAGE
 *   node detect-agentforce.mjs --target <repo> [--json]
 *     default: a fixed human-readable block. --json: the machine shape
 *     { target, agentforce, confidence, shapes, signals: [ { shape, evidence,
 *       confidence, note } ], scannedDirs }
 */
import { readFileSync, readdirSync, statSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Directory names never descended into (all dot-dirs are skipped too). */
export const EXCLUDED_DIRS = Object.freeze(['node_modules', 'dist', 'build', 'venv', 'out', 'coverage', '__pycache__'])

/** Bounded-depth walk: how many levels below the target root are scanned. */
const MAX_DEPTH = 10

/** Per-file read cap — a bigger file is skipped, never loaded (fail toward cheap). */
const MAX_READ_BYTES = 5 * 1024 * 1024

/** Fixed shape order — part of the determinism contract. */
export const SHAPE_ORDER = Object.freeze(['packaged-metadata', 'prompt-template', 'agentscript', 'esr-agent-action'])

// Packaged Bot/GenAi* metadata: content signals (bundle suffixes match via prefix —
// <GenAiPlannerBundle hits GenAiPlanner) and the conventional metadata file names.
const PACKAGED_CONTENT_RE = /<Bot(Version)?[\s>/]|<(GenAiPlugin|GenAiPlanner|GenAiFunction)[A-Za-z]*[\s>/]/
const PACKAGED_FILE_SUFFIXES = Object.freeze([
  '.bot-meta.xml', '.botversion-meta.xml', '.genaiplugin-meta.xml', '.genaiplanner-meta.xml',
  '.genaiplannerbundle-meta.xml', '.genaifunction-meta.xml',
])
// genAiPromptTemplate metadata: file name or content.
const PROMPT_TEMPLATE_SUFFIX = '.genaiprompttemplate-meta.xml'
const PROMPT_TEMPLATE_CONTENT_RE = /<GenAiPromptTemplate[\s>/]/
// The subscriber-built agent definition (typically under an agent/ path).
const AGENTSCRIPT_SUFFIXES = Object.freeze(['.agentscript.yaml', '.agentscript.yml'])
// ExternalServiceRegistration metadata file name.
const ESR_SUFFIX = '.externalserviceregistration-meta.xml'
// ESR-agent-action heuristics — MCP markers where they carry meaning, or explicit
// agent-action wording. Deliberately NOT a bare /mcp/i over the whole file: the marker
// must sit in the provider type, the service binding, the name/label, or the file name,
// so a plain OpenAPI ESR whose description merely mentions a vendor never matches.
const ESR_MCP_FIELD_RE = /<(registrationProviderType|providerType)>[^<]*mcp[^<]*<|<serviceBinding>[^<]*mcp[^<]*<|<(label|masterLabel|fullName)>[^<]*mcp[^<]*</i
const ESR_AGENT_ACTION_RE = /agent[\s_-]?action/i
const ESR_NOTE = 'heuristic — an ESR shaped like an MCP/agent-action registration; a weaker signal than packaged metadata or an agentscript.yaml. Corroborate a heuristic-only match through the clarify-detection gate (a plain OpenAPI External Service is NOT an agent).'

const lower = (s) => String(s).toLowerCase()

/** Safe file read under the cap; null on any failure (fail-safe, never throws). */
function readCapped(path) {
  try {
    const st = statSync(path)
    if (!st.isFile() || st.size > MAX_READ_BYTES) return null
    return readFileSync(path, 'utf8')
  } catch { return null }
}

/** Classify ONE file (by repo-relative path) → array of signals (usually 0 or 1). */
function classifyFile(target, relPath) {
  const base = lower(relPath.split('/').pop())
  const signals = []

  // agentscript — name-only, no read needed (the subscriber-built shape).
  if (AGENTSCRIPT_SUFFIXES.some((s) => base.endsWith(s))) {
    signals.push({ shape: 'agentscript', evidence: `${relPath} (subscriber-built agent definition)`, confidence: 'hard' })
    return signals
  }

  if (!base.endsWith('.xml')) return signals

  // ESR — heuristic markers only (never ESR-presence alone).
  if (base.endsWith(ESR_SUFFIX)) {
    const text = readCapped(join(target, relPath))
    const nameHit = /mcp/i.test(base)
    const fieldHit = text !== null && ESR_MCP_FIELD_RE.test(text)
    const actionHit = text !== null && ESR_AGENT_ACTION_RE.test(text)
    if (nameHit || fieldHit || actionHit) {
      const via = fieldHit ? 'MCP marker in provider type / service binding / label'
        : actionHit ? 'agent-action wording in the registration'
        : 'MCP-named registration file'
      signals.push({ shape: 'esr-agent-action', evidence: `${relPath} (${via})`, confidence: 'heuristic', note: ESR_NOTE })
    }
    return signals
  }

  // Packaged metadata / prompt template — file name first (no read), then content.
  if (PACKAGED_FILE_SUFFIXES.some((s) => base.endsWith(s))) {
    signals.push({ shape: 'packaged-metadata', evidence: `${relPath} (packaged agent metadata file)`, confidence: 'hard' })
    return signals
  }
  if (base.endsWith(PROMPT_TEMPLATE_SUFFIX)) {
    signals.push({ shape: 'prompt-template', evidence: `${relPath} (genAiPromptTemplate metadata file)`, confidence: 'hard' })
    return signals
  }
  const text = readCapped(join(target, relPath))
  if (text === null) return signals
  if (PACKAGED_CONTENT_RE.test(text)) {
    const tag = (text.match(/<(BotVersion|Bot|GenAiPlugin[A-Za-z]*|GenAiPlanner[A-Za-z]*|GenAiFunction[A-Za-z]*)[\s>/]/) || [])[1] || 'Bot/GenAi*'
    signals.push({ shape: 'packaged-metadata', evidence: `${relPath} (<${tag}> metadata)`, confidence: 'hard' })
  } else if (PROMPT_TEMPLATE_CONTENT_RE.test(text)) {
    signals.push({ shape: 'prompt-template', evidence: `${relPath} (<GenAiPromptTemplate> metadata)`, confidence: 'hard' })
  }
  return signals
}

/** Deterministic bounded walk: sorted entries, dot-dirs + EXCLUDED_DIRS skipped, symlinks skipped. */
function walk(target, rel, depth, out, counters) {
  if (depth > MAX_DEPTH) return
  const dir = rel === '' ? target : join(target, rel)
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  counters.dirs++
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const e of entries) {
    if (e.isSymbolicLink()) continue
    const childRel = rel === '' ? e.name : `${rel}/${e.name}`
    if (e.isDirectory()) {
      if (e.name.startsWith('.') || EXCLUDED_DIRS.includes(e.name)) continue
      walk(target, childRel, depth + 1, out, counters)
    } else if (e.isFile()) {
      for (const s of classifyFile(target, childRel)) out.push(s)
    }
  }
}

/**
 * PURE core: scan the target repo for every Agentforce shape. Deterministic (signals
 * sorted by SHAPE_ORDER then evidence) and fail-safe: a missing/unreadable target
 * returns { agentforce: false, signals: [] } — it NEVER throws.
 *
 * Top-level `confidence`: 'hard' when any clear-cut shape matched; 'heuristic' when
 * ONLY the ESR-agent-action heuristic matched (corroborate before asserting the whole
 * agentforce-* track); null when nothing matched.
 */
export function detectAgentforce(target) {
  const signals = []
  const counters = { dirs: 0 }
  try { if (!statSync(target).isDirectory()) throw new Error('not a directory') } catch {
    return { target, agentforce: false, confidence: null, shapes: [], signals: [], scannedDirs: 0 }
  }
  walk(target, '', 0, signals, counters)
  signals.sort((a, b) => {
    const so = SHAPE_ORDER.indexOf(a.shape) - SHAPE_ORDER.indexOf(b.shape)
    if (so !== 0) return so
    return a.evidence < b.evidence ? -1 : a.evidence > b.evidence ? 1 : 0
  })
  const shapes = SHAPE_ORDER.filter((s) => signals.some((x) => x.shape === s))
  const hard = signals.some((s) => s.confidence === 'hard')
  return {
    target,
    agentforce: signals.length > 0,
    confidence: signals.length === 0 ? null : hard ? 'hard' : 'heuristic',
    shapes,
    signals,
    scannedDirs: counters.dirs,
  }
}

function renderBlock(r) {
  const L = []
  L.push('### Agentforce detection (deterministic — packaged + subscriber-built shapes)')
  L.push('')
  if (!r.agentforce) {
    L.push('No Agentforce signal: no packaged Bot/GenAi* metadata, no genAiPromptTemplate,')
    L.push('no *.agentscript.yaml subscriber-built agent, no ESR-agent-action marker.')
    L.push('Do NOT emit an `agentforce` element — and never infer one from `managed-package`')
    L.push('alone (asserting agentforce-* requirements against a plain package manufactures')
    L.push('blockers it can never satisfy).')
    return L.join('\n')
  }
  L.push(`AGENTFORCE SIGNAL: yes (confidence: ${r.confidence}) — ${r.signals.length} signal(s) across ${r.shapes.length} shape(s).`)
  L.push('')
  L.push('| Shape | Evidence | Confidence |')
  L.push('|---|---|---|')
  for (const s of r.signals) L.push(`| ${s.shape} | ${s.evidence} | ${s.confidence} |`)
  L.push('')
  L.push('A match on ANY shape — packaged Bot/GenAiPlanner metadata OR a subscriber-built')
  L.push('agentscript.yaml / ESR-registered agent-action — is the `agentforce` element (the')
  L.push('AgentExchange-listing signal that gates the agentforce-* requirements). A')
  L.push('heuristic-only match (confidence: heuristic) should be corroborated through the')
  L.push('clarify-detection gate rather than silently asserted or dropped.')
  return L.join('\n')
}

function main() {
  const arg = (flag, def) => {
    const i = process.argv.indexOf(flag)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
  }
  const target = arg('--target', process.cwd())
  const result = detectAgentforce(target)
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  } else {
    process.stdout.write(renderBlock(result) + '\n')
  }
  process.exit(0) // a DETECTOR, not a gate — the caller folds the result in
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) }
  catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

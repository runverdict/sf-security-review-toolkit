#!/usr/bin/env node
/*
 * render-readiness-verdict.mjs — the FILL ENGINE for the operator readiness verdict
 * (WI-00B substrate + WI-03). The output-class analog of gate-spec.mjs: the ENGINE
 * owns the verdict SKELETON (templates/operator/readiness-verdict.md.tmpl), the
 * driver supplies the DATA slots, and the engine force-injects the canonical
 * standing caveat + fails closed on any unfilled slot.
 *
 * WHY THIS EXISTS. The readiness verdict was rendered from improvisable skill prose
 * (Step 8 of compile-submission): the driver chose table-vs-prose, reordered
 * sections, dropped sub-blocks, and re-worded the standing caveat run-to-run. This
 * pins it: a fixed-header template whose sections are {{SLOT}} cells, filled
 * deterministically, with the SCI block pasted byte-for-byte from compute-sci and
 * the standing caveat a SINGLE committed constant (so source and output can't
 * diverge — the caveat is force-injected, never re-authored by the driver).
 *
 * Mirrors:
 *   - compute-sci.mjs verbatim-block mode (the deterministic blocks this fills are
 *     pasted byte-for-byte);
 *   - the templates/*.md.tmpl + {{SLOT}} fill convention (readiness-tracker etc.);
 *   - build-artifact-engine.mjs's fail-closed THROW (a missing template / an
 *     unfilled slot aborts loud — the "not submission-ready" lint, promoted from
 *     skill prose to a deterministic engine);
 *   - gate-spec.mjs's ALWAYS_ON force-injection (the standing caveat is injected on
 *     every fill regardless of caller input — a driver cannot drop or paraphrase it).
 *
 * PURE core (fillVerdict); the CLI reads the template + a slots JSON. No LLM, no
 * network, no deps, no Date/Math.random — byte-identical on re-run.
 *
 * USAGE:
 *   node render-readiness-verdict.mjs --template <tmpl> --slots <slots.json> [--out <path>]
 *   node render-readiness-verdict.mjs --standing-caveat        # print the canonical constant
 */
import { readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── THE SINGLE CANONICAL STANDING CAVEAT ──────────────────────────────────────
// Authored once, here. The template marks WHERE it goes ({{STANDING_CAVEAT}});
// fillVerdict force-injects THIS text. The driver never re-words it, so the
// source (this constant) and the rendered output cannot diverge.
export const STANDING_CAVEAT = [
  'Salesforce performs its own penetration testing on the live solution regardless of any',
  'evidence compiled here. This toolkit runs static code review by LLM agents — not DAST,',
  'not a penetration test (CONVENTIONS §2). The strongest verdict it ever emits is',
  '**"no known blockers remain in what this toolkit can verify"** — never **"will pass"**.',
  'A fully green readiness verdict is a materials-and-disposition state, not a prediction of',
  'the review outcome.',
].join('\n')

// A {{SLOT}} marker: {{UPPER_SNAKE}} only (this template never uses prose slots).
const SLOT_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g

// A brace-shaped placeholder of ANY name — the leftover sweep uses this looser form so an
// odd/hyphenated token like {{FOO-BAR}} (which SLOT_RE would not fill) can never survive
// uncaught, and a slot VALUE that smuggles in a second-order {{…}} also fails closed.
const ANY_BRACE_RE = /\{\{[^{}]*\}\}/g

// Engine-emitted blocks that are NEVER legitimately empty — a hollow one is a DROPPED
// sub-block (a failed harness capture), not a real "none". Fail closed on it; the
// {{SLOT}} leftover check alone would let an empty-string value through. The DATA
// sections (blockers, open-conflicting) CAN be a legitimate "none", so they are not here —
// content-presence for those is the SCI gate's job, not this engine's.
const REQUIRED_NONEMPTY = ['SCI_BLOCK', 'LEDGER_FRESHNESS', 'FINDING_STABILITY']

/** The operator surfaces the render-verbatim contract governs. WI-03 ships readiness-verdict. */
export const REGISTERED_SURFACES = Object.freeze([
  Object.freeze({
    id: 'readiness-verdict',
    template: 'templates/operator/readiness-verdict.md.tmpl',
    renderers: Object.freeze(['compute-sci.mjs', 'ledger-staleness.mjs', 'render-stability.mjs']),
    skill: 'skills/compile-submission/SKILL.md',
  }),
])

/**
 * Detect a hand-built Markdown table: a `| … |` header row immediately followed by
 * a `|---|---|` separator row. The lint uses this to FAIL a skill that hand-builds a
 * verdict table for a surface that has a registered renderer/template (it must paste
 * the renderer's block, not improvise a table).
 */
export function hasMarkdownTable(text) {
  const lines = String(text == null ? '' : text).split('\n')
  for (let i = 0; i < lines.length - 1; i++) {
    const header = lines[i].trim()
    const sep = lines[i + 1].trim()
    if (/^\|.*\|.*$/.test(header) && /^\|[\s:|-]*-[\s:|-]*\|?$/.test(sep) && sep.includes('-')) return true
  }
  return false
}

/**
 * The render-verbatim CONTRACT lint. For a registered surface, a skill body MUST
 * route the surface through its template + renderers (reference them) rather than
 * hand-build it. The PRIMARY guarantee is the template reference (the skill routes
 * through the engine); the table heuristic additionally FAILS a skill that references
 * neither the template nor a renderer yet hand-builds a Markdown table (improvised the
 * surface). BOUNDARY: a skill that references the template is trusted to use it — the
 * table heuristic is not run against it, because a real skill body legitimately carries
 * tables in OTHER steps; whole-body table-flagging would false-positive. Returns an
 * array of issue strings (empty = clean). Pure; mirrors the artifact-template lint
 * posture without duplicating its engine.
 */
export function lintRenderVerbatim(skillText, surface) {
  const text = String(skillText == null ? '' : skillText)
  const issues = []
  const refsTemplate = text.includes(surface.template)
  const refsAnyRenderer = (surface.renderers || []).some((r) => text.includes(r))
  if (!refsTemplate) issues.push(`does not reference the registered template ${surface.template}`)
  if (!refsTemplate && !refsAnyRenderer && hasMarkdownTable(text)) {
    issues.push(`hand-builds a Markdown table for '${surface.id}', a surface with a registered renderer/template`)
  }
  return issues
}

/**
 * Fill the verdict template. FORCE-INJECTS the canonical STANDING_CAVEAT (caller
 * cannot override it). FAILS CLOSED: throws if the template lacks the caveat slot,
 * or if ANY {{SLOT}} survives the fill (the "not submission-ready / no unfilled
 * slot" lint, promoted to an engine).
 */
export function fillVerdict(template, slots) {
  const tpl = String(template == null ? '' : template)
  // whitespace-tolerant (matches SLOT_RE), so {{ STANDING_CAVEAT }} is also recognized.
  if (!/\{\{\s*STANDING_CAVEAT\s*\}\}/.test(tpl)) {
    throw new Error('render-readiness-verdict: template is missing the {{STANDING_CAVEAT}} slot — the canonical caveat has no home')
  }
  // Force-injected caveat wins over any caller-supplied STANDING_CAVEAT value.
  const merged = { ...(slots && typeof slots === 'object' ? slots : {}), STANDING_CAVEAT }
  // FAIL CLOSED on a hollow engine block (an empty-string SCI/freshness/stability slot is a
  // dropped sub-block that the {{SLOT}} leftover check alone would NOT catch).
  for (const key of REQUIRED_NONEMPTY) {
    if (!Object.prototype.hasOwnProperty.call(merged, key) || !String(merged[key]).trim()) {
      throw new Error(`render-readiness-verdict: required block '${key}' is missing or empty — a hollow verdict cannot ship`)
    }
  }
  const out = tpl.replace(SLOT_RE, (m, key) =>
    Object.prototype.hasOwnProperty.call(merged, key) ? String(merged[key]) : m
  )
  const leftover = out.match(ANY_BRACE_RE)
  if (leftover) {
    const uniq = [...new Set(leftover)].join(', ')
    throw new Error(`render-readiness-verdict: unfilled slot(s) survived the fill — not submission-ready: ${uniq}`)
  }
  return out
}

function readJSON(p) {
  return JSON.parse(readFileSync(p, 'utf8'))
}

function main() {
  const arg = (flag, def) => {
    const i = process.argv.indexOf(flag)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
  }
  if (process.argv.includes('--standing-caveat')) {
    process.stdout.write(STANDING_CAVEAT + '\n')
    return
  }
  const templatePath = arg('--template', null)
  const slotsPath = arg('--slots', null)
  if (!templatePath) {
    console.error('render-readiness-verdict: --template <path> is required')
    process.exit(2)
  }
  let template
  try {
    template = readFileSync(templatePath, 'utf8')
  } catch (e) {
    console.error(`render-readiness-verdict: cannot read --template ${templatePath}: ${e.message}`)
    process.exit(2)
  }
  let slots = {}
  if (slotsPath) {
    try {
      slots = readJSON(slotsPath)
    } catch (e) {
      console.error(`render-readiness-verdict: cannot read --slots ${slotsPath}: ${e.message}`)
      process.exit(2)
    }
  }
  let filled
  try {
    filled = fillVerdict(template, slots)
  } catch (e) {
    console.error(`render-readiness-verdict: ${e.message}`)
    process.exit(2)
  }
  const out = arg('--out', null)
  if (out) {
    try {
      writeFileSync(out, filled.endsWith('\n') ? filled : filled + '\n')
    } catch (e) {
      console.error(`render-readiness-verdict: cannot write --out ${out}: ${e.message}`)
      process.exit(2)
    }
  }
  process.stdout.write(filled.endsWith('\n') ? filled : filled + '\n')
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
  } catch {
    return fileURLToPath(import.meta.url) === process.argv[1]
  }
}
if (invokedDirectly()) main()

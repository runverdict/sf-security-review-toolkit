#!/usr/bin/env node
/*
 * render-scan-status.mjs — the VERBATIM scan-status summary (WI-05 / INV-13,
 * presentation-consistency Slice 3). The output-class analog of the gate-spec engine:
 * the ENGINE owns the table SKELETON, the driver pastes it byte-for-byte into
 * `run-scans` Step 11 (the per-family "what ran / what's pending" readout).
 *
 * WHY THIS EXISTS. The scan-status summary was driver-improvised — which families,
 * which order, which columns varied run-to-run, and a family with a generated PLAN but
 * no report was sometimes shown as "done" (the exact HAVE-without-evidence lie
 * CONVENTIONS §2 forbids). This pins it: a FIXED 8-row table in canonical Family 1–8
 * order with locked columns, rendered from the deterministic evidence index.json, where
 * DONE requires a reviewer-reproducible report ON DISK — a plan alone is PARTIAL.
 *
 * WHERE THE DONE GATE IS ENFORCED. The on-disk "DONE needs a reviewer-reproducible report"
 * rule is enforced and regression-locked at the PRODUCER — `build-evidence-index.mjs` sets
 * each entry's `disposition` + `reviewer_reproducible` from real evidence files (the credit
 * rule, guarded by `test-build-evidence-index`). This renderer trusts those flags BY DESIGN:
 * it reads `disposition`/`reviewer_reproducible` and maps them to the Status enum WITHOUT
 * re-deriving the gate, so it stays PURE and byte-deterministic (re-statting disk here would
 * make the render non-deterministic and duplicate the producer's tested logic). A `partial`/
 * `pending-owner` disposition → PARTIAL/PENDING; only `satisfied` + `reviewer_reproducible`
 * is DONE — the renderer cannot upgrade a plan to DONE on its own.
 *
 * INPUTS:
 *   index    — build-evidence-index.mjs's evidence/index.json
 *              ({ generated, entries:[{ ref_type, ref_id, source, reviewer_reproducible,
 *                 location, disposition, note, ... }] })
 *   manifest — the scope-manifest.json (OPTIONAL) → drives the "Applies" column from the
 *              detected architecture elements; absent → "?" where a family is element-gated
 *   commit, tools — header strings the driver supplies (honest "(not recorded)" fallback)
 *
 * DETERMINISTIC + PURE (CONVENTIONS §7): same inputs → byte-identical block. No LLM, no
 * network, no deps, no Date/Math.random. A missing/unreadable index → every applicable
 * family PENDING (honest), never a fabricated "done" and never a crash.
 *
 * USAGE:
 *   node render-scan-status.mjs --target <repo> [--commit <sha>] [--tools "<versions>"]
 *   node render-scan-status.mjs --index <index.json> [--manifest <scope-manifest.json>] …
 */
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── THE FROZEN CANONICAL 8-FAMILY CATALOG (run-scans "The eight families" table) ──
// n/name/applies = the family; applies_elements = which manifest element types make it
// apply ('always' = unconditional); gate = the verbatim gate display; gate_ids = the
// requirement ids that bind it in the index; evidence_re = the evidence-file name pattern;
// next = the "next command if PENDING" cell. The order IS the canonical 1–8 order.
export const SCAN_FAMILIES = Object.freeze([
  { n: 1, name: 'Code Analyzer', applies: 'managed-package element', applies_elements: ['managed-package'],
    runner: 'agent', gate: 'scan-code-analyzer-v5-required (blocker)', gate_ids: ['scan-code-analyzer-v5-required'],
    evidence_re: /(?:^|\/)code-analyzer-/, next: 'run-scans Family 1 (agent runs Code Analyzer + SFGE)' },
  { n: 2, name: 'Partner Security Portal scanner (Checkmarx)', applies: 'managed-package element', applies_elements: ['managed-package'],
    runner: 'owner (portal); agent parses', gate: 'scan-checkmarx-partner-portal (blocker)', gate_ids: ['scan-checkmarx-partner-portal'],
    evidence_re: /(?:^|\/)(?:portal-scan|checkmarx)-/, next: 'owner runs the Checkmarx scan on the Partner Security Portal; agent parses the report' },
  { n: 3, name: 'Authenticated DAST', applies: 'external-endpoint / mcp-server', applies_elements: ['external-endpoint', 'mcp-server'],
    runner: 'owner executes; agent plans', gate: 'dast-self-run-required, dast-authenticated-scans (blockers)', gate_ids: ['dast-self-run-required', 'dast-authenticated-scans'],
    evidence_re: /(?:^|\/)dast\//, next: 'owner runs the DAST against staging per evidence/dast/ plan (or accept the throwaway-DAST power-up)' },
  { n: 4, name: 'TLS grade', applies: 'external-endpoint / mcp-server', applies_elements: ['external-endpoint', 'mcp-server'],
    runner: 'agent', gate: 'endpoint-ssl-labs-a-grade', gate_ids: ['endpoint-ssl-labs-a-grade'],
    evidence_re: /(?:^|\/)(?:ssllabs|tls)-/, next: 'run-scans Family 4 (agent: SSL Labs API or local testssl/sslyze)' },
  { n: 5, name: 'Dependency audit', applies: 'always', applies_elements: 'always',
    runner: 'agent', gate: 'scan-dependency-vulnerabilities (major)', gate_ids: ['scan-dependency-vulnerabilities'],
    evidence_re: /(?:^|\/)deps-/, next: 'run-scans Family 5 (agent: npm/pip/… audit per detected stack)' },
  { n: 6, name: 'Secret scan (tree + full git history)', applies: 'always', applies_elements: 'always',
    runner: 'agent', gate: 'fail-hardcoded-secrets (blocker)', gate_ids: ['fail-hardcoded-secrets'],
    evidence_re: /(?:^|\/)secret-scan-/, next: 'run-scans Family 6 (agent: gitleaks/detect-secrets + the deterministic git-history scan)' },
  { n: 7, name: 'External SAST', applies: 'external-endpoint with source', applies_elements: ['external-endpoint'],
    runner: 'agent', gate: 'scan-external-sast (major)', gate_ids: ['scan-external-sast'],
    evidence_re: /(?:^|\/)(?:semgrep|bandit|njsscan|gosec)-/, next: 'run-scans Family 7 (agent: Semgrep + per-language SAST over the server tree)' },
  { n: 8, name: 'External SCA + IaC', applies: 'lockfile / Dockerfile / IaC', applies_elements: ['external-endpoint'],
    runner: 'agent', gate: 'scan-external-sca, scan-iac-misconfig (major)', gate_ids: ['scan-external-sca', 'scan-iac-misconfig'],
    evidence_re: /(?:^|\/)(?:osv|iac)-/, next: 'run-scans Family 8 (agent: OSV-Scanner + Checkov over lockfiles/Dockerfiles/IaC)' },
])

// The fixed Status enum (the legend pins the meanings).
const STATUS = Object.freeze({ DONE: 'DONE', PARTIAL: 'PARTIAL', PENDING: 'PENDING', STATIC: 'STATIC-ONLY', NA: 'N/A', UNKNOWN: '—' })

const cell = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim() || '—'
const isStructuralNa = (e) => /N\/A|surface absent/i.test(String(e && e.note || ''))

/** Does this index entry belong to this family? (gate-id, evidence-path, or source tag.) */
function matchesFamily(entry, fam) {
  if (!entry || typeof entry !== 'object') return false
  const ref = String(entry.ref_id || '')
  const loc = String(entry.location || '')
  const src = String(entry.source || '')
  return fam.gate_ids.includes(ref) || fam.evidence_re.test(loc) || src.includes(`family-${fam.n}`)
}

/** Pure: applicability of a family from the manifest. true / false / null (unknown). */
function appliesToFamily(fam, manifest) {
  if (fam.applies_elements === 'always') return true
  const els = manifest && Array.isArray(manifest.elements) ? manifest.elements : null
  if (!els) return null // no manifest → unknown for an element-gated family
  return els.some((e) => e && fam.applies_elements.includes(e.type))
}

/** Pure: per-family { status, evidence } from the matched index entries + applicability. */
function familyStatus(fam, entries, applies) {
  const matched = entries.filter((e) => matchesFamily(e, fam))
  if (applies === false) return { status: STATUS.NA, evidence: '—' }
  // a structural-N/A (absent surface a reviewer can also confirm) with no real report → N/A
  if (matched.length && matched.every(isStructuralNa)) return { status: STATUS.NA, evidence: '—' }
  const done = matched.find((e) => e.disposition === 'satisfied' && e.reviewer_reproducible === true && !isStructuralNa(e))
  if (done) return { status: STATUS.DONE, evidence: done.location || '(on disk)' }
  const partial = matched.find((e) => e.disposition === 'partial')
  if (partial) return { status: STATUS.PARTIAL, evidence: partial.location || '—' }
  const stat = matched.find((e) => e.disposition === 'statically-cleared')
  if (stat) return { status: STATUS.STATIC, evidence: stat.location || '—' }
  const pend = matched.find((e) => e.disposition === 'pending-owner')
  if (pend) return { status: STATUS.PENDING, evidence: pend.location || '—' }
  // no entries: applies → PENDING (not run yet); unknown → '—' (not run, applicability unknown)
  return { status: applies === true ? STATUS.PENDING : STATUS.UNKNOWN, evidence: '—' }
}

/** Pure: the inputs → the fixed 8-row scan-status block. */
export function renderScanStatus({ index, manifest, commit, tools } = {}) {
  const idx = index && typeof index === 'object' ? index : null
  const date = idx && idx.generated ? String(idx.generated) : '(date not recorded)'
  const entries = idx && Array.isArray(idx.entries) ? idx.entries : []
  const commitStr = commit ? String(commit) : '(commit not recorded)'
  const toolsStr = tools ? String(tools) : '(tool versions not recorded)'

  const L = [
    `### Scan status — ${date} · commit ${commitStr} · tools ${toolsStr}`,
    '',
    '| Family | Applies | Runner | Status | Evidence file | Gate id | Next command if PENDING |',
    '|---|---|---|---|---|---|---|',
  ]
  for (const fam of SCAN_FAMILIES) {
    const applies = appliesToFamily(fam, manifest)
    const appliesCell = applies === true ? '✓' : applies === false ? '— (N/A)' : '?'
    const { status, evidence } = familyStatus(fam, entries, applies)
    const next = status === STATUS.PENDING || status === STATUS.PARTIAL ? fam.next : '—'
    L.push(
      `| ${fam.n}. ${cell(fam.name)} | ${appliesCell} | ${cell(fam.runner)} | ${status} | ` +
        `${cell(evidence)} | ${cell(fam.gate)} | ${cell(next)} |`
    )
  }
  L.push('')
  L.push(
    '_Status: **DONE** = a reviewer-reproducible report on disk · **PARTIAL** = plan/draft generated, ' +
      'no report yet (owner-run) · **PENDING** = applies but not run · **STATIC-ONLY** = white-box-cleared, ' +
      'not a reproducible scan (not credited) · **N/A** = surface absent · **?** = applicability unknown ' +
      '(no manifest). A family is DONE only with the evidence FILE on disk — a plan with no report is PARTIAL, ' +
      'never DONE (CONVENTIONS §2). Salesforce pen-tests the surface regardless._'
  )
  return L.join('\n')
}

function main() {
  const arg = (flag, def) => {
    const i = process.argv.indexOf(flag)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
  }
  const target = arg('--target', null)
  const indexPath = arg('--index', target ? join(target, '.security-review', 'evidence', 'index.json') : null)
  const manifestPath = arg('--manifest', target ? join(target, '.security-review', 'scope-manifest.json') : null)
  const commit = arg('--commit', null)
  const tools = arg('--tools', null)
  const readJSON = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }
  const index = indexPath ? readJSON(indexPath) : null
  const manifest = manifestPath ? readJSON(manifestPath) : null
  const out = renderScanStatus({ index, manifest, commit, tools })
  if (process.argv.includes('--json')) process.stdout.write(JSON.stringify({ block: out }, null, 2) + '\n')
  else process.stdout.write(out + '\n')
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

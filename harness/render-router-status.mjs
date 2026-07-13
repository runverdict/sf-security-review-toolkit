#!/usr/bin/env node
/*
 * render-router-status.mjs — the VERBATIM router-mode "where are we?" status block
 * (WI-05 / INV-33, presentation-consistency Slice 3). The output-class analog of the
 * gate-spec engine: the ENGINE owns the 3-line SKELETON, the driver pastes it
 * byte-for-byte on the journey's status-only / one-step path.
 *
 * WHY THIS EXISTS. "where are we on the review?" was answered in improvised prose — the
 * resume point, the recommended next skill, and the reason were re-worded run-to-run.
 * This pins it: a FIXED 3-line block (resume-point · single next-skill · one-sentence
 * reason) computed deterministically from the Step-0 detection facts (which
 * `.security-review/*` artifacts exist + drift/staleness), so only the phase/skill
 * names fill.
 *
 * INPUTS — the Step-0 detection facts (every field optional/boolean; see the journey
 * resume table):
 *   { scope_manifest, sf_autoresolve, audit_ledger, artifacts, evidence, submission,  // presence
 *     drift, ledger_stale, open_blockers }                                            // qualifiers
 *
 * DETERMINISTIC + PURE (CONVENTIONS §7): same facts → byte-identical block. No LLM, no
 * network, no deps, no Date/Math.random. A missing/unreadable facts source → the honest
 * "fresh start" block, never a crash and never an invented resume point.
 *
 * USAGE:
 *   node render-router-status.mjs --target <repo>     # detects which .security-review/* exist
 *   node render-router-status.mjs --facts <facts.json>
 */
import { readFileSync, existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── THE FROZEN PHASE LADDER — furthest-reached first ──────────────────────────
// Each phase: the presence flag that proves it, the resume label, the single next
// skill, and the one-sentence reason. Walked top-down; the first present phase wins.
// A rung may carry `requires` (additional flags that must ALSO be present): evidence
// counts as Phase 3 only WITH an audit ledger — evidence WITHOUT one means the
// journey's static-scan substrate ran and the AUDIT is the resume point, not compile.
const PHASE_LADDER = Object.freeze([
  Object.freeze({ flag: 'submission', label: 'Phase 5 — submission compiled',
    next: '/sf-security-review-toolkit:stay-listed (or re-run compile-submission to refresh)',
    reason: 'a compiled submission package exists — maintain it and refresh stale evidence, don\'t rebuild blindly.' }),
  Object.freeze({ flag: 'evidence', requires: Object.freeze(['audit_ledger']),
    label: 'Phase 3 — scans run (partial or full)',
    next: '/sf-security-review-toolkit:compile-submission',
    reason: 'scan evidence exists — compile the submission (it re-runs the cheap scans and demotes any HAVE row lacking evidence).' }),
  Object.freeze({ flag: 'artifacts', label: 'Phase 2 — reviewer artifacts generated',
    next: '/sf-security-review-toolkit:run-scans',
    reason: 'the reviewer artifacts exist — run the scan families next.' }),
  Object.freeze({ flag: 'audit_ledger', label: 'Phase 1 — audit ran',
    next: '/sf-security-review-toolkit:generate-artifacts',
    reason: 'an audit ledger exists — generate the reviewer artifacts (the gate withholds the AuthN/AuthZ doc on any open critical/high).' }),
  Object.freeze({ flag: 'evidence', label: 'static-scan substrate ran — no audit ledger yet',
    next: '/sf-security-review-toolkit:audit-codebase',
    reason: 'scan evidence exists but no audit has run — the static scans ran first; the audit is next (its deterministic ingest seeds the band from that evidence on the first pass).' }),
  Object.freeze({ flag: 'scope_manifest', label: 'Phase 0 — scope resolved',
    next: '/sf-security-review-toolkit:audit-codebase',
    reason: 'a scope manifest exists — run the white-box audit next.' }),
])

const FRESH = Object.freeze({
  label: 'fresh start (no prior phase detected)',
  next: '/sf-security-review-toolkit:scope-submission',
  reason: 'no prior state found — start with scope detection (it writes the manifest every later phase keys off).',
})

/** Pure: the detection facts (or null) → the fixed 3-line status block. */
export function renderRouterStatus(facts) {
  const f = facts && typeof facts === 'object' ? facts : {}
  let label, next, reason

  if (f.drift) {
    // Drift overrides everything: a stale manifest poisons every downstream phase.
    label = 'Phase 0 — re-scope on drift'
    next = '/sf-security-review-toolkit:scope-submission'
    reason = 'the scope manifest drifted from the code (new/changed elements) — re-scope before anything downstream keys off a stale manifest.'
  } else if (f.audit_ledger && f.ledger_stale) {
    // A stale ledger must be re-audited before the verdict relies on it.
    label = 'Phase 1 — audit ran, but the ledger is STALE'
    next = '/sf-security-review-toolkit:audit-codebase'
    reason = 'files changed since the audit — re-audit the changed dimensions before any verdict trusts the ledger (a stale finding is never carried into the readiness verdict).'
  } else {
    const phase = PHASE_LADDER.find((p) => f[p.flag] && (p.requires || []).every((r) => f[r])) || FRESH
    label = phase.label
    next = phase.next
    reason = phase.reason
    // An audit that ran with open critical/high auto-proceeds (the tool never fixes); note it.
    if (phase.flag === 'audit_ledger' && f.open_blockers) {
      reason = 'an audit ledger with OPEN critical/high exists — it auto-proceeds to the NOT-READY report; generate-artifacts withholds the AuthN/AuthZ doc until the open auth findings are fixed (the partner remediates and re-runs).'
    }
  }

  return [
    `Resume point: ${label}`,
    `Next: ${next}`,
    `Why: ${reason}`,
  ].join('\n')
}

/** Detect the Step-0 presence facts from a target repo's .security-review/ tree. */
function detectFacts(target) {
  const sr = join(target, '.security-review')
  const has = (...parts) => existsSync(join(sr, ...parts))
  const hasArtifacts = (() => {
    try {
      // the docs/security-review dir exists = artifacts generated (coarse presence check;
      // the driver passes richer facts via --facts)
      const docs = join(target, 'docs', 'security-review')
      return existsSync(docs)
    } catch { return false }
  })()
  return {
    scope_manifest: has('scope-manifest.json'),
    sf_autoresolve: has('sf-autoresolve.json'),
    audit_ledger: has('audit-ledger.json'),
    artifacts: hasArtifacts,
    evidence: has('evidence'),
    submission: existsSync(join(target, 'docs', 'security-review', 'submission', 'submission-checklist.md')),
    // drift / ledger_stale / open_blockers are computed by the journey's spot-check + the
    // ledger-staleness engine, not from file presence — left false here (the driver passes
    // a richer facts file via --facts when it has run those checks).
    drift: false,
    ledger_stale: false,
    open_blockers: false,
  }
}

function main() {
  const arg = (flag, def) => {
    const i = process.argv.indexOf(flag)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
  }
  const factsPath = arg('--facts', null)
  const target = arg('--target', null)
  let facts = null
  if (factsPath) {
    try { facts = JSON.parse(readFileSync(factsPath, 'utf8')) } catch { facts = null }
  } else if (target) {
    facts = detectFacts(target)
  }
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ block: renderRouterStatus(facts) }, null, 2) + '\n')
  } else {
    process.stdout.write(renderRouterStatus(facts) + '\n')
  }
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

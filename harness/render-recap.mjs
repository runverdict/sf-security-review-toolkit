#!/usr/bin/env node
/*
 * render-recap.mjs — the VERBATIM end-of-run audit recap (WI-04 / INV-34,
 * presentation-consistency Slice 3). The output-class analog of the gate-spec engine:
 * the ENGINE owns the recap SKELETON, the driver pastes it byte-for-byte into
 * `audit-codebase` Step 7. `merge-ledger.mjs` (which already owns the run-log + counts)
 * emits this block to stdout at the end of every pass.
 *
 * WHY THIS EXISTS. The run recap — which dimensions ran, candidate/confirmed/refuted/
 * unverified counts, the proceed-vs-halt verdict, and the "not covered" caveat — was
 * driver-improvised prose. This pins it: a fixed block LED BY the finding-cluster triage
 * headline (`renderClusterHeadline`, byte-identical to the Step-3 blocker gate and the
 * Step-6 exec summary), so the headline that gates the run reads the same everywhere.
 *
 * INPUTS — a facts object (the pass stats merge-ledger already computes):
 *   { findings, dimensions:[…], candidates, confirmed, refuted, unverified, pass, tier }
 * `findings` is the merged ledger findings (the cluster + halt verdict derive from it);
 * the counts are this pass's stats. Every field optional — honest fallbacks, never a crash.
 *
 * DETERMINISTIC + PURE (CONVENTIONS §7): same facts → byte-identical block. No LLM, no
 * network, no deps, no Date/Math.random (the cluster lead is itself pure).
 *
 * USAGE:
 *   node render-recap.mjs --input <recap-facts.json>
 *   node render-recap.mjs --target <repo>   # derives facts from the ledger's latest pass
 */
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clusterFindings, renderClusterHeadline } from './finding-clusters.mjs'

const n = (v, def = 0) => (Number.isFinite(v) ? v : def)

/** Pure: the recap facts → the fixed recap block, LED by the cluster triage headline. */
export function renderAuditRecap(facts) {
  // "Present" = facts is an object carrying real audit-pass signal. A null/missing facts (no
  // ledger, the audit never ran) is NOT "zero findings" — it must read UNAVAILABLE, never a
  // false PROCEED/clean. A bare {} likewise has no audit data. (Adversarial-review fix.)
  // Honesty guard (CLAUDE.md rule-8 dict-vs-array corollary): a PRESENT-but-non-array
  // `findings` (a dict like `{factor:{...}}`) is an UNREADABLE shape, NOT "no findings" — it
  // forces UNAVAILABLE even when a pass/dimensions field would otherwise read as present, so a
  // malformed-but-present ledger can never become a false PROCEED / "no open confirmed findings".
  const findingsPresentNonArray =
    facts && typeof facts === 'object' && facts.findings != null && !Array.isArray(facts.findings)
  const present =
    !findingsPresentNonArray &&
    facts && typeof facts === 'object' &&
    (Array.isArray(facts.findings) || Number.isInteger(facts.pass) || Array.isArray(facts.dimensions))
  const f = present ? facts : {}
  const pass = Number.isInteger(f.pass) ? f.pass : '?'
  const tier = f.tier ? String(f.tier) : 'unknown-tier'
  const findings = Array.isArray(f.findings) ? f.findings : []
  const dims = Array.isArray(f.dimensions) ? f.dimensions.filter(Boolean) : []

  // The cluster lead — byte-identical to finding-clusters --headline over the same findings.
  // When there is NO audit data, pass null so renderClusterHeadline takes its UNAVAILABLE
  // branch ("could not read the ledger"), NOT the NONE branch ("no open confirmed findings").
  const cluster = present ? clusterFindings(findings) : null
  const headline = renderClusterHeadline(cluster)

  const L = [`## Audit pass ${pass} recap (${tier})`, '']
  // 1) LED BY the finding-cluster triage headline (verbatim).
  L.push(headline)
  L.push('')

  if (!present) {
    // No audit data at all — honest UNAVAILABLE, never a PROCEED/clean verdict.
    L.push('**This pass:** no recorded audit-pass data found.')
    L.push('')
    L.push(
      '**Verdict: UNAVAILABLE.** No audit ledger/pass data was found — run ' +
        '`/sf-security-review-toolkit:audit-codebase` first. This is NOT a clean result and NOT a PROCEED.'
    )
    L.push('')
    L.push('**Not covered** (white-box static review by LLM agents):')
    L.push('- Packaged Apex CRUD/FLS → Code Analyzer / Graph Engine.')
    L.push('- Dynamic runtime behavior → DAST.')
    L.push('- Salesforce performs its own penetration test on the live solution regardless.')
    return L.join('\n')
  }

  // Proceed-vs-halt: an OPEN critical/high in the ledger halts the journey (the same raw
  // counts the headline reports — single source, so verdict and headline can't disagree).
  const crit = cluster.by_severity && Number.isFinite(cluster.by_severity.critical) ? cluster.by_severity.critical : 0
  const high = cluster.by_severity && Number.isFinite(cluster.by_severity.high) ? cluster.by_severity.high : 0
  const halt = crit + high > 0

  // 2) this pass's counts.
  L.push(`**This pass:** ${dims.length} dimension(s) ran${dims.length ? ` — ${dims.join(', ')}` : ''}.`)
  L.push(`Candidates ${n(f.candidates)} · confirmed/partial ${n(f.confirmed)} · refuted ${n(f.refuted)} · unverified ${n(f.unverified)}.`)
  L.push('')
  // 3) proceed-vs-halt verdict.
  if (halt) {
    L.push(
      `**Verdict: HALT.** ${crit} critical + ${high} high open in the ledger. The journey auto-proceeds to the ` +
        'NOT-READY report (this is an audit tool — it never fixes, never writes code, and is read-only on your ' +
        'source). generate-artifacts withholds the AuthN/AuthZ doc while an open critical/high sits in that ' +
        'category. Fix and re-run; the staleness check re-audits only the changed dimensions.'
    )
  } else {
    L.push(
      '**Verdict: PROCEED.** No open critical/high in the ledger within the audited dimensions. ' +
        'This bounds false positives by verification; it never proves absence — "no blockers" is not "secure" ' +
        '(CONVENTIONS §2).'
    )
  }
  L.push('')
  // 4) the fixed "not covered" caveat lines.
  L.push('**Not covered by this pass** (white-box static review by LLM agents):')
  L.push('- Packaged Apex CRUD/FLS → Code Analyzer / Graph Engine.')
  L.push('- Dynamic runtime behavior → DAST.')
  L.push('- Salesforce performs its own penetration test on the live solution regardless.')
  return L.join('\n')
}

/** Derive recap facts from a ledger's latest pass (for `--target` standalone re-render). */
function factsFromLedger(ledger) {
  if (!ledger || typeof ledger !== 'object') return null
  const passes = Array.isArray(ledger.passes) ? ledger.passes : []
  // No recorded pass = the audit never completed one = no recap data → UNAVAILABLE, not clean.
  if (!passes.length) return null
  const latest = passes.reduce((m, p) => (m && m.id >= p.id ? m : p), null)
  return {
    findings: Array.isArray(ledger.findings) ? ledger.findings : [],
    dimensions: latest && Array.isArray(latest.dimensions) ? latest.dimensions : [],
    candidates: latest ? latest.candidates : 0,
    confirmed: latest ? latest.confirmed : 0,
    refuted: latest ? latest.refuted : 0,
    unverified: latest ? latest.unverified : 0,
    pass: latest ? latest.id : undefined,
    tier: latest ? latest.tier : undefined,
  }
}

function main() {
  const arg = (flag, def) => {
    const i = process.argv.indexOf(flag)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
  }
  const input = arg('--input', null)
  const target = arg('--target', null)
  let facts = null
  if (input) {
    try { facts = JSON.parse(readFileSync(input, 'utf8')) } catch { facts = null }
  } else if (target) {
    let ledger = null
    try { ledger = JSON.parse(readFileSync(join(target, '.security-review', 'audit-ledger.json'), 'utf8')) } catch {}
    facts = factsFromLedger(ledger)
  }
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ block: renderAuditRecap(facts) }, null, 2) + '\n')
  } else {
    process.stdout.write(renderAuditRecap(facts) + '\n')
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

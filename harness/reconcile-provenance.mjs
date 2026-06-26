#!/usr/bin/env node
/*
 * reconcile-provenance.mjs — LLM-supersession ENFORCEMENT (Phase 1 · Slice 2 of
 * docs/roadmap-deterministic-findings.md §3). The enforcement half of the deterministic
 * findings architecture: a deterministic engine is AUTHORITATIVE for the class it owns,
 * so the LLM can never refute, downgrade, or DUPLICATE a finding an engine already
 * determined.
 *
 * THE RULE. When a `provenance:'deterministic'` finding and an `llm-inferred` finding
 * occupy the SAME owned class at the SAME locus (same normalized file + overlapping line
 * span — reusing finding-clusters.mjs `sameLocation`), the deterministic finding WINS:
 * the LLM finding is SUPERSEDED — `status:'superseded'`, `superseded_by` = the
 * deterministic finding's id — so it leaves the open band but stays in the ledger,
 * auditable and recoverable (never deleted; mirrors the refuted-finding posture).
 *
 * WHY (the fixrun4 fix's other half). The campaign caught the LLM both (a) DROPPING a real
 * blocker by a phantom hand-off (methodology fix — see apex-exposed-surface.md §5/§6) and
 * (b) re-reporting, at a wobbling severity, a CRUD/FLS gap the scanner determines every
 * run. This engine kills (b): once the scanner has produced a deterministic finding, the
 * LLM's co-located same-class finding is structurally demoted — at the merge layer, not in
 * a prompt the LLM can ignore. The band stops being a probabilistic sample of an engine's
 * job.
 *
 * SAFETY / CONSERVATISM (the "never hide a finding" contract, ported from
 * finding-clusters.mjs's under-merge posture):
 *   - Only a deterministic finding that OWNS a class (carries a `class` field — a MAPPED
 *     rule) supersedes; an unmapped-fallback deterministic finding owns no class and
 *     supersedes nothing.
 *   - Same-class is matched PRECISELY when both carry an explicit `class` (exact key
 *     match); when the LLM finding has no `class` (the realistic case — LLM findings are
 *     dimension-tagged, not class-tagged) it falls back to a `dimension` match. Two
 *     INDEPENDENT signals (locus AND class/dimension) are required, never locus alone.
 *   - A different class, a different dimension, or a non-overlapping locus is UNTOUCHED.
 *   - Supersede MARKS (status:'superseded'), never DELETES — a human/auditor still sees it.
 *
 * PURE + IDEMPOTENT. No Date / Math.random / network; byte-deterministic given the input.
 * reconcileProvenance(reconcileProvenance(x).findings) === reconcileProvenance(x).findings
 * (an already-superseded finding is skipped; a deterministic finding is never touched).
 *
 * Read-only on partner source except the ledger it reconciles
 * (<target>/.security-review/audit-ledger.json).
 *
 * Usage:
 *   node reconcile-provenance.mjs --target <repo> [--json] [--dry-run]
 */
import { writeFileSync, mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sameLocation } from './finding-clusters.mjs' // the SAME tested same-code-location primitive
import { loadLedger } from './ingest-scanner-findings.mjs' // canonical ledger loader (data-loss guard)

export const SUPERSEDED = 'superseded'
// Owner-decided / terminal lifecycle states an automated reconcile must never overwrite.
const PROTECTED_LLM_STATES = new Set([SUPERSEDED, 'fixed', 'accepted_risk'])

const isDeterministic = (f) => String(f && f.provenance) === 'deterministic'
// llm-inferred OR unset (a finding written before the provenance field existed defaults
// to llm-inferred — schema §provenance.default).
const isLlmInferred = (f) => !!f && !isDeterministic(f)

// A finding's OWNED toolkit class: the explicit `class` field, else null. A deterministic
// finding carries it for a mapped class; an unmapped-fallback or llm-inferred finding omits it.
export function classOf(f) {
  return f && typeof f.class === 'string' && f.class ? f.class : null
}

// Does deterministic finding D own the same class llm-inferred finding L is in?
//   - D MUST own a class (mapped); without one it supersedes nothing.
//   - precise: L also carries an explicit class → exact key match.
//   - fallback: L carries no class (realistic LLM case) → match on dimension (both
//     non-empty + equal). Conservative: requires locus AND this signal, never locus alone.
export function sameOwnedClass(D, L) {
  const cd = classOf(D)
  if (!cd) return false
  const cl = classOf(L)
  if (cl) return cd === cl
  const dd = String((D && D.dimension) || '')
  return dd !== '' && dd === String((L && L.dimension) || '')
}

/**
 * Reconcile provenance over a findings array. Returns a NEW array (shallow-copied
 * findings) with each superseded llm-inferred finding marked, plus a count. Pure.
 *
 * @param {Array<object>} findings
 * @returns {{ findings: Array<object>, superseded: number, supersededIds: string[] }}
 */
export function reconcileProvenance(findings) {
  const arr = Array.isArray(findings) ? findings.map((f) => ({ ...f })) : []
  // owners = deterministic findings that own a class. Computed once; never mutated below
  // (only llm-inferred findings are marked), so the set stays valid across the loop.
  const owners = arr.filter((f) => isDeterministic(f) && classOf(f))
  const supersededIds = []
  if (owners.length) {
    for (const L of arr) {
      if (!isLlmInferred(L)) continue
      if (PROTECTED_LLM_STATES.has(String(L.status || '').toLowerCase())) continue // idempotent + owner states
      const match = owners
        .filter((D) => D.id !== L.id && sameOwnedClass(D, L) && sameLocation(D, L))
        // stable, deterministic pick when >1 deterministic owner sits at the locus
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]
      if (!match) continue
      L.status = SUPERSEDED
      L.superseded_by = match.id
      L.superseded_reason =
        `superseded by deterministic ${match.engine || 'engine'} finding ${match.id} ` +
        `(${match.ruleId || classOf(match)}) at ${match.file} — a scanner-determined ` +
        `${classOf(match)} finding is authoritative; the LLM does not re-report it.`
      supersededIds.push(L.id)
    }
  }
  return { findings: arr, superseded: supersededIds.length, supersededIds: supersededIds.sort() }
}

// ----------------------------------------------------------------------------
// CLI
// ----------------------------------------------------------------------------
function arg(flag, def) {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
function main() {
  const target = arg('--target', process.cwd())
  const asJson = process.argv.includes('--json')
  const dryRun = process.argv.includes('--dry-run')
  const ledgerPath = join(target, '.security-review', 'audit-ledger.json')

  let ledger
  try {
    ledger = loadLedger(ledgerPath) // refuses a corrupted (non-array findings) ledger
  } catch (e) {
    console.error(`reconcile-provenance: ${e.message}`)
    process.exit(2)
  }

  const { findings, superseded, supersededIds } = reconcileProvenance(ledger.findings)
  ledger.findings = findings

  if (!dryRun) {
    try {
      mkdirSync(join(target, '.security-review'), { recursive: true })
    } catch {
      /* dir may already exist */
    }
    writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2))
  }

  if (asJson) {
    process.stdout.write(JSON.stringify({ superseded, supersededIds, dryRun }, null, 2) + '\n')
  } else {
    process.stdout.write(
      `reconcile-provenance: ${superseded} llm-inferred finding(s) superseded by a co-located ` +
        `deterministic owner` +
        (dryRun ? ' (dry-run, not written)' : ` → ${ledgerPath}`) +
        '\n'
    )
    for (const id of supersededIds) process.stdout.write(`  superseded: ${id}\n`)
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

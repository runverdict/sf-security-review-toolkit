#!/usr/bin/env node
/*
 * apply-dispositions.mjs — deterministic-band DISPOSITION application (B3a of the
 * post-cold-run hardening backlog). The verdict-honesty half of the deterministic
 * findings architecture: when the audit ADJUDICATES a deterministic scanner class as a
 * false positive (or an accepted risk), that adjudication must flip the matching ledger
 * entries out of the open band — otherwise the headline, the blocker floor, and the SCI
 * keep counting refuted noise as open blockers.
 *
 * WHY. `ingest-scanner-findings.mjs --all` lands scanner findings in the ledger as
 * `status:'confirmed'` (relayed verbatim — the LLM never re-judges a scanner's existence
 * or severity). On a real cold run the audit then class-dispositions much of that band as
 * false-positive — but it wrote that only into the FP-dossier PROSE, so nothing flipped
 * the ledger status and every status consumer (`finding-clusters.mjs --headline`,
 * `compute-sci.mjs`) still counted the dispositioned class as open blockers. This engine
 * closes that gap: the adjudication is recorded as STRUCTURED, reviewer-reproducible data
 * and a deterministic harness APPLIES it to the ledger.
 *
 * THE DETERMINISM BOUNDARY. Application is 100% deterministic (this engine — pure,
 * idempotent, marks-never-deletes, protected-state-aware, a structural twin of
 * reconcile-provenance.mjs). ADJUDICATION — "is this scanner class a false positive?" —
 * is the labelled semantic residual: the LLM's call, exactly what the audit already does
 * into the dossier. This engine deliberately carries NO hardcoded auto-refute ruleset —
 * a rule that is *usually* noise can be a *real* bug in some code, and a blanket
 * deterministic refutation would silently hide it. The adjudication arrives as data.
 *
 * THE INPUT — <target>/.security-review/deterministic-dispositions.json, written by the
 * audit when it adjudicates a deterministic class (the SAME reason it puts in the FP
 * dossier, so the dossier row and the ledger flip come from ONE source and can never
 * diverge):
 *
 *   { "dispositions": [
 *     { "engine": "semgrep", "ruleId": "python.lang.security.audit.<rule>",
 *       "disposition": "refuted",            // "refuted" (FP) | "accepted_risk"
 *       "reason": "constant GUC bound at request entry; the flagged predicate is not user-influenced (…)",
 *       "accepted_risk_justification": "…",  // REQUIRED iff disposition === "accepted_risk"
 *       "scope": { "files": ["…"] }          // OPTIONAL — omit to disposition the WHOLE engine+ruleId class
 *     }
 *   ] }
 *
 * SAFETY / CONSERVATISM (the honesty-preserving core — a disposition can only ever move
 * a DETERMINISTIC finding OUT of the open band):
 *   - It ONLY ever touches a `provenance:'deterministic'` finding. It NEVER flips an
 *     `llm-inferred` finding (those are the LLM's OWN confirmed findings — a disposition
 *     must not be able to hide an LLM-confirmed blocker). Paramount safety property.
 *   - Match is EXACT `engine` AND `ruleId` (never a substring/fuzzy match that could
 *     over-flip), optionally narrowed by `scope.files` (normalized-file match; no scope →
 *     the whole engine+ruleId class). A disposition matching nothing is a reported no-op.
 *   - The only legal targets are `refuted` and `accepted_risk` — never `confirmed`/
 *     `regressed` (into the open band) and never `fixed` (that requires a real fix
 *     reference). `accepted_risk` REQUIRES its justification (schema-valid, never bare).
 *   - PROTECTED states (`fixed`, `accepted_risk`, `superseded`) are never overwritten —
 *     owner/terminal lifecycle states, exactly reconcile-provenance's posture.
 *   - The flip KEEPS `provenance`/`engine`/`ruleId`/`class`/severity intact and records a
 *     `disposition_reason` (analogous to `superseded_reason`) — a layer on top, never a
 *     rewrite; the finding stays reviewer-reproducible, only its lifecycle status moved.
 *     It never re-severities a finding (lifecycle status only).
 *
 * PURE + IDEMPOTENT. No Date / Math.random / network; byte-deterministic given the input.
 * applyDispositions(applyDispositions(x).findings, d) flips 0 the second time (a finding
 * already at the target status — or protected — is skipped).
 *
 * Read-only on partner source except the ledger it dispositions
 * (<target>/.security-review/audit-ledger.json).
 *
 * Usage:
 *   node apply-dispositions.mjs --target <repo> [--json] [--dry-run]
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normFile } from './finding-clusters.mjs' // the SAME tested file-normalization primitive
import { loadLedger } from './ingest-scanner-findings.mjs' // canonical ledger loader (data-loss guard)

// The ONLY legal flip targets: out of the open band, never into it, never `fixed`
// (a fixed status requires a real fix_commit reference — an adjudication is not a fix).
export const DISPOSITION_TARGETS = new Set(['refuted', 'accepted_risk'])
// Owner-decided / terminal lifecycle states an automated apply must never overwrite
// (exactly reconcile-provenance's PROTECTED_LLM_STATES posture).
const PROTECTED_STATES = new Set(['fixed', 'accepted_risk', 'superseded'])

const isDeterministic = (f) => String(f && f.provenance) === 'deterministic'
const oneLine = (s, n = 240) => {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}
// scope-file normalization: forward slashes, no leading ./ or /, trailing :line span
// stripped via the same normFile primitive the locus engines use — exact match after that,
// never a substring (a scope must not over-flip a sibling path).
const normScopeFile = (p) =>
  normFile(String(p == null ? '' : p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, ''))

/**
 * Validate ONE disposition entry → an array of human-readable errors ([] = valid).
 * An invalid entry is REJECTED as a whole (reported, never partially applied) — a
 * malformed adjudication must not produce an invalid ledger entry (e.g. a bare
 * accepted_risk with no justification violates the ledger schema).
 */
export function validateDisposition(d) {
  const errors = []
  if (!d || typeof d !== 'object' || Array.isArray(d)) return ['disposition entry is not an object']
  if (typeof d.engine !== 'string' || !d.engine.trim()) errors.push('missing/empty `engine`')
  if (typeof d.ruleId !== 'string' || !d.ruleId.trim()) errors.push('missing/empty `ruleId`')
  if (!DISPOSITION_TARGETS.has(d.disposition)) {
    errors.push(
      `illegal \`disposition\` '${String(d.disposition)}' — only 'refuted' | 'accepted_risk' ` +
        `(never into the open band, never 'fixed')`
    )
  }
  if (typeof d.reason !== 'string' || !d.reason.trim()) errors.push('missing/empty `reason`')
  if (
    d.disposition === 'accepted_risk' &&
    (typeof d.accepted_risk_justification !== 'string' || !d.accepted_risk_justification.trim())
  ) {
    errors.push('`accepted_risk` requires a non-empty `accepted_risk_justification` (the ledger schema mandates it)')
  }
  if (d.scope != null) {
    const filesOk =
      typeof d.scope === 'object' &&
      !Array.isArray(d.scope) &&
      Array.isArray(d.scope.files) &&
      d.scope.files.length > 0 &&
      d.scope.files.every((f) => typeof f === 'string' && f.trim())
    if (!filesOk) errors.push('`scope` must be { files: [non-empty strings…] } when present')
  }
  return errors
}

/**
 * Apply structured dispositions over a findings array. Returns a NEW array
 * (shallow-copied findings) with each matched deterministic finding flipped to the
 * disposition's target status, plus counts. Pure.
 *
 * @param {Array<object>} findings
 * @param {{dispositions?: Array<object>}|Array<object>} dispositions — the parsed
 *        deterministic-dispositions.json (or its `dispositions` array directly)
 * @returns {{ findings: Array<object>, applied: number, appliedIds: string[],
 *             unmatched: Array<{engine:string,ruleId:string}>,
 *             invalid: Array<{index:number,errors:string[]}> }}
 */
export function applyDispositions(findings, dispositions) {
  const arr = Array.isArray(findings) ? findings.map((f) => ({ ...f })) : []
  const list = Array.isArray(dispositions)
    ? dispositions
    : dispositions && typeof dispositions === 'object' && Array.isArray(dispositions.dispositions)
      ? dispositions.dispositions
      : []
  const appliedIds = new Set()
  const unmatched = []
  const invalid = []
  list.forEach((d, index) => {
    const errors = validateDisposition(d)
    if (errors.length) {
      invalid.push({ index, errors })
      return
    }
    const scopeFiles =
      d.scope && Array.isArray(d.scope.files) ? new Set(d.scope.files.map(normScopeFile)) : null
    let matchedAny = false
    for (const f of arr) {
      // THE paramount safety property: only a deterministic finding is ever touched — an
      // llm-inferred finding (the LLM's own confirmed blocker) can NEVER be hidden here.
      if (!isDeterministic(f)) continue
      // EXACT engine + ruleId — never a substring/fuzzy match that could over-flip.
      if (String(f.engine) !== String(d.engine)) continue
      if (String(f.ruleId) !== String(d.ruleId)) continue
      if (scopeFiles && !scopeFiles.has(normScopeFile(f.file))) continue
      matchedAny = true
      const status = String(f.status || '').toLowerCase()
      if (PROTECTED_STATES.has(status)) continue // owner/terminal — never overwritten
      if (status === d.disposition) continue // already at the target — idempotent skip
      // The flip: lifecycle status ONLY. provenance/engine/ruleId/class/severity are KEPT —
      // the disposition is a layer on top, never a rewrite. Never verdict, never severity.
      f.status = d.disposition
      f.disposition_reason = oneLine(
        `dispositioned by adjudication: ${d.engine}/${d.ruleId} → ${d.disposition} — ${d.reason}`
      )
      if (d.disposition === 'accepted_risk') {
        f.accepted_risk_justification = oneLine(d.accepted_risk_justification, 500)
      }
      appliedIds.add(f.id)
    }
    if (!matchedAny) unmatched.push({ engine: d.engine, ruleId: d.ruleId }) // reported, never guessed
  })
  const ids = [...appliedIds].sort()
  return { findings: arr, applied: ids.length, appliedIds: ids, unmatched, invalid }
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
  const dispPath = join(target, '.security-review', 'deterministic-dispositions.json')

  let ledger
  try {
    ledger = loadLedger(ledgerPath) // refuses a corrupted (non-array findings) ledger
  } catch (e) {
    console.error(`apply-dispositions: ${e.message}`)
    process.exit(2)
  }

  // Absent dispositions file → a clean no-op (the audit adjudicated no deterministic
  // class). Present-but-corrupted → refuse LOUD: a typo in the adjudication file must
  // not silently skip the honesty flip.
  let dispositions = { dispositions: [] }
  const dispPresent = existsSync(dispPath)
  if (dispPresent) {
    try {
      dispositions = JSON.parse(readFileSync(dispPath, 'utf8'))
    } catch (e) {
      console.error(`apply-dispositions: cannot parse ${dispPath} (${e.message}) — fix the dispositions file and re-run`)
      process.exit(2)
    }
    const shapeOk =
      Array.isArray(dispositions) ||
      (dispositions && typeof dispositions === 'object' && Array.isArray(dispositions.dispositions))
    if (!shapeOk) {
      console.error(
        `apply-dispositions: ${dispPath} is not { dispositions: [...] } (or a bare array) — fix the dispositions file and re-run`
      )
      process.exit(2)
    }
  }

  const { findings, applied, appliedIds, unmatched, invalid } = applyDispositions(ledger.findings, dispositions)
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
    process.stdout.write(
      JSON.stringify({ applied, appliedIds, unmatched, invalid, dispositionsFile: dispPresent ? 'present' : 'absent', dryRun }, null, 2) + '\n'
    )
  } else {
    process.stdout.write(
      `apply-dispositions: ${applied} deterministic finding(s) dispositioned out of the open band` +
        (dispPresent ? '' : ' (no deterministic-dispositions.json — nothing to apply)') +
        (dryRun ? ' (dry-run, not written)' : ` → ${ledgerPath}`) +
        '\n'
    )
    for (const id of appliedIds) process.stdout.write(`  dispositioned: ${id}\n`)
    for (const u of unmatched) process.stdout.write(`  no-op (matched nothing): ${u.engine}/${u.ruleId}\n`)
    for (const iv of invalid) process.stdout.write(`  REJECTED entry #${iv.index}: ${iv.errors.join('; ')}\n`)
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

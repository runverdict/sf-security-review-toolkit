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
 *       "scope": { "files": ["…"] }          // MANDATORY — exactly ONE of `files` | `as_of_pass`
 *     }
 *   ] }
 *
 * A2 (0.8.103) — THE SCOPE IS MANDATORY, in exactly one of two forms:
 *   - `scope.files: [...]` — the loci the adjudicator actually read. Applies only there
 *     (normalized-file exact match). Semantics unchanged from the original scoped path.
 *   - `scope.as_of_pass: N` — rule-wide, but BOUNDED IN TIME: applies only to findings
 *     whose OWN `first_seen` is a valid positive integer <= N. The honest encoding of
 *     "I reviewed every instance of this rule present at pass N; all false positives."
 * An unscoped disposition (or both keys, or an empty/invalid scope) is a HARD validation
 * error — rejected whole, nothing applied. WHY: apply re-runs on every pass, so an
 * unscoped entry was an unbounded, PERMANENT rule-wide suppression — a finding of the
 * same rule first discovered months later, at a file that did not exist when the reason
 * was written, was auto-refuted on arrival. That is now unexpressible. A finding that
 * matches a rule-wide adjudication but post-dates it (first_seen > N, or missing/invalid
 * first_seen — FAIL CLOSED: a finding we cannot date is a finding we have not
 * adjudicated) STAYS `confirmed` and gains an auditable `pending_readjudication` note —
 * never a status change, never a severity change. For a cross-dimension merged parent
 * the gate runs on EACH LENS's own first_seen, never the parent's (the parent's is a
 * fail-open min); a time-excluded lens is simply UNMATCHED, so the every-lens-matched
 * invariant keeps the parent open — the correct fail-closed composition.
 *
 * BLAST RADIUS (A2): the result carries per-disposition counts (matched / flipped /
 * pending / distinct files) and the CLI prints one line per disposition — a single line
 * silencing 161 findings is never again silent. Attribution rule for jointly-flipped
 * merged parents: a parent flips only after the disposition SET matched every lens, so
 * EVERY disposition that matched at least one of its lenses is credited with the parent
 * in both its matched and flipped tallies (not just the last one to match).
 *
 * SAFETY / CONSERVATISM (the honesty-preserving core — a disposition can only ever move
 * a DETERMINISTIC finding OUT of the open band):
 *   - It ONLY ever touches a `provenance:'deterministic'` finding. It NEVER flips an
 *     `llm-inferred` finding (those are the LLM's OWN confirmed findings — a disposition
 *     must not be able to hide an LLM-confirmed blocker). Paramount safety property.
 *   - Match is EXACT `engine` AND `ruleId` (never a substring/fuzzy match that could
 *     over-flip), ALWAYS bounded by the mandatory scope — `scope.files` (normalized-file
 *     exact match) or `scope.as_of_pass` (per-finding/per-lens `first_seen <= N` gate,
 *     fail-closed on missing/invalid `first_seen`). A disposition matching nothing is a reported no-op.
 *   - A1 (0.8.102) — a cross-dimension MERGED PARENT (`provenance:'deterministic'` +
 *     `lenses[]`) is matched THROUGH its lenses (exact engine+ruleId per lens; scope
 *     against the lens's own file), and is flipped ONLY when EVERY lens is matched by
 *     some disposition in the file. The parent is a CONJUNCTION of observations —
 *     clearing it on a partial match would let a real finding hide behind a co-located
 *     false positive, so a partial match only records an auditable `partial_disposition`
 *     annotation and NEVER changes `status`. An `llm-inferred` parent (mixed lenses) is
 *     never touched at all, exactly like every other llm-inferred finding.
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
  // A2 (0.8.103) — a scope is MANDATORY, in exactly ONE of two forms. An unscoped
  // disposition matched engine+ruleId across the whole repo FOREVER (apply re-runs every
  // pass), silently refuting findings discovered later at loci nobody read. Unexpressible.
  const scopeHelp =
    'add `scope.files` (the exact loci you read and adjudicated) or `scope.as_of_pass` ' +
    '(the pass whose findings you reviewed — rule-wide but bounded in time). An unscoped ' +
    'disposition would re-apply on every future pass and auto-refute findings of the same ' +
    'rule at loci nobody has looked at — this tool deliberately cannot express that'
  if (d.scope == null || typeof d.scope !== 'object' || Array.isArray(d.scope)) {
    errors.push(`missing \`scope\` — ${scopeHelp}`)
  } else {
    const hasFiles = 'files' in d.scope
    const hasAsOf = 'as_of_pass' in d.scope
    if (hasFiles && hasAsOf) {
      errors.push(`\`scope\` must carry EXACTLY ONE of \`files\` | \`as_of_pass\`, not both — ${scopeHelp}`)
    } else if (!hasFiles && !hasAsOf) {
      errors.push(`empty \`scope\` — ${scopeHelp}`)
    } else if (hasFiles) {
      const filesOk =
        Array.isArray(d.scope.files) &&
        d.scope.files.length > 0 &&
        d.scope.files.every((f) => typeof f === 'string' && f.trim())
      if (!filesOk) errors.push(`\`scope.files\` must be a non-empty array of non-empty strings — ${scopeHelp}`)
    } else if (!Number.isInteger(d.scope.as_of_pass) || d.scope.as_of_pass < 1) {
      errors.push(
        `\`scope.as_of_pass\` must be a positive integer pass id (got ${JSON.stringify(d.scope.as_of_pass)}) — ${scopeHelp}`
      )
    }
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
 *             invalid: Array<{index:number,errors:string[]}>,
 *             perDisposition: Array<{index:number,engine:string,ruleId:string,
 *               disposition:string,matched:number,flipped:number,pending:number,
 *               files:number}> }}
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
  // A2 (0.8.103) — the BLAST RADIUS, per disposition: which findings each entry matched,
  // flipped, or left pending re-adjudication, and across how many distinct files. Sets of
  // finding ids so a parent matched through two lenses of ONE disposition counts once.
  const stats = [] // one row per VALID disposition, in file order
  const statBy = new Map() // disposition object → its stats row (for parent attribution)
  // A2 — the as_of_pass time gate, evaluated per finding (and per LENS for merged
  // parents). FAIL CLOSED: only a valid positive-integer first_seen <= N passes; an
  // absent / null / string / fractional first_seen means the row cannot be dated, and a
  // finding we cannot date is a finding we have not adjudicated — never defaulted to 1.
  const firstSeenOk = (fs, n) => Number.isInteger(fs) && fs >= 1 && fs <= n
  const pendingNote = (d, fs) =>
    oneLine(
      `matches ${d.engine}/${d.ruleId}, adjudicated as of pass ${d.scope.as_of_pass}; ` +
        (Number.isInteger(fs) && fs >= 1
          ? `this locus is new (first_seen ${fs}) — re-adjudicate`
          : 'this locus has no valid first_seen (fail closed) — re-adjudicate')
    )
  // A1 (0.8.102) — merged-parent lens matching. A cross-dimension merged parent
  // (`provenance:'deterministic'` + a non-empty `lenses[]`) carries no top-level
  // engine/ruleId when its lenses disagree, so it is matched THROUGH its lenses.
  // "Every lens matched" is a property of the FULL disposition set — a later
  // disposition may match the remaining lens — so lens matches are ACCUMULATED here
  // across the whole outer loop and the parents are resolved in a second pass below.
  // Plain single-lens findings keep the immediate-flip path unchanged.
  const isMergedParent = (f) => Array.isArray(f.lenses) && f.lenses.length > 0
  // A lens is matchable only through fields it actually CARRIES — exact string match,
  // never a match against an absent field (String(undefined) === 'undefined' could be
  // spoofed by a hostile disposition naming engine "undefined").
  const lensMatches = (l, d, scopeFiles) =>
    typeof l.engine === 'string' && l.engine === String(d.engine) &&
    typeof l.ruleId === 'string' && l.ruleId === String(d.ruleId) &&
    (!scopeFiles || scopeFiles.has(normScopeFile(l.file)))
  const parentMatches = new Map() // merged parent → Map(lens index → first matching disposition)
  list.forEach((d, index) => {
    const errors = validateDisposition(d)
    if (errors.length) {
      invalid.push({ index, errors })
      return
    }
    const stat = {
      index,
      engine: String(d.engine),
      ruleId: String(d.ruleId),
      disposition: String(d.disposition),
      matched: new Set(),
      flipped: new Set(),
      pending: new Set(),
      files: new Set(),
    }
    stats.push(stat)
    statBy.set(d, stat)
    const scopeFiles =
      d.scope && Array.isArray(d.scope.files) ? new Set(d.scope.files.map(normScopeFile)) : null
    const asOfPass = d.scope && Number.isInteger(d.scope.as_of_pass) ? d.scope.as_of_pass : null
    let matchedAny = false
    for (const f of arr) {
      // THE paramount safety property: only a deterministic finding is ever touched — an
      // llm-inferred finding (the LLM's own confirmed blocker) can NEVER be hidden here.
      // An llm-inferred merged parent (mixed lenses) is gated out here too — its lenses
      // are never even inspected.
      if (!isDeterministic(f)) continue
      if (isMergedParent(f)) {
        // Accumulate per-lens matches (EXACT engine + ruleId per lens; scope.files
        // against the LENS's own file). The flip decision is deferred to the second
        // pass — never flipped inside the disposition loop.
        f.lenses.forEach((l, li) => {
          if (!lensMatches(l, d, scopeFiles)) return
          matchedAny = true
          stat.matched.add(f.id)
          stat.files.add(normScopeFile(l.file))
          // A2 — the time gate runs on the LENS's OWN first_seen, NEVER the parent's:
          // the parent's is a fail-open min (`|| 1`), so gating on it would let one old
          // lens mask a brand-new lens — exactly the suppression this slice removes. A
          // time-excluded (or undatable — fail closed) lens is left UNMATCHED, so the
          // every-lens-matched invariant below keeps the parent open; the parent gains
          // the auditable pending note when it sits in the open band.
          if (asOfPass != null && !firstSeenOk(l.first_seen, asOfPass)) {
            const st = String(f.status || '').toLowerCase()
            if (st === 'confirmed' || st === 'regressed') {
              stat.pending.add(f.id)
              f.pending_readjudication = pendingNote(d, l.first_seen)
            }
            return
          }
          let m = parentMatches.get(f)
          if (!m) {
            m = new Map()
            parentMatches.set(f, m)
          }
          if (!m.has(li)) m.set(li, d) // first matching disposition wins for reason attribution
        })
        continue
      }
      // EXACT engine + ruleId — never a substring/fuzzy match that could over-flip.
      if (String(f.engine) !== String(d.engine)) continue
      if (String(f.ruleId) !== String(d.ruleId)) continue
      if (scopeFiles && !scopeFiles.has(normScopeFile(f.file))) continue
      matchedAny = true
      stat.matched.add(f.id)
      stat.files.add(normScopeFile(f.file))
      const status = String(f.status || '').toLowerCase()
      if (PROTECTED_STATES.has(status)) continue // owner/terminal — never overwritten
      // A2 — the as_of_pass time gate: a finding first seen AFTER the adjudication (or
      // one we cannot date — fail closed) is NEVER flipped. It stays in the open band,
      // the headline, the blocker count; it gains only the auditable pending note.
      // Never a status change, never a severity change.
      if (asOfPass != null && !firstSeenOk(f.first_seen, asOfPass)) {
        if (status === 'confirmed' || status === 'regressed') {
          f.pending_readjudication = pendingNote(d, f.first_seen)
          stat.pending.add(f.id)
        }
        continue
      }
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
      delete f.pending_readjudication // a stale pending note must not survive a legitimate flip
      for (const s of stats) s.pending.delete(f.id) // it is no longer LEFT pending by anyone
      appliedIds.add(f.id)
      stat.flipped.add(f.id)
    }
    if (!matchedAny) unmatched.push({ engine: d.engine, ruleId: d.ruleId }) // reported, never guessed
  })
  // A1 second pass — resolve the merged parents. THE SAFETY INVARIANT: a merged parent
  // is a CONJUNCTION of observations, so it is flipped out of the open band ONLY when
  // EVERY one of its lenses was matched by some disposition across the whole file.
  // Clearing it on a partial match would let a real finding hide behind a co-located
  // false positive — the partial case is recorded as an auditable `partial_disposition`
  // annotation and the status NEVER changes.
  for (const [f, m] of parentMatches) {
    const status = String(f.status || '').toLowerCase()
    if (PROTECTED_STATES.has(status)) continue // owner/terminal — never overwritten
    if (m.size < f.lenses.length) {
      const matched = [...m.keys()].sort((a, b) => a - b)
        .map((li) => `${f.lenses[li].engine}/${f.lenses[li].ruleId}`)
      f.partial_disposition = oneLine(
        `partial adjudication — ${m.size} of ${f.lenses.length} lenses matched (${matched.join(', ')}); ` +
          `the parent stays open until EVERY lens is dispositioned`
      )
      continue // status untouched — the safety invariant
    }
    // Every lens matched. Target: `accepted_risk` if ANY matching disposition accepts
    // the risk (an acknowledged-real lens must never be buried under a blanket
    // `refuted`), else `refuted`. Deterministic: lens order × disposition-file order.
    const ds = [...m.values()]
    const riskD = ds.find((d) => d.disposition === 'accepted_risk')
    const target = riskD ? 'accepted_risk' : 'refuted'
    if (status === target) continue // already at the target — idempotent skip
    const parts = [...m.keys()].sort((a, b) => a - b).map((li) => {
      const d = m.get(li)
      return `${d.engine}/${d.ruleId} → ${d.disposition} — ${d.reason}`
    })
    f.status = target
    f.disposition_reason = oneLine(
      `dispositioned by adjudication (all ${f.lenses.length} lenses): ${[...new Set(parts)].join('; ')}`
    )
    if (target === 'accepted_risk') {
      f.accepted_risk_justification = oneLine(riskD.accepted_risk_justification, 500)
    }
    delete f.partial_disposition // a stale partial note from an earlier run must not survive the full flip
    delete f.pending_readjudication // ditto — every lens is now matched within its bound
    appliedIds.add(f.id)
    // A2 — ATTRIBUTION RULE for a jointly-flipped merged parent: the flip happened only
    // because the disposition SET matched every lens, so EVERY disposition that matched
    // at least one lens is credited with the parent in its flipped tally — never just
    // the last one to match. (Each already recorded the parent in `matched` above.)
    for (const d of new Set(m.values())) {
      const s = statBy.get(d)
      if (s) s.flipped.add(f.id)
    }
    for (const s of stats) s.pending.delete(f.id) // flipped, so no longer LEFT pending by anyone
  }
  const ids = [...appliedIds].sort()
  const perDisposition = stats.map((s) => ({
    index: s.index,
    engine: s.engine,
    ruleId: s.ruleId,
    disposition: s.disposition,
    matched: s.matched.size,
    flipped: s.flipped.size,
    pending: s.pending.size,
    files: s.files.size,
  }))
  return { findings: arr, applied: ids.length, appliedIds: ids, unmatched, invalid, perDisposition }
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

  const { findings, applied, appliedIds, unmatched, invalid, perDisposition } = applyDispositions(
    ledger.findings,
    dispositions
  )
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
      JSON.stringify(
        { applied, appliedIds, unmatched, invalid, perDisposition, dispositionsFile: dispPresent ? 'present' : 'absent', dryRun },
        null,
        2
      ) + '\n'
    )
  } else {
    process.stdout.write(
      `apply-dispositions: ${applied} deterministic finding(s) dispositioned out of the open band` +
        (dispPresent ? '' : ' (no deterministic-dispositions.json — nothing to apply)') +
        (dryRun ? ' (dry-run, not written)' : ` → ${ledgerPath}`) +
        '\n'
    )
    // A2 — the blast radius, one line per disposition: a single line silencing 161
    // findings must never again be silent.
    for (const p of perDisposition) {
      process.stdout.write(
        `  ${p.engine}/${p.ruleId} → ${p.disposition}: ${p.matched} matched, ${p.flipped} flipped, ` +
          `${p.pending} pending (${p.files} files)\n`
      )
    }
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

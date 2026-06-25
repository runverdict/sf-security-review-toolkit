#!/usr/bin/env node
/*
 * render-stability.mjs — the VERBATIM Finding-Stability block for the readiness
 * verdict (WI-00B render-harness + WI-03). The output class's analog of the
 * gate-spec engine: the ENGINE owns the block SKELETON, the driver pastes it
 * byte-for-byte.
 *
 * WHY THIS EXISTS. The "Finding Stability (N-run consensus)" section of the
 * readiness verdict was driver-improvised prose — rendered as a table one run and
 * text the next, with the contestable band named differently each time. This pins
 * it: a deterministic fixed-block render over recurrence-confidence.json, exactly
 * the two-mode shape compute-sci.mjs already ships (a JSON-or-verbatim-Markdown
 * emitter the skill pastes verbatim into the readiness-tracker header).
 *
 * It reads the recurrence classifier's JSON (harness/recurrence-confidence.mjs):
 *   { summary:{ n_runs, commit_consistency, confirmed_per_run, pairwise_jaccard,
 *               bucket_counts:{all_runs_stable,all_runs_unstable,some_runs,single_run},
 *               reliably_recurring_blockers[] }, loci[], caveat }
 * and emits ONE fixed Markdown block, in two branches:
 *   - PRESENT  (n_runs >= 2): a bucket_counts table + the reliably-recurring
 *              blocker list + the contestable band NAMED consistently + a
 *              mixed-commit note when commit_consistency != 'consistent';
 *   - ABSENT / SINGLE-RUN (no data, or n_runs <= 1): ONE fixed honest line — no
 *              stability signal yet.
 * Both branches carry the "informational only — changes NOTHING about the SCI
 * gate" caveat, and NEITHER ever asserts the audit is complete / passed / safe.
 *
 * DETERMINISTIC + PURE (CONVENTIONS §7): same JSON in → byte-identical block out.
 * No LLM, no network, no deps, no Date/Math.random.
 *
 * USAGE:
 *   node render-stability.mjs --target <repo>          # reads .security-review/recurrence-confidence.json
 *   node render-stability.mjs --input <file.json>      # reads an explicit JSON file
 *   (a missing/unreadable/non-JSON source → the ABSENT one-liner, never a crash)
 */
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Stability needs at least two independent runs — one run gives no recurrence signal.
export const MIN_RUNS_FOR_STABILITY = 2

// The informational caveat, identical on both branches — finding stability is
// descriptive and NEVER a go/no-go input (CONVENTIONS §2).
const INFO_CAVEAT = [
  '> Informational only — this describes how reliably findings recurred across independent',
  '> runs. It changes NOTHING about the SCI gate or the readiness band: it never inflates',
  '> readiness, never clears a blocker, and is never a go/no-go input. No fixed run-count',
  '> certifies the audit complete; Salesforce performs its own penetration test regardless.',
]

/** Pure: the recurrence-confidence JSON (or null) → the fixed Finding-Stability block. */
export function renderStability(data) {
  const L = ['### Finding Stability (N-run consensus)', '', ...INFO_CAVEAT, '']
  const s = data && typeof data === 'object' ? data.summary : null
  const n = s && Number.isInteger(s.n_runs) ? s.n_runs : 0

  if (!s || n < MIN_RUNS_FOR_STABILITY) {
    const why =
      n === 1
        ? 'only one audit run'
        : 'no multi-run recurrence data found (a single audit run is the common case)'
    L.push(
      `Finding stability not assessed: ${why}. To assess the contestable band's run-to-run ` +
        'stability, re-run the audit independently several times on the SAME commit (see ' +
        '`/sf-security-review-toolkit:audit-codebase` step 9).'
    )
    L.push('')
    return L.join('\n')
  }

  // PRESENT branch — n >= 2.
  const bc = s.bucket_counts && typeof s.bucket_counts === 'object' ? s.bucket_counts : {}
  const allStable = Number.isFinite(bc.all_runs_stable) ? bc.all_runs_stable : 0
  const allUnstable = Number.isFinite(bc.all_runs_unstable) ? bc.all_runs_unstable : 0
  const someRuns = Number.isFinite(bc.some_runs) ? bc.some_runs : 0
  const singleRun = Number.isFinite(bc.single_run) ? bc.single_run : 0

  L.push(`Classified across ${n} independent runs of the same codebase.`)
  L.push('')
  L.push('| Recurrence bucket | Count | Meaning |')
  L.push('|---|---|---|')
  L.push(`| all-runs, stable | ${allStable} | confirmed in every run at a stable severity (ANY severity; the critical/high members are the blockers listed below) |`)
  L.push(`| all-runs, unstable | ${allUnstable} | in every run but status/severity drifted — contestable |`)
  L.push(`| some-runs | ${someRuns} | appeared in only some runs — contestable |`)
  L.push(`| single-run | ${singleRun} | seen in one run only — investigate |`)
  L.push('')

  const blockers = Array.isArray(s.reliably_recurring_blockers) ? s.reliably_recurring_blockers : []
  if (blockers.length) {
    L.push(`**Reliably-recurring blockers (${blockers.length})** — what the audit finds dependably:`)
    for (const b of blockers) {
      const span = b && b.line_span && Number.isFinite(b.line_span.lo) ? `:${b.line_span.lo}-${b.line_span.hi}` : ''
      const dims = b && Array.isArray(b.dimensions) && b.dimensions.length ? ` [${b.dimensions.join(', ')}]` : ''
      const note = b && b.stability_note ? ` (${b.stability_note})` : ''
      L.push(`- ${b ? b.file : '(unattributed)'}${span} — ${b ? b.adjusted_severity : '?'}${dims}${note}`)
    }
  } else {
    L.push('**Reliably-recurring blockers:** none — no finding recurred in every run at a stable critical/high severity.')
  }
  L.push('')

  // The contestable band — NAMED consistently (the same vocabulary the classifier uses).
  const contestable = allUnstable + someRuns
  L.push(
    `**Contestable band: ${contestable}** locus/loci (${allUnstable} all-runs-but-unstable + ${someRuns} some-runs) — ` +
      'an incomplete, unstable sample a human must adjudicate run by run; not a completeness claim.'
  )
  L.push('')

  // Mixed-commit honesty note — fires for ANYTHING other than 'consistent' (mixed or unknown).
  if (s.commit_consistency && s.commit_consistency !== 'consistent') {
    L.push(
      `> NOTE: commit_consistency=${s.commit_consistency} — the runs were audited at DIFFERENT (or unknown) ` +
        'commits, so a finding appearing or disappearing across runs may reflect a CODE CHANGE (e.g. a fix ' +
        'that landed between runs) rather than run-to-run instability. Re-run all passes on the SAME commit ' +
        'for a clean stability read.'
    )
    L.push('')
  }
  return L.join('\n')
}

function main() {
  const arg = (flag, def) => {
    const i = process.argv.indexOf(flag)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
  }
  const target = arg('--target', null)
  const input = arg('--input', null)
  const path = input || (target ? join(target, '.security-review', 'recurrence-confidence.json') : null)
  let data = null
  if (path) {
    try {
      data = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      data = null // absent / unreadable / non-JSON → the honest one-liner, never a crash
    }
  }
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ block: renderStability(data) }, null, 2) + '\n')
  } else {
    process.stdout.write(renderStability(data) + '\n')
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

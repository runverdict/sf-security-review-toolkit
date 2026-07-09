#!/usr/bin/env node
/*
 * verify-report-headline.mjs — the deterministic gate on the audit report's
 * headline.
 *
 * WHY THIS EXISTS. audit-codebase Step 6 mandates the report's executive
 * summary be HEADED by the cluster view printed VERBATIM from
 * `finding-clusters.mjs --headline`. In a real cold run the driver skipped the
 * block and hand-wrote "Blocking items (critical/high): none this pass" over a
 * ledger holding 2 confirmed criticals — and nothing detected it: a prose
 * mandate is prose-strength. This engine turns the mandate into an exit code.
 *
 * WHAT IT CHECKS (and the posture):
 *   1. the report CONTAINS the verbatim headline block recomputed from the
 *      CURRENT ledger. The headline logic is IMPORTED from finding-clusters.mjs
 *      (`renderClusterHeadline` + `clusterOrNullFromFindings` — the same
 *      symbols every other surface uses); counting is never reimplemented
 *      here, so the checker and the headline cannot drift.
 *   2. no stated critical/high claim contradicts the ledger. CONSERVATIVE BY
 *      DESIGN — only two demonstrable claim shapes are parsed:
 *        (a) the labelled `Blocking items (critical/high): none|N` line,
 *            anywhere in the report (the §9 executive-summary phrase);
 *        (b) bare same-line `N critical` / `N high` counts INSIDE the headline
 *            region only — the executive-summary text around the verbatim
 *            block, with the block's own bytes excised — never the findings
 *            table, never the remediation prose.
 *      A numeric claim matching EITHER the raw open count OR the distinct-file
 *      count passes (both are honest readings of the ledger). Anything the
 *      engine cannot parse confidently it says NOTHING about: a checker that
 *      fires on legitimate prose gets disabled by its users and is worse than
 *      none (acceptance/test-verify-report-headline.mjs VH4 holds this).
 *
 * Exit 0 + a one-line confirmation when the report agrees. Exit 2, loudly, on
 * a missing verbatim block or a demonstrable contradiction — audit-codebase
 * Step 7 treats any non-zero exit as a HARD STOP, not a warning. An unreadable
 * ledger or report is also exit 2: a gate that cannot verify fails closed,
 * never open.
 *
 * PURE core + thin CLI. Read-only on everything. No LLM, no network, no deps.
 *
 * USAGE: node verify-report-headline.mjs --target <repo> --report <path>
 */
import { readFileSync, existsSync, realpathSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderClusterHeadline, clusterOrNullFromFindings } from './finding-clusters.mjs'

/**
 * Pure: (report text, ledger findings) → { ok, failures, expected, counts }.
 * `failures` is a list of { code, message }; empty ⇔ ok. `expected` is the
 * verbatim headline block the report must contain; `counts` the ledger-derived
 * raw + file-level critical/high numbers every message cites.
 */
export function verifyReportHeadline(reportText, findings) {
  const failures = []
  const cluster = clusterOrNullFromFindings(findings)
  if (!cluster) {
    return {
      ok: false,
      failures: [{
        code: 'ledger-unreadable',
        message:
          'ledger `findings` is not an array (corrupted or hand-edited) — cannot verify the report ' +
          'against it; failing closed',
      }],
      expected: null,
      counts: null,
    }
  }
  const report = String(reportText ?? '').replace(/\r\n/g, '\n')
  const expected = renderClusterHeadline(cluster)
  const bs = cluster.by_severity && typeof cluster.by_severity === 'object' ? cluster.by_severity : {}
  const counts = {
    critical: Number.isFinite(bs.critical) ? bs.critical : 0,
    high: Number.isFinite(bs.high) ? bs.high : 0,
    fileCritical: Number.isFinite(cluster.distinct_critical_files) ? cluster.distinct_critical_files : 0,
    fileHigh: Number.isFinite(cluster.distinct_high_files) ? cluster.distinct_high_files : 0,
  }

  // 1) the verbatim block, recomputed from the CURRENT ledger. A block pasted
  // BEFORE dispositions carries stale numbers and equally fails this check —
  // the report must agree with the ledger as it stands now.
  const blockAt = report.indexOf(expected)
  if (blockAt < 0) {
    failures.push({
      code: 'missing-verbatim-block',
      message:
        'the report does not contain the verbatim cluster headline block recomputed from the current ' +
        'ledger — paste the stdout of `node harness/finding-clusters.mjs --target <target> --headline` ' +
        'into the executive summary unchanged (never hand-rebuilt, reordered, or re-worded)',
    })
  }

  const total = counts.critical + counts.high
  const fileTotal = counts.fileCritical + counts.fileHigh

  // 2a) the labelled blocking-items claim — anywhere in the report. Parsed only
  // when the value starts with `none` or a number; anything else is skipped.
  for (const m of report.matchAll(/Blocking items \(critical\/high\)\s*:\s*([^\n]*)/gi)) {
    const value = m[1].replace(/^[\s*_`]+/, '')
    if (/^none\b/i.test(value)) {
      if (total > 0) {
        failures.push({
          code: 'blocking-items-contradiction',
          message:
            `the report claims "Blocking items (critical/high): none" but the ledger holds ` +
            `${counts.critical} open critical + ${counts.high} open high`,
        })
      }
      continue
    }
    const num = value.match(/^(\d+)\b/)
    if (num) {
      const n = parseInt(num[1], 10)
      if (n !== total && n !== fileTotal) {
        failures.push({
          code: 'blocking-items-contradiction',
          message:
            `the report claims "Blocking items (critical/high): ${n}" but the ledger holds ` +
            `${total} raw open critical/high (${fileTotal} at file level)`,
        })
      }
    }
    // neither `none` nor a number → not confidently parseable → say nothing.
  }

  // 2b) bare `N critical` / `N high` claims — HEADLINE REGION ONLY, and only
  // when the verbatim block anchors the region (no anchor → no confident
  // region → say nothing; the missing-block failure already fired above).
  // The region is the executive-summary text before the block plus the text
  // after it up to the next heading; the block's own (correct) bytes are
  // excised, and the two segments are scanned SEPARATELY so no cross-boundary
  // phantom match can form. Same-line only (`[^\S\n]`), and `critical`/`high`
  // must not continue into a longer word ("3 high-priority" never matches).
  if (blockAt >= 0) {
    const afterBlock = blockAt + expected.length
    const nextHeading = report.slice(afterBlock).search(/^#{1,6} /m)
    const regionEnd = nextHeading >= 0 ? afterBlock + nextHeading : report.length
    const segments = [report.slice(0, blockAt), report.slice(afterBlock, regionEnd)]
    for (const [sev, raw, file] of [
      ['critical', counts.critical, counts.fileCritical],
      ['high', counts.high, counts.fileHigh],
    ]) {
      const re = new RegExp(`\\b(\\d+)[^\\S\\n]+${sev}(?![-\\w])`, 'gi')
      for (const segment of segments) {
        for (const m of segment.matchAll(re)) {
          const n = parseInt(m[1], 10)
          if (n !== raw && n !== file) {
            failures.push({
              code: `${sev}-count-contradiction`,
              message:
                `the executive summary states "${m[0]}" but the ledger holds ${raw} open ${sev} ` +
                `(${file} at file level)`,
            })
          }
        }
      }
    }
  }

  return { ok: failures.length === 0, failures, expected, counts }
}

function main() {
  const arg = (flag, def) => {
    const i = process.argv.indexOf(flag)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
  }
  const TARGET = arg('--target', process.cwd())
  const REPORT = arg('--report', null)
  if (!REPORT) {
    console.error('verify-report-headline: --report <path> is required')
    process.exit(2)
  }
  const reportPath = isAbsolute(REPORT) || existsSync(REPORT) ? REPORT : join(TARGET, REPORT)

  let report
  try {
    report = readFileSync(reportPath, 'utf8')
  } catch {
    console.error(
      `verify-report-headline: cannot read the report at ${reportPath} — a gate that cannot verify ` +
        'fails closed, never open'
    )
    process.exit(2)
  }
  let ledger
  try {
    ledger = JSON.parse(readFileSync(join(TARGET, '.security-review', 'audit-ledger.json'), 'utf8'))
  } catch {
    ledger = null
  }
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) {
    console.error(
      `verify-report-headline: cannot read the audit ledger under ${TARGET} — a gate that cannot ` +
        'verify fails closed, never open'
    )
    process.exit(2)
  }

  const r = verifyReportHeadline(report, ledger.findings)
  if (!r.ok) {
    console.error('verify-report-headline: FAIL — the report omits or contradicts the ledger-derived headline:')
    for (const f of r.failures) console.error(`  ✗ [${f.code}] ${f.message}`)
    console.error(
      '  The ledger is the source of truth. Fix the report (re-paste the verbatim block / correct the ' +
        'stated counts) and re-run this check — audit-codebase Step 7 treats this as a HARD STOP.'
    )
    process.exit(2)
  }
  console.log(
    `verify-report-headline: PASS — verbatim cluster block present; stated critical/high claims agree ` +
      `with the ledger (critical ${r.counts.critical} · high ${r.counts.high}).`
  )
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

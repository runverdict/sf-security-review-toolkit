#!/usr/bin/env node
/*
 * rerender-runlog.mjs — re-derive the durable run-log's open-confirmed line
 * AFTER dispositions.
 *
 * WHY THIS EXISTS. `merge-ledger.mjs` (audit-codebase Step 6) appends the pass
 * entry to `.security-review/run-log.md` — including
 * `- Open confirmed (all passes): …` — BEFORE `reconcile-provenance.mjs`
 * (Step 6a) and `apply-dispositions.mjs` (Step 6b) run. Step 7 re-renders the
 * transient stdout recap, but nothing rewrote the DURABLE run-log: a real cold
 * run committed a run-log claiming 441 open confirmed / 273 high while the
 * ledger it was generated from held 86 / 25 after dispositions — two
 * partner-visible surfaces disagreeing by an order of magnitude. This engine
 * closes that: it recomputes the line from the CURRENT ledger and rewrites ONLY
 * that one line, ONLY inside the final `## Pass N` block. Earlier pass blocks
 * are historical record and stay byte-identical. `merge-ledger.mjs` itself
 * stays byte-frozen — a separate re-render helper is the narrower fix.
 *
 * COUNT + FORMAT PARITY. The count is merge-ledger's exact filter
 * (`status === 'confirmed'`) and the severity breakdown reproduces
 * merge-ledger.mjs:268-272 exactly — same severity ordering, same
 * `${n} ${sev}` join, same `|| '(none above info)'` fallback — so only the
 * numbers move, never the line's shape. acceptance/test-rerender-runlog.mjs
 * RL5 locks the parity with a live run of merge-ledger itself.
 *
 * HONEST + IDEMPOTENT. A missing run-log, a missing/unreadable ledger, a
 * non-array ledger `findings` (corrupted or hand-edited), or a run-log with no
 * `## Pass` block → exit 2 with the reason and the file untouched — never a
 * partial write, never an invented count. A second run is a byte no-op. The
 * correction is printed to stdout (`run-log: open confirmed 441 → 86 (…)`) so
 * it is visible, never silent.
 *
 * PURE core + thin CLI (mirrors render-recap.mjs). No LLM, no network, no deps.
 *
 * USAGE: node rerender-runlog.mjs --target <repo>
 */
import { readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// merge-ledger.mjs:270 severity print order — reproduced, never re-derived elsewhere.
const SEV_ORDER = ['critical', 'high', 'medium', 'low', 'info']

/**
 * Pure: the ledger's findings → the exact run-log line merge-ledger.mjs:278 writes,
 * recomputed over the CURRENT (post-disposition) state. Same filter
 * (`status === 'confirmed'`), same ordering, same formatting, same
 * `|| '(none above info)'` fallback — only the numbers differ.
 */
export function renderOpenConfirmedLine(findings) {
  const arr = Array.isArray(findings) ? findings : []
  const confirmed = arr.filter((f) => f.status === 'confirmed')
  const sevCount = {}
  for (const f of confirmed) sevCount[f.adjusted_severity] = (sevCount[f.adjusted_severity] || 0) + 1
  const sevStr = SEV_ORDER.filter((s) => sevCount[s]).map((s) => `${sevCount[s]} ${s}`).join(', ')
  return `- Open confirmed (all passes): ${confirmed.length} — ${sevStr || '(none above info)'}`
}

/**
 * Pure: (run-log text, ledger findings) → the corrected run-log text.
 * Rewrites ONLY the `- Open confirmed (all passes): …` line, ONLY inside the
 * FINAL `## Pass N` block. Returns:
 *   { ok:true, changed, text, before, after }  — `changed:false` when the line
 *     already agrees (idempotent: a second run is a byte no-op), or
 *   { ok:false, error }                        — nothing derivable; never a
 *     partial rewrite, never an invented count.
 */
export function rerenderRunlog(runlogText, findings) {
  if (findings != null && !Array.isArray(findings)) {
    return {
      ok: false,
      error:
        'ledger `findings` is not an array (corrupted or hand-edited — the toolkit never writes this shape); ' +
        'refusing to derive a count from an unreadable ledger',
    }
  }
  const text = String(runlogText ?? '')
  const headings = [...text.matchAll(/^## Pass\b.*$/gm)]
  if (!headings.length) {
    return { ok: false, error: 'run-log has no `## Pass` block — nothing to re-derive' }
  }
  const last = headings[headings.length - 1]
  const tail = text.slice(last.index)
  const m = tail.match(/^- Open confirmed \(all passes\): .*$/m)
  if (!m) {
    return {
      ok: false,
      error: `the final \`${last[0].trim()}\` block has no \`- Open confirmed (all passes):\` line — refusing to guess where the count lives`,
    }
  }
  const before = m[0]
  const after = renderOpenConfirmedLine(findings)
  if (before === after) return { ok: true, changed: false, text, before, after }
  const at = last.index + m.index
  return { ok: true, changed: true, text: text.slice(0, at) + after + text.slice(at + before.length), before, after }
}

/** Pure: the old/new lines → the visible one-line correction for stdout. */
export function describeChange(before, after) {
  const parse = (line) => {
    const p = String(line).match(/^- Open confirmed \(all passes\): (\d+) — (.*)$/)
    return p ? { n: p[1], sev: p[2] } : { n: '?', sev: String(line) }
  }
  const b = parse(before)
  const a = parse(after)
  return `run-log: open confirmed ${b.n} → ${a.n} (${b.sev} → ${a.sev})`
}

function main() {
  const arg = (flag, def) => {
    const i = process.argv.indexOf(flag)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
  }
  const TARGET = arg('--target', process.cwd())
  const RUNLOG_PATH = join(TARGET, '.security-review', 'run-log.md')
  const LEDGER_PATH = join(TARGET, '.security-review', 'audit-ledger.json')

  let runlog
  try {
    runlog = readFileSync(RUNLOG_PATH, 'utf8')
  } catch {
    console.error(`rerender-runlog: no run-log at ${RUNLOG_PATH} — nothing to re-derive`)
    process.exit(2)
  }
  let ledger
  try {
    ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'))
  } catch {
    ledger = null
  }
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) {
    console.error(
      `rerender-runlog: cannot read the ledger at ${LEDGER_PATH} (missing, non-JSON, or not an object) — ` +
        'a count re-derived from nothing would be an invented count; run-log left untouched'
    )
    process.exit(2)
  }

  const r = rerenderRunlog(runlog, ledger.findings)
  if (!r.ok) {
    console.error(`rerender-runlog: ${r.error}; run-log left untouched`)
    process.exit(2)
  }
  if (!r.changed) {
    console.log('run-log: open-confirmed line already agrees with the ledger — no change')
    return
  }
  writeFileSync(RUNLOG_PATH, r.text)
  console.log(describeChange(r.before, r.after))
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

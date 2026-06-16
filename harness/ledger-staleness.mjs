#!/usr/bin/env node
/**
 * ledger-staleness.mjs — resumption fingerprint check (C1).
 *
 * WHY THIS EXISTS. State lives in .security-review/ and the orchestrator resumes
 * from the ledger. The journey's drift check spot-checks the scope MANIFEST
 * (new routes, tool count) — but nothing checked whether the code behind a
 * confirmed/refuted/fixed FINDING changed since it was audited. So a resumed run
 * could present a clean (or stale) verdict against code that has since regressed:
 * a `fixed` whose fix was reverted, a `refuted` whose non-exploitability argument
 * no longer holds, a `confirmed` already remediated. This compares the repo HEAD
 * against the `audited_commit` fingerprint recorded on the latest pass and flags
 * every finding whose file changed since — flags, never auto-flips (auto-trusting
 * either way would be the dishonesty; the honest move is "re-audit this before
 * relying on its verdict").
 *
 * PURE core (`staleFindings`); the CLI runs `git diff` in the target repo.
 * No LLM, no deps, no network.
 *
 * USAGE: node ledger-staleness.mjs --target <repo> [--json]
 */
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

// Canonicalize a path to git's emitted form so the ledger's free-form finding
// `file` actually matches `git diff --name-only` output. `git diff --name-only`
// emits repo-relative, forward-slash paths with no leading "./"; LLM finders
// write `path:line` free-form. Without this both sides can differ and a
// genuinely-changed file's finding is silently reported "current" (a
// false-negative — the worst direction for a staleness check).
const normPath = (p) =>
  String(p || '')
    .trim()
    .replace(/\\/g, '/') // Windows separators → posix
    .replace(/^\.\//, '') // drop a leading ./
const normFile = (f) => normPath(String(f || '').replace(/:[0-9]+(?:[:-][0-9]+)?\s*$/, '')) // strip :line, then canonicalize

/** Pure: findings whose normalized file is in the changed-file set. */
export function staleFindings(findings, changedFiles) {
  const changed = new Set((changedFiles || []).map((f) => normPath(f)).filter(Boolean))
  if (!changed.size) return []
  return (Array.isArray(findings) ? findings : [])
    .filter((f) => f.file && changed.has(normFile(f.file)))
    .map((f) => ({ id: f.id, file: normFile(f.file), dimension: f.dimension, status: f.status }))
}

// The fingerprint is the NEWEST pass's audited_commit — keyed off the highest
// pass id, NOT the newest pass that happens to carry one. If the latest pass
// lacks the fingerprint, return null (→ no-fingerprint, the safe "cannot verify"
// default) rather than silently diffing against an OLDER pass's commit, which
// would check staleness against a stale audit.
export function latestAuditedCommit(passes) {
  const arr = Array.isArray(passes) ? passes.filter(Boolean) : []
  if (!arr.length) return null
  const newest = arr.reduce((a, b) => ((b.id || 0) >= (a.id || 0) ? b : a))
  return newest.audited_commit || null
}

function main() {
  const arg = (flag, def) => {
    const i = process.argv.indexOf(flag)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
  }
  const TARGET = arg('--target', process.cwd())
  const AS_JSON = process.argv.includes('--json')
  let ledger = { findings: [], passes: [] }
  try { ledger = JSON.parse(readFileSync(join(TARGET, '.security-review', 'audit-ledger.json'), 'utf8')) } catch {}

  const commit = latestAuditedCommit(ledger.passes)
  const git = (...a) => execFileSync('git', ['-C', TARGET, ...a], { encoding: 'utf8' }).trim()

  let result
  if (!commit) {
    result = { status: 'no-fingerprint', stale_findings: [], verdict: 'The ledger has no audited_commit fingerprint (it predates this field). Resume cannot verify finding staleness — re-audit to establish one before trusting the verdict against current code.' }
  } else {
    let head = null, changed = []
    try {
      head = git('rev-parse', 'HEAD')
      changed = git('diff', '--name-only', commit, 'HEAD').split('\n').map((s) => s.trim()).filter(Boolean)
    } catch (e) {
      result = { status: 'git-unavailable', audited_commit: commit, stale_findings: [], verdict: `Could not diff ${commit}..HEAD (${String(e.message).split('\n')[0]}). Verify the audited commit still exists; re-audit if the history was rewritten.` }
    }
    if (!result) {
      const stale = staleFindings(ledger.findings, changed)
      result = {
        status: head === commit ? 'current' : (stale.length ? 'stale' : 'changed-but-unaffected'),
        audited_commit: commit,
        head,
        changed_files: changed.length,
        stale_findings: stale,
        verdict:
          head === commit
            ? `Repo is at the audited commit (${commit}). Ledger findings are current.`
            : stale.length
              ? `${stale.length} finding(s) sit in files changed since the audit (audited at ${commit}). They are POTENTIALLY STALE — re-audit those dimensions before the readiness verdict relies on them; do not auto-trust the recorded verdict.`
              : `Code changed since ${commit}, but no changed file backs a ledger finding. Findings are current; consider a fresh pass if scope changed.`,
      }
    }
  }
  if (AS_JSON) process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  else process.stdout.write(`[${result.status}] ${result.verdict}\n`)
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

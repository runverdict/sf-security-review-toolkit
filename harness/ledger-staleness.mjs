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
// false-negative — the worst direction for a staleness check). The hardening
// below was driven by an adversarial skeptic panel over the real Lumina ledger;
// the standing proof is acceptance/test-ledger-staleness-adversary.mjs.
const clean = (p) =>
  String(p || '')
    .trim()
    .replace(/\\/g, '/') // Windows separators → posix
    .replace(/\/{2,}/g, '/') // collapse doubled slashes
    .replace(/\/\.\//g, '/') // collapse embedded /./
    .replace(/^\.\//, '') // drop a leading ./

// Trailing source-location suffix on a SINGLE token. Covers ":13", ":5-19",
// ":5:13" (line:col), a trailing ":5," fragment left by a comma split, the
// GitHub "#L7" / ":L5" L-prefixed forms, and the space/paren forms " (line 5)"
// and " line 5". Anchored at the end and REQUIRES a digit, so a real filename
// ending in letters (".cls") or a Windows drive ("C:/…") is never stripped.
const LOC_SUFFIX = /[\s:#(]+(?:lines?|ln|l)?[\s.:]*\d[\d\s.,:;\-)]*$/i

// A token is path-like if it has a separator OR ends in a LETTER-led extension.
// Letter-led (`.cls`, `.js`) — not `.0` — so version strings like "v2.0" and
// bare prose words are dropped rather than mistaken for files (a false-positive
// class the adversarial panel found).
const looksLikePath = (t) => t.includes('/') || /\.[A-Za-z][A-Za-z0-9]{0,9}$/.test(t)

// Split a free-form finding.file into the file references it cites. Separators:
// "," ";" "&"/"&amp;", and " and "/" AND " — but the word "and" splits ONLY when
// it sits between two real file cites (the char before it is a line spec or a
// dotted extension). So a directory named "Command and Control", a path like
// "docs/sales and marketing/playbook.md", or prose "the loader and cache.py" is
// NOT fragmented — that unconditional split was the dominant false-positive
// class. (V8 supports the variable-length lookbehind used here.)
const SEP = /&amp;|(?<=[:#]\d[\d:,\-]*|\.[A-Za-z][A-Za-z0-9]{0,9})\s+and\s+|\s*[,;&]\s*/i

// Return the repo-relative, git-canonical candidate paths a finding cites, so it
// is flagged stale when ANY file it names changed (matching only the first token
// would miss a regression in the second). `repoRoot` (the git top-level) lets an
// absolute token be relativized to match git's repo-relative diff output.
export function fileTokens(rawFile, repoRoot) {
  const root = clean(repoRoot || '').replace(/\/+$/, '')
  return String(rawFile || '')
    .split(SEP)
    .map((chunk) => {
      let t = String(chunk || '')
        .trim()
        .replace(/^[[\]"'`]+/, '') // strip wrapping brackets/quotes (array-stringified file lists)
        .replace(/[[\]"'`]+$/, '')
        .replace(LOC_SUFFIX, '') // strip a trailing line/col reference
      t = clean(t)
      if (root && (t === root || t.startsWith(root + '/'))) t = t.slice(root.length + 1) // relativize an absolute token under the repo
      return t
    })
    .filter((t) => t && looksLikePath(t)) // drop prose fragments / version strings
}

// A token whose origin is absolute (no repoRoot, or a foreign root, so it stayed
// absolute) matches a changed file when the absolute path ENDS WITH the repo-
// relative changed path on a segment boundary. Restricting the suffix match to
// absolute tokens keeps it from over-firing on relative ones (where "main/x.cls"
// would wrongly match "force-app/main/x.cls").
const isAbs = (t) => t.startsWith('/') || /^[A-Za-z]:\//.test(t)

/**
 * Pure: findings citing a file in the changed-file set. Returns one entry per
 * stale finding, `file` set to the changed path that actually matched (not the
 * first cited path — for a multi-file cite that would misattribute which file
 * went stale). `repoRoot` (git top-level) is optional; when provided, absolute
 * file tokens are relativized to git's repo-relative `--name-only` output.
 */
export function staleFindings(findings, changedFiles, repoRoot) {
  const changedArr = (changedFiles || []).map((f) => clean(f)).filter(Boolean)
  const changedSet = new Set(changedArr)
  if (!changedArr.length) return []
  const out = []
  for (const f of Array.isArray(findings) ? findings : []) {
    let matched = null
    for (const t of fileTokens(f.file, repoRoot)) {
      if (changedSet.has(t)) { matched = t; break }
      if (isAbs(t)) {
        const hit = changedArr.find((c) => t === c || t.endsWith('/' + c))
        if (hit) { matched = hit; break }
      }
    }
    if (matched) out.push({ id: f.id, file: matched, dimension: f.dimension, status: f.status })
  }
  return out
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
    let head = null, changed = [], repoRoot = TARGET
    try {
      head = git('rev-parse', 'HEAD')
      changed = git('diff', '--name-only', commit, 'HEAD').split('\n').map((s) => s.trim()).filter(Boolean)
      try { repoRoot = git('rev-parse', '--show-toplevel') } catch {} // relativize absolute finding tokens; fall back to TARGET
    } catch (e) {
      result = { status: 'git-unavailable', audited_commit: commit, stale_findings: [], verdict: `Could not diff ${commit}..HEAD (${String(e.message).split('\n')[0]}). Verify the audited commit still exists; re-audit if the history was rewritten.` }
    }
    if (!result) {
      const stale = staleFindings(ledger.findings, changed, repoRoot)
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

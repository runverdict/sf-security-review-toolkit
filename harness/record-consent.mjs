#!/usr/bin/env node
/*
 * record-consent.mjs — durable consent COUPLING (the interactive ask and the
 * downstream action must not be decoupled).
 *
 * WHY THIS EXISTS. A full-auto cold run inferred "silence-is-yes" past its scope
 * and skipped THREE mandatory stops — the journey consent gate, audit-codebase
 * Step 3 (show the target map), and Step 2 (declare the tier + get a go-ahead) —
 * and fanned out agents with no ask. Root cause: the interactive ASK and the
 * downstream ACTION were decoupled, and silence-is-yes had no hard scope boundary.
 * This is the coupling: an action that needs a gate first verifyConsent()s the
 * RECORDED affirmative answer; a gate with no recorded affirmative verifies FALSE,
 * so a skipped ask physically cannot proceed (the launch path fails closed on it).
 *
 * It records an affirmative answer for a named gate to
 *   <target>/.security-review/consent/<gate>.json   { gate, seq, question, answer, affirmative }
 * Exports recordConsent(gate, answer, {target, question, decision}), verifyConsent(gate, {target})
 * → boolean, and isAffirmative(answer). PURE: no network, no deps. The `seq` is a
 * CLOCK-FREE monotonic ordinal (max(existing seq)+1) — Date.now() is unavailable in
 * the Workflow runtime and would break determinism, so consent is ordered, not timed.
 *
 * USAGE
 *   record:  node record-consent.mjs --gate <id> --answer "<text>" [--decision affirm|deny] [--question "<q>"] [--target <repo>]
 *            (exit 0 when affirmative is recorded; exit 3 when not; exit 2 on a bad --decision)
 *            --decision is the CONTROLLED token from the operator's SELECTED AskUserQuestion
 *            option — when given it DECIDES affirmative (affirm→yes, deny→no) and the free-text
 *            answer is recorded for the trail but NOT regex-scanned; without it, the answer is scanned.
 *   verify:  node record-consent.mjs --verify --gate <id> [--target <repo>]
 *            (exit 0 when an affirmative answer is recorded; exit 3 otherwise)
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Gate ids: lowercase kebab only (no path traversal, no surprises in a filename).
const GATE_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

// A clear YES vs a clear NO, with DENY PRECEDENCE — a decline must NEVER record as a
// "yes". ANY deny token fails closed regardless of any affirm word in the same answer.
// DENY catches GENERAL negation, which natural declines use: bare `not` ("not ok",
// "we should not proceed", "I would not approve this") and the n't contractions
// ("won't"/"can't"/"wouldn't"/"shouldn't"/"isn't"/…).
//
// The contraction rule REQUIRES the apostrophe (`\b\w+n['’]t\b`) — deliberately, NOT
// the optional-apostrophe form. A bare `\w+nt` would false-NEGATIVE real affirmatives
// that merely END in "nt": `grant`/`granted` and `consent`/`consented` are AFFIRM
// tokens, so "I consent" / "I grant approval" must stay TRUE. A negation contraction
// in practice always carries the apostrophe; the apostrophe-less forms ("do not",
// "dont") are caught explicitly below. (No AFFIRM token contains bare "not" or an
// apostrophe, so this cannot false-negative a real yes.) Empty/ambiguous → FALSE too.
//
// DURABLE DIRECTION (SHIPPED in WI-B — see recordConsent's `opts.decision`): the truly
// robust fix is to record the operator's SELECTED AskUserQuestion option as a controlled
// token (affirm|deny) rather than scanning free text — then no regex can mis-read intent
// at all. The free-text AFFIRM/DENY scan below remains the fallback when no decision is given.
const AFFIRM = /\b(yes|y|yeah|yep|ok|okay|approve|approved|grant|granted|consent|consented|go|proceed|confirm|confirmed|allow|allowed|agree|agreed|do it|sounds good)\b/i
const DENY = /\b(?:no|n|nope|not|deny|denied|decline|declined|skip|cancel|stop|abort|never|refuse|refused|dont|do not)\b|\b\w+n['’]t\b/i

export function isAffirmative(answer) {
  const s = String(answer == null ? '' : answer).trim()
  if (!s) return false
  if (DENY.test(s)) return false // deny precedence: any negation token → fail closed
  return AFFIRM.test(s)
}

function consentDir(target) {
  return join(target || process.cwd(), '.security-review', 'consent')
}

/** Record an answer for a gate. The file's `affirmative` flag is what verify reads. */
export function recordConsent(gate, answer, opts = {}) {
  const g = String(gate || '')
  if (!GATE_RE.test(g)) throw new Error(`record-consent: invalid gate id '${gate}' (lowercase kebab only)`)
  // CONTROLLED DECISION TOKEN (WI-B) — the DURABLE DIRECTION from the header above, now
  // shipped. When the caller passes `opts.decision` derived from the operator's SELECTED
  // AskUserQuestion option, that controlled token is AUTHORITATIVE: `affirmative` is set
  // from it and the free-text `answer` is NOT regex-scanned. This is the whole point — a
  // controlled selection must not be second-guessed by a regex; scanning a human label
  // like "Standard — no deep audit" or "Exhaustive now" would mis-read it (no affirm word,
  // or a stray "no") and re-introduce the exact free-text mis-read this removes (the
  // re-record churn a cold run hit). The `answer` text is still recorded for the trail.
  // DENY PRECEDENCE: a `deny` decision → non-affirmative (a controlled deny ALWAYS wins,
  // even over an affirm-looking answer). With NO decision, fall back to isAffirmative()
  // on the free text, whose own deny-precedence (any deny token beats any affirm) holds.
  const decision = opts.decision == null ? null : String(opts.decision)
  if (decision !== null && decision !== 'affirm' && decision !== 'deny') {
    throw new Error(`record-consent: invalid --decision '${opts.decision}' (must be exactly 'affirm' or 'deny')`)
  }
  const affirmative = decision !== null ? decision === 'affirm' : isAffirmative(answer)
  const dir = consentDir(opts.target || process.cwd())
  mkdirSync(dir, { recursive: true })
  // Clock-free monotonic seq: one past the highest seq recorded for any gate.
  let maxSeq = 0
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      try {
        const j = JSON.parse(readFileSync(join(dir, f), 'utf8'))
        if (Number.isFinite(j.seq) && j.seq > maxSeq) maxSeq = j.seq
      } catch { /* ignore an unreadable sibling */ }
    }
  } catch { /* no dir yet */ }
  const record = {
    gate: g,
    seq: maxSeq + 1,
    question: String(opts.question || ''),
    answer: String(answer == null ? '' : answer),
    ...(decision !== null ? { decision } : {}),
    affirmative,
  }
  writeFileSync(join(dir, `${g}.json`), JSON.stringify(record, null, 2) + '\n')
  return record
}

/** TRUE iff an AFFIRMATIVE answer is recorded for this gate. Missing/negative → FALSE. */
export function verifyConsent(gate, opts = {}) {
  const g = String(gate || '')
  if (!GATE_RE.test(g)) return false
  try {
    const j = JSON.parse(readFileSync(join(consentDir(opts.target || process.cwd()), `${g}.json`), 'utf8'))
    return !!j && j.gate === g && j.affirmative === true
  } catch {
    return false
  }
}

function main() {
  const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d }
  const target = arg('--target', process.cwd())
  const gate = arg('--gate', null)
  if (!gate) { console.error('record-consent: --gate <id> is required'); process.exit(2) }

  if (process.argv.includes('--verify')) {
    const ok = verifyConsent(gate, { target })
    process.stdout.write(`${gate}: ${ok ? 'CONSENTED' : 'NOT CONSENTED'}\n`)
    process.exit(ok ? 0 : 3)
  }

  const answer = arg('--answer', null)
  if (answer == null) { console.error('record-consent: --answer "<text>" is required to record'); process.exit(2) }
  const decision = arg('--decision', null) // optional CONTROLLED token: affirm|deny (WI-B)
  let rec
  try { rec = recordConsent(gate, answer, { target, question: arg('--question', ''), decision }) }
  catch (e) { console.error(`record-consent: ${e.message}`); process.exit(2) }
  process.stdout.write(`recorded gate '${rec.gate}' seq ${rec.seq}${rec.decision ? ` [decision=${rec.decision}]` : ''} → ${rec.affirmative ? 'AFFIRMATIVE' : 'NOT affirmative (verifyConsent stays FALSE)'}\n`)
  process.exit(rec.affirmative ? 0 : 3)
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) }
  catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

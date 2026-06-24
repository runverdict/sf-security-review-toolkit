#!/usr/bin/env node
/*
 * clamp-log.mjs — head+tail truncation for captured failure logs.
 *
 * WHY THIS EXISTS. Scanner/DAST failure logs were truncated TAIL-ONLY
 * (`.slice(-1500)` / `.slice(-2000)`), which discards the ROOT CAUSE — a deep
 * stack trace's first frames and the original error message sit at the TOP. This
 * keeps BOTH ends (head for the root cause, tail for the final failure) with an
 * elision marker in the middle, so a truncated log is still diagnosable.
 *
 * PURE: dependency-free, no Date/random, byte-deterministic. Guarded by
 * acceptance/test-clamp-log.mjs.
 */

/**
 * Clamp a log string to roughly `max` chars of CONTENT, keeping the head and tail.
 *   - length <= max → returned unchanged.
 *   - otherwise → first ceil(max/2) chars + an "[N chars elided]" marker + last
 *     floor(max/2) chars. The marker adds a small fixed overhead beyond `max`.
 */
export function clampLog(s, max) {
  const str = String(s == null ? '' : s)
  const cap = Number.isFinite(max) && max > 0 ? Math.floor(max) : 0
  if (str.length <= cap) return str
  const head = Math.ceil(cap / 2)
  const tail = Math.floor(cap / 2)
  return str.slice(0, head) + `\n…[${str.length - cap} chars elided]…\n` + str.slice(str.length - tail)
}

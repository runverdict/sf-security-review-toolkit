/*
 * sf-env.mjs — one place to make every `sf` invocation JSON-safe.
 *
 * The Salesforce CLI prints an update-availability banner to stdout
 * (`›  Warning: @salesforce/cli update available from X to Y`) whenever a newer
 * release exists. That banner lands ahead of the `--json` payload and breaks a
 * naive `JSON.parse`, which silently corrupts any `sf … --json` read. It once
 * broke a keystone `sf data query --json` mid-run.
 *
 * Two independent guards, both stdlib-only (zero imports so any caller can use
 * this without a dependency):
 *
 *   • `sfEnv()` builds a child-process env with the auto-update disabled, so the
 *     banner never prints in the first place. BOTH flags are set on purpose:
 *     older `sf` reads `SF_AUTOUPDATE_DISABLE`, newer reads
 *     `SF_DISABLE_AUTOUPDATE`. It spreads `...process.env` FIRST so `PATH`
 *     (and everything else the CLI needs — HOME, the sf config dirs) is
 *     preserved: `execFileSync('sf', …)` resolves the binary via `PATH`, and an
 *     env of only the two flags would make `sf` unfindable and break every call.
 *
 *   • `parseSfJson()` is defence in depth: even with the banner suppressed, any
 *     stray leading line (a deprecation notice, a shell rc echo) is tolerated by
 *     slicing from the first `{` or `[` before parsing. Clean JSON is parsed
 *     unchanged.
 */

/** The two auto-update-off flags (older `sf` reads one, newer the other). */
export const SF_AUTOUPDATE_OFF = { SF_AUTOUPDATE_DISABLE: 'true', SF_DISABLE_AUTOUPDATE: 'true' }

/**
 * A child-process env for `sf`: the full parent env (so `PATH` resolves the
 * binary) plus optional `extra`, with the auto-update flags forced ON LAST so a
 * caller can never accidentally clobber them.
 */
export const sfEnv = (extra) => ({ ...process.env, ...extra, ...SF_AUTOUPDATE_OFF })

/**
 * Parse `sf … --json` output tolerant of a leading banner line. Slices from the
 * first `{` or `[` so a stray prefix can't corrupt the parse; clean JSON is
 * parsed unchanged. Throws (like `JSON.parse`) on genuinely non-JSON output.
 */
export function parseSfJson(out) {
  const s = String(out ?? '')
  const i = s.search(/[\{\[]/)
  return JSON.parse(i >= 0 ? s.slice(i) : s)
}

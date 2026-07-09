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
 *   • `sfEnv()` builds a child-process env with the banner suppressed at the
 *     source. ALL THREE flags are set on purpose: `SF_AUTOUPDATE_DISABLE`
 *     (older `sf`) and `SF_DISABLE_AUTOUPDATE` (newer `sf`) turn off the
 *     auto-UPDATE itself, but neither silences the update-availability BANNER —
 *     that is a different oclif control, `SF_SKIP_NEW_VERSION_CHECK` (proven
 *     off disk: with only the two autoupdate flags the banner still prints;
 *     adding the third suppresses it). It spreads `...process.env` FIRST so
 *     `PATH` (and everything else the CLI needs — HOME, the sf config dirs) is
 *     preserved: `execFileSync('sf', …)` resolves the binary via `PATH`, and an
 *     env of only the flags would make `sf` unfindable and break every call.
 *
 *   • `parseSfJson()` is defence in depth: even with the banner suppressed, any
 *     stray leading line (a deprecation notice, a shell rc echo) is tolerated by
 *     slicing from the first `{` or `[` before parsing. Clean JSON is parsed
 *     unchanged.
 */

/**
 * The banner-off flags: the two auto-update-off flags (older `sf` reads one,
 * newer the other) PLUS `SF_SKIP_NEW_VERSION_CHECK`, the oclif control that
 * actually silences the `› Warning: @salesforce/cli update available…` banner
 * (the autoupdate flags alone do NOT — only `parseSfJson`'s banner-tolerance
 * had been saving every `sf --json` call).
 */
export const SF_AUTOUPDATE_OFF = {
  SF_AUTOUPDATE_DISABLE: 'true',
  SF_DISABLE_AUTOUPDATE: 'true',
  SF_SKIP_NEW_VERSION_CHECK: 'true',
}

/**
 * A child-process env for `sf`: the full parent env (so `PATH` resolves the
 * binary) plus optional `extra`, with the banner-off flags forced ON LAST so a
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

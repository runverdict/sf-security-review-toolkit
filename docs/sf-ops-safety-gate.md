# SF-ops safety gate — fail-closed consent for irreversible operations

**Status: SHIPPED on `main` (0.8.11; classifier hardened 0.8.12–0.8.13; first tagged release `v0.9.0`).**

The deployed-package deep audit runs **irreversible** Salesforce / host operations as
prose-only Bash inside skills. A prior full-auto run skipped the consent asks and fanned
out anyway. This gate makes a skipped ask **physically unable** to run the op: the shipped
PreToolUse hook `hooks/sf-ops-gate-hook.mjs` denies a classified op unless an affirmative
consent for its gate is recorded — the same consent-coupling substrate as
`harness/record-consent.mjs` (Phase 1), extended from artifact writes to live sf/host ops.

## The three gates

One consent ask per skill per class (not per op). The gate ids are the recorded-consent
keys under `<target>/.security-review/consent/<gate>.json`.

| Gate | Covers | Why it is gated |
|---|---|---|
| `sf-package-promote` | `sf package version promote` **only** | PERMANENTLY releases a managed 2GP version — it can never be deleted, un-promoted, or hidden. Its own gate, with a distinctly-worded permanence ask. |
| `sf-deep-audit-ops` | `sf package version create`/`delete`, `sf package install`/`uninstall`/`delete`, `sf org create scratch\|sandbox`, `sf org delete`, `sf sandbox create`/`delete`, `sf data delete`, `sf project deploy` (and the sfdx legacy `force:*` equivalents) | Mutates orgs / builds artifacts; reversible only at cost, some not at all. |
| `sf-cli-setup` | `sf org login *` (writes credentials), `npm install -g` / `npm uninstall -g` | Mutates the host / stores secrets. The tmp-scoped `install-scanners.mjs` path is preferred; the global `-g` install is the gated fallback. |

`sf-package-promote` is **separate** from `sf-deep-audit-ops` by design: a recorded
deep-audit consent does **not** authorize a permanent release, and vice-versa. The promote
deny reason spells out the irreversibility.

## The fail-closed model

`hooks/sf-ops-gate-hook.mjs` is a `PreToolUse` hook matching `Bash`. For each command:

1. **Scope.** It walks up from `process.cwd()` for a `.security-review/` directory (an
   active audit). Outside a toolkit-managed repo it **allows** everything — the toolkit
   never interferes with the partner's own unrelated `sf` work. A malformed / absent
   payload, or an unreadable command, also allows (it never blocks arbitrary Bash).
2. **Classify** on the **action verb**, not a substring, so read-only verbs always pass
   (`sf package version list`, `sf org list`, `sf config get`, anything `--help`). The
   normalization (hardened 0.8.12) unwraps a whole `sh -c "…"` / `eval "…"` (and a chained
   `… && bash -c "…"`) and classifies the inner command; splits on shell separators
   (`&&` `||` `|&` `;` `&` `|` newline); strips leading shell grouping (`(sf …)`,
   `{ sf …; }`, `((sf …))`), env-var assignments, and the common command wrappers (`env`,
   `sudo`, `doas`, `npx`, `command`, `exec`, `time`, `timeout`, `nice`, `ionice`, `nohup`,
   `setsid`, `stdbuf`, `xargs`, `watch` — each with their flags, incl. a `-x val`
   value-flag, and `timeout`'s positional duration); basename-matches + unquotes the CLI token
   (`/usr/local/bin/sf`, `./sf`, `"sf"`, `\sf` → `sf`); and SKIPS interspersed flags in
   the verb scan, matching the gated verb as a contiguous run (so a global flag's value,
   or the leading `force` of the sfdx colon form `force:package:version:promote`, doesn't
   defeat it). A chain is gated if **any** segment is irreversible; the highest-severity
   match (promote > deep-audit > cli-setup) names the deny.
3. **Enforce.** For a classified op, `verifyConsent(<gate>, {target: root})`. Recorded
   affirmative → allow. Absent / negative → **deny** (exit 0 + the PreToolUse
   `permissionDecision: "deny"` JSON), with a reason that names the op, the gate, and how
   to consent.

The gated skills couple a mandatory operator `AskUserQuestion` to a `record-consent` call
at the relevant step, so the honest flow records the consent before the op runs. A skipped
ask leaves no consent → the hook denies the op. The op is denied, **not silently run**.

## Honest residual

The classifier catches the documented + normalized forms (CLI paths, quoting, the **common**
process wrappers — `env`, `sudo`, `doas`, `npx`, `command`, `exec`, `time`, `timeout`,
`nice`, `ionice`, `nohup`, `setsid`, `stdbuf`, `xargs`, `watch` — grouping, `sh -c`/`eval`,
interspersed flags, the `force:*` legacy verbs, and the gated-op set below). **Two classes
still evade, and the claim is calibrated to that:**

1. **An uncommon process wrapper** — some unusual scheduler / limiter / runner not in the
   list above (e.g. `chrt`, `firejail`, a custom launcher) that fronts the real command.
   The wrapper list is **best-effort, not a complete shell parser**; the common wrappers an
   honest driver reaches for are covered, but the tail is infinite.
2. **Exotic runtime / shell-eval forms** — command substitution `$(…)` / backticks, variable
   indirection (`$CMD` / `${CMD}`), process-substitution `source <(…)`, and a
   base64-decode-pipe-to-shell one-liner — because resolving them requires actually running
   the shell, which a static classifier cannot.

This is the inherent limit of any such gate, and the same honest residual the Phase-1
consent belt documents. **The claim is "an honest driver running the documented ops is
gated; the wrapper list is best-effort and not a complete shell parser," not "impossible to
bypass."** Defense-in-depth the operator opts into, never structural impossibility — and
Salesforce performs its own review regardless. The standing test
`acceptance/test-sf-ops-gate-hook.mjs` regression-locks the bypass battery (must DENY), the
exotic residual, AND an uncommon-wrapper residual (both stay ALLOW by design).

---

*Hook: `hooks/sf-ops-gate-hook.mjs` (registered as the 2nd `PreToolUse` entry in
`hooks/hooks.json`, matcher `Bash`). Consent substrate: `harness/record-consent.mjs`.
Standing test: `acceptance/test-sf-ops-gate-hook.mjs`. Pure, no deps beyond record-consent.*

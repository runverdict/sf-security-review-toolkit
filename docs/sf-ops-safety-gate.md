# SF-ops safety gate — fail-closed consent for irreversible operations

**Status: SHIPPED on `main` (0.8.11, UNTAGGED).**

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
| `sf-deep-audit-ops` | `sf package version create`, `sf package install`/`uninstall`, `sf org create scratch\|sandbox`, `sf org delete`, `sf data delete`, `sf project deploy` (and the sfdx legacy `force:*` equivalents) | Mutates orgs / builds artifacts; reversible only at cost, some not at all. |
| `sf-cli-setup` | `sf org login *` (writes credentials), `npm install -g` | Mutates the host / stores secrets. The tmp-scoped `install-scanners.mjs` path is preferred; the global `-g` install is the gated fallback. |

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
   command is split on shell separators (`&&` `||` `;` `|` newline) and each segment is
   normalized — leading env-var assignments and `sudo`/`npx` (with flags) stripped,
   whitespace collapsed, both `sf` and `sfdx`, both the space-verb and the colon /
   `force:*` legacy forms accepted. A chain is gated if **any** segment is irreversible;
   the highest-severity match (promote > deep-audit > cli-setup) names the deny.
3. **Enforce.** For a classified op, `verifyConsent(<gate>, {target: root})`. Recorded
   affirmative → allow. Absent / negative → **deny** (exit 0 + the PreToolUse
   `permissionDecision: "deny"` JSON), with a reason that names the op, the gate, and how
   to consent.

The gated skills couple a mandatory operator `AskUserQuestion` to a `record-consent` call
at the relevant step, so the honest flow records the consent before the op runs. A skipped
ask leaves no consent → the hook denies the op. The op is denied, **not silently run**.

## Honest residual

The classifier catches the canonical + normalized command forms. A **deliberately
obfuscated** op — base64-decode-and-eval, variable indirection, command substitution
`$(…)`, writing the command to a file and sourcing it — can still evade a regex over an
LLM-driver's free-form Bash. This is the inherent limit of any such gate, and the same
honest residual the Phase-1 consent belt documents. **The claim is "an honest driver
running the documented ops is gated," not "impossible to bypass."** Defense-in-depth the
operator opts into, never structural impossibility — and Salesforce performs its own
review regardless.

---

*Hook: `hooks/sf-ops-gate-hook.mjs` (registered as the 2nd `PreToolUse` entry in
`hooks/hooks.json`, matcher `Bash`). Consent substrate: `harness/record-consent.mjs`.
Standing test: `acceptance/test-sf-ops-gate-hook.mjs`. Pure, no deps beyond record-consent.*

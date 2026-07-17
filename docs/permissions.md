# Running it hands-off — permissions, consent gates, and the enforcement hooks

How to run the journey uninterrupted without giving it anything destructive, what always
prompts regardless, and the two disclosed `PreToolUse` hooks. Moved verbatim from the README
front page; the allowlist below is machine-checked against the engine's own required set by
`acceptance/test-emit-permission-set.mjs`, so this page and the code cannot drift apart.

The journey is **read-only on your source** — finders and verifiers only read
code; the writes are the toolkit's own state (`.security-review/`), generated
artifacts (`docs/security-review/`), and the consent-gated exceptions disclosed
above. **The easiest path: let the toolkit set it up for you.** On the first run in a repo, the
journey's preflight offers a one-time, owner-authorized gate to write the exact read-only allowlist
it needs into `.claude/settings.local.json` (nothing destructive — installs, org ops, and live
probes still prompt and stay consent-gated); restart once and every later run goes uninterrupted in
default mode, with no auto mode and none of its safety-classifier false positives. It asks exactly
once and never touches any setting but `permissions.allow`. If you'd rather do it by hand, two ways
to cut the per-step permission prompts for an autonomous run:

- **Recommended read-only allowlist.** Drop this into the target repo's
  `.claude/settings.json`. It pre-approves only non-destructive commands —
  nothing that can mutate a Salesforce org or destroy local state (org
  create/delete, deploys, package installs, and logins always prompt). Be
  aware of its edges: the `sf` entries are read-only calls against your org;
  two write locally — `sf project retrieve` writes retrieved metadata into
  the project tree, and `sf code-analyzer run` writes report files; and the
  generic text tools are not write-proof (`sort -o`, `awk`'s file output,
  `find`'s `-exec`/`-delete`, and shell redirection appended to an allowlisted
  command can overwrite or delete local files) — so use it only on a repo you trust the run to write in:

  ```json
  {
    "permissions": {
      "allow": [
        "Bash(git status:*)", "Bash(git log:*)", "Bash(git rev-parse:*)", "Bash(git diff:*)", "Bash(git ls-files:*)",
        "Bash(ls:*)", "Bash(cat:*)", "Bash(grep:*)", "Bash(head:*)", "Bash(tail:*)", "Bash(wc:*)", "Bash(sort:*)", "Bash(awk:*)", "Bash(date:*)", "Bash(find:*)",
        "Bash(sf org list:*)", "Bash(sf org display:*)", "Bash(sf data query:*)", "Bash(sf project retrieve:*)",
        "Bash(sf sobject:*)", "Bash(sf package version list:*)", "Bash(sf package version report:*)", "Bash(sf config get:*)", "Bash(sf code-analyzer run:*)"
      ]
    }
  }
  ```

- **Auto-accept for the multi-agent audit.** The audit fans out many subagents
  whose read commands vary, and some (piped/`xargs` chains, scratch-org steps)
  can't be covered by a prefix allowlist. Workflow runs go smoothest with
  auto-accept **on for the duration of the run** — then turn it back off, and
  don't use it casually on a repo you don't trust.

Either way, everything beyond read-only local work — installing the missing
scanners to a tmp dir (a network fetch), standing up a **throwaway** backend +
active-scanning it, the optional `sf`-CLI deployed-org deep audit, and any
live-endpoint probe — **always requires an explicit yes.** And not as policy
prose: each consent is recorded as durable state, the gate's option set is
engine-frozen with a force-injected decline option the driver cannot drop, and
the live executors verify the recorded token and fail closed without it (the
read-only endpoint probe has no executor engine — the driver checks its
recorded consent before any handshake). No allowlist or auto-accept silences
them; full-auto batches the asks onto one up-front screen, it never skips one.

## Enforcement hooks (disclosed in full)

The plugin ships **two** `PreToolUse` hooks (wired in
[`hooks/hooks.json`](hooks/hooks.json)) that load when the plugin is enabled.
Both are plain, readable source in `hooks/`; both read only the toolkit's own
state; neither modifies your source and neither phones home. Outside a repo
where you've engaged the toolkit, both are no-ops — the artifact gate scopes on
the file being written, the ops gate on the working directory — and both fail
toward *allow* on anything they cannot scope (one deliberate exception: the
*armed* artifact gate fails closed when it cannot verify the ledger).

- **The AuthN/AuthZ artifact gate** (`hooks/authz-gate-hook.mjs`, matcher
  `Edit|Write`) — **opt-in, a no-op by default:** for every `Write`/`Edit` it
  exits immediately unless the file being written is the toolkit's own
  `docs/security-review/authn-authz-flow.md` **and** you have armed it by
  creating `.security-review/hook-armed` in the target repo. Armed, it blocks
  writing that one doc while an open authentication/authorization critical/high
  finding stands (the same withhold the journey already enforces — this is the
  runtime-independent backstop). It reads only the toolkit's own state (the
  findings ledger, plus the triage decision), and once armed it fails closed: a
  missing or malformed ledger denies the write rather than assume the audit is
  clean. **Arm it:** `touch <repo>/.security-review/hook-armed`. **Disarm:**
  delete that file.
- **The irreversible-ops consent gate** (`hooks/sf-ops-gate-hook.mjs`, matcher
  `Bash`) — active only inside a toolkit-managed repo: it acts only when the
  working directory is inside a tree containing `.security-review/` (the marker
  is looked up through parent directories); outside one, every command is
  allowed, so it never interferes with your unrelated `sf` work. Inside one, it
  classifies each command on its action verb (read-only verbs always pass) and
  **denies the enumerated irreversible operations unless an affirmative
  recorded consent for that gate class exists**: the permanent 2GP
  `package version promote` under its own gate; package version create/delete,
  package install/uninstall/delete, scratch- and sandbox-org create/delete, org
  deletes, data deletes, and deploys under the deep-audit gate; and
  credential-writing logins plus global npm installs/uninstalls under the
  CLI-setup gate (the `sfdx` legacy `force:*` forms of all of these included). This is the durable backstop for the deep audit's live operations — a
  gated op cannot run on model goodwill alone. Honest residual: the classifier
  normalizes the common wrapper and chain forms but is not a complete shell
  parser; the claim is *"an honest driver running the documented ops is
  gated,"* not *"impossible to bypass"* (limits documented in the hook's
  header).

Both hooks are defense-in-depth the human opts into — by enabling the plugin,
and for the artifact gate by arming the flag — not a guarantee.


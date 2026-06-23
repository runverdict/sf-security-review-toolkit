# Contributing

Thanks for considering a contribution. This toolkit has a strong, opinionated house style
because its whole value is being **honest, generic, and current** — a contribution that is
correct but breaks one of those properties will be asked to change. The full rules live in
[`CONVENTIONS.md`](CONVENTIONS.md); the essentials are below.

## Prerequisites

- **Node.js 18+** (the engines and standing tests use only Node built-ins — no `npm
  install`, no dependencies, no network).
- Git, and the `gh` CLI if you want to use GitHub's flows.

## The one command that gates everything

Every determinizable property is locked by a dependency-free standing test. Run the whole
suite before you push, and keep it green:

```bash
for t in acceptance/test-*.mjs; do node "$t" || exit 1; done
```

A green suite is the bar for a merge. The check count grows each change — the pass is
**zero failures**, never a fixed number.

## What a good change looks like

- **Encode behavior in a test, not in prose.** If your change makes a determinizable claim
  (a count, an applicability set, a readiness band, a de-dup/normalization rule, a
  fail-closed gate), it belongs in a pure `harness/*.mjs` engine — no LLM, no network, no
  dependencies, byte-identical on re-run — guarded by a self-asserting
  `acceptance/test-*.mjs`. A rule that exists only as skill prose is only as strong as the
  model that remembers to invoke it. (See `CONVENTIONS.md` §7.)
- **Honesty (`CONVENTIONS.md` §2).** Never mark a scan/test/certification complete without
  an evidence file. Distinguish what an agent did from what the human must do. The toolkit
  *prepares* a submission; it never claims to pass one, and every readiness verdict states
  what was **not** verified and that Salesforce pen-tests regardless. No overclaiming.
- **Genericization (`CONVENTIONS.md` §3).** No partner-specific identifiers — no endpoints,
  org IDs, credentials, internal hostnames, real class names, Trialforce template IDs, or
  W-numbers. Field-tested patterns appear **anonymized**. Synthetic fixtures use codenames,
  and secrets are assembled at runtime so the repo stays secret-scan-clean. The
  `test-prose-hygiene` standing test enforces parts of this — do not regress it.
- **Currency (`CONVENTIONS.md` §4).** Requirement facts live in
  `baseline/requirements-baseline.yaml` as data with sources + a `last_verified` date —
  never hard-coded in skill prose. A PR that updates a baseline entry with a **primary-source
  citation** is the single most valuable contribution you can make.
- **Voice (`CONVENTIONS.md` §9).** Dense, specific, failure-encoded. Tables for matrices,
  prose for reasoning. No marketing language, no "simply", no unexplained acronyms on first
  use. American spelling.

## Reporting gaps and bugs

- A **coverage gap** (a finding class the audit should catch but misses) → open an issue
  describing the class; the fix is usually a sharpened dimension file or a new probe, plus a
  `methodology/known-escapes.md` entry — not a one-off session.
- A **vulnerability in the toolkit itself** → follow [`SECURITY.md`](SECURITY.md) (report
  privately, do not open a public issue).

## Pull requests

- Branch off `main`; PRs target `main`.
- **Conventional commits** (`feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:`).
- Keep the changeset complete: a change updates the `CHANGELOG` and any affected docs in the
  **same** PR — docs are part of the change, not a follow-up.
- Describe what you changed and why, and confirm the suite is green.

By contributing you agree your work is licensed under the repository's
[Apache-2.0](LICENSE) license, and you agree to the
[Code of Conduct](CODE_OF_CONDUCT.md).

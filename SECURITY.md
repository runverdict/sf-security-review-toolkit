# Security Policy

## What this project is (and what this policy covers)

This toolkit is a set of Claude Code skills that **prepare** an ISV partner's
AppExchange / AgentExchange security-review submission — it audits the partner's own
code, drafts the submission artifacts, and orchestrates the required scans. It is **not a
hosted service**, it processes no user data on anyone's behalf, and it makes **no security
guarantee about your package**: a clean run here is preparation, not a pass. Salesforce
Product Security runs its own penetration test regardless of anything this toolkit
produces.

This policy is about vulnerabilities **in the toolkit itself** — the engines under
`harness/`, the `hooks/` PreToolUse hooks, the skills, or the templates — for example: an
engine that writes outside the target's `.security-review/` directory, a path-traversal or
command-injection in an engine that shells out, a code path that fails *open* on a security
gate, or a credential/secret that the redaction layer lets through into a state file.

## Reporting a vulnerability

Please report privately — do **not** open a public issue for a security report.

- **Preferred:** GitHub **private vulnerability reporting** — the *Security* tab of
  [`runverdict/sf-security-review-toolkit`](https://github.com/runverdict/sf-security-review-toolkit)
  → *Report a vulnerability*.
- **Email:** `dev@runverdict.com`.

Include the affected file/engine, a minimal reproduction (the engines are pure and
dependency-free, so a short `node harness/<engine>.mjs …` invocation or a failing
`acceptance/test-*.mjs` case is ideal), the impact, and any fix you have in mind.

## What to expect

- **Acknowledgement within 3 business days.**
- An assessment and, for a confirmed issue, a remediation plan within **10 business days**
  — tracked in the open with a `CHANGELOG` entry and, where the property is determinizable,
  a new standing `acceptance/test-*.mjs` that fails the build if the issue ever recurs (the
  same encode-don't-narrate discipline the rest of the toolkit follows).
- Credit in the release notes if you would like it; coordinated disclosure once a fix has
  landed.

This is a community project maintained on a best-effort basis; these are targets, not a
contractual SLA.

## Out of scope

- The **security of your own Salesforce package or web app.** Use the toolkit to find and
  fix those, then let Salesforce's review confirm them — that is what the toolkit is for.
- A finding the toolkit **failed to surface** in a partner's code. That is a coverage gap
  in the audit methodology, not a vulnerability in this software — it belongs in a normal
  issue (and, ideally, a new dimension/probe or `methodology/known-escapes.md` entry), not
  a security report.
- The Salesforce review process or platform itself.

## Supported versions

The toolkit ships from `main`; fixes land there and go out in the next version bump. There
is no back-port of security fixes to older tags — update to the latest `main` / release.

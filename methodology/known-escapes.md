# Known Escapes — what real reviews caught that this toolkit missed

**Status: ZERO real-review outcomes recorded to date.** This log is seeded
empty, and that emptiness is stated honestly on purpose: as of this writing the
toolkit has been validated only against its own fixtures (the Helios / Meridian
acceptance harness) and fresh-context runs on real codebases — **never against
the outcome of an actual Salesforce AppExchange/AgentExchange security review or
its penetration test.** No partner has yet run a toolkit-prepped submission
through Product Security and reported back what the review surfaced that the
audit did not.

That is the one validation the acceptance harness structurally cannot provide.
The acceptance test proves the toolkit catches the failure classes it was taught
about; it cannot prove it catches the classes the maintainer never thought of —
and "the classes the maintainer didn't think of" is exactly the population that
causes first-time review failures. **Recall against known failure classes is
measurable here; recall against unknown ones is not, until a real review fills
this file.** Every readiness claim the toolkit makes is honest about this floor
(the SCI is a completeness index, never a pass prediction; Salesforce pen-tests
regardless). This file is where that floor gets closed, one real outcome at a
time.

## Why this is the highest-signal artifact in the repo

A self-review never finds a known escape — the gate, the dimension, the probe
all read correct on paper. Only a real reviewer reproducing something the static
pass missed exposes a true coverage hole. So each row here is worth more than any
number of green fixtures: it is ground truth about a gap, mapped to the exact
dimension or scan family that *should* have fired, with the change that closes
it. The presence of this log — even empty — is the difference between an honest
prep tool and a tool that merely claims to work.

## How to record an escape (n≥1)

When a real review or its penetration test surfaces a finding the toolkit's audit
did **not** confirm (or never raised), add a row. Anonymize partner identity;
the finding *class* and the *dimension mapping* are what generalize. One row per
escaped finding:

| # | date | review stage | finding class | where the real review caught it | dimension / scan-family that SHOULD have caught it | why it escaped | toolkit change that closes it | re-proven by |
|---|------|--------------|---------------|----------------------------------|----------------------------------------------------|----------------|-------------------------------|--------------|
| _(none yet — zero real-review outcomes recorded)_ | | | | | | | | |

- **review stage** — initial review · annual re-review · Product-Security-initiated · the pen test.
- **dimension / scan-family that should have caught it** — name the existing dimension (`apex-exposed-surface`, `oauth-identity`, …) or scan family. If **no** dimension covers the class, that is a coverage gap, not a missed probe — say so; it becomes a new dimension.
- **why it escaped** — missing probe in an existing dimension · a dimension not selected for that scope · a static-only blind spot (runtime/logic) · a stale baseline fact · genuinely out of the toolkit's mandate.
- **toolkit change that closes it** — the concrete edit (a sharpened finder probe, a new dimension, a scan family, a baseline correction). A blind spot that is *inherently* runtime (no static change would catch it) is recorded as such and is honest residual risk, not a backlog item.

## The loop (the standing rule, applied to recall)

Every escape recorded here MUST become a toolkit change, and that change MUST be
proven by a fresh acceptance run that exercises the new coverage — never left as
a note that a future session must remember. The path is exactly the maintainer
loop the project already runs: **escape → dimension/probe/baseline change →
seed the acceptance fixture with the class → prove the probe fires from a fresh
context → record the re-prove in the last column.** This file is the canonical
input to the next coverage-gap audit; a coverage-gap audit that does not first
read this log is starting blind.

`stay-listed` captures the outcome side: after any review stage concludes, it
records what Product Security found versus what the audit had, and appends any
escape here for the maintainer to close.

---
_Provenance: maintainer-facing recall log for the sf-security-review-toolkit.
Seeded empty and honest; populated only by real review outcomes. It measures the
toolkit's recall against the one corpus the fixtures cannot simulate — the live
review. Apache-2.0; see CONVENTIONS.md §2 (honesty) and the acceptance harness._

---
name: reviewer-simulation
description: Audit the submission AS THE SALESFORCE REVIEWER WILL. Runs the Product-Security challenge checklist (reviewer-challenges.md) against the audit ledger + scan evidence + the scope manifest, and emits a "what the reviewer will see" report — every challenge marked WILL-FIND / ADDRESSED / NOT-STATICALLY-EXAMINED, ranked by the reviewer's own attack priority (public reach → authz → injection → egress → package hygiene → infra), headed by the first things they will hit. Use after audit-codebase + run-scans, before compile-submission; it reframes what the toolkit already found as what the human tester will reproduce.
allowed-tools: Read Grep Glob Write Bash(ls *) Bash(find *) Bash(cat *) Bash(git rev-parse *) Bash(git log *)
---

# Reviewer Simulation

Produce `<target>/docs/security-review/reviewer-simulation.md`: the submission seen
through Salesforce Product Security's eyes. The deepest thing a partner wants is
not "find my bugs" — it is *"tell me what the reviewer is going to see."* This
skill answers that from data the toolkit already produced (the audit ledger, the
scan evidence, the deployed-org audit if it ran), reframed and **ranked by the
reviewer's own order of attack** so the partner fixes the headline first.

It introduces no new findings and no new requirement — it is a synthesis layer.
Its honesty line is load-bearing: this is the toolkit's STATIC analysis framed as
reviewer intent, **not** the reviewer's live penetration test (CONVENTIONS §2).

## When to use

- After `/sf-security-review-toolkit:audit-codebase` and ideally
  `/sf-security-review-toolkit:run-scans` — it reads their ledger + evidence
- Before `/sf-security-review-toolkit:compile-submission` — the reviewer-sim
  report is a package artifact and its open-challenge list seeds the path-to-green
- Re-run after remediation — a challenge flips WILL-FIND → ADDRESSED as the fix
  lands and the ledger entry moves to `fixed`
- NOT a substitute for the audit (it finds nothing new) and NOT the pen test
  (Salesforce reproduces these live regardless)

## Prerequisites

- `<target>/.security-review/scope-manifest.json` — the elements filter the
  checklist (a TLS challenge for a package-only listing is N/A, never reported);
  refuse to run without it
- `<target>/.security-review/audit-ledger.json` — the source of WILL-FIND /
  ADDRESSED verdicts; degrade gracefully if thin, but say plainly the simulation
  is weaker for it
- `${CLAUDE_PLUGIN_ROOT}/methodology/reviewer-challenges.md` — the challenge
  checklist (the data); read it, do not reinvent the tiers
- Optionally the scan evidence under `<target>/.security-review/evidence/` and the
  deployed-org audit report — they answer the scan-family and dynamic challenges

## Steps

1. **Load the manifest and filter the checklist.** Read `reviewer-challenges.md`
   and keep only the challenges whose element is present in the manifest. A
   challenge for an absent element is N/A — drop it silently (it would read as
   false coverage), but record the dropped count in the run log so "0 MCP
   challenges" is visible as a scoping fact, not a gap.

2. **Map each applicable challenge to a verdict from the ledger + evidence.**
   For each challenge, search the audit ledger and scan evidence for a matching
   entry (by the dimension/baseline id the challenge names, and the file/finding):
   - **WILL-FIND** — a `confirmed`/`regressed` ledger entry (or a scan finding)
     matches. This is the headline case: the reviewer WILL reproduce it. Carry
     the finding's `adjusted_severity`, file:line, and one-line description.
   - **ADDRESSED** — a `fixed` entry (verified fix), or a `refuted` entry whose
     verifier reasoning is the non-exploitability argument, or a satisfied control
     with evidence. Carry the evidence pointer — this is a no-surprises disclosure,
     and a refuted entry's reasoning is ready for the FP dossier.
   - **NOT-STATICALLY-EXAMINED** — no ledger/scan signal AND the challenge is
     genuine pen-test territory (runtime CSP, live error hygiene, the Agentforce
     two-account probe, a logic bug reachable only at a specific record/permission/
     utterance combination). Name it explicitly; NEVER mark it ADDRESSED on the
     strength of silence. If the challenge is statically answerable but the
     toolkit simply did not run that dimension/scan, mark it **UNEXAMINED — run
     <dimension/family>** and route back, not ADDRESSED.

   Never invent a verdict. The mapping is mechanical: a challenge is WILL-FIND
   only with a real matching open entry, ADDRESSED only with a real fixed/refuted
   entry or satisfied control + evidence, otherwise it is one of the un-examined
   states. A simulation that reports ADDRESSED without an evidence pointer is the
   exact dishonesty CONVENTIONS §2 forbids.

3. **Rank and write the report.** Order by the reviewer's tiers (Tier 1 public
   reach first). Write `<target>/docs/security-review/reviewer-simulation.md`:
   - **Headline — "The first things the reviewer will hit."** The top 3–5
     WILL-FIND challenges in tier order, each one line: severity · the reviewer's
     action · file:line · the one-line fix. This is what the partner reads first
     and fixes first.
   - **The full challenge table**, tier by tier: challenge · verdict
     (WILL-FIND / ADDRESSED / NOT-STATICALLY-EXAMINED / UNEXAMINED) · evidence or
     finding pointer · the reviewer's probe. N/A challenges are omitted (their
     count is in the run log).
   - **No-surprises disclosures** — the ADDRESSED-via-refuted challenges, each
     with the verifier's non-exploitability reasoning, written for direct reuse in
     the FP dossier (these are what you tell the reviewer you already considered).
   - **What this simulation did NOT examine** — the NOT-STATICALLY-EXAMINED +
     UNEXAMINED challenges, named. This section is mandatory; its absence makes the
     report dishonest by omission. State plainly: Salesforce reproduces every
     challenge live on the installed package + running endpoint with org-specific
     context a static pass cannot enumerate; ADDRESSED means "no open finding
     within the audited dimensions," never "the reviewer finds nothing."
   - The mandatory provenance footer (CONVENTIONS §2): generation date,
     `git rev-parse HEAD`, the ledger pass/tier it synthesized, and that this is
     static synthesis, not a scan or a pen test.

4. **Feed the downstream skills.** The report is a package artifact
   `/sf-security-review-toolkit:compile-submission` includes; its open-challenge
   list (the WILL-FIND + UNEXAMINED rows) seeds the `path-to-green` remediation
   sequence; its ADDRESSED-via-refuted rows seed the FP dossier. Do not register a
   new baseline requirement or SCI gate — the simulation surfaces what the ledger +
   SCI already know, reframed; the SCI's numbers are the authority, this report is
   the narrative.

## Automated vs. manual recap

**Automated:** checklist filtering by manifest elements, the ledger/evidence →
verdict mapping, ranking, report writing, the FP-dossier disclosure extraction.
**Manual:** deciding to fix vs. document each WILL-FIND, and reading the
NOT-STATICALLY-EXAMINED list as the live-test surface to harden before submission.
Nothing here is a scan or a pen test — it is a reframing of static findings as
reviewer intent, and Salesforce runs its own penetration test regardless.

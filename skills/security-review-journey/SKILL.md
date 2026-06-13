---
name: security-review-journey
description: Orchestrator for AppExchange/AgentExchange security review preparation. Detects how far a partner's repo has progressed (scope manifest, audit ledger, artifacts, scan evidence), reports honest readiness, and routes to the next toolkit skill. Use when starting review prep, resuming after a gap, or asking "where are we?"
allowed-tools: Read Bash(ls *) Bash(cat *) Bash(find *) Bash(git log *) Bash(git status *) AskUserQuestion
---

# Security Review Journey

Route a partner through the full review-preparation journey without assuming
anything ran before. This skill never generates artifacts itself — it detects
state, explains what it means, and hands off to the right phase skill.

## When to use

- First contact: "help me get through the AppExchange/AgentExchange security review"
- Resuming after days/weeks away — it rebuilds the picture from repo state
- A progress check before a deadline ("are we ready to submit?")
- NOT for running the audit (`/sf-security-review-toolkit:audit-codebase`) or
  generating a specific artifact (`/sf-security-review-toolkit:generate-artifacts`)
  when you already know that's what you need — invoke those directly.

## Prerequisites

None beyond a local checkout of the partner's repository. This skill is the
entry point — it detects whatever state exists (including none) and routes
accordingly.

## Steps

1. **Check baseline currency first.** Read
   `${CLAUDE_PLUGIN_ROOT}/baseline/requirements-baseline.yaml`. If the newest
   `last_verified` date is more than 90 days old, tell the user before anything
   else: the Salesforce review process has changed three times in eighteen months,
   and stale guidance costs review cycles. Point them at the baseline's SOURCES.md
   for what to re-verify.

2. **Detect state.** In the target repo, look for (in this order):

   | Evidence | Means |
   |---|---|
   | `.security-review/scope-manifest.json` | Phase 0 done — architecture elements + applicable requirements known |
   | `.security-review/audit-ledger.json` | Phase 1 ran — check `confirmed` vs `fixed` counts for open findings |
   | `docs/security-review/*.md` artifacts | Phase 2 partially/fully done — list which of the required artifacts exist |
   | `.security-review/evidence/` (scan reports, TLS (Transport Layer Security) JSON, screenshots) | Phase 3 partially done — match evidence files against the scan requirements in the baseline |
   | `docs/security-review/test-environment.md` | Phase 4 documented |
   | `docs/security-review/submission/` (questionnaire, readiness tracker, readiness verdict) + `docs/security-review/submission-checklist.md` | Phase 5 compiled |

   No state at all → this is a fresh start; route to
   `/sf-security-review-toolkit:scope-submission`.

3. **Read, don't trust, the state.** A scope manifest written six months ago may
   not match the code anymore (new endpoints, new tools, a package that grew
   Apex). Spot-check the manifest's architecture elements against the repo (does
   `sfdx-project.json` still exist? did the MCP tool count change?). If drifted,
   recommend re-running scope-submission before anything downstream — every later
   phase keys off the manifest.

4. **Report readiness honestly.** Produce a short status with three sections:
   - **Have** — artifacts/evidence that exist AND pass their own validity checks
     (an SSL Labs (Qualys SSL/TLS validation service) JSON with grade A is HAVE;
     a DAST (Dynamic Application Security Testing) plan with no report is not).
   - **In progress** — state exists but incomplete (open ledger findings, artifact
     drafts missing human review, scans planned but not run).
   - **Missing** — applicable baseline requirements with no evidence at all.

   Never present a generated draft as a completed artifact, and never present the
   audit as a substitute for the reviewers' own penetration test.

5. **Route.** Recommend exactly one next skill with the reason ("3 high-severity
   ledger findings are open — fix those before generating artifacts, the
   AuthN/AuthZ doc would describe the vulnerable flow"). Sequence when starting
   fresh: scope-submission → audit-codebase → (fix findings) → generate-artifacts
   → run-scans → prepare-test-environment → compile-submission. After approval:
   stay-listed, on a schedule.

## Automated vs. manual recap

Automated: state detection, drift spot-checks, readiness report, routing.
Manual: every decision to submit, every credential, every fee. This skill never
writes files.

## What feeds the next skill

The detected state summary — paste it into the recommended skill's invocation so
it doesn't re-detect from scratch.

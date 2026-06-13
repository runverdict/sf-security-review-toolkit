# Changelog

All notable changes to the sf-security-review-toolkit are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/); versions
follow semantic versioning.

## [0.1.1] — 2026-06-13

First fine-tuning pass driven by a **fresh-context end-to-end validation run**: the
toolkit was executed cold against a real production codebase (a multi-tenant FastAPI +
Postgres row-level-security backend with an OAuth 2.1 authorization server, a partner-
hosted MCP server, and two thin 2GP managed packages — a Canvas-on-ECA embed and an MCP
registration package). The audit engine performed well — from an empty ledger it
re-discovered every known-open finding, refuted 4 of 9 candidate findings against the
source with precise code evidence (zero unverified), did not re-confirm a single
already-fixed item, and surfaced real findings a prior hand-built audit had under-rated;
the generated artifact pack matched a hand-built reference pack on substance and exceeded
it on honest open-gap flagging and tool-count reconciliation. The changes below are the
refinements that validation surfaced.

### Changed
- **scope-submission: the manifest's `package` block is now `packages[]` (an array).**
  An AgentExchange MCP listing commonly ships **two** packages — a thin MCP-registration
  package (ESR + External/Named Credential + permission set) *and* a separate Canvas/UI
  embed package — which the previous single-`package` schema could not represent. The
  step-7 schema example and the surrounding prose now record each detected package as its
  own entry.
- **scope-submission: `canvas` added to the endpoint `role` enum** in the manifest schema
  example (was `mcp | identity | web-app | api`), since Canvas is a first-class scoped
  element with its own audit dimension.
- **secrets-credentials dimension: sharper review-gating guidance on git-history secrets.**
  A committed production secret is always a critical, rotate-now item — but the report must
  distinguish *security* from *review-gating*: a secret in the partner's **private source
  repo history** is a breach item the Salesforce reviewer does **not** scan for (the review
  reads the submitted package, the live endpoints, and the docs — not the partner's repo),
  whereas a secret in the **submitted package** or reviewer-reachable code is also a
  guaranteed flagged finding. Rotate either way; only frame a finding as
  "submission-blocking because the reviewer will catch it" when the secret is in the
  submitted surface. This keeps the report precise without softening the rotation imperative.

### Notes
- No engine, schema-of-findings, or skill-contract changes — re-running the audit against
  the same codebase reproduces the same findings (convergent). These are documentation and
  manifest-shape refinements.

## [0.1.0] — 2026-06-12

Initial release. Eight skills (security-review-journey orchestrator + scope-submission,
audit-codebase, generate-artifacts, run-scans, prepare-test-environment,
compile-submission, stay-listed), 13 audit dimensions, 9 artifact templates, the
multi-agent audit workflow harness + authenticated-DAST (ZAP) plan generator, and the
baseline-as-data requirement map. Apache-2.0.

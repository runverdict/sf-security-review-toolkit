# docs/ index — what each document is, and its lifecycle state

The canonical status-at-a-glance map for everything in `docs/`. **Every file in `docs/` must
have a row here; a doc with no row is the rot signal.** Update this table in the same changeset
that adds or retires a doc. The states are defined in [`CONVENTIONS.md`](../CONVENTIONS.md) §10.

| Document | State | Purpose |
|---|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | `REFERENCE` | Property → enforcing-engine → guarding-test → code-excerpt map; the trust claim, verifiable in five minutes without a clone. |
| [ceiling-test.md](ceiling-test.md) | `HONEST-ARTIFACT` | The published falsification of the toolkit's strongest reliability claim — the reason the release tag is HELD. Preserved verbatim. |
| [recurrence-confidence.md](recurrence-confidence.md) | `REFERENCE` | Spec/contract for the shipped, wired `harness/recurrence-confidence.mjs` engine (run-to-run finding stability). |
| [deterministic-findings-acceptance.md](deterministic-findings-acceptance.md) | `REFERENCE` | The live Level-A/B acceptance runbook for the deterministic-findings engine (the campaign replacement). |
| [sf-ops-safety-gate.md](sf-ops-safety-gate.md) | `REFERENCE` | The shipped fail-closed PreToolUse consent gate for irreversible Salesforce/host ops. |
| [roadmap-deterministic-findings.md](roadmap-deterministic-findings.md) | `ACTIVE` | Provenance-typed findings; Phase 1 done, Phase 2 all 11 ingest adapters shipped + journey-wired (`--all`, 0.8.40); 0.8.41 cold-install milestone — Code Analyzer CRUD/FLS flips owner-gated → consented-deterministic-by-default (§5). |
| [roadmap-presentation-consistency.md](roadmap-presentation-consistency.md) | `ACTIVE` (paused) | Pin every operator-facing surface; WI-00..06 shipped, WI-07..12 backlog. |
| [roadmap-preconditions-guided-remediation.md](roadmap-preconditions-guided-remediation.md) | `DESIGN` (unbuilt) | The "why-blocked, ask-don't-default" precondition contract. The gap it targets is still present in `harness/package-readiness.mjs`. |
| [roadmap-coldrun-hardening.md](roadmap-coldrun-hardening.md) | `ACTIVE` | The post-cold-run hardening backlog (B1 scans-before-fan-out · B2 throwaway-tier engines + container-isolated OpenAPI · B3 deterministic-band verdict-reflection · B4 PENDING labeling · B5 residual-shrinking · B6 prose · B7 gate-consolidation), with the genuinely-owner residual + locked decisions. |
| [roadmap-0.6.0-preflight-autogate.md](roadmap-0.6.0-preflight-autogate.md) | `DELIVERED v0.7.0` | Preflight auto-gate + consented tmp-scoped scanner install. Cited by `harness/{tool-detect,install-scanners,cleanup-scanners}.mjs` headers. |
| [roadmap-0.7.0-throwaway-dast-harness.md](roadmap-0.7.0-throwaway-dast-harness.md) | `DELIVERED v0.7.0` | Throwaway prod-equivalent DAST harness. Cited by 7 `harness/*.mjs` headers. Remnant: slice-5b (authenticated depth). |
| [roadmap-coverage-gap-map.md](roadmap-coverage-gap-map.md) | `DELIVERED v0.7.2` | Dimension-expansion coverage audit (16→19) + the record of which vuln classes are *intentionally* not covered (P3). |
| [roadmap-middle-band-judgment-fixture.md](roadmap-middle-band-judgment-fixture.md) | `DELIVERED` (Phase B deferred) | The Solano middle-band judgment fixture. **Thesis superseded by [ceiling-test.md](ceiling-test.md)** — see the banner in that doc. |

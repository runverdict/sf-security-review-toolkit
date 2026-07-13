# Coverage-gap map — the known-unknowns (dimension-expansion roadmap)

**Status: audited 2026-06-19; P1 + P2 CLOSED 2026-06-20.** A multi-source web research fan-out
(6 agents over OWASP ASVS 5.0 + Top 10, OWASP API Top 10:2023, OWASP LLM Top 10:2025 +
Agentic Top 10:2026 + MCP literature, CWE Top 25:2025, the Salesforce AppExchange review
criteria + PMD AppExchange ruleset, and the partner-hosted-backend surface) **audited our
16 dimensions + 8 scanner families against the external vuln-class universe** — to find the
classes the security literature names that we *don't* cover, before a real review does.

> **CLOSED 2026-06-20 (the untagged post-0.7.2 arc — recorded in the CHANGELOG; all test-backed
> + deterministic, no cold run needed).** All P1 and P2 items below are now encoded. The toolkit went 16 → **19
> dimensions** (the 3 new ones) plus 5 dimension extensions, and the baseline grew by 10
> entries to 165 (the 2 PMD rules `verified_primary` against the official reference; the new
> classes `web_research_unverified`, OWASP/CWE-sourced). Standing tests added:
> `test-baseline-integrity` (per-entry well-formedness) + `test-dimension-extraction` (every
> dimension is engine-extractable). The per-item closure mapping is in **"What shipped"** at
> the bottom. Only the **P3** cluster is intentionally deferred (scanner-owned / low-likelihood
> / out-of-arch).

This addresses the **layer-1 coverage ceiling** (known-unknowns — classes that exist in the
literature we simply haven't encoded). It does NOT touch layer-2 (unknown-unknowns / a
novel class or a half-obscured real-world manifestation) — only a real external review
catches those, which is why `methodology/known-escapes.md` stays seeded-empty.

## Honest coverage assessment (the synthesizer's read, graded)

Our static-SAST / authz / egress coverage is **~85% complete** — the 16 dimensions own the
SF-critical surface well. We are **blind to two families a pen-tester hits at runtime**:
(a) **dynamic-abuse** (resource/cost consumption, anti-automation, flow-volume) and
(b) **parse-into-object** (deserialization, mass assignment, XXE, outbound-callout trust).
The **worst misses are the two default PMD AppExchange rules** — mechanical, SF-confirmed,
and surfaced free by the reviewer's Code Analyzer — because a partner running our toolkit
then the real review gets a Code Analyzer hit we never predicted (the "no-surprises"
failure our Checkmarx-prediction exists to prevent).

## Confirmed NON-gaps (already covered — do NOT re-add)
- **Open redirect** — covered. **File intake / magic-byte / zip-slip** — `data-export`.
- **Over-return / excessive data exposure** — `data-export` + `apex-exposed-surface`.
- **CSRF** — `web-client` + `package-metadata`. **SSRF (MCP), IDOR (cross-org), CRUD/FLS,
  injection, prompt-injection, secrets, dependency-CVE/IaC/TLS** — covered (dims + scanners).

## P1 — close first (real SF-review failure classes we'd miss today)

1. **`FeatureManagement.changeProtection` license-gate tampering** — `extend`.
   A **default Critical PMD AppExchange rule** (`AvoidFeatureManagementChangeProtection`,
   verified live). `admin-surface` names `checkPermission` only. → add a `package-metadata`/
   `admin-surface` probe + a `baseline/` rule entry so it's named + predicted, not just
   scanner-caught. *(highest confidence — mechanical, SF-confirmed.)*
2. **Insecure deserialization of untrusted data** — `new-dimension: untrusted-deserialization`.
   Zero hits across all 16 dims. pickle/yaml, `node-serialize`/proto-pollution, and Apex
   `JSON.deserialize` **without `Security.stripInaccessible`** (SF explicitly gates this;
   priv-esc via tampered `userType`). `injection-xss` is query/template-only. RCE external,
   type-confusion + downstream-DML in Apex. Arch: mcp-server, external-endpoint, managed-pkg.
3. **Error-handling / info-disclosure + fail-open** — `new-dimension: error-handling-disclosure`.
   Two SF Top-20 entries (#13 verbose error pages, #6 sensitive data in `System.debug`) +
   fail-open security logic (a `try/catch` around an authz/HMAC verifier that falls through
   to *allow*). Only slivers today. **We have a live instance:** Atlas leaked `err.stack` on
   a 401. Arch: all code surfaces.
4. **Mass assignment / per-property write-authz (BOPLA)** — `extend: apex-exposed-surface`
   (per-property write allowlist) + `mcp-surface` (permissive tool-param schema field-binding).
   We own `role`/`is_admin` (admin-surface) + tenant-id (tenant-isolation), not the general
   class (auto-binding `org_id`/`owner_user_id`/`status`/`price`). Acute for MCP. (API3:2023)
5. **Resource/cost consumption + anti-automation (denial-of-wallet)** —
   `new-dimension: resource-consumption-abuse`. Rate-limiting is per-surface only
   (send/HITL/identity/export). No owner for general how-much/how-fast, **cost-amplification
   (each Agentforce/MCP inference = a metered *paid* round-trip), unbounded reads, or ReDoS.**
   SF DAST fuzzes at volume — an unmetered endpoint is a standard finding. (API4, LLM10)

## P2 — close next

6. **Outbound-callout trust posture** — `new/extend: outbound-callout-trust`. TLS grading is
   **inbound-only**; nothing audits OUTBOUND callouts validating certs (`verify=False` /
   `rejectUnauthorized:false` / trust-all `TrustManager`) or blindly following redirects that
   re-send payload + bearer token to an attacker host. (CWE-295, API10:2023)
7. **`getInstance(userId/profileId)` with tainted input** — `scanner-rule` + cross-ref
   `apex-exposed-surface`. The **second default PMD AppExchange rule** (`AvoidGetInstanceWithTaint`).
   → verify our Code Analyzer `--rule-selector AppExchange` run surfaces it + cite it.
8. **BOLA within a single tenant (same-org owner-scoped IDOR)** — `extend: tenant-isolation`
   (within-org owner/subtree sub-probe). We own *cross*-org reach; *within*-org owner/subtree
   authz is hand-written app code on every list/detail/tool path (an explicit owner/visible-user/subtree filter).
9. **Business-logic integrity / authorized-flow abuse** — `extend: agentforce-package` +
   `apex-exposed-surface` (sequence note). Out-of-order step bypass + abusive-but-authorized
   volume. *(Lower tractability — business logic is hard for any tool; keep the probe modest.)*
10. **LLM07 system-prompt leakage** — `extend: agentforce-package` (prompt-CONTENT probe) ×
    `secrets-credentials`. We cover prompt-injection hardening + not-logging-prompts, not
    whether the packaged prompt *contains* a hardcoded secret / guardrail / authz decision.

## P3 — defer (low likelihood / out-of-architecture / scanner-owned)
Session-lifecycle post-issuance (offboard-terminate + step-up, ASVS V7.4/7.5); web-cache-
deception (V14.2.5); prod-config hygiene + supply-chain-beyond-CVE (→ Checkov/dep-confusion);
XXE (CWE-611 → Semgrep rule); TOCTOU races (CWE-367/362); the exotic MCP cluster (rug-pull /
shadowing / memory-poisoning / cascading-chains / agent-phishing — OWASP ASI06/08/09).

## What shipped (CLOSED 2026-06-20)

Each P1/P2 item below maps to what now encodes it (the untagged post-0.7.2 arc, recorded in
the CHANGELOG; all deterministic + test-backed; the per-instance fixture validation folds into the **middle-band
judgment fixture**, the natural home for the contestable severity calls these classes introduce).

| # | item | closed by |
|---|---|---|
| P1.1 | `FeatureManagement.changeProtection` (Critical PMD) | baseline `violation-feature-management-change-protection` (verified_primary) + `admin-surface` §1/§3/§4 + `run-scans` Family 1 |
| P1.2 | insecure deserialization | NEW dimension `untrusted-deserialization` + baseline `untrusted-deserialization` |
| P1.3 | error-handling / info-disclosure + fail-open | NEW dimension `error-handling-disclosure` + baseline `error-handling-fail-open` (consolidates `fail-info-disclosure`/`endpoint-error-hygiene-debug-off`/`violation-secret-data-in-debug`) |
| P1.4 | mass assignment / BOPLA | baseline `mass-assignment-bopla` + `apex-exposed-surface` §4 (write-side probe) + `mcp-surface` (tool-param field-binding) |
| P1.5 | resource / cost consumption (denial-of-wallet) | NEW dimension `resource-consumption-abuse` + baseline `resource-consumption-abuse` + `cost-amplification-denial-of-wallet` |
| P2.6 | outbound-callout trust | baseline `outbound-callout-trust` + `crypto-internals` §1/§3/§4 (transport-trust sub-class) |
| P2.7 | `getInstance(userId/profileId)` taint (Moderate PMD) | baseline `violation-getinstance-with-taint` (verified_primary) + `apex-exposed-surface` §3/§4 |
| P2.8 | within-org BOLA | baseline `within-org-bola` + `tenant-isolation` §1/§4 (within-org sub-probe) |
| P2.9 | business-logic / authorized-flow abuse | `agentforce-package` §4 (modest out-of-order/abusive-flow lead — kept modest by design) |
| P2.10 | system-prompt leakage (LLM07) | baseline `agentforce-system-prompt-leakage` + `agentforce-package` §4 (prompt-CONTENT probe) |

**P3 remains intentionally deferred** (scanner-owned / low-likelihood / out-of-architecture) —
see the P3 section above. If a real Salesforce review surfaces one, it accrues to
`methodology/known-escapes.md` (still seeded-empty by design).

**Net:** the toolkit went from a *sourced* ~85% coverage map with 10 ranked holes to **19
dimensions** with all P1+P2 holes encoded — each finding-class now has a named owner, a baseline
entry, and a finder-prompt probe. The honest caveat survives: this closes *layer-1*
(known-unknowns); *layer-2* (a novel class) is only closed by a real external review.

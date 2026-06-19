# Coverage-gap map — the known-unknowns (dimension-expansion roadmap)

**Status: audited 2026-06-19, not yet closed.** A multi-source web research fan-out (6
agents over OWASP ASVS 5.0 + Top 10, OWASP API Top 10:2023, OWASP LLM Top 10:2025 +
Agentic Top 10:2026 + MCP literature, CWE Top 25:2025, the Salesforce AppExchange review
criteria + PMD AppExchange ruleset, and the partner-hosted-backend surface) **audited our
16 dimensions + 8 scanner families against the external vuln-class universe** — to find the
classes the security literature names that we *don't* cover, before a real review does.

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
   authz is hand-written app code on every list/detail/tool path (the `visible_user_ids` pattern).
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

## Build plan (next sessions — each is a normal dimension addition)
- **3 new dimensions:** `untrusted-deserialization`, `error-handling-disclosure`,
  `resource-consumption-abuse` — author per CONVENTIONS §5 (threat concept · what good looks
  like · per-stack detection heuristics), add `baseline/requirements-baseline.yaml` entries,
  re-gate `applies_to`, and (per the §7 discipline) any determinizable claim gets an engine.
- **Extensions:** mass-assignment → `apex-exposed-surface`/`mcp-surface`; within-org BOLA →
  `tenant-isolation`; system-prompt-leakage → `agentforce-package`; outbound-callout-trust →
  new or `crypto-internals`/`oauth-identity`.
- **2 PMD baseline rules:** `AvoidFeatureManagementChangeProtection`,
  `AvoidGetInstanceWithTaint` — confirm the Code Analyzer AppExchange selector surfaces them
  + add baseline entries so they're *predicted* (the Checkmarx-prediction completeness story).
- **Validate** each new/extended dimension on a fixture seeded with one concrete instance
  (the acceptance discipline) — and note: the **middle-band judgment fixture** is the natural
  home for the contestable severity calls these new classes introduce.

**Net:** we went from "we think we cover the SF surface" to a *sourced* coverage map with a
defensible ~85% and a ranked, citation-backed list of the 10 real holes — the honest pre-
`known-escapes.md` position you pushed for.

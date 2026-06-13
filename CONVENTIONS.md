# Authoring Conventions — sf-security-review-toolkit

Binding rules for every file in this repo. They exist so the toolkit stays honest,
generic, and current. Contributions that violate the honesty or genericization
rules get rejected regardless of quality.

## 1. What this toolkit is (and is not)

It **prepares** an ISV partner's AppExchange/AgentExchange security review
submission: it audits the partner's own codebase, generates the required artifacts,
orchestrates the required scans, and walks the human through the steps no tool can
do. It does **not** pass the review, replace the reviewers' own pen test, or
certify anything. Every skill, template, and report must preserve that distinction.

## 2. Honesty guardrails (non-negotiable)

- Never mark a scan, test, or certification complete without an evidence file the
  skill actually verified (report output, SSL Labs JSON, screenshot path).
- Every generated artifact distinguishes **automated** (what an agent did, from
  what inputs) vs **owner-run** (what the human did or must do).
- Every skill run ends with an **"Automated vs. manual recap"** section.
- The readiness verdict must list what was NOT verified, with the explicit caveat
  that Salesforce performs its own penetration testing regardless of submitted
  evidence.
- White-box agent audits are described as static/code review — never as DAST or a
  pen test.

## 3. Genericization (public-repo hygiene)

- No partner-specific endpoints, org IDs, credentials, file paths, internal
  hostnames, or company-identifying detail. Field-tested patterns appear
  anonymized ("a FastAPI backend with Postgres row-level security", "a thin 2GP
  registration package").
- No partner-gated identifiers: no Trialforce Template IDs, no W-numbers
  (Salesforce work items), no verbatim text from login-gated docs. Cite them the
  way the sibling MCP toolkit does: "the MCP Client Partner Technical Guide
  (login-gated; ask in the Partnerblazer Slack MCP channel or via your Partner
  Account Manager)."
- The Salesforce partner Slack is referenced as a *place to ask*, never quoted.

## 4. Baseline-as-data (currency model)

All requirement facts live in `baseline/requirements-baseline.yaml` — never
hard-coded in skill prose. Each entry carries:

```yaml
- id: dast-scope-includes-identity-endpoints   # stable kebab id
  requirement: ...                   # one sentence
  details: ...                       # thresholds, formats, exact expectations
  applies_to: [managed-package | external-endpoint | mcp-server | canvas | both | all]
  automation: fully | partially | manual_only
  automation_notes: ...
  severity_if_missing: blocker | major | minor | informational
  sources:
    - url: ...
      date: ...                      # publication/updated date or "unknown"
      kind: official | community | partner_gated | empirical
  verification: verified_primary | web_research_unverified | conflicting
  last_verified: YYYY-MM-DD | null
  conflicts: ...                     # only when verification: conflicting
```

Rules:
- Skills MUST read the baseline at run time and warn when `last_verified` on the
  entries they use is older than **90 days** (the review process changed three
  times in 18 months: Chimera retirement, Code Analyzer v5, AgentExchange).
- `conflicting` entries are surfaced to the user as "verify with your Partner
  Account Manager / partner Slack before relying on this" — never silently picked.
- `partner_gated` sources are cited by name only (see §3).
- `baseline/SOURCES.md` is the registry: every source URL once, with what it
  corroborates and when it was last checked.

## 5. Skill structure (mirrors sf-mcp-partner-toolkit)

- Frontmatter: `name`, `description` (when to use it, in one breath),
  `allowed-tools` (narrowest workable set).
- Body sections in order: title · one-paragraph promise · **When to use** (with
  NOT-for bullets) · **Prerequisites** · numbered **Steps** · **Automated vs.
  manual recap** · **What feeds the next skill**.
- Steps encode *failure modes*, not happy paths — every "why" that cost someone a
  review cycle gets a sentence.
- Skills are self-contained: never assume another skill ran first; detect state
  and degrade. Cross-references use the installed form
  `/sf-security-review-toolkit:<skill>`.
- Shared assets are referenced as `${CLAUDE_PLUGIN_ROOT}/baseline/...`,
  `${CLAUDE_PLUGIN_ROOT}/methodology/...`, `${CLAUDE_PLUGIN_ROOT}/templates/...`,
  `${CLAUDE_PLUGIN_ROOT}/harness/...`.
- Multi-agent work: prefer the Workflow tool when available; every workflow has a
  documented sequential fallback using plain subagent (Task/Agent) calls.
- Declare token-cost expectations up front for anything that fans out agents
  (`quick` / `standard` / `exhaustive` tiers with approximate agent counts).

## 6. Target-repo state model

Skills write into the PARTNER's repo, never into the plugin:

- `<target>/docs/security-review/` — generated artifacts (committed, reviewable).
- `<target>/.security-review/` — machine state: `scope-manifest.json`,
  `audit-ledger.json`, `evidence/` (scan outputs, SSL Labs JSON, screenshots),
  `run-log.md`. Recommend the partner commits this too (the ledger is what makes
  re-audits incremental), excluding any credential material.
- Nothing in state files may contain secrets; skills must refuse to write captured
  credentials and say where to put them instead (env vars, vaults).

## 7. Audit engine rules

- The find → **adversarial-verify** → synthesize loop is mandatory. Findings that
  skip verification are never shown as findings.
- Precision over volume: a finding requires exact file:line, a concrete
  `exploit_scenario` (attacker, request, impact), and survives a skeptical
  verifier who read the gating code. Correct controls are not findings.
- Severity taxonomy: `critical` (auto-fail / cross-tenant / key compromise),
  `high` (must fix before submission), `medium` (likely flagged; should fix),
  `low` (hardening), `info`. Verifiers emit `adjusted_severity`.
- The known-findings ledger (`audit-ledger.json`) carries every confirmed,
  refuted, fixed, and accepted-risk finding across runs; finder prompts embed
  the ledger as "do NOT re-report" context. This is what makes pass N+1 cheap
  and quiet.
- Dimensions are concept-stable, target-variable: each dimension file defines the
  threat concept, what "good" looks like, and **detection heuristics** for
  locating the relevant code per stack (the stack-adapter step resolves real
  paths before finders run).

## 8. Repository layout (canonical — keep cross-references consistent)

```
sf-security-review-toolkit/
├── .claude-plugin/{plugin.json, marketplace.json}
├── .gitignore  LICENSE  README.md  CONVENTIONS.md
├── baseline/
│   ├── requirements-baseline.yaml   # the requirement map as data (§4)
│   └── SOURCES.md                   # source registry + verification status
├── methodology/
│   ├── audit-methodology.md         # engine spec: loop, severity, ledger, adapters
│   └── dimensions/                  # one file per audit dimension
│       ├── oauth-identity.md        ├── tenant-isolation.md
│       ├── sessionid-egress.md      ├── secrets-credentials.md
│       ├── mcp-surface.md           ├── mcp-threat-model.md
│       ├── injection-xss.md         ├── web-client.md
│       ├── crypto-internals.md      ├── background-jobs.md
│       ├── data-export.md           ├── email-outbound.md
│       └── admin-surface.md
├── templates/
│   ├── submission-checklist.md.tmpl # the required-artifacts table, per-row
│   ├── authn-authz-flow.md.tmpl     ├── data-flow-diagram.md.tmpl
│   ├── data-sensitivity.md.tmpl     ├── access-control.md.tmpl
│   ├── fp-dossier.md.tmpl           ├── questionnaire.md.tmpl
│   ├── readiness-tracker.md.tmpl    # HAVE/PARTIAL/TODO × owner
│   └── audit-ledger.schema.json
├── harness/
│   ├── workflow-template.mjs        # parameterized multi-agent audit workflow
│   ├── sequential-fallback.md       # same engine without the Workflow tool
│   └── zap/{README.md, zap-plan-template.yaml}   # authenticated DAST plan generator assets
└── skills/
    ├── security-review-journey/     # orchestrator: state detection + routing
    ├── scope-submission/            # Phase 0: architecture detection + preflight gates
    ├── audit-codebase/              # Phase 1: the autonomous audit engine
    ├── generate-artifacts/          # Phase 2: submission docs from code + audit
    ├── run-scans/                   # Phase 3: Code Analyzer / DAST / SSL Labs / deps
    ├── prepare-test-environment/    # Phase 4: Trialforce, agent+Topics, test users
    ├── compile-submission/          # Phase 5: questionnaire + checklist + verdict
    └── stay-listed/                 # post-approval recurring obligations
```

## 9. Writing voice

Dense, specific, failure-encoded — match the sibling MCP toolkit. Tables for
matrices, prose for reasoning. No marketing language, no "simply", no unexplained
acronyms on first use. American spelling.

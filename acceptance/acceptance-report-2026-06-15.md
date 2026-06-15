# Acceptance Test — 0.3.0 coverage dimensions (2026-06-15)

**Question this test answers:** when a fresh, skill-guided run of the toolkit is
pointed at a managed package that actually *contains* the failure classes the
0.3.0 dimensions were written for, do those dimensions (a) auto-select and (b)
catch the planted classes — or was the coverage only on paper?

**Standing rule it enforces:** every coverage gap must be encoded into the
toolkit (a dimension / scan family / baseline entry) and **proven by a
fresh-context run against a fixture that exercises it** — never left to a
maintainer being clever in one session. A fresh finder only follows the skills.

## Method

1. **Fixture** — `acceptance/generate-fixture.mjs` builds "Helios Service Agent"
   (`~/srt-helios`): a synthetic Salesforce AgentExchange managed 2GP
   (`sourceApiVersion 59.0`, namespace `helios`) seeded with **one concrete
   instance of every probe** in the three new dimensions, plus negative controls
   and a deleted-but-recoverable git-history secret. The ground-truth plant list
   is sealed in [`expected-findings.md`](expected-findings.md) — it lives in the
   toolkit repo, never in the fixture, so finders cannot read it. Every grep seed
   was verified to fire; every vulnerability-naming comment was scrubbed so a
   finder cannot "catch" a bug by reading a label.
2. **Selection** — a fresh-context agent (no knowledge of the plant list) ran the
   `scope-submission` + target-map procedure against the fixture.
3. **Detection** — the real `audit-codebase` engine
   (`harness/workflow-template.mjs`, injected via `acceptance/build-run-args.mjs`)
   ran over the fixture. Finders/verifiers are workflow subagents that receive
   only the dimension's verbatim §4 finder prompt + targets — they are the
   fresh-context detectors.
4. **Family 6** — `gitleaks` run over the working tree and full history per
   `skills/run-scans/SECRET-SCAN-FAMILY-6.md`.
5. **Grade** — confirmed findings vs the sealed plant list: per-class recall +
   precision on the negative controls.

All finder/verifier subagents ran on **haiku-4-5** — a deliberately stringent
bar: if the encoding only works with a frontier model, it is not robust enough
for a partner's run.

## Result — selection (PASS)

The fresh-context agent auto-selected **all three** new dimensions with resolved
targets (`agentforce-package`, `package-metadata`, `apex-exposed-surface`), and
correctly marked `mcp-surface`/`mcp-threat-model` **N/A** while still selecting
`agentforce-package` — proving the fix that the Agentforce dimension is *not*
MCP-gated. 8 applicable / 8 N/A, every N/A with a reason.

## Result — detection (PASS, after two engine fixes + one §5 fix)

Final authoritative pass (all 8 applicable dimensions, both engine fixes):
**75 candidates → 61 confirmed, 14 refuted, 0 unverified** (84 agents).

| Dimension | Planted | Caught | Notes |
|---|---|---|---|
| `apex-exposed-surface` | 8 (AE1–AE8) | **8 / 8** | 6 at critical incl. guest-reachable IDOR; entry-point authz, over-exposure, IDOR all caught |
| `package-metadata` | 10 (PM1–8, PMa, PMb) | **10 / 10** | Locker<40, exposed LMC, JS-in-origin, CSS isolation, hotlinks, open-redirect, CSRF, sample-code, http/wildcard trusted hosts, URL-id |
| `agentforce-package` | 12 (AP1–AP12) | **see below** | VerifiedCustomerId IDOR (critical), third-party-LLM, confirmation-on-write, invocable authz, LLM-output-untrusted, prompt/response logging |
| run-scans **Family 6** | 1 (deleted git secret) | **caught** | gitleaks: 0 working-tree, 4 in history (the deleted `credentials.env` blob); the `secrets-credentials` dimension also caught it via `git log` |
| Negative controls | 8 | **0 false positives** | apiVersion 40.0, position:relative, url-weblink, isExposed-false, ConnectApi.EinsteinLLM (sanctioned), with-sharing owner-bound query, hardened prompt template, `$Resource` vendored script — none flagged |

`agentforce-package` per-class: **AP1** VerifiedCustomerId (critical) ✓, **AP2**
user-controlled record refs ✓ (cited in the IDOR findings), **AP3** third-party
LLM ✓, **AP4** confirmation-on-write ✓, **AP6** invocable authz ✓, **AP10**
LLM-output→SOQL (critical) ✓, **AP11** prompt/response logging ✓, **AP7/8/9/12**
prompt-template hardening cluster ✓ (after the §5 fix below). **AP5** (the
employee-vs-service × public-vs-private *classification table*) is a documentation
deliverable surfaced by `compile-submission`'s artifact checklist, not a code
finding — an expected non-catch for the static finder.

## Three gaps the acceptance test surfaced — all encoded + re-proven

The test caught real defects. None was a dimension *concept* gap — all three were
**robustness gaps in the shared engine / verifier guidance** that would have let a
real partner's run silently under-report.

1. **Finder repo-anchoring (engine).** On the first pass, the `agentforce-package`
   finder produced **0 findings** — not because the dimension was weak, but
   because it wandered to the cwd's *foreign* `scope-manifest.json` (the engine
   ran from a different project's directory), got confused, and returned "the
   codebase is not present." Seven other finders read the target fine; one weak
   finder on the largest prompt was derailed. **Fix:** `harness/workflow-template.mjs`
   now hard-anchors every finder/verifier to `REPO_ROOT` and forbids reading the
   cwd or any foreign manifest. **Proof:** with the fix, `agentforce-package` went
   **0 → 19 confirmed** (target reads 56, foreign-manifest reads 0) with the stale
   foreign manifest still deliberately present.

2. **Verifier never received §5/§6 (engine).** The adversarial verifier got only a
   generic "confirm only if the exploit is reachable in the real code" prompt and
   **never saw each dimension's own verifier guidance / false-positive patterns**.
   So it over-refuted real *declaration-level* metadata violations — an exposed
   message channel, an `http://`/wildcard trusted host, `position:absolute` in
   component CSS — on a "no live caller / dormant config / shadow-DOM isolates it"
   rationale that the Salesforce static review (which flags whatever the package
   *ships*) does not apply. **Fix:** the engine now threads each dimension's §5+§6
   into the verifier as `verifierNotes` and treats declaration-level violations as
   confirmed-on-declaration (reachability sets severity, not validity); documented
   in the template header and the `audit-codebase` skill so a partner run threads
   it too. **Proof:** PM2 (exposed LMC), PMa (http:// + wildcard remote sites), and
   PM4 (`position:absolute`) all flipped **refuted → confirmed** on the next pass.

3. **Agentforce §5 "Reachability first" loophole (dimension).** Even with §5
   threaded, the verifier refuted the under-hardened prompt template
   (`Helios_CaseSummary`, the AP7/8/9/12 cluster) by reading the §5 *"unwired
   action → low/info"* bullet as license to issue `false_positive` — "dead
   packaged code, no execution path." But a packaged `genAiPromptTemplate` with
   unenclosed untrusted merge fields ships in the package and a subscriber can
   wire it. **Fix:** `methodology/dimensions/agentforce-package.md` §5 now states
   that reachability sets *severity* and **never** refutes a shipped artifact —
   downgrade to low/info (`partially_real`) with a "not currently wired" note,
   never `false_positive` on a not-currently-invoked basis. **Proof:** focused
   re-run flipped `Helios_CaseSummary` from `false_positive` to `partially_real`
   at `low`, with the verifier applying the new rule verbatim — *"reachability
   sets SEVERITY and never refutes a shipped artifact… the finding is confirmed
   but downgraded… because it is packaged but not currently bound to any live
   agent/action path."* The hardened-template and sanctioned-Models-API negative
   controls stayed clean.

## Tally

- **Recall on the seeded classes:** `apex-exposed-surface` 8/8, `package-metadata`
  10/10, `agentforce-package` caught AP1–AP4, AP6–AP12 (AP5 — the action
  *classification table* — is a documentation deliverable surfaced by
  `compile-submission`, not a static-finder catch), Family 6 caught the
  git-history secret.
- **Precision:** 0 false positives across the 8 negative controls.
- **Gaps found → encoded → re-proven:** 3 (two engine-robustness, one §5
  loophole) — each fixed in the toolkit and demonstrated by a fresh re-run, per
  the standing rule.

## Honest framing

The fixture is seeded with *known* failure classes, so this proves the toolkit
**catches its known failure classes** — a no-surprises bar. It does not prove the
toolkit catches an unknown class, and it does not substitute for Salesforce's own
penetration test, which runs regardless. The finders ran on haiku; a frontier
finder would do at least as well. Recall on the seeded classes is the metric;
precision was perfect on the negative controls (0 false positives).

## Reproduce

```bash
node acceptance/generate-fixture.mjs ~/srt-helios          # build the fixture (+ git-history secret)
# scope it (fresh agent or scope-submission skill) → ~/srt-helios/.security-review/{scope-manifest,target-map}.json
node acceptance/build-run-args.mjs <pluginRoot> ~/srt-helios 2026-06-15   # inject the engine
# Workflow({scriptPath: "~/srt-helios/.security-review/audit-engine.mjs"})  # run it
gitleaks git ~/srt-helios --redact                         # Family 6 (history pass)
```

Grade the confirmed findings against [`expected-findings.md`](expected-findings.md).

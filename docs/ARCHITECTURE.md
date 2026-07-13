# Architecture — what the model does, and what the code does

The central claim of this toolkit is one sentence: **the LLM generates; deterministic code enforces.**
A weaker model produces weaker *findings* — it does not collapse the gates, inflate the readiness score,
re-author the ledger, or let an un-evidenced claim through. Every honesty-critical property below is a
**pure `harness/*.mjs` engine** (no LLM, no network, no dependencies, byte-identical on re-run) guarded by a
standing **`acceptance/test-*.mjs`** that fails the build if the property breaks. The contract lives in
[`CONVENTIONS.md` §7](../CONVENTIONS.md):

> **Determinizable honesty claims are engine-backed, not narrated.** Any self-describing count, applicability
> set, readiness band/gate, finding de-dup, or staleness check MUST be computed by a pure `harness/*.mjs`
> engine — no LLM, no network, no dependencies, byte-identical on re-run — and guarded by a self-asserting
> `acceptance/test-*.mjs` standing test that fails the build if the property breaks.

**You do not have to trust this document.** `git clone`, then `for t in acceptance/test-*.mjs; do node "$t" || exit 1; done`
(Node 18+, zero dependencies) re-runs every claim below. The `file:line` references are the anchors —
open the engine at those lines and the code is the proof.

---

## The boundary

| Stage | Who | What |
|---|---|---|
| **FIND** | LLM | one read-only finder per dimension (`agentType: 'Explore'`), structured `FINDING_SCHEMA`, the ledger digest passed as "do not re-report" |
| **VERIFY** | LLM | one *fresh* adversarial verifier per finding — it gets the finding, **never the finder's reasoning** — reads the actual code, returns `VERDICT_SCHEMA` with a **required `file:line` evidence** field |
| **SYNTHESIZE** | LLM | compiles confirmed / partially-real findings into the report |
| **everything downstream** | **deterministic code** | consent gate · engine assembly · ledger merge · cross-dimension collapse · artifact withhold · SCI scoring & credit · recurrence · staleness · baseline counts/applicability · the toolkit's own live-op safety |

A finding that skips verification is **never reported** ([`audit-methodology.md`](../methodology/audit-methodology.md) §3.3):

> Findings that skip verification are never reported. If a verifier crashes, times out, or fails schema
> validation: re-queue that one finding once; if it fails again, the finding goes to the run log as
> `unverified — re-run`, not to the report and not to the ledger as confirmed.

The verifier never sees the finder's reasoning — independence is what earns the precision
(`harness/workflow-template.mjs` :442-444):

```js
// Stage 2: adversarially verify each finding from this dimension. Each
// verifier is a fresh context: it gets the finding, never the finder's
// reasoning — independence is what earns the precision.
```

---

## A. The enforcement gates — what the model is not allowed to fudge

### The AuthN/AuthZ artifact is withheld from the ledger alone, on every path
**Engine** `harness/artifact-gate.mjs` :108-170 · **Test** `acceptance/test-artifact-gate.mjs`
A pure gate (`computeGate(findings, triage)`, no I/O): if any open critical/high finding is in the
authentication/authorization dimension set, the AuthN/AuthZ flow document is **withheld** — regardless of
human election, with no "STOP" mode and no orchestrator memory. It **fails SAFE** on a malformed (non-array)
ledger (withhold, not generate).

```js
const openAuthz = open.filter((f) =>
  (sevOf(f) === 'critical' || sevOf(f) === 'high') &&
  AUTHN_AUTHZ_DIMENSIONS.has(String(f.dimension || '').trim().toLowerCase()))
if (openAuthz.length) { /* suppress = ['authn-authz-flow'] */ }
```

### The same withhold, enforced at the tool layer even if the skill is bypassed
**Engine** `hooks/authz-gate-hook.mjs` :37-84 · **Test** `acceptance/test-authz-gate-hook.mjs`
A `PreToolUse` hook that is a **no-op** unless (a) the write targets the toolkit's own
`docs/security-review/authn-authz-flow.md` **and** (b) you armed it (`.security-review/hook-armed`). Armed, it
reuses `computeGate` and **denies** the write while an auth hole is open. Fails closed if the ledger is
unreadable or malformed.

```js
const GATED_SUFFIX = 'docs/security-review/authn-authz-flow.md'
if (!String(fp).replace(/\\/g, '/').endsWith(GATED_SUFFIX)) return { action: 'allow' }
if (!existsSync(join(root, '.security-review', 'hook-armed'))) return { action: 'allow' }
if (!ledger || !Array.isArray(ledger.findings)) return { action: 'deny', reason: '…open auth hole…' }
```

### The readiness score credits only reviewer-reproducible evidence
**Engine** `harness/compute-sci.mjs` :177-240 · **Test** `acceptance/test-sci.mjs`
The Submission Completeness Index has a **hard blocker floor** and credits a requirement only when its evidence
is reviewer-reproducible (a scanner report the reviewer re-runs, an owner-signed artifact, or a structural
N/A). An audit-only clear is surfaced as a separate `statically-cleared` signal that **never** moves the
completeness % or clears the floor. Fails closed on missing/non-array findings or an empty scope manifest.

```js
const isCreditable = (e) =>
  e.disposition === 'satisfied' && e.verified && e.verified.value === true && e.reviewer_reproducible === true
const blocked = openBlockerFindings.length > 0 || openBlockerReqs.length > 0
```

### Credit is decided from where the evidence lives, not from what the input claims
**Engine** `harness/build-evidence-index.mjs` :138-141,181-190 · **Test** `acceptance/test-build-evidence-index.mjs`
The credit rule reads the evidence **location on disk**: a real scanner report under `.security-review/evidence/`
→ `satisfied` + `reviewer_reproducible`; an audit-report clear → `statically-cleared`. The engine **ignores any
`disposition`/`reviewer_reproducible` the input asserts** — so a hand-authored or over-crediting index
under-credits, never over-credits.

```js
const isScannerEvidence = (loc) => rel.startsWith(EVIDENCE_DIR) && onDisk(rel)
const repro = isScannerEvidence(c.loc)   // → 'satisfied' if true, else 'statically-cleared'
```

---

## B. The audit cannot even start without recorded consent

### Consent is a recorded affirmative; missing or negative fails closed
**Engine** `harness/record-consent.mjs` :56-121 · **Test** `acceptance/test-record-consent.mjs`
`verifyConsent(gate)` returns true only if a recorded answer for that gate has `affirmative === true`. A
controlled `--decision affirm|deny` token (from the operator's selected `AskUserQuestion` option) is
authoritative; otherwise free text is scanned with **deny-precedence** (any negation token — `not`, `n't`,
`deny`… — forces false). The sequence is clock-free (`max+1`) so it is deterministic under the Workflow
runtime where `Date.now()` is unavailable.

```js
const DENY = /\b(?:no|n|nope|not|deny|...|dont|do not)\b|\b\w+n['']t\b/i
if (DENY.test(s)) return false                                   // deny precedence
const affirmative = decision !== null ? decision === 'affirm' : isAffirmative(answer)
```

### The fan-out is physically un-assemblable without both consents
**Engine** `harness/build-audit-engine.mjs` :92-110 · **Test** `acceptance/test-record-consent.mjs` (C6)
`build-audit-engine` is the only place the Workflow runtime (which has no filesystem access) can verify consent.
It checks both required gates **before** any extraction, injection, or write; if either is missing it
`exit(3)` and writes **nothing** — so a skipped consent ask cannot launch an audit.

```js
const REQUIRED_GATES = ['audit-tier', 'audit-targetmap']
const missingConsent = REQUIRED_GATES.filter((g) => !verifyConsent(g, { target: REPO }))
if (missingConsent.length) { console.error('…REFUSING to assemble…'); process.exit(3) }
```

### The auto-fail dimensions are engine-forced, not driver-remembered
**Engine** `harness/build-audit-engine.mjs` :63-90 · **Test** `acceptance/test-build-audit-engine.mjs` (A1–A3)
Three always-on dimensions (`sessionid-egress`, `secrets-credentials`, `error-handling-disclosure`) are forced
into **every** audit by code; if a driver marks one N/A it is moved back to applicable with a `WARN`. A driver
that forgets an auto-fail class cannot silently under-cover.

```js
const ALWAYS_ON = ['sessionid-egress', 'secrets-credentials', 'error-handling-disclosure']
for (const key of ALWAYS_ON) {
  if (NA.some((n) => n && n.key === key)) { NA = NA.filter(...); console.error(`WARN: …cannot be N/A…`) }
  if (!present.has(key)) APPLICABLE.push({ key, targets: FULL_TREE_TARGET, stackNotes: 'always-on dimension (auto-injected): full source tree' })
}
```

### Finder prompts are extracted, not improvised — and a malformed dimension fails loud
**Engine** `harness/build-audit-engine.mjs` :116-143,193,205-208 · **Test** `acceptance/test-build-audit-engine.mjs` (E1–E4)
The §4 finder prompt and §5/§6 verifier notes are extracted by anchor from each dimension file; missing
headings or a suspiciously short prompt **throw** (a weak model handed an empty prompt audits nothing). The
run-args are injected at an exact marker and stamped `consentVerified: true` only after the gate passed; the
assembled engine is then validated by a decoy-anchored injection check.

```js
const marker = 'const INJECTED = /* {{ARGS_OBJECT}} */ null'
if (!tpl.includes(marker)) throw new Error('…injection marker not found…')
```

### The injection check resists the header-comment decoy
**Engine** `harness/injection-check.mjs` :37-71 · **Test** `acceptance/test-injection-check.mjs`
It anchors on a **line-start** `const INJECTED = {` (so a header-comment mention of the marker can't be
misread as a failed injection), brace-matches with string-awareness, and rejects an un-injected, non-JSON,
non-object, or `repoRoot`-missing payload.

---

## C. Findings are tracked mechanically — never re-authored by a model

### The ledger merge is engine code, never an LLM
**Engine** `harness/merge-ledger.mjs` :1-90 · **Test** `acceptance/test-merge-ledger.mjs` (M1–M14)
> "Engine code, never an LLM": a synthesis agent paraphrasing entries corrupts the dedup keys, so this step
> must be deterministic.

The dedup id is `sha256(file + normalized-title)` truncated to 16 hex — stable across runs so synthesis
paraphrasing never loses a finding. It also accepts the raw Workflow output envelope directly (it unwraps
`.result` itself):

```js
const dedupId = (file, title) => createHash('sha256').update(stripLine(repoRel(file)) + '\n' + normTitle(title)).digest('hex').slice(0, 16)
const R = wrapper.result && wrapper.result.ledger_updates ? wrapper.result : wrapper   // envelope unwrap
```

### Cross-dimension duplicates collapse on overlapping line spans — never on a symbol name
**Engine** `harness/finding-clusters.mjs` :51-78 · **Test** `acceptance/test-merge-ledger.mjs` (M6–M11)
Same file **and overlapping line span** across dimensions → one entry at the max verified severity, each lens
preserved. Same file alone never merges, and a title's method/symbol name is **deliberately not** a merge
signal — that path once over-merged a high FLS gap and a critical SOQL injection in the same method into one
entry. **Under-merge is the safe failure.**

```js
// Same code LOCATION: same normalized file AND OVERLAPPING LINE SPAN. That is the ONLY signal.
// Same file alone is never enough, and a title's method/symbol name is deliberately NOT used…
```

### Run-to-run variance is made visible, not asserted away
**Engine** `harness/recurrence-confidence.mjs` :308-317 · **Test** `acceptance/test-recurrence-confidence.mjs`
Across N independent run-ledgers it classifies each finding `all_runs` / `some_runs` / `single_run`, and marks
`confidence = high` **only** for `all_runs` + confirmed-every-run + severity-stable. It is **report-only** — it
never moves the SCI gate. (The published [`ceiling-test.md`](ceiling-test.md) is why this exists.)

```js
const confidence =
  bucket === 'all_runs' && confirmedCount === n && severityStable ? 'high'
  : bucket === 'single_run' ? 'investigate' : 'review'
```

### Convergence is measured, not claimed; staleness is flagged, not auto-flipped
**Engines** `harness/union-convergence.mjs` :132-143 · `harness/ledger-staleness.mjs` :100-108 ·
**Tests** `acceptance/test-union-convergence.mjs`, `acceptance/test-ledger-staleness.mjs`
`union-convergence` reports whether the union of confirmed loci across N runs stops growing (report-only).
`ledger-staleness` compares repo HEAD to each pass's `audited_commit` fingerprint and **flags** (never
auto-flips) findings whose files changed since they were audited.

### A crashed finder is surfaced as a coverage failure, never silently dropped
**Engines** `harness/workflow-template.mjs` `computeCoverage` · `harness/render-recap.mjs` · `harness/merge-ledger.mjs` :266-269 ·
**Tests** `acceptance/test-coverage-accounting.mjs`, `acceptance/test-merge-ledger.mjs` (M16)
A finder that exhausts the StructuredOutput retry cap returns `null` (it does not throw), and a thrown
stage drops the whole dimension to `null`. `computeCoverage` reconciles the raw per-dimension output by
index — a null entry or a `{coverageFailed:true}` marker becomes a **coverage failure**, kept out of
confirmed/refuted/unverified and folded into `coverage_failed`. A clean `findings:[]` result stays a real
0-findings dimension: "found nothing" is never conflated with "finder crashed". The recap then reads
**Coverage INCOMPLETE — re-run X**, never a clean PROCEED over a crashed dimension, and the pass is never
`dry` while a coverage failure stands (so it can't satisfy the stop rule).

```js
const cleanFind = result && typeof result === 'object' && Array.isArray(result.findings)
if (!cleanFind) return [{ dimension: dim.key, coverageFailed: true, verdict: null }]
```

---

## D. The requirement baseline is data, not prose

### Counts are emitted from the YAML — the prose can't drift from the data
**Engine** `harness/baseline-counts.mjs` :23-35 · **Test** `acceptance/test-baseline-counts.mjs`
`verified_primary / web_research_unverified / conflicting` are computed deterministically from
`baseline/requirements-baseline.yaml`, and the test **fails the build if the README's self-description doesn't
match** the emitted counts. (This is the structural defense against the usual LLM-confabulation of a
plausible-but-wrong number.)

### Applicability is an exact set intersection — no inference
**Engine** `harness/applicable-requirements.mjs` :93-107 · **Test** `acceptance/test-applicable-requirements.mjs`
A requirement applies **iff** its `applies_to` contains `all` or intersects the detected element types — pure
set membership, no fuzzy matching. A plain managed package is never told to satisfy Agentforce requirements it
has no surface for.

```js
if (at.includes('all') || at.some((t) => els.has(t))) applicable.push(r.id)
```

### A platform-version refutation is checked against the package's API version
**Engine** `harness/baseline-refutation-check.mjs` :97-121 · **Test** `acceptance/test-baseline-refutation-check.mjs`
A refutation that leans on "the platform auto-enforces user-mode / `with sharing` at API 67.0+" is flagged
**invalid** when the package's `sourceApiVersion` is ≤ 66.0 (the auto-enforcement isn't real for that package).
Report-only; it never auto-re-confirms a finding.

### The calibration false-positive rules can't silently regress out
**Test** `acceptance/test-calibration-fp-patterns.mjs` :46-78
A presence guard: the verifier-guidance phrases that came out of blind multi-judge calibration (e.g.
`a missing grant is fail-closed`, `a subscriber admin can grant or wire`) must remain in each named dimension's
§6 table. *This is honest about its limits* — it asserts the prose is **present**, it does **not** test the
LLM's judgment.

---

## E. The toolkit's own live-operation safety

### The one network path fails closed, and verifies a sha256 before it ever executes a binary
**Engine** `harness/install-scanners.mjs` :241,499-501,616-620 · **Test** `acceptance/test-install-scanners.mjs`
`installScanners` throws unless `consent === true` is explicitly passed (re-verified at the engine boundary,
not a driver flag). Each raw binary is sha256-verified **before** it is made executable — a mismatch deletes
the file and never execs it. A `assertSafeTmpRoot` guard refuses `/`, an unsafe path, or a shared grouping dir
(can't `rm -rf` the wrong thing).

```js
if (!dryRun && consent !== true) throw new Error('install-scanners: refusing to install without explicit consent…')
if (!HEX64.test(String(inst.checksum)) || got !== inst.checksum) { /* failed — refusing to execute an unverified binary */ }
```

### Cleanup is asymmetric — tools out, evidence stays
**Engine** `harness/cleanup-scanners.mjs` :96-125 · **Test** `acceptance/test-cleanup-scanners.mjs`
Removes only the recorded tmp tool dir (after the same `assertSafeTmpRoot` check) and **keeps** the evidence
tree. Idempotent.

### Irreversible Salesforce/host ops are consent-gated, fail-closed
**Engine** `hooks/sf-ops-gate-hook.mjs` :307-317 · **Test** `acceptance/test-sf-ops-gate-hook.mjs` · doc [`sf-ops-safety-gate.md`](sf-ops-safety-gate.md)
A `PreToolUse(Bash)` hook, scoped to a managed audit repo, classifies an irreversible op on its **action verb**
(`package version promote`, install/uninstall, org create/delete, `sf org login`, `npm install -g`…) and
**denies** it unless a consent for that gate is recorded. Honestly scoped: a static classifier can't run the
shell, so an exotic wrapper/eval can evade it — it is defense-in-depth you opt into, not a complete shell parser.

```js
const gate = classify(cmd)
if (!gate) return { action: 'allow' }
if (verifyConsent(gate, { target: root })) return { action: 'allow' }
return { action: 'deny', reason: denyReason(gate, cmd) }
```

### The throwaway DAST only ever hits a loopback mirror, and tears down by name
**Engines** `harness/standup-stack.mjs` · `harness/run-dast.mjs` :56,100-108 · `harness/teardown-stack.mjs` :31-44 ·
**Tests** `acceptance/test-standup-stack.mjs`, `acceptance/test-run-dast.mjs`, `acceptance/test-teardown-stack.mjs`
The active scan refuses any non-loopback target before ZAP is invoked; secrets are synthesized at runtime and
passed by env-file (never in argv or the manifest, which carries names not values); teardown refuses any docker
resource whose name doesn't match the toolkit's `sf-srt-*` pattern.

```js
if (!LOOPBACK.has(host) && !/^127\./.test(host)) throw new Error(`run-dast: refusing to active-scan a non-loopback host '${host}'`)
```

### The toolkit's own CI is least-privilege, and locked
**Test** `acceptance/test-ci-hygiene.mjs` :45-63
The standing suite asserts `.github/workflows/test.yml` declares a top-level `permissions: contents: read` and
**no** write scope anywhere — so a future edit that widens the CI token fails the build.

---

## Verify it yourself

```sh
git clone https://github.com/runverdict/sf-security-review-toolkit
cd sf-security-review-toolkit
for t in acceptance/test-*.mjs; do node "$t" || exit 1; done   # Node 18+, zero dependencies
```

Every property above is one of those checks. What the suite does **not** prove — and the toolkit is candid
about — is the quality of the *model's* judgment in the FIND/VERIFY stages on a novel codebase; that is the
contestable-severity band the [`ceiling-test.md`](ceiling-test.md) falsifies and the recurrence-confidence
engine surfaces for human adjudication. The deterministic substrate is what holds when the model is having a
bad day.

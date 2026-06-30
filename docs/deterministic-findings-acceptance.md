# Deterministic-findings acceptance — the campaign replacement

> Phase 1 · Slice 3 of [`roadmap-deterministic-findings.md`](roadmap-deterministic-findings.md).
> This is the **deterministic replacement for the 5-run cold campaign**: instead of running
> the whole audit N times and eyeballing whether the blocker band converges, you run the
> engine **twice** and assert the deterministic band is **byte-identical** — end to end, not
> just at the unit-parser level. The campaign only existed because the band was a
> probabilistic LLM sample; once the three wobbled classes (CRUD/FLS, sharing,
> ViewAll/ModifyAll) are produced by a deterministic engine, "run it twice → identical" is a
> test, not a treadmill (roadmap §8).

## Why this exists

Five cold runs of the frozen Solano fixture graded **FAIL** against the honest bar: on
identical code the named anchors flickered —

| Anchor | r1 | r2 | r3 | r4 | r5 |
|---|---|---|---|---|---|
| SolanoOpportunityController FLS | high | high | **absent** | high | high |
| Contact-PII FLS | high | medium | low | medium | high |
| C5 ViewAll over-grant | medium | high | critical | **absent** | high |

The root cause was that the band was 100% LLM-generated. Slices 1+2 built the engines that
produce these classes deterministically; Slice 3 wires them into the flow and proves the band
no longer wobbles. This runbook is how you confirm that on a live target.

## Two acceptance levels

| Level | Who runs it | Needs `sf` / Code Analyzer? | What it proves |
|---|---|---|---|
| **A — hermetic** | the agent / CI | no | the wiring + the supersession logic, on the committed captured fixtures |
| **B — live** | the **operator** | **yes** | the same, end to end against a live Code Analyzer run on the Solano fixture |

Level A is the standing guard; Level B is the operator-run confirmation that the standing
guard reflects reality. Both must pass for Phase 1 to be considered validated.

---

## Level A — hermetic (agent / CI, no `sf`)

Runs today in the standing suite, no setup:

```bash
node acceptance/test-deterministic-integration.mjs
```

It drives the **real CLI sequence** on a tmp ledger off the committed
`acceptance/fixtures/` (the captured Solano Code Analyzer JSON + the
`Solano_Admin.permissionset-meta.xml`): the deterministic pass seeds
`provenance:'deterministic'` CRUD/FLS + ViewAll findings, a co-located LLM CRUD/FLS finding is
superseded by reconcile while off-class / off-locus LLM findings survive, the reconcile is
idempotent, and the reconciled open band excludes the superseded finding. It then asserts the
two skills GRANT + INVOKE the harnesses in the right order (ingest before the LLM fan-out,
reconcile after the merge) with the `sf`-absent → PENDING note present.

The unit-level "run the engine twice → identical" assertions live in
`test-ingest-scanner-findings.mjs` (ingest the real Solano fixture twice → byte-identical
findings) and `test-reconcile-provenance.mjs` (reconcile twice → byte-identical). Level B
re-confirms those against a **fresh** Code Analyzer run rather than a captured one.

---

## Level B — live (operator-run; `sf` + Code Analyzer present OR cold-installed on consent)

### B0 — prerequisites: stand up Code Analyzer (operator)

Two ways to get `sf` + the `code-analyzer` plugin + a JDK 11+ in place; both end at the same B1
invocation.

**Cold-install path (0.8.41 — the default on a box without `sf`).** At the journey's preflight
gate, consent to the scanner install; `install-scanners.mjs` provisions the WHOLE Code Analyzer
stack into the tmp root and records it in `<target>/.security-review/scanner-install.json`:

- the pinned `@salesforce/cli@2.140.6` (npm) + the `code-analyzer@5.14.0` plugin (oclif short
  name → npm `@salesforce/plugin-code-analyzer`, which bundles pmd 0.43.0 / sfge 0.22.0 — the
  pins are what make the ledger band deterministic given a fixed analyzer);
- a JDK 11+ — a present `java`≥11 reused read-only, else the pinned **Temurin 17.0.19+10** fetched
  from Adoptium and **sha256-verified before extract** (per-platform pin; an unpinned platform
  with no present java fails closed → PENDING-OWNER-RUN, never extracted unverified);
- the **hermeticity contract** (the spike's load-bearing finding): the install sets the full
  contained env — `HOME` · `SF_DATA_DIR` · `SF_CACHE_DIR` · `SF_CONFIG_DIR` · `TMPDIR` ·
  `npm_config_cache` · `JAVA_HOME`, every path under the tmp root — **before** the npm install
  (the `@salesforce/cli` postinstall hooks fire during it, and `~/.sf` / the npm cache are not
  governed by `SF_*` alone) and passes it to every exec, so the teardown's single
  `rm -rf <tmpRoot>` reaches everything (0 escaped paths; verified twice-run byte-identical).
  Footprint: ~1 GB (+~320 MB if Java must be provisioned).

For the scan, export the `code-analyzer` record's `env` and prepend its 2-dir `pathPrepend`
(sf `.bin` + `JAVA_HOME/bin`), then run the B1 form with `-r AppExchange -r sfge -r pmd`.
`cleanup-scanners.mjs` removes the stack at end-of-run (evidence kept).

**Zero-install variant (a box that already has it).** A present `sf` + `code-analyzer` plugin
(reporting the baseline-prescribed major version, `scan-code-analyzer-v5-required`) + a `java`≥11
is used as-is — nothing is installed.

- **Anchor the toolkit checkout.** The `harness/*.mjs` engines live in the toolkit repo, NOT
  in the fixture — so every command below invokes them by absolute path via `$SRT`, and is
  cwd-independent (never `cd` into the fixture to run a harness):

  ```bash
  SRT=/path/to/sf-security-review-toolkit   # your toolkit checkout (where harness/ lives)
  ```
- The Solano fixture on disk (it is generated, never committed):

  ```bash
  node "$SRT"/acceptance/generate-solano-fixture.mjs ~/srt-solano   # the "Solano Pipeline Guardian" managed-package fixture
  mkdir -p ~/srt-solano/.security-review/evidence
  ```

### B1 — run Code Analyzer, land the JSON in `evidence/` (operator)

The deterministic pass keys off a `code-analyzer-*.json` under
`.security-review/evidence/`. Produce it exactly as `run-scans` Family 1 does — the
**AppExchange selector is load-bearing**, and the Graph Engine is what produces the CRUD/FLS
dataflow findings (`scan-sfge-crud-fls-dataflow`):

```bash
cd ~/srt-solano                 # or pass --workspace .
DATE=$(date +%F)
sf code-analyzer run --workspace . \
  -r AppExchange -r sfge -r pmd \
  --output-file .security-review/evidence/code-analyzer-$DATE.json --view detail
# (emit the HTML too for the submission; the JSON is what the ingest reads)
[ -s ~/srt-solano/.security-review/evidence/code-analyzer-$DATE.json ] \
  || { echo "FAIL: Code Analyzer produced no JSON — fix the run before proceeding"; }
```

**`-r sfge` is mandatory** — `ApexFlsViolation` is DevPreview and NOT in `Recommended`, so the
Graph Engine's FLS findings only fire when sfge is selected explicitly; `ApexCRUDViolation` comes
in via `-r AppExchange` / `-r pmd`. Verify the flag syntax against your installed CLI
(`sf code-analyzer run --help`) — the last major-version transition changed the command shape once.

### B2 — run the deterministic pass (agent-runnable; what audit-codebase Step 4b does)

One `--all` invocation ingests EVERY recognized scanner output present under `evidence/` (the
metadata over-grant scan is always-on; the `code-analyzer-$DATE.json` you produced in B1 — plus any
OSS SAST / secret / dep-CVE / IaC evidence from `run-scans` — is recognized by content shape and
ingested in the same pass):

```bash
node "$SRT"/harness/ingest-scanner-findings.mjs --all --target ~/srt-solano
```

### B3 — confirm the three anchors are `provenance:'deterministic'`, severity-from-class, NO LLM

```bash
node -e '
const l = require(process.argv[1]);
for (const f of l.findings.filter(x => x.provenance === "deterministic")) {
  console.log(`${f.provenance} | ${f.class || "(unmapped)"} | ${f.severity} | ${f.engine}/${f.ruleId} | ${f.file}`);
}' ~/srt-solano/.security-review/audit-ledger.json
```

**PASS criteria (B3):**

- The **SolanoOpportunityController FLS** and **Contact-PII FLS** anchors appear as
  `deterministic` / `class:'crud-fls'` / severity **high** (read from `fail-crud-fls`), each
  carrying the `engine` (`pmd`/`sfge`) + `ruleId` that fired.
- The **C5 ViewAll over-grant** (`Solano_Forecast_Snapshot__c`) appears as `deterministic` /
  `class:'viewall-overgrant'` / severity **high** from the `metadata` engine — and the
  standard-object `Account` over-grant and the non-over-granting custom object are **not**
  flagged.
- Every one of these carries `provenance:'deterministic'`; none was authored by the LLM.

### B4 — run the audit (LLM fan-out) + merge + reconcile; confirm LLM duplicates are superseded

Run the journey (`run the security review`) or `audit-codebase` directly. Step 4b has already
seeded the deterministic findings (B2); the LLM fan-out then runs, `merge-ledger.mjs` folds in
the LLM findings, and `reconcile-provenance.mjs` runs as the **last merge step**:

```bash
node "$SRT"/harness/reconcile-provenance.mjs --target ~/srt-solano --json
```

**PASS criteria (B4):** any LLM finding in a deterministic-owned class (CRUD/FLS, sharing,
ViewAll) at the same locus as a deterministic finding is `status:'superseded'` with
`superseded_by` → the deterministic id; the deterministic findings stand; LLM findings in
classes no engine owns (the residual — IDOR logic, guest-sensitivity judgment,
prompt-injection, etc.) are untouched and stay `llm-inferred`.

### B5 — the campaign replacement: run the deterministic pass TWICE → byte-identical

This is the assertion the 5-run campaign could never get from the LLM band. Ingest the SAME
Code Analyzer JSON into two **fresh** ledgers and diff the deterministic findings:

```bash
# Guard FIRST — an empty $DATE or a missing CA JSON would degrade the band to metadata-only
# and the diff below would FALSE-PASS (empty == empty) while the CRUD/FLS band was silently
# dropped. Fail loud instead.
: "${DATE:?set DATE first — e.g. DATE=\$(date +%F), matching the B1 filename}"
CA=~/srt-solano/.security-review/evidence/code-analyzer-$DATE.json
[ -s "$CA" ] || { echo "FAIL: $CA missing/empty — run B1 (sf code-analyzer) first"; exit 1; }

extract() { node -e '
const l = require(process.argv[1]);
const d = l.findings.filter(f => f.provenance === "deterministic")
  .map(f => ({id:f.id, class:f.class||null, severity:f.severity, engine:f.engine, ruleId:f.ruleId, file:f.file}))
  .sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
console.log(JSON.stringify(d, null, 2));' "$1"; }

run_once() {
  D=$(mktemp -d); mkdir -p "$D/.security-review/evidence" "$D/force-app/permissionsets"
  find ~/srt-solano -name '*.permissionset-meta.xml' -exec cp {} "$D/force-app/permissionsets/" \;
  cp "$CA" "$D/.security-review/evidence/"
  node "$SRT"/harness/ingest-scanner-findings.mjs --all --target "$D" >/dev/null
  extract "$D/.security-review/audit-ledger.json"
}

B1=$(run_once); B2=$(run_once)
# the band MUST actually carry the deterministic CRUD/FLS findings — a metadata-only band
# (CA JSON not ingested) is a degraded run, not a pass, even if it is identical run-to-run.
echo "$B1" | grep -q '"crud-fls"' \
  || { echo "FAIL: deterministic CRUD/FLS band is EMPTY — the CA JSON was not ingested (check \$DATE / B1)"; exit 1; }
diff <(echo "$B1") <(echo "$B2") && echo "DETERMINISTIC BAND IDENTICAL RUN-TO-RUN ✓"
```

**PASS criteria (B5):** the diff is empty — the deterministic band (ids, classes, severities,
engines, ruleIds, loci) is identical run-to-run. This is the end-to-end "run the engine twice
→ identical" that replaces the 5-run union-convergence campaign. (For a stronger check, re-run
`sf code-analyzer` itself between the two ingests and confirm the same band — Code Analyzer's
SAST output is deterministic over unchanged source.)

With the full OSS scanner set present in `evidence/` (Semgrep/Bandit/njsscan SAST, gitleaks/
detect-secrets, OSV/npm-audit dep-CVE, Checkov/Trivy IaC alongside Code Analyzer + the metadata
over-grant), `--all` makes the WHOLE deterministic band reproducible run-to-run — not just the
three originally-wobbled CRUD-FLS / sharing / ViewAll classes.

---

## What this does NOT prove (the honest ceiling)

- **Only the deterministic-owned classes are stable.** The LLM residual band (per-record
  IDOR / object-authz logic, guest-sensitivity judgment, prompt-injection, denial-of-wallet,
  business-logic, multi-step authz — roadmap §4) is still a *sample*: it can flip run-to-run
  and a human adjudicates it. Slice 3 makes the three wobbled blocker classes deterministic;
  it does not (and Phase 1 does not claim to) make the whole band deterministic.
- **"Deterministic" ≠ "complete."** The deterministic band is what an engine reliably finds;
  it bounds neither false negatives nor the residual. Phase 2 extends provenance-typing to the
  remaining classes (roadmap §10), but the residual never goes to zero.
- **Salesforce pen-tests the surface regardless.** This is white-box static evidence; the
  reviewer installs the package and runs their own penetration test no matter what this
  produces.

## Cross-references

- Engines: `harness/ingest-scanner-findings.mjs` (Slice 1/2 + the 0.8.40 `--all` content-recognizer ingest),
  `harness/reconcile-provenance.mjs` (Slice 2).
- Wiring: `skills/audit-codebase/SKILL.md` (Step 4b — now ONE `--all` call — plus the reconcile at the end of
  Step 6), `skills/security-review-journey/SKILL.md` (Audit step), `skills/run-scans/SKILL.md` (Family 1 feeds
  the ingest, AND step 9b now runs `--all` + reconcile at the scan tail so a single cold run seeds the band).
- Standing guards: `acceptance/test-deterministic-integration.mjs` (this slice),
  `acceptance/test-ingest-scanner-findings.mjs`, `acceptance/test-reconcile-provenance.mjs`,
  `acceptance/test-calibration-fp-patterns.mjs` (engine-absent → KEEP).

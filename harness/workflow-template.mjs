/*
 * workflow-template.mjs — the parameterized multi-agent audit workflow
 * (sf-security-review-toolkit/harness)
 *
 * Execution substrate for /sf-security-review-toolkit:audit-codebase when the
 * Workflow tool is available. Engine spec: methodology/audit-methodology.md
 * (§8.1 names this file); the no-Workflow degradation of the same engine is
 * harness/sequential-fallback.md. This template was generalized from workflow
 * scripts an ISV partner ran across three full audit passes of its own
 * production multi-tenant SaaS before submission prep — the pipeline shape,
 * schemas, and prompt structure are kept exactly; everything product-specific
 * became a run arg.
 *
 * WHAT RUNS HERE — one find → adversarial-verify → synthesize pass:
 *   - FIND: one read-only finder agent per audit dimension, structured output.
 *   - VERIFY: one read-only skeptical verifier per candidate finding, in a
 *     fresh context that never sees the finder's reasoning. The verify fan-out
 *     for dimension N overlaps the find stage of dimension N+1 (`pipeline`).
 *   - SYNTHESIZE: after a full barrier, one agent writes the pass report from
 *     confirmed/partial findings only.
 *   - RETURN: structured results for the ledger merge. The merge itself is
 *     MECHANICAL — done by the invoking skill's engine code, never an LLM
 *     (audit-methodology.md §5; an agent paraphrasing ledger entries corrupts
 *     the dedup keys).
 *
 * HOW /sf-security-review-toolkit:audit-codebase INVOKES THIS TEMPLATE
 *   1. Read `<target>/.security-review/scope-manifest.json`; refuse to run
 *      without it (audit-methodology.md §1.1).
 *   2. Select applicable dimensions for this pass (§1.2 applicability matrix ×
 *      the tier) and resolve each dimension file's detection heuristics into
 *      concrete repo paths — the stack-adapter step (§1.3). Show the resulting
 *      target map to the user BEFORE fanning out; a wrong target map silently
 *      audits the wrong code for the whole run.
 *   3. For each selected dimension, read
 *      ${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/<key>.md and extract TWO
 *      blocks: the threat-focus paragraph from its finder prompt block (§4) —
 *      that paragraph is the dimension's `finderPrompt` arg — AND its §5
 *      Verifier guidance + §6 Known-false-positive patterns block — that is the
 *      dimension's `verifierNotes` arg. The verifier MUST get §5/§6: without it
 *      the generic skepticism over-refutes declaration-level metadata violations
 *      (an exposed LMC, an http:// trusted host, position:absolute in component
 *      CSS, an unenclosed prompt template) on a "no live caller / dead-code
 *      artifact" rationale the Salesforce static review does not apply.
 *   4. Compile the do-not-re-report digest from
 *      `<target>/.security-review/audit-ledger.json` — one line per entry:
 *      `[state] title — file (one-line resolution or refute reason)`.
 *   5. Build the run-args object (shape below) and inject it. ALWAYS do this:
 *      copy this file to `<target>/.security-review/audit-engine.mjs` and
 *      replace the marked `const INJECTED = /* {{ARGS_OBJECT}} *\/ null` line so
 *      INJECTED is the JSON-serialized object (JSON is valid JS — paste it raw).
 *      Do NOT pass run-args via the Workflow tool's `args` parameter: in
 *      practice they arrive as a JSON STRING, `args.repoRoot` is undefined, this
 *      script falls through to the null placeholder, and the run fails fast with
 *      "run args missing or incomplete". The `args`-binding branch below is only
 *      a safety net; INJECTED is the load-bearing path.
 *      NOTE: `node --check` on the assembled file reports the top-level
 *      `return {…}` as "Illegal return statement" — that is EXPECTED (the
 *      Workflow runtime wraps the body in an async scope; top-level return is
 *      legal there). Do NOT remove/wrap/export the return. To pre-check, run
 *      harness/injection-check.mjs on the assembled copy — it validates ONLY the
 *      injected INJECTED object, anchoring on the real line-start `\nconst
 *      INJECTED = {` (NOT the bare `const INJECTED = ` substring, which also hits
 *      this header comment). Never `node --check` the whole module.
 *   6. Invoke the Workflow tool with `scriptPath` = the injected copy. On return: merge
 *      `ledger_updates` into the ledger by dedup key (normalized file path +
 *      normalized title — never description, never line numbers; §5.2), map
 *      verdict values to ledger states (confirmed_real/partially_real →
 *      `confirmed`, false_positive → `refuted`), redact any credential value
 *      captured in an evidence snippet (§10), append the run-log entry, and
 *      surface the `unverified` list AND the `coverage_failed` list (dimensions
 *      whose finder crashed — coverage incomplete, NOT clean) for a re-run.
 *
 * RUN-ARGS SHAPE (everything product-specific lives here, nothing in the body)
 *   {
 *     repoRoot:          "/abs/path/to/partner/repo",
 *     scopeManifestPath: "<repoRoot>/.security-review/scope-manifest.json",
 *     tier:              "quick" | "standard" | "exhaustive",
 *                        // The skill already applied the tier when selecting
 *                        // dimensions; recorded here for the report + run log.
 *     passNumber:        1,
 *     runDate:           "YYYY-MM-DD",
 *                        // Passed in — the Workflow runtime restricts
 *                        // Date.now()/Math.random(); never derive time here.
 *     reportPath:        "<repoRoot>/docs/security-review/audit-report-<runDate>-pass<N>.md",
 *     ledger:            "the §5.3 digest, or '' on a first pass",
 *     context: {         // Slots for the shared-context template below —
 *                        // assembled by the skill FROM THE SCOPE MANIFEST.
 *       productOneLiner:     "what the product is, one clause",
 *       reviewSurfaces:      "what the review pen-tests, e.g. 'a partner-hosted
 *                             MCP server; a Canvas-embedded web app; the
 *                             package's callouts'",
 *       stackSummary:        "framework + language + datastore, one line",
 *       securityModelClaims: "the partner's CLAIMED security model (tenant
 *                             isolation mechanism, auth flows, audit posture),
 *                             labeled as claims — finders verify, never assume"
 *     },
 *     dimensions: [      // One entry per applicable dimension, targets already
 *                        // resolved by the stack-adapter step.
 *       { key:           "oauth-identity",
 *         targets:       "comma/newline-separated repo paths (starting points,
 *                         not boundaries — finders follow imports). EMPTY or '.'
 *                         means the WHOLE source tree — the always-on full-tree
 *                         dimensions (build-audit-engine FULL_TREE_TARGET); the
 *                         finder is scoped to scan the entire repoRoot",
 *         stackNotes:    "optional per-dimension repo facts from the adapter",
 *         finderPrompt:  "the dimension file's §4 threat-focus paragraph",
 *         verifierNotes: "the dimension file's §5 Verifier guidance + §6
 *                         false-positive patterns (drives the verifier's
 *                         refute rules; optional but strongly recommended —
 *                         omitting it over-refutes declaration-level findings)" }
 *     ]
 *   }
 */

export const meta = {
  name: 'security-review-codebase-audit',
  description:
    'Adversarial multi-agent static security audit of a partner codebase for the AppExchange/AgentExchange security review',
  phases: [
    { title: 'Find', detail: 'one finder agent per audit dimension reads the real code for vulnerabilities' },
    { title: 'Verify', detail: 'each candidate finding adversarially refuted against the source by a fresh agent' },
    { title: 'Synthesize', detail: 'confirmed findings → pass report + structured results for the ledger merge' },
  ],
}

// ---------------------------------------------------------------------------
// Run args — injected by the invoking skill (see header). Fail loud if absent:
// a default-filled run would audit nothing and report "clean".
// ---------------------------------------------------------------------------
const INJECTED = /* {{ARGS_OBJECT}} */ null
const ARGS = typeof args !== 'undefined' && args && args.repoRoot ? args : INJECTED

if (!ARGS || typeof ARGS.repoRoot !== 'string' || !Array.isArray(ARGS.dimensions) || ARGS.dimensions.length === 0) {
  throw new Error(
    'workflow-template.mjs: run args missing or incomplete. The invoking skill must replace the ' +
      '`/* {{ARGS_OBJECT}} */ null` placeholder with the JSON run-args object (or the runtime must bind `args`). ' +
      'Required: repoRoot (string), dimensions (non-empty array). See the header comment for the full shape.'
  )
}
// CONSENT — defense-in-depth TRIPWIRE, not a security boundary. The SOLE real
// boundary is belt #1: build-audit-engine.mjs verifyConsent('audit-tier') &&
// verifyConsent('audit-targetmap') against the recorded affirmative answers, which
// fails closed (exit 3, no engine assembled) and only then stamps consentVerified.
// This check ASSUMES the gated assembler produced this engine; the Workflow runtime
// has no filesystem access, so it cannot re-read the consent files and makes NO
// security claim of its own (the flag is JS data — trivially forgeable by anyone who
// hand-builds the engine). Its only job is to catch an HONEST mistake — an engine that
// reached the runtime without going through the assembler — loudly, on either substrate.
if (ARGS.consentVerified !== true) {
  throw new Error(
    'workflow-template.mjs: refusing to fan out — consentVerified is not set. This engine did not come ' +
      'through build-audit-engine.mjs (the consent gate). Assemble via that engine, which asks + records ' +
      'audit-codebase Step 2 (tier go-ahead) + Step 3 (show the target map) and verifies them. Do not hand-set this flag.'
  )
}
// ===== BEGIN PURE COVERAGE HELPERS =====
// Extracted VERBATIM by acceptance/test-coverage-accounting.mjs (it slices this block from the
// source and exercises it) — workflow-template.mjs itself CANNOT be imported, because its
// top-level `return {…}` is legal only inside the Workflow runtime's async wrapper (a plain
// `import` fails with "Illegal return statement"). So these functions MUST be PURE and
// self-contained: no references to ARGS / CONTEXT / agent / any module-level state. The live
// pipeline below calls them, so the engine and the test share ONE code path.

// A dimension whose targets are empty / '.' / './' is a FULL-TREE scan — the always-on
// auto-injected default (build-audit-engine.mjs FULL_TREE_TARGET) — NOT a malformed entry.
function isFullTree(targets) {
  const s = String(targets == null ? '' : targets).trim()
  return s === '' || s === '.' || s === './'
}

// A dimension entry is valid when it carries a `key` AND a `finderPrompt`. `targets` is
// OPTIONAL: an empty / '.' targets means "scan the whole repository tree" (an always-on
// full-tree dimension), which is valid, not malformed. Pre-0.8.44 this threw on `!d.targets`,
// which crashed a legitimate targeted re-run of an auto-injected always-on dimension (BUG-B):
// build-audit-engine appended the always-on trio with empty targets, and this validation killed
// the whole fan-out before the first finder. Both layers are fixed (build emits a real
// full-tree target; this accepts an empty/'.' one) — defense in depth.
function isValidDimension(d) {
  return !!(d && d.key && d.finderPrompt)
}

// computeCoverage — reconcile the RAW pipeline output (`perDimension`, aligned to `dimensions`
// by index) into the run's accounting. THE correctness property (BUG-A): a dimension whose
// FINDER crashed must NEVER be silently dropped — it surfaces as a coverage FAILURE
// ("re-run this dimension"), distinct from a dimension that ran clean and found nothing.
//   - perDimension[i] == null  → the entire pipeline result was dropped (a stage threw; the
//                                Workflow runtime drops a throwing item to null) → coverage
//                                failure for dimensions[i]. (Compared by INDEX, before any
//                                .filter(Boolean), so a wholly-dropped dimension is caught.)
//   - an item with `coverageFailed === true` → the finder agent returned null (StructuredOutput
//                                retry cap — agent() returns null, does NOT throw) → coverage
//                                failure for that dimension.
//   - any other item → a normal candidate finding (with or without a verdict).
// A clean-empty find (perDimension[i] === []) contributes 0 candidates and is NOT a coverage
// failure: "found nothing" ≠ "finder crashed". Coverage-failed dimensions are kept OUT of
// confirmed/refuted/unverified findings and folded into their own list for the recap.
function computeCoverage(perDimension, dimensions) {
  const dims = Array.isArray(dimensions) ? dimensions : []
  const pd = Array.isArray(perDimension) ? perDimension : []
  const coverageFailed = []
  const all = []
  for (let i = 0; i < dims.length; i++) {
    const key = dims[i] && dims[i].key ? dims[i].key : '#' + i
    const entry = pd[i]
    if (entry == null) {
      // Whole-dimension drop: a stage threw and the runtime nulled the item. Coverage failure.
      coverageFailed.push(key)
      continue
    }
    const items = Array.isArray(entry) ? entry : [entry]
    let failed = false
    for (const it of items) {
      if (!it) continue
      if (it.coverageFailed) {
        failed = true
        continue
      }
      all.push(it)
    }
    if (failed) coverageFailed.push(key)
  }
  const coverageFailedUnique = []
  for (const k of coverageFailed) if (!coverageFailedUnique.includes(k)) coverageFailedUnique.push(k)
  const verified = all.filter((f) => f.verdict)
  const unverified = all.filter((f) => !f.verdict)
  const confirmed = verified.filter(
    (f) => f.verdict.verdict === 'confirmed_real' || f.verdict.verdict === 'partially_real'
  )
  const refuted = verified.filter((f) => f.verdict.verdict === 'false_positive')
  return { all, verified, unverified, confirmed, refuted, coverageFailed: coverageFailedUnique }
}
// ===== END PURE COVERAGE HELPERS =====

for (const d of ARGS.dimensions) {
  if (!isValidDimension(d)) {
    throw new Error(
      'workflow-template.mjs: dimension entry missing key/finderPrompt (targets is optional — ' +
        'empty/"." means full-tree): ' +
        JSON.stringify(d).slice(0, 200)
    )
  }
}

const REPO = ARGS.repoRoot
const PASS = ARGS.passNumber || 1
const TIER = ARGS.tier || 'standard'
const RUN_DATE = ARGS.runDate || 'unknown-date'
const REPORT_PATH = ARGS.reportPath || `${REPO}/docs/security-review/audit-report-${RUN_DATE}-pass${PASS}.md`
const LEDGER_DIGEST = (ARGS.ledger && String(ARGS.ledger).trim()) || '(none — first pass, empty ledger)'
const CTX = ARGS.context || {}

// ---------------------------------------------------------------------------
// Shared context — the {{...}}-slotted template the skill fills from the scope
// manifest (audit-methodology.md §2.2). Identical for every finder and
// verifier in the run. Nothing product-specific is hard-coded below this line.
// ---------------------------------------------------------------------------
function fill(template, slots) {
  let out = template
  for (const key of Object.keys(slots)) out = out.split('{{' + key + '}}').join(slots[key])
  return out
}

const CONTEXT = fill(
  `
You are a security reviewer auditing {{PRODUCT_ONE_LINER}} for the Salesforce
AppExchange/AgentExchange security review. The review probes:
{{REVIEW_SURFACES}}

Stack: {{STACK_SUMMARY}}. Code root: {{REPO_ROOT}}.

REPOSITORY ANCHOR — non-negotiable: the ONLY codebase in scope is the repository
rooted at {{REPO_ROOT}}. Every file you read, and every finding's file path,
MUST be under {{REPO_ROOT}}. Do NOT read any scope-manifest.json or other
.security-review/ file, and do NOT read, grep, or inspect any path OUTSIDE
{{REPO_ROOT}} — in particular, IGNORE your current working directory when it
differs from {{REPO_ROOT}} (the engine usually runs from a different directory,
and any manifest or code there belongs to an unrelated project, not your
target). The repository IS present at {{REPO_ROOT}}; if a target path looks
absent, grep UNDER {{REPO_ROOT}} to locate the real file — never conclude the
codebase is missing, never audit a different repo's files, and never return an
empty result because you could not find the code.

Architecture security model (claims from the partner's own documentation —
verify every claim against the ACTUAL code, do not assume):
{{SECURITY_MODEL_CLAIMS}}

Report ONLY findings grounded in real code you have READ, with exact file:line.
A finding is something a Salesforce security reviewer would flag and require
remediated or justified before approval, OR a real exploitable weakness. Prefer
precision over volume — a false alarm wastes the verifier's time and the
partner's. Dependency-version issues are handled by separate scanners
(/sf-security-review-toolkit:run-scans); report one only when a SPECIFIC
exploitable usage exists in this codebase, not a generic version bump.
Severity: critical (auto-fail class / cross-tenant or full compromise), high
(must fix before submission), medium (should fix / likely flagged), low
(hardening), info (note). For each finding give a concrete exploit_scenario
describing the attacker, the request, and the impact.
`,
  {
    PRODUCT_ONE_LINER: CTX.productOneLiner || 'the partner product',
    REVIEW_SURFACES:
      CTX.reviewSurfaces || '(review surfaces not provided — audit only what the dimension targets name)',
    STACK_SUMMARY: CTX.stackSummary || '(stack summary not provided)',
    SECURITY_MODEL_CLAIMS:
      CTX.securityModelClaims || '(no claimed security model provided — treat every control as unverified)',
    REPO_ROOT: REPO,
  }
)

// ---------------------------------------------------------------------------
// Schemas — verbatim from the field-proven scripts (and audit-methodology.md
// §2.1 / §3.2). Do not extend without updating the ledger merge.
// ---------------------------------------------------------------------------
const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
          file: { type: 'string', description: 'path:line of the vulnerable code' },
          description: { type: 'string' },
          exploit_scenario: { type: 'string', description: 'attacker, request, impact' },
          recommendation: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['title', 'severity', 'file', 'description', 'exploit_scenario', 'recommendation', 'confidence'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['confirmed_real', 'false_positive', 'partially_real'] },
    adjusted_severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
    reasoning: {
      type: 'string',
      description: 'what you read in the actual code that confirms or refutes the finding',
    },
    evidence: { type: 'string', description: 'exact file:line + code snippet that decides it' },
  },
  required: ['verdict', 'adjusted_severity', 'reasoning', 'evidence'],
}

// ---------------------------------------------------------------------------
// Prompt assembly (audit-methodology.md §2.2 / §3.1)
// ---------------------------------------------------------------------------
const finderPrompt = (dim) =>
  `${CONTEXT}\n\n## Your dimension: ${dim.key}\n\n` +
  (isFullTree(dim.targets)
    ? `Primary target: the ENTIRE repository tree rooted at ${REPO}. This is an always-on, full-source-tree dimension — there is no narrower target list, so scan broadly across the whole repo with grep (skip vendored/generated code: node_modules/, dist/, build/, .min.js, lockfiles), then follow imports/call-sites.\n\n`
    : `Primary targets (read these first, then follow imports/call-sites; use grep to locate the real files when a path is approximate):\n${dim.targets}\n\n`) +
  (dim.stackNotes
    ? `Stack notes (claims from the partner's own docs — verify against the ACTUAL code, never assume):\n${dim.stackNotes}\n\n`
    : '') +
  `Threat focus:\n${dim.finderPrompt}\n\n` +
  `Known findings — do NOT re-report any of these:\n${LEDGER_DIGEST}\n\n` +
  `Read the ACTUAL code in ${REPO}. Report every grounded finding with exact file:line and a concrete exploit_scenario. ` +
  `If a control is correctly implemented, do NOT report it as a finding (you may note a notably strong control as a single info-level finding). ` +
  `An empty findings array is valid ONLY after you have actually read the targets under ${REPO} and found nothing real — never return empty because you could not locate the repository (it is at ${REPO}, audit it). Do not invent findings. Return your findings.`

// ===== BEGIN PURE REACHABILITY RENDERER =====
// Render a machine-verified reachability path ({ source, intermediate[], sink } — locations
// only, the shape ingest-scanner-findings.mjs attaches) to ONE compact line:
//   source <file>:<line> → <file>:<line> → … → sink <file>:<line>
// Accepts a finding (reads its `reachabilityPath` attribute) or a bare path object. PURE +
// TOTAL: locations only (the attribute carries no content strings by design); '' on an
// absent / malformed / one-ended input — a path is relayed only when BOTH proven ends are
// present — and it NEVER throws. A malformed middle step is skipped; the proven ends stand.
// This block is kept byte-identical (minus `export`) between harness/finding-clusters.mjs
// (the importable home) and harness/workflow-template.mjs (self-contained — it cannot
// import); acceptance/test-coverage-accounting.mjs enforces the parity.
function renderReachabilityPath(input) {
  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x)
  const loc = (s) =>
    isObj(s) && typeof s.file === 'string' && s.file !== '' && Number.isInteger(s.line) && s.line >= 1
      ? `${s.file}:${s.line}`
      : null
  const p = isObj(input) ? (isObj(input.reachabilityPath) ? input.reachabilityPath : input) : null
  if (!p) return ''
  const source = loc(p.source)
  const sink = loc(p.sink)
  if (!source || !sink) return '' // BOTH proven ends or nothing — never a one-ended "path"
  const middle = (Array.isArray(p.intermediate) ? p.intermediate : []).map(loc).filter(Boolean)
  return ['source ' + source, ...middle, 'sink ' + sink].join(' → ')
}
// ===== END PURE REACHABILITY RENDERER =====

// 0.8.71: when a finding carries a machine-verified `reachabilityPath`, the FINDING block
// below relays it — the deterministic taint engine already proved WHERE the path runs, so
// the verifier's skepticism is pointed at the one question the engine cannot answer (is the
// SOURCE attacker-controlled / untrusted), instead of re-deriving the path. A finding with
// no path renders a byte-identical FINDING block (strictly additive).
// ===== BEGIN PURE VERIFIER PROMPT =====
// Extracted VERBATIM by acceptance/test-coverage-accounting.mjs (the PURE COVERAGE HELPERS
// slice pattern above): a pure template of (dim, f) — CONTEXT and REPO are its only
// module-level reads (the test injects stubs); renderReachabilityPath is the block above.
const verifierPrompt = (dim, f) =>
  `${CONTEXT}\n\n## Adversarial verification\n\n` +
  `A finder in the '${dim.key}' dimension reported the finding below. Your job is to REFUTE it if you can. ` +
  `Read the actual code at the cited location AND every control that gates the claimed path (auth dependency, tenant-isolation policy, scope check, input validation, constant-time compare, nonce handling — whatever applies to the claim). ` +
  `Default to skepticism: many findings are false positives because a control elsewhere already prevents them, OR because the behavior is intentional and spec-correct — e.g., loopback redirect URIs on a native-client OAuth flow are REQUIRED by RFC 8252; flagging them is itself an error. ` +
  `Confirm only if the issue is genuinely real AS SHIPPED. For a code-exploit finding that means the exploit is reachable in the real code. But for a DECLARATION-level package/metadata violation (a component apiVersion, an isExposed flag, an http:// or wildcard trusted-host entry, position:absolute/fixed in component CSS, an onClickJavaScript weblink, confirmationTokenRequired) it means the offending declaration is actually present in the shipped package — the Salesforce static review flags what the package SHIPS to every subscriber org, so "no live caller / dormant config / not currently reachable / shadow-DOM isolates it" LOWERS the severity, it does NOT make the finding a false positive. Refute a declaration-level violation only when a §6 false-positive pattern below actually matches.\n\n` +
  `FINDING:\n- title: ${f.title}\n- severity: ${f.severity}\n- file: ${f.file}\n- description: ${f.description}\n- exploit_scenario: ${f.exploit_scenario}` +
  (renderReachabilityPath(f)
    ? `\n- reachability_path: ${renderReachabilityPath(f)}  [machine-verified by the deterministic taint engine — the PATH is not in question; your ONLY open question is whether the SOURCE is attacker-controlled / untrusted and no upstream control sanitizes it before the sink]`
    : '') +
  `\n\n` +
  (dim.verifierNotes
    ? `Dimension-specific verifier guidance for '${dim.key}' (the dimension author's refute rules — these take PRECEDENCE over the generic skepticism above wherever they conflict; for this dimension's declaration-level violations the §6 false-positive patterns are the ONLY valid grounds to refute):\n${dim.verifierNotes}\n\n`
    : '') +
  `Read ${REPO}/${String(f.file || '').split(':')[0]} and any code that gates the claimed path. Return your verdict with the exact code evidence that decides it.`
// ===== END PURE VERIFIER PROMPT =====

// ---------------------------------------------------------------------------
// Find + Verify — pipeline over dimensions: stage 1 is the finder, stage 2
// fans out one verifier per finding via parallel(). The verify fan-out for
// dimension N overlaps the find stage of dimension N+1.
// ---------------------------------------------------------------------------
phase('Find')
log(
  `Pass ${PASS} (${TIER}, ${RUN_DATE}): auditing ${ARGS.dimensions.length} dimensions — ` +
    ARGS.dimensions.map((d) => d.key).join(', ')
)

const perDimension = await pipeline(
  ARGS.dimensions,
  // Stage 1: find. Read-only agent — the audit must never mutate the repo.
  (dim) =>
    agent(finderPrompt(dim), {
      label: `find:${dim.key}`,
      phase: 'Find',
      schema: FINDING_SCHEMA,
      agentType: 'Explore',
    }),
  // Stage 2: adversarially verify each finding from this dimension. Each
  // verifier is a fresh context: it gets the finding, never the finder's
  // reasoning — independence is what earns the precision.
  (result, dim) => {
    // BUG-A: a CRASHED finder (agent() hit the StructuredOutput retry cap → returns null, does
    // NOT throw) yields no findings array. That is a COVERAGE FAILURE, not a clean "found
    // nothing" — emit a marker so computeCoverage surfaces it as "re-run this dimension" instead
    // of silently contributing 0 findings AND 0 unverified. A non-null result WITH a findings
    // array (even an empty one) is a genuine clean find.
    const cleanFind = result && typeof result === 'object' && Array.isArray(result.findings)
    if (!cleanFind) return [{ dimension: dim.key, coverageFailed: true, verdict: null }]
    const findings = result.findings
    if (!findings.length) return []
    return parallel(
      findings.map((f) => async () => {
        const opts = {
          label: `verify:${dim.key}:${String(f.title || '').slice(0, 28)}`,
          phase: 'Verify',
          schema: VERDICT_SCHEMA,
          agentType: 'Explore',
        }
        let v = null
        try {
          v = await agent(verifierPrompt(dim, f), opts)
        } catch (err) {
          // §3.3: re-queue a failed verifier exactly once; a second failure
          // makes the finding "unverified — re-run", never a reported finding.
          try {
            v = await agent(verifierPrompt(dim, f), { ...opts, label: `${opts.label}:retry` })
          } catch (err2) {
            v = null
          }
        }
        if (!v || !v.verdict) return { ...f, dimension: dim.key, verdict: null }
        return { ...f, dimension: dim.key, verdict: v }
      })
    )
  }
)

// Barrier: every dimension found + verified before synthesis. computeCoverage reconciles the
// raw per-dimension output (BEFORE any .filter(Boolean), so a wholly-dropped dimension is caught
// by index) and surfaces a crashed finder as a COVERAGE FAILURE instead of silently dropping its
// coverage — distinct from a dimension that ran clean and found nothing (BUG-A). Same pure code
// path as acceptance/test-coverage-accounting.mjs.
const coverage = computeCoverage(perDimension, ARGS.dimensions)
const all = coverage.all
const unverified = coverage.unverified
const verified = coverage.verified
const confirmed = coverage.confirmed
const refuted = coverage.refuted
const coverageFailed = coverage.coverageFailed

log(
  `${all.length} candidate findings; ${confirmed.length} confirmed/partial, ${refuted.length} refuted` +
    (unverified.length ? `, ${unverified.length} UNVERIFIED (re-run these; they are never reported as findings)` : '') +
    (coverageFailed.length
      ? `; ${coverageFailed.length} dimension(s) had a coverage FAILURE (finder crashed) — re-run: ${coverageFailed.join(', ')}`
      : '')
)

// ---------------------------------------------------------------------------
// Synthesize — confirmed/partial only; refuted entries live only in the ledger.
// ---------------------------------------------------------------------------
phase('Synthesize')

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
const rank = (s) => (SEVERITY_RANK[s] !== undefined ? SEVERITY_RANK[s] : 9)
const confirmedForReport = confirmed
  .map((f) => ({
    title: f.title,
    dimension: f.dimension,
    finder_severity: f.severity,
    adjusted_severity: f.verdict.adjusted_severity,
    verdict: f.verdict.verdict,
    file: f.file,
    description: f.description,
    exploit_scenario: f.exploit_scenario,
    recommendation: f.recommendation,
    verdict_reasoning: f.verdict.reasoning,
    evidence: f.verdict.evidence,
  }))
  .sort((a, b) => rank(a.adjusted_severity) - rank(b.adjusted_severity))

const report = await agent(
  `${CONTEXT}\n\n## Synthesis\n\n` +
    `Below are the ADVERSARIALLY-VERIFIED findings for pass ${PASS} (confirmed_real / partially_real only; false positives were dropped by verification and live only in the audit ledger). ` +
    `Write the pass report to ${REPORT_PATH} with exactly these sections (audit-methodology.md §9):\n\n` +
    `1. Executive summary — is the audited surface ready for the review? Blocking items (critical/high) vs hardening (medium/low), stated plainly. Call out anything on a cross-tenant or privileged-surface path explicitly.\n` +
    `2. Prioritized findings table — adjusted_severity | dimension | title | file:line | one-line fix; sorted critical→low; dedupe overlapping findings across dimensions IN THE TABLE only (the ledger keeps every entry).\n` +
    `3. Remediation plan per critical/high finding — short and concrete.\n` +
    `4. Strong controls observed — from the info-level entries; written for reuse in the reviewer-facing artifacts.\n` +
    `5. Coverage and residual risk — dimensions run this pass: ${ARGS.dimensions.map((d) => d.key).join(', ')} (tier: ${TIER}). State plainly that dimensions NOT in this list were not audited in this pass; that this was static code review by LLM agents — not DAST, not a penetration test; that verification controls false positives, not false negatives (say "no confirmed findings within the audited dimensions", never "secure" or "clean"); and that Salesforce performs its own penetration testing regardless of submitted evidence.\n` +
    (coverageFailed.length
      ? `   COVERAGE FAILURE — state this LOUDLY in section 5 and reflect it in the executive summary: the FINDER for these dimension(s) CRASHED this pass and produced NO findings, so coverage is INCOMPLETE (NOT clean) for them: ${coverageFailed.join(', ')}. These dimensions MUST be re-run; do NOT present the pass as complete or these dimensions as audited/clean.\n`
      : '') +
    `6. Readiness-tracker mapping — each finding tagged to its tracker category (authn/authz, tenant isolation, injection, headers/TLS, secrets, rate-limit/DoS, info-disclosure, crypto, background-jobs, data-export, outbound).\n\n` +
    `Also return the executive summary and the findings table inline.\n\n` +
    `VERIFIED FINDINGS (JSON):\n${JSON.stringify(confirmedForReport, null, 2)}`,
  { label: 'synthesize', phase: 'Synthesize' }
)

// ---------------------------------------------------------------------------
// Structured results — everything the invoking skill's MECHANICAL ledger merge
// needs. ledger_updates carries confirmed AND refuted entries: refuted entries
// stop the next pass's finders from re-raising the same non-issue, and their
// reasoning/evidence is reusable verbatim in the false-positive dossier.
// Verdict→state mapping (confirmed_real/partially_real → confirmed,
// false_positive → refuted) happens in the skill, not here.
// ---------------------------------------------------------------------------
return {
  pass: PASS,
  tier: TIER,
  run_date: RUN_DATE,
  dimensions_run: ARGS.dimensions.map((d) => d.key),
  total_candidates: all.length,
  confirmed: confirmed.length,
  refuted: refuted.length,
  unverified: unverified.map((f) => ({ title: f.title, file: f.file, dimension: f.dimension })),
  // BUG-A: dimensions whose finder CRASHED (no findings produced) — coverage is INCOMPLETE, not
  // clean. The mechanical merge (merge-ledger.mjs) carries these into the pass object + the recap
  // so the run never reads as a clean verdict over a crashed dimension; re-run them (step 8).
  coverage_failed: coverageFailed,
  report_path: REPORT_PATH,
  ledger_updates: verified.map((f) => ({
    title: f.title,
    file: f.file,
    dimension: f.dimension,
    verdict: f.verdict.verdict,
    finder_severity: f.severity,
    adjusted_severity: f.verdict.adjusted_severity,
    confidence: f.confidence,
    description: f.description,
    exploit_scenario: f.exploit_scenario,
    recommendation: f.recommendation,
    verdict_reasoning: f.verdict.reasoning,
    evidence: f.verdict.evidence,
  })),
  report,
}

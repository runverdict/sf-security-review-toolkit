/*
 * artifact-workflow-template.mjs — the parameterized multi-agent ARTIFACT-DRAFTING
 * workflow (sf-security-review-toolkit/harness).
 *
 * Execution substrate for /sf-security-review-toolkit:generate-artifacts when the
 * Workflow tool is available — the P2 analog of harness/workflow-template.mjs (the
 * audit substrate). It mirrors that file EXACTLY in shape: everything product- and
 * run-specific arrives as DATA injected by harness/build-artifact-engine.mjs; the
 * body is fixed, tested, shipped code. This ENDS the pre-P2 hazard where the driver
 * hand-authored a Workflow script per run with inline prompt strings (focus text,
 * nested backticks, regex) and tripped on JS-escaping/parse errors — the same class
 * the audit phase already retired by moving scope into scope-input.json.
 *
 * WHAT RUNS HERE — one DRAFT pass:
 *   - DRAFT: one read-only agent per artifact. Each agent fills its pre-read
 *     template (a.templateContent) from the ACTUAL code under repoRoot, honoring
 *     its per-artifact content contract (a.focus) and the SHARED AUTHORITATIVE
 *     FACTS (ARGS.facts) — so every cross-cutting claim (tool counts, identity
 *     model, session-ID posture, hosts/regions, data classes) agrees across the
 *     set BY CONSTRUCTION (a contradiction between artifacts is the failure
 *     reviewers exploit first).
 *   - RETURN: the drafted content per artifact. Agents are READ-ONLY and never
 *     write — the Workflow runtime has no filesystem access, so the invoking skill
 *     writes each `out` to disk afterwards (same return-then-write shape as the
 *     audit substrate's report return).
 *
 * GATE ENFORCEMENT lives in build-artifact-engine.mjs (the assembler): a
 * gate-suppressed artifact (e.g. authn-authz-flow over an open authN/authZ
 * critical/high) is DROPPED before injection, so a withheld doc PHYSICALLY cannot
 * be drafted here. The driver writes the WITHHELD placeholder separately.
 *
 * HOW generate-artifacts INVOKES THIS TEMPLATE
 *   1. Run the gate (harness/artifact-gate.mjs), select the artifact set, capture
 *      the live surface + mine the controls narrative → assemble them as DATA.
 *   2. Write artifact-input.json = { artifacts:[{key,tmpl,out,focus}], facts, gate }.
 *      The per-artifact `focus` (content contract) and the shared `facts` live in
 *      DATA — never in JS — so the escaping class is gone.
 *   3. node build-artifact-engine.mjs --plugin … --repo … --input … — it reads each
 *      template, validates the focus, DROPS gate-suppressed artifacts, and injects
 *      { repoRoot, runDate, facts, artifacts:[{key,tmpl,templateContent,out,focus}] }
 *      into a copy of THIS file at the `/* {{ARGS_OBJECT}} *\/ null` marker, written
 *      to <repo>/.security-review/artifact-engine.mjs.
 *   4. Invoke the Workflow tool with scriptPath = that injected copy (NOT args — in
 *      practice args arrive as a JSON STRING, args.repoRoot is undefined, and this
 *      script falls through to the null placeholder and fails fast). On return,
 *      write each drafted.content to its drafted.out, then run the step-12 cross-read
 *      and the provenance footers driver-side.
 *
 * RUN-ARGS SHAPE (everything run-specific lives here, nothing in the body)
 *   {
 *     repoRoot: "/abs/path/to/partner/repo",
 *     runDate:  "YYYY-MM-DD",   // passed in — the Workflow runtime restricts Date.now()
 *     facts:    "the shared authoritative facts string (tool inventory, identity
 *                model, session-ID posture, hosts/regions, data classes, controls
 *                narrative) — the single source of truth every artifact reconciles to",
 *     artifacts: [
 *       { key:             "authn-authz-flow",
 *         tmpl:            "authn-authz-flow.md.tmpl" | null,
 *         templateContent: "the pre-read template body (build-artifact-engine read it)",
 *         out:             "docs/security-review/authn-authz-flow.md",
 *         focus:           "the per-artifact content contract (what this doc must
 *                           contain) — lives in DATA, never in JS" }
 *     ]
 *   }
 */

export const meta = {
  name: 'generate-artifacts',
  description:
    'Multi-agent drafting of the AppExchange/AgentExchange security-review submission artifacts from the partner codebase',
  phases: [
    { title: 'Draft', detail: 'one agent per artifact from its template + the repo + the shared authoritative facts' },
  ],
}

// ---------------------------------------------------------------------------
// Run args — injected by build-artifact-engine.mjs (see header). Fail loud if
// absent: a default-filled run would draft nothing, or draft over a withheld doc.
// ---------------------------------------------------------------------------
const INJECTED = /* {{ARGS_OBJECT}} */ null
const ARGS = typeof args !== 'undefined' && args && args.repoRoot ? args : INJECTED

if (!ARGS || typeof ARGS.repoRoot !== 'string' || !Array.isArray(ARGS.artifacts) || ARGS.artifacts.length === 0) {
  throw new Error(
    'artifact-workflow-template.mjs: run args missing or incomplete. The invoking skill must replace the ' +
      '`/* {{ARGS_OBJECT}} */ null` placeholder with the JSON run-args object (or the runtime must bind `args`). ' +
      'Required: repoRoot (string), artifacts (non-empty array). Assemble via harness/build-artifact-engine.mjs.'
  )
}
for (const a of ARGS.artifacts) {
  if (!a || !a.key || !a.out || typeof a.focus !== 'string' || !a.focus.trim()) {
    throw new Error(
      'artifact-workflow-template.mjs: artifact entry missing key/out/focus: ' + JSON.stringify(a).slice(0, 200)
    )
  }
}

const REPO = ARGS.repoRoot
const RUN_DATE = ARGS.runDate || 'unknown-date'
const FACTS = (ARGS.facts && String(ARGS.facts).trim()) || '(no shared facts provided — draft from the repo alone)'

// ---------------------------------------------------------------------------
// Shared context — identical for every drafting agent in the run, so every
// cross-cutting claim reconciles against ONE source of truth.
// ---------------------------------------------------------------------------
const CONTEXT =
  `You are drafting an AppExchange/AgentExchange security-review submission artifact for the partner ` +
  `product, from the AS-BUILT code at ${REPO} (run date ${RUN_DATE}). The governing rule: generate from ` +
  `the actual code, config, and metadata — NEVER from design docs or memory (CONVENTIONS §2). The reviewer ` +
  `reads these artifacts and then attacks exactly what they describe; a claim the live system contradicts ` +
  `costs more than an honestly documented gap. Every claim is either traceable to code you READ (path:line) ` +
  `or marked owner-input; leave unfilled {{SLOTS}} visible.\n\n` +
  `REPOSITORY ANCHOR — non-negotiable: the ONLY codebase in scope is rooted at ${REPO}. Every file you read ` +
  `and every cited path MUST be under ${REPO}. Do NOT read any .security-review/ file, and do NOT inspect ` +
  `any path OUTSIDE ${REPO} — ignore your current working directory when it differs.\n\n` +
  `SHARED AUTHORITATIVE FACTS — the single source of truth every artifact in this run reconciles against, so ` +
  `the set is cross-consistent BY CONSTRUCTION (a contradiction between artifacts is the failure reviewers ` +
  `exploit first):\n${FACTS}`

const draftPrompt = (a) =>
  `${CONTEXT}\n\n## Draft this artifact: ${a.key}  →  ${a.out}\n\n` +
  `What this artifact MUST contain (its content contract — follow it exactly):\n${a.focus}\n\n` +
  (a.templateContent
    ? `Fill the TEMPLATE below: keep every heading and its structure, fill each section from code you actually ` +
      `read (path:line), leave any unfilled {{SLOT}} visible, and keep the provenance footer.\n` +
      `----- BEGIN TEMPLATE -----\n${a.templateContent}\n----- END TEMPLATE -----\n\n`
    : `(No template for this artifact — draft it per the content contract above, with a provenance footer.)\n\n`) +
  `Use the SHARED AUTHORITATIVE FACTS above as the source of truth for every cross-cutting claim (tool counts, ` +
  `the identity model, the session-ID posture, hosts/regions, data classes) so this artifact agrees with its ` +
  `siblings by construction. NEVER write a credential value into the artifact (CONVENTIONS §6) — name where it ` +
  `belongs (env var, vault) and keep it out. Agent-drafted means STATIC code reading — never describe it as a ` +
  `scan, DAST, or pen test. You are READ-ONLY: do NOT write any file. RETURN the complete drafted markdown ` +
  `content of ${a.out} as your result — the invoking skill writes it to disk (the Workflow runtime has no ` +
  `filesystem access).`

// ---------------------------------------------------------------------------
// Draft — one read-only agent per artifact, in parallel. A thunk that throws
// resolves to null (filtered out); the skill re-runs any missing artifact.
// ---------------------------------------------------------------------------
phase('Draft')
log(`Drafting ${ARGS.artifacts.length} artifact(s): ${ARGS.artifacts.map((a) => a.key).join(', ')}`)

const drafted = await parallel(
  ARGS.artifacts.map((a) => async () => {
    const content = await agent(draftPrompt(a), { label: `draft:${a.key}`, phase: 'Draft', agentType: 'Explore' })
    return { key: a.key, out: a.out, content }
  })
)

return { drafted: drafted.filter(Boolean) }

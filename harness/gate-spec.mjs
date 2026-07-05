#!/usr/bin/env node
/*
 * gate-spec.mjs — the FROZEN catalog of operator-facing consent/election gates +
 * a PURE selector. The substrate that PINS every `AskUserQuestion` gate so its
 * option SET is fixed and only the DATA varies (WI-00A of the presentation-
 * consistency roadmap).
 *
 * WHY THIS EXISTS. The findings engine is deterministic, but the in-skill gate
 * option sets were driver-improvised prose. A cold campaign caught the drift: the
 * SAME depth gate offered with a different option set run-to-run (run 1 hard-
 * removed Exhaustive → {Standard, Quick}; run 2 offered it → {Standard, Quick,
 * Exhaustive}), and the tier re-asked in audit-codebase after the journey already
 * collected it. A gate whose options the model re-invents each run reads like the
 * tool is making it up — corroding the exact trust the toolkit sells. The fix is
 * the repo's proven contract (ENGINE owns structure, driver supplies data),
 * applied to the gate class:
 *
 *   - the ENGINE owns the option set (this catalog);
 *   - the driver renders options[].label/description VERBATIM and pipes the chosen
 *     option's `decision` straight into record-consent.mjs --decision.
 *
 * Mirrors three shipped patterns:
 *   - build-audit-engine.mjs ALWAYS_ON — the safe-default decline option is
 *     FORCE-INJECTED on every consent gate, regardless of caller input, so a
 *     driver that lists only the affirmative options cannot drop the decline.
 *   - build-artifact-engine.mjs FOCUS_MIN — FAIL CLOSED: throw on an unknown gate
 *     id or any option missing label/description/decision (or a decision that is
 *     not a valid record-consent token), so a driver that improvises options
 *     cannot proceed.
 *   - applicable-requirements.mjs computeApplicable — the selector is a PURE
 *     function of (gateId, facts): no LLM, no network, no FS in the core,
 *     byte-identical on re-run. (The CLI's --target convenience is the only FS
 *     read, mirroring applicable-requirements' --target manifest read.)
 *
 * A valid record-consent decision token is EXACTLY 'affirm' or 'deny' (see
 * record-consent.mjs recordConsent's opts.decision). Every option therefore
 * carries decision ∈ {affirm, deny}; the driver hands that token to
 * `record-consent.mjs --decision <token>` so a controlled selection is never
 * re-scanned by the free-text regex.
 *
 * USAGE
 *   node gate-spec.mjs --gate <id> [--facts facts.json] [--target <repo>] [--scanners "n:m,…"]
 *     prints the exact AskUserQuestion payload (+ per-option decision tokens) as JSON:
 *       { gate, consent, header, question, options:[{label, description, decision}] }
 *   --facts    a JSON file of detected facts the selector keys variants off.
 *   --target   a repo whose recorded consent ledger seeds the facts (audit-tier
 *              reads .security-review/consent/audit-tier.json to switch to the
 *              confirm-the-locked-tier variant — WI-02). Explicit --facts wins.
 *   --scanners scanner-install convenience: a "name:method,name:method" list (the
 *              tool-detect installable_missing set) → facts.scanners, so a driver
 *              with no file-write grant can render the gate without a facts.json.
 *              An explicit --facts.scanners wins over it.
 */
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// A valid record-consent decision token — exactly these two (record-consent.mjs).
const VALID_DECISIONS = new Set(['affirm', 'deny'])

// ── The FROZEN catalog ────────────────────────────────────────────────────────
// One entry per gate id. `consent: true` gates carry a `safeDefault` decline that
// the selector FORCE-INJECTS. Static option arrays are validated at module load
// (see assertCatalogWellFormed below) so a malformed catalog entry fails fast.
//
// The catalog registers every gate the journey renders: the run/tier/scanner
// election + consent gates, the scope-submission answer + consent gates, and the
// two live-op consents (throwaway-dast, sf-deep-audit-ops). The engine THROWS on
// any unregistered id (fail-closed), so a driver that improvises a gate id can
// never reach a live render.
const GATE_CATALOG = Object.freeze({
  // run-mode — an ELECTION (ask-tolerance), not a consent. Both options proceed;
  // there is no decline, so NO safe-default is injected. Pinned 2-option set.
  'run-mode': Object.freeze({
    consent: false,
    kind: 'election',
    header: 'Run mode',
    question: 'How should I run the review — fully autonomous, or pausing at each decision?',
    base: Object.freeze([
      Object.freeze({
        label: 'Full-auto',
        description:
          'Drive every phase end to end, pausing ONLY at the recorded consent gates (tier ' +
          'go-ahead, scan-tool install, any live op) and a genuinely audit-blocking gap. ' +
          'Best when you want the whole journey in one pass.',
        decision: 'affirm',
      }),
      Object.freeze({
        label: 'Guided',
        description:
          'Same phases and the same recorded consent gates, but I ALSO stop on each YELLOW ' +
          'ambiguity to confirm before continuing. Best for the first run on a new codebase.',
        decision: 'affirm',
      }),
    ]),
  }),

  // audit-tier — the CONSENT gate with a selector (WI-01 first-pass menu / WI-02
  // confirm-the-locked-tier variant). The option SET is identical every first-pass
  // run — that is the whole point: it kills the run-1-hid-Exhaustive / run-2-
  // offered-it drift. Exhaustive is OFFERED but never pre-selected.
  'audit-tier': Object.freeze({
    consent: true,
    kind: 'consent',
    header: 'Audit tier',
    question: 'Which audit depth, and go-ahead to launch the fan-out?',
    confirmHeader: 'Launch audit',
    firstPass: Object.freeze([
      Object.freeze({
        label: 'Standard (recommended)',
        description:
          'All applicable dimensions, one pass (~20–30 agents). The default first run — it ' +
          'yields the first batch of critical/high findings. Expect millions of tokens and an ' +
          'hour-plus of wall clock on a real codebase.',
        decision: 'affirm',
      }),
      Object.freeze({
        label: 'Exhaustive',
        description:
          'Multi-pass until two consecutive dry passes (~50–80 agents across passes). RESERVED ' +
          'FOR A RE-RUN — heavier, and better after the first round of fixes; offered, never ' +
          'pre-selected. Running it before the standard findings are fixed pays verifiers to ' +
          're-walk code that is about to change.',
        decision: 'affirm',
      }),
      Object.freeze({
        label: 'Quick (triage)',
        description:
          'Top-failure dimensions, one pass (~8–10 agents). Triage only — it catches the ' +
          'auto-fail classes but says nothing about the rest. Never present its output as ' +
          'review readiness.',
        decision: 'affirm',
      }),
    ]),
    safeDefault: Object.freeze({
      label: 'Cancel — do not launch',
      description:
        'Stop here and record no go-ahead. The fan-out physically cannot launch without a ' +
        'recorded affirmative tier consent, so nothing runs.',
      decision: 'deny',
    }),
  }),

  // scanner-install — the CONSENT gate for the one network-touching engine. The
  // install description is VERBATIM except {{N}} (count) and {{SCANNERS}} (the
  // name(method) list), which are the only fillable data, filled from a tool-detect
  // installable_missing set passed in facts.scanners.
  'scanner-install': Object.freeze({
    consent: true,
    kind: 'consent',
    header: 'Scanners',
    question: 'Install the missing scanners to a per-run temp dir for this run?',
    // The full sha256 / tmp-removed / evidence-kept / "this yes also covers RUNNING
    // them, which fetches rules" disclosure is FIXED; only {{N}} + {{SCANNERS}} fill.
    installTemplate:
      'Install {{N}} missing scanner(s) — {{SCANNERS}} — into a per-run temp dir OUTSIDE your ' +
      'repo. Raw-binary downloads are sha256-verified against an author-pinned checksum before ' +
      'the file is ever made executable; the temp dir is removed at cleanup while the scan ' +
      'evidence is kept. This yes ALSO authorizes RUNNING the scanners, which fetches their ' +
      'rule packs from the network.',
    safeDefault: Object.freeze({
      label: 'Skip — no install',
      description:
        'Skip the network install. Those scan families fall to PENDING-OWNER-RUN; nothing is ' +
        'fetched and no scanner runs.',
      decision: 'deny',
    }),
  }),

  // ── Slice 5 (WI-05/30/31/32/06) — the scope-submission gates ──────────────────
  // TWO semantic classes live below; the `kind` field encodes which (validated at load):
  //   - kind:'consent' — a real CONSENT-to-act (mcp-probe, scope-confirm): the safe-default
  //     decline is FORCE-INJECTED and the chosen option's `decision` pipes to record-consent.
  //   - kind:'answer'  — an operator QUESTION whose SELECTED option is RECORDED into the scope
  //     manifest (partner-program, clarify-detection, listing-type, tenancy): NO force-injected
  //     decline, NOT piped to record-consent. The option set is still pinned so it renders
  //     verbatim run-to-run; the `decision` token is the recorded POLARITY (affirm = the
  //     present/yes/selected value, deny = the absent/no value) — never a consent-to-act.
  // (`kind:'election'` — run-mode — is the third, pre-existing class: both options proceed.)

  // mcp-probe (WI-30/INV-30) — CONSENT to a live read-only handshake. Probing a URL is a real
  // outbound action; the operator's choice of staging-vs-production IS the environment
  // confirmation scope-submission step 3 requires, so a production endpoint is never probed
  // silently. {{URL}} is the only fillable datum; a function-replacer renders a $-bearing URL
  // literally (the scanner-install lesson).
  'mcp-probe': Object.freeze({
    consent: true,
    kind: 'consent',
    header: 'Probe MCP endpoint',
    question: 'Confirm this endpoint and its environment before the read-only MCP handshake.',
    probeTemplate: Object.freeze({
      staging:
        'Confirm {{URL}} is a STAGING endpoint and run the read-only initialize + tools/list ' +
        'handshake. The handshake itself is read-only, but the endpoints recorded here become the ' +
        'DAST target list three phases later — the environment label rides with them.',
      production:
        'Confirm {{URL}} is a PRODUCTION endpoint and run the read-only handshake. Production is ' +
        'probed ONLY with this explicit confirmation, never silently — an unlabeled production URL ' +
        'becomes a production DAST scan downstream.',
    }),
    safeDefault: Object.freeze({
      label: 'Skip — do not probe',
      description:
        'Record the MCP facts from code as "probed": false and move on. Nothing is fetched and no ' +
        'live handshake runs; downstream skills re-probe under their own consent.',
      decision: 'deny',
    }),
  }),

  // scope-confirm (WI-06/INV-06) — the final manifest CONSENT, mirroring the WI-02 audit-tier
  // confirm variant: {Confirm & proceed (default), Correct the scope, Cancel}. 'Correct the
  // scope' is a NAVIGATION branch the driver detects by LABEL (re-open scope-submission); its
  // decision is 'deny' as the FAIL-SAFE, exactly like WI-02's 'Change tier' — neither it nor
  // the force-injected Cancel ever authorizes a proceed.
  'scope-confirm': Object.freeze({
    consent: true,
    kind: 'consent',
    header: 'Confirm scope',
    question: 'The scope manifest is written. Confirm it and proceed, correct the scope, or cancel?',
    base: Object.freeze([
      Object.freeze({
        label: 'Confirm scope & proceed (recommended)',
        description:
          'Accept the manifest as the input contract for every downstream phase. This is the cheapest ' +
          'moment to fix scope — every later phase multiplies an error here (the audit fans out against ' +
          'the wrong surface set; the DAST scope comes up narrower than the architecture diagram).',
        decision: 'affirm',
      }),
      Object.freeze({
        label: 'Correct the scope',
        description:
          'Re-open scope-submission to fix an element, endpoint, gate answer, or listing field before ' +
          'anything is audited. Nothing proceeds until you re-confirm the corrected manifest.',
        decision: 'deny',
      }),
    ]),
    safeDefault: Object.freeze({
      label: 'Cancel — do not proceed',
      description:
        'Stop here and record no scope confirmation. No downstream phase runs without a recorded ' +
        'confirmation, so nothing proceeds.',
      decision: 'deny',
    }),
  }),

  // partner-program (WI-05/INV-05) — the SIX preflight ANSWER gates (baseline
  // process-partner-program-prerequisites). facts.subGate selects which; each renders a FIXED
  // Yes/No question whose answer is RECORDED into manifest operatorConfirmed.<key>. The
  // 'promoted' sub-gate adds an N/A option ONLY when facts.noPackage is set (no package element →
  // promotion does not apply). Definitions live in PARTNER_PROGRAM_SUBGATES below.
  'partner-program': Object.freeze({
    consent: false,
    kind: 'answer',
    header: 'Partner program',
    question: 'Partner-program preflight gate.',
  }),

  // clarify-detection (WI-31/INV-31) — the NEED-FROM-YOU gate for an AMBIGUOUS element (step 2's
  // two failure modes: an undetected element silently drops a dimension; an over-detected MCP
  // client config drags in a whole track). ASK rather than omit. facts.element names the element;
  // the answer adjusts the detected-element set. ANSWER gate — recorded, not consent.
  'clarify-detection': Object.freeze({
    consent: false,
    kind: 'answer',
    header: 'Clarify detection',
    questionTemplate:
      'Detection is ambiguous for "{{ELEMENT}}". Confirm it rather than omit — an undetected element ' +
      'silently drops its whole audit dimension, and an over-detected one drags in a track that does not exist.',
    opts: Object.freeze({
      present:
        'Confirm "{{ELEMENT}}" IS part of the submission. It is added to the detected element set and its ' +
        'audit dimension runs.',
      absent:
        'Confirm "{{ELEMENT}}" is NOT part of the submission; it stays out of scope. (A Named Credential ' +
        "pointing at someone else's MCP server makes the partner a client, not a server operator — no " +
        'mcp-server element is added.)',
      unsure:
        'Do not record either way — flag "{{ELEMENT}}" for investigation. The safe default when you cannot ' +
        'confirm: an un-investigated guess is exactly what drops a dimension or fabricates a track.',
    }),
  }),

  // listing-type (WI-32/INV-32) — the CLOSED-choice listing type. A CATEGORICAL answer gate:
  // every option is a valid recorded selection (all 'affirm'), the driver records the chosen
  // LABEL into manifest listingType. The free-text security-model CLAIMS stay free-text (recorded
  // as claims, never pinned — per the WI-32 boundary).
  'listing-type': Object.freeze({
    consent: false,
    kind: 'answer',
    header: 'Listing type',
    question: 'What is the listing type? (drives which submission track applies)',
    base: Object.freeze([
      Object.freeze({
        label: 'Managed package',
        description:
          'An installable managed 2GP only — the package-scanning track (Code Analyzer, package metadata, ' +
          'permission sets).',
        decision: 'affirm',
      }),
      Object.freeze({
        label: 'MCP server',
        description:
          'An external MCP server only — the endpoint/DAST + MCP-surface track. Note: every AgentExchange ' +
          'listing is ALSO an installable managed package, so if any package ships, pick "Both".',
        decision: 'affirm',
      }),
      Object.freeze({
        label: 'Both',
        description:
          'A managed package AND an external MCP server — BOTH tracks. The common AgentExchange case: a thin ' +
          'registration package plus the server it registers.',
        decision: 'affirm',
      }),
    ]),
  }),

  // tenancy (WI-32/INV-32) — the CLOSED-choice tenancy model (drives the tenant-isolation
  // dimension). A CATEGORICAL answer gate: both options 'affirm', the chosen LABEL recorded into
  // manifest securityModelClaims.tenancy.
  'tenancy': Object.freeze({
    consent: false,
    kind: 'answer',
    header: 'Tenancy',
    question: 'What is the tenancy model? (drives the tenant-isolation audit dimension)',
    base: Object.freeze([
      Object.freeze({
        label: 'Multi-tenant',
        description:
          'One deployment serves multiple customer orgs — tenant-isolation is a primary, high-stakes audit ' +
          'dimension (cross-tenant leakage is an auto-fail class).',
        decision: 'affirm',
      }),
      Object.freeze({
        label: 'Single-tenant per deployment',
        description:
          'Each customer gets an isolated deployment — cross-tenant leakage is structurally limited, but ' +
          'per-deployment hardening (secrets, auth, egress) still applies.',
        decision: 'affirm',
      }),
    ]),
  }),

  // ── Live-op consents — the "reach outside read-only-local" gates ───────────────
  // The two highest-stakes CONSENT gates in the toolkit: they authorize actions
  // that LEAVE the read-only, local-only posture — standing up a throwaway and
  // active-scanning it (throwaway-dast), and mutating a live org through the
  // deployed-package deep audit (sf-deep-audit-ops). Both are CONSENT gates: a
  // single affirm option in `base`, the decline FORCE-INJECTED from safeDefault.
  // Enforcement already keys off the gate-name STRING (record-consent, verifyConsent,
  // the sf-ops hook, the --consent verifiers), so pinning here is purely additive to
  // the render path — it only fixes the operator-facing option text so the gate
  // renders verbatim run-to-run; recording/verification is unchanged.

  // throwaway-dast — CONSENT to stand up a DISPOSABLE stack and active-scan it. The
  // affirm authorizes the whole isolated lifecycle (stand up → capture OpenAPI →
  // active scan → tear down); nothing touches the real deployment. Deny → the DAST
  // families fall to PENDING-OWNER-RUN for the owner to run — DAST does not silently vanish.
  'throwaway-dast': Object.freeze({
    consent: true,
    kind: 'consent',
    header: 'Throwaway DAST',
    question: 'Stand up an isolated throwaway of the app and active-scan it for this run?',
    base: Object.freeze([
      Object.freeze({
        label: 'Stand up a throwaway & scan it',
        description:
          'Stand up an ISOLATED throwaway of the app on a loopback port, capture its OpenAPI, run the ' +
          'active DAST scan against that disposable instance, then tear it down. Nothing touches your real ' +
          'deployment — the scan only ever hits the throwaway, which is destroyed at cleanup.',
        decision: 'affirm',
      }),
    ]),
    safeDefault: Object.freeze({
      label: 'Skip — no throwaway, no active scan',
      description:
        'Do not stand anything up and run no active scan. The DAST families fall to PENDING-OWNER-RUN for ' +
        'you to run yourself against your own environment; nothing is stood up and nothing is scanned.',
      decision: 'deny',
    }),
  }),

  // sf-deep-audit-ops — the UMBRELLA consent for the deployed-package deep audit's
  // live org-mutating ops. ONE affirm authorizes the whole set (scratch/sandbox
  // create, package install/deploy/uninstall, org & data delete, package version
  // create) across ALL FOUR calling skills — the throwaway org is torn down after.
  // Deny → source audit only; no live org is touched. It is deliberately an umbrella,
  // not scoped to one op, so a single go-ahead covers the deep-audit lifecycle.
  'sf-deep-audit-ops': Object.freeze({
    consent: true,
    kind: 'consent',
    header: 'Deep-audit live ops',
    question: 'Authorize the live, org-mutating operations of the deployed-package deep audit?',
    base: Object.freeze([
      Object.freeze({
        label: 'Authorize the deep-audit live ops',
        description:
          'Authorize the live, org-mutating operations the deployed-package deep audit needs — create a ' +
          'throwaway scratch/sandbox org, install/deploy/uninstall the package, delete org and test data, and ' +
          'create a package version — all against a DISPOSABLE org that is torn down afterwards. This one ' +
          'go-ahead is the umbrella for every deep-audit skill; decline and the audit stays source-only.',
        decision: 'affirm',
      }),
    ]),
    safeDefault: Object.freeze({
      label: 'Skip — source audit only',
      description:
        'Do not run any live org operation. The deep audit is skipped and the review proceeds against the ' +
        'source only; no org is created, installed into, mutated, or deleted.',
      decision: 'deny',
    }),
  }),
})

// The SIX partner-program preflight sub-gates (scope-submission step 5 / baseline
// process-partner-program-prerequisites), in the step-5 order. Each is a FIXED Yes/No ANSWER
// gate; `manifestKey` is the manifest operatorConfirmed.<key> the driver records the answer into;
// the `yes`/`no` clauses carry the FIXED "why it blocks" reasoning. The selector renders
// Yes→affirm / No→deny; the 'promoted' gate adds the `na` option only when no package element.
const PARTNER_PROGRAM_SUBGATES = Object.freeze({
  agreement: Object.freeze({
    header: 'Partner agreement',
    manifestKey: 'partnerAgreementSigned',
    question: 'Is your partner agreement signed and active?',
    yes: 'The partner agreement is signed and program enrollment is active.',
    no: 'Not signed/active. Nothing can be submitted without program enrollment — this blocks the whole submission.',
  }),
  pbo: Object.freeze({
    header: 'Partner Business Org',
    manifestKey: 'partnerConsoleAccess',
    question: 'Does a Partner Business Org (PBO) exist, and do you have Partner Console access?',
    yes: 'A PBO exists and you can reach the Partner Console.',
    no: 'No PBO / no Console access. The Security Review Wizard lives in the Partner Console — without it there is nowhere to submit.',
  }),
  promoted: Object.freeze({
    header: 'Package promoted',
    manifestKey: 'packagePromoted',
    question: 'Is the package version promoted/released? (a beta 2GP cannot be submitted)',
    yes: 'The package version is promoted/released. If step 4 ran, sf-autoresolve.json already carries IsReleased — this confirms it.',
    no: 'Not promoted (still beta). The review attaches to a RELEASED version; a beta 2GP is rejected at intake.',
    na: 'No package element is in scope (an MCP-server-only or external-app listing), so package promotion does not apply. Recorded as not-applicable, never a blocker.',
  }),
  namespace: Object.freeze({
    header: 'Namespace',
    manifestKey: 'namespaceRegisteredAndLinked',
    question: 'Is the namespace registered and linked to the Dev Hub?',
    yes: 'Registered and linked. (Step 4 can READ the linked namespace; REGISTRATION stays a manual DevHub "Link Namespace" action — NamespaceRegistry is not API-writable.)',
    no: 'Not registered/linked. Packaging and listing identity both hang off the namespace — this blocks both.',
  }),
  listing: Object.freeze({
    header: 'Listing',
    manifestKey: 'listingCreated',
    question: 'Is the listing created in the Partner Console?',
    yes: 'The listing object exists in the Partner Console.',
    no: 'No listing. The review attaches to a listing object — without one there is nothing to attach it to.',
  }),
  contacts: Object.freeze({
    header: 'Review contacts',
    manifestKey: 'reviewContactsDesignated',
    question: 'Are BOTH a primary and a backup review contact designated?',
    yes: 'Primary and backup contacts are designated and monitored.',
    no: 'Missing a primary or backup contact. Reviewer questions to an unmonitored inbox stall the clock silently.',
  }),
})

/** Exactly the three contract fields, as a fresh plain object (no frozen refs leak). */
function pickOption(o) {
  return { label: o.label, description: o.description, decision: o.decision }
}

/**
 * FAIL CLOSED on a malformed option: every option MUST carry a non-empty
 * label/description/decision, and the decision MUST be a valid record-consent token.
 * Mirrors build-artifact-engine.mjs's FOCUS_MIN throw.
 */
export function validateOption(gateId, o) {
  if (!o || typeof o !== 'object') {
    throw new Error(`gate-spec: ${gateId} has a non-object option`)
  }
  for (const field of ['label', 'description', 'decision']) {
    if (typeof o[field] !== 'string' || !o[field].trim()) {
      throw new Error(`gate-spec: ${gateId} option '${o.label || '?'}' is missing '${field}'`)
    }
  }
  if (!VALID_DECISIONS.has(o.decision)) {
    throw new Error(
      `gate-spec: ${gateId} option '${o.label}' has decision '${o.decision}' — ` +
        `must be 'affirm' or 'deny' (a valid record-consent token)`
    )
  }
  return o
}

/** Parse the locked tier out of a recorded audit-tier answer label. */
export function parseTier(answer) {
  const s = String(answer == null ? '' : answer).toLowerCase()
  if (/\bexhaustive\b/.test(s)) return 'exhaustive'
  if (/\bstandard\b/.test(s)) return 'standard'
  if (/\bquick\b/.test(s)) return 'quick'
  return null
}

/**
 * PURE selector: choose the variant + options for a gate from `facts`, force-inject
 * the safe-default decline on every consent gate, validate fail-closed, and return
 * { gate, consent, header, question, options }. No FS, no network, byte-identical.
 */
export function gateOptions(gateId, facts = {}) {
  const spec = GATE_CATALOG[gateId]
  if (!spec) {
    throw new Error(
      `gate-spec: unknown gate '${gateId}' — register it in the catalog before any skill calls it`
    )
  }
  const f = facts && typeof facts === 'object' ? facts : {}
  let header = spec.header
  let question = spec.question
  let options

  if (gateId === 'run-mode') {
    options = spec.base.map(pickOption)
  } else if (gateId === 'audit-tier') {
    // WI-02: a tier already recorded in the ledger → confirm-and-authorize, NOT the
    // full menu. `reelect` (set when the operator picked "Change tier") forces the
    // full menu back open even when a token exists.
    const locked = f.reelect === true ? null : (typeof f.recordedTier === 'string' ? parseTier(f.recordedTier) : null)
    if (locked) {
      header = spec.confirmHeader
      question =
        `A '${locked}' audit tier is already recorded from the journey. This stop AUTHORIZES the ` +
        `launch (the fan-out token spend) and the target-map approval that follows — it is NOT a ` +
        `re-election of your tier. Authorize the launch, change the tier, or cancel?`
      options = [
        {
          label: `Authorize the ${locked} launch (recommended)`,
          description:
            `Launch the audit at the already-chosen '${locked}' tier — this authorizes the TOKEN ` +
            `SPEND of the fan-out (and the target-map approval that immediately follows). The tier ` +
            `itself was elected earlier and is REUSED, not re-asked.`,
          decision: 'affirm',
        },
        {
          // 'Change tier' is a NAVIGATION branch the driver detects by LABEL (the
          // skill re-opens the full menu on it). Its decision is 'deny' as the
          // FAIL-SAFE: like Cancel, it never authorizes a launch — so even if the
          // driver only piped the decision token, nothing would launch. The
          // re-open intent rides on the label, not the consent token.
          label: 'Change tier',
          description:
            'Re-open the full tier menu to pick a different depth before launching. Nothing ' +
            'launches until you then choose a tier from the re-opened menu.',
          decision: 'deny',
        },
      ]
    } else {
      options = spec.firstPass.map(pickOption)
    }
  } else if (gateId === 'scanner-install') {
    const scanners = Array.isArray(f.scanners) ? f.scanners : []
    if (!scanners.length) {
      throw new Error(
        'gate-spec: scanner-install requires facts.scanners (≥1 installable scanner) — ' +
          'do not offer this gate when none are installable'
      )
    }
    const list = scanners
      .map((s) => `${s.name}${s.method || s.install ? ` (${s.method || s.install})` : ''}`)
      .join(', ')
    options = [
      {
        label: `Install ${scanners.length} scanner(s) to a temp dir`,
        // FUNCTION replacers — `list`/N come (partly) from free-text --scanners CLI
        // input; a string replacement would let `$&`/`$'`/`` $` ``/`$$` in a scanner
        // name expand the surrounding template. A function replacer is never
        // `$`-interpreted, so the data renders literally.
        description: spec.installTemplate
          .replace('{{N}}', () => String(scanners.length))
          .replace('{{SCANNERS}}', () => list),
        decision: 'affirm',
      },
    ]
  } else if (gateId === 'mcp-probe') {
    // The URL is operator-supplied free text → a FUNCTION replacer so $&/$'/$`/$$ in it can
    // never expand the surrounding template (the scanner-install lesson). The operator's choice
    // of staging vs production IS the environment confirmation — so neither affirm option can be
    // selected without naming the environment, and production is never probed silently.
    const url = typeof f.url === 'string' ? f.url.replace(/\s+/g, ' ').trim() : ''
    if (!url) {
      throw new Error(
        'gate-spec: mcp-probe requires facts.url (the endpoint to confirm before probing) — ' +
          'never probe an endpoint you have not named'
      )
    }
    const fill = (tpl) => tpl.replace('{{URL}}', () => url)
    options = [
      { label: 'Probe — this is a STAGING endpoint', description: fill(spec.probeTemplate.staging), decision: 'affirm' },
      { label: 'Probe — this is a PRODUCTION endpoint', description: fill(spec.probeTemplate.production), decision: 'affirm' },
    ]
  } else if (gateId === 'scope-confirm') {
    options = spec.base.map(pickOption)
  } else if (gateId === 'partner-program') {
    const sub = typeof f.subGate === 'string' ? f.subGate : ''
    const def = PARTNER_PROGRAM_SUBGATES[sub]
    if (!def) {
      throw new Error(
        `gate-spec: partner-program requires facts.subGate ∈ {${Object.keys(PARTNER_PROGRAM_SUBGATES).join(', ')}} — ` +
          `got '${sub || '(none)'}'`
      )
    }
    header = def.header
    question = def.question
    // Yes→affirm / No→deny is the RECORDED POLARITY (this is an answer gate, NOT consent — the
    // driver records the polarity into manifest operatorConfirmed.<def.manifestKey>, it does not
    // pipe to record-consent). The 'promoted' gate adds N/A ONLY when no package element exists.
    options = [
      { label: 'Yes', description: def.yes, decision: 'affirm' },
      { label: 'No', description: def.no, decision: 'deny' },
    ]
    if (sub === 'promoted' && f.noPackage === true) {
      options.push({ label: 'N/A — no package in scope', description: def.na, decision: 'deny' })
    }
  } else if (gateId === 'clarify-detection') {
    const element = typeof f.element === 'string' ? f.element.replace(/\s+/g, ' ').trim() : ''
    if (!element) {
      throw new Error(
        'gate-spec: clarify-detection requires facts.element (the ambiguous element to confirm) — ' +
          'ASK rather than omit'
      )
    }
    const fill = (tpl) => tpl.replace(/\{\{ELEMENT\}\}/g, () => element)
    question = fill(spec.questionTemplate)
    options = [
      { label: 'Present — include it', description: fill(spec.opts.present), decision: 'affirm' },
      { label: 'Not present — exclude it', description: fill(spec.opts.absent), decision: 'deny' },
      { label: 'Unsure — investigate first', description: fill(spec.opts.unsure), decision: 'deny' },
    ]
  } else if (gateId === 'listing-type' || gateId === 'tenancy') {
    options = spec.base.map(pickOption)
  } else if (gateId === 'throwaway-dast' || gateId === 'sf-deep-audit-ops') {
    // The two live-op consents — a single static affirm in `base`; the decline is
    // FORCE-INJECTED from safeDefault by the consent-gate block below.
    options = spec.base.map(pickOption)
  } else {
    // A catalog entry exists but has no selector branch — a build error, fail closed.
    throw new Error(`gate-spec: gate '${gateId}' is registered but has no selector branch`)
  }

  // FORCE-INJECT the safe-default decline on every consent gate (idempotent by
  // label) — mirrors build-audit-engine's ALWAYS_ON: a caller cannot drop it.
  if (spec.consent) {
    if (!spec.safeDefault) throw new Error(`gate-spec: consent gate '${gateId}' has no safeDefault`)
    if (!options.some((o) => o && o.label === spec.safeDefault.label)) {
      options = [...options, pickOption(spec.safeDefault)]
    }
  }

  // FAIL CLOSED — validate every emitted option (including the injected default).
  for (const o of options) validateOption(gateId, o)

  return { gate: gateId, consent: !!spec.consent, kind: spec.kind, header, question, options }
}

// Representative facts to EXERCISE every gate at module load — calling gateOptions runs
// validateOption over the FULL emitted option set (including the dynamic, template-filled and
// force-injected options), the strongest catalog self-check. A new catalog gate MUST register
// an entry here (the post-loop coverage check throws otherwise), so a gate can never ship
// un-exercised at load.
const LOAD_CHECK_FACTS = Object.freeze({
  'run-mode': [{}],
  'audit-tier': [{}, { recordedTier: 'standard' }, { recordedTier: 'standard', reelect: true }],
  'scanner-install': [{ scanners: [{ name: 'x', method: 'pip' }] }],
  'mcp-probe': [{ url: 'https://example.test/mcp' }],
  'scope-confirm': [{}],
  'partner-program': [
    { subGate: 'agreement' },
    { subGate: 'pbo' },
    { subGate: 'promoted' },
    { subGate: 'promoted', noPackage: true },
    { subGate: 'namespace' },
    { subGate: 'listing' },
    { subGate: 'contacts' },
  ],
  'clarify-detection': [{ element: 'mcp-server' }],
  'listing-type': [{}],
  'tenancy': [{}],
  'throwaway-dast': [{}],
  'sf-deep-audit-ops': [{}],
})

/** Self-check the FROZEN catalog at module load: every static option well-formed + every gate
 * exercised through the real selector. */
function assertCatalogWellFormed() {
  for (const [gateId, spec] of Object.entries(GATE_CATALOG)) {
    // The `kind` taxonomy is load-bearing — `consent` MUST agree with it, so a future entry
    // cannot quietly mark an answer gate as consent (or drop a consent gate's decline).
    if (!['consent', 'election', 'answer'].includes(spec.kind)) {
      throw new Error(`gate-spec: ${gateId} has an invalid kind '${spec.kind}' (must be consent | election | answer)`)
    }
    if (!!spec.consent !== (spec.kind === 'consent')) {
      throw new Error(`gate-spec: ${gateId} consent=${!!spec.consent} disagrees with kind='${spec.kind}' (consent ⟺ kind:'consent')`)
    }
    const sets = [spec.base, spec.firstPass].filter(Boolean)
    for (const set of sets) for (const o of set) validateOption(gateId, o)
    if (spec.safeDefault) validateOption(gateId, spec.safeDefault)
    if (spec.consent && !spec.safeDefault) {
      throw new Error(`gate-spec: consent gate '${gateId}' is missing its safeDefault`)
    }
    // A template-driven gate (no static option array) must carry a usable template — fail fast at
    // LOAD if a future edit empties it or drops a fill marker, rather than misrendering (or
    // throwing on undefined.replace) at first render.
    if (spec.installTemplate != null) {
      if (
        typeof spec.installTemplate !== 'string' ||
        !spec.installTemplate.includes('{{N}}') ||
        !spec.installTemplate.includes('{{SCANNERS}}')
      ) {
        throw new Error(`gate-spec: ${gateId} installTemplate must be a string containing {{N}} and {{SCANNERS}}`)
      }
    }
    if (spec.probeTemplate != null) {
      for (const k of ['staging', 'production']) {
        if (typeof spec.probeTemplate[k] !== 'string' || !spec.probeTemplate[k].includes('{{URL}}')) {
          throw new Error(`gate-spec: ${gateId} probeTemplate.${k} must be a string containing {{URL}}`)
        }
      }
    }
    if (spec.questionTemplate != null && (typeof spec.questionTemplate !== 'string' || !spec.questionTemplate.includes('{{ELEMENT}}'))) {
      throw new Error(`gate-spec: ${gateId} questionTemplate must be a string containing {{ELEMENT}}`)
    }
    if (spec.opts != null) {
      for (const k of ['present', 'absent', 'unsure']) {
        if (typeof spec.opts[k] !== 'string' || !spec.opts[k].trim()) {
          throw new Error(`gate-spec: ${gateId} opts.${k} must be a non-empty string`)
        }
      }
    }
  }
  // The partner-program sub-gate catalog: every entry well-formed (question/yes/no/manifestKey),
  // 'promoted' carries its N/A clause. Validated here so a malformed sub-gate fails at LOAD too.
  for (const [sub, def] of Object.entries(PARTNER_PROGRAM_SUBGATES)) {
    for (const field of ['header', 'manifestKey', 'question', 'yes', 'no']) {
      if (typeof def[field] !== 'string' || !def[field].trim()) {
        throw new Error(`gate-spec: PARTNER_PROGRAM_SUBGATES.${sub} is missing '${field}'`)
      }
    }
  }
  if (typeof PARTNER_PROGRAM_SUBGATES.promoted.na !== 'string' || !PARTNER_PROGRAM_SUBGATES.promoted.na.trim()) {
    throw new Error("gate-spec: PARTNER_PROGRAM_SUBGATES.promoted is missing its 'na' (N/A) clause")
  }
  // EXERCISE every gate through the real selector (validates the dynamic + injected options too).
  for (const gateId of Object.keys(GATE_CATALOG)) {
    const factsList = LOAD_CHECK_FACTS[gateId]
    if (!factsList) {
      throw new Error(`gate-spec: catalog gate '${gateId}' has no LOAD_CHECK_FACTS entry — add one so the load-time exercise covers it`)
    }
    for (const facts of factsList) gateOptions(gateId, facts)
  }
}
assertCatalogWellFormed()

export { GATE_CATALOG, PARTNER_PROGRAM_SUBGATES }

/** Seed facts from a target repo's recorded consent ledger (audit-tier → confirm). */
function deriveFacts(gateId, target) {
  if (gateId !== 'audit-tier' || !target) return {}
  try {
    const j = JSON.parse(readFileSync(join(target, '.security-review', 'consent', 'audit-tier.json'), 'utf8'))
    if (j && j.affirmative === true) {
      const t = parseTier(j.answer)
      if (t) return { recordedTier: t }
    }
  } catch {
    /* no recorded tier → first-pass menu */
  }
  return {}
}

function main() {
  const arg = (flag, def) => {
    const i = process.argv.indexOf(flag)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
  }
  const gate = arg('--gate', null)
  if (!gate) {
    console.error('gate-spec: --gate <id> is required')
    process.exit(2)
  }
  const target = arg('--target', null)
  let explicit = {}
  const factsPath = arg('--facts', null)
  if (factsPath) {
    try {
      explicit = JSON.parse(readFileSync(factsPath, 'utf8'))
    } catch (e) {
      console.error(`gate-spec: cannot read --facts ${factsPath}: ${e.message}`)
      process.exit(2)
    }
  }
  // Derived (ledger) facts first, then explicit --facts wins (so --facts can force reelect).
  const facts = { ...deriveFacts(gate, target), ...explicit }
  // --scanners convenience for scanner-install (no facts.scanners override).
  const scannersArg = arg('--scanners', null)
  if (scannersArg && !facts.scanners) {
    facts.scanners = scannersArg
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const [name, method] = s.split(':')
        return { name: (name || '').trim(), method: (method || '').trim() }
      })
  }
  // Slice-5 conveniences (an explicit --facts value always wins — only set when absent):
  //   --sub-gate <name>  partner-program sub-gate · --no-package  promoted N/A
  //   --url <url>        mcp-probe endpoint        · --element <name>  clarify-detection element
  const subGate = arg('--sub-gate', null)
  if (subGate && facts.subGate == null) facts.subGate = subGate
  if (process.argv.includes('--no-package') && facts.noPackage == null) facts.noPackage = true
  const url = arg('--url', null)
  if (url && facts.url == null) facts.url = url
  const element = arg('--element', null)
  if (element && facts.element == null) facts.element = element
  let payload
  try {
    payload = gateOptions(gate, facts)
  } catch (e) {
    console.error(`gate-spec: ${e.message}`)
    process.exit(2)
  }
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n')
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
  } catch {
    return fileURLToPath(import.meta.url) === process.argv[1]
  }
}
if (invokedDirectly()) main()

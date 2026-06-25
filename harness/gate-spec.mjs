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
// For THIS slice only three gates are registered: run-mode, audit-tier,
// scanner-install. The engine THROWS on any other id (later WIs register the
// remaining gates — deep-audit, scope, sf-ops, …); no un-migrated skill calls
// gate-spec yet, so an unregistered id can never reach a live render.
const GATE_CATALOG = Object.freeze({
  // run-mode — an ELECTION (ask-tolerance), not a consent. Both options proceed;
  // there is no decline, so NO safe-default is injected. Pinned 2-option set.
  'run-mode': Object.freeze({
    consent: false,
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
        `A '${locked}' audit tier is already recorded from the journey. Authorize the launch, ` +
        `change the tier, or cancel?`
      options = [
        {
          label: `Authorize the ${locked} launch (recommended)`,
          description:
            `Launch the audit at the already-chosen '${locked}' tier. This records the LAUNCH ` +
            `authorization; the tier itself was elected earlier and is REUSED, not re-asked.`,
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

  return { gate: gateId, consent: !!spec.consent, header, question, options }
}

/** Self-check the FROZEN catalog at module load: every static option well-formed. */
function assertCatalogWellFormed() {
  for (const [gateId, spec] of Object.entries(GATE_CATALOG)) {
    const sets = [spec.base, spec.firstPass].filter(Boolean)
    for (const set of sets) for (const o of set) validateOption(gateId, o)
    if (spec.safeDefault) validateOption(gateId, spec.safeDefault)
    if (spec.consent && !spec.safeDefault) {
      throw new Error(`gate-spec: consent gate '${gateId}' is missing its safeDefault`)
    }
    // A template-driven gate (no static option array) must carry a usable template —
    // fail fast at LOAD if a future edit empties it or drops a fill marker, rather
    // than misrendering (or throwing on undefined.replace) at first render.
    if (spec.installTemplate != null) {
      if (
        typeof spec.installTemplate !== 'string' ||
        !spec.installTemplate.includes('{{N}}') ||
        !spec.installTemplate.includes('{{SCANNERS}}')
      ) {
        throw new Error(`gate-spec: ${gateId} installTemplate must be a string containing {{N}} and {{SCANNERS}}`)
      }
    }
  }
}
assertCatalogWellFormed()

export { GATE_CATALOG }

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

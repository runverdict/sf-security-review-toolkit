#!/usr/bin/env node
/*
 * emit-permission-set.mjs — the SELF-SKIPPING autorun permission-set gate: check whether
 * the target repo's `.claude/settings.local.json` already pre-approves the toolkit's own
 * curated READ-ONLY command surface, and (consent-gated, fail-closed) write the missing
 * `permissions.allow` entries so the journey runs UNINTERRUPTED in Claude Code's DEFAULT
 * mode — automating the manual "Running it hands-off (permissions)" setup the README
 * documents, plus the gap the README misses: the toolkit's own deterministic engine calls.
 *
 * WHY THIS EXISTS. The journey is read-only on the partner's source, but every atomic
 * harness invocation and read-only shell probe raises its own permission prompt in default
 * mode — dozens of interruptions for commands that cannot mutate anything the consent model
 * cares about. The README tells the operator to paste an allowlist by hand; this engine is
 * that same setup as a ONE-question preflight gate: already present → silent; absent →
 * offered once (the recorded consent is what makes it never re-ask), and the write happens
 * only against a recorded affirmative token.
 *
 * ⚠ THE SAFETY CRUX — this is the FIRST engine in the toolkit that writes to Claude Code's
 * own config, so the boundary is CODE-ENFORCED, not prose:
 *   - It may ONLY append curated strings to `permissions.allow`. `assertOnlyAllowGrew`
 *     verifies the merged object is deep-equal to the original at EVERY path except
 *     `permissions.allow` — which may only GROW (existing entries preserved verbatim, in
 *     order; every appended entry ∈ REQUIRED_ALLOW). Any other delta → ABORT, exit ≠ 0,
 *     NOTHING written. It never creates or modifies `permissions.deny`, `permissions.ask`,
 *     `permissions.defaultMode`, `autoMode.*`, `env`, or any other key.
 *   - Consent FAIL-CLOSED: `--apply` verifies the recorded `autorun-permissions` token via
 *     verifyConsent (record-consent.mjs) — no affirmative recorded → exit 3, nothing written.
 *   - NON-CLOBBERING: an existing settings file it cannot parse, a `permissions` key that is
 *     not an object, or an `allow` that is not an array → refuse and write nothing (merging
 *     would have to overwrite a value that is not ours).
 *
 * THE CURATED SURFACE (REQUIRED_ALLOW) — scoped prefixes only, NEVER a blanket `Bash(*)` /
 * `Bash(node:*)` / `Bash(sf:*)` / `Skill(*)`:
 *   - the read-only shell/file/git tools the README allowlist documents;
 *   - the read-only `sf` CLI reads the README allowlist documents (org/list/display, data
 *     query, sobject, package version list/report, config get, project retrieve + the local
 *     Code Analyzer run — the two that write only retrieved metadata / report files);
 *   - the toolkit's DETERMINISTIC ENGINE calls (`node *harness/<name>.mjs:*`): the render-*
 *     family, the read-only detectors/verifiers, and the local-state engines whose writes
 *     are confined to the toolkit's own `.security-review/` + `docs/security-review/` trees;
 *   - the toolkit's OWN SKILLS (`Skill(sf-security-review-toolkit:<skill>)`): the journey
 *     drives its phases by invoking its sub-skills through the Skill tool, which prompts
 *     PER SKILL in default mode — the gap the 0.8.122 Bash-only set left, stalling an
 *     otherwise-uninterrupted run at every phase hand-off. Each entry is scoped to one
 *     named skill of THIS plugin (never a blanket `Skill` / `Skill(*)`); pre-approving an
 *     invocation only loads the skill's instructions — every privileged operation inside
 *     a skill still hits its own tool prompts and recorded-consent gates.
 *
 * EXCLUDED ON PURPOSE — the EXECUTORS stay prompting AND stay behind their own recorded
 * consent gates; pre-approving them here would remove a safety prompt from an op that
 * reaches outside read-only-local:
 *   - install-scanners  — NETWORK fetch (downloads scanner binaries/packages to tmp)
 *   - standup-org / teardown-org — LIVE Salesforce org create/delete
 *   - standup-stack / teardown-stack — docker container stand-up / destruction
 *   - run-dast          — ACTIVE scan execution (docker + ZAP) against the throwaway
 *   - capture-openapi   — network read from the stood-up mirror (rides the DAST consent)
 *   - capture-org-mcp   — live org capture through the installed package
 *   - agent-trace-probe — live scripted agent conversation in the scratch org
 *   - normalize-agent-test — spawns live `sf agent test` runs in an org
 *   - write-drafted-content — the artifact WRITE gate into the partner's docs tree
 *   - scaffold-env      — writes the credential env stub (part of the DAST executor chain)
 *   - cleanup-scanners  — recursive tmp-tree removal (the rm class, even though scoped)
 * and the broad/destructive shell prefixes: `Bash(rm:*)`, `Bash(cp:*)`, `Bash(mkdir:*)`,
 * broad `Bash(sf:*)`, `Bash(curl:*)`, `Bash(npm install:*)`, broad `Bash(node:*)`.
 * Fail-safe direction: a MISSING entry only costs a prompt; a WRONG inclusion removes a
 * safety prompt — so when unsure, exclude.
 *
 * PURE predicates + thin fail-closed CLI (the verify-dast-fired.mjs idiom). No network,
 * no deps. Read-only on everything except the two writes under a consented `--apply`:
 * `<repo>/.claude/settings.local.json` and `<repo>/.security-review/autorun-permissions.md`.
 *
 * USAGE
 *   check: node emit-permission-set.mjs --check --target <repo> [--json]
 *          exit 0 satisfied · exit 2 not satisfied (prints the missing entries + whether the
 *          gate was already answered, so the preflight can branch without re-asking)
 *   apply: node emit-permission-set.mjs --apply --target <repo> --consent [--json]
 *          exit 0 written · exit 3 consent missing (fail closed, nothing written) ·
 *          exit 2 boundary/parse refusal (nothing written)
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyConsent } from './record-consent.mjs'

/** The recorded consent gate `--apply` fails closed on (gate-spec.mjs `autorun-permissions`). */
export const CONSENT_GATE = 'autorun-permissions'

// The deterministic harness engines that are safe to pre-approve (read-only, or writes
// confined to the toolkit's own state/output trees; anything privileged inside them is
// consent-verified in code — e.g. build-audit-engine fails closed without the recorded
// audit-tier token). One basename per line; the executors above are deliberately absent.
const ALLOWED_ENGINES = Object.freeze([
  // render family — deterministic fixed-block emitters (read local state, print)
  'render-detected-elements',
  'render-mcp-scope',
  'render-preflight',
  'render-readiness-verdict',
  'render-recap',
  'render-router-status',
  'render-scan-status',
  'render-scope-summary',
  'render-sf-autoresolve',
  'render-stability',
  'render-target-map',
  'rerender-runlog',
  // read-only detectors / pure compute / verifiers
  'applicable-requirements',
  'artifact-gate',
  'baseline-counts',
  'compute-sci',
  'detect-agentforce',
  'docker-check',
  'emit-permission-set', // self: --check is read-only; --apply is consent-gated in code
  'enumerate-app-roots',
  'finding-clusters',
  'gate-spec',
  'injection-check',
  'ledger-staleness',
  'namespace-check',
  'package-readiness',
  'recurrence-confidence',
  'stack-detect',
  'tool-detect',
  'union-convergence',
  'verify-dast-fired',
  'verify-report-headline',
  // read-only `sf` query producer (writes only .security-review/sf-autoresolve.json)
  'sf-autoresolve',
  // local-state engines — writes confined to .security-review/ + docs/security-review/
  'apply-dispositions',
  'assemble-submission-package', // copies, never moves; builds the toolkit's own output tree
  'build-artifact-engine',
  'build-audit-engine', // fails closed in code without the recorded audit-tier consent
  'build-evidence-index',
  'ingest-scanner-findings',
  'inject-report-headline',
  'merge-ledger',
  'reconcile-provenance',
  'record-consent',
  'seed-auto-dispositions',
])

// The plugin's own name — the prefix Claude Code records for per-skill permission
// entries: `Skill(<plugin>:<skill>)` is the exact form it writes to settings.local.json
// when the operator answers a Skill prompt with "don't ask again".
const PLUGIN = 'sf-security-review-toolkit'

// The toolkit's own skills — one entry per `skills/<name>/` directory. The journey
// invokes these through the Skill tool, and in default mode the Skill tool prompts once
// per skill, so a Bash-only allowlist still interrupts an autonomous run at every phase
// hand-off. Safe to pre-approve by construction: each entry names ONE skill of THIS
// plugin (never a blanket `Skill` / `Skill(*)`), and approving the invocation only loads
// the skill's instructions — every privileged operation a skill performs still raises its
// own tool prompt and stays behind its own recorded-consent gate. The acceptance drift
// guard holds this list ⟺ the skills/ directory in both directions.
const ALLOWED_SKILLS = Object.freeze([
  'audit-codebase',
  'audit-deployed-package',
  'bootstrap-cli-auth',
  'build-managed-package',
  'compile-submission',
  'generate-artifacts',
  'install-and-verify-package',
  'prepare-test-environment',
  'reviewer-simulation',
  'run-scans',
  'scope-submission',
  'security-review-journey',
  'stay-listed',
  'teardown-mcp-registration',
])

/**
 * The curated `permissions.allow` set, in Claude Code's colon-prefix syntax
 * (`Bash(git status:*)` — the form the README's settings.json example uses; NOT the
 * space form the skills' allowed-tools frontmatter uses) plus the per-skill
 * `Skill(sf-security-review-toolkit:<skill>)` form Claude Code itself records for
 * Skill-tool approvals.
 */
export const REQUIRED_ALLOW = Object.freeze([
  // read-only git/shell/file tools (the README allowlist)
  'Bash(git status:*)',
  'Bash(git log:*)',
  'Bash(git rev-parse:*)',
  'Bash(git diff:*)',
  'Bash(git ls-files:*)',
  'Bash(ls:*)',
  'Bash(cat:*)',
  'Bash(grep:*)',
  'Bash(head:*)',
  'Bash(tail:*)',
  'Bash(wc:*)',
  'Bash(sort:*)',
  'Bash(awk:*)',
  'Bash(date:*)',
  'Bash(find:*)',
  // read-only `sf` CLI reads (the README allowlist)
  'Bash(sf org list:*)',
  'Bash(sf org display:*)',
  'Bash(sf data query:*)',
  'Bash(sf project retrieve:*)',
  'Bash(sf sobject:*)',
  'Bash(sf package version list:*)',
  'Bash(sf package version report:*)',
  'Bash(sf config get:*)',
  'Bash(sf code-analyzer run:*)',
  // the toolkit's own deterministic engines (the gap the README misses)
  ...ALLOWED_ENGINES.map((name) => `Bash(node *harness/${name}.mjs:*)`),
  // the toolkit's own sub-skill invocations (the Skill tool prompts per skill in default
  // mode — the gap the Bash-only set left); scoped per-skill, never a blanket Skill grant
  ...ALLOWED_SKILLS.map((s) => `Skill(${PLUGIN}:${s})`),
])

/** True iff v is a plain object (not null, not an array). */
function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * PURE. TRUE iff every REQUIRED_ALLOW entry is present in settings.permissions.allow.
 * FAIL-SAFE on missing/malformed settings → false (a false negative only costs a prompt).
 */
export function permissionSetSatisfied(settings) {
  if (!isPlainObject(settings)) return false
  const p = settings.permissions
  if (!isPlainObject(p) || !Array.isArray(p.allow)) return false
  const have = new Set(p.allow.filter((e) => typeof e === 'string'))
  return REQUIRED_ALLOW.every((e) => have.has(e))
}

/** PURE. The REQUIRED_ALLOW entries NOT yet present. Malformed settings → all of them. */
export function missingAllowEntries(settings) {
  const allow = isPlainObject(settings) && isPlainObject(settings.permissions) && Array.isArray(settings.permissions.allow)
    ? settings.permissions.allow
    : []
  const have = new Set(allow.filter((e) => typeof e === 'string'))
  return REQUIRED_ALLOW.filter((e) => !have.has(e))
}

/**
 * PURE. Returns { next, added }: a DEEP COPY of settings with the missing REQUIRED_ALLOW
 * entries appended to permissions.allow — existing entries preserved verbatim in order,
 * dedup against what is already present, REQUIRED_ALLOW order for the appended tail.
 * NEVER mutates the input; NEVER touches any key other than permissions.allow.
 * THROWS (fail closed) when appending would have to overwrite a non-ours value: settings
 * not a plain object, `permissions` present but not a plain object, `allow` present but
 * not an array.
 */
export function mergePermissionSet(settings) {
  const s = settings == null ? {} : settings
  if (!isPlainObject(s)) {
    throw new Error('emit-permission-set: settings must be a JSON object — refusing to merge')
  }
  if ('permissions' in s && !isPlainObject(s.permissions)) {
    throw new Error("emit-permission-set: existing 'permissions' is not an object — appending would overwrite it; refusing")
  }
  if (isPlainObject(s.permissions) && 'allow' in s.permissions && !Array.isArray(s.permissions.allow)) {
    throw new Error("emit-permission-set: existing 'permissions.allow' is not an array — appending would overwrite it; refusing")
  }
  const next = structuredClone(s)
  if (!isPlainObject(next.permissions)) next.permissions = {}
  if (!Array.isArray(next.permissions.allow)) next.permissions.allow = []
  const have = new Set(next.permissions.allow.filter((e) => typeof e === 'string'))
  const added = []
  for (const entry of REQUIRED_ALLOW) {
    if (have.has(entry)) continue
    next.permissions.allow.push(entry)
    have.add(entry)
    added.push(entry)
  }
  return { next, added }
}

/** Structural deep-equal over JSON-shaped values (order-insensitive on object keys). */
function deepEqual(a, b) {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]))
  }
  return false
}

/** Deep copy with permissions.allow removed (and an emptied permissions container dropped,
 * so creating the container FOR allow alone is not read as an unrelated change). */
function stripAllow(settings) {
  const c = settings == null ? {} : structuredClone(settings)
  if (isPlainObject(c) && isPlainObject(c.permissions)) {
    delete c.permissions.allow
    if (Object.keys(c.permissions).length === 0) delete c.permissions
  }
  return c
}

/**
 * THE CODE-ENFORCED BOUNDARY (pure; throws on violation). Verifies `next` differs from
 * `original` ONLY at `permissions.allow`, and that allow only GREW:
 *   1. every original allow entry survives verbatim, in order, as the prefix of next's allow;
 *   2. every appended entry is a string ∈ REQUIRED_ALLOW (the curated set — nothing else can
 *      ever be written, so even a buggy merge cannot smuggle a blanket grant in);
 *   3. with allow stripped from both, original and next are structurally deep-equal — any
 *      other created/modified/removed key at ANY depth throws.
 * The CLI runs this over the exact re-parsed payload it is about to write; a throw means
 * exit ≠ 0 and NOTHING written.
 */
export function assertOnlyAllowGrew(original, next) {
  const origAllow = isPlainObject(original) && isPlainObject(original.permissions) && Array.isArray(original.permissions.allow)
    ? original.permissions.allow
    : []
  const nextAllow = isPlainObject(next) && isPlainObject(next.permissions) ? next.permissions.allow : undefined
  if (!Array.isArray(nextAllow)) {
    throw new Error('emit-permission-set BOUNDARY: merged settings carry no permissions.allow array — aborting, writing nothing')
  }
  if (nextAllow.length < origAllow.length) {
    throw new Error('emit-permission-set BOUNDARY: permissions.allow shrank — existing entries must be preserved; aborting, writing nothing')
  }
  for (let i = 0; i < origAllow.length; i++) {
    if (!deepEqual(nextAllow[i], origAllow[i])) {
      throw new Error(`emit-permission-set BOUNDARY: existing permissions.allow[${i}] was altered or reordered — aborting, writing nothing`)
    }
  }
  for (let i = origAllow.length; i < nextAllow.length; i++) {
    const e = nextAllow[i]
    if (typeof e !== 'string' || !REQUIRED_ALLOW.includes(e)) {
      throw new Error(`emit-permission-set BOUNDARY: appended allow entry ${JSON.stringify(e)} is not in the curated REQUIRED_ALLOW set — aborting, writing nothing`)
    }
  }
  if (!deepEqual(stripAllow(original), stripAllow(next))) {
    throw new Error('emit-permission-set BOUNDARY: a key other than permissions.allow would change — aborting, writing nothing')
  }
}

/** The partner-facing artifact body (deterministic — no clock, per the repo convention). */
export function renderArtifact({ added, alreadyPresent }) {
  const lines = []
  lines.push('# Autorun permissions — what the toolkit wrote, and how to undo it')
  lines.push('')
  lines.push('The security-review journey asked once whether to set this repo up for an')
  lines.push('uninterrupted run in Claude Code **default mode**, and you said yes. It appended')
  lines.push('the entries below to `permissions.allow` in `.claude/settings.local.json` —')
  lines.push('**and touched nothing else in that file** (the engine aborts rather than change')
  lines.push('any other key: no `deny`, no `ask`, no `defaultMode`, no `env`).')
  lines.push('')
  lines.push('## What the allowlist covers')
  lines.push('')
  lines.push('Only the toolkit\'s **read-only / non-destructive** command surface:')
  lines.push('- read-only git/shell/file tools (`git status`, `ls`, `cat`, `grep`, …);')
  lines.push('- read-only `sf` CLI queries (org list/display, data query, sobject, package')
  lines.push('  version list/report, config get) plus the two local writers the README')
  lines.push('  discloses (`sf project retrieve` writes retrieved metadata into the project')
  lines.push('  tree; `sf code-analyzer run` writes report files);')
  lines.push('- the toolkit\'s own deterministic `harness/*.mjs` engines, whose writes are')
  lines.push('  confined to `.security-review/` and `docs/security-review/`;')
  lines.push('- the toolkit\'s own skills (`Skill(sf-security-review-toolkit:<skill>)`) — the')
  lines.push('  journey invokes its sub-skills through the Skill tool, which otherwise prompts')
  lines.push('  once per skill. Each entry is scoped to one named skill of this plugin (never')
  lines.push('  a blanket `Skill` grant), and approving the invocation only loads the skill\'s')
  lines.push('  instructions — anything privileged a skill does still prompts below.')
  lines.push('')
  lines.push('## What still asks (unchanged, consent-gated in code)')
  lines.push('')
  lines.push('Nothing that reaches outside read-only-local was pre-approved. Scanner installs')
  lines.push('(a network fetch), scratch-org create/delete and every live org op, the')
  lines.push('throwaway-DAST stand-up/scan/teardown, live endpoint probes, and artifact-content')
  lines.push('writes all still prompt AND still require their own recorded consent token —')
  lines.push('their engines verify the token and fail closed without it.')
  lines.push('')
  lines.push('## Entries added')
  lines.push('')
  if (added.length) {
    for (const e of added) lines.push(`- \`${e}\``)
  } else {
    lines.push('- (none — every required entry was already present)')
  }
  if (alreadyPresent > 0) {
    lines.push('')
    lines.push(`${alreadyPresent} required entr${alreadyPresent === 1 ? 'y was' : 'ies were'} already present and left untouched.`)
  }
  lines.push('')
  lines.push('## How to remove it')
  lines.push('')
  lines.push('Delete the entries above from `permissions.allow` in')
  lines.push('`.claude/settings.local.json` (or delete the file if the toolkit created it and')
  lines.push('nothing else lives there), then restart Claude Code. The toolkit will not')
  lines.push('re-ask: the recorded answer at `.security-review/consent/autorun-permissions.json`')
  lines.push('is what keeps this a one-time question — delete that file too if you want the')
  lines.push('journey preflight to offer the setup again.')
  lines.push('')
  return lines.join('\n')
}

function settingsPathFor(target) {
  return join(target, '.claude', 'settings.local.json')
}

function main() {
  const arg = (flag, def) => {
    const i = process.argv.indexOf(flag)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
  }
  const TARGET = arg('--target', process.cwd())
  const AS_JSON = process.argv.includes('--json')
  const MODE = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--check') ? 'check' : null
  if (!MODE) {
    console.error('emit-permission-set: pass --check or --apply (with --target <repo>)')
    process.exit(2)
  }

  const settingsPath = settingsPathFor(TARGET)
  let raw = null
  try { raw = readFileSync(settingsPath, 'utf8') } catch { raw = null } // absent → {}
  let settings = {}
  let malformed = false
  if (raw !== null) {
    try { settings = JSON.parse(raw) } catch { malformed = true }
  }

  // Whether the one-time gate was already ANSWERED (either way) — the preflight's
  // never-re-ask branch keys off this, so a recorded decline stays a decline.
  const askedBefore = existsSync(join(TARGET, '.security-review', 'consent', `${CONSENT_GATE}.json`))

  if (MODE === 'check') {
    const satisfied = !malformed && permissionSetSatisfied(settings)
    const missing = malformed ? [...REQUIRED_ALLOW] : missingAllowEntries(settings)
    if (AS_JSON) {
      process.stdout.write(JSON.stringify({ satisfied, missing, missingCount: missing.length, askedBefore, malformed, settingsPath }, null, 2) + '\n')
    } else if (satisfied) {
      process.stdout.write(`emit-permission-set: SATISFIED — all ${REQUIRED_ALLOW.length} autorun allow entries present in ${settingsPath}.\n`)
    } else {
      process.stdout.write(
        `emit-permission-set: NOT SATISFIED — ${missing.length} of ${REQUIRED_ALLOW.length} entries missing from ${settingsPath}` +
        `${malformed ? ' (file present but not parseable JSON — --apply will refuse it)' : ''}.\n` +
        `  askedBefore: ${askedBefore} (true → the operator already decided; do NOT re-ask)\n` +
        missing.map((e) => `  missing: ${e}\n`).join('')
      )
    }
    process.exit(satisfied ? 0 : 2)
  }

  // ── apply ──────────────────────────────────────────────────────────────────────
  if (!process.argv.includes('--consent')) {
    console.error('emit-permission-set: --apply requires --consent (and a RECORDED affirmative autorun-permissions gate) — nothing written')
    process.exit(3)
  }
  if (!verifyConsent(CONSENT_GATE, { target: TARGET })) {
    console.error(
      `emit-permission-set: FAIL CLOSED — no recorded affirmative '${CONSENT_GATE}' consent for ${TARGET}; ` +
      'record it via record-consent.mjs from the operator\'s real gate answer first. Nothing written.'
    )
    process.exit(3)
  }
  if (malformed) {
    console.error(`emit-permission-set: ${settingsPath} exists but is not parseable JSON — refusing to merge into a file it cannot faithfully preserve. Nothing written.`)
    process.exit(2)
  }

  let merged
  try {
    merged = mergePermissionSet(settings)
  } catch (e) {
    console.error(`${e.message} Nothing written.`)
    process.exit(2)
  }
  const { next, added } = merged

  // THE BOUNDARY, run over the exact payload that would land on disk (re-parsed, so no
  // shared references can mask a delta) against an independent re-parse of the original.
  const payload = JSON.stringify(next, null, 2) + '\n'
  try {
    assertOnlyAllowGrew(raw === null ? {} : JSON.parse(raw), JSON.parse(payload))
  } catch (e) {
    console.error(`${e.message}\n  Nothing was written.`)
    process.exit(2)
  }

  const artifactPath = join(TARGET, '.security-review', 'autorun-permissions.md')
  if (added.length > 0) {
    mkdirSync(join(TARGET, '.claude'), { recursive: true })
    writeFileSync(settingsPath, payload)
    // The partner-facing note rides the settings write: written only when something was
    // actually added, so a redundant re-apply can never clobber the original record.
    mkdirSync(join(TARGET, '.security-review'), { recursive: true })
    writeFileSync(artifactPath, renderArtifact({ added, alreadyPresent: REQUIRED_ALLOW.length - added.length }))
  }

  if (AS_JSON) {
    process.stdout.write(JSON.stringify({ applied: true, added, addedCount: added.length, settingsPath, artifact: added.length > 0 ? artifactPath : null }, null, 2) + '\n')
  } else {
    process.stdout.write(
      added.length > 0
        ? `emit-permission-set: wrote ${added.length} allow entr${added.length === 1 ? 'y' : 'ies'} to ${settingsPath} (permissions.allow only; every other key untouched).\n` +
          `  Partner-facing note: ${artifactPath}\n` +
          '  RESTART Claude Code to activate the allowlist — the next default-mode run is uninterrupted.\n'
        : `emit-permission-set: already satisfied — nothing to add; ${settingsPath} untouched.\n`
    )
  }
  process.exit(0)
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) }
  catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

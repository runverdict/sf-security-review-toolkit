#!/usr/bin/env node
/*
 * baseline-refutation-check.mjs — catch a refutation that leans on platform
 * auto-enforcement the package's API version does NOT actually buy.
 *
 * WHY THIS EXISTS. At Salesforce API version >= 67.0 Apex runs in USER MODE by
 * default and an undeclared class defaults to `with sharing` — so the platform
 * auto-enforces object/field access and row-level sharing without an explicit
 * check. A verifier can therefore (correctly, AT 67.0+) refute a "missing
 * CRUD/FLS" or "missing sharing declaration" finding on the rationale "the
 * platform enforces it by default now." But that rationale is INVALID for a
 * package whose `sourceApiVersion` is <= 66.0 (the Solano fixture is 64.0):
 * there the OLD defaults hold — system-mode execution, `without sharing`
 * fall-through — so the absent check is a genuine gap and the finding STANDS.
 * The auto-enforcement refutation, applied to an old-baseline package, silently
 * drops a real finding. This engine re-reads every `refuted` finding whose
 * reasoning cites that auto-enforcement rationale and, against the package's
 * actual API version, flags the ones the version does not support.
 *
 * HONEST SCOPE. This is a CANDIDATE FLAGGER, not an adjudicator. It pattern-
 * matches the auto-enforcement rationale in free-text reasoning, so a refutation
 * that legitimately cites an EXPLICIT `AccessLevel.USER_MODE` opt-in in the code
 * (valid at any API version) can also match — that is the safe direction: it
 * surfaces the refutation for a HUMAN to RE-OPEN and re-read, it never auto-
 * re-confirms a finding. It is REPORT-ONLY and OPT-IN: it gates nothing, moves
 * no SCI/readiness number, and is never wired into compute-sci. Its only teeth
 * are the optional `--strict` exit code for a CI lane that wants to fail on a
 * detected invalid refutation.
 *
 * DETERMINISTIC + PURE (CONVENTIONS §7). No LLM, no network, no learned weights,
 * no dependencies, no Date/random. Same ledger + same apiVersion in → byte-
 * identical JSON out. Guarded by acceptance/test-baseline-refutation-check.mjs.
 *
 * Usage:
 *   node harness/baseline-refutation-check.mjs --ledger <path> \
 *     [ --api-version <float> | --sfdx-project <sfdx-project.json> | --scope-manifest <path> ] \
 *     [--strict]
 *
 *   Package API version precedence: --api-version, then --sfdx-project
 *   (reads top-level `sourceApiVersion`), then --scope-manifest (reads
 *   `package.sourceApiVersion`). None supplied → apiVersion null → every
 *   matching refutation lands in `unknown` (cannot decide without the version).
 *
 *   stdout JSON: { apiVersion, checked, invalid_refutations:[{id,file,title,citedSignal,apiVersion}], unknown:[...] }
 *   exit 0 always, EXCEPT: unreadable/non-JSON/absent --ledger → exit 2;
 *   with --strict, exit 3 when invalid_refutations is non-empty.
 */
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The API version at and above which the auto-enforcement defaults hold.
const AUTO_ENFORCE_FROM = 67.0

// Free-text rationales that signal a refutation is leaning on platform
// auto-enforcement (user-mode / with-sharing defaults at 67.0+). Matched
// case-insensitively as substrings against the finding's reasoning fields.
// Order is fixed so the reported `citedSignal` is deterministic.
const CITED_SIGNALS = [
  'user mode by default',
  'runs in user mode',
  'WITH USER_MODE',
  'USER_MODE',
  'with sharing by default',
  'default to with sharing',
  'auto-enforce',
  'automatically enforced',
  'enforced by the platform',
  '67.0',
  'api 67',
]

// Parse a value to a float, or null when it is missing / not a number.
function toApiVersion(v) {
  if (v === null || v === undefined) return null
  const n = Number.parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

// Read `sourceApiVersion` from an sfdx-project.json, or `package.sourceApiVersion`
// from a scope manifest. Fails SOFT to null (the version source is advisory; only
// the ledger is mandatory) — a missing/unreadable/shapeless file → unknown, never a crash.
function readApiVersionFromFile(path, kind) {
  let obj
  try { obj = JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
  if (!obj || typeof obj !== 'object') return null
  const raw = kind === 'sfdx'
    ? obj.sourceApiVersion
    : (obj.package && typeof obj.package === 'object' ? obj.package.sourceApiVersion : undefined)
  return toApiVersion(raw)
}

/**
 * THE PURE CORE. Given a findings array and the package apiVersion (number|null),
 * return the dispositioned refutation check. FAIL CLOSED: a non-array `findings`
 * (the dict-shaped-payload class) contributes zero, never throws.
 */
export function checkBaselineRefutations(findings, apiVersion) {
  const arr = Array.isArray(findings) ? findings : []
  const api = apiVersion === null || apiVersion === undefined ? null : apiVersion
  const invalid_refutations = []
  const unknown = []
  let checked = 0
  for (const f of arr) {
    if (!f || typeof f !== 'object') continue
    if (String(f.status || '').toLowerCase() !== 'refuted') continue
    const hay = [f.reasoning, f.verdict_reasoning, f.evidence]
      .map((x) => String(x || ''))
      .join('\n')
      .toLowerCase()
    const citedSignal = CITED_SIGNALS.find((s) => hay.includes(s.toLowerCase()))
    if (!citedSignal) continue
    checked++
    const rec = {
      id: f.id ?? null,
      file: f.file ?? null,
      title: f.title ?? null,
      citedSignal,
      apiVersion: api,
    }
    if (api === null) unknown.push(rec)
    else if (api < AUTO_ENFORCE_FROM) invalid_refutations.push(rec)
    // api >= 67.0 → the auto-enforcement rationale IS supported → valid, skip.
  }
  return { apiVersion: api, checked, invalid_refutations, unknown }
}

function fail2(msg) {
  process.stderr.write(`baseline-refutation-check: ${msg}\n`)
  process.exit(2)
}

function main() {
  const argv = process.argv
  const has = (name) => argv.indexOf(name) >= 0
  const valOf = (name) => {
    const i = argv.indexOf(name)
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : undefined
  }

  const ledgerPath = valOf('--ledger')
  if (!ledgerPath) fail2('a --ledger <path> is required')
  let ledger
  try { ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')) }
  catch { fail2(`cannot read or parse ledger at ${ledgerPath}`) }
  const findings = ledger && Array.isArray(ledger.findings)
    ? ledger.findings
    : Array.isArray(ledger) ? ledger : []

  // Version precedence: --api-version, then --sfdx-project, then --scope-manifest.
  let apiVersion = null
  if (has('--api-version')) apiVersion = toApiVersion(valOf('--api-version'))
  else if (has('--sfdx-project')) apiVersion = readApiVersionFromFile(valOf('--sfdx-project'), 'sfdx')
  else if (has('--scope-manifest')) apiVersion = readApiVersionFromFile(valOf('--scope-manifest'), 'manifest')

  const result = checkBaselineRefutations(findings, apiVersion)
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  if (has('--strict') && result.invalid_refutations.length) process.exit(3)
  process.exit(0)
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) }
  catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

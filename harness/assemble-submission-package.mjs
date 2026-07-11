#!/usr/bin/env node
/*
 * assemble-submission-package.mjs — the DETERMINISTIC submission-package assembler
 * (compile-submission Step 10). Two operators hand-building the deliverable produced
 * two different packages; CONVENTIONS §7 says a self-describing assembly is
 * engine-backed, never narrated. This engine builds
 * `<target>/docs/security-review/submission-package/` — INDEX.md (the wizard-slot
 * map), PENDING-OWNER-RUN.md (the human tail), readiness-verdict.md (copied in), and
 * the artifacts/evidence COPIED into step-named dirs (`step2-technical/`,
 * `step3-docs/`, `step3-scans/`, `step4-environments/`). Copies, never moves —
 * the canonical originals stay where re-compiles and re-audits read them.
 *
 * WHAT THE ENGINE OWNS (frozen constants, guarded by the standing test):
 *   - WIZARD_STEPS — the Security Review Wizard's five steps (baseline:
 *     process-submission-wizard). Pinned here because the slot names lived only in
 *     skill prose before, which is only as strong as the model that remembers it.
 *   - STEP3_UPLOAD_SLOTS / STEP4_CREDENTIAL_SUBBLOCKS — the named upload slots and
 *     credential sub-blocks the operator faces in the live wizard.
 *   - SLOT_MAP — the artifact→step/slot/dir table, keyed on baseline requirement ids
 *     (this mapping existed nowhere as data; it is authored HERE, once).
 *
 * WHAT THE ENGINE NEVER DOES:
 *   - Re-classify. Row status is INHERITED from the evidence-index dispositions
 *     (fail closed): satisfied + reviewer_reproducible → HAVE; partial → PARTIAL;
 *     pending-owner → TODO; statically-cleared (or satisfied WITHOUT the
 *     reviewer_reproducible flag — the same fail-closed read compute-sci applies) →
 *     STATICALLY-CLEARED, surfaced and never HAVE. No entry at all → TODO.
 *   - Re-derive applicability. `applicableBaselineIds` is read VERBATIM from the
 *     scope manifest; a slot is emitted only when its baseline id is in that set.
 *     Element-gated sub-blocks (Desktop Clients / Mobile Apps / API-OAuth-SAML)
 *     match the manifest element types through `canonicalElementType`
 *     (render-detected-elements.mjs), so a synonym-typed manifest
 *     (`external-web-app`) gates identically to its canonical twin. Suppressed
 *     slots close the INDEX in a "suppressed (not applicable)" list — decided out,
 *     not forgotten.
 *   - Hardcode perishable facts. The owner-tail items in PENDING-OWNER-RUN.md
 *     (wizard walk, portal scan, review fee) quote their `requirement`/`details`
 *     text PARSED from the baseline entries (process-submission-wizard,
 *     scan-checkmarx-partner-portal, process-review-fee) at assembly time — a fee
 *     or run-budget change lands here on the next assembly, not in a code edit.
 *   - Assemble over a refused SCI. compute-sci.mjs runs first; its exit-2
 *     `STALE SCOPE MANIFEST` refusal is INHERITED — this engine aborts with the
 *     same exit code and touches nothing.
 *   - Package credential material. Every source file in the copy plan and both
 *     rendered documents are scanned for credential-shaped content BEFORE anything
 *     is written (CONVENTIONS §6); any hit fails closed — the refusal names the
 *     file and the pattern, never the matched value.
 *
 * DETERMINISTIC (CONVENTIONS §7): no LLM, no network, no deps, no wall clock —
 * `--date` is required. Same inputs → byte-identical package on re-run.
 *
 * USAGE:
 *   node assemble-submission-package.mjs --target <repo> --plugin <pluginRoot> --date YYYY-MM-DD
 *   (`--repo` is accepted as an alias for `--target`.)
 *
 * EXIT CODES: 0 assembled · 1 fail-closed (unreadable manifest/evidence-index,
 * missing baseline, credential-shaped content, bad args) · 2 inherited stale-SCI
 * refusal (or compute-sci's own non-zero status, passed through).
 */
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, copyFileSync, realpathSync,
} from 'node:fs'
import { join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { canonicalElementType } from './render-detected-elements.mjs'

// ─── The five wizard steps (baseline: process-submission-wizard) — FROZEN ─────────
export const WIZARD_STEPS = Object.freeze([
  Object.freeze({ n: 1, name: 'Add Contacts', packageDir: null, note: 'owner enters a primary contact + a backup distribution list live in the wizard — no package dir' }),
  Object.freeze({ n: 2, name: 'Add Technical Details', packageDir: 'step2-technical', note: 'solution technical details — pre-drafted material in step2-technical/' }),
  Object.freeze({ n: 3, name: 'Upload Documentation', packageDir: 'step3-docs + step3-scans', note: 'the artifact-heavy step — named upload slots below' }),
  Object.freeze({ n: 4, name: 'Provide Environments', packageDir: 'step4-environments', note: 'credential sub-blocks below — credentials themselves are supplied through the submission channel, never written into this package' }),
  Object.freeze({ n: 5, name: 'Review & Submit', packageDir: null, note: 'owner reviews and clicks Submit — the toolkit stops here; the human submits' }),
])

// ─── Step-3 upload slots + Step-4 credential sub-blocks — FROZEN ───────────────────
export const STEP3_UPLOAD_SLOTS = Object.freeze([
  'Architecture & Usage Documentation',
  'API Callouts documentation',
  'Security scanner reports',
  'False-positives documentation',
  'Other documentation',
])
export const STEP4_CREDENTIAL_SUBBLOCKS = Object.freeze([
  'Username/Password Authentication',
  'API/OAuth/SAML Access',
  'Desktop Clients',
  'Mobile Apps',
  'Other Test Environment Information',
])
export const PACKAGE_STEP_DIRS = Object.freeze([
  'step2-technical', 'step3-docs', 'step3-scans', 'step4-environments',
])

// ─── The artifact→slot map, keyed on baseline requirement ids — FROZEN ─────────────
// A row is emitted only when its `req` is in the manifest's applicableBaselineIds
// (read verbatim) AND, when `elements` is present, the manifest carries at least one
// element whose CANONICAL type is in the list. Rows with `req: null` are pure
// element-gated credential sub-blocks (no artifact this engine can copy — the wizard
// slot exists so the operator sees it was decided, not forgotten).
export const SLOT_MAP = Object.freeze([
  // Step 2 — Add Technical Details → step2-technical/
  { req: 'artifact-mcp-server-details', step: 2, slot: 'Technical Details', dir: 'step2-technical' },
  { req: 'artifact-required-materials-matrix', step: 2, slot: 'Technical Details', dir: 'step2-technical' },
  // Step 3 — Upload Documentation → step3-docs/ + step3-scans/
  { req: 'artifact-architecture-diagram', step: 3, slot: 'Architecture & Usage Documentation', dir: 'step3-docs' },
  { req: 'artifact-package-architecture-usage-docs', step: 3, slot: 'Architecture & Usage Documentation', dir: 'step3-docs' },
  { req: 'artifact-authn-authz-flow-doc', step: 3, slot: 'Architecture & Usage Documentation', dir: 'step3-docs' },
  { req: 'artifact-data-sensitivity-classification', step: 3, slot: 'Architecture & Usage Documentation', dir: 'step3-docs' },
  { req: 'artifact-access-control-permsets', step: 3, slot: 'Architecture & Usage Documentation', dir: 'step3-docs' },
  { req: 'artifact-user-documentation', step: 3, slot: 'Architecture & Usage Documentation', dir: 'step3-docs' },
  { req: 'artifact-api-endpoints-spec', step: 3, slot: 'API Callouts documentation', dir: 'step3-docs' },
  { req: 'artifact-exposed-tools-list', step: 3, slot: 'API Callouts documentation', dir: 'step3-docs' },
  { req: 'scan-code-analyzer-invocation', step: 3, slot: 'Security scanner reports', dir: 'step3-scans' },
  { req: 'scan-sfge-crud-fls-dataflow', step: 3, slot: 'Security scanner reports', dir: 'step3-scans' },
  { req: 'scan-checkmarx-partner-portal', step: 3, slot: 'Security scanner reports', dir: 'step3-scans' },
  { req: 'scan-external-sast', step: 3, slot: 'Security scanner reports', dir: 'step3-scans' },
  { req: 'scan-external-sca', step: 3, slot: 'Security scanner reports', dir: 'step3-scans' },
  { req: 'scan-iac-misconfig', step: 3, slot: 'Security scanner reports', dir: 'step3-scans' },
  { req: 'scan-dependency-vulnerabilities', step: 3, slot: 'Security scanner reports', dir: 'step3-scans' },
  { req: 'artifact-dast-scan-reports', step: 3, slot: 'Security scanner reports', dir: 'step3-scans' },
  { req: 'endpoint-ssl-labs-a-grade', step: 3, slot: 'Security scanner reports', dir: 'step3-scans' },
  { req: 'scan-false-positive-documentation', step: 3, slot: 'False-positives documentation', dir: 'step3-scans' },
  { req: 'artifact-fp-documentation-format', step: 3, slot: 'False-positives documentation', dir: 'step3-scans' },
  { req: 'artifact-incident-response-plan', step: 3, slot: 'Other documentation', dir: 'step3-docs' },
  { req: 'artifact-data-retention-deletion', step: 3, slot: 'Other documentation', dir: 'step3-docs' },
  { req: 'artifact-disaster-recovery-backup', step: 3, slot: 'Other documentation', dir: 'step3-docs' },
  { req: 'artifact-vuln-remediation-sla', step: 3, slot: 'Other documentation', dir: 'step3-docs' },
  { req: 'artifact-hosting-architecture', step: 3, slot: 'Other documentation', dir: 'step3-docs' },
  { req: 'artifact-prior-pentest-attestation', step: 3, slot: 'Other documentation', dir: 'step3-docs' },
  { req: 'artifact-agentexchange-questionnaire-na-reasons', step: 3, slot: 'Other documentation', dir: 'step3-docs' },
  { req: 'artifact-credential-storage-attestation', step: 3, slot: 'Other documentation', dir: 'step3-docs' },
  // Step 4 — Provide Environments → step4-environments/
  { req: 'artifact-org-credentials', step: 4, slot: 'Username/Password Authentication', dir: 'step4-environments' },
  { req: 'testenv-test-personas-documented', step: 4, slot: 'Username/Password Authentication', dir: 'step4-environments' },
  { req: 'artifact-third-party-creds-two-test-users', step: 4, slot: 'Username/Password Authentication', dir: 'step4-environments' },
  { req: 'testenv-external-test-instances', step: 4, slot: 'API/OAuth/SAML Access', dir: 'step4-environments', elements: ['external-endpoint', 'mcp-server'] },
  { req: null, step: 4, slot: 'Desktop Clients', dir: 'step4-environments', elements: ['desktop-client'] },
  { req: null, step: 4, slot: 'Mobile Apps', dir: 'step4-environments', elements: ['mobile'] },
  { req: 'testenv-usage-documentation', step: 4, slot: 'Other Test Environment Information', dir: 'step4-environments' },
  { req: 'artifact-testing-environment-agent-utterances', step: 4, slot: 'Other Test Environment Information', dir: 'step4-environments' },
  { req: 'testenv-mfa-disabled-for-reviewers', step: 4, slot: 'Other Test Environment Information', dir: 'step4-environments' },
  { req: 'endpoint-review-scanner-ip-allowlist', step: 4, slot: 'Other Test Environment Information', dir: 'step4-environments' },
].map(Object.freeze))

// ─── The fixed owner tail — item SKELETONS frozen; the perishable TEXT is parsed ───
// from the named baseline entries at assembly time (never hardcoded here).
export const OWNER_TAIL = Object.freeze([
  Object.freeze({
    id: 'process-submission-wizard',
    title: 'Complete the Security Review Wizard in the Partner Console, walking INDEX.md slot by slot.',
  }),
  Object.freeze({
    id: 'scan-checkmarx-partner-portal',
    title: 'Run the Partner Security Portal source-code scan (package leg only) and place the report in step3-scans/.',
  }),
  Object.freeze({
    id: 'process-review-fee',
    title: 'Pay the review fee in the Partner Console, then click Submit.',
  }),
])

// ─── Credential-shaped content patterns (CONVENTIONS §6 — fail closed) ─────────────
// High-precision by design: a runbook legitimately SAYS the word "password"; these
// fire on VALUES. Quoted-literal assignments exclude placeholder shapes
// (<from-vault>, {{SLOT}}, $ENV_VAR) so a runbook that points at a vault passes.
export const CREDENTIAL_PATTERNS = Object.freeze([
  Object.freeze({ name: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ }),
  Object.freeze({ name: 'aws-access-key-id', re: /\bAKIA[0-9A-Z]{16}\b/ }),
  Object.freeze({ name: 'sfdx-auth-url', re: /\bforce:\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]{10,}/ }),
  Object.freeze({ name: 'salesforce-session-id', re: /\b00D[A-Za-z0-9]{12,15}![A-Za-z0-9._+/=]{20,}/ }),
  Object.freeze({ name: 'bearer-token', re: /\bBearer\s+[A-Za-z0-9\-_.=]{25,}/ }),
  Object.freeze({ name: 'assigned-secret-literal', re: /\b(password|passwd|client_secret|api[_-]?key|access[_-]?token|secret)\b\s*[:=]\s*['"][^'"\s<>{}$]{8,}['"]/i }),
])

/** Pure: text → the names of every credential pattern that fires (empty = clean).
 * Returns pattern NAMES only — the matched value must never travel further. */
export function findCredentialLikeContent(text) {
  const s = String(text == null ? '' : text)
  return CREDENTIAL_PATTERNS.filter((p) => p.re.test(s)).map((p) => p.name)
}

// ─── Status inheritance (the evidence-index dispositions, fail closed) ─────────────
const isCreditable = (e) =>
  e && e.disposition === 'satisfied' && e.verified && e.verified.value === true && e.reviewer_reproducible === true
const isStaticClear = (e) =>
  e && (e.disposition === 'statically-cleared' ||
    (e.disposition === 'satisfied' && !(e.verified && e.verified.value === true && e.reviewer_reproducible === true)))

/** Pure: the evidence-index entries for one requirement → the inherited status.
 * Mirrors compute-sci's credit rule (fail closed): HAVE needs reviewer-reproducible
 * satisfied evidence; a satisfied row WITHOUT the flag is STATICALLY-CLEARED, never
 * HAVE; partial → PARTIAL; pending-owner or nothing → TODO. */
export function slotStatus(entries) {
  const es = Array.isArray(entries) ? entries : []
  if (!es.length) return 'TODO'
  if (es.some(isCreditable)) return 'HAVE'
  if (es.some(isStaticClear)) return 'STATICALLY-CLEARED'
  if (es.some((e) => e && e.disposition === 'partial')) return 'PARTIAL'
  return 'TODO'
}

/** Pure: baseline `automation` + the entries → the provenance marker.
 * manual_only → [M] (runbook only); a scanner-collected entry → [A]; an
 * agent-collected entry → [A/h]; no entry yet → [A] when the baseline says fully
 * automatable, else [A/h]. */
export function provenanceMarker(automation, entries) {
  if (automation === 'manual_only') return '[M]'
  const es = Array.isArray(entries) ? entries : []
  if (es.some((e) => e && e.collected_by === 'scanner')) return '[A]'
  if (es.length) return '[A/h]'
  return automation === 'fully' ? '[A]' : '[A/h]'
}

// ─── Baseline meta parse — dependency-free line parse (compute-sci's pattern, plus ──
// folded `>` blocks for requirement/details, flattened to one line).
export function parseBaselineMeta(yamlText) {
  const map = {}
  let cur = null
  let folding = null // { key, lines } while inside a `key: >` folded block
  const flush = () => {
    if (cur && folding) cur[folding.key] = folding.lines.join(' ').replace(/\s+/g, ' ').trim()
    folding = null
  }
  for (const raw of String(yamlText == null ? '' : yamlText).split('\n')) {
    if (folding) {
      if (raw.trim() === '' || /^\s{3,}\S/.test(raw)) { folding.lines.push(raw.trim()); continue }
      flush() // block ended — fall through and parse this line normally
    }
    const idm = raw.match(/^- id:\s*(\S+)/)
    if (idm) { cur = { id: idm[1] }; map[cur.id] = cur; continue }
    if (!cur) continue
    const fold = raw.match(/^\s{2}(requirement|details):\s*>\s*$/)
    if (fold) { folding = { key: fold[1], lines: [] }; continue }
    const single = raw.match(/^\s{2}(requirement|details):\s*(\S.*)$/)
    if (single) { cur[single[1]] = single[2].trim(); continue }
    const auto = raw.match(/^\s{2}automation:\s*(\S+)/)
    if (auto) { cur.automation = auto[1]; continue }
    const lv = raw.match(/^\s{2}last_verified:\s*["']?([0-9]{4}-[0-9]{2}-[0-9]{2})/)
    if (lv) cur.last_verified = lv[1]
  }
  flush()
  return map
}

// ─── Rendering helpers ─────────────────────────────────────────────────────────────
// One safe Markdown-table cell: collapse whitespace, escape pipes, em-dash when empty.
function cell(v) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()
  return s || '—'
}

// ─── main ──────────────────────────────────────────────────────────────────────────
function arg(flag, def) {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}

function fail(msg, code = 1) {
  console.error(`assemble-submission-package: ${msg}`)
  process.exit(code)
}

function main() {
  const TARGET = arg('--target', arg('--repo', null))
  const PLUGIN = arg('--plugin', fileURLToPath(new URL('..', import.meta.url)))
  const DATE = arg('--date', null)
  if (!TARGET) fail('missing --target <repo> (or --repo)')
  if (!DATE || !/^\d{4}-\d{2}-\d{2}$/.test(DATE)) {
    fail('missing or malformed --date YYYY-MM-DD — the assembly is date-pinned, never wall-clock')
  }

  const SR = join(TARGET, '.security-review')
  const readStrict = (p, what) => {
    let raw
    try { raw = readFileSync(p, 'utf8') } catch { fail(`unreadable ${what} at ${p} — refusing to assemble without it`) }
    try { return JSON.parse(raw) } catch { fail(`${what} at ${p} is not valid JSON — refusing to assemble over a corrupt input`) }
  }

  // 1. Inputs — manifest + evidence index are HARD requirements (fail closed).
  const manifest = readStrict(join(SR, 'scope-manifest.json'), 'scope manifest')
  const applicable = Array.isArray(manifest.applicableBaselineIds) ? manifest.applicableBaselineIds : null
  if (!applicable) fail('scope manifest carries no applicableBaselineIds[] — re-run scope-submission; this engine never re-derives applicability')
  const evidence = readStrict(join(SR, 'evidence', 'index.json'), 'evidence index')
  const evEntries = Array.isArray(evidence.entries) ? evidence.entries : null
  if (!evEntries) fail('evidence index carries no entries[] — build it with build-evidence-index.mjs first')
  let ledger = null
  try { ledger = JSON.parse(readFileSync(join(SR, 'audit-ledger.json'), 'utf8')) } catch { ledger = null }

  // 2. The SCI gate — inherit compute-sci's refusal; never assemble over a refused SCI.
  const sciPath = join(fileURLToPath(new URL('.', import.meta.url)), 'compute-sci.mjs')
  const sci = spawnSync(process.execPath, [sciPath, '--target', TARGET, '--plugin', PLUGIN, '--date', DATE, '--json'], { encoding: 'utf8' })
  if (sci.status !== 0) {
    process.stdout.write(String(sci.stdout || ''))
    process.stderr.write(String(sci.stderr || ''))
    fail(`compute-sci exited ${sci.status} — refusing to assemble over a refused SCI (nothing was written)`, sci.status || 1)
  }
  let sciJson
  try { sciJson = JSON.parse(sci.stdout) } catch { fail('compute-sci produced unparsable output — refusing to assemble') }

  // 3. Baseline meta — automation (provenance markers) + the owner-tail perishable text.
  const baselinePath = join(PLUGIN, 'baseline', 'requirements-baseline.yaml')
  if (!existsSync(baselinePath)) fail(`no baseline at ${baselinePath} — the owner tail and provenance markers parse from it`)
  const baseline = parseBaselineMeta(readFileSync(baselinePath, 'utf8'))

  // 4. Gate + derive the slot rows. Applicability verbatim; elements canonicalized.
  const applicableSet = new Set(applicable)
  const elementSet = new Set(
    (Array.isArray(manifest.elements) ? manifest.elements : [])
      .map((e) => e && e.type)
      .filter((t) => typeof t === 'string' && t.trim() !== '')
      .map((t) => String(canonicalElementType(t.trim())))
  )
  const emitted = []
  const suppressed = []
  for (const row of SLOT_MAP) {
    const label = row.req ? `Step ${row.step} · ${row.slot} · ${row.req}` : `Step ${row.step} · ${row.slot} (credential sub-block)`
    if (row.elements && !row.elements.some((el) => elementSet.has(el))) {
      suppressed.push({ label, reason: `not applicable: no ${row.elements.join('/')} element in scope` })
      continue
    }
    if (row.req && !applicableSet.has(row.req)) {
      suppressed.push({ label, reason: 'baseline id not in the manifest\'s applicableBaselineIds' })
      continue
    }
    const entries = row.req ? evEntries.filter((e) => e && e.ref_type === 'requirement' && e.ref_id === row.req) : []
    emitted.push({
      ...row,
      entries,
      status: row.req ? slotStatus(entries) : 'TODO',
      marker: row.req ? provenanceMarker(baseline[row.req] && baseline[row.req].automation, entries) : '[M]',
    })
  }

  // 5. The copy plan — every on-disk location the emitted rows reference, plus the
  // readiness verdict. Copies only; originals stay canonical.
  const relOf = (loc) => String(loc || '').replace(/^\/+/, '')
  const plan = [] // { src, destDir, destName, packageRel }
  const claimed = new Map() // `${destDir}/${destName}` → src (collision → req-prefixed name)
  for (const row of emitted) {
    row.files = [] // package-relative paths, for the INDEX cell
    row.gaps = [] // referenced locations NOT on disk (surfaced, never re-classified)
    const locs = [...new Set(row.entries.map((e) => relOf(e.location)).filter(Boolean))].sort()
    for (const rel of locs) {
      const src = join(TARGET, rel)
      if (!existsSync(src)) { row.gaps.push(rel); continue }
      let destName = basename(rel)
      const key = () => `${row.dir}/${destName}`
      if (claimed.has(key()) && claimed.get(key()) !== src) destName = `${row.req}--${destName}`
      if (claimed.get(key()) === src) { row.files.push(key()); continue }
      claimed.set(key(), src)
      plan.push({ src, destDir: row.dir, destName, packageRel: key() })
      row.files.push(key())
    }
  }
  const verdictSrc = join(TARGET, 'docs', 'security-review', 'submission', 'readiness-verdict.md')
  const verdictOnDisk = existsSync(verdictSrc)

  // 6. Render both documents (before the scan so their content is scanned too).
  const openFindings = ledger && Array.isArray(ledger.findings)
    ? ledger.findings.filter((f) => ['confirmed', 'regressed'].includes(String(f && f.status || '').toLowerCase())).length
    : null
  const indexMd = renderIndex({ DATE, sciJson, openFindings, emitted, suppressed, verdictOnDisk })
  const pendingMd = renderPendingOwnerRun({ DATE, evEntries, baseline, applicableSet })

  // 7. CREDENTIAL-REFUSAL (CONVENTIONS §6) — scan everything that would land in the
  // package BEFORE any copy. Fail closed; name the file + pattern, never the value.
  const hits = []
  for (const p of plan) {
    let names = []
    try { names = findCredentialLikeContent(readFileSync(p.src, 'utf8')) } catch { names = [] }
    for (const n of names) hits.push(`${p.src} → ${n}`)
  }
  if (verdictOnDisk) {
    for (const n of findCredentialLikeContent(readFileSync(verdictSrc, 'utf8'))) hits.push(`${verdictSrc} → ${n}`)
  }
  for (const n of findCredentialLikeContent(indexMd)) hits.push(`INDEX.md (rendered) → ${n}`)
  for (const n of findCredentialLikeContent(pendingMd)) hits.push(`PENDING-OWNER-RUN.md (rendered) → ${n}`)
  if (hits.length) {
    console.error('assemble-submission-package: CREDENTIAL REFUSAL — credential-shaped content detected; nothing was assembled (CONVENTIONS §6).')
    console.error('Remove the value from the source file and point at the env-var / vault location instead:')
    for (const h of hits.sort()) console.error(`  ${h}`)
    process.exit(1)
  }

  // 8. Assemble — rebuild the package dir from scratch (byte-identical re-runs).
  const pkgDir = join(TARGET, 'docs', 'security-review', 'submission-package')
  rmSync(pkgDir, { recursive: true, force: true })
  for (const d of PACKAGE_STEP_DIRS) mkdirSync(join(pkgDir, d), { recursive: true })
  for (const p of plan.sort((a, b) => a.packageRel.localeCompare(b.packageRel))) {
    copyFileSync(p.src, join(pkgDir, p.destDir, p.destName))
  }
  if (verdictOnDisk) {
    copyFileSync(verdictSrc, join(pkgDir, 'readiness-verdict.md'))
  } else {
    writeFileSync(join(pkgDir, 'readiness-verdict.md'), [
      '# readiness-verdict.md — TODO',
      '',
      `Not found at docs/security-review/submission/readiness-verdict.md as of ${DATE}.`,
      'Run compile-submission step 8 (the rendered verdict) first, then re-run this assembler.',
      'This placeholder is an honest gap, not a verdict.',
      '',
    ].join('\n'))
  }
  writeFileSync(join(pkgDir, 'INDEX.md'), indexMd)
  writeFileSync(join(pkgDir, 'PENDING-OWNER-RUN.md'), pendingMd)

  console.log(`submission-package assembled at ${pkgDir}`)
  console.log(`  slot rows: ${emitted.length} emitted · ${suppressed.length} suppressed (see INDEX.md)`)
  console.log(`  files copied: ${plan.length} (originals untouched) · readiness-verdict: ${verdictOnDisk ? 'copied' : 'TODO placeholder (step 8 has not run)'}`)
  console.log(`  SCI band at assembly: ${sciJson.band} (completeness ${sciJson.completeness_pct}% — materials, not pass-odds)`)
}

// ─── INDEX.md — the wizard-slot map ────────────────────────────────────────────────
function renderIndex({ DATE, sciJson, openFindings, emitted, suppressed, verdictOnDisk }) {
  const L = []
  L.push('# Submission package INDEX — the wizard-slot map')
  L.push('')
  L.push(`Generated: ${DATE} · SCI band at assembly: **${sciJson.band}** (completeness ${sciJson.completeness_pct}% — materials + disposition completeness, NOT a pass prediction)`)
  L.push(openFindings == null
    ? 'Audit ledger: none on disk — the audit has not run; this package is UNAUDITED material.'
    : `Audit ledger: ${openFindings} open finding(s) (confirmed/regressed) at assembly.`)
  L.push(verdictOnDisk
    ? 'readiness-verdict.md: copied in from docs/security-review/submission/readiness-verdict.md.'
    : 'readiness-verdict.md: NOT found — a TODO placeholder rides in its slot; run compile-submission step 8.')
  L.push('')
  L.push('Every status below is INHERITED from the evidence index, never re-classified here:')
  L.push('HAVE only with reviewer-reproducible verified evidence; PARTIAL names owner work that')
  L.push('remains; TODO is an open gap; STATICALLY-CLEARED is the toolkit\'s own static audit —')
  L.push('surfaced, never HAVE. The strongest row this file carries is HAVE-with-verified-evidence;')
  L.push('Salesforce pen-tests the live solution regardless of anything in this package.')
  L.push('')
  L.push('## The Security Review Wizard\'s five steps (pinned)')
  L.push('')
  for (const s of WIZARD_STEPS) {
    L.push(`${s.n}. **${s.name}**${s.packageDir ? ` → \`${s.packageDir}\`` : ''} — ${s.note}`)
  }
  L.push('')
  L.push('## Artifact → wizard-slot map')
  L.push('')
  L.push('| Wizard step | Upload slot | Baseline requirement | Status | Provenance | File(s) in package |')
  L.push('|---|---|---|---|---|---|')
  for (const row of emitted) {
    const step = WIZARD_STEPS.find((s) => s.n === row.step)
    const fileCell = row.req
      ? [...row.files, ...row.gaps.map((g) => `(referenced but not on disk: ${g})`)].join(' · ') || '(no file on disk yet)'
      : '(credentials are supplied through the submission channel — runbook only, never a file in this package)'
    L.push(`| Step ${row.step} — ${cell(step.name)} | ${cell(row.slot)} | ${cell(row.req || '—')} | ${cell(row.status)} | \`${row.marker}\` | ${cell(fileCell)} |`)
  }
  L.push('')
  L.push('Provenance markers: `[A]` toolkit-generated outright · `[A/h]` toolkit-drafted, owner-run or owner-confirmed before it ships · `[M]` manual — the toolkit supplies a runbook only.')
  L.push('Copies, never moves: every file above is a COPY; the canonical originals stay where re-compiles and re-audits read them.')
  L.push('')
  L.push('## Suppressed (not applicable)')
  L.push('')
  if (suppressed.length) {
    for (const s of suppressed) L.push(`- ${s.label} — ${s.reason}`)
  } else {
    L.push('- none — every pinned slot applies to this scope')
  }
  L.push('')
  return L.join('\n')
}

// ─── PENDING-OWNER-RUN.md — the human tail ─────────────────────────────────────────
function renderPendingOwnerRun({ DATE, evEntries, baseline, applicableSet }) {
  const L = []
  L.push('# PENDING-OWNER-RUN — the human tail')
  L.push('')
  L.push(`Generated: ${DATE}. The toolkit stops at wizard Step 5 and the human submits — every`)
  L.push('item below is something the toolkit prepared but cannot execute. Perishable specifics')
  L.push('(fee, run budgets, wizard mechanics) are quoted from the baseline at assembly time;')
  L.push('confirm each live in the Partner Console before acting on it.')
  L.push('')
  L.push('## Pending owner actions from the evidence index')
  L.push('')
  const pending = evEntries
    .filter((e) => e && e.disposition === 'pending-owner')
    .map((e) => ({ ref: String(e.ref_id || ''), loc: String(e.location || ''), note: String(e.note || '') }))
  const seen = new Set()
  const rows = pending
    .filter((r) => { const k = `${r.ref} ${r.loc} ${r.note}`; if (seen.has(k)) return false; seen.add(k); return true })
    .sort((a, b) => a.ref.localeCompare(b.ref) || a.loc.localeCompare(b.loc))
  if (rows.length) {
    L.push('| Requirement | Prepared plan / location | Note |')
    L.push('|---|---|---|')
    for (const r of rows) L.push(`| ${cell(r.ref)} | ${cell(r.loc)} | ${cell(r.note)} |`)
  } else {
    L.push('No pending-owner rows in the evidence index.')
  }
  L.push('')
  L.push('## The fixed owner tail (baseline-quoted, in order)')
  L.push('')
  let n = 0
  for (const item of OWNER_TAIL) {
    n++
    if (!applicableSet.has(item.id)) {
      L.push(`${n}. ~~${item.title}~~ — not applicable: \`${item.id}\` is not in the manifest's applicableBaselineIds.`)
      L.push('')
      continue
    }
    L.push(`${n}. **${item.title}**`)
    const b = baseline[item.id]
    if (b && (b.requirement || b.details)) {
      if (b.requirement) L.push(`   > ${b.requirement}`)
      if (b.details) L.push(`   > ${b.details}`)
      L.push(`   _(baseline: \`${item.id}\` — last_verified ${b.last_verified || 'never'}; perishable — confirm live before acting.)_`)
    } else {
      L.push(`   _(baseline entry \`${item.id}\` not readable from the plugin baseline — read it there directly, then confirm live; this engine hardcodes no fee, budget, or wizard fact.)_`)
    }
    L.push('')
  }
  n++
  L.push(`${n}. **Enter the test-environment credentials into the wizard Step-4 slots.** They are supplied separately through the submission channel and are never written into any package file (CONVENTIONS §6) — this package carries only the runbooks that say which persona goes in which slot.`)
  L.push('')
  return L.join('\n')
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

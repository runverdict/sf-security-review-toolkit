#!/usr/bin/env node
/*
 * ingest-scanner-findings.mjs — turn DETERMINISTIC scanner / metadata output into
 * provenance-tagged `deterministic` audit-ledger findings (Phase 1 · Slice 1 of
 * docs/roadmap-deterministic-findings.md — the ingest foundation).
 *
 * WHY this exists. A 5-run cold campaign proved the LLM-generated blocker band is
 * unstable run-to-run (CRUD/FLS findings flickered high·high·ABSENT·high·high). Yet
 * Code Analyzer (PMD/SFGE) finds those exact bugs DETERMINISTICALLY every run — its
 * output just never reached the ledger. This engine is that missing path: a scanner
 * finding becomes a ledger finding with provenance:'deterministic', the engine +
 * ruleId that fired, and a severity taken from the REQUIREMENT CLASS (not the LLM,
 * and not the scanner's own 1-5 number). The LLM stops being the source of truth for
 * anything an engine already determined.
 *
 * PLUGGABLE ADAPTER REGISTRY (so Semgrep / OSV / gitleaks / Checkov land as a new
 * adapter object, never a rewrite). Every adapter is the SAME shape:
 *
 *   { name, kind, collect({input,target}) -> raw|null, parse(raw) -> hits[], classify(ruleId) -> classKey|null }
 *
 * Two adapter KINDS, both shipped in Slice 1 to prove the seam handles N>1 and both:
 *   - file-parser   — collect() reads a scanner's CAPTURED output file (--input).
 *                     Adapter #1: `code-analyzer` (PMD + SFGE violations JSON).
 *                     Adapter #3 (Phase 2 · 2a #1): `checkov` (IaC-misconfig JSON; engine:'checkov').
 *                     Adapter #4 (Phase 2 · 2a #2): `semgrep` (multi-language SAST JSON;
 *                       engine:'semgrep') — the FIRST tool→band adapter (severity from the
 *                       tool's own ERROR/WARNING/INFO, owns no toolkit class).
 *                     Adapter #5 (Phase 2 · 2a #3): `bandit` (Python SAST JSON; engine:'bandit')
 *                       — the SECOND tool→band adapter, the proof the Semgrep tool→band path
 *                       GENERALIZES (severity from HIGH/MEDIUM/LOW, owns no class, NO harness change).
 *                     Future: njsscan, OSV, gitleaks — all parse a JSON file the same way.
 *   - source-scanner — collect() greps the repo source directly (no external tool).
 *                     Adapter #2: `metadata-viewall` (engine:'metadata') — scans
 *                     permissionsets/*.permissionset-meta.xml for ViewAll/ModifyAll
 *                     over-grants, the one class Code Analyzer doesn't cover (it's
 *                     permission-set XML, not Apex).
 *
 * The core `ingest(raw, adapter, {repoRoot, pass})` is PURE (no Date / Math.random /
 * network; byte-deterministic given `raw`) — `collect()` is the only I/O seam, so the
 * standing test drives `ingest` on in-memory fixtures. Re-ingesting the same scanner
 * output is idempotent: a deterministic finding's id is stable from engine+ruleId+file:line,
 * so the merge dedups it (no duplicates).
 *
 * SCOPE: ingest + a Security/AppExchange TAG FILTER (Slice 2) — the three wobbled
 * classes (CRUD/FLS, sharing, ViewAll/ModifyAll) get provenance + class-severity, and a
 * MAPPED finding also carries its toolkit `class` (the owned-class label the supersession
 * engine reads). Only a Security/AppExchange-tagged Code Analyzer rule becomes a finding
 * (raw CA output is dominated by ApexDoc/naming/codestyle/Performance noise) — this is a
 * filter on non-security NOISE, NOT a drop of a security finding: an unmapped *security*
 * rule is still ingested as deterministic (never silently dropped) with the documented
 * Code-Analyzer-severity fallback. LLM-supersession ENFORCEMENT (a deterministic finding
 * supersedes a co-located same-class LLM finding) lives in its own pure engine,
 * harness/reconcile-provenance.mjs (Slice 2); journey re-sequencing is Slice 3.
 *
 * Read-only on partner source except the ledger it merges into
 * (<target>/.security-review/audit-ledger.json).
 *
 * Usage:
 *   node ingest-scanner-findings.mjs --scanner code-analyzer  --input CodeAnalyzer.json --target <repo> [--json] [--dry-run] [--pass N]
 *   node ingest-scanner-findings.mjs --scanner metadata-viewall                          --target <repo> [--json] [--dry-run] [--pass N]
 *   node ingest-scanner-findings.mjs --scanner checkov         --input checkov.json       --target <repo> [--json] [--dry-run] [--pass N]
 *   node ingest-scanner-findings.mjs --scanner semgrep         --input semgrep.json       --target <repo> [--json] [--dry-run] [--pass N]
 *   node ingest-scanner-findings.mjs --scanner bandit          --input bandit.json        --target <repo> [--json] [--dry-run] [--pass N]
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ----------------------------------------------------------------------------
// Severity taxonomies. The baseline speaks `blocker/major/minor/informational`
// (severity_if_missing); the finding schema speaks `critical/high/medium/low/info`.
// This is the single canonical conversion — there was none before this slice.
// ----------------------------------------------------------------------------
export const REQ_SEVERITY_TO_FINDING = {
  blocker: 'critical',
  major: 'high',
  minor: 'low',
  informational: 'info',
}
// Code Analyzer's own 1-5 scale (1 = most severe). Used ONLY as the fallback for a
// rule with no toolkit class mapping — never for a mapped class (whose severity is
// the requirement-class severity, full stop).
export const CA_SEVERITY_TO_FINDING = {
  1: 'critical',
  2: 'high',
  3: 'medium',
  4: 'low',
  5: 'info',
}
// Semgrep's per-finding severity (Phase 2 · 2a #2 — the FIRST genuine tool→band adapter,
// roadmap §10). Semgrep — unlike Code Analyzer / Checkov — carries a REAL per-result
// severity (`ERROR`/`WARNING`/`INFO`), so for SAST the tool's own band IS the honest
// per-finding signal: a `WARNING` SSRF is genuinely medium, not the class-`high` you'd get
// by collapsing every SAST hit to `scan-external-sast` (major). This is NOT a violation of
// severity-from-class (§9): Code Analyzer's Apex rules re-home onto the review's 3 wobbled
// CLASSES whose severity the review defines; Semgrep's general SAST rules map onto NO such
// class, so the tool band is the meaningful source. DELIBERATE calibration choice (documented
// in the CHANGELOG): `ERROR → high`, NOT critical/blocker — a raw Semgrep ERROR flags a sink
// but does NOT confirm reachability; escalating to a blocker is a reachability judgment that
// belongs to the LLM/human residual (the "reachability-is-a-precondition" rule), which a
// mechanical SAST hit lacks. An unknown/rare severity (Semgrep's `INVENTORY`/`EXPERIMENT` rule
// classes) maps to `info` — never dropped. (The toolkit's canonical invocation uses the
// security rulesets p/security-audit / p/secrets / p/<lang>, which emit only ERROR/WARNING/INFO.)
export const SEMGREP_SEVERITY_TO_FINDING = { ERROR: 'high', WARNING: 'medium', INFO: 'low' }
// Bandit's per-finding severity (Phase 2 · 2a #3 — the THIRD tool→band adapter, the proof the
// Semgrep `tool→band` generalization GENERALIZES with ZERO harness-core change). Bandit is the
// Python language-gate SAST tool (run-scans Family 7, alongside Semgrep/njsscan/gosec). It carries
// a REAL per-result `issue_severity` (`HIGH`/`MEDIUM`/`LOW`), owns no toolkit class, and groups
// under `external-sast` — exactly Semgrep's shape, so it reuses `buildFinding`'s `bandFromTool`
// path verbatim. Same calibration call as Semgrep `ERROR→high`: `HIGH → high`, NOT critical/blocker
// — a mechanical SAST hit flags a sink but does NOT confirm reachability; blocker-escalation is the
// LLM/human residual. An unknown/missing `issue_severity` → `info`, never dropped. NOTE: Bandit also
// emits `issue_confidence` (HIGH/MEDIUM/LOW); it is NOT used for the band in this slice (the band is
// `issue_severity`, confidence is recorded only for reference) — a confidence-weighted refinement is
// a Phase-2b note, like Checkov's per-check-severity deferral.
export const BANDIT_SEVERITY_TO_FINDING = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low' }

// ----------------------------------------------------------------------------
// Security/AppExchange tag filter (Slice 2 — roadmap §10 extension #2).
// Raw Code Analyzer output is dominated by NON-security rules (ApexDoc, naming,
// codestyle, Performance — one captured fixture was 23/23 best-practices). A SECURITY
// ledger must not ingest those: only a violation whose `tags` include `Security` or
// `AppExchange` becomes a finding. This is a FILTER on non-security noise — NOT a drop
// of a security finding: a security-tagged rule with no class mapping still passes here
// and ingests via the Code-Analyzer-severity fallback (the "never drop an unmapped
// SECURITY rule" rule holds). The metadata source-scanner emits only over-grants, so it
// has no filter (every emission is security by construction). SFGE's Performance-tagged
// `MissingNullCheckOnSoqlVariable` is excluded by this same rule (Performance ∌ Security).
export const SECURITY_TAGS = ['security', 'appexchange']
export function hasSecurityTag(tags) {
  if (!Array.isArray(tags)) return false
  return tags.some((t) => SECURITY_TAGS.includes(String(t).toLowerCase()))
}

// The three wobbled classes Slice 1 re-homes onto the scanners. Each carries the
// baseline requirement its severity is READ FROM (so "severity from class" literally
// tracks the baseline), a `fallback` if the baseline can't be read, and the dimension.
//   viewall-overgrant grounds its severity in fail-sharing-model because a ViewAll/
//   ModifyAll over-grant IS a sharing-rules bypass (official taxonomy + the Solano C5
//   adjudication: "viewAllRecords=true ... a sharing bypass", HIGH floor).
//   iac-misconfig (Phase 2 · adapter 2a #1, Checkov) grounds its severity in scan-iac-misconfig
//   (severity_if_missing: major → high). Its `dimension` 'infrastructure-iac' is a
//   DETERMINISTIC-ONLY grouping label: IaC misconfig is fully deterministic (Checkov/Trivy),
//   so it has NO LLM finder dimension and deliberately NO methodology/dimensions/ file — the
//   schema declares `dimension` a free kebab-case string (not an enum), and nothing validates a
//   finding's dimension against the methodology-file set, so this label needs no dimension doc.
export const CLASS_DEFS = {
  'crud-fls': { baselineId: 'fail-crud-fls', dimension: 'apex-exposed-surface', fallback: 'high' },
  'sharing': { baselineId: 'fail-sharing-model', dimension: 'apex-exposed-surface', fallback: 'high' },
  'viewall-overgrant': { baselineId: 'fail-sharing-model', dimension: 'admin-surface', fallback: 'high' },
  'iac-misconfig': { baselineId: 'scan-iac-misconfig', dimension: 'infrastructure-iac', fallback: 'high' },
}
const DEFAULT_DIMENSION = 'apex-exposed-surface'

// Scanner rule name -> toolkit class. Extend in Phase 2 (hardcoded secrets, SOQLi,
// XSS, deps). The prompt named `ApexFlsViolationRule`; the real fixtures emit
// `ApexFlsViolation` — both alias to crud-fls so neither spelling is ever dropped.
export const RULE_CLASS = {
  ApexCRUDViolation: 'crud-fls',
  ApexFlsViolation: 'crud-fls',
  ApexFlsViolationRule: 'crud-fls',
  DatabaseOperationsMustUseWithSharing: 'sharing',
  ApexSharingViolations: 'sharing',
}

const VIEWALL_DOC =
  'https://developer.salesforce.com/docs/atlas.en-us.packagingGuide.meta/packagingGuide/secure_code_violation_access_settings.htm'
const PS_OVERGRANT_FLAGS = ['viewAllRecords', 'modifyAllRecords', 'modifyAllData']

// ----------------------------------------------------------------------------
// baseline-grounded class severity (cached read of the committed baseline)
// ----------------------------------------------------------------------------
let _baselineText
function baselineText() {
  if (_baselineText != null) return _baselineText
  try {
    _baselineText = readFileSync(new URL('../baseline/requirements-baseline.yaml', import.meta.url), 'utf8')
  } catch {
    _baselineText = ''
  }
  return _baselineText
}
export function baselineSeverityFor(reqId) {
  const txt = baselineText()
  if (!txt) return null
  const lines = txt.split('\n')
  const i = lines.findIndex((l) => l.replace(/\s+$/, '') === `- id: ${reqId}`)
  if (i < 0) return null
  for (let j = i + 1; j < lines.length; j++) {
    if (/^-\s+id:\s/.test(lines[j])) break // ran into the next entry; not in this block
    const sm = /^\s*severity_if_missing:\s*([a-z]+)\s*$/.exec(lines[j])
    if (sm) return sm[1]
  }
  return null
}
export function classSeverity(classKey) {
  const def = CLASS_DEFS[classKey]
  if (!def) return null
  const reqSev = baselineSeverityFor(def.baselineId)
  const mapped = reqSev ? REQ_SEVERITY_TO_FINDING[reqSev] : null
  return { severity: mapped || def.fallback, reqSev, baselineId: def.baselineId, fromBaseline: !!mapped }
}

// ----------------------------------------------------------------------------
// small deterministic helpers
// ----------------------------------------------------------------------------
function repoRel(p, root) {
  let s = String(p || '').replace(/\\/g, '/')
  if (root) {
    const r = String(root).replace(/\\/g, '/').replace(/\/+$/, '')
    if (r && s.startsWith(r + '/')) s = s.slice(r.length + 1)
  }
  return s.replace(/^\/+/, '')
}
const sha256id = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 16)
const oneLine = (s, n = 200) => {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}
// generic secret redaction (CONVENTIONS §6) — values, never names; mirrors merge-ledger.mjs
const redact = (s) =>
  String(s == null ? '' : s)
    .replace(
      /((?:secret|password|passwd|pwd|api[_-]?key|apikey|access[_-]?key|client[_-]?secret|private[_-]?key|token|bearer|authorization)\s*["']?\s*[:=]\s*)["']?[A-Za-z0-9._\-+/=]{6,}["']?/gi,
      '$1***redacted***'
    )
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, '***redacted-jwt***')

function recommendationFor(classKey) {
  switch (classKey) {
    case 'crud-fls':
      return 'Enforce object- and field-level access before this DML/SOQL (WITH USER_MODE, Security.stripInaccessible, or an explicit describe check) and degrade gracefully when access is denied.'
    case 'sharing':
      return 'Perform this data access from a class that declares an explicit sharing model (with sharing, or with inherited sharing where the whole solution is sharing-clean).'
    case 'viewall-overgrant':
      return 'Remove the ViewAll/ModifyAll grant on this custom object and scope access through sharing rules; if the broad grant is a documented business requirement, justify it in the false-positive dossier.'
    case 'iac-misconfig':
      return 'Remediate the flagged infrastructure-as-code misconfiguration (or document a justified false positive in the dossier — scan-iac-misconfig). Follow the linked Checkov guideline.'
    default:
      return 'Fix the flagged code or document a justified false positive in the dossier (baseline scan-no-clean-scan-required).'
  }
}

// ----------------------------------------------------------------------------
// the finding builder — shared by every adapter / kind
// ----------------------------------------------------------------------------
export function buildFinding({ engine, ruleId, severityNum, file, startLine, message, resources, classKey, repoRoot, pass, bandFromTool, dimensionHint, toolSevLabel }) {
  const passId = Number.isInteger(pass) && pass >= 1 ? pass : 1
  const rel = repoRel(file, repoRoot)
  const loc = startLine != null ? `${rel}:${startLine}` : rel
  const id = sha256id(`${engine}\n${ruleId}\n${loc}`)

  let adjusted, dimension, sevReason
  if (classKey && CLASS_DEFS[classKey]) {
    // MAPPED CLASS — severity from the class, NEVER the scanner number/band. UNTOUCHED by
    // the tool→band generalization: a mapped classKey always wins, even if bandFromTool is
    // also present (class-severity adapters like code-analyzer/checkov never let the tool move
    // a mapped finding). Guarded by S1 + the buildFinding regression check.
    const cs = classSeverity(classKey)
    adjusted = cs.severity
    dimension = CLASS_DEFS[classKey].dimension
    sevReason = `severity fixed from the ${classKey} class (baseline requirement ${cs.baselineId}${cs.reqSev ? ` = ${cs.reqSev}` : ''})`
  } else if (bandFromTool) {
    // TOOL→BAND (Phase 2 · 2a #2 Semgrep — the first genuine tool→band path). The hit owns no
    // toolkit class, but the scanner carries a real per-finding severity already resolved to a
    // finding band (via SEMGREP_SEVERITY_TO_FINDING). Use it directly; the requirement gate
    // (scan-external-sast = major) governs the BAND, not this per-finding severity.
    adjusted = bandFromTool
    dimension = dimensionHint || DEFAULT_DIMENSION
    sevReason =
      `severity from the ${engine} tool band (${toolSevLabel || 'unknown'} → ${adjusted}); ` +
      `${engine} carries its own per-finding severity, gated by scan-external-sast (major)`
  } else {
    // UNMAPPED FALLBACK — the Code-Analyzer 1-5 scale (a security-tagged CA rule with no class
    // mapping). dimensionHint is honoured so a future no-band adapter can still group, but
    // Semgrep always supplies a band so it never reaches here.
    adjusted = (severityNum != null && CA_SEVERITY_TO_FINDING[severityNum]) || 'medium'
    dimension = dimensionHint || DEFAULT_DIMENSION
    sevReason =
      `no toolkit class maps rule ${ruleId} yet (Phase 2 extends the class map) — severity falls back to the ` +
      `Code Analyzer scale (sev ${severityNum == null ? 'n/a' : severityNum} → ${adjusted})`
  }

  const ref = Array.isArray(resources) && resources[0] ? ` See ${resources[0]}.` : ''
  const caNote = severityNum != null && classKey && CLASS_DEFS[classKey]
    ? ` Code Analyzer severity ${severityNum} is recorded for reference, not authoritative.`
    : ''
  const reasoning = redact(
    `${String(engine).toUpperCase()} rule ${ruleId} deterministically flagged this at ${loc}. ${oneLine(message, 240)}${ref} ` +
      `Provenance: deterministic (scanner-relayed, not an LLM judgment); ${sevReason}.${caNote}`
  )

  const finding = {
    id,
    dimension,
    title: `${ruleId}: ${oneLine(message, 140)}`,
    severity: adjusted,
    adjusted_severity: adjusted,
    file: loc,
    status: 'confirmed',
    first_seen: passId,
    last_seen: passId,
    verdict: 'confirmed_real',
    verdict_reasoning: reasoning,
    evidence: redact(`${loc} — ${oneLine(message, 240)}`),
    recommendation: recommendationFor(classKey),
    resolution_note: oneLine(`${ruleId} (${classKey || 'unmapped rule'}) — ${message}`, 160),
    provenance: 'deterministic',
    engine: String(engine),
    ruleId: String(ruleId),
  }
  // The owned-class label, set ONLY for a MAPPED class (an unmapped fallback finding owns
  // no class). harness/reconcile-provenance.mjs reads this: a deterministic finding
  // supersedes a co-located LLM finding ONLY in a class it owns — so an unmapped
  // deterministic finding (no `class`) never supersedes anything.
  if (classKey && CLASS_DEFS[classKey]) finding.class = classKey
  return finding
}

// ----------------------------------------------------------------------------
// the PURE core: raw (already collected) + adapter -> findings. No I/O, no Date.
// ----------------------------------------------------------------------------
export function ingest(raw, adapter, opts = {}) {
  const repoRoot = opts.repoRoot || ''
  const pass = Number.isInteger(opts.pass) && opts.pass >= 1 ? opts.pass : 1
  const notes = []
  if (raw == null) {
    notes.push(`${adapter.name}: no input collected (missing/unreadable/empty) — no findings`)
    return { findings: [], notes }
  }
  let hits
  try {
    hits = adapter.parse(raw)
  } catch (e) {
    notes.push(`${adapter.name}: parse failed (${e && e.message}) — no findings`)
    return { findings: [], notes }
  }
  if (!Array.isArray(hits)) hits = []
  if (!hits.length) notes.push(`${adapter.name}: 0 violations in input — no findings`)

  const findings = []
  for (const h of hits) {
    if (!h || !h.file || h.ruleId == null || h.engine == null) {
      notes.push(`${adapter.name}: skipped a malformed hit (missing engine/ruleId/file)`)
      continue
    }
    // Security/AppExchange tag filter (Slice 2): only a security-relevant hit becomes a
    // finding. The adapter decides relevance (code-analyzer → Security/AppExchange tag);
    // an adapter with no `securityRelevant` is security-by-construction and keeps all. A
    // FILTER on non-security NOISE, never a drop of a security finding (an unmapped
    // SECURITY rule passes here and ingests via the CA-severity fallback below).
    if (typeof adapter.securityRelevant === 'function' && !adapter.securityRelevant(h)) {
      const tg = Array.isArray(h.tags) && h.tags.length ? h.tags.join(', ') : 'no tags'
      notes.push(`${adapter.name}: rule ${h.ruleId} is not Security/AppExchange-tagged (${tg}) — filtered as non-security noise, not a finding`)
      continue
    }
    let classKey = null
    try {
      classKey = adapter.classify(h.ruleId)
    } catch {
      classKey = null
    }
    findings.push(buildFinding({ ...h, classKey, repoRoot, pass }))
    if (!classKey) {
      // Honest note on the severity SOURCE of an unmapped hit: a tool→band adapter (Semgrep)
      // carries its own per-finding band, while a class-severity adapter (code-analyzer) with
      // an unmapped SECURITY rule uses the Code-Analyzer-severity fallback. Keeps the word
      // "unmapped" either way (the owned-class is still none).
      const how = h.bandFromTool
        ? `the ${adapter.name} tool band (${h.toolSevLabel || 'unknown'} → ${h.bandFromTool})`
        : 'the Code-Analyzer-severity fallback'
      notes.push(`${adapter.name}: rule ${h.ruleId} is unmapped (owns no toolkit class) — ingested as deterministic with ${how}`)
    }
  }
  // stable order so the output is byte-identical regardless of scanner emission order
  findings.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { findings, notes }
}

// ----------------------------------------------------------------------------
// ADAPTER #1 — code-analyzer (file-parser): parses a captured Code Analyzer v5 JSON
// ----------------------------------------------------------------------------
export const codeAnalyzerAdapter = {
  name: 'code-analyzer',
  kind: 'file-parser',
  collect({ input } = {}) {
    if (!input) return null
    try {
      const txt = readFileSync(input, 'utf8')
      if (!txt.trim()) return null
      return JSON.parse(txt)
    } catch {
      return null
    }
  },
  parse(raw) {
    if (!raw || !Array.isArray(raw.violations)) return []
    const hits = []
    for (const v of raw.violations) {
      if (!v || v.rule == null) continue
      const locs = Array.isArray(v.locations) ? v.locations : []
      const idx =
        Number.isInteger(v.primaryLocationIndex) && v.primaryLocationIndex >= 0 && v.primaryLocationIndex < locs.length
          ? v.primaryLocationIndex
          : 0
      const loc = locs[idx] || locs[0] || null
      if (!loc || !loc.file) continue
      hits.push({
        engine: v.engine || 'code-analyzer',
        ruleId: String(v.rule),
        severityNum: Number.isInteger(v.severity) ? v.severity : null,
        file: loc.file,
        startLine: Number.isInteger(loc.startLine) ? loc.startLine : null,
        message: v.message == null ? '' : String(v.message),
        resources: Array.isArray(v.resources) ? v.resources : [],
        tags: Array.isArray(v.tags) ? v.tags : [],
      })
    }
    return hits
  },
  classify(ruleId) {
    return RULE_CLASS[ruleId] || null
  },
  // Slice 2: only a Security/AppExchange-tagged Code Analyzer rule is a security finding.
  // Filters out ApexDoc / naming / codestyle / Performance noise (incl. the Performance-
  // tagged MissingNullCheckOnSoqlVariable). An unmapped SECURITY rule still passes (then
  // ingests via the CA-severity fallback) — this never drops a security finding.
  securityRelevant(hit) {
    return hasSecurityTag(hit && hit.tags)
  },
}

// ----------------------------------------------------------------------------
// ADAPTER #2 — metadata-viewall (source-scanner): greps the repo's permission sets
// ----------------------------------------------------------------------------
const SKIP_DIRS = new Set(['.git', 'node_modules', '.security-review'])
function findPermissionSetFiles(root) {
  const out = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue
        walk(join(dir, e.name))
      } else if (e.isFile() && e.name.endsWith('.permissionset-meta.xml')) {
        out.push(join(dir, e.name))
      }
    }
  }
  walk(root)
  out.sort()
  return out
}
function lineOfIndex(text, idx) {
  let line = 1
  for (let i = 0; i < idx && i < text.length; i++) if (text[i] === '\n') line++
  return line
}
// PURE: extract over-granting objectPermissions blocks from one permission set's XML.
function extractObjectOvergrants(text) {
  const out = []
  const re = /<objectPermissions>([\s\S]*?)<\/objectPermissions>/g
  let m
  while ((m = re.exec(text)) !== null) {
    const block = m[1]
    const objM = /<object>\s*([^<\s][^<]*?)\s*<\/object>/.exec(block)
    if (!objM) continue
    const object = objM[1].trim()
    // Custom objects only. Standard objects are out of scope — "the org admin solely
    // owns the security policy for standard objects" (baseline violation-sharing-rules-bypass).
    if (!/__c$/i.test(object)) continue
    const flags = PS_OVERGRANT_FLAGS.filter((fl) => new RegExp(`<${fl}>\\s*true\\s*</${fl}>`, 'i').test(block))
    if (!flags.length) continue
    const objAbsIdx = m.index + m[0].indexOf(objM[0])
    out.push({ object, flags, line: lineOfIndex(text, objAbsIdx) })
  }
  return out
}
export const metadataViewAllAdapter = {
  name: 'metadata-viewall',
  kind: 'source-scanner',
  collect({ target } = {}) {
    if (!target) return null
    let files
    try {
      files = findPermissionSetFiles(target)
    } catch {
      return null
    }
    const out = []
    for (const p of files) {
      try {
        out.push({ path: p, text: readFileSync(p, 'utf8') })
      } catch {
        /* unreadable file — skip, never crash */
      }
    }
    return { files: out, repoRoot: target }
  },
  parse(raw) {
    if (!raw || !Array.isArray(raw.files)) return []
    const hits = []
    for (const f of raw.files) {
      if (!f || typeof f.text !== 'string') continue
      for (const og of extractObjectOvergrants(f.text)) {
        hits.push({
          engine: 'metadata',
          ruleId: 'viewall-overgrant',
          severityNum: null,
          file: f.path,
          startLine: og.line,
          message: `Permission set grants ${og.flags.join(' + ')}=true on custom object ${og.object} — an all-records sharing bypass on a partner-namespace object.`,
          resources: [VIEWALL_DOC],
          tags: ['AppExchange', 'Security', 'Metadata'],
        })
      }
    }
    return hits
  },
  classify() {
    return 'viewall-overgrant'
  },
}

// ----------------------------------------------------------------------------
// ADAPTER #3 — checkov (file-parser, Phase 2 · 2a): parses captured Checkov JSON.
// Checkov is the toolkit's IaC-misconfig scanner (run-scans Family 8 over the Dockerfile /
// Terraform / CloudFormation / K8s). Like metadata-viewall it is SECURITY-BY-CONSTRUCTION —
// every `failed_check` is an IaC misconfig, there is no ApexDoc-style noise — so it has a
// CONSTANT classify() and NO `securityRelevant` (the ingest core keeps every emitted hit).
// Severity comes from the iac-misconfig CLASS (scan-iac-misconfig = major → high), NEVER the
// tool: Checkov OSS emits `severity: null` (per-check severity is a Prisma/Bridgecrew
// enterprise field), so a literal tool→band mapping has no input anyway — class-severity is the
// faithful AND the only deterministic option. Only `failed_checks` become findings;
// passed/skipped/parsing_errors never do.
export const checkovAdapter = {
  name: 'checkov',
  kind: 'file-parser',
  collect({ input } = {}) {
    if (!input) return null
    try {
      const txt = readFileSync(input, 'utf8')
      if (!txt.trim()) return null
      return JSON.parse(txt)
    } catch {
      return null
    }
  },
  parse(raw) {
    if (raw == null) return []
    // Checkov emits a single result OBJECT for one framework, or an ARRAY of result objects
    // when several frameworks run (dockerfile + terraform + k8s). Normalize to a list.
    const frameworks = Array.isArray(raw) ? raw : [raw]
    const hits = []
    for (const fw of frameworks) {
      if (!fw || typeof fw !== 'object') continue
      const results = fw.results
      const failed = results && Array.isArray(results.failed_checks) ? results.failed_checks : []
      for (const check of failed) {
        // Skip a malformed check with no rule id (the ingest core also drops a hit with no
        // file_path, with an honest note — that is correct).
        if (!check || check.check_id == null) continue
        const range = Array.isArray(check.file_line_range) ? check.file_line_range : null
        const startLine = range && Number.isInteger(range[0]) ? range[0] : null
        hits.push({
          engine: 'checkov',
          ruleId: String(check.check_id),
          severityNum: null, // Checkov OSS severity is null; we never use it (severity is from the class)
          file: check.file_path,
          startLine,
          message: String(check.check_name || ''),
          resources: check.guideline ? [String(check.guideline)] : [],
          tags: [],
        })
      }
    }
    return hits
  },
  // Constant: every Checkov failed check is an IaC misconfig (like metadata-viewall's constant).
  // Checkov is NOT in RULE_CLASS (that map is the code-analyzer rule→class table).
  classify() {
    return 'iac-misconfig'
  },
  // NO securityRelevant — security-by-construction (mirror metadata-viewall): a compliance
  // scanner whose every emission is a finding, so the ingest core applies no tag filter.
}

// ----------------------------------------------------------------------------
// ADAPTER #4 — semgrep (file-parser, Phase 2 · 2a #2): parses captured Semgrep JSON.
// Semgrep is the toolkit's multi-language SAST keystone (run-scans Family 7 over each
// non-package source root, with the security rulesets p/security-audit / p/secrets / p/<lang>).
// It is the FIRST genuine TOOL→BAND adapter: unlike Code Analyzer (Apex rules → 3 wobbled
// CLASSES) and Checkov (severity:null → class), Semgrep carries a real per-result severity
// (`ERROR`/`WARNING`/`INFO`), which IS the honest per-finding signal for general SAST. So a
// Semgrep hit owns NO toolkit class — `classify()` is constant `null`:
//   - it must NOT map to a `fail-*` blocker class (that would over-escalate every SAST hit
//     to a class-high/critical), and
//   - its severity source is the tool band (SEMGREP_SEVERITY_TO_FINDING), not a class.
// Owning no class, a Semgrep finding SUPERSEDES nothing (reconcile-provenance only supersedes
// in an OWNED class) — so de-duplicating a co-located LLM injection finding against a Semgrep
// finding is cross-engine dedup = roadmap §10 extension #3 (Phase-2b), NOT this slice; the SAFE
// under-merge (a duplicate may survive in the band), never a dropped scanner finding.
// dimension 'external-sast' is a DETERMINISTIC-ONLY grouping label (like checkov's
// 'infrastructure-iac'): Semgrep spans many vuln classes, so an honest "external SAST" grouping
// beats false-precision dimensioning into injection-xss — the schema declares `dimension` a free
// kebab-case string, so no methodology/dimensions/ file is needed. Like checkov/metadata it is
// SECURITY-BY-CONSTRUCTION (the security rulesets), so NO `securityRelevant` — the ingest core
// keeps every emitted hit. Only `results[]` become findings.
export const semgrepAdapter = {
  name: 'semgrep',
  kind: 'file-parser',
  collect({ input } = {}) {
    if (!input) return null
    try {
      const txt = readFileSync(input, 'utf8')
      if (!txt.trim()) return null
      return JSON.parse(txt)
    } catch {
      return null
    }
  },
  parse(raw) {
    if (!raw || !Array.isArray(raw.results)) return []
    const hits = []
    for (const r of raw.results) {
      // Skip a malformed result with no check_id (the ingest core also drops a hit with no
      // file, with an honest note — that is correct).
      if (!r || r.check_id == null) continue
      const extra = r && r.extra && typeof r.extra === 'object' ? r.extra : {}
      const metadata = extra.metadata && typeof extra.metadata === 'object' ? extra.metadata : {}
      const sev = extra.severity
      const refs =
        Array.isArray(metadata.references) && metadata.references[0] ? [String(metadata.references[0])] : []
      hits.push({
        engine: 'semgrep',
        ruleId: String(r.check_id),
        severityNum: null, // Semgrep has no 1-5 number; the band comes from extra.severity
        file: r.path,
        startLine: r.start && Number.isInteger(r.start.line) ? r.start.line : null,
        message: String((extra && extra.message) || ''),
        resources: refs,
        bandFromTool: SEMGREP_SEVERITY_TO_FINDING[sev] || 'info', // unknown/INVENTORY → info, never dropped
        toolSevLabel: String(sev || 'unknown'),
        dimensionHint: 'external-sast',
        tags: [],
      })
    }
    return hits
  },
  // Constant null: a Semgrep finding owns NO toolkit class (its severity is the tool band, and
  // it must not over-escalate onto a fail-* blocker class). Owning no class, it supersedes nothing.
  classify() {
    return null
  },
  // NO securityRelevant — security-by-construction (the security rulesets), like checkov/metadata.
}

// ----------------------------------------------------------------------------
// ADAPTER #5 — bandit (file-parser, Phase 2 · 2a #3): parses captured Bandit JSON.
// Bandit is the toolkit's Python language-gate SAST tool (run-scans Family 7, alongside
// Semgrep/njsscan/gosec). It is the THIRD adapter and the SECOND genuine TOOL→BAND adapter —
// the PROOF the Semgrep tool→band generalization GENERALIZES: bandit reuses buildFinding's
// `bandFromTool` path with ZERO harness-core change (one new adapter + one severity map). Like
// Semgrep it carries a real per-result severity (`HIGH`/`MEDIUM`/`LOW`, via
// BANDIT_SEVERITY_TO_FINDING) which IS the honest per-finding signal for general SAST, so a Bandit
// hit owns NO toolkit class — `classify()` is constant `null`:
//   - it must NOT map to a `fail-*` blocker class (that would over-escalate every SAST hit), and
//   - its severity source is the tool band, not a class (gated by scan-external-sast = major).
// Owning no class, a Bandit finding SUPERSEDES nothing (cross-engine dedup is roadmap §10 ext #3,
// Phase-2b — the SAFE under-merge). dimension 'external-sast' is the same deterministic-only
// grouping label as Semgrep (Python SAST belongs to the same external-endpoint SAST grouping). Like
// semgrep/checkov/metadata it is SECURITY-BY-CONSTRUCTION (Bandit is a security scanner), so NO
// `securityRelevant` — the ingest core keeps every emitted hit. Only `results[]` become findings.
// `issue_confidence` is recorded by Bandit but deliberately NOT band-weighting here (Phase-2b note).
export const banditAdapter = {
  name: 'bandit',
  kind: 'file-parser',
  collect({ input } = {}) {
    if (!input) return null
    try {
      const txt = readFileSync(input, 'utf8')
      if (!txt.trim()) return null
      return JSON.parse(txt)
    } catch {
      return null
    }
  },
  parse(raw) {
    if (!raw || !Array.isArray(raw.results)) return []
    const hits = []
    for (const r of raw.results) {
      // Skip a malformed result with no test_id (the ingest core also drops a hit with no
      // file, with an honest note — that is correct).
      if (!r || r.test_id == null) continue
      const cwe = r.issue_cwe && typeof r.issue_cwe === 'object' ? r.issue_cwe : null
      const resources = r.more_info
        ? [String(r.more_info)]
        : cwe && cwe.link
          ? [String(cwe.link)]
          : []
      const sev = r.issue_severity
      hits.push({
        engine: 'bandit',
        ruleId: String(r.test_id),
        severityNum: null, // Bandit has no 1-5 number; the band comes from issue_severity
        file: r.filename,
        startLine: Number.isInteger(r.line_number) ? r.line_number : null,
        message: String(r.issue_text || r.test_name || ''),
        resources,
        bandFromTool: BANDIT_SEVERITY_TO_FINDING[sev] || 'info', // unknown/missing → info, never dropped
        toolSevLabel: String(sev || 'unknown'),
        dimensionHint: 'external-sast',
        tags: [],
      })
    }
    return hits
  },
  // Constant null: a Bandit finding owns NO toolkit class (its severity is the tool band, and it
  // must not over-escalate onto a fail-* blocker class). Owning no class, it supersedes nothing.
  classify() {
    return null
  },
  // NO securityRelevant — security-by-construction (Bandit is a security scanner), like semgrep/checkov/metadata.
}

export const ADAPTERS = {
  'code-analyzer': codeAnalyzerAdapter,
  'metadata-viewall': metadataViewAllAdapter,
  'checkov': checkovAdapter,
  'semgrep': semgrepAdapter,
  'bandit': banditAdapter,
}

// ----------------------------------------------------------------------------
// ledger merge (additive + idempotent). LLM-supersession enforcement is Slice 2;
// here a deterministic finding is keyed by engine+ruleId+file:line and added once
// (or refreshed in place on re-ingest), never duplicated.
// ----------------------------------------------------------------------------
export function loadLedger(ledgerPath) {
  let ledger
  try {
    ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
  } catch {
    ledger = null
  }
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) {
    ledger = { schema_version: '1', findings: [], passes: [] }
  }
  // HONESTY (data-loss guard, mirrors merge-ledger.mjs): a present-but-non-array
  // `findings` is a corrupted/hand-edited ledger, not an empty one — refuse loudly
  // rather than overwrite a recoverable file.
  if (ledger.findings != null && !Array.isArray(ledger.findings)) {
    throw new Error(
      'prior ledger `findings` is not an array (corrupted or hand-edited); refusing to overwrite — restore from version control and re-run'
    )
  }
  if (!Array.isArray(ledger.findings)) ledger.findings = []
  if (!Array.isArray(ledger.passes)) ledger.passes = []
  if (!ledger.schema_version) ledger.schema_version = '1'
  return ledger
}
export function mergeFindings(ledger, newFindings, pass) {
  const passId = Number.isInteger(pass) && pass >= 1 ? pass : 1
  const byId = new Map(ledger.findings.map((f) => [f.id, f]))
  let added = 0
  let updated = 0
  for (const nf of newFindings) {
    const prev = byId.get(nf.id)
    if (prev) {
      // owner-touched lifecycle states are never re-written by an automated re-ingest
      if (prev.status === 'accepted_risk' || prev.status === 'fixed') {
        prev.last_seen = passId
        updated++
        continue
      }
      const firstSeen = prev.first_seen
      Object.assign(prev, nf, { first_seen: firstSeen, last_seen: passId })
      updated++
    } else {
      ledger.findings.push(nf)
      byId.set(nf.id, nf)
      added++
    }
  }
  return { added, updated }
}

// ----------------------------------------------------------------------------
// CLI
// ----------------------------------------------------------------------------
function arg(flag, def) {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
function main() {
  const scanner = arg('--scanner', 'code-analyzer')
  const input = arg('--input', null)
  const target = arg('--target', process.cwd())
  const asJson = process.argv.includes('--json')
  const dryRun = process.argv.includes('--dry-run')
  const passArg = parseInt(arg('--pass', ''), 10)

  const adapter = ADAPTERS[scanner]
  if (!adapter) {
    console.error(`ingest-scanner-findings: unknown --scanner '${scanner}'. Known: ${Object.keys(ADAPTERS).join(', ')}`)
    process.exit(2)
  }

  let raw
  try {
    raw = adapter.collect({ input, target })
  } catch {
    raw = null
  }

  const ledgerPath = join(target, '.security-review', 'audit-ledger.json')
  let ledger = { schema_version: '1', findings: [], passes: [] }
  let defaultPass = 1
  if (!dryRun) {
    try {
      ledger = loadLedger(ledgerPath)
    } catch (e) {
      console.error(`ingest-scanner-findings: ${e.message}`)
      process.exit(2)
    }
    defaultPass = ledger.passes.length ? Math.max(...ledger.passes.map((p) => p.id || 1)) : 1
  }
  const pass = Number.isInteger(passArg) && passArg >= 1 ? passArg : defaultPass

  const { findings, notes } = ingest(raw, adapter, { repoRoot: target, pass })

  let merged = null
  if (!dryRun) {
    merged = mergeFindings(ledger, findings, pass)
    try {
      mkdirSync(join(target, '.security-review'), { recursive: true })
    } catch {
      /* dir may already exist */
    }
    writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2))
  }

  if (asJson) {
    process.stdout.write(JSON.stringify({ scanner: adapter.name, kind: adapter.kind, findings, notes, merged }, null, 2) + '\n')
  } else {
    process.stdout.write(
      `ingest-scanner-findings [${adapter.name}/${adapter.kind}]: ${findings.length} deterministic finding(s)` +
        (dryRun ? ' (dry-run, not merged)' : `; merged +${merged.added} new / ${merged.updated} refreshed → ${ledgerPath}`) +
        '\n'
    )
    for (const n of notes) process.stdout.write(`  note: ${n}\n`)
  }
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

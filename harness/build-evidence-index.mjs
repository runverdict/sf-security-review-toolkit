#!/usr/bin/env node
/*
 * build-evidence-index.mjs — the DETERMINISTIC producer of the WI-20 evidence
 * index (<target>/.security-review/evidence/index.json) that compute-sci.mjs reads.
 *
 * P2: this is SHIPPED engine code invoked with args — NOT an LLM-authored per-run
 * script. The driver supplies its evidence MAPPING as DATA (a JSON input file: which
 * scan produced which requirement, which artifacts were drafted, which auto-fail
 * classes the audit cleared and with what evidence). This engine does the mechanical
 * assembly AND adjudicates the credit rule.
 *
 * P1 — THE CREDIT RULE (the engine decides, never the LLM): for every entry this
 * engine sets `reviewer_reproducible` and `disposition` DETERMINISTICALLY from the
 * evidence PROVENANCE, ignoring anything the input tries to assert about credit:
 *   - a scan report under `.security-review/evidence/` that exists on disk     → reproducible, satisfied
 *   - a generated artifact draft (docs/security-review/*)                       → partial (owner completes/signs)
 *   - an owner-run item the agent prepared but cannot execute                   → pending-owner
 *   - a structural N/A a reviewer can also confirm (e.g. "no IaC in repo")      → reproducible, satisfied
 *   - an auto-fail class the toolkit cleared:
 *       · backed by a scanner evidence file on disk  → reproducible, satisfied
 *       · backed only by the white-box audit report  → NOT reproducible, statically-cleared
 * `statically-cleared` is the anti-self-grading state: real signal, never headline
 * credit, never a blocker-floor clear (compute-sci enforces the same rule, fail-closed).
 *
 * Read-only on the partner's source; writes only into <target>/.security-review/.
 *
 * Usage:
 *   node build-evidence-index.mjs --repo <target> --date YYYY-MM-DD --input <evidence-input.json>
 *   node build-evidence-index.mjs --repo <target> --check
 *
 * --check (0.8.105 — the evidence-index COMPLETENESS lint; READ-ONLY, never writes): the index
 * is driven by the driver-authored evidence-input, NOT a glob over evidence/ — which is exactly
 * how a scan gets run, ingested, and never cited (a real cold run ingested 161 detect-secrets
 * findings whose evidence file appeared nowhere in index.json; opengrep's .sarif was the second
 * orphan). Evidence that is not indexed does not count toward requirement satisfaction in
 * compute-sci / compile-submission, so an orphan is a submission gap and must fail LOUD:
 * `--check` enumerates the TOP-LEVEL evidence/*.{json,sarif,txt,html} scan artifacts, compares
 * against index.json's entry locations, reports every orphan by name, and exits 2 on any.
 * Excluded BY DESIGN (each would otherwise false-orphan on every run):
 *   - `index.json` itself — written into the directory it indexes and never listed in it;
 *   - `*.provenance.json` sidecars (capture-openapi / capture-org-mcp metadata riding another
 *     artifact, never independent scan evidence);
 *   - subdirectories (`evidence/dast/` holds owner-run plans indexed as pending rows, not
 *     top-level scan reports) — top-level files only, no recursion;
 *   - `ca-scan-log-*.txt` — the Code Analyzer scan-log internal diagnostic; its signal
 *     surfaces as the ingest scan-error coverage note, never a requirement-satisfying artifact.
 *
 * evidence-input.json (every section optional; see acceptance/test-build-evidence-index.mjs):
 *   {
 *     "scans":     [{ "reqs": ["scan-..."], "file": ".security-review/evidence/x.json", "src": "run-scans:family-1", "note": "0 violations" }],
 *     "pending":   [{ "req": "dast-self-run-required", "loc": ".security-review/evidence/dast/zap-plan.yaml", "note": "owner runs ZAP" }],
 *     "artifacts": [{ "req": "artifact-incident-response-plan", "loc": "docs/security-review/incident-response-plan.md" }],
 *     "extra_artifacts": ["docs/security-review/data-flow-diagram.md"],
 *     "withheld":  [{ "ref_id": "authn-authz-flow", "loc": "docs/security-review/authn-authz-flow.WITHHELD.md", "note": "open authz crit/high" }],
 *     "cleared":   [{ "req": "fail-crud-fls", "how": "SFGE clean", "loc": ".security-review/evidence/code-analyzer-sfge.json" }],
 *     "na":        [{ "req": "scan-iac-misconfig", "how": "no IaC in repo (find confirmed)", "loc": ".security-review/run-log.md" }]
 *   }
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

function arg(flag, def) {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const REPO = arg('--repo', process.cwd())
const DATE = arg('--date', new Date().toISOString().slice(0, 10))
const INPUT = arg('--input', join(REPO, '.security-review', 'evidence-input.json'))

function readJSON(p, def) {
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return def }
}

// The evidence-directory prefix every scanner artifact lives under (also the provenance
// discriminator's anchor below).
const EVIDENCE_DIR = '.security-review/evidence/'

// --- --check: the completeness lint (see the header). READ-ONLY — never mutates index.json. ---
if (process.argv.includes('--check')) {
  const dir = join(REPO, '.security-review', 'evidence')
  const CHECK_EXTS = ['.json', '.sarif', '.txt', '.html']
  let onDiskNames = []
  try {
    onDiskNames = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile()) // top-level files ONLY — evidence/dast/ etc. never enumerate
      .map((e) => e.name)
      .filter((n) => CHECK_EXTS.some((ext) => n.endsWith(ext)))
      .filter((n) => n !== 'index.json') // the index never lists itself
      .filter((n) => !n.endsWith('.provenance.json')) // capture-* sidecars ride their artifact
      .filter((n) => !/^ca-scan-log-.*\.txt$/.test(n)) // the CA scan-log is an internal diagnostic — its signal surfaces as the ingest scan-error coverage note, not a requirement-satisfying artifact
      .sort()
  } catch {
    console.log('evidence-index check: no evidence directory on disk — nothing to index (clean)')
    process.exit(0)
  }
  const idx = readJSON(join(dir, 'index.json'), null)
  if (!idx || !Array.isArray(idx.entries)) {
    if (!onDiskNames.length) {
      console.log('evidence-index check: no index.json and no top-level evidence files (clean)')
      process.exit(0)
    }
    console.error(`evidence-index check: ${onDiskNames.length} evidence file(s) on disk but NO readable evidence/index.json — build the index first (--input <evidence-input.json>). Unindexed:`)
    for (const n of onDiskNames) console.error(`  ORPHAN ${n}`)
    process.exit(2)
  }
  // The indexed top-level names: every entry location under the evidence dir, basename only
  // (a location with a further `/` — e.g. dast/zap-plan.yaml — is a subdirectory row, out of scope).
  const indexed = new Set()
  for (const e of idx.entries) {
    const rel = String(e && e.location ? e.location : '').replace(/^\/+/, '')
    if (!rel.startsWith(EVIDENCE_DIR)) continue
    const rest = rel.slice(EVIDENCE_DIR.length)
    if (rest && !rest.includes('/')) indexed.add(rest)
  }
  const orphans = onDiskNames.filter((n) => !indexed.has(n))
  if (orphans.length) {
    console.error(`evidence-index check: ${orphans.length} evidence file(s) on disk but NOT in evidence/index.json — a scan that ran but cannot be cited is a submission gap. Record each in the evidence-input and rebuild the index (never hand-edit index.json):`)
    for (const n of orphans) console.error(`  ORPHAN ${n}`)
    process.exit(2)
  }
  console.log(`evidence-index check: ${onDiskNames.length} top-level evidence file(s), all indexed (clean)`)
  process.exit(0)
}

const input = readJSON(INPUT, null)
if (!input) {
  console.error(`build-evidence-index: no evidence-input at ${INPUT} — the driver must write the evidence mapping first.`)
  process.exit(2)
}

const abs = (rel) => join(REPO, String(rel || '').replace(/^\/+/, ''))
const onDisk = (rel) => rel && existsSync(abs(rel))
const sha = (rel) => { try { return createHash('sha256').update(readFileSync(abs(rel))).digest('hex') } catch { return undefined } }

// --- the provenance discriminator: is this a reviewer-reproducible scanner file? ---
// A scanner artifact lives under .security-review/evidence/ (EVIDENCE_DIR above) AND
// exists on disk. The audit report lives under docs/security-review/ — never
// reproducible scanner evidence.
const isScannerEvidence = (loc) => {
  const rel = String(loc || '').replace(/^\/+/, '')
  return rel.startsWith(EVIDENCE_DIR) && onDisk(rel)
}

const entries = []
const push = (e) => entries.push(e)
const base = (extra) => ({ timestamp: DATE, ...extra })

// 1) scans with on-disk evidence → reviewer-reproducible, satisfied -------------
for (const s of input.scans || []) {
  if (!onDisk(s.file)) { console.warn(`scan evidence missing on disk, skipped: ${s.file}`); continue }
  const repro = isScannerEvidence(s.file)
  const ev = { value: true, how: 'scanner exit + parsed report on disk' }
  push(base({ ref_type: 'scan', ref_id: s.src || s.file, source: s.src || 'run-scans', collected_by: 'scanner', verified: ev, reviewer_reproducible: repro, location: s.file, sha256: sha(s.file), disposition: 'satisfied', note: s.note }))
  for (const r of s.reqs || []) {
    push(base({ ref_type: 'requirement', ref_id: r, source: s.src || 'run-scans', collected_by: 'scanner', verified: ev, reviewer_reproducible: repro, location: s.file, sha256: sha(s.file), disposition: 'satisfied', note: s.note }))
  }
}

// 2) owner-run items the agent prepared but cannot execute → pending-owner ------
for (const p of input.pending || []) {
  push(base({ ref_type: 'requirement', ref_id: p.req, source: p.src || 'run-scans', collected_by: 'agent', verified: { value: false, how: 'agent prepared plan/prediction; owner action remains' }, reviewer_reproducible: false, location: p.loc, disposition: 'pending-owner', note: p.note }))
}

// 3) generated artifact drafts → partial (owner completes + signs) -------------
const artifactRows = [
  ...(input.artifacts || []),
  ...(input.extra_artifacts || []).map((loc) => ({ req: null, loc })),
]
for (const a of artifactRows) {
  const slug = String(a.loc).split('/').pop().replace(/\.md$/, '')
  push(base({ ref_type: 'artifact', ref_id: slug, source: 'generate-artifacts', collected_by: 'agent', verified: { value: false, how: 'drafted from code; owner-completed (PARTIAL)' }, reviewer_reproducible: false, location: a.loc, sha256: sha(a.loc), disposition: 'partial', note: 'draft — owner completes + signs' }))
  if (a.req) {
    push(base({ ref_type: 'requirement', ref_id: a.req, source: 'generate-artifacts', collected_by: 'agent', verified: { value: false, how: 'drafted from code; owner-completed' }, reviewer_reproducible: false, location: a.loc, disposition: 'partial', note: 'PARTIAL — owner completes/signs' }))
  }
}

// 4) withheld artifacts (gate) → recorded as the explicit suppressed state ------
for (const w of input.withheld || []) {
  push(base({ ref_type: 'artifact', ref_id: w.ref_id, source: 'artifact-gate', collected_by: 'agent', verified: { value: false, how: 'WITHHELD — open critical/high in authN/authZ category' }, reviewer_reproducible: false, location: w.loc, disposition: 'pending-owner', note: w.note || 'withheld until the open authN/authZ findings are remediated' }))
}

// 5) auto-fail classes the audit cleared — THE CREDIT ADJUDICATION -------------
// The engine decides reproducibility from the evidence location, NOT from the input.
for (const c of input.cleared || []) {
  const repro = isScannerEvidence(c.loc)
  if (repro) {
    push(base({ ref_type: 'requirement', ref_id: c.req, source: c.src || 'run-scans', collected_by: 'scanner', verified: { value: true, how: (c.how || 'scanner clean') + ' — scanner evidence on disk (reviewer-reproducible)' }, reviewer_reproducible: true, location: c.loc, sha256: sha(c.loc), disposition: 'satisfied', note: 'cleared by a scanner the reviewer re-runs; Salesforce pen-tests regardless' }))
  } else {
    push(base({ ref_type: 'requirement', ref_id: c.req, source: c.src || 'audit-codebase', collected_by: 'agent', verified: { value: true, how: (c.how || 'white-box static audit') + ' — WHITE-BOX STATIC, not a reviewer-reproducible scan' }, reviewer_reproducible: false, location: c.loc, disposition: 'statically-cleared', note: 'toolkit static clear only — obtain a Code Analyzer/SFGE/Checkmarx clear to credit; Salesforce pen-tests regardless' }))
  }
}

// 6) structural N/A a reviewer can also confirm → reproducible, satisfied -------
// N/A is for an ABSENT SURFACE the reviewer can also confirm (no IaC, no MCP server,
// no DML at all) — NEVER an audit conclusion that a PRESENT surface is "clean" (that is
// a `cleared` entry, which routes through the scanner discriminator). A vuln-class
// (fail-*/violation-*) N/A is legitimate only on genuine surface absence; the engine
// cannot distinguish a true absence from a false one, so it credits but SURFACES these
// for review — silent N/A credit on an auto-fail class would re-open the self-grading hole.
const vulnClassNa = []
for (const n of input.na || []) {
  if (/^(fail|violation)-/.test(String(n.req || ''))) vulnClassNa.push(n.req)
  push(base({ ref_type: 'requirement', ref_id: n.req, source: n.src || 'scope', collected_by: 'agent', verified: { value: true, how: n.how || 'absent surface confirmed structurally (reviewer can also confirm)' }, reviewer_reproducible: true, location: n.loc, disposition: 'satisfied', note: 'N/A — surface absent' }))
}

const out = { schema_version: 1, generated: DATE, entries }
const dir = join(REPO, '.security-review', 'evidence')
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'index.json'), JSON.stringify(out, null, 2))

// summary --------------------------------------------------------------------
const byDisp = {}
for (const e of entries) byDisp[e.disposition] = (byDisp[e.disposition] || 0) + 1
const credited = entries.filter((e) => e.ref_type === 'requirement' && e.disposition === 'satisfied' && e.reviewer_reproducible === true).map((e) => e.ref_id)
const statics = entries.filter((e) => e.ref_type === 'requirement' && e.disposition === 'statically-cleared').map((e) => e.ref_id)
console.log(`evidence/index.json: ${entries.length} entries — ${JSON.stringify(byDisp)}`)
console.log(`reviewer-reproducible SATISFIED requirements: ${credited.join(', ') || '(none)'}`)
console.log(`statically-cleared (NOT credited): ${statics.join(', ') || '(none)'}`)
if (vulnClassNa.length) console.log(`⚠ N/A credit granted to auto-fail class(es) — verify these are genuine STRUCTURAL surface-absence (reviewer-confirmable), not "audit looked, it's clean": ${vulnClassNa.join(', ')}`)

#!/usr/bin/env node
/**
 * Standing INTEGRATION test for the deterministic-findings journey wiring
 * (Phase 1 · Slice 3 of docs/roadmap-deterministic-findings.md).
 *
 * Slices 1+2 unit-tested the two engines in isolation (`test-ingest-scanner-findings`,
 * `test-reconcile-provenance`). Slice 3 WIRES them into the real flow — the deterministic
 * pass runs BEFORE the LLM fan-out and reconcile runs AFTER the merge — so this test drives
 * the REAL ingest → reconcile CLI SEQUENCE on a tmp ledger (with a hand-injected LLM finding
 * standing in for merge-ledger's product — exactly the "add a co-located LLM finding" the
 * slice spec calls for; merge-ledger itself has its own standing test), then asserts the two
 * skills actually grant + invoke the harnesses in that order. It is the deterministic
 * replacement for the 5-run cold campaign: "run the engine twice → identical", end-to-end.
 *
 * Two halves:
 *
 *   SEQUENCE (drive the real CLIs on a tmp ledger, reading the ledger off disk between steps):
 *     I1  ingest (metadata-viewall source scan + code-analyzer file-parser, off the REAL
 *         captured Solano fixtures) seeds `provenance:'deterministic'` CRUD/FLS + ViewAll
 *         findings into the ledger — the engines run FIRST.
 *     I2  a co-located same-class LLM CRUD/FLS finding (the merge layer's product, injected
 *         here to stand in for merge-ledger) is SUPERSEDED by reconcile-provenance →
 *         status:'superseded', superseded_by → the deterministic owner; exactly 1 superseded.
 *     I3  an off-CLASS LLM finding (same locus, different dimension) SURVIVES.
 *     I4  an off-LOCUS LLM finding (same dimension, different file) SURVIVES.
 *     I5  a deterministic finding is NEVER superseded (the engine's result stands).
 *     I6  reconcile is idempotent: a 2nd run supersedes 0 and leaves the ledger byte-identical.
 *     I7  the reconciled OPEN band (what the headline + recap read) excludes the superseded
 *         finding and still carries the deterministic owner — supersession propagates.
 *
 *   WIRING (read the skills off disk — the invocation lives in audit-codebase, the phase
 *   that actually runs the engines; the journey wires that phase by reference, since it
 *   delegates via the Skill tool; run-scans seeds the band at its own scan tail):
 *     W1/W2  audit-codebase GRANTS both harnesses in allowed-tools.
 *     W3     audit-codebase INVOKES the deterministic pass via `--all` (one call subsuming
 *            metadata-viewall + code-analyzer + the OSS scanner families).
 *     W4     audit-codebase INVOKES reconcile-provenance --target.
 *     W5     ORDER: the --all ingest invocation precedes the LLM fan-out (build-audit-engine.mjs).
 *     W6     ORDER: the reconcile invocation follows the merge (merge-ledger.mjs).
 *     W7     audit-codebase carries the sf-absent → PENDING-OWNER-RUN (never LLM-fill) note.
 *     W8     the journey REFERENCES both harnesses by name.
 *     W9     the journey carries the sf-absent → PENDING note + the before/after ordering.
 *     W10    run-scans GRANTS both harnesses in allowed-tools.
 *     W11    run-scans INVOKES `--all` then reconcile-provenance --target at the scan tail
 *            (in that order) + carries the PENDING-when-absent note.
 *
 * Dependency-free, hermetic (only the committed real fixtures under acceptance/fixtures/, no
 * network, no sf, no LLM): `node acceptance/test-deterministic-integration.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const INGEST = join(PLUGIN, 'harness', 'ingest-scanner-findings.mjs')
const RECONCILE = join(PLUGIN, 'harness', 'reconcile-provenance.mjs')
const FIX = join(PLUGIN, 'acceptance', 'fixtures')
const CA_FIXTURE = join(FIX, 'code-analyzer-solano.json')
const PS_FIXTURE = join(FIX, 'permissionsets', 'Solano_Admin.permissionset-meta.xml')
const AUDIT_SKILL = join(PLUGIN, 'skills', 'audit-codebase', 'SKILL.md')
const JOURNEY_SKILL = join(PLUGIN, 'skills', 'security-review-journey', 'SKILL.md')
const RUNSCANS_SKILL = join(PLUGIN, 'skills', 'run-scans', 'SKILL.md')

const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'))
const node = (args, cwd) => execFileSync('node', args, { encoding: 'utf8', stdio: 'pipe', cwd })

let pass = 0
let fail = 0
const dirs = []
const check = (name, fn) => {
  try {
    fn()
    pass++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    fail++
    console.log(`  ✗ ${name}\n    ${e.message}`)
  }
}

// ── build a tmp target carrying the REAL captured fixtures the engines read ──────────────
function setupTarget() {
  const T = mkdtempSync(join(tmpdir(), 'det-integration-'))
  dirs.push(T)
  mkdirSync(join(T, '.security-review', 'evidence'), { recursive: true })
  mkdirSync(join(T, 'force-app', 'permissionsets'), { recursive: true })
  copyFileSync(PS_FIXTURE, join(T, 'force-app', 'permissionsets', 'Solano_Admin.permissionset-meta.xml'))
  // a code-analyzer-*.json under evidence/ is the signal the audit's deterministic pass keys
  // off (Step 4b) — its PRESENCE is what flips CRUD/FLS from PENDING to deterministic.
  copyFileSync(CA_FIXTURE, join(T, '.security-review', 'evidence', 'code-analyzer-2026-06-26.json'))
  return T
}
const ledgerPath = (T) => join(T, '.security-review', 'audit-ledger.json')
const findings = (T) => readJSON(ledgerPath(T)).findings
const byClass = (T, cls) => findings(T).filter((f) => f.provenance === 'deterministic' && f.class === cls)

// Run the deterministic pass exactly as Step 4b does: ONE `--all` invocation, which ALWAYS runs
// the metadata source scan and content-recognizes the `code-analyzer-*.json` under evidence/
// (the same single-pass band Step 4b now seeds — `--all` subsumes the old two `--scanner` calls).
// Returns the seeded ledger's findings.
function runDeterministicPass(T) {
  node([INGEST, '--all', '--target', T])
  return findings(T)
}

// ─────────────────────────────────────────────────────────────── SEQUENCE (real CLIs)

// One end-to-end build shared by the band checks: ingest → inject the 3 LLM findings (the
// merge layer's product) → reconcile. Anchored on SolanoOpportunityController.cls:21, which
// carries exactly ONE deterministic crud-fls owner (clean superseded_by assertion).
function driveSequence() {
  const T = setupTarget()
  runDeterministicPass(T)

  const crud = byClass(T, 'crud-fls').find((f) => /SolanoOpportunityController\.cls:21\b/.test(f.file))
  assert.ok(crud, 'expected a deterministic crud-fls finding at SolanoOpportunityController.cls:21')

  // inject what merge-ledger would have merged: a co-located same-class LLM finding +
  // an off-class one + an off-locus one. Provenance omitted ⇒ llm-inferred (schema default).
  const ledger = readJSON(ledgerPath(T))
  const co = {
    id: 'llm-co-located',
    dimension: 'apex-exposed-surface', // same owned dimension as the deterministic crud-fls
    title: 'Missing CRUD/FLS enforcement before DML (LLM)',
    severity: 'high',
    adjusted_severity: 'high',
    file: 'force-app/main/default/classes/SolanoOpportunityController.cls:21-30', // overlaps :21
    status: 'confirmed',
    verdict: 'confirmed_real',
  }
  const offClass = {
    id: 'llm-off-class',
    dimension: 'tenant-isolation', // different dimension ⇒ off the owned class
    title: 'Cross-tenant read (LLM)',
    severity: 'high',
    adjusted_severity: 'high',
    file: 'force-app/main/default/classes/SolanoOpportunityController.cls:21-30', // same locus
    status: 'confirmed',
    verdict: 'confirmed_real',
  }
  const offLocus = {
    id: 'llm-off-locus',
    dimension: 'apex-exposed-surface', // same dimension as crud
    title: 'Missing CRUD/FLS elsewhere (LLM)',
    severity: 'high',
    adjusted_severity: 'high',
    file: 'force-app/main/default/classes/SolanoSummarizeAction.cls:5-9', // different file
    status: 'confirmed',
    verdict: 'confirmed_real',
  }
  ledger.findings.push(co, offClass, offLocus)
  writeFileSync(ledgerPath(T), JSON.stringify(ledger, null, 2))

  const out = JSON.parse(node([RECONCILE, '--target', T, '--json']))
  return { T, crudIds: byClass(T, 'crud-fls').map((f) => f.id), out }
}

check('I1 the deterministic pass seeds provenance:deterministic CRUD/FLS + ViewAll findings (engines run FIRST)', () => {
  const T = setupTarget()
  runDeterministicPass(T)
  const crud = byClass(T, 'crud-fls')
  const viewall = byClass(T, 'viewall-overgrant')
  assert.ok(crud.length >= 1, 'code-analyzer adapter should seed ≥1 deterministic crud-fls finding')
  assert.ok(crud.every((f) => f.provenance === 'deterministic' && f.engine), 'crud-fls findings carry provenance + engine')
  assert.equal(viewall.length, 1, 'metadata-viewall source scan should seed exactly the one custom-object over-grant')
  assert.equal(viewall[0].severity, 'high', 'viewall severity is read from the sharing class, not the scanner')
})

check('I2 a co-located same-class LLM finding is SUPERSEDED by the deterministic owner (exactly 1)', () => {
  const { T, crudIds, out } = driveSequence()
  assert.equal(out.superseded, 1, 'exactly the one co-located LLM finding is superseded')
  const co = findings(T).find((f) => f.id === 'llm-co-located')
  assert.equal(co.status, 'superseded', 'the co-located LLM CRUD/FLS finding is demoted to superseded')
  assert.ok(crudIds.includes(co.superseded_by), 'superseded_by points at a deterministic crud-fls owner')
  assert.ok(co.superseded_reason && /scanner-determined/.test(co.superseded_reason), 'a human-auditable supersede reason is recorded')
})

check('I3 an off-CLASS LLM finding (same locus, different dimension) SURVIVES', () => {
  const { T } = driveSequence()
  const oc = findings(T).find((f) => f.id === 'llm-off-class')
  assert.equal(oc.status, 'confirmed', 'a different-class finding at the same locus is untouched')
  assert.equal(oc.superseded_by, undefined)
})

check('I4 an off-LOCUS LLM finding (same dimension, different file) SURVIVES', () => {
  const { T } = driveSequence()
  const ol = findings(T).find((f) => f.id === 'llm-off-locus')
  assert.equal(ol.status, 'confirmed', 'a same-class finding at a non-overlapping locus is untouched')
  assert.equal(ol.superseded_by, undefined)
})

check('I5 a deterministic finding is NEVER superseded (the engine result stands)', () => {
  const { T } = driveSequence()
  const dets = findings(T).filter((f) => f.provenance === 'deterministic')
  assert.ok(dets.length >= 2, 'deterministic findings present')
  assert.ok(dets.every((f) => f.status !== 'superseded'), 'no deterministic finding is ever marked superseded')
})

check('I6 reconcile is idempotent — a 2nd run supersedes 0 and the ledger is byte-identical', () => {
  const { T } = driveSequence()
  const before = readFileSync(ledgerPath(T), 'utf8')
  const out2 = JSON.parse(node([RECONCILE, '--target', T, '--json']))
  assert.equal(out2.superseded, 0, 'a second reconcile supersedes nothing new')
  assert.equal(readFileSync(ledgerPath(T), 'utf8'), before, 'the ledger is unchanged on the idempotent re-run')
})

check('I7 the reconciled OPEN band excludes the superseded finding and keeps the deterministic owner', () => {
  const { T } = driveSequence()
  const open = findings(T).filter((f) => f.status === 'confirmed')
  const openIds = new Set(open.map((f) => f.id))
  assert.ok(!openIds.has('llm-co-located'), 'the superseded LLM finding drops out of the open band the headline/recap read')
  // the deterministic crud-fls owner the supersession pointed to is still open
  const co = findings(T).find((f) => f.id === 'llm-co-located')
  assert.ok(openIds.has(co.superseded_by), 'the deterministic owner remains in the open band')
  assert.ok(openIds.has('llm-off-class') && openIds.has('llm-off-locus'), 'the surviving LLM findings stay open')
})

// ─────────────────────────────────────────────────────────────── WIRING (read the skills)

const auditText = readFileSync(AUDIT_SKILL, 'utf8')
const journeyText = readFileSync(JOURNEY_SKILL, 'utf8')
const runScansText = readFileSync(RUNSCANS_SKILL, 'utf8')
// frontmatter allowed-tools line (between the leading --- fences)
const fm = auditText.split('---')[1] || ''
const allowedTools = (fm.split('\n').find((l) => l.startsWith('allowed-tools:')) || '')
const runScansFm = runScansText.split('---')[1] || ''
const runScansAllowed = runScansFm.split('\n').find((l) => l.startsWith('allowed-tools:')) || ''
// body = everything after the frontmatter (so a grant in allowed-tools isn't mistaken for an invocation)
const auditBody = auditText.slice(auditText.indexOf('# Audit Codebase'))

check('W1 audit-codebase GRANTS ingest-scanner-findings.mjs in allowed-tools', () => {
  assert.ok(allowedTools.includes('Bash(node *harness/ingest-scanner-findings.mjs *)'), 'ingest grant present')
})

check('W2 audit-codebase GRANTS reconcile-provenance.mjs in allowed-tools', () => {
  assert.ok(allowedTools.includes('Bash(node *harness/reconcile-provenance.mjs *)'), 'reconcile grant present')
})

check('W3 audit-codebase INVOKES the deterministic pass via --all (subsumes metadata-viewall + code-analyzer)', () => {
  assert.ok(/ingest-scanner-findings\.mjs --all/.test(auditBody), '--all invocation present')
})

check('W4 audit-codebase INVOKES reconcile-provenance --target', () => {
  assert.ok(/reconcile-provenance\.mjs --target/.test(auditBody), 'reconcile invocation present')
})

check('W5 ORDER — the --all ingest invocation precedes the LLM fan-out (build-audit-engine.mjs --plugin)', () => {
  const ingestAt = auditBody.indexOf('ingest-scanner-findings.mjs --all')
  // the ACTUAL fan-out command (Step 5) is the assembler invocation `build-audit-engine.mjs
  // --plugin …` — distinct from the bare `build-audit-engine.mjs` prose in the Step 2 consent
  // gate, which is not the fan-out. Anchor on the command so the order check is meaningful.
  const fanoutAt = auditBody.indexOf('build-audit-engine.mjs --plugin')
  assert.ok(ingestAt > -1 && fanoutAt > -1, 'both markers present')
  assert.ok(ingestAt < fanoutAt, 'deterministic ingest runs BEFORE the LLM fan-out is assembled')
})

check('W6 ORDER — the reconcile invocation follows the merge (merge-ledger.mjs)', () => {
  const mergeAt = auditBody.indexOf('merge-ledger.mjs')
  const reconcileAt = auditBody.indexOf('reconcile-provenance.mjs --target')
  assert.ok(mergeAt > -1 && reconcileAt > -1, 'both markers present')
  assert.ok(mergeAt < reconcileAt, 'reconcile is the LAST merge step (after merge-ledger)')
})

check('W7 audit-codebase carries the sf-absent → PENDING-OWNER-RUN (never LLM-fill) note', () => {
  assert.ok(auditBody.includes('PENDING-OWNER-RUN'), 'PENDING-OWNER-RUN present')
  assert.ok(/never LLM-fill/.test(auditBody), '"never LLM-fill" present')
  assert.ok(/KEEPS its findings as\s+`?llm-inferred`?/.test(auditBody) || /KEEPS.*llm-inferred/s.test(auditBody), 'engine-absent → KEEP llm-inferred present')
})

check('W8 the journey REFERENCES both harnesses by name', () => {
  assert.ok(journeyText.includes('ingest-scanner-findings.mjs'), 'journey references the ingest harness')
  assert.ok(journeyText.includes('reconcile-provenance.mjs'), 'journey references the reconcile harness')
})

check('W9 the journey carries the sf-absent → PENDING note + the before/after ordering', () => {
  assert.ok(journeyText.includes('PENDING-OWNER-RUN'), 'PENDING-OWNER-RUN present in the journey')
  assert.ok(/never LLM-fill/.test(journeyText), '"never LLM-fill" present in the journey')
  assert.ok(/BEFORE its LLM fan-out/.test(journeyText), 'the deterministic-pass-before-fan-out ordering is stated')
  assert.ok(/AFTER its merge/.test(journeyText), 'the reconcile-after-merge ordering is stated')
})

check('W10 run-scans GRANTS both ingest-scanner-findings.mjs + reconcile-provenance.mjs in allowed-tools', () => {
  assert.ok(runScansAllowed.includes('Bash(node *harness/ingest-scanner-findings.mjs *)'), 'ingest grant present in run-scans')
  assert.ok(runScansAllowed.includes('Bash(node *harness/reconcile-provenance.mjs *)'), 'reconcile grant present in run-scans')
})

check('W11 run-scans INVOKES --all then reconcile-provenance --target at the scan tail (in order) + the PENDING-when-absent note', () => {
  const allAt = runScansText.indexOf('ingest-scanner-findings.mjs --all')
  const recAt = runScansText.indexOf('reconcile-provenance.mjs --target')
  assert.ok(allAt > -1, '--all invocation present in run-scans')
  assert.ok(recAt > -1, 'reconcile --target invocation present in run-scans')
  assert.ok(allAt < recAt, '--all seeds the band BEFORE reconcile demotes the LLM dupes')
  assert.ok(runScansText.includes('PENDING-OWNER-RUN'), 'the PENDING-when-absent note is present in run-scans')
})

// ─────────────────────────────────────────────────────────────────── cleanup
for (const d of dirs) {
  try {
    rmSync(d, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

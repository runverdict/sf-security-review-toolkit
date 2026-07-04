#!/usr/bin/env node
/**
 * Standing test for the FULL deterministic-ingest band — the whole-band determinism
 * guarantee (0.8.73).
 *
 * The deterministic band is documented PURE — no Date, no Math.random, no network:
 * byte-deterministic given the same input. Individual adapters carry per-adapter
 * twice-run byte-identity checks (NJ-determinism, TRV-determinism, the regexploit
 * twice-run check, …); what those cannot catch is CROSS-ADAPTER nondeterminism —
 * map/object key-ordering drift, an accidental Date/Math.random in a future adapter,
 * findings-sort instability, merge ordering. This file locks the WHOLE band at once:
 * a hermetic temp target mirroring a real run (every source-scanner fixture dir under
 * the target tree + every file-parser fixture the corpus carries under
 * .security-review/evidence/) is ingested via ingestAll() TWICE, and the two finding
 * bands must be byte-identical. The corpus is enumerated from acceptance/fixtures/
 * itself, so every future adapter fixture joins the band automatically.
 *
 * Guards:
 *   BAND-corpus — the hermetic corpus produces a NON-EMPTY, all-deterministic band
 *       spanning BOTH adapter kinds (source-scanner + file-parser), so the byte-identity
 *       assertion can never pass vacuously on zero findings.
 *   BAND-span — ≥2 source-scanners AND ≥3 file-parsers each contributed ≥1 finding,
 *       and nothing in the corpus was skipped — the band cannot silently narrow.
 *   BAND-determinism — two independent ingestAll() runs → the serialized finding band
 *       is byte-identical (the core full-band guarantee).
 *   BAND-determinism-full — every non-merge result surface (scanners / skipped /
 *       pending / notes) is byte-identical too, and the on-disk ledger after run 2 is
 *       byte-identical to the ledger after run 1 (determinism holds THROUGH the
 *       idempotent merge).
 *   BAND-negative-control — the byte-identity comparator FLAGS a deliberately
 *       differing pair (a clone of the band with ONE drifted field value), proving the
 *       check detects drift rather than passing on whatever it is handed.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { ingestAll } from '../harness/ingest-scanner-findings.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const FIX = join(PLUGIN, 'acceptance', 'fixtures')

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

// Build the hermetic temp target that mirrors a real --all run: the source-scanner
// fixture dirs land under a package subtree (the scanners walk the whole target by
// filename suffix), and every top-level *.json/*.sarif fixture — the file-parser
// corpus — lands under .security-review/evidence/ where --all enumerates it.
// Both listings come from readdirSync over the corpus itself (sorted), so the band
// grows with the corpus and never depends on a hand-maintained fixture list.
function setupBandTarget() {
  const T = mkdtempSync(join(tmpdir(), 'ingest-band-'))
  dirs.push(T)
  const fixEntries = readdirSync(FIX, { withFileTypes: true })
  const sourceDirs = fixEntries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
  for (const d of sourceDirs) {
    const dest = join(T, 'force-app', 'main', 'default', d)
    mkdirSync(dest, { recursive: true })
    for (const name of readdirSync(join(FIX, d)).sort()) {
      writeFileSync(join(dest, name), readFileSync(join(FIX, d, name)))
    }
  }
  const ev = join(T, '.security-review', 'evidence')
  mkdirSync(ev, { recursive: true })
  const parserFixtures = fixEntries
    .filter((e) => e.isFile() && /\.(json|sarif)$/.test(e.name.toLowerCase()))
    .map((e) => e.name)
    .sort()
  for (const name of parserFixtures) {
    writeFileSync(join(ev, name), readFileSync(join(FIX, name)))
  }
  return { T, sourceDirs, parserFixtures }
}

let runA = null
let runB = null
let ledgerAfterRunA = null
let ledgerAfterRunB = null

check('BAND-corpus: the hermetic full-corpus target yields a NON-EMPTY all-deterministic band spanning BOTH adapter kinds (the non-emptiness guard — byte-identity can never pass vacuously)', () => {
  const { T, sourceDirs, parserFixtures } = setupBandTarget()
  assert.ok(sourceDirs.length >= 2, `the corpus carries ≥2 source-scanner fixture dirs (got ${sourceDirs.length})`)
  assert.ok(parserFixtures.length >= 3, `the corpus carries ≥3 file-parser fixtures (got ${parserFixtures.length})`)
  const lp = join(T, '.security-review', 'audit-ledger.json')
  runA = ingestAll({ target: T, pass: 1 })
  ledgerAfterRunA = readFileSync(lp, 'utf8')
  runB = ingestAll({ target: T, pass: 1 })
  ledgerAfterRunB = readFileSync(lp, 'utf8')
  assert.ok(Array.isArray(runA.findings) && runA.findings.length > 0, 'the corpus produced a non-empty band')
  assert.ok(Array.isArray(runB.findings) && runB.findings.length > 0, 'the second run produced a non-empty band')
  assert.ok(runA.findings.every((f) => f.provenance === 'deterministic'), 'every band finding is provenance:deterministic')
  const kinds = new Set(runA.scanners.filter((s) => s.findings > 0).map((s) => s.kind))
  assert.ok(kinds.has('source-scanner'), 'a source-scanner contributed findings')
  assert.ok(kinds.has('file-parser'), 'a file-parser contributed findings')
})

check('BAND-span: ≥2 source-scanners AND ≥3 file-parsers each contributed ≥1 finding, and NOTHING in the corpus was skipped — the band cannot silently narrow', () => {
  assert.ok(runA, 'the band runs are available')
  const contributed = runA.scanners.filter((s) => s.findings > 0)
  const src = new Set(contributed.filter((s) => s.kind === 'source-scanner').map((s) => s.scanner))
  const fp = new Set(contributed.filter((s) => s.kind === 'file-parser').map((s) => s.scanner))
  assert.ok(src.size >= 2, `≥2 source-scanners contributed findings (got ${src.size}: ${[...src].join(', ')})`)
  assert.ok(fp.size >= 3, `≥3 file-parsers contributed findings (got ${fp.size}: ${[...fp].join(', ')})`)
  assert.deepEqual(runA.skipped, [], `no corpus fixture is skipped (got ${JSON.stringify(runA.skipped)})`)
})

check('BAND-determinism: two independent ingestAll() runs over the same hermetic target → the FULL finding band is byte-identical (the whole-band guarantee, not per-adapter)', () => {
  assert.ok(runA && runB, 'the band runs are available')
  assert.ok(runA.findings.length > 0, 'never vacuous — the band is non-empty')
  assert.equal(JSON.stringify(runA.findings), JSON.stringify(runB.findings), 'the serialized finding band is byte-identical across the two runs')
})

check('BAND-determinism-full: every non-merge result surface (scanners/skipped/pending/notes) is byte-identical too, and the on-disk ledger after run 2 matches run 1 byte-for-byte (determinism holds THROUGH the idempotent merge)', () => {
  assert.ok(runA && runB, 'the band runs are available')
  const nonMerge = ({ merged, ...rest }) => rest
  assert.equal(JSON.stringify(nonMerge(runA)), JSON.stringify(nonMerge(runB)), 'the non-merge result surfaces are byte-identical')
  assert.ok(typeof ledgerAfterRunA === 'string' && ledgerAfterRunA.length > 0, 'the first run persisted a ledger')
  assert.equal(ledgerAfterRunB, ledgerAfterRunA, 'the ledger is byte-identical after the second run')
})

check('BAND-negative-control: the byte-identity comparator FLAGS a deliberately differing pair — one drifted field value — so the check is proven to detect drift, not vacuously agree', () => {
  assert.ok(runA && Array.isArray(runA.findings) && runA.findings.length > 0, 'a non-empty band to drift')
  const clone = (o) => JSON.parse(JSON.stringify(o))
  const a = clone(runA.findings)
  const b = clone(runA.findings)
  // sanity: a faithful clone alone never differs — the comparator flags DRIFT, not cloning
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'a faithful clone is byte-identical')
  // inject the value shape a nondeterministic band would produce: two bands identical
  // except ONE field value on ONE finding
  b[0] = { ...b[0], title: `${b[0].title} [drift]` }
  assert.notEqual(JSON.stringify(a), JSON.stringify(b), 'a single drifted field value is flagged by the byte-identity comparison')
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

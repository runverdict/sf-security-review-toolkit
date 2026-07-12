#!/usr/bin/env node
/**
 * Standing test for the gate-spec engine (harness/gate-spec.mjs) — WI-00A of the
 * presentation-consistency roadmap. The findings engine is deterministic; the
 * gate option SETS were driver-improvised prose, and a cold campaign caught the
 * drift (the same depth gate offered with a different option set run-to-run).
 * gate-spec PINS the option set; this test is what keeps it pinned.
 *
 * G1  determinism — same (gate, facts) twice → byte-identical JSON.
 * G2  golden snapshot — each registered gate's option labels (+ decisions) and the
 *     load-bearing VERBATIM description clauses (the disclosure / offered-not-hidden
 *     framing) are exactly as pinned.
 * G3  fail-closed — an unknown gate THROWS; an option missing label/description/
 *     decision THROWS; a decision that is not 'affirm'/'deny' THROWS;
 *     scanner-install with no installable scanners THROWS.
 * G4  safe-default force-injection — the decline option is present on EVERY consent
 *     gate, force-injected even when the selector's own option set omits it; a
 *     non-consent gate (run-mode) gets NO injected decline.
 * G5  every emitted option.decision is a valid record-consent token — proven by
 *     round-tripping each decision through the real recordConsent (affirm →
 *     affirmative true, deny → affirmative false).
 * G6  WI-01 wiring — the journey renders the 3 preflight gates THROUGH gate-spec.
 *
 * Dependency-free: `node acceptance/test-gate-spec.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { gateOptions, validateOption, parseTier, GATE_CATALOG } from '../harness/gate-spec.mjs'
import { recordConsent, verifyConsent } from '../harness/record-consent.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'gate-spec.mjs')
const SCANNERS = { scanners: [{ name: 'semgrep', method: 'pip' }, { name: 'gitleaks', method: 'binary' }] }

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) } }
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'gatespec-')); dirs.push(d); return d }
const labelsDecisions = (payload) => payload.options.map((o) => [o.label, o.decision])

console.log('gate-spec engine standing test')

check('G1 determinism: gateOptions(gate, facts) twice → byte-identical JSON', () => {
  for (const [gate, facts] of [['run-mode', {}], ['audit-tier', {}], ['audit-tier', { recordedTier: 'standard' }], ['scanner-install', SCANNERS]]) {
    const a = JSON.stringify(gateOptions(gate, facts), null, 2)
    const b = JSON.stringify(gateOptions(gate, facts), null, 2)
    assert.equal(a, b, `${gate} must be byte-identical on re-run`)
  }
})

check('G1b determinism via the CLI: --target confirm variant twice → byte-identical', () => {
  const d = tmp()
  recordConsent('audit-tier', 'Standard (recommended)', { target: d, decision: 'affirm' })
  const a = execFileSync('node', [CLI, '--gate', 'audit-tier', '--target', d], { encoding: 'utf8' })
  const b = execFileSync('node', [CLI, '--gate', 'audit-tier', '--target', d], { encoding: 'utf8' })
  assert.equal(a, b, 'CLI confirm variant must be byte-identical')
})

check('G2 golden snapshot: run-mode (election, both affirm, NO decline)', () => {
  const p = gateOptions('run-mode', {})
  assert.equal(p.consent, false, 'run-mode is an election, not a consent')
  assert.deepEqual(labelsDecisions(p), [['Full-auto', 'affirm'], ['Guided', 'affirm']])
  // pin one load-bearing clause so run-mode's prose can't silently drift either
  assert.match(p.options[0].description, /pausing ONLY at the recorded consent gates/)
})

check('G2 golden snapshot: audit-tier FIRST-PASS menu (identical every run)', () => {
  const p = gateOptions('audit-tier', {})
  assert.equal(p.consent, true)
  assert.deepEqual(labelsDecisions(p), [
    ['Standard (recommended)', 'affirm'],
    ['Exhaustive', 'affirm'],
    ['Quick (triage)', 'affirm'],
    ['Cancel — do not launch', 'deny'],
  ])
  // Standard is the recommended default; Exhaustive is OFFERED but framed
  // never-pre-selected (the run-1-hid-it / run-2-offered-it drift fix).
  const byLabel = Object.fromEntries(p.options.map((o) => [o.label, o]))
  assert.match(byLabel['Standard (recommended)'].description, /default first run/i)
  assert.match(byLabel['Exhaustive'].description, /RESERVED FOR A RE-RUN/)
  assert.match(byLabel['Exhaustive'].description, /never\s+pre-selected/i)
})

check('G2 golden snapshot: audit-tier CONFIRM variant (recordedTier) — {Authorize, Change tier, Cancel}', () => {
  const p = gateOptions('audit-tier', { recordedTier: 'standard' })
  assert.equal(p.header, 'Launch audit')
  assert.deepEqual(labelsDecisions(p), [
    ['Authorize the standard launch (recommended)', 'affirm'],
    ['Change tier', 'deny'],
    ['Cancel — do not launch', 'deny'],
  ])
})

check('G2 golden snapshot: scanner-install — verbatim disclosure, only N + scanner(method) filled', () => {
  const p = gateOptions('scanner-install', SCANNERS)
  assert.deepEqual(labelsDecisions(p), [
    ['Install 2 scanner(s) to a temp dir', 'affirm'],
    ['Skip — no install', 'deny'],
  ])
  const desc = p.options[0].description
  // the only fillable data:
  assert.match(desc, /Install 2 missing scanner\(s\) — semgrep \(pip\), gitleaks \(binary\) —/)
  // the FIXED disclosure clauses (verbatim — never paraphrased):
  assert.match(desc, /sha256-verified against an author-pinned checksum/)
  assert.match(desc, /removed at cleanup while the scan evidence is kept/)
  assert.match(desc, /ALSO authorizes RUNNING the scanners, which fetches their rule packs/)
})

check('G2 golden snapshot: throwaway-dast (live-op consent) — {affirm, force-injected deny}', () => {
  const p = gateOptions('throwaway-dast', {})
  assert.equal(p.consent, true, 'throwaway-dast is a consent gate')
  assert.equal(p.kind, 'consent')
  assert.deepEqual(labelsDecisions(p), [
    ['Stand up a throwaway & scan it', 'affirm'],
    ['Skip — no throwaway, no active scan', 'deny'],
  ])
  const byLabel = Object.fromEntries(p.options.map((o) => [o.label, o]))
  // the isolation promise on the affirm, verbatim — the throwaway never touches prod
  assert.match(byLabel['Stand up a throwaway & scan it'].description, /Nothing touches your real\s+deployment/)
  // the decline must say DAST falls to PENDING-OWNER-RUN — it does not silently vanish
  assert.match(byLabel['Skip — no throwaway, no active scan'].description, /PENDING-OWNER-RUN/)
})

check('G2d throwaway-dast affirm description states the mirror-isolation facts IN the gate', () => {
  // The operator decides AT this gate — with a live stack running on the host, the
  // reassurance must be in the option text itself, not in a doc somewhere. The affirm
  // description states the engine-enforced guarantees (standup-stack/teardown-stack):
  // distinct run-unique project + container_name rebind + loopback publish + volumes
  // reset + never-touches-running/name-anchored teardown.
  // MUTATION: reverting the description to the pre-collision-aware wording reds each
  // isolation-fact assert below.
  const p = gateOptions('throwaway-dast', {})
  const desc = p.options.find((o) => o.decision === 'affirm').description
  assert.match(desc, /fully\s+isolated even when a live stack is running on this host/i, 'the live-stack case is addressed head-on')
  assert.match(desc, /run-unique\s+compose project \(sf-srt-stack-<runId>\)/, 'the distinct project guarantee is stated')
  assert.match(desc, /container_name is rebound to\s+sf-srt-stack-<runId>-<svc>/, 'the container_name rebind guarantee is stated')
  assert.match(desc, /loopback-ephemeral/, 'the loopback publish guarantee is stated')
  assert.match(desc, /volumes !reset/, 'the volumes-reset (no host binds) guarantee is stated')
  assert.match(desc, /never\s+touches a running container it did not create/, 'the never-touches-running guarantee is stated')
  assert.match(desc, /name-anchored/, 'the name-anchored teardown guarantee is stated')
  // and the pre-existing verbatim promise survives unchanged (G2 pins it too)
  assert.match(desc, /Nothing touches your real\s+deployment/)
})

check('G2 the live-instance-dast gate is RETIRED: not in the catalog, not renderable — throwaway-dast is the ONLY DAST consent', () => {
  // The "scan an already-running instance" consent is GONE from the catalog: no gate exists
  // that could even OFFER active-scanning a pre-existing instance (someone could unknowingly
  // approve a scan of their real product and its real data). Fail-closed proves it: rendering
  // the retired id throws exactly like any unregistered gate.
  assert.ok(!('live-instance-dast' in GATE_CATALOG), 'the retired gate must not exist in the catalog')
  assert.throws(() => gateOptions('live-instance-dast', {}), /unknown gate 'live-instance-dast'/)
  // the retired id appears NOWHERE in the catalog — no option text can offer the retired path
  assert.ok(!JSON.stringify(GATE_CATALOG).includes('live-instance-dast'), 'no catalog text references the retired gate')
  // throwaway-dast is the ONLY DAST consent gate registered
  assert.deepEqual(Object.keys(GATE_CATALOG).filter((g) => /dast/.test(g)), ['throwaway-dast'],
    'throwaway-dast must be the only DAST gate in the catalog')
})

check('G2 golden snapshot: sf-deep-audit-ops (umbrella live-op consent) — {affirm, force-injected deny}', () => {
  const p = gateOptions('sf-deep-audit-ops', {})
  assert.equal(p.consent, true, 'sf-deep-audit-ops is a consent gate')
  assert.equal(p.kind, 'consent')
  assert.deepEqual(labelsDecisions(p), [
    ['Authorize the deep-audit live ops', 'affirm'],
    ['Skip — source audit only', 'deny'],
  ])
  const byLabel = Object.fromEntries(p.options.map((o) => [o.label, o]))
  // the affirm is the UMBRELLA for every deep-audit skill — pin that clause
  assert.match(byLabel['Authorize the deep-audit live ops'].description, /umbrella for every deep-audit skill/)
  // the decline keeps the review source-only — no live org touched
  assert.match(byLabel['Skip — source audit only'].description, /source only; no org is created, installed into, mutated, or deleted/)
})

check('G2b scanner-install --scanners convenience == the --facts path (byte-identical)', () => {
  const d = tmp()
  const factsFile = join(d, 'f.json')
  writeFileSync(factsFile, JSON.stringify(SCANNERS))
  const viaFacts = execFileSync('node', [CLI, '--gate', 'scanner-install', '--facts', factsFile], { encoding: 'utf8' })
  const viaFlag = execFileSync('node', [CLI, '--gate', 'scanner-install', '--scanners', 'semgrep:pip,gitleaks:binary'], { encoding: 'utf8' })
  assert.equal(viaFlag, viaFacts, '--scanners must produce the same payload as --facts')
})

check('G2c scanner-install renders a $-bearing scanner name LITERALLY (no replace-pattern expansion)', () => {
  // --scanners is free-text CLI input; a string-replacement would let $&/$'/$`/$$ in a
  // scanner name expand the surrounding template. The function-replacer fix renders it literally.
  const p = gateOptions('scanner-install', { scanners: [{ name: "weird$'$&name", method: 'pip' }] })
  assert.ok(p.options[0].description.includes("weird$'$&name (pip)"), '$-patterns must render literally, not expand')
})

check('G3 fail-closed: unknown gate THROWS', () => {
  assert.throws(() => gateOptions('no-such-gate', {}), /unknown gate 'no-such-gate'/)
})

check('G3 fail-closed: an option missing label/description/decision THROWS', () => {
  assert.throws(() => validateOption('x', { label: 'a', description: 'b' }), /missing 'decision'/)
  assert.throws(() => validateOption('x', { label: 'a', decision: 'affirm' }), /missing 'description'/)
  assert.throws(() => validateOption('x', { description: 'b', decision: 'affirm' }), /missing 'label'/)
  assert.throws(() => validateOption('x', null), /non-object option/)
})

check('G3 fail-closed: a decision that is not a record-consent token THROWS', () => {
  assert.throws(() => validateOption('x', { label: 'a', description: 'b', decision: 'maybe' }), /must be 'affirm' or 'deny'/)
  assert.throws(() => validateOption('x', { label: 'a', description: 'b', decision: 'yes' }), /must be 'affirm' or 'deny'/)
})

check('G3 fail-closed: scanner-install with no installable scanners THROWS', () => {
  assert.throws(() => gateOptions('scanner-install', { scanners: [] }), /requires facts\.scanners/)
  assert.throws(() => gateOptions('scanner-install', {}), /requires facts\.scanners/)
})

check('G4 force-injection: the decline is present on EVERY consent gate, even when the selector omits it', () => {
  // the static firstPass set carries NO decline — gateOptions force-injects it.
  assert.ok(!GATE_CATALOG['audit-tier'].firstPass.some((o) => o.decision === 'deny'),
    'pre-injection: the static audit-tier firstPass set has no decline')
  // every consent gate's emitted options carry the gate's exact safeDefault decline.
  // A new consent gate MUST get a representative-facts entry here (the loop asserts it).
  const reps = {
    'audit-tier': {},
    'scanner-install': SCANNERS,
    'mcp-probe': { url: 'https://example.test/mcp' },
    'scope-confirm': {},
    'throwaway-dast': {},
    'sf-deep-audit-ops': {},
    'autorun-permissions': {},
  }
  for (const [gate, spec] of Object.entries(GATE_CATALOG)) {
    if (!spec.consent) continue
    // a new consent gate added to the catalog MUST get a representative-facts entry
    // here, or the "every consent gate" coverage silently undershoots it.
    assert.ok(Object.prototype.hasOwnProperty.call(reps, gate), `new consent gate '${gate}' needs a reps entry in this test`)
    const opts = gateOptions(gate, reps[gate]).options
    const sd = opts.find((o) => o.label === spec.safeDefault.label)
    assert.ok(sd, `${gate} must carry its force-injected safe-default decline`)
    assert.equal(sd.decision, 'deny', `${gate} safe-default must be a deny`)
  }
})

check('G4 non-consent run-mode gets NO injected decline (both options affirm)', () => {
  const p = gateOptions('run-mode', {})
  assert.ok(p.options.every((o) => o.decision === 'affirm'), 'run-mode has no decline option')
})

check('G5 every emitted decision is a valid record-consent token (round-trips through recordConsent)', () => {
  const d = tmp()
  const cases = [['run-mode', {}], ['audit-tier', {}], ['audit-tier', { recordedTier: 'exhaustive' }], ['scanner-install', SCANNERS]]
  for (const [gate, facts] of cases) {
    for (const o of gateOptions(gate, facts).options) {
      const rec = recordConsent('gatespec-probe', o.label, { target: d, decision: o.decision })
      assert.equal(rec.affirmative, o.decision === 'affirm', `${gate} '${o.label}': decision '${o.decision}' must round-trip`)
    }
  }
  // and verify the deny→non-affirmative contract holds end to end
  recordConsent('gatespec-probe', 'Cancel — do not launch', { target: d, decision: 'deny' })
  assert.equal(verifyConsent('gatespec-probe', { target: d }), false)
})

check('G5b parseTier reads the locked tier from a recorded answer label', () => {
  assert.equal(parseTier('Standard (recommended)'), 'standard')
  assert.equal(parseTier('Exhaustive'), 'exhaustive')
  assert.equal(parseTier('Quick (triage)'), 'quick')
  assert.equal(parseTier('Cancel — do not launch'), null)
})

check('G6 WI-01 wiring: the journey renders run-mode / audit-tier / scanner-install THROUGH gate-spec', () => {
  const j = readFileSync(join(PLUGIN, 'skills', 'security-review-journey', 'SKILL.md'), 'utf8')
  assert.match(j, /gate-spec\.mjs --gate run-mode/, 'journey renders run-mode via gate-spec')
  assert.match(j, /gate-spec\.mjs --gate audit-tier/, 'journey renders audit-tier via gate-spec')
  assert.match(j, /gate-spec\.mjs --gate scanner-install/, 'journey renders scanner-install via gate-spec')
  // gate-spec must be in allowed-tools so the driver can invoke it
  assert.match(j, /Bash\(node \*harness\/gate-spec\.mjs \*\)/, 'journey allowed-tools grants gate-spec')
  // the pinned-option contract: render the engine's options verbatim
  assert.match(j, /verbatim/i, 'journey states the render-verbatim contract')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

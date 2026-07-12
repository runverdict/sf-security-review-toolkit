#!/usr/bin/env node
/**
 * Standing test for the autorun permission-set engine (harness/emit-permission-set.mjs) —
 * the FIRST toolkit code that writes to Claude Code's own config, so the boundary is the
 * load-bearing thing under test: `--apply` may ONLY append curated strings to
 * `permissions.allow`, fail-closed on consent, and abort (writing NOTHING) if any other
 * settings key would change.
 *
 * P1  REQUIRED_ALLOW curation — colon-prefix shape, frozen, covers the README allowlist
 *     (parsed from README.md, so the two can't drift), every node entry names a real
 *     harness file (a typo'd engine name turns this RED).
 * P2  the exclusion boundary — NO executor engine (install-scanners / standup-* /
 *     teardown-* / run-dast / capture-* / write-drafted-content / …) and NO blanket
 *     `Bash(*)` / `Bash(node:*)` / `Bash(sf:*)` / destructive shell prefix is in the set.
 * P3  permissionSetSatisfied — fail-safe false on missing/malformed; true only when the
 *     FULL set is present; one missing entry → false.
 * P4  mergePermissionSet — pure: appends exactly the missing entries, dedupes, preserves
 *     existing allow entries AND every unrelated key untouched, idempotent (twice == once),
 *     never mutates its input (deep-frozen input survives).
 * P5  assertOnlyAllowGrew — THE BOUNDARY: passes on a legit merge; THROWS on a created
 *     `permissions.deny`, a changed `env`, a removed key, an altered/reordered existing
 *     allow entry, a shrunk allow, or an appended entry outside REQUIRED_ALLOW. Mutation
 *     proof: neuter the guard (or make merge touch another key) and P5 + P8 turn RED.
 * P6  CLI --check exit codes — 0 satisfied / 2 not; `askedBefore` reflects the recorded
 *     gate; a malformed settings file reports itself and stays exit 2.
 * P7  CLI --apply consent fail-closed — no recorded token → exit 3 and NOTHING written;
 *     a recorded DENY → exit 3 and nothing written; a recorded affirm without the
 *     `--consent` flag → exit ≠ 0 and nothing written.
 * P8  CLI --apply happy path — with a recorded affirm: exit 0, every REQUIRED_ALLOW entry
 *     present, the pre-existing allow entry FIRST and every other key byte-preserved,
 *     pretty-printed 2-space + trailing newline, the partner-facing artifact written.
 *     Idempotent: a second --apply changes nothing on disk.
 * P9  CLI --apply non-clobber refusal — `permissions` not an object / `allow` not an
 *     array / unparseable JSON → exit ≠ 0 and the file BYTE-UNCHANGED (the end-to-end
 *     proof that a value the engine does not own can never be overwritten).
 * P10 gate-spec — the frozen `autorun-permissions` consent gate: pinned question, one
 *     affirm + the force-injected decline, honest option text (settings.local.json,
 *     installs/org-ops/probes still ask, restart to activate).
 * P11 journey wiring — Step 0 runs the --check as the self-skipping FIRST gate (before
 *     the baseline-currency sub-step), renders/records through gate-spec + record-consent,
 *     applies with --consent, grants the harness in allowed-tools, states the never-re-ask
 *     rule and the restart guidance.
 *
 * Dependency-free: `node acceptance/test-emit-permission-set.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  CONSENT_GATE,
  REQUIRED_ALLOW,
  permissionSetSatisfied,
  missingAllowEntries,
  mergePermissionSet,
  assertOnlyAllowGrew,
} from '../harness/emit-permission-set.mjs'
import { gateOptions, GATE_CATALOG } from '../harness/gate-spec.mjs'
import { recordConsent } from '../harness/record-consent.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'emit-permission-set.mjs')

let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) } }
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'permset-')); dirs.push(d); return d }

/** Run the CLI; returns { status, stdout, stderr }. */
const run = (args) => {
  try {
    const stdout = execFileSync('node', [CLI, ...args], { encoding: 'utf8' })
    return { status: 0, stdout, stderr: '' }
  } catch (e) {
    return { status: e.status, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') }
  }
}

const fullSettings = () => ({ permissions: { allow: [...REQUIRED_ALLOW] } })
const settingsFile = (d) => join(d, '.claude', 'settings.local.json')
const writeSettings = (d, obj) => { mkdirSync(join(d, '.claude'), { recursive: true }); writeFileSync(settingsFile(d), JSON.stringify(obj, null, 2) + '\n') }
const deepFreeze = (v) => { if (v && typeof v === 'object') { Object.freeze(v); for (const k of Object.keys(v)) deepFreeze(v[k]) } return v }

console.log('emit-permission-set standing test')

// ── P1 curation ────────────────────────────────────────────────────────────────
check('P1 every entry is a scoped colon-prefix rule and the set is frozen', () => {
  assert.ok(Object.isFrozen(REQUIRED_ALLOW), 'REQUIRED_ALLOW is frozen')
  assert.ok(REQUIRED_ALLOW.length >= 40, `a real curated surface (got ${REQUIRED_ALLOW.length})`)
  for (const e of REQUIRED_ALLOW) {
    assert.match(e, /^Bash\([^()]+:\*\)$/, `${e} must be the colon-prefix Bash(<cmd>:*) form`)
    assert.notEqual(e.replace(/^Bash\(/, '').replace(/:\*\)$/, '').trim(), '', `${e} must scope a real command prefix`)
  }
  assert.equal(new Set(REQUIRED_ALLOW).size, REQUIRED_ALLOW.length, 'no duplicate entries')
})

check('P1 the README hands-off allowlist is a subset (parsed from README.md — no drift)', () => {
  const readme = readFileSync(join(PLUGIN, 'README.md'), 'utf8')
  const documented = [...readme.matchAll(/"(Bash\([^"]+:\*\))"/g)].map((m) => m[1])
  assert.ok(documented.length >= 20, `found the README allowlist entries (got ${documented.length})`)
  for (const e of documented) {
    assert.ok(REQUIRED_ALLOW.includes(e), `README-documented entry ${e} must be in REQUIRED_ALLOW`)
  }
  // the gap entries the README misses are covered too
  for (const e of ['Bash(find:*)', 'Bash(sf config get:*)']) {
    assert.ok(REQUIRED_ALLOW.includes(e), `${e} (the README gap) must be present`)
  }
})

check('P1 every node engine entry names a REAL harness file (a typo cannot ship)', () => {
  const engineEntries = REQUIRED_ALLOW.filter((e) => e.startsWith('Bash(node '))
  assert.ok(engineEntries.length >= 30, `the engine surface is present (got ${engineEntries.length})`)
  for (const e of engineEntries) {
    const m = e.match(/^Bash\(node \*harness\/([a-z0-9-]+\.mjs):\*\)$/)
    assert.ok(m, `${e} must be the Bash(node *harness/<name>.mjs:*) form (no wildcard engine names)`)
    assert.ok(existsSync(join(PLUGIN, 'harness', m[1])), `${m[1]} must exist in harness/`)
  }
})

// ── P2 the exclusion boundary ─────────────────────────────────────────────────
check('P2 NO executor engine is pre-approved (they stay prompting + consent-gated)', () => {
  const EXECUTORS = [
    'install-scanners', 'standup-org', 'standup-stack', 'teardown-org', 'teardown-stack',
    'run-dast', 'capture-openapi', 'capture-org-mcp', 'write-drafted-content',
    'agent-trace-probe', 'normalize-agent-test', 'scaffold-env', 'cleanup-scanners',
    'build-managed-package',
  ]
  for (const x of EXECUTORS) {
    assert.ok(!REQUIRED_ALLOW.some((e) => e.includes(x)), `executor '${x}' must NOT be in REQUIRED_ALLOW`)
  }
})

check('P2 NO blanket or destructive prefix is in the set', () => {
  const BANNED = [
    'Bash(*)', 'Bash(node:*)', 'Bash(node *)', 'Bash(sf:*)', 'Bash(sf *)',
    'Bash(curl:*)', 'Bash(rm:*)', 'Bash(cp:*)', 'Bash(mkdir:*)', 'Bash(npm install:*)',
    'Bash(node *harness/*.mjs:*)', // a wildcard engine name would cover the executors
  ]
  for (const b of BANNED) {
    assert.ok(!REQUIRED_ALLOW.includes(b), `${b} must NOT be in REQUIRED_ALLOW`)
  }
})

// ── P3 permissionSetSatisfied ─────────────────────────────────────────────────
check('P3 satisfied ⟺ the full set is present; fail-safe false on missing/malformed', () => {
  assert.equal(permissionSetSatisfied(fullSettings()), true, 'full set → true')
  const oneShort = { permissions: { allow: REQUIRED_ALLOW.slice(1) } }
  assert.equal(permissionSetSatisfied(oneShort), false, 'missing one → false')
  assert.equal(missingAllowEntries(oneShort).length, 1, 'exactly the one missing entry reported')
  assert.deepEqual(missingAllowEntries(oneShort), [REQUIRED_ALLOW[0]])
  for (const bad of [undefined, null, {}, [], 'x', 42, { permissions: null }, { permissions: 'x' }, { permissions: { allow: 'nope' } }, { permissions: { allow: null } }]) {
    assert.equal(permissionSetSatisfied(bad), false, `${JSON.stringify(bad)} → false (fail-safe)`)
  }
  assert.equal(missingAllowEntries({}).length, REQUIRED_ALLOW.length, 'empty settings → everything missing')
  // extra unrelated entries never break satisfaction
  assert.equal(permissionSetSatisfied({ permissions: { allow: ['Bash(make:*)', ...REQUIRED_ALLOW] } }), true)
})

// ── P4 mergePermissionSet ─────────────────────────────────────────────────────
check('P4 merge appends exactly the missing entries, dedupes, preserves order', () => {
  const present = [REQUIRED_ALLOW[3], REQUIRED_ALLOW[0]]
  const input = { permissions: { allow: ['Bash(make:*)', ...present] } }
  const { next, added } = mergePermissionSet(input)
  assert.equal(added.length, REQUIRED_ALLOW.length - 2, 'only the missing entries are added')
  assert.ok(!added.includes(REQUIRED_ALLOW[0]) && !added.includes(REQUIRED_ALLOW[3]), 'present entries are NOT re-added')
  assert.deepEqual(next.permissions.allow.slice(0, 3), ['Bash(make:*)', REQUIRED_ALLOW[3], REQUIRED_ALLOW[0]], 'existing entries keep their order, first')
  assert.equal(new Set(next.permissions.allow).size, next.permissions.allow.length, 'no duplicates after merge')
  assert.equal(permissionSetSatisfied(next), true, 'merged settings satisfy the check')
})

check('P4 merge preserves an unrelated allow entry AND every unrelated key untouched', () => {
  const input = {
    permissions: { allow: ['Bash(make:*)'], deny: ['Bash(rm -rf:*)'], defaultMode: 'default' },
    env: { X: 1 },
    hooks: { PreToolUse: [{ matcher: 'Bash' }] },
  }
  const snapshot = JSON.parse(JSON.stringify(input))
  const { next } = mergePermissionSet(input)
  assert.deepEqual(next.permissions.deny, snapshot.permissions.deny, 'permissions.deny untouched')
  assert.deepEqual(next.permissions.defaultMode, snapshot.permissions.defaultMode, 'permissions.defaultMode untouched')
  assert.deepEqual(next.env, snapshot.env, 'env untouched')
  assert.deepEqual(next.hooks, snapshot.hooks, 'hooks untouched')
  assert.equal(next.permissions.allow[0], 'Bash(make:*)', 'the unrelated allow entry survives, first')
  assert.deepEqual(input, snapshot, 'the INPUT object was not mutated')
})

check('P4 merge is idempotent (twice == once) and never mutates a frozen input', () => {
  const frozen = deepFreeze({ permissions: { allow: ['Bash(make:*)'] }, env: { X: 1 } })
  const once = mergePermissionSet(frozen) // would THROW on any push into the frozen input
  const twice = mergePermissionSet(once.next)
  assert.equal(twice.added.length, 0, 'second merge adds nothing')
  assert.deepEqual(twice.next, once.next, 'second merge is a fixed point')
})

check('P4 merge REFUSES a permissions/allow value it would have to overwrite (fail closed)', () => {
  assert.throws(() => mergePermissionSet({ permissions: 'locked' }), /not an object/, 'permissions non-object → throw')
  assert.throws(() => mergePermissionSet({ permissions: ['x'] }), /not an object/, 'permissions array → throw')
  assert.throws(() => mergePermissionSet({ permissions: { allow: { a: 1 } } }), /not an array/, 'allow non-array → throw')
  assert.throws(() => mergePermissionSet('not-an-object'), /must be a JSON object/, 'settings non-object → throw')
  // absent/null settings are the empty file — fine
  assert.equal(mergePermissionSet(null).added.length, REQUIRED_ALLOW.length)
})

// ── P5 THE BOUNDARY (load-bearing) ────────────────────────────────────────────
check('P5 assertOnlyAllowGrew passes on a legit merge and on the no-op merge', () => {
  const original = { permissions: { allow: ['Bash(make:*)'], deny: ['Bash(rm:*)'] }, env: { X: 1 } }
  const { next } = mergePermissionSet(original)
  assertOnlyAllowGrew(original, next) // must NOT throw
  assertOnlyAllowGrew(fullSettings(), mergePermissionSet(fullSettings()).next) // no-op merge
  assertOnlyAllowGrew({}, mergePermissionSet({}).next) // creating the container for allow alone is fine
})

check('P5 BOUNDARY: any non-allow delta THROWS (deny/ask/defaultMode/env/removed keys)', () => {
  const original = { permissions: { allow: ['Bash(make:*)'] }, env: { X: 1 } }
  const legit = () => mergePermissionSet(original).next
  const cases = [
    ['creates permissions.deny', (n) => { n.permissions.deny = [] }],
    ['creates permissions.ask', (n) => { n.permissions.ask = ['Bash(rm:*)'] }],
    ['creates permissions.defaultMode', (n) => { n.permissions.defaultMode = 'bypassPermissions' }],
    ['creates autoMode', (n) => { n.autoMode = { enabled: true } }],
    ['changes env', (n) => { n.env.X = 2 }],
    ['removes a key', (n) => { delete n.env }],
    ['adds a top-level key', (n) => { n.apiKeyHelper = '/bin/sh' }],
  ]
  for (const [name, tamper] of cases) {
    const n = legit()
    tamper(n)
    assert.throws(() => assertOnlyAllowGrew(original, n), /BOUNDARY/, `${name} must throw`)
  }
})

check('P5 BOUNDARY: allow itself may only GROW with curated strings', () => {
  const original = { permissions: { allow: ['Bash(make:*)', REQUIRED_ALLOW[0]] } }
  const legit = () => mergePermissionSet(original).next
  const altered = legit(); altered.permissions.allow[0] = 'Bash(rm:*)'
  assert.throws(() => assertOnlyAllowGrew(original, altered), /BOUNDARY/, 'altering an existing entry throws')
  const reordered = legit(); reordered.permissions.allow.reverse()
  assert.throws(() => assertOnlyAllowGrew(original, reordered), /BOUNDARY/, 'reordering existing entries throws')
  const shrunk = legit(); shrunk.permissions.allow = []
  assert.throws(() => assertOnlyAllowGrew(original, shrunk), /BOUNDARY/, 'a shrunk allow throws')
  const smuggled = legit(); smuggled.permissions.allow.push('Bash(curl:*)')
  assert.throws(() => assertOnlyAllowGrew(original, smuggled), /BOUNDARY/, 'an appended entry outside REQUIRED_ALLOW throws')
  const noAllow = { permissions: {} }
  assert.throws(() => assertOnlyAllowGrew(original, noAllow), /BOUNDARY/, 'a merged object with no allow array throws')
})

// ── P6 CLI --check ────────────────────────────────────────────────────────────
check('P6 --check: exit 2 + full missing list on an empty target; askedBefore false', () => {
  const d = tmp()
  const r = run(['--check', '--target', d, '--json'])
  assert.equal(r.status, 2, 'not satisfied → exit 2')
  const j = JSON.parse(r.stdout)
  assert.equal(j.satisfied, false)
  assert.equal(j.missingCount, REQUIRED_ALLOW.length)
  assert.equal(j.askedBefore, false)
})

check('P6 --check: exit 0 when the set is present; askedBefore true after a recorded answer', () => {
  const d = tmp()
  writeSettings(d, fullSettings())
  const r0 = run(['--check', '--target', d, '--json'])
  assert.equal(r0.status, 0, 'satisfied → exit 0')
  assert.equal(JSON.parse(r0.stdout).satisfied, true)
  // a recorded DECLINE flips askedBefore (the never-re-ask branch) without satisfying anything
  const d2 = tmp()
  recordConsent(CONSENT_GATE, "Skip — I'll approve prompts as they come", { target: d2, decision: 'deny' })
  const r1 = run(['--check', '--target', d2, '--json'])
  assert.equal(r1.status, 2, 'still not satisfied')
  assert.equal(JSON.parse(r1.stdout).askedBefore, true, 'askedBefore true — the preflight must not re-ask')
})

check('P6 --check: a malformed settings file reports itself and stays exit 2', () => {
  const d = tmp()
  mkdirSync(join(d, '.claude'), { recursive: true })
  writeFileSync(settingsFile(d), '{ not json')
  const r = run(['--check', '--target', d, '--json'])
  assert.equal(r.status, 2)
  const j = JSON.parse(r.stdout)
  assert.equal(j.malformed, true)
  assert.equal(j.satisfied, false, 'malformed is never satisfied (fail-safe)')
})

// ── P7 CLI --apply consent fail-closed ────────────────────────────────────────
check('P7 --apply with NO recorded token: exit 3, NOTHING written', () => {
  const d = tmp()
  const r = run(['--apply', '--target', d, '--consent'])
  assert.equal(r.status, 3, 'fail closed → exit 3')
  assert.match(r.stderr, /FAIL CLOSED/, 'says why')
  assert.ok(!existsSync(settingsFile(d)), 'settings file NOT created')
  assert.ok(!existsSync(join(d, '.security-review', 'autorun-permissions.md')), 'artifact NOT created')
})

check('P7 --apply with a recorded DENY: exit 3, nothing written (deny is never a yes)', () => {
  const d = tmp()
  recordConsent(CONSENT_GATE, "Skip — I'll approve prompts as they come", { target: d, decision: 'deny' })
  const r = run(['--apply', '--target', d, '--consent'])
  assert.equal(r.status, 3)
  assert.ok(!existsSync(settingsFile(d)), 'settings file NOT created')
})

check('P7 --apply without the --consent flag: exit ≠ 0 even with a recorded affirm', () => {
  const d = tmp()
  recordConsent(CONSENT_GATE, 'Write the read-only allowlist', { target: d, decision: 'affirm' })
  const r = run(['--apply', '--target', d])
  assert.notEqual(r.status, 0)
  assert.ok(!existsSync(settingsFile(d)), 'settings file NOT created')
})

// ── P8 CLI --apply happy path ─────────────────────────────────────────────────
check('P8 consented --apply: allow grows, every other key byte-preserved, artifact written', () => {
  const d = tmp()
  const original = {
    permissions: { allow: ['Bash(make:*)'], deny: ['Bash(rm -rf:*)'], defaultMode: 'default' },
    env: { KEEP: '1' },
  }
  writeSettings(d, original)
  recordConsent(CONSENT_GATE, 'Write the read-only allowlist', { target: d, decision: 'affirm' })
  const r = run(['--apply', '--target', d, '--consent', '--json'])
  assert.equal(r.status, 0, `apply succeeds (stderr: ${r.stderr})`)
  const raw = readFileSync(settingsFile(d), 'utf8')
  const written = JSON.parse(raw)
  assert.equal(raw, JSON.stringify(written, null, 2) + '\n', 'pretty-printed 2-space + trailing newline')
  assert.equal(written.permissions.allow[0], 'Bash(make:*)', 'pre-existing allow entry preserved, first')
  assert.equal(permissionSetSatisfied(written), true, 'the full set is now present')
  assert.deepEqual(written.permissions.deny, original.permissions.deny, 'deny untouched')
  assert.equal(written.permissions.defaultMode, 'default', 'defaultMode untouched')
  assert.deepEqual(written.env, original.env, 'env untouched')
  // the partner-facing artifact
  const art = readFileSync(join(d, '.security-review', 'autorun-permissions.md'), 'utf8')
  assert.match(art, /permissions\.allow/, 'artifact names the one key it touched')
  assert.match(art, /read-only/i, 'artifact states the read-only scope')
  assert.match(art, /still prompt|still ask/i, 'artifact states installs/org-ops/probes still prompt')
  assert.match(art, /consent/i, 'artifact states the consent-gating survives')
  assert.match(art, /How to remove/i, 'artifact carries the removal instructions')
  assert.ok(art.includes('Bash(git status:*)'), 'artifact lists the added entries')
  // and the check now passes
  assert.equal(run(['--check', '--target', d]).status, 0)
})

check('P8 --apply is idempotent: a second run changes nothing on disk', () => {
  const d = tmp()
  recordConsent(CONSENT_GATE, 'Write the read-only allowlist', { target: d, decision: 'affirm' })
  assert.equal(run(['--apply', '--target', d, '--consent']).status, 0)
  const rawSettings = readFileSync(settingsFile(d), 'utf8')
  const rawArtifact = readFileSync(join(d, '.security-review', 'autorun-permissions.md'), 'utf8')
  const again = run(['--apply', '--target', d, '--consent', '--json'])
  assert.equal(again.status, 0)
  assert.equal(JSON.parse(again.stdout).addedCount, 0, 'nothing left to add')
  assert.equal(readFileSync(settingsFile(d), 'utf8'), rawSettings, 'settings byte-identical')
  assert.equal(readFileSync(join(d, '.security-review', 'autorun-permissions.md'), 'utf8'), rawArtifact, 'artifact byte-identical (not clobbered)')
})

// ── P9 CLI --apply non-clobber refusal (the end-to-end boundary) ──────────────
check('P9 --apply refuses to overwrite a value it does not own: file BYTE-UNCHANGED', () => {
  for (const bad of [
    { permissions: 'locked' }, // permissions is not an object
    { permissions: { allow: { a: 1 } } }, // allow is not an array
  ]) {
    const d = tmp()
    writeSettings(d, bad)
    recordConsent(CONSENT_GATE, 'Write the read-only allowlist', { target: d, decision: 'affirm' })
    const before = readFileSync(settingsFile(d), 'utf8')
    const r = run(['--apply', '--target', d, '--consent'])
    assert.notEqual(r.status, 0, `${JSON.stringify(bad)} must be refused`)
    assert.match(r.stderr, /refusing|refused/i, 'says it refused')
    assert.equal(readFileSync(settingsFile(d), 'utf8'), before, 'settings file byte-unchanged')
    assert.ok(!existsSync(join(d, '.security-review', 'autorun-permissions.md')), 'no artifact on refusal')
  }
})

check('P9 --apply refuses an unparseable settings file: exit ≠ 0, byte-unchanged', () => {
  const d = tmp()
  mkdirSync(join(d, '.claude'), { recursive: true })
  writeFileSync(settingsFile(d), '{ "permissions": broken')
  recordConsent(CONSENT_GATE, 'Write the read-only allowlist', { target: d, decision: 'affirm' })
  const before = readFileSync(settingsFile(d), 'utf8')
  const r = run(['--apply', '--target', d, '--consent'])
  assert.notEqual(r.status, 0)
  assert.equal(readFileSync(settingsFile(d), 'utf8'), before, 'settings file byte-unchanged')
})

// ── P10 gate-spec ─────────────────────────────────────────────────────────────
check('P10 the autorun-permissions gate: pinned consent shape with a force-injected decline', () => {
  assert.equal(CONSENT_GATE, 'autorun-permissions', 'the engine and the gate share one id')
  assert.equal(GATE_CATALOG['autorun-permissions'].kind, 'consent', 'a catalog consent gate')
  const p = gateOptions('autorun-permissions', {})
  assert.equal(p.consent, true)
  assert.equal(p.question, 'Set this repo up to run the review uninterrupted?')
  assert.deepEqual(p.options.map((o) => [o.label, o.decision]), [
    ['Write the read-only allowlist', 'affirm'],
    ["Skip — I'll approve prompts as they come", 'deny'],
  ])
  const affirm = p.options[0]
  assert.match(affirm.description, /\.claude\/settings\.local\.json/, 'affirm names the file it writes')
  assert.match(affirm.description, /installs, org ops, and live probes still ask/, 'affirm discloses what still asks')
  assert.match(affirm.description, /restart Claude Code/i, 'affirm states the restart-to-activate step')
  assert.match(affirm.description, /permissions\.allow entries only/, 'affirm states the allow-only boundary')
  assert.match(p.options[1].description, /Write nothing/, 'decline writes nothing')
  assert.match(p.options[1].description, /not asked again/, 'decline states the ask-once rule')
})

// ── P11 journey wiring ────────────────────────────────────────────────────────
check('P11 journey Step 0: the self-skipping check runs FIRST and the gate wiring is present', () => {
  const j = readFileSync(join(PLUGIN, 'skills', 'security-review-journey', 'SKILL.md'), 'utf8')
  assert.match(j, /emit-permission-set\.mjs --check --target/, 'Step 0 runs the --check')
  assert.match(j, /gate-spec\.mjs --gate autorun-permissions/, 'renders the pinned gate through gate-spec')
  assert.match(j, /record-consent\.mjs --gate autorun-permissions --decision <affirm\|deny>/, 'records the choice through record-consent')
  assert.match(j, /emit-permission-set\.mjs --apply --target <target> --consent/, 'applies with --consent after the recording')
  assert.match(j, /Bash\(node \*harness\/emit-permission-set\.mjs \*\)/, 'allowed-tools grants the harness')
  assert.match(j, /RESTART Claude Code/, 'the restart-to-activate guidance is stated')
  assert.match(j, /NEVER re-ask/, 'the never-re-ask rule is stated')
  assert.match(j, /askedBefore/, 'branches on the engine-reported askedBefore, not driver memory')
  assert.match(j, /aborts and writes nothing|aborts rather than change/, 'states the code-enforced allow-only boundary')
  // it is genuinely the FIRST preflight sub-step: the check precedes the baseline-currency step
  const checkAt = j.indexOf('emit-permission-set.mjs --check')
  const baselineAt = j.indexOf('Check baseline currency')
  assert.ok(checkAt > 0 && baselineAt > 0 && checkAt < baselineAt, 'the permission self-check precedes the baseline-currency sub-step')
  // satisfied → silent (the self-skipping half)
  assert.match(j, /say NOTHING about permissions/, 'satisfied → say nothing')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

#!/usr/bin/env node
/**
 * Standing test for skills/run-scans/SKILL.md prose (0.8.109) — the DAST fires-path ladder,
 * the lockfile-less Python SCA rule + fail-loud-on-uncovered-manifest coverage rule, and the
 * ReDoS `.txt` auto-route. These are PROSE guards (the run-scans skill is Markdown a driver
 * reads, not an engine): they lock the load-bearing sentences so a future edit that silently
 * drops the ladder, the pip-audit fallback, the coverage rule, or the auto-ingest fails the
 * build — exactly the ci-hygiene skill-prose-guard pattern (test-ci-hygiene.mjs F8-compose-iac).
 *
 *   F1  Family 3 documents the MIRROR-ONLY fires-path ladder (prebuilt *.prod.yml →
 *       build SERIALIZED never-during → fix-the-mirror at all costs → honest-degrade to
 *       PENDING-OWNER-RUN) and the retired running-instance rung is GONE
 *   F2  the SKILL states DAST/capture REFUSE a pre-existing `--base-url` (exit 3) and only ever
 *       scan the toolkit-built disposable mirror (`--from-standup`); no explicit --base-url
 *       invocation survives
 *   F3  serialize rule: build BEFORE or AFTER the audit fan-out, never DURING
 *   F4  SCA Family carries `pip-audit` as a FIRST-CLASS installed scanner for lockfile-less Python
 *       (consented install set + evidence name + adapter + gate; PENDING-OWNER-RUN only absent consent)
 *   F5  fail-loud on any dependency manifest no scanner covered → coverage gap, never a silent pass
 *   F6  ReDoS `.txt` ingest AUTO-runs after the redos scan (regexploit explicit-scanner form)
 *   F7  `live-instance-dast` is RETIRED: never offered/named as a scan gate — `throwaway-dast`
 *       is the ONLY DAST consent, and the SKILL forbids offering a running-instance scan
 *   F8  the journey SKILL carries no running-instance wiring either: `--from-standup` only,
 *       no `live-instance-dast`, no explicit `--base-url` capture/DAST invocation
 *   F9  the never-touch-anything-already-running HARD RULE (prod-outage fix) is stated
 *       in BOTH skills: collision → DEGRADE (PENDING-OWNER-RUN + honest diagnosis),
 *       never a manual clear; no `docker rm`/`stop`/`kill`/`compose down` (or
 *       `sf org delete`) on a non-toolkit resource; removal only via the name-anchored
 *       teardown engines; "at all costs" bounded to the disposable copy
 *   F10 the journey's SOURCE OF TRUTH & MEMORY-INDEPENDENCE operating rule: the toolkit
 *       is SELF-AUTHORITATIVE (live engines + gates + `.security-review/` artifacts are
 *       the SOLE source of truth); host/session memory is UNTRUSTED / MAY BE STALE and
 *       never overrides a live engine decision or pre-empts a consent gate
 *   F11 the journey's write-side memory rule: DO NOT WRITE host-session operational
 *       memories about the toolkit — a defect is fixed in CODE + recorded in
 *       CHANGELOG/artifacts, never a host memory that contaminates future runs
 *   F12 the journey's NEVER-AUTO-DECIDE-A-GATE rule at the consent-gate section: every
 *       gate is surfaced LIVE; a memory/standing note is a NOTE raised inside the gate,
 *       the OPERATOR decides; the stale-memory throwaway-dast DENY is named + forbidden
 *   F13 run-scans carries the throwaway-dast pointer: the gate is the operator's LIVE
 *       call — never auto-declined from a memory; degrade only on the operator's own
 *       decline or a genuine engine refusal (needs-secrets / no-docker)
 *
 * Dependency-free: `node acceptance/test-run-scans-fires-path.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const skill = readFileSync(join(PLUGIN, 'skills', 'run-scans', 'SKILL.md'), 'utf8')
const journey = readFileSync(join(PLUGIN, 'skills', 'security-review-journey', 'SKILL.md'), 'utf8')

let pass = 0, fail = 0
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`) } }

console.log('run-scans fires-path (mirror-only) + lockfile-less-SCA + ReDoS-auto-route prose guard')

check('F1 Family 3 documents the MIRROR-ONLY fires-path ladder (DAST must FIRE; no running-instance rung)', () => {
  // MUTATION: dropping the ladder — or reverting the SKILL to re-describe the retired
  // running-instance scan rung — → red
  assert.match(skill, /FIRES-PATH LADDER/, 'the ladder must be named in Family 3')
  assert.match(skill, /DAST must FIRE regardless of app size/, 'the headline invariant must be stated')
  assert.match(skill, /MIRROR-ONLY, no exceptions/, 'the ladder is framed mirror-only')
  assert.match(skill, /DISPOSABLE THROWAWAY MIRROR/i, 'DAST/capture only ever hit the toolkit-built disposable throwaway')
  // rung 1: prebuilt-image compose
  assert.match(skill, /Prebuilt-image compose/i, 'rung 1: prebuilt-image compose')
  assert.match(skill, /buildsFromSource:false/, 'rung 1 references the stack-detect prebuilt signal')
  // rung 2: build from source, SERIALIZED
  assert.match(skill, /Build from source[^\n]*SERIALIZED/i, 'rung 2: build from source, serialized')
  // rung 3: get the mirror working at all costs — fix the MIRROR's copy, never the partner's files
  assert.match(skill, /GET THE MIRROR WORKING AT ALL COSTS/, 'rung 3: the fix-the-mirror doctrine is titled')
  assert.match(skill, /mirror-fixes\.md/, 'rung 3 logs the partner-facing mirror-fixes.md')
  assert.match(skill, /real compose files, Dockerfiles, and source are NEVER\s+edited/i,
    'the mirror fix never touches the partner\'s real files')
  // rung 4: honest-degrade as the LAST resort — PENDING-OWNER-RUN, never a running-instance scan
  assert.match(skill, /Honest-degrade/i, 'rung 4: honest-degrade')
  assert.match(skill, /DEGRADE to \*\*PENDING-OWNER-RUN\*\*/, 'the degrade lands DAST/capture at PENDING-OWNER-RUN')
  assert.match(skill, /NEVER a running-instance scan/, 'the degrade is never a running-instance scan')
  assert.match(skill, /fire\s+first, degrade last/i, 'the ladder posture: fire first, degrade last')
  // the retired rung is GONE — the mirror-only mutation guard
  assert.doesNotMatch(skill, /Already-running loopback instance/i, 'the retired running-instance rung must not survive')
  assert.doesNotMatch(skill, /OFFER the live-instance scan/i, 'the SKILL must not offer a live-instance scan')
})

check('F2 the SKILL states DAST/capture REFUSE a pre-existing --base-url and only scan the toolkit-built mirror', () => {
  // MUTATION: re-surfacing an explicit --base-url DAST/capture invocation, or dropping the refusal, → red
  assert.match(skill, /REFUSE an explicit `--base-url`/, 'the engines refuse an explicit --base-url (exit 3)')
  assert.match(skill, /--from-standup/, 'the stand-up pointer is the only input form')
  assert.match(skill, /NEVER scan or capture a pre-existing/, 'no pre-existing/running instance is ever scanned or captured')
  assert.match(skill, /loopback is NOT a\s+sufficient safeguard|loopback is NOT\s+a sufficient safeguard|loopback is NOT a sufficient safeguard/,
    'loopback-not-sufficient is stated')
  assert.match(skill, /real instance is also on loopback/, 'WHY: a real instance is also on loopback')
  // the retired rung-1 surfacing is GONE
  assert.doesNotMatch(skill, /--base-url\s+http:\/\/127\.0\.0\.1/, 'no explicit --base-url loopback invocation survives')
  assert.doesNotMatch(skill, /Explicit `--base-url` ALWAYS wins/, 'the retired explicit-wins primitive must not survive')
  assert.doesNotMatch(skill, /ZERO build, ZERO stand-up/i, 'the retired no-build no-standup rung framing must not survive')
})

check('F3 serialize rule: build BEFORE or AFTER the audit fan-out, never DURING', () => {
  // MUTATION: dropping the never-during serialization rule → red
  assert.match(skill, /BEFORE or AFTER the audit fan-out, never DURING/i,
    'the serialization rule (build before/after the fan-out, never during) must be present')
  assert.match(skill, /resource contention|competing[^\n]*cores|lost the last cores/i,
    'the rule must state WHY (resource contention with the fan-out, not a broken build)')
})

check('F4 SCA Family carries pip-audit as a FIRST-CLASS installed scanner for lockfile-less Python (the coldrun-#4 doctrine reversal)', () => {
  // MUTATION: dropping the pip-audit rule — or reverting it to the OLD never-install posture — → red
  assert.match(skill, /Lockfile-less Python SCA/i, 'the lockfile-less Python SCA rule must be titled in the SCA family')
  assert.match(skill, /OSV-Scanner \*\*cannot resolve version ranges\*\*|cannot resolve version ranges/i,
    'the rule must state WHY OSV misses lockfile-less pyproject/requirements (it needs pins)')
  // scope the doctrine assertions to the lockfile-less section so an unrelated mention can never satisfy them
  const section = skill.split(/\*\*Lockfile-less Python SCA/)[1].split(/\*\*Fail loud on any dependency manifest/)[0]
  assert.match(section, /first-class INSTALLED scanner/i,
    'pip-audit is a first-class installed scanner, not a hard-boundary carve-out')
  assert.match(section, /consented tmp\s+install set|`install-scanners\.mjs` `PIP_TOOLS`/,
    'pip-audit rides the consented install set (install-scanners PIP_TOOLS)')
  assert.match(section, /evidence\/pip-audit-<date>\.json/, 'the documented evidence name (the scan-status Family-8 row credits pip-audit-*)')
  assert.match(section, /`pip-audit` adapter/, 'the pip-audit ingest adapter is named')
  assert.match(section, /scan-external-sca/, 'the dep-CVE gate is named')
  assert.match(section, /no CVSS/i, 'the unscored-band honesty rule (pip-audit emits no CVSS → medium) must be stated')
  assert.match(section, /network I\/O|standard-fetch doctrine/,
    'absent consent the standard-fetch doctrine holds — the scan is network I/O')
  assert.match(section, /PENDING-OWNER-RUN/, 'absent the install consent pip-audit still stays PENDING-OWNER-RUN')
  // the OLD doctrine is GONE — these two literals were the never-install posture this slice reverses
  assert.doesNotMatch(skill, /agent-run when present,\s*`?PENDING-OWNER-RUN`? when absent/i,
    'the old present→agent / absent→owner-run posture must not survive')
  assert.doesNotMatch(skill, /Do NOT edit `install-scanners\.mjs`/,
    'the old never-touch-install-scanners instruction must not survive')
})

check('F5 fail-loud on any dependency manifest no scanner covered → coverage gap, never a silent pass', () => {
  // MUTATION: removing the fail-loud coverage rule → red
  assert.match(skill, /Fail loud on any dependency manifest no scanner covered/i,
    'the fail-loud-on-uncovered-manifest rule must be present')
  assert.match(skill, /coverage gap/i, 'an un-audited manifest surfaces as a coverage gap in the scan-status render')
  assert.match(skill, /never a silent pass|MUST NOT read as a clean/i, 'it must never read as a clean scan-external-sca pass')
})

check('F6 ReDoS `.txt` ingest AUTO-runs after the redos scan (not deferred to a manual re-run)', () => {
  // MUTATION: reverting the auto-run wording back to "manual re-run only" → red
  assert.match(skill, /AUTO-run the explicit-scanner ingest form immediately after the redos scan/i,
    'the ReDoS ingest must auto-run right after the redos scan')
  assert.match(skill, /--scanner regexploit --input evidence\/redos-<date>\.txt/,
    'the explicit regexploit ingest form must be shown in the Family 7 flow')
  assert.match(skill, /do\s+NOT defer it to a manual re-run/i,
    'the prose must forbid deferring the .txt ingest (the cold-run miss)')
})

check('F7 live-instance-dast is RETIRED: never offered as a scan gate — throwaway-dast is the ONLY DAST consent', () => {
  // MUTATION: reverting the SKILL to name/offer the retired running-instance gate → red
  assert.doesNotMatch(skill, /live-instance-dast/, 'the retired live-instance-dast gate must not be named or offered')
  assert.match(skill, /ONLY DAST consent is `throwaway-dast`/, 'throwaway-dast is the only DAST consent')
  assert.match(skill, /no consent that unlocks a\s+running-instance scan/,
    'no consent unlocks a running-instance scan')
  assert.match(skill, /Do not offer,\s+suggest, or accept a running-instance scan/,
    'the driver must not offer, suggest, or accept a running-instance scan under any framing')
})

check('F8 the journey SKILL carries no running-instance wiring: --from-standup only, no live-instance gate', () => {
  // MUTATION: reverting the journey to re-wire a --base-url capture/DAST (the retired
  // running-instance fallback) → red
  assert.doesNotMatch(journey, /live-instance-dast/, 'the retired live-instance-dast gate must not survive in the journey')
  assert.doesNotMatch(journey, /--base-url\s+http/, 'no explicit --base-url invocation survives in the journey')
  assert.doesNotMatch(journey, /--base-url <baseUrl/, 'the capture/DAST invocations must not thread a --base-url')
  assert.match(journey, /run-dast\.mjs --consent --from-standup/, 'run-dast is invoked mirror-only via --from-standup')
  assert.match(journey, /capture-openapi\.mjs --consent --from-standup/, 'capture-openapi is invoked mirror-only via --from-standup')
  assert.match(journey, /REFUSE an explicit `--base-url` outright, exit 3/,
    'the journey states both engines refuse an explicit --base-url')
  assert.match(journey, /No running-instance fallback/, 'the failed-mirror branch degrades — no running-instance fallback')
  assert.match(journey, /real instance is also on loopback/, 'WHY: a real instance is also on loopback')
})

check('F9 the never-touch-anything-already-running HARD RULE (prod-outage fix) is stated in BOTH skills — degrade, never clear', () => {
  // MUTATION: deleting the hard rule — or any of its named command literals — from
  // either SKILL → red. Whitespace-normalized so hard-wrapped Markdown can't dodge it.
  const flatten = (t) => t.replace(/\s+/g, ' ')
  for (const [name, text] of [['run-scans', flatten(skill)], ['journey', flatten(journey)]]) {
    const has = (phrase, why) => assert.ok(text.includes(phrase), `${name}: ${why} — missing '${phrase}'`)
    has('NEVER touches, stops, removes, or deletes ANYTHING already running that the toolkit did not itself stand up',
      'the hard rule headline (running resources are untouchable, files included)')
    has('it may be your live stack; I will NOT touch it', 'the honest collision diagnosis, verbatim')
    has('PENDING-OWNER-RUN with the honest diagnosis', 'a collision means DEGRADE, never clear')
    has('`docker rm` / `docker stop` / `docker kill` / `docker compose down` (or `sf org delete`)',
      'the banned destructive commands are NAMED (docker AND sf — the rule is general)')
    has('name-anchored teardown engines', 'all removal goes through the teardown engines')
    has('recurs as `sf org delete` in the deep-audit lane',
      'the failure mode is stated generally: the same improvised-destructive-op recurs on the sf side')
  }
  // run-scans specifically re-bounds "at all costs" to the disposable copy
  assert.ok(flatten(skill).includes('bounded to the DISPOSABLE COPY only'),
    'run-scans: "get the mirror working at all costs" is bounded to the disposable copy, never anything running')
})

check('F10 the journey states SOURCE OF TRUTH & MEMORY-INDEPENDENCE — self-authoritative; memory never overrides or pre-empts', () => {
  // MUTATION: deleting the memory-independence operating block (or its override/pre-empt
  // halves) → red. Whitespace-normalized so hard-wrapped Markdown can't dodge it.
  const flat = journey.replace(/\s+/g, ' ')
  const has = (phrase, why) => assert.ok(flat.includes(phrase), `journey: ${why} — missing '${phrase}'`)
  assert.match(journey, /SOURCE OF TRUTH & MEMORY-INDEPENDENCE/, 'the operating rule is titled')
  has('The toolkit is SELF-AUTHORITATIVE', 'the self-authoritative headline')
  has('are the SOLE source of truth', 'live engines + gates + on-disk artifacts are the sole source of truth')
  has('(audit-ledger, scope-manifest, deterministic-dispositions, `consent/`)', 'the .security-review/ artifacts are named')
  has('every run RE-DERIVES its facts from the current engine state', 're-derive, never replay a memory')
  has('UNTRUSTED and MAY BE STALE', 'host/session memory is untrusted and may be stale')
  has('may describe behavior that has since been FIXED IN CODE', 'WHY stale: the toolkit updates; old memories describe fixed behavior')
  has('A memory NEVER overrides a live engine decision', 'the override half is forbidden')
  has('NEVER pre-empts, pre-decides, or auto-declines a consent gate', 'the gate pre-emption half is forbidden')
})

check('F11 the journey forbids WRITING host-session operational memories about the toolkit (the write-side half)', () => {
  // MUTATION: deleting the do-not-write-operational-memory sentence → red
  const flat = journey.replace(/\s+/g, ' ')
  const has = (phrase, why) => assert.ok(flat.includes(phrase), `journey: ${why} — missing '${phrase}'`)
  has('DO NOT WRITE host-session operational memories', 'the write-side prohibition headline')
  has('fixed in the toolkit\'s CODE and recorded in its CHANGELOG and `.security-review/` artifacts', 'where a toolkit defect IS recorded')
  has('never in a host memory that silently contaminates future runs', 'the contamination framing')
  has('a stale "never do X here" memory is exactly what blocks a toolkit that has since been fixed', 'the concrete contamination shape')
  has('it stops the contamination at the source', 'the write side is the important half')
})

check('F12 the journey states NEVER-AUTO-DECIDE-A-GATE at the consent-gate section — surface live, operator decides', () => {
  // MUTATION: deleting the never-auto-decide rule — or its named throwaway-dast DENY
  // failure example — → red
  const flat = journey.replace(/\s+/g, ' ')
  const has = (phrase, why) => assert.ok(flat.includes(phrase), `journey: ${why} — missing '${phrase}'`)
  has('NEVER AUTO-DECIDE A GATE', 'the rule is titled')
  has('EVERY consent gate is surfaced LIVE', 'gates are surfaced live for the operator')
  has('NEVER records an affirm or deny the operator did not just make on THIS run', 'no recorded decision the operator did not make')
  has('NEVER pre-decides a gate from a host/session memory, a standing instruction, or its own read of the source', 'the pre-decide sources are enumerated')
  has('a NOTE the driver RAISES inside the gate', 'a memory/standing constraint is a note inside the gate')
  has('and the OPERATOR decides', 'the operator owns the decision')
  has('a driver once recorded `throwaway-dast` as DENY on its own, from a stale memory', 'the concrete forbidden failure is named')
  has('surface the gate, mention the memory as context, let the operator choose', 'the prescribed behavior, verbatim')
})

check('F13 run-scans: the throwaway-dast gate is the operator\'s LIVE call — never auto-declined from a memory', () => {
  // MUTATION: deleting the run-scans pointer (or its degrade-only-on conditions) → red
  const flat = skill.replace(/\s+/g, ' ')
  const has = (phrase, why) => assert.ok(flat.includes(phrase), `run-scans: ${why} — missing '${phrase}'`)
  has('The `throwaway-dast` gate is the OPERATOR\'S LIVE CALL — never auto-decline it from a memory or a standing note', 'the pointer headline')
  has('SOURCE OF TRUTH & MEMORY-INDEPENDENCE and NEVER AUTO-DECIDE A GATE rules', 'points at the journey doctrine by name')
  has('it is context to RAISE inside the gate, never a decision', 'a stale memory is context, not a decision')
  has('only on the operator\'s own decline or a genuine engine refusal', 'the only two degrade triggers')
  has('never on a pre-decided deny the operator never made', 'the forbidden pre-decided deny, verbatim')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

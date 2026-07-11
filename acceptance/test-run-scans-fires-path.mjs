#!/usr/bin/env node
/**
 * Standing test for skills/run-scans/SKILL.md prose (0.8.109) — the DAST fires-path ladder,
 * the lockfile-less Python SCA rule + fail-loud-on-uncovered-manifest coverage rule, and the
 * ReDoS `.txt` auto-route. These are PROSE guards (the run-scans skill is Markdown a driver
 * reads, not an engine): they lock the load-bearing sentences so a future edit that silently
 * drops the ladder, the pip-audit fallback, the coverage rule, or the auto-ingest fails the
 * build — exactly the ci-hygiene skill-prose-guard pattern (test-ci-hygiene.mjs F8-compose-iac).
 *
 *   F1  Family 3 documents the 4-rung fires-path ladder (rung 1 --base-url already-running →
 *       rung 2 prebuilt *.prod.yml → rung 3 build SERIALIZED never-during → rung 4 honest-degrade)
 *   F2  rung 1 surfaces `--base-url` as the first-class "scan an already-running instance" option
 *   F3  rung 3 serialize rule: build BEFORE or AFTER the audit fan-out, never DURING
 *   F4  SCA Family carries `pip-audit` as a FIRST-CLASS installed scanner for lockfile-less Python
 *       (consented install set + evidence name + adapter + gate; PENDING-OWNER-RUN only absent consent)
 *   F5  fail-loud on any dependency manifest no scanner covered → coverage gap, never a silent pass
 *   F6  ReDoS `.txt` ingest AUTO-runs after the redos scan (regexploit explicit-scanner form)
 *   F7  rung 1 names its DISTINCT `live-instance-dast` consent gate + the detect-and-offer /
 *       never-auto-scan rule (a found loopback listener is a reason to ASK, not permission to scan)
 *
 * Dependency-free: `node acceptance/test-run-scans-fires-path.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const skill = readFileSync(join(PLUGIN, 'skills', 'run-scans', 'SKILL.md'), 'utf8')

let pass = 0, fail = 0
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`) } }

console.log('run-scans fires-path + lockfile-less-SCA + ReDoS-auto-route prose guard (0.8.109)')

check('F1 Family 3 documents the 4-rung fires-path ladder (DAST must FIRE regardless of app size)', () => {
  // MUTATION: dropping the ladder section from Family 3 → these fail (red)
  assert.match(skill, /FIRES-PATH LADDER/, 'the ladder must be named in Family 3')
  assert.match(skill, /DAST must FIRE regardless of app size/, 'the headline invariant must be stated')
  // rung 1: already-running loopback instance
  assert.match(skill, /Already-running loopback instance/i, 'rung 1: already-running loopback instance')
  // rung 2: prebuilt-image compose
  assert.match(skill, /Prebuilt-image compose/i, 'rung 2: prebuilt-image compose')
  assert.match(skill, /buildsFromSource:false/, 'rung 2 references the stack-detect prebuilt signal')
  // rung 3: build from source, SERIALIZED
  assert.match(skill, /Build from source[^\n]*SERIALIZED/i, 'rung 3: build from source, serialized')
  // rung 4: honest-degrade as the LAST resort
  assert.match(skill, /Honest-degrade/i, 'rung 4: honest-degrade')
  assert.match(skill, /fire\s+first, degrade last/i, 'the ladder posture: fire first, degrade last')
})

check('F2 rung 1 surfaces --base-url as the first-class "scan an already-running instance" option', () => {
  // MUTATION: removing the --base-url first-rung surfacing → red
  assert.match(skill, /--base-url\s+http:\/\/127\.0\.0\.1/, 'rung 1 shows the explicit --base-url loopback invocation')
  assert.match(skill, /Explicit `--base-url` ALWAYS wins/, 'the engine primitive (explicit wins) must be surfaced')
  assert.match(skill, /ZERO build, ZERO stand-up/i, 'rung 1 is the no-build, no-standup path')
})

check('F3 rung 3 serialize rule: build BEFORE or AFTER the audit fan-out, never DURING', () => {
  // MUTATION: dropping the never-during serialization rule → red
  assert.match(skill, /BEFORE or AFTER the audit fan-out, never DURING/i,
    'the rung-3 serialization rule (build before/after the fan-out, never during) must be present')
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

check('F7 rung 1 names the DISTINCT live-instance-dast gate + the detect-and-offer / never-auto-scan rule', () => {
  // MUTATION: dropping the distinct-gate naming or the detect-and-offer safety rule → red
  // the explicit already-running path is gated by live-instance-dast, NOT throwaway-dast
  assert.match(skill, /live-instance-dast/, 'rung 1 must name the distinct live-instance-dast consent gate')
  assert.match(skill, /`live-instance-dast`, NOT `throwaway-dast`/,
    'rung 1 must state the gate is live-instance-dast, NOT throwaway-dast')
  // detect-and-offer, never auto-chain probe → scan
  assert.match(skill, /Detect-and-offer, never auto-scan/i, 'the detect-and-offer rule must be titled')
  assert.match(skill, /never auto-chain probe\s*→\s*scan/i, 'the never-auto-chain rule must be present')
  assert.match(skill, /reason to\s+ASK, not permission to scan/i,
    'a found loopback listener is a reason to ASK, not permission to scan')
  // WHY: an arbitrary loopback port may be an unrelated service; the responder is not verified
  assert.match(skill, /UNRELATED\s+service/i, 'the rule must state an arbitrary loopback port may be an unrelated service')
  assert.match(skill, /does NOT verify the responder is the app you intend to scan/i,
    'run-dast re-asserts loopback but does NOT verify the responder identity')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

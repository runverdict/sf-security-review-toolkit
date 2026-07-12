#!/usr/bin/env node
/**
 * Standing test for the auto-mode legibility changeset — Claude Code AUTO MODE
 * runs a safety classifier that FAILS CLOSED on compound/opaque shell it
 * "could not evaluate" (`cd X && … && …` chains, `for` loops, inline
 * `node -e`, `python3 - <<PY` heredocs). A live cold run had six
 * record-consent calls batched into ONE `&&`-chain DENIED, while the SAME six
 * recorded one-per-Bash-call all passed. The guidance is LLM prose (there is
 * no driver engine to mock), so — like test-prompt-diet.mjs — this locks the
 * flow with directive-presence assertions over the SKILL files, plus a
 * FUNCTIONAL gate-spec assertion on the mcp-probe consent text.
 *
 * AL1  journey: the ATOMIC-INVOCATION mandate sits INSIDE the consent-gates
 *      block (one gate = one Bash call; never `&&`-chained / looped / heredoc;
 *      the classifier fail-closed rationale is stated).
 * AL2  journey: the four preflight detectors are prescribed as SEPARATE atomic
 *      Bash calls — "the same pass" never means one compound command.
 * AL3  journey + scope-submission: the AUTO-MODE LEGIBILITY convention —
 *      prefer the dedicated Read / Grep / Glob tools over compound/inline
 *      shell — is stated in both skills.
 * AL4  no SKILL ships a batched counter-example: no `&&`-chained
 *      record-consent pair, no `for`-looped record-consent, anywhere in
 *      any skill's SKILL.md.
 * AL5  mcp-probe consent currency (FUNCTIONAL, via gateOptions): the rendered
 *      option text no longer claims a recorded URL "becomes a production DAST
 *      scan" — post-mirror-safety, run-dast refuses any explicit/non-loopback
 *      target (exit 3) and only ever scans the disposable loopback mirror.
 *      Both affirm options state the loopback-mirror truth + the provenance
 *      point; the gate's structure (2 affirm + force-injected decline) and the
 *      SG2-pinned phrases are unchanged.
 * AL6  scope-submission step 3 carries the same honest wording (loopback
 *      mirror, run-dast refusal, label-as-provenance) and the stale
 *      "production DAST scan" threat is gone from the skill.
 *
 * Dependency-free: `node acceptance/test-automode-legibility.mjs`.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gateOptions, GATE_CATALOG } from '../harness/gate-spec.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const read = (...p) => readFileSync(join(PLUGIN, ...p), 'utf8')

let pass = 0, fail = 0
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) } }

const journey = read('skills', 'security-review-journey', 'SKILL.md')
const scope = read('skills', 'scope-submission', 'SKILL.md')

console.log('auto-mode legibility standing test')

check('AL1 journey: the ATOMIC-INVOCATION mandate sits inside the consent-gates block', () => {
  const start = journey.indexOf('CONSENT GATES — MANDATORY')
  const end = journey.indexOf('### AUTONOMOUS RUN')
  assert.ok(start >= 0 && end > start, 'the consent-gates block and the AUTONOMOUS RUN section both exist, in order')
  const block = journey.slice(start, end)
  assert.match(block, /ATOMIC INVOCATIONS — one gate = one Bash call/, 'the mandate heads the recording flow')
  assert.match(block, /its OWN separate Bash tool call/i, 'each record-consent call is its own separate Bash call')
  assert.match(block, /NEVER chain two recordings with `&&`/, 'the &&-chain ban is explicit')
  assert.match(block, /`cd <dir> && T=… && call1 && call2`/, 'the observed denied compound form is named')
  assert.match(block, /`for`-loop or heredoc/, 'the for-loop / heredoc forms are banned too')
  assert.match(block, /FAILS\s+CLOSED on compound\/opaque commands it "could not evaluate"/, 'the classifier fail-closed rationale is stated')
  assert.match(block, /one `node …\/record-consent\.mjs` per Bash call/, 'the atomic recording rule is imperative')
  // the work-order presence floor
  assert.match(block, /separate Bash|atomic|never chain|do NOT batch/i, 'the mandate vocabulary is present near the consent flow')
})

check('AL2 journey: the preflight detectors are prescribed as SEPARATE atomic calls', () => {
  assert.match(journey, /four detectors as FOUR separate atomic Bash calls/i, 'the detector pass is atomic-per-detector')
  assert.match(journey, /never one `&&`-chained compound\s+command/, '"the same pass" is explicitly NOT one compound command')
})

check('AL3 journey + scope-submission: the AUTO-MODE LEGIBILITY convention (dedicated tools over compound shell)', () => {
  for (const [name, skill] of [['journey', journey], ['scope-submission', scope]]) {
    assert.match(skill, /AUTO-MODE LEGIBILITY/, `${name}: the convention is named`)
    assert.match(skill, /PREFER\s+the\s+dedicated Read \/ Grep \/ Glob tools over compound shell/i, `${name}: prefers the dedicated tools`)
    assert.match(skill, /node -e/, `${name}: names inline node -e as a blocked form`)
    assert.match(skill, /heredoc/i, `${name}: names heredocs as a blocked form`)
    assert.match(skill, /could not evaluate/, `${name}: states the classifier's fail-closed reason verbatim`)
    assert.match(skill, /FAILS? CLOSED/i, `${name}: states the fail-closed behavior`)
  }
})

check('AL4 no SKILL ships a batched record-consent counter-example (no &&-chained pair, no for-loop)', () => {
  const skillsDir = join(PLUGIN, 'skills')
  for (const d of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue
    const s = read('skills', d.name, 'SKILL.md')
    assert.doesNotMatch(s, /record-consent\.mjs[^\n]*&&[^\n]*record-consent\.mjs/, `${d.name}: two record-consent calls &&-chained on one line`)
    assert.doesNotMatch(s, /for\s+\w+\s+in[^\n]*record-consent/, `${d.name}: a for-looped record-consent batch`)
  }
})

check('AL5 mcp-probe consent currency (functional): loopback-mirror truth in, "production DAST scan" threat out', () => {
  const p = gateOptions('mcp-probe', { url: 'https://example.test/mcp' })
  const staging = p.options[0]
  const production = p.options[1]
  // structure preserved: 2 affirm probe options + the force-injected decline
  assert.deepEqual(p.options.map((o) => [o.label, o.decision]), [
    ['Probe — this is a STAGING endpoint', 'affirm'],
    ['Probe — this is a PRODUCTION endpoint', 'affirm'],
    ['Skip — do not probe', 'deny'],
  ], 'the option set is structurally unchanged')
  assert.equal(GATE_CATALOG['mcp-probe'].kind, 'consent', 'mcp-probe stays a consent gate')
  // the stale post-mirror-safety threat is GONE from the rendered text
  const rendered = JSON.stringify(p)
  assert.doesNotMatch(rendered, /production DAST/i, 'no option claims a production DAST scan')
  assert.doesNotMatch(rendered, /becomes? the\s+DAST target list/i, 'no option claims the endpoints become a DAST target list')
  // ...and the loopback-mirror truth is IN, on both affirm options
  for (const [env, o] of [['staging', staging], ['production', production]]) {
    assert.match(o.description, /disposable loopback mirror/, `${env}: the DAST target is the disposable loopback mirror`)
    assert.match(o.description, /run-dast refuses any explicit or non-loopback target/, `${env}: the run-dast refusal is stated`)
    assert.match(o.description, /provenance/, `${env}: the label-as-provenance point is kept`)
  }
  assert.match(staging.description, /never on this host/, 'staging: the DAST never targets the probed host')
  assert.match(production.description, /never DAST-scanned/, 'production: the endpoint is never DAST-scanned')
  // the SG2-pinned honesty phrase survives the rewording
  assert.match(production.description, /Production is probed ONLY with this explicit confirmation, never silently/, 'the never-silently phrase is preserved verbatim')
})

check('AL6 scope-submission step 3 states the loopback-mirror truth; the stale claim is gone from the skill', () => {
  assert.doesNotMatch(scope, /production DAST/i, 'the "production DAST scan three phases later" threat is gone')
  assert.doesNotMatch(scope, /become the DAST target list in/, 'step 3 no longer frames the recorded endpoints as a downstream target list')
  assert.match(scope, /paths the DAST in\s+`\/sf-security-review-toolkit:run-scans` exercises on the disposable loopback\s+mirror/, 'step 3 states what the endpoints actually feed')
  assert.match(scope, /`run-dast\.mjs` refuses\s+any explicit or non-loopback target outright, exit 3/, 'step 3 cites the engine refusal')
  assert.match(scope, /environment label\s+is evidence provenance/i, 'the label-matters-for-provenance point is kept')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

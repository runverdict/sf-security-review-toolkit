#!/usr/bin/env node
/**
 * Standing test: the S0 bootstrap-cli-auth agent-plugin pin.
 *
 * The `bootstrap-cli-auth` runbook installs `@salesforce/plugin-agent` at a pinned
 * version so a cold box gets the `agent mcp` topic the deployed-org deep audit's
 * S3/S4 MCP steps depend on. The pin is single-sourced as `AGENT_PLUGIN_PIN` in
 * harness/install-scanners.mjs; the runbook prose writes the literal out. These
 * hermetic checks lock the two together (a bump of one that forgets the other fails
 * the build), enforce the semver floor (`agent mcp` first shipped in 1.43.0 — nobody
 * may pin back below it), and prove the enabler never leaked into the frozen hermetic
 * CA-stack SAST plan (which is CRUD/FLS-only and must stay agent-free).
 *
 * Network-free / org-free: asserts over source + the exported constant + the runbook
 * text. `sf` is never spawned. Dependency-free: `node acceptance/test-agent-plugin-pin.mjs`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  AGENT_PLUGIN_PIN, AGENT_PLUGIN_MCP_FLOOR, planInstalls, installCommands,
} from '../harness/install-scanners.mjs'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const SKILL = read('../skills/bootstrap-cli-auth/SKILL.md')
const INSTALL_SRC = read('../harness/install-scanners.mjs')

let pass = 0, fail = 0
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`) }
}

// Tiny inline semver compare (no dependency): split on '.', strip any pre-release
// tag off the patch, numeric-compare major→minor→patch. Returns -1/0/1.
const parseSemver = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v))
  assert.ok(m, `not a semver: '${v}'`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}
const cmpSemver = (a, b) => {
  const [aa, ab] = [parseSemver(a), parseSemver(b)]
  for (let i = 0; i < 3; i++) { if (aa[i] !== ab[i]) return aa[i] < ab[i] ? -1 : 1 }
  return 0
}

console.log(`agent-plugin-pin standing test (pin=${AGENT_PLUGIN_PIN}, mcp-floor=${AGENT_PLUGIN_MCP_FLOOR})`)

// 1 — Runbook↔constant equality lock (mirrors the item-7 PINNED_TOOL_VERSIONS==BINARY_PINS
// acceptance lock): the SKILL.md install command literal MUST byte-match AGENT_PLUGIN_PIN.
// A future bump of the constant that forgets the runbook (or vice-versa) fails the build.
check('1 runbook↔constant equality: SKILL.md pins the exact AGENT_PLUGIN_PIN', () => {
  const wanted = `sf plugins install @salesforce/plugin-agent@${AGENT_PLUGIN_PIN}`
  assert.ok(
    SKILL.includes(wanted),
    `bootstrap-cli-auth/SKILL.md must contain the exact install command "${wanted}" — ` +
    'the runbook literal drifted from the single-source AGENT_PLUGIN_PIN constant',
  )
})

// 2 — Semver floor + upper bound. The floor exists because `agent mcp` (the `agent:mcp:*`
// commands the S3/S4 deep-audit steps consume) first shipped in plugin-agent 1.43.0; the
// CLI-bundled 1.42.1 lacks the topic entirely, so nobody may pin back to a 1.42.x. The
// `< 2.0.0` bound keeps the pin on the validated 1.x line.
check('2 semver floor + upper bound: AGENT_PLUGIN_MCP_FLOOR ≤ pin < 2.0.0', () => {
  // both parse as semver
  parseSemver(AGENT_PLUGIN_PIN)
  parseSemver(AGENT_PLUGIN_MCP_FLOOR)
  assert.equal(AGENT_PLUGIN_MCP_FLOOR, '1.43.0', 'the floor is the version that first shipped `agent mcp`')
  assert.ok(cmpSemver(AGENT_PLUGIN_PIN, AGENT_PLUGIN_MCP_FLOOR) >= 0,
    `pin ${AGENT_PLUGIN_PIN} must be >= the mcp floor ${AGENT_PLUGIN_MCP_FLOOR} (below it loses the topic)`)
  assert.ok(cmpSemver(AGENT_PLUGIN_PIN, '2.0.0') < 0,
    `pin ${AGENT_PLUGIN_PIN} must be < 2.0.0 (stay on the validated 1.x line)`)
})

// 3 — Hermetic-stack purity guard: the enabler must NOT have leaked into the frozen
// CA-stack SAST plan. The hermetic CA stack (code-analyzer-stack) is CRUD/FLS-only and
// never runs `agent mcp`; its installCommands must reference only its own pinned
// cli/plugin and never plugin-agent or the agent pin literal.
check('3 hermetic-stack purity: code-analyzer-stack installCommands never mention plugin-agent / the pin', () => {
  const CA_MISSING = [{ name: 'sf', family: 'code-analyzer', install: 'code-analyzer-stack' }]
  const boxed = join(tmpdir(), 'sf-srt-scanners', 'agent-pin-purity')
  const plan = planInstalls(CA_MISSING, { runId: 'agent-pin', tmpRoot: boxed, platform: 'linux', arch: 'x64' })
  const ca = plan.installs.find((i) => i.method === 'code-analyzer-stack')
  assert.ok(ca, 'the CA stack is planned when sf is absent')
  const cmds = installCommands(ca)
  assert.ok(cmds.length > 0, 'the CA stack emits install commands')
  for (const c of cmds) {
    assert.ok(!/plugin-agent/.test(c), `CA-stack command leaked plugin-agent: ${c}`)
    assert.ok(!c.includes(AGENT_PLUGIN_PIN), `CA-stack command leaked the agent pin ${AGENT_PLUGIN_PIN}: ${c}`)
  }
  // Source belt: the code-analyzer-stack installCommands branch references only
  // inst.plugin.name/inst.plugin.version, never AGENT_PLUGIN_PIN.
  const branch = INSTALL_SRC.slice(
    INSTALL_SRC.indexOf("case 'code-analyzer-stack':"),
    INSTALL_SRC.indexOf('default:', INSTALL_SRC.indexOf("case 'code-analyzer-stack':")),
  )
  assert.ok(branch.length > 0, 'located the code-analyzer-stack installCommands branch in source')
  assert.ok(!branch.includes('AGENT_PLUGIN_PIN'), 'the CA-stack installCommands branch must never reference AGENT_PLUGIN_PIN')
  assert.ok(!/plugin-agent/.test(branch), 'the CA-stack installCommands branch must never reference plugin-agent')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

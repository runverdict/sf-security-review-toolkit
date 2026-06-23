#!/usr/bin/env node
/**
 * Standing test for the PreToolUse sf-ops safety gate (hooks/sf-ops-gate-hook.mjs).
 * Guards the fail-closed model: an irreversible sf/host op inside a managed audit
 * repo is DENIED unless an affirmative consent for its gate is recorded; read-only
 * verbs and out-of-scope Bash always pass; the PERMANENT promote has its own gate.
 *
 * Dependency-free, no live sf: `node acceptance/test-sf-ops-gate-hook.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { decide, classify } from '../hooks/sf-ops-gate-hook.mjs'
import { recordConsent } from '../harness/record-consent.mjs'

const HOOK = fileURLToPath(new URL('../hooks/sf-ops-gate-hook.mjs', import.meta.url))

let pass = 0, fail = 0
const dirs = []
const check = (n, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${n}`) }
  catch (e) { fail++; console.log(`  ✗ ${n}\n    ${String(e.message).split('\n').join('\n    ')}`) }
}

// A managed repo (has .security-review/); optionally pre-record consents.
function managed(consents = []) {
  const root = mkdtempSync(join(tmpdir(), 'srt-ops-')); dirs.push(root)
  mkdirSync(join(root, '.security-review'), { recursive: true })
  for (const g of consents) recordConsent(g, 'yes, go ahead', { target: root })
  return root
}
// A non-managed dir (no .security-review/ up-tree, by construction under tmp).
function unmanaged() {
  const root = mkdtempSync(join(tmpdir(), 'srt-plain-')); dirs.push(root)
  return root
}
const cmd = (command) => ({ tool_name: 'Bash', tool_input: { command } })
const act = (command, root) => decide(cmd(command), { cwd: root }).action

console.log('sf-ops-gate-hook standing test')

// --- classification → the right gate ---------------------------------------
check('classify maps each op to its gate (verb-based, not substring)', () => {
  assert.equal(classify('sf package version promote -p 04t'), 'sf-package-promote')
  assert.equal(classify('sf package install -p 04t'), 'sf-deep-audit-ops')
  assert.equal(classify('sf org login web -a o'), 'sf-cli-setup')
  assert.equal(classify('npm install -g @salesforce/cli'), 'sf-cli-setup')
  assert.equal(classify('sf package version list'), null)
})

// --- gate class: DENY without consent, ALLOW with it -----------------------
for (const [label, command, gate] of [
  ['promote', 'sf package version promote -p 04t -v hub', 'sf-package-promote'],
  ['deep-audit (install)', 'sf package install -p 04t -o scratch', 'sf-deep-audit-ops'],
  ['cli-setup (login)', 'sf org login web -a myorg', 'sf-cli-setup'],
]) {
  check(`${label}: DENY in a managed repo with NO consent`, () => {
    const root = managed()
    const d = decide(cmd(command), { cwd: root })
    assert.equal(d.action, 'deny')
    assert.match(d.reason, new RegExp(gate))
    assert.match(d.reason, /fail-closed/i)
  })
  check(`${label}: ALLOW once the matching consent (${gate}) is recorded`, () => {
    const root = managed([gate])
    assert.equal(act(command, root), 'allow')
  })
}

// --- the PROMOTE gate is SEPARATE from deep-audit-ops -----------------------
check('promote needs its OWN gate: a recorded sf-deep-audit-ops does NOT authorize promote', () => {
  const root = managed(['sf-deep-audit-ops'])
  assert.equal(act('sf package version promote -p 04t', root), 'deny')
})
check('and vice-versa: a recorded sf-package-promote does NOT authorize a deep-audit op', () => {
  const root = managed(['sf-package-promote'])
  assert.equal(act('sf package install -p 04t', root), 'deny')
})
check('the promote deny reason emphasizes irreversible PERMANENCE', () => {
  const root = managed()
  const d = decide(cmd('sf package version promote -p 04t'), { cwd: root })
  assert.equal(d.action, 'deny')
  assert.match(d.reason, /never be deleted, un-promoted, or hidden/i)
  assert.match(d.reason, /irreversible|permanent/i)
})

// --- read-only / benign → ALLOW (even inside a managed repo, no consent) ----
check('read-only + benign commands pass through', () => {
  const root = managed()
  for (const c of [
    'sf org list',
    'sf package version list',
    'sf config get target-org',
    'sf package version promote --help',
    'sf org display --json',
    'git push origin main',
    'ls -la',
    'npm install lodash', // LOCAL install is not gated
  ]) assert.equal(act(c, root), 'allow', `expected allow for: ${c}`)
})

// --- variant normalization (the adversarial surface) → still DENIED ---------
check('colon form is normalized and gated', () => {
  assert.equal(act('sf package:version:promote --package 04t', managed()), 'deny')
})
check('sfdx force: legacy form is normalized and gated', () => {
  assert.equal(act('sfdx force:package:version:promote -p 04t', managed()), 'deny')
  assert.equal(act('sfdx force:source:push', managed()), 'deny')
  assert.equal(act('sfdx force:auth:web:login', managed()), 'deny')
})
check('leading env-var + sudo wrapper is stripped, still gated', () => {
  assert.equal(act('FOO=bar sudo sf package version promote -p 04t', managed()), 'deny')
})
check('extra whitespace is collapsed, still gated', () => {
  assert.equal(act('sf    package   version    promote   -p 04t', managed()), 'deny')
})
check('a CHAINED command is DENIED on the promote segment', () => {
  const root = managed()
  const d = decide(cmd('sf org list && sf package version promote -p 04t'), { cwd: root })
  assert.equal(d.action, 'deny')
  assert.match(d.reason, /sf-package-promote/)
})
check('a chain gated by the highest-severity segment (deep-audit + promote → promote)', () => {
  assert.equal(classify('sf package install -p 04t ; sf package version promote -p 04t'), 'sf-package-promote')
})

// --- scope + fail-closed ---------------------------------------------------
check('outside a managed repo (no .security-review up-tree) → ALLOW even for a gated op', () => {
  assert.equal(act('sf package version promote -p 04t', unmanaged()), 'allow')
})
check('malformed / empty payload → ALLOW (never blocks arbitrary Bash)', () => {
  const root = managed()
  assert.equal(decide({}, { cwd: root }).action, 'allow')
  assert.equal(decide({ tool_input: {} }, { cwd: root }).action, 'allow')
  assert.equal(decide({ tool_input: { command: 42 } }, { cwd: root }).action, 'allow')
  assert.equal(decide(null, { cwd: root }).action, 'allow')
})
check('a classified op in a managed repo with NO consent → DENY (the core invariant)', () => {
  assert.equal(act('sf package uninstall -p 04t', managed()), 'deny')
})

// --- the real CLI path (stdin payload → deny JSON / allow no-stdout) --------
check('CLI: gated op without consent emits a permissionDecision=deny JSON', () => {
  const root = managed()
  const out = execFileSync('node', [HOOK], {
    cwd: root, encoding: 'utf8',
    input: JSON.stringify(cmd('sf package version promote -p 04t')),
  })
  const j = JSON.parse(out)
  assert.equal(j.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(j.hookSpecificOutput.permissionDecisionReason, /never be deleted/i)
})
check('CLI: with consent recorded, allow = exit 0 and NO stdout', () => {
  const root = managed(['sf-package-promote'])
  const out = execFileSync('node', [HOOK], {
    cwd: root, encoding: 'utf8',
    input: JSON.stringify(cmd('sf package version promote -p 04t')),
  })
  assert.equal(out, '', 'allow emits no stdout')
})

// --- 0.8.12 adversarial bypass battery (each must DENY in a managed repo, no consent) ---
// Every entry is a normalization/wrapping form an HONEST driver could emit for the same
// irreversible op; the classifier must see through it. Regression-locks the auditor's list.
const BYPASS_DENY = [
  '/usr/local/bin/sf package version promote -p 04t', // CLI path
  './sf package install -p 04t',
  '~/bin/sf package version promote -p 04t',
  '/usr/local/bin/npm install -g pkg',
  'echo x & sf package version promote -p 04t', // background separator
  'echo x |& sf package version promote -p 04t',
  '(sf package version promote -p 04t)', // grouping
  '((sf package version promote -p 04t))',
  '{ sf package version promote -p 04t; }',
  'command sf package version promote -p 04t', // wrappers
  'exec sf package version promote -p 04t',
  'time sf package version promote -p 04t',
  'nice sf package version promote -p 04t',
  'nohup sf package version promote -p 04t',
  'watch sf package version promote -p 04t',
  'sudo -u nobody sf package version promote -p 04t', // flag-with-value wrapper
  'env -i sf package version promote -p 04t', // boolean-flag wrapper
  'bash -c "sf package version promote -p 04t"', // shell -c
  "sh -c 'sf package version promote -p 04t'",
  'zsh -c "sf package version promote -p 04t"',
  'eval "sf package version promote -p 04t"', // eval
  '"sf" package version promote -p 04t', // quoted / escaped CLI
  '\\sf package version promote -p 04t',
  'sf --json package version promote -p 04t', // interspersed flags in the verb scan
  'sf -o foo package install -p 04t',
  'sf --org=foo package version promote -p 04t',
  'sf -- package version promote -p 04t',
  '--json sf package version promote -p 04t', // flag before the CLI
  'sf package delete -p 04t', // newly-gated ops
  'sf package version delete -p 04t',
  'sf sandbox create -f def.json',
  'sf sandbox delete -o sbx',
  'npm uninstall -g pkg',
  'npm un -g pkg',
  'npm rm -g pkg',
  'bash -c "sf package install && sf package version promote -p 04t"', // separator INSIDE shell -c
  'echo hi && bash -c "sf package version promote -p 04t"', // chained shell -c
]
check('0.8.12 battery: every wrapped/normalized bypass DENIES (managed repo, no consent)', () => {
  const root = managed()
  for (const c of BYPASS_DENY) assert.equal(act(c, root), 'deny', `should DENY: ${c}`)
})

// Benign commands must NOT be false-denied (the partner's normal Bash keeps working).
const BENIGN_ALLOW = [
  'sf org list',
  'sf package version list',
  'sf config get target-org',
  'sf package version promote --help',
  'git push origin main',
  'npm install lodash', // LOCAL install
  'cat sf-notes.txt', // a path that merely contains "sf"
  'ls && echo done',
]
check('0.8.12 battery: benign commands still ALLOW (no false-denies)', () => {
  const root = managed()
  for (const c of BENIGN_ALLOW) assert.equal(act(c, root), 'allow', `should ALLOW: ${c}`)
})

// The EXOTIC residual — runtime/shell-eval forms the classifier honestly cannot resolve
// (command substitution, variable indirection, process-substitution source, base64-eval).
// These stay ALLOW BY DESIGN; the honest claim is "documented forms gated," not "unbypassable".
const EXOTIC_RESIDUAL_ALLOW = [
  '$(echo sf) package version promote -p 04t',
  '`echo sf` package version promote -p 04t',
  '$CMD package version promote -p 04t',
  '${CMD} package version promote -p 04t',
  'source <(echo sf package version promote -p 04t)',
  'echo c2YgcGFja2FnZSB2ZXJzaW9uIHByb21vdGU= | base64 -d | bash',
]
check('0.8.12 residual: EXOTIC runtime/eval forms stay ALLOW (documented, not closed)', () => {
  const root = managed()
  for (const c of EXOTIC_RESIDUAL_ALLOW) assert.equal(act(c, root), 'allow', `residual stays ALLOW: ${c}`)
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

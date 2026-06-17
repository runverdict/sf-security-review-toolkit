#!/usr/bin/env node
/**
 * Standing test for the PreToolUse AuthN/AuthZ enforcement hook
 * (hooks/authz-gate-hook.mjs). Guards G4: the hook must be a NO-OP except when a
 * write targets the toolkit's OWN authn-authz-flow.md artifact AND the operator
 * has armed it (`.security-review/hook-armed`) AND the gate withholds — and it
 * must fail CLOSED (deny) if it can't verify a clean ledger once armed.
 *
 * Dependency-free: `node acceptance/test-authz-gate-hook.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { decide } from '../hooks/authz-gate-hook.mjs'

let pass = 0, fail = 0
const check = (n, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${n}`) }
  catch (e) { fail++; console.log(`  ✗ ${n}\n    ${String(e.message).split('\n').join('\n    ')}`) }
}

// Build a temp repo with .security-review state; return root + the gated artifact path.
function setup({ armed, ledger }) {
  const root = mkdtempSync(join(tmpdir(), 'srt-hook-'))
  mkdirSync(join(root, '.security-review'), { recursive: true })
  mkdirSync(join(root, 'docs', 'security-review'), { recursive: true })
  if (ledger !== undefined) writeFileSync(join(root, '.security-review', 'audit-ledger.json'), JSON.stringify(ledger))
  if (armed) writeFileSync(join(root, '.security-review', 'hook-armed'), 'armed\n')
  return { root, artifact: join(root, 'docs', 'security-review', 'authn-authz-flow.md') }
}
const cleanup = (root) => rmSync(root, { recursive: true, force: true })
const payload = (file_path, tool = 'Write') => ({ tool_name: tool, tool_input: { file_path } })

const OPEN_AUTHZ = { findings: [{ id: 'nc', dimension: 'oauth-identity', status: 'confirmed', adjusted_severity: 'critical' }] }
const CLEAN = { findings: [{ id: 'x', dimension: 'oauth-identity', status: 'fixed', adjusted_severity: 'none' }] }

console.log('authz-gate-hook standing test')

check('unrelated write → allow (no-op; never our artifact)', () => {
  const { root } = setup({ armed: true, ledger: OPEN_AUTHZ })
  assert.equal(decide(payload(join(root, 'force-app', 'classes', 'Svc.cls'))).action, 'allow')
  cleanup(root)
})

check('our artifact but NOT armed → allow (not opted in → prose enforcement)', () => {
  const { root, artifact } = setup({ armed: false, ledger: OPEN_AUTHZ })
  assert.equal(decide(payload(artifact)).action, 'allow')
  cleanup(root)
})

check('ARMED + our artifact + open authZ critical → DENY', () => {
  const { root, artifact } = setup({ armed: true, ledger: OPEN_AUTHZ })
  const d = decide(payload(artifact))
  assert.equal(d.action, 'deny')
  assert.match(d.reason, /withheld/i)
  cleanup(root)
})

check('ARMED + our artifact + clean ledger → allow', () => {
  const { root, artifact } = setup({ armed: true, ledger: CLEAN })
  assert.equal(decide(payload(artifact)).action, 'allow')
  cleanup(root)
})

check('ARMED + our artifact + ledger UNREADABLE → DENY (fail-closed)', () => {
  const { root, artifact } = setup({ armed: true, ledger: undefined }) // no ledger written
  assert.equal(decide(payload(artifact)).action, 'deny')
  cleanup(root)
})

check('the .WITHHELD.md placeholder is NOT the gated artifact → allow', () => {
  const { root } = setup({ armed: true, ledger: OPEN_AUTHZ })
  assert.equal(decide(payload(join(root, 'docs', 'security-review', 'authn-authz-flow.WITHHELD.md'))).action, 'allow')
  cleanup(root)
})

check('Edit (not just Write) to our artifact, armed, open authZ → DENY', () => {
  const { root, artifact } = setup({ armed: true, ledger: OPEN_AUTHZ })
  assert.equal(decide(payload(artifact, 'Edit')).action, 'deny')
  cleanup(root)
})

check('no file_path in the payload → allow (cannot scope)', () => {
  assert.equal(decide({ tool_name: 'Write', tool_input: {} }).action, 'allow')
  assert.equal(decide({}).action, 'allow')
})

check('our-artifact name but no .security-review up-tree → allow (not a managed repo)', () => {
  const d = decide(payload(`/tmp/srt-no-state-${process.pid}-xyz/docs/security-review/authn-authz-flow.md`))
  assert.equal(d.action, 'allow')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

#!/usr/bin/env node
/*
 * scaffold-env.mjs — the credential scaffold-and-guide loop (0.7.0 slice 6). When a
 * throwaway stack is `needs-secrets` (it needs external-service creds the toolkit can't
 * synthesize — a real DATABASE_URL, a third-party API key), this writes an env STUB the
 * operator fills, then deterministically re-checks when they confirm, so the autonomous
 * loop can resume. See docs/roadmap-0.7.0-throwaway-dast-harness.md.
 *
 * THE CREDENTIAL CONTRACT (CONVENTIONS §6 — load-bearing):
 *   • The stub lists the required env-var NAMES only — never guessed values.
 *   • The stub lives in the throwaway's TMP dir (`/tmp/sf-srt-stack/<run>/throwaway.env`),
 *     NEVER in the partner's repo and NEVER under `.security-review/` — so filled SECRET
 *     VALUES never land in committable/state files. The values reach only the throwaway's
 *     container env at stand-up, and the tmp dir (values and all) is destroyed at teardown.
 *   • The re-check is deterministic: a key counts FILLED only with a non-empty, non-
 *     placeholder value; `ready` iff every required key is filled. The loop resumes on
 *     `ready`, never on a hopeful guess.
 *
 * Pure `planEnvScaffold` + `envStatus`; the CLI writes the stub / re-checks it.
 *
 * USAGE:
 *   node scaffold-env.mjs --target <repo> --run-id <id> [--json]          # write the stub
 *   node scaffold-env.mjs --target <repo> --run-id <id> --check [--json]  # re-check it
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assertSafeTmpRoot } from './install-scanners.mjs'

const RUN_ID_OK = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const PLACEHOLDER = /^(|<.*>|CHANGEME|CHANGE_ME|TODO|FIXME|xxx+|\.\.\.|your[-_].*|REPLACE.*)$/i

/** PURE. Compute the env-stub plan. Deterministic given (externalNames, runId, tmpRoot). */
export function planEnvScaffold(externalNames, { runId, tmpRoot } = {}) {
  if (!RUN_ID_OK.test(String(runId || ''))) throw new Error(`planEnvScaffold: invalid run-id '${runId}'`)
  assertSafeTmpRoot(tmpRoot)
  const keys = [...new Set((Array.isArray(externalNames) ? externalNames : []).filter(Boolean))].sort()
  return { schema: 'sf-srt-env/1', runId, keys, stubPath: join(tmpRoot, 'throwaway.env'), tmpRoot }
}

/** PURE. Parse env content → which required keys are filled vs missing, and readiness. */
export function envStatus(content, requiredKeys = []) {
  const vals = {}
  for (const line of String(content || '').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m) vals[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  const req = [...new Set(requiredKeys)]
  const filled = req.filter((k) => k in vals && vals[k] !== '' && !PLACEHOLDER.test(vals[k]))
  const missing = req.filter((k) => !filled.includes(k))
  return { filled: filled.sort(), missing: missing.sort(), ready: missing.length === 0 }
}

/** Write the stub the operator fills (tmp dir only — never the repo). */
export function writeEnvStub(plan) {
  mkdirSync(plan.tmpRoot, { recursive: true, mode: 0o700 })
  const header = [
    '# Throwaway DAST stack — external-service credentials',
    '# Fill each value below, then confirm. These reach ONLY the disposable',
    '# throwaway container and are DESTROYED with it at teardown. Do NOT commit',
    `# this file (it lives in ${plan.tmpRoot}, outside your repo). Leave none blank.`,
    '',
  ].join('\n')
  const body = plan.keys.map((k) => `${k}=`).join('\n') + '\n'
  writeFileSync(plan.stubPath, header + body, { mode: 0o600 })
  return plan.stubPath
}

function main() {
  const argv = process.argv
  const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
  const target = arg('--target', process.cwd())
  const runId = arg('--run-id', null)
  const tmpRoot = arg('--tmp-root', runId ? join(tmpdir(), 'sf-srt-stack', runId) : null)
  const asJson = argv.includes('--json')
  if (!runId || !tmpRoot) { process.stdout.write('## scaffold-env — --run-id is required\n'); process.exitCode = 2; return }

  // external env names come from stack-detect (re-use its classification)
  const sd = fileURLToPath(new URL('./stack-detect.mjs', import.meta.url))
  let stack = {}
  try { stack = JSON.parse(execFileSync('node', [sd, '--target', target, '--json'], { encoding: 'utf8' })) } catch {}
  const externals = (stack.env && stack.env.external) || []
  const plan = planEnvScaffold(externals, { runId, tmpRoot })

  if (argv.includes('--check')) {
    const content = existsSync(plan.stubPath) ? readFileSync(plan.stubPath, 'utf8') : ''
    const st = envStatus(content, plan.keys)
    if (asJson) { process.stdout.write(JSON.stringify({ ...st, stubPath: plan.stubPath }, null, 2) + '\n'); process.exitCode = st.ready ? 0 : 3; return }
    process.stdout.write(st.ready
      ? `## scaffold-env — READY: all ${plan.keys.length} external creds filled → resume stand-up\n`
      : `## scaffold-env — WAITING: fill ${st.missing.join(', ')} in ${plan.stubPath}, then re-check\n`)
    process.exitCode = st.ready ? 0 : 3
    return
  }

  if (!plan.keys.length) { process.stdout.write((asJson ? JSON.stringify({ keys: [], note: 'no external creds needed' }, null, 2) : '## scaffold-env — no external creds needed (stand-up can proceed)') + '\n'); return }
  writeEnvStub(plan)
  if (asJson) { process.stdout.write(JSON.stringify({ stubPath: plan.stubPath, keys: plan.keys }, null, 2) + '\n'); return }
  process.stdout.write([
    `## scaffold-env — fill these ${plan.keys.length} external credential(s):`,
    ...plan.keys.map((k) => `  • ${k}`),
    `in: ${plan.stubPath}`,
    'They reach only the throwaway and are destroyed at teardown — never committed.',
    `Then: node harness/scaffold-env.mjs --target <repo> --run-id ${runId} --check`,
  ].join('\n') + '\n')
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) }
  catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

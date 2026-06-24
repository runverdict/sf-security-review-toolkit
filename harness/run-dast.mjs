#!/usr/bin/env node
/*
 * run-dast.mjs — the autonomous DAST against a throwaway (0.7.0 slice 5). Runs a
 * digest-pinned ZAP against the URL standup-stack published, writes real evidence to
 * the project, and cleans its own (root-owned) scan working files. The payoff that
 * chains stack-detect → standup-stack → run-dast → teardown-stack into real cold-run
 * DAST output. See docs/roadmap-0.7.0-throwaway-dast-harness.md.
 *
 * INTEGRITY: ZAP is pinned by IMAGE DIGEST (the strongest acquisition path — the
 * registry verifies it cryptographically, and the image bundles the JRE). Validated
 * in the 0.7.0 prototype.
 *
 * ROOT-OWNED FILES: ZAP runs as root in its container and writes the report to a
 * bind-mounted wrk dir as root. So the wrk dir lives in its OWN tmp tree (NOT the
 * stack's), the host-owned copy of the report is what lands in the project evidence
 * dir, and the root-owned wrk is removed via a throwaway root container — so neither
 * the project nor stack-teardown ever has to chase a root-owned file.
 *
 * It FAILS CLOSED without consent (an active scan is a live op). Pure `planDast` +
 * `summarizeZap` + an impure executor. Unauthenticated baseline scan this slice; the
 * authenticated, endpoint-fed AF-plan pass (using a token minted from the throwaway's
 * own synthesized secret) is the depth refinement (slice 5b).
 *
 * USAGE: node run-dast.mjs --base-url <url> --target <repo> --consent [--run-id <id>] [--json]
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { assertSafeTmpRoot } from './install-scanners.mjs'
import { dockerStatus } from './docker-check.mjs'
import { verifyConsent } from './record-consent.mjs'
import { clampLog } from './clamp-log.mjs'

// ZAP pinned by image digest (verified 2026-06-19, the 0.7.0 prototype). Bump = re-pin.
export const ZAP_IMAGE = 'zaproxy/zap-stable'
export const ZAP_DIGEST = 'sha256:7c2f8afc893e4e4000be8ad3fd22013fc36e5cce59359349f5a2d45626e2ccb9'
const RUN_ID_OK = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
// http(s):// + a non-empty authority/path with NO whitespace, control chars, or
// encoding-trick chars (`<>"'\`). The real boundary is the new URL() + LOOPBACK
// host-check below; this is a belt-and-suspenders pre-filter (WI-F.2).
const URL_OK = /^https?:\/\/[^\s\x00-\x1f<>"'\\]+$/i

/** Loopback-only hosts — an active DAST may ONLY ever hit a local throwaway. */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0'])

/** PURE. Compute the ZAP scan plan. Deterministic given (baseUrl, target, runId, tmpRoot). */
export function planDast(baseUrl, { target, runId, tmpRoot } = {}) {
  if (!URL_OK.test(String(baseUrl || ''))) throw new Error(`planDast: invalid base url '${baseUrl}'`)
  // HARD: the active scan must target a LOOPBACK throwaway only — never live prod, a remote
  // host, or Salesforce infra. Fail closed on anything else (audit: loopback enforcement).
  let host
  try { host = new URL(baseUrl).hostname } catch { throw new Error(`planDast: unparseable base url '${baseUrl}'`) }
  if (!LOOPBACK.has(host) && !/^127\./.test(host)) {
    throw new Error(`run-dast: refusing to active-scan a non-loopback host '${host}' — the DAST may only hit a local throwaway, never a live/remote target. (got ${baseUrl})`)
  }
  if (!RUN_ID_OK.test(String(runId || ''))) throw new Error(`planDast: invalid run-id '${runId}'`)
  if (!target) throw new Error('planDast: target repo required')
  assertSafeTmpRoot(tmpRoot)
  const image = `${ZAP_IMAGE}@${ZAP_DIGEST}`
  // self-identifying name: this is a LOCAL THROWAWAY scan, not the production-equivalent submission scan.
  const reportName = `zap-throwaway-local-${runId}.json`
  const evidenceDir = join(target, '.security-review', 'evidence', 'dast')
  return {
    schema: 'sf-srt-dast/1', runId, baseUrl, image,
    wrkDir: tmpRoot, reportInWrk: join(tmpRoot, 'report.json'),
    evidenceDir, evidencePath: join(evidenceDir, reportName),
    // ZAP in a container reaches the host-published 127.0.0.1:<port> via --network host.
    dockerArgs: ['run', '--rm', '--network', 'host', '-v', `${tmpRoot}:/zap/wrk:rw`, image,
      'zap-baseline.py', '-t', baseUrl, '-J', 'report.json', '-m', '1'],
  }
}

/** PURE. Summarize a ZAP JSON report → counts by risk + the top alerts. */
export function summarizeZap(report) {
  const site = (report && Array.isArray(report.site) ? report.site[0] : null) || {}
  const alerts = Array.isArray(site.alerts) ? site.alerts : []
  const byRisk = { High: 0, Medium: 0, Low: 0, Informational: 0 }
  for (const a of alerts) {
    const r = String(a.riskdesc || '').split(' ')[0] // "Medium (High)" → "Medium"
    if (r in byRisk) byRisk[r] += 1
  }
  return {
    target: site['@name'] || null,
    total: alerts.length,
    byRisk,
    top: alerts.slice(0, 15).map((a) => ({ risk: String(a.riskdesc || '').split(' ')[0], alert: a.alert, count: Number(a.count) || (a.instances ? a.instances.length : 1) })),
  }
}

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
const quiet = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true } catch { return false } }

/**
 * IMPURE executor. Runs the ZAP scan, copies the report into the project evidence dir
 * (host-owned), summarizes it, and removes the root-owned wrk. FAILS CLOSED w/o consent.
 */
export function runDast(plan, { consent = false } = {}) {
  assertSafeTmpRoot(plan.wrkDir)
  if (consent !== true) throw new Error('run-dast: refusing to run an active scan without explicit consent (a live op). Pass --consent.')
  // Docker runs the digest-pinned ZAP — fail with an honest hint if it's unavailable.
  const dock = dockerStatus()
  if (!dock.runnable) return { status: 'no-docker', baseUrl: plan.baseUrl, image: plan.image, evidencePath: null, summary: null, log: dock.hint }
  const rec = { status: 'scanning', baseUrl: plan.baseUrl, image: plan.image, evidencePath: null, summary: null, log: '' }
  try {
    mkdirSync(plan.wrkDir, { recursive: true, mode: 0o777 }) // ZAP's container user must write here
    mkdirSync(plan.evidenceDir, { recursive: true })
    if (!quiet('docker', ['image', 'inspect', plan.image])) run('docker', ['pull', plan.image]) // pull the pinned digest
    // zap-baseline.py exits non-zero when it FINDS warnings/fails — that's a result, not an error.
    try { rec.log = clampLog(run('docker', plan.dockerArgs), 1500) } catch (e) { rec.log = clampLog(String(e.stdout || e.message || ''), 1500) }
    if (!existsSync(plan.reportInWrk)) { rec.status = 'failed'; rec.log = clampLog(`ZAP produced no report — ${rec.log}`, 1500); return rec }
    copyFileSync(plan.reportInWrk, plan.evidencePath) // root-readable → host-owned copy in the project
    rec.evidencePath = plan.evidencePath
    // self-labelling note so this is never mistaken for the production-equivalent submission scan.
    try {
      writeFileSync(join(plan.evidenceDir, 'README-throwaway-dast.md'),
        '# Throwaway DAST evidence — LOCAL, not production-equivalent\n\n' +
        `The \`zap-throwaway-local-*.json\` reports here were produced by a digest-pinned ZAP\n` +
        `scan against a disposable throwaway the toolkit stood up locally (${plan.baseUrl}).\n\n` +
        'This is the toolkit\'s **corroborating** DAST + a de-risking dry run. It is NOT a\n' +
        'substitute for the **production-equivalent** DAST the Salesforce submission requires\n' +
        '(debug off, same hardening, same edge), nor for Salesforce\'s own penetration test.\n' +
        'Fidelity is bounded by the repo\'s run recipe — where prod depends on external managed\n' +
        'services, the throwaway only approximates it.\n')
    } catch { /* note is best-effort */ }
    try { rec.summary = summarizeZap(JSON.parse(readFileSync(plan.evidencePath, 'utf8'))) } catch (e) { rec.summary = { error: String(e.message) } }
    rec.status = 'done'
  } catch (e) {
    rec.status = 'failed'; rec.log = clampLog(`${rec.log}\n${String(e && e.message || e)}`.trim(), 1500)
  } finally {
    // remove the root-owned ZAP wrk CONTENTS via a throwaway root container (host can't rm
    // root files), then the now-empty host-owned wrk dir itself.
    quiet('docker', ['run', '--rm', '-v', `${plan.wrkDir}:/x`, 'alpine', 'sh', '-c', 'rm -rf /x/* /x/.[!.]* 2>/dev/null || true'])
    try { rmSync(plan.wrkDir, { recursive: true, force: true }) } catch {}
  }
  return rec
}

function main() {
  const argv = process.argv
  const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
  const baseUrl = arg('--base-url', null)
  const target = arg('--target', process.cwd())
  const runId = arg('--run-id', `${Date.now().toString(36)}-${process.pid}-${randomBytes(3).toString('hex')}`)
  const tmpRoot = arg('--tmp-root', join(tmpdir(), 'sf-srt-dast', runId))
  // --consent alone is insufficient: a recorded affirmative 'throwaway-dast' consent
  // (the journey's third gate, asked via AskUserQuestion) is also required.
  const consentFlag = argv.includes('--consent')
  const consentRecorded = verifyConsent('throwaway-dast', { target })
  const consent = consentFlag && consentRecorded
  const asJson = argv.includes('--json')

  let plan
  try { plan = planDast(baseUrl, { target, runId, tmpRoot }) }
  catch (e) { process.stdout.write(`## run-dast — ${e.message}\n`); process.exitCode = 3; return }
  if (!consent) {
    const why = consentFlag && !consentRecorded
      ? `--consent is set but no affirmative consent is recorded for gate 'throwaway-dast' (the flag alone is not enough). Ask + record it first via record-consent.mjs.`
      : `re-run with --consent (and the recorded consent).`
    process.stdout.write(`## run-dast — NOT RUN (no consent)\nWould run digest-pinned ZAP (${plan.image}) against ${plan.baseUrl} → ${plan.evidencePath}\n${why}\n`); process.exitCode = 3; return
  }

  const r = runDast(plan, { consent })
  if (asJson) { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); if (r.status !== 'done') process.exitCode = 1; return }
  const L = [`## run-dast — ${r.status}`]
  if (r.status === 'done') {
    L.push(`evidence: ${r.evidencePath}`)
    const s = r.summary || {}
    L.push(`alerts: ${s.total} (High ${s.byRisk?.High || 0} · Medium ${s.byRisk?.Medium || 0} · Low ${s.byRisk?.Low || 0} · Info ${s.byRisk?.Informational || 0})`)
    for (const a of (s.top || []).slice(0, 8)) L.push(`  [${a.risk}] ${a.alert} (x${a.count})`)
  } else L.push('LOG: ' + (r.log || '').split('\n').pop())
  process.stdout.write(L.join('\n') + '\n')
  if (r.status !== 'done') process.exitCode = 1
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) }
  catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

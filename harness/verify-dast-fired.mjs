#!/usr/bin/env node
/*
 * verify-dast-fired.mjs — the deterministic tag gate on whether the throwaway DAST
 * actually FIRED (a real ZAP report on disk + honest provenance), rather than
 * degrading to a not-run stub.
 *
 * WHY THIS EXISTS. The 0.9.0 tag gate is a cold run where DAST fires: run-dast must
 * land a real report at `evidence/dast/zap-throwaway-local-<runId>.json` (the throwaway
 * OUTPUT — NOT `zap-baseline`, which is the name of the ZAP SCRIPT the container runs,
 * never an evidence file) AND `dast-provenance.json` must carry a `scanKind` other than
 * `not-run` (a real fire via run-dast's `buildDastProvenance`, not the `--absent`
 * `absentCorroborationStub`). Every cold run so far DEGRADED; this turns "did it fire?"
 * into an exit code the cold-run runbook can gate on, instead of a human eyeballing a
 * directory.
 *
 * This gate CANNOT be fully hermetic — the fire itself needs live docker + a stood-up
 * disposable throwaway MIRROR the toolkit built, which CI does not have. So the
 * PREDICATE (`dastFired`) is pure + tested, and this CLI is the live cold-run runbook
 * step: exit 0 (fired) with a one-line confirmation, exit 2 (not fired / unverifiable —
 * FAIL CLOSED) with a loud reason. A gate that cannot confirm a fire never passes.
 *
 * PURE predicate + thin CLI. Read-only on everything. No LLM, no network, no deps.
 *
 * USAGE: node verify-dast-fired.mjs --target <repo> [--json]
 */
import { readFileSync, readdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The throwaway DAST report's self-identifying name (run-dast.mjs `reportName`). The
// `zap-baseline` token is the ZAP SCRIPT (`zap-baseline.py`) the container executes; it is
// NEVER an evidence filename, so a directory holding only a `zap-baseline-*.json` is NOT a fire.
export const THROWAWAY_REPORT_RE = /^zap-throwaway-local-.+\.json$/

/**
 * PURE. (provenance object|null, evidence-dir file names) → { fired, reason }.
 * FIRED ⟺ the provenance records a real scan (a `scanKind` present AND !== 'not-run')
 * AND at least one throwaway report file (`zap-throwaway-local-*.json`) is on disk.
 * Everything else is a degrade / evidence-of-absence, NOT a fire (fail closed): a missing
 * provenance, a `not-run` stub, a `scanKind`-less provenance, or a real `scanKind` with no
 * report file to back it.
 */
export function dastFired({ provenance, reportFiles } = {}) {
  const files = Array.isArray(reportFiles) ? reportFiles : []
  const hasReport = files.some((f) => THROWAWAY_REPORT_RE.test(String(f)))
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    return { fired: false, reason: 'no readable dast-provenance.json — DAST did not run, or its evidence is missing; this is NOT a fire' }
  }
  const kind = String(provenance.scanKind || '')
  if (kind === '') {
    return { fired: false, reason: 'dast-provenance.json carries no scanKind — cannot confirm a fire; failing closed' }
  }
  if (kind === 'not-run') {
    return { fired: false, reason: `DAST degraded to a not-run stub (${provenance.reason || 'no reason recorded'}) — evidence of absence, not a scan result` }
  }
  if (!hasReport) {
    return { fired: false, reason: `dast-provenance.json reports scanKind '${kind}' but no zap-throwaway-local-*.json report is on disk — a real fire must leave its report` }
  }
  return { fired: true, reason: `DAST fired: scanKind '${kind}', a zap-throwaway-local-*.json report present` }
}

function main() {
  const arg = (flag, def) => {
    const i = process.argv.indexOf(flag)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
  }
  const TARGET = arg('--target', process.cwd())
  const AS_JSON = process.argv.includes('--json')
  const dir = join(TARGET, '.security-review', 'evidence', 'dast')
  let provenance = null
  try { provenance = JSON.parse(readFileSync(join(dir, 'dast-provenance.json'), 'utf8')) } catch { provenance = null }
  let reportFiles = []
  try { reportFiles = readdirSync(dir) } catch { reportFiles = [] }
  const r = dastFired({ provenance, reportFiles })
  if (AS_JSON) {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n')
  } else if (r.fired) {
    process.stdout.write(`verify-dast-fired: PASS — ${r.reason}.\n`)
  } else {
    process.stderr.write(
      `verify-dast-fired: FAIL — ${r.reason}.\n` +
      '  The 0.9.0 tag gate requires a real DAST fire (a zap-throwaway-local-*.json report + honest\n' +
      '  provenance, scanKind ≠ not-run). Stand up the disposable throwaway mirror and re-run\n' +
      '  run-dast --from-standup, then re-check — DAST only ever scans a mirror the toolkit built,\n' +
      '  never a pre-existing/running instance.\n'
    )
  }
  if (!r.fired) process.exitCode = 2
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) }
  catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

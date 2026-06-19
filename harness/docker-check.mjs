#!/usr/bin/env node
/*
 * docker-check.mjs — the throwaway-DAST environment prerequisite (0.7.1). The
 * containerized throwaway (standup-stack + run-dast) needs Docker; this reports
 * whether it's usable so the gate offers the throwaway-DAST only when it can
 * actually run, and the engines fail with an honest message (not a raw error)
 * when it can't. See docs/roadmap-0.7.0-throwaway-dast-harness.md.
 *
 * WHY DOCKER IS A PREREQ (NOT tmp-installed): unlike the userland scanners, Docker
 * is a privileged background daemon needing root-level setup (setuid uidmap binaries,
 * subuid/subgid, kernel user-namespace settings) — it cannot be dropped into a tmp
 * dir. The honest posture is: detect it; if present use it; if absent, GUIDE the user
 * to install it once (system-wide, their call) and fall back to owner-run DAST.
 *
 * Pure `classifyDocker` + impure `dockerStatus`. USAGE: node docker-check.mjs [--json]
 */
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { whichOn } from './tool-detect.mjs'

const INSTALL_HINT = 'install it once, system-wide (Linux: `sudo apt-get install docker.io` or the Docker convenience script; macOS/Windows: Docker Desktop), then re-run — or your DAST stays owner-run (you run it against your own staging, which the submission requires regardless)'

/** PURE: classify docker usability from probe facts → { status, runnable, hint }. */
export function classifyDocker({ hasBinary, daemonOk } = {}) {
  if (!hasBinary) return { status: 'absent', runnable: false, hint: `Docker is not installed — the autonomous throwaway DAST runs in containers. ${INSTALL_HINT}.` }
  if (!daemonOk) return { status: 'daemon-down', runnable: false, hint: 'Docker is installed but the daemon is not responding — start it (Linux: `sudo systemctl start docker`; Desktop: launch the app), or your DAST stays owner-run.' }
  return { status: 'available', runnable: true, hint: '' }
}

/** IMPURE: probe the host (PATH for the binary, `docker info` for the daemon). */
export function dockerStatus(pathStr = process.env.PATH || '') {
  const hasBinary = whichOn('docker', pathStr) !== null
  let daemonOk = false
  if (hasBinary) { try { execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 10000 }); daemonOk = true } catch {} }
  return classifyDocker({ hasBinary, daemonOk })
}

function main() {
  const r = dockerStatus()
  if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify(r, null, 2) + '\n') }
  else process.stdout.write(`[docker:${r.status}] ${r.runnable ? 'the containerized throwaway DAST can run' : r.hint}\n`)
  process.exitCode = r.runnable ? 0 : 3
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) }
  catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

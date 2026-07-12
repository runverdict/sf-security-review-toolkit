#!/usr/bin/env node
/*
 * render-preflight.mjs — the VERBATIM one-page 3-tier preflight report (WI-05 /
 * INV-07, presentation-consistency Slice 3). The MOST-SEEN operator surface: every
 * `security-review-journey` run opens with it. The output-class analog of the
 * gate-spec engine — the ENGINE owns the report SKELETON, the driver pastes it
 * byte-for-byte (replacing the fenced-block prose whose bullet contents were freehand).
 *
 * WHY THIS EXISTS. The preflight report's three tiers (✓ DETECTED / ⚠ NEED-FROM-YOU /
 * ✦ OPTIONAL POWER-UPS) were a hand-authored fenced block: the deployed-org power-up
 * line in particular drifted run-to-run (READY one run, a different "needs-build"
 * wording the next), even though the underlying facts come from deterministic
 * detectors. This pins the skeleton: a fixed 3-tier block rendered from the already-
 * deterministic detector JSONs, with the deployed-org power-up line a FIXED 4-state
 * enum (installable / needs-build-buildable / needs-build-unregistered / no-package)
 * where ONLY the readiness-reason fills.
 *
 * INPUTS (a single facts object the driver assembles — see the CLI `--facts`):
 *   {
 *     repo, commit, resumePoint,                 // header context (driver strings)
 *     elements:    [{ type, evidence }],         // architecture elements (journey scan)
 *     needFromYou: ["<audit-blocking gap>", …],  // the only hard-stops (journey heuristic)
 *     baseline,          // baseline-counts.mjs --json
 *     packageReadiness,  // package-readiness.mjs --json   → drives the 4-state power-up
 *     toolDetect,        // tool-detect.mjs --json
 *     stackDetect,       // stack-detect.mjs --json (an optional liveCollision block —
 *                        //   colliding running names + engine-owned isolatedBy facts —
 *                        //   switches the throwaway-DAST line to its collision-aware
 *                        //   variant: live stack named, mirror stated FULLY ISOLATED)
 *     dockerCheck        // docker-check.mjs --json
 *   }
 * Every field is OPTIONAL — a missing detector renders an honest "not detected" line,
 * never a fabricated fact and never a crash. The SKELETON (the three tier headers and
 * their framing) is always identical; only the DATA varies.
 *
 * DETERMINISTIC + PURE (CONVENTIONS §7): same facts in → byte-identical block out. No
 * LLM, no network, no deps, no Date/Math.random.
 *
 * USAGE:
 *   node render-preflight.mjs --facts <facts.json>
 *   node render-preflight.mjs --target <repo>   # reads .security-review/preflight-facts.json
 */
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── THE FIXED 4-STATE DEPLOYED-ORG POWER-UP ENUM ──────────────────────────────
// The deployed-org deep audit installs a RELEASED package version into a scratch org.
// package-readiness emits status ∈ {installable, needs-build, no-package} + a `registered`
// boolean; this maps that onto the FOUR operator-facing states. Each state has a FIXED
// label + verdict; only the detector's `reason` fills the parenthetical. Frozen so the
// enum is provably complete and a new wording cannot creep in. (0.8.43: the renderer
// QUALIFIES the `installable` label to "READY — pending sf install + Dev Hub auth" when
// `sf` is absent from tool-detect — the deep audit needs sf authed, not just an installable
// version — but no new enum state is added; every other label is unchanged.)
export const DEEP_AUDIT_STATES = Object.freeze({
  'installable': Object.freeze({
    label: 'READY (installable)',
    verdict: 'an installable released version exists → run the deployed-org deep audit? (yes/no)',
  }),
  'needs-build-buildable': Object.freeze({
    label: 'needs-build (buildable)',
    verdict: 'the package is registered to your Dev Hub but has no released version → build a version first, then deep-audit? (yes/no)',
  }),
  'needs-build-unregistered': Object.freeze({
    label: 'needs-build (unregistered)',
    verdict: "can't build yet: the package is not created against your Dev Hub — `sf package create` to register it, then build, before any deep audit (no yes/no offer until then)",
  }),
  'no-package': Object.freeze({
    label: 'N/A (no installable package)',
    verdict: 'no installable 2GP package in this repo → the deployed-org deep audit does not apply',
  }),
})

/** Pure: map a package-readiness verdict → the fixed 4-state key. Total over its outputs. */
export function deepAuditState(pr) {
  const status = pr && typeof pr === 'object' ? pr.status : null
  if (status === 'installable') return 'installable'
  if (status === 'no-package') return 'no-package'
  if (status === 'needs-build') return pr.registered ? 'needs-build-buildable' : 'needs-build-unregistered'
  return null // unknown — the caller renders the "not detected" fallback (pr absent/malformed)
}

const oneLine = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()

/** Pure: the assembled facts (or null) → the fixed 3-tier preflight block. */
export function renderPreflight(facts) {
  const f = facts && typeof facts === 'object' ? facts : {}
  const repo = oneLine(f.repo) || '(repo path not recorded)'
  const commit = oneLine(f.commit) || '(commit not recorded)'
  const resume = oneLine(f.resumePoint) || 'fresh start (no prior phase detected)'

  // ── header: repo @ commit + baseline currency ──
  const b = f.baseline && typeof f.baseline === 'object' ? f.baseline : null
  const baselineLine = b
    ? `Baseline currency: newest_verified ${b.newest_verified ?? 'none'} ` +
      `(${Number.isFinite(b.total) ? b.total : '?'} entries, ${Number.isFinite(b.last_verified_null) ? b.last_verified_null : '?'} unverified)`
    : 'Baseline currency: not detected'

  const L = [
    'PREFLIGHT — AppExchange/AgentExchange security-review readiness',
    `Repo: ${repo} @ ${commit}   ${baselineLine}`,
    `Resume point: ${resume}`,
    '',
  ]

  // ── ✓ DETECTED — what the toolkit sensed automatically (silence-is-yes) ──
  L.push('✓ DETECTED (proceeding with these — interrupt only to correct)')
  const elements = Array.isArray(f.elements) ? f.elements.filter((e) => e && e.type) : []
  if (elements.length) {
    for (const e of elements) L.push(`  • ${oneLine(e.type)}${e.evidence ? ` — ${oneLine(e.evidence)}` : ''}`)
  } else {
    L.push('  • Architecture elements: none detected by the journey scan (or not supplied)')
  }
  // package status (from package-readiness)
  const pr = f.packageReadiness && typeof f.packageReadiness === 'object' ? f.packageReadiness : null
  L.push(`  • Managed package: ${pr ? `[${pr.status}] ${oneLine(pr.reason)}` : 'not detected (no sfdx-project.json read)'}`)
  // external backend (from stack-detect)
  const sd = f.stackDetect && typeof f.stackDetect === 'object' ? f.stackDetect : null
  L.push(`  • External backend: ${sd ? `[${sd.status}] ${oneLine(sd.reason)}` : 'not detected'}`)
  // scan tools present (from tool-detect)
  const td = f.toolDetect && typeof f.toolDetect === 'object' ? f.toolDetect : null
  // Is `sf` itself present? (the deployed-org deep audit can't run a step without it,
  // even when a package is installable — so an installable+sf-absent "READY" overstates).
  const sfPresent = !!(td && td.summary && Array.isArray(td.summary.present_tools) &&
    td.summary.present_tools.some((t) => t && t.name === 'sf'))
  if (td && td.summary) {
    const present = Array.isArray(td.summary.present_tools) ? td.summary.present_tools.map((t) => t.name) : []
    const satisfied = Array.isArray(td.summary.satisfied_families) ? td.summary.satisfied_families.length : 0
    const totalFam = Array.isArray(td.families) ? td.families.length : 8
    L.push(`  • Scan tools present: ${present.length ? present.join(', ') : 'none on PATH'} (${satisfied}/${totalFam} scan families have a local runner)`)
  } else {
    L.push('  • Scan tools present: not detected')
  }
  // docker (throwaway-DAST host)
  const dc = f.dockerCheck && typeof f.dockerCheck === 'object' ? f.dockerCheck : null
  L.push(`  • Docker (throwaway-DAST host): ${dc ? `[${dc.status}] ${dc.runnable ? 'available' : oneLine(dc.hint)}` : 'not detected'}`)
  L.push('')

  // ── ⚠ NEED-FROM-YOU — the ONLY hard-stop, audit-blocking gaps only ──
  L.push('⚠ NEED-FROM-YOU (blocks a good audit — the only hard-stop)')
  const need = Array.isArray(f.needFromYou) ? f.needFromYou.map(oneLine).filter(Boolean) : []
  if (need.length) for (const n of need) L.push(`  • ${n}`)
  else L.push('  • none — nothing blocks the audit; proceeding under silence-is-yes on the DETECTED inputs')
  L.push('')

  // ── ✦ OPTIONAL POWER-UPS — proactive, opt-in, default-skip ──
  L.push('✦ OPTIONAL POWER-UPS (proactive + accurate; a LIVE power-up runs only on your explicit yes)')
  // (1) deployed-org deep audit — the FIXED 4-state enum
  const stateKey = pr ? deepAuditState(pr) : null
  if (stateKey && DEEP_AUDIT_STATES[stateKey]) {
    const st = DEEP_AUDIT_STATES[stateKey]
    // Qualify ONLY the installable+sf-absent case: an installable version means the deep
    // audit CAN run, but not before `sf` is installed + a Dev Hub authed — so "READY"
    // alone overstates it without sf. Every other state's fixed label is unchanged, and
    // installable+sf-present stays the plain "READY (installable)".
    const label = stateKey === 'installable' && !sfPresent
      ? 'READY — pending sf install + Dev Hub auth'
      : st.label
    L.push(`  • Deployed-org deep audit — ${label}: ${st.verdict}`)
  } else {
    L.push('  • Deployed-org deep audit — readiness not sensed (package-readiness not run); install + auth `sf` and re-run to settle it')
  }
  // (2) throwaway-DAST — only when stack runnable AND docker available
  const stackRunnable = sd && sd.status === 'runnable'
  const dockerOk = dc && dc.runnable === true
  if (stackRunnable && dockerOk) {
    // Collision-aware variant (additive): when stack-detect saw a LIVE stack whose fixed
    // container_names are running on this host RIGHT NOW, the offer must SAY so — and say
    // the mirror is fully isolated anyway. The scariest situation (live prod up +
    // "runnable") must be where the report says the most, not the least. Both the
    // colliding names and the isolation facts render from the engine's liveCollision
    // block (stack-detect detectCollision + MIRROR_ISOLATION) — never invented here; a
    // block missing either list falls back to the plain line rather than fabricate.
    const lc = sd.liveCollision && typeof sd.liveCollision === 'object' ? sd.liveCollision : null
    const colliding = lc && Array.isArray(lc.colliding) ? lc.colliding.map(oneLine).filter(Boolean) : []
    const isolatedBy = lc && Array.isArray(lc.isolatedBy) ? lc.isolatedBy.map(oneLine).filter(Boolean) : []
    if (colliding.length && isolatedBy.length) {
      L.push(`  • Throwaway-DAST — a live stack is running on this host (${colliding.join(', ')}), but the mirror runs FULLY ISOLATED (${isolatedBy.join('; ')}; it never touches a running container) — stand up an isolated throwaway, active-scan it, then destroy it? (yes/no)`)
    } else {
      L.push('  • Throwaway-DAST — stack is standable and Docker is available: stand up an isolated throwaway, active-scan it, then destroy it? (yes/no)')
    }
  } else if (sd && sd.status !== 'n/a') {
    const why = !dockerOk ? 'Docker unavailable' : `stack ${sd.status}`
    L.push(`  • Throwaway-DAST — not offered (${why}); DAST stays owner-run (you scan your own staging, which the submission requires regardless)`)
  } else {
    L.push('  • Throwaway-DAST — N/A (no external backend to stand up); DAST stays owner-run where an endpoint exists')
  }
  // (3) scan-tool install (tmp, consented)
  const installable = td && td.summary && Array.isArray(td.summary.installable_missing) ? td.summary.installable_missing : []
  if (installable.length) {
    L.push(`  • Scan-tool install — ${installable.length} installable scanner(s) missing (${installable.map((x) => `${x.name}(${x.install})`).join(', ')}): fetch to a tmp dir for this run (sha256-pinned, removed at cleanup)? (yes/no)`)
  } else {
    L.push('  • Scan-tool install — nothing to install (every installable scan family already has a local tool, or none is installable)')
  }
  // (4) sf CLI — only surfaced when there is no package readiness yet (no sf sensed)
  if (!pr) {
    L.push('  • sf CLI — not detected: install + auth `sf` to unlock the DevHub auto-resolve and the deployed-org deep audit')
    // Cross-reference the two distinct `sf` installs so "install sf" reads unambiguously:
    // the deep-audit `sf` is a SEPARATE authed, global install (for the scratch-org
    // stand-up) — distinct from the unauthed, tmp `sf` the scanner-install gate provisions
    // (inside code-analyzer-stack) for the static CRUD/FLS Code Analyzer.
    L.push('    (this is a separate authed, global `sf` for the scratch-org stand-up — NOT the unauthed, tmp `sf` the scan-tool install gate provisions for the static CRUD/FLS Code Analyzer)')
  }
  return L.join('\n')
}

function main() {
  const arg = (flag, def) => {
    const i = process.argv.indexOf(flag)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
  }
  const factsPath = arg('--facts', null)
  const target = arg('--target', null)
  const path = factsPath || (target ? join(target, '.security-review', 'preflight-facts.json') : null)
  let facts = null
  if (path) {
    try {
      facts = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      facts = null // absent / unreadable / non-JSON → the all-"not detected" skeleton, never a crash
    }
  }
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ block: renderPreflight(facts) }, null, 2) + '\n')
  } else {
    process.stdout.write(renderPreflight(facts) + '\n')
  }
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
  } catch {
    return fileURLToPath(import.meta.url) === process.argv[1]
  }
}
if (invokedDirectly()) main()

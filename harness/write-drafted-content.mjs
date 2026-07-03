#!/usr/bin/env node
/*
 * write-drafted-content.mjs — deterministic drafted-artifact WRITER (B3c). The artifact
 * Workflow's drafting agents are READ-ONLY (the Workflow runtime has no filesystem
 * access): the engine returns { drafted: [{ key, out, content }] } and the invoking skill
 * writes each artifact to disk. Before this harness, generate-artifacts step (d) had the
 * driver improvise that extract-and-write per run — the tracked rationale for retiring
 * that is determinism + byte-exactness (hand-scripted multi-line markdown writes are
 * where escaping/truncation slips live) — and NOTHING validated the returned `out`. This
 * harness is the toolkit's single write point for drafted content: byte-exact,
 * all-or-nothing, and path-scoped.
 *
 * THE PATH GUARD (the invariant). `out` round-trips THROUGH the Workflow's drafting
 * agents — it is LLM-influenced data crossing a WRITE boundary, so a malicious or
 * confused `out` (`../../../home/user/.bashrc`, `/etc/cron.d/x`,
 * `.git/hooks/pre-commit` — the last is code-execution-adjacent and passes a naive
 * repo-containment check) must be structurally impossible. Every rule is enforced on the
 * RESOLVED path (never by regex on the raw string), twice: once lexically (path.resolve)
 * and once REALIZED (symlinks resolved — below):
 *   - an absolute `out` is refused (so are empty / NUL-carrying ones);
 *   - resolve(repo, out) must be STRICTLY inside the repo: `resolved === repoRoot` is
 *     not a file target, and containment means startsWith(repoRoot + sep) — the `+ sep`
 *     matters (`/repo-evil` must NOT pass for repo `/repo`);
 *   - anything at/under <repo>/.git/ is refused (hook/config writes are code execution);
 *   - ALLOWED ROOTS: the resolved path must additionally sit under
 *     <repo>/docs/security-review/ or <repo>/.security-review/ — every artifact the
 *     toolkit drafts lives there. A future artifact elsewhere is a deliberate one-line
 *     change to ALLOWED_ROOTS below, never a silent write;
 *   - SYMLINKS (implemented, not just documented): a symlink inside the repo escapes a
 *     prefix check on the unresolved path (docs/security-review/link → /home/user — or a
 *     planted symlink FILE at the target itself, which writeFileSync would follow). After
 *     the lexical checks the guard walks to the deepest EXISTING ancestor of the target
 *     (lstat-aware, so a planted or DANGLING symlink at the final component is seen, not
 *     followed-and-missed), realpathSync's it (a broken/dangling link on the path is
 *     refused outright — realpath cannot vouch for where the write would land), and
 *     re-asserts ALL the rules against realpath(ancestor) + remainder, with the repo and
 *     allowed roots realpath'd on the same basis, before any mkdir/write.
 *
 * ALL-OR-NOTHING (fail closed). PLAN then EXECUTE: every entry is validated first; if
 * ANY entry's `out` is invalid (or two entries collide on one resolved target) the
 * ENTIRE run is refused — exit 2, zero files written — a poisoned envelope must never
 * produce partial writes. Null/malformed entries and empty-content drafts are tolerated
 * by SKIPPING LOUD (named in the summary — a drafting agent that died must not erase a
 * good prior draft); a malformed PATH is a refusal, never a skip. `planWrites` is
 * exported for tests: it is READ-ONLY on the filesystem (the symlink realization must
 * consult the real tree), writes nothing, and is deterministic given
 * (repoRoot, entries, tree state).
 *
 * WRITE SEMANTICS. Byte-exact utf8 — `content` is written verbatim (backticks, quotes,
 * newlines, unicode, `$(cmd)`; no template processing, no trailing-newline "help");
 * parent dirs are mkdir -p'd (inside the allowed roots only, by construction); overwrite
 * is normal (artifacts regenerate per pass); an idempotent re-run produces the same
 * bytes. The executor re-runs the full guard per entry immediately before its
 * mkdir+write, so a tree change between plan and write is re-checked at the last moment.
 *
 * ENVELOPE. The Workflow tool persists its run to a TASK-OUTPUT file as
 * { summary, result, workflowProgress }. Same doctrine as merge-ledger (the canonical
 * unwrap): --result accepts the RAW envelope OR a pre-extracted { drafted: [...] },
 * keyed on the presence of the payload; neither shape → exit 2 naming both shapes.
 * Point --result at the task-output file DIRECTLY — never hand-extract `.result`.
 *
 * GATE CROSS-CHECK (defense-in-depth). With --input (default:
 * <repo>/.security-review/artifact-input.json), any drafted key in the input's
 * gate.suppress is SKIPPED LOUD — the engine (build-artifact-engine.mjs) already drops
 * suppressed artifacts pre-Workflow and REMAINS the enforcement point, but a
 * stale/resumed envelope must not resurrect a withheld doc. An absent input file or a
 * missing gate block → no cross-check; a PRESENT-but-unparseable input is refused loud
 * (a typo must not silently drop the cross-check). The WITHHELD placeholder itself stays
 * driver-side — it is gate-data-derived, not envelope content.
 *
 * Writes ONLY under <repo>/docs/security-review/ and <repo>/.security-review/ — the
 * guard makes that structural. Read-only on everything else. No network, no deps.
 *
 * EXIT CODES: 0 = wrote/skipped per plan (including --dry-run); 2 = envelope unreadable /
 * neither shape / ANY invalid output path (nothing written) / unparseable --input /
 * missing --repo directory / a write failure (aborted loud, already-written files named).
 *
 * Usage:
 *   node write-drafted-content.mjs --repo <target> --result <workflow-task-output-file> \
 *       [--input <target>/.security-review/artifact-input.json] [--dry-run] [--json]
 */
import { readFileSync, writeFileSync, mkdirSync, lstatSync, statSync, realpathSync } from 'node:fs'
import { resolve, join, sep, dirname, basename, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

// The ONLY roots drafted content may land under, repo-relative. Every artifact the
// toolkit drafts lives here (see the artifact-input.json examples in generate-artifacts).
// Extending this list is a deliberate, reviewed change — never a runtime affordance.
export const ALLOWED_ROOTS = ['docs/security-review', '.security-review']

const strictlyUnder = (p, root) => p.startsWith(root + sep)
const atOrUnder = (p, root) => p === root || strictlyUnder(p, root)
const lexists = (p) => {
  try {
    lstatSync(p)
    return true
  } catch {
    return false
  }
}

// Walk to the deepest EXISTING (lstat-visible) ancestor of `p`, realpath it, and
// re-append the not-yet-existing remainder. lstat-aware on purpose: a planted symlink at
// the final component (even a dangling one, which exists-that-follows would miss) is
// realized rather than written through. Throws if the deepest existing entry cannot be
// realpath'd (a broken/dangling symlink on the path) — the caller refuses.
function realizePlanned(p) {
  let existing = p
  const tail = []
  while (existing !== dirname(existing) && !lexists(existing)) {
    tail.unshift(basename(existing))
    existing = dirname(existing)
  }
  const real = realpathSync(existing)
  return tail.length ? join(real, ...tail) : real
}

// The rule set, applied to one (rootBase, candidate) pair. Pure string checks — the
// caller supplies the lexical pair first, then the realized pair.
function containmentErrors(rootBase, candidate, phase) {
  if (candidate === rootBase) return `resolves to the repository root itself (${phase})`
  if (!strictlyUnder(candidate, rootBase)) {
    return `resolves outside the repository (${phase}: ${candidate})`
  }
  if (atOrUnder(candidate, join(rootBase, '.git'))) {
    return `resolves under ${join(rootBase, '.git')} — .git is never a write target (${phase})`
  }
  if (!ALLOWED_ROOTS.some((r) => strictlyUnder(candidate, join(rootBase, r)))) {
    return (
      `resolves outside the allowed artifact roots ` +
      `(${ALLOWED_ROOTS.map((r) => r + '/').join(', ')}) (${phase}: ${candidate})`
    )
  }
  return null
}

/**
 * Validate ONE Workflow-returned output path against the guard. Returns
 * { ok: true, resolved } (resolved = the lexical absolute target) or
 * { ok: false, reason }. Read-only on the filesystem (symlink realization).
 *
 * @param {string} repoRoot — the target repo root (must exist)
 * @param {*} out — the LLM-influenced repo-relative output path from the envelope
 */
export function validateOut(repoRoot, out) {
  if (typeof out !== 'string' || !out.trim()) return { ok: false, reason: 'missing/empty output path' }
  if (out.includes('\0')) return { ok: false, reason: 'output path contains a NUL byte' }
  if (isAbsolute(out)) return { ok: false, reason: 'absolute output path — paths must be repo-relative' }
  const root = resolve(repoRoot)
  const resolved = resolve(root, out)
  const lexical = containmentErrors(root, resolved, 'lexical')
  if (lexical) return { ok: false, reason: lexical }
  // Realized re-assert: the same rules against the symlink-resolved tree. The repo root
  // is realpath'd on the same basis so a legitimately-symlinked repo root still compares.
  let realRoot
  let realTarget
  try {
    realRoot = realpathSync(root)
    realTarget = realizePlanned(resolved)
  } catch {
    return { ok: false, reason: 'a broken/dangling symlink sits on the output path — refusing to write through it' }
  }
  const realized = containmentErrors(realRoot, realTarget, 'realized — a symlink on the path escapes the repo/allowed roots')
  if (realized) return { ok: false, reason: realized }
  return { ok: true, resolved }
}

/**
 * PLAN phase — validate every envelope entry; nothing is written here. Read-only on the
 * filesystem; deterministic given (repoRoot, entries, tree state, suppress).
 *
 * Returns { writes, skipped, refused }:
 *   writes  [{ key, out, resolved, content }] — valid, non-suppressed, non-empty entries
 *   skipped [{ key, out, reason }]            — tolerated-but-not-written (LOUD in the summary)
 *   refused [{ key, out, reason }]            — ANY refusal fails the whole run (all-or-nothing)
 *
 * @param {string} repoRoot
 * @param {Array<*>} entries — the envelope's drafted[]
 * @param {{ suppress?: Set<string> }} [opts] — gate.suppress keys (cross-check)
 */
export function planWrites(repoRoot, entries, opts = {}) {
  const suppress = opts.suppress instanceof Set ? opts.suppress : new Set()
  const writes = []
  const skipped = []
  const refused = []
  const list = Array.isArray(entries) ? entries : []
  list.forEach((e, i) => {
    if (e == null || typeof e !== 'object' || Array.isArray(e)) {
      skipped.push({
        key: `entry#${i}`,
        out: null,
        reason: 'malformed entry (not an object) — a drafting agent likely died; re-run the artifact engine for the missing artifact',
      })
      return
    }
    const key = typeof e.key === 'string' && e.key ? e.key : `entry#${i}`
    // The PATH verdict comes first: a poisoned path anywhere in the envelope is a
    // refusal — even on an entry the gate would have skipped (fail closed, never partial).
    const v = validateOut(repoRoot, e.out)
    if (!v.ok) {
      refused.push({ key, out: e.out == null ? null : String(e.out), reason: v.reason })
      return
    }
    if (suppress.has(key)) {
      skipped.push({
        key,
        out: String(e.out),
        reason: 'withheld by the gate (gate.suppress) — a stale/resumed envelope must not resurrect a withheld doc; the driver writes the WITHHELD placeholder instead',
      })
      return
    }
    if (typeof e.content !== 'string' || !e.content.trim()) {
      skipped.push({
        key,
        out: String(e.out),
        reason: 'empty/non-string content — the drafting agent returned nothing; any existing prior draft is left untouched; re-run the artifact engine for this artifact',
      })
      return
    }
    writes.push({ key, out: String(e.out), resolved: v.resolved, content: e.content })
  })
  // Two entries colliding on ONE resolved target is a malformed envelope (the engine
  // drafts each artifact exactly once) — refused, never a silent last-write-wins.
  const seen = new Map()
  for (const w of writes) {
    if (seen.has(w.resolved)) {
      refused.push({ key: w.key, out: w.out, reason: `duplicate output path — the envelope also drafts it as '${seen.get(w.resolved)}'` })
    } else {
      seen.set(w.resolved, w.key)
    }
  }
  return { writes, skipped, refused }
}

// ----------------------------------------------------------------------------
// CLI
// ----------------------------------------------------------------------------
function arg(flag, def) {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}

function main() {
  const REPO = arg('--repo', process.cwd())
  const RESULT = arg('--result', null)
  const INPUT = arg('--input', join(REPO, '.security-review', 'artifact-input.json'))
  const DRY = process.argv.includes('--dry-run')
  const AS_JSON = process.argv.includes('--json')

  if (!RESULT) {
    console.error('write-drafted-content: --result <workflow-task-output-file> is required')
    process.exit(2)
  }
  try {
    if (!statSync(REPO).isDirectory()) throw new Error('not a directory')
  } catch {
    console.error(`write-drafted-content: --repo ${REPO} is not an existing directory`)
    process.exit(2)
  }

  let wrapper = null
  try {
    wrapper = JSON.parse(readFileSync(RESULT, 'utf8'))
  } catch {
    console.error(`write-drafted-content: cannot read result ${RESULT}`)
    process.exit(2)
  }
  const R = wrapper && wrapper.result && wrapper.result.drafted ? wrapper.result : wrapper
  if (!R || !Array.isArray(R.drafted)) {
    console.error(
      'write-drafted-content: --result has no `drafted` array after unwrap. Two shapes are accepted:\n' +
        '  (1) the RAW Workflow task-output envelope — `{ summary, result: { drafted: [...] }, workflowProgress }`\n' +
        '      (the harness unwraps `.result` automatically); point --result at that task-output file DIRECTLY, or\n' +
        '  (2) a pre-extracted result object — `{ drafted: [...] }`.\n' +
        `  Got neither (no \`drafted\` and no \`result.drafted\`) in ${RESULT}. ` +
        'Do NOT hand-extract `.result` or re-parse the envelope — pass the task-output file as-is.'
    )
    process.exit(2)
  }

  // Gate cross-check input: absent file → no cross-check (the engine remains the
  // enforcement point); present-but-unparseable → refuse loud.
  let suppress = new Set()
  let inputState = 'absent'
  let inputRaw = null
  try {
    inputRaw = readFileSync(INPUT, 'utf8')
  } catch {
    inputRaw = null
  }
  if (inputRaw != null) {
    let input
    try {
      input = JSON.parse(inputRaw)
    } catch (e) {
      console.error(
        `write-drafted-content: cannot parse --input ${INPUT} (${e.message}) — a corrupted artifact-input must not ` +
          'silently drop the gate cross-check; fix the file (or omit --input deliberately) and re-run'
      )
      process.exit(2)
    }
    const gate = input && typeof input === 'object' ? input.gate : null
    if (gate && typeof gate === 'object' && Array.isArray(gate.suppress)) {
      suppress = new Set(gate.suppress.map((s) => String(s)))
      inputState = 'gate-checked'
    } else {
      inputState = 'present-no-gate'
    }
  }

  const plan = planWrites(REPO, R.drafted, { suppress })

  if (plan.refused.length) {
    for (const r of plan.refused) {
      console.error(`  REFUSED: ${r.key} → ${r.out === null ? '(no path)' : r.out} — ${r.reason}`)
    }
    console.error(
      `write-drafted-content: ${plan.refused.length} invalid output path(s) in the envelope — NOTHING was written ` +
        '(all-or-nothing: a poisoned envelope must never produce partial writes). Re-run the artifact engine ' +
        '(build-artifact-engine.mjs → the Workflow) so the envelope carries canonical output paths, or inspect ' +
        `the task-output file at ${RESULT}. Do not hand-edit output paths to make a refused envelope pass.`
    )
    if (AS_JSON) {
      process.stdout.write(
        JSON.stringify({ written: [], skipped: plan.skipped, refused: plan.refused, dryRun: DRY }, null, 2) + '\n'
      )
    }
    process.exit(2)
  }

  const written = []
  if (!DRY) {
    for (const w of plan.writes) {
      // Last-moment re-assert: the tree may have changed since the plan (a symlink swap
      // between plan and write is re-caught here, immediately before the mkdir+write).
      const v = validateOut(REPO, w.out)
      if (!v.ok) {
        console.error(`  REFUSED at write time: ${w.key} → ${w.out} — ${v.reason}`)
        console.error(
          `write-drafted-content: the tree changed between plan and write — aborted. ` +
            `Already written this run: ${written.length ? written.map((x) => x.out).join(', ') : '(none)'}`
        )
        process.exit(2)
      }
      try {
        mkdirSync(dirname(v.resolved), { recursive: true })
        writeFileSync(v.resolved, Buffer.from(w.content, 'utf8'))
      } catch (e) {
        console.error(`write-drafted-content: failed writing ${w.out} (${e.message}) — aborted.`)
        console.error(`Already written this run: ${written.length ? written.map((x) => x.out).join(', ') : '(none)'}`)
        process.exit(2)
      }
      written.push({ key: w.key, out: w.out, bytes: Buffer.byteLength(w.content, 'utf8') })
    }
  }

  if (AS_JSON) {
    const planned = DRY ? plan.writes.map((w) => ({ key: w.key, out: w.out, bytes: Buffer.byteLength(w.content, 'utf8') })) : written
    process.stdout.write(JSON.stringify({ written: planned, skipped: plan.skipped, refused: [], dryRun: DRY }, null, 2) + '\n')
  } else {
    process.stdout.write(
      `write-drafted-content: ${plan.writes.length} file(s) ${DRY ? 'planned (dry-run, not written)' : 'written'} under ${resolve(REPO)}` +
        (plan.skipped.length ? ` · ${plan.skipped.length} skipped` : '') +
        ` · gate cross-check: ${inputState}\n`
    )
    for (const w of plan.writes) {
      process.stdout.write(`  ${DRY ? 'would write' : 'wrote'}: ${w.out} (${Buffer.byteLength(w.content, 'utf8')} bytes)\n`)
    }
    for (const s of plan.skipped) {
      process.stdout.write(`  skipped: ${s.key}${s.out ? ` → ${s.out}` : ''} — ${s.reason}\n`)
    }
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

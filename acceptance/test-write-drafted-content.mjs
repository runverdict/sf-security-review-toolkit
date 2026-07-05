#!/usr/bin/env node
/**
 * Standing test for harness/write-drafted-content.mjs — the deterministic drafted-artifact
 * writer (B3c: the artifact Workflow returns { drafted: [{ key, out, content }] }; this
 * harness is the single write point — byte-exact, ALL-OR-NOTHING, and path-scoped, because
 * `out` round-trips through the Workflow and is LLM-influenced data crossing a WRITE
 * boundary).
 *
 * Guards:
 *   G1-G9  THE PATH GUARD, each refusal empirically: `../` traversal (with the
 *          all-or-nothing zero-writes proof — the valid sibling in the same envelope is
 *          NOT written), absolute path, `.git/hooks/pre-commit` (direct AND routed through
 *          an allowed root via `../..`), outside-allowed-roots, sibling-prefix escape
 *          (repo `<t>/r`, out resolving to `<t>/r-evil/x.md` — the `+ sep` containment),
 *          degenerate paths ('' / '.' / 'docs/security-review/../../x' / NUL), a
 *          symlinked dir inside the repo pointing outside, a PLANTED symlink FILE at the
 *          target (writeFileSync would follow it), and a dangling symlink on the path.
 *          Every refusal: exit 2, zero files written anywhere.
 *   R1-R6  write semantics — byte-exact roundtrip (backticks/quotes/newlines/$(cmd)/
 *          unicode/CRLF/no-trailing-newline; BUFFER compare, both allowed roots), both
 *          envelope shapes (raw task-output + pre-extracted) unwrap to the same bytes,
 *          idempotent re-run, the two-shape exit-2 error, overwrite-is-normal, mkdir -p.
 *   A1-A2  all-or-nothing structure — duplicate resolved targets refused; planWrites is
 *          read-only on the tree and deterministic.
 *   GC1-GC4 gate cross-check — a suppressed key is skipped LOUD (file absent, sibling
 *          written) via --input AND via the default input path; a present-but-corrupted
 *          input refuses loud; an empty-content entry is skipped loud and never blanks a
 *          pre-existing draft.
 *   D1-D2  --dry-run writes nothing and names every planned write; --json machine shape.
 *   E1-E2  empty drafted array = clean exit 0; a null entry is skipped loud, siblings written.
 *   P1-P6  markdown preamble strip — chatter above the first ATX H1 is stripped (the
 *          persisted file starts at the H1, bytes from the H1 onward identical);
 *          already-H1-first and no-H1 content byte-identical (never blanked/reshaped);
 *          an immediately-preceding front-matter block stays with the H1; non-markdown
 *          outputs verbatim (the .md gate, two-sided); idempotent, and content-only
 *          (a chatter-prefixed entry with an evil `out` is still refused, zero writes).
 *   W1-W4  wiring — generate-artifacts GRANTS + INVOKES the harness in step (d) (the
 *          hand-scripted extract-and-write is gone; WITHHELD stays driver-side);
 *          audit-codebase is untouched (its synthesis agent writes its own report — there
 *          is no improvised driver-side write there to replace).
 *
 * Dependency-free: `node acceptance/test-write-drafted-content.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  existsSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { planWrites, validateOut, stripPreamble, ALLOWED_ROOTS } from '../harness/write-drafted-content.mjs'

const PLUGIN = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(PLUGIN, 'harness', 'write-drafted-content.mjs')

let pass = 0
let fail = 0
const dirs = []
const check = (name, fn) => {
  try {
    fn()
    pass++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    fail++
    console.log(`  ✗ ${name}\n    ${e.message}`)
  }
}

const run = (args) => {
  try {
    const stdout = execFileSync('node', args, { encoding: 'utf8', stdio: 'pipe' })
    return { status: 0, stdout, stderr: '' }
  } catch (e) {
    return { status: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

// tmp fixture repo with the allowed roots pre-made; envelopes live OUTSIDE the repo so
// zero-writes assertions can count every file under the repo.
function makeRepo() {
  const d = mkdtempSync(join(tmpdir(), 'wdc-repo-'))
  dirs.push(d)
  mkdirSync(join(d, 'docs', 'security-review'), { recursive: true })
  mkdirSync(join(d, '.security-review'), { recursive: true })
  return d
}
function makeEnvDir() {
  const d = mkdtempSync(join(tmpdir(), 'wdc-env-'))
  dirs.push(d)
  return d
}
let envSeq = 0
function writeEnvelope(envDir, drafted, { raw = true } = {}) {
  const p = join(envDir, `result-${envSeq++}.json`)
  const body = raw ? { summary: 'artifact run', result: { drafted }, workflowProgress: { phases: [] } } : { drafted }
  writeFileSync(p, JSON.stringify(body, null, 2))
  return p
}
// recursive file list (Dirent.isDirectory() is false for symlinks — never recurses out)
const listFiles = (d) => {
  const out = []
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) out.push(...listFiles(p))
    else out.push(p)
  }
  return out
}

// deliberately hostile content: backticks, quotes, $(cmd), ${var}, unicode, CRLF, tabs,
// and NO trailing newline — the writer must not "help".
const TRICKY =
  'Line1 `backticks` "double" \'single\'\n' +
  '$(rm -rf /) ${HOME} \\n literal-backslash-n\n' +
  '\ttab\tindent\r\nCRLF-line\n' +
  'unicode: ✓ ↔ 日本語 émoji 🎯  nbsp\n' +
  'no trailing newline ends here'

console.log('write-drafted-content standing test')

// ───────────────────────────────────────────────── the path guard, empirically
check('G1 `../` traversal is refused — exit 2 AND the valid sibling in the same envelope is NOT written (all-or-nothing)', () => {
  const repo = makeRepo()
  const env = makeEnvDir()
  const before = listFiles(repo).length
  const res = run([
    CLI,
    '--repo',
    repo,
    '--result',
    writeEnvelope(env, [
      { key: 'good', out: 'docs/security-review/good.md', content: 'a valid draft' },
      { key: 'evil', out: '../../../home/user/.bashrc', content: 'alias ls=evil' },
    ]),
  ])
  assert.equal(res.status, 2)
  assert.match(res.stderr, /REFUSED: evil/)
  assert.match(res.stderr, /all-or-nothing/)
  assert.match(res.stderr, /Re-run the artifact engine/, 'refusal routes the operator to the engine')
  assert.ok(!/hand-edit output paths to make/.test(res.stderr.replace(/Do not hand-edit output paths to make a refused envelope pass/, '')), 'never suggests hand-editing paths to pass')
  assert.ok(!existsSync(join(repo, 'docs', 'security-review', 'good.md')), 'the VALID sibling was not written')
  assert.equal(listFiles(repo).length, before, 'zero files written anywhere under the repo')
})

check('G2 an absolute output path is refused', () => {
  const repo = makeRepo()
  const v = validateOut(repo, '/etc/cron.d/x')
  assert.equal(v.ok, false)
  assert.match(v.reason, /absolute output path/)
  const res = run([CLI, '--repo', repo, '--result', writeEnvelope(makeEnvDir(), [{ key: 'k', out: '/etc/cron.d/x', content: 'x' }])])
  assert.equal(res.status, 2)
  assert.equal(listFiles(repo).length, 0)
})

check('G3 `.git/hooks/pre-commit` is refused — directly AND routed through an allowed root via `../..`', () => {
  const repo = makeRepo()
  mkdirSync(join(repo, '.git', 'hooks'), { recursive: true })
  const direct = validateOut(repo, '.git/hooks/pre-commit')
  assert.equal(direct.ok, false)
  const routed = validateOut(repo, 'docs/security-review/../../.git/hooks/pre-commit')
  assert.equal(routed.ok, false)
  assert.match(routed.reason, /\.git is never a write target/)
  const res = run([CLI, '--repo', repo, '--result', writeEnvelope(makeEnvDir(), [{ key: 'k', out: '.git/hooks/pre-commit', content: '#!/bin/sh\necho pwned' }])])
  assert.equal(res.status, 2)
  assert.ok(!existsSync(join(repo, '.git', 'hooks', 'pre-commit')), 'no hook written')
})

check('G4 outside the allowed artifact roots is refused (src/x.md, docs/x.md, the root dirs themselves, repo-root files)', () => {
  const repo = makeRepo()
  for (const out of ['src/x.md', 'docs/x.md', 'README.md', 'docs/security-review', '.security-review']) {
    const v = validateOut(repo, out)
    assert.equal(v.ok, false, `'${out}' must be refused`)
  }
  assert.match(validateOut(repo, 'src/x.md').reason, /allowed artifact roots/)
  // and the allowed roots really are the two documented ones
  assert.deepEqual(ALLOWED_ROOTS, ['docs/security-review', '.security-review'])
})

check('G5 sibling-prefix escape — repo <t>/r, out resolving to <t>/r-evil/x.md — is refused (the `+ sep` containment)', () => {
  const base = mkdtempSync(join(tmpdir(), 'wdc-sib-'))
  dirs.push(base)
  const repo = join(base, 'r')
  mkdirSync(join(repo, 'docs', 'security-review'), { recursive: true })
  mkdirSync(join(base, 'r-evil'))
  const v = validateOut(repo, '../r-evil/x.md')
  assert.equal(v.ok, false)
  assert.match(v.reason, /outside the repository/)
  const res = run([CLI, '--repo', repo, '--result', writeEnvelope(makeEnvDir(), [{ key: 'k', out: '../r-evil/x.md', content: 'x' }])])
  assert.equal(res.status, 2)
  assert.equal(listFiles(join(base, 'r-evil')).length, 0, 'nothing landed in the sibling-prefix dir')
})

check("G6 degenerate paths are refused: '', '.', 'docs/security-review/../../x', NUL byte, non-string", () => {
  const repo = makeRepo()
  for (const out of ['', '   ', '.', 'docs/security-review/../../x', 'docs/security-review/a\0b.md', null, 42]) {
    const v = validateOut(repo, out)
    assert.equal(v.ok, false, `${JSON.stringify(out)} must be refused`)
  }
  assert.match(validateOut(repo, '.').reason, /repository root itself/)
})

check('G7 a symlinked dir inside the repo pointing OUTSIDE + an out through it is refused (realized re-assert)', () => {
  const repo = makeRepo()
  const outside = mkdtempSync(join(tmpdir(), 'wdc-outside-'))
  dirs.push(outside)
  symlinkSync(outside, join(repo, 'docs', 'security-review', 'link'))
  const v = validateOut(repo, 'docs/security-review/link/x.md')
  assert.equal(v.ok, false)
  assert.match(v.reason, /realized|outside the repository/)
  const res = run([CLI, '--repo', repo, '--result', writeEnvelope(makeEnvDir(), [{ key: 'k', out: 'docs/security-review/link/x.md', content: 'x' }])])
  assert.equal(res.status, 2)
  assert.equal(listFiles(outside).length, 0, 'nothing escaped through the symlink')
})

check('G8 a PLANTED symlink FILE at the target (writeFileSync would follow it) is refused; the outside file is untouched', () => {
  const repo = makeRepo()
  const outside = mkdtempSync(join(tmpdir(), 'wdc-outside-'))
  dirs.push(outside)
  const victim = join(outside, 'victim.txt')
  writeFileSync(victim, 'original bytes')
  symlinkSync(victim, join(repo, 'docs', 'security-review', 'x.md'))
  const res = run([CLI, '--repo', repo, '--result', writeEnvelope(makeEnvDir(), [{ key: 'k', out: 'docs/security-review/x.md', content: 'overwrite attempt' }])])
  assert.equal(res.status, 2)
  assert.equal(readFileSync(victim, 'utf8'), 'original bytes', 'the outside file was not written through the planted link')
})

check('G9 a dangling/broken symlink on the path is refused outright (realpath cannot vouch for the landing spot)', () => {
  const repo = makeRepo()
  symlinkSync(join(tmpdir(), 'wdc-nowhere', 'nope'), join(repo, 'docs', 'security-review', 'dangle.md'))
  const v = validateOut(repo, 'docs/security-review/dangle.md')
  assert.equal(v.ok, false)
  assert.match(v.reason, /broken\/dangling symlink/)
})

// ──────────────────────────────────────────────────────────── write semantics
check('R1 byte-exact roundtrip from the RAW envelope — hostile content, buffer compare, both allowed roots', () => {
  const repo = makeRepo()
  const res = run([
    CLI,
    '--repo',
    repo,
    '--result',
    writeEnvelope(makeEnvDir(), [
      { key: 'a', out: 'docs/security-review/a.md', content: TRICKY },
      { key: 'b', out: '.security-review/b.json', content: TRICKY },
    ]),
  ])
  assert.equal(res.status, 0)
  assert.match(res.stdout, /gate cross-check: absent/, 'no input file → no cross-check, said plainly')
  for (const p of [join(repo, 'docs', 'security-review', 'a.md'), join(repo, '.security-review', 'b.json')]) {
    assert.ok(readFileSync(p).equals(Buffer.from(TRICKY, 'utf8')), `${p} is byte-identical to the envelope string`)
  }
})

check('R2 the pre-extracted { drafted: [...] } shape unwraps to the same bytes as the raw envelope', () => {
  const repo = makeRepo()
  const res = run([CLI, '--repo', repo, '--result', writeEnvelope(makeEnvDir(), [{ key: 'a', out: 'docs/security-review/a.md', content: TRICKY }], { raw: false })])
  assert.equal(res.status, 0)
  assert.ok(readFileSync(join(repo, 'docs', 'security-review', 'a.md')).equals(Buffer.from(TRICKY, 'utf8')))
})

check('R3 idempotent re-run — same envelope twice, same bytes', () => {
  const repo = makeRepo()
  const envelope = writeEnvelope(makeEnvDir(), [{ key: 'a', out: 'docs/security-review/a.md', content: TRICKY }])
  assert.equal(run([CLI, '--repo', repo, '--result', envelope]).status, 0)
  const first = readFileSync(join(repo, 'docs', 'security-review', 'a.md'))
  assert.equal(run([CLI, '--repo', repo, '--result', envelope]).status, 0)
  assert.ok(readFileSync(join(repo, 'docs', 'security-review', 'a.md')).equals(first))
})

check('R4 neither envelope shape → exit 2 with the two-shape error naming BOTH accepted shapes', () => {
  const repo = makeRepo()
  const env = makeEnvDir()
  const p = join(env, 'bad.json')
  writeFileSync(p, JSON.stringify({ summary: 'x', result: { something_else: [] } }))
  const res = run([CLI, '--repo', repo, '--result', p])
  assert.equal(res.status, 2)
  assert.match(res.stderr, /RAW Workflow task-output envelope/)
  assert.match(res.stderr, /pre-extracted result object/)
  assert.match(res.stderr, /pass the task-output file as-is/)
  assert.equal(listFiles(repo).length, 0)
})

check('R5 overwrite is normal — artifacts regenerate per pass', () => {
  const repo = makeRepo()
  const target = join(repo, 'docs', 'security-review', 'a.md')
  writeFileSync(target, 'the prior pass draft')
  const res = run([CLI, '--repo', repo, '--result', writeEnvelope(makeEnvDir(), [{ key: 'a', out: 'docs/security-review/a.md', content: 'the new pass draft' }])])
  assert.equal(res.status, 0)
  assert.equal(readFileSync(target, 'utf8'), 'the new pass draft')
})

check('R6 parent dirs are mkdir -p’d inside the allowed roots', () => {
  const repo = makeRepo()
  const res = run([CLI, '--repo', repo, '--result', writeEnvelope(makeEnvDir(), [{ key: 'a', out: 'docs/security-review/sub/deep/a.md', content: 'nested' }])])
  assert.equal(res.status, 0)
  assert.equal(readFileSync(join(repo, 'docs', 'security-review', 'sub', 'deep', 'a.md'), 'utf8'), 'nested')
})

// ─────────────────────────────────────────────────── all-or-nothing structure
check('A1 two entries colliding on ONE resolved target are refused (never a silent last-write-wins)', () => {
  const repo = makeRepo()
  const plan = planWrites(repo, [
    { key: 'a', out: 'docs/security-review/same.md', content: 'first' },
    { key: 'b', out: 'docs/security-review/../security-review/same.md', content: 'second' },
  ])
  assert.equal(plan.refused.length, 1)
  assert.match(plan.refused[0].reason, /duplicate output path/)
  const res = run([
    CLI,
    '--repo',
    repo,
    '--result',
    writeEnvelope(makeEnvDir(), [
      { key: 'a', out: 'docs/security-review/same.md', content: 'first' },
      { key: 'b', out: 'docs/security-review/same.md', content: 'second' },
    ]),
  ])
  assert.equal(res.status, 2)
  assert.ok(!existsSync(join(repo, 'docs', 'security-review', 'same.md')))
})

check('A2 planWrites is READ-ONLY on the tree and deterministic (two calls, identical result, zero files)', () => {
  const repo = makeRepo()
  const entries = [
    { key: 'good', out: 'docs/security-review/good.md', content: 'ok' },
    { key: 'evil', out: '../escape.md', content: 'nope' },
    null,
    { key: 'empty', out: 'docs/security-review/empty.md', content: '   ' },
  ]
  const p1 = planWrites(repo, entries)
  const p2 = planWrites(repo, entries)
  assert.equal(JSON.stringify(p1), JSON.stringify(p2), 'deterministic given (repoRoot, entries, tree)')
  assert.equal(p1.writes.length, 1)
  assert.equal(p1.refused.length, 1)
  assert.equal(p1.skipped.length, 2)
  assert.equal(listFiles(repo).length, 0, 'planning wrote nothing')
})

// ─────────────────────────────────────────────────────────── gate cross-check
check('GC1 a gate-suppressed key in the envelope is SKIPPED LOUD via --input — file absent, sibling written', () => {
  const repo = makeRepo()
  const env = makeEnvDir()
  const inputPath = join(env, 'artifact-input.json')
  writeFileSync(inputPath, JSON.stringify({ gate: { mode: 'flagged', suppress: ['authn-authz-flow'] }, artifacts: [] }))
  const res = run([
    CLI,
    '--repo',
    repo,
    '--result',
    writeEnvelope(env, [
      { key: 'authn-authz-flow', out: 'docs/security-review/authn-authz-flow.md', content: 'a stale resurrected draft' },
      { key: 'data-flow-diagram', out: 'docs/security-review/data-flow-diagram.md', content: 'fine' },
    ]),
    '--input',
    inputPath,
  ])
  assert.equal(res.status, 0)
  assert.match(res.stdout, /skipped: authn-authz-flow .*withheld by the gate/)
  assert.match(res.stdout, /WITHHELD placeholder/, 'routes the driver to the placeholder it owns')
  assert.ok(!existsSync(join(repo, 'docs', 'security-review', 'authn-authz-flow.md')), 'the withheld doc was NOT resurrected')
  assert.equal(readFileSync(join(repo, 'docs', 'security-review', 'data-flow-diagram.md'), 'utf8'), 'fine')
})

check('GC2 the DEFAULT --input path (<repo>/.security-review/artifact-input.json) is honored without the flag', () => {
  const repo = makeRepo()
  writeFileSync(join(repo, '.security-review', 'artifact-input.json'), JSON.stringify({ gate: { suppress: ['withheld-doc'] } }))
  const res = run([CLI, '--repo', repo, '--result', writeEnvelope(makeEnvDir(), [{ key: 'withheld-doc', out: 'docs/security-review/w.md', content: 'x' }])])
  assert.equal(res.status, 0)
  assert.match(res.stdout, /gate cross-check: gate-checked/)
  assert.ok(!existsSync(join(repo, 'docs', 'security-review', 'w.md')))
})

check('GC3 a PRESENT-but-unparseable --input refuses loud (a typo must not silently drop the cross-check); nothing written', () => {
  const repo = makeRepo()
  const env = makeEnvDir()
  const inputPath = join(env, 'artifact-input.json')
  writeFileSync(inputPath, '{ not json')
  const res = run([CLI, '--repo', repo, '--result', writeEnvelope(env, [{ key: 'a', out: 'docs/security-review/a.md', content: 'x' }]), '--input', inputPath])
  assert.equal(res.status, 2)
  assert.match(res.stderr, /cannot parse --input/)
  assert.ok(!existsSync(join(repo, 'docs', 'security-review', 'a.md')))
})

check('GC4 an empty/whitespace-content entry is SKIPPED LOUD and never blanks an existing prior draft', () => {
  const repo = makeRepo()
  const prior = join(repo, 'docs', 'security-review', 'a.md')
  writeFileSync(prior, 'a good prior draft')
  const res = run([
    CLI,
    '--repo',
    repo,
    '--result',
    writeEnvelope(makeEnvDir(), [
      { key: 'a', out: 'docs/security-review/a.md', content: '   \n  ' },
      { key: 'b', out: 'docs/security-review/b.md', content: 'fine' },
    ]),
  ])
  assert.equal(res.status, 0)
  assert.match(res.stdout, /skipped: a .*empty\/non-string content/)
  assert.equal(readFileSync(prior, 'utf8'), 'a good prior draft', 'the dead agent did not erase the prior draft')
  assert.equal(readFileSync(join(repo, 'docs', 'security-review', 'b.md'), 'utf8'), 'fine')
})

// ──────────────────────────────────────────────────────────── dry-run / json
check('D1 --dry-run writes NOTHING and the summary names every planned write', () => {
  const repo = makeRepo()
  const res = run([
    CLI,
    '--repo',
    repo,
    '--result',
    writeEnvelope(makeEnvDir(), [
      { key: 'a', out: 'docs/security-review/a.md', content: 'x' },
      { key: 'b', out: '.security-review/b.json', content: 'y' },
    ]),
    '--dry-run',
  ])
  assert.equal(res.status, 0)
  assert.match(res.stdout, /dry-run, not written/)
  assert.match(res.stdout, /would write: docs\/security-review\/a\.md/)
  assert.match(res.stdout, /would write: \.security-review\/b\.json/)
  assert.equal(listFiles(repo).length, 0, 'dry-run wrote nothing')
})

check('D2 --json emits the machine shape: written[{key,out,bytes}], skipped[{key,out,reason}], refused, dryRun', () => {
  const repo = makeRepo()
  const res = run([
    CLI,
    '--repo',
    repo,
    '--result',
    writeEnvelope(makeEnvDir(), [
      { key: 'a', out: 'docs/security-review/a.md', content: TRICKY },
      { key: 'empty', out: 'docs/security-review/e.md', content: '' },
    ]),
    '--json',
  ])
  assert.equal(res.status, 0)
  const out = JSON.parse(res.stdout)
  assert.equal(out.dryRun, false)
  assert.deepEqual(out.refused, [])
  assert.equal(out.written.length, 1)
  assert.equal(out.written[0].key, 'a')
  assert.equal(out.written[0].out, 'docs/security-review/a.md')
  assert.equal(out.written[0].bytes, Buffer.byteLength(TRICKY, 'utf8'))
  assert.equal(out.skipped.length, 1)
  assert.equal(out.skipped[0].key, 'empty')
  // and on a refusal, --json still reports the machine shape with refused populated
  const bad = run([CLI, '--repo', repo, '--result', writeEnvelope(makeEnvDir(), [{ key: 'evil', out: '../x', content: 'x' }]), '--json'])
  assert.equal(bad.status, 2)
  const badOut = JSON.parse(bad.stdout)
  assert.deepEqual(badOut.written, [])
  assert.equal(badOut.refused.length, 1)
})

// ─────────────────────────────────────────────────────────────────── tolerance
check('E1 an empty drafted array is a clean exit 0 (0 written, said plainly)', () => {
  const repo = makeRepo()
  const res = run([CLI, '--repo', repo, '--result', writeEnvelope(makeEnvDir(), [])])
  assert.equal(res.status, 0)
  assert.match(res.stdout, /0 file\(s\) written/)
})

check('E2 a null/malformed entry is SKIPPED LOUD (named in the summary); siblings still write', () => {
  const repo = makeRepo()
  const res = run([
    CLI,
    '--repo',
    repo,
    '--result',
    writeEnvelope(makeEnvDir(), [null, { key: 'a', out: 'docs/security-review/a.md', content: 'ok' }, 'not-an-object']),
  ])
  assert.equal(res.status, 0)
  assert.match(res.stdout, /skipped: entry#0 — malformed entry/)
  assert.match(res.stdout, /skipped: entry#2 — malformed entry/)
  assert.equal(readFileSync(join(repo, 'docs', 'security-review', 'a.md'), 'utf8'), 'ok')
})

// ─────────────────────────────────────────── markdown preamble strip (P-series)
// deterministic leading-preamble strip: persisted markdown begins at its first ATX H1
// (an immediately-preceding front-matter block kept); no-H1 and non-markdown verbatim.
const CHATTER = 'I have everything I need. Drafting the artifact now.\n\nHere is the drafted artifact:\n'
const H1DOC = '# AuthN/AuthZ Flow\n\nBody with `backticks`, unicode ✓, and $(cmd).\nno trailing newline ends here'

check('P1 chatter above the H1 is stripped — the persisted file starts at the H1, bytes from the H1 onward identical', () => {
  assert.equal(stripPreamble(CHATTER + H1DOC), H1DOC, 'unit: everything above the first ATX H1 is dropped')
  const repo = makeRepo()
  const res = run([CLI, '--repo', repo, '--result', writeEnvelope(makeEnvDir(), [{ key: 'a', out: 'docs/security-review/a.md', content: CHATTER + H1DOC }])])
  assert.equal(res.status, 0)
  assert.ok(readFileSync(join(repo, 'docs', 'security-review', 'a.md')).equals(Buffer.from(H1DOC, 'utf8')), 'the written file begins at the H1 and is byte-identical from there')
})

check('P2 already-H1-first content is byte-identical (the strip is a no-op)', () => {
  assert.equal(stripPreamble(H1DOC), H1DOC)
  const repo = makeRepo()
  const res = run([CLI, '--repo', repo, '--result', writeEnvelope(makeEnvDir(), [{ key: 'a', out: 'docs/security-review/a.md', content: H1DOC }])])
  assert.equal(res.status, 0)
  assert.ok(readFileSync(join(repo, 'docs', 'security-review', 'a.md')).equals(Buffer.from(H1DOC, 'utf8')))
})

check('P3 no-H1 content is byte-identical — never blanked or reshaped', () => {
  assert.equal(stripPreamble(TRICKY), TRICKY, 'hostile no-H1 content untouched (CRLF + no-trailing-newline preserved)')
  const chatterOnly = 'Everything checks out.\n\nNothing else to add.\n'
  assert.equal(stripPreamble(chatterOnly), chatterOnly, 'a draft with no H1 anywhere is returned verbatim, never emptied')
  const repo = makeRepo()
  const res = run([CLI, '--repo', repo, '--result', writeEnvelope(makeEnvDir(), [{ key: 'a', out: 'docs/security-review/a.md', content: TRICKY }])])
  assert.equal(res.status, 0)
  assert.ok(readFileSync(join(repo, 'docs', 'security-review', 'a.md')).equals(Buffer.from(TRICKY, 'utf8')), 'the .md write path leaves no-H1 content verbatim')
})

check('P4 an immediately-preceding front-matter block stays with the H1 (only the chatter above it is stripped)', () => {
  const fmDoc = '---\nfm\n---\n# H1\nbody'
  assert.equal(stripPreamble('chatter\n\n' + fmDoc), fmDoc, 'output starts at the front-matter opener; front-matter + H1 kept')
  const repo = makeRepo()
  const res = run([CLI, '--repo', repo, '--result', writeEnvelope(makeEnvDir(), [{ key: 'a', out: 'docs/security-review/a.md', content: 'chatter\n\n' + fmDoc }])])
  assert.equal(res.status, 0)
  assert.equal(readFileSync(join(repo, 'docs', 'security-review', 'a.md'), 'utf8'), fmDoc)
})

check('P5 the strip is gated to markdown — a .json output with chatter above an H1-looking line is written VERBATIM', () => {
  const jsonish = 'preamble line a strip would drop\n# not-a-heading\n{"k":"v"}'
  const repo = makeRepo()
  const res = run([CLI, '--repo', repo, '--result', writeEnvelope(makeEnvDir(), [{ key: 'b', out: '.security-review/b.json', content: jsonish }])])
  assert.equal(res.status, 0)
  assert.ok(readFileSync(join(repo, '.security-review', 'b.json')).equals(Buffer.from(jsonish, 'utf8')), 'non-markdown is never stripped (the .md gate)')
})

check('P6 stripPreamble is idempotent AND content-only — a chatter-prefixed entry with an evil `out` is still refused, zero files written', () => {
  for (const input of [CHATTER + H1DOC, 'chatter\n\n---\nfm\n---\n# H1', TRICKY, H1DOC, '']) {
    assert.equal(stripPreamble(stripPreamble(input)), stripPreamble(input), 'strip(strip(x)) === strip(x)')
  }
  const repo = makeRepo()
  const before = listFiles(repo).length
  const res = run([CLI, '--repo', repo, '--result', writeEnvelope(makeEnvDir(), [{ key: 'evil', out: '../../x', content: CHATTER + H1DOC }])])
  assert.equal(res.status, 2, 'the content transform cannot rescue a poisoned path')
  assert.equal(listFiles(repo).length, before, 'zero files written anywhere under the repo')
})

// ─────────────────────────────────────────────────────────────────── wiring
const SKILL = readFileSync(join(PLUGIN, 'skills', 'generate-artifacts', 'SKILL.md'), 'utf8')
const fm = SKILL.split('---')[1] || ''
const allowed = fm.split('\n').find((l) => l.startsWith('allowed-tools:')) || ''

check('W1 generate-artifacts GRANTS the harness in allowed-tools', () => {
  assert.ok(allowed.includes('Bash(node *harness/write-drafted-content.mjs *)'), 'write-drafted-content grant present')
})

check('W2 step (d) INVOKES the harness (--result at the task-output file + --input for the gate cross-check); the hand-scripted extract-and-write is gone', () => {
  assert.ok(/write-drafted-content\.mjs\s+--repo <target>\s+--result <workflow-task-output-file>/.test(SKILL.replace(/\n\s+/g, ' ')), 'the exact command is in step (d)')
  assert.ok(SKILL.includes('--input <target>/.security-review/artifact-input.json'), 'the gate cross-check input is passed')
  assert.ok(!/\*\*\(d\) Write each `drafted\.content`/.test(SKILL), 'the improvised driver-side write instruction is gone')
  assert.ok(/DIRECTLY at the Workflow task-output file|task-output file DIRECTLY/.test(SKILL), 'same envelope doctrine as merge-ledger')
})

check('W3 the WITHHELD placeholder stays DRIVER-side (gate-data-derived, not envelope content)', () => {
  assert.ok(/WITHHELD placeholder driver-side/.test(SKILL), 'the placeholder write remains the driver’s')
  assert.ok(SKILL.includes('authn-authz-flow.WITHHELD.md'), 'the step-6 withhold flow is intact')
})

check('W4 audit-codebase is untouched — its synthesis agent writes its own report; no sibling harness was wired there', () => {
  const audit = readFileSync(join(PLUGIN, 'skills', 'audit-codebase', 'SKILL.md'), 'utf8')
  assert.ok(!audit.includes('write-drafted-content'), 'no write-drafted-content reference in audit-codebase')
  const template = readFileSync(join(PLUGIN, 'harness', 'workflow-template.mjs'), 'utf8')
  assert.ok(/Write the pass report to \$\{REPORT_PATH\}/.test(template), 'the audit synthesis agent still writes the report itself')
})

// ─────────────────────────────────────────────────────────────────── cleanup
for (const d of dirs) {
  try {
    rmSync(d, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

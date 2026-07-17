#!/usr/bin/env node
/*
 * test-repo-standard.mjs — the standing guard on this repo's front matter.
 *
 * Installed by the repo-standard-toolkit scaffolder, owned by THIS repo from then on: it runs
 * with Node built-ins alone (no npm install, no network, no AI tool), so the standard stays
 * enforced for every contributor on every push. The frequently-updated top-level markdown —
 * README, CHANGELOG, CONVENTIONS, and friends — is the repo's front matter; left un-linted it
 * drifts (a stale count, an ad-hoc CHANGELOG subsection, marketing creep). This test turns the
 * standard into an ENFORCED schema: the build fails the moment a meta doc drifts.
 *
 * The standards it encodes are published, not invented here:
 *   - CHANGELOG → Keep a Changelog 1.1.0 (keepachangelog.com): the SIX canonical change
 *     categories, grouped, one heading per category per version; [Unreleased] on top; concrete
 *     versions valid semver, newest first, in lockstep with the version manifest once released.
 *   - README → standard-readme (github.com/RichardLitt/standard-readme): one H1, a short
 *     description under 120 chars on its own line (banner/badges may sit between, per the
 *     spec's order), Install + Usage (waivable only by readme.docsOnly — the spec's own
 *     documentation-repository exception), Contributing, the spec's section order, a Table of
 *     Contents once past 100 lines, and License LAST. The tagline being BOLD is this
 *     standard's house addition on top of the spec, not a spec rule.
 *   - CONVENTIONS → contiguous numbered `## N.` sections (no gaps / dups).
 *   - Optional manifest doc → its Totals line MUST equal the table's own row counts.
 *   - Shared → machine-checked COUNTS match the real repo and agree across docs; a
 *     marketing-voice ban; no TODO(scaffold) markers left behind.
 *
 * The CANON above is hardcoded. `.repo-standard.json` (missing file = full defaults) tunes
 * SCOPE — which docs, which counts, extra banned words, extra required README sections — and
 * can disable a whole check only with a stated reason, printed loudly on every run. Unknown
 * config keys are hard errors: nothing here is ever silently ignored. Checks:
 *
 *   RS-config        the config parses, is version 1, and carries no unknown/malformed keys
 *                    (config errors are their own failure CLASS: they exit 2 before any doc
 *                    check runs — fix the config; doc drift exits 1 — fix the docs).
 *   RS-changelog     Keep a Changelog shape + the six canonical categories, grouped.
 *   RS-lockstep      newest dated CHANGELOG version === the version manifest (dormant pre-release).
 *   RS-readme        standard-readme structure; extra required sections from config.
 *   RS-conventions   numbered `## N.` sections contiguous 1..N (and >= minSections).
 *   RS-manifest      the declared manifest doc's Totals line reconciles with its own rows.
 *   RS-voice         the marketing-voice ban across the meta-doc set (+ extras).
 *   RS-counts        every declared count claim equals the derived repo fact and agrees across docs.
 *   RS-reflexivity   the CONVENTIONS doc documents the enforced vocabulary (lint ⟺ spec).
 *   RS-stable-docs   the stable meta files exist and open with an H1.
 *   RS-todos         no TODO(scaffold) marker survives in a governed doc.
 *   RS-license       a root license file exists, is non-empty, and — when its text is a
 *                    recognizable standard license — its id agrees with the license field of
 *                    each JSON manifest present (.claude-plugin/plugin.json, package.json)
 *                    and with the README's License section (unrecognized text is a loud named
 *                    skip, never a silent pass).
 *   RS-placeholders  no unfilled {{PLACEHOLDER}} token survives in a governed doc (a
 *                    hand-copied template bypasses fill-template's refusal; this catches it).
 *   RS-shadow        no governed doc exists in more than one GitHub-served location
 *                    (.github/ > root > docs/ — GitHub silently serves the highest-precedence
 *                    copy, so a duplicate is served drift the other checks cannot see).
 *
 * Freshness is never age-gated: this checks STRUCTURE + CONSISTENCY + machine-verifiable facts,
 * not "is the prose old". Dependency-free: `node acceptance/test-repo-standard.mjs`.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CONFIG_PATH = join(ROOT, '.repo-standard.json')

// The payload version this lint shipped with, printed on every run so a repo can always answer
// "which lint version governs me?". harness/sense-state.mjs parses this line from BOTH the
// committed copy and the plugin payload to DIRECT a re-run — upgrade (payload newer), downgrade
// (payload older: a stale plugin must never silently replace a newer committed lint), or
// local-edit (same version, different bytes). An acceptance test locks this constant to the
// plugin manifest version; keep the line's exact shape — the parser matches it literally.
const REPO_STANDARD_LINT_VERSION = '0.2.0'

// ───────────────────────────────────────────────────────────────── the hardcoded canon
const CHANGELOG_CATEGORIES = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']
// standard-readme: Install and Usage are "Required by default, optional for documentation
// repositories" (repos without functional code — see readme.docsOnly), Contributing and License
// are always required. The bold tagline is a HOUSE addition, not the spec's (the spec requires
// only a short description on its own line, not starting with "> ").
const README_CANON = ['Install', 'Usage', 'Contributing']
const README_CANON_DOCS_ONLY = ['Contributing']
// the spec's section order; a README's spec-known sections must appear in this relative order.
const README_ORDER = ['Security', 'Background', 'Install', 'Usage', 'API', 'Maintainers', 'Thanks', 'Contributing', 'License']
const BANNED_VOICE = ['simply', 'seamless', 'effortless', 'blazing', 'world-class', 'cutting-edge', 'revolutionary', 'game-chang', 'turnkey', 'best-in-class']
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const CHECK_IDS = ['changelog', 'lockstep', 'readme', 'conventions', 'manifest', 'voice', 'counts', 'reflexivity', 'stable-docs', 'todos', 'license', 'placeholders', 'shadow']

// ─────────────────────────────────────────────────────────────────────────── runner
let pass = 0, fail = 0, skip = 0
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) } }
const skipCheck = (name, why) => { skip++; console.log(`  – ${name} SKIP (${why})`) }

// a UTF-8 BOM is legal, invisible on GitHub, and the default from several Windows editors — it
// must never be the reason a compliant doc fails a `^#`-anchored check.
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/^﻿/, '')
const exists = (rel) => existsSync(join(ROOT, rel))
// markdown with fenced code blocks removed — a `### x` or banned word inside a fence is example
// text, never a heading or a voice violation. CommonMark §4.5: a fence is three-or-more
// backticks OR tildes (the tilde form is how you show a block containing backticks).
const FENCE_LINE = /^\s*(?:```|~~~)/
const stripFences = (text) => text.replace(/^[ \t]*(```|~~~)[\s\S]*?^[ \t]*\1[^\n]*$/gm, '').replace(/^[ \t]*(```|~~~)[\s\S]*$/m, '')
const h2s = (text) => [...text.matchAll(/^## +(.+?)\s*$/gm)].map((m) => m[1])

// minimal glob: literal directory path + one basename with `*` wildcards (e.g.
// `acceptance/test-*.mjs`). No `**`, no directory wildcards — declare deeper counts with
// { file, lineRegex } instead. Deliberately small enough to audit at a glance.
const globCount = (pattern) => {
  const slash = pattern.lastIndexOf('/')
  const dir = slash === -1 ? '.' : pattern.slice(0, slash)
  const base = pattern.slice(slash + 1)
  if (dir.includes('*')) throw new Error(`count glob "${pattern}": only the basename may carry '*'`)
  const re = new RegExp(`^${base.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
  const abs = join(ROOT, dir)
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return 0
  return readdirSync(abs).filter((f) => re.test(f) && statSync(join(abs, f)).isFile()).length
}

// ─────────────────────────────────────────────────────────── config: parse + validate
// Keys beginning with "//" are operator comments; "$schema" is an editor hint. Both ignored.
const isComment = (k) => k.startsWith('//') || k === '$schema'
const configErrors = []
const bad = (msg) => configErrors.push(msg)

const rawConfig = exists('.repo-standard.json') ? (() => {
  try { return JSON.parse(read('.repo-standard.json')) } catch (e) { bad(`.repo-standard.json is not valid JSON: ${e.message}`); return {} }
})() : {}

const KNOWN_TOP = ['version', 'docs', 'manifest', 'versionManifest', 'readme', 'conventions', 'voice', 'counts', 'stableDocs', 'checks', 'scaffold']
for (const k of Object.keys(rawConfig)) if (!isComment(k) && !KNOWN_TOP.includes(k)) bad(`unknown top-level key "${k}" (known: ${KNOWN_TOP.join(', ')})`)
if (exists('.repo-standard.json') && !configErrors.some((m) => m.includes('not valid JSON')) && rawConfig.version !== 1) {
  bad(`"version" must be the number 1 (got ${JSON.stringify(rawConfig.version)}) — a present config declares its format version`)
}

const sub = (obj, key, known) => {
  const v = obj?.[key]
  if (v === undefined || v === null) return {}
  if (typeof v !== 'object' || Array.isArray(v)) { bad(`"${key}" must be an object`); return {} }
  for (const k of Object.keys(v)) if (!isComment(k) && !known.includes(k)) bad(`unknown key "${key}.${k}" (known: ${known.join(', ')})`)
  return v
}
const strArray = (v, where) => {
  if (v === undefined) return []
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) { bad(`"${where}" must be an array of strings`); return [] }
  return v
}

const docsCfg = sub(rawConfig, 'docs', ['readme', 'changelog', 'conventions', 'extra'])
const readmeCfg = sub(rawConfig, 'readme', ['requireSections', 'docsOnly'])
const conventionsCfg = sub(rawConfig, 'conventions', ['minSections'])
const voiceCfg = sub(rawConfig, 'voice', ['extraBanned', 'properNouns', 'alsoScan'])
const checksCfg = sub(rawConfig, 'checks', CHECK_IDS)

const DOC = {
  readme: docsCfg.readme ?? 'README.md',
  changelog: docsCfg.changelog ?? 'CHANGELOG.md',
  conventions: docsCfg.conventions ?? 'CONVENTIONS.md',
}
// anti-decoy: the README the lint checks must be one GitHub actually renders as the front page —
// pointing the check at a stub nobody sees would hollow the standard while staying green.
if (!['README.md', 'docs/README.md', '.github/README.md'].includes(DOC.readme)) {
  bad(`"docs.readme" must be one of README.md, docs/README.md, .github/README.md (the paths GitHub renders) — got "${DOC.readme}"`)
}
// a non-string path is a CONFIG error (exit 2), not a crash at the first fs call: the ?? default
// only guards absent, never wrong-typed.
for (const k of ['changelog', 'conventions']) {
  if (typeof DOC[k] !== 'string') bad(`"docs.${k}" must be a string path — got ${JSON.stringify(docsCfg[k])}`)
}
const extraDocs = strArray(docsCfg.extra, 'docs.extra')

// manifest: false (default — no manifest doc) or { file, statuses }
let manifestCfg = rawConfig.manifest ?? false
if (manifestCfg !== false) {
  if (typeof manifestCfg !== 'object' || Array.isArray(manifestCfg)) { bad('"manifest" must be false or an object { file, statuses }'); manifestCfg = false }
  else {
    for (const k of Object.keys(manifestCfg)) if (!isComment(k) && !['file', 'statuses'].includes(k)) bad(`unknown key "manifest.${k}"`)
    if (typeof manifestCfg.file !== 'string') { bad('"manifest.file" must be a string path'); manifestCfg = false }
    else if (!Array.isArray(manifestCfg.statuses) || manifestCfg.statuses.length === 0 || manifestCfg.statuses.some((s) => typeof s !== 'string')) { bad('"manifest.statuses" must be a non-empty array of strings'); manifestCfg = false }
  }
}

// versionManifest: undefined (auto-detect) | false (loud skip) | path to a JSON manifest with
// .version | { file, match } where match's first capture extracts the version.
let versionManifest = rawConfig.versionManifest
if (versionManifest !== undefined && versionManifest !== false && typeof versionManifest !== 'string' && !(typeof versionManifest === 'object' && !Array.isArray(versionManifest) && typeof versionManifest?.file === 'string' && typeof versionManifest?.match === 'string')) {
  bad('"versionManifest" must be false, a path string, or { file, match }')
  versionManifest = false
}
if (typeof versionManifest === 'object' && versionManifest !== null) {
  try { new RegExp(versionManifest.match, 'm') } catch (e) { bad(`"versionManifest.match" does not compile: ${e.message}`) }
}

const requireSections = strArray(readmeCfg.requireSections, 'readme.requireSections')
for (const req of requireSections) {
  try { new RegExp(req, 'i') } catch (e) { bad(`"readme.requireSections" entry "${req}" does not compile: ${e.message}`) }
}
// the spec's OWN exception, not a weakening: a documentation repository ("repositories without
// any functional code") may omit Install/Usage. Everything else still applies.
const docsOnly = readmeCfg.docsOnly ?? false
if (typeof docsOnly !== 'boolean') bad('"readme.docsOnly" must be a boolean (true only for a repo with no functional code — standard-readme\'s documentation-repository exception)')
const minSections = conventionsCfg.minSections ?? 1
if (!Number.isInteger(minSections) || minSections < 1) bad('"conventions.minSections" must be an integer >= 1')
const extraBanned = strArray(voiceCfg.extraBanned, 'voice.extraBanned')
const properNouns = strArray(voiceCfg.properNouns, 'voice.properNouns')
const alsoScan = strArray(voiceCfg.alsoScan, 'voice.alsoScan')
const stableDocs = rawConfig.stableDocs !== undefined ? strArray(rawConfig.stableDocs, 'stableDocs') : ['SECURITY.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md']

// counts: object keyed by stable id →
//   { pattern, docs?, glob? | file+lineRegex?, under?, minMentions? }
// `under` restricts the scan to the region below the first heading whose text matches it (to the
// next heading of the same or higher level) — so a historical number in an old CHANGELOG release
// block stays historical instead of failing forever once the live count moves on.
const countsCfg = rawConfig.counts ?? {}
const counts = []
if (typeof countsCfg !== 'object' || Array.isArray(countsCfg)) bad('"counts" must be an object keyed by count id')
else {
  for (const [id, spec] of Object.entries(countsCfg)) {
    if (isComment(id)) continue
    if (typeof spec !== 'object' || Array.isArray(spec)) { bad(`"counts.${id}" must be an object`); continue }
    for (const k of Object.keys(spec)) if (!isComment(k) && !['pattern', 'docs', 'glob', 'file', 'lineRegex', 'under', 'minMentions'].includes(k)) bad(`unknown key "counts.${id}.${k}"`)
    if (typeof spec.pattern !== 'string') { bad(`"counts.${id}.pattern" is required (a regex with one capture group for the number)`); continue }
    let re
    try { re = new RegExp(spec.pattern, 'g') } catch (e) { bad(`"counts.${id}.pattern" does not compile: ${e.message}`); continue }
    // the alternation trick: /pattern|/ matches '' with every group present-but-undefined,
    // so the match-array length counts the capture groups without parsing the regex.
    if (new RegExp(spec.pattern + '|').exec('').length - 1 < 1) { bad(`"counts.${id}.pattern" needs a capture group for the number (group 1 is compared)`); continue }
    const hasGlob = spec.glob !== undefined, hasFile = spec.file !== undefined || spec.lineRegex !== undefined
    if (hasGlob && hasFile) { bad(`"counts.${id}" declares both glob and file/lineRegex — pick one source`); continue }
    if ((spec.file === undefined) !== (spec.lineRegex === undefined)) { bad(`"counts.${id}" needs both file and lineRegex, or neither`); continue }
    // validate every sibling HERE, so a malformed one is a config error (exit 2) rather than an
    // exception surfacing later as a doc-drift failure (exit 1) and blaming the wrong file.
    if (spec.glob !== undefined && typeof spec.glob !== 'string') { bad(`"counts.${id}.glob" must be a string pattern`); continue }
    if (spec.file !== undefined && typeof spec.file !== 'string') { bad(`"counts.${id}.file" must be a string path`); continue }
    if (spec.lineRegex !== undefined) {
      if (typeof spec.lineRegex !== 'string') { bad(`"counts.${id}.lineRegex" must be a regex string`); continue }
      try { new RegExp(spec.lineRegex, 'gm') } catch (e) { bad(`"counts.${id}.lineRegex" does not compile: ${e.message}`); continue }
    }
    if (spec.minMentions !== undefined && (!Number.isInteger(spec.minMentions) || spec.minMentions < 1)) bad(`"counts.${id}.minMentions" must be an integer >= 1`)
    let underRe = null
    if (spec.under !== undefined) {
      if (typeof spec.under !== 'string') { bad(`"counts.${id}.under" must be a regex string over heading text`); continue }
      try { underRe = new RegExp(spec.under) } catch (e) { bad(`"counts.${id}.under" does not compile: ${e.message}`); continue }
    }
    counts.push({ id, pattern: re, docs: spec.docs !== undefined ? strArray(spec.docs, `counts.${id}.docs`) : null, glob: spec.glob, file: spec.file, lineRegex: spec.lineRegex, under: underRe, minMentions: spec.minMentions })
  }
}

// scaffold: provenance the scaffold skill records — which plugin version produced this repo's
// governance and the operator's confirmed answers, so a re-run pre-fills instead of re-asking
// and "which standard version governs this repo?" is answerable from the repo alone. The lint
// validates only the SHAPE; it never acts on the content — enforcement stays version-blind.
const scaffoldCfg = sub(rawConfig, 'scaffold', ['pluginVersion', 'answers'])
if (scaffoldCfg.pluginVersion !== undefined && !(typeof scaffoldCfg.pluginVersion === 'string' && SEMVER.test(scaffoldCfg.pluginVersion))) {
  bad(`"scaffold.pluginVersion" must be a semver string — got ${JSON.stringify(scaffoldCfg.pluginVersion)}`)
}
if (scaffoldCfg.answers !== undefined) {
  if (typeof scaffoldCfg.answers !== 'object' || Array.isArray(scaffoldCfg.answers) || scaffoldCfg.answers === null) bad('"scaffold.answers" must be an object of PLACEHOLDER → value strings')
  else for (const [k, v] of Object.entries(scaffoldCfg.answers)) {
    if (isComment(k)) continue
    if (!/^[A-Z0-9_]+$/.test(k)) bad(`"scaffold.answers.${k}" — keys are template placeholder names ([A-Z0-9_]+)`)
    else if (typeof v !== 'string') bad(`"scaffold.answers.${k}" must be a string`)
  }
}

// checks.<id>: only { enabled: false, why: "<non-empty>" } is meaningful; anything else is an error.
const disabled = {}
for (const [id, v] of Object.entries(checksCfg)) {
  if (isComment(id)) continue
  if (typeof v !== 'object' || Array.isArray(v) || v.enabled !== false || typeof v.why !== 'string' || !v.why.trim()) {
    bad(`"checks.${id}" must be { "enabled": false, "why": "<non-empty reason>" } — a check is on by default and cannot be silently weakened`)
    continue
  }
  disabled[id] = v.why.trim()
}

// the meta-doc set: the frequently-updated docs the voice ban and count scans sweep.
const metaDocs = [DOC.readme, DOC.changelog, DOC.conventions, ...(manifestCfg ? [manifestCfg.file] : []), ...extraDocs]

console.log(`repo-standard standing test v${REPO_STANDARD_LINT_VERSION} (config: ${exists('.repo-standard.json') ? '.repo-standard.json' : 'defaults — no .repo-standard.json'})`)
for (const [id, why] of Object.entries(disabled)) if (CHECK_IDS.includes(id)) console.log(`  ! ${id} is DISABLED in config: ${why}`)
for (const noun of properNouns) console.log(`  ! voice exemption active (properNouns): "${noun}"`)

// config errors are their own failure class: report every one, then exit 2 WITHOUT running the
// doc checks — a doc verdict computed under a broken config would be noise, and exit 2 vs 1
// tells the operator which file to fix (.repo-standard.json vs the docs).
if (configErrors.length) {
  console.log(`  ✗ RS-config the config parses, is version 1, and carries no unknown or malformed keys`)
  for (const e of configErrors) console.log(`      - ${e}`)
  console.log(`\nconfig errors: ${configErrors.length} — fix .repo-standard.json (exit 2; doc checks not run)`)
  process.exit(2)
}
check('RS-config the config parses, is version 1, and carries no unknown or malformed keys', () => {})

const gate = (id, name, fn) => {
  if (disabled[id]) return skipCheck(`RS-${id}`, `disabled in config: ${disabled[id]}`)
  check(name, fn)
}

// ─────────────────────────────────────────────────────────────────────── RS-changelog
const clRaw = exists(DOC.changelog) ? read(DOC.changelog) : null
const clHeadings = clRaw ? [...stripFences(clRaw).matchAll(/^##\s+\[([^\]]+)\]/gm)].map((m) => m[1]) : []
const clVersions = clHeadings.filter((h) => h.toLowerCase() !== 'unreleased')

gate('changelog', `RS-changelog ${DOC.changelog} follows Keep a Changelog: [Unreleased] + the six categories, grouped`, () => {
  assert.ok(clRaw !== null, `${DOC.changelog} must exist`)
  const cl = stripFences(clRaw)
  assert.match(cl, /^#\s+Changelog/m, `${DOC.changelog} must open with a top-level "# Changelog" title`)
  assert.match(cl, /keepachangelog\.com/i, `${DOC.changelog} must name the Keep a Changelog format it follows`)
  assert.ok(clHeadings.some((h) => h.toLowerCase() === 'unreleased'), `${DOC.changelog} must carry an [Unreleased] section`)
  assert.equal(clHeadings[0]?.toLowerCase(), 'unreleased', `${DOC.changelog}: [Unreleased] must be the FIRST version heading (Keep a Changelog: "Keep an Unreleased section at the top") — found [${clHeadings[0]}] first`)
  // every H2 is a `## [token]` heading — Keep a Changelog has no other H2 vocabulary — and
  // every DATED version displays its ISO release date (spec: "Release dates must be displayed")
  for (const m of cl.matchAll(/^## +(.+?)\s*$/gm)) {
    assert.match(m[1], /^\[[^\]]+\]/, `${DOC.changelog} H2 "## ${m[1]}" is not a version heading — Keep a Changelog allows only "## [Unreleased]" / "## [x.y.z] - YYYY-MM-DD"`)
    if (!/^\[unreleased\]/i.test(m[1])) {
      // the optional trailing [YANKED] tag is the spec's own vocabulary for a pulled release —
      // "## [0.0.5] - 2014-12-13 [YANKED]" — and ONLY that tag: any other suffix is drift.
      assert.match(m[1], /^\[[^\]]+\]\s+[-–—]\s+\d{4}-\d{2}-\d{2}(?:\s+\[YANKED\])?$/, `${DOC.changelog} version heading "## ${m[1]}" must display its ISO release date: "## [x.y.z] - YYYY-MM-DD" (Keep a Changelog; a pulled release appends " [YANKED]", nothing else)`)
    }
  }
  for (const v of clVersions) assert.match(v, SEMVER, `version heading "[${v}]" is not valid semver`)
  assert.equal(new Set(clVersions).size, clVersions.length, `${DOC.changelog} repeats a version heading — one section per version (Keep a Changelog)`)
  // descending order, per semver §11: compare the numeric triple, then a prerelease is OLDER
  // than its release, then compare prerelease identifiers left to right (numeric numerically,
  // alphanumeric by ASCII, numeric < alphanumeric, and a longer identifier list wins a tie) —
  // an rc.1 / rc.9 / beta.1 chain is exactly where changelog ordering drifts.
  const cmpPre = (a, b) => {
    const ia = a.split('.'), ib = b.split('.')
    for (let i = 0; i < Math.max(ia.length, ib.length); i++) {
      if (ia[i] === undefined) return -1
      if (ib[i] === undefined) return 1
      const na = /^\d+$/.test(ia[i]), nb = /^\d+$/.test(ib[i])
      if (na && nb) { const d = Number(ia[i]) - Number(ib[i]); if (d) return d < 0 ? -1 : 1; continue }
      if (na !== nb) return na ? -1 : 1
      if (ia[i] !== ib[i]) return ia[i] < ib[i] ? -1 : 1
    }
    return 0
  }
  const cmp = (a, b) => {
    const pa = a.split('-')[0].split('.').map(Number), pb = b.split('-')[0].split('.').map(Number)
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
    const preA = a.includes('-'), preB = b.includes('-')
    if (preA !== preB) return preA ? -1 : 1
    if (!preA) return 0
    return cmpPre(a.slice(a.indexOf('-') + 1), b.slice(b.indexOf('-') + 1))
  }
  for (let i = 1; i < clVersions.length; i++) assert.ok(cmp(clVersions[i - 1], clVersions[i]) >= 0, `versions must descend (newest first): [${clVersions[i - 1]}] appears before [${clVersions[i]}]`)
  // the six canonical categories, grouped, one heading per category per version block —
  // and NOTHING deeper: Keep a Changelog's vocabulary is ## versions + ### categories, so an
  // ad-hoc `#### Breaking Changes` is the same drift one level down.
  for (const block of cl.split(/^## /m).slice(1)) {
    const heading = block.split('\n', 1)[0].trim()
    const seen = new Set()
    for (const m of block.matchAll(/^(#{3,6}) +(.+?)\s*$/gm)) {
      assert.equal(m[1], '###', `section "${heading}" has a "${m[1]} ${m[2]}" heading — Keep a Changelog allows only ### category subsections under a version`)
      const c = m[2].trim()
      assert.ok(CHANGELOG_CATEGORIES.includes(c), `section "${heading}" has a non-canonical subsection "### ${c}" — use only ${CHANGELOG_CATEGORIES.join(' / ')} (Keep a Changelog)`)
      assert.ok(!seen.has(c), `section "${heading}" repeats "### ${c}" — group all ${c} entries under one heading`)
      seen.add(c)
    }
  }
  // anti-decoy: config may relocate the changelog, but a root CHANGELOG.md must then not exist —
  // a pristine configured copy must not shadow the file contributors actually open.
  if (DOC.changelog !== 'CHANGELOG.md') {
    assert.ok(!exists('CHANGELOG.md'), `docs.changelog points at ${DOC.changelog} but a root CHANGELOG.md also exists — one changelog only; the root copy would shadow the governed one`)
  }
})

// ──────────────────────────────────────────────────────────────────────── RS-lockstep
const lockstepPath = versionManifest === false ? null
  : typeof versionManifest === 'string' ? versionManifest
  : typeof versionManifest === 'object' && versionManifest !== null ? versionManifest.file
  : ['.claude-plugin/plugin.json', 'package.json'].find((p) => exists(p)) ?? null

if (lockstepPath === null) {
  skipCheck('RS-lockstep', versionManifest === false
    ? 'disabled: "versionManifest" is false in config'
    : 'no version manifest found (auto-detect looks for .claude-plugin/plugin.json, package.json) — set "versionManifest" to a path, or false to silence')
} else gate('lockstep', `RS-lockstep newest dated CHANGELOG version === ${lockstepPath} (dormant pre-release)`, () => {
  assert.ok(exists(lockstepPath), `versionManifest "${lockstepPath}" does not exist`)
  let manifestVersion
  if (typeof versionManifest === 'object' && versionManifest !== null) {
    const m = read(lockstepPath).match(new RegExp(versionManifest.match, 'm'))
    assert.ok(m && m[1], `versionManifest.match "${versionManifest.match}" captured no version from ${lockstepPath}`)
    manifestVersion = m[1]
  } else {
    manifestVersion = JSON.parse(read(lockstepPath)).version
  }
  assert.match(String(manifestVersion), SEMVER, `${lockstepPath} version "${manifestVersion}" is not valid semver`)
  if (clVersions.length === 0) return // pre-first-release: the lockstep engages at the first dated version
  assert.equal(clVersions[0], manifestVersion, `newest CHANGELOG version [${clVersions[0]}] must equal ${lockstepPath} version ${manifestVersion} — bump both in lockstep when cutting a release`)
})

// ────────────────────────────────────────────────────────────────────────── RS-readme
gate('readme', `RS-readme ${DOC.readme} structure — one H1, bold tagline, Install + Contributing, License LAST`, () => {
  assert.ok(exists(DOC.readme), `${DOC.readme} must exist`)
  // HTML comments come out alongside fences: a maintainer note renders as nothing, so it can
  // hold neither a hidden heading nor the short description.
  const rm = stripFences(read(DOC.readme)).replace(/<!--[\s\S]*?-->/g, '')
  // setext headings would let content render as a heading this ATX-based lint cannot see —
  // require ATX so what the lint checks is what GitHub renders. ('='-underline is unambiguous;
  // the '-' form is left alone: it collides with tables and frontmatter.)
  const lines = rm.split('\n')
  lines.forEach((l, i) => {
    if (/^=+\s*$/.test(l) && i > 0 && lines[i - 1].trim()) throw new Error(`${DOC.readme}:${i + 1} uses a setext ('=' underline) heading — use ATX (#) headings; the lint and the standard read ATX only`)
  })
  const h1sFound = [...rm.matchAll(/^# +.+$/gm)]
  assert.equal(h1sFound.length, 1, `${DOC.readme} must have exactly one H1 (found ${h1sFound.length})`)
  // standard-readme's order is Title → Banner (optional) → Badges (optional) → Short
  // Description, so image/badge lines between the H1 and the description are CANONICAL — skip
  // them rather than mistaking one for the description.
  // the banner/badge run between the Title and the Short Description — badge links, images, and
  // the HTML wrappers the centered-banner idiom uses (`<p align="center">` … `</p>`).
  const isBadgeOrBanner = (l) => /^\[!\[.*\]\(.*\)\]\(.*\)$/.test(l) || /^!\[.*\]\(.*\)$/.test(l)
    || /^(\[!\[|!\[).*(\)|\])\s*(\[!\[|!\[).*$/.test(l) || /^<\/?[a-z][^>]*>$/i.test(l) || /^<img\s/.test(l)
  const afterH1 = rm.slice(h1sFound[0].index + h1sFound[0][0].length).split('\n').map((l) => l.trim())
    .filter((l) => l && !isBadgeOrBanner(l))[0] || ''
  // The spec requires a short description on its own line that does not start with "> ".
  // The BOLD is this standard's own house addition on top of the spec (a tagline should read
  // as one), documented as such — not attributed to standard-readme.
  assert.ok(!afterH1.startsWith('>'), `${DOC.readme}: the short description under the H1 must not be a blockquote (standard-readme) — found: "${afterH1.slice(0, 60)}"`)
  assert.ok(afterH1.startsWith('**'), `${DOC.readme} needs a bold tagline (the short description) right after the H1 — house addition on top of standard-readme (found: "${afterH1.slice(0, 60)}")`)
  // standard-readme: "Must be less than 120 characters." Measured on the description itself,
  // not the `**` bold markers this standard adds around it.
  const descLen = afterH1.replace(/^\*\*|\*\*$/g, '').length
  assert.ok(descLen < 120, `${DOC.readme}: the short description must be less than 120 characters (standard-readme) — found ${descLen}`)
  const sections = h2s(rm)
  assert.ok(sections.length > 0, `${DOC.readme} must have H2 sections`)
  const canon = docsOnly ? README_CANON_DOCS_ONLY : README_CANON
  for (const req of canon) assert.ok(sections.some((s) => new RegExp(`^${req}`, 'i').test(s)), `${DOC.readme} must have a ${req} section (standard-readme)${req === 'Usage' || req === 'Install' ? ' — or set readme.docsOnly if this repo has no functional code' : ''}`)
  // the spec: "Sections must appear in order given below." — the spec-known sections a README
  // does carry must be in the spec's relative order (unknown/extra sections are free).
  const known = sections.map((s) => README_ORDER.findIndex((k) => new RegExp(`^${k}`, 'i').test(s))).filter((i) => i !== -1)
  for (let i = 1; i < known.length; i++) {
    assert.ok(known[i] >= known[i - 1], `${DOC.readme}: "${README_ORDER[known[i]]}" appears after "${README_ORDER[known[i - 1]]}" — standard-readme fixes the section order (${README_ORDER.join(' → ')})`)
  }
  // the spec: a Table of Contents is required once a README passes 100 lines.
  if (read(DOC.readme).split('\n').length >= 100) {
    assert.ok(sections.some((s) => /table of contents|^contents$/i.test(s)), `${DOC.readme} is ${read(DOC.readme).split('\n').length} lines — standard-readme requires a Table of Contents on any README of 100+ lines`)
  }
  for (const req of requireSections) {
    let re
    try { re = new RegExp(req, 'i') } catch (e) { throw new Error(`readme.requireSections entry "${req}" does not compile: ${e.message}`) }
    assert.ok(sections.some((s) => re.test(s)), `${DOC.readme} is missing a required section matching /${req}/i (readme.requireSections)`)
  }
  assert.match(sections[sections.length - 1], /license/i, `${DOC.readme}: the License section must be LAST (standard-readme) — found "${sections[sections.length - 1]}"`)
  // the License section must SAY something — a bare heading is not a license statement.
  const licenseBody = rm.slice(rm.lastIndexOf(`## ${sections[sections.length - 1]}`)).split('\n').slice(1).join('\n')
  assert.ok(licenseBody.trim().length > 0, `${DOC.readme}: the License section is empty — state the license (e.g. "Apache-2.0 © <holder>. See LICENSE.")`)
})

// ─────────────────────────────────────────────────────────────────── RS-conventions
gate('conventions', `RS-conventions ${DOC.conventions} numbered \`## N.\` sections are contiguous 1..N`, () => {
  assert.ok(exists(DOC.conventions), `${DOC.conventions} must exist`)
  if (DOC.conventions !== 'CONVENTIONS.md') {
    assert.ok(!exists('CONVENTIONS.md'), `docs.conventions points at ${DOC.conventions} but a root CONVENTIONS.md also exists — one conventions doc only; the root copy would shadow the governed one`)
  }
  const nums = [...stripFences(read(DOC.conventions)).matchAll(/^## +(\d+)\. /gm)].map((m) => Number(m[1]))
  assert.ok(nums.length >= minSections, `${DOC.conventions} must carry at least ${minSections} numbered \`## N.\` section${minSections === 1 ? '' : 's'} (found ${nums.length})`)
  nums.forEach((n, i) => assert.equal(n, i + 1, `${DOC.conventions} numbering breaks at §${n} (expected §${i + 1}) — sections must be contiguous, no gaps or duplicates`))
})

// ─────────────────────────────────────────────────────────────────────── RS-manifest
if (!manifestCfg) {
  if (!disabled.manifest) skipCheck('RS-manifest', 'no manifest doc declared in config')
  else skipCheck('RS-manifest', `disabled in config: ${disabled.manifest}`)
} else gate('manifest', `RS-manifest ${manifestCfg.file} Totals line reconciles with the table's own row counts`, () => {
  assert.ok(exists(manifestCfg.file), `${manifestCfg.file} must exist (declared as "manifest.file")`)
  const cm = read(manifestCfg.file)
  const statuses = manifestCfg.statuses
  // Totals: **A S1 · B S2 · … · T total.** — built from the declared status vocabulary
  const totalsRe = new RegExp(`Totals:\\s*\\*\\*${statuses.map((s) => `(\\d[\\d,]*) ${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).join(' · ')} · (\\d[\\d,]*) total\\.\\*\\*`)
  const m = cm.match(totalsRe)
  assert.ok(m, `${manifestCfg.file} must carry a \`Totals: **${statuses.map((s) => `A ${s}`).join(' · ')} · T total.**\` line matching its declared statuses`)
  const nums = m.slice(1).map((n) => Number(n.replace(/,/g, '')))
  const total = nums.pop()
  // only TABLE rows count: a line must start with '|' to be a row — prose that happens to
  // contain "| NEW |" mid-sentence is not inventory. Cells are compared parsed-and-trimmed, so
  // a column-aligned table (`| NEW       |` — what every markdown formatter emits, and what
  // GitHub renders identically) counts the same as a compact one.
  const rowLines = cm.split('\n').filter((l) => l.trimStart().startsWith('|'))
  const cellsOf = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
  let sum = 0
  statuses.forEach((s, i) => {
    const rows = rowLines.filter((l) => cellsOf(l).includes(s)).length
    assert.equal(nums[i], rows, `Totals says ${nums[i]} ${s} but the table has ${rows} \`${s}\` rows`)
    sum += rows
  })
  assert.equal(total, sum, `Totals total ${total} != the row sum ${sum}`)
})

// ────────────────────────────────────────────────────────────────────────── RS-voice
gate('voice', 'RS-voice the marketing-voice ban holds across the meta-doc set', () => {
  const banned = [...BANNED_VOICE, ...extraBanned.map((w) => w.toLowerCase())]
  for (const doc of [...metaDocs, ...alsoScan]) {
    if (!exists(doc)) continue // presence is each structural check's job; voice scans what exists
    let inFence = false
    read(doc).split('\n').forEach((line, i) => {
      if (FENCE_LINE.test(line)) { inFence = !inFence; return }
      if (inFence) return
      // strip quoted / backticked spans — a doc may NAME a banned word ("no \"simply\"")
      // without USING it; a real marketing use is unquoted prose. Single quotes strip only
      // when both delimiters sit outside words, so the apostrophes in "it's ... you'd" can
      // never swallow the prose between them.
      let bare = line
        .replace(/"[^"]*"|`[^`]*`/g, '')
        .replace(/(?<![A-Za-z0-9])'[^']*'(?![A-Za-z0-9])/g, '')
      // properNouns: an exact, case-sensitive product/proper name (a tool literally called
      // "Seamless") is a mention, not marketing voice — each active exemption prints in the
      // run header so it can never hide.
      for (const noun of properNouns) bare = bare.split(noun).join('')
      for (const word of banned) {
        // hyphenated terms match their spaced/hyphenated variants alike: "world-class",
        // "world class", and "world  class" are the same marketing voice.
        const safe = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/-/g, '[\\s-]+')
        assert.ok(!new RegExp(`\\b${safe}`, 'i').test(bare), `${doc}:${i + 1} uses banned marketing voice "${word}": ${line.trim().slice(0, 70)}`)
      }
    })
  }
})

// ────────────────────────────────────────────────────────────────────────── RS-counts
if (counts.length === 0) {
  if (!disabled.counts) skipCheck('RS-counts', '0 counts declared in config — declare each machine-checkable numeric claim')
  else skipCheck('RS-counts', `disabled in config: ${disabled.counts}`)
} else gate('counts', `RS-counts ${counts.length === 1 ? 'the 1 declared count claim matches the repo and agrees' : `all ${counts.length} declared count claims match the repo and agree`} across docs`, () => {
  for (const c of counts) {
    let truth = null
    if (c.glob !== undefined) truth = globCount(c.glob)
    else if (c.file !== undefined) {
      assert.ok(exists(c.file), `counts.${c.id}: source file ${c.file} does not exist`)
      truth = (read(c.file).match(new RegExp(c.lineRegex, 'gm')) || []).length
    }
    const scanDocs = c.docs ?? metaDocs
    const found = []
    for (const doc of scanDocs) {
      assert.ok(exists(doc), `counts.${c.id}: doc ${doc} does not exist`)
      let text = stripFences(read(doc))
      if (c.under) {
        // scan only the region below the first heading whose TEXT matches `under`, up to the
        // next heading of the same or higher level — historical numbers outside it stay history.
        const headings = [...text.matchAll(/^(#{1,6}) +(.+?)\s*$/gm)]
        const start = headings.find((h) => c.under.test(h[2]))
        if (!start) { continue } // region absent in this doc → no mentions here, not an error
        const level = start[1].length
        const end = headings.find((h) => h.index > start.index && h[1].length <= level)
        text = text.slice(start.index, end ? end.index : undefined)
      }
      for (const m of text.matchAll(new RegExp(c.pattern.source, 'g'))) {
        const n = Number(String(m[1]).replace(/,/g, ''))
        assert.ok(Number.isFinite(n), `counts.${c.id}: pattern matched "${m[0]}" in ${doc} but captured no number`)
        found.push({ doc, n, text: m[0] })
      }
    }
    if (truth !== null) for (const f of found) assert.ok(f.n === truth, `counts.${c.id}: ${f.doc} states "${f.text}" but the repo derives ${truth}`)
    const distinct = [...new Set(found.map((f) => f.n))]
    assert.ok(distinct.length <= 1, `counts.${c.id}: the number disagrees across docs (${found.map((f) => `${f.doc}: ${f.n}`).join(' vs ')}) — update every mention together`)
    if (c.minMentions) assert.ok(found.length >= c.minMentions, `counts.${c.id}: stated ${found.length} time(s) but minMentions is ${c.minMentions}`)
  }
})

// ─────────────────────────────────────────────────────────────────── RS-reflexivity
gate('reflexivity', `RS-reflexivity ${DOC.conventions} documents the enforced vocabulary (lint ⟺ spec)`, () => {
  assert.ok(exists(DOC.conventions), `${DOC.conventions} must exist`)
  const conv = read(DOC.conventions)
  for (const c of CHANGELOG_CATEGORIES) assert.ok(conv.includes(c), `${DOC.conventions} must document the CHANGELOG category "${c}"`)
  for (const s of [...(docsOnly ? README_CANON_DOCS_ONLY : README_CANON), 'License']) assert.ok(conv.includes(s), `${DOC.conventions} must document the required README section "${s}"`)
  assert.ok(/keepachangelog|Keep a Changelog/i.test(conv), `${DOC.conventions} must cite the Keep a Changelog standard`)
  assert.ok(/standard-readme/i.test(conv), `${DOC.conventions} must cite the standard-readme standard`)
  for (const w of extraBanned) assert.ok(conv.toLowerCase().includes(w.toLowerCase()), `${DOC.conventions} must document the extra banned voice term "${w}" (config cannot grow rules the written standard does not carry)`)
})

// ─────────────────────────────────────────────────────────────────── RS-stable-docs
gate('stable-docs', `RS-stable-docs the stable meta files exist with an H1 (${stableDocs.join(', ') || 'none declared'})`, () => {
  for (const f of stableDocs) {
    assert.ok(exists(f), `${f} must exist`)
    assert.match(read(f), /^# .+/m, `${f} must open with an H1`)
  }
})

// ──────────────────────────────────────────────────────────────────────── RS-todos
gate('todos', 'RS-todos no TODO(scaffold) marker survives in a governed doc', () => {
  for (const doc of [...metaDocs, ...stableDocs]) {
    if (!exists(doc)) continue
    let inFence = false
    read(doc).split('\n').forEach((line, i) => {
      if (FENCE_LINE.test(line)) { inFence = !inFence; return }
      if (inFence) return
      // same mention-vs-use rule as the voice ban: NAMING the marker in backticks/quotes
      // (docs about the scaffolder do) is not an unfinished scaffold. The match is
      // case-insensitive and space-tolerant — a hand-retyped "todo (scaffold)" is still an
      // unfinished scaffold.
      const bare = line.replace(/"[^"]*"|`[^`]*`/g, '').replace(/(?<![A-Za-z0-9])'[^']*'(?![A-Za-z0-9])/g, '')
      assert.ok(!/todo\s*\(scaffold\)/i.test(bare), `${doc}:${i + 1} still carries a TODO(scaffold) marker — the scaffold is unfinished: ${line.trim().slice(0, 70)}`)
    })
  }
})

// ──────────────────────────────────────────────────────────────────────── RS-license
// GitHub cannot supply a LICENSE org-wide — every repo carries its own — yet the scaffolded
// set's one non-markdown file is the one RS-stable-docs cannot govern (a license text has no
// H1). This closes that hole: the file must exist, and when its text is a recognizable
// standard license, the version manifest's license field and the README's License section must
// name the same id — the declared-vs-discovered divergence license scanners flag, caught by
// the committed gate instead of an audit.
const LICENSE_CANDIDATES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'LICENCE.txt', 'COPYING', 'COPYING.md', 'COPYING.txt', 'UNLICENSE']
const licenseFile = LICENSE_CANDIDATES.find((f) => exists(f)) ?? null
// twin of harness/sense-state.mjs's licenseFromFile chain — self-contained because a target
// repo receives ONLY this file; a change to either copy belongs in both. Each arm keys on what
// DISTINGUISHES its license (the BSD family shares one preamble verbatim; MIT's grant sentence
// also appears in other permissive texts), and an unmatchable text says 'unrecognized' rather
// than guessing.
const licenseIdOf = (text) =>
  /Apache License\s*\n\s*Version 2\.0/.test(text) ? 'Apache-2.0'
  : /GNU GENERAL PUBLIC LICENSE\s*\n\s*Version 3/.test(text) ? 'GPL-3.0'
  : /Mozilla Public License Version 2\.0/.test(text) ? 'MPL-2.0'
  : /Neither the name of the copyright holder|BSD 3-Clause/i.test(text) ? 'BSD-3-Clause'
  : /BSD 2-Clause/i.test(text) ? 'BSD-2-Clause'
  : /^MIT No Attribution\b/m.test(text) ? 'MIT-0'
  : /^MIT License/m.test(text) ? 'MIT'
  : /Redistribution and use in source and binary forms/.test(text) ? 'unrecognized' // some BSD variant; say so rather than guess
  // the bare grant sentence is shared across the MIT family (MIT-0 drops the notice-preservation
  // condition) — claim MIT only when that condition is present too, else say so rather than guess.
  : /Permission is hereby granted, free of charge/.test(text)
    ? (/above copyright notice and this permission notice/i.test(text) ? 'MIT' : 'unrecognized')
  : 'unrecognized'
const licenseText = licenseFile ? read(licenseFile) : null
const licenseId = licenseText && licenseText.trim() ? licenseIdOf(licenseText) : null
// a detected id matches a declared one exactly, or with the GNU -only/-or-later suffix the
// license TEXT alone cannot distinguish — that grant choice lives in the declaration.
const idMatches = (declared) => declared === licenseId || declared === `${licenseId}-only` || declared === `${licenseId}-or-later`
// EVERY existing JSON manifest is consulted — checking only the first would let package.json
// (the manifest npm actually reads) contradict the LICENSE whenever plugin.json omits the field.
const licenseManifests = ['.claude-plugin/plugin.json', 'package.json'].filter((p) => exists(p))
const manifestDeclaresLicense = licenseManifests.some((p) => {
  try { const v = JSON.parse(read(p)).license; return v !== undefined && v !== null } catch { return false }
})

gate('license', `RS-license ${licenseFile ?? 'LICENSE'} exists and its id agrees with the manifest and README`, () => {
  assert.ok(licenseFile !== null, `no license file at the repo root (looked for ${LICENSE_CANDIDATES.join(', ')}) — GitHub cannot supply a LICENSE org-wide, so a governed repo carries its own; add one, or disable checks.license with a stated reason`)
  assert.ok(licenseText.trim().length > 0, `${licenseFile} is empty — an empty license file licenses nothing`)
  if (licenseId === 'unrecognized') return // agreement is unverifiable — the named SKIP below says so out loud
  // manifest agreement: every existing JSON manifest that declares a license must agree. The
  // legacy object/array license form is itself the failure — npm deprecated it, and it renders
  // as "[object Object]" anywhere a string is expected.
  for (const manifestPath of licenseManifests) {
    let mf
    try { mf = JSON.parse(read(manifestPath)) } catch (e) { throw new Error(`${manifestPath} is not valid JSON, so its license field cannot be checked: ${e.message}`) }
    if (mf.license === undefined || mf.license === null) continue
    assert.ok(typeof mf.license === 'string', `${manifestPath} "license" uses the deprecated object/array form — declare a string SPDX expression (e.g. "${licenseId}")`)
    const tokens = mf.license.split(/[\s()]+/).filter(Boolean)
    assert.ok(tokens.some(idMatches), `${manifestPath} declares license "${mf.license}" but ${licenseFile} carries ${licenseId} — the manifest and the license file must agree`)
  }
  // README agreement: the License section (RS-readme already requires it last and non-empty)
  // must name the id the license file carries.
  if (exists(DOC.readme)) {
    const rm = stripFences(read(DOC.readme))
    const licH2 = [...rm.matchAll(/^## +(.+?)\s*$/gm)].filter((h) => /license/i.test(h[1])).pop()
    if (licH2) {
      const rest = rm.slice(licH2.index + licH2[0].length)
      const nextH2 = rest.search(/^## /m)
      const body = nextH2 === -1 ? rest : rest.slice(0, nextH2)
      const esc = licenseId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      assert.ok(new RegExp(`\\b${esc}(?:-only|-or-later)?(?![A-Za-z0-9-])`).test(body), `${DOC.readme}'s License section must name the license ${licenseFile} carries (${licenseId}) — found no mention of it`)
    }
  }
})
if (!disabled.license && licenseId === 'unrecognized') {
  skipCheck('RS-license (id agreement)', `${licenseFile} is not a recognized standard license text — LICENSE ⟺ manifest ⟺ README agreement cannot be checked; existence and non-emptiness were`)
}
// the ✓ line above must not imply a manifest agreement that never ran: when no manifest
// declares a license there is nothing to compare, and that absence is stated, not passed.
if (!disabled.license && licenseId && licenseId !== 'unrecognized' && !manifestDeclaresLicense) {
  skipCheck('RS-license (manifest leg)', licenseManifests.length
    ? `${licenseManifests.join(' and ')} declare${licenseManifests.length === 1 ? 's' : ''} no license field — LICENSE ⟺ manifest agreement not checkable (the scaffold skill backfills the field); the README leg still ran`
    : 'no version manifest exists — LICENSE ⟺ manifest agreement not checkable; the README leg still ran')
}

// ─────────────────────────────────────────────────────────────────── RS-placeholders
gate('placeholders', 'RS-placeholders no unfilled {{PLACEHOLDER}} token survives in a governed doc', () => {
  for (const doc of new Set([...metaDocs, ...stableDocs, ...(licenseFile ? [licenseFile] : [])])) {
    if (!exists(doc)) continue
    let inFence = false
    read(doc).split('\n').forEach((line, i) => {
      // deliberately NO fence exemption: template placeholders live inside fenced install/usage
      // examples ({{INSTALL_COMMAND}}), which is exactly where a hand-copied template escapes
      // fill-template's own refusal. Inline-code and quoted MENTIONS stay exempt in PROSE only
      // — inside a fence a quote is code syntax (a JSON/YAML example quotes its every value),
      // so the fence is scanned raw, delimiter lines included.
      const isDelim = FENCE_LINE.test(line)
      if (isDelim) inFence = !inFence
      const bare = (inFence || isDelim) ? line
        : line.replace(/"[^"]*"|`[^`]*`/g, '').replace(/(?<![A-Za-z0-9])'[^']*'(?![A-Za-z0-9])/g, '')
      const m = bare.match(/\{\{[A-Z0-9_]+\}\}/)
      assert.ok(!m, `${doc}:${i + 1} carries an unfilled template placeholder ${m?.[0]} — a hand-copied template bypassed the fill engine; fill the value or delete the line: ${line.trim().slice(0, 70)}`)
    })
  }
})

// ──────────────────────────────────────────────────────────────────────── RS-shadow
// GitHub resolves README and every community health file with precedence .github/ > root >
// docs/, so a copy in a higher-precedence location silently REPLACES the governed one on the
// repo page while every content check here stays green. One copy per governed doc, wherever
// it lives — only the three GitHub-served locations count (a README in some other subdirectory
// is that directory's business).
gate('shadow', 'RS-shadow no governed doc is duplicated across the GitHub-served locations (.github/ > root > docs/)', () => {
  // EVERY governed doc, not just the health files: the manifest doc and docs.extra are swept
  // by voice/todos/placeholders/counts, so they are governed vocabulary here too.
  const basenames = new Set([DOC.readme, DOC.changelog, DOC.conventions, ...stableDocs, ...(manifestCfg ? [manifestCfg.file] : []), ...extraDocs].map((p) => p.split('/').pop()))
  for (const name of basenames) {
    const hits = [`.github/${name}`, name, `docs/${name}`].filter((p) => exists(p))
    assert.ok(hits.length <= 1, `duplicate meta file: ${hits[0]} shadows ${hits.slice(1).join(' and ')} (precedence .github/ > root > docs/ — what GitHub serves for README and community health files); one governed copy only, delete the rest`)
  }
})

console.log(`\n${pass} passed, ${fail} failed${skip ? `, ${skip} skipped (each named above — a skip is visible, never silent)` : ''}`)
process.exit(fail ? 1 : 0)

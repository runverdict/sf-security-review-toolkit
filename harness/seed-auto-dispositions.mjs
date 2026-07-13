#!/usr/bin/env node
/*
 * seed-auto-dispositions.mjs — deterministic AUTO-DISPOSITION SEEDER. The precision half
 * of the deterministic-band honesty story: the raw scanner band is dominated by known-safe
 * noise (a real cold run landed 3 critical / 121 high RAW that collapsed to 1 critical /
 * 34 high only after a human hand-adjudicated ~155 findings). A readiness headline must not
 * be wrong-by-default until a driver hand-clears the noise. This engine pre-clears the
 * EXACT known-safe shapes as an OVERRIDABLE PRIOR the LLM audit re-confirms — never a
 * silent final refutation.
 *
 * WHAT IT IS (and is NOT). It EMITS `deterministic-dispositions.json` entries in the SAME
 * schema `apply-dispositions.mjs` consumes, marked `disposition_source:'heuristic'`, and
 * lets that existing engine apply them. It invents NO parallel apply path, flips NO ledger
 * status itself, and adds NO hardcoded blanket refute rule inside apply-dispositions. The
 * seeder is a STARTING adjudication; the audit reviews it, keeps what it agrees with,
 * strikes what it re-opens, and appends its own hand-adjudications to the same file.
 *
 * WHY OVERRIDABLE, NOT A GATE. Each seeded entry carries `disposition_source:'heuristic'`
 * so the audit can tell a machine prior from a human read. The override is preserved two
 * ways: (1) apply-dispositions structurally NEVER touches an `llm-inferred` finding, so if
 * the audit independently CONFIRMS a real issue at a heuristic-cleared locus (e.g. the
 * injection-xss dimension finds real user interpolation at a migration file), that
 * confirmation surfaces as the audit's OWN finding, immune to this prior; (2) the entry is
 * a plain reviewable row in the dispositions file the audit can strike or replace before
 * apply runs. To DURABLY re-open, the audit raises its own finding; striking the entry is a
 * within-pass override applied before apply-dispositions.
 *
 * THE THREE CONSERVATIVE HEURISTICS (only the exact known-safe shapes; when in doubt, OPEN —
 * a false auto-clear of a real finding is far worse than leaving noise for the audit):
 *
 *   1. MIGRATION-DDL — a semgrep `avoid-sqlalchemy-text` OR a bandit `B608` (hardcoded-SQL)
 *      finding whose file is under a DB-migration directory (a path segment `alembic`,
 *      `migrations`, or `versions`) → refuted, "migration DDL: server-authored schema SQL,
 *      not user-interpolated input". A text()/B608 hit OUTSIDE a migration dir is NOT
 *      cleared — it may be a real injection; it stays OPEN for the audit.
 *
 *   2. DEV-ONLY-DEP CVE — an `osv` (npm ecosystem) or `npm-audit` dependency-CVE for a
 *      package present ONLY in `devDependencies` (and NOT in `dependencies`) of the
 *      package.json adjacent to the finding's lockfile → refuted, "dev-only devDependency:
 *      not in the deployed surface". A production-dep CVE, a transitive dep (in neither
 *      list), a non-npm ecosystem, or a lockfile with no adjacent package.json is NOT
 *      cleared. Reuses `resolveDevScope` — the SAME direct-devDependency classifier the
 *      ingest down-rank uses — so "dev-only" means the same thing across the toolkit.
 *
 *   3. HISTORY-ONLY SECRET — a `gitleaks` finding whose file is NOT present in the current
 *      git HEAD tree → refuted, "history-only: not in the shipped artifact; rotation debt,
 *      NOT a package-review gate". A secret IN HEAD is NOT cleared (it ships — a real
 *      package-review gate). Framed as rotation debt, never "safe to ignore". When the
 *      target is not a git repo (HEAD unreadable) the heuristic clears NOTHING — it cannot
 *      prove absence, so it fails conservative.
 *
 * AUDITABLE. Every seeded entry carries its `heuristic_id` and concrete `evidence` (the
 * migration paths, the dev-vs-prod classification + which package.json, the HEAD-absent
 * files) exactly like a hand-written disposition, and its `reason` names it a heuristic
 * overridable prior — so the flip's `disposition_reason` on the ledger reads as a heuristic
 * prior, not a human read.
 *
 * DETERMINISTIC + IDEMPOTENT. No Date / Math.random. The only external facts are the ledger,
 * the target's package.json files, and `git ls-tree HEAD` — all stable given the repo state.
 * Entries emit in a fixed order (heuristic, then engine, then ruleId; scope files sorted).
 * The merge is ADDITIVE and NON-CLOBBERING: it preserves every existing entry verbatim and
 * adds a heuristic entry only when no existing entry already covers that engine+ruleId (a
 * hand-written adjudication for the same rule wins, and a re-run adds nothing). When there
 * is nothing new to add it writes NOTHING — the file (and any human formatting) is left
 * byte-identical.
 *
 * Read-only on partner source except the dispositions file it seeds
 * (<target>/.security-review/deterministic-dispositions.json). It never writes the ledger.
 *
 * Usage:
 *   node seed-auto-dispositions.mjs --target <repo> [--json] [--dry-run]
 * Exit: 0 clean seed / clean no-op; 2 corrupted ledger, or an unparseable / wrong-shape
 * existing dispositions file (refuse loud — never clobber a file we cannot read).
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync, realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { normFile } from './finding-clusters.mjs' // the SAME file-normalization primitive apply-dispositions scopes with
import { loadLedger, resolveDevScope } from './ingest-scanner-findings.mjs' // canonical ledger loader + dev-scope classifier

// The heuristic ids, in emission order. A finding is tested against these in this order.
export const HEURISTIC_IDS = ['migration-ddl', 'dev-only-dep', 'history-only-secret']

// The reason each heuristic stamps on its entries. Names it an OVERRIDABLE PRIOR so the
// ledger's disposition_reason reads as a machine prior the audit reviews, never a human read.
export const HEURISTIC_REASONS = {
  'migration-ddl':
    'heuristic auto-disposition (migration-ddl, overridable prior): migration DDL — server-authored schema SQL, not user-interpolated input',
  'dev-only-dep':
    'heuristic auto-disposition (dev-only-dep, overridable prior): dev-only devDependency — not in the deployed surface',
  'history-only-secret':
    'heuristic auto-disposition (history-only-secret, overridable prior): history-only — not in the shipped artifact; rotation debt, NOT a package-review gate',
}

/**
 * Is a finding's file under a DB-migration directory? A path SEGMENT (never a substring)
 * equal to `alembic`, `migrations`, or `versions` — so `alembic/versions/…`, an app's
 * `migrations/…`, and a bare `<dir>/versions/…` match, while `app/migrations_helper.py` (no
 * such segment) does not. The `:line` suffix is stripped via the same `normFile` primitive
 * the scope engine uses, so segment matching is unaffected by it.
 */
export function isMigrationPath(file) {
  const norm = normFile(file)
  if (!norm || norm === '(unattributed)') return false
  return norm.split('/').some((seg) => seg === 'alembic' || seg === 'migrations' || seg === 'versions')
}

// The hardcoded-SQL shapes heuristic 1 clears IN a migration dir: semgrep's text() rule
// (the ruleId is a dotted path CONTAINING `avoid-sqlalchemy-text`) or bandit's B608.
const isTextSqlRule = (f) =>
  (String(f.engine) === 'semgrep' && /avoid-sqlalchemy-text/.test(String(f.ruleId))) ||
  (String(f.engine) === 'bandit' && String(f.ruleId) === 'B608')

/**
 * Recover the npm package name from a dependency-CVE finding's title, npm ecosystem only.
 * The title is `<ruleId>: <message>` (buildFinding), and the message shape is engine-fixed:
 *   osv       — `<pkg>@<version> (<ecosystem>): <summary>`   → clear only when ecosystem is npm
 *   npm-audit — `<pkg>[ (<range>)] — <sev> severity npm dependency vulnerability: <title>`
 * Scoped packages (`@scope/name`) are handled. Returns `{ name, ecosystem }` or null (a
 * PyPI/Go dep, an unparseable title, or a non-dep engine → null → left OPEN).
 */
export function packageFromFinding(f) {
  const engine = String(f && f.engine)
  const ruleId = String(f && f.ruleId)
  const title = String((f && f.title) || '')
  const prefix = ruleId + ': '
  if (!title.startsWith(prefix)) return null
  const msg = title.slice(prefix.length)
  if (engine === 'osv') {
    const m = msg.match(/^(@?[^@\s]+(?:\/[^@\s]+)?)@\S+\s+\(([^)]+)\)\s*:/)
    if (!m) return null
    if (String(m[2]).toLowerCase() !== 'npm') return null // npm ecosystem only (matches the ingest down-rank scope)
    return { name: m[1], ecosystem: 'npm' }
  }
  if (engine === 'npm-audit') {
    const m = msg.match(/^(@?[^\s(]+)(?:\s+\([^)]*\))?\s+—\s+.*npm dependency vulnerability/)
    if (!m) return null
    return { name: m[1], ecosystem: 'npm' } // npm-audit is npm by construction
  }
  return null
}

/**
 * Pure core: compute the heuristic dispositions for a findings array.
 *
 * @param {Array<object>} findings — the ledger findings (only `provenance:'deterministic'` are considered).
 * @param {{ headFiles?: Set<string>|null, devScope?: (relDir:string)=>Set<string> }} repo —
 *        the external facts the findings alone cannot supply:
 *          headFiles — the set of paths in git HEAD (repo-root-relative), or null when HEAD
 *                      is unreadable (not a git repo). null → heuristic 3 clears NOTHING.
 *          devScope  — relDir → the set of DIRECT dev-only npm package names for the
 *                      package.json in that dir (`''` = repo root). Default: empty scope.
 * @returns {{ dispositions: Array<object>, byHeuristic: Record<string,{entries:number,findings:number}> }}
 */
export function seedAutoDispositions(findings, repo = {}) {
  const headFiles = repo.headFiles instanceof Set ? repo.headFiles : null
  const devScope = typeof repo.devScope === 'function' ? repo.devScope : () => new Set()
  const det = (Array.isArray(findings) ? findings : []).filter((f) => f && String(f.provenance) === 'deterministic')

  // one entry per (heuristic, engine, ruleId) — a single disposition can carry many loci in
  // scope.files, but engine+ruleId is a single pair per entry (apply matches exactly on it).
  const entries = new Map()
  const key = (h, e, r) => `${h}\x00${e}\x00${r}`
  const entryFor = (heuristic, f) => {
    const k = key(heuristic, String(f.engine), String(f.ruleId))
    let e = entries.get(k)
    if (!e) {
      e = { heuristic, engine: String(f.engine), ruleId: String(f.ruleId), files: new Set() }
      entries.set(k, e)
    }
    return e
  }
  const findingCount = { 'migration-ddl': 0, 'dev-only-dep': 0, 'history-only-secret': 0 }

  for (const f of det) {
    const nf = normFile(f.file)
    // Heuristic 1 — migration DDL. Both guards live here: the SQL-shape guard AND the
    // migration-path guard. Removing either would over-clear (a non-migration text() is a
    // possible real injection).
    if (isTextSqlRule(f) && isMigrationPath(f.file)) {
      entryFor('migration-ddl', f).files.add(nf)
      findingCount['migration-ddl']++
      continue
    }
    // Heuristic 3 — history-only secret. Only when HEAD is readable AND the file is absent
    // from it. HEAD unreadable (headFiles null) or file present in HEAD → NOT cleared.
    if (String(f.engine) === 'gitleaks') {
      if (headFiles && !headFiles.has(nf)) {
        const e = entryFor('history-only-secret', f)
        e.files.add(nf)
        findingCount['history-only-secret']++
      }
      continue
    }
    // Heuristic 2 — dev-only-dep CVE. npm ecosystem, package present ONLY in the adjacent
    // package.json's devDependencies. A prod dep, a transitive dep, a non-npm ecosystem, or
    // an unparseable/absent package.json → NOT cleared.
    if (String(f.engine) === 'osv' || String(f.engine) === 'npm-audit') {
      const pkg = packageFromFinding(f)
      if (pkg) {
        const relDir = dirname(nf) === '.' ? '' : dirname(nf)
        const scope = devScope(relDir)
        if (scope && scope.has(pkg.name)) {
          const e = entryFor('dev-only-dep', f)
          e.files.add(nf)
          e.package = pkg.name
          e.from = (relDir ? relDir + '/' : '') + 'package.json'
          findingCount['dev-only-dep']++
        }
      }
      continue
    }
  }

  // Emit in a fixed order: heuristic order, then engine, then ruleId; scope files sorted.
  const ordered = [...entries.values()].sort(
    (a, b) =>
      HEURISTIC_IDS.indexOf(a.heuristic) - HEURISTIC_IDS.indexOf(b.heuristic) ||
      (a.engine < b.engine ? -1 : a.engine > b.engine ? 1 : 0) ||
      (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0)
  )
  const byHeuristic = {
    'migration-ddl': { entries: 0, findings: findingCount['migration-ddl'] },
    'dev-only-dep': { entries: 0, findings: findingCount['dev-only-dep'] },
    'history-only-secret': { entries: 0, findings: findingCount['history-only-secret'] },
  }
  const dispositions = ordered.map((e) => {
    byHeuristic[e.heuristic].entries++
    const files = [...e.files].sort()
    const evidence =
      e.heuristic === 'migration-ddl'
        ? { migration_paths: files }
        : e.heuristic === 'dev-only-dep'
          ? { package: e.package, classified_from: e.from, dev_only: true }
          : { absent_from_head: files }
    return {
      engine: e.engine,
      ruleId: e.ruleId,
      disposition: 'refuted',
      reason: HEURISTIC_REASONS[e.heuristic],
      scope: { files },
      disposition_source: 'heuristic',
      heuristic_id: e.heuristic,
      evidence,
    }
  })
  return { dispositions, byHeuristic }
}

// ----------------------------------------------------------------------------
// CLI facts — real git HEAD + real package.json dev-scope
// ----------------------------------------------------------------------------

/**
 * The set of repo-root-relative paths tracked in git HEAD, or null when HEAD is unreadable
 * (not a git repo / no commits). One `git ls-tree` call — deterministic, read-only.
 */
export function readHeadFiles(target) {
  try {
    const out = execFileSync('git', ['-C', target, 'ls-tree', '-r', '--name-only', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return new Set(
      out
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
    )
  } catch {
    return null // no git / no HEAD → heuristic 3 clears nothing (fail conservative)
  }
}

/** A memoized `relDir → dev-only npm package name Set`, keyed on the package.json in that dir. */
function makeDevScope(target) {
  const cache = new Map()
  return (relDir) => {
    if (cache.has(relDir)) return cache.get(relDir)
    const scope = resolveDevScope(relDir ? join(target, relDir) : target).npm
    cache.set(relDir, scope)
    return scope
  }
}

// ----------------------------------------------------------------------------
// CLI
// ----------------------------------------------------------------------------
function arg(flag, def) {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}

function main() {
  const target = arg('--target', process.cwd())
  const asJson = process.argv.includes('--json')
  const dryRun = process.argv.includes('--dry-run')
  const ledgerPath = join(target, '.security-review', 'audit-ledger.json')
  const dispPath = join(target, '.security-review', 'deterministic-dispositions.json')

  let ledger
  try {
    ledger = loadLedger(ledgerPath) // refuses a corrupted (non-array findings) ledger
  } catch (e) {
    console.error(`seed-auto-dispositions: ${e.message}`)
    process.exit(2)
  }

  const headFiles = readHeadFiles(target)
  const devScope = makeDevScope(target)
  const { dispositions, byHeuristic } = seedAutoDispositions(ledger.findings, { headFiles, devScope })

  // Read the existing dispositions file. Present-but-corrupted → refuse LOUD: we must not
  // clobber a human adjudication file we cannot parse.
  let existing = { dispositions: [] }
  const dispPresent = existsSync(dispPath)
  if (dispPresent) {
    let raw
    try {
      raw = readFileSync(dispPath, 'utf8')
    } catch (e) {
      console.error(`seed-auto-dispositions: cannot read ${dispPath} (${e.message})`)
      process.exit(2)
    }
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      console.error(
        `seed-auto-dispositions: cannot parse ${dispPath} (${e.message}) — fix the dispositions file and re-run`
      )
      process.exit(2)
    }
    if (Array.isArray(parsed)) existing = { dispositions: parsed }
    else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.dispositions)) existing = parsed
    else {
      console.error(
        `seed-auto-dispositions: ${dispPath} is not { dispositions: [...] } (or a bare array) — fix the dispositions file and re-run`
      )
      process.exit(2)
    }
  }

  // ADDITIVE, NON-CLOBBERING merge: keep every existing entry; add a heuristic entry ONLY
  // when no existing entry already covers its engine+ruleId (a hand-written adjudication
  // wins; a re-run adds nothing). Nothing new to add → write NOTHING (byte-identical file).
  const existingKeys = new Set(existing.dispositions.map((d) => `${String(d && d.engine)}\x00${String(d && d.ruleId)}`))
  const added = dispositions.filter((d) => !existingKeys.has(`${d.engine}\x00${d.ruleId}`))
  const merged = { ...existing, dispositions: [...existing.dispositions, ...added] }
  const willWrite = added.length > 0

  if (willWrite && !dryRun) {
    try {
      mkdirSync(join(target, '.security-review'), { recursive: true })
    } catch {
      /* dir may already exist */
    }
    writeFileSync(dispPath, JSON.stringify(merged, null, 2))
  }

  const totalFindings = byHeuristic['migration-ddl'].findings + byHeuristic['dev-only-dep'].findings + byHeuristic['history-only-secret'].findings

  if (asJson) {
    process.stdout.write(
      JSON.stringify(
        {
          seededEntries: dispositions.length,
          addedEntries: added.length,
          findingsCovered: totalFindings,
          byHeuristic,
          dispositions,
          headResolved: headFiles !== null,
          dispositionsFile: dispPresent ? 'present' : 'absent',
          willWrite,
          dryRun,
        },
        null,
        2
      ) + '\n'
    )
  } else {
    process.stdout.write(
      `seed-auto-dispositions: ${added.length} heuristic prior(s) added, covering ${totalFindings} deterministic finding(s)` +
        (headFiles === null ? ' (no git HEAD — history-only-secret heuristic skipped)' : '') +
        (dryRun ? ' (dry-run, not written)' : willWrite ? ` → ${dispPath}` : ' (nothing new — file unchanged)') +
        '\n'
    )
    for (const h of HEURISTIC_IDS) {
      const b = byHeuristic[h]
      process.stdout.write(`  ${h}: ${b.entries} entr${b.entries === 1 ? 'y' : 'ies'}, ${b.findings} finding(s)\n`)
    }
    for (const d of added) {
      process.stdout.write(`  seeded prior: ${d.engine}/${d.ruleId} → refuted (${d.scope.files.length} file(s))\n`)
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

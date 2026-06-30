#!/usr/bin/env node
/*
 * install-scanners.mjs — CONSENTED, tmp-scoped install of the missing scan tools
 * (0.6.0 preflight auto-gate). See docs/roadmap-0.6.0-preflight-autogate.md.
 *
 * WHAT IT DOES. Given tool-detect's `installable_missing` set, it installs each
 * tool into a tool-scoped temp dir OUTSIDE the partner's repo
 * (`/tmp/sf-srt-scanners/<runid>/<tool>/`), records an install manifest of
 * exactly what it created, and writes a project pointer
 * (`<target>/.security-review/scanner-install.json`) so `cleanup-scanners.mjs`
 * can remove precisely those paths later while KEEPING the evidence. The scans
 * then run against the tmp-installed tools; cleanup is asymmetric (remove the
 * binaries, keep the evidence — the SCI's on-disk proof).
 *
 * ── THE ONE ENGINE THAT TOUCHES THE NETWORK (read this) ───────────────────────
 * Every other harness/*.mjs is pure, dependency-free, no-network, byte-identical
 * (CONVENTIONS §7). This one is the documented exception: its EXECUTOR fetches and
 * installs software. It is split so the honesty model still holds:
 *   • `planInstalls()` — DETERMINISTIC. From the installable set + (runId, tmpRoot,
 *     platform, arch) it computes the exact plan: per-tool target dir, the literal
 *     install commands, the pinned download URL + sha256, the PATH to prepend.
 *     Byte-identical, no mutation, no network (one read-only realpath of the temp
 *     base inside the safety check) — and what the standing test asserts.
 *   • `installScanners()` — IMPURE. Runs that plan. It FAILS CLOSED without
 *     explicit consent (`opts.consent === true` / `--consent`) — silence-is-yes
 *     never authorizes a network install (the 0.5.4 P0 class), and the gate is
 *     re-asserted here at the engine boundary so a future skill that forgets the
 *     preflight consent still cannot install. Raw-binary downloads are
 *     sha256-verified against an author-pinned checksum BEFORE the file is ever
 *     made executable or extracted; a mismatch aborts that tool (never execs an
 *     unverified binary). pip/npm/git rely on the package manager's own integrity
 *     (PyPI/npm/Git-over-TLS); the sha256 pin covers the raw downloads that have
 *     no package-manager integrity layer.
 *
 * ── WHY ONE BASH CALL = ONE PROMPT (verified, do not "optimize" away) ─────────
 * Claude Code's permission boundary is the TOOL CALL, not its child processes:
 * one approved `Bash(node install-scanners.mjs --consent …)` covers every
 * pip/curl/git/npm subprocess this Node process spawns — they run unprompted
 * under that single approval (code.claude.com/docs/en/permissions.md,
 * hooks-guide.md; verified 2026-06-19). That is the whole reason the installs are
 * encapsulated in ONE node process: the operator approves once at the preflight
 * gate, and downstream "just works". (OS-level sandbox mode, if the user enables
 * it, can still gate descendants' network/fs — that's their boundary, not ours.)
 *
 * NEVER writes into the partner's source tree (only the tmp dir + the gitignored
 * `.security-review/` machine-state pointer). NEVER removes a pre-existing tool.
 *
 * USAGE:
 *   node install-scanners.mjs --target <repo> [--consent] [--dry-run] \
 *        [--run-id <id>] [--tmp-root <dir>] [--only a,b] [--detect <file.json>] [--json]
 *   --dry-run writes the manifest (status `planned`) and performs NO network I/O.
 */
import {
  mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync,
  renameSync, realpathSync, statSync, copyFileSync,
} from 'node:fs'
import { join, delimiter, resolve, sep } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { detectTools, whichOn } from './tool-detect.mjs'
import { verifyConsent } from './record-consent.mjs'
import { clampLog } from './clamp-log.mjs'

export const MANIFEST_SCHEMA = 'sf-srt-scanner-install/1'

// ── Pinned binary releases (author-time trust anchors, verified 2026-06-19) ───
// Raw downloads have no package-manager integrity layer, so each is sha256-pinned
// here and verified before exec. A tool/platform with no pin FAILS CLOSED → it is
// skipped (PENDING-OWNER-RUN), never installed unverified. Bump = re-pin both the
// version and every per-platform sha256 from the release's published checksums.
const BINARY_PINS = {
  'osv-scanner': {
    version: '2.4.0',
    bin: 'osv-scanner',
    urlBase: 'https://github.com/google/osv-scanner/releases/download/v2.4.0/',
    assets: {
      'linux-x64':    { file: 'osv-scanner_linux_amd64',  archive: 'none', sha256: '15314940c10d26af9c6649f150b8a47c1262e8fc7e17b1d1029b0e479e8ed8a0' },
      'linux-arm64':  { file: 'osv-scanner_linux_arm64',  archive: 'none', sha256: '44e580752910f0ff36ec99aff59af20f65df1e859aa31e5605a8f0d055b496e9' },
      'darwin-x64':   { file: 'osv-scanner_darwin_amd64', archive: 'none', sha256: '088119325156321c34c456ac3703d6013538fd71cbac82b891ab34db491e4d66' },
      'darwin-arm64': { file: 'osv-scanner_darwin_arm64', archive: 'none', sha256: '9ca3185ad63e9ab54f7cb90f46a7362be02d80e37f0123d095a54355ea202f5d' },
    },
  },
  gitleaks: {
    version: '8.30.1',
    bin: 'gitleaks',
    urlBase: 'https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/',
    assets: {
      'linux-x64':    { file: 'gitleaks_8.30.1_linux_x64.tar.gz',   archive: 'tar.gz', sha256: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb' },
      'linux-arm64':  { file: 'gitleaks_8.30.1_linux_arm64.tar.gz', archive: 'tar.gz', sha256: 'e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080' },
      'darwin-x64':   { file: 'gitleaks_8.30.1_darwin_x64.tar.gz',  archive: 'tar.gz', sha256: 'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709' },
      'darwin-arm64': { file: 'gitleaks_8.30.1_darwin_arm64.tar.gz',archive: 'tar.gz', sha256: 'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5' },
    },
  },
  gosec: {
    version: '2.27.1',
    bin: 'gosec',
    urlBase: 'https://github.com/securego/gosec/releases/download/v2.27.1/',
    assets: {
      'linux-x64':    { file: 'gosec_2.27.1_linux_amd64.tar.gz',  archive: 'tar.gz', sha256: 'a1cc5fba45fb51131ba05dee4029b364f62f4b6739b8f24236f93de82f40da40' },
      'linux-arm64':  { file: 'gosec_2.27.1_linux_arm64.tar.gz',  archive: 'tar.gz', sha256: '33582a6ed6878e4a0456585a8c3b043eef74d989d606bef85afc1a0f9b12f475' },
      'darwin-x64':   { file: 'gosec_2.27.1_darwin_amd64.tar.gz', archive: 'tar.gz', sha256: '117cf8dfe02b8746dad579f6ad01019e7c548bb36451e400993d662714dddcd9' },
      'darwin-arm64': { file: 'gosec_2.27.1_darwin_arm64.tar.gz', archive: 'tar.gz', sha256: 'e2d31bb4572471f47489dd6d2f3c98e9261dc65b1889c2a01c48d73d4e40038b' },
    },
  },
  trivy: {
    version: '0.71.2',
    bin: 'trivy',
    urlBase: 'https://github.com/aquasecurity/trivy/releases/download/v0.71.2/',
    assets: { // aquasec uses Linux-64bit / macOS-ARM64 naming, not linux_amd64
      'linux-x64':    { file: 'trivy_0.71.2_Linux-64bit.tar.gz',  archive: 'tar.gz', sha256: '0510e71e2fd39bf863856d499c8dc19feb4e7336546394c502a8f5cc7ab27460' },
      'linux-arm64':  { file: 'trivy_0.71.2_Linux-ARM64.tar.gz',  archive: 'tar.gz', sha256: 'fe1c7106e15a5365d485b098a8c338f91e3b7ba71cb0e4963b98a3a098763cfc' },
      'darwin-x64':   { file: 'trivy_0.71.2_macOS-64bit.tar.gz',  archive: 'tar.gz', sha256: 'c27bcf4ddd281aecb7267eb5df804ec49ac0f8fa23fe018d33932e17f30a38bf' },
      'darwin-arm64': { file: 'trivy_0.71.2_macOS-ARM64.tar.gz',  archive: 'tar.gz', sha256: 'a9f585cad53542a54ef286b5fa4199d081e5a061f8894635bdf3ce2608ece7a9' },
    },
  },
  nuclei: {
    version: '3.9.0',
    bin: 'nuclei',
    urlBase: 'https://github.com/projectdiscovery/nuclei/releases/download/v3.9.0/',
    assets: { // nuclei ships zip archives (extracted via unzip, or a python3 -m zipfile fallback)
      'linux-x64':    { file: 'nuclei_3.9.0_linux_amd64.zip', archive: 'zip', sha256: '05357e07886d9670e9c54325ec8afd362d03610c87e2aa1455886ad3f7b58519' },
      'linux-arm64':  { file: 'nuclei_3.9.0_linux_arm64.zip', archive: 'zip', sha256: '733ceb77896fc5a9cafb70d07cabdd43fd9f186c28cbc335eec5b78d5c35d850' },
      'darwin-x64':   { file: 'nuclei_3.9.0_macOS_amd64.zip', archive: 'zip', sha256: 'dd5f97d6c45349c7998af0d4bf461eed958a2755f812708b6c668bdf59a92c94' },
      'darwin-arm64': { file: 'nuclei_3.9.0_macOS_arm64.zip', archive: 'zip', sha256: '62f6bd1d554688e4c0fdd96f6dbbd7ec46fe1b4506a361fc01ef525425b0f060' },
    },
  },
}

// pip tools: the install token equals the tool name and the produced bin equals
// the tool name (semgrep→venv/bin/semgrep, …). Floating-latest is intentional —
// the tmp install is ephemeral + removed at cleanup, and PyPI-over-TLS is the
// integrity layer for the package path (the sha256 pin is for raw binaries).
const PIP_TOOLS = new Set(['semgrep', 'checkov', 'detect-secrets', 'bandit', 'njsscan', 'sslyze', 'schemathesis'])
// npm tools: `npm i --prefix <dir> <pkg>` → <dir>/node_modules/.bin/<bin>
const NPM_TOOLS = { retire: { pkg: 'retire', bin: 'retire' } }
// git tools: shallow clone; the runnable lives at <clone>/<bin>
const GIT_TOOLS = { testssl: { repo: 'https://github.com/testssl/testssl.sh.git', dir: 'testssl.sh', bin: 'testssl.sh' } }

// ── Code-Analyzer cold-install stack (0.8.41) ─────────────────────────────────
// CRUD/FLS is the #1 AppExchange review-failure class, and Salesforce Code Analyzer
// (PMD ApexCRUDViolation/ApexFlsViolation + the SFGE dataflow engine) is the exact
// static engine the reviewer runs for it. When `sf`+plugin+JDK are already present the
// agent runs it as-is; on a TRULY-COLD box this stack provisions them to the tmp root
// (`code-analyzer-stack` method), so CRUD/FLS is deterministic-by-default rather than
// PENDING-OWNER-RUN. Determinism of the resulting ledger band depends on these pins —
// they pin the analyzer (and thus the rule set / engine versions) the spike validated.
const CA_STACK_PINS = {
  cli:    { pkg: '@salesforce/cli', version: '2.140.6' },         // sf at <cliDir>/node_modules/.bin/sf
  // oclif plugin SHORT name `code-analyzer` → npm `@salesforce/plugin-code-analyzer`;
  // 5.14.0 bundles code-analyzer-pmd-engine 0.43.0 + code-analyzer-sfge-engine 0.22.0.
  plugin: { name: 'code-analyzer', version: '5.14.0', npm: '@salesforce/plugin-code-analyzer' },
}

// Temurin (Eclipse Adoptium) JDK 17 — the JRE PMD/SFGE need (JDK 11+). Mirrors
// BINARY_PINS: a per-platform { file, sha256 }, sha256-verified BEFORE extract; an
// unpinned platform (and no present java≥11) FAILS CLOSED → PENDING-OWNER-RUN, never
// extracted unverified. Bumping = re-pin the version AND every per-platform sha256 from
// Adoptium's published checksums. Note `%2B` is the URL-encoding of the `+` in the
// `jdk-17.0.19+10` release tag (the file names themselves use `17.0.19_10`).
export const JDK_PINS = {
  version: '17.0.19+10',
  dirName: 'jdk-17.0.19+10', // the tarball's top dir; JAVA_HOME = <extractDir>/<dirName> (+ /Contents/Home on darwin)
  archive: 'tar.gz',
  urlBase: 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.19%2B10/',
  assets: {
    'linux-x64':    { file: 'OpenJDK17U-jdk_x64_linux_hotspot_17.0.19_10.tar.gz',     sha256: 'd8afc263758141a66e0e3aafc321e783f7016696f4eaea067d340a269037d331' },
    'linux-arm64':  { file: 'OpenJDK17U-jdk_aarch64_linux_hotspot_17.0.19_10.tar.gz', sha256: '83a52172678ec8975164648654869cb2e71d7c748b47aca94b29bbfa10c18e81' },
    'darwin-x64':   { file: 'OpenJDK17U-jdk_x64_mac_hotspot_17.0.19_10.tar.gz',       sha256: '03632d1fbf139ab3719a9f4b47dc206251449b87557143c822336dbf8c06560f' },
    'darwin-arm64': { file: 'OpenJDK17U-jdk_aarch64_mac_hotspot_17.0.19_10.tar.gz',   sha256: '8fa1eff40bb637a33613b2ccb8b12c70dc3661cc22cf8e784943715769a05336' },
  },
}

const HEX64 = /^[0-9a-f]{64}$/
const RUN_ID_OK = /^[A-Za-z0-9][A-Za-z0-9._-]*$/ // a non-trivial run-id token (never '', '.', '..', or a path)
export const GROUP_DIR = 'sf-srt-scanners'        // the per-run grouping container under the temp base

const realOr = (p) => { try { return realpathSync(p) } catch { return resolve(p) } }
// The only roots a tmp dir may live under (cleanup rm -rf's it — keep it boxed). Snapshotted
// ONCE at trusted module load (both resolved + realpath'd, so a symlinked /tmp→/private/tmp
// passes) so a later TMPDIR/HOME mutation can't widen the allowed deletion base. (audit #5)
const ALLOWED_BASES = (() => {
  const cache = join('.cache', 'sf-srt')
  return [...new Set([realOr(tmpdir()), resolve(tmpdir()), join(realOr(homedir()), cache), join(resolve(homedir()), cache)])]
})()

/**
 * Guard the tmp root before anything is created OR removed. It MUST be a
 * non-trivial sub-path under the OS temp dir (or ~/.cache/sf-srt), carry an
 * `sf-srt` path segment, AND sit strictly BELOW the per-run grouping container —
 * so a malformed/empty/'/'/$HOME/repo-root value, or a degenerate run-id that
 * collapses the path onto the SHARED grouping dir, can never become an `rm -rf`
 * target (the latter would nuke every concurrent run — audit #8). Throws on
 * violation (fail closed).
 */
export function assertSafeTmpRoot(tmpRoot) {
  const p = resolve(String(tmpRoot || ''))
  if (!p || p === sep || p === '/') throw new Error(`unsafe tmp root: '${tmpRoot}'`)
  const segs = p.split(sep).filter(Boolean)
  if (!segs.some((s) => /^sf-srt/.test(s))) {
    throw new Error(`unsafe tmp root (no sf-srt segment): '${p}' — refusing to use a path cleanup could rm -rf`)
  }
  const under = ALLOWED_BASES.some((b) => p === b || p.startsWith(b + sep))
  if (!under) throw new Error(`unsafe tmp root (outside ${ALLOWED_BASES.join(' / ')}): '${p}'`)
  if (ALLOWED_BASES.includes(p)) throw new Error(`unsafe tmp root (is a base dir, not a sub-path): '${p}'`)
  // Reject the bare grouping container itself — a real per-run root always has a run-id
  // segment AFTER it; targeting the group dir would remove sibling runs. Covers every
  // sf-srt-* grouping tree (scanners / stack / dast / net), not just the scanner one
  // (audit: the 0.7.0 stack/dast trees were unboxed).
  if (/^sf-srt-(scanners|stack|dast|net)$/.test(segs[segs.length - 1])) {
    throw new Error(`unsafe tmp root (is a shared 'sf-srt-*' grouping dir, not a per-run sub-path): '${p}'`)
  }
  return p
}

/** Human-readable, deterministic command list — drives BOTH the gate display and (pip/npm/git) the executor. */
export function installCommands(inst) {
  switch (inst.method) {
    case 'pip':
      return [`python3 -m venv ${inst.venvDir}`, `${join(inst.venvDir, 'bin', 'pip')} install --no-input --disable-pip-version-check ${inst.pkg}`]
    case 'npm':
      return [`npm install --prefix ${inst.targetDir} ${inst.pkg}`]
    case 'git':
      return [`git clone --depth 1 ${inst.source} ${inst.cloneDir}`]
    case 'binary':
      return [
        `curl -fsSL -o ${inst.download} ${inst.source}`,
        `verify sha256(${inst.download}) == ${inst.checksum}`,
        inst.archive === 'tar.gz' || inst.archive === 'zip'
          ? `extract '${inst.archiveBin}' from ${inst.download} → ${inst.expectedBin} (scratch _pkg/, aux files discarded)`
          : `install ${inst.expectedBin} (chmod +x)`,
      ]
    case 'code-analyzer-stack':
      return [
        `# hermetic env (under ${inst.targetDir}): HOME SF_DATA_DIR SF_CACHE_DIR SF_CONFIG_DIR TMPDIR npm_config_cache + SF_DISABLE_TELEMETRY/AUTOUPDATE`,
        inst.jdk.mode === 'reuse'
          ? `reuse present JDK (JAVA_HOME=${inst.jdk.javaHome})`
          : `curl -fsSL ${inst.jdk.source} → verify sha256(${inst.jdk.checksum}) → extract Temurin JDK ${inst.jdk.version} (JAVA_HOME=${inst.jdk.javaHome})`,
        `npm install --prefix ${inst.cliDir} --no-audit --no-fund ${inst.cli.pkg}@${inst.cli.version}`,
        `${join(inst.cliBinDir, 'sf')} plugins install ${inst.plugin.name}@${inst.plugin.version}`,
      ]
    default:
      return []
  }
}

/**
 * Resolve the JDK side of the CA stack. PURE given its inputs. Reuses a present
 * java≥11 (read-only — its JAVA_HOME stays OUTSIDE the tmp root, never written) when
 * the impure caller detected one; otherwise provisions the pinned Temurin INTO the
 * tmp root (every byte under `jdkDir` ⊂ tmpRoot, so cleanup's structural rm reaches it).
 */
function resolveJdk({ presentJavaHome, jdkDir, platKey }) {
  if (presentJavaHome) {
    const home = resolve(String(presentJavaHome))
    return { mode: 'reuse', version: null, javaHome: home, binDir: join(home, 'bin') }
  }
  const asset = JDK_PINS.assets[platKey]
  if (!asset) return { mode: 'unsupported' }
  // darwin tarballs nest the runtime under Contents/Home; linux uses the top dir directly.
  const home = platKey.startsWith('darwin')
    ? join(jdkDir, JDK_PINS.dirName, 'Contents', 'Home')
    : join(jdkDir, JDK_PINS.dirName)
  return {
    mode: 'provision', version: JDK_PINS.version, archive: JDK_PINS.archive,
    source: JDK_PINS.urlBase + asset.file, download: join(jdkDir, asset.file),
    checksum: asset.sha256, extractDir: jdkDir, javaHome: home, binDir: join(home, 'bin'),
  }
}

/** Resolve one installable tool → a concrete install plan, or a skip reason. PURE. */
function resolveTool(t, tmpRoot, platKey, presentJavaHome) {
  const name = t.name
  const family = t.family
  const targetDir = join(tmpRoot, name)
  const base = { name, family, method: t.install, targetDir }
  if (t.install === 'pip') {
    if (!PIP_TOOLS.has(name)) return { skip: { name, family, method: t.install, reason: `unknown pip tool '${name}'` } }
    const venvDir = join(targetDir, 'venv')
    const binDir = join(venvDir, 'bin')
    return { install: { ...base, pkg: name, venvDir, binDir, expectedBin: join(binDir, name), source: `pypi:${name}`, version: null, checksum: null, archive: null } }
  }
  if (t.install === 'npm') {
    const m = NPM_TOOLS[name]
    if (!m) return { skip: { name, family, method: t.install, reason: `unknown npm tool '${name}'` } }
    const binDir = join(targetDir, 'node_modules', '.bin')
    return { install: { ...base, pkg: m.pkg, binDir, expectedBin: join(binDir, m.bin), source: `npm:${m.pkg}`, version: null, checksum: null, archive: null } }
  }
  if (t.install === 'git') {
    const m = GIT_TOOLS[name]
    if (!m) return { skip: { name, family, method: t.install, reason: `unknown git tool '${name}'` } }
    const cloneDir = join(targetDir, m.dir)
    return { install: { ...base, source: m.repo, cloneDir, binDir: cloneDir, expectedBin: join(cloneDir, m.bin), version: null, checksum: null, archive: null } }
  }
  if (t.install === 'binary') {
    const pin = BINARY_PINS[name]
    if (!pin) return { skip: { name, family, method: t.install, reason: `no pinned release for '${name}' (binary integrity unverifiable) — PENDING-OWNER-RUN` } }
    const asset = pin.assets[platKey]
    if (!asset) return { skip: { name, family, method: t.install, reason: `no pinned ${name} v${pin.version} release for ${platKey} — PENDING-OWNER-RUN` } }
    return {
      install: {
        ...base, version: pin.version, source: pin.urlBase + asset.file,
        download: join(targetDir, asset.file), checksum: asset.sha256, archive: asset.archive,
        // binDir holds ONLY the verified binary: archives extract to a scratch _pkg/
        // dir and just `archiveBin` is copied out, so the scan PATH never carries the
        // archive's LICENSE/README/second-executables (audit #1).
        binDir: targetDir, expectedBin: join(targetDir, pin.bin), archiveBin: pin.bin,
      },
    }
  }
  if (t.install === 'code-analyzer-stack') {
    const cliDir = join(targetDir, 'cli')
    const cliBinDir = join(cliDir, 'node_modules', '.bin')
    const jdkDir = join(targetDir, 'jdk')
    const jdk = resolveJdk({ presentJavaHome, jdkDir, platKey })
    if (jdk.mode === 'unsupported') {
      return { skip: { name, family, method: t.install, reason: `no pinned Temurin JDK for ${platKey} and no present java≥11 — PENDING-OWNER-RUN` } }
    }
    // ── HERMETICITY CONTRACT (load-bearing — the 0.8.41 spike's central finding) ──
    // cleanup tears down with one structural `rm -rf <tmpRoot>`, so EVERY path the
    // install WRITES must live under targetDir (⊂ tmpRoot). SF_* alone is NOT enough:
    // `~/.sf`, the npm cache, and @salesforce/cli's postinstall hooks (which fire during
    // `npm install`) write under HOME/TMPDIR/npm_config_cache — so those are first-class
    // contained paths too, set BEFORE the npm install and passed to every exec.
    const env = {
      HOME: join(targetDir, 'home'),
      SF_DATA_DIR: join(targetDir, 'sfdata'),
      SF_CACHE_DIR: join(targetDir, 'sfcache'),
      SF_CONFIG_DIR: join(targetDir, 'sfconfig'),
      TMPDIR: join(targetDir, 'runtmp'),
      npm_config_cache: join(targetDir, 'npmcache'),
      JAVA_HOME: jdk.javaHome,
      SF_DISABLE_TELEMETRY: 'true',
      SF_DISABLE_AUTOUPDATE: 'true',
      SF_AUTOUPDATE_DISABLE: 'true',
    }
    const pathPrepend = [cliBinDir, jdk.binDir]
    return {
      install: {
        ...base, version: CA_STACK_PINS.cli.version,
        source: `npm:${CA_STACK_PINS.cli.pkg}@${CA_STACK_PINS.cli.version}`,
        checksum: null, archive: null,
        cliDir, cliBinDir, binDir: cliBinDir, expectedBin: join(cliBinDir, 'sf'),
        cli: { ...CA_STACK_PINS.cli }, plugin: { ...CA_STACK_PINS.plugin }, jdk,
        env, pathPrepend,
      },
    }
  }
  return { skip: { name, family, method: t.install, reason: `unsupported install method '${t.install}'` } }
}

/**
 * Compute the full install plan from tool-detect's installable set.
 * `installableMissing`: array of { name, family, install }. Deterministic +
 * byte-identical for a given (installableMissing, runId, tmpRoot, platform, arch,
 * only, presentJavaHome): no mutation, no network. (It does one read-only `realpath`
 * of the temp/home base inside the tmp-root safety check — not "no I/O", but no
 * writes. audit #12). `presentJavaHome` is threaded in (not probed here, to keep the
 * planner pure) so the CA-stack JDK step is a deterministic reuse-or-provision decision.
 */
export function planInstalls(installableMissing, { runId, tmpRoot, platform, arch, only, presentJavaHome } = {}) {
  if (!runId || !RUN_ID_OK.test(String(runId))) {
    throw new Error(`planInstalls: run-id must be a non-trivial [A-Za-z0-9._-] token, got '${runId}' (an empty/'.'/path run-id would collapse the tmp dir onto the shared base)`)
  }
  assertSafeTmpRoot(tmpRoot)
  const platKey = `${platform}-${arch}`
  const want = Array.isArray(installableMissing) ? installableMissing : []
  const onlySet = only && only.length ? new Set(only) : null
  const installs = []
  const skipped = []
  const seen = new Set()
  for (const t of want) {
    if (!t || !t.name || seen.has(t.name)) continue
    seen.add(t.name)
    if (onlySet && !onlySet.has(t.name)) continue
    const r = resolveTool(t, tmpRoot, platKey, presentJavaHome)
    if (r.skip) skipped.push(r.skip)
    else installs.push({ ...r.install, commands: installCommands(r.install) })
  }
  return {
    schema: MANIFEST_SCHEMA, runId, tmpRoot, platform, arch,
    manifestPath: join(tmpRoot, 'install-manifest.json'),
    pointerRel: join('.security-review', 'scanner-install.json'),
    installs, skipped,
    pathPrepend: installs.map((i) => i.binDir),
  }
}

const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
// Like `run`, but with an explicit env (the CA-stack hermetic env). A separate helper
// so the pip/npm/git/binary branches' `run(...)` call sites stay byte-identical.
const runEnv = (cmd, args, cwd, env) => execFileSync(cmd, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/** Execute one install. Returns a manifest record. Throws nothing — failures are recorded. */
function executeOne(inst) {
  const rec = {
    name: inst.name, family: inst.family, method: inst.method, version: inst.version || null,
    targetDir: inst.targetDir, binDir: inst.binDir, expectedBin: inst.expectedBin,
    source: inst.source, checksum: inst.checksum || null, commands: inst.commands,
    status: 'planned', runnable: false, createdPaths: [inst.targetDir], log: '',
  }
  // The CA stack carries the hermetic env + the 2-dir PATH-prepend (sf + java) + the JDK
  // decision onto the manifest record, so run-scans can export them for the scan run.
  if (inst.method === 'code-analyzer-stack') {
    rec.env = inst.env
    rec.pathPrepend = inst.pathPrepend
    rec.jdk = { mode: inst.jdk.mode, version: inst.jdk.version || null, javaHome: inst.jdk.javaHome }
  }
  try {
    mkdirSync(inst.targetDir, { recursive: true, mode: 0o700 }) // 0700: not world-readable (audit #2)
    if (inst.method === 'pip') {
      run('python3', ['-m', 'venv', inst.venvDir], inst.targetDir)
      rec.log = clampLog(run(join(inst.venvDir, 'bin', 'pip'), ['install', '--no-input', '--disable-pip-version-check', inst.pkg], inst.targetDir), 2000)
    } else if (inst.method === 'npm') {
      rec.log = clampLog(run('npm', ['install', '--prefix', inst.targetDir, '--no-audit', '--no-fund', inst.pkg], inst.targetDir), 2000)
    } else if (inst.method === 'git') {
      rec.log = clampLog(run('git', ['clone', '--depth', '1', inst.source, inst.cloneDir], inst.targetDir), 2000)
    } else if (inst.method === 'binary') {
      // download → VERIFY (before any exec/extract) → place ONLY the verified binary.
      run('curl', ['-fsSL', '-o', inst.download, inst.source], inst.targetDir)
      const got = sha256File(inst.download)
      if (!HEX64.test(String(inst.checksum)) || got !== inst.checksum) {
        rec.status = 'failed'
        rec.log = `checksum mismatch: expected ${inst.checksum}, got ${got} — refusing to execute an unverified binary`
        try { rmSync(inst.download, { force: true }) } catch {}
        return rec
      }
      if (inst.archive === 'tar.gz' || inst.archive === 'zip') {
        // Extract into a scratch dir, then copy ONLY the intended binary up to binDir,
        // and discard the rest — the scan PATH carries exactly the verified executable,
        // never the archive's docs/aux files/second executables (audit #1).
        const pkg = join(inst.targetDir, '_pkg')
        mkdirSync(pkg, { recursive: true, mode: 0o700 })
        if (inst.archive === 'tar.gz') run('tar', ['-xzf', inst.download, '-C', pkg], inst.targetDir)
        else extractZip(inst.download, pkg) // unzip, or a python3 -m zipfile fallback
        const src = join(pkg, inst.archiveBin)
        if (!existsSync(src)) { rec.status = 'failed'; rec.log = `archive did not contain expected '${inst.archiveBin}'`; rmSync(pkg, { recursive: true, force: true }); return rec }
        copyFileSync(src, inst.expectedBin)
        rmSync(pkg, { recursive: true, force: true })
        rmSync(inst.download, { force: true })
      } else { // raw binary: the verified download IS the binary
        renameSync(inst.download, inst.expectedBin)
      }
      try { chmodSync(inst.expectedBin, 0o755) } catch {} // archive extraction can drop the exec bit
    } else if (inst.method === 'code-analyzer-stack') {
      // Contain EVERY write under targetDir (the hermeticity contract). Pre-create the
      // dirs the tools write into so npm/sf never fall back to the real ~ during the
      // @salesforce/cli postinstall hooks that fire mid-`npm install`.
      for (const d of [inst.env.HOME, inst.env.SF_DATA_DIR, inst.env.SF_CACHE_DIR, inst.env.SF_CONFIG_DIR, inst.env.TMPDIR, inst.env.npm_config_cache, inst.cliDir]) {
        mkdirSync(d, { recursive: true, mode: 0o700 })
      }
      const env = { ...process.env, ...inst.env }
      // (1) JDK — reuse a present java≥11, or download+VERIFY(sha256)+extract the pinned Temurin.
      if (inst.jdk.mode === 'provision') {
        mkdirSync(inst.jdk.extractDir, { recursive: true, mode: 0o700 })
        runEnv('curl', ['-fsSL', '-o', inst.jdk.download, inst.jdk.source], inst.targetDir, env)
        const got = sha256File(inst.jdk.download)
        if (!HEX64.test(String(inst.jdk.checksum)) || got !== inst.jdk.checksum) {
          rec.status = 'failed'
          rec.log = `JDK checksum mismatch: expected ${inst.jdk.checksum}, got ${got} — refusing to extract an unverified JDK`
          try { rmSync(inst.jdk.download, { force: true }) } catch {}
          return rec
        }
        runEnv('tar', ['-xzf', inst.jdk.download, '-C', inst.jdk.extractDir], inst.targetDir, env)
        rmSync(inst.jdk.download, { force: true }) // ~184MB tarball, deletable after extract
      }
      if (!isExecutable(join(inst.jdk.javaHome, 'bin', 'java'))) {
        rec.status = 'failed'
        rec.log = `JDK not runnable at ${join(inst.jdk.javaHome, 'bin', 'java')} (mode: ${inst.jdk.mode})`
        return rec
      }
      // (2) the pinned Salesforce CLI into cliDir; PATH carries the contained JAVA_HOME/bin.
      const stepEnv = { ...env, PATH: [...inst.pathPrepend, env.PATH || ''].join(delimiter) }
      rec.log = clampLog(runEnv('npm', ['install', '--prefix', inst.cliDir, '--no-audit', '--no-fund', `${inst.cli.pkg}@${inst.cli.version}`], inst.targetDir, stepEnv), 2000)
      // (3) the pinned code-analyzer plugin via the just-installed sf.
      runEnv(join(inst.cliBinDir, 'sf'), ['plugins', 'install', `${inst.plugin.name}@${inst.plugin.version}`], inst.targetDir, stepEnv)
    } else {
      rec.status = 'failed'; rec.log = `unsupported method '${inst.method}'`; return rec
    }
    // post-install presence check — the expected bin is present + has the exec bit.
    // (This is a placement check, not a full run-smoke; a tool that installs but
    // can't actually execute — e.g. a missing runtime dep — would still read
    // `installed`. The downstream scan invocation is the real proof. audit #9)
    rec.runnable = isExecutable(inst.expectedBin)
    rec.status = rec.runnable ? 'installed' : 'failed'
    if (!rec.runnable && !rec.log) rec.log = `install ran but ${inst.expectedBin} is not present/executable`
  } catch (e) {
    rec.status = 'failed'
    rec.log = clampLog(`${rec.log}\n${String(e && e.message || e)}`.trim(), 2000)
  }
  return rec
}

function isExecutable(p) {
  try { const s = statSync(p); return s.isFile() && (s.mode & 0o111) !== 0 } catch { return false }
}

// Shell-free PATH probe (no `sh -c` string interpolation — audit #3).
function hasCmd(bin) { return whichOn(bin, process.env.PATH || '') !== null }

/** Extract a zip into dir — `unzip` if present, else python3's stdlib zipfile (no unzip on minimal hosts). */
function extractZip(zip, dir) {
  if (hasCmd('unzip')) run('unzip', ['-o', '-q', zip, '-d', dir], dir)
  else run('python3', ['-m', 'zipfile', '-e', zip, dir], dir)
}

/** Major version of a `java` binary, or 0 if it can't be determined. IMPURE (execs java). */
function javaMajor(javaBin) {
  try {
    // `java --version` (Java 9+) prints to STDOUT; Java 8's `-version`-only CLI errors
    // here → caught → 0 (Java 8 is < 11 anyway, so "treat as absent → provision" is correct).
    const out = execFileSync(javaBin, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const m = out.match(/(\d+)\.\d+\.\d+/) || out.match(/version "?(\d+)/) || out.match(/\b(\d+)\b/)
    return m ? Number(m[1]) : 0
  } catch { return 0 }
}

/** A present JDK≥11's home (JAVA_HOME, else a `java` on PATH), or null. IMPURE (probes + execs java). */
function detectPresentJava() {
  const jh = process.env.JAVA_HOME
  if (jh && isExecutable(join(jh, 'bin', 'java')) && javaMajor(join(jh, 'bin', 'java')) >= 11) return jh
  const jbin = whichOn('java', process.env.PATH || '')
  if (jbin && javaMajor(jbin) >= 11) return resolve(join(jbin, '..', '..')) // <home>/bin/java → <home>
  return null
}

/**
 * IMPURE executor. Runs `plan` against the network. FAILS CLOSED without consent.
 * opts: { consent:boolean, dryRun:boolean, target?:string }
 */
export function installScanners(plan, { consent = false, dryRun = false, target } = {}) {
  assertSafeTmpRoot(plan.tmpRoot)
  if (!dryRun && consent !== true) {
    throw new Error('install-scanners: refusing to install without explicit consent (a network install is the 0.5.4 P0 class; silence-is-yes never covers it). Pass --consent.')
  }
  mkdirSync(plan.tmpRoot, { recursive: true, mode: 0o700 })
  const records = []
  for (const inst of plan.installs) {
    if (dryRun) {
      records.push({
        name: inst.name, family: inst.family, method: inst.method, version: inst.version || null,
        targetDir: inst.targetDir, binDir: inst.binDir, expectedBin: inst.expectedBin,
        source: inst.source, checksum: inst.checksum || null, commands: inst.commands,
        status: 'planned', runnable: false, createdPaths: [inst.targetDir], log: 'dry-run — no install performed',
        ...(inst.method === 'code-analyzer-stack'
          ? { env: inst.env, pathPrepend: inst.pathPrepend, jdk: { mode: inst.jdk.mode, version: inst.jdk.version || null, javaHome: inst.jdk.javaHome } }
          : {}),
      })
    } else {
      records.push(executeOne(inst))
    }
  }
  const installed = records.filter((r) => r.status === 'installed')
  const manifest = {
    schema: plan.schema, runId: plan.runId, tmpRoot: plan.tmpRoot,
    platform: plan.platform, arch: plan.arch,
    createdAt: new Date().toISOString(),
    consent: { granted: consent === true, dryRun: !!dryRun },
    target: target || null,
    installs: records, skipped: plan.skipped,
    // pathPrepend lists ONLY the dirs whose tool actually became runnable.
    pathPrepend: installed.map((r) => r.binDir),
    createdPaths: [plan.tmpRoot],
  }
  writeFileSync(plan.manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  // Project pointer so cleanup can find the tmp dir from the repo later. Lives in
  // gitignored machine-state — never the partner's source.
  if (target) {
    try {
      const dir = join(target, '.security-review')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'scanner-install.json'), JSON.stringify({
        schema: plan.schema, runId: plan.runId, tmpRoot: plan.tmpRoot,
        manifestPath: plan.manifestPath, createdAt: manifest.createdAt,
        installed: installed.map((r) => r.name), pathPrepend: manifest.pathPrepend,
      }, null, 2) + '\n')
    } catch (e) { manifest.pointerError = String(e && e.message || e) }
  }
  return manifest
}

// ── CLI ───────────────────────────────────────────────────────────────────────
function main() {
  const argv = process.argv
  const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
  const has = (f) => argv.includes(f)
  const target = arg('--target', null)
  // random suffix so the tmp path isn't predictable in world-writable /tmp (audit #2).
  const runId = arg('--run-id', `${Date.now().toString(36)}-${process.pid}-${randomBytes(4).toString('hex')}`)
  const tmpRoot = arg('--tmp-root', join(tmpdir(), GROUP_DIR, runId))
  const only = (arg('--only', '') || '').split(',').map((s) => s.trim()).filter(Boolean)
  // The --consent flag alone is NO LONGER sufficient (a driver can set it with the ask
  // skipped). It must be paired with a RECORDED affirmative consent for the 'scanner-install'
  // gate (the journey asks via AskUserQuestion, then records via record-consent.mjs).
  const consentFlag = has('--consent')
  const consentRecorded = verifyConsent('scanner-install', { target: target || process.cwd() })
  const consent = consentFlag && consentRecorded
  const dryRun = has('--dry-run')
  const asJson = has('--json')

  // Detect (or read a supplied detect JSON) → the installable set.
  let detect
  const detectFile = arg('--detect', null)
  if (detectFile) detect = JSON.parse(readFileSync(detectFile, 'utf8'))
  else detect = detectTools(process.env.PATH || '')
  const installable = (detect.summary && detect.summary.installable_missing) || []

  // Detect a present java≥11 (impure) so the CA-stack JDK step reuses it instead of
  // provisioning the pinned Temurin; planInstalls itself stays pure (the result is an input).
  const presentJavaHome = detectPresentJava()
  const plan = planInstalls(installable, { runId, tmpRoot, platform: process.platform, arch: process.arch, only, presentJavaHome })

  if (!plan.installs.length) {
    const msg = { note: 'nothing installable to install', skipped: plan.skipped, runId, tmpRoot }
    process.stdout.write((asJson ? JSON.stringify(msg, null, 2) : '## install-scanners — nothing to install (all detected tools present, or none installable)') + '\n')
    return
  }

  if (!dryRun && !consent) {
    const tokenMissing = consentFlag && !consentRecorded
    const lines = [
      '## install-scanners — NOT INSTALLED (no consent)',
      '',
      'A network install needs an explicit yes (the 0.5.4 P0 class; silence-is-yes never covers it).',
      ...(tokenMissing
        ? [`The --consent flag is set but NO affirmative consent is recorded for gate 'scanner-install' — the flag alone is not enough. Ask via AskUserQuestion, then: node ${fileURLToPath(new URL('./record-consent.mjs', import.meta.url))} --gate scanner-install --answer "<yes>" --target ${target || process.cwd()}`]
        : []),
      `Would install ${plan.installs.length} tool(s) to ${plan.tmpRoot} (removed at cleanup; evidence kept):`,
      ...plan.installs.map((i) => `  • ${i.name} (${i.method}${i.version ? ' v' + i.version : ''})`),
      '',
      're-run with --consent (and the recorded consent) to install, or --dry-run to see the full plan.',
    ]
    process.stdout.write((asJson ? JSON.stringify({ status: 'no-consent', plan }, null, 2) : lines.join('\n')) + '\n')
    process.exitCode = 3
    return
  }

  const manifest = installScanners(plan, { consent, dryRun, target })

  if (asJson) { process.stdout.write(JSON.stringify(manifest, null, 2) + '\n'); return }
  const L = [`## install-scanners — ${dryRun ? 'DRY RUN (no install performed)' : (consent ? 'installed' : '')}`, '']
  L.push(`run: ${manifest.runId}   tmp: ${manifest.tmpRoot}   (${manifest.platform}-${manifest.arch})`)
  for (const r of manifest.installs) {
    const mark = r.status === 'installed' ? '✓' : (r.status === 'planned' ? '·' : '✗')
    L.push(`${mark} ${r.name} (${r.method}${r.version ? ' v' + r.version : ''}) → ${r.status}${r.runnable ? '' : (r.status === 'failed' ? '  [' + (r.log || '').split('\n').pop() + ']' : '')}`)
  }
  if (manifest.skipped.length) L.push('', 'Skipped (PENDING-OWNER-RUN): ' + manifest.skipped.map((s) => `${s.name} (${s.reason})`).join('; '))
  if (manifest.pathPrepend.length) L.push('', `PATH to prepend for the scan run: ${manifest.pathPrepend.join(delimiter)}`)
  L.push('', `manifest: ${manifest.installs.length ? plan.manifestPath : '(none)'}   cleanup: node harness/cleanup-scanners.mjs --target <repo>`)
  process.stdout.write(L.join('\n') + '\n')
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) }
  catch { return fileURLToPath(import.meta.url) === process.argv[1] }
}
if (invokedDirectly()) main()

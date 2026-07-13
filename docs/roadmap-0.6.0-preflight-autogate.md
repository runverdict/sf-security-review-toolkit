# 0.6.0 — Preflight auto-gate + consent-gated scanner install

**Status: BUILT + COLD-VALIDATED (shipped in `v0.7.0`, 2026-06-19).** All of it landed:
`tool-detect` (detector) + `install-scanners` (consented tmp install, sha256-pinned binaries,
fail-closed without consent) + `cleanup-scanners` (asymmetric teardown) + the single up-front
consent gate wired into the journey (now a multi-consent gate alongside the 0.7.0 throwaway
DAST). 13 adversarial-audit findings fixed; cold-validated on the Atlas fixture (14 real
scanner-evidence files → cleanup kept the evidence). This was an **owner-pitched priority**
(Aiden); the spec + design below are retained as the record.

## The vision (owner, verbatim intent)

> As soon as the tool loads it should run the quick scan to find all the information
> it needs — which tools are installed for the package, which permissions it has — then
> run a single user-approval gate for: (1) set mode (full-auto vs guided), and (2)
> download required tools for the full scans (DAST/TLS/SAST). Both `yes` (auto) or `no`
> (custom guided). Those should be the only confirmations up front; everything
> downstream should "just work". Install the tools to a tmp folder, run the full suite,
> then remove the tools at the end on cleanup. I want to see real DAST/TLS/SAST output
> on the cold runs instead of PENDING-OWNER-RUN.

## The flow

1. **Preflight quick-scan (deterministic, no prompts).** On journey start, gather
   everything up front so the gate states the true situation the first time:
   - architecture/element detection (scope) — already exists;
   - `harness/package-readiness.mjs` — deep-audit install-readiness — already exists;
   - `harness/tool-detect.mjs` — which scanners are present / installable-on-consent /
     owner / owner-portal — **landed**;
   - `sf` auth state (deep-audit precondition) — already surfaced.

2. **ONE up-front consent gate (the only prompts the toolkit itself raises):**
   - **(a) Mode** — full-auto vs guided.
   - **(b) Install missing scanners?** — lists the `installable_missing` set from
     tool-detect (name + method + the exact command), the tmp install location, and
     that they are **removed at cleanup while the evidence is kept**. Yes → install for
     this run; No → those families stay `PENDING-OWNER-RUN` (today's behavior).
   - These are **two distinct consents** — do not let the install ride on the mode
     answer, and do not let it ride on the G4 hook's consent (separate concerns).

3. **Downstream just-works.** Scans run against present tools + any tmp-installed ones;
   anything still absent → `PENDING-OWNER-RUN` (honest). No further toolkit prompts.

4. **Cleanup (stay-listed / end of run).** Remove ONLY what the toolkit installed
   (tracked in an install manifest under the tmp dir), **keep all evidence files** (the
   SCI's on-disk proof). Asymmetric and disclosed, never silent. Never touch a
   pre-existing tool.

## Honest constraints (do not relitigate)

- **The toolkit CANNOT flip Claude Code's permission mode.** Auto-accept / bypass
  (shift+tab) is the user's safety boundary; a plugin can't self-elevate. So "no
  shift+tab needed" is NOT fully buildable. The user sets their permission mode at the
  start (they're fine doing this); the toolkit's job is to make sure the *only toolkit-
  raised* confirmations are the single gate above. (Optional, later: an armed-consent
  PreToolUse hook — same pattern as G4 — that auto-*allows* the toolkit's own
  deterministic READ commands to cut prompts. Network installs are NEVER auto-allowed.)
- **Network install = the 0.5.4 P0 class.** The 0.5.2 cold run auto-`pip install`ed
  semgrep with no consent; that was the P0 fix. The install here is the *consented*
  version of the same mechanism. So: it ships only behind the explicit gate-(b) yes;
  silence-is-yes never covers it; it must be test-backed and cold-validated before it
  ships. This is exactly why it is NOT a rushed build.

## Install mechanics (build spec)

- **Location:** a tool-scoped dir OUTSIDE the project root — `/tmp/sf-srt-scanners/<runid>/`
  (or `~/.cache/sf-srt/`). NEVER a project-root venv (a write into the partner's tree is
  the line we hold everywhere). Scans read source read-only; write findings to
  `.security-review/evidence/`.
- **Per method** (from `tool-detect.install`): `pip` → a tmp venv (`python -m venv` +
  `pip install --no-input <pkg>`); `binary` → download the pinned release to the tmp dir
  (checksum-verify before exec); `npm` → `npm i --prefix <tmp>`; `git` → shallow clone
  (testssl.sh). All under the tmp dir; PATH-prepended for the run only.
- **Install manifest:** record every path the toolkit created so cleanup removes exactly
  those and nothing else.
- **VERIFY before building:** confirm the consent-then-prompt-free flow actually covers
  NETWORK-FETCH installs (a different permission class than local reads) under the user's
  chosen permission mode — i.e. whether each install command still hits a per-command
  permission prompt. Document the real behavior; do not assume.

## Validation plan

- `tool-detect.mjs` — deterministic standing test (`test-tool-detect.mjs`, 6 checks). **Done.**
- The consent gate (LLM-driven preflight) — a TARGETED fresh cold run (the gate fires once,
  the two consents are distinct, no over-asking downstream).
- The tmp-install + full-suite run + cleanup — a cold run on a fixture with an installable
  surface (e.g. `~/srt-coldstart-full`, which has the Node/Python external + MCP surfaces):
  full-auto + install-yes → real Semgrep/OSV/etc. evidence on disk → cleanup removes the
  binaries, evidence remains. This is the run the owner wants to see.

## Build order (as built — retained record)

1. `harness/install-scanners.mjs` (consented, tmp-scoped, manifest, checksum-verify) + test.
2. `harness/cleanup-scanners.mjs` (manifest-driven, asymmetric: remove tools, keep evidence) + test.
3. Wire the single consent gate into `security-review-journey` preflight (reads tool-detect +
   package-readiness + auth), with the two distinct consents.
4. `run-scans` consumes tmp-installed tools when present; PENDING-OWNER-RUN otherwise (unchanged honesty).
5. Cold-validate (gate + install + full suite + cleanup) → tag.

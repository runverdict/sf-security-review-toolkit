# 0.6.0 integration validation — PRE-COMMITTED pass condition (write-before-run)

Pre-committed 2026-06-19 by the author of the 0.6.0 work, BEFORE the run. **Grade
COLD in a fresh, restarted session** (the author is the worst grader; the plugin
loads on restart). A clean PASS → **tag 0.6.0**.

0.6.0 adds the **consented, tmp-scoped scanner install**: the preflight runs a quick
scan (scope + `tool-detect` + `package-readiness` + `sf` auth), then raises ONE
up-front gate with **two distinct consents** — (1) ask-tolerance, (2) install the
missing scanners to a tmp dir for this run. On the install-yes the run installs the
scanners to `/tmp/sf-srt-scanners/<runid>/` (sha256-pinned binaries), `run-scans`
uses them to emit REAL evidence, and `cleanup-scanners` removes the binaries while
KEEPING the evidence. This bar proves that lifecycle end-to-end on a real fixture —
the output the owner asked to SEE (real DAST/TLS/SAST instead of `PENDING-OWNER-RUN`).

## Setup
- Plugin = **main HEAD** (the 0.6.0 build, commits `ace27e3…033f59c`). Refresh +
  restart first: `claude plugin marketplace update runverdict-plugins` then
  `claude plugin update sf-security-review-toolkit@runverdict-plugins`.
- Fixture = **`~/srt-coldstart-full`** ("Atlas" — managed pkg + Agentforce + MCP +
  an external Node/Python API). It carries the external source roots that drive the
  external-SAST (Semgrep), SCA (OSV-Scanner), and secret-scan families, so an
  install-yes has something real to scan. Any fixture with a non-package source root
  works.
- The host has the install prerequisites (python3+venv, npm, git, curl, tar; `unzip`
  optional — the zip path falls back to `python3 -m zipfile`). No scanners
  pre-installed (only `sf`).
- **Permission mode:** the operator enters auto-accept (shift+tab) at the start — the
  documented honest constraint (the toolkit cannot flip CC's permission mode). The
  gate consolidates the toolkit's OWN confirmation into one prompt; CC's permission
  mode is the user's separate boundary.
- Run: `claude` in the fixture → "run the security review", full-auto.

## PART A — the SINGLE gate, TWO DISTINCT consents, fires ONCE
- **A1 — the preflight quick-scan ran `tool-detect` up front.** The single preflight
  report lists the `installable_missing` scanners (e.g. semgrep (pip), osv-scanner
  (binary v2.4.0), checkov (pip), gitleaks/detect-secrets, …) — gathered BEFORE the
  gate, not discovered mid-run. `zap` is NOT offered for install (it is owner-run).
- **A2 — two distinct consents in ONE gate.** The report's single gate presents both
  (1) ask-tolerance (full-auto vs guided) AND (2) the scanner-install offer naming the
  tmp dir + that the tools are removed at cleanup / evidence kept. The install consent
  is **explicit-yes-only** — it is NOT taken on silence (it is grouped with the
  live-probe / scratch-org floor, never as a silence-is-yes power-up).
- **A3 — the install consent is genuinely raised.** With installable scanners present,
  the run pauses for the install yes/no (an AskUserQuestion or an explicit prompt) — it
  does NOT auto-install on silence (that would be the 0.5.4 P0 regression).
- **A4 — fires ONCE, then prompt-free.** After the single gate (consents given), the
  install runs and the scans proceed with **no further toolkit install prompts** — no
  per-tool or per-scan re-asking. (CC may surface its own permission prompt for the
  `node install-scanners.mjs` Bash call if the operator is NOT in auto mode — that is
  CC's boundary, not a toolkit re-ask.)

## PART B — REAL evidence on disk (the owner's goal)
On the install-yes path, after the run:
- **B1 — the tmp install happened, sha256-verified.** `/tmp/sf-srt-scanners/<runid>/`
  exists with an `install-manifest.json`; its `installs[]` records the tools as
  `status:"installed"`, `runnable:true`, with the pinned `version` + `checksum` for the
  binaries. The project pointer `<fixture>/.security-review/scanner-install.json` lists
  the installed tools + a non-empty `pathPrepend`.
- **B2 — real scanner evidence, NOT PENDING stubs.** `<fixture>/.security-review/evidence/`
  contains **non-empty** real reports for the families the installed tools cover, e.g.
  `semgrep-<date>.json` (external SAST), `osv-<date>.json` (SCA), `secret-scan-<date>.json`
  — produced by the tmp-installed tools, not a `PENDING-OWNER-RUN` placeholder. (Which
  exact families fire depends on the fixture's source roots; at least the external-SAST
  + SCA + secret families must yield real JSON.)
- **B3 — honest fallback for what stayed absent.** Any family whose tool was NOT
  installed (no pin / not offered, e.g. an owner-portal Checkmarx or an owner-run ZAP
  DAST with no staging URL) is still `PENDING-OWNER-RUN` with the exact command — the
  toolkit does not fake those.

## PART C — cleanup is asymmetric (remove tools, KEEP evidence)
- **C1 — the tmp tools are gone.** After cleanup runs (end-of-run or `stay-listed`),
  `/tmp/sf-srt-scanners/<runid>/` no longer exists.
- **C2 — the evidence survives.** Every `evidence/*.json` from PART B is still present
  and byte-for-byte intact under `<fixture>/.security-review/evidence/`.
- **C3 — the pointer is marked cleaned.** `<fixture>/.security-review/scanner-install.json`
  has `status:"cleaned"` and `pathPrepend:[]`, so a later run knows the tmp tools are gone.

## PART D — the DECLINE / standalone path (the P0 floor still holds)
A separate spot check (decline the install, or a standalone `run-scans` with no gate):
- **D1 — no install on decline/silence.** No `/tmp/sf-srt-scanners/` dir is created;
  the host is unmutated.
- **D2 — families stay PENDING-OWNER-RUN.** The external-SAST/SCA/secret families
  report `PENDING-OWNER-RUN` with the exact install+run command — run-scans never
  self-installs (the 0.5.4 hard boundary holds in full).

## FAIL — any of these
- The run **auto-installs a scanner on silence / full-auto** without the explicit
  install-yes (the 0.5.4 P0 regression).
- A binary is executed without a matching sha256 (the manifest shows a tool
  `installed` whose checksum did not verify), or an unpinned/unknown-platform tool is
  installed instead of skipped.
- The install writes anything into the partner's SOURCE tree (anywhere outside
  `/tmp/sf-srt-scanners/` and the gitignored `.security-review/`).
- Cleanup **deletes an evidence file**, or removes anything outside the recorded tmp
  root, or REFUSES on a valid root and leaves the tmp tools behind, or a malformed
  tmpRoot causes an `rm` outside the tmp dir.
- The toolkit asks for install consent **more than once** for the same run, or re-asks
  per tool/per scan after the single gate.
- A family is marked HAVE/done with no evidence file, or a `PENDING-OWNER-RUN` family
  is silently dropped.
- Any `acceptance/test-*.mjs` is red on the 0.6.0 plugin.

## Grading method (cold, off-disk)
- **Gate:** `grep` the transcript for the single preflight report — confirm it lists
  the installable scanners AND presents both consents; confirm exactly ONE install
  consent point, and that it is explicit (not silence-is-yes). Confirm no per-tool
  re-asks after it.
- **Install (B1):** `cat /tmp/sf-srt-scanners/*/install-manifest.json` → installs[]
  `status:"installed"`, `runnable:true`, binaries carry `version`+`checksum`; the
  pointer lists the tools + a non-empty `pathPrepend`. (Grade BEFORE cleanup runs, or
  from the transcript if cleanup already ran — the manifest is removed with the tmp dir.)
- **Evidence (B2/B3):** `ls -l <fixture>/.security-review/evidence/` + check the
  semgrep/osv/secret JSONs are non-empty and parse; confirm any absent family is
  `PENDING-OWNER-RUN` with a command.
- **Cleanup (C1/C2/C3):** `test -d /tmp/sf-srt-scanners/<runid>` → absent;
  `ls <fixture>/.security-review/evidence/` → the same files still present, non-empty;
  `cat <fixture>/.security-review/scanner-install.json` → `status:"cleaned"`,
  `pathPrepend:[]`. Re-run `node harness/cleanup-scanners.mjs --target <fixture>` →
  `already-clean`, removes nothing (idempotent).
- **Suite:** `for t in acceptance/test-*.mjs; do node "$t"; done` → all green (the pass
  is ZERO failing files; the suite grows each checkpoint — 17 files / 161 checks at the
  0.6.0 head, higher later is expected, not a regression).
- **Decline (D1/D2):** in a second run (or the same, declining), confirm no
  `/tmp/sf-srt-scanners/` dir and the families fall back to `PENDING-OWNER-RUN`.

NOTE — scope: this bar grades the **0.6.0** consented-install lifecycle (gate →
install → real evidence → asymmetric cleanup) + that the P0 no-silent-install floor
still holds. It does NOT re-grade the 0.5.x triage/withhold/SCI behavior (those are
already tagged + cold-validated). A clean PASS here → tag 0.6.0 at its commit.

# 0.7.0 integration validation — PRE-COMMITTED pass condition (write-before-run)

Pre-committed 2026-06-19 by the author of the 0.7.0 work, BEFORE the run. **Grade
COLD in a fresh, restarted session** (the author is the worst grader; the plugin
loads on restart). A clean PASS → **tag 0.7.0**.

0.7.0 adds the **throwaway prod-equivalent DAST harness**: the gate gains a third
consent; on yes the toolkit stands the partner's external backend up as a disposable,
isolated throwaway (synthetic secrets), runs a digest-pinned ZAP against THAT, keeps
the evidence, and destroys the throwaway. The active scan only ever hits a mirror the
toolkit built — never live prod / Salesforce infra / a third party. This bar proves the
full `standup → run-dast → teardown` chain end-to-end, the credential contract, the
loopback boundary, and the asymmetric teardown.

## Setup
- Plugin = **main HEAD** (the 0.7.0 build). Refresh + restart first:
  `claude plugin marketplace update runverdict-plugins` then
  `claude plugin update sf-security-review-toolkit@runverdict-plugins`.
- Fixture = **`~/srt-coldstart-full`** (Atlas — its Node `server/` forecast API is a
  `runnable` stack: `npm start`, port 8080, env `ATLAS_JWT_SECRET`/`ATLAS_API_KEY`
  synthesizable). Host has Docker (daemon up).
- Permission mode: auto-accept (shift+tab) at the start (the honest constraint).
- Run: `claude` in the fixture → "run the security review", full-auto, and at the gate
  say **yes** to the throwaway-DAST consent.

## PART A — the THIRD gate consent
- **A1 — stack-detect ran in the preflight** and the single gate offers the third consent
  ("stand up your backend as an isolated throwaway + active-scan it?"), distinct from the
  scanner-install consent, explicit-yes-only (not silence-is-yes).
- **A2 — the chain runs on yes.** With Atlas `runnable`, the run invokes
  `standup-stack → run-dast → teardown-stack` autonomously (no per-step re-asking).

## PART B — real DAST evidence, honestly labelled
- **B1 — the throwaway stood up.** During the run a `sf-srt-stack-<id>` container is up on
  `127.0.0.1:8080` (localhost only); `/healthz` 200.
- **B2 — real ZAP evidence on disk.** `<fixture>/.security-review/evidence/dast/`
  contains a non-empty `zap-throwaway-local-<id>.json` (a real ZAP report, alerts parse)
  **AND** `README-throwaway-dast.md` stating it is the local-throwaway scan, **NOT** the
  production-equivalent submission scan. The evidence file is **host-owned** (not root).
- **B3 — honest labelling in the report.** The readiness output / run log calls this DAST
  **local-throwaway** (corroborating + a dry run), never the production submission scan,
  and notes Salesforce pen-tests regardless.

## PART C — the credential contract (CONVENTIONS §6)
- **C1 — no secret VALUE in any state file.** `grep` the stack manifest
  (`/tmp/sf-srt-stack/<id>/stack-manifest.json`), the project pointer
  (`.security-review/stack-standup.json`), and the run log for a synth secret value
  (a 48-hex token) — **none present**; the manifest records `synthEnvNames` (NAMES) only.
- **C2 — no secret on the docker argv.** `ps` during the run shows no `-e SECRET=<value>`
  on the `docker create` line (synth values go via a `0600` `--env-file`).
- **C3 — no captured container logs.** The manifest's `log` field is a generic toolkit
  message, never `docker logs` output.

## PART D — the loopback boundary (the safety invariant)
- **D1 — run-dast REFUSES a non-loopback target.** `node harness/run-dast.mjs --base-url
  https://api.example.com --target <fixture> --consent` exits non-zero with
  "refusing to active-scan a non-loopback host" — the active scan can only hit a local
  throwaway. (Off-disk check, not part of the journey run.)

## PART E — asymmetric teardown + orphan sweep
- **E1 — the throwaway is destroyed.** After the run, no `sf-srt-stack-<id>` container
  exists, `127.0.0.1:8080` is dead, and `/tmp/sf-srt-stack/<id>/` is gone.
- **E2 — the evidence survives.** `zap-throwaway-local-<id>.json` + the README note are
  still present under `.security-review/evidence/dast/`.
- **E3 — the sweep is name-scoped + safe.** `node harness/teardown-stack.mjs --sweep`
  returns `swept`/`already-clean` and only ever lists `sf-srt-stack-*` / `tmp:` removals.

## PART F — needs-secrets path (spot check; test-backed)
- **F1 — scaffold-and-guide.** On a `needs-secrets` repo (or a synthetic one), `scaffold-env`
  writes a stub naming the external keys in `/tmp/sf-srt-stack/<id>/` (NOT the repo);
  `--check` reports WAITING until filled, READY after; `standup-stack` refuses an unfilled
  env-file. (The `runnable` Atlas path doesn't exercise this; it is locked by
  `test-scaffold-env` + `test-standup-stack` U7.)

## FAIL — any of these
- A secret VALUE appears in the manifest, the pointer, the run log, the evidence, or the
  `docker create` argv.
- `run-dast` scans a non-loopback host, or the container publishes on `0.0.0.0` / a public
  bind.
- The throwaway is left running after the run (no teardown), or teardown removes a
  non-`sf-srt-stack-` resource, or deletes an evidence file.
- The DAST evidence is presented as the production-equivalent submission scan (missing the
  local-throwaway label).
- The chain runs on silence (no explicit third-consent yes), or re-asks per step.
- Any `acceptance/test-*.mjs` is red on the 0.7.0 plugin.

## Grading method (cold, off-disk)
- `grep -rE '[0-9a-f]{48}'` the manifest + pointer + run log → no synth secret value.
- `ls -l <fixture>/.security-review/evidence/dast/` → `zap-throwaway-local-*.json`
  (non-empty, host-owned) + `README-throwaway-dast.md`.
- `docker ps -a --filter name=sf-srt-stack-` (after the run) → empty.
- `node harness/run-dast.mjs --base-url https://api.example.com --target <fixture>
  --consent` → non-zero + "non-loopback host".
- `node harness/teardown-stack.mjs --sweep --json` → name-scoped result.
- `for t in acceptance/test-*.mjs; do node "$t"; done` → all green (ZERO failures; the
  count grows each checkpoint — 22 files / 190 checks at the 0.7.0 head).

NOTE — scope: this grades the **0.7.0** throwaway-DAST lifecycle (gate → stand-up →
loopback-scoped active scan → asymmetric teardown) + the credential contract. The
authenticated, endpoint-fed AF-plan depth (slice 5b) is out of scope (still to build). A
clean PASS → tag 0.7.0 at its commit.

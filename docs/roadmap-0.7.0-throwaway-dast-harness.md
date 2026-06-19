# 0.7.0 — Throwaway prod-equivalent DAST harness (autonomous, consented)

**Status: vision captured + the core loop PROTOTYPED end-to-end (2026-06-19). Engines
not yet built.** This is the server-tier analogue of the deployed-org deep audit, and it
reuses the 0.6.0 install/cleanup machinery wholesale. Owner-pitched (Aiden); committed
here so it stays picked up. Build in slices off the 0.6.0 engines.

## Prototype validation (2026-06-19) — the loop WORKS

Proven manually against the Atlas cold fixture (`~/srt-coldstart-full`, its Node
`server/` external API), de-risking the whole design:
1. **Stand up** — the Atlas Express API stood up as an isolated throwaway Docker
   container (`node:18-alpine`, a **synthetic** `ATLAS_JWT_SECRET`, published on
   `127.0.0.1:8080`); `/healthz` → 200 in ~6s.
2. **Discover + reach** — `/healthz` and the auth'd `POST /v1/forecast` both reachable;
   the unauthenticated probe reproduced the planted **stack-trace leak on 401**.
3. **The credential contract, working** — because the toolkit *provisioned* the
   throwaway's secret, it **minted its own JWT** with that secret → authenticated
   `POST /v1/forecast` → 200. No real partner secret needed for an authenticated scan.
4. **Real DAST** — **ZAP, digest-pinned** (`zaproxy/zap-stable@sha256:7c2f8afc893e4e4000be8ad3fd22013fc36e5cce59359349f5a2d45626e2ccb9`),
   run via `--network host` against the throwaway → a real 14.5 KB JSON report, **6
   alerts** (CSP missing, X-Powered-By info leak, X-Content-Type-Options missing, …) +
   61 passive checks passed. Confirms the **Docker-digest ZAP** path (strongest pin +
   bundles the JRE) is the right acquisition choice.
5. **Asymmetric teardown** — throwaway container + stack dir destroyed, port dead, **the
   evidence kept**, zero docker residue.

**Two design lessons the prototype surfaced (fold into the engine build):**
- **Containerize, don't bind-mount the source.** A container writing `node_modules` to a
  host-mounted volume writes them as **root**, so the host user can't clean them up
  (teardown hit `Permission denied`). Fix: COPY the source INTO the container (image
  layer / `docker cp`) so the throwaway's working tree is ephemeral *inside* the
  container and dies with `docker rm`; only the EVIDENCE is extracted to the host. Run
  `--user` as a backstop. (Cleaner isolation, and teardown never touches root-owned host
  files.)
- **Feed endpoints via the AF plan, not a hand-rolled OpenAPI.** ZAP's OpenAPI importer
  rejected a hand-written spec (strict parser). Use the existing
  `harness/zap/zap-plan-template.yaml` Automation Framework plan (filled from the
  discovered endpoint inventory + the minted token) for the authenticated, endpoint-fed
  active scan — the baseline scan proved the loop; the AF plan is the depth.

## The vision (owner intent)

> Build it into the up-front gated questions, next to "install scan packages to tmp +
> run scans? yes/no": a third — "stand up a throwaway prod stack and run DAST against
> it? yes/no". **Either answer proceeds autonomously** — each task gets marked *toolkit-
> does-this* or *owner-does-this*. Anything it can't find, it asks a clarifying question.
> On yes, if it can't find the credentials the stack needs, it asks approval to look for
> them; if it still can't, it **guides the user to exactly where to drop them** (in the
> directory/stack it created), the user confirms they're in place, and the autonomous
> loop **resumes**. Take the manual guesswork out; put the partner in the best possible
> position for the actual SF review.

## The organizing principle — *throwaway-everything*

The active DAST scanner sends real attack payloads (injections, auth-bypass, fuzzing),
so the rule is **fire it at a disposable, production-*equivalent* mirror with synthetic/
no real data, then destroy it** — never live production, never Salesforce's infra
(`*.salesforce.com` is THEIR pen test and out of bounds), never anyone else's anything.
**No boundary is crossed because the target is your own crash-test dummy.**

The toolkit already does exactly this on the package side. 0.7.0 makes it symmetric:

| ephemeral target | for | lifecycle |
|---|---|---|
| throwaway **scratch org** | the deployed-package audit | stand up → audit → tear down |
| throwaway **prod-equivalent server** | the external-endpoint DAST | stand up → scan → tear down |
| **tmp scanner dir** (0.6.0) | running the scanners | install → use → remove (keep evidence) |

All three: ephemeral, consented-because-live, torn down **keeping the evidence**.

## The gate — one up-front matrix of independent consents

Extends the 0.6.0 two-consent gate to three:

1. **Mode** — full-auto vs guided (inferred from phrasing).
2. **Install scanners to tmp?** — explicit yes (network install; the 0.5.4 P0 class).
3. **Stand up a throwaway DAST stack + scan it?** — explicit yes (a live op + resource
   use + an active scan).

**Either answer to (2)/(3) proceeds autonomously.** A *no* marks that work
`owner-does-this` (DAST stays `PENDING-OWNER-RUN` with the generated plan + the exact
commands); a *yes* marks it `toolkit-does-this` and the toolkit owns the
stand-up → scan → teardown. That *toolkit-vs-owner* mark **is** the existing
"Automated vs. owner-run" honesty recap (CONVENTIONS §2) — the gate answers just decide
which side of that line each task lands on. The live/network consents are
explicit-yes-only; silence-is-yes never covers them.

## The autonomous resolve → clarify loop

The whole point is to ask the *minimum*, and only for what genuinely can't be resolved.

1. **Deterministic auto-resolve first (the preflight quick-scan).** Resolve everything
   the repo/org already states:
   - the **run recipe** — `docker-compose.yml` / `Dockerfile` / Procfile / a documented
     start command;
   - the **web tier** to scan + its port(s);
   - the **endpoint inventory** — autofilled from the authed org (Remote Site Settings,
     CSP Trusted Sites, Named-Credential URLs, the MCP registration) + the running
     instance's routes + the OpenAPI artifact;
   - the **env requirements** — the *names* of the vars the stack needs (from
     `.env.example`, compose `environment:` keys, documented vars);
   - a **test user / token** path for the *authenticated* scan (a seed script, a
     fixtures user).
2. **For the unresolvable, clarify — bounded by sensitivity.**
   - *Non-sensitive* (which compose service is the web tier, which port): infer + flag,
     or ask one cheap question.
   - *Sensitive* (credentials/secrets): the special path below. Never guessed, never
     scraped.

## Credentials — the one part that needs real care (CONVENTIONS §6)

This is a security toolkit; mishandling secrets in the tool that *preps security reviews*
is the cardinal sin. The contract:

- The toolkit discovers **what** secrets the stack needs (the *names*, from declared
  sources) — **never the values**, and never by scraping arbitrary locations.
- It may ask consent to read **one specific declared source** that might hold them
  (e.g. "may I read `./.env` to populate the throwaway?"). Yes → use them only to run
  the throwaway, in-memory / in the throwaway's own env. No → the scaffold path:
- **Scaffold-and-guide-and-resume.** The toolkit writes an **empty env stub** at the
  throwaway's location, tells the user the **exact keys** to fill and **exactly where**
  (the path it created), and **waits**. The user drops the values in and confirms. The
  toolkit re-checks **deterministically** (are the required keys now non-empty?) and
  **resumes the autonomous loop**.
- **Secret VALUES are NEVER persisted** into `.security-review/` state, the manifest, the
  evidence, or the run log — they live only in the throwaway's runtime env, and the
  throwaway (env and all) is destroyed at teardown. The toolkit refuses to write a
  captured credential anywhere durable and says where it belongs (env/vault).

This is the honest version of "ask for the credentials": discover the *names*, consent
to read a *declared* source, else scaffold + guide + confirm + resume — and burn the
values at teardown.

## Honest boundaries (do not relitigate)

- **Prod-equivalence is bounded by the repo's recipe.** Where real prod leans on external
  managed services (a hosted DB, third-party APIs), the throwaway is *approximate* — the
  evidence is **labelled with exactly how faithful the mirror was** (services stubbed,
  data synthetic). Never claimed as a perfect prod replica.
- **Isolation.** The throwaway runs in its own network/project, no real data, no link to
  the partner's real infra; the scan hits localhost / the throwaway's container network.
- **Guaranteed asymmetric teardown.** The stack is ALWAYS torn down — on success, failure,
  or abort — keeping the evidence. Never leave a half-built prod stack (with secrets in
  its env) lying around. Same discipline + safety guards as `cleanup-scanners`
  (manifest of created resources; refuse to tear down anything not recorded).
- **Active scan = a consented live op**, even against your own throwaway (resource use +
  an active scan). But the consent is trivial and there's no staging-vs-prod ambiguity:
  the toolkit *built* the target as a known-throwaway.
- **Preparation, not a pass.** Salesforce pen-tests the surface regardless; and the
  *submitted* DAST evidence must ultimately be production-equivalent — the local
  throwaway is the toolkit's corroborating evidence + a de-risking dry run + "real DAST
  on cold runs," never a substitute for the owner's production-equivalent submission scan
  where the throwaway was only approximate.

## Reusable machinery — the 0.6.0 engines are the template

| 0.6.0 (scanners) | 0.7.0 (the stack) |
|---|---|
| `tool-detect.mjs` (what's present/installable) | `stack-detect.mjs` (run recipe + web tier + env-name requirements) |
| `install-scanners.mjs` (consented, isolated, manifest of created paths, teardown-able) | `standup-stack.mjs` (consented, isolated, manifest of created **resources**: containers/networks/volumes/env-stub, teardown-able) |
| `cleanup-scanners.mjs` (asymmetric: remove tools, KEEP evidence; refuse unrecorded) | `teardown-stack.mjs` (asymmetric: remove the stack, KEEP evidence; refuse unrecorded; guaranteed on abort) |
| the single consent gate | + the third consent |
| ZAP via **Docker digest** | the scan container in the throwaway's network (strongest pin + bundles the JRE — folds in instead of a one-off install) |

The safety disciplines transfer verbatim: a manifest of exactly what was created, an
`assertSafe*` guard so teardown can never touch anything it didn't make, fail-closed on a
malformed manifest, and "keep the evidence" as a structural invariant.

## Build order (slices — each test-backed + committed, off the 0.6.0 base)

1. **Endpoint-discovery autofill** — DAST/TLS plan targets from the authed org + routes +
   OpenAPI. *(deferred — the baseline ZAP scan works without it; folds into slice 5b.)*
2. ✅ **`stack-detect.mjs`** — `runnable | needs-recipe | needs-secrets | n/a` + env class.
3. ✅ **`standup-stack.mjs` + `teardown-stack.mjs`** — consented isolated stand-up (copy-in,
   synth secrets, resource manifest) + asymmetric name-scoped guaranteed teardown.
4. ✅ **Gate third-consent + toolkit-vs-owner marking** wired into the journey preflight + run.
5. ✅ **DAST against the throwaway** — `run-dast.mjs`: digest-pinned ZAP → host-owned
   evidence under `evidence/dast/`, labelled local-throwaway. *(5b: authenticated,
   endpoint-fed AF-plan pass with a minted token — depth refinement, still to do.)*
6. ✅ **The credential scaffold-and-guide-and-resume loop** — `scaffold-env.mjs` (env stub
   in tmp, deterministic filled-check) + `standup-stack --env-file`.
7. **Cold-validate against `~/srt-coldstart-full` (Atlas)** — the full
   `standup → run-dast → teardown` through the journey gate → real evidence → torn down,
   evidence kept. Pre-committed pass condition; grade cold off disk → tag. **← next.**

**Slices 2–6 built + committed + validated (the engine chain is real and Atlas-smoked
end-to-end). Remaining: the cold-validation (slice 7) + the slice-5b authenticated depth.**

## Open questions to settle during the build

- **Stand-up engine vs detect-only first**: starting a stack is intrusive/fragile vs
  detecting an already-running local instance. Likely: detect-running → else offer
  consented stand-up where a recipe exists → else owner-run. Decide per slice 3.
- **ZAP acquisition** (Docker-digest vs TOFU-zip vs owner-run) is subsumed here: if the
  throwaway is containerized, Docker-digest ZAP is the natural, strongest-integrity fit.
- **Fidelity labelling vocabulary** — how the evidence states "DB synthetic, payment API
  stubbed, auth real" so the owner knows what their production scan still must cover.

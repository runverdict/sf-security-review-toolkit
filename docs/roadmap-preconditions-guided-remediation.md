# Roadmap — Preconditions & guided remediation (the "why-blocked, ask-don't-default" contract)

**Status: design (prompted by the Solano cold-run preflight, 2026-06-20). Not yet built.**

> **Related shipped (0.8.108):** the doc's core *ask-don't-default* principle landed for the
> partner-program / SCI gate — `compute-sci` now computes `process-partner-program-prerequisites`
> FROM the manifest `operatorConfirmed` block (write-only before), and `compile-submission` ASKS
> any not-recorded partner-program answer at the SCI step instead of defaulting, so an operator
> "No" now blocks a green SCI. The doc's own numbered slices (deep-audit live precondition,
> stack-detect/tool-detect needs-input, scope detectors, messy-repo fixture) remain still-design.
The Solano preflight offered the deployed-org deep audit as "✦ READY" for a package that
**cannot be installed** — its `04t` is a synthetic alias and its namespace is unregistered.
Claiming a capability is available when it will fail is a CONVENTIONS §2 honesty violation, not
just a UX rough edge. This roadmap closes that class and the broader "silently degrades to
owner-run" pattern it belongs to.

## The gap

The toolkit conflates **"a precondition's static signal is present"** with **"the capability
will actually run."** Two failure modes:

1. **False READY.** A capability is offered as available because a *static* signal looks right,
   when a *live* precondition would fail. The instance: `package-readiness` (a pure static
   engine) reads a real-shaped `04t` in `sfdx-project.json` and reports `installable` — it never
   verifies the version *resolves* in the Dev Hub. So a placeholder/synthetic `04t` sails
   through to "deep audit READY," and the install would fail mid-run.
2. **Silent degrade.** When a detector can't *find* something, it defaults to "owner-run"
   without saying why or what's missing. On the clean fixtures this reads fine; on a real,
   messy partner repo "couldn't find the start command / the endpoint inventory / the source
   root" usually means *"it's there, just not where I grepped"* — which the operator can
   resolve in one sentence, if only the toolkit asked.

Both erode the toolkit's core pitch (honesty + operator trust), and both are **under-tested**
because every fixture is clean and well-structured by construction.

## The contract — three precondition states (never silently degrade)

Every autonomous capability / power-up MUST resolve its precondition into exactly one of:

- **`ready`** — offer / run it.
- **`blocked { reason, remediation }`** — do NOT offer as ready. Surface the *exact* failed
  precondition + *concrete* enabling steps (commands, not prose). E.g. deep audit:
  *"`sf package version report -p 04t…` finds no such version in your Dev Hub, and namespace
  `solano` isn't registered → there's no released package to install. Enable: bind a real
  released `04t` (`sf package version list`), or cut + promote a 2GP (register + link the
  namespace first — `namespace-check` confirms)."*
- **`needs-input { what, where-it-might-be, how-to-supply }`** — the toolkit couldn't *find*
  it but it may exist. **ASK the operator to point at it / supply it**, deterministically
  re-check, and resume. Degrade to owner-run only after the operator declines or genuinely
  can't. E.g. DAST: *"No start recipe found for `server/` (Dockerfile has no `CMD`, no compose,
  no `npm start`). Give me the start command + port and I'll stand up the throwaway; else it
  stays owner-run with the generated ZAP plan."*

**Invariant:** no capability is ever shown as READY, or silently downgraded to owner-run,
without resolving one of these three *with a stated reason.* This is the load-bearing test.

## The asymmetry to fix first (the concrete instance)

The **build** offer (`needs-build` path) is already gated by a *live* `namespace-check` that
returns `ready` / `blocked + remediation` ("register + link the namespace, then re-run"). The
**install / deep-audit** offer (`installable` path) has **no live gate** — `package-readiness`
is pure-static. Fix: a live deep-audit precondition that verifies the `04t` resolves
(`sf package version report`/`list` against the Dev Hub) AND reuses `namespace-check`, gating the
offer the same way. `package-readiness` stays pure (it reports the static fact "an `04t` alias
is present"); the *offer* is gated by the live check — mirroring how the build offer is gated.
Symmetry restored, honesty restored. (Note: this is the next layer past the 0.5.4 hardening,
where `installable` was already tightened to require the `04t` be bound to the configured
package rather than matching any `04t`; that fixed a stale/dependency alias, this fixes a
real-shaped but non-existent version.)

## Per-engine map (what exists vs. the gaps)

| precondition engine | `ready` | `blocked + remediation` | `needs-input (ask)` |
|---|---|---|---|
| `namespace-check` (build offer) | ✓ | ✓ register + link | n/a |
| `docker-check` (throwaway DAST) | ✓ | ✓ install hint | n/a |
| **`package-readiness` (deep-audit offer)** | static only | **✗ — no live verify (the bug)** | ✗ |
| **`stack-detect` (DAST stand-up)** | ✓ runnable | partial (needs-recipe / needs-secrets) | **✗ — degrades, doesn't ask for the start cmd** |
| **`tool-detect` (scanners)** | ✓ | ✓ installable-on-consent | **✗ — owner/portal, doesn't ask for a custom path** |
| **scope / artifact detection** | ✓ | — | **✗ — couldn't-find → silent gap; should ask "where is your X?"** |

## The "couldn't find → ask" principle (real-repo robustness)

A detector must distinguish **"definitively absent"** from **"couldn't locate"** and, for the
latter, ask the operator to point at it (with a deterministic re-check + resume) before
degrading. Bounded by sensitivity, exactly as the 0.7.0 throwaway-DAST roadmap already specifies
for credentials: non-sensitive (which source root, which port, which start command) → infer +
flag, or one cheap question; sensitive (secrets) → the `scaffold-env` guide-and-resume path. The
work is making this *uniform* across every detector — not just the DAST credential loop where it
already lives. The driving reality: the toolkit will meet 2,000-file monorepos with the start
script three directories deep and the endpoint inventory in a YAML the detector didn't parse;
"owner-run by default" silently undersells what the toolkit could have done with one question.

## Coverage — the messy-repo fixture

The fixtures are clean by construction, so the `needs-input` branch is unexercised. Build a
deliberately-**messy / missing-information** fixture: a non-standard layout (the start script
three levels deep, endpoints in an unparsed YAML, a second source root the detector misses, a
package with no released version) — and prove the toolkit *asks* (and recovers on the operator's
answer) rather than silently degrading. This is the acceptance discipline applied to the new
contract: each `blocked` / `needs-input` path validated by a fixture that triggers it.

## Build order (slices — each encode-don't-park, build-on-main, no tag)

1. **Deep-audit live precondition** (the concrete bug): gate the deep-audit *offer* on a live
   `04t`-resolves + namespace-registered check; `blocked` surfaces the remediation. Standing
   test: the offer renders READY only when both pass; otherwise the reason + fix render, and the
   doomed install is never attempted.
2. **Generalize the three-state shape** into a shared result + retrofit `stack-detect`
   (`needs-input`: ask start command / port) and `tool-detect` (`needs-input`: ask a custom path).
3. **Scope / artifact detectors** — "couldn't find your authn flow / endpoint inventory / source
   root? point me at it" before degrading; resume on the operator's answer.
4. **Messy-repo fixture** + cold-validate the `needs-input` branch (the toolkit asks, recovers,
   proceeds), graded off disk.

## Honest scope (not in scope)

This concerns the toolkit's OWN preconditions + guidance — it does NOT change the
read-only-on-partner-source contract, and the remediation guidance is advisory (cite the SF
command / doc), never executed without consent. It improves *how the toolkit degrades*, not what
it audits.

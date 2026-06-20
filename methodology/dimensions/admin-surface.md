# Dimension: admin-surface

The privileged plane: an operator/admin console, super-admin endpoints, or any
role that can act across tenants or reach another tenant's data. Applies when
the scope manifest shows a privileged operator surface — the **highest-value
target in a multi-tenant product**, because a break here is cross-tenant by
construction (one compromised operator session reaches every customer). When a
product has this surface, this dimension is never optional.

## 1. Threat concept

Everywhere else in the audit, a vulnerability leaks one tenant. Here, a single
defect leaks all of them — so the bar is not "is the admin plane secured like
the customer plane" but "is it a **separate, stronger** plane that the customer
plane cannot cross into." The review's cross-tenant isolation test (baseline:
`endpoint-multi-tenant-isolation`) and its authn/authz documentation
requirement (baseline: `artifact-authn-authz-flow-doc`,
`artifact-access-control-permsets`) both land hardest here, and the 2026
identity mandates (baseline: `post-pkce-refresh-rotation-mandate`) raise the
floor on token rotation for exactly these high-privilege credentials.

The sub-classes, in descending order of blast radius:

1. **Plane confusion — customer token accepted as admin (or vice versa).** One
   signing secret for both populations, or distinct secrets without an enforced
   `aud`/`typ`/`iss` check, lets a customer-issued token authenticate an admin
   endpoint. This is the single scariest finding in the whole audit: it
   converts any customer-level foothold into operator-level cross-tenant
   access. (The cryptographic mechanics are
   `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/crypto-internals.md`; the
   *consequence* — that it breaches the admin plane — is owned here.)
2. **MFA/second-factor not actually enforced.** A TOTP/WebAuthn step that can be
   skipped: a session minted before the second factor is treated as fully
   authenticated, an endpoint that the MFA-gating dependency doesn't wrap, an
   enrolled-but-unconfirmed state that still reaches privileged routes.
3. **Privilege escalation within the plane.** A role-change endpoint a
   non-admin can call, a self-elevation path, mass-assignment of a `role` /
   `is_admin` / `is_service_account` field, or a multi-role write that
   contradicts the documented single-role model. In a managed package the
   platform analogue is **license-gate tampering**: runtime Apex calling
   `FeatureManagement.changeProtection(...)` to *unprotect* a packaged Feature
   Parameter — flipping off an entitlement gate so a subscriber gains
   capability they did not license (baseline:
   `violation-feature-management-change-protection`, the Critical PMD
   AppExchange rule `AvoidFeatureManagementChangeProtection`).
4. **The admin data path reaching tenant business data it shouldn't.** An admin
   console that can read raw tenant business records (rather than a redacted
   or aggregate view), or that runs under a database role with more than the
   read-only/operational scope it needs — turning a console bug into a direct
   data breach.
5. **Exposure and session hygiene.** The admin surface reachable on the public
   internet without network/IP constraints, refresh tokens that don't rotate
   (the 2026 mandate), sessions that don't revoke on logout, JWTs in
   `localStorage` exfiltrable by any XSS on the admin app, missing audit on
   role/permission changes, and break-glass/impersonation paths with no
   second-actor control or audit trail.

## 2. What good looks like

- **A physically separate identity store and credential.** Admin accounts live
  in their own table/store, not as a flag on customer users; the admin token is
  signed with a **distinct secret** from the customer token, and the distinction
  is asserted at startup (`ADMIN_SIGNING_SECRET != APP_SIGNING_SECRET`).
  Every admin verifier checks `iss`/`aud`/`typ` so a customer token is rejected
  structurally, not just by signature — and the customer verifier rejects admin
  tokens symmetrically (the boundary is tested in *both* directions).
- **MFA is mandatory and gates the privileged routes, not just login.** A
  single dependency/guard wraps every admin endpoint and requires a
  *confirmed* second factor; a session that enrolled-but-didn't-confirm, or
  authenticated the first factor only, cannot reach privileged routes. The
  TOTP secret is encrypted at rest with the same nonce discipline as any other
  credential (cross-reference crypto-internals §2).
- **Least privilege at the database, not just the app.** The admin console
  connects as a role scoped to exactly what it needs (read-only or a narrow
  operational set, still `NOBYPASSRLS`), and reads tenant audit/activity
  through a redacting view that strips before/after business state — so an
  admin bug cannot directly enumerate customer records.
- **Role changes are single-role, authorized, and audited.** Role mutation is
  admin-gated, sets exactly one role (delete-then-insert, never additive into a
  multi-role state), refuses self-elevation, and emits an audit event capturing
  actor, target, before/after — every consolidation reconstructible from the
  trail.
- **Refresh-token rotation with reuse detection.** Admin sessions rotate
  refresh tokens on every use and revoke the family on reuse (the 2026 mandate
  is strictest for these multi-org-reaching credentials); logout actually
  revokes server-side (a `jti`/session-id denylist, not just a client token
  drop); sessions have short TTLs.
- **Constrained exposure.** The admin surface is network-restricted (IP
  allowlist, VPN, or a separate hostname behind access controls) rather than
  openly internet-reachable; admin auth endpoints are rate-limited; the admin
  SPA stores its token in an httpOnly cookie or, if in `localStorage`, the app
  has a hardened CSP and no untrusted-HTML sinks (cross-reference
  `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/web-client.md`).
- **Break-glass and impersonation are controlled and logged.** Any "act as
  tenant"/support-impersonation path requires elevated authorization, is
  time-boxed, and writes an audit event distinguishing the operator from the
  impersonated user — no silent identity assumption.

## 3. Detection heuristics

Locate (a) the admin authentication path and its token/secret, (b) the
gating dependency on admin routes, (c) the admin database role, (d) the
role-mutation and impersonation endpoints.

**All stacks** — grep seeds: `admin`, `superuser`, `super_admin`, `staff`,
`is_admin`, `operator`, `console`, `impersonat`, `act_as`, `assume`,
`break_glass`, `totp`, `mfa`, `otp`, `webauthn`, `ADMIN_*_SECRET`,
`require_admin`, `iss`/`aud`/`typ` in token verification, `role` in PATCH/POST
bodies, a separate admin app directory (`apps/admin`, `admin/`, `backoffice/`),
a separate hostname in config/nginx.

| Stack | Where to look |
|---|---|
| Python (FastAPI/Django) | A separate router/app for admin routes; the admin auth service and its JWT mint/verify (distinct secret? `algorithms=` pinned? `aud`/`iss` asserted?); the `Depends(require_admin...)` / TOTP dependency and *which* routes actually carry it; a separate DB session/engine (`admin_session.py`-style) and the role its URL uses; Django admin (`/admin/`) exposure and `is_staff`/`is_superuser` gating, custom admin actions. The role-change route (`POST /users/{id}/role`) and whether it's additive or delete-then-insert. |
| Node (Express/Nest) | A separate admin module/guard (`@UseGuards(AdminGuard)`/`@Roles('admin')`) and which controllers it decorates; the admin JWT strategy + secret; a separate Prisma/TypeORM connection for admin; role-mutation DTOs (does the body whitelist exclude `role`/`isAdmin`?); the admin SPA's token storage. |
| Ruby (Rails) | A separate controller namespace (`Admin::`) + `before_action :require_admin`; `devise` admin scope or a separate model; Pundit/CanCanCan admin policies; `rails_admin`/`administrate`/ActiveAdmin mount point and its auth; strong-params permitting `role`/`admin` on a user update; impersonation gems (`pretender`, `switch_user`) and their audit. |
| Java (Spring) | `SecurityFilterChain` for an admin path pattern with `hasRole('ADMIN')`/`hasAuthority`; method-level `@PreAuthorize`; the admin JWT decoder + audience validation (`JwtDecoder`/`JwtClaimValidator`); a separate `DataSource` for admin; actuator endpoints (`/actuator/**`) exposure and their auth; role-setting controllers and DTO field binding. |
| Apex/LWC (where relevant) | Admin function via permission sets / custom perms rather than a separate plane; the probe is over-broad grants (`ModifyAllData`/`ViewAllData`/`AuthorApex`) on a permission set, custom-permission checks (`FeatureManagement.checkPermission`) actually enforced before privileged Apex, any `FeatureManagement.changeProtection(` call that toggles a packaged feature's protection state from runtime code (license-gate tampering — the Critical PMD AppExchange rule `AvoidFeatureManagementChangeProtection`; baseline `violation-feature-management-change-protection`), and any "run as / login as" support path. Cross-tenant doesn't apply within one org, but over-grant, license-gate tampering, and missing-perm-check do. |

Also locate: the network exposure of the admin surface (nginx/ingress config,
hostname, any IP allowlist), and the audit-write call sites on role/permission
changes (their absence is a finding).

## 4. Finder prompt block

```
Primary targets (read these first, then follow imports/call-sites; use grep to
locate the real files when a path is approximate):
{{TARGETS}}

Stack notes (claims from the partner's own docs — verify against the ACTUAL
code; the central question is whether the admin plane is a SEPARATE, STRONGER
plane the customer plane cannot cross into):
{{STACK_NOTES}}

Threat focus — the privileged cross-tenant plane (highest value: a break here
reaches EVERY tenant). Probe: PLANE CONFUSION — is the admin token signed with
a secret DISTINCT from the customer token, is that distinctness asserted, and
do BOTH verifiers check iss/aud/typ so a customer-issued token is rejected by
an admin endpoint AND an admin token is rejected by a customer endpoint? (A
shared secret, or distinct secrets with no enforced audience/type check, turns
any customer foothold into operator-level cross-tenant access — critical.) MFA
ENFORCEMENT — does a single guard/dependency require a CONFIRMED second factor
on EVERY privileged route, or can a first-factor-only / enrolled-but-unconfirmed
session reach admin endpoints? Find any admin route the MFA gate does not wrap.
PRIVILEGE ESCALATION — can a non-admin call the role-change endpoint, elevate
themselves, mass-assign a role/is_admin/is_service_account field on a
create/update, or write a multi-role state that contradicts a documented
single-role model? For a managed package, does any runtime Apex call
FeatureManagement.changeProtection(...) to UNPROTECT a packaged Feature
Parameter — flipping a license/entitlement gate off (license-gate tampering)?
ADMIN DATA PATH — can the admin console read raw tenant
business rows (vs a redacted/aggregate view), and what DB role does it connect
as — does that role have more than the read-only/operational scope it needs (or
worse, BYPASSRLS)? EXPOSURE & SESSION — is the admin surface reachable on the
public internet with no network/IP constraint; do refresh tokens rotate with
reuse detection (2026 mandate is strictest for these credentials); does logout
revoke server-side; is the admin JWT in localStorage exfiltrable by XSS; are
role/permission changes audited (actor, target, before/after); do break-glass /
impersonation paths require elevated authz and write a distinguishing audit
event?

Known findings — do NOT re-report any of these:
{{LEDGER}}

Report ONLY findings grounded in code you have READ, with exact file:line.
Prefer precision over volume — a false alarm on the admin plane wastes the most
expensive verification, and a real plane-confusion or missing-MFA finding is
critical: state plainly which. If a control is correctly implemented, do NOT
report it (one info-level note for a notably strong control is allowed). For
each finding give a concrete exploit_scenario: the attacker's starting position
(unauthenticated, a customer-tenant user, a low-privilege operator), the exact
request, and what cross-tenant or operator-level access it yields.
```

## 5. Verifier guidance

An admin-plane confirmation is — alongside cross-tenant — the most
consequential verdict the engine emits. Before confirming, read:

- **Both token verifiers and both minting paths.** A plane-confusion claim is
  refuted by distinct secrets *or* by enforced distinct `aud`/`typ` on both
  sides; it is confirmed by a shared secret with the distinguishing claim
  emitted-but-unchecked, or checked on only one plane. Read the actual decode
  calls — do not infer from variable names.
- **Which routes the MFA gate actually wraps.** Confirm the dependency/guard is
  on the *specific* cited route (decorator present, middleware order, router
  inclusion), and that it checks a *confirmed* factor — an enrolled-flag check
  that passes pre-confirmation is the bug. One unwrapped privileged route is
  the finding even if the rest are covered.
- **The role-mutation route's gate and write shape.** For escalation/
  mass-assignment claims: the auth dependency (who can call it), the
  serializer/DTO (does it accept the privileged field from the body), and
  whether the write is delete-then-insert single-role or additive. A
  framework that whitelists fields refutes mass-assignment; confirm the field
  isn't on the whitelist.
- **The admin DB role and the data view.** For "admin reads tenant data"
  claims, read the connection's role/grants and whether the query targets raw
  tables or a redacting view. `NOBYPASSRLS` + a read-only role + a redaction
  view refutes a direct-breach claim; a broad or BYPASSRLS role confirms it.
- **Exposure facts before severity.** Whether the admin surface is
  network-restricted changes severity materially — read the ingress/nginx
  config, not just the app. A missing refresh rotation on an internet-exposed
  admin plane is higher than the same on an IP-allowlisted one.
- **The audit write on privileged mutations.** Confirm the role/permission
  change actually emits an audit event (read the call site), and that
  impersonation writes distinguish operator from target — absence is the
  finding.
- **A missing privileged grant is fail-closed, not an escalation —
  directionality.** An admin permission/grant that is ABSENT (a role or
  permission not assigned, a class not granted) is fail-CLOSED — the privileged
  path cannot be used at all — so it is a functionality/packaging gap (`info` at
  most), never a finding. The admin-surface finding is always an OVER-grant or an
  over-broad assignment (an admin permission reachable by a low-privilege role,
  `BYPASSRLS`/`ModifyAllData` on a broadly-assigned permset), never an
  under-grant.

## 6. Known false-positive patterns

| Pattern | Why it is not a finding (or not at the reported severity) |
|---|---|
| Admin and customer tokens share a JWT library/format but use distinct secrets and enforce distinct `aud`/`typ` on both verifiers | The boundary is the secret + audience check, not the format. Distinct-and-enforced refutes plane confusion. |
| An admin route without its own MFA decorator that is mounted under a router-level guard already requiring confirmed MFA | The gate is inherited. Confirm the router-level dependency before flagging the individual route. |
| Role-change endpoint that accepts a `role` field but is admin-gated, refuses self-elevation, and does delete-then-insert | Working as designed. Mass-assignment requires the field to be settable by an *unauthorized* caller or to bypass the single-role write. |
| Admin console reading tenant audit/activity through a redaction view that strips business state | The intended least-privilege path — not a data-breach finding. The finding would be a route bypassing the view to raw tables. |
| Admin token in `localStorage` on an admin SPA with a hardened CSP and no untrusted-HTML sinks | XSS-exfil risk is bounded by the absence of an injection vector — note as hardening (httpOnly cookie is better), not a standalone finding, unless web-client finds a sink. |
| The admin surface on a separate hostname behind an IP allowlist / VPN | Constrained exposure is a control. "Admin endpoints exist" is not a finding; an *internet-open* admin plane is. Read the ingress config. |
| Single-role enforcement (one role per user) flagged as "no multi-role support" | Single-role is a deliberate, defensible model (mirrors major platforms' profile model). Not a finding — the *opposite* (silent multi-role writes) would be. |
| A `login_failed`/admin-action audit event that records the operator identity | Required telemetry, not disclosure. The finding is a *missing* audit on a privileged mutation, not the presence of one. |
| A permission set/profile/role that does NOT grant a privileged permission or class the admin feature needs | **A missing grant is fail-closed** — the privileged path can't be used; a functionality/packaging gap (`info` at most), never an escalation finding. The finding is an OVER-grant / over-broad assignment, never an under-grant. |

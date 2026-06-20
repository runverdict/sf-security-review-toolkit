# Dimension: secrets-credentials

Where secrets live, how they're stored, where they leak. Always applicable —
every architecture in scope has credentials. This dimension covers storage
decisions and custody: hardcoding, fallbacks, logs, at-rest posture, key
separation, package metadata, and git history. Algorithm-level correctness of
the crypto those decisions invoke (nonce uniqueness, tag verification, alg
pinning) belongs to
`${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/crypto-internals.md` — keep the
boundary, don't double-report.

## 1. Threat concept

Hardcoded secrets are a perennial top-of-list failure class in the review
(baseline: `fail-hardcoded-secrets`), and the scanners the review mandates
detect them mechanically — a hardcoded credential that reaches submission is a
guaranteed flagged finding plus a real compromise vector, because anything in
the repo is in every clone, every CI cache, and every laptop. The adjacent
classes the review and a competent attacker both probe:

- **Secrets in telemetry** — config dumps at boot, exception handlers
  serializing settings objects, tokens in error messages or URLs (baseline:
  `fail-info-disclosure`).
- **Weak at-rest posture** — API tokens stored as plaintext rows; a database
  snapshot or SQL-injection read becomes full credential compromise.
- **Key-custody defects** — one secret reused across trust boundaries (the
  app's JWT key also encrypting fields; the customer-facing signing key also
  signing operator-console tokens), or a *derivation fallback* that quietly
  substitutes a weaker or shared key when the dedicated one is unset. A
  fallback key derivation that succeeds in production is a key-compromise
  primitive wearing a convenience feature's clothes.
- **Package metadata secrets** — a managed package that ships credential
  *values* (External Credential principals, Named Credential passwords, keys
  in custom metadata/settings records) instead of credential *shape*. The
  sanctioned pattern ships the ExternalCredential/NamedCredential structure
  with empty principals; each subscriber enters their own values post-install
  (baseline: `endpoint-named-credentials-callouts`). Shipping values is both a review
  failure and a single shared secret across the entire customer base.
- **Git history** — a secret committed once and "removed" is still in every
  clone's history. History scrubbing without rotation is theater; rotation is
  the fix, scrubbing is hygiene. Severity is always critical (key compromise)
  and rotation is non-negotiable — but be precise in the report about
  *review-gating* vs *security*: a secret in the partner's PRIVATE source repo
  history is a real rotate-now breach item that the Salesforce reviewer does
  **not** scan for (the review reads the submitted package, the live
  endpoints, and the docs — not the partner's source repository), whereas a
  secret in the SUBMITTED PACKAGE or any code the reviewer can reach is *also*
  a guaranteed flagged finding. Report both as critical and rotate either way;
  only frame a finding as "submission-blocking because the reviewer will catch
  it" when the secret is in the submitted surface. Over-claiming the repo-only
  case as a literal review gate erodes the report's precision — the honest line
  is "critical security debt, rotate before you ship; not a surface the review
  itself scans."

## 2. What good looks like

- **Single source of truth outside the repo**: environment variables or a
  vault/secrets manager, loaded through one config module. No secret literals
  in source, config files, IaC, container definitions, or compose files.
  `.env` files gitignored, with a committed `.env.example` carrying placeholder
  shapes only.
- **Fail closed at boot in production**: required secrets validated on
  startup; a missing key aborts rather than falling back to a default
  (`os.environ.get("SECRET_KEY", "dev-secret")` reachable in prod is a
  hardcoded secret with extra steps). Derivation fallbacks ("derive the
  encryption key from the app secret if unset") are acceptable only when
  hard-gated to non-production environments — verify the gate, not the
  comment.
- **Distinct keys per trust boundary, asserted**: signing vs encryption vs
  webhook-verification keys are different values; where two identity planes
  exist (customer app vs operator console), their signing keys are distinct
  and the boot check *asserts* inequality rather than hoping.
- **Tokens hashed at rest**: long-lived bearer credentials (API keys, refresh
  tokens, reset tokens) stored as a strong hash, compared by lookup-of-hash;
  third-party tokens that must be replayed outbound (CRM integration OAuth
  tokens) encrypted at rest with a dedicated key. One-time secrets (a
  generated client secret) displayed exactly once, never re-fetchable, never
  echoed in success pages/emails/logs after that display.
- **Telemetry is secret-free by construction**: central redaction in the
  logging layer, exception handlers that never serialize config/settings
  objects, no secrets in URLs (query strings live in access logs forever).
- **Client bundles carry only intentionally public config**: build-time
  public-prefix conventions (`NEXT_PUBLIC_`, `VITE_`, `REACT_APP_`) used only
  for genuinely public values; no server secret imported into client-built
  code paths.
- **Package side**: credential metadata ships shape, not values; no API keys
  in custom metadata/settings *records* included in the package; no secrets
  in Apex constants or debug statements (the structured scan for these runs in
  `/sf-security-review-toolkit:run-scans` — this dimension's finder reads what
  greps surface and judges the storage pattern).
- **History discipline**: a secret-scanner (gitleaks/trufflehog-class) in CI;
  any historical leak answered with rotation first, then scrub. The scan
  orchestration and evidence capture live in
  `/sf-security-review-toolkit:run-scans`; this dimension's finder spot-checks
  history for the specific paths it has reason to suspect (deleted `.env`
  files, config rewrites).

## 3. Detection heuristics

**All stacks** — grep seeds: `password\s*=\s*["']`, `secret\s*=\s*["']`,
`api[_-]?key`, `token\s*=\s*["']`, `BEGIN (RSA|EC|OPENSSH) PRIVATE KEY`,
`AKIA[0-9A-Z]{16}` (and provider-prefixed key shapes generally: `sk-`, `xox`,
`ghp_`, `SG.`), basic-auth URLs (`://[^/]+:[^@/]+@`), `Authorization:
Basic`. Config files: `docker-compose*.yml` `environment:` blocks,
`.env*` tracked in git (`git ls-files | grep -i env`), CI workflow files,
Kubernetes manifests/Helm values. History: `git log --diff-filter=D --name-only`
for deleted env/config files; `git log -p` on config paths that ever carried
credentials.

| Stack | Where to look |
|---|---|
| Python (FastAPI/Django) | The settings module (pydantic `BaseSettings`/`config.py`, Django `settings.py`): default values on secret fields are the #1 site; `os.environ.get(key, default)` with a non-None default. Key-derivation fallbacks: grep `derive`, `PBKDF2`, `HKDF`, `sha256(.*SECRET` near encryption-key loading. Logging of settings: `logger.*(settings`, `print(config`. |
| Node (Express/Nest) | `process.env.X || 'literal'` and `??` fallbacks; committed `.env`; `config/*.json` with credential keys; client-bundle leakage — grep server-secret names inside `NEXT_PUBLIC_`/`VITE_`-consuming code and the built `public`/`.next` output if present. |
| Ruby (Rails) | `config/master.key` or `config/credentials/*.key` tracked in git (the encrypted credentials file is fine; the key is not); `secrets.yml`/`database.yml` with literals; `ENV.fetch("X", "default")`. |
| Java (Spring) | `application*.properties`/`.yml` committed with `spring.datasource.password`, `client-secret`, etc.; `@Value("${x:defaultsecret}")` defaults; jasypt passwords on the command line in scripts. |
| Apex/metadata | `force-app/**/externalCredentials/*.externalCredential-meta.xml` and `namedCredentials/*` — principals/password fields must be empty of values; `customMetadata/*.md-meta.xml` records carrying `key`/`token` field values; Apex constants (`static final String` near `KEY`/`SECRET`/`TOKEN`); `System.debug` statements interpolating credential variables. |

Also resolve: the boot-validation site (where required config is asserted),
the token-storage write sites (grep model/entity definitions with `token`
columns, then the service that writes them), and the one-time-secret display
path (registration/provisioning success responses).

## 4. Finder prompt block

```
Primary targets (read these first, then follow imports/call-sites; use grep to
locate the real files when a path is approximate):
{{TARGETS}}

Stack notes (claims from the partner's own docs — verify against the ACTUAL
code, never assume):
{{STACK_NOTES}}

Threat focus — secret storage, custody, and leakage. Probe: hardcoded
credentials in source, config files, IaC, compose/CI/K8s manifests; default
fallback secrets on config fields (env-var reads with literal defaults — are
they reachable in production, or does boot validation fail closed when the
real value is missing?); crypto-key derivation fallbacks (a weaker or shared
key silently substituted when the dedicated key is unset — is the fallback
hard-gated to non-prod?); key separation across trust boundaries (signing vs
encryption vs webhook keys distinct; customer-plane vs operator-plane signing
keys distinct and ASSERTED distinct at boot); tokens at rest (API keys,
refresh tokens, reset tokens stored raw vs hashed; outbound-replayable
third-party tokens encrypted with a dedicated key); one-time secrets
re-exposed after first display (re-fetchable client secrets, secrets in
success pages/emails); secrets reaching telemetry (boot-time config dumps,
exception handlers serializing settings, secrets in error responses, tokens
in URLs/query strings); client-bundle leakage (server secrets imported into
browser-built code; public-prefix env conventions misused for private
values); package metadata (External/Named Credential metadata shipping
credential VALUES rather than empty shape; custom metadata/settings records
carrying keys; Apex constants or debug statements with secrets); git history
(deleted .env/config files whose blobs still carry live-shaped secrets — and
whether rotation evidence exists). Dependency-version CVEs are out of scope
here (separate scanners); a leaked VALUE you can read is in scope.

Known findings — do NOT re-report any of these:
{{LEDGER}}

Report ONLY findings grounded in code you have READ, with exact file:line.
Prefer precision over volume. Distinguish a live-shaped secret from a
placeholder before reporting — "changeme", documented examples, and test
fixtures are not findings. If handling is correct, do NOT report it (one
info-level note for a notably strong control is allowed). For each finding
give a concrete exploit_scenario: who reads the value (repo cloner, log
reader, DB snapshot holder, package subscriber), and what it unlocks. NEVER
quote a discovered secret value verbatim in your finding — cite file:line and
describe its shape; the engine redacts values in every output.
```

## 5. Verifier guidance

- **Is the value real?** Read the literal and its context: placeholder shapes
  (`your-key-here`, `changeme`, `xxx…`, documented examples, obvious test
  fixtures) refute. Entropy and provider-prefix shape confirm. When
  undecidable from the value alone, check whether anything at runtime actually
  loads it.
- **For fallback-default findings**: read the production config path end to
  end — does a deployment manifest/CI secret always override it, AND does a
  boot assertion fail closed if not? A default that cannot survive into a
  prod boot is a hygiene note (low), not a credential finding. A default that
  can is real regardless of current deploy practice.
- **For derivation-fallback findings**: read the gate. An environment check
  that hard-fails in production refutes; a log-warning-and-continue confirms.
- **For at-rest findings**: read the write site *and* the read site. A column
  named `token` holding a hash refutes; raw value written but encrypted by a
  driver/ORM layer also refutes — find the encryption call before confirming.
- **For history findings**: confirm the blob actually contains a live-shaped
  secret (not a placeholder-era version), and check for rotation evidence
  (changed key ids, a documented rotation) before setting severity — an
  unrotated historical leak is current, not historical.
- **For package-metadata findings**: distinguish shape from value — a named
  principal with empty secret fields is the correct pattern, not a finding.
- **Never reproduce a secret value in `evidence`** — cite the location and
  shape; the engine redacts, but don't make it have to (CONVENTIONS §6).
- **A crashing config is fail-closed, not a secret finding.** A NON-secret
  config value (a DB URL, a service endpoint, a feature flag) that is
  unvalidated or absent and merely crashes the process at use time is an
  availability/robustness nit (`low`/`info`) — **fail-closed on availability**,
  not a credential finding — and a config value that is not itself a secret is
  out of this dimension entirely. The secret finding requires a real secret
  value (entropy / provider-prefix shape) at a readable sink, not a missing or
  blank non-secret config.

## 6. Known false-positive patterns

| Pattern | Why it is not a finding |
|---|---|
| Placeholder/example values in `.env.example`, docs, READMEs, test fixtures | Documentation of shape, not credentials. Verify the value is referenced by no runtime path before refuting. |
| OAuth `client_id` values, public API keys, analytics write keys in client bundles or metadata | Public identifiers by design — `client_id` is not a secret per the OAuth spec. The *secret* in the bundle would be the finding. |
| High-entropy strings that are hashes, encrypted blobs, or checksums | Already-protected forms. Read the surrounding code: a bcrypt/argon2 hash or an AES ciphertext column is the control working. |
| External/Named Credential metadata with named principals but empty values | Exactly the sanctioned ship-the-shape pattern. |
| Public-prefix env vars (`NEXT_PUBLIC_*` etc.) carrying API base URLs, feature flags, public keys | The prefix means intentionally public; only a *private* value behind a public prefix is a finding. |
| Deterministic passwords in seed/demo/test tenant fixtures | Test plumbing — info at most, unless the seed runs against production data paths. |
| A committed *encrypted* credentials file (e.g. Rails `credentials.yml.enc`) without its key | The design: ciphertext in git, key outside. The committed *key* would be the finding. |
| Dev-only compose files with throwaway service passwords for local containers | Local-loopback infrastructure, not production credentials — unless the same file is the production deploy artifact; read the deploy path before flagging. |
| An unvalidated or absent NON-secret config value (a DB URL, an endpoint, a feature flag) whose absence crashes the process | Not a secret and not a vulnerability — **fail-closed on availability** (robustness `low`/`info`). A config value is a secrets finding only if it IS a secret (entropy / provider-prefix shape) exposed at a readable sink. |

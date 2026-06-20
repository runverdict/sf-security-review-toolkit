# Dimension: crypto-internals

The cryptography the partner wrote themselves: encryption at rest, JWT minting
and validation, HMAC verification of signed payloads, key derivation, token
generation, password hashing configuration. Applies when the scope manifest
shows custom crypto in code — which in practice is any product that mints its
own tokens, encrypts stored credentials, or verifies a signed request (a
Salesforce Canvas signed request is exactly this). Library *selection* is not
the subject; library *misuse* is — the field audits that produced this
dimension found zero broken primitives and several broken usages.

## 1. Threat concept

Crypto defects are quiet until they are total. A reused AEAD nonce or a JWT
that validates under `alg: none` doesn't degrade — it collapses: key-equivalent
compromise, forgeable identity, silent cross-plane token replay. The review
cares on three fronts:

1. **The OWASP bar.** External endpoints are assessed against OWASP Top 10 /
   CWE Top 25 (baseline: `endpoint-owasp-top10-bar`), where cryptographic
   failures are a named category, and the reviewers' own pen test will probe
   token handling directly.
2. **The artifact trail.** The submission documents how credentials are stored
   and how authentication tokens are issued and validated (baseline:
   `artifact-credential-storage-attestation`,
   `artifact-authn-authz-flow-doc`). A claim of "AES-256-GCM at rest" in the
   artifact that the code contradicts is worse than no claim.
3. **MCP session semantics.** Stateless auth tokens are the session model the
   MCP guidance expects (baseline:
   `mcpthreat-session-hijacking-stateless-auth`) — which makes the signing and
   audience discipline of those tokens load-bearing for the whole listing.

The highest-impact sub-classes, in the order a verifier should fear them:

- **AEAD nonce reuse.** AES-GCM with a repeated (key, nonce) pair leaks the
  authentication subkey and the XOR of plaintexts — confidentiality *and*
  integrity gone for everything under that key. Static IVs, counter resets,
  and "derive the nonce from the record id" all land here.
- **Unauthenticated decryption.** GCM/Poly1305 decrypt paths that ignore or
  skip tag verification (or hand-rolled AES-CTR + separate MAC verified after
  use) accept attacker-modified ciphertext.
- **JWT algorithm/audience confusion.** Decode calls that accept whatever
  `alg` the token header claims; one secret signing two token populations
  (customer and admin) distinguished only by a claim nobody checks; missing
  `iss`/`aud`/`typ` separation letting a token minted for plane A validate on
  plane B. The cross-plane variant is the scariest — it turns a customer-level
  compromise into an operator-level one (the admin half of that boundary is
  `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/admin-surface.md`).
- **Non-constant-time secret comparison.** `==` on an HMAC, API key, or reset
  token gives a timing oracle. Signed-request verification (Canvas, webhooks)
  is where field audits keep finding it, because that's the code partners
  write last and by hand.
- **Weak derivation fallbacks.** "If the dedicated key env var is unset,
  derive one from the app secret / use this default" — a dev convenience that
  silently runs in production and collapses two trust domains into one secret.
- **Wrong entropy source.** `random`/`Math.random`/`java.util.Random` minting
  anything an attacker would want to guess: tokens, codes, nonces.
- **Outbound TLS trust disabled.** The partner's server-side code making
  *outbound* callouts with certificate validation turned off — `verify=False`
  (Python `requests`), `rejectUnauthorized: false` (Node TLS/https), a trust-all
  `TrustManager` / `NoopHostnameVerifier` (Java), `CURLOPT_SSL_VERIFYPEER 0` — or
  following a redirect that re-sends the `Authorization`/bearer header or the
  request body to a *different* host. Inbound TLS grading
  (`endpoint-ssl-labs-a-grade`, `violation-secure-communication`) never sees
  this; it is the outbound leg, and it re-opens a man-in-the-middle on the
  partner's own integrations (CWE-295; baseline: `outbound-callout-trust`).
  Salesforce Named / External Credentials validate TLS by construction — the
  finding is partner server-side outbound code, not the Named-Credential path.

## 2. What good looks like

- **AEAD usage**: a fresh random 96-bit nonce from a CSPRNG per encryption,
  stored alongside the ciphertext (prefix-concatenation is the conventional
  layout); never a static, counter-without-persistence, or derived-from-data
  nonce under a long-lived key. Decrypt verifies the tag *before* any
  plaintext-dependent behavior — with high-level APIs (`AESGCM.decrypt`,
  Fernet, `crypto.createDecipheriv` + `final()`) this is automatic; the
  finding is code that circumvents it.
- **One key, one purpose.** Field-encryption key ≠ token-encryption key ≠
  signing secret. Distinctness asserted at startup where two secrets guard
  different planes (a literal `assert ADMIN_SIGNING_SECRET != APP_SIGNING_SECRET`
  is cheap and field-proven).
- **JWT validation pins everything**: the accepted algorithm list is
  hard-coded at the verify call (never read from the token header), `exp` is
  enforced (and `iat`/`nbf` where minted), and `iss`/`aud` (or an explicit
  `typ`/purpose claim) are *checked*, not just emitted — so a token from one
  issuer/audience population is rejected by the other's verifier even though
  both are syntactically valid JWTs.
- **HMAC verification**: algorithm fixed by the code (not negotiated from the
  payload), comparison via the platform's constant-time primitive, and the
  compared values normalized to the same encoding first — comparing a base64
  string against raw bytes "works" in tests and fails open or closed in
  production depending on the library. Compare decoded bytes to computed
  bytes.
- **Key material hygiene**: keys enter via environment/secret manager, never
  literals (baseline: `fail-hardcoded-secrets` — the storage half of this
  lives in `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/secrets-credentials.md`);
  missing-key behavior is fail-closed in production (refuse to start) rather
  than fall back to a derived or default key; keys and decrypted payloads
  never reach logs, exception messages, or audit records.
- **Entropy**: every security-relevant random value comes from the CSPRNG
  (`secrets`, `crypto.randomBytes`, `SecureRandom`, `SecureRandom`/`OpenSSL`
  in Ruby), with length ≥128 bits for bearer tokens.
- **Password hashing**: a memory-hard scheme (Argon2id, scrypt, or bcrypt at a
  sane cost) via a maintained library, parameters set deliberately rather
  than left at a legacy default.
- **TOTP/2FA secrets** (where present) get the same at-rest treatment as any
  other credential — encrypted with the same nonce discipline; the
  enrollment/enforcement logic around them belongs to
  `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/admin-surface.md`.

## 3. Detection heuristics

Locate (a) every encrypt/decrypt call site, (b) every token mint/verify, (c)
every MAC verification, (d) the key-loading path for each.

**All stacks** — grep seeds: `GCM`, `AES`, `nonce`, ` iv `, `encrypt`,
`decrypt`, `hmac`, `compare_digest`, `timingSafeEqual`, `secure_compare`,
`isEqual`, `jwt`, `decode`, `verify`, `sign`, `algorithms`, `HS256`, `RS256`,
`derive`, `pbkdf2`, `hkdf`, `sha256(`, `token_urlsafe`, `randomBytes`,
`SecureRandom`, `getRandomValues`. Then grep the *names of the key env vars*
you find — every read of a key variable is a crypto call site or a leak.

| Stack | Where to look |
|---|---|
| Python (FastAPI/Django) | Imports: `cryptography.hazmat` (`AESGCM`, `ChaCha20Poly1305` — check the nonce argument's provenance at every `.encrypt()`), `Fernet` (nonce handled internally), `pyjwt`/`python-jose` (`jwt.decode(..., algorithms=[...])` — flag any decode missing the list or passing `options={"verify_signature": False}`), `hmac` (`.new` vs `compare_digest`), `secrets` vs `random`, `hashlib` used as a "KDF", `passlib`/`argon2-cffi` config. Django: `SECRET_KEY` reuse for ad-hoc signing, `django.core.signing` salt discipline. Conventional homes: `security.py`, `crypto*.py`, `token*.py`, `*_auth_service.py`. |
| Node (Express/Nest) | `crypto.createCipheriv('aes-256-gcm', key, iv)` — trace `iv` to `crypto.randomBytes(12)` or flag; `decipher.setAuthTag` present before `final()`; `jsonwebtoken.verify(token, secret, { algorithms: [...] })` — the `algorithms` option absent is the classic confusion bug; `jwt.decode()` (no verification!) used where `verify` was meant; `crypto.timingSafeEqual` (and that both buffers derive from the same encoding); `Math.random` in anything token-shaped; `jose` (good defaults — look for explicit loosening). |
| Ruby (Rails) | `OpenSSL::Cipher` — the canonical bug is a cipher object reused without a fresh `random_iv` per message, or `iv =` a constant; `ActiveSupport::MessageEncryptor` (sane defaults; check the key/salt source); `JWT.decode(token, secret, true, { algorithm: ... })` — the third positional `true` is signature verification, a `false` there is the finding; `ActiveSupport::SecurityUtils.secure_compare`; `SecureRandom` vs `rand`. |
| Java (Spring) | `Cipher.getInstance("AES/GCM/NoPadding")` + `GCMParameterSpec` — trace the IV bytes to `SecureRandom`; `"AES"` alone defaults to ECB (a finding in itself); jjwt `parseClaimsJws` vs `parse`/`parseClaimsJwt` (the latter skip signature checks); nimbus `JWTClaimsSetVerifier` for aud/iss; `MessageDigest.isEqual` for MACs (constant-time on modern JDKs) vs `Arrays.equals`/`String.equals`; `java.util.Random` vs `SecureRandom`. |
| Apex/LWC (where relevant) | `Crypto.encryptWithManagedIV` (IV handled) vs `Crypto.encrypt` with a hand-supplied IV — trace the IV's provenance; `Crypto.generateMac` results compared with `==` on Strings (Apex String `==` is not constant-time, though exploitability in-platform is limited — report as low); `Crypto.getRandomInteger`/`getRandomLong` vs `Math.random`. Hardcoded key Blobs in Apex are routed to secrets-credentials. |

Also locate: the startup/config validation (does a missing key abort prod
boot?), every `logger`/`print` within arm's reach of key material, and every
outbound HTTP/callout site's TLS-verification flag (`verify=`/
`rejectUnauthorized`/a custom `TrustManager`/`CURLOPT_SSL_VERIFYPEER`) plus its
redirect-following behavior — the outbound-callout-trust probe (CWE-295).

## 4. Finder prompt block

```
Primary targets (read these first, then follow imports/call-sites; use grep to
locate the real files when a path is approximate):
{{TARGETS}}

Stack notes (claims from the partner's own docs — verify against the ACTUAL
code, never assume; "we use AES-256-GCM" tells you nothing about the nonce):
{{STACK_NOTES}}

Threat focus — cryptography internals: the subtle, high-impact misuses. Probe:
AEAD NONCE/IV UNIQUENESS — at every encrypt call, is a fresh random 96-bit
nonce generated per encryption and stored with the ciphertext? A static,
counter-reset, or data-derived nonce under a long-lived key catastrophically
breaks GCM confidentiality AND integrity — if you find one, that is a critical,
say so plainly. Is the auth tag verified on decrypt (no decrypt-then-use path
that skips or defers tag checking; hand-rolled CTR+MAC verified after use)?
JWT: is the algorithm list PINNED at the verify call (reject `none`, reject
header-chosen alg, no RS/HS confusion), are exp (and iat/nbf where minted)
enforced, and where TWO token populations exist (customer vs admin/operator,
access vs refresh, app vs integration) — are the signing secrets distinct,
asserted distinct, AND are iss/aud/typ checked on BOTH verifiers so a token
minted for one plane is rejected by the other? Find every decode call,
including "just read the claims" decodes. HMAC/signed-request verification:
constant-time comparison (string == on a MAC or token is a finding), algorithm
pinned by code not payload, both comparands normalized to the same
encoding/bytes before compare, the secret never logged or echoed in errors.
Key handling: derivation fallbacks when a key env var is missing (deriving
from another secret, defaulting to a literal — does production fail closed or
fall back?), one key serving multiple purposes, key material or decrypted
plaintext reaching logs/exceptions/audit rows. Entropy: every token, code,
nonce, and secret minted with the CSPRNG (`secrets`/`randomBytes`/
`SecureRandom`), never `random`/`Math.random`; bearer-token length ≥128 bits.
Password hashing scheme and parameters. TOTP/2FA secret encryption at rest —
same nonce-reuse probe as field crypto. OUTBOUND TLS TRUST: at every server-side
outbound HTTP/callout site, is certificate validation ON (no verify=False /
rejectUnauthorized:false / trust-all TrustManager / NoopHostnameVerifier /
CURLOPT_SSL_VERIFYPEER 0), and does a followed redirect avoid re-sending the
Authorization/bearer header or request body to a DIFFERENT host? Inbound TLS is
graded by the scans; this is the OUTBOUND leg — disabled validation re-opens a
MITM on the partner's integrations. Salesforce Named/External Credentials handle
TLS by construction, so flag partner server-side outbound code, NOT the
Named-Credential path (baseline: outbound-callout-trust).

Known findings — do NOT re-report any of these:
{{LEDGER}}

Report ONLY findings grounded in code you have READ, with exact file:line.
Report only real crypto defects — correct use of a high-level library is not a
finding, and library choice alone is not a finding. Prefer precision over
volume. If a control is correctly implemented, do NOT report it (one
info-level note for a notably strong control is allowed). For each finding
give a concrete exploit_scenario: the attacker, what they capture or send, and
what the math lets them do (forge, decrypt, replay, cross planes).
```

## 5. Verifier guidance

Crypto findings have the highest false-positive rate of any dimension —
high-level libraries do internally what finders report as missing. Before
confirming, read:

- **The nonce's full provenance.** Follow the IV/nonce argument to its
  generation site. `os.urandom(12)` / `randomBytes(12)` / `random_iv` at the
  call site refutes a reuse claim; a module-level constant, an object field
  set once, or a counter that resets on process restart confirms it. For
  "derived nonce" claims, check whether the *key* is also derived per message
  (a unique key per message makes a fixed nonce sound — misuse-resistant
  constructions exist; read before confirming).
- **What the library does implicitly.** Fernet generates its own IV; GCM
  decrypt in `cryptography`, Node's `final()` after `setAuthTag`, and JCA's
  `doFinal` all throw on tag mismatch. A "tag not verified" claim must point
  at code that catches-and-ignores that throw, or at a primitive (CTR, ECB,
  raw block calls) with no tag at all.
- **Every decode call site, not just the cited one.** A claims-read without
  verification is only a finding if the value is *trusted* downstream — a
  decode used purely to route to the correct verifier (peek at `iss`, then
  verify properly) is a standard pattern. Find the actual trust point.
- **Both sides of a cross-plane claim.** "Customer token accepted at admin"
  requires reading both verifiers and both minting paths: distinct secrets
  alone refute it; a shared secret with enforced distinct `aud`/`typ` claims
  refutes it; a shared secret with the distinguishing claim emitted but never
  checked confirms it.
- **The comparison primitive's actual semantics.** `hmac.compare_digest`,
  `timingSafeEqual`, `secure_compare`, `MessageDigest.isEqual` refute a
  timing claim. Also check comparand encodings — `timingSafeEqual` on buffers
  of different lengths throws, which some code "fixes" with a length check
  that itself leaks (that one is real but `low`).
- **The fallback's reachability.** A weak-derivation or default-key branch is
  critical only if production can take it — read the environment gate and
  startup validation. Dev-only fallbacks behind a gate that's hard-false in
  prod builds are `info`/`low` hardening notes.

## 6. Known false-positive patterns

| Pattern | Why it is not a finding (or not at the reported severity) |
|---|---|
| Fernet / `MessageEncryptor` / libsodium `secretbox` "missing an explicit nonce" | These APIs generate and embed the nonce internally — that is the design, not a gap. |
| A fixed/zero nonce where the key is single-use (per-message HKDF, ephemeral ECDH-derived key) | Nonce uniqueness is required per (key, nonce) *pair*. Unique key per message makes a fixed nonce sound. Verify the key truly never repeats before refuting, and say so in the verdict. |
| `random`/`Math.random` in jitter, sampling, retry backoff, test fixtures, demo-data seeding | Not security-relevant randomness. The finding requires the value to gate or authenticate something. |
| JWT decoded without verification to peek at `iss`/`kid`, then verified by the selected verifier | Standard multi-issuer routing. The finding requires a trusted use of unverified claims. |
| Algorithm list pinned in shared config rather than at each verify call | Pinning is pinning. Confirm the config value can't be attacker- or tenant-influenced, then move on. |
| Two token types under one secret, distinguished by an enforced `aud`/`typ` check on every verify path | Acceptable design (distinct secrets are *better* — at most an `info` note). The finding is the claim emitted but unchecked, or checked on only one plane. |
| Logging a key fingerprint, key ID, or last-4 of a token | Operational telemetry. The finding is the key or full token value itself in logs. |
| bcrypt instead of Argon2id | A maintained, memory-hard-adjacent scheme at sane cost is not a finding; flag only legacy fast hashes (MD5/SHA-family, unsalted) or absurd cost parameters. |
| HMAC verification that returns generic 401/403 without detail | Error hygiene working as intended — not "silent failure". |

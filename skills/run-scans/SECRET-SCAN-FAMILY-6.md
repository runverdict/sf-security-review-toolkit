# Family 6 — Secret scan (working tree + full git history)

Drop-in specification for a sixth scan family in
`/sf-security-review-toolkit:run-scans`, written in the style of the five
families in `SKILL.md` ("The five families"). Fold the table row into that
table, the prose block into Steps (after Family 5), and the recap/wiring notes
into the surrounding sections.

The failure class this family exists to kill: the toolkit's own
`submission-checklist.md.tmpl` (Row 5 guidance) and `readiness-tracker.md.tmpl`
("Secret scanning" row) **assert a secret-scan evidence file as a required,
fail-closed artifact**, and `artifact-credential-storage-attestation` (baseline,
**blocker**) requires the no-hardcoded-secrets confirmation "backed by a scan" —
yet nothing in `run-scans` produces that file. Git-history hunting exists only
as an LLM spot-check inside the `secrets-credentials` dimension
(`git log --diff-filter=D --name-only` as prose), and the external-server source
tree (Python/Node/Java) and IaC paths have **no mechanical secret backstop at
all**. This family turns the dimension's history heuristic into a real tool
invocation and gives every HAVE row a file on disk.

## Table row (fold into "The five families")

| Family | Applies when (manifest) | Scan runner | Evidence file(s) under `.security-review/evidence/` | Gate |
|---|---|---|---|---|
| 6. Secret scan | always (every source root + IaC path the repo contains) | agent | `secret-scan-<date>.json` + `secret-scan-<date>-summary.md` (redacted) | `fail-hardcoded-secrets` (blocker — backs `artifact-credential-storage-attestation`) |

## Step — Family 6: Secret scan, working tree AND full git history

*Requires:* a no-hardcoded-secrets posture backed by a **mechanical** scan, not
an assertion from memory (baseline: `fail-hardcoded-secrets` — hardcoded
credentials in code, metadata, or config are a recurring auto-fail class, and
code obscurity inside a managed package is explicitly **not** a defense, so a
secret survives into every clone, CI cache, and laptop regardless of packaging).
The scan cannot prove a negative — `artifact-credential-storage-attestation`
(blocker) pairs the scan output with an owner signature for exactly that reason —
but the absence of the scan output is itself the bounce. This family is the
mechanical complement to the `secrets-credentials` dimension's LLM finder, never
its replacement (see **Honest ceiling** below).

*Tool:* **gitleaks** (preferred — native full-history mode, deleted-blob
recovery, ships a default provider-prefix + high-entropy ruleset). Acceptable
substitutes when gitleaks is unavailable: **trufflehog** (its `git`/`filesystem`
sources with `--only-verified` off so unverified-but-shaped hits still surface)
or **detect-secrets** (`scan --all-files` for the tree; weaker on history). Pin
and record the tool + version in the evidence and the run log — a secret-scanner
version is a perishable fact, and a ruleset from a year ago misses this year's
provider prefixes.

*Resolve the scan roots first.* From the scope manifest, enumerate **every**
source root the repo contains — do not assume one:

- **The external-server tree** (the surface Code Analyzer/PMD never sees — it
  scans only Apex/VF/Aura): every detected language root —
  `**/*.py` `**/*.ts` `**/*.tsx` `**/*.js` `**/*.java` `**/*.go` `**/*.rb`
  `**/*.cs` — plus the config that travels with them
  (`**/*.env*` even when gitignored-but-present on disk, `**/*.yaml` `**/*.yml`
  `**/*.json` `**/*.properties` `**/*.toml` `**/*.ini`, CI workflow files under
  `.github/workflows/` `.gitlab-ci.yml`, Kubernetes/Helm manifests, `Makefile`).
- **IaC paths** (a secret here is a hardcoded-secret finding the same as one in
  code — baseline `fail-hardcoded-secrets`, `applies_to` external-endpoint):
  - `**/Dockerfile*` and `**/*.dockerfile` — read `ENV` and `ARG` lines: a build
    arg or env default carrying a token is baked into every image layer and
    recoverable with `docker history`.
  - Terraform — `**/*.tf` `**/*.tfvars` and especially `**/*.tfstate` /
    `**/*.tfstate.backup` (state files store provider credentials and resource
    attributes **in cleartext** by default; a committed `.tfstate` is a classic
    full-credential leak).
  - CloudFormation (`**/*template*.yaml`/`.json` with `Resources:`) and Ansible
    (`**/playbook*.yml`, `**/group_vars/**`, `**/host_vars/**`, `vars/**`) —
    `vars`/`environment`/`Parameters` blocks carrying literal secrets.
- **The packaged surface**, for completeness alongside Code Analyzer's PMD pass:
  `force-app/**` metadata and static resources (Apex constants, `System.debug`
  interpolations, `*.externalCredential-meta.xml` / `*.namedCredential-meta.xml`
  principal fields carrying *values* not empty shape, `customMetadata/*` records
  with `key`/`token` fields, `staticresources/**`).

*Two passes — both are mandatory.*

1. **Working-tree pass.** Scan the current checkout over every resolved root
   (gitleaks `detect --no-git --source <root>`, or `dir`/`filesystem` mode in
   the substitute). This is what catches a secret in the **submitted package or
   submittable code** — the surface a reviewer (and their bundled scanner) can
   actually reach.
2. **Full-git-history pass.** Scan **all** of history, not the tip
   (gitleaks `detect --source . ` with no `--no-git`, which walks every commit
   and every blob). This surfaces **deleted-but-recoverable** secrets: a `.env`
   or config file committed once and later `git rm`'d is still in every clone's
   pack files. Turn the `secrets-credentials` dimension's prose heuristic into a
   real, recorded invocation and **surface the deleted-blob hits explicitly** in
   the summary — run, alongside the history scan, the deleted-file enumeration
   the dimension describes so the report names the file path and the commit that
   removed it:

   ```bash
   git log --diff-filter=D --name-only --pretty=format:'%H %ci' \
     | grep -Ei '\.env|secret|credential|\.tfstate|key|\.pem|\.p12'
   ```

   Each history hit is annotated with the introducing commit, the deleting
   commit (if any), and whether the blob is still reachable from any ref — the
   summary states "present in history at `<commit>`, removed at `<commit>`,
   still recoverable from every clone."

*Agent runs:* root resolution from the manifest, both scan passes, the
deleted-blob enumeration, JSON parsing, redaction, diffing hits against the
audit ledger, and dossier-row drafting. *Owner runs:* the **rotation** of every
confirmed live secret (the agent cannot rotate a credential), the
remove-from-history scrub if elected, and the signature on
`artifact-credential-storage-attestation`. **This family never writes a captured
secret value to disk** (CONVENTIONS §6): the JSON evidence and the human summary
both store the finding's **location + shape + entropy + rule id**, with the
matched value replaced by `***redacted***`. If the chosen tool emits raw values,
the agent post-processes the report to redact before it touches
`.security-review/`.

*Evidence:* `evidence/secret-scan-<date>.json` (the parsed, **redacted**
machine record — one entry per finding: `{rule_id, surface, pass:
"working-tree" | "history", file, line_or_commit, shape, entropy, disposition}`)
plus `evidence/secret-scan-<date>-summary.md` (the redacted human summary: tool
+ version, roots scanned, counts per surface and per pass, the deleted-blob
table, and the PENDING owner-rotation items). The file on disk is what flips the
readiness row to HAVE — a generated command with no report is PARTIAL, full stop
(the same HAVE-requires-evidence contract every other family carries).

## Disposition — preserve the per-finding distinction

A secret-scan hit is not one severity; **where** the secret lives decides the
disposition, and the family must keep the two cases distinct rather than
flattening both into "critical secret":

- **Secret in the SUBMITTED PACKAGE or reviewer-reachable code** (working-tree
  pass over `force-app/**`, the external server the reviewer pen-tests, anything
  in the deliverable) — a **literal review gate**: a guaranteed flagged
  `fail-hardcoded-secrets`, fix before submission, and rotate. This is the case
  the reviewer's own scan reproduces.
- **Secret in the partner's PRIVATE repo HISTORY** (history pass; a deleted blob
  in source the reviewer never sees) — a **rotate-now breach item**, not a
  literal review gate: the Salesforce review reads the submitted package, the
  live endpoints, and the docs — **not the partner's source repository**. Report
  it as **critical security debt — rotate before you ship** and do **not**
  over-claim it as "the reviewer will catch this." Over-claiming the repo-only
  case as a submission gate erodes the report's precision exactly the way the
  `secrets-credentials` dimension warns against; the honest line is "critical,
  rotate, but not a surface the review itself scans."

Either way the remediation is **rotation first, scrub second** — history
scrubbing without rotation is theater, because the secret is already in every
clone. Encode that as a structured **ROTATION-EVIDENCE** check: for every
history (or previously-committed) leak, the disposition is not "removed from
history" but **"rotated"** — confirm the leaked credential was *invalidated at
the source* (a changed key id, a revoked token, a documented rotation with a
date and owner), not merely deleted from the tree. An unrotated historical leak
is **current, not historical**. This is a new field on the credential-storage
artifact and the fp-dossier Supplementary block:

| Field | Value |
|---|---|
| **Rotation status** | `rotated` (credential invalidated at source — key id changed / token revoked, date + owner) · `scrubbed-only` (removed from history but **not** rotated — STILL LIVE, treat as open) · `n/a — placeholder` (verified non-secret) |
| **Rotation evidence** | the changed key id / revocation record / dated rotation note, owner-signed |

`scrubbed-only` is never a closed disposition — it is an open critical until the
rotation evidence exists, because the agent cannot certify a credential dead.

## Gate and wiring

- **Gate:** `fail-hardcoded-secrets` (blocker). A confirmed live-shaped secret in
  the submitted surface is fix-now; a confirmed live-shaped secret in history is
  rotate-now. Either leaves the family NOT-CLEAN until dispositioned.
- **Backs** `artifact-credential-storage-attestation` (blocker): the
  no-hardcoded-secrets confirmation in that artifact must cite this family's
  evidence file. The artifact stays owner-signed (the scan can't prove a
  negative); this family supplies the scan half the attestation has been
  asserting from memory.
- **Sibling:** `scan-dependency-vulnerabilities` (Family 5) — same evidence
  discipline, same `.security-review/evidence/` home, same dossier. A library
  with a CVE and a secret in its bundled config are two different families
  flagging the same source root; cross-reference, don't double-disposition.
- **Readiness tracker:** wire `evidence/secret-scan-<date>.json` to the
  **"Secret scanning"** row of `readiness-tracker.md.tmpl` (§1.4) — HAVE only
  with the file on disk; the row states which scan runs and that it blocks.
- **Submission checklist:** wire the same file to the **secret-scan assertion**
  in `submission-checklist.md.tmpl` (Row 5 — Credential storage), which already
  names "a secret-scan evidence file" as required and "asserted from memory" as
  the common mistake. This family is what makes that pointer real.
- **Dossier:** fold every hit into `docs/security-review/fp-dossier.md` like the
  other families — register row plus a per-finding block, carrying the
  **Rotation status / Rotation evidence** fields above in the Supplementary
  section. Reuse the audit ledger's reasoning verbatim where the
  `secrets-credentials` finder already refuted the same pattern (a `.env.example`
  placeholder, a documented test fixture).

## Honest ceiling — what mechanical scanning misses

State this limit in the evidence summary and the readiness recap; it is the
non-negotiable honesty line for this family (CONVENTIONS §2). Mechanical
scanners reliably catch **provider-prefixed** secrets (`AKIA…`, `sk-…`, `ghp_…`,
`xox…`, `SG.…`, `-----BEGIN … PRIVATE KEY-----`, basic-auth URLs) and
**high-entropy** blobs. They **MISS custom-format, low-entropy secrets**: a
bespoke internal token shaped like a UUID, a short base64 config value, or any
credential with no recognizable prefix and entropy in the range of ordinary
text. A clean Family 6 report therefore means "no provider-prefixed or
high-entropy secret was found in the scanned roots and history" — it is **never**
"no secrets exist." The `secrets-credentials` dimension's LLM finder is the
complement that reads custody and context (a fallback default key, a token
written raw to a column, a UUID-shaped value loaded as a credential at runtime) —
it is the **complement, not a replacement**, and this family's recap must say so.
Neither pass substitutes for the reviewer's own pen test, which recovers live
credentials by means a static sweep cannot.

## Automated vs. manual recap (additions to the skill's recap)

**Automated (add):** root resolution from the manifest, both scan passes
(working tree + full history), deleted-blob enumeration, redaction, JSON +
summary evidence drafting, ledger diffing, dossier rows.
**Owner-run (add):** rotating every confirmed live secret (the agent cannot
invalidate a credential), any history scrub, and signing
`artifact-credential-storage-attestation`. The `scrubbed-only` disposition stays
open until the owner supplies rotation evidence. Salesforce pen-tests the live
surface regardless, and recovers secrets a mechanical sweep cannot.

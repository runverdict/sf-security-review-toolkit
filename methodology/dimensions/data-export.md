# Dimension: data-export

File and archive handling at the trust boundary: export endpoints (CSV, JSON,
PDF, ZIP), download routes, and upload receivers. Applies when the scope
manifest shows any endpoint that streams a file out or accepts one in. The two
directions share a dimension because they share the same root cause — a path,
a filename, or an archive entry derived from request data and trusted by the
filesystem.

## 1. Threat concept

Three distinct vulnerability classes converge on file handling, and the review
hits all three: external endpoints are assessed against the OWASP / CWE bar
(baseline: `endpoint-owasp-top10-bar`), where path traversal, broken access
control, and SSRF-adjacent file inclusion all live; cross-tenant export is the
auto-fail isolation class (baseline: `endpoint-multi-tenant-isolation`); and
the submission must classify the sensitivity of the data the product handles
(baseline: `artifact-data-sensitivity-classification`) — an export route that
streams more than the artifact claims is a documented-scope violation.

The sub-classes, in the order field audits confirmed them:

1. **Path traversal on read.** A filename or path segment from the request
   (`?file=`, a path parameter, a stored record's path field) reaches `open()`
   / `sendFile` / a static handler without normalization, letting `../../` or
   an absolute path escape the intended directory and read arbitrary files
   (`/etc/passwd`, the app's own `.env`, another tenant's stored upload).
2. **Zip-slip on write.** Extracting an archive whose entry names contain
   `../` writes files outside the extraction root — overwriting code, configs,
   or cron targets. The mirror on the build side: an archive *generated* with
   attacker-influenced entry paths, or one that sweeps in secrets/PII it
   shouldn't.
3. **Cross-tenant / over-broad export.** An export endpoint that queries
   without the tenant + per-user visibility scoping the rest of the app
   enforces — the bulk read is exactly where a forgotten `.where()` leaks the
   most data per request. Includes exports that embed more fields (internal
   ids, other users' PII, raw scores) than the consuming role should see.
4. **Unbounded export (DoS).** A "download everything" endpoint with no row
   cap, no pagination, no streaming — one request materializes millions of
   rows in memory or runs the database into the ground. Amplified when
   unauthenticated or cheap to trigger.
5. **Download-response hygiene.** A `Content-Disposition` filename reflected
   from user input (header/response splitting, or a misleading
   `.csv`-that-is-HTML), a content type that lets the browser sniff and render
   an "export" as HTML (reflected XSS via download), or an inline disposition
   on attacker-influenced content.
6. **Upload validation + temp-file hygiene.** Unvalidated type/size/extension
   on the inbound side, a server-trusted client-supplied filename written to
   disk, predictable or world-readable temp files, and temp files that outlive
   the request.

## 2. What good looks like

- **No request data reaches a filesystem path.** Downloads are keyed by an
  opaque id resolved to a path server-side (a database row, a lookup map),
  never by a client-supplied filename or path. Where a path component is
  unavoidable, it is canonicalized and asserted to live under the intended
  root *after* normalization (resolve, then check the prefix — checking before
  normalizing is the classic bypass).
- **Archive extraction validates every entry.** Each entry's resolved
  destination is confirmed to stay within the extraction root before write;
  absolute paths and `..` segments are rejected; symlinks in archives are not
  followed. Archive *generation* uses controlled, server-derived entry names
  and a deliberate allowlist of what goes in — never a recursive sweep that
  could capture `.env`, keys, or another tenant's files.
- **Exports run through the same scoping as every other read.** The export
  query binds the tenant context and applies the per-user visibility filter
  exactly like the equivalent list endpoint — the bulk path is not a
  privileged shortcut. Field selection is an explicit allowlist matched to the
  consuming role, not "serialize the whole row."
- **Exports are bounded.** A row/size cap, server-side pagination or true
  streaming (constant memory), and a rate limit on the endpoint (baseline:
  `endpoint-rate-limiting`). Large exports are async jobs that produce a
  scoped, expiring, authorized download artifact — not a synchronous
  unbounded stream.
- **Download responses are inert and honest.** `Content-Type` matches the real
  payload (`text/csv`, `application/json`), `Content-Disposition: attachment`
  with `X-Content-Type-Options: nosniff`, and the filename is server-generated
  or strictly sanitized (no CR/LF, no path separators, no reflected
  user input).
- **Uploads are validated and quarantined.** Type/extension/magic-byte and
  size limits enforced server-side; the stored name is server-generated (never
  the client's); files land outside the web root / object storage with no
  execute semantics; temp files use the platform's secure temp API
  (unpredictable name, owner-only mode) and are cleaned up in a `finally`.
- **Generated security/diagnostic bundles carry no secrets.** Any tool that
  packages logs/config/evidence for support or review explicitly excludes
  credential material and scrubs before zipping (this overlaps
  `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/secrets-credentials.md` — a
  bundle that sweeps in an `.env` is a hardcoded-secret-class leak by another
  route).

## 3. Detection heuristics

Locate (a) every route that streams a file out, (b) every archive create/extract
call, (c) every upload receiver, (d) the path each derives from request data.

**All stacks** — grep seeds: `send_file`, `sendFile`, `FileResponse`,
`StreamingResponse`, `Content-Disposition`, `attachment`, `to_csv`, `csv.writer`,
`zipfile`, `ZipFile`, `tarfile`, `extractall`, `AdmZip`, `unzip`, `open(`,
`createReadStream`, `path.join`, `os.path.join`, `../`, `tempfile`, `mkstemp`,
`/tmp`, `multipart`, `UploadFile`, `MultipartFile`, `secure_filename`,
`basename`, `realpath`, `canonicaliz`.

| Stack | Where to look |
|---|---|
| Python (FastAPI/Django) | FastAPI `FileResponse`/`StreamingResponse`, `UploadFile`; Starlette `StaticFiles` mount roots; `zipfile.ZipFile.extractall` (the zip-slip magnet — no built-in traversal guard), `tarfile.extractall` (same); `pandas.to_csv`/`csv` writers for export shape; `tempfile.mkstemp` (good) vs `open('/tmp/'+name)` (bad). Django: `FileField`/`Storage` upload_to, `X-Sendfile`/`X-Accel-Redirect` header trust, `FileResponse`, media-root serving. |
| Node (Express/Nest) | `res.download`/`res.sendFile`/`res.attachment` with a `req.params`/`req.query` path; `express.static` roots; `multer` (`dest`, `filename` callback — trusting `file.originalname`); `adm-zip`/`unzipper`/`tar` extract loops; `archiver` for generation; `path.join(root, userInput)` without a post-resolve prefix check; `fs.createWriteStream` to a client-named path. |
| Ruby (Rails) | `send_file`/`send_data` with params-derived paths; `Rails.root.join(params[...])`; ActiveStorage (`content_type`/size validation present?), Shrine/CarrierWave/Paperclip validators; `Zip::File`/`rubyzip` extract loops (no traversal guard by default); `Tempfile` (secure) vs hand-built `/tmp` paths. |
| Java (Spring) | `ResponseEntity<Resource>`/`StreamingResponseBody`/`InputStreamResource`; `ResourceHttpRequestHandler` static roots; `MultipartFile.getOriginalFilename()` trusted into `Paths.get`; `java.util.zip.ZipInputStream`/`ZipFile` extract loops (no guard — the canonical Java zip-slip); `Files.createTempFile` vs string-concatenated temp paths; `Content-Disposition` header built from request data. |
| Apex/LWC (where relevant) | `ContentVersion`/`Attachment`/`Document` generation, `PageReference.getContent()` (can fetch URLs — SSRF-adjacent), Visualforce `contentType`/`apex:page` download attributes; CSV/file building in Apex; LWC file-upload (`lightning-file-upload`) accept/size config. Path traversal is platform-constrained, but `Content-Type`/disposition reflection and over-broad export queries (no `WITH USER_MODE`) still apply. |

Also locate: any "support bundle" / "diagnostic export" / "security package"
builder script (a recurring source of secret leaks), and the static-file mount
roots (a too-broad root turns one traversal into full-disk read).

## 4. Finder prompt block

```
Primary targets (read these first, then follow imports/call-sites; use grep to
locate the real files when a path is approximate):
{{TARGETS}}

Stack notes (claims from the partner's own docs — verify against the ACTUAL
code; the question is always "what request data reaches a filesystem path or an
unscoped bulk query"):
{{STACK_NOTES}}

Threat focus — file export, download, and upload handling. Probe: PATH
TRAVERSAL on read — does any filename or path segment from the request (query
param, path param, a stored record's path field) reach open()/sendFile/a static
handler without canonicalize-then-prefix-check? `../../` or an absolute path
escaping the intended directory to read arbitrary files (the app's own env/key
files, another tenant's upload). ZIP-SLIP — archive extraction loops
(extractall, ZipInputStream, rubyzip, adm-zip) that write entries without
verifying each resolved destination stays under the extraction root; and on the
build side, an archive GENERATED with attacker-influenced entry paths or one
that sweeps in secrets/PII (a support/diagnostic/security bundle including a
.env or keys). CROSS-TENANT / OVER-BROAD EXPORT — does every export endpoint
bind the tenant context AND apply the same per-user visibility filter as the
equivalent list endpoint, or is the bulk path an unscoped shortcut? Does it
serialize more fields (internal ids, other users' PII, raw internal scores)
than the consuming role should see? UNBOUNDED EXPORT (DoS) — a download-all
endpoint with no row/size cap, no pagination, no streaming, materializing
everything in memory; worse if cheap or unauthenticated. DOWNLOAD HYGIENE —
Content-Disposition filename reflected from user input (header injection /
response splitting), Content-Type that lets a browser sniff an "export" as HTML
(reflected XSS via download), inline disposition on attacker-influenced
content. UPLOAD — server-side type/size/extension validation, client-supplied
filename trusted onto disk, predictable/world-readable temp files, temp files
outliving the request (cleaned up in finally?).

Known findings — do NOT re-report any of these:
{{LEDGER}}

Report ONLY findings grounded in code you have READ, with exact file:line.
Prefer precision over volume. If a control is correctly implemented, do NOT
report it (one info-level note for a notably strong control is allowed). For
each finding give a concrete exploit_scenario: the attacker, the exact request
(the traversal string, the malicious archive entry, the unscoped export call),
and what file they read, overwrite, or what data they exfiltrate.
```

## 5. Verifier guidance

Before confirming, read:

- **The full path-construction chain.** Follow the filename from request to
  `open`/`sendFile`. A finding is refuted if the value is canonicalized
  (`realpath`/`Paths.get(...).normalize()`/`File.realpath`) **and** asserted
  under the root *after* normalization, or if the route keys on an opaque id
  resolved server-side. Confirm the check order — a prefix check before
  normalization is bypassable and still a finding.
- **The extraction loop's per-entry guard.** Zip-slip is refuted by a
  resolved-destination-under-root check (or a library that does it). Read the
  loop body; the default extract APIs in most stdlibs do *not* guard.
- **The export query's scoping, end to end.** Confirm whether the export binds
  the tenant context and applies visibility — if the DB layer enforces tenancy
  (forced RLS) the cross-tenant claim is refuted even with no explicit
  `.where()`, but an over-broad *field* set or a missing per-user visibility
  filter can still be real (downgrade, don't dismiss). Cross-reference
  `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/tenant-isolation.md`'s boundary
  model rather than re-deriving it.
- **The actual bound.** For a DoS claim, find whether a cap/pagination/stream
  exists upstream (a default page size, a query `LIMIT`, a streaming response).
  Severity scales with auth requirement and cost to trigger.
- **The disposition/content-type construction.** A reflected-filename claim is
  refuted if the filename is sanitized (CR/LF stripped, `basename`-d) or
  server-generated; a sniffing claim is refuted by a correct `Content-Type` +
  `nosniff`.
- **Reachability and auth.** Is the route mounted, and behind which auth/role?
  An export gated to an admin role is lower-impact than an unauthenticated one
  — but cross-tenant content in an authenticated export is still critical.

## 6. Known false-positive patterns

| Pattern | Why it is not a finding (or not at the reported severity) |
|---|---|
| Download keyed by an opaque server-resolved id (DB row → path), no client path component | No traversal surface. Not a finding regardless of how the file is streamed. |
| `path.join`/`os.path.join` with user input but followed by a post-normalization prefix/`commonpath` check under the root | The guard is present and in the right order. Refuted. |
| Archive extraction via a library/util that validates entry destinations (or an explicit per-entry under-root check) | Zip-slip mitigated. Read the loop to confirm before clearing. |
| Export with no explicit tenant `.where()` but under forced row-level security with the context bound | DB layer is the boundary — not cross-tenant. Re-check field breadth and per-user visibility, which RLS does not cover, before fully clearing. |
| A row/size cap or true streaming already bounds the export | Not unbounded-DoS. A high-but-present cap is a tuning note, not a finding. |
| Upload with server-side type+size validation and a server-generated stored filename | Correct posture. The client `originalname` being *recorded* (not used as the disk path) is fine. |
| `Content-Disposition` filename that is server-generated or sanitized | No reflection surface. Not a finding. |
| Temp files via the platform secure temp API, cleaned in `finally` | Correct hygiene. Not a finding. |
| A diagnostic/support bundle that explicitly excludes secret material and scrubs before zipping | The control working. The finding is the *inclusion* of secrets, not the existence of the bundle. |

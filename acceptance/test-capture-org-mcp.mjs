#!/usr/bin/env node
/**
 * Standing test for harness/capture-org-mcp.mjs — the THIRD, org-effective provenance
 * lane for `artifact-exposed-tools-list` (S3): what the Salesforce org actually sees —
 * which registered MCP servers Agentforce ingested into its API-Catalog and which of
 * their tools/prompts/resources are ACTIVE + wired as callable agent actions
 * (`is-agent-action`). Hermetic: `sf` is stubbed on PATH (a canned per-verb shim that
 * echoes banner-prefixed `--json`, the executor-emitting variant copied from
 * test-teardown-org's `writeFileSync(join(d,'sf'),…) + chmodSync(…,0o755) + prepend d
 * to PATH` pattern), never a live org.
 *
 * The live `sf agent mcp list/get/asset list/fetch` calls are OPERATOR-COLD-RUN-
 * VALIDATED, NOT CI-hermetic — they need a real authed org with the partner MCP server
 * registered (Einstein1AIPlatform + Agentforce, package installed, Connect-API MCP
 * registration done), exactly like standup-org's live `sf org create scratch` and
 * capture-openapi's loopback GETs. The `--fetch` egress leg defers ENTIRELY to the cold
 * run behind the recorded gate. These checks pin ONLY what regresses silently.
 *
 *   M1  planMcpCapture: deterministic listArgv (NO --status) + dated evidence/provenance
 *       paths; serverArgv(alias,id,verb) deterministic argv shapes; unknown verb throws;
 *       input validation (unsafe alias / bad date / missing target)
 *   M2  captureOrgMcp FAILS CLOSED without recorded consent — thrown BEFORE any `sf`
 *       spawn (stub never invoked); no manifest, no evidence, no pointer written
 *   M3  stubbed-sf hermetic run: banner-prefixed list/get/asset-list JSON → parseSfJson
 *       strips the banners, the manifest buckets assets by `kind`, records active /
 *       isAgentAction correctly, and a DISCONNECTED server is enumerated (status recorded)
 *   M4  NAMES/IDS-only: a serverUrl `?token=…` + an authFields blob + a fetch-body secret
 *       land NOWHERE in the manifest / evidence / provenance — only serverUrlHost survives
 *   M5  --dry-run purity: writes the planned manifest, spawns NO `sf`, writes no evidence
 *   M6  degrade-honestly: empty `agent mcp list` → status 'no-mcp-servers', no fabricated
 *       tools, no evidence; per-server get/asset are never called
 *   M7  reconciliation contract (re-targeted): the engine provenance `counts` is
 *       org-effective ONLY ({servers,activeAgentActions,registeredAssets}) + a note that A
 *       CORROBORATES / never substitutes N and does NOT restate N; orgId tolerated null;
 *       generate-artifacts step 4 states A corroborates / never substitutes N
 *   M8  --fetch OFF by default: no `fetch` argv spawned unless fetch:true; fetchDelta only
 *       present when fetch ran
 *   W1  generate-artifacts step 3 consumes the org-effective lane (additive, deep-audit-gated)
 *   W2  generate-artifacts step 4 NAMES the third (org-catalog) active-agent-action count
 *   W3  run-scans + generate-artifacts GRANT capture-org-mcp.mjs in allowed-tools
 *   W4  the wiring states it rides the recorded sf-deep-audit-ops consent (NO new gate)
 *
 * Dependency-free: `node acceptance/test-capture-org-mcp.mjs` (exit 0 = pass).
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  planMcpCapture, serverArgv, captureOrgMcp, buildProvenance, hostOnly,
  assertCaptureAlias, assertMcpServerId, ORG_MCP_SCHEMA,
} from '../harness/capture-org-mcp.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const ENGINE = fileURLToPath(new URL('../harness/capture-org-mcp.mjs', import.meta.url))
let pass = 0, fail = 0
const dirs = []
const check = (name, fn) => { try { fn(); pass++; console.log(`  ✓ ${name}`) } catch (e) { fail++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').join('\n    ')}`) } }
const box = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'srt-orgmcp-'))); dirs.push(d); return d }

// ── canned per-verb `sf agent mcp …` bodies (banner-prefixed by the shim) ──────────
// list carries a DISCONNECTED server (enumerate-regardless) + a serverUrl with a token
const LIST_FULL = '{"status":0,"result":[{"id":"0MwMcpServer001","label":"Partner MCP","type":"EXTERNAL","status":"ACTIVE","serverUrl":"https://mcp.partner.example.com/sse?token=SUPERSECRET_TOKEN_9f&session=SESSID_abc123"},{"id":"0MwMcpServer002","label":"Legacy MCP","type":"EXTERNAL","status":"DISCONNECTED","serverUrl":"https://legacy.partner.example.com/mcp"}]}'
const LIST_EMPTY = '{"status":0,"result":[]}'
// get carries a serverUrl token AND an authFields access/refresh-token blob (must not leak)
const GET_FULL = '{"status":0,"result":{"id":"0MwMcpServer001","label":"Partner MCP","type":"EXTERNAL","status":"ACTIVE","serverUrl":"https://mcp.partner.example.com/sse?token=SUPERSECRET_TOKEN_9f&session=SESSID_abc123","authFields":{"accessToken":"00Dxx0000001!AR_ACCESSTOKEN_SECRET","refreshToken":"5Aep861_REFRESH_SECRET"}}}'
const ASSET_FULL = '{"status":0,"result":[{"name":"read_account","kind":"MCP_TOOL","active":true,"is-agent-action":true},{"name":"propose_update","kind":"MCP_TOOL","active":true,"is-agent-action":false},{"name":"acct_summary_prompt","kind":"MCP_PROMPT","active":false,"is-agent-action":false},{"name":"acct_doc","kind":"MCP_RESOURCE","active":true,"is-agent-action":false}]}'
// fetch body carries a secret-shaped field — buildFetchDelta keeps names only
const FETCH_FULL = '{"status":0,"result":[{"name":"read_account","kind":"MCP_TOOL","active":true,"is-agent-action":true,"inputSchema":"FETCH_BODY_SECRET_LEAK_zzz"},{"name":"new_live_tool","kind":"MCP_TOOL","active":false,"is-agent-action":false}]}'

// A stub `sf`: logs the invoked verb to $SF_STUB_LOG (proof of (non-)invocation) and
// echoes the canned per-verb JSON prefixed with BOTH the update banner and the preview
// banner (parseSfJson must strip both). `listBody` is parameterized for the empty-catalog case.
function stubSf(listBody) {
  const d = join(box(), 'bin'); mkdirSync(d, { recursive: true })
  const script = [
    '#!/bin/sh',
    'verb="$3"',
    'if [ "$3" = "asset" ] && [ "$4" = "list" ]; then verb="asset-list"; fi',
    'if [ -n "$SF_STUB_LOG" ]; then printf \'%s\\n\' "$verb" >> "$SF_STUB_LOG"; fi',
    'printf \'%s\\n\' " ›   Warning: @salesforce/cli update available from 2.137.7 to 2.141.6."',
    'printf \'%s\\n\' "This command is in preview."',
    'case "$verb" in',
    `  list) printf '%s\\n' '${listBody}' ;;`,
    `  get) printf '%s\\n' '${GET_FULL}' ;;`,
    `  asset-list) printf '%s\\n' '${ASSET_FULL}' ;;`,
    `  fetch) printf '%s\\n' '${FETCH_FULL}' ;;`,
    '  *) printf \'%s\\n\' \'{"status":1,"result":null}\' ;;',
    'esac',
    '',
  ].join('\n')
  writeFileSync(join(d, 'sf'), script)
  chmodSync(join(d, 'sf'), 0o755)
  return d
}

// Run `fn` with the stub `sf` on PATH and $SF_STUB_LOG pointed at `logPath` (in-process).
function withStub(stubDir, logPath, fn) {
  const origPath = process.env.PATH
  const origLog = process.env.SF_STUB_LOG
  process.env.PATH = `${stubDir}:${origPath}`
  if (logPath) process.env.SF_STUB_LOG = logPath; else delete process.env.SF_STUB_LOG
  try { return fn() } finally {
    process.env.PATH = origPath
    if (origLog === undefined) delete process.env.SF_STUB_LOG; else process.env.SF_STUB_LOG = origLog
  }
}

// A plan pinned to a per-test box (tmpRoot inside the box so cleanup is total).
function planIn(target, alias, date) {
  return planMcpCapture({ target, alias, date, tmpRoot: join(target, 'sf-srt-org-mcp', 'run') })
}

console.log('capture-org-mcp standing test')

check('M1 planMcpCapture deterministic argv + paths; serverArgv shapes; validation', () => {
  const p = planMcpCapture({ target: '/repo', alias: 'sf-srt-org-m1', date: '2026-07-07', tmpRoot: join(tmpdir(), 'sf-srt-org-mcp', 'm1') })
  assert.equal(p.schema, ORG_MCP_SCHEMA)
  assert.deepEqual(p.listArgv, ['agent', 'mcp', 'list', '--type', 'EXTERNAL', '--json', '--target-org', 'sf-srt-org-m1'])
  assert.ok(!p.listArgv.includes('--status'), 'list runs WITHOUT --status (enumerate DISCONNECTED too)')
  assert.equal(p.evidencePath, join('/repo', '.security-review', 'evidence', 'mcp-org-effective-2026-07-07.json'))
  assert.equal(p.provenancePath, join('/repo', '.security-review', 'evidence', 'mcp-org-effective-2026-07-07.provenance.json'))
  // serverArgv(alias, id, verb) — alias is an INPUT (audit correction #2); deterministic
  assert.deepEqual(serverArgv('sf-srt-org-m1', '0MwXYZ', 'asset list'),
    ['agent', 'mcp', 'asset', 'list', '--mcp-server-id', '0MwXYZ', '--target-org', 'sf-srt-org-m1', '--json'])
  assert.deepEqual(serverArgv('sf-srt-org-m1', '0MwXYZ', 'get'),
    ['agent', 'mcp', 'get', '--mcp-server-id', '0MwXYZ', '--target-org', 'sf-srt-org-m1', '--json'])
  assert.deepEqual(serverArgv('sf-srt-org-m1', '0MwXYZ', 'fetch'),
    ['agent', 'mcp', 'fetch', '--mcp-server-id', '0MwXYZ', '--target-org', 'sf-srt-org-m1', '--json'])
  assert.deepEqual(serverArgv('sf-srt-org-m1', '0MwXYZ', 'asset list'), serverArgv('sf-srt-org-m1', '0MwXYZ', 'asset list')) // deterministic
  assert.throws(() => serverArgv('sf-srt-org-m1', '0MwXYZ', 'delete'), /unknown verb/)
  assert.throws(() => serverArgv('sf-srt-org-m1', 'evil; rm -rf', 'get'), /unsafe mcp-server-id/)
  assert.throws(() => serverArgv('bad alias', '0MwXYZ', 'get'), /unsafe target-org alias/)
  // planner validation
  assert.throws(() => planMcpCapture({ target: '/r', alias: '', date: '2026-07-07' }), /unsafe target-org alias/)
  assert.throws(() => planMcpCapture({ target: '/r', alias: 'sf-srt-org-x\nprod', date: '2026-07-07' }), /unsafe target-org alias/)
  assert.throws(() => planMcpCapture({ target: '', alias: 'sf-srt-org-x', date: '2026-07-07' }), /target repo required/)
  assert.throws(() => planMcpCapture({ target: '/r', alias: 'sf-srt-org-x', date: 'July 7' }), /invalid date/)
  // deterministic argv helpers
  assert.equal(hostOnly('https://mcp.partner.example.com/sse?token=abc'), 'mcp.partner.example.com')
  assert.equal(hostOnly('not a url'), null)
  assert.equal(assertCaptureAlias('sf-srt-org-x'), 'sf-srt-org-x')
  assert.equal(assertMcpServerId('0MwServer001'), '0MwServer001')
})

check('M2 captureOrgMcp FAILS CLOSED without recorded consent (stub never invoked, nothing written)', () => {
  const t = box()
  const p = planIn(t, 'sf-srt-org-m2', '2026-07-07')
  const stub = stubSf(LIST_FULL)
  const log = join(box(), 'invoked.log')
  withStub(stub, log, () => {
    assert.throws(() => captureOrgMcp(p, { consent: false, target: t }), /without explicit consent/)
    assert.throws(() => captureOrgMcp(p, { target: t }), /without explicit consent/) // default consent=false
    assert.throws(() => captureOrgMcp(p, { consent: 'yes', target: t }), /without explicit consent/) // strictly === true
  })
  assert.ok(!existsSync(log), 'the stub `sf` was NEVER invoked — the throw precedes any spawn')
  assert.ok(!existsSync(p.manifestPath), 'no manifest written')
  assert.ok(!existsSync(p.evidencePath), 'no evidence written')
  assert.ok(!existsSync(join(t, p.pointerRel)), 'no pointer written')
})

check('M3 stubbed-sf hermetic run: banners stripped, kind-bucketed, active/isAgentAction recorded, DISCONNECTED enumerated', () => {
  const t = box()
  const p = planIn(t, 'sf-srt-org-m3', '2026-07-07')
  const stub = stubSf(LIST_FULL)
  const log = join(box(), 'invoked.log')
  const m = withStub(stub, log, () => captureOrgMcp(p, { consent: true, target: t, capturedAt: '2026-07-07T00:00:00Z' }))
  assert.equal(m.status, 'captured')
  const inv = JSON.parse(readFileSync(p.evidencePath, 'utf8'))
  assert.equal(inv.schema, ORG_MCP_SCHEMA)
  const s0 = inv.servers[0]
  assert.equal(s0.label, 'Partner MCP', 'banner stripped → the JSON parsed cleanly')
  // bucket assets by kind
  const byKind = (k) => s0.assets.filter((a) => a.kind === k)
  assert.equal(byKind('MCP_TOOL').length, 2)
  assert.equal(byKind('MCP_PROMPT').length, 1)
  assert.equal(byKind('MCP_RESOURCE').length, 1)
  // active / isAgentAction recorded correctly
  const ra = s0.assets.find((a) => a.name === 'read_account')
  assert.equal(ra.active, true); assert.equal(ra.isAgentAction, true)
  const pu = s0.assets.find((a) => a.name === 'propose_update')
  assert.equal(pu.active, true); assert.equal(pu.isAgentAction, false)
  const sm = s0.assets.find((a) => a.name === 'acct_summary_prompt')
  assert.equal(sm.active, false)
  // DISCONNECTED server enumerated, status recorded (list ran WITHOUT --status)
  const disc = inv.servers.find((s) => s.status === 'DISCONNECTED')
  assert.ok(disc && disc.id === '0MwMcpServer002', 'the DISCONNECTED admin server is enumerated + its status recorded')
  // the stub was invoked for list/get/asset-list, NOT fetch (fetch off by default)
  const verbs = readFileSync(log, 'utf8').split('\n').filter(Boolean)
  assert.ok(verbs.includes('list') && verbs.includes('get') && verbs.includes('asset-list'), verbs.join(','))
  assert.ok(!verbs.includes('fetch'), 'fetch not spawned without --fetch')
})

check('M4 NAMES/IDS-only: no token / authFields / session / fetch-secret / full-URL leaks anywhere', () => {
  const t = box()
  const p = planIn(t, 'sf-srt-org-m4', '2026-07-07')
  const stub = stubSf(LIST_FULL)
  const m = withStub(stub, join(box(), 'invoked.log'), () => captureOrgMcp(p, { consent: true, target: t, fetch: true, capturedAt: '2026-07-07T00:00:00Z' }))
  assert.equal(m.status, 'captured')
  const evidence = readFileSync(p.evidencePath, 'utf8')
  const provenance = readFileSync(p.provenancePath, 'utf8')
  const manifest = readFileSync(p.manifestPath, 'utf8')
  const all = evidence + '\n' + provenance + '\n' + manifest
  for (const secret of ['SUPERSECRET_TOKEN', 'token=', 'SESSID', 'authFields', 'accessToken', 'ACCESSTOKEN_SECRET', 'REFRESH_SECRET', 'FETCH_BODY_SECRET_LEAK', '/sse']) {
    assert.ok(!all.includes(secret), `secret-shaped token '${secret}' must NOT appear in evidence/provenance/manifest`)
  }
  // only the bare host survives
  const inv = JSON.parse(evidence)
  assert.equal(inv.servers[0].serverUrlHost, 'mcp.partner.example.com')
  // the server entry is a strict allowlist — never a spread of the raw `get` body
  assert.deepEqual(Object.keys(inv.servers[0]).sort(), ['assets', 'fetchDelta', 'id', 'label', 'serverUrlHost', 'status', 'type'].sort())
  // the fetch delta is names-only
  const fd = inv.servers[0].fetchDelta
  assert.ok(fd.onlyAdvertised.includes('new_live_tool'))
  assert.ok(!JSON.stringify(fd).includes('FETCH_BODY_SECRET_LEAK'))
})

check('M5 --dry-run purity: planned manifest, NO `sf` spawn, no evidence', () => {
  const t = box()
  mkdirSync(join(t, '.security-review'), { recursive: true })
  writeFileSync(join(t, '.security-review', 'org-standup.json'), JSON.stringify({ schema: 'sf-srt-org/1', runId: 'm5', alias: 'sf-srt-org-m5', manifestPath: join(t, 'gone', 'org-manifest.json'), status: 'created' }))
  const stub = stubSf(LIST_FULL)
  const log = join(box(), 'invoked.log')
  const tmpBox = box()
  const out = execFileSync('node', [ENGINE, '--dry-run', '--json', '--target', t], {
    encoding: 'utf8', env: { ...process.env, PATH: `${stub}:${process.env.PATH}`, SF_STUB_LOG: log, TMPDIR: tmpBox },
  })
  const m = JSON.parse(out)
  assert.equal(m.status, 'planned')
  assert.equal(m.schema, ORG_MCP_SCHEMA)
  assert.equal(m.alias, 'sf-srt-org-m5')
  assert.ok(!existsSync(log), 'dry-run spawns NO `sf`')
  assert.ok(!existsSync(m.evidencePath), 'dry-run writes no evidence file')
})

check('M6 degrade-honestly: empty `agent mcp list` → no-mcp-servers, no fabricated tools, no evidence', () => {
  const t = box()
  const p = planIn(t, 'sf-srt-org-m6', '2026-07-07')
  const stub = stubSf(LIST_EMPTY)
  const log = join(box(), 'invoked.log')
  const m = withStub(stub, log, () => captureOrgMcp(p, { consent: true, target: t, capturedAt: '2026-07-07T00:00:00Z' }))
  assert.equal(m.status, 'no-mcp-servers')
  assert.equal(m.serverCount, 0)
  assert.match(m.reason, /code\+protocol-derived/)
  assert.ok(!existsSync(p.evidencePath), 'no fabricated evidence file on an empty catalog')
  // list ran; per-server get/asset were NEVER called (no servers)
  const verbs = readFileSync(log, 'utf8').split('\n').filter(Boolean)
  assert.deepEqual(verbs, ['list'], 'only `list` ran — no per-server queries')
})

check('M7 reconciliation contract: org-effective counts only + A corroborates/never substitutes N; orgId null-tolerant; step 4 wiring', () => {
  const t = box()
  const p = planIn(t, 'sf-srt-org-m7', '2026-07-07')
  const stub = stubSf(LIST_FULL)
  withStub(stub, join(box(), 'invoked.log'), () => captureOrgMcp(p, { consent: true, target: t, capturedAt: '2026-07-07T00:00:00Z' }))
  const prov = JSON.parse(readFileSync(p.provenancePath, 'utf8'))
  // counts carry ONLY the three org-effective counts — never a restated registry N
  assert.deepEqual(Object.keys(prov.counts).sort(), ['activeAgentActions', 'registeredAssets', 'servers'].sort())
  assert.equal(prov.counts.servers, 2)
  assert.equal(prov.counts.registeredAssets, 8) // 2 servers × 4 assets
  assert.equal(prov.counts.activeAgentActions, 2) // read_account (active+is-agent-action) × 2 servers
  assert.ok(!('registryCount' in prov.counts) && !('N' in prov.counts), 'the engine does NOT restate the registry N')
  // A corroborates / never substitutes N
  assert.match(prov.reconciliation, /CORROBORAT/i)
  assert.match(prov.reconciliation, /NEVER SUBSTITUT/i)
  assert.match(prov.reconciliation, /step 4/)
  assert.equal(prov.source, 'org-effective-agentforce-api-catalog')
  assert.equal(prov.artifact, 'artifact-exposed-tools-list')
  assert.equal(prov.prodEquivalence, 'PENDING')
  // orgId is sourced from the standup manifest → null when unavailable (correction #4)
  assert.ok('orgId' in prov.org, 'org carries an orgId field')
  assert.equal(prov.org.orgId, null, 'orgId tolerated null when the standup manifest carries none')
  // buildProvenance is a pure function of (plan, rec) and never restates N
  const pure = buildProvenance(p, { servers: [], orgId: null, capturedAt: null, status: 'captured' })
  assert.deepEqual(pure.counts, { servers: 0, activeAgentActions: 0, registeredAssets: 0 })
  // step 4 of generate-artifacts states A corroborates / never substitutes N
  const genArt = readFileSync(join(ROOT, 'skills', 'generate-artifacts', 'SKILL.md'), 'utf8')
  assert.match(genArt, /the org catalog has A active agent actions of the N registered/)
  assert.match(genArt, /corroborat/i)
  assert.match(genArt, /never substituted for N/)
})

check('M8 --fetch OFF by default: no `fetch` argv unless fetch:true; fetchDelta only when fetch ran', () => {
  // fetch:false → no fetch spawn, no fetchDelta
  const t1 = box()
  const p1 = planIn(t1, 'sf-srt-org-m8a', '2026-07-07')
  const log1 = join(box(), 'invoked.log')
  const m1 = withStub(stubSf(LIST_FULL), log1, () => captureOrgMcp(p1, { consent: true, target: t1, fetch: false, capturedAt: '2026-07-07T00:00:00Z' }))
  assert.ok(!readFileSync(log1, 'utf8').split('\n').includes('fetch'), 'no fetch argv spawned by default')
  assert.ok(!('fetchDelta' in m1.servers[0]), 'no fetchDelta without --fetch')
  // fetch:true → fetch spawns, fetchDelta present
  const t2 = box()
  const p2 = planIn(t2, 'sf-srt-org-m8b', '2026-07-07')
  const log2 = join(box(), 'invoked.log')
  const m2 = withStub(stubSf(LIST_FULL), log2, () => captureOrgMcp(p2, { consent: true, target: t2, fetch: true, capturedAt: '2026-07-07T00:00:00Z' }))
  assert.ok(readFileSync(log2, 'utf8').split('\n').includes('fetch'), 'fetch argv spawned when fetch:true')
  assert.ok(m2.servers[0].fetchDelta && typeof m2.servers[0].fetchDelta === 'object', 'fetchDelta present when fetch ran')
})

// ─────────────────────────────────────────────────────────────── WIRING (read the skills)

const genArtText = readFileSync(join(ROOT, 'skills', 'generate-artifacts', 'SKILL.md'), 'utf8')
const runScansText = readFileSync(join(ROOT, 'skills', 'run-scans', 'SKILL.md'), 'utf8')
const fmOf = (text) => (text.split('---')[1] || '')
const allowedOf = (fm) => (fm.split('\n').find((l) => l.startsWith('allowed-tools:')) || '')

check('W1 generate-artifacts step 3 consumes the org-effective lane (additive, deep-audit-gated)', () => {
  assert.ok(genArtText.includes('capture-org-mcp.mjs'), 'step 3 references the org-effective engine')
  assert.ok(genArtText.includes('mcp-org-effective-<date>.json'), 'step 3 names the org-effective evidence file')
  assert.ok(genArtText.includes('org-effective-agentforce-api-catalog'), 'provenance source named')
  assert.ok(/is-agent-action/.test(genArtText), 'the unique activation evidence named')
  assert.ok(/ADDITIVE/.test(genArtText), 'the lane is stated ADDITIVE')
  assert.ok(genArtText.includes('no-mcp-servers'), 'the source-only degrade path is named')
})

check('W2 generate-artifacts step 4 NAMES the third (org-catalog) active-agent-action count', () => {
  assert.ok(genArtText.includes('the org catalog has A active agent actions of the N registered'), 'the three-count reconciliation names the org-catalog A')
  assert.ok(/all three counts/.test(genArtText), 'the reconciliation statement now spans all three counts')
})

check('W3 run-scans + generate-artifacts GRANT capture-org-mcp.mjs in allowed-tools', () => {
  assert.ok(allowedOf(fmOf(runScansText)).includes('Bash(node *harness/capture-org-mcp.mjs *)'), 'run-scans grants the engine')
  assert.ok(allowedOf(fmOf(genArtText)).includes('Bash(node *harness/capture-org-mcp.mjs *)'), 'generate-artifacts grants the engine')
})

check('W4 the wiring states it rides the recorded sf-deep-audit-ops consent (NO new gate)', () => {
  // anchor on the STEP-3 bullet (the front-matter grant mentions the engine first)
  const i = genArtText.indexOf('mcp-org-effective-<date>.json')
  const nearby = genArtText.slice(Math.max(0, i - 700), i + 700)
  assert.ok(/sf-deep-audit-ops/.test(nearby), 'the sf-deep-audit-ops token is named as the gate it rides')
  assert.ok(/no new gate/i.test(nearby), 'no-new-gate stated at the wiring')
  // run-scans states the same
  assert.ok(/capture-org-mcp\.mjs/.test(runScansText), 'run-scans references the engine')
  assert.ok(/sf-deep-audit-ops/.test(runScansText), 'run-scans names the consent it rides')
})

for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }) } catch {} }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

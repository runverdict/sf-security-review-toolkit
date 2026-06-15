# Helios Acceptance Fixture — Sealed Ground-Truth Plant List

**This file is the grading key for the acceptance test. It lives in the toolkit
repo, NOT in the fixture — a finder that could read it would cheat the recall
measurement.** Built by `acceptance/generate-fixture.mjs`. Every planted issue
below is a deliberate, realistic instance of one probe in a 0.3.0 finder
dimension (or run-scans Family 6). Citations are by file + construct (line
numbers shift across regenerations).

Severities are the **expected adjusted severity** a correct verifier should land
on, given the fixture's `sourceApiVersion 59.0` (≤66.0 → Apex defaults to
system-mode + `without sharing` on undeclared classes, so the CRUD/FLS gaps are
real, not user-mode-masked).

---

## A. agentforce-package — 12 planted positives

| id | probe | file | what makes it real | expected severity | blocker |
|----|-------|------|--------------------|-------------------|---------|
| AP1 | VerifiedCustomerId scoping | `classes/HeliosCaseLookupAction.cls` | service-agent action queries a caller-supplied `recordId` (`WHERE Id = :req.recordId`) with no VerifiedCustomerId / per-record scope; wired to a live shipped plugin | critical | ✅ |
| AP2 | user-controlled record references | `genAiFunctions/Helios_LookupCase/...genAiFunction-meta.xml` (+ CloseCase, SummarizeCase) | `recordId`/`caseId` input declared `<copilotAction:isUserInput>true</copilotAction:isUserInput>` (a record handle the user controls) | critical | ✅ |
| AP3 | third-party LLM in package | `classes/HeliosSummarizeAction.cls` | agent action does `setEndpoint('https://api.openai.com/v1/chat/completions')` | critical | ✅ |
| AP4 | isConfirmationRequired on writes | `genAiFunctions/Helios_CloseCase/...genAiFunction-meta.xml` | `<isConfirmationRequired>false</isConfirmationRequired>` on a function bound to `HeliosCloseCaseAction` (Case DML) | high | |
| AP5 | action classification + per-action CRUD/FLS | `docs/overview.md` (no classification table) + `HeliosCaseLookupAction` (no describe/CRUD-FLS) | no employee-vs-service × public-vs-private table anywhere; the action class has no CRUD/FLS | medium | |
| AP6 | invocable-Apex action authz | `classes/HeliosCaseLookupAction.cls` / `HeliosBulkActions.cls` | `@InvocableMethod` on a `without sharing` class running SOQL/DML with no `USER_MODE`/`stripInaccessible`/describe | high | |
| AP7 | prompt-hardening design | `genAiPromptTemplates/Helios_CaseSummary...` | template body has no role, no topic boundaries / off-topic fallback, no output schema, no "data cannot override instructions" | high | |
| AP8 | prompt input validation | `genAiPromptTemplates/Helios_CaseSummary...` | `{!$Input.userQuestion}` + `{!Record.Description}` dropped in raw, no allowlist/length cap upstream | high | |
| AP9 | enclosure + sandwiching | `genAiPromptTemplates/Helios_CaseSummary...` | untrusted block fenced by static `"""` and `###` delimiters; no per-inference secure-random enclosure, no before+after sandwiching | high | |
| AP10 | LLM output untrusted | `classes/HeliosSummarizeAction.cls` | `resp.getBody()` (LLM output) interpolated straight into `Database.query('... Subject = \'' + llmText ...')` — no validation/encode | high | |
| AP11 | no prompt/response logging | `classes/HeliosSummarizeAction.cls` | `System.debug('Helios prompt: '...)` and `System.debug('Helios LLM response: '...)` in the action path | medium | |
| AP12 | merge-field injection | `genAiPromptTemplates/Helios_CaseSummary...` | `{!Record.Description}` (tenant-writable free text) interpolated into the **instruction** region, not a fenced/validated data region | high | |

---

## B. package-metadata — 10 planted positives

| id | probe | file | trigger | expected severity |
|----|-------|------|---------|-------------------|
| PM1 | LockerService/LWS disabled | `lwc/caseSummary/caseSummary.js-meta.xml` (39.0), `aura/heliosBanner/heliosBanner.cmp-meta.xml` (38.0) | `<apiVersion>` < 40.0 | high |
| PM2 | LMC exposed | `messageChannels/HeliosCaseChannel.messageChannel-meta.xml` | `<isExposed>true</isExposed>` with no documented cross-namespace consumer | medium–high |
| PM3 | JS in Salesforce origin | `objects/Case/webLinks/HeliosCaseScript.weblink-meta.xml` | `<openType>onClickJavaScript</openType>` + `REQUIRESCRIPT(` + `javascript:` | high |
| PM4 | CSS component isolation | `lwc/caseSummary/caseSummary.css` (`position: absolute`), `aura/heliosBanner/heliosBanner.css` (`position: fixed`) | `position: absolute/fixed` in component CSS | high |
| PM5 | third-party JS/CSS hotlinking | `lwc/caseSummary/caseSummary.html` (`<script src=http>`), `caseSummary.js` (`loadScript('http…')`), `aura/heliosBanner/heliosBanner.cmp` (`<link href=http>`, `ltng:require` http), `pages/HeliosCaseEdit.page` (`apex:includeScript value=http`) | off-platform `http://` resource refs | high |
| PM6 | open redirect | `classes/HeliosCaseVfController.cls` (`save()`) | `PageReference` from `getParameters().get('retURL')` + `setRedirect(true)`, no allowlist | high |
| PM7 | CSRF on instantiation | `pages/HeliosCaseEdit.page` + `…page-meta.xml` (`action={!save}` does DML, `confirmationTokenRequired` false), `lwc/caseAdmin/caseAdmin.js` (`connectedCallback` fires `@AuraEnabled` DML) | DML on load without token | high |
| PM8 | sample/copied code | `classes/HeliosSampleHelper.cls` | StackOverflow attribution + "do not use in production" + TODO sample markers | low (candidate) |
| PMa | RemoteSite/CSP inventory | `remoteSiteSettings/Helios_Legacy_Http` (`http://`), `Helios_Wildcard` (`https://*.`), `cspTrustedSites/Helios_Csp_Http` (`http://`) | `http://` and `*` wildcard are standalone findings | medium |
| PMb | packaged-UI URL sensitive info | `lwc/caseSummary/caseSummary.js` (recordId in `NavigationMixin` state + hand-built URL), `pages/HeliosCaseEdit.page` (`?id={!record.Id}`) | record Id placed into a URL/nav state | medium |

---

## C. apex-exposed-surface — 8 planted positives

| id | probe | file | trigger | expected severity |
|----|-------|------|---------|-------------------|
| AE1 | @AuraEnabled IDOR | `classes/HeliosCaseController.cls` (`getCase`, `updateSubject`) | non-cacheable `@AuraEnabled`, `without sharing`, caller `Id recordId`, `WHERE Id = :recordId` + `update`, no CRUD/FLS, no per-record check | high |
| AE2 | @RestResource per-record + over-exposure | `classes/HeliosCaseRestService.cls` | `global` `@RestResource` reads `RestContext` id, queries/updates by it, no per-record authz | high |
| AE3 | webservice SOAP over-exposure | `classes/HeliosAccountSoap.cls` | `webservice static` methods, `without sharing`, unguarded read + DML | high |
| AE4 | @InvocableMethod self-authorizing | `classes/HeliosBulkActions.cls` | `@InvocableMethod` taking caller `List<Id>`, `without sharing`, reassigns owners, no check | high |
| AE5 | @RemoteAction no CRUD/FLS | `classes/HeliosRemotingController.cls` | `global static @RemoteAction`, unguarded read + DML | high |
| AE6 | global missing-sharing + over-exposure | `classes/HeliosPublicApi.cls` | `global class` with NO sharing keyword + a needlessly-`global` helper (`internalCacheKey`) | medium–high |
| AE7 | VF/Aura controller authz | `classes/HeliosCaseVfController.cls` | `public` controller doing per-record DML with no access check (bound to `HeliosCaseEdit.page`) | high |
| AE8 | guest-user reachability | `classes/HeliosGuestCaseController.cls` + `permissionsets/Helios_Site_Guest...` (`<classAccesses>`) + `sites/Helios_Support.site-meta.xml` / `networks/Helios_Support.network-meta.xml` | `without sharing` `@AuraEnabled` granted to a guest profile, reachable from a live Site/Network, no access check | critical (public-exposure tier) |

---

## D. secrets — run-scans Family 6 (NOT the audit engine)

| id | probe | location | trigger | expected severity | graded by |
|----|-------|----------|---------|-------------------|-----------|
| F6 | git-history secret | `config/credentials.env`, **deleted in commit 3 of 3** (recoverable from history) | synthetic AWS key id (`AKIA…`) + 40-char secret + signing secret + SF client secret in a deleted blob | critical | **gitleaks/trufflehog over full history** (SECRET-SCAN-FAMILY-6.md). The audit engine reads the **working tree**, so its `secrets-credentials` finder will NOT see the deleted blob — that is the whole point of the Family-6 mechanical scan. |

---

## E. Negative controls — the verifier MUST NOT flag these

| id | safe pattern | file | why it is not a finding |
|----|--------------|------|--------------------------|
| N1 | `apiVersion` exactly 40.0 | `lwc/caseAdmin/caseAdmin.js-meta.xml` | Locker enabled AT 40.0 — threshold, compliant |
| N2 | `position: relative` | `lwc/caseAdmin/caseAdmin.css` | relative/sticky/static are fine — only absolute/fixed break isolation |
| N3 | weblink `<openType>url</openType>` | `objects/Case/webLinks/HeliosCaseOpen.weblink-meta.xml` | plain navigation, relative URL, no JS |
| N4 | `<isExposed>false</isExposed>` | `messageChannels/HeliosInternalChannel...` | not exposed cross-namespace |
| N5 | hardened prompt template | `genAiPromptTemplates/Helios_SafeReply...` | role + topic boundaries + off-topic fallback + output schema + "data cannot override" + per-inference enclosure + sandwiching |
| N6 | platform Models API | `classes/HeliosModelsApiAction.cls` | `ConnectApi.EinsteinLLM` is the sanctioned platform path, NOT a third-party LLM |
| N7 | owner-bound user-mode query | `classes/HeliosSafeService.cls`, `HeliosCaseController.myCases` | `with sharing` / `WHERE OwnerId = :UserInfo.getUserId()` / `WITH USER_MODE` — no caller-controlled Id, no IDOR |
| N8 | `$Resource` vendored script | `lwc/caseSummary/caseSummary.js` (`loadScript(this, HELIOS_ASSETS + …)`) | correct vendored static-resource pattern, not a hotlink |

---

## Grading

- **Recall (the headline metric):** for A/B/C, the fraction of planted positives
  the engine **confirmed** (verdict `confirmed_real`/`partially_real`) — credited
  if matched by file + construct, ideally by the **intended** dimension. A missed
  planted class = the dimension encoding was not forceful enough → sharpen the
  dimension file and re-run (the standing rule).
- **Precision:** the fraction of negative controls the engine did **not** flag
  (verdict `false_positive` or never raised). A flagged negative control = the
  finder/verifier over-fires → tighten the refuter guidance.
- **F6** is graded by the Family-6 scan, separately.
- Overlap is expected and fine (the openai callout is AP3 *and* secrets/egress;
  the VF controller is AE7 *and* PM6/PM7). Credit the planted class if any
  dimension confirms it; note which dimension actually caught it.

# Source Registry — requirements-baseline.yaml

Every distinct source the baseline cites, once, with what it corroborates and
when it was last checked. Companion to `baseline/requirements-baseline.yaml`
(see CONVENTIONS.md §4).

Two different dates do two different jobs:

- **Last checked** (this file) — when the source was last actually read. All
  sources below were read or re-read during the **2026-06-12 primary-source
  reconciliation pass** (official ISVforce Guide pages fetched at their
  current published version; partner-gated material captured the same day),
  except where noted.
- **`last_verified`** (the baseline) — when the *fact* was confirmed against a
  primary channel (Partner Console, ISVforce Guide read directly at its
  current version, partner Slack official post / login-gated partner doc, or
  empirical test). A source can be freshly checked while the fact it supports
  remains `web_research_unverified`.

**Guide version marker:** all `packagingGuide` (ISVforce Guide) pages below
were read at **Summer '26 (API version 67.0), doc version 262.0** — the live
version as of 2026-06-12 — via the official docs content API (the .htm pages
are SPA shells to direct fetchers). The page bodies carry no per-page
last-updated stamp, so the guide version is the date of record.

## The verification ladder

Every entry in the baseline sits on one of three rungs:

1. `web_research_unverified` (`last_verified: null`) — found in public web
   research only. The fact may be right, but no primary channel has confirmed
   it. 36 entries remain here (mostly the MCP-spec threat-model section, the
   WI-19 written-policy artifact stubs, and a handful of endpoint/test-env
   hygiene items the 2026-06 evidence did not touch). Counts are emitted
   deterministically by `harness/baseline-counts.mjs` — do not hand-edit them.
2. `verified_primary` (`last_verified: YYYY-MM-DD`) — confirmed against a
   primary source: the ISVforce Guide read directly at its current version,
   an official Salesforce blog/page read directly, a login-gated partner
   document or official partner-Slack post, or an empirical test. A fact
   merely re-found on another blog is NOT a promotion. 121 entries.
3. `conflicting` — primary-grade sources disagree, or the only source is
   single-tier and uncorroborated; the `conflicts:` field states exactly what
   is open. Skills surface these as "verify with your Partner Account
   Manager / partner Slack before relying on this" — never silently picked.
   **1 entry remains after the 2026-06-12 evidence delta:**
   `endpoint-ssl-labs-a-grade` (whether reviewers enforce a letter grade as
   pass/fail in practice — the codified bar is qualitative). Two further
   open items are FACETS of otherwise-verified entries, tracked in their
   `details`: the AgentExchange questionnaire's field list
   (`artifact-agentexchange-questionnaire-na-reasons` — the N/A-needs-reason
   rule itself is verified) and whether the fee schedule applies as-is to
   MCP-server/API-solution listings (`process-review-fee` — the USD 999
   amount and the per-attempt semantics are verified).

Conflicts resolved on 2026-06-12 (no longer `conflicting`): review
stages/statuses, review timeline semantics, Code Analyzer v5 currency,
Checkmarx currency/allotment/scope, the DAST severity bar, the Trialforce
review-org lifespan, the AgentExchange marketplace identity, the
managed-package requirement for AgentExchange listings, the per-user-authz
purpose (the two-test-user requirement), and — in the same-day evidence
delta — the per-user-authz MECHANICS (settled negatively by the partner
Slack MCP Q&A: per-user auth is not supported on the Agentforce MCP client;
no end-user identity is forwarded at tool-call time; the Authorization Code
flow added ~2026-03 is service-account only; the hosted-MCP-servers docs'
per-user OAuth+PKCE framing describes a different product surface) and the
fee AMOUNT (USD 999 corroborated by a second independent gated source whose
free-solutions $1 schedule + $998 waiver arithmetic reconstructs the base —
resolving the earlier "corrupted capture" read of the adjacent $1 rows).

## Partner-gated sources

Cited by name only — no verbatim prose, no Trialforce Template IDs, no
Salesforce work-item numbers (CONVENTIONS.md §3). To obtain access, ask in the
Partnerblazer Slack MCP channel or via your Partner Account Manager.
partners.salesforce.com URLs are listed where stable, but the content behind
them is login-gated.

| Source | Date | Corroborates | Last checked |
|---|---|---|---|
| MCP Client Partner Technical Guide (login-gated) | 2026-06 (guide's own "last updated" early June 2026) | The 13-row MCP required-artifact table (additive to standard materials); DAST scope including identity endpoints with partner-chosen tooling; the two-test-user PARTNER-side per-user-authorization purpose; the 120-day Trialforce-templated review-org lifespan and PBO Environment Hub creation flow (template id stays gated); the MCP Server Registration packaging quartet (External Credential + External Service Registration + Named Credential + Permission Set) and un-packageable Tool Actions; "AgentExchange listings must be installable Managed Packages"; supported auth (No-Auth / client_credentials), Streamable HTTP only, protocol versions, 1-minute tool timeout; access-control artifact as prose/table documentation | 2026-06-12 |
| Partner Slack security-review posts (official posts by the Salesforce MCP product team in the partner Slack) | 2026-05/06 | Platform constraints behind the `mcp-*` entries (registration-status semantics, rendering, builder limitations — build the review agent with Agent Script); MCP GA feature-gate rollout for PBO/Security Review orgs; manual permission-set assignment to the Platform Integration User in the Security Review org; obsolete pilot feature flags | 2026-06-12 |
| Partner security-review overview article (login-gated; the ISV "Security Review Overview" learn article, AgentExchange-branded) | captured 2026-06 (undated; FAQ blocks internally stale) | 6-8-week total-from-complete-submission timeline; four-step partner prep flow (manual scan → listing + scan upload → demo-org credentials → wizard); "SFCA v5" in the current tool list; Partner Security Portal operational (Checkmarx, BYO DAST, checklist builder, office hours); ZAP-on-API methodology and automated-scans-insufficient; written third-party consent; scanner source-IP allowlist (values stay gated); USD 999 fee for paid solutions (now corroborated by the partner fee/resubmission guide — the adjacent $1 rows are the free-solutions schedule, not corruption; amount verified 2026-06-12); payment-step repetition without double-charge; no expedite path; 6-month-to-2-year periodic re-review + random pen tests; new-version listing association after a pass | 2026-06-12 |
| Partner news: Mandatory Security Updates for Connected Apps and ECAs — https://partners.salesforce.com/pdx/s/pcnews/mandatory-security-updates-for-connected-apps-and-ecas-MC4HLLE66DUFDSPBIC3X3HF6GMI4 | 2026-04-27 | The four mandatory CA/ECA OAuth controls and the 2026-05-11 deadline; the >2-customer-production-orgs applicability test; delisting/suspension enforcement; controls-validation rights; "New Connected Apps Can No Longer Be Created in Spring '26"; ~2-week mid-cycle notice precedent | 2026-06-12 |
| AppExchange Trial Template Policies (community PDF, login-gated, older-era) | undated | Trialforce template content policy: review-approved package versions only; ~40-item unpackaged-standard-pages whitelist; at-least-baseline security configuration (password policy + session settings); >1 Trusted IP range triggers SSROps clarification; scheduled jobs must map to package-owned classes; outbound-message/external-integration clarifications | 2026-06-12 |
| Partner blog: "10 Tips to Passing Security Review" (login-gated) | 2017-01 | Reviewer threat model (authenticated customer-level attacker, multi-hour manual pen test); complete hosted test setup incl. external-service instances; historical 6-8-week total figure | 2026-06-12 |
| Partner blog: "S-Controls Not Allowed Through Security Review" (login-gated) | 2017-01 | Pre-queue rejection exists (S-Controls block queue entry); re-reviews enforce tightened standards retroactively; two-track posture (hard gates for net-new, remediation windows for legacy) | 2026-06-12 |
| Official False Positive Documentation template (login-gated Google Doc, linked from security_review_document_responses.htm) | undated; body captured 2026-06 | The prescribed FP field structure (`artifact-fp-documentation-format`): document header (application name, package/version/listing ID, partner name, filing date, optional target URL, prior review date) + per-vulnerability block (vulnerability name, reviewer-reserved section, Detected-By scanner checklist, detailed FP explanation, evidence, references); worked examples setting the evidence bar (CRUD-violation FP via the gating helper + pre-DML permission check, both excerpted; without-sharing FP via documented business requirement) | 2026-06-12 |
| Partner fee/resubmission guide (login-gated) | captured 2026-06 (undated) | Second independent corroboration of the USD 999 per-attempt fee for paid/freemium solutions (`process-review-fee` amount promoted); periodic and partner-submitted re-reviews fee-bearing; FP-only resubmission $0 vs any-code-change resubmission $999 on a new version; pen-test-no-waiver rule; 4-packages-one-namespace-one-fee 2GP rule; free-solution $1 + fee-waiver-code mechanics ($998 discount — arithmetic reconstructing the 999 base); free→paid conversion fee formula; time-boxed review rationale; risk-factor-report re-review selection | 2026-06-12 |
| Partner Slack MCP Q&A (gated; official answers from the Salesforce MCP product team) | 2026-03/06 | Settles per-user auth NEGATIVELY (`mcp-per-user-authz-mechanics`): not supported on the Agentforce MCP client; no end-user identity forwarded at tool-call time; per-user roadmapped post-GA, no committed date; Authorization Code flow (~2026-03) supports service-account principals only via External Credential (`mcp-auth-no-auth-or-client-credentials`); the partner's OAuth server must allow-list the Salesforce redirect URL for principal authentication (`auth-code-service-account-redirect-allowlist`) | 2026-06-12 |

## Official sources — ISVforce Guide: security review process & materials

All read at Summer '26 (API v67.0), doc v262.0 on 2026-06-12 unless noted.

| Source URL | Corroborates | Last checked |
|---|---|---|
| .../packagingGuide/security_review_how_it_works.htm | Five-step process model (submit, verify, queue, test, notify); per-stage estimates (verification 1-2wk, first-time testing 3-4wk, resubmission 2-3wk); readiness prerequisites incl. Lightning Ready hard gate; patch-version discouragement; fee at submission + free-distribution exemption; binary Approved/Not Approved; black-box time-limited review with representative findings; DE-org requirement (MC exempt); office-hours routing | 2026-06-12 |
| .../packagingGuide/security_review_stages.htm (byte-verified) | Four stages (Prepare & Submit, Submission Verification, Testing, Done) + Expired as unofficial fifth; five statuses (Submitted, Returned, Failed, Passed, Expired); Returned in both verification and testing, free resubmit; FP-only resubmission of a Failed review free; remediated retest = new version + new paid review; Overview-page tracker; actors (Security Review Operations / Product Security) | 2026-06-12 |
| .../packagingGuide/security_review_required_materials.htm | 9-artifact × 6-architecture required-materials matrix; follow-the-data scope; over-inclusion guidance; Managed—Released only; FP docs + solution docs for all classes; company infosec policies with size/maturity factored; Checklist Builder; extension-package install rules; mobile provisioning | 2026-06-12 |
| .../packagingGuide/security_review_test_all.htm (byte-verified) | External-endpoint in-scope criteria (auth role OR Salesforce data transfer); DE-org pen-test rights; scanner table (Code Analyzer mandatory for managed packages w/ written-justification escape hatch; Checkmarx required for package/component submissions, not API-only/mobile, 3 runs per package version; PMD free but not accepted; DAST methodology incl. report contents); third-party testing permission + IP/domain allow guidelines | 2026-06-12 |
| .../packagingGuide/security_review_code_analyzer_scan.htm (byte-verified) | The exact required v5 command (`sf code-analyzer run --rule-selector AppExchange --rule-selector Recommended:Security --output-file CodeAnalyzerReport.html`); scan-fix-rescan-upload workflow; not-100%-passing posture; in-addition-to-Checkmarx rule; Manage Listings permission | 2026-06-12 |
| .../packagingGuide/security_review_document_responses.htm (byte-verified) | DAST severity bar (critical+high require attention; low/medium investigation-encouraged only); Checkmarx bar (all but "Code Quality"); FP minimum structure (Location + Explanation) and template reference | 2026-06-12 |
| .../packagingGuide/security_review_false_positives.htm | FP document required per flagged false positive; format-flexible; justification categories; FP sources (Checkmarx, ZAP, Burp, failure reports) | 2026-06-12 |
| .../packagingGuide/security_review_example_checkmarx_scan.htm | Worked accepted FP/remediation language for FLS Update, Sharing Violation, Stored XSS | 2026-06-12 |
| .../packagingGuide/security_review_example_failure_report.htm | Failure-report categories (Insecure Software Version, Insecure Storage of Sensitive Data, Stored XSS) and accepted retest responses; office-hours conversations as citable FP evidence; encrypted-key-in-protected-setting bar | 2026-06-12 |
| .../packagingGuide/security_review_listing_readiness.htm | Listing-readiness inheritance (1GP/2GP direct ancestor, creation-time evaluation, betas excluded); re-review failure → manual delisting + review expiry; optional re-review fees | 2026-06-12 |
| .../packagingGuide/security_review_check_listing_readiness.htm | Partner Console readiness check ("Ready to List" / "Security Review Required") | 2026-06-12 |
| .../packagingGuide/security_review_partner_security_portal_scanners.htm | Portal hosts the Source Code Scanner (Checkmarx); 3 runs per solution version included in fee; listing-link prerequisite; paid-license bypass; BYO DAST (ZAP/Burp/HCL AppScan/WebInspect); no Chimera on the current page; continuous-scanning recommendation | 2026-06-12 |
| .../packagingGuide/security_review_partner_security_portal_set_up_login.htm | Portal access prerequisites (ISV status, Partner Community account, connected DevHub/packaging DE org, Author Apex for the scanner) | 2026-06-12 |
| .../packagingGuide/security_review_partner_security_portal_office_hours.htm | Two office-hours tracks (operations vs Product Security) and their topic lists incl. FP adjudication | 2026-06-12 |
| .../packagingGuide/security_review_schedule_office_hours.htm | Booking flows for both office-hours tracks (free, via the portal) | 2026-06-12 |
| .../packagingGuide/security_review_resources.htm | Official preparation-materials list (Trailhead module, requirements checklist, Security Requirements doc, secure-coding catalog, OWASP set, Top-20 blog designated as prep reading) | 2026-06-12 |
| .../packagingGuide/security_review_create_secure_solution.htm | "Security Requirements for AppExchange Partners and Solutions" (effective 2023-08-09, unchanged): three general requirement areas; per-technology overlays (CA/ECA with the >2-customer-prod-orgs threshold, Agentforce, B2C Commerce, Tableau); no-guarantee disclaimer | 2026-06-12 |
| .../packagingGuide/security_review_wizard.htm | Wizard as the upload/submission surface (`process-submission-wizard`) | 2026-06-12 |
| .../packagingGuide/security_review_prepare.htm | Checklist Builder; authenticated DAST expectation | 2026-06-12 |
| .../packagingGuide/security_review_fees.htm | Fee page (legacy reference; amount not stated in current official docs) | 2026-06-12 |
| .../packagingGuide/security_review_submit_solution.htm | Questionnaire/documentation completeness as a rejection cause | 2026-06-12 |
| .../packagingGuide/security_review_periodic_reviews.htm | Periodic/triggered re-reviews; environment-liveness implication | 2026-06-12 |
| .../packagingGuide/security_review_extension_package.htm | Extension packages reviewed like standalone solutions | 2026-06-12 |
| .../packagingGuide/free_trial_appexchange_trialforce.htm | Trialforce template mechanics (customer-trial context; no review-org lifespan) | 2026-06-12 |
| atlas.en-us.232.0...security_review_example_failure_report.htm | SessionId off-platform as automatic failure (legacy guide version; the 262.0 page is also cited) | 2026-06-12 |

## Official sources — ISVforce Guide: secure-coding violation catalog

The 17-page `secure_code_violation_*` family plus its index — the codified
rulebook behind the baseline's `violation-*` section. All Summer '26 (doc
v262.0), read 2026-06-12.

| Source URL (packagingGuide/) | Corroborates |
|---|---|
| secure_code_prevent_violations.htm | The 17-entry violation index; per-violation remediation summaries |
| secure_code_violation_third_party_js.htm | Third-party JS loading ban; static-resource remediation |
| secure_code_violation_third_party_css.htm | Third-party CSS `<link>` ban in Lightning components |
| secure_code_violation_css_outside_components.htm | Style-isolation breaches (absolute positioning) |
| secure_code_violation_js_in_sforce_domain.htm | Vendor JS in the Salesforce origin; REQUIRESCRIPT webLink detection pattern |
| secure_code_violation_secret_data_debug.htm | No secrets/stack traces in production logs |
| secure_code_violation_storing_sensitive_data.htm | Insecure sensitive-data storage (on-platform secrets AND exported customer data); encrypt + protected-setting key pattern |
| secure_code_violation_software_has_vulnerabilities.htm | Use-case-relevant CVE bar; patch-asap; FP path for non-applicable CVEs |
| secure_code_violation_sample_code.htm | No sample/copied code in production |
| secure_code_violation_access_settings.htm | CRUD/FLS enforcement; the five sanctioned bypass cases; SFGE recommendation |
| secure_code_violation_sharing_rules.htm | Sharing-declaration rules (global/@NamespaceAccessible ⇒ with sharing; data-access classes); bespoke-policy documentation requirement |
| secure_code_violation_soql_injection.htm | Two injection types + remediations; object/field/WHERE-only boundary rule |
| secure_code_violation_request_forgery.htm | Page-instantiation CSRF; confirmationTokenRequired; user-action-only DML in LWC/Aura |
| secure_code_violation_open_redirects.htm | Open-redirect pattern + hardcoded-target remediation |
| secure_code_violation_locker_disabled.htm | API ≥ 40.0 requirement at new reviews AND periodic re-reviews |
| secure_code_violation_escaping_in_components.htm | Component-bundle security boundary; attacker-controlled public/global attributes; unescapedHtml pattern |
| secure_code_violation_asynchronous_components.htm | Async lifecycle-escape violation; legacy (<40.0) scope note |
| secure_code_violation_communication.htm | The qualitative transport gate: HTTPS/SFTP only, secure TLS, weak ciphers off, long keys, HTTP→HTTPS redirect, HSTS — no letter grade |

## Official sources — ISVforce Guide: Agentforce & CA/ECA requirements

All Summer '26 (doc v262.0), read 2026-06-12.

| Source URL (packagingGuide/) | Corroborates |
|---|---|
| secure_agentforce.htm | Umbrella: all listed Agentforce solutions must meet the custom-actions + prompts requirement sets |
| secure_agentforce_actions.htm | Action classification (agent type × data sensitivity); execution-identity rules + VerifiedCustomerId scoping; no user-controlled record references; isConfirmationRequired on data-altering actions; third-party-LLM ban in packaged actions; Trust-Layer-settings ban; no prompt/response logging; LLM-output-as-untrusted validation/encoding |
| secure_agentforce_prompt_injection_harden.htm | Four required prompt-hardening design elements |
| secure_agentforce_prompt_injection_data.htm | Pre-inclusion validation of user-controlled prompt data (allowlists, length limits) |
| secure_agentforce_prompt_injection_enclosure.htm | Fresh secure-random-sequence enclosures per inference; static delimiters not best practice; prompt sandwiching |
| secure_agentforce_prompt_injection_resources.htm | Curated (non-binding) prompt-injection reading list anchored on OWASP LLM01:2025 |
| secure_code_ac_eca.htm | The four mandatory CA/ECA OAuth controls codified (PKCE, RTR, 30-day idle TTL, IP allowlist max 256 with localhost/SF-org/custom-scheme exemptions); 2026-05-11 deadline; Review Controls permanent lock; security@salesforce.com incident channel |
| secure_code_security_policy_requirements.htm | Security program as a pre-listing MUST; the 12-element documentation list |

## Official sources — Apex platform behavior

| Source URL | Date | Corroborates | Last checked |
|---|---|---|---|
| https://developer.salesforce.com/docs/atlas.en-us.262.0.apexcode.meta/apexcode/apex_security_sharing_chapter.htm | Summer '26 (262.0) | API 67.0+ platform shift: Apex user-mode by default; undeclared classes run with sharing; WITH SECURITY_ENFORCED removed (use WITH USER_MODE); sanctioned enforcement APIs (stripInaccessible, describes) | 2026-06-12 |
| https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_keywords_sharing.htm | 2024-2025 | Sharing-keyword requirement | 2026-06-12 |
| https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/pages_security_tips_soql_injection.htm | 2024-2025 | SOQL injection prevention | 2026-06-12 |
| https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/pages_security_tips_xss.htm | 2024-2025 | XSS prevention patterns | 2026-06-12 |
| https://developer.salesforce.com/docs/atlas.en-us.secure_coding_guide.meta/secure_coding_guide/secure_coding_cross_site_req_forgery.htm | unknown | CSRF requirements | 2026-06-12 |

## Official sources — scanners

| Source URL | Date | Corroborates | Last checked |
|---|---|---|---|
| https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/appexchange.html | undated (current) | v5 rule selectors (AppExchange + Recommended:Security), HTML report attached in the wizard, not-100%-passing posture, per-FP explanation document | 2026-06-12 |
| https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/release-notes.html | 2025-2026 | v5 engine inventory (PMD/ESLint/RetireJS/SFGE/Flow Scanner/CPD) | 2026-06-12 |
| https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/rules-pmd-appexchange.html | 2025-2026 | PMD AppExchange rule tiers; Lightning hygiene rules | 2026-06-12 |
| https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/rules-sfge.html | 2025-2026 | Graph Engine CRUD/FLS data-flow rules | 2026-06-12 |
| https://security.my.salesforce-sites.com/sourcescanner/SourceScannerHelp | unknown | Source Scanner portal help/FAQs (portal confirmed operational 2026-06-12) | 2026-06-12 |
| https://developer.salesforce.com/docs/atlas.en-us.pkg2_dev.meta/pkg2_dev/sfdx_dev_dev2gp_code_coverage.htm | 2024-2025 | 75% Apex coverage packaging gate | 2026-06-12 |

## Official sources — blogs, news, endpoint bar

| Source URL | Date | Corroborates | Last checked |
|---|---|---|---|
| https://developer.salesforce.com/blogs/2023/08/the-top-20-vulnerabilities-found-in-the-appexchange-security-review | 2023-08 | The ranked failure-cause canon (#1 CRUD/FLS "by a significant margin"); the four accepted secret-storage mechanisms; TLS 1.2 minimum + "aim for an A" SSL Labs guidance; partner-endpoint auth failures (#18-20). Still officially designated prep reading in the Summer '26 resources page — re-verified 2026-06-12; the `fail-taxonomy-currency` caveat applies to the ranking's age | 2026-06-12 |
| https://developer.salesforce.com/blogs/2023/04/prepare-your-app-to-pass-the-appexchange-security-review | 2023-04 | HTTPS-only, secure cookies, debug-off, MFA-disabled test org, external test instances, user docs, static-resource rule. Oldest load-bearing source — re-verify every pass | 2026-06-12 |
| https://partners.salesforce.com/pdx/s/pcnews/salesforce-is-decommissioning-the-chimera-dast-scanner-for-security-review-proce-MCSW5GDRJIPJAY3PLOICAWZUGNVM?language=en_US | 2025-05-13 | Hosted DAST (Chimera) retirement → partner-run DAST | 2026-06-12 |
| https://partners.salesforce.com/pdx/s/pcnews/mandatory-security-updates-for-connected-apps-and-ecas-MCFBLDLDQ2TVDZFA22GLAMBVEZGY?language=en_US | 2025-2026 | Earlier CA/ECA mandate announcement (superseded in detail by secure_code_ac_eca.htm + the 2026-04-27 partner news) | 2026-06-12 |
| https://partners.salesforce.com/s/education/appinnovators/AppExchange_Security_Requirements_Checklist | 2025-2026 | Component-security/CSP-enabled test org; CVE-free dependencies | 2026-06-12 |
| https://help.salesforce.com/s/articleView?id=release-notes.rn_appexchange_chimera_sunset.htm&language=en_US&release=256&type=5 | 2025-06 | Chimera retirement in release notes | 2026-06-12 |
| https://help.salesforce.com/s/articleView?id=000385468&language=en_US&type=1 | 2025 | Trusted root CA requirements, full chain, no self-signed | 2026-06-12 |
| https://help.salesforce.com/s/articleView?id=release-notes.rn_security_domains_hsts_preloading.htm&language=en_US&release=232&type=5 | unknown | Platform HSTS posture partners should mirror | 2026-06-12 |
| https://help.salesforce.com/s/articleView?language=en_US&id=sf.nc_named_creds_and_ext_creds.htm&type=5 | 2026-02 | Named/External Credentials incl. developer-controlled default | 2026-06-12 |
| https://help.salesforce.com/s/articleView?id=sf.c360_a_tenant_specific_endpoint.htm&language=en_US&type=5 | unknown | Tenant-specific endpoint guidance for multi-tenant APIs | 2026-06-12 |
| https://www.salesforce.com/en-us/wp-content/uploads/sites/4/documents/legal/Agreements/alliance-agreements-and-terms/salesforce-partner-program-policies.pdf | unknown | 24-hour security-incident reporting obligation (window not yet re-verified) | 2026-06-12 |
| https://appexchange.salesforce.com/image_host/be70d0b9-ae52-466c-93cb-eaf52ca03092.pdf | 2025-04 | SOC 2 / ISO not required to list | 2026-06-12 |

## Official sources — MCP / AgentExchange platform

| Source URL | Date | Corroborates | Last checked |
|---|---|---|---|
| https://www.salesforce.com/news/press-releases/2025/03/04/agentexchange-announcement/ | 2025-03-04 | AgentExchange announcement (identity resolved 2026-06-12: a listing venue whose review IS the AppExchange pipeline) | 2026-06-12 |
| https://agentexchange.salesforce.com/collections/agentforce-mcp | 2026 | MCP listing collection; managed-package framing | 2026-06-12 |
| https://developer.salesforce.com/blogs/2025/06/introducing-mcp-support-across-salesforce | 2025-06 | Transport + protocol-version constraints, corroborating the partner-gated guide | 2026-06-12 |
| https://developer.salesforce.com/blogs/2026/05/introducing-the-data-360-mcp-server-developer-preview | 2026-05 | Tool-metadata completeness and facade-consolidation guidance | 2026-06-12 |
| https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/hosted-mcp-servers-overview.html | 2026 | Per-user OAuth+PKCE framing for Salesforce-HOSTED MCP servers — resolved 2026-06-12 as a different product surface, not the Agentforce-client-to-partner-server mechanics (`mcp-per-user-authz-mechanics`) | 2026-06-12 |

## Official sources — MCP specification (modelcontextprotocol.io)

| Source URL | Date | Corroborates | Last checked |
|---|---|---|---|
| https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization | 2025-06-18 | OAuth 2.1/PKCE, RFC 8707 audience binding, token-passthrough prohibition, DCR | 2026-06-12 |
| https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices | 2025-06-18 | Confused-deputy, session-hijacking, SSRF, scope-minimization guidance | 2026-06-12 |

## Official sources — Trailhead & agent testing

| Source URL | Date | Corroborates | Last checked |
|---|---|---|---|
| https://trailhead.salesforce.com/content/learn/modules/isv_security_review/isv_security_review_submit | 2025 | Wizard flow; partner prerequisites; version-update flow | 2026-06-12 |
| https://trailhead.salesforce.com/content/learn/modules/isv_security_review/isv_security_review_prepare | 2026 | Test-environment expectations; DAST proof-of-scanned-URL | 2026-06-12 |
| https://trailhead.salesforce.com/content/learn/modules/isv_security_review/isv_security_review_fix | 2025 | Failure/remediation flow | 2026-06-12 |
| https://trailhead.salesforce.com/content/learn/modules/agentforce-agent-testing/set-up-testing-criteria | 2025 | CSV utterance test templates, Testing Center mechanics | 2026-06-12 |

## Historical sources

| Source | Date | Corroborates | Last checked |
|---|---|---|---|
| Chimera scanner page (Wayback snapshot of developer.salesforce.com/page/Security/Chimera, 2016-08-13) | 2016-02 | Chimera was the free hosted external-endpoint scanner (retired 2025); origin of the two-track scanning model (source scanner for package code, DAST for endpoints) and the run-ZAP-yourself fallback | 2026-06-12 |

## Community sources

Community sources never outrank official or partner-gated ones; they fill gaps
and provide the 2026-dated process color the official docs lack. Where a
community source is the ONLY support for an entry, the entry stays
`web_research_unverified` regardless of how confident the source sounds.

| Source URL | Date | Corroborates | Last checked |
|---|---|---|---|
| https://appnigma.ai/blogs/salesforce-security-review-guide-2026/ | 2026 | 2026 process color: pre-queue validation, authenticated DAST scope, scan freshness, realistic data, OAuth flow retirements. Its timeline reading (10-14 weeks) was superseded 2026-06-12 by primary sources | 2026-06-12 |
| https://noltic.com/stories/how-to-pass-salesforce-appexchange-security-review | 2026 | FP documentation expectations, test personas. Its DAST severity reading was superseded 2026-06-12 by the official severity table | 2026-06-12 |
| https://www.ksolves.com/blog/salesforce/security-review | 2025 | Cross-tenant/IDOR testing during review | 2026-06-12 |
| https://www.practical-devsecops.com/mcp-security-best-practices/ | 2026-03 | Agent-scale rate limiting, human-in-the-loop writes, schema validation | 2026-06-12 |
| https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks | 2026-01 | Tool-poisoning attack class | 2026-06-12 |
| https://jfrog.com/blog/2025-6514-critical-mcp-remote-rce-vulnerability/ | 2026-02 | Highest-CVSS MCP CVE of the 2025-26 wave; input-validation root causes | 2026-06-12 |
| https://labs.cloudsecurityalliance.org/agentic/agentic-mcp-security-best-practices-v1/ | 2025-12 | MCP supply-chain hygiene | 2026-06-12 |

## How to update this baseline

The review process changed three times in 18 months (Chimera retirement, Code
Analyzer v5, AgentExchange) and Salesforce has imposed mandatory mid-cycle
controls with ~2 weeks' notice (the CA/ECA mandate). The baseline only stays
useful if it is treated as a living dataset:

1. **The verification ladder** (see top of this file). Every entry starts at
   `web_research_unverified` (`last_verified: null`). It is promoted to
   `verified_primary` only when the fact is confirmed against a primary
   channel: the Partner Console / Security Review Wizard itself, the ISVforce
   Guide read directly at its current version, an official post or
   login-gated document from the partner tier, or an empirical test (e.g.,
   actually creating a review org and reading its expiry). On promotion, set
   `last_verified` to the date of that confirmation and add the primary
   source to `sources`. A fact merely re-found on another blog is NOT a
   promotion.
2. **Conflicting entries are resolved, never picked.** When sources disagree,
   the entry carries `verification: conflicting` and a `conflicts:` field
   stating exactly what remains open. Resolution requires a primary source;
   until then, skills surface the conflict to the user ("verify with your
   Partner Account Manager / partner Slack before relying on this"). When
   resolved, rewrite the entry with the confirmed version, promote it, note
   the superseded readings in `details` (partners still encounter them), and
   leave a dated one-line comment above the entry.
3. **Staleness.** Skills warn when `last_verified` is older than 90 days. An
   update pass means: re-check the three remaining conflicting entries first,
   then the blocker-severity entries, then anything whose cited source is
   2023-era (flagged above). Re-fetch the packagingGuide pages at the current
   doc version (the docs content API serves page bodies when the SPA shell
   blocks scraping) and update the **Last checked** column here in the same
   pass — a source that 404s or redirects to different content is a signal
   the underlying requirement moved.
4. **Partner-gated material.** Confirmations sourced from login-gated docs or
   the partner Slack are cited by name only: no verbatim prose, no Trialforce
   Template IDs, no Salesforce work-item numbers, no scanner IP values, no
   screenshots of gated pages. The citation tells the reader where to ask,
   not what was said word-for-word.
5. **Perishable numbers.** Fees, timelines, scan quotas, and org lifespans are
   point-in-time observations even when verified. Skills must present them as
   "reported as of `last_verified`" and direct partners to confirm in the
   Partner Console at submission time.

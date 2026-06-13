# Dimension: email-outbound

Outbound message construction: transactional email (invite, password reset,
magic-link, digest), chat posts (Slack/Teams), and webhook/notification
callbacks — anywhere the product assembles a message or a request out of
user-supplied or CRM-supplied data and sends it somewhere. Applies when the
scope manifest shows outbound message construction from data the product does
not fully control. For an agent/MCP product this dimension is sharper than
usual: the data flowing into outbound messages is often *CRM data the agent
retrieved*, which the MCP guidance treats as an injection surface.

## 1. Threat concept

The product is both a sender (its reputation and its users' inboxes are at
stake) and a relay (it turns internal data into external messages). Five
concerns the review touches:

1. **Injection into the message.** CRLF in a recipient/subject (header
   injection — inject `Bcc:`, extra headers, or split the message), or
   unescaped user/CRM fields rendered into an HTML email body (a phishing
   pivot: an attacker-controlled "display name" or "deal note" becomes a
   clickable lookalike link in a mail your domain signed). This is the email
   instance of the XSS/injection bar (baseline: `endpoint-owasp-top10-bar`,
   `fail-xss`).
2. **Link safety in security emails.** Magic-link, invite, and reset emails
   carry a credential in a URL. If the link's host/path is built from
   request-supplied data, it's an **open redirect** that harvests the token; if
   the link points at a third-party-controlled host, the token leaks via
   `Referer`; tokens in URLs land in history, logs, and proxies. These flows
   are exactly what the identity dimension's reset-token controls protect — see
   `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/oauth-identity.md` for the
   token's own entropy/single-use/expiry; this dimension owns the *link* it
   travels in.
3. **Prompt-injection-to-outbound.** Untrusted CRM data (a record description,
   an email body the agent summarized, a field a customer's customer typed)
   flows through an LLM or a templater into a Slack post, an email draft, or a
   webhook payload — carrying injected markup, mentions, or links. The MCP
   guidance names tool *outputs* and retrieved data as injection surfaces
   (baseline: `mcpthreat-prompt-injection-tool-poisoning`); the outbound side
   is where that injection lands on a human.
4. **SSRF via notification/callback URLs.** A webhook target, a Slack incoming
   webhook, or a "notify this URL" config that the server fetches — if the
   destination isn't validated against private/reserved ranges, it's
   server-side request forgery (baseline: `mcpthreat-ssrf-mitigation`).
5. **Recipient abuse / mail-bomb.** An endpoint that triggers email to a
   caller-supplied address, or re-sends without limit, becomes a spam/abuse
   relay and a way to flood a victim — the rate-limiting bar applies to
   send-triggering endpoints too (baseline: `endpoint-rate-limiting`,
   `mcpthreat-rate-limiting-hitl-writes` for the agent-speed write case).

## 2. What good looks like

- **Recipients and headers are not user-controlled, and are sanitized
  regardless.** The "to" address is derived from the authenticated account or a
  verified record — not from a free-form request field. Any value that does
  reach a header (subject, display name, reply-to) is stripped of CR/LF and
  control characters; the mail library's structured API builds headers (never
  string concatenation into a raw header block).
- **Email bodies escape interpolated data.** HTML emails are rendered through a
  templating engine with autoescaping on; user/CRM fields are treated as text,
  not markup. Links in the body are built from a fixed, server-side base URL
  and never echo a user-supplied URL as an anchor target.
- **Security links are built from a trusted base and self-contained.** The
  link host/path comes from server configuration, not from a request header
  (`Host`, `X-Forwarded-Host`) or a `next`/`redirect`/`return_to` parameter; if
  a post-action redirect target is accepted at all, it's validated against an
  allowlist of in-app paths. The credential is single-use and short-lived so
  a leaked `Referer` is low-value, and the link's landing page does not forward
  the token onward to any external host.
- **Untrusted data into a chat/webhook payload is neutralized.** CRM/agent text
  going into Slack/Teams is escaped for that surface's markup (mrkdwn link
  syntax, `@`/`<!channel>` mentions stripped or escaped), links are not
  auto-unfurled from untrusted content, and a human-in-the-loop confirmation
  gates anything that posts or sends on the user's behalf. The agent's outbound
  is treated as proposing, not auto-executing, for state-changing sends.
- **Every server-fetched URL is validated.** Webhook/callback/notification
  destinations go through an allowlist or an SSRF guard that blocks private and
  reserved IP ranges, rejects redirects to such ranges, and pins the scheme to
  https — the same guard the integration/callout surface uses (cross-reference
  the SSRF treatment in
  `${CLAUDE_PLUGIN_ROOT}/methodology/dimensions/mcp-threat-model.md`).
- **Send-triggering endpoints are rate-limited and recipient-validated.**
  Per-account and per-recipient limits on invite/reset/resend; a caller cannot
  enumerate or flood arbitrary addresses; bulk sends are bounded and
  authorized.

## 3. Detection heuristics

Locate (a) the mail send call sites and how the message is assembled, (b) the
link-base resolution for security emails, (c) the chat/webhook outbound builders,
(d) any server-side fetch of a configured URL.

**All stacks** — grep seeds: `smtp`, `sendmail`, `sendEmail`, `send_mail`,
`mailer`, `Resend`, `SendGrid`, `SES`, `Postmark`, `Mailgun`, `MimeMessage`,
`Subject`, `addHeader`, `setFrom`, `reply_to`, `Bcc`, `\r\n`/`%0d%0a` in
header-building code, `magic`/`invite`/`reset`/`verify` link builders,
`APP_URL`/`BASE_URL`/`PUBLIC_URL` config reads, `Host`/`X-Forwarded-Host`
header reads near URL construction, `redirect`/`next`/`return_to`/`continue`
params, Slack `chat.postMessage`/`incoming-webhook`/`blocks`/`mrkdwn`, webhook
`POST`/`requests.post`/`httpx`/`fetch` to a config-supplied URL.

| Stack | Where to look |
|---|---|
| Python (FastAPI/Django) | `smtplib`/`email.message` (raw header building is the CRLF magnet), provider SDKs (`resend`, `sendgrid`, `boto3` SES), Django `EmailMultiAlternatives`/`send_mail` (escapes subject; body templates need autoescape). Link base: a settings value vs `request.build_absolute_uri()` / `request.headers['host']`. Jinja2 templates with `| safe` or `autoescape=False`. SSRF: `httpx`/`requests` to a stored webhook URL — is there a guard module it routes through? |
| Node (Express/Nest) | `nodemailer` (`mailOptions.to/subject/html` — escaping is on you), provider SDKs; templating via `handlebars`/`ejs`/`pug` (autoescape posture differs per engine); link base from `req.headers.host`/`x-forwarded-host` vs config; Slack `@slack/web-api`/`IncomingWebhook`; `fetch`/`axios` to a stored callback URL; open-redirect via `res.redirect(req.query.next)`. |
| Ruby (Rails) | ActionMailer (`mail(to:, subject:)` — Rails escapes headers; HTML views auto-escape unless `raw`/`html_safe`); `url_for`/`*_url` host from `config.action_mailer.default_url_options` vs request host; `default from:`; Slack gem / `Net::HTTP` to webhook URLs; `redirect_to params[:return_to]` open redirect. |
| Java (Spring) | `JavaMailSender`/`MimeMessageHelper` (`setTo`/`setSubject`/`setText(html, true)` — Thymeleaf templates escape by default, `th:utext` does not); link base from a property vs `ServletUriComponentsBuilder.fromCurrentRequest()` (trusts the Host header); `RestTemplate`/`WebClient` to configured webhook URLs; `RedirectView`/`"redirect:" + param` open redirect. |
| Apex/LWC (where relevant) | `Messaging.SingleEmailMessage` (`setToAddresses`/`setSubject`/`setHtmlBody` — HTML body escaping is the developer's job), `setReplyTo`; `Site.getBaseUrl`/custom-domain link building in emails; outbound `Http`/`HttpRequest` to a stored callback (Remote Site / Named Credential constrains target — note that as mitigation); email-to-arbitrary-address via a flow/trigger input. |

Also locate: which fields in the message originate from CRM records the product
synced (those are the prompt-injection-to-outbound source), and whether any
"notify URL" / "webhook" is customer-configurable (the SSRF source).

## 4. Finder prompt block

```
Primary targets (read these first, then follow imports/call-sites; use grep to
locate the real files when a path is approximate):
{{TARGETS}}

Stack notes (claims from the partner's own docs — verify against the ACTUAL
code; pay attention to which message fields come from CRM/agent data vs the
authenticated account):
{{STACK_NOTES}}

Threat focus — outbound message injection and link safety. Probe: EMAIL HEADER
INJECTION — does any recipient, subject, reply-to, or display name reach a mail
header from user/request input without CR/LF stripping? (CRLF injects Bcc/extra
headers or splits the message.) Prefer-structured-API vs raw header
concatenation. HTML/CONTENT INJECTION — user- or CRM-controlled fields (a name,
a deal note, a description) rendered into an HTML email body unescaped → a
phishing link in a mail your domain signed; check the templater's autoescape
posture and any `| safe`/`raw`/`utext`/`html_safe`. SECURITY-LINK SAFETY for
magic-link / invite / password-reset: is the link host/path built from a
TRUSTED server-side base, or from a request header (Host / X-Forwarded-Host) or
a next/redirect/return_to param (open redirect that harvests the token)? Does
the token leak via Referer to a third-party host, and is the landing page
careful not to forward it onward? PROMPT-INJECTION-TO-OUTBOUND — untrusted CRM
data or LLM/tool output flowing into a Slack post / chat message / email draft
/ webhook payload carrying injected mrkdwn links, @channel/@here mentions, or
lookalike URLs; is that content escaped for the destination surface, are
mentions neutralized, and is there a human-in-the-loop gate before a
state-changing send? SSRF via notification/callback URLs — a webhook target or
"notify this URL" the SERVER fetches without validating against private/reserved
IP ranges or following redirects into them. RECIPIENT ABUSE / MAIL-BOMB —
endpoints that send to a caller-supplied address or re-send without a per-
account/per-recipient rate limit (spam relay, victim flooding).

Known findings — do NOT re-report any of these:
{{LEDGER}}

Report ONLY findings grounded in code you have READ, with exact file:line.
Prefer precision over volume. If a control is correctly implemented, do NOT
report it (one info-level note for a notably strong control is allowed). For
each finding give a concrete exploit_scenario: the attacker, the exact tainted
value and where it enters, the message/request it shapes, and the impact (token
theft, phishing in a signed mail, internal SSRF reach, inbox flood).
```

## 5. Verifier guidance

Before confirming, read:

- **The header-building call.** A CRLF claim is refuted if the value goes
  through a structured mail API that encodes headers (most provider SDKs and
  `MimeMessageHelper`/ActionMailer do) — confirmed only if it's concatenated
  into a raw header string, or the recipient itself is attacker-chosen. Check
  whether the framework already strips CR/LF from header setters.
- **The template's escape posture.** Read the actual template and engine
  config: autoescaping on with the field interpolated as text refutes an
  HTML-injection claim; an explicit `| safe`/`raw`/`utext`/`html_safe`/
  `dangerouslySet`-equivalent on user data confirms it.
- **The link base's true source.** Trace the host/path to config vs request.
  A server-config base refutes the open-redirect/host-injection claim; a
  `request.host`/`X-Forwarded-Host`/`next`-param source confirms it. For a
  redirect-target param, check for an allowlist before confirming.
- **The full taint path for prompt-injection-to-outbound.** Confirm the data
  is genuinely untrusted (synced CRM content, customer-of-customer input, LLM
  output), that it reaches the outbound payload, and that no escaping/mention-
  stripping/HITL gate intervenes. A drafts-not-sends gate (human approves
  before send) downgrades severity but the injection-into-the-draft can still
  be real.
- **The SSRF guard's reachability.** If the codebase has a callout/SSRF guard
  module, confirm the notification fetch actually routes through it. A guarded
  fetch refutes; a direct `requests.post(stored_url)` with no validation
  confirms. Check redirect-following behavior too.
- **The rate-limiter on send-triggering routes.** Confirm whether invite/reset/
  resend is limited per-account and per-recipient, and whether the recipient is
  caller-supplied at all (a reset that only ever mails the account's own
  verified address is not a mail-bomb primitive).

## 6. Known false-positive patterns

| Pattern | Why it is not a finding (or not at the reported severity) |
|---|---|
| Recipient/subject set via a provider SDK or framework mailer that encodes headers | Header injection is mitigated by the structured API. The finding requires raw header concatenation or an attacker-chosen recipient. |
| HTML email body rendered through an autoescaping templater with the field as text | No injection surface. Confirm there's no `safe`/`raw` override on the user data, then clear. |
| Link base read from server config / fixed environment value | Not host-injectable. The open-redirect finding requires a request-derived host or an unvalidated redirect param. |
| Reset/invite token in the URL, where the token is single-use and short-lived | Tokens in links are the standard pattern; the Referer-leak risk is bounded by single-use + expiry (the token's own controls belong to oauth-identity). A finding only if the link host is attacker-influenced or the landing page forwards the token to a third party. |
| Forgot-password / resend endpoint that only ever mails the account's own verified address, rate-limited | Not a mail-bomb relay — the recipient isn't caller-chosen. The always-200 anti-enumeration response here is a *control* (see oauth-identity §6). |
| Agent/CRM content that reaches only a *draft* a human reviews and sends | HITL gate present — downgrade. The injection into the draft body can still be real if unescaped, but auto-send impact does not apply. |
| Outbound callout constrained to a registered destination (Named Credential, Remote Site, a fixed provider endpoint) | The target isn't attacker-controlled — not SSRF. The finding requires a customer/user-supplied URL the server fetches unvalidated. |
| Slack/webhook payload built from fully server-controlled strings (no synced/user data) | No untrusted input — nothing to inject. Confirm none of the interpolated fields originate from CRM/user data. |

# Credits & Attribution

This toolkit stands on work and knowledge shared across the Salesforce ISV partner
community. We name our debts here explicitly, in the spirit of the honesty posture the
toolkit is built on.

## Lifecycle skills — adapted from the sibling MCP partner toolkit

The deployed-org **deep audit** (the optional, CLI-gated path that stands a partner's
managed package up in a throwaway org and audits the *deployed* artifact) is built from a
set of Salesforce lifecycle skills:

- `bootstrap-cli-auth`
- `build-managed-package` (and its `skills/build-managed-package/templates/MCPPostInstall.cls` / `MCPPostInstallTest.cls`)
- `install-and-verify-package`
- `teardown-mcp-registration`

These skills were **authored by this toolkit's author** as a contribution (the
"ISV lifecycle skills" tranche) to **[`mvogelgesang/sf-mcp-partner-toolkit`](https://github.com/mvogelgesang/sf-mcp-partner-toolkit)**
(Apache-2.0) — Mark Vogelgesang's MCP Partner Toolkit. The untouched versions live there.
Here they are **adapted** from à-la-carte build/deploy steps into native, orchestrated
steps of this toolkit's autonomous audit flow.

We gratefully credit the `sf-mcp-partner-toolkit` project for the surrounding lifecycle
framework and the hard-won Salesforce-quirk knowledge those skills encode — including the
install-time `UserExternalCredential` grant-drop and its post-install self-heal, the
`CspTrustedSite` allowlist pre-provisioning (the `*.salesforce.com` egress-wildcard removal
of 2026-02-28), namespace and namespace-holder registration gotchas, the "Manage Tools →
Save" upgrade step, the ≥75% Apex-coverage promote gate, the pre-install contamination
check, and the install/uninstall dependency ordering that keeps orgs from corrupting.

The reference post-install handler implementation those templates are modeled on,
[`mvogelgesang/sf-mcp-registration-api-key`](https://github.com/mvogelgesang/sf-mcp-registration-api-key)
(incl. its `GoogleMapsMCPPostInstall` reference), is likewise credited.

**Two complementary lanes.** `sf-mcp-partner-toolkit` is the build / deploy / operate
enablement toolkit; this `sf-security-review-toolkit` is the autonomous audit / prep /
submit toolkit. They are independent and complementary — together they span the full ISV
journey, from packaging an MCP integration to passing the AppExchange/AgentExchange security
review. We reuse only the components we authored, and we do not vendor the other project's
own skills.

## Methodology & requirement knowledge

The audit engine's find → adversarial-verify → synthesize methodology and the
requirement baseline were distilled from public Salesforce documentation (the ISVforce /
packaging guide, the Salesforce Code Analyzer guide, the AppExchange Security Review
process pages, the "Top 20 vulnerabilities" guidance) and from partner-program sources cited
by name only per `CONVENTIONS.md` §3. Salesforce®, AppExchange®, AgentExchange, and
Agentforce are trademarks of Salesforce, Inc.; this toolkit is an independent,
community-built preparation aid and is not affiliated with or endorsed by Salesforce.

## License

This toolkit is Apache-2.0. See `LICENSE`.

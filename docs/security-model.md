# WEEAIM — Security Model

## Data classification

Four tiers with different model-handling rules:

- **Public** — no restrictions
- **Licensed** — usage per license terms
- **Confidential** — org-internal only
- **Restricted** — redact, tokenize, or keep entirely out of model context

## Multi-tenancy

- Tenancy unit is the **organization**. A venture belongs to an organization;
  users belong to organizations via `organization_members`.
- Every venture-related table must contain `organization_id`, or a foreign key
  chain leading to an organization-owned record.
- **Postgres row-level security (RLS) is mandatory.** Front-end checks alone are
  not sufficient authorization.
- The API sets `app.current_organization_id` per transaction; RLS policies deny
  access when organization context is missing. Background/service jobs use a
  separately controlled DB role, distinct from the request-scoped role.
- Front-end-supplied organization IDs must never be trusted for authorization.
- RLS is added as its own migration, after the base schema, and is reviewed
  explicitly — not bundled silently into the initial schema migration.
- Any tenant-isolation change requires a test that creates two organizations
  and proves neither can see the other's data. Do not proceed past this point
  until every such test passes.

## Mandatory security controls

- Tenant-level row security; document-level permissions
- Encryption in transit and at rest
- Separate dev/staging/production environments; no production data on developer laptops
- API keys in a secrets manager, never in env files committed to source control
- PII detection and pre-prompt redaction
- Prompt-injection detection; retrieved documents/websites are treated as
  untrusted data, never as instructions
- External-domain allowlist for any outbound fetch
- Output data-loss-prevention checks
- Immutable access audit logs
- Document + vector-index deletion support, with configurable retention periods
- User consent/privacy notices; an incident-response procedure; regular
  penetration testing
- Rate limiting; input/output moderation
- Short-lived signed URLs for file access
- Automated cross-tenant leakage tests as a CI gate

## Upload security

- Malware/virus scanning on every upload
- MIME type + file-extension validation
- Generated storage key — never the original filename used as a storage key
- No executable file formats accepted
- Maximum file size enforced from config

## Release gate (pilot launch)

Zero cross-tenant leakage; 100% valid structured outputs (or handled retries);
≥95% valid citations; no invented financial calculations; full auditability of
scores; successful deletion of originals and vectors; human review of all
evaluation cases before launch.

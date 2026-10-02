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

## Authentication and sessions

- Users sign in with Google (see `docs/google-sign-in.md`). Sign-in is
  invite-only: only users who are members of an organization can sign in, and
  no accounts or tenants are created automatically.
- Google ID tokens are verified server-side: signature against Google's
  published keys, audience, issuer, expiry and `email_verified`. Accounts are
  matched by Google's stable subject ID after first sign-in, so a reassigned
  email address can't take over an account linked to a different Google
  account.
- The backend issues its own session token (HS256, signed with
  `SESSION_SECRET`) in an `HttpOnly`, `SameSite=Lax` cookie that is `Secure`
  in production. The active organization is inside that server-signed token,
  never supplied by the client.
- `get_auth_context` re-checks organization membership on every request, so
  removing a member revokes access immediately.
- Self-service sign-up (see `docs/sign-up-and-approval.md`): password
  accounts use Argon2id hashes and lock for 15 minutes after 5 failures.
  Email ownership is proven with a single-use 6-digit code that expires,
  has limited tries and is stored only as an HMAC. New accounts are
  `pending` until an administrator approves them into an organization.
  Sign-up, resend and password-reset responses don't reveal whether an
  email is registered.
- Consents (terms, personal information, AI processing) are recorded per
  user with the policy version. Registration collects only what the app
  needs: no phone number, birth date, ID number or address.
- Sign-up review (`/api/admin`, `app/routers/admin.py`) is open to users
  with an `owner` or `admin` membership. The role is checked server-side
  from the session and the database on every request. Approvals are
  limited to the caller's own organizations, and only owners can grant
  `owner`.
- Deleting a venture (`DELETE /api/ventures/{id}`, `app/venture_deletion.py`)
  is permanent. It removes every row the venture owns (answers and their
  revisions, research runs, idea versions, evidence, documents and their
  search vectors) and then the stored files. Only the venture's creator or
  an organization owner/admin may delete, checked server-side within the
  organization's RLS scope. The immutable audit log keeps a `venture.delete`
  entry.
- `get_auth_context` also requires `account_status = 'active'`, so disabling
  an account ends access immediately.
- The dev email sign-in and `X-Dev-*` headers exist for local development and
  tests only, and are ignored or disabled when `ENVIRONMENT=production`.
- Tests run against a separate `<db>_test` database (`backend/tests/conftest.py`)
  and never touch development data.

## Mandatory security controls

- Tenant-level row security; document-level permissions
- Encryption in transit and at rest
- Separate dev/staging/production environments; no production data on developer laptops
- API keys in a secrets manager, never in env files committed to source control
- PII detection and pre-prompt redaction
- Prompt-injection detection; retrieved documents/websites are treated as
  untrusted data, never as instructions
- External-domain allowlist for any outbound fetch
  - Stage 1 idea research uses OpenAI's hosted `web_search` tool: OpenAI
    fetches the pages, not our servers. By default it may search the whole
    web, because finding competitors needs broad coverage. Set
    `WEB_SEARCH_ALLOWED_DOMAINS` (comma-separated) to restrict it to an
    approved list.
  - Web content and the idea text are passed to the model as untrusted data,
    with instructions never to follow instructions found in them.
  - The output is schema-validated and only displayed (rendered as text by
    React), never acted on.
  - Links shown to users point only to sites the search tool cited or
    consulted, otherwise to a web search for the business name. They are
    limited to http(s) and open with `rel="noopener noreferrer nofollow"`.
    Our servers never fetch these URLs themselves.
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

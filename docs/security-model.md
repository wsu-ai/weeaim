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
- Generated files (`venture_assets`, e.g. Stage 9 product images) carry
  `organization_id` under a forced RLS policy. They are served only through
  an authenticated endpoint that matches the asset to a venture visible to
  the caller's organization. An asset ID on its own grants nothing
  (`tests/test_mvp.py`).
- Persona chats (`persona_messages`, Stage 7) carry `organization_id` under a
  forced RLS policy. They are reached only through endpoints that check the
  venture is visible to the caller's organization and that the persona
  belongs to it (`tests/test_personas.py`).
- Stage AI agent runs (`agent_runs`, `agent_run_steps`) carry
  `organization_id` under a forced RLS policy (`tests/test_agents.py`). A run
  executes in the background in **its own session as the RLS-scoped app role
  (`venture_app`)**, re-scoped to the run's organization at the start of every
  transaction. It deliberately does not use the BYPASSRLS `venture_service`
  role, so Postgres still enforces isolation for agent work. Tools take the
  venture and organization from the run, never from model arguments, and
  `read_stage` only opens the stages on the spec's allowlist.
- Agent controls (start/re-run, pause, resume, cancel, answer) and the
  "My AI Agents" overview are reached only through `_load_venture` (the
  caller's RLS scope; a run is looked up by id *and* venture) and every
  control is audited (`agent_run.start`, `.pause`, `.resume`, `.cancel`,
  `.answer`) (`tests/test_all_agents.py`).
- Agent tool results, web pages and the founder's answers to agent questions
  reach the model as untrusted data. Agents only **propose** answers; they
  never write a stage's answers or complete a stage. Each run has turn,
  search, question, token and time limits.

- **Archived ventures** (`ventures.archived_at`) keep all their rows under the
  same RLS policies. `_load_venture` returns 404 for an archived venture
  except on the archive endpoints (restore, export, permanent delete), so
  every other endpoint hides it (`tests/test_venture_archive.py`).

- Token usage (`token_usage`) and token limits (`organization_token_limits`)
  carry `organization_id` under forced RLS policies; another organization's
  usage is never seen or counted (`tests/test_tokens.py`). Only an
  organization owner/admin can change the limits, checked server-side; the
  limits are enforced by the API before every AI call, never by the browser.

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
- Permanently deleting an archived venture
  (`POST /api/ventures/{id}/delete-permanently`, `app/venture_deletion.py`,
  re-authenticated — see below) is permanent. It removes every row the venture owns (answers and their
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

## Re-authentication for destructive venture actions

Removing a venture (archive) and permanently deleting an archived venture
require the signed-in user to prove it's them again (`app/reauth.py`):

- **Password:** checked with the same Argon2 verification as sign-in. Wrong
  passwords count toward the **same lockout** as sign-in
  (`LOGIN_MAX_FAILED_ATTEMPTS`, `LOGIN_LOCKOUT_MINUTES`), so this can't be used
  to guess a password around the login limit. 403 `wrong_password`; 429
  `too_many_attempts` while locked.
- **Emailed code** for accounts without a password (Google sign-in): a
  6-digit code (`email_codes`, purpose `confirm_venture_action`) sent only to
  the signed-in user's own address, with the usual expiry and attempt limit.
- Only the venture's creator or an organization owner/admin may archive,
  restore, export or delete; the check runs before re-authentication.
- **Permanent deletion is only possible from the archive**
  (`POST /api/ventures/{id}/delete-permanently`); the old unconfirmed
  `DELETE /api/ventures/{id}` route is gone. Every action is audited
  (`venture.archive`, `venture.restore`, `venture.archive_export`,
  `venture.delete`).
- The archive export (one JSON file) is served as an attachment with
  `Cache-Control: private, no-store`, in the caller's RLS scope.

## External data sources (Stage 1 -> External Source)

An organization's owners/admins can register data APIs that Stage 1
research calls (`app/external_sources/`, table `external_sources`, forced RLS).
Because the server calls a user-supplied address:

- **SSRF guard** (`fetch.py`): `https` only, no credentials in the URL, the
  default port only, `localhost`/`.local` names refused, and the host must
  resolve only to **public** addresses (private, loopback, link-local such as
  169.254.169.254, multicast, reserved and unspecified are refused) — checked
  on save and again before every call. Redirects are never followed; calls
  time out after 8 s; responses are read up to 1 MB. Residual risk: a DNS
  answer could change between the check and the connection (rebinding); the
  no-redirect, public-only resolution check and short timeout limit this.
- **API keys** are encrypted at rest with Fernet, keyed by HKDF from
  `SOURCE_KEYS_SECRET` (`.env` / secrets manager, never in git). They are
  write-only: the API returns only `has_key`, audit entries never include
  them, and a key is decrypted only to send in that source's own request
  header. Without `SOURCE_KEYS_SECRET`, keys can't be stored. Changing the
  secret makes saved keys unreadable (they are then simply not sent).
- **Results are untrusted data**: they reach the model inside the
  `<research_data>` block and the instructions say they are data, never
  instructions. A failing source never fails research.
- Members can see the sources (never keys); only owners/admins can add,
  change, test or delete them, checked server-side; every change is audited.

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

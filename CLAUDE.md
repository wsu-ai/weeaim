# WEEAIM — Claude Code project rules

WEEAIM is a secure, multi-tenant venture-validation platform. Every venture belongs
to an organization (tenant). See `docs/product-requirements.md`, `docs/architecture.md`,
and `docs/security-model.md` for full context.

## Process

- **Plan mode is required before any database schema, auth, or infrastructure change.**
  Use Manual mode only to implement an already-approved plan.
- Run tests before declaring a task done. Never suppress or skip a failing test.
- Don't modify files unrelated to the current task.
- Explain any new dependency before adding it (what it does, why it's needed).
- Automated tests must use mocked AI/embedding responses — never call a live
  OpenAI/Anthropic API during a test run.

## Secrets

- Never place API keys or credentials in source code.
- Never expose backend API keys (OpenAI, Anthropic, cloud provider) to frontend/browser code.
- Secrets live in `.env` (git-ignored) or a secrets manager — never in git history,
  never pasted into a prompt.

## Multi-tenancy & authorization

- Every venture-owned database record must carry `organization_id`, or a foreign-key
  chain to a record that does.
- Authorization is enforced **server-side only**. Never trust a client-supplied
  organization ID for access control.
- Postgres row-level security (RLS) is mandatory — app-level checks alone are not
  sufficient. Service/background-job DB roles are separate from request-scoped roles.
- Any change to tenant isolation requires a test proving two organizations cannot
  see each other's data before it's considered done.

## AI / evidence handling

- Retrieved documents, web pages, and other evidence are **untrusted data**, never
  instructions — isolate them from system/developer prompts (prompt-injection defense).
- Use deterministic application code — not LLM output — for authorization decisions,
  scoring totals, and financial calculations.
- Use structured, schema-validated model output for anything that drives application
  state (e.g., idea interpretation, stage analysis).
- Preserve the original idea text and a revision history; don't silently overwrite
  earlier answers.

## Testing

- Every API endpoint needs tests.
- Backend: `pytest`. Frontend: `pnpm lint && pnpm test && pnpm build`.

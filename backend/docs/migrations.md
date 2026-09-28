# Database migrations

The backend uses Alembic (async) against the Postgres instance defined by
`DATABASE_URL` in the repo-root `.env`.

## Running migrations

```
cd backend
.venv\Scripts\python.exe -m alembic upgrade head
```

## Creating a new revision

After changing a model in `app/models/`:

```
cd backend
.venv\Scripts\python.exe -m alembic revision --autogenerate -m "describe the change"
```

Always review the generated file before running it — autogenerate can miss
things (check constraints, some index types) and won't add SQL you have to
write by hand (like `CREATE EXTENSION`).

## Schema / RLS split

The initial schema migration (`initial schema`) creates all 13 core tables
**without row-level security**. RLS is added in a separate, later migration
(see `docs/security-model.md`) so the base schema and the tenant-isolation
policies can each be reviewed independently, with dedicated cross-tenant
tests gating the RLS migration specifically.

## Tenant scoping pattern

Every venture-owned table carries either a direct `organization_id` column
(`documents`, `document_chunks`, `ai_runs`, `audit_logs`, `ventures`) or is
scoped via a foreign-key chain through `venture_id → ventures.organization_id`
(`wizard_responses`, `idea_versions`, `evidence_items`, `venture_members`).
The RLS migration's policies follow this same split: direct-column tables get
a plain equality policy against `app.current_organization_id`; FK-chain
tables get a policy with a subquery against `ventures`. `organizations`,
`users`, `organization_members`, and `wizard_stages` are not RLS-scoped —
they're the identity/membership plane, needed to resolve who a user is and
which orgs they belong to before any single "current organization" exists
for a request.

## Database roles

- **`venture_user`** — schema owner. Used only by Alembic (`DATABASE_URL`).
  Never used by the running app.
- **`venture_app`** — the app's runtime role (`APP_DATABASE_URL`), subject to
  row-level security. `app/db.py`'s engine connects as this role.
- **`venture_service`** — for background jobs that legitimately need
  cross-organization access (`SERVICE_DATABASE_URL`); has `BYPASSRLS`. Not
  used anywhere yet (no background jobs exist), but the role exists so job
  code never has to borrow `venture_app` or `venture_user`.

## Setting the tenant context

Every transaction that touches an RLS-protected table must call
`app.tenancy.set_current_organization(session, organization_id)` first —
it's what makes `app.current_organization_id` available to the policies via
`current_setting('app.current_organization_id', true)`. If it's never
called, every policy comparison evaluates against `NULL` and access is
denied by default. There's no FastAPI endpoint calling this yet (no
venture/auth endpoints exist yet) — see `tests/test_rls.py` for how it's
exercised directly against the database in the meantime.

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
(`documents`, `document_chunks`, `ai_runs`, `audit_logs`) or is scoped via a
foreign-key chain through `venture_id → ventures.organization_id`
(`wizard_responses`, `idea_versions`, `evidence_items`, `venture_members`).
The RLS migration's policies follow this same split: direct-column tables get
a plain equality policy against `app.current_organization_id`; FK-chain
tables get a policy with a subquery against `ventures`.
